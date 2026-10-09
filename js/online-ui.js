/**
 * ============================================================================
 * 溯流计划 · 线上联络 UI 控制器 (Online UI Controller)
 * 职责：
 * 1. 负责注册面板（首次注册本人账号 / 添加马甲账号）与登录面板的渲染与交互
 * 2. 账号体系派生计算：本人账号 = 编号 (如 000517)，马甲账号 = 编号 + 马甲序号 (如 00051701)
 * 3. 路由与全屏视图状态管理（接管 hash #online 与 Dock 栏点击）
 * 4. 遵守《工地施工协议》：全 SVG 图标、零 emoji、零分割线、iOS 灵动岛保护
 * ============================================================================
 */
const OnlineUI = (() => {
  'use strict';

  let isOpen = false;
  let currentMode = 'login'; // 'login' | 'register-persona' | 'register-mask'
  let selectedAccountId = 'persona';
  let tempAvatarFile = null;
  let tempAvatarSrc = null;
  // 注册马甲账号时选中的马甲身份 id（本人注册不使用）
  let selectedMaskId = null;
  // 用户是否手动改过头像：为 true 时不再被所选马甲立绘覆盖
  let avatarTouchedByUser = false;

  // DOM 元素引用
  const pageEl = document.getElementById('onlinePage');
  const regPanel = document.getElementById('onlineRegisterPanel');
  const loginPanel = document.getElementById('onlineLoginPanel');

  // 注册面板元素
  const regBackBtn = document.getElementById('onlineRegisterBackBtn');
  const regTitle = document.getElementById('onlineRegisterTitle');
  const regSub = document.getElementById('onlineRegisterSub');
  const regHeroTag = document.getElementById('onlineRegisterHeroTag');
  const regHeroTip = document.getElementById('onlineRegisterHeroTip');
  const regAvatarStage = document.getElementById('onlineRegAvatarStage');
  const regAvatarImg = document.getElementById('onlineRegAvatarImg');
  const regAvatarPh = document.getElementById('onlineRegAvatarPh');
  const regAvatarInput = document.getElementById('onlineRegAvatarInput');
  const regAccountInput = document.getElementById('onlineRegAccountInput');
  const regAccountNote = document.getElementById('onlineRegAccountNote');
  const regNameInput = document.getElementById('onlineRegNameInput');
  const regPwdInput = document.getElementById('onlineRegPwdInput');
  const regPwdToggle = document.getElementById('onlineRegPwdToggle');
  const doRegisterBtn = document.getElementById('onlineDoRegisterBtn');
  const doRegisterText = document.getElementById('onlineDoRegisterText');

  // 马甲身份选择区元素
  const regIdentityPicker = document.getElementById('onlineRegIdentityPicker');
  const regIdentityRow = document.getElementById('onlineRegIdentityRow');
  const regIdentityAvatarImg = document.getElementById('onlineRegIdentityAvatarImg');
  const regIdentityAvatarPh = document.getElementById('onlineRegIdentityAvatarPh');
  const regIdentityName = document.getElementById('onlineRegIdentityName');
  const regIdentitySub = document.getElementById('onlineRegIdentitySub');
  const regIdentityEmpty = document.getElementById('onlineRegIdentityEmpty');
  const regGoCreateMaskBtn = document.getElementById('onlineRegGoCreateMaskBtn');

  // 登录面板元素
  const loginBackBtn = document.getElementById('onlineLoginBackBtn');
  const addAccountBtn = document.getElementById('onlineAddAccountBtn');
  const loginAccountPicker = document.getElementById('onlineLoginAccountPicker');
  const loginAvatarImg = document.getElementById('onlineLoginAvatarImg');
  const loginAvatarPh = document.getElementById('onlineLoginAvatarPh');
  const loginNicknameEl = document.getElementById('onlineLoginNickname');
  const loginKindEl = document.getElementById('onlineLoginKind');
  const loginAccountInput = document.getElementById('onlineLoginAccountInput');
  const loginPwdInput = document.getElementById('onlineLoginPwdInput');
  const loginPwdToggle = document.getElementById('onlineLoginPwdToggle');
  const loginPwdHint = document.getElementById('onlineLoginPwdHint');
  const doLoginBtn = document.getElementById('onlineDoLoginBtn');

  // 主通讯面板元素 (四 Tab 容器)
  const mainPanel = document.getElementById('onlineMainPanel');
  const mainBackBtn = document.getElementById('onlineMainBackBtn');
  const mainTitleEl = document.getElementById('onlineMainTitle');
  const mainSubEl = document.getElementById('onlineMainSub');
  const mainActionBtn = document.getElementById('onlineMainActionBtn');
  const mainActionSvg = document.getElementById('onlineMainActionSvg');
  const tabBar = document.getElementById('onlineTabBar');
  const logoutBtn = document.getElementById('onlineLogoutBtn');
  const tabViews = {
    chats: document.getElementById('onlineTabChatsView'),
    contacts: document.getElementById('onlineTabContactsView'),
    moments: document.getElementById('onlineTabMomentsView'),
    me: document.getElementById('onlineTabMeView')
  };
  let currentTab = 'chats';

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '"');
  }

  /** 获取本人真实编号，如 000517 */
  function getPersonaSerial() {
    return (window.Store && typeof Store.getSerialNo === 'function') ? Store.getSerialNo() : '000517';
  }

  /**
   * 计算指定账号的展示账号
   * 本人账号: 000517
   * 马甲账号: 00051701, 00051702...
   */
  function formatAccountSerial(account) {
    const baseSerial = getPersonaSerial();
    if (!account || account.id === 'persona') return baseSerial;

    const masks = (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) ? Store.envoy.masks : [];
    const idx = masks.findIndex((m) => m && m.id === account.id);
    const maskSerial = account.serialNo || (idx >= 0 ? String(idx + 1).padStart(2, '0') : '01');
    return `${baseSerial}${maskSerial}`;
  }

  /** 读取马甲库全部马甲 */
  function loadAllMasks() {
    return (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) ? Store.envoy.masks : [];
  }

  /** 可用于注册的马甲：排除已经注册过线上账号的 */
  function getAvailableMasks() {
    const states = (window.Store && Store.online && Store.online.accounts) || {};
    return loadAllMasks().filter((m) => m && m.id && !(states[m.id] && states[m.id].registered));
  }

  /** 依据马甲自身序号推导其线上账号 */
  function getMaskAccountNo(mask) {
    const baseSerial = getPersonaSerial();
    const masks = loadAllMasks();
    const idx = masks.findIndex((m) => m && m.id === mask.id);
    const maskSerial = (mask && mask.serialNo) || (idx >= 0 ? String(idx + 1).padStart(2, '0') : '01');
    return `${baseSerial}${maskSerial}`;
  }

  /** 生成下一个马甲账号的展示字符串与序号（对外保留，供未来扩展） */
  function getNextMaskSerialInfo() {
    const baseSerial = getPersonaSerial();
    const masks = (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) ? Store.envoy.masks : [];
    let maxNum = 0;
    masks.forEach((m) => {
      const n = parseInt(m && m.serialNo, 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    });
    const nextNumStr = String(maxNum + 1).padStart(2, '0');
    return {
      maskSerial: nextNumStr,
      fullAccount: `${baseSerial}${nextNumStr}`
    };
  }

  /** 判断本人账号是否已经完成过首次注册 */
  function isPersonaRegistered() {
    const states = (window.Store && Store.online && Store.online.accounts) || {};
    return !!states.persona && !!states.persona.registered;
  }

  /* ---------------- 马甲身份选择（注册马甲账号用） ---------------- */

  /**
   * 渲染马甲身份选择区。
   * 无可用马甲时展示引导，隐藏选择行。
   */
  async function renderIdentityPicker() {
    if (!regIdentityPicker) return;

    const available = getAvailableMasks();
    const hasAny = available.length > 0;

    if (regIdentityRow) regIdentityRow.hidden = !hasAny;
    if (regIdentityEmpty) regIdentityEmpty.hidden = hasAny;

    if (!hasAny) {
      selectedMaskId = null;
      updateMaskAccountFields(null);
      return;
    }

    // 选中项失效时回落到第一个可用马甲
    let target = available.find((m) => m.id === selectedMaskId);
    if (!target) {
      target = available[0];
      selectedMaskId = target.id;
    }

    await applyIdentitySelection(target);
  }

  /** 把选中的马甲身份写入顶部卡片与账号字段 */
  async function applyIdentitySelection(mask) {
    if (!mask) return;
    selectedMaskId = mask.id;

    if (regIdentityName) regIdentityName.textContent = mask.name || '未命名马甲';
    if (regIdentitySub) {
      const parts = [`MASK NO.${mask.serialNo || '--'}`];
      if (mask.gender) parts.push(mask.gender);
      regIdentitySub.textContent = parts.join(' · ');
    }

    let src = null;
    try {
      src = await Storage.getAssetSrc(DataRegistry.key.maskAvatar(mask.id));
    } catch (_) {}

    if (regIdentityAvatarImg && regIdentityAvatarPh) {
      if (src) {
        regIdentityAvatarImg.src = src;
        regIdentityAvatarImg.hidden = false;
        regIdentityAvatarPh.hidden = true;
      } else {
        regIdentityAvatarImg.removeAttribute('src');
        regIdentityAvatarImg.hidden = true;
        regIdentityAvatarPh.hidden = false;
      }
    }

    // 下方「设置头像」默认跟随所选马甲立绘，除非用户已自行更换
    if (!avatarTouchedByUser) {
      await applyMaskAvatarToPicker(mask, src);
    }

    updateMaskAccountFields(mask);
  }

  /**
   * 把马甲立绘同步到注册表单的头像位。
   * 只做展示与待存值填充，不触碰 avatarTouchedByUser。
   */
  async function applyMaskAvatarToPicker(mask, src) {
    // 释放上一张预览，避免 blob 泄漏
    if (tempAvatarSrc && tempAvatarSrc.startsWith('blob:')) {
      URL.revokeObjectURL(tempAvatarSrc);
    }
    tempAvatarSrc = null;
    tempAvatarFile = null;

    if (!regAvatarImg || !regAvatarPh) return;

    if (!src || !mask) {
      regAvatarImg.removeAttribute('src');
      regAvatarImg.hidden = true;
      regAvatarPh.hidden = false;
      return;
    }

    // 取立绘原始记录，并为头像位创建独立的 objectURL。
    // 不能直接复用上方身份行的 src：那是同一个 objectURL，
    // 用户之后更换头像时会 revoke 掉它，导致身份行的图一起变空。
    // 也不能把资产键名塞进 tempAvatarFile —— setAsset 会把字符串当成图片 URL 存。
    try {
      const raw = await Storage.getAssetRaw(DataRegistry.key.maskAvatar(mask.id));
      if (raw && raw.type === 'blob' && raw.data instanceof Blob) {
        tempAvatarFile = raw.data;
        tempAvatarSrc = URL.createObjectURL(raw.data);
      } else if (raw && raw.type === 'url' && typeof raw.data === 'string') {
        tempAvatarFile = raw.data;
        tempAvatarSrc = raw.data;
      } else {
        tempAvatarSrc = src;
      }
    } catch (_) {
      tempAvatarSrc = src;
    }

    regAvatarImg.src = tempAvatarSrc;
    regAvatarImg.hidden = false;
    regAvatarPh.hidden = true;
  }

  /** 依据选中马甲同步账号号码、昵称与说明文案 */
  function updateMaskAccountFields(mask) {
    if (!mask) {
      if (regAccountInput) regAccountInput.value = '--';
      if (regAccountNote) regAccountNote.textContent = '请先选择一个马甲身份，账号将随身份编号自动生成';
      return;
    }

    const accountNo = getMaskAccountNo(mask);
    if (regAccountInput) regAccountInput.value = accountNo;
    if (regAccountNote) {
      regAccountNote.textContent = `账号由所选马甲身份编号决定，自动分配为 ${accountNo}`;
    }
    // 昵称默认继承马甲名，用户可改
    if (regNameInput && !regNameInput.value.trim()) {
      regNameInput.value = mask.name || '';
    }
  }

  /** 点击身份行：唤起通用单选面板挑选马甲 */
  async function pickMaskIdentity() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;

    const available = getAvailableMasks();
    if (available.length === 0) return;

    const options = available.map((m) => ({
      value: m.id,
      label: m.name || '未命名马甲',
      hint: `MASK NO.${m.serialNo || '--'} · 账号 ${getMaskAccountNo(m)}`
    }));

    const picked = await SelectModal.pick({
      title: '选择马甲身份',
      tag: 'MASK VAULT // 身份指派',
      options,
      value: selectedMaskId || available[0].id
    });
    if (!picked) return;

    const target = available.find((m) => m.id === picked);
    if (!target) return;

    // 换身份时清空上一位的昵称，避免串味
    if (regNameInput) regNameInput.value = '';
    await applyIdentitySelection(target);
  }

  /** 跳转到马甲库新建马甲 */
  function goCreateMask() {
    if (!window.RetroflowPersonaUI || typeof RetroflowPersonaUI.openMaskVault !== 'function') {
      if (window.Toast) Toast.show('马甲库暂不可用', { type: 'warn' });
      return;
    }

    // 关键：不能走默认 close()。它内部的 history.back() 是异步的，
    // 其 popstate 会在个人档案 pushState('#persona') 之后才到达，
    // 把刚压入的记录弹掉，结果直接退回桌面。
    // 这里先以 fromPopState=true 静默收起本页（不动历史），
    // 再把当前 #online 记录原地替换为 #persona，全程只有一次历史变更。
    close(true);

    try {
      history.replaceState({ rfPage: 'persona' }, '', '#persona');
    } catch (_) {}

    RetroflowPersonaUI.openMaskVault({ create: true });
  }

  /* ---------------- 品牌头部自检日志（逐行推入） ---------------- */

  const brandLogEl = document.getElementById('onlineBrandLog');
  let brandLogTimer = null;
  let brandLogCursor = 0;

  // 语气统一为「链路环境自检 / 待机监听」，不含进度暗示，避免像永远加载不完
  // 重点色高亮刻意在行首、行中、行尾之间交替，避免全部堆在尾部
  const BRAND_LOG_LINES = [
    '<i>SCAN</i> TEMPORAL FREQUENCY BANDS',
    'CARRIER WAVE LOCKED @ <i>0x517</i>',
    '<i>SEC</i> ENCRYPTION LAYER ENGAGED',
    'PACKET TRACE <i>NOMINAL</i> 12MS',
    'MASK REGISTRY <i>SYNCED</i> AT NODE',
    '<i>LINK</i> HANDSHAKE ON STANDBY',
    'TIMELINE DRIFT <i>WITHIN</i> TOLERANCE',
    '<i>RELAY</i> CHAIN VERIFIED 3 HOPS',
    'AWAITING <i>OPERATOR</i> CREDENTIALS',
    '<i>SIG</i> INTEGRITY 99.4 PERCENT'
  ];

  const BRAND_LOG_MAX = 4;

  /** 推入一行日志，并对旧行做纵深衰减 */
  function pushBrandLogLine() {
    if (!brandLogEl) return;

    const raw = BRAND_LOG_LINES[brandLogCursor % BRAND_LOG_LINES.length];
    brandLogCursor += 1;

    const line = document.createElement('div');
    line.className = 'online-brand-log-line';
    // 文案为内置常量，<i> 仅作重点色高亮占位，转换为语义化 span
    line.innerHTML = '&gt; ' + raw.replace(/<i>/g, '<span class="log-hl">').replace(/<\/i>/g, '</span>');
    brandLogEl.appendChild(line);

    while (brandLogEl.children.length > BRAND_LOG_MAX) {
      brandLogEl.removeChild(brandLogEl.firstElementChild);
    }

    // 越靠上越淡：最新行不加衰减类
    const items = Array.from(brandLogEl.children);
    const last = items.length - 1;
    items.forEach((el, i) => {
      el.classList.remove('is-old-1', 'is-old-2', 'is-old-3');
      const age = last - i;
      if (age > 0 && age <= 3) el.classList.add('is-old-' + age);
    });
  }

  function startBrandLog() {
    if (!brandLogEl || brandLogTimer) return;
    // 首次填满可视区，避免从空白慢慢长出来
    if (!brandLogEl.children.length) {
      for (let i = 0; i < BRAND_LOG_MAX; i += 1) pushBrandLogLine();
    }
    brandLogTimer = setInterval(pushBrandLogLine, 1600);
  }

  function stopBrandLog() {
    if (brandLogTimer) {
      clearInterval(brandLogTimer);
      brandLogTimer = null;
    }
  }

  /* ---------------- 视图切换 ---------------- */

  function showRegisterView(mode = 'register-persona') {
    currentMode = mode;
    stopBrandLog();
    if (loginPanel) {
      loginPanel.hidden = true;
      loginPanel.classList.remove('is-entering');
    }
    if (mainPanel) {
      mainPanel.hidden = true;
      mainPanel.classList.remove('is-entering');
    }
    if (regPanel) {
      regPanel.hidden = false;
      regPanel.classList.remove('is-entering');
      // 强制触发 reflow 使切换动效重放
      void regPanel.offsetWidth;
      regPanel.classList.add('is-entering');
    }

    // 重置临时头像
    tempAvatarFile = null;
    if (tempAvatarSrc && tempAvatarSrc.startsWith('blob:')) {
      URL.revokeObjectURL(tempAvatarSrc);
    }
    tempAvatarSrc = null;
    // 新一轮注册：头像回到「跟随所选身份」状态
    avatarTouchedByUser = false;

    if (mode === 'register-persona') {
      const baseSerial = getPersonaSerial();
      const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};

      // 本人注册不需要选择马甲身份
      if (regIdentityPicker) regIdentityPicker.hidden = true;
      selectedMaskId = null;

      if (regTitle) regTitle.textContent = '注册账号';
      if (regSub) regSub.textContent = 'REGISTER ACCOUNT';
      if (regHeroTag) regHeroTag.textContent = '注册账号';
      if (regHeroTip) regHeroTip.textContent = '创建你的线上联络账号';
      if (regAccountInput) regAccountInput.value = baseSerial;
      if (regAccountNote) regAccountNote.textContent = '账号由身份编号自动分配，不可修改';
      const regBadge = document.getElementById('onlineRegAccountBadge');
      if (regBadge) {
        regBadge.className = 'online-badge-pill is-locked';
        regBadge.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
          <span>LOCKED</span>
        `;
      }
      if (regNameInput) regNameInput.value = identity.name || '执行员';
      if (regPwdInput) regPwdInput.value = '';
      if (doRegisterText) doRegisterText.textContent = '注册并登录账号';

      // 尝试回显个人档案头像
      Storage.getAssetSrc(DataRegistry.key.personaAvatar()).then((src) => {
        if (src && regAvatarImg && regAvatarPh) {
          regAvatarImg.src = src;
          regAvatarImg.hidden = false;
          regAvatarPh.hidden = true;
        } else if (regAvatarImg && regAvatarPh) {
          regAvatarImg.hidden = true;
          regAvatarPh.hidden = false;
        }
      }).catch(() => {});
    } else {
      // 马甲账号：账号与昵称都由所选马甲身份决定
      if (regIdentityPicker) regIdentityPicker.hidden = false;

      if (regTitle) regTitle.textContent = '添加马甲账号';
      if (regSub) regSub.textContent = 'ADD MASK ACCOUNT';
      if (regHeroTag) regHeroTag.textContent = '马甲注册';
      if (regHeroTip) regHeroTip.textContent = '选择一个马甲身份接入通讯';
      const regBadge = document.getElementById('onlineRegAccountBadge');
      if (regBadge) {
        regBadge.className = 'online-badge-pill is-auto';
        regBadge.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
          <span>AUTO-GEN</span>
        `;
      }
      if (regNameInput) regNameInput.value = '';
      if (regPwdInput) regPwdInput.value = '';
      if (doRegisterText) doRegisterText.textContent = '创建并登录马甲';

      // 头像先置空，随后由 renderIdentityPicker 依所选身份填入立绘
      if (regAvatarImg && regAvatarPh) {
        regAvatarImg.hidden = true;
        regAvatarPh.hidden = false;
      }

      // 渲染可选马甲身份（含空态引导）
      renderIdentityPicker();
    }
  }

  /**
   * 渲染登录卡内的当前账号身份（头像、昵称、类型、账号编号）。
   * 已注册账号为空时回落到注册视图。
   */
  async function renderLoginIdentity() {
    const accounts = OnlineStore.listAccounts();
    const registeredAccounts = accounts.filter((a) => a.state && a.state.registered);

    if (registeredAccounts.length === 0) {
      showRegisterView('register-persona');
      return;
    }

    let targetAcc = registeredAccounts.find((a) => a.id === selectedAccountId);
    if (!targetAcc) {
      targetAcc = registeredAccounts[0];
      selectedAccountId = targetAcc.id;
    }

    await applyLoginIdentity(targetAcc);
  }

  /** 把指定账号写入登录卡的身份展示区与账号输入框 */
  async function applyLoginIdentity(account) {
    if (!account) return;

    if (loginNicknameEl) {
      loginNicknameEl.textContent = account.name || '未命名';
    }
    if (loginKindEl) {
      // 本体账号不加类型标签，只有马甲账号才标注
      const isMask = account.id !== 'persona';
      loginKindEl.textContent = isMask ? '马甲' : '';
      loginKindEl.hidden = !isMask;
    }

    let avatarSrc = null;
    try {
      // 优先线上专属头像，其次回落身份立绘
      avatarSrc = await Storage.getAssetSrc(DataRegistry.key.onlineAccountAvatar(account.id));
      if (!avatarSrc) {
        avatarSrc = await Storage.getAssetSrc(account.avatarKey);
      }
    } catch (_) {}

    if (loginAvatarImg && loginAvatarPh) {
      if (avatarSrc) {
        loginAvatarImg.src = avatarSrc;
        loginAvatarImg.hidden = false;
        loginAvatarPh.hidden = true;
      } else {
        loginAvatarImg.removeAttribute('src');
        loginAvatarImg.hidden = true;
        loginAvatarPh.hidden = false;
      }
    }

    updateLoginInput(account);
  }

  /** 点击账号栏：唤起通用单选面板切换账号 */
  async function pickLoginAccount() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;

    const registeredAccounts = OnlineStore.listAccounts()
      .filter((a) => a.state && a.state.registered);
    if (registeredAccounts.length === 0) return;

    const options = registeredAccounts.map((acc) => ({
      value: acc.id,
      label: acc.name || '未命名',
      // 本体不标类型，只有马甲账号显示「马甲」前缀
      hint: acc.id === 'persona'
        ? `NO.${formatAccountSerial(acc)}`
        : `马甲 · NO.${formatAccountSerial(acc)}`
    }));

    const picked = await SelectModal.pick({
      title: '切换登录账号',
      tag: 'ONLINE // 账号指派',
      options,
      value: selectedAccountId || registeredAccounts[0].id
    });
    if (!picked) return;

    const target = registeredAccounts.find((a) => a.id === picked);
    if (!target) return;

    selectedAccountId = target.id;
    await applyLoginIdentity(target);
  }

  function updateLoginInput(account) {
    if (loginAccountInput) {
      loginAccountInput.value = formatAccountSerial(account);
    }
    if (loginPwdInput) {
      loginPwdInput.value = '';
    }
    // 切换账号时一并复位提示行，避免上一个账号的错误提示残留
    resetLoginPwdHint(account);
  }

  /** 该账号是否需要密码 */
  function accountNeedsPwd(accountId) {
    return !!(accountId && window.OnlineStore
      && typeof OnlineStore.hasPassword === 'function'
      && OnlineStore.hasPassword(accountId));
  }

  /** 提示行回到常态：说明当前账号是否需要密码 */
  function resetLoginPwdHint(account) {
    if (!loginPwdHint) return;
    const needPwd = accountNeedsPwd(account && account.id);
    loginPwdHint.classList.remove('is-error');
    loginPwdHint.textContent = needPwd
      ? '该账号已设置访问密码，需验证后接入'
      : '该账号未设置密码，可直接登录';
  }

  /** 提示行转为红字警示（校验失败），重放抖动动效 */
  function showLoginPwdError(message) {
    if (!loginPwdHint) return;
    loginPwdHint.classList.remove('is-error');
    // 强制重流，让同一条错误连续触发时动效能重放
    void loginPwdHint.offsetWidth;
    loginPwdHint.textContent = message;
    loginPwdHint.classList.add('is-error');
  }

  async function showLoginView() {
    currentMode = 'login';
    if (regPanel) {
      regPanel.hidden = true;
      regPanel.classList.remove('is-entering');
    }
    if (mainPanel) {
      mainPanel.hidden = true;
      mainPanel.classList.remove('is-entering');
    }
    if (loginPanel) {
      loginPanel.hidden = false;
      loginPanel.classList.remove('is-entering');
      // 强制触发 reflow 使切换动效重放
      void loginPanel.offsetWidth;
      loginPanel.classList.add('is-entering');
    }
    startBrandLog();
    await renderLoginIdentity();
  }

  /* ---------------- 主通讯面板与 Tab 控制器 ---------------- */

  const TAB_META = {
    chats: {
      title: '消息',
      sub: 'MESSAGES',
      actionTitle: '发起通讯',
      actionIcon: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>'
    },
    contacts: {
      title: '联系人',
      sub: 'CONTACTS',
      actionTitle: '添加联系人',
      actionIcon: '<path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>'
    },
    moments: {
      title: '动态',
      sub: 'MOMENTS',
      actionTitle: '发布动态',
      actionIcon: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>'
    },
    me: {
      title: '我的',
      sub: 'PROFILE',
      actionTitle: '账号切换',
      actionIcon: '<path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>'
    }
  };

  /**
   * 切换主面板 Tab
   * 1. 更新底部导航高亮态
   * 2. 切换当前可见 Tab 视口（加装进入动效）
   * 3. 动态联动顶栏标题、英文副标题与右侧操作图标
   */
  function switchTab(tabKey) {
    if (!TAB_META[tabKey]) return;
    currentTab = tabKey;

    // 1. TabBar 状态
    if (tabBar) {
      const items = tabBar.querySelectorAll('.online-tab-item');
      items.forEach((item) => {
        const key = item.getAttribute('data-tab');
        if (key === tabKey) {
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.classList.remove('active');
          item.setAttribute('aria-selected', 'false');
        }
      });
    }

    // 2. Tab 内容区
    Object.keys(tabViews).forEach((key) => {
      const view = tabViews[key];
      if (!view) return;
      if (key === tabKey) {
        view.hidden = false;
        view.classList.remove('is-entering');
        void view.offsetWidth;
        view.classList.add('is-entering');
      } else {
        view.hidden = true;
        view.classList.remove('is-entering');
      }
    });

    // 3. 顶栏元信息与操作按钮联动
    const meta = TAB_META[tabKey];
    if (mainTitleEl) mainTitleEl.textContent = meta.title;
    if (mainSubEl) mainSubEl.textContent = meta.sub;
    if (mainActionBtn) {
      mainActionBtn.setAttribute('title', meta.actionTitle);
      mainActionBtn.setAttribute('aria-label', meta.actionTitle);
    }
    if (mainActionSvg) {
      mainActionSvg.innerHTML = meta.actionIcon;
    }

    // 切到联系人 Tab 时，刷新助手卡片与好友统计
    if (tabKey === 'contacts') {
      renderContactsView();
    } else if (tabKey === 'chats') {
      renderChatsView();
    }
  }

  /* ---------------- 联系人子模块 (Contacts Subnav & Directory) ---------------- */

  const contactsSubnav = document.getElementById('onlineContactsSubnav');
  const contactsSubviews = {
    groups: document.getElementById('onlineContactsSubviewGroups'),
    friends: document.getElementById('onlineContactsSubviewFriends'),
    groupspace: document.getElementById('onlineContactsSubviewGroupspace')
  };
  let currentContactsSubtab = 'groups';

  /* ---------------- 消息会话子模块 (Chat Sessions) ---------------- */

  const chatsList = document.getElementById('onlineChatsList');

  // 系统助手会话的记录归属。多对话后不再固定，取当前活跃对话；
  // SystemChatUI 还没加载时退回历史遗留的 main，保证列表不空。
  function getSystemChatForkId() {
    try {
      if (window.SystemChatUI && typeof SystemChatUI.getCurrentForkId === 'function') {
        return SystemChatUI.getCurrentForkId();
      }
    } catch (_) { /* 退回默认 */ }
    return 'system-chat:main';
  }
  const SYSTEM_CHAT_RECORD_KIND = 'system_chat_message';

  /**
   * 会话时间戳格式化：今天给时分，昨天给「昨天」，本年给月日，跨年给年月。
   * 这是会话列表的通用惯例，让用户扫一眼就知道新鲜度。
   */
  function formatChatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');

    const sameDay = d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday = d.getFullYear() === yesterday.getFullYear()
      && d.getMonth() === yesterday.getMonth()
      && d.getDate() === yesterday.getDate();
    if (isYesterday) return '昨天';

    if (d.getFullYear() === now.getFullYear()) {
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}`;
  }

  /**
   * 从一条记录里提炼列表摘要。
   * 图片与文件消息本身没有正文，直接显示类型标记，不然列表里会出现空白行。
   */
  function summarizeRecord(record) {
    if (!record) return '';
    if (record.messageType === 'image') return '[图片]';
    if (record.messageType === 'assistant-image') return '[图片]';
    if (record.messageType === 'file') {
      const refs = Array.isArray(record.fileRefs) ? record.fileRefs : [];
      const first = refs[0] && refs[0].name ? refs[0].name : '';
      return first ? `[文件] ${first}` : '[文件]';
    }
    const text = String(record.content || '').replace(/\s+/g, ' ').trim();
    return text;
  }

  /**
   * 读取系统助手会话的末条消息。
   * 只取 system_chat_message 这一种 kind：工具调用卡与系统提示不该出现在会话摘要里。
   */
  async function loadSystemChatDigest() {
    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') return null;
    try {
      const records = await Storage.getRecordsByFork(getSystemChatForkId());
      const msgs = (Array.isArray(records) ? records : [])
        .filter((r) => r && r.kind === SYSTEM_CHAT_RECORD_KIND)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (!msgs.length) return null;

      const last = msgs[msgs.length - 1];
      const body = summarizeRecord(last);
      // 助手发言不加前缀，本人发言加「我：」，让用户分得清谁最后说了话
      const prefix = last.role === 'user' ? '我：' : '';
      return {
        preview: body ? `${prefix}${body}` : '',
        time: last.createdAt || 0
      };
    } catch (_) {
      return null;
    }
  }

  /** 构建系统助手会话卡片 */
  function buildSystemChatCard(asst, digest) {
    const card = document.createElement('div');
    card.className = 'online-chat-card is-system';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-chat-kind', 'system');

    const preview = (digest && digest.preview)
      ? digest.preview
      : '通讯链路已就绪，随时可以呼叫。';
    const timeText = (digest && digest.time) ? formatChatTime(digest.time) : '';

    card.innerHTML = `
      <div class="online-chat-avatar-stage">
        <div class="online-chat-avatar-inner">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
        <span class="online-chat-online-dot" aria-hidden="true"></span>
      </div>
      <div class="online-chat-meta">
        <div class="online-chat-name-row">
          <span class="online-chat-name">${escapeHtml(asst.name)}</span>
          <span class="online-chat-sys-tag">SYS</span>
        </div>
        <div class="online-chat-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="online-chat-side">
        <span class="online-chat-time">${escapeHtml(timeText)}</span>
        <span class="online-chat-unread" hidden>0</span>
      </div>
    `;

    // 异步补真实立绘
    if (window.Storage && window.DataRegistry && DataRegistry.key
      && typeof DataRegistry.key.assistantAvatar === 'function') {
      Storage.getAssetSrc(DataRegistry.key.assistantAvatar(asst.id)).then((src) => {
        if (!src) return;
        const inner = card.querySelector('.online-chat-avatar-inner');
        if (!inner) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = src;
        inner.innerHTML = '';
        inner.appendChild(img);
      }).catch(() => {});
    }

    const enter = () => openSystemChatFromList();
    card.addEventListener('click', enter);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });

    return card;
  }

  /**
   * 从消息列表进入系统助手聊天页。
   *
   * 路由处理是这里的关键：不能先 close() 再 SystemChatUI.open()。
   * close() 内部的 history.back() 是异步的，其 popstate 会在 open() 压入
   * #system-chat 之后才到达，把刚压进去的记录弹掉，结果直接退回桌面。
   *
   * 做法是保留 #online 这一层历史，仅静默收起本页视图，再让聊天页自己压栈。
   * 这样返回键会先退回线上联络的消息列表（符合「系统助手也走 Retroflow
   * 通讯链路」的设定），再按一次才回桌面。
   *
   * 视图层面则不能同时收本页、开聊天页：两页都走 translateX 过渡，
   * 并行滑动时中间那几帧谁都不满屏，底层桌面会直接透出来。
   * 聊天页（z-index 920）本就压在本页（900）之上，
   * 因此让列表页留在原位当底衬，等聊天页盖满后再静默收起。
   */
  function openSystemChatFromList() {
    if (!window.SystemChatUI || typeof SystemChatUI.open !== 'function') {
      if (window.Toast) Toast.show('系统助手通讯模块暂不可用', { type: 'warn' });
      return;
    }

    // 先让聊天页滑入，本页保持可见充当底衬，避免露出桌面
    // fromOnlineList：告知聊天页返回时应把本页复位到下层，而不是直接露桌面
    SystemChatUI.open({ fromOnlineList: true });

    // 过渡结束后再收起视图。只改状态与类名，不动历史（#online 这层留着给返回用）
    setTimeout(() => {
      // 聊天页若已被提前关掉（快速返回），本页应留着继续显示
      if (window.SystemChatUI && typeof SystemChatUI.isOpen === 'function' && !SystemChatUI.isOpen()) return;
      close(true);
    }, 380);
  }

  /**
   * 构建一张好友会话卡片。
   * 与系统助手卡同构，靠 data-chat-kind 区分，点击进入私聊。
   */
  function buildFriendChatCard(contact, session) {
    const card = document.createElement('div');
    card.className = 'online-chat-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-chat-kind', 'friend');
    card.setAttribute('data-contact-id', contact.id);

    const preview = (session && session.lastMessage)
      ? session.lastMessage
      : '通讯频段已建立，尚无消息往来。';
    const timeText = (session && session.lastMessageAt) ? formatChatTime(session.lastMessageAt) : '';
    const unread = (session && session.unread) ? Number(session.unread) : 0;

    card.innerHTML = `
      <div class="online-chat-avatar-stage">
        <div class="online-chat-avatar-inner">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
      </div>
      <div class="online-chat-meta">
        <div class="online-chat-name-row">
          <span class="online-chat-name">${escapeHtml(contact.displayName)}</span>
        </div>
        <div class="online-chat-preview">${escapeHtml(preview)}</div>
      </div>
      <div class="online-chat-side">
        <span class="online-chat-time">${escapeHtml(timeText)}</span>
        <span class="online-chat-unread"${unread > 0 ? '' : ' hidden'}>${unread > 99 ? '99+' : unread}</span>
      </div>
    `;

    if (contact.avatarKey && window.Storage && typeof Storage.getAssetSrc === 'function') {
      Storage.getAssetSrc(contact.avatarKey).then((src) => {
        if (!src) return;
        const inner = card.querySelector('.online-chat-avatar-inner');
        if (!inner) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = src;
        inner.innerHTML = '';
        inner.appendChild(img);
      }).catch(() => {});
    }

    const enter = () => openPrivateChat(contact);
    card.addEventListener('click', enter);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });

    return card;
  }

  /** 渲染消息 Tab 的会话列表 */
  async function renderChatsView() {
    if (!chatsList) return;

    const asst = getActiveAssistantInfo();
    const digest = await loadSystemChatDigest();

    chatsList.innerHTML = '';
    chatsList.appendChild(buildSystemChatCard(asst, digest));

    // 好友会话：只列已建立的联系人，按会话元数据的活跃度排序。
    // 会话元数据可能还没生成（刚加好友、没聊过），此时按加好友时间兜底排序。
    let contacts = [];
    try {
      if (window.OnlineStore && typeof OnlineStore.listContacts === 'function') {
        contacts = OnlineStore.listContacts(selectedAccountId) || [];
      }
    } catch (_) {
      contacts = [];
    }

    const sessionOf = (contactId) => {
      try {
        if (window.OnlineStore && typeof OnlineStore.findSession === 'function') {
          return OnlineStore.findSession(selectedAccountId, contactId);
        }
      } catch (_) {}
      return null;
    };

    contacts
      .map((c) => ({ contact: c, session: sessionOf(c.id) }))
      .sort((a, b) => {
        const at = (a.session && a.session.lastMessageAt) || a.contact.addedAt || 0;
        const bt = (b.session && b.session.lastMessageAt) || b.contact.addedAt || 0;
        return bt - at;
      })
      .forEach(({ contact, session }) => {
        chatsList.appendChild(buildFriendChatCard(contact, session));
      });
  }

  /* ---------------- 添加 / 搜索子模块 (Search & Discover Envoys / Groups) ---------------- */

  const searchPanel = document.getElementById('onlineSearchPanel');
  const searchBackBtn = document.getElementById('onlineSearchBackBtn');
  const searchTabs = document.getElementById('onlineSearchTabs');
  const searchInput = document.getElementById('onlineSearchInput');
  const searchClearBtn = document.getElementById('onlineSearchClearBtn');
  const searchEnvoySection = document.getElementById('onlineSearchEnvoySection');
  const searchGroupSection = document.getElementById('onlineSearchGroupSection');
  const envoySectionTitle = document.getElementById('onlineEnvoySectionTitle');
  const envoySectionEn = document.getElementById('onlineEnvoySectionEn');
  const suggestedEnvoyList = document.getElementById('onlineSuggestedEnvoyList');
  let currentSearchTab = 'envoy';
  let searchDebounceTimer = null;
  // 本轮随机抽出的推荐名单，清空搜索框时原样恢复，不重新洗牌
  let suggestedPool = [];

  /* ---------------- 好友申请验证消息弹窗 (Verify Message Modal) ---------------- */

  const verifyOverlay = document.getElementById('onlineVerifyOverlay');
  const verifyBackBtn = document.getElementById('onlineVerifyBackBtn');
  const verifyTargetName = document.getElementById('onlineVerifyTargetName');
  const verifyMsgInput = document.getElementById('onlineVerifyMsgInput');
  const verifyCounter = document.getElementById('onlineVerifyCounter');
  const verifyCancelBtn = document.getElementById('onlineVerifyCancelBtn');
  const verifyConfirmBtn = document.getElementById('onlineVerifyConfirmBtn');
  let currentVerifyTarget = null;

  /** 打开好友申请验证弹窗 */
  function openVerifyModal(person) {
    if (!verifyOverlay || !person) return;
    currentVerifyTarget = person;

    if (verifyTargetName) {
      const serial = normalizeSerialForSearch(person.serial);
      const tag = serial ? ` (NO.${serial})` : '';
      verifyTargetName.textContent = `${person.name}${tag}`;
    }

    if (verifyMsgInput) {
      verifyMsgInput.value = '';
    }
    if (verifyCounter) {
      verifyCounter.textContent = '0 / 50';
    }

    verifyOverlay.hidden = false;
    void verifyOverlay.offsetWidth;
    verifyOverlay.classList.add('active');

    setTimeout(() => {
      if (verifyMsgInput) verifyMsgInput.focus();
    }, 120);
  }

  /** 关闭好友申请验证弹窗 */
  function closeVerifyModal() {
    if (!verifyOverlay) return;
    verifyOverlay.classList.remove('active');
    setTimeout(() => {
      if (!verifyOverlay.classList.contains('active')) {
        verifyOverlay.hidden = true;
      }
    }, 200);
    currentVerifyTarget = null;
  }

  /** 发送好友申请 */
  async function handleSendFriendRequest() {
    if (!currentVerifyTarget) return;

    const target = currentVerifyTarget;
    const targetName = target.name;
    const verifyMsg = verifyMsgInput ? verifyMsgInput.value.trim() : '';

    let ok = false;
    let reason = '';
    let newContact = null;
    try {
      if (window.OnlineStore && typeof OnlineStore.addContact === 'function') {
        const res = await OnlineStore.addContact(selectedAccountId, target.id, target.rosterType);
        ok = !!(res && res.ok);
        reason = (res && res.reason) || '';
        newContact = (res && res.contact) || null;
      }
    } catch (_) {
      ok = false;
    }

    if (window.Toast) {
      if (ok) {
        Toast.show(`已与「${targetName}」建立通讯频段`, { type: 'success' });
      } else if (reason === 'already_exists') {
        Toast.show(`「${targetName}」已在通讯名录中`, { type: 'warn' });
      } else {
        Toast.show('通讯频段申请失败，请稍后重试', { type: 'warn' });
      }
    }

    closeVerifyModal();

    if (!ok) return;

    // 名录与推荐池都要跟着变：好友已入库，推荐位里不该再出现同一个人
    renderContactsView();
    refreshSuggestedEnvoys();

    // 对方主动开口。请求在后台跑，不挡用户继续操作；
    // 回来后刷新会话列表，摘要与未读红点就位。
    if (newContact && window.OnlineChatUI && typeof OnlineChatUI.requestGreeting === 'function') {
      OnlineChatUI.requestGreeting({
        charId: target.id,
        accountId: selectedAccountId,
        contactId: newContact.id,
        verifyMsg
      }).then((replied) => {
        if (replied) renderChatsView();
      }).catch(() => {});
    }
  }

  /** 推荐位展示数量 */
  const SUGGEST_LIMIT = 5;

  /**
   * 编号归一化：剥离 NO. 前缀与非数字字符并补齐 6 位。
   * 与 resonance-ui.js 的 normalizeSerial 保持同一套规则，
   * 保证搜 108 / 000108 / NO.000108 命中同一个人。
   */
  function normalizeSerialForSearch(raw) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw).trim().replace(/^NO\./i, '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length > 6) s = s.slice(-6);
    return s.padStart(6, '0');
  }

  /**
   * 汇总全部可添加的人物档案池。
   *
   * 三条取数通道：角色 / NPC / 官方角色。官方角色维次目前尚未落地，
   * roster 里还没有对应数组，通道先打通并留空，等官方角色实装后
   * 只要 Store.roster.officials 有数据，推荐与检索自动纳入，无需回改此处。
   */
  function collectRosterPool() {
    const roster = (window.Store && Store.roster) || {};
    const pool = [];

    const push = (item, rosterType) => {
      if (!item || !item.id) return;
      pool.push({
        id: item.id,
        rosterType,
        name: (item.name && String(item.name).trim()) || '未命名档案',
        serial: item.serial || '',
        camp: item.camp || ''
      });
    };

    // 通道 1：角色档案
    (Array.isArray(roster.characters) ? roster.characters : []).forEach((c) => push(c, 'char'));
    // 通道 2：NPC 档案
    (Array.isArray(roster.npcs) ? roster.npcs : []).forEach((n) => push(n, 'npc'));
    // 通道 3：官方角色（维次未落地，数组不存在时自然跳过）
    (Array.isArray(roster.officials) ? roster.officials : []).forEach((o) => push(o, 'official'));

    // 已在当前账号通讯录里的人不再推荐，避免推荐一个已经是好友的对象
    try {
      if (window.OnlineStore && typeof OnlineStore.hasContact === 'function') {
        return pool.filter((p) => !OnlineStore.hasContact(selectedAccountId, p.id));
      }
    } catch (_) {}
    return pool;
  }

  /** Fisher-Yates 洗牌：等概率打乱，不用 sort(() => Math.random()) 那种有偏写法 */
  function shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** 档案维次的中文标签 */
  function rosterTypeLabel(rosterType) {
    if (rosterType === 'npc') return 'NPC';
    if (rosterType === 'official') return '官方角色';
    return '角色';
  }

  /** 卡片副标题：有编号显示编号，副本阵营无编号则显示来源标记 */
  function buildDiscoverDesc(person) {
    const label = rosterTypeLabel(person.rosterType);
    const serial = normalizeSerialForSearch(person.serial);
    if (serial) return `NO.${serial} · ${label}`;
    if (person.camp === 'instance') {
      return person.rosterType === 'npc' ? `NPC.FORK · ${label}` : `SRC.FORK · ${label}`;
    }
    return `无编号 · ${label}`;
  }

  /** 头像资源键：按维次取对应的立绘键 */
  function avatarKeyOf(person) {
    if (!window.DataRegistry || !DataRegistry.key) return '';
    if (person.rosterType === 'npc') return DataRegistry.key.npcAvatar(person.id);
    // 官方角色落地后若共用 characters 存储，这里同样走 charAvatar
    return DataRegistry.key.charAvatar(person.id);
  }

  /** 渲染一张发现卡片（头像异步补齐，先出骨架不阻塞列表） */
  function buildDiscoverCard(person) {
    const card = document.createElement('div');
    card.className = 'online-discover-card';
    card.setAttribute('data-roster-id', person.id);
    card.setAttribute('data-roster-type', person.rosterType);

    const safeName = escapeHtml(person.name);
    card.innerHTML = `
      <div class="online-contact-avatar-stage">
        <svg class="online-contact-avatar-svg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
        </svg>
      </div>
      <div class="online-discover-meta">
        <div class="online-discover-name">${safeName}</div>
        <div class="online-discover-desc">${escapeHtml(buildDiscoverDesc(person))}</div>
      </div>
      <button class="online-discover-action-btn" type="button" aria-label="添加${safeName}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
        </svg>
        <span>添加</span>
      </button>
    `;

    // 异步加载真实立绘，失败或无图时保留机能 SVG 兜底
    const key = avatarKeyOf(person);
    if (key && window.Storage && typeof Storage.getAssetSrc === 'function') {
      Storage.getAssetSrc(key).then((src) => {
        if (!src) return;
        const stage = card.querySelector('.online-contact-avatar-stage');
        if (!stage) return;
        const img = document.createElement('img');
        img.className = 'online-contact-avatar-img';
        img.alt = '';
        img.src = src;
        stage.innerHTML = '';
        stage.appendChild(img);
      }).catch(() => {});
    }

    // 点击卡片或右侧「添加」按钮唤起验证消息弹窗
    const enter = () => openVerifyModal(person);
    const actionBtn = card.querySelector('.online-discover-action-btn');
    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        enter();
      });
    }
    card.addEventListener('click', enter);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });

    return card;
  }

  /** 渲染空态卡片 */
  function buildDiscoverEmptyCard(badge, text) {
    const el = document.createElement('div');
    el.className = 'online-empty-card';
    el.innerHTML = `
      <div class="online-empty-badge">${escapeHtml(badge)}</div>
      <div class="online-empty-text">${escapeHtml(text)}</div>
    `;
    return el;
  }

  /** 把一组人物渲染进执行员列表容器 */
  function renderEnvoyList(list, emptyBadge, emptyText) {
    if (!suggestedEnvoyList) return;
    suggestedEnvoyList.innerHTML = '';

    if (!list.length) {
      suggestedEnvoyList.appendChild(buildDiscoverEmptyCard(emptyBadge, emptyText));
      return;
    }

    const frag = document.createDocumentFragment();
    list.forEach((person) => frag.appendChild(buildDiscoverCard(person)));
    suggestedEnvoyList.appendChild(frag);
  }

  /** 重新洗牌并渲染「可能想认识的人」（每次打开搜索页都换一批） */
  function refreshSuggestedEnvoys() {
    suggestedPool = shuffle(collectRosterPool()).slice(0, SUGGEST_LIMIT);
    if (envoySectionTitle) envoySectionTitle.textContent = '可能想认识的人';
    if (envoySectionEn) envoySectionEn.textContent = 'SUGGESTED ENVOYS';
    renderEnvoyList(
      suggestedPool,
      'NO DATA // 档案库为空',
      '角色、NPC 与官方角色档案都还没有建档，先去共鸣模块录入人物档案。'
    );
  }

  /** 执行检索：匹配名字子串或归一化编号 */
  function runEnvoySearch(rawKeyword) {
    const keyword = String(rawKeyword || '').trim();

    // 空关键词回到推荐态，直接复用本轮已抽出的名单，不重新洗牌
    if (!keyword) {
      if (envoySectionTitle) envoySectionTitle.textContent = '可能想认识的人';
      if (envoySectionEn) envoySectionEn.textContent = 'SUGGESTED ENVOYS';
      renderEnvoyList(
        suggestedPool,
        'NO DATA // 档案库为空',
        '角色、NPC 与官方角色档案都还没有建档，先去共鸣模块录入人物档案。'
      );
      return;
    }

    const lower = keyword.toLowerCase();
    // 关键词里含数字时才按编号比对，避免纯文字搜索被编号规则误判
    const serialQuery = /\d/.test(keyword) ? normalizeSerialForSearch(keyword) : '';

    const hits = collectRosterPool().filter((p) => {
      if (p.name.toLowerCase().includes(lower)) return true;
      if (serialQuery && normalizeSerialForSearch(p.serial) === serialQuery) return true;
      return false;
    });

    if (envoySectionTitle) envoySectionTitle.textContent = `检索结果（${hits.length}）`;
    if (envoySectionEn) envoySectionEn.textContent = 'SEARCH RESULTS';
    renderEnvoyList(
      hits,
      'NO MATCH // 无匹配档案',
      `没有找到与「${keyword}」匹配的执行员，可换用名字或 NO. 编号重试。`
    );
  }

  /** 切换搜索页 Tab (执行员 / 群聊) */
  function switchSearchTab(tabKey) {
    if (tabKey !== 'envoy' && tabKey !== 'group') return;
    currentSearchTab = tabKey;

    if (searchTabs) {
      const items = searchTabs.querySelectorAll('.online-search-tab-item');
      items.forEach((item) => {
        const key = item.getAttribute('data-search-tab');
        if (key === tabKey) {
          item.classList.add('active');
          item.setAttribute('aria-selected', 'true');
        } else {
          item.classList.remove('active');
          item.setAttribute('aria-selected', 'false');
        }
      });
    }

    if (searchInput) {
      if (tabKey === 'envoy') {
        searchInput.placeholder = '输入执行员代号 / 昵称 / NO. 编号';
      } else {
        searchInput.placeholder = '输入群聊名称 / ID / 关键词';
      }
    }

    if (searchEnvoySection) {
      searchEnvoySection.hidden = (tabKey !== 'envoy');
    }
    if (searchGroupSection) {
      searchGroupSection.hidden = (tabKey !== 'group');
    }

    // 切换维次时清空关键词，避免执行员的搜索词残留在群聊框里
    if (searchInput && searchInput.value) {
      searchInput.value = '';
      if (searchClearBtn) searchClearBtn.hidden = true;
      if (tabKey === 'envoy') runEnvoySearch('');
    }
  }

  /** 打开搜索/添加页面 */
  function openSearchPanel() {
    if (!searchPanel) return;
    searchPanel.hidden = false;
    searchPanel.classList.remove('is-entering');
    void searchPanel.offsetWidth;
    searchPanel.classList.add('is-entering');

    // 默认切到执行员 Tab，清空搜索框
    switchSearchTab('envoy');
    if (searchInput) {
      searchInput.value = '';
    }
    if (searchClearBtn) {
      searchClearBtn.hidden = true;
    }

    // 每次进入都重新洗牌，保证看到的推荐名单不一样
    refreshSuggestedEnvoys();
  }

  /** 关闭搜索/添加页面退回主面板 */
  function closeSearchPanel() {
    if (!searchPanel) return;
    searchPanel.hidden = true;
    searchPanel.classList.remove('is-entering');
  }
  // 助手好友卡片元素
  const asstCard = document.getElementById('onlineAssistantCard');
  const asstAvatarImg = document.getElementById('onlineAssistantAvatarImg');
  const asstAvatarPh = document.getElementById('onlineAssistantAvatarPh');
  const asstNameEl = document.getElementById('onlineAssistantName');
  const friendsCountEl = document.getElementById('onlineFriendsCount');
  const friendsBody = document.getElementById('onlineGroupFriendsBody');
  const friendsEmptyCard = document.getElementById('onlineFriendsEmptyCard');
  const friendsSubview = document.getElementById('onlineContactsSubviewFriends');
  const friendFlatList = document.getElementById('onlineFriendFlatList');
  const friendFlatEmptyCard = document.getElementById('onlineFriendFlatEmptyCard');

  /**
   * 从通讯录进入与某个执行员的私聊。
   *
   * 路由手法与 openSystemChatFromList() 一致：不能先 close() 再 open()，
   * close() 里的 history.back() 是异步的，其 popstate 会把刚压进去的
   * #online-chat 弹掉。所以保留 #online 这层，只静默收起本页视图。
   *
   * 收起时机同样要等私聊页盖满：两页并行滑动会漏出底层桌面。
   */
  function openPrivateChat(contact) {
    if (!contact) return;
    if (!window.OnlineChatUI || typeof OnlineChatUI.open !== 'function') {
      if (window.Toast) Toast.show('私聊会话模块暂不可用', { type: 'warn' });
      return;
    }
    // 会话元数据按需创建：进过一次私聊就该在消息 Tab 里留下条目。
    // 不阻塞打开动作，落库失败也不影响这次对话。
    try {
      if (window.OnlineStore && typeof OnlineStore.ensureSession === 'function') {
        OnlineStore.ensureSession(contact.accountId || selectedAccountId, contact.id);
      }
    } catch (_) {}

    // 先让私聊页滑入，本页留在下层充当底衬。
    // 传 rosterType：NPC 与角色的立绘资产键分库，聊天页要靠它取对头像。
    OnlineChatUI.open(contact.rosterId, contact.accountId || selectedAccountId, contact.id, contact.rosterType);

    setTimeout(() => {
      if (window.OnlineChatUI && typeof OnlineChatUI.isOpen === 'function' && !OnlineChatUI.isOpen()) return;
      close(true);
    }, 380);
  }

  /**
   * 构建一张好友联系人卡片。
   * 结构与助手卡片同构（圆形头像 + 名称 + 状态码行），沿用同一套 CSS 类，
   * 保证两种卡片在同一列表里视觉一致。
   */
  function buildFriendCard(contact) {
    const card = document.createElement('div');
    card.className = 'online-contact-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-contact-id', contact.id);
    card.setAttribute('aria-label', `与${contact.displayName}对话`);

    const serial = normalizeSerialForSearch(contact.serial);
    // 副本阵营角色不在溯流编制内，没有编号，显示副本频段标识
    const statusCode = (contact.camp === 'instance' || !serial)
      ? 'FORK LINK // 副本频段'
      : `NO.${serial}`;

    card.innerHTML = `
      <div class="online-contact-avatar-stage">
        <div class="online-contact-avatar-ph">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
          </svg>
        </div>
      </div>
      <div class="online-contact-meta">
        <div class="online-contact-name">${escapeHtml(contact.displayName)}</div>
        <div class="online-contact-status-row">
          <span class="online-status-code">${escapeHtml(statusCode)}</span>
        </div>
      </div>
    `;

    // 异步补真实立绘，无图时保留机能 SVG 兜底
    if (contact.avatarKey && window.Storage && typeof Storage.getAssetSrc === 'function') {
      Storage.getAssetSrc(contact.avatarKey).then((src) => {
        if (!src) return;
        const stage = card.querySelector('.online-contact-avatar-stage');
        if (!stage) return;
        const img = document.createElement('img');
        img.className = 'online-contact-avatar-img';
        img.alt = '';
        img.src = src;
        stage.innerHTML = '';
        stage.appendChild(img);
      }).catch(() => {});
    }

    const enter = () => openPrivateChat(contact);
    card.addEventListener('click', enter);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        enter();
      }
    });

    return card;
  }

  /**
   * 把好友列表铺进指定容器。
   * 只清掉旧的好友卡片，不动容器里的空态卡等固定元素——
   * 直接 innerHTML='' 会连空态卡一起抹掉，之后就再也显示不出来了。
   */
  function fillFriendCards(container, list) {
    if (!container) return;
    container.querySelectorAll('.online-contact-card:not(.is-system)').forEach((el) => el.remove());
    list.forEach((c) => container.appendChild(buildFriendCard(c)));
  }


  /** 切换联系人顶部小 Tab (分组 / 好友 / 群聊) */
  function switchContactsSubtab(subtabKey) {
    if (!contactsSubviews[subtabKey]) return;
    currentContactsSubtab = subtabKey;

    if (contactsSubnav) {
      const items = contactsSubnav.querySelectorAll('.online-subnav-item');
      items.forEach((btn) => {
        const key = btn.getAttribute('data-subtab');
        if (key === subtabKey) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        } else {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        }
      });
    }

    Object.keys(contactsSubviews).forEach((key) => {
      const view = contactsSubviews[key];
      if (!view) return;
      if (key === subtabKey) {
        view.hidden = false;
        view.classList.remove('is-entering');
        void view.offsetWidth;
        view.classList.add('is-entering');
      } else {
        view.hidden = true;
      }
    });
  }

  /** 获取当前激活的系统助手对象（代号、id、头像） */
  function getActiveAssistantInfo() {
    let asst = null;
    try {
      if (window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function') {
        asst = ResonanceUI.getActiveAssistant();
      }
    } catch (_) {}

    if (!asst && window.Store && Store.roster && Array.isArray(Store.roster.assistants)) {
      asst = Store.roster.assistants.find((a) => a && a.active) || Store.roster.assistants[0] || null;
    }

    const id = (asst && asst.id) ? asst.id : 'asst_system_core';
    const name = (asst && asst.name && String(asst.name).trim()) ? asst.name.trim() : '系统助手';
    return { id, name };
  }

  /** 渲染联系人名录（刷新系统助手卡片与全部好友统计） */
  async function renderContactsView() {
    const asst = getActiveAssistantInfo();
    if (asstNameEl) asstNameEl.textContent = asst.name;

    // 异步加载助手头像
    if (asstAvatarImg && asstAvatarPh) {
      let avatarSrc = null;
      if (window.Storage && window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.assistantAvatar === 'function') {
        try {
          avatarSrc = await Storage.getAssetSrc(DataRegistry.key.assistantAvatar(asst.id));
        } catch (_) {}
      }

      if (avatarSrc) {
        asstAvatarImg.src = avatarSrc;
        asstAvatarImg.hidden = false;
        asstAvatarPh.hidden = true;
      } else {
        asstAvatarImg.hidden = true;
        asstAvatarPh.hidden = false;
      }
    }

    // 好友名录：分组视图与好友平铺视图共用同一份数据
    let friendList = [];
    try {
      if (window.OnlineStore && typeof OnlineStore.listContacts === 'function') {
        friendList = OnlineStore.listContacts(selectedAccountId) || [];
      }
    } catch (_) {
      friendList = [];
    }

    fillFriendCards(friendsBody, friendList);
    fillFriendCards(friendFlatList, friendList);

    // 有好友时收起空态卡
    if (friendsEmptyCard) friendsEmptyCard.hidden = friendList.length > 0;
    if (friendFlatEmptyCard) friendFlatEmptyCard.hidden = friendList.length > 0;

    if (friendsCountEl) {
      // 在线判定尚未落地，分子先与总数持平，等在线态机制实装后替换
      friendsCountEl.textContent = `${friendList.length}/${friendList.length}`;
    }
  }

  /**
   * 折叠栏点击开合：切换 aria-expanded 并联动隐藏/显示 body
   */
  function setupGroupCollapsible() {
    const sections = document.querySelectorAll('.online-group-section');
    sections.forEach((sec) => {
      const header = sec.querySelector('.online-group-header');
      const body = sec.querySelector('.online-group-body');
      if (!header || !body) return;

      header.addEventListener('click', () => {
        const isExpanded = header.getAttribute('aria-expanded') === 'true';
        const nextState = !isExpanded;
        header.setAttribute('aria-expanded', String(nextState));
        body.hidden = !nextState;
      });
    });
  }

  /**
   * 显示主通讯面板 (登录成功后滑入)
   */
  function showMainView(defaultTab = 'chats') {
    currentMode = 'main';
    stopBrandLog();

    if (regPanel) {
      regPanel.hidden = true;
      regPanel.classList.remove('is-entering');
    }
    if (loginPanel) {
      loginPanel.hidden = true;
      loginPanel.classList.remove('is-entering');
    }
    if (mainPanel) {
      mainPanel.hidden = false;
      mainPanel.classList.remove('is-entering');
      void mainPanel.offsetWidth;
      mainPanel.classList.add('is-entering');
    }

    switchTab(defaultTab);
  }

  /**
   * 退出接入：清除在线态并退回登录页。
   * 这是主界面唯一的返回登录页入口，缺了它主界面就是单向门。
   */
  async function handleLogout() {
    const active = (window.OnlineStore && typeof OnlineStore.getActiveAccount === 'function')
      ? OnlineStore.getActiveAccount()
      : null;
    const accName = (active && active.name) ? active.name : '当前账号';

    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        message: `确认要断开「${accName}」的通讯链路吗？`,
        detail: '退出后需重新输入凭证接入。通讯录、聊天记录与动态数据都会保留，不受影响。',
        confirmText: '确认退出',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    await OnlineStore.logout();
    if (window.Toast) Toast.show('已断开通讯链路', { type: 'info' });
    await showLoginView();
  }

  /* ---------------- 交互动作 ---------------- */

  async function handleRegister() {
    // 马甲账号必须先选定身份，这个校验要在昵称校验之前
    if (currentMode !== 'register-persona') {
      const available = getAvailableMasks();
      if (available.length === 0) {
        if (window.Toast) Toast.show('请先在马甲库创建一个马甲身份', { type: 'warn' });
        return;
      }
      if (!selectedMaskId || !available.some((m) => m.id === selectedMaskId)) {
        if (window.Toast) Toast.show('请选择要使用的马甲身份', { type: 'warn' });
        return;
      }
    }

    const name = regNameInput ? regNameInput.value.trim() : '';
    if (!name) {
      if (window.Toast) Toast.show('请输入在线昵称', { type: 'warn' });
      return;
    }

    const password = regPwdInput ? regPwdInput.value.trim() : '';

    if (currentMode === 'register-persona') {
      // 注册本人账号
      // loggedIn 刻意写 false：注册完成后统一回到登录页走一次正常登录，
      // 否则设置了密码的账号会因为已在线而绕过密码校验。
      const states = (window.Store && Store.online && Store.online.accounts) || {};
      const nextStates = Object.assign({}, states, {
        persona: {
          registered: true,
          registeredAt: Date.now(),
          password,
          nickname: name,
          loggedIn: false,
          lastActiveAt: Date.now()
        }
      });
      await Store.save('online.accounts', nextStates);

      // 保存专属头像
      if (tempAvatarFile) {
        await Storage.setAsset(DataRegistry.key.onlineAccountAvatar('persona'), tempAvatarFile);
      }

      if (window.Toast) Toast.show('注册账号成功，请登录接入', { type: 'success' });
      selectedAccountId = 'persona';
      await showLoginView();
    } else {
      // 马甲账号：绑定马甲库中已存在的身份，不再新建马甲档案
      const mask = getAvailableMasks().find((m) => m.id === selectedMaskId);
      if (!mask) {
        if (window.Toast) Toast.show('所选马甲身份已失效，请重新选择', { type: 'warn' });
        await renderIdentityPicker();
        return;
      }

      const accountNo = getMaskAccountNo(mask);

      // 写入账号态（账号 id 即马甲 id）
      // loggedIn 同本人账号，注册后回登录页正常登录，不绕过密码校验
      const states = (window.Store && Store.online && Store.online.accounts) || {};
      const nextStates = Object.assign({}, states, {
        [mask.id]: {
          registered: true,
          registeredAt: Date.now(),
          password,
          nickname: name,
          loggedIn: false,
          lastActiveAt: Date.now()
        }
      });
      await Store.save('online.accounts', nextStates);

      // 保存马甲账号专属头像
      if (tempAvatarFile) {
        await Storage.setAsset(DataRegistry.key.onlineAccountAvatar(mask.id), tempAvatarFile);
      }

      if (window.Toast) Toast.show(`马甲账号 ${accountNo} 创建成功`, { type: 'success' });
      selectedAccountId = mask.id;
      selectedMaskId = null;
      await showLoginView();
    }
  }

  async function handleLogin() {
    if (!selectedAccountId) {
      if (window.Toast) Toast.show('请选择要登录的账号', { type: 'warn' });
      return;
    }

    // 密码校验：只有注册时设置过密码的账号才需要验证，未设置的照旧免密登录。
    // 这一步必须在按钮进入加载态之前完成，否则校验失败会留下一个卡住的按钮。
    const inputPwd = loginPwdInput ? loginPwdInput.value.trim() : '';
    const needPwd = accountNeedsPwd(selectedAccountId);

    if (needPwd) {
      if (!inputPwd) {
        showLoginPwdError('请输入访问密码后再接入');
        if (loginPwdInput) loginPwdInput.focus();
        return;
      }
      if (!OnlineStore.verifyPassword(selectedAccountId, inputPwd)) {
        showLoginPwdError('密码错误，请重新输入');
        if (loginPwdInput) {
          loginPwdInput.value = '';
          loginPwdInput.focus();
        }
        return;
      }
    }

    // 演出动画：按钮高频呼吸
    if (doLoginBtn) {
      doLoginBtn.disabled = true;
      const span = doLoginBtn.querySelector('span');
      if (span) span.textContent = '正在接入神经链路...';
    }

    const res = await OnlineStore.login(selectedAccountId, inputPwd);

    // 兜底：Store 层校验未通过时复位按钮，不推进主界面
    if (res && res.ok === false) {
      if (doLoginBtn) {
        doLoginBtn.disabled = false;
        const span = doLoginBtn.querySelector('span');
        if (span) span.textContent = '登录';
      }
      showLoginPwdError(res.reason === 'wrong_password' ? '密码错误，请重新输入' : '账号已失效，请重新选择');
      return;
    }

    setTimeout(() => {
      if (doLoginBtn) {
        doLoginBtn.disabled = false;
        const span = doLoginBtn.querySelector('span');
        if (span) span.textContent = '登录';
      }
      if (loginPwdInput) loginPwdInput.value = '';
      if (window.Toast) Toast.show('登录成功', { type: 'success' });
      // 滑入线上聊天主界面 (四 Tab 容器，默认定位在消息 Tab)
      showMainView('chats');
    }, 450);
  }

  /* ---------------- 密码可见性切换 ---------------- */

  function setupPwdToggle(btn, input) {
    if (!btn || !input) return;
    btn.addEventListener('click', () => {
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      const openSvg = btn.querySelector('.pwd-eye-open');
      const closedSvg = btn.querySelector('.pwd-eye-closed');
      if (openSvg && closedSvg) {
        openSvg.hidden = !isPwd;
        closedSvg.hidden = isPwd;
      }
    });
  }

  /* ---------------- 头像上传（接入通用 ImagePicker 弹窗，支持本地文件与 URL） ---------------- */

  function setupAvatarUpload() {
    if (!regAvatarStage) return;
    regAvatarStage.addEventListener('click', () => {
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
        if (regAvatarInput) regAvatarInput.click();
        return;
      }

      ImagePicker.open({
        title: '更换账号头像',
        onSelect: async (res) => {
          if (!res) return;
          try {
            if (res.type === 'file' && res.file) {
              const compressed = await Storage.compressImage(res.file, 800, 0.88);
              avatarTouchedByUser = true;
              tempAvatarFile = compressed;
              if (tempAvatarSrc && tempAvatarSrc.startsWith('blob:')) {
                URL.revokeObjectURL(tempAvatarSrc);
              }
              tempAvatarSrc = URL.createObjectURL(compressed);
              if (regAvatarImg && regAvatarPh) {
                regAvatarImg.src = tempAvatarSrc;
                regAvatarImg.hidden = false;
                regAvatarPh.hidden = true;
              }
            } else if (res.type === 'url' && res.url) {
              // 远端 URL：fetch 转成 Blob 压缩保存，若跨域受阻则直接展示
              try {
                const resp = await fetch(res.url);
                if (resp.ok) {
                  const blob = await resp.blob();
                  const compressed = await Storage.compressImage(blob, 800, 0.88);
                  avatarTouchedByUser = true;
                  tempAvatarFile = compressed;
                  if (tempAvatarSrc && tempAvatarSrc.startsWith('blob:')) {
                    URL.revokeObjectURL(tempAvatarSrc);
                  }
                  tempAvatarSrc = URL.createObjectURL(compressed);
                } else {
                  avatarTouchedByUser = true;
                  tempAvatarFile = res.url;
                  tempAvatarSrc = res.url;
                }
              } catch (_) {
                avatarTouchedByUser = true;
                tempAvatarFile = res.url;
                tempAvatarSrc = res.url;
              }

              if (regAvatarImg && regAvatarPh) {
                regAvatarImg.src = tempAvatarSrc;
                regAvatarImg.hidden = false;
                regAvatarPh.hidden = true;
              }
            }
          } catch (err) {
            console.warn('[OnlineUI] 处理头像失败:', err);
            if (window.Toast) Toast.show('头像处理失败，请重试', { type: 'warn' });
          }
        }
      });
    });

    // 仍保留隐藏 input 的兜底监听
    if (regAvatarInput) {
      regAvatarInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const compressed = await Storage.compressImage(file, 800, 0.88);
          avatarTouchedByUser = true;
          tempAvatarFile = compressed;
          if (tempAvatarSrc && tempAvatarSrc.startsWith('blob:')) {
            URL.revokeObjectURL(tempAvatarSrc);
          }
          tempAvatarSrc = URL.createObjectURL(compressed);
          if (regAvatarImg && regAvatarPh) {
            regAvatarImg.src = tempAvatarSrc;
            regAvatarImg.hidden = false;
            regAvatarPh.hidden = true;
          }
        } catch (err) {
          console.warn('[OnlineUI] 压缩头像失败:', err);
        }
        regAvatarInput.value = '';
      });
    }
  }

  /* ---------------- 打开 / 关闭 ---------------- */

  function open() {
    if (isOpen) return;
    isOpen = true;

    if (pageEl) {
      pageEl.classList.add('active');
      pageEl.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.add('keyboard-hidden');

    try {
      history.pushState({ rfPage: 'online' }, '', '#online');
    } catch (_) {}

    // 判断呈现注册、登录还是已登录的主界面
    if (!isPersonaRegistered()) {
      showRegisterView('register-persona');
    } else {
      const active = (window.OnlineStore && typeof OnlineStore.getActiveAccount === 'function')
        ? OnlineStore.getActiveAccount()
        : null;
      if (active) {
        showMainView('chats');
      } else {
        showLoginView();
      }
    }
  }

  function close(fromPopState = false) {
    if (!isOpen) return;
    isOpen = false;

    // 页面收起后停掉日志定时器，避免后台空转
    stopBrandLog();

    if (pageEl) {
      // 若还带着底衬抑制类，必须一并摘掉：
      // 该类的 !important 会强制页面可见，残留会让列表页卡在屏幕上收不回去
      pageEl.classList.remove('is-instant-backdrop');
      pageEl.classList.remove('active');
      pageEl.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.remove('keyboard-hidden');

    if (!fromPopState) {
      const hash = window.location.hash || '';
      if (hash === '#online') {
        try {
          history.back();
        } catch (_) {
          window.location.hash = '';
        }
      }
    }
  }

  /**
   * 纯视图恢复：把线上联络页重新显示出来，不压历史条目、不重跑登录态判定。
   * 与 SystemChatUI.reveal() 对称，供从系统聊天页返回时把本页作为底层复位使用。
   * 之所以不能直接复用 open()：open() 会再 pushState 一次并重跑视图分发，
   * 从聊天页返回时历史栈里 #online 那层还在，重复压栈会让返回键需要多按一次。
   *
   * @param {boolean} [instant] 瞬时就位，不播进场过渡。
   *   上层页正要滑走时必须传 true：本页若也走 translateX 过渡，
   *   两页并行滑动的那几帧都不满屏，桌面会从缝里露出来。
   *   此时本页只是静态背景板，不该有自己的进场动画。
   */
  function reveal(instant) {
    if (isOpen) return;
    isOpen = true;

    if (pageEl) {
      if (instant) {
        // 先落到终态再显示，避免从 translateX(100%) 滑入
        pageEl.classList.add('is-instant-backdrop');
        pageEl.classList.add('active');
        pageEl.setAttribute('aria-hidden', 'false');
        // 强制 reflow 让无过渡的终态立即生效，之后再摘掉抑制类，
        // 使本页后续的正常开关动画不受影响
        void pageEl.offsetWidth;
        setTimeout(() => {
          if (pageEl) pageEl.classList.remove('is-instant-backdrop');
        }, 420);
      } else {
        pageEl.classList.add('active');
        pageEl.setAttribute('aria-hidden', 'false');
      }
    }
    document.body.classList.add('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.add('keyboard-hidden');

    // 回到消息 Tab 并刷新会话列表，让摘要与时间戳反映刚才的对话
    if (currentMode === 'main') {
      renderChatsView();
    }
  }

  /* ---------------- 初始化与事件绑定 ---------------- */

  function init() {
    // 返回按钮
    if (loginBackBtn) loginBackBtn.addEventListener('click', () => close());
    if (mainBackBtn) mainBackBtn.addEventListener('click', () => close());
    if (regBackBtn) {
      regBackBtn.addEventListener('click', () => {
        if (isPersonaRegistered()) {
          showLoginView();
        } else {
          close();
        }
      });
    }

    // 底部 TabBar 点击事件委托
    if (tabBar) {
      tabBar.addEventListener('click', (e) => {
        const item = e.target.closest('.online-tab-item');
        if (!item) return;
        const targetTab = item.getAttribute('data-tab');
        if (targetTab && targetTab !== currentTab) {
          switchTab(targetTab);
        }
      });
    }

    // 联系人顶部小 Tab 点击事件委托 (分组 / 好友 / 群聊)
    if (contactsSubnav) {
      contactsSubnav.addEventListener('click', (e) => {
        const item = e.target.closest('.online-subnav-item');
        if (!item) return;
        const subtab = item.getAttribute('data-subtab');
        if (subtab && subtab !== currentContactsSubtab) {
          switchContactsSubtab(subtab);
        }
      });
    }

    // 联系人分组折叠交互
    setupGroupCollapsible();

    // 退出接入（「我的」Tab 内）
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    // 重新输入密码时清除错误提示，避免红字一直挂着
    if (loginPwdInput) {
      loginPwdInput.addEventListener('input', () => {
        if (loginPwdHint && loginPwdHint.classList.contains('is-error')) {
          const acc = (window.OnlineStore && typeof OnlineStore.getAccount === 'function')
            ? OnlineStore.getAccount(selectedAccountId)
            : null;
          resetLoginPwdHint(acc || { id: selectedAccountId });
        }
      });
    }

    // 主面板顶栏操作按钮 (联系人 Tab 下唤起搜索/添加页面)
    if (mainActionBtn) {
      mainActionBtn.addEventListener('click', () => {
        if (currentTab === 'contacts') {
          openSearchPanel();
        } else if (currentTab === 'chats') {
          // 消息 Tab 点击发起通讯，后续接创建新会话，目前先也引导打开搜索添加联系人
          openSearchPanel();
        }
      });
    }

    // 搜索页返回与关闭
    if (searchBackBtn) {
      searchBackBtn.addEventListener('click', closeSearchPanel);
    }

    // 验证消息弹窗交互
    if (verifyBackBtn) verifyBackBtn.addEventListener('click', closeVerifyModal);
    if (verifyCancelBtn) verifyCancelBtn.addEventListener('click', closeVerifyModal);
    if (verifyConfirmBtn) verifyConfirmBtn.addEventListener('click', handleSendFriendRequest);

    // 遮罩点击关闭
    if (verifyOverlay) {
      verifyOverlay.addEventListener('click', (e) => {
        if (e.target === verifyOverlay) closeVerifyModal();
      });
    }

    // 验证消息输入与字数统计
    if (verifyMsgInput) {
      verifyMsgInput.addEventListener('input', () => {
        const len = verifyMsgInput.value.length;
        if (verifyCounter) {
          verifyCounter.textContent = `${len} / 50`;
        }
      });
      // 支持 Ctrl+Enter 或 Command+Enter 发送
      verifyMsgInput.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          handleSendFriendRequest();
        }
      });
    }

    // 搜索页顶部 Tab 切换 (执行员 / 群聊)
    if (searchTabs) {
      searchTabs.addEventListener('click', (e) => {
        const item = e.target.closest('.online-search-tab-item');
        if (!item) return;
        const target = item.getAttribute('data-search-tab');
        if (target && target !== currentSearchTab) {
          switchSearchTab(target);
        }
      });
    }

    // 搜索输入监听与清空按钮显隐
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const val = searchInput.value.trim();
        if (searchClearBtn) {
          searchClearBtn.hidden = !val;
        }

        // 120ms 防抖：避免每敲一个字都全量重排 DOM
        if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          searchDebounceTimer = null;
          if (currentSearchTab === 'envoy') {
            runEnvoySearch(searchInput.value);
          }
        }, 120);
      });
    }

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        if (searchInput) {
          searchInput.value = '';
          searchInput.focus();
        }
        searchClearBtn.hidden = true;
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = null;
        }
        // 回到本轮推荐名单，不重新洗牌
        if (currentSearchTab === 'envoy') {
          runEnvoySearch('');
        }
      });
    }

    // 添加账号按钮
    if (addAccountBtn) {
      addAccountBtn.addEventListener('click', () => {
        showRegisterView('register-mask');
      });
    }

    // 注册与登录
    if (doRegisterBtn) doRegisterBtn.addEventListener('click', handleRegister);
    if (doLoginBtn) doLoginBtn.addEventListener('click', handleLogin);

    // 账号栏点击切换账号（通用单选面板）
    if (loginAccountPicker) {
      loginAccountPicker.addEventListener('click', pickLoginAccount);
      loginAccountPicker.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickLoginAccount();
        }
      });
    }

    // 马甲身份行点击选择身份
    if (regIdentityRow) {
      regIdentityRow.addEventListener('click', pickMaskIdentity);
      regIdentityRow.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickMaskIdentity();
        }
      });
    }

    // 空态引导：跳转马甲库新建马甲
    if (regGoCreateMaskBtn) {
      regGoCreateMaskBtn.addEventListener('click', goCreateMask);
    }

    // 密码显隐
    setupPwdToggle(regPwdToggle, regPwdInput);
    setupPwdToggle(loginPwdToggle, loginPwdInput);

    // 头像上传
    setupAvatarUpload();

    // 监听 Hash 路由
    window.addEventListener('popstate', (e) => {
      const state = e.state || {};
      if (isOpen && state.rfPage !== 'online' && window.location.hash !== '#online') {
        close(true);
      } else if (!isOpen && (state.rfPage === 'online' || window.location.hash === '#online')) {
        // 从系统聊天页返回时 #online 这层历史还在，走 reveal 纯视图复位，
        // 不能用 open()——它会再压一次历史并重跑登录态分发。
        reveal();
      }
    });
  }

  if (window.Boot && typeof Boot.onReady === 'function') {
    Boot.onReady('onlineUI', init);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  return {
    init,
    open,
    close,
    reveal,
    isOpen: () => isOpen,
    showRegisterView,
    showLoginView,
    showMainView,
    switchTab,
    formatAccountSerial,
    getNextMaskSerialInfo
  };
})();

window.OnlineUI = OnlineUI;
