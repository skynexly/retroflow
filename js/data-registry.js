/**
 * ============================================================================
 * 溯流计划 · 数据域注册表 (Data Registry)
 *
 * 统一管理两类存储的「逻辑分域」，让清存储时能按类别处理：
 *   资产侧 (IndexedDB assets)：图片等二进制资源
 *   文本侧 (IndexedDB docs)   ：配置类文本，实际数据由 Store 持有
 *
 * 域划分（资产与文本共用同一套域名，一个面板就能看全）：
 *   gen     生成档案：AI 生图的历史归档，只增不改，用户在图库主动删才消失
 *   envoy   执行员身份：用户自己的立绘与马甲（含分身），跟随档案
 *   roster  角色档案：角色卡与 NPC 的立绘（他人），跟随所属角色
 *   decor   美化资源：桌面装饰、壁纸、字体、红卡文本，可随时清空重设
 *   memo    随身便笺：独立成域，为后续扩展留空间
 *   config  系统配置：API 槽位等
 *   meta    系统内务：索引与迁移标记
 *   fork    副本库：副本卷宗、油画墙索引与副本封面
 *
 * 域前缀带斜杠，斜杠不会出现在任何业务 id 里，前缀扫描零误伤。
 *
 * 使用约定：
 *   资产键名统一走 DataRegistry.key.xxx()；
 *   配置类数据统一走 Store，不要直接拼 docs 键名。
 * ============================================================================
 */
