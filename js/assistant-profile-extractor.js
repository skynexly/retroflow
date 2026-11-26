/**
 * ============================================================================
 * 溯流计划 · 核心档案提取器（AssistantProfileExtractor）
 * ============================================================================
 * 增量浓缩：把纳入范围的助手记忆分批喂给模型，整理成一份极简的核心档案。
 * 已吸收的记忆不会再次喂入，进度记在 AssistantProfileStore 的 absorbed 里。
 *
 * 规范见 design/核心档案整理规范.md 第三、四、五节。
 *
 * 纳入范围：
 *   operator 下的 info / habit / like / dislike / relationship
 *   bond
 *   events
 * 排除：operator/daily_piece、operator/recent_status、self、pending、knowledge、forks
 * ============================================================================
 */
const AssistantProfileExtractor = (() => {
  'use strict';

  const LOG_TAG = '核心档案整理';

  /** 纳入范围的分类与分组（null 表示整类纳入） */
  const ELIGIBLE = Object.freeze({
    operator: Object.freeze(['info', 'habit', 'like', 'dislike', 'relationship']),
    bond: null,
    events: null
  });

  const CATEGORY_LABEL = Object.freeze({ operator: '执行员', bond: '羁绊', events: '事件' });

  const GROUP_LABEL = Object.freeze({
    info: '身份信息',
    habit: '习惯',
    like: '喜欢',
    dislike: '讨厌',
    relationship: '人际关系'
  });

  /** 单次整理最多连续跑几批（防止一次点击跑掉几百次请求） */
  const DEFAULT_MAX_BATCHES = 4;

  const API_TIMEOUT = 180000;

  let busy = false;

  /* ======================= 依赖 ======================= */

  /** 浏览器读 window，Node 自测读 globalThis */
  function root() {
    return typeof window !== 'undefined' ? window : globalThis;
  }

  function deps() {
    const win = root();
    if (!win.AssistantProfilePrompt || !win.AssistantProfileParser || !win.AssistantProfileStore) {
      throw new Error('核心档案模块未加载完整');
    }
    if (!win.AssistantMemoryStore) throw new Error('助手记忆模块未加载');
    if (!win.RetroflowAPI) throw new Error('模型接口模块未加载');
    return win;
  }

  function isReplying() {
    const win = root();
    if (win.AssistantChatCore && typeof win.AssistantChatCore.isBusy === 'function' && win.AssistantChatCore.isBusy()) return true;
    if (win.SystemChatUI && typeof win.SystemChatUI.isInferring === 'function' && win.SystemChatUI.isInferring()) return true;
    return false;
  }

  /** 与助手记忆提取同一套回退顺序：assistant 插槽 → 系统助手配置 */
  function resolveModel() {
    const win = root();
    if (win.RetroflowApiUI && typeof win.RetroflowApiUI.resolveSlot === 'function') {
      const cfg = win.RetroflowApiUI.resolveSlot('assistant');
      if (cfg) return cfg;
    }
    if (win.SystemChatPrompt && typeof win.SystemChatPrompt.resolveConfig === 'function') {
      return win.SystemChatPrompt.resolveConfig();
    }
    return null;
  }

  /* ======================= 范围与格式化 ======================= */

  /** 一条记忆是否纳入核心档案 */
  function isEligible(record) {
    if (!record || !record.category) return false;
    const groups = ELIGIBLE[record.category];
    if (groups === undefined) return false;
    if (groups === null) return true;
    return groups.indexOf(record.groupId) !== -1;
  }

  /** 范围内全部记忆（按从旧到新排序） */
  async function listEligible() {
    const { AssistantMemoryStore } = deps();
    await AssistantMemoryStore.load();
    const all = [];
    Object.keys(ELIGIBLE).forEach((category) => {
      AssistantMemoryStore.list(category).forEach((r) => {
        if (isEligible(r)) all.push(r);
      });
    });
    all.sort(AssistantMemoryStore.oldestFirst);
    return all;
  }

  /** 取 record 的日期（YYYY-MM-DD）；time 优先，其次 createdAt */
  function dateOf(record) {
    const raw = String((record && record.time) || '');
    const m = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const m2 = raw.match(/(\d{4})[./](\d{1,2})[./](\d{1,2})/);
    if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`;
    const ts = Number(record && record.createdAt);
    if (Number.isFinite(ts) && ts > 0) {
      const d = new Date(ts);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    return '';
  }

  /** 格式化一条记忆，与提示词里约定的材料格式一致 */
  function formatMemory(record) {
    const cat = record.category;
    const group = record.groupId ? GROUP_LABEL[record.groupId] : '';
    const label = group ? `${CATEGORY_LABEL[cat] || cat}/${group}` : (CATEGORY_LABEL[cat] || cat);
    const date = dateOf(record);
    const head = `[${label}] ${String(record.title || '').trim()}${date ? `（${date}）` : ''}`;
    const body = String(record.body || '').trim();
    return body ? `${head}\n${body}` : head;
  }

  function formatBatch(records) {
    return records.map(formatMemory).join('\n\n');
  }

  /* ======================= 统计 ======================= */

  /**
   * 统计：范围内总数、已吸收、待整理
   * @param {object} [doc] 传入已读取的文档，避免重复读库
   */
  async function computeStats(doc) {
    const store = deps().AssistantProfileStore;
    const document = doc || (await store.load());
    const all = await listEligible();
    const absorbed = document.absorbed || {};
    const absorbedIds = Object.keys(absorbed);
    let absorbedInScope = 0;
    all.forEach((r) => { if (absorbed[r.id]) absorbedInScope += 1; });
    return {
      total: all.length,
      absorbed: absorbedInScope,
      absorbedMarks: absorbedIds.length,
      pending: all.length - absorbedInScope,
      charCount: Array.from(document.content || '').length,
      settings: document.settings,
      updatedAt: document.updatedAt,
      backup: store.backupInfo(document)
    };
  }

  /* ======================= 整理 ======================= */

  function fail(code, message) {
    return { ok: false, code, error: message };
  }

  /**
   * 整理一批（默认 batchSize 条最旧的未吸收记忆）
   * @param {{batchSize?: number, maxChars?: number, maxEvents?: number, dryRun?: boolean}} [opts]
   *   dryRun 为 true 时只组装请求，不调用模型
   * @returns {Promise<object>}
   */
  async function extractBatch(opts) {
    const o = opts || {};
    let win;
    try {
      win = deps();
    } catch (err) {
      return fail('deps', err.message);
    }
    if (busy) return fail('busy', '核心档案正在整理中，请稍候');
    if (!o.dryRun && isReplying()) return fail('replying', '助手正在回复，回复结束后再整理');

    busy = true;
    try {
      const store = win.AssistantProfileStore;
      const prompt = win.AssistantProfilePrompt;
      const parser = win.AssistantProfileParser;

      const { doc } = await store.loadRaw();
      const settings = store.normalizeSettings({
        batchSize: o.batchSize != null ? o.batchSize : doc.settings.batchSize,
        maxChars: o.maxChars != null ? o.maxChars : doc.settings.maxChars,
        maxEvents: o.maxEvents != null ? o.maxEvents : doc.settings.maxEvents
      });

      const all = await listEligible();
      const pending = all.filter((r) => !doc.absorbed[r.id]);
      if (!pending.length) {
        const stats = await computeStats(doc);
        return {
          ok: true,
          empty: true,
          message: '没有待整理的新记忆',
          absorbedNow: 0,
          remaining: 0,
          exceeded: false,
          warnings: [],
          stats,
          settings
        };
      }

      const batch = pending.slice(0, settings.batchSize);
      const messages = prompt.build({
        maxChars: settings.maxChars,
        maxEvents: settings.maxEvents,
        currentProfile: doc.content,
        memories: formatBatch(batch)
      });

      if (o.dryRun) {
        return { ok: true, dryRun: true, messages, batchSize: batch.length, remaining: pending.length - batch.length };
      }

      const config = resolveModel();
      if (!config || !config.baseUrl || !config.modelId) {
        return fail('config', '没有可用的辅助推理模型，请先在 API 页面配置 assistant 插槽');
      }

      let reply;
      try {
        reply = await win.RetroflowAPI.chat(config, messages, { logTag: LOG_TAG, timeout: API_TIMEOUT });
      } catch (err) {
        return fail('api', `模型请求失败：${(err && err.message) || err}`);
      }

      const content = String((reply && reply.content) || '');
      const reasoning = String((reply && reply.reasoning) || '');
      let parsed = parser.parse(content, { maxChars: settings.maxChars });
      // 部分思考模型把正文写进 reasoning
      if (!parsed.ok && reasoning) {
        const fromReasoning = parser.parse(`${reasoning}\n${content}`, { maxChars: settings.maxChars });
        if (fromReasoning.ok) parsed = fromReasoning;
      }
      if (!parsed.ok) return fail('parse', `模型输出无法解析：${parsed.error}`);

      const ids = batch.map((r) => r.id);
      const saved = await store.markAbsorbed(ids, parsed.profile);
      const stats = await computeStats(saved);

      return {
        ok: true,
        profile: parsed.profile,
        sections: parsed.sections,
        charCount: parsed.charCount,
        maxChars: parsed.maxChars,
        exceeded: parsed.exceeded,
        warnings: parsed.warnings || [],
        repaired: Boolean(parsed.repaired),
        absorbedNow: ids.length,
        remaining: stats.pending,
        stats
      };
    } catch (err) {
      return fail('exception', (err && err.message) || String(err));
    } finally {
      busy = false;
    }
  }

  /**
   * 连续跑多批，直到没有待整理记忆或达到 maxBatches
   * @param {{maxBatches?: number, onBatch?: Function}} [opts]
   */
  async function runAll(opts) {
    const o = opts || {};
    const maxBatches = Math.max(1, parseInt(o.maxBatches, 10) || DEFAULT_MAX_BATCHES);
    const results = [];
    let last = null;
    for (let i = 0; i < maxBatches; i += 1) {
      last = await extractBatch();
      results.push(last);
      if (typeof o.onBatch === 'function') {
        try { o.onBatch(last, i + 1); } catch (_) { /* 回调异常不影响主流程 */ }
      }
      if (!last.ok || last.empty || last.remaining === 0) break;
    }
    const stats = last && last.stats ? last.stats : await computeStats();
    const absorbedTotal = results.reduce((n, r) => n + (r.absorbedNow || 0), 0);
    const failed = results.find((r) => !r.ok);
    return {
      ok: !failed,
      error: failed ? failed.error : '',
      batches: results.length,
      absorbed: absorbedTotal,
      remaining: stats.pending,
      last,
      results,
      stats
    };
  }

  /* ======================= 维护 ======================= */

  /** 清掉已不存在记忆的吸收标记（记忆被删或改写 id 后） */
  async function pruneAbsorbed() {
    const store = deps().AssistantProfileStore;
    const all = await listEligible();
    const live = new Set(all.map((r) => r.id));
    const { doc } = await store.loadRaw();
    const stale = Object.keys(doc.absorbed).filter((id) => !live.has(id));
    if (!stale.length) return { removed: 0 };
    stale.forEach((id) => { delete doc.absorbed[id]; });
    await store.save(doc);
    return { removed: stale.length };
  }

  /** 重置进度：默认清空吸收标记但保留档案，便于从头重新浓缩 */
  async function resetProgress(opts) {
    const store = deps().AssistantProfileStore;
    await store.clearAbsorbed(opts || {});
    return await computeStats();
  }

  return {
    LOG_TAG,
    ELIGIBLE,
    DEFAULT_MAX_BATCHES,
    isEligible,
    listEligible,
    formatMemory,
    formatBatch,
    dateOf,
    computeStats,
    extractBatch,
    runAll,
    pruneAbsorbed,
    resetProgress,
    isBusy: () => busy
  };
})();

if (typeof window !== 'undefined') window.AssistantProfileExtractor = AssistantProfileExtractor;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantProfileExtractor;