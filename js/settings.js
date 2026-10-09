/**
 * 溯流计划 · 终端设置中枢全屏控制器 (Level 1 Master View + Level 2 Router)
 * 架构：双保险驱动
 *   - 界面返回按钮 / ESC：直接驱动 UI 状态机（0 延迟响应，绝不依赖 history 栈深度）
 *   - 手机物理返回键 / 手势返回：由 popstate 逐级退回（二级 -> 一级 -> 主桌面）
 * 层级：主桌面(level 0) -> 一级设置(level 1) -> 二级子页(level 2)
 */
(() => {
  const settingsPage = document.getElementById('settingsPage');
  const settingsCloseBtn = document.getElementById('settingsCloseBtn');
  const settingsItems = document.querySelectorAll('.settings-nav-item');
  const masterView = document.getElementById('settingsMasterView');
  const detailView = document.getElementById('settingsDetailView');

  const detailSections = {
    api: document.getElementById('apiDetailSection'),
    theme: document.getElementById('themeDetailSection'),
    manual: document.getElementById('manualDetailSection'),
    data: document.getElementById('dataDetailSection')
  };

  // 当前层级：0 = 主桌面，1 = 一级设置，2 = 二级子页
  let level = 0;
  let currentSection = null;
  let pendingProgrammaticBack = false;
  // 外部入口跳进来时登记的返回目标：设置页彻底退出时回调它，而不是回主桌面。
  // 形如 { handler: Function, label: string, steps: number }，消费一次即清空。
  // steps = 从来源页历史条目到当前条目的层数，退栈时按它回退，让来源页的 hash / state 原样复位。
  let returnTarget = null;

  /**
   * 消费返回目标。
   * @returns {number|null} 接管成功时返回应退的历史步数，未接管返回 null
   */
  function consumeReturnTarget() {
    if (!returnTarget || typeof returnTarget.handler !== 'function') {
      returnTarget = null;
      return null;
    }
    const { handler, steps } = returnTarget;
    returnTarget = null;
    try {
      handler();
      return typeof steps === 'number' ? steps : 1;
    } catch (err) {
      console.warn('[Retroflow Settings] 返回目标执行失败:', err);
      return null;
    }
  }

  /* ---------------- 纯视图渲染层（不涉及任何 history 操作） ---------------- */

  function renderLevel(nextLevel, section) {
    const dockBar = document.querySelector('.tactical-dock-bar');

    if (nextLevel >= 1) {
      if (settingsPage) settingsPage.classList.add('active');
      document.body.classList.add('page-active');
      if (dockBar) dockBar.classList.add('keyboard-hidden');
    } else {
      if (settingsPage) settingsPage.classList.remove('active');
      document.body.classList.remove('page-active');
      if (dockBar) dockBar.classList.remove('keyboard-hidden');
    }

    if (nextLevel === 2 && section && detailSections[section]) {
      Object.entries(detailSections).forEach(([key, el]) => {
        if (el) el.hidden = key !== section;
      });
      if (detailView) {
        detailView.classList.add('active');
        detailView.setAttribute('aria-hidden', 'false');
      }
      if (masterView) masterView.classList.add('pushed');

      // 二级页面进场后校准色环光标
      if (section === 'theme' && window.RetroflowThemeUI) {
        setTimeout(() => window.RetroflowThemeUI.recalibrate(), 340);
      }

      // 进入 API 页：强制回到节点库列表视图并刷新
      if (section === 'api' && window.RetroflowApiUI) {
        window.RetroflowApiUI.init();
      }

      // 进入使用手册页：初始化指南控制器
      if (section === 'manual' && window.RetroflowManualApp) {
        window.RetroflowManualApp.init();
      }

      // 进入数据管理页：渲染用量总览与分块卡片
      if (section === 'data' && window.DataVaultUI && typeof DataVaultUI.render === 'function') {
        DataVaultUI.render();
      }
    } else {
      if (detailView) {
        detailView.classList.remove('active');
        detailView.setAttribute('aria-hidden', 'true');
      }
      if (masterView) masterView.classList.remove('pushed');
    }

    level = nextLevel;
    currentSection = nextLevel === 2 ? section : null;
  }

  /* ---------------- 导航动作（UI 立即响应 + history 辅助同步） ---------------- */

  function openSettings() {
    if (level >= 1) return;
    renderLevel(1);
    try {
      history.pushState({ rfLevel: 1 }, '', '#settings');
    } catch (err) {
      /* 忽略历史栈异常，UI 已生效 */
    }
  }

  /**
   * 推入二级子页。
   * @param {string} section 子页标识
   * @param {Object} [options]
   * @param {Function} [options.onReturn] 设置页彻底退出时的返回目标（替代回主桌面）
   * @param {string} [options.returnLabel] 返回目标描述，仅用于调试
   * @param {Function} [options.afterEnter] 子页渲染并完成 init 后执行，用于直达更深的视图
   */
  function openDetail(section, options) {
    if (!detailSections[section]) {
      console.log(`[Retroflow Settings] 子模块 ${section} 尚未构建`);
      return;
    }
    const opts = options || {};
    if (typeof opts.onReturn === 'function') {
      returnTarget = {
        handler: opts.onReturn,
        label: opts.returnLabel || '',
        // 折叠模式下当前条目就是来源条目的原地改写，返回时不再退栈（步数 0），
        // 由来源页自己重建它那一层路由，避免多退一格冲到桌面。
        steps: typeof opts.returnSteps === 'number' ? opts.returnSteps : (opts.replaceEntry ? 0 : 1)
      };
    }

    renderLevel(2, section);
    try {
      if (opts.replaceEntry) {
        // 折叠模式：把来源页的历史条目原地改写成本子页，整段跨页跳转只占一层。
        // 返回时不退栈（steps=0），由来源页自己 replaceState 重建路由，
        // 栈里不会残留 #settings/api 等中间条目。
        history.replaceState({ rfLevel: 2, section }, '', `#settings/${section}`);
      } else {
        history.pushState({ rfLevel: 2, section }, '', `#settings/${section}`);
      }
    } catch (err) {
      /* 忽略 */
    }

    // renderLevel 里各子页的 init() 会重置到列表视图，因此直达更深视图的动作
    // 必须排在其后执行，这里用微任务队列保证顺序，不依赖魔法延时。
    if (typeof opts.afterEnter === 'function') {
      Promise.resolve().then(() => {
        try {
          opts.afterEnter();
        } catch (err) {
          console.warn('[Retroflow Settings] afterEnter 执行失败:', err);
        }
      });
    }
  }

  // 二级 -> 一级：UI 立即收起二级页，一级配置列表保持展开
  function closeDetail() {
    if (level !== 2) return;
    // 从外部入口直达二级页时，一级设置列表对用户没有意义，直接交还给来源页
    if (returnTarget) {
      renderLevel(0);
      const steps = consumeReturnTarget();
      if (steps !== null) {
        // 来源页会自行恢复它那一层的 hash / state，这里只负责把栈退回去
        popHistory(steps);
        return;
      }
      syncHash('', 2);
      return;
    }
    renderLevel(1);
    syncHash('#settings');
  }

  // 一级 -> 主桌面（若在二级则一步直达桌面）
  function closeSettings() {
    if (level === 0) return;
    const steps = level; // 在二级时需退 2 步，在一级时退 1 步
    const hadReturnTarget = !!returnTarget;
    renderLevel(0);
    const returnSteps = consumeReturnTarget();
    if (hadReturnTarget && returnSteps !== null) {
      popHistory(returnSteps);
      return;
    }
    syncHash('', steps);
  }

  /** 纯退栈：交回来源页时使用，URL 由来源页自己维护，这里不做 hash 纠正 */
  function popHistory(steps) {
    if (!steps || steps < 1) return;
    pendingProgrammaticBack = true;
    try {
      history.go(-steps);
    } catch (err) {
      pendingProgrammaticBack = false;
    }
    // 兜底：栈已到底时 popstate 不会触发，解除标记避免影响后续返回
    setTimeout(() => {
      pendingProgrammaticBack = false;
    }, 300);
  }

  /**
   * 把 URL hash 拉回目标状态。
   * 优先尝试用 history.go(-steps) 出栈（保持栈干净）；
   * 若栈内没有可回退项（刷新后进入等场景），则直接 replaceState 强制纠正，
   * 保证 UI 与 URL 永不失联。
   */
  function syncHash(targetHash, steps = 1) {
    const expected = targetHash || '';
    const current = window.location.hash || '';
    if (current === expected) return;

    const stateLevel = history.state && history.state.rfLevel;
    if (typeof stateLevel === 'number' && history.length > steps) {
      // 标记本次回退由 UI 主动发起，popstate 里跳过重复渲染
      pendingProgrammaticBack = true;
      history.go(-steps);
      // 兜底：若 300ms 内 popstate 未触发（栈已到底），强制纠正 URL
      setTimeout(() => {
        if (pendingProgrammaticBack) {
          pendingProgrammaticBack = false;
          forceReplaceHash(expected);
        }
      }, 300);
      return;
    }

    forceReplaceHash(expected);
  }

  function forceReplaceHash(expected) {
    try {
      const base = window.location.pathname + window.location.search;
      history.replaceState({ rfLevel: level, section: currentSection }, '', expected ? `${base}${expected}` : base);
    } catch (err) {
      /* 忽略 */
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  // 手机物理返回键 / 浏览器手势返回：逐级退回
  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      // UI 已在点击时同步完成，这里只校准 URL 与状态
      return;
    }

    const hash = window.location.hash || '';
    if (hash.startsWith('#settings/')) {
      renderLevel(2, hash.replace('#settings/', ''));
      return;
    }
    if (hash === '#settings') {
      renderLevel(1);
      return;
    }

    // 退出设置层：若来自外部入口，把控制权交还来源页而不是落到主桌面。
    // 注意浏览器此时已经退掉一格：折叠模式下被退掉的正是来源页那一格，
    // 因此接管前先补一格占位，使栈深度与来源页视图层级保持一致，
    // 随后 returnTarget 里的 replaceState 会把它改写成来源页自己的路由。
    const hadReturnTarget = !!returnTarget;
    const needRestoreEntry = hadReturnTarget && returnTarget.steps === 0;
    renderLevel(0);
    if (needRestoreEntry) {
      try {
        history.pushState({ rfLevel: 0 }, '', window.location.hash || '');
      } catch (_) { /* 忽略，最坏情况仅少一格历史 */ }
    }
    if (hadReturnTarget) consumeReturnTarget();
  });

  // 一级设置页顶部关闭按钮：一步直达主桌面
  if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener('click', () => closeSettings());
  }

  // ESC 键：优先退二级，其次退整个设置页
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (level === 2) closeDetail();
    else if (level === 1) closeSettings();
  });

  // 一级列表卡片：推入二级（采用事件委托，确保动态或后置渲染的项目 100% 响应）
  if (masterView) {
    masterView.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-nav-item');
      if (!item) return;
      const section = item.dataset.section;
      if (section) openDetail(section);
    });
  }

  // 二级页面左上角返回按钮：只退回一级配置列表（采用事件委托）
  if (detailView) {
    detailView.addEventListener('click', (e) => {
      const backBtn = e.target.closest('.settings-back-btn');
      if (!backBtn) return;
      closeDetail();
    });
  }

  // 冷启动强制归零：忽略 URL 上残留的 hash，首屏一律落在主桌面
  (function initColdStart() {
    renderLevel(0);
    try {
      const base = window.location.pathname + window.location.search;
      history.replaceState({ rfLevel: 0 }, '', base);
    } catch (err) {
      /* 忽略 */
    }
  })();

  // 挂载到全局
  window.RetroflowSettings = {
    open: openSettings,
    close: closeSettings,
    openDetail,
    closeDetail
  };
})();