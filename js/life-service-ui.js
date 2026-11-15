/**
 * ============================================================================
 * 溯流计划 · 生活服务机能风二级总控与六大板块控制器 (Life Service UI)
 *
 * 视觉范式：
 *   - 左上双环刻度机能总控轮盘 + 01 记账主舱 (对标 Explore 72% 仪表盘)
 *   - 02 运动健康双轨横向装甲舱 (运动打卡 + 体重趋势，带 △ ○ □ 工业微标)
 *   - 03 经期生物节律相位舱 + 05 睡眠作息声波监测舱 (对标 Extra Solar & HF-Signal)
 *   - 04 药盒补给槽 + 06 订阅协议槽 (对标 Armor/Weapon 纵向条形码 + CE 认证封条)
 *
 * 铁律遵循：
 *   - 零 Emoji（全部内联 SVG 矢量图形）
 *   - 零分割线（无 border-bottom / hr）
 *   - iOS 灵动岛安全区保护
 *   - 完整 popstate 逐级返回（子舱 -> 生活服务二级总控 -> 桌面）
 * ============================================================================
 */
const LifeServiceUI = (() => {
  'use strict';

  let pageEl = null;
  let deckEl = null;
  let sheetEl = null;
  let sheetTitleEl = null;
  let sheetCodeEl = null;
  let sheetBodyEl = null;

  let isOpen = false;
  let activeModule = null; // null | 'ledger' | 'fitness' | 'period' | 'meds' | 'sleep' | 'memo'
  let pendingProgrammaticBack = false;
  let latestSnap = null;

  // 子面板内部状态
  let ledgerPrimaryTab = 'flow'; // 'flow' (流水) | 'assets' (资产)
  let ledgerTab = 'flow'; // 'flow' | 'stats' | 'hub' | 'accounts' | 'categories' | 'sub'
  let ledgerFormType = 'expense'; // 'expense' | 'income' | 'transfer' | 'refund'
  let ledgerSelectedCat = '';
  let ledgerEditRecordId = null;
  let ledgerFormOpen = false; // 表单是否展开
  let ledgerFlowLimit = 50; // 流水列表默认显示条数
  let ledgerTransferPresetToId = '';
  let ledgerTransferPresetAmt = '';
  let ledgerSearchQuery = '';
  let ledgerFilterType = 'all'; // 'all' | 'expense' | 'income' | 'transfer' | 'reimburse'
   let ledgerFilterAccId = 'all';
   let ledgerStatsDim = 'month'; // 'day' | 'week' | 'month' | 'year'
   let ledgerStatsOffset = 0;
   let ledgerStatsRankType = 'expense'; // 'expense' | 'income'
   let ledgerStatsFocusDate = ''; // 点击周柱子或月日历格选中的 YYYY-MM-DD
   let ledgerAccountEditId = null;

   // 防抖定时器（用于搜索框等高频输入事件）
   let ledgerSearchDebounceTimer = null;
  let ledgerAccountFormType = 'cash'; // 'cash' | 'debit' | 'credit'
  let ledgerCalibrateAccId = null;
  let ledgerCatTab = 'expense'; // 'expense' | 'income'
  let ledgerCatIconPick = 'food';
  let subVaultTab = 'subs'; // 'subs' | 'cards'
  let subFormOpen = false; // 订阅登记表单是否展开
  let cardFormOpen = false; // 次卡办卡表单是否展开
  let subEditId = null; // 当前编辑中的订阅项 id
  let cardEditId = null; // 当前编辑中的次卡/储值卡 id
  let subFormMode = 'recurring'; // 'recurring' | 'onetime' | 'lifetime'
  let cardFormType = 'count'; // 'count' | 'balance'
  let cardActionId = null; // 当前展开储值核销或续充面板的 cardId
  let cardActionKind = ''; // 'redeem' | 'topup'
  let fitnessTab = 'workout'; // 'workout' | 'weight'
  let memoTab = 'todo'; // 'todo' | 'wish' | 'note'

  // Feel 物理刚体句柄（无固定时长 / 无手写缓动曲线）
  let pageBody = null;
  let dialBody = null;
  let dialProgressBody = null;
  let sheetBody = null;
  let coreSpinBody = null;
  let ledgerDrawerBody = null;
  let ledgerViewBody = null;
  let footerCursorBody = null;
  let pageEnterBody = null;
  let sheetKeyboardOpen = false;
  let baseViewportH = 0;
  let baseViewportW = 0;
  const pressBodies = new WeakMap();

  // 常驻遥测微动效（Ambient Telemetry Oscillator，随页面可见性自动启停）
  let ambientRaf = 0;
  let ambientLastTs = 0;
  let ambientAcc = 0;
  let ambientTick = 0;
  let ambientInnerDeg = 0;
  let ambientPeriodDeg = -45;
  let ambientRefs = null;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;')
      .replace(/'/g, '&#39;');
  }

  /** Lieflat Lupi Basics 确定性伪随机抖动函数（确保同一数据每次渲染完全一致） */
  function lfRnd(i, k = 1) {
    const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453123;
    return x - Math.floor(x);
  }

  /** 极坐标转笛卡尔坐标（角度制，0° 在正右方，-90° 在 12 点钟方向） */
  function lfPol(cx, cy, r, deg) {
    const rad = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  }

  /** 紧凑金额格式化（用于 SVG 图内峰值与柱顶标注） */
  function lfShortAmt(v) {
    const n = Math.max(0, Number(v) || 0);
    if (n <= 0) return '';
    if (n >= 10000) return `${(n / 10000).toFixed(1)}w`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return n.toFixed(0);
  }

  /**
   * Lieflat F1 · Rung Bars 梯档柱渲染（柱身由诚实等比例横档组成，每逢第 5 档侧边打微距定位圆点，绝不断轴）
   */
  function renderLupiRungBarsSvg(items, opts = {}) {
    const {
      width = 324,
      height = 148,
      maxRungs = 16,
      xStart = 28,
      xGap = 44,
      hw = 11.5,
      baseY = 112,
      stepY = 5.2,
      pickAttr = '',
      unitPrefix = '¥'
    } = opts;

    const vals = items.map((s) => Math.max(0, Number(s.expense) || 0));
    const maxVal = Math.max(0, ...vals);
    const niceStep = maxVal > 0 ? Math.max(1, Math.ceil(maxVal / maxRungs)) : 10;

    // 底部定位锚点列（零分割线：用微圆点矩阵替代实线底轴）
    const floorDots = [];
    for (let dx = 14; dx <= width - 14; dx += 8) {
      floorDots.push(`<circle cx="${dx}" cy="${baseY + 4}" r="0.65" class="lf-dot-faint"/>`);
    }

    const colsSvg = items.map((s, idx) => {
      const cx = xStart + idx * xGap;
      const v = Math.max(0, Number(s.expense) || 0);
      const rungs = v > 0 ? Math.max(1, Math.min(maxRungs, Math.round(v / niceStep))) : 0;
      const isHero = Boolean(s.isSelected || s.isToday || s.isCurrent || (maxVal > 0 && v === maxVal));
      const strokeCls = isHero ? 'lf-stroke-hero' : 'lf-stroke-ink';

      const rungLines = [];
      for (let k = 0; k < rungs; k++) {
        const y = baseY - k * stepY;
        const w = hw - 1.2 + lfRnd(k + 1, idx + 2) * 2.4;
        const op = (0.56 + lfRnd(k + 2, idx + 4) * 0.44).toFixed(2);
        const delay = (idx * 0.045 + k * 0.012).toFixed(3);
        rungLines.push(
          `<line x1="${(cx - w).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(cx + w).toFixed(1)}" y2="${y.toFixed(1)}" class="${strokeCls} lf-fade" style="opacity:${op};animation-delay:${delay}s"/>`
        );
        if (k % 5 === 4) {
          rungLines.push(
            `<circle cx="${(cx + hw + 3.6).toFixed(1)}" cy="${y.toFixed(1)}" r="0.85" class="lf-dot-faint lf-fade" style="animation-delay:${delay}s"/>`
          );
        }
      }

      // 空值日保留底部 1 根微弱刻度短桩，诚实表明当日读数为 0
      if (rungs === 0) {
        rungLines.push(
          `<line x1="${(cx - 4).toFixed(1)}" y1="${baseY}" x2="${(cx + 4).toFixed(1)}" y2="${baseY}" class="lf-stroke-faint"/>`
        );
      }

      const topY = rungs > 0 ? baseY - (rungs - 1) * stepY : baseY;
      const valTxt = lfShortAmt(v);
      const clickAttr = pickAttr && s.key ? ` ${pickAttr}="${esc(s.key)}" style="cursor:pointer;"` : '';

      return `
        <g class="life-chart-col-group"${clickAttr}>
          <rect x="${(cx - xGap * 0.44).toFixed(1)}" y="10" width="${(xGap * 0.88).toFixed(1)}" height="${baseY + 26}" fill="transparent"/>
          ${rungLines.join('')}
          ${valTxt ? `<text x="${cx}" y="${Math.max(13, topY - 7).toFixed(1)}" text-anchor="middle" class="life-svg-val-txt ${isHero ? 'is-hi' : ''} lf-halo lf-fade" style="animation-delay:${(0.18 + idx * 0.04).toFixed(2)}s">${esc(valTxt)}</text>` : ''}
          <text x="${cx}" y="${baseY + 17}" text-anchor="middle" class="life-svg-axis-txt ${isHero ? 'is-hi' : ''}">${esc(s.label)}</text>
          ${s.subLabel ? `<text x="${cx}" y="${baseY + 28}" text-anchor="middle" class="life-svg-sub-txt">${esc(s.subLabel)}</text>` : ''}
        </g>
      `;
    }).join('');

    const unitNote = maxVal > 0
      ? `ONE RUNG ≈ ${unitPrefix}${niceStep} · DOT MARKS EVERY 5TH`
      : 'ZERO SPEND IN PERIOD · NO RUNGS STACKED';

    return {
      svg: `
        <svg class="life-stats-svg-bar" viewBox="0 0 ${width} ${height}" aria-label="Rung Bars 梯档趋势图">
          ${floorDots.join('')}
          ${colsSvg}
        </svg>
      `,
      caption: unitNote
    };
  }

  /**
   * Lieflat F2/F3 · Hairline Area + Peak Callout 逐日发丝脉冲图（月度 28~31 天）
   */
  function renderLupiMonthHairlineSvg(dayCells, selectedKey, unitPrefix = '¥') {
    const days = (dayCells || []).filter((c) => !c.empty);
    const N = days.length || 30;
    const width = 324;
    const height = 128;
    const baseY = 98;
    const maxH = 68;
    const xOf = (i) => (N > 1 ? 16 + (i * (width - 32)) / (N - 1) : width / 2);

    const vals = days.map((d) => Math.max(0, Number(d.expense) || 0));
    const maxVal = Math.max(0, ...vals);
    const yOf = (v) => (maxVal > 0 ? baseY - (v / maxVal) * maxH : baseY);

    // 选出最多 2 个相隔至少 5 天的消费峰值日做标注（遵循 SKILL.md 防标签重叠硬规则）
    const peakIndices = [];
    if (maxVal > 0) {
      const sortedIdx = vals.map((_, i) => i).filter((i) => vals[i] > 0).sort((a, b) => vals[b] - vals[a]);
      for (const idx of sortedIdx) {
        if (peakIndices.every((p) => Math.abs(p - idx) >= 5)) {
          peakIndices.push(idx);
        }
        if (peakIndices.length === 2) break;
      }
    }

    const stems = [];
    const dots = [];
    const hitRects = [];
    const stepW = N > 1 ? (width - 32) / (N - 1) : 12;

    days.forEach((d, i) => {
      const cx = xOf(i);
      const v = vals[i];
      const cy = yOf(v);
      const dt = new Date(d.dateKey + 'T00:00:00');
      const wd = dt.getDay();
      const isWeekend = wd === 0 || wd === 6;
      const isPeak = peakIndices.includes(i);
      const isSel = selectedKey && selectedKey === d.dateKey;
      const delay = (i * 0.011).toFixed(3);

      // 日历地板微刻度（每天一根发丝短桩，无论当日有无消费）
      stems.push(
        `<line x1="${cx.toFixed(1)}" y1="${baseY}" x2="${cx.toFixed(1)}" y2="${(baseY + 4.5).toFixed(1)}" class="lf-stroke-faint"/>`
      );

      // 逐日节点（周末空心圆，工作日实心圆，峰值/选中放大）
      if (v > 0 || isSel || d.isToday) {
        const r = isSel ? 3.8 : isPeak ? 3.2 : 1.75;
        const cls = isSel || isPeak
          ? (isWeekend ? 'lf-dot-weekend-hero' : 'lf-dot-hero')
          : (isWeekend ? 'lf-dot-weekend' : 'lf-dot-ink');
        dots.push(
          `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r}" class="${cls} lf-pop" style="animation-delay:${(0.12 + i * 0.012).toFixed(3)}s"/>`
        );
      }

      if (isPeak) {
        dots.push(
          `<text x="${cx.toFixed(1)}" y="${Math.max(12, cy - 7).toFixed(1)}" text-anchor="middle" class="life-svg-val-txt is-hi lf-halo lf-fade" style="animation-delay:0.45s">${esc(unitPrefix + lfShortAmt(v))}</text>`
        );
      }

      hitRects.push(
        `<rect x="${(cx - stepW / 2).toFixed(1)}" y="8" width="${Math.max(8, stepW).toFixed(1)}" height="${baseY + 8}" fill="transparent" data-stats-pick-date="${esc(d.dateKey)}" style="cursor:pointer;"/>`
      );
    });

    const polyPts = vals.map((v, i) => `${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' L ');
    const contourPath = maxVal > 0
      ? `<path d="M ${polyPts}" fill="none" pathLength="1" class="lf-contour-path lf-draw"/>`
      : '';

    const midIdx = Math.floor((N - 1) / 2);
    const axisMarks = [0, midIdx, N - 1].filter((v, idx, arr) => v >= 0 && arr.indexOf(v) === idx);
    const axisSvg = axisMarks.map((idx) => {
      const cell = days[idx];
      if (!cell) return '';
      const anchor = idx === 0 ? 'start' : idx === N - 1 ? 'end' : 'middle';
      return `<text x="${xOf(idx).toFixed(1)}" y="${baseY + 18}" text-anchor="${anchor}" class="life-svg-sub-txt">${esc(cell.dateKey.slice(5).replace('-', '.'))}</text>`;
    }).join('');

    return `
      <svg class="life-stats-svg-bar" viewBox="0 0 ${width} ${height}" aria-label="月度逐日发丝脉冲图">
        ${stems.join('')}
        ${contourPath}
        ${dots.join('')}
        ${axisSvg}
        ${hitRects.join('')}
      </svg>
    `;
  }

  /**
   * Lieflat F4 · Tick Donut 百刻环形表盘（100 根放射刻度，1 tick = 1%，中心显示总额）
   */
  function renderLupiTickDonutSvg(ranking, totalAmount, curSym, rankType) {
    if (!ranking || !ranking.length || totalAmount <= 0) return '';

    // 合并前 5 类 + 其余归为 OTHER，保证扇区与外圈虚线引出标签清晰不重叠（遵循 SKILL.md ≤6 段规则）
    const topItems = ranking.slice(0, 5).map((r) => ({ name: r.name, amount: r.amount }));
    if (ranking.length > 5) {
      const restAmt = ranking.slice(5).reduce((s, r) => s + r.amount, 0);
      if (restAmt > 0) topItems.push({ name: '其他长尾', amount: restAmt });
    }

    // 诚实整数分配 100 根 tick（最大余数法保证总和精确 = 100）
    const rawShares = topItems.map((it) => (it.amount / totalAmount) * 100);
    const ticksArr = rawShares.map((v) => Math.max(1, Math.floor(v)));
    let sumTicks = ticksArr.reduce((a, b) => a + b, 0);
    const remainders = rawShares.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem);
    let ptr = 0;
    while (sumTicks < 100 && remainders.length) {
      ticksArr[remainders[ptr % remainders.length].i] += 1;
      sumTicks += 1;
      ptr += 1;
    }
    while (sumTicks > 100) {
      const maxIdx = ticksArr.indexOf(Math.max(...ticksArr));
      if (ticksArr[maxIdx] > 1) {
        ticksArr[maxIdx] -= 1;
        sumTicks -= 1;
      } else break;
    }

    const cx = 162;
    const cy = 92;
    const R0 = 46;
    const shadeClasses = ['lf-seg-0', 'lf-seg-1', 'lf-seg-2', 'lf-seg-3', 'lf-seg-4', 'lf-seg-5'];

    let k0 = 0;
    const tickEls = [];
    const labelCandidates = [];

    topItems.forEach((it, si) => {
      const v = ticksArr[si];
      const cls = shadeClasses[Math.min(si, shadeClasses.length - 1)];
      for (let k = 0; k < v; k++) {
        const idx = k0 + k;
        const deg = idx * 3.6 - 90;
        const len = 8.5 + lfRnd(idx + 1, si + 2) * 5.2;
        const [x1, y1] = lfPol(cx, cy, R0, deg);
        const [x2, y2] = lfPol(cx, cy, R0 + len, deg);
        tickEls.push(
          `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="lf-donut-tick ${cls} lf-fade" style="animation-delay:${(idx * 0.007).toFixed(3)}s"/>`
        );
        if (idx % 10 === 0) {
          const [dx, dy] = lfPol(cx, cy, R0 - 4.5, deg);
          tickEls.push(`<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="0.85" class="lf-dot-faint"/>`);
        }
      }

      // 外圈引线标签仅对占比 >= 7% 的分段打标，避免小扇区拥挤重叠
      if (v >= 7 || si === 0) {
        const midDeg = (k0 + v / 2) * 3.6 - 90;
        const [gx, gy] = lfPol(cx, cy, R0 + 16, midDeg);
        const [lx, ly] = lfPol(cx, cy, R0 + 28, midDeg);
        const cosV = Math.cos((midDeg * Math.PI) / 180);
        const side = cosV >= 0 ? 'R' : 'L';
        labelCandidates.push({
          si,
          cls,
          name: it.name.length > 5 ? it.name.slice(0, 5) : it.name,
          pct: v,
          gx,
          gy,
          lx,
          ly,
          side
        });
      }
      k0 += v;
    });

    // 左右两侧标签纵向最小间距 13px 防重叠修正
    ['L', 'R'].forEach((side) => {
      const group = labelCandidates.filter((c) => c.side === side).sort((a, b) => a.ly - b.ly);
      for (let i = 1; i < group.length; i++) {
        if (group[i].ly - group[i - 1].ly < 13) {
          group[i].ly = group[i - 1].ly + 13;
        }
      }
    });

    const labelEls = labelCandidates.map((c) => {
      const anchor = c.side === 'R' ? 'start' : 'end';
      const tx = c.side === 'R' ? Math.max(c.lx + 3, cx + R0 + 24) : Math.min(c.lx - 3, cx - R0 - 24);
      return `
        <line x1="${c.gx.toFixed(1)}" y1="${c.gy.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${c.ly.toFixed(1)}" class="lf-leader-line"/>
        <text x="${tx.toFixed(1)}" y="${(c.ly + 3).toFixed(1)}" text-anchor="${anchor}" class="lf-donut-lbl ${c.cls} lf-halo">${esc(c.name)} · ${c.pct}%</text>
      `;
    });

    const centerVal = totalAmount >= 10000
      ? `${(totalAmount / 10000).toFixed(1)}w`
      : totalAmount.toFixed(0);

    return `
      <div class="life-lupi-donut-wrap">
        <svg class="life-stats-svg-bar" viewBox="0 0 324 186" aria-label="100刻度占比环形表盘">
          ${tickEls.join('')}
          ${labelEls.join('')}
          <text x="${cx}" y="${cy - 1}" text-anchor="middle" class="lf-donut-center-val">${esc(curSym + centerVal)}</text>
          <text x="${cx}" y="${cy + 12}" text-anchor="middle" class="lf-donut-center-sub">${rankType === 'income' ? 'INCOME' : 'EXPENSE'}</text>
        </svg>
        <div class="life-lupi-footnote is-spread">
          <span>1 TICK = 1%</span>
          <span>DOT = 10TH</span>
          <span>12:00 CW</span>
        </div>
      </div>
    `;
  }

  /**
   * Lieflat F5 · Tick Rows 刻度队列条（1 格刻度 = 2.5%，共 40 槽，每 5 根打微点定位）
   */
  function renderLupiTickRowSvg(ratioPct, rowIndex) {
    const totalSlots = 40;
    const filled = Math.max(ratioPct > 0 ? 1 : 0, Math.min(totalSlots, Math.round((ratioPct / 100) * totalSlots)));
    const els = [];
    const x0 = 4;
    const px = 7.4;
    const baseY = 14;

    for (let k = 0; k < totalSlots; k++) {
      const x = x0 + k * px;
      if (k < filled) {
        const h = 7.5 + lfRnd(k + 1, rowIndex + 2) * 4.5;
        const op = (0.62 + lfRnd(k + 3, rowIndex + 5) * 0.38).toFixed(2);
        const cls = rowIndex === 0 ? 'lf-stroke-hero' : 'lf-stroke-ink';
        els.push(
          `<line x1="${x.toFixed(1)}" y1="${baseY}" x2="${x.toFixed(1)}" y2="${(baseY - h).toFixed(1)}" class="${cls}" style="stroke-width:2.5;stroke-linecap:butt;opacity:${op}"/>`
        );
      } else {
        els.push(
          `<line x1="${x.toFixed(1)}" y1="${baseY}" x2="${x.toFixed(1)}" y2="${baseY - 2.6}" class="lf-stroke-faint" style="stroke-width:1.5;stroke-linecap:butt"/>`
        );
      }
      if (k % 5 === 4) {
        els.push(`<circle cx="${x.toFixed(1)}" cy="${baseY + 3.4}" r="0.95" class="lf-dot-faint"/>`);
      }
    }

    return `<svg class="life-tick-row-svg" viewBox="0 0 302 19" aria-hidden="true">${els.join('')}</svg>`;
  }

  /** 生成矢量条形码 SVG (对标图 1 底部装甲条形码) */
  function svgBarcode() {
    return `
      <svg class="life-barcode-svg" viewBox="0 0 120 24" aria-hidden="true">
        <rect x="0" y="2" width="4" height="20"/>
        <rect x="7" y="2" width="2" height="20"/>
        <rect x="12" y="2" width="6" height="20"/>
        <rect x="21" y="2" width="2" height="20"/>
        <rect x="26" y="2" width="4" height="20"/>
        <rect x="33" y="2" width="8" height="20"/>
        <rect x="44" y="2" width="2" height="20"/>
        <rect x="49" y="2" width="4" height="20"/>
        <rect x="56" y="2" width="6" height="20"/>
        <rect x="65" y="2" width="2" height="20"/>
        <rect x="70" y="2" width="8" height="20"/>
        <rect x="81" y="2" width="3" height="20"/>
        <rect x="87" y="2" width="5" height="20"/>
        <rect x="95" y="2" width="2" height="20"/>
        <rect x="100" y="2" width="6" height="20"/>
        <rect x="109" y="2" width="3" height="20"/>
        <rect x="115" y="2" width="5" height="20"/>
      </svg>
    `;
  }

  /** 生成 △ ○ □ 工业几何微标 SVG (对标图 1 / 图 3) */
  function svgGeoMarkers() {
    return `
      <svg viewBox="0 0 42 12" aria-hidden="true">
        <polygon points="6,1 11,11 1,11" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="21" cy="6" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <rect x="31" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
      </svg>
    `;
  }

  const LEDGER_ICON_KEYS = [
    'wallet', 'bolt', 'bank', 'credit',
    'food', 'drink', 'transit', 'bag',
    'sparkle', 'home', 'game', 'medical',
    'chip', 'paw', 'gift', 'book',
    'salary', 'award', 'briefcase', 'trend', 'layers'
  ];

  /** 纯内联矢量财务与收支分类图标库（零 Emoji） */
  function svgLedgerIcon(iconKey) {
    const k = String(iconKey || 'layers');
    const paths = {
      wallet: '<path d="M3 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3V6zm0 0V4h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><circle cx="16.5" cy="12" r="1.4" fill="currentColor"/>',
      bolt: '<polygon points="13,2 4,13.5 11.5,13.5 10.5,22 20,10.5 12.5,10.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>',
      bank: '<polygon points="12,3 21,8 3,8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><path d="M5 8v9M9.5 8v9M14.5 8v9M19 8v9M2.5 19.5h19" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      credit: '<rect x="2.5" y="5" width="19" height="14" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="2.5" y1="9.5" x2="21.5" y2="9.5" stroke="currentColor" stroke-width="2"/><line x1="6" y1="15" x2="11" y2="15" stroke="currentColor" stroke-width="1.8"/>',
      food: '<path d="M7 3v7a2.5 2.5 0 0 0 5 0V3M9.5 3v18M16.5 3c2 2.5 2 6.5 0 9v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>',
      drink: '<path d="M5 8h11v6a5.5 5.5 0 0 1-11 0V8zm11 1.5h2.5a2 2 0 0 1 0 4H16M8 3.5l1.5 2.5M12.5 3.5L14 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/>',
      transit: '<rect x="4" y="3.5" width="16" height="13" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="4" y1="11" x2="20" y2="11" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="14" r="1.2" fill="currentColor"/><circle cx="16" cy="14" r="1.2" fill="currentColor"/><path d="M7 16.5L5 20.5M17 16.5l2 4" stroke="currentColor" stroke-width="1.8"/>',
      bag: '<rect x="4.5" y="7.5" width="15" height="13" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 7.5V6a3.5 3.5 0 0 1 7 0v1.5" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      sparkle: '<path d="M12 2.5l2.4 6.1 6.1 2.4-6.1 2.4-2.4 6.1-2.4-6.1-6.1-2.4 6.1-2.4L12 2.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="miter"/>',
      home: '<path d="M3 11l9-7.5L21 11M5.5 9.5V20h13V9.5M10 20v-5.5h4V20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>',
      game: '<rect x="2.5" y="7" width="19" height="10" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 12h4M8.5 10v4" stroke="currentColor" stroke-width="1.8"/><circle cx="15.5" cy="11" r="1.2" fill="currentColor"/><circle cx="17.8" cy="13" r="1.2" fill="currentColor"/>',
      medical: '<rect x="3.5" y="3.5" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2"/>',
      chip: '<rect x="6.5" y="6.5" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="9.5" y="9.5" width="5" height="5" fill="currentColor"/><path d="M9 3v3.5M15 3v3.5M9 17.5V21M15 17.5V21M3 9h3.5M3 15h3.5M17.5 9H21M17.5 15H21" stroke="currentColor" stroke-width="1.6"/>',
      paw: '<circle cx="12" cy="14.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6.5" cy="9.5" r="1.5" fill="currentColor"/><circle cx="10" cy="7" r="1.5" fill="currentColor"/><circle cx="14" cy="7" r="1.5" fill="currentColor"/><circle cx="17.5" cy="9.5" r="1.5" fill="currentColor"/>',
      gift: '<rect x="3.5" y="9.5" width="17" height="11" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="2.5" y="6" width="19" height="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="12" y1="6" x2="12" y2="20.5" stroke="currentColor" stroke-width="1.8"/><path d="M12 6C9.5 6 8 4.5 8 3.5S9.5 2 12 4.5C14.5 2 16 2.5 16 3.5S14.5 6 12 6z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
      book: '<path d="M4 4.5h6.5a2 2 0 0 1 1.5.8 2 2 0 0 1 1.5-.8H20v14h-6.5a2 2 0 0 0-1.5.8 2 2 0 0 0-1.5-.8H4v-14zm8 .8v13.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>',
      salary: '<rect x="2.5" y="5.5" width="19" height="13" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 9h1.5M17 15h1.5" stroke="currentColor" stroke-width="1.8"/>',
      award: '<circle cx="12" cy="9.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 14.5L7.5 21l4.5-2.3L16.5 21 15 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>',
      briefcase: '<rect x="3" y="7" width="18" height="13" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 7V4.5h7V7M3 12.5h18" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      trend: '<polyline points="3,17 9,11 13,14.5 20.5,6.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/><polyline points="15.5,6.5 20.5,6.5 20.5,11.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/>',
      transfer: '<path d="M4 9h15l-3.5-3.5M20 15H5l3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"/>',
      refund: '<path d="M9 7L4.5 11.5 9 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><path d="M5 11.5h10.5a4.5 4.5 0 0 1 0 9H12" fill="none" stroke="currentColor" stroke-width="1.8"/>',
      subpass: '<rect x="3" y="5" width="18" height="14" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 10h6M7 14h4" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="12" r="2" fill="currentColor"/>',
      layers: '<polygon points="12,3.5 21,8.5 12,13.5 3,8.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><polyline points="3,13 12,18 21,13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>'
    };
    return `<svg class="life-vec-ico" viewBox="0 0 24 24" aria-hidden="true">${paths[k] || paths.layers}</svg>`;
  }

  const SVG_CHEVRON_DOWN = '<svg class="life-picker-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></svg>';
  const SVG_CALENDAR_MINI = '<svg class="life-picker-cal" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="3" y1="10" x2="21" y2="10" stroke="currentColor" stroke-width="1.8"/><line x1="8" y1="3" x2="8" y2="7" stroke="currentColor" stroke-width="1.8"/><line x1="16" y1="3" x2="16" y2="7" stroke="currentColor" stroke-width="1.8"/></svg>';

  /** 构造通用机能单选弹窗配置（账户分组 / 周期 / 校准 / 运动 / 体感 / 睡眠 / 标签） */
  function buildLifeSelectModalConfig(kind, currentVal) {
    const snap = latestSnap;
    const cur = (snap && snap.config && snap.config.currencySymbol) || '¥';
    const accounts = (snap && snap.ledger && snap.ledger.accounts) || [];

    const mapAccOption = (a) => {
      const isCredit = a.type === 'credit';
      const hint = isCredit
        ? `待还 ${cur}${Number(a.usedDebt || 0).toFixed(2)} · 可用 ${cur}${Number(a.availableCredit || 0).toFixed(0)}`
        : `余额 ${cur}${Number(a.balance || 0).toFixed(2)}`;
      const shortAmt = isCredit
        ? `欠 ${cur}${Number(a.usedDebt || 0).toFixed(0)}`
        : `${cur}${Number(a.balance || 0).toFixed(0)}`;
      return {
        value: a.id,
        label: a.name,
        displayLabel: `${a.name} · ${shortAmt}`,
        hint,
        group: isCredit ? 'CREDIT 信用与透支账户' : 'ASSET 现金与储蓄账户',
        iconSvg: svgLedgerIcon(a.iconKey || (isCredit ? 'credit' : 'wallet'))
      };
    };

    if (kind === 'filter-account') {
      return {
        title: '筛选资金账户',
        tag: 'ACCOUNT FILTER 账户过滤',
        value: currentVal || ledgerFilterAccId || 'all',
        options: [
          {
            value: 'all',
            label: '全部账户',
            displayLabel: '全部账户',
            hint: '显示所有资金与信用账户流水',
            iconSvg: svgLedgerIcon('layers')
          },
          ...accounts.map((a) => {
            const opt = mapAccOption(a);
            opt.displayLabel = a.name;
            return opt;
          })
        ]
      };
    }

    if (kind === 'account' || kind === 'from-account' || kind === 'to-account') {
      const titleMap = {
        account: '选择资金账户',
        'from-account': '选择转出(付款)账户',
        'to-account': '选择转入(收款/还款)账户'
      };
      return {
        title: titleMap[kind] || '选择资金账户',
        tag: 'ACCOUNT VAULT 资金路由',
        value: currentVal,
        options: accounts.map(mapAccOption)
      };
    }

    if (kind === 'inst-account') {
      const creditAccs = accounts.filter((a) => a.type === 'credit');
      const pool = creditAccs.length ? creditAccs : accounts;
      return {
        title: '选择分期所属账户',
        tag: 'CREDIT VAULT 信用账户',
        value: currentVal,
        options: pool.map(mapAccOption)
      };
    }

    if (kind === 'calibrate-mode') {
      return {
        title: '选择平账校准方式',
        tag: 'CALIBRATE MODE 账面平账',
        value: currentVal || 'record',
        searchable: false,
        options: [
          { value: 'record', label: '生成平账差额流水（推荐）', hint: '自动记录一笔差额平账流水，保留历史账目轨迹' },
          { value: 'initial', label: '直接修正期初余额', hint: '静默调整账户初始底数，不新增流水记录' }
        ]
      };
    }

    if (kind === 'sub-cycle') {
      return {
        title: '选择扣费周期单位',
        tag: 'BILLING CYCLE 周期设定',
        value: currentVal || 'monthly',
        searchable: false,
        options: [
          { value: 'monthly', label: 'MONTHLY · 按月续费', displayLabel: 'MONTHLY 按月', hint: '每月固定账单日自动顺延' },
          { value: 'yearly', label: 'YEARLY · 按年续费', displayLabel: 'YEARLY 按年', hint: '每年固定日期自动顺延' },
          { value: 'weekly', label: 'WEEKLY · 按周续费', displayLabel: 'WEEKLY 按周', hint: '每 7 天为一个结算周期' }
        ]
      };
    }

    if (kind === 'fitness-type') {
      return {
        title: '选择运动训练项目',
        tag: 'KINETIC TYPE 训练科目',
        value: currentVal || '有氧慢跑',
        searchable: false,
        options: [
          { value: '有氧慢跑', label: '有氧慢跑', hint: '心肺耐力与基础燃脂训练' },
          { value: '力量抗阻', label: '力量抗阻', hint: '器械/自重肌群强化训练' },
          { value: '核心燃脂', label: '核心燃脂', hint: 'HIIT 与腰腹核心稳定' },
          { value: '柔韧拉伸', label: '柔韧拉伸', hint: '瑜伽/普拉提与筋膜放松' },
          { value: '战术骑行', label: '战术骑行', hint: '户外骑行或动感单车训练' },
          { value: '快走通勤', label: '快走通勤', hint: '日常高步频有氧消耗' }
        ]
      };
    }

    if (kind === 'period-pain') {
      return {
        title: '选择周期体感状态',
        tag: 'BIORHYTHM 体感记录',
        value: currentVal || '平稳无感',
        searchable: false,
        options: [
          { value: '平稳无感', label: '平稳无感', hint: '体能与情绪状态平稳正常' },
          { value: '轻微坠胀', label: '轻微坠胀', hint: '轻度小腹坠胀或腰酸，注意保暖' },
          { value: '明显疲惫', label: '明显疲惫', hint: '精力下降，建议减少高强度消耗' },
          { value: '需热敷休养', label: '需热敷休养', hint: '痛感明显，优先休息与热敷舒缓' }
        ]
      };
    }

    if (kind === 'med-slot') {
      return {
        title: '选择每日服用时段',
        tag: 'MEDBAY SLOT 用药时段',
        value: currentVal || 'MORNING // 晨间',
        searchable: false,
        options: [
          { value: 'MORNING // 晨间', label: 'MORNING · 晨间服用', displayLabel: 'MORNING 晨间', hint: '早餐随餐或晨起空腹打卡' },
          { value: 'NOON // 午后', label: 'NOON · 午后服用', displayLabel: 'NOON 午后', hint: '午餐后或下午茶时段补给' },
          { value: 'NIGHT // 睡前', label: 'NIGHT · 睡前服用', displayLabel: 'NIGHT 睡前', hint: '晚间洗漱后或入睡前打卡' }
        ]
      };
    }

    if (kind === 'sleep-quality') {
      return {
        title: '评估睡眠深度质量',
        tag: 'HF-SIGNAL 睡眠质量',
        value: currentVal || 'DEEP // 深睡充沛',
        searchable: false,
        options: [
          { value: 'DEEP // 深睡充沛', label: 'DEEP · 深睡充沛', displayLabel: 'DEEP 深睡充沛', hint: '入睡快、深睡占比高，晨醒精神饱满' },
          { value: 'NORMAL // 平稳正常', label: 'NORMAL · 平稳正常', displayLabel: 'NORMAL 平稳正常', hint: '作息规律，整体恢复尚可' },
          { value: 'LIGHT // 多梦浅眠', label: 'LIGHT · 多梦浅眠', displayLabel: 'LIGHT 多梦浅眠', hint: '夜间易醒或多梦，次日需注意补休' }
        ]
      };
    }

    if (kind === 'memo-todo-tag') {
      return {
        title: '选择待办优先级分类',
        tag: 'CHECKLIST TAG 事项分类',
        value: currentVal || 'DAILY',
        searchable: false,
        options: [
          { value: 'DAILY', label: 'DAILY · 日常待办', displayLabel: 'DAILY 日常', hint: '生活琐事与常规日程' },
          { value: 'URGENT', label: 'URGENT · 紧急优先', displayLabel: 'URGENT 紧急', hint: '需优先处理的时效事项' },
          { value: 'WORK', label: 'WORK · 工作学习', displayLabel: 'WORK 事务', hint: '项目推进、会议与交付任务' },
          { value: 'ERRAND', label: 'ERRAND · 外出跑腿', displayLabel: 'ERRAND 跑腿', hint: '取快递、采购与线下办理' }
        ]
      };
    }

    if (kind === 'memo-wish-tag') {
      return {
        title: '选择草单分类短标',
        tag: 'SUPPLY TAG 草单归类',
        value: currentVal || 'WANT',
        searchable: false,
        options: [
          { value: 'WANT', label: 'WANT · 种草想买', displayLabel: 'WANT 种草想买', hint: '心仪好物与奖励愿望单' },
          { value: 'RESTOCK', label: 'RESTOCK · 刚需补货', displayLabel: 'RESTOCK 刚需补货', hint: '日化消耗品与定期囤货' },
          { value: 'GIFT', label: 'GIFT · 礼物清单', displayLabel: 'GIFT 礼物清单', hint: '节日纪念日与人情往来备选' }
        ]
      };
    }

    return null;
  }

  /** 渲染机能风自定义下拉触发钮（内含同名 id hidden input，零改动兼容表单读取） */
  function renderLifeSelectField({ id, kind, value, compact = false }) {
    const cfg = buildLifeSelectModalConfig(kind, value);
    const opts = (cfg && cfg.options) || [];
    const curOpt = opts.find((o) => String(o.value) === String(value)) || opts[0] || { value: value || '', label: value || '请选择' };
    const finalVal = curOpt.value != null ? curOpt.value : (value || '');
    const displayTxt = curOpt.displayLabel || curOpt.label || '请选择';
    const cls = compact ? 'life-filter-acc-trigger' : 'life-picker-trigger';
    const icoHtml = (!compact && curOpt.iconSvg) ? `<span class="life-picker-ico">${curOpt.iconSvg}</span>` : '';
    return `
      <input type="hidden" id="${esc(id)}" value="${esc(finalVal)}">
      <button type="button" class="${cls}" data-life-select-pick="${esc(kind)}" data-target-id="${esc(id)}">
        <span class="life-picker-main">
          ${icoHtml}
          <span class="life-picker-txt">${esc(displayTxt)}</span>
        </span>
        ${SVG_CHEVRON_DOWN}
      </button>
    `;
  }

  /** 渲染机能风日期选择触发钮（调起三轨 DatePickerModal） */
  function renderLifeDateField({ id, value = '', title = '选择日期', allowClear = false, placeholder = '点击选择日期' }) {
    const hasVal = Boolean(value && String(value).trim());
    const showTxt = hasVal ? value : placeholder;
    return `
      <input type="hidden" id="${esc(id)}" value="${esc(value)}">
      <button type="button" class="life-picker-trigger is-date" data-life-date-pick="${esc(id)}" data-pick-title="${esc(title)}" data-allow-clear="${allowClear ? '1' : '0'}" data-placeholder="${esc(placeholder)}">
        <span class="life-picker-main">
          <span class="life-picker-ico">${SVG_CALENDAR_MINI}</span>
          <span class="life-picker-txt ${hasVal ? '' : 'is-placeholder'}">${esc(showTxt)}</span>
        </span>
        ${SVG_CHEVRON_DOWN}
      </button>
    `;
  }

  /** 生成双环机能刻度轮盘 SVG (对标图 2 / 图 5 Explore 72%) */
  function svgReadinessDial(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    const r = 42;
    const c = 2 * Math.PI * r;
    const offset = c - (p / 100) * c;
    return `
      <svg class="life-dial-svg" viewBox="0 0 112 112" aria-hidden="true">
        <g class="life-dial-rotor" style="transform-origin: 56px 56px;">
          <!-- 外层刻度虚线环 -->
          <circle cx="56" cy="56" r="51" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="1.5" stroke-dasharray="2 4"/>
          <!-- 十字准星刻度 -->
          <path d="M56 1V7M56 105V111M1 56H7M105 56H111" stroke="currentColor" stroke-opacity="0.5" stroke-width="1.5"/>
          <!-- 顶部棘轮红色游标三角 -->
          <polygon points="56,3 59,9 53,9" fill="var(--primary-color)"/>
          <!-- 内圈精密细环 -->
          <circle class="life-dial-inner-ring" cx="56" cy="56" r="31" fill="none" stroke="currentColor" stroke-opacity="0.24" stroke-width="1" stroke-dasharray="6 3" style="transform-origin: 56px 56px;"/>
        </g>
        <!-- 轨道底环 -->
        <circle cx="56" cy="56" r="${r}" fill="none" stroke="currentColor" stroke-opacity="0.14" stroke-width="7"/>
        <!-- 动态进度主环 -->
        <circle class="life-dial-arc" cx="56" cy="56" r="${r}" fill="none" stroke="var(--primary-color)" stroke-width="7"
          stroke-linecap="butt" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          transform="rotate(-90 56 56)"/>
      </svg>
    `;
  }

  /** 渲染生活服务机能总控二级页 */
  async function renderDashboard(opts) {
    if (!deckEl || !window.LifeStore) return;
    const snap = await LifeStore.getFullSnapshot();
    latestSnap = snap;
    const cur = esc(snap.config.currencySymbol || '¥');

    // 药盒槽位点阵
    const totalMeds = Math.max(1, snap.meds.totalCount);
    let medDotsHtml = '';
    for (let i = 0; i < totalMeds; i++) {
      const done = i < snap.meds.doneCount;
      medDotsHtml += `<span class="life-meds-dot ${done ? 'done' : ''}"></span>`;
    }

    const weightStr = snap.weight.latestWeight !== null ? `${snap.weight.latestWeight}` : '--.-';
    const deltaNum = snap.weight.weightDelta;
    const deltaStr = deltaNum > 0 ? `+${deltaNum}kg` : (deltaNum < 0 ? `${deltaNum}kg` : 'STABLE');

    const sleepStr = snap.sleep.latest ? `${snap.sleep.latest.hours}` : '--';
    const memoBigVal = snap.memo.pendingCount > 0
      ? String(snap.memo.pendingCount).padStart(2, '0')
      : String(snap.memo.totalCount).padStart(2, '0');
    const memoSubLabel = snap.memo.pendingCount > 0
      ? 'PENDING · 待办与待购'
      : 'ENTRIES · 累计记录';
    const memoLatestText = snap.memo.latestActive
      ? esc(snap.memo.latestActive.title || snap.memo.latestActive.content || 'UNTITLED MEMO')
      : 'NO MEMO · 点击记录';

    deckEl.innerHTML = `
      <!-- 第一层：左双环机能轮盘 + 右 01 记账主舱 -->
      <section class="life-hero-composite">
        <div class="life-dial-pod">
          <svg class="life-dial-pod-frame" viewBox="0 0 142 176" preserveAspectRatio="none" aria-hidden="true">
            <polygon points="0.75,0.75 127.5,0.75 141.25,14.5 141.25,175.25 0.75,175.25"
              fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="miter"
              vector-effect="non-scaling-stroke"/>
          </svg>
          <div class="life-dial-pod-top">
            <span>[CORE-00]</span>
            <span>LOCAL</span>
          </div>
          <div class="life-dial-svg-wrap">
            ${svgReadinessDial(snap.readinessScore)}
            <div class="life-dial-center">
              <span class="life-dial-num">${snap.readinessScore}%</span>
              <span class="life-dial-unit">CURRENT</span>
            </div>
          </div>
          <div class="life-dial-pod-foot">
            <span>BUDGET</span>
            <span class="life-dial-foot-tag">${snap.ledger.budgetRatio}% LEFT</span>
          </div>
        </div>

        <article class="life-ledger-hero-card" data-life-module="ledger" role="button" tabindex="0">
          <span class="life-card-accent-strip"></span>
          <span class="life-watermark-num">01</span>
          <div class="life-card-head-row">
            <div class="life-slot-index-group">
              <span class="life-slot-code">01 LEDGER SYSTEM</span>
              <span class="life-slot-name">记账终端</span>
            </div>
            <svg class="life-ledger-cross-mark" viewBox="0 0 40 12" aria-hidden="true" focusable="false">
              <path d="M2 0 6 4 10 0 12 2 8 6 12 10 10 12 6 8 2 12 0 10 4 6 0 2Z" fill="currentColor" />
              <path d="M16 0 20 4 24 0 26 2 22 6 26 10 24 12 20 8 16 12 14 10 18 6 14 2Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="miter" />
              <path d="M30 0 34 4 38 0 40 2 36 6 40 10 38 12 34 8 30 12 28 10 32 6 28 2Z" fill="currentColor" />
            </svg>
          </div>

          <div class="life-ledger-main-figures">
            <div class="life-ledger-Caption">MONTHLY EXPENSE 本月累计支出</div>
            <div class="life-ledger-big-amount">${cur}${snap.ledger.monthExpense.toFixed(2)}</div>
          </div>

          <div class="life-ledger-sub-pills">
            <div class="life-mini-stat-box">
              <span class="life-mini-stat-lbl">REMAIN 预算余量</span>
              <span class="life-mini-stat-val">${cur}${snap.ledger.budgetRemain.toFixed(0)}</span>
            </div>
            <div class="life-mini-stat-box">
              <span class="life-mini-stat-lbl">INCOME 本月收入</span>
              <span class="life-mini-stat-val">${cur}${snap.ledger.monthIncome.toFixed(0)}</span>
            </div>
          </div>
        </article>
      </section>

      <!-- 第二层：02 运动健康双轨战术舱 (运动打卡 + 体重管理) -->
      <div class="life-fitness-index-wrap">
        <div class="life-fitness-fade-squares" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
          <span></span>
        </div>
        <div class="life-fitness-index-group" aria-hidden="true">
          <span class="life-fitness-index">02</span>
          <span class="life-fitness-index-label">BIO-KINETIC DECK</span>
        </div>
        <section class="life-fitness-wide-card" data-life-module="fitness" role="button" tabindex="0">
        <div class="life-fitness-top-bar">
          <div class="life-dark-card-title-wrap">
            <span class="life-acid-badge">KINETIC</span>
            <span class="life-dark-card-zh">运动健康</span>
          </div>
        </div>

        <div class="life-fitness-dual-grid">
          <div class="life-fitness-subpod">
            <div class="life-subpod-head">
              <span>运动打卡</span>
              <span>+${snap.fitness.weekSessions} WK</span>
            </div>
            <div class="life-subpod-main">
              <span class="life-subpod-big">${snap.fitness.todayMinutes}</span>
              <span class="life-subpod-unit">MIN TODAY</span>
            </div>
            <div class="life-subpod-foot">
              <span>KCAL BURNED</span>
              <span>${snap.fitness.todayCalories} KCAL</span>
            </div>
          </div>

          <div class="life-fitness-subpod">
            <div class="life-subpod-head">
              <span>体重管理</span>
              <span>${esc(deltaStr)}</span>
            </div>
            <div class="life-subpod-main">
              <span class="life-subpod-big">${esc(weightStr)}</span>
              <span class="life-subpod-unit">KG MASS</span>
            </div>
            <div class="life-subpod-foot">
              <span>TARGET GOAL</span>
              <span>${snap.weight.targetWeight} KG</span>
            </div>
          </div>
        </div>
        </section>
      </div>

      <!-- 第三层：03 经期管理（开放式引出线 Callout HUD，承接 02 右下切角） -->
      <article class="life-period-callout" data-life-module="period" role="button" tabindex="0" aria-label="经期管理">
        <div class="life-period-callout-track">
          <div class="life-period-callout-above">
            <svg class="life-period-ring-icon" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" stroke-opacity="0.22" stroke-width="2.5"/>
              <circle class="life-period-arc-rotor" cx="20" cy="20" r="17" fill="none" stroke="var(--primary-color)" stroke-width="2.5" stroke-dasharray="60 48" style="transform-origin: 20px 20px; transform: rotate(-45deg);"/>
              <circle class="life-period-core-dot" cx="20" cy="20" r="5" fill="var(--primary-color)" style="transform-origin: 20px 20px;"/>
            </svg>
            <span class="life-period-callout-index">03</span>
            <div class="life-period-callout-title-box">
              <span class="life-period-callout-en">BIO-RHYTHM MONITOR</span>
              <div class="life-period-zh-line">
                <span class="life-period-callout-zh">经期管理</span>
                <span class="life-period-title-bar" aria-hidden="true"></span>
              </div>
            </div>
          </div>

          <svg class="life-period-leader-svg" viewBox="0 0 360 46" preserveAspectRatio="none" aria-hidden="true">
            <path d="M 354 2 L 308 42 L 4 42" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
          </svg>
          <span class="life-period-leader-dot" aria-hidden="true"></span>
        </div>

        <div class="life-period-callout-below">
          <span class="life-period-phase-block">${esc(snap.period.state.phaseZh)}</span>
          <div class="life-period-telemetry">
            <div class="life-period-telemetry-main">${esc(snap.period.state.phaseCode)} DAY ${snap.period.state.dayInCycle || '--'}</div>
            <div class="life-period-telemetry-sub">NEXT PREDICT · IN ${snap.period.state.daysUntilNext} DAYS</div>
          </div>
        </div>
        <svg class="life-period-alert-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3.2 L22.2 20.4 H1.8 Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/>
          <path d="M12 9.4 V14.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="square"/>
          <circle cx="12" cy="17.4" r="1.15" fill="currentColor" stroke="none"/>
        </svg>
      </article>

      <!-- 第三层之二：04 随身药盒（裸出 Callout HUD，数据左置 / 标题右置） -->
      <article class="life-meds-callout" data-life-module="meds" role="button" tabindex="0" aria-label="随身药盒">
        <div class="life-meds-data">
          <span class="life-meds-eyebrow">MEDBAY PROTOCOL</span>
          <div class="life-meds-inline">
            <span class="life-meds-count">${snap.meds.doneCount}<span class="life-meds-big-sep">/</span>${snap.meds.totalCount}</span>
            <div class="life-meds-dots-bar">
              ${medDotsHtml}
            </div>
          </div>
        </div>
        <div class="life-meds-title-side">
          <div class="life-meds-zh">随身药盒</div>
          <div class="life-meds-en">PILLBOX MATRIX</div>
        </div>
        <span class="life-meds-index">04</span>
        <svg class="life-meds-arrow" viewBox="0 0 360 10" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="5" x2="356" y2="5" stroke="currentColor" stroke-width="1.4" vector-effect="non-scaling-stroke"/>
          <path d="M 344 1 L 356 5 L 344 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="life-meds-footer-strip">
          <span>[04] MEDBAY</span>
          <span>::</span>
          <span>SYNC.01</span>
          <span>+</span>
          <span>OK</span>
        </div>
      </article>

      <!-- 底部收官行：05 睡眠作息（左浅） + 06 订阅管理（右深）等高双联卡 -->
      <section class="life-bottom-dual-row">
        <article class="life-tactical-tile" data-life-module="sleep" role="button" tabindex="0">
          <span class="life-watermark-num">05</span>
          <div class="life-tile-top">
            <div>
              <span class="life-tile-badge">[05] DORMANT</span>
              <div class="life-slot-name" style="margin-top:6px;">睡眠作息</div>
            </div>
            <svg class="life-tile-phase-ring life-sleep-wave-svg" viewBox="0 0 40 40" aria-hidden="true">
              <rect class="life-wave-bar" x="3" y="16" width="3" height="8" fill="var(--secondary-color)" style="transform-origin: 4.5px 20px;"/>
              <rect class="life-wave-bar" x="9" y="10" width="3" height="20" fill="var(--primary-color)" style="transform-origin: 10.5px 20px;"/>
              <rect class="life-wave-bar" x="15" y="6" width="3" height="28" fill="var(--secondary-color)" style="transform-origin: 16.5px 20px;"/>
              <rect class="life-wave-bar" x="21" y="12" width="3" height="16" fill="var(--primary-color)" style="transform-origin: 22.5px 20px;"/>
              <rect class="life-wave-bar" x="27" y="8" width="3" height="24" fill="var(--secondary-color)" style="transform-origin: 28.5px 20px;"/>
              <rect class="life-wave-bar" x="33" y="15" width="3" height="10" fill="var(--secondary-color)" style="transform-origin: 34.5px 20px;"/>
            </svg>
          </div>

          <div class="life-tile-body">
            <div class="life-tile-status-zh">${esc(sleepStr)} H</div>
            <div class="life-tile-status-en">7D AVG ${snap.sleep.avgHours}H</div>
          </div>

          <div class="life-tile-foot-strip">
            <span>GOAL ${snap.sleep.goalHours}H</span>
            <span>LOG</span>
          </div>
        </article>

        <article class="life-armor-card variant-primary" data-life-module="memo" role="button" tabindex="0">
          <div class="life-armor-inner">
            <div>
              <div class="life-armor-top">
                <span class="life-armor-spec">[06] MEMO</span>
                <span class="life-acid-badge">NOTE</span>
              </div>
              <div class="life-armor-name-block">
                <div class="life-armor-zh">备忘录</div>
                <div class="life-armor-en">MEMO MATRIX</div>
              </div>
            </div>

            <div class="life-armor-metric">
              <div class="life-armor-big-val">${memoBigVal}</div>
              <div class="life-armor-sub-desc">${memoSubLabel}</div>
              <div class="life-armor-sub-desc life-armor-sub-nearest">
                ${memoLatestText}
              </div>
            </div>
          </div>

          <div class="life-armor-barcode-band">
            ${svgBarcode()}
            <span class="life-ce-stamp">CE 06</span>
          </div>
        </article>
      </section>
    `;

    mountDeckPhysics(snap.readinessScore, opts && opts.entrance);
  }

  /* ========================================================================
     Feel 物理引擎挂载（无手写时长，全部由质量/刚度/阻尼/磁吸力场求解）
     ======================================================================== */

  function mountDeckPhysics(readinessScore, runEntrance) {
    if (!window.Feel || !deckEl) return;

    // 1. 左上角双环刻度轮盘：360° 无限周期棘轮磁吸旋钮 (feel: "heavy, clicky")
    const dialWrap = deckEl.querySelector('.life-dial-svg-wrap');
    const rotorEl = deckEl.querySelector('.life-dial-rotor');
    const arcEl = deckEl.querySelector('.life-dial-arc');
    const numEl = deckEl.querySelector('.life-dial-num');
    const unitEl = deckEl.querySelector('.life-dial-unit');

    if (dialWrap && rotorEl) {
      if (dialBody) Feel.loop.remove(dialBody);
      const stops = Array.from({ length: 12 }, (_, i) => i * 30);
      const w = Feel.words('heavy, clicky');
      const strength = w.magnet || 0.6;
      const field = Feel.magnets({
        stops,
        period: 360,
        reachFreq: 0.6 + 0.5 * strength,
        clickFreq: 3 + 4 * strength,
        clickRadius: 10
      });

      dialBody = new Feel.Body({
        ...w.params,
        unit: '°',
        x: 0,
        target: null,
        forces: [field],
        onFrame: (b) => {
          rotorEl.style.transform = `rotate(${b.x.toFixed(2)}deg)`;
          if (unitEl) {
            const speed = Math.abs(b.v);
            if (speed > 25) {
              const norm = (((Math.round(b.x) % 360) + 360) % 360);
              unitEl.textContent = `${String(norm).padStart(3, '0')}°`;
            } else {
              unitEl.textContent = 'CURRENT';
            }
          }
        }
      });

      Feel.drag(dialWrap, dialBody, {
        axis: 'angle',
        onTap: () => {
          dialBody.kick(420);
          spinHeaderCore(520);
        }
      });

      if (runEntrance) {
        dialBody.kick(260);
      }
    }

    // 2. 进度主环弹簧充能（从 0 弹向 readinessScore%）
    if (arcEl && numEl) {
      if (dialProgressBody) Feel.loop.remove(dialProgressBody);
      const targetP = Math.max(0, Math.min(100, Number(readinessScore) || 0));
      const r = 42;
      const c = 2 * Math.PI * r;
      const startP = runEntrance ? 0 : targetP;

      dialProgressBody = new Feel.Body({
        feel: 'bouncy',
        x: startP,
        target: startP,
        min: 0,
        max: 100,
        onFrame: (b) => {
          const clamped = Math.max(0, Math.min(100, b.x));
          const offset = c - (clamped / 100) * c;
          arcEl.setAttribute('stroke-dashoffset', offset.toFixed(1));
          numEl.textContent = `${Math.round(clamped)}%`;
        }
      });
      if (runEntrance) {
        dialProgressBody.to(targetP);
      }
    }

    // 3. 机甲插槽依次落位弹簧（Deck Entrance Stagger）
    if (runEntrance) {
      const blocks = Array.from(deckEl.children);
      blocks.forEach((el, idx) => {
        const startY = 26 + idx * 14;
        el.style.opacity = '0';
        const b = new Feel.Body({
          feel: idx % 2 === 0 ? 'weighty, snappy' : 'bouncy',
          x: startY,
          target: 0,
          v: -120 - idx * 35,
          onFrame: (body) => {
            const prog = Math.max(0, Math.min(1, 1 - body.x / startY));
            el.style.transform = `translateY(${body.x.toFixed(2)}px)`;
            el.style.opacity = prog.toFixed(3);
          },
          onSettle: () => {
            el.style.transform = '';
            el.style.opacity = '';
          }
        });
        b.wake();
      });
      spinHeaderCore(680);
    }

    // 4. 全部可交互卡片绑定真实物理按压与弹性回弹（替代 CSS scale 过渡）
    const cards = deckEl.querySelectorAll('[data-life-module]');
    cards.forEach((card) => bindTactileCard(card));

    // 5. 04 药盒通栏长箭头：悬浮/按下时受脉冲向右蓄力回弹
    const medsCard = deckEl.querySelector('.life-meds-callout');
    const medsArrow = deckEl.querySelector('.life-meds-arrow');
    if (medsCard && medsArrow) {
      const arrowBody = new Feel.Body({
        feel: 'springy',
        x: 0,
        target: 0,
        min: -6,
        max: 18,
        onFrame: (b) => {
          medsArrow.style.transform = `translateX(${b.x.toFixed(2)}px)`;
        }
      });
      medsCard.addEventListener('pointerdown', () => arrowBody.kick(210));
    }

    // 6. 采集并唤醒 4 处常驻精密微动效（睡眠声波弹簧 / 刻度盘擒纵 / 充能灯流光 / 生物节律环）
    setupAmbientTelemetry();
  }

  function setupAmbientTelemetry() {
    if (!window.Feel || !deckEl) return;

    if (ambientRefs && ambientRefs.waveBodies) {
      ambientRefs.waveBodies.forEach((b) => Feel.loop.remove(b));
    }
    if (ambientRefs && ambientRefs.beaconBody) {
      Feel.loop.remove(ambientRefs.beaconBody);
    }

    const innerRing = deckEl.querySelector('.life-dial-inner-ring');
    const squares = Array.from(deckEl.querySelectorAll('.life-fitness-fade-squares span'));
    const periodArc = deckEl.querySelector('.life-period-arc-rotor');
    const periodCore = deckEl.querySelector('.life-period-core-dot');
    const leaderDot = deckEl.querySelector('.life-period-leader-dot');
    const waveBars = Array.from(deckEl.querySelectorAll('.life-sleep-wave-svg .life-wave-bar'));

    // 05 睡眠声波柱：每根柱子是独立轻量弹簧刚体 (feel: "bouncy")，由节律脉冲驱动起伏
    const waveBodies = waveBars.map((bar, idx) => new Feel.Body({
      feel: idx % 2 === 1 ? 'bouncy' : 'springy',
      x: 1,
      target: 1,
      min: 0.32,
      max: 1.68,
      onFrame: (b) => {
        bar.style.transform = `scaleY(${b.x.toFixed(3)})`;
      }
    }));

    // 03 生物节律信标弹簧：驱动圆心与引出线端点的心跳微脉冲
    const beaconBody = new Feel.Body({
      feel: 'soft, bouncy',
      x: 1,
      target: 1,
      min: 0.75,
      max: 1.45,
      onFrame: (b) => {
        if (periodCore) {
          periodCore.style.transform = `scale(${b.x.toFixed(3)})`;
        }
        if (leaderDot) {
          const s = 1 + (b.x - 1) * 1.15;
          const op = Math.max(0.35, Math.min(1, 0.55 + (b.x - 1) * 1.2));
          leaderDot.style.transform = `scale(${s.toFixed(3)})`;
          leaderDot.style.opacity = op.toFixed(3);
        }
      }
    });

    ambientRefs = {
      innerRing,
      squares,
      periodArc,
      waveBodies,
      beaconBody
    };

    syncAmbientState();
  }

  function stepAmbientFrame(now) {
    if (!isOpen || activeModule || document.hidden || !ambientRefs) {
      ambientRaf = 0;
      return;
    }

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      ambientRaf = 0;
      return;
    }

    const dt = ambientLastTs ? Math.min(0.064, (now - ambientLastTs) / 1000) : 0.016;
    ambientLastTs = now;
    ambientAcc += dt;

    // (A) 左上刻度盘内圈细环：反向极慢速陀螺逆旋 (-9°/s)
    if (ambientRefs.innerRing) {
      ambientInnerDeg = (ambientInnerDeg - dt * 9) % 360;
      ambientRefs.innerRing.style.transform = `rotate(${ambientInnerDeg.toFixed(2)}deg)`;
    }

    // (B) 03 经期相位缺口环：顺时针慢速轨道巡航 (+16°/s)
    if (ambientRefs.periodArc) {
      ambientPeriodDeg = (ambientPeriodDeg + dt * 16) % 360;
      ambientRefs.periodArc.style.transform = `rotate(${ambientPeriodDeg.toFixed(2)}deg)`;
    }

    // (C) 02 运动健康左上 6 颗信号方块：连续相位波流光扫描 + 呼吸停顿
    if (ambientRefs.squares && ambientRefs.squares.length) {
      const cyclePos = ((now / 1000) * 1.65) % 9.5; // 0..6 扫过 6 颗灯，6..9.5 余晖呼吸
      ambientRefs.squares.forEach((sq, idx) => {
        const base = Math.max(0.1, 1 - idx * 0.18);
        const dist = Math.abs(cyclePos - idx);
        const wave = dist < 1.35 ? Math.cos((dist / 1.35) * (Math.PI / 2)) : 0;
        const val = Math.min(1, base * 0.62 + wave * 0.72);
        sq.style.opacity = val.toFixed(3);
      });
    }

    // (D) 机械擒纵脉冲发生器：按物理节拍驱动弹簧刚体
    while (ambientAcc >= 0.42) {
      ambientAcc -= 0.42;
      ambientTick += 1;

      // 05 睡眠 6 根声波柱错峰起伏呼吸
      const wb = ambientRefs.waveBodies;
      if (wb && wb.length) {
        wb.forEach((b, i) => {
          const waveTarget = 0.56 + 0.58 * Math.abs(Math.sin(ambientTick * 0.72 + i * 0.95));
          b.to(waveTarget);
          if ((ambientTick + i) % 3 === 0) {
            b.kick((i % 2 === 0 ? 1 : -1) * 1.35);
          }
        });
      }

      // 03 经期圆心与引出线信标：每 4 拍一次双搏心跳脉冲
      if (ambientRefs.beaconBody && ambientTick % 4 === 0) {
        ambientRefs.beaconBody.kick(2.6);
      }

      // 左上角主刻度外环：仅在静止无人拨动时，每 9 拍触发一次擒纵“咔哒”跳格
      if (dialBody && dialBody.atRest() && ambientTick % 9 === 0) {
        dialBody.kick(145);
      }
    }

    ambientRaf = requestAnimationFrame(stepAmbientFrame);
  }

  function syncAmbientState() {
    const shouldRun = Boolean(isOpen && !activeModule && !document.hidden && ambientRefs);
    if (shouldRun && !ambientRaf) {
      ambientLastTs = 0;
      ambientRaf = requestAnimationFrame(stepAmbientFrame);
    } else if (!shouldRun && ambientRaf) {
      cancelAnimationFrame(ambientRaf);
      ambientRaf = 0;
    }
  }

  function bindTactileCard(el) {
    if (!window.Feel || pressBodies.has(el)) return;
    const b = new Feel.Body({
      feel: 'snappy, bouncy',
      x: 0,
      target: 0,
      min: -0.6,
      max: 1.5,
      onFrame: (body) => {
        const s = 1 - body.x * 0.028;
        const y = body.x * 2.2;
        el.style.transform = Math.abs(body.x) < 0.004 && body.target === 0
          ? ''
          : `translateY(${y.toFixed(2)}px) scale(${s.toFixed(4)})`;
      }
    });
    pressBodies.set(el, b);

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      b.to(1);
    });
    const release = () => {
      if (b.target !== 0) {
        b.to(0);
        b.kick(-6.5);
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('pointerleave', release);
  }

  function spinHeaderCore(impulse) {
    if (!window.Feel || !pageEl) return;
    const coreEls = pageEl.querySelectorAll('.life-core-ring');
    if (!coreEls.length) return;
    if (!coreSpinBody) {
      coreSpinBody = new Feel.Body({
        feel: 'light, crisp',
        unit: '°',
        x: 0,
        target: null,
        forces: [Feel.magnets({ stops: [0, 120, 240], period: 360, reachFreq: 0.9, clickFreq: 4.2, clickRadius: 14 })],
        onFrame: (b) => {
          const rot = `rotate(${b.x.toFixed(2)}deg)`;
          pageEl.querySelectorAll('.life-core-ring').forEach((el) => {
            el.style.transformOrigin = '12px 12px';
            el.style.transform = rot;
          });
        }
      });
    }
    coreSpinBody.kick(impulse || 480);
  }

  /**
   * 子面板页面切换进场弹簧（只做新内容进场，旧内容由 innerHTML 直接替换）
   * dir: +1 从右侧进（前进），-1 从左侧进（后退）；span: 起始偏移 px
   * 平级切换 feel "snappy"：1-unit mass, 3.4 Hz, ζ 0.82，超调 1.1%，约 183ms 稳定
   * 层级下潜 feel "solid, snappy"：2-unit mass, 2.73 Hz, ζ 0.85，超调 0.6%，约 244ms 稳定
   * 透明度由位置推出（|x| / span），不按时间；落定后清空内联样式，避免 transform 残留影响内部定位。
   */
  function ensurePageEnterBody(feelWords) {
    if (!window.Feel || !sheetBodyEl) return null;
    const paint = (b) => {
      if (!sheetBodyEl) return;
      const s = b.span || 1;
      const p = Math.min(1, Math.abs(b.x) / s);
      sheetBodyEl.style.transform = `translate3d(${b.x.toFixed(2)}px, 0, 0)`;
      sheetBodyEl.style.opacity = (1 - p * 0.85).toFixed(3);
    };
    const clear = () => {
      if (!sheetBodyEl) return;
      sheetBodyEl.style.transform = '';
      sheetBodyEl.style.opacity = '';
    };
    if (!pageEnterBody) {
      pageEnterBody = new Feel.Body({ feel: feelWords, x: 0, target: 0, onFrame: paint, onSettle: clear });
    } else {
      pageEnterBody.params = feelWords;
    }
    return pageEnterBody;
  }

  function playSheetPageEnter(dir, feelWords, span) {
    const b = ensurePageEnterBody(feelWords);
    if (!b) return;
    b.span = span;
    b.jump(dir * span);
    b.to(0);
  }

  function ensureSheetPhysics() {
    if (!window.Feel || !sheetEl || sheetBody) return;
    const getW = () => Math.max(320, (pageEl && pageEl.clientWidth) || window.innerWidth || 390);

    sheetBody = new Feel.Body({
      feel: 'weighty, snappy',
      x: getW(),
      target: getW(),
      min: 0,
      onFrame: (b) => {
        const w = getW();
        const clampedX = Math.max(0, b.x);
        sheetEl.style.transform = `translateX(${clampedX.toFixed(2)}px)`;
        const shadowAlpha = Math.max(0, Math.min(0.28, (1 - clampedX / w) * 0.28));
        sheetEl.style.boxShadow = clampedX >= w - 1 ? 'none' : `-14px 0 34px rgba(0, 0, 0, ${shadowAlpha.toFixed(3)})`;
      },
      onSettle: (b) => {
        const w = getW();
        if (!activeModule && b.x >= w - 2) {
          sheetEl.hidden = true;
          sheetEl.style.boxShadow = 'none';
        }
      }
    });

    const headerEl = sheetEl.querySelector('.life-sheet-header');
    if (headerEl) {
      let dragState = null;
      headerEl.style.touchAction = 'pan-y';
      headerEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        const w = getW();
        sheetBody.max = w * 1.05;
        // 资产二级页内拖顶栏：拖动的是内容区，松手后先回 Hub，而不是关闭整个记账面板
        const subMode = isLedgerAssetSubView();
        dragState = { id: e.pointerId, sx: e.clientX, sy: e.clientY, base: subMode ? 0 : sheetBody.x, dragging: false, subMode };
      });
      headerEl.addEventListener('pointermove', (e) => {
        if (!dragState || e.pointerId !== dragState.id) return;
        const dx = e.clientX - dragState.sx;
        const dy = e.clientY - dragState.sy;
        const target = dragState.subMode ? ensurePageEnterBody('solid, snappy') : sheetBody;
        if (!target) return;
        if (!dragState.dragging) {
          if (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx)) return;
          dragState.dragging = true;
          headerEl.setPointerCapture(e.pointerId);
          if (dragState.subMode) target.span = getW();
          target.grab(Math.max(0, dragState.base + dx), e.timeStamp);
        } else {
          target.move(Math.max(0, dragState.base + dx), e.timeStamp);
        }
      });
      const endDrag = (e) => {
        if (!dragState || e.pointerId !== dragState.id) return;
        const wasDragging = dragState.dragging;
        const subMode = dragState.subMode;
        dragState = null;
        if (!wasDragging) return;
        const w = getW();
        if (subMode && pageEnterBody) {
          pageEnterBody.release();
          // 同样用投射点 x + v*m/c 决定：越过 28% 宽度回 Hub，否则弹回原位
          if (pageEnterBody.projected() > w * 0.28 && isLedgerAssetSubView()) {
            exitLedgerAssetSubView(false);
            syncSheetHeaderTitle();
          } else {
            pageEnterBody.to(0);
          }
          return;
        }
        sheetBody.release();
        // 用 Feel 物理投射点 x + v*m/c 决定松手归宿（零毫秒阈值）
        if (sheetBody.projected() > w * 0.28) {
          closeModuleSheet(false);
        } else {
          sheetBody.to(0);
        }
      };
      headerEl.addEventListener('pointerup', endDrag);
      headerEl.addEventListener('pointercancel', endDrag);
    }
  }

  /** 为子面板内的分段切换栏与按钮挂载流体物理滑块与按压弹簧（Fluid Functionalism） */
  function mountFluidSegGroups(container) {
    if (!window.Feel || !container) return;

      const tactiles = container.querySelectorAll('.life-submit-btn, .life-memo-check-card, .life-med-check-card, .life-flow-toggle-btn, .life-budget-meter-pod, .life-load-more-btn, .life-asset-hub-card, .life-sub-add-trigger');
    tactiles.forEach((el) => bindTactileCard(el));

    const groups = container.querySelectorAll('.life-seg-group');
    groups.forEach((group) => {
      const btns = Array.from(group.querySelectorAll('.life-seg-btn'));
      if (btns.length < 2) return;

      const pill = document.createElement('span');
      pill.className = 'life-seg-fluid-pill';
      pill.setAttribute('aria-hidden', 'true');
      group.insertBefore(pill, group.firstChild);

      const activeIdx = Math.max(0, btns.findIndex((b) => b.classList.contains('active')));
      const prevIdx = Number(group.dataset.prevIdx ?? activeIdx);
      const measure = (idx) => {
        const btn = btns[idx] || btns[0];
        return { left: btn.offsetLeft, width: btn.offsetWidth };
      };

      const mountPill = () => {
        const cur = measure(activeIdx);
        if (!cur.width) return false;
        const from = measure(Number.isFinite(prevIdx) ? prevIdx : activeIdx);
        pill.style.width = `${cur.width}px`;
        pill.style.transform = `translateX(${from.left.toFixed(2)}px)`;
        group.classList.add('has-feel-pill');

        if (Math.abs(from.left - cur.left) > 0.5) {
          const xBody = new Feel.Body({
            feel: 'snappy, bouncy',
            x: from.left,
            target: cur.left,
            onFrame: (b) => {
              const stretch = Math.min(0.14, Math.abs(b.v) / 2600);
              pill.style.transform = `translateX(${b.x.toFixed(2)}px) scaleX(${(1 + stretch).toFixed(4)})`;
            }
          });
          xBody.wake();
        } else {
          pill.style.transform = `translateX(${cur.left.toFixed(2)}px)`;
        }
        return true;
      };

      // 优先同步测量挂载，零帧差杜绝重绘时按钮闪白一帧；若首帧尚未布局再回退 rAF
      if (!mountPill()) {
        requestAnimationFrame(mountPill);
      }
    });

    mountLedgerDrawerPhysics(container);
    mountLedgerViewPhysics(container);
    mountFooterNavPhysics();
  }

  /**
   * 记账「收支流水 / 统计视图」双轨横向滑移弹簧（Model: 1-unit mass on a 4 Hz spring with ζ 0.68, feel: "snappy, bouncy"）
   * 0 = 流水视图，1 = 统计视图；高速位移时附带轻微水平动态形变，完全静止后收叠非活动面板高度释放滚动区。
   */
  function mountLedgerViewPhysics(container) {
    if (!window.Feel || !container) return;
    const viewportEl = container.querySelector('#lifeLedgerViewViewport');
    const trackEl = container.querySelector('#lifeLedgerViewTrack');
    if (!viewportEl || !trackEl) return;

    const targetVal = ledgerTab === 'stats' ? 1 : 0;

    const paintView = (b) => {
      const vpEl = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerViewViewport') : null;
      const trEl = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerViewTrack') : null;
      const flowPane = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerPaneFlow') : null;
      const statsPane = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerPaneStats') : null;
      const switchBtn = sheetBodyEl ? sheetBodyEl.querySelector('[data-ledger-view-switch]') : null;
      if (!vpEl || !trEl) return;

      const w = vpEl.clientWidth || 340;
      const rawX = b.x;
      const tx = -rawX * w;
      const stretch = Math.min(0.035, Math.abs(b.v) / 48);
      const moving = Math.abs(rawX - b.target) > 0.004 || Math.abs(b.v) > 0.02;

      trEl.style.transform = moving
        ? `translate3d(${tx.toFixed(2)}px, 0, 0) scaleX(${(1 + stretch).toFixed(4)})`
        : (b.target === 0 ? 'translate3d(0, 0, 0)' : `translate3d(${(-w).toFixed(2)}px, 0, 0)`);

      if (flowPane && statsPane) {
        const flowDist = Math.abs(rawX - 0);
        const statsDist = Math.abs(rawX - 1);
        flowPane.style.opacity = Math.max(0.18, 1 - flowDist * 0.72).toFixed(3);
        statsPane.style.opacity = Math.max(0.18, 1 - statsDist * 0.72).toFixed(3);
        flowPane.style.pointerEvents = b.target === 0 ? 'auto' : 'none';
        statsPane.style.pointerEvents = b.target === 1 ? 'auto' : 'none';

        if (!moving) {
          flowPane.classList.toggle('is-collapsed-pane', b.target !== 0);
          statsPane.classList.toggle('is-collapsed-pane', b.target !== 1);
        } else {
          flowPane.classList.remove('is-collapsed-pane');
          statsPane.classList.remove('is-collapsed-pane');
        }
      }

      if (switchBtn) {
        const nextTab = b.target === 0 ? 'stats' : 'flow';
        switchBtn.setAttribute('data-ledger-tab', nextTab);
        switchBtn.setAttribute('aria-label', b.target === 0 ? '切换至统计视图' : '切换至记账视图');
        switchBtn.classList.toggle('is-active', b.target === 1);
        const icoFlow = switchBtn.querySelector('.ico-to-flow');
        const icoStats = switchBtn.querySelector('.ico-to-stats');
        if (icoStats && icoFlow) {
          const p = Math.max(0, Math.min(1, rawX));
          icoStats.style.opacity = (1 - p).toFixed(3);
          icoStats.style.transform = `scale(${(1 - p * 0.35).toFixed(3)}) rotate(${(-p * 65).toFixed(1)}deg)`;
          icoFlow.style.opacity = p.toFixed(3);
          icoFlow.style.transform = `scale(${(0.65 + p * 0.35).toFixed(3)}) rotate(${((1 - p) * 65).toFixed(1)}deg)`;
        }
      }
    };

    if (!ledgerViewBody) {
      ledgerViewBody = new Feel.Body({
        feel: 'snappy, bouncy',
        x: targetVal,
        target: targetVal,
        onFrame: paintView
      });
    } else {
      ledgerViewBody.onFrame = paintView;
      ledgerViewBody.jump(targetVal);
    }

    paintView(ledgerViewBody);
  }

  /** 底部双轨平铺导航游标物理弹簧（Model: 1-unit mass on a 4 Hz spring with ζ 0.65, feel: "snappy, bouncy"） */
  function mountFooterNavPhysics() {
    if (!sheetEl || !window.Feel) return;
    const footerEl = sheetEl.querySelector('.life-sheet-footer');
    if (!footerEl || footerEl.hidden) return;
    const tabs = Array.from(footerEl.querySelectorAll('.life-footer-tab'));
    const cursorEl = footerEl.querySelector('.life-footer-cursor');
    if (tabs.length < 2 || !cursorEl) return;

    const activeIdx = Math.max(0, tabs.findIndex((t) => t.classList.contains('active')));
    const syncCursor = () => {
      const btn = tabs[activeIdx] || tabs[0];
      if (!btn || !btn.offsetWidth) return false;
      const indicatorW = 28;
      const targetLeft = btn.offsetLeft + (btn.offsetWidth - indicatorW) / 2;
      cursorEl.style.width = `${indicatorW}px`;

      if (!footerCursorBody) {
        footerCursorBody = new Feel.Body({
          feel: 'snappy, bouncy',
          x: targetLeft,
          target: targetLeft,
          onFrame: (b) => {
            const cEl = sheetEl ? sheetEl.querySelector('.life-footer-cursor') : null;
            if (!cEl) return;
            const stretch = Math.min(0.45, Math.abs(b.v) / 1400);
            cEl.style.transform = `translateX(${b.x.toFixed(2)}px) scaleX(${(1 + stretch).toFixed(4)})`;
          }
        });
        cursorEl.style.transform = `translateX(${targetLeft.toFixed(2)}px)`;
      } else if (Math.abs(footerCursorBody.target - targetLeft) > 0.5) {
        footerCursorBody.to(targetLeft);
      } else if (Math.abs(footerCursorBody.x - targetLeft) < 0.5) {
        cursorEl.style.transform = `translateX(${targetLeft.toFixed(2)}px)`;
      }
      return true;
    };

    if (!syncCursor()) {
      requestAnimationFrame(syncCursor);
    }
  }

  /**
   * 记账录入舱与账本舞台物理切换弹簧（Model: 2-unit mass on a 2.73 Hz spring with ζ 0.85, feel: "solid, snappy"）
   * 闭合端 0 设硬墙阻拦，展开端 1 允许微幅机械落锁回弹；同步驱动：
   *   1) 记账表单舱完整展开/收拢（绝不被下方列表挤压）
   *   2) 下方流水账本舞台向下位移退场 + 淡出隐藏（完全展开后 display:none 释放滚动条）
   *   3) 顶栏「+」图标物理旋转 45° 化作「×」关闭钮
   */
  function mountLedgerDrawerPhysics(container) {
    if (!window.Feel || !container) return;
    const clipEl = container.querySelector('#lifeLedgerDrawerClip');
    const podEl = clipEl ? clipEl.querySelector('.life-form-pod') : null;
    if (!clipEl || !podEl) return;

    const targetVal = ledgerFormOpen ? 1 : 0;

    const paintDrawer = (b) => {
      const cEl = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerDrawerClip') : null;
      const pEl = cEl ? cEl.querySelector('.life-form-pod') : null;
      const stageEl = sheetBodyEl ? sheetBodyEl.querySelector('#lifeLedgerFlowStage') : null;
      const btnEl = sheetBodyEl ? sheetBodyEl.querySelector('[data-ledger-toggle-form]') : null;
      const svgEl = btnEl ? btnEl.querySelector('svg') : null;

      const rawX = b.x;
      const prog = Math.max(0, Math.min(1, rawX));

      if (cEl && pEl) {
        const isClosedRest = rawX <= 0.002 && b.target === 0;
        const isOpenRest = rawX >= 0.995 && b.target === 1 && Math.abs(b.v) < 0.02;

        if (isClosedRest) {
          cEl.style.height = '0px';
          cEl.style.marginBottom = '-14px';
          cEl.style.overflow = 'hidden';
          cEl.style.pointerEvents = 'none';
        } else if (isOpenRest) {
          cEl.style.height = 'auto';
          cEl.style.marginBottom = '0px';
          cEl.style.overflow = 'visible';
          cEl.style.pointerEvents = 'auto';
        } else {
          const fullH = pEl.offsetHeight || 360;
          const h = Math.max(0, rawX * fullH);
          cEl.style.height = `${h.toFixed(1)}px`;
          cEl.style.marginBottom = `${((prog - 1) * 14).toFixed(1)}px`;
          cEl.style.overflow = 'hidden';
          cEl.style.pointerEvents = b.target > 0.5 ? 'auto' : 'none';
        }

        const ty = (1 - rawX) * -14;
        const sc = 0.98 + 0.02 * rawX;
        pEl.style.transform = isOpenRest ? '' : `translateY(${ty.toFixed(2)}px) scale(${sc.toFixed(4)})`;
        pEl.style.opacity = Math.max(0, Math.min(1, prog * 1.2)).toFixed(3);
      }

      if (stageEl) {
        const fullyHidden = prog >= 0.98 && b.target === 1;
        if (fullyHidden) {
          stageEl.style.display = 'none';
        } else {
          stageEl.style.display = '';
          const stageOp = Math.max(0, 1 - prog * 1.35);
          const stageY = prog * 28;
          stageEl.style.opacity = stageOp.toFixed(3);
          stageEl.style.transform = prog <= 0.002 && b.target === 0 ? '' : `translateY(${stageY.toFixed(1)}px)`;
          stageEl.style.pointerEvents = b.target === 0 ? 'auto' : 'none';
        }
      }

      if (svgEl) {
        const deg = rawX * 45;
        svgEl.style.transform = Math.abs(deg) < 0.1 && b.target === 0 ? '' : `rotate(${deg.toFixed(2)}deg)`;
      }
      if (btnEl) {
        btnEl.classList.toggle('is-active', prog > 0.35 || b.target === 1);
      }
    };

    if (!ledgerDrawerBody) {
      ledgerDrawerBody = new Feel.Body({
        feel: 'solid, snappy',
        x: targetVal,
        target: targetVal,
        min: 0,
        max: 1.04,
        onFrame: paintDrawer
      });
    } else {
      ledgerDrawerBody.onFrame = paintDrawer;
      ledgerDrawerBody.to(targetVal);
    }

    paintDrawer(ledgerDrawerBody);
  }

  /* ========================================================================
     二级板块操作子面板渲染 (6 大真实可用业务闭环)
     ======================================================================== */

  function isLedgerAssetSubView() {
    return activeModule === 'ledger'
      && ledgerPrimaryTab === 'assets'
      && (ledgerTab === 'accounts' || ledgerTab === 'sub' || ledgerTab === 'categories');
  }

  function syncSheetHeaderTitle() {
    if (!sheetTitleEl || !activeModule) return;
    const backBtnEl = document.getElementById('lifeSheetBackBtn');
    if (activeModule === 'ledger' && ledgerPrimaryTab === 'assets') {
      if (ledgerTab === 'accounts') {
        sheetTitleEl.textContent = '01 ACCOUNT VAULT';
        if (backBtnEl) backBtnEl.setAttribute('aria-label', '返回资产总览');
        return;
      }
      if (ledgerTab === 'sub') {
        sheetTitleEl.textContent = '01 SUB & PASSES';
        if (backBtnEl) backBtnEl.setAttribute('aria-label', '返回资产总览');
        return;
      }
      if (ledgerTab === 'categories') {
        sheetTitleEl.textContent = '01 BUDGET & CATS';
        if (backBtnEl) backBtnEl.setAttribute('aria-label', '返回资产总览');
        return;
      }
    }
    const META = {
      ledger: { short: '01 LEDGER' },
      fitness: { short: '02 KINETIC' },
      period: { short: '03 BIORHYTHM' },
      meds: { short: '04 PILLBOX' },
      sleep: { short: '05 DORMANT' },
      memo: { short: '06 MEMO' }
    };
    const info = META[activeModule] || META.ledger;
    sheetTitleEl.textContent = info.short;
    if (backBtnEl) backBtnEl.setAttribute('aria-label', '返回后勤总控');
  }

  function clearLedgerSubHashIfNeeded() {
    if ((window.location.hash || '').startsWith('#life-ledger-')) {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (_) { /* ignore */ }
    }
  }

  function enterLedgerAssetSubView(subTab) {
    ledgerPrimaryTab = 'assets';
    ledgerTab = subTab;
    const curHash = window.location.hash || '';
    try {
      if (curHash.startsWith('#life-ledger-')) {
        history.replaceState({ rfPage: 'life-service', rfModule: 'ledger', rfSub: subTab }, '', `#life-ledger-${subTab}`);
      } else if (curHash.startsWith('#life-ledger')) {
        history.pushState({ rfPage: 'life-service', rfModule: 'ledger', rfSub: subTab }, '', `#life-ledger-${subTab}`);
      }
    } catch (_) { /* ignore */ }
    spinHeaderCore(260);
    renderModuleSheetBody('ledger');
    if (sheetBodyEl) sheetBodyEl.scrollTop = 0;
    playSheetPageEnter(1, 'solid, snappy', 48);
  }

  function exitLedgerAssetSubView(fromPopState = false) {
    ledgerPrimaryTab = 'assets';
    ledgerTab = 'hub';
    ledgerAccountEditId = null;
    ledgerCalibrateAccId = null;
    cardActionId = null;
    cardActionKind = '';
    subEditId = null;
    cardEditId = null;
    subFormOpen = false;
    cardFormOpen = false;
    spinHeaderCore(-260);
    renderModuleSheetBody('ledger');
    if (sheetBodyEl) sheetBodyEl.scrollTop = 0;
    playSheetPageEnter(-1, 'solid, snappy', 48);
    if (!fromPopState) {
      clearLedgerSubHashIfNeeded();
    }
  }

  async function openModuleSheet(moduleKey, pushHistory = true) {
    if (!sheetEl || !window.LifeStore) return;
    activeModule = moduleKey;
    if (moduleKey === 'ledger' && ledgerPrimaryTab === 'assets') {
      ledgerTab = 'hub';
    }
    syncAmbientState();
    latestSnap = await LifeStore.getFullSnapshot();

    syncSheetHeaderTitle();

    renderModuleSheetBody(moduleKey);
    sheetEl.hidden = false;
    spinHeaderCore(420);

    if (window.Feel) {
      ensureSheetPhysics();
      const w = Math.max(320, (pageEl && pageEl.clientWidth) || window.innerWidth || 390);
      if (sheetBody.atRest() && sheetBody.x >= w - 4) {
        sheetBody.jump(w);
      }
      sheetBody.max = w * 1.05;
      sheetBody.to(0);
    } else {
      requestAnimationFrame(() => {
        sheetEl.classList.add('open');
      });
    }

    if (pushHistory) {
      try {
        history.pushState({ rfPage: 'life-service', rfModule: moduleKey }, '', `#life-${moduleKey}`);
      } catch (_) { /* ignore */ }
    }
  }

  function closeModuleSheet(fromPopState = false) {
    if (!sheetEl || !activeModule) return;
    activeModule = null;
    subEditId = null;
    cardEditId = null;
    subFormOpen = false;
    cardFormOpen = false;
    syncAmbientState();
    spinHeaderCore(-420);

    if (window.Feel && sheetBody) {
      const w = Math.max(320, (pageEl && pageEl.clientWidth) || window.innerWidth || 390);
      sheetBody.max = w;
      sheetBody.to(w);
    } else {
      sheetEl.classList.remove('open');
      sheetEl.hidden = true;
    }
    renderDashboard();

    if (!fromPopState && (window.location.hash || '').startsWith('#life-')) {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (_) { /* ignore */ }
    }
  }

  function buildLedgerFlowFilteredView(snap) {
    const ld = snap.ledger;
    const cur = esc((snap.config && snap.config.currencySymbol) || '¥');
    const accounts = ld.accounts || [];
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    const expCats = ld.categoryStats || (snap.config.ledgerCategories && snap.config.ledgerCategories.expense) || [];
    const incCats = (snap.config.ledgerCategories && snap.config.ledgerCategories.income) || [];
    const catIconMap = new Map();
    expCats.concat(incCats).forEach((c) => {
      if (c && c.name) catIconMap.set(c.name, c.iconKey || 'layers');
    });
    const editingRec = ledgerEditRecordId
      ? (ld.records || []).find((r) => r.id === ledgerEditRecordId) || null
      : null;

    const renderLedgerRowHtml = (r) => {
      const rType = r.type || 'expense';
      let sign = '-';
      let valCls = 'is-exp';
      let badgeText = esc(r.category || '支出');
      let iconKey = catIconMap.get(r.category) || 'layers';
      let accDesc = '';

      if (rType === 'income') {
        sign = '+';
        valCls = 'is-inc';
        const a = accMap.get(r.accountId);
        accDesc = a ? a.name : '默认账户';
      } else if (rType === 'refund') {
        sign = '+';
        valCls = 'is-ref';
        badgeText = `退款·${esc(r.category || '冲销')}`;
        iconKey = 'refund';
        const a = accMap.get(r.accountId);
        accDesc = a ? `${a.name} 退回` : '原路退回';
      } else if (rType === 'transfer') {
        sign = '';
        valCls = 'is-trf';
        badgeText = esc(r.category || '互转/还款');
        iconKey = 'transfer';
        const fa = accMap.get(r.fromAccountId || r.accountId);
        const ta = accMap.get(r.toAccountId);
        accDesc = `${fa ? fa.name : '转出'} -> ${ta ? ta.name : '转入'}${Number(r.fee) > 0 ? ` (手续费 ${cur}${Number(r.fee).toFixed(2)})` : ''}`;
      } else if (rType === 'adjust') {
        const d = Number(r.delta) || 0;
        sign = d >= 0 ? '+' : '-';
        valCls = 'is-adj';
        badgeText = '余额平账';
        iconKey = 'wallet';
        const a = accMap.get(r.accountId);
        accDesc = a ? `${a.name} 校准` : '账面校准';
      } else {
        const a = accMap.get(r.accountId);
        accDesc = a ? a.name : '默认账户';
      }

      const reimBadge = r.reimbursable
        ? (r.reimbursed
          ? '<span class="life-inline-pill ok">已报销</span>'
          : `<button type="button" class="life-inline-pill warn is-clickable" data-reimburse-settle="${esc(r.id)}" title="点击核销报销">待报销</button>`)
        : '';
      const exBadge = r.excludeFromStats ? '<span class="life-inline-pill muted">不计预算</span>' : '';

      let timeStr = '';
      if (r.createdAt) {
        const dt = new Date(Number(r.createdAt));
        if (!isNaN(dt.getTime())) {
          timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        }
      }
      if (!timeStr) timeStr = (r.dateKey || '').slice(5).replace('-', '.');

      return `
        <div class="life-log-item ${editingRec && editingRec.id === r.id ? 'is-editing' : ''}" data-ledger-edit="${esc(r.id)}">
          <div class="life-log-ico-box">${svgLedgerIcon(iconKey)}</div>
          <div class="life-log-left" style="flex:1;">
            <div class="life-log-main">
              <span class="life-log-note-txt">${esc(r.note || (rType === 'transfer' ? '账户流转' : r.category || '日常记录'))}</span>
              ${reimBadge}${exBadge}
            </div>
            <div class="life-log-sub"><span>${esc(timeStr)}</span><span>${badgeText}</span><span>${esc(accDesc)}</span></div>
          </div>
          <div class="life-log-right">
            <span class="life-log-val ${valCls}">${sign}${cur}${Number(r.amount || 0).toFixed(2)}</span>
            <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}" aria-label="删除记录">
              <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            </button>
          </div>
        </div>
      `;
    };

    const q = ledgerSearchQuery.trim().toLowerCase();
    const filteredFlowRecs = (ld.records || []).filter((r) => {
      const rt = r.type || 'expense';
      if (ledgerFilterType === 'expense' && rt !== 'expense' && rt !== 'refund') return false;
      if (ledgerFilterType === 'income' && rt !== 'income') return false;
      if (ledgerFilterType === 'transfer' && rt !== 'transfer' && rt !== 'adjust') return false;
      if (ledgerFilterType === 'reimburse' && !(r.reimbursable && !r.reimbursed)) return false;

      if (ledgerFilterAccId !== 'all') {
        const matchAcc = r.accountId === ledgerFilterAccId
          || r.fromAccountId === ledgerFilterAccId
          || r.toAccountId === ledgerFilterAccId;
        if (!matchAcc) return false;
      }

      if (q) {
        const hay = `${r.category || ''} ${r.note || ''} ${r.dateKey || ''} ${r.amount || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const filteredSumExp = filteredFlowRecs.reduce((acc, r) => {
      if ((r.type || 'expense') === 'expense') return acc + (Number(r.amount) || 0);
      if (r.type === 'refund') return acc - (Number(r.amount) || 0);
      return acc;
    }, 0);

    const isFilteredActive = ledgerSearchQuery.trim() !== '' || ledgerFilterType !== 'all' || ledgerFilterAccId !== 'all';

    const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const groups = [];
    const map = new Map();
    const displayRecs = filteredFlowRecs.slice(0, ledgerFlowLimit);
    displayRecs.forEach((r) => {
      const dk = r.dateKey || '';
      if (!map.has(dk)) {
        map.set(dk, []);
        groups.push({ dateKey: dk, recs: map.get(dk) });
      }
      map.get(dk).push(r);
    });

    const today = snap.todayKey;
    const yesterday = (() => {
      const d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    const dateGroupLabel = (dk) => {
      if (dk === today) return 'TODAY 今天';
      if (dk === yesterday) return 'YESTERDAY 昨天';
      const parts = dk.split('-');
      const d = new Date(dk + 'T00:00:00');
      const wd = WEEKDAYS[d.getDay()] || '';
      return `${parts[1]}.${parts[2]} ${wd}`;
    };
    const dateGroupNet = (recs) => {
      let net = 0;
      recs.forEach((r) => {
        const t = r.type || 'expense';
        if (t === 'expense') net -= (Number(r.amount) || 0);
        else if (t === 'income' || t === 'refund') net += (Number(r.amount) || 0);
      });
      return net;
    };

    const hasMore = filteredFlowRecs.length > ledgerFlowLimit;
    const listHtml = groups.length
      ? groups.map((g) => {
          const net = dateGroupNet(g.recs);
          const netStr = net >= 0 ? `+${cur}${net.toFixed(2)}` : `-${cur}${Math.abs(net).toFixed(2)}`;
          return `
            <div class="life-date-group">
              <div class="life-date-group-header">
                <span class="life-date-group-label">${dateGroupLabel(g.dateKey)}</span>
                <span class="life-date-group-net ${net >= 0 ? 'is-pos' : 'is-neg'}">${netStr}</span>
              </div>
              ${g.recs.map((r) => renderLedgerRowHtml(r)).join('')}
            </div>
          `;
        }).join('')
      : `<div class="life-empty-hint">${(ld.records || []).length ? 'NO MATCHING ENTRIES 无匹配筛选条件的流水' : 'NO LEDGER RECORDS 暂无收支流水，立即记一笔'}</div>`;

    const loadMoreHtml = hasMore
      ? `<button type="button" class="life-load-more-btn" data-ledger-load-more="1">LOAD MORE 加载更多 (${filteredFlowRecs.length - ledgerFlowLimit} 条)</button>`
      : '';

    const telemetryInnerHtml = isFilteredActive ? `
      <span>FILTERED 命中 ${filteredFlowRecs.length} 条</span>
      <span>净支出 ${cur}${filteredSumExp.toFixed(2)}</span>
    ` : '';

    return {
      renderLedgerRowHtml,
      filteredFlowRecs,
      filteredSumExp,
      isFilteredActive,
      telemetryInnerHtml,
      listHtml,
      loadMoreHtml
    };
  }

  function updateLedgerFlowListInPlace() {
    // 只在「记账模块」的「流水选项卡」下进行局部刷新，其他场景静默返回
    if (activeModule !== 'ledger' || ledgerTab !== 'flow') {
      return false;
    }
    if (!sheetBodyEl || !latestSnap) {
      return false;
    }
    const listEl = sheetBodyEl.querySelector('#lifeLedgerFlowList');
    if (!listEl) return false;

    const fv = buildLedgerFlowFilteredView(latestSnap);
    listEl.innerHTML = fv.listHtml;

    const clearBtn = sheetBodyEl.querySelector('[data-ledger-search-clear]');
    if (clearBtn) {
      clearBtn.hidden = !ledgerSearchQuery;
    }

    sheetBodyEl.querySelectorAll('[data-ledger-filter-type]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-ledger-filter-type') === ledgerFilterType);
    });

    const teleEl = sheetBodyEl.querySelector('#lifeLedgerFilterTelemetry');
    if (teleEl) {
      teleEl.hidden = !fv.isFilteredActive;
      teleEl.innerHTML = fv.telemetryInnerHtml;
    }

    const moreSlot = sheetBodyEl.querySelector('#lifeLedgerLoadMoreSlot');
    if (moreSlot) {
      moreSlot.innerHTML = fv.loadMoreHtml;
    }

    return true;
  }

  function renderModuleSheetBody(moduleKey, prevSegIndices) {
    if (!sheetBodyEl || !latestSnap) return;
    const snap = latestSnap;
    const cur = esc(snap.config.currencySymbol || '¥');
    const finishSheetMount = () => {
      if (prevSegIndices && prevSegIndices.length) {
        const groups = sheetBodyEl.querySelectorAll('.life-seg-group');
        prevSegIndices.forEach((pIdx, gIdx) => {
          if (groups[gIdx] && pIdx >= 0) groups[gIdx].dataset.prevIdx = String(pIdx);
        });
      }
      mountFluidSegGroups(sheetBodyEl);
    };

    if (moduleKey === 'ledger') {
      const ld = snap.ledger;
      const accounts = ld.accounts || [];
      const accMap = new Map(accounts.map((a) => [a.id, a]));
      const defaultAccId = ld.defaultAccountId || (accounts[0] && accounts[0].id) || 'acc_wechat';

      const expCats = ld.categoryStats || (snap.config.ledgerCategories && snap.config.ledgerCategories.expense) || [];
      const incCats = (snap.config.ledgerCategories && snap.config.ledgerCategories.income) || [];
      const catIconMap = new Map();
      expCats.concat(incCats).forEach((c) => {
        if (c && c.name) catIconMap.set(c.name, c.iconKey || 'layers');
      });

      // 编辑态回填目标流水
      const editingRec = ledgerEditRecordId
        ? (ld.records || []).find((r) => r.id === ledgerEditRecordId) || null
        : null;
      if (ledgerEditRecordId && !editingRec) {
        ledgerEditRecordId = null;
      }

      const activeCatList = ledgerFormType === 'income' ? incCats : expCats;
      if (!ledgerSelectedCat || !activeCatList.some((c) => c.name === ledgerSelectedCat)) {
        ledgerSelectedCat = (editingRec && editingRec.category && activeCatList.some((c) => c.name === editingRec.category))
          ? editingRec.category
          : (activeCatList[0] ? activeCatList[0].name : '餐饮补给');
      }

      // 通用账单流水行渲染辅助
      const renderLedgerRowHtml = (r) => {
        const rType = r.type || 'expense';
        let sign = '-';
        let valCls = 'is-exp';
        let badgeText = esc(r.category || '支出');
        let iconKey = catIconMap.get(r.category) || 'layers';
        let accDesc = '';

        if (rType === 'income') {
          sign = '+';
          valCls = 'is-inc';
          const a = accMap.get(r.accountId);
          accDesc = a ? a.name : '默认账户';
        } else if (rType === 'refund') {
          sign = '+';
          valCls = 'is-ref';
          badgeText = `退款·${esc(r.category || '冲销')}`;
          iconKey = 'refund';
          const a = accMap.get(r.accountId);
          accDesc = a ? `${a.name} 退回` : '原路退回';
        } else if (rType === 'transfer') {
          sign = '';
          valCls = 'is-trf';
          badgeText = esc(r.category || '互转/还款');
          iconKey = 'transfer';
          const fa = accMap.get(r.fromAccountId || r.accountId);
          const ta = accMap.get(r.toAccountId);
          accDesc = `${fa ? fa.name : '转出'} -> ${ta ? ta.name : '转入'}${Number(r.fee) > 0 ? ` (手续费 ${cur}${Number(r.fee).toFixed(2)})` : ''}`;
        } else if (rType === 'adjust') {
          const d = Number(r.delta) || 0;
          sign = d >= 0 ? '+' : '-';
          valCls = 'is-adj';
          badgeText = '余额平账';
          iconKey = 'wallet';
          const a = accMap.get(r.accountId);
          accDesc = a ? `${a.name} 校准` : '账面校准';
        } else {
          const a = accMap.get(r.accountId);
          accDesc = a ? a.name : '默认账户';
        }

        const reimBadge = r.reimbursable
          ? (r.reimbursed
            ? '<span class="life-inline-pill ok">已报销</span>'
            : `<button type="button" class="life-inline-pill warn is-clickable" data-reimburse-settle="${esc(r.id)}" title="点击核销报销">待报销</button>`)
          : '';
        const exBadge = r.excludeFromStats ? '<span class="life-inline-pill muted">不计预算</span>' : '';

        let timeStr = '';
        if (r.createdAt) {
          const dt = new Date(Number(r.createdAt));
          if (!isNaN(dt.getTime())) {
            timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
          }
        }
        if (!timeStr) timeStr = (r.dateKey || '').slice(5).replace('-', '.');

        return `
          <div class="life-log-item ${editingRec && editingRec.id === r.id ? 'is-editing' : ''}" data-ledger-edit="${esc(r.id)}">
            <div class="life-log-ico-box">${svgLedgerIcon(iconKey)}</div>
            <div class="life-log-left" style="flex:1;">
              <div class="life-log-main">
                <span class="life-log-note-txt">${esc(r.note || (rType === 'transfer' ? '账户流转' : r.category || '日常记录'))}</span>
                ${reimBadge}${exBadge}
              </div>
              <div class="life-log-sub"><span>${esc(timeStr)}</span><span>${badgeText}</span><span>${esc(accDesc)}</span></div>
            </div>
            <div class="life-log-right">
              <span class="life-log-val ${valCls}">${sign}${cur}${Number(r.amount || 0).toFixed(2)}</span>
              <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}" aria-label="删除记录">
                <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
              </button>
            </div>
          </div>
        `;
      };

      const statsReport = (ledgerTab === 'flow' || ledgerTab === 'stats')
        ? LifeStore.computeLedgerPeriodReport(ld.records, ledgerStatsDim, ledgerStatsOffset, snap.config)
        : null;

      // 2) 各轨主体内容组装
      let tabContentHtml = '';

      if (ledgerTab === 'flow' || ledgerTab === 'stats') {
        const catChipsHtml = (ledgerFormType === 'expense' || ledgerFormType === 'income' || ledgerFormType === 'refund')
          ? `
            <div class="life-field full">
              <label>CATEGORY 点选分类图标</label>
              <div class="life-cat-chip-grid">
                ${activeCatList.map((c) => `
                  <button type="button" class="life-cat-chip ${ledgerSelectedCat === c.name ? 'active' : ''}" data-ledger-cat-pick="${esc(c.name)}">
                    ${svgLedgerIcon(c.iconKey)}
                    <span>${esc(c.name)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          `
          : '';

        const prefillAmt = editingRec
          ? Number(editingRec.amount || 0)
          : (ledgerFormType === 'transfer' && ledgerTransferPresetAmt ? ledgerTransferPresetAmt : '');
        const prefillDate = editingRec ? (editingRec.dateKey || snap.todayKey) : snap.todayKey;
        const prefillNote = editingRec ? (editingRec.note || '') : '';
        const prefillAcc = editingRec ? (editingRec.accountId || defaultAccId) : defaultAccId;
        const prefillFromAcc = editingRec
          ? (editingRec.fromAccountId || editingRec.accountId || defaultAccId)
          : defaultAccId;
        const fallbackToAcc = (accounts.find((a) => a.id !== prefillFromAcc) || accounts[0] || {}).id || defaultAccId;
        const prefillToAcc = editingRec
          ? (editingRec.toAccountId || fallbackToAcc)
          : (ledgerTransferPresetToId || fallbackToAcc);
        const prefillFee = editingRec ? Number(editingRec.fee || 0) : '';

        const pendingReimBanner = (ld.pendingReimbursements && ld.pendingReimbursements.length)
          ? `
            <div class="life-reimburse-strip">
              <div class="life-reimburse-strip-head">
                <span>PENDING REIMBURSE 待报销垫付 (${ld.pendingReimbursements.length} 笔)</span>
                <span>合计 ${cur}${ld.pendingReimbursements.reduce((s, r) => s + (Number(r.amount) || 0), 0).toFixed(2)}</span>
              </div>
              <div class="life-reimburse-strip-list">
                ${ld.pendingReimbursements.map((r) => `
                  <div class="life-reimburse-row">
                    <span>${esc(r.dateKey)} · ${esc(r.note || r.category || '垫付支出')} (${cur}${Number(r.amount).toFixed(2)})</span>
                    <button type="button" class="life-mini-act-btn primary" data-reimburse-settle="${esc(r.id)}">核销到账</button>
                  </div>
                `).join('')}
              </div>
            </div>
          `
          : '';

        const fv = buildLedgerFlowFilteredView(snap);
        const listHtml = fv.listHtml;
        const loadMoreHtml = fv.loadMoreHtml;

        const filterBarHtml = ld.records.length ? `
          <div class="life-filter-pod">
            <div class="life-search-box">
              <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
              <input type="text" id="lifeLedgerSearchInput" class="life-search-input" placeholder="检索备注 / 分类 / 日期 / 金额..." value="${esc(ledgerSearchQuery)}">
              <button type="button" class="life-mini-act-btn" data-ledger-search-clear="1" ${ledgerSearchQuery ? '' : 'hidden'}>清空</button>
            </div>
            <div class="life-filter-row">
              <div class="life-filter-pills">
                <button type="button" class="life-filter-pill ${ledgerFilterType === 'all' ? 'active' : ''}" data-ledger-filter-type="all">全部</button>
                <button type="button" class="life-filter-pill ${ledgerFilterType === 'expense' ? 'active' : ''}" data-ledger-filter-type="expense">支出</button>
                <button type="button" class="life-filter-pill ${ledgerFilterType === 'income' ? 'active' : ''}" data-ledger-filter-type="income">收入</button>
                <button type="button" class="life-filter-pill ${ledgerFilterType === 'transfer' ? 'active' : ''}" data-ledger-filter-type="transfer">流转</button>
                <button type="button" class="life-filter-pill ${ledgerFilterType === 'reimburse' ? 'active' : ''}" data-ledger-filter-type="reimburse">待报销</button>
              </div>
              ${renderLifeSelectField({ id: 'lifeLedgerFilterAcc', kind: 'filter-account', value: ledgerFilterAccId, compact: true })}
            </div>
            <div class="life-filter-telemetry" id="lifeLedgerFilterTelemetry" ${fv.isFilteredActive ? '' : 'hidden'}>
              ${fv.telemetryInnerHtml}
            </div>
          </div>
        ` : '';

        // 表单 HTML（常驻折叠轨道内，由 Feel 刚体 ledgerDrawerBody 驱动展开/收起）
        const formHtml = `
          <div class="life-ledger-drawer-clip" id="lifeLedgerDrawerClip">
            <div class="life-form-pod">
              <div class="life-form-pod-title">
                <span>${editingRec ? 'EDIT ENTRY 编辑流水' : 'NEW ENTRY 记一笔'}</span>
              </div>

              <div class="life-seg-group">
                <button type="button" class="life-seg-btn ${ledgerFormType === 'expense' ? 'active' : ''}" data-ledger-type="expense">支出</button>
                <button type="button" class="life-seg-btn ${ledgerFormType === 'income' ? 'active' : ''}" data-ledger-type="income">收入</button>
                <button type="button" class="life-seg-btn ${ledgerFormType === 'transfer' ? 'active' : ''}" data-ledger-type="transfer">转账/还款</button>
                <button type="button" class="life-seg-btn ${ledgerFormType === 'refund' ? 'active' : ''}" data-ledger-type="refund">退款冲销</button>
              </div>

              <div class="life-form-grid">
                <div class="life-field">
                  <label>AMOUNT 金额 (${cur})</label>
                  <input type="number" step="0.01" id="lifeLedgerAmount" class="life-input" placeholder="0.00" value="${prefillAmt !== '' ? esc(prefillAmt) : ''}">
                </div>
                <div class="life-field">
                  <label>DATE 账单日期</label>
                  ${renderLifeDateField({ id: 'lifeLedgerDate', value: prefillDate, title: '选择账单日期' })}
                </div>

                ${ledgerFormType === 'transfer' ? `
                  <div class="life-field">
                    <label>FROM 转出(付款)账户</label>
                    ${renderLifeSelectField({ id: 'lifeLedgerFromAccount', kind: 'from-account', value: prefillFromAcc })}
                  </div>
                  <div class="life-field">
                    <label>TO 转入(收款/信用卡)账户</label>
                    ${renderLifeSelectField({ id: 'lifeLedgerToAccount', kind: 'to-account', value: prefillToAcc })}
                  </div>
                  <div class="life-field full">
                    <label>TRANSFER FEE 手续费（选填，0 为免手续费）</label>
                    <input type="number" step="0.01" id="lifeLedgerFee" class="life-input" placeholder="0.00" value="${prefillFee !== '' && prefillFee > 0 ? esc(prefillFee) : ''}">
                  </div>
                ` : `
                  <div class="life-field full">
                    <label>ACCOUNT 所属资金账户</label>
                    ${renderLifeSelectField({ id: 'lifeLedgerAccount', kind: 'account', value: prefillAcc })}
                  </div>
                  ${catChipsHtml}
                `}

                <div class="life-field full">
                  <label>MEMO 备注说明</label>
                  <input type="text" id="lifeLedgerNote" class="life-input" placeholder="例如：生椰拿铁 / 地铁通勤 / 花呗账单还款" value="${esc(prefillNote)}">
                </div>

                ${ledgerFormType === 'expense' ? `
                  <div class="life-field full">
                    <div class="life-flag-check-row">
                      <label class="life-flag-check">
                        <input type="checkbox" id="lifeLedgerReimbursable" ${editingRec && editingRec.reimbursable ? 'checked' : ''}>
                        <span>标记为「待报销垫付」</span>
                      </label>
                      <label class="life-flag-check">
                        <input type="checkbox" id="lifeLedgerExcludeStats" ${editingRec && editingRec.excludeFromStats ? 'checked' : ''}>
                        <span>不计入月度预算统计</span>
                      </label>
                    </div>
                  </div>
                ` : ''}
              </div>

              <button type="button" class="life-submit-btn" data-life-submit="ledger">
                <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>${editingRec ? 'UPDATE ENTRY 保存修改' : 'COMMIT ENTRY 确认入账'}</span>
              </button>
            </div>
          </div>
        `;

        const flowPaneHtml = `
          ${formHtml}
          <div class="life-ledger-flow-stage" id="lifeLedgerFlowStage">
            ${pendingReimBanner}
            ${filterBarHtml}
            <div class="life-log-list" id="lifeLedgerFlowList">${listHtml}</div>
            <div id="lifeLedgerLoadMoreSlot">${loadMoreHtml}</div>
          </div>
        `;

        const rp = statsReport;
        const balSign = rp.netBalance >= 0 ? '+' : '-';

        // 维度专属主视觉区（Lieflat Charts Lupi Basics 纯 SVG 编码：F1 梯档柱 / F3 发丝脉冲 + 月度热力矩阵）
        let visualChartHtml = '';
        if (ledgerStatsDim === 'week') {
          const weekItems = rp.series.map((s) => ({
            key: s.key,
            label: s.label,
            subLabel: s.shortDate,
            expense: s.expense,
            isToday: s.isToday,
            isSelected: ledgerStatsFocusDate === s.key
          }));
          const rungChart = renderLupiRungBarsSvg(weekItems, {
            width: 324,
            height: 148,
            maxRungs: 16,
            xStart: 30,
            xGap: 44,
            hw: 11.5,
            baseY: 110,
            stepY: 5.2,
            pickAttr: 'data-stats-pick-date',
            unitPrefix: snap.config.currencySymbol || '¥'
          });

          visualChartHtml = `
            <div class="life-stats-chart-pod">
              <div class="life-form-pod-title">
                <span>周一至周日趋势（点柱看明细）</span>
                <span>日均 ${cur}${rp.dailyAvgExpense.toFixed(1)}</span>
              </div>
              ${rungChart.svg}
              <div class="life-lupi-footnote">${esc(rungChart.caption)}</div>
            </div>
          `;
        } else if (ledgerStatsDim === 'month') {
          const pulseSvg = renderLupiMonthHairlineSvg(
            rp.calendarCells,
            ledgerStatsFocusDate,
            snap.config.currencySymbol || '¥'
          );
          const weekHeaders = ['一', '二', '三', '四', '五', '六', '日']
            .map((w) => `<div class="life-cal-head-cell">周${w}</div>`)
            .join('');
          const cellsHtml = rp.calendarCells.map((c) => {
            if (c.empty) return '<div class="life-cal-cell is-empty"></div>';
            const isSel = ledgerStatsFocusDate === c.dateKey;
            const amtShort = c.expense > 0
              ? (c.expense >= 1000 ? `${(c.expense / 1000).toFixed(1)}k` : `-${c.expense.toFixed(0)}`)
              : (c.income > 0 ? `+${c.income >= 1000 ? (c.income / 1000).toFixed(1) + 'k' : c.income.toFixed(0)}` : '');
            return `
              <button type="button" class="life-cal-cell heat-${c.heatLevel} ${c.isToday ? 'is-today' : ''} ${isSel ? 'is-selected' : ''}" data-stats-pick-date="${esc(c.dateKey)}">
                <span class="life-cal-day-num">${c.day}</span>
                <span class="life-cal-day-amt">${esc(amtShort)}</span>
              </button>
            `;
          }).join('');

          visualChartHtml = `
            <div class="life-stats-chart-pod">
              <div class="life-form-pod-title">
                <span>逐日消费轮廓（点节点看明细）</span>
                <span>日均 ${cur}${rp.dailyAvgExpense.toFixed(1)}</span>
              </div>
              ${pulseSvg}
              <div class="life-lupi-footnote">ONE HAIRLINE = ONE DAY · HOLLOW DOT = WEEKEND</div>
            </div>
            <div class="life-stats-chart-pod">
              <div class="life-form-pod-title">
                <span>月度消费热力日历（点日期看明细）</span>
                <span>结余 ${balSign}${cur}${Math.abs(rp.netBalance).toFixed(0)}</span>
              </div>
              <div class="life-cal-grid-head">${weekHeaders}</div>
              <div class="life-cal-grid">${cellsHtml}</div>
            </div>
          `;
        } else if (ledgerStatsDim === 'year') {
          const yearItems = rp.series.map((s, idx) => ({
            key: s.key,
            label: `${idx + 1}月`,
            subLabel: '',
            expense: s.expense,
            isCurrent: s.isCurrent
          }));
          const yearRungChart = renderLupiRungBarsSvg(yearItems, {
            width: 324,
            height: 136,
            maxRungs: 15,
            xStart: 19,
            xGap: 26,
            hw: 7.4,
            baseY: 108,
            stepY: 5.2,
            pickAttr: '',
            unitPrefix: snap.config.currencySymbol || '¥'
          });

          visualChartHtml = `
            <div class="life-stats-chart-pod">
              <div class="life-form-pod-title">
                <span>1月 ~ 12月支出趋势</span>
                <span>全年结余 ${balSign}${cur}${Math.abs(rp.netBalance).toFixed(0)}</span>
              </div>
              ${yearRungChart.svg}
              <div class="life-lupi-footnote">${esc(yearRungChart.caption)}</div>
            </div>
          `;
        }

        // 若点选了周柱子或月日历某一天，展示该日聚焦明细块
        let focusDayHtml = '';
        if (ledgerStatsFocusDate && (ledgerStatsDim === 'week' || ledgerStatsDim === 'month')) {
          const focusRecs = rp.records.filter((r) => r.dateKey === ledgerStatsFocusDate);
          focusDayHtml = `
            <div class="life-form-pod life-highlight-pod">
              <div class="life-form-pod-title">
                <span>${esc(ledgerStatsFocusDate)} 当日明细 (${focusRecs.length}笔)</span>
                <button type="button" class="life-mini-act-btn" data-stats-clear-focus="1">收起</button>
              </div>
              <div class="life-log-list">
                ${focusRecs.length ? focusRecs.map((r) => renderLedgerRowHtml(r)).join('') : '<div class="life-empty-hint">当日无账单记录</div>'}
              </div>
            </div>
          `;
        }

        const activeRanking = ledgerStatsRankType === 'income' ? rp.incomeRanking : rp.expenseRanking;
        const activeRankTotal = ledgerStatsRankType === 'income' ? rp.totalIncome : rp.netExpense;
        const tickDonutHtml = renderLupiTickDonutSvg(
          activeRanking,
          activeRankTotal,
          snap.config.currencySymbol || '¥',
          ledgerStatsRankType
        );
        const rankingRowsHtml = activeRanking.length
          ? activeRanking.map((item, rIdx) => `
              <div class="life-rank-row">
                <div class="life-rank-top">
                  <div class="life-acc-title-group">
                    <span class="life-acc-ico">${svgLedgerIcon(item.iconKey)}</span>
                    <div>
                      <div class="life-acc-name">${esc(item.name)} <span class="life-rank-pct">${item.ratio}%</span></div>
                      <div class="life-acc-meta">${item.count} 笔记录</div>
                    </div>
                  </div>
                  <div class="life-acc-bal">${cur}${item.amount.toFixed(2)}</div>
                </div>
                ${renderLupiTickRowSvg(item.ratio, rIdx)}
              </div>
            `).join('')
          : `<div class="life-empty-hint">当前周期暂无${ledgerStatsRankType === 'income' ? '收入' : '支出'}构成数据</div>`;

        const bottomRecordsHtml = ledgerStatsDim === 'day'
          ? `
            <div class="life-section-caption">当日账单明细 (${rp.records.length})</div>
            <div class="life-log-list">
              ${rp.records.length ? rp.records.map((r) => renderLedgerRowHtml(r)).join('') : '<div class="life-empty-hint">当日暂无收支流水</div>'}
            </div>
          `
          : (ledgerStatsDim === 'week' && rp.topExpenses.length ? `
            <div class="life-section-caption">本周大额支出排行 (${rp.topExpenses.length})</div>
            <div class="life-log-list">
              ${rp.topExpenses.map((r) => renderLedgerRowHtml(r)).join('')}
            </div>
          ` : '');

        const thirdMetricLbl = ledgerStatsDim === 'year'
          ? '月均支出'
          : ledgerStatsDim === 'day'
            ? '当日笔数'
            : '日均支出';
        const thirdMetricVal = ledgerStatsDim === 'year'
          ? `${cur}${rp.monthlyAvgExpense.toFixed(0)}`
          : ledgerStatsDim === 'day'
            ? `${rp.txCount}笔`
            : `${cur}${rp.dailyAvgExpense.toFixed(1)}`;
        const statsKpiBannerHtml = `
          <div class="life-stats-kpi-step">
            <div class="life-stats-kpi-left">
              <div class="life-stats-kpi-eyebrow">
                <span class="life-stats-kpi-lbl">区间净支</span>
                <span class="life-stats-kpi-bar" aria-hidden="true"></span>
              </div>
              <div class="life-stats-kpi-hero-val">${cur}${rp.netExpense.toFixed(2)}</div>
            </div>

            <div class="life-stats-kpi-right-top">
              <span class="life-stats-kpi-lbl-group">
                <span class="life-stats-kpi-sq" aria-hidden="true"></span>
                <span class="life-stats-kpi-lbl">区间总收</span>
              </span>
              <span class="life-stats-kpi-inc-val">${cur}${rp.totalIncome.toFixed(0)}</span>
            </div>

            <div class="life-stats-kpi-right-bot">
              <span class="life-stats-kpi-lbl-group">
                <span class="life-stats-kpi-sq is-muted" aria-hidden="true"></span>
                <span class="life-stats-kpi-lbl">${thirdMetricLbl}</span>
              </span>
              <span class="life-stats-kpi-inc-val is-sub">${thirdMetricVal}</span>
            </div>

            <svg class="life-stats-kpi-step-svg" viewBox="0 0 360 66" preserveAspectRatio="none" aria-hidden="true">
              <path d="M 5 60 L 146 60 L 180 32 L 356 32" fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
            </svg>
            <span class="life-stats-kpi-dot-left" aria-hidden="true"></span>
            <span class="life-stats-kpi-dot-right" aria-hidden="true"></span>
          </div>
        `;

        const statsPaneHtml = `
          <div class="life-seg-group">
            <button type="button" class="life-seg-btn ${ledgerStatsDim === 'day' ? 'active' : ''}" data-stats-dim="day">日视图</button>
            <button type="button" class="life-seg-btn ${ledgerStatsDim === 'week' ? 'active' : ''}" data-stats-dim="week">周视图</button>
            <button type="button" class="life-seg-btn ${ledgerStatsDim === 'month' ? 'active' : ''}" data-stats-dim="month">月视图</button>
            <button type="button" class="life-seg-btn ${ledgerStatsDim === 'year' ? 'active' : ''}" data-stats-dim="year">年视图</button>
          </div>

          <div class="life-period-nav-bar">
            <button type="button" class="life-period-step-btn" data-stats-step="-1" aria-label="上一周期">
              <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
            </button>
            <div class="life-period-center">
              ${rp.offset !== 0
                ? `<button type="button" class="life-period-title is-offset" data-stats-reset="1" title="点击回到当前周期">${esc(rp.periodTitle)}</button>`
                : `<div class="life-period-title">${esc(rp.periodTitle)}</div>`}
            </div>
            <button type="button" class="life-period-step-btn" data-stats-step="1" aria-label="下一周期">
              <svg viewBox="0 0 24 24"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
            </button>
          </div>

          ${statsKpiBannerHtml}
          ${visualChartHtml}
          ${focusDayHtml}

          <div class="life-form-pod">
            <div class="life-form-pod-title">
              <span>分类占比排行</span>
            </div>
            <div class="life-seg-group">
              <button type="button" class="life-seg-btn ${ledgerStatsRankType === 'expense' ? 'active' : ''}" data-stats-rank-type="expense">支出构成 (${rp.expenseRanking.length})</button>
              <button type="button" class="life-seg-btn ${ledgerStatsRankType === 'income' ? 'active' : ''}" data-stats-rank-type="income">收入构成 (${rp.incomeRanking.length})</button>
            </div>
            ${tickDonutHtml}
            <div class="life-log-list">${rankingRowsHtml}</div>
          </div>

          ${bottomRecordsHtml}
        `;

        tabContentHtml = `
          <div class="life-ledger-view-viewport" id="lifeLedgerViewViewport">
            <div class="life-ledger-view-track" id="lifeLedgerViewTrack">
              <div class="life-ledger-view-pane ${ledgerTab !== 'flow' ? 'is-collapsed-pane' : ''}" id="lifeLedgerPaneFlow">
                ${flowPaneHtml}
              </div>
              <div class="life-ledger-view-pane ${ledgerTab !== 'stats' ? 'is-collapsed-pane' : ''}" id="lifeLedgerPaneStats">
                ${statsPaneHtml}
              </div>
            </div>
          </div>
        `;
      } else if (ledgerTab === 'hub') {
        // ===== 资产总览大厅 (Hub) =====
        const totalAccs = accounts.length;
        const creditAccs = accounts.filter((a) => a.type === 'credit');
        const activeSubs = (snap.sub.items || []).filter((s) => !s.expired).length;
        const activeCards = snap.sub.activeCardCount || 0;
        const expCats2 = (snap.config.ledgerCategories && snap.config.ledgerCategories.expense) || [];
        const incCats2 = (snap.config.ledgerCategories && snap.config.ledgerCategories.income) || [];
        const totalCats = expCats2.length + incCats2.length;
        const nearestDue = ld.nearestCreditDue;
        const nearestSub = snap.sub.nearest;

        tabContentHtml = `
          <div class="life-asset-hub-networth">
            <div class="life-asset-hub-networth-top">
              <span class="life-asset-hub-networth-lbl">NET WORTH 净资产</span>
              <span class="life-asset-hub-networth-tag">ASSET VAULT</span>
            </div>
            <div class="life-asset-hub-networth-val ${ld.netWorth >= 0 ? 'is-pos' : 'is-neg'}">${cur}${Math.abs(ld.netWorth).toFixed(2)}</div>
            <div class="life-asset-hub-networth-row">
              <span class="life-asset-hub-networth-sub is-pos">ASSETS ${cur}${ld.totalAssets.toFixed(0)}</span>
              <span class="life-asset-hub-networth-sub is-neg">DEBT ${cur}${ld.totalDebt.toFixed(0)}</span>
            </div>
          </div>

          <button type="button" class="life-asset-hub-card" data-hub-enter="accounts">
            <div class="life-asset-hub-card-left">
              <span class="life-asset-hub-card-ico">${svgLedgerIcon('wallet')}</span>
              <div class="life-asset-hub-card-info">
                <div class="life-asset-hub-card-name">账户管理</div>
                <div class="life-asset-hub-card-en">ACCOUNT VAULT</div>
              </div>
            </div>
            <div class="life-asset-hub-card-right">
              <div class="life-asset-hub-card-metric">${totalAccs} 个账户</div>
              ${nearestDue && nearestDue.usedDebt > 0 ? `<div class="life-asset-hub-card-hint">待还 ${cur}${nearestDue.usedDebt.toFixed(0)} · ${nearestDue.daysToDue}天后到期</div>` : `<div class="life-asset-hub-card-hint">净资产 ${cur}${ld.netWorth.toFixed(0)}</div>`}
            </div>
          </button>

          <button type="button" class="life-asset-hub-card" data-hub-enter="sub">
            <div class="life-asset-hub-card-left">
              <span class="life-asset-hub-card-ico">${svgLedgerIcon('subpass')}</span>
              <div class="life-asset-hub-card-info">
                <div class="life-asset-hub-card-name">订阅管理</div>
                <div class="life-asset-hub-card-en">SUB & PASSES</div>
              </div>
            </div>
            <div class="life-asset-hub-card-right">
              <div class="life-asset-hub-card-metric">${activeSubs} 项订阅 · ${activeCards} 张卡券</div>
              ${nearestSub ? `<div class="life-asset-hub-card-hint">下次扣费 ${cur}${nearestSub.price.toFixed(1)} · ${nearestSub.daysLeft}天后</div>` : `<div class="life-asset-hub-card-hint">月均支出 ${cur}${snap.sub.monthlyTotal.toFixed(0)}</div>`}
            </div>
          </button>

          <button type="button" class="life-asset-hub-card" data-hub-enter="categories">
            <div class="life-asset-hub-card-left">
              <span class="life-asset-hub-card-ico">${svgLedgerIcon('layers')}</span>
              <div class="life-asset-hub-card-info">
                <div class="life-asset-hub-card-name">预算与分类</div>
                <div class="life-asset-hub-card-en">BUDGET & CATS</div>
              </div>
            </div>
            <div class="life-asset-hub-card-right">
              <div class="life-asset-hub-card-metric">${totalCats} 个分类 · 预算 ${ld.budgetRatio}%</div>
              <div class="life-asset-hub-card-hint ${ld.budgetRemain < 0 ? 'is-warn' : ''}">${ld.budgetRemain >= 0 ? `本月剩余 ${cur}${ld.budgetRemain.toFixed(0)}` : `超支 ${cur}${Math.abs(ld.budgetRemain).toFixed(0)}`}</div>
            </div>
          </button>
        `;
      } else if (ledgerTab === 'accounts') {
        const assetAccs = accounts.filter((a) => a.type !== 'credit');
        const creditAccs = accounts.filter((a) => a.type === 'credit');
        const editingAcc = ledgerAccountEditId
          ? accounts.find((a) => a.id === ledgerAccountEditId) || null
          : null;

        const calibrateTarget = ledgerCalibrateAccId
          ? accounts.find((a) => a.id === ledgerCalibrateAccId) || null
          : null;

        const accountFormPodHtml = `
          <div class="life-form-pod ${editingAcc ? 'life-highlight-pod' : ''}" id="lifeAccFormPod">
            <div class="life-form-pod-title">
              <span>${editingAcc ? `编辑账户 · ${esc(editingAcc.name)}` : '新增资金或信用账户'}</span>
              ${editingAcc ? '<button type="button" class="life-mini-act-btn" data-acc-edit-cancel="1">收起</button>' : ''}
            </div>
            <div class="life-seg-group">
              <button type="button" class="life-seg-btn ${ledgerAccountFormType === 'cash' ? 'active' : ''}" data-acc-form-type="cash">电子钱包/现金</button>
              <button type="button" class="life-seg-btn ${ledgerAccountFormType === 'debit' ? 'active' : ''}" data-acc-form-type="debit">银行储蓄卡</button>
              <button type="button" class="life-seg-btn ${ledgerAccountFormType === 'credit' ? 'active' : ''}" data-acc-form-type="credit">信用卡/花呗</button>
            </div>
            <div class="life-form-grid">
              <div class="life-field">
                <label>账户名称</label>
                <input type="text" id="lifeAccName" class="life-input" placeholder="例如：招商储蓄卡 / 京东白条" value="${editingAcc ? esc(editingAcc.name) : ''}">
              </div>
              <div class="life-field">
                <label>${ledgerAccountFormType === 'credit' ? '初始已欠款' : '初始余额'}</label>
                <input type="number" step="0.01" id="lifeAccInitBal" class="life-input" value="${editingAcc ? Number(editingAcc.initialBalance || 0) : 0}">
              </div>

              ${ledgerAccountFormType === 'credit' ? `
                <div class="life-field">
                  <label>授信总额度</label>
                  <input type="number" step="100" id="lifeAccLimit" class="life-input" value="${editingAcc ? Number(editingAcc.creditLimit || 10000) : 10000}">
                </div>
                <div class="life-field">
                  <label>逾期日利率 %</label>
                  <input type="number" step="0.01" id="lifeAccDailyRate" class="life-input" value="${editingAcc ? Number(editingAcc.dailyInterestRate || 0.05) : 0.05}">
                </div>
                <div class="life-field">
                  <label>每月账单日 (1-31)</label>
                  <input type="number" min="1" max="31" id="lifeAccStmtDay" class="life-input" value="${editingAcc ? Number(editingAcc.statementDay || 1) : 1}">
                </div>
                <div class="life-field">
                  <label>每月还款日 (1-31)</label>
                  <input type="number" min="1" max="31" id="lifeAccDueDay" class="life-input" value="${editingAcc ? Number(editingAcc.dueDay || 10) : 10}">
                </div>
              ` : ''}

              <div class="life-field full">
                <label class="life-flag-check">
                  <input type="checkbox" id="lifeAccNetWorth" ${!editingAcc || editingAcc.includeInNetWorth !== false ? 'checked' : ''}>
                  <span>计入总净资产看板（小金库或代管资金可取消勾选）</span>
                </label>
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="account-save">
              <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
              <span>${editingAcc ? '保存账户参数' : '添加新账户'}</span>
            </button>
          </div>
        `;

        const calibratePodHtml = calibrateTarget
          ? `
            <div class="life-form-pod life-highlight-pod">
              <div class="life-form-pod-title">
                <span>一键平账校准 · ${esc(calibrateTarget.name)}</span>
                <button type="button" class="life-mini-act-btn" data-acc-calibrate-cancel="1">收起</button>
              </div>
              <div class="life-form-grid">
                <div class="life-field">
                  <label>${calibrateTarget.type === 'credit' ? '当前真实待还欠款' : '当前真实账户余额'}</label>
                  <input type="number" step="0.01" id="lifeCalibrateActual" class="life-input" value="${calibrateTarget.type === 'credit' ? calibrateTarget.usedDebt.toFixed(2) : calibrateTarget.balance.toFixed(2)}">
                </div>
                <div class="life-field">
                  <label>校准方式</label>
                  ${renderLifeSelectField({ id: 'lifeCalibrateMode', kind: 'calibrate-mode', value: 'record' })}
                </div>
              </div>
              <button type="button" class="life-submit-btn" data-life-submit="acc-calibrate">
                <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>确认平账校准</span>
              </button>
            </div>
          `
          : '';

        const assetCardsHtml = assetAccs.map((a) => `
          <div class="life-acc-card">
            <div class="life-acc-card-top">
              <div class="life-acc-title-group">
                <span class="life-acc-ico">${svgLedgerIcon(a.iconKey)}</span>
                <div>
                  <div class="life-acc-name">${esc(a.name)}</div>
                  <div class="life-acc-meta">${a.type === 'debit' ? 'DEBIT 储蓄账户' : 'WALLET 现金与电子钱包'}${a.includeInNetWorth === false ? ' · 不计净资产' : ''}</div>
                </div>
              </div>
              <div class="life-acc-bal">${cur}${a.balance.toFixed(2)}</div>
            </div>
            <div class="life-acc-actions">
              <button type="button" class="life-mini-act-btn" data-acc-calibrate="${esc(a.id)}">一键平账</button>
              <button type="button" class="life-mini-act-btn" data-acc-quick-transfer="${esc(a.id)}">转入/转出</button>
              <button type="button" class="life-mini-act-btn" data-acc-edit="${esc(a.id)}">编辑</button>
              ${accounts.length > 1 ? `<button type="button" class="life-mini-act-btn danger" data-acc-delete="${esc(a.id)}">删除</button>` : ''}
            </div>
          </div>
        `).join('');

        const creditCardsHtml = creditAccs.map((a) => `
          <div class="life-acc-card is-credit">
            <div class="life-acc-card-top">
              <div class="life-acc-title-group">
                <span class="life-acc-ico">${svgLedgerIcon(a.iconKey || 'credit')}</span>
                <div>
                  <div class="life-acc-name">${esc(a.name)}</div>
                  <div class="life-acc-meta">账单日 ${a.statementDay}日 (${a.daysToStatement}天后) · 还款日 ${a.dueDay}日 (${a.daysToDue}天后)</div>
                </div>
              </div>
              <div class="life-acc-debt-box">
                <span class="life-acc-debt-lbl">USED DEBT 待还</span>
                <span class="life-acc-debt-val">${cur}${a.usedDebt.toFixed(2)}</span>
              </div>
            </div>

            <div class="life-credit-bar-track">
              <div class="life-credit-bar-fill" style="width:${a.usageRatio}%;"></div>
            </div>
            <div class="life-credit-telemetry">
              <span>可用额度 ${cur}${a.availableCredit.toFixed(0)} / 总额 ${cur}${Number(a.creditLimit || 0).toFixed(0)} (${a.usageRatio}%)</span>
              <span>日息率 ${a.dailyInterestRate}% · 逾期预估 ${cur}${a.dailyInterestEst.toFixed(2)}/天</span>
            </div>

            <div class="life-acc-actions">
              <button type="button" class="life-mini-act-btn primary" data-credit-repay="${esc(a.id)}" data-repay-amt="${a.usedDebt.toFixed(2)}">一键还款</button>
              <button type="button" class="life-mini-act-btn" data-acc-calibrate="${esc(a.id)}">欠款平账</button>
              <button type="button" class="life-mini-act-btn" data-acc-edit="${esc(a.id)}">改参数</button>
              ${accounts.length > 1 ? `<button type="button" class="life-mini-act-btn danger" data-acc-delete="${esc(a.id)}">删除</button>` : ''}
            </div>
          </div>
        `).join('');

        const samplePreview = LifeStore.calcInstallmentMetrics(3000, 6, 0.6, 0);
        const installmentListHtml = (ld.installments && ld.installments.length)
          ? ld.installments.map((ins) => `
              <div class="life-inst-card">
                <div class="life-inst-top">
                  <div>
                    <div class="life-log-main">
                      <span class="life-log-tag">${ins.paidPeriods}/${ins.periods} 期</span>
                      <span>${esc(ins.title)}</span>
                    </div>
                    <div class="life-log-sub">${esc(ins.accountName)} · 本金 ${cur}${ins.principal.toFixed(0)} · 总息费 ${cur}${ins.totalFee.toFixed(2)} (年化≈${ins.approxApr}%)</div>
                  </div>
                  <div class="life-inst-right">
                    <div class="life-log-val">${cur}${ins.payPerPeriod.toFixed(2)}<small>/期</small></div>
                    <div class="life-inst-btns">
                      ${ins.paidPeriods < ins.periods ? `<button type="button" class="life-mini-act-btn primary" data-inst-pay="${esc(ins.id)}">还一期</button>` : '<span class="life-inline-pill ok">已结清</span>'}
                      <button type="button" class="life-log-del-btn" data-inst-remove="${esc(ins.id)}" aria-label="移除分期">
                        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `).join('')
          : '';

        tabContentHtml = `
          ${calibratePodHtml}
          ${editingAcc ? accountFormPodHtml : ''}

          <div class="life-section-caption">ASSET ACCOUNTS 现金与储蓄账户 (${assetAccs.length})</div>
          <div class="life-log-list">${assetCardsHtml || '<div class="life-empty-hint">暂无储蓄/现金账户</div>'}</div>

          <div class="life-section-caption">CREDIT & HUABEI 信用卡与透支账户 (${creditAccs.length})</div>
          <div class="life-log-list">${creditCardsHtml || '<div class="life-empty-hint">暂无信用透支账户，可在下方添加</div>'}</div>

          <div class="life-form-pod">
            <div class="life-form-pod-title">
              <span>信用卡分期与真实年化试算</span>
            </div>
            <div class="life-form-grid">
              <div class="life-field">
                <label>分期项目名称</label>
                <input type="text" id="lifeInstTitle" class="life-input" placeholder="例如：新耳机 / 机票分期">
              </div>
              <div class="life-field">
                <label>所属信用账户</label>
                ${renderLifeSelectField({ id: 'lifeInstAccount', kind: 'inst-account', value: ((creditAccs[0] || accounts[0]) && (creditAccs[0] || accounts[0]).id) || defaultAccId })}
              </div>
              <div class="life-field">
                <label>分期总本金 (${cur})</label>
                <input type="number" step="10" id="lifeInstPrincipal" class="life-input" value="3000" data-inst-calc-input="1">
              </div>
              <div class="life-field">
                <label>分期期数 (期)</label>
                <input type="number" min="2" max="60" id="lifeInstPeriods" class="life-input" value="6" data-inst-calc-input="1">
              </div>
              <div class="life-field full">
                <label>每期手续费率 %（如 0.6 代表每期 0.6%，0 为免息分期）</label>
                <input type="number" step="0.05" id="lifeInstRate" class="life-input" value="0.6" data-inst-calc-input="1">
              </div>
            </div>
            <div class="life-inst-preview-box" id="lifeInstPreviewBox">
              <span>每期应还 <strong>${cur}${samplePreview.payPerPeriod.toFixed(2)}</strong> (本金 ${cur}${samplePreview.principalPerPeriod.toFixed(2)} + 息费 ${cur}${samplePreview.feePerPeriod.toFixed(2)})</span>
              <span>总手续费 <strong>${cur}${samplePreview.totalFee.toFixed(2)}</strong> · 近似真实年化 <strong>${samplePreview.approxApr}%</strong></span>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="installment-add">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>登记分期计划</span>
            </button>
          </div>

          ${installmentListHtml ? `<div class="life-log-list">${installmentListHtml}</div>` : ''}

          ${!editingAcc ? accountFormPodHtml : ''}
        `;
      } else if (ledgerTab === 'categories') {
        const manageList = ledgerCatTab === 'income' ? incCats : expCats;
        const catRowsHtml = manageList.map((c) => {
          const spent = Number(c.monthSpent || 0);
          const subB = Number(c.monthlyBudget || 0);
          const pct = Number(c.budgetUsedRatio || 0);
          return `
            <div class="life-cat-manage-card">
              <div class="life-cat-manage-top">
                <div class="life-acc-title-group">
                  <span class="life-acc-ico">${svgLedgerIcon(c.iconKey)}</span>
                  <div>
                    <div class="life-acc-name">${esc(c.name)}</div>
                    <div class="life-acc-meta">${ledgerCatTab === 'expense' ? `本月已支 ${cur}${spent.toFixed(2)}${subB > 0 ? ` / 子预算 ${cur}${subB.toFixed(0)} (${pct}%)` : ' · 未设限额'}` : '收入入账分类'}</div>
                  </div>
                </div>
                <div class="life-log-right">
                  ${ledgerCatTab === 'expense' ? `
                    <input type="number" step="50" class="life-cat-budget-input" data-cat-budget-id="${esc(c.id)}" placeholder="子预算" value="${subB > 0 ? subB : ''}" title="月度子预算">
                  ` : ''}
                  ${manageList.length > 1 ? `
                    <button type="button" class="life-log-del-btn" data-cat-remove="${esc(c.id)}" data-cat-type="${esc(ledgerCatTab)}" aria-label="删除分类">
                      <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                    </button>
                  ` : ''}
                </div>
              </div>
              ${ledgerCatTab === 'expense' && subB > 0 ? `
                <div class="life-credit-bar-track">
                  <div class="life-credit-bar-fill ${c.overBudget ? 'is-over' : ''}" style="width:${pct}%;"></div>
                </div>
              ` : ''}
            </div>
          `;
        }).join('');

        const iconPickerHtml = LEDGER_ICON_KEYS.map((k) => `
          <button type="button" class="life-ico-pick-btn ${ledgerCatIconPick === k ? 'active' : ''}" data-cat-ico-pick="${esc(k)}" aria-label="${esc(k)}">
            ${svgLedgerIcon(k)}
          </button>
        `).join('');

        tabContentHtml = `
          <div class="life-form-pod">
            <div class="life-form-pod-title">
              <span>月度总预算设定</span>
              <span>REMAIN ${ld.budgetRatio}%</span>
            </div>
            <div class="life-budget-inline-row">
              <input type="number" step="100" id="lifeMasterBudgetInput" class="life-input" value="${ld.budget}">
              <button type="button" class="life-submit-btn" data-life-submit="budget-save">
                <span>保存</span>
              </button>
            </div>
          </div>

          <div class="life-seg-group">
            <button type="button" class="life-seg-btn ${ledgerCatTab === 'expense' ? 'active' : ''}" data-cat-manage-tab="expense">支出分类与子预算 (${expCats.length})</button>
            <button type="button" class="life-seg-btn ${ledgerCatTab === 'income' ? 'active' : ''}" data-cat-manage-tab="income">收入分类库 (${incCats.length})</button>
          </div>

          <div class="life-form-pod">
            <div class="life-form-pod-title">
              <span>新增自定义${ledgerCatTab === 'income' ? '收入' : '支出'}分类</span>
              <span>VECTOR SVG</span>
            </div>
            <div class="life-form-grid">
              <div class="life-field ${ledgerCatTab === 'expense' ? '' : 'full'}">
                <label>分类名称</label>
                <input type="text" id="lifeNewCatName" class="life-input" placeholder="例如：谷子周边 / 稿费分成">
              </div>
              ${ledgerCatTab === 'expense' ? `
                <div class="life-field">
                  <label>月度子预算(选填)</label>
                  <input type="number" step="50" id="lifeNewCatBudget" class="life-input" placeholder="0 为不限">
                </div>
              ` : ''}
              <div class="life-field full">
                <label>选择矢量图标</label>
                <div class="life-ico-picker-grid">${iconPickerHtml}</div>
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="category-add">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>添加分类</span>
            </button>
          </div>

          <div class="life-log-list">${catRowsHtml}</div>
          ${ledgerCatTab === 'expense' ? `
            <button type="button" class="life-submit-btn" data-life-submit="cat-budgets-save">
              <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
              <span>保存上方各分类子预算</span>
            </button>
          ` : ''}
        `;
      } else {
        const subCards = snap.sub.cards || [];
        const vaultSwitchHtml = `
          <div class="life-seg-group">
            <button type="button" class="life-seg-btn ${subVaultTab === 'subs' ? 'active' : ''}" data-sub-vault-tab="subs">订阅与买断 (${snap.sub.items.length})</button>
            <button type="button" class="life-seg-btn ${subVaultTab === 'cards' ? 'active' : ''}" data-sub-vault-tab="cards">次卡与储值卡 (${subCards.length})</button>
          </div>
        `;

        if (subVaultTab === 'subs') {
          const editingSub = subEditId
            ? (snap.sub.items || []).find((s) => s.id === subEditId) || null
            : null;
          if (subEditId && !editingSub) {
            subEditId = null;
          }

          const cycleLabelMap = { daily: '天', weekly: '周', monthly: '月', yearly: '年' };
          const subListHtml = snap.sub.items.length
            ? snap.sub.items.map((s) => {
              const acc = accMap.get(s.accountId);
              const mode = s.subMode || 'recurring';
              const ic = Math.max(1, Number(s.intervalCount) || 1);
              const cycUnit = cycleLabelMap[s.cycle] || '月';
              let subMetaLine = '';
              let rightMainVal = `${cur}${Number(s.price).toFixed(1)}`;
              let actionBtnHtml = '';

              if (mode === 'lifetime') {
                subMetaLine = `购入 ${esc(s.startDate || '--')} · 已持有 ${s.heldDays}天 · 日均 ${cur}${s.dailyAmortized.toFixed(2)}`;
              } else if (mode === 'onetime') {
                if (s.expired) {
                  subMetaLine = `到期 ${esc(s.expireDate || '--')} · 一次性限时`;
                } else {
                  subMetaLine = `到期 ${esc(s.expireDate || '--')} · 折合 ${cur}${s.monthlyEquivalent}/月${acc ? ` · ${esc(acc.name)}` : ''}`;
                }
                actionBtnHtml = `<button type="button" class="life-mini-act-btn primary" data-sub-renew="${esc(s.id)}">续期</button>`;
              } else {
                const cycText = ic > 1 ? `每${ic}${cycUnit}` : `每${cycUnit}`;
                const nextTxt = s.daysLeft <= 0 ? '今日扣费' : `${s.daysLeft}天后扣费`;
                subMetaLine = `${cycText} · ${nextTxt}${acc ? ` · ${esc(acc.name)}` : ''}`;
                actionBtnHtml = `<button type="button" class="life-mini-act-btn primary" data-sub-renew="${esc(s.id)}">续一期</button>`;
              }

              return `
                <div class="life-sub-card ${s.expired ? 'is-expired-row' : ''} ${editingSub && editingSub.id === s.id ? 'is-editing' : ''}" data-sub-edit="${esc(s.id)}">
                  <div class="life-sub-card-top">
                    <span class="life-sub-card-name">${esc(s.name)}</span>
                    <span class="life-log-val">${rightMainVal}</span>
                  </div>
                  <div class="life-sub-card-bottom">
                    <div class="life-sub-card-meta">
                      <span class="life-sub-card-sub">${subMetaLine}</span>
                    </div>
                    <div class="life-sub-card-actions">
                      ${actionBtnHtml}
                      <button type="button" class="life-log-del-btn" data-sub-remove="${esc(s.id)}" aria-label="删除订阅">
                        <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')
            : '<div class="life-empty-hint">暂无周期订阅或买断协议</div>';

          const subShowForm = subFormOpen || Boolean(editingSub);
          const subFlagChecksHtml = `
            ${subFormMode === 'recurring' ? `
              <label class="life-flag-check">
                <input type="checkbox" id="lifeSubAutoRenew" ${(!editingSub || editingSub.autoRenew !== false) ? 'checked' : ''}>
                <span>到期自动扣费入账并顺延周期</span>
              </label>
            ` : ''}
            ${!editingSub ? `
              <label class="life-flag-check">
                <input type="checkbox" id="lifeSubRecordNow" ${subFormMode !== 'recurring' ? 'checked' : ''}>
                <span>立即同步记一笔首期/买断支出流水</span>
              </label>
            ` : ''}
          `.trim();

          const subFormAreaHtml = subShowForm ? `
            <div class="life-form-pod ${editingSub ? 'life-highlight-pod' : ''}">
              <div class="life-form-pod-title">
                <span>${editingSub ? `编辑权益 · ${esc(editingSub.name)}` : '登记订阅与买断权益'}</span>
                <div class="life-form-pod-title-right">
                  <span>${subFormMode === 'lifetime' ? 'AMORTIZE' : subFormMode === 'onetime' ? 'FIXED-TERM' : 'RECURRING'}</span>
                  <button type="button" class="life-mini-act-btn" data-sub-form-toggle="0">${editingSub ? '取消' : '收起'}</button>
                </div>
              </div>

              <div class="life-seg-group">
                <button type="button" class="life-seg-btn ${subFormMode === 'recurring' ? 'active' : ''}" data-sub-form-mode="recurring">周期续费</button>
                <button type="button" class="life-seg-btn ${subFormMode === 'onetime' ? 'active' : ''}" data-sub-form-mode="onetime">一次性限时</button>
                <button type="button" class="life-seg-btn ${subFormMode === 'lifetime' ? 'active' : ''}" data-sub-form-mode="lifetime">永久买断</button>
              </div>

              <div class="life-form-grid">
                <div class="life-field">
                  <label>权益/软件名称</label>
                  <input type="text" id="lifeSubName" class="life-input" value="${editingSub ? esc(editingSub.name) : ''}" placeholder="${subFormMode === 'lifetime' ? '例如：Procreate / 买断插件' : subFormMode === 'onetime' ? '例如：视频年卡 / 7天漫游包' : '例如：iCloud / Apple Music'}">
                </div>
                <div class="life-field">
                  <label>${subFormMode === 'lifetime' ? '买断实付价' : subFormMode === 'onetime' ? '单次总价' : '每期扣费金额'} (${cur})</label>
                  <input type="number" step="0.01" id="lifeSubPrice" class="life-input" value="${editingSub ? Number(editingSub.price) : ''}" placeholder="18.00">
                </div>

                ${subFormMode === 'recurring' ? `
                  <div class="life-field">
                    <label>周期跨度(每N期)</label>
                    <input type="number" min="1" max="36" id="lifeSubInterval" class="life-input" value="${editingSub ? Math.max(1, Number(editingSub.intervalCount) || 1) : 1}">
                  </div>
                  <div class="life-field">
                    <label>周期单位</label>
                    ${renderLifeSelectField({ id: 'lifeSubCycle', kind: 'sub-cycle', value: editingSub ? (editingSub.cycle || 'monthly') : 'monthly' })}
                  </div>
                  <div class="life-field full">
                    <label>下次扣费日</label>
                    ${renderLifeDateField({ id: 'lifeSubNextDate', value: (editingSub && editingSub.nextBillDate) ? editingSub.nextBillDate : LifeStore.addCycleToDateKey(snap.todayKey, 'monthly', 1), title: '选择下次扣费日' })}
                  </div>
                ` : subFormMode === 'onetime' ? `
                  <div class="life-field">
                    <label>生效起始日</label>
                    ${renderLifeDateField({ id: 'lifeSubStartDate', value: (editingSub && editingSub.startDate) ? editingSub.startDate : snap.todayKey, title: '选择生效起始日' })}
                  </div>
                  <div class="life-field">
                    <label>到期截止日</label>
                    ${renderLifeDateField({ id: 'lifeSubExpireDate', value: (editingSub && editingSub.expireDate) ? editingSub.expireDate : LifeStore.addCycleToDateKey(snap.todayKey, 'yearly', 1), title: '选择到期截止日' })}
                  </div>
                ` : `
                  <div class="life-field full">
                    <label>买断购入日期</label>
                    ${renderLifeDateField({ id: 'lifeSubStartDate', value: (editingSub && editingSub.startDate) ? editingSub.startDate : snap.todayKey, title: '选择买断购入日期' })}
                  </div>
                `}

                <div class="life-field full">
                  <label>关联付款账户</label>
                  ${renderLifeSelectField({ id: 'lifeSubAccount', kind: 'account', value: (editingSub && editingSub.accountId) ? editingSub.accountId : defaultAccId })}
                </div>

                ${subFlagChecksHtml ? `
                  <div class="life-field full">
                    <div class="life-flag-check-row">
                      ${subFlagChecksHtml}
                    </div>
                  </div>
                ` : ''}
              </div>

              <button type="button" class="life-submit-btn" data-life-submit="sub">
                <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>${editingSub ? '保存修改' : '确认登记权益'}</span>
              </button>
            </div>
          ` : `
            <button type="button" class="life-sub-add-trigger" data-sub-form-toggle="1">
              <span class="life-sub-add-trigger-left">
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>新增订阅 / 买断权益</span>
              </span>
              <span class="life-sub-add-trigger-en">NEW ENTITLEMENT</span>
            </button>
          `;

          tabContentHtml = `
            ${vaultSwitchHtml}
            ${subFormAreaHtml}
            <div class="life-log-list">${subListHtml}</div>
          `;
        } else {
          const editingCard = cardEditId
            ? subCards.find((c) => c.id === cardEditId) || null
            : null;
          if (cardEditId && !editingCard) {
            cardEditId = null;
          }

          const activeActionCard = cardActionId
            ? subCards.find((c) => c.id === cardActionId) || null
            : null;

          const cardActionPodHtml = activeActionCard
            ? (cardActionKind === 'redeem' ? `
                <div class="life-form-pod life-highlight-pod">
                  <div class="life-form-pod-title">
                    <span>核销扣减 · ${esc(activeActionCard.name)}</span>
                    <button type="button" class="life-mini-act-btn" data-card-action-cancel="1">收起</button>
                  </div>
                  <div class="life-form-grid">
                    <div class="life-field">
                      <label>本次核销${activeActionCard.cardType === 'balance' ? `卡金 (${cur})` : `数量 (${esc(activeActionCard.unit)})`}</label>
                      <input type="number" step="0.01" id="lifeCardRedeemAmt" class="life-input" value="${activeActionCard.cardType === 'balance' ? '' : '1'}" placeholder="${activeActionCard.cardType === 'balance' ? '例如：38.00' : '1'}">
                    </div>
                    <div class="life-field">
                      <label>消费备注(选填)</label>
                      <input type="text" id="lifeCardRedeemNote" class="life-input" placeholder="例如：剪发 / 拿铁两杯">
                    </div>
                  </div>
                  <button type="button" class="life-submit-btn" data-life-submit="card-redeem">
                    <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                    <span>确认卡内扣减（不重复扣预算）</span>
                  </button>
                </div>
              ` : `
                <div class="life-form-pod life-highlight-pod">
                  <div class="life-form-pod-title">
                    <span>续充加购 · ${esc(activeActionCard.name)}</span>
                    <button type="button" class="life-mini-act-btn" data-card-action-cancel="1">收起</button>
                  </div>
                  <div class="life-form-grid">
                    <div class="life-field">
                      <label>增加卡面${activeActionCard.cardType === 'balance' ? '含赠总额' : `总${esc(activeActionCard.unit)}数`}</label>
                      <input type="number" step="0.01" id="lifeCardTopupVal" class="life-input" placeholder="${activeActionCard.cardType === 'balance' ? '例如：600 (充500送100填600)' : '例如：10'}">
                    </div>
                    <div class="life-field">
                      <label>本次真实掏钱 (${cur})</label>
                      <input type="number" step="0.01" id="lifeCardTopupPaid" class="life-input" placeholder="例如：500.00">
                    </div>
                    <div class="life-field full">
                      <label>付款资金账户</label>
                      ${renderLifeSelectField({ id: 'lifeCardTopupAcc', kind: 'account', value: activeActionCard.accountId || defaultAccId })}
                    </div>
                    <div class="life-field full">
                      <label class="life-flag-check">
                        <input type="checkbox" id="lifeCardTopupRecord" checked>
                        <span>同步在上方付款账户记一笔充值支出流水</span>
                      </label>
                    </div>
                  </div>
                  <button type="button" class="life-submit-btn" data-life-submit="card-topup">
                    <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                    <span>确认续充入卡</span>
                  </button>
                </div>
              `)
            : '';

          const cardsListHtml = subCards.length
            ? subCards.map((vc) => {
              const isBal = vc.cardType === 'balance';
              const remainTxt = isBal
                ? `${cur}${vc.remainValue.toFixed(2)}`
                : `${Number(vc.remainValue % 1 === 0 ? vc.remainValue.toFixed(0) : vc.remainValue.toFixed(1))} ${esc(vc.unit)}`;
              const totalTxt = isBal
                ? `${cur}${vc.totalValue.toFixed(0)}`
                : `${vc.totalValue}${esc(vc.unit)}`;
              const costDesc = isBal
                ? (vc.discountFold ? `累计实付 ${cur}${vc.costPaid.toFixed(0)} (约 ${vc.discountFold} 折)` : `累计实付 ${cur}${vc.costPaid.toFixed(0)}`)
                : `实付 ${cur}${vc.costPaid.toFixed(0)} · 折合 ${cur}${vc.unitCost.toFixed(1)}/${esc(vc.unit)}`;
              const expBadge = vc.expired
                ? '<span class="life-inline-pill muted">已过期</span>'
                : vc.exhausted
                  ? '<span class="life-inline-pill muted">已用尽</span>'
                  : (vc.daysToExpire !== null
                    ? `<span class="life-inline-pill ${vc.daysToExpire <= 14 ? 'warn' : 'ok'}">剩 ${vc.daysToExpire} 天</span>`
                    : '');
              const recentLog = (vc.logs && vc.logs[0])
                ? `最近：${esc(vc.logs[0].dateKey)} ${vc.logs[0].type === 'topup' ? '+' : '-'}${vc.logs[0].amount}${isBal ? '元' : esc(vc.unit)} (${esc(vc.logs[0].note || '')})`
                : '';

              return `
                <div class="life-pass-card ${vc.expired || vc.exhausted ? 'is-dimmed' : ''} ${editingCard && editingCard.id === vc.id ? 'is-editing' : ''}" data-card-edit="${esc(vc.id)}">
                  <div class="life-acc-card-top">
                    <div class="life-acc-title-group">
                      <span class="life-acc-ico">${svgLedgerIcon(isBal ? 'wallet' : 'gift')}</span>
                      <div>
                        <div class="life-log-main">
                          <span class="life-acc-name">${esc(vc.name)}</span>
                          ${expBadge}
                        </div>
                        <div class="life-acc-meta">${costDesc}</div>
                      </div>
                    </div>
                    <div class="life-acc-debt-box">
                      <span class="life-acc-debt-lbl">REMAIN 剩余 / ${totalTxt}</span>
                      <span class="life-acc-bal">${remainTxt}</span>
                    </div>
                  </div>

                  <div class="life-credit-bar-track">
                    <div class="life-credit-bar-fill" style="width:${vc.remainRatio}%;"></div>
                  </div>

                  ${recentLog ? `<div class="life-pass-recent-log">${recentLog}</div>` : ''}

                  <div class="life-acc-actions">
                    ${!isBal && vc.remainValue > 0 ? `
                      <button type="button" class="life-mini-act-btn primary" data-card-quick-minus="${esc(vc.id)}">划卡 -1${esc(vc.unit)}</button>
                    ` : ''}
                    ${vc.remainValue > 0 ? `
                      <button type="button" class="life-mini-act-btn ${isBal ? 'primary' : ''}" data-card-open-redeem="${esc(vc.id)}">${isBal ? '消费扣卡金' : '自定核销'}</button>
                    ` : ''}
                    <button type="button" class="life-mini-act-btn" data-card-open-topup="${esc(vc.id)}">续充</button>
                    <button type="button" class="life-mini-act-btn danger" data-card-remove="${esc(vc.id)}">删除</button>
                  </div>
                </div>
              `;
            }).join('')
            : '<div class="life-empty-hint">暂无次卡或储值余额卡，办卡录入后划卡不重复扣预算</div>';

          const cardShowForm = cardFormOpen || Boolean(editingCard);
          const cardFormAreaHtml = cardShowForm ? `
            <div class="life-form-pod ${editingCard ? 'life-highlight-pod' : ''}">
              <div class="life-form-pod-title">
                <span>${editingCard ? `编辑卡券 · ${esc(editingCard.name)}` : '新增次卡或储值余额卡'}</span>
                <div class="life-form-pod-title-right">
                  <span>PREPAID VAULT</span>
                  <button type="button" class="life-mini-act-btn" data-card-form-toggle="0">${editingCard ? '取消' : '收起'}</button>
                </div>
              </div>

              <div class="life-seg-group">
                <button type="button" class="life-seg-btn ${cardFormType === 'count' ? 'active' : ''}" data-card-form-type="count">计次卡 / 课时券</button>
                <button type="button" class="life-seg-btn ${cardFormType === 'balance' ? 'active' : ''}" data-card-form-type="balance">储值余额卡 (含充赠)</button>
              </div>

              <div class="life-form-grid">
                <div class="life-field ${cardFormType === 'count' ? '' : 'full'}">
                  <label>卡券名称</label>
                  <input type="text" id="lifeCardName" class="life-input" value="${editingCard ? esc(editingCard.name) : ''}" placeholder="${cardFormType === 'count' ? '例如：普拉提私教10节课 / 洗车次卡' : '例如：烘焙坊储值卡 / 理发店会员卡'}">
                </div>
                ${cardFormType === 'count' ? `
                  <div class="life-field">
                    <label>计量单位</label>
                    <input type="text" id="lifeCardUnit" class="life-input" value="${editingCard && editingCard.cardType !== 'balance' ? esc(editingCard.unit || '次') : '次'}" placeholder="次 / 节 / 张">
                  </div>
                ` : ''}
                <div class="life-field">
                  <label>${cardFormType === 'balance' ? `卡面含赠总金额 (${cur})` : '总次数/总张数'}</label>
                  <input type="number" step="0.01" id="lifeCardTotal" class="life-input" value="${editingCard ? Number(editingCard.totalValue) : ''}" placeholder="${cardFormType === 'balance' ? '例如：600 (充500送100)' : '10'}">
                </div>
                <div class="life-field">
                  <label>${cardFormType === 'balance' ? `当前剩余卡金 (${cur})` : '当前剩余次数(不填默认满卡)'}</label>
                  <input type="number" step="0.01" id="lifeCardRemain" class="life-input" value="${editingCard ? Number(editingCard.remainValue) : ''}" placeholder="默认等于总额">
                </div>
                <div class="life-field">
                  <label>${editingCard ? `累计实付 (${cur})` : `办卡真实实付 (${cur})`}</label>
                  <input type="number" step="0.01" id="lifeCardPaid" class="life-input" value="${editingCard ? Number(editingCard.costPaid) : ''}" placeholder="${cardFormType === 'balance' ? '例如：500.00' : '例如：1200.00'}">
                </div>
                <div class="life-field">
                  <label>有效期截止(选填)</label>
                  ${renderLifeDateField({ id: 'lifeCardExpire', value: editingCard ? (editingCard.expireDate || '') : '', title: '选择卡券有效期截止日', allowClear: true, placeholder: '长期有效（可点选截止日）' })}
                </div>
                <div class="life-field full">
                  <label>${editingCard ? '关联资金账户' : '办卡付款账户'}</label>
                  ${renderLifeSelectField({ id: 'lifeCardAccount', kind: 'account', value: (editingCard && editingCard.accountId) ? editingCard.accountId : defaultAccId })}
                </div>
                ${!editingCard ? `
                  <div class="life-field full">
                    <label class="life-flag-check">
                      <input type="checkbox" id="lifeCardRecordNow" checked>
                      <span>立即按「真实实付」在上方账户记一笔办卡支出（后续划卡不再重复扣预算）</span>
                    </label>
                  </div>
                ` : ''}
              </div>

              <button type="button" class="life-submit-btn" data-life-submit="card-add">
                <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
                <span>${editingCard ? '保存修改' : '存入卡包'}</span>
              </button>
            </div>
          ` : `
            <button type="button" class="life-sub-add-trigger" data-card-form-toggle="1">
              <span class="life-sub-add-trigger-left">
                <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
                <span>新增次卡 / 储值余额卡</span>
              </span>
              <span class="life-sub-add-trigger-en">PREPAID VAULT</span>
            </button>
          `;

          tabContentHtml = `
            ${vaultSwitchHtml}
            ${cardActionPodHtml}
            ${cardFormAreaHtml}
            <div class="life-log-list">${cardsListHtml}</div>
          `;
        }
      }

      sheetBodyEl.innerHTML = `
        ${ledgerPrimaryTab === 'flow' ? `
          <div class="life-flow-top-bar">
            <button type="button" class="life-budget-meter-pod" data-ledger-goto-budget="1" aria-label="前往预算设置">
              <div class="life-budget-meter-top">
                <span class="life-budget-meter-lbl">MONTH BUDGET 月预算</span>
                <span class="life-budget-meter-val ${ld.budgetRemain < 0 ? 'is-over' : ''}">${cur}${ld.monthExpense.toFixed(0)} / ${ld.budget.toFixed(0)}</span>
              </div>
              <div class="life-budget-meter-track">
                <div class="life-budget-meter-fill ${ld.budgetRemain < 0 ? 'is-over' : ''}" style="width:${Math.min(100, ld.budget > 0 ? (ld.monthExpense / ld.budget) * 100 : 0).toFixed(1)}%"></div>
              </div>
            </button>
            <button type="button" class="life-flow-toggle-btn ${ledgerTab === 'flow' && ledgerFormOpen ? 'is-active' : ''}" data-ledger-toggle-form="1" aria-label="${ledgerTab === 'flow' && ledgerFormOpen ? '收起记账表单' : '记一笔'}">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
            </button>
            <button type="button" class="life-flow-toggle-btn life-view-switch-btn ${ledgerTab === 'stats' ? 'is-active' : ''}" data-ledger-tab="${ledgerTab === 'flow' ? 'stats' : 'flow'}" data-ledger-view-switch="1" aria-label="${ledgerTab === 'flow' ? '切换至统计视图' : '切换至记账视图'}">
              <svg class="ico-to-stats" viewBox="0 0 24 24"><path d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zM16.2 13h2.8v6h-2.8v-6z"/></svg>
              <svg class="ico-to-flow" viewBox="0 0 24 24"><path d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zM3 17h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>
            </button>
          </div>
        ` : `
        `}

        ${tabContentHtml}
      `;

      // 底部双 Tab 平铺主导航（仅首次挂载 DOM，后续原地切换 active，杜绝重绘时底栏游标跳闪）
      let footerEl = sheetEl.querySelector('.life-sheet-footer');
      if (!footerEl || !footerEl.querySelector('[data-ledger-primary]')) {
        if (!footerEl) {
          footerEl = document.createElement('div');
          footerEl.className = 'life-sheet-footer';
          sheetEl.appendChild(footerEl);
        }
        footerEl.innerHTML = `
          <span class="life-footer-cursor" aria-hidden="true"></span>
          <button type="button" class="life-footer-tab" data-ledger-primary="flow">
            <svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg>
            <span class="life-footer-tab-copy">
              <span class="life-footer-tab-cn">收支流水</span>
              <span class="life-footer-tab-en">LEDGER FLOW</span>
            </span>
          </button>
          <button type="button" class="life-footer-tab" data-ledger-primary="assets">
            <svg viewBox="0 0 24 24"><path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>
            <span class="life-footer-tab-copy">
              <span class="life-footer-tab-cn">资产总览</span>
              <span class="life-footer-tab-en">ASSET VAULT</span>
            </span>
          </button>
        `;
      }
      footerEl.querySelectorAll('[data-ledger-primary]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-ledger-primary') === ledgerPrimaryTab);
      });
      footerEl.hidden = false;
      footerEl.classList.toggle('is-kb-hidden', sheetKeyboardOpen);
      sheetBodyEl.classList.add('has-flat-footer');

      finishSheetMount();
      return;
    }

    // 非记账终端模块，隐藏底部双 Tab 导航
    const footerEl = sheetEl.querySelector('.life-sheet-footer');
    if (footerEl) footerEl.hidden = true;
    sheetBodyEl.classList.remove('has-flat-footer');

    if (moduleKey === 'fitness') {
      const workoutListHtml = snap.fitness.records.length
        ? snap.fitness.records.map((r) => `
            <div class="life-log-item">
              <div class="life-log-left">
                <div class="life-log-main">
                  <span class="life-log-tag">${esc(r.activity || '训练')}</span>
                  <span>${Number(r.duration || 0)} 分钟</span>
                </div>
                <div class="life-log-sub">${esc(r.dateKey || '')} // 消耗 ${Number(r.calories || 0)} KCAL</div>
              </div>
              <div class="life-log-right">
                <span class="life-log-val">${Number(r.duration || 0)} MIN</span>
                <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO WORKOUT LOGS // 暂无运动打卡记录</div>';

      const weightListHtml = snap.weight.records.length
        ? snap.weight.records.map((r) => `
            <div class="life-log-item">
              <div class="life-log-left">
                <div class="life-log-main">
                  <span class="life-log-tag">MASS</span>
                  <span>${esc(r.note || '晨起空腹采样')}</span>
                </div>
                <div class="life-log-sub">${esc(r.dateKey || '')}</div>
              </div>
              <div class="life-log-right">
                <span class="life-log-val">${Number(r.weight || 0).toFixed(1)} KG</span>
                <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO WEIGHT LOGS // 暂无体重采样记录</div>';

      sheetBodyEl.innerHTML = `
        <div class="life-seg-group">
          <button type="button" class="life-seg-btn ${fitnessTab === 'workout' ? 'active' : ''}" data-fitness-tab="workout">TRACK A // 运动打卡</button>
          <button type="button" class="life-seg-btn ${fitnessTab === 'weight' ? 'active' : ''}" data-fitness-tab="weight">TRACK B // 体重管理</button>
        </div>

        ${fitnessTab === 'workout' ? `
          <div class="life-form-pod">
            <div class="life-form-pod-title"><span>WORKOUT CHECK-IN // 运动训练打卡</span><span>KINETIC</span></div>
            <div class="life-form-grid">
              <div class="life-field">
                <label>ACTIVITY // 运动项目</label>
                ${renderLifeSelectField({ id: 'lifeFitnessType', kind: 'fitness-type', value: '有氧慢跑' })}
              </div>
              <div class="life-field">
                <label>DURATION (MIN) // 时长</label>
                <input type="number" id="lifeFitnessDuration" class="life-input" value="30">
              </div>
              <div class="life-field">
                <label>CALORIES (KCAL) // 热量</label>
                <input type="number" id="lifeFitnessCalories" class="life-input" value="220">
              </div>
              <div class="life-field">
                <label>DATE // 日期</label>
                ${renderLifeDateField({ id: 'lifeFitnessDate', value: snap.todayKey, title: '选择训练打卡日期' })}
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="fitness">
              <span>LOG WORKOUT // 确认打卡</span>
            </button>
          </div>
          <div class="life-log-list">${workoutListHtml}</div>
        ` : `
          <div class="life-form-pod">
            <div class="life-form-pod-title"><span>MASS SAMPLING // 体重记录与目标</span><span>MASS</span></div>
            <div class="life-form-grid">
              <div class="life-field">
                <label>WEIGHT (KG) // 当前体重</label>
                <input type="number" step="0.1" id="lifeWeightVal" class="life-input" placeholder="52.5">
              </div>
              <div class="life-field">
                <label>TARGET (KG) // 目标体重</label>
                <input type="number" step="0.1" id="lifeWeightTarget" class="life-input" value="${snap.weight.targetWeight}">
              </div>
              <div class="life-field full">
                <label>NOTE // 状态备注</label>
                <input type="text" id="lifeWeightNote" class="life-input" placeholder="例如：晨起空腹 / 训练后">
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="weight">
              <span>SAVE WEIGHT // 记录体重</span>
            </button>
          </div>
          <div class="life-log-list">${weightListHtml}</div>
        `}
      `;
      finishSheetMount();
      return;
    }

    if (moduleKey === 'period') {
      const listHtml = snap.period.records.length
        ? snap.period.records.map((r) => `
            <div class="life-log-item">
              <div class="life-log-left">
                <div class="life-log-main">
                  <span class="life-log-tag">CYCLE</span>
                  <span>起始日 ${esc(r.startDate)}</span>
                </div>
                <div class="life-log-sub">流量：${esc(r.flow || '正常')} // 痛感：${esc(r.pain || '轻微')}</div>
              </div>
              <div class="life-log-right">
                <span class="life-log-val">${Number(r.days || snap.period.durLen)} DAYS</span>
                <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO CYCLE DATA // 录入最近一次经期起始日即可开启智能相位推算</div>';

      sheetBodyEl.innerHTML = `
        <div class="life-form-pod">
          <div class="life-form-pod-title"><span>LOG CYCLE // 经期登记与周期参数</span><span>BIORHYTHM</span></div>
          <div class="life-form-grid">
            <div class="life-field">
              <label>START DATE // 经期首日</label>
              ${renderLifeDateField({ id: 'lifePeriodStart', value: snap.todayKey, title: '选择经期首日' })}
            </div>
            <div class="life-field">
              <label>DURATION // 持续天数</label>
              <input type="number" id="lifePeriodDays" class="life-input" value="${snap.period.durLen}">
            </div>
            <div class="life-field">
              <label>CYCLE LENGTH // 周期设置(天)</label>
              <input type="number" id="lifePeriodCycleCfg" class="life-input" value="${snap.period.cycleLen}">
            </div>
            <div class="life-field">
              <label>SYMPTOM // 体感状态</label>
              ${renderLifeSelectField({ id: 'lifePeriodPain', kind: 'period-pain', value: '平稳无感' })}
            </div>
          </div>
          <button type="button" class="life-submit-btn" data-life-submit="period">
            <span>CALIBRATE CYCLE // 保存经期记录</span>
          </button>
        </div>

        <div class="life-log-list">${listHtml}</div>
      `;
      finishSheetMount();
      return;
    }

    if (moduleKey === 'meds') {
      const plansHtml = snap.meds.plans.length
        ? snap.meds.plans.map((p) => {
            const isTaken = snap.meds.takenSet.has(p.id);
            return `
              <div class="life-med-check-card ${isTaken ? 'taken' : ''}" data-med-toggle="${esc(p.id)}">
                <div class="life-log-left">
                  <div class="life-log-main">${esc(p.name)} · ${esc(p.dose)}</div>
                  <div class="life-log-sub">${esc(p.slot)}</div>
                </div>
                <div class="life-log-right">
                  <span class="life-med-status-pill">${isTaken ? 'TAKEN // 已服' : 'PENDING // 打卡'}</span>
                  <button type="button" class="life-log-del-btn" data-med-remove="${esc(p.id)}" title="移除方案">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              </div>
            `;
          }).join('')
        : '<div class="life-empty-hint">NO MED PLANS // 药盒为空，请在下方添加日常补剂或药品</div>';

      sheetBodyEl.innerHTML = `
        <div class="life-log-list">${plansHtml}</div>

        <div class="life-form-pod">
          <div class="life-form-pod-title"><span>ADD SUPPLEMENT // 新增药盒常备项</span><span>MEDBAY</span></div>
          <div class="life-form-grid">
            <div class="life-field full">
              <label>NAME // 药品或补剂名称</label>
              <input type="text" id="lifeMedName" class="life-input" placeholder="例如：维生素 D3 / 布洛芬">
            </div>
            <div class="life-field">
              <label>DOSE // 单次剂量</label>
              <input type="text" id="lifeMedDose" class="life-input" value="1 粒">
            </div>
            <div class="life-field">
              <label>SLOT // 服用时段</label>
              ${renderLifeSelectField({ id: 'lifeMedSlot', kind: 'med-slot', value: 'MORNING // 晨间' })}
            </div>
          </div>
          <button type="button" class="life-submit-btn" data-life-submit="meds">
            <span>ADD TO PILLBOX // 装入药盒</span>
          </button>
        </div>
      `;
      finishSheetMount();
      return;
    }

    if (moduleKey === 'sleep') {
      const listHtml = snap.sleep.records.length
        ? snap.sleep.records.map((r) => `
            <div class="life-log-item">
              <div class="life-log-left">
                <div class="life-log-main">
                  <span class="life-log-tag">${esc(r.quality || 'GOOD')}</span>
                  <span>${esc(r.bedTime || '23:30')} → ${esc(r.wakeTime || '07:30')}</span>
                </div>
                <div class="life-log-sub">${esc(r.dateKey || '')}</div>
              </div>
              <div class="life-log-right">
                <span class="life-log-val">${Number(r.hours || 0).toFixed(1)} H</span>
                <button type="button" class="life-log-del-btn" data-life-del="${esc(r.id)}">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO SLEEP TELEMETRY // 暂无睡眠监测流水</div>';

      sheetBodyEl.innerHTML = `
        <div class="life-form-pod">
          <div class="life-form-pod-title"><span>SLEEP LOG // 记录入睡与晨醒时间</span><span>HF-SIGNAL</span></div>
          <div class="life-form-grid">
            <div class="life-field">
              <label>BED TIME // 入睡时刻</label>
              <input type="time" id="lifeSleepBed" class="life-input" value="23:30">
            </div>
            <div class="life-field">
              <label>WAKE TIME // 醒来时刻</label>
              <input type="time" id="lifeSleepWake" class="life-input" value="07:30">
            </div>
            <div class="life-field">
              <label>QUALITY // 睡眠深度</label>
              ${renderLifeSelectField({ id: 'lifeSleepQuality', kind: 'sleep-quality', value: 'DEEP // 深睡充沛' })}
            </div>
            <div class="life-field">
              <label>DATE // 记录日期</label>
              ${renderLifeDateField({ id: 'lifeSleepDate', value: snap.todayKey, title: '选择睡眠记录日期' })}
            </div>
          </div>
          <button type="button" class="life-submit-btn" data-life-submit="sleep">
            <span>RECORD SLEEP // 保存作息记录</span>
          </button>
        </div>

        <div class="life-log-list">${listHtml}</div>
      `;
      finishSheetMount();
      return;
    }

    if (moduleKey === 'memo') {
      const pendingTodoCount = snap.memo.todos.filter((t) => !t.done).length;
      const pendingWishCount = snap.memo.wishes.filter((w) => !w.done).length;
      const noteCount = snap.memo.notes.length;

      const sortedTodos = snap.memo.todos.slice().sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)));
      const todoListHtml = sortedTodos.length
        ? sortedTodos.map((item) => `
            <div class="life-memo-check-card ${item.done ? 'done' : ''}" data-memo-toggle="${esc(item.id)}">
              <div class="life-memo-check-box" aria-hidden="true">
                ${item.done ? '<svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' : ''}
              </div>
              <div class="life-log-left" style="flex:1;">
                <div class="life-log-main">
                  <span class="life-log-tag">${esc(item.tag || 'TODO')}</span>
                  <span class="life-memo-title-text">${esc(item.title)}</span>
                </div>
                <div class="life-log-sub">${esc(item.dateKey || '')}${item.note ? ' // ' + esc(item.note) : ''}</div>
              </div>
              <div class="life-log-right">
                <button type="button" class="life-log-del-btn" data-life-del="${esc(item.id)}" aria-label="删除待办">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO TODO ITEMS // 暂无待办事项</div>';

      const sortedWishes = snap.memo.wishes.slice().sort((a, b) => Number(Boolean(a.done)) - Number(Boolean(b.done)));
      const wishListHtml = sortedWishes.length
        ? sortedWishes.map((item) => `
            <div class="life-memo-check-card ${item.done ? 'done' : ''}" data-memo-toggle="${esc(item.id)}">
              <div class="life-memo-check-box" aria-hidden="true">
                ${item.done ? '<svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>' : ''}
              </div>
              <div class="life-log-left" style="flex:1;">
                <div class="life-log-main">
                  <span class="life-log-tag">${esc(item.tag || 'WISH')}</span>
                  <span class="life-memo-title-text">${esc(item.title)}</span>
                </div>
                <div class="life-log-sub">${item.note ? esc(item.note) : esc(item.dateKey || '待购草单')}</div>
              </div>
              <div class="life-log-right">
                ${Number(item.price) > 0 ? `<span class="life-log-val">${cur}${Number(item.price).toFixed(0)}</span>` : ''}
                <button type="button" class="life-log-del-btn" data-life-del="${esc(item.id)}" aria-label="删除草单">
                  <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                </button>
              </div>
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO WISHLIST // 暂无购物草单</div>';

      const noteListHtml = snap.memo.notes.length
        ? snap.memo.notes.map((item) => `
            <div class="life-memo-note-card">
              <div class="life-memo-note-head">
                <div class="life-log-main">
                  <span class="life-log-tag">${esc(item.tag || 'NOTE')}</span>
                  <span>${esc(item.title || '无题便签')}</span>
                </div>
                <div class="life-log-right">
                  <span class="life-log-sub">${esc(item.dateKey || '')}</span>
                  <button type="button" class="life-log-del-btn" data-life-del="${esc(item.id)}" aria-label="删除便签">
                    <svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                  </button>
                </div>
              </div>
              ${item.content ? `<div class="life-memo-note-body">${esc(item.content)}</div>` : ''}
            </div>
          `).join('')
        : '<div class="life-empty-hint">NO FREE NOTES // 暂无自由便签</div>';

      sheetBodyEl.innerHTML = `
        <div class="life-seg-group">
          <button type="button" class="life-seg-btn ${memoTab === 'todo' ? 'active' : ''}" data-memo-tab="todo">TODO // 待办清单</button>
          <button type="button" class="life-seg-btn ${memoTab === 'wish' ? 'active' : ''}" data-memo-tab="wish">WISH // 购物草单</button>
          <button type="button" class="life-seg-btn ${memoTab === 'note' ? 'active' : ''}" data-memo-tab="note">NOTE // 自由便签</button>
        </div>

        ${memoTab === 'todo' ? `
          <div class="life-form-pod">
            <div class="life-form-pod-title"><span>NEW TODO // 新增待办事项</span><span>CHECKLIST</span></div>
            <div class="life-form-grid">
              <div class="life-field full">
                <label>TASK // 待办内容</label>
                <input type="text" id="lifeMemoTodoTitle" class="life-input" placeholder="例如：拿驿站快递 / 洗床单">
              </div>
              <div class="life-field">
                <label>TAG // 优先级或分类</label>
                ${renderLifeSelectField({ id: 'lifeMemoTodoTag', kind: 'memo-todo-tag', value: 'DAILY' })}
              </div>
              <div class="life-field">
                <label>REMARK // 补充小注</label>
                <input type="text" id="lifeMemoTodoNote" class="life-input" placeholder="可选：取件码等">
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="memo-todo">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>ADD TASK // 加入待办</span>
            </button>
          </div>
          <div class="life-log-list">${todoListHtml}</div>
        ` : memoTab === 'wish' ? `
          <div class="life-form-pod">
            <div class="life-form-pod-title"><span>WISHLIST // 新增想买与补货清单</span><span>SUPPLY</span></div>
            <div class="life-form-grid">
              <div class="life-field full">
                <label>ITEM NAME // 物品名称</label>
                <input type="text" id="lifeMemoWishTitle" class="life-input" placeholder="例如：日抛隐形 / 秋冬外套 / 猫粮">
              </div>
              <div class="life-field">
                <label>EST. PRICE // 预估价（可选）</label>
                <input type="number" step="1" id="lifeMemoWishPrice" class="life-input" placeholder="0">
              </div>
              <div class="life-field">
                <label>TAG // 分类短标</label>
                ${renderLifeSelectField({ id: 'lifeMemoWishTag', kind: 'memo-wish-tag', value: 'WANT' })}
              </div>
              <div class="life-field full">
                <label>SPEC & CHANNEL // 规格色号或渠道备注</label>
                <input type="text" id="lifeMemoWishNote" class="life-input" placeholder="可选：色号 / 尺码 / 等大促凑单">
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="memo-wish">
              <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
              <span>ADD TO WISHLIST // 加入草单</span>
            </button>
          </div>
          <div class="life-log-list">${wishListHtml}</div>
        ` : `
          <div class="life-form-pod">
            <div class="life-form-pod-title"><span>FREE NOTE // 随手自由便签</span><span>ARCHIVE</span></div>
            <div class="life-form-grid">
              <div class="life-field">
                <label>TITLE // 便签标题</label>
                <input type="text" id="lifeMemoNoteTitle" class="life-input" placeholder="例如：奶茶点单红黑榜">
              </div>
              <div class="life-field">
                <label>TAG // 便签标签</label>
                <input type="text" id="lifeMemoNoteTag" class="life-input" value="IDEA" placeholder="IDEA / FOOD">
              </div>
              <div class="life-field full">
                <label>CONTENT // 正文记录</label>
                <textarea id="lifeMemoNoteBody" class="life-textarea" rows="4" placeholder="自由输入备忘内容、灵感碎片、外卖避雷或常用信息..."></textarea>
              </div>
            </div>
            <button type="button" class="life-submit-btn" data-life-submit="memo-note">
              <svg viewBox="0 0 24 24"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg>
              <span>SAVE NOTE // 保存便签</span>
            </button>
          </div>
          <div class="life-log-list">${noteListHtml}</div>
        `}
      `;
      finishSheetMount();
    }
  }

  /** 计算入睡到醒来的小时差 */
  function calcSleepHours(bedStr, wakeStr) {
    const [bh, bm] = String(bedStr || '23:30').split(':').map(Number);
    const [wh, wm] = String(wakeStr || '07:30').split(':').map(Number);
    if (!Number.isFinite(bh) || !Number.isFinite(wh)) return 8.0;
    let startMin = bh * 60 + (bm || 0);
    let endMin = wh * 60 + (wm || 0);
    if (endMin <= startMin) endMin += 24 * 60;
    return Number(((endMin - startMin) / 60).toFixed(1));
  }

  /** 处理子面板表单提交 */
  async function handleFormSubmit(kind) {
    if (!window.LifeStore) return;

    if (kind === 'ledger') {
      const amtEl = document.getElementById('lifeLedgerAmount');
      const dateEl = document.getElementById('lifeLedgerDate');
      const noteEl = document.getElementById('lifeLedgerNote');
      const amount = Number(amtEl && amtEl.value);
      if (!Number.isFinite(amount) || amount <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'LEDGER // 校验', message: '请输入有效金额（需大于 0）', type: 'warning' });
        return;
      }

      const dateKey = (dateEl && dateEl.value) || LifeStore.toDateKey();
      const note = noteEl ? noteEl.value.trim() : '';

      if (ledgerFormType === 'transfer') {
        const fromEl = document.getElementById('lifeLedgerFromAccount');
        const toEl = document.getElementById('lifeLedgerToAccount');
        const feeEl = document.getElementById('lifeLedgerFee');
        const fromId = fromEl ? fromEl.value : '';
        const toId = toEl ? toEl.value : '';
        if (!fromId || !toId || fromId === toId) {
          if (window.RetroToast) RetroToast.show({ tag: 'TRANSFER // 校验', message: '请选择两个不同的转出与转入账户', type: 'warning' });
          return;
        }
        const fee = Math.max(0, Number(feeEl && feeEl.value) || 0);
        const targetAccObj = (latestSnap && latestSnap.ledger && latestSnap.ledger.accounts || []).find((a) => a.id === toId);
        const payload = {
          type: 'transfer',
          fromAccountId: fromId,
          toAccountId: toId,
          amount: Number(amount.toFixed(2)),
          fee: Number(fee.toFixed(2)),
          category: (targetAccObj && targetAccObj.type === 'credit') ? '信用还款' : '账户互转',
          dateKey,
          note
        };
        if (ledgerEditRecordId) {
          await LifeStore.updateLedgerRecord(ledgerEditRecordId, payload);
        } else {
          await LifeStore.addModuleRecord('ledger', payload);
        }
        ledgerEditRecordId = null;
        ledgerTransferPresetToId = '';
        ledgerTransferPresetAmt = '';
      } else {
        const accEl = document.getElementById('lifeLedgerAccount');
        const reimEl = document.getElementById('lifeLedgerReimbursable');
        const exclEl = document.getElementById('lifeLedgerExcludeStats');
        const payload = {
          type: ledgerFormType,
          accountId: accEl ? accEl.value : '',
          amount: Number(amount.toFixed(2)),
          category: ledgerSelectedCat || (ledgerFormType === 'income' ? '薪酬津贴' : '餐饮补给'),
          dateKey,
          note,
          reimbursable: ledgerFormType === 'expense' ? Boolean(reimEl && reimEl.checked) : false,
          excludeFromStats: ledgerFormType === 'expense' ? Boolean(exclEl && exclEl.checked) : false
        };
        if (ledgerEditRecordId) {
          await LifeStore.updateLedgerRecord(ledgerEditRecordId, payload);
        } else {
          await LifeStore.addModuleRecord('ledger', payload);
        }
        ledgerEditRecordId = null;
      }
      ledgerFormOpen = false;
      if (window.RetroToast) RetroToast.show({ tag: 'LEDGER // OK', message: '账单流水已入库并同步账户净值', type: 'success' });
    } else if (kind === 'acc-calibrate') {
      if (!ledgerCalibrateAccId) return;
      const actualEl = document.getElementById('lifeCalibrateActual');
      const modeEl = document.getElementById('lifeCalibrateMode');
      const val = Number(actualEl && actualEl.value);
      if (!Number.isFinite(val)) {
        if (window.RetroToast) RetroToast.show({ tag: 'CALIBRATE // 校验', message: '请输入有效的真实余额或待还欠款', type: 'warning' });
        return;
      }
      await LifeStore.calibrateAccountBalance(ledgerCalibrateAccId, val, modeEl ? modeEl.value : 'record');
      ledgerCalibrateAccId = null;
      if (window.RetroToast) RetroToast.show({ tag: 'CALIBRATE // OK', message: '账户余额已完成平账校准', type: 'success' });
    } else if (kind === 'account-save') {
      const nameEl = document.getElementById('lifeAccName');
      const initEl = document.getElementById('lifeAccInitBal');
      const nwEl = document.getElementById('lifeAccNetWorth');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) {
        if (window.RetroToast) RetroToast.show({ tag: 'ACCOUNT // 校验', message: '请输入账户名称', type: 'warning' });
        return;
      }
      const cfg = LifeStore.getConfig();
      const list = (cfg.accounts || []).slice();
      const accObj = {
        id: ledgerAccountEditId || `acc_${Date.now()}`,
        name,
        type: ledgerAccountFormType,
        iconKey: ledgerAccountFormType === 'credit' ? 'credit' : ledgerAccountFormType === 'debit' ? 'bank' : 'wallet',
        initialBalance: Number(initEl && initEl.value) || 0,
        includeInNetWorth: Boolean(!nwEl || nwEl.checked)
      };
      if (ledgerAccountFormType === 'credit') {
        const limEl = document.getElementById('lifeAccLimit');
        const rateEl = document.getElementById('lifeAccDailyRate');
        const sDayEl = document.getElementById('lifeAccStmtDay');
        const dDayEl = document.getElementById('lifeAccDueDay');
        accObj.creditLimit = Math.max(0, Number(limEl && limEl.value) || 10000);
        accObj.dailyInterestRate = Math.max(0, Number(rateEl && rateEl.value) || 0.05);
        accObj.statementDay = Math.min(31, Math.max(1, Number(sDayEl && sDayEl.value) || 1));
        accObj.dueDay = Math.min(31, Math.max(1, Number(dDayEl && dDayEl.value) || 10));
      }
      const existIdx = list.findIndex((a) => a.id === accObj.id);
      if (existIdx >= 0) {
        if (list[existIdx].type === accObj.type && list[existIdx].iconKey) {
          accObj.iconKey = list[existIdx].iconKey;
        }
        list[existIdx] = Object.assign({}, list[existIdx], accObj);
      } else {
        list.push(accObj);
      }
      await LifeStore.saveConfig({ accounts: list });
      ledgerAccountEditId = null;
      if (window.RetroToast) RetroToast.show({ tag: 'ACCOUNT // OK', message: '资金账户配置已保存', type: 'success' });
    } else if (kind === 'installment-add') {
      const titleEl = document.getElementById('lifeInstTitle');
      const accEl = document.getElementById('lifeInstAccount');
      const pEl = document.getElementById('lifeInstPrincipal');
      const nEl = document.getElementById('lifeInstPeriods');
      const rEl = document.getElementById('lifeInstRate');
      const principal = Number(pEl && pEl.value);
      const periods = Math.max(2, Math.min(60, Math.round(Number(nEl && nEl.value) || 6)));
      const feeRate = Math.max(0, Number(rEl && rEl.value) || 0);
      const title = (titleEl && titleEl.value.trim()) || '信用卡分期消费';
      if (!Number.isFinite(principal) || principal <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'INSTALLMENT // 校验', message: '请输入有效的分期本金', type: 'warning' });
        return;
      }
      const cfg = LifeStore.getConfig();
      const nextIns = (cfg.installments || []).slice();
      nextIns.unshift({
        id: `ins_${Date.now()}`,
        accountId: accEl ? accEl.value : 'acc_credit',
        title,
        principal: Number(principal.toFixed(2)),
        periods,
        feeRatePerPeriod: feeRate,
        fixedFeePerPeriod: 0,
        paidPeriods: 0,
        startDateKey: LifeStore.toDateKey(),
        active: true
      });
      await LifeStore.saveConfig({ installments: nextIns });
      if (window.RetroToast) RetroToast.show({ tag: 'INSTALLMENT // OK', message: '分期计划已建立，可逐期点击入账', type: 'success' });
    } else if (kind === 'budget-save') {
      const bEl = document.getElementById('lifeMasterBudgetInput');
      const val = Number(bEl && bEl.value);
      if (!Number.isFinite(val) || val <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'BUDGET // 校验', message: '请输入大于 0 的月度总预算', type: 'warning' });
        return;
      }
      await LifeStore.saveConfig({ monthlyBudget: Math.round(val) });
      if (window.RetroToast) RetroToast.show({ tag: 'BUDGET // OK', message: '月度总预算已更新', type: 'success' });
    } else if (kind === 'category-add') {
      const nameEl = document.getElementById('lifeNewCatName');
      const subBEl = document.getElementById('lifeNewCatBudget');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) {
        if (window.RetroToast) RetroToast.show({ tag: 'CATEGORY // 校验', message: '请输入新分类名称', type: 'warning' });
        return;
      }
      const cfg = LifeStore.getConfig();
      const catsObj = JSON.parse(JSON.stringify(cfg.ledgerCategories || {}));
      const targetArr = Array.isArray(catsObj[ledgerCatTab]) ? catsObj[ledgerCatTab] : [];
      if (targetArr.some((c) => c.name === name)) {
        if (window.RetroToast) RetroToast.show({ tag: 'CATEGORY // 重复', message: '该分类名称已存在', type: 'warning' });
        return;
      }
      targetArr.push({
        id: `cat_${ledgerCatTab}_${Date.now()}`,
        type: ledgerCatTab,
        name,
        iconKey: ledgerCatIconPick || 'layers',
        monthlyBudget: ledgerCatTab === 'expense' ? Math.max(0, Number(subBEl && subBEl.value) || 0) : 0,
        builtin: false
      });
      catsObj[ledgerCatTab] = targetArr;
      await LifeStore.saveConfig({ ledgerCategories: catsObj });
      ledgerSelectedCat = name;
      if (window.RetroToast) RetroToast.show({ tag: 'CATEGORY // OK', message: `已添加分类「${name}」`, type: 'success' });
    } else if (kind === 'cat-budgets-save') {
      if (!sheetBodyEl) return;
      const cfg = LifeStore.getConfig();
      const catsObj = JSON.parse(JSON.stringify(cfg.ledgerCategories || {}));
      const inputs = sheetBodyEl.querySelectorAll('[data-cat-budget-id]');
      const valMap = new Map();
      inputs.forEach((inp) => {
        const cid = inp.getAttribute('data-cat-budget-id');
        valMap.set(cid, Math.max(0, Number(inp.value) || 0));
      });
      catsObj.expense = (catsObj.expense || []).map((c) => (
        valMap.has(c.id) ? Object.assign({}, c, { monthlyBudget: valMap.get(c.id) }) : c
      ));
      await LifeStore.saveConfig({ ledgerCategories: catsObj });
      if (window.RetroToast) RetroToast.show({ tag: 'SUB-BUDGET // OK', message: '各支出分类月度子预算已保存', type: 'success' });
    } else if (kind === 'fitness') {
      const actEl = document.getElementById('lifeFitnessType');
      const durEl = document.getElementById('lifeFitnessDuration');
      const calEl = document.getElementById('lifeFitnessCalories');
      const dateEl = document.getElementById('lifeFitnessDate');
      const duration = Math.max(1, Number(durEl && durEl.value) || 30);
      const calories = Math.max(0, Number(calEl && calEl.value) || 0);

      await LifeStore.addModuleRecord('fitness', {
        activity: actEl ? actEl.value : '有氧训练',
        duration,
        calories,
        dateKey: (dateEl && dateEl.value) || LifeStore.toDateKey()
      });
    } else if (kind === 'weight') {
      const valEl = document.getElementById('lifeWeightVal');
      const targetEl = document.getElementById('lifeWeightTarget');
      const noteEl = document.getElementById('lifeWeightNote');

      const targetW = Number(targetEl && targetEl.value);
      if (Number.isFinite(targetW) && targetW > 0) {
        await LifeStore.saveConfig({ targetWeight: targetW });
      }

      const w = Number(valEl && valEl.value);
      if (!Number.isFinite(w) || w <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'MASS // 校验', message: '请输入有效体重数值', type: 'warning' });
        return;
      }

      await LifeStore.addModuleRecord('weight', {
        weight: Number(w.toFixed(1)),
        note: noteEl ? noteEl.value.trim() : ''
      });
    } else if (kind === 'period') {
      const startEl = document.getElementById('lifePeriodStart');
      const daysEl = document.getElementById('lifePeriodDays');
      const cycleEl = document.getElementById('lifePeriodCycleCfg');
      const painEl = document.getElementById('lifePeriodPain');

      const dur = Math.max(2, Math.min(15, Number(daysEl && daysEl.value) || 5));
      const cyc = Math.max(15, Math.min(60, Number(cycleEl && cycleEl.value) || 28));
      await LifeStore.saveConfig({ periodDurationDays: dur, periodCycleDays: cyc });

      await LifeStore.addModuleRecord('period', {
        startDate: (startEl && startEl.value) || LifeStore.toDateKey(),
        days: dur,
        pain: painEl ? painEl.value : '平稳无感',
        flow: '正常'
      });
    } else if (kind === 'meds') {
      const nameEl = document.getElementById('lifeMedName');
      const doseEl = document.getElementById('lifeMedDose');
      const slotEl = document.getElementById('lifeMedSlot');
      const name = nameEl ? nameEl.value.trim() : '';
      if (!name) {
        if (window.RetroToast) RetroToast.show({ tag: 'MEDBAY // 校验', message: '请输入药品或补剂名称', type: 'warning' });
        return;
      }
      const cfg = LifeStore.getConfig();
      const nextPlans = (cfg.medPlans || []).slice();
      nextPlans.push({
        id: `med_${Date.now()}`,
        name,
        dose: (doseEl && doseEl.value.trim()) || '1 粒',
        slot: (slotEl && slotEl.value) || 'MORNING // 晨间',
        active: true
      });
      await LifeStore.saveConfig({ medPlans: nextPlans });
    } else if (kind === 'sleep') {
      const bedEl = document.getElementById('lifeSleepBed');
      const wakeEl = document.getElementById('lifeSleepWake');
      const qualEl = document.getElementById('lifeSleepQuality');
      const dateEl = document.getElementById('lifeSleepDate');
      const bedTime = (bedEl && bedEl.value) || '23:30';
      const wakeTime = (wakeEl && wakeEl.value) || '07:30';
      const hours = calcSleepHours(bedTime, wakeTime);

      await LifeStore.addModuleRecord('sleep', {
        bedTime,
        wakeTime,
        hours,
        quality: (qualEl && qualEl.value.split(' ')[0]) || 'DEEP',
        dateKey: (dateEl && dateEl.value) || LifeStore.toDateKey()
      });
    } else if (kind === 'sub') {
      const nameEl = document.getElementById('lifeSubName');
      const priceEl = document.getElementById('lifeSubPrice');
      const cycleEl = document.getElementById('lifeSubCycle');
      const intervalEl = document.getElementById('lifeSubInterval');
      const nextDateEl = document.getElementById('lifeSubNextDate');
      const startDateEl = document.getElementById('lifeSubStartDate');
      const expireDateEl = document.getElementById('lifeSubExpireDate');
      const accEl = document.getElementById('lifeSubAccount');
      const tagEl = document.getElementById('lifeSubTag');
      const autoRenewEl = document.getElementById('lifeSubAutoRenew');
      const recNowEl = document.getElementById('lifeSubRecordNow');

      const name = nameEl ? nameEl.value.trim() : '';
      const price = Number(priceEl && priceEl.value);
      if (!name || !Number.isFinite(price) || price < 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'ENTITLEMENT // 校验', message: '请填写权益名称与有效价格', type: 'warning' });
        return;
      }

      const todayKey = LifeStore.toDateKey();
      const accountId = accEl ? accEl.value : '';
      const cycle = cycleEl ? cycleEl.value : 'monthly';
      const intervalCount = Math.max(1, Math.round(Number(intervalEl && intervalEl.value) || 1));
      const startDate = (startDateEl && startDateEl.value) || todayKey;
      const nextBillDate = (nextDateEl && nextDateEl.value) || LifeStore.addCycleToDateKey(todayKey, cycle, intervalCount);
      const expireDate = (expireDateEl && expireDateEl.value) || LifeStore.addCycleToDateKey(startDate, 'yearly', 1);
      const billDayMatch = /-(\d{2})$/.exec(nextBillDate);
      const billDay = billDayMatch ? Number(billDayMatch[1]) : 15;

      const cfg = LifeStore.getConfig();
      const nextSubs = (cfg.subscriptions || []).slice();
      const editIdx = subEditId ? nextSubs.findIndex((s) => s.id === subEditId) : -1;
      if (editIdx >= 0) {
        const prevSub = nextSubs[editIdx];
        nextSubs[editIdx] = Object.assign({}, prevSub, {
          name,
          subMode: subFormMode,
          price: Number(price.toFixed(2)),
          cycle,
          intervalCount,
          autoRenew: subFormMode === 'recurring' ? Boolean(autoRenewEl && autoRenewEl.checked) : false,
          billDay,
          startDate: subFormMode === 'recurring' ? (prevSub.startDate || startDate) : startDate,
          nextBillDate: subFormMode === 'recurring' ? nextBillDate : '',
          expireDate: subFormMode === 'onetime' ? expireDate : '',
          accountId,
          tag: prevSub.tag || (subFormMode === 'lifetime' ? 'LIFE' : subFormMode === 'onetime' ? 'PACK' : 'SUB')
        });
        await LifeStore.saveConfig({ subscriptions: nextSubs });
        subEditId = null;
        subFormOpen = false;
        if (window.RetroToast) RetroToast.show({ tag: 'ENTITLEMENT // OK', message: `已更新「${name}」权益`, type: 'success' });
      } else {
        nextSubs.unshift({
          id: `sub_${Date.now()}`,
          name,
          subMode: subFormMode,
          price: Number(price.toFixed(2)),
          cycle,
          intervalCount,
          autoRenew: subFormMode === 'recurring' ? Boolean(autoRenewEl && autoRenewEl.checked) : false,
          billDay,
          startDate,
          nextBillDate: subFormMode === 'recurring' ? nextBillDate : '',
          expireDate: subFormMode === 'onetime' ? expireDate : '',
          accountId,
          tag: (tagEl && tagEl.value.trim().toUpperCase()) || (subFormMode === 'lifetime' ? 'LIFE' : subFormMode === 'onetime' ? 'PACK' : 'SUB')
        });
        await LifeStore.saveConfig({ subscriptions: nextSubs });

        if (recNowEl && recNowEl.checked && price > 0) {
          await LifeStore.addModuleRecord('ledger', {
            type: 'expense',
            accountId: accountId || 'acc_wechat',
            amount: Number(price.toFixed(2)),
            category: '娱乐订阅',
            note: `[${subFormMode === 'lifetime' ? '永久买断' : subFormMode === 'onetime' ? '限时订阅' : '订阅首期'}] ${name}`,
            dateKey: startDate
          });
        }
        subEditId = null;
        subFormOpen = false;
        if (window.RetroToast) RetroToast.show({ tag: 'ENTITLEMENT // OK', message: `已登记「${name}」权益`, type: 'success' });
      }
    } else if (kind === 'card-add') {
      const nameEl = document.getElementById('lifeCardName');
      const unitEl = document.getElementById('lifeCardUnit');
      const totalEl = document.getElementById('lifeCardTotal');
      const remainEl = document.getElementById('lifeCardRemain');
      const paidEl = document.getElementById('lifeCardPaid');
      const expEl = document.getElementById('lifeCardExpire');
      const accEl = document.getElementById('lifeCardAccount');
      const recNowEl = document.getElementById('lifeCardRecordNow');

      const name = nameEl ? nameEl.value.trim() : '';
      const totalVal = Number(totalEl && totalEl.value);
      if (!name || !Number.isFinite(totalVal) || totalVal <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'PASS VAULT // 校验', message: '请填写卡券名称与大于 0 的总额/总次数', type: 'warning' });
        return;
      }

      const remainRaw = remainEl && remainEl.value !== '' ? Number(remainEl.value) : totalVal;
      const remainVal = Number.isFinite(remainRaw) && remainRaw >= 0 ? remainRaw : totalVal;
      const costPaid = Math.max(0, Number(paidEl && paidEl.value) || 0);
      const unit = cardFormType === 'balance' ? '元' : ((unitEl && unitEl.value.trim()) || '次');
      const accountId = accEl ? accEl.value : '';

      const cfg = LifeStore.getConfig();
      const nextCards = (cfg.valueCards || []).slice();
      const editCardIdx = cardEditId ? nextCards.findIndex((c) => c.id === cardEditId) : -1;
      if (editCardIdx >= 0) {
        const prevCard = nextCards[editCardIdx];
        nextCards[editCardIdx] = Object.assign({}, prevCard, {
          name,
          cardType: cardFormType,
          unit,
          totalValue: Number(totalVal.toFixed(2)),
          remainValue: Number(remainVal.toFixed(2)),
          costPaid: Number(costPaid.toFixed(2)),
          expireDate: (expEl && expEl.value) || '',
          tag: cardFormType === 'balance' ? 'CARD' : 'PASS',
          accountId
        });
        await LifeStore.saveConfig({ valueCards: nextCards });
        cardEditId = null;
        cardFormOpen = false;
        if (window.RetroToast) RetroToast.show({ tag: 'PASS VAULT // OK', message: `已更新「${name}」卡券`, type: 'success' });
      } else {
        nextCards.unshift({
          id: `vc_${Date.now()}`,
          name,
          cardType: cardFormType,
          unit,
          totalValue: Number(totalVal.toFixed(2)),
          remainValue: Number(remainVal.toFixed(2)),
          costPaid: Number(costPaid.toFixed(2)),
          startDate: LifeStore.toDateKey(),
          expireDate: (expEl && expEl.value) || '',
          tag: cardFormType === 'balance' ? 'CARD' : 'PASS',
          accountId,
          logs: []
        });
        await LifeStore.saveConfig({ valueCards: nextCards });

        if (recNowEl && recNowEl.checked && costPaid > 0) {
          await LifeStore.addModuleRecord('ledger', {
            type: 'expense',
            accountId: accountId || 'acc_wechat',
            amount: Number(costPaid.toFixed(2)),
            category: '休闲娱乐',
            note: `[办卡充值] ${name} (${totalVal}${unit})`
          });
        }
        cardEditId = null;
        cardFormOpen = false;
        if (window.RetroToast) RetroToast.show({ tag: 'PASS VAULT // OK', message: `「${name}」已存入卡包`, type: 'success' });
      }
    } else if (kind === 'card-redeem') {
      if (!cardActionId) return;
      const amtEl = document.getElementById('lifeCardRedeemAmt');
      const noteEl = document.getElementById('lifeCardRedeemNote');
      const val = Number(amtEl && amtEl.value);
      if (!Number.isFinite(val) || val <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'REDEEM // 校验', message: '请输入大于 0 的核销数值', type: 'warning' });
        return;
      }
      const res = await LifeStore.redeemValueCard(cardActionId, val, noteEl ? noteEl.value.trim() : '');
      cardActionId = null;
      cardActionKind = '';
      if (res && window.RetroToast) {
        RetroToast.show({ tag: 'REDEEM // OK', message: `核销成功，卡内剩余 ${res.remainValue}${res.unit}`, type: 'success' });
      }
    } else if (kind === 'card-topup') {
      if (!cardActionId) return;
      const valEl = document.getElementById('lifeCardTopupVal');
      const paidEl = document.getElementById('lifeCardTopupPaid');
      const accEl = document.getElementById('lifeCardTopupAcc');
      const recEl = document.getElementById('lifeCardTopupRecord');
      const addVal = Number(valEl && valEl.value);
      if (!Number.isFinite(addVal) || addVal <= 0) {
        if (window.RetroToast) RetroToast.show({ tag: 'TOP-UP // 校验', message: '请输入大于 0 的增加额度或次数', type: 'warning' });
        return;
      }
      const costPaid = Math.max(0, Number(paidEl && paidEl.value) || 0);
      const res = await LifeStore.topupValueCard(
        cardActionId,
        addVal,
        costPaid,
        accEl ? accEl.value : '',
        Boolean(recEl && recEl.checked)
      );
      cardActionId = null;
      cardActionKind = '';
      if (res && window.RetroToast) {
        RetroToast.show({ tag: 'TOP-UP // OK', message: `续充完成，当前余量 ${res.remainValue}${res.unit}`, type: 'success' });
      }
    } else if (kind === 'memo-todo') {
      const titleEl = document.getElementById('lifeMemoTodoTitle');
      const tagEl = document.getElementById('lifeMemoTodoTag');
      const noteEl = document.getElementById('lifeMemoTodoNote');
      const title = titleEl ? titleEl.value.trim() : '';
      if (!title) {
        if (window.RetroToast) RetroToast.show({ tag: 'MEMO // 校验', message: '请输入待办事项内容', type: 'warning' });
        return;
      }
      await LifeStore.addModuleRecord('memo', {
        mode: 'todo',
        title,
        tag: (tagEl && tagEl.value) || 'DAILY',
        note: noteEl ? noteEl.value.trim() : '',
        done: false
      });
    } else if (kind === 'memo-wish') {
      const titleEl = document.getElementById('lifeMemoWishTitle');
      const priceEl = document.getElementById('lifeMemoWishPrice');
      const tagEl = document.getElementById('lifeMemoWishTag');
      const noteEl = document.getElementById('lifeMemoWishNote');
      const title = titleEl ? titleEl.value.trim() : '';
      if (!title) {
        if (window.RetroToast) RetroToast.show({ tag: 'MEMO // 校验', message: '请输入物品名称', type: 'warning' });
        return;
      }
      const price = Math.max(0, Number(priceEl && priceEl.value) || 0);
      await LifeStore.addModuleRecord('memo', {
        mode: 'wish',
        title,
        price,
        tag: (tagEl && tagEl.value) || 'WANT',
        note: noteEl ? noteEl.value.trim() : '',
        done: false
      });
    } else if (kind === 'memo-note') {
      const titleEl = document.getElementById('lifeMemoNoteTitle');
      const tagEl = document.getElementById('lifeMemoNoteTag');
      const bodyEl = document.getElementById('lifeMemoNoteBody');
      const title = titleEl ? titleEl.value.trim() : '';
      const content = bodyEl ? bodyEl.value.trim() : '';
      if (!title && !content) {
        if (window.RetroToast) RetroToast.show({ tag: 'MEMO // 校验', message: '请填写便签标题或正文内容', type: 'warning' });
        return;
      }
      await LifeStore.addModuleRecord('memo', {
        mode: 'note',
        title: title || content.slice(0, 18),
        tag: (tagEl && tagEl.value.trim().toUpperCase().slice(0, 10)) || 'NOTE',
        content
      });
    }

    latestSnap = await LifeStore.getFullSnapshot();
    renderModuleSheetBody(activeModule);
    renderDashboard();
  }

  /* ========================================================================
     打开 / 关闭 / History 返回栈控制
     ======================================================================== */

  function ensurePagePhysics() {
    if (!window.Feel || !pageEl || pageBody) return;
    pageBody = new Feel.Body({
      feel: 'weighty, snappy',
      x: 0,
      target: 0,
      min: 0,
      max: 1.2,
      onFrame: (b) => {
        const p = Math.max(0, Math.min(1, b.x));
        const y = (1 - b.x) * 16;
        const sc = 0.985 + b.x * 0.015;
        pageEl.style.opacity = p.toFixed(3);
        pageEl.style.transform = Math.abs(1 - b.x) < 0.003 && b.target === 1
          ? 'translateY(0) scale(1)'
          : `translateY(${y.toFixed(2)}px) scale(${sc.toFixed(4)})`;
      },
      onSettle: (b) => {
        if (!isOpen && b.x <= 0.02) {
          pageEl.classList.remove('active');
          pageEl.hidden = true;
          pageEl.style.opacity = '';
          pageEl.style.transform = '';
        }
      }
    });
  }

  async function open() {
    ensureDOM();
    if (!pageEl) return;

    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    pageEl.classList.add('active');
    document.body.classList.add('page-active');

    await renderDashboard({ entrance: true });

    if (window.Feel) {
      ensurePagePhysics();
      pageBody.jump(0);
      pageBody.to(1);
    }

    if (!isOpen) {
      try {
        history.pushState({ rfPage: 'life-service' }, '', '#life-service');
      } catch (_) { /* ignore */ }
    }
    isOpen = true;
    syncAmbientState();
  }

  function dismissUI() {
    if (!pageEl) return;
    if (activeModule && sheetEl) {
      activeModule = null;
      sheetEl.classList.remove('open');
      sheetEl.hidden = true;
    }
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('page-active');
    isOpen = false;
    syncAmbientState();
    if (window.Feel && pageBody) {
      pageBody.to(0);
    } else {
      pageEl.classList.remove('active');
      pageEl.hidden = true;
    }
  }

  function close() {
    if (!isOpen) return;
    if (activeModule) {
      closeModuleSheet(false);
      return;
    }
    dismissUI();
    if ((window.location.hash || '').startsWith('#life')) {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (_) { /* ignore */ }
    }
  }

  function ensureDOM() {
    if (pageEl) return;
    pageEl = document.getElementById('lifeServicePage');
    deckEl = document.getElementById('lifeDeckContainer');
    sheetEl = document.getElementById('lifeModuleSheet');
    sheetTitleEl = document.getElementById('lifeSheetTitle');
    sheetCodeEl = document.getElementById('lifeSheetCode');
    sheetBodyEl = document.getElementById('lifeSheetBody');

    const backBtn = document.getElementById('lifeServiceBackBtn');
    const sheetBackBtn = document.getElementById('lifeSheetBackBtn');

    if (backBtn) {
      backBtn.addEventListener('click', close);
      bindTactileCard(backBtn);
    }
    if (sheetBackBtn) {
      sheetBackBtn.addEventListener('click', () => {
        if (isLedgerAssetSubView()) {
          exitLedgerAssetSubView(false);
          syncSheetHeaderTitle();
        } else {
          closeModuleSheet(false);
        }
      });
      bindTactileCard(sheetBackBtn);
    }

    if (deckEl) {
      deckEl.addEventListener('click', (e) => {
        const card = e.target.closest('[data-life-module]');
        if (!card) return;
        const mod = card.getAttribute('data-life-module');
        if (mod) openModuleSheet(mod, true);
      });
    }

    const captureSegIndices = () => {
      if (!sheetBodyEl) return [];
      return Array.from(sheetBodyEl.querySelectorAll('.life-seg-group')).map((g) => {
        const btns = Array.from(g.querySelectorAll('.life-seg-btn'));
        return btns.findIndex((b) => b.classList.contains('active'));
      });
    };

    if (sheetBodyEl) {
      sheetBodyEl.addEventListener('input', (e) => {
        if (e.target && e.target.id === 'lifeLedgerSearchInput') {
          ledgerSearchQuery = e.target.value || '';
          // 立即执行局部刷新，不再调用 renderModuleSheetBody
          updateLedgerFlowListInPlace();
          return;
        }

        if (e.target && e.target.hasAttribute('data-inst-calc-input') && window.LifeStore) {
          const pEl = document.getElementById('lifeInstPrincipal');
          const nEl = document.getElementById('lifeInstPeriods');
          const rEl = document.getElementById('lifeInstRate');
          const box = document.getElementById('lifeInstPreviewBox');
          if (!box) return;
          const m = LifeStore.calcInstallmentMetrics(
            Number(pEl && pEl.value) || 0,
            Number(nEl && nEl.value) || 6,
            Number(rEl && rEl.value) || 0,
            0
          );
          const curSym = esc((latestSnap && latestSnap.config && latestSnap.config.currencySymbol) || '¥');
          box.innerHTML = `
            <span>每期应还 <strong>${curSym}${m.payPerPeriod.toFixed(2)}</strong> (本金 ${curSym}${m.principalPerPeriod.toFixed(2)} + 息费 ${curSym}${m.feePerPeriod.toFixed(2)})</span>
            <span>总手续费 <strong>${curSym}${m.totalFee.toFixed(2)}</strong> · 近似真实年化 <strong>${m.approxApr}%</strong></span>
          `;
        }
      });

      sheetEl.addEventListener('click', (e) => {
        const primaryTabBtn = e.target.closest('[data-ledger-primary]');
        if (primaryTabBtn) {
          const nextPrimary = primaryTabBtn.getAttribute('data-ledger-primary') || 'flow';
          const prev = captureSegIndices();
          const prevPrimary = ledgerPrimaryTab;
          const wasSubView = isLedgerAssetSubView();
          ledgerPrimaryTab = nextPrimary;
          if (nextPrimary === 'flow') {
            ledgerTab = 'flow';
          } else {
            // 切到资产总览时始终进入 Hub
            ledgerTab = 'hub';
          }
          syncSheetHeaderTitle();
          renderModuleSheetBody('ledger', prev);
          // 页面切换进场：去资产从右进，回流水从左进；二级页点资产回 Hub 视为后退
          if (prevPrimary !== nextPrimary) {
            playSheetPageEnter(nextPrimary === 'assets' ? 1 : -1, 'snappy', 28);
          } else if (wasSubView) {
            playSheetPageEnter(-1, 'solid, snappy', 48);
          }
          return;
        }

        const hubEnterBtn = e.target.closest('[data-hub-enter]');
        if (hubEnterBtn) {
          const sub = hubEnterBtn.getAttribute('data-hub-enter');
          enterLedgerAssetSubView(sub);
          syncSheetHeaderTitle();
          return;
        }

        const hubBackBtn = e.target.closest('[data-hub-back]');
        if (hubBackBtn) {
          exitLedgerAssetSubView(false);
          syncSheetHeaderTitle();
          return;
        }
      });

      // 软键盘防顶起保护：以真实视口高度为准，解决 Android 收起键盘不触发 focusout 导致底栏不回弹的问题
      const applyFooterKbState = (open) => {
        sheetKeyboardOpen = Boolean(open);
        if (!sheetEl) return;
        const fEl = sheetEl.querySelector('.life-sheet-footer');
        if (fEl) {
          fEl.classList.toggle('is-kb-hidden', sheetKeyboardOpen);
          if (!sheetKeyboardOpen && !fEl.hidden) {
            mountFooterNavPhysics();
          }
        }
      };

      const checkViewportKeyboard = () => {
        const vv = window.visualViewport;
        const curW = vv ? vv.width : window.innerWidth;
        const curH = vv ? vv.height : window.innerHeight;
        if (!baseViewportH || Math.abs(curW - baseViewportW) > 40) {
          baseViewportW = curW;
          baseViewportH = curH;
        } else if (curH > baseViewportH) {
          baseViewportH = curH;
        }
        const shrunk = (baseViewportH - curH) > 110;
        applyFooterKbState(shrunk);
      };

      if (window.visualViewport) {
        baseViewportW = window.visualViewport.width;
        baseViewportH = window.visualViewport.height;
        window.visualViewport.addEventListener('resize', checkViewportKeyboard);
      } else {
        baseViewportW = window.innerWidth;
        baseViewportH = window.innerHeight;
        window.addEventListener('resize', checkViewportKeyboard);
      }

      sheetEl.addEventListener('focusin', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'checkbox' && t.type !== 'hidden') {
          if (!window.visualViewport) {
            applyFooterKbState(true);
          } else {
            setTimeout(checkViewportKeyboard, 80);
          }
        }
      });

      sheetEl.addEventListener('focusout', () => {
        setTimeout(() => {
          if (!window.visualViewport) {
            applyFooterKbState(false);
          } else {
            checkViewportKeyboard();
          }
        }, 80);
      });

      sheetBodyEl.addEventListener('click', async (e) => {
        const pickDateBtn = e.target.closest('[data-life-date-pick]');
        if (pickDateBtn && window.DatePickerModal) {
          const targetId = pickDateBtn.getAttribute('data-life-date-pick');
          const inp = targetId ? document.getElementById(targetId) : null;
          if (!inp) return;
          const allowClear = pickDateBtn.getAttribute('data-allow-clear') === '1';
          const title = pickDateBtn.getAttribute('data-pick-title') || '选择日期';
          const placeholder = pickDateBtn.getAttribute('data-placeholder') || '点击选择日期';
          const picked = await DatePickerModal.pick({
            mode: 'date',
            title,
            tag: 'CALENDAR 日期校准',
            value: inp.value || '',
            allowClear
          });
          if (picked !== null) {
            inp.value = picked;
            const txtEl = pickDateBtn.querySelector('.life-picker-txt');
            if (txtEl) {
              txtEl.textContent = picked || placeholder;
              txtEl.classList.toggle('is-placeholder', !picked);
            }
          }
          return;
        }

        const pickSelectBtn = e.target.closest('[data-life-select-pick]');
        if (pickSelectBtn && window.SelectModal) {
          const kind = pickSelectBtn.getAttribute('data-life-select-pick') || '';
          const targetId = pickSelectBtn.getAttribute('data-target-id') || '';
          const inp = targetId ? document.getElementById(targetId) : null;
          const cfg = buildLifeSelectModalConfig(kind, inp ? inp.value : '');
          if (!cfg) return;
          const picked = await SelectModal.pick(cfg);
          if (picked !== null) {
            if (kind === 'filter-account') {
              ledgerFilterAccId = picked || 'all';
              if (inp) inp.value = ledgerFilterAccId;
              const matchOpt = (cfg.options || []).find((o) => String(o.value) === String(ledgerFilterAccId));
              if (matchOpt) {
                const txtEl = pickSelectBtn.querySelector('.life-picker-txt');
                if (txtEl) txtEl.textContent = matchOpt.displayLabel || matchOpt.label;
                const icoEl = pickSelectBtn.querySelector('.life-picker-ico');
                if (icoEl && matchOpt.iconSvg) icoEl.innerHTML = matchOpt.iconSvg;
              }
              if (!updateLedgerFlowListInPlace()) {
                renderModuleSheetBody('ledger');
              }
              return;
            }
            if (inp) inp.value = picked;
            const matchOpt = (cfg.options || []).find((o) => String(o.value) === String(picked));
            if (matchOpt) {
              const txtEl = pickSelectBtn.querySelector('.life-picker-txt');
              if (txtEl) txtEl.textContent = matchOpt.displayLabel || matchOpt.label;
              const icoEl = pickSelectBtn.querySelector('.life-picker-ico');
              if (icoEl && matchOpt.iconSvg) icoEl.innerHTML = matchOpt.iconSvg;
            }
            if (targetId === 'lifeSubCycle') {
              const nextInp = document.getElementById('lifeSubNextDate');
              const intervalInp = document.getElementById('lifeSubInterval');
              if (nextInp && window.LifeStore) {
                const nextKey = LifeStore.addCycleToDateKey(
                  LifeStore.toDateKey(),
                  picked || 'monthly',
                  Math.max(1, Math.round(Number(intervalInp && intervalInp.value) || 1))
                );
                nextInp.value = nextKey;
                const nextBtn = sheetBodyEl.querySelector('[data-life-date-pick="lifeSubNextDate"] .life-picker-txt');
                if (nextBtn) {
                  nextBtn.textContent = nextKey;
                  nextBtn.classList.remove('is-placeholder');
                }
              }
            }
          }
          return;
        }

        const ledgerTabBtn = e.target.closest('[data-ledger-tab]');
        if (ledgerTabBtn) {
          const nextTab = ledgerTabBtn.getAttribute('data-ledger-tab') || 'flow';
          const isFlowStatsSwitch = (ledgerTab === 'flow' || ledgerTab === 'stats')
            && (nextTab === 'flow' || nextTab === 'stats')
            && sheetBodyEl.querySelector('#lifeLedgerViewTrack')
            && ledgerViewBody;
          if (isFlowStatsSwitch) {
            ledgerTab = nextTab;
            ledgerViewBody.to(nextTab === 'stats' ? 1 : 0);
            const formBtn = sheetBodyEl.querySelector('[data-ledger-toggle-form]');
            if (formBtn) {
              formBtn.classList.toggle('is-active', ledgerTab === 'flow' && ledgerFormOpen);
            }
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
            return;
          }
          const prev = captureSegIndices();
          ledgerTab = nextTab;
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const gotoBudgetBtn = e.target.closest('[data-ledger-goto-budget]');
        if (gotoBudgetBtn) {
          ledgerPrimaryTab = 'assets';
          ledgerTab = 'categories';
          renderModuleSheetBody('ledger');
          return;
        }

        const filterTypeBtn = e.target.closest('[data-ledger-filter-type]');
        if (filterTypeBtn) {
          ledgerFilterType = filterTypeBtn.getAttribute('data-ledger-filter-type') || 'all';
          // 原地切换 active 状态，不调用 renderModuleSheetBody
          sheetBodyEl.querySelectorAll('[data-ledger-filter-type]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-ledger-filter-type') === ledgerFilterType);
          });
          // 再立即刷新流水列表
          updateLedgerFlowListInPlace();
          return;
        }

        const searchClearBtn = e.target.closest('[data-ledger-search-clear]');
        if (searchClearBtn) {
          ledgerSearchQuery = '';
          const sInp = document.getElementById('lifeLedgerSearchInput');
          if (sInp) sInp.value = '';
          // 原地刷新
          updateLedgerFlowListInPlace();
          return;
        }

        const statsDimBtn = e.target.closest('[data-stats-dim]');
        if (statsDimBtn) {
          const prev = captureSegIndices();
          ledgerStatsDim = statsDimBtn.getAttribute('data-stats-dim') || 'month';
          ledgerStatsOffset = 0;
          ledgerStatsFocusDate = '';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const statsStepBtn = e.target.closest('[data-stats-step]');
        if (statsStepBtn) {
          const delta = Number(statsStepBtn.getAttribute('data-stats-step')) || 0;
          ledgerStatsOffset += delta;
          ledgerStatsFocusDate = '';
          renderModuleSheetBody('ledger');
          return;
        }

        const statsResetBtn = e.target.closest('[data-stats-reset]');
        if (statsResetBtn) {
          ledgerStatsOffset = 0;
          ledgerStatsFocusDate = '';
          renderModuleSheetBody('ledger');
          return;
        }

        const statsRankBtn = e.target.closest('[data-stats-rank-type]');
        if (statsRankBtn) {
          const prev = captureSegIndices();
          ledgerStatsRankType = statsRankBtn.getAttribute('data-stats-rank-type') || 'expense';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const statsPickDateEl = e.target.closest('[data-stats-pick-date]');
        if (statsPickDateEl) {
          const dk = statsPickDateEl.getAttribute('data-stats-pick-date') || '';
          ledgerStatsFocusDate = ledgerStatsFocusDate === dk ? '' : dk;
          renderModuleSheetBody('ledger');
          return;
        }

        const statsClearFocusBtn = e.target.closest('[data-stats-clear-focus]');
        if (statsClearFocusBtn) {
          ledgerStatsFocusDate = '';
          renderModuleSheetBody('ledger');
          return;
        }

        const ledgerTypeBtn = e.target.closest('[data-ledger-type]');
        if (ledgerTypeBtn) {
          const prev = captureSegIndices();
          ledgerFormType = ledgerTypeBtn.getAttribute('data-ledger-type') || 'expense';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const catPickBtn = e.target.closest('[data-ledger-cat-pick]');
        if (catPickBtn) {
          ledgerSelectedCat = catPickBtn.getAttribute('data-ledger-cat-pick') || '';
          sheetBodyEl.querySelectorAll('[data-ledger-cat-pick]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-ledger-cat-pick') === ledgerSelectedCat);
          });
          return;
        }

        const toggleFormBtn = e.target.closest('[data-ledger-toggle-form]');
        if (toggleFormBtn) {
          if (ledgerTab !== 'flow') {
            ledgerTab = 'flow';
            ledgerFormOpen = true;
            ledgerEditRecordId = null;
            if (sheetBodyEl.querySelector('#lifeLedgerViewTrack') && ledgerViewBody && ledgerDrawerBody) {
              ledgerViewBody.to(0);
              ledgerDrawerBody.to(1);
            } else {
              if (ledgerDrawerBody) ledgerDrawerBody.jump(0);
              renderModuleSheetBody('ledger');
            }
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            const hadEdit = Boolean(ledgerEditRecordId);
            ledgerFormOpen = !ledgerFormOpen;
            if (!ledgerFormOpen && hadEdit) {
              ledgerEditRecordId = null;
              renderModuleSheetBody('ledger');
            } else if (ledgerDrawerBody) {
              ledgerDrawerBody.to(ledgerFormOpen ? 1 : 0);
            } else {
              renderModuleSheetBody('ledger');
            }
            if (ledgerFormOpen) sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }

        const closeFormBtn = e.target.closest('[data-ledger-close-form], [data-ledger-cancel-edit]');
        if (closeFormBtn) {
          ledgerFormOpen = false;
          ledgerEditRecordId = null;
          renderModuleSheetBody('ledger');
          return;
        }

        const loadMoreBtn = e.target.closest('[data-ledger-load-more]');
        if (loadMoreBtn) {
          ledgerFlowLimit += 50;
          // 原地刷新
          updateLedgerFlowListInPlace();
          return;
        }

        const accFormTypeBtn = e.target.closest('[data-acc-form-type]');
        if (accFormTypeBtn) {
          const prev = captureSegIndices();
          const draftNameEl = document.getElementById('lifeAccName');
          const draftInitEl = document.getElementById('lifeAccInitBal');
          const draftNwEl = document.getElementById('lifeAccNetWorth');
          const draftName = draftNameEl ? draftNameEl.value : null;
          const draftInit = draftInitEl ? draftInitEl.value : null;
          const draftNw = draftNwEl ? draftNwEl.checked : null;

          ledgerAccountFormType = accFormTypeBtn.getAttribute('data-acc-form-type') || 'cash';
          renderModuleSheetBody('ledger', prev);

          if (draftName !== null) {
            const nextNameEl = document.getElementById('lifeAccName');
            if (nextNameEl) nextNameEl.value = draftName;
          }
          if (draftInit !== null) {
            const nextInitEl = document.getElementById('lifeAccInitBal');
            if (nextInitEl) nextInitEl.value = draftInit;
          }
          if (draftNw !== null) {
            const nextNwEl = document.getElementById('lifeAccNetWorth');
            if (nextNwEl) nextNwEl.checked = draftNw;
          }
          return;
        }

        const accEditBtn = e.target.closest('[data-acc-edit]');
        if (accEditBtn) {
          ledgerCalibrateAccId = null;
          ledgerAccountEditId = accEditBtn.getAttribute('data-acc-edit');
          const accObj = (latestSnap && latestSnap.ledger && latestSnap.ledger.accounts || []).find((a) => a.id === ledgerAccountEditId);
          if (accObj) ledgerAccountFormType = accObj.type;
          renderModuleSheetBody('ledger');
          if (sheetBodyEl.scrollTop > 8) {
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }

        const accEditCancelBtn = e.target.closest('[data-acc-edit-cancel]');
        if (accEditCancelBtn) {
          ledgerAccountEditId = null;
          renderModuleSheetBody('ledger');
          return;
        }

        const accCalibrateBtn = e.target.closest('[data-acc-calibrate]');
        if (accCalibrateBtn) {
          ledgerAccountEditId = null;
          ledgerCalibrateAccId = accCalibrateBtn.getAttribute('data-acc-calibrate');
          renderModuleSheetBody('ledger');
          sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const accCalibrateCancelBtn = e.target.closest('[data-acc-calibrate-cancel]');
        if (accCalibrateCancelBtn) {
          ledgerCalibrateAccId = null;
          renderModuleSheetBody('ledger');
          return;
        }

        const accQuickTrfBtn = e.target.closest('[data-acc-quick-transfer]');
        if (accQuickTrfBtn) {
          const targetId = accQuickTrfBtn.getAttribute('data-acc-quick-transfer');
          ledgerTransferPresetToId = targetId || '';
          ledgerTransferPresetAmt = '';
          ledgerEditRecordId = null;
          ledgerPrimaryTab = 'flow';
          ledgerTab = 'flow';
          ledgerFormType = 'transfer';
          ledgerFormOpen = true;
          renderModuleSheetBody('ledger');
          sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const creditRepayBtn = e.target.closest('[data-credit-repay]');
        if (creditRepayBtn) {
          const creditId = creditRepayBtn.getAttribute('data-credit-repay');
          const amtStr = creditRepayBtn.getAttribute('data-repay-amt');
          ledgerTransferPresetToId = creditId || '';
          ledgerTransferPresetAmt = Number(amtStr) > 0 ? amtStr : '';
          ledgerEditRecordId = null;
          ledgerPrimaryTab = 'flow';
          ledgerTab = 'flow';
          ledgerFormType = 'transfer';
          ledgerFormOpen = true;
          renderModuleSheetBody('ledger');
          sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const accDeleteBtn = e.target.closest('[data-acc-delete]');
        if (accDeleteBtn) {
          const accId = accDeleteBtn.getAttribute('data-acc-delete');
          const cfg = LifeStore.getConfig();
          if ((cfg.accounts || []).length <= 1) return;
          const targetAcc = (cfg.accounts || []).find((a) => a.id === accId);
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认删除账户「${targetAcc ? targetAcc.name : '该账户'}」？`,
              detail: '删除后不可恢复，已有历史流水将回退归属至默认账户。',
              confirmText: '确认删除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          const nextAccs = (cfg.accounts || []).filter((a) => a.id !== accId);
          await LifeStore.saveConfig({ accounts: nextAccs });
          if (ledgerAccountEditId === accId) ledgerAccountEditId = null;
          if (ledgerCalibrateAccId === accId) ledgerCalibrateAccId = null;
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          return;
        }

        const instPayBtn = e.target.closest('[data-inst-pay]');
        if (instPayBtn) {
          const insId = instPayBtn.getAttribute('data-inst-pay');
          const assetAcc = (latestSnap && latestSnap.ledger && latestSnap.ledger.accounts || []).find((a) => a.type !== 'credit');
          await LifeStore.payInstallmentPeriod(insId, assetAcc ? assetAcc.id : undefined);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          if (window.RetroToast) RetroToast.show({ tag: 'INSTALLMENT // OK', message: '本期分期本息已入账扣减', type: 'success' });
          return;
        }

        const instRemBtn = e.target.closest('[data-inst-remove]');
        if (instRemBtn) {
          const insId = instRemBtn.getAttribute('data-inst-remove');
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: '确认移除该分期计划？',
              detail: '已入账的历史分期流水将保留，未还期数不再追踪。',
              confirmText: '确认移除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          const cfg = LifeStore.getConfig();
          const nextIns = (cfg.installments || []).filter((i) => i.id !== insId);
          await LifeStore.saveConfig({ installments: nextIns });
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          return;
        }

        const reimSettleBtn = e.target.closest('[data-reimburse-settle]');
        if (reimSettleBtn) {
          e.stopPropagation();
          const recId = reimSettleBtn.getAttribute('data-reimburse-settle');
          const recObj = (latestSnap && latestSnap.ledger && latestSnap.ledger.records || []).find((r) => r.id === recId);
          const curSym = (latestSnap && latestSnap.config && latestSnap.config.currencySymbol) || '¥';
          const amtDesc = recObj ? `（${curSym}${Number(recObj.amount || 0).toFixed(2)}）` : '';
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认核销这笔报销${amtDesc}？`,
              detail: '核销后将标记为「已报销」，自动入账回款并冲抵当月垫付支出。',
              confirmText: '确认核销',
              cancelText: '取消',
              danger: false
            });
            if (!ok) return;
          }
          await LifeStore.settleReimbursement(recId);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          if (window.RetroToast) RetroToast.show({ tag: 'REIMBURSE // OK', message: '报销款已核销入账并冲抵当月支出', type: 'success' });
          return;
        }

        const catManageTabBtn = e.target.closest('[data-cat-manage-tab]');
        if (catManageTabBtn) {
          const prev = captureSegIndices();
          ledgerCatTab = catManageTabBtn.getAttribute('data-cat-manage-tab') || 'expense';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const catIcoPickBtn = e.target.closest('[data-cat-ico-pick]');
        if (catIcoPickBtn) {
          ledgerCatIconPick = catIcoPickBtn.getAttribute('data-cat-ico-pick') || 'food';
          sheetBodyEl.querySelectorAll('[data-cat-ico-pick]').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-cat-ico-pick') === ledgerCatIconPick);
          });
          return;
        }

        const catRemoveBtn = e.target.closest('[data-cat-remove]');
        if (catRemoveBtn) {
          const cid = catRemoveBtn.getAttribute('data-cat-remove');
          const ctype = catRemoveBtn.getAttribute('data-cat-type') || 'expense';
          const cfg = LifeStore.getConfig();
          const catsObj = JSON.parse(JSON.stringify(cfg.ledgerCategories || {}));
          const list = Array.isArray(catsObj[ctype]) ? catsObj[ctype] : [];
          if (list.length <= 1) return;
          const targetCat = list.find((c) => c.id === cid);
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认删除分类「${targetCat ? targetCat.name : '该分类'}」？`,
              detail: '删除后不可恢复，已有历史流水的原分类名不受影响。',
              confirmText: '确认删除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          catsObj[ctype] = list.filter((c) => c.id !== cid);
          await LifeStore.saveConfig({ ledgerCategories: catsObj });
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          return;
        }

        const subVaultTabBtn = e.target.closest('[data-sub-vault-tab]');
        if (subVaultTabBtn) {
          const prev = captureSegIndices();
          subVaultTab = subVaultTabBtn.getAttribute('data-sub-vault-tab') || 'subs';
          subEditId = null;
          cardEditId = null;
          subFormOpen = false;
          cardFormOpen = false;
          cardActionId = null;
          cardActionKind = '';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const subFormToggleBtn = e.target.closest('[data-sub-form-toggle]');
        if (subFormToggleBtn) {
          const prev = captureSegIndices();
          const openFlag = subFormToggleBtn.getAttribute('data-sub-form-toggle') === '1';
          subEditId = null;
          subFormOpen = openFlag;
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const cardFormToggleBtn = e.target.closest('[data-card-form-toggle]');
        if (cardFormToggleBtn) {
          const prev = captureSegIndices();
          const openFlag = cardFormToggleBtn.getAttribute('data-card-form-toggle') === '1';
          cardEditId = null;
          if (openFlag) {
            cardActionId = null;
            cardActionKind = '';
          }
          cardFormOpen = openFlag;
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const subFormModeBtn = e.target.closest('[data-sub-form-mode]');
        if (subFormModeBtn) {
          const prev = captureSegIndices();
          subFormMode = subFormModeBtn.getAttribute('data-sub-form-mode') || 'recurring';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const cardFormTypeBtn = e.target.closest('[data-card-form-type]');
        if (cardFormTypeBtn) {
          const prev = captureSegIndices();
          cardFormType = cardFormTypeBtn.getAttribute('data-card-form-type') || 'count';
          renderModuleSheetBody('ledger', prev);
          return;
        }

        const subRenewBtn = e.target.closest('[data-sub-renew]');
        if (subRenewBtn) {
          const subId = subRenewBtn.getAttribute('data-sub-renew');
          const res = await LifeStore.renewSubscriptionManual(subId, true);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          if (res && window.RetroToast) {
            RetroToast.show({ tag: 'RENEW // OK', message: `「${res.name}」已续期一周期并同步记入流水`, type: 'success' });
          }
          return;
        }

        const cardQuickMinusBtn = e.target.closest('[data-card-quick-minus]');
        if (cardQuickMinusBtn) {
          const cid = cardQuickMinusBtn.getAttribute('data-card-quick-minus');
          const res = await LifeStore.redeemValueCard(cid, 1, '快捷划卡');
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          if (res && window.RetroToast) {
            RetroToast.show({ tag: 'PASS -1 // OK', message: `「${res.name}」已划卡 -1${res.unit}，剩余 ${res.remainValue}${res.unit}`, type: 'success' });
          }
          return;
        }

        const cardOpenRedeemBtn = e.target.closest('[data-card-open-redeem]');
        if (cardOpenRedeemBtn) {
          cardEditId = null;
          cardFormOpen = false;
          cardActionId = cardOpenRedeemBtn.getAttribute('data-card-open-redeem');
          cardActionKind = 'redeem';
          renderModuleSheetBody('ledger');
          sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const cardOpenTopupBtn = e.target.closest('[data-card-open-topup]');
        if (cardOpenTopupBtn) {
          cardEditId = null;
          cardFormOpen = false;
          cardActionId = cardOpenTopupBtn.getAttribute('data-card-open-topup');
          cardActionKind = 'topup';
          renderModuleSheetBody('ledger');
          sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        const cardCancelActBtn = e.target.closest('[data-card-action-cancel]');
        if (cardCancelActBtn) {
          cardActionId = null;
          cardActionKind = '';
          renderModuleSheetBody('ledger');
          return;
        }

        const cardRemoveBtn = e.target.closest('[data-card-remove]');
        if (cardRemoveBtn) {
          const cid = cardRemoveBtn.getAttribute('data-card-remove');
          const cfg = LifeStore.getConfig();
          const targetCard = (cfg.valueCards || []).find((c) => c.id === cid);
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认删除卡券「${targetCard ? targetCard.name : '该卡券'}」？`,
              detail: '删除后该储值卡/次卡及其卡内核销明细将被移除。',
              confirmText: '确认删除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          const nextCards = (cfg.valueCards || []).filter((c) => c.id !== cid);
          await LifeStore.saveConfig({ valueCards: nextCards });
          if (cardActionId === cid) {
            cardActionId = null;
            cardActionKind = '';
          }
          if (cardEditId === cid) {
            cardEditId = null;
            cardFormOpen = false;
          }
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('ledger');
          renderDashboard();
          return;
        }

        const fitTabBtn = e.target.closest('[data-fitness-tab]');
        if (fitTabBtn) {
          const prev = captureSegIndices();
          fitnessTab = fitTabBtn.getAttribute('data-fitness-tab') || 'workout';
          renderModuleSheetBody('fitness', prev);
          return;
        }

        const memoTabBtn = e.target.closest('[data-memo-tab]');
        if (memoTabBtn) {
          const prev = captureSegIndices();
          memoTab = memoTabBtn.getAttribute('data-memo-tab') || 'todo';
          renderModuleSheetBody('memo', prev);
          return;
        }

        const submitBtn = e.target.closest('[data-life-submit]');
        if (submitBtn) {
          const kind = submitBtn.getAttribute('data-life-submit');
          await handleFormSubmit(kind);
          return;
        }

        const delBtn = e.target.closest('[data-life-del]');
        if (delBtn) {
          e.stopPropagation();
          const recId = delBtn.getAttribute('data-life-del');
          if (window.RetroModal) {
            const isLedger = activeModule === 'ledger';
            const ok = await RetroModal.confirm({
              message: isLedger ? '确认删除这条账单流水？' : '确认删除这条记录？',
              detail: isLedger ? '删除后不可恢复，关联资金账户的余额将同步冲回修正。' : '此操作不可撤销，记录将被永久移除。',
              confirmText: '确认删除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          if (ledgerEditRecordId === recId) ledgerEditRecordId = null;
          await LifeStore.deleteRecord(recId);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody(activeModule);
          renderDashboard();
          return;
        }

        const ledgerEditRow = e.target.closest('[data-ledger-edit]');
        if (ledgerEditRow) {
          const recId = ledgerEditRow.getAttribute('data-ledger-edit');
          const rec = (latestSnap && latestSnap.ledger && latestSnap.ledger.records || []).find((r) => r.id === recId);
          if (rec && rec.type !== 'adjust') {
            const prev = captureSegIndices();
            ledgerPrimaryTab = 'flow';
            ledgerTab = 'flow';
            ledgerEditRecordId = rec.id;
            ledgerFormOpen = true;
            ledgerFormType = rec.type || 'expense';
            if (rec.category) ledgerSelectedCat = rec.category;
            renderModuleSheetBody('ledger', prev);
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }

        const medRemoveBtn = e.target.closest('[data-med-remove]');
        if (medRemoveBtn) {
          e.stopPropagation();
          const medId = medRemoveBtn.getAttribute('data-med-remove');
          const cfg = LifeStore.getConfig();
          const targetMed = (cfg.medPlans || []).find((m) => m.id === medId);
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认从药盒移除「${targetMed ? targetMed.name : '该常备项'}」？`,
              detail: '移除后将不再出现在每日服药打卡清单中。',
              confirmText: '确认移除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          const next = (cfg.medPlans || []).filter((m) => m.id !== medId);
          await LifeStore.saveConfig({ medPlans: next });
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('meds');
          renderDashboard();
          return;
        }

        const medToggleCard = e.target.closest('[data-med-toggle]');
        if (medToggleCard) {
          const medId = medToggleCard.getAttribute('data-med-toggle');
          await LifeStore.toggleMedToday(medId);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('meds');
          renderDashboard();
          return;
        }

        const memoToggleCard = e.target.closest('[data-memo-toggle]');
        if (memoToggleCard) {
          const memoId = memoToggleCard.getAttribute('data-memo-toggle');
          await LifeStore.toggleMemoDone(memoId);
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody('memo');
          renderDashboard();
          return;
        }

        const subRemoveBtn = e.target.closest('[data-sub-remove]');
        if (subRemoveBtn) {
          const subId = subRemoveBtn.getAttribute('data-sub-remove');
          const cfg = LifeStore.getConfig();
          const targetSub = (cfg.subscriptions || []).find((s) => s.id === subId);
          if (window.RetroModal) {
            const ok = await RetroModal.confirm({
              message: `确认移除订阅权益「${targetSub ? targetSub.name : '该权益'}」？`,
              detail: '移除后将停止追踪后续自动扣费与到期提醒。',
              confirmText: '确认移除',
              cancelText: '取消',
              danger: true
            });
            if (!ok) return;
          }
          const next = (cfg.subscriptions || []).filter((s) => s.id !== subId);
          await LifeStore.saveConfig({ subscriptions: next });
          if (subEditId === subId) {
            subEditId = null;
            subFormOpen = false;
          }
          latestSnap = await LifeStore.getFullSnapshot();
          renderModuleSheetBody(activeModule);
          renderDashboard();
          return;
        }

        const subEditCard = e.target.closest('[data-sub-edit]');
        if (subEditCard) {
          const subId = subEditCard.getAttribute('data-sub-edit');
          const targetSub = (latestSnap && latestSnap.sub && latestSnap.sub.items || []).find((s) => s.id === subId);
          if (targetSub) {
            const prev = captureSegIndices();
            subEditId = targetSub.id;
            subFormOpen = true;
            subFormMode = targetSub.subMode || 'recurring';
            renderModuleSheetBody('ledger', prev);
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }

        const cardEditCard = e.target.closest('[data-card-edit]');
        if (cardEditCard) {
          const cid = cardEditCard.getAttribute('data-card-edit');
          const targetCard = (latestSnap && latestSnap.sub && latestSnap.sub.cards || []).find((c) => c.id === cid);
          if (targetCard) {
            const prev = captureSegIndices();
            cardActionId = null;
            cardActionKind = '';
            cardEditId = targetCard.id;
            cardFormOpen = true;
            cardFormType = targetCard.cardType === 'balance' ? 'balance' : 'count';
            renderModuleSheetBody('ledger', prev);
            sheetBodyEl.scrollTo({ top: 0, behavior: 'smooth' });
          }
          return;
        }
      });
    }
  }

  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }
    if (!isOpen) return;
    if (activeModule) {
      if (isLedgerAssetSubView()) {
        exitLedgerAssetSubView(true);
        syncSheetHeaderTitle();
        return;
      }
      closeModuleSheet(true);
      return;
    }
    dismissUI();
  });

  document.addEventListener('visibilitychange', () => {
    syncAmbientState();
  });

  if (window.Boot && typeof Boot.onReady === 'function') {
    Boot.onReady(() => {
      ensureDOM();
    });
  }

  return {
    open,
    close,
    openModuleSheet,
    isOpen: () => isOpen
  };
})();

window.LifeServiceUI = LifeServiceUI;