/**
 * 溯流计划 · 观测档案算法层与读写代理 (Psych Store)
 *
 * 职责：
 * 1. 部门编制定义表与查询（三千世界 / 无限世界）。
 * 2. 纯前端算法：入职天数计算、生日星座推算、六维偏好(5分制)雷达顶点映射、精神值状态判定。
 * 3. 读写代理：观测档案本身是个人档案的一部分，数据存放在 Store 的 envoy.psych 域
 *    （IndexedDB，与 envoy.identity 同源同介质），本模块不再自持存储。
 */
(() => {
  'use strict';

  // 部门编制定义表（三千世界 / 无限世界，一经选择不可轻易变动）
  const DEPARTMENTS = [
    {
      id: 'three_thousand',
      name: '三千世界',
      en: 'THREE THOUSAND REALMS',
      code: 'DEPT-03K',
      sub: '快穿流派 · 节点修正',
      desc: '表面运转正常、实则暗藏漏洞的世界。介入后多以身份伪装融入环境，偏向利用人心博弈、智计谋略与人际策动，在暗处修正世界走向。'
    },
    {
      id: 'infinite',
      name: '无限世界',
      en: 'INFINITE REALMS',
      code: 'DEPT-INF',
      sub: '无限流派 · 规则破局',
      desc: '本身已严重扭曲、濒临崩溃的高危世界。常被投入充满奇特规则与异常现象的封闭场所，需要依靠敏锐洞察破除规则陷阱，对心智韧性与身体机能均有较高要求。'
    }
  ];

  /**
   * 取默认观测档案模型。真相源在 Store.DEFAULT_PSYCH，
   * Store 尚未就绪时给一份最小可用结构，避免调用方拿到 undefined。
   * @returns {Object}
   */
  function defaultProfile() {
    if (window.Store && window.Store.DEFAULT_PSYCH) {
      return JSON.parse(JSON.stringify(window.Store.DEFAULT_PSYCH));
    }
    return {
      department: DEPARTMENTS[0].id,
      sanity: 100,
      maxSanity: 100,
      career: { joinedAt: null, level: 'LV.1', currentExp: 0, nextExp: 100, totalRuns: 0, successRuns: 0, failedRuns: 0, clearedList: [] },
      radar: { reason: 3, empathy: 3, will: 3, insight: 3, physique: 3, creativity: 3 },
      talent: { name: '', rank: '', desc: '' },
      coreDesire: '',
      matrix: { zodiac: '', mbti: '', enneagram: '', alignment: '', attachment: '', instinct: '' },
      skills: [],
      synthesis: { style: '', social: '', personality: '', lastSynthesizedAt: null }
    };
  }

  /**
   * 按 id 取部门定义，非法或缺失时兜底为三千世界。
   * 同时兼容早期可能存过中文名的情况。
   * @param {string} id
   * @returns {{id:string,name:string,en:string,code:string,sub:string,desc:string}}
   */
  function getDepartment(id) {
    const key = String(id || '').trim();
    const hit = DEPARTMENTS.find((d) => d.id === key || d.name === key);
    return hit || DEPARTMENTS[0];
  }

  /**
   * 取部门在定义表中的序号（用于步进器左右循环切换）
   * @param {string} id
   * @returns {number}
   */
  function getDepartmentIndex(id) {
    const cur = getDepartment(id);
    const idx = DEPARTMENTS.findIndex((d) => d.id === cur.id);
    return idx < 0 ? 0 : idx;
  }

  /**
   * 从生日字符串自动计算星座 (YYYY-MM-DD 或 MM-DD)
   */
  function calculateZodiac(birthdayStr) {
    if (!birthdayStr || typeof birthdayStr !== 'string') return '未知星座';
    const parts = birthdayStr.split('-');
    if (parts.length < 2) return '未知星座';
    
    let month, day;
    if (parts.length === 3) {
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else {
      month = parseInt(parts[0], 10);
      day = parseInt(parts[1], 10);
    }

    if (isNaN(month) || isNaN(day)) return '未知星座';

    const zodiacMap = [
      { name: '摩羯座 // CAPRICORN', start: [1, 1], end: [1, 19] },
      { name: '水瓶座 // AQUARIUS', start: [1, 20], end: [2, 18] },
      { name: '双鱼座 // PISCES', start: [2, 19], end: [3, 20] },
      { name: '白羊座 // ARIES', start: [3, 21], end: [4, 19] },
      { name: '金牛座 // TAURUS', start: [4, 20], end: [5, 20] },
      { name: '双子座 // GEMINI', start: [5, 21], end: [6, 21] },
      { name: '巨蟹座 // CANCER', start: [6, 22], end: [7, 22] },
      { name: '狮子座 // LEO', start: [7, 23], end: [8, 22] },
      { name: '处女座 // VIRGO', start: [8, 23], end: [9, 22] },
      { name: '天秤座 // LIBRA', start: [9, 23], end: [10, 23] },
      { name: '天蝎座 // SCORPIO', start: [10, 24], end: [11, 22] },
      { name: '射手座 // SAGITTARIUS', start: [11, 23], end: [12, 21] },
      { name: '摩羯座 // CAPRICORN', start: [12, 22], end: [12, 31] }
    ];

    for (const z of zodiacMap) {
      const isMatch = (month === z.start[0] && day >= z.start[1]) || (month === z.end[0] && day <= z.end[1]);
      if (isMatch) return z.name;
    }
    return '未知星座';
  }

  /**
   * 计算入职在役天数
   */
  function calculateServiceDays(joinedAt) {
    if (!joinedAt) return 0;
    const diffMs = Math.max(0, Date.now() - joinedAt);
    return Math.max(1, Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1);
  }

  /**
   * 读取观测档案。
   * 数据在 Store.envoy.psych（IndexedDB 装载后的内存副本），这里是纯同步内存读，
   * 与 Store.envoy.identity 完全同款。请在 Boot.onReady 之后调用。
   * @returns {Object}
   */
  function load() {
    if (window.Store && window.Store.envoy && window.Store.envoy.psych) {
      return window.Store.envoy.psych;
    }
    return defaultProfile();
  }

  /**
   * 保存观测档案。写入 envoy.psych 域，内存与 IndexedDB 同时更新。
   * @param {Object} data 完整观测档案
   * @returns {Promise<boolean>} 是否成功落盘
   */
  function save(data) {
    if (!window.Store || typeof window.Store.save !== 'function') {
      console.error('[PsychStore] Store 未就绪，观测档案写入被丢弃');
      return Promise.resolve(false);
    }
    return window.Store.save('envoy.psych', data);
  }

  /**
   * 纯 SVG 六维雷达图多边形点位计算
   * @param {Object} radar { reason, empathy, will, insight, physique, creativity } 0.0~5.0
   * @param {number} cx 中心点 X (默认 100)
   * @param {number} cy 中心点 Y (默认 100)
   * @param {number} maxRadius 最大半径 (默认 80)
   * @returns {string} points 属性字符串，如 "100,20 160,50 ..."
   */
  function calculateRadarPoints(radar, cx = 100, cy = 100, maxRadius = 80) {
    const keys = ['reason', 'empathy', 'will', 'insight', 'physique', 'creativity'];
    // 6 个维度的角度，0度在顶部 ( -90deg 在正北 )
    const angles = [-90, -30, 30, 90, 150, 210];
    
    return keys.map((k, i) => {
      const val = Math.max(0, Math.min(5.0, Number(radar[k]) || 0));
      const ratio = val / 5.0;
      const r = maxRadius * ratio;
      const rad = (angles[i] * Math.PI) / 180;
      const x = (cx + r * Math.cos(rad)).toFixed(1);
      const y = (cy + r * Math.sin(rad)).toFixed(1);
      return `${x},${y}`;
    }).join(' ');
  }

  /**
   * 计算精神值状态文案与等级状态
   * 85-100 良好 (OPTIMAL)
   * 60-84  波动 (FLUCTUANT)
   * 30-59  衰弱 (WEAKENED)
   * 1-29   濒危 (CRITICAL)
   * 0      消亡 (ZEROED)
   */
  function getSanityStatus(val) {
    const num = Math.max(0, Math.min(100, Math.round(Number(val) || 0)));
    if (num >= 85) {
      return { level: 'optimal', text: '良好', code: 'OPTIMAL', colorVar: '--secondary-color' };
    }
    if (num >= 60) {
      return { level: 'stable', text: '波动', code: 'FLUCTUANT', colorVar: '--decor-color' };
    }
    if (num >= 30) {
      return { level: 'warning', text: '衰弱', code: 'WEAKENED', colorVar: '--warning-color' };
    }
    if (num >= 1) {
      return { level: 'critical', text: '濒危', code: 'CRITICAL', colorVar: '--danger-color' };
    }
    return { level: 'deceased', text: '消亡', code: 'ZEROED', colorVar: '--inactive-color' };
  }

  // 挂载全局
  window.PsychStore = {
    load,
    save,
    calculateZodiac,
    calculateServiceDays,
    calculateRadarPoints,
    getSanityStatus,
    getDepartment,
    getDepartmentIndex,
    DEPARTMENTS,
    defaultProfile
  };
})();
