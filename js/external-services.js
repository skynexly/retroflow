/**
 * ============================================================================
 * 溯流计划 · 外部服务 (ExternalServices)
 *
 * 职责：外部能力接入的唯一入口。本期只做联网搜索（Tavily），
 * 框架按「多服务商 + 顺序降级」设计，后续加 Brave / 博查只需注册适配器。
 *
 * 存储：配置整体走 Store 的 config.externalServices（IndexedDB docs 表，
 * 键 config/external.services），随「系统配置」块导入导出。
 *
 * 结构：
 *   {
 *     search: {
 *       enabled: false,
 *       providers: [
 *         { id: 'tavily', apiKey: '', enabled: true, quotaExhaustedUntil: 0 }
 *       ]
 *     }
 *   }
 * providers 数组顺序即优先级；额度耗尽的服务商冷却到次日零点后自动恢复尝试。
 * ============================================================================
 */
const ExternalServices = (() => {
  'use strict';

  /* ---------------- 服务商注册表 ---------------- */
  // 每家一个适配器：search(apiKey, query, maxResults) → { results, raw, status }
  // 网络层错误抛异常；HTTP 非 2xx 返回 { status, error }，由调度层决定降级。
  const PROVIDERS = {
    tavily: {
      name: 'Tavily',
      en: 'TAVILY SEARCH',
      desc: '为 AI 优化的联网搜索，免费档每月 1000 次',
      keyHint: 'tvly- 开头的 API Key，在 tavily.com 控制台获取',
      async search(apiKey, query, maxResults) {
        const resp = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            query: String(query),
            max_results: maxResults,
            search_depth: 'basic',
            include_answer: false
          })
        });
        const text = await resp.text();
        if (!resp.ok) {
          return { status: resp.status, error: text, results: [] };
        }
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* 非 JSON 按错误处理 */ }
        if (!data || !Array.isArray(data.results)) {
          return { status: resp.status, error: text || '响应格式异常', results: [] };
        }
        const results = data.results.map((r) => ({
          title: String(r.title || '').trim(),
          url: String(r.url || '').trim(),
          snippet: String(r.content || '').trim()
        })).filter((r) => r.url);
        return { status: resp.status, results, raw: text };
      }
    }
    // 后续服务商在此注册：brave、bocha……调度与 UI 不需要改。
  };
  // 注册顺序即默认优先级
  const PROVIDER_IDS = Object.keys(PROVIDERS);

  /* ---------------- 配置读写 ---------------- */

  function readConfig() {
    const raw = (window.Store && Store.isLoaded())
      ? Store.get('config.externalServices')
      : null;
    return raw && typeof raw === 'object' ? raw : {};
  }

  /** 归一化搜索配置：补齐缺失服务商，剔除未注册的 id，保持已有顺序 */
  function getSearchConfig() {
    const cfg = readConfig();
    const search = (cfg.search && typeof cfg.search === 'object') ? cfg.search : {};
    const stored = Array.isArray(search.providers) ? search.providers : [];
    const byId = {};
    stored.forEach((p) => {
      if (p && PROVIDERS[p.id]) byId[p.id] = p;
    });
    // 已存的按存储顺序在前，新注册的服务商追加在后
    const ordered = stored.filter((p) => p && PROVIDERS[p.id]).map((p) => p.id);
    PROVIDER_IDS.forEach((id) => { if (ordered.indexOf(id) === -1) ordered.push(id); });
    const providers = ordered.map((id) => {
      const p = byId[id] || {};
      return {
        id,
        apiKey: String(p.apiKey || ''),
        enabled: p.enabled !== false,
        quotaExhaustedUntil: Number(p.quotaExhaustedUntil) || 0
      };
    });
    return { enabled: search.enabled === true, providers };
  }

  async function saveSearchConfig(search) {
    const cfg = readConfig();
    cfg.search = search;
    return Store.save('config.externalServices', cfg);
  }

  /** 更新单个服务商的字段并落盘。fields 里只放要改的键。 */
  async function updateProvider(id, fields) {
    const search = getSearchConfig();
    const p = search.providers.find((it) => it.id === id);
    if (!p) return false;
    Object.assign(p, fields);
    return saveSearchConfig(search);
  }

  async function setSearchEnabled(enabled) {
    const search = getSearchConfig();
    search.enabled = !!enabled;
    return saveSearchConfig(search);
  }

  /** 调整优先级：把服务商上移/下移一格。dir 为 -1 或 1。 */
  async function moveProvider(id, dir) {
    const search = getSearchConfig();
    const at = search.providers.findIndex((p) => p.id === id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= search.providers.length) return false;
    const list = search.providers.slice();
    const [item] = list.splice(at, 1);
    list.splice(to, 0, item);
    search.providers = list;
    return saveSearchConfig(search);
  }

  /* ---------------- 可用性判定 ---------------- */

  /** 额度冷却是否仍生效（冷却到次日零点，之后自动恢复尝试） */
  function inQuotaCooldown(p) {
    return Number(p.quotaExhaustedUntil) > Date.now();
  }

  /** 全局是否有可用的搜索能力：总开关开 + 至少一家启用且已填 Key */
  function isSearchAvailable() {
    const s = getSearchConfig();
    if (!s.enabled) return false;
    return s.providers.some((p) => p.enabled && p.apiKey);
  }

  /** 给 UI 的状态徽标：ok / nokey / disabled / cooldown */
  function providerStatus(p) {
    if (!p.apiKey) return 'nokey';
    if (!p.enabled) return 'disabled';
    if (inQuotaCooldown(p)) return 'cooldown';
    return 'ok';
  }

  /* ---------------- 搜索调度 ---------------- */

  /** 额度类错误判定：429，或 401/403 且报错文本明确指向配额 */
  function isQuotaError(status, errorText) {
    if (status === 429) return true;
    const t = String(errorText || '').toLowerCase();
    return (status === 401 || status === 403)
      && (t.indexOf('quota') !== -1 || t.indexOf('exceed') !== -1 || t.indexOf('usage limit') !== -1);
  }

  function nextMidnight() {
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  function logCall(entry) {
    if (window.ApiCallLog && typeof ApiCallLog.record === 'function') {
      try { ApiCallLog.record(entry); } catch (_) { /* 日志失败不影响搜索 */ }
    }
  }

  /**
   * 联网搜索统一入口。按优先级依次尝试，额度耗尽自动冷却并落到下一家。
   * @param {string} query 搜索词
   * @param {object} [opts] { maxResults: 1-10，默认 5；caller: 调用方标注 }
   * @returns {Promise<{ok: boolean, provider: string, results: Array, error: string}>}
   */
  async function search(query, opts) {
    const options = opts || {};
    const q = String(query || '').trim();
    if (!q) return { ok: false, provider: '', results: [], error: '搜索词为空。' };
    const maxResults = Math.min(10, Math.max(1, Number(options.maxResults) || 5));
    const caller = options.caller || '联网搜索';

    const s = getSearchConfig();
    if (!s.enabled) return { ok: false, provider: '', results: [], error: '联网搜索未启用（设置 → 外部服务）。' };
    const candidates = s.providers.filter((p) => p.enabled && p.apiKey && !inQuotaCooldown(p));
    if (!candidates.length) {
      return { ok: false, provider: '', results: [], error: '没有可用的搜索服务商：未配置 Key、被停用或额度冷却中。' };
    }

    const errors = [];
    for (const p of candidates) {
      const adapter = PROVIDERS[p.id];
      const started = Date.now();
      let outcome;
      try {
        outcome = await adapter.search(p.apiKey, q, maxResults);
      } catch (err) {
        // 网络层失败（断网 / 跨域被拦）：记日志，换下一家
        const msg = (err && err.message) || '网络请求失败';
        logCall({
          caller, kind: 'search', url: `provider:${p.id}`,
          reqSummary: q, ok: false, status: 0,
          respBody: '', errorMessage: msg, latency: Date.now() - started
        });
        errors.push(`${adapter.name}：${msg}`);
        continue;
      }
      const ok = outcome.status >= 200 && outcome.status < 300 && !outcome.error;
      logCall({
        caller, kind: 'search', url: `provider:${p.id}`,
        reqSummary: q, ok, status: outcome.status,
        respBody: outcome.raw || outcome.error || '',
        errorMessage: ok ? '' : `HTTP ${outcome.status}`,
        latency: Date.now() - started
      });
      if (ok) {
        return { ok: true, provider: p.id, results: outcome.results, error: '' };
      }
      if (isQuotaError(outcome.status, outcome.error)) {
        // 额度耗尽：冷却到次日零点，落到下一家
        await updateProvider(p.id, { quotaExhaustedUntil: nextMidnight() });
        errors.push(`${adapter.name}：额度耗尽，已冷却至明日并切换下一家`);
      } else {
        errors.push(`${adapter.name}：HTTP ${outcome.status}`);
      }
    }
    return { ok: false, provider: '', results: [], error: errors.join('；') || '全部搜索服务商均失败。' };
  }

  /**
   * 测试单个服务商的连通性。不检查总开关与启用态，方便配置时直接验证。
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async function testProvider(id) {
    const adapter = PROVIDERS[id];
    if (!adapter) return { ok: false, message: '未知的服务商。' };
    const s = getSearchConfig();
    const p = s.providers.find((it) => it.id === id);
    if (!p || !p.apiKey) return { ok: false, message: '请先填写 API Key。' };
    const started = Date.now();
    let outcome;
    try {
      outcome = await adapter.search(p.apiKey, '溯流计划 连接测试', 1);
    } catch (err) {
      const msg = (err && err.message) || '网络请求失败';
      logCall({
        caller: '外部服务 · 连接测试', kind: 'search', url: `provider:${id}`,
        reqSummary: '连接测试', ok: false, status: 0,
        respBody: '', errorMessage: msg, latency: Date.now() - started
      });
      return { ok: false, message: `网络请求失败：${msg}。纯浏览器环境可能受跨域限制，装机版不受影响。` };
    }
    const ok = outcome.status >= 200 && outcome.status < 300 && !outcome.error;
    logCall({
      caller: '外部服务 · 连接测试', kind: 'search', url: `provider:${id}`,
      reqSummary: '连接测试', ok, status: outcome.status,
      respBody: outcome.raw || outcome.error || '',
      errorMessage: ok ? '' : `HTTP ${outcome.status}`,
      latency: Date.now() - started
    });
    if (ok) {
      // 测试成功顺手解除额度冷却：可能已充值或到了新计费周期
      if (p.quotaExhaustedUntil) await updateProvider(id, { quotaExhaustedUntil: 0 });
      return { ok: true, message: `连接正常，返回 ${outcome.results.length} 条结果。` };
    }
    if (isQuotaError(outcome.status, outcome.error)) {
      return { ok: false, message: '额度已耗尽或触发限流，请明日再试或更换 Key。' };
    }
    if (outcome.status === 401 || outcome.status === 403) {
      return { ok: false, message: 'Key 无效或无权限，请检查后重试。' };
    }
    return { ok: false, message: `服务返回 HTTP ${outcome.status}。` };
  }

  /** 把搜索结果拼成给模型看的文本（工具结果回传用） */
  function formatResultsForModel(result, query) {
    if (!result.ok) return `联网搜索失败：${result.error}`;
    if (!result.results.length) return `联网搜索「${query}」没有找到相关结果。`;
    const lines = result.results.map((r, i) =>
      `${i + 1}. ${r.title}\n链接：${r.url}\n摘要：${r.snippet}`
    );
    return `联网搜索「${query}」的结果（来源：${PROVIDERS[result.provider].name}）：\n\n${lines.join('\n\n')}`;
  }

  return {
    PROVIDERS,
    PROVIDER_IDS,
    getSearchConfig,
    setSearchEnabled,
    updateProvider,
    moveProvider,
    isSearchAvailable,
    providerStatus,
    search,
    testProvider,
    formatResultsForModel
  };
})();

window.ExternalServices = ExternalServices;
