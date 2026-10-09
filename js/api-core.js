/**
 * 溯流计划 · API 算力链路核心 (OpenAI 兼容协议网络层)
 *
 * 纯网络层，不碰 DOM。端点约定沿用 skynex 的成熟规则：
 *   - baseUrl 以 '#' 结尾：去掉 '#'，前面部分当完整 URL 原样使用（OneAPI / NewAPI 通用约定）
 *   - 否则：去掉尾部斜杠后拼上目标 path
 *
 * 注意：浏览器直连第三方端点受 CORS 约束。服务端未放行 Access-Control-Allow-Origin 时，
 * fetch 会以 TypeError 失败，此处统一归类为「链路被拦截」并给出可读提示。
 */
window.RetroflowAPI = (() => {
  const DEFAULT_TIMEOUT = 20000;

  /* ================= 端点构造 ================= */

  function buildApiUrl(baseUrl, path) {
    let u = (baseUrl || '').trim();
    if (!u) return '';
    // '#' 结尾：强制原样（去掉末尾的 #）
    if (u.endsWith('#')) return u.slice(0, -1).replace(/\/$/, '');
    u = u.replace(/\/$/, '');
    // 已经带了目标路径，不重复拼
    if (path && u.endsWith(path)) return u;
    return u + (path || '');
  }

  function buildChatUrl(baseUrl) {
    return buildApiUrl(baseUrl, '/chat/completions');
  }

  function buildModelsUrl(baseUrl) {
    // '#' 强制原样时按约定直接打该地址；否则把 /chat/completions 换成 /models
    let u = (baseUrl || '').trim();
    if (!u) return '';
    if (u.endsWith('#')) return u.slice(0, -1).replace(/\/$/, '');
    u = u.replace(/\/$/, '').replace(/\/chat\/completions$/, '');
    return u + '/models';
  }

  /* ================= 错误归类 ================= */

  // 从服务端返回体里挖出人类可读的报错文案
  function extractErrMessage(bodyText) {
    if (!bodyText) return '';
    try {
      const json = JSON.parse(bodyText);
      const msg = json?.error?.message || json?.message || json?.error || json?.detail;
      if (typeof msg === 'string') return msg.slice(0, 120);
    } catch (err) {
      /* 非 JSON，按纯文本处理 */
    }
    return String(bodyText).replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function describeHttpError(status, bodyText) {
    const detail = extractErrMessage(bodyText);
    if (status === 401) return '401 · API Key 无效或已失效';
    if (status === 403) return '403 · Key 无该模型权限或被风控';
    if (status === 404) return '404 · 端点路径不对，检查是否要带 /v1';
    if (status === 405) return '405 · 该端点不支持此请求方式';
    if (status === 429) return '429 · 请求过频或额度不足';
    if (status >= 500) return `${status} · 服务端异常${detail ? ' · ' + detail : ''}`;
    return `${status} · ${detail || '请求被拒绝'}`;
  }

  function describeNetworkError(err) {
    if (err && err.name === 'AbortError') return '超时 · 链路无响应';
    const msg = err && err.message ? err.message : '未知错误';
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return '不可达 · 地址错误或被 CORS 拦截';
    }
    return '异常 · ' + msg.slice(0, 80);
  }

  // 把 fetch 异常转成带可读文案的 Error，同时保留 AbortError 标记：
  // 调用方要靠 name 区分「用户主动取消」和「真超时」，直接 new Error 会把它抹掉
  function wrapNetworkError(err) {
    const e = new Error(describeNetworkError(err));
    if (err && err.name === 'AbortError') e.name = 'AbortError';
    return e;
  }

  /* ================= 带超时的请求 ================= */

  async function request(url, options, timeout, externalSignal) {
    const ctrl = new AbortController();
    // 标记本次 abort 是「超时」还是「外部主动取消」，供调用方区分：
    // 超时必须报错让用户知道，主动取消要安静处理。
    let timedOut = false;
    // timeout 传 0 / null 表示不限时（对话生成场景：提示词量大时十几分钟出字都正常，
    // 不该由前端硬掐，交给用户手动停止；流式一直是这个策略，非流式与之对齐）。
    const timer = timeout === 0 || timeout === null
      ? null
      : setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeout || DEFAULT_TIMEOUT);
    // 桥接外部取消信号（如用户点停止），不再直接丢弃调用方传入的 signal
    const onExternalAbort = () => ctrl.abort();
    if (externalSignal) {
      if (externalSignal.aborted) ctrl.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      return await fetch(url, Object.assign({}, options, { signal: ctrl.signal }));
    } catch (err) {
      if (timedOut) {
        const e = new Error('超时 · 链路无响应');
        e.isTimeout = true;
        throw e;
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  /* ================= 模型列表 ================= */

  /**
   * 拉取 /models 列表
   * @returns {Promise<string[]>} 模型 id 数组（已去重排序）
   */
  async function fetchModelList(baseUrl, apiKey, timeout) {
    const url = buildModelsUrl(baseUrl);
    if (!url) throw new Error('BASE URL 为空');

    const resp = await request(url, {
      method: 'GET',
      headers: apiKey ? { Authorization: 'Bearer ' + apiKey } : {}
    }, timeout);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(describeHttpError(resp.status, body));
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const raw = Array.isArray(json) ? json : (json.data || json.models || []);
    const ids = raw
      .map((m) => (typeof m === 'string' ? m : (m.id || m.name || m.model || '')))
      .filter(Boolean);
    return Array.from(new Set(ids)).sort();
  }

  /* ================= 链路探测 ================= */

  /**
   * 测试连接：优先 GET /models 探测；端点屏蔽了 /models（404/405）时，
   * 若填了 modelId 则退化为 1 token 的 chat 探针。
   * @returns {Promise<{ok:boolean, latency:number, message:string, via:string, models:string[]}>}
   */
  async function testConnection(baseUrl, apiKey, modelId, timeout) {
    if (!baseUrl) {
      return { ok: false, latency: 0, message: '请先填写 BASE URL', via: 'none', models: [] };
    }

    const started = Date.now();
    try {
      const models = await fetchModelList(baseUrl, apiKey, timeout);
      const latency = Date.now() - started;
      return {
        ok: true,
        latency,
        message: `${latency}ms · 链路正常 · ${models.length} 个模型`,
        via: 'models',
        models
      };
    } catch (err) {
      // /models 被屏蔽：改用最小 chat 探针
      if ((err.status === 404 || err.status === 405) && modelId) {
        return await probeChat(baseUrl, apiKey, modelId, timeout);
      }
      const latency = Date.now() - started;
      return {
        ok: false,
        latency,
        message: err.status ? err.message : describeNetworkError(err),
        via: 'models',
        models: []
      };
    }
  }

  // 最小对话探针：只要服务端认了 Key 与模型就算通
  async function probeChat(baseUrl, apiKey, modelId, timeout) {
    const url = buildChatUrl(baseUrl);
    const started = Date.now();
    try {
      const resp = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false
        })
      }, timeout);

      const latency = Date.now() - started;
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        return {
          ok: false,
          latency,
          message: describeHttpError(resp.status, body),
          via: 'chat',
          models: []
        };
      }
      return {
        ok: true,
        latency,
        message: `${latency}ms · 链路正常 · 对话探针`,
        via: 'chat',
        models: []
      };
    } catch (err) {
      return {
        ok: false,
        latency: Date.now() - started,
        message: describeNetworkError(err),
        via: 'chat',
        models: []
      };
    }
  }

  /* ================= 对话请求 ================= */

  // 把节点/插槽配置整理成请求体
  function buildBody(config, messages, extra) {
    const body = {
      model: (config.modelId || '').trim(),
      messages: messages
    };
    const temp = parseFloat(config.temp);
    if (!Number.isNaN(temp)) body.temperature = temp;
    const maxTokens = parseInt(config.maxTokens, 10);
    if (!Number.isNaN(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
    return Object.assign(body, extra || {});
  }

  /**
   * 非流式对话
   * @returns {Promise<{content:string, reasoning:string, usage:object|null}>}
   */
  async function chat(config, messages, options) {
    const url = buildChatUrl(config && config.baseUrl);
    if (!url) throw new Error('BASE URL 为空');
    if (!config.modelId) throw new Error('MODEL ID 为空');

    // 对话生成不设前端超时（传 0）：与流式策略一致，长提示词/慢模型十几分钟出字也不掐，
    // 由用户手动停止控制。调用方仍可显式传 options.timeout 覆盖。
    const chatTimeout = (options && typeof options.timeout === 'number') ? options.timeout : 0;
    const resp = await request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (config.apiKey || '')
      },
      body: JSON.stringify(buildBody(config, messages, Object.assign({ stream: false }, options && options.extra)))
    }, chatTimeout, options && options.signal);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(describeHttpError(resp.status, body));
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const choice = (json.choices && json.choices[0]) || {};
    const msg = choice.message || {};
    return {
      content: msg.content || '',
      reasoning: msg.reasoning_content || msg.reasoning || '',
      usage: json.usage || null
    };
  }

  /**
   * 流式对话（SSE）。onChunk(delta, meta) 逐段回调，返回完整文本。
   * 思考模型的 reasoning_content 单独走 meta.reasoning，不混进正文。
   */
  async function streamChat(config, messages, onChunk, options) {
    const url = buildChatUrl(config && config.baseUrl);
    if (!url) throw new Error('BASE URL 为空');
    if (!config.modelId) throw new Error('MODEL ID 为空');

    const canStream = typeof ReadableStream !== 'undefined' && typeof TextDecoder !== 'undefined';
    if (!canStream) {
      const res = await chat(config, messages, options);
      if (onChunk && res.content) onChunk(res.content, { reasoning: false });
      return res;
    }

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + (config.apiKey || '')
      },
      body: JSON.stringify(buildBody(config, messages, Object.assign({ stream: true }, options && options.extra))),
      signal: options && options.signal
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(describeHttpError(resp.status, body));
      err.status = resp.status;
      throw err;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let reasoning = '';

    const consume = (line) => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
        if (delta.content) {
          content += delta.content;
          if (onChunk) onChunk(delta.content, { reasoning: false });
        }
        const r = delta.reasoning_content != null ? delta.reasoning_content : delta.reasoning;
        if (r) {
          reasoning += r;
          if (onChunk) onChunk(r, { reasoning: true });
        }
      } catch (err) {
        /* 半包或心跳行，忽略 */
      }
    };

    // 标记：本次流是否被中途掐断（连接已建立、字已开始流，但传输未走完）。
    // 常见于经中转/代理的长回复，底层会抛原生 TypeError('network error')。
    let interrupted = false;

    /* eslint-disable no-constant-condition */
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(consume);
      }
      if (buffer) consume(buffer);
    } catch (err) {
      // 用户主动取消：照旧抛出 AbortError，交给调用方按「取消」处理，不当错误。
      if ((err && err.name === 'AbortError') || (options && options.signal && options.signal.aborted)) {
        throw wrapNetworkError(err);
      }
      // 非主动中断：连接建立后断流。若已收到内容，则把已到手的部分当作结果返回，
      // 不整条丢弃报错——调用方已通过 onChunk 拿到这些字，正常收尾即可。
      // 一个字都没收到才说明是真·空链路，抛规范化错误让上层提示。
      if (!content.trim() && !reasoning.trim()) {
        throw wrapNetworkError(err);
      }
      interrupted = true;
    }

    // 兜底：部分思考模型把全部正文塞进 reasoning_content
    if (!content.trim() && reasoning.trim()) content = reasoning;

    return {
      content: content,
      reasoning: reasoning,
      usage: null,
      truncated: interrupted
    };
  }

  /* ================= 生图 ================= */

  /**
   * 内置试机提示词：红黑高对比几何机能海报风。
   * 选它做默认试机图的原因：纯几何 + 无人物 + 无文字，几乎不会触发内容审核，
   * 且各家模型（FLUX / SD / DALL·E / 国产系）都能稳定出片，适合验证链路是否通。
   */
  const BUILTIN_TEST_PROMPT = [
    'abstract techwear poster art, geometric constructivism composition',
    'bold vermilion red and deep matte black, high contrast',
    'flat vector illustration, sharp diagonal sliced blocks',
    'technical blueprint grid, tactical directional arrows, hazard stripes',
    'minimal cybernetic warning decals, ultra clean sharp lines',
    'no text, no letters, wide cinematic composition'
  ].join(', ');

  // 构图兜底提示：部分接口（如 gpt-image 系）不认 size 参数，靠提示词纠正比例
  // 默认 3:2 横图（测试生图用），调用方可通过 opts.ratioHint 覆盖成竖图等其他比例
  const RATIO_HINT = 'wide horizontal 3:2 aspect ratio composition';

  // 2:3 竖图（人物立绘 / 头像用）
  const RATIO_HINT_PORTRAIT = 'vertical portrait 2:3 aspect ratio composition';

  // 锁脸指令：只随 API 发出，不进用户可见的提示词框。
  // 说明角度/姿态/表情可自由变化，避免模型把参考图整张复刻出来
  const FACE_LOCK_HINT = 'Use the provided reference image to keep the same facial features, '
    + 'hairstyle and overall likeness. The angle, pose and expression may vary freely '
    + 'unless the description explicitly requests otherwise.';

  // 生图模型名关键词。命中即认为是生图模型；全都不命中时调用方回退全量列表
  const IMAGE_MODEL_HINTS = [
    'image', 'img', 'dall', 'flux', 'stable', 'sd', 'midjourney', 'mj',
    'ideogram', 'imagen', 'qwen-image', 'kolors', 'wan', 'cogview',
    'seedream', 'irag', 'draw', 'paint'
  ];

  /**
   * 从模型列表里筛出疑似生图模型。
   * 一个都没命中时返回原列表（自建中转命名千奇百怪，筛太狠会让人无从下手）。
   * @returns {{ list: string[], filtered: boolean }} filtered 表示是否真的筛出了子集
   */
  function filterImageModels(models) {
    const all = models || [];
    const hit = all.filter((m) => {
      const lower = String(m).toLowerCase();
      return IMAGE_MODEL_HINTS.some((h) => lower.includes(h));
    });
    return hit.length ? { list: hit, filtered: true } : { list: all, filtered: false };
  }

  function buildImageUrl(baseUrl, endpoint) {
    let u = (baseUrl || '').trim();
    if (!u) return '';
    if (u.endsWith('#')) return u.slice(0, -1).replace(/\/$/, '');
    u = u.replace(/\/$/, '')
      .replace(/\/images\/(?:generations|edits)$/i, '')
      .replace(/\/images$/i, '')
      .replace(/\/chat\/completions$/i, '');
    return u + (endpoint || '/images/generations');
  }

  // dataURL / base64 字符串 → Blob，用于 multipart 上传参考图
  function dataUrlToBlob(dataUrl) {
    const str = String(dataUrl || '');
    const parts = str.split(',');
    const head = parts.length > 1 ? parts[0] : '';
    const b64 = parts.length > 1 ? parts[1] : str;
    const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // 参考图可能是 blob: / http(s): 的 objectURL，统一取回成 dataURL 再上传
  async function toUploadableDataUrl(src) {
    const s = String(src || '');
    if (!s) return '';
    if (s.startsWith('data:')) return s;
    const resp = await fetch(s);
    if (!resp.ok) throw new Error('参考图读取失败');
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // 把 b64 或图床 URL 统一收敛成可直接塞进 <img src> 的字符串
  async function toDisplayableImage(item) {
    if (item.b64) return 'data:image/png;base64,' + item.b64;
    if (!item.url) return '';
    // 尝试转 base64（临时 URL 可能很快过期）；跨域拿不到 blob 时退回原 URL，
    // <img> 显示图片本身不受 CORS 限制，所以退回是安全的
    try {
      const resp = await fetch(item.url);
      if (!resp.ok) throw new Error('下载失败');
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      return item.url;
    }
  }

  /**
   * 调用 OpenAI 兼容 /images/generations 生成图片。
   * @param {object} config { baseUrl, apiKey, modelId, prompt, negativePrompt }
   * @param {object} options { prompt, size, timeout, signal, skipGlobalPrompt, ratioHint }
   * @returns {Promise<{image:string, latency:number, size:string, downgraded:boolean}>}
   */
  async function generateImage(config, options) {
    const opts = options || {};
    const url = buildImageUrl(config && config.baseUrl);
    if (!url) throw new Error('BASE URL 为空');

    // 提示词组装：用户全局正向词在前，内置/传入词在后
    const bodyPrompt = opts.prompt || BUILTIN_TEST_PROMPT;
    let finalPrompt = bodyPrompt;
    if (!opts.skipGlobalPrompt && config && config.prompt) {
      finalPrompt = config.prompt + ', ' + bodyPrompt;
    }
    // 比例兜底提示：默认 3:2 横图，调用方可传 ratioHint 覆盖（如头像用 2:3 竖图）
    const ratioHint = opts.ratioHint === undefined ? RATIO_HINT : opts.ratioHint;
    if (ratioHint) finalPrompt += ', ' + ratioHint;

    // 生图慢，且中转站常有排队，超时给足 6 分钟：掐早了钱照扣但图丢了
    const timeout = opts.timeout || 360000;

    const send = async (size) => {
      const body = {
        prompt: finalPrompt,
        n: 1,
        response_format: 'b64_json'
      };
      if (config.modelId) body.model = config.modelId;
      if (size) body.size = size;
      // 负向词：OpenAI 标准无此字段，支持的后端（部分 SD 系中转）会用，不支持的忽略
      if (config && config.negativePrompt) body.negative_prompt = config.negativePrompt;

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }
      try {
        return await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + ((config && config.apiKey) || '')
          },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
      } finally {
        clearTimeout(timer);
      }
    };

    const started = Date.now();
    let usedSize = opts.size || '1024x680';
    let downgraded = false;
    let resp;

    try {
      resp = await send(usedSize);
    } catch (err) {
      throw wrapNetworkError(err);
    }

    // 尺寸不被支持（DALL·E 3 只认固定几档）：降级重试一次。
    // 降级档要跟原请求同朝向，否则竖图头像会被降成横图
    if (!resp.ok && resp.status === 400) {
      const errText = await resp.text().catch(() => '');
      if (/size|dimension|resolution|width|height/i.test(errText)) {
        downgraded = true;
        const dim = String(opts.size || '').match(/^(\d+)x(\d+)$/);
        const isPortrait = dim ? Number(dim[2]) > Number(dim[1]) : false;
        usedSize = isPortrait ? '1024x1792' : '1792x1024';
        try {
          resp = await send(usedSize);
        } catch (err) {
          throw wrapNetworkError(err);
        }
        // 还不行就彻底不传 size，交给服务端默认
        if (!resp.ok && resp.status === 400) {
          usedSize = 'auto';
          try {
            resp = await send(null);
          } catch (err) {
            throw wrapNetworkError(err);
          }
        }
      } else {
        const err = new Error(describeImageError(400, errText));
        err.status = 400;
        throw err;
      }
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(describeImageError(resp.status, errText));
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const list = (json.data || [])
      .map((d) => (d.b64_json ? { b64: d.b64_json } : (d.url ? { url: d.url } : null)))
      .filter(Boolean);

    if (!list.length) throw new Error('服务端未返回图像数据');

    const image = await toDisplayableImage(list[0]);
    if (!image) throw new Error('图像数据解析失败');

    return {
      image,
      latency: Date.now() - started,
      size: usedSize,
      downgraded
    };
  }

  /**
   * 调用 OpenAI 兼容 /images/edits 做图生图（垫图 / 锁脸）。
   * 与 generateImage 的区别：走 multipart/form-data 上传参考图，不是 JSON。
   * 注意：不能手动设 Content-Type，否则 FormData 的 boundary 会丢失导致请求失败。
   * 负向词在 edits 接口普遍不被支持，这里不发送。
   * @param {object} config { baseUrl, apiKey, modelId, prompt }
   * @param {string|string[]} refImages 参考图（dataURL / blob: / http(s) 均可）
   * @param {object} options { prompt, size, timeout, signal, skipGlobalPrompt, ratioHint, faceLock }
   * @returns {Promise<{image:string, latency:number, size:string}>}
   */
  async function generateImageEdit(config, refImages, options) {
    const opts = options || {};
    const url = buildImageUrl(config && config.baseUrl, '/images/edits');
    if (!url) throw new Error('BASE URL 为空');

    const rawRefs = Array.isArray(refImages)
      ? refImages.filter(Boolean)
      : (refImages ? [refImages] : []);
    if (!rawRefs.length) throw new Error('缺少参考图');

    // 统一收敛成 dataURL（objectURL / 图床链接都要先取回本地）
    const refs = [];
    for (const r of rawRefs) {
      const dataUrl = await toUploadableDataUrl(r);
      if (dataUrl) refs.push(dataUrl);
    }
    if (!refs.length) throw new Error('参考图读取失败');

    // 提示词组装：锁脸指令在最前（只发 API），再是全局正向词，最后是本次指令
    let finalPrompt = opts.prompt || BUILTIN_TEST_PROMPT;
    if (!opts.skipGlobalPrompt && config && config.prompt) {
      finalPrompt = config.prompt + ', ' + finalPrompt;
    }
    const ratioHint = opts.ratioHint === undefined ? RATIO_HINT : opts.ratioHint;
    if (ratioHint) finalPrompt += ', ' + ratioHint;
    if (opts.faceLock !== false) {
      finalPrompt = FACE_LOCK_HINT + '\n\n' + finalPrompt;
    }

    const usedSize = opts.size || '1024x1024';
    const timeout = opts.timeout || 360000;

    const form = new FormData();
    form.append('prompt', finalPrompt);
    form.append('n', '1');
    form.append('response_format', 'b64_json');
    if (config && config.modelId) form.append('model', config.modelId);
    if (usedSize) form.append('size', usedSize);
    // 单张用 image，多张用 image[]：兼容 gpt-image 系与多数中转实现
    refs.forEach((r, i) => {
      const blob = dataUrlToBlob(r);
      const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      form.append(refs.length > 1 ? 'image[]' : 'image', blob, `ref_${i}.${ext}`);
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    const started = Date.now();
    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ((config && config.apiKey) || '') },
        body: form,
        signal: ctrl.signal
      });
    } catch (err) {
      throw wrapNetworkError(err);
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      const err = new Error(describeImageEditError(resp.status, errText));
      err.status = resp.status;
      throw err;
    }

    const json = await resp.json();
    const list = (json.data || [])
      .map((d) => (d.b64_json ? { b64: d.b64_json } : (d.url ? { url: d.url } : null)))
      .filter(Boolean);

    if (!list.length) throw new Error('服务端未返回图像数据');

    const image = await toDisplayableImage(list[0]);
    if (!image) throw new Error('图像数据解析失败');

    return {
      image,
      latency: Date.now() - started,
      size: usedSize
    };
  }

  // 生图特有的错误归类（额度、审核、尺寸等）
  function describeImageError(status, bodyText) {
    const detail = extractErrMessage(bodyText);
    if (status === 400 && /safety|policy|content|nsfw|审核/i.test(bodyText || '')) {
      return '400 · 提示词被内容策略拦截';
    }
    if (status === 400 && /size|dimension|resolution/i.test(bodyText || '')) {
      return '400 · 该模型不支持所请求的尺寸';
    }
    if (status === 401) return '401 · API Key 无效或已失效';
    if (status === 402) return '402 · 账户余额不足';
    if (status === 403) return '403 · Key 无该模型权限或被风控';
    if (status === 404) return '404 · 端点不支持 /images/generations';
    if (status === 429) return '429 · 请求过频或额度不足';
    if (status >= 500) return `${status} · 服务端异常${detail ? ' · ' + detail : ''}`;
    return `${status} · ${detail || '生图请求被拒绝'}`;
  }

  // 图生图（垫图）错误归类。与纯生图的差异主要在 404 与不支持垫图的场景
  function describeImageEditError(status, bodyText) {
    const detail = extractErrMessage(bodyText);
    if (status === 400 && /safety|policy|content|nsfw|审核/i.test(bodyText || '')) {
      return '400 · 提示词或参考图被内容策略拦截';
    }
    if (status === 400 && /size|dimension|resolution/i.test(bodyText || '')) {
      return '400 · 该模型不支持所请求的尺寸';
    }
    if (status === 400 && /image|file|format|invalid/i.test(bodyText || '')) {
      return `400 · 参考图不被接受${detail ? ' · ' + detail : ''}`;
    }
    if (status === 401) return '401 · API Key 无效或已失效';
    if (status === 402) return '402 · 账户余额不足';
    if (status === 403) return '403 · Key 无该模型权限或被风控';
    if (status === 404) return '404 · 该端点不支持垫图（/images/edits），请清除面部识别后重试';
    if (status === 405) return '405 · 该端点不支持垫图（/images/edits），请清除面部识别后重试';
    if (status === 429) return '429 · 请求过频或额度不足';
    if (status >= 500) return `${status} · 服务端异常${detail ? ' · ' + detail : ''}`;
    return `${status} · ${detail || '垫图生成请求被拒绝'}`;
  }

  /* ================= MiniMax 语音合成 (t2a_v2) ================= */

  /** 内置试音词：执行员终端初次接入的欢迎播报 */
  const BUILTIN_TTS_TEST_TEXT = '欢迎来到溯流计划';

  /** MiniMax 官方缺省音色与参数边界 */
  const MINIMAX_DEFAULT_VOICE = 'female-shaonv';
  const MINIMAX_DEFAULT_MODEL = 'speech-2.8-hd';
  const TTS_TIMEOUT = 120000;

  function clampSpeed(v) {
    const n = Number(v);
    if (!isFinite(n)) return 1.0;
    return Math.min(2.0, Math.max(0.5, n));
  }

  function clampPitch(v) {
    const n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.min(12, Math.max(-12, Math.round(n)));
  }

  /**
   * 构造 t2a_v2 端点
   * 兼容三种填法：带 /v1 的基址、已带 /t2a_v2 的完整路径、# 结尾强制原样。
   * GroupId 走查询参数：老版 key 必须带，新版 sk-api- 开头的 key 已内含 group 可留空。
   */
  function buildTtsUrl(baseUrl, groupId) {
    if (!baseUrl) return '';
    let u = String(baseUrl).trim();

    if (u.endsWith('#')) {
      u = u.slice(0, -1);
    } else {
      // 剥掉已有查询串再归一路径，避免重复拼接
      u = u.replace(/\?.*$/, '').replace(/\/$/, '');
      if (!/\/t2a_v2$/.test(u)) u += '/t2a_v2';
    }

    const gid = String(groupId || '').trim();
    return gid ? `${u}?GroupId=${encodeURIComponent(gid)}` : u;
  }

  /** MiniMax 返回的十六进制音频字符串 → Blob */
  function hexToAudioBlob(hexString) {
    const clean = String(hexString).trim();
    const bytes = new Uint8Array(Math.floor(clean.length / 2));
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return new Blob([bytes], { type: 'audio/mpeg' });
  }

  function describeTtsError(status, bodyText) {
    const detail = extractErrMessage(bodyText);
    if (status === 401) return '401 · MiniMax API Key 无效或已失效';
    if (status === 402) return '402 · 账户余额不足';
    if (status === 403) return '403 · Key 无该模型权限或被风控';
    if (status === 404) return '404 · 端点路径不对，检查是否要带 /v1';
    if (status === 429) return '429 · 请求过频或额度不足';
    if (status >= 500) return `${status} · 服务端异常${detail ? ' · ' + detail : ''}`;
    return `${status} · ${detail || '语音合成请求被拒绝'}`;
  }

  /**
   * MiniMax 语音合成
   * @param {object} config { baseUrl, apiKey, modelId, voiceId, speed, pitch, groupId }
   * @param {object} [options] { text }
   * @returns {Promise<{blob:Blob, size:number, latency:number}>}
   */
  async function synthesizeSpeech(config, options) {
    const cfg = config || {};
    const opts = options || {};
    if (!cfg.baseUrl) throw new Error('请先填写 BASE URL');
    if (!cfg.apiKey) throw new Error('请先填写 MiniMax API Key');

    const url = buildTtsUrl(cfg.baseUrl, cfg.groupId);
    const text = (opts.text || BUILTIN_TTS_TEST_TEXT).trim();
    if (!text) throw new Error('试音文本为空');

    const started = Date.now();
    let resp;
    try {
      resp = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({
          model: cfg.modelId || MINIMAX_DEFAULT_MODEL,
          text: text,
          stream: false,
          voice_setting: {
            voice_id: cfg.voiceId || MINIMAX_DEFAULT_VOICE,
            speed: clampSpeed(cfg.speed),
            pitch: clampPitch(cfg.pitch),
            vol: 1.0
          },
          // 44100 / 256k 为 MiniMax 支持的最高档，低码率会把 hd 模型压闷
          audio_setting: {
            sample_rate: 44100,
            bitrate: 256000,
            format: 'mp3',
            channel: 1
          }
        })
      }, TTS_TIMEOUT);
    } catch (err) {
      throw wrapNetworkError(err);
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(describeTtsError(resp.status, body));
    }

    const data = await resp.json().catch(() => null);
    if (!data) throw new Error('返回体解析失败，非标准 JSON');

    // MiniMax 业务错误：HTTP 200 但 base_resp 里带错误码
    const baseResp = data.base_resp || {};
    if (baseResp.status_code != null && Number(baseResp.status_code) !== 0) {
      throw new Error(`${baseResp.status_code} · ${baseResp.status_msg || 'MiniMax 业务异常'}`);
    }

    const audioField = data.data && data.data.audio;
    if (!audioField) {
      throw new Error(baseResp.status_msg || 'MiniMax 未返回音频数据');
    }

    // 服务端可能返回 CDN 链接（output_format=url）而非 hex，两种都要吃下
    let blob;
    if (/^https?:\/\//i.test(audioField)) {
      const audioResp = await fetch(audioField);
      if (!audioResp.ok) throw new Error(`音频下载失败 (${audioResp.status})`);
      blob = await audioResp.blob();
    } else {
      blob = hexToAudioBlob(audioField);
    }

    if (!blob || !blob.size) throw new Error('音频解码结果为空');

    return { blob, size: blob.size, latency: Date.now() - started };
  }

  return {
    buildApiUrl,
    buildChatUrl,
    buildModelsUrl,
    buildImageUrl,
    buildTtsUrl,
    fetchModelList,
    filterImageModels,
    testConnection,
    chat,
    streamChat,
    generateImage,
    generateImageEdit,
    synthesizeSpeech,
    describeHttpError,
    describeImageError,
    describeImageEditError,
    describeTtsError,
    describeNetworkError,
    BUILTIN_TEST_PROMPT,
    RATIO_HINT_PORTRAIT,
    BUILTIN_TTS_TEST_TEXT
  };
})();
