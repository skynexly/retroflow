/**
 * ============================================================================
 * 溯流计划 · DECK 随行系统助手舱 (Pane 5 · ASSISTANT LINK)
 *
 * 这是「随行助手」—— 它和溯流空间里那个全屏系统助手是同一条对话：同一个
 * activeConvId、同一张 records 表。在副本 DECK 抽屉里对它说的话，退出副本后
 * 从悬浮球进助手页照样看得到；反过来也一样。两边不是「同步」，是「同一份」。
 *
 * 职责边界（动它之前先想清楚）：
 *   · 本模块只做「DECK 这块屏幕上的渲染 + 输入」。
 *   · 发送链路（装配上下文 → 调模型 → 流式 → 落库 → 工具循环）一律委托
 *     AssistantChatCore，和助手页共用同一个内核。本模块只提供一组 DECK 版
 *     renderer / persist / actions 适配器。
 *   · 落库、上下文装配、工具执行全部借 SystemChatUI 导出的底层函数，绝不自己
 *     写一套 —— 字段一跑偏，两边就不是同一份数据了。
 *
 * 为什么单独成文件、不塞进 fork-run-ui.js：
 *   fork-run-ui 已经 8000+ 行。更重要的是，将来的开放世界沙盒模式会原样复用
 *   这同一套随行舱 —— 独立成文件，沙盒接入时零改动直接挂。本模块对「副本」
 *   概念一无所知，只认一个「DECK 抽屉 + 一组 DOM id」。
 *
 * 本期范围（已与需求对齐）：纯发消息 + 工具卡 + markdown + 思维链折叠。
 *   暂不做：生图 / 识图上传 / 长按菜单 / 重 roll / 多选删除。历史里的生图记录
 *   先降级成一行占位文本，避免拖进 GalleryStore 整条链路。
 * ============================================================================
 */
