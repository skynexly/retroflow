/**
 * 溯流计划 · 桌面应用矩阵与分页交互控制器
 * 职责：多页轮播滑动、指示器同步、磁贴点击路由。
 * 网格落位 / 图标⇄卡片切换 / 长按拖拽编辑由 js/desktop-grid.js 接管。
 */
(() => {
  // 1. 分页滑动与指示器同步（页数不写死，随桌面实际占用的页数动态增减）
  const viewport = document.getElementById('desktopCarouselViewport');
  const indicator = document.getElementById('desktopPageIndicator');
  let currentPage = 0;
  let pageCount = indicator ? (indicator.querySelectorAll('.page-indicator-dot').length || 3) : 3;

  /** 指示器按钮：只承载一枚方块，序号与模块名都不再显示 */
  function buildDot(idx) {
    const btn = document.createElement('button');
    const isActive = idx === currentPage;
    btn.className = 'page-indicator-dot' + (isActive ? ' active' : '');
    btn.type = 'button';
    btn.dataset.page = String(idx);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', '切换至第' + (idx + 1) + '页');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.innerHTML = '<span class="dot-core"></span>';
    return btn;
  }

  function renderIndicators() {
    if (!indicator) return;
    const dots = indicator.querySelectorAll('.page-indicator-dot');
    // 数量对得上就只校正索引与语义（兼容 index.html 里写死的初始按钮）
    if (dots.length === pageCount) {
      dots.forEach((dot, idx) => {
        dot.dataset.page = String(idx);
        dot.setAttribute('aria-label', '切换至第' + (idx + 1) + '页');
      });
      updateIndicator(currentPage);
      return;
    }
    indicator.textContent = '';
    for (let i = 0; i < pageCount; i++) indicator.appendChild(buildDot(i));
    updateIndicator(currentPage);
  }

  function setPage(pageIndex, smooth = true) {
    if (!viewport) return;
    const idx = Math.max(0, Math.min(pageCount - 1, pageIndex));
    currentPage = idx;
    const scrollWidth = viewport.clientWidth;
    viewport.scrollTo({
      left: idx * scrollWidth,
      behavior: smooth ? 'smooth' : 'auto'
    });
    updateIndicator(idx);
  }

  function updateIndicator(pageIndex) {
    if (!indicator) return;
    indicator.querySelectorAll('.page-indicator-dot').forEach((dot) => {
      const idx = parseInt(dot.dataset.page, 10);
      const isActive = idx === pageIndex;
      dot.classList.toggle('active', isActive);
      dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  /** 由 desktop-grid.js 在长出 / 收回页面后调用 */
  function setPageCount(count) {
    const next = Math.max(1, Math.round(Number(count) || 1));
    if (next === pageCount) {
      renderIndicators();
      return pageCount;
    }
    pageCount = next;
    if (currentPage > pageCount - 1) currentPage = pageCount - 1;
    renderIndicators();
    return pageCount;
  }

  if (viewport) {
    let scrollTimeout = null;
    viewport.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollLeft = viewport.scrollLeft;
        const width = viewport.clientWidth || 1;
        const page = Math.round(scrollLeft / width);
        if (page !== currentPage) {
          currentPage = page;
          updateIndicator(page);
        }
      }, 50);
    }, { passive: true });
  }

  // 事件委派：指示器按钮会被动态重建，不能逐个绑定
  if (indicator) {
    indicator.addEventListener('click', (e) => {
      const dot = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('.page-indicator-dot')
        : null;
      if (!dot) return;
      const idx = parseInt(dot.dataset.page, 10);
      if (!isNaN(idx)) setPage(idx, true);
    });
  }

  renderIndicators();

  // 供 desktop-grid.js 在编辑态跨页翻页 / 页数变化时调用
  window.DesktopCarousel = {
    setPage,
    setPageCount,
    getPageCount: () => pageCount,
    getCurrentPage: () => currentPage,
    updateIndicator
  };

  // 2. 磁贴路由点击分发
  function handleAppClick(appId, appName) {
    console.log(`[Retroflow] 正在进入模块：${appName} (${appId})`);
    if (appId === 'persona') {
      if (window.PersonaUI && typeof PersonaUI.open === 'function') {
        PersonaUI.open();
      }
    } else if (appId === 'forks') {
      if (window.ForkArchiveUI && typeof ForkArchiveUI.open === 'function') {
        ForkArchiveUI.open();
      }
    } else if (appId === 'resonance') {
      if (window.ResonanceUI && typeof ResonanceUI.open === 'function') {
        ResonanceUI.open();
      }
    } else if (appId === 'gallery') {
      if (window.GalleryApp && typeof GalleryApp.open === 'function') {
        GalleryApp.open();
      }
    } else if (appId === 'memory') {
      if (window.MemoryBankApp && typeof MemoryBankApp.open === 'function') {
        MemoryBankApp.open();
      }
    } else if (appId === 'lifeService') {
      if (window.LifeServiceUI && typeof LifeServiceUI.open === 'function') {
        LifeServiceUI.open();
      }
    } else if (appId === 'retroSpace') {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'SYSTEM 模块连接',
          message: `${appName || appId} 正在构筑中`,
          detail: '核心时空通道校准中，后续更新开放。',
          type: 'info'
        });
      }
    } else {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'SYSTEM 模块连接',
          message: `${appName || appId} 正在构筑中`,
          detail: '核心时空通道校准中，后续更新开放。',
          type: 'info'
        });
      }
    }
  }

  // 绑定所有带有 data-app 的磁贴卡片与按钮
  document.querySelectorAll('[data-app]').forEach((el) => {
    el.addEventListener('click', () => {
      // 编辑模式下点击不进入模块；刚结束拖拽/长按的这一次点击同样拦截
      if (document.body.classList.contains('desktop-editing')) return;
      if (window.DesktopGrid && typeof DesktopGrid.isSuppressClick === 'function' && DesktopGrid.isSuppressClick()) {
        return;
      }
      const appId = el.dataset.app;
      const appTitle = el.querySelector('.bento-title')?.textContent || appId;
      handleAppClick(appId, appTitle);
    });
  });

  /* ---------------- 启动遮罩解除 ----------------
     纯色遮罩盖住「静态初始桌面 → 存档布局 → 主题着色」这段窗口。
     正常路径由 Boot.onReady('desktop') 在 DesktopGrid.init 与 applyAllTiles 之后调用；
     同时挂一个兜底定时器，任一路径抛异常或 Boot 卡住也会强制揭开，
     绝不把界面永久留在遮罩下。
     注意：必须定义在 Boot.onReady 之前——Boot 已就绪时 onReady 会同步跑回调，
     若状态变量声明在后会撞上暂时性死区。 */
  let bootCurtainReleased = false;

  function releaseBootCurtain() {
    if (bootCurtainReleased) return;
    bootCurtainReleased = true;
    const curtain = document.getElementById('bootCurtain');
    document.body.classList.remove('is-booting');
    if (!curtain) return;
    curtain.classList.add('is-off');
    const finish = () => {
      if (curtain.parentElement) curtain.classList.add('is-gone');
    };
    // 等淡出走完再退出渲染树；减少动效偏好下过渡为 0，直接收尾
    const reduced = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      finish();
    } else {
      setTimeout(finish, 360);
    }
  }

  // 兜底：无论 Boot 是否正常完成，最多 2.2 秒后一定揭开
  setTimeout(releaseBootCurtain, 2200);

  // 3. 配置装载完成后再应用桌面磁贴美化（背景 / 图标 / 移除底座）
  Boot.onReady('desktop', async () => {
    if (window.DesktopGrid && typeof DesktopGrid.init === 'function') {
      try { DesktopGrid.init(); } catch (e) { /* ignore */ }
    }
    if (window.ThemeEngine && typeof ThemeEngine.applyAllTiles === 'function') {
      try { await ThemeEngine.applyAllTiles(); } catch (e) { /* ignore */ }
    }
    // 桌面布局与磁贴美化都落位后才揭开启动遮罩，避免看见中间态跳变
    releaseBootCurtain();
  });
})();
