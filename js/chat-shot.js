/**
   * 溯流计划 · 对话与推演长图截图渲染引擎 (Chat & Fork Shot)
   *
   * 职责：
   * 1. capture({ rows, scene })：自绘机能风对话气泡长图（助手 / 私聊）
   * 2. captureForkNovel({ rows, meta }): 自绘机能小说出版级通栏正文长图（副本推演专用 · 方案 A）
   *
   * 设计约束（遵守工地施工协议）：
   *   - 纯 Canvas Path 绘制，零 emoji、零物理分割线（用留白与低透明色块分区）；
   *   - 配色实时读取当前主题 CSS 变量，成图跟随用户主题；
   *   - 两遍绘制：先量高（文字折行累加总高），再实绘（devicePixelRatio×2 高清）。
   */
window.ChatShot = (() => {
  'use strict';

  /* ================= 版面常量（逻辑像素，绘制时再乘 DPR） ================= */

  const CANVAS_WIDTH = 720;          // 成图逻辑宽度
  const PADDING_X = 40;              // 左右安全边距
  const HEADER_HEIGHT = 132;         // 页眉高度
  const FOOTER_HEIGHT = 96;          // 页脚高度
  const MSG_GAP = 22;                // 消息之间的纵向间距
  const BUBBLE_PAD_X = 22;           // 气泡内文字左右内边距
  const BUBBLE_PAD_Y = 18;           // 气泡内文字上下内边距
  const BUBBLE_MAX_RATIO = 0.76;     // 气泡最大宽度占正文区比例
  const TAG_SIZE = 12;               // 发送者标签字号
  const TAG_GAP = 10;                // 标签与正文的间距
  const BODY_SIZE = 16;              // 正文字号
  const BODY_LINE = 26;              // 正文行高
  const TIME_SIZE = 11;              // 时间戳字号
  const TIME_GAP = 8;                // 正文与时间戳间距
  const BUBBLE_RADIUS = 16;          // 气泡圆角

  /* 方案 A：副本推演通栏排版常量 */
  const NOVEL_CONTENT_WIDTH = CANVAS_WIDTH - PADDING_X * 2; // 640px
  const NOVEL_BODY_SIZE = 16;        // 叙事正文字号
  const NOVEL_BODY_LINE = 28;        // 叙事行高（1.75倍行距，沉浸阅读感）
  const NOVEL_PARA_GAP = 16;         // 自然段落间距
  const NOVEL_SECTION_GAP = 32;      // 轮次/大段落间距
  const NOVEL_ACT_PAD_X = 24;        // 行动卡内边距 X
  const NOVEL_ACT_PAD_Y = 18;        // 行动卡内边距 Y
  const NOVEL_ACT_RADIUS = 8;        // 行动卡微圆角
  const NOVEL_ACT_LINE = 25;         // 行动卡正文行高

  const SAFE_MAX_HEIGHT = 15000;     // 单图安全高度上限，超过则风险提示

  /* ================= 主题取色 ================= */

  function readVar(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      const t = (v || '').trim();
      return t || fallback;
    } catch (_) {
      return fallback;
    }
  }

  /** 把 "r, g, b" 形式的 -rgb 变量包成 rgba() */
  function rgba(rgbVar, alpha, fallbackRgb) {
    const raw = readVar(rgbVar, fallbackRgb);
    return `rgba(${raw}, ${alpha})`;
  }

  function resolveTheme() {
    return {
      bg: readVar('--bg-color', '#f4f1ea'),
      bgRgb: readVar('--bg-color-rgb', '244, 241, 234'),
      card: readVar('--card-bg-color', '#ffffff'),
      cardRgb: readVar('--card-bg-color-rgb', '255, 255, 255'),
      text: readVar('--text-color', '#2b2b2b'),
      muted: readVar('--text-muted', '#8a8a8a'),
      secondary: readVar('--secondary-color', '#2b2b2b'),
      secondaryRgb: readVar('--secondary-color-rgb', '43, 43, 43'),
      primary: readVar('--primary-color', '#c0392b'),
      primaryRgb: readVar('--primary-color-rgb', '192, 57, 43'),
      font: readVar('--main-font', '"Noto Sans SC", system-ui, sans-serif')
    };
  }

  /* ================= 数据抽取 ================= */

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /** 从一行消息 DOM 抽出绘制所需的纯数据 */
  function extractMessage(row) {
    if (!row) return null;

    // 角色：.user = 本人（右侧），其余（assistant）= 对方（左侧）
    const isUser = row.classList.contains('user');

    // 发送者名：优先 dataset.senderName，退回气泡标签文本
    let sender = trimStr(row.dataset && row.dataset.senderName);
    if (!sender) {
      const tag = row.querySelector('.chat-bubble-tag');
      sender = tag ? trimStr(tag.textContent) : (isUser ? '执行员' : '对方');
    }

    // 正文：优先 dataset.rawText，退回气泡正文可见文本
    let text = trimStr(row.dataset && row.dataset.rawText);
    if (!text) {
      const content = row.querySelector('.chat-bubble-content')
        || row.querySelector('.chat-bubble');
      text = content ? trimStr(content.textContent) : '';
    }

    // 时间：dataset.createdAt（ms）转 HH:MM，取不到就留空
    let time = '';
    const createdAt = row.dataset && row.dataset.createdAt;
    if (createdAt) {
      const n = Number(createdAt);
      if (Number.isFinite(n) && n > 0) {
        const d = new Date(n);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        time = `${hh}:${mm}`;
      }
    }
    // 退回气泡上现成的时间戳文本
    if (!time) {
      const t = row.querySelector('.chat-avatar-time, .chat-bubble-time');
      if (t) time = trimStr(t.textContent);
    }

    // 图片 / 文件 / 语音等非纯文本行：给一个占位描述，避免空气泡
    if (!text) {
      if (row.classList.contains('is-gen-image') || row.querySelector('figure, img')) {
        text = '［影像内容］';
      } else if (row.dataset && row.dataset.filePeek === 'true') {
        text = '［文件内容］';
      } else {
        text = '［空消息］';
      }
    }

    return { isUser, sender, text, time };
  }

  /* ================= 文字折行 ================= */

  /**
   * 按最大宽度对一段文本折行，兼顾显式换行符与超宽逐字断行。
   * @returns {string[]} 折好的行数组
   */
  function wrapText(ctx, text, maxWidth) {
    const out = [];
    const paragraphs = String(text).split('\n');

    paragraphs.forEach((para) => {
      if (para === '') {
        out.push('');
        return;
      }
      let line = '';
      for (let i = 0; i < para.length; i += 1) {
        const ch = para[i];
        const test = line + ch;
        if (ctx.measureText(test).width > maxWidth && line) {
          out.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      if (line) out.push(line);
    });

    return out;
  }

  /* ================= 量高（第一遍） ================= */

  /**
   * 预排版：为每条消息算出折行结果与本块高度，并累加出画布总高。
   */
  function layout(ctx, messages, theme) {
    const contentWidth = CANVAS_WIDTH - PADDING_X * 2;
    const bubbleMaxWidth = Math.floor(contentWidth * BUBBLE_MAX_RATIO);
    const textMaxWidth = bubbleMaxWidth - BUBBLE_PAD_X * 2;

    let total = HEADER_HEIGHT;
    const blocks = [];

    messages.forEach((msg, idx) => {
      ctx.font = `${BODY_SIZE}px ${theme.font}`;
      const lines = wrapText(ctx, msg.text, textMaxWidth);

      // 实测本块最长行宽，气泡宽度贴合内容（不小于一个合理最小值）
      let longest = 0;
      ctx.font = `${BODY_SIZE}px ${theme.font}`;
      lines.forEach((ln) => {
        const w = ctx.measureText(ln).width;
        if (w > longest) longest = w;
      });
      ctx.font = `600 ${TAG_SIZE}px ${theme.font}`;
      const tagWidth = ctx.measureText(msg.sender).width;
      ctx.font = `${TIME_SIZE}px ${theme.font}`;
      const timeWidth = msg.time ? (ctx.measureText(msg.time).width + 8) : 0;
      const headerLineWidth = tagWidth + timeWidth;

      const innerWidth = Math.max(longest, headerLineWidth, 40);
      const bubbleWidth = Math.min(bubbleMaxWidth, innerWidth + BUBBLE_PAD_X * 2);

      const textBlockHeight = Math.max(1, lines.length) * BODY_LINE;
      const bubbleHeight = BUBBLE_PAD_Y * 2
        + TAG_SIZE + TAG_GAP
        + textBlockHeight;

      blocks.push({ msg, lines, bubbleWidth, bubbleHeight });
      total += bubbleHeight;
      if (idx < messages.length - 1) total += MSG_GAP;
    });

    total += FOOTER_HEIGHT;
    return { blocks, totalHeight: Math.ceil(total), contentWidth, bubbleMaxWidth };
  }

  /* ================= 绘制辅助 ================= */

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /** 页眉：左侧标题条 + 场景名，右侧编号戳。零分割线，用色块与留白分区 */
  function drawHeader(ctx, theme, scene) {
    const y = 0;

    // 顶部主色细条（不是分割线，是标识色带，紧贴顶边）
    ctx.fillStyle = theme.primary;
    ctx.fillRect(0, 0, CANVAS_WIDTH, 6);

    // 主标题
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.secondary;
    ctx.font = `800 22px ${theme.font}`;
    ctx.fillText('溯流终端 // 对话存档', PADDING_X, y + 54);

    // 场景名（对方 / 助手名）
    ctx.fillStyle = rgba('--secondary-color-rgb', 0.62, theme.secondaryRgb);
    ctx.font = `500 14px ${theme.font}`;
    const sceneName = trimStr(scene && scene.sceneName) || '未命名会话';
    ctx.fillText(sceneName, PADDING_X, y + 82);

    // 右上编号戳
    const stamp = trimStr(scene && scene.sceneTag) || 'ARCHIVE';
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.primary;
    ctx.font = `700 12px ${theme.font}`;
    ctx.fillText(stamp, CANVAS_WIDTH - PADDING_X, y + 54);

    ctx.textAlign = 'left';
  }

  /** 页脚：系统水印 + 条数戳 + 出图日期 */
  function drawFooter(ctx, theme, y, count) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = rgba('--secondary-color-rgb', 0.4, theme.secondaryRgb);
    ctx.font = `700 12px ${theme.font}`;
    ctx.fillText('RETROFLOW SYSTEM', PADDING_X, y + 44);

    const d = new Date();
    const stamp = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba('--secondary-color-rgb', 0.4, theme.secondaryRgb);
    ctx.font = `500 12px ${theme.font}`;
    ctx.fillText(`共 ${count} 条 · ${stamp}`, CANVAS_WIDTH - PADDING_X, y + 44);

    ctx.textAlign = 'left';
  }

  /** 画单条消息气泡 */
  function drawBubble(ctx, theme, block, cursorY) {
    const { msg, lines, bubbleWidth, bubbleHeight } = block;

    const bubbleX = msg.isUser
      ? (CANVAS_WIDTH - PADDING_X - bubbleWidth)
      : PADDING_X;

    // 气泡底：本人用主色低透明块，对方用卡片色块（不描边、不画线）
    if (msg.isUser) {
      ctx.fillStyle = rgba('--primary-color-rgb', 0.14, theme.primaryRgb);
    } else {
      ctx.fillStyle = rgba('--secondary-color-rgb', 0.06, theme.secondaryRgb);
    }
    roundRect(ctx, bubbleX, cursorY, bubbleWidth, bubbleHeight, BUBBLE_RADIUS);
    ctx.fill();

    const innerX = bubbleX + BUBBLE_PAD_X;
    let innerY = cursorY + BUBBLE_PAD_Y;

    // 发送者标签与时间戳同行显示（如 "执行员 14:32"），清爽利落
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = msg.isUser ? theme.primary : rgba('--secondary-color-rgb', 0.7, theme.secondaryRgb);
    ctx.font = `600 ${TAG_SIZE}px ${theme.font}`;
    ctx.fillText(msg.sender, innerX, innerY);

    if (msg.time) {
      const senderWidth = ctx.measureText(msg.sender).width;
      ctx.fillStyle = rgba('--secondary-color-rgb', 0.45, theme.secondaryRgb);
      ctx.font = `${TIME_SIZE}px ${theme.font}`;
      ctx.fillText(msg.time, innerX + senderWidth + 8, innerY + (TAG_SIZE - TIME_SIZE) / 2);
    }

    innerY += TAG_SIZE + TAG_GAP;

    // 正文
    ctx.fillStyle = theme.text;
    ctx.font = `${BODY_SIZE}px ${theme.font}`;
    lines.forEach((ln) => {
      ctx.fillText(ln, innerX, innerY);
      innerY += BODY_LINE;
    });
  }

  /* ================= 主流程 ================= */

  /**
   * 把选中的行绘制成长图并返回 Blob（不负责下载，由调用方决定落点）。
   * @param {Object} opts
   * @param {HTMLElement[]} opts.rows 选中的消息行（按屏幕顺序）
   * @param {Object} [opts.scene] { sceneName, sceneTag }
   * @returns {Promise<{ok:boolean, blob?:Blob, width?:number, height?:number, reason?:string}>}
   */
  async function render(opts) {
    const o = opts || {};
    const rows = Array.isArray(o.rows) ? o.rows.filter(Boolean) : [];
    if (rows.length === 0) return { ok: false, reason: 'empty' };

    const theme = resolveTheme();
    const messages = rows.map(extractMessage).filter(Boolean);
    if (messages.length === 0) return { ok: false, reason: 'empty' };

    // 用离屏 canvas 的 2d 上下文做量高（measureText 需要 ctx）
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const plan = layout(measureCtx, messages, theme);

    if (plan.totalHeight > SAFE_MAX_HEIGHT) {
      return { ok: false, reason: 'too_tall', height: plan.totalHeight };
    }

    // 高清实绘：DPR × 2，最高钳到 3，避免超大 canvas 在低端机爆内存
    const dpr = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 1) + 1));
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = plan.totalHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 背景
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, CANVAS_WIDTH, plan.totalHeight);

    // 页眉
    drawHeader(ctx, theme, o.scene);

    // 逐条画气泡
    let cursorY = HEADER_HEIGHT;
    plan.blocks.forEach((block, idx) => {
      drawBubble(ctx, theme, block, cursorY);
      cursorY += block.bubbleHeight;
      if (idx < plan.blocks.length - 1) cursorY += MSG_GAP;
    });

    // 页脚
    drawFooter(ctx, theme, cursorY, messages.length);

    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } else {
        // 极老环境兜底：dataURL 转 Blob
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const bin = atob(dataUrl.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        } catch (_) {
          resolve(null);
        }
      }
    });

    if (!blob) return { ok: false, reason: 'encode_failed' };
    return { ok: true, blob, width: CANVAS_WIDTH, height: plan.totalHeight };
  }

  /**
   * 渲染并直接下载。
   * @param {Object} opts 同 render，另可带 opts.fileLabel（下载文件标签）
   * @returns {Promise<{ok:boolean, name?:string, reason?:string, height?:number}>}
   */
  async function capture(opts) {
    const res = await render(opts);
    if (!res.ok) return res;

    const label = trimStr(opts && opts.fileLabel) || '对话存档';
    try {
      if (window.Downloader && typeof Downloader.saveImage === 'function') {
        const saved = await Downloader.saveImage(res.blob, label, 'png');
        return { ok: true, name: saved && saved.name };
      }
      // 无 Downloader 时的最简下载兜底
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { ok: true, name: `${label}.png` };
    } catch (err) {
      return { ok: false, reason: 'save_failed', message: err && err.message };
    }
  }

  /* ================= 方案 A：副本推演机能小说排版引擎 ================= */

  /**
   * 剥离 AI 叙事中的后台结构卡块与思考链，保留纯净的小说正文
   */
  function cleanForkNarrationText(raw) {
    if (!raw) return '';
    let text = String(raw);

    // 1. 若全局存在契约解析器，优先调用统一契约解析正文
    if (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function') {
      try {
        const parsed = ForkRunParser.parseRunReply(text);
        if (parsed && typeof parsed.body === 'string') {
          text = parsed.body;
        }
      } catch (_) {}
    }

    // 2. 剥离 ::: 结构化数据卡块 (scene, state, npc, quest 等)
    text = text.replace(/:::\s*([a-zA-Z0-9_-]+)[\s\S]*?:::/g, '');

    // 3. 剥离思考链 <think>...</think>
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // 4. 剥离可能遗留的 HTML 注释与开场 meta 块
    text = text.replace(/<!--[\s\S]*?-->/g, '');

    return text.trim();
  }

  /**
   * 从副本 DOM 行（.fork-run-narration / .fork-run-act）抽离结构数据
   */
  function extractForkRowData(row) {
    if (!row) return null;

    const isAct = row.classList.contains('fork-run-act');
    const isNarration = row.classList.contains('fork-run-narration');
    if (!isAct && !isNarration) return null;

    const raw = trimStr(row.dataset && row.dataset.rawText)
      || trimStr(row.textContent);

    if (isAct) {
      // 执行员行动卡：抽取署名、轮次、行动描述
      let name = '执行员';
      const nameEl = row.querySelector('.fork-run-act-name');
      if (nameEl) name = trimStr(nameEl.textContent) || name;

      let turn = '';
      const turnEl = row.querySelector('.fork-run-act-turn');
      if (turnEl) turn = trimStr(turnEl.textContent) || turn;

      // 剔除注释
      const text = raw.replace(/<!--[\s\S]*?-->/g, '').trim();

      return {
        type: 'act',
        name,
        turn,
        text
      };
    }

    // AI 叙事段：纯净小说正文
    const cleanedText = cleanForkNarrationText(raw);

    // 提取遥测时间戳与轮次（如果有）
    let metaTime = '';
    const teleEl = row.querySelector('.fork-run-narration-telemetry');
    if (teleEl) {
      metaTime = trimStr(teleEl.textContent);
    }

    return {
      type: 'narration',
      text: cleanedText,
      metaTime
    };
  }

  /**
   * 副本小说排版测量与折行
   */
  function layoutForkNovel(ctx, items, theme) {
    let totalHeight = HEADER_HEIGHT;
    const blocks = [];

    items.forEach((item, index) => {
      if (item.type === 'act') {
        // 行动卡：实心机能背景卡片
        ctx.font = `${BODY_SIZE}px ${theme.font}`;
        const maxTextWidth = NOVEL_CONTENT_WIDTH - NOVEL_ACT_PAD_X * 2;
        const lines = wrapText(ctx, item.text, maxTextWidth);

        // 标签高度(14px) + 间距(12px) + 正文行高 + 上下内边距
        const cardHeight = NOVEL_ACT_PAD_Y * 2 + 14 + 12 + Math.max(1, lines.length) * NOVEL_ACT_LINE;

        blocks.push({
          type: 'act',
          item,
          lines,
          height: cardHeight,
          top: totalHeight
        });

        totalHeight += cardHeight + NOVEL_SECTION_GAP;
      } else {
        // 叙事小说正文：自然段落排版
        ctx.font = `${NOVEL_BODY_SIZE}px ${theme.font}`;
        const rawParas = item.text.split(/\n{2,}|\n/).map(p => p.trim()).filter(Boolean);
        const parasLines = [];
        let narrationHeight = 0;

        rawParas.forEach((p, pIdx) => {
          // 纯正文首行自然缩进两个字符宽度（机能小说质感）
          const indent = '    ';
          const pLines = wrapText(ctx, indent + p, NOVEL_CONTENT_WIDTH);
          parasLines.push(pLines);
          narrationHeight += pLines.length * NOVEL_BODY_LINE;
          if (pIdx < rawParas.length - 1) {
            narrationHeight += NOVEL_PARA_GAP;
          }
        });

        blocks.push({
          type: 'narration',
          item,
          parasLines,
          height: narrationHeight,
          top: totalHeight
        });

        totalHeight += narrationHeight + NOVEL_SECTION_GAP;
      }
    });

    totalHeight += FOOTER_HEIGHT;
    return { blocks, totalHeight };
  }

  /** 绘制副本专用页眉 */
  function drawForkHeader(ctx, theme, meta) {
    const y = 0;

    // 顶部主题标识色带
    ctx.fillStyle = theme.primary;
    ctx.fillRect(PADDING_X, y + 26, 42, 4);

    // 主标题
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.secondary;
    ctx.font = `800 22px ${theme.font}`;
    const forkTitle = trimStr(meta && meta.forkTitle) || '溯流推演纪要';
    ctx.fillText(forkTitle, PADDING_X, y + 56);

    // 副标题/卷宗编号
    ctx.fillStyle = rgba('--secondary-color-rgb', 0.62, theme.secondaryRgb);
    ctx.font = `600 13px ${theme.font}`;
    const branchLabel = trimStr(meta && meta.branchLabel) || 'DIVE RECORD';
    ctx.fillText(`世界线推演记录 // ${branchLabel}`, PADDING_X, y + 84);

    // 右上机能标识
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.primary;
    ctx.font = `700 11px ${theme.font}`;
    ctx.fillText('FORK // TRANSCEND', CANVAS_WIDTH - PADDING_X, y + 56);

    ctx.textAlign = 'left';
  }

  /** 绘制副本专用页脚 */
  function drawForkFooter(ctx, theme, y, count) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = rgba('--secondary-color-rgb', 0.4, theme.secondaryRgb);
    ctx.font = `700 12px ${theme.font}`;
    ctx.fillText('RETROFLOW DIVE ARCHIVE', PADDING_X, y + 44);

    const d = new Date();
    const stamp = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    ctx.textAlign = 'right';
    ctx.fillStyle = rgba('--secondary-color-rgb', 0.4, theme.secondaryRgb);
    ctx.font = `500 12px ${theme.font}`;
    ctx.fillText(`共记录 ${count} 幕 · ${stamp}`, CANVAS_WIDTH - PADDING_X, y + 44);

    ctx.textAlign = 'left';
  }

  /** 绘制行动卡 */
  function drawForkActCard(ctx, theme, block) {
    const { item, lines, top, height } = block;
    const x = PADDING_X;
    const y = top;

    // 实心卡片底色（零边框，微弱低透明机能卡片底）
    ctx.fillStyle = rgba('--secondary-color-rgb', 0.05, theme.secondaryRgb);
    roundRect(ctx, x, y, NOVEL_CONTENT_WIDTH, height, NOVEL_ACT_RADIUS);
    ctx.fill();

    const innerX = x + NOVEL_ACT_PAD_X;
    let innerY = y + NOVEL_ACT_PAD_Y;

    // 署名与轮次标识
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.font = `700 13px ${theme.font}`;
    ctx.fillStyle = theme.primary;
    ctx.fillText(item.name || '执行员', innerX, innerY);

    if (item.turn) {
      const nameW = ctx.measureText(item.name || '执行员').width;
      ctx.font = `600 11px ${theme.font}`;
      ctx.fillStyle = rgba('--secondary-color-rgb', 0.45, theme.secondaryRgb);
      ctx.fillText(item.turn, innerX + nameW + 10, innerY + 1);
    }

    innerY += 14 + 12;

    // 行动正文
    ctx.fillStyle = theme.text;
    ctx.font = `${BODY_SIZE}px ${theme.font}`;
    lines.forEach((line) => {
      ctx.fillText(line, innerX, innerY);
      innerY += NOVEL_ACT_LINE;
    });
  }

  /** 绘制叙事通栏段落 */
  function drawForkNarration(ctx, theme, block) {
    const { parasLines, top } = block;
    const x = PADDING_X;
    let cursorY = top;

    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.text;
    ctx.font = `${NOVEL_BODY_SIZE}px ${theme.font}`;

    parasLines.forEach((lines, pIdx) => {
      lines.forEach((line) => {
        ctx.fillText(line, x, cursorY);
        cursorY += NOVEL_BODY_LINE;
      });
      if (pIdx < parasLines.length - 1) {
        cursorY += NOVEL_PARA_GAP;
      }
    });
  }

  /**
   * 副本小说长图渲染核心（先量高排版、再双倍 DPR 高清实绘）
   */
  async function renderForkNovel(opts) {
    const o = opts || {};
    const rawRows = Array.isArray(o.rows) ? o.rows : [];
    const items = rawRows.map(extractForkRowData).filter(Boolean);

    if (items.length === 0) {
      return { ok: false, reason: 'empty_selection' };
    }

    const theme = resolveTheme();

    // 1. 先用离屏 canvas 量高
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    const plan = layoutForkNovel(measureCtx, items, theme);

    if (plan.totalHeight > SAFE_MAX_HEIGHT) {
      console.warn(`[ChatShot] 副本推演长图高度 (${plan.totalHeight}px) 超过安全限制`);
    }

    // 2. 双倍 DPR 高清画布
    const dpr = Math.min(3, Math.max(2, Math.round(window.devicePixelRatio || 1) + 1));
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH * dpr;
    canvas.height = plan.totalHeight * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 背景底色
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, CANVAS_WIDTH, plan.totalHeight);

    // 绘制页眉
    drawForkHeader(ctx, theme, o.meta);

    // 绘制各内容块
    plan.blocks.forEach((block) => {
      if (block.type === 'act') {
        drawForkActCard(ctx, theme, block);
      } else {
        drawForkNarration(ctx, theme, block);
      }
    });

    // 绘制页脚
    drawForkFooter(ctx, theme, plan.totalHeight - FOOTER_HEIGHT, items.length);

    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => resolve(b), 'image/png');
      } else {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          const bin = atob(dataUrl.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i += 1) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type: 'image/png' }));
        } catch (_) {
          resolve(null);
        }
      }
    });

    if (!blob) return { ok: false, reason: 'encode_failed' };
    return { ok: true, blob, width: CANVAS_WIDTH, height: plan.totalHeight };
  }

  /**
   * 副本推演小说长图生成并下载
   */
  async function captureForkNovel(opts) {
    const res = await renderForkNovel(opts);
    if (!res.ok) return res;

    const label = trimStr(opts && opts.fileLabel) || '推演纪要';
    try {
      if (window.Downloader && typeof Downloader.saveImage === 'function') {
        const saved = await Downloader.saveImage(res.blob, label, 'png');
        return { ok: true, name: saved && saved.name };
      }
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${label}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { ok: true, name: `${label}.png` };
    } catch (err) {
      return { ok: false, reason: 'save_failed', message: err && err.message };
    }
  }

  return {
    render,
    capture,
    renderForkNovel,
    captureForkNovel,
    LIMIT: 30
  };
})();
