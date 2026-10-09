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
        const maxLeft = window.innerWidth - 56;
        const maxTop = window.innerHeight - insets.bottom - 56;
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
      // 小窗态：球让位，但桌面保持可操作（浮窗只是副屏，不接管整屏）
      orbEl.classList.add('is-hidden');
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
      // 全屏态：接管整屏，底层桌面做景深退避
      orbEl.classList.add('is-hidden');
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
      }

      if (orbHasMoved) {
        if (e.cancelable) e.preventDefault();
        const insets = getSafeAreaInsets();
        const newLeft = orbStartLeft + dx;
        const newTop = orbStartTop + dy;

        // 限制在视口内（含灵动岛保护）
        const clampedTop = Math.min(Math.max(insets.top, newTop), window.innerHeight - insets.bottom - 50);
        const clampedLeft = Math.min(Math.max(insets.left, newLeft), window.innerWidth - insets.right - 50);

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
        toMini();
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
    /** 读取悬浮球启用状态，供设置页回填开关 */
    isEnabled: () => orbEnabled,
    /**
     * 聊天页被 SystemChatUI 自行以全屏态拉起时的状态对齐。
     * Dock / 线上列表 / 通知 / 共鸣页都直接调 open()，不经状态机，
     * 这里负责收起悬浮球、把内部指针钉到 FULL，并切好顶栏图标。
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
      if (orbEl) orbEl.classList.add('is-hidden');
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