const DataRegistry = (() => {
  'use strict';

  /* ---------------- 域定义 ---------------- */

  const DOMAINS = {
    gen: {
      prefix: 'gen/',
      zh: '生成档案',
      en: 'GENERATED',
      desc: 'AI 生图的历史归档，仅在图库中主动删除',
      // 归档删除要同步图库索引，不提供整域清空
      assetClearable: false,
      hasText: false
    },
    envoy: {
      prefix: 'envoy/',
      zh: '执行员身份',
      en: 'ENVOY',
      desc: '个人档案与马甲库的立绘、面容与身份数据',
      // 整域清空会打断身份数据完整性，只允许孤儿回收
      assetClearable: false,
      hasText: true
    },
    roster: {
      prefix: 'roster/',
      zh: '角色档案',
      en: 'ROSTER',
      desc: '角色卡与 NPC 的立绘、面容与设定数据',
      assetClearable: false,
      hasText: true
    },
    decor: {
      prefix: 'decor/',
      zh: '美化资源',
      en: 'DECOR',
      desc: '桌面装饰、壁纸、自定义字体与红卡文本，可随时清空重设',
      assetClearable: true,
      hasText: true
    },
    memo: {
      prefix: 'memo/',
      zh: '随身便笺',
      en: 'MEMO',
      desc: '战术速记内容',
      assetClearable: true,
      hasText: true
    },
    config: {
      prefix: 'config/',
      zh: '系统配置',
      en: 'CONFIG',
      desc: 'API 槽位等与内容无关的设置',
      assetClearable: false,
      hasText: true
    },
    online: {
      prefix: 'online/',
      zh: '线上联络',
      en: 'ONLINE',
      desc: '线上账号头像、联系人自定义头像、朋友圈配图与美化素材',
      // 联系人与档案级联绑定，整域清空会让通讯录与会话错位
      assetClearable: false,
      hasText: true
    },
    meta: {
      prefix: 'meta/',
      zh: '系统内务',
      en: 'META',
      desc: '索引与迁移标记，清理会导致数据错位',
      assetClearable: false,
      hasText: true
    },
    doc: {
      prefix: 'doc/',
      zh: '文件区',
      en: 'DOCS',
      desc: '执行员上传的文本文件本体，可在文件区主动删除',
      assetClearable: true,
      hasText: true
    },
    fork: {
      prefix: 'fork/',
      zh: '副本库',
      en: 'FORK',
      desc: '副本卷宗、油画墙索引与副本封面，封面归副本自身管理',
      // 封面与卷宗一一对应，整域清空会让油画墙画框失图，走副本删除逻辑
      assetClearable: false,
      hasText: true
    },
    run: {
      prefix: 'run/',
      zh: '下潜记录',
      en: 'DIVE LOG',
      desc: '副本推演存档：每条下潜线的进度、状态与结算总结，以及正史指针',
      // 与 fork 域刻意分开：删一次游玩记录是正常操作，删卷宗是毁掉创作。
      // 两者的可清理性完全相反，放同一域清理策略没法分开写。
      assetClearable: true,
      hasText: true
    },
    sysChat: {
      prefix: 'sysChat/',
      zh: '助手对话',
      en: 'SYS CHAT',
      desc: '系统助手的多对话索引与会话元信息（标题、活跃时间、消息数）',
      // 语义同 run 域：删一个对话窗是正常操作，不牵连助手档案本身
      assetClearable: true,
      hasText: true
    },
    memory: {
      prefix: 'memory/',
      zh: '记忆库',
      en: 'MEMORY BANK',
      desc: '事件记忆与角色记忆的元配置（提取开关、预算参数），记忆本体存于 memories 流水库',
      // 记忆是叙事沉淀，整域清空等于抹除因果，不允许一键清
      assetClearable: false,
      hasText: true
    }
  };

  const DOMAIN_IDS = Object.keys(DOMAINS);

  /* ---------------- 资产键构造器 ---------------- */

  const key = {
    // —— gen 域 ——
    /** 生图归档本体 */
    genAvatar: (id) => `${DOMAINS.gen.prefix}avatar.${id}`,
    // —— doc 域（文件区文本文件本体）——
    /** 文件区文本文件本体 */
    docFile: (id) => `${DOMAINS.doc.prefix}file.${id}`,

    // —— fork 域（副本库）——
    /** 副本封面（16:9 装裱图，归副本自身管理，不混入图库生图） */
    forkCover: (forkId) => `${DOMAINS.fork.prefix}cover.${forkId}`,

    // —— run 域（下潜记录 / 推演存档）——
    /** 某副本的下潜记录索引：存 runId 列表与正史指针 canonicalRunId */
    runIndex: (forkId) => `${DOMAINS.run.prefix}index.${forkId}`,
    /** 单条下潜线的存档本体（状态、进度、participants、结算总结） */
    runDoc: (runId) => `${DOMAINS.run.prefix}doc.${runId}`,
    /** 助手多对话索引（全局唯一一份：convId 列表 + 当前活跃 convId） */
    sysChatIndex: () => `${DOMAINS.sysChat.prefix}index`,
    /** 单条助手对话的元信息（标题 / 时间 / 消息数） */
    sysChatDoc: (convId) => `${DOMAINS.sysChat.prefix}doc.${convId}`,

    // —— memory 域（记忆库元配置）——
    /** 记忆库全局配置（提取开关、预算参数、播种标记） */
    memoryConfig: () => `${DOMAINS.memory.prefix}config`,

    // —— envoy 域（用户自己，含马甲分身）——
    /** 个人档案立绘 */
    personaAvatar: () => `${DOMAINS.envoy.prefix}persona.avatar`,
    /** 个人档案 FACE ID 参考图 */
    personaFaceId: () => `${DOMAINS.envoy.prefix}persona.face_id`,
    /** 马甲立绘 */
    maskAvatar: (id) => `${DOMAINS.envoy.prefix}mask.avatar.${id}`,
    /** 马甲 FACE ID */
    maskFaceId: (id) => `${DOMAINS.envoy.prefix}mask.face_id.${id}`,

    // —— roster 域（他人）——
    /** 角色档案立绘 */
    charAvatar: (id) => `${DOMAINS.roster.prefix}char.avatar.${id}`,
    /** 角色档案 FACE ID */
    charFaceId: (id) => `${DOMAINS.roster.prefix}char.face_id.${id}`,
    /** 助手档案立绘 */
    assistantAvatar: (id) => `${DOMAINS.roster.prefix}assistant.avatar.${id}`,
    /** 助手档案 FACE ID */
    assistantFaceId: (id) => `${DOMAINS.roster.prefix}assistant.face_id.${id}`,
    /** NPC 立绘 */
    npcAvatar: (id) => `${DOMAINS.roster.prefix}npc.avatar.${id}`,

    // —— decor 域 ——
    /** 桌面红卡照片（独立装饰位，与个人档案头像互不相干） */
    profileCard: () => `${DOMAINS.decor.prefix}desktop.profile_card`,
    /** 桌面第二页图库相框封面 */
    galleryCover: () => `${DOMAINS.decor.prefix}desktop.gallery_cover`,
    /** 全局壁纸 */
    wallpaper: () => `${DOMAINS.decor.prefix}theme.wallpaper`,
    /** 桌面磁贴自定义背景（图标美化：按卡片 appId 存背景大图） */
    tileBg: (id) => `${DOMAINS.decor.prefix}desktop.tile_bg.${id}`,
    /** 桌面磁贴自定义图标（图标美化：按卡片 appId 存图标图） */
    tileIcon: (id) => `${DOMAINS.decor.prefix}desktop.tile_icon.${id}`,
    /** 悬浮球皮肤 · 常态图（悬浮球美化：原样存储，支持 GIF 动图） */
    orbSkinNormal: () => `${DOMAINS.decor.prefix}orb.skin_normal`,
    /** 悬浮球皮肤 · 拖拽态图（悬浮球美化：缺省时两态共用常态图） */
    orbSkinDrag: () => `${DOMAINS.decor.prefix}orb.skin_drag`,
    chatWallpaper: (slot) => `${DOMAINS.decor.prefix}chat.wallpaper.${slot || 'system'}`,
    /** 自定义字体文件 */
    font: (id) => `${DOMAINS.decor.prefix}theme.font.${id}`,

    // —— online 域（线上联络）——
    /** 线上账号头像（accountId 为 'persona' 或马甲 id） */
    onlineAccountAvatar: (accountId) => `${DOMAINS.online.prefix}account.avatar.${accountId}`,
    /** 线上账号封面（个人主页顶部横幅） */
    onlineAccountCover: (accountId) => `${DOMAINS.online.prefix}account.cover.${accountId}`,
    /** 联系人自定义头像（覆盖档案立绘时才有，缺省则实时读 roster） */
    onlineContactAvatar: (contactId) => `${DOMAINS.online.prefix}contact.avatar.${contactId}`,
    /** 朋友圈配图 */
    onlineFeedImage: (feedId, index) => `${DOMAINS.online.prefix}feed.image.${feedId}.${index || 0}`,
    /** 线上会话壁纸 */
    onlineChatWallpaper: (sessionId) => `${DOMAINS.online.prefix}chat.wallpaper.${sessionId}`,
    /** 美化库素材（气泡皮肤、主题包等） */
    onlineDecorAsset: (id) => `${DOMAINS.online.prefix}decor.asset.${id}`
  };

  /** 各类资产的前缀常量，供需要批量扫描的场景使用 */
  const prefix = {
    gen: DOMAINS.gen.prefix,
    envoy: DOMAINS.envoy.prefix,
    roster: DOMAINS.roster.prefix,
    decor: DOMAINS.decor.prefix,
    genAvatar: `${DOMAINS.gen.prefix}avatar.`,
    docFile: `${DOMAINS.doc.prefix}file.`,
    fork: DOMAINS.fork.prefix,
    forkCover: `${DOMAINS.fork.prefix}cover.`,
    run: DOMAINS.run.prefix,
    runIndex: `${DOMAINS.run.prefix}index.`,
    runDoc: `${DOMAINS.run.prefix}doc.`,
    sysChat: DOMAINS.sysChat.prefix,
    sysChatDoc: `${DOMAINS.sysChat.prefix}doc.`,
    memory: DOMAINS.memory.prefix,
    maskAvatar: `${DOMAINS.envoy.prefix}mask.avatar.`,
    maskFaceId: `${DOMAINS.envoy.prefix}mask.face_id.`,
    charAvatar: `${DOMAINS.roster.prefix}char.avatar.`,
    charFaceId: `${DOMAINS.roster.prefix}char.face_id.`,
    assistantAvatar: `${DOMAINS.roster.prefix}assistant.avatar.`,
    assistantFaceId: `${DOMAINS.roster.prefix}assistant.face_id.`,
    npcAvatar: `${DOMAINS.roster.prefix}npc.avatar.`,
    font: `${DOMAINS.decor.prefix}theme.font.`,
    online: DOMAINS.online.prefix,
    onlineAccountAvatar: `${DOMAINS.online.prefix}account.avatar.`,
    onlineAccountCover: `${DOMAINS.online.prefix}account.cover.`,
    onlineContactAvatar: `${DOMAINS.online.prefix}contact.avatar.`,
    onlineFeedImage: `${DOMAINS.online.prefix}feed.image.`,
    onlineChatWallpaper: `${DOMAINS.online.prefix}chat.wallpaper.`,
    onlineDecorAsset: `${DOMAINS.online.prefix}decor.asset.`
  };

  /* ---------------- 归类与枚举 ---------------- */

  /** 判断一个键属于哪个域，未匹配返回 null（视为未分类遗留数据） */
  function domainOf(anyKey) {
    const k = String(anyKey || '');
    for (const id of DOMAIN_IDS) {
      if (k.startsWith(DOMAINS[id].prefix)) return id;
    }
    return null;
  }

  /** 列举某一域下的所有资产键名 */
  async function listAssetsByDomain(domainId) {
    const domain = DOMAINS[domainId];
    if (!domain) return [];
    try {
      return await Storage.listAssetKeys(domain.prefix);
    } catch (err) {
      console.warn('[DataRegistry] 枚举资产域失败：', domainId, err);
      return [];
    }
  }

  /** 列举某一域下的所有配置键名 */
  async function listDocsByDomain(domainId) {
    const domain = DOMAINS[domainId];
    if (!domain) return [];
    try {
      return await Storage.listDocKeys(domain.prefix);
    } catch (err) {
      console.warn('[DataRegistry] 枚举配置域失败：', domainId, err);
      return [];
    }
  }

  /** 列举所有不属于任何已知域的资产键 */
  async function listUnclassifiedAssets() {
    try {
      const all = await Storage.listAssetKeys();
      return all.filter((k) => domainOf(k) === null);
    } catch (err) {
      return [];
    }
  }

  /** 列举所有不属于任何已知域的配置键 */
  async function listUnclassifiedDocs() {
    try {
      const all = await Storage.listDocKeys();
      return all.filter((k) => domainOf(k) === null);
    } catch (err) {
      return [];
    }
  }

  /* ---------------- 体积统计 ---------------- */

  /** 字节数转可读体积 */
  function formatSize(bytes) {
    if (!bytes || bytes < 1024) return { value: String(bytes || 0), unit: 'B' };
    if (bytes < 1024 * 1024) return { value: (bytes / 1024).toFixed(0), unit: 'KB' };
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: 'MB' };
  }

  /**
   * 取单条资产占用字节数。
   * 只读 size 字段，不持有 Blob 引用，避免统计时把整库拉进内存。
   */
  async function assetSizeOf(assetKey) {
    try {
      const raw = await Storage.getAssetRaw(assetKey);
      if (!raw) return 0;
      if (raw.data instanceof Blob) return raw.data.size;
      // 远端 URL 字符串按字符长度粗算，量级极小
      if (typeof raw.data === 'string') return raw.data.length;
      return 0;
    } catch (err) {
      return 0;
    }
  }

  /** 取单条配置的近似字节数（序列化后的长度） */
  async function docSizeOf(docKey) {
    try {
      const value = await Storage.getDoc(docKey, null);
      if (value === null || value === undefined) return 0;
      if (typeof value === 'string') return value.length * 2; // UTF-16
      return JSON.stringify(value).length * 2;
    } catch (err) {
      return 0;
    }
  }

  /**
   * 统计单域的资产与配置占用
   * @returns {Promise<object>}
   */
  async function getDomainStats(domainId) {
    const domain = DOMAINS[domainId];

    const assetKeys = await listAssetsByDomain(domainId);
    let assetBytes = 0;
    for (const k of assetKeys) {
      assetBytes += await assetSizeOf(k);
    }

    const docKeys = domain && domain.hasText ? await listDocsByDomain(domainId) : [];
    let docBytes = 0;
    for (const k of docKeys) {
      docBytes += await docSizeOf(k);
    }

    const totalBytes = assetBytes + docBytes;
    const size = formatSize(totalBytes);

    return {
      domain: domainId,
      zh: domain ? domain.zh : '未分类',
      en: domain ? domain.en : 'UNCLASSIFIED',
      desc: domain ? domain.desc : '',
      assetCount: assetKeys.length,
      assetBytes,
      docCount: docKeys.length,
      docBytes,
      count: assetKeys.length + docKeys.length,
      bytes: totalBytes,
      sizeValue: size.value,
      sizeUnit: size.unit,
      assetClearable: domain ? domain.assetClearable : true
    };
  }

  /** 全域汇总统计，用于设置页存储面板 */
  async function getAllStats() {
    const domains = [];
    let totalBytes = 0;
    let totalCount = 0;

    for (const id of DOMAIN_IDS) {
      const stat = await getDomainStats(id);
      domains.push(stat);
      totalBytes += stat.bytes;
      totalCount += stat.count;
    }

    const orphanAssets = await listUnclassifiedAssets();
    const orphanDocs = await listUnclassifiedDocs();
    let unclassifiedBytes = 0;
    for (const k of orphanAssets) unclassifiedBytes += await assetSizeOf(k);
    for (const k of orphanDocs) unclassifiedBytes += await docSizeOf(k);

    const total = formatSize(totalBytes + unclassifiedBytes);
    return {
      domains,
      unclassified: {
        count: orphanAssets.length + orphanDocs.length,
        bytes: unclassifiedBytes,
        assetKeys: orphanAssets,
        docKeys: orphanDocs
      },
      totalCount: totalCount + orphanAssets.length + orphanDocs.length,
      totalBytes: totalBytes + unclassifiedBytes,
      totalSizeValue: total.value,
      totalSizeUnit: total.unit
    };
  }

  /* ---------------- 清理 ---------------- */

  /**
   * 清空某域的图片资产。仅对 assetClearable 的域生效。
   * gen 域要同步图库索引，envoy / roster 会打断身份数据，都不走这里。
   * @returns {Promise<{removed:number, skipped:boolean}>}
   */
  async function clearDomainAssets(domainId) {
    const domain = DOMAINS[domainId];
    if (!domain) return { removed: 0, skipped: true };
    if (!domain.assetClearable) {
      console.warn(`[DataRegistry] ${domainId} 域不允许整域清空资产，请走所属模块的删除逻辑`);
      return { removed: 0, skipped: true };
    }

    const keys = await listAssetsByDomain(domainId);
    let removed = 0;
    for (const k of keys) {
      try {
        await Storage.removeAsset(k);
        removed += 1;
      } catch (err) {
        console.warn('[DataRegistry] 删除资产失败：', k, err);
      }
    }
    return { removed, skipped: false };
  }

  /* ---------------- 孤儿探测 ---------------- */

  // 各模块注册「我当前在用哪些资产键」，用于比对出无主资源
  const usageProviders = [];

  /**
   * 注册资产用量提供者
   * @param {string} name 模块名，仅用于日志
   * @param {() => (string[]|Promise<string[]>)} fn 返回该模块在用的资产键名数组
   */
  function registerUsageProvider(name, fn) {
    if (typeof fn !== 'function') return;
    usageProviders.push({ name, fn });
  }

  /**
   * 探测孤儿资产：库里存在、但没有任何模块声称在用的键。
   * 只报告不删除，删除交由调用方决策。
   */
  async function findOrphans() {
    const claimed = new Set();
    for (const p of usageProviders) {
      try {
        const keys = await p.fn();
        (Array.isArray(keys) ? keys : []).forEach((k) => claimed.add(String(k)));
      } catch (err) {
        console.warn('[DataRegistry] 用量提供者报错：', p.name, err);
      }
    }

    let all = [];
    try {
      all = await Storage.listAssetKeys();
    } catch (err) {
      return { orphans: [], claimed: claimed.size, scanned: 0 };
    }

    const orphans = all.filter((k) => !claimed.has(k));
    return { orphans, claimed: claimed.size, scanned: all.length };
  }

  return {
    DOMAINS,
    DOMAIN_IDS,
    key,
    prefix,
    domainOf,
    listAssetsByDomain,
    listDocsByDomain,
    listUnclassifiedAssets,
    listUnclassifiedDocs,
    formatSize,
    assetSizeOf,
    docSizeOf,
    getDomainStats,
    getAllStats,
    clearDomainAssets,
    registerUsageProvider,
    findOrphans
  };
})();

window.DataRegistry = DataRegistry;