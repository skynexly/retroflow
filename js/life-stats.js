/* ============================================================================
   LifeStats · 运动健康统计（周 / 月 / 年）
   - 聚合部分是纯函数，可以直接在 Node 下跑测试
   - 绘制部分借用 lieflat Basics 的画法：F1 横档柱、F2 发丝折线、F5 刻度行、
     F10 点阵热力、F11 刻度表盘；颜色全部由调用方从主题变量传入
   ============================================================================ */
(function (global) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const D2R = Math.PI / 180;
  const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
  // 确定性伪随机：同一份数据每次画出来都一样
  const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;
  const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * D2R), cy + r * Math.sin(deg * D2R)];
  const round1 = (n) => Math.round(n * 10) / 10;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------------------------------------------------------------------------
     日期工具
     ------------------------------------------------------------------------- */
  function parseDateKeyLocal(dk) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dk || '').trim());
    if (!m) return new Date(NaN);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  function toDateKey(ts) {
    const d = ts === undefined || ts === null ? new Date() : new Date(ts);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function addDays(dk, n) {
    const d = parseDateKeyLocal(dk);
    d.setDate(d.getDate() + n);
    return toDateKey(d.getTime());
  }

  function isInPeriod(record, period) {
    const dk = String((record && record.dateKey) || '');
    return dk >= period.startDateKey && dk <= period.endDateKey;
  }

  function timeOf(record) {
    return Number(record && record.occurredAt) || Number(record && record.createdAt) || 0;
  }

  function toNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  /** 记录的当日分钟数（0–1439），优先用手填的 timeStr */
  function minuteOfDay(record) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String((record && record.timeStr) || ''));
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const ts = timeOf(record);
    if (!ts) return null;
    const d = new Date(ts);
    return d.getHours() * 60 + d.getMinutes();
  }

  /* ---------------------------------------------------------------------------
     周期边界：周从周一开始；offset 0 = 当前周期，负数 = 往前翻
     ------------------------------------------------------------------------- */
  function computePeriod(dimension, offset, todayKey) {
    const today = parseDateKeyLocal(todayKey || toDateKey());
    const step = Number(offset) || 0;

    if (dimension === 'week') {
      const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) + step * 7);
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      const md = (d) => `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
      return {
        dimension: 'week',
        startDateKey: toDateKey(monday.getTime()),
        endDateKey: toDateKey(sunday.getTime()),
        rangeLabel: `${monday.getFullYear()} · ${md(monday)} – ${md(sunday)}`,
        spanDays: 7
      };
    }

    if (dimension === 'year') {
      const year = today.getFullYear() + step;
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      return {
        dimension: 'year',
        startDateKey: `${year}-01-01`,
        endDateKey: `${year}-12-31`,
        rangeLabel: `${year} 年`,
        spanDays: leap ? 366 : 365
      };
    }

    const first = new Date(today.getFullYear(), today.getMonth() + step, 1);
    const year = first.getFullYear();
    const month = first.getMonth() + 1;
    const days = new Date(year, month, 0).getDate();
    return {
      dimension: 'month',
      startDateKey: `${year}-${pad2(month)}-01`,
      endDateKey: `${year}-${pad2(month)}-${pad2(days)}`,
      rangeLabel: `${year} 年 ${month} 月`,
      spanDays: days
    };
  }

  /* ---------------------------------------------------------------------------
     运动
     ------------------------------------------------------------------------- */
  function aggregateFitness(records, plans, period, todayKey) {
    const today = todayKey || toDateKey();
    const all = Array.isArray(records) ? records : [];
    const list = all.filter((r) => isInPeriod(r, period));
    const minutesOf = (r) => Math.max(0, Number(r.duration) || 0);

    const totalMinutes = Math.round(list.reduce((acc, r) => acc + minutesOf(r), 0));
    const checkinCount = list.length;
    const periodDates = new Set(list.map((r) => r.dateKey));
    const daysWithCheckin = periodDates.size;
    const avgMinutes = daysWithCheckin ? Math.round(totalMinutes / daysWithCheckin) : 0;

    // 当前连续：从今天往回数；今天还没打卡就从昨天数起，不算断
    const allDates = new Set(all.map((r) => r.dateKey).filter(Boolean));
    let currentStreak = 0;
    let cursor = allDates.has(today) ? today : addDays(today, -1);
    while (allDates.has(cursor)) {
      currentStreak += 1;
      cursor = addDays(cursor, -1);
    }

    // 本期最长连续：只数到今天为止
    let maxStreak = 0;
    let run = 0;
    for (let i = 0; i < period.spanDays; i++) {
      const dk = addDays(period.startDateKey, i);
      if (dk > today) break;
      if (periodDates.has(dk)) {
        run += 1;
        if (run > maxStreak) maxStreak = run;
      } else {
        run = 0;
      }
    }

    const planList = Array.isArray(plans) ? plans : [];
    const planMap = new Map();
    list.forEach((r) => {
      const pid = r.planId || '';
      planMap.set(pid, (planMap.get(pid) || 0) + minutesOf(r));
    });
    const planDistribution = Array.from(planMap.entries())
      .map(([planId, minutes]) => {
        const plan = planList.find((p) => p.id === planId);
        return { planId, name: plan ? plan.name : '未归类', minutes: Math.round(minutes) };
      })
      .sort((a, b) => b.minutes - a.minutes);
    // 超过 8 个计划时，把排在后面的合并成「其他」
    if (planDistribution.length > 8) {
      const rest = planDistribution.splice(7);
      planDistribution.push({ planId: '__other', name: '其他', minutes: rest.reduce((acc, p) => acc + p.minutes, 0) });
    }

    return { totalMinutes, checkinCount, daysWithCheckin, avgMinutes, currentStreak, maxStreak, planDistribution };
  }

  /** 运动柱图数据：周/月按天，年按月 */
  function buildFitnessSeries(records, period, dimension) {
    const list = (Array.isArray(records) ? records : []).filter((r) => isInPeriod(r, period));
    const bucket = new Map();
    const keyLen = dimension === 'year' ? 7 : 10;
    list.forEach((r) => {
      const k = String(r.dateKey).slice(0, keyLen);
      bucket.set(k, (bucket.get(k) || 0) + Math.max(0, Number(r.duration) || 0));
    });

    const series = [];
    if (dimension === 'year') {
      const year = period.startDateKey.slice(0, 4);
      for (let m = 1; m <= 12; m++) {
        const key = `${year}-${pad2(m)}`;
        series.push({ key, label: String(m), value: Math.round(bucket.get(key) || 0) });
      }
    } else {
      for (let i = 0; i < period.spanDays; i++) {
        const key = addDays(period.startDateKey, i);
        const day = Number(key.slice(8, 10));
        const label = dimension === 'week' ? WEEK_LABELS[i] : ((day === 1 || day % 5 === 0) ? String(day) : '');
        series.push({ key, label, value: Math.round(bucket.get(key) || 0) });
      }
    }
    return series;
  }

  /* ---------------------------------------------------------------------------
     饮食
     ------------------------------------------------------------------------- */
  function aggregateDiet(records, period, categories) {
    const cats = Array.isArray(categories) ? categories : [];
    const list = (Array.isArray(records) ? records : []).filter((r) => isInPeriod(r, period));

    const catCount = {};
    const timeSum = {};
    const timeN = {};
    cats.forEach((c) => {
      catCount[c.key] = 0;
      timeSum[c.key] = 0;
      timeN[c.key] = 0;
    });

    const dayCats = new Map();
    list.forEach((r) => {
      if (!dayCats.has(r.dateKey)) dayCats.set(r.dateKey, new Set());
      dayCats.get(r.dateKey).add(r.category);
      if (catCount[r.category] === undefined) return;
      catCount[r.category] += 1;
      const mod = minuteOfDay(r);
      if (mod !== null) {
        timeSum[r.category] += mod;
        timeN[r.category] += 1;
      }
    });

    // 只看有记录的日子：三餐都记了算齐全，没记早餐算漏早餐
    let fullMealDays = 0;
    let missedBreakfast = 0;
    dayCats.forEach((set) => {
      if (set.has('breakfast') && set.has('lunch') && set.has('dinner')) fullMealDays += 1;
      if (!set.has('breakfast')) missedBreakfast += 1;
    });

    const mealTimes = cats.map((c) => {
      const n = timeN[c.key];
      const avgMin = n ? Math.round(timeSum[c.key] / n) : null;
      return {
        key: c.key,
        label: c.label,
        count: catCount[c.key],
        avg: avgMin === null ? null : `${pad2(Math.floor(avgMin / 60))}:${pad2(avgMin % 60)}`
      };
    });

    // 只合并文字完全相同的内容
    const freq = new Map();
    list.forEach((r) => {
      const content = String(r.content || '').trim();
      if (content) freq.set(content, (freq.get(content) || 0) + 1);
    });
    const topContent = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([content, count]) => ({ content, count }));

    return {
      recordCount: list.length,
      daysWithRecord: dayCats.size,
      catCount,
      fullMealDays,
      missedBreakfast,
      mealTimes,
      topContent
    };
  }

  /** 三餐点阵：行 = 餐次；列 = 周/月视图的每一天，年视图的每个月 */
  function buildDietGrid(records, period, dimension, categories) {
    const cats = Array.isArray(categories) ? categories : [];
    const list = (Array.isArray(records) ? records : []).filter((r) => isInPeriod(r, period));
    const cols = [];

    if (dimension === 'year') {
      const year = period.startDateKey.slice(0, 4);
      for (let m = 1; m <= 12; m++) cols.push({ key: `${year}-${pad2(m)}`, label: String(m) });
    } else {
      for (let i = 0; i < period.spanDays; i++) {
        const dk = addDays(period.startDateKey, i);
        const day = Number(dk.slice(8, 10));
        const label = dimension === 'week' ? WEEK_LABELS[i] : ((day === 1 || day % 5 === 0) ? String(day) : '');
        cols.push({ key: dk, label });
      }
    }

    const keyLen = dimension === 'year' ? 7 : 10;
    const counter = new Map();
    list.forEach((r) => {
      const id = `${r.category}|${String(r.dateKey).slice(0, keyLen)}`;
      counter.set(id, (counter.get(id) || 0) + 1);
    });

    return {
      rowLabels: cats.map((c) => c.label),
      colLabels: cols.map((c) => c.label),
      colKeys: cols.map((c) => c.key),
      values: cats.map((c) => cols.map((col) => counter.get(`${c.key}|${col.key}`) || 0))
    };
  }

  /* ---------------------------------------------------------------------------
     体重
     ------------------------------------------------------------------------- */
  function aggregateWeight(records, period, initialWeight, targetWeight) {
    const list = (Array.isArray(records) ? records : [])
      .filter((r) => isInPeriod(r, period) && toNumberOrNull(r.weight) !== null)
      .slice()
      .sort((a, b) => timeOf(a) - timeOf(b));
    if (!list.length) {
      return { count: 0, start: null, end: null, delta: null, max: null, min: null, avg: null, progress: null };
    }

    const ws = list.map((r) => Number(r.weight));
    const start = ws[0];
    const end = ws[ws.length - 1];
    const init = toNumberOrNull(initialWeight);
    const target = toNumberOrNull(targetWeight);
    let progress = null;
    if (init !== null && target !== null && init !== target) {
      progress = Math.round(Math.min(1, Math.max(0, (end - init) / (target - init))) * 100);
    }

    return {
      count: list.length,
      start,
      end,
      delta: round1(end - start),
      max: Math.max(...ws),
      min: Math.min(...ws),
      avg: round1(ws.reduce((acc, w) => acc + w, 0) / ws.length),
      progress
    };
  }

  /** 体重折线数据：周/月一天一个点（同日多次取最后一次），年视图取每月平均 */
  function buildWeightSeries(records, period, dimension) {
    const list = (Array.isArray(records) ? records : [])
      .filter((r) => isInPeriod(r, period) && toNumberOrNull(r.weight) !== null)
      .slice()
      .sort((a, b) => timeOf(a) - timeOf(b));

    if (dimension === 'year') {
      const months = new Map();
      list.forEach((r) => {
        const k = String(r.dateKey).slice(0, 7);
        if (!months.has(k)) months.set(k, []);
        months.get(k).push(Number(r.weight));
      });
      return Array.from(months.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, ws]) => ({ key, value: round1(ws.reduce((acc, w) => acc + w, 0) / ws.length) }));
    }

    const days = new Map();
    list.forEach((r) => days.set(r.dateKey, Number(r.weight)));
    return Array.from(days.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, value]) => ({ key, value: round1(value) }));
  }

  /* ---------------------------------------------------------------------------
     SVG 绘制
     ------------------------------------------------------------------------- */
  function mk(svg, tag, attrs, cls, delay) {
    const node = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, String(attrs[k])));
    if (cls) node.classList.add(cls);
    if (delay !== undefined) node.style.animationDelay = `${delay}s`;
    svg.appendChild(node);
    return node;
  }

  function resetSvg(svg, width, height) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  /** F1 横档柱：一档 = 固定分钟数；最高柱放得下 28 档，按需要换算单位 */
  function drawRungBars(svg, series, opts) {
    const { INK, MUTED, GRID, ACCENT } = opts;
    const width = 400;
    const height = 240;
    resetSvg(svg, width, height);

    const base = 196;
    const step = 5.6;
    const MAX_RUNGS = 28;
    const n = Math.max(1, series.length);
    const left = 20;
    const colW = (width - left * 2) / n;
    const HW = Math.max(2.5, Math.min(14, colW / 2 - 2));
    const maxV = Math.max(1, ...series.map((s) => s.value));
    const unit = Math.max(1, Math.ceil(maxV / MAX_RUNGS));
    const showNums = n <= 12;
    const peakI = series.findIndex((s) => s.value === maxV && s.value > 0);

    series.forEach((s, i) => {
      const x = left + colW * i + colW / 2;
      const rungs = s.value > 0 ? Math.max(1, Math.round(s.value / unit)) : 0;
      const ink = s.key === opts.todayKey ? ACCENT : INK;

      for (let k = 0; k < rungs; k++) {
        const y = base - k * step;
        const w = HW - 1 + rnd(k + 1, i + 2) * Math.min(2, HW / 3);
        const rung = mk(svg, 'line', { x1: x - w, y1: y, x2: x + w, y2: y, stroke: ink, 'stroke-width': 1, 'data-hstats-rung': s.key }, 'life-hstats-fade', i * 0.05 + k * 0.012);
        rung.style.opacity = String(0.5 + rnd(k + 2, i + 4) * 0.5);
        if (k % 5 === 4 && showNums) {
          mk(svg, 'circle', { cx: x + HW + 3.5, cy: y, r: 0.8, fill: MUTED }, 'life-hstats-fade', i * 0.05 + k * 0.012).style.opacity = '0.6';
        }
      }

      if (s.value > 0 && (showNums || i === peakI)) {
        mk(svg, 'text', { x, y: base - Math.max(0, rungs - 1) * step - 9, 'font-size': showNums ? 10 : 9, 'font-weight': 800, fill: ink, 'text-anchor': 'middle' }, 'life-hstats-fade', 0.4 + i * 0.05)
          .textContent = String(s.value);
      }
      if (s.label) {
        mk(svg, 'text', { x, y: base + 18, 'font-size': 7.5, 'font-weight': s.key === opts.todayKey ? 900 : 700, fill: s.key === opts.todayKey ? ACCENT : MUTED, 'text-anchor': 'middle', 'letter-spacing': '0.06em' }, 'life-hstats-fade', i * 0.05)
          .textContent = s.label;
      }
      // 整列透明热区，点哪天都能选中
      mk(svg, 'rect', { x: x - colW / 2, y: 8, width: colW, height: base + 20, fill: 'transparent', 'data-hstats-focus': s.key }, 'life-hstats-clickable');
    });

    mk(svg, 'line', { x1: left, y1: base + 4, x2: width - left, y2: base + 4, stroke: GRID, 'stroke-width': 0.8 }, 'life-hstats-fade');
    mk(svg, 'text', { x: width / 2, y: height - 6, 'font-size': 7, 'font-weight': 600, fill: MUTED, 'text-anchor': 'middle', 'letter-spacing': '0.08em' }, 'life-hstats-fade', 0.9)
      .textContent = `一档 = ${unit} 分钟${showNums ? ' · 每五档一个点' : ' · 只标最高'}`;
  }

  /** F5 刻度行：一格 = 一个单位；最大值超过 34 格时按比例换算单位 */
  function drawTickRows(svg, rows, opts) {
    const { INK, MUTED, GRID } = opts;
    const width = 400;
    const height = rows.length * 44 + 48;
    resetSvg(svg, width, height);
    const X0 = 104;
    const PX = 6.9;
    const MAX_TICKS = 34;
    const maxV = Math.max(1, ...rows.map((row) => Number(row[1]) || 0));
    const unit = Math.max(1, Math.ceil(maxV / MAX_TICKS));

    rows.forEach(([name, raw], i) => {
      const v = Math.max(0, Number(raw) || 0);
      const y = 40 + i * 44;
      const ticks = v > 0 ? Math.max(1, Math.round(v / unit)) : 0;
      mk(svg, 'text', { x: 94, y: y + 3, 'font-size': 8, 'font-weight': 700, fill: MUTED, 'text-anchor': 'end', 'letter-spacing': '0.06em' }, 'life-hstats-fade', i * 0.08).textContent = name;
      mk(svg, 'line', { x1: X0, y1: y + 9, x2: X0 + MAX_TICKS * PX, y2: y + 9, stroke: GRID, 'stroke-width': 0.6 }, 'life-hstats-fade', i * 0.08);
      for (let k = 0; k < ticks; k++) {
        const x = X0 + k * PX + PX / 2;
        const tick = mk(svg, 'line', { x1: x, y1: y + 9, x2: x, y2: y - rnd(k + 1, i + 2) * 6, stroke: INK, 'stroke-width': 0.9 }, 'life-hstats-fade', i * 0.08 + k * 0.012);
        tick.style.opacity = String(0.55 + rnd(k + 3, i + 5) * 0.45);
        if (k % 5 === 4) {
          mk(svg, 'circle', { cx: x, cy: y + 13, r: 0.8, fill: MUTED }, 'life-hstats-fade', i * 0.08 + k * 0.012).style.opacity = '0.6';
        }
      }
      mk(svg, 'text', { x: X0 + ticks * PX + 10, y: y + 4, 'font-size': 11, 'font-weight': 800, fill: v > 0 ? INK : MUTED }, 'life-hstats-fade', 0.4 + i * 0.08).textContent = String(v);
    });

    const unitLabel = opts.unitLabel ? ` ${opts.unitLabel}` : '';
    mk(svg, 'text', { x: width / 2, y: height - 10, 'font-size': 7, 'font-weight': 600, fill: MUTED, 'text-anchor': 'middle', 'letter-spacing': '0.08em' }, 'life-hstats-fade', 0.9)
      .textContent = `一格 = ${unit}${unitLabel} · 每五格一个点`;
  }

  /** F2 发丝折线：日历地板 + 发丝线 + 逐点圆点；最高、最低点标数；可选参考线 */
  function drawHairlineLine(svg, points, opts) {
    const { INK, MUTED, GRID, PAPER } = opts;
    const width = 400;
    const height = opts.height || 240;
    resetSvg(svg, width, height);
    if (!points.length) return;

    const base = height - 40;
    const top = 34;
    const N = points.length;
    const gap = N > 1 ? (width - 68) / (N - 1) : 0;
    const x = (i) => (N === 1 ? width / 2 : 34 + i * gap);
    const values = points.map((p) => p.value);
    const hasRef = Number.isFinite(opts.refValue);
    const lo = Math.min(...values, hasRef ? opts.refValue : Infinity);
    const hi = Math.max(...values, hasRef ? opts.refValue : -Infinity);
    const span = hi - lo || 1;
    const y = (v) => base - ((v - lo) / span) * (base - top);

    for (let i = 0; i < N; i++) {
      mk(svg, 'line', { x1: x(i), y1: base, x2: x(i), y2: base - 7, stroke: MUTED, 'stroke-width': 0.6 }, 'life-hstats-fade', i * 0.008).style.opacity = '0.4';
    }
    mk(svg, 'line', { x1: 24, y1: base, x2: width - 24, y2: base, stroke: GRID, 'stroke-width': 0.8 }, 'life-hstats-fade');

    if (hasRef) {
      const ry = y(opts.refValue);
      mk(svg, 'line', { x1: 24, y1: ry, x2: width - 24, y2: ry, stroke: MUTED, 'stroke-width': 0.7, 'stroke-dasharray': '2 3' }, 'life-hstats-fade', 0.6);
      mk(svg, 'text', { x: width - 24, y: ry - 5, 'font-size': 7.5, 'font-weight': 700, fill: MUTED, 'text-anchor': 'end', 'letter-spacing': '0.06em' }, 'life-hstats-fade', 0.7)
        .textContent = opts.refLabel || '';
    }

    const path = mk(svg, 'path', {
      d: 'M' + points.map((p, i) => `${x(i)} ${y(p.value)}`).join(' L '),
      fill: 'none',
      stroke: INK,
      'stroke-width': 1,
      pathLength: 1
    }, 'life-hstats-draw');
    path.style.animationDuration = '1.2s';

    const maxI = values.indexOf(Math.max(...values));
    const minI = values.indexOf(Math.min(...values));
    const hitR = N > 1 ? Math.max(6, Math.min(12, gap / 2)) : 12;
    points.forEach((p, i) => {
      mk(svg, 'circle', { cx: x(i), cy: y(p.value), r: 2.1, fill: INK, 'data-hstats-dot': p.key }, 'life-hstats-pop', 0.2 + i * 0.03);
      if (N > 1 && maxI !== minI && (i === maxI || i === minI)) {
        mk(svg, 'text', {
          x: x(i),
          y: y(p.value) - 10,
          'font-size': 9,
          'font-weight': 800,
          fill: INK,
          'text-anchor': 'middle',
          style: `paint-order:stroke;stroke:${PAPER};stroke-width:3px`
        }, 'life-hstats-fade', 1).textContent = p.value.toFixed(1);
      }
      // 透明热区：手指点不中 2px 的小圆点
      mk(svg, 'circle', { cx: x(i), cy: y(p.value), r: hitR, fill: 'transparent', 'data-hstats-focus': p.key }, 'life-hstats-clickable');
    });

    const fmt = opts.formatKey || ((k) => k);
    const ends = N === 1 ? [0] : [0, N - 1];
    ends.forEach((i) => {
      const anchor = N === 1 ? 'middle' : (i === 0 ? 'start' : 'end');
      mk(svg, 'text', { x: x(i), y: base + 18, 'font-size': 7.5, 'font-weight': 600, fill: MUTED, 'text-anchor': anchor, 'letter-spacing': '0.06em' }, 'life-hstats-fade')
        .textContent = fmt(points[i].key);
    });
  }

  /** F10 点阵热力：点面积 = 次数，空格留一粒小点（没记也看得见） */
  function drawDotHeat(svg, grid, opts) {
    const { INK, MUTED } = opts;
    const width = 400;
    const left = 52;
    const right = 16;
    const top = 20;
    const rowH = 30;
    const nRows = grid.rowLabels.length;
    const nCols = Math.max(1, grid.colLabels.length);
    const height = top + nRows * rowH + 28;
    resetSvg(svg, width, height);

    const colW = (width - left - right) / nCols;
    const maxR = Math.max(2, Math.min(colW, rowH) / 2 - 1.5);
    let maxV = 0;
    grid.values.forEach((row) => row.forEach((v) => { if (v > maxV) maxV = v; }));
    const cx = (j) => left + colW * j + colW / 2;
    const cy = (i) => top + rowH * i + rowH / 2;

    grid.rowLabels.forEach((label, i) => {
      mk(svg, 'text', { x: left - 10, y: cy(i) + 3, 'font-size': 8, 'font-weight': 700, fill: MUTED, 'text-anchor': 'end', 'letter-spacing': '0.06em' }, 'life-hstats-fade', i * 0.05)
        .textContent = label;
    });

    grid.values.forEach((row, i) => {
      row.forEach((v, j) => {
        const delay = i * 0.05 + j * 0.012;
        if (!v) {
          mk(svg, 'circle', { cx: cx(j), cy: cy(i), r: 0.9, fill: MUTED }, 'life-hstats-pop', delay).style.opacity = '0.35';
          return;
        }
        const ratio = v / (maxV || 1);
        const dot = mk(svg, 'circle', { cx: cx(j), cy: cy(i), r: 1.6 + Math.sqrt(ratio) * (maxR - 1.6), fill: INK }, 'life-hstats-pop', delay);
        dot.style.opacity = String(ratio > 0.66 ? 1 : ratio > 0.33 ? 0.62 : 0.36);
      });
    });

    grid.colLabels.forEach((label, j) => {
      if (!label) return;
      mk(svg, 'text', { x: cx(j), y: top + nRows * rowH + 14, 'font-size': 7, 'font-weight': 600, fill: MUTED, 'text-anchor': 'middle' }, 'life-hstats-fade', j * 0.02)
        .textContent = label;
    });
  }

  /** F11 刻度表盘：一格 = 目标的 1% */
  function drawTickGauge(svg, value, opts) {
    const { INK, MUTED } = opts;
    const width = 400;
    const height = opts.height || 280;
    resetSvg(svg, width, height);
    const cx = width / 2;
    const cy = height / 2 + 30;
    const R0 = 104;
    const A0 = -195;
    const SW = 210;
    const goal = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));

    for (let k = 0; k < 100; k++) {
      const a = A0 + (k / 100) * SW;
      const inked = k < goal;
      const len = inked ? 13 + rnd(k + 1, 3) * 6 : 5 + rnd(k + 1, 7) * 2.5;
      const [x1, y1] = pol(cx, cy, R0, a);
      const [x2, y2] = pol(cx, cy, R0 + len, a);
      const tick = mk(svg, 'line', { x1, y1, x2, y2, stroke: inked ? INK : MUTED, 'stroke-width': inked ? 1 : 0.6 }, 'life-hstats-fade', k * 0.012);
      if (!inked) tick.style.opacity = '0.45';
    }

    [25, 50, 75, 100].forEach((m) => {
      const a = A0 + (m / 100) * SW;
      const [dx, dy] = pol(cx, cy, R0 - 7, a);
      const [tx, ty] = pol(cx, cy, R0 - 19, a);
      mk(svg, 'circle', { cx: dx, cy: dy, r: 1, fill: MUTED }, 'life-hstats-fade', 0.8);
      mk(svg, 'text', { x: tx, y: ty + 3, 'font-size': 7, 'font-weight': 600, fill: MUTED, 'text-anchor': 'middle' }, 'life-hstats-fade', 0.8).textContent = String(m);
    });

    mk(svg, 'text', { x: cx, y: cy - 8, 'font-size': 32, 'font-weight': 900, fill: INK, 'text-anchor': 'middle' }, 'life-hstats-fade', 1.2).textContent = String(goal);
    mk(svg, 'text', { x: cx, y: cy + 14, 'font-size': 8, 'font-weight': 700, fill: MUTED, 'text-anchor': 'middle', 'letter-spacing': '0.08em' }, 'life-hstats-fade', 1.3).textContent = '% · 从初始体重走向目标';
  }

  /** 点中某天 / 某个点时，折线圆点放大、柱子换主题色 */
  function updateFocus(container, focusKey, accent, ink) {
    if (!container) return;
    container.querySelectorAll('[data-hstats-dot]').forEach((dot) => {
      const on = Boolean(focusKey) && dot.getAttribute('data-hstats-dot') === focusKey;
      dot.setAttribute('r', on ? '4.2' : '2.1');
      dot.classList.toggle('is-focused', on);
    });
    container.querySelectorAll('[data-hstats-rung]').forEach((rung) => {
      const on = Boolean(focusKey) && rung.getAttribute('data-hstats-rung') === focusKey;
      if (!rung.dataset.baseStroke) rung.dataset.baseStroke = rung.getAttribute('stroke') || '';
      rung.setAttribute('stroke', on && accent ? accent : (rung.dataset.baseStroke || ink || ''));
    });
  }

  const api = {
    toDateKey,
    addDays,
    computePeriod,
    aggregateFitness,
    buildFitnessSeries,
    aggregateDiet,
    buildDietGrid,
    aggregateWeight,
    buildWeightSeries,
    drawRungBars,
    drawTickRows,
    drawHairlineLine,
    drawDotHeat,
    drawTickGauge,
    updateFocus
  };

  global.LifeStats = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
