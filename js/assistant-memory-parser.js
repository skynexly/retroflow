/**
 * ============================================================================
 * 溯流计划 · 助手记忆解析器（AssistantMemoryParser）
 * ============================================================================
 * 把模型的提取输出解析成可写入 AssistantMemoryStore 的记忆数组。
 * 规范见 design/助手记忆提取规范.md 第 10 节。
 *
 * 只负责解析和逐条校验，不调用 API，也不写库。
 *
 * 结果：
 *   { ok: true,  memories: [...], dropped: [{index, reason, item}], warnings: [{index, message}] }
 *   { ok: false, error: '...', memories: [], dropped: [], warnings: [] }
 * 标签缺失或整体 JSON 无法解析才算整体失败；空数组是成功，条数为 0。
 * 单条不合格只丢弃该条并记录原因；正文超出字数只记提示，不丢弃。
 * ============================================================================
 */
const AssistantMemoryParser = (() => {
  'use strict';

  const TAG = 'RETROFLOW_MEMORY';

  /** 本期允许提取的分类；forks 不提取 */
  const CATEGORIES = Object.freeze(['operator', 'self', 'bond', 'events', 'pending', 'knowledge']);

  const GROUPS = Object.freeze({
    operator: Object.freeze(['info', 'habit', 'like', 'dislike', 'relationship', 'daily_piece', 'recent_status']),
    self: Object.freeze(['understanding', 'desire', 'shadow', 'wish', 'emotion'])
  });

  /** 正文字数范围（规范第 4–9 节），只用于提示 */
  const BODY_LENGTH = Object.freeze({
    operator: [20, 80],
    self: [50, 150],
    bond: [30, 120],
    events: [30, 100],
    pending: [20, 80],
    knowledge: [30, 120]
  });

  const KEYWORD_MIN = 3;
  const KEYWORD_MAX = 6;

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

  /** 去掉字符串字面量之外的尾随逗号，避免误改正文里的「,]」 */
  function stripTrailingCommas(s) {
    let out = '';
    let inStr = false;
    let esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        out += ch;
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        out += ch;
        continue;
      }
      if (ch === ',') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] === '}' || s[j] === ']') continue;
      }
      out += ch;
    }
    return out;
  }

  /** 补救：去代码块标记、去 BOM、截取最外层花括号、去尾随逗号。不替换中文引号。 */
  function repair(raw) {
    let s = String(raw).replace(/^\uFEFF/, '').trim();
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '').trim();
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
    return stripTrailingCommas(s);
  }

  function parseJson(raw) {
    try {
      return { value: JSON.parse(String(raw).trim()), repaired: false };
    } catch (_) { /* 走补救 */ }
    try {
      return { value: JSON.parse(repair(raw)), repaired: true };
    } catch (err) {
      return { error: (err && err.message) || 'JSON 解析失败' };
    }
  }

  function str(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /** 校验一条记忆。返回 { memory } 或 { reason }；warnings 由调用方收集。 */
  function validateItem(item, warn) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { reason: '不是对象' };

    const category = str(item.category);
    if (CATEGORIES.indexOf(category) === -1) return { reason: `分类不在本期范围内：${category || '（空）'}` };

    const memory = { category };
    const groups = GROUPS[category];
    if (groups) {
      const groupId = str(item.groupId);
      if (groups.indexOf(groupId) === -1) return { reason: `${category} 的 groupId 不合法：${groupId || '（空）'}` };
      memory.groupId = groupId;
    }

    const title = str(item.title);
    if (!title) return { reason: '缺少标题' };
    const body = str(item.body);
    if (!body) return { reason: '缺少正文' };
    memory.title = title;
    memory.body = body;

    if (!Array.isArray(item.keywords)) return { reason: 'keywords 不是数组' };
    const seen = new Set();
    const keywords = [];
    item.keywords.forEach((k) => {
      const s = str(k);
      if (!s || seen.has(s)) return;
      seen.add(s);
      keywords.push(s);
    });
    const primaryKeyword = str(item.primaryKeyword);
    if (!primaryKeyword) return { reason: '缺少主关键词' };
    if (keywords.indexOf(primaryKeyword) === -1) return { reason: '主关键词不在关键词列表中' };
    if (keywords.length < KEYWORD_MIN || keywords.length > KEYWORD_MAX) {
      return { reason: `关键词数量为 ${keywords.length}，应为 ${KEYWORD_MIN} 到 ${KEYWORD_MAX} 个` };
    }
    memory.keywords = keywords;
    memory.primaryKeyword = primaryKeyword;

    const time = str(item.time);
    if (!time || !Number.isFinite(Date.parse(time))) return { reason: `时间不合法：${time || '（空）'}` };
    memory.time = time;

    const rank = str(item.rank);
    if (rank !== 'normal' && rank !== 'important') {
      if (rank) warn(`rank「${rank}」不在允许范围内，已按 normal 处理`);
      memory.rank = 'normal';
    } else {
      memory.rank = rank;
    }

    if (!Array.isArray(item.evidence)) return { reason: 'evidence 不是数组' };
    const evidence = item.evidence.filter((e) => typeof e === 'string' && e.trim()).map((e) => e.trim());
    if (!evidence.length) return { reason: '缺少原文依据 evidence' };
    if (evidence.length !== item.evidence.length) warn('evidence 中有空项或非字符串项，已忽略');
    memory.evidence = evidence;

    // 以下只提示，不丢弃
    const range = BODY_LENGTH[category];
    const len = Array.from(body).length;
    if (range && (len < range[0] || len > range[1])) {
      warn(`正文 ${len} 字，规范为 ${range[0]} 到 ${range[1]} 字`);
    }
    if (body.indexOf(primaryKeyword) === -1) warn('正文中没有出现主关键词');

    return { memory };
  }

  /**
   * 解析模型输出。
   * @param {string} text 模型的完整回复
   */
  function parse(text) {
    const fail = (error) => ({ ok: false, error, memories: [], dropped: [], warnings: [] });

    const inner = extractTagged(text);
    if (inner === null) return fail(`输出中没有 <${TAG}> 标签`);
    if (!inner.trim()) return fail('标签内没有内容');

    const parsed = parseJson(inner);
    if (parsed.error) return fail(`JSON 解析失败：${parsed.error}`);

    const root = parsed.value;
    let list;
    if (root && typeof root === 'object' && !Array.isArray(root) && Array.isArray(root.memories)) list = root.memories;
    else if (Array.isArray(root)) list = root;
    else return fail('JSON 中没有 memories 数组');

    const memories = [];
    const dropped = [];
    const warnings = [];
    if (parsed.repaired) warnings.push({ index: -1, message: '原始 JSON 不合法，已经过补救后解析' });
    if (Array.isArray(root)) warnings.push({ index: -1, message: '外层缺少 memories 字段，已按数组解析' });

    list.forEach((item, index) => {
      const warn = (message) => warnings.push({ index, message });
      const res = validateItem(item, warn);
      if (res.memory) memories.push(res.memory);
      else dropped.push({ index, reason: res.reason, item });
    });

    return { ok: true, memories, dropped, warnings };
  }

  return {
    TAG,
    CATEGORIES,
    GROUPS,
    BODY_LENGTH,
    parse,
    extractTagged,
    repair,
    validateItem
  };
})();

if (typeof window !== 'undefined') window.AssistantMemoryParser = AssistantMemoryParser;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantMemoryParser;