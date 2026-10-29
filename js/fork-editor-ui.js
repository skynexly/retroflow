/**
 * 溯流计划 · 无限世界副本编纂器 (Fork Editor UI)
 * 职责：
 *  1. 承载无限世界 4 大维度（概览 CORE / 人物 ACTOR / 规则 MATRIX / 剧情 PLOT）编纂数据与渲染
 *  2. 动态列表（NPC / 地点 / 数值 / 线索 / 结局 / 通关条件）增删与手风琴折叠
 *  3. 5 类触发条件多选 Chip（地点 / 关键词 / 时间 / 数值 / 线索）纯 SVG 矢量交互
 *  4. 联动同调档案副本阵营（camp === 'instance'）角色作为高危角色，回显头像/姓名/性别/阶位/设定摘要
 *  5. 严格遵守协议：纯 SVG 无 emoji、零物理分割线、米白经典底色、iOS 灵动岛保护
 */
(() => {
  'use strict';

  /**
   * HTML 文本转义：动态卡片模板里注入用户文本前必须过一遍。
   * 本模块是独立 IIFE 闭包，拿不到其他模块里的同名私有函数，
   * 所以这里必须自带一份实现，与项目其他模块的口径保持一致。
   */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\u0022/g, '&#34;')
      .replace(/\u0027/g, '&#39;');
  }

  /**
   * 结局探索揭示度档位说明文案。作者选档时同步回显，一眼看懂档位含义。
   * full=100% / major=80% / partial=60% / faint=40%
   */
  function gradeHintText(grade) {
    const HINTS = {
      full: '该副本完成度最高的结局，结局部分解析度拉满。',
      major: '达成即完成了大部分探索，结局部分按 80% 折算。',
      partial: '完成了任务，但真相仍不明朗，结局部分按 60% 折算。',
      faint: '稀里糊涂地抵达了结局，结局部分按 40% 折算。'
    };
    return HINTS[grade] || HINTS.full;
  }

  /**
   * 字符串安全整形：转成字符串并去首尾空白。
   * 本模块是独立 IIFE 闭包，拿不到其他模块的同名私有函数，故自带一份。
   */
  function trimStr(v) {
    return String(v == null ? '' : v).trim();
  }

  /**
   * Blob 转 dataURL。头像必须存 dataURL 而不是 objectURL——
   * objectURL 只在当前页面会话内有效，刷新后引用即失效，卷宗里的头像会全部变成裂图。
   * @param {Blob} blob 图片二进制
   * @returns {Promise<string>} data:image/... 前缀的字符串
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 字节数转可读体积，口径与 data-vault.js / gallery-store.js 一致。
   */
  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * 副本封面的资产键。原先这段在保存、读取、导入三处各写一遍，
   * 键名口径必须完全一致，抽成单一来源避免哪天改了漏一处。
   */
  function coverKeyOf(forkId) {
    return window.DataRegistry
      ? DataRegistry.key.forkCover(forkId)
      : `fork/cover.${forkId}`;
  }

  /**
   * Blob 转纯 base64（不含 data: 前缀）。
   * 与 data-vault.js 的导出口径保持一致，方便两边的包互相解析。
   * @param {Blob} blob 图片二进制
   * @returns {Promise<string>} 纯 base64 字符串
   */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        // reader.result 形如 data:<mime>;base64,xxxx，取逗号后的纯 base64
        const res = String(reader.result || '');
        const comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 纯 base64 还原成 Blob。
   * @param {string} base64 纯 base64（不含 data: 前缀）
   * @param {string} mime 目标 MIME
   * @returns {Blob}
   */
  function base64ToBlob(base64, mime) {
    const byteChars = atob(String(base64 || ''));
    const len = byteChars.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = byteChars.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  // 纯 SVG 图标集（禁止 emoji）
  const ICONS = {
    back: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>`,
    add: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>`,
    user: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    // 5 种触发条件专属纯 SVG 战术微标
    condLocation: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
    condKeyword: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`,
    condTime: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
    condStat: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>`,
    condClue: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7zm2.85 11.1l-.85.6V16h-4v-2.3l-.85-.6C7.8 12.16 7 10.63 7 9c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.63-.8 3.16-2.15 4.1z"/></svg>`,
    condEnding: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v2h14V4H5zm0 14h14v2H5v-2zm7-11c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zm0 8c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/></svg>`,
    emptyBeacon: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>`,
    help: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`
  };

  const TRIGGER_TYPES = [
    { key: 'location', label: '地点触发', icon: ICONS.condLocation },
    { key: 'keyword', label: '关键词触发', icon: ICONS.condKeyword },
    { key: 'time', label: '时间触发', icon: ICONS.condTime },
    { key: 'stat', label: '数值触发', icon: ICONS.condStat },
    { key: 'clue', label: '前置线索', icon: ICONS.condClue }
  ];

  // 数值条件比较符：存枚举不存符号，换显示样式时无需迁移数据
  const STAT_OPS = [
    { key: 'lt', symbol: '<', label: '小于' },
    { key: 'lte', symbol: '≤', label: '小于等于' },
    { key: 'eq', symbol: '=', label: '等于' },
    { key: 'gte', symbol: '≥', label: '大于等于' },
    { key: 'gt', symbol: '>', label: '大于' }
  ];
  const STAT_OP_KEYS = STAT_OPS.map((o) => o.key);

  // 时间触发条件的分位键：年月日时分，留空表示该位不参与匹配
  const TIME_COND_KEYS = ['year', 'month', 'day', 'hour', 'minute'];
  /**
   * 时间触发条件整形：收敛成 { year, month, day, hour, minute } 五位对象。
   * 每位只认纯数字字符串，非数字（含 null/undefined/带符号/带小数）一律回落空串。
   * 留空的位表示「该位不参与匹配」。
   * @param {*} t 任意输入
   * @returns {{year:string,month:string,day:string,hour:string,minute:string}}
   */
  function normalizeTimeCond(t) {
    const src = (t && typeof t === 'object') ? t : {};
    const out = {};
    TIME_COND_KEYS.forEach((k) => {
      const v = src[k];
      const s = (v == null) ? '' : String(v).trim();
      out[k] = /^\d+$/.test(s) ? s : '';
    });
    return out;
  }

  /**
   * 单条数值条件整形 + 老数据迁移。
   * 新结构：{ id, scope:'global'|'char', ownerId, ownerName, metricId, statId(兼容), op, value }
   * 老数据只有 { statId, op, value }，迁成 scope:'global', metricId=statId。
   * @param {object} c 条件对象
   * @param {string} defaultOp 缺省比较符
   * @returns {object} 同一对象引用
   */
  function normalizeStatCond(c, defaultOp) {
    if (typeof c.id !== 'string' || !c.id) {
      c.id = 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }
    if (typeof c.statId !== 'string') c.statId = '';
    // 老数据无 scope：一律按全局迁移（角色数值是新结构，老包里不存在）
    if (c.scope !== 'global' && c.scope !== 'char') {
      c.scope = 'global';
    }
    if (typeof c.ownerId !== 'string') c.ownerId = '';
    if (typeof c.ownerName !== 'string') c.ownerName = '';
    if (typeof c.metricId !== 'string' || !c.metricId) {
      // 迁移：全局条件 metricId 补成 statId
      c.metricId = c.scope === 'global' ? (c.statId || '') : '';
    }
    // 全局条件保持 statId 与 metricId 同步（兼容旧读取路径）
    if (c.scope === 'global' && !c.statId) c.statId = c.metricId;
    if (STAT_OP_KEYS.indexOf(c.op) < 0) c.op = defaultOp;
    if (typeof c.value !== 'string') c.value = c.value == null ? '' : String(c.value);
    return c;
  }

  const LEVEL_OPTIONS = [
    { value: 'E', label: 'E / 静水 STILL', hint: '低危 · 初阶实例' },
    { value: 'D', label: 'D / 流深 DEPTH', hint: '常规 · 深层实例' },
    { value: 'C', label: 'C / 清源 SPRING', hint: '中危 · 源流实例' },
    { value: 'B', label: 'B / 狂澜 SURGE', hint: '高危 · 激变实例' },
    { value: 'A', label: 'A / 潮汐 TIDE', hint: '极危 · 潮汐实例' },
    { value: 'S', label: 'S / 深渊 ABYSS', hint: '灾厄 · 深渊实例' },
    { value: 'S+', label: 'S+ / 归墟 VOID', hint: '终局 · 归墟实例' }
  ];

  // 新建副本的默认等级，与卷宗模板保持一致
  const DEFAULT_LEVEL_KEY = 'C';

  // 概览摘要上限，与 Store 侧索引截断口径一致
  const OVERVIEW_LIMIT = (window.Store && Store.FORK_OVERVIEW_LIMIT) || 120;

  // 单本副本允许接入的执行员人数区间。
  // 自由身份下是手填人数的钳制边界；锁定身份下是预设角色席位数的上限。
  const MIN_ENVOYS = 1;
  const MAX_ENVOYS = 5;

  // 默认数据模板：新建副本时的空白卷宗骨架
  function createDefaultForkData(forkId) {
    return {
      id: forkId || ('fork_' + Date.now()),
      // 创建序号与展陈编号由 Store 在首次保存时按创建顺序自动分配
      seq: 0,
      code: '',
      // 封面存 IndexedDB fork 域资产，卷宗里只留「有没有封面」这个标记
      hasCover: false,
      title: '',
      levelKey: 'C',
      tone: 'obsidian-gold',
      salonId: 'salon_01',
      cleared: false,
      overview: '',
      background: '',
      npcs: [],
      // 绑定同调档案中的副本阵营角色 ID（支持单个兼容与多选数组）
      hazardCharId: null,
      hazardCharIds: [],
      // 执行员接入身份机制：'free' (自由身份) | 'locked' (锁定身份)
      identityType: 'free',
      // 允许进入的执行员人数上限（1-5）。
      // 自由身份下由编纂者手填；锁定身份下以预设角色席位数为准。
      maxEnvoys: 1,
      identityLockedTitle: '',
      identityLockedProfile: '',
      // 锁定身份专属开关：未被选中的锁定角色是否作为 NPC 登场（默认开）。
      // 开启后，执行员接入 A 角色时，其余未选角色会并入副本 NPC 列表由 AI 操控。
      unpickedRolesAsNpc: true,
      locations: [],
      stats: [],
      // 角色数值模板：一个模板一套数值，可绑多个角色；
      // 同一角色全局只能落在一个模板里（互斥），推演时数值来源才唯一确定
      charStats: [],
      clues: [],
      // 开场首帧：进本直接上屏的成品正文，不经模型改写。
      // 与 prologue 分开存 —— prologue 是给模型的导演提示，
      // 混在一起模型会把成品当提示再重写一遍。留空则退回让模型生成开场。
      //
      // ⚠ 开场信息已升维为「多套开场」：真相源在 openings 数组，每套自带
      //   id / bindRoleIds（绑定的锁定角色数组，空数组=通用）/ opening / prologue /
      //   prologueRounds / openingScene。根级的 opening/prologue/... 仅作
      //   向下兼容的镜像保留，normalizeForkData 会把老卷宗平滑迁进 openings[0]。
      opening: '',
      prologue: '',
      prologueRounds: 5,
      openingScene: {
        year: '', month: '', day: '', hour: '', minute: '', weekday: '',
        season: '', temp: '', weather: '',
        locName: '', locSub: '',
        scene: ''
      },
      // 多套开场数组：进本时按接入身份匹配。
      // - bindRoleIds 绑定了角色的开场：用其中任一锁定角色进本时命中；
      // - bindRoleIds 为空 = 通用开场，任何身份都可落回；
      // - 命中多套（含多套通用）时，副本准备页列出让用户挑一套；
      // - 一套都没命中则不注入开场，退回模型自由开场。
      openings: [
        {
          id: 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          bindRoleIds: [],
          opening: '',
          prologue: '',
          prologueRounds: 5,
          openingScene: {
            year: '', month: '', day: '', hour: '', minute: '', weekday: '',
            season: '', temp: '', weather: '',
            locName: '', locSub: '',
            scene: ''
          }
        }
      ],
      hiddenTruth: {
        desc: '',
        triggers: [],
        triggerLogic: 'all',
        locationIds: [],
        keywords: '',
        statConditions: [],
        statLogic: 'all',
        prereqClueIds: [],
        prereqLogic: 'all'
      },
      endings: [],
      clearConditions: []
    };
  }

  let currentForkId = null;
  let currentData = null;
  // 关闭编纂器成功后的一次性回调（供跨页跳转来源指定返回目标，如从 DECK 进来要回推演页）
  let pendingOnClose = null;
  let currentTab = 'core'; // 'core' | 'actor' | 'matrix' | 'plot'
  // 当前编辑中的开场套 id。多套开场共享同一批 DOM 字段，切胶囊即切 active。
  // 取不到（首次进/脏值）时由 getActiveOpening 兜底到首套。
  let currentOpeningId = null;
  // 当前封面的 objectURL 与待写入的 Blob/URL，关页时释放，保存时落库
  let coverObjectUrl = null;
  let pendingCover = undefined; // undefined=未改动, null=待清除, Blob/string=待写入
  // 退出归档进行中：拦住重复点返回导致的并发写库
  let isClosing = false;
  // 页面是否处于打开态：供 isOpen() 查询与 popstate 判定
  let isOpened = false;
  // 身份卡界面刷新器。syncIdentityDisplay 定义在 bindCoreInputs 内层作用域里，
  // 保存兜底（锁定身份无预设角色时回落自由身份）需要跨作用域刷新界面，故挂出来复用。
  let refreshIdentityDisplay = null;

  // DOM 节点引用
  let pageEl = null;
  let backBtn = null;
  let moreBtn = null;
  let menuPopover = null;
  // 导入覆盖专用的隐藏文件选择器
  let importInput = null;
  let tabButtons = [];
  let tabPanels = [];

  /** 释放上一次封面预览的 objectURL，避免反复进出累积泄漏 */
  function releaseCoverUrl() {
    if (coverObjectUrl && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
      Storage.revokeAssetSrc(coverObjectUrl);
    }
    coverObjectUrl = null;
  }

  /**
   * 隔离执行单个渲染/绑定环节。
   *
   * 编纂器由十来个互不依赖的模块拼成，过去它们在 open() 里裸调用，
   * 任何一处抛错都会让后面的显示语句执行不到，整本卷宗从此打不开。
   * 这里把每块单独围起来：坏掉的那块留空，其余照常可用，页面照常打开。
   * @param {string} name 环节名，仅用于告警定位
   * @param {Function} fn 实际执行体
   */
  function runIsolated(name, fn) {
    try {
      fn();
    } catch (err) {
      console.warn(`[ForkEditor] 「${name}」渲染失败，已跳过该模块：`, err);
    }
  }

  /**
   * 回显展陈编号。已归档的沿用既有编号；从未保存过的按当前索引
   * 预告即将领到的号，让人在保存前就知道这本会排到第几。
   */
  function syncCodeDisplay() {
    const el = document.getElementById('forkCodeValue');
    if (!el || !currentData) return;

    if (currentData.code) {
      el.textContent = currentData.code;
      el.classList.remove('is-pending');
      return;
    }

    let preview = 'FORK-001';
    if (window.Store && typeof Store.nextForkSeq === 'function' && typeof Store.forkCodeOf === 'function') {
      preview = Store.forkCodeOf(Store.nextForkSeq());
    }
    el.textContent = preview;
    el.classList.add('is-pending');
  }

  /**
   * 卷宗字段整形：把老卷宗里形状不对的字段校正回模板预期的类型。
   *
   * Object.assign 只能补「缺失」的键，补不了「存在但为 null」的键——
   * 旧版存下的 npcs: null 会直接盖掉模板里的 []，随后 forEach 就抛
   * TypeError，把整个 open() 打断。这里统一兜住，读多少修多少。
   * @param {object} data 已与默认模板合并过的卷宗
   * @returns {object} 同一个对象引用，字段已就地校正
   */
  function normalizeForkData(data) {
    if (!data || typeof data !== 'object') return data;

    // 列表类字段一律保证是数组，元素为对象
    const LIST_FIELDS = ['npcs', 'locations', 'stats', 'charStats', 'clues', 'endings', 'clearConditions', 'lockedRoles'];
    LIST_FIELDS.forEach((field) => {
      if (!Array.isArray(data[field])) {
        data[field] = [];
        return;
      }
      data[field] = data[field].filter((it) => it && typeof it === 'object');
    });

    // 角色数值模板整形：内层数值项保证是数组，绑定 ID 去重去空。
    // 互斥兜底 —— 导入的 JSON 不可信，同一角色若出现在多个模板里，
    // 只认第一个模板，后面的直接剔除，保证数值来源唯一。
    const seenCharIds = new Set();
    const seenNpcIds = new Set();
    data.charStats.forEach((tpl) => {
      if (!Array.isArray(tpl.metrics)) {
        tpl.metrics = [];
      } else {
        tpl.metrics = tpl.metrics.filter((m) => m && typeof m === 'object');
      }
      // 模板不需要名字与说明：它只是「一套数值 + 一批角色」的容器，
      // 起名对剧情和模型都没有意义，身份由绑定了谁来标识。老卷宗里的残留字段直接丢掉。
      delete tpl.name;
      delete tpl.desc;
      if (typeof tpl.id !== 'string' || !tpl.id) {
        tpl.id = 'cstat_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }

      const dedupe = (raw, seen) => {
        const list = Array.isArray(raw) ? raw : [];
        const out = [];
        list.forEach((id) => {
          if (typeof id !== 'string' || !id) return;
          if (seen.has(id)) return;
          seen.add(id);
          out.push(id);
        });
        return out;
      };
      tpl.charIds = dedupe(tpl.charIds, seenCharIds);
      tpl.npcIds = dedupe(tpl.npcIds, seenNpcIds);
    });

    // 锁定身份角色池向下兼容：老卷宗只有 identityLockedTitle 时平滑迁移为 lockedRoles[0]
    if (data.lockedRoles.length === 0 && (data.identityLockedTitle || data.identityLockedProfile)) {
      data.lockedRoles.push({
        id: 'role_' + Date.now(),
        name: data.identityLockedTitle || '',
        gender: '',
        avatar: '',
        profile: data.identityLockedProfile || ''
      });
    }

    // 预设角色文本字段整形：性别是后补的字段，老卷宗读出来是 undefined，
    // 直接塞进 input.value 会显示字符串 "undefined"，落到 escapeHtml 也会出意外。
    // 姓名与设定同理兜一道，导入的 JSON 里这些位置塞 null / number 都有可能。
    data.lockedRoles.forEach((role) => {
      ['name', 'gender', 'avatar', 'profile'].forEach((field) => {
        if (typeof role[field] !== 'string') {
          role[field] = role[field] == null ? '' : String(role[field]);
        }
      });
    });

    // 接入人数整形。锁定身份的真相源是席位数（有几个壳就只能进几个人），
    // 自由身份才认手填值。老卷宗没有这个字段，按当前模式推算一个出来。
    // 注意：超编的老数据（席位数 > 上限）不截断，宁可显示超额也不静默删角色设定。
    if (data.identityType === 'locked') {
      data.maxEnvoys = Math.max(MIN_ENVOYS, data.lockedRoles.length);
    } else {
      const raw = Math.floor(Number(data.maxEnvoys));
      data.maxEnvoys = Number.isFinite(raw)
        ? Math.min(MAX_ENVOYS, Math.max(MIN_ENVOYS, raw))
        : MIN_ENVOYS;
    }

    // 线索数据整形：保障 triggers 与 locationIds 数组及 keywords 字符串
    data.clues.forEach((clue) => {
      if (!Array.isArray(clue.triggers)) clue.triggers = [];
      if (!Array.isArray(clue.locationIds)) clue.locationIds = [];
      if (typeof clue.keywords !== 'string') clue.keywords = '';
      // 时间触发：分位时间对象，每位是纯数字字符串，留空表示该位不参与匹配
      clue.time = normalizeTimeCond(clue.time);
      // 跨类型触发逻辑：只认 any / all 两个枚举，脏值一律回落 any
      if (clue.triggerLogic !== 'any' && clue.triggerLogic !== 'all') clue.triggerLogic = 'any';
      // 数值条件：内部默认 all（加码门槛才是作者写多条的常见意图）
      if (clue.statLogic !== 'any' && clue.statLogic !== 'all') clue.statLogic = 'all';
      if (!Array.isArray(clue.statConditions)) {
        clue.statConditions = [];
      } else {
        clue.statConditions = clue.statConditions
          .filter((c) => c && typeof c === 'object')
          .map((c) => normalizeStatCond(c, 'gte'));
      }
      // 前置线索：默认 all（多选前置通常是「这些都得先知道」）
      if (clue.prereqLogic !== 'any' && clue.prereqLogic !== 'all') clue.prereqLogic = 'all';
      // 自我依赖恒为死锁，这里硬删而非提示；失效的外部 id 保留等作者换绑
      if (!Array.isArray(clue.prereqClueIds)) {
        clue.prereqClueIds = [];
      } else {
        clue.prereqClueIds = Array.from(new Set(
          clue.prereqClueIds.filter((id) => typeof id === 'string' && id && id !== clue.id)
        ));
      }
    });

    // 隐藏真相：必须是带 desc 字符串与 triggers 数组的对象。
    // 触发参数与线索卡同构，旧卷宗只有 desc + triggers，这里补齐其余字段兜底
    if (!data.hiddenTruth || typeof data.hiddenTruth !== 'object') {
      data.hiddenTruth = { desc: '', triggers: [] };
    } else {
      if (typeof data.hiddenTruth.desc !== 'string') data.hiddenTruth.desc = '';
      if (!Array.isArray(data.hiddenTruth.triggers)) data.hiddenTruth.triggers = [];
    }

    const truth = data.hiddenTruth;
    // 跨类型逻辑：默认 all，揭示终局真相通常要求条件齐备
    if (truth.triggerLogic !== 'any' && truth.triggerLogic !== 'all') truth.triggerLogic = 'all';
    if (!Array.isArray(truth.locationIds)) {
      truth.locationIds = [];
    } else {
      truth.locationIds = truth.locationIds.filter((id) => typeof id === 'string' && id);
    }
    if (typeof truth.keywords !== 'string') truth.keywords = '';
    truth.time = normalizeTimeCond(truth.time);
    if (truth.statLogic !== 'any' && truth.statLogic !== 'all') truth.statLogic = 'all';
    if (!Array.isArray(truth.statConditions)) {
      truth.statConditions = [];
    } else {
      truth.statConditions = truth.statConditions
        .filter((c) => c && typeof c === 'object')
        .map((c) => normalizeStatCond(c, 'lte'));
    }
    if (truth.prereqLogic !== 'any' && truth.prereqLogic !== 'all') truth.prereqLogic = 'all';
    if (!Array.isArray(truth.prereqClueIds)) {
      truth.prereqClueIds = [];
    } else {
      truth.prereqClueIds = Array.from(new Set(
        truth.prereqClueIds.filter((id) => typeof id === 'string' && id)
      ));
    }

    // 结局分支：触发参数与线索卡同构，旧卷宗只有 name/desc/triggers，
    // 这里补齐其余参数字段，读进来即可直接被公共渲染器接管
    data.endings.forEach((ending) => {
      if (typeof ending.id !== 'string' || !ending.id) {
        ending.id = 'end_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      if (typeof ending.name !== 'string') ending.name = ending.name == null ? '' : String(ending.name);
      if (typeof ending.desc !== 'string') ending.desc = ending.desc == null ? '' : String(ending.desc);
      if (!Array.isArray(ending.triggers)) ending.triggers = [];
      // 跨类型逻辑：默认 all，走向特定结局通常要求条件齐备
      if (ending.triggerLogic !== 'any' && ending.triggerLogic !== 'all') ending.triggerLogic = 'all';
      if (!Array.isArray(ending.locationIds)) {
        ending.locationIds = [];
      } else {
        ending.locationIds = ending.locationIds.filter((id) => typeof id === 'string' && id);
      }
      if (typeof ending.keywords !== 'string') ending.keywords = '';
      // 结局品级（探索揭示度）：full=100% / major=80% / partial=60% / faint=40%
      // 旧卷宗无此字段默认 full（满档），不改变现有解析度表现
      if (!['full', 'major', 'partial', 'faint'].includes(ending.grade)) ending.grade = 'full';
      ending.time = normalizeTimeCond(ending.time);
      if (ending.statLogic !== 'any' && ending.statLogic !== 'all') ending.statLogic = 'all';
      if (!Array.isArray(ending.statConditions)) {
        ending.statConditions = [];
      } else {
        ending.statConditions = ending.statConditions
          .filter((c) => c && typeof c === 'object')
          .map((c) => normalizeStatCond(c, 'lte'));
      }
      if (ending.prereqLogic !== 'any' && ending.prereqLogic !== 'all') ending.prereqLogic = 'all';
      if (!Array.isArray(ending.prereqClueIds)) {
        ending.prereqClueIds = [];
      } else {
        ending.prereqClueIds = Array.from(new Set(
          ending.prereqClueIds.filter((id) => typeof id === 'string' && id)
        ));
      }
    });

    // 主线任务：任务内容与达成判定拆为两栏。
    // 旧卷宗只有单字段 text，这里迁进 goal 并补空 criteria，一个字都不丢
    data.clearConditions.forEach((mission) => {
      if (typeof mission.goal !== 'string' || !mission.goal) {
        mission.goal = typeof mission.text === 'string' ? mission.text : '';
      }
      if (typeof mission.criteria !== 'string') mission.criteria = '';
      if (typeof mission.id !== 'string' || !mission.id) {
        mission.id = 'cc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      }
      // 阶段任务：前置任务全部/任一完成后才解锁。老卷宗无此字段，补空数组 = 开局即解锁
      if (mission.prereqLogic !== 'any' && mission.prereqLogic !== 'all') mission.prereqLogic = 'all';
      if (!Array.isArray(mission.prereqIds)) {
        mission.prereqIds = [];
      } else {
        mission.prereqIds = Array.from(new Set(
          mission.prereqIds.filter((id) => typeof id === 'string' && id && id !== mission.id)
        ));
      }
      // text 保留为镜像，老版本读盘时仍能看到任务内容
      mission.text = mission.goal;
    });

    // 高危角色：旧版单值 hazardCharId 升维进多选数组，去重去空
    let ids = Array.isArray(data.hazardCharIds) ? data.hazardCharIds : [];
    if (ids.length === 0 && data.hazardCharId) ids = [data.hazardCharId];
    ids = ids.filter((id) => typeof id === 'string' && id);
    data.hazardCharIds = Array.from(new Set(ids));
    data.hazardCharId = data.hazardCharIds[0] || null;

    // 文本类字段：null / number 都会让 .value 赋值与 escapeHtml 出意外
    ['title', 'overview', 'background', 'opening', 'prologue', 'identityLockedTitle', 'identityLockedProfile', 'code', 'salonId', 'tone', 'levelKey']
      .forEach((field) => {
        if (typeof data[field] !== 'string') {
          data[field] = data[field] == null ? '' : String(data[field]);
        }
      });

    // 开场场景舞台整形：老卷宗没有这个字段（读出 undefined）、或存成 null，
    // 直接读子字段会抛 TypeError。统一兜住并把每个子字段收敛成字符串。
    if (!data.openingScene || typeof data.openingScene !== 'object') {
      data.openingScene = {};
    }
    ['year', 'month', 'day', 'hour', 'minute', 'weekday', 'season', 'temp', 'weather', 'locName', 'locSub', 'scene']
      .forEach((k) => {
        const v = data.openingScene[k];
        data.openingScene[k] = (v == null) ? '' : String(v);
      });

    // 身份机制只认这两个枚举值，脏值一律回落到自由身份
    if (data.identityType !== 'free' && data.identityType !== 'locked') {
      data.identityType = 'free';
    }
    if (!data.levelKey) data.levelKey = DEFAULT_LEVEL_KEY;

    data.cleared = !!data.cleared;
    data.hasCover = !!data.hasCover;

    // 未选锁定角色作为 NPC 登场：默认开。老卷宗无此字段读出 undefined，回落到 true
    data.unpickedRolesAsNpc = (data.unpickedRolesAsNpc === undefined || data.unpickedRolesAsNpc === null)
      ? true
      : !!data.unpickedRolesAsNpc;

    // 开场情节持续轮数：取正整数；留空 / 0 / 非法值一律回落到 1
    const rounds = parseInt(data.prologueRounds, 10);
    data.prologueRounds = (Number.isFinite(rounds) && rounds >= 1) ? rounds : 1;

    // ============ 多套开场整形与老数据平滑迁移 ============
    // openings 是开场信息的真相源。老卷宗只有根级 opening/prologue/openingScene，
    // 这里把它们打包成 openings[0]（通用开场，bindRoleIds 空数组）。
    // 已有 openings 的逐套整形：id 补全、bindRoleIds 校验（绑的角色已不在
    // lockedRoles 里就清空回落通用）、prologueRounds 钳正、openingScene 子字段收敛。
    const validRoleIds = new Set(
      (Array.isArray(data.lockedRoles) ? data.lockedRoles : [])
        .map((r) => r && r.id)
        .filter((id) => typeof id === 'string' && id)
    );
    const genOpeningId = () => 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const SCENE_KEYS = ['year', 'month', 'day', 'hour', 'minute', 'weekday', 'season', 'temp', 'weather', 'locName', 'locSub', 'scene'];
    const normalizeOpening = (op) => {
      const o = (op && typeof op === 'object') ? op : {};
      if (typeof o.id !== 'string' || !o.id) o.id = genOpeningId();
      // 绑定角色升维：旧版单值 bindRoleId → 数组 bindRoleIds。
      // 只保留仍存在于 lockedRoles 的 id，去重；失效/空一律视为通用开场
      let binds = Array.isArray(o.bindRoleIds) ? o.bindRoleIds : [];
      if (binds.length === 0 && typeof o.bindRoleId === 'string' && o.bindRoleId) {
        binds = [o.bindRoleId];
      }
      o.bindRoleIds = Array.from(new Set(
        binds.filter((id) => typeof id === 'string' && validRoleIds.has(id))
      ));
      delete o.bindRoleId;
      o.opening = (typeof o.opening === 'string') ? o.opening : (o.opening == null ? '' : String(o.opening));
      o.prologue = (typeof o.prologue === 'string') ? o.prologue : (o.prologue == null ? '' : String(o.prologue));
      const r = parseInt(o.prologueRounds, 10);
      o.prologueRounds = (Number.isFinite(r) && r >= 1) ? r : 1;
      if (!o.openingScene || typeof o.openingScene !== 'object') o.openingScene = {};
      SCENE_KEYS.forEach((k) => {
        const v = o.openingScene[k];
        o.openingScene[k] = (v == null) ? '' : String(v);
      });
      return o;
    };

    if (!Array.isArray(data.openings)) data.openings = [];
    data.openings = data.openings.filter((o) => o && typeof o === 'object').map(normalizeOpening);
    if (data.openings.length === 0) {
      // 老卷宗迁移：把根级开场字段包成首套通用开场
      data.openings.push(normalizeOpening({
        bindRoleIds: [],
        opening: data.opening,
        prologue: data.prologue,
        prologueRounds: data.prologueRounds,
        openingScene: data.openingScene
      }));
    }
    // 根级镜像回写首套通用开场（向下兼容旧读取路径：seedOpeningFrame 等）
    const primary = data.openings.find((o) => o.bindRoleIds.length === 0) || data.openings[0];
    if (primary) {
      data.opening = primary.opening;
      data.prologue = primary.prologue;
      data.prologueRounds = primary.prologueRounds;
      data.openingScene = primary.openingScene;
    }

    return data;
  }

  /**
   * 取当前编辑中的开场套。currentOpeningId 命中就返回它，
   * 否则兜底到首套（并回写 currentOpeningId），保证永远拿得到一套可写对象。
   * openings 为空时即时补一套通用开场（防御性，正常经 normalize 不会空）。
   */
  function getActiveOpening() {
    if (!currentData) return null;
    if (!Array.isArray(currentData.openings)) currentData.openings = [];
    if (currentData.openings.length === 0) {
      currentData.openings.push({
        id: 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        bindRoleIds: [],
        opening: '', prologue: '', prologueRounds: 5,
        openingScene: {
          year: '', month: '', day: '', hour: '', minute: '', weekday: '',
          season: '', temp: '', weather: '', locName: '', locSub: '', scene: ''
        }
      });
    }
    let op = currentData.openings.find((o) => o && o.id === currentOpeningId);
    if (!op) {
      op = currentData.openings[0];
      currentOpeningId = op.id;
    }
    if (!op.openingScene || typeof op.openingScene !== 'object') op.openingScene = {};
    return op;
  }

  /**
   * 读取副本卷宗：IndexedDB 分条懒加载，无卷宗则给空白模板
   * @returns {Promise<object>}
   */
  async function loadForkData(forkId) {
    if (window.Store && typeof Store.loadForkDossier === 'function') {
      const saved = await Store.loadForkDossier(forkId);
      if (saved) {
        // 与模板合并，补齐后续新增字段，再统一整形修正脏形状
        return normalizeForkData(
          Object.assign(createDefaultForkData(forkId), saved, { id: forkId })
        );
      }
    }
    return createDefaultForkData(forkId);
  }

  /**
   * 保存副本卷宗到 IndexedDB，并同步封面资产与油画墙索引
   * @param {object} [opts]
   * @param {boolean} [opts.silent=false] 成功时不弹 Toast（导入覆盖等自带反馈的场景用）
   * @returns {Promise<boolean>} 是否归档成功。失败时已弹 Toast，调用方据此决定是否放行退出
   */
  async function saveForkData(opts) {
    const silent = !!(opts && opts.silent);
    if (!currentForkId || !currentData) return false;

    // 锁定身份兜底：选了「锁定身份」却没指派任何预设角色，等于锁了身份却没有身体
    // 可接入，进本会出现逻辑空洞。落库前统一回落到自由身份，并同步界面与提示。
    if (
      currentData.identityType === 'locked' &&
      (!Array.isArray(currentData.lockedRoles) || currentData.lockedRoles.length === 0)
    ) {
      currentData.identityType = 'free';
      // 界面可能还没绑定（未进过核心页），有刷新器才同步，避免抛错打断归档
      if (typeof refreshIdentityDisplay === 'function') {
        try {
          refreshIdentityDisplay();
        } catch (e) {
          console.warn('[ForkEditor] 身份回落刷新异常：', e);
        }
      }
      // 这是对用户选择的实质性修正，即便 silent 保存也照常告知
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'EDITOR // 身份回落',
          message: '未指派预设角色，已自动切换为自由身份',
          detail: '锁定身份需至少配置一个预设角色供执行员接入',
          type: 'warn'
        });
      }
    }

    // 接入人数落库前对齐：锁定身份认席位数，自由身份认手填值并钳到 1-5。
    // 上面的身份回落可能刚改过 identityType，所以必须放在它之后再算一次。
    // 超编的老数据保留原值，不静默截断已有角色设定。
    if (currentData.identityType === 'locked') {
      const roles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
      currentData.maxEnvoys = Math.max(MIN_ENVOYS, roles.length);
    } else {
      const n = Math.floor(Number(currentData.maxEnvoys));
      currentData.maxEnvoys = Number.isFinite(n)
        ? Math.min(MAX_ENVOYS, Math.max(MIN_ENVOYS, n))
        : MIN_ENVOYS;
    }
    try {
      const coverKey = coverKeyOf(currentForkId);

      // 开场根级镜像同步：openings 是真相源，但 seedOpeningFrame 等旧读取路径
      // 仍读根级 opening/prologue/prologueRounds/openingScene。落库前把首套
      // 通用开场（没有通用套则取首套）镜像回根级，避免两侧不一致。
      if (Array.isArray(currentData.openings) && currentData.openings.length > 0) {
        const primary = currentData.openings.find((o) => o && Array.isArray(o.bindRoleIds) && o.bindRoleIds.length === 0) || currentData.openings[0];
        if (primary) {
          currentData.opening = primary.opening || '';
          currentData.prologue = primary.prologue || '';
          currentData.prologueRounds = primary.prologueRounds || 1;
          currentData.openingScene = primary.openingScene || {};
        }
      }


      // 封面：只在本次有改动时落库，避免每次保存都重写二进制
      if (pendingCover === null) {
        await Storage.removeAsset(coverKey);
        currentData.hasCover = false;
      } else if (pendingCover !== undefined) {
        await Storage.setAsset(coverKey, pendingCover);
        currentData.hasCover = true;
      }
      pendingCover = undefined;

      const ok = await Store.saveForkDossier(currentForkId, currentData);
      if (!ok) throw new Error('IndexedDB 写入未成功');

      // 首次归档会领到正式编号，回填顶部只读回显
      syncCodeDisplay();

      // 展墙聚焦到该副本所属展厅并重绘，跨展厅新建也能立刻看到那幅画
      if (window.ForkArchiveUI && typeof window.ForkArchiveUI.focusFork === 'function') {
        window.ForkArchiveUI.focusFork(currentForkId);
      } else if (window.ForkArchiveUI && typeof window.ForkArchiveUI.buildCurrentSalon === 'function') {
        window.ForkArchiveUI.buildCurrentSalon();
      }

      if (!silent && window.RetroToast) {
        window.RetroToast.show({
          tag: 'EDITOR // 档案同步',
          message: '副本卷宗已成功归档',
          detail: `${currentData.code || '未编号'} · ${currentData.title || '未命名副本'}`,
          type: 'success'
        });
      }
      return true;
    } catch (e) {
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'EDITOR // 写入异常',
          message: '卷宗归档失败',
          detail: String(e.message || e),
          type: 'error'
        });
      }
      return false;
    }
  }

  /**
   * 切换 Tab 导轨
   */
  function switchTab(tabKey) {
    currentTab = tabKey;
    tabButtons.forEach((btn) => {
      const isCurrent = btn.dataset.tab === tabKey;
      btn.classList.toggle('active', isCurrent);
      btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });

    tabPanels.forEach((panel) => {
      const isCurrent = panel.dataset.panel === tabKey;
      panel.classList.toggle('active', isCurrent);
      panel.hidden = !isCurrent;
    });

    // 切换后滚回内容区顶部
    const scrollWrap = document.getElementById('forkEditorScroll');
    if (scrollWrap) scrollWrap.scrollTop = 0;
  }

  /**
   * 从同调档案中收集副本阵营（camp === 'instance'）角色
   * 单一真相源是 Store.roster，不再走任何 localStorage 缓存或示例兜底
   */
  function collectInstanceCharacters() {
    if (!window.Store || !Store.roster) return [];
    const pools = [Store.roster.characters, Store.roster.npcs];
    const list = [];
    pools.forEach((pool) => {
      (Array.isArray(pool) ? pool : []).forEach((item) => {
        if (item && item.camp === 'instance') list.push(item);
      });
    });
    return list;
  }

  /**
   * 规范化获取当前已选高危角色 ID 列表（兼容旧版单 ID 与新版数组）
   */
  function getHazardCharIds() {
    if (Array.isArray(currentData.hazardCharIds) && currentData.hazardCharIds.length > 0) {
      return currentData.hazardCharIds.slice();
    }
    if (currentData.hazardCharId) {
      return [currentData.hazardCharId];
    }
    return [];
  }

  /**
   * 渲染高危角色卡片（战术面板 + 底部全宽机能插槽）
   */
  function renderHazardCharacterCard() {
    const container = document.getElementById('forkHazardCharContainer');
    const statusTag = document.getElementById('forkHazardStatusTag');
    if (!container) return;

    const charIds = getHazardCharIds();

    if (statusTag) {
      statusTag.textContent = charIds.length === 0
        ? 'UNLINKED // 暂无介入'
        : `CONTAINMENT // ${charIds.length} 位介入`;
      statusTag.classList.toggle('is-linked', charIds.length > 0);
    }

    if (charIds.length === 0) {
      container.innerHTML = `
        <div class="fork-hazard-empty-pod">
          <!-- 上部：舒展的机制解析面板 -->
          <div class="fork-hazard-desc-panel">
            <div class="fork-hazard-desc-icon">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <!-- 战术准星雷达瞄准微标 -->
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/>
                <line x1="12" y1="2" x2="12" y2="6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <line x1="2" y1="12" x2="6" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <line x1="18" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
              </svg>
            </div>
            <div class="fork-hazard-desc-meta">
              <span class="fork-hazard-desc-code">BEACON // 副本阵营角色联动</span>
              <p class="fork-hazard-desc-text">从同调档案中选择副本阵营角色加入副本。觉醒者将视为副本原生角色，漫游者将视为外来介入角色。</p>
            </div>
          </div>

          <!-- 下部：全宽机能插槽按钮 -->
          <button type="button" class="fork-hazard-full-add-btn" id="forkPickHazardBtn" title="从同调档案选择副本阵营角色">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
            </svg>
            <span>选择高危角色</span>
          </button>
        </div>
      `;
      const btn = document.getElementById('forkPickHazardBtn');
      if (btn) btn.addEventListener('click', openCharPickerModal);
      return;
    }

    // 查到所有匹配的角色对象
    const allChars = collectInstanceCharacters();
    const targets = charIds.map((id) => {
      const match = allChars.find((c) => c.id === id);
      return match || {
        id,
        name: '未知觉醒者',
        gender: '未知',
        rank: 'awakened',
        profile: '因果信标断联，该角色的档案切片未能完整解析。'
      };
    });

    // 渲染卡片阵列
    container.innerHTML = `
      <div class="fork-hazard-deck">
        <div class="fork-hazard-cards-list">
          ${targets.map((target, idx) => {
            const isAwakened = target.rank === 'awakened';
            const roleTag = isAwakened ? 'AWAKENED // 觉醒者' : 'DRIFTER // 漫游者';
            const rankClass = isAwakened ? 'is-awakened' : 'is-drifter';
            return `
              <div class="fork-hazard-card ${rankClass}" data-char-id="${target.id}">
                <div class="fork-hazard-main-row">
                  <div class="fork-hazard-avatar-box" id="forkHazardAvatarBox_${target.id}">
                    <div class="fork-hazard-avatar-ph">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    </div>
                    <span class="fork-hazard-vessel-badge">${String(idx + 1).padStart(2, '0')}</span>
                  </div>
                  <div class="fork-hazard-meta-col">
                    <div class="fork-hazard-name-row">
                      <span class="fork-hazard-name">${escapeHtml(target.name || '未命名')}</span>
                      <span class="fork-hazard-gender-tag">${escapeHtml(target.gender || '保密')}</span>
                      <button type="button" class="fork-hazard-single-remove-btn" data-remove-id="${target.id}" title="移除该高危角色" aria-label="移除角色">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                        </svg>
                      </button>
                    </div>
                    <div class="fork-hazard-role-hint ${rankClass}">${roleTag}</div>
                    <p class="fork-hazard-desc">${escapeHtml(target.profile || '暂无设定描述')}</p>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- 底部通栏追加按钮 -->
        <button type="button" class="fork-hazard-append-btn" id="forkHazardAppendBtn" title="追加高危角色">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
          </svg>
          <span>追加高危角色</span>
        </button>
      </div>
    `;

    // 异步挂接所有已选角色的头像
    targets.forEach((t) => hydrateHazardAvatar(t.id));

    // 绑定底部追加按钮
    document.getElementById('forkHazardAppendBtn')?.addEventListener('click', openCharPickerModal);

    // 绑定单个卡片右上角的快速移除
    container.querySelectorAll('.fork-hazard-single-remove-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const removeId = btn.dataset.removeId;
        currentData.hazardCharIds = getHazardCharIds().filter((id) => id !== removeId);
        currentData.hazardCharId = currentData.hazardCharIds[0] || null;
        renderHazardCharacterCard();
      });
    });
  }

  /**
   * 取回高危角色立绘：角色档案与 NPC 各有一套键名，依次探测
   */
  async function hydrateHazardAvatar(charId) {
    if (!charId || !window.Storage || !window.DataRegistry) return;
    const keys = [
      DataRegistry.key.charAvatar(charId),
      DataRegistry.key.npcAvatar(charId)
    ];
    for (const key of keys) {
      let src = '';
      try {
        src = await Storage.getAssetSrc(key);
      } catch (_) { continue; }
      if (!src) continue;
      const box = document.getElementById(`forkHazardAvatarBox_${charId}`);
      if (!box) {
        Storage.revokeAssetSrc(src);
        return;
      }
      // 先取出原有序号徽标文本，再重绘，避免读到已被覆盖的空节点
      const badgeText = box.querySelector('.fork-hazard-vessel-badge')?.textContent || '';
      box.innerHTML = `
        <img src="${src}" alt="高危角色立绘" class="fork-hazard-avatar-img">
        <span class="fork-hazard-vessel-badge">${escapeHtml(badgeText)}</span>
      `;
      return;
    }
  }

  /**
   * 通过项目通用 SelectModal.pickMulti 多选指派同调档案中的高危角色。
   * 取消时保持当前绑定不变；确认后统一回显卡片阵列。
   */
  async function openCharPickerModal() {
    if (!window.SelectModal || typeof window.SelectModal.pickMulti !== 'function') return;

    const chars = collectInstanceCharacters();
    const currentIds = getHazardCharIds();

    const picked = await window.SelectModal.pickMulti({
      title: '指派高危角色',
      tag: 'RESONANCE // 副本阵营',
      options: chars.map((c) => {
        const isAwk = c.rank === 'awakened';
        const tag = isAwk ? '觉醒者 (原生)' : '漫游者 (介入)';
        return {
          value: c.id,
          label: c.name || '未命名角色',
          hint: `${c.gender || '保密'} · ${tag} · ${c.profile || '暂无设定摘要'}`,
          group: isAwk ? '觉醒者 (副本原生)' : '漫游者 (外来介入)'
        };
      }),
      values: currentIds,
      confirmText: '确认选择',
      searchable: chars.length > 6
    });

    if (!Array.isArray(picked)) return;
    currentData.hazardCharIds = picked;
    currentData.hazardCharId = picked[0] || null;
    renderHazardCharacterCard();
  }

  /**
   * 渲染战术机能空态槽（物理微凹槽 + 幽灵框架 + 状态指示灯）
   * 严格遵守《工地施工协议》：绝无 emoji，纯 SVG 微标，无任何实体分割线。
   * 点击直接联动触发对应板块的添加按钮，兼顾美学厚重感与交互流畅度。
   */
  function renderEmptySlot(wrapEl, options) {
    if (!wrapEl) return;
    const {
      slotCode = 'STANDBY // 00',
      title = '暂无档案装填',
      hint = '点击此处或右上角「添加」进行首项编纂',
      iconSvg = ICONS.emptyBeacon,
      triggerBtnId = null
    } = options || {};

    const slotEl = document.createElement('div');
    slotEl.className = 'fork-matrix-empty-slot';
    slotEl.setAttribute('role', 'button');
    slotEl.setAttribute('tabindex', '0');
    slotEl.innerHTML = `
      <div class="fork-empty-beacon-row">
        <span class="fork-empty-slot-code">${escapeHtml(slotCode)}</span>
        <div class="fork-empty-beacon-pulse">
          <span class="fork-empty-beacon-dot"></span>
          <span class="fork-empty-beacon-label">READY</span>
        </div>
      </div>
      <div class="fork-empty-ghost-body">
        <div class="fork-empty-ghost-icon">${iconSvg}</div>
        <div class="fork-empty-ghost-text">
          <span class="fork-empty-ghost-title">${escapeHtml(title)}</span>
          <span class="fork-empty-ghost-hint">${escapeHtml(hint)}</span>
        </div>
      </div>
    `;

    if (triggerBtnId) {
      slotEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = document.getElementById(triggerBtnId);
        if (btn) btn.click();
      });
    }

    wrapEl.appendChild(slotEl);
  }

  /**
   * 渲染触发条件 Chips 组（纯 SVG，支持 5 种触发条件多选）
   */
  function renderTriggerChips(selectedTriggers, onToggleCallback) {
    const wrap = document.createElement('div');
    wrap.className = 'fork-trigger-chips-row';

    TRIGGER_TYPES.forEach((item) => {
      const isSelected = selectedTriggers.includes(item.key);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `fork-trigger-chip ${isSelected ? 'is-active' : ''}`;
      chip.dataset.key = item.key;
      chip.innerHTML = `
        <span class="fork-trigger-chip-icon">${item.icon}</span>
        <span class="fork-trigger-chip-label">${item.label}</span>
      `;
      chip.addEventListener('click', () => {
        let next;
        if (selectedTriggers.includes(item.key)) {
          next = selectedTriggers.filter((k) => k !== item.key);
        } else {
          next = [...selectedTriggers, item.key];
        }
        onToggleCallback(next);
      });
      wrap.appendChild(chip);
    });

    return wrap;
  }

  /**
   * 渲染 NPC 动态列表
   */
  function renderNpcList() {
    const listWrap = document.getElementById('forkNpcList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.npcs) || currentData.npcs.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'AGENT // NPC-00',
        title: '未载入剧情角色',
        hint: '点击此处或右上角「添加」指派此副本常驻或过客 NPC',
        iconSvg: ICONS.user,
        triggerBtnId: 'forkAddNpcBtn'
      });
      return;
    }

    currentData.npcs.forEach((npc, index) => {
      const card = document.createElement('div');
      card.className = 'fork-bento-accordion-card';
      card.innerHTML = `
        <div class="fork-accordion-header" role="button" tabindex="0">
          <span class="fork-accordion-code">NPC-${String(index + 1).padStart(2, '0')}</span>
          <span class="fork-accordion-title">${npc.name || '未命名NPC'}</span>
          <span class="fork-accordion-tag">${npc.gender || '未知'}</span>
          <div class="fork-accordion-spacer"></div>
          <button type="button" class="fork-btn-icon-del" data-del-index="${index}" title="删除此NPC" aria-label="删除此NPC">
            ${ICONS.trash}
          </button>
          <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
        </div>
        <div class="fork-accordion-body">
          <div class="fork-npc-identity-row">
            <div class="fork-npc-avatar-box" data-npc-avatar tabindex="0" role="button" title="点击上传 NPC 头像 (1:1 比例)">
              <img class="fork-npc-avatar-img" alt="" ${npc.avatar ? '' : 'hidden'} ${npc.avatar ? `src="${npc.avatar}"` : ''}>
              <div class="fork-npc-avatar-ph" ${npc.avatar ? 'hidden' : ''}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
              </div>
              <div class="fork-npc-avatar-edit-badge" aria-hidden="true">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </div>
            </div>
            <div class="fork-field-block fork-npc-name-block">
              <label class="fork-field-label">NPC 姓名</label>
              <input type="text" class="fork-input-text npc-name-input" value="${npc.name || ''}" placeholder="输入NPC姓名">
            </div>
            <div class="fork-field-block fork-npc-gender-block">
              <label class="fork-field-label">性别</label>
              <input type="text" class="fork-input-text npc-gender-input" value="${npc.gender || ''}" placeholder="如：男 / 机械构装">
            </div>
          </div>
          <div class="fork-field-block" style="margin-top: 10px;">
            <label class="fork-field-label">NPC 角色设定与剧本动机</label>
            <textarea class="fork-textarea npc-desc-input" rows="3" placeholder="详细输入该NPC在此副本中的背景、动机与交互逻辑...">${npc.desc || ''}</textarea>
          </div>
        </div>
      `;

      // 折叠展开
      const header = card.querySelector('.fork-accordion-header');
      header.addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        card.classList.toggle('is-expanded');
      });

      // 删除
      card.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.npcs.splice(index, 1);
        renderNpcList();
      });

      // 实时双向绑定
      card.querySelector('.npc-name-input').addEventListener('input', (e) => {
        npc.name = e.target.value;
        card.querySelector('.fork-accordion-title').textContent = npc.name || '未命名NPC';
      });
      card.querySelector('.npc-gender-input').addEventListener('input', (e) => {
        npc.gender = e.target.value;
        card.querySelector('.fork-accordion-tag').textContent = npc.gender || '未知';
      });
      card.querySelector('.npc-desc-input').addEventListener('input', (e) => {
        npc.desc = e.target.value;
      });

      // NPC 头像：复用项目通用 ImagePicker（1:1），存 dataURL 防刷新裂图
      const avatarBox = card.querySelector('[data-npc-avatar]');
      if (avatarBox) {
        const avatarImg = avatarBox.querySelector('.fork-npc-avatar-img');
        const avatarPh = avatarBox.querySelector('.fork-npc-avatar-ph');
        const renderNpcAvatar = () => {
          if (npc.avatar) {
            avatarImg.onerror = () => {
              avatarImg.hidden = true;
              avatarPh.hidden = false;
            };
            avatarImg.src = npc.avatar;
            avatarImg.hidden = false;
            avatarPh.hidden = true;
          } else {
            avatarImg.removeAttribute('src');
            avatarImg.hidden = true;
            avatarPh.hidden = false;
          }
        };
        avatarBox.addEventListener('click', () => {
          if (!window.ImagePicker || typeof window.ImagePicker.open !== 'function') {
            if (window.RetroToast) {
              window.RetroToast.show({
                tag: 'AGENT // 拾取异常',
                message: '通用图片选择器尚未就绪',
                type: 'warn'
              });
            }
            return;
          }
          window.ImagePicker.open({
            title: '选择 NPC 头像 (1:1 比例)',
            // ImagePicker 回调给的是 { type: 'file' | 'url', ... }，不是裸字符串
            onSelect: async (res) => {
              if (!res) return;
              try {
                if (res.type === 'file' && res.file) {
                  const compressed = await Storage.compressImage(res.file, 512, 0.9);
                  npc.avatar = await blobToDataUrl(compressed);
                } else if (res.type === 'url' && res.url) {
                  npc.avatar = res.url.trim();
                } else {
                  return;
                }
                renderNpcAvatar();
              } catch (err) {
                console.error('[ForkEditor] NPC 头像处理失败', err);
                if (window.RetroToast) {
                  window.RetroToast.show({
                    tag: 'AGENT // 读取失败',
                    message: '头像读取失败',
                    detail: String(err && err.message ? err.message : err),
                    type: 'error'
                  });
                }
              }
            }
          });
        });
      }

      listWrap.appendChild(card);
    });
  }

  /**
   * 渲染地点沙盘列表
   */
  function renderLocationList() {
    const listWrap = document.getElementById('forkLocationList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.locations) || currentData.locations.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'LOCUS // LOC-00',
        title: '沙盘坐标未定锚',
        hint: '点击此处或右上角「添加」建立首个地点与环境情报',
        iconSvg: ICONS.condLocation,
        triggerBtnId: 'forkAddLocationBtn'
      });
      return;
    }

    currentData.locations.forEach((loc, index) => {
      const card = document.createElement('div');
      card.className = 'fork-bento-accordion-card';
      card.innerHTML = `
        <div class="fork-accordion-header" role="button" tabindex="0">
          <span class="fork-accordion-code">LOC-${String(index + 1).padStart(2, '0')}</span>
          <span class="fork-accordion-title">${escapeHtml(loc.name || '未命名地点')}</span>
          <span class="fork-accordion-tag">${escapeHtml(loc.position || '未知坐标')}</span>
          <div class="fork-accordion-spacer"></div>
          <button type="button" class="fork-btn-icon-del" title="删除此地点">${ICONS.trash}</button>
          <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
        </div>
        <div class="fork-accordion-body">
          <div class="fork-field-block">
            <label class="fork-field-label">LOCUS NAME // 地点名称</label>
            <input type="text" class="fork-input-text loc-name-input" value="${escapeHtml(loc.name || '')}" placeholder="如：倒悬钟楼 / 核心控制室 / 荒废地铁站">
          </div>
          <div class="fork-field-block" style="margin-top: 10px;">
            <label class="fork-field-label">COORDINATES // 详细位置</label>
            <input type="text" class="fork-input-text loc-pos-input" value="${escapeHtml(loc.position || '')}" placeholder="如：核心城区东侧三号塔负二层 / A区中央回廊">
          </div>
          <div class="fork-field-block" style="margin-top: 10px;">
            <label class="fork-field-label">ENVIRONMENT // 详情设定</label>
            <textarea class="fork-textarea loc-desc-input" rows="3" placeholder="设定该地点的环境特征、异常现象、隐藏机关或探索要素...">${escapeHtml(loc.desc || '')}</textarea>
          </div>
        </div>
      `;

      card.querySelector('.fork-accordion-header').addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        card.classList.toggle('is-expanded');
      });

      card.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.locations.splice(index, 1);
        renderLocationList();
      });

      card.querySelector('.loc-name-input').addEventListener('input', (e) => {
        loc.name = e.target.value;
        card.querySelector('.fork-accordion-title').textContent = loc.name || '未命名地点';
      });
      card.querySelector('.loc-pos-input').addEventListener('input', (e) => {
        loc.position = e.target.value;
        card.querySelector('.fork-accordion-tag').textContent = loc.position || '未知坐标';
      });
      card.querySelector('.loc-desc-input').addEventListener('input', (e) => {
        loc.desc = e.target.value;
      });

      listWrap.appendChild(card);
    });
  }

  /**
   * 渲染数值规则列表
   */
  function renderStatsList() {
    const listWrap = document.getElementById('forkStatsList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.stats) || currentData.stats.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'METRIC // VAL-00',
        title: '量程体系未初始化',
        hint: '点击此处或右上角「添加」设定体力值、饱食度等数值约束',
        iconSvg: ICONS.condStat,
        triggerBtnId: 'forkAddStatBtn'
      });
      return;
    }

    currentData.stats.forEach((stat, index) => {
      const card = document.createElement('div');
      card.className = 'fork-bento-accordion-card fork-stat-accordion-card';
      const minVal = stat.min !== undefined && stat.min !== '' ? stat.min : '0';
      const maxVal = stat.max !== undefined && stat.max !== '' ? stat.max : '100';
      const initRaw = stat.init !== undefined && stat.init !== null ? String(stat.init) : '';

      card.innerHTML = `
        <div class="fork-accordion-header" role="button" tabindex="0">
          <span class="fork-accordion-code">VAL-${String(index + 1).padStart(2, '0')}</span>
          <span class="fork-accordion-title">${escapeHtml(stat.name || '数值指标')}</span>
          <div class="fork-accordion-spacer"></div>
          <button type="button" class="fork-btn-icon-del" title="删除此数值">${ICONS.trash}</button>
          <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
        </div>
        <div class="fork-accordion-body">
          <div class="fork-stat-editor-layout">
            <!-- 名称行 -->
            <div class="fork-field-block">
              <label class="fork-field-label">METRIC NAME // 数值名称</label>
              <input type="text" class="fork-input-text stat-name-input" value="${escapeHtml(stat.name || '')}" placeholder="如：体力值 / 饱食度 / 生命值 / 行动力">
            </div>

            <!-- 一体化战术量程区间胶囊 -->
            <div class="fork-field-block">
              <div class="fork-stat-range-label-row">
                <label class="fork-field-label">RANGE // 数值范围</label>
              </div>
              <div class="fork-stat-range-capsule">
                <div class="fork-range-cell is-min">
                  <span class="fork-range-cell-tag">MIN</span>
                  <input type="number" class="fork-range-input stat-min-input" value="${escapeHtml(String(minVal))}" placeholder="0" aria-label="数值下限">
                </div>
                <div class="fork-range-connector" aria-hidden="true">
                  <span class="fork-range-axis-line"></span>
                  <span class="fork-range-axis-dot"></span>
                  <span class="fork-range-axis-line"></span>
                </div>
                <div class="fork-range-cell is-max">
                  <span class="fork-range-cell-tag">MAX</span>
                  <input type="number" class="fork-range-input stat-max-input" value="${escapeHtml(String(maxVal))}" placeholder="100" aria-label="数值上限">
                </div>
              </div>
            </div>

<!-- 进本初始值（留空自动取 MAX 满状态） -->
            <div class="fork-field-block">
              <div class="fork-stat-range-label-row">
                <label class="fork-field-label">INITIAL // 初始值</label>
                <span class="fork-stat-range-hint">留空默认 MAX</span>
              </div>
              <div class="fork-stat-init-capsule">
                <div class="fork-stat-init-cell">
                  <span class="fork-range-cell-tag">INIT</span>
                  <input type="number" class="fork-range-input stat-init-input" value="${escapeHtml(initRaw)}" placeholder="${escapeHtml(String(maxVal))}" aria-label="进本初始值">
                  <span class="fork-stat-init-scale">/ ${escapeHtml(String(maxVal))}</span>
                </div>
              </div>
            </div>
            <div class="fork-field-block">
              <label class="fork-field-label">RULE // 规则说明</label>
              <textarea class="fork-textarea stat-desc-input" rows="2" placeholder="设定该数值在推演中的增减机制，以及达到极值或突破特定阈值时触发的剧本事件...">${escapeHtml(stat.desc || '')}</textarea>
            </div>
          </div>
        </div>
      `;

      card.querySelector('.fork-accordion-header').addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        card.classList.toggle('is-expanded');
      });

      card.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.stats.splice(index, 1);
        renderStatsList();
      });

      // 折叠头已不挂量程胶囊，这里只负责让展开区里的初始值占位与刻度跟住 MAX
      const syncInitScale = () => {
        const curMax = (stat.max !== undefined && stat.max !== '') ? String(stat.max) : '100';
        const initInput = card.querySelector('.stat-init-input');
        if (initInput) initInput.placeholder = curMax;
        const initScale = card.querySelector('.fork-stat-init-scale');
        if (initScale) initScale.textContent = `/ ${curMax}`;
      };

      card.querySelector('.stat-name-input').addEventListener('input', (e) => {
        stat.name = e.target.value;
        card.querySelector('.fork-accordion-title').textContent = stat.name || '数值指标';
      });
      card.querySelector('.stat-min-input').addEventListener('input', (e) => {
        stat.min = e.target.value;
      });
      card.querySelector('.stat-max-input').addEventListener('input', (e) => {
        stat.max = e.target.value;
        syncInitScale();
      });
      card.querySelector('.stat-init-input').addEventListener('input', (e) => {
        stat.init = e.target.value;
      });
      card.querySelector('.stat-desc-input').addEventListener('input', (e) => {
        stat.desc = e.target.value;
      });

      listWrap.appendChild(card);
    });
  }

  /* ---------------- 角色数值设定（模板 → 绑定角色 → 内层数值） ---------------- */

  /**
   * 收集副本内可绑定的角色候选池。
   *
   * 两个来源：本副本已选的高危角色（instance 阵营，但只认已加进本副本的），
   * 以及本副本专属 NPC。它们是两套独立的 ID 空间，分开返回，避免日后取名字时不知道该去哪查。
   *
   * ⚠ 高危角色只取「本副本已选」的（getHazardCharIds），不是全局 instance 阵营池 ——
   *   否则会选到本副本根本没有的角色，选了也白选（推演时 AI 拿不到该角色，数值无处落）。
   * @returns {{chars: Array, npcs: Array}}
   */
  function collectCharStatCandidates() {
    const pickedHazardIds = new Set(getHazardCharIds());
    const chars = collectInstanceCharacters()
      .filter((c) => c && pickedHazardIds.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name || '未命名角色',
        hint: `${c.gender || '保密'} · ${c.rank === 'awakened' ? '觉醒者' : '漫游者'}`
      }));
    const npcs = (Array.isArray(currentData.npcs) ? currentData.npcs : [])
      .filter((n) => n && n.id)
      .map((n) => ({
        id: n.id,
        name: n.name || '未命名NPC',
        hint: `${n.gender || '未知'} · 副本 NPC`
      }));
    return { chars, npcs };
  }

  /**
   * 收集数值触发的全部候选指标，把全局数值与角色数值统一成一张扁平列表。
   * 角色数值展开成「角色·指标」——同一 metric 绑了多个角色就列多条，各自锁定 ownerId。
   *
   * 候选统一形状：
   *   { key, scope, ownerId, ownerName, metricId, name, min, max }
   *   - scope='global'：全局数值，ownerId/ownerName 空，metricId=stat.id，key='g:'+id
   *   - scope='char'  ：角色数值，ownerId=角色/NPC id，metricId=cmetric id，key='c:'+ownerId+':'+metricId
   * @returns {Array}
   */
  function collectStatCandidates() {
    const out = [];
    // 全局数值
    (Array.isArray(currentData.stats) ? currentData.stats : []).forEach((s) => {
      if (!s || !s.id) return;
      out.push({
        key: 'g:' + s.id,
        scope: 'global',
        ownerId: '',
        ownerName: '',
        metricId: s.id,
        name: s.name || '未命名指标',
        min: s.min,
        max: s.max
      });
    });
    // 角色数值：把每个模板的 metrics 对它绑的每个角色/NPC 各展开一条
    const { chars, npcs } = collectCharStatCandidates();
    const nameMap = new Map();
    chars.forEach((c) => nameMap.set('char:' + c.id, c.name));
    npcs.forEach((n) => nameMap.set('npc:' + n.id, n.name));
    (Array.isArray(currentData.charStats) ? currentData.charStats : []).forEach((tpl) => {
      if (!tpl) return;
      const metrics = Array.isArray(tpl.metrics) ? tpl.metrics : [];
      const owners = []
        .concat((tpl.charIds || []).map((id) => ({ id, name: nameMap.get('char:' + id) })))
        .concat((tpl.npcIds || []).map((id) => ({ id, name: nameMap.get('npc:' + id) })));
      owners.forEach((owner) => {
        // 角色已从档案删除（拿不到名字）就跳过，避免列出「未知·好感度」这种无效条目
        if (!owner.id || !owner.name) return;
        metrics.forEach((m) => {
          if (!m || !m.id) return;
          out.push({
            key: 'c:' + owner.id + ':' + m.id,
            scope: 'char',
            ownerId: owner.id,
            ownerName: owner.name,
            metricId: m.id,
            name: m.name || '未命名数值',
            min: m.min,
            max: m.max
          });
        });
      });
    });
    return out;
  }

  /** 由条件对象反推它在候选列表里的 key（老数据只有 statId 的按 global 处理） */
  function statCondKey(cond) {
    if (!cond) return '';
    if (cond.scope === 'char') return 'c:' + trimStr(cond.ownerId) + ':' + trimStr(cond.metricId);
    return 'g:' + trimStr(cond.metricId || cond.statId);
  }

  /** 把选择器返回的 key 拆回条件字段，写进 cond（就地） */
  function applyStatCondKey(cond, key, candidates) {
    const hit = candidates.find((c) => c.key === key);
    if (!hit) return;
    cond.scope = hit.scope;
    cond.ownerId = hit.ownerId;
    cond.ownerName = hit.ownerName;
    cond.metricId = hit.metricId;
    // 兼容字段：老代码读 statId，这里同步写 global 的 metricId 进去
    cond.statId = hit.scope === 'global' ? hit.metricId : '';
  }
  function findCharStatOwner(id, field, exceptTplId) {
    const list = Array.isArray(currentData.charStats) ? currentData.charStats : [];
    return list.find((tpl) => (
      tpl && tpl.id !== exceptTplId && Array.isArray(tpl[field]) && tpl[field].includes(id)
    )) || null;
  }

  /**
   * 渲染角色数值模板列表
   */
  function renderCharStatsList() {
    const listWrap = document.getElementById('forkCharStatsList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.charStats) || currentData.charStats.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'ROLE // TPL-00',
        title: '未建立角色数值模板',
        hint: '点击此处或右上角「添加」为高危角色与 NPC 配置专属数值',
        iconSvg: ICONS.user,
        triggerBtnId: 'forkAddCharStatBtn'
      });
      return;
    }

    const { chars, npcs } = collectCharStatCandidates();
    const charMap = new Map(chars.map((c) => [c.id, c]));
    const npcMap = new Map(npcs.map((n) => [n.id, n]));

    currentData.charStats.forEach((tpl, index) => {
      const card = document.createElement('div');
      card.className = 'fork-cstat-card';

      card.innerHTML = `
        <div class="fork-cstat-card-head">
          <span class="fork-accordion-code">TPL-${String(index + 1).padStart(2, '0')}</span>
          <div class="fork-accordion-spacer"></div>
          <button type="button" class="fork-btn-icon-del" title="删除此模板">${ICONS.trash}</button>
        </div>

        <div class="fork-field-block">
          <div class="fork-stat-range-label-row">
            <label class="fork-field-label">BOUND // 绑定角色</label>
            <span class="fork-stat-range-hint">同一角色只能绑一个模板</span>
          </div>
          <div class="fork-cstat-bind-tray" data-bind-tray></div>
        </div>

        <div class="fork-field-block">
          <div class="fork-stat-range-label-row">
            <label class="fork-field-label">METRICS // 数值项</label>
            <button type="button" class="fork-cstat-add-metric-btn" data-add-metric>
              ${ICONS.add}<span>添加数值</span>
            </button>
          </div>
          <div class="fork-cstat-metric-list" data-metric-list></div>
        </div>
      `;

      card.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.charStats.splice(index, 1);
        renderCharStatsList();
      });

      renderCharStatBindTray(card, tpl, charMap, npcMap);
      renderCharStatMetrics(card, tpl);

      // 「添加数值」按钮属于外层大卡、不随内层列表重渲染，
      // 所以只能在这里绑一次；放进 renderCharStatMetrics 会每次增删都叠一个监听。
      card.querySelector('[data-add-metric]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        tpl.metrics.push({
          id: 'cmetric_' + Date.now(),
          name: '',
          min: '0',
          max: '100',
          init: '',
          desc: ''
        });
        renderCharStatMetrics(card, tpl);
      });

      listWrap.appendChild(card);
    });
  }

  /**
   * 渲染模板的绑定角色 chip 托盘。
   * 档案里已被删掉的角色显示为失效态 —— 只提示不自动清，
   * 作者可能只是临时挪走了角色，替他做决定会丢数据。
   */
  function renderCharStatBindTray(card, tpl, charMap, npcMap) {
    const tray = card.querySelector('[data-bind-tray]');
    if (!tray) return;

    const rows = [];
    (tpl.charIds || []).forEach((id) => rows.push({ id, field: 'charIds', hit: charMap.get(id) }));
    (tpl.npcIds || []).forEach((id) => rows.push({ id, field: 'npcIds', hit: npcMap.get(id) }));

    tray.innerHTML = `
      ${rows.map((r) => `
        <span class="fork-cstat-chip${r.hit ? '' : ' is-lost'}">
          <span class="fork-cstat-chip-name">${escapeHtml(r.hit ? r.hit.name : '角色已失效')}</span>
          <button type="button" class="fork-cstat-chip-del" data-unbind="${escapeHtml(r.id)}" data-field="${r.field}" title="解除绑定">
            ${ICONS.close}
          </button>
        </span>
      `).join('')}
      <button type="button" class="fork-cstat-bind-add-btn" data-open-picker>
        ${ICONS.add}<span>${rows.length === 0 ? '绑定角色' : '追加'}</span>
      </button>
    `;

    tray.querySelectorAll('[data-unbind]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const field = btn.dataset.field;
        const rmId = btn.dataset.unbind;
        tpl[field] = (tpl[field] || []).filter((id) => id !== rmId);
        renderCharStatsList();
      });
    });

    tray.querySelector('[data-open-picker]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openCharStatBindPicker(tpl);
    });
  }

  /**
   * 打开角色绑定多选器。
   *
   * 互斥在这里前置生效：已被别的模板占用的角色直接不进候选，
   * 不给用户选了再报错的机会。
   */
  async function openCharStatBindPicker(tpl) {
    if (!window.SelectModal || typeof window.SelectModal.pickMulti !== 'function') return;

    const { chars, npcs } = collectCharStatCandidates();
    const options = [];

    chars.forEach((c) => {
      if (findCharStatOwner(c.id, 'charIds', tpl.id)) return;
      options.push({
        value: `char:${c.id}`,
        label: c.name,
        hint: c.hint,
        group: '高危角色'
      });
    });
    npcs.forEach((n) => {
      if (findCharStatOwner(n.id, 'npcIds', tpl.id)) return;
      options.push({
        value: `npc:${n.id}`,
        label: n.name,
        hint: n.hint,
        group: '副本 NPC'
      });
    });

    if (options.length === 0) {
      toastMenu('ROLE // 无可绑定角色', '候选池已空', '所有高危角色与 NPC 都已绑定到其他模板', 'warn');
      return;
    }

    const current = [
      ...(tpl.charIds || []).map((id) => `char:${id}`),
      ...(tpl.npcIds || []).map((id) => `npc:${id}`)
    ];

    const picked = await window.SelectModal.pickMulti({
      title: '绑定角色',
      tag: 'ROLE // 数值归属',
      options,
      values: current,
      confirmText: '确认绑定',
      searchable: options.length > 6
    });

    if (!Array.isArray(picked)) return;
    tpl.charIds = picked.filter((v) => v.startsWith('char:')).map((v) => v.slice(5));
    tpl.npcIds = picked.filter((v) => v.startsWith('npc:')).map((v) => v.slice(4));
    renderCharStatsList();
  }

  /**
   * 渲染模板内层数值项。
   * 字段规格与副本数值设定完全一致（RANGE / 初始值 / 规则说明），
   * 作者不用学两套东西。
   */
  function renderCharStatMetrics(card, tpl) {
    const listWrap = card.querySelector('[data-metric-list]');
    if (!listWrap) return;
    if (!Array.isArray(tpl.metrics)) tpl.metrics = [];
    listWrap.innerHTML = '';

    if (tpl.metrics.length === 0) {
      listWrap.innerHTML = `<div class="fork-cstat-metric-empty">尚未添加数值项，点击右上角「添加数值」开始配置</div>`;
      return;
    }

    tpl.metrics.forEach((m, mIndex) => {
      const minVal = m.min !== undefined && m.min !== '' ? m.min : '0';
      const maxVal = m.max !== undefined && m.max !== '' ? m.max : '100';
      const initRaw = m.init !== undefined && m.init !== null ? String(m.init) : '';

      const mCard = document.createElement('div');
      mCard.className = 'fork-bento-accordion-card fork-stat-accordion-card fork-cstat-metric-card';
      mCard.innerHTML = `
        <div class="fork-accordion-header" role="button" tabindex="0">
          <span class="fork-accordion-code">VAL-${String(mIndex + 1).padStart(2, '0')}</span>
          <span class="fork-accordion-title">${escapeHtml(m.name || '数值指标')}</span>
          <div class="fork-accordion-spacer"></div>
          <button type="button" class="fork-btn-icon-del" title="删除此数值">${ICONS.trash}</button>
          <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
        </div>
        <div class="fork-accordion-body">
          <div class="fork-stat-editor-layout">
            <div class="fork-field-block">
              <label class="fork-field-label">METRIC NAME // 数值名称</label>
              <input type="text" class="fork-input-text m-name-input" value="${escapeHtml(m.name || '')}" placeholder="如：理智值 / 侵蚀度 / 体力值">
            </div>

            <div class="fork-field-block">
              <div class="fork-stat-range-label-row">
                <label class="fork-field-label">RANGE // 数值范围</label>
              </div>
              <div class="fork-stat-range-capsule">
                <div class="fork-range-cell is-min">
                  <span class="fork-range-cell-tag">MIN</span>
                  <input type="number" class="fork-range-input m-min-input" value="${escapeHtml(String(minVal))}" placeholder="0" aria-label="数值下限">
                </div>
                <div class="fork-range-connector" aria-hidden="true">
                  <span class="fork-range-axis-line"></span>
                  <span class="fork-range-axis-dot"></span>
                  <span class="fork-range-axis-line"></span>
                </div>
                <div class="fork-range-cell is-max">
                  <span class="fork-range-cell-tag">MAX</span>
                  <input type="number" class="fork-range-input m-max-input" value="${escapeHtml(String(maxVal))}" placeholder="100" aria-label="数值上限">
                </div>
              </div>
            </div>

            <div class="fork-field-block">
              <div class="fork-stat-range-label-row">
                <label class="fork-field-label">INITIAL // 初始值</label>
                <span class="fork-stat-range-hint">留空默认 MAX</span>
              </div>
              <div class="fork-stat-init-capsule">
                <div class="fork-stat-init-cell">
                  <span class="fork-range-cell-tag">INIT</span>
                  <input type="number" class="fork-range-input m-init-input" value="${escapeHtml(initRaw)}" placeholder="${escapeHtml(String(maxVal))}" aria-label="进本初始值">
                  <span class="fork-stat-init-scale">/ ${escapeHtml(String(maxVal))}</span>
                </div>
              </div>
            </div>

            <div class="fork-field-block">
              <label class="fork-field-label">RULE // 规则说明</label>
              <textarea class="fork-textarea m-desc-input" rows="2" placeholder="设定该数值在推演中的增减机制，以及达到极值时触发的剧本事件...">${escapeHtml(m.desc || '')}</textarea>
            </div>
          </div>
        </div>
      `;

      mCard.querySelector('.fork-accordion-header').addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        mCard.classList.toggle('is-expanded');
      });

      mCard.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        tpl.metrics.splice(mIndex, 1);
        renderCharStatMetrics(card, tpl);
      });

      // 折叠头已不挂量程胶囊，这里只负责让展开区里的初始值占位与刻度跟住 MAX
      const syncInitScale = () => {
        const curMax = (m.max !== undefined && m.max !== '') ? String(m.max) : '100';
        const initInput = mCard.querySelector('.m-init-input');
        if (initInput) initInput.placeholder = curMax;
        const initScale = mCard.querySelector('.fork-stat-init-scale');
        if (initScale) initScale.textContent = `/ ${curMax}`;
      };

      mCard.querySelector('.m-name-input').addEventListener('input', (e) => {
        m.name = e.target.value;
        mCard.querySelector('.fork-accordion-title').textContent = m.name || '数值指标';
      });
      mCard.querySelector('.m-min-input').addEventListener('input', (e) => {
        m.min = e.target.value;
      });
      mCard.querySelector('.m-max-input').addEventListener('input', (e) => {
        m.max = e.target.value;
        syncInitScale();
      });
      mCard.querySelector('.m-init-input').addEventListener('input', (e) => {
        m.init = e.target.value;
      });
      mCard.querySelector('.m-desc-input').addEventListener('input', (e) => {
        m.desc = e.target.value;
      });

      listWrap.appendChild(mCard);
    });
  }

  /**
   * 前置线索环检测：以 prereqClueIds 建有向图，DFS 找出包含 startId 的环。
   *
   * 环形依赖是纯逻辑死锁——A 要 B 先解锁、B 又要 A 先解锁，两条永远开不了。
   * 肉眼几乎看不出来，所以在编纂期就暴露出来。
   * @param {string} startId 起点线索 id
   * @returns {string[]|null} 命中时返回环上的 id 序列（首尾同一个），否则 null
   */
  function findPrereqCycle(startId) {
    const clues = Array.isArray(currentData && currentData.clues) ? currentData.clues : [];
    const byId = new Map(clues.map((c) => [c.id, c]));
    if (!byId.has(startId)) return null;

    const path = [];
    const onPath = new Set();

    function dfs(id) {
      if (onPath.has(id)) {
        // 只有绕回起点的环才与本条线索相关
        return id === startId ? path.slice(path.indexOf(id)).concat(id) : null;
      }
      const node = byId.get(id);
      if (!node) return null;

      path.push(id);
      onPath.add(id);
      const deps = Array.isArray(node.prereqClueIds) ? node.prereqClueIds : [];
      for (let i = 0; i < deps.length; i++) {
        const hit = dfs(deps[i]);
        if (hit) return hit;
      }
      path.pop();
      onPath.delete(id);
      return null;
    }

    return dfs(startId);
  }

  /**
   * 阶段任务前置环检测：以 prereqIds 建有向图，DFS 找出包含 startId 的环。
   *
   * 与线索同理——A 要 B 先完成、B 又要 A 先完成，两项任务都永远解锁不了。
   * @param {string} startId 起点任务 id
   * @returns {string[]|null} 命中时返回环上的 id 序列（首尾同一个），否则 null
   */
  function findMissionPrereqCycle(startId) {
    const list = Array.isArray(currentData && currentData.clearConditions) ? currentData.clearConditions : [];
    const byId = new Map(list.map((m) => [m.id, m]));
    if (!byId.has(startId)) return null;

    const path = [];
    const onPath = new Set();

    function dfs(id) {
      if (onPath.has(id)) {
        return id === startId ? path.slice(path.indexOf(id)).concat(id) : null;
      }
      const node = byId.get(id);
      if (!node) return null;
      path.push(id);
      onPath.add(id);
      const deps = Array.isArray(node.prereqIds) ? node.prereqIds : [];
      for (let i = 0; i < deps.length; i++) {
        const hit = dfs(deps[i]);
        if (hit) return hit;
      }
      path.pop();
      onPath.delete(id);
      return null;
    }

    return dfs(startId);
  }

  /**
   * 触发条件参数区公共渲染器（线索 / 真相 / 结局共用）
   *
   * 把原先写死在线索卡闭包里的四段参数机提为模块级，宿主只要提供一个
   * 带下列字段的 model 即可复用：
   *   triggers / triggerLogic / locationIds / keywords
   *   statConditions / statLogic / prereqClueIds / prereqLogic
   *
   * @param {HTMLElement} scope 参数区所在容器（内部按固定 class 找挂载点）
   * @param {object} model 被编辑的数据对象（线索 / hiddenTruth / 结局对象）
   * @param {object} options
   *   - scopeTag: 'CLUE' | 'TRUTH' | 'ENDING'，决定文案与 Toast 口径
   *   - enablePrereqCycle: 是否做环形依赖检测（真相与结局都是终点，不可能成环，传 false）
   *   - selfId: 前置候选池里要排除的自身 id（真相无 id 时传 null）
   *   - onHeaderSync: 触发源计数变化时的回调（折叠头微标）
   *   - onRerender: 需要整列重绘时的回调（环状态可能连带影响其他卡片）
   */
  function renderTriggerParamBlocks(scope, model, options) {
    const opts = options || {};
    const SCOPE_COPY = {
      CLUE: {
        allHint: '需同时满足全部已选类型；同一类型内部的判定口径见各自区块。',
        anyHint: '满足任意一类触发条件即解锁本线索。',
        locTitle: '指派线索触发地点',
        prereqTitle: '指派前置线索',
        hitTarget: '本线索',
        soloPrereqHint: '仅设前置线索时，前置解锁后本线索将立即解锁，等同于两条线索绑定。'
      },
      TRUTH: {
        allHint: '需同时满足全部已选类型才解明真相；同一类型内部的判定口径见各自区块。',
        anyHint: '满足任意一类触发条件即解明本真相。',
        locTitle: '指派真相解明地点',
        prereqTitle: '指派真相前置线索',
        hitTarget: '本真相',
        soloPrereqHint: '仅设前置线索时，指定线索解锁后真相将立即解明，中间没有额外门槛。'
      },
      ENDING: {
        allHint: '需同时满足全部已选类型才结算本结局；同一类型内部的判定口径见各自区块。',
        anyHint: '满足任意一类触发条件即走向本结局。',
        locTitle: '指派结局触发地点',
        prereqTitle: '指派结局前置线索',
        hitTarget: '本结局',
        soloPrereqHint: '仅设前置线索时，指定线索解锁后将直接结算本结局，中间没有额外门槛。'
      }
    };
    const scopeTag = SCOPE_COPY[opts.scopeTag] ? opts.scopeTag : 'CLUE';
    const copy = SCOPE_COPY[scopeTag];
    // 线索之外的 scope 都是叙事终点，不参与前置依赖成环
    const isTerminal = scopeTag !== 'CLUE';
    const enablePrereqCycle = opts.enablePrereqCycle !== false && !isTerminal;
    const selfId = opts.selfId || null;
    const onHeaderSync = typeof opts.onHeaderSync === 'function' ? opts.onHeaderSync : () => {};
    const onRerender = typeof opts.onRerender === 'function' ? opts.onRerender : null;

    // 跨类型触发逻辑切换：仅在勾选两类以上时才有意义
    function renderLogicSegment() {
      const segWrap = scope.querySelector('.clue-logic-segment-wrap');
      const hintWrap = scope.querySelector('.clue-logic-hint-wrap');
      if (!segWrap || !hintWrap) return;

      if (model.triggers.length < 2) {
        segWrap.innerHTML = '';
        segWrap.hidden = true;
        hintWrap.innerHTML = '';
        hintWrap.hidden = true;
        return;
      }

      segWrap.hidden = false;
      hintWrap.hidden = false;
      const isAll = model.triggerLogic === 'all';

      segWrap.innerHTML = `
        <div class="fork-logic-segment">
          <button type="button" class="fork-logic-seg-btn ${isAll ? '' : 'is-active'}" data-logic="any">任一 ANY</button>
          <button type="button" class="fork-logic-seg-btn ${isAll ? 'is-active' : ''}" data-logic="all">全部 ALL</button>
        </div>
      `;

      const allHint = copy.allHint;
      const anyHint = copy.anyHint;

      hintWrap.innerHTML = `
        <div class="fork-logic-hint">${isAll ? allHint : anyHint}</div>
      `;

      segWrap.querySelectorAll('.fork-logic-seg-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = btn.dataset.logic === 'all' ? 'all' : 'any';
          if (model.triggerLogic === next) return;
          model.triggerLogic = next;
          renderLogicSegment();
          onHeaderSync();
        });
      });
    }

    // 刷新关联地点选择器视图
    function renderLocationPicker() {
      const locWrap = scope.querySelector('.clue-location-bind-wrap');
      if (!locWrap) return;
      if (!model.triggers.includes('location')) {
        locWrap.innerHTML = '';
        locWrap.hidden = true;
        return;
      }

      locWrap.hidden = false;
      const currentLocIds = Array.isArray(model.locationIds) ? model.locationIds : [];
      const allLocs = Array.isArray(currentData.locations) ? currentData.locations : [];
      const matchedLocs = currentLocIds
        .map((id) => allLocs.find((l) => l.id === id))
        .filter(Boolean);

      let tagsHtml = '';
      if (matchedLocs.length === 0) {
        tagsHtml = `<span class="fork-loc-picker-empty">点击指派触发地点 (未绑定)</span>`;
      } else {
        tagsHtml = matchedLocs.map((l) => `
          <span class="fork-loc-bind-pill">
            <span class="fork-loc-bind-icon">${ICONS.condLocation}</span>
            <span class="fork-loc-bind-name">${escapeHtml(l.name || '未命名地点')}</span>
          </span>
        `).join('');
      }

      locWrap.innerHTML = `
        <div class="fork-clue-loc-picker-trigger" role="button" tabindex="0">
          <div class="fork-loc-picker-left">
            <span class="fork-loc-picker-badge">LOCUS // 空间锚定</span>
            <div class="fork-loc-pills-row">${tagsHtml}</div>
          </div>
          <div class="fork-loc-picker-arrow">${ICONS.chevronDown}</div>
        </div>
      `;

      locWrap.querySelector('.fork-clue-loc-picker-trigger')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (allLocs.length === 0) {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'LOCUS // 空间锚定',
              message: '暂无可用地点',
              detail: '请先在上方「地点设定」中创建地点档案。',
              type: 'warn'
            });
          }
          return;
        }

        if (!window.SelectModal || typeof SelectModal.pickMulti !== 'function') return;

        const picked = await SelectModal.pickMulti({
          title: copy.locTitle,
          tag: 'LOCUS // 空间锚定',
          options: allLocs.map((l) => ({
            value: l.id,
            label: l.name || '未命名地点',
            hint: l.position || '未知坐标'
          })),
          values: Array.isArray(model.locationIds) ? model.locationIds : [],
          confirmText: '确认指派',
          searchable: allLocs.length > 6
        });

        if (!Array.isArray(picked)) return;
        model.locationIds = picked;
        renderLocationPicker();
      });
    }

    // 刷新关联关键词视图与校验回显
    function renderKeywordPicker() {
      const kwWrap = scope.querySelector('.clue-keyword-bind-wrap');
      if (!kwWrap) return;
      if (!model.triggers.includes('keyword')) {
        kwWrap.innerHTML = '';
        kwWrap.hidden = true;
        return;
      }

      kwWrap.hidden = false;
      const hitTarget = copy.hitTarget;
      kwWrap.innerHTML = `
        <div class="fork-clue-keyword-block">
          <div class="fork-field-label-row">
            <label class="fork-field-label">KEYWORDS // 触发关键词</label>
            <button type="button" class="fork-keys-help-btn" aria-label="查看关键词填写说明" title="查看关键词填写说明">
              ${ICONS.help}
            </button>
          </div>
          <div class="fork-keys-manual">
            <div class="fork-manual-intro">
              <span class="fork-manual-intro-prefix">填写规则：</span>
              多个关键词用逗号或空格分隔，任意一项命中即触发${hitTarget}。支持三种写法：
            </div>
            <div class="fork-manual-list">
              <div class="fork-manual-item">
                <div class="fork-manual-item-head">
                  <span class="fork-manual-item-name">普通文本</span>
                  <span class="fork-manual-code">破限</span>
                </div>
                <p class="fork-manual-item-desc">直接写词。正文包含该词即命中，不区分大小写。</p>
              </div>
              <div class="fork-manual-item">
                <div class="fork-manual-item-head">
                  <span class="fork-manual-item-name">正则匹配</span>
                  <span class="fork-manual-code">/(晨|早).{0,6}光柱/i</span>
                </div>
                <p class="fork-manual-item-desc">用斜杠包裹，可带 i / m / s / u 标志。内部逗号空格不作分隔。</p>
              </div>
              <div class="fork-manual-item">
                <div class="fork-manual-item-head">
                  <span class="fork-manual-item-name">全词精确</span>
                  <span class="fork-manual-code">"cat"</span>
                </div>
                <p class="fork-manual-item-desc">用引号包裹，两侧不能紧邻同类字符，可避免被误伤。</p>
              </div>
            </div>
          </div>
          <input type="text" class="fork-input-text clue-keys-input" value="${escapeHtml(model.keywords || '')}" placeholder="例如：染血, /(残页|信件).{0,4}线索/i, &quot;diary&quot;" autocomplete="off" spellcheck="false">
          <div class="fork-keys-validate" hidden></div>
        </div>
      `;

      const manualEl = kwWrap.querySelector('.fork-keys-manual');
      const helpBtn = kwWrap.querySelector('.fork-keys-help-btn');
      helpBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!manualEl) return;
        const isOpen = manualEl.classList.toggle('is-open');
        helpBtn.classList.toggle('is-active', isOpen);
      });

      const keysInput = kwWrap.querySelector('.clue-keys-input');
      const validateBox = kwWrap.querySelector('.fork-keys-validate');

      function updateKeysValidation() {
        if (!validateBox || !keysInput) return;
        const val = String(keysInput.value || '').trim();
        if (!val || !window.KeyMatch || typeof KeyMatch.validate !== 'function') {
          validateBox.hidden = true;
          validateBox.textContent = '';
          return;
        }

        const items = KeyMatch.validate(val);
        const bad = items.filter((i) => !i.ok);

        validateBox.hidden = false;
        if (bad.length === 0) {
          const counts = { text: 0, regex: 0, exact: 0 };
          items.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });
          const parts = [];
          if (counts.text) parts.push(counts.text + ' 项文本');
          if (counts.regex) parts.push(counts.regex + ' 项正则');
          if (counts.exact) parts.push(counts.exact + ' 项精确');
          validateBox.className = 'fork-keys-validate';
          validateBox.textContent = '已识别 ' + parts.join(' · ');
        } else {
          validateBox.className = 'fork-keys-validate is-error';
          validateBox.textContent = bad.map((b) => b.token + ' → ' + b.error).join('；');
        }
      }

      keysInput?.addEventListener('input', (e) => {
        model.keywords = e.target.value;
        updateKeysValidation();
      });

      // 初始若有值则校验一次
      updateKeysValidation();
    }

    // 时间触发区块：勾选「时间触发」时展开。复用开场时间那套分位数字输入。
    // 填了的位参与匹配（AND），留空的位忽略；全留空则不构成条件。
    function renderTimePicker() {
      const timeWrap = scope.querySelector('.clue-time-bind-wrap');
      if (!timeWrap) return;
      if (!model.triggers.includes('time')) {
        timeWrap.innerHTML = '';
        timeWrap.hidden = true;
        return;
      }

      timeWrap.hidden = false;
      const t = (model.time && typeof model.time === 'object') ? model.time : {};
      const cells = [
        { field: 'year', unit: '年', aria: '触发年份' },
        { field: 'month', unit: '月', aria: '触发月份' },
        { field: 'day', unit: '日', aria: '触发日期' },
        { field: 'hour', unit: '时', aria: '触发小时' },
        { field: 'minute', unit: '分', aria: '触发分钟' }
      ];
      timeWrap.innerHTML = `
        <div class="fork-clue-time-block">
          <div class="fork-field-label-row">
            <label class="fork-field-label">CHRONO // 触发时刻</label>
            <button type="button" class="fork-keys-help-btn clue-time-help-btn" aria-label="查看时间填写说明" title="查看时间填写说明">
              ${ICONS.help}
            </button>
          </div>
          <div class="fork-keys-manual clue-time-manual">
            <div class="fork-manual-intro">
              <span class="fork-manual-intro-prefix">匹配规则：</span>
              填了的位才参与比对，留空的位忽略。例如只填「月」＝每年该月触发；全部填写则须完全一致。全留空时不构成有效条件。
            </div>
          </div>
          <div class="fork-opening-time-grid">
            ${cells.map((c) => `
              <div class="fork-opening-time-cell">
                <input type="number" class="fork-input-text fork-opening-time-input clue-time-input" data-time-field="${c.field}" value="${escapeHtml(String(t[c.field] || ''))}" aria-label="${c.aria}" inputmode="numeric">
                <span class="fork-opening-time-unit">${c.unit}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;

      const manualEl = timeWrap.querySelector('.clue-time-manual');
      const helpBtn = timeWrap.querySelector('.clue-time-help-btn');
      helpBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!manualEl) return;
        const isOpen = manualEl.classList.toggle('is-open');
        helpBtn.classList.toggle('is-active', isOpen);
      });

      timeWrap.querySelectorAll('.clue-time-input').forEach((input) => {
        input.addEventListener('input', (e) => {
          const field = e.target.dataset.timeField;
          if (!field) return;
          if (!model.time || typeof model.time !== 'object') model.time = {};
          // 只收纯数字，非数字（负号/小数/空）落回空串 = 该位不参与匹配
          const s = String(e.target.value || '').trim();
          model.time[field] = /^\d+$/.test(s) ? s : '';
        });
        // 失焦时把清洗结果回填到框里，让作者看到「非法输入已被丢弃」
        input.addEventListener('blur', (e) => {
          const field = e.target.dataset.timeField;
          if (field && model.time) e.target.value = model.time[field] || '';
        });
      });
    }

    // 数值条件区块：勾选「数值触发」时展开，取消时收起
    function renderStatPicker() {
      const statWrap = scope.querySelector('.clue-stat-bind-wrap');
      if (!statWrap) return;
      if (!model.triggers.includes('stat')) {
        statWrap.innerHTML = '';
        statWrap.hidden = true;
        return;
      }

      statWrap.hidden = false;
      // 数值候选 = 全局数值（scope:global）+ 角色数值展开成「角色·指标」（scope:char）。
      // 每个候选统一形状：{ key, scope, ownerId, ownerName, metricId, name, min, max }
      // key 是选择器用的唯一值：global 用 'g:'+id，角色用 'c:'+ownerId+':'+metricId。
      const statCandidates = collectStatCandidates();
      const allStats = Array.isArray(currentData.stats) ? currentData.stats : [];
      const conds = Array.isArray(model.statConditions) ? model.statConditions : [];
      const isAll = model.statLogic === 'all';

      // 多条时才露出内部逻辑开关：单条 any/all 无区别
      const logicSegHtml = conds.length >= 2 ? `
        <div class="fork-logic-segment">
          <button type="button" class="fork-logic-seg-btn ${isAll ? '' : 'is-active'}" data-stat-logic="any">任一 ANY</button>
          <button type="button" class="fork-logic-seg-btn ${isAll ? 'is-active' : ''}" data-stat-logic="all">全部 ALL</button>
        </div>
      ` : '';

      let rowsHtml = '';
      if (conds.length === 0) {
        rowsHtml = `<div class="fork-stat-cond-empty">尚未设定数值条件，点击下方按钮添加。</div>`;
      } else {
        rowsHtml = conds.map((cond) => {
          const key = statCondKey(cond);
          const hit = statCandidates.find((c) => c.key === key);
          const isLost = !!key && key !== 'g:' && !hit;
          const opItem = STAT_OPS.find((o) => o.key === cond.op) || STAT_OPS[3];

          // 阈值越界检查：只提示不拦截，作者可能先写条件后调量程
          let warnHtml = '';
          if (hit) {
            const min = parseFloat(hit.min);
            const max = parseFloat(hit.max);
            const val = parseFloat(cond.value);
            if (Number.isFinite(val) && Number.isFinite(min) && Number.isFinite(max)
                && (val < min || val > max)) {
              warnHtml = `<div class="fork-stat-cond-warn">阈值 ${escapeHtml(String(cond.value))} 超出量程 ${escapeHtml(String(hit.min))} ~ ${escapeHtml(String(hit.max))}，此条件将永不命中。</div>`;
            }
          }

          // 角色数值显示「角色·指标」，全局数值只显示指标名
          const hitLabel = hit
            ? (hit.scope === 'char' ? `${hit.ownerName} · ${hit.name}` : hit.name)
            : '';
          const pickLabel = isLost
            ? '指标已失效'
            : (hitLabel || '选择数值指标');
          const rangeText = hit ? `${hit.min} ~ ${hit.max}` : '';

          return `
            <div class="fork-stat-cond-item" data-cond-id="${escapeHtml(cond.id)}">
              <div class="fork-stat-cond-primary-row">
                <div class="fork-stat-cond-pick ${isLost ? 'is-lost' : ''}" role="button" tabindex="0">
                  <span class="fork-stat-cond-pick-name">${escapeHtml(pickLabel)}</span>
                  ${rangeText ? `<span class="fork-stat-cond-range">${escapeHtml(rangeText)}</span>` : ''}
                </div>
                <button type="button" class="fork-btn-icon-del fork-stat-cond-del" title="删除此条件">${ICONS.trash}</button>
              </div>
              <div class="fork-stat-cond-gate-row">
                <div class="fork-stat-op-segment">
                  ${STAT_OPS.map((o) => `<button type="button" class="fork-stat-op-btn ${o.key === opItem.key ? 'is-active' : ''}" data-op="${o.key}" title="${o.label}">${o.symbol}</button>`).join('')}
                </div>
                <input type="number" class="fork-stat-cond-value" value="${escapeHtml(String(cond.value || ''))}" placeholder="阈值" inputmode="decimal">
              </div>
              ${warnHtml}
            </div>
          `;
        }).join('');
      }

      statWrap.innerHTML = `
        <div class="fork-clue-stat-block">
          <div class="fork-field-label-row">
            <label class="fork-field-label">STAT GATE // 数值门槛</label>
            ${logicSegHtml}
          </div>
          <div class="fork-stat-cond-list">${rowsHtml}</div>
          <button type="button" class="fork-stat-cond-add">
            ${ICONS.add}
            <span>添加条件</span>
          </button>
        </div>
      `;

      // 内部 any / all 切换
      statWrap.querySelectorAll('.fork-logic-seg-btn[data-stat-logic]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = btn.dataset.statLogic === 'any' ? 'any' : 'all';
          if (model.statLogic === next) return;
          model.statLogic = next;
          renderStatPicker();
        });
      });

      // 新增条件：默认取第一个可用候选（全局或角色），省一次点击
      statWrap.querySelector('.fork-stat-cond-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (statCandidates.length === 0) {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'METRICS // 数值门槛',
              message: '暂无可用数值指标',
              detail: '请先在上方「数值设定」或「角色数值」中建立数值指标。',
              type: 'warn'
            });
          }
          return;
        }
        if (!Array.isArray(model.statConditions)) model.statConditions = [];
        const first = statCandidates[0];
        model.statConditions.push({
          id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          scope: first.scope,
          ownerId: first.ownerId,
          ownerName: first.ownerName,
          metricId: first.metricId,
          statId: first.scope === 'global' ? first.metricId : '',
          op: 'lte',
          value: ''
        });
        renderStatPicker();
      });

      statWrap.querySelectorAll('.fork-stat-cond-item').forEach((itemEl) => {
        const condId = itemEl.dataset.condId;
        const cond = conds.find((c) => c.id === condId);
        if (!cond) return;

        // 指标选择：走通用机能面板。全局与角色混列，角色项显示「角色·指标」，量程作副标
        itemEl.querySelector('.fork-stat-cond-pick')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (statCandidates.length === 0) return;
          if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
          const picked = await SelectModal.pick({
            title: '选择数值指标',
            tag: 'METRICS // 指标锚定',
            options: statCandidates.map((c) => ({
              value: c.key,
              label: c.scope === 'char' ? `${c.ownerName} · ${c.name}` : c.name,
              hint: c.scope === 'char' ? `角色数值 · 量程 ${c.min} ~ ${c.max}` : `全局数值 · 量程 ${c.min} ~ ${c.max}`
            })),
            value: statCondKey(cond),
            searchable: statCandidates.length > 6
          });
          if (picked === null || picked === undefined) return;
          applyStatCondKey(cond, picked, statCandidates);
          renderStatPicker();
        });

        itemEl.querySelectorAll('.fork-stat-op-btn').forEach((opBtn) => {
          opBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const nextOp = opBtn.dataset.op;
            if (STAT_OP_KEYS.indexOf(nextOp) < 0 || cond.op === nextOp) return;
            cond.op = nextOp;
            renderStatPicker();
          });
        });

        const valInput = itemEl.querySelector('.fork-stat-cond-value');
        valInput?.addEventListener('input', (ev) => {
          cond.value = ev.target.value;
        });
        // 越界提示在失焦时刷新，避免边打字边重绘打断输入
        valInput?.addEventListener('blur', () => {
          renderStatPicker();
        });

        itemEl.querySelector('.fork-stat-cond-del')?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const idx = model.statConditions.findIndex((c) => c.id === condId);
          if (idx >= 0) model.statConditions.splice(idx, 1);
          renderStatPicker();
        });
      });
    }

    // 前置线索区块：门槛而非自动机，前置解锁只是把门打开一道
    function renderPrereqPicker() {
      const preWrap = scope.querySelector('.clue-prereq-bind-wrap');
      if (!preWrap) return;
      if (!model.triggers.includes('clue')) {
        preWrap.innerHTML = '';
        preWrap.hidden = true;
        return;
      }

      preWrap.hidden = false;
      const allClues = Array.isArray(currentData.clues) ? currentData.clues : [];
      // 排除自身：自我依赖恒为死锁。真相无自身 id，全部线索都可作前置
      const others = selfId ? allClues.filter((c) => c.id !== selfId) : allClues;
      const picked = Array.isArray(model.prereqClueIds) ? model.prereqClueIds : [];
      const isAll = model.prereqLogic === 'all';

      function nameOf(c) {
        if (!c) return '';
        if (c.name) return c.name;
        const i = allClues.indexOf(c);
        return `CLUE-${String(i + 1).padStart(2, '0')} 未命名线索`;
      }

      let pillsHtml = '';
      if (picked.length === 0) {
        pillsHtml = `<span class="fork-loc-picker-empty">点击指派前置线索 (未绑定)</span>`;
      } else {
        pillsHtml = picked.map((id) => {
          const target = allClues.find((c) => c.id === id);
          const lost = !target;
          return `
            <span class="fork-loc-bind-pill ${lost ? 'is-lost' : ''}">
              <span class="fork-loc-bind-icon">${ICONS.condClue}</span>
              <span class="fork-loc-bind-name">${escapeHtml(lost ? '线索已失效' : nameOf(target))}</span>
            </span>
          `;
        }).join('');
      }

      const logicSegHtml = picked.length >= 2 ? `
        <div class="fork-logic-segment">
          <button type="button" class="fork-logic-seg-btn ${isAll ? '' : 'is-active'}" data-prereq-logic="any">任一 ANY</button>
          <button type="button" class="fork-logic-seg-btn ${isAll ? 'is-active' : ''}" data-prereq-logic="all">全部 ALL</button>
        </div>
      ` : '';

      // 环形依赖：纯逻辑死锁，肉眼看不出来，必须在编纂期暴露。
      // 真相是叙事终点，没有任何线索会以它为前置，结构上不可能成环，故跳过
      let cycleWarnHtml = '';
      if (enablePrereqCycle && selfId) {
        const cycle = findPrereqCycle(selfId);
        if (cycle && cycle.length > 1) {
          const chain = cycle.map((id) => {
            const c = allClues.find((x) => x.id === id);
            const i = allClues.indexOf(c);
            return i >= 0 ? `CLUE-${String(i + 1).padStart(2, '0')}` : '已失效';
          }).join(' → ');
          cycleWarnHtml = `<div class="fork-stat-cond-warn">检测到循环依赖：${escapeHtml(chain)}，相关线索将永远无法解锁。</div>`;
        }
      }

      // 仅设前置线索时等同绑定关系，得让作者知道自己在做什么
      const onlyPrereq = model.triggers.length === 1 && picked.length > 0;
      let soloWarnHtml = '';
      if (onlyPrereq) {
        soloWarnHtml = `<div class="fork-logic-hint">${copy.soloPrereqHint}</div>`;
      }

      preWrap.innerHTML = `
        <div class="fork-clue-prereq-block">
          <div class="fork-field-label-row">
            <label class="fork-field-label">PREREQ // 前置线索</label>
            ${logicSegHtml}
          </div>
          <div class="fork-clue-loc-picker-trigger" role="button" tabindex="0">
            <div class="fork-loc-picker-left">
              <div class="fork-loc-pills-row">${pillsHtml}</div>
            </div>
            <div class="fork-loc-picker-arrow">${ICONS.chevronDown}</div>
          </div>
          ${cycleWarnHtml}
          ${soloWarnHtml}
        </div>
      `;

      preWrap.querySelectorAll('.fork-logic-seg-btn[data-prereq-logic]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = btn.dataset.prereqLogic === 'any' ? 'any' : 'all';
          if (model.prereqLogic === next) return;
          model.prereqLogic = next;
          renderPrereqPicker();
        });
      });

      preWrap.querySelector('.fork-clue-loc-picker-trigger')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (others.length === 0) {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'PREREQ // 前置线索',
              message: selfId ? '暂无其他线索可作为前置' : '暂无可用线索作为前置',
              detail: '请先在「可用线索」中建立至少一条线索。',
              type: 'warn'
            });
          }
          return;
        }
        if (!window.SelectModal || typeof SelectModal.pickMulti !== 'function') return;

        const nextPicked = await SelectModal.pickMulti({
          title: copy.prereqTitle,
          tag: 'PREREQ // 认知门槛',
          options: others.map((c) => {
            const i = allClues.indexOf(c);
            const code = `CLUE-${String(i + 1).padStart(2, '0')}`;
            const brief = String(c.desc || '').replace(/\s+/g, ' ').trim().slice(0, 40);
            return {
              value: c.id,
              label: nameOf(c),
              hint: brief ? `${code} · ${brief}` : `${code} · 暂无内容`
            };
          }),
          values: picked,
          confirmText: '确认指派',
          searchable: others.length > 6
        });

        if (!Array.isArray(nextPicked)) return;
        model.prereqClueIds = selfId
          ? nextPicked.filter((id) => id !== selfId)
          : nextPicked;
        // 环状态可能因本次改动出现或消失，整列重绘让所有卡片同步刷新警示
        if (onRerender) {
          onRerender();
        } else {
          renderPrereqPicker();
        }
      });
    }

    // 挂载 5 种纯 SVG 战术 Chip
    function renderChipsUI() {
      const container = scope.querySelector('.clue-triggers-container');
      if (!container) return;
      container.innerHTML = '';
      const chipsEl = renderTriggerChips(model.triggers, (nextTriggers) => {
        model.triggers = nextTriggers;
        renderChipsUI();
        renderLogicSegment();
        onHeaderSync();
        renderLocationPicker();
        renderKeywordPicker();
        renderTimePicker();
        renderStatPicker();
        renderPrereqPicker();
      });
      container.appendChild(chipsEl);
    }

    renderChipsUI();
    renderLogicSegment();
    onHeaderSync();
    renderLocationPicker();
    renderKeywordPicker();
    renderTimePicker();
    renderStatPicker();
    renderPrereqPicker();
  }

  /**
   * 渲染可用线索列表
   */
  function renderClueList() {
    const listWrap = document.getElementById('forkClueList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.clues) || currentData.clues.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'INTEL // CLUE-00',
        title: '线索网格未激活',
        hint: '点击此处或右上角「添加」布设第一条解谜情报与触发条件',
        iconSvg: ICONS.condClue,
        triggerBtnId: 'forkAddClueBtn'
      });
      return;
    }

    currentData.clues.forEach((clue, index) => {
      const card = document.createElement('div');
      card.className = 'fork-bento-accordion-card';

      const header = document.createElement('div');
      header.className = 'fork-accordion-header';
      header.role = 'button';
      header.tabIndex = 0;
      header.innerHTML = `
        <span class="fork-accordion-code">CLUE-${String(index + 1).padStart(2, '0')}</span>
        <span class="fork-accordion-title">${clue.name || '未命名线索'}</span>
        <span class="fork-accordion-tag">${clue.triggers.length} 触发源</span>
        <div class="fork-accordion-spacer"></div>
        <button type="button" class="fork-btn-icon-del" title="删除此线索">${ICONS.trash}</button>
        <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
      `;

      const body = document.createElement('div');
      body.className = 'fork-accordion-body';
      body.innerHTML = `
        <div class="fork-field-block">
          <label class="fork-field-label">CLUE NAME // 线索名称</label>
          <input type="text" class="fork-input-text clue-name-input" value="${clue.name || ''}" placeholder="如：染血的日记残页">
        </div>
        <div class="fork-field-block" style="margin-top: 10px;">
          <label class="fork-field-label">INTEL CONTENT // 线索内容</label>
          <textarea class="fork-textarea clue-desc-input" rows="3" placeholder="线索所记录的具体文字、暗号或因果破局提示...">${clue.desc || ''}</textarea>
        </div>
        <div class="fork-field-block" style="margin-top: 10px;">
          <div class="fork-field-label-row">
            <label class="fork-field-label">TRIGGER MATRIX // 触发解锁条件</label>
            <div class="clue-logic-segment-wrap"></div>
          </div>
          <div class="clue-triggers-container"></div>
          <div class="clue-logic-hint-wrap"></div>
          <div class="clue-location-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-keyword-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-time-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-stat-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-prereq-bind-wrap" style="margin-top: 8px;"></div>
        </div>
      `;

      // 折叠头部微标：带逻辑词回显门槛松紧
      function syncHeaderTag() {
        const tagEl = card.querySelector('.fork-accordion-tag');
        if (!tagEl) return;
        const count = clue.triggers.length;
        if (count >= 2) {
          const word = clue.triggerLogic === 'all' ? '全部' : '任一';
          tagEl.textContent = `${word} · ${count} 源`;
        } else {
          tagEl.textContent = `${count} 触发源`;
        }
      }

      // 触发条件参数区走公共渲染器，与隐藏真相共用同一套实现
      renderTriggerParamBlocks(body, clue, {
        scopeTag: 'CLUE',
        selfId: clue.id,
        enablePrereqCycle: true,
        onHeaderSync: syncHeaderTag,
        onRerender: renderClueList
      });

      header.addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        card.classList.toggle('is-expanded');
      });

      header.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.clues.splice(index, 1);
        renderClueList();
      });

      body.querySelector('.clue-name-input').addEventListener('input', (e) => {
        clue.name = e.target.value;
        card.querySelector('.fork-accordion-title').textContent = clue.name || '未命名线索';
      });
      body.querySelector('.clue-desc-input').addEventListener('input', (e) => {
        clue.desc = e.target.value;
      });

      card.appendChild(header);
      card.appendChild(body);
      listWrap.appendChild(card);
    });
  }

  /**
   * 渲染隐藏真相区块
   */
  function renderHiddenTruth() {
    const descInput = document.getElementById('forkTruthDesc');
    const descExpandBtn = document.getElementById('forkTruthDescExpandBtn');
    const container = document.getElementById('forkTruthTriggersContainer');
    if (!descInput || !container) return;

    // 公共渲染器按 class 在 scope 内找挂载点，这里取参数区所在的 field-block
    const truthScope = container.closest('.fork-field-block') || container.parentElement;

    descInput.value = currentData.hiddenTruth.desc || '';
    descInput.oninput = (e) => {
      currentData.hiddenTruth.desc = e.target.value;
    };

    if (descExpandBtn) {
      descExpandBtn.onclick = async () => {
        if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
        const updated = await window.TextEditorModal.open({
          title: '核心真相编辑',
          tag: 'CORE TRUTH // 核心真相',
          value: descInput.value || '',
          placeholder: '输入副本最底层的暗线秘密、幕后真凶、隐藏真相与颠覆性事实...',
          maxLength: 8000
        });
        if (updated !== null && updated !== undefined) {
          descInput.value = updated;
          currentData.hiddenTruth.desc = updated;
        }
      };
    }
// 触发条件参数区走公共渲染器，与线索卡共用同一套实现。
    // 真相是叙事终点，没有任何线索以它为前置，结构上不可能成环，故关掉环检测
    renderTriggerParamBlocks(truthScope, currentData.hiddenTruth, {
      scopeTag: 'TRUTH',
      selfId: null,
      enablePrereqCycle: false
    });
  }

  /**
   * 渲染结局分支列表
   */
  function renderEndingsList() {
    const listWrap = document.getElementById('forkEndingsList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.endings) || currentData.endings.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'TERMINAL // END-00',
        title: '结局分流未构建',
        hint: '点击此处或右上角「添加」开辟首个因果走向与通关结局',
        iconSvg: ICONS.condEnding,
        triggerBtnId: 'forkAddEndingBtn'
      });
      return;
    }

    currentData.endings.forEach((ending, index) => {
      const card = document.createElement('div');
      card.className = 'fork-bento-accordion-card';

      const header = document.createElement('div');
      header.className = 'fork-accordion-header';
      header.role = 'button';
      header.tabIndex = 0;
      header.innerHTML = `
        <span class="fork-accordion-code">END-${String(index + 1).padStart(2, '0')}</span>
        <span class="fork-accordion-title">${ending.name || '分支结局'}</span>
        <span class="fork-accordion-tag">${ending.triggers.length} 触发源</span>
        <div class="fork-accordion-spacer"></div>
        <button type="button" class="fork-btn-icon-del" title="删除此结局">${ICONS.trash}</button>
        <div class="fork-accordion-arrow">${ICONS.chevronDown}</div>
      `;

      const body = document.createElement('div');
      body.className = 'fork-accordion-body';
      body.innerHTML = `
        <div class="fork-field-block">
          <label class="fork-field-label">ENDING NAME // 结局名称</label>
          <input type="text" class="fork-input-text ending-name-input" value="${escapeHtml(ending.name || '')}" placeholder="如：黎明突围 // 幸存者报告">
        </div>
        <div class="fork-field-block" style="margin-top: 10px;">
          <div class="fork-field-label-row">
            <label class="fork-field-label">NARRATIVE // 结局详情</label>
            <div class="api-field-actions">
              <button type="button" class="field-expand-btn ending-desc-expand-btn" title="全屏沉浸编辑" aria-label="全屏编辑结局详情">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                </svg>
                <span>全屏</span>
              </button>
            </div>
          </div>
          <textarea class="fork-textarea ending-desc-input" rows="3" placeholder="达成此结局时的演出剧本、落幕文字与结算叙事...">${escapeHtml(ending.desc || '')}</textarea>
        </div>
        <div class="fork-field-block" style="margin-top: 10px;">
          <label class="fork-field-label">RESOLUTION GRADE // 探索揭示度</label>
          <div class="fork-ending-grade-seg">
            <button type="button" class="fork-ending-grade-btn ${ending.grade === 'full' ? 'is-active' : ''}" data-grade="full">完全揭示<em>100%</em></button>
            <button type="button" class="fork-ending-grade-btn ${ending.grade === 'major' ? 'is-active' : ''}" data-grade="major">拨云见日<em>80%</em></button>
            <button type="button" class="fork-ending-grade-btn ${ending.grade === 'partial' ? 'is-active' : ''}" data-grade="partial">雾里看花<em>60%</em></button>
            <button type="button" class="fork-ending-grade-btn ${ending.grade === 'faint' ? 'is-active' : ''}" data-grade="faint">迷影重重<em>40%</em></button>
          </div>
          <div class="fork-ending-grade-hint" data-grade-hint>${gradeHintText(ending.grade)}</div>
        </div>
        <div class="fork-field-block" style="margin-top: 10px;">
          <div class="fork-field-label-row">
            <label class="fork-field-label">TRIGGER MATRIX // 触发解锁条件</label>
            <div class="clue-logic-segment-wrap"></div>
          </div>
          <div class="clue-triggers-container"></div>
          <div class="clue-logic-hint-wrap"></div>
          <div class="clue-location-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-keyword-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-time-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-stat-bind-wrap" style="margin-top: 8px;"></div>
          <div class="clue-prereq-bind-wrap" style="margin-top: 8px;"></div>
        </div>
      `;

      const descInput = body.querySelector('.ending-desc-input');
      const descExpandBtn = body.querySelector('.ending-desc-expand-btn');
      if (descExpandBtn && descInput) {
        descExpandBtn.onclick = async () => {
          if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
          const updated = await window.TextEditorModal.open({
            title: 'ENDING // 结局详情',
            tag: 'NARRATIVE // 结局剧本叙事',
            value: descInput.value || '',
            placeholder: '达成此结局时的演出剧本、落幕文字与结算叙事...',
            maxLength: 8000
          });
          if (updated !== null && updated !== undefined) {
            descInput.value = updated;
            ending.desc = updated;
          }
        };
      }

      // 折叠头部微标：带逻辑词回显门槛松紧，与线索卡同口径
      function syncHeaderTag() {
        const tagEl = card.querySelector('.fork-accordion-tag');
        if (!tagEl) return;
        const count = ending.triggers.length;
        if (count >= 2) {
          const word = ending.triggerLogic === 'all' ? '全部' : '任一';
          tagEl.textContent = `${word} · ${count} 源`;
        } else {
          tagEl.textContent = `${count} 触发源`;
        }
      }

      // 触发条件参数区走公共渲染器，与线索卡、隐藏真相共用同一套实现。
      // 结局是结算终点，没有任何线索以它为前置，结构上不可能成环，故关掉环检测
      renderTriggerParamBlocks(body, ending, {
        scopeTag: 'ENDING',
        selfId: null,
        enablePrereqCycle: false,
        onHeaderSync: syncHeaderTag
      });

      header.addEventListener('click', (e) => {
        if (e.target.closest('.fork-btn-icon-del')) return;
        card.classList.toggle('is-expanded');
      });

      header.querySelector('.fork-btn-icon-del').addEventListener('click', (e) => {
        e.stopPropagation();
        currentData.endings.splice(index, 1);
        renderEndingsList();
      });

      body.querySelector('.ending-name-input').addEventListener('input', (e) => {
        ending.name = e.target.value;
        card.querySelector('.fork-accordion-title').textContent = ending.name || '分支结局';
      });
      body.querySelector('.ending-desc-input').addEventListener('input', (e) => {
        ending.desc = e.target.value;
      });

      // 探索揭示度四档切换：改 grade + 刷新按钮态与说明文案
      const gradeSeg = body.querySelector('.fork-ending-grade-seg');
      const gradeHintEl = body.querySelector('[data-grade-hint]');
      if (gradeSeg) {
        gradeSeg.addEventListener('click', (e) => {
          const btn = e.target.closest('.fork-ending-grade-btn');
          if (!btn) return;
          const next = btn.dataset.grade;
          if (!['full', 'major', 'partial', 'faint'].includes(next) || ending.grade === next) return;
          ending.grade = next;
          gradeSeg.querySelectorAll('.fork-ending-grade-btn').forEach((b) => {
            b.classList.toggle('is-active', b.dataset.grade === next);
          });
          if (gradeHintEl) gradeHintEl.textContent = gradeHintText(next);
        });
      }

      card.appendChild(header);
      card.appendChild(body);
      listWrap.appendChild(card);
    });
  }

  /**
   * 渲染通关条件列表
   */
  function renderClearConditions() {
    const listWrap = document.getElementById('forkClearConditionList');
    if (!listWrap) return;
    listWrap.innerHTML = '';

    if (!Array.isArray(currentData.clearConditions) || currentData.clearConditions.length === 0) {
      renderEmptySlot(listWrap, {
        slotCode: 'OBJECTIVE // MISSION-00',
        title: '主线任务未配置',
        hint: '点击此处或右上角「添加任务」设定通关主线任务',
        iconSvg: ICONS.emptyBeacon,
        triggerBtnId: 'forkAddClearCondBtn'
      });
      return;
    }

    currentData.clearConditions.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'fork-mission-card';
      const missionCode = `MISSION-${String(index + 1).padStart(2, '0')}`;
      card.innerHTML = `
        <div class="fork-mission-card-head">
          <div class="fork-mission-head-left">
            <span class="fork-mission-code-badge">${missionCode}</span>
            <span class="fork-mission-type-tag">OBJECTIVE // 核心目标</span>
          </div>
          <button type="button" class="fork-btn-icon-del fork-mission-del-btn" title="删除任务" aria-label="删除任务 ${missionCode}">
            ${ICONS.trash}
          </button>
        </div>
        <div class="fork-mission-card-body">
          <div class="fork-field-block">
            <div class="fork-field-label-row">
              <label class="fork-field-label">MISSION // 任务内容</label>
              <div class="api-field-actions">
                <button type="button" class="field-expand-btn mission-goal-expand-btn" title="全屏沉浸编辑" aria-label="全屏编辑任务内容">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                  </svg>
                  <span>全屏</span>
                </button>
              </div>
            </div>
            <textarea class="fork-textarea mission-goal-input" rows="2" placeholder="写清这项任务要执行员做什么、为何必须完成，以及推演中的引导方向...">${escapeHtml(item.goal || '')}</textarea>
          </div>
          <div class="fork-field-block">
            <div class="fork-field-label-row">
              <label class="fork-field-label">CRITERIA // 达成判定</label>
              <div class="api-field-actions">
                <button type="button" class="field-expand-btn mission-criteria-expand-btn" title="全屏沉浸编辑" aria-label="全屏编辑达成判定">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
                  </svg>
                  <span>全屏</span>
                </button>
              </div>
            </div>
            <textarea class="fork-textarea mission-criteria-input" rows="2" placeholder="系统核验用的硬条件：存活状态、数值门槛、抵达地点、线索齐备等...">${escapeHtml(item.criteria || '')}</textarea>
          </div>
          <div class="mission-prereq-bind-wrap"></div>
        </div>
      `;

      const goalInput = card.querySelector('.mission-goal-input');
      const criteriaInput = card.querySelector('.mission-criteria-input');

      goalInput.addEventListener('input', (e) => {
        item.goal = e.target.value;
        // text 作为兼容镜像同步，老版本读盘不至于看到空任务
        item.text = e.target.value;
      });
      criteriaInput.addEventListener('input', (e) => {
        item.criteria = e.target.value;
      });

      /** 复用同一套全屏沉浸编辑接线，取消（null）不覆写原值 */
      function bindExpand(btn, input, opts) {
        if (!btn || !input) return;
        btn.onclick = async () => {
          if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
          const updated = await window.TextEditorModal.open({
            title: opts.title,
            tag: opts.tag,
            value: input.value || '',
            placeholder: input.placeholder,
            maxLength: 4000
          });
          if (updated !== null && updated !== undefined) {
            input.value = updated;
            opts.onSave(updated);
          }
        };
      }

      bindExpand(card.querySelector('.mission-goal-expand-btn'), goalInput, {
        title: `${missionCode} // 任务内容`,
        tag: 'MISSION // 任务内容',
        onSave: (val) => {
          item.goal = val;
          item.text = val;
        }
      });

      bindExpand(card.querySelector('.mission-criteria-expand-btn'), criteriaInput, {
        title: `${missionCode} // 达成判定`,
        tag: 'CRITERIA // 达成判定',
        onSave: (val) => {
          item.criteria = val;
        }
      });

      // 前置任务（阶段任务）：全部/任一前置完成后才解锁，空 = 开局即解锁
      function renderMissionPrereq() {
        const preWrap = card.querySelector('.mission-prereq-bind-wrap');
        if (!preWrap) return;
        const all = Array.isArray(currentData.clearConditions) ? currentData.clearConditions : [];
        const others = all.filter((m) => m.id !== item.id);
        const picked = Array.isArray(item.prereqIds) ? item.prereqIds : [];
        const isAll = item.prereqLogic !== 'any';

        function codeOf(m) {
          const i = all.indexOf(m);
          return `MISSION-${String(i + 1).padStart(2, '0')}`;
        }
        function nameOf(m) {
          if (!m) return '';
          const goal = String(m.goal || m.text || '').replace(/\s+/g, ' ').trim();
          return goal ? goal.slice(0, 24) : `${codeOf(m)} 未填写内容`;
        }

        let pillsHtml = '';
        if (picked.length === 0) {
          pillsHtml = `<span class="fork-loc-picker-empty">点击指派前置任务 (开局即解锁)</span>`;
        } else {
          pillsHtml = picked.map((id) => {
            const target = all.find((m) => m.id === id);
            const lost = !target;
            return `
              <span class="fork-loc-bind-pill ${lost ? 'is-lost' : ''}">
                <span class="fork-loc-bind-icon">${ICONS.condClue}</span>
                <span class="fork-loc-bind-name">${escapeHtml(lost ? '任务已失效' : nameOf(target))}</span>
              </span>
            `;
          }).join('');
        }

        const logicSegHtml = picked.length >= 2 ? `
          <div class="fork-logic-segment">
            <button type="button" class="fork-logic-seg-btn ${isAll ? '' : 'is-active'}" data-mission-prereq-logic="any">任一 ANY</button>
            <button type="button" class="fork-logic-seg-btn ${isAll ? 'is-active' : ''}" data-mission-prereq-logic="all">全部 ALL</button>
          </div>
        ` : '';

        let cycleWarnHtml = '';
        const cycle = findMissionPrereqCycle(item.id);
        if (cycle && cycle.length > 1) {
          const chain = cycle.map((id) => {
            const m = all.find((x) => x.id === id);
            return m ? codeOf(m) : '已失效';
          }).join(' → ');
          cycleWarnHtml = `<div class="fork-stat-cond-warn">检测到循环依赖：${escapeHtml(chain)}，相关任务将永远无法解锁。</div>`;
        }

        preWrap.innerHTML = `
          <div class="fork-clue-prereq-block">
            <div class="fork-field-label-row">
              <label class="fork-field-label">PREREQ // 前置任务</label>
              ${logicSegHtml}
            </div>
            <div class="fork-clue-loc-picker-trigger" role="button" tabindex="0">
              <div class="fork-loc-picker-left">
                <div class="fork-loc-pills-row">${pillsHtml}</div>
              </div>
              <div class="fork-loc-picker-arrow">${ICONS.chevronDown}</div>
            </div>
            ${cycleWarnHtml}
            ${picked.length > 0 ? '<div class="fork-logic-hint">未解锁前，这项任务不会出现在推演提示词与任务面板中。</div>' : ''}
          </div>
        `;

        preWrap.querySelectorAll('.fork-logic-seg-btn[data-mission-prereq-logic]').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = btn.dataset.missionPrereqLogic === 'any' ? 'any' : 'all';
            if (item.prereqLogic === next) return;
            item.prereqLogic = next;
            renderMissionPrereq();
          });
        });

        preWrap.querySelector('.fork-clue-loc-picker-trigger')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (others.length === 0) {
            if (window.RetroToast) {
              RetroToast.show({
                tag: 'PREREQ // 前置任务',
                message: '暂无其他任务可作为前置',
                detail: '请先添加至少两项主线任务，再设定解锁顺序。',
                type: 'warn'
              });
            }
            return;
          }
          if (!window.SelectModal || typeof SelectModal.pickMulti !== 'function') return;
          const nextPicked = await SelectModal.pickMulti({
            title: `${missionCode} // 前置任务`,
            tag: 'PREREQ // 阶段门槛',
            options: others.map((m) => {
              const brief = String(m.goal || m.text || '').replace(/\s+/g, ' ').trim().slice(0, 40);
              return {
                value: m.id,
                label: nameOf(m),
                hint: brief ? `${codeOf(m)} · ${brief}` : `${codeOf(m)} · 暂无内容`
              };
            }),
            values: picked,
            confirmText: '确认指派',
            searchable: others.length > 6
          });
          if (!Array.isArray(nextPicked)) return;
          item.prereqIds = nextPicked.filter((id) => id !== item.id);
          // 环状态可能因本次改动出现或消失，整列重绘让所有卡片同步刷新警示
          renderClearConditions();
        });
      }
      renderMissionPrereq();

      card.querySelector('.fork-mission-del-btn').addEventListener('click', () => {
        const removedId = currentData.clearConditions[index] && currentData.clearConditions[index].id;
        currentData.clearConditions.splice(index, 1);
        // 删掉的任务若被别人当前置，残留 id 会变成永久死锁，一并清理
        if (removedId) {
          currentData.clearConditions.forEach((m) => {
            if (Array.isArray(m.prereqIds) && m.prereqIds.includes(removedId)) {
              m.prereqIds = m.prereqIds.filter((id) => id !== removedId);
            }
          });
        }
        renderClearConditions();
      });

      listWrap.appendChild(card);
    });
  }

  /**
   * 绑定所有基础字段的 DOM 双向同步
   */
  function bindCoreInputs() {
    // 封面图片与预览：接入通用 ImagePicker 弹窗与清除
    const coverMedia = document.getElementById('forkEditorCoverMedia');
    const coverFrame = document.getElementById('forkCoverFrame');
    const uploadBtn = document.getElementById('forkUploadCoverBtn');
    const clearBtn = document.getElementById('forkClearCoverBtn');
    const uploadBtnText = document.getElementById('forkUploadCoverBtnText');

    /** 有封面时渲染图，无封面时渲染 16:9 空态占位 */
    function renderCover(src) {
      if (!coverMedia) return;
      if (src) {
        coverMedia.innerHTML = `<img src="${src}" alt="副本封面" class="fork-editor-cover-img">`;
        if (coverFrame) coverFrame.classList.add('has-cover');
        if (uploadBtnText) uploadBtnText.textContent = '更换封面';
        if (clearBtn) clearBtn.hidden = false;
      } else {
        coverMedia.innerHTML = `
          <div class="fork-editor-cover-ph">
            <div class="fork-editor-cover-ph-icon">${ICONS.upload}</div>
            <div class="fork-editor-cover-ph-meta">
              <span class="fork-editor-cover-ph-text">未上传封面 · 16:9 画布装裱</span>
              <span class="fork-editor-cover-ph-sub">点击唤起相册/素材库或网络URL</span>
            </div>
          </div>
        `;
        if (coverFrame) coverFrame.classList.remove('has-cover');
        if (uploadBtnText) uploadBtnText.textContent = '上传封面';
        if (clearBtn) clearBtn.hidden = true;
      }
    }

    /** 从 IndexedDB fork 域取回已归档封面并预览 */
    async function loadCoverFromVault() {
      releaseCoverUrl();
      if (!currentData || !currentData.hasCover) {
        renderCover('');
        return;
      }
      const coverKey = coverKeyOf(currentForkId);
      try {
        const src = await Storage.getAssetSrc(coverKey);
        if (src) {
          coverObjectUrl = src;
          renderCover(src);
          return;
        }
      } catch (err) {
        console.warn('[ForkEditor] 读取封面失败', err);
      }
      renderCover('');
    }
    loadCoverFromVault();

    // 唤起项目通用的 ImagePicker 弹窗
    function openUniversalImagePicker() {
      if (!window.ImagePicker || typeof window.ImagePicker.open !== 'function') {
        if (window.RetroToast) {
          window.RetroToast.show({
            tag: 'COVER // 拾取异常',
            message: '通用图片选择器尚未就绪',
            type: 'warn'
          });
        }
        return;
      }

      window.ImagePicker.open({
        title: '选择副本封面 (16:9 比例)',
        onSelect: (res) => {
          if (!res) return;
          try {
            // 文件存 Blob，远端图存 URL 字符串；两者都在点保存时才落库
            if (res.type === 'file' && res.file) {
              pendingCover = res.file;
              releaseCoverUrl();
              coverObjectUrl = URL.createObjectURL(res.file);
              renderCover(coverObjectUrl);
            } else if (res.type === 'url' && res.url) {
              pendingCover = res.url.trim();
              releaseCoverUrl();
              renderCover(pendingCover);
            }
          } catch (err) {
            console.error('[ForkEditor] 封面处理失败', err);
          }
        }
      });
    }

    if (uploadBtn) {
      uploadBtn.onclick = (e) => {
        e.stopPropagation();
        openUniversalImagePicker();
      };
    }

    if (coverFrame) {
      coverFrame.onclick = (e) => {
        if (e.target.closest('.fork-cover-bar-btn')) return;
        openUniversalImagePicker();
      };
    }

    if (clearBtn) {
      clearBtn.onclick = (e) => {
        e.stopPropagation();
        pendingCover = null;
        releaseCoverUrl();
        renderCover('');
      };
    }

    // 副本名
    const titleInput = document.getElementById('forkTitleInput');
    if (titleInput) {
      titleInput.value = currentData.title || '';
      titleInput.oninput = (e) => {
        currentData.title = e.target.value;
      };
    }

    // 展陈编号：按创建顺序自动分配，只读回显，不接受手改
    syncCodeDisplay();

    // 副本等级（E / 静水 STILL → S+ / 归墟 VOID）: 接入通用 SelectModal
    const levelValEl = document.getElementById('forkLevelValue');
    const levelHidden = document.getElementById('forkLevelSelect');
    const levelTrigger = document.getElementById('forkLevelTrigger');

    function syncLevelDisplay(val) {
      const match = LEVEL_OPTIONS.find((opt) => opt.value === val);
      const label = match ? match.label : val;
      if (levelValEl) levelValEl.textContent = label;
      if (levelHidden) levelHidden.value = val;
    }

    // 默认等级以卷宗模板为唯一真相源，避免显示 S+ 却存成 C
    syncLevelDisplay(currentData.levelKey || DEFAULT_LEVEL_KEY);

    if (levelTrigger) {
      levelTrigger.onclick = async () => {
        if (!window.SelectModal || typeof window.SelectModal.pick !== 'function') return;
        const picked = await window.SelectModal.pick({
          title: '选择副本等级',
          tag: 'LEVEL // 阶位评定',
          options: LEVEL_OPTIONS,
          value: currentData.levelKey || DEFAULT_LEVEL_KEY,
          searchable: false
        });
        if (picked !== null && picked !== undefined) {
          currentData.levelKey = picked;
          syncLevelDisplay(picked);
        }
      };
    }

    // 副本概述：索引与展陈只取前 120 字，这里实时回显已用字数
    const overviewInput = document.getElementById('forkOverviewInput');
    const overviewCountEl = document.getElementById('forkOverviewCount');

    function syncOverviewCount(text) {
      if (!overviewCountEl) return;
      const used = String(text || '').replace(/\s+/g, ' ').trim().length;
      overviewCountEl.textContent = `${used} / ${OVERVIEW_LIMIT}`;
      overviewCountEl.classList.toggle('is-over', used > OVERVIEW_LIMIT);
    }

    if (overviewInput) {
      overviewInput.value = currentData.overview || '';
      syncOverviewCount(currentData.overview);
      overviewInput.oninput = (e) => {
        currentData.overview = e.target.value;
        syncOverviewCount(e.target.value);
      };
    }

    // 背景信息
    const bgInput = document.getElementById('forkBackgroundInput');
    const bgExpandBtn = document.getElementById('forkBackgroundExpandBtn');

    async function openBackgroundTextEditor() {
      if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;
      const current = bgInput ? bgInput.value : (currentData.background || '');
      const updated = await TextEditorModal.open({
        title: '背景信息编辑',
        tag: 'LORE // 背景信息',
        value: current,
        placeholder: '世界观、大背景、基础信息、常识性知识等',
        maxLength: 10000
      });
      if (updated !== null) {
        currentData.background = updated;
        if (bgInput) {
          bgInput.value = updated;
        }
      }
    }

    if (bgInput) {
      bgInput.value = currentData.background || '';
      bgInput.oninput = (e) => {
        currentData.background = e.target.value;
      };
      bgInput.ondblclick = () => openBackgroundTextEditor();
    }

    if (bgExpandBtn) {
      bgExpandBtn.onclick = () => openBackgroundTextEditor();
    }

    // 执行员身份承载机制 ('free' | 'locked')
    const identityCard = document.getElementById('forkIdentityCard');
    const identStatusTag = document.getElementById('forkIdentStatusTag');
    const identValveTrack = document.getElementById('forkIdentValveTrack');
    const freeBtn = document.getElementById('forkIdentFreeBtn');
    const lockedBtn = document.getElementById('forkIdentLockedBtn');
    const identDescCode = document.getElementById('forkIdentDescCode');
    const identDescContent = document.getElementById('forkIdentDescContent');
    const identDescSvg = document.getElementById('forkIdentDescSvg');
    const lockedFields = document.getElementById('forkIdentityLockedFields');
    const lockedRolesCount = document.getElementById('forkLockedRolesCount');
    const lockedRolesScroll = document.getElementById('forkLockedRolesScroll');
    const unpickedAsNpcToggle = document.getElementById('forkUnpickedAsNpcToggle');
    const maxEnvoysField = document.getElementById('forkMaxEnvoysField');
    const maxEnvoysInput = document.getElementById('forkMaxEnvoysInput');

    // 模态弹窗元素
    const roleModalOverlay = document.getElementById('forkRoleModalOverlay');
    const roleModalTitle = document.getElementById('forkRoleModalTitle');
    const roleModalBackBtn = document.getElementById('forkRoleModalBackBtn');
    const roleModalCancelBtn = document.getElementById('forkRoleModalCancelBtn');
    const roleModalSaveBtn = document.getElementById('forkRoleModalSaveBtn');
    const roleModalDeleteBtn = document.getElementById('forkRoleModalDeleteBtn');
    const roleModalAvatarFrame = document.getElementById('forkRoleModalAvatarFrame');
    const roleModalAvatarImg = document.getElementById('forkRoleModalAvatarImg');
    const roleModalAvatarPh = document.getElementById('forkRoleModalAvatarPh');
    const roleModalNameInput = document.getElementById('forkRoleModalNameInput');
    const roleModalGenderInput = document.getElementById('forkRoleModalGenderInput');
    const roleModalProfileInput = document.getElementById('forkRoleModalProfileInput');
    const roleModalProfileExpandBtn = document.getElementById('forkRoleModalProfileExpandBtn');

    let currentEditingRoleId = null;
    let pendingRoleAvatar = '';

    function closeRoleModal() {
      if (!roleModalOverlay) return;
      roleModalOverlay.hidden = true;
      roleModalOverlay.setAttribute('aria-hidden', 'true');
      currentEditingRoleId = null;
      pendingRoleAvatar = '';
    }

    function openRoleModal(roleId) {
      if (!roleModalOverlay) return;
      currentEditingRoleId = roleId || null;
      const allRoles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
      const role = allRoles.find((r) => r.id === roleId);

      if (role) {
        if (roleModalTitle) roleModalTitle.textContent = '编辑预设角色';
        if (roleModalNameInput) roleModalNameInput.value = role.name || '';
        if (roleModalGenderInput) roleModalGenderInput.value = role.gender || '';
        if (roleModalProfileInput) roleModalProfileInput.value = role.profile || '';
        pendingRoleAvatar = role.avatar || '';
        if (roleModalDeleteBtn) roleModalDeleteBtn.hidden = false;
      } else {
        if (roleModalTitle) roleModalTitle.textContent = '新建预设角色';
        if (roleModalNameInput) roleModalNameInput.value = '';
        if (roleModalGenderInput) roleModalGenderInput.value = '';
        if (roleModalProfileInput) roleModalProfileInput.value = '';
        pendingRoleAvatar = '';
        if (roleModalDeleteBtn) roleModalDeleteBtn.hidden = true;
      }

      renderModalAvatar();
      roleModalOverlay.hidden = false;
      roleModalOverlay.setAttribute('aria-hidden', 'false');
    }

    function renderModalAvatar() {
      if (!roleModalAvatarImg || !roleModalAvatarPh) return;
      if (pendingRoleAvatar) {
        // 远端图挂了（外链失效、断网）就退回占位符，不留一个系统裂图图标在那里
        roleModalAvatarImg.onerror = () => {
          roleModalAvatarImg.hidden = true;
          roleModalAvatarPh.hidden = false;
        };
        roleModalAvatarImg.src = pendingRoleAvatar;
        roleModalAvatarImg.hidden = false;
        roleModalAvatarPh.hidden = true;
      } else {
        roleModalAvatarImg.removeAttribute('src');
        roleModalAvatarImg.hidden = true;
        roleModalAvatarPh.hidden = false;
      }
    }

    if (roleModalAvatarFrame) {
      roleModalAvatarFrame.onclick = (e) => {
        e.stopPropagation();
        if (!window.ImagePicker || typeof window.ImagePicker.open !== 'function') {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'VESSEL // 拾取异常',
              message: '通用图片选择器尚未就绪',
              type: 'warn'
            });
          }
          return;
        }

        window.ImagePicker.open({
          title: '选择角色头像 (1:1 比例)',
          // ImagePicker 回调给的是 { type: 'file' | 'url', ... } 而不是裸字符串，
          // 直接塞 img.src 会得到 [object Object] 导致图裂
          onSelect: async (res) => {
            if (!res) return;
            try {
              if (res.type === 'file' && res.file) {
                // 头像是 1:1 小图，压到 512 长边足够清晰又省空间；
                // 存 dataURL 而非 objectURL——后者页面一刷新就失效，头像会变成裂图
                const compressed = await Storage.compressImage(res.file, 512, 0.9);
                pendingRoleAvatar = await blobToDataUrl(compressed);
              } else if (res.type === 'url' && res.url) {
                pendingRoleAvatar = res.url.trim();
              } else {
                return;
              }
              renderModalAvatar();
            } catch (err) {
              console.error('[ForkEditor] 角色头像处理失败', err);
              if (window.RetroToast) {
                window.RetroToast.show({
                  tag: 'VESSEL // 读取失败',
                  message: '头像读取失败',
                  detail: String(err && err.message ? err.message : err),
                  type: 'error'
                });
              }
            }
          }
        });
      };
    }
    if (roleModalBackBtn) roleModalBackBtn.onclick = closeRoleModal;
    if (roleModalCancelBtn) roleModalCancelBtn.onclick = closeRoleModal;

    // 角色设定全屏沉浸编辑：复用项目通用 TextEditorModal，回填进当前 textarea。
    // 取消（返回 null）时保持原值不动
    if (roleModalProfileExpandBtn && roleModalProfileInput) {
      roleModalProfileExpandBtn.onclick = async () => {
        if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
        const updated = await window.TextEditorModal.open({
          title: '角色设定编辑',
          tag: 'PROFILE // 角色设定与原生背景',
          value: roleModalProfileInput.value || '',
          placeholder: '详细输入该预设角色的身世背景、性格特征与剧本设定...',
          maxLength: 5000
        });
        if (updated !== null && updated !== undefined) {
          roleModalProfileInput.value = updated;
        }
      };
    }

    if (roleModalOverlay) {
      roleModalOverlay.onclick = (e) => {
        if (e.target === roleModalOverlay) closeRoleModal();
      };
    }

    if (roleModalDeleteBtn) {
      roleModalDeleteBtn.onclick = () => {
        if (!currentEditingRoleId) return;
        currentData.lockedRoles = (currentData.lockedRoles || []).filter((r) => r.id !== currentEditingRoleId);
        // 删角色连带清理开场绑定：从各开场的绑定列表里剔除该角色
        if (Array.isArray(currentData.openings)) {
          currentData.openings.forEach((op) => {
            if (op && Array.isArray(op.bindRoleIds)) {
              op.bindRoleIds = op.bindRoleIds.filter((id) => id !== currentEditingRoleId);
            }
          });
        }
        syncIdentityDisplay();
        if (typeof renderOpeningTabs === 'function' && document.getElementById('forkOpeningTabsScroll')) {
          renderOpeningTabs();
        }
        closeRoleModal();
      };
    }

    if (roleModalSaveBtn) {
      roleModalSaveBtn.onclick = () => {
        const name = roleModalNameInput ? roleModalNameInput.value.trim() : '';
        const gender = roleModalGenderInput ? roleModalGenderInput.value.trim() : '';
        const profile = roleModalProfileInput ? roleModalProfileInput.value.trim() : '';
        if (!Array.isArray(currentData.lockedRoles)) currentData.lockedRoles = [];

        if (currentEditingRoleId) {
          const target = currentData.lockedRoles.find((r) => r.id === currentEditingRoleId);
          if (target) {
            target.name = name;
            target.gender = gender;
            target.avatar = pendingRoleAvatar;
            target.profile = profile;
          }
        } else {
          currentData.lockedRoles.push({
            id: 'role_' + Date.now(),
            name,
            gender,
            avatar: pendingRoleAvatar,
            profile
          });
        }

        // 向下兼容：把首位角色的名字和背景同步回历史字段
        if (currentData.lockedRoles.length > 0) {
          currentData.identityLockedTitle = currentData.lockedRoles[0].name || '';
          currentData.identityLockedProfile = currentData.lockedRoles[0].profile || '';
        }

        syncIdentityDisplay();
        closeRoleModal();
      };
    }

    function renderLockedRolesScroll() {
      if (!lockedRolesScroll) return;
      lockedRolesScroll.innerHTML = '';
      const roles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
      // 超编只可能来自老卷宗或导入的 JSON：界面标记出来，但不删角色设定
      const isOverflow = roles.length > MAX_ENVOYS;

      if (lockedRolesCount) {
        lockedRolesCount.textContent = `${roles.length} / ${MAX_ENVOYS} 席位`;
        lockedRolesCount.classList.toggle('is-overflow', isOverflow);
        lockedRolesCount.title = isOverflow
          ? `席位已超出上限 ${MAX_ENVOYS}，请删除多余角色`
          : '';
      }

      // 渲染已存在的角色卡槽
      roles.forEach((r, idx) => {
        const slot = document.createElement('div');
        slot.className = 'fork-role-avatar-slot';
        slot.setAttribute('role', 'button');
        slot.setAttribute('tabindex', '0');

        const imgHtml = r.avatar
          ? `<img class="fork-role-slot-img" src="${escapeHtml(r.avatar)}" alt="${escapeHtml(r.name || '角色头像')}"><div class="fork-role-slot-ph" hidden>${ICONS.user}</div>`
          : `<div class="fork-role-slot-ph">${ICONS.user}</div>`;

        slot.innerHTML = `
          <div class="fork-role-slot-circle">
            ${imgHtml}
          </div>
          <div class="fork-role-slot-info">
            <span class="fork-role-slot-name">${escapeHtml(r.name || '未命名')}</span>
            <span class="fork-role-slot-code">ROLE-${String(idx + 1).padStart(2, '0')}</span>
          </div>
        `;

        slot.onclick = () => openRoleModal(r.id);

        // 头像加载失败（外链失效）时退回占位人形，避免一排系统裂图图标。
        // 用 JS 绑定而不是内联 onerror，内联在严格 CSP 下会被拦掉
        const slotImg = slot.querySelector('.fork-role-slot-img');
        const slotPh = slot.querySelector('.fork-role-slot-ph');
        if (slotImg && slotPh) {
          slotImg.addEventListener('error', () => {
            slotImg.hidden = true;
            slotPh.hidden = false;
          });
        }

        lockedRolesScroll.appendChild(slot);
      });

      // 尾部保留「添加角色」虚线圆框槽。满席后不再渲染入口，
      // 从源头挡住超编，而不是等点了再弹提示
      if (roles.length < MAX_ENVOYS) {
        const addSlot = document.createElement('div');
        addSlot.className = 'fork-role-avatar-slot is-add';
        addSlot.setAttribute('role', 'button');
        addSlot.setAttribute('tabindex', '0');
        addSlot.innerHTML = `
          <div class="fork-role-slot-circle">
            <div class="fork-role-slot-add-icon">${ICONS.add}</div>
          </div>
          <div class="fork-role-slot-info">
            <span class="fork-role-slot-name">添加角色</span>
            <span class="fork-role-slot-code">NEW</span>
          </div>
        `;
        addSlot.onclick = () => openRoleModal(null);
        lockedRolesScroll.appendChild(addSlot);
      }
    }

    /**
     * 把接入人数钳制到合法区间。空值、非数字、越界一律回落到边界内，
     * 保证落库的永远是 1-5 的整数，下游进本校验不必再做防御。
     * @param {*} raw
     * @returns {number}
     */
    function clampEnvoys(raw) {
      const n = Math.floor(Number(raw));
      if (!Number.isFinite(n)) return MIN_ENVOYS;
      return Math.min(MAX_ENVOYS, Math.max(MIN_ENVOYS, n));
    }

    const FREE_SVG_PATH = 'M12 2l2.4 6.9 6.9 2.4-6.9 2.4L12 20.6l-2.4-6.9-6.9-2.4 6.9-2.4L12 2z';
    const LOCKED_SVG_PATH = 'M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm3 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z';

    function syncIdentityDisplay() {
      const mode = currentData.identityType || 'free';
      const isFree = mode === 'free';

      if (identityCard) {
        identityCard.classList.toggle('locked-active', !isFree);
      }
      if (identStatusTag) {
        identStatusTag.textContent = isFree ? 'FREE // 角色追加' : 'LOCKED // 既定角色';
      }
      if (identValveTrack) {
        identValveTrack.classList.toggle('locked-selected', !isFree);
      }
      if (freeBtn) {
        freeBtn.classList.toggle('active', isFree);
        freeBtn.setAttribute('aria-checked', isFree ? 'true' : 'false');
      }
      if (lockedBtn) {
        lockedBtn.classList.toggle('active', !isFree);
        lockedBtn.setAttribute('aria-checked', !isFree ? 'true' : 'false');
      }
      if (identDescSvg) {
        identDescSvg.innerHTML = `<path d="${isFree ? FREE_SVG_PATH : LOCKED_SVG_PATH}"/>`;
      }
      if (identDescCode) {
        identDescCode.textContent = isFree ? 'MODE_FREE // 角色追加' : 'MODE_LOCKED // 既定角色';
      }
      if (identDescContent) {
        identDescContent.textContent = isFree
          ? '以自定义身份载入副本，系统自行补全逻辑融入世界，但不会凭空生成社交关系。'
          : '进入原世界已有角色的身体，顶替其行动，继承原有角色的社交关系。未被执行员选中的身份将视作既定NPC出现。';
      }
      if (lockedFields) {
        lockedFields.hidden = isFree;
      }
      // 未选身份作为 NPC 登场开关：回显当前值（默认开）
      if (unpickedAsNpcToggle) {
        unpickedAsNpcToggle.checked = currentData.unpickedRolesAsNpc !== false;
      }
      // 接入人数：自由身份手填，锁定身份由席位数决定，故仅自由身份露出输入框
      if (maxEnvoysField) {
        maxEnvoysField.hidden = !isFree;
      }
      if (isFree && maxEnvoysInput) {
        const val = clampEnvoys(currentData.maxEnvoys);
        currentData.maxEnvoys = val;
        if (maxEnvoysInput.value !== String(val)) {
          maxEnvoysInput.value = String(val);
        }
      }
      if (!isFree) {
        // 锁定身份下人数恒等于席位数，切过来时立刻对齐，避免残留手填值
        const roles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
        currentData.maxEnvoys = Math.max(MIN_ENVOYS, roles.length);
        renderLockedRolesScroll();
      }
      // 开场绑定身份占位随身份类型联动显隐（存在才刷，早于开场初始化时静默跳过）
      if (typeof renderOpeningBind === 'function' && document.getElementById('forkOpeningBindBlock')) {
        renderOpeningBind();
      }
    }

    syncIdentityDisplay();

    // 挂到模块级引用，供 saveForkData 的锁定身份兜底跨作用域刷新界面
    refreshIdentityDisplay = syncIdentityDisplay;

    if (freeBtn) {
      freeBtn.onclick = () => {
        currentData.identityType = 'free';
        syncIdentityDisplay();
      };
    }

    if (lockedBtn) {
      lockedBtn.onclick = () => {
        currentData.identityType = 'locked';
        syncIdentityDisplay();
      };
    }

    // 未选身份作为 NPC 登场开关：勾选状态写回卷宗
    if (unpickedAsNpcToggle) {
      unpickedAsNpcToggle.addEventListener('change', () => {
        currentData.unpickedRolesAsNpc = !!unpickedAsNpcToggle.checked;
      });
    }

    // 接入人数手填：输入过程只做净化（留数字），失焦才钳制补齐，
    // 避免打字中途被强行改写导致光标跳动
    if (maxEnvoysInput) {
      maxEnvoysInput.addEventListener('input', () => {
        const digits = maxEnvoysInput.value.replace(/\D/g, '').slice(0, 1);
        if (maxEnvoysInput.value !== digits) maxEnvoysInput.value = digits;
        if (digits) currentData.maxEnvoys = clampEnvoys(digits);
      });

      maxEnvoysInput.addEventListener('blur', () => {
        const val = clampEnvoys(maxEnvoysInput.value);
        currentData.maxEnvoys = val;
        maxEnvoysInput.value = String(val);
      });
    }

    // 说明：锁定身份早先是「单个称号 + 单段设定」两个输入框，现已改为
    // lockedRoles 角色卡列表（见 renderLockedRolesScroll / openRoleModal）。
    // 这里曾残留四段绑定，引用 lockedTitleInput / lockedProfileInput /
    // lockedProfileExpandBtn / openIdentProfileTextEditor —— 变量与函数都已
    // 随改版删除，HTML 里也没有对应 id，执行到就抛 ReferenceError。
    // 因为整个 bindCoreInputs 被 runIsolated 包着，异常被静默吞掉、整块跳过，
    // 于是这一行之后的所有字段绑定全部失效（开场首帧就是这么丢的）。
    // identityLockedTitle / identityLockedProfile 现在由角色卡保存时回写兼容。

    // 开场首帧：直接上屏的成品正文（写入当前 active 开场套）
    const openingInput = document.getElementById('forkOpeningInput');
    const openingExpandBtn = document.getElementById('forkOpeningExpandBtn');
    if (openingInput) {
      openingInput.value = getActiveOpening()?.opening || '';
      openingInput.oninput = (e) => {
        const op = getActiveOpening();
        if (op) op.opening = e.target.value;
      };
    }
    if (openingExpandBtn && openingInput) {
      openingExpandBtn.onclick = async () => {
        if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
        const updated = await window.TextEditorModal.open({
          title: '开场首帧编辑',
          tag: 'OPENING // 开场首帧',
          value: openingInput.value || '',
          placeholder: '进入副本后直接显示的第一段叙事，原样上屏、不经模型改写。空行分段。',
          maxLength: 8000
        });
        if (updated !== null && updated !== undefined) {
          openingInput.value = updated;
          const op = getActiveOpening();
          if (op) op.opening = updated;
        }
      };
    }

    // 开场情节（写入当前 active 开场套）
    const prologueInput = document.getElementById('forkPrologueInput');
    const prologueExpandBtn = document.getElementById('forkPrologueExpandBtn');
    if (prologueInput) {
      prologueInput.value = getActiveOpening()?.prologue || '';
      prologueInput.oninput = (e) => {
        const op = getActiveOpening();
        if (op) op.prologue = e.target.value;
      };
    }
    if (prologueExpandBtn && prologueInput) {
      prologueExpandBtn.onclick = async () => {
        if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
        const updated = await window.TextEditorModal.open({
          title: '开场情节编辑',
          tag: 'PROLOGUE // 开场情节',
          value: prologueInput.value || '',
          placeholder: '描述执行员刚进入副本、降临现场时的第一幕场景、气氛描写与迫近的初始危机...',
          maxLength: 8000
        });
        if (updated !== null && updated !== undefined) {
          prologueInput.value = updated;
          const op = getActiveOpening();
          if (op) op.prologue = updated;
        }
      };
    }

    // 开场情节持续轮数：打字中只留数字不强改，失焦时钳制为 >=1 整数（空/非法回落 1）
    const prologueRoundsInput = document.getElementById('forkPrologueRoundsInput');
    if (prologueRoundsInput) {
      prologueRoundsInput.value = getActiveOpening()?.prologueRounds || '';
      prologueRoundsInput.oninput = (e) => {
        const digits = e.target.value.replace(/[^\d]/g, '');
        e.target.value = digits;
        const n = parseInt(digits, 10);
        const op = getActiveOpening();
        if (op) op.prologueRounds = (Number.isFinite(n) && n >= 1) ? n : 1;
      };
      prologueRoundsInput.onblur = (e) => {
        const n = parseInt(e.target.value, 10);
        const val = (Number.isFinite(n) && n >= 1) ? n : 1;
        const op = getActiveOpening();
        if (op) op.prologueRounds = val;
        e.target.value = String(val);
      };
    }

    // 多套开场：初始化胶囊排 + 绑定控件（DOM 事件只绑一次），再回显 active
    bindOpeningTabsControls();
    renderOpeningTabs();
    bindOpeningSceneInputs();
  }

  /**
   * 绑定开场场景舞台各字段（时间/星期/气候/地点/场景）。
   * 全部实时双向写入当前 active 开场套的 openingScene。
   */
  function bindOpeningSceneInputs() {
    const active = getActiveOpening();
    const scene = (active && active.openingScene) || {};
    const trim = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));

    // 时间纯数字五栏 + 星期文本，实时绑定
    const timeFields = [
      ['forkSceneYear', 'year'],
      ['forkSceneMonth', 'month'],
      ['forkSceneDay', 'day'],
      ['forkSceneHour', 'hour'],
      ['forkSceneMinute', 'minute'],
      ['forkSceneWeekday', 'weekday'],
      ['forkSceneSeason', 'season'],
      ['forkSceneTemp', 'temp'],
      ['forkSceneWeatherText', 'weather'],
      ['forkSceneLocSub', 'locSub']
    ];
    timeFields.forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = scene[key] || '';
      el.oninput = (e) => { scene[key] = e.target.value; };
    });

    // 星期自动计算：年月日填全才算得出，用 new Date 求星期几，回填输入框与落库
    const weekdayBtn = document.getElementById('forkSceneWeekdayAutoBtn');
    const weekdayInput = document.getElementById('forkSceneWeekday');
    if (weekdayBtn && weekdayInput) {
      weekdayBtn.onclick = () => {
        const y = parseInt(scene.year, 10);
        const m = parseInt(scene.month, 10);
        const d = parseInt(scene.day, 10);
        if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'OPENING // 星期',
              message: '需先填全年、月、日',
              detail: '星期按年月日推算，缺一项算不出',
              type: 'info'
            });
          }
          return;
        }
        const CN_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const dt = new Date(y, m - 1, d);
        // 校验日期真实存在（如 2 月 30 会被 JS 归一化成 3 月，视为非法）
        if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'OPENING // 星期',
              message: '日期不存在',
              detail: '请检查年月日填写是否正确',
              type: 'info'
            });
          }
          return;
        }
        const wd = CN_WEEKDAYS[dt.getDay()];
        weekdayInput.value = wd;
        scene.weekday = wd;
      };
    }

    // 地点：选地图地点（读 locations 列表），落库到 locName；可清空
    const locTrigger = document.getElementById('forkSceneLocTrigger');
    const locValue = document.getElementById('forkSceneLocValue');
    const syncLocLabel = () => {
      if (!locValue) return;
      locValue.textContent = trim(scene.locName) || '选择地图地点（可不选）';
    };
    syncLocLabel();
    if (locTrigger) {
      locTrigger.onclick = async () => {
        if (!window.SelectModal || typeof window.SelectModal.pick !== 'function') return;
        const locs = Array.isArray(currentData.locations) ? currentData.locations : [];
        const options = [{ value: '', label: '不指定地点' }];
        locs.forEach((loc) => {
          const name = trim(loc && loc.name);
          if (name) options.push({ value: name, label: name });
        });
        const picked = await window.SelectModal.pick({
          tag: 'OPENING // 开场地点',
          title: '选择开场地点',
          options,
          value: trim(scene.locName)
        });
        if (picked === null || picked === undefined) return;
        scene.locName = trim(picked);
        syncLocLabel();
      };
    }

    // 开场场景全屏编辑
    const sceneInput = document.getElementById('forkSceneInput');
    const sceneExpandBtn = document.getElementById('forkSceneExpandBtn');
    if (sceneInput) {
      sceneInput.value = scene.scene || '';
      sceneInput.oninput = (e) => { scene.scene = e.target.value; };
    }
    if (sceneExpandBtn && sceneInput) {
      sceneExpandBtn.onclick = async () => {
        if (!window.TextEditorModal || typeof window.TextEditorModal.open !== 'function') return;
        const updated = await window.TextEditorModal.open({
          title: '开场场景编辑',
          tag: 'SCENE // 开场场景',
          value: sceneInput.value || '',
          placeholder: '开场时执行员所处环境的速写：光线、气味、声响、氛围。留空则暂无场景信息。',
          maxLength: 8000
        });
        if (updated !== null && updated !== undefined) {
          sceneInput.value = updated;
          scene.scene = updated;
        }
      };
    }
  }

  /**
   * 把当前 active 开场套的值重新回显到所有开场 DOM 字段。
   * 各字段的 oninput 都是动态 getActiveOpening()，所以切套只需重刷 .value，
   * 不必重新 addEventListener。场景舞台字段交给 bindOpeningSceneInputs 重绑（含地点标签）。
   */
  function refreshOpeningFieldValues() {
    const op = getActiveOpening();
    if (!op) return;
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    setVal('forkOpeningInput', op.opening);
    setVal('forkPrologueInput', op.prologue);
    setVal('forkPrologueRoundsInput', op.prologueRounds);
    bindOpeningSceneInputs();
  }

  /**
   * 渲染开场编号胶囊排 + 绑定身份占位。
   * 胶囊只放编号（01/02…），选中态反色；绑定占位仅锁定身份显示。
   */
  function renderOpeningTabs() {
    const scroll = document.getElementById('forkOpeningTabsScroll');
    if (!scroll) return;
    if (!Array.isArray(currentData.openings) || currentData.openings.length === 0) getActiveOpening();
    const openings = currentData.openings;
    const active = getActiveOpening();

    scroll.innerHTML = '';
    openings.forEach((op, idx) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'fork-opening-tab' + (op.id === (active && active.id) ? ' is-active' : '');
      tab.textContent = String(idx + 1).padStart(2, '0');
      tab.title = (Array.isArray(op.bindRoleIds) && op.bindRoleIds.length > 0) ? '已绑定身份的开场' : '通用开场';
      tab.onclick = () => {
        if (op.id === currentOpeningId) return;
        currentOpeningId = op.id;
        renderOpeningTabs();
        refreshOpeningFieldValues();
        renderOpeningBind();
      };
      scroll.appendChild(tab);
    });

    // 删除按钮：只剩一套时隐藏（至少保留一套开场）
    const delBtn = document.getElementById('forkOpeningDelBtn');
    if (delBtn) delBtn.hidden = openings.length <= 1;

    renderOpeningBind();
  }

  /**
   * 渲染当前 active 开场套的「绑定身份」占位（仅锁定身份可见）。
   * 绑了几个角色就排几个小头像 + 名字；一个都没绑显示「通用（不绑定）」。
   */
  function renderOpeningBind() {
    const block = document.getElementById('forkOpeningBindBlock');
    const listEl = document.getElementById('forkOpeningBindList');
    if (!block) return;

    // 仅锁定身份露出绑定占位；自由身份没有锁定角色可绑
    const isLocked = currentData.identityType === 'locked';
    block.hidden = !isLocked;
    if (!isLocked || !listEl) return;

    const op = getActiveOpening();
    const roles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
    const bindIds = (op && Array.isArray(op.bindRoleIds)) ? op.bindRoleIds : [];
    const bound = bindIds.map((id) => roles.find((r) => r.id === id)).filter(Boolean);

    listEl.innerHTML = '';

    if (bound.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fork-opening-bind-item';
      empty.innerHTML = `
        <div class="fork-opening-bind-avatar"><div class="fork-opening-bind-ph">${ICONS.user}</div></div>
        <span class="fork-opening-bind-name">通用</span>
      `;
      listEl.appendChild(empty);
      return;
    }

    bound.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'fork-opening-bind-item';
      const avatarHtml = r.avatar
        ? `<img src="${escapeHtml(r.avatar)}" alt="${escapeHtml(r.name || '绑定身份')}">`
        : `<div class="fork-opening-bind-ph">${ICONS.user}</div>`;
      item.innerHTML = `
        <div class="fork-opening-bind-avatar">${avatarHtml}</div>
        <span class="fork-opening-bind-name">${escapeHtml(r.name || '未命名')}</span>
      `;
      // 头像外链失效时退回人形占位，避免裂图
      const img = item.querySelector('img');
      const avatarBox = item.querySelector('.fork-opening-bind-avatar');
      if (img && avatarBox) {
        img.addEventListener('error', () => {
          avatarBox.innerHTML = `<div class="fork-opening-bind-ph">${ICONS.user}</div>`;
        });
      }
      listEl.appendChild(item);
    });
  }

  /**
   * 绑定多套开场的交互：添加开场、绑定身份选择。
   * 只在 bindCoreInputs 里调用一次（DOM 只初始化一次），
   * 数据刷新走 renderOpeningTabs / refreshOpeningFieldValues。
   */
  function bindOpeningTabsControls() {
    const addBtn = document.getElementById('forkOpeningAddBtn');
    if (addBtn) {
      addBtn.onclick = () => {
        if (!Array.isArray(currentData.openings)) currentData.openings = [];
        const fresh = {
          id: 'op_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          bindRoleIds: [],
          opening: '', prologue: '', prologueRounds: 5,
          openingScene: {
            year: '', month: '', day: '', hour: '', minute: '', weekday: '',
            season: '', temp: '', weather: '', locName: '', locSub: '', scene: ''
          }
        };
        currentData.openings.push(fresh);
        currentOpeningId = fresh.id;
        renderOpeningTabs();
        refreshOpeningFieldValues();
      };
    }

    // 删除当前开场：二次确认保护（至少保留一套），删完后选中回落到首套
    const delBtn = document.getElementById('forkOpeningDelBtn');
    if (delBtn) {
      delBtn.onclick = async () => {
        const list = Array.isArray(currentData.openings) ? currentData.openings : [];
        if (list.length <= 1) return;
        const op = getActiveOpening();
        if (!op) return;

        const idx = list.findIndex((o) => o && o.id === op.id);
        const numLabel = idx >= 0 ? String(idx + 1).padStart(2, '0') : '';

        if (window.RetroModal && typeof RetroModal.confirm === 'function') {
          const ok = await RetroModal.confirm({
            tag: 'PURGE // 抹除开场',
            message: `确认要删除开场 ${numLabel} 吗？`,
            detail: '该套开场首帧、情节剧本及场景舞台配置将被彻底移除，无法撤销。',
            confirmText: '确认删除',
            cancelText: '取消',
            danger: true
          });
          if (!ok) return;
        }

        currentData.openings = list.filter((o) => o.id !== op.id);
        currentOpeningId = currentData.openings[0] ? currentData.openings[0].id : null;
        renderOpeningTabs();
        refreshOpeningFieldValues();
      };
    }

    const bindSlot = document.getElementById('forkOpeningBindSlot');
    if (bindSlot) {
      bindSlot.onclick = async () => {
        if (!window.SelectModal || typeof window.SelectModal.pickMulti !== 'function') return;
        const op = getActiveOpening();
        if (!op) return;
        const roles = Array.isArray(currentData.lockedRoles) ? currentData.lockedRoles : [];
        if (roles.length === 0) {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'OPENING // 绑定身份',
              message: '暂无可绑定的预设角色',
              detail: '请先在人物维度添加锁定身份的预设角色',
              type: 'info'
            });
          }
          return;
        }
        const options = roles.map((r) => ({
          value: r.id,
          label: r.name || '未命名角色'
        }));
        const picked = await window.SelectModal.pickMulti({
          tag: 'OPENING // 绑定身份',
          title: '选择绑定身份',
          options,
          values: Array.isArray(op.bindRoleIds) ? op.bindRoleIds : [],
          confirmText: '确认绑定',
          searchable: options.length > 6
        });
        // 取消返回 null；确认返回数组（空数组 = 清空绑定，回落通用开场）
        if (!Array.isArray(picked)) return;
        op.bindRoleIds = Array.from(new Set(
          picked.filter((id) => roles.some((r) => r.id === id))
        ));
        renderOpeningTabs();
      };
    }
  }

  /**
   * 绑定所有“+ 添加”按钮的事件
   */
  function bindAddButtons() {
    // 添加 NPC
    document.getElementById('forkAddNpcBtn')?.addEventListener('click', () => {
      currentData.npcs.push({
        id: 'npc_' + Date.now(),
        name: '',
        gender: '',
        desc: '',
        avatar: ''
      });
      renderNpcList();
    });

    // 添加地点
    document.getElementById('forkAddLocationBtn')?.addEventListener('click', () => {
      currentData.locations.push({
        id: 'loc_' + Date.now(),
        name: '',
        position: '',
        desc: ''
      });
      renderLocationList();
    });

    // 添加数值
    document.getElementById('forkAddStatBtn')?.addEventListener('click', () => {
      currentData.stats.push({
        id: 'stat_' + Date.now(),
        name: '',
        min: '0',
        max: '100',
        init: '',
        desc: ''
      });
      renderStatsList();
    });

    // 添加角色数值模板
    document.getElementById('forkAddCharStatBtn')?.addEventListener('click', () => {
      currentData.charStats.push({
        id: 'cstat_' + Date.now(),
        charIds: [],
        npcIds: [],
        metrics: []
      });
      renderCharStatsList();
    });

    // 添加线索
    document.getElementById('forkAddClueBtn')?.addEventListener('click', () => {
      currentData.clues.push({
        id: 'clue_' + Date.now(),
        name: '',
        desc: '',
        triggers: ['location'],
        locationIds: [],
        keywords: '',
        time: { year: '', month: '', day: '', hour: '', minute: '' },
        triggerLogic: 'any',
        statConditions: [],
        statLogic: 'all',
        prereqClueIds: [],
        prereqLogic: 'all'
      });
      renderClueList();
    });

    // 添加结局
    document.getElementById('forkAddEndingBtn')?.addEventListener('click', () => {
      if (!currentData) {
        currentData = createDefaultForkData(currentForkId);
      }
      if (!Array.isArray(currentData.endings)) {
        currentData.endings = [];
      }
      currentData.endings.push({
        id: 'end_' + Date.now(),
        name: '',
        desc: '',
        triggers: ['stat'],
        triggerLogic: 'all',
        locationIds: [],
        keywords: '',
        time: { year: '', month: '', day: '', hour: '', minute: '' },
        statConditions: [],
        statLogic: 'all',
        prereqClueIds: [],
        prereqLogic: 'all'
      });
      renderEndingsList();
    });

    // 添加通关条件
    document.getElementById('forkAddClearCondBtn')?.addEventListener('click', () => {
      currentData.clearConditions.push({
        id: 'cc_' + Date.now(),
        goal: '',
        criteria: '',
        text: '',
        prereqIds: [],
        prereqLogic: 'all'
      });
      renderClearConditions();
    });
  }

  /**
   * 打开全屏编纂器视图
   * @param {string} forkId 副本 id；不传视为新建
   * @param {object} [seed] 新建时的初始归属，如 { salonId }
   */
  async function open(forkId, seed) {
    if (!pageEl) init();
    if (!pageEl) return;

    currentForkId = forkId || ('fork_' + Date.now());
    // 记录本次打开的返回回调（跨页跳转来源指定；无则清空，避免沿用上一次的）
    pendingOnClose = (seed && typeof seed.onClose === 'function') ? seed.onClose : null;
    pendingCover = undefined;
    // 换本卷宗要清掉上一本残留的开场选中态，由 getActiveOpening 兜底回首套
    currentOpeningId = null;

    // 先同步亮页 + 压栈，再做异步读盘：
    // 与 fork-doc / fork-ready 对齐，避免 await 之后才 pushState 与上一页 popstate 抢跑
    document.body.classList.add('page-active');
    pageEl.classList.add('active');
    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    isOpened = true;

    if (window.location.hash !== '#fork-editor') {
      try {
        window.history.pushState({ rfPage: 'fork-editor' }, '', '#fork-editor');
      } catch (_) {}
    }

    // 读盘失败也必须能开页：退回空白模板，至少不把入口彻底堵死
    try {
      currentData = await loadForkData(currentForkId);
    } catch (err) {
      console.warn('[ForkEditor] 卷宗读取失败，已退回空白模板：', currentForkId, err);
      currentData = createDefaultForkData(currentForkId);
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'EDITOR // 读取异常',
          message: '卷宗读取失败',
          detail: '已载入空白模板，请谨慎保存以免覆盖原档',
          type: 'error'
        });
      }
    }
    if (!currentData) currentData = createDefaultForkData(currentForkId);

    // 异步读盘期间用户可能已经手势返回关页，落定后不再强行渲染
    if (!isOpened) return;

    // 新建时把展厅归属带进卷宗，保存后才知道该挂在哪面展墙
    if (seed && seed.salonId) {
      currentData.salonId = seed.salonId;
    }

    // 默认切到第一项 CORE
    switchTab('core');

    renderAllModules();
  }

  /**
   * 全量重绘所有模块。
   * 逐个隔离，单块异常不再连坐整页——页面必须能打开，
   * 用户才有机会把脏数据改回来。导入覆盖后也复用这一套。
   */
  function renderAllModules() {
    [
      ['基础字段绑定', bindCoreInputs],
      ['高危角色', renderHazardCharacterCard],
      ['NPC 列表', renderNpcList],
      ['地点沙盘', renderLocationList],
      ['数值规则', renderStatsList],
      ['角色数值', renderCharStatsList],
      ['线索清单', renderClueList],
      ['隐藏真相', renderHiddenTruth],
      ['结局分支', renderEndingsList],
      ['通关条件', renderClearConditions]
    ].forEach(([name, fn]) => runIsolated(name, fn));
  }

  /**
   * 关闭编纂器视图。退出即归档：保存落定后才收页面。
   *
   * 过去这里是 fire-and-forget —— saveForkData() 不 await 就直接
   * releaseCoverUrl() 并隐藏页面，写库失败时页面已经关掉，Toast 报的错
   * 用户根本没机会关联到「我刚才那次编辑没存上」，属于静默丢数据。
   * 现在等写库结果：成功才收页面，失败留在编纂器让人有机会重试。
   * @returns {Promise<boolean>} 是否真的关掉了页面
   */
  async function close() {
    if (!pageEl) return false;
    // 保存进行中重复点返回会并发写库，直接忽略后续点击
    if (isClosing) return false;
    isClosing = true;

    if (backBtn) backBtn.disabled = true;

    try {
      const saved = await saveForkData();
      if (!saved) {
        // 失败时留在页面：封面 objectURL 不能释放，否则预览会变白框
        if (window.RetroToast) {
          window.RetroToast.show({
            tag: 'EDITOR // 退出中止',
            message: '归档未完成，已留在编纂器',
            detail: '请检查后重试保存，避免本次编纂内容丢失',
            type: 'error'
          });
        }
        return false;
      }

      releaseCoverUrl();
      closeMenu();
      pageEl.classList.remove('active');
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('page-active');
      isOpened = false;
      // 一次性返回回调：跨页跳转来源（如 DECK）指定的返回目标，取出即清，避免重复触发
      if (typeof pendingOnClose === 'function') {
        const cb = pendingOnClose;
        pendingOnClose = null;
        try { cb(); } catch (err) { console.warn('[ForkEditor] 返回回调执行异常：', err); }
      }
      return true;
    } finally {
      isClosing = false;
      if (backBtn) backBtn.disabled = false;
    }
  }

  /**
   * 危险动作二次确认。RetroModal 缺席时退回原生 confirm，
   * 避免弹窗模块未加载时直接抛错、把覆盖/销毁流程卡死在无提示状态。
   */
  async function confirmDanger(opts) {
    if (window.RetroModal && typeof window.RetroModal.confirm === 'function') {
      return await window.RetroModal.confirm(opts);
    }
    return window.confirm(`${opts.message}\n\n${opts.detail || ''}`);
  }

  /**
   * 读出当前副本封面并打成可内嵌 JSON 的条目。
   *
   * 必须走 getAssetRaw 而不是 getAssetSrc：后者返回 objectURL，
   * 写进 JSON 就是一条出了本次会话即失效的死链。
   *
   * 本地图片压到长边 1280 / 质量 0.85 再编码：base64 有 33% 膨胀，
   * 不压的话一张封面能把 JSON 顶到 MB 级。外链原样带走，不做下载。
   * @returns {Promise<{type:string, mime?:string, base64?:string, data?:string}|null>}
   */
  async function buildCoverPayload() {
    if (!currentForkId || !currentData || !currentData.hasCover) return null;
    if (!window.Storage || typeof Storage.getAssetRaw !== 'function') return null;

    try {
      const raw = await Storage.getAssetRaw(coverKeyOf(currentForkId));
      if (!raw) return null;

      if (raw.data instanceof Blob) {
        let blob = raw.data;
        try {
          if (typeof Storage.compressImage === 'function') {
            blob = await Storage.compressImage(blob, 1280, 0.85);
          }
        } catch (_) {
          // 压缩失败不该让整个导出失败，退回原图
          blob = raw.data;
        }
        return {
          type: 'blob',
          mime: blob.type || 'image/jpeg',
          base64: await blobToBase64(blob)
        };
      }
      if (typeof raw.data === 'string' && raw.data) {
        return { type: 'url', data: raw.data };
      }
      return null;
    } catch (err) {
      console.warn('[ForkEditor] 封面读取失败，将导出无封面卷宗：', err);
      return null;
    }
  }

  /**
   * 导出当前卷宗为 JSON。
   * 文件名统一走 Downloader，格式为 溯流计划-{类型}-{时间戳}.json，
   * 类型标签带上展陈编号与副本名，下载目录里能直接认出是哪一本。
   *
   * 封面以 base64 内嵌在 cover 字段，与 data-vault.js 的资产口径一致，
   * 单文件无外部依赖，换设备导入也能带上封面。
   */
  async function exportForkJson() {
    if (!currentData) {
      toastMenu('IO // 导出失败', '当前没有可导出的卷宗', '请先打开或新建一个副本', 'error');
      return;
    }

    try {
      if (!window.Downloader || typeof Downloader.save !== 'function') {
        throw new Error('下载器模块尚未加载');
      }

      // cover 为可选字段：老包没有它只是没封面，新老包互相都能解析，
      // 因此 version 保持 1，不算破坏性变更
      const cover = await buildCoverPayload();
      const pkg = {
        kind: 'retroflow-fork',
        version: 1,
        exportedAt: Date.now(),
        dossier: currentData,
        cover
      };
      const json = JSON.stringify(pkg, null, 2);
      const blob = new Blob([json], { type: 'application/json' });

      // 标签里的副本名可能带斜杠等非法字符，交给 Downloader 内部 sanitize
      const codePart = currentData.code || '未编号';
      const titlePart = currentData.title || '未命名副本';
      const label = `副本-${codePart}-${titlePart}`;

      // save 现在返回 Promise<{name,via}>：原生壳下 await 完成即文件已落盘
      const saved = await Downloader.save(blob, label, 'json');
      const name = (saved && saved.name) || '';

      const sizeText = formatBytes(blob.size);
      const coverText = cover ? '含封面' : '无封面';
      toastMenu('IO // 导出副本', '卷宗已导出', `${name}｜${coverText} · ${sizeText}`, 'success');
    } catch (err) {
      console.warn('[ForkEditor] 导出卷宗失败：', err);
      toastMenu('IO // 导出失败', '卷宗导出失败', String(err && err.message ? err.message : err), 'error');
    }
  }

  /**
   * 解析导入包。兼容两种形态：
   *   1. 本编纂器导出的 { kind:'retroflow-fork', dossier:{...}, cover:{...} } 包装格式；
   *   2. 裸卷宗对象（手工编辑或早期导出）。
   *
   * 返回 { dossier, cover }：原先只返回卷宗本体，封面进包后调用方
   * 拿不到 cover，所以这里改成同时交出两者。裸卷宗与老包的 cover 为 null。
   * @returns {{dossier: object, cover: object|null}|null} 无法识别时返回 null
   */
  function parseForkPackage(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (_) {
      return null;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    // 包装格式优先
    if (raw.kind === 'retroflow-fork' && raw.dossier && typeof raw.dossier === 'object') {
      const cover = raw.cover && typeof raw.cover === 'object' ? raw.cover : null;
      return { dossier: raw.dossier, cover };
    }
    // 裸卷宗：靠特征字段判定，避免把任意 JSON 当卷宗灌进来
    const looksLikeDossier = ['title', 'overview', 'npcs', 'locations', 'stats', 'clues', 'endings']
      .some((k) => Object.prototype.hasOwnProperty.call(raw, k));
    return looksLikeDossier ? { dossier: raw, cover: null } : null;
  }

  /**
   * 把导入包里的封面条目还原成可落库的值。
   * @param {object|null} cover { type:'blob', mime, base64 } 或 { type:'url', data }
   * @returns {Blob|string|null} 可直接交给 Storage.setAsset 的值
   */
  function restoreCoverAsset(cover) {
    if (!cover || typeof cover !== 'object') return null;
    try {
      if (cover.type === 'blob' && cover.base64) {
        return base64ToBlob(cover.base64, cover.mime || 'image/jpeg');
      }
      if (cover.type === 'url' && typeof cover.data === 'string' && cover.data) {
        return cover.data;
      }
    } catch (err) {
      console.warn('[ForkEditor] 封面还原失败，将保留原封面：', err);
    }
    return null;
  }

  /**
   * 导入覆盖：把选中的 JSON 卷宗灌进当前副本。
   *
   * 关键约束：id / seq / code / salonId 一律保留当前副本的值，不吃导入包里的。
   * 否则会出现两本副本抢同一个展陈编号，或副本莫名跳到别的展厅去。
   *
   * 封面例外：包里带封面就吃包里的，包里没有则保留当前副本已有的封面
   * 不动。导入的是文字内容，不该顺手把已经配好的封面抹掉。
   */
  async function importForkJson(file) {
    if (!file) return;

    let text = '';
    try {
      text = await file.text();
    } catch (_) {
      toastMenu('IO // 读取失败', '无法读取所选文件', '请确认文件未被占用后重试', 'error');
      return;
    }

    const parsed = parseForkPackage(text);
    if (!parsed) {
      toastMenu('IO // 格式错误', '这不是有效的副本卷宗文件', '请选择由「导出JSON」生成的 .json 文件', 'warning');
      return;
    }

    const incoming = parsed.dossier;
    // 包里的封面能否真的还原出来，决定确认文案怎么写，所以先解出来
    const incomingCover = restoreCoverAsset(parsed.cover);
    const incomingTitle = String(incoming.title || '未命名副本');

    const coverNote = incomingCover
      ? '导入包内封面将一并覆盖当前封面。'
      : '导入包未含封面，当前封面保持不变。';
    const ok = await confirmDanger({
      message: `确认用「${incomingTitle}」覆盖当前副本吗？`,
      detail: `当前副本的全部编纂内容（概览、人物、规则、剧情）将被导入文件整体替换，无法恢复。展陈编号与所属展厅保持不变。${coverNote}`,
      confirmText: '确认覆盖',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;

    try {
      // 身份字段锚定当前副本，避免编号冲突与展厅错位。
      // hasCover 不在锚定之列：包里有封面就置真，没有才沿用当前值。
      const keep = {
        id: currentForkId,
        seq: currentData.seq,
        code: currentData.code,
        salonId: currentData.salonId,
        hasCover: incomingCover ? true : currentData.hasCover
      };
      const merged = Object.assign(createDefaultForkData(currentForkId), incoming, keep);
      currentData = normalizeForkData(merged);

      // 有新封面就交给 saveForkData 一并落库（它认 pendingCover）；
      // 没有则置回 undefined，表示本次不动封面资产
      pendingCover = incomingCover || undefined;

      // 先落库再重绘。封面预览走 loadCoverFromVault 从 IndexedDB 读，
      // 若在写入前重绘，读到的还是被覆盖前的旧封面，画面与数据会不一致。
      const saved = await saveForkData({ silent: true });

      switchTab('core');
      renderAllModules();
      syncCodeDisplay();

      if (!saved) {
        toastMenu('IO // 导入未落库', '内容已载入但归档失败', '请用「保存副本」重试，否则退出后会丢失', 'error');
        return;
      }
      const coverText = incomingCover ? '含封面' : '未含封面';
      toastMenu('IO // 导入覆盖', '卷宗已导入并归档', `${keep.code || '未编号'} · ${incomingTitle}｜${coverText}`, 'success');
    } catch (err) {
      console.warn('[ForkEditor] 导入卷宗失败：', err);
      toastMenu('IO // 导入失败', '卷宗导入失败', String(err && err.message ? err.message : err), 'error');
    }
  }

  /**
   * 销毁当前副本：卷宗、索引项与封面资产一并回收，随后退出编纂器。
   * 走 Store.removeForkDossier，与档案馆的删除口径一致。
   */
  async function destroyFork() {
    if (!currentForkId || !currentData) {
      toastMenu('DANGER // 销毁失败', '当前没有可销毁的副本', '', 'error');
      return;
    }

    const title = currentData.title || '未命名副本';
    const code = currentData.code || '未编号';
    const ok = await confirmDanger({
      message: `确认彻底销毁副本「${title}」吗？`,
      detail: `${code} 的全部编纂内容与封面影像将被物理抹除，并从副本档案馆的展墙上移除，无法恢复。`,
      confirmText: '确认销毁',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;

    try {
      if (!window.Store || typeof Store.removeForkDossier !== 'function') {
        throw new Error('存储模块尚未加载');
      }
      const removed = await Store.removeForkDossier(currentForkId);
      if (!removed) throw new Error('索引回收未成功');

      // 销毁后卷宗已不存在，退出时不能再触发归档把它写回去
      currentData = null;
      currentForkId = null;
      pendingCover = undefined;

      releaseCoverUrl();
      closeMenu();
      if (pageEl) {
        pageEl.classList.remove('active');
        pageEl.hidden = true;
        pageEl.setAttribute('aria-hidden', 'true');
      }
      document.body.classList.remove('page-active');

      // 展墙需要重绘，否则被销毁的那幅画还挂在墙上
      if (window.ForkArchiveUI && typeof window.ForkArchiveUI.buildCurrentSalon === 'function') {
        window.ForkArchiveUI.buildCurrentSalon();
      }

      toastMenu('DANGER // 销毁完成', '副本已彻底销毁', `${code} · ${title}`, 'success');
    } catch (err) {
      console.warn('[ForkEditor] 销毁副本失败：', err);
      toastMenu('DANGER // 销毁失败', '副本销毁失败', String(err && err.message ? err.message : err), 'error');
    }
  }

  /** 菜单操作统一的 Toast 出口，省掉每处的存在性判断 */
  function toastMenu(tag, message, detail, type) {
    if (!window.RetroToast) return;
    window.RetroToast.show({ tag, message, detail: detail || '', type: type || 'info' });
  }

  /**
   * 关闭顶栏烤串冒泡菜单
   */
  function closeMenu() {
    if (!menuPopover) return;
    menuPopover.hidden = true;
    menuPopover.setAttribute('aria-hidden', 'true');
    if (moreBtn) {
      moreBtn.classList.remove('is-active');
      moreBtn.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * 打开顶栏烤串冒泡菜单
   */
  function openMenu() {
    if (!menuPopover) return;
    menuPopover.hidden = false;
    menuPopover.setAttribute('aria-hidden', 'false');
    if (moreBtn) {
      moreBtn.classList.add('is-active');
      moreBtn.setAttribute('aria-expanded', 'true');
    }
  }

  /**
   * 切换顶栏烤串冒泡菜单状态
   */
  function toggleMenu() {
    if (!menuPopover) return;
    if (menuPopover.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  }

  /**
   * 初始化控制器
   */
  function init() {
    pageEl = document.getElementById('forkEditorPage');
    if (!pageEl) return;

    backBtn = document.getElementById('forkEditorBackBtn');
    moreBtn = document.getElementById('forkEditorMoreBtn');
    menuPopover = document.getElementById('forkEditorMenuPopover');
    importInput = document.getElementById('forkEditorImportInput');
    tabButtons = Array.from(document.querySelectorAll('.fork-editor-tab-btn'));
    tabPanels = Array.from(document.querySelectorAll('.fork-editor-tab-panel'));

    if (backBtn) {
      // close 现在是异步的（要等归档落定），裸调时 reject 会静默丢失，显式接住并告警
      backBtn.onclick = () => {
        Promise.resolve(close()).then((closed) => {
          // 关页成功后消费掉历史桩，让系统返回栈与页面状态对齐
          if (closed && (window.location.hash === '#fork-editor')) {
            try {
              window.history.back();
            } catch (_) {}
          }
        }).catch((err) => {
          console.warn('[ForkEditor] 退出归档异常：', err);
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'EDITOR // 退出异常',
              message: '退出流程出错',
              detail: String(err && err.message ? err.message : err),
              type: 'error'
            });
          }
        });
      };
    }

    // 系统手势返回 / 物理返回键：历史桩已被浏览器弹掉，走归档关页；
    // 若归档失败需留在页面，则补回历史桩，保证栈与页面状态重新对齐
    window.addEventListener('popstate', () => {
      if (!isOpened) return;
      // 菜单开着先收菜单，并补回历史桩
      if (menuPopover && !menuPopover.hidden) {
        closeMenu();
        try {
          window.history.pushState({ rfPage: 'fork-editor' }, '', '#fork-editor');
        } catch (_) {}
        return;
      }
      Promise.resolve(close()).then((closed) => {
        if (!closed) {
          // 归档失败留在页面：补回历史桩
          try {
            window.history.pushState({ rfPage: 'fork-editor' }, '', '#fork-editor');
          } catch (_) {}
        }
      }).catch((err) => {
        console.warn('[ForkEditor] 手势返回归档异常：', err);
        try {
          window.history.pushState({ rfPage: 'fork-editor' }, '', '#fork-editor');
        } catch (_) {}
      });
    });

    if (moreBtn) {
      moreBtn.onclick = (e) => {
        e.stopPropagation();
        toggleMenu();
      };
    }

    // 冒泡菜单内项点击分发
    if (menuPopover) {
      menuPopover.addEventListener('click', (e) => {
        const item = e.target.closest('.retro-kebab-item');
        if (!item) return;
        e.stopPropagation();
        const action = item.dataset.action;
        closeMenu();

        switch (action) {
          case 'save':
            Promise.resolve(saveForkData()).catch((err) => {
              console.warn('[ForkEditor] 手动归档异常：', err);
            });
            break;
          case 'ai-assist':
            toastMenu('AI // 写作助手', '智能推演准备中', 'AI 辅助生成人物背景与副本主线功能即将接入', 'info');
            break;
          case 'export-json':
            Promise.resolve(exportForkJson()).catch((err) => {
              console.warn('[ForkEditor] 导出副本异常：', err);
            });
            break;
          case 'import-override':
            if (importInput) {
              // 先清空，否则连续选同一个文件不会触发 change
              importInput.value = '';
              importInput.click();
            }
            break;
          case 'destroy':
            Promise.resolve(destroyFork()).catch((err) => {
              console.warn('[ForkEditor] 销毁副本异常：', err);
            });
            break;
          default:
            break;
        }
      });
    }

    // 导入覆盖：隐藏文件选择器落定后交给 importForkJson 解析
    if (importInput) {
      importInput.addEventListener('change', () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        Promise.resolve(importForkJson(file))
          .catch((err) => {
            console.warn('[ForkEditor] 导入覆盖异常：', err);
            toastMenu('IO // 导入失败', '导入流程出错', String(err && err.message ? err.message : err), 'error');
          })
          .finally(() => {
            // 用完即清，保证下次选同一个文件仍能触发 change
            importInput.value = '';
          });
      });
    }

    // 点击外部自动收起冒泡菜单
    document.addEventListener('click', (e) => {
      if (menuPopover && !menuPopover.hidden) {
        if (!menuPopover.contains(e.target) && e.target !== moreBtn && !moreBtn?.contains(e.target)) {
          closeMenu();
        }
      }
    });

    tabButtons.forEach((btn) => {
      btn.onclick = () => switchTab(btn.dataset.tab);
    });

    // 高危角色选择统一由 SelectModal 管理关闭与遮罩交互。

    bindAddButtons();
  }

  // 挂载全局对象
  window.ForkEditorUI = {
    open,
    close,
    init,
    isOpen: () => isOpened,
    save: saveForkData,
    getData: () => currentData
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
