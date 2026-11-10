/**
 * ============================================================================
 * 溯流计划 · 助手记忆触发命中（AssistantMemoryRecall）
 * ============================================================================
 * 每次请求助手回复前，从助手记忆里挑出要喂给模型的条目，产出两段文本：
 *
 *   stable   放进系统提示词：记忆总说明、各分类说明、永久记忆、常驻记忆。
 *            只在记忆库变化时才变，不破坏模型的提示词前缀缓存。
 *   dynamic  深度注入到最新消息之前：本轮关键词命中的记忆和随机补位的记忆。
 *
 * 规则（与执行员确认过）：
 *   - 扫描最近两轮聊天（连续多条 user 合成一问），包括正要回复的这一问。
 *   - 打分：主关键词 10 分，其他关键词每个 3 分，标题 2 分；
 *     同分时「重要」在前，再按越新越靠前。关键词不足 2 个字不参与，英文不分大小写。
 *   - 每个分类先取命中的；这个分类一条都没命中时，才从它自己里面随机补位。
 *   - 永久记忆全部常驻；近期状况、未完事项（只取未完成的）各常驻最新 3 条。
 *   - 同一条记忆只喂一次。总量超出上限时，先去掉随机的，再去掉分数低的；
 *     永久和常驻的不去掉。
 *   - 副本记忆（forks）本期不喂。
 *
 * 配额写死在 QUOTA 里，本期不做设置界面。
 * ============================================================================
 */
