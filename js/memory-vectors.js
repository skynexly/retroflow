/**
 * ============================================================================
 * 溯流计划 · 记忆向量服务（MemoryVectors）
 * ============================================================================
 * 全部记忆种类共用一张 memoryVectors 表，用 source 区分种类。
 * 本期只登记助手记忆（source = 'assistant'），以后副本记忆、角色记忆只需调用
 * registerSource() 登记，总按钮、补算和召回查询不用改。
 *
 * 向量记录：{ key: `${source}:${recordId}`, source, recordId, modelName, dim,
 *             textHash, vector: Float32Array, createdAt }
 *   - modelName 与当前向量模型不同 → 失效（换了模型）
 *   - textHash 与当前文本不同     → 失效（改了内容）
 *
 * 向量模型使用 API 设置里的「向量模型」插槽，不继承主模型；没配置时整体关闭，
 * 召回只用关键词。向量生成失败不影响记忆写入，之后点总按钮补算即可。
 * ============================================================================
 */
const MemoryVectors = (() => {
  'use strict';

  const SLOT_KEY = 'embedding';
  const BATCH_SIZE = 32;
  /** 补算、自动生成的单批超时：批量请求较慢，给足时间 */
  const BATCH_TIMEOUT = 30000;
  /** 聊天时的查询超时：超时就退回关键词，不拖慢回复 */
  const QUERY_TIMEOUT = 3000;
  /** 查询文本只取末尾这么多字 */
  const QUERY_MAX_CHARS = 2000;
  const DEFAULT_THRESHOLD = 0.5;

  /** source → { loadAll: async () => records, toVectorText: (record) => string } */
  const SOURCES = new Map();

  let filling = false;
  let upsertChain = Promise.resolve();

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function storage() {
    return getWin().Storage || null;
  }

  /* ======================= 登记 ======================= */

  function registerSource(source, handlers) {
    if (!source || typeof source !== 'string') throw new Error('source 必须是非空字符串');
    if (!handlers || typeof handlers.loadAll !== 'function') throw new Error('loadAll 必须是函数');
    if (typeof handlers.toVectorText !== 'function') throw new Error('toVectorText 必须是函数');
    SOURCES.set(source, handlers);
  }

  function listSources() {
    return Array.from(SOURCES.keys());
  }

  /* ======================= 配置 ======================= */

  /** 向量模型插槽配置；未配置返回 null（不回退主模型） */
  function getConfig() {
    const win = getWin();
    let cfg = null;
    if (win.RetroflowApiUI && typeof win.RetroflowApiUI.getSlot === 'function') {
      cfg = win.RetroflowApiUI.getSlot(SLOT_KEY);
    }
    if (!cfg && win.Store && win.Store.config && win.Store.config.apiSlots) {
      cfg = win.Store.config.apiSlots[SLOT_KEY] || null;
    }
    if (!cfg || !cfg.baseUrl || !cfg.modelId) return null;
    return cfg;
  }

  function isConfigured() {
    return Boolean(getConfig());
  }

  function isFilling() {
    return filling;
  }

  /* ======================= 纯函数 ======================= */

  /** 文本指纹：FNV-1a 32 位 + 长度。只用来判断内容有没有变，不做安全用途 */
  function hashText(text) {
    const s = String(text == null ? '' : text);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(16).padStart(8, '0')}-${s.length.toString(36)}`;
  }

  function cosine(a, b) {
    if (!a || !b || a.length !== b.length || !a.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom ? dot / denom : 0;
  }

  function vectorKey(source, recordId) {
    return `${source}:${recordId}`;
  }

  /** 记录是否需要（重新）生成向量 */
  function isStale(existing, modelName, textHash) {
    if (!existing || !existing.vector || !existing.vector.length) return true;
    return existing.modelName !== modelName || existing.textHash !== textHash;
  }

  /**
   * 算出一个种类里要补算的记录和要删除的残留向量。纯计算，不读写库。
   * @returns {{pending: Array<{record, text, textHash}>, orphanKeys: string[], total: number}}
   */
  function planSource(source, records, vectors, modelName, toVectorText) {
    const vecMap = new Map((vectors || []).map((v) => [v.recordId, v]));
    const liveIds = new Set();
    const pending = [];
    (records || []).forEach((r) => {
      if (!r || !r.id) return;
      const text = String(toVectorText(r) || '').trim();
      if (!text) return;
      liveIds.add(r.id);
      const textHash = hashText(text);
      if (isStale(vecMap.get(r.id), modelName, textHash)) pending.push({ record: r, text, textHash });
    });
    const orphanKeys = (vectors || [])
      .filter((v) => v && !liveIds.has(v.recordId))
      .map((v) => v.key || vectorKey(source, v.recordId));
    return { pending, orphanKeys, total: liveIds.size };
  }

  /** 查询文本过长时取末尾 */
  function trimQuery(text) {
    const s = String(text || '').trim();
    return s.length > QUERY_MAX_CHARS ? s.slice(s.length - QUERY_MAX_CHARS) : s;
  }

  /* ======================= 网络 ======================= */

  async function embedTexts(texts, config, opts) {
    const api = getWin().RetroflowAPI;
    if (!api || typeof api.embed !== 'function') throw new Error('向量接口尚未加载');
    const o = opts || {};
    const res = await api.embed(config, texts, {
      timeout: o.timeout || BATCH_TIMEOUT,
      logTag: o.logTag || '记忆向量化',
      signal: o.signal
    });
    if (!res || !Array.isArray(res.vectors) || res.vectors.length !== texts.length) {
      throw new Error('向量接口返回的条数与请求不一致');
    }
    return res;
  }

  /** 把一批待算条目生成向量并写库 */
  async function embedAndStore(source, items, config, opts) {
    if (!items.length) return 0;
    const res = await embedTexts(items.map((x) => x.text), config, opts);
    const now = Date.now();
    const rows = items.map((x, i) => ({
      key: vectorKey(source, x.record.id),
      source,
      recordId: x.record.id,
      modelName: config.modelId,
      dim: res.vectors[i].length,
      textHash: x.textHash,
      vector: res.vectors[i],
      createdAt: now
    }));
    await storage().putVectors(rows);
    return rows.length;
  }

  /* ======================= 自动生成 ======================= */

  /**
   * 记忆写入成功后调用：配置了向量模型就给这些记录生成向量。
   * 后台排队执行，调用方不必等待；失败只打日志，之后可用总按钮补算。
   */
  function scheduleUpsert(source, records) {
    const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id);
    if (!list.length || !SOURCES.has(source)) return Promise.resolve(0);
    const config = getConfig();
    const st = storage();
    if (!config || !st || typeof st.putVectors !== 'function') return Promise.resolve(0);
    const job = upsertChain.then(async () => {
      const handlers = SOURCES.get(source);
      const pending = [];
      for (const r of list) {
        const text = String(handlers.toVectorText(r) || '').trim();
        if (!text) continue;
        const textHash = hashText(text);
        let existing = null;
        try { existing = await st.getVector(vectorKey(source, r.id)); } catch (_) { existing = null; }
        if (isStale(existing, config.modelId, textHash)) pending.push({ record: r, text, textHash });
      }
      let done = 0;
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        done += await embedAndStore(source, pending.slice(i, i + BATCH_SIZE), config, { logTag: '记忆向量化 · 自动' });
      }
      return done;
    }).catch((err) => {
      console.warn('[MemoryVectors] 自动生成向量失败，可稍后在记忆库点向量化补算：', err);
      return 0;
    });
    upsertChain = job;
    return job;
  }

  /* ======================= 查漏补缺（总按钮） ======================= */

  /**
   * 扫描全部已登记的记忆种类，补算没有向量、换了模型、改了内容的记录，
   * 并删除记忆已不存在的残留向量。某一批请求失败即停止，避免连续报错。
   * @param {{onProgress?: (done:number, total:number) => void, signal?: AbortSignal}} [opts]
   */
  async function fillAll(opts) {
    const o = opts || {};
    const config = getConfig();
    if (!config) return { ok: false, reason: 'not_configured', generated: 0, pending: 0, removed: 0, total: 0 };
    const st = storage();
    if (!st || typeof st.getVectorsBySource !== 'function') {
      return { ok: false, reason: 'storage', error: '本机存储不可用', generated: 0, pending: 0, removed: 0, total: 0 };
    }
    if (filling) return { ok: false, reason: 'busy', generated: 0, pending: 0, removed: 0, total: 0 };
    filling = true;
    let generated = 0;
    let removed = 0;
    let pendingCount = 0;
    let total = 0;
    try {
      // 先等自动生成队列跑完，避免两边同时写同一条
      try { await upsertChain; } catch (_) { /* ignore */ }
      const plans = [];
      for (const [source, handlers] of SOURCES) {
        const records = await handlers.loadAll();
        const vectors = await st.getVectorsBySource(source);
        const plan = planSource(source, records, vectors, config.modelId, handlers.toVectorText);
        plans.push({ source, plan });
        pendingCount += plan.pending.length;
        total += plan.total;
      }
      for (const { plan } of plans) {
        if (plan.orphanKeys.length) removed += await st.removeVectors(plan.orphanKeys);
      }
      if (o.onProgress) o.onProgress(0, pendingCount);
      for (const { source, plan } of plans) {
        for (let i = 0; i < plan.pending.length; i += BATCH_SIZE) {
          if (o.signal && o.signal.aborted) {
            return { ok: false, reason: 'aborted', generated, pending: pendingCount, removed, total };
          }
          try {
            generated += await embedAndStore(source, plan.pending.slice(i, i + BATCH_SIZE), config, {
              logTag: '记忆向量化 · 补算',
              signal: o.signal
            });
          } catch (err) {
            return {
              ok: false,
              reason: 'api',
              error: (err && err.message) || String(err),
              generated,
              pending: pendingCount,
              removed,
              total
            };
          }
          if (o.onProgress) o.onProgress(generated, pendingCount);
        }
      }
      return { ok: true, generated, pending: pendingCount, removed, total };
    } catch (err) {
      return { ok: false, reason: 'storage', error: (err && err.message) || String(err), generated, pending: pendingCount, removed, total };
    } finally {
      filling = false;
    }
  }

  /* ======================= 召回查询 ======================= */

  /**
   * 用最近的聊天文本查询相似记忆。未配置、超时或失败时返回空数组，不抛错。
   * @returns {Promise<Array<{recordId: string, score: number}>>}
   */
  async function query(source, text, opts) {
    const o = opts || {};
    const config = getConfig();
    const st = storage();
    const q = trimQuery(text);
    if (!config || !q || !st || typeof st.getVectorsBySource !== 'function') return [];
    try {
      const vectors = (await st.getVectorsBySource(source))
        .filter((v) => v && v.modelName === config.modelId && v.vector && v.vector.length);
      if (!vectors.length) return [];
      const res = await embedTexts([q], config, { timeout: o.timeout || QUERY_TIMEOUT, logTag: '助手记忆召回' });
      const qv = res.vectors[0];
      const threshold = Number.isFinite(o.threshold) ? o.threshold : DEFAULT_THRESHOLD;
      return vectors
        .map((v) => ({ recordId: v.recordId, score: cosine(qv, v.vector) }))
        .filter((x) => x.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, Number.isFinite(o.limit) ? o.limit : 40);
    } catch (err) {
      console.warn('[MemoryVectors] 向量查询失败，本轮只用关键词：', err);
      return [];
    }
  }

  /* ======================= 内置登记：助手记忆 ======================= */

  /** 向量文本：标题、正文、关键词。不含原文依据 evidence */
  function assistantVectorText(r) {
    if (!r) return '';
    const keywords = Array.isArray(r.keywords) ? r.keywords.filter(Boolean).join('、') : '';
    return [r.title, r.body, keywords ? `关键词：${keywords}` : ''].filter(Boolean).join('\n');
  }

  registerSource('assistant', {
    async loadAll() {
      const store = getWin().AssistantMemoryStore;
      if (!store) throw new Error('助手记忆模块未加载');
      await store.load();
      // 副本记忆分类（forks）不参与召回，不生成向量
      return store.all().filter((r) => r && r.category !== 'forks');
    },
    toVectorText(r) {
      return r && r.category === 'forks' ? '' : assistantVectorText(r);
    }
  });

  return {
    SLOT_KEY,
    BATCH_SIZE,
    DEFAULT_THRESHOLD,
    registerSource,
    listSources,
    getConfig,
    isConfigured,
    isFilling,
    hashText,
    cosine,
    planSource,
    trimQuery,
    assistantVectorText,
    scheduleUpsert,
    fillAll,
    query
  };
})();

if (typeof window !== 'undefined') window.MemoryVectors = MemoryVectors;
if (typeof module !== 'undefined' && module.exports) module.exports = MemoryVectors;
