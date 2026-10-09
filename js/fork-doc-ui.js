/**
 * ============================================================================
 * 溯流计划 · 副本资料调阅层 (Fork Dossier Document UI)
 *
 * 专注于下潜前的情报查阅与公文式检视：
 * 副本编号//副本名 · 概述 · 01人物情报(含脱敏高危NPC) · 02地点情报 · 03数值设定 · 04载入节点
 *
 * 遵循《工地施工协议》：
 * - 100% 纯 SVG，零 Emoji
 * - 零物理分割线
 * - iOS 灵动岛保护
 * - 纯净脱敏，不泄露后台编辑逻辑与高危标识
 * ============================================================================
 */

(function () {
  'use strict';

  // 水相评级等级对应字典
  const LEVEL_MAP = {
    EX: { letter: 'EX', zh: '特异', motif: 'chaos' },
    S: { letter: 'S', zh: '极境', motif: 'abyss' },
    A: { letter: 'A', zh: '高危', motif: 'torrent' },
    B: { letter: 'B', zh: '湍流', motif: 'cascade' },
    C: { letter: 'C', zh: '微澜', motif: 'ripple' },
    D: { letter: 'D', zh: '平水', motif: 'stream' },
    E: { letter: 'E', zh: '初识', motif: 'drop' }
  };

  // 等级徽标纯 SVG
  const LEVEL_SVGS = {
    EX: '<svg viewBox="0 0 44 44"><polygon points="22 3 39 12 39 32 22 41 5 32 5 12" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="22" cy="22" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="22" y1="7" x2="22" y2="37" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2"/><text x="22" y="25" text-anchor="middle" font-family="monospace" font-size="9" font-weight="900" fill="currentColor">EX</text></svg>',
    S: '<svg viewBox="0 0 44 44"><polygon points="22 4 38 22 22 40 6 22" fill="none" stroke="currentColor" stroke-width="1.8"/><polygon points="22 10 32 22 22 34 12 22" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="22" y="26" text-anchor="middle" font-family="monospace" font-size="12" font-weight="900" fill="currentColor">S</text></svg>',
    A: '<svg viewBox="0 0 44 44"><polygon points="22 5 38 37 6 37" fill="none" stroke="currentColor" stroke-width="1.8"/><polygon points="22 15 32 34 12 34" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="22" y="31" text-anchor="middle" font-family="monospace" font-size="12" font-weight="900" fill="currentColor">A</text></svg>',
    B: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="22" cy="22" r="11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="3 2"/><text x="22" y="26" text-anchor="middle" font-family="monospace" font-size="12" font-weight="900" fill="currentColor">B</text></svg>',
    C: '<svg viewBox="0 0 44 44"><rect x="7" y="7" width="30" height="30" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="13" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.2"/><text x="22" y="26" text-anchor="middle" font-family="monospace" font-size="12" font-weight="900" fill="currentColor">C</text></svg>',
    D: '<svg viewBox="0 0 44 44"><polygon points="22 6 37 15 37 29 22 38 7 29 7 15" fill="none" stroke="currentColor" stroke-width="1.8"/><text x="22" y="26" text-anchor="middle" font-family="monospace" font-size="12" font-weight="900" fill="currentColor">D</text></svg>',
    E: '<svg viewBox="0 0 44 44"><circle cx="22" cy="22" r="16" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M22 10 C22 10 14 18 14 24 A8 8 0 0 0 30 24 C30 18 22 10 22 10 Z" fill="none" stroke="currentColor" stroke-width="1.4"/><text x="22" y="26" text-anchor="middle" font-family="monospace" font-size="11" font-weight="900" fill="currentColor">E</text></svg>'
  };

  // DOM 元素引用
  let pageEl = null;
  let backBtn = null;
  let scrollEl = null;
  let codeEl = null;
  let forkTitleEl = null;
  let overviewTextEl = null;
  let mapSvgEl = null;
  let locModalOverlay = null;
  let locModalCode = null;
  let locModalName = null;
  let locModalPos = null;
  let locModalPosStrip = null;
  let locModalDesc = null;
  let locModalClose = null;
  let statsListEl = null;
  let openingTextEl = null;

  let currentFork = null;
  let currentOpeningId = null;
  let isOpened = false;

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  function init() {
    if (pageEl) return;
    pageEl = document.getElementById('forkDocPage');
    if (!pageEl) return;

    backBtn = document.getElementById('forkDocBackBtn');
    scrollEl = document.getElementById('forkDocScroll');
    codeEl = document.getElementById('forkDocCode');
    forkTitleEl = document.getElementById('forkDocForkTitle');
    overviewTextEl = document.getElementById('forkDocOverviewText');
    mapSvgEl = document.getElementById('forkDocMapSvg');
    locModalOverlay = document.getElementById('forkDocLocModal');
    locModalCode = document.getElementById('forkDocLocModalCode');
    locModalName = document.getElementById('forkDocLocModalName');
    locModalPos = document.getElementById('forkDocLocModalPos');
    locModalPosStrip = document.getElementById('forkDocLocModalPosStrip');
    locModalDesc = document.getElementById('forkDocLocModalDesc');
    locModalClose = document.getElementById('forkDocLocModalClose');
    statsListEl = document.getElementById('forkDocStatsList');
    openingTextEl = document.getElementById('forkDocOpeningText');

    if (locModalClose) {
      locModalClose.addEventListener('click', closeLocModal);
    }
    if (locModalOverlay) {
      locModalOverlay.addEventListener('click', (e) => {
        if (e.target === locModalOverlay) {
          closeLocModal();
        }
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (window.location.hash === '#fork-doc') {
          window.history.back();
        } else {
          close(true);
        }
      });
    }

    // 监听系统手势返回 / 物理返回键
    window.addEventListener('popstate', () => {
      if (!isOpened) return;
      if (locModalOverlay && locModalOverlay.classList.contains('active')) {
        closeLocModal();
        return;
      }
      if (window.location.hash === '#fork-doc') return;
      close(true);
    });
  }

  /**
   * 打开地点详情 HUD 浮层
   */
  function openLocModal(index, location) {
    if (!locModalOverlay || !location) return;
    const seqStr = String(index + 1).padStart(2, '0');
    if (locModalCode) {
      locModalCode.textContent = `LOC-${seqStr} // FIELD DOSSIER`;
    }
    if (locModalName) {
      locModalName.textContent = (location.name || '未命名地点').trim();
    }

    // 详细位置 (坐标/建筑方位)
    const position = (location.position || '').trim();
    if (locModalPos) {
      locModalPos.textContent = position || '未定锚详细坐标';
    }
    if (locModalPosStrip) {
      locModalPosStrip.style.display = position ? 'flex' : 'none';
    }

    // 详情设定 (环境/特征)
    if (locModalDesc) {
      const desc = (location.desc || location.atmosphere || '').trim();
      locModalDesc.textContent = desc || '该测绘节点暂未录入现场构型与环境描述。';
    }

    locModalOverlay.style.display = 'flex';
    locModalOverlay.hidden = false;
    locModalOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      locModalOverlay.classList.add('active');
    });
  }

  /**
   * 关闭地点详情 HUD 浮层
   */
  function closeLocModal() {
    if (!locModalOverlay) return;
    locModalOverlay.classList.remove('active');
    locModalOverlay.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!locModalOverlay.classList.contains('active')) {
        locModalOverlay.hidden = true;
        locModalOverlay.style.display = 'none';
      }
    }, 200);
  }

  /**
   * 纯 SVG 斜向不规则网格与地点拓扑地图生成 (动态适配真实像素尺寸，杜绝任何纵横拉伸压扁)
   */
  function renderTacticalMap(locations) {
    if (!mapSvgEl) return;
    mapSvgEl.innerHTML = '';

    // 动态获取容器实际渲染宽度与高度 (杜绝 preserveAspectRatio="none" 导致的形变)
    const container = mapSvgEl.parentElement || mapSvgEl;
    const width = Math.max(300, container.clientWidth || 360);
    const height = Math.max(160, container.clientHeight || 190);
    const ns = 'http://www.w3.org/2000/svg';

    // 设置等比视窗，确保 1 物理单位 = 1 真实像素
    mapSvgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const centerX = width / 2;
    const centerY = height / 2;

    // 1. 背景底层倾斜网格组 (-18度以实际中心点旋转)
    const gridGroup = document.createElementNS(ns, 'g');
    gridGroup.setAttribute('transform', `rotate(-18 ${centerX} ${centerY})`);

    // 垂直方向不规则经度网格 (疏密不均、粗细不同)
    const vSteps = [-160, -110, -65, -20, 20, 60, 105, 150, 200, 245, 290, 335, 380, 425, 470, 520, 570, 620, 680, 740];
    vSteps.forEach((x, idx) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', -200);
      line.setAttribute('x2', x);
      line.setAttribute('y2', height + 200);
      const isMajor = idx % 4 === 0;
      line.setAttribute('stroke', 'var(--primary-color)');
      line.setAttribute('stroke-width', isMajor ? '1.2' : '0.6');
      line.setAttribute('stroke-opacity', isMajor ? '0.18' : '0.07');
      gridGroup.appendChild(line);
    });

    // 水平方向不规则纬度网格 (粗细交错)
    const hSteps = [-180, -130, -85, -40, 0, 40, 80, 125, 165, 210, 255, 305, 355];
    hSteps.forEach((y, idx) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', -200);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width + 200);
      line.setAttribute('y2', y);
      const isMajor = idx % 3 === 0;
      line.setAttribute('stroke', 'var(--primary-color)');
      line.setAttribute('stroke-width', isMajor ? '1.2' : '0.6');
      line.setAttribute('stroke-opacity', isMajor ? '0.18' : '0.07');
      gridGroup.appendChild(line);
    });

    mapSvgEl.appendChild(gridGroup);

    // 2. 地点节点全画幅二维有机散布 (零连线束缚，大跨度象限跳跃打散，纯粹空间测绘)
    const locs = Array.isArray(locations) ? locations : [];
    if (locs.length === 0) {
      const emptyText = document.createElementNS(ns, 'text');
      emptyText.setAttribute('x', String(centerX));
      emptyText.setAttribute('y', String(centerY + 4));
      emptyText.setAttribute('text-anchor', 'middle');
      emptyText.setAttribute('font-family', 'var(--main-font)');
      emptyText.setAttribute('font-size', '12');
      emptyText.setAttribute('fill', 'var(--text-muted)');
      emptyText.setAttribute('opacity', '0.7');
      emptyText.textContent = '该副本未录入地点空间构型';
      mapSvgEl.appendChild(emptyText);
      return;
    }

    const count = locs.length;

    // 采用 6 列 × 3 行全画幅安全网格，大跨度对角线与全域跳跃打散，让点位真正散布在四周与深处
    const PATTERN = [
      { c: 0, r: 1 }, // 极左中
      { c: 5, r: 1 }, // 极右中
      { c: 2, r: 0 }, // 中偏左上
      { c: 4, r: 2 }, // 右下近角
      { c: 1, r: 2 }, // 左下近角
      { c: 4, r: 0 }, // 右上近角
      { c: 1, r: 0 }, // 左上近角
      { c: 3, r: 2 }, // 中偏右下
      { c: 3, r: 1 }, // 中偏右中
      { c: 2, r: 1 }, // 中偏左中
      { c: 0, r: 2 }, // 极左下
      { c: 5, r: 0 }, // 极右上
      { c: 5, r: 2 }, // 极右下
      { c: 0, r: 0 }  // 极左上
    ];

    const COLS = 6;
    const ROWS = 3;
    const MARGIN_X = 26; // 左右放宽安全边距，大幅扩大散布画幅
    const MARGIN_TOP = 38; // 避开顶部 GRID PROJECTION 标头
    const MARGIN_BOTTOM = 26; // 避开底部，预留文字呼吸空间
    const usableW = Math.max(100, width - MARGIN_X * 2);
    const usableH = Math.max(80, height - MARGIN_TOP - MARGIN_BOTTOM);
    const cellW = usableW / COLS;
    const cellH = usableH / ROWS;

    const points = locs.map((loc, i) => {
      const cell = PATTERN[i % PATTERN.length];
      // 确定性微抖动 (±20% cell)，杜绝纯网格僵硬感
      const jx = ((i * 37) % 11 - 5) / 5 * (cellW * 0.22);
      const jy = ((i * 53) % 11 - 5) / 5 * (cellH * 0.22);

      let x = Math.round(MARGIN_X + (cell.c + 0.5) * cellW + jx);
      let y = Math.round(MARGIN_TOP + (cell.r + 0.5) * cellH + jy);

      // 绝对视窗内壁安全边缘锁 (Clamping)
      x = Math.max(MARGIN_X - 6, Math.min(width - MARGIN_X + 6, x));
      y = Math.max(MARGIN_TOP - 4, Math.min(height - MARGIN_BOTTOM + 4, y));

      return {
        x,
        y,
        cell,
        loc,
        index: i
      };
    });

    // 绘制每个地点独立测绘锚点与文字标签 (零连线束缚，全自由空间探索)
    points.forEach((pt) => {
      const pinGroup = document.createElementNS(ns, 'g');
      pinGroup.setAttribute('class', 'fork-doc-loc-pin');
      pinGroup.setAttribute('tabindex', '0');
      pinGroup.setAttribute('role', 'button');
      pinGroup.setAttribute('aria-label', `查看地点 ${pt.loc.name || ''}`);

      // 外光环 (标准正圆，绝对不压扁)
      const outerCircle = document.createElementNS(ns, 'circle');
      outerCircle.setAttribute('cx', pt.x);
      outerCircle.setAttribute('cy', pt.y);
      outerCircle.setAttribute('r', '7');
      outerCircle.setAttribute('fill', 'var(--bg-color)');
      outerCircle.setAttribute('stroke', 'var(--primary-color)');
      outerCircle.setAttribute('stroke-width', '1.2');
      outerCircle.setAttribute('stroke-opacity', '0.65');
      pinGroup.appendChild(outerCircle);

      // 内核心实心圆 (标准正圆)
      const innerCircle = document.createElementNS(ns, 'circle');
      innerCircle.setAttribute('cx', pt.x);
      innerCircle.setAttribute('cy', pt.y);
      innerCircle.setAttribute('r', '3.2');
      innerCircle.setAttribute('fill', 'var(--primary-color)');
      pinGroup.appendChild(innerCircle);

      // 地名文字标签：智能避让与绝对防溢出
      const labelText = document.createElementNS(ns, 'text');
      
      // 若处于下排 (靠近底部，如 r === 2 或 y 偏下)，文字放点上方 (y - 12)，绝不向底部溢出
      // 若处于上排或中排，文字放点下方 (y + 16)
      const isNearBottom = (pt.y > height - 52) || (pt.cell.r === 2);
      const labelY = isNearBottom ? (pt.y - 12) : (pt.y + 16);

      // 左右自适应锚定：靠近极左向右延伸，靠近极右向左收敛
      let textAnchor = 'middle';
      let labelX = pt.x;
      if (pt.x < 65) {
        textAnchor = 'start';
        labelX = pt.x - 2;
      } else if (pt.x > width - 65) {
        textAnchor = 'end';
        labelX = pt.x + 2;
      }

      labelText.setAttribute('x', labelX);
      labelText.setAttribute('y', labelY);
      labelText.setAttribute('text-anchor', textAnchor);
      labelText.setAttribute('font-family', 'var(--main-font)');
      labelText.setAttribute('font-size', '10');
      labelText.setAttribute('font-weight', '700');
      labelText.setAttribute('letter-spacing', '0.2');
      labelText.setAttribute('fill', 'var(--secondary-color)');
      labelText.setAttribute('stroke', 'var(--bg-color)');
      labelText.setAttribute('stroke-width', '3');
      labelText.setAttribute('paint-order', 'stroke fill');
      // 纯地名，彻底去除序号，保持地图通透
      labelText.textContent = (pt.loc.name || '未命名地点').trim();
      pinGroup.appendChild(labelText);

      // 绑定点击事件调阅 HUD 浮层
      pinGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        openLocModal(pt.index, pt.loc);
      });

      mapSvgEl.appendChild(pinGroup);
    });
  }

  /**
   * 渲染卷宗内容
   */
  function renderDocument(data) {
    if (!data) return;

    // 1. 顶部总铭文：编号(上) + 副本名(下) + 特勤公文提要卡
    if (codeEl) {
      codeEl.textContent = (data.code || 'FORK-001').trim();
    }
    if (forkTitleEl) {
      forkTitleEl.textContent = (data.title || '未命名副本').trim();
    }

    if (overviewTextEl) {
      const overview = (data.overview || '').trim();
      overviewTextEl.textContent = overview || '暂无概要通报。';
    }

    // 2. 01 地点情报 (渲染纯 SVG 倾斜不规则网格战术构型地图)
    const locs = Array.isArray(data.locations) ? data.locations : [];
    renderTacticalMap(locs);

    // 3. 02 数值设定：全局数值设定 + 角色数值设定 (双轨特勤量程卡群)
    if (statsListEl) {
      statsListEl.innerHTML = '';

      const globalStats = Array.isArray(data.stats) ? data.stats.filter((s) => s && typeof s === 'object') : [];
      const charStats = Array.isArray(data.charStats) ? data.charStats.filter((t) => t && typeof t === 'object') : [];

      // 若两类均为空，优雅回退通用白皮书空态
      if (globalStats.length === 0 && charStats.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'fork-doc-empty-hint';
        empty.textContent = '维持通用世界法则，未载入特殊数值约束。';
        statsListEl.appendChild(empty);
      } else {
        const sectionsWrap = document.createElement('div');
        sectionsWrap.className = 'fork-doc-stats-sections';

        // 收集 NPC 与同调档案角色的全量名字映射表，确保无论何种角色均能直接显现实名
        const charNameMap = new Map();
        if (Array.isArray(data.npcs)) {
          data.npcs.forEach((n) => {
            if (n && n.id) {
              charNameMap.set(n.id, (n.name || '未命名NPC').trim());
            }
          });
        }
        if (window.Store && Store.roster) {
          const pools = [Store.roster.characters, Store.roster.npcs];
          pools.forEach((pool) => {
            (Array.isArray(pool) ? pool : []).forEach((c) => {
              if (c && c.id) {
                charNameMap.set(c.id, (c.name || '未命名角色').trim());
              }
            });
          });
        }

        // 辅助渲染单个量程仪表微卡
        const createMetricCard = (metric, boundTargetsLabel = '') => {
          const card = document.createElement('div');
          card.className = 'fork-doc-metric-card';

          const name = (metric.name || '未命名指标').trim();
          const code = (metric.code || '').trim();
          const min = metric.min != null && metric.min !== '' ? Number(metric.min) : 0;
          const max = metric.max != null && metric.max !== '' ? Number(metric.max) : 100;
          const initial = metric.initial != null && metric.initial !== '' 
            ? Number(metric.initial) 
            : (metric.init != null && metric.init !== '' ? Number(metric.init) : min);
          const desc = (metric.desc || '').trim();

          // 计算刻度指示条点亮百分比 (0% ~ 100%)
          const range = max - min;
          let pct = 0;
          if (range > 0) {
            pct = Math.max(0, Math.min(100, Math.round(((initial - min) / range) * 100)));
          } else {
            pct = 100;
          }

          let targetsHtml = '';
          if (boundTargetsLabel) {
            targetsHtml = `
              <div class="fork-doc-metric-targets">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                <span>${escapeHtml(boundTargetsLabel)}</span>
              </div>
            `;
          }

          card.innerHTML = `
            ${targetsHtml}
            <div class="fork-doc-metric-head">
              <div class="fork-doc-metric-title-wrap">
                ${code ? `<span class="fork-doc-metric-code">[${escapeHtml(code)}]</span>` : ''}
                <span class="fork-doc-metric-name">${escapeHtml(name)}</span>
              </div>
              <span class="fork-doc-metric-range-badge">[初始 ${initial} · 区间 ${min}~${max}]</span>
            </div>
            <div class="fork-doc-gauge-track" aria-hidden="true">
              <div class="fork-doc-gauge-fill" style="width: ${pct}%;"></div>
            </div>
            ${desc ? `<p class="fork-doc-metric-desc">${escapeHtml(desc)}</p>` : ''}
          `;
          return card;
        };

        // ====== 分区一：全局数值设定 ======
        if (globalStats.length > 0) {
          const group = document.createElement('div');
          group.className = 'fork-doc-stats-subgroup';
          group.innerHTML = `
            <div class="fork-doc-stats-subhead">
              <span class="fork-doc-stats-subhead-en">GLOBAL PARAMETERS</span>
              <span class="fork-doc-stats-subhead-zh">// 全局数值设定</span>
            </div>
          `;
          const grid = document.createElement('div');
          grid.className = 'fork-doc-stats-grid';
          globalStats.forEach((stat) => {
            grid.appendChild(createMetricCard(stat));
          });
          group.appendChild(grid);
          sectionsWrap.appendChild(group);
        }

        // ====== 分区二：角色数值设定 ======
        if (charStats.length > 0) {
          const group = document.createElement('div');
          group.className = 'fork-doc-stats-subgroup';
          group.innerHTML = `
            <div class="fork-doc-stats-subhead">
              <span class="fork-doc-stats-subhead-en">PERSONNEL METRICS</span>
              <span class="fork-doc-stats-subhead-zh">// 角色数值设定</span>
            </div>
          `;
          const grid = document.createElement('div');
          grid.className = 'fork-doc-stats-grid';

          charStats.forEach((tpl) => {
            const metrics = Array.isArray(tpl.metrics) ? tpl.metrics.filter((m) => m && typeof m === 'object') : [];
            if (metrics.length === 0) return;

            // 解析适用的真实角色姓名名单（直接呈现名字，去除生硬前缀）
            const boundNames = [];
            if (Array.isArray(tpl.npcIds)) {
              tpl.npcIds.forEach((id) => {
                const name = charNameMap.get(id);
                if (name && !boundNames.includes(name)) boundNames.push(name);
              });
            }
            if (Array.isArray(tpl.charIds)) {
              tpl.charIds.forEach((id) => {
                const name = charNameMap.get(id);
                if (name && !boundNames.includes(name)) boundNames.push(name);
              });
            }
            const boundLabel = boundNames.length > 0 ? boundNames.join(' · ') : '专属角色目标';

            metrics.forEach((metric) => {
              grid.appendChild(createMetricCard(metric, boundLabel));
            });
          });

          if (grid.children.length > 0) {
            group.appendChild(grid);
            sectionsWrap.appendChild(group);
          }
        }

        statsListEl.appendChild(sectionsWrap);
      }
    }

    // 6. 03 载入节点 (开场首帧)
    if (openingTextEl) {
      let openingText = '';
      const list = Array.isArray(data.openings) ? data.openings : [];

      // 按准备页指定的 openingId 精确命中；命中后只认这一套的内容，
      // 绝不因其正文留空而跨套退回根级镜像（根级存的是首套通用开场，会串台）。
      let matched = null;
      if (currentOpeningId) {
        matched = list.find((op) => op && op.id === currentOpeningId) || null;
      }

      if (matched) {
        openingText = (matched.opening || '').trim();
        if (!openingText) {
          openingText = (matched.prologue || '').trim();
        }
      } else if (list.length > 0) {
        // 未指定开场（如从挑选页直接调阅）：取首套通用开场，无通用则取首套
        const fallback = list.find((op) => !Array.isArray(op.bindRoleIds) || op.bindRoleIds.length === 0) || list[0];
        if (fallback) {
          openingText = (fallback.opening || '').trim() || (fallback.prologue || '').trim();
        }
      } else {
        // 老卷宗没有 openings 数组，读根级扁平字段
        openingText = (data.opening || '').trim();
      }

      openingTextEl.textContent = openingText || '锚点就绪，等待推演终端实时生成开场叙事。';
    }

    // 重置滚动位置至顶
    if (scrollEl) {
      scrollEl.scrollTop = 0;
    }
  }

  /**
   * 打开副本资料调阅页
   * @param {string|object} forkOrId 副本对象或副本 ID
   * @param {object} [options] 可选配置项
   * @param {string} [options.openingId] 指定高亮调阅的开场套 ID
   */
  async function open(forkOrId, options = {}) {
    init();
    if (!pageEl) return;

    currentOpeningId = (options && typeof options.openingId === 'string') ? options.openingId : null;

    let targetFork = null;
    let forkId = null;

    if (typeof forkOrId === 'object' && forkOrId !== null) {
      // 准备页传进来的通常是轻量索引对象（只有 title / code / levelKey），
      // 人物、地点、数值、开场首帧都不在里面，必须按 id 补读完整卷宗。
      targetFork = forkOrId;
      forkId = forkOrId.id || null;
    } else if (typeof forkOrId === 'string' && forkOrId) {
      forkId = forkOrId;
    }

    // 先同步亮页 + 压栈，再做异步补读：
    // 否则 await 之后才 pushState，会与上一页（准备页/挑选页）的 popstate 抢跑，
    // 导致这次返回把新压的记录一起弹掉，最终直接退回桌面（与 fork-ready 同款陷阱）。
    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      pageEl.classList.add('active');
    });
    isOpened = true;

    if (window.location.hash !== '#fork-doc') {
      window.history.pushState({ modal: 'fork-doc' }, '', '#fork-doc');
    }

    if (forkId && window.Store && typeof Store.loadForkDossier === 'function') {
      try {
        const full = await Store.loadForkDossier(forkId);
        if (full) {
          // 以完整卷宗为主，轻量索引里的展陈字段（code / seq）做兜底补齐
          targetFork = Object.assign({}, targetFork || {}, full);
        }
      } catch (err) {
        console.warn('[ForkDocUI] 卷宗补读失败，退回轻量索引：', forkId, err);
      }
    }

    // 异步补读期间用户可能已经手势返回关掉本页，落定后不再强行渲染
    if (!isOpened) return;

    if (!targetFork) {
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'DOSSIER // 读取失败',
          message: '未能检索到对应副本档案',
          type: 'error'
        });
      }
      // 空档案时收起本页并消费历史桩，退回上一级
      close();
      return;
    }

    currentFork = targetFork;
    renderDocument(currentFork);
  }

  /**
   * 关闭副本资料页
   * @param {boolean} silent 为 true 时只收起视图、不触碰 history
   */
  function close(silent) {
    if (!pageEl || !isOpened) return;
    isOpened = false;
    pageEl.classList.remove('active');

    setTimeout(() => {
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
      currentFork = null;
    }, 240);

    if (!silent && window.location.hash === '#fork-doc') {
      window.history.back();
    }
  }

  // 挂载全局对象
  window.ForkDocUI = {
    open,
    close,
    init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
