/**
 * ============================================================================
 * 溯流计划 · 助手对话内核 (Assistant Chat Core)
 *
 * 把「装配上下文 → 调模型 → 流式接收 → 落库 → 工具循环」这条链路从具体界面里
 * 剥出来。内核自己不碰任何 DOM，也不认识任何玩法概念 —— 它只认一个渲染适配器
 * 和一组业务动作回调。
 *
 * 为什么要这么分：
 *   同一套对话逻辑现在有三个落点 —— 助手全屏页、副本 DECK 里的随行助手舱，
 *   以及将来沙盒模式的随行助手舱。逻辑若留在界面模块里，第二个落点就得抄一遍，
 *   第三个落点再抄一遍，三份各自长歪。
 *
 * 刻意不出现的东西（动它之前先想清楚）：
 *   · 任何 document / DOM 操作          → 全部走 renderer
 *   · 任何 fork / 副本 / 任务 / 沙盒字样 → 内核对玩法模式一无所知
 *   · 任何落库键名与 forkId 拼装        → 全部走 persist 回调
 * 这三条是内核能被复用的前提，破一条就退化成第二个 system-chat-ui。
 *
 * ---------------------------------------------------------------------------
 * requestReply(options) 的约定
 *
 * options.history   Array   已装配好的消息数组（内核不负责拉流水）
 * options.config    Object  模型配置 { baseUrl, modelId, ... }
 * options.messages  Array   可选。已 fit 过的上下文；不传则内核用 buildMessages 回调自取
 *
 * options.renderer  Object  渲染适配器，全部方法都可缺省（缺省即不渲染）
 *   openBubble(role, createdAt)          → handle   建承载气泡
 *   syncBubble(handle, rawText, opts)    → void     刷新气泡内容（流式每帧调）
 *   clearFirstChunk(handle)              → void     首帧到达时清掉占位
 *   bindRecord(handle, record)           → void     把落库结果回写到节点
 *   dropBubble(handle)                   → void     移除空气泡
 *   toolCard(info)                       → void     渲染一张工具调用卡
 *   scrollToBottom()                     → void     滚到底
 *   genPlaceholder(rawText)              → void     流式生图占位（可不实现）
 *   resetGenPlaceholder()                → void     清理生图占位（可不实现）
 *
 * options.persist   Object  落库回调
 *   message(role, rawText, createdAt, groupId) → Promise<record>
 *   toolCall(result, groupId)                  → Promise<record>
 *
 * options.actions   Object  业务动作回调
 *   isToolAction(action)      → boolean          该动作是否属于「要跑工具循环」的类型
 *   runTool(action)           → Promise<result>  执行一次工具，返回 {name,input,output,status}
 *   runOtherActions(rawText)  → Promise<string>  执行非工具动作（如换头像、生图），返回可见文本
 *   toolCardTag(name, status) → string           工具卡片 tag 文案
 *   replyNotice(record, text) → void             落定后的系统通知（可缺省）
 *
 * options.hooks     Object  可选生命周期钩子
 *   onInferStart(abortController) → void   推演开始（外部据此存 controller / 点亮状态）
 *   onInferEnd()                  → void   推演结束（正常 / 异常 / 取消都会走）
 *
 * options.toolLoopLimit Number 工具循环上限，不传读设置、再不行用 10
 *
 * @returns {Promise<string>} 本轮最终可见文本（无可见文本时为空串）
 * ============================================================================
 */
