/**
 * 溯流计划 · 存储层
 *
 * IndexedDB 三个 object store，按访问模式划分：
 *   assets   图片等二进制资源，存 Blob（容量大、无 Base64 膨胀）
 *   docs     配置类文本，有界小数据（身份、马甲、角色卡、主题配置），全量装载
 *   records  流水类记录，无界增长（副本记录、聊天历史），只按索引取切片
 *   memories 记忆库专属流水（事件记忆/角色记忆同库不同型），带关键词与在场角色反查索引
 *
 * records 本轮只建 schema 不写业务逻辑，等副本功能落地时再接。
 * 一次性把版本号推到位，避免以后再升 schema。
 */
const Storage = (() => {
  const DB_NAME = 'retroflow';
  const DB_VERSION = 3;
  const STORE_ASSETS = 'assets';
  const STORE_DOCS = 'docs';
  const STORE_RECORDS = 'records';
  const STORE_MEMORIES = 'memories';

  let dbPromise = null;

  /** 打开（并在需要时初始化）数据库 */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('当前环境不支持 IndexedDB'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS);
        }

        // 配置类文本：外部键，键名由 DataRegistry.textKey.xxx() 生成
        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          db.createObjectStore(STORE_DOCS);
        }

        // 流水类记录：内联主键 + 查询索引，供未来的副本/聊天记录分页取用
        if (!db.objectStoreNames.contains(STORE_RECORDS)) {
          const records = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
          records.createIndex('by_kind', 'kind');
          records.createIndex('by_fork', 'forkId');
          records.createIndex('by_time', 'createdAt');
          records.createIndex('by_fork_time', ['forkId', 'createdAt']);
          records.createIndex('by_kind_time', ['kind', 'createdAt']);
        }

        // 记忆库：事件记忆与角色记忆同库不同型（memKind 判别），索引一次升到位
        // 设计依据：design/记忆库架构与事件记忆规范.md「3.5 存储层设计」
        if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
          const memories = db.createObjectStore(STORE_MEMORIES, { keyPath: 'id' });
          memories.createIndex('by_kind_time', ['memKind', 'createdAt']);
          memories.createIndex('by_fork_run', ['forkId', 'runId']);
          memories.createIndex('by_status', 'status');
          // multiEntry：keywords / witnessIds 是扁平数组，逐项入索引支持反查
          memories.createIndex('by_keywords', 'keywords', { multiEntry: true });
          memories.createIndex('by_witness', 'witnessIds', { multiEntry: true });
          // 角色记忆主查询（本阶段暂不写入，索引先备好）
          memories.createIndex('by_char_time', ['charId', 'createdAt']);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  /** 通用读写事务包装：只有 transaction.oncomplete 才代表写入真正提交。 */
  function withAnyStore(storeName, mode, handler) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      let settled = false;
      let result;
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error || tx.error || new Error(`IndexedDB ${storeName} 事务失败`));
      };

      tx.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      tx.onerror = () => fail(tx.error);
      tx.onabort = () => fail(tx.error || new Error(`IndexedDB ${storeName} 事务已中止`));

      let request;
      try {
        request = handler(store);
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        fail(err);
        return;
      }

      if (request) {
        request.onsuccess = () => { result = request.result; };
        request.onerror = () => fail(request.error);
      }
    }));
  }

  /** assets store 的事务包装（保持原有调用形态） */
  async function withStore(mode, handler) {
    return withAnyStore(STORE_ASSETS, mode, handler);
  }

  /* ---------------- 图片资源（IndexedDB） ---------------- */

  /**
   * 写入图片资源
   * @param {string} key 资源键名，请统一走 DataRegistry.key.xxx() 生成，
   *   形如 'envoy/persona.avatar'、'decor/theme.wallpaper'
   * @param {Blob|string} value Blob（本地文件）或图片 URL 字符串
   */
  async function setAsset(key, value) {
    const record = value instanceof Blob
      ? { type: 'blob', data: value }
      : { type: 'url', data: String(value) };

    await withStore('readwrite', (store) => store.put(record, key));
    return record;
  }

  /**
   * 读取图片资源，返回可直接赋给 img.src 的字符串
   * Blob 会转成 objectURL，调用方负责在替换时调用 revokeAsset 释放
   * @returns {Promise<string|null>}
   */
  async function getAssetSrc(key) {
    try {
      const record = await withStore('readonly', (store) => store.get(key));
      if (!record) return null;

      if (record.type === 'blob' && record.data instanceof Blob) {
        return URL.createObjectURL(record.data);
      }
      if (record.type === 'url') {
        return record.data;
      }
      return null;
    } catch (err) {
      console.warn('[Storage] 读取资源失败：', err);
      return null;
    }
  }

  /**
   * 读取图片资源的原始记录（不转 objectURL，可拿到 Blob 本体与体积）
   * @returns {Promise<{type:string, data:Blob|string}|null>}
   */
  async function getAssetRaw(key) {
    try {
      const record = await withStore('readonly', (store) => store.get(key));
      return record || null;
    } catch (err) {
      console.warn('[Storage] 读取资源记录失败：', err);
      return null;
    }
  }

  /**
   * 列举资源键名，可按前缀过滤
   * @param {string} [prefix] 键名前缀，留空返回全部
   * @returns {Promise<string[]>}
   */
  async function listAssetKeys(prefix) {
    try {
      const keys = await withStore('readonly', (store) => store.getAllKeys());
      const all = Array.isArray(keys) ? keys.map(String) : [];
      if (!prefix) return all;
      return all.filter((k) => k.startsWith(prefix));
    } catch (err) {
      console.warn('[Storage] 列举资源键失败：', err);
      return [];
    }
  }

  /** 释放由 getAssetSrc 生成的 objectURL，避免内存泄漏 */
  function revokeAssetSrc(src) {
    if (typeof src === 'string' && src.startsWith('blob:')) {
      URL.revokeObjectURL(src);
    }
  }

  async function removeAsset(key) {
    await withStore('readwrite', (store) => store.delete(key));
  }

  /* ---------------- 配置类文本（IndexedDB docs） ---------------- */

  /**
   * 写入一条配置文本。值会原样存储（对象也可直接存，IndexedDB 支持结构化克隆）。
   * @param {string} key 键名，请走 DataRegistry.textKey.xxx() 生成
   * @param {any} value 任意可结构化克隆的值
   * @returns {Promise<boolean>} 是否写入成功
   */
  async function setDoc(key, value) {
    try {
      await withAnyStore(STORE_DOCS, 'readwrite', (store) => store.put(value, key));
      return true;
    } catch (err) {
      console.error('[Storage] 写入配置失败：', key, err);
      return false;
    }
  }

  /**
   * 读取一条配置文本
   * @returns {Promise<any>} 不存在时返回 fallback
   */
  async function getDoc(key, fallback = null) {
    try {
      const value = await withAnyStore(STORE_DOCS, 'readonly', (store) => store.get(key));
      return value === undefined ? fallback : value;
    } catch (err) {
      console.warn('[Storage] 读取配置失败：', key, err);
      return fallback;
    }
  }

  /**
   * 全量读取配置，返回 { key: value } 映射。
   * 配置类数据有界且小，一次装载进内存供同步读取。
   * @returns {Promise<Object<string, any>>}
   */
  async function getAllDocs() {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_DOCS, 'readonly');
        const store = tx.objectStore(STORE_DOCS);
        const out = {};
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            out[String(cursor.key)] = cursor.value;
            cursor.continue();
          } else {
            resolve(out);
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[Storage] 全量读取配置失败：', err);
      return {};
    }
  }

  /** 列举配置键名，可按前缀过滤 */
  async function listDocKeys(prefix) {
    try {
      const keys = await withAnyStore(STORE_DOCS, 'readonly', (store) => store.getAllKeys());
      const all = Array.isArray(keys) ? keys.map(String) : [];
      if (!prefix) return all;
      return all.filter((k) => k.startsWith(prefix));
    } catch (err) {
      console.warn('[Storage] 列举配置键失败：', err);
      return [];
    }
  }

  async function removeDoc(key) {
    try {
      await withAnyStore(STORE_DOCS, 'readwrite', (store) => store.delete(key));
      return true;
    } catch (err) {
      console.warn('[Storage] 删除配置失败：', key, err);
      return false;
    }
  }

  /* ---------------- 流水记录（IndexedDB records） ---------------- */

  async function putRecord(record) {
    if (!record || !record.id) throw new Error('流水记录缺少 id');
    await withAnyStore(STORE_RECORDS, 'readwrite', (store) => store.put(record));
    return record;
  }

  /** 全量读取所有流水记录（供数据管理导出使用，业务读取仍应走索引分页） */
  async function getAllRecords() {
    try {
      return await withAnyStore(STORE_RECORDS, 'readonly', (store) => store.getAll()) || [];
    } catch (err) {
      console.warn('[Storage] 全量读取流水失败：', err);
      return [];
    }
  }

  /** 清空所有流水记录，返回删除条数 */
  async function clearAllRecords() {
    const all = await getAllRecords();
    const count = all.length;
    if (!count) return 0;
    await withAnyStore(STORE_RECORDS, 'readwrite', (store) => store.clear());
    return count;
  }

  async function getRecordsByFork(forkId) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_RECORDS, 'readonly');
        const index = tx.objectStore(STORE_RECORDS).index('by_fork_time');
        const range = IDBKeyRange.bound([forkId, 0], [forkId, Number.MAX_SAFE_INTEGER]);
        const request = index.getAll(range);
        request.onsuccess = () => resolve((request.result || []).sort((a, b) => a.createdAt - b.createdAt));
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[Storage] 读取会话流水失败：', forkId, err);
      return [];
    }
  }

  async function removeRecord(id) {
    await withAnyStore(STORE_RECORDS, 'readwrite', (store) => store.delete(id));
    return true;
  }

  /**
   * 按 forkId 前缀读取流水。
   * 线上聊天的 forkId 形如 online:{accountId}:{contactId}，
   * 用前缀就能按账号或按单个会话取，无需为每种粒度建索引。
   * @param {string} prefix 例如 'online:' 或 'online:persona:'
   */
  async function getRecordsByForkPrefix(prefix) {
    const p = String(prefix || '');
    if (!p) return [];
    const all = await getAllRecords();
    return all
      .filter((r) => r && typeof r.forkId === 'string' && r.forkId.startsWith(p))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  /**
   * 按 forkId 前缀批量删除流水，返回删除条数。
   * 档案级联删除与「仅清理线上记录」都走这里。
   * @param {string} prefix 例如 'online:persona:contact_x'
   */
  async function removeRecordsByForkPrefix(prefix) {
    const targets = await getRecordsByForkPrefix(prefix);
    if (!targets.length) return 0;
    await openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readwrite');
      const store = tx.objectStore(STORE_RECORDS);
      targets.forEach((record) => store.delete(record.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
    return targets.length;
  }

  async function removeRecordsByFork(forkId) {
    const records = await getRecordsByFork(forkId);
    if (!records.length) return 0;
    await openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_RECORDS, 'readwrite');
      const store = tx.objectStore(STORE_RECORDS);
      records.forEach(record => store.delete(record.id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
    return records.length;
  }

  /* ---------------- 图片压缩工具 ---------------- */

  /**
   * 将图片文件等比压缩到指定最长边，输出 Blob
   * @param {File|Blob} file 原始图片
   * @param {number} maxSize 最长边上限（px）
   * @param {number} quality JPEG/WebP 质量 0~1
   * @param {string} mime 输出格式，默认 'image/jpeg'；透明图（如图标 PNG）应传 'image/png' 以保留透明通道
   * @returns {Promise<Blob>} 压缩后的 Blob（失败时回退为原文件）
   */
  function compressImage(file, maxSize = 1200, quality = 0.85, mime = 'image/jpeg') {
    return new Promise((resolve) => {
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        const { width, height } = img;
        const scale = Math.min(1, maxSize / Math.max(width, height));

        // 尺寸已达标且体积不大，直接原样返回（PNG 透明通道也随之原样保留）
        if (scale === 1 && file.size <= 600 * 1024) {
          resolve(file);
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => resolve(blob || file),
          mime,
          quality
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };

      img.src = objectUrl;
    });
  }

  /* ---------------- 记忆库（IndexedDB memories） ---------------- */

  /** 写入/更新一条记忆（事件或角色记忆，需含 id 与 memKind） */
  async function putMemory(record) {
    if (!record || !record.id) throw new Error('记忆记录缺少 id');
    if (!record.memKind) throw new Error('记忆记录缺少 memKind');
    await withAnyStore(STORE_MEMORIES, 'readwrite', (store) => store.put(record));
    return record;
  }

  /** 按主键读取一条记忆 */
  async function getMemory(id) {
    try {
      const record = await withAnyStore(STORE_MEMORIES, 'readonly', (store) => store.get(id));
      return record || null;
    } catch (err) {
      console.warn('[Storage] 读取记忆失败：', id, err);
      return null;
    }
  }

  /**
   * 按索引查询记忆（业务封装请走 MemoryStore，此处为底层通道）
   * @param {string} indexName by_kind_time / by_fork_run / by_status / by_keywords / by_witness / by_char_time
   * @param {IDBKeyRange|any} query 索引键或范围；数组复合键传数组
   */
  async function getMemoriesByIndex(indexName, query) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_MEMORIES, 'readonly');
        const index = tx.objectStore(STORE_MEMORIES).index(indexName);
        const request = index.getAll(query);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[Storage] 记忆索引查询失败：', indexName, err);
      return [];
    }
  }

  /** 全量读取记忆（供导出与假数据清理使用，业务读取仍应走索引） */
  async function getAllMemories() {
    try {
      return await withAnyStore(STORE_MEMORIES, 'readonly', (store) => store.getAll()) || [];
    } catch (err) {
      console.warn('[Storage] 全量读取记忆失败：', err);
      return [];
    }
  }

  async function removeMemory(id) {
    await withAnyStore(STORE_MEMORIES, 'readwrite', (store) => store.delete(id));
    return true;
  }

  /** 清空记忆库，返回删除条数 */
  async function clearAllMemories() {
    const all = await getAllMemories();
    const count = all.length;
    if (!count) return 0;
    await withAnyStore(STORE_MEMORIES, 'readwrite', (store) => store.clear());
    return count;
  }

  return {
    setAsset,
    getAssetSrc,
    getAssetRaw,
    listAssetKeys,
    revokeAssetSrc,
    removeAsset,
    setDoc,
    getDoc,
    getAllDocs,
    listDocKeys,
    removeDoc,
    putRecord,
    getRecordsByFork,
    getRecordsByForkPrefix,
    getAllRecords,
    clearAllRecords,
    removeRecord,
    removeRecordsByFork,
    removeRecordsByForkPrefix,
    putMemory,
    getMemory,
    getMemoriesByIndex,
    getAllMemories,
    removeMemory,
    clearAllMemories,
    compressImage
  };
})();

// 顶层 const 不会自动挂载到 window（且 window.Storage 原生指向浏览器 Storage 构造器），显式覆盖
window.Storage = Storage;
