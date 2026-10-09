/**
 * 溯流计划 · 战术机能 Markdown 渲染引擎 (Tactical Markdown Renderer)
 * 职责：
 * 1. 提供纯前端、轻量、无外部依赖的 Markdown 解析器；
 * 2. 严格执行《工地施工协议》：零 emoji、零实体分割线、纯 SVG 矢量图标；
 * 3. 深度适配机能风终端视觉规范，支持流式未闭合标签容错；
 * 4. 内置 XSS 防御与代码块一键复制。
 */
(() => {
  'use strict';

  // 纯 SVG 复制图标与已复制勾选图标
  const COPY_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`;
  const CHECK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
  const CHEVRON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  /**
   * 解析行内样式
   * 规则：
   * - 加粗：**text** 或 __text__ -> <strong>
   * - 斜体：*text* 或 _text_ -> <em>
   * - 删除线：~~text~~ -> <del>
   * - 行内代码：`code` -> <code>
   * - 链接：[title](url) -> <a> (安全属性 rel="noopener noreferrer")
   */
  function parseInline(str) {
    if (!str) return '';

    // 占位存储行内代码，避免内部字符被加粗斜体二次解析
    const codeSnippets = [];
    let text = str.replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeSnippets.length;
      codeSnippets.push(`<code>${escapeHtml(code)}</code>`);
      return `\x1Acode${idx}\x1A`;
    });

    // 基础 HTML 转义
    text = escapeHtml(text);

    // 加粗 ** / __
    text = text.replace(/(\*\*|__)(.*?)\1/g, '<strong>$2</strong>');
    // 删除线 ~~
    text = text.replace(/~~(.*?)~~/g, '<del>$1</del>');
    // 斜体 * / _
    text = text.replace(/(^|[^\*])\*([^\*]+)\*([^\*]|$)/g, '$1<em>$2</em>$3');
    text = text.replace(/(^|[^_])_([^_]+)_([^_]|$)/g, '$1<em>$2</em>$3');

    // 战术链接
    text = text.replace(/\[(.*?)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="chat-md-link">$1</a>');

    // 还原行内代码
    text = text.replace(/\x1Acode(\d+)\x1A/g, (_, idx) => codeSnippets[Number(idx)] || '');

    return text;
  }

   /**
    * 移除助手动作标记（<RETROFLOW_ACTION>...</RETROFLOW_ACTION>），用于渲染层隐藏。
    * 原文不受影响：调用方仍保存/发送含标记的完整原文，仅在渲染前调用本函数清洗。
    * 兼容三种形态：
    *   1. 完整闭合标记（可能被 Markdown 代码围栏包裹）
    *   2. 流式吐到一半的未闭合标记（含标签名残缺，如刚冒出 `<` / `<RETRO`）
    * 目的：流式过程中标记一冒头就整体隐藏，绝不把半截尖括号当正文渲染。
    */
   function stripActionMarkers(raw) {
     if (!raw || typeof raw !== 'string') return '';
     return raw
       // 被代码围栏包住的完整标记
       .replace(/```[a-z]*\s*<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>\s*```/gi, '')
       // 独立的完整标记
       .replace(/<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>/gi, '')
       // 未闭合：从（可能带围栏的）开标记起，一路吃到结尾
       .replace(/```[a-z]*\s*<RETROFLOW_ACTION>[\s\S]*$/i, '')
       .replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '')
       // 流式残缺开标记：吐到一半的 `<RETRO`、`<RETROFLOW_ACTIO` 等前缀，隐藏之，
       // 避免半截标签闪现或干扰 markdown 解析。仅匹配 `<` + `RETROFLOW_ACTION` 的真前缀，
       // 且要求 `<` 后至少有一个字母（不动正常文本里孤立的 `<`，如 “a < b”）。
       .replace(/<(?:RETROFLOW_ACTIO|RETROFLOW_ACTI|RETROFLOW_ACT|RETROFLOW_AC|RETROFLOW_A|RETROFLOW_|RETROFLOW|RETROFLO|RETROFL|RETROF|RETRO|RETR|RET|RE|R)$/i, '');
   }

   /**
    * 预处理 XML/HTML 折叠标签 (&lt;think&gt;, &lt;thinking&gt;, &lt;details&gt;)
    * 将其转译为战术手风琴组件，支持未闭合流式容错
    * 规则：
    * - hideThinking === true：在渲染时完全隐藏 <think>/<thinking> 内容，不渲染思维链 DOM；
    * - hideThinking === false：渲染为战术思维链手风琴面板；
    * - <details> 正常渲染，不受 hideThinking 影响。
    */
   function preprocessThinkingAndDetails(raw) {
     if (!raw || typeof raw !== 'string') return '';
     let text = raw;

     const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
       ? SystemChatSettings.getSettings()
       : { hideThinking: false };
     const shouldHideThinking = settings.hideThinking === true;

     // 1. 匹配标准 <think>...</think> 或 <thinking>...</thinking>（已闭合＝思考完成）。
     //    默认收起：思考过程留痕但不占地方，想看点开即可。
     //    收起态经任何重渲染（切窗 / 改设置）仍是收起，不会反复弹开。
     text = text.replace(/<(think|thinking)>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
       if (shouldHideThinking) {
         return '';
       }
       const inner = content.trim();
       return `\n\x1Athink_open\x1A\n${inner}\n\x1Athink_close\x1A\n`;
     });
     // 2. 匹配未闭合的 <think>...（流式生成中，模型正在思考）。
     //    默认展开：让执行员实时看到思考滚动；一旦闭合（上面那条命中）就回落为收起。
     text = text.replace(/<(think|thinking)>([\s\S]*)$/gi, (_, tag, content) => {
       if (shouldHideThinking) {
         return '';
       }
        const inner = content.trim();
        return `\n\x1Athink_open_open\x1A\n${inner}\n\x1Athink_close\x1A\n`;
      });

      // 3. 匹配 <details><summary>title</summary>content</details>
     text = text.replace(/<details(\s+open)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi, (_, isOpen, summary, content) => {
       const openAttr = isOpen ? 'open' : '';
       const summaryText = summary.trim() || 'DETAILS';
       const inner = content.trim();
       return `\n\x1Adetails_open_${openAttr}_${encodeURIComponent(summaryText)}\x1A\n${inner}\n\x1Adetails_close\x1A\n`;
     });

     // 4. 匹配未闭合的 <details>...
     text = text.replace(/<details(\s+open)?>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*)$/gi, (_, isOpen, summary, content) => {
       const openAttr = isOpen ? 'open' : '';
       const summaryText = summary.trim() || 'DETAILS';
       const inner = content.trim();
       return `\n\x1Adetails_open_${openAttr}_${encodeURIComponent(summaryText)}\x1A\n${inner}\n\x1Adetails_close\x1A\n`;
     });

     return text;
   }

   /**
    * 按 Markdown 块级语义切分原文。切分只服务于 UI，调用方仍应保存并发送完整原文。
    * 标题、段落、列表、表格、引用、代码围栏和 details 均保持为不可再拆的块。
    */
   function splitBlocks(rawText) {
     if (typeof rawText !== 'string' || !rawText.trim()) return [];
     const lines = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
     const blocks = [];
     let buffer = [];
     let mode = null;

     const push = () => {
       const value = buffer.join('\n').trim();
       if (value) blocks.push(value);
       buffer = [];
       mode = null;
     };
     const isList = (line) => /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) || /^\s*[-+*]\s+\[[ xX]\]\s+/.test(line);
     const isTableSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

     for (let i = 0; i < lines.length; i += 1) {
       const line = lines[i];
       const trimmed = line.trim();
       const fence = line.match(/^\s*```/);

       if (mode === 'code') {
         buffer.push(line);
         if (fence && buffer.length > 1) push();
         continue;
       }
       if (mode === 'details') {
         buffer.push(line);
         if (/<\/details>\s*$/i.test(trimmed)) push();
         continue;
       }
       if (mode === 'thinking') {
         buffer.push(line);
         if (/<\/(?:think|thinking)>\s*$/i.test(trimmed)) push();
         continue;
       }
       if (/^\s*```/.test(line)) {
         push();
         mode = 'code';
         buffer.push(line);
         continue;
       }
       if (/^\s*<details\b/i.test(line)) {
         push();
         mode = 'details';
         buffer.push(line);
         if (/<\/details>\s*$/i.test(trimmed)) push();
         continue;
       }
       if (/^\s*<(?:think|thinking)\b/i.test(line)) {
         push();
         mode = 'thinking';
         buffer.push(line);
         if (/<\/(?:think|thinking)>\s*$/i.test(trimmed)) push();
         continue;
       }
       if (!trimmed) {
         push();
         continue;
       }
       if (/^\s{0,3}#{1,6}\s+/.test(line)) {
         push();
         blocks.push(trimmed);
         continue;
       }
       if (/^\s*>/.test(line)) {
         if (mode !== 'quote') push();
         mode = 'quote';
         buffer.push(line);
         continue;
       }
       if (isList(line)) {
         if (mode && mode !== 'list') push();
         mode = 'list';
         buffer.push(line);
         continue;
       }
       if (i + 1 < lines.length && line.includes('|') && isTableSeparator(lines[i + 1])) {
         push();
         mode = 'table';
         buffer.push(line, lines[i + 1]);
         i += 1;
         continue;
       }
       if (mode === 'table' && line.includes('|')) {
         buffer.push(line);
         continue;
       }
       if (mode === 'quote' || mode === 'list' || mode === 'table') push();
       buffer.push(line);
       mode = 'paragraph';
     }
     push();
     return blocks;
   }

   /**
    * 核心块级解析器
    * @param {string} rawText 原始 Markdown 文本
    * @returns {string} 渲染后的 HTML 字符串
    */
   function render(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';

    // 先剥掉 HTML 注释 <!-- ... -->：这是「给 AI 看的暗号 / 指令」约定，
    // 玩家侧不应显形（如角色卡指令、副本导演提示）。在 think/details 预处理之前
    // 执行，确保注释里若含 <think> 等字符也随注释整段一并移除。
    const stripped = rawText.replace(/<!--[\s\S]*?-->/g, '');

    const preprocessed = preprocessThinkingAndDetails(stripped);
    const lines = preprocessed.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const out = [];

    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer = [];

    let inBlockquote = false;
    let quoteBuffer = [];

    let inList = false;
    let listType = null; // 'ul' | 'ol'

    let inTable = false;
    let tableHeaders = [];
    let tableAlignments = [];
    let tableRows = [];

    function flushBlockquote() {
      if (!inBlockquote) return;
      const innerHtml = quoteBuffer.map(l => parseInline(l)).join('<br>');
      out.push(
        `<blockquote class="chat-md-quote">` +
          `<div class="chat-md-quote-tag" aria-hidden="true">// ARCHIVE</div>` +
          `<div class="chat-md-quote-body">${innerHtml}</div>` +
        `</blockquote>`
      );
      quoteBuffer = [];
      inBlockquote = false;
    }

    function flushList() {
      if (!inList) return;
      out.push(`</${listType}>`);
      inList = false;
      listType = null;
    }

    function flushTable() {
      if (!inTable) return;
      if (tableHeaders.length === 0 && tableRows.length === 0) {
        inTable = false;
        return;
      }

      let tableHtml = `<div class="chat-md-table-wrap"><table class="chat-md-table">`;
      if (tableHeaders.length > 0) {
        tableHtml += `<thead><tr>`;
        tableHeaders.forEach((th, idx) => {
          const align = tableAlignments[idx] || 'left';
          tableHtml += `<th class="chat-md-th" style="text-align:${align}">${parseInline(th)}</th>`;
        });
        tableHtml += `</tr></thead>`;
      }

      if (tableRows.length > 0) {
        tableHtml += `<tbody>`;
        tableRows.forEach(row => {
          tableHtml += `<tr>`;
          row.forEach((td, idx) => {
            const align = tableAlignments[idx] || 'left';
            tableHtml += `<td class="chat-md-td" style="text-align:${align}">${parseInline(td)}</td>`;
          });
          tableHtml += `</tr>`;
        });
        tableHtml += `</tbody>`;
      }
      tableHtml += `</table></div>`;
      out.push(tableHtml);

      inTable = false;
      tableHeaders = [];
      tableAlignments = [];
      tableRows = [];
    }

    function flushCodeBlock() {
      if (!inCodeBlock) return;
      const rawCode = codeBuffer.join('\n');
      const langLabel = (codeLanguage || 'TEXT').toUpperCase();
      const encodedCode = encodeURIComponent(rawCode);

      out.push(
        `<div class="chat-md-code-block" data-lang="${escapeHtml(langLabel)}">` +
          `<div class="chat-md-code-header">` +
            `<span class="chat-md-code-lang">${escapeHtml(langLabel)}</span>` +
            `<button type="button" class="chat-md-code-copy-btn" data-code="${encodedCode}" aria-label="复制代码" title="复制代码">` +
              `<span class="chat-md-copy-icon">${COPY_SVG}</span>` +
              `<span class="chat-md-copy-label">COPY</span>` +
            `</button>` +
          `</div>` +
          `<pre class="chat-md-pre"><code>${escapeHtml(rawCode)}</code></pre>` +
        `</div>`
      );
      codeBuffer = [];
      codeLanguage = '';
      inCodeBlock = false;
    }

    function parseTableRowCells(line) {
      // 去除首尾竖线后按 | 分割
      const trimmed = line.trim().replace(/^\||\|$/g, '');
      return trimmed.split('|').map(c => c.trim());
    }

    function parseTableAlignments(line) {
      const cells = parseTableRowCells(line);
      return cells.map(cell => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        if (left && right) return 'center';
        if (right) return 'right';
        return 'left';
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 1. 代码块围栏判断 ```
      const codeFenceMatch = line.match(/^```(\w+)?\s*$/);
      if (codeFenceMatch) {
        flushBlockquote();
        flushList();
        flushTable();
        if (inCodeBlock) {
          flushCodeBlock();
        } else {
          inCodeBlock = true;
          codeLanguage = codeFenceMatch[1] || '';
          codeBuffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // 2. 表格判断 (| cell | cell |)
      const isTableRow = /^\|(.+)\|$/.test(line.trim());
      const nextLine = lines[i + 1] ? lines[i + 1].trim() : '';
      const isNextAlignRow = /^\|(\s*:?-+:?\s*\|)+$/.test(nextLine);

      if (isTableRow && !inTable && isNextAlignRow) {
        flushBlockquote();
        flushList();
        inTable = true;
        tableHeaders = parseTableRowCells(line);
        tableAlignments = parseTableAlignments(nextLine);
        tableRows = [];
        i++; // 跳过对齐声明行
        continue;
      } else if (inTable && isTableRow) {
        tableRows.push(parseTableRowCells(line));
        continue;
      } else if (inTable) {
        flushTable();
      }

      // 3. 引用块判断 >
      const quoteMatch = line.match(/^>\s?(.*)$/);
      if (quoteMatch) {
        flushList();
        flushTable();
        inBlockquote = true;
        quoteBuffer.push(quoteMatch[1]);
        continue;
      } else if (inBlockquote) {
        flushBlockquote();
      }

      // 4. 分割线判断 --- / *** / ___ (转换为战术免实体线呼吸间隙)
      if (/^(\-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        flushList();
        flushTable();
        out.push(`<div class="chat-md-spacer" role="separator" aria-hidden="true"></div>`);
        continue;
      }

      // 5. 标题判断 # / ## / ###
      const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        flushList();
        flushTable();
        const level = headingMatch[1].length;
        const headingText = parseInline(headingMatch[2]);
        out.push(`<h${level} class="chat-md-h${level}">${headingText}</h${level}>`);
        continue;
      }

      // 6. 列表项判断
      // 无序列表: - item 或 * item
      // 任务列表: - [ ] item 或 - [x] item
      const taskListMatch = line.match(/^[\*\-]\s+\[([ xX])\]\s+(.*)$/);
      const ulMatch = line.match(/^[\*\-]\s+(.*)$/);
      const olMatch = line.match(/^(\d+)\.\s+(.*)$/);

      if (taskListMatch) {
        flushTable();
        if (!inList || listType !== 'ul') {
          flushList();
          inList = true;
          listType = 'ul';
          out.push(`<ul class="chat-md-list chat-md-task-list">`);
        }
        const isChecked = taskListMatch[1].toLowerCase() === 'x';
        const taskText = parseInline(taskListMatch[2]);
        out.push(
          `<li class="chat-md-task-item ${isChecked ? 'is-done' : ''}">` +
            `<span class="chat-md-checkbox ${isChecked ? 'is-checked' : ''}">${isChecked ? CHECK_SVG : ''}</span>` +
            `<span class="chat-md-task-text">${taskText}</span>` +
          `</li>`
        );
        continue;
      }

      if (ulMatch) {
        flushTable();
        if (!inList || listType !== 'ul') {
          flushList();
          inList = true;
          listType = 'ul';
          out.push(`<ul class="chat-md-list chat-md-ul">`);
        }
        const itemText = parseInline(ulMatch[1]);
        out.push(`<li class="chat-md-li">${itemText}</li>`);
        continue;
      }

      if (olMatch) {
        flushTable();
        if (!inList || listType !== 'ol') {
          flushList();
          inList = true;
          listType = 'ol';
          out.push(`<ol class="chat-md-list chat-md-ol">`);
        }
        const itemText = parseInline(olMatch[2]);
        out.push(`<li class="chat-md-li">${itemText}</li>`);
        continue;
      }

      // 非列表行，闭合已有列表与表格
      flushList();
      flushTable();

      // 7. 特殊占位符判断 (思维链与 Details)
      //    think_open      → 收起（思考已完成）
      //    think_open_open → 展开（流式思考进行中）
      const thinkOpenMatch = line.match(/^\x1Athink_open(_open)?\x1A$/);
      if (thinkOpenMatch) {
        flushList();
        flushTable();
        const isOpen = thinkOpenMatch[1] === '_open' ? 'open' : '';
        out.push(
          `<details class="chat-md-think-details" ${isOpen}>` +
            `<summary class="chat-md-think-summary">` +
              `<span class="chat-md-details-icon">${CHEVRON_SVG}</span>` +
              `<span class="chat-md-think-tag">// DEEP RESONANCE // 思考过程</span>` +
            `</summary>` +
            `<div class="chat-md-think-content">`
        );
        continue;
      }

      if (line === '\x1Athink_close\x1A') {
        flushList();
        flushTable();
        out.push(`</div></details>`);
        continue;
      }

      const detailsOpenMatch = line.match(/^\x1Adetails_open_(open)?_(.+)\x1A$/);
      if (detailsOpenMatch) {
        flushList();
        flushTable();
        const isOpen = detailsOpenMatch[1] === 'open' ? 'open' : '';
        const summaryText = parseInline(decodeURIComponent(detailsOpenMatch[2] || 'DETAILS'));
        out.push(
          `<details class="chat-md-details" ${isOpen}>` +
            `<summary class="chat-md-details-summary">` +
              `<span class="chat-md-details-icon">${CHEVRON_SVG}</span>` +
              `<span class="chat-md-details-title">${summaryText}</span>` +
            `</summary>` +
            `<div class="chat-md-details-content">`
        );
        continue;
      }

      if (line === '\x1Adetails_close\x1A') {
        flushList();
        flushTable();
        out.push(`</div></details>`);
        continue;
      }

      // 8. 空行与常规段落
      const trimmed = line.trim();
      if (!trimmed) {
        // 空行不输出多余实体，仅维持间距
        continue;
      }

      out.push(`<p class="chat-md-p">${parseInline(line)}</p>`);
    }

    // 循环结束后收尾未闭合块（流式友好容错）
    flushBlockquote();
    flushList();
    flushTable();
    flushCodeBlock();

    return out.join('');
  }

  /**
   * 委托绑定所有代码块的复制事件
   * 采用战术 SVG 图标切换反馈
   */
  function bindCodeCopy(container) {
    if (!container) return;
    container.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.chat-md-code-copy-btn');
      if (!copyBtn || copyBtn.classList.contains('is-copied')) return;

      e.stopPropagation();
      const rawCode = decodeURIComponent(copyBtn.dataset.code || '');
      if (!rawCode) return;

      navigator.clipboard.writeText(rawCode).then(() => {
        copyBtn.classList.add('is-copied');
        const iconSpan = copyBtn.querySelector('.chat-md-copy-icon');
        const labelSpan = copyBtn.querySelector('.chat-md-copy-label');
        if (iconSpan) iconSpan.innerHTML = CHECK_SVG;
        if (labelSpan) labelSpan.textContent = 'COPIED';

        setTimeout(() => {
          copyBtn.classList.remove('is-copied');
          if (iconSpan) iconSpan.innerHTML = COPY_SVG;
          if (labelSpan) labelSpan.textContent = 'COPY';
        }, 2000);
      }).catch((err) => {
        console.warn('[Markdown] 复制代码失败:', err);
      });
    });
  }

  /**
   * 剥离 Markdown 格式符号，提取纯文本（用于复制或语音合成）
   * @param {string} raw
   * @returns {string}
   */
  function stripMarkdown(raw) {
    if (!raw || typeof raw !== 'string') return '';
    let text = raw;

    // 1. 移除思维链与 details 标签
    text = text.replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
    text = text.replace(/<(think|thinking)\b[^>]*>[\s\S]*$/gi, '');
    text = text.replace(/<\/(think|thinking)\s*>/gi, '');
    text = text.replace(/<details\b[^>]*>([\s\S]*?)<\/details>/gi, '$1');
    text = text.replace(/<\/?summary\b[^>]*>/gi, '');

    // 2. 代码块：保留代码正文，去除 ```lang 围栏
    text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, '$1');
    text = text.replace(/```[^\n]*/g, '');

    // 3. 行内代码：保留代码，去除反引号
    text = text.replace(/`([^`]+)`/g, '$1');

    // 4. 图片与链接：图片提取 alt，链接保留文本
    text = text.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

    // 5. 粗体、斜体、删除线
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');

    // 6. 标题 (#, ##, ### 等)
    text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

    // 7. 块级引用 (> )
    text = text.replace(/^\s{0,3}>\s?/gm, '');

    // 8. 列表标记 (无序列表 - / * / +, 有序列表 1., 任务列表 [ ] / [x])
    text = text.replace(/^\s{0,3}[-\*\+]\s+\[[ xX]\]\s+/gm, '');
    text = text.replace(/^\s{0,3}[-\*\+]\s+/gm, '');
    text = text.replace(/^\s{0,3}\d+\.\s+/gm, '');

    // 9. 表格边框线与管道符号简化
    text = text.replace(/^\s*\||\|\s*$/gm, '');
    text = text.replace(/\|\s*[-:]+[-| :]*\|/g, '');
    text = text.replace(/\|/g, ' ');

    // 10. 去除常见 HTML 标签
    text = text.replace(/<[^>]+>/g, '');

    // 11. 整理空行与空白
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n\s*\n+/g, '\n\n');

    return text.trim();
  }

  window.RetroflowMarkdown = {
    render,
    splitBlocks,
    stripMarkdown,
    stripActionMarkers,
    parseInline,
    bindCodeCopy,
    COPY_SVG,
    CHECK_SVG
  };
})();
