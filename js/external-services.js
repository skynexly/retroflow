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
 *     },
 *     fetch: {
 *       enabled: false,
 *       providers: [
 *         { id: 'jina', apiKey: '', enabled: true, quotaExhaustedUntil: 0 }
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
      desc: '面向 AI 的联网搜索，免费档每月 1000 次。',
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
    },
    bocha: {
      name: '博查',
      en: 'BOCHA SEARCH',
      desc: '偏中文内容的 AI 搜索，按次计费。',
      keyHint: 'sk- 开头的 API Key，在 open.bochaai.com 控制台获取',
      async search(apiKey, query, maxResults) {
        const resp = await fetch('https://api.bochaai.com/v1/web-search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            query: String(query),
            count: maxResults,
            summary: true
          })
        });
        const text = await resp.text();
        if (!resp.ok) {
          return { status: resp.status, error: text, results: [] };
        }
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* 非 JSON 按错误处理 */ }
        // 博查 HTTP 200 也可能带业务错误码（code !== 200），按错误处理交给调度层
        if (!data || data.code !== 200 || !data.data || !data.data.webPages
          || !Array.isArray(data.data.webPages.value)) {
          const bizMsg = data && data.msg ? String(data.msg) : '';
          return { status: resp.status, error: bizMsg || text || '响应格式异常', results: [] };
        }
        const results = data.data.webPages.value.map((r) => ({
          title: String(r.name || '').trim(),
          url: String(r.url || '').trim(),
          // summary 是长文总结，比 snippet 信息量大；截断防止单条撑爆上下文
          snippet: String(r.summary || r.snippet || '').trim().slice(0, 500)
        })).filter((r) => r.url);
        return { status: resp.status, results, raw: text };
      }
    }
    // 后续服务商在此注册：brave、zhipu……调度与 UI 不需要改。
  };
  // 注册顺序即默认优先级
  const PROVIDER_IDS = Object.keys(PROVIDERS);

  /* ---------------- 网页抓取服务商注册表 ---------------- */
  // 每家一个适配器：read(apiKey, url, timeoutMs) → { status, title, url, content, raw } 或 { status, error }
  // Key 选填的服务商标 keyOptional，UI 与可用性判定据此放行无 Key 状态。
  const FETCHERS = {
    jina: {
      name: 'Jina Reader',
      en: 'JINA READER',
      desc: '将网页转为正文。Key 选填：匿名每分钟 20 次，免费 Key 每分钟 500 次。',
      keyHint: '选填，jina_ 开头的 API Key，在 jina.ai 获取',
      keyOptional: true,
      async read(apiKey, url, timeoutMs) {
        const headers = {
          'Accept': 'application/json',
          'X-Retain-Images': 'none'
        };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
        let resp;
        try {
          resp = await fetch('https://r.jina.ai/' + url, {
            method: 'GET',
            headers,
            signal: ctrl ? ctrl.signal : undefined
          });
        } catch (err) {
          if (err && err.name === 'AbortError') {
            throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
          }
          throw err;
        } finally {
          if (timer) clearTimeout(timer);
        }
        const text = await resp.text();
        let data = null;
        try { data = JSON.parse(text); } catch (_) { /* 非 JSON 按错误处理 */ }
        if (!resp.ok) {
          const msg = data && (data.readableMessage || data.message);
          return { status: resp.status, error: msg ? String(msg) : (text || `HTTP ${resp.status}`) };
        }
        // JSON 模式返回 { code, status, data: { title, url, content } }；兼容直接平铺的结构
        const body = data && data.data && typeof data.data === 'object' ? data.data : data;
        if (!body || typeof body.content !== 'string') {
          return { status: resp.status, error: text || '响应格式异常' };
        }
        return {
          status: resp.status,
          title: String(body.title || '').trim(),
          url: String(body.url || url).trim(),
          content: body.content,
          raw: text.slice(0, 2000)
        };
      }
    }
    // 后续抓取服务商在此注册，调度与 UI 不需要改。
  };
  const FETCHER_IDS = Object.keys(FETCHERS);
  /** 交给模型的正文上限（字符）；超出截断并注明 */
  const FETCH_MAX_CHARS = 6000;
  /** 单次抓取超时：Jina 官方标注平均延迟约 8 秒，留足余量 */
  const FETCH_TIMEOUT_MS = 30000;

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

  /** 归一化抓取配置：结构与搜索一致，补齐缺失服务商，剔除未注册的 id */
  function getFetchConfig() {
    const cfg = readConfig();
    const fc = (cfg.fetch && typeof cfg.fetch === 'object') ? cfg.fetch : {};
    const stored = Array.isArray(fc.providers) ? fc.providers : [];
    const byId = {};
    stored.forEach((p) => {
      if (p && FETCHERS[p.id]) byId[p.id] = p;
    });
    const ordered = stored.filter((p) => p && FETCHERS[p.id]).map((p) => p.id);
    FETCHER_IDS.forEach((id) => { if (ordered.indexOf(id) === -1) ordered.push(id); });
    const providers = ordered.map((id) => {
      const p = byId[id] || {};
      return {
        id,
        apiKey: String(p.apiKey || ''),
        enabled: p.enabled !== false,
        quotaExhaustedUntil: Number(p.quotaExhaustedUntil) || 0
      };
    });
    return { enabled: fc.enabled === true, providers };
  }

  async function saveFetchConfig(fc) {
    const cfg = readConfig();
    cfg.fetch = fc;
    return Store.save('config.externalServices', cfg);
  }

  async function updateFetcher(id, fields) {
    const fc = getFetchConfig();
    const p = fc.providers.find((it) => it.id === id);
    if (!p) return false;
    Object.assign(p, fields);
    return saveFetchConfig(fc);
  }

  async function setFetchEnabled(enabled) {
    const fc = getFetchConfig();
    fc.enabled = !!enabled;
    return saveFetchConfig(fc);
  }

  /* ---------------- 可用性判定 ---------------- */

  /** 抓取服务商是否具备调用条件：启用，且已填 Key 或该家 Key 选填 */
  function fetcherUsable(p) {
    const meta = FETCHERS[p.id];
    return !!(meta && p.enabled && (p.apiKey || meta.keyOptional));
  }

  /** 全局是否有可用的网页抓取能力：总开关开 + 至少一家可用 */
  function isFetchAvailable() {
    const fc = getFetchConfig();
    if (!fc.enabled) return false;
    return fc.providers.some(fetcherUsable);
  }

  /** 抓取卡片的状态徽标：ok / nokey / disabled / cooldown / anon（Key 选填且未填） */
  function fetcherStatus(p) {
    const meta = FETCHERS[p.id];
    if (!p.apiKey && !(meta && meta.keyOptional)) return 'nokey';
    if (!p.enabled) return 'disabled';
    if (inQuotaCooldown(p)) return 'cooldown';
    return p.apiKey ? 'ok' : 'anon';
  }

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

  /** 额度类错误判定：429；401/403 且报错指向配额；200 业务错误但文本明确指向余额/配额
   *（博查余额不足可能走 HTTP 200 + 业务码，只认状态码会漏）。具体报错文案待真实 Key 实测校准。 */
  function isQuotaError(status, errorText) {
    if (status === 429) return true;
    const t = String(errorText || '').toLowerCase();
    const quotaHint = t.indexOf('quota') !== -1 || t.indexOf('exceed') !== -1
      || t.indexOf('usage limit') !== -1 || t.indexOf('insufficient') !== -1
      || t.indexOf('余额不足') !== -1 || t.indexOf('额度不足') !== -1 || t.indexOf('额度已用') !== -1;
    if (status === 401 || status === 403) return quotaHint;
    if (status === 200) return quotaHint;
    return false;
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

  /* ---------------- 网页抓取调度 ---------------- */

  /** 校验并规范化目标网址：只放行 http/https，补全缺失协议 */
  function normalizeFetchUrl(input) {
    let s = String(input || '').trim();
    if (!s) return { ok: false, error: '没有给出网址。' };
    if (s.length > 2048) return { ok: false, error: '网址过长。' };
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
    let u;
    try { u = new URL(s); } catch (_) { return { ok: false, error: `网址格式不对：${input}` }; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: '只支持 http 或 https 网址。' };
    }
    return { ok: true, url: u.href };
  }

  /** 抓取类错误归类：余额/额度耗尽冷却到次日；429 是每分钟频率限制，不冷却 */
  function classifyFetchError(status, errorText) {
    if (status === 429) return 'ratelimit';
    const t = String(errorText || '').toLowerCase();
    const balanceHint = t.indexOf('insufficient') !== -1 || t.indexOf('balance') !== -1
      || t.indexOf('quota') !== -1 || t.indexOf('余额') !== -1 || t.indexOf('额度') !== -1;
    if (status === 402) return 'quota';
    if ((status === 401 || status === 403) && balanceHint) return 'quota';
    if (status === 401 || status === 403) return 'auth';
    return 'other';
  }

  /** 把一次抓取失败转成给人看的一句话。cooled 表示这次已经写入冷却 */
  function describeFetchError(name, status, errorText, hasKey, cooled) {
    const kind = classifyFetchError(status, errorText);
    if (kind === 'ratelimit') return `${name}：调用太频繁，触发每分钟次数限制，稍后再试${hasKey ? '' : '（填 Key 可提高上限）'}`;
    if (kind === 'quota') return `${name}：余额或额度已用完${cooled ? '，已冷却至明日' : ''}`;
    if (kind === 'auth') {
      return hasKey
        ? `${name}：Key 无效或无权限`
        : `${name}：拒绝匿名访问（当前网络可能被屏蔽），请在外部服务页填写 Key`;
    }
    return `${name}：HTTP ${status}`;
  }

  /**
   * 读取网页正文统一入口。按顺序尝试可用的抓取服务商。
   * @param {string} url 目标网址
   * @param {object} [opts] { caller: 调用方标注 }
   * @returns {Promise<{ok: boolean, provider: string, url: string, title: string, content: string, truncated: boolean, totalChars: number, error: string}>}
   */
  async function fetchPage(url, opts) {
    const options = opts || {};
    const caller = options.caller || '网页抓取';
    const empty = { ok: false, provider: '', url: String(url || ''), title: '', content: '', truncated: false, totalChars: 0 };
    const norm = normalizeFetchUrl(url);
    if (!norm.ok) return Object.assign(empty, { error: norm.error });

    const fc = getFetchConfig();
    if (!fc.enabled) return Object.assign(empty, { error: '网页抓取未启用（设置 → 外部服务）。' });
    const candidates = fc.providers.filter((p) => fetcherUsable(p) && !inQuotaCooldown(p));
    if (!candidates.length) {
      return Object.assign(empty, { error: '没有可用的网页抓取服务商：被停用或额度冷却中。' });
    }

    const errors = [];
    for (const p of candidates) {
      const adapter = FETCHERS[p.id];
      const started = Date.now();
      let outcome;
      try {
        outcome = await adapter.read(p.apiKey, norm.url, FETCH_TIMEOUT_MS);
      } catch (err) {
        const msg = (err && err.message) || '网络请求失败';
        logCall({
          caller, kind: 'fetch', url: `provider:${p.id}`,
          reqSummary: norm.url, ok: false, status: 0,
          respBody: '', errorMessage: msg, latency: Date.now() - started
        });
        errors.push(`${adapter.name}：${msg}`);
        continue;
      }
      const ok = outcome.status >= 200 && outcome.status < 300 && !outcome.error;
      logCall({
        caller, kind: 'fetch', url: `provider:${p.id}`,
        reqSummary: norm.url, ok, status: outcome.status,
        respBody: ok ? (outcome.raw || '') : (outcome.error || ''),
        errorMessage: ok ? '' : `HTTP ${outcome.status}`,
        latency: Date.now() - started
      });
      if (ok) {
        const full = String(outcome.content || '').trim();
        const truncated = full.length > FETCH_MAX_CHARS;
        return {
          ok: true,
          provider: p.id,
          url: outcome.url || norm.url,
          title: outcome.title,
          content: truncated ? full.slice(0, FETCH_MAX_CHARS) : full,
          truncated,
          totalChars: full.length,
          error: ''
        };
      }
      const cooled = classifyFetchError(outcome.status, outcome.error) === 'quota';
      if (cooled) await updateFetcher(p.id, { quotaExhaustedUntil: nextMidnight() });
      errors.push(describeFetchError(adapter.name, outcome.status, outcome.error, !!p.apiKey, cooled));
    }
    return Object.assign(empty, { url: norm.url, error: errors.join('；') || '全部网页抓取服务商均失败。' });
  }

  /**
   * 测试单个抓取服务商。不检查总开关，方便配置时直接验证。
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  async function testFetcher(id) {
    const adapter = FETCHERS[id];
    if (!adapter) return { ok: false, message: '未知的服务商。' };
    const fc = getFetchConfig();
    const p = fc.providers.find((it) => it.id === id);
    if (!p) return { ok: false, message: '未知的服务商。' };
    if (!p.apiKey && !adapter.keyOptional) return { ok: false, message: '请先填写 API Key。' };
    const target = 'https://example.com/';
    const started = Date.now();
    let outcome;
    try {
      outcome = await adapter.read(p.apiKey, target, FETCH_TIMEOUT_MS);
    } catch (err) {
      const msg = (err && err.message) || '网络请求失败';
      logCall({
        caller: '外部服务 · 连接测试', kind: 'fetch', url: `provider:${id}`,
        reqSummary: target, ok: false, status: 0,
        respBody: '', errorMessage: msg, latency: Date.now() - started
      });
      return { ok: false, message: `网络请求失败：${msg}。` };
    }
    const ok = outcome.status >= 200 && outcome.status < 300 && !outcome.error;
    logCall({
      caller: '外部服务 · 连接测试', kind: 'fetch', url: `provider:${id}`,
      reqSummary: target, ok, status: outcome.status,
      respBody: ok ? (outcome.raw || '') : (outcome.error || ''),
      errorMessage: ok ? '' : `HTTP ${outcome.status}`,
      latency: Date.now() - started
    });
    if (ok) {
      if (p.quotaExhaustedUntil) await updateFetcher(id, { quotaExhaustedUntil: 0 });
      const len = String(outcome.content || '').trim().length;
      return { ok: true, message: `连接正常，读到 ${len} 字正文${p.apiKey ? '' : '（匿名模式）'}。` };
    }
    return { ok: false, message: describeFetchError(adapter.name, outcome.status, outcome.error, !!p.apiKey, false).replace(/^[^：]+：/, '') + '。' };
  }

  /** 把抓取结果拼成给模型看的文本（工具结果回传用） */
  function formatPageForModel(result, url) {
    if (!result.ok) return `读取网页失败：${result.error}`;
    if (!result.content) return `网页「${result.url || url}」没有读到正文内容。`;
    const head = `网页正文（来源：${FETCHERS[result.provider].name}）\n标题：${result.title || '（无标题）'}\n链接：${result.url}`;
    const tail = result.truncated
      ? `\n\n（正文共 ${result.totalChars} 字，已截取前 ${FETCH_MAX_CHARS} 字）`
      : '';
    return `${head}\n\n${result.content}${tail}`;
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
    formatResultsForModel,
    FETCHERS,
    FETCHER_IDS,
    FETCH_MAX_CHARS,
    getFetchConfig,
    setFetchEnabled,
    updateFetcher,
    isFetchAvailable,
    fetcherStatus,
    fetchPage,
    testFetcher,
    formatPageForModel
  };
})();

window.ExternalServices = ExternalServices;
