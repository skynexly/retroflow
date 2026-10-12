/**
 * 溯流计划 · 系统助理悬浮随行中枢 (System Chat Tactical Orb & Mini HUD Controller)
 * 1. 管理随行悬浮球 (Orb)：全站最高层级、自由拖拽、微吸附停靠、iOS 灵动岛安全区保护。
 * 2. 管理 Mini HUD 浮窗：从悬浮球展开为浮空副屏视窗，支持拖拽把手、最小化折叠、最大化展开全屏。
 * 3. 三态无缝联动：Orb (悬浮球) ↔ Mini HUD (小浮窗) ↔ Full View (全屏沉浸态)。
 * 4. 零代码冗余：小窗口直接作为 SystemChatUI 的紧凑视图，共享消息流、输入槽、长按气泡菜单与加号面板。
 */
(() => {
  'use strict';

  // 状态机定义
  const STATE = {
    HIDDEN: 'hidden',
    ORB: 'orb',
    MINI: 'mini',
    FULL: 'full'
  };

  const STORAGE_KEY_POS = 'retroflow_sys_chat_orb_pos_v1';
  const STORAGE_KEY_HUD_POS = 'retroflow_sys_chat_hud_pos_v1';
  /** 悬浮球启用开关（执行员可在助手设置页关掉随行中枢） */
  const STORAGE_KEY_ENABLED = 'retroflow_sys_chat_orb_enabled_v1';
  /** 悬浮球美化调校（尺寸 / 边框开关；皮肤图本体走 decor 域资产键） */
  const STORAGE_KEY_SKIN = 'retroflow_sys_chat_orb_skin_v1';

  let orbEl = null;
  let chatPage = null;
  let chatHeader = null;
  let headerCenter = null;
  let minimizeBtn = null;
  let windowSizeBtn = null;

  let currentState = STATE.ORB; // 默认挂载悬浮球
  let isDraggingOrb = false;
  let orbDragStartX = 0;
  let orbDragStartY = 0;
  let orbStartLeft = 0;
  let orbStartTop = 0;
  let orbHasMoved = false;
  /** 按下瞬间的球体实时宽高（美化滑杆可放大到 400%，拖拽钳制随尺寸走） */
  let orbDragW = 48;
  let orbDragH = 48;

  let isDraggingHud = false;
  let hudDragStartX = 0;
  let hudDragStartY = 0;
  let hudStartLeft = 0;
  let hudStartTop = 0;

  /** 悬浮球是否启用（默认开启；关掉后球不出现，大窗也不显示缩小/最小化键） */
  let orbEnabled = true;
  /**
   * 本中枢自己压进主路由栈的 #system-chat 桩是否还在。
   *
   * 不能靠 `location.hash === '#system-chat'` 反推 —— 小窗浮在副本编纂页上时
   * hash 可能本来就是别人的，或者小窗压根没压桩。凭 hash 猜会退掉别人的历史条目，
   * 连带触发副本编纂 / 灯箱 / 同调档案的 popstate 自关或自愈重开。
   * 唯一可靠的依据是「我有没有压过」。
   */
  let orbPushedHistory = false;
  /** 进全屏前的 hash，缩回小窗时用 replaceState 原地改写回去（方案 A） */
  let hashBeforeFull = '';

  /** 读取悬浮球启用状态 */
  function loadOrbEnabled() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_ENABLED);
      // 从未设置过时默认开启
      orbEnabled = raw === null ? true : raw === '1';
    } catch (_) {
      orbEnabled = true;
    }
    return orbEnabled;
  }

  /** 写入悬浮球启用状态 */
  function saveOrbEnabled(enabled) {
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, enabled ? '1' : '0');
    } catch (_) {}
  }

  /* ---------------- 悬浮球美化（皮肤 / 尺寸 / 边框） ---------------- */

  /** 皮肤调校配置：scale 80~400（百分比），bordered 是否保留圆形裁切与底衬光环 */
  let skinCfg = { scale: 100, bordered: true };
  /** 皮肤图 objectURL 缓存（刷新时负责 revoke，防泄漏） */
  let skinNormalUrl = null;
  let skinDragUrl = null;

  function loadSkinCfg() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY_SKIN) || 'null');
      if (raw && typeof raw === 'object') {
        if (typeof raw.scale === 'number' && raw.scale >= 80 && raw.scale <= 400) {
          skinCfg.scale = raw.scale;
        }
        if (typeof raw.bordered === 'boolean') skinCfg.bordered = raw.bordered;
      }
    } catch (_) {}
    return skinCfg;
  }
  function saveSkinCfg() {
    try {
      localStorage.setItem(STORAGE_KEY_SKIN, JSON.stringify(skinCfg));
    } catch (_) {}
  }

  /** 确保球体内皮肤图层存在（常态 + 拖拽两张 img 叠放，交叉淡化切换） */
  function ensureSkinLayer() {
    if (!orbEl) return null;
    const core = orbEl.querySelector('.system-chat-orb-core');
    if (!core) return null;
    let layer = core.querySelector('.orb-skin-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'orb-skin-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = `
        <img class="orb-skin-img orb-skin-normal" alt="">
        <img class="orb-skin-img orb-skin-drag" alt="">`;
      core.appendChild(layer);
      // 裂图自愈：皮肤源加载失败（URL 链腐 / blob 被回收）时立即摘掉 src，
      // 不让浏览器在球体盒子左上角画裂图标记；
      // 常态图失败连带摘 has-skin 让罗盘芯回归，拖拽图失败静默回退共用常态图
      const normalImgEl = layer.querySelector('.orb-skin-normal');
      const dragImgEl = layer.querySelector('.orb-skin-drag');
      normalImgEl.addEventListener('error', () => {
        normalImgEl.removeAttribute('src');
        if (orbEl) orbEl.classList.remove('has-skin');
      });
      dragImgEl.addEventListener('error', () => {
        dragImgEl.removeAttribute('src');
      });
    }
    return layer;
  }

  /** 把球体当前位置钳回视口内（按实时尺寸，含灵动岛保护） */
  function clampOrbIntoViewport() {
    if (!orbEl || orbEl.classList.contains('is-hidden')) return;
    try {
      const rect = orbEl.getBoundingClientRect();
      const insets = getSafeAreaInsets();
      const w = rect.width || 48;
      const h = rect.height || 48;
      const maxLeft = Math.max(insets.left, window.innerWidth - insets.right - w);
      const maxTop = Math.max(insets.top, window.innerHeight - insets.bottom - h);
      const left = Math.min(Math.max(insets.left, rect.left), maxLeft);
      const top = Math.min(Math.max(insets.top, rect.top), maxTop);
      if (left !== rect.left || top !== rect.top) {
        orbEl.style.left = `${left}px`;
        orbEl.style.top = `${top}px`;
        saveOrbPosition(left, top);
      }
    } catch (_) {}
  }

  /** 把当前调校配置刷到球体（尺寸变量 / 无边框类） */
  function applySkinCfgToView() {
    if (!orbEl) return;
    orbEl.style.setProperty('--orb-scale', String(skinCfg.scale / 100));
    orbEl.classList.toggle('orb-borderless', !skinCfg.bordered);
    // 缩放后球体可能贴边溢出视口，按新尺寸重新钳位
    clampOrbIntoViewport();
  }

  /**
   * 重载皮肤图并重刷球体外观。
   * 有任一张皮肤图 → 隐藏默认罗盘芯、显示皮肤层；拖拽图缺省时两态共用常态图。
   * 对外暴露为 SystemChatOrb.refreshSkin()，美化页改完即时生效。
   */
  async function refreshSkin() {
    if (!orbEl) return;
    loadSkinCfg();
    applySkinCfgToView();
    const layer = ensureSkinLayer();
    if (!layer) return;
    const normalImg = layer.querySelector('.orb-skin-normal');
    const dragImg = layer.querySelector('.orb-skin-drag');
    // 释放旧 objectURL
    if (skinNormalUrl) { try { Storage.revokeAssetSrc(skinNormalUrl); } catch (_) {} skinNormalUrl = null; }
    if (skinDragUrl) { try { Storage.revokeAssetSrc(skinDragUrl); } catch (_) {} skinDragUrl = null; }
    let normalSrc = null;
    let dragSrc = null;
    try {
      if (window.Storage && window.DataRegistry) {
        normalSrc = await Storage.getAssetSrc(DataRegistry.key.orbSkinNormal());
        dragSrc = await Storage.getAssetSrc(DataRegistry.key.orbSkinDrag());
      }
    } catch (_) {}
    const hasSkin = Boolean(normalSrc);
    orbEl.classList.toggle('has-skin', hasSkin);
    if (!hasSkin) {
      if (normalImg) normalImg.removeAttribute('src');
      if (dragImg) dragImg.removeAttribute('src');
      return;
    }
    skinNormalUrl = normalSrc.startsWith('blob:') ? normalSrc : null;
    skinDragUrl = dragSrc && dragSrc.startsWith('blob:') ? dragSrc : null;
    if (normalImg) normalImg.src = normalSrc;
    // 拖拽图缺省 → 两态共用常态图（拖拽时仍有按压缩放反馈）
    if (dragImg) dragImg.src = dragSrc || normalSrc;
  }

  /**
   * 设置皮肤调校（尺寸 / 边框）并立即生效。
   * @param {{scale?: number, bordered?: boolean}} patch
   */
  function setSkinCfg(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (typeof patch.scale === 'number') {
      skinCfg.scale = Math.min(400, Math.max(80, Math.round(patch.scale)));
    }
    if (typeof patch.bordered === 'boolean') skinCfg.bordered = patch.bordered;
    saveSkinCfg();
    applySkinCfgToView();
  }

  /**
   * 把启用状态同步到视图：
   * 关闭时，大窗顶栏的控制键整组隐去（orb-disabled），避免点了没有去处。
   */
  function syncEnabledClass() {
    if (!chatPage) return;
    chatPage.classList.toggle('orb-disabled', !orbEnabled);
  }

  /**
   * 计算屏幕安全区（防穿入 iOS 灵动岛或掉出 Home 条）
   */
  function getSafeAreaInsets() {
    // 探测 CSS 环境变量或给保守默认值
    const safeTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top') || '0', 10) || 24;
    const safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0', 10) || 20;
    return {
      top: Math.max(safeTop, 20),
      bottom: Math.max(safeBottom, 16),
      left: 10,
      right: 10
    };
  }

  /**
   * 初始化 DOM 元素与注入控制按钮
   */
  function initDOM() {
    orbEl = document.getElementById('systemChatOrb');
    chatPage = document.getElementById('systemChatPage');
    chatHeader = chatPage ? chatPage.querySelector('.system-chat-header') : null;
    headerCenter = chatHeader ? chatHeader.querySelector('.chat-header-center') : null;

    if (!orbEl || !chatPage || !chatHeader) return;

    // 先读启用状态，后续建视图与状态流转都依赖它
    loadOrbEnabled();

    // 注入顶栏操作按钮组：最小化回球 (MINIMIZE)、最大化/缩小 (EXPAND/RESTORE)
    injectHeaderControls();

    // 绑定悬浮球拖拽与点击
    bindOrbEvents();

    // 绑定 Mini HUD 顶栏拖拽把手
    bindHudDragEvents();

    // 恢复悬浮球与浮窗历史位置
    restorePositions();

    // 初始态：开了就挂球，关了就彻底隐身
    applyState(orbEnabled ? STATE.ORB : STATE.HIDDEN);

    // 异步加载皮肤图（有则换装，无则保持默认罗盘芯）
    refreshSkin();
  }

  /**
   * 动态向顶栏注入纯 SVG 机能控制键（零 Emoji，严禁单边分割线）
   */
  function injectHeaderControls() {
    if (chatHeader.querySelector('.chat-hud-ctrl-group')) return;

    const group = document.createElement('div');
    group.className = 'chat-hud-ctrl-group';
    group.innerHTML = `
      <!-- 最小化折叠回球 (纯 SVG 收纳符号) -->
      <button type="button" class="chat-hud-btn chat-hud-btn-min" id="systemChatHudMinBtn" aria-label="收起为悬浮球" title="收起为悬浮球">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 13H5v-2h14v2z"/>
        </svg>
      </button>
      <!-- 最大化 / 还原小窗切换键 (纯 SVG 机能方角) -->
      <button type="button" class="chat-hud-btn chat-hud-btn-size" id="systemChatHudSizeBtn" aria-label="最大化/小窗切换" title="切换全屏或小窗">
        <svg class="icon-expand" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
        <svg class="icon-restore" viewBox="0 0 24 24" aria-hidden="true" style="display:none;">
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z"/>
        </svg>
      </button>
    `;

    // 插入到顶栏右侧菜单按钮之前
    const menuBtn = document.getElementById('systemChatMenuBtn');
    if (menuBtn && menuBtn.parentNode) {
      menuBtn.parentNode.insertBefore(group, menuBtn);
    } else {
      chatHeader.appendChild(group);
    }

    minimizeBtn = document.getElementById('systemChatHudMinBtn');
    windowSizeBtn = document.getElementById('systemChatHudSizeBtn');

    if (minimizeBtn) {
      minimizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toOrb();
      });
    }

    if (windowSizeBtn) {
      windowSizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentState === STATE.MINI) {
          toFull();
        } else if (currentState === STATE.FULL) {
          toMini();
        }
      });
    }
  }

  /**
   * 恢复历史坐标
   */
  function restorePositions() {
    try {
      const orbPos = JSON.parse(localStorage.getItem(STORAGE_KEY_POS) || 'null');
      if (orbPos && typeof orbPos.left === 'number' && typeof orbPos.top === 'number') {
        const insets = getSafeAreaInsets();
        // 钳制余量随美化尺寸走（refreshSkin 里还会按实时 rect 二次校正）
        loadSkinCfg();
        const orbSize = Math.round(48 * (skinCfg.scale / 100)) + 8;
        const maxLeft = Math.max(insets.left, window.innerWidth - insets.right - orbSize);
        const maxTop = Math.max(insets.top, window.innerHeight - insets.bottom - orbSize);
        const left = Math.min(Math.max(insets.left, orbPos.left), maxLeft);
        const top = Math.min(Math.max(insets.top, orbPos.top), maxTop);
        orbEl.style.left = `${left}px`;
        orbEl.style.top = `${top}px`;
      }
    } catch (_) {}

    try {
      const hudPos = JSON.parse(localStorage.getItem(STORAGE_KEY_HUD_POS) || 'null');
      if (hudPos && typeof hudPos.left === 'number' && typeof hudPos.top === 'number') {
        chatPage.style.setProperty('--hud-custom-left', `${hudPos.left}px`);
        chatPage.style.setProperty('--hud-custom-top', `${hudPos.top}px`);
      }
    } catch (_) {}
  }

  /**
   * 保存悬浮球位置
   */
  function saveOrbPosition(left, top) {
    try {
      localStorage.setItem(STORAGE_KEY_POS, JSON.stringify({ left, top }));
    } catch (_) {}
  }

  /**
   * 保存浮窗位置
   */
  function saveHudPosition(left, top) {
    try {
      localStorage.setItem(STORAGE_KEY_HUD_POS, JSON.stringify({ left, top }));
    } catch (_) {}
  }

  /**
   * 状态流转执行器。
   *
   * 关键：body.page-active 必须按态显式收尾。
   * 它带着 `.desktop-viewport { filter: blur(1.5px); pointer-events: none }`，
   * 一旦残留，收回悬浮球后桌面就是糊的且点不动 —— 只有全屏态才该挂它。
   */
  function applyState(nextState) {
    currentState = nextState;
    if (!orbEl || !chatPage) return;
    // 任何形态切换（收球/开小窗/全屏/隐藏）都先把指令环与状态浮卡收干净
    closeRadialMenu();

    const expandIcon = windowSizeBtn ? windowSizeBtn.querySelector('.icon-expand') : null;
    const restoreIcon = windowSizeBtn ? windowSizeBtn.querySelector('.icon-restore') : null;
    const body = document.body;

    if (nextState === STATE.ORB) {
      // 球态：聊天视图完全收起，桌面必须恢复清晰可操作
      orbEl.classList.toggle('is-hidden', !orbEnabled);
      chatPage.classList.remove('active', 'mode-mini', 'mode-full');
      chatPage.hidden = true;
      chatPage.setAttribute('aria-hidden', 'true');
      body.classList.remove('system-chat-mini-active');
      body.classList.remove('page-active');
    } else if (nextState === STATE.MINI) {
      // 小窗态：球保留在屏（全站中枢不失踪），开环时助手钮置灰；
      // 桌面保持可操作（浮窗只是副屏，不接管整屏）
      orbEl.classList.toggle('is-hidden', !orbEnabled);
      chatPage.hidden = false;
      chatPage.setAttribute('aria-hidden', 'false');
      chatPage.classList.remove('mode-full');
      chatPage.classList.add('active', 'mode-mini');
      body.classList.add('system-chat-mini-active');
      body.classList.remove('page-active');
      if (expandIcon) expandIcon.style.display = 'block';
      if (restoreIcon) restoreIcon.style.display = 'none';
      if (window.SystemChatUI && typeof SystemChatUI.syncHeaderIdentity === 'function') {
        SystemChatUI.syncHeaderIdentity();
      }
    } else if (nextState === STATE.FULL) {
      // 全屏态：接管整屏，底层桌面做景深退避；
      // 球仍保留（z-index 16000 压过助手视图 920），开环时助手钮置灰，
      // 日志速览 / 档案卡可盖在助手上方就地查看
      orbEl.classList.toggle('is-hidden', !orbEnabled);
      chatPage.hidden = false;
      chatPage.setAttribute('aria-hidden', 'false');
      chatPage.classList.remove('mode-mini');
      chatPage.classList.add('active', 'mode-full');
      body.classList.remove('system-chat-mini-active');
      body.classList.add('page-active');
      if (expandIcon) expandIcon.style.display = 'none';
      if (restoreIcon) restoreIcon.style.display = 'block';
    } else if (nextState === STATE.HIDDEN) {
      // 彻底隐藏：球与视图都收走，桌面复原
      orbEl.classList.add('is-hidden');
      chatPage.classList.remove('active', 'mode-mini', 'mode-full');
      chatPage.hidden = true;
      chatPage.setAttribute('aria-hidden', 'true');
      body.classList.remove('system-chat-mini-active');
      body.classList.remove('page-active');
    }

    syncEnabledClass();
  }

  /**
   * 释放本中枢压过的那条路由桩。
   *
   * 关键：用 replaceState 原地改写回进全屏前的 hash，绝不用 back()。
   * back() 会触发 popstate，而下层的副本编纂 / 同调档案 / 灯箱等监听多半是
   * 无条件 close() 或 `hash 匹配就 open()` 的自愈分支，一退就会被误伤。
   * 代价是栈里留一条等效条目，下层页面的返回键极端情况下要多按一次 —— 可接受。
   */
  function releaseHistoryStub() {
    if (!orbPushedHistory) return;
    orbPushedHistory = false;
    try {
      history.replaceState(
        { rfPage: 'system-chat-detached' },
        '',
        hashBeforeFull || location.pathname
      );
    } catch (_) {}
  }

  function toOrb() {
    // 先把形态切到球态：popstate 的判定依赖 chatPage 是否还带 active，
    // 先切态能让后续的路由收尾不被当成用户手势返回去走 dismiss 流程
    applyState(orbEnabled ? STATE.ORB : STATE.HIDDEN);
    // 从悬浮球直接展开的小窗压根没压桩（open 走 skipHistory），这里一步都不会动。
    // 只有全屏态压过桩时才需要收尾。
    releaseHistoryStub();
  }

  /**
   * 切到小窗态。
   * 从球展开时要走一次 SystemChatUI.open() 把对话与流水准备好；
   * 从全屏缩回时视图已就绪，只切形态，避免重复推路由与重载历史。
   */
  function toMini() {
    const wasActive = chatPage && chatPage.classList.contains('active');
    // 从全屏缩回小窗：把全屏那条桩原地改写掉，小窗不占主路由栈
    if (wasActive) releaseHistoryStub();
    applyState(STATE.MINI);
    if (!wasActive && window.SystemChatUI && typeof SystemChatUI.open === 'function') {
      // skipHistory：小窗不进主路由栈，详见 system-chat-ui.js 的 open()
      SystemChatUI.open({ skipHistory: true });
      // open() 内部会按全屏逻辑收尾，这里强制钉回小窗形态与 body 状态
      chatPage.classList.remove('mode-full');
      chatPage.classList.add('mode-mini');
      document.body.classList.remove('page-active');
    }
  }

  function toFull() {
    // 从小窗放大进全屏：此时要接管整屏与手势返回，得压一条自己的桩。
    // 记下进全屏前的 hash，缩回小窗或收回球态时用它把路由原地改写回去。
    if (!orbPushedHistory) {
      hashBeforeFull = window.location.hash || '';
      try {
        history.pushState({ rfPage: 'system-chat' }, '', '#system-chat');
        orbPushedHistory = true;
      } catch (_) {}
    }
    applyState(STATE.FULL);
  }

  /**
   * 绑定悬浮球的拖拽与吸附逻辑
   */
  function bindOrbEvents() {
    if (!orbEl) return;

    const onPointerDown = (e) => {
      isDraggingOrb = true;
      orbHasMoved = false;
      orbDragStartX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      orbDragStartY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      const rect = orbEl.getBoundingClientRect();
      orbStartLeft = rect.left;
      orbStartTop = rect.top;
      // 拖拽期间球的实时尺寸（美化滑杆最大 400%，边界钳制不能再写死 50）
      orbDragW = rect.width || 48;
      orbDragH = rect.height || 48;
      orbEl.classList.add('is-dragging');
      window.addEventListener('pointermove', onPointerMove, { passive: false });
      window.addEventListener('pointerup', onPointerUp, { passive: false });
      window.addEventListener('touchmove', onPointerMove, { passive: false });
      window.addEventListener('touchend', onPointerUp, { passive: false });
    };

    const onPointerMove = (e) => {
      if (!isDraggingOrb) return;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      const dx = clientX - orbDragStartX;
      const dy = clientY - orbDragStartY;

      if (!orbHasMoved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        orbHasMoved = true;
        // 拖走即收起指令环与状态浮卡
        closeRadialMenu();
      }

      if (orbHasMoved) {
        if (e.cancelable) e.preventDefault();
        const insets = getSafeAreaInsets();
        const newLeft = orbStartLeft + dx;
        const newTop = orbStartTop + dy;
        // 限制在视口内（含灵动岛保护）；钳制余量取按下瞬间的实时尺寸
        const clampedTop = Math.min(Math.max(insets.top, newTop), window.innerHeight - insets.bottom - orbDragH);
        const clampedLeft = Math.min(Math.max(insets.left, newLeft), window.innerWidth - insets.right - orbDragW);
        orbEl.style.left = `${clampedLeft}px`;
        orbEl.style.top = `${clampedTop}px`;
      }
    };

    const onPointerUp = () => {
      if (!isDraggingOrb) return;
      isDraggingOrb = false;
      orbEl.classList.remove('is-dragging');

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('touchmove', onPointerMove);
      window.removeEventListener('touchend', onPointerUp);

      if (orbHasMoved) {
        // 松手轻微贴边（向左或向右边缘平滑靠近）
        const rect = orbEl.getBoundingClientRect();
        const insets = getSafeAreaInsets();
        const midX = window.innerWidth / 2;
        let snapLeft = insets.left;
        if (rect.left + rect.width / 2 > midX) {
          snapLeft = window.innerWidth - rect.width - insets.right;
        }

        orbEl.style.transition = 'left 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
        orbEl.style.left = `${snapLeft}px`;
        saveOrbPosition(snapLeft, rect.top);
        setTimeout(() => {
          if (orbEl) orbEl.style.transition = '';
        }, 250);
      } else {
        // 未移动判定为点击：打开 Mini HUD。
        // 关键：touchend 之后浏览器会在同一坐标补发一个合成 click。
        // 小窗默认锚定左侧，球在左边时这个 click 正好落到刚弹出窗口的按钮上
        // （球在右边则落在窗口外，所以只有左侧会误触）。
        // 开窗前装一次性捕获级拦截器，把这枚幽灵 click 吞掉。
        const swallowGhostClick = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener('click', swallowGhostClick, true);
        };
        window.addEventListener('click', swallowGhostClick, true);
        // 若 350ms 内没有补发 click（纯指针设备），自行拆除，不留后患
        setTimeout(() => {
          window.removeEventListener('click', swallowGhostClick, true);
        }, 350);
        // 点击不再直开小窗：展开扇形指令环（助手窗口 / 调用日志 / 当前状态）。
        // 环开着时再点一下球 = 收起（toggle），拖走 = 在 pointermove 里自动收。
        toggleRadialMenu();
      }
    };

    orbEl.addEventListener('pointerdown', onPointerDown);
    orbEl.addEventListener('touchstart', onPointerDown, { passive: true });
  }

  /**
   * 绑定 Mini HUD 顶栏把手拖拽
   */
  function bindHudDragEvents() {
    if (!chatHeader) return;

    const onHeaderDown = (e) => {
      // 若点击的是顶栏按钮，不触发拖拽
      if (e.target.closest('button') || currentState !== STATE.MINI) return;

      isDraggingHud = true;
      hudDragStartX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      hudDragStartY = e.clientY || (e.touches && e.touches[0].clientY) || 0;

      const rect = chatPage.getBoundingClientRect();
      hudStartLeft = rect.left;
      hudStartTop = rect.top;

      window.addEventListener('pointermove', onHeaderMove, { passive: false });
      window.addEventListener('pointerup', onHeaderUp, { passive: false });
      window.addEventListener('touchmove', onHeaderMove, { passive: false });
      window.addEventListener('touchend', onHeaderUp, { passive: false });
    };

    const onHeaderMove = (e) => {
      if (!isDraggingHud) return;
      if (e.cancelable) e.preventDefault();
      const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY) || 0;
      const dx = clientX - hudDragStartX;
      const dy = clientY - hudDragStartY;

      const insets = getSafeAreaInsets();
      const newLeft = hudStartLeft + dx;
      const newTop = hudStartTop + dy;

      const rect = chatPage.getBoundingClientRect();
      const clampedLeft = Math.min(Math.max(8, newLeft), window.innerWidth - rect.width - 8);
      const clampedTop = Math.min(Math.max(insets.top, newTop), window.innerHeight - 80);

      chatPage.style.setProperty('--hud-custom-left', `${clampedLeft}px`);
      chatPage.style.setProperty('--hud-custom-top', `${clampedTop}px`);
    };

    const onHeaderUp = () => {
      if (!isDraggingHud) return;
      isDraggingHud = false;
      window.removeEventListener('pointermove', onHeaderMove);
      window.removeEventListener('pointerup', onHeaderUp);
      window.removeEventListener('touchmove', onHeaderMove);
      window.removeEventListener('touchend', onHeaderUp);

      const rect = chatPage.getBoundingClientRect();
      saveHudPosition(rect.left, rect.top);
    };

    chatHeader.addEventListener('pointerdown', onHeaderDown);
    chatHeader.addEventListener('touchstart', onHeaderDown, { passive: false });
  }

  /* ======================================================================
   * 扇形指令环 (Radial Command Ring)
   * 点击悬浮球弹出三个指令钮：助手窗口 / 调用日志 / 当前状态。
   * 几何：以球心为极点，向屏幕内侧扇形展开（球在右半屏向左扇，反之向右），
   * 三个角度均分 90° 扇区，半径 72px，全部做视口 + 灵动岛安全区钳制。
   * 收起时机：再点球、点任一指令、点空白（一次性捕获层）、拖球、任何形态切换。
   * ====================================================================== */

  let radialEl = null;
  let statusCardEl = null;
  let logCardEl = null;
  let radialOpen = false;
  let radialOutsideHandler = null;

  /** 指令环三枚钮的定义（图标全部纯 SVG，零 Emoji；标签只留中文，避免钮内拥挤） */
  const RADIAL_ITEMS = [
    {
      key: 'assistant',
      label: '助手窗口',
      // 系统助手统一耳机终端微标：与底栏呼叫系统/侧边栏助手书签 100% 对齐，纯 SVG 无分割线
      svg: '<path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9zM7 14h1v4H7v-4zm10 4v-4h1v4h-1z"/>',
      action: () => toMini()
    },
    {
      key: 'apilog',
      label: '调用日志',
      svg: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>',
      // 快捷速览浮卡就地排查；完整日志页仍可从卡底部入口跳转
      action: () => showLogCard()
    },
    {
      key: 'status',
      label: '当前状态',
      svg: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>',
      action: () => showStatusCard()
    }
  ];

  /** 惰性构建指令环 DOM（挂在 body 上，fixed 定位，高于球本体） */
  function ensureRadialDOM() {
    if (radialEl) return radialEl;
    radialEl = document.createElement('div');
    radialEl.className = 'orb-radial-ring';
    radialEl.setAttribute('aria-hidden', 'true');

    RADIAL_ITEMS.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'orb-radial-item';
      btn.dataset.radialKey = item.key;
      btn.style.transitionDelay = `${idx * 30}ms`;
      btn.setAttribute('aria-label', item.label);
      btn.setAttribute('title', item.label);
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true">${item.svg}</svg>
        <span class="orb-radial-label">${item.label}</span>`;
      // pointerdown 触发，抢在全局收环拦截之前执行动作
      btn.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // 助手已开（小窗/全屏）：助手钮置灰不可点，其余指令照常
        if (btn.classList.contains('is-disabled')) return;
        closeRadialMenu();
        try {
          item.action();
        } catch (err) {
          console.warn('[SystemChatOrb] 指令环动作执行失败:', err);
        }
      });
      radialEl.appendChild(btn);
    });

    document.body.appendChild(radialEl);
    return radialEl;
  }

  /**
   * 按球当前位置布局指令环：三枚长条钮向屏幕内侧垂直错落排列。
   * 球在右半屏 → 贴在球左侧向左对齐；球在左半屏 → 贴在球右侧向右对齐。
   */
  function layoutRadial() {
    const ring = ensureRadialDOM();
    const rect = orbEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const insets = getSafeAreaInsets();
    const onRightHalf = cx > window.innerWidth / 2;

    // 标记朝向，让动效从球侧向内侧轻微滑出
    ring.classList.toggle('side-left', onRightHalf);
    ring.classList.toggle('side-right', !onRightHalf);

    const buttons = ring.querySelectorAll('.orb-radial-item');
    const ITEM_H = 32;
    const GAP = 7;
    const totalH = buttons.length * ITEM_H + (buttons.length - 1) * GAP;

    // 垂直基准：垂直居中于球心
    let startY = cy - totalH / 2;
    // 上下安全区与视口钳制
    startY = Math.min(Math.max(insets.top + 8, startY), window.innerHeight - insets.bottom - totalH - 8);

    // 水平间隙：与球边缘保持 10px 呼吸间距
    const orbGap = 10;

    buttons.forEach((btn, i) => {
      const itemW = btn.offsetWidth || 104; // 动态宽度或回落
      let x = onRightHalf ? (rect.left - orbGap - itemW) : (rect.right + orbGap);
      let y = startY + i * (ITEM_H + GAP);

      // 视口与灵动岛左右钳制
      x = Math.min(Math.max(insets.left + 6, x), window.innerWidth - insets.right - itemW - 6);
      y = Math.min(Math.max(insets.top + 6, y), window.innerHeight - insets.bottom - ITEM_H - 6);

      btn.style.left = `${Math.round(x)}px`;
      btn.style.top = `${Math.round(y)}px`;
    });
  }

  function openRadialMenu() {
    if (radialOpen) return;
    // 防御：环与浮卡永不同屏。浮卡 z-index(15995) 压过环(15990)，
    // 若带卡开环，钮会被卡盖住点不动，形成只能刷新解锁的死局
    hideStatusCard();
    hideLogCard();
    const ring = ensureRadialDOM();
    layoutRadial();
    // 开环时实时判定：助手窗口已开（小窗/全屏）则助手钮置灰，
    // 日志 / 状态两钮照常可用——开着助手也能就地排查
    const assistantBtn = ring.querySelector('[data-radial-key="assistant"]');
    if (assistantBtn) {
      assistantBtn.classList.toggle(
        'is-disabled',
        currentState === STATE.MINI || currentState === STATE.FULL
      );
    }
    radialOpen = true;
    orbEl.classList.add('is-ring-open');
    ring.classList.add('is-open');
    ring.setAttribute('aria-hidden', 'false');
    syncOutsideHandler();
  }

  /** 环或任一浮卡处于打开状态 */
  function isAnyPopupOpen() {
    if (radialOpen) return true;
    if (statusCardEl && statusCardEl.classList.contains('is-open')) return true;
    if (logCardEl && logCardEl.classList.contains('is-open')) return true;
    return false;
  }

  /**
   * 点空白拦截器：生命周期跟"任意浮层"走，不再跟指令环走。
   * 之前的 bug：点环上指令时 closeRadialMenu() 先拆拦截器再开浮卡，
   * 浮卡成了没人管的孤儿，点空白关不掉。
   * 现在统一由本函数同步：有浮层就确保在位，全收干净才拆除。
   */
  function syncOutsideHandler() {
    if (isAnyPopupOpen()) {
      if (radialOutsideHandler) return; // 已在位
      // 装在下个宏任务，避免本次 pointerdown/click 冒泡立即把自己关掉
      setTimeout(() => {
        if (!isAnyPopupOpen() || radialOutsideHandler) return;
        radialOutsideHandler = (ev) => {
          if (radialEl && radialEl.contains(ev.target)) return;
          if (orbEl && orbEl.contains(ev.target)) return;
          if (statusCardEl && statusCardEl.contains(ev.target)) return;
          if (logCardEl && logCardEl.contains(ev.target)) return;
          closeRadialMenu();
        };
        window.addEventListener('pointerdown', radialOutsideHandler, true);
      }, 0);
    } else if (radialOutsideHandler) {
      window.removeEventListener('pointerdown', radialOutsideHandler, true);
      radialOutsideHandler = null;
    }
  }

  function closeRadialMenu() {
    hideStatusCard();
    hideLogCard();
    if (!radialOpen) {
      // 环本来就是收的：只需按浮层现状同步拦截器（通常这一步会拆掉它）
      syncOutsideHandler();
      return;
    }
    radialOpen = false;
    if (orbEl) orbEl.classList.remove('is-ring-open');
    if (radialEl) {
      radialEl.classList.remove('is-open');
      radialEl.setAttribute('aria-hidden', 'true');
    }
    syncOutsideHandler();
  }

  function toggleRadialMenu() {
    // 点球 = 全局收拢手势：只要有任何浮层在屏（环或状态/日志卡）一律收起。
    // 之前的 bug：浮卡开着时 radialOpen 为 false，点球会把环开在卡底下，
    // 卡盖住全部指令钮且点卡不触发任何收拢，死循环只能刷新。
    if (isAnyPopupOpen()) closeRadialMenu();
    else openRadialMenu();
  }

  /* ======================================================================
   * 当前状态浮卡 (Status Card)
   * 只读速览：副本状态 / 主模型配置 / 最近一次调用 / 日志缓冲计数。
   * 锚在球旁，点空白即收（复用指令环的 outside 拦截）。
   * ====================================================================== */

  function ensureStatusDOM() {
    if (statusCardEl) return statusCardEl;
    statusCardEl = document.createElement('div');
    statusCardEl.className = 'orb-status-card';
    statusCardEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(statusCardEl);
    return statusCardEl;
  }

  function hideStatusCard() {
    if (!statusCardEl) return;
    statusCardEl.classList.remove('is-open');
    statusCardEl.setAttribute('aria-hidden', 'true');
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  /** 采集档案数据：全部走权威只读接口，任何一项拿不到都优雅降级 */
  function collectStatus() {
    const st = {
      name: '执行员',
      serialNo: '',
      deptName: '',
      deptCode: '',
      level: 'LV.1',
      expCur: 0,
      expNext: 100,
      sanity: 100,
      sanityMax: 100,
      sanityStatus: null,
      modelOk: false,
      modelName: ''
    };

    // 身份：姓名 + 编号（真相源 Store.envoy.identity）
    try {
      if (window.Store && Store.envoy && Store.envoy.identity) {
        st.name = Store.envoy.identity.name || '执行员';
      }
      if (window.Store && typeof Store.getSerialNo === 'function') {
        st.serialNo = Store.getSerialNo() || '';
      }
    } catch (_) {}

    // 观测档案：部门 / 等级 / 经验 / 精神值（PsychStore.load 是同步内存读）
    try {
      if (window.PsychStore && typeof PsychStore.load === 'function') {
        const p = PsychStore.load() || {};
        if (typeof PsychStore.getDepartment === 'function') {
          const dept = PsychStore.getDepartment(p.department);
          if (dept) {
            st.deptName = dept.name || '';
            st.deptCode = dept.code || '';
          }
        }
        const career = p.career || {};
        if (career.level) st.level = String(career.level);
        st.expCur = Number(career.currentExp) || 0;
        st.expNext = Number(career.nextExp) || 100;
        st.sanity = p.sanity != null ? Number(p.sanity) : 100;
        st.sanityMax = p.maxSanity != null ? Number(p.maxSanity) : 100;
        if (typeof PsychStore.getSanityStatus === 'function') {
          st.sanityStatus = PsychStore.getSanityStatus(st.sanity);
        }
      }
    } catch (_) {}

    // 主模型配置：与推演链路同源的节点解析口径（未配置时卡上给窄警示条）
    try {
      let node = null;
      if (window.RetroflowApiUI && typeof RetroflowApiUI.getActiveNode === 'function') {
        node = RetroflowApiUI.getActiveNode();
      }
      if ((!node || (!node.baseUrl && !node.modelId)) && window.Store && Store.config) {
        const nodes = Array.isArray(Store.config.apiNodes) ? Store.config.apiNodes : [];
        const activeId = Store.config.apiActiveNodeId || '';
        node = nodes.find((n) => n && n.id === activeId) || nodes[0] || null;
      }
      if (node && node.baseUrl && node.modelId) {
        st.modelOk = true;
        st.modelName = node.modelId;
      }
    } catch (_) {}

    return st;
  }

  function fmtLatency(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return '--';
    return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  }

  function showStatusCard() {
    hideLogCard(); // 两卡互斥：开一张自动收另一张
    const card = ensureStatusDOM();
    const st = collectStatus();

    const sanityPct = st.sanityMax > 0
      ? Math.min(100, Math.max(0, Math.round((st.sanity / st.sanityMax) * 100)))
      : 0;
    const expPct = st.expNext > 0
      ? Math.min(100, Math.max(0, Math.round((st.expCur / st.expNext) * 100)))
      : 0;
    // 良好状态改用装饰色 --decor-color，避免次要色 --secondary-color（黑墨色）在黑底卡片上黑吃黑看不见
    let rawColorVar = (st.sanityStatus && st.sanityStatus.colorVar) || '--decor-color';
    if (rawColorVar === '--secondary-color') rawColorVar = '--decor-color';
    const sanColorVar = rawColorVar;
    const sanText = (st.sanityStatus && st.sanityStatus.text) || '良好';
    const sanCode = (st.sanityStatus && st.sanityStatus.code) || 'OPTIMAL';

    card.innerHTML = `
      <div class="orb-status-head">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
        </svg>
        <span class="orb-status-title">AGENT // 执行员档案</span>
        <button type="button" class="orb-card-close" aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="orb-agent-plate">
        <!-- 第一行：执行员 编号 + 部门胶囊（纯文字，仅部门名） -->
        <div class="orb-agent-id">
          <div class="orb-agent-id-main">
            <span class="orb-agent-name">${esc(st.name)}</span>
            <span class="orb-agent-serial">${st.serialNo ? `NO.${esc(st.serialNo)}` : '编号未领取'}</span>
          </div>
          <div class="orb-agent-dept-pill">
            <span class="orb-agent-dept-name">${esc(st.deptName || '未归档')}</span>
          </div>
        </div>
        <!-- 第二行：等级与积分（轻量小字微标，去掉方形大框） -->
        <div class="orb-agent-stats-row">
          <div class="orb-agent-stat-item">
            <span class="orb-agent-stat-lbl">等级</span>
            <span class="orb-agent-stat-val">${esc(st.level)}</span>
          </div>
          <div class="orb-agent-stat-item">
            <span class="orb-agent-stat-lbl">积分</span>
            <span class="orb-agent-stat-val">--</span>
          </div>
        </div>
      </div>
      ${st.modelOk ? '' : `
      <div class="orb-agent-warn">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
        </svg>
        <span>主模型未配置 · 点此前往 API 设置</span>
      </div>`}
      <div class="orb-gauges-block">
        <div class="orb-gauge">
          <div class="orb-gauge-top">
            <span class="orb-gauge-k">经验值</span>
            <span class="orb-gauge-v">${st.expCur} / ${st.expNext}</span>
          </div>
          <div class="orb-gauge-track"><div class="orb-gauge-fill is-exp" style="width:${expPct}%"></div></div>
        </div>
        <div class="orb-gauge">
          <div class="orb-gauge-top">
            <span class="orb-gauge-k">精神值</span>
            <span class="orb-gauge-san-text" style="color: var(${sanColorVar})" data-sanity-level="${esc(st.sanityStatus ? st.sanityStatus.level : 'optimal')}">${esc(sanCode)} · ${esc(sanText)}</span>
            <span class="orb-gauge-v">${st.sanity} / ${st.sanityMax}</span>
          </div>
          <div class="orb-gauge-track"><div class="orb-gauge-fill is-sanity" style="width:${sanityPct}%; --fill-color: var(${sanColorVar})"></div></div>
        </div>
      </div>`;

    // 卡头关闭钮：只收本卡，同步点空白拦截器
    const statusCloseBtn = card.querySelector('.orb-card-close');
    if (statusCloseBtn) {
      statusCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideStatusCard();
        syncOutsideHandler();
      });
    }

    // 未配置主模型：警示条可点，直达 API 设置
    const warnRow = card.querySelector('.orb-agent-warn');
    if (warnRow) {
      warnRow.addEventListener('click', (e) => {
        e.stopPropagation();
        closeRadialMenu();
        if (window.RetroflowSettings && typeof RetroflowSettings.openDetail === 'function') {
          RetroflowSettings.openDetail('api');
        }
      });
    }

    // 锚定：球旁侧弹出，视口 + 灵动岛钳制
    const rect = orbEl.getBoundingClientRect();
    const insets = getSafeAreaInsets();
    const CARD_W = 250;
    const CARD_H = card.offsetHeight || 220;
    const onRightHalf = rect.left + rect.width / 2 > window.innerWidth / 2;
    let left = onRightHalf ? rect.left - CARD_W - 10 : rect.right + 10;
    let top = rect.top + rect.height / 2 - CARD_H / 2;
    left = Math.min(Math.max(insets.left, left), window.innerWidth - insets.right - CARD_W);
    top = Math.min(Math.max(insets.top, top), window.innerHeight - insets.bottom - CARD_H);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    card.classList.add('is-open');
    card.setAttribute('aria-hidden', 'false');
    // 状态卡也可能是环收起后唯一在屏的浮层，同样要补挂点空白拦截器
    syncOutsideHandler();
  }

  /* ======================================================================
   * 调用日志速览浮卡 (Log Quick Card)
   * 就地排查轻量问题：最近 8 条紧凑行，点行展开端点/摘要/报错原因。
   * 完整日志页（50 条 + 导出/清空）从卡底部入口跳转。
   * 打开即拉最新（ApiCallLog.list 新在前），不设刷新钮。
   * ====================================================================== */

  const LOG_CARD_LIMIT = 8;
  const LOG_SNIPPET_LIMIT = 200;

  function ensureLogDOM() {
    if (logCardEl) return logCardEl;
    logCardEl = document.createElement('div');
    logCardEl.className = 'orb-log-card';
    logCardEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(logCardEl);
    return logCardEl;
  }

  function hideLogCard() {
    if (!logCardEl) return;
    logCardEl.classList.remove('is-open');
    logCardEl.setAttribute('aria-hidden', 'true');
  }

  function fmtLogTime(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return '--:--:--';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  /** 单行条目 → 紧凑行 + 可展开详情（事件委托在外层统一绑） */
  function renderLogRow(entry) {
    const dotCls = entry.ok ? 'is-ok' : 'is-fail';
    const snippetRaw = entry.ok
      ? String(entry.respBody || '')
      : String(entry.errorMessage || entry.respBody || '');
    const snippet = snippetRaw.length > LOG_SNIPPET_LIMIT
      ? `${snippetRaw.slice(0, LOG_SNIPPET_LIMIT)}…`
      : snippetRaw;

    const causesHtml = (!entry.ok && Array.isArray(entry.causes) && entry.causes.length)
      ? `<div class="orb-log-causes">${entry.causes.map((c) => `<div class="orb-log-cause">· ${esc(c)}</div>`).join('')}</div>`
      : '';

    return `
      <div class="orb-log-row-wrap">
        <button type="button" class="orb-log-row${entry.ok ? '' : ' is-fail'}">
          <span class="orb-status-dot ${dotCls}"></span>
          <span class="orb-log-caller">${esc(entry.caller || '未知')}</span>
          <span class="orb-log-kind">${esc(entry.kindLabel || entry.kind || '')}</span>
          <span class="orb-log-meta">${esc(fmtLatency(entry.latency))} · ${esc(fmtLogTime(entry.ts))}</span>
        </button>
        <div class="orb-log-detail" hidden>
          <div class="orb-log-detail-k">端点</div>
          <div class="orb-log-detail-v">${esc(entry.url || '--')}${entry.model ? ` · ${esc(entry.model)}` : ''}</div>
          ${snippet ? `<div class="orb-log-detail-k">${entry.ok ? '响应摘要' : '报错'}</div>
          <div class="orb-log-detail-v${entry.ok ? '' : ' is-error'}">${esc(snippet)}</div>` : ''}
          ${causesHtml}
        </div>
      </div>`;
  }

  /**
   * 打开调用日志速览浮卡。
   * @param {Element} [anchorEl] 锚定元素（浮卡弹在它旁边）。缺省锚悬浮球；
   *   副本下潜页 DECK 装备舱的「调用日志」芯片传自己进来——球在推演页是收走的，
   *   浮卡本身 fixed + z-index 15995，锚谁弹谁旁边，与球的可见性无关。
   */
  async function showLogCard(anchorEl) {
    hideStatusCard(); // 两卡互斥
    const card = ensureLogDOM();
    const anchor = anchorEl || orbEl;

    // 打开即拉最新
    let entries = [];
    try {
      if (window.ApiCallLog && typeof ApiCallLog.list === 'function') {
        entries = await ApiCallLog.list();
      }
    } catch (_) {}

    const shown = entries.slice(0, LOG_CARD_LIMIT);
    const listHtml = shown.length
      ? shown.map(renderLogRow).join('')
      : `<div class="orb-log-empty">尚无调用记录</div>`;

    card.innerHTML = `
      <div class="orb-log-head">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
        </svg>
        <span class="orb-log-title">调用日志</span>
        <span class="orb-log-count">${entries.length}/50</span>
        <button type="button" class="orb-card-close" aria-label="关闭">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
      <div class="orb-log-list">${listHtml}</div>
      <button type="button" class="orb-log-full-btn">
        <span>查看完整日志</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
        </svg>
      </button>`;

    // 卡头关闭钮：只收本卡，同步点空白拦截器
    const logCloseBtn = card.querySelector('.orb-card-close');
    if (logCloseBtn) {
      logCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideLogCard();
        syncOutsideHandler();
      });
    }

    // 行点击就地展开/收起
    card.querySelectorAll('.orb-log-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const detail = row.nextElementSibling;
        if (detail) detail.hidden = !detail.hidden;
        row.classList.toggle('is-open');
      });
    });

    // 底部入口：跳完整日志页
    const fullBtn = card.querySelector('.orb-log-full-btn');
    if (fullBtn) {
      fullBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeRadialMenu();
        if (window.RetroflowSettings && typeof RetroflowSettings.openDetail === 'function') {
          RetroflowSettings.openDetail('apiLog');
        }
      });
    }

    // 锚定：与状态浮卡同一套弹出 + 视口钳制（锚点可为球或外部传入元素）
    const rect = anchor.getBoundingClientRect();
    const insets = getSafeAreaInsets();
    const CARD_W = 280;
    // 先上屏量高度再钳制（列表最多 8 行，实际高度浮动大）
    card.classList.add('is-measuring');
    const CARD_H = Math.min(card.offsetHeight || 300, window.innerHeight * 0.6);
    card.classList.remove('is-measuring');
    const onRightHalf = rect.left + rect.width / 2 > window.innerWidth / 2;
    let left = onRightHalf ? rect.left - CARD_W - 10 : rect.right + 10;
    let top = rect.top + rect.height / 2 - CARD_H / 2;
    left = Math.min(Math.max(insets.left, left), window.innerWidth - insets.right - CARD_W);
    top = Math.min(Math.max(insets.top, top), window.innerHeight - insets.bottom - CARD_H);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;

    card.classList.add('is-open');
    card.setAttribute('aria-hidden', 'false');
    // 异步渲染完才挂 is-open，这里补同步让点空白拦截器重新在位
    syncOutsideHandler();
  }

  // 页面加载完成后自启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDOM);
  } else {
    initDOM();
  }

  // 暴露给全局
  window.SystemChatOrb = {
    getState: () => currentState,
    toOrb,
    toMini,
    toFull,
    hide: () => applyState(STATE.HIDDEN),
    showOrb: () => applyState(STATE.ORB),
    /**
     * 对外打开调用日志速览浮卡，锚定在指定元素旁。
     * 副本下潜页 DECK 装备舱的「调用日志」芯片走这个口——球收着也能弹卡。
     * @param {Element} [anchorEl] 缺省锚悬浮球
     */
    openLogCard: (anchorEl) => showLogCard(anchorEl),
    /** 读取悬浮球启用状态，供设置页回填开关 */
    isEnabled: () => orbEnabled,
    /* ---------------- 悬浮球美化对外接口 ---------------- */
    /** 重载皮肤图与调校配置（美化页改完即时生效） */
    refreshSkin,
    /** 设置尺寸 / 边框调校并立即生效 */
    setSkinCfg,
    /** 读取当前调校配置副本，供美化页回填 */
    getSkinCfg: () => ({ ...skinCfg }),
    /**
     * 聊天页被 SystemChatUI 自行以全屏态拉起时的状态对齐。
     * Dock / 线上列表 / 通知 / 共鸣页都直接调 open()，不经状态机，
     * 这里负责把内部指针钉到 FULL，并切好顶栏图标。
     * 球按启用状态保留在屏（与 applyState FULL 分支口径一致），
     * 开环时助手钮会被实时判定置灰。
     */
    notifyFullOpened: () => {
      currentState = STATE.FULL;
      // open() 是先调本方法、后 pushState 的，所以此刻的 hash 正是进全屏前的那个。
      // 记下它并认领这条桩：执行员若在大窗里点「最小化」走的是 toOrb()，
      // 不会经过 SystemChatUI.close()，得由本中枢负责把路由收尾干净。
      if (!orbPushedHistory) {
        hashBeforeFull = window.location.hash || '';
        orbPushedHistory = true;
      }
      if (orbEl) orbEl.classList.toggle('is-hidden', !orbEnabled);
      if (windowSizeBtn) {
        const expandIcon = windowSizeBtn.querySelector('.icon-expand');
        const restoreIcon = windowSizeBtn.querySelector('.icon-restore');
        if (expandIcon) expandIcon.style.display = 'none';
        if (restoreIcon) restoreIcon.style.display = 'block';
      }
      syncEnabledClass();
    },
    /**
     * 聊天页被 SystemChatUI 自行收起时的状态对齐。
     * 只改内部状态指针与球的可见性，不碰 chatPage 的 DOM，
     * 让 SystemChatUI 自己把退场动画走完。
     */
    notifyDismissed: () => {
      currentState = orbEnabled ? STATE.ORB : STATE.HIDDEN;
      // SystemChatUI 自己走 close() 时已经把 #system-chat 那条桩退掉了，
      // 这里必须一并放弃认领，否则下次 toOrb() 会重复收尾、改写掉别人的历史条目。
      orbPushedHistory = false;
      if (orbEl) orbEl.classList.toggle('is-hidden', !orbEnabled);
      document.body.classList.remove('system-chat-mini-active');
    },
    /**
     * 设置悬浮球启用状态。
     * 关掉时：若当前正挂在球态或小窗态，一并收走并恢复桌面；全屏态保持不动，
     * 只是顶栏的缩小/最小化键会被 orb-disabled 隐去。
     */
    setEnabled: (enabled) => {
      orbEnabled = !!enabled;
      saveOrbEnabled(orbEnabled);
      syncEnabledClass();
      if (!orbEnabled) {
        if (currentState === STATE.ORB || currentState === STATE.MINI) {
          applyState(STATE.HIDDEN);
        } else if (orbEl) {
          orbEl.classList.add('is-hidden');
        }
      } else if (currentState === STATE.HIDDEN) {
        applyState(STATE.ORB);
      }
      return orbEnabled;
    }
  };
})();
