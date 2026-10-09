/**
 * 溯流计划 · 文件区数据层 (File Store)
 * 职责：
 *   1. 执行员上传的文本文件在文件区常驻归档（与是否发送给助手解耦）
 *   2. 文件正文以 Blob 存 IndexedDB assets（doc/file.<id>），元数据索引走 Store 的 meta 域
 *   3. 提供列表读取、正文读取、批量删除、容量统计、孤儿对账
 *
 * 设计要点：
 *   - 索引与本体分离：读列表只走内存里的轻量索引数组，不会把所有正文一次性拉进内存。
 *   - 只接受文本类文件；正文按 UTF-8 存取。
 */
const FileStore = (() => {
  'use strict';

  const ASSET_PREFIX = DataRegistry.prefix.docFile;

  // 允许的文本类扩展名（含常见代码后缀）
  const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'json', 'jsonc', 'csv', 'tsv', 'log', 'xml',
    'yaml', 'yml', 'ini', 'conf', 'cfg', 'toml', 'env', 'properties',
    'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs',
    'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php', 'swift',
    'sh', 'bash', 'zsh', 'sql', 'html', 'htm', 'css', 'scss', 'less',
    'vue', 'svelte', 'lua', 'r', 'pl', 'dart', 'gradle', 'makefile',
    'dockerfile', 'gitignore', 'srt', 'vtt', 'tex'
  ]);

  /* ---------------- 索引读写 ---------------- */

  const SYSTEM_SCOPE = { type: 'system', id: 'system' };

  function normalizeScope(scope) {
    const source = scope || SYSTEM_SCOPE;
    const type = String(source.type || source.scopeType || 'system').trim() || 'system';
    const id = String(source.id || source.scopeId || (type === 'system' ? 'system' : '')).trim();
    return { type, id: id || (type === 'system' ? 'system' : type) };
  }

  function scopeKey(scope) {
    const s = normalizeScope(scope);
    return `${s.type}:${s.id}`;
  }

  function migrateLegacyIndex() {
    const raw = Array.isArray(Store.meta.fileIndex) ? Store.meta.fileIndex : [];
    let changed = false;
    const list = raw.map((entry) => {
      if (!entry || (entry.scopeType && entry.scopeId)) return entry;
      changed = true;
      return { ...entry, scopeType: 'system', scopeId: 'system' };
    });
    if (changed) Store.save('meta.fileIndex', list).catch(() => {});
    return list;
  }

  function readIndex(scope) {
    const wanted = scopeKey(scope);
    return migrateLegacyIndex().filter((entry) => entry && scopeKey({ type: entry.scopeType, id: entry.scopeId }) === wanted);
  }

  function readAllIndex() {
    return migrateLegacyIndex().slice();
  }

  function writeIndex(list) {
    return Store.save('meta.fileIndex', list);
  }

  /* ---------------- 工具 ---------------- */

  function makeId() {
    return 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function getExt(name) {
    const clean = String(name || '').trim().toLowerCase();
    const dot = clean.lastIndexOf('.');
    if (dot < 0) return '';
    return clean.slice(dot + 1);
  }

  /** 是否为受支持的文本类文件（按扩展名或 MIME 判断） */
  function isTextFile(name, mime) {
    const ext = getExt(name);
    if (ext && TEXT_EXTENSIONS.has(ext)) return true;
    // 无扩展名或未知扩展名时，回退看 MIME
    const m = String(mime || '').toLowerCase();
    if (m.startsWith('text/')) return true;
    if (/(json|xml|yaml|javascript|typescript|csv|markdown)/.test(m)) return true;
    // 常见无扩展名的配置文件
    const base = String(name || '').trim().toLowerCase();
    if (['makefile', 'dockerfile', '.gitignore', '.env', 'license', 'readme'].includes(base)) return true;
    return false;
  }

  /** 时间戳格式化为 2026.08.31 08:50 */
  function formatTime(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /** 字节数转可读体积 */
  function formatSize(bytes) {
    if (!bytes || bytes < 1024) return { value: String(bytes || 0), unit: 'B' };
    if (bytes < 1024 * 1024) return { value: (bytes / 1024).toFixed(0), unit: 'KB' };
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: 'MB' };
  }

  /* ---------------- 归档入库 ---------------- */

  /**
   * 归档一个文本文件。
   * @param {File|{name:string, text:string, mime?:string}} input 浏览器 File 或已读取文本的对象
   * @returns {Promise<object|null>} 入库后的元数据条目
   */
  async function record(input, scope) {
    let name = '';
    let text = '';
    let mime = '';

    if (input instanceof File) {
      name = input.name || '未命名文件';
      mime = input.type || '';
      if (!isTextFile(name, mime)) {
        console.warn('[FileStore] 拒绝非文本文件：', name, mime);
        return { error: 'not_text', name };
      }
      text = await input.text();
    } else if (input && typeof input === 'object') {
      name = String(input.name || '未命名文件');
      mime = String(input.mime || '');
      text = String(input.text || '');
      if (!isTextFile(name, mime)) return { error: 'not_text', name };
    } else {
      return null;
    }

    const id = makeId();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const entry = {
      id,
      key: ASSET_PREFIX + id,
      name,
      ext: getExt(name),
      mime: mime || 'text/plain',
      size: blob.size,
      charCount: text.length,
      createdAt: Date.now(),
      scopeType: normalizeScope(scope).type,
      scopeId: normalizeScope(scope).id
    };

    await Storage.setAsset(entry.key, blob);

    const all = readAllIndex();
    all.unshift(entry);
    await writeIndex(all);

    return entry;
  }

  /* ---------------- 列表与统计 ---------------- */

  /** 读取文件列表（已按时间倒序），附带展示用字段 */
  function list(scope) {
    return readIndex(scope).map((entry) => {
      const size = formatSize(entry.size);
      return Object.assign({}, entry, {
        timeText: formatTime(entry.createdAt),
        sizeText: `${size.value} ${size.unit}`
      });
    });
  }

  /** 按文件 ID 读取轻量元数据 */
  function getEntry(id, scope) {
    return readIndex(scope).find((entry) => entry && String(entry.id) === String(id)) || null;
  }

  /** 按文件名（忽略大小写、可含或不含扩展名）查找元数据，返回首个命中 */
  function getEntryByName(name, scope) {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return null;
    const all = readIndex(scope);
    // 优先完整匹配
    let hit = all.find((e) => e && String(e.name).trim().toLowerCase() === target);
    if (hit) return hit;
    // 再匹配去扩展名
    hit = all.find((e) => {
      const n = String(e.name).trim().toLowerCase();
      const stem = n.includes('.') ? n.slice(0, n.lastIndexOf('.')) : n;
      return stem === target;
    });
    return hit || null;
  }

  /** 读取文件正文文本。命中不到或已失效返回 null。 */
  async function getText(id, scope) {
    const entry = getEntry(id, scope);
    if (!entry || !entry.key || !Storage.getAssetRaw) {
      console.warn('[FileStore] getText 未命中条目：', id);
      return null;
    }
    const raw = await Storage.getAssetRaw(entry.key);
    if (!raw || raw.type !== 'blob' || !(raw.data instanceof Blob)) {
      console.warn('[FileStore] getText 命中条目但正文已失效：', id, entry.key);
      return null;
    }
    try {
      return await raw.data.text();
    } catch (err) {
      console.warn('[FileStore] 正文解码失败：', id, err);
      return null;
    }
  }

  /** 数量与总体积统计 */
  function getStats(scope) {
    const all = readIndex(scope);
    const totalBytes = all.reduce((sum, e) => sum + (e.size || 0), 0);
    const size = formatSize(totalBytes);
    return {
      count: all.length,
      totalBytes,
      sizeValue: size.value,
      sizeUnit: size.unit
    };
  }

  /* ---------------- 删除 ---------------- */

  /** 批量删除：先移除 IndexedDB 本体，再更新索引 */
  async function remove(ids, scope) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const target = new Set(ids.map(String));
    const all = readAllIndex();
    const list = readIndex(scope);
    const scopedIds = new Set(list.map((entry) => String(entry.id)));
    const keep = [];
    let removed = 0;

    for (const entry of list) {
      if (target.has(String(entry.id)) && scopedIds.has(String(entry.id))) {
        try {
          await Storage.removeAsset(entry.key);
          removed += 1;
        } catch (err) {
          console.warn('[FileStore] 删除文件失败：', entry.key, err);
          keep.push(entry);
        }
      } else {
        keep.push(entry);
      }
    }

    const keptIds = new Set(keep.map((entry) => String(entry.id)));
    await writeIndex(all.filter((entry) => !scopedIds.has(String(entry.id)) || keptIds.has(String(entry.id))));
    if (removed > 0) {
      window.dispatchEvent(new CustomEvent('retroflow:file-store-changed'));
    }
    return removed;
  }

  /** 与 IndexedDB 实际内容对账，清掉索引里已失效的孤儿条目。 */
  async function reconcile(scope) {
    const keys = await Storage.listAssetKeys(ASSET_PREFIX);
    const alive = new Set(keys);
    const all = readAllIndex();
    const list = readIndex(scope);
    const scopedIds = new Set(list.map((entry) => String(entry.id)));
    const keep = list.filter((e) => alive.has(e.key));
    if (keep.length !== list.length) {
      const keptIds = new Set(keep.map((entry) => String(entry.id)));
      await writeIndex(all.filter((entry) => !scopedIds.has(String(entry.id)) || keptIds.has(String(entry.id))));
    }
    return { before: list.length, after: keep.length };
  }

  return {
    record,
    list,
    getEntry,
    getEntryByName,
    getText,
    getStats,
    remove,
    reconcile,
    isTextFile,
    TEXT_EXTENSIONS,
    ASSET_PREFIX,
    listAllKeys: () => migrateLegacyIndex().map((e) => e.key)
  };
})();

window.FileStore = FileStore;

// 向注册表声明文件区在用的资产键（全部文件条目）
DataRegistry.registerUsageProvider('doc', () => FileStore.listAllKeys());
