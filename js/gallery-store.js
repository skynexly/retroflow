/**
 * 溯流计划 · 图库数据层 (Gallery Store)
 * 职责：
 *   1. 生图产出的每一张图，在生成瞬间就归档入库（与「是否设为头像」完全解耦）
 *   2. 图片本体存 IndexedDB assets（gen/avatar.<id>），元数据索引走 Store 的 meta 域
 *   3. 提供列表读取、批量删除、容量统计
 *
 * 设计要点：
 *   - 入库时机在生成成功的那一刻，用户后续换头像、删头像都不影响归档，
 *     这正是为了兜住「当时没来得及存图」的场景。
 *   - 索引与本体分离：读列表只走内存里的轻量索引数组，
 *     不会把所有 Blob 一次性拉进内存。
 */
const GalleryStore = (() => {
  'use strict';

  const ASSET_PREFIX = DataRegistry.prefix.genAvatar;

  // 顶层分类：主动生图归档 vs 对话流影像
  //  - image-gen  图像生成：绘像工坊及未来独立生图入口的产出，防「生成后忘存找不到」
  //  - chat-cache 对话缓存：聊天流里的图（执行员发的 + 对方生成的），按对话对象分相册
  const CATEGORIES = {
    'image-gen': { zh: '图像生成', en: 'IMAGE GEN' },
    'chat-cache': { zh: '对话缓存', en: 'CHAT CACHE' }
  };

  // 系统助手不区分人格，共用一条对话流，归属主键固定为该稳定值
  const SYSTEM_ASSISTANT_OWNER_ID = 'system';

  // 来源标签映射：区分图片方向 / 用途，用于大图元信息与下载文件名，不再承担相册归属
  const SOURCE_LABELS = {
    persona: { zh: '执行员立绘', en: 'ENVOY' },
    mask: { zh: '马甲头像', en: 'MASK' },
    character: { zh: '角色立绘', en: 'CHARACTER' },
    npc: { zh: 'NPC 立绘', en: 'NPC' },
    'assistant-generation': { zh: '对方生成', en: 'GENERATED' },
    'system-chat': { zh: '执行员上传', en: 'UPLOADED' },
    'online-chat': { zh: '联络上传', en: 'ONLINE' },
    'fork-run': { zh: '推演上传', en: 'DIVE' },
    unknown: { zh: '图像生成', en: 'GENERATED' }
  };

  // 旧数据没有 category / ownerType 字段，按 source 反推，保证升级后归属正确。
  //  - assistant-generation / system-chat 都是系统助手对话流里的图 → 对话缓存 / 系统助手
  //  - 其余（persona / mask / character / npc / unknown）都是主动生图归档 → 图像生成
  function inferOwnership(entry) {
    const src = entry && entry.source;
    if (src === 'fork-run') {
      return {
        category: 'chat-cache',
        ownerType: 'fork',
        ownerId: entry.ownerId || 'fork-unknown',
        ownerName: entry.ownerName || '世界线推演'
      };
    }
    if (src === 'assistant-generation' || src === 'system-chat' || src === 'online-chat') {
      return {
        category: 'chat-cache',
        ownerType: 'assistant',
        ownerId: SYSTEM_ASSISTANT_OWNER_ID,
        ownerName: entry.ownerName || entry.assistantName || '系统助手'
      };
    }
    return {
      category: 'image-gen',
      ownerType: null,
      ownerId: null,
      ownerName: null
    };
  }

  /* ---------------- 索引读写 ---------------- */

  function readIndex() {
    return (Store.meta.galleryIndex || []).slice();
  }

  function writeIndex(list) {
    return Store.save('meta.galleryIndex', list);
  }

  /* ---------------- 工具 ---------------- */

  function makeId() {
    return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
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

  /** 各类图源统一收敛成 Blob，避免 dataURL 的 base64 膨胀 */
  async function toBlob(src) {
    if (src instanceof Blob) return src;
    if (typeof src !== 'string') return null;
    try {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      return await resp.blob();
    } catch (err) {
      return null;
    }
  }

  /* ---------------- 归档入库 ---------------- */

  /**
   * 归档一张生成图。生成成功即调用，与后续是否应用为头像无关。
   * @param {Blob|string} src 图片 Blob、dataURL 或远端 URL
   * @param {{source?: string, chatRecordId?: string, category?: string, ownerType?: string, ownerId?: string, ownerName?: string}} [meta]
   *   source     图片来源方向（沿用旧值，用于大图元信息与下载文件名）
   *   category   顶层分类：image-gen（主动生图归档）/ chat-cache（对话流影像），缺省按 source 反推
   *   ownerType  对话缓存专用：assistant / character
   *   ownerId    对话缓存归属主键（稳定值）；系统助手固定 'system'
   *   ownerName  归档时的对话对象名称快照
   * @returns {Promise<object|null>} 入库后的元数据条目
   */
  async function record(src, meta) {
    const blob = await toBlob(src);
    if (!blob) {
      console.warn('[GalleryStore] 无法解析图源，跳过归档');
      return null;
    }

    const id = makeId();
    const source = (meta && meta.source) || 'unknown';
    const entry = {
      id,
      key: ASSET_PREFIX + id,
      source: SOURCE_LABELS[source] ? source : 'unknown',
      createdAt: Date.now(),
      size: blob.size,
      mime: blob.type || 'image/png',
      chatRecordId: meta && meta.chatRecordId ? String(meta.chatRecordId) : null
    };

    // 归属：优先用调用方显式声明，否则按 source 反推（兼容未升级的调用点）
    const inferred = inferOwnership(entry);
    entry.category = (meta && CATEGORIES[meta.category]) ? meta.category : inferred.category;
    if (entry.category === 'chat-cache') {
      entry.ownerType = (meta && meta.ownerType) || inferred.ownerType || 'assistant';
      entry.ownerId = (meta && meta.ownerId) ? String(meta.ownerId) : (inferred.ownerId || SYSTEM_ASSISTANT_OWNER_ID);
      entry.ownerName = (meta && meta.ownerName) ? String(meta.ownerName) : (inferred.ownerName || '系统助手');
    } else {
      entry.ownerType = null;
      entry.ownerId = null;
      entry.ownerName = null;
    }

    await Storage.setAsset(entry.key, blob);

    // 最新的排最前
    const list = readIndex();
    list.unshift(entry);
    await writeIndex(list);

    return entry;
  }

  /* ---------------- 列表与统计 ---------------- */

  /**
   * 读取归档列表（已按时间倒序），附带展示用字段。
   * 旧条目缺 category / ownerXxx 时按 source 兜底反推，读时补齐不回写。
   * @returns {Array<object>}
   */
  function list() {
    return readIndex().map((entry) => {
      const label = SOURCE_LABELS[entry.source] || SOURCE_LABELS.unknown;
      const size = formatSize(entry.size);
      const inferred = inferOwnership(entry);
      const category = CATEGORIES[entry.category] ? entry.category : inferred.category;
      const ownerType = entry.ownerType || (category === 'chat-cache' ? inferred.ownerType : null);
      const ownerId = entry.ownerId || (category === 'chat-cache' ? inferred.ownerId : null);
      const ownerName = entry.ownerName || (category === 'chat-cache' ? inferred.ownerName : null);
      const catLabel = CATEGORIES[category] || CATEGORIES['image-gen'];
      return Object.assign({}, entry, {
        category,
        ownerType,
        ownerId,
        ownerName,
        categoryZh: catLabel.zh,
        categoryEn: catLabel.en,
        timeText: formatTime(entry.createdAt),
        dateShort: formatTime(entry.createdAt).slice(5, 10),
        sourceZh: label.zh,
        sourceEn: label.en,
        sizeText: `${size.value} ${size.unit}`
      });
    });
  }
  /** 按图库编号读取轻量元数据 */
  function getEntry(id) {
    return readIndex().find((entry) => entry && String(entry.id) === String(id)) || null;
  }

  /** 读取图库资产本体，调用方必须校验 Blob 后再写入其他资产域 */
  async function getBlob(id) {
    const entry = getEntry(id);
    if (!entry || !entry.key || !Storage.getAssetRaw) {
      console.warn('[GalleryStore] getBlob 未命中条目：', id);
      return null;
    }
    const raw = await Storage.getAssetRaw(entry.key);
    if (!raw || raw.type !== 'blob' || !(raw.data instanceof Blob)) {
      console.warn('[GalleryStore] getBlob 命中条目但 Blob 已失效：', id, entry.key);
      return null;
    }
    return raw.data;
  }

  /** 取一张图的可显示 src（objectURL，用完请 revoke） */
  async function getSrc(id) {
    const entry = getEntry(id);
    if (!entry) return null;
    return Storage.getAssetSrc(entry.key);
  }


  /** 数量与总体积统计 */
  function getStats() {
    const all = readIndex();
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

  /**
   * 批量删除：先移除 IndexedDB 本体，再更新索引
   * @param {string[]} ids
   * @returns {Promise<number>} 实际删除条数
   */
  async function remove(ids, options) {
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    const target = new Set(ids);
    const list = readIndex();
    const keep = [];
    let removed = 0;

    for (const entry of list) {
      if (target.has(entry.id)) {
        try {
          await Storage.removeAsset(entry.key);
          removed += 1;
        } catch (err) {
          console.warn('[GalleryStore] 删除资源失败：', entry.key, err);
          keep.push(entry);
        }
      } else {
        keep.push(entry);
      }
    }

    await writeIndex(keep);

    // 图库删除只释放媒体资产。通知聊天页把原图位置切换为占位卡，
    // 不删除聊天记录中的 visionDescription，因此既有语义上下文完整保留。
    const releasedChatIds = list
      .filter(entry => target.has(entry.id) && (entry.source === 'system-chat' || entry.source === 'assistant-generation' || entry.source === 'online-chat') && entry.chatRecordId)
      .map(entry => entry.chatRecordId);
    if (releasedChatIds.length && !(options && options.silentChatRelease)) {
      window.dispatchEvent(new CustomEvent('retroflow:gallery-assets-released', {
        detail: { chatRecordIds: releasedChatIds }
      }));
    }
    return removed;
  }

  /** 聊天页彻底删除图片消息时，同步清除关联图库资产。 */
  async function removeByChatRecordIds(recordIds) {
    const target = new Set((recordIds || []).filter(Boolean).map(String));
    if (!target.size) return 0;
    const ids = readIndex()
      .filter(entry => entry.chatRecordId && target.has(String(entry.chatRecordId)))
      .map(entry => entry.id);
    return remove(ids, { silentChatRelease: true });
  }

  /**
   * 与 IndexedDB 实际内容对账，清掉索引里已失效的孤儿条目。
   * 用于跨版本升级或异常中断后的自愈。
   */
  async function reconcile() {
    const keys = await Storage.listAssetKeys(ASSET_PREFIX);
    const alive = new Set(keys);
    const list = readIndex();
    const keep = list.filter((e) => alive.has(e.key));
    if (keep.length !== list.length) {
      await writeIndex(keep);
    }
    return { before: list.length, after: keep.length };
  }

  return {
    record,
    list,
    getEntry,
    getBlob,
    getSrc,
    getStats,
    remove,
    removeByChatRecordIds,
    reconcile,
    SOURCE_LABELS,
    CATEGORIES,
    SYSTEM_ASSISTANT_OWNER_ID,
    ASSET_PREFIX
  };
})();

window.GalleryStore = GalleryStore;

// 向注册表声明生成档案域在用的资产键（全部归档条目）
DataRegistry.registerUsageProvider('gallery', () => GalleryStore.list().map((e) => e.key));