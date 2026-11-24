/**
 * 溯流计划 · 桌面网格引擎与编辑态拖拽控制器
 *
 * 职责：
 *   1. 3 页 × 4 列 × 5 行等规格网格排布，落位信息持久化到 decor.desktopLayout
 *   2. 磁贴双形态：1×1 图标态（上图下字）⇄ 2×1 卡片态（一行高横向卡）
 *   3. 4×2 复合英雄组件（红卡 + 在役履历条）整体占位
 *   4. 长按进入编辑态，编辑态内自由拖拽、落点预览、边缘跨页、碰撞让位 / 同尺寸互换
 *   5. 组件库：英雄组件可收进库（不占格子、节点挂到 #desktopWidgetStash），
 *      也可从库里取出按尺寸找空位放回桌面；库面板直接渲染组件本体的等比缩小副本
 *
 * 与其它模块的边界：
 *   - 分页滑动与指示器同步归 js/apps.js，本文件只通过 window.DesktopCarousel 借用
 *   - 磁贴美化（自定义背景 / 图标 / 底座）归 js/theme.js，本文件不碰
 *   - 点击进模块归 js/apps.js，本文件只在编辑态与拖拽刚结束时短路它
 */
(() => {
  'use strict';

  /* ======================================================================
     常量与默认布局
     ====================================================================== */

  // 页数不再写死：1 页起，拖到最右自动长出新页，尾部空页自动回收
  const MIN_PAGES = 1;
  // 安全上限：防止异常数据把页池撑爆
  const MAX_PAGES = 12;
  let pageCount = MIN_PAGES;
  const COLS = 4;
  const ROWS = 5;
  const STORAGE_PATH = 'decor.desktopLayout';
  // v2：存档里多存 pages（当前页数），老存档按 v1 读入后自动补齐
  const LAYOUT_VERSION = 2;

  // 手势节拍（毫秒 / 像素）
  const LONG_PRESS_MS = 420;
  const MOVE_TOLERANCE = 8;
  const DRAG_START_PX = 5;
  const EDGE_TRIGGER_PX = 38;
  // 贴边停顿多久翻第一页；停在边缘不松手，之后每 EDGE_REPEAT_MS 再翻一页，可以连续跨多页
  const EDGE_HOLD_MS = 320;
  const EDGE_REPEAT_MS = 520;
  const CLICK_SUPPRESS_MS = 320;

  /**
   * 默认桌面布局。每项：
   *   id    与 index.html 中 data-app / data-widget-id 对齐
   *   type  hero 为 4×2 复合组件，app 为可切换形态的普通磁贴
   *   mode  hero 固定占位；card 2×1；icon 1×1
   *   page / row / col  左上角落位（行列均从 0 起）
   *   stashed  仅 hero 可为 true：收在组件库里，不占桌面格子
   */
  const DEFAULT_ITEMS = [
    // 第 1 页 · 系统主干
    { id: 'profile',     type: 'hero', mode: 'hero', page: 0, row: 0, col: 0 },
    // 酸性机能档案卡：默认收在组件库里
    { id: 'profileAcid', type: 'hero', mode: 'hero', page: 0, row: 0, col: 0, stashed: true },
    { id: 'forks',       type: 'app',  mode: 'card', page: 0, row: 2, col: 0 },
    { id: 'memory',      type: 'app',  mode: 'card', page: 0, row: 2, col: 2 },
    { id: 'persona',     type: 'app',  mode: 'card', page: 0, row: 3, col: 0 },
    { id: 'resonance',   type: 'app',  mode: 'card', page: 0, row: 3, col: 2 },
    { id: 'echo',        type: 'app',  mode: 'card', page: 0, row: 4, col: 0 },
    { id: 'supply',      type: 'app',  mode: 'card', page: 0, row: 4, col: 2 },
    // 第 2 页 · 随身物资与媒体
    { id: 'vault',       type: 'app',  mode: 'card', page: 1, row: 0, col: 0 },
    { id: 'reader',      type: 'app',  mode: 'card', page: 1, row: 0, col: 2 },
    { id: 'gallery',     type: 'app',  mode: 'card', page: 1, row: 1, col: 0 },
    { id: 'credits',     type: 'app',  mode: 'card', page: 1, row: 1, col: 2 },
    { id: 'inventory',   type: 'app',  mode: 'card', page: 1, row: 2, col: 0 },
    // 第 3 页 · 生活与私属空间
    { id: 'lifeService', type: 'app',  mode: 'card', page: 2, row: 0, col: 0 },
    { id: 'retroSpace',  type: 'app',  mode: 'card', page: 2, row: 0, col: 2 }
  ];

  /** 组件库里展示的名称（只有 hero 能进组件库；普通磁贴是模块唯一入口，不可收起） */
  const WIDGET_META = {
    profile:     { name: '经典红卡', en: 'CLASSIC ARCHIVE' },
    profileAcid: { name: '酸性档案', en: 'ACID DOSSIER' }
  };

  /* ======================================================================
     运行时状态
     ====================================================================== */

  let items = {};
  let inited = false;
  let editMode = false;
  let press = null;
  let drag = null;
  let edgeTimer = null;
  let edgeLocked = null;
  let suppressUntil = 0;

  const viewport = document.getElementById('desktopCarouselViewport');
  const track = document.getElementById('desktopCarouselTrack');

  /* ======================================================================
     通用工具
     ====================================================================== */

  function clampInt(v, min, max) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return min;
    return Math.max(min, Math.min(max, n));
  }

  function getGrid(page) {
    return document.querySelector('.desktop-grid[data-grid-page="' + page + '"]');
  }

  function getEl(id) {
    const it = items[id];
    if (!it) return null;
    if (it.type === 'hero') {
      return document.querySelector('.desktop-hero-widget[data-widget-id="' + id + '"]');
    }
    return document.querySelector('.bento-card[data-app="' + id + '"]');
  }

  /** 组件当前占几列几行 */
  function getSize(it) {
    if (!it) return { w: 1, h: 1 };
    if (it.type === 'hero') return { w: 4, h: 2 };
    return it.mode === 'icon' ? { w: 1, h: 1 } : { w: 2, h: 1 };
  }

  /* ======================================================================
     占用表与空位查找
     ====================================================================== */

  function emptyOcc() {
    const occ = [];
    for (let p = 0; p < pageCount; p++) {
      const page = [];
      for (let r = 0; r < ROWS; r++) page.push(new Array(COLS).fill(null));
      occ.push(page);
    }
    return occ;
  }

  /** 构建占用表；exclude 内的 id 不参与占位（用于评估「它挪走以后」的局势） */
  function buildOccupancy(exclude) {
    const occ = emptyOcc();
    const skip = exclude || [];
    Object.keys(items).forEach((id) => {
      if (skip.indexOf(id) !== -1) return;
      const it = items[id];
      if (!it || it.stashed) return; // 收在组件库里的不占格子
      const s = getSize(it);
      markRect(occ, it.page, it.row, it.col, s.w, s.h, id);
    });
    return occ;
  }

  function markRect(occ, page, row, col, w, h, value) {
    if (page < 0 || page >= occ.length) return;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) occ[page][r][c] = value;
      }
    }
  }

  function rectFree(occ, page, row, col, w, h) {
    if (page < 0 || page >= occ.length) return false;
    if (row < 0 || col < 0 || row + h > ROWS || col + w > COLS) return false;
    for (let r = row; r < row + h; r++) {
      for (let c = col; c < col + w; c++) {
        if (occ[page][r][c]) return false;
      }
    }
    return true;
  }

  /**
   * 找第一个能放下的空位。
   * 优先当前页，随后按页序补齐；页内从上到下、从左到右。
   */
  function findFreeSpot(occ, w, h, startPage) {
    const order = [startPage];
    for (let p = 0; p < occ.length; p++) {
      if (p !== startPage) order.push(p);
    }
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      for (let r = 0; r <= ROWS - h; r++) {
        for (let c = 0; c <= COLS - w; c++) {
          if (rectFree(occ, p, r, c, w, h)) return { page: p, row: r, col: c };
        }
      }
    }
    return null;
  }

  /* ======================================================================
     落位算法：同尺寸互换 → 否则占用目标格并给冲突项找新家
     ====================================================================== */

  /**
   * 把某个组件放到目标位置，自动消解碰撞。
   * @returns {boolean} 是否成功落位
   */
  function placeItem(id, targetPage, targetRow, targetCol) {
    const it = items[id];
    if (!it) return false;

    const s = getSize(it);
    // 目标页超出当前页数时自动长页：拖到最右边缘新建的那一页就是靠这里兜住的
    if (targetPage >= pageCount) ensurePageCount(targetPage + 1);
    const page = clampInt(targetPage, 0, pageCount - 1);
    const col = clampInt(targetCol, 0, COLS - s.w);
    const row = clampInt(targetRow, 0, ROWS - s.h);

    // 先看目标格被谁占着（完全排除自己，避免自己和自己判冲突）
    const baseOcc = buildOccupancy([id]);
    const conflicts = [];
    for (let r = row; r < row + s.h; r++) {
      for (let c = col; c < col + s.w; c++) {
        const other = baseOcc[page][r][c];
        if (other && conflicts.indexOf(other) === -1) conflicts.push(other);
      }
    }

    // 1. 目标区空闲，直接落位
    if (conflicts.length === 0) {
      it.page = page;
      it.row = row;
      it.col = col;
      return true;
    }

    // 2. 只和一个同尺寸组件冲突 → 双方直接互换（含跨页互换）
    if (conflicts.length === 1) {
      const other = items[conflicts[0]];
      const os = getSize(other);
      if (other && os.w === s.w && os.h === s.h) {
        const swapOcc = buildOccupancy([id, other.id]);
        // 被换走的那个要落回「我原来的位置」，那里必然是空出来的
        if (rectFree(swapOcc, it.page, it.row, it.col, os.w, os.h)) {
          const fromPage = it.page;
          const fromRow = it.row;
          const fromCol = it.col;
          it.page = page;
          it.row = row;
          it.col = col;
          other.page = fromPage;
          other.row = fromRow;
          other.col = fromCol;
          return true;
        }
      }
    }

    // 3. 其余情况：自己占住目标格，冲突项逐个让位
    it.page = page;
    it.row = row;
    it.col = col;

    const occ = buildOccupancy([]); // 此时已包含主动项的新位置
    for (let i = 0; i < conflicts.length; i++) {
      const other = items[conflicts[i]];
      if (!other) continue;
      const os = getSize(other);
      // 先把它从占用表里摘掉，再找新家，避免自我阻塞
      markRect(occ, other.page, other.row, other.col, os.w, os.h, null);
      let spot = findFreeSpot(occ, os.w, os.h, it.page);
      if (!spot && pageCount < MAX_PAGES) {
        // 现有页全满了：长出一页专门安置被挤走的组件，宁可多一页也不叠着
        ensurePageCount(pageCount + 1);
        // 占用表是在长页之前建的，得补上新页那一层，否则 findFreeSpot 扫不到新页
        while (occ.length < pageCount) {
          const fresh = [];
          for (let r = 0; r < ROWS; r++) fresh.push(new Array(COLS).fill(null));
          occ.push(fresh);
        }
        spot = findFreeSpot(occ, os.w, os.h, it.page);
      }
      if (spot) {
        other.page = spot.page;
        other.row = spot.row;
        other.col = spot.col;
      }
      markRect(occ, other.page, other.row, other.col, os.w, os.h, other.id);
    }
    return true;
  }

  /* ======================================================================
     渲染
     ====================================================================== */

  /** 每页生成 20 个占位格（编辑态可见的落位参考底块） */
  function buildSlots() {
    for (let p = 0; p < pageCount; p++) {
      const grid = getGrid(p);
      if (!grid) continue;
      const holder = grid.querySelector('.grid-slots');
      if (!holder || holder.dataset.slotsBuilt === '1') continue;
      holder.textContent = '';
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = document.createElement('div');
          cell.className = 'grid-slot-cell';
          cell.dataset.row = String(r);
          cell.dataset.col = String(c);
          holder.appendChild(cell);
        }
      }
      holder.dataset.slotsBuilt = '1';
    }
  }

  /** 每页一个落点预览框（拖拽时高亮目标区域） */
  function ensurePreview() {
    for (let p = 0; p < pageCount; p++) {
      const grid = getGrid(p);
      if (!grid) continue;
      if (!grid.querySelector('.grid-drop-preview')) {
        const prev = document.createElement('div');
        prev.className = 'grid-drop-preview';
        prev.setAttribute('aria-hidden', 'true');
        grid.appendChild(prev);
      }
    }
  }

  function getPreview(page) {
    const grid = getGrid(page);
    return grid ? grid.querySelector('.grid-drop-preview') : null;
  }

  /* ----------------------------------------------------------------------
     页池：页数动态伸缩
     1 页起，拖到最右自动长新页，尾部连续空页自动回收；
     中间空页保留，避免后面页的内容整体左移跳动。
     ---------------------------------------------------------------------- */

  /** 把当前页数同步给 CSS 轨道宽度与底部指示器 */
  function syncPageUi() {
    if (track) track.style.setProperty('--desktop-pages', String(pageCount));
    if (window.DesktopCarousel && typeof DesktopCarousel.setPageCount === 'function') {
      DesktopCarousel.setPageCount(pageCount);
    }
  }

  /** 按需把页池撑到 targetCount 页（只增不减），新页自动补占位格与预览框 */
  function ensurePageCount(targetCount) {
    const n = clampInt(Math.round(Number(targetCount) || MIN_PAGES), MIN_PAGES, MAX_PAGES);
    if (!track) {
      pageCount = Math.max(pageCount, n);
      return pageCount;
    }
    for (let p = 0; p < n; p++) {
      if (getGrid(p)) continue;
      const pageEl = document.createElement('div');
      pageEl.className = 'desktop-carousel-page';
      pageEl.dataset.pageIndex = String(p);
      const gridEl = document.createElement('div');
      gridEl.className = 'desktop-grid';
      gridEl.dataset.gridPage = String(p);
      const slotsEl = document.createElement('div');
      slotsEl.className = 'grid-slots';
      slotsEl.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(slotsEl);
      pageEl.appendChild(gridEl);
      track.appendChild(pageEl);
    }
    if (n > pageCount) pageCount = n;
    buildSlots();
    ensurePreview();
    syncPageUi();
    return pageCount;
  }

  /** 排除某个组件后，桌面上被真实占用的最高页码（全空返回 0） */
  function maxOccupiedPage(excludeId) {
    let maxP = 0;
    Object.keys(items).forEach((id) => {
      if (id === excludeId) return;
      const it = items[id];
      if (!it || it.stashed) return;
      if (it.page > maxP) maxP = it.page;
    });
    return maxP;
  }

  /**
   * 回收尾部空页。必须在 render() 之后调用：
   * 那时所有组件节点都已迁到各自归属页或组件库，尾部页里只剩占位格，删了不丢东西。
   */
  function pruneTrailingEmptyPages() {
    const needed = clampInt(maxOccupiedPage(null) + 1, MIN_PAGES, MAX_PAGES);
    if (needed >= pageCount) {
      syncPageUi();
      return pageCount;
    }
    // 兜底：万一还有组件节点残留在待删页里，先把它挪回第 1 页网格，绝不连组件一起删
    const fallback = getGrid(0) || getStashHolder();
    if (track) {
      Array.prototype.slice.call(track.querySelectorAll('.desktop-carousel-page')).forEach((pageEl) => {
        const idx = parseInt(pageEl.dataset.pageIndex, 10);
        if (isNaN(idx) || idx < needed) return;
        if (fallback) {
          Array.prototype.slice.call(
            pageEl.querySelectorAll('[data-grid-item], [data-app], [data-widget-id]')
          ).forEach((node) => {
            if (node.parentElement !== fallback) fallback.appendChild(node);
          });
        }
        if (pageEl.parentElement) pageEl.parentElement.removeChild(pageEl);
      });
    }
    pageCount = needed;
    syncPageUi();
    // 视口此刻可能停在已被删掉的页上，夹回最后一页
    if (viewport) {
      const maxLeft = Math.max(0, (pageCount - 1) * (viewport.clientWidth || 1));
      if (viewport.scrollLeft > maxLeft + 2) {
        if (window.DesktopCarousel && typeof DesktopCarousel.setPage === 'function') {
          DesktopCarousel.setPage(pageCount - 1, false);
        } else {
          viewport.scrollLeft = maxLeft;
        }
      }
    }
    return pageCount;
  }

  /**
   * 收进组件库的组件挂在这里：离开网格不占格，但节点保留，
   * 照片 / 名字 / 背景图等同步逻辑照常能写到它身上
   */
  function getStashHolder() {
    let holder = document.getElementById('desktopWidgetStash');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'desktopWidgetStash';
      holder.className = 'desktop-widget-stash';
      holder.hidden = true;
      holder.setAttribute('aria-hidden', 'true');
      document.body.appendChild(holder);
    }
    return holder;
  }

  /**
   * 按几何位置重排卡片索引号。
   * 规则（用户拍板）：
   *   1. 只有 card 态的普通磁贴参与编号；hero（经典红卡/酸性卡）、
   *      收进组件库的组件、以及未来新增的非卡片组件一律不算。
   *   2. icon 态（1×1 小图标）跳过，后面顺延，不占号。
   *   3. 跨页连续编号，不按页重置。
   *   4. 两位补零（01、02…），超过 99 自然显示三位。
   * 排序键：页码 → 行 → 列，即「从上往下、从左往右」，同格再按 id 稳定兜底。
   * 挂在 render() 末尾：所有布局变更（拖拽、跨页、切形态、扩页、读档、重置）
   * 最终都走 render()，因此序号永远跟位置同步，不会漏。
   */
  function refreshCardIndex() {
    const seq = Object.keys(items)
      .map((id) => items[id])
      .filter((it) => it
        && it.type === 'app'
        && !it.stashed
        && it.mode === 'card')
      .sort((a, b) => (a.page - b.page) || (a.row - b.row) || (a.col - b.col) || String(a.id).localeCompare(String(b.id)));

    seq.forEach((it, i) => {
      const el = getEl(it.id);
      if (!el) return;
      let num = el.querySelector('.bento-index');
      if (!num) {
        // 未来若新增卡片忘了写数字节点，这里补一个，位置交给 CSS 绝对定位
        num = document.createElement('span');
        num.className = 'bento-index';
        el.insertBefore(num, el.firstChild);
      }
      const text = String(i + 1).padStart(2, '0');
      if (num.textContent !== text) num.textContent = text;
    });
  }

  /** 把所有组件按 items 状态刷到 DOM 上 */
  function render() {
    Object.keys(items).forEach((id) => {
      const it = items[id];
      const el = getEl(id);
      if (!el) return;

      if (it.stashed) {
        const holder = getStashHolder();
        if (el.parentElement !== holder) holder.appendChild(el);
        el.style.gridColumn = '';
        el.style.gridRow = '';
        delete el.dataset.gridItem;
        el.classList.remove('is-hero-mode', 'is-dragging-source');
        return;
      }

      const grid = getGrid(it.page);
      if (!grid) return;

      // 组件归属页可能与当前父节点不同（跟页移动过）
      if (el.parentElement !== grid) grid.appendChild(el);

      const s = getSize(it);
      el.style.gridColumn = (it.col + 1) + ' / span ' + s.w;
      el.style.gridRow = (it.row + 1) + ' / span ' + s.h;
      el.dataset.gridItem = id;
      if (it.type === 'hero') {
        el.classList.add('is-hero-mode');
        el.classList.remove('is-icon-mode', 'is-card-mode');
      } else {
        const isIcon = it.mode === 'icon';
        el.classList.toggle('is-icon-mode', isIcon);
        el.classList.toggle('is-card-mode', !isIcon);
        el.classList.remove('is-hero-mode');
      }
    });
    ensurePreview();
    updateModeToggles();
    ensureStashToggles();
    updateLibraryBadge();
    refreshCardIndex();
  }

  /* ======================================================================
     双形态切换（仅编辑态暴露入口）
     ====================================================================== */

  const SVG_CARD = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="2.5" y="8" width="19" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '</svg>';
  const SVG_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="8.5" y="8.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '</svg>';

  /** 给所有可切换形态的磁贴注入编辑态胶囊按钮（只注入一次） */
  function ensureModeToggles() {
    Object.keys(items).forEach((id) => {
      const it = items[id];
      if (it.type === 'hero') return;
      const el = getEl(id);
      if (!el || el.querySelector('.tile-mode-toggle')) return;
      const btn = document.createElement('span');
      btn.className = 'tile-mode-toggle';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.innerHTML = '<span class="tile-mode-icon"></span>';
      el.appendChild(btn);
    });
    updateModeToggles();
  }

  /** 胶囊图标表达的是目标形态：当前卡片 → 显示小方块；当前图标 → 显示横条 */
  function updateModeToggles() {
    Object.keys(items).forEach((id) => {
      const it = items[id];
      if (it.type === 'hero') return;
      const el = getEl(id);
      if (!el) return;
      const btn = el.querySelector('.tile-mode-toggle');
      if (!btn) return;
      const target = it.mode === 'icon' ? 'card' : 'icon';
      const holder = btn.querySelector('.tile-mode-icon');
      if (holder) holder.innerHTML = target === 'card' ? SVG_CARD : SVG_ICON;
      btn.setAttribute('aria-label', target === 'card' ? '切换为卡片形态' : '切换为图标形态');
    });
  }

  function toggleItemMode(id) {
    const it = items[id];
    if (!it || it.type === 'hero') return;
    it.mode = it.mode === 'icon' ? 'card' : 'icon';
    // 形态变了尺寸也变了，立即走同一套碰撞消解
    placeItem(id, it.page, it.row, it.col);
    render();
    pruneTrailingEmptyPages();
    persist();
  }

  /* ======================================================================
     组件库：收起 / 取出（仅 hero）
     ====================================================================== */

  const SVG_STASH = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>' +
    '</svg>';

  /** 给英雄组件注入编辑态「收进组件库」按钮（只注入一次）；普通磁贴不注入 */
  function ensureStashToggles() {
    Object.keys(items).forEach((id) => {
      const it = items[id];
      if (it.type !== 'hero') return;
      const el = getEl(id);
      if (!el || el.querySelector('.tile-stash-toggle')) return;
      const btn = document.createElement('span');
      btn.className = 'tile-stash-toggle';
      btn.setAttribute('role', 'button');
      btn.setAttribute('tabindex', '0');
      btn.setAttribute('aria-label', '收进组件库');
      btn.innerHTML = SVG_STASH;
      el.appendChild(btn);
    });
  }

  function toast(kind, title, msg) {
    if (window.RetroToast && typeof RetroToast[kind] === 'function') {
      try { RetroToast[kind](title, msg); } catch (e) { /* 提示失败不影响操作 */ }
    }
  }

  function stashItem(id) {
    const it = items[id];
    if (!it || it.type !== 'hero' || it.stashed) return false;
    if (drag && drag.id === id) finishDrag();
    it.stashed = true;
    render();
    pruneTrailingEmptyPages();
    persist();
    refreshLibrary();
    toast('info', '组件已收入组件库', '可在编辑栏「组件库」里随时取用');
    return true;
  }

  function unstashItem(id) {
    const it = items[id];
    if (!it || it.type !== 'hero' || !it.stashed) return false;
    const s = getSize(it);
    const occ = buildOccupancy([id]);
    const startPage = currentPage();
    let spot = findFreeSpot(occ, s.w, s.h, startPage);
    if (!spot && pageCount < MAX_PAGES) {
      // 现有页都塞不下了：直接长一页新的取出来放，省得用户手动挪
      ensurePageCount(pageCount + 1);
      while (occ.length < pageCount) {
        const fresh = [];
        for (let r = 0; r < ROWS; r++) fresh.push(new Array(COLS).fill(null));
        occ.push(fresh);
      }
      spot = findFreeSpot(occ, s.w, s.h, pageCount - 1);
    }
    if (!spot) {
      toast('warn', '桌面空间不足', '需要连续 ' + s.w + ' 列 × ' + s.h + ' 行空位，请先腾出空间');
      return false;
    }
    it.stashed = false;
    it.page = spot.page;
    it.row = spot.row;
    it.col = spot.col;
    render();
    persist();
    closeLibrary();
    if (spot.page !== startPage) {
      if (window.DesktopCarousel && typeof DesktopCarousel.setPage === 'function') {
        DesktopCarousel.setPage(spot.page, true);
      } else if (viewport) {
        viewport.scrollTo({ left: spot.page * (viewport.clientWidth || 1), behavior: 'smooth' });
      }
    }
    return true;
  }

  /* ======================================================================
     组件库面板：底部抽屉，直接渲染组件本体的等比缩小副本
     ====================================================================== */

  const LIB_MODAL_ID = 'desktopWidgetLibraryModal';

  const SVG_LIB = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect x="3.5" y="3.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<rect x="13.5" y="3.5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '<rect x="3.5" y="13.5" width="17" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
    '</svg>';
  const SVG_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  function heroIds() {
    return Object.keys(items).filter((id) => items[id].type === 'hero');
  }

  function stashedCount() {
    return heroIds().filter((id) => items[id].stashed).length;
  }

  function updateLibraryBadge() {
    const badge = document.querySelector('.widget-lib-badge');
    if (!badge) return;
    const n = stashedCount();
    badge.textContent = String(n);
    badge.hidden = n === 0;
  }

  function getLibraryModal() {
    let modal = document.getElementById(LIB_MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = LIB_MODAL_ID;
    modal.className = 'avatar-modal-backdrop widget-lib-backdrop';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '组件库');
    modal.innerHTML =
      '<div class="avatar-modal-sheet widget-lib-sheet">' +
        '<div class="widget-lib-head">' +
          '<div class="widget-lib-title">' +
            '<span class="widget-lib-title-cn">组件库</span>' +
            '<span class="widget-lib-title-en">WIDGET LIBRARY</span>' +
          '</div>' +
          '<button type="button" class="widget-lib-close" aria-label="关闭组件库">' + SVG_CLOSE + '</button>' +
        '</div>' +
        '<div class="widget-lib-list"></div>' +
      '</div>';
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeLibrary();
    });
    modal.querySelector('.widget-lib-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeLibrary();
    });
    modal.querySelector('.widget-lib-list').addEventListener('click', (e) => {
      const btn = e.target && typeof e.target.closest === 'function'
        ? e.target.closest('[data-lib-action]') : null;
      if (!btn) return;
      e.stopPropagation();
      const id = btn.dataset.libId;
      if (btn.dataset.libAction === 'place') unstashItem(id);
      else if (btn.dataset.libAction === 'stash') stashItem(id);
    });
    document.body.appendChild(modal);
    return modal;
  }

  /**
   * 复制组件本体做预览：去掉重复 id 与编辑按钮，
   * 输入框的当前值（value 不随 cloneNode 走）手动抄过去
   */
  function buildPreviewClone(el) {
    const clone = el.cloneNode(true);
    clone.removeAttribute('id');
    delete clone.dataset.gridItem;
    clone.classList.remove('is-dragging-source', 'desktop-drag-ghost');
    clone.classList.add('is-hero-mode', 'widget-lib-clone');
    clone.style.gridColumn = '';
    clone.style.gridRow = '';
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');

    clone.querySelectorAll('.tile-stash-toggle, .tile-mode-toggle').forEach((n) => n.remove());

    const srcFields = el.querySelectorAll('input, textarea');
    const dstFields = clone.querySelectorAll('input, textarea');
    for (let i = 0; i < srcFields.length && i < dstFields.length; i++) {
      dstFields[i].value = srcFields[i].value;
      dstFields[i].setAttribute('value', srcFields[i].value);
      dstFields[i].setAttribute('tabindex', '-1');
      dstFields[i].readOnly = true;
    }
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    clone.querySelectorAll('[for]').forEach((n) => n.removeAttribute('for'));
    clone.querySelectorAll('button, a, [tabindex]').forEach((n) => n.setAttribute('tabindex', '-1'));
    return clone;
  }

  /** 按舞台宽度把 4×2 组件等比缩到面板里；参考尺寸取一页网格的宽与两行高 */
  function fitPreview(stage, clone) {
    const grid = getGrid(0);
    let baseW = 0;
    let baseH = 0;
    if (grid) {
      const rect = grid.getBoundingClientRect();
      const cs = getComputedStyle(grid);
      const gapY = parseFloat(cs.rowGap) || 0;
      baseW = rect.width;
      baseH = ((rect.height - gapY * (ROWS - 1)) / ROWS) * 2 + gapY;
    }
    if (!(baseW > 0) || !(baseH > 0)) {
      baseW = Math.min(window.innerWidth, 480) - 32;
      baseH = baseW * 0.62;
    }
    const stageW = stage.clientWidth || baseW;
    const scale = Math.min(1, stageW / baseW);
    clone.style.width = baseW + 'px';
    clone.style.height = baseH + 'px';
    clone.style.transform = 'scale(' + scale + ')';
    stage.style.height = Math.ceil(baseH * scale) + 'px';
  }

  function renderLibrary() {
    const modal = document.getElementById(LIB_MODAL_ID);
    if (!modal) return;
    const list = modal.querySelector('.widget-lib-list');
    if (!list) return;
    list.textContent = '';

    heroIds().forEach((id) => {
      const it = items[id];
      const meta = WIDGET_META[id] || { name: id, en: '' };
      const el = getEl(id);
      const s = getSize(it);

      const entry = document.createElement('div');
      entry.className = 'widget-lib-item' + (it.stashed ? ' is-stashed' : ' is-placed');

      const head = document.createElement('div');
      head.className = 'widget-lib-item-head';
      head.innerHTML =
        '<div class="widget-lib-item-name">' +
          '<span class="widget-lib-item-cn"></span>' +
          '<span class="widget-lib-item-en"></span>' +
        '</div>' +
        '<div class="widget-lib-item-tags">' +
          '<span class="widget-lib-tag">' + s.w + ' × ' + s.h + '</span>' +
          '<span class="widget-lib-tag is-state"></span>' +
        '</div>';
      head.querySelector('.widget-lib-item-cn').textContent = meta.name;
      head.querySelector('.widget-lib-item-en').textContent = meta.en;
      head.querySelector('.is-state').textContent = it.stashed ? '在库中' : '第 ' + (it.page + 1) + ' 页';
      entry.appendChild(head);

      const stage = document.createElement('div');
      stage.className = 'widget-lib-preview-stage';
      entry.appendChild(stage);

      const action = document.createElement('button');
      action.type = 'button';
      action.dataset.libId = id;
      if (it.stashed) {
        action.className = 'widget-lib-action is-primary';
        action.dataset.libAction = 'place';
        action.textContent = '放到桌面';
      } else {
        action.className = 'widget-lib-action';
        action.dataset.libAction = 'stash';
        action.textContent = '已在桌面 · 收回库中';
      }
      entry.appendChild(action);
      list.appendChild(entry);

      if (el) {
        const clone = buildPreviewClone(el);
        stage.appendChild(clone);
        fitPreview(stage, clone);
      }
    });
  }

  function openLibrary() {
    const modal = getLibraryModal();
    modal.hidden = false;
    renderLibrary();
    // 先渲染一帧再加 active，让抽屉动画生效
    requestAnimationFrame(() => {
      modal.classList.add('active');
      // 首帧时舞台宽度可能未定，动画起步后再量一次
      modal.querySelectorAll('.widget-lib-preview-stage').forEach((stage) => {
        const clone = stage.querySelector('.widget-lib-clone');
        if (clone) fitPreview(stage, clone);
      });
    });
  }

  function closeLibrary() {
    const modal = document.getElementById(LIB_MODAL_ID);
    if (!modal || modal.hidden) return;
    modal.classList.remove('active');
    setTimeout(() => {
      if (!modal.classList.contains('active')) {
        modal.hidden = true;
        const list = modal.querySelector('.widget-lib-list');
        if (list) list.textContent = '';
      }
    }, 280);
  }

  function refreshLibrary() {
    const modal = document.getElementById(LIB_MODAL_ID);
    if (modal && !modal.hidden && modal.classList.contains('active')) renderLibrary();
  }

  /* ======================================================================
     持久化
     ====================================================================== */

  function serialize() {
    const out = {};
    Object.keys(items).forEach((id) => {
      const it = items[id];
      out[id] = { page: it.page, row: it.row, col: it.col, mode: it.mode, stashed: Boolean(it.stashed) };
    });
    return { v: LAYOUT_VERSION, pages: pageCount, items: out };
  }

  function persist() {
    if (!window.Store || typeof Store.save !== 'function') return;
    try {
      const ret = Store.save(STORAGE_PATH, serialize());
      if (ret && typeof ret.catch === 'function') ret.catch(() => {});
    } catch (e) {
      /* 落盘失败不影响本次会话内的排布 */
    }
  }

  /* ======================================================================
     初始化：读档 → 消解冲突 → 落位
     ====================================================================== */

  function loadLayout() {
    let raw = null;
    try {
      raw = (window.Store && typeof Store.get === 'function') ? Store.get(STORAGE_PATH) : null;
    } catch (e) {
      raw = null;
    }
    const saved = (raw && typeof raw === 'object' && raw.items && typeof raw.items === 'object')
      ? raw.items : null;

    // 先按「默认布局 + 存档」里出现过的最大页码把页池撑够，
    // 否则占用表只有当前页数那么大，第 3 页开外的组件会被挤回来
    let needed = 1;
    DEFAULT_ITEMS.forEach((def) => {
      if (!def.stashed && def.page + 1 > needed) needed = def.page + 1;
    });
    if (saved) {
      Object.keys(saved).forEach((id) => {
        const s = saved[id];
        if (!s || typeof s !== 'object' || s.stashed) return;
        if (typeof s.page === 'number' && s.page + 1 > needed) needed = s.page + 1;
      });
    }
    if (raw && typeof raw.pages === 'number' && raw.pages > needed) needed = raw.pages;
    ensurePageCount(needed);

    const occ = emptyOcc();
    const next = {};

    DEFAULT_ITEMS.forEach((def) => {
      const it = {
        id: def.id,
        type: def.type,
        mode: def.mode,
        page: def.page,
        row: def.row,
        col: def.col,
        stashed: Boolean(def.stashed)
      };

      // 存档可能来自旧版本或被外部改坏，逐字段校验
      const s = (saved && saved[def.id] && typeof saved[def.id] === 'object') ? saved[def.id] : null;
      if (s) {
        if (typeof s.page === 'number') it.page = clampInt(s.page, 0, pageCount - 1);
        if (typeof s.mode === 'string' && it.type !== 'hero') {
          it.mode = s.mode === 'icon' ? 'icon' : 'card';
        }
        if (it.type === 'hero' && typeof s.stashed === 'boolean') it.stashed = s.stashed;
      }
      // 普通磁贴是模块唯一入口，任何情况下都不允许被收起
      if (it.type !== 'hero') it.stashed = false;

      const size = getSize(it);
      it.row = clampInt(it.row, 0, ROWS - size.h);
      it.col = clampInt(it.col, 0, COLS - size.w);
      if (s) {
        if (typeof s.row === 'number') it.row = clampInt(s.row, 0, ROWS - size.h);
        if (typeof s.col === 'number') it.col = clampInt(s.col, 0, COLS - size.w);
      }

      // 收在库里的不参与占位
      if (it.stashed) {
        next[it.id] = it;
        return;
      }

      // 存档也可能把两个组件写在同一格，逐个校验，冲突就顺延到首个空位
      if (!rectFree(occ, it.page, it.row, it.col, size.w, size.h)) {
        const spot = findFreeSpot(occ, size.w, size.h, it.page);
        if (!spot) {
          // hero 放不下就收回组件库，不丢；普通磁贴极端情况下跳过，宁可少一张也不叠着
          if (it.type === 'hero') {
            it.stashed = true;
            next[it.id] = it;
          }
          return;
        }
        it.page = spot.page;
        it.row = spot.row;
        it.col = spot.col;
      }

      markRect(occ, it.page, it.row, it.col, size.w, size.h, it.id);
      next[it.id] = it;
    });

    items = next;
  }

  /* ======================================================================
     编辑态：进入 / 退出 / 顶部操作条
     ====================================================================== */

  function buildEditBar() {
    // 浮空胶囊挂在 body 上：桌面容器带 filter/transform（全屏页时还要缩放模糊），
    // 放在里面会让 position:fixed 相对祖先定位并被一起糊掉，必须挂在 body 直下。
    const host = document.body;
    if (!host || host.querySelector('.desktop-edit-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'desktop-edit-bar';

    const libBtn = document.createElement('button');
    libBtn.type = 'button';
    libBtn.className = 'desktop-edit-btn widget-lib-trigger';
    libBtn.setAttribute('aria-label', '打开组件库');
    libBtn.innerHTML = '<span class="widget-lib-trigger-icon">' + SVG_LIB + '</span>' +
      '<span class="widget-lib-trigger-text">组件库</span>' +
      '<span class="widget-lib-badge" hidden>0</span>';
    libBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openLibrary();
    });

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'desktop-edit-btn';
    resetBtn.textContent = '重置';
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetLayout();
    });

    const doneBtn = document.createElement('button');
    doneBtn.type = 'button';
    doneBtn.className = 'desktop-edit-btn primary is-primary';
    doneBtn.textContent = '完成';
    doneBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exitEditMode();
    });

    bar.appendChild(libBtn);
    bar.appendChild(resetBtn);
    bar.appendChild(doneBtn);
    host.appendChild(bar);
    updateLibraryBadge();
  }

  function enterEditMode() {
    if (editMode) return;
    editMode = true;
    document.body.classList.add('desktop-editing');
    ensureModeToggles();
    render();
  }

  function exitEditMode() {
    if (!editMode) return;
    editMode = false;
    document.body.classList.remove('desktop-editing');
    hidePreview();
    closeLibrary();
  }

  function resetLayout() {
    const occ = emptyOcc();
    const next = {};
    DEFAULT_ITEMS.forEach((def) => {
      const it = {
        id: def.id, type: def.type, mode: def.mode,
        page: def.page, row: def.row, col: def.col,
        stashed: Boolean(def.stashed)
      };
      if (!it.stashed) {
        const s = getSize(it);
        markRect(occ, it.page, it.row, it.col, s.w, s.h, it.id);
      }
      next[it.id] = it;
    });
    items = next;
    render();
    pruneTrailingEmptyPages();
    persist();
    refreshLibrary();
  }

  /* ======================================================================
     手势：长按进编辑 / 编辑态拖拽
     ====================================================================== */

  function nowMs() {
    return (window.performance && performance.now) ? performance.now() : Date.now();
  }

  function setSuppress() {
    suppressUntil = nowMs() + CLICK_SUPPRESS_MS;
  }

  function isSuppressClick() {
    return nowMs() < suppressUntil;
  }

  /** 命中测试：从事件目标往上找带 data-grid-item 的组件 */
  function findItemEl(target) {
    if (!target || typeof target.closest !== 'function') return null;
    const el = target.closest('[data-grid-item]');
    return (el && el.dataset.gridItem) ? el : null;
  }

  function cancelPress() {
    if (press && press.timer) {
      clearTimeout(press.timer);
      press.timer = null;
    }
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!viewport) return;
    const target = e.target;
    // 形态切换胶囊 / 收进组件库按钮自己处理点击，不进长按 / 拖拽
    if (target && typeof target.closest === 'function' &&
        target.closest('.tile-mode-toggle, .tile-stash-toggle')) return;

    const itemEl = findItemEl(target);
    const id = itemEl ? itemEl.dataset.gridItem : null;

    cancelPress();
    press = {
      id: id,
      el: itemEl,
      x: e.clientX,
      y: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      timer: null
    };

    if (!editMode) {
      press.timer = setTimeout(() => {
        if (!press) return;
        press.timer = null;
        // 长按立刻进编辑态；若按在组件上，顺势把这个组件提起来
        enterEditMode();
        setSuppress();
        if (press.id) beginDrag(press.id, press.lastX, press.lastY);
      }, LONG_PRESS_MS);
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: false });
    window.addEventListener('pointercancel', onPointerUp, { passive: false });
  }

  function onPointerMove(e) {
    if (!press) return;
    press.lastX = e.clientX;
    press.lastY = e.clientY;

    if (drag) {
      e.preventDefault();
      // 拖拽期间视口不能横向滚动：手指一旦滑到边缘，浏览器会自己翻页，和贴边翻页打架
      lockViewportScroll();
      updateDrag(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // 还没进编辑态：手指一挪就放弃长按（这是滚动，不是长按）
    if (!editMode) {
      if (dist > MOVE_TOLERANCE) cancelPress();
      return;
    }
    // 编辑态：按在组件上且移动超阈值 → 开始拖拽
    if (press.id && dist > DRAG_START_PX) {
      e.preventDefault();
      beginDrag(press.id, e.clientX, e.clientY);
      lockViewportScroll();
      updateDrag(e.clientX, e.clientY);
    }
  }

  function onPointerUp(e) {
    cancelPress();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);

    if (drag) {
      finishDrag();
      setSuppress();
      press = null;
      return;
    }

    press = null;
  }

  /* ======================================================================
     拖拽实现
     ====================================================================== */

  function currentPage() {
    if (!viewport) return 0;
    const w = viewport.clientWidth || 1;
    return clampInt(Math.round(viewport.scrollLeft / w), 0, pageCount - 1);
  }

  /**
   * 手指坐标落在哪一页的第几行第几列。
   * 拖拽中强制用 drag.page（逻辑目标页），不再读 currentPage()：
   * 翻页是 0.3 秒的平滑滚动，动画中途 currentPage() 还是旧页码，
   * 而目标页的 grid 此刻还偏在屏幕外，直接取 rect 会把列算飞。
   * 网格尺寸与视口对齐，所以列按视口左缘量、行按该页网格上缘量，全程稳定。
   */
  function cellAt(x, y) {
    const page = drag ? drag.page : currentPage();
    const grid = getGrid(page);
    const refGrid = grid || getGrid(0);
    if (!refGrid) return null;
    const rect = refGrid.getBoundingClientRect();
    const cs = getComputedStyle(refGrid);
    const gapX = parseFloat(cs.columnGap) || 0;
    const gapY = parseFloat(cs.rowGap) || 0;
    const cellW = (rect.width - gapX * (COLS - 1)) / COLS;
    const cellH = (rect.height - gapY * (ROWS - 1)) / ROWS;
    if (cellW <= 0 || cellH <= 0) return null;
    // 页内容器左右各 10px 内边距，网格左缘比视口左缘更靠右，必须把这 10px 补回去
    // 列从视口左缘量：无论哪一页，页内网格左缘都和视口左缘重合，翻页动画期间也不会漂
    const originX = viewport && viewport.clientWidth
      ? viewport.getBoundingClientRect().left + (viewport.clientWidth - rect.width) / 2
      : rect.left;
    const col = Math.floor((x - originX) / (cellW + gapX));
    // 行只受纵向影响，直接量网格上缘，横向动画不干扰
    const row = Math.floor((y - rect.top) / (cellH + gapY));
    return { page: page, row: row, col: col };
  }

  function beginDrag(id, x, y) {
    const it = items[id];
    const el = getEl(id);
    if (!it || !el) return;
    const grid = getGrid(it.page);
    if (!grid) return;
    if (drag) finishDrag();

    const rect = el.getBoundingClientRect();
    drag = {
      id: id,
      grabRow: 0,
      grabCol: 0,
      ghost: null,
      rect: rect,
      // page：逻辑目标页。翻页动画没走完时它已经先到新页，落点与预览都按它算
      page: it.page,
      target: { page: it.page, row: it.row, col: it.col },
      shown: false,
      shownPage: it.page,
      lastX: x,
      lastY: y
    };

    // 记录抓取偏移：手指按在组件的第几格上
    const cell = cellAt(x, y);
    if (cell) {
      drag.grabRow = cell.row - it.row;
      drag.grabCol = cell.col - it.col;
    }

    const ghost = el.cloneNode(true);
    ghost.classList.add('desktop-drag-ghost');
    ghost.removeAttribute('data-grid-item');
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = '0px';
    ghost.style.top = '0px';
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    el.classList.add('is-dragging-source');
    document.body.classList.add('desktop-dragging');

    // 从一提起就锁住视口：非编辑态下长按 420ms 提起的瞬间手指往往已经开始横向滑动，
    // 晚一帧加锁就会被浏览器判成翻页手势，拖拽直接断掉
    lockViewportScroll();

    moveGhost(x, y);
  }

  function moveGhost(x, y) {
    if (!drag || !drag.ghost) return;
    const r = drag.rect;
    const left = x - r.width / 2;
    const top = y - r.height / 2;
    drag.ghost.style.transform = 'translate3d(' + left + 'px, ' + top + 'px, 0)';
  }

  function updateDrag(x, y) {
    if (!drag) return;
    drag.lastX = x;
    drag.lastY = y;
    moveGhost(x, y);
    handleEdge(x);
    const cell = cellAt(x, y);
    if (!cell) {
      hidePreview();
      return;
    }
    const it = items[drag.id];
    const s = getSize(it);
    const row = clampInt(cell.row - drag.grabRow, 0, ROWS - s.h);
    const col = clampInt(cell.col - drag.grabCol, 0, COLS - s.w);
    drag.target = { page: drag.page, row: row, col: col };
    showPreview(drag.page, row, col, s.w, s.h);
  }

  function showPreview(page, row, col, w, h) {
    if (!drag) return;
    if (drag.shown && drag.shownPage !== page) hidePreview();
    const prev = getPreview(page);
    if (!prev) return;
    prev.style.gridColumn = (col + 1) + ' / span ' + w;
    prev.style.gridRow = (row + 1) + ' / span ' + h;
    prev.classList.add('is-active');
    drag.shown = true;
    drag.shownPage = page;
  }

  function hidePreview() {
    const list = document.querySelectorAll('.grid-drop-preview.is-active');
    for (let i = 0; i < list.length; i++) list[i].classList.remove('is-active');
    if (drag) drag.shown = false;
  }

  function clearEdgeTimer() {
    if (edgeTimer) {
      clearTimeout(edgeTimer);
      edgeTimer = null;
    }
  }
  /**
   * 拖拽期间锁死视口横向滚动与 scroll-snap。
   * 不锁的话，手指拖到边缘时浏览器会自己接管成翻页，甚至直接抛 pointercancel 把拖拽掐断。
   * 解锁只由 finishDrag 负责，保证一次拖拽生命周期内滚动一直归我们管。
   */
  function lockViewportScroll() {
    if (!viewport || viewport.classList.contains('is-drag-locked')) return;
    viewport.classList.add('is-drag-locked');
    viewport.style.overflowX = 'hidden';
    viewport.style.scrollSnapType = 'none';
    viewport.style.touchAction = 'none';
  }
  function unlockViewportScroll() {
    if (!viewport) return;
    viewport.classList.remove('is-drag-locked');
    viewport.style.overflowX = '';
    viewport.style.scrollSnapType = '';
    viewport.style.touchAction = '';
  }
  /**
   * 贴边翻页。手指进入左右边缘带并停住 EDGE_HOLD_MS 后翻一页；
   * 只要手指还留在同侧边缘带内，就每 EDGE_REPEAT_MS 再翻一页，可以一口气从第 1 页跨到第 3 页。
   * 手指退回中间带立刻复位，重新贴边要重新停顿。
   */
  function handleEdge(x) {
    if (!viewport || !drag) return;
    const vw = viewport.clientWidth || window.innerWidth;
    const zone = EDGE_TRIGGER_PX;
    if (x >= zone && x <= vw - zone) {
      // 手指回到中间：清掉待翻计时并解锁
      clearEdgeTimer();
      edgeLocked = null;
      return;
    }
    const side = x < zone ? 'left' : 'right';
    if (edgeLocked === side) return;
    if (edgeTimer) return;
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      edgeLocked = side;
      armEdgeRepeat(side);
    }, EDGE_HOLD_MS);
  }
  /** 翻完一页后：手指还在同侧边缘就预约下一次翻页（不需要再动手指） */
  function armEdgeRepeat(side) {
    if (!drag || edgeLocked !== side) return;
    const moved = flipPage(side === 'left' ? -1 : 1);
    if (!moved) return;
    edgeTimer = setTimeout(() => {
      edgeTimer = null;
      armEdgeRepeat(side);
    }, EDGE_REPEAT_MS);
  }
  /**
   * 翻到下一页。页码只动 drag.page，不依赖 scrollLeft；
   * 翻完立刻用最后的手指坐标重算一次落点，让目标页的预览框马上跟上来。
   */
  function flipPage(delta) {
    if (!drag) return false;
    let target = drag.page + delta;
    // 拖到最右页还继续往右推：自动长出一页空白页供落位。
    // 只有「最右页上还压着别的组件」时才建页，否则停在右边缘不松手会一口气建出一堆空页。
    if (delta > 0 && target >= pageCount && pageCount < MAX_PAGES) {
      const maxOther = maxOccupiedPage(drag.id);
      if (pageCount - 1 <= maxOther) {
        ensurePageCount(pageCount + 1);
      }
    }
    const next = clampInt(target, 0, pageCount - 1);
    if (next === drag.page) return false;
    drag.page = next;
    if (window.DesktopCarousel && typeof DesktopCarousel.setPage === 'function') {
      DesktopCarousel.setPage(next, true);
    } else if (viewport) {
      viewport.scrollTo({ left: next * (viewport.clientWidth || 1), behavior: 'smooth' });
    }
    // 手指在边缘时按边缘坐标算出的列会被夹到首/末列，等于“丢掉这一页最后一格”——把落点重新算一遍
    updateDrag(drag.lastX, drag.lastY);
    return true;
  }

  function finishDrag() {
    if (!drag) return;
    const id = drag.id;
    const target = drag.target;
    const ghost = drag.ghost;

    clearEdgeTimer();
    edgeLocked = null;
    unlockViewportScroll();

    if (ghost && ghost.parentElement) ghost.parentElement.removeChild(ghost);

    const el = getEl(id);
    if (el) el.classList.remove('is-dragging-source');
    document.body.classList.remove('desktop-dragging');

    hidePreview();

    if (items[id] && target) {
      placeItem(id, target.page, target.row, target.col);
      render();
      // 组件可能从尾部页挪走了：先回收尾部空页，再对齐视口，
      // 否则会把视口翻到一张已经被删掉的页上
      const landedPage = items[id] ? items[id].page : target.page;
      pruneTrailingEmptyPages();
      persist();
      const safePage = clampInt(landedPage, 0, pageCount - 1);
      if (safePage !== currentPage()) {
        if (window.DesktopCarousel && typeof DesktopCarousel.setPage === 'function') {
          DesktopCarousel.setPage(safePage, true);
        } else if (viewport) {
          viewport.scrollTo({ left: safePage * (viewport.clientWidth || 1), behavior: 'smooth' });
        }
      }
    }

    drag = null;
  }

  /* ======================================================================
     空白处点击退出编辑态
     ====================================================================== */

  function onViewportClick(e) {
    if (!editMode) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('.tile-mode-toggle, .tile-stash-toggle')) return;
    if (target.closest('[data-grid-item]')) return;
    // 点在网格空白 / 占位格上 → 退出编辑
    exitEditMode();
  }

  /* ======================================================================
     初始化
     ====================================================================== */

  function init() {
    if (inited) return;
    if (!viewport) return;
    inited = true;

    buildSlots();
    loadLayout();
    render();
    // 读档后收回 index.html 里多写死的空页，并把页数同步给轨道宽度与指示器
    pruneTrailingEmptyPages();
    buildEditBar();

    viewport.addEventListener('pointerdown', onPointerDown, { passive: true });
    viewport.addEventListener('click', onViewportClick);

    // 形态切换胶囊：事件委派（胶囊是被动态注入的）
    viewport.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      const btn = target.closest('.tile-mode-toggle');
      if (!btn) return;
      const itemEl = btn.closest('[data-grid-item]');
      if (!itemEl) return;
      e.stopPropagation();
      e.preventDefault();
      setSuppress();
      toggleItemMode(itemEl.dataset.gridItem);
    }, true);

    // 收进组件库按钮：同样走捕获阶段委派，抢在红卡自身的点击（换照片 / 下潜）之前
    viewport.addEventListener('click', (e) => {
      const target = e.target;
      if (!target || typeof target.closest !== 'function') return;
      const btn = target.closest('.tile-stash-toggle');
      if (!btn) return;
      const itemEl = btn.closest('[data-grid-item]');
      e.stopPropagation();
      e.preventDefault();
      setSuppress();
      if (editMode && itemEl) stashItem(itemEl.dataset.gridItem);
    }, true);

    // 组件库面板开着时，硬件返回 / Esc 先关面板
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeLibrary();
    });

    // 底部 Dock 栏：点一下先退出编辑态，不直接进模块
    const dock = document.querySelector('.tactical-dock-bar');
    if (dock) {
      dock.addEventListener('pointerdown', () => {
        if (editMode) exitEditMode();
      }, { passive: true });
    }

    // 窗口尺寸变化（旋转 / 地址栏伸缩）后重新刷新落位
    window.addEventListener('resize', () => {
      if (!drag) render();
    });
  }

  window.DesktopGrid = {
    init,
    isSuppressClick,
    enterEditMode,
    exitEditMode,
    isEditing: () => editMode,
    reset: resetLayout,
    stash: stashItem,
    unstash: unstashItem,
    openLibrary,
    closeLibrary,
    serialize
  };
})();
