/**
 * ============================================================================
 * 溯流计划 · 副本推演请求链路 (Fork Run API)
 *
 * 把「流水记录」翻译成模型能吃的消息数组，装配 System Prompt，发请求。
 * 独立成模块而不是塞进 fork-run-ui —— UI 那边已经两千多行，
 * 且请求装配逻辑与渲染无关，分开后各自可单独排错。
 *
 * 角色映射（关键）：
 *   narration（叙事正文，含开场首帧）→ assistant
 *   envoy    （执行员行动）           → user
 * 开场首帧作为 narration 落库，映射成 assistant 后模型会当成自己的上一轮输出，
 * 因此不必在提示词里额外解释「这幕已经呈现过、别重写」。
 *
 * 连续同角色合并：部分服务端不接受连续两条 assistant / user，必须合并成一条。
 *
 * 依赖：window.RetroflowAPI（api-core.js）提供 chat / streamChat。
 * ============================================================================
 */
window.ForkRunApi = (() => {
  'use strict';

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /* ================= 上下文快照（调试查看） =================
     只留最近一次真实发出的完整消息数组，供设置页「上下文查看」读取。
     纯内存、覆盖式、不落库——它反映的就是「这个窗最新发出去的上下文」，
     刷新即清是合理的。存深拷贝的 role/content，避免后续引用被改动污染。 */
  let lastContextSnapshot = null;

  function getLastContextSnapshot() {
    return lastContextSnapshot;
  }

  /* ================= 模型配置 ================= */

  /**
   * 取副本推演用的模型配置。
   * 推演没有专属插槽，直接用当前激活的主模型节点。
   * @returns {{ baseUrl: string, apiKey: string, modelId: string } | null}
   */
  function resolveConfig() {
    if (window.RetroflowApiUI && typeof RetroflowApiUI.getActiveNode === 'function') {
      const node = RetroflowApiUI.getActiveNode();
      if (node && (node.baseUrl || node.modelId)) return node;
    }
    // 兜底：API 页尚未初始化时直读 Store
    if (window.Store && Store.config) {
      const nodes = Array.isArray(Store.config.apiNodes) ? Store.config.apiNodes : [];
      const activeId = Store.config.apiActiveNodeId || '';
      return nodes.find((n) => n && n.id === activeId) || nodes[0] || null;
    }
    return null;
  }

  /**
   * 读推演流式开关。全局口径（不按副本/世界线隔离），缺省开启。
   * 真相源在 ForkRunSettingsUI，这里只读不写。
   */
  function isStreamingEnabled() {
    if (window.ForkRunSettingsUI && typeof ForkRunSettingsUI.getSettings === 'function') {
      const st = ForkRunSettingsUI.getSettings();
      if (st && typeof st.streaming === 'boolean') return st.streaming;
    }
    return true;
  }

  /* ================= 流水 → API 消息 ================= */

  /**
   * 把一条流水的视觉描述拼成上下文前缀。
   *
   * 只进文字，绝不进 base64：图片本体在视界档案里，上下文里塞一张大图
   * 能瞬间吃掉整个预算，而模型真正需要的只是「执行员看到了什么」。
   * 识别失败的图仍然报数，让模型知道有影像存在但内容不可读，
   * 比装作没有这张图更诚实。
   *
   * @param {Object} rec 流水记录
   * @returns {string} 无附图时返回空串
   */
  function buildVisionPrefix(rec) {
    const imgs = (rec && Array.isArray(rec.images)) ? rec.images.filter(Boolean) : [];
    if (!imgs.length) return '';

    const lines = imgs.map((img, i) => {
      const desc = trimStr(img && img.visionDescription);
      const no = String(i + 1).padStart(2, '0');
      return desc ? `${no}. ${desc}` : `${no}. （该影像未能解析，内容不可读）`;
    });

    return `[执行员携带的现场影像 // 共 ${imgs.length} 张]\n${lines.join('\n')}\n[/现场影像]\n\n`;
  }

  /**
   * 组装行动关联的文件块前缀（异步拉取文件正文）。
   *
   * @param {Object} rec 流水记录
   * @param {string} forkId 所属副本ID
   * @returns {Promise<string>}
   */
  async function buildFilePrefix(rec, forkId) {
    const files = (rec && Array.isArray(rec.files)) ? rec.files.filter(Boolean) : [];
    if (!files.length) return '';
    if (!window.FileStore || typeof FileStore.getText !== 'function') return '';

    const scope = { type: 'fork', id: forkId || 'unknown' };
    const parts = [];
    const INLINE_LIMIT = 4000;

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const no = String(i + 1).padStart(2, '0');
      const text = await FileStore.getText(f.id, scope);
      if (text == null) {
        parts.push(`${no}. 战术档案: ${f.name || '未命名'}（文件已从副本文件区移除，内容不可读）`);
        continue;
      }
      let body = text;
      let note = '';
      if (text.length > INLINE_LIMIT) {
        body = text.slice(0, INLINE_LIMIT);
        note = `\n（内容过长，此处注入前 ${INLINE_LIMIT} 字符，共 ${text.length} 字符）`;
      }
      parts.push(`${no}. 战术档案: ${f.name || '未命名'}\n--- 内容 ---\n${body}${note}`);
    }

    return `[执行员附带的战术档案 // 共 ${files.length} 份]\n${parts.join('\n\n')}\n[/战术档案]\n\n`;
  }

  /**
   * 把推演流水映射成 API 消息数组（支持异步读取文件正文并注入）。
   * @param {Array} records 流水记录
   * @param {string} [forkId] 所属副本ID
   * @returns {Promise<Array<{role: string, content: string}>>}
   */
  async function toApiMessages(records, forkId) {
    const list = Array.isArray(records) ? records : [];
    const out = [];

    for (const rec of list) {
      if (!rec) continue;
      // envoy 是执行员的行动，其余（narration 等）一律视为模型自己的叙事输出
      const role = rec.role === 'envoy' ? 'user' : 'assistant';
      // 视觉描述与战术文件只挂在执行员行动上，前置于正文：模型先「看见」线索再读指令
      const visionPrefix = role === 'user' ? buildVisionPrefix(rec) : '';
      const filePrefix = role === 'user' ? await buildFilePrefix(rec, forkId) : '';
      const content = visionPrefix + filePrefix + trimStr(rec.content);
      if (!trimStr(content)) continue;

      const prev = out[out.length - 1];
      if (prev && prev.role === role) {
        // 连续同角色合并，避免服务端拒收
        prev.content += '\n\n' + content;
      } else {
        out.push({ role, content });
      }
    }

    return out;
  }

  /* ================= 上下文预算裁剪 ================= */

  /**
   * 按 token 预算裁剪推演流水。
   *
   * 轮边界与私聊不同：推演里一轮 = 执行员一条行动 + 模型一条叙事，
   * 但开场首帧是没有对应行动的孤立 narration，得单独成轮。判定只看
   * role 序列：envoy 紧跟在 narration 之后即开新轮。
   *
   * 裁剪单位是轮而不是条：切在一轮中间会让模型看到自己上轮写了一半，
   * 或看到执行员的行动却看不到自己的回应，因果链当场断裂。
   *
   * ContextBudget 缺席时原样返回，不因为裁剪器没加载就发不出请求。
   *
   * @param {Array} records 按时间正序的流水
   * @param {Object} config 模型配置（读 context / maxTokens）
   * @param {string} systemPrompt 本轮 System Prompt，从预算里先扣掉
   * @returns {Array} 裁剪后的流水
   */
  function fitRecords(records, config, systemPrompt) {
    const list = Array.isArray(records) ? records.filter(Boolean) : [];
    if (!window.ContextBudget || list.length === 0) return list;

    const budgetInfo = window.ContextBudget.resolveBudget(config);
    // System Prompt 每轮必发，属固定开销，不该跟历史抢预算
    const systemCost = window.ContextBudget.estimateTokens(systemPrompt) + 4;
    const budget = Math.max(256, budgetInfo.inputBudget - systemCost);

    // 切轮：envoy 在 narration 之后出现即开新轮
    const turns = [];
    let current = null;
    let sawNarration = false;
    list.forEach((rec) => {
      const isEnvoy = rec.role === 'envoy';
      if (!current || (isEnvoy && sawNarration)) {
        current = [];
        turns.push(current);
        sawNarration = false;
      }
      current.push(rec);
      if (!isEnvoy) sawNarration = true;
    });

    const costOf = (turn) => turn.reduce(
      (sum, r) => sum + ContextBudget.estimateTokens(
        (r && r.role === 'envoy' ? buildVisionPrefix(r) : '') + ((r && r.content) || '')
      ) + 4,
      0
    );

    // 从新往旧装，最后一轮（执行员刚发出的行动）无条件保留
    const kept = [];
    let used = 0;
    const lastTurn = turns[turns.length - 1];
    kept.unshift(lastTurn);
    used += costOf(lastTurn);

    for (let i = turns.length - 2; i >= 0; i -= 1) {
      const cost = costOf(turns[i]);
      if (used + cost > budget) break;
      kept.unshift(turns[i]);
      used += cost;
    }

    const out = [];
    kept.forEach((turn) => turn.forEach((r) => out.push(r)));
    return out;
  }

  /* ================= 推演请求 ================= */

  /**
   * 发起一轮推演请求。
   *
   * @param {Object} opts
   * @param {Object} opts.fork         当前副本卷宗（完整卷宗，不是轻量索引）
   * @param {Object} opts.envoyCtx     接入身份 { mode, roleId, serial, name, ... }
   * @param {Object} [opts.openingCtx] { openingId } 准备页选定的开场套
   * @param {Array}  opts.records      当前流水（含刚落库的执行员行动）
   * @param {string} [opts.rewriteHint] 本轮重写引导（仅重写时传入，用后即焚，不落库）
   * @param {boolean} [opts.streaming] 是否流式，缺省读全局设置
   * @param {Function} [opts.onChunk]  流式增量回调 (delta, fullText)，仅流式下触发
   * @param {AbortSignal} [opts.signal] 取消信号
   * @returns {Promise<string>} 完整回复文本
   */
  async function requestInference(opts) {
    const o = opts || {};

    if (!window.RetroflowAPI) {
      throw new Error('API 内核尚未加载');
    }
    if (!window.ForkRunPrompt || typeof ForkRunPrompt.buildSystemPrompt !== 'function') {
      throw new Error('推演提示词引擎尚未加载');
    }

    const config = resolveConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('尚未配置模型，请先在「API 设置」中设置主模型');
    }

    // 世界书扫描用消息：从 records 尾部取最近若干条，映射成 {role, content}，
    // 供 buildSystemPrompt / buildDepthInjection 内部传给 WorldBookEngine 做关键词判定。
    // 引擎只看最后 SCAN_MESSAGE_COUNT(4) 条，这里取 6 条留余量（对齐 online-chat 的 PROBE 做法）。
    // 不走 toApiMessages（那需要 await 读文件），轻量映射即可——世界书只扫正文关键词，不需要文件前缀。
    const SCAN_TAIL = 6;
    const scanMessages = (function buildScanMessages(records) {
      const list = Array.isArray(records) ? records : [];
      const tail = list.slice(-SCAN_TAIL);
      const out = [];
      for (const rec of tail) {
        if (!rec || !trimStr(rec.content)) continue;
        const role = rec.role === 'envoy' ? 'user' : 'assistant';
        const prev = out[out.length - 1];
        if (prev && prev.role === role) {
          prev.content += '\n\n' + trimStr(rec.content);
        } else {
          out.push({ role, content: trimStr(rec.content) });
        }
      }
      return out;
    })(o.records);

    // 世界书作用域：副本 id + 副本内角色 id 列表，供引擎做书本级绑定过滤。
    // 角色列表由调用方传入（fork-run-ui 已有 currentForkNpcs / currentForkHazardChars）。
    const wbScope = {
      forkId: trimStr(o.fork && o.fork.id),
      rosterIds: Array.isArray(o.rosterIds) ? o.rosterIds : [],
      // 会话级世界书黑名单（本世界线显式关掉的 book / entry），由 fork-run-ui 从 run 读出传入
      wbOverrides: (o.wbOverrides && typeof o.wbOverrides === 'object') ? o.wbOverrides : null
    };

    const systemPrompt = ForkRunPrompt.buildSystemPrompt(o.fork, o.envoyCtx, o.openingCtx, o.clueCtx, o.truthCtx, o.endingCtx, scanMessages, wbScope, o.missionCtx);

    // 重写引导属高时效指令：拼在 System Prompt 里会被后面的历史流水冲散注意力，
    // 所以单独成块，稍后插到上下文末端（最后一条执行员行动之前）紧贴生成点。
    const rewriteDirective = (typeof ForkRunPrompt.buildRewriteDirectiveBlock === 'function')
      ? ForkRunPrompt.buildRewriteDirectiveBlock(o.rewriteHint)
      : '';

    // 深度注入条目：调用方传入的贴脸高时效指令（真相/结局导演指令等）+
    // 世界书深度注入（全局 + 副本分类）。合并后统一占预算、裁剪后插入消息数组。
    const wbDepthItems = (typeof ForkRunPrompt.buildDepthInjection === 'function')
      ? ForkRunPrompt.buildDepthInjection(scanMessages, wbScope)
      : [];
    const callerDepthItems = Array.isArray(o.depthItems)
      ? o.depthItems.filter((it) => it && trimStr(it.content))
      : [];
    const depthItems = callerDepthItems.concat(wbDepthItems.filter((it) => it && trimStr(it.content)));
    const depthCost = depthItems.map((it) => trimStr(it.content)).join('\n\n');

    // 上下文按 token 预算从新到旧整轮装填，超预算的旧轮整轮丢。
    // System Prompt 是每轮必发的固定开销，先从预算里扣掉再装历史。
    // 重写引导 / 深度注入同理：它们一定会发出去，必须一起占预算，否则历史会挤掉它们的空间。
    const fitted = fitRecords(o.records, config, systemPrompt + rewriteDirective + depthCost);
    const forkId = trimStr(o.fork && o.fork.id);
    const history = await toApiMessages(fitted, forkId);

    if (history.length === 0) {
      throw new Error('没有可供推演的上下文');
    }

    const messages = [{ role: 'system', content: systemPrompt }].concat(history);

    // 插入重写引导：并入最后一条执行员行动（user 消息）的正文尾部。
    //
    // 为什么不单独作为对话中途的 system 消息：中途 system 的存在感很低，
    // 容易被前后大量历史流水冲散注意力（并非读不到，而是权重被稀释）。
    // 并入 user 正文尾部，指令就成了执行员这一轮真实输入的一部分，且处于
    // 全文最末端紧贴生成点，注意力最强。找不到 user 消息（理论上不会
    // 发生）时退化为追加一条 user 消息，保证指令不丢。
    if (rewriteDirective) {
      let lastUserIdx = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].role === 'user') { lastUserIdx = i; break; }
      }
      if (lastUserIdx >= 0) {
        const orig = messages[lastUserIdx].content || '';
        messages[lastUserIdx] = {
          role: 'user',
          content: orig ? (orig + '\n\n' + rewriteDirective) : rewriteDirective
        };
      } else {
        messages.push({ role: 'user', content: rewriteDirective });
      }
    }

    // 应用深度注入：在上下文裁剪 + 重写引导都处理完之后，把 depthItems 插进消息数组。
    // 深度语义（对齐 WorldBookEngine）：从数组末尾往前数的插入位置，深度 0 = 最末尾（最贴生成点），
    // 深度 1 = 最新消息之前，深度 N = 往前数 N 条。必须在裁剪之后插，否则可能被裁掉。
    // 通用管线：真相解明导演指令、世界书 depth 条目等都往这里塞。
    let finalMessages = messages;
    if (depthItems.length && window.WorldBookEngine && typeof WorldBookEngine.applyDepthInjection === 'function') {
      finalMessages = WorldBookEngine.applyDepthInjection(messages, depthItems);
    }

    // 存一份最近一次真实发出的上下文快照（调试查看用）。深拷贝 role/content，
    // 时机在 finalMessages 定型、发请求之前，所见即所发：system prompt 全文、
    // 世界书 top/bottom、裁剪后的历史、深度注入（真相/结局导演指令、精神状态通知）全在里面。
    try {
      const snapMsgs = finalMessages.map((m) => ({
        role: (m && m.role) || '',
        content: (m && typeof m.content === 'string') ? m.content : ''
      }));
      const totalChars = snapMsgs.reduce((sum, m) => sum + m.content.length, 0);
      let totalTokens = 0;
      if (window.ContextBudget && typeof ContextBudget.estimateTokens === 'function') {
        totalTokens = snapMsgs.reduce((sum, m) => sum + ContextBudget.estimateTokens(m.content), 0);
      }
      lastContextSnapshot = {
        at: Date.now(),
        messages: snapMsgs,
        meta: {
          model: trimStr(config && (config.modelId || config.model)),
          streamingWillUse: typeof o.streaming === 'boolean' ? o.streaming : isStreamingEnabled(),
          messageCount: snapMsgs.length,
          keptRecords: Array.isArray(fitted) ? fitted.length : 0,
          totalRecords: Array.isArray(o.records) ? o.records.length : 0,
          depthCount: depthItems.length,
          totalChars,
          totalTokens
        }
      };
    } catch (err) {
      console.warn('[ForkRunApi] 上下文快照写入失败：', err);
    }

    // 流式开关取全局设置；调用方显式传 streaming 时以调用方为准（调试用）
    const streaming = typeof o.streaming === 'boolean' ? o.streaming : isStreamingEnabled();

    if (streaming && typeof RetroflowAPI.streamChat === 'function') {
      let full = '';
      const res = await RetroflowAPI.streamChat(config, finalMessages, (delta, meta) => {
        // 思考链走 meta.reasoning，不混进正文
        if (meta && meta.reasoning) return;
        full += delta || '';
        if (typeof o.onChunk === 'function') o.onChunk(delta || '', full);
      }, { signal: o.signal, logTag: '推演主线' });
      return trimStr(res && res.content) || full;
    }

    // 非流式：不回调 onChunk。反正要等整段回来，中途没有可呈现的增量，
    // 调了只会让等待占位块闪一下被截断的半截正文，随即又被完整成品替换。
    // 等待标识保持到收尾，由调用方一次性渲染带状态卡的成品。
    const res = await RetroflowAPI.chat(config, finalMessages, { signal: o.signal, logTag: '推演主线' });
    return trimStr(res && res.content);
  }

  /* ================= 公共接口 ================= */

  return {
    resolveConfig,
    isStreamingEnabled,
    toApiMessages,
    fitRecords,
    requestInference,
    getLastContextSnapshot
  };
})();
