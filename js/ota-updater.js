/**
 * ============================================================================
 * 溯流计划 · OTA 热更检查器（阶段 1：只查不装）
 * ============================================================================
 *
 * 职责边界（重要）：
 *   本模块只负责「检查」——拉远端清单、与本地版本比对、给出结论。
 *   「下载 + 校验 + 应用 + 回滚」由 RetroflowOTA 负责（阶段 2，尚未实现）。
 *   两者刻意分离：检查只需要 fetch，零原生依赖，浏览器里就能测；
 *   应用需要 @capacitor/filesystem 写可写目录，只能在原生壳里跑。
 *   阶段 1 里 RetroflowOTA 不存在时，UI 会禁用「立即更新」而不是假装成功。
 *
 * 多源回退：
 *   GitHub raw → jsDelivr CDN（同一仓库的两个入口）。
 *   raw 排第一：真机裸网实测 raw 可连、jsDelivr 20 秒内无响应。
 *   jsDelivr 在前时，每次检查都要先白等一个超时才轮到 raw。
 *   顺序试，第一个拿到合法 JSON 的就用；全失败才报「更新服务不可用」。
 *   源不可达不会让 app 变砖：APK 内置了全套 www，离线照样玩，只是收不到更新。
 *
 * 缓存穿透：
 *   raw / jsDelivr 都有 CDN 缓存（raw 约 5 分钟）。请求带 _t 时间戳参数
 *   并显式 cache:'no-store'，否则刚发布的清单可能几分钟内查不到。
 *
 * 规范：零 Emoji、零分割线、纯 SVG（UI 侧见 ota-ui.js）。
 * ============================================================================
 */
(() => {
  'use strict';

  /** 本模块支持的清单格式版本。远端高于此值时拒绝解析，提示升级 APK。 */
  const SUPPORTED_SCHEMA = 1;

  /** 请求超时（毫秒）。CDN 偶发慢，给足但不无限等。 */
  const FETCH_TIMEOUT_MS = 12000;

  /**
   * 更新源列表，按顺序回退。
   * 都指向仓库里固定路径 ota/version.json —— 必须是固定 URL，
   * 因为 Release 的下载地址带 tag，客户端事先不知道 tag 是什么。
   */
  const SOURCES = [
    {
      id: 'github-raw',
      url: 'https://raw.githubusercontent.com/skynexly/retroflow/main/ota/version.json'
    },
    {
      id: 'jsdelivr',
      url: 'https://cdn.jsdelivr.net/gh/skynexly/retroflow@main/ota/version.json'
    }
  ];

  /** 结论枚举。UI 只认这些字符串，不要自己拼状态。 */
  const STATUS = {
    UP_TO_DATE: 'up-to-date',          // 已是最新
    UPDATE_AVAILABLE: 'update-available', // 有更新，可应用
    BINARY_TOO_OLD: 'binary-too-old',  // 壳太旧，必须先重装 APK 才能热更
    SCHEMA_TOO_NEW: 'schema-too-new',  // 清单格式比客户端新，需升级 APK
    UNAVAILABLE: 'unavailable'         // 所有源都不可达 / 清单非法
  };

  /** 本地版本兜底：app-version.js 未加载时不让整个模块崩掉 */
  function localVersion() {
    const v = window.RetroflowVersion;
    if (v && Number.isFinite(v.build)) {
      return { version: v.version, build: v.build, versionCode: v.versionCode };
    }
    return { version: '0.0.0', build: 0, versionCode: 0 };
  }

  /** 带超时的 fetch；失败（网络错 / 超时 / 非 2xx）一律返回 null，不抛异常 */
  async function fetchManifestOnce(url) {
    const bust = `${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const resp = await fetch(bust, {
        cache: 'no-store',
        signal: ctrl.signal,
        headers: { Accept: 'application/json' }
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      return (data && typeof data === 'object') ? data : null;
    } catch (err) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 依次试所有源，返回第一个合法清单及其来源 id；全败返回 null */
  async function fetchManifest() {
    for (const src of SOURCES) {
      const data = await fetchManifestOnce(src.url);
      if (data) return { data, source: src.id };
    }
    return null;
  }

  /**
   * 校验清单结构是否可用。
   * 宽松但有底线：缺关键字段直接判非法，避免按残缺数据做错误决策。
   */
  function validateManifest(data) {
    if (!data || typeof data !== 'object') return 'malformed';
    if (!Number.isFinite(data.schemaVersion)) return 'malformed';
    if (!data.latest || typeof data.latest !== 'object') return 'malformed';
    if (!Number.isFinite(data.latest.build)) return 'malformed';
    return 'ok';
  }

  /**
   * 检查更新。永不抛异常，永远返回结构化结论，UI 直接照着渲染。
   *
   * @returns {Promise<{
   *   status: string,          // STATUS 之一
   *   local: object,           // 本地版本快照
   *   remote: object|null,     // 远端 latest 原样（up-to-date 时也有，便于展示）
   *   source: string|null,     // 命中的源 id
   *   message: string          // 一句可直接显示的人话
   * }>}
   */
  async function checkForUpdate() {
    const local = localVersion();
    const got = await fetchManifest();

    if (!got) {
      return {
        status: STATUS.UNAVAILABLE,
        local,
        remote: null,
        source: null,
        message: '更新服务暂时不可用，请稍后再试'
      };
    }

    if (validateManifest(got.data) !== 'ok') {
      return {
        status: STATUS.UNAVAILABLE,
        local,
        remote: null,
        source: got.source,
        message: '更新服务返回的数据无法识别，请稍后再试'
      };
    }

    const latest = got.data.latest;

    // 清单格式比客户端新：不能猜着解析，提示升级 APK。
    // 只认顶层 schemaVersion（validateManifest 已保证其为有限数）。
    if (got.data.schemaVersion > SUPPORTED_SCHEMA) {
      return {
        status: STATUS.SCHEMA_TOO_NEW,
        local,
        remote: latest,
        source: got.source,
        message: '更新说明格式较新，需先升级安装包'
      };
    }

    // 远端不比本地新：已是最新。注意用 build 比，不用 version 字符串比
    //（version 可能相同但 build 不同，build 才是资源真实世代）
    if (latest.build <= local.build) {
      return {
        status: STATUS.UP_TO_DATE,
        local,
        remote: latest,
        source: got.source,
        message: '已是最新版本'
      };
    }

    // 有更新，但壳太旧：热更会调用旧壳没有的原生能力，必须挡
    const minBinary = Number.isFinite(latest.minBinary) ? latest.minBinary : 0;
    if (minBinary > local.versionCode) {
      return {
        status: STATUS.BINARY_TOO_OLD,
        local,
        remote: latest,
        source: got.source,
        message: `本次更新需要安装包版本 ${minBinary} 以上，请重新下载安装包`
      };
    }

    return {
      status: STATUS.UPDATE_AVAILABLE,
      local,
      remote: latest,
      source: got.source,
      message: `发现新版本 v${latest.version}`
    };
  }

  /**
   * 应用引擎是否就绪。UI 用它决定「立即更新」按钮可点还是禁用。
   * 阶段 1 恒为 false —— 绝不假装能更新。
   */
  function isEngineReady() {
    return Boolean(window.RetroflowOTA && typeof window.RetroflowOTA.applyUpdate === 'function');
  }

  window.RetroflowUpdate = {
    STATUS,
    SUPPORTED_SCHEMA,
    SOURCES,
    checkForUpdate,
    isEngineReady,
    localVersion
  };
})();