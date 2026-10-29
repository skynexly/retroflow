/**
 * 溯流计划 · 系统助理聊天视窗控制器 (System Chat UI Controller)
 * 1. 管理系统聊天页的平滑滑入/退出
 * 2. 浮空输入窗的高度自适应与文本监听
 * 3. 关联底部 DOCK 栏耳机呼叫系统动作
 */
(() => {
  const chatPage = document.getElementById('systemChatPage');
  const backBtn = document.getElementById('systemChatBackBtn');
  const textarea = document.getElementById('systemChatTextarea');
  const sendBtn = document.getElementById('systemChatSendBtn');
  const plusBtn = document.getElementById('systemChatPlusBtn');
  const menuBtn = document.getElementById('systemChatMenuBtn');
  const aiRespBtn = document.getElementById('systemChatAiRespBtn');
  const expandBtn = document.getElementById('systemChatExpandBtn');
  const dockPanel = document.getElementById('systemChatDockPanel');
  const messagesWrap = document.getElementById('systemChatMessages');
  const chatBody = document.getElementById('systemChatBody');
  const quoteDraftBar = document.getElementById('chatQuoteDraftBar');
  const quoteDraftTag = document.getElementById('chatQuoteDraftTag');
  const quoteDraftSnippet = document.getElementById('chatQuoteDraftSnippet');
  const quoteDraftClose = document.getElementById('chatQuoteDraftClose');

  // 战术双向跳跃槽 DOM
  const jumpDeck = document.getElementById('chatJumpDeck');
  const jumpTopBtn = document.getElementById('chatJumpTopBtn');
  const jumpBottomBtn = document.getElementById('chatJumpBottomBtn');

  // 多选批量操作模式相关 DOM
  const batchCancelBtn = document.getElementById('systemChatBatchCancelBtn');
  const batchSelectAllBtn = document.getElementById('systemChatBatchSelectAllBtn');
  const headerTitle = document.getElementById('systemChatHeaderTitle');
  const headerStatus = document.getElementById('systemChatHeaderStatus');
  const batchDock = document.getElementById('systemChatBatchDock');
  const batchDeleteBtn = document.getElementById('systemChatBatchDeleteBtn');
  const batchDeleteCount = document.getElementById('systemChatBatchDeleteCount');
  const batchExportBtn = document.getElementById('systemChatBatchExportBtn');
  const batchQuoteBtn = document.getElementById('systemChatBatchQuoteBtn');

  let currentQuotePayload = null;
  let isBatchMode = false;
  let selectedRows = new Set();
  // 可被多选/回溯/上下文统一纳管的行口径。
  // 消息气泡、撤回胶囊、工具调用胶囊三类都算「一等公民」：能进上下文，就必须能被删除。
  // 三处消费方（全选、回溯、buildChatHistory）共用此常量，避免再次出现「读得到却删不掉」的孤儿卡片。
  const SELECTABLE_ROW_SELECTOR = '.chat-msg-row, .chat-status-pill-row[data-system-notice="true"], .chat-status-pill-row[data-tool-call="true"]';
  // 当前对话的流水 forkId。多对话后不再是常量 —— 切换对话时由
  // applyActiveConv() 改写成 `system-chat:{convId}`。
  // 初值沿用历史遗留的 main，保证 SystemChatStore 还没初始化完时读到的也是老数据。
  let SYSTEM_CHAT_FORK_ID = 'system-chat:main';
  /** 当前对话 id 与元信息。标题用于眉栏展示 */
  let currentConvId = 'main';
  let currentConv = null;
  const SYSTEM_CHAT_RECORD_KIND = 'system_chat_message';
  const SYSTEM_CHAT_NOTICE_KIND = 'system_chat_notice';
  let historyRestorePromise = null;
  let isRestoringHistory = false;
  // 渲染分页：进入只渲染最新一批，上滑到顶再往前追加更早的批次。
  // 上下文（buildChatHistory）已改从存储读全量，与渲染彻底解耦，分页不会让助手失忆。
  const HISTORY_PAGE_INITIAL = 50; // 初次进入渲染的最新条数
  const HISTORY_PAGE_STEP = 30;    // 每次上滑追加的更早条数
  let historyAllRecords = [];      // 本次会话缓存的全量记录（时间升序）
  let historyRenderedFrom = 0;     // 已渲染区间的起始下标（historyAllRecords 中）；0 表示已到最早
  let isLoadingMoreHistory = false; // 上滑加载重入锁
  let pendingProgrammaticBack = false;
  // 是否从线上联络消息列表进入：决定返回时要不要把列表页复位到下层当底衬
  let enteredFromOnlineList = false;
  let pendingImages = []; // 元素为 { blob, objectUrl }
  let imagePreviewBar = null;
  // 待发送文件（来自文件区选择），元素为 { id, name, sizeText, charCount }
  let pendingFiles = [];
  let filePreviewBar = null;
  // 最近一次真实发出的上下文快照（调试查看用）。写入点见 fitMessagesToContext，
  // 读取方是上下文查看器；仅内存驻留，不落库，刷新即清。
  let lastContextSnapshot = null;
  // 文件工具循环上限的兜底默认值（实际生效值读对话设置里的 toolLoopLimit）
  const FILE_TOOL_LOOP_LIMIT = 10;
  // 历史工具结果保留轮数的兜底默认值（实际生效值读 toolResultKeepTurns）
  const TOOL_RESULT_KEEP_TURNS = 3;

  /** 读取对话设置里的工具循环上限 */
  function getToolLoopLimit() {
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : null;
    const val = s && parseInt(s.toolLoopLimit, 10);
    return Number.isFinite(val) && val >= 1 ? val : FILE_TOOL_LOOP_LIMIT;
  }

  /** 读取对话设置里的工具结果保留轮数 */
  function getToolResultKeepTurns() {
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : null;
    const val = s && parseInt(s.toolResultKeepTurns, 10);
    return Number.isFinite(val) && val >= 1 ? val : TOOL_RESULT_KEEP_TURNS;
  }
  // 单文件全文注入上下文的硬上限，超出则提示助手用工具分页读取
  const FILE_INLINE_CHAR_LIMIT = 60000;
  // 助手 read_file 单次返回的分页硬上限
  const FILE_TOOL_PAGE_CHARS = 30000;

  // 副本场景下注入助手上下文的副本原文轮数（固定保留、不参与裁剪）。
  // 更早的剧情由 recap 摘要兜底全程视野，原文只补最近 N 轮的细节质感。
  // 手感不够时直接调大此值即可（例如 10 → 20）。
  const FORK_RAW_TURNS = 10;

  /**
   * 取当前副本场景上下文：仅在副本页打开（ForkRunUI.isOpen）时非空。
   * 日常助手页返回 null，助手上下文回落日常模式。
   * 供 buildChatHistory（注入原文）与 buildSystemPrompt / buildDepthInjection（切场景）共用。
   * @returns {Object|null} { fork, envoyCtx, missionCtx, runId }
   */
  function getForkSceneCtx() {
    if (!window.ForkRunUI || typeof ForkRunUI.buildAsstSceneCtx !== 'function') return null;
    try {
      return ForkRunUI.buildAsstSceneCtx();
    } catch (_) {
      return null;
    }
  }

  const IMAGE_PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4V4zm2 2v9.17l2.59-2.58L12 16l2.59-2.59L18 16.83V6H6zm3.5 5A1.5 1.5 0 109.5 8a1.5 1.5 0 000 3z"/><path d="M5.41 4L20 18.59 18.59 20 4 5.41 5.41 4z"/></svg>`;

  // TTS 单例播放状态：同一时间只允许一条助手语音占用播放器
  let chatTtsAudio = null;
  let chatTtsRequestId = 0;
  let chatTtsBubble = null;
  let chatTtsBusy = false;

  function getChatTtsAudio() {
    if (!chatTtsAudio) {
      // 使用 HTMLMediaElement，兼容 iOS 静音拨键与 PWA 媒体播放策略
      chatTtsAudio = new Audio();
      chatTtsAudio.preload = 'auto';
      chatTtsAudio.addEventListener('ended', () => {
        if (chatTtsBubble) chatTtsBubble.classList.remove('is-tts-playing');
        chatTtsBubble = null;
        chatTtsBusy = false;
      });
      chatTtsAudio.addEventListener('error', () => {
        if (chatTtsBubble) chatTtsBubble.classList.remove('is-tts-playing');
        chatTtsBubble = null;
        chatTtsBusy = false;
      });
    }
    return chatTtsAudio;
  }

  function stopChatTts() {
    chatTtsRequestId += 1;
    chatTtsBusy = false;
    if (chatTtsAudio) {
      try {
        chatTtsAudio.pause();
        chatTtsAudio.currentTime = 0;
        chatTtsAudio.removeAttribute('src');
        chatTtsAudio.load();
      } catch (_) {}
    }
    if (chatTtsBubble) {
      chatTtsBubble.classList.remove('is-tts-playing');
      chatTtsBubble.classList.remove('is-tts-loading');
    }
    chatTtsBubble = null;
  }

  function getTtsConfig() {
    try {
      // TTS 是独立 MiniMax 插槽，不能把主模型的 OpenAI 配置误当成语音配置
      if (window.RetroflowApiUI && typeof RetroflowApiUI.getSlot === 'function') {
        return RetroflowApiUI.getSlot('tts') || null;
      }
    } catch (_) {}
    return null;
  }

  function getSpeechText(bubble, fallbackText) {
    const raw = bubble && typeof bubble.dataset.segmentText === 'string' && bubble.dataset.segmentText
      ? bubble.dataset.segmentText
      : ((bubble && typeof bubble.dataset.rawText === 'string') ? bubble.dataset.rawText : fallbackText);
    return (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripMarkdown === 'function')
      ? RetroflowMarkdown.stripMarkdown(raw)
      : String(raw || '').trim();
  }

  async function speakAssistantBubble(bubble, fallbackText) {
    const cleanText = getSpeechText(bubble, fallbackText);
    if (!cleanText) {
      if (window.RetroToast) RetroToast.show({ tag: 'TTS // 空内容', message: '当前消息没有可朗读的纯文本', type: 'info' });
      return;
    }

    // 再次点击当前正在合成或播放的气泡：停止，不重新计费或合成
    if (chatTtsBubble === bubble && (chatTtsBusy || (chatTtsAudio && !chatTtsAudio.paused))) {
      stopChatTts();
      if (window.RetroToast) RetroToast.show({ tag: 'TTS // 语音播报', message: '语音播放已停止', type: 'info' });
      return;
    }

    const slot = getTtsConfig();
    if (!slot || !slot.baseUrl || !slot.apiKey) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'TTS // 未配置',
          message: '尚未配置 TTS 语音合成节点',
          detail: '请前往 API 引擎配置 TTS 语音合成插槽。',
          type: 'warning'
        });
      }
      return;
    }

    const assistant = getCurrentAssistant() || {};
    const config = {
      ...slot,
      // 助手专属音色优先于 TTS 插槽默认音色
      voiceId: String(assistant.voiceId || '').trim() || String(slot.voiceId || '').trim(),
      speed: slot.speed,
      pitch: slot.pitch
    };

    stopChatTts();
    const requestId = chatTtsRequestId;
    chatTtsBusy = true;
    chatTtsBubble = bubble || null;
    if (chatTtsBubble) chatTtsBubble.classList.add('is-tts-loading');
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'TTS // 语音播报',
        message: '正在合成助手语音…',
        detail: assistant.voiceId ? `专属音色：${assistant.voiceId}` : '使用 TTS 插槽默认音色',
        type: 'info',
        duration: 2200
      });
    }

    try {
      if (!window.RetroflowTTSCache || typeof RetroflowTTSCache.resolve !== 'function') {
        throw new Error('语音缓存模块尚未加载');
      }
      if (!window.RetroflowAPI || typeof RetroflowAPI.synthesizeSpeech !== 'function') {
        throw new Error('TTS API 模块尚未加载');
      }

      const result = await RetroflowTTSCache.resolve(
        config,
        cleanText,
        () => RetroflowAPI.synthesizeSpeech(config, { text: cleanText, logTag: '系统助手 · TTS' })
      );

      // 请求期间若用户已停止、切换气泡或离开页面，旧结果不得抢播
      if (requestId !== chatTtsRequestId) return;

      chatTtsBusy = false;
      const audio = getChatTtsAudio();
      audio.pause();
      audio.src = result.entry.url;
      if (chatTtsBubble) {
        chatTtsBubble.classList.remove('is-tts-loading');
        chatTtsBubble.classList.add('is-tts-playing');
      }
      await audio.play();

      if (window.RetroToast) {
        RetroToast.show({
          tag: 'TTS // 语音播报',
          message: result.cached ? '正在播放助手语音 · 命中缓存' : '正在播放助手语音',
          type: 'success',
          duration: 1800
        });
      }
    } catch (err) {
      if (requestId !== chatTtsRequestId) return;
      chatTtsBusy = false;
      if (bubble) {
        bubble.classList.remove('is-tts-playing');
        bubble.classList.remove('is-tts-loading');
      }
      chatTtsBubble = null;
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'TTS // 播放失败',
          message: err && err.message ? err.message : '语音合成或播放失败',
          type: 'warning'
        });
      }
    }
  }

  if (!chatPage) return;

  function dismissChatUI() {
    stopChatTts();
    exitBatchMode();
    chatPage.classList.remove('active');
    chatPage.classList.remove('mode-full');
    chatPage.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('page-active');
    // 聊天页退场即形态归零：只同步随行中枢的内部状态指针，
    // 不让它接手 DOM —— 否则会立刻 hidden=true，掐掉下面 360ms 的退场动画
    if (window.SystemChatOrb && typeof SystemChatOrb.notifyDismissed === 'function') {
      SystemChatOrb.notifyDismissed();
    }
    if (textarea) textarea.blur();
    setTimeout(() => {
      if (!chatPage.classList.contains('active')) {
        chatPage.hidden = true;
      }
    }, 360);
  }

  function open(options) {
    // 记录入口来源：从线上联络列表进来时，返回要把列表页复位到下层当底衬；
    // 从 Dock 或桌面卡片直接进来时下层就是桌面，不能凭空把列表页翻出来。
    enteredFromOnlineList = !!(options && options.fromOnlineList);
    chatPage.hidden = false;
    chatPage.setAttribute('aria-hidden', 'false');
    // 强制 reflow 触发平滑过渡
    void chatPage.offsetWidth;
    chatPage.classList.add('active');
    // 形态归位：不是小窗就按全屏态收尾。
    // 这里统一通知随行中枢对齐状态 —— Dock / 线上列表 / 通知 / 共鸣页都直接调 open()，
    // 不走状态机。若不对齐，球不会收起，且 currentState 失真会让缩小键失灵。
    if (!chatPage.classList.contains('mode-mini')) {
      chatPage.classList.add('mode-full');
      document.body.classList.add('page-active');
      if (window.SystemChatOrb && typeof SystemChatOrb.notifyFullOpened === 'function') {
        SystemChatOrb.notifyFullOpened();
      }
    }
    syncHeaderIdentity();
    // Mini 浮窗是浮在任意页面之上的副屏，绝不能挤进主路由栈：
    // 一旦压了 #system-chat 这条桩，它就会变成下层页面 back() 的靶子，
    // 最小化时退桩又会误触副本编纂 / 灯箱 / 同调档案的 popstate 自关或自愈重开。
    // 所以从悬浮球展开小窗时由 SystemChatOrb 传 skipHistory，全程不碰 history。
    if (!(options && options.skipHistory)) {
      try {
        history.pushState({ rfPage: 'system-chat' }, '', '#system-chat');
      } catch (_) {}
    }

    // 对话必须先就绪：SYSTEM_CHAT_FORK_ID 由它确定，提前拉流水会读错对话。
    // 初值是历史遗留的 main，万一 store 不可用也能退回老数据，不至于空屏。
    ensureConvReady().then(() => {
      syncHeaderIdentity();
      restoreChatHistory();
    });
  }

  /**
   * 若本页是从线上联络消息列表进来的，返回时先把列表页复位到下层。
   *
   * 顺序很关键：必须在本页开始滑出之前 reveal。
   * 两页都走 translateX 过渡，本页滑走的那几帧若下层还是空的，
   * 露出来的就是桌面，之后列表页才淡进来——观感上是「闪一下桌面」。
   * 列表页（z-index 900）在本页（920）之下，提前显示不会遮挡本页的退场动画。
   */
  function revealOnlineListBeneath() {
    if (!window.OnlineUI || typeof OnlineUI.reveal !== 'function') return;
    // 只在确实存在 #online 这层历史时复位，避免从 Dock 直接进来的场景凭空翻出列表页
    if (!enteredFromOnlineList) return;
    // instant=true：本页正要滑走，列表页必须瞬间垫在后面，不能也播进场动画
    OnlineUI.reveal(true);
  }

  function close() {
    if (!chatPage || !chatPage.classList.contains('active')) return;
    revealOnlineListBeneath();
    dismissChatUI();

    if ((window.location.hash || '') === '#system-chat') {
      pendingProgrammaticBack = true;
      try {
        history.back();
      } catch (_) {
        pendingProgrammaticBack = false;
      }
    }
  }

  /**
   * 纯视图恢复：把聊天页重新显示出来，不压历史条目、不重载聊天记录。
   * 供跨页跳转（如 API 设置）返回时把聊天页作为底层复位使用。
   */
  function reveal() {
    if (!chatPage || chatPage.classList.contains('active')) return;
    chatPage.hidden = false;
    chatPage.setAttribute('aria-hidden', 'false');
    void chatPage.offsetWidth;
    chatPage.classList.add('active');
    document.body.classList.add('page-active');
    syncHeaderIdentity();
  }

  // 绑定返回
  if (backBtn) {
    backBtn.addEventListener('click', close);
  }

  // popstate 路由与系统级/手势返回监听
  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }

    // 若文本编辑器、二级设置或弹窗正在上层，这次返回优先归其处理
    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;
    const settingsPage = document.getElementById('systemChatSettingsPage');
    if (settingsPage && settingsPage.classList.contains('active')) return;
    // Mini 浮窗态对路由返回完全免疫：它不在主路由栈里，这次返回属于它下面
    // 那个页面（副本编纂 / 同调档案 / 设置二级页…）。若在此处 dismiss，
    // 执行员在下层页面按返回就会连带把小窗弄没。
    if (chatPage && chatPage.classList.contains('mode-mini')) return;
    const hash = window.location.hash || '';
    if (chatPage && chatPage.classList.contains('active') && hash !== '#system-chat') {
      // 与 close() 同理：先把列表页垫到下层，再让本页滑出
      revealOnlineListBeneath();
      dismissChatUI();
    }
  });

  // ESC 键退出
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chatPage && chatPage.classList.contains('active')) {
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;
      const settingsPage = document.getElementById('systemChatSettingsPage');
      if (settingsPage && settingsPage.classList.contains('active')) return;
      close();
    }
  });

  // 原生边缘/右滑返回手势支持 (Edge / Horizontal Swipe Back)
  (function initSwipeBackGesture() {
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let isHorizontal = false;
    let isDirectionLocked = false;

    chatPage.addEventListener('touchstart', (e) => {
      if (!chatPage.classList.contains('active') || isBatchMode) return;
      if (e.touches && e.touches.length > 1) return;
      const t = e.touches[0];
      // 允许从左侧边缘（<= 48px）或页面左半区发起向右滑动手势
      touchStartX = t.clientX;
      touchStartY = t.clientY;
      isSwiping = true;
      isHorizontal = false;
      isDirectionLocked = false;
    }, { passive: true });

    chatPage.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      const t = e.touches[0];
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      if (!isDirectionLocked) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          isDirectionLocked = true;
          // 向右滑动且水平位移大于纵向位移
          isHorizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
        }
      }
    }, { passive: true });

    chatPage.addEventListener('touchend', (e) => {
      if (!isSwiping) return;
      isSwiping = false;
      if (!isHorizontal) return;

      const t = e.changedTouches ? e.changedTouches[0] : null;
      if (!t) return;
      const dx = t.clientX - touchStartX;
      const dy = t.clientY - touchStartY;

      // 触发条件：从左向右滑动超过 72px 且纵向偏离不大
      if (dx > 72 && Math.abs(dy) < dx * 0.8) {
        // 如果长按菜单打开，先关 HUD
        closeActiveHud();
        close();
      }
    }, { passive: true });

    chatPage.addEventListener('touchcancel', () => {
      isSwiping = false;
    }, { passive: true });
  })();

  // 输入框自适应高度调节（1~5行）
  function autoResizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const newHeight = Math.min(Math.max(textarea.scrollHeight, 24), 120);
    textarea.style.height = `${newHeight}px`;

    // 发送按钮根据是否有输入文本切换高亮态
    if (sendBtn && !sendBtn.classList.contains('is-generating')) {
      const hasContent = textarea.value.trim().length > 0 || pendingImages.length > 0;
      sendBtn.classList.toggle('is-ready', hasContent);
      // 关键：推演结束后 setSendButtonState(false) 会在输入框为空时把按钮 disabled，
      // 用户重新输入时必须同步解除 disabled，否则按钮视觉亮着却点不动（需退出重进才复位）。
      if (!activeAbortController) sendBtn.disabled = !hasContent;
    }
  }

  if (textarea) {
    textarea.addEventListener('input', autoResizeTextarea);
  }

  // 格式化当前时间 (HH:mm)
  function formatCurrentTime() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  const SEND_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
  const STOP_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>`;
  const WAVEFORM_HTML = `<div class="chat-waveform" aria-label="因果共振推演中"><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span></div>`;
  let activeAbortController = null;

  function setSendButtonState(isGenerating) {
    if (!sendBtn) return;
    if (isGenerating) {
      sendBtn.classList.add('is-generating');
      sendBtn.classList.add('is-ready');
      sendBtn.innerHTML = STOP_ICON_SVG;
      sendBtn.setAttribute('aria-label', '终止推演');
      sendBtn.setAttribute('title', '终止推演 (ABORT)');
      sendBtn.disabled = false;
    } else {
      sendBtn.classList.remove('is-generating');
      sendBtn.innerHTML = SEND_ICON_SVG;
      sendBtn.setAttribute('aria-label', '发送指令');
      sendBtn.setAttribute('title', '发送指令');
      const hasContent = textarea && (textarea.value.trim().length > 0 || pendingImages.length > 0);
      sendBtn.classList.toggle('is-ready', Boolean(hasContent));
      sendBtn.disabled = !hasContent;
    }
  }
  const SYSTEM_AVATAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9zM7 14h1v4H7v-4zm10 4v-4h1v4h-1z"/></svg>`;
  const USER_AVATAR_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

  // 异步获取「03 个人档案」头像 URL
  async function getUserAvatarSrc() {
    // 优先从 DOM 缓存读取
    const personaAvatarImg = document.getElementById('personaAvatarImg');
    if (personaAvatarImg && personaAvatarImg.src && !personaAvatarImg.hidden) {
      return personaAvatarImg.src;
    }
    // 回退从 IndexedDB 储存读取
    if (window.Storage && window.DataRegistry) {
      try {
        const key = DataRegistry.key.personaAvatar();
        const src = await Storage.getAssetSrc(key);
        if (src) return src;
      } catch (err) {
        /* 忽略 */
      }
    }
    return null;
  }

  function getCurrentAssistantName() {
    try {
      if (window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function') {
        const active = ResonanceUI.getActiveAssistant();
        if (active && String(active.name || '').trim()) return String(active.name).trim();
      }
    } catch (_) { /* 使用兜底名称 */ }
    return '系统助手';
  }

  function getCurrentUserName() {
    try {
      const identityName = window.Store && Store.envoy && Store.envoy.identity
        ? String(Store.envoy.identity.name || '').trim()
        : '';
      const cardName = window.Store && Store.decor
        ? String(Store.decor.cardName || '').trim()
        : '';
      return identityName || cardName || '执行员';
    } catch (_) {
      return '执行员';
    }
  }

  function getSenderName(role) {
    return role === 'assistant' ? getCurrentAssistantName() : getCurrentUserName();
  }

  function buildSilentContinuationInstruction() {
    const userName = getCurrentUserName();
    return `[对话延续指令]\n执行员「${userName}」本轮没有发送新的文字。请结合当前对话，自然地继续刚才的话题；如果原话题已经结束，也可以根据你与执行员的关系和既有语境，主动开启一个合适的新话题。不要提及、解释或复述本条指令。`;
  }

  function getCurrentAssistant() {
    try {
      if (window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function') {
        return ResonanceUI.getActiveAssistant() || null;
      }
    } catch (_) { /* 使用空助手兜底 */ }
    return null;
  }

  async function getAssistantAvatarSrc(assistantId) {
    if (!assistantId || !window.Storage || !window.DataRegistry || !DataRegistry.key || typeof DataRegistry.key.assistantAvatar !== 'function') {
      return null;
    }
    try {
      return await Storage.getAssetSrc(DataRegistry.key.assistantAvatar(assistantId));
    } catch (_) {
      return null;
    }
  }

  function syncHeaderIdentity() {
    if (!headerTitle || isBatchMode) return;
    // 眉栏优先显示对话标题（即原「备注」），未命名才回落助手名
    const title = getCurrentConvTitle().trim();
    headerTitle.textContent = title || getCurrentAssistantName();
  }

  function makeChatRecordId() {
    return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function formatRecordTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 && !Number.isNaN(new Date(timestamp).getTime()) ? timestamp : null;
  }

  function formatRealityDateTime(value) {
    const timestamp = normalizeTimestamp(value);
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${minute} ${WEEKDAYS_ZH[date.getDay()]}`;
  }

  function isTimePerceptionEnabled() {
    const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : { timePerception: true };
    return settings.timePerception !== false;
  }

  /** 电量感知开关。与时间感知各自独立生效，互不依赖。 */
  function isBatteryPerceptionEnabled() {
    const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : { batteryPerception: true };
    return settings.batteryPerception !== false;
  }

  /** 当前启用的环境感知维度，供 EnvAwareness 取数与拼装共用同一份口径 */
  function getEnvPerceptionOptions() {
    return { battery: isBatteryPerceptionEnabled() };
  }

  /**
   * 抓取本条用户消息的环境快照。
   * 快照随消息落库，回放时读当时的值而非实时值。
   * 任一环节不可用都返回 null，调用方无需额外兜底。
   */
  async function captureEnvSnapshot() {
    if (!window.EnvAwareness || typeof EnvAwareness.captureSnapshot !== 'function') return null;
    const opts = getEnvPerceptionOptions();
    if (!Object.values(opts).some(Boolean)) return null;
    try {
      return await EnvAwareness.captureSnapshot(opts);
    } catch (_) {
      return null;
    }
  }

  function buildRealityTimeBaseline(timestamp) {
    return `[现实时间基准]\n以下是本次对话请求发生时的最新现实时间：\n${formatRealityDateTime(timestamp || Date.now())}\n请以此作为判断“现在、今天、昨天、刚才、多久以前”等时间关系的唯一当前时间基准。\n本段是后台元数据，执行员看不到。禁止在回复中复述、播报这个时间，也禁止把它写成回复的开头。除非执行员主动问起时间，否则不要提及。`;
  }

  async function persistChatMessage(role, text, quotePayload, recordId, createdAt, media, messageGroupId, extra) {
    const active = window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function'
      ? ResonanceUI.getActiveAssistant()
      : null;
    const record = {
      id: recordId || makeChatRecordId(),
      kind: SYSTEM_CHAT_RECORD_KIND,
      forkId: SYSTEM_CHAT_FORK_ID,
      assistantId: active && active.id ? active.id : null,
      assistantName: active && active.name ? active.name : null,
      role,
      senderName: getSenderName(role),
      content: String(text || ''),
      quote: quotePayload && quotePayload.text ? { ...quotePayload } : null,
      messageGroupId: messageGroupId || null,
      imageRef: null,
      createdAt: createdAt || Date.now()
    };
    // 旧调用仍可写入 media，图片发送的新路径使用独立 image record。
    if (media && media.visionDescription) record.imageRef = { ...media };
    // 环境快照（电量等）：只有用户消息才有，缺省不写字段，保持旧记录形状不变
    if (extra && extra.envSnapshot) record.envSnapshot = { ...extra.envSnapshot };
    await Storage.putRecord(record);
    // 传入 recordId 说明是重写已有记录（编辑/重试），不该重复计数
    await touchCurrentConv(recordId ? null : record);
    return record;
  }

  async function persistImageChatMessage(media, messageGroupId, recordId, createdAt, extra) {
    const active = getCurrentAssistant();
    const record = {
      id: recordId || makeChatRecordId(),
      kind: SYSTEM_CHAT_RECORD_KIND,
      forkId: SYSTEM_CHAT_FORK_ID,
      assistantId: active && active.id ? active.id : null,
      assistantName: active && active.name ? active.name : null,
      role: 'user',
      senderName: getCurrentUserName(),
      content: '',
      quote: null,
      messageType: 'image',
      messageGroupId,
      imageRef: { ...media },
      createdAt: createdAt || Date.now()
    };
    if (extra && extra.envSnapshot) record.envSnapshot = { ...extra.envSnapshot };
    await Storage.putRecord(record);
    await touchCurrentConv(record);
    return record;
  }

  async function persistFileChatMessage(fileRefs, messageGroupId, recordId, createdAt, extra) {
    const active = getCurrentAssistant();
    const record = {
      id: recordId || makeChatRecordId(),
      kind: SYSTEM_CHAT_RECORD_KIND,
      forkId: SYSTEM_CHAT_FORK_ID,
      assistantId: active && active.id ? active.id : null,
      assistantName: active && active.name ? active.name : null,
      role: 'user',
      senderName: getCurrentUserName(),
      content: '',
      quote: null,
      messageType: 'file',
      messageGroupId,
      fileRefs: (fileRefs || []).map((f) => ({ id: f.id, name: f.name, sizeText: f.sizeText, charCount: f.charCount })),
      createdAt: createdAt || Date.now()
    };
    if (extra && extra.envSnapshot) record.envSnapshot = { ...extra.envSnapshot };
    await Storage.putRecord(record);
    await touchCurrentConv(record);
    return record;
  }

  /** 助手生成图消息：独立成行，归 assistant 角色，media 走 genImageRef。 */
  async function persistGeneratedImageMessage(media, messageGroupId, recordId, createdAt) {
    const active = getCurrentAssistant();
    const record = {
      id: recordId || makeChatRecordId(),
      kind: SYSTEM_CHAT_RECORD_KIND,
      forkId: SYSTEM_CHAT_FORK_ID,
      assistantId: active && active.id ? active.id : null,
      assistantName: active && active.name ? active.name : null,
      role: 'assistant',
      senderName: (active && active.name) || getSenderName('assistant'),
      content: String(media.prompt || '').trim(),
      quote: null,
      messageType: 'assistant-image',
      messageGroupId: messageGroupId || null,
      genImageRef: { ...media, prompt: String(media.prompt || '').trim() },
      createdAt: createdAt || Date.now()
    };
    await Storage.putRecord(record);
    await touchCurrentConv(record);
    return record;
  }

  const SYSTEM_CHAT_TOOL_KIND = 'system_chat_tool_call';

  /**
   * 落库后推进当前对话的活跃时间与消息数。
   *
   * 消息数只统计「会话气泡」（SYSTEM_CHAT_RECORD_KIND），工具调用与撤回通知
   * 不计 —— 列表上那个「N 条」是给人看对话规模的，算进胶囊会虚高。
   * 活跃时间则一律推进：有任何动静这条对话就该往列表前排。
   *
   * 失败只警告不抛：元信息不准不该让消息发送失败。
   */
  async function touchCurrentConv(record) {
    if (!window.SystemChatStore || !currentConvId) return;
    const counts = !!(record && record.kind === SYSTEM_CHAT_RECORD_KIND);
    try {
      await SystemChatStore.touchConv(currentConvId, counts ? 1 : 0);
      currentConv = await SystemChatStore.getConv(currentConvId);
    } catch (err) {
      console.warn('[System Chat] 更新对话元信息失败：', err);
    }
  }

  async function persistToolCallRecord(result, messageGroupId) {
    const active = getCurrentAssistant();
    const record = {
      id: makeChatRecordId(),
      kind: SYSTEM_CHAT_TOOL_KIND,
      forkId: SYSTEM_CHAT_FORK_ID,
      assistantId: active && active.id ? active.id : null,
      role: 'tool',
      toolName: result.name,
      toolInput: result.input || null,
      toolOutput: String(result.output || ''),
      toolStatus: result.status || 'success',
      messageGroupId: messageGroupId || null,
      createdAt: Date.now()
    };
    await Storage.putRecord(record);
    await touchCurrentConv(record);
    return record;
  }

  async function updateChatRecordContent(recordId, content) {
    if (!recordId || !window.Storage || typeof Storage.getRecordsByFork !== 'function' || typeof Storage.putRecord !== 'function') {
      return false;
    }
    const records = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID);
    const target = records.find(record => record && record.id === recordId && record.kind === SYSTEM_CHAT_RECORD_KIND);
    if (!target) return false;
    target.content = String(content || '');
    target.updatedAt = Date.now();
    await Storage.putRecord(target);
    return true;
  }

  async function persistRecallNotice(userName, createdAt) {
    const resolvedName = String(userName || getCurrentUserName()).trim() || '执行员';
    const message = `「${resolvedName}」撤回了一条消息`;
    const record = {
      id: makeChatRecordId(),
      kind: SYSTEM_CHAT_NOTICE_KIND,
      noticeType: 'recall',
      forkId: SYSTEM_CHAT_FORK_ID,
      role: 'system',
      senderName: resolvedName,
      content: message,
      eventAt: Date.now(),
      createdAt: createdAt || Date.now()
    };
    await Storage.putRecord(record);
    await touchCurrentConv(record);
    return record;
  }

  async function removeChatRecordIds(recordIds) {
    if (!window.Storage || typeof Storage.removeRecord !== 'function') return 0;
    const initialIds = Array.from(new Set((recordIds || []).filter(Boolean).map(String)));
    if (!initialIds.length) return 0;
    // 同组的文字与图片是一次用户交互，删除任一条时必须整体删除，避免孤立资产或残留语义。
    let ids = initialIds;
    if (typeof Storage.getRecordsByFork === 'function') {
      const records = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID).catch(() => []);
      const groups = new Set(records
        .filter((record) => record && initialIds.includes(String(record.id)) && record.messageGroupId)
        .map((record) => String(record.messageGroupId)));
      ids = Array.from(new Set(records
        .filter((record) => record && (initialIds.includes(String(record.id)) || (record.messageGroupId && groups.has(String(record.messageGroupId)))))
        .map((record) => String(record.id))));
    }
    // 聊天页删除/撤回/回溯属于语义级抹除：记录、识图描述与关联图库资产一起清理。
    if (window.GalleryStore && typeof GalleryStore.removeByChatRecordIds === 'function') {
      await GalleryStore.removeByChatRecordIds(ids);
    }
    await Promise.all(ids.map(id => Storage.removeRecord(id)));
    return ids.length;
  }

  // 历史前插锚点：非 null 时，历史渲染的节点插到它前面（上滑加载更早消息用）；
  // null 时正常 appendChild 到末尾（初次加载 / 实时追加）。
  let historyInsertAnchor = null;

  /** 历史节点统一挂载点：受 historyInsertAnchor 控制 append 到底还是前插。 */
  function mountChatNode(node) {
    if (!messagesWrap || !node) return;
    // 双保险：只有在「历史恢复流程中」且锚点有效时才前插。实时消息（发送 / AI 回复）
    // isRestoringHistory 恒为 false，无论 anchor 状态如何都强制 append 到底，绝不误插。
    if (isRestoringHistory && historyInsertAnchor && historyInsertAnchor.parentNode === messagesWrap) {
      messagesWrap.insertBefore(node, historyInsertAnchor);
    } else {
      messagesWrap.appendChild(node);
    }
  }

  /**
   * 渲染一条历史记录到当前挂载点（受 historyInsertAnchor 控制方向）。
   * 跨天胶囊由外层循环统一处理，这里只渲染记录本体。
   * @returns {Promise<void>}
   */
  async function renderHistoryRecord(record) {
    if (!record) return;
    if (record.kind === SYSTEM_CHAT_NOTICE_KIND && record.noticeType === 'recall') {
      appendSystemNotice(record.content, record.id, record.eventAt || record.createdAt);
      return;
    }
    if (record.kind === SYSTEM_CHAT_TOOL_KIND) {
      appendToolCard({
        name: record.toolName || 'tool',
        tag: toolCardTag(record.toolName, record.toolStatus),
        input: record.toolInput,
        output: record.toolOutput,
        status: record.toolStatus || 'success'
      }, { recordId: record.id, createdAt: record.createdAt });
      return;
    }
    if (record.kind !== SYSTEM_CHAT_RECORD_KIND) return;
    if (record.messageType === 'assistant-image' && record.genImageRef) {
      await appendGeneratedImage({
        ...record.genImageRef,
        prompt: record.genImageRef.prompt || record.content || ''
      }, {
        recordId: record.id,
        messageGroupId: record.messageGroupId || null,
        assistantId: record.assistantId || '',
        senderName: record.senderName || record.assistantName || '',
        createdAt: record.createdAt
      });
      return;
    }
    await appendMessage(
      record.role,
      record.content,
      formatRecordTime(record.createdAt),
      record.quote,
      record.id,
      record.senderName || (record.role === 'assistant' ? record.assistantName : ''),
      record.role === 'assistant' ? record.assistantId : '',
      record.createdAt,
      record.imageRef || record.media || (record.fileRefs && record.fileRefs.length ? { fileRefs: record.fileRefs } : null),
      record.messageGroupId || null,
      record.envSnapshot ? { envSnapshot: record.envSnapshot } : null
    );
  }

  /**
   * 渲染一个记录区间 [from, to) 到当前挂载点，附带跨天胶囊。
   * @param {number} from 起始下标（含）
   * @param {number} to 结束下标（不含）
   * @param {number} prevDayTs 区间首条之前那条记录的时间戳（用于判断区间首条是否要插胶囊）；0 表示区间之前没有更早记录
   * @returns {Promise<Array>} 渲染失败明细
   */
  async function renderHistoryRange(from, to, prevDayTs) {
    const renderErrors = [];
    let prevSepDayTs = prevDayTs || 0;
    for (let i = from; i < to; i += 1) {
      const record = historyAllRecords[i];
      try {
        if (!record) continue;
        // 跨天日期胶囊：与上一条不在同一天就在它前面插一枚居中日期胶囊。
        if (window.ChatDaySep && record.createdAt) {
          if (ChatDaySep.isCrossDay(prevSepDayTs, record.createdAt) && messagesWrap) {
            mountChatNode(ChatDaySep.buildPill(record.createdAt));
          }
          prevSepDayTs = record.createdAt;
        }
        await renderHistoryRecord(record);
      } catch (rowErr) {
        console.warn('[System Chat] 单条记录渲染失败，已跳过：', record && record.id, rowErr);
        renderErrors.push({
          id: record && record.id,
          kind: record && record.kind,
          role: record && record.role,
          messageType: record && record.messageType,
          createdAt: record && record.createdAt,
          error: String(rowErr && rowErr.message || rowErr),
          stack: String(rowErr && rowErr.stack || '').slice(0, 400)
        });
      }
    }
    return renderErrors;
  }

  /**
   * 上滑加载更早一批历史：往容器顶部前插 HISTORY_PAGE_STEP 条，并保持滚动位置不跳。
   */
  async function loadMoreHistory() {
    if (isLoadingMoreHistory) return;
    if (historyRenderedFrom <= 0) return; // 已到最早
    isLoadingMoreHistory = true;
    isRestoringHistory = true;
    try {
      const to = historyRenderedFrom;
      const from = Math.max(0, to - HISTORY_PAGE_STEP);
      // 区间首条之前那条的时间戳：用于判断本批首条是否要插胶囊
      const prevDayTs = from > 0 ? Number(historyAllRecords[from - 1] && historyAllRecords[from - 1].createdAt) || 0 : 0;

      // 保位法：记录「原第一个子节点」这个锚点。前插后它在文档里的位置会下移，
      // 用它 offsetTop 的变化量来补偿 scrollTop，比用 scrollHeight 差更准——
      // scrollHeight 差在图片异步撑高时会失真，累积误差最终表现为「滑不到底」。
      const anchorNode = messagesWrap.firstElementChild || null;
      const beforeAnchorTop = anchorNode ? anchorNode.offsetTop : 0;
      const beforeScrollTop = chatBody ? chatBody.scrollTop : 0;

      historyInsertAnchor = anchorNode;
      await renderHistoryRange(from, to, prevDayTs);
      historyRenderedFrom = from;

      // 前插后：原来最顶那条现在头顶多了更早的消息，它自己的日期胶囊可能变成重复/多余。
      if (window.ChatDaySep && typeof ChatDaySep.dedupeAdjacent === 'function') {
        ChatDaySep.dedupeAdjacent(messagesWrap);
      }

      // 保持视口不跳：让锚点元素停在原来的视觉位置。
      // 新的 scrollTop = 原 scrollTop + 锚点下移量（offsetTop 增量）。
      if (chatBody && anchorNode) {
        const afterAnchorTop = anchorNode.offsetTop;
        chatBody.scrollTop = beforeScrollTop + (afterAnchorTop - beforeAnchorTop);
      }
    } catch (err) {
      console.warn('[System Chat] 上滑加载更早历史失败：', err);
    } finally {
      // 锚点必须无条件清空：一旦残留，后续新消息 / 实时追加会被 mountChatNode 误插到
      // 顶部锚点前，表现为「发消息不回底、消息插到历史中间」。放 finally 确保万无一失。
      historyInsertAnchor = null;
      isRestoringHistory = false;
      isLoadingMoreHistory = false;
    }
  }

  async function restoreChatHistory() {
    if (historyRestorePromise) return historyRestorePromise;
    historyRestorePromise = (async () => {
      if (!messagesWrap || messagesWrap.children.length > 0 || !Storage.getRecordsByFork) return;
      isRestoringHistory = true;
      try {
        const records = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID);
        // 缓存全量记录（时间升序），渲染分页只切末尾一批；上下文构建独立读存储，互不影响。
        historyAllRecords = Array.isArray(records) ? records : [];
        const total = historyAllRecords.length;
        // 初次只渲染最新 HISTORY_PAGE_INITIAL 条；更早的等上滑到顶再按 STEP 追加。
        const from = Math.max(0, total - HISTORY_PAGE_INITIAL);
        historyRenderedFrom = from;
        // 区间首条之前那条的时间戳：初次加载 from 之前若还有更早记录，用它判断首条胶囊
        const prevDayTs = from > 0 ? Number(historyAllRecords[from - 1] && historyAllRecords[from - 1].createdAt) || 0 : 0;

        // 单条渲染隔离：某条记录渲染时抛运行时异常（头像/图片/markdown 等），
        // 绝不能连累整段历史。一条失败只跳过它，其余继续，失败明细落 localStorage 供诊断。
        const renderErrors = await renderHistoryRange(from, total, prevDayTs);

        // 渲染失败明细落 localStorage，供诊断页读取（无失败则清空旧记录）
        try {
          if (renderErrors.length) {
            localStorage.setItem('retroflow_render_errors', JSON.stringify({
              at: Date.now(),
              total,
              failed: renderErrors.length,
              items: renderErrors.slice(0, 30)
            }));
          } else {
            localStorage.removeItem('retroflow_render_errors');
          }
        } catch (_) {}
      } finally {
        isRestoringHistory = false;
        // 历史挂载后定位到底部。用 scrollToRealBottom 持续锁底覆盖图片渐进撑高的过程，
        // 避免「渲染完那一刻图片高度还是 0、scrollHeight 偏小、定位不到真底」。
        if (chatBody) {
          chatBody.scrollTop = chatBody.scrollHeight;
          if (typeof scrollToRealBottom === 'function') scrollToRealBottom();
        }
      }
    })().catch((err) => {
      console.warn('[System Chat] 恢复聊天记录失败：', err);
    }).finally(() => {
      historyRestorePromise = null;
    });
    return historyRestorePromise;
  }

  function renderBubbleText(container, text) {
    if (!container) return;
    // HTML 注释 <!-- ... --> 是「给 AI 的暗号 / 指令」约定，无论是否开启 markdown
    // 渲染都不应显形给用户。开引擎时由 RetroflowMarkdown.render 内部剥离；关渲染走
    // 纯文本兜底时，这里同样先剥一遍，保证口径一致。
    const cleaned = typeof text === 'string' ? text.replace(/<!--[\s\S]*?-->/g, '') : text;
    const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : { markdownRender: true };

    if (settings.markdownRender !== false && window.RetroflowMarkdown && typeof RetroflowMarkdown.render === 'function') {
      container.innerHTML = RetroflowMarkdown.render(cleaned);
      if (typeof RetroflowMarkdown.bindCodeCopy === 'function') {
        RetroflowMarkdown.bindCodeCopy(container);
      }
    } else {
      container.textContent = cleaned;
    }
  }

  function getSegmentedBubbleSettings() {
    return window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : { markdownRender: true, segmentedBubbles: false };
  }

  function getAssistantRenderBlocks(text) {
    const settings = getSegmentedBubbleSettings();
    if (settings.segmentedBubbles !== true || !window.RetroflowMarkdown || typeof RetroflowMarkdown.splitBlocks !== 'function') {
      return [String(text || '')];
    }
    const blocks = RetroflowMarkdown.splitBlocks(String(text || ''));
    return blocks.length ? blocks : [String(text || '')];
  }

  /** 思维链是否被设置隐藏（缺省显示） */
  function isThinkingHidden() {
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : null;
    return Boolean(s && s.hideThinking === true);
  }

  /** 判断助手原文里除动作标记与思维链之外，是否还有可见正文 */
  function hasVisibleBodyText(rawText) {
    let s = String(rawText || '');
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripActionMarkers === 'function') {
      s = RetroflowMarkdown.stripActionMarkers(s);
    }
    // 思维链不算可见正文：只有思维链时不应落库成一条文字消息，也不该占着空气泡
    s = stripThinkingFromContext(s);
    return s.trim().length > 0;
  }

  function syncAssistantBubbleGroup(row, fullText, options) {
    if (!row || !row.classList.contains('assistant')) return null;
    const stack = row.querySelector('.chat-bubble-stack');
    if (!stack) return null;
    const opts = options || {};

    // 原文完整保留（存 dataset，供编辑 / 上下文 / 语音读取原始内容）；
    // 显示用文本剥离动作标记（渲染层隐藏），流式半截标记也一并隐藏，绝不闪现尖括号。
    // 思维链（<think>）保留在显示文本里，交给 markdown 渲染成折叠手风琴。
    const rawFull = String(fullText || '');
    const stripMarkers = window.RetroflowMarkdown && typeof RetroflowMarkdown.stripActionMarkers === 'function'
      ? RetroflowMarkdown.stripActionMarkers
      : (s) => String(s || '');
    const displayFull = stripMarkers(rawFull);
    // 是否处于「等待首字」态：还没收到任何原文时显示波形；已有原文但除动作标记与
    // 思维链外没有正文（如只发了生图标记、或思维链还没转正文）则不留空文字气泡。
    const awaitingFirst = !rawFull;
    const hasVisibleText = hasVisibleBodyText(rawFull);
    // 思维链自身也要能撑起气泡：模型先吐 reasoning 再吐正文时，正文还没来的阶段
    // 必须保留气泡把手风琴渲染出来，否则「思考中」面板会被当成空气泡删掉。
    // hideThinking 打开时思维链不渲染，就不算内容。
    const hasThinkingOnly = !hasVisibleText
      && !isThinkingHidden()
      && /<(think|thinking)\b/i.test(displayFull);
    const hasRenderable = hasVisibleText || hasThinkingOnly;

    const blocks = (awaitingFirst || hasRenderable) ? getAssistantRenderBlocks(displayFull) : [];
    const existing = Array.from(stack.querySelectorAll(':scope > .chat-bubble'));

    while (existing.length > blocks.length) {
      const stale = existing.pop();
      stale.remove();
    }

    blocks.forEach((blockText, index) => {
      let bubble = existing[index];
      let isNew = false;
      if (!bubble) {
        isNew = true;
        bubble = document.createElement('div');
        bubble.className = 'chat-bubble assistant';
        const content = document.createElement('div');
        content.className = 'chat-bubble-content';
        bubble.appendChild(content);
        stack.appendChild(bubble);
        existing.push(bubble);
        bindBubbleLongPress(bubble, 'assistant', blockText, row);
      }

      // rawText 存原文（编辑可见），segmentText 存该气泡显示片段
      bubble.dataset.rawText = rawFull;
      bubble.dataset.segmentText = blockText;
      const content = bubble.querySelector('.chat-bubble-content');
      if (content) {
        if (awaitingFirst && index === 0) content.innerHTML = WAVEFORM_HTML;
        else renderBubbleText(content, blockText);
        if (opts.cursor && index === blocks.length - 1) {
          const cursor = document.createElement('span');
          cursor.className = 'chat-typing-cursor';
          cursor.setAttribute('aria-hidden', 'true');
          content.appendChild(cursor);
        }
      }
      const isFirstDelivery = index === 0 && hasVisibleText && row.dataset.hasRenderedContent !== 'true';
      if ((isNew || isFirstDelivery) && opts.animate) {
        const now = performance.now();
        const nextAt = Number.isFinite(row._segmentNextAt) ? row._segmentNextAt : now;
        const scheduledAt = Math.max(now, nextAt);
        const delayMs = Math.max(0, Math.round(scheduledAt - now));
        row._segmentNextAt = scheduledAt + 280;
        bubble.style.setProperty('--stagger-delay', `${delayMs}ms`);
        bubble.classList.add('is-segment-entering');
        bubble.addEventListener('animationend', () => {
          bubble.classList.remove('is-segment-entering');
          bubble.style.removeProperty('--stagger-delay');
        }, { once: true });
      }
    });

    if (hasVisibleText) row.dataset.hasRenderedContent = 'true';
    row.dataset.rawText = rawFull;
    return {
      bubble: existing[0] || null,
      content: existing.length ? existing[existing.length - 1].querySelector('.chat-bubble-content') : null,
      bubbles: existing
    };
  }

  /**
   * 渲染追加一条气泡消息
   * @param {'assistant'|'user'} role 发送方
   * @param {string} text 文本内容
   * @param {string} [timeStr] 时间字符串
   * @param {{ role: string, senderTag: string, senderName?: string, text: string }} [quotePayload] 引用对象
   * @param {string} [recordId] 持久化流水 ID
   * @param {string} [senderName] 消息发送者名字快照
   * @param {string} [assistantId] 助手消息所属档案 ID
   * @param {number} [createdAt] 消息创建时间戳
   */
  async function appendMessage(role, text, timeStr, quotePayload, recordId, senderName, assistantId, createdAt, media, messageGroupId, extra) {
    if (!messagesWrap) return;
    const suppliedCreatedAt = normalizeTimestamp(createdAt);
    const messageCreatedAt = suppliedCreatedAt || Date.now();
    const time = timeStr || formatRecordTime(messageCreatedAt);
    const isAssistant = role === 'assistant';
    const activeAssistant = isAssistant ? getCurrentAssistant() : null;
    const resolvedAssistantId = isAssistant ? (assistantId || (activeAssistant && activeAssistant.id) || '') : '';
    const resolvedSenderName = String(senderName || (isAssistant && activeAssistant && activeAssistant.name) || getSenderName(role)).trim();

    const row = document.createElement('div');
    row.className = `chat-msg-row ${isAssistant ? 'assistant' : 'user'}`;
    if (recordId) row.dataset.recordId = recordId;
    if (messageGroupId) row.dataset.messageGroupId = messageGroupId;
    if (resolvedAssistantId) row.dataset.assistantId = resolvedAssistantId;
    row.dataset.senderName = resolvedSenderName;
    if (suppliedCreatedAt || !recordId) row.dataset.createdAt = String(messageCreatedAt);
    if (media && (media.assetKey || media.galleryId || media.visionDescription || media.type === 'image')) {
      row.dataset.visionDescription = String(media.visionDescription || '');
      row.dataset.galleryId = String(media.galleryId || '');
      row.dataset.assetKey = String(media.assetKey || '');
      row.dataset.mediaState = String(media.state || 'active');
    }
    if (media && Array.isArray(media.fileRefs) && media.fileRefs.length) {
      row.dataset.fileRefs = JSON.stringify(media.fileRefs);
    }
    // 环境快照存 dataset：buildChatHistory 从 DOM 取上下文，历史恢复时也走这里回填
    if (extra && extra.envSnapshot) {
      try { row.dataset.envSnapshot = JSON.stringify(extra.envSnapshot); } catch (_) {}
    }

    // 多选模式战术方形复选框 (100% 纯 SVG)
    const checkbox = document.createElement('div');
    checkbox.className = 'chat-batch-checkbox';
    checkbox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    row.appendChild(checkbox);

    // 行点击（在多选模式下切换选中）
    row.addEventListener('click', (e) => {
      if (!isBatchMode) return;
      e.stopPropagation();
      toggleRowSelection(row);
    });

    // 头像与时间列
    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';

    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';

    if (isAssistant) {
      const assistantSrc = await getAssistantAvatarSrc(resolvedAssistantId);
      if (assistantSrc) {
        const img = document.createElement('img');
        img.src = assistantSrc;
        img.alt = `${resolvedSenderName}头像`;
        avatarCircle.appendChild(img);
      } else {
        avatarCircle.innerHTML = SYSTEM_AVATAR_SVG;
      }
    } else {
      // 从「03 个人档案」获取特工头像
      const userSrc = await getUserAvatarSrc();
      if (userSrc) {
        const img = document.createElement('img');
        img.src = userSrc;
        img.alt = '执行员头像';
        avatarCircle.appendChild(img);
      } else {
        avatarCircle.innerHTML = USER_AVATAR_SVG;
      }
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-avatar-time';
    timeSpan.textContent = time;

    avatarCol.append(avatarCircle, timeSpan);

    // 方形战术气泡
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isAssistant ? 'assistant' : 'user'}`;
    bubble.dataset.rawText = text || '';
    if (quotePayload && quotePayload.text) {
      bubble.dataset.quoteRole = quotePayload.role || '';
      bubble.dataset.quoteSender = quotePayload.senderTag || 'QUOTE';
      bubble.dataset.quoteSenderName = quotePayload.senderName || getSenderName(quotePayload.role);
      bubble.dataset.quoteText = quotePayload.text;
    }

    const tag = document.createElement('div');
    tag.className = 'chat-bubble-tag';
    tag.textContent = isAssistant ? `SYSTEM // ${resolvedSenderName}` : 'OPERATIVE';

    bubble.appendChild(tag);

    // 若带有引用内容，渲染内嵌引用微卡
    if (quotePayload && quotePayload.text) {
      const quoteCard = document.createElement('div');
      quoteCard.className = 'chat-bubble-quote';

      const quoteTag = document.createElement('span');
      quoteTag.className = 'chat-bubble-quote-tag';
      quoteTag.textContent = quotePayload.senderName || getSenderName(quotePayload.role);

      const quoteText = document.createElement('p');
      quoteText.className = 'chat-bubble-quote-text';
      quoteText.textContent = quotePayload.text;

      quoteCard.append(quoteTag, quoteText);
      bubble.appendChild(quoteCard);
    }

    const content = document.createElement('div');
    content.className = 'chat-bubble-content';
    if (isAssistant && text === '') {
      content.innerHTML = WAVEFORM_HTML;
    } else {
      renderBubbleText(content, text);
    }

    bubble.appendChild(content);

    // 用户发的图：不塞进气泡，作为裸缩略图独立挂在气泡上方，
    // 与助手生成图统一视觉（无底色、无分割线、保持原始宽高比、点击看大图）。
    let userImageFigure = null;
    if (!isAssistant && media && (media.assetKey || media.galleryId || media.visionDescription || media.type === 'image')) {
      userImageFigure = document.createElement('div');
      userImageFigure.className = 'chat-gen-image';
      await renderGeneratedImageInto(userImageFigure, row, {
        assetKey: media.assetKey,
        state: media.state,
        owner: 'user'
      });
      if (media.type === 'image' && media.state && media.state !== 'active') {
        const visionStatus = document.createElement('div');
        visionStatus.className = `chat-vision-status is-${media.state}`;
        visionStatus.textContent = media.state === 'pending' ? '正在识别影像……' : media.state === 'failed' ? '影像识别失败' : '影像记忆已归档';
        userImageFigure.appendChild(visionStatus);
      }
      if (!text) content.hidden = true;
    }

    // 气泡挂载容器：助手消息会被包进 stack 以支持多气泡分组，用户消息直接挂气泡本身
    let bubbleHost = bubble;

    if (!isAssistant && media && Array.isArray(media.fileRefs) && media.fileRefs.length) {
      const fileCard = document.createElement('div');
      fileCard.className = 'chat-file-card';
      for (const f of media.fileRefs) {
        const item = document.createElement('div');
        item.className = 'chat-file-card-item';
        item.dataset.fileId = f.id;
        item.innerHTML = `
          <span class="chat-file-card-icon">${FILE_DOC_SVG}</span>
          <span class="chat-file-card-body">
            <span class="chat-file-card-name">${escapeChatHtml(f.name)}</span>
            <span class="chat-file-card-meta">${escapeChatHtml(f.sizeText || '')} // ${f.charCount || 0} 字符</span>
          </span>`;
        item.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isBatchMode) return;
          if (window.FileStore && typeof FileStore.getText === 'function') {
            const t = await FileStore.getText(f.id);
            if (t != null && window.FileVaultUI) {
              // 复用文件区的只读预览（若已加载）；否则用简易 alert 回退
              const ev = new CustomEvent('retroflow:preview-file', { detail: { name: f.name, text: t } });
              window.dispatchEvent(ev);
            } else if (t == null && window.RetroToast) {
              RetroToast.show({ tag: 'DOC // 已释放', message: '该文件已从文件区删除，无法预览', type: 'info' });
            }
          }
        });
        fileCard.appendChild(item);
      }
      bubble.insertBefore(fileCard, content);
      if (!text) content.hidden = true;
    }
    if (isAssistant) {
      const stack = document.createElement('div');
      stack.className = 'chat-bubble-stack';
      stack.appendChild(bubble);
      bubbleHost = stack;
    }
    // 用户图存在时，把「图 + 气泡」竖向包一层，保持右对齐且图独立于气泡之外。
    // 纯图无文字且无文件卡时不挂气泡：图已移出气泡，留个空壳会露出孤立的 tag 方块。
    if (userImageFigure) {
      const hasBubbleContent = Boolean(text) || bubble.querySelector('.chat-file-card');
      const mediaStack = document.createElement('div');
      mediaStack.className = 'chat-user-media-stack';
      if (hasBubbleContent) mediaStack.append(userImageFigure, bubbleHost);
      else mediaStack.appendChild(userImageFigure);
      bubbleHost = mediaStack;
    }

    row.append(avatarCol, bubbleHost);
    // 实时追加跨天胶囊：历史恢复由 restoreChatHistory 统一插，这里只管新消息。
    // 与容器里最后一条已渲染消息行比较，跨了午夜就先落一枚当天日期胶囊。
    if (!isRestoringHistory && window.ChatDaySep && messageCreatedAt) {
      const rows = messagesWrap.querySelectorAll('.chat-msg-row');
      const lastRow = rows.length ? rows[rows.length - 1] : null;
      const prevTs = lastRow ? Number(lastRow.dataset.createdAt) : 0;
      if (ChatDaySep.isCrossDay(prevTs, messageCreatedAt)) {
        messagesWrap.appendChild(ChatDaySep.buildPill(messageCreatedAt));
      }
    }
    mountChatNode(row);

    // 绑定气泡长按唤起 HUD 菜单；纯图片消息没有气泡，直接绑定到图片节点。
    if (bubble) bindBubbleLongPress(bubble, role, text, row);
    if (userImageFigure) {
      bindBubbleLongPress(
        userImageFigure,
        'user',
        String(media && media.visionDescription || '').trim() || '[用户发送的图片]',
        row
      );
    }
    const group = isAssistant ? syncAssistantBubbleGroup(row, text) : null;

    // 历史恢复期间统一静默挂载，完成后由恢复流程一次性定位到底部。
    if (chatBody && !isRestoringHistory) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }

    return {
      row,
      bubble: group && group.bubble ? group.bubble : bubble,
      content: group && group.content ? group.content : content,
      sync: isAssistant ? (nextText, options) => syncAssistantBubbleGroup(row, nextText, options) : null
    };
  }

  /**
   * 渲染一条助手生成图消息（独立成行，不进气泡）。
   * 无论气泡分段开关如何，图片都作为裸缩略图独立展示，保持原始宽高比、点击可放大。
   * @param {{galleryId?:string, assetKey?:string, state?:string, src?:string}} media
   */
  async function appendGeneratedImage(media, opts) {
    if (!messagesWrap) return null;
    const options = opts || {};
    const createdAt = normalizeTimestamp(options.createdAt) || Date.now();
    const time = options.timeStr || formatRecordTime(createdAt);
    const active = getCurrentAssistant();
    const resolvedAssistantId = options.assistantId || (active && active.id) || '';
    const resolvedSenderName = String(options.senderName || (active && active.name) || getSenderName('assistant')).trim();

    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant is-gen-image';
    if (options.recordId) row.dataset.recordId = options.recordId;
    if (options.messageGroupId) row.dataset.messageGroupId = options.messageGroupId;
    if (resolvedAssistantId) row.dataset.assistantId = resolvedAssistantId;
    row.dataset.senderName = resolvedSenderName;
    row.dataset.createdAt = String(createdAt);
    row.dataset.genImage = 'true';
    row.dataset.galleryId = String(media.galleryId || '');
    row.dataset.assetKey = String(media.assetKey || '');
    row.dataset.mediaState = String(media.state || 'active');
    row.dataset.imagePrompt = String(media.prompt || '').trim();

    // 多选模式复选框（与普通消息一致，可被批量删除选中）
    const checkbox = document.createElement('div');
    checkbox.className = 'chat-batch-checkbox';
    checkbox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    row.appendChild(checkbox);
    row.addEventListener('click', (e) => {
      if (!isBatchMode) return;
      e.stopPropagation();
      toggleRowSelection(row);
    });

    // 头像与时间列
    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    const assistantSrc = await getAssistantAvatarSrc(resolvedAssistantId);
    if (assistantSrc) {
      const img = document.createElement('img');
      img.src = assistantSrc;
      img.alt = `${resolvedSenderName}头像`;
      avatarCircle.appendChild(img);
    } else {
      avatarCircle.innerHTML = SYSTEM_AVATAR_SVG;
    }
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-avatar-time';
    timeSpan.textContent = time;
    avatarCol.append(avatarCircle, timeSpan);

    // 裸图节点：无气泡底色，保持原始宽高比
    const figure = document.createElement('div');
    figure.className = 'chat-gen-image';
    await renderGeneratedImageInto(figure, row, media);
    bindBubbleLongPress(figure, 'assistant', String(media.prompt || '').trim() || '[助手生成的图片]', row);

    row.append(avatarCol, figure);
    mountChatNode(row);
    if (chatBody && !isRestoringHistory) chatBody.scrollTop = chatBody.scrollHeight;
    return { row, figure };
  }

  /** 把图片渲染进给定容器；资产失效时降级为"影像已释放"占位。 */
  async function renderGeneratedImageInto(figure, row, media) {
    if (!figure) return;
    const released = media.state === 'released' || !media.assetKey;
    if (released) {
      figure.classList.add('is-released');
      figure.innerHTML = `${IMAGE_PLACEHOLDER_SVG}<span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
      return;
    }
    const isUserImage = media.owner === 'user';
    const image = document.createElement('img');
    image.alt = isUserImage ? '发送给系统助手的图片' : '系统助手生成的图片';
    image.loading = 'lazy';
    try {
      const src = media.src || await Storage.getAssetSrc(media.assetKey);
      if (!src) throw new Error('asset released');
      image.src = src;
      image.addEventListener('click', (e) => {
        if (isBatchMode) return;
        e.stopPropagation();
        // 灯箱内要拿原始资产转 dataURL 才能长按保存，故把 assetKey 一并传入
        openGenImageLightbox(src, {
          assetKey: media.assetKey,
          label: isUserImage ? '图片' : '生成图'
        });
      });
      figure.appendChild(image);
    } catch (_) {
      figure.classList.add('is-released');
      figure.innerHTML = `${IMAGE_PLACEHOLDER_SVG}<span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
      if (row) row.dataset.mediaState = 'released';
    }
  }

  /**
   * 图片全屏查看（轻量灯箱，纯放大不做翻页）。
   * 顶栏含关闭与下载；图片会异步换成 dataURL，让系统长按菜单出现「保存图片」
   * ——WebView 对 blob: 既不给保存项也无法落盘，这点与图库大图一致。
   * @param {string} src 立即显示用的图源（可能是 blob:）
   * @param {{assetKey?:string, label?:string}} [opts] 原始资产键与下载类型标签
   */
  function openGenImageLightbox(src, opts) {
    if (!src) return;
    const options = opts || {};
    const label = options.label || '图片';

    const overlay = document.createElement('div');
    overlay.className = 'chat-gen-lightbox';

    // 顶栏：灵动岛保护由 CSS 的 env(safe-area-inset-top) 承担
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

    // 返回键/手势退回优先关灯箱，而不是直接退出整个会话页。
    // 进灯箱压一条历史，关闭时把它消费掉；由手势触发时 popstate 已经消费过，
    // 所以用 closedByPop 标记区分，避免多退一层把用户甩出会话。
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
    } catch (_) {
      // pushState 不可用时退化为纯手动关闭
    }

    // 点遮罩空白处关闭；点图片与顶栏不关（避免长按/点按钮误关）
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target === stage) dismiss();
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });

    // dataURL 是下载与长按保存的共同前提，进灯箱就开始转，转好后无感替换 src
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
        return await blobToDataUrl(raw.data);
      })().catch((err) => {
        console.warn('[System Chat] 图片 dataURL 转换失败：', err);
        return null;
      });
      return dataUrlPromise;
    };

    ensureDataUrl().then((dataUrl) => {
      // 仍在展示同一张时才替换，避免用户已关闭后无意义地占内存
      if (dataUrl && overlay.isConnected) img.src = dataUrl;
    });

    downloadBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        const payload = await ensureDataUrl();
        if (!payload) throw new Error('影像缓存已释放');
        const res = await Downloader.saveImage(payload, label);
        if (window.RetroToast) {
          const isShare = res.via === 'share';
          RetroToast.show({
            tag: 'IMAGE // 导出影像',
            message: isShare ? '已唤起系统保存' : '已触发下载',
            detail: isShare
              ? `${res.name}｜在面板里选择「保存到相册」或任意应用。`
              : `${res.name}｜若相册未出现可长按大图另存。`,
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

  // 初始演示消息流挂载（仅供 UI 效果预览）
  function mountInitialDemoMessages() {
    if (!messagesWrap || messagesWrap.children.length > 0) return;
    appendMessage(
      'assistant',
      '溯流计划因果链路已锁定。我是随身系统助理，当前处于待命状态。\n\n你可以向我询问世界观协议、查询心智侧写，或直接输入指令。',
      '14:28'
    );
    appendMessage(
      'user',
      '调取当前世界线观测参数与执行偏好。',
      '14:29'
    );
    // 间插演示：工具调用卡片
    appendToolCard({
      name: 'query_worldline_params',
      tag: 'SYSTEM // 工具调用',
      input: { worldId: 'WL-007', depth: 0.88, filter: 'active_anomalies' },
      output: { status: 'stable', anomalies: 2, causal_drift: 0.04, latency_ms: 128 },
      status: 'success'
    });
    appendMessage(
      'assistant',
      '因果参数调取完成。\n【当前状态】：稳态下潜中\n【精神值】：100 / 100\n【执行偏好】：理性为主导维度。随时可下达下一步因果推演指令。',
      '14:29'
    );
  }

  /**
   * 胶囊行长按 HUD：只提供「多选」与「删除」。
   * 复制/编辑/引用/重写对工具结果与撤回提示都没有语义，故不给。
   * @param {HTMLElement} row 胶囊行
   * @param {string} pillLabel 用于确认弹窗的对象描述
   */
  function bindPillLongPress(row, pillLabel) {
    if (!row) return;
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    function startPress(e) {
      if (isBatchMode) return;
      if (e.touches && e.touches.length > 1) return;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        openPillContextHud(row, pillLabel, { x: startX, y: startY });
      }, 450);
    }

    function cancelPress() {
      clearTimeout(pressTimer);
    }

    function movePress(e) {
      if (!pressTimer) return;
      const point = e.touches ? e.touches[0] : e;
      if (Math.abs(point.clientX - startX) > 8 || Math.abs(point.clientY - startY) > 8) {
        clearTimeout(pressTimer);
      }
    }

    row.addEventListener('touchstart', startPress, { passive: true });
    row.addEventListener('touchend', cancelPress);
    row.addEventListener('touchcancel', cancelPress);
    row.addEventListener('touchmove', movePress, { passive: true });

    row.addEventListener('mousedown', startPress);
    row.addEventListener('mouseup', cancelPress);
    row.addEventListener('mouseleave', cancelPress);
  }

  /** 胶囊行的双项 HUD，定位规则与气泡 HUD 一致 */
  function openPillContextHud(row, pillLabel, touchPos) {
    closeActiveHud();

    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch (_) {}
    }

    const pill = row.querySelector('.chat-status-pill');
    if (pill) {
      pill.classList.add('is-locked');
      activeLockedBubble = pill;
    }

    const menuItems = [
      { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
      { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
    ];

    const hud = document.createElement('div');
    hud.className = 'chat-context-hud';

    const grid = document.createElement('div');
    grid.className = 'chat-hud-grid cols-2';

    menuItems.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-hud-item ${item.isDanger ? 'is-danger' : ''}`;
      btn.dataset.action = item.key;

      btn.innerHTML = `
        ${item.icon}
        <span class="chat-hud-item-zh">${item.zh}</span>
        <span class="chat-hud-item-en">${item.en}</span>
      `;

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        closeActiveHud();
        if (item.key === 'select') {
          enterBatchMode(row);
          return;
        }
        await deletePillRow(row, pillLabel);
      });

      grid.appendChild(btn);
    });

    hud.appendChild(grid);
    chatPage.appendChild(hud);
    activeHudEl = hud;

    const chatRect = chatPage.getBoundingClientRect();
    const anchorRect = (pill || row).getBoundingClientRect();
    const hudWidth = 133;
    const hudHeight = 76;

    const anchorX = (touchPos && touchPos.x) ? touchPos.x : (anchorRect.left + anchorRect.width / 2);
    let left = anchorX - (hudWidth / 2) - chatRect.left;
    left = Math.max(12, Math.min(left, chatRect.width - hudWidth - 12));

    const anchorY = (touchPos && touchPos.y) ? touchPos.y : anchorRect.top;
    let top = anchorY - chatRect.top - hudHeight - 20;
    if (top < 68) {
      top = anchorY - chatRect.top + 28;
    }

    const footerEl = chatPage.querySelector('.system-chat-footer');
    const maxTop = footerEl ? (footerEl.getBoundingClientRect().top - chatRect.top - hudHeight - 10) : (chatRect.height - hudHeight - 80);
    top = Math.min(top, maxTop);
    top = Math.max(68, top);

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  /** 单删一张胶囊卡片：先抹库再退场，与消息行删除同构 */
  async function deletePillRow(row, pillLabel) {
    if (!row) return;
    const label = pillLabel || '此条记录';

    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: 'PURGE // 抹除记录',
        message: `确认要彻底删除${label}吗？`,
        detail: '删除后该记录不再进入上下文，无法撤销。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    const recordId = row.dataset.recordId;
    if (recordId) {
      try {
        await removeChatRecordIds([recordId]);
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'PURGE // FAILED', message: '记录删除失败，请稍后重试。', type: 'warning' });
        }
        return;
      }
    }

    row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    row.style.opacity = '0';
    row.style.transform = 'scale(0.95)';
    setTimeout(() => row.remove(), 200);
  }

  /**
   * 给胶囊行（工具调用 / 撤回通知）装上多选能力。
   * 与消息行同构：同一套 chat-batch-checkbox + 行点击切换选中，
   * 使其能被全选、批量删除与回溯统一纳管。
   * @param {HTMLElement} row 胶囊行节点
   */
  function attachPillBatchSelection(row) {
    if (!row) return;

    const checkbox = document.createElement('div');
    checkbox.className = 'chat-batch-checkbox';
    checkbox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    row.appendChild(checkbox);

    row.addEventListener('click', (e) => {
      if (!isBatchMode) return;
      e.stopPropagation();
      toggleRowSelection(row);
    });
  }

  /**
   * 渲染追加一条间插战术工具调用卡片
   * @param {Object} tool
   * @param {string} tool.name 工具名称
   * @param {string} [tool.tag] 标签
   * @param {any} [tool.input] 输入参数
   * @param {any} [tool.output] 执行结果
   * @param {string} [tool.status] 状态
   */
  function appendToolCard(tool) {
    if (!messagesWrap || !tool) return;

    const row = document.createElement('div');
    row.className = 'chat-status-pill-row';
    // 工具卡片行携带上下文信息，供 buildChatHistory 恢复后回灌，并支持刷新重建。
    row.dataset.toolCall = 'true';
    row.dataset.toolName = String(tool.name || 'tool');
    row.dataset.toolStatus = String(tool.status || 'success');
    row.dataset.toolOutput = String(tool.output == null ? '' : tool.output);
    if (arguments.length > 1 && arguments[1]) {
      const meta = arguments[1];
      if (meta.recordId) row.dataset.recordId = meta.recordId;
      if (meta.createdAt) row.dataset.createdAt = String(meta.createdAt);
    }

    // 多选能力：工具结果能进上下文，就必须能被删除
    attachPillBatchSelection(row);
    bindPillLongPress(row, `工具调用「${toolLabel(tool.name)}」的记录`);

    const pill = document.createElement('div');
    pill.className = 'chat-status-pill is-clickable';
    pill.setAttribute('role', 'button');
    pill.setAttribute('title', '点击查看工具调用详情');

    pill.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <!-- 纯 SVG 战术终端/工具齿轮微标 -->
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
      <span class="chat-status-pill-tag">${tool.tag || 'TOOL'}</span>
      <span class="chat-status-pill-text">${toolLabel(tool.name)}</span>
      <svg class="chat-status-pill-arrow" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
      </svg>
    `;

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      // 批量模式下点击一律解释为勾选，不弹详情
      if (isBatchMode) {
        toggleRowSelection(row);
        return;
      }
      openToolInspectModal(tool);
    });

    row.appendChild(pill);
    mountChatNode(row);

    if (chatBody && !isRestoringHistory) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }
  }

  /**
   * 渲染追加一条系统静态通知胶囊 (如撤回提示)
   * @param {string} messageText 提示文字
   */
  function appendSystemNotice(messageText, recordId, createdAt) {
    if (!messagesWrap || !messageText) return null;

    const row = document.createElement('div');
    row.className = 'chat-status-pill-row';
    row.dataset.systemNotice = 'true';
    row.dataset.contextRole = 'system';
    row.dataset.rawText = String(messageText);
    const noticeCreatedAt = normalizeTimestamp(createdAt);
    if (noticeCreatedAt) row.dataset.createdAt = String(noticeCreatedAt);
    if (recordId) row.dataset.recordId = recordId;

    // 多选能力：撤回提示同样进上下文，需可被一并抹除
    attachPillBatchSelection(row);
    bindPillLongPress(row, '此条撤回提示');

    const pill = document.createElement('div');
    pill.className = 'chat-status-pill';

    pill.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <!-- 纯 SVG 撤回小微标 -->
        <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
      </svg>
      <span class="chat-status-pill-text"></span>
    `;
    const noticeText = pill.querySelector('.chat-status-pill-text');
    if (noticeText) noticeText.textContent = messageText;

    row.appendChild(pill);
    mountChatNode(row);

    if (chatBody && !isRestoringHistory) {
      chatBody.scrollTop = chatBody.scrollHeight;
    }
    return row;
  }

  // 弹出工具调用详情查看弹窗
  function openToolInspectModal(tool) {
    const overlay = document.createElement('div');
    overlay.className = 'chat-tool-inspect-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'chat-tool-inspect-card';

    const formattedInput = typeof tool.input === 'object' ? JSON.stringify(tool.input, null, 2) : (tool.input || '无输入参数');
    const formattedOutput = typeof tool.output === 'object' ? JSON.stringify(tool.output, null, 2) : (tool.output || '执行完毕');

    card.innerHTML = `
      <div class="chat-tool-inspect-header">
        <div class="chat-tool-inspect-title-row">
          <svg class="chat-tool-inspect-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
          <span class="chat-tool-inspect-title">${tool.name}</span>
        </div>
        <button class="chat-tool-inspect-close" id="chatToolInspectCloseBtn" type="button" aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>

      <div class="chat-tool-inspect-body">
        <div class="chat-tool-inspect-section">
          <span class="chat-tool-inspect-label">STATUS // 状态</span>
          <div class="chat-tool-inspect-status-badge">
            <span class="chat-status-dot"></span>
            <span>SUCCESS // 200 OK</span>
          </div>
        </div>

        <div class="chat-tool-inspect-section">
          <span class="chat-tool-inspect-label">INPUT PARAMS // 输入参数</span>
          <pre class="chat-tool-inspect-code">${formattedInput}</pre>
        </div>

        <div class="chat-tool-inspect-section">
          <span class="chat-tool-inspect-label">OUTPUT RESULT // 执行结果</span>
          <pre class="chat-tool-inspect-code">${formattedOutput}</pre>
        </div>
      </div>

      <div class="chat-tool-inspect-footer">
        <button class="chat-tool-inspect-btn" id="chatToolInspectConfirmBtn" type="button">关闭</button>
      </div>
    `;

    function closeModal() {
      overlay.style.transition = 'opacity 0.16s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 160);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });

    const closeBtn = card.querySelector('#chatToolInspectCloseBtn');
    const confirmBtn = card.querySelector('#chatToolInspectConfirmBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (confirmBtn) confirmBtn.addEventListener('click', closeModal);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  // HUD 菜单动作图标 (100% 纯 SVG)
  const HUD_ICONS = {
    copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    speak: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    rewrite: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    quote: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>`,
    select: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
    recall: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>`,
    delete: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`
  };

  let activeHudEl = null;
  let activeLockedBubble = null;

  // 关闭当前开启的 HUD 悬浮舱
  function closeActiveHud() {
    if (activeHudEl) {
      activeHudEl.remove();
      activeHudEl = null;
    }
    if (activeLockedBubble) {
      activeLockedBubble.classList.remove('is-locked');
      activeLockedBubble = null;
    }
  }

  // 绑定气泡长按逻辑
  function bindBubbleLongPress(bubble, role, text, row) {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    function startPress(e) {
      if (e.touches && e.touches.length > 1) return;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        openContextHud(bubble, role, text, row, { x: startX, y: startY });
      }, 450);
    }

    function cancelPress(e) {
      clearTimeout(pressTimer);
    }

    function movePress(e) {
      if (!pressTimer) return;
      const point = e.touches ? e.touches[0] : e;
      if (Math.abs(point.clientX - startX) > 8 || Math.abs(point.clientY - startY) > 8) {
        clearTimeout(pressTimer);
      }
    }

    bubble.addEventListener('touchstart', startPress, { passive: true });
    bubble.addEventListener('touchend', cancelPress);
    bubble.addEventListener('touchcancel', cancelPress);
    bubble.addEventListener('touchmove', movePress, { passive: true });

    bubble.addEventListener('mousedown', startPress);
    bubble.addEventListener('mouseup', cancelPress);
    bubble.addEventListener('mouseleave', cancelPress);
  }

  // 弹出战术 HUD 悬浮舱 (智能吸附于手指长按落点与当前可视视口)
  function openContextHud(bubble, role, text, row, touchPos) {
    closeActiveHud();

    // 震动触觉反馈（若设备支持）
    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch (_) {}
    }

    bubble.classList.add('is-locked');
    activeLockedBubble = bubble;

    const isAssistant = role === 'assistant';
    const messageRows = messagesWrap ? Array.from(messagesWrap.querySelectorAll('.chat-msg-row')) : [];
    
    // 判断是否允许重写：必须是助手消息，且从该行到最后都不能有用户（user）消息，且当前不在推理中
    let canRewrite = false;
    if (isAssistant && messageRows.length > 0 && !activeAbortController) {
      const currentIndex = messageRows.indexOf(row);
      if (currentIndex >= 0) {
        const rowsAfter = messageRows.slice(currentIndex);
        const hasUserAfter = rowsAfter.some(r => r.classList.contains('user'));
        canRewrite = !hasUserAfter;
      }
    }

    // 菜单配置矩阵
    // 图片气泡（生成图 / 用户发图）复用 edit 入口，但语义是「只读查看描述」
    //（生图提示词 / 识图结果），不接受回写 —— 避免用户以为能改。
    const isImageBubble = Boolean(bubble && bubble.classList && bubble.classList.contains('chat-gen-image'));
    const editItem = isImageBubble
      ? { key: 'edit', zh: '查看描述', en: 'VIEW', icon: HUD_ICONS.edit }
      : { key: 'edit', zh: '编辑', en: 'EDIT', icon: HUD_ICONS.edit };
    const menuItems = isAssistant
      ? [
          { key: 'copy', zh: '复制', en: 'COPY', icon: HUD_ICONS.copy },
          { key: 'speak', zh: '语音', en: 'TTS', icon: HUD_ICONS.speak },
          editItem,
          { key: 'rewrite', zh: '重写', en: 'REWRITE', icon: HUD_ICONS.rewrite, disabled: !canRewrite }, 
          { key: 'quote', zh: '引用', en: 'QUOTE', icon: HUD_ICONS.quote },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ]
      : [
          editItem,
          { key: 'quote', zh: '引用', en: 'QUOTE', icon: HUD_ICONS.quote },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'recall', zh: '撤回', en: 'RECALL', icon: HUD_ICONS.recall },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ];

    const hud = document.createElement('div');
    hud.className = 'chat-context-hud';

    const grid = document.createElement('div');
    grid.className = `chat-hud-grid ${isAssistant ? 'cols-4' : 'cols-3'}`;

    menuItems.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-hud-item ${item.isDanger ? 'is-danger' : ''}`;
      btn.dataset.action = item.key;
      btn.disabled = Boolean(item.disabled);
      if (item.disabled) btn.setAttribute('aria-disabled', 'true');

      btn.innerHTML = `
        ${item.icon}
        <span class="chat-hud-item-zh">${item.zh}</span>
        <span class="chat-hud-item-en">${item.en}</span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleHudAction(item.key, item.zh, bubble, text, row, role);
        closeActiveHud();
      });

      grid.appendChild(btn);
    });

    hud.appendChild(grid);
    chatPage.appendChild(hud);
    activeHudEl = hud;

    // 智能视口与触控落点吸附定位
    const chatRect = chatPage.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const hudWidth = isAssistant ? 260 : 202;
    const hudHeight = isAssistant ? 134 : 134;

    // 水平位置：优先以手指点击 X 为中心，若未获取则以气泡中心为准
    const anchorX = (touchPos && touchPos.x) ? touchPos.x : (bubbleRect.left + bubbleRect.width / 2);
    let left = anchorX - (hudWidth / 2) - chatRect.left;
    // 左右边界防贴边安全留白 (12px)
    left = Math.max(12, Math.min(left, chatRect.width - hudWidth - 12));

    // 垂直位置：基于手指长按 Y 坐标就近悬浮（留出 20px 呼吸间距与手指避让）
    const anchorY = (touchPos && touchPos.y) ? touchPos.y : bubbleRect.top;
    let top = anchorY - chatRect.top - hudHeight - 20;

    // 若上方空间不足（靠近顶栏 < 68px），则自动翻转到手指下方 (+28px)
    if (top < 68) {
      top = anchorY - chatRect.top + 28;
    }

    // 底部防撞（输入框区域上方安全留白）
    const footerEl = chatPage.querySelector('.system-chat-footer');
    const maxTop = footerEl ? (footerEl.getBoundingClientRect().top - chatRect.top - hudHeight - 10) : (chatRect.height - hudHeight - 80);
    top = Math.min(top, maxTop);
    top = Math.max(68, top);

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  async function rewindFromRow(targetRow) {
    if (!targetRow || !messagesWrap) return;
    const rows = Array.from(messagesWrap.querySelectorAll(SELECTABLE_ROW_SELECTOR));
    const targetIndex = rows.indexOf(targetRow);
    if (targetIndex < 0) return;

    const isUserRow = targetRow.classList.contains('user');

    // 如果选中的是用户自己的气泡：回溯范围包含当前行本身（把当前行及之后的所有消息都删除并回填当前文本）
    // 如果选中的是助手气泡：保留当前行，删除当前行之后的所有消息
    const rowsToDelete = isUserRow ? rows.slice(targetIndex) : rows.slice(targetIndex + 1);

    if (!rowsToDelete.length) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // NO OPERATION', message: '当前消息已经位于会话末端。', type: 'info' });
      }
      return;
    }

    // 确定要退回输入框的内容：
    // 用户气泡自身回溯时，退回当前这行；助手气泡回溯时，退回后续中最后一条用户消息
    let restoredText = '';
    if (isUserRow) {
      const bubble = targetRow.querySelector('.chat-bubble');
      restoredText = (typeof targetRow.dataset.rawText === 'string' && targetRow.dataset.rawText)
        ? targetRow.dataset.rawText
        : (bubble && typeof bubble.dataset.rawText === 'string' ? bubble.dataset.rawText : '');
    } else {
      const latestUserRow = rowsToDelete.slice().reverse().find(item => item.classList.contains('user'));
      const latestUserBubble = latestUserRow ? latestUserRow.querySelector('.chat-bubble') : null;
      restoredText = latestUserRow
        ? (typeof latestUserRow.dataset.rawText === 'string' && latestUserRow.dataset.rawText
          ? latestUserRow.dataset.rawText
          : (latestUserBubble && typeof latestUserBubble.dataset.rawText === 'string' ? latestUserBubble.dataset.rawText : ''))
        : '';
    }

    const recordIds = rowsToDelete.map(item => item.dataset.recordId).filter(Boolean);
    const rememberKey = 'retroflow_system_chat_rewind_confirmed_v1';
    let skipConfirm = false;
    try { skipConfirm = localStorage.getItem(rememberKey) === '1'; } catch (_) { /* 使用确认框 */ }

    if (!skipConfirm && window.RetroModal && typeof RetroModal.confirm === 'function') {
      const confirmed = await RetroModal.confirm({
        tag: 'REWIND // 回溯会话',
        message: '确认回溯到此条消息吗？',
        detail: isUserRow 
          ? `将删除此条及后续共 ${rowsToDelete.length} 条内容，此条内容会退回输入框。`
          : `此消息之后的 ${rowsToDelete.length} 条内容将被永久删除，最近一条执行员消息会退回输入框。`,
        confirmText: '确认回溯',
        cancelText: '取消',
        danger: true,
        rememberKey
      });
      if (!confirmed) return;
    }

    try {
      await removeChatRecordIds(recordIds);
    } catch (err) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // FAILED', message: '后续记录删除失败，当前会话未改动。', type: 'warning' });
      }
      return;
    }

    rowsToDelete.forEach(item => item.remove());
    if (textarea && restoredText) {
      textarea.value = restoredText;
      clearCurrentQuote();
      autoResizeTextarea();
      textarea.focus();
    }
  }

  // 处理 HUD 菜单动作
  async function handleHudAction(actionKey, actionZh, bubble, text, row, role) {
    console.log(`[System Chat HUD] 触发动作: ${actionKey} - ${actionZh}`);

    switch (actionKey) {
      case 'copy':
        {
          const targetRaw = (bubble && typeof bubble.dataset.segmentText === 'string' && bubble.dataset.segmentText)
            ? bubble.dataset.segmentText
            : ((bubble && typeof bubble.dataset.rawText === 'string') ? bubble.dataset.rawText : text);
          const cleanText = (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripMarkdown === 'function')
            ? RetroflowMarkdown.stripMarkdown(targetRaw)
            : String(targetRaw || '').trim();

          if (!cleanText) {
            if (window.RetroToast) RetroToast.show({ tag: 'COPY // 空内容', message: '当前消息无有效纯文本可复制', type: 'info' });
            return;
          }

          let copied = false;
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            try {
              await navigator.clipboard.writeText(cleanText);
              copied = true;
            } catch (_) {
              copied = false;
            }
          }

          if (!copied) {
            try {
              const helper = document.createElement('textarea');
              helper.value = cleanText;
              helper.style.position = 'fixed';
              helper.style.opacity = '0';
              document.body.appendChild(helper);
              helper.select();
              copied = document.execCommand('copy');
              helper.remove();
            } catch (_) {
              copied = false;
            }
          }

          if (window.RetroToast) {
            if (copied) {
              RetroToast.show({ tag: 'COPY // 复制成功', message: '纯文本已复制到剪贴板', type: 'info' });
            } else {
              RetroToast.show({ tag: 'COPY // 复制失败', message: '未能写入剪贴板，请检查权限', type: 'warning' });
            }
          }
        }
        break;
      case 'speak':
        await speakAssistantBubble(bubble, text);
        break;
      case 'edit':
        if (window.TextEditorModal && typeof TextEditorModal.open === 'function') {
          // 图片气泡（生成图 / 用户发图）只读查看：生图提示词 / 识图结果，
          // 底层改写它们对画面无实际作用，统一走只读模态避免误导用户以为可编辑。
          const isImageBubble = Boolean(bubble && bubble.classList && bubble.classList.contains('chat-gen-image'));
          if (isImageBubble) {
            const isGenImg = Boolean(row && row.classList.contains('assistant'));
            TextEditorModal.open({
              title: isGenImg ? '生图提示词' : '识图结果',
              tag: isGenImg ? 'IMAGE // 生成提示词' : 'VISION // 识别结果',
              value: String(text || '').trim() || (isGenImg ? '（无生图提示词记录）' : '（暂无识图结果）'),
              readOnly: true
            });
            break;
          }
          const rawValue = (bubble && typeof bubble.dataset.rawText === 'string') ? bubble.dataset.rawText : text;
          TextEditorModal.open({
            title: '编辑消息',
            tag: 'MESSAGE // 修改记忆',
            value: rawValue,
            maxLength: 8000
          }).then(async (updated) => {
            if (updated !== null && updated !== undefined && updated.trim()) {
              const newText = updated.trim();

              // 先覆盖同一条持久化记录；成功后才更新画面，避免 UI 与上下文记录分叉
              if (row && row.dataset.recordId) {
                try {
                  const updatedRecord = await updateChatRecordContent(row.dataset.recordId, newText);
                  if (!updatedRecord) throw new Error('找不到待编辑的消息记录');
                } catch (err) {
                  if (window.RetroToast) {
                    RetroToast.show({ tag: 'MEMORY // WRITE FAILED', message: '消息修改未能写入上下文记录。', type: 'warning' });
                  }
                  return;
                }
              }

              if (bubble) bubble.dataset.rawText = newText;
              if (row && row.classList.contains('assistant')) {
                syncAssistantBubbleGroup(row, newText);
              } else {
                const contentEl = bubble.querySelector('.chat-bubble-content');
                if (contentEl) renderBubbleText(contentEl, newText);
              }
            }
          });
        }
        break;
      case 'rewrite':
        if (role === 'assistant') {
          await rewriteLatestAssistantRow(row);
        }
        break;
      case 'delete':
        if (window.RetroModal && typeof RetroModal.confirm === 'function') {
          const ok = await RetroModal.confirm({
            tag: 'PURGE // 抹除记录',
            message: '确认要彻底删除此条消息吗？',
            detail: '该条消息将从当前会话中永久清除，无法撤销。',
            confirmText: '确认删除',
            cancelText: '取消',
            danger: true
          });
          if (!ok) return;
        }
        if (row) {
          const recordId = row.dataset.recordId;
          if (recordId && Storage.removeRecord) {
            try {
              await removeChatRecordIds([recordId]);
            } catch (err) {
              if (window.RetroToast) RetroToast.show({ tag: 'PURGE // FAILED', message: '记录删除失败，请稍后重试。', type: 'warning' });
              return;
            }
          }
          row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
          row.style.opacity = '0';
          row.style.transform = 'scale(0.95)';
          setTimeout(() => row.remove(), 200);
        }
        break;
      case 'recall':
        if (row && role === 'user') {
          const recordId = row.dataset.recordId;
          const senderName = String(row.dataset.senderName || getCurrentUserName()).trim() || '执行员';
          const rawText = typeof row.dataset.rawText === 'string'
            ? row.dataset.rawText
            : ((bubble && typeof bubble.dataset.rawText === 'string') ? bubble.dataset.rawText : text);
          try {
            let originalCreatedAt = Date.now();
            if (recordId && Storage.getRecordsByFork) {
              const records = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID);
              const originalRecord = records.find(item => item && item.id === recordId);
              if (originalRecord && originalRecord.createdAt) originalCreatedAt = originalRecord.createdAt;
            }
            const noticeRecord = await persistRecallNotice(senderName, originalCreatedAt);
            try {
              if (recordId) await removeChatRecordIds([recordId]);
            } catch (removeErr) {
              await removeChatRecordIds([noticeRecord.id]).catch(() => {});
              throw removeErr;
            }
            const noticeRow = appendSystemNotice(noticeRecord.content, noticeRecord.id, noticeRecord.eventAt);
            if (noticeRow) row.replaceWith(noticeRow);
            else row.remove();
            if (textarea) {
              textarea.value = rawText;
              clearCurrentQuote();
              autoResizeTextarea();
              textarea.focus();
            }
          } catch (err) {
            if (window.RetroToast) {
              RetroToast.show({ tag: 'RECALL // FAILED', message: '消息撤回失败，当前会话未改动。', type: 'warning' });
            }
          }
        }
        break;
      case 'rewind':
        await rewindFromRow(row);
        break;
      case 'quote':
        currentQuotePayload = {
          role,
          senderTag: role === 'assistant' ? 'SYSTEM' : 'OPERATIVE',
          senderName: (row && String(row.dataset.senderName || '').trim()) || getSenderName(role),
          text: (bubble && typeof bubble.dataset.segmentText === 'string')
            ? bubble.dataset.segmentText
            : ((bubble && typeof bubble.dataset.rawText === 'string') ? bubble.dataset.rawText : text)
        };
        if (quoteDraftBar && quoteDraftTag && quoteDraftSnippet) {
          quoteDraftTag.textContent = currentQuotePayload.senderName;
          quoteDraftSnippet.textContent = currentQuotePayload.text.replace(/\s+/g, ' ');
          quoteDraftBar.hidden = false;
        }
        if (textarea) {
          textarea.focus();
        }
        break;
      case 'select':
        enterBatchMode(row);
        break;
      default:
        if (window.RetroToast) {
          window.RetroToast.show({
            tag: `ACTION // ${actionKey.toUpperCase()}`,
            message: `已触发「${actionZh}」操作（待对接完整业务链路）`,
            type: 'info'
          });
        }
        break;
    }
  }

  // 清除当前引用待发卡片
  function clearCurrentQuote() {
    currentQuotePayload = null;
    if (quoteDraftBar) {
      quoteDraftBar.hidden = true;
    }
  }

  if (quoteDraftClose) {
    quoteDraftClose.addEventListener('click', (e) => {
      e.stopPropagation();
      clearCurrentQuote();
    });
  }

  /**
   * 剥掉助手回复开头自行复述的元数据标注（时间戳、环境读数等）。
   *
   * 上下文里每条消息都带 [消息时间：…] 前缀，最近两条还会带 [充电中 电量76%]，
   * 外加一条 [现实时间基准] 系统消息。模型容易把这套后台格式当成回复模板照抄，
   * 在正文开头自造一行播报。提示词已明令禁止，但那是概率约束；这里做确定性兜底。
   *
   * 只裁「开头连续出现的、语义属于时间/电量的独立标注行」，且必须整行成立：
   *   - [当前时间：2026年08月15日 22:18 星期日]
   *   - 【当前时间】2026-08-15
   *   - [充电中 电量76%]
   * 正文中间的方括号一概不动，避免误伤 Markdown、代码、文件引用与角色台词。
   * 思维链在此之前已被合成进原文，故需跳过开头的 <think> 块再判断。
   * @param {string} rawText 助手原文（可能含思维链与动作标记）
   * @returns {string}
   */
  function stripEchoedTimePrefix(rawText) {
    if (typeof rawText !== 'string' || !rawText) return String(rawText || '');

    // 时间语义关键词：标注名里命中其一，才认定这是时间播报
    const TIME_KEYWORD = /(时间|日期|星期|时刻|电量|充电|now|date|time|weekday|battery)/i;
    // 取值像时间：含数字，或含星期/周几的中文写法
    const TIME_VALUE = /(\d|星期|周[一二三四五六日天])/;
    // 整行被成对符号包裹：[…]、【…】、(…)、（…）
    const WRAPPED_LINE = /^\s*(?:\[([^\]\n]*)\]|【([^】\n]*)】|\(([^)\n]*)\)|（([^）\n]*)）)\s*$/;
    // 标注后紧跟取值：【当前时间】2026年8月15日、[当前时间] 22:18
    const LABELED_LINE = /^\s*(?:\[([^\]\n]*)\]|【([^】\n]*)】)\s*[：:]?\s*([^\n]*)$/;
    // 无包裹裸行：当前时间：2026年8月15日 22:18 星期日
    const BARE_LINE = /^\s*(?:当前|现实|此刻|系统|本次)?\s*(?:时间|日期|时刻)\s*(?:基准)?\s*[：:]\s*(\S[^\n]*)$/;

    /** 判断某一行是否为「模型自己复述的时间标注行」 */
    function isTimeNoticeLine(line) {
      if (!line || !line.trim()) return false;

      // 形态一：整行是一个包裹标注，内部含时间语义
      // 覆盖 [当前时间：2026年8月15日 22:18 星期日]
      const wrapped = line.match(WRAPPED_LINE);
      if (wrapped) {
        const inner = wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? wrapped[4] ?? '';
        return TIME_KEYWORD.test(inner);
      }

      // 形态二：标注名含时间语义，且后面跟着像时间的取值
      const labeled = line.match(LABELED_LINE);
      if (labeled) {
        const label = labeled[1] ?? labeled[2] ?? '';
        const value = labeled[3] || '';
        return TIME_KEYWORD.test(label) && TIME_VALUE.test(value);
      }

      // 形态三：裸行时间播报，取值必须像时间，避免吃掉「时间：我们再约」这类正文
      const bare = line.match(BARE_LINE);
      if (bare) return TIME_VALUE.test(bare[1] || '');

      return false;
    }

    // 开头的思维链块必须原样保留：它是界面折叠面板的数据来源
    let prefix = '';
    let body = rawText;
    const thinkMatch = body.match(/^\s*<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>\s*/i);
    if (thinkMatch) {
      prefix = thinkMatch[0];
      body = body.slice(thinkMatch[0].length);
    }

    const lines = body.split('\n');
    let cut = 0;
    while (cut < lines.length) {
      // 空行本身不构成裁剪理由：向后探一步，只有后面仍是标注行才连空行一起吃掉
      if (!lines[cut].trim()) {
        let probe = cut + 1;
        while (probe < lines.length && !lines[probe].trim()) probe += 1;
        if (probe >= lines.length || !isTimeNoticeLine(lines[probe])) break;
        cut = probe + 1;
        continue;
      }
      if (!isTimeNoticeLine(lines[cut])) break;
      cut += 1;
    }

    if (cut === 0) return rawText;

    const stripped = lines.slice(cut).join('\n').replace(/^\s*\n/, '');
    // 整条回复只有时间标注时保留原文：宁可让它露出来，也不要把气泡清成空白
    if (!stripped.trim()) return rawText;
    return prefix + stripped;
  }

  function stripThinkingFromContext(rawText) {
    if (typeof rawText !== 'string' || !rawText) return '';
    return rawText
      // 完整闭合的思维链块：同时支持 think / thinking，且必须同名闭合
      .replace(/<(think|thinking)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      // 流式中断导致的未闭合思维链：从起始标签一直移除到文本末尾
      .replace(/<(think|thinking)\b[^>]*>[\s\S]*$/gi, '')
      // 清理孤立残留的闭合标签，避免进入模型上下文
      .replace(/<\/(think|thinking)\s*>/gi, '')
      .trim();
  }

  /**
   * 构建喂给 AI 的对话上下文。
   *
   * 关键：从存储层（IndexedDB）读全量记录构建，而非从 DOM 遍历——渲染分页后
   * DOM 只挂载最新 N 条，若仍从 DOM 取，助手会直接失忆。上下文与渲染必须解耦。
   *
   * @param {object} [options]
   * @param {HTMLElement} [options.stopBeforeRow] 回溯重写用：从该 DOM 行对应的记录之前截断
   *        （内部转成 recordId 比较，不再依赖 DOM 遍历）
   */
  async function buildChatHistory(options) {
    const stopBeforeRow = options && options.stopBeforeRow ? options.stopBeforeRow : null;
    // 回溯重写传的是 DOM 行；取它的 recordId 作为存储侧的截断锚点。
    const stopBeforeRecordId = stopBeforeRow && stopBeforeRow.dataset
      ? String(stopBeforeRow.dataset.recordId || '')
      : '';

    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') return [];
    let allRecords = [];
    try {
      allRecords = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID) || [];
    } catch (err) {
      console.warn('[System Chat] buildChatHistory 读取存储失败：', err);
      return [];
    }

    // 截断：遇到锚点记录即停，只取它之前的历史（与旧的 DOM stopBeforeRow 语义一致）。
    const records = [];
    for (const rec of allRecords) {
      if (!rec) continue;
      if (stopBeforeRecordId && String(rec.id || '') === stopBeforeRecordId) break;
      records.push(rec);
    }

    const history = [];
    const includeTime = isTimePerceptionEnabled();

    // 判定一条记录是否为「普通聊天消息」（区别于 notice / tool / 生图）。
    const isChatMsg = (rec) => rec.kind === SYSTEM_CHAT_RECORD_KIND
      && rec.messageType !== 'assistant-image';
    const isToolRec = (rec) => rec.kind === SYSTEM_CHAT_TOOL_KIND;
    const isNoticeRec = (rec) => rec.kind === SYSTEM_CHAT_NOTICE_KIND && rec.noticeType === 'recall';
    const isGenImageRec = (rec) => rec.kind === SYSTEM_CHAT_RECORD_KIND
      && rec.messageType === 'assistant-image' && rec.genImageRef;

    // 找出最后一条带文件的用户消息：只有它注入全文，更早的降级为占位摘要（阅后即焚）。
    let lastFileRecordId = '';
    for (const rec of records) {
      if (rec.role === 'user' && rec.fileRefs && rec.fileRefs.length) lastFileRecordId = String(rec.id || '');
    }

    // 工具结果保留轮数：一轮 = 一条用户消息 + 助手对它的整个回复（含该回复内的全部工具调用）。
    // 从最新往回数，超出保留轮数的工具结果降级为占位。keepTurns = 1 表示只保留当前这一轮。
    const keepTurns = getToolResultKeepTurns();
    const staleToolIds = new Set();
    {
      // 当前轮记为第 1 轮：工具卡片总是跟在某条用户消息之后，故先置 1
      let turnIndex = 1;
      for (let i = records.length - 1; i >= 0; i -= 1) {
        const rec = records[i];
        if (isToolRec(rec)) {
          if (turnIndex > keepTurns) staleToolIds.add(String(rec.id || ''));
          continue;
        }
        // 每往回跨过一条用户消息，就退到更早的一轮
        if (isChatMsg(rec) && rec.role !== 'assistant') {
          turnIndex += 1;
        }
      }
    }

    // 环境感知：按对话轮计额度，每轮只标该轮最后一条用户消息。
    //
    // 轮的边界以助手回复为准，而非「每条用户消息算一轮」：执行员一次连发五条
    // 再点推演，这五条的电量几乎是同一个值，逐条标注纯属冗余，还会把额度吃光，
    // 导致真正有电量差异的上一轮反而没有标注。
    //
    // 标该轮最后一条：它紧贴助手要接话的位置，注意力权重最高，时间上也最接近「现在」。
    const ENV_STAMP_TURNS = 2;
    const envStampIds = new Set();
    {
      const envOpts = getEnvPerceptionOptions();
      const anyEnvOn = Object.values(envOpts).some(Boolean);
      if (anyEnvOn && window.EnvAwareness && typeof EnvAwareness.buildStampText === 'function') {
        // 从最新往回扫：每遇到助手消息就跨入更早一轮；每轮内只认第一个遇到的
        // 带快照用户记录（倒序扫描下即该轮最后一条）。
        let turnsUsed = 0;
        let claimedThisTurn = false;
        for (let i = records.length - 1; i >= 0 && turnsUsed < ENV_STAMP_TURNS; i -= 1) {
          const rec = records[i];
          if (!isChatMsg(rec)) continue;

          if (rec.role === 'assistant') {
            if (claimedThisTurn) {
              turnsUsed += 1;
              claimedThisTurn = false;
            }
            continue;
          }

          // 用户记录：本轮尚未认领且带快照时才取
          if (claimedThisTurn) continue;
          if (!rec.envSnapshot) continue;
          envStampIds.add(String(rec.id || ''));
          claimedThisTurn = true;
        }
      }
    }

    /** 取某条记录的环境标注文本，未命中或解析失败一律返回空串 */
    function envStampFor(rec) {
      if (!envStampIds.has(String(rec.id || ''))) return '';
      try {
        return EnvAwareness.buildStampText(rec.envSnapshot, getEnvPerceptionOptions());
      } catch (_) {
        return '';
      }
    }

    /** 从记录的 quote 字段序列化引用块（对应旧 serializeQuoteForContext 的 DOM 版本）。 */
    function serializeQuoteFromRecord(quote) {
      if (!quote || !quote.text) return '';
      const sourceRole = quote.role === 'assistant' ? 'assistant' : 'user';
      const sourceName = String(quote.senderName || '').trim() || getSenderName(sourceRole);
      const quoteText = stripThinkingFromContext(quote.text);
      if (!quoteText) return '';
      return `[引用自「${sourceName}」的历史消息]\n${quoteText}\n[/引用]`;
    }

    for (const rec of records) {
      if (!rec) continue;
      const formattedTime = includeTime ? formatRealityDateTime(rec.createdAt) : '';

      // 系统通知（撤回等）
      if (isNoticeRec(rec)) {
        const noticeText = String(rec.content || '').trim();
        if (noticeText) {
          const noticeHeader = formattedTime ? `[系统通知时间：${formattedTime}]` : '[系统通知]';
          history.push({ role: 'system', content: `${noticeHeader}\n${noticeText}。`, _createdAt: rec.createdAt });
        }
        continue;
      }

      // 助手生成图
      if (isGenImageRec(rec)) {
        const imageId = String((rec.genImageRef && rec.genImageRef.galleryId) || rec.galleryId || '').trim();
        const imagePrompt = String((rec.genImageRef && rec.genImageRef.prompt) || rec.content || '').trim();
        const imageText = [
          '[助手生成的图片]',
          imageId ? `图片 ID：${imageId}` : '',
          imagePrompt ? `生图提示词：${imagePrompt}` : ''
        ].filter(Boolean).join('\n');
        if (imageText) history.push({ role: 'assistant', content: imageText, _createdAt: rec.createdAt });
        continue;
      }

      // 工具调用结果
      if (isToolRec(rec)) {
        const toolName = String(rec.toolName || 'tool');
        const toolOutput = String(rec.toolOutput || '').trim();
        if (toolOutput) {
          if (staleToolIds.has(String(rec.id || ''))) {
            history.push({ role: 'system', content: `[工具结果 · ${toolName}]（结果已释放，如仍需要请重新调用工具）`, _createdAt: rec.createdAt });
          } else {
            history.push({ role: 'system', content: `[工具结果 · ${toolName}]\n${toolOutput}`, _createdAt: rec.createdAt });
          }
        }
        continue;
      }

      // 普通聊天消息（含用户图片消息）
      if (!isChatMsg(rec)) continue;

      const media = rec.imageRef || null;
      const hasImageContext = Boolean(media && (
        media.visionDescription || media.galleryId || media.assetKey
      ));
      const rawText = String(rec.content || '');
      // 纯图片消息没有文字，但仍要参与上下文；完全无可用内容的记录才跳过。
      if (!rawText.trim() && !hasImageContext && !(rec.fileRefs && rec.fileRefs.length)) continue;

      const role = rec.role === 'assistant' ? 'assistant' : 'user';
      const text = stripThinkingFromContext(rawText);
      const quote = serializeQuoteFromRecord(rec.quote);
      const vision = role === 'user' && media && media.visionDescription
        ? [
            '[用户发送的图片]',
            media.galleryId ? `图片 ID：${media.galleryId}` : '',
            `图片内容：${stripThinkingFromContext(media.visionDescription)}`
          ].filter(Boolean).join('\n')
        : '';
      // 文件：仅最新一条用户文件消息注入全文（阅后即焚），更早的仅保留占位摘要。
      let fileBlock = '';
      if (role === 'user' && rec.fileRefs && rec.fileRefs.length) {
        if (String(rec.id || '') === lastFileRecordId) {
          fileBlock = await buildFileInlineBlock(rec.fileRefs);
        } else {
          fileBlock = rec.fileRefs.map((f) => `[已发送文件：${f.name}（内容已释放，如需查看请用 read_file 按名称重新读取）]`).join('\n');
        }
      }
      const messageTime = formattedTime ? `[消息时间：${formattedTime}]` : '';
      const envStamp = role === 'user' ? envStampFor(rec) : '';
      const contextText = [messageTime, envStamp, quote, vision, fileBlock, text].filter(Boolean).join('\n').trim();
      if (contextText) history.push({ role, content: contextText, _createdAt: rec.createdAt });
    }

    // —— 时间线归并 ——
    // 到这里 history 里都是带 _createdAt 的时间线条目（聊天消息 + 副本 recap 摘要）。
    // 先把副本 recap 摘要并进来，再统一按时间升序排，最后才追加「尾部常驻块」
    //（文件清单 / 副本原文）——尾部块不参与时间排序，恒定贴在末尾。

    // 副本行动摘要注入：抽取当前活跃副本每轮 recap，按真实时间交错进助手时间线。
    // 视作短期记忆，随日常对话自然被 fitMessagesToContext 从旧往新裁剪挤出。
    // 日常页与副本页都注入——摘要管「全程远景」，副本页的原文管「最近细节」，两者互补。
    if (window.ForkRunStore && typeof ForkRunStore.findOngoingActiveFork === 'function'
      && window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function') {
      try {
        const activeRun = await ForkRunStore.findOngoingActiveFork();
        if (activeRun && activeRun.runId) {
          const runRecords = (typeof ForkRunStore.getRunRecords === 'function')
            ? (await ForkRunStore.getRunRecords(activeRun.runId) || [])
            : [];
          const envoyName = (window.Store && Store.envoy && Store.envoy.identity && Store.envoy.identity.name)
            ? String(Store.envoy.identity.name).trim()
            : '执行员';
          for (const rec of runRecords) {
            if (!rec || rec.role !== 'narration' || !rec.content) continue;
            const parsed = ForkRunParser.parseRunReply(rec.content);
            const recap = (parsed && typeof parsed.recap === 'string') ? parsed.recap.trim() : '';
            if (!recap) continue;
            const recapTime = includeTime ? formatRealityDateTime(rec.createdAt) : '';
            const recapHeader = recapTime ? `[副本行动 · ${recapTime}]` : '[副本行动]';
            const recapContent = `${recapHeader}\n执行员「${envoyName}」在副本中的行动：\n${recap}`;
            history.push({
              role: 'system',
              content: recapContent,
              _createdAt: rec.createdAt
            });
          }
        }
      } catch (err) {
        console.warn('[System Chat] 副本行动摘要注入失败：', err);
      }
    }

    // 统一按 createdAt 升序排序时间线，排完清掉内部时间戳字段。
    history.sort((a, b) => {
      const ta = (typeof a._createdAt === 'number') ? a._createdAt : 0;
      const tb = (typeof b._createdAt === 'number') ? b._createdAt : 0;
      return ta - tb;
    });
    for (const item of history) delete item._createdAt;

    // —— 尾部常驻块（不参与时间排序，恒定贴在时间线之后）——

    // 副本原文：在副本页内，注入当前副本最近 FORK_RAW_TURNS 轮的原文（剥掉 recap），
    // 作为「执行员最新行动详情」。追加在时间线末尾 → 落入 fitMessagesToContext 的
    // pending 强制保留区（末条助手消息之后的非助手消息永不裁），天然实现「固定保留十轮」。
    const forkRawBlock = await buildForkRawTurnsBlock();
    if (forkRawBlock) history.push({ role: 'system', content: forkRawBlock });

    // 文件区常驻清单（只放文件名 + 大小），让助手知道有哪些文件可用工具读取。
    const vaultBlock = buildFileVaultManifest();
    if (vaultBlock) history.push({ role: 'system', content: vaultBlock });

    return history;
  }

  /**
   * 副本原文块：仅副本页内（getForkSceneCtx 非空）生成。
   * 取当前副本最近 FORK_RAW_TURNS 轮 narration 原文，剥掉 ::: recap 块（摘要已单独注入），
   * 保留 scene / 正文 / state / npc 等结构块，让助手看到执行员最新行动的细节与现场。
   * 一轮 = 一条 narration（AI 叙事）+ 它前面那条 envoy（执行员行动），成对取出。
   * @returns {Promise<string>} 不在副本页或无原文时返回空串
   */
  async function buildForkRawTurnsBlock() {
    const sceneCtx = getForkSceneCtx();
    if (!sceneCtx || !sceneCtx.runId) return '';
    if (!window.ForkRunStore || typeof ForkRunStore.getRunRecords !== 'function') return '';

    let runRecords = [];
    try {
      runRecords = (await ForkRunStore.getRunRecords(sceneCtx.runId)) || [];
    } catch (_) {
      return '';
    }
    if (!runRecords.length) return '';

    // 从尾部往前凑够 FORK_RAW_TURNS 条 narration，连同其间的 envoy 行动一并纳入（成对的往返）。
    let narrationSeen = 0;
    let startIdx = runRecords.length;
    for (let i = runRecords.length - 1; i >= 0; i -= 1) {
      const rec = runRecords[i];
      if (rec && rec.role === 'narration') {
        narrationSeen += 1;
        if (narrationSeen > FORK_RAW_TURNS) break;
      }
      startIdx = i;
    }
    const slice = runRecords.slice(startIdx);
    if (!slice.length) return '';

    // 剥 recap：recap 块恒定收尾，用正则从 ::: recap 到结尾整块删除。
    const stripRecap = (text) => String(text || '')
      .replace(/:::\s*recap[\s\S]*?(?::::\s*$|:::\s*(?=\n)|$)/i, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const envoyName = (window.Store && Store.envoy && Store.envoy.identity && Store.envoy.identity.name)
      ? String(Store.envoy.identity.name).trim()
      : '执行员';

    const parts = [];
    for (const rec of slice) {
      if (!rec || !rec.content) continue;
      if (rec.role === 'envoy') {
        const act = String(rec.content).trim();
        if (act) parts.push(`【执行员行动】\n${act}`);
      } else if (rec.role === 'narration') {
        const body = stripRecap(rec.content);
        if (body) parts.push(body);
      }
    }
    if (!parts.length) return '';

    return `[副本实况 · 执行员最新行动详情]
以下是执行员「${envoyName}」在副本中最近 ${FORK_RAW_TURNS} 轮的现场原文（含场景、叙事与状态），供你详细了解他此刻的处境。这是只供你知悉的后台情报，执行员看不到，请勿复述或照搬，自然地理解即可：

${parts.join('\n\n———\n\n')}`;
  }

  /** 组装当前轮要注入全文的文件块；超硬上限时只注入头部并提示分页读取。 */
  async function buildFileInlineBlock(refs) {
    if (!window.FileStore || typeof FileStore.getText !== 'function') return '';
    const parts = [];
    for (const f of refs) {
      const text = await FileStore.getText(f.id);
      if (text == null) {
        parts.push(`[用户发送的文件]\n文件 ID：${f.id}\n文件名：${f.name}\n内容：（文件已从文件区删除，无法读取）`);
        continue;
      }
      let body = text;
      let note = '';
      if (text.length > FILE_INLINE_CHAR_LIMIT) {
        body = text.slice(0, FILE_INLINE_CHAR_LIMIT);
        note = `\n（内容过长，此处仅注入前 ${FILE_INLINE_CHAR_LIMIT} 字符，共 ${text.length} 字符；如需后续内容请用 read_file 指定 page 分页读取）`;
      }
      parts.push(`[用户发送的文件]\n文件 ID：${f.id}\n文件名：${f.name}\n内容：\n${body}${note}`);
    }
    return parts.join('\n\n');
  }

  /** 文件区常驻清单：文件名 + 大小 + 字符数，供助手判断可调用哪些文件。 */
  function buildFileVaultManifest() {
    if (!window.FileStore || typeof FileStore.list !== 'function') return '';
    const items = FileStore.list();
    if (!items.length) return '';
    const lines = items.map((f) => `- ${f.name}（${f.sizeText}，${f.charCount} 字符）`);
    return `[文件区可用文件清单]\n执行员的文件区当前有 ${items.length} 份文件，你可以用 read_file / search_file 工具按文件名读取或检索其内容：\n${lines.join('\n')}`;
  }

  function getApiErrorText(err) {
    return err && err.message ? err.message : '系统助手 API 调用失败';
  }

  function extractAssistantActions(rawText) {
    const actions = [];
    let source = String(rawText || '');
    // 兼容模型把动作标记包进 Markdown 代码块的情况，先剥掉围栏再匹配。
    const captureAction = (payload) => {
      let text = String(payload || '').trim();
      // 去掉可能残留的代码块围栏
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      // 常见的中文引号 / 尾随逗号纠偏，尽量抢救成合法 JSON
      const normalized = text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        const action = JSON.parse(normalized);
        if (action && typeof action === 'object') {
          actions.push(action);
          return true;
        }
      } catch (err) {
        console.warn('[System Chat] 动作协议 JSON 解析失败：', normalized, err);
        if (window.RetroToast) {
          RetroToast.show({ tag: 'ACTION // 解析失败', message: '助手动作指令格式不合法，未能执行。', type: 'warning' });
        }
      }
      return false;
    };

    const visibleText = source
      .replace(/```[a-z]*\s*(<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>)\s*```/gi, '$1')
      .replace(/<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi, (_, payload) => {
        captureAction(payload);
        return '';
      })
      // 兜底：流式回复被中途掐断时，可能残留没有闭合标签的半截动作标记。
      // 这种残片解析不出合法 JSON（因而不会误触发动作），但会裸露在气泡里，需清掉。
      .replace(/```[a-z]*\s*<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .trim();
    return { visibleText, actions };
  }

  /* ---------------- 生图动作（generate_image） ---------------- */

  /** 生图能力是否启用：读对话设置，缺省视为开启 */
  function isImageGenEnabled() {
    const s = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
      ? SystemChatSettings.getSettings()
      : null;
    return !s || s.imageGen !== false;
  }

  /** 读取生图插槽配置，未配置返回 null */
  function getImageSlotConfig() {
    const cfg = window.Store && Store.config && Store.config.apiSlots && Store.config.apiSlots.imageGen;
    if (!cfg || !cfg.baseUrl || !cfg.apiKey) return null;
    return cfg;
  }

  const IMAGE_SIZE_WHITELIST = new Set(['1024x1024', '768x1024', '1024x768']);

  function normalizeImageSize(size) {
    const s = String(size || '').trim().toLowerCase().replace(/[×*]/g, 'x');
    return IMAGE_SIZE_WHITELIST.has(s) ? s : '1024x1024';
  }

  /** 竖图给纵向比例提示，其余不加 */
  function ratioHintForSize(size) {
    return size === '768x1024' ? RetroflowAPI.RATIO_HINT_PORTRAIT : undefined;
  }

  /**
   * 按 target 取档案锁脸参考：外貌描述 + FACE ID 参考图 src。
   * @returns {Promise<{appearance:string, faceRef:string|null}>}
   */
  async function resolveGenTarget(target) {
    const t = String(target || '').trim().toLowerCase();
    if (t === 'assistant') {
      const active = getCurrentAssistant() || {};
      let faceRef = null;
      try {
        if (active.id && window.DataRegistry) {
          faceRef = await Storage.getAssetSrc(DataRegistry.key.assistantFaceId(active.id));
        }
      } catch (_) { faceRef = null; }
      return { appearance: String(active.appearance || '').trim(), faceRef };
    }
    if (t === 'envoy') {
      const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};
      let faceRef = null;
      try {
        if (window.DataRegistry) {
          faceRef = await Storage.getAssetSrc(DataRegistry.key.personaFaceId());
        }
      } catch (_) { faceRef = null; }
      return { appearance: String(identity.appearance || '').trim(), faceRef };
    }
    return { appearance: '', faceRef: null };
  }

  /**
   * 执行一次生图动作：状态卡占位 → 调 API（文生图或档案锁脸）→ 归档图库 → 落库并替换为图片行。
   * 全程受 imageGen 开关双保险：关闭时静默忽略。
   */
  async function runImageGenAction(action, opts) {
    const options = opts || {};
    const active = getCurrentAssistant();
    if (!isImageGenEnabled()) {
      // 开关关闭：清掉可能已建立的预览占位，静默忽略
      if (options.existingStateRow && options.existingStateRow.parentNode) options.existingStateRow.remove();
      return;
    }

    const prompt = String(action.prompt || action.description || '').trim();
    if (!prompt) {
      console.warn('[System Chat] 生图动作缺少 prompt，忽略');
      if (options.existingStateRow && options.existingStateRow.parentNode) options.existingStateRow.remove();
      return;
    }

    const cfg = getImageSlotConfig();
    if (!cfg) {
      if (options.existingStateRow && options.existingStateRow.parentNode) options.existingStateRow.remove();
      if (window.RetroToast) RetroToast.show({ tag: 'IMAGE // 未配置', message: '尚未配置图像生成节点，无法生图', detail: '请前往 API 引擎配置图像生成插槽。', type: 'warning' });
      return;
    }

    const size = normalizeImageSize(action.size);
    const ratioHint = ratioHintForSize(size);
    const { appearance, faceRef } = await resolveGenTarget(action.target);

    // 组装 prompt：档案外貌在前（仅锁脸目标才有），用户 prompt 在后。全局正向词由 api-core 内部拼接。
    const parts = [];
    if (appearance) parts.push(appearance);
    parts.push(prompt);
    const finalPrompt = parts.join(', ');

    const messageGroupId = `chatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const recordId = makeChatRecordId();
    const createdAt = Date.now();

    // 状态卡占位行：优先复用流式期间已建立的预览占位，实现无缝过渡；否则新建一个。
    const stateRow = options.existingStateRow || appendGenStateRow('loading', { messageGroupId });

    let res;
    try {
      if (faceRef) {
        res = await RetroflowAPI.generateImageEdit(cfg, faceRef, { prompt: finalPrompt, size, ratioHint, logTag: '系统助手 · 锁脸生图' });
      } else {
        res = await RetroflowAPI.generateImage(cfg, { prompt: finalPrompt, size, ratioHint, logTag: '系统助手 · 生图' });
      }
      if (!res || !res.image) throw new Error('服务端未返回图像');
    } catch (err) {
      if (stateRow && stateRow.parentNode) stateRow.remove();
      const message = getApiErrorText(err);
      if (window.RetroToast) RetroToast.show({ tag: 'IMAGE // 生成失败', message, type: 'warning' });
      return;
    } finally {
      if (faceRef) Storage.revokeAssetSrc(faceRef);
    }

    // 归档进图库（系统助手生成相册），拿到 assetKey
    let galleryEntry = null;
    try {
      if (!window.GalleryStore || typeof GalleryStore.record !== 'function') throw new Error('图库归档模块尚未加载');
      galleryEntry = await GalleryStore.record(res.image, {
        source: 'assistant-generation',
        chatRecordId: recordId,
        category: 'chat-cache',
        ownerType: 'assistant',
        ownerId: GalleryStore.SYSTEM_ASSISTANT_OWNER_ID,
        ownerName: (active && active.name) || '系统助手'
      });
      if (!galleryEntry) throw new Error('影像归档失败');
    } catch (err) {
      if (stateRow && stateRow.parentNode) stateRow.remove();
      if (window.RetroToast) RetroToast.show({ tag: 'IMAGE // 归档失败', message: getApiErrorText(err), type: 'warning' });
      return;
    }

    const media = {
      type: 'image',
      galleryId: galleryEntry.id,
      assetKey: galleryEntry.key,
      state: 'active',
      mime: galleryEntry.mime,
      prompt
    };

    // 落库
    try {
      await persistGeneratedImageMessage(media, messageGroupId, recordId, createdAt);
    } catch (err) {
      // 落库失败则回收图库资产，避免孤儿
      if (window.GalleryStore) await GalleryStore.remove([galleryEntry.id]).catch(() => {});
      if (stateRow && stateRow.parentNode) stateRow.remove();
      if (window.RetroToast) RetroToast.show({ tag: 'IMAGE // 记录失败', message: getApiErrorText(err), type: 'warning' });
      return;
    }

    // 移除状态卡，追加正式图片行
    if (stateRow && stateRow.parentNode) stateRow.remove();
    await appendGeneratedImage(media, { recordId, messageGroupId, createdAt });
  }

  /** 生图状态占位行（loading）。返回可移除的行节点。 */
  function appendGenStateRow(state, opts) {
    if (!messagesWrap) return null;
    const options = opts || {};
    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant is-gen-image is-gen-state';
    if (options.messageGroupId) row.dataset.messageGroupId = options.messageGroupId;

    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    avatarCircle.innerHTML = SYSTEM_AVATAR_SVG;
    avatarCol.appendChild(avatarCircle);

    const figure = document.createElement('div');
    figure.className = 'chat-gen-image is-loading';
    figure.innerHTML = `<span class="chat-gen-spinner" aria-hidden="true"></span><span class="chat-gen-loading-text">RENDERING // 生成中</span>`;

    row.append(avatarCol, figure);
    messagesWrap.appendChild(row);
    if (chatBody) chatBody.scrollTop = chatBody.scrollHeight;
    return row;
  }

  // 流式过程中提前建立的「生成中」预览占位行队列。流式结束后由生图动作按序复用，
  // 使占位无缝过渡到成图；未被任何动作认领的多余占位在收尾时清除。
  let streamingGenPlaceholders = [];
  // 已就流式当前 reply 建立的预览占位数量，避免每个 delta 重复建行。
  let streamingGenPlaceholderShown = 0;

  /** 统计文本中已闭合的 generate_image 动作标记数量。 */
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
   * 流式回调中调用：文本里每出现一个新的、已闭合的 generate_image 标记，就补一个预览占位行。
   * 只在生图开关开启时预览；幂等，按已闭合标记数量补齐，绝不重复。
   */
  function maybeShowStreamingGenPlaceholder(reply) {
    if (!isImageGenEnabled()) return;
    const completed = countCompletedImageActions(reply);
    while (streamingGenPlaceholderShown < completed) {
      const row = appendGenStateRow('loading', {});
      if (row) streamingGenPlaceholders.push(row);
      streamingGenPlaceholderShown += 1;
    }
  }

  /** 取出一个可复用的流式预览占位行（FIFO），没有则返回 null。 */
  function takeStreamingGenPlaceholder() {
    return streamingGenPlaceholders.length ? streamingGenPlaceholders.shift() : null;
  }

  /** 清空并移除所有未被认领的流式预览占位行，并重置计数（每轮回复收尾调用）。 */
  function resetStreamingGenPlaceholders() {
    streamingGenPlaceholders.forEach((row) => {
      if (row && row.parentNode) row.remove();
    });
    streamingGenPlaceholders = [];
    streamingGenPlaceholderShown = 0;
  }

  async function executeAssistantActions(rawText) {
    const parsed = extractAssistantActions(rawText);

    for (const action of parsed.actions) {
      const type = String(action.type || action.action || '').trim().toLowerCase();
      if (type === 'generate_image') {
        // 生图是独立副作用，不阻塞可见文本落库；内部自行处理开关、状态卡与归档。
        // 复用流式期间已建立的预览占位行，使占位无缝过渡到成图。
        const reused = takeStreamingGenPlaceholder();
        runImageGenAction(action, { existingStateRow: reused }).catch((err) => {
          console.warn('[System Chat] 生图动作未执行：', err);
        });
        continue;
      }
      if (type !== 'set_assistant_avatar') {
        // 文件工具等其它动作类型不在此处执行（由工具循环单独处理），这里只跳过。
        continue;
      }
      // 助手身份以前端当前激活档案为准，不信任模型自填的 assistantId，避免它写错或省略。
      const active = getCurrentAssistant();
      const galleryId = String(action.galleryId || action.gallery_id || action.imageId || action.image_id || '').trim();
      if (!active || !active.id) {
        console.warn('[System Chat] 头像动作失败：没有可用的当前激活助手');
        if (window.RetroToast) RetroToast.show({ tag: 'ACTION // 头像未更新', message: '未找到当前激活助手，无法换头像。', type: 'warning' });
        continue;
      }
      if (!galleryId) {
        console.warn('[System Chat] 头像动作失败：缺少 galleryId');
        if (window.RetroToast) RetroToast.show({ tag: 'ACTION // 头像未更新', message: '助手未提供有效的图片 ID。', type: 'warning' });
        continue;
      }
      try {
        await ResonanceUI.applyAssistantAvatarFromGallery(active.id, galleryId);
        if (window.RetroToast) RetroToast.show({ tag: 'ASSISTANT // 头像已更新', message: '系统助手立绘已同步至当前拟态档案', type: 'success' });
      } catch (err) {
        console.warn('[System Chat] 助手头像动作未执行：', err);
        if (window.RetroToast) RetroToast.show({ tag: 'ACTION // 头像未更新', message: getApiErrorText(err), type: 'warning' });
      }
    }
    return parsed.visibleText;
  }

  /* ---------------- 内置工具（文件区 / 使用手册） ---------------- */

  const FILE_TOOL_TYPES = new Set(['read_file', 'search_file']);
  // 手册工具与文件工具同属「内置工具」，共用 builtinTools 开关与同一条工具循环轨道
  const MANUAL_TOOL_TYPES = new Set(['search_manual', 'read_manual']);

  // 工具卡片上的中文显示名：胶囊直接显示英文函数名对用户没有信息量
  const TOOL_LABELS = {
    read_file: '读取文件',
    search_file: '检索文件',
    search_manual: '检索手册',
    read_manual: '读取手册条目'
  };

  /** 工具的人类可读名，未登记时回落原始名 */
  function toolLabel(name) {
    const key = String(name || '').trim();
    return TOOL_LABELS[key] || key || 'tool';
  }

  /**
   * 工具卡片的 tag。按工具类型分域，别写死成 FILE——
   * 否则手册工具刷新重建后会被标成文件工具。
   */
  function toolCardTag(name, status) {
    if (status === 'error') return 'TOOL // 执行失败';
    const key = String(name || '').trim();
    if (MANUAL_TOOL_TYPES.has(key)) return 'MANUAL // 手册查阅';
    if (FILE_TOOL_TYPES.has(key)) return 'FILE // 工具调用';
    return 'TOOL // 工具调用';
  }

  /** 内置工具（文件区读取）是否启用：读对话设置，缺省视为开启 */
  function isBuiltinToolsEnabled() {
    const s = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
      ? SystemChatSettings.getSettings()
      : null;
    return !s || s.builtinTools !== false;
  }

  function isFileToolAction(action) {
    // 内置工具开关关闭时，工具标记一律不识别为工具：
    // 提示词里也不会给出这些标记，即便模型硬凑出来也不触发工具循环、不额外消耗调用。
    if (!isBuiltinToolsEnabled()) return false;
    const type = String(action && (action.type || action.action) || '').trim().toLowerCase();
    return FILE_TOOL_TYPES.has(type) || MANUAL_TOOL_TYPES.has(type);
  }

  /** 按 action 里的 fileId / fileName 解析出文件区条目 */
  function resolveFileEntry(action) {
    if (!window.FileStore) return null;
    const id = String(action.fileId || action.file_id || action.id || '').trim();
    if (id) {
      const byId = FileStore.getEntry(id);
      if (byId) return byId;
    }
    const name = String(action.fileName || action.file_name || action.name || '').trim();
    if (name && typeof FileStore.getEntryByName === 'function') {
      return FileStore.getEntryByName(name);
    }
    return null;
  }

  /**
   * 执行单个文件工具，返回 { input, output, status }，供工具卡片与上下文回灌使用。
   */
  async function runFileTool(action) {
    const type = String(action.type || action.action || '').trim().toLowerCase();
    const input = { ...action };

    // 手册工具先分流：它只读本地知识库，不需要解析文件区条目，
    // 若落到下面的 resolveFileEntry 会被当成「文件找不到」直接报错。
    if (MANUAL_TOOL_TYPES.has(type)) {
      if (!window.ManualRag) {
        return { name: type, input, status: 'error', output: '手册检索模块未就绪，暂时无法查阅。' };
      }
      const res = type === 'search_manual'
        ? ManualRag.searchManual(action.keyword || action.query || action.q || '')
        : ManualRag.readManual(action.id || action.entryId || action.manualId || '');
      return { name: type, input, status: res.status, output: res.output };
    }

    const entry = resolveFileEntry(action);

    if (!entry) {
      const wanted = action.fileName || action.file_name || action.fileId || action.file_id || action.name || action.id || '(未指定)';
      return { name: type, input, status: 'error', output: `未在文件区找到文件：${wanted}。请对照文件区清单里的文件名重新指定。` };
    }

    const text = await FileStore.getText(entry.id);
    if (text == null) {
      return { name: type, input, status: 'error', output: `文件「${entry.name}」内容已失效或被删除，无法读取。` };
    }

    if (type === 'read_file') {
      const total = text.length;
      const totalPages = Math.max(1, Math.ceil(total / FILE_TOOL_PAGE_CHARS));
      let page = parseInt(action.page, 10);
      if (!Number.isFinite(page) || page < 1) page = 1;
      if (page > totalPages) page = totalPages;
      const start = (page - 1) * FILE_TOOL_PAGE_CHARS;
      const slice = text.slice(start, start + FILE_TOOL_PAGE_CHARS);
      const header = totalPages > 1
        ? `文件「${entry.name}」第 ${page}/${totalPages} 页（共 ${total} 字符，每页约 ${FILE_TOOL_PAGE_CHARS} 字符${page < totalPages ? '，可指定 page 继续读取下一页' : ''}）：`
        : `文件「${entry.name}」全文（共 ${total} 字符）：`;
      return { name: 'read_file', input, status: 'success', output: `${header}\n${slice}` };
    }

    if (type === 'search_file') {
      const keyword = String(action.keyword || action.query || action.q || '').trim();
      if (!keyword) {
        return { name: 'search_file', input, status: 'error', output: '缺少 keyword，无法检索。' };
      }
      const lines = text.split(/\r?\n/);
      const hits = [];
      const lowerKw = keyword.toLowerCase();
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].toLowerCase().includes(lowerKw)) {
          const from = Math.max(0, i - 1);
          const to = Math.min(lines.length - 1, i + 1);
          const ctx = lines.slice(from, to + 1)
            .map((ln, idx) => `${from + idx + 1}: ${ln}`)
            .join('\n');
          hits.push(ctx);
          if (hits.length >= 20) break;
        }
      }
      if (!hits.length) {
        return { name: 'search_file', input, status: 'success', output: `在文件「${entry.name}」中未找到关键词「${keyword}」。` };
      }
      return { name: 'search_file', input, status: 'success', output: `在文件「${entry.name}」中检索「${keyword}」命中 ${hits.length} 处${hits.length >= 20 ? '（仅显示前 20 处）' : ''}：\n\n${hits.join('\n---\n')}` };
    }

    return { name: type, input, status: 'error', output: `不支持的文件工具类型：${type}` };
  }

  async function refreshAssistantAvatars(assistantId) {
    if (!messagesWrap) return;
    const rows = Array.from(messagesWrap.querySelectorAll('.chat-msg-row.assistant'))
      .filter((row) => !assistantId || String(row.dataset.assistantId || '') === String(assistantId));
    await Promise.all(rows.map(async (row) => {
      const circle = row.querySelector('.chat-avatar-circle');
      if (!circle) return;
      const src = await getAssistantAvatarSrc(row.dataset.assistantId || assistantId);
      circle.innerHTML = src
        ? `<img src="${src}" alt="助手头像">`
        : SYSTEM_AVATAR_SVG;
    }));
  }

  // 无 tokenizer 依赖下的保守 token 估算：中日韩字符按 1 token，其他文本约 4 字符/token。
  function estimateTokens(text) {
    const value = String(text || '');
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    return cjk + Math.ceil((value.length - cjk) / 4) + 4;
  }

  function estimateMessageTokens(message) {
    return estimateTokens(message && message.content) + 4;
  }

  /**
   * 根据当前生效模型的上下文容量裁剪历史。
   * System Prompt 与最后一条助手消息之后的用户消息、系统事件属于强制保留区；
   * 其余历史从最新向最旧装入预算，避免旧消息挤掉待推演草稿。
   */
  function fitMessagesToContext(config, systemPrompt, history) {
    const configuredContext = parseInt(config && config.context, 10);
    const contextLimit = Number.isFinite(configuredContext) && configuredContext >= 1000
      ? configuredContext
      : 200000;
    const configuredOutput = parseInt(config && config.maxTokens, 10);
    const outputReserve = Number.isFinite(configuredOutput) && configuredOutput > 0
      ? configuredOutput
      : Math.min(4096, Math.floor(contextLimit * 0.2));
    // 预留约 10% 给不同供应商 tokenizer 的估算误差及消息封装开销。
    const inputBudget = Math.max(256, Math.floor(contextLimit * 0.9) - outputReserve);
    const source = Array.isArray(history) ? history : [];

    let lastAssistantIndex = -1;
    source.forEach((message, index) => {
      if (message && message.role === 'assistant') lastAssistantIndex = index;
    });

    const pending = source.slice(lastAssistantIndex + 1).filter(message => message && message.role !== 'assistant');
    const older = source.slice(0, lastAssistantIndex + 1);
    const systemMessage = { role: 'system', content: systemPrompt };
    const timeBaselineMessage = isTimePerceptionEnabled()
      ? { role: 'system', content: buildRealityTimeBaseline(Date.now()) }
      : null;
    let used = estimateMessageTokens(systemMessage);
    if (timeBaselineMessage) used += estimateMessageTokens(timeBaselineMessage);

    // 连发的待推演用户消息始终保留，即使配置容量过小也不静默删掉用户输入。
    pending.forEach(message => { used += estimateMessageTokens(message); });

    const keptOlder = [];
    for (let i = older.length - 1; i >= 0; i -= 1) {
      const cost = estimateMessageTokens(older[i]);
      if (used + cost > inputBudget) continue;
      keptOlder.unshift(older[i]);
      used += cost;
    }

    // 深度注入必须在裁剪之后落位，否则可能被裁掉。
    // 插入点按「从末尾往前数」计算，所以也要在 pending 拼进来之后才做。
    let finalMessages = [systemMessage, ...(timeBaselineMessage ? [timeBaselineMessage] : []), ...keptOlder, ...pending];
    const depthSceneCtx = getForkSceneCtx();
    const depthItems = (window.SystemChatPrompt && typeof SystemChatPrompt.buildDepthInjection === 'function')
      ? SystemChatPrompt.buildDepthInjection(history, depthSceneCtx)
      : [];
    if (depthItems.length && window.WorldBookEngine && typeof WorldBookEngine.applyDepthInjection === 'function') {
      finalMessages = WorldBookEngine.applyDepthInjection(finalMessages, depthItems);
    }

    // 存一份最近一次真实发出的上下文快照（调试查看用）。本函数是助手端
    // 三个请求点（正常回复 / 重 roll / 工具循环后续轮）的统一装配出口，
    // 在此落快照即可全覆盖。时机在 finalMessages 定型之后、发请求之前，
    // 所见即所发：system prompt 全文、手册命中段、世界书、裁剪后的历史、深度注入全在里面。
    try {
      const snapMsgs = finalMessages.map((m) => ({
        role: (m && m.role) || '',
        content: (m && typeof m.content === 'string') ? m.content : ''
      }));
      const settingsForSnap = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
        ? SystemChatSettings.getSettings()
        : null;
      lastContextSnapshot = {
        at: Date.now(),
        messages: snapMsgs,
        meta: {
          model: String((config && (config.modelId || config.model)) || '').trim(),
          streamingWillUse: !settingsForSnap || settingsForSnap.streaming !== false,
          messageCount: snapMsgs.length,
          // 历史装入：分母含连发的 pending（它们永不被裁），与分子口径一致
          keptRecords: keptOlder.length + pending.length,
          totalRecords: older.length + pending.length,
          depthCount: depthItems.length,
          totalChars: snapMsgs.reduce((sum, m) => sum + m.content.length, 0),
          totalTokens: used
        }
      };
    } catch (err) {
      console.warn('[System Chat] 上下文快照写入失败：', err);
    }

    return {
      messages: finalMessages,
      meta: {
        contextLimit,
        outputReserve,
        inputBudget,
        estimatedInputTokens: used,
        trimmedCount: older.length - keptOlder.length,
        depthInjectedCount: depthItems.length,
        overflow: used > inputBudget
      }
    };
  }

  async function generateReplacementReply(history, onChunk) {
    if (!window.SystemChatPrompt || !window.RetroflowAPI) {
      throw new Error('系统助手 API 模块尚未加载');
    }
    const config = SystemChatPrompt.resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('尚未配置系统助手模型，或主模型配置不完整');
    }
    const fitted = fitMessagesToContext(config, SystemChatPrompt.buildSystemPrompt(history, getForkSceneCtx()), history);
    const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : { streaming: true };
    let reply = '';
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;
    if (jumpBottomBtn) jumpBottomBtn.classList.add('is-inferring');
    setSendButtonState(true);
    if (textarea) textarea.disabled = true;
    if (aiRespBtn) aiRespBtn.disabled = true;
    try {
      if (settings.streaming && typeof RetroflowAPI.streamChat === 'function') {
        await RetroflowAPI.streamChat(config, fitted.messages, (delta, meta) => {
          if (!meta || !meta.reasoning) {
            reply += delta || '';
            if (typeof onChunk === 'function') onChunk(reply);
          }
        }, { signal, logTag: '系统助手' });
      } else {
        const result = await RetroflowAPI.chat(config, fitted.messages, { signal, logTag: '系统助手' });
        reply = result && result.content ? result.content : '';
      }
      return String(stripEchoedTimePrefix(reply) || '').trim();
    } finally {
      activeAbortController = null;
      if (jumpBottomBtn) jumpBottomBtn.classList.remove('is-inferring');
      if (textarea) textarea.disabled = false;
      if (aiRespBtn) aiRespBtn.disabled = false;
      setSendButtonState(false);
      autoResizeTextarea();
    }
  }

  async function rewriteLatestAssistantRow(row) {
    if (!row || !messagesWrap || activeAbortController) return;
    const messageRows = Array.from(messagesWrap.querySelectorAll('.chat-msg-row'));
    const rowIndex = messageRows.indexOf(row);
    if (rowIndex < 0 || !row.classList.contains('assistant')) return;

    // 确认从该行之后没有用户消息
    const rowsAfter = messageRows.slice(rowIndex);
    if (rowsAfter.some(r => r.classList.contains('user'))) return;

    // 找到末尾这一轮所有的 assistant 气泡行（整轮重写）
    const batchRows = [];
    for (let i = messageRows.length - 1; i >= 0; i--) {
      const r = messageRows[i];
      if (r.classList.contains('assistant')) {
        batchRows.unshift(r);
      } else {
        break;
      }
    }

    if (!batchRows.length) return;

    // 以前面非 assistant 之前的历史为基准生成重写
    const firstAssistantRow = batchRows[0];
    const history = await buildChatHistory({ stopBeforeRow: firstAssistantRow });

    // 保留第一行作为目标行，其余后续的 assistant 行先移除
    const targetRow = firstAssistantRow;
    const extraRows = batchRows.slice(1);
    const extraIds = extraRows.map(r => r.dataset.recordId).filter(Boolean);

    if (extraIds.length) {
      await removeChatRecordIds(extraIds);
      extraRows.forEach(r => r.remove());
    }

    // 关键修复：立即让目标行退回加载波形态（awaitingFirst）
    syncAssistantBubbleGroup(targetRow, '', { cursor: true });

    try {
      const replacement = await generateReplacementReply(history, (streamingText) => {
        // 流式吐字时实时更新气泡
        syncAssistantBubbleGroup(targetRow, streamingText, { cursor: true });
      });
      if (!replacement) return;

      const recordId = targetRow.dataset.recordId;
      if (!recordId || !(await updateChatRecordContent(recordId, replacement))) {
        throw new Error('原助手记录不存在');
      }
      syncAssistantBubbleGroup(targetRow, replacement, { animate: true });
    } catch (err) {
      const isTimeout = Boolean(err && err.isTimeout);
      const isAbort = !isTimeout
        && (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.' || err.message === 'DOMException: The user aborted a request.'));
      if (!isAbort && window.RetroToast) {
        RetroToast.show({ tag: 'REWRITE // FAILED', message: `重写失败：${getApiErrorText(err)}`, type: 'warning' });
      }
    }
  }

  /**
   * 请求一轮助手应答。
   *
   * 自内核化改造后，这里只负责「装配上下文 + 构造渲染/落库/动作适配器」，
   * 真正的流式接收、思维链合成、工具循环全部交给 AssistantChatCore.requestReply。
   * 助手页与副本/沙盒的 DECK 随行舱共用那同一份内核，差别只在这几个适配器。
   *
   * 本函数的行为必须与改造前逐帧一致 —— 适配器把内核的通用调用翻译回助手页
   * 原来那套 appendMessage / response.sync / chatBody 操作，一个都不省。
   *
   * @param {Array}  history     已装配的消息数组
   * @param {Object} [overrides] 可选的适配器覆盖，供 DECK 随行助手舱复用本函数。
   *   传入 { renderer, persist, actions, hooks } 中的任意项即替换掉助手页默认实现。
   *   这样「解析模型配置 + 上下文裁剪 + 工具循环上限」这些与界面无关的装配逻辑
   *   两端共用，DECK 只需换掉渲染落点；不传则完全是助手页原行为。
   */
  async function requestAssistantReply(history, overrides) {
    if (!window.SystemChatPrompt || !window.RetroflowAPI || !window.AssistantChatCore) {
      throw new Error('系统助手 API 模块尚未加载');
    }

    const config = SystemChatPrompt.resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('尚未配置系统助手模型，或主模型配置不完整');
    }

    const fitted = fitMessagesToContext(config, SystemChatPrompt.buildSystemPrompt(history, getForkSceneCtx()), history);
    const messages = fitted.messages;
    if (fitted.meta.trimmedCount > 0) {
      console.info(`[System Chat] 上下文容量 ${fitted.meta.contextLimit} tokens，已裁剪 ${fitted.meta.trimmedCount} 条旧消息`);
    }

    // 渲染适配器：把内核的通用渲染动作翻译成助手页既有的 appendMessage / sync 那套。
    // handle 就是 appendMessage 返回的 { row, bubble, content, sync } 句柄，原样透传。
    const renderer = {
      openBubble: (role, createdAt) =>
        appendMessage(role, '', formatRecordTime(createdAt), null, '', '', '', createdAt),
      syncBubble: (handle, rawText, opts) => {
        if (handle && typeof handle.sync === 'function') {
          const group = handle.sync(rawText, opts);
          if (group) { handle.bubble = group.bubble; handle.content = group.content; }
        }
      },
      clearFirstChunk: (handle) => {
        if (handle && handle.content) handle.content.innerHTML = '';
      },
      bindRecord: (handle, record, opts) => {
        if (handle && handle.row && record) {
          handle.row.dataset.recordId = record.id;
          // 工具循环的中途轮次会无条件刷新 createdAt（与改造前一致）；
          // 收尾轮次只在为空时补写，避免覆盖气泡建立时就定好的时间。
          if (opts && opts.overwriteCreatedAt) {
            handle.row.dataset.createdAt = String(record.createdAt);
          } else if (!handle.row.dataset.createdAt) {
            handle.row.dataset.createdAt = String(record.createdAt);
          }
        }
      },
      dropBubble: (handle) => {
        if (handle && handle.row && handle.row.parentNode) handle.row.remove();
      },
      toolCard: (info) => { appendToolCard(info); },
      scrollToBottom: () => { if (chatBody) chatBody.scrollTop = chatBody.scrollHeight; },
      genPlaceholder: (rawText) => { maybeShowStreamingGenPlaceholder(rawText); },
      resetGenPlaceholder: () => { resetStreamingGenPlaceholders(); }
    };

    // 落库适配器：内核统一签名 (role, rawText, createdAt, groupId) 映射回助手页
    // 原有 persistChatMessage(role, text, quote, recordId, createdAt, media, groupId)。
    const persist = {
      message: (role, rawText, createdAt, groupId) =>
        persistChatMessage(role, rawText, null, '', createdAt, null, groupId || null),
      toolCall: (result, groupId) => persistToolCallRecord(result, groupId || null)
    };

    // 业务动作适配器：工具识别 / 执行 / 卡片 tag / 收尾通知。
    const actions = {
      isToolAction: (action) => isFileToolAction(action),
      runTool: (action) => runFileTool(action),
      runOtherActions: (rawText) => executeAssistantActions(rawText),
      toolCardTag: (name, status) => toolCardTag(name, status),
      replyNotice: (record, text) => pushSystemReplyNotice(record, text)
    };

    // 生命周期钩子：中断控制器与 is-inferring 态仍由助手页持有，
    // 这样顶部停止按钮、跳转甲板的推演态指示都保持原行为。
    const hooks = {
      onInferStart: (controller) => {
        activeAbortController = controller;
        if (jumpBottomBtn) jumpBottomBtn.classList.add('is-inferring');
      },
      onInferEnd: () => {
        activeAbortController = null;
        if (jumpBottomBtn) jumpBottomBtn.classList.remove('is-inferring');
      }
    };

    return await AssistantChatCore.requestReply({
      config,
      messages,
      renderer: (overrides && overrides.renderer) || renderer,
      persist: (overrides && overrides.persist) || persist,
      actions: (overrides && overrides.actions) || actions,
      hooks: (overrides && overrides.hooks) || hooks,
      toolLoopLimit: getToolLoopLimit()
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  function clearPendingImage() {
    if (pendingImages.length) {
      for (const item of pendingImages) {
        if (item && item.objectUrl) {
          try { URL.revokeObjectURL(item.objectUrl); } catch (_) {}
        }
      }
      pendingImages = [];
    }
    if (imagePreviewBar) imagePreviewBar.remove();
    imagePreviewBar = null;
    autoResizeTextarea();
  }

  /* ---------------- 待发送文件（来自文件区选择） ---------------- */

  // 折角文档图标（纯 SVG，无 emoji）
  const FILE_DOC_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-3 7V3.5L18.5 9H13z"/></svg>';

  function escapeChatHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  function clearPendingFiles() {
    pendingFiles = [];
    if (filePreviewBar) filePreviewBar.remove();
    filePreviewBar = null;
    if (sendBtn && textarea) {
      const hasContent = textarea.value.trim().length > 0 || pendingImages.length > 0;
      sendBtn.classList.toggle('is-ready', hasContent);
    }
    autoResizeTextarea();
  }

  function renderPendingFiles() {
    if (filePreviewBar) { filePreviewBar.remove(); filePreviewBar = null; }
    if (!pendingFiles.length) {
      autoResizeTextarea();
      return;
    }
    const inputShell = textarea && textarea.parentElement;
    if (!inputShell) return;
    filePreviewBar = document.createElement('div');
    filePreviewBar.className = 'chat-file-preview-bar';
    for (const f of pendingFiles) {
      const chip = document.createElement('div');
      chip.className = 'chat-file-preview-chip';
      chip.innerHTML = `
        <span class="chat-file-preview-icon">${FILE_DOC_SVG}</span>
        <span class="chat-file-preview-name">${escapeChatHtml(f.name)}</span>
        <span class="chat-file-preview-size">${escapeChatHtml(f.sizeText || '')}</span>
        <button class="chat-file-preview-remove" type="button" aria-label="移除文件">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>`;
      const rm = chip.querySelector('.chat-file-preview-remove');
      if (rm) rm.addEventListener('click', () => {
        pendingFiles = pendingFiles.filter((x) => x.id !== f.id);
        renderPendingFiles();
      });
      filePreviewBar.appendChild(chip);
    }
    inputShell.insertBefore(filePreviewBar, textarea);
    if (sendBtn) sendBtn.classList.add('is-ready');
  }

  function attachPendingFiles(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    const existing = new Set(pendingFiles.map((f) => f.id));
    for (const e of entries) {
      if (!e || existing.has(e.id)) continue;
      pendingFiles.push({ id: e.id, name: e.name, sizeText: e.sizeText, charCount: e.charCount });
    }
    renderPendingFiles();
  }

  function removePendingImage(index) {
    if (index >= 0 && index < pendingImages.length) {
      const removed = pendingImages.splice(index, 1)[0];
      if (removed && removed.objectUrl) {
        try { URL.revokeObjectURL(removed.objectUrl); } catch (_) {}
      }
      renderPendingImages();
    }
  }

  function renderPendingImages() {
    if (imagePreviewBar) {
      imagePreviewBar.remove();
      imagePreviewBar = null;
    }
    if (!pendingImages.length) {
      autoResizeTextarea();
      return;
    }
    const inputShell = textarea && textarea.parentElement;
    if (!inputShell) return;

    imagePreviewBar = document.createElement('div');
    imagePreviewBar.className = 'chat-image-preview-deck';

    pendingImages.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'chat-image-preview-card';
      const img = document.createElement('img');
      img.src = item.objectUrl;
      img.alt = `预览图 ${idx + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'chat-image-preview-remove';
      removeBtn.setAttribute('aria-label', '移除图片');
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removePendingImage(idx);
      });

      card.append(img, removeBtn);
      imagePreviewBar.appendChild(card);
    });

    // 追加图片卡片
    const addCard = document.createElement('button');
    addCard.type = 'button';
    addCard.className = 'chat-image-preview-add';
    addCard.setAttribute('aria-label', '继续添加图片');
    addCard.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>+ADD</span>';
    addCard.addEventListener('click', (e) => {
      e.stopPropagation();
      selectChatImage().catch((err) => {
        if (window.RetroToast) RetroToast.show({ tag: 'VISION // LOAD FAILED', message: getApiErrorText(err), type: 'warning' });
      });
    });
    imagePreviewBar.appendChild(addCard);

    inputShell.insertBefore(imagePreviewBar, textarea);
    if (sendBtn) sendBtn.classList.add('is-ready');
    autoResizeTextarea();
  }

  function renderPendingImage(blob) {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    pendingImages.push({ blob, objectUrl });
    renderPendingImages();
  }

  async function selectChatImage() {
    if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
      throw new Error('图片选择器尚未加载');
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
            const response = await fetch(result.url);
            if (!response.ok) throw new Error('远端图片读取失败');
            blobs.push(await response.blob());
          } else if (result && result.type === 'urls' && Array.isArray(result.urls)) {
            for (const u of result.urls) {
              const resp = await fetch(u);
              if (resp.ok) blobs.push(await resp.blob());
            }
          }

          const validBlobs = blobs.filter((b) => b && String(b.type || '').startsWith('image/'));
          if (!validBlobs.length) throw new Error('请选择有效的图片文件');

          for (const b of validBlobs) {
            const compressed = await Storage.compressImage(b, 1600, 0.84);
            renderPendingImage(compressed);
          }
          toggleDockPanel(false);
        } catch (err) {
          if (window.RetroToast) RetroToast.show({ tag: 'VISION // LOAD FAILED', message: getApiErrorText(err), type: 'warning' });
        }
      }
    });
  }

  function withVisionTimeout(task, timeoutMs) {
    const timeout = Math.max(1000, Number(timeoutMs) || 90000);
    return Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => setTimeout(() => reject(new Error('视觉识别超时，请确认视觉模型节点可用')), timeout))
    ]);
  }

  async function recognizeImage(blob, userText) {
    return withVisionTimeout(async () => {
    if (!window.RetroflowApiUI || typeof RetroflowApiUI.resolveSlot !== 'function' || !window.RetroflowAPI) {
      throw new Error('视觉识别模块尚未加载');
    }
    const config = RetroflowApiUI.resolveSlot('vision');
    if (!config || !config.baseUrl || !config.modelId) throw new Error('尚未配置视觉模型或主模型');
    const dataUrl = await blobToDataUrl(blob);
    const prompt = [
      '请客观、详细地描述这张图片，供后续纯文本对话作为视觉记忆使用。',
      '描述主体、环境、动作、构图、可辨识文字及关键细节；不要回答图片之外的问题，不要使用 Markdown 标题。',
      userText ? `用户随图文字：${userText}` : ''
    ].filter(Boolean).join('\n');
    try {
      const result = await RetroflowAPI.chat(config, [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }], { timeout: 120000, logTag: '系统助手 · 视觉识别' });
      const description = stripThinkingFromContext(result && result.content ? result.content : '');
      if (!description) throw new Error('视觉模型未返回有效描述');
      return description;
    } catch (err) {
      const wrapped = new Error(`${getApiErrorText(err)}。若当前使用主模型回退，请确认该模型支持图片输入。`);
      wrapped.cause = err;
      throw wrapped;
    }
    });
  }

  function getVisionRows() {
    return messagesWrap ? Array.from(messagesWrap.querySelectorAll('.chat-msg-row[data-media-state]')) : [];
  }

  function getVisionState() {
    const rows = getVisionRows();
    return { pending: rows.some(r => r.dataset.mediaState === 'pending'), failed: rows.some(r => r.dataset.mediaState === 'failed') };
  }

  function syncVisionGate() {
    const state = getVisionState();
    if (aiRespBtn) {
      aiRespBtn.disabled = Boolean(activeAbortController) || state.pending;
      aiRespBtn.setAttribute('aria-label', state.pending ? '等待影像识别完成' : '请求系统助手回应');
    }
  }

  function setVisionRowState(row, state, text) {
    if (!row) return;
    row.dataset.mediaState = state;
    const el = row.querySelector('.chat-vision-status');
    if (el) {
      el.className = `chat-vision-status is-${state}`;
      el.textContent = text || (state === 'pending' ? '正在识别影像……' : state === 'done' ? '影像记忆已归档' : '影像识别失败');
    }
    syncVisionGate();
  }

  async function confirmFailedVision() {
    const state = getVisionState();
    if (state.pending) return false;
    if (!state.failed) return true;
    if (!window.RetroModal || typeof RetroModal.confirm !== 'function') return true;
    return await RetroModal.confirm({
      tag: 'VISION // 识别状态',
      message: '存在未识别成功的图片，是否继续发送？',
      detail: '继续后，未成功识别的图片不会进入助手的文字视觉记忆。',
      confirmText: '继续发送',
      cancelText: '返回检查'
    });
  }

  async function handleSend() {
    if (activeAbortController) {
      // 当前正处于因果推演中：点击方块按钮触发主动中断
      try {
        activeAbortController.abort();
      } catch (err) {
        console.warn('[System Chat] 推演中断异常:', err);
      }
      return;
    }

    if (!textarea || textarea.disabled) return;
    await restoreChatHistory();
    const text = textarea.value.trim();
    const imageBlobs = pendingImages.map((p) => p.blob).filter(Boolean);
    const filesToSend = pendingFiles.slice();
    if (!text && !imageBlobs.length && !filesToSend.length) return;

    const quote = currentQuotePayload;
    let record;
    const imageRecords = [];
    let fileRecord = null;
    const galleryEntries = [];
    const mediaList = [];
    let messageGroupId = null;
    const visionTasks = [];
    textarea.disabled = true;
    if (sendBtn) sendBtn.disabled = true;
    try {
      // 环境快照在「按下发送」这一刻定格，随消息落库，后续回放读当时值
      const envSnapshot = await captureEnvSnapshot();
      const envExtra = envSnapshot ? { envSnapshot } : null;
      if (imageBlobs.length) {
        messageGroupId = `chatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (!window.GalleryStore || typeof GalleryStore.record !== 'function') throw new Error('图库归档模块尚未加载');

        for (let i = 0; i < imageBlobs.length; i++) {
          const blob = imageBlobs[i];
          const imageRecordId = makeChatRecordId();
          const galleryEntry = await GalleryStore.record(blob, {
            source: 'system-chat', chatRecordId: imageRecordId, category: 'chat-cache',
            ownerType: 'assistant', ownerId: GalleryStore.SYSTEM_ASSISTANT_OWNER_ID,
            ownerName: getCurrentAssistantName()
          });
          if (!galleryEntry) throw new Error('影像归档失败');
          galleryEntries.push(galleryEntry);

          const media = {
            type: 'image', galleryId: galleryEntry.id, assetKey: galleryEntry.key,
            state: 'pending', mime: galleryEntry.mime, visionDescription: ''
          };
          mediaList.push(media);

          const imgRec = await persistImageChatMessage(media, messageGroupId, imageRecordId, Date.now() + i, envExtra);
          if (!imgRec) throw new Error('图片消息落库失败');
          imageRecords.push(imgRec);

          visionTasks.push({ blob, text, recordId: imgRec.id, mediaIndex: i });
        }
        record = text ? await persistChatMessage('user', text, quote, '', Date.now() + imageBlobs.length, null, messageGroupId, envExtra) : null;
      } else if (filesToSend.length) {
        messageGroupId = `chatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        fileRecord = await persistFileChatMessage(filesToSend, messageGroupId, makeChatRecordId(), Date.now(), envExtra);
        record = text ? await persistChatMessage('user', text, quote, '', Date.now(), null, messageGroupId, envExtra) : null;
      } else {
        record = await persistChatMessage('user', text, quote, '', Date.now(), null, null, envExtra);
      }
    } catch (err) {
      if (galleryEntries.length && window.GalleryStore) {
        await GalleryStore.remove(galleryEntries.map((g) => g.id)).catch(() => {});
      }
      const message = getApiErrorText(err);
      if (window.RetroToast && typeof RetroToast.show === 'function') {
        RetroToast.show({ tag: imageBlobs.length ? 'VISION // FAILED' : 'CHAT RECORD // SAVE ERROR', message, type: 'warning' });
      }
      return;
    } finally {
      textarea.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
    }

    const imageUis = [];
    if (imageRecords.length) {
      for (let i = 0; i < imageRecords.length; i++) {
        const imgRec = imageRecords[i];
        const med = mediaList[i];
        const ui = await appendMessage('user', '', formatRecordTime(imgRec.createdAt), null, imgRec.id, imgRec.senderName, '', imgRec.createdAt, med, messageGroupId, imgRec.envSnapshot ? { envSnapshot: imgRec.envSnapshot } : null);
        imageUis.push(ui);
      }
    }
    if (fileRecord) {
      await appendMessage('user', '', formatRecordTime(fileRecord.createdAt), null, fileRecord.id, fileRecord.senderName, '', fileRecord.createdAt, { fileRefs: fileRecord.fileRefs }, messageGroupId, fileRecord.envSnapshot ? { envSnapshot: fileRecord.envSnapshot } : null);
    }
    if (record) {
      await appendMessage('user', text, formatRecordTime(record.createdAt), quote, record.id, record.senderName, '', record.createdAt, null, messageGroupId, record.envSnapshot ? { envSnapshot: record.envSnapshot } : null);
    }
    textarea.value = '';
    clearCurrentQuote();
    clearPendingImage();
    clearPendingFiles();
    autoResizeTextarea();
    if (fileRecord && window.RetroToast) RetroToast.show({ tag: 'DOC // 载荷就绪', message: `已附带 ${fileRecord.fileRefs.length} 份文件，等待助手推演`, type: 'success' });
    if (visionTasks.length) {
      visionTasks.forEach((vt) => {
        void (async () => {
          const ui = imageUis[vt.mediaIndex];
          let med = mediaList[vt.mediaIndex];
          try {
            const description = await recognizeImage(vt.blob, vt.text);
            med = { ...med, state: 'done', visionDescription: description };
            await persistImageChatMessage(med, messageGroupId, vt.recordId, Date.now());
            if (ui && ui.row) ui.row.dataset.visionDescription = description;
            setVisionRowState(ui && ui.row, 'done');
          } catch (_) {
            med = { ...med, state: 'failed', visionDescription: '' };
            await persistImageChatMessage(med, messageGroupId, vt.recordId, Date.now()).catch(() => {});
            setVisionRowState(ui && ui.row, 'failed');
          }
        })();
      });
    }
  }

  /**
   * 判定上下文尾部是否已有一条「未被回应」的用户消息。
   *
   * 只看对话双方（user / assistant）的最后一条：跳过 system 条目
   * （撤回通知、工具结果、副本 recap、尾部常驻块等都不是对话本身）。
   * 尾部是 user → 用户刚发过话还没等到回应，模型直接对它回复即可，
   * 绝不能拼「用户本轮没有发送新的文字」的延续指令（否则上下文自相矛盾）。
   * 尾部是 assistant 或整段没有对话消息 → 才需要延续指令让助手主动开口。
   *
   * 导出给 DECK 随行助手舱复用，保证两端「继续」的判定口径永远一致。
   * @param {Array<{role: string}>} history buildChatHistory 装配好的消息数组
   * @returns {boolean}
   */
  function historyEndsWithUnansweredUser(history) {
    if (!Array.isArray(history)) return false;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const item = history[i];
      const role = item && item.role;
      if (role === 'user') return true;
      if (role === 'assistant') return false;
      // system 条目跳过，继续往前找
    }
    return false;
  }

  async function handleInfer() {
    if (activeAbortController) return;
    if (!textarea || textarea.disabled) return;
    const visionState = getVisionState();
    if (visionState.pending) return;
    if (!(await confirmFailedVision())) return;
    await restoreChatHistory();
    const history = await buildChatHistory();
    const hasUnsentDraft = Boolean(textarea.value.trim());
    // 延续指令只在「用户确实没说话」时拼：输入框空 且 历史尾部没有待回应的用户消息。
    // 用户刚用发送键发过消息再按推演键 → 直接对那条消息回复，一个字都不加。
    if (!hasUnsentDraft && !historyEndsWithUnansweredUser(history)) {
      history.push({ role: 'user', content: buildSilentContinuationInstruction() });
    }

    textarea.disabled = true;
    if (aiRespBtn) aiRespBtn.disabled = true;
    setSendButtonState(true);

    try {
      await requestAssistantReply(history);
    } catch (err) {
      const isAbort = (err && (err.name === 'AbortError' || err.message === 'The user aborted a request.' || err.message === 'DOMException: The user aborted a request.'))
        || (err && err.isAbort);
      if (!isAbort) {
        const message = getApiErrorText(err);
        await appendMessage('assistant', `链路未建立：${message}`);
        if (window.RetroToast && typeof RetroToast.show === 'function') {
          RetroToast.show({
            tag: 'SYSTEM CHAT // API ERROR',
            message,
            type: 'warning'
          });
        }
      }
    } finally {
      textarea.disabled = false;
      if (aiRespBtn) aiRespBtn.disabled = false;
      setSendButtonState(false);
      autoResizeTextarea();
    }
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', handleSend);
  }

  // 切换底部扩展抽屉面板
  function toggleDockPanel(forceState) {
    if (!dockPanel || !plusBtn) return;
    const willOpen = typeof forceState === 'boolean' ? forceState : !dockPanel.classList.contains('is-open');

    if (willOpen) {
      dockPanel.hidden = false;
      void dockPanel.offsetWidth;
      dockPanel.classList.add('is-open');
      plusBtn.classList.add('is-active');
    } else {
      dockPanel.classList.remove('is-open');
      plusBtn.classList.remove('is-active');
      setTimeout(() => {
        if (!dockPanel.classList.contains('is-open')) {
          dockPanel.hidden = true;
        }
      }, 280);
    }
  }

  if (plusBtn) {
    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDockPanel();
    });
  }

  // 点击消息流区域自动收回扩展面板与 HUD 菜单
  if (chatBody) {
    chatBody.addEventListener('click', () => {
      closeActiveHud();
      if (dockPanel && dockPanel.classList.contains('is-open')) {
        toggleDockPanel(false);
      }
    });

    // 滚动时自动关闭 HUD 并更新跳跃槽可见性
    chatBody.addEventListener('scroll', () => {
      closeActiveHud();
      updateJumpDeckVisibility();
      // 上滑接近顶部：追加加载更早的历史（分页）。
      // 多重防护，避免「初次进入图片未撑开、内容矮、scrollTop 恒小」时被误判为上滑而
      // 连锁自动加载——那会把用户从底部拽走、并让滚动状态错乱（表现为滑不到底）：
      //   1. 恢复流程进行中不触发（初次渲染 / 上滑加载本身都会置位 isRestoringHistory）
      //   2. 内容必须确实可滚动且超出一屏一段，否则 scrollTop 天然就小，不该当成上滑
      //   3. 还有更早的记录、且当前没有加载在途
      const maxScroll = chatBody.scrollHeight - chatBody.clientHeight;
      if (
        !isRestoringHistory &&
        !isLoadingMoreHistory &&
        historyRenderedFrom > 0 &&
        maxScroll > 200 &&
        chatBody.scrollTop <= 120
      ) {
        loadMoreHistory();
      }
    }, { passive: true });
  }

  // 战术双向跳跃槽智能显示与定位逻辑
  function updateJumpDeckVisibility() {
    if (!jumpDeck || !chatBody) return;
    const scrollTop = chatBody.scrollTop;
    const scrollHeight = chatBody.scrollHeight;
    const clientHeight = chatBody.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    // 总内容不足一屏，或不可滚动时直接隐藏
    if (maxScroll <= 30) {
      jumpDeck.classList.remove('is-visible');
      return;
    }

    const isAtTop = scrollTop <= 35;
    const isAtBottom = (maxScroll - scrollTop) <= 35;

    // 只有在既不在最顶端、也不在最底端时，才亮起操作槽
    if (!isAtTop && !isAtBottom) {
      jumpDeck.classList.add('is-visible');
    } else {
      jumpDeck.classList.remove('is-visible');
    }
  }
  /**
   * 稳健回到真正的底部。
   *
   * 坑点：上滑加载大量消息后，图片/头像/markdown 高度是渐进撑开的，scrollHeight 在
   * 点击后数百毫秒内还在增长。若用「连续几帧高度不变」就提前收工，会卡在图片加载前
   * 的旧底（表现为按一次就停、但不是真底）；若用 smooth 动画则与高度增长竞速。
   *
   * 做法：在一段时间窗口内每帧都把 scrollTop 顶到当前底，图片何时撑开都能跟上；直到
   * 超时才停。期间若检测到用户主动上滑（scrollTop 明显小于我们刚顶到的位置），立即
   * 中止，不与用户抢滚动。
   */
  function scrollToRealBottom() {
    if (!chatBody) return;
    const MAX_MS = 2000;        // 锁底窗口：足够覆盖图片渐进加载
    const USER_SCROLL_GAP = 48; // 当前位置比我们刚顶到的底还高出这么多，判定为用户上滑
    const startAt = Date.now();
    let lastSetTop = -1;

    const step = () => {
      // 用户主动上滑检测：上一帧我们把它顶到了 lastSetTop，这一帧却明显更靠上 → 让位给用户
      if (lastSetTop >= 0 && chatBody.scrollTop < lastSetTop - USER_SCROLL_GAP) return;

      const maxScroll = chatBody.scrollHeight - chatBody.clientHeight;
      chatBody.scrollTop = maxScroll;
      lastSetTop = maxScroll;

      if (Date.now() - startAt > MAX_MS) return; // 窗口结束，停止锁底
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }


  // 回顶点击
  if (jumpTopBtn && chatBody) {
    jumpTopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatBody.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 回底点击
  if (jumpBottomBtn && chatBody) {
    jumpBottomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      scrollToRealBottom();
    });
  }

  // 扩展面板 4 大机能按键点击反馈
  if (dockPanel) {
    dockPanel.querySelectorAll('.chat-panel-item').forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = item.dataset.action;
        const nameZh = item.querySelector('.chat-panel-label-zh')?.textContent || '功能';
        console.log(`[System Chat] 点击扩展项目: ${action}`);
        if (action === 'image') {
          try { await selectChatImage(); } catch (err) {
            if (window.RetroToast) RetroToast.show({ tag: 'VISION // LOAD FAILED', message: getApiErrorText(err), type: 'warning' });
          }
          return;
        }
        if (action === 'file') {
          toggleDockPanel(false);
          if (window.FileVaultUI && typeof FileVaultUI.openForPick === 'function') {
            FileVaultUI.openForPick((entries) => attachPendingFiles(entries));
          } else if (window.RetroToast) {
            RetroToast.show({ tag: 'DOC // 模块未就绪', message: '文件区模块尚未加载', type: 'warning' });
          }
          return;
        }
        if (window.RetroToast) {
          window.RetroToast.show({
            tag: `DOCK // ${action.toUpperCase()}`,
            message: `「${nameZh}」扩展模组已就绪（待接入具体机能）`,
            type: 'info'
          });
        }
      });
    });
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      console.log('[System Chat] 点击对话设置/肉眼菜单');
    });
  }

  if (aiRespBtn) {
    aiRespBtn.addEventListener('click', handleInfer);
  }

  // ==========================================
  // 多选批量操作模式 (Tactical Batch Mode) 引擎
  // ==========================================

  function updateBatchCount() {
    const count = selectedRows.size;
    if (headerTitle) {
      headerTitle.textContent = `已选中 ${count} 项`;
    }
    if (batchDeleteCount) {
      batchDeleteCount.textContent = `PURGE (${count})`;
    }
    // 删除不设上限：只要选了就能删
    if (batchDeleteBtn) {
      batchDeleteBtn.style.opacity = count > 0 ? '1' : '0.5';
      batchDeleteBtn.style.pointerEvents = count > 0 ? 'auto' : 'none';
    }
    // 截图有上限：1..LIMIT 条时亮起，0 条或超限都灰掉（各算各的，与删除无关）
    if (batchExportBtn) {
      const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
      const shotOk = count >= 1 && count <= limit;
      batchExportBtn.style.opacity = shotOk ? '1' : '0.5';
      batchExportBtn.style.pointerEvents = shotOk ? 'auto' : 'none';
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

  function enterBatchMode(initialRow) {
    isBatchMode = true;
    selectedRows.clear();

    chatPage.classList.add('is-batch-mode');

    // 顶栏切换
    if (backBtn) backBtn.hidden = true;
    if (batchCancelBtn) batchCancelBtn.hidden = false;
    if (menuBtn) menuBtn.hidden = true;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = false;
    if (headerStatus) headerStatus.hidden = true;

    // 底栏切换
    if (batchDock) batchDock.hidden = false;

    // 若从特定气泡进入，默认勾选该行
    if (initialRow) {
      toggleRowSelection(initialRow);
    } else {
      updateBatchCount();
    }
  }

  function exitBatchMode() {
    isBatchMode = false;

    // 清空所有勾选态
    selectedRows.forEach((row) => {
      if (row) row.classList.remove('is-selected');
    });
    selectedRows.clear();

    chatPage.classList.remove('is-batch-mode');

    // 顶栏复位：统一遵循「备注优先，否则当前助手真实名字」
    if (backBtn) backBtn.hidden = false;
    if (batchCancelBtn) batchCancelBtn.hidden = true;
    if (menuBtn) menuBtn.hidden = false;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = true;
    syncHeaderIdentity();
    if (headerStatus) headerStatus.hidden = false;

    // 底栏复位
    if (batchDock) batchDock.hidden = true;
  }

  // 绑定多选顶栏按键
  if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', exitBatchMode);
  }

  if (batchSelectAllBtn) {
    batchSelectAllBtn.addEventListener('click', () => {
      if (!messagesWrap) return;
      const allRows = Array.from(messagesWrap.querySelectorAll(SELECTABLE_ROW_SELECTOR));
      const isAllSelected = allRows.length > 0 && selectedRows.size === allRows.length;

      allRows.forEach((row) => {
        if (isAllSelected) {
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

  // 绑定批量删除
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', async () => {
      const count = selectedRows.size;
      if (count === 0) return;

      if (window.RetroModal && typeof RetroModal.confirm === 'function') {
        const ok = await RetroModal.confirm({
          tag: `PURGE // 批量抹除 (${count})`,
          message: `确认要彻底删除选中的 ${count} 条消息吗？`,
          detail: '选中的所有通讯记录将从当前会话中永久清除，无法撤销。',
          confirmText: `删除 (${count})`,
          cancelText: '取消',
          danger: true
        });
        if (!ok) return;
      }

      // 先从 IndexedDB 真正抹除，再执行界面淡出；确保刷新和后续上下文都不会恢复
      const rowsToDelete = Array.from(selectedRows).filter(Boolean);
      const recordIds = rowsToDelete.map(row => row.dataset.recordId).filter(Boolean);
      try {
        await removeChatRecordIds(recordIds);
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'PURGE // FAILED', message: '批量记录删除失败，未改动当前会话。', type: 'warning' });
        }
        return;
      }

      rowsToDelete.forEach((row) => {
        row.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        row.style.opacity = '0';
        row.style.transform = 'scale(0.95)';
        setTimeout(() => row.remove(), 200);
      });

      // 消息行移除后，清掉某天被删空后头顶残留的孤儿日期胶囊
      if (window.ChatDaySep) {
        setTimeout(() => ChatDaySep.pruneOrphans(messagesWrap), 240);
      }

      exitBatchMode();
    });
  }

  // 截图：把选中的消息按屏幕顺序拼成一张长图直接下载
  if (batchExportBtn) {
    batchExportBtn.addEventListener('click', async () => {
      const count = selectedRows.size;
      const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
      if (count < 1 || count > limit) return; // 灰态双保险
      if (!window.ChatShot || typeof ChatShot.capture !== 'function') {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CAPTURE // 引擎缺席', message: '截图引擎未加载', type: 'warning' });
        }
        return;
      }

      // 选中集合是无序 Set，按 messagesWrap 里的真实先后排一遍，保证时间线正确
      let rows = Array.from(selectedRows).filter(Boolean);
      if (messagesWrap) {
        const order = Array.from(messagesWrap.querySelectorAll(SELECTABLE_ROW_SELECTOR));
        rows.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      }

      let sceneName = '系统助手';
      try {
        if (typeof getCurrentAssistantName === 'function') {
          sceneName = getCurrentAssistantName() || sceneName;
        }
      } catch (_) { /* 取名失败用默认 */ }

      batchExportBtn.style.pointerEvents = 'none';
      batchExportBtn.style.opacity = '0.5';

      try {
        const res = await ChatShot.capture({
          rows,
          scene: { sceneName, sceneTag: 'ASSISTANT // 助手存档' },
          fileLabel: `助手存档_${sceneName}`
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
        } else {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'CAPTURE // 生成失败', message: '长图生成失败，请重试', type: 'error' });
          }
        }
      } catch (err) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CAPTURE // 生成异常', message: (err && err.message) || '长图生成异常', type: 'error' });
        }
      } finally {
        updateBatchCount();
      }
    });
  }

  if (batchQuoteBtn) {
    batchQuoteBtn.addEventListener('click', () => {
      const count = selectedRows.size;
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'BATCH // COMBINE',
          message: `合并引用 ${count} 条消息至输入台（预留机能）`,
          type: 'info'
        });
      }
    });
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;
      const current = textarea ? textarea.value : '';
      const updated = await TextEditorModal.open({
        title: '文本编辑',
        tag: 'SYSTEM CHAT // 全屏输入',
        value: current,
        placeholder: '向系统助手发送你想得到的帮助，或者别的什么…',
        maxLength: 8000
      });
      if (updated !== null && updated !== undefined && textarea) {
        textarea.value = updated;
        autoResizeTextarea();
        textarea.focus();
      }
    });
  }

  window.addEventListener('retroflow:gallery-assets-released', async (event) => {
    const ids = new Set((((event || {}).detail || {}).chatRecordIds || []).map(String));
    if (!ids.size) return;
    // 用户发图与助手生成图现在共用 .chat-gen-image 裸缩略图结构，统一切占位
    const rows = messagesWrap
      ? Array.from(messagesWrap.querySelectorAll('.chat-msg-row.user, .chat-msg-row.assistant.is-gen-image'))
      : [];
    rows.forEach(row => {
      if (!ids.has(String(row.dataset.recordId || ''))) return;
      row.dataset.mediaState = 'released';
      row.dataset.assetKey = '';
      const figure = row.querySelector('.chat-gen-image');
      if (figure) {
        figure.className = 'chat-gen-image is-released';
        figure.innerHTML = `${IMAGE_PLACEHOLDER_SVG}<span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
      }
    });
    if (window.Storage && typeof Storage.getRecordsByFork === 'function') {
      const records = await Storage.getRecordsByFork(SYSTEM_CHAT_FORK_ID).catch(() => []);
      await Promise.all(records.filter(record => ids.has(String(record.id)) && (record.media || record.imageRef || record.genImageRef)).map(record => {
        if (record.genImageRef) {
          record.genImageRef = { ...record.genImageRef, state: 'released', assetKey: '', galleryId: '' };
        }
        if (record.media) {
          record.media = { ...record.media, state: 'released', assetKey: '', galleryId: '' };
        }
        if (record.imageRef) {
          record.imageRef = { ...record.imageRef, state: 'released', assetKey: '', galleryId: '' };
        }
        record.updatedAt = Date.now();
        return Storage.putRecord(record);
      }));
    }
  });

  function rerenderAllMessages() {
    if (!messagesWrap) return;
    const rows = messagesWrap.querySelectorAll('.chat-msg-row');
    rows.forEach((row) => {
      const bubble = row.querySelector('.chat-bubble');
      if (!bubble) return;
      const rawText = typeof row.dataset.rawText === 'string' ? row.dataset.rawText : bubble.dataset.rawText;
      if (typeof rawText !== 'string') return;
      if (row.classList.contains('assistant')) {
        syncAssistantBubbleGroup(row, rawText);
      } else {
        const content = bubble.querySelector('.chat-bubble-content');
        if (content) renderBubbleText(content, rawText);
      }
    });
  }

  /**
   * 按流水 ID 定位到对应消息行：滚动居中并短暂高亮。
   * 供通用检索页命中跳转使用。历史尚未恢复时先等一轮恢复再定位。
   * @param {string} recordId
   * @returns {Promise<boolean>} 是否找到目标行
   */
  async function locateRecord(recordId) {
    if (!messagesWrap || !recordId) return false;
    if (historyRestorePromise) {
      await historyRestorePromise.catch(() => {});
    }
    const row = messagesWrap.querySelector(`[data-record-id="${String(recordId).replace(/"/g, '\\"')}"]`);
    if (!row) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'SEARCH // 定位失败', message: '这条记录已不在当前会话中', type: 'warning' });
      }
      return false;
    }
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('is-search-located');
    void row.offsetWidth;
    row.classList.add('is-search-located');
    setTimeout(() => row.classList.remove('is-search-located'), 1800);
    return true;
  }

  function isSystemChatViewing() {
    return !!(chatPage && !chatPage.hidden && chatPage.classList.contains('active'));
  }

  function pushSystemReplyNotice(record, previewText) {
    if (isSystemChatViewing()) return;
    if (!window.RetroflowOnlineNotice || typeof RetroflowOnlineNotice.push !== 'function') return;
    RetroflowOnlineNotice.push({
      kind: 'system',
      text: String(previewText || record && record.content || '').trim(),
      record,
      createdAt: record && record.createdAt
    });
  }

  /* ========================================================================
     多对话管理 (Conversations)

     一个助手可以开多个独立对话窗，各自上下文隔离。结构与副本推演的多世界线
     同源：SystemChatStore 管索引与元信息，这里只管视图与切换。

     切换对话要做三件事：改写 SYSTEM_CHAT_FORK_ID、清空并重渲染消息区、
     复位输入态。助手归属不跟对话走 —— 执行员随时可以在同一个窗口换助手。
     ======================================================================== */