const AssistantMemoryRecall = (() => {
  'use strict';

  const SCAN_TURNS = 2;
  const TOKEN_CAP = 2500;
  const MIN_KEYWORD_LEN = 2;
  const SCORE = Object.freeze({ primary: 10, keyword: 3, title: 2 });

  /** resident 常驻条数，hit 命中上限，random 没命中时随机补位条数 */
  const QUOTA = Object.freeze({
    operator: Object.freeze({ resident: 0, hit: 4, random: 2 }),
    recent_status: Object.freeze({ resident: 3, hit: 2, random: 0 }),
    self: Object.freeze({ resident: 0, hit: 2, random: 1 }),
    bond: Object.freeze({ resident: 0, hit: 2, random: 1 }),
    events: Object.freeze({ resident: 0, hit: 3, random: 1 }),
    pending: Object.freeze({ resident: 3, hit: 2, random: 0 }),
    knowledge: Object.freeze({ resident: 0, hit: 3, random: 0 })
  });

  /** 取条的分组。operator 拆成「近期状况」和「其他 6 组」两个分组各算配额 */
  const BUCKETS = Object.freeze([
    { id: 'operator', match: (r) => r.category === 'operator' && r.groupId !== 'recent_status' },
    { id: 'recent_status', match: (r) => r.category === 'operator' && r.groupId === 'recent_status' },
    { id: 'self', match: (r) => r.category === 'self' },
    { id: 'bond', match: (r) => r.category === 'bond' },
    { id: 'events', match: (r) => r.category === 'events' },
    { id: 'pending', match: (r) => r.category === 'pending' && !r.completedDate },
    { id: 'knowledge', match: (r) => r.category === 'knowledge' }
  ]);

  const SECTION_TITLES = Object.freeze({
    pinned: '永久记忆',
    operator: '对你的记忆',
    recent_status: '近期状况',
    self: '自我认知（你自己写下的内心记录）',
    bond: '情感羁绊',
    events: '事件记录',
    pending: '未完事项',
    knowledge: '知识库'
  });

  const CATEGORY_LABELS = Object.freeze({
    operator: '对你的记忆',
    self: '自我认知',
    bond: '情感羁绊',
    events: '事件记录',
    pending: '未完事项',
    knowledge: '知识库'
  });

  const GROUP_LABELS = Object.freeze({
    info: '信息',
    habit: '习惯',
    like: '喜好',
    dislike: '讨厌',
    relationship: '人际关系',
    daily_piece: '日常碎片',
    recent_status: '近期状况',
    understanding: '理解',
    desire: '渴望',
    shadow: '阴影',
    wish: '心愿',
    emotion: '情绪'
  });

  const STABLE_ORDER = Object.freeze(['pinned', 'recent_status', 'pending']);
  const DYNAMIC_ORDER = Object.freeze(['operator', 'recent_status', 'self', 'bond', 'events', 'pending', 'knowledge']);

  /* 修改下面两段说明时，同步更新 design/助手记忆提取规范.md 中的召回说明 */
  const INSTRUCTION_TEMPLATE = `## 记忆

以下是你关于{{ENVOY_NAME}}和你们之间的记忆，由过去的聊天整理而来。在对话里自然地运用，不要逐条复述，也不要说“根据记忆”。记忆和当前聊天内容冲突时，以当前聊天为准。

记忆分为以下几类：
- 永久：最重要的记忆，任何时候都记得。
- 对你的记忆：关于{{ENVOY_NAME}}本人的信息、习惯、喜好、讨厌的事、人际关系和日常。
- 近期状况：{{ENVOY_NAME}}最近的状况。时间越久，越可能已经变了，必要时可以问一句现在怎么样。
- 自我认知：你自己用第一人称写下的内心记录，里面的“我”就是你。它们是你对自己的理解、渴望、阴影、心愿和情绪，是你内心的一部分，不是{{ENVOY_NAME}}说过的话。让它们影响你说话的语气和态度，不要把它们当作资料引用或复述出来。
- 情感羁绊：你和{{ENVOY_NAME}}之间关系里重要的时刻和变化。
- 事件记录：过去发生过的事。提起时注意时间，不要把旧事说成刚发生的。
- 未完事项：{{ENVOY_NAME}}提过、还没做完的事。时机合适时可以提醒或问起，不要每次都提。
- 知识库：你和{{ENVOY_NAME}}之前聊起过的资料和知识。回答相关问题时以这里为准。

每轮对话还会在最新消息附近附上与当前话题相关的记忆。`;

  const DYNAMIC_HEAD = `## 与当前话题相关的记忆

以下记忆与最近的聊天有关，也有一些是随机想起的。用法见系统提示中「记忆」一节的说明。`;

  const EMPTY = Object.freeze({ stable: '', dynamic: '', picks: [], meta: { total: 0, tokens: 0, trimmed: 0 } });

  /* ======================= 纯函数（可在 Node 中测试） ======================= */

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function estimateTokens(text) {
    const cb = getWin().ContextBudget;
    if (cb && typeof cb.estimateTokens === 'function') return cb.estimateTokens(text);
    const value = String(text == null ? '' : text);
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    return cjk + Math.ceil((value.length - cjk) / 4) + 4;
  }

  /** 消息内容可能是字符串，也可能是多模态数组，只取文字部分 */
  function textOf(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((p) => (p && p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }

  /** 助手原文去掉思维链和动作标记。只删除，不解析，不弹提示 */
  function cleanAssistantText(raw) {
    let s = String(raw || '');
    const win = getWin();
    const core = win.AssistantChatCore;
    if (core && typeof core.stripThinkingFromContext === 'function') {
      s = core.stripThinkingFromContext(s);
    } else {
      s = s.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?\s*>/gi, '');
    }
    const md = win.RetroflowMarkdown;
    if (md && typeof md.stripActionMarkers === 'function') {
      s = md.stripActionMarkers(s);
    } else {
      s = s.replace(/<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>/gi, '').replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '');
    }
    return s;
  }

  /**
   * 取最近 turns 轮的聊天文本。一轮是连续的 user 加上随后连续的 assistant；
   * 末尾还没回复的 user 也算一轮。system 消息（通知、副本摘要等）不参与扫描。
   */
  function recentTurnsText(history, turns) {
    const limit = Number.isFinite(turns) && turns > 0 ? turns : SCAN_TURNS;
    const msgs = (Array.isArray(history) ? history : [])
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'));
    const picked = [];
    let count = 0;
    let seenUser = false;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const m = msgs[i];
      if (m.role === 'assistant' && seenUser) {
        count += 1;
        seenUser = false;
        if (count >= limit) break;
      }
      if (m.role === 'user') seenUser = true;
      picked.unshift(m);
    }
    return picked
      .map((m) => (m.role === 'assistant' ? cleanAssistantText(textOf(m.content)) : textOf(m.content)))
      .filter((s) => s && s.trim())
      .join('\n');
  }

  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase();
  }

  function usable(s) {
    return Array.from(s).length >= MIN_KEYWORD_LEN;
  }

  /** 一条记忆在扫描文本里的得分，0 表示没命中。scan 须已转小写 */
  function scoreRecord(record, scan) {
    if (!record || !scan) return 0;
    let score = 0;
    const primary = norm(record.primaryKeyword);
    if (usable(primary) && scan.indexOf(primary) !== -1) score += SCORE.primary;
    const seen = new Set([primary]);
    (Array.isArray(record.keywords) ? record.keywords : []).forEach((k) => {
      const n = norm(k);
      if (!usable(n) || seen.has(n)) return;
      seen.add(n);
      if (scan.indexOf(n) !== -1) score += SCORE.keyword;
    });
    const title = norm(record.title);
    if (usable(title) && scan.indexOf(title) !== -1) score += SCORE.title;
    return score;
  }

  function timeOf(r) {
    const t = Date.parse(r && r.time);
    return Number.isFinite(t) ? t : ((r && r.createdAt) || 0);
  }

  function newestFirst(a, b) {
    return (timeOf(b) - timeOf(a)) || (((b && b.createdAt) || 0) - ((a && a.createdAt) || 0))
      || String((b && b.id) || '').localeCompare(String((a && a.id) || ''));
  }

  function rankWeight(r) {
    return r && r.rank === 'important' ? 1 : 0;
  }

  function compareHits(a, b) {
    return (b.score - a.score) || (rankWeight(b.record) - rankWeight(a.record)) || newestFirst(a.record, b.record);
  }

  function shuffled(list, random) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /**
   * 按配额选条。
   * @returns {Array<{record: object, kind: 'pinned'|'resident'|'hit'|'random', bucket: string, score: number}>}
   */
  function select(records, scanText, opts) {
    const random = opts && typeof opts.random === 'function' ? opts.random : Math.random;
    const scan = norm(scanText);
    const pool = (Array.isArray(records) ? records : [])
      .filter((r) => r && r.id && r.category && r.category !== 'forks');
    const used = new Set();
    const picks = [];

    pool.filter((r) => r.rank === 'pinned').sort(newestFirst).forEach((r) => {
      used.add(r.id);
      picks.push({ record: r, kind: 'pinned', bucket: 'pinned', score: Infinity });
    });

    BUCKETS.forEach((bucket) => {
      const q = QUOTA[bucket.id];
      const list = pool.filter((r) => !used.has(r.id) && bucket.match(r));
      if (q.resident) {
        list.slice().sort(newestFirst).slice(0, q.resident).forEach((r) => {
          used.add(r.id);
          picks.push({ record: r, kind: 'resident', bucket: bucket.id, score: Infinity });
        });
      }
      const rest = list.filter((r) => !used.has(r.id));
      const hits = rest
        .map((r) => ({ record: r, score: scoreRecord(r, scan) }))
        .filter((x) => x.score > 0)
        .sort(compareHits)
        .slice(0, q.hit);
      hits.forEach((x) => {
        used.add(x.record.id);
        picks.push({ record: x.record, kind: 'hit', bucket: bucket.id, score: x.score });
      });
      if (!hits.length && q.random > 0) {
        shuffled(rest, random).slice(0, q.random).forEach((r) => {
          used.add(r.id);
          picks.push({ record: r, kind: 'random', bucket: bucket.id, score: 0 });
        });
      }
    });
    return picks;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatDate(raw) {
    const t = Date.parse(raw);
    if (!Number.isFinite(t)) return '';
    const d = new Date(t);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function oneLine(s) {
    return String(s || '').replace(/\s*\n+\s*/g, ' ').trim();
  }

  /** 单条记忆排成一行。永久记忆标出分类，其他分类按 Tab 标出分组 */
  function formatEntry(pick) {
    const r = pick.record;
    const parts = [];
    const hasGroups = r.category === 'operator' || r.category === 'self';
    const group = hasGroups && r.groupId ? GROUP_LABELS[r.groupId] : '';
    if (pick.bucket === 'pinned') {
      const label = [CATEGORY_LABELS[r.category] || '', group].filter(Boolean).join('·');
      if (label) parts.push(`[${label}]`);
    } else if (group && pick.bucket !== 'recent_status') {
      parts.push(`[${group}]`);
    }
    const date = formatDate(r.time);
    const head = `${oneLine(r.title)}${date ? `（${date}）` : ''}`;
    parts.push(head);
    return `- ${parts.join(' ')}：${oneLine(r.body)}`;
  }

  function renderSections(picks, order) {
    const blocks = [];
    order.forEach((bucket) => {
      const lines = picks.filter((p) => p.bucket === bucket).map(formatEntry);
      if (!lines.length) return;
      blocks.push(`### ${SECTION_TITLES[bucket]}\n${lines.join('\n')}`);
    });
    return blocks.join('\n\n');
  }

  function fillNames(template, names) {
    const envoy = (names && names.ENVOY_NAME) || '执行员';
    return template.replace(/\{\{ENVOY_NAME\}\}/g, () => envoy);
  }

  function render(picks, names) {
    const stablePicks = picks.filter((p) => p.kind === 'pinned' || p.kind === 'resident');
    const dynamicPicks = picks.filter((p) => p.kind === 'hit' || p.kind === 'random');
    const stableBody = renderSections(stablePicks, STABLE_ORDER);
    const stable = [fillNames(INSTRUCTION_TEMPLATE, names), stableBody].filter(Boolean).join('\n\n');
    const dynamicBody = renderSections(dynamicPicks, DYNAMIC_ORDER);
    const dynamic = dynamicBody ? `${DYNAMIC_HEAD}\n\n${dynamicBody}` : '';
    return { stable, dynamic };
  }

  /** 超出上限时要去掉的那一条：先随机（后选的先去），再按命中分从低到高 */
  function pickVictim(picks) {
    for (let i = picks.length - 1; i >= 0; i -= 1) {
      if (picks[i].kind === 'random') return i;
    }
    let victim = -1;
    picks.forEach((p, i) => {
      if (p.kind !== 'hit') return;
      if (victim === -1 || compareHits(p, picks[victim]) > 0) victim = i;
    });
    return victim;
  }

  /**
   * 选条、排版、控制总量。records 为空时两段都为空串。
   * @param {Array<object>} records 全部助手记忆
   * @param {Array} history 本次请求的聊天消息数组
   * @param {{names?: object, random?: Function, tokenCap?: number, turns?: number}} [opts]
   */
  function build(records, history, opts) {
    const o = opts || {};
    const all = (Array.isArray(records) ? records : []).filter((r) => r && r.category !== 'forks');
    if (!all.length) return EMPTY;
    const cap = Number.isFinite(o.tokenCap) && o.tokenCap > 0 ? o.tokenCap : TOKEN_CAP;
    const scanText = recentTurnsText(history, o.turns);
    const picks = select(all, scanText, o);

    let out = render(picks, o.names);
    let tokens = estimateTokens(out.stable) + (out.dynamic ? estimateTokens(out.dynamic) : 0);
    let trimmed = 0;
    while (tokens > cap) {
      const idx = pickVictim(picks);
      if (idx === -1) break;
      picks.splice(idx, 1);
      trimmed += 1;
      out = render(picks, o.names);
      tokens = estimateTokens(out.stable) + (out.dynamic ? estimateTokens(out.dynamic) : 0);
    }
    return {
      stable: out.stable,
      dynamic: out.dynamic,
      picks,
      meta: { total: all.length, tokens, trimmed }
    };
  }

  /* ======================= 运行时入口 ======================= */

  function resolveNames() {
    const prompt = getWin().SystemChatPrompt;
    if (prompt && typeof prompt.getVar === 'function') {
      return { ENVOY_NAME: prompt.getVar('ENVOY_NAME') || '执行员', ASST_NAME: prompt.getVar('ASST_NAME') || '系统助手' };
    }
    return { ENVOY_NAME: '执行员', ASST_NAME: '系统助手' };
  }

  /**
   * 请求助手回复前调用。读取失败时返回空结果，不阻断回复。
   * @param {Array} history 本次请求的聊天消息数组
   */
  async function prepare(history) {
    const store = getWin().AssistantMemoryStore;
    if (!store || typeof store.load !== 'function' || typeof store.all !== 'function') return EMPTY;
    try {
      await store.load();
    } catch (err) {
      console.warn('[AssistantMemoryRecall] 助手记忆读取失败，本轮不注入记忆：', err);
      return EMPTY;
    }
    return build(store.all(), history, { names: resolveNames() });
  }

  return {
    SCAN_TURNS,
    TOKEN_CAP,
    SCORE,
    QUOTA,
    recentTurnsText,
    scoreRecord,
    select,
    render,
    build,
    prepare
  };
})();

if (typeof window !== 'undefined') window.AssistantMemoryRecall = AssistantMemoryRecall;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantMemoryRecall;