window.ForkDeckAsst = (() => {
  'use strict';

  /* ========================= DOM 引用（懒抓） ========================= */
  let paneEl = null;
  let streamEl = null;      // 滚动容器
  let messagesEl = null;    // 气泡挂载点
  let textareaEl = null;
  let sendBtnEl = null;
  let inferBtnEl = null;
  let convBadgeEl = null;
  // 批量态相关节点
  let batchCancelBtnEl = null;
  let batchAllBtnEl = null;
  let batchTitleEl = null;
  let batchCountEl = null;
  let batchDockEl = null;
  let batchDeleteBtnEl = null;
  let batchDeleteLabelEl = null;
  let batchShotBtnEl = null;
  let batchShotLabelEl = null;
  let inited = false;

  // 本舱当前是否正在等模型应答。推演中点发送按钮 = 中断。
  let activeAbortController = null;
  // 历史是否已经渲染过。打开抽屉时渲染一次，之后实时追加。
  // 切换 conv（助手页改了活跃对话）时置回 false，下次打开重拉。
  let renderedConvForkId = null;

  // 历史渲染分页：进入只渲染最新一批，上滑到顶再往前追加更早的批次。
  // 与助手页同构（它是 50 + 30）—— 全量渲染意味着打开抽屉要一次性造出成百上千个
  // DOM 节点并跑同样多次 markdown 渲染，这是「一打开就卡死」的直接原因。
  // 上下文（buildChatHistory）读 records 不读 DOM，分页不会让助手失忆。
  const HISTORY_PAGE_INITIAL = 50; // 初次渲染的最新条数
  const HISTORY_PAGE_STEP = 30;    // 每次上滑追加的更早条数
  let historyAllRecords = [];      // 本次会话缓存的全量记录（时间升序）
  let historyRenderedFrom = 0;     // 已渲染区间起始下标；0 表示已到最早
  let isLoadingMoreHistory = false; // 上滑加载重入锁

  function grabDom() {
    if (inited) return true;
    paneEl = document.getElementById('forkDeckAsstPane');
    streamEl = document.getElementById('forkDeckAsstStream');
    messagesEl = document.getElementById('forkDeckAsstMessages');
    textareaEl = document.getElementById('forkDeckAsstTextarea');
    sendBtnEl = document.getElementById('forkDeckAsstSendBtn');
    inferBtnEl = document.getElementById('forkDeckAsstInferBtn');
    convBadgeEl = document.getElementById('forkDeckAsstConvBadge');
    batchCancelBtnEl = document.getElementById('forkDeckAsstBatchCancelBtn');
    batchAllBtnEl = document.getElementById('forkDeckAsstBatchAllBtn');
    batchTitleEl = document.getElementById('forkDeckAsstBatchTitle');
    batchCountEl = document.getElementById('forkDeckAsstBatchCount');
    batchDockEl = document.getElementById('forkDeckAsstBatchDock');
    batchDeleteBtnEl = document.getElementById('forkDeckAsstBatchDeleteBtn');
    batchDeleteLabelEl = document.getElementById('forkDeckAsstBatchDeleteLabel');
    batchShotBtnEl = document.getElementById('forkDeckAsstBatchShotBtn');
    batchShotLabelEl = document.getElementById('forkDeckAsstBatchShotLabel');
    if (!paneEl || !messagesEl || !textareaEl || !sendBtnEl) return false;
    bindEvents();
    bindHudDismiss();
    bindBatchEvents();
    inited = true;
    return true;
  }

  /* ========================= 小工具 ========================= */

  function scrollToBottom() {
    if (streamEl) streamEl.scrollTop = streamEl.scrollHeight;
  }

  /** 依赖齐不齐。缺任何一环都不该让用户以为能用。 */
  function depsReady() {
    return Boolean(
      window.SystemChatUI &&
      window.AssistantChatCore &&
      typeof SystemChatUI.ensureConvReady === 'function' &&
      typeof SystemChatUI.buildChatHistory === 'function' &&
      typeof SystemChatUI.persistChatMessage === 'function' &&
      typeof SystemChatUI.requestAssistantReply === 'function'
    );
  }

  /**
   * 剥掉 <RETROFLOW_ACTION> 动作标记，只留可见正文。
   *
   * 库里存的是模型原文（含标记），助手页靠渲染时剥离来隐藏它 —— DECK 必须做
   * 同样的事，否则生图/头像等动作的原始 JSON 标记会裸露在气泡里。
   *
   * 直接复用全局 RetroflowMarkdown.stripActionMarkers：它比手写正则多覆盖一种
   * 流式残缺开标记（`<RETRO`、`<RETROFLOW_ACTIO` 这类吐到一半的前缀），
   * 自己写会在流式时闪出半截标签。缺引擎时退回原文，不至于把正文吞掉。
   */
  function stripActionTags(text) {
    const raw = String(text || '');
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripActionMarkers === 'function') {
      return RetroflowMarkdown.stripActionMarkers(raw);
    }
    return raw;
  }

  /** 走项目 Markdown 引擎渲染正文到容器，并绑定代码块复制。缺引擎时退回纯文本。 */
  function renderMarkdownInto(container, rawText) {
    if (!container) return;
    const stripped = stripActionTags(rawText);
    const cleaned = stripped.replace(/<!--[\s\S]*?-->/g, '');
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.render === 'function') {
      container.innerHTML = RetroflowMarkdown.render(cleaned);
      if (typeof RetroflowMarkdown.bindCodeCopy === 'function') {
        RetroflowMarkdown.bindCodeCopy(container);
      }
    } else {
      container.textContent = cleaned;
    }
  }

  /**
   * 流式期间的轻量渲染。
   *
   * 为什么不直接用 renderMarkdownInto：那会在每个 chunk 上重跑一次完整
   * markdown 解析 + 重新绑定代码块复制事件，成本随已输出长度线性增长 ——
   * 长回复到后半段每帧都在做大量无用功，这是「发消息时整页发卡」的主因。
   * 流式阶段只需要「字在涨」的观感，用纯文本 + 换行足够；思维链、代码块、
   * 列表这些结构在定稿那一次完整渲染里一次性成型。
   */
  function renderStreamingInto(container, rawText) {
    if (!container) return;
    // 流式途中 action 标记可能只吐半截，一样要剥 —— 否则生图动作那一刻
    // 气泡里会闪出裸露的半截标记
    const stripped = stripActionTags(rawText);
    const cleaned = stripped.replace(/<!--[\s\S]*?-->/g, '');
    // 思维链标记在流式中途可能只吐了半截，直接显形会露出尖括号，先摘掉
    const noThink = cleaned.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '');
    container.textContent = noThink;
  }

  /* ========================= 气泡渲染 ========================= */

  /**
   * 造一条消息气泡行。复用助手页的 chat-msg-row / chat-bubble / chat-bubble-content
   * 类名 —— markdown、思维链折叠手风琴、代码块复制全部由既有样式继承。
   * @returns {{row:HTMLElement, content:HTMLElement}}
   */
  function createBubbleRow(role) {
    const row = document.createElement('div');
    row.className = `chat-msg-row ${role === 'user' ? 'user' : 'assistant'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + (role === 'user' ? 'user' : 'assistant');

    const content = document.createElement('div');
    content.className = 'chat-bubble-content';

    bubble.appendChild(content);
    row.appendChild(bubble);
    return { row, bubble, content };
  }

  /** 等待态气泡：首帧到达前显示加载波形（复用助手页 chat-waveform 口径）。 */
  function setBubbleLoading(content) {
    if (!content) return;
    content.innerHTML = '<div class="chat-waveform" aria-label="因果共振推演中"><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span></div>';
  }

  /* ===================== 长按 HUD 菜单 =====================
     已落地：复制 / 编辑 / 重写 / 多选 / 回溯到此 / 删除。
       · 重写 / 回溯 —— 不再依赖 messagesWrap 的 DOM 顺序。本舱改用全量记录缓存
         historyAllRecords 计算「这条之后还有没有用户消息」与回溯删除范围，比扫
         DOM 更准（分页渲染时 DOM 不等于完整历史）。重写的上下文截断复用
         buildChatHistory({ stopBeforeRow }) —— 它本就基于 recordId 截断。
       · 多选 —— 本舱自带批量顶栏/底栏，复用 removeChatRecordIds + ChatShot.capture。
     刻意不做的：
       · 引用 —— 需要引用预览条，属额外 UI 工作量，暂缓。
       · 语音 / 撤回 —— TTS 与撤回胶囊渲染都还没在本舱落地。
     所有动作走全局模块（TextEditorModal / RetroModal / stripMarkdown / ChatShot）与
     SystemChatUI 已导出的落库函数，不触碰助手页 DOM。
     ============================================================================ */

  let activeHudEl = null;
  let activeLockedEl = null;

  function closeActiveHud() {
    if (activeHudEl) {
      activeHudEl.remove();
      activeHudEl = null;
    }
    if (activeLockedEl) {
      activeLockedEl.classList.remove('is-locked');
      activeLockedEl = null;
    }
  }

  /**
   * 绑定长按唤起 HUD。阈值与助手页一致：450ms 触发，移动超过 8px 取消。
   * @param {HTMLElement} target 被长按的节点（气泡或工具卡胶囊）
   * @param {Function} buildItems 返回菜单项数组的工厂（延迟到长按时才算，
   *   这样禁用态能反映当下状态）
   */
  function bindLongPress(target, buildItems) {
    if (!target) return;
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    function startPress(e) {
      if (e.touches && e.touches.length > 1) return;
      // 批量态下长按不唤 HUD —— 那时点击的语义是勾选，弹菜单会打断多选操作
      if (isBatchMode) return;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        openHud(target, buildItems(), { x: startX, y: startY });
      }, 450);
    }
    function cancelPress() {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    function movePress(e) {
      if (!pressTimer) return;
      const point = e.touches ? e.touches[0] : e;
      if (Math.abs(point.clientX - startX) > 8 || Math.abs(point.clientY - startY) > 8) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    target.addEventListener('touchstart', startPress, { passive: true });
    target.addEventListener('touchend', cancelPress);
    target.addEventListener('touchcancel', cancelPress);
    target.addEventListener('touchmove', movePress, { passive: true });
    target.addEventListener('mousedown', startPress);
    target.addEventListener('mouseup', cancelPress);
    target.addEventListener('mouseleave', cancelPress);
  }

  /**
   * 弹出 HUD。沿用助手页的 chat-context-hud / chat-hud-item 类名拿样式与弹出
   * 动画，额外挂 fork-asst-hud 作用域类做深色化覆盖（助手页那套是浅底口径）。
   * 定位基准是本舱 paneEl，并避让本舱自己的输入台。
   */
  function openHud(target, items, touchPos) {
    closeActiveHud();
    if (!paneEl || !items || !items.length) return;

    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch (_) {}
    }

    target.classList.add('is-locked');
    activeLockedEl = target;

    const hud = document.createElement('div');
    hud.className = 'chat-context-hud fork-asst-hud';

    const grid = document.createElement('div');
    // 列数按项数挑，避免出现 3+1 这种尾行孤零一个的难看布局：
    // 1/2 项各占一行，3 项一行三列，4 项两行两列，5+ 项三列多行（同助手页 8 项的排法）。
    const cols = items.length <= 2 ? items.length
      : items.length === 4 ? 2
        : 3;
    grid.className = `chat-hud-grid cols-${cols}`;

    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-hud-item ${item.isDanger ? 'is-danger' : ''}`;
      btn.dataset.action = item.key;
      btn.innerHTML = `
        ${item.icon}
        <span class="chat-hud-item-zh">${item.zh}</span>
        <span class="chat-hud-item-en">${item.en}</span>
      `;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeActiveHud();
        try {
          const ret = item.run();
          if (ret && typeof ret.catch === 'function') {
            ret.catch((err) => console.warn('[ForkDeckAsst] HUD 动作失败：', err));
          }
        } catch (err) {
          console.warn('[ForkDeckAsst] HUD 动作失败：', err);
        }
      });
      grid.appendChild(btn);
    });

    hud.appendChild(grid);
    // 挂到 .fork-asst-body（它有 position: relative），并以它为定位基准。
    // 不挂 paneEl 本身 —— paneEl 是 .fork-deck-pane，没有定位上下文。
    const anchorHost = paneEl.querySelector('.fork-asst-body') || paneEl;
    anchorHost.appendChild(hud);
    activeHudEl = hud;

    // 定位：以手指落点为锚，优先悬浮在上方，空间不足翻到下方，并避让输入台
    const paneRect = anchorHost.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    const hudW = hudRect.width || 190;
    const hudH = hudRect.height || 70;

    const anchorX = (touchPos && touchPos.x) ? touchPos.x : (targetRect.left + targetRect.width / 2);
    let left = anchorX - hudW / 2 - paneRect.left;
    left = Math.max(10, Math.min(left, paneRect.width - hudW - 10));

    const anchorY = (touchPos && touchPos.y) ? touchPos.y : targetRect.top;
    let top = anchorY - paneRect.top - hudH - 16;
    // 上方被眉栏挤掉时翻到手指下方
    if (top < 56) top = anchorY - paneRect.top + 24;
    // 底部避让输入台
    const dockEl = paneEl.querySelector('.fork-asst-dock');
    const maxTop = dockEl
      ? (dockEl.getBoundingClientRect().top - paneRect.top - hudH - 8)
      : (paneRect.height - hudH - 60);
    top = Math.min(top, maxTop);
    top = Math.max(56, top);

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  /** 点空白处 / 滚动时收起 HUD */
  function bindHudDismiss() {
    if (!paneEl) return;
    paneEl.addEventListener('click', (e) => {
      if (activeHudEl && !activeHudEl.contains(e.target)) closeActiveHud();
    });
    if (streamEl) {
      // 一个 scroll 监听兼顾两件事：收 HUD + 上滑到顶加载更早历史。
      // 合并绑定而非各绑一个，省一次事件分发。
      streamEl.addEventListener('scroll', () => {
        closeActiveHud();
        // 距顶 80px 内就预加载，等滑到 0 再加载会有明显的空档感
        if (streamEl.scrollTop < 80) loadMoreHistory();
      }, { passive: true });
    }
  }

  /* ---------------- 三个动作 ---------------- */

  /** 复制：取原文剥 markdown 后写剪贴板，带 execCommand 兜底（口径同助手页） */
  async function actionCopy(rawText) {
    const clean = (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripMarkdown === 'function')
      ? RetroflowMarkdown.stripMarkdown(rawText)
      : String(rawText || '').trim();

    if (!clean) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'COPY // 空内容', message: '当前消息无有效纯文本可复制', type: 'info' });
      }
      return;
    }

    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(clean);
        copied = true;
      } catch (_) { copied = false; }
    }
    if (!copied) {
      try {
        const helper = document.createElement('textarea');
        helper.value = clean;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        copied = document.execCommand('copy');
        helper.remove();
      } catch (_) { copied = false; }
    }

    if (window.RetroToast) {
      RetroToast.show(copied
        ? { tag: 'COPY // 复制成功', message: '纯文本已复制到剪贴板', type: 'info' }
        : { tag: 'COPY // 复制失败', message: '未能写入剪贴板，请检查权限', type: 'warning' });
    }
  }

  /**
   * 编辑：走全局 TextEditorModal，先覆盖库记录再更新画面。
   * 顺序不能反 —— 先改画面后写库，写失败就会出现「看到的和上下文不一致」。
   */
  async function actionEdit(row, bubble, content, rawText) {
    if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'EDIT // 不可用', message: '文本编辑器模块未就绪', type: 'warning' });
      }
      return;
    }

    const updated = await TextEditorModal.open({
      title: '编辑消息',
      tag: 'MESSAGE // 修改记忆',
      value: rawText,
      maxLength: 8000
    });
    if (updated === null || updated === undefined) return;
    const newText = String(updated).trim();
    if (!newText) return;

    const recordId = row && row.dataset ? row.dataset.recordId : '';
    if (recordId) {
      const ok = await SystemChatUI.updateChatRecordContent(recordId, newText);
      if (!ok) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'MEMORY // WRITE FAILED', message: '消息修改未能写入上下文记录。', type: 'warning' });
        }
        return;
      }
    }

    if (bubble) bubble.dataset.rawText = newText;
    renderMarkdownInto(content, newText);
  }

  /**
   * 查看图片描述（只读）：生图行看生图提示词，用户发图行看识图结果。
   * 和助手页看齐 —— 底层改写这段文字对画面无实际作用，统一走只读模态，
   * 不塞脏 record.content，避免用户误以为可编辑修改。
   * @param {HTMLElement} row 图像消息所在行
   * @param {boolean} isGenImg true=生图行（看提示词）/ false=用户发图行（看识图结果）
   */
  function actionViewImageMeta(row, isGenImg) {
    if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'VIEW // 不可用', message: '文本查看器模块未就绪', type: 'warning' });
      }
      return;
    }
    const ds = (row && row.dataset) || {};
    const value = isGenImg
      ? String(ds.imagePrompt || '').trim()
      : String(ds.visionDescription || '').trim();
    TextEditorModal.open({
      title: isGenImg ? '生图提示词' : '识图结果',
      tag: isGenImg ? 'IMAGE // 生成提示词' : 'VISION // 识别结果',
      value: value || (isGenImg ? '（无生图提示词记录）' : '（暂无识图结果）'),
      readOnly: true
    });
  }

  /**
   * 删除：确认后连库带 DOM 一起抹除。
   * removeChatRecordIds 会把同组（messageGroupId）的记录一并删掉 —— 它只返回条数、
   * 不返回 id 列表，所以删了多条时我们无从知道该移除哪些 DOM，只能整块重拉历史。
   * 单条的常规情况走退场动画，保留手感。
   */
  async function actionDelete(row, confirmDetail) {
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: 'PURGE // 抹除记录',
        message: '确认要彻底删除此条记录吗？',
        detail: confirmDetail || '该记录将从当前会话中永久清除，无法撤销。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    let removedCount = 0;
    const recordId = row && row.dataset ? row.dataset.recordId : '';
    if (recordId && window.SystemChatUI && typeof SystemChatUI.removeChatRecordIds === 'function') {
      try {
        removedCount = (await SystemChatUI.removeChatRecordIds([recordId])) || 0;
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'PURGE // FAILED', message: '记录删除失败，请稍后重试。', type: 'warning' });
        }
        return;
      }
    }

    // 连带删除了同组记录：屏幕上那些气泡的库记录已经没了，不重拉会留下「假气泡」
    if (removedCount > 1) {
      if (row) row.remove();
      renderedConvForkId = null;
      await renderHistory();
      return;
    }

    if (row) {
      row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      row.style.opacity = '0';
      row.style.transform = 'scale(0.95)';
      setTimeout(() => row.remove(), 200);
    }
  }


  /**
   * 给消息气泡装上长按菜单。
   * rawText 从 bubble.dataset.rawText 实时读 —— 编辑后会被改写，
   * 闭包捕获旧值会导致「编辑完再复制还是老内容」。
   */
  function attachBubbleMenu(handle) {
    if (!handle || !handle.bubble) return;
    const { row, bubble, content } = handle;
    const isAssistant = row && row.classList && row.classList.contains('assistant');
    bindLongPress(bubble, () => {
      const raw = typeof bubble.dataset.rawText === 'string' ? bubble.dataset.rawText : '';
      const icons = (window.SystemChatUI && SystemChatUI.HUD_ICONS) || {};
      const items = [
        { key: 'copy', zh: '复制', en: 'COPY', icon: icons.copy || '', run: () => actionCopy(raw) },
        { key: 'edit', zh: '编辑', en: 'EDIT', icon: icons.edit || '', run: () => actionEdit(row, bubble, content, raw) }
      ];
      // 重写只对助手气泡、且它属于末尾那一轮时才给。延迟到长按这一刻求值，
      // 所以中途又发了新消息、这条不再是末尾时，菜单里自然就没有重写了。
      if (isAssistant && canRewriteRecord(row && row.dataset ? row.dataset.recordId : '')) {
        items.push({ key: 'rewrite', zh: '重写', en: 'REWRITE', icon: icons.rewrite || '', run: () => actionRewrite(row, bubble, content) });
      }
      items.push({ key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(row) });
      items.push({ key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: icons.rewind || '', run: () => actionRewind(row) });
      items.push({ key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true, run: () => actionDelete(row, '该条消息将从当前会话中永久清除，无法撤销。') });
      return items;
    });
  }


  /* ===================== 重写（REWRITE） =====================
     只对「整场对话末尾那一轮助手回复」可用 —— 它之后不能再有用户消息，
     否则重写会改掉中间的历史、让后面的对话失去依据。
     判定基于 historyAllRecords（库里的全量记录），不靠 DOM 扫描：本舱分页
     渲染，DOM 不等于完整历史，拿 DOM 算会误判。
     ============================================================ */

  /**
   * 跑一轮不落库的流式生成，专供重写用。
   *
   * 为什么不复用助手页的 generateReplacementReply：那个函数会 disable 助手页的
   * 输入框、改它的发送按钮状态、写它的 activeAbortController —— 从 DECK 调过去
   * 会去操作另一个界面的 DOM。这里只保留它的核心（取配置 → 裁剪上下文 → 流式），
   * 上下文裁剪仍走导出的 fitMessagesToContext，保证两端口径一致。
   *
   * @param {Array} history 已装配好的上下文
   * @param {Function} onChunk 每次增量回调，参数是累计全文
   * @returns {Promise<string>} 定稿全文
   */
  async function streamReplacement(history, onChunk) {
    if (!window.SystemChatPrompt || !window.RetroflowAPI) {
      throw new Error('系统助手 API 模块尚未加载');
    }
    const config = SystemChatPrompt.resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('尚未配置系统助手模型，或主模型配置不完整');
    }
    const sceneCtx = (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function')
      ? ForkRunUI.buildAsstSceneCtx()
      : null;
    const systemPrompt = SystemChatPrompt.buildSystemPrompt(history, sceneCtx);
    const fitted = (window.SystemChatUI && typeof SystemChatUI.fitMessagesToContext === 'function')
      ? SystemChatUI.fitMessagesToContext(config, systemPrompt, history)
      : { messages: [{ role: 'system', content: systemPrompt }].concat(history) };

    const settings = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
      ? SystemChatSettings.getSettings()
      : { streaming: true };

    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    activeAbortController = controller;
    if (inferBtnEl) inferBtnEl.classList.add('is-inferring');

    let reply = '';
    try {
      if (settings.streaming && typeof RetroflowAPI.streamChat === 'function') {
        await RetroflowAPI.streamChat(config, fitted.messages, (delta, meta) => {
          // 思维链增量（meta.reasoning）不计入正文，与助手页口径一致
          if (!meta || !meta.reasoning) {
            reply += delta || '';
            if (typeof onChunk === 'function') onChunk(reply);
          }
        }, { signal: controller ? controller.signal : undefined, logTag: 'DECK 助手舱' });
      } else {
        const result = await RetroflowAPI.chat(config, fitted.messages, {
          signal: controller ? controller.signal : undefined,
          logTag: 'DECK 助手舱'
        });
        reply = result && result.content ? result.content : '';
      }
      const stripped = (window.SystemChatUI && typeof SystemChatUI.stripEchoedTimePrefix === 'function')
        ? SystemChatUI.stripEchoedTimePrefix(reply)
        : reply;
      return String(stripped || '').trim();
    } finally {
      activeAbortController = null;
      if (inferBtnEl) inferBtnEl.classList.remove('is-inferring');
    }
  }

  /**
   * 这条助手记录是否可重写：它必须属于末尾那一轮助手回复。
   * 即：从它开始到流水末尾，不能出现任何用户消息。
   */
  function canRewriteRecord(recordId) {
    if (!recordId || activeAbortController) return false;
    const idx = historyAllRecords.findIndex((r) => r && String(r.id) === String(recordId));
    if (idx < 0) return false;
    const target = historyAllRecords[idx];
    if (!target || target.role !== 'assistant') return false;
    for (let i = idx; i < historyAllRecords.length; i += 1) {
      const rec = historyAllRecords[i];
      if (rec && rec.role === 'user') return false;
    }
    return true;
  }

  /**
   * 重写末尾那一轮助手回复。
   *
   * 整轮重写：末尾可能连着多条 assistant 记录（工具循环会产出多条），
   * 以其中第一条为锚点截断上下文、保留它作为承载新内容的目标，其余删掉。
   * 这与助手页 rewriteLatestAssistantRow 的语义逐条对齐。
   */
  async function actionRewrite(row, bubble, content) {
    const recordId = row && row.dataset ? row.dataset.recordId : '';
    if (!canRewriteRecord(recordId)) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWRITE // 不可用', message: '只能重写最新一轮的助手回复', type: 'info' });
      }
      return;
    }

    // 找出末尾这一整轮 assistant 记录（从末尾往前，直到遇到非 assistant）
    let firstIdx = historyAllRecords.length;
    for (let i = historyAllRecords.length - 1; i >= 0; i -= 1) {
      const rec = historyAllRecords[i];
      if (rec && rec.role === 'assistant') {
        firstIdx = i;
      } else {
        break;
      }
    }
    if (firstIdx >= historyAllRecords.length) return;

    const batch = historyAllRecords.slice(firstIdx);
    const anchorRecord = batch[0];
    // 以这一轮之前的历史为基准（截断锚点是该轮第一条的 id）
    let history = [];
    try {
      history = await SystemChatUI.buildChatHistory({
        stopBeforeRow: { dataset: { recordId: String(anchorRecord.id || '') } }
      });
    } catch (err) {
      console.warn('[ForkDeckAsst] 重写上下文装配失败：', err);
      return;
    }

    // 该轮除锚点外的其余记录先抹掉（库 + DOM），由锚点承载新内容
    const extraIds = batch.slice(1).map((r) => r && r.id).filter(Boolean).map(String);
    if (extraIds.length) {
      try {
        if (window.SystemChatUI && typeof SystemChatUI.removeChatRecordIds === 'function') {
          await SystemChatUI.removeChatRecordIds(extraIds);
        }
      } catch (err) {
        console.warn('[ForkDeckAsst] 重写清理旧记录失败：', err);
      }
      extraIds.forEach((id) => {
        const el = messagesEl && messagesEl.querySelector(`[data-record-id="${id}"]`);
        if (el) el.remove();
      });
      historyAllRecords = historyAllRecords.filter(
        (r) => !(r && extraIds.includes(String(r.id)))
      );
    }

    // 目标气泡退回等待态，流式到达时逐帧刷新
    setBubbleLoading(content);
    scrollToBottom();

    try {
      const replacement = await streamReplacement(history, (partial) => {
        renderStreamingInto(content, partial);
        scrollToBottom();
      });
      if (!replacement) {
        // 空回复：把原文放回去，不让气泡停在空白态
        const original = bubble && bubble.dataset ? (bubble.dataset.rawText || '') : '';
        renderMarkdownInto(content, original);
        if (window.RetroToast) {
          RetroToast.show({ tag: 'REWRITE // 空回复', message: '模型没有输出内容，可再试一次', type: 'warning' });
        }
        return;
      }

      // 覆盖锚点记录的内容
      const ok = await SystemChatUI.updateChatRecordContent(String(anchorRecord.id), replacement);
      if (!ok) throw new Error('原助手记录不存在');

      if (bubble) bubble.dataset.rawText = replacement;
      renderMarkdownInto(content, replacement);
      // 同步内存缓存，避免紧接着再重写时读到旧值
      const cached = historyAllRecords.find((r) => r && String(r.id) === String(anchorRecord.id));
      if (cached) cached.content = replacement;
      scrollToBottom();
    } catch (err) {
      const isAbort = err && (err.name === 'AbortError'
        || /aborted a request/.test(String(err.message || '')));
      if (!isAbort) {
        // 失败也要把原文放回去，别留空气泡
        const original = bubble && bubble.dataset ? (bubble.dataset.rawText || '') : '';
        renderMarkdownInto(content, original);
        if (window.RetroToast) {
          const detail = (window.SystemChatUI && typeof SystemChatUI.getApiErrorText === 'function')
            ? SystemChatUI.getApiErrorText(err) : String(err && err.message || err);
          RetroToast.show({ tag: 'REWRITE // FAILED', message: `重写失败：${detail}`, type: 'warning' });
        }
      }
    }
  }

  /* ===================== 回溯（REWIND） =====================
     把会话退回到某条消息的时点：删掉它之后的全部记录，并把该说的话退回输入框。
     与助手页 rewindFromRow 语义一致，但范围计算基于 historyAllRecords 而非 DOM ——
     本舱分页渲染，DOM 只有已渲染的那部分。拿 DOM 算会漏删没渲染的后续记录，
     造成「回溯完了，更晚的消息却还在库里」，下次打开又冒出来。
     ========================================================== */

  /** 从一条消息的内容里取回填输入框用的原文（优先 dataset，退回记录本体） */
  function pickRestoreText(record) {
    return String((record && record.content) || '').trim();
  }

  /**
   * 回溯到某条消息。
   *   · 用户气泡 —— 连它自己一起删，它的内容退回输入框（「这句我重说」）。
   *   · 助手气泡 —— 保留它，删它之后的全部，后续里最后一条用户消息退回输入框。
   */
  async function actionRewind(row) {
    const recordId = row && row.dataset ? String(row.dataset.recordId || '') : '';
    if (!recordId) return;
    if (activeAbortController) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // 推演进行中', message: '请先等本轮结束或中断', type: 'info' });
      }
      return;
    }

    const idx = historyAllRecords.findIndex((r) => r && String(r.id) === recordId);
    if (idx < 0) return;

    const isUserRow = row.classList && row.classList.contains('user');
    // 用户气泡含自身，助手气泡从下一条起
    const fromIdx = isUserRow ? idx : idx + 1;
    const doomed = historyAllRecords.slice(fromIdx);

    if (!doomed.length) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // 无需操作', message: '当前消息已经位于会话末端', type: 'info' });
      }
      return;
    }

    // 回填文本：用户气泡取自己，助手气泡取将被删掉的那批里最后一条用户消息
    let restoredText = '';
    if (isUserRow) {
      restoredText = pickRestoreText(historyAllRecords[idx]);
    } else {
      for (let i = doomed.length - 1; i >= 0; i -= 1) {
        const rec = doomed[i];
        if (rec && rec.role === 'user' && rec.kind === 'system_chat_message') {
          restoredText = pickRestoreText(rec);
          break;
        }
      }
    }

    // 确认框与助手页共用同一个 rememberKey：同一套对话、同一个用户心智，
    // 在助手页勾过「不再提示」，这里也该直接放行，不该再问一遍。
    const rememberKey = 'retroflow_system_chat_rewind_confirmed_v1';
    let skipConfirm = false;
    try { skipConfirm = localStorage.getItem(rememberKey) === '1'; } catch (_) { /* 走确认框 */ }

    if (!skipConfirm && window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: 'REWIND // 回溯会话',
        message: '确认回溯到此条消息吗？',
        detail: isUserRow
          ? `将删除此条及后续共 ${doomed.length} 条内容，此条内容会退回输入框。`
          : `此消息之后的 ${doomed.length} 条内容将被永久删除，最近一条执行员消息会退回输入框。`,
        confirmText: '确认回溯',
        cancelText: '取消',
        danger: true,
        rememberKey
      });
      if (!ok) return;
    }

    const doomedIds = doomed.map((r) => r && r.id).filter(Boolean).map(String);
    try {
      if (window.SystemChatUI && typeof SystemChatUI.removeChatRecordIds === 'function') {
        await SystemChatUI.removeChatRecordIds(doomedIds);
      }
    } catch (err) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // FAILED', message: '后续记录删除失败，当前会话未改动。', type: 'warning' });
      }
      return;
    }

    // 同步内存缓存与已渲染的 DOM。没渲染的那些本来就不在屏幕上，库里已抹掉即可。
    historyAllRecords = historyAllRecords.slice(0, fromIdx);
    doomedIds.forEach((id) => {
      const el = messagesEl && messagesEl.querySelector(`[data-record-id="${id}"]`);
      if (el) el.remove();
    });

    // 退回输入框，让用户接着改
    if (textareaEl && restoredText) {
      textareaEl.value = restoredText;
      autoResize();
      textareaEl.focus();
    }
    scrollToBottom();
  }

  /* ===================== 批量多选（删除 / 截图） =====================
     助手页那套 enterBatchMode 绑死在它自己的顶栏元素与 messagesWrap 上，没法复用，
     所以本舱自己实现一份；但两条规矩与它保持一致：
       · 可选行的范围遵循「能进上下文，就必须能被删除」—— 气泡与工具卡都能选，
         避免出现「读得到却删不掉」的孤儿卡片。
       · 截图上限取 ChatShot.LIMIT（30），删除不设上限。
     ================================================================ */

  // 可选行选择器。与助手页 SELECTABLE_ROW_SELECTOR 同口径，但用本舱实际渲染的结构：
  // 本舱不渲染撤回胶囊，所以只有消息行与工具卡两类。
  const SELECTABLE_ROW_SELECTOR = '.chat-msg-row, .chat-status-pill-row';

  let isBatchMode = false;
  const selectedRows = new Set();

  /** 当前消息流里所有可选行，按 DOM 真实先后顺序 */
  function getSelectableRows() {
    if (!messagesEl) return [];
    return Array.from(messagesEl.querySelectorAll(SELECTABLE_ROW_SELECTOR));
  }

  /** 刷新计数与两个动作按钮的可用态 */
  function updateBatchCount() {
    const count = selectedRows.size;
    if (batchCountEl) batchCountEl.textContent = `已选中 ${count} 项`;
    if (batchDeleteLabelEl) batchDeleteLabelEl.textContent = `删除 (${count})`;
    // 删除不设上限：选了就能删
    if (batchDeleteBtnEl) {
      batchDeleteBtnEl.style.opacity = count > 0 ? '1' : '0.4';
      batchDeleteBtnEl.style.pointerEvents = count > 0 ? 'auto' : 'none';
    }
    // 截图有上限：1..LIMIT 才亮，0 条或超限都灰（与删除各算各的）
    const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
    if (batchShotLabelEl) batchShotLabelEl.textContent = `截图 (${count})`;
    if (batchShotBtnEl) {
      const shotOk = count >= 1 && count <= limit;
      batchShotBtnEl.style.opacity = shotOk ? '1' : '0.4';
      batchShotBtnEl.style.pointerEvents = shotOk ? 'auto' : 'none';
    }
    // 全选按钮在「已全选」时转为取消全选
    if (batchAllBtnEl) {
      const all = getSelectableRows();
      const isAll = all.length > 0 && count === all.length;
      const label = batchAllBtnEl.querySelector('span');
      if (label) label.textContent = isAll ? '取消' : '全选';
    }
  }

  function toggleRowSelection(row) {
    if (!row) return;
    if (selectedRows.has(row)) {
      selectedRows.delete(row);
      row.classList.remove('is-selected');
    } else {
      selectedRows.add(row);
      row.classList.add('is-selected');
    }
    updateBatchCount();
  }

  /**
   * 进批量态。
   * @param {HTMLElement} [initialRow] 从长按菜单进来时默认勾选的那行
   */
  function enterBatchMode(initialRow) {
    if (!paneEl) return;
    closeActiveHud();
    isBatchMode = true;
    selectedRows.clear();

    paneEl.classList.add('is-batch-mode');

    // 眉栏换装：返回 / 标题 / 徽标让位给 取消 / 计数 / 全选
    const backBtn = document.getElementById('forkDeckAsstBackBtn');
    const titleWrap = paneEl.querySelector('.fork-asst-title-wrap');
    if (backBtn) backBtn.hidden = true;
    if (titleWrap) titleWrap.hidden = true;
    if (convBadgeEl) convBadgeEl.hidden = true;
    if (batchCancelBtnEl) batchCancelBtnEl.hidden = false;
    if (batchTitleEl) batchTitleEl.hidden = false;
    if (batchAllBtnEl) batchAllBtnEl.hidden = false;

    // 底栏换装：输入台收起，批量操作台亮起
    const dock = paneEl.querySelector('.fork-asst-dock');
    if (dock) dock.hidden = true;
    if (batchDockEl) batchDockEl.hidden = false;
    if (textareaEl) textareaEl.blur();

    if (initialRow) {
      toggleRowSelection(initialRow);
    } else {
      updateBatchCount();
    }
  }

  /** 退出批量态，复位眉栏与底栏 */
  function exitBatchMode() {
    if (!paneEl) return;
    isBatchMode = false;

    selectedRows.forEach((row) => {
      if (row) row.classList.remove('is-selected');
    });
    selectedRows.clear();

    paneEl.classList.remove('is-batch-mode');

    const backBtn = document.getElementById('forkDeckAsstBackBtn');
    const titleWrap = paneEl.querySelector('.fork-asst-title-wrap');
    if (backBtn) backBtn.hidden = false;
    if (titleWrap) titleWrap.hidden = false;
    if (convBadgeEl) convBadgeEl.hidden = false;
    if (batchCancelBtnEl) batchCancelBtnEl.hidden = true;
    if (batchTitleEl) batchTitleEl.hidden = true;
    if (batchAllBtnEl) batchAllBtnEl.hidden = true;

    const dock = paneEl.querySelector('.fork-asst-dock');
    if (dock) dock.hidden = false;
    if (batchDockEl) batchDockEl.hidden = true;
  }

  /** 批量删除：先抹库再退场动画，确保刷新与后续上下文都不会复活 */
  async function batchDelete() {
    const count = selectedRows.size;
    if (count === 0) return;

    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: `PURGE // 批量抹除 (${count})`,
        message: `确认要彻底删除选中的 ${count} 条记录吗？`,
        detail: '选中的所有记录将从当前会话中永久清除，无法撤销。',
        confirmText: `删除 (${count})`,
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    const rowsToDelete = Array.from(selectedRows).filter(Boolean);
    const recordIds = rowsToDelete.map((row) => row.dataset.recordId).filter(Boolean);

    let removedCount = 0;
    if (recordIds.length && window.SystemChatUI && typeof SystemChatUI.removeChatRecordIds === 'function') {
      try {
        removedCount = (await SystemChatUI.removeChatRecordIds(recordIds)) || 0;
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'PURGE // FAILED', message: '批量删除失败，未改动当前会话。', type: 'warning' });
        }
        return;
      }
    }

    // 连带删除了同组记录（removeChatRecordIds 会把 messageGroupId 同组的一起抹掉，
    // 但只返回条数不返回 id），屏幕上可能残留库里已不存在的「假气泡」，整块重拉。
    if (removedCount > recordIds.length) {
      exitBatchMode();
      renderedConvForkId = null;
      await renderHistory();
      return;
    }

    rowsToDelete.forEach((row) => {
      row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      row.style.opacity = '0';
      row.style.transform = 'scale(0.95)';
      setTimeout(() => row.remove(), 200);
    });

    exitBatchMode();
  }

  /**
   * 批量截图：把选中行拼成长图下载。
   * ChatShot 只从行的 dataset.rawText / dataset.senderName 与气泡文本取料，
   * 自己在离屏 canvas 上重绘，不依赖本舱的样式环境，所以能直接复用。
   */
  async function batchShot() {
    const count = selectedRows.size;
    const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
    if (count < 1 || count > limit) return; // 灰态双保险

    if (!window.ChatShot || typeof ChatShot.capture !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAPTURE // 引擎缺席', message: '截图引擎未加载', type: 'warning' });
      }
      return;
    }

    // 选中集合是无序 Set，按 DOM 真实先后排一遍，保证长图里的时间线正确
    const order = getSelectableRows();
    const rows = Array.from(selectedRows).filter(Boolean)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b));

    let sceneName = '系统助手';
    try {
      if (window.SystemChatUI && typeof SystemChatUI.getCurrentAssistantName === 'function') {
        sceneName = SystemChatUI.getCurrentAssistantName() || sceneName;
      }
    } catch (_) { /* 取名失败用默认 */ }

    if (batchShotBtnEl) {
      batchShotBtnEl.style.pointerEvents = 'none';
      batchShotBtnEl.style.opacity = '0.4';
    }

    try {
      const res = await ChatShot.capture({
        rows,
        // 标签与助手页的「助手存档」区分：存出来能看出是副本随行舱截的
        scene: { sceneName, sceneTag: 'ASSISTANT // 随行存档' },
        fileLabel: `随行存档_${sceneName}`
      });
      if (res && res.ok) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CAPTURE // 存档完成', message: `已保存 ${count} 条对话长图`, type: 'success' });
        }
        exitBatchMode();
      } else if (res && res.reason === 'too_tall') {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CAPTURE // 内容过长', message: '选中内容拼图过高，请减少条数后重试', type: 'warning' });
        }
      } else if (window.RetroToast) {
        RetroToast.show({ tag: 'CAPTURE // 生成失败', message: '长图生成失败，请重试', type: 'error' });
      }
    } catch (err) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAPTURE // 生成异常', message: (err && err.message) || '长图生成异常', type: 'error' });
      }
    } finally {
      updateBatchCount();
    }
  }

  function bindBatchEvents() {
    if (batchCancelBtnEl) {
      batchCancelBtnEl.addEventListener('click', exitBatchMode);
    }
    if (batchAllBtnEl) {
      batchAllBtnEl.addEventListener('click', () => {
        const all = getSelectableRows();
        const isAll = all.length > 0 && selectedRows.size === all.length;
        all.forEach((row) => {
          if (isAll) {
            selectedRows.delete(row);
            row.classList.remove('is-selected');
          } else {
            selectedRows.add(row);
            row.classList.add('is-selected');
          }
        });
        updateBatchCount();
      });
    }
    if (batchDeleteBtnEl) {
      batchDeleteBtnEl.addEventListener('click', () => { batchDelete(); });
    }
    if (batchShotBtnEl) {
      batchShotBtnEl.addEventListener('click', () => { batchShot(); });
    }
    // 批量态下点气泡 = 勾选。绑在容器上做事件委托：
    // 气泡是动态生成的，逐个绑会漏掉上滑加载进来的更早历史。
    if (messagesEl) {
      messagesEl.addEventListener('click', (e) => {
        if (!isBatchMode) return;
        const row = e.target.closest(SELECTABLE_ROW_SELECTOR);
        if (!row || !messagesEl.contains(row)) return;
        // 批量态下吞掉气泡内的原有点击行为（如工具卡详情弹窗）
        e.preventDefault();
        e.stopPropagation();
        toggleRowSelection(row);
      }, true); // 捕获阶段：抢在工具卡自己的 click 之前
    }
  }

  /* ========================= 工具调用卡 ========================= */
  function createToolCard(tool) {
    const row = document.createElement('div');
    row.className = 'chat-status-pill-row';

    const pill = document.createElement('div');
    pill.className = 'chat-status-pill is-clickable';
    pill.setAttribute('role', 'button');
    pill.setAttribute('title', '点击查看工具调用详情');

    const label = (window.SystemChatUI && typeof SystemChatUI.toolLabel === 'function')
      ? SystemChatUI.toolLabel(tool.name)
      : String(tool.name || 'tool');

    pill.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
      <span class="chat-status-pill-tag"></span>
      <span class="chat-status-pill-text"></span>
      <svg class="chat-status-pill-arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
      </svg>
    `;
    pill.querySelector('.chat-status-pill-tag').textContent = tool.tag || 'TOOL';
    pill.querySelector('.chat-status-pill-text').textContent = label;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.SystemChatUI && typeof SystemChatUI.openToolInspectModal === 'function') {
        SystemChatUI.openToolInspectModal(tool);
      }
    });

    row.appendChild(pill);
    // 工具卡长按：删除 + 多选。复制 / 编辑对工具结果没有语义
    bindLongPress(pill, () => {
      const icons = (window.SystemChatUI && SystemChatUI.HUD_ICONS) || {};
      return [
        { key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(row) },
        {
          key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true,
          run: () => actionDelete(row, '该条工具调用记录将从当前会话中永久清除，无法撤销。')
        }
      ];
    });
    return row;
  }

  /* ===================== 生成图渲染与灯箱 =====================
     助手生成的图存在 genImageRef 里（assetKey + state + prompt），资产本体在
     Storage。取图就一步：Storage.getAssetSrc(assetKey) 拿 objectURL。

     为什么不复用助手页的 appendGeneratedImage / openGenImageLightbox：两个都没导出，
     且前者会往助手页的 messagesWrap 挂节点、读它的 isBatchMode。这里只搬核心口径
     （释放态降级 + dataURL 转换 + 压桩防返回穿透），CSS 全复用 .chat-gen-image /
     .chat-gen-lightbox，视觉与助手页一致。
     ============================================================ */

  // 本舱创建的所有 objectURL，重渲染历史时统一释放，避免分页进出累积泄漏
  let genImageUrls = [];

  function revokeGenImageUrls() {
    genImageUrls.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch (_) {}
    });
    genImageUrls = [];
  }

  /** 释放态占位（资产已被清理）。与助手页同文案。 */
  function fillReleasedPlaceholder(figure) {
    if (!figure) return;
    figure.classList.remove('is-loading');
    figure.classList.add('is-released');
    figure.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg><span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
  }

  /**
   * 把图异步填进已挂好的 figure 骨架。
   *
   * renderHistoryRecord 是同步的（调用方在 fragment 里批量循环），所以这里的
   * 异步取图不能阻塞渲染：骨架先同步挂上，src 到了再填。figure 可能在取图期间
   * 已被移除（分页重渲染 / 删除），所以填充前校验 isConnected。
   */
  async function fillGenImage(figure, media) {
    if (!figure) return;
    const released = media.state === 'released' || !media.assetKey;
    if (released) {
      fillReleasedPlaceholder(figure);
      return;
    }
    try {
      const src = media.src || (window.Storage && typeof Storage.getAssetSrc === 'function'
        ? await Storage.getAssetSrc(media.assetKey)
        : null);
      if (!src) throw new Error('asset released');
      if (!figure.isConnected) {
        // 已经被移走了，拿到的 objectURL 立刻还掉，不进登记表
        if (/^blob:/i.test(src)) {
          try { URL.revokeObjectURL(src); } catch (_) {}
        }
        return;
      }
      if (/^blob:/i.test(src)) genImageUrls.push(src);

      const image = document.createElement('img');
      image.alt = media.owner === 'user' ? '发送给系统助手的图片' : '系统助手生成的图片';
      image.loading = 'lazy';
      image.src = src;
      image.addEventListener('click', (e) => {
        if (isBatchMode) return;
        e.stopPropagation();
        openDeckImageLightbox(src, { assetKey: media.assetKey });
      });
      figure.classList.remove('is-loading');
      figure.innerHTML = '';
      figure.appendChild(image);
    } catch (_) {
      fillReleasedPlaceholder(figure);
    }
  }

  /**
   * 极简大图查看器。
   *
   * 压一条 history 桩并监听 popstate：返回键/手势优先关灯箱，不会穿透去关
   * 助手舱或整个推演页。closedByPop 区分触发源，避免多退一层。
   * 顶栏的灵动岛保护由 .chat-gen-lightbox-topbar 的 env(safe-area-inset-top) 承担
   * （与助手页共用同一套 CSS）。
   */
  function openDeckImageLightbox(src, opts) {
    if (!src) return;
    const options = opts || {};

    const overlay = document.createElement('div');
    overlay.className = 'chat-gen-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '生成影像查看器');

    const topbar = document.createElement('div');
    topbar.className = 'chat-gen-lightbox-topbar';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'chat-gen-lightbox-btn';
    closeBtn.setAttribute('aria-label', '关闭大图');
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'chat-gen-lightbox-btn';
    downloadBtn.setAttribute('aria-label', '下载图片');
    downloadBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;

    topbar.append(closeBtn, downloadBtn);

    const stage = document.createElement('div');
    stage.className = 'chat-gen-lightbox-stage';
    const img = document.createElement('img');
    img.src = src;
    stage.appendChild(img);

    overlay.append(topbar, stage);

    const close = () => {
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 200);
    };

    let closedByPop = false;
    const onPopState = () => {
      closedByPop = true;
      close();
    };
    const dismiss = () => {
      window.removeEventListener('popstate', onPopState);
      if (!closedByPop) {
        try { history.back(); } catch (_) { /* 无栈可退时忽略 */ }
      }
      close();
    };
    try {
      history.pushState({ rfLightbox: true }, '', location.hash || '');
      window.addEventListener('popstate', onPopState, { once: true });
    } catch (_) { /* pushState 不可用时退化为纯手动关闭 */ }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === stage) dismiss();
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    // WebView 对 blob: 既不给「保存图片」长按项也无法落盘，必须转 dataURL
    let dataUrlPromise = null;
    const ensureDataUrl = () => {
      if (dataUrlPromise) return dataUrlPromise;
      dataUrlPromise = (async () => {
        if (/^data:/i.test(src)) return src;
        if (!options.assetKey || !window.Storage || typeof Storage.getAssetRaw !== 'function') return null;
        const raw = await Storage.getAssetRaw(options.assetKey);
        if (!raw) return null;
        if (raw.type === 'url' && typeof raw.data === 'string') return raw.data;
        if (!(raw.data instanceof Blob)) return null;
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('读取失败'));
          reader.readAsDataURL(raw.data);
        });
      })().catch((err) => {
        console.warn('[ForkDeckAsst] 图片 dataURL 转换失败：', err);
        return null;
      });
      return dataUrlPromise;
    };

    ensureDataUrl().then((dataUrl) => {
      if (dataUrl && overlay.isConnected) img.src = dataUrl;
    });

    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const payload = await ensureDataUrl();
        if (!payload) throw new Error('影像缓存已释放');
        if (!window.Downloader || typeof Downloader.saveImage !== 'function') {
          throw new Error('下载模块尚未加载');
        }
        const res = await Downloader.saveImage(payload, '生成图');
        if (window.RetroToast) {
          const isShare = res.via === 'share';
          const isNative = res.via === 'native';
          RetroToast.show({
            tag: 'IMAGE // 导出影像',
            message: isShare ? '已唤起系统保存' : (isNative ? '影像已保存到设备存储' : '已触发下载'),
            detail: isShare
              ? `${res.name}｜在面板里选择「保存到相册」或任意应用。`
              : (isNative
                ? `${res.name}｜已写入「${res.dir || 'Download'}」目录，可在文件管理中查看。`
                : `${res.name}｜若相册未出现可长按大图另存。`),
            type: 'success'
          });
        }
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'IMAGE // 导出失败',
            message: (err && err.message) || '影像导出失败',
            detail: '可长按大图，用系统自带的保存图片。',
            type: 'warning'
          });
        }
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('active'));
  }

  /* ========================= 历史渲染 ========================= */

  /**
   * 渲染一条历史记录到指定挂载点。
   * 四类分发口径对齐助手页 renderHistoryRecord：
   *   recall 通知 / 工具卡 / 生图（本期降级为占位） / 普通消息。
   * 生图不在本期范围 —— 搬 GalleryStore 整条链路成本过高，先用一行占位，
   * 避免历史里出现空洞或报错。用户要看图去助手页看，数据本身不丢。
   *
   * @param {Object} record 流水记录
   * @param {Node} [mount] 挂载目标，默认 messagesEl。
   *   批量渲染时传 DocumentFragment，把 N 次 reflow 压成一次。
   */
  function renderHistoryRecord(record, mount) {
    const target = mount || messagesEl;
    if (!record || !target) return;

    // 撤回通知：DECK 本期不渲染独立胶囊，静默跳过（助手页仍可见），不污染消息流
    if (record.kind === 'system_chat_notice') return;

    // 工具卡。kind 字符串必须与 system-chat-ui 的 SYSTEM_CHAT_TOOL_KIND 一字不差，
    // 写错不会报错、只会让历史里的工具卡静默消失。
    if (record.kind === 'system_chat_tool_call') {
      const tag = (window.SystemChatUI && typeof SystemChatUI.toolCardTag === 'function')
        ? SystemChatUI.toolCardTag(record.toolName, record.toolStatus)
        : 'TOOL';
      const toolRow = createToolCard({
        name: record.toolName || 'tool',
        tag,
        input: record.toolInput,
        output: record.toolOutput,
        status: record.toolStatus || 'success'
      });
      // recordId 必须回写：长按删除要靠它抹库，缺了就只是移掉 DOM，刷新又回来
      if (record.id) toolRow.dataset.recordId = record.id;
      target.appendChild(toolRow);
      return;
    }

    if (record.kind !== 'system_chat_message') return;

    // 生图记录：从 genImageRef 取 assetKey 渲染真图（释放态降级为占位）。
    // 图独立成行、不进气泡（对齐助手页 .is-gen-image 口径）。
    // 长按给删除 + 回溯到此 —— 图也是流水的一环；复制/编辑对图无语义。
    if (record.messageType === 'assistant-image') {
      const row = document.createElement('div');
      row.className = 'chat-msg-row assistant is-gen-image';
      if (record.id) row.dataset.recordId = record.id;
      if (record.messageGroupId) row.dataset.messageGroupId = record.messageGroupId;
      // ChatShot / 批量截图取文本时有东西可读；也便于调试辨认
      row.dataset.imagePrompt = String((record.genImageRef && record.genImageRef.prompt) || record.content || '').trim();
      row.dataset.rawText = row.dataset.imagePrompt ? `[生成图] ${row.dataset.imagePrompt}` : '[生成图]';

      const figure = document.createElement('div');
      figure.className = 'chat-gen-image is-loading';
      // 骨架先同步挂上（渲染不被异步取图阻塞），src 到了再无感填入
      figure.innerHTML = '<span class="chat-gen-spinner" aria-hidden="true"></span><span class="chat-gen-loading-text">RENDERING // 载入影像</span>';
      row.appendChild(figure);

      const media = {
        assetKey: String((record.genImageRef && record.genImageRef.assetKey) || ''),
        state: String((record.genImageRef && record.genImageRef.state) || 'active'),
        prompt: row.dataset.imagePrompt
      };
      fillGenImage(figure, media);

      bindLongPress(figure, () => {
        const icons = (window.SystemChatUI && SystemChatUI.HUD_ICONS) || {};
        return [
          { key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(row) },
          { key: 'view', zh: '查看描述', en: 'VIEW', icon: icons.edit || '', run: () => actionViewImageMeta(row, true) },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: icons.rewind || '', run: () => actionRewind(row) },
          {
            key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true,
            run: () => actionDelete(row, '该图像消息及其图库资产将被一并永久清除，无法撤销。')
          }
        ];
      });
      target.appendChild(row);
      return;
    }

    // 普通文本消息：含 <think> 的由 markdown 引擎渲染成折叠手风琴
    const role = record.role === 'user' ? 'user' : 'assistant';
    const handle = createBubbleRow(role);
    renderMarkdownInto(handle.content, record.content || '');
    if (record.id) handle.row.dataset.recordId = record.id;
    // 原文存 dataset：长按菜单的复制与编辑都读它，不能靠从 DOM 反推
    handle.bubble.dataset.rawText = String(record.content || '');
    // 发送者名快照：ChatShot 截图优先读它来署名，缺了会退回「对方 / 执行员」默认名
    const senderName = String(record.senderName || record.assistantName || '').trim();
    if (senderName) handle.row.dataset.senderName = senderName;
    // 时间戳：截图的时间行要用它
    if (record.createdAt) handle.row.dataset.createdAt = String(record.createdAt);

    // 附件（执行员发的图与文档）。口径对齐助手页 renderHistoryRecord 的取值顺序。
    const media = record.imageRef || record.media
      || (record.fileRefs && record.fileRefs.length ? { fileRefs: record.fileRefs } : null);
    // hasText 以剥离动作标记后的可见正文为准：助手只发了生图指令时，剥完就是空的，
    // 不该把它当成「有文字」而留一个空气泡壳。
    const visibleBody = stripActionTags(record.content || '').trim();
    const hasText = Boolean(visibleBody);

    // 助手只发了动作标记、没有可见正文、也没有附件要挂：整条跳过，不留空气泡。
    // （生图动作本身会落一条独立的 assistant-image 记录，图不会丢。）
    if (role === 'assistant' && !hasText && !media) {
      return;
    }

    // 文档卡：点击复用全局 retroflow:preview-file 只读预览弹窗。
    // 那个监听挂在 window 上（file-store-ui 注册），推演页自己也在用同一条链路，
    // 所以在抽屉里 dispatch 一样能被接住，不需要降级成不可点。
    if (media && Array.isArray(media.fileRefs) && media.fileRefs.length) {
      const fileCard = document.createElement('div');
      fileCard.className = 'chat-file-card';
      media.fileRefs.forEach((f) => {
        if (!f) return;
        const item = document.createElement('div');
        item.className = 'chat-file-card-item';
        item.dataset.fileId = f.id || '';

        // 用 textContent 逐段构建而非 innerHTML 拼串：本舱没有 HTML 转义工具，
        // 文件名来自用户输入，拼串等于把 XSS 面摊开。
        const icon = document.createElement('span');
        icon.className = 'chat-file-card-icon';
        icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

        const body = document.createElement('span');
        body.className = 'chat-file-card-body';
        const nameEl = document.createElement('span');
        nameEl.className = 'chat-file-card-name';
        nameEl.textContent = String(f.name || '未命名文档');
        const metaEl = document.createElement('span');
        metaEl.className = 'chat-file-card-meta';
        metaEl.textContent = `${String(f.sizeText || '')} // ${f.charCount || 0} 字符`;
        body.append(nameEl, metaEl);

        item.append(icon, body);
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isBatchMode) return;
          if (!window.FileStore || typeof FileStore.getText !== 'function') return;
          // 不传 scope：助手对话的附件归全局文件区，与助手页同口径
          const text = await FileStore.getText(f.id);
          if (text != null) {
            window.dispatchEvent(new CustomEvent('retroflow:preview-file', {
              detail: { name: f.name || '文件', text }
            }));
          } else if (window.RetroToast) {
            RetroToast.show({ tag: 'DOC // 已释放', message: '该文件已从文件区删除，无法预览', type: 'info' });
          }
        });
        fileCard.appendChild(item);
      });
      handle.bubble.insertBefore(fileCard, handle.content);
      // 纯附件无正文时藏掉空的文字容器，免得气泡里留一条空行
      if (!hasText) handle.content.hidden = true;
    }

    // 执行员发的图：不进气泡，作为裸缩略图挂在气泡上方，与生成图统一视觉。
    // 判定口径与助手页一致（assetKey / galleryId / visionDescription / type==='image'）。
    const hasUserImage = role === 'user' && media
      && (media.assetKey || media.galleryId || media.visionDescription || media.type === 'image');
    if (hasUserImage) {
      // 识图结果缓存到行 dataset，供长按「查看描述」只读读取
      handle.row.dataset.visionDescription = String(media.visionDescription || '');
      const figure = document.createElement('div');
      figure.className = 'chat-gen-image is-loading';
      figure.innerHTML = '<span class="chat-gen-spinner" aria-hidden="true"></span><span class="chat-gen-loading-text">RENDERING // 载入影像</span>';
      fillGenImage(figure, {
        assetKey: String(media.assetKey || ''),
        state: String(media.state || 'active'),
        owner: 'user'
      });

      // 识图状态条：仅非 active 态显示，与助手页同文案
      if (media.type === 'image' && media.state && media.state !== 'active') {
        const visionStatus = document.createElement('div');
        visionStatus.className = `chat-vision-status is-${media.state}`;
        visionStatus.textContent = media.state === 'pending'
          ? '正在识别影像……'
          : media.state === 'failed' ? '影像识别失败' : '影像记忆已归档';
        figure.appendChild(visionStatus);
      }

      if (!hasText) handle.content.hidden = true;

      // 图与气泡竖向成组，整组右对齐（.chat-user-media-stack 自带 flex 列布局）。
      // 纯图无正文且无文档卡时不挂气泡：空壳会露出孤立的 tag 方块。
      const stack = document.createElement('div');
      stack.className = 'chat-user-media-stack';
      const keepBubble = hasText || handle.bubble.querySelector('.chat-file-card');
      handle.row.removeChild(handle.bubble);
      if (keepBubble) stack.append(figure, handle.bubble);
      else stack.appendChild(figure);
      handle.row.appendChild(stack);

      // 图也要能长按（删除 / 回溯）。纯图行没有气泡可长按，否则整条就按不动了。
      bindLongPress(figure, () => {
        const icons = (window.SystemChatUI && SystemChatUI.HUD_ICONS) || {};
        return [
          { key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(handle.row) },
          { key: 'view', zh: '查看描述', en: 'VIEW', icon: icons.edit || '', run: () => actionViewImageMeta(handle.row, false) },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: icons.rewind || '', run: () => actionRewind(handle.row) },
          {
            key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true,
            run: () => actionDelete(handle.row, '该消息及其影像资产将从当前会话中永久清除，无法撤销。')
          }
        ];
      });
    }

    // 气泡还在 row 里才挂气泡菜单。纯图行的气泡已被丢弃（无正文、无文档卡），
    // 它的长按菜单由上面的 figure 承担，这里再绑就是给游离节点绑死代码。
    // 注意：此刻 row 尚未挂进 target，不能用 isConnected 判断，只能看 row.contains。
    if (handle.row.contains(handle.bubble)) {
      attachBubbleMenu(handle);
    }
    target.appendChild(handle.row);
  }

  /**
   * 渲染一段区间 [from, to) 的记录。
   * @param {number} from 起始下标（含）
   * @param {number} to 结束下标（不含）
   * @param {Node} [before] 传入时前插到该节点之前（上滑加载更早用），否则追加到末尾
   */
  function renderHistoryRange(from, to, before) {
    // 批量挂载：先在离屏 fragment 里建好全部节点，再一次性插入。
    // 逐条挂载会触发 N 次 reflow，条数一多就是明显的白屏卡顿。
    const frag = document.createDocumentFragment();
    for (let i = from; i < to; i += 1) {
      try {
        renderHistoryRecord(historyAllRecords[i], frag);
      } catch (err) {
        // 单条渲染隔离：一条记录炸了不能连累整段历史
        console.warn('[ForkDeckAsst] 单条记录渲染失败，已跳过：', err);
      }
    }
    if (before) {
      messagesEl.insertBefore(frag, before);
    } else {
      messagesEl.appendChild(frag);
    }
  }

  /**
   * 上滑加载更早一批历史：往顶部前插 HISTORY_PAGE_STEP 条，并保持滚动位置不跳。
   * 与助手页 loadMoreHistory 同范式，含保位法。
   */
  function loadMoreHistory() {
    if (isLoadingMoreHistory) return;
    if (historyRenderedFrom <= 0) return; // 已到最早
    if (!messagesEl || !streamEl) return;
    isLoadingMoreHistory = true;

    try {
      const to = historyRenderedFrom;
      const from = Math.max(0, to - HISTORY_PAGE_STEP);

      // 保位法：记录「原第一个子节点」这个锚点。前插后它在文档里的位置会下移，
      // 用它 offsetTop 的变化量补偿 scrollTop —— 比用 scrollHeight 差更准，
      // scrollHeight 差在内容异步撑高时会失真，累积误差表现为「滑不到底」。
      const anchorNode = messagesEl.firstElementChild || null;
      const beforeAnchorTop = anchorNode ? anchorNode.offsetTop : 0;
      const beforeScrollTop = streamEl.scrollTop;

      renderHistoryRange(from, to, anchorNode);
      historyRenderedFrom = from;

      // 保持视口不跳：让锚点停在原来的视觉位置
      if (anchorNode) {
        const afterAnchorTop = anchorNode.offsetTop;
        streamEl.scrollTop = beforeScrollTop + (afterAnchorTop - beforeAnchorTop);
      }
    } catch (err) {
      console.warn('[ForkDeckAsst] 上滑加载更早历史失败：', err);
    } finally {
      isLoadingMoreHistory = false;
    }
  }

  /**
   * 渲染当前 activeConvId 的流水（分页：只渲染最新一批）。
   * 必须先 await ensureConvReady —— 它设定 SYSTEM_CHAT_FORK_ID 指向活跃对话，
   * 否则 getCurrentForkId 读到的可能还是初值，拉到错误对话的流水。
   */
  async function renderHistory() {
    if (!messagesEl || !window.Storage || typeof Storage.getRecordsByFork !== 'function') return;

    await SystemChatUI.ensureConvReady();
    const forkId = (typeof SystemChatUI.getCurrentForkId === 'function')
      ? SystemChatUI.getCurrentForkId()
      : null;
    if (!forkId) return;

    // 活跃对话没变且已渲染过：不重拉，保留实时追加的气泡
    if (renderedConvForkId === forkId && messagesEl.children.length > 0) {
      scrollToBottom();
      return;
    }

    // 整块重渲染：先把上一批图的 objectURL 还掉，否则分页反复进出会累积泄漏
    revokeGenImageUrls();
    messagesEl.innerHTML = '';
    const records = (await Storage.getRecordsByFork(forkId).catch(() => [])) || [];
    records.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    // 缓存全量（时间升序）：上滑加载按下标往前切，不重复查库
    historyAllRecords = records;
    const total = records.length;
    // 初次只渲染最新一批；更早的等上滑到顶再按 STEP 追加
    const from = Math.max(0, total - HISTORY_PAGE_INITIAL);
    historyRenderedFrom = from;
    renderHistoryRange(from, total);
    renderedConvForkId = forkId;
    scrollToBottom();
  }

  /* ===================== 生图执行（DECK 版） =====================
     为什么不直接用助手页的 runImageGenAction：它把「生成中占位行」与「成图行」
     都写死挂在助手页 messagesWrap 上，从 DECK 调过去，图会落进一个看不见的容器，
     DECK 要等重开抽屉重拉历史才看得到。
     所以这里自己组装执行器，但每一个与数据相关的环节都走 SystemChatUI 导出的
     同一套函数（插槽配置 / 尺寸白名单 / 锁脸 / 归档 / 落库），只有「挂到哪个
     DOM」由本舱决定 —— 两端生出来的图在库里必须是同一种东西。

     占位机制与助手页同构：流式途中每出现一个闭合的 generate_image 标记就建一个
     loading 行（内核通过 renderer.genPlaceholder 调过来），流式结束后由生图动作
     按 FIFO 认领复用，使占位无缝变成成图；没被认领的在收尾统一清掉。
     ============================================================== */

  // 流式期间建立的「生成中」占位行队列，等生图动作按序认领
  let genPlaceholderRows = [];
  // 已就当前这轮 reply 建立的占位数量，避免每个 delta 重复建行
  let genPlaceholderShown = 0;

  /** 统计文本里已闭合的 generate_image 动作标记数量（口径同助手页） */
  function countCompletedImageActions(text) {
    const src = String(text || '');
    const re = /<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi;
    let count = 0;
    let m;
    while ((m = re.exec(src))) {
      const payload = String(m[1] || '').replace(/[“”]/g, '"').replace(/[‘’]/g, '"');
      if (/"type"\s*:\s*"generate_image"/i.test(payload) || /"action"\s*:\s*"generate_image"/i.test(payload)) {
        count += 1;
      }
    }
    return count;
  }

  /**
   * 造一行「生成中」占位。
   * 结构与成图行完全一致（.is-gen-image + .chat-gen-image），只是 figure 里先放
   * 加载波形 —— 这样认领时只需把图填进同一个 figure，不用换骨架，视觉上无缝。
   * @returns {{row:HTMLElement, figure:HTMLElement}}
   */
  function appendGenPlaceholderRow() {
    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant is-gen-image is-gen-pending';
    const figure = document.createElement('div');
    figure.className = 'chat-gen-image is-loading';
    figure.innerHTML = '<span class="chat-gen-spinner" aria-hidden="true"></span><span class="chat-gen-loading-text">RENDERING // 生成中</span>';
    row.appendChild(figure);
    if (messagesEl) {
      messagesEl.appendChild(row);
      scrollToBottom();
    }
    return { row, figure };
  }

  /** 内核流式回调：按已闭合标记数补齐占位，幂等不重复 */
  function maybeShowGenPlaceholder(rawText) {
    const enabled = !(window.SystemChatUI && typeof SystemChatUI.isImageGenEnabled === 'function')
      || SystemChatUI.isImageGenEnabled();
    if (!enabled) return;
    const completed = countCompletedImageActions(rawText);
    while (genPlaceholderShown < completed) {
      genPlaceholderRows.push(appendGenPlaceholderRow());
      genPlaceholderShown += 1;
    }
  }

  /** FIFO 取一个待认领的占位 */
  function takeGenPlaceholder() {
    return genPlaceholderRows.length ? genPlaceholderRows.shift() : null;
  }

  /** 清掉所有未被认领的占位并复位计数（每轮回复收尾调用） */
  function resetGenPlaceholders() {
    genPlaceholderRows.forEach((p) => {
      if (p && p.row && p.row.parentNode) p.row.remove();
    });
    genPlaceholderRows = [];
    genPlaceholderShown = 0;
  }

  /**
   * 跑一次生图：占位 → 调 API（文生图 / 档案锁脸）→ 归档图库 → 落库 → 成图。
   * 任何一步失败都把占位撤掉并提示，绝不留一个永远转圈的行。
   */
  async function runDeckImageGen(action, existing) {
    const SC = window.SystemChatUI;
    if (!SC) return;

    const dropPlaceholder = () => {
      if (existing && existing.row && existing.row.parentNode) existing.row.remove();
    };
    const errText = (err) => (typeof SC.getApiErrorText === 'function'
      ? SC.getApiErrorText(err) : String((err && err.message) || err));

    if (typeof SC.isImageGenEnabled === 'function' && !SC.isImageGenEnabled()) {
      dropPlaceholder();
      return;
    }

    const prompt = String((action && (action.prompt || action.description)) || '').trim();
    if (!prompt) {
      dropPlaceholder();
      return;
    }

    const cfg = typeof SC.getImageSlotConfig === 'function' ? SC.getImageSlotConfig() : null;
    if (!cfg) {
      dropPlaceholder();
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'IMAGE // 未配置',
          message: '尚未配置图像生成节点，无法生图',
          detail: '请前往 API 引擎配置图像生成插槽。',
          type: 'warning'
        });
      }
      return;
    }

    const size = typeof SC.normalizeImageSize === 'function'
      ? SC.normalizeImageSize(action.size) : '1024x1024';
    const ratioHint = typeof SC.ratioHintForSize === 'function'
      ? SC.ratioHintForSize(size) : undefined;

    // 档案锁脸：按 target 取外貌描述 + FACE ID 参考图
    let appearance = '';
    let faceRef = null;
    if (typeof SC.resolveGenTarget === 'function') {
      try {
        const resolved = await SC.resolveGenTarget(action.target);
        appearance = (resolved && resolved.appearance) || '';
        faceRef = (resolved && resolved.faceRef) || null;
      } catch (_) { appearance = ''; faceRef = null; }
    }

    // 档案外貌在前、动作 prompt 在后（全局正向词由 api-core 内部拼）
    const finalPrompt = [appearance, prompt].filter(Boolean).join(', ');

    // 占位：优先认领流式期间建好的那个，否则现建一个
    const holder = existing || appendGenPlaceholderRow();

    let res = null;
    try {
      if (faceRef) {
        res = await RetroflowAPI.generateImageEdit(cfg, faceRef, { prompt: finalPrompt, size, ratioHint, logTag: 'DECK 助手舱 · 锁脸生图' });
      } else {
        res = await RetroflowAPI.generateImage(cfg, { prompt: finalPrompt, size, ratioHint, logTag: 'DECK 助手舱 · 生图' });
      }
      if (!res || !res.image) throw new Error('服务端未返回图像');
    } catch (err) {
      if (holder.row && holder.row.parentNode) holder.row.remove();
      if (window.RetroToast) {
        RetroToast.show({ tag: 'IMAGE // 生成失败', message: errText(err), type: 'warning' });
      }
      return;
    } finally {
      // 参考图是 objectURL，用完必须还掉
      if (faceRef && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
        try { Storage.revokeAssetSrc(faceRef); } catch (_) {}
      }
    }

    const recordId = typeof SC.makeChatRecordId === 'function'
      ? SC.makeChatRecordId()
      : `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const messageGroupId = `chatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = Date.now();

    // 归档进图库（系统助手生成相册），拿到 assetKey
    let entry = null;
    try {
      if (!window.GalleryStore || typeof GalleryStore.record !== 'function') {
        throw new Error('图库归档模块尚未加载');
      }
      entry = await GalleryStore.record(res.image, {
        source: 'assistant-generation',
        chatRecordId: recordId,
        category: 'chat-cache',
        ownerType: 'assistant',
        ownerId: GalleryStore.SYSTEM_ASSISTANT_OWNER_ID,
        ownerName: '系统助手'
      });
      if (!entry) throw new Error('影像归档失败');
    } catch (err) {
      if (holder.row && holder.row.parentNode) holder.row.remove();
      if (window.RetroToast) {
        RetroToast.show({ tag: 'IMAGE // 归档失败', message: errText(err), type: 'warning' });
      }
      return;
    }

    const media = {
      type: 'image',
      galleryId: entry.id,
      assetKey: entry.key,
      state: 'active',
      mime: entry.mime,
      prompt
    };

    // 落库。失败要回收图库资产，免得留下孤儿图
    let record = null;
    try {
      if (typeof SC.persistGeneratedImageMessage !== 'function') {
        throw new Error('生图落库函数未就绪');
      }
      record = await SC.persistGeneratedImageMessage(media, messageGroupId, recordId, createdAt);
    } catch (err) {
      if (window.GalleryStore && typeof GalleryStore.remove === 'function') {
        await GalleryStore.remove([entry.id]).catch(() => {});
      }
      if (holder.row && holder.row.parentNode) holder.row.remove();
      if (window.RetroToast) {
        RetroToast.show({ tag: 'IMAGE // 记录失败', message: errText(err), type: 'warning' });
      }
      return;
    }

    // 占位原地变成图：骨架一致，只填 figure，无跳动
    if (!holder.row || !holder.row.parentNode) return;
    holder.row.classList.remove('is-gen-pending');
    holder.row.dataset.recordId = recordId;
    holder.row.dataset.messageGroupId = messageGroupId;
    holder.row.dataset.createdAt = String(createdAt);
    holder.row.dataset.imagePrompt = prompt;
    holder.row.dataset.rawText = `[生成图] ${prompt}`;
    await fillGenImage(holder.figure, { assetKey: entry.key, state: 'active', prompt });

    // 长按菜单：与历史渲染的生图行一致
    bindLongPress(holder.figure, () => {
      const icons = (SC && SC.HUD_ICONS) || {};
      return [
        { key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(holder.row) },
        { key: 'view', zh: '查看描述', en: 'VIEW', icon: icons.edit || '', run: () => actionViewImageMeta(holder.row, true) },
        { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: icons.rewind || '', run: () => actionRewind(holder.row) },
        {
          key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true,
          run: () => actionDelete(holder.row, '该图像消息及其图库资产将被一并永久清除，无法撤销。')
        }
      ];
    });

    // 新记录并入全量缓存，让重写/回溯的范围计算立刻认得它
    if (record && record.id && !historyAllRecords.some((r) => r && String(r.id) === String(record.id))) {
      historyAllRecords.push(record);
    }
    scrollToBottom();
  }

  /**
   * 本舱的动作执行器，替内核默认的 executeAssistantActions。
   *
   * 只截走 generate_image 自己处理（为了把图挂进 DECK 流），其余动作类型
   * （换头像等）仍交回助手页那套 —— 它们与渲染无关，没必要在这里重写一遍。
   * 返回剥掉动作标记后的可见正文，口径由 executeAssistantActions 保证。
   */
  async function runDeckAssistantActions(rawText) {
    const SC = window.SystemChatUI;
    const src = String(rawText || '');

    // 解析出本轮的生图动作（与助手页同一套容错：中文引号、尾随逗号、代码围栏）
    const genActions = [];
    const re = /<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi;
    let m;
    while ((m = re.exec(src))) {
      let payload = String(m[1] || '').trim()
        .replace(/^```[a-z]*\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        const parsed = JSON.parse(payload);
        const type = String((parsed && (parsed.type || parsed.action)) || '').trim().toLowerCase();
        if (type === 'generate_image') genActions.push(parsed);
      } catch (_) { /* 非法 JSON 交给助手页那套去报错，这里只挑生图 */ }
    }

    // 生图是独立副作用，不阻塞正文落库（与助手页一致：不 await）
    genActions.forEach((action) => {
      runDeckImageGen(action, takeGenPlaceholder()).catch((err) => {
        console.warn('[ForkDeckAsst] 生图动作未执行：', err);
      });
    });

    // 其余动作 + 可见正文口径仍走助手页导出的那套。
    // 它内部会再执行一次非生图动作；生图分支由它自己的 runImageGenAction 处理，
    // 但那条路会把图挂到助手页容器 —— 所以必须让它看不到生图标记。
    const withoutGen = src.replace(
      /<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi,
      (full, payload) => {
        const p = String(payload || '').replace(/[“”]/g, '"').replace(/[‘’]/g, '"');
        const isGen = /"type"\s*:\s*"generate_image"/i.test(p)
          || /"action"\s*:\s*"generate_image"/i.test(p);
        return isGen ? '' : full;
      }
    );

    if (SC && typeof SC.executeAssistantActions === 'function') {
      return await SC.executeAssistantActions(withoutGen);
    }
    return stripActionTags(withoutGen);
  }

  /* ========================= 发送链路 ========================= */

  /**
   * DECK 版渲染适配器。接口与 AssistantChatCore 的约定一一对应，但 handle 是
   * 本舱自定义的 { row, content } —— 不是助手页的 appendMessage 句柄。
   * 气泡内部仍走 renderMarkdownInto，markdown / 思维链折叠全部继承既有样式。
   */
  function buildRenderer() {
    return {
      openBubble: (role, createdAt) => {
        const handle = createBubbleRow(role);
        setBubbleLoading(handle.content);
        messagesEl.appendChild(handle.row);
        scrollToBottom();
        return handle;
      },
      syncBubble: (handle, rawText, opts) => {
        if (!handle || !handle.content) return;
        // 带 cursor 的是流式中途帧 —— 走轻量纯文本，避免每帧重跑完整 markdown。
        // 不带 cursor 的是定稿帧 —— 做一次完整渲染，思维链 / 代码块一次成型。
        if (opts && opts.cursor) {
          renderStreamingInto(handle.content, rawText);
        } else {
          renderMarkdownInto(handle.content, rawText);
          // 定稿才是挂长按菜单的时机：此刻原文才完整，流式中途挂上去
          // 复制到的会是残句。菜单只挂一次，重复定稿（工具循环多轮）不重绑。
          if (handle.bubble) {
            handle.bubble.dataset.rawText = String(rawText || '');
            if (!handle.bubble.dataset.menuBound) {
              handle.bubble.dataset.menuBound = '1';
              attachBubbleMenu(handle);
            }
          }
        }
      },
      clearFirstChunk: (handle) => {
        if (handle && handle.content) handle.content.innerHTML = '';
      },
      bindRecord: (handle, record) => {
        if (handle && handle.row && record && record.id) {
          handle.row.dataset.recordId = record.id;
        }
        // 新落库的助手记录要进全量缓存：重写判定（canRewriteRecord）读的是它，
        // 不同步就会出现「刚回复完却说不能重写」。
        if (record && record.id && !historyAllRecords.some((r) => r && String(r.id) === String(record.id))) {
          historyAllRecords.push(record);
        }
      },
      dropBubble: (handle) => {
        if (handle && handle.row && handle.row.parentNode) handle.row.remove();
      },
      toolCard: (info) => {
        if (!messagesEl) return;
        messagesEl.appendChild(createToolCard(info));
        scrollToBottom();
      },
      scrollToBottom,
      // 生图占位：内核流式检测到 generate_image 标记时调过来，建 DECK 的 loading 行；
      // 收尾清掉未被生图动作认领的多余占位。真正的生成与成图在 runDeckImageGen。
      genPlaceholder: (rawText) => { maybeShowGenPlaceholder(rawText); },
      resetGenPlaceholder: () => { resetGenPlaceholders(); }
    };
  }

/**
   * DECK 版业务动作适配器。
   *
   * 注意：传了 actions 就会整体顶掉助手页那套默认实现（requestAssistantReply 里是
   * 整体 || 替换，不是逐项合并），所以工具链四项必须一并原样接上，否则 DECK 的
   * 文件工具、工具卡文案、收尾通知会一起失效。
   * 唯一真正改掉的是 runOtherActions —— 换成本舱版本，把生图截走自己渲染。
   */
  function buildActions() {
    const SC = window.SystemChatUI;
    return {
      isToolAction: (action) => (typeof SC.isFileToolAction === 'function'
        ? SC.isFileToolAction(action) : false),
      runTool: (action) => (typeof SC.runFileTool === 'function'
        ? SC.runFileTool(action) : null),
      runOtherActions: (rawText) => runDeckAssistantActions(rawText),
      toolCardTag: (name, status) => (typeof SC.toolCardTag === 'function'
        ? SC.toolCardTag(name, status) : 'TOOL'),
      replyNotice: (record, text) => (typeof SC.pushSystemReplyNotice === 'function'
        ? SC.pushSystemReplyNotice(record, text) : undefined)
    };
  }

  /** DECK 版生命周期钩子：持有本舱自己的中断控制器、切换 INFER 按钮形态。 */
  function buildHooks() {
    return {
      onInferStart: (controller) => {
        activeAbortController = controller;
        // 推理态挂在 INFER 按钮上 —— 它才是中断入口（再点一次 = 终止本轮）。
        // 发送按钮同步灰掉：推理途中上屏新消息会让本轮上下文中途变化。
        if (inferBtnEl) inferBtnEl.classList.add('is-inferring');
        if (sendBtnEl) sendBtnEl.classList.add('is-disabled');
      },
      onInferEnd: () => {
        activeAbortController = null;
        if (inferBtnEl) inferBtnEl.classList.remove('is-inferring');
        if (sendBtnEl) sendBtnEl.classList.remove('is-disabled');
      }
    };
  }

  /* ===================== 发图识图（DECK 版） =====================
     与助手页同构：选图 → 压缩 → 待发队列 + 预览条 → 发送时每张图归档落库
     （state:'pending'）→ 上屏图行 → 异步识图（recognizeImage 走 vision 插槽，
     未配回退主模型）→ 回写 visionDescription + state。识图描述由共用的
     buildChatHistory 作为「[用户发送的图片] 图片内容：...」注入上下文，主模型读
     文字即可，DECK 不需要自己拼视觉上下文。
     ============================================================== */

  // 待发图片队列，元素 { blob, objectUrl }，与助手页 pendingImages 同形
  let pendingImages = [];
  let previewBarEl = null;

  /** 统一错误文案（走 SystemChatUI.getApiErrorText，缺失则回退 message） */
  function visionErrText(err) {
    const SC = window.SystemChatUI;
    return (SC && typeof SC.getApiErrorText === 'function')
      ? SC.getApiErrorText(err) : String((err && err.message) || err);
  }

  /** 清空待发队列并撤销所有 objectURL，移除预览条 */
  function clearPendingImages() {
    pendingImages.forEach((it) => {
      if (it && it.objectUrl) { try { URL.revokeObjectURL(it.objectUrl); } catch (_) {} }
    });
    pendingImages = [];
    if (previewBarEl) { previewBarEl.remove(); previewBarEl = null; }
  }

  /** 从队列移除单张，同步刷新预览条 */
  function removePendingImage(index) {
    if (index < 0 || index >= pendingImages.length) return;
    const removed = pendingImages.splice(index, 1)[0];
    if (removed && removed.objectUrl) { try { URL.revokeObjectURL(removed.objectUrl); } catch (_) {} }
    renderPendingImages();
  }

  /** 渲染/刷新卡片内预览条（挂在 textarea 之上，缩略图带删除角标，零分割线） */
  function renderPendingImages() {
    const card = document.getElementById('forkDeckAsstCard');
    if (!card) return;
    if (!pendingImages.length) {
      if (previewBarEl) { previewBarEl.remove(); previewBarEl = null; }
      return;
    }
    if (!previewBarEl) {
      previewBarEl = document.createElement('div');
      previewBarEl.className = 'fork-asst-preview-bar';
      // 预览条插在卡片最前（textarea 上方）
      card.insertBefore(previewBarEl, card.firstChild);
    }
    previewBarEl.innerHTML = '';
    pendingImages.forEach((it, idx) => {
      const thumb = document.createElement('div');
      thumb.className = 'fork-asst-preview-thumb';
      const img = document.createElement('img');
      img.src = it.objectUrl;
      img.alt = '待发送影像';
      thumb.appendChild(img);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fork-asst-preview-del';
      del.setAttribute('aria-label', '移除此图');
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      del.addEventListener('click', (e) => { e.stopPropagation(); removePendingImage(idx); });
      thumb.appendChild(del);
      previewBarEl.appendChild(thumb);
    });
  }

  /** 图片按钮入口：复用全局 ImagePicker 多选，压缩后进待发队列 */
  async function selectImages() {
    if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'VISION // 不可用', message: '图片选择器尚未加载', type: 'warning' });
      }
      return;
    }
    ImagePicker.open({
      title: '发送影像给系统助手',
      multiple: true,
      onSelect: async (result) => {
        try {
          const blobs = [];
          if (result && result.type === 'file' && result.file) {
            blobs.push(result.file);
          } else if (result && result.type === 'files' && Array.isArray(result.files)) {
            blobs.push(...result.files);
          } else if (result && result.type === 'url' && result.url) {
            const resp = await fetch(result.url);
            if (!resp.ok) throw new Error('远端图片读取失败');
            blobs.push(await resp.blob());
          } else if (result && result.type === 'urls' && Array.isArray(result.urls)) {
            for (const u of result.urls) {
              const r = await fetch(u);
              if (r.ok) blobs.push(await r.blob());
            }
          }
          const valid = blobs.filter((b) => b && String(b.type || '').startsWith('image/'));
          if (!valid.length) throw new Error('请选择有效的图片文件');
          for (const b of valid) {
            const compressed = (window.Storage && typeof Storage.compressImage === 'function')
              ? await Storage.compressImage(b, 1600, 0.84)
              : b;
            const objectUrl = URL.createObjectURL(compressed);
            pendingImages.push({ blob: compressed, objectUrl });
          }
          renderPendingImages();
        } catch (err) {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'VISION // LOAD FAILED', message: visionErrText(err), type: 'warning' });
          }
        }
      }
    });
  }

  /**
   * 发送阶段的发图处理：对每张待发图归档 + 落库 + 上屏 + 起异步识图。
   * @param {string} text 随图文字（可空），用于识图提示与随后独立文字记录
   * @returns {Promise<boolean>} true 表示本次是带图发送（text 已被消费为随图文字）
   */
  async function sendPendingImages(text, createdAt) {
    const SC = window.SystemChatUI;
    if (!pendingImages.length) return false;
    if (!window.GalleryStore || typeof GalleryStore.record !== 'function'
      || typeof SC.persistImageChatMessage !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'VISION // 不可用', message: '图库或落库模块尚未就绪', type: 'warning' });
      }
      return false;
    }

    const blobs = pendingImages.map((it) => it.blob);
    clearPendingImages();

    const messageGroupId = `chatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const galleryEntries = [];
    const visionTasks = [];

    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const imageRecordId = (typeof SC.makeChatRecordId === 'function')
        ? SC.makeChatRecordId() : `rec_${Date.now()}_${i}`;
      let entry = null;
      try {
        entry = await GalleryStore.record(blob, {
          source: 'system-chat', chatRecordId: imageRecordId, category: 'chat-cache',
          ownerType: 'assistant', ownerId: GalleryStore.SYSTEM_ASSISTANT_OWNER_ID,
          ownerName: '系统助手'
        });
        if (!entry) throw new Error('影像归档失败');
      } catch (err) {
        if (window.RetroToast) RetroToast.show({ tag: 'VISION // 归档失败', message: visionErrText(err), type: 'warning' });
        continue;
      }
      galleryEntries.push(entry);

      const media = {
        type: 'image', galleryId: entry.id, assetKey: entry.key,
        state: 'pending', mime: entry.mime, visionDescription: ''
      };

      let imgRec = null;
      try {
        imgRec = await SC.persistImageChatMessage(media, messageGroupId, imageRecordId, Date.now() + i);
        if (!imgRec) throw new Error('图片消息落库失败');
      } catch (err) {
        await GalleryStore.remove([entry.id]).catch(() => {});
        if (window.RetroToast) RetroToast.show({ tag: 'VISION // 落库失败', message: visionErrText(err), type: 'warning' });
        continue;
      }
      if (imgRec && imgRec.id && !historyAllRecords.some((r) => r && String(r.id) === String(imgRec.id))) {
        historyAllRecords.push(imgRec);
      }

      // 上屏图行（复用历史渲染的用户图样式）
      const row = appendUserImageRow(media, imgRec.id, messageGroupId, imgRec.createdAt);
      visionTasks.push({ blob, text, recordId: imgRec.id, media, row });
    }

    // 带图时的随图文字作为独立 user 记录跟在图后面（与助手页一致）
    if (text) {
      try {
        const txtRec = await SC.persistChatMessage('user', text, null, '', Date.now() + blobs.length, null, messageGroupId);
        if (txtRec && txtRec.id) {
          const handle = createBubbleRow('user');
          renderMarkdownInto(handle.content, text);
          handle.bubble.dataset.rawText = text;
          handle.row.dataset.recordId = txtRec.id;
          attachBubbleMenu(handle);
          messagesEl.appendChild(handle.row);
          historyAllRecords.push(txtRec);
        }
      } catch (_) { /* 文字落库失败不阻断图流程 */ }
    }
    scrollToBottom();

    // 异步识图：发完才跑，不阻塞发送手感（口径与助手页 visionTasks 一致）
    visionTasks.forEach((vt) => {
      void (async () => {
        try {
          const description = await SC.recognizeImage(vt.blob, vt.text);
          const med = { ...vt.media, state: 'done', visionDescription: description };
          await SC.persistImageChatMessage(med, messageGroupId, vt.recordId, Date.now());
          const idx = historyAllRecords.findIndex((r) => r && String(r.id) === String(vt.recordId));
          if (idx >= 0) historyAllRecords[idx] = { ...historyAllRecords[idx], imageRef: med };
          // 识图结果缓存到行 dataset，供长按「查看描述」只读读取
          if (vt.row && vt.row.dataset) vt.row.dataset.visionDescription = String(description || '');
          setDeckVisionRowState(vt.row, 'done');
        } catch (_) {
          const med = { ...vt.media, state: 'failed', visionDescription: '' };
          await SC.persistImageChatMessage(med, messageGroupId, vt.recordId, Date.now()).catch(() => {});
          setDeckVisionRowState(vt.row, 'failed');
        }
      })();
    });
    return true;
  }

  /** 造一个用户图行并挂上屏（骨架同历史渲染，带识图中标记） */
  function appendUserImageRow(media, recordId, messageGroupId, createdAt) {
    const row = document.createElement('div');
    row.className = 'chat-msg-row user is-vision-pending';
    if (recordId) row.dataset.recordId = recordId;
    if (messageGroupId) row.dataset.messageGroupId = messageGroupId;
    if (createdAt) row.dataset.createdAt = String(createdAt);

    // 图 figure：直接填真图（本地 blob 立刻可取），不占 loading 骨架 ——
    // 识别中的提示交给下面独立的状态条，避免真图把 spinner 瞬间顶掉导致看不见。
    const figure = document.createElement('div');
    figure.className = 'chat-gen-image';
    fillGenImage(figure, {
      assetKey: String(media.assetKey || ''),
      state: String(media.state || 'active'),
      owner: 'user'
    });

    // 识别中状态条：独立于图，识图完成/失败由 setDeckVisionRowState 控制显隐
    const visionTag = document.createElement('div');
    visionTag.className = 'fork-asst-vision-tag';
    visionTag.innerHTML = '<span class="chat-gen-spinner" aria-hidden="true"></span><span class="fork-asst-vision-tag-text">VISION // 识别中</span>';

    const stack = document.createElement('div');
    stack.className = 'chat-user-media-stack';
    stack.append(figure, visionTag);
    row.appendChild(stack);

    bindLongPress(figure, () => {
      const icons = (window.SystemChatUI && SystemChatUI.HUD_ICONS) || {};
      return [
        { key: 'select', zh: '多选', en: 'SELECT', icon: icons.select || '', run: () => enterBatchMode(row) },
        { key: 'view', zh: '查看描述', en: 'VIEW', icon: icons.edit || '', run: () => actionViewImageMeta(row, false) },
        { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: icons.rewind || '', run: () => actionRewind(row) },
        {
          key: 'delete', zh: '删除', en: 'PURGE', icon: icons.delete || '', isDanger: true,
          run: () => actionDelete(row, '该图像消息及其图库资产将被一并永久清除，无法撤销。')
        }
      ];
    });

    messagesEl.appendChild(row);
    return row;
  }

  /** 识图状态行标记：成功撤掉识别中态并移除状态条，失败换成失败文案 */
  function setDeckVisionRowState(row, state) {
    if (!row) return;
    row.classList.remove('is-vision-pending');
    const tag = row.querySelector('.fork-asst-vision-tag');
    if (state === 'failed') {
      row.classList.add('is-vision-failed');
      if (tag) {
        tag.innerHTML = '<span class="fork-asst-vision-tag-text">VISION // 识别失败</span>';
      }
    } else if (tag) {
      tag.remove();
    }
  }

  /**
   * 发送：只把用户消息上屏 + 落库，不请求模型。
   *
   * 这是刻意的解耦，与溯流空间助手页的 handleSend 行为一致 ——
   * 「发送」只负责把话记进流水，「INFER」才是向模型要回应的那一下。
   * 好处是可以连发几条再一次性让助手回应，也可以发完先不要回应。
   */
  async function send() {
    if (!depsReady()) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'ASST // OFFLINE', message: '系统助手模块尚未就绪', type: 'warning' });
      }
      return;
    }
    // 推理进行中不让上屏新消息：那会让本轮上下文在请求途中变化
    if (activeAbortController) return;

    const text = (textareaEl.value || '').trim();
    // 纯图也可发：有图或有文字即可，两者皆空才拦下
    if (!text && !pendingImages.length) return;

    textareaEl.value = '';
    autoResize();

    await SystemChatUI.ensureConvReady();

    // 有待发图：走发图识图链路（图归档落库 + 上屏 + 异步识图），随图文字由它一并处理
    if (pendingImages.length) {
      await sendPendingImages(text, Date.now());
      return;
    }

    // 用户气泡即时上屏
    const createdAt = Date.now();
    const handle = createBubbleRow('user');
    renderMarkdownInto(handle.content, text);
    handle.bubble.dataset.rawText = text;
    attachBubbleMenu(handle);
    messagesEl.appendChild(handle.row);
    scrollToBottom();

    // 落库用户消息（与助手页同一张表、同一套字段）
    try {
      const userRecord = await SystemChatUI.persistChatMessage('user', text, null, '', createdAt, null, null);
      if (userRecord && userRecord.id) {
        handle.row.dataset.recordId = userRecord.id;
        // 刚落库这条也要进全量缓存，否则上滑加载的分页下标会和库对不上
        historyAllRecords.push(userRecord);
      }
    } catch (err) {
      console.warn('[ForkDeckAsst] 用户消息落库失败：', err);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CHAT RECORD // SAVE ERROR', message: '消息未能写入流水', type: 'warning' });
      }
    }
  }

  /**
   * INFER：向模型要一轮回应。
   *
   * 两种语义，与助手页 handleInfer 完全一致：
   *   · 输入框里还有草稿 —— 把草稿作为本轮用户输入带进上下文（不另外上屏落库，
   *     因为它是"这一句我还没发，但你先按它回"的临时输入，口径同助手页）。
   *   · 输入框是空的 且 历史尾部没有待回应的用户消息 —— 拼一条阅后即焚的延续指令，
   *     让助手接着刚才的话题说下去。这就是「继续」，不落库、不上屏。
   *     判定复用助手页导出的 historyEndsWithUnansweredUser，两端永远同口径：
   *     用户刚发过消息再点 INFER → 直接对那条消息回复，不拼指令。
   * 推理进行中再点 = 中断本轮。
   */
  async function infer() {
    if (!depsReady()) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'ASST // OFFLINE', message: '系统助手模块尚未就绪', type: 'warning' });
      }
      return;
    }

    // 推理中点 INFER = 中断
    if (activeAbortController) {
      try { activeAbortController.abort(); } catch (_) {}
      return;
    }

    await SystemChatUI.ensureConvReady();

    let history = [];
    try {
      history = await SystemChatUI.buildChatHistory();
    } catch (err) {
      console.warn('[ForkDeckAsst] 上下文装配失败：', err);
      return;
    }

    const draft = (textareaEl.value || '').trim();
    if (draft) {
      // 有草稿：作为本轮输入临时带上（与助手页 hasUnsentDraft 分支同口径）
      history.push({ role: 'user', content: draft });
    } else if (typeof SystemChatUI.buildSilentContinuationInstruction === 'function'
      && !(typeof SystemChatUI.historyEndsWithUnansweredUser === 'function'
        && SystemChatUI.historyEndsWithUnansweredUser(history))) {
      // 空输入 且 尾部没有未回应的用户消息：延续指令，让助手接着说。阅后即焚，不落库不上屏。
      // 尾部判定函数缺失（理论上不会，防御性兜底）时退回旧行为，保证「继续」永远可用。
      history.push({ role: 'user', content: SystemChatUI.buildSilentContinuationInstruction() });
    }

    try {
      await SystemChatUI.requestAssistantReply(history, {
        renderer: buildRenderer(),
        actions: buildActions(),
        hooks: buildHooks()
      });
    } catch (err) {
      const isAbort = err && (err.name === 'AbortError'
        || /aborted a request/.test(String(err.message || '')));
      if (!isAbort) {
        console.warn('[ForkDeckAsst] 应答失败：', err);
        if (window.RetroToast) {
          const detail = (window.SystemChatUI && typeof SystemChatUI.getApiErrorText === 'function')
            ? SystemChatUI.getApiErrorText(err) : String(err && err.message || err);
          RetroToast.show({ tag: 'ASST // FAILED', message: `应答失败：${detail}`, type: 'warning' });
        }
      }
    }
  }

  /* ========================= 输入框自适应高度 ========================= */

  function autoResize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = Math.min(textareaEl.scrollHeight, 120) + 'px';
  }

  /* ========================= 事件绑定 ========================= */

  function bindEvents() {
    if (sendBtnEl) {
      sendBtnEl.addEventListener('click', () => { send(); });
    }
    if (inferBtnEl) {
      inferBtnEl.addEventListener('click', () => { infer(); });
    }

    // 左侧媒体工具按钮占位：点击给出机能规划提示，不留空操作死链
    const emoteBtn = document.getElementById('forkDeckAsstEmoteBtn');
    const imageBtn = document.getElementById('forkDeckAsstImageBtn');
    const fileBtn = document.getElementById('forkDeckAsstFileBtn');
    const notifyStub = (tag, message) => {
      if (window.RetroToast) {
        RetroToast.show({ tag, message, type: 'info' });
      }
    };
    if (emoteBtn) {
      emoteBtn.addEventListener('click', () => notifyStub('EMOTES // 待接入', '随行系统助手表情交互模组即将上线'));
    }
    if (imageBtn) {
      imageBtn.addEventListener('click', () => { selectImages(); });
    }
    if (fileBtn) {
      fileBtn.addEventListener('click', () => notifyStub('FILE // 待接入', '卷宗战术文档附件通道待后续版本打通'));
    }

    // 对话设置：跳系统助手对话设置页（栈协调由 fork-run-ui 的 openAsstSettings 承担，
    // 返回自然回落推演页，不回 DECK 抽屉）。
    const settingsBtn = document.getElementById('forkDeckAsstSettingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        if (window.ForkRunUI && typeof ForkRunUI.openAsstSettings === 'function') {
          ForkRunUI.openAsstSettings();
        } else if (window.SystemChatSettings && typeof SystemChatSettings.open === 'function') {
          // 兜底：无跨页协调时直接开（极端情况下栈可能多一层，功能不断）
          SystemChatSettings.open();
        }
      });
    }
    if (textareaEl) {
      textareaEl.addEventListener('input', autoResize);
      // 回车 = 发送上屏（不触发推理），与助手页口径一致：想要回应得点闪电。
      // Shift+回车换行；移动端软键盘的 Enter 一般是换行，不拦。
      textareaEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          const isTouch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
          if (!isTouch) {
            e.preventDefault();
            send();
          }
        }
      });
    }
  }

  /* ========================= 对外接口 ========================= */

  /**
   * 打开随行助手舱。渲染（或增量复用）历史后聚焦输入框。
   * 返回 true 表示 DOM 就绪、可切轨道；false 表示结构缺失（调用方不该切）。
   */
  async function open() {
    if (!grabDom()) return false;
    try {
      await renderHistory();
    } catch (err) {
      console.warn('[ForkDeckAsst] 历史渲染失败：', err);
    }
    return true;
  }

  /** 关闭随行助手舱。只收数据状态，轨道平移由 fork-run-ui 的 is-asst-mode 处理。 */
  function close() {
    // 不清空消息流 —— 保留以便下次秒开；renderedConvForkId 守住增量复用
  }

  /** 活跃对话被切走时，强制下次 open 重拉（供助手页改 activeConv 后调用，可选） */
  function invalidate() {
    renderedConvForkId = null;
  }

  return {
    open,
    close,
    invalidate,
    // 批量态查询 / 退出：供 fork-run-ui 的返回键逐级处理
    // （批量态开着时，返回键先退批量态，而不是关整个助手舱）
    isBatchMode: () => isBatchMode,
    exitBatchMode: () => { if (isBatchMode) exitBatchMode(); }
  };
})();
