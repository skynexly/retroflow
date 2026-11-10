/**
 * 溯流计划 · 存储层
 *
 * IndexedDB 三个 object store，按访问模式划分：
 *   assets   图片等二进制资源，存 Blob（容量大、无 Base64 膨胀）
 *   docs     配置类文本，有界小数据（身份、马甲、角色卡、主题配置），全量装载
 *   records  流水类记录，无界增长（副本记录、聊天历史），只按索引取切片
 *   memories 记忆库专属流水（事件记忆/角色记忆同库不同型），带关键词与在场角色反查索引
 *   assistantMemories 助手记忆（对你的记忆、自我认知等六类），所有助手共用一份，
 *            与副本记忆分库，规范见 design/助手记忆提取规范.md
 *   memoryVectors 全部记忆种类共用的向量表（v5）。主键 key = `${source}:${id}`，
 *            source 区分记忆种类（本期只有 assistant）。向量与记忆本体分表，
 *            记忆库页面读取记忆时不会把大量浮点数组一并读进内存。
 *
 * records 本轮只建 schema 不写业务逻辑，等副本功能落地时再接。
 * 一次性把版本号推到位，避免以后再升 schema。
 */
const Storage = (() => {
  const DB_NAME = 'retroflow';
  const DB_VERSION = 5;
  const STORE_ASSETS = 'assets';
  const STORE_DOCS = 'docs';
  const STORE_RECORDS = 'records';
  const STORE_MEMORIES = 'memories';
  const STORE_ASSISTANT_MEMORIES = 'assistantMemories';
  const STORE_MEMORY_VECTORS = 'memoryVectors';
  /** 助手记忆在向量表里的 source 名，与 memory-vectors.js 的登记名一致 */
  const ASSISTANT_VECTOR_SOURCE = 'assistant';
  /** 允许数据管理整表导入导出的记忆表（向量表不导出，导入后重新生成） */
  const BACKUP_STORES = Object.freeze([STORE_MEMORIES, STORE_ASSISTANT_MEMORIES]);

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

        // v4 助手记忆：与副本记忆分库，所有助手共用一份。
        // 只新建本 store，不触碰已有 store，老用户升级时现有数据不受影响。
        if (!db.objectStoreNames.contains(STORE_ASSISTANT_MEMORIES)) {
          const asstMem = db.createObjectStore(STORE_ASSISTANT_MEMORIES, { keyPath: 'id' });
          asstMem.createIndex('by_category', 'category');
          asstMem.createIndex('by_keywords', 'keywords', { multiEntry: true });
        }

        // v5 统一向量表：全部记忆种类共用，主键 key = `${source}:${id}`
        if (!db.objectStoreNames.contains(STORE_MEMORY_VECTORS)) {
          const vectors = db.createObjectStore(STORE_MEMORY_VECTORS, { keyPath: 'key' });
          // source 索引：按记忆种类扫描全部向量（如删除/补算某种记忆的向量）
          vectors.createIndex('by_source', 'source');
          // 复合索引：按 (source, modelName) 筛选待更新的失效向量（换模型后）
          vectors.createIndex('by_source_model', ['source', 'modelName']);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        // 其他标签页（或新版本）请求升级时主动让出连接，避免升级被本连接卡住。
        // 关闭后清空缓存的 promise，下次读写会按新版本重新打开。
        db.onversionchange = () => {
          try { db.close(); } catch (_) { /* ignore */ }
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
      // 旧连接让出后 onsuccess 仍会触发；这里只留日志，不提前失败。
      request.onblocked = () => {
        console.warn('[Storage] 数据库升级被其他标签页的旧连接阻塞，等待其关闭');
      };
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
   * 读取一条配置文本，读取失败时抛错。
   * 供「不存在」与「读取失败」必须区分的场景使用（如记忆提取进度点）。
   * @returns {Promise<any>} 不存在时返回 undefined
   */
  async function getDocOrThrow(key) {
    return await withAnyStore(STORE_DOCS, 'readonly', (store) => store.get(key));
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

  /* ---------------- 助手记忆（IndexedDB assistantMemories） ----------------
     底层通道，业务读写统一走 AssistantMemoryStore。 */

  /** 写入/更新一条助手记忆（需含 id 与 category） */
  async function putAssistantMemory(record) {
    if (!record || !record.id) throw new Error('助手记忆缺少 id');
    if (!record.category) throw new Error('助手记忆缺少 category');
    await withAnyStore(STORE_ASSISTANT_MEMORIES, 'readwrite', (store) => store.put(record));
    return record;
  }

  /** 批量写入：同一事务，全部成功才提交 */
  async function putAssistantMemories(records) {
    const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id && r.category);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSISTANT_MEMORIES, 'readwrite');
      const store = tx.objectStore(STORE_ASSISTANT_MEMORIES);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 助手记忆批量写入已中止'));
      try {
        list.forEach((r) => store.put(r));
      } catch (err) {
        // 同步抛错（如数据无法序列化）时必须中止事务，否则已排队的写入仍会提交
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return list.length;
  }

  /** 读取全部助手记忆；读取失败会抛错，调用方据此区分「空库」与「读取失败」 */
  async function getAllAssistantMemories() {
    return await withAnyStore(STORE_ASSISTANT_MEMORIES, 'readonly', (store) => store.getAll()) || [];
  }

  /** 删除一条助手记忆 */
  async function removeAssistantMemory(id) {
    await withAnyStore(STORE_ASSISTANT_MEMORIES, 'readwrite', (store) => store.delete(id));
    return true;
  }

  /** 批量删除：同一事务 */
  async function removeAssistantMemories(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSISTANT_MEMORIES, 'readwrite');
      const store = tx.objectStore(STORE_ASSISTANT_MEMORIES);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 助手记忆批量删除已中止'));
      try {
        list.forEach((id) => store.delete(id));
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return list.length;
  }

  /**
   * 写入与删除放进同一事务：保存一条并淘汰最早记录时，要么全部生效，要么全部不生效。
   * 可附带 docs 写入（如记忆提取进度点），与记忆在同一事务内提交。
   * @param {Array<object>} records 要写入的记录（需含 id 与 category）
   * @param {Array<string>} deleteIds 要删除的 id
   * @param {Array<{key: string, value: any}>} [docPuts] 同事务写入的配置文本
   */
  async function commitAssistantMemories(records, deleteIds, docPuts) {
    const puts = (Array.isArray(records) ? records : []).filter((r) => r && r.id && r.category);
    const dels = (Array.isArray(deleteIds) ? deleteIds : []).filter(Boolean);
    const docs = (Array.isArray(docPuts) ? docPuts : []).filter((d) => d && typeof d.key === 'string' && d.key);
    if (!puts.length && !dels.length && !docs.length) return { put: 0, removed: 0, docs: 0 };
    const db = await openDB();
    const storeNames = [STORE_ASSISTANT_MEMORIES];
    if (docs.length) storeNames.push(STORE_DOCS);
    // 删除记忆时同事务删掉对应向量，不留残留
    const withVectors = dels.length > 0 && db.objectStoreNames.contains(STORE_MEMORY_VECTORS);
    if (withVectors) storeNames.push(STORE_MEMORY_VECTORS);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, 'readwrite');
      const store = tx.objectStore(STORE_ASSISTANT_MEMORIES);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 助手记忆提交已中止'));
      try {
        puts.forEach((r) => store.put(r));
        dels.forEach((id) => store.delete(id));
        if (docs.length) {
          const docStore = tx.objectStore(STORE_DOCS);
          docs.forEach((d) => docStore.put(d.value, d.key));
        }
        if (withVectors) {
          const vecStore = tx.objectStore(STORE_MEMORY_VECTORS);
          dels.forEach((id) => vecStore.delete(`${ASSISTANT_VECTOR_SOURCE}:${id}`));
        }
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return { put: puts.length, removed: dels.length, docs: docs.length };
  }

  /* ---------------- 向量表（IndexedDB memoryVectors） ----------------
     统一向量存储，全部记忆种类共用。主键 key = `${source}:${id}`。
     记录结构：{ key, source, recordId, modelName, dim, textHash, vector, createdAt }
     业务读写统一走 MemoryVectors 模块。 */

  /** 写入或更新一条向量记录 */
  async function putVector(record) {
    if (!record || !record.key) throw new Error('向量记录缺少 key');
    await withAnyStore(STORE_MEMORY_VECTORS, 'readwrite', (store) => store.put(record));
    return record;
  }

  /** 批量写入向量：同一事务，全部成功才提交 */
  async function putVectors(records) {
    const list = (Array.isArray(records) ? records : []).filter((r) => r && r.key);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEMORY_VECTORS, 'readwrite');
      const store = tx.objectStore(STORE_MEMORY_VECTORS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 向量批量写入已中止'));
      try {
        list.forEach((r) => store.put(r));
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return list.length;
  }

  /** 读取单条向量 */
  async function getVector(key) {
    return await withAnyStore(STORE_MEMORY_VECTORS, 'readonly', (store) => store.get(key));
  }

  /** 按 source 读取全部向量（供查漏补缺和删除通知使用） */
  async function getVectorsBySource(source) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEMORY_VECTORS, 'readonly');
      const store = tx.objectStore(STORE_MEMORY_VECTORS);
      const index = store.index('by_source');
      const req = index.getAll(source);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** 删除单条向量 */
  async function removeVector(key) {
    await withAnyStore(STORE_MEMORY_VECTORS, 'readwrite', (store) => store.delete(key));
    return true;
  }

  /** 批量删除向量：同一事务 */
  async function removeVectors(keys) {
    const list = (Array.isArray(keys) ? keys : []).filter(Boolean);
    if (!list.length) return 0;
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEMORY_VECTORS, 'readwrite');
      const store = tx.objectStore(STORE_MEMORY_VECTORS);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 向量批量删除已中止'));
      try {
        list.forEach((k) => store.delete(k));
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return list.length;
  }

  /** 清空某个 source 的全部向量 */
  async function clearVectorsBySource(source) {
    const vectors = await getVectorsBySource(source);
    if (!vectors.length) return 0;
    const keys = vectors.map((v) => v.key);
    await removeVectors(keys);
    return vectors.length;
  }

  /** 清空全部向量（导入或清理记忆后调用，之后由总按钮重新生成） */
  async function clearAllVectors() {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_MEMORY_VECTORS)) return 0;
    const count = await withAnyStore(STORE_MEMORY_VECTORS, 'readonly', (store) => store.count()) || 0;
    if (count) await withAnyStore(STORE_MEMORY_VECTORS, 'readwrite', (store) => store.clear());
    return count;
  }

  /* ---------------- 记忆表整表备份（数据管理「记忆」块使用） ---------------- */

  function assertBackupStore(name) {
    if (BACKUP_STORES.indexOf(name) === -1) throw new Error(`不允许整表备份的表：${name}`);
  }

  /** 读取整张记忆表；读取失败会抛错，导出时不能把失败当成空表 */
  async function getAllFromBackupStore(name) {
    assertBackupStore(name);
    return await withAnyStore(name, 'readonly', (store) => store.getAll()) || [];
  }

  /** 统计整张记忆表条数 */
  async function countBackupStore(name) {
    assertBackupStore(name);
    return await withAnyStore(name, 'readonly', (store) => store.count()) || 0;
  }

  /**
   * 覆盖式写入一张记忆表：同一事务内先清空再写入，要么全部成功，要么保持原样。
   * records 为空数组时等于清空该表。
   */
  async function replaceBackupStore(name, records) {
    assertBackupStore(name);
    const list = (Array.isArray(records) ? records : []).filter((r) => r && r.id);
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(name, 'readwrite');
      const store = tx.objectStore(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error(`IndexedDB ${name} 覆盖写入已中止`));
      try {
        store.clear();
        list.forEach((r) => store.put(r));
      } catch (err) {
        try { tx.abort(); } catch (_) { /* ignore */ }
        reject(err);
      }
    });
    return list.length;
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
    getDocOrThrow,
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
    putAssistantMemory,
    putAssistantMemories,
    getAllAssistantMemories,
    removeAssistantMemory,
    removeAssistantMemories,
    commitAssistantMemories,
    putVector,
    putVectors,
    getVector,
    getVectorsBySource,
    removeVector,
    removeVectors,
    clearVectorsBySource,
    clearAllVectors,
    BACKUP_STORES,
    getAllFromBackupStore,
    countBackupStore,
    replaceBackupStore,
    compressImage
  };
})();

// 顶层 const 不会自动挂载到 window（且 window.Storage 原生指向浏览器 Storage 构造器），显式覆盖
window.Storage = Storage;
