/**
 * ============================================================================
 * 溯流计划 · 数据管理数据层 (Data Vault)
 *
 * 职责：把散落在 IndexedDB（assets / docs / records）与 localStorage 里的
 * 用户数据，按「逻辑分块」统一收拢，提供体积统计、分块/全量导入导出、分块清理。
 *
 * 分块（为未来云端分片同步预留，新增分类只需往 BLOCKS 加一项）：
 *   profile  档案：执行员身份 + 马甲 + 角色/NPC/助手/关系 + 心智档案 + 各自图片
 *   chat     聊天记录：records 流水 + 系统助手会话设置
 *   decor    美化资源：红卡文本 + 主题色 + 壁纸/封面/字体 + 字体文件
 *   gallery  图片：AI 生图归档 + 图库索引
 *   files    文件：文件区文本本体 + 文件索引
 *   worldbook 世界书：五大分类的设定注入库（书本 + 条目 + 预设播种标记）
 *   online   线上联络：账号态 + 通讯录 + 会话元数据 + 朋友圈 + 线上资产
 *   config   系统配置：API 节点 / 槽位
 *
 * 导出格式（自描述 JSON，全量与分块统一）：
 *   {
 *     app: 'retroflow', kind: 'data-vault', version: 1,
 *     exportedAt: <ts>, blocks: ['profile', ...],
 *     payload: {
 *       docs:   { <docKey>: <value> },
 *       assets: { <assetKey>: { type:'blob'|'url', mime, base64 | data } },
 *       records: [ <record>, ... ],
 *       local:  { <localStorageKey>: <string> }
 *     }
 *   }
 * 图片 Blob 以 base64 内嵌，单文件无依赖，方便未来分片上云。
 * ============================================================================
 */