/* ========================================================================
     多对话管理 (Conversations)

     一个助手可以开多个独立对话窗，各自上下文隔离。
     对齐副本「查看与切换世界线」交互：直接复用 SelectModal.pick 弹窗，
     居中弹出、零多余全屏页，彻底解决全屏页被压到底部的问题。
     ======================================================================== */

  /** 对话初始化只做一次，open() 与设置页都可能触发 */
  let convInitPromise = null;

  /** 当前对话的流水 forkId，供检索模块等外部消费方取用 */
  function getCurrentForkId() {
    return SYSTEM_CHAT_FORK_ID;
  }

  /** 当前对话标题（可能为空串 = 未命名） */
  function getCurrentConvTitle() {
    return currentConv ? String(currentConv.title || '') : '';
  }

  /**
   * 确保对话体系已初始化，并把当前活跃对话装载进视图状态。
   * 首次运行会把历史遗留的 main 注册成第一条对话（见 SystemChatStore.ensureInit）。
   */
  function ensureConvReady() {
    if (convInitPromise) return convInitPromise;
    convInitPromise = (async () => {
      if (!window.SystemChatStore) return;
      // 老用户以前填过的「备注」搬过来当 main 的初始标题，不丢
      let legacyRemark = '';
      try {
        if (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function') {
          const s = SystemChatSettings.getSettings();
          legacyRemark = s && typeof s.remark === 'string' ? s.remark : '';
        }
      } catch (_) { /* 拿不到就用默认名 */ }

      const conv = await SystemChatStore.ensureInit(legacyRemark);
      if (conv) {
        currentConv = conv;
        currentConvId = conv.id;
        SYSTEM_CHAT_FORK_ID = SystemChatStore.forkIdOf(conv.id);
      }
    })().catch((err) => {
      console.warn('[System Chat] 对话初始化失败：', err);
    });
    return convInitPromise;
  }

  /**
   * 重命名当前对话。设置页输入框边打边调，故不另开确认流程。
   * 标题为空合法 —— 列表会退回显示首条消息摘要。
   */
  async function renameCurrentConv(title) {
    if (!window.SystemChatStore || !currentConvId) return;
    const next = await SystemChatStore.renameConv(currentConvId, title);
    if (next) {
      currentConv = next;
      syncHeaderIdentity();
    }
  }

  /**
   * 切到另一条对话。
   * 清空消息区并重置分页游标，按新 forkId 重新拉流水。
   */
  async function switchConv(convId) {
    if (!window.SystemChatStore) return false;
    const id = String(convId || '').trim();
    if (!id || id === currentConvId) return false;

    const ok = await SystemChatStore.setActiveConvId(id);
    if (!ok) return false;
    const conv = await SystemChatStore.getConv(id);
    if (!conv) return false;

    currentConv = conv;
    currentConvId = conv.id;
    SYSTEM_CHAT_FORK_ID = SystemChatStore.forkIdOf(conv.id);

    // 视图与分页状态全部归零，再按新 forkId 重新拉流水
    if (messagesWrap) messagesWrap.innerHTML = '';
    historyAllRecords = [];
    historyRenderedFrom = 0;
    isLoadingMoreHistory = false;
    historyRestorePromise = null;
    exitBatchMode();
    clearCurrentQuote();

    syncHeaderIdentity();
    await restoreChatHistory();
    return true;
  }

  /** 把时间戳格成列表用的紧凑形式 */
  function formatConvTime(ts) {
    const t = Number(ts) || 0;
    if (!t) return '--';
    const d = new Date(t);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  /**
   * 取某条对话的首条消息摘要，用于未命名对话的兜底显示。
   */
  async function getConvFallbackTitle(convId) {
    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') return '';
    try {
      const records = await Storage.getRecordsByFork(SystemChatStore.forkIdOf(convId)) || [];
      const first = records.find((r) => r && r.role === 'user' && String(r.content || '').trim());
      if (!first) return '';
      const text = String(first.content || '').replace(/\s+/g, ' ').trim();
      return text.length > 14 ? `${text.slice(0, 14)}…` : text;
    } catch (_) {
      return '';
    }
  }

  /**
   * 查看与切换对话弹窗（对齐副本查看世界线 SelectModal.pick）。
   */
  async function openConvPage() {
    if (!window.SystemChatStore) return;
    await ensureConvReady();

    if (!window.SelectModal || typeof SelectModal.pick !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CONV // 异常', message: '选择器组件未就绪', type: 'warning' });
      }
      return;
    }

    const convs = await SystemChatStore.listConvs();
    const onlyOne = convs.length <= 1;

    // 先异步拉取所有未命名对话的首条摘要
    const fallbacks = await Promise.all(
      convs.map((c) => (String(c.title || '').trim() ? Promise.resolve('') : getConvFallbackTitle(c.id)))
    );

    const optList = convs.map((conv, i) => {
      const isCurrent = conv.id === currentConvId;
      const rawTitle = String(conv.title || '').trim();
      const label = rawTitle || fallbacks[i] || `对话 ${String(i + 1).padStart(2, '0')}`;
      const timeStr = formatConvTime(conv.updatedAt);
      const countStr = `${conv.msgCount || 0} 条`;
      const hint = isCurrent ? `ACTIVE · 当前对话 (${countStr})` : `${timeStr} · ${countStr}`;

      const opt = { value: conv.id, label, hint };

      // 删除按钮：唯一对话不给删；当前活跃对话也不由弹窗右侧快捷删除
      if (!onlyOne && !isCurrent) {
        opt.actionLabel = '删除此对话';
        opt.onAction = () => handleDeleteConvFromModal(conv.id, label);
      }
      return opt;
    });

    optList.push({
      value: '__new_conv__',
      label: '+ 开启新的对话',
      hint: '新建空白对话窗口'
    });

    const picked = await SelectModal.pick({
      tag: 'CONVERSATIONS // 对话',
      title: '查看与切换对话',
      options: optList,
      value: currentConvId
    });

    if (!picked) return;

    if (picked === '__new_conv__') {
      const newConv = await SystemChatStore.createConv('');
      if (!newConv) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CONV // 失败', message: '新建对话失败', type: 'warning' });
        }
        return;
      }
      await switchConv(newConv.id);
      if (window.SystemChatSettings && typeof SystemChatSettings.close === 'function') {
        SystemChatSettings.close();
      }
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CONV // 新建', message: '已开启新对话', type: 'success' });
      }
      return;
    }

    if (picked === currentConvId) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'CONV // 活跃对话',
          message: '已锁定当前对话',
          type: 'info'
        });
      }
      return;
    }

    // 切换到目标对话并收起设置页回到聊天
    await switchConv(picked);
    if (window.SystemChatSettings && typeof SystemChatSettings.close === 'function') {
      SystemChatSettings.close();
    }
  }

  /**
   * 对话弹窗内删除某条对话（对齐副本删除世界线逻辑）。
   */
  async function handleDeleteConvFromModal(targetConvId, label) {
    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        message: `确认彻底删除「${label}」吗？`,
        detail: '该对话的全部消息记录将被物理抹除，无法恢复。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
    } else {
      confirmed = window.confirm(`确认彻底删除「${label}」吗？全部消息将被物理抹除。`);
    }
    if (!confirmed) return;

    // 收起当前弹窗再删，避免删完还挂在旧列表上
    if (window.SelectModal && typeof SelectModal.close === 'function') {
      SelectModal.close(null);
    }

    const res = await SystemChatStore.deleteConv(targetConvId);
    if (res && res.ok) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CONV // 删除', message: `已清除「${label}」`, type: 'info' });
      }
      // 重新拉起弹窗刷新列表，保持副本对齐体验
      setTimeout(() => {
        openConvPage();
      }, 120);
    } else {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CONV // 拒绝', message: res.reason === 'last' ? '至少要保留一条对话' : '删除失败', type: 'warning' });
      }
    }
  }

  // 暴露给全局中枢
  window.SystemChatUI = {
    open,
    close,
    // 只收起界面、不触碰 history，供跨页跳转时避免多次 back 造成路由竞态
    dismiss: dismissChatUI,
    // 纯视图恢复，与 dismiss 对称，同样不触碰 history
    reveal,
    isOpen: () => !chatPage.hidden && chatPage.classList.contains('active'),
    appendMessage,
    appendToolCard,
    appendSystemNotice,
    removeChatRecordIds,
    rerenderAllMessages,
    refreshAssistantAvatars,
    syncHeaderIdentity,
    locateRecord,
    // 最近一次真实发出的上下文快照，供上下文查看器读取（只读，可能为 null）
    getLastContextSnapshot: () => lastContextSnapshot,
    // —— 多对话 ——
    openConvPage,
    getCurrentForkId,
    getCurrentConvTitle,
    renameCurrentConv,
    // 供私聊等其他会话页复用同一套图片灯箱：只依赖 Storage / Downloader，不碰助手会话状态
    openGenImageLightbox,
    // 供私聊复用：裁掉模型自行复述的时间标注行。纯字符串处理，无外部依赖
    stripEchoedTimePrefix,

    /* ================= 供 DECK 随行助手舱复用 =================
       副本（及将来沙盒）的 DECK 里有一个随行助手舱，它与本页共用同一条对话：
       同一个 activeConvId、同一张 records 表、同一套落库字段。

       因此落库与上下文装配必须走这里导出的同一批函数 —— DECK 侧若自己写一套
       persist，字段一旦跑偏（kind / forkId / assistantId 任意一个），两边就不再
       是同一份数据，「记录互通」当场失效。

       渲染不在此列：DECK 有自己的消息容器与气泡尺寸，渲染由它自己的
       AssistantChatCore renderer 适配器负责，不复用本页的 appendMessage。 */

    // 上下文装配：读 records 而非 DOM，故 DECK 调用它拿到的历史与本页完全一致
    buildChatHistory,
    // 一轮完整应答：解析模型配置 + 上下文裁剪 + 调内核跑流式与工具循环。
    // 第二参传 { renderer, persist, actions, hooks } 即可把渲染落点换到 DECK，
    // 与界面无关的装配逻辑两端共用。
    requestAssistantReply,
    // 对话就绪：设定 SYSTEM_CHAT_FORK_ID 指向当前 activeConvId（内部幂等）。
    // DECK 侧在落库 / 装配上下文之前必须先 await 它，否则 forkId 可能还停在
    // 初值 system-chat:main，消息会落进错误的对话。
    ensureConvReady,
    // 落库：两条都写当前 activeConvId 的 forkId，字段口径与本页逐一对齐
    persistChatMessage,
    persistToolCallRecord,
    // 工具链：识别 / 执行 / 卡片 tag，三者必须同源，否则两边工具行为会分叉
    isFileToolAction,
    runFileTool,
    toolCardTag,
    // 工具卡展示层：中文名映射与详情弹窗。DECK 随行舱自己造卡片 DOM
    // （因为 appendToolCard 绑死在助手页 messagesWrap 与批量选择态上），
    // 但文案与详情必须走这同两个函数，否则同一次工具调用两边叫法不一样。
    toolLabel,
    openToolInspectModal,
    // 非工具动作（换头像、生图等）与落定后的系统通知
    executeAssistantActions,
    pushSystemReplyNotice,
    // 长按菜单复用：编辑消息要覆盖同一条库记录（口径与本页一致），
    // HUD 图标是纯 SVG 字符串常量，DECK 的 HUD 直接取 copy/edit/delete 三项。
    updateChatRecordContent,
    HUD_ICONS,
    // 空输入 INFER（= 让助手接着说）的延续指令。阅后即焚地拼进 history 尾部，
    // 不落库不上屏。DECK 的 INFER 必须用这同一句，否则两端"继续"的行为会分叉。
    buildSilentContinuationInstruction,
    // 延续指令的拼接前置判定：上下文尾部是否已有未回应的用户消息。
    // 有 → 直接对它回复，不拼指令。DECK 的 INFER 同步修复时必须复用这同一判定。
    historyEndsWithUnansweredUser,
    // 重写用：上下文窗口裁剪 + 错误文案。两个都是纯函数，导出无副作用。
    // DECK 自己跑一份精简流式请求（generateReplacementReply 绑死在本页输入框与
    // 发送按钮状态上，拿过去会操作到助手页的 DOM），但裁剪口径必须共用。
    fitMessagesToContext,
    getApiErrorText,
    // 生图能力：DECK 随行舱自己组装执行器（runImageGenAction 把占位行与成图都
    // 写死挂在本页 messagesWrap 上，拿过去图会落到看不见的容器里），但以下每一
    // 环都必须共用，否则两端生出来的图在尺寸、锁脸、归档、落库字段上会分叉：
    //   · isImageGenEnabled / getImageSlotConfig —— 开关与插槽配置同源
    //   · normalizeImageSize / ratioHintForSize —— 尺寸白名单与纵向比例提示
    //   · resolveGenTarget —— 档案锁脸（取外貌描述 + FACE ID 参考图）
    //   · persistGeneratedImageMessage / makeChatRecordId —— assistant-image 落库口径
    isImageGenEnabled,
    getImageSlotConfig,
    normalizeImageSize,
    ratioHintForSize,
    resolveGenTarget,
    persistGeneratedImageMessage,
    makeChatRecordId,
    // 发图识图能力：DECK 随行舱自己组装发送链路（selectChatImage / renderPendingImages /
    // 发送与异步识图都绑死在本页 pendingImages 与 messagesWrap 上），但以下每一环
    // 必须共用，否则两端的图在压缩、归档、识图、落库字段上会分叉：
    //   · recognizeImage —— 视觉模型识别出 visionDescription（vision 插槽，未配回退主模型）
    //   · persistImageChatMessage —— image 记录落库口径（state / visionDescription / assetKey）
    recognizeImage,
    persistImageChatMessage
  };
})();
