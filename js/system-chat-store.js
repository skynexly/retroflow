/**
 * ============================================================================
 * 溯流计划 · 系统助手多对话存档层 (System Chat Store)
 *
 * 一个助手可以开多个独立对话窗，各自上下文隔离 —— 结构与副本推演的多世界线
 * 同源，骨架照 fork-run-store.js 抄：索引自愈、本体回滚、normalize 清脏值。
 *
 * 刻意不记「所属助手」：执行员随时可以在同一个对话里换助手，助手归属由
 * ResonanceUI 的当前激活指针决定，与对话本身无关。
 *
 * 存储布局：
 *   sysChat/index          索引：convIds 列表 + activeConvId
 *   sysChat/doc.{convId}   会话本体：标题、创建/活跃时间、消息数
 *   records 表             对话流水，forkId 字段用 `system-chat:{convId}`
 *
 * 流水走 records 而不是 docs：那张表已有 forkId 索引与前缀查询，
 * 线上聊天与副本推演用的都是同一套，不必另建机制。
 *
 * 旧数据零迁移：历史流水的 forkId 是 `system-chat:main`，一个字都不改。
 * 首次初始化时把 `main` 注册成第一条会话即可，老记录照常读得到。
 * ============================================================================
 */
const SystemChatStore = (() => {
  'use strict';

  /** 流水 forkId 前缀。拼 `system-chat:{convId}` */
  const FORK_PREFIX = 'system-chat:';
  /** 首条（历史遗留）对话的固定 id。老流水全挂在这个 forkId 下 */
  const LEGACY_CONV_ID = 'main';
  /** 对话标题长度上限，与输入框 maxlength 对齐 */
  const TITLE_MAX = 30;

  const trimStr = (v) => (typeof v === 'string' ? v.trim() : '');

  /* ---------------- 键名 ---------------- */

  function indexKey() {
    return window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.sysChatIndex === 'function'
      ? DataRegistry.key.sysChatIndex()
      : 'sysChat/index';
  }
  function docKey(convId) {
    return window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.sysChatDoc === 'function'
      ? DataRegistry.key.sysChatDoc(convId)
      : `sysChat/doc.${convId}`;
  }

  /** 拼某条对话的流水 forkId */
  function forkIdOf(convId) {
    const id = trimStr(convId) || LEGACY_CONV_ID;
    return `${FORK_PREFIX}${id}`;
  }

  function makeConvId() {
    return `sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  /* ---------------- 归一化 ---------------- */

  /** 索引归一：保证 convIds 是去重字符串数组、activeConvId 在列表内 */
  function normalizeIndex(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const convIds = (Array.isArray(src.convIds) ? src.convIds : [])
      .map(trimStr)
      .filter(Boolean)
      .filter((id, i, a) => a.indexOf(id) === i);
    let activeConvId = trimStr(src.activeConvId);
    // 活跃指针指向已不存在的对话：退回列表第一条，避免悬空
    if (activeConvId && !convIds.includes(activeConvId)) activeConvId = '';
    if (!activeConvId && convIds.length) activeConvId = convIds[0];
    return {
      convIds,
      activeConvId,
      updatedAt: Number(src.updatedAt) || 0
    };
  }

  /** 会话本体归一。msgCount 只作列表展示，不参与逻辑判定，脏了不致命 */
  function normalizeConv(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const now = Date.now();
    return {
      id: trimStr(src.id),
      title: trimStr(src.title).slice(0, TITLE_MAX),
      createdAt: Number(src.createdAt) || now,
      updatedAt: Number(src.updatedAt) || Number(src.createdAt) || now,
      msgCount: Math.max(0, Number(src.msgCount) || 0)
    };
  }

  /* ---------------- 索引读写 ---------------- */

  async function getIndex() {
    if (!window.Storage) return normalizeIndex(null);
    const raw = await Storage.getDoc(indexKey(), null);
    return normalizeIndex(raw);
  }

  async function putIndex(index) {
    if (!window.Storage) return false;
    const next = normalizeIndex(index);
    next.updatedAt = Date.now();
    return await Storage.setDoc(indexKey(), next);
  }

  /* ---------------- 会话读取 ---------------- */

  async function getConv(convId) {
    const id = trimStr(convId);
    if (!id || !window.Storage) return null;
    const raw = await Storage.getDoc(docKey(id), null);
    if (!raw) return null;
    const conv = normalizeConv({ ...raw, id: raw.id || id });
    return conv.id ? conv : null;
  }

  /**
   * 列出全部对话，按最后活跃时间倒序（最近聊过的在前）。
   * 索引里存在但本体已丢失的 convId 会被剔除并自愈写回索引。
   */
  async function listConvs() {
    const index = await getIndex();
    if (!index.convIds.length) return [];

    const convs = [];
    const missing = [];
    for (const convId of index.convIds) {
      const conv = await getConv(convId);
      if (conv) convs.push(conv);
      else missing.push(convId);
    }

    // 自愈：清掉索引里的死引用
    if (missing.length) {
      const keep = index.convIds.filter((id) => !missing.includes(id));
      await putIndex({ ...index, convIds: keep });
    }

    return convs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function countConvs() {
    const index = await getIndex();
    return index.convIds.length;
  }

  /* ---------------- 孤儿流水自愈 ---------------- */

  /**
   * 把「有流水、但不在窗口列表里」的对话补登记回索引。
   *
   * 来源：早期数据包只导出 records 流水，没带 sysChat/ 下的窗口元信息。
   * 这种包导入后，非主对话窗口的消息完好地躺在 records 里，但索引里没有它们，
   * 助手页的窗口列表就看不见。这里按 forkId 反推 convId，给每个孤儿补一份元信息：
   *   · 标题统一为「恢复的对话」，执行员可自行改名；
   *   · createdAt / updatedAt 取该窗口最早 / 最晚一条流水的时间，列表排序与原来一致；
   *   · msgCount 直接数流水条数。
   * 已在索引里的窗口一律不碰，所以重复调用是幂等的。
   *
   * @returns {Promise<number>} 本次恢复的窗口数
   */
  async function recoverOrphanConvs() {
    if (!window.Storage || typeof Storage.getRecordsByForkPrefix !== 'function') return 0;

    let records = [];
    try {
      records = (await Storage.getRecordsByForkPrefix(FORK_PREFIX)) || [];
    } catch (err) {
      console.warn('[SystemChatStore] 孤儿流水扫描失败：', err);
      return 0;
    }
    if (!records.length) return 0;

    // 按 convId 聚合：条数 + 首末时间
    const groups = new Map();
    for (const rec of records) {
      const forkId = rec && typeof rec.forkId === 'string' ? rec.forkId : '';
      if (!forkId.startsWith(FORK_PREFIX)) continue;
      const convId = trimStr(forkId.slice(FORK_PREFIX.length));
      if (!convId) continue;
      const ts = Number(rec.createdAt) || 0;
      const g = groups.get(convId) || { count: 0, first: 0, last: 0 };
      g.count += 1;
      if (ts && (!g.first || ts < g.first)) g.first = ts;
      if (ts > g.last) g.last = ts;
      groups.set(convId, g);
    }
    if (!groups.size) return 0;

    const index = await getIndex();
    // 索引完全为空 = 首次初始化，交给 ensureInit 原有分支建 main（它会继承旧备注当标题）。
    // 这里若先把 main 登记了，原分支就走不到，备注会丢。ensureInit 建完 main 后会再调一次本函数收其余孤儿。
    if (!index.convIds.length) return 0;
    const known = new Set(index.convIds);
    const recovered = [];

    for (const [convId, g] of groups) {
      if (known.has(convId)) continue;
      // 本体还在只是索引丢了：直接挂回索引，不覆盖原标题
      const existing = await getConv(convId);
      if (!existing) {
        const now = Date.now();
        const conv = normalizeConv({
          id: convId,
          title: convId === LEGACY_CONV_ID ? '主对话' : '恢复的对话',
          createdAt: g.first || now,
          updatedAt: g.last || g.first || now,
          msgCount: g.count
        });
        const ok = await Storage.setDoc(docKey(conv.id), conv);
        if (!ok) continue;
      }
      recovered.push(convId);
    }

    if (!recovered.length) return 0;

    const written = await putIndex({
      ...index,
      convIds: [...index.convIds, ...recovered],
      // 原本就没有任何窗口时，活跃指针交给 normalizeIndex 落到第一条
      activeConvId: index.activeConvId
    });
    if (!written) return 0;
    console.info(`[SystemChatStore] 已从流水恢复 ${recovered.length} 个未登记的对话窗口`);
    return recovered.length;
  }

  /* ---------------- 初始化 ---------------- */

  /**
   * 确保至少有一条对话存在，返回当前活跃对话。
   *
   * 首次运行（索引为空）时把历史遗留的 `main` 注册成第一条对话：
   * 老流水的 forkId 就是 `system-chat:main`，不搬数据，只补一份元信息。
   * 标题优先沿用执行员以前在设置里填过的「备注」，没填则用默认名。
   *
   * 进入正常流程前先跑一次孤儿流水自愈（见 recoverOrphanConvs），
   * 让旧数据包导入后丢失的窗口重新出现在列表里。
   *
   * @param {string} [legacyRemark] 旧 settings.remark，用作 main 的初始标题
   * @returns {Promise<Object|null>} 当前活跃对话
   */
  async function ensureInit(legacyRemark) {
    if (!window.Storage) return null;
    // 自愈失败不能挡住助手页打开，吞掉异常继续走原流程
    try { await recoverOrphanConvs(); } catch (err) {
      console.warn('[SystemChatStore] 孤儿对话自愈失败：', err);
    }
    const index = await getIndex();

    if (index.convIds.length) {
      const active = await getConv(index.activeConvId);
      if (active) return active;
      // 活跃指针坏了：listConvs 会顺手自愈，取回最近一条
      const all = await listConvs();
      if (!all.length) return await createConv('主对话');
      await putIndex({ ...index, convIds: all.map((c) => c.id), activeConvId: all[0].id });
      return all[0];
    }

    // 首次初始化：建 main，继承旧备注当标题
    const now = Date.now();
    const legacyTitle = trimStr(legacyRemark).slice(0, TITLE_MAX);
    // 老流水有多少条，直接数出来当 msgCount，列表第一眼就准
    let msgCount = 0;
    try {
      if (typeof Storage.getRecordsByFork === 'function') {
        const records = await Storage.getRecordsByFork(forkIdOf(LEGACY_CONV_ID)) || [];
        msgCount = records.length;
      }
    } catch (_) { /* 数不出来就从 0 起，不影响功能 */ }

    const conv = normalizeConv({
      id: LEGACY_CONV_ID,
      title: legacyTitle || '主对话',
      createdAt: now,
      updatedAt: now,
      msgCount
    });
    const ok = await Storage.setDoc(docKey(conv.id), conv);
    if (!ok) return null;
    const written = await putIndex({ convIds: [conv.id], activeConvId: conv.id });
    if (!written) {
      await Storage.removeDoc(docKey(conv.id));
      return null;
    }
    // 首次初始化刚建好 main，索引已非空：此时再收一次其余孤儿窗口。
    // 典型场景是旧格式备包导入到全新设备，一次打开就能看到全部窗口，不必等下次启动。
    try { await recoverOrphanConvs(); } catch (_) { /* 自愈失败不影响 main 可用 */ }
    return conv;
  }

  /* ---------------- 建档 / 改名 / 删除 ---------------- */

  /**
   * 新建一条对话。建完即成为当前活跃对话。
   * @param {string} [title] 标题，留空则由 UI 侧按首条消息兜底显示
   * @returns {Promise<Object|null>}
   */
  async function createConv(title) {
    if (!window.Storage) return null;
    const now = Date.now();
    const conv = normalizeConv({
      id: makeConvId(),
      title: trimStr(title),
      createdAt: now,
      updatedAt: now,
      msgCount: 0
    });

    const ok = await Storage.setDoc(docKey(conv.id), conv);
    if (!ok) return null;

    const index = await getIndex();
    const written = await putIndex({
      ...index,
      convIds: [conv.id, ...index.convIds.filter((id) => id !== conv.id)],
      activeConvId: conv.id
    });
    if (!written) {
      // 索引没写进去就回滚本体，不留索引外的孤儿会话
      await Storage.removeDoc(docKey(conv.id));
      return null;
    }
    return conv;
  }

  /** 更新对话字段。只覆盖传入的键；id / createdAt 恒定不可改 */
  async function updateConv(convId, patch) {
    const existing = await getConv(convId);
    if (!existing || !window.Storage) return null;
    const next = normalizeConv({
      ...existing,
      ...(patch && typeof patch === 'object' ? patch : {}),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    });
    const ok = await Storage.setDoc(docKey(next.id), next);
    return ok ? next : null;
  }

  /** 改标题。空串合法（= 清空，由 UI 兜底显示首条消息摘要） */
  async function renameConv(convId, title) {
    return await updateConv(convId, { title: trimStr(title).slice(0, TITLE_MAX) });
  }

  /**
   * 推进活跃时间与消息数。每次落一条流水后调，列表排序靠它。
   * @param {string} convId
   * @param {number} [delta] 消息数增量，默认 +1
   */
  async function touchConv(convId, delta) {
    const existing = await getConv(convId);
    if (!existing) return null;
    const step = Number.isFinite(Number(delta)) ? Number(delta) : 1;
    return await updateConv(convId, {
      msgCount: Math.max(0, (existing.msgCount || 0) + step)
    });
  }

  /**
   * 删除一条对话，连同它的全部流水。
   *
   * 至少保留一条：删掉最后一条会让助手页无处可去，直接拒绝。
   * 删的是当前活跃对话时，活跃指针顺延到剩下的最近一条。
   *
   * @returns {Promise<{ok:boolean, reason:string, activeConvId:string}>}
   */
  async function deleteConv(convId) {
    const id = trimStr(convId);
    if (!id || !window.Storage) return { ok: false, reason: 'invalid', activeConvId: '' };
    const index = await getIndex();
    if (!index.convIds.includes(id)) return { ok: false, reason: 'notfound', activeConvId: index.activeConvId };
    if (index.convIds.length <= 1) return { ok: false, reason: 'last', activeConvId: index.activeConvId };

    // 先清流水再删本体：顺序反了会留下读不到元信息的孤儿记录
    try {
      if (typeof Storage.removeRecordsByFork === 'function') {
        await Storage.removeRecordsByFork(forkIdOf(id));
      }
    } catch (err) {
      console.warn('[SystemChatStore] 清理对话流水失败：', id, err);
    }
    try { await Storage.removeDoc(docKey(id)); } catch (_) { /* 本体已不在也算删成功 */ }

    const keep = index.convIds.filter((x) => x !== id);
    const nextActive = index.activeConvId === id ? (keep[0] || '') : index.activeConvId;
    await putIndex({ ...index, convIds: keep, activeConvId: nextActive });
    return { ok: true, reason: '', activeConvId: nextActive };
  }

  /* ---------------- 活跃指针 ---------------- */

  async function getActiveConvId() {
    const index = await getIndex();
    return index.activeConvId;
  }

  /** 切换当前对话。目标不存在时不动指针，返回 false */
  async function setActiveConvId(convId) {
    const id = trimStr(convId);
    const index = await getIndex();
    if (!id || !index.convIds.includes(id)) return false;
    if (index.activeConvId === id) return true;
    return await putIndex({ ...index, activeConvId: id });
  }

  return {
    FORK_PREFIX,
    LEGACY_CONV_ID,
    TITLE_MAX,
    forkIdOf,
    getIndex,
    getConv,
    listConvs,
    countConvs,
    ensureInit,
    recoverOrphanConvs,
    createConv,
    updateConv,
    renameConv,
    touchConv,
    deleteConv,
    getActiveConvId,
    setActiveConvId
  };
})();

window.SystemChatStore = SystemChatStore;
