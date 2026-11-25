/**
 * ============================================================================
 * 溯流计划 · 核心档案存储（AssistantProfileStore）
 * ============================================================================
 * 负责核心档案文档的读写、设置、备份与「已吸收」进度标记。
 * 规范见 design/核心档案整理规范.md 第六、七节。
 *
 * 文档键：memory/core_profile（归属 memory/ 域，第二批在 DataRegistry 注册备份）
 *
 * 文档结构：
 * {
 *   content:  '',                      当前核心档案正文（标准格式，含六个板块标题）
 *   updatedAt: 0,                      最后更新时间戳
 *   settings: { batchSize: 50, maxChars: 1500 },
 *   absorbed: { [memoryId]: timestamp }, 已吸收的记忆 id → 吸收时间
 *   backup:   { content, absorbed, updatedAt, backedUpAt } | null
 * }
 *
 * 读取一律走 getDocOrThrow：undefined = 首次（文档不存在），抛错 = 读取失败。
 * 这两者绝不能混为一谈，否则一次临时读取失败就会把已有档案覆盖成「首次整理」。
 * ============================================================================
 */
const AssistantProfileStore = (() => {
  'use strict';

  const DOC_KEY = 'memory/core_profile';

  const DEFAULT_SETTINGS = Object.freeze({ batchSize: 50, maxChars: 1500 });

  const BATCH_MIN = 1;
  const BATCH_MAX = 500;
  const CHARS_MIN = 200;
  const CHARS_MAX = 20000;

  /** 最近一次读取失败的错误信息，便于界面提示 */
  let lastError = null;
  /** 最近一次成功读写的规范化文档（内存缓存，供同步读取正文） */
  let cachedDoc = null;

  function storage() {
    const s = typeof window !== 'undefined' ? window.Storage : null;
    if (!s || typeof s.getDocOrThrow !== 'function' || typeof s.setDoc !== 'function') {
      throw new Error('存储模块未加载');
    }
    return s;
  }

  /* ======================= 规范化 ======================= */

  function clampInt(value, min, max, fallback) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeSettings(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      batchSize: clampInt(src.batchSize, BATCH_MIN, BATCH_MAX, DEFAULT_SETTINGS.batchSize),
      maxChars: clampInt(src.maxChars, CHARS_MIN, CHARS_MAX, DEFAULT_SETTINGS.maxChars)
    };
  }

  function normalizeAbsorbed(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach((id) => {
      const key = String(id || '').trim();
      if (!key) return;
      const ts = Number(raw[id]);
      out[key] = Number.isFinite(ts) ? ts : Date.now();
    });
    return out;
  }

  function normalizeBackup(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const backedUpAt = Number(raw.backedUpAt);
    if (!Number.isFinite(backedUpAt)) return null;
    return {
      content: String(raw.content || ''),
      absorbed: normalizeAbsorbed(raw.absorbed),
      updatedAt: Number(raw.updatedAt) || 0,
      backedUpAt
    };
  }

  function normalizeDoc(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    return {
      content: String(src.content || ''),
      updatedAt: Number(src.updatedAt) || 0,
      settings: normalizeSettings(src.settings),
      absorbed: normalizeAbsorbed(src.absorbed),
      backup: normalizeBackup(src.backup)
    };
  }

  function emptyDoc() {
    return normalizeDoc(null);
  }

  /* ======================= 读写 ======================= */

  /**
   * 读取核心档案文档。
   * @returns {Promise<{ doc: object, exists: boolean }>}
   * @throws 读取异常时抛错（绝不降级为「首次整理」）
   */
  async function loadRaw() {
    let raw;
    try {
      raw = await storage().getDocOrThrow(DOC_KEY);
      lastError = null;
    } catch (err) {
      lastError = (err && err.message) || String(err);
      throw new Error(`核心档案读取失败：${lastError}`);
    }
    if (raw === undefined || raw === null) {
      cachedDoc = emptyDoc();
      return { doc: emptyDoc(), exists: false };
    }
    cachedDoc = normalizeDoc(raw);
    return { doc: normalizeDoc(raw), exists: true };
  }

  /**
   * 最近一次成功读写的档案正文（同步，供系统提示词拼装）。
   * 从未读取过时返回空串；每轮回复前由调用方先 await refreshCache()。
   */
  function getCachedContent() {
    return cachedDoc ? String(cachedDoc.content || '') : '';
  }

  /**
   * 回复前刷新缓存。读取失败时保留旧缓存并返回它，不阻断对话。
   * @returns {Promise<string>} 当前档案正文
   */
  async function refreshCache() {
    try {
      await loadRaw();
    } catch (err) {
      console.warn('[AssistantProfileStore] 核心档案读取失败，本轮沿用上次缓存：', err);
    }
    return getCachedContent();
  }

  /** 读取并直接返回文档对象；不存在时返回空白文档 */
  async function load() {
    const res = await loadRaw();
    return res.doc;
  }

  /** 写入整份文档（内部已规范化） */
  async function save(doc) {
    const next = normalizeDoc(doc);
    const ok = await storage().setDoc(DOC_KEY, next);
    if (!ok) throw new Error('核心档案写入失败');
    cachedDoc = next;
    return next;
  }

  /** 局部更新：取当前文档 → 改 → 写回。failsafe 为 false 时读取异常照常抛错 */
  async function update(mutator) {
    const { doc } = await loadRaw();
    const next = mutator(normalizeDoc(doc)) || doc;
    next.updatedAt = Date.now();
    return await save(next);
  }

  /* ======================= 对外操作 ======================= */

  /**
   * 手动保存档案正文（用户在弹窗里编辑后保存）
   * @param {string} content
   * @param {{charCount?: number}} [info] 仅用于记录，不参与校验
   */
  async function saveContent(content) {
    return await update((doc) => {
      doc.content = String(content || '');
      return doc;
    });
  }

  /**
   * 更新设置
   * @param {{batchSize?: number, maxChars?: number}} patch
   */
  async function saveSettings(patch) {
    return await update((doc) => {
      doc.settings = normalizeSettings({ ...doc.settings, ...(patch || {}) });
      return doc;
    });
  }

  /**
   * 把一批记忆标记为已吸收
   * @param {string[]} ids
   */
  async function markAbsorbed(ids, content) {
    const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
    return await update((doc) => {
      const now = Date.now();
      list.forEach((id) => { doc.absorbed[String(id)] = now; });
      if (typeof content === 'string') doc.content = content;
      return doc;
    });
  }

  /**
   * 清空已吸收标记（从头重新浓缩）
   * @param {{clearContent?: boolean, clearBackup?: boolean}} [opts]
   *   clearContent 为 true 时同时清空当前档案；默认保留
   *   clearBackup 为 true 时同时丢弃备份；默认保留备份以便回退
   */
  async function clearAbsorbed(opts) {
    const o = opts || {};
    return await update((doc) => {
      doc.absorbed = {};
      if (o.clearContent) doc.content = '';
      if (o.clearBackup) doc.backup = null;
      return doc;
    });
  }

  /** 手动创建备份（覆盖旧备份） */
  async function createBackup() {
    return await update((doc) => {
      doc.backup = {
        content: doc.content,
        absorbed: { ...doc.absorbed },
        updatedAt: doc.updatedAt,
        backedUpAt: Date.now()
      };
      return doc;
    });
  }

  /** 从备份恢复档案正文与吸收进度（备份本身保留） */
  async function restoreBackup() {
    const { doc } = await loadRaw();
    if (!doc.backup) throw new Error('没有可用的备份');
    const backup = doc.backup;
    return await save({
      content: backup.content,
      absorbed: { ...backup.absorbed },
      settings: doc.settings,
      backup,
      updatedAt: Date.now()
    });
  }

  /** 备份信息（不含正文，供界面显示） */
  function backupInfo(doc) {
    const b = normalizeBackup(doc && doc.backup);
    if (!b) return null;
    return {
      backedUpAt: b.backedUpAt,
      charCount: Array.from(b.content).length,
      absorbedCount: Object.keys(b.absorbed).length
    };
  }

  return {
    DOC_KEY,
    DEFAULT_SETTINGS,
    BATCH_MIN,
    BATCH_MAX,
    CHARS_MIN,
    CHARS_MAX,
    normalizeDoc,
    normalizeSettings,
    emptyDoc,
    loadRaw,
    load,
    save,
    update,
    saveContent,
    saveSettings,
    markAbsorbed,
    clearAbsorbed,
    createBackup,
    restoreBackup,
    backupInfo,
    getCachedContent,
    refreshCache,
    lastError: () => lastError
  };
})();

if (typeof window !== 'undefined') window.AssistantProfileStore = AssistantProfileStore;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantProfileStore;