window.AssistantChatCore = (() => {
  'use strict';

  /** 工具循环上限兜底值。与 system-chat-ui 原有常量保持一致 */
  const DEFAULT_TOOL_LOOP_LIMIT = 10;

  /* ======================= 纯字符串处理层 ======================= */
  /* 这一段是从 system-chat-ui.js 平移过来的纯函数，零 DOM、零业务依赖。
     搬过来而不是注入，是因为它们描述的是「模型输出长什么样」，
     属于对话协议本身，任何界面接内核都需要同一套解析口径。 */

  /**
   * 把思维链与正文合成一条待渲染 / 落库的原文。
   * 落库带 <think> 是刻意的：历史可展开回看，而回灌模型前会被剥掉。
   */
  function composeWithThinking(think, body) {
    const t = String(think || '').trim();
    if (!t) return String(body || '');
    return `<think>${t}</think>\n${String(body || '')}`;
  }

  /** 剥掉思维链，得到可进模型上下文的纯正文 */
  function stripThinkingFromContext(rawText) {
    if (typeof rawText !== 'string' || !rawText) return String(rawText || '');
    return rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  }

  /**
   * 剥掉助手回复开头自行复述的时间 / 电量标注行。
   *
   * 上下文里每条消息都带 [消息时间：…] 前缀，模型容易把这套后台格式当成回复模板
   * 照抄一行播报。提示词已明令禁止，但那是概率约束，这里做确定性兜底。
   * 只裁「开头连续出现的、语义属于时间/电量的独立标注行」，正文中间的方括号一概不动。
   */
  function stripEchoedTimePrefix(rawText) {
    if (typeof rawText !== 'string' || !rawText) return String(rawText || '');

    const TIME_KEYWORD = /(时间|日期|星期|时刻|电量|充电|now|date|time|weekday|battery)/i;
    const TIME_VALUE = /(\d|星期|周[一二三四五六日天])/;
    const WRAPPED_LINE = /^\s*(?:\[([^\]\n]*)\]|【([^】\n]*)】|\(([^)\n]*)\)|（([^）\n]*)）)\s*$/;
    const LABELED_LINE = /^\s*(?:\[([^\]\n]*)\]|【([^】\n]*)】)\s*[：:]?\s*([^\n]*)$/;
    const BARE_LINE = /^\s*(?:当前|现实|此刻|系统|本次)?\s*(?:时间|日期|时刻)\s*(?:基准)?\s*[：:]\s*(\S[^\n]*)$/;

    function isTimeNoticeLine(line) {
      if (!line || !line.trim()) return false;
      const wrapped = line.match(WRAPPED_LINE);
      if (wrapped) {
        const inner = wrapped[1] || wrapped[2] || wrapped[3] || wrapped[4] || '';
        return TIME_KEYWORD.test(inner) && TIME_VALUE.test(inner);
      }
      const labeled = line.match(LABELED_LINE);
      if (labeled) {
        const label = labeled[1] || labeled[2] || '';
        const value = labeled[3] || '';
        return TIME_KEYWORD.test(label) && TIME_VALUE.test(value);
      }
      const bare = line.match(BARE_LINE);
      if (bare) return TIME_VALUE.test(bare[1] || '');
      return false;
    }

    const lines = rawText.split('\n');
    let cut = 0;

    // 开头可能先有一整个 <think> 块，需跳过它再判断正文首行
    if (/^\s*<think>/i.test(rawText)) {
      let probe = 0;
      let closed = false;
      while (probe < lines.length) {
        if (/<\/think>/i.test(lines[probe])) { closed = true; probe += 1; break; }
        probe += 1;
      }
      if (closed) cut = probe;
    }

    while (cut < lines.length) {
      const line = lines[cut];
      if (!line.trim()) {
        // 空行本身不裁，但要看它后面是否还跟着时间标注行
        let probe = cut + 1;
        while (probe < lines.length && !lines[probe].trim()) probe += 1;
        if (probe >= lines.length || !isTimeNoticeLine(lines[probe])) break;
        cut = probe + 1;
        continue;
      }
      if (!isTimeNoticeLine(line)) break;
      cut += 1;
    }

    if (cut <= 0) return rawText;
    return lines.slice(cut).join('\n').replace(/^\n+/, '');
  }

  /**
   * 从助手原文里抽出动作标记，并返回剥离标记后的可见文本。
   * 兼容模型把标记包进 Markdown 代码块、以及流式被掐断留下半截标记的情况。
   */
  function extractAssistantActions(rawText) {
    const actions = [];
    const source = String(rawText || '');

    const captureAction = (payload) => {
      let text = String(payload || '').trim();
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      // 中文引号与尾随逗号纠偏，尽量抢救成合法 JSON
      const normalized = text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        const action = JSON.parse(normalized);
        if (action && typeof action === 'object') {
          actions.push(action);
          return true;
        }
      } catch (err) {
        console.warn('[AssistantChatCore] 动作协议 JSON 解析失败：', normalized, err);
        if (window.RetroToast) {
          RetroToast.show({ tag: 'ACTION // 解析失败', message: '助手动作指令格式不合法，未能执行。', type: 'warning' });
        }
      }
      return false;
    };

    const visibleText = source
      .replace(/```[a-z]*\s*(<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>)\s*```/gi, '$1')
      .replace(/<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi, (_, payload) => {
        captureAction(payload);
        return '';
      })
      .replace(/```[a-z]*\s*<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .trim();

    return { visibleText, actions };
  }

  /** 原文里除动作标记与思维链之外，是否还有可见正文 */
  function hasVisibleBodyText(rawText) {
    let s = String(rawText || '');
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripActionMarkers === 'function') {
      s = RetroflowMarkdown.stripActionMarkers(s);
    }
    s = stripThinkingFromContext(s);
    return s.trim().length > 0;
  }

  /* ======================= 适配器安全包装 ======================= */
  /* renderer / persist / actions 的方法一律允许缺省：
     DECK 舱第一版不做生图占位，助手页不需要额外通知，各取所需。
     包一层 noop 后，内核主干不必到处写 typeof 判断。 */

  function wrapRenderer(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const call = (fn, ...args) => {
      if (typeof fn !== 'function') return null;
      try { return fn(...args); } catch (err) {
        console.warn('[AssistantChatCore] renderer 调用异常：', err);
        return null;
      }
    };
    return {
      openBubble: (role, createdAt) => call(r.openBubble, role, createdAt),
      syncBubble: (handle, text, opts) => call(r.syncBubble, handle, text, opts),
      clearFirstChunk: (handle) => call(r.clearFirstChunk, handle),
      bindRecord: (handle, record, opts) => call(r.bindRecord, handle, record, opts),
      dropBubble: (handle) => call(r.dropBubble, handle),
      toolCard: (info) => call(r.toolCard, info),
      scrollToBottom: () => call(r.scrollToBottom),
      genPlaceholder: (text) => call(r.genPlaceholder, text),
      resetGenPlaceholder: () => call(r.resetGenPlaceholder)
    };
  }

  function wrapActions(raw) {
    const a = raw && typeof raw === 'object' ? raw : {};
    return {
      isToolAction: typeof a.isToolAction === 'function' ? a.isToolAction : () => false,
      runTool: typeof a.runTool === 'function' ? a.runTool : null,
      // 没有注入时退化为「只剥标记、不执行」，保证可见文本仍然算得出来
      runOtherActions: typeof a.runOtherActions === 'function'
        ? a.runOtherActions
        : async (rawText) => extractAssistantActions(rawText).visibleText,
      toolCardTag: typeof a.toolCardTag === 'function' ? a.toolCardTag : (name) => String(name || 'TOOL'),
      replyNotice: typeof a.replyNotice === 'function' ? a.replyNotice : () => {}
    };
  }

  function resolveToolLoopLimit(explicit) {
    const given = parseInt(explicit, 10);
    if (Number.isFinite(given) && given >= 1) return given;
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : null;
    const val = s && parseInt(s.toolLoopLimit, 10);
    return Number.isFinite(val) && val >= 1 ? val : DEFAULT_TOOL_LOOP_LIMIT;
  }

  /** 流式开关：缺省开 */
  function resolveStreaming() {
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : null;
    return !s || s.streaming !== false;
  }

  /* ======================= 主干 ======================= */

  /**
   * 跑一轮完整的助手应答（含工具循环）。
   * 结构与原 requestAssistantReply 逐段对应，差别只在于所有 DOM 操作换成了
   * renderer.*、所有落库换成 persist.*、所有业务动作换成 actions.*。
   */
  async function requestReply(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const config = opts.config;
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('尚未配置系统助手模型，或主模型配置不完整');
    }
    if (!window.RetroflowAPI) {
      throw new Error('系统助手 API 模块尚未加载');
    }

    const messages = Array.isArray(opts.messages) ? opts.messages.slice() : [];
    if (!messages.length) {
      throw new Error('上下文为空，无法发起请求');
    }

    const renderer = wrapRenderer(opts.renderer);
    const actions = wrapActions(opts.actions);
    const persist = opts.persist && typeof opts.persist === 'object' ? opts.persist : {};
    const hooks = opts.hooks && typeof opts.hooks === 'object' ? opts.hooks : {};
    const loopLimit = resolveToolLoopLimit(opts.toolLoopLimit);
    const streaming = resolveStreaming();

    const persistMessage = typeof persist.message === 'function' ? persist.message : null;
    const persistToolCall = typeof persist.toolCall === 'function' ? persist.toolCall : null;

    let reply = '';
    // 原生思维链单独累积：声明在 try 外，用户中途停止时 catch 分支也要能一起存下
    let reasoningText = '';
    let handle = null;

    const abortController = new AbortController();
    const signal = abortController.signal;
    if (typeof hooks.onInferStart === 'function') {
      try { hooks.onInferStart(abortController); } catch (_) { /* 钩子异常不影响主流程 */ }
    }

    const createdAt = Date.now();

    try {
      // openBubble 允许返回 Promise（助手页的 appendMessage 就是 async），
      // 这里必须 await 拿到真实句柄 —— 否则 handle 是个 Promise，
      // handle.sync / handle.content 全是 undefined，气泡会永远停在加载态。
      handle = await renderer.openBubble('assistant', createdAt);
      let hasReceivedFirstChunk = false;

      const update = (delta, isReasoning) => {
        if (isReasoning) {
          reasoningText += delta || '';
        } else {
          if (!delta && hasReceivedFirstChunk) return;
          reply += delta || '';
        }
        if (!hasReceivedFirstChunk) {
          hasReceivedFirstChunk = true;
          renderer.clearFirstChunk(handle);
        }
        // 传原文（思维链 + 正文）：标记隐藏与 think 折叠都由渲染层处理，
        // 流式吐到一半的残缺标记不会闪现半截尖括号。
        renderer.syncBubble(handle, composeWithThinking(reasoningText, reply), { cursor: true, animate: true });
        renderer.genPlaceholder(reply);
        renderer.scrollToBottom();
      };

      if (streaming && typeof RetroflowAPI.streamChat === 'function') {
        await RetroflowAPI.streamChat(config, messages, (delta, meta) => {
          update(delta, Boolean(meta && meta.reasoning));
        }, { signal, logTag: opts.logTag || '系统助手' });
      } else {
        const result = await RetroflowAPI.chat(config, messages, { signal, logTag: opts.logTag || '系统助手' });
        reply = result && result.content ? result.content : '';
        reasoningText = String((result && result.reasoning) || '');
        hasReceivedFirstChunk = true;
        renderer.syncBubble(handle, composeWithThinking(reasoningText, reply), { animate: true });
        renderer.genPlaceholder(reply);
        renderer.scrollToBottom();
      }

      // 兜底：部分思考模型把全部正文塞进 reasoning_content，正文为空。
      // 这种情况下思维链就是正文，否则气泡只剩一个空折叠面板。
      if (!reply.trim() && reasoningText.trim()) {
        reply = reasoningText;
        reasoningText = '';
      }

      reply = composeWithThinking(reasoningText, reply);
      reply = stripEchoedTimePrefix(reply);

      /* ---- 工具循环：回复里带工具动作就执行并回灌，再请求下一轮 ---- */
      let loopCount = 0;
      let currentReply = reply;
      let currentHandle = handle;
      let currentCreatedAt = createdAt;

      while (true) {
        const parsed = extractAssistantActions(currentReply);
        const toolActions = parsed.actions.filter((act) => actions.isToolAction(act));

        // 无工具动作（或已达上限）：执行常规动作、落定本条消息、收尾
        if (!toolActions.length || loopCount >= loopLimit || !actions.runTool) {
          if (toolActions.length && loopCount >= loopLimit && window.RetroToast) {
            RetroToast.show({ tag: 'TOOL // 已达上限', message: `内置工具连续调用已达 ${loopLimit} 次上限`, type: 'info' });
          }
          const finalText = String(await actions.runOtherActions(currentReply) || '').trim();

          // finalText 只用于判断「这条消息还有没有文字」；落库与显示一律用原文
          // currentReply（含动作标记），标记隐藏交给渲染层，这样编辑能看到原文、
          // 上下文完整，也不会因为「只发了图」而丢掉整条记录。
          if (!finalText) {
            renderer.dropBubble(currentHandle);
            renderer.resetGenPlaceholder();
            return '';
          }

          renderer.syncBubble(currentHandle, currentReply);
          let record = null;
          if (persistMessage) {
            // groupId 沿用气泡所在分组，与改造前 persistChatMessage 的取值口径一致
            const groupId = (currentHandle && currentHandle.row && currentHandle.row.dataset)
              ? (currentHandle.row.dataset.messageGroupId || null)
              : null;
            record = await persistMessage('assistant', currentReply, currentCreatedAt, groupId);
            if (record) {
              actions.replyNotice(record, finalText);
              renderer.bindRecord(currentHandle, record);
            }
          }
          renderer.resetGenPlaceholder();
          return finalText;
        }

        loopCount += 1;

        // 本轮可见文本落定为一条助手消息；无可见文本则移除空气泡
        const visibleThisRound = hasVisibleBodyText(currentReply) ? parsed.visibleText.trim() : '';
        if (visibleThisRound) {
          renderer.syncBubble(currentHandle, currentReply);
          if (persistMessage) {
            const midGroupId = (currentHandle && currentHandle.row && currentHandle.row.dataset)
              ? (currentHandle.row.dataset.messageGroupId || null)
              : null;
            const midRecord = await persistMessage('assistant', currentReply, currentCreatedAt, midGroupId);
            if (midRecord) renderer.bindRecord(currentHandle, midRecord, { overwriteCreatedAt: true });
          }
        } else {
          renderer.dropBubble(currentHandle);
        }

        // 执行工具、渲染卡片、把结果回灌成 system 消息供下一轮使用。
        // groupId 取当前气泡所属分组：工具记录要和触发它的那条助手消息同组，
        // 否则多选删除时会留下孤立的工具卡。
        const toolGroupId = (currentHandle && currentHandle.row && currentHandle.row.dataset)
          ? (currentHandle.row.dataset.messageGroupId || null)
          : null;
        const toolResultLines = [];
        for (const action of toolActions) {
          const result = await actions.runTool(action);
          if (!result) continue;
          renderer.toolCard({
            name: result.name,
            tag: actions.toolCardTag(result.name, result.status),
            input: result.input,
            output: result.output,
            status: result.status
          });
          if (persistToolCall) await persistToolCall(result, toolGroupId);
          toolResultLines.push(`[工具结果 · ${result.name}]\n${result.output}`);
        }

        // 回灌给模型的内容必须剥掉思维链；工具调用本身也必须作为 assistant 消息回灌，
        // 否则部分 OpenAI 兼容节点会收到「user → system 结果」的非法序列而直接结束推理。
        const assistantToolMessage = stripThinkingFromContext(currentReply).trim();
        if (assistantToolMessage) {
          messages.push({ role: 'assistant', content: assistantToolMessage });
        }
        messages.push({
          role: 'system',
          content: `以下是你上一步调用工具的执行结果，请据此继续回答执行员：\n\n${toolResultLines.join('\n\n')}`
        });

        // 开新一轮的承载气泡（同样要 await 真实句柄）
        currentReply = '';
        currentCreatedAt = Date.now();
        currentHandle = await renderer.openBubble('assistant', currentCreatedAt);
        let nextFirstChunk = false;
        let nextReasoning = '';

        const nextUpdate = (delta, isReasoning) => {
          if (isReasoning) {
            nextReasoning += delta || '';
          } else {
            if (!delta && nextFirstChunk) return;
            currentReply += delta || '';
          }
          if (!nextFirstChunk) {
            nextFirstChunk = true;
            renderer.clearFirstChunk(currentHandle);
          }
          renderer.syncBubble(currentHandle, composeWithThinking(nextReasoning, currentReply), { cursor: true, animate: true });
          renderer.genPlaceholder(currentReply);
          renderer.scrollToBottom();
        };

        if (streaming && typeof RetroflowAPI.streamChat === 'function') {
          await RetroflowAPI.streamChat(config, messages, (delta, meta) => {
            nextUpdate(delta, Boolean(meta && meta.reasoning));
          }, { signal, logTag: opts.logTag || '系统助手' });
        } else {
          const result = await RetroflowAPI.chat(config, messages, { signal, logTag: opts.logTag || '系统助手' });
          currentReply = result && result.content ? result.content : '';
          nextReasoning = String((result && result.reasoning) || '');
          renderer.syncBubble(currentHandle, composeWithThinking(nextReasoning, currentReply), { animate: true });
          renderer.genPlaceholder(currentReply);
          renderer.scrollToBottom();
        }

        currentReply = composeWithThinking(nextReasoning, currentReply);
        currentReply = stripEchoedTimePrefix(currentReply);
      }
    } catch (err) {
      // 超时必须显式报错，不能被当成「用户主动取消」静默吞掉
      // （非流式长回复曾因默认超时被误判为取消，表现为界面完全无反应）
      const isTimeout = Boolean(err && err.isTimeout);
      const isAbort = !isTimeout
        && ((err && (err.name === 'AbortError'
          || err.message === 'The user aborted a request.'
          || err.message === 'DOMException: The user aborted a request.'))
          || (signal && signal.aborted));

      if (isAbort) {
        // 用户手动终止：安静处理。已吐出的内容存盘保留，未吐字则清理空气泡。
        // 思维链一并存下：停在「还在思考」阶段时，这条记录也能展开看到当时的思考。
        const rawPartial = stripEchoedTimePrefix(composeWithThinking(reasoningText, reply));
        const stripped = (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripActionMarkers === 'function')
          ? RetroflowMarkdown.stripActionMarkers(rawPartial).trim()
          : rawPartial.trim();
        if (stripped) {
          renderer.syncBubble(handle, rawPartial);
          if (persistMessage) {
            const record = await persistMessage('assistant', rawPartial, createdAt, null);
            if (record) renderer.bindRecord(handle, record, { overwriteCreatedAt: true });
          }
          return stripped;
        }
        renderer.dropBubble(handle);
        return '';
      }

      // 非主动终止的真实 API 异常：清掉空气泡后原样抛出，由调用方提示
      renderer.dropBubble(handle);
      throw err;
    } finally {
      if (typeof hooks.onInferEnd === 'function') {
        try { hooks.onInferEnd(); } catch (_) { /* 钩子异常不影响收尾 */ }
      }
      // 无论正常 / 异常 / 取消，都清掉残留的流式生图占位，避免孤儿转圈行
      renderer.resetGenPlaceholder();
    }
  }

  return {
    requestReply,
    // 下列纯函数一并导出：界面侧的历史恢复、编辑、上下文装配也需要同一套口径
    composeWithThinking,
    stripThinkingFromContext,
    stripEchoedTimePrefix,
    extractAssistantActions,
    hasVisibleBodyText
  };
})();
