/**
 * 溯流计划 · API 调用日志 (Api Call Log)
 * 职责：
 *   1. 环形缓冲记录每一次 API 调用：调用方 / 端点 / 模型 / 请求摘要 / 响应原文 / 报错 / 耗时
 *   2. 上限 50 条，超出挤掉最旧——排查问题看的就是最近的现场，不做无限增长
 *   3. 存 IndexedDB（Storage doc 通道），大响应体绝不进 localStorage
 *   4. 内置「可能原因」诊断器：按 HTTP 状态 / 调用类型 / 报错体关键词给出排查建议
 * 约定：
 *   - 响应原文全量存（截断/掉格式一眼可查）；仅两类数据替换为占位：
 *     b64 图像（几 MB 无阅读价值）与 TTS 十六进制音频，占位保留体积与前缀特征
 *   - 报错 body 永远全量存
 *   - api-core 各出口埋点调用 record()，本模块不依赖任何 UI
 */
window.ApiCallLog = (() => {
  const MAX_ENTRIES = 50;
  const LOG_DOC_KEY = 'api_call_log_v1';
  const PAUSE_DOC_KEY = 'api_call_log_paused_v1';
  // 请求摘要截断上限（响应原文不截）
  const REQ_SUMMARY_LIMIT = 2000;

  let entries = null;        // 内存镜像，惰性装载
  let paused = false;
  let loadPromise = null;
  let saveTimer = null;

  /* ---------------- 持久化 ---------------- */

  function ensureLoaded() {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        if (window.Storage && typeof Storage.getDoc === 'function') {
          const saved = await Storage.getDoc(LOG_DOC_KEY, []);
          entries = Array.isArray(saved) ? saved : [];
          paused = Boolean(await Storage.getDoc(PAUSE_DOC_KEY, false));
        } else {
          entries = [];
        }
      } catch (_) {
        entries = [];
      }
      return entries;
    })();
    return loadPromise;
  }

  // 防抖落盘：连续调用（如流式收尾+归档）只写一次 IndexedDB
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        if (window.Storage && typeof Storage.setDoc === 'function') {
          Storage.setDoc(LOG_DOC_KEY, entries || []);
        }
      } catch (_) {}
    }, 300);
  }

  /* ---------------- 数据规整 ---------------- */

  let idSeed = 0;
  function makeId() {
    idSeed += 1;
    return `log_${Date.now().toString(36)}_${idSeed}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /** URL 脱敏：query 里的 key/token 类参数打码（Authorization 走 header，本来就不落日志） */
  function maskUrl(u) {
    const raw = String(u || '');
    try {
      const url = new URL(raw, window.location ? window.location.href : undefined);
      ['key', 'api_key', 'apikey', 'token', 'access_token', 'secret'].forEach((k) => {
        if (url.searchParams.has(k)) url.searchParams.set(k, '***');
      });
      return url.toString();
    } catch (_) {
      return raw.replace(/([?&](?:key|api_?key|token|access_token)=)[^&]*/gi, '$1***');
    }
  }

  /** b64 图像 / 十六进制音频 → 占位（保留体积与前缀特征，够判断数据是否完整） */
  function stripHeavyPayloads(text) {
    let out = String(text || '');
    out = out.replace(/"b64_json"\s*:\s*"([^"]{40,})"/g, (m, g) =>
      `"b64_json":"[base64 图像数据 · ${Math.round(g.length / 1024)}KB · 前缀 ${g.slice(0, 24)}...]"`);
    out = out.replace(/"audio"\s*:\s*"([0-9a-fA-F]{400,})"/g, (m, g) =>
      `"audio":"[十六进制音频数据 · ${Math.round(g.length / 2 / 1024)}KB · 前缀 ${g.slice(0, 24)}...]"`);
    // 兜底：任何超长 base64 裸串（部分中转直接回 { "data": "iVBOR..." }）
    out = out.replace(/"([A-Za-z0-9+/]{20000,}={0,2})"/g, (m, g) =>
      `"[疑似 base64 大块数据 · ${Math.round(g.length / 1024)}KB · 前缀 ${g.slice(0, 24)}...]"`);
    return out;
  }

  /** 请求体 → 摘要（截断展示用）：保留结构关键字段，长文本掐头 */
  function summarizeRequest(bodyStr, extraMeta) {
    const parts = [];
    try {
      const body = typeof bodyStr === 'string' ? JSON.parse(bodyStr) : bodyStr;
      if (body && typeof body === 'object') {
        if (body.model) parts.push(`model: ${body.model}`);
        if (Array.isArray(body.messages)) {
          parts.push(`messages: ${body.messages.length} 条`);
          const last = body.messages[body.messages.length - 1];
          if (last) {
            let txt = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
            if (txt.length > 400) txt = txt.slice(0, 400) + `...[截断，全文 ${txt.length} 字符]`;
            parts.push(`末条(${last.role}): ${txt}`);
          }
        }
        if (body.prompt) {
          let p = String(body.prompt);
          if (p.length > 600) p = p.slice(0, 600) + `...[截断，全文 ${p.length} 字符]`;
          parts.push(`prompt: ${p}`);
        }
        if (body.text) {
          let t = String(body.text);
          if (t.length > 300) t = t.slice(0, 300) + '...[截断]';
          parts.push(`text: ${t}`);
        }
        if (body.size) parts.push(`size: ${body.size}`);
        if (body.stream !== undefined) parts.push(`stream: ${body.stream}`);
        if (body.negative_prompt) parts.push(`negative_prompt: ${String(body.negative_prompt).slice(0, 120)}`);
      }
    } catch (_) {
      const s = String(bodyStr || '');
      parts.push(s.length > REQ_SUMMARY_LIMIT ? s.slice(0, REQ_SUMMARY_LIMIT) + '...[截断]' : s);
    }
    if (extraMeta) parts.push(extraMeta);
    let joined = parts.join('\n');
    if (joined.length > REQ_SUMMARY_LIMIT) joined = joined.slice(0, REQ_SUMMARY_LIMIT) + '\n...[摘要截断]';
    return joined;
  }

  /* ---------------- 可能原因诊断器 ---------------- */

  const KIND_LABELS = {
    chat: '文本对话',
    stream: '流式对话',
    image: '文生图',
    edits: '图生图',
    tts: '语音合成',
    models: '模型列表'
  };

  /**
   * 按状态码 / 类型 / 报错体关键词给出可能原因列表。
   * 与 api-core 的 describeXxxError 互补：那边给一句话定性，这边给排查方向。
   * @returns {string[]}
   */
  function diagnose(info) {
    const causes = [];
    const status = Number(info.status) || 0;
    const body = String(info.bodyText || '');
    const msg = String(info.errorMessage || '');
    const kind = info.kind || '';
    const lower = (body + ' ' + msg).toLowerCase();

    if (status === 401) {
      causes.push('API Key 无效、已过期或复制时带了多余空格');
      causes.push('填错了站点的 Key（中转站 Key 与本站 Key 不通用）');
    } else if (status === 402) {
      causes.push('账户余额不足或额度用尽，去服务商后台充值/查额度');
    } else if (status === 403) {
      causes.push('该 Key 无此模型权限（部分模型需单独开通/分组）');
      causes.push('触发服务商风控（IP 地区限制、频率异常）');
    } else if (status === 404) {
      causes.push('端点路径不对：Base URL 可能要在末尾补 /v1，或用 # 结尾强制原样');
      causes.push('模型 ID 拼错或该站未上架此模型（部分站对未知模型回 404 而非 400）');
      if (kind === 'image' || kind === 'edits') causes.push('该端点不支持生图接口（/images/generations、/images/edits）');
      if (kind === 'tts') causes.push('TTS 端点路径不对：MiniMax 应填到 /v1 为止，GroupId 单独配置');
    } else if (status === 405) {
      causes.push('该端点不接受此请求方式，多半是 URL 拼错打到了别的路径');
      if (kind === 'edits') causes.push('该模型/站点不支持垫图（/images/edits），可清除面部识别改走纯文生图');
    } else if (status === 400) {
      if (/safety|policy|content_filter|nsfw|审核|risk/i.test(lower)) {
        causes.push('提示词或参考图被内容策略拦截，尝试改写敏感描述');
      }
      if (/size|dimension|resolution/i.test(lower)) {
        causes.push('该模型不支持所请求的画幅尺寸，换个比例或留空用服务端默认');
      }
      if (/model/i.test(lower)) {
        causes.push('模型 ID 无效或对该 Key 不可用');
      }
      if (/image|file|format|invalid_request/i.test(lower) && kind === 'edits') {
        causes.push('参考图格式/体积不被接受（部分站点只吃 png/jpg 且限制 MB 数）');
      }
      if (!causes.length) causes.push('请求参数不合法，展开响应原文看服务端具体抱怨哪个字段');
    } else if (status === 429) {
      causes.push('请求过频触发限流，稍等再试');
      causes.push('额度/配额耗尽（insufficient_quota），去后台查余额');
    } else if (status >= 500) {
      causes.push('服务端或中转站自身异常，通常稍后重试即可');
      causes.push('若持续 5xx，可能是中转站对该模型的上游挂了，换节点/模型试试');
    }

    if (/failed to fetch|networkerror|load failed/i.test(lower)) {
      causes.push('网络不可达：地址拼错、断网、或需要代理');
      causes.push('被 CORS 拦截：该服务商不允许浏览器直连（常见于官方站），需走支持 CORS 的中转');
    }
    if (/超时|timeout|aborted/i.test(lower) && !status) {
      causes.push('链路超时无响应：模型排队/出字太慢，或中转站卡死');
      causes.push('生图与思考模型天然慢，可换更快的模型或错峰重试');
    }
    if (/insufficient_quota|billing/i.test(lower)) {
      causes.push('账单问题：余额不足或未绑支付方式');
    }
    if (/stream|流/i.test(msg) && kind === 'stream') {
      causes.push('流式传输中途断流：中转站对长回复有缓冲上限，可关掉流式改整段返回');
    }
    if (!causes.length && !info.ok) {
      causes.push('未命中已知模式，展开响应原文按服务端返回的报错信息排查');
    }
    return causes;
  }

  /* ---------------- 记录入口（api-core 埋点调用） ---------------- */

  /**
   * 记录一次 API 调用。同步进内存，异步防抖落盘，绝不阻塞调用链。
   * @param {Object} e
   *   caller      调用方名称（logTag），缺省 '未标注调用'
   *   kind        chat / stream / image / edits / tts / models
   *   url         完整端点（内部自动脱敏）
   *   model       模型 ID
   *   reqSummary  请求摘要（已截断的字符串）
   *   reqMeta     附加参数说明（参考图张数、faceLock、size 等）
   *   ok          是否成功
   *   status      HTTP 状态码（网络层失败为 0）
   *   respBody    响应原文（成功全量存；b64/音频自动替换占位；报错体全量存）
   *   errorMessage 可读报错（describeXxxError 产物或异常 message）
   *   latency     耗时 ms
   *   streaming   是否流式
   */
  function record(e) {
    if (paused) return;
    ensureLoaded().then(() => {
      try {
        const ok = Boolean(e && e.ok);
        const respRaw = String((e && e.respBody) || '');
        // 报错体全量存；成功体剥掉 b64/音频大块（它们不是"原文可读性"的排查对象）
        const respBody = ok ? stripHeavyPayloads(respRaw) : respRaw;
        const entry = {
          id: makeId(),
          ts: Date.now(),
          caller: (e && e.caller) || '未标注调用',
          kind: (e && e.kind) || 'chat',
          kindLabel: KIND_LABELS[(e && e.kind) || 'chat'] || (e && e.kind) || '调用',
          url: maskUrl(e && e.url),
          model: (e && e.model) || '',
          reqSummary: (e && e.reqSummary) || '',
          reqMeta: (e && e.reqMeta) || '',
          ok,
          status: Number((e && e.status) || 0),
          respBody,
          errorMessage: (e && e.errorMessage) || '',
          latency: Number((e && e.latency) || 0),
          streaming: Boolean(e && e.streaming)
        };
        entry.causes = ok ? [] : diagnose(entry);
        entries.unshift(entry);
        if (entries.length > MAX_ENTRIES) entries.length = MAX_ENTRIES;
        scheduleSave();
      } catch (err) {
        console.warn('[ApiCallLog] 记录失败：', err);
      }
    });
  }

  /* ---------------- 查询与管理（UI 用） ---------------- */

  async function list() {
    await ensureLoaded();
    return (entries || []).slice();
  }

  async function clear() {
    await ensureLoaded();
    entries = [];
    scheduleSave();
  }

  async function isPaused() {
    await ensureLoaded();
    return paused;
  }

  async function setPaused(v) {
    await ensureLoaded();
    paused = Boolean(v);
    try {
      if (window.Storage && typeof Storage.setDoc === 'function') {
        await Storage.setDoc(PAUSE_DOC_KEY, paused);
      }
    } catch (_) {}
    return paused;
  }

  /** 导出整包 JSON（发给开发排查用） */
  async function exportJson() {
    await ensureLoaded();
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      maxEntries: MAX_ENTRIES,
      count: (entries || []).length,
      entries: entries || []
    }, null, 2);
  }

  return {
    record,
    list,
    clear,
    isPaused,
    setPaused,
    exportJson,
    summarizeRequest,
    diagnose,
    KIND_LABELS,
    MAX_ENTRIES
  };
})();