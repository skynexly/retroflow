/**
 * 溯流计划 · 线上联络私聊会话页控制器 (Online Chat UI)
 *
 * 职责：
 *   1. open(charId, accountId, contactId) / close() / reveal() 三入口，
 *      与 SystemChatUI 同一套路由范式
 *   2. 顶栏身份同步（角色名 + 编号），角色立绘异步挂载
 *   3. 文本气泡与语音气泡渲染（语音 = 波形 + 时长 + 常态可见文本）
 *   4. 输入台交互：自适应高度、抽屉展开、跳跃槽
 *   5. 请求链路：RELAY 手动中继与好友申请招呼，走 OnlineChatPrompt 拼装、
 *      parseReply 拆分、OnlineChatStore 落库
 *
 * 尚未接入：TTS 真实合成（语音条目前只做视觉推进）、抽屉八格的实际功能、
 * 长按 HUD 的编辑/重写/回溯动作、流式接收。
 */
window.OnlineChatUI = (() => {
  'use strict';

  /* ================= DOM 引用 ================= */

  const chatPage = document.getElementById('onlineChatPage');
  const messagesWrap = document.getElementById('onlineChatMessages');
  const bodyEl = document.getElementById('onlineChatBody');
  const backBtn = document.getElementById('onlineChatBackBtn');
  const menuBtn = document.getElementById('onlineChatMenuBtn');
  const headerTitle = document.getElementById('onlineChatHeaderTitle');
  const headerStatusEl = document.getElementById('onlineChatHeaderStatus');
  const headerStatusText = document.getElementById('onlineChatHeaderStatusText');
  const textarea = document.getElementById('onlineChatTextarea');
  const footerEl = chatPage ? chatPage.querySelector('.system-chat-footer') : null;
  const sendBtn = document.getElementById('onlineChatSendBtn');
  const relayBtn = document.getElementById('onlineChatRelayBtn');
  const expandBtn = document.getElementById('onlineChatExpandBtn');
  const plusBtn = document.getElementById('onlineChatPlusBtn');
  const dockPanel = document.getElementById('onlineChatDockPanel');
  const jumpDeck = document.getElementById('onlineChatJumpDeck');
  const jumpTopBtn = document.getElementById('onlineChatJumpTopBtn');
  const jumpBottomBtn = document.getElementById('onlineChatJumpBottomBtn');
  const quoteDraftBar = document.getElementById('onlineChatQuoteDraftBar');
  const quoteDraftTag = document.getElementById('onlineChatQuoteDraftTag');
  const quoteDraftSnippet = document.getElementById('onlineChatQuoteDraftSnippet');
  const quoteDraftClose = document.getElementById('onlineChatQuoteDraftClose');
  const voiceModeBar = document.getElementById('onlineChatVoiceModeBar');
  const voiceModeClose = document.getElementById('onlineChatVoiceModeClose');

  // 多选批量操作模式相关 DOM（HTML 与助手页同构，仅 id 前缀不同）
  const batchCancelBtn = document.getElementById('onlineChatBatchCancelBtn');
  const batchSelectAllBtn = document.getElementById('onlineChatBatchSelectAllBtn');
  const batchDock = document.getElementById('onlineChatBatchDock');
  const batchDeleteBtn = document.getElementById('onlineChatBatchDeleteBtn');
  const batchDeleteCount = document.getElementById('onlineChatBatchDeleteCount');
  const batchExportBtn = document.getElementById('onlineChatBatchExportBtn');
  const batchQuoteBtn = document.getElementById('onlineChatBatchQuoteBtn');

  /* ================= 多选态 ================= */

  let isBatchMode = false;
  let selectedRows = new Set();

  /**
   * 可被多选与回溯统一纳管的行口径。
   *
   * 三类都算一等公民：消息气泡、撤回通知胶囊、文件翻阅胶囊。
   * 前两类落库、带 recordId；文件翻阅胶囊是纯视觉痕迹不落库，但也必须能选中——
   * 否则把消息删干净后，「翻看了某文件」还孤零零留在流里，比删不掉更奇怪。
   * 批量删除时它没有 recordId，会被 filter 自动跳过，只走 DOM 移除。
   *
   * 全选、批量删除、回溯三处消费方共用此常量，避免出现「勾得上却删不掉」的孤儿。
   */
  const SELECTABLE_ROW_SELECTOR = '.chat-msg-row, .chat-status-pill-row[data-system-notice="true"], .chat-status-pill-row[data-file-peek="true"]';

  let pendingImages = []; // 元素为 { blob, objectUrl }
  let imagePreviewBar = null;
  let pendingFiles = [];
  let filePreviewBar = null;
  /**
   * 语音模式：开着时发出去的是语音条而不是文字气泡。
   *
   * 这是「假语音」——不录音，仍然打字，只是消息形态与上下文标记变成语音。
   * 拟真的点在于对方看到的是语音条、模型收到的是 [语音]xxx，
   * 也就知道这句话是说出口的而非打字的。
   *
   * 有意做成持续态而非一次性：真人连发几条语音很常见，
   * 每条都要重新点一次入口太碎。退出靠再点入口或点模式条上的叉。
   */
  let isVoiceMode = false;

  const DOC_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 2.5L17.5 8H14V4.5zM8 12h8v2H8zm0 4h8v2H8z"/></svg>';

  function onlineFileScope() { return { type: 'online', id: sessionKey(currentAccountId, currentContactId) }; }
  const onlineImageInput = document.createElement('input');
  onlineImageInput.type = 'file';
  onlineImageInput.accept = 'image/*';
  onlineImageInput.hidden = true;
  document.body.appendChild(onlineImageInput);

  /* ================= 会话态 ================= */

  /** 当前对话的角色档案 id */
  let currentCharId = '';
  /** 当前登录账号，'persona' 或马甲 id；马甲场景尚未启用 */
  let currentAccountId = 'persona';
  /** 当前联系人记录 id，消息落库的归属键 */
  let currentContactId = '';
  /** 当前角色档案快照 */
  let currentPerson = null;
  /** 程序性 history.back() 标记，避免 popstate 重复处理 */
  let pendingProgrammaticBack = false;
  /** 当前正在播放的语音条 */
  let activeVoiceStrip = null;
  /** 每个私聊会话独立维护请求状态，允许不同窗口并行中继 */
  const requestStates = new Map();
  let activeSessionToken = 0;

  function sessionKey(accountId, contactId) {
    return `online:${accountId}:${contactId}`;
  }

  function getRequestState(accountId, contactId) {
    const key = sessionKey(accountId, contactId);
    let state = requestStates.get(key);
    if (!state) {
      state = { key, requesting: false, abortController: null, pendingRow: null };
      requestStates.set(key, state);
    }
    return state;
  }

  function isSessionCurrent(snapshot) {
    return !!snapshot
      && snapshot.token === activeSessionToken
      && snapshot.charId === currentCharId
      && snapshot.accountId === currentAccountId
      && snapshot.contactId === currentContactId;
  }
  /**
   * 招呼链路的历史条数上限。
   *
   * 招呼发生在刚加上好友的瞬间，历史必然只有零到一条验证消息，
   * 走不走预算都一样，保留一个宽松的定值即可，不必为它算预算。
   */
  const GREETING_CONTEXT_LIMIT = 60;

  /**
   * 世界书探测装配的回溯轮数。
   *
   * 只为拿到 systemPrompt 的那一遍装配用这个窗口。世界书关键词判定实际只需要
   * 最近 2 轮（WorldBookEngine.SCAN_MESSAGE_COUNT = 4 条合并后消息），这里取 4 轮
   * 是留一倍余量：万一某轮只有单方发言、合并后占不满 2 条，也不会漏判。
   * 再大就纯属浪费——多渲染的记录一条都进不了扫描文本。
   */
  const PROBE_TURN_COUNT = 4;

  /**
   * 本次请求实际注入上下文的 recordId 集合，用于引用锚定。
   *
   * 为什么不是一个条数常量：注入量现在由 token 预算动态决定，
   * 每次请求能装进去多少轮都不一样，任何固定条数都会跟真实注入量失配。
   * 窗口小于注入量，会让「模型确实读到了、也照实引了」的正当引用锚定失败，
   * 用户看到引用凭空消失；大于注入量则是扫描模型看不见的历史，白费功夫
   * 还容易误匹配远古的相似句子。
   *
   * 所以改成由裁剪器回报事实：每次装配完把保留下来的 recordId 记在这里，
   * 锚定只在这个集合里找。窗口与注入量严格相等，不再是估算。
   */
  let lastInjectedRecordIds = new Set();

  /** 记下本次注入覆盖了哪些记录，供引用锚定使用 */
  function setInjectedScope(records) {
    lastInjectedRecordIds = new Set(
      asArray(records).filter(Boolean).map((r) => r.id).filter(Boolean)
    );
  }


  /** 图片引用卡的统一显示文本：识图结果与生图 prompt 都不适合直接给人看 */
  const QUOTE_IMAGE_LABEL = '[图片]';

  /**
   * 归一化引用文本，用于模糊比对。
   * 去掉空白与常见标点，统一大小写：模型复写原话时最常见的偏差就是
   * 多一个句号、少一个逗号，或者把全角标点写成半角。
   * @param {string} v
   * @returns {string}
   */
  function normalizeQuoteText(v) {
    return String(v == null ? '' : v)
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[，。！？、；：""''「」『』（）()[\]【】~—…\-.,!?;:'"]/g, '');
  }

  /**
   * 把模型写的引用片段锚定到真实的历史消息。
   *
   * 只认真实存在的消息：锚不上就返回 null，让调用方丢弃引用。
   * 宁可少一张引用卡，也不能让界面显示出一句对方根本没说过的话——
   * 那比没有引用更容易让人误判对话内容。
   *
   * 遍历方向是从最近往最旧，命中即停。这既符合真人习惯（引用几乎总是
   * 指最近说的那句），也是短句歧义的唯一解法：历史里有三个「嗯」时，
   * 锚定到最后那个。因此不需要给引用文本设最小长度门槛。
   *
   * @param {string} quoteText 模型写的引用片段
   * @param {Array} records 该会话的全部消息记录，按时间正序
   * @returns {{role: string, senderName: string, text: string, recordId: string}|null}
   */
  function anchorQuote(quoteText, records) {
    const needle = normalizeQuoteText(quoteText);
    if (!needle) return null;

    const list = asArray(records);
    // 只在「本次请求真的注入过」的记录里锚定。集合为空说明还没发起过请求
    // （比如页面刚打开就收到主动消息），此时退回全量，避免正当引用被误杀。
    const scope = lastInjectedRecordIds.size
      ? list.filter((r) => r && lastInjectedRecordIds.has(r.id))
      : list;

    // 「图片」字样把候选集缩到图片消息，后面的描述片段再在图片之间定位。
    // 剥掉这两个字再比对，否则 needle 里的「图片」会污染与描述的比对。
    const imageHint = /^(图片|照片|图|image|photo)/i.test(String(quoteText || '').trim());
    const imageNeedle = imageHint
      ? normalizeQuoteText(String(quoteText).trim().replace(/^(图片|照片|图|image|photo)\s*/i, ''))
      : '';

    for (let i = scope.length - 1; i >= 0; i--) {
      const r = scope[i];
      if (!r) continue;
      // 撤回通知不是任何人说的话，不可被引用
      if (r.role === 'system' || r.messageType === 'notice') continue;

      const senderName = r.role === 'envoy'
        ? getCurrentUserName()
        : (trimStr(currentPerson && currentPerson.name) || '对方');

      if (r.messageType === 'image') {
        if (!imageHint) continue;
        const desc = normalizeQuoteText(r.imageRef && r.imageRef.visionDescription);
        // 只写了「图片」没写描述：锚到最近那张图
        const hit = !imageNeedle
          || (desc && (desc.includes(imageNeedle) || imageNeedle.includes(desc)));
        if (!hit) continue;
        return {
          role: r.role,
          senderName,
          text: QUOTE_IMAGE_LABEL,
          recordId: r.id,
          imageAssetKey: (r.imageRef && r.imageRef.assetKey) || ''
        };
      }

      // 带「图片」前缀的引用不该落到文字消息上
      if (imageHint) continue;

      const hay = normalizeQuoteText(r.content);
      if (!hay) continue;
      // 双向包含：模型可能只写开头一段（截断），也可能多写了标点
      if (hay.includes(needle) || needle.includes(hay)) {
        return { role: r.role, senderName, text: trimStr(r.content), recordId: r.id };
      }
    }

    return null;
  }

  /* ================= 工具 ================= */

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  function trimStr(v) {
    return v == null ? '' : String(v).trim();
  }

  /** 读取当前执行员的实际显示名，和系统助手页保持同一身份来源 */
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

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  /** 六位编号归一化 */
  function normalizeSerial(v) {
    const digits = String(v == null ? '' : v).replace(/\D/g, '');
    if (!digits) return '';
    return digits.padStart(6, '0').slice(-6);
  }

  /**
   * 从 roster 三通道找档案。
   *
   * 返回值附带 __rosterType：档案记录本身不存维次，
   * 而立绘资产键按维次分库（char.avatar.* / npc.avatar.*），
   * 不带这个标记的话 NPC 会被当成角色去取 charAvatar，键对不上、头像取空。
   *
   * 官方角色与角色共用 characters 池，靠 camp 区分，立绘键同走 charAvatar。
   */
  function findPerson(charId) {
    if (!charId || !window.Store || !Store.roster) return null;
    const pools = [
      { list: Store.roster.characters, rosterType: 'char' },
      { list: Store.roster.npcs, rosterType: 'npc' },
      { list: Store.roster.officials, rosterType: 'official' }
    ];
    for (const pool of pools) {
      const hit = asArray(pool.list).find((p) => p && p.id === charId);
      // 不改动原档案对象，避免把显示层标记写回 Store
      if (hit) return Object.assign({}, hit, { __rosterType: pool.rosterType });
    }
    return null;
  }

  /**
   * 按维次取立绘资产键，与 online-ui.js 的 avatarKeyOf 保持同一套规则。
   * 传 null 时退回当前会话档案。
   */
  function avatarKeyOfPerson(charId, person) {
    if (!charId || !window.DataRegistry || !DataRegistry.key) return '';
    const profile = person || (currentPerson && currentPerson.id === charId ? currentPerson : findPerson(charId));
    const rosterType = profile && profile.__rosterType;
    if (rosterType === 'npc') return DataRegistry.key.npcAvatar(charId);
    return DataRegistry.key.charAvatar(charId);
  }

  /** 时间戳格式化为 HH:MM */
  function formatTime(ts) {
    const d = ts ? new Date(ts) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
    * 按流水 ID 定位到对应消息行：滚动居中并短暂高亮。
    * 供通用检索页命中跳转使用。
    * @param {string} recordId
    * @returns {Promise<boolean>} 是否找到目标行
    */
  async function locateRecord(recordId) {
    if (!messagesWrap || !recordId) return false;
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

  /* ================= 顶栏身份 ================= */

  function syncHeaderIdentity() {
    const name = trimStr(currentPerson && currentPerson.name) || '未命名';
    if (headerTitle) headerTitle.textContent = name;

    if (headerStatusText) {
      const serial = normalizeSerial(currentPerson && currentPerson.serial);
      const isInstance = currentPerson && currentPerson.camp === 'instance';
      // 副本阵营角色不属于溯流编制，无编号
      headerStatusText.textContent = isInstance || !serial
        ? 'FORK LINK // 副本频段'
        : `NO.${serial} // 执行员`;
    }
  }

  /* ================= 头像 ================= */

  /** 统一取本人或对方头像 */
  async function getPersonOrEnvoyAvatar(isEnvoy, charId) {
    return isEnvoy ? getEnvoyAvatarSrc() : getPersonAvatarSrc(charId);
  }

  /** 取角色立绘。NPC 与角色的资产键分库，须按维次取。 */
  async function getPersonAvatarSrc(charId) {
    if (!charId || !window.Storage || !window.DataRegistry) return '';
    try {
      const key = avatarKeyOfPerson(charId);
      if (!key) return '';
      const src = await Storage.getAssetSrc(key);
      return src || '';
    } catch (_) {
      return '';
    }
  }

  /**
   * 取执行员本人在私聊里显示的头像。
   *
   * 优先级：线上账号头像 → 身份立绘 → 交给调用方兜底 SVG 剪影。
   *
   * 账号头像（注册时上传的那张）优先于身份立绘，原因是它就是为「聊天里对外
   * 展示的样子」而传的，登录页与联系人列表也是这个口径，三处必须一致。
   *
   * 身份立绘按账号类型分流：马甲走 maskAvatar(id)，本体走 personaAvatar()。
   * 用马甲跟人聊时显示本体立绘等于马甲白做了。
   *
   * @param {string} [accountId] 当前登录账号，缺省视为本体
   * @returns {Promise<string>} objectURL 或空串
   */
  async function getEnvoyAvatarSrc(accountId) {
    if (!window.Storage || !window.DataRegistry) return '';
    const acc = accountId || currentAccountId || 'persona';
    const keys = [
      DataRegistry.key.onlineAccountAvatar(acc),
      acc === 'persona' ? DataRegistry.key.personaAvatar() : DataRegistry.key.maskAvatar(acc)
    ];
    for (const key of keys) {
      try {
        const src = await Storage.getAssetSrc(key);
        if (src) return src;
      } catch (_) { /* 单个键取不到就往下回落 */ }
    }
    return '';
  }

  /** 统一 Toast 出口：项目里实际导出的是 RetroToast */
  function toast(message, detail) {
    if (window.RetroToast && typeof RetroToast.info === 'function') {
      RetroToast.info(message, detail || '');
    }
  }

  /* ================= 气泡渲染 ================= */

  /** 头像兜底：无立绘时用纯 SVG 人形剪影 */
  const AVATAR_FALLBACK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5z"/>'
    + '</svg>';

  const VOICE_PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 001.52.85l11-6.86a1 1 0 000-1.7L9.52 4.29A1 1 0 008 5.14z"/></svg>';
  const VOICE_PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5A1.5 1.5 0 017.5 4h1A1.5 1.5 0 0110 5.5v13A1.5 1.5 0 018.5 20h-1A1.5 1.5 0 016 18.5v-13zm8 0A1.5 1.5 0 0115.5 4h1a1.5 1.5 0 011.5 1.5v13a1.5 1.5 0 01-1.5 1.5h-1a1.5 1.5 0 01-1.5-1.5v-13z"/></svg>';

  /** 机能声纹徽标 SVG */
  const VOICE_SIGNAL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a1 1 0 011 1v18a1 1 0 11-2 0V3a1 1 0 011-1zm5 4a1 1 0 011 1v10a1 1 0 11-2 0V7a1 1 0 011-1zM7 6a1 1 0 011 1v10a1 1 0 11-2 0V7a1 1 0 011-1zm14 4a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1zM3 10a1 1 0 011 1v2a1 1 0 11-2 0v-2a1 1 0 011-1z"/></svg>';

  /** 验证消息标记的证章 SVG */
  const VERIFY_MARK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1.06 14.02L7.4 11.48l1.41-1.41 2.12 2.12 4.24-4.24 1.42 1.41-5.65 5.66z"/>'
    + '</svg>';

  /** 等待对方回复时的波形动效，与助手页共用 chat-waveform 样式 */
  const WAVEFORM_HTML = '<div class="chat-waveform" aria-label="等待对方回复">'
    + '<span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span>'
    + '<span class="chat-waveform-bar"></span><span class="chat-waveform-bar"></span>'
    + '</div>';

  /** 气泡逐条入场的间隔。对齐隔壁天枢城 phone.js 的 600ms */
  const BUBBLE_STAGGER_MS = 600;

  /**
   * 判定「贴着底部」的容差。小于这个距离就认为用户在看最新消息，
   * 新气泡上屏时跟随滚动；超过则认为在翻旧消息，不抢滚动位置。
   */
  const STICK_THRESHOLD_PX = 140;

  /**
   * 历史回放期间为 true：此时禁止任何滚动动作。
   *
   * 为什么需要这个开关：进会话时历史是一条条 append 的，每条都会触发
   * followBottomIfNear()，等于把「滚到底」重复执行几十次。首帧内不可见，
   * 但配合 settleChatBottom() 里 80ms 的延迟补偿，那一次已经落在页面
   * 进场动画中途，用户就会看到「进去之后又滚了一下」。
   *
   * 助手页没这个毛病，因为它铺历史期间完全不滚，只在全部挂载完做一次
   * scrollTop 硬赋值（见 system-chat-ui.js restoreChatHistory 的 finally）。
   * 这里对齐同一套做法。
   */
  let isRestoringHistory = false;

  /* ================= 历史分页 =================
   * 私聊多会话，分页状态必须是会话级：每次 loadMessages 开头随 innerHTML=''
   * 一起重置，切联系人/退出重进都从头来。上下文构建不受影响——它独立从
   * OnlineChatStore.listMessages 读全量，与这里的渲染分页完全解耦。 */
  const HISTORY_PAGE_INIT = 50;   // 首屏渲染最新已读条数
  const HISTORY_PAGE_STEP = 30;   // 上滑每次前插更早条数
  /** 当前会话「已读历史段」的全量记录快照（正序），分页从这里切片 */
  let historyAllRecords = [];
  /** 已读历史段中已渲染的条数（从尾部往前算） */
  let historyRenderedCount = 0;
  /** 上滑加载重入锁 */
  let isLoadingMoreHistory = false;
  /** 前插锚点：非空时 mountChatNode 走 insertBefore 而非 appendChild */
  let historyInsertAnchor = null;

  /**
   * 统一挂载点：所有 append 系列的行节点都经此上屏。
   *
   * 历史前插（loadMoreHistory）期间 historyInsertAnchor 指向当前最顶节点，
   * 此时插到它前面；其余情况（首屏回放、实时追加、推理中）一律 appendChild
   * 到底部。系统助手页栽过跟头——漏改某处 append 导致上滑时消息插到底、
   * 胶囊插到顶，DOM 撕裂。这里一次收口到位。
   */
  function mountChatNode(node) {
    if (!messagesWrap || !node) return;
    if (isRestoringHistory && historyInsertAnchor) {
      messagesWrap.insertBefore(node, historyInsertAnchor);
    } else {
      messagesWrap.appendChild(node);
    }
  }

  /**
   * 头像补齐后的滚动跟随。
   *
   * 头像塞进来会二次撑高行高，不补一次的话差出的高度会把气泡挤到视口下方。
   * 但历史回放阶段必须静默：这些回调多在 isRestoringHistory 关闭后才到达，
   * 若走常规跟随就是一次可见的滚动跳动，正是「进来又滚一下」的残留来源。
   * 此时直接硬赋值到底，不产生过程。
   */
  function refollowAfterAvatar(row, stickBottom) {
    if (!row || !row.isConnected) return;
    syncChatFooterSpace();
    if (isRestoringHistory) {
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
      return;
    }
    if (stickBottom) scrollToBottom(false);
    else followBottomIfNear();
  }

  /** 简易等待，用于气泡逐条插入之间的停顿 */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }

  /**
   * 生成波形轨 SVG。竖条高度按内容做确定性伪随机，
   * 同一段文本每次渲染形状一致，不会刷新就变样。
   */
  function buildWaveSvg(seedText, barCount) {
    const count = Math.max(14, Math.min(32, barCount || 20));
    let seed = 0;
    const src = String(seedText || 'voice');
    for (let i = 0; i < src.length; i++) {
      seed = (seed * 31 + src.charCodeAt(i)) % 100000;
    }
    const rects = [];
    const barW = 2.5;
    const gap = 2;
    for (let i = 0; i < count; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      // 形成自然的包络线：两头稍低，中间高低错落
      const envelope = Math.sin((i / (count - 1)) * Math.PI) * 0.4 + 0.6;
      const ratio = (0.2 + ((seed % 1000) / 1000) * 0.8) * envelope;
      const h = Math.max(4, Math.round(20 * ratio));
      const y = Math.round((20 - h) / 2);
      rects.push(`<rect x="${(i * (barW + gap)).toFixed(1)}" y="${y}" width="${barW}" height="${h}" rx="1.25" data-bar="${i}"/>`);
    }
    const totalW = count * (barW + gap) - gap;
    return `<svg class="chat-voice-wave" viewBox="0 0 ${totalW.toFixed(1)} 20" preserveAspectRatio="none" aria-hidden="true">${rects.join('')}</svg>`;
  }

  /** 依文本长度粗略估算语音时长（秒），模拟真实语音条长短差异 */
  function estimateVoiceSeconds(text) {
    const len = String(text || '').replace(/\s/g, '').length;
    // 按每秒约 4.5 字的语速估算，下限 1 秒
    return Math.max(1, Math.round(len / 4.5));
  }

  function formatVoiceDuration(sec) {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return `${s}"`;
    return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}"`;
  }

  /**
   * 挂载一条消息气泡。DOM 结构严格对齐助手页：
   *   .chat-msg-row > .chat-avatar-col（.chat-avatar-circle + .chat-avatar-time）
   *                 + .chat-bubble（.chat-bubble-tag + 正文）
   * @param {Object} msg
   * @param {'envoy'|'char'} msg.role      envoy = 本人（右侧），char = 对方（左侧）
   * @param {'text'|'voice'} msg.type
   * @param {string} msg.content
   * @param {number} [msg.createdAt]
   * @param {boolean} [msg.isVerifyMsg]    好友申请的验证消息，气泡内加专属小标
   * @param {string} [msg.recordId]        落库记录 id，供后续回溯与删除定位
   * @param {boolean} [msg.animate]        是否播入场动画，历史回放时关掉
   * @param {boolean} [msg.stickBottom]    true = 插入后钉底（用户自己发消息）。
   *                                       逐条上屏不传，让内容在块级流里自然往下长。
   */
  /**
   * 实时追加消息前判断跨天，需要则先落一枚当天日期胶囊。
   * 历史回放阶段静默（由 restoreChatHistory 循环统一插），避免与本函数重复。
   */
  function maybeInsertRealtimeDaySep(createdAt) {
    if (isRestoringHistory) return;
    if (!window.ChatDaySep || !messagesWrap || !createdAt) return;
    const rows = messagesWrap.querySelectorAll('.chat-msg-row');
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    const prevTs = lastRow ? Number(lastRow.dataset.createdAt) : 0;
    if (ChatDaySep.isCrossDay(prevTs, createdAt)) {
      messagesWrap.appendChild(ChatDaySep.buildPill(createdAt));
    }
  }

  async function appendMessage(msg) {
    if (!messagesWrap || !msg) return null;
    maybeInsertRealtimeDaySep(msg.createdAt);
    if (msg.type === 'image' && msg.imageRef) {
      return appendImageMessage(msg);
    }

    const isEnvoy = msg.role === 'envoy';
    const row = document.createElement('div');
    // 复用助手页的左右分栏语义：对方走 assistant 侧，本人走 user 侧
    row.className = `chat-msg-row ${isEnvoy ? 'user' : 'assistant'}`;
    if (msg.recordId) row.dataset.recordId = msg.recordId;
    if (msg.createdAt) row.dataset.createdAt = String(msg.createdAt);

    // 入场动画：本条气泡自己上浮。逐条插入的节奏由调用方用 sleep 控制，
    // 这里不做延迟——延迟动画只会让 DOM 先占好位置再淡入，看不出「挤进来」的感觉
    if (msg.animate) {
      row.classList.add('is-entering');
      row.addEventListener('animationend', () => {
        row.classList.remove('is-entering');
      }, { once: true });
    }

    // 多选模式战术方形复选框（常态隐藏，由 .is-batch-mode 控制显隐）
    attachRowBatchSelection(row);

    // 头像与时间列
    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    avatarCircle.innerHTML = AVATAR_FALLBACK_SVG;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-avatar-time';
    timeSpan.textContent = formatTime(msg.createdAt);
    avatarCol.append(avatarCircle, timeSpan);

    // 气泡主体
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isEnvoy ? 'user' : 'assistant'}`;
    bubble.dataset.rawText = msg.content || '';
    bubble.dataset.msgType = msg.type || 'text';

    const tag = document.createElement('div');
    tag.className = 'chat-bubble-tag';
    const charName = trimStr(currentPerson && currentPerson.name) || '执行员';
    tag.textContent = isEnvoy ? 'OPERATIVE' : `ENVOY // ${charName}`;
    row.dataset.senderName = isEnvoy ? getCurrentUserName() : charName;
    bubble.appendChild(tag);

    // 若带有引用内容，渲染内嵌引用微卡（与助手页结构与样式对齐）
    const quotePayload = msg.quote;
    if (quotePayload && quotePayload.text) {
      bubble.dataset.quoteSenderName = quotePayload.senderName || '';
      bubble.dataset.quoteText = quotePayload.text;
      bubble.dataset.quoteRole = quotePayload.role || '';

      const quoteCard = document.createElement('div');
      quoteCard.className = 'chat-bubble-quote';

      const quoteTag = document.createElement('span');
      quoteTag.className = 'chat-bubble-quote-tag';
      quoteTag.textContent = quotePayload.senderName || (quotePayload.role === 'char' ? charName : 'OPERATIVE');

      const quoteText = document.createElement('p');
      quoteText.className = 'chat-bubble-quote-text';
      quoteText.textContent = quotePayload.text;

      // 引用图片时把原图缩略图并排放在文字左边。
      // 卡片本身是纵向的（标签在上），所以文字与缩略图另包一层横向容器。
      const quoteBody = document.createElement('div');
      quoteBody.className = 'chat-bubble-quote-body';
      quoteBody.appendChild(quoteText);

      quoteCard.append(quoteTag, quoteBody);
      if (quotePayload.recordId) quoteCard.dataset.quoteRecordId = quotePayload.recordId;
      renderQuoteThumb(quoteCard, 'chat-bubble-quote-thumb', quotePayload, (thumb) => {
        quoteBody.insertBefore(thumb, quoteText);
      });
      bubble.appendChild(quoteCard);
    }

    // 验证消息小标：好友申请附带的那句话，和正常聊天区分开
    if (msg.isVerifyMsg) {
      const mark = document.createElement('div');
      mark.className = 'chat-verify-mark';
      mark.innerHTML = `${VERIFY_MARK_SVG}<span>验证消息</span>`;
      bubble.appendChild(mark);
    }

    if (msg.type === 'voice') {
      const seconds = estimateVoiceSeconds(msg.content);
      const barCount = Math.max(14, Math.min(30, 12 + seconds * 2));
      const block = document.createElement('div');
      block.className = 'chat-voice-block';
      // 只有对方的语音条可播：TTS 是「听对方说话」，
      // 执行员自己发出的语音在现实里也不会回放给自己听。
      // 本人侧仍渲染完整声纹槽与转写文本，只是不接播放交互。
      const playable = !isEnvoy;
      block.innerHTML = `
        <div class="chat-voice-strip${playable ? '' : ' is-static'}"${playable ? ' role="button" tabindex="0" aria-label="播放语音"' : ''}>
          <div class="chat-voice-control-wrap">
            <button class="chat-voice-play-btn" type="button" aria-label="播放"${playable ? '' : ' disabled tabindex="-1" aria-hidden="true"'}>${VOICE_PLAY_SVG}</button>
          </div>
          <div class="chat-voice-wave-wrap">
            ${buildWaveSvg(msg.content, barCount)}
          </div>
          <div class="chat-voice-meta">
            <span class="chat-voice-duration">${formatVoiceDuration(seconds)}</span>
          </div>
        </div>
        <div class="chat-voice-transcript-wrap">
          <p class="chat-voice-transcript">${escapeHtml(msg.content)}</p>
        </div>
      `;
      bubble.appendChild(block);
      if (playable) {
        bindVoiceStrip(block.querySelector('.chat-voice-strip'), msg.content);
      }
    } else {
const content = document.createElement('div');
       content.className = 'chat-bubble-content';
       content.textContent = msg.content;
       bubble.appendChild(content);
       if (isEnvoy && Array.isArray(msg.fileRefs) && msg.fileRefs.length) {
         const fileCard = document.createElement('div');
         fileCard.className = 'chat-file-card';
         msg.fileRefs.forEach((f) => {
           const item = document.createElement('div');
           item.className = 'chat-file-card-item';
           item.innerHTML = `<span class="chat-file-card-icon">${DOC_ICON_SVG}</span><span class="chat-file-card-body"><span class="chat-file-card-name">${escapeHtml(f.name)}</span><span class="chat-file-card-meta">${escapeHtml(f.sizeText || '')} // ${f.charCount || 0} 字符</span></span>`;
           item.addEventListener('click', async (e) => {
             e.stopPropagation();
             const text = await FileStore.getText(f.id, onlineFileScope());
             if (text != null) window.dispatchEvent(new CustomEvent('retroflow:preview-file', { detail: { name: f.name, text } }));
             else toast('文件已失效', '该文件已从当前私聊文件区删除');
           });
           fileCard.appendChild(item);
         });
         bubble.insertBefore(fileCard, content);
       }
    }

    // 左右顺序由 CSS 的 row-reverse 负责（.chat-msg-row.user），
    // 这里始终按同一顺序追加，再翻一次会把两侧头像都摆错
    row.append(avatarCol, bubble);
    mountChatNode(row);

    // 插入后跟随滚动。
    // stickBottom = true 时无条件到底（用户自己发的消息）；
    // 否则只在用户本来就贴底时跟随，翻旧消息时不抢滚动位置。
    // 历史回放期间一律静默硬定位，收尾交给 settleChatBottom(true)。
    if (isRestoringHistory) {
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    } else if (msg.stickBottom) {
      scrollToBottom(false);
    } else {
      followBottomIfNear();
    }

    // 立绘异步补齐，不阻塞气泡上屏。
    // 头像塞进来会二次撑高行高，跟随要再补一次，否则差出的高度又会把气泡挤到视口下方。
    getPersonOrEnvoyAvatar(isEnvoy, currentCharId).then((src) => {
      if (!src || !avatarCircle.isConnected) return;
      avatarCircle.innerHTML = '';
      const img = document.createElement('img');
      img.alt = isEnvoy ? '执行员头像' : `${charName}头像`;
      const refollow = () => refollowAfterAvatar(row, msg.stickBottom);
      img.addEventListener('load', refollow, { once: true });
      img.addEventListener('error', refollow, { once: true });
      img.src = src;
      avatarCircle.appendChild(img);
      if (img.complete) refollow();
    });

    // 绑定气泡长按唤起 HUD 菜单
    bindBubbleLongPress(bubble, msg.role, msg.content, row);

    return row;
  }

  async function appendImageMessage(msg) {
    // 对方发来的图走 assistant 侧，本人发的走 user 侧，与文本气泡同一套分栏语义
    const isEnvoy = msg.role === 'envoy';
    const row = document.createElement('div');
    row.className = `chat-msg-row ${isEnvoy ? 'user' : 'assistant'}`;
    if (msg.recordId) row.dataset.recordId = msg.recordId;
    if (msg.messageGroupId) row.dataset.messageGroupId = msg.messageGroupId;
    if (msg.createdAt) row.dataset.createdAt = String(msg.createdAt);
    row.dataset.senderName = isEnvoy ? getCurrentUserName() : (trimStr(currentPerson && currentPerson.name) || '对方');
    row.dataset.visionDescription = String(msg.imageRef.visionDescription || '');
    row.dataset.galleryId = String(msg.imageRef.galleryId || '');
    row.dataset.assetKey = String(msg.imageRef.assetKey || '');
    row.dataset.mediaState = String(msg.imageRef.state || 'active');

    attachRowBatchSelection(row);

    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    avatarCircle.innerHTML = AVATAR_FALLBACK_SVG;
    const time = document.createElement('span');
    time.className = 'chat-avatar-time';
    time.textContent = formatTime(msg.createdAt);
    avatarCol.append(avatarCircle, time);

    const mediaStack = document.createElement('div');
    mediaStack.className = 'chat-user-media-stack';
    const figure = document.createElement('div');
    figure.className = 'chat-gen-image';
    const releasedSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4V4zm2 2v9.17l2.59-2.58L12 16l2.59-2.59L18 16.83V6H6zm3.5 5A1.5 1.5 0 109.5 8a1.5 1.5 0 000 3z"/><path d="M5.41 4L20 18.59 18.59 20 4 5.41 5.41 4z"/></svg>';
    const released = msg.imageRef.state === 'released' || !msg.imageRef.assetKey;
    if (released) {
      figure.classList.add('is-released');
      figure.innerHTML = `${releasedSvg}<span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
    } else {
      const img = document.createElement('img');
      img.alt = isEnvoy ? '用户发送的图片' : '对方发送的图片';
      img.loading = 'lazy';
      try {
        const src = await Storage.getAssetSrc(msg.imageRef.assetKey);
        if (!src) throw new Error('asset released');
        img.src = src;
        img.addEventListener('click', (e) => {
          if (isBatchMode) return;
          e.stopPropagation();
          openOnlineImageLightbox(src, msg.imageRef.assetKey);
        });
        figure.appendChild(img);
      } catch (_) {
        figure.classList.add('is-released');
        figure.innerHTML = `${releasedSvg}<span>影像已释放</span><small>VISUAL ASSET RELEASED</small>`;
        row.dataset.mediaState = 'released';
      }
    }
    mediaStack.appendChild(figure);
    if (msg.imageRef.state && msg.imageRef.state !== 'active') {
      const visionStatus = document.createElement('div');
      visionStatus.className = `chat-vision-status is-${msg.imageRef.state}`;
      visionStatus.textContent = msg.imageRef.state === 'pending' ? '正在识别影像……' : msg.imageRef.state === 'failed' ? '影像识别失败' : '影像记忆已归档';
      mediaStack.appendChild(visionStatus);
    }
    row.append(avatarCol, mediaStack);
    mountChatNode(row);

    getPersonOrEnvoyAvatar(isEnvoy, currentCharId).then((src) => {
      if (!src || !avatarCircle.isConnected) return;
      avatarCircle.innerHTML = '';
      const img = document.createElement('img');
      img.alt = isEnvoy ? '执行员头像' : `${trimStr(currentPerson && currentPerson.name) || '联系人'}头像`;
      const refollow = () => refollowAfterAvatar(row, msg.stickBottom);
      img.addEventListener('load', refollow, { once: true });
      img.addEventListener('error', refollow, { once: true });
      img.src = src;
      avatarCircle.appendChild(img);
      if (img.complete) refollow();
    }).catch(() => {});
    bindBubbleLongPress(figure, msg.role, msg.imageRef.visionDescription || '[图片]', row);
    if (isRestoringHistory) {
      // 历史回放期间不产生可见滚动，收尾由 settleChatBottom(true) 统一定位
      if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
    } else if (msg.stickBottom) {
      scrollToBottom(false);
    } else {
      followBottomIfNear();
    }
    return row;
  }

  /**
   * 打开图片大图。复用助手页那套灯箱（含 dataURL 转换、长按保存、安全区顶栏），
   * 避免两边各维护一份。assetKey 必须带上，否则灯箱拿不到原始资产、长按无法保存。
   * @param {string} src 立即显示用的图源（通常是 blob:）
   * @param {string} [assetKey] 原始资产键
   */
  function openOnlineImageLightbox(src, assetKey) {
    if (!src) {
      toast('无法查看大图', '影像地址为空，可能资产已释放');
      return;
    }
    if (window.SystemChatUI && typeof SystemChatUI.openGenImageLightbox === 'function') {
      try {
        SystemChatUI.openGenImageLightbox(src, { assetKey, label: '图片' });
      } catch (err) {
        // 灯箱内部异常不能静默：否则表现为「点了没反应」，无从排查
        console.error('[Online Chat] 灯箱打开失败：', err);
        toast('无法查看大图', (err && err.message) || '影像查看器异常');
      }
      return;
    }
    // 助手模块未加载时才走到这里：window.open 对 blob: 在 WebView 里无效，
    // 所以不做无意义的跳转，直接给出可见反馈。
    toast('无法查看大图', '影像查看组件尚未就绪，请稍后重试');
  }

  /* ================= 语音播放 =================
     TTS 合成尚未接入,此处只做播放态的视觉推进：
     波形按估算时长逐格点亮，走完复位。 */

  // HUD 菜单动作图标 (100% 纯 SVG)
  const HUD_ICONS = {
    copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
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

  /* ================= 多选批量操作模式 (Tactical Batch Mode) ================= */

  /**
   * 给一行装上多选能力：复选框 + 行点击切换选中。
   * 消息气泡与两类胶囊共用这一份，避免各写一遍导致口径漂移。
   * @param {HTMLElement} row 目标行
   */
  function attachRowBatchSelection(row) {
    if (!row) return;

    const checkbox = document.createElement('div');
    checkbox.className = 'chat-batch-checkbox';
    checkbox.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    row.appendChild(checkbox);

    row.addEventListener('click', (e) => {
      if (!isBatchMode) return;
      e.stopPropagation();
      toggleRowSelection(row);
    });
  }

  /** 刷新顶栏计数与删除键、截图键可用态 */
  function updateBatchCount() {
    const count = selectedRows.size;
    if (headerTitle) headerTitle.textContent = `已选中 ${count} 项`;
    if (batchDeleteCount) batchDeleteCount.textContent = `PURGE (${count})`;
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

  /**
   * 进入多选态。顶栏换成「取消 / 已选中 N 项 / 全选」，底部升起批量操作坞。
   * @param {HTMLElement} [initialRow] 由某行长按进入时，默认把该行勾上
   */
  function enterBatchMode(initialRow) {
    if (!chatPage) return;
    isBatchMode = true;
    selectedRows.clear();

    chatPage.classList.add('is-batch-mode');

    // 顶栏切换
    if (backBtn) backBtn.hidden = true;
    if (batchCancelBtn) batchCancelBtn.hidden = false;
    if (menuBtn) menuBtn.hidden = true;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = false;
    if (headerStatusEl) headerStatusEl.hidden = true;

    // 底栏切换
    if (batchDock) batchDock.hidden = false;

    if (initialRow) toggleRowSelection(initialRow);
    else updateBatchCount();
  }

  /** 退出多选态并清空所有勾选，顶栏与底栏复位 */
  function exitBatchMode() {
    if (!chatPage) return;
    isBatchMode = false;

    selectedRows.forEach((row) => {
      if (row) row.classList.remove('is-selected');
    });
    selectedRows.clear();

    chatPage.classList.remove('is-batch-mode');

    // 顶栏复位：标题交回身份同步，避免残留「已选中 N 项」
    if (backBtn) backBtn.hidden = false;
    if (batchCancelBtn) batchCancelBtn.hidden = true;
    if (menuBtn) menuBtn.hidden = false;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = true;
    syncHeaderIdentity();
    if (headerStatusEl) headerStatusEl.hidden = false;

    if (batchDock) batchDock.hidden = true;
  }

  // 顶栏：退出多选
  if (batchCancelBtn) {
    batchCancelBtn.addEventListener('click', exitBatchMode);
  }

  // 顶栏：全选 / 反全选
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

  // 批量删除：先落库抹除，再淡出 DOM，最后同步会话摘要
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

      const rowsToDelete = Array.from(selectedRows).filter(Boolean);
      // 文件翻阅胶囊不落库、没有 recordId，这一步会自动把它跳过，只走 DOM 移除
      const recordIds = rowsToDelete.map((row) => row.dataset.recordId).filter(Boolean);

      if (recordIds.length && window.OnlineChatStore) {
        try {
          await OnlineChatStore.removeMessages(recordIds);
        } catch (err) {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'PURGE // FAILED', message: '批量记录删除失败，未改动当前会话。', type: 'warning' });
          }
          return;
        }
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
      // 否则列表里那条预览还停在已被删掉的消息上。
      if (window.OnlineChatStore) {
        try {
          const remaining = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
          const lastRec = remaining.length ? remaining[remaining.length - 1] : null;
          await OnlineChatStore.syncSession(currentAccountId, currentContactId, lastRec, { clearUnread: true });
        } catch (_) { /* 摘要同步失败不影响已完成的删除 */ }
      }

      exitBatchMode();
      updateJumpDeckVisibility();
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

      const sceneName = trimStr(currentPerson && currentPerson.name) || '私聊会话';
      batchExportBtn.style.pointerEvents = 'none';
      batchExportBtn.style.opacity = '0.5';

      try {
        const res = await ChatShot.capture({
          rows,
          scene: { sceneName, sceneTag: 'ONLINE // 私聊存档' },
          fileLabel: `私聊存档_${sceneName}`
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
      if (window.RetroToast) {
        RetroToast.show({ tag: 'BATCH // QUOTE', message: '合并引用为预留机能', type: 'info' });
      }
    });
  }

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
      if (isBatchMode) return;
      if (e.touches && e.touches.length > 1) return;
      const point = e.touches ? e.touches[0] : e;
      startX = point.clientX;
      startY = point.clientY;

      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        openContextHud(bubble, role, text, row, { x: startX, y: startY });
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

    bubble.addEventListener('touchstart', startPress, { passive: true });
    bubble.addEventListener('touchend', cancelPress);
    bubble.addEventListener('touchcancel', cancelPress);
    bubble.addEventListener('touchmove', movePress, { passive: true });

    bubble.addEventListener('mousedown', startPress);
    bubble.addEventListener('mouseup', cancelPress);
    bubble.addEventListener('mouseleave', cancelPress);
  }

  // 弹出战术 HUD 悬浮舱（智能吸附于手指长按落点与当前可视视口）
  function openContextHud(bubble, role, text, row, touchPos) {
    closeActiveHud();

    // 震动触觉反馈（若设备支持）
    if (navigator.vibrate) {
      try { navigator.vibrate(25); } catch (_) {}
    }

    bubble.classList.add('is-locked');
    activeLockedBubble = bubble;

    const isEnvoy = role === 'envoy';
    
    // 判断是否允许重写：必须是对方消息，且从该行到最后都不能有执行员（envoy）消息，且当前不在请求中
    let canRewrite = false;
    if (!isEnvoy && messagesWrap && !getRequestState(currentAccountId, currentContactId).requesting) {
      const allRows = Array.from(messagesWrap.querySelectorAll('.chat-msg-row'));
      const currentIndex = allRows.indexOf(row);
      if (currentIndex >= 0) {
        const rowsAfter = allRows.slice(currentIndex);
        const hasEnvoyAfter = rowsAfter.some(r => r.classList.contains('user'));
        canRewrite = !hasEnvoyAfter;
      }
    }

    // 菜单配置矩阵
    const menuItems = isEnvoy
      ? [
          { key: 'edit', zh: '编辑', en: 'EDIT', icon: HUD_ICONS.edit },
          { key: 'quote', zh: '引用', en: 'QUOTE', icon: HUD_ICONS.quote },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'recall', zh: '撤回', en: 'RECALL', icon: HUD_ICONS.recall },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ]
      : [
          { key: 'copy', zh: '复制', en: 'COPY', icon: HUD_ICONS.copy },
          { key: 'edit', zh: '编辑', en: 'EDIT', icon: HUD_ICONS.edit },
          { key: 'quote', zh: '引用', en: 'QUOTE', icon: HUD_ICONS.quote },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewrite', zh: '重写', en: 'REWRITE', icon: HUD_ICONS.rewrite, disabled: !canRewrite },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ];

    const hud = document.createElement('div');
    hud.className = 'chat-context-hud';

    const grid = document.createElement('div');
    grid.className = `chat-hud-grid ${isEnvoy ? 'cols-3' : 'cols-4'}`;

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
    const pageRect = chatPage.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();
    const hudWidth = isEnvoy ? 202 : 260;
    const hudHeight = 134;

    // 水平位置：优先以手指点击 X 为中心，若未获取则以气泡中心为准
    const anchorX = (touchPos && touchPos.x) ? touchPos.x : (bubbleRect.left + bubbleRect.width / 2);
    let left = anchorX - (hudWidth / 2) - pageRect.left;
    // 左右边界防贴边安全留白 (12px)
    left = Math.max(12, Math.min(left, pageRect.width - hudWidth - 12));

    // 垂直位置：基于手指长按 Y 坐标就近悬浮（留出 20px 呼吸间距与手指避让）
    const anchorY = (touchPos && touchPos.y) ? touchPos.y : bubbleRect.top;
    let top = anchorY - pageRect.top - hudHeight - 20;

    // 若上方空间不足（靠近顶栏 < 68px），则自动翻转到手指下方 (+28px)
    if (top < 68) {
      top = anchorY - pageRect.top + 28;
    }

    // 底部防撞（输入框区域上方安全留白）
    const footerEl = chatPage.querySelector('.online-chat-footer');
    const maxTop = footerEl ? (footerEl.getBoundingClientRect().top - pageRect.top - hudHeight - 10) : (pageRect.height - hudHeight - 80);
    top = Math.min(top, maxTop);
    top = Math.max(68, top);

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  /* ================= HUD 动作实现 ================= */

  /** 重写全场末轮回复（将最后连续的对方气泡全部清除并重新请求） */
  async function rewriteLatestAssistantBatch() {
    if (!messagesWrap || getRequestState(currentAccountId, currentContactId).requesting) return;

    // 找到末尾所有连续的对方气泡
    const allRows = Array.from(messagesWrap.querySelectorAll('.chat-msg-row'));
    if (!allRows.length) return;

    // 从最后一条往前找连续的 assistant 气泡
    const batchRows = [];
    for (let i = allRows.length - 1; i >= 0; i--) {
      const r = allRows[i];
      if (r.classList.contains('assistant')) {
        batchRows.unshift(r);
      } else {
        // 遇到 user 或其他即停止，这一批就是最新一轮回复
        break;
      }
    }

    if (!batchRows.length) {
      if (window.RetroToast) RetroToast.show({ tag: 'REWRITE // FAILED', message: '未找到可重写的最新回复', type: 'warning' });
      return;
    }

    const deleteIds = batchRows.map(r => r.dataset.recordId).filter(Boolean);

    // 从存储中移除这批消息
    try {
      if (deleteIds.length && window.OnlineChatStore) {
        await OnlineChatStore.removeMessages(deleteIds);
      }
    } catch (err) {
      if (window.RetroToast) RetroToast.show({ tag: 'REWRITE // FAILED', message: '清理历史回复失败', type: 'warning' });
      return;
    }

    // 从界面上移除
    batchRows.forEach(r => r.remove());

    // 重新向模型请求回复
    await requestReply();
  }

  /** 回溯会话：回溯到目标行，保留目标行，删除其之后的所有消息，最近一条执行员消息退回输入框 */
  async function rewindFromRow(targetRow) {
    if (!targetRow || !messagesWrap) return;
    const rows = Array.from(messagesWrap.querySelectorAll(SELECTABLE_ROW_SELECTOR));
    const targetIndex = rows.indexOf(targetRow);
    if (targetIndex < 0) return;

    const isUserRow = targetRow.classList.contains('user');

    // 如果选中的是用户/执行员自己的气泡：回溯范围包含当前行本身（把当前行及之后的所有消息都删除并回填当前文本）
    // 如果选中的是对方气泡：保留当前行，删除当前行之后的所有消息
    const rowsToDelete = isUserRow ? rows.slice(targetIndex) : rows.slice(targetIndex + 1);

    if (!rowsToDelete.length) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // NO OPERATION', message: '当前消息已经位于会话末端。', type: 'info' });
      }
      return;
    }

    // 确定要退回输入框的内容：
    // 执行员气泡自身回溯时，退回当前这行；对方气泡回溯时，退回后续中最后一条执行员消息
    let restoredText = '';
    if (isUserRow) {
      const bubble = targetRow.querySelector('.chat-bubble');
      restoredText = (bubble && typeof bubble.dataset.rawText === 'string')
        ? bubble.dataset.rawText
        : (bubble ? bubble.textContent : '');
    } else {
      const latestUserRow = rowsToDelete.slice().reverse().find(item => item.classList.contains('user'));
      const latestUserBubble = latestUserRow ? latestUserRow.querySelector('.chat-bubble') : null;
      restoredText = latestUserRow
        ? (latestUserBubble && typeof latestUserBubble.dataset.rawText === 'string' ? latestUserBubble.dataset.rawText : '')
        : '';
    }

    const recordIds = rowsToDelete.map(item => item.dataset.recordId).filter(Boolean);
    const rememberKey = 'retroflow_online_chat_rewind_confirmed_v1';
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
      if (recordIds.length && window.OnlineChatStore) {
        await OnlineChatStore.removeMessages(recordIds);
      }
    } catch (err) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // FAILED', message: '后续记录删除失败，当前会话未改动。', type: 'warning' });
      }
      return;
    }

    rowsToDelete.forEach(item => item.remove());

    // 同步会话最新消息元数据
    try {
      if (window.OnlineChatStore) {
        const remaining = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
        const lastRec = remaining.length ? remaining[remaining.length - 1] : null;
        await OnlineChatStore.syncSession(currentAccountId, currentContactId, lastRec, { clearUnread: true });
      }
    } catch (_) {}

    if (textarea && restoredText) {
      textarea.value = restoredText;
      clearQuoteDraft();
      autoResizeTextarea();
      textarea.focus();
    }

    if (window.RetroToast) {
      RetroToast.show({ tag: 'REWIND // SUCCESS', message: `已回溯，清除了后续 ${rowsToDelete.length} 条消息`, type: 'info' });
    }
  }

  // 处理 HUD 菜单动作
  async function handleHudAction(actionKey, actionZh, bubble, text, row, role) {
    console.log(`[Online Chat HUD] 触发动作: ${actionKey} - ${actionZh}`);

    switch (actionKey) {
      case 'copy':
        {
          const cleanText = String(text || '').trim();
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

      case 'edit':
        if (window.TextEditorModal && typeof TextEditorModal.open === 'function') {
          // 编辑时取气泡当前显示的文本
          const contentEl = bubble.querySelector('.chat-bubble-content');
          const currentText = contentEl ? contentEl.textContent : text;
          
          TextEditorModal.open({
            title: '编辑消息',
            tag: 'MESSAGE // 修改记忆',
            value: currentText,
            maxLength: 8000
          }).then(async (updated) => {
            if (updated !== null && updated !== undefined && updated.trim()) {
              const newText = updated.trim();

              // 先查出原记录，用 putMessage 覆盖持久化
              if (row && row.dataset.recordId && window.OnlineChatStore) {
                try {
                  const records = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
                  const original = records.find(r => r && r.id === row.dataset.recordId);
                  if (!original) throw new Error('找不到待编辑的消息记录');
                  
                  const saved = await OnlineChatStore.putMessage({
                    ...original,
                    recordId: original.id,
                    content: newText
                  });
                  if (!saved) throw new Error('消息保存失败');

                  // 如果是最后一条消息，同步更新列表摘要
                  if (records[records.length - 1]?.id === original.id) {
                    await OnlineChatStore.syncSession(currentAccountId, currentContactId, saved, {});
                  }
                } catch (err) {
                  if (window.RetroToast) {
                    RetroToast.show({ tag: 'MEMORY // WRITE FAILED', message: '消息修改未能写入上下文记录。', type: 'warning' });
                  }
                  return;
                }
              }

              // 更新画面
              if (bubble) bubble.dataset.rawText = newText;
              if (contentEl) contentEl.textContent = newText;
            }
          });
        }
        break;

      case 'rewrite':
        // 重写末轮回复：仅允许对方侧消息，且之后没有执行员发言
        if (role !== 'envoy' && !getRequestState(currentAccountId, currentContactId).requesting) {
          await rewriteLatestAssistantBatch();
        }
        break;

      case 'quote': {
        const quoteSender = (row && String(row.dataset.senderName || '').trim())
          || (role === 'envoy' ? getCurrentUserName() : (trimStr(currentPerson && currentPerson.name) || '对方'));
        // 图片行的 bubble 是 figure，没有 rawText，兜底会取到识图结果或生图 prompt。
        // 那两者都是给模型看的，塞进引用卡就是一段莫名其妙的英文，
        // 所以图片一律显示统一标签，真正指向哪张图靠 recordId。
        const isImageRow = !!(row && row.dataset.assetKey);
        const rawText = isImageRow
          ? QUOTE_IMAGE_LABEL
          : ((bubble && typeof bubble.dataset.rawText === 'string')
            ? bubble.dataset.rawText
            : text);
        setCurrentQuote({
          role,
          senderName: quoteSender,
          text: rawText,
          recordId: (row && row.dataset.recordId) || '',
          imageAssetKey: isImageRow ? String(row.dataset.assetKey || '') : ''
        });
        if (textarea) {
          textarea.focus();
        }
        break;
      }

      case 'select':
        enterBatchMode(row);
        break;

      case 'recall':
        if (row && role === 'envoy') {
          const recordId = row.dataset.recordId;
          const senderName = getCurrentUserName();
          const rawText = (bubble && typeof bubble.dataset.rawText === 'string')
            ? bubble.dataset.rawText
            : text;

          try {
            let originalCreatedAt = Date.now();
            if (recordId && window.OnlineChatStore) {
              const records = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
              const original = records.find(r => r && r.id === recordId);
              if (original && original.createdAt) {
                originalCreatedAt = original.createdAt;
              }
              // 删掉原消息
              await OnlineChatStore.removeMessages([recordId]);
            }

            // 持久化保存一条系统撤回通知
            const noticeText = `「${senderName}」撤回了一条消息`;
            let noticeRecord = null;
            if (window.OnlineChatStore) {
              noticeRecord = await OnlineChatStore.putMessage({
                accountId: currentAccountId,
                contactId: currentContactId,
                role: 'system',
                type: 'notice',
                content: noticeText,
                createdAt: originalCreatedAt
              });
            }

            // 同步会话摘要（若通知成为最后一条，会话摘要同步为通知文案）
            if (window.OnlineChatStore) {
              const remaining = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
              const lastRec = remaining.length ? remaining[remaining.length - 1] : null;
              await OnlineChatStore.syncSession(currentAccountId, currentContactId, lastRec, { clearUnread: true });
            }

            const noticeRow = appendSystemNotice(noticeText, noticeRecord ? noticeRecord.id : null, originalCreatedAt);
            if (noticeRow) row.replaceWith(noticeRow);
            else row.remove();

            if (textarea) {
              textarea.value = rawText;
              clearQuoteDraft();
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
          if (recordId && window.OnlineChatStore) {
            try {
              await OnlineChatStore.removeMessages([recordId]);
              // 同步会话摘要
              const remaining = await OnlineChatStore.listMessages(currentAccountId, currentContactId);
              const lastRec = remaining.length ? remaining[remaining.length - 1] : null;
              await OnlineChatStore.syncSession(currentAccountId, currentContactId, lastRec, { clearUnread: true });
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

  /**
   * 渲染追加一条系统静态通知胶囊（如撤回提示）
   * @param {string} messageText 提示文字
   * @param {string} [recordId] 记录 ID
   * @param {number} [createdAt] 创建时间戳
   */
  function appendSystemNotice(messageText, recordId, createdAt) {
    if (!messagesWrap || !messageText) return null;

    const row = document.createElement('div');
    row.className = 'chat-status-pill-row';
    row.dataset.systemNotice = 'true';
    row.dataset.contextRole = 'system';
    row.dataset.rawText = String(messageText);
    if (createdAt) row.dataset.createdAt = String(createdAt);
    if (recordId) row.dataset.recordId = recordId;

    // 多选能力：撤回提示同样落库进上下文，需可被一并抹除
    attachRowBatchSelection(row);

    const pill = document.createElement('div');
    pill.className = 'chat-status-pill';

    pill.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <!-- 纯 SVG 撤回小微标，对齐系统助手 -->
        <path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>
      </svg>
      <span class="chat-status-pill-text"></span>
    `;
    const noticeText = pill.querySelector('.chat-status-pill-text');
    if (noticeText) noticeText.textContent = messageText;

    row.appendChild(pill);
    mountChatNode(row);

    followBottomIfNear();
    return row;
  }

  /* ================= 语音播放（真实 TTS 合成） =================
     与助手侧同源：共用 RetroflowTTSCache（按文本 + 声学配置指纹缓存，
     同一条语音重复点击不重复计费）与 RetroflowAPI.synthesizeSpeech。

     与助手侧的差异：
       1. 助手侧是「把任意一条文字回复读出来」，入口在长按 HUD；
          私聊这边语音条本身就是一条消息，点它才播，文本消息没有播放入口。
       2. 音色取对话角色档案里的 voiceId（每个角色有自己的嗓子），
          助手侧取的是助手档案的 voiceId。
       3. 只有对方（char）的语音条可播，本人侧不接。

     波形推进改为跟随真实播放进度（timeupdate + duration），不再用
     估算时长跑定时器——估算值和真实音频长度不一致时，波形会提前跑完
     或者音频播完波形还在爬。 */

  /** 私聊 TTS 单例：同一时间只允许一条语音占用播放器 */
  let voiceTtsAudio = null;
  /** 请求代号：合成期间用户切走或点了别的条子，旧结果不得抢播 */
  let voiceTtsRequestId = 0;

  function getVoiceTtsAudio() {
    if (!voiceTtsAudio) {
      // 必须用 HTMLMediaElement：iOS 静音拨键会掐掉 Web Audio 输出，
      // 媒体元素不受影响。与助手侧、API 试听保持一致。
      voiceTtsAudio = new Audio();
      voiceTtsAudio.preload = 'auto';
      voiceTtsAudio.addEventListener('ended', () => {
        if (activeVoiceStrip) resetVoiceStrip(activeVoiceStrip);
        activeVoiceStrip = null;
      });
      voiceTtsAudio.addEventListener('error', () => {
        if (activeVoiceStrip) resetVoiceStrip(activeVoiceStrip);
        activeVoiceStrip = null;
      });
      // 波形跟随真实播放进度，而不是估算时长
      voiceTtsAudio.addEventListener('timeupdate', () => {
        if (!activeVoiceStrip) return;
        const d = voiceTtsAudio.duration;
        if (!isFinite(d) || d <= 0) return;
        paintWaveProgress(activeVoiceStrip, voiceTtsAudio.currentTime / d);
      });
    }
    return voiceTtsAudio;
  }

  /** 按 0~1 的播放进度点亮波形竖条 */
  function paintWaveProgress(strip, ratio) {
    const bars = strip.querySelectorAll('.chat-voice-wave rect');
    if (!bars.length) return;
    const lit = Math.round(Math.max(0, Math.min(1, ratio)) * bars.length);
    for (let i = 0; i < bars.length; i++) {
      bars[i].classList.toggle('is-lit', i < lit);
    }
  }

  /** 停掉播放器并复位状态。切页、切条、播完、出错都走这里 */
  function stopVoiceTts() {
    voiceTtsRequestId += 1;
    if (voiceTtsAudio) {
      try {
        voiceTtsAudio.pause();
        voiceTtsAudio.currentTime = 0;
        voiceTtsAudio.removeAttribute('src');
        voiceTtsAudio.load();
      } catch (_) { /* 播放器已被回收，忽略 */ }
    }
  }

  function resetVoiceStrip(strip) {
    if (!strip) return;
    strip.classList.remove('is-playing', 'is-loading');
    const btn = strip.querySelector('.chat-voice-play-btn');
    if (btn) btn.innerHTML = VOICE_PLAY_SVG;
    strip.querySelectorAll('.chat-voice-wave rect').forEach((r) => r.classList.remove('is-lit'));
  }

  /** 读 TTS 插槽配置。TTS 是独立的 MiniMax 插槽，不能拿主模型的 OpenAI 配置顶替 */
  function getVoiceTtsSlot() {
    try {
      if (window.RetroflowApiUI && typeof RetroflowApiUI.getSlot === 'function') {
        return RetroflowApiUI.getSlot('tts') || null;
      }
    } catch (_) { /* 配置模块未就绪 */ }
    return null;
  }

  function bindVoiceStrip(strip, text) {
    if (!strip) return;

    const toggle = async () => {
      // 点当前正在合成或播放的条子：停下，不重新合成也不重复计费
      const isBusy = strip.classList.contains('is-playing') || strip.classList.contains('is-loading');
      if (isBusy) {
        stopVoiceTts();
        resetVoiceStrip(strip);
        activeVoiceStrip = null;
        return;
      }

      // 换条子：先把上一条彻底停掉
      if (activeVoiceStrip && activeVoiceStrip !== strip) {
        stopVoiceTts();
        resetVoiceStrip(activeVoiceStrip);
      }

      const cleanText = trimStr(text);
      if (!cleanText) {
        toast('这条语音没有可朗读的内容');
        return;
      }

      const slot = getVoiceTtsSlot();
      if (!slot || !slot.baseUrl || !slot.apiKey) {
        toast('尚未配置 TTS 语音合成节点', '请前往 API 引擎配置 TTS 插槽。');
        return;
      }

      // 角色专属音色优先于插槽默认音色：每个角色有自己的嗓子
      const config = {
        ...slot,
        voiceId: trimStr(currentPerson && currentPerson.voiceId) || trimStr(slot.voiceId),
        speed: slot.speed,
        pitch: slot.pitch
      };

      stopVoiceTts();
      const requestId = voiceTtsRequestId;
      activeVoiceStrip = strip;
      strip.classList.add('is-loading');
      const btn = strip.querySelector('.chat-voice-play-btn');
      if (btn) btn.innerHTML = VOICE_PAUSE_SVG;

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
          () => RetroflowAPI.synthesizeSpeech(config, { text: cleanText })
        );

        // 合成期间用户已停止、点了别条或退出了会话
        if (requestId !== voiceTtsRequestId) return;

        const audio = getVoiceTtsAudio();
        audio.pause();
        audio.src = result.entry.url;
        strip.classList.remove('is-loading');
        strip.classList.add('is-playing');
        await audio.play();
      } catch (err) {
        if (requestId !== voiceTtsRequestId) return;
        resetVoiceStrip(strip);
        activeVoiceStrip = null;
        toast('语音播放失败', err && err.message ? err.message : '合成或播放未成功');
      }
    };

    strip.addEventListener('click', toggle);
    strip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    });
  }

  /* ================= 滚动 ================= */

  /**
   * 只有用户本来就贴着底部时才跟随滚动。
   *
   * 阈值判断的意义：用户翻旧消息时不该被新气泡抢走滚动位置。
   * 逐条上屏必须跟随，否则新气泡落在视口下方被悬浮输入台挡住
   * ——实测数据里 scrollTop 停在 2538 不动，而可滚上限从 2538 涨到 2782，
   * 差出来的 244px 就是被挡住的那部分。
   */
  function followBottomIfNear() {
    if (!bodyEl) return;
    // 历史回放期间不滚：铺完由 settleChatBottom 一次性硬定位
    if (isRestoringHistory) return;
    const distance = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight;
    if (distance > STICK_THRESHOLD_PX) return;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  /**
   * 输入台基线高度，与 CSS 里 .online-chat-view .system-chat-body 的
   * padding-bottom 基线保持一致（不含 safe-area）。
   *
   * 两处必须同步：CSS 负责静态让位，这里只负责判断「实际比基线高了多少」。
   */
  const FOOTER_BASELINE_PX = 168;

  /**
   * 输入台增量让位。
   *
   * 只补差值，不再接管整个 padding：基线让位由 CSS 静态给出，
   * 进场时即使一次都不调用也不会压住消息。这里处理的是输入框换行增高、
   * 引用条/附件条插入这类运行时真实变高的场景。
   *
   * 进场期直接返回：那时页面还在 translateX 过渡中，
   * getBoundingClientRect 拿到的高度偏小，写进去反而制造错误的让位。
   */
  function syncChatFooterSpace() {
    if (!bodyEl || !footerEl) return;
    if (isRestoringHistory) return;
    if (!chatPage || !chatPage.classList.contains('active')) return;

    const footerHeight = Math.ceil(footerEl.getBoundingClientRect().height || 0);
    // 过渡中测出的高度不可信（远小于基线），直接忽略
    if (footerHeight <= 0) return;

    const bottomSafe = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--online-chat-bottom-safe')) || 0;
    const extra = Math.max(0, footerHeight - bottomSafe - FOOTER_BASELINE_PX);
    bodyEl.style.setProperty('--online-chat-extra-space', `${extra}px`);
  }

  /**
   * 收束到底部。
   *
   * @param {boolean} [instant] 首次进会话用。当前帧内同步定位完，
   *   不留任何异步窗口——延迟补偿那次会落在页面进场动画中途，用户看得见，
   *   就是「进去之后又自己滚了一下」的来源。
   *
   * 缺省（非 instant）用于键盘弹起、resize 等页面已稳定后的布局二次变化。
   * 那时补偿滚动是必要的，否则输入框变高会把最新消息压住；
   * 但同样不用 setTimeout —— rAF 内读到的布局已经重算完，再拖一个宏任务
   * 只会把滚动推到用户看得见的时间点。
   */
  function settleChatBottom(instant) {
    if (!bodyEl) return;

    // 基线让位由 CSS 静态给出，这里只需要把滚动位置钉到底。
    // 两次赋值之间夹一次增量同步：万一输入台确实比基线高，
    // padding 变化后 scrollHeight 会重算，第二次赋值才是终点。
    syncChatFooterSpace();
    bodyEl.scrollTop = bodyEl.scrollHeight;

    if (instant) {
      syncChatFooterSpace();
      bodyEl.scrollTop = bodyEl.scrollHeight;
      return;
    }

    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (!bodyEl) return;
        syncChatFooterSpace();
        bodyEl.scrollTop = bodyEl.scrollHeight;
      });
    }
  }

  function scrollToBottom(smooth) {
    if (!bodyEl) return;
    if (smooth) {
      try {
        bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
        return;
      } catch (_) {
        // 不支持就退回同步赋值
      }
    }
    // 先同步钉一次，再在下一帧补一次。
    // 同步那次保证不留异步窗口；rAF 那次是因为刚插入的节点布局未必已经重算完，
    // 此刻读到的 scrollHeight 可能偏小，钉出来的位置就偏上。
    // 隔壁 ai-virtual-phone 的滚动同样走 useLayoutEffect / rAF，都在绘制前。
    bodyEl.scrollTop = bodyEl.scrollHeight;
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
      });
    }
  }

  function updateJumpDeckVisibility() {
    if (!jumpDeck || !bodyEl) return;
    const scrollTop = bodyEl.scrollTop;
    const scrollHeight = bodyEl.scrollHeight;
    const clientHeight = bodyEl.clientHeight;
    const maxScroll = scrollHeight - clientHeight;

    // 内容不足一屏或不可滚动时隐藏
    if (maxScroll <= 30) {
      jumpDeck.classList.remove('is-visible');
      return;
    }

    const isAtTop = scrollTop <= 35;
    const isAtBottom = (maxScroll - scrollTop) <= 35;

    // 只有处于中间滚动态时显示，顶部和底部都隐藏
    jumpDeck.classList.toggle('is-visible', !isAtTop && !isAtBottom);
  }

  /* ================= 输入台 ================= */

  function autoResizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const next = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = `${next}px`;
    syncChatFooterSpace();
  }

  function toggleDockPanel(forceState) {
    if (!dockPanel || !plusBtn) return;
    const willOpen = typeof forceState === 'boolean'
      ? forceState
      : !dockPanel.classList.contains('is-open');

    if (willOpen) {
      dockPanel.hidden = false;
      void dockPanel.offsetWidth;
      dockPanel.classList.add('is-open');
      plusBtn.classList.add('is-active');
    } else {
      dockPanel.classList.remove('is-open');
      plusBtn.classList.remove('is-active');
      setTimeout(() => {
        if (!dockPanel.classList.contains('is-open')) dockPanel.hidden = true;
      }, 300);
    }
  }

  /* ================= 引用草稿管理 ================= */

  /** 按会话隔离的引用草稿，key 为 sessionKey(accountId, contactId) */
  const quoteDrafts = new Map();

  function getCurrentQuote() {
    if (!currentAccountId || !currentContactId) return null;
    return quoteDrafts.get(sessionKey(currentAccountId, currentContactId)) || null;
  }

  function setCurrentQuote(payload) {
    if (!currentAccountId || !currentContactId) return;
    const key = sessionKey(currentAccountId, currentContactId);
    if (!payload || !payload.text) {
      quoteDrafts.delete(key);
      clearQuoteDraftUI();
      return;
    }
    quoteDrafts.set(key, payload);
    renderQuoteDraftUI(payload);
  }

  function renderQuoteDraftUI(payload) {
    if (!quoteDraftBar) return;
    if (quoteDraftTag) {
      quoteDraftTag.textContent = payload.senderName || (payload.role === 'char' ? (trimStr(currentPerson && currentPerson.name) || '对方') : 'OPERATIVE');
    }
    if (quoteDraftSnippet) {
      quoteDraftSnippet.textContent = String(payload.text || '').replace(/\s+/g, ' ');
    }
    // 引用图片时在文字前挂一张缩略图：只写「[图片]」看不出是哪张，
    // 带上原图才能一眼确认引对了。资产取不到（已释放）就只留文字。
    renderQuoteThumb(quoteDraftBar, 'chat-quote-draft-thumb', payload, (thumb) => {
      const left = quoteDraftBar.querySelector('.chat-quote-draft-left');
      const anchor = quoteDraftBar.querySelector('.chat-quote-draft-snippet');
      if (left && anchor) left.insertBefore(thumb, anchor);
    });
    quoteDraftBar.hidden = false;
    // 草稿条把底栏撑高了，让位高度必须跟着重算。
    // 漏掉这一步的话，最后一条气泡会被压在草稿条底下，看起来像是页面卡住。
    syncChatFooterSpace();
  }

  /**
   * 给引用卡挂图片缩略图。
   *
   * 资产读取是异步的，期间用户可能已经换了引用或关掉了草稿条，
   * 所以回填前要确认容器还在文档里、且引用载荷没被换掉（用 assetKey 比对）。
   *
   * @param {HTMLElement} container 引用卡容器
   * @param {string} className 缩略图 class
   * @param {Object} payload 引用载荷
   * @param {Function} mount 挂载回调，收到 img 元素
   */
  function renderQuoteThumb(container, className, payload, mount) {
    if (!container) return;
    // 先清掉上一次的缩略图，避免连续引用不同图时叠加
    const stale = container.querySelector('.' + className);
    if (stale) stale.remove();

    const assetKey = trimStr(payload && payload.imageAssetKey);
    if (!assetKey) return;
    if (!window.Storage || typeof Storage.getAssetSrc !== 'function') return;

    container.dataset.quoteThumbKey = assetKey;
    Storage.getAssetSrc(assetKey).then((src) => {
      if (!src) return;
      if (!container.isConnected) return;
      // 异步期间引用被换掉了：这张缩略图已经不属于当前引用
      if (container.dataset.quoteThumbKey !== assetKey) return;
      if (container.querySelector('.' + className)) return;
      const thumb = document.createElement('img');
      thumb.className = className;
      thumb.alt = '引用的图片';
      thumb.src = src;
      mount(thumb);
    }).catch(() => {});
  }

  function clearQuoteDraftUI() {
    if (quoteDraftBar) {
      quoteDraftBar.hidden = true;
      // 缩略图与它的归属标记一起清掉：否则下次引用一条纯文字消息时，
      // 上一次那张图还挂在草稿条上。
      const thumb = quoteDraftBar.querySelector('.chat-quote-draft-thumb');
      if (thumb) thumb.remove();
      delete quoteDraftBar.dataset.quoteThumbKey;
    }
    if (quoteDraftSnippet) quoteDraftSnippet.textContent = '';
    // 收起草稿条后底栏变矮，同样要把多让出来的空间还给消息区
    syncChatFooterSpace();
  }

  function clearQuoteDraft() {
    setCurrentQuote(null);
  }

  function syncQuoteDraftUI() {
    const payload = getCurrentQuote();
    if (payload) {
      renderQuoteDraftUI(payload);
    } else {
      clearQuoteDraftUI();
    }
  }

  /* ================= 语音模式 ================= */

  /**
   * 切换语音模式。
   *
   * 与图片/文件互斥：现实里语音条不会附带图片或文档，
   * 所以进模式时清掉待发载荷，并把这两个入口在抽屉里禁掉。
   * 引用不互斥——引用一条消息再用语音回它是自然行为，予以保留。
   *
   * @param {boolean} [force] 显式指定开关，缺省为取反
   */
  function setVoiceMode(force) {
    const next = force === undefined ? !isVoiceMode : !!force;
    if (next === isVoiceMode) return;
    isVoiceMode = next;

    if (voiceModeBar) voiceModeBar.hidden = !isVoiceMode;
    const shell = textarea && textarea.closest('.chat-dock-input-wrap');
    if (shell) shell.classList.toggle('is-voice-mode', isVoiceMode);
    const dock = chatPage ? chatPage.querySelector('.floating-chat-dock') : null;
    if (dock) dock.classList.toggle('is-voice-mode', isVoiceMode);

    if (textarea) {
      textarea.placeholder = isVoiceMode
        ? '说点什么，发出去是一条语音'
        : '发送后，点击RELAY等待回复';
    }

    if (isVoiceMode) {
      // 语音条不带附件：进模式即卸掉已挂的图片与文件
      if (pendingImages.length) clearPendingImage();
      if (pendingFiles.length) {
        pendingFiles = [];
        renderPendingFiles();
      }
    }
    syncVoiceModeAffordances();
    autoResizeTextarea();
  }

  /** 同步抽屉里图片/文件入口的可用性，与语音模式互斥 */
  function syncVoiceModeAffordances() {
    if (!dockPanel) return;
    ['image', 'file'].forEach((key) => {
      const item = dockPanel.querySelector(`[data-online-panel="${key}"]`);
      if (!item) return;
      item.disabled = isVoiceMode;
      item.classList.toggle('is-disabled', isVoiceMode);
    });
    const voiceItem = dockPanel.querySelector('[data-online-panel="voice"]');
    if (voiceItem) voiceItem.classList.toggle('is-active', isVoiceMode);
  }

  /* ================= 消息加载 ================= */

  /**
   * 从落库读取本会话全部消息并铺满消息流。
   *
   * 未读消息区别对待：已读的历史直接铺开（进会话不该等气泡一条条冒），
   * 未读的那几条逐条上浮——它们是用户第一次看到的新消息，
   * 好友申请后首次进会话看到的招呼就属于这种。
   */
  async function loadMessages(session) {
    if (!messagesWrap || !isSessionCurrent(session)) return;
    messagesWrap.innerHTML = '';
    // 会话级分页状态复位：切联系人 / 退出重进都从头来
    historyAllRecords = [];
    historyRenderedCount = 0;
    isLoadingMoreHistory = false;
    historyInsertAnchor = null;
    if (!window.OnlineChatStore || !session.contactId) {
      updateJumpDeckVisibility();
      return;
    }
const records = await OnlineChatStore.listMessages(session.accountId, session.contactId);
    if (!isSessionCurrent(session)) return;

    // 取未读条数
    // 取未读条数：末尾这么多条对方消息是没看过的
    let unread = 0;
    try {
      if (window.OnlineStore && typeof OnlineStore.findSession === 'function') {
        const session = OnlineStore.findSession(currentAccountId, currentContactId);
        unread = Math.max(0, Number(session && session.unread) || 0);
      }
    } catch (_) {
      unread = 0;
    }
    // 未读数不该超过总条数，异常数据兜底
    unread = Math.min(unread, records.length);

    const history = unread > 0 ? records.slice(0, records.length - unread) : records;
    const fresh = unread > 0 ? records.slice(records.length - unread) : [];

    // 已读历史段全量留档，分页从这里切片。首屏只渲染最新 HISTORY_PAGE_INIT 条，
    // 上滑时从 historyAllRecords 往前取更早批次前插。上下文构建不受此影响——
    // 它独立从 OnlineChatStore.listMessages 读全量。
    historyAllRecords = history;
    const initCount = Math.min(HISTORY_PAGE_INIT, history.length);
    historyRenderedCount = initCount;
    const initSlice = history.slice(history.length - initCount);

    // 已读历史整段回放期间禁滚：每条 append 都跟随滚动的话，
    // 等于把「滚到底」重复几十次，收尾还要靠延迟补偿，观感就是进来又滚一下。
    isRestoringHistory = true;
    try {
      // 首屏切片的第一条如果不是整段 history 的第一条，仍要在它上方补一枚
      // 当天胶囊——否则首屏顶部会缺日期标记，上滑加载后再补也会突兀。
      let prevSepDayTs = 0;
      for (const r of initSlice) {
        // 跨天日期胶囊：与上一条不同天就先插一枚。历史回放阶段
        // appendMessage 内的实时判断被 isRestoringHistory 抑制，这里统一插。
        if (window.ChatDaySep && r.createdAt) {
          if (ChatDaySep.isCrossDay(prevSepDayTs, r.createdAt) && messagesWrap) {
            messagesWrap.appendChild(ChatDaySep.buildPill(r.createdAt));
          }
          prevSepDayTs = r.createdAt;
        }
        if (r.role === 'system' || r.messageType === 'notice') {
          appendSystemNotice(r.content, r.id, r.createdAt);
          continue;
        }
        await appendMessage({
          role: r.role,
          type: r.messageType,
          content: r.content,
          quote: r.quote || null,
          createdAt: r.createdAt,
          isVerifyMsg: r.isVerifyMsg,
          fileRefs: r.fileRefs || null,
          imageRef: r.imageRef || null,
          messageGroupId: r.messageGroupId || null,
          recordId: r.id
        });
      }
    } finally {
      isRestoringHistory = false;
    }

    // 进来就算已读，红点先清掉，避免逐条上浮期间用户返回又看到红点
    if (!isSessionCurrent(session)) return;
    await OnlineChatStore.markRead(session.accountId, session.contactId);
    updateJumpDeckVisibility();

    // 历史铺完后一次性硬定位到底部，全程同步、无可见滚动过程。
    // 与助手页 restoreChatHistory 的收尾保持一致。
    settleChatBottom(true);

    if (fresh.length) {
      // 未读消息逐条上浮是有意的动效，这里不抑制滚动跟随
      await appendRecordsStaggered(fresh);
      updateJumpDeckVisibility();
    }
    if (isSessionCurrent(session)) settleChatBottom(fresh.length === 0);
  }

  /**
   * 上滑加载更早一批已读历史：从 historyAllRecords 往前取 HISTORY_PAGE_STEP 条，
   * 前插到容器顶部，并保持视口位置不跳。
   *
   * 保位用锚点 offsetTop 差值补偿，不用 scrollHeight 差——助手页验证过，
   * scrollHeight 差在图片渐进撑高时会算偏，锚点相对位移才可靠。
   */
  async function loadMoreHistory() {
    if (isLoadingMoreHistory) return;
    if (historyRenderedCount >= historyAllRecords.length) return;
    if (!messagesWrap || !bodyEl) return;
    isLoadingMoreHistory = true;

    // 记录本次会话身份，加载完要核对没被切走
    const tokenAtStart = activeSessionToken;
    const accountAtStart = currentAccountId;
    const contactAtStart = currentContactId;

    // 取更早一批：historyAllRecords 正序，已渲染的是尾部 historyRenderedCount 条，
    // 这次取它们前面的 STEP 条。
    const end = historyAllRecords.length - historyRenderedCount;
    const start = Math.max(0, end - HISTORY_PAGE_STEP);
    const batch = historyAllRecords.slice(start, end);
    if (!batch.length) {
      isLoadingMoreHistory = false;
      return;
    }

    // 前插锚点 = 当前最顶节点。保位基准也取它。
    const anchorNode = messagesWrap.firstElementChild;
    const beforeTop = anchorNode ? anchorNode.offsetTop : 0;
    const beforeScroll = bodyEl.scrollTop;

    isRestoringHistory = true;
    historyInsertAnchor = anchorNode;
    try {
      let prevSepDayTs = 0;
      for (const r of batch) {
        // 跨天胶囊：批次内部按正序判定，插到该条上方（走 mountChatNode → anchor）
        if (window.ChatDaySep && r.createdAt) {
          if (ChatDaySep.isCrossDay(prevSepDayTs, r.createdAt) && messagesWrap) {
            mountChatNode(ChatDaySep.buildPill(r.createdAt));
          }
          prevSepDayTs = r.createdAt;
        }
        if (r.role === 'system' || r.messageType === 'notice') {
          appendSystemNotice(r.content, r.id, r.createdAt);
          continue;
        }
        await appendMessage({
          role: r.role,
          type: r.messageType,
          content: r.content,
          quote: r.quote || null,
          createdAt: r.createdAt,
          isVerifyMsg: r.isVerifyMsg,
          fileRefs: r.fileRefs || null,
          imageRef: r.imageRef || null,
          messageGroupId: r.messageGroupId || null,
          recordId: r.id
        });
        // 会话被切走：立即停手，避免把旧会话的历史插进新会话
        if (activeSessionToken !== tokenAtStart
          || currentAccountId !== accountAtStart
          || currentContactId !== contactAtStart) {
          break;
        }
      }
    } finally {
      // 锚点与恢复态强制复位，任何异常都不残留——
      // 残留会导致后续新消息被误插到历史中间（助手页栽过这个坑）。
      historyInsertAnchor = null;
      isRestoringHistory = false;
    }

    // 会话已切走：本次插入作废，不做保位（新会话已重渲染）
    if (activeSessionToken !== tokenAtStart
      || currentAccountId !== accountAtStart
      || currentContactId !== contactAtStart) {
      isLoadingMoreHistory = false;
      return;
    }

    historyRenderedCount += batch.length;

    // 保位：前插后锚点被顶下去，把 scrollTop 补上它的位移差，视口内容纹丝不动
    if (anchorNode && anchorNode.isConnected) {
      const afterTop = anchorNode.offsetTop;
      bodyEl.scrollTop = beforeScroll + (afterTop - beforeTop);
    }

    // 前插批末条与原首屏首条同天时会多出一枚冗余胶囊，交给孤儿清理
    if (window.ChatDaySep) {
      ChatDaySep.pruneOrphans(messagesWrap);
    }

    updateJumpDeckVisibility();
    isLoadingMoreHistory = false;
  }

  /**
   * 把一批已落库的消息逐条上屏。
   *
   * 逐条插入而非一次性铺开：DOM 一起插完的话布局高度立刻撑满，
   * 后面的气泡即使还没显示也已经占好位置，看起来是原地淡入。
   * 一条条插才有真的往上顶的感觉。
   *
   * 滚动策略是这里的关键：整批插入期间不做无条件钉底。
   * 每条都钉底的话，第一条一插进来就被滚到「末条应有的视口位置」，
   * 后续气泡在它下方出现、把它推出视口上沿，看起来就是第一条从出现起
   * 就停在终点、从没被顶起过。改成只在内容真的溢出视口时才跟随滚动，
   * 不足一屏时完全交给 margin-top: auto 贴底，气泡就会从下往上把前文顶起。
   *
   * @param {Array} records 已落库的消息记录，按时间正序
   * @param {'envoy'|'char'} [role] 覆盖角色，缺省取记录自身的 role
   */
  async function appendRecordsStaggered(records, role, session) {
    const list = asArray(records);
    for (let i = 0; i < list.length; i++) {
      if (i > 0) await sleep(BUBBLE_STAGGER_MS);
      // 等待期间用户可能已经退出会话，切走了就停止上屏（消息已落库，不丢）
      if (!chatPage || !chatPage.classList.contains('active')) break;
      if (session && !isSessionCurrent(session)) break;
      const rec = list[i];
      if (!rec) continue;
      await appendMessage({
        role: role || rec.role,
        type: rec.messageType,
        content: rec.content,
        quote: rec.quote || null,
        createdAt: rec.createdAt,
        isVerifyMsg: rec.isVerifyMsg,
        fileRefs: rec.fileRefs || null,
        imageRef: rec.imageRef || null,
        messageGroupId: rec.messageGroupId || null,
        recordId: rec.id,
        animate: true
      });
    }
  }

  /* ================= 等待占位 ================= */

  /**
   * 挂一条对方侧的波形占位气泡，表示正在等对方回复。
   * 非流式请求拿不到「首字到达」时机，所以用一条独立占位行代替，
   * 请求回来后整行移除，再挂真实气泡。
   * @returns {Promise<HTMLElement|null>} 占位行，供后续移除
   */
  async function mountPendingRow() {
    if (!messagesWrap) return null;

    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant';
    row.dataset.pending = 'true';

    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    avatarCircle.innerHTML = AVATAR_FALLBACK_SVG;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-avatar-time';
    timeSpan.textContent = formatTime(Date.now());
    avatarCol.append(avatarCircle, timeSpan);

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';
    const tag = document.createElement('div');
    tag.className = 'chat-bubble-tag';
    const charName = trimStr(currentPerson && currentPerson.name) || '执行员';
    tag.textContent = `ENVOY // ${charName}`;
    const content = document.createElement('div');
    content.className = 'chat-bubble-content';
    content.innerHTML = WAVEFORM_HTML;
    bubble.append(tag, content);

    row.append(avatarCol, bubble);
    mountChatNode(row);
    scrollToBottom(false);

    // 立绘异步补齐，不阻塞波形上屏
    getPersonAvatarSrc(currentCharId).then((src) => {
      if (!src || !row.isConnected) return;
      avatarCircle.innerHTML = '';
      const img = document.createElement('img');
      img.src = src;
      img.alt = `${charName}头像`;
      avatarCircle.appendChild(img);
    }).catch(() => {});

    return row;
  }

  /** 移除占位行。传 null 也安全 */
  function removePendingRow(row) {
    if (row && row.parentNode) row.parentNode.removeChild(row);
    // 只有未传入具体节点时才清理遗留占位，避免旧请求误删新会话的波形。
    if (!row && messagesWrap) {
      messagesWrap.querySelectorAll('[data-pending="true"]').forEach((el) => el.remove());
    }
    // 占位行有一整行高度，移除后内容缩短、距底距离变大。
    // 不在这里补一次跟随的话，紧接着插入的第一条真实气泡会被判成「用户在翻旧消息」而不跟随。
    followBottomIfNear();
  }

  /* ================= 文件工具 =================
     私聊里的「翻文件」不是系统特权，而是对方能看到聊天文件区里的东西。
     实现上仍是工具循环，但对用户呈现为一句生活化的胶囊（「翻看了 xx.txt」），
     不出现工具名、参数、执行结果这类技术痕迹。 */

  const FILE_TOOL_TYPES = new Set(['read_file', 'search_file']);
  /** 单次翻阅返回的分页字符上限，与助手页一致 */
  const FILE_TOOL_PAGE_CHARS = 30000;
  /** 连续翻阅次数与结果保留轮数的兜底值，实际生效值读该联系人的对话设置 */
  const FILE_TOOL_LOOP_LIMIT = 10;

  /** 取当前联系人的私聊设置 */
  function chatSettings() {
    if (window.OnlineChatSettings && typeof OnlineChatSettings.getSettings === 'function') {
      return OnlineChatSettings.getSettings(currentContactId);
    }
    return null;
  }

  /** 内置工具（文件区翻阅）是否启用，缺省视为开启 */
  function isBuiltinToolsEnabled() {
    const s = chatSettings();
    return !s || s.builtinTools !== false;
  }

  /** 现实时间感知是否启用，缺省视为开启。控制时间基准段与消息时间前缀两者。 */
  function isTimePerceptionEnabled() {
    const s = chatSettings();
    return !s || s.timePerception !== false;
  }

  /**
   * 裁掉模型自行复述的时间标注行。
   *
   * 私聊比助手页更需要这层兜底：行标记本身就是方括号语法，
   * 模型看到上下文里的 [消息时间：…] 极易把它当成第四种合法标记跟着写，
   * 那样会被 parseReply 当作未知标记连整行内容一起丢掉，气泡直接少一条。
   * 必须在 parseReply 之前裁，顺序不能反。
   *
   * 逻辑复用助手页那份（三种形态、跳过思维链、全裁时保留原文），不另写一套。
   */
  function stripEchoedTime(text) {
    const raw = String(text || '');
    if (window.SystemChatUI && typeof SystemChatUI.stripEchoedTimePrefix === 'function') {
      try {
        return SystemChatUI.stripEchoedTimePrefix(raw);
      } catch (err) {
        console.warn('[Online Chat] 时间标注裁剪失败，按原文处理：', err);
        return raw;
      }
    }
    return raw;
  }

  function getToolLoopLimit() {
    const s = chatSettings();
    const val = s && parseInt(s.toolLoopLimit, 10);
    return Number.isFinite(val) && val >= 1 ? val : FILE_TOOL_LOOP_LIMIT;
  }

  /**
   * 是否为一次文件翻阅动作。
   * 内置工具关掉时一律不认：提示词里本来就没给标记，
   * 即便模型硬凑出来也不触发循环，不产生额外的模型调用。
   */
  function isFileToolAction(action) {
    if (!isBuiltinToolsEnabled()) return false;
    const type = String(action && (action.type || action.action) || '').trim().toLowerCase();
    return FILE_TOOL_TYPES.has(type);
  }

  /** 按 fileId / fileName 在本会话的文件区里解析条目 */
  function resolveFileEntry(action) {
    if (!window.FileStore) return null;
    const scope = onlineFileScope();
    const id = String(action.fileId || action.file_id || action.id || '').trim();
    if (id) {
      const byId = FileStore.getEntry(id, scope);
      if (byId) return byId;
    }
    const name = String(action.fileName || action.file_name || action.name || '').trim();
    if (name && typeof FileStore.getEntryByName === 'function') {
      return FileStore.getEntryByName(name, scope);
    }
    return null;
  }

  /**
   * 执行一次文件翻阅。
   * @returns {Promise<{name: string, fileName: string, status: string, output: string}>}
   */
  async function runFileTool(action) {
    const type = String(action.type || action.action || '').trim().toLowerCase();
    const scope = onlineFileScope();
    const entry = resolveFileEntry(action);

    if (!entry) {
      const wanted = action.fileName || action.file_name || action.fileId || action.file_id || action.name || action.id || '(未指定)';
      return { name: type, fileName: String(wanted), status: 'error', output: `文件区里没有「${wanted}」这个文件。请对照文件清单里的名字重新指定。` };
    }

    const text = await FileStore.getText(entry.id, scope);
    if (text == null) {
      return { name: type, fileName: entry.name, status: 'error', output: `文件「${entry.name}」的内容已经失效或被删除，打不开了。` };
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
        ? `文件「${entry.name}」第 ${page}/${totalPages} 页（共 ${total} 字符${page < totalPages ? '，可指定 page 继续往后翻' : ''}）：`
        : `文件「${entry.name}」全文（共 ${total} 字符）：`;
      return { name: 'read_file', fileName: entry.name, status: 'success', output: `${header}\n${slice}` };
    }

    if (type === 'search_file') {
      const keyword = String(action.keyword || action.query || action.q || '').trim();
      if (!keyword) {
        return { name: 'search_file', fileName: entry.name, status: 'error', output: '没有给出要找的词，无法检索。' };
      }
      const lines = text.split(/\r?\n/);
      const hits = [];
      const lowerKw = keyword.toLowerCase();
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].toLowerCase().includes(lowerKw)) {
          const from = Math.max(0, i - 1);
          const to = Math.min(lines.length - 1, i + 1);
          hits.push(lines.slice(from, to + 1).map((ln, idx) => `${from + idx + 1}: ${ln}`).join('\n'));
          if (hits.length >= 20) break;
        }
      }
      if (!hits.length) {
        return { name: 'search_file', fileName: entry.name, keyword, status: 'success', output: `文件「${entry.name}」里没有出现「${keyword}」。` };
      }
      return {
        name: 'search_file',
        fileName: entry.name,
        keyword,
        status: 'success',
        output: `文件「${entry.name}」里「${keyword}」出现 ${hits.length} 处${hits.length >= 20 ? '（只列前 20 处）' : ''}：\n\n${hits.join('\n---\n')}`
      };
    }

    return { name: type, fileName: entry.name, status: 'error', output: `不认识的翻阅方式：${type}` };
  }

  /**
   * 文件区常驻清单：只给文件名与体积，让对方知道有哪些东西可翻。
   * 措辞同样避开「工具」，写成「放在这里的文件」。
   * @returns {string}
   */
  function buildFileVaultManifest() {
    if (!window.FileStore || typeof FileStore.list !== 'function') return '';
    const items = FileStore.list(onlineFileScope());
    if (!items.length) return '';
    const lines = items.map((f) => `- ${f.name}（${f.sizeText}，${f.charCount} 字符）`);
    return `[文件区可用文件清单]\n这个聊天的文件区里现在放着 ${items.length} 份文件，你随时可以按名字翻开或检索：\n${lines.join('\n')}`;
  }

  /** 文件翻阅胶囊的 SVG：一份被翻开的文档，与撤回胶囊同一套线条语言 */
  const FILE_PEEK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm0 2.5L17.5 8H14V4.5zM8 12h8v1.6H8zm0 3.4h5.5V17H8z"/>'
    + '</svg>';

  /**
   * 追加一条文件翻阅胶囊。
   * 刻意写成日常口吻：用户看到的是「翻看了 xx.txt」，
   * 而不是工具名、入参和返回体。失败也只说打不开，不暴露报错细节。
   * @param {Object} result runFileTool 的返回
   * @returns {HTMLElement|null}
   */
  function appendFilePeekPill(result) {
    if (!messagesWrap || !result) return null;

    const name = trimStr(result.fileName) || '文件';
    let label;
    if (result.status === 'error') {
      label = `没能打开「${name}」`;
    } else if (result.name === 'search_file' && trimStr(result.keyword)) {
      label = `在「${name}」里找了下「${trimStr(result.keyword)}」`;
    } else {
      label = `翻看了「${name}」`;
    }

    const row = document.createElement('div');
    row.className = 'chat-status-pill-row';
    row.dataset.filePeek = 'true';

    // 多选能力：它不落库，但删消息时不能把这张卡孤零零留在流里
    attachRowBatchSelection(row);

    const pill = document.createElement('div');
    pill.className = 'chat-status-pill';
    pill.innerHTML = `${FILE_PEEK_SVG}<span class="chat-status-pill-text"></span>`;
    const textEl = pill.querySelector('.chat-status-pill-text');
    if (textEl) textEl.textContent = label;

    row.appendChild(pill);
    mountChatNode(row);
    followBottomIfNear();
    return row;
  }

  /* ================= 发图片（generate_image） =================
     与文件翻阅同为「隐性动作」：用户看到的只是对方发来一张照片，
     没有状态播报、没有工具痕迹。链路照抄助手侧，差别在三处：
       1. 触发方式是 [图片] 行标记，不是 RETROFLOW_ACTION 尾标记；
       2. 锁脸目标是 self（角色自己）/ peer（执行员本人或马甲），
          不是助手侧的 assistant / envoy；
       3. 图库 owner 按角色分，与执行员在本会话上传的图同一相册。 */

  /** 生图能力是否启用，缺省视为开启 */
  function isImageGenEnabled() {
    const s = chatSettings();
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
    return IMAGE_SIZE_WHITELIST.has(s) ? s : '1024x768';
  }

  /** 竖图给纵向比例提示，横图与方图各自给对应提示 */
  function ratioHintForSize(size) {
    if (size === '768x1024') return RetroflowAPI.RATIO_HINT_PORTRAIT;
    if (size === '1024x1024') return 'square 1:1 aspect ratio composition';
    return undefined;
  }

  /**
   * 按锁脸目标取参考图与外貌描述。
   *   self → 当前对话的角色档案
   *   peer → 当前登录账号（本人档案或马甲）
   * @returns {Promise<{appearance:string, faceRef:string|null}>}
   */
  async function resolveOnlineGenTarget(lockTarget) {
    const t = String(lockTarget || '').trim().toLowerCase();

    if (t === 'self') {
      let faceRef = null;
      try {
        if (currentCharId && window.DataRegistry) {
          faceRef = await Storage.getAssetSrc(DataRegistry.key.charFaceId(currentCharId));
        }
      } catch (_) { faceRef = null; }
      const appearance = trimStr(currentPerson && currentPerson.appearance);
      return { appearance, faceRef };
    }

    if (t === 'peer') {
      let faceRef = null;
      let appearance = '';
      try {
        if (window.DataRegistry) {
          // 马甲登录时锁马甲的脸，本人登录锁本人的脸
          const isMask = currentAccountId && currentAccountId !== 'persona';
          const key = isMask
            ? DataRegistry.key.maskFaceId(currentAccountId)
            : DataRegistry.key.personaFaceId();
          faceRef = await Storage.getAssetSrc(key);

          if (isMask) {
            const mask = ((window.Store && Store.envoy && Store.envoy.masks) || [])
              .find((m) => m && m.id === currentAccountId);
            appearance = trimStr(mask && mask.appearance);
          } else {
            const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};
            appearance = trimStr(identity.appearance);
          }
        }
      } catch (_) { faceRef = null; }
      return { appearance, faceRef };
    }

    return { appearance: '', faceRef: null };
  }

  /**
   * 执行一次发图：占位气泡 → 调 API（文生图或锁脸图生图）→ 归档图库
   * → 落库 → 就地替换成正式图片气泡。
   *
   * 失败时把占位气泡撤掉，不留残骸。开关关闭时直接不做。
   * @param {Object} msg parseReply 产出的图片消息 { content, lockTarget, size }
   * @param {Object} session 发起时的会话标识，用于防串窗
   * @returns {Promise<boolean>} 是否成功产出图片
   */
  async function runOnlineImageGen(msg, session) {
    if (!isImageGenEnabled()) return false;

    const prompt = trimStr(msg && msg.content);
    if (!prompt) return false;

    const cfg = getImageSlotConfig();
    if (!cfg) {
      // 没配生图节点：这是配置问题而非剧情事件，提示一次，不在聊天流里留痕
      toast('发图失败', '尚未配置图像生成节点');
      return false;
    }

    const size = normalizeImageSize(msg.size);
    const ratioHint = ratioHintForSize(size);
    const { appearance, faceRef } = await resolveOnlineGenTarget(msg.lockTarget);

    // 外貌描述在前（仅锁脸时才有），画面描述在后。全局正向词由 api-core 内部拼。
    const finalPrompt = appearance ? `${appearance}, ${prompt}` : prompt;

    const stateRow = appendImageGenStateRow();

    // 出图也接终止信号：点方块能把正在跑的生图一起掐掉，不用干等几十秒
    const state = getRequestState(session.accountId, session.contactId);
    const signal = state.abortController ? state.abortController.signal : undefined;

    let res;
    try {
      if (faceRef) {
        res = await RetroflowAPI.generateImageEdit(cfg, faceRef, { prompt: finalPrompt, size, ratioHint, signal });
      } else {
        res = await RetroflowAPI.generateImage(cfg, { prompt: finalPrompt, size, ratioHint, signal });
      }
      if (!res || !res.image) throw new Error('服务端未返回图像');
    } catch (err) {
      if (stateRow && stateRow.parentNode) stateRow.remove();
      // 主动终止不算失败，安静撤掉占位
      if (!isAbortError(err)) toast('发图失败', (err && err.message) || '图像生成未完成');
      return false;
    } finally {
      if (faceRef) Storage.revokeAssetSrc(faceRef);
    }

    // 会话已被切走：清掉占位，不把图挂到别人的窗口
    if (!isSessionCurrent(session)) {
      if (stateRow && stateRow.parentNode) stateRow.remove();
      return false;
    }

    const recordId = `ochat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // 归档进图库：owner 与执行员在本会话上传的图一致，落进同一个角色相册
    let galleryEntry = null;
    try {
      if (!window.GalleryStore || typeof GalleryStore.record !== 'function') throw new Error('图库归档模块尚未加载');
      galleryEntry = await GalleryStore.record(res.image, {
        source: 'assistant-generation',
        chatRecordId: recordId,
        category: 'chat-cache',
        ownerType: 'character',
        ownerId: currentCharId,
        ownerName: trimStr(currentPerson && currentPerson.name) || '未知联系人'
      });
      if (!galleryEntry) throw new Error('影像归档失败');
    } catch (err) {
      if (stateRow && stateRow.parentNode) stateRow.remove();
      toast('发图失败', (err && err.message) || '影像归档失败');
      return false;
    }

    const imageRef = {
      type: 'image',
      galleryId: galleryEntry.id,
      assetKey: galleryEntry.key,
      state: 'active',
      mime: galleryEntry.mime,
      // 画面描述留档：既是上下文回灌的依据，也是影像释放后的文字凭据
      visionDescription: prompt
    };

    let rec;
    try {
      rec = await OnlineChatStore.putMessage({
        accountId: session.accountId,
        contactId: session.contactId,
        role: 'char',
        type: 'image',
        content: '',
        imageRef,
        recordId
      });
      if (!rec) throw new Error('图片消息落库失败');
    } catch (err) {
      // 落库失败回收图库资产，避免孤儿
      if (window.GalleryStore) await GalleryStore.remove([galleryEntry.id], { silentChatRelease: true }).catch(() => {});
      if (stateRow && stateRow.parentNode) stateRow.remove();
      toast('发图失败', (err && err.message) || '消息落库失败');
      return false;
    }

    if (stateRow && stateRow.parentNode) stateRow.remove();
    await appendMessage({
      role: 'char',
      type: 'image',
      content: '',
      imageRef: rec.imageRef,
      createdAt: rec.createdAt,
      recordId: rec.id,
      animate: true
    });
    return true;
  }

  /**
   * 发图占位气泡：对方侧的「正在出图」。
   * 复用生成态图框样式，不写「RENDERING」这类技术字样——
   * 对用户来说这只是一张还没加载完的照片。
   */
  function appendImageGenStateRow() {
    if (!messagesWrap) return null;
    const row = document.createElement('div');
    row.className = 'chat-msg-row assistant is-gen-image is-gen-state';
    row.dataset.pending = 'true';

    const avatarCol = document.createElement('div');
    avatarCol.className = 'chat-avatar-col';
    const avatarCircle = document.createElement('div');
    avatarCircle.className = 'chat-avatar-circle';
    avatarCircle.innerHTML = AVATAR_FALLBACK_SVG;
    const timeSpan = document.createElement('span');
    timeSpan.className = 'chat-avatar-time';
    timeSpan.textContent = formatTime(Date.now());
    avatarCol.append(avatarCircle, timeSpan);

    const figure = document.createElement('div');
    figure.className = 'chat-gen-image is-loading';
    figure.innerHTML = '<span class="chat-gen-spinner" aria-hidden="true"></span>';

    row.append(avatarCol, figure);
    mountChatNode(row);
    followBottomIfNear();
    return row;
  }

  /* ================= 请求链路 ================= */

  /** 发送按钮的两种形态图标：上箭头（发送）与方块（终止） */
  const ONLINE_SEND_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>'
    + '</svg>';
  const ONLINE_STOP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="6" y="6" width="12" height="12" rx="1.5"/>'
    + '</svg>';

  /**
   * 同步发送按钮形态。
   * 请求期间变成终止按钮：与助手页一致的交互习惯，方块图标 + 可点。
   * 私聊按会话隔离请求态，所以形态只反映「当前窗口」这一条请求。
   */
  function setSendButtonState(isRequesting) {
    if (!sendBtn) return;
    if (isRequesting) {
      sendBtn.classList.add('is-generating');
      sendBtn.innerHTML = ONLINE_STOP_ICON_SVG;
      sendBtn.setAttribute('aria-label', '终止请求');
      sendBtn.setAttribute('title', '终止请求 (ABORT)');
    } else {
      sendBtn.classList.remove('is-generating');
      sendBtn.innerHTML = ONLINE_SEND_ICON_SVG;
      sendBtn.setAttribute('aria-label', '发送消息');
      sendBtn.setAttribute('title', '发送消息');
    }
    sendBtn.disabled = false;
  }

  /**
   * 中止当前会话正在进行的请求。
   * @returns {boolean} 是否确实中止了一条请求
   */
  function abortCurrentRequest() {
    const state = getRequestState(currentAccountId, currentContactId);
    if (!state.requesting || !state.abortController) return false;
    try {
      state.abortController.abort();
    } catch (err) {
      console.warn('[Online Chat] 请求中止异常：', err);
    }
    return true;
  }

  /** 判断一个错误是否为用户主动中止 */
  function isAbortError(err) {
    if (!err) return false;
    if (err.isAbort) return true;
    if (err.name === 'AbortError') return true;
    const msg = String(err.message || '');
    return msg === 'The user aborted a request.'
      || msg === 'DOMException: The user aborted a request.';
  }

  /** 请求态开关：占着按钮防连点，并给出可见反馈 */
  function setRequestingState(on, state) {
    if (!state) return;
    state.requesting = !!on;
    // 只看会话身份，不看 session token：退出再进同一会话后 token 已换代，
    // 若按 isSessionCurrent 严格校验会被挡住，导致按钮形态同步不上后台请求。
    const s = state.session;
    if (s && (s.accountId !== currentAccountId || s.contactId !== currentContactId)) return;
    if (relayBtn) {
      // RELAY 保持原职责（只负责发起），请求期间禁用防连点
      relayBtn.classList.toggle('is-inferring', state.requesting);
      relayBtn.disabled = state.requesting;
    }
    if (jumpBottomBtn) {
      jumpBottomBtn.classList.toggle('is-inferring', state.requesting);
    }
    // 终止入口挂在发送按钮上
    setSendButtonState(state.requesting);
  }

  /**
   * 向对方请求一次回复，并把结果落库、渲染。
   *
   * @param {Object} [opts]
   * @param {string} [opts.greetingVerifyMsg] 有值时走招呼情境提示词（好友申请通过）
   * @param {boolean} [opts.greeting] 是否为招呼请求
   * @returns {Promise<boolean>} 是否成功产出至少一条消息
   */
  async function requestReply(opts) {
    if (getVisionState().pending) return false;
    if (!(await confirmFailedVision())) return false;
    const o = opts || {};
    const session = {
      token: activeSessionToken,
      charId: currentCharId,
      accountId: currentAccountId,
      contactId: currentContactId,
      person: currentPerson
    };
    const state = getRequestState(session.accountId, session.contactId);
    if (state.requesting) return false;
    state.session = session;
    if (!window.OnlineChatPrompt || !window.OnlineChatStore || !window.RetroflowAPI) {
      toast('通讯链路不可用', '提示词或 API 模块未加载');
      return false;
    }
    if (!session.charId || !session.contactId) return false;

    const config = OnlineChatPrompt.resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      toast('算力节点未配置', '请先在 API 设置里配置线上联络插槽或主模型');
      return false;
    }

    setRequestingState(true, state);
    let pendingRow = null;
    try {
      const records = await OnlineChatStore.listMessages(session.accountId, session.contactId);
      const timeAware = isTimePerceptionEnabled();
      const fileScope = onlineFileScope();
      const promptOptions = { fileTools: isBuiltinToolsEnabled(), imageGen: isImageGenEnabled() };

      // 装配分两遍，为的是破一个循环依赖：
      //   历史预算 = 上下文容量 - systemPrompt 开销，
      //   而 systemPrompt 里的世界书注入又要读历史来判定关键词。
      //
      // 第一遍只为拿到 systemPrompt。世界书关键词判定只看最近
      // WorldBookEngine.SCAN_MESSAGE_COUNT 条「合并后」的消息，私聊里同角色
      // 连发会合并成单条，所以那 4 条约等于最近 2 轮完整往来，连发的气泡全文
      // 都在扫描范围内。因此喂尾部少量记录就够，判定结果与喂全量一致，
      // 不必渲染整个历史、也不必为它去读文件正文。
      //
      // 探测窗口按「轮」取而不是按条取：一轮里双方可能各连发好几条，
      // 固定条数会把最早那轮切掉一半，合并后凑不满 SCAN_MESSAGE_COUNT，
      // 本该命中的关键词就漏判了。取 4 轮，是所需 2 轮的双倍余量。
      const probeRecords = (window.ContextBudget && typeof ContextBudget.splitIntoTurns === 'function')
        ? ContextBudget.splitIntoTurns(records).slice(-PROBE_TURN_COUNT).reduce((acc, turn) => acc.concat(turn), [])
        : records.slice(-24);
      const probeHistory = await OnlineChatStore.toApiMessages(
        probeRecords, 0, fileScope, timeAware, records, { skipFileInline: true }
      );

      const systemPrompt = o.greeting
        ? OnlineChatPrompt.buildGreetingPrompt(session.charId, session.accountId, o.greetingVerifyMsg, undefined, promptOptions)
        : OnlineChatPrompt.buildSystemPrompt(session.charId, session.accountId, probeHistory, promptOptions);
      if (!systemPrompt) {
        toast('档案缺失', '找不到该角色的档案，无法生成提示词');
        return false;
      }

      const baseline = timeAware ? OnlineChatPrompt.buildTimeBaseline(Date.now()) : '';
      const manifest = isBuiltinToolsEnabled() ? buildFileVaultManifest() : '';

      // 第二遍：扣掉所有固定开销，剩下的才是历史能用的预算。
      // 固定开销包含 systemPrompt、时间基准与文件区清单 —— 它们都是
      // 无条件注入的，不从历史预算里扣就会算超。
      const budgetApi = window.ContextBudget;
      let history;
      let injectedRecords = records;
      if (budgetApi && typeof budgetApi.resolveBudget === 'function') {
        const { inputBudget, contextLimit } = budgetApi.resolveBudget(config);
        const fixedCost = budgetApi.estimateMessageTokens({ role: 'system', content: systemPrompt })
          + (baseline ? budgetApi.estimateMessageTokens({ role: 'system', content: baseline }) : 0)
          + (manifest ? budgetApi.estimateMessageTokens({ role: 'system', content: manifest }) : 0);
        const historyBudget = Math.max(0, inputBudget - fixedCost);

        const fitted = await OnlineChatStore.toBudgetedApiMessages(records, {
          budget: historyBudget,
          scope: fileScope,
          withTime: timeAware
        });
        history = fitted.messages;
        injectedRecords = fitted.records;
        if (fitted.meta && fitted.meta.droppedTurns > 0) {
          console.info(
            `[Online Chat] 上下文容量 ${contextLimit} tokens，历史预算 ${historyBudget}，`
            + `装入 ${fitted.meta.keptTurns}/${fitted.meta.totalTurns} 轮（${fitted.meta.keptRecords}/${fitted.meta.totalRecords} 条）`
          );
        }
      } else {
        // 裁剪器缺失（理论上不会发生）：退回全量，宁可请求偏大也不静默丢历史
        history = await OnlineChatStore.toApiMessages(records, 0, fileScope, timeAware, records);
      }

      // 引用锚定的窗口就是本次真实注入的那些记录，交给锚定器备查
      setInjectedScope(injectedRecords);

      const messages = [{ role: 'system', content: systemPrompt }];
      // 时间基准紧跟人设之后、历史之前：模型读到历史时已经知道「现在」是什么时候。
      // 每次请求重新生成，取的是发起这一刻的时间，不是会话打开时的。
      if (baseline) messages.push({ role: 'system', content: baseline });
      messages.push(...history);

      // 深度注入的世界书条目按深度落位。深度从对话尾部往前数，
      // 所以必须在历史拼进来之后、常驻清单追加之前插，
      // 这样深度计数只落在对话轮次上，不被清单挤偏一位。
      const depthItems = OnlineChatPrompt.buildDepthInjection(history, session.charId);
      if (Array.isArray(depthItems) && depthItems.length
        && window.WorldBookEngine && typeof WorldBookEngine.applyDepthInjection === 'function') {
        const injected = WorldBookEngine.applyDepthInjection(messages, depthItems);
        messages.length = 0;
        messages.push(...injected);
      }

      // 文件区常驻清单：让对方知道现在有哪些文件可翻，不必猜文件名。
      // 内容在上面算预算时已经取过，这里直接用，避免重复构建导致两次
      // 结果不一致（预算按 A 算、实际发 B）。
      if (manifest) messages.push({ role: 'system', content: manifest });

      // 波形占位：请求期间让用户看到对方正在回应
      if (!isSessionCurrent(session)) return false;
      pendingRow = await mountPendingRow();
      state.pendingRow = pendingRow;

      state.abortController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      const signal = state.abortController ? state.abortController.signal : undefined;

      let raw = '';
      // 文件翻阅循环：对方每追加一次翻阅标记，就执行、回灌，再请一轮。
      // 波形占位全程挂着，翻阅过程对用户只表现为「对方还在回应」加一条胶囊。
      let loopCount = 0;
      const loopLimit = getToolLoopLimit();
      while (true) {
        const result = await RetroflowAPI.chat(config, messages, { signal });
        raw = (result && result.content) ? result.content : '';

        const extracted = (typeof OnlineChatPrompt.extractActions === 'function')
          ? OnlineChatPrompt.extractActions(raw)
          : { visibleText: raw, actions: [] };
        const toolActions = extracted.actions.filter(isFileToolAction);

        if (!toolActions.length) break;
        if (loopCount >= loopLimit) {
          // 到上限就停手，本轮已有的可见文本照常落库。
          // 这里不打扰用户：翻阅本身是隐性动作，上限只是内部保护。
          console.info(`[Online Chat] 连续翻阅已达 ${loopLimit} 次上限，停止循环`);
          break;
        }
        loopCount += 1;

        // 会话已被切走：翻阅链路终止，避免把结果挂到别人的窗口
        if (!isSessionCurrent(session)) return false;

        // 纯工具轮也必须作为 assistant 消息回灌：省掉它会让部分 OpenAI 兼容
        // 节点收到「user → system 结果」的非法序列，直接结束推理。
        const assistantTurn = trimStr(raw);
        if (assistantTurn) messages.push({ role: 'assistant', content: assistantTurn });

        const backLines = [];
        for (const action of toolActions) {
          const toolResult = await runFileTool(action);
          appendFilePeekPill(toolResult);
          // 回传标签用「文件内容」而不是「工具结果」：模型看到什么词，
          // 就容易顺着那个词的口吻说话，喂它「工具」它就会汇报调用过程。
          backLines.push(`[文件内容 · ${toolResult.fileName}]\n${toolResult.output}`);
        }
        messages.push({
          role: 'system',
          content: `以下是你刚打开的文件内容，看完继续把话说下去，不要提起你打开过文件：\n\n${backLines.join('\n\n')}`
        });

        // 翻阅期间占位行可能已被移除（比如上一轮插了胶囊），补回来保持等待感
        if (!pendingRow || !pendingRow.isConnected) {
          pendingRow = await mountPendingRow();
          state.pendingRow = pendingRow;
        }
      }

      const parsed = OnlineChatPrompt.parseReply(
        stripEchoedTime(
          (typeof OnlineChatPrompt.extractActions === 'function')
            ? OnlineChatPrompt.extractActions(raw).visibleText
            : raw
        )
      );
      removePendingRow(pendingRow);
      pendingRow = null;

      if (!parsed.length) {
        // 只追加了翻阅标记、一句话都没说：不算失败，也不该弹提示。
        if (loopCount > 0) return true;
        toast('对方没有回应', '模型返回为空，可稍后重试');
        return false;
      }

      // 先把全部消息落库，再逐条上屏。
      // 落库和上屏分离是为了让插入节奏不受 IndexedDB 写入耗时影响，
      // 也保证中途关页面时消息不会只存一半。
      //
      // 图片行例外：它要先真的把图生出来才有 imageRef 可落库，
      // 所以不进这批，留到上屏阶段按原始顺序就地执行（见下方分段推进）。
      const genEnabled = isImageGenEnabled();
      // 生图关闭时模型硬凑出来的图片行，降级成不落库、不渲染的丢弃项，
      // 避免把英文 prompt 当正文发给用户看。
      const renderable = parsed.filter((m) => m.type !== 'image' || genEnabled);
      const textLike = renderable.filter((m) => m.type !== 'image');

      const base = Date.now();
      const saved = new Map();
      for (let i = 0; i < textLike.length; i++) {
        // 引用锚定：模型写的片段要能对上真实历史消息才认。
        // 锚不上就丢弃引用只留正文，绝不把模型编造的「你说过的话」渲染出去。
        // records 是本轮请求前读的同一份历史，与模型看到的上下文一致。
        const anchored = textLike[i].quoteText
          ? anchorQuote(textLike[i].quoteText, records)
          : null;
        const rec = await OnlineChatStore.putMessage({
          accountId: session.accountId,
          contactId: session.contactId,
          role: 'char',
          type: textLike[i].type,
          content: textLike[i].content,
          quote: anchored,
          createdAt: base + i
        });
        if (rec) saved.set(textLike[i], rec);
      }
      const savedList = Array.from(saved.values());
      const lastMsg = renderable.length ? renderable[renderable.length - 1] : null;
      // 末条是图片时，摘要要显示「[图片]」而不是它前面那句话。
      // 图片记录此刻还不存在（要等生成完），所以造一个只用于摘要的轻量对象。
      const last = (lastMsg && lastMsg.type === 'image')
        ? { messageType: 'image', createdAt: base + textLike.length }
        : (savedList.length ? savedList[savedList.length - 1] : null);

      // 摘要与未读数必须始终按原会话更新，即使用户已经切到其他窗口。
      const isViewing = isSessionCurrent(session)
        && chatPage && chatPage.classList.contains('active');
      await OnlineChatStore.syncSession(session.accountId, session.contactId, last, {
        clearUnread: isViewing,
        unreadDelta: isViewing ? 0 : renderable.length
      });

      // 人已经不在这一页了（推理期间退出或切了别的会话）：
      // 消息只落库不上屏，靠顶部横幅告诉用户「这边回你了」。
      if (!isViewing) notifyIncoming(session, savedList, last);

      // 切换到其他会话后，回复仍只保存在原会话，不挂到当前页面。
      if (!isSessionCurrent(session)) return true;

      // 按模型给出的原始顺序推进：文本/语音直接上屏，图片就地生成。
      // 这样「先发图再说一句」和「先说话再发图」的顺序都能保住。
      for (let i = 0; i < renderable.length; i++) {
        if (i > 0) await sleep(BUBBLE_STAGGER_MS);
        if (!chatPage || !chatPage.classList.contains('active')) break;
        if (!isSessionCurrent(session)) break;
        // 终止可能落在逐条上屏的间隔里：此时停止后续气泡，
        // 已上屏与已落库的内容保留（与助手页「已有内容存盘」一致）。
        if (state.abortController && state.abortController.signal.aborted) break;

        const msg = renderable[i];
        if (msg.type === 'image') {
          await runOnlineImageGen(msg, session);
          continue;
        }
        const rec = saved.get(msg);
        if (!rec) continue;
        await appendMessage({
          role: 'char',
          type: rec.messageType,
          content: rec.content,
          quote: rec.quote || null,
          createdAt: rec.createdAt,
          isVerifyMsg: rec.isVerifyMsg,
          recordId: rec.id,
          animate: true
        });
      }
      updateJumpDeckVisibility();
      return true;
    } catch (err) {
      // 用户主动终止：安静收尾。已落库的消息与已插入的胶囊照常保留，
      // 未完成的占位由 finally 清掉，不弹失败提示。
      if (isAbortError(err)) return false;
      const desc = (window.RetroflowAPI && typeof RetroflowAPI.describeNetworkError === 'function')
        ? RetroflowAPI.describeNetworkError(err)
        : (err && err.message) || '未知错误';
      toast('中继失败', String(desc));
      return false;
    } finally {
      // 只收掉本请求创建的占位和状态，避免旧会话误触碰新会话。
      if (state.pendingRow === pendingRow) state.pendingRow = null;
      state.abortController = null;
      state.requesting = false;
      // 收尾按会话身份判断，不看 token：用户中途退出再进来时
      // 仍要把占位撤掉、按钮复位，否则会卡在终止态。
      if (session.accountId === currentAccountId && session.contactId === currentContactId) {
        removePendingRow(pendingRow);
        setRequestingState(false, state);
      }
    }
  }

  /* ================= 路由 ================= */

  function dismissChatUI() {
    // 仅关闭当前视图，不中止任何会话请求；后台请求继续归属自己的状态桶。
    activeSessionToken += 1;
    // 关闭所有悬浮组件
    closeActiveHud();
    // 多选态不跨会话保留：否则下次进来顶栏还卡在「已选中 N 项」、坞也还浮着
    if (isBatchMode) exitBatchMode();
    if (activeVoiceStrip) {
      stopVoiceTts();
      resetVoiceStrip(activeVoiceStrip);
      activeVoiceStrip = null;
    }
    // 语音模式不跨会话保留：换个人聊天时应回到默认的打字态
    setVoiceMode(false);
    clearQuoteDraftUI();
    toggleDockPanel(false);
    chatPage.classList.remove('active');
    chatPage.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('page-active');
    if (textarea) textarea.blur();
    setTimeout(() => {
      if (!chatPage.classList.contains('active')) {
        chatPage.hidden = true;
      }
    }, 360);
  }

  /**
   * 打开与某个角色的私聊会话。
   * @param {string} charId 角色档案 id
   * @param {string} [accountId] 登录账号，缺省本人
   * @param {string} [contactId] 联系人记录 id，消息落库的归属键
   * @param {'char'|'npc'|'official'} [rosterType] 档案维次。
   *   立绘资产键按维次分库，调用方（联系人记录）手上就有权威值，
   *   传进来可免去回查 roster；不传则由 findPerson 自行判定。
   */
  function open(charId, accountId, contactId, rosterType) {
    if (!chatPage) return;
    activeSessionToken += 1;

    // 打开页面时关闭所有悬浮组件
    closeActiveHud();
    
    currentCharId = charId || '';
    currentAccountId = accountId || 'persona';
    currentContactId = contactId || '';
    currentPerson = findPerson(currentCharId);
    // 调用方传了维次就以它为准，findPerson 的推断只作兜底
    if (currentPerson && rosterType) currentPerson.__rosterType = rosterType;
    const session = {
      token: activeSessionToken,
      charId: currentCharId,
      accountId: currentAccountId,
      contactId: currentContactId,
      person: currentPerson
    };

    chatPage.hidden = false;
    chatPage.setAttribute('aria-hidden', 'false');
    void chatPage.offsetWidth;
    chatPage.classList.add('active');
    document.body.classList.add('page-active');
    syncChatFooterSpace();
    syncHeaderIdentity();
    syncQuoteDraftUI();

    // 打开私聊窗口时异步装载该会话专属的对话壁纸
    if (window.OnlineChatSettings && typeof OnlineChatSettings.restoreWallpaper === 'function') {
      OnlineChatSettings.restoreWallpaper(currentContactId);
    }
    // 恢复当前会话自己的请求态；其他会话的后台请求不影响本窗口。
    setRequestingState(getRequestState(currentAccountId, currentContactId).requesting,
      getRequestState(currentAccountId, currentContactId));
    // 进来就等于看到了，撤掉指向本会话的顶部横幅
    dismissNoticeForCurrent();
    try {
      history.pushState({ rfPage: 'online-chat' }, '', '#online-chat');
    } catch (_) {}
    loadMessages(session).then(async () => {
      const state = getRequestState(session.accountId, session.contactId);
      // 返回仍在推理的会话时补回自己的波形占位，不影响其他会话。
      if (isSessionCurrent(session) && state.requesting
        && (!state.pendingRow || !state.pendingRow.isConnected)) {
        state.pendingRow = await mountPendingRow();
      }
    }).catch((err) => console.warn('[Online Chat] 历史加载失败:', err));
  }

  function close() {
    if (!chatPage || !chatPage.classList.contains('active')) return;
    // 先把消息列表垫回下层，再让本页滑出，否则退场那几帧会露出桌面。
    // instant=true：列表页只当背景板，不能也播滑入动画
    if (window.OnlineUI && typeof OnlineUI.reveal === 'function') {
      OnlineUI.reveal(true);
    }
    dismissChatUI();
    if ((window.location.hash || '') === '#online-chat') {
      pendingProgrammaticBack = true;
      try {
        history.back();
      } catch (_) {
        pendingProgrammaticBack = false;
      }
    }
  }

  /**
   * 纯视图恢复：重新显示本页，不压历史条目、不重载消息。
   * 供跨页跳转返回时把本页作为底层复位使用。
   */
  function reveal() {
    if (!chatPage || chatPage.classList.contains('active')) return;
    chatPage.hidden = false;
    chatPage.setAttribute('aria-hidden', 'false');
    void chatPage.offsetWidth;
    chatPage.classList.add('active');
    document.body.classList.add('page-active');
    syncHeaderIdentity();
    const state = getRequestState(currentAccountId, currentContactId);
    setRequestingState(state.requesting, state);
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
    if (sendBtn && textarea) sendBtn.classList.toggle('is-ready', Boolean(textarea.value.trim()));
    autoResizeTextarea();
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
      if (sendBtn && textarea) sendBtn.classList.toggle('is-ready', Boolean(textarea.value.trim()));
      autoResizeTextarea();
      return;
    }
    const shell = textarea && textarea.parentElement;
    if (!shell) return;

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
      removeBtn.setAttribute('aria-label', '移除待发送图片');
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
      selectOnlineImage().catch((err) => toast('图片入口不可用', err.message || '图片选择器未加载'));
    });
    imagePreviewBar.appendChild(addCard);

    shell.insertBefore(imagePreviewBar, textarea);
    sendBtn && sendBtn.classList.add('is-ready');
    autoResizeTextarea();
  }

  function renderPendingImage(blob) {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    pendingImages.push({ blob, objectUrl });
    renderPendingImages();
  }

  async function selectOnlineImage() {
    if (!window.ImagePicker || typeof ImagePicker.open !== 'function') throw new Error('图片选择器尚未加载');
    ImagePicker.open({
      title: '发送影像给联系人',
      multiple: true,
      onSelect: async (result) => {
        try {
          const blobs = [];
          if (result && result.type === 'file' && result.file) blobs.push(result.file);
          else if (result && result.type === 'files' && Array.isArray(result.files)) blobs.push(...result.files);
          else if (result && result.type === 'url' && result.url) {
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
            const compressed = window.Storage && typeof Storage.compressImage === 'function'
              ? await Storage.compressImage(b, 1600, 0.84) : b;
            renderPendingImage(compressed);
          }
          toggleDockPanel(false);
        } catch (err) { toast('图片载入失败', err.message || '无法读取图片'); }
      }
    });
  }

  async function recognizeOnlineImage(blob, text) {
    const timeoutMs = 90000;
    return Promise.race([
      (async () => {
    if (!window.RetroflowApiUI || !window.RetroflowAPI || typeof RetroflowApiUI.resolveSlot !== 'function') {
      throw new Error('视觉识别模块尚未加载');
    }
    const config = RetroflowApiUI.resolveSlot('vision');
    if (!config || !config.baseUrl || !config.modelId) throw new Error('尚未配置视觉模型或主模型');
    const prompt = ['请客观、详细地描述这张图片，供后续聊天记忆使用。', '描述主体、环境、动作、构图、可辨识文字及关键细节；不要回答图片之外的问题。', text ? `用户随图文字：${text}` : ''].filter(Boolean).join('\\n');
    const result = await RetroflowAPI.chat(config, [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: await blobToDataUrl(blob) } }] }], { timeout: 120000 });
    const description = String(result && result.content || '').trim();
    if (!description) throw new Error('视觉模型未返回有效描述');
    return description;
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('视觉识别超时，请确认视觉模型节点可用')), timeoutMs))
    ]);
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
    if (relayBtn) {
      relayBtn.disabled = Boolean(getRequestState(currentAccountId, currentContactId).requesting) || state.pending;
      relayBtn.setAttribute('aria-label', state.pending ? '等待影像识别完成' : 'RELAY');
    }
  }
  async function confirmFailedVision() {
    const state = getVisionState();
    if (state.pending) return false;
    if (!state.failed) return true;
    if (!window.RetroModal || typeof RetroModal.confirm !== 'function') return true;
    return await RetroModal.confirm({
      tag: 'VISION // 识别状态',
      message: '存在未识别成功的图片，是否继续发送？',
      detail: '继续后，未成功识别的图片不会进入对话的文字视觉记忆。',
      confirmText: '继续发送',
      cancelText: '返回检查'
    });
  }

  /* ================= 事件绑定 ================= */

  // 点击页面主体关闭 HUD
  if (chatPage) {
    chatPage.addEventListener('click', (e) => {
      // 点击到 HUD 自己或气泡时不关闭
      if (e.target.closest('.chat-context-hud') || e.target.closest('.chat-bubble')) return;
      closeActiveHud();
    });
  }

  if (backBtn) {
    backBtn.addEventListener('click', close);
  }

  window.addEventListener('resize', () => {
    syncChatFooterSpace();
    if (chatPage && chatPage.classList.contains('active')) settleChatBottom();
  });

  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }
    // 上层弹窗优先接管这次返回
    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;

    const hash = window.location.hash || '';
    if (chatPage && chatPage.classList.contains('active') && hash !== '#online-chat') {
      // 顺序：先把消息列表垫回下层，再让本页滑出。
      // 反过来的话本页滑走时下层是空的，会先闪出桌面再由列表页淡进来。
      // instant=true：列表页瞬间就位，不播自己的滑入过渡
      if (window.OnlineUI && typeof OnlineUI.reveal === 'function') {
        OnlineUI.reveal(true);
      }
      dismissChatUI();
    }
  });

  if (textarea) {
    textarea.addEventListener('input', autoResizeTextarea);
    // 聚焦时收起抽屉，避免键盘与面板叠加挤压消息流
    textarea.addEventListener('focus', () => toggleDockPanel(false));
  }

  if (plusBtn) {
    plusBtn.addEventListener('click', () => toggleDockPanel());
  }

  if (dockPanel) {
    dockPanel.addEventListener('click', (e) => {
      const item = e.target.closest('[data-online-panel]');
      if (!item || item.disabled) return;
      const key = item.dataset.onlinePanel;
      if (key === 'file') {
         toggleDockPanel(false);
         if (window.FileVaultUI && typeof FileVaultUI.openForPick === 'function') FileVaultUI.openForPick(onlineFileScope(), (entries) => { pendingFiles = entries || []; renderPendingFiles(); });
         else toast('文件区不可用', '文件区模块尚未加载');
         return;
       }
       if (key === 'image') {
        selectOnlineImage().catch((err) => toast('图片入口不可用', err.message || '图片选择器未加载'));
        return;
      }
      if (key === 'voice') {
        toggleDockPanel(false);
        setVoiceMode();
        return;
      }
      const label = item.querySelector('.chat-panel-label-zh');
      toast('机能尚未接通', `${label ? label.textContent : key} 通道正在铺设`);
    });
  }

  if (voiceModeClose) {
    voiceModeClose.addEventListener('click', () => setVoiceMode(false));
  }

  onlineImageInput.addEventListener('change', () => {
    const file = onlineImageInput.files && onlineImageInput.files[0];
    onlineImageInput.value = '';
    if (file) renderPendingImage(file);
  });

if (sendBtn) {
    sendBtn.addEventListener('click', async () => {
      // 请求进行中：此时按钮是方块终止态，点击中断本会话的请求，不发消息
      if (sendBtn.classList.contains('is-generating')) {
        abortCurrentRequest();
        return;
      }
      const text = textarea ? textarea.value.trim() : '';
      const imageBlobs = pendingImages.map((p) => p.blob).filter(Boolean);
      if (!text && !imageBlobs.length && !pendingFiles.length) return;
      if (!window.OnlineChatStore || !currentContactId) {
        toast('会话未就绪', '缺少联系人归属，消息无法落库');
        return;
      }

      // 输入内容先从编辑区取出；图片归档并上屏后，识图在后台继续，不阻塞后续气泡。
      if (textarea) { textarea.value = ''; autoResizeTextarea(); }
      let rec = null;
      let fileRec = null;
      const imageRecs = [];
      const imageUis = [];
      const galleryEntries = [];
      const visionTasks = [];
      const visionSession = { accountId: currentAccountId, contactId: currentContactId, charId: currentCharId };
      const currentQuote = getCurrentQuote();
      let quoteAttached = false;
      const takeQuote = () => {
        if (quoteAttached) return null;
        quoteAttached = true;
        return currentQuote;
      };

      try {
        const groupId = (imageBlobs.length || pendingFiles.length) ? `ochatgrp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        if (imageBlobs.length) {
          for (let i = 0; i < imageBlobs.length; i++) {
            const blob = imageBlobs[i];
            const imageId = `ochat_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
            const galleryEntry = await GalleryStore.record(blob, {
              source: 'online-chat', chatRecordId: imageId, category: 'chat-cache',
              ownerType: 'character', ownerId: currentCharId,
              ownerName: trimStr(currentPerson && currentPerson.name) || '未知联系人'
            });
            if (!galleryEntry) throw new Error('影像归档失败');
            galleryEntries.push(galleryEntry);

            const imageRef = { type: 'image', galleryId: galleryEntry.id, assetKey: galleryEntry.key, state: 'pending', mime: galleryEntry.mime, visionDescription: '' };
            const imgRec = await OnlineChatStore.putMessage({
              accountId: currentAccountId, contactId: currentContactId, role: 'envoy', type: 'image',
              content: '', imageRef, quote: (!text && !pendingFiles.length && i === 0) ? takeQuote() : null, messageGroupId: groupId
            });
            if (!imgRec) throw new Error('图片消息落库失败');
            imageRecs.push(imgRec);
            visionTasks.push({ blob, text, recordId: imgRec.id, createdAt: imgRec.createdAt, groupId, index: i, imageRef });
          }
        }
        if (pendingFiles.length) {
          fileRec = await OnlineChatStore.putMessage({ accountId: currentAccountId, contactId: currentContactId, role: 'envoy', type: 'file', content: '', fileRefs: pendingFiles, quote: !text ? takeQuote() : null, messageGroupId: groupId });
          if (!fileRec) throw new Error('文件消息落库失败');
        }
        if (text) {
          rec = await OnlineChatStore.putMessage({ accountId: currentAccountId, contactId: currentContactId, role: 'envoy', type: isVoiceMode ? 'voice' : 'text', content: text, quote: takeQuote(), messageGroupId: groupId });
          if (!rec) throw new Error('文字消息落库失败');
        }
      } catch (err) {
        if (galleryEntries.length && window.GalleryStore) {
          await GalleryStore.remove(galleryEntries.map((g) => g.id), { silentChatRelease: true }).catch(() => {});
        }
        toast('发送失败', err.message || '消息落库失败，请重试');
        return;
      }
      if (imageRecs.length) {
        for (const imgRec of imageRecs) {
          const row = await appendMessage({ role: 'envoy', type: 'image', content: '', imageRef: imgRec.imageRef, quote: imgRec.quote, createdAt: imgRec.createdAt, recordId: imgRec.id, messageGroupId: imgRec.messageGroupId, animate: true, stickBottom: true });
          imageUis.push({ row });
        }
      }
      if (fileRec) await appendMessage({ role: 'envoy', type: fileRec.messageType, content: fileRec.content, quote: fileRec.quote, fileRefs: fileRec.fileRefs, createdAt: fileRec.createdAt, recordId: fileRec.id, messageGroupId: fileRec.messageGroupId, animate: true, stickBottom: true });
      if (rec) await appendMessage({ role: 'envoy', type: rec.messageType, content: rec.content, quote: rec.quote, createdAt: rec.createdAt, recordId: rec.id, messageGroupId: rec.messageGroupId, animate: true, stickBottom: true });
      const last = rec || fileRec || (imageRecs.length ? imageRecs[imageRecs.length - 1] : null);
      if (last) await OnlineChatStore.syncSession(currentAccountId, currentContactId, last, { clearUnread: true });

      clearQuoteDraft();
      clearPendingImage();
      pendingFiles = [];
      renderPendingFiles();
      updateJumpDeckVisibility();
      syncVisionGate();

      if (visionTasks.length) {
        visionTasks.forEach((vt) => {
          void (async () => {
            const ui = imageUis[vt.index];
            try {
              const description = await recognizeOnlineImage(vt.blob, vt.text);
              const imageRef = { ...vt.imageRef, state: 'done', visionDescription: description };
              await OnlineChatStore.putMessage({ accountId: visionSession.accountId, contactId: visionSession.contactId, recordId: vt.recordId, role: 'envoy', type: 'image', content: '', imageRef, messageGroupId: vt.groupId, createdAt: vt.createdAt });
              if (ui && ui.row) {
                ui.row.dataset.visionDescription = description;
                ui.row.dataset.mediaState = 'done';
                const status = ui.row.querySelector('.chat-vision-status');
                if (status) { status.className = 'chat-vision-status is-done'; status.textContent = '影像记忆已归档'; }
              }
            } catch (_) {
              const imageRef = { ...vt.imageRef, state: 'failed', visionDescription: '' };
              await OnlineChatStore.putMessage({ accountId: visionSession.accountId, contactId: visionSession.contactId, recordId: vt.recordId, role: 'envoy', type: 'image', content: '', imageRef, messageGroupId: vt.groupId, createdAt: vt.createdAt });
              if (ui && ui.row) {
                ui.row.dataset.mediaState = 'failed';
                const status = ui.row.querySelector('.chat-vision-status');
                if (status) { status.className = 'chat-vision-status is-failed'; status.textContent = '影像识别失败'; }
              }
            } finally {
              syncVisionGate();
            }
          })();
        });
      }
    });
  }

  if (relayBtn) {
    // 发送只是把话挂上去，什么时候让对方开口由这个键决定
    relayBtn.addEventListener('click', () => {
      requestReply();
    });
  }

  if (expandBtn) {
    expandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;
      const next = await TextEditorModal.open({
        title: '全屏输入',
        value: textarea ? textarea.value : '',
        maxLength: 5000
      });
      if (next !== null && textarea) {
        textarea.value = next;
        autoResizeTextarea();
        textarea.focus();
      }
    });
  }

  if (jumpTopBtn) {
    jumpTopBtn.addEventListener('click', () => {
      if (bodyEl) bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  if (jumpBottomBtn) {
    jumpBottomBtn.addEventListener('click', () => scrollToBottom(true));
  }

  if (quoteDraftClose) {
    quoteDraftClose.addEventListener('click', clearQuoteDraft);
  }

  if (bodyEl) {
    bodyEl.addEventListener('scroll', () => {
      closeActiveHud();
      updateJumpDeckVisibility();
      // 上滑接近顶部（留 120px 缓冲）预加载更早历史。
      // 防误触：内容不足一屏（maxScroll <= 200）时不触发，避免刚进会话
      // 首屏未撑满就误判为「到顶」连锁加载；恢复态与加载中由函数内自锁。
      if (isRestoringHistory || isLoadingMoreHistory) return;
      if (historyRenderedCount >= historyAllRecords.length) return;
      const maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;
      if (maxScroll > 200 && bodyEl.scrollTop <= 120) {
        loadMoreHistory();
      }
    }, { passive: true });
    // 初始化时也按当前滚动位置计算，避免按钮常驻
    updateJumpDeckVisibility();
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      if (window.OnlineChatSettings && typeof OnlineChatSettings.open === 'function') {
        const contactName = trimStr(currentPerson && currentPerson.name) || '联系人';
        OnlineChatSettings.open({
          charId: currentCharId,
          accountId: currentAccountId,
          contactId: currentContactId,
          name: contactName,
          remark: currentPerson && currentPerson.remark
        });
      } else {
        toast('会话设置尚未就绪');
      }
    });
  }

  /* ================= 后台招呼 ================= */

  /**
   * 好友申请通过后的招呼请求。
   *
   * 这条不走当前会话态：用户点完「发送申请」还留在通讯录页，私聊页并没有打开。
   * 所以自带一套参数完成拼装、落库与会话摘要更新，不碰 currentXxx 变量。
   * 消息只落库不上屏，用户点进会话时由 loadMessages() 读出来。
   *
   * @param {Object} params
   * @param {string} params.charId 角色档案 id
   * @param {string} params.accountId 登录账号
   * @param {string} params.contactId 联系人记录 id
   * @param {string} [params.verifyMsg] 验证消息，空则走无消息文案
   * @returns {Promise<boolean>}
   */
  async function requestGreeting(params) {
    const p = params || {};
    if (!p.charId || !p.contactId || !p.accountId) return false;
    if (!window.OnlineChatPrompt || !window.OnlineChatStore || !window.RetroflowAPI) return false;

    const config = OnlineChatPrompt.resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      toast('算力节点未配置', '好友已添加，但对方暂时无法回应');
      return false;
    }

    const verifyMsg = trimStr(p.verifyMsg);

    // 验证消息本身就是用户说的第一句话，先落成一条真实消息进上下文
    if (verifyMsg) {
      const vRec = await OnlineChatStore.putMessage({
        accountId: p.accountId,
        contactId: p.contactId,
        role: 'envoy',
        type: 'text',
        content: verifyMsg,
        isVerifyMsg: true
      });
      if (vRec) {
        await OnlineChatStore.syncSession(p.accountId, p.contactId, vRec, {});
      }
    }

    // 招呼发生在好友刚通过的瞬间，会话文件区必然是空的，
    // 也还没有对话设置可读，所以这条链路不注入文件段。
    const systemPrompt = OnlineChatPrompt.buildGreetingPrompt(p.charId, p.accountId, verifyMsg);
    if (!systemPrompt) return false;

    try {
      const records = await OnlineChatStore.listMessages(p.accountId, p.contactId);
      // 招呼链路读不到该联系人的对话设置（会话尚未建立），按默认开启处理，
      // 与 DEFAULT_SETTINGS.timePerception 一致。刚加上好友时是深夜还是清晨，
      // 开场那句话的分寸是不一样的。
      const history = await OnlineChatStore.toApiMessages(records, GREETING_CONTEXT_LIMIT, { type: 'online', id: `online:${p.accountId}:${p.contactId}` }, true);
      const messages = [{ role: 'system', content: systemPrompt }];
      const greetBaseline = typeof OnlineChatPrompt.buildTimeBaseline === 'function'
        ? OnlineChatPrompt.buildTimeBaseline(Date.now())
        : '';
      if (greetBaseline) messages.push({ role: 'system', content: greetBaseline });
      messages.push(...history);

      const result = await RetroflowAPI.chat(config, messages, {});
      const parsed = OnlineChatPrompt.parseReply(stripEchoedTime((result && result.content) || ''));
      if (!parsed.length) return false;

      const base = Date.now();
      const saved = [];
      for (let i = 0; i < parsed.length; i++) {
        const rec = await OnlineChatStore.putMessage({
          accountId: p.accountId,
          contactId: p.contactId,
          role: 'char',
          type: parsed[i].type,
          content: parsed[i].content,
          createdAt: base + i
        });
        if (rec) saved.push(rec);
      }
      const last = saved.length ? saved[saved.length - 1] : null;

      // 对方主动开口，用户还没看到，计未读
      await OnlineChatStore.syncSession(p.accountId, p.contactId, last, {
        unreadDelta: parsed.length
      });

      const viewing = chatPage && chatPage.classList.contains('active')
        && currentContactId === p.contactId && currentAccountId === p.accountId;

      // 用户此刻不在这个会话（招呼场景下通常还留在通讯录页）：弹顶部横幅
      if (!viewing) {
        notifyIncoming({ accountId: p.accountId, contactId: p.contactId }, saved, last);
      }

      // 若用户此刻正开着这个会话，逐条补上屏。
      // 不能用 loadMessages()——那是历史回放，一次性铺完且不带动画。
      if (viewing) {
        await appendRecordsStaggered(saved, 'char');
        updateJumpDeckVisibility();
      }
      return true;
    } catch (err) {
      const desc = (typeof RetroflowAPI.describeNetworkError === 'function')
        ? RetroflowAPI.describeNetworkError(err)
        : (err && err.message) || '未知错误';
      toast('对方暂无回应', String(desc));
      return false;
    }
  }

  /**
   * 从顶部消息通知横幅落回某个私聊会话。
   *
   * 三种起点要分别处理，否则历史栈会乱：
   *   1. 已经开着私聊页（只是在跟别人聊）：直接换会话，不重复压 #online-chat；
   *   2. 开着线上联络列表页：沿用 openPrivateChat 的手法，保留 #online 那层，
   *      让私聊页自己压栈，等它盖满再静默收起列表页；
   *   3. 什么都没开（在桌面或别的应用页）：先把列表页垫在下层再开私聊页，
   *      这样返回键的层级和从列表点进去时一致，不会一下退回桌面。
   *
   * @param {Object} payload
   * @param {string} payload.contactId 联系人记录 id
   * @param {string} [payload.accountId] 收信账号，缺省本人
   * @param {string} [payload.rosterId] 角色档案 id，缺省时回查联系人
   * @param {'char'|'npc'|'official'} [payload.rosterType] 档案维次
   */
  function openFromNotice(payload) {
    const p = payload || {};
    const contactId = trimStr(p.contactId);
    if (!contactId || !chatPage) return;

    const accountId = trimStr(p.accountId) || 'persona';
    let rosterId = trimStr(p.rosterId);
    let rosterType = trimStr(p.rosterType);

    // 通知里没带档案信息时回查联系人，避免拿不到立绘与档案
    if (!rosterId && window.OnlineStore && typeof OnlineStore.findContact === 'function') {
      const c = OnlineStore.findContact(contactId);
      if (c) {
        rosterId = trimStr(c.rosterId);
        rosterType = rosterType || trimStr(c.rosterType);
      }
    }
    if (!rosterId) return;

    // 会话元数据按需创建，与从列表进入的口径一致
    try {
      if (window.OnlineStore && typeof OnlineStore.ensureSession === 'function') {
        OnlineStore.ensureSession(accountId, contactId);
      }
    } catch (_) {}

    const chatActive = chatPage.classList.contains('active');
    // 已经在跟这个人聊：什么都不用做
    if (chatActive && currentContactId === contactId && currentAccountId === accountId) return;

    if (chatActive) {
      // 同一层页面内换会话：不能走 open()（会再压一次历史），
      // 直接改会话态并重载消息流。
      switchSession(rosterId, accountId, contactId, rosterType || 'char');
      return;
    }

    const listOpen = !!(window.OnlineUI && typeof OnlineUI.isOpen === 'function'
      ? OnlineUI.isOpen()
      : document.getElementById('onlinePage')
        && document.getElementById('onlinePage').classList.contains('active'));

    // 列表页没开（人在桌面或别的应用页）：先让它正常压一层 #online 再进私聊。
    // 这里不能用 reveal()——它只做视图复位、不压历史，结果 #online-chat
    // 会紧挨着桌面，返回键一按就直接退回桌面，跳过了消息列表这一层。
    if (!listOpen && window.OnlineUI && typeof OnlineUI.open === 'function') {
      OnlineUI.open();
    }

    open(rosterId, accountId, contactId, rosterType || 'char');

    // 等私聊页盖满再静默收起列表页，避免两页并行滑动漏出桌面
    setTimeout(() => {
      if (!chatPage.classList.contains('active')) return;
      if (window.OnlineUI && typeof OnlineUI.close === 'function') OnlineUI.close(true);
    }, 380);
  }

  /**
   * 同层换会话：页面已经开着，只替换会话身份与消息流。
   * 不动历史栈，也不重播进场动画——用户看到的是「内容换了」而非「又进了一页」。
   */
  function switchSession(charId, accountId, contactId, rosterType) {
    activeSessionToken += 1;
    closeActiveHud();
    if (activeVoiceStrip) {
      stopVoiceTts();
      resetVoiceStrip(activeVoiceStrip);
      activeVoiceStrip = null;
    }
    setVoiceMode(false);
    toggleDockPanel(false);
    clearQuoteDraft();

    currentCharId = charId || '';
    currentAccountId = accountId || 'persona';
    currentContactId = contactId || '';
    currentPerson = findPerson(currentCharId);
    if (currentPerson && rosterType) currentPerson.__rosterType = rosterType;

    const session = {
      token: activeSessionToken,
      charId: currentCharId,
      accountId: currentAccountId,
      contactId: currentContactId,
      person: currentPerson
    };

    syncHeaderIdentity();
    if (window.OnlineChatSettings && typeof OnlineChatSettings.restoreWallpaper === 'function') {
      OnlineChatSettings.restoreWallpaper(currentContactId);
    }
    const state = getRequestState(currentAccountId, currentContactId);
    setRequestingState(state.requesting, state);
    dismissNoticeForCurrent();

    loadMessages(session).then(async () => {
      const st = getRequestState(session.accountId, session.contactId);
      if (isSessionCurrent(session) && st.requesting
        && (!st.pendingRow || !st.pendingRow.isConnected)) {
        st.pendingRow = await mountPendingRow();
      }
    }).catch((err) => console.warn('[Online Chat] 换会话加载失败:', err));
  }

  /** 进入会话时撤掉指向它的顶部横幅：人已经看到了 */
  function dismissNoticeForCurrent() {
    if (window.RetroflowOnlineNotice && typeof RetroflowOnlineNotice.dismissFor === 'function') {
      RetroflowOnlineNotice.dismissFor(currentAccountId, currentContactId);
    }
  }

  /**
   * 对方消息落地时，若用户不在这一页，就弹顶部横幅。
   *
   * 「来几条弹几次」按落库记录逐条弹，条数与用户真正错过的消息一致。
   * 只落到摘要那一条会丢掉信息量——连发三条时用户应该看到三条提醒。
   * 但也不能无限弹，横幅层自己限了 3 条堆叠，这里只管把记录喂过去。
   *
   * @param {Object} session 会话快照（accountId / contactId）
   * @param {Array} records 已落库的消息记录
   * @param {Object} [fallbackLast] 记录为空时的兜底摘要对象（如纯图片回复）
   */
  function notifyIncoming(session, records, fallbackLast) {
    if (!window.RetroflowOnlineNotice || typeof RetroflowOnlineNotice.push !== 'function') return;
    if (!session || !session.contactId) return;

    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    const payloads = list.length ? list : (fallbackLast ? [fallbackLast] : []);
    payloads.forEach((rec) => {
      RetroflowOnlineNotice.push({
        accountId: session.accountId,
        contactId: session.contactId,
        record: rec,
        createdAt: rec && rec.createdAt
      });
    });
  }

  /* ================= 公共接口 ================= */

  return {
    open,
    close,
    reveal,
    openFromNotice,
    isOpen: () => !!(chatPage && chatPage.classList.contains('active')),
    locateRecord,
    requestGreeting,
    getCurrentCharId: () => currentCharId,
    getCurrentAccountId: () => currentAccountId,
    getCurrentContactId: () => currentContactId
  };
})();