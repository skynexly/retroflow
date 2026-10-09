/**
 * 溯流计划 · 使用手册检索注入层 (Manual RAG)
 * 职责：
 *   1. 关键词命中注入：扫描最近若干条对话，命中手册条目的 keywords 时把条目全文
 *      拼成一段注入 System Prompt，避免整本手册常驻导致 Token 爆炸；
 *   2. 为助手工具 search_manual / read_manual 提供检索与取全文的执行体。
 *
 * 设计约定：
 *   - 关键词判定复用 KeyMatch（与世界书同一套语法与超时保护），不另写匹配逻辑；
 *   - 扫描范围与世界书对齐（最近 4 条消息），手册内容本就属于助手常识，
 *     宽一点命中不是问题，做关键词筛选的唯一目的是省 Token；
 *   - 注入条数设硬上限：单条 content 可达上千字，命中多条会直接撑爆上下文。
 *   - 自动命中不渲染工具卡片：卡片的意义是告知用户「发生了额外的模型调用」，
 *     而命中注入不产生额外调用，给卡片只会制造噪音。
 */
window.ManualRag = (() => {
  'use strict';

  // 关键词扫描的消息条数（与世界书 SCAN_MESSAGE_COUNT 对齐）
  const SCAN_MESSAGE_COUNT = 4;

  // 单次自动注入的条目数硬上限：手册单条全文可上千字，不设限会撑爆上下文
  const MAX_INJECT_ITEMS = 2;

  // search_manual 返回的命中条目数上限（只给摘要，故可比注入宽松）
  const MAX_SEARCH_RESULTS = 6;

  function getProtocols() {
    return (window.SystemProtocols && typeof SystemProtocols.getAll === 'function')
      ? SystemProtocols.getAll()
      : [];
  }

  /** 从消息数组尾部截取扫描文本 */
  function buildScanText(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    return messages
      .slice(-SCAN_MESSAGE_COUNT)
      .map((m) => (m && typeof m.content === 'string' ? m.content : ''))
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 统计一个条目命中了多少个关键词。
   * 逐词独立判定而非整串一次过，是为了拿到命中强度用于排序：
   * 命中词数多的条目与当前话题更相关，优先注入。
   * @returns {number} 命中的关键词个数
   */
  function countHits(item, scanText) {
    const keys = Array.isArray(item.keywords) ? item.keywords.filter(Boolean) : [];
    if (!keys.length || !scanText) return 0;
    if (!window.KeyMatch || typeof KeyMatch.test !== 'function') return 0;

    let hits = 0;
    keys.forEach((kw) => {
      try {
        const res = KeyMatch.test(String(kw), scanText);
        if (res && res.hit) hits += 1;
      } catch (err) {
        console.warn(`[ManualRag] 条目「${item.id}」关键词「${kw}」判定失败：`, err);
      }
    });
    return hits;
  }

  /**
   * 构建自动命中的注入段。
   * @param {Array} messages 对话消息数组
   * @param {boolean} toolsEnabled 内置工具是否开启（决定是否提示可自行查阅）
   * @returns {string} 注入文本，无命中时返回空串（不占位）
   */
  function buildHitBlock(messages, toolsEnabled) {
    const scanText = buildScanText(messages);
    if (!scanText) return '';

    const list = getProtocols();
    if (!list.length) return '';

    const scored = [];
    list.forEach((item) => {
      if (!item || !item.content) return;
      const hits = countHits(item, scanText);
      if (hits > 0) scored.push({ item, hits });
    });
    if (!scored.length) return '';

    // 命中词数降序，同分保持原始顺序（手册自身的编排顺序即重要度顺序）
    scored.sort((a, b) => b.hits - a.hits);
    const picked = scored.slice(0, MAX_INJECT_ITEMS);

    const bodies = picked.map(({ item }) => {
      const head = `[${item.id}] ${item.title}（${item.categoryName} // ${item.subtitle}）`;
      return `${head}\n${item.content}`;
    });

    const tail = toolsEnabled
      ? '手册未载明的内容，不要据此推演或补全。若执行员问到这里没有的细节，你可以调用工具查阅手册的其它条目；手册中确实没有的，就如实说明你手头没有相关记录，不要编造条款、数值或流程。'
      : '手册未载明的内容，不要据此推演或补全。若执行员问到这里没有的细节，就如实说明你手头没有相关记录，不要编造条款、数值或流程。';

    return `## 系统手册 · 相关条目

以下是溯流计划官方使用手册中，与最近对话可能相关的条目，内容以此处所列为准。这些属于你日常工作中熟悉的系统资料，列出来是为你提供准确的细节依据，并不是你此刻才知晓——转述时自然地融入对话即可，不要生硬照搬，也不要声称自己刚刚查到。

${bodies.join('\n\n')}

${tail}`;
  }

  /* ================= 工具执行体 ================= */

  /**
   * search_manual：按关键词检索，返回条目编号 + 标题 + 摘要。
   * 刻意不返回全文：检索是用来定位的，全文交给 read_manual，
   * 否则一次检索就可能把几千字灌进上下文。
   */
  function searchManual(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) {
      return { status: 'error', output: '缺少 keyword，无法检索手册。' };
    }
    if (!window.SystemProtocols || typeof SystemProtocols.search !== 'function') {
      return { status: 'error', output: '手册知识库未就绪，暂时无法检索。' };
    }

    const found = SystemProtocols.search(kw) || [];
    if (!found.length) {
      return { status: 'success', output: `使用手册中未找到与「${kw}」相关的条目。` };
    }

    const shown = found.slice(0, MAX_SEARCH_RESULTS);
    const lines = shown.map((item) => `- [${item.id}] ${item.title}（${item.categoryName} // ${item.subtitle}）：${item.summary}`);
    const more = found.length > shown.length
      ? `\n（共命中 ${found.length} 条，仅列出前 ${shown.length} 条）`
      : '';
    return {
      status: 'success',
      output: `使用手册中与「${kw}」相关的条目：\n${lines.join('\n')}${more}\n\n如需某条的完整内容，用 read_manual 指定其编号读取。`
    };
  }

  /** read_manual：按条目编号取全文 */
  function readManual(id) {
    const key = String(id || '').trim();
    if (!key) {
      return { status: 'error', output: '缺少 id，无法读取手册条目。' };
    }
    if (!window.SystemProtocols || typeof SystemProtocols.getById !== 'function') {
      return { status: 'error', output: '手册知识库未就绪，暂时无法读取。' };
    }

    const item = SystemProtocols.getById(key);
    if (!item) {
      return { status: 'error', output: `手册中没有编号为「${key}」的条目。可先用 search_manual 按关键词检索正确的编号。` };
    }

    const callout = item.callout && item.callout.text
      ? `\n\n【${item.callout.tag}】\n${item.callout.text}`
      : '';
    return {
      status: 'success',
      output: `[${item.id}] ${item.title}（${item.categoryName} // ${item.subtitle}）\n\n${item.content}${callout}`
    };
  }

  return {
    buildHitBlock,
    searchManual,
    readManual,
    SCAN_MESSAGE_COUNT,
    MAX_INJECT_ITEMS
  };
})();
