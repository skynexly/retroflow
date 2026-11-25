/**
 * ============================================================================
 * 溯流计划 · 核心档案解析器（AssistantProfileParser）
 * ============================================================================
 * 把模型的整理输出解析成结构化的核心档案文本。
 * 规范见 design/核心档案整理规范.md 第九节。
 *
 * 只负责解析与规范化，不调用 API，也不写库。
 *
 * 结果：
 *   { ok: true,  profile, sections, charCount, maxChars, exceeded, warnings, repaired }
 *   { ok: false, error, profile: '', sections: {}, charCount: 0, maxChars, exceeded: false, warnings: [], repaired: false }
 *
 * 只有标签缺失或六个板块全都没有标题才算整体失败。
 * 缺某个板块、条目缺项目符号、日期格式不规范等只做补救并记 warnings。
 * 超出字数上限不截断（截断会破坏结构），只回 exceeded 交给调用方决定是否重试。
 * ============================================================================
 */
const AssistantProfileParser = (() => {
  'use strict';

  const TAG = 'RETROFLOW_PROFILE';

  /** 六个板块，顺序固定 */
  const SECTIONS = Object.freeze(['身份信息', '喜欢的事物', '讨厌的事物', '习惯', '人际关系', '情感羁绊与事件']);

  /** 空板块的占位文本 */
  const EMPTY_MARK = '（暂无）';

  /** 需要按日期排序的板块 */
  const TIMELINE_SECTION = '情感羁绊与事件';

  const BULLET = '- ';

  const SECTION_RE = /^[【\[]\s*(身份信息|喜欢的事物|讨厌的事物|习惯|人际关系|情感羁绊与事件)\s*[】\]]$/;

  /* ======================= 基础清理 ======================= */

  /**
   * 截取标签内的内容。模型可能先输出思考过程并在其中提到标签，
   * 所以取最后一个完整的标签块；只有开标签时取开标签之后的全部内容。
   */
  function extractTagged(text) {
    const src = String(text == null ? '' : text);
    const re = new RegExp(`<${TAG}>([\\s\\S]*?)</${TAG}>`, 'g');
    let m;
    let last = null;
    while ((m = re.exec(src)) !== null) last = m[1];
    if (last !== null) return last;
    const open = src.lastIndexOf(`<${TAG}>`);
    if (open !== -1) return src.slice(open + TAG.length + 2);
    return null;
  }

  /** 去掉代码块标记、Markdown 强调符号与分隔线，逐行 trim */
  function cleanLines(inner) {
    let s = String(inner == null ? '' : inner).replace(/^\uFEFF/, '');
    // 去掉整体包裹的代码块
    s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
    const lines = s.split(/\r?\n/).map((line) => {
      let l = line.replace(/\u00a0/g, ' ').trim();
      // 去掉 Markdown 标题、引用、分隔线、表格分隔行
      l = l.replace(/^#+\s*/, '');
      l = l.replace(/^>\s*/, '');
      if (/^[-*_=]{3,}$/.test(l)) return '';
      if (/^\|?[\s:-]*\|[\s:|-]*$/.test(l) && l.indexOf('|') !== -1) return '';
      // 去掉加粗与行内代码
      l = l.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
      l = l.replace(/`([^`]*)`/g, '$1');
      return l.trim();
    });
    return lines;
  }

  /** 这一行是否本来就带某种项目符号或编号（用来区分「格式不规范」和「没写符号」） */
  function hasBulletMark(line) {
    const s = String(line || '');
    if (s === '-' || /^-\s/.test(s)) return true;
    if (/^(?:\d+[.、)．]|[(（]\d+[)）])\s*[^\s]/.test(s)) return true;
    return /^[•·・*＊]\s*[^\s]/.test(s);
  }

  /** 把各种项目符号与编号统一掉，返回纯正文（不含前缀，前缀由渲染层统一补） */
  function normalizeBullet(line, warn) {
    if (!line) return '';
    if (line === '-') return '';
    const dashed = line.match(/^-\s*(.+)$/);
    if (dashed) return dashed[1].trim();
    // • ・ · ＊ * 以及 1. 1、 1) 等编号
    const numbered = line.match(/^(?:\d+[.、)．]|[(（]\d+[)）])\s*(.+)$/);
    if (numbered) {
      warn('条目使用了编号，已统一为「- 」');
      return numbered[1].trim();
    }
    const bulleted = line.match(/^[•·・*＊]\s*(.+)$/);
    if (bulleted) {
      warn('条目使用了其他项目符号，已统一为「- 」');
      return bulleted[1].trim();
    }
    return line.trim();
  }

  /* ======================= 日期处理 ======================= */

  const pad2 = (n) => String(n).padStart(2, '0');

  /** 接受 2025-03-14 / 2025/3/14 / 2025.03.14 / 2025年3月14日，统一成 YYYY-MM-DD */
  function normalizeDate(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    const m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/);
    if (!m) return '';
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return '';
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
    const dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return '';
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  /** 从一条时间线条目里取日期；取不到返回空串 */
  function dateOfItem(text) {
    const m = String(text || '').match(/^\s*(\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?)/);
    return m ? normalizeDate(m[1]) : '';
  }

  /** 把条目开头的日期规范成 YYYY-MM-DD 并补一个空格 */
  function fixItemDate(text, warn) {
    const s = String(text || '').trim();
    const head = s.match(/^(\d{4}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?)\s*([\s\S]*)$/);
    if (!head) {
      warn('时间线条目缺少 YYYY-MM-DD 日期');
      return s;
    }
    const d = normalizeDate(head[1]);
    if (!d) {
      warn(`时间线条目日期不合法：${head[1]}`);
      return s;
    }
    if (!head[2].trim()) {
      warn('时间线条目只有日期没有内容');
      return d;
    }
    return `${d} ${head[2].trim()}`;
  }

  /** 时间线排序：有日期的按日期升序在前，没日期的保持原顺序排在末尾 */
  function sortTimeline(items) {
    const dated = [];
    const undated = [];
    items.forEach((item, index) => {
      const d = dateOfItem(item);
      if (d) dated.push({ item, d, index });
      else undated.push({ item, index });
    });
    if (!dated.length) return items.slice();
    dated.sort((a, b) => (a.d < b.d ? -1 : (a.d > b.d ? 1 : a.index - b.index)));
    return dated.map((x) => x.item).concat(undated.map((x) => x.item));
  }

  /* ======================= 解析主体 ======================= */

  /** 把单个板块的原始行解析成条目数组 */
  function parseItems(sectionName, lines, warnings, ctx) {
    const items = [];
    const warn = (message) => warnings.push({ section: sectionName, message });
    const seen = new Set();

    lines.forEach((rawLine) => {
      if (!rawLine) return;

      const hadBullet = hasBulletMark(rawLine);
      let text = normalizeBullet(rawLine, warn);
      if (!text) return;

      // 空板块占位：不论写没写项目符号，都按「空」处理，不进条目
      if (text === EMPTY_MARK || text === '(暂无)' || text === '（无）' || text === '（空）' || text === '暂无') {
        ctx.sawEmptyMark = true;
        return;
      }

      if (!hadBullet) {
        warn(`条目缺少「- 」项目符号，已补为条目：${text.slice(0, 24)}`);
        ctx.repaired = true;
      }

      text = text.replace(/\s+/g, ' ').trim();
      if (!text) return;

      if (sectionName === TIMELINE_SECTION) {
        const fixed = fixItemDate(text, warn);
        if (fixed !== text) ctx.repaired = true;
        text = fixed;
      }

      // 同板块内完全重复的条目只留一条
      const key = text.replace(/\s+/g, '');
      if (seen.has(key)) {
        warn(`条目重复，已去掉后出现的一条：${text.slice(0, 24)}`);
        ctx.repaired = true;
        return;
      }
      seen.add(key);
      items.push(text);
    });

    if (sectionName === TIMELINE_SECTION && items.length > 1) {
      const sorted = sortTimeline(items);
      if (sorted.join('\n') !== items.join('\n')) {
        warn('时间线未按从旧到近排列，已重新排序');
        ctx.repaired = true;
      }
      return sorted;
    }
    return items;
  }

  /** 把板块内容拼回文本 */
  function renderSection(sectionName, items) {
    const body = items && items.length ? items.map((it) => `${BULLET}${it}`).join('\n') : `${BULLET}${EMPTY_MARK}`;
    return `【${sectionName}】\n${body}`;
  }

  /** 按固定顺序拼出完整档案文本 */
  function render(sections) {
    const src = sections && typeof sections === 'object' ? sections : {};
    return SECTIONS.map((name) => renderSection(name, Array.isArray(src[name]) ? src[name] : [])).join('\n');
  }

  /** 一版全部为「（暂无）」的空档案，用于恢复/重置 */
  function emptyProfile() {
    const sections = {};
    SECTIONS.forEach((name) => { sections[name] = []; });
    return render(sections);
  }

  function isEmptyProfile(text) {
    const s = String(text == null ? '' : text);
    if (!s.trim()) return true;
    return s.indexOf(EMPTY_MARK) !== -1 && !s.replace(new RegExp(`【[^】]*】|${BULLET}${EMPTY_MARK}`, 'g'), '').trim();
  }

  function countChars(text) {
    return Array.from(String(text == null ? '' : text)).length;
  }

  /**
   * 解析模型输出。
   * @param {string} text 模型的完整回复
   * @param {{maxChars?: number}} [options] 字数上限；只用于回 exceeded，不截断
   */
  function parse(text, options) {
    const opts = options || {};
    const rawMax = parseInt(opts.maxChars, 10);
    const maxChars = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : 0;

    const fail = (error) => ({
      ok: false,
      error,
      profile: '',
      sections: {},
      charCount: 0,
      maxChars,
      exceeded: false,
      warnings: [],
      repaired: false
    });

    const inner = extractTagged(text);
    if (inner === null) return fail(`输出中没有 <${TAG}> 标签`);
    if (!String(inner).trim()) return fail('标签内没有内容');

    const warnings = [];
    const ctx = { repaired: false, sawEmptyMark: false };
    const lines = cleanLines(inner);

    // 按板块标题切段
    const buckets = {};
    let current = null;
    let orphan = [];
    lines.forEach((line) => {
      if (!line) return;
      const m = line.match(SECTION_RE);
      if (m) {
        current = m[1];
        if (buckets[current]) {
          warnings.push({ section: current, message: '板块标题出现多次，内容已合并' });
          ctx.repaired = true;
        } else {
          buckets[current] = [];
        }
        return;
      }
      if (current) buckets[current].push(line);
      else orphan.push(line);
    });

    // 六个板块一个都没找到：整体失败
    if (!Object.keys(buckets).length) {
      return fail('输出中没有找到任何板块标题（【身份信息】等）');
    }

    if (orphan.length) {
      warnings.push({ section: '', message: `有 ${orphan.length} 行内容不在任何板块内，已忽略` });
      ctx.repaired = true;
    }

    const sections = {};
    SECTIONS.forEach((name) => {
      if (!Object.prototype.hasOwnProperty.call(buckets, name)) {
        warnings.push({ section: name, message: '缺少板块，已补为「（暂无）」' });
        ctx.repaired = true;
        sections[name] = [];
        return;
      }
      sections[name] = parseItems(name, buckets[name], warnings, ctx);
      if (!sections[name].length) sections[name] = [];
    });

    // 未知板块
    Object.keys(buckets).forEach((name) => {
      if (SECTIONS.indexOf(name) === -1) {
        warnings.push({ section: name, message: '不认识的板块，内容已忽略' });
        ctx.repaired = true;
      }
    });

    // 顺序检查（对渲染结果没有影响，只提示）
    const foundOrder = Object.keys(buckets).filter((n) => SECTIONS.indexOf(n) !== -1);
    const expectedOrder = SECTIONS.filter((n) => foundOrder.indexOf(n) !== -1);
    if (foundOrder.join('|') !== expectedOrder.join('|')) {
      warnings.push({ section: '', message: '板块顺序与规定不一致，已按固定顺序重排' });
      ctx.repaired = true;
    }

    const profile = render(sections);
    const charCount = countChars(profile);
    const exceeded = Boolean(maxChars) && charCount > maxChars;
    if (exceeded) {
      warnings.push({ section: '', message: `全文 ${charCount} 字，超出上限 ${maxChars} 字` });
    }

    return {
      ok: true,
      profile,
      sections,
      charCount,
      maxChars,
      exceeded,
      warnings,
      repaired: ctx.repaired
    };
  }

  return {
    TAG,
    SECTIONS,
    EMPTY_MARK,
    TIMELINE_SECTION,
    BULLET,
    parse,
    extractTagged,
    render,
    renderSection,
    emptyProfile,
    isEmptyProfile,
    countChars,
    normalizeDate,
    dateOfItem,
    sortTimeline
  };
})();

if (typeof window !== 'undefined') window.AssistantProfileParser = AssistantProfileParser;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantProfileParser;
