/**
 * 溯流计划 · 现实环境感知 (Env Awareness)
 *
 * 职责：把执行员所处的现实环境读数（电量，后续可扩展天气等）转成
 *      可注入模型上下文的轻量快照。
 *
 * 两条核心约定：
 *
 *   1. 快照在「用户按下发送」的那一刻抓取，随消息一起落库。
 *      上下文回放时读的是当时的快照，不是当前实时值——
 *      历史里那句话是在 12% 电量下说的，回看时就该是 12%。
 *
 *   2. 取不到就返回 null，全程静默降级。
 *      Battery Status API 在 iOS Safari 与 Firefox 上不存在，
 *      这属于预期情况，不弹提示、不写占位、不留假数据。
 *
 * 扩展方式：新增一个维度时，写好 getXxxInfo() 与 formatXxx()，
 *          再在 captureSnapshot / buildStampText 的 DIMENSIONS 里登记即可，
 *          调用方无需改动。
 */
window.EnvAwareness = (function () {
  'use strict';

  /* ================= 电量 ================= */

  /**
   * 读当前电量。每次实时读取，不做缓存：
   * 快照本身就是「某一刻」的定格，缓存只会让定格失真。
   * @returns {Promise<{pct:number, charging:boolean}|null>} 不支持或失败返回 null
   */
  async function getBatteryInfo() {
    try {
      if (!navigator.getBattery) return null;
      const battery = await navigator.getBattery();
      if (!battery) return null;
      const level = Number(battery.level);
      if (!Number.isFinite(level)) return null;
      return {
        pct: Math.max(0, Math.min(100, Math.round(level * 100))),
        charging: Boolean(battery.charging)
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * 电量读数转注入文案。充电状态前置，读起来像状态栏。
   * @param {{pct:number, charging:boolean}} info
   * @returns {string} 形如「充电中 电量76%」
   */
  function formatBattery(info) {
    if (!info || !Number.isFinite(info.pct)) return '';
    return `${info.charging ? '充电中 ' : ''}电量${info.pct}%`;
  }

  /* ================= 天气 ================= */

  // WMO 国际天气代码映射表
  const WMO_WEATHER_CODES = {
    0: '晴天', 1: '大部晴朗', 2: '局部多云', 3: '阴天',
    45: '有雾', 48: '沉积雾',
    51: '微量小雨', 53: '小雨', 55: '中雨',
    61: '小阵雨', 63: '中阵雨', 65: '大暴雨',
    71: '小雪', 73: '中雪', 75: '大雪',
    80: '阵雨', 81: '强阵雨', 82: '暴雨',
    95: '雷阵雨', 96: '雷雨伴有微弱冰雹', 99: '雷雨伴有严重冰雹'
  };

  // 天气缓存：{ city: { data, timestamp } }
  const weatherCache = {};

  /**
   * 获取城市天气（通过 Open-Meteo 免费 API）
   * 缓存 30 分钟，避免频繁请求
   * @returns {Promise<{location:string, temperature:number, condition:string}|null>}
   */
  async function getWeatherInfo() {
    try {
      const settings = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
        ? SystemChatSettings.getSettings()
        : {};
      const city = String(settings.weatherCity || '').trim();
      
      // 未填城市就不启用天气
      if (!city) return null;

      const cacheKey = city;
      const cached = weatherCache[cacheKey];
      const now = Date.now();
      
      // 缓存 30 分钟内复用
      if (cached && (now - cached.timestamp < 30 * 60 * 1000)) {
        return cached.data;
      }

      // 步骤 1: 通过城市名获取经纬度（Open-Meteo Geocoding API）
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) return null;
      const geoData = await geoRes.json();
      
      if (!geoData.results || geoData.results.length === 0) {
        console.warn('[EnvAwareness] 未找到城市：', city);
        return null;
      }

      const geo = geoData.results[0];
      const lat = geo.latitude;
      const lon = geo.longitude;
      const location = geo.name;

      // 步骤 2: 通过经纬度获取当前天气（Open-Meteo Weather API）
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`;
      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) return null;
      const weatherData = await weatherRes.json();
      
      const current = weatherData.current_weather;
      if (!current) return null;

      const data = {
        location,
        temperature: Math.round(current.temperature),
        condition: WMO_WEATHER_CODES[current.weathercode] || '未知',
        raw: current
      };

      weatherCache[cacheKey] = { data, timestamp: now };
      return data;
    } catch (err) {
      console.warn('[EnvAwareness] 天气数据获取失败：', err);
      return null;
    }
  }

  /**
   * 天气读数转注入文案
   * @param {{location:string, temperature:number, condition:string}} info
   * @returns {string} 形如「晴天 15°C」
   */
  function formatWeather(info) {
    if (!info) return '';
    return `${info.condition} ${info.temperature}°C`;
  }

  /* ================= 维度登记表 ================= */

  /**
   * 每个维度声明三件事：开关字段名、取数函数、格式化函数。
   * 加天气时在这里补一行即可，其余逻辑自动覆盖。
   */
  const DIMENSIONS = [
    { key: 'battery', read: getBatteryInfo, format: formatBattery },
    { key: 'weather', read: getWeatherInfo, format: formatWeather }
  ];

  /* ================= 快照 ================= */

  /**
   * 抓一份环境快照，用于随用户消息落库。
   * @param {Object} opts 各维度开关，如 { battery: true }
   * @returns {Promise<Object|null>} 形如 { ts, battery:{pct,charging} }；无任何可用维度时返回 null
   */
  async function captureSnapshot(opts) {
    const options = opts || {};
    const active = DIMENSIONS.filter((d) => options[d.key]);
    if (!active.length) return null;

    const snapshot = { ts: Date.now() };
    await Promise.all(active.map(async (d) => {
      const value = await d.read();
      if (value) snapshot[d.key] = value;
    }));

    // 只有时间戳说明所有维度都没取到，视作无快照
    const hasData = DIMENSIONS.some((d) => snapshot[d.key]);
    return hasData ? snapshot : null;
  }

  /**
   * 把快照拼成注入用的标注文本。
   * @param {Object} snapshot captureSnapshot 的产物
   * @param {Object} opts 各维度开关，需与注入时的设置一致
   * @returns {string} 形如「[充电中 电量76%]」；无可用数据返回空串
   */
  function buildStampText(snapshot, opts) {
    if (!snapshot) return '';
    const options = opts || {};
    const parts = DIMENSIONS
      .filter((d) => options[d.key] && snapshot[d.key])
      .map((d) => d.format(snapshot[d.key]))
      .filter(Boolean);
    if (!parts.length) return '';
    return `[${parts.join(' · ')}]`;
  }

  return {
    getBatteryInfo,
    captureSnapshot,
    buildStampText
  };
})();