const DataVault = (() => {
  'use strict';

  const EXPORT_VERSION = 1;

  /* ---------------- 分块定义 ---------------- */

  const K = (window.Store && Store.KEYS) ? Store.KEYS : {};

  // 每块声明它拥有的数据来源：
  //   docKeys    docs store 里的键（配置文本，含索引）
  //   keepOnClearKeys  docKeys 的子集，清理时保留（内务标记，删了会触发重新播种）
  //   assetPrefixes  assets store 里以这些前缀开头的图片资产
  //   assetExcludes  从 assetPrefixes 命中结果里排除的更长前缀。
  //                  用于把某个域下的一部分资产划给别的块（如私聊壁纸归美化资源），
  //                  避免两块前缀重叠导致导入时互相清空。
  //   localKeys  localStorage 里的键
  //   records    是否包含流水记录
  const BLOCKS = {
    profile: {
      zh: '档案',
      en: 'PROFILE // AGENT & ROSTER',
      desc: '执行员身份、马甲、角色/NPC/助手、关系与心智档案',
      docKeys: [
        K.envoyIdentity, K.envoyMasks, K.envoyPsych,
        K.rosterCharacters, K.rosterNpcs, K.rosterAssistants, K.rosterRelations,
        // 旧版占位角色的一次性清理标记（resonance-ui purgeLegacySeedData）。
        // 跟角色表同进同出：导到新设备后不会再对导入的角色表跑一遍清理。
        K.metaLegacyPurged
      ],
      // 清理档案时保留该标记：删了的话重载会把它当成首次运行再扫一次（虽无害，但没必要）
      keepOnClearKeys: [K.metaLegacyPurged],
      assetPrefixes: ['envoy/', 'roster/'],
      localKeys: [],
      records: false
    },
    worldbook: {
      zh: '世界书',
      en: 'WORLDBOOK // DIRECTIVES',
      desc: '全局/助手/线上/副本/生成五大分类的设定注入库',
      docKeys: [K.worldbookBooks, K.worldbookSeeded],
      // 播种标记随包导出（新设备导入后不会再被塞一本预设「破限」），
      // 但清理时必须留下，否则重载时 Store 会当成首次装载把预设复活。
      keepOnClearKeys: [K.worldbookSeeded],
      assetPrefixes: [],
      // 世界书激活状态（哪些书/条目当前生效）跟着世界书走。
      localKeys: ['retroflow_worldbook_active_v1'],
      records: false
    },
    chat: {
      zh: '聊天记录',
      en: 'CHAT // CONVERSATION LOG',
      desc: '系统助手与私聊角色的全部对话流水及各自会话设置',
      docKeys: [],
      // 助手多窗口的元信息：sysChat/index（窗口列表 + 当前活跃窗口）
      // 与 sysChat/doc.<convId>（每个窗口的标题、时间、消息数）。
      // 流水本体在 records 的 system-chat:<convId> 分区，必须与元信息同进同出：
      // 只导流水不导索引，导入后窗口列表里只剩主对话，其余窗口的消息无处挂载。
      docPrefixes: ['sysChat/'],
      assetPrefixes: [],
      // 助手页与私聊页各存一份对话设置：
      // 私聊那份是按联系人隔离的表（工具开关、循环上限、结果保留轮数）。
      localKeys: [
        'retroflow_system_chat_settings_v1',
        'retroflow_online_chat_settings_v1'
      ],
      // records 表按 forkId 前缀分家：助手 system-chat: 与私聊 online: 归本块，
      // 副本推演流水 run: 归「副本记录」块，各导各的，互不覆盖。
      recordPrefixes: ['system-chat:', 'online:']
    },
    online: {
      zh: '线上联络',
      en: 'ONLINE // CONTACTS & FEED',
      desc: '线上账号、通讯录、会话元数据与朋友圈，含头像与配图资产',
      docKeys: [K.onlineAccounts, K.onlineContacts, K.onlineSessions, K.onlineFeed],
      assetPrefixes: ['online/'],
      // 私聊对话壁纸虽在 online 域，但归美化资源块管，此处排除。
      // 不排除的话两块前缀重叠：导入 online 会把 decor 刚写入的壁纸清掉。
      assetExcludes: ['online/chat.wallpaper.'],
      localKeys: [],
      // 线上聊天消息与助手消息同住 records store，靠 forkId 前缀区分。
      // 这里不声明 records：整表导出由 chat 块负责，避免同一批流水被打包两次。
      records: false
    },
    decor: {
      zh: '美化资源',
      en: 'DECOR // THEME & SKIN',
      desc: '红卡文本、主题配色、壁纸（含私聊专属）、封面与自定义字体',
      docKeys: [
        K.decorCardName, K.decorCardBio, K.decorThemeColors,
        K.decorCustomColorPalettes,
        K.decorThemeWallpaperMask, K.decorThemeFrostedGlass,
        K.decorTileConfigs, K.decorTileNoBaseGlobal,
        K.decorThemeFontListMeta, K.decorThemeActiveFontId
      ],
      // 私聊对话壁纸的键落在 online 域下（online/chat.wallpaper.*），
      // 但它性质上是美化资源，故在此显式接管；online 块相应排除该前缀。
      assetPrefixes: ['decor/', 'online/chat.wallpaper.'],
      localKeys: [],
      records: false
    },
    config: {
      zh: '系统配置',
      en: 'CONFIG // API NODES',
      desc: 'API 节点、算力槽位等接入配置',
      docKeys: [K.configApiNodes, K.configApiActiveNodeId, K.configApiSlots],
      assetPrefixes: [],
      localKeys: [],
      records: false
    },
    gallery: {
      zh: '图片',
      en: 'GALLERY // GENERATED IMAGES',
      desc: 'AI 生图历史归档与图库索引',
      docKeys: [K.metaGalleryIndex],
      assetPrefixes: ['gen/'],
      localKeys: [],
      records: false
    },
    files: {
      zh: '文件',
      en: 'FILES // DOCUMENT VAULT',
      desc: '文件区上传的文本文件本体与索引',
      docKeys: [K.metaFileIndex],
      assetPrefixes: ['doc/'],
      localKeys: [],
      records: false
    },
    fork: {
      zh: '副本库',
      en: 'FORK // INSTANCE ARCHIVE',
      desc: '副本卷宗、油画墙索引与副本封面',
      docKeys: [K.forkIndex],
      // 卷宗是动态键（fork/dossier.<id>），条数随副本增长，靠前缀扫描收全
      docPrefixes: ['fork/dossier.'],
      assetPrefixes: ['fork/cover.'],
      localKeys: [],
      records: false
    },
    run: {
      zh: '副本记录',
      en: 'FORK RUN // DIVE LOG',
      desc: '副本下潜存档：各世界线的进度、状态、结算与正史指针，以及推演对话流水',
      // 全局活跃现场指针是固定单键；下潜索引与存档本体是动态键，靠前缀扫全。
      docKeys: ['run/activeForkRef'],
      docPrefixes: ['run/index.', 'run/doc.'],
      assetPrefixes: [],
      // 推演流水在 records 表里以 run:<runId> 分区，与 fork 卷宗（创作）刻意分家：
      // 删一次游玩记录是正常操作，删卷宗才是毁掉创作。
      recordPrefixes: ['run:'],
      // 推演设置（流式/自动重试/记忆/展开）与壁纸遮罩·模糊开关，都是「副本游玩态」，跟副本记录走。
      localKeys: [
        'retroflow_fork_run_settings_v1',
        'retroflow_fork_run_wallpaper_cfg_v1'
      ]
    },
    misc: {
      zh: '终端应用',
      en: 'TERMINAL // APPS',
      desc: '随身便笺、系统商城、溯流论坛等终端功能模块的零散数据',
      // 聚合块：往后系统商城、溯流论坛等小功能都塞进来（各自域前缀往下面加），
      // 不再为单个小功能新开块，避免块列表无限增殖。存储仍各是各的。
      docKeys: [K.memoContent],
      docPrefixes: [],
      assetPrefixes: [],
      localKeys: [],
      records: false
    }
  };

  const BLOCK_IDS = Object.keys(BLOCKS);

  // 操作胶囊的合并组：底层存储各存各的，只在导出/清理的操作入口合成一枚。
  // 数据越做越多时，这里能挡住胶囊无限增殖。
  const OP_GROUPS = {
    online_all: {
      zh: '线上数据',
      blocks: ['chat', 'online']
    }
  };

  // 胶囊展示顺序：被合并的块不再单独出胶囊，由组胶囊代表
  const GROUPED_BLOCK_IDS = new Set(
    Object.values(OP_GROUPS).reduce((acc, g) => acc.concat(g.blocks), [])
  );

  /** 胶囊清单：未被合并的块按原顺序，遇到组内第一块时插入组胶囊 */
  function listOpScopes() {
    const out = [];
    const emitted = new Set();
    for (const id of BLOCK_IDS) {
      if (!GROUPED_BLOCK_IDS.has(id)) {
        out.push({ id, zh: BLOCKS[id].zh, blocks: [id] });
        continue;
      }
      const groupId = Object.keys(OP_GROUPS).find((g) => OP_GROUPS[g].blocks.includes(id));
      if (!groupId || emitted.has(groupId)) continue;
      emitted.add(groupId);
      out.push({ id: groupId, zh: OP_GROUPS[groupId].zh, blocks: OP_GROUPS[groupId].blocks.slice() });
    }
    return out;
  }

  /** 把一个作用域 id（块或组）解析成实际的块 id 数组 */
  function resolveScope(scopeId) {
    if (scopeId === 'all') return BLOCK_IDS.slice();
    if (OP_GROUPS[scopeId]) return OP_GROUPS[scopeId].blocks.slice();
    if (BLOCKS[scopeId]) return [scopeId];
    return [];
  }

  /** 作用域的展示名 */
  function scopeLabel(scopeId) {
    if (scopeId === 'all') return '全部';
    if (OP_GROUPS[scopeId]) return OP_GROUPS[scopeId].zh;
    return BLOCKS[scopeId] ? BLOCKS[scopeId].zh : scopeId;
  }

  /* ---------------- 工具 ---------------- */

  function formatSize(bytes) {
    if (!bytes || bytes < 1024) return { value: String(bytes || 0), unit: 'B' };
    if (bytes < 1024 * 1024) return { value: (bytes / 1024).toFixed(0), unit: 'KB' };
    return { value: (bytes / (1024 * 1024)).toFixed(1), unit: 'MB' };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result 形如 data:<mime>;base64,xxxx，取逗号后的纯 base64
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(base64, mime) {
    const byteChars = atob(base64);
    const len = byteChars.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  /** 列出某块拥有的全部 assets 键 */
  async function collectAssetKeys(block) {
    const out = [];
    const excludes = block.assetExcludes || [];
    const excluded = (k) => excludes.some((p) => String(k).startsWith(p));
    for (const prefix of (block.assetPrefixes || [])) {
      try {
        const keys = await Storage.listAssetKeys(prefix);
        (keys || []).forEach((k) => { if (!excluded(k)) out.push(k); });
      } catch (_) { /* ignore */ }
    }
    return out;
  }

  /**
   * 列出某块拥有的全部 docs 键：固定 docKeys 加上 docPrefixes 扫出的动态键。
   * 动态键用于条数随业务增长的场景（如一副本一条卷宗）。
   */
  async function collectDocKeys(block) {
    const out = [];
    const seen = new Set();
    for (const dk of (block.docKeys || [])) {
      if (dk && !seen.has(dk)) { seen.add(dk); out.push(dk); }
    }
    for (const prefix of (block.docPrefixes || [])) {
      try {
        const keys = await Storage.listDocKeys(prefix);
        (keys || []).forEach((k) => {
          if (k && !seen.has(k)) { seen.add(k); out.push(k); }
        });
      } catch (_) { /* ignore */ }
    }
    return out;
  }

  /* ---------------- 体积统计 ---------------- */

  /**
   * 按块归属取 records 流水。
   * 优先用 recordPrefixes（按 forkId 前缀切分，多块共用一张 records 表时各取各的）；
   * 兼容旧的布尔 records（整表）。都没有则返回空数组。
   */
  async function collectBlockRecords(block) {
    if (!block) return [];
    if (Array.isArray(block.recordPrefixes) && block.recordPrefixes.length) {
      const seen = new Set();
      const out = [];
      for (const p of block.recordPrefixes) {
        let list = [];
        try { list = await Storage.getRecordsByForkPrefix(p); } catch (_) { list = []; }
        (list || []).forEach((r) => {
          if (r && r.id && !seen.has(r.id)) { seen.add(r.id); out.push(r); }
        });
      }
      return out;
    }
    if (block.records) {
      try { return await Storage.getAllRecords(); } catch (_) { return []; }
    }
    return [];
  }

  /** 块是否包含 records（新前缀式或旧布尔式） */
  function blockHasRecords(block) {
    return !!(block && ((Array.isArray(block.recordPrefixes) && block.recordPrefixes.length) || block.records));
  }

  async function docSizeOf(docKey) {
    try {
      const value = await Storage.getDoc(docKey, null);
      if (value === null || value === undefined) return 0;
      if (typeof value === 'string') return value.length * 2;
      return JSON.stringify(value).length * 2;
    } catch (_) { return 0; }
  }

  async function assetSizeOf(assetKey) {
    try {
      const raw = await Storage.getAssetRaw(assetKey);
      if (!raw) return 0;
      if (raw.data instanceof Blob) return raw.data.size;
      if (typeof raw.data === 'string') return raw.data.length;
      return 0;
    } catch (_) { return 0; }
  }

  function localSizeOf(localKey) {
    try {
      const v = localStorage.getItem(localKey);
      return v ? v.length * 2 : 0;
    } catch (_) { return 0; }
  }

  /** 单块统计：条目数与字节数 */
  async function statBlock(blockId) {
    const block = BLOCKS[blockId];
    if (!block) return null;

    let bytes = 0;
    let count = 0;

    const docKeys = await collectDocKeys(block);
    for (const dk of docKeys) {
      const b = await docSizeOf(dk);
      if (b > 0) { bytes += b; count += 1; }
    }

    const assetKeys = await collectAssetKeys(block);
    for (const ak of assetKeys) {
      bytes += await assetSizeOf(ak);
    }
    count += assetKeys.length;

    for (const lk of (block.localKeys || [])) {
      const b = localSizeOf(lk);
      if (b > 0) { bytes += b; count += 1; }
    }

    if (blockHasRecords(block)) {
      try {
        const records = await collectBlockRecords(block);
        count += records.length;
        // records 体积按序列化长度粗算
        for (const r of records) {
          bytes += JSON.stringify(r).length * 2;
        }
      } catch (_) { /* ignore */ }
    }

    const size = formatSize(bytes);
    return {
      id: blockId,
      zh: block.zh,
      en: block.en,
      desc: block.desc,
      count,
      bytes,
      sizeValue: size.value,
      sizeUnit: size.unit
    };
  }

  /** 全块统计 */
  async function statAll() {
    const blocks = [];
    let totalBytes = 0;
    let totalCount = 0;
    for (const id of BLOCK_IDS) {
      const s = await statBlock(id);
      if (s) {
        blocks.push(s);
        totalBytes += s.bytes;
        totalCount += s.count;
      }
    }
    const size = formatSize(totalBytes);
    return { blocks, totalBytes, totalCount, totalSizeValue: size.value, totalSizeUnit: size.unit };
  }

  /** 浏览器存储配额预估（quota / usage） */
  async function estimateQuota() {
    try {
      if (navigator.storage && typeof navigator.storage.estimate === 'function') {
        const est = await navigator.storage.estimate();
        return { usage: est.usage || 0, quota: est.quota || 0, supported: true };
      }
    } catch (_) { /* ignore */ }
    return { usage: 0, quota: 0, supported: false };
  }

  /* ---------------- 导出 ---------------- */

  /** 收集单块的 payload 片段并合并进 acc */
  async function collectBlockPayload(blockId, acc) {
    const block = BLOCKS[blockId];
    if (!block) return;

    // docs
    const docKeys = await collectDocKeys(block);
    for (const dk of docKeys) {
      const value = await Storage.getDoc(dk, undefined);
      if (value !== undefined) acc.docs[dk] = value;
    }

    // assets（Blob → base64；远端 URL 原样存字符串）
    const assetKeys = await collectAssetKeys(block);
    for (const ak of assetKeys) {
      const raw = await Storage.getAssetRaw(ak);
      if (!raw) continue;
      if (raw.data instanceof Blob) {
        acc.assets[ak] = {
          type: 'blob',
          mime: raw.data.type || 'application/octet-stream',
          base64: await blobToBase64(raw.data)
        };
      } else if (typeof raw.data === 'string') {
        acc.assets[ak] = { type: 'url', data: raw.data };
      }
    }

    // localStorage
    for (const lk of (block.localKeys || [])) {
      try {
        const v = localStorage.getItem(lk);
        if (v !== null) acc.local[lk] = v;
      } catch (_) { /* ignore */ }
    }

    // records（按块归属收集，合并去重；多块共用一张 records 表时各取各的、不互相覆盖）
    if (blockHasRecords(block)) {
      try {
        if (!Array.isArray(acc.records)) acc.records = [];
        if (!acc._recordIds) acc._recordIds = new Set(acc.records.map((r) => r && r.id).filter(Boolean));
        const records = await collectBlockRecords(block);
        for (const r of records) {
          if (r && r.id && !acc._recordIds.has(r.id)) {
            acc._recordIds.add(r.id);
            acc.records.push(r);
          }
        }
      } catch (_) { /* ignore */ }
    }
  }

  /**
   * 导出指定分块（数组），返回自描述 JSON 对象。
   * @param {string[]} blockIds
   */
  async function buildExport(blockIds) {
    const ids = (Array.isArray(blockIds) ? blockIds : []).filter((id) => BLOCKS[id]);
    const payload = { docs: {}, assets: {}, records: [], local: {} };
    for (const id of ids) {
      await collectBlockPayload(id, payload);
    }
    delete payload._recordIds;
    return {
      app: 'retroflow',
      kind: 'data-vault',
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      blocks: ids,
      payload
    };
  }

  /* ---------------- 界面主题包（独立于数据管理块，纯外观） ---------------- */
  /**
   * 主题包精确白名单：只含界面主题外观数据，不含红卡文本/立绘、图库封面、聊天壁纸。
   * docKeys  ：配色、自定义色卡、字体、壁纸遮罩、磨砂、卡片图标/背景/底座配置
   * assetKeys：桌面壁纸、各卡片背景图、各卡片图标图、自定义字体文件
   */
  const THEME_BLOCK = {
    docKeys: [
      K.decorThemeColors, K.decorCustomColorPalettes,
      K.decorThemeActiveFontId, K.decorThemeFontListMeta,
      K.decorThemeWallpaperMask, K.decorThemeFrostedGlass,
      K.decorTileConfigs, K.decorTileNoBaseGlobal
    ].filter(Boolean),
    assetPrefixes: [
      'decor/theme.wallpaper',
      'decor/desktop.tile_bg.',
      'decor/desktop.tile_icon.',
      'decor/theme.font.'
    ]
  };

  /** 构建界面主题导出包（与通用 data-vault 格式一致，blocks:['theme']） */
  async function buildThemeExport() {
    const payload = { docs: {}, assets: {}, records: [], local: {} };
    // docs
    for (const dk of THEME_BLOCK.docKeys) {
      const value = await Storage.getDoc(dk, undefined);
      if (value !== undefined) payload.docs[dk] = value;
    }
    // assets（Blob → base64；远端 URL 原样存字符串）
    const assetKeys = await collectAssetKeys(THEME_BLOCK);
    for (const ak of assetKeys) {
      const raw = await Storage.getAssetRaw(ak);
      if (!raw) continue;
      if (raw.data instanceof Blob) {
        payload.assets[ak] = {
          type: 'blob',
          mime: raw.data.type || 'application/octet-stream',
          base64: await blobToBase64(raw.data)
        };
      } else if (typeof raw.data === 'string') {
        payload.assets[ak] = { type: 'url', data: raw.data };
      }
    }
    return {
      app: 'retroflow',
      kind: 'data-vault',
      version: EXPORT_VERSION,
      exportedAt: Date.now(),
      blocks: ['theme'],
      payload
    };
  }

  /** 导出界面主题包并触发下载 */
  async function exportTheme() {
    const pkg = await buildThemeExport();
    await download(pkg, '界面主题包');
    return true;
  }

  /**
   * 判断某资产键是否属于主题包白名单。
   * 精确前缀匹配，避免误伤同域的红卡立绘（decor/desktop.profile_card）等。
   */
  function themeAssetBelongs(key) {
    const k = String(key);
    return THEME_BLOCK.assetPrefixes.some((p) => k.startsWith(p));
  }

  /**
   * 应用一个界面主题导入包（覆盖式写入主题白名单范围）。
   * 兼容两类来源：独立主题包（blocks:['theme']）与整包里含 decor 的备份。
   * 只处理白名单内的 docs / assets，其余一律忽略，绝不越界。
   * @returns {Promise<{ok:boolean, reason?:string, docCount:number, assetCount:number}>}
   */
  async function applyThemeImport(pkg) {
    if (!pkg || pkg.kind !== 'data-vault' || !pkg.payload) {
      return { ok: false, reason: 'invalid_format', docCount: 0, assetCount: 0 };
    }
    const payload = pkg.payload;
    const docKeySet = new Set(THEME_BLOCK.docKeys);
    let docCount = 0;
    let assetCount = 0;

    // 1. docs：仅覆盖白名单内的键（包里没有的键保持原值不动）
    if (payload.docs) {
      for (const [dk, value] of Object.entries(payload.docs)) {
        if (!docKeySet.has(dk)) continue;
        await Storage.setDoc(dk, value);
        docCount += 1;
      }
    }

    // 2. assets：先清掉白名单前缀下现有资产（覆盖式），再写入包里的
    for (const prefix of THEME_BLOCK.assetPrefixes) {
      try {
        const existing = await Storage.listAssetKeys(prefix);
        for (const k of (existing || [])) {
          if (!themeAssetBelongs(k)) continue;
          await Storage.removeAsset(k);
        }
      } catch (_) { /* ignore */ }
    }
    if (payload.assets) {
      for (const [ak, entry] of Object.entries(payload.assets)) {
        if (!themeAssetBelongs(ak)) continue;
        if (entry && entry.type === 'blob' && entry.base64) {
          await Storage.setAsset(ak, base64ToBlob(entry.base64, entry.mime));
          assetCount += 1;
        } else if (entry && entry.type === 'url' && typeof entry.data === 'string') {
          await Storage.setAsset(ak, entry.data);
          assetCount += 1;
        }
      }
    }

    return { ok: true, docCount, assetCount };
  }

  /** 保存一个 JSON 包，文件名统一交给 Downloader。
   *  原生壳下 Downloader.save 是 Filesystem 分块直写，必须 await——
   *  resolve 即代表文件真正落盘，toast 才敢报「已导出」。
   *  opts.onProgress 供 UI 显示大文件写入进度（透传给 Downloader）。 */
  async function download(pkg, label, opts) {
    const json = JSON.stringify(pkg);
    const blob = new Blob([json], { type: 'application/json' });
    if (window.Downloader && typeof Downloader.save === 'function') {
      return await Downloader.save(blob, label, 'json', opts);
    }

    // Downloader 未加载时的兼容回退，正常启动顺序不会走到这里。
    const url = URL.createObjectURL(blob);
    const name = `溯流计划-${label || '数据备份'}-${Date.now()}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { name, via: 'objecturl' };
  }

  /** 导出单块并下载 */
  async function exportBlock(blockId) {
    if (!BLOCKS[blockId]) return false;
    const pkg = await buildExport([blockId]);
    await download(pkg, `${BLOCKS[blockId].zh}备份`);
    return true;
  }

  /**
   * 按作用域（单块或合并组）导出并下载。
   * 合并组一次打包多块，例如「线上数据」= 聊天记录 + 线上联络。
   */
  async function exportScope(scopeId, opts) {
    if (scopeId === 'all') return exportAll(opts);
    const ids = resolveScope(scopeId);
    if (!ids.length) return false;
    const pkg = await buildExport(ids);
    await download(pkg, `${scopeLabel(scopeId)}备份`, opts);
    return true;
  }

  /** 全量导出并下载 */
  async function exportAll(opts) {
    const pkg = await buildExport(BLOCK_IDS);
    await download(pkg, '数据备份', opts);
    return true;
  }

  /* ---------------- 导入 ---------------- */

  /**
   * 应用一个导入包。按包里声明的 blocks 做覆盖式写入。
   * 若 onlyBlock 指定，则仅导入该块（且要求包里含该块）。
   * @returns {Promise<{ok:boolean, blocks:string[], reason?:string}>}
   */
  async function applyImport(pkg, onlyBlock) {
    if (!pkg || pkg.kind !== 'data-vault' || !pkg.payload) {
      return { ok: false, blocks: [], reason: 'invalid_format' };
    }
    const pkgBlocks = Array.isArray(pkg.blocks) ? pkg.blocks : [];
    let targetBlocks = pkgBlocks;
    if (onlyBlock) {
      if (!pkgBlocks.includes(onlyBlock)) {
        return { ok: false, blocks: [], reason: 'block_absent' };
      }
      targetBlocks = [onlyBlock];
    }

    const payload = pkg.payload;
    // 待导入的键集合，用来判断哪些数据属于本次目标块，避免误写其他块。
    const docKeySet = new Set();
    const docPrefixList = [];
    const assetPrefixList = [];
    const assetExcludeList = [];
    const localKeySet = new Set();
    let includeRecords = false;
    const recordPrefixList = [];
    let recordsFullClear = false;

    for (const id of targetBlocks) {
      const block = BLOCKS[id];
      if (!block) continue;
      block.docKeys.forEach((k) => { if (k) docKeySet.add(k); });
      (block.docPrefixes || []).forEach((p) => docPrefixList.push(p));
      (block.assetPrefixes || []).forEach((p) => assetPrefixList.push(p));
      (block.assetExcludes || []).forEach((p) => assetExcludeList.push(p));
      (block.localKeys || []).forEach((k) => localKeySet.add(k));
      if (Array.isArray(block.recordPrefixes) && block.recordPrefixes.length) {
        block.recordPrefixes.forEach((p) => recordPrefixList.push(p));
        includeRecords = true;
      } else if (block.records) {
        recordsFullClear = true;
        includeRecords = true;
      }
    }

    /** 动态键（如 fork/dossier.<id>）按前缀归属，固定键按集合归属 */
    const docBelongs = (key) => {
      if (docKeySet.has(key)) return true;
      return docPrefixList.some((p) => String(key).startsWith(p));
    };

    // 归属判定：命中任一 assetPrefix 即归属本次导入，但要处理跨块认领。
    //
    // 排除项（如 online 排除壁纸）只应挡住「更粗的那个前缀」，
    // 不能挡住显式声明它的块——decor 直接声明了 'online/chat.wallpaper.'，
    // 那就是它的资产。故判定排除时要求 ex 严格长于当前前缀。
    const assetBelongs = (key) => {
      const k = String(key);
      for (const p of assetPrefixList) {
        if (!k.startsWith(p)) continue;
        const excludedHere = assetExcludeList.some(
          (ex) => ex.length > p.length && ex.startsWith(p) && k.startsWith(ex)
        );
        if (!excludedHere) return true;
      }
      return false;
    };

    // 1. docs：动态键前缀先做覆盖式清理，再写入包里的
    if (docPrefixList.length) {
      for (const prefix of docPrefixList) {
        try {
          const existing = await Storage.listDocKeys(prefix);
          for (const k of (existing || [])) {
            await Storage.removeDoc(k);
          }
        } catch (_) { /* ignore */ }
      }
    }
    if (payload.docs) {
      for (const [dk, value] of Object.entries(payload.docs)) {
        if (!docBelongs(dk)) continue;
        await Storage.setDoc(dk, value);
      }
    }

    // 2. assets：先清掉目标前缀下现有资产（覆盖式），再写入包里的。
    // 清理范围与归属判定必须一致，否则会误删被别的块认领的资产（如私聊壁纸）。
    if (assetPrefixList.length) {
      for (const prefix of assetPrefixList) {
        try {
          const existing = await Storage.listAssetKeys(prefix);
          for (const k of (existing || [])) {
            if (!assetBelongs(k)) continue;
            await Storage.removeAsset(k);
          }
        } catch (_) { /* ignore */ }
      }
    }
    if (payload.assets) {
      for (const [ak, entry] of Object.entries(payload.assets)) {
        if (!assetBelongs(ak)) continue;
        if (entry && entry.type === 'blob' && entry.base64) {
          await Storage.setAsset(ak, base64ToBlob(entry.base64, entry.mime));
        } else if (entry && entry.type === 'url' && typeof entry.data === 'string') {
          await Storage.setAsset(ak, entry.data);
        }
      }
    }

    // 3. localStorage
    if (payload.local) {
      for (const [lk, value] of Object.entries(payload.local)) {
        if (!localKeySet.has(lk)) continue;
        try { localStorage.setItem(lk, value); } catch (_) { /* ignore */ }
      }
    }

    // 4. records：按块前缀切分删除后写回。
    // 兼容策略：删除按块归属的前缀分区（各块只删自己的流水），
    // 但写回对 payload.records 保持宽容——整批写回不按前缀过滤，
    // 这样老包（records 为整表混合）导入时不会丢掉副本流水等分区。
    if (includeRecords) {
      try {
        if (recordsFullClear) {
          // 旧块声明整表 records，沿用整表清
          await Storage.clearAllRecords();
        } else {
          // 新前缀式：只清各块归属的分区
          for (const prefix of recordPrefixList) {
            try { await Storage.removeRecordsByForkPrefix(prefix); } catch (_) { /* ignore */ }
          }
        }
        if (Array.isArray(payload.records)) {
          for (const rec of payload.records) {
            if (rec && rec.id) await Storage.putRecord(rec);
          }
        }
      } catch (_) { /* ignore */ }
    }

    return { ok: true, blocks: targetBlocks };
  }

  /** 解析文件文本为导入包对象 */
  function parsePackage(text) {
    try {
      const pkg = JSON.parse(text);
      if (pkg && pkg.kind === 'data-vault' && pkg.payload) return pkg;
      return null;
    } catch (_) {
      return null;
    }
  }

  /* ---------------- 清理 ---------------- */

  /** 清空指定块的全部数据（覆盖式导入的删除路径复用），返回删除条数 */
  async function clearBlock(blockId) {
    const block = BLOCKS[blockId];
    if (!block) return 0;
    let removed = 0;

    // docs（keepOnClearKeys 声明的内务标记不参与清理，见 BLOCKS 注释）
    const keepSet = new Set(block.keepOnClearKeys || []);
    const docKeys = await collectDocKeys(block);
    for (const dk of docKeys) {
      if (keepSet.has(dk)) continue;
      const ok = await Storage.removeDoc(dk);
      if (ok) removed += 1;
    }

    // assets（走 collectAssetKeys，与统计/导出同一套排除口径）
    try {
      const keys = await collectAssetKeys(block);
      for (const k of keys) {
        await Storage.removeAsset(k);
        removed += 1;
      }
    } catch (_) { /* ignore */ }

    // localStorage
    for (const lk of (block.localKeys || [])) {
      try {
        if (localStorage.getItem(lk) !== null) {
          localStorage.removeItem(lk);
          removed += 1;
        }
      } catch (_) { /* ignore */ }
    }

    // records（按块前缀切分：只清本块归属的分区流水；旧块声明整表则整表清）
    if (Array.isArray(block.recordPrefixes) && block.recordPrefixes.length) {
      for (const prefix of block.recordPrefixes) {
        try {
          const n = await Storage.removeRecordsByForkPrefix(prefix);
          if (typeof n === 'number') removed += n;
        } catch (_) { /* ignore */ }
      }
    } else if (block.records) {
      try {
        removed += await Storage.clearAllRecords();
      } catch (_) { /* ignore */ }
    }

    return removed;
  }

  /**
   * 按作用域清理。合并组会依次清掉组内所有块，返回累计删除条数。
   */
  async function clearScope(scopeId) {
    if (scopeId === 'all') return 0; // 全部禁止一键清空
    const ids = resolveScope(scopeId);
    let removed = 0;
    for (const id of ids) {
      removed += await clearBlock(id);
    }
    return removed;
  }

  return {
    BLOCKS,
    BLOCK_IDS,
    OP_GROUPS,
    listOpScopes,
    resolveScope,
    scopeLabel,
    formatSize,
    statBlock,
    statAll,
    estimateQuota,
    buildExport,
    buildThemeExport,
    exportTheme,
    applyThemeImport,
    exportBlock,
    exportScope,
    exportAll,
    applyImport,
    parsePackage,
    clearBlock,
    clearScope
  };
})();

window.DataVault = DataVault;
