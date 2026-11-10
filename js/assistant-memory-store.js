/**
 * ============================================================================
 * 溯流计划 · 助手记忆业务存储（AssistantMemoryStore）
 * ============================================================================
 * 底层：Storage 的 assistantMemories object store（IndexedDB v4）。
 * 所有助手共用一份助手记忆，不按助手分区。规范见 design/助手记忆提取规范.md。
 *
 * 职责：
 *   - 字段规范化与稳定 ID
 *   - 内存缓存（按分类，新记录在前）；只有数据库写入成功后才更新缓存
 *   - 永久记忆全局 20 条额度兜底
 *   - 「对你的记忆 · 近期状况」50 条上限的淘汰计算
 *
 * 不负责：AI 调用、提取触发、提示词拼装、解析（解析见 assistant-memory-parser.js）。
 * ============================================================================
 */
const AssistantMemoryStore = (() => {
  'use strict';

  /* 分类与 Tab 的 ID 枚举。UI 的名称、图标仍由 memory-bank-app.js 维护，ID 必须与之一致。 */
  const SCHEMA = Object.freeze({
    categories: Object.freeze(['operator', 'self', 'bond', 'events', 'forks', 'pending', 'knowledge']),
    /** 允许 AI 提取写入的分类；forks 本期只能手动新增 */
    extractable: Object.freeze(['operator', 'self', 'bond', 'events', 'pending', 'knowledge']),
    groups: Object.freeze({
      operator: Object.freeze(['info', 'habit', 'like', 'dislike', 'relationship', 'daily_piece', 'recent_status']),
      self: Object.freeze(['understanding', 'desire', 'shadow', 'wish', 'emotion'])
    }),
    ranks: Object.freeze(['normal', 'important', 'pinned']),
    sources: Object.freeze(['auto', 'manual'])
  });

  const PINNED_LIMIT = 20;
  /** 有容量上限的 Tab：分类 → Tab → 条数 */
  const GROUP_LIMITS = Object.freeze({ operator: Object.freeze({ recent_status: 50 }) });

  /** category → 记录数组（新在前）。数组对外只读，写入一律走 commit。 */
  const cache = new Map();
  let loaded = false;
  let loadPromise = null;
  let lastLoadError = null;
  let idSeq = 0;

  function hasStorage() {
    return Boolean(window.Storage && typeof window.Storage.getAllAssistantMemories === 'function'
      && typeof window.Storage.commitAssistantMemories === 'function');
  }

  function groupsOf(category) {
    return SCHEMA.groups[category] || null;
  }

  function isValidCategory(category) {
    return SCHEMA.categories.indexOf(category) !== -1;
  }

  function newId() {
    idSeq += 1;
    const rand = Math.random().toString(36).slice(2, 8);
    return `am_${Date.now().toString(36)}_${idSeq.toString(36)}${rand}`;
  }

  function cleanString(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function cleanStringList(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    list.forEach((item) => {
      const s = cleanString(item);
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
    return out;
  }

  function validTimeString(raw) {
    const s = cleanString(raw);
    return s && Number.isFinite(Date.parse(s)) ? s : '';
  }

  function validDateOnly(raw) {
    const s = cleanString(raw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
    const d = new Date(`${s}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` === s ? s : '';
  }

  /**
   * 规范化一条记录。缺 id 时生成新 id；非法分类、空标题或空正文抛错。
   * 未知 groupId 回退到该分类首个 Tab（与页面口径一致）。
   */
  function normalize(raw, opts) {
    const now = Date.now();
    const src = raw && typeof raw === 'object' ? raw : {};
    const category = cleanString(src.category);
    if (!isValidCategory(category)) throw new Error(`未知的助手记忆分类：${category || '（空）'}`);
    const title = cleanString(src.title);
    const body = cleanString(src.body);
    if (!title) throw new Error('助手记忆缺少标题');
    if (!body) throw new Error('助手记忆缺少正文');

    const keywords = cleanStringList(src.keywords);
    let primaryKeyword = cleanString(src.primaryKeyword);
    if (primaryKeyword && keywords.indexOf(primaryKeyword) === -1) keywords.unshift(primaryKeyword);
    if (!primaryKeyword && keywords.length) primaryKeyword = keywords[0];

    const rank = SCHEMA.ranks.indexOf(src.rank) !== -1 ? src.rank : 'normal';
    const source = SCHEMA.sources.indexOf(src.source) !== -1
      ? src.source
      : ((opts && opts.source) || 'manual');

    const record = {
      id: cleanString(src.id) || newId(),
      category,
      title,
      body,
      keywords,
      primaryKeyword,
      time: validTimeString(src.time) || new Date(now).toISOString(),
      rank,
      evidence: cleanStringList(src.evidence),
      source,
      createdAt: Number.isFinite(src.createdAt) ? src.createdAt : now,
      updatedAt: now
    };

    const groups = groupsOf(category);
    if (groups) {
      const groupId = cleanString(src.groupId);
      record.groupId = groups.indexOf(groupId) !== -1 ? groupId : groups[0];
    }

    if (category === 'pending') {
      const completedDate = validDateOnly(src.completedDate);
      if (completedDate) {
        record.completedDate = completedDate;
        record.completionNote = cleanString(src.completionNote) || '这个目标被实现了';
      }
    }
    return record;
  }

  /** 新记录在前：先比 createdAt，再比 time，最后比 id，保证排序稳定 */
  function newestFirst(a, b) {
    return ((b.createdAt || 0) - (a.createdAt || 0))
      || ((Date.parse(b.time) || 0) - (Date.parse(a.time) || 0))
      || String(b.id).localeCompare(String(a.id));
  }

  function rebuildCache(records) {
    cache.clear();
    SCHEMA.categories.forEach((c) => cache.set(c, []));
    records.forEach((r) => {
      if (!r || !r.id || !isValidCategory(r.category)) return;
      cache.get(r.category).push(r);
    });
    cache.forEach((list) => list.sort(newestFirst));
  }

  /**
   * 读取全部记忆到缓存。读取失败会拒绝，调用方据此显示「读取失败」，不能当成空库。
   * @param {boolean} force 为 true 时忽略已有缓存重新读取
   */
  function load(force) {
    if (loaded && !force) return Promise.resolve();
    if (loadPromise && !force) return loadPromise;
    if (!hasStorage()) {
      lastLoadError = new Error('助手记忆存储不可用');
      return Promise.reject(lastLoadError);
    }
    const p = window.Storage.getAllAssistantMemories().then((records) => {
      rebuildCache(Array.isArray(records) ? records : []);
      loaded = true;
      lastLoadError = null;
    }).catch((err) => {
      lastLoadError = err || new Error('助手记忆读取失败');
      throw lastLoadError;
    }).finally(() => {
      if (loadPromise === p) loadPromise = null;
    });
    loadPromise = p;
    return p;
  }

  function isLoaded() {
    return loaded;
  }

  function loadError() {
    return lastLoadError;
  }

  /** 某分类的缓存数组（新在前）；未加载时为空数组 */
  function list(category) {
    return cache.get(category) || [];
  }

  function get(id) {
    let hit = null;
    cache.forEach((items) => {
      if (hit) return;
      hit = items.find((r) => r.id === id) || null;
    });
    return hit;
  }

  function all() {
    const out = [];
    cache.forEach((items) => out.push.apply(out, items));
    return out;
  }

  /** 全局永久条数；excludeId 用于编辑时不计入正在修改的那条 */
  function countPinned(excludeId) {
    let n = 0;
    cache.forEach((items) => {
      items.forEach((r) => { if (r.rank === 'pinned' && r.id !== excludeId) n += 1; });
    });
    return n;
  }

  function groupLimit(category, groupId) {
    const map = GROUP_LIMITS[category];
    return map && map[groupId] ? map[groupId] : 0;
  }

  /** 越早越靠前：先比记录时间，再比创建时间 */
  function oldestFirst(a, b) {
    return ((Date.parse(a && a.time) || 0) - (Date.parse(b && b.time) || 0))
      || (((a && a.createdAt) || 0) - ((b && b.createdAt) || 0));
  }

  /**
   * 计算放入 incoming 后某个有上限的 Tab 需要淘汰哪些记录。
   * 永久记忆与 keepIds 中的记录不会被淘汰。纯计算，不写库。
   * @returns {Array<object>} 需要删除的记录（最早的在前）
   */
  function planGroupTrim(category, groupId, incoming, keepIds) {
    const limit = groupLimit(category, groupId);
    if (!limit) return [];
    const keep = new Set(keepIds || []);
    const incomingList = (incoming || []).filter((r) => r && r.category === category && r.groupId === groupId);
    const incomingIds = new Set(incomingList.map((r) => r.id));
    const pool = list(category)
      .filter((r) => r.groupId === groupId && !incomingIds.has(r.id))
      .concat(incomingList);
    const overflow = pool.length - limit;
    if (overflow <= 0) return [];
    return pool
      .filter((r) => !keep.has(r.id) && r.rank !== 'pinned')
      .sort(oldestFirst)
      .slice(0, overflow);
  }

  /**
   * 写入与删除放进同一事务提交；成功后才更新缓存。
   * docs 用于随记忆一起提交的配置文本（如提取进度点），与记忆同成同败。
   * @param {{put?: Array<object>, remove?: Array<string>, docs?: Array<{key: string, value: any}>}} ops put 中的记录须已经 normalize
   */
  async function commit(ops) {
    if (!loaded) throw new Error('助手记忆尚未加载，不能写入');
    const puts = (ops && Array.isArray(ops.put) ? ops.put : []).filter(Boolean);
    const removeIds = Array.from(new Set((ops && Array.isArray(ops.remove) ? ops.remove : []).filter(Boolean)));
    const docs = (ops && Array.isArray(ops.docs) ? ops.docs : []).filter((d) => d && d.key);
    puts.forEach((r) => {
      if (!r.id || !isValidCategory(r.category)) throw new Error('助手记忆记录不完整，未写入');
    });

    // 永久额度兜底：按提交后的状态计算
    const removeSet = new Set(removeIds);
    const putIds = new Set(puts.map((r) => r.id));
    let pinned = 0;
    cache.forEach((items) => items.forEach((r) => {
      if (r.rank === 'pinned' && !removeSet.has(r.id) && !putIds.has(r.id)) pinned += 1;
    }));
    puts.forEach((r) => { if (r.rank === 'pinned' && !removeSet.has(r.id)) pinned += 1; });
    if (pinned > PINNED_LIMIT) throw new Error(`永久记忆最多 ${PINNED_LIMIT} 条（全局共用）`);

    if (!hasStorage()) throw new Error('助手记忆存储不可用');
    await window.Storage.commitAssistantMemories(puts, removeIds, docs);

    // 数据库已提交，再同步缓存
    cache.forEach((items) => {
      for (let i = items.length - 1; i >= 0; i--) {
        if (removeSet.has(items[i].id)) items.splice(i, 1);
      }
    });
    puts.forEach((r) => {
      if (removeSet.has(r.id)) return;
      // 同 id 可能换了分类（理论上 UI 不会），先从其他分类移除
      cache.forEach((items, cat) => {
        if (cat === r.category) return;
        const idx = items.findIndex((x) => x.id === r.id);
        if (idx !== -1) items.splice(idx, 1);
      });
      const items = cache.get(r.category);
      const idx = items.findIndex((x) => x.id === r.id);
      if (idx !== -1) items[idx] = r;
      else items.unshift(r);
    });
    return { put: puts.length, removed: removeIds.length };
  }

  /**
   * 批量写入新记忆（供未来的提取流程使用）。
   * 自动为每条生成 id、标记来源，并按 Tab 上限淘汰最早的非永久记录。
   * @param {Array<object>} items 解析器输出的记忆
   * @param {{source?: 'auto'|'manual', docs?: Array<{key: string, value: any}>}} opts
   *   docs：与记忆同一事务提交的配置文本（提取进度点）；没有可写入的记忆时也会提交
   * @returns {Promise<{added: Array<object>, removed: Array<object>, rejected: Array<{item: object, reason: string}>}>}
   */
  async function addMany(items, opts) {
    const source = (opts && opts.source) || 'auto';
    const docs = opts && Array.isArray(opts.docs) ? opts.docs : [];
    const added = [];
    const rejected = [];
    (Array.isArray(items) ? items : []).forEach((item) => {
      try {
        const rec = normalize(Object.assign({}, item, { id: '', source, createdAt: undefined }), { source });
        // AI 来源不允许永久，也不允许携带完成状态
        if (source === 'auto') {
          if (rec.rank === 'pinned') rec.rank = 'normal';
          delete rec.completedDate;
          delete rec.completionNote;
        }
        added.push(rec);
      } catch (err) {
        rejected.push({ item, reason: (err && err.message) || '无效记录' });
      }
    });
    if (!added.length) {
      if (docs.length) await commit({ put: [], remove: [], docs });
      return { added, removed: [], rejected };
    }

    const keepIds = added.map((r) => r.id);
    const removed = [];
    Object.keys(GROUP_LIMITS).forEach((category) => {
      Object.keys(GROUP_LIMITS[category]).forEach((groupId) => {
        const victims = planGroupTrim(category, groupId, added, []);
        victims.forEach((v) => {
          if (keepIds.indexOf(v.id) !== -1) {
            // 新记录本身是最早的，直接不写入
            const idx = added.findIndex((r) => r.id === v.id);
            if (idx !== -1) added.splice(idx, 1);
          } else {
            removed.push(v);
          }
        });
      });
    });
    await commit({ put: added, remove: removed.map((r) => r.id), docs });
    return { added, removed, rejected };
  }

  return {
    SCHEMA,
    PINNED_LIMIT,
    GROUP_LIMITS,
    load,
    isLoaded,
    loadError,
    list,
    get,
    all,
    newId,
    normalize,
    countPinned,
    groupLimit,
    oldestFirst,
    planGroupTrim,
    commit,
    addMany
  };
})();

window.AssistantMemoryStore = AssistantMemoryStore;
