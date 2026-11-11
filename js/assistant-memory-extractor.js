/**
 * ============================================================================
 * 溯流计划 · 助手记忆提取（AssistantMemoryExtractor）
 * ============================================================================
 * 从助手对话记录里取最旧的一段未提取消息，交给模型整理成记忆并写入记忆库。
 *
 * 规则（与执行员确认过）：
 *   - 每个对话窗口单独记进度点：sysChat/memcursor.{convId} = { createdAt, id }。
 *     判断是否已提取只比较时间，不按 id 查找原消息，进度点那条被删也不影响。
 *   - 一次提取的量 = 设置里的「提取频率」N tk。按整轮切：连续的执行员消息算一问，
 *     随后连续的助手消息算一答。累计不超过 N 的整轮为止；单独一轮就超过 N 时整轮放入。
 *   - 最后一问还没有回复时不算可提取。助手正在生成时不提取。
 *   - 手动提取：只提取一段。自动提取：可提取量 ≥ N 时排队逐段提取，失败一次就停止。
 *   - 手动与自动共用一把锁，同一时间只跑一个任务。
 *   - 记忆写入与进度点更新在同一个数据库事务里，失败时两边都不落地。
 *     解析成功但没有可记内容（空数组）时，进度点照常前进。
 *   - 只送普通聊天消息，工具调用与撤回提示不送。
 *
 * 不负责：记忆工具（向对话注入记忆）、备份导入导出、查看记忆源。
 * ============================================================================
 */
const AssistantMemoryExtractor = (() => {
  'use strict';

  const MESSAGE_KIND = 'system_chat_message';
  const DEFAULT_INTERVAL = 60000;
  const MIN_INTERVAL = 1000;
  const AUTO_DELAY_MS = 1500;
  const LOG_TAG = '助手记忆提取';

  /* ======================= 纯函数（可在 Node 中测试） ======================= */

  const pad2 = (n) => String(n).padStart(2, '0');

  /** 本地时间 + 时区偏移，形如 2026-11-10T21:05:00+08:00（规范第 10.4 节） */
  function formatTime(ts) {
    const d = new Date(Number(ts) || 0);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const abs = Math.abs(off);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
      + `T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
      + `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  }

  /** 与 ContextBudget 同一套估算：中日韩字符按 1 token，其他约 4 字符 1 token */
  function estimateTokens(text) {
    if (typeof window !== 'undefined' && window.ContextBudget && typeof window.ContextBudget.estimateTokens === 'function') {
      return window.ContextBudget.estimateTokens(text);
    }
    const value = String(text == null ? '' : text);
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    return cjk + Math.ceil((value.length - cjk) / 4);
  }

  /** 普通聊天消息（执行员或助手说的话，含图片与文件），不含工具调用与撤回提示 */
  function isChatMessage(rec) {
    return Boolean(rec && rec.kind === MESSAGE_KIND && (rec.role === 'user' || rec.role === 'assistant'));
  }

  /** 记录是否在进度点之后。比较 (createdAt, id)，与存储层的排序一致 */
  function isAfterCursor(rec, cursor) {
    if (!cursor) return true;
    const t = Number(rec && rec.createdAt) || 0;
    const ct = Number(cursor.createdAt) || 0;
    if (t !== ct) return t > ct;
    return String((rec && rec.id) || '') > String(cursor.id || '');
  }

  function compareRecords(a, b) {
    const ta = Number(a && a.createdAt) || 0;
    const tb = Number(b && b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    const ia = String((a && a.id) || '');
    const ib = String((b && b.id) || '');
    return ia < ib ? -1 : (ia > ib ? 1 : 0);
  }

  /** 助手原文去掉思维链与动作标记，只留执行员看得到的话。只删除标记，不解析，不弹提示 */
  function visibleAssistantText(raw) {
    let s = String(raw || '');
    const win = typeof window !== 'undefined' ? window : {};
    const core = win.AssistantChatCore;
    if (core && typeof core.stripThinkingFromContext === 'function') {
      s = core.stripThinkingFromContext(s);
    } else {
      s = s.replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?\s*>/gi, '');
    }
    // 不能用 AssistantChatCore.extractAssistantActions：它会解析 JSON，
    // 遇到历史记录里写坏的动作标记就弹「助手动作指令格式不合法」。
    const md = win.RetroflowMarkdown;
    if (md && typeof md.stripActionMarkers === 'function') {
      s = md.stripActionMarkers(s);
    } else {
      s = s.replace(/<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>/gi, '').replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '');
    }
    return s.trim();
  }

  /** 一条消息的正文。图片用识图描述代替，文件只写文件名 */
  function messageBody(rec) {
    if (rec.messageType === 'image') {
      const desc = rec.imageRef && rec.imageRef.visionDescription
        ? String(rec.imageRef.visionDescription).trim()
        : '';
      return desc ? `[图片] ${desc}` : '[图片]';
    }
    if (rec.messageType === 'file') {
      const names = (Array.isArray(rec.fileRefs) ? rec.fileRefs : [])
        .map((f) => String((f && f.name) || '').trim())
        .filter(Boolean);
      return names.length ? `[文件] ${names.join('、')}` : '[文件]';
    }
    if (rec.messageType === 'assistant-image') {
      const prompt = String((rec.genImageRef && rec.genImageRef.prompt) || rec.content || '').trim();
      return prompt ? `[生成的图片] ${prompt}` : '[生成的图片]';
    }
    let text = rec.role === 'assistant' ? visibleAssistantText(rec.content) : String(rec.content || '').trim();
    // 旧版图片消息：识图描述挂在文字消息上
    if (rec.imageRef && rec.imageRef.visionDescription) {
      text = [`[图片] ${String(rec.imageRef.visionDescription).trim()}`, text].filter(Boolean).join(' ');
    }
    const quote = rec.quote && rec.quote.text ? String(rec.quote.text).trim() : '';
    if (quote && text) text = `（引用：${quote}）${text}`;
    return text;
  }

  /**
   * 格式化成一行：[时间] 说话人：内容。没有内容时返回空串。
   * 每行一条，正文里的换行合并成空格，evidence 才能逐行照抄。
   */
  function formatLine(rec, names) {
    const body = messageBody(rec).replace(/\s*\n+\s*/g, ' ').trim();
    if (!body) return '';
    const speaker = rec.role === 'assistant' ? names.ASST_NAME : names.ENVOY_NAME;
    return `[${formatTime(rec.createdAt)}] ${speaker}：${body}`;
  }

  /**
   * 把时间升序的消息切成轮。连续的执行员消息算一问，随后连续的助手消息算一答。
   * 开头就是助手消息时单独成一轮。
   * @returns {Array<{records: Array, hasAsk: boolean, hasAnswer: boolean}>}
   */
  function splitTurns(records) {
    const turns = [];
    let cur = null;
    (records || []).forEach((rec) => {
      const isUser = rec.role === 'user';
      if (!cur || (isUser && cur.hasAnswer)) {
        cur = { records: [], hasAsk: false, hasAnswer: false };
        turns.push(cur);
      }
      cur.records.push(rec);
      if (isUser) cur.hasAsk = true;
      else cur.hasAnswer = true;
    });
    return turns;
  }

  /**
   * 计算当前窗口的提取计划。
   * @param {Array} allRecords 窗口内全部流水（任意顺序）
   * @param {{createdAt:number,id:string}|null} cursor 进度点
   * @param {number} interval 提取频率 N
   * @param {{ASST_NAME:string, ENVOY_NAME:string}} names
   */
  function planChunk(allRecords, cursor, interval, names) {
    const messages = (allRecords || []).filter(isChatMessage).slice().sort(compareRecords);
    const pending = messages.filter((r) => isAfterCursor(r, cursor));

    const lineOf = new Map();
    let pendingTokens = 0;
    pending.forEach((r) => {
      const line = formatLine(r, names);
      lineOf.set(r, line);
      if (line) pendingTokens += estimateTokens(line);
    });

    const turns = splitTurns(pending).map((t) => {
      const lines = t.records.map((r) => lineOf.get(r)).filter(Boolean);
      return Object.assign(t, {
        lines,
        tokens: lines.reduce((s, l) => s + estimateTokens(l), 0)
      });
    });

    // 最后一问还没有回复：这一轮等回复后一起提取
    let ready = turns;
    let waitingReply = false;
    const last = turns[turns.length - 1];
    if (last && last.hasAsk && !last.hasAnswer) {
      ready = turns.slice(0, -1);
      waitingReply = true;
    }
    const readyTokens = ready.reduce((s, t) => s + t.tokens, 0);

    const limit = Math.max(MIN_INTERVAL, Number(interval) || DEFAULT_INTERVAL);
    const chunk = [];
    let chunkTokens = 0;
    for (const t of ready) {
      if (chunk.length && chunkTokens + t.tokens > limit) break;
      chunk.push(t);
      chunkTokens += t.tokens;
    }
    const chunkRecords = [];
    chunk.forEach((t) => chunkRecords.push.apply(chunkRecords, t.records));
    const lastRec = chunkRecords[chunkRecords.length - 1] || null;

    return {
      totalMessages: messages.length,
      pendingMessages: pending.length,
      pendingTokens,
      readyTokens,
      waitingReply,
      interval: limit,
      chunk: {
        turns: chunk.length,
        messages: chunkRecords.length,
        tokens: chunkTokens,
        lines: chunk.reduce((acc, t) => acc.concat(t.lines), []),
        cursor: lastRec ? { createdAt: Number(lastRec.createdAt) || 0, id: String(lastRec.id || '') } : null
      }
    };
  }

  /* ======================= 运行环境依赖 ======================= */

  function getSettings() {
    const s = window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function'
      ? SystemChatSettings.getSettings()
      : {};
    const interval = parseInt(s.memoryTokenInterval, 10);
    const minCount = parseInt(s.memoryMinCount, 10);
    return {
      autoMemory: s.autoMemory !== false,
      interval: Number.isFinite(interval) && interval >= MIN_INTERVAL ? interval : DEFAULT_INTERVAL,
      minCount: Number.isFinite(minCount) && minCount >= 1 ? minCount : 20
    };
  }

  function currentForkId() {
    if (window.SystemChatUI && typeof SystemChatUI.getCurrentForkId === 'function') {
      const id = SystemChatUI.getCurrentForkId();
      if (id) return id;
    }
    return window.SystemChatStore ? SystemChatStore.forkIdOf(SystemChatStore.LEGACY_CONV_ID) : 'system-chat:main';
  }

  function convIdOf(forkId) {
    const prefix = window.SystemChatStore ? SystemChatStore.FORK_PREFIX : 'system-chat:';
    return String(forkId || '').startsWith(prefix) ? String(forkId).slice(prefix.length) : '';
  }

  function cursorKeyOf(forkId) {
    const convId = convIdOf(forkId);
    if (!convId) return '';
    return window.SystemChatStore && typeof SystemChatStore.memCursorKey === 'function'
      ? SystemChatStore.memCursorKey(convId)
      : `sysChat/memcursor.${convId}`;
  }

  /** 读取进度点。读取失败抛错，避免把失败当成「从未提取」而重复提取全部记录 */
  async function readCursor(forkId) {
    const key = cursorKeyOf(forkId);
    if (!key) throw new Error('对话窗口无效');
    if (typeof Storage.getDocOrThrow !== 'function') throw new Error('存储模块版本过旧');
    const raw = await Storage.getDocOrThrow(key);
    if (!raw || typeof raw !== 'object') return null;
    const createdAt = Number(raw.createdAt);
    if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
    return { createdAt, id: String(raw.id || '') };
  }

  async function loadRecords(forkId) {
    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') throw new Error('存储模块不可用');
    return (await Storage.getRecordsByFork(forkId)) || [];
  }

  /** 是否有回复正在生成（助手页、DECK 舱、重写） */
  function isReplying() {
    if (window.AssistantChatCore && typeof AssistantChatCore.isBusy === 'function' && AssistantChatCore.isBusy()) return true;
    if (window.SystemChatUI && typeof SystemChatUI.isInferring === 'function' && SystemChatUI.isInferring()) return true;
    return false;
  }

  function resolveModel() {
    if (window.RetroflowApiUI && typeof RetroflowApiUI.resolveSlot === 'function') {
      return RetroflowApiUI.resolveSlot('assistant');
    }
    if (window.SystemChatPrompt && typeof SystemChatPrompt.resolveConfig === 'function') {
      return SystemChatPrompt.resolveConfig();
    }
    return null;
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (_) { /* ignore */ }
  }

  function toast(opts) {
    if (window.RetroToast && typeof RetroToast.show === 'function') RetroToast.show(opts);
  }

  /* ======================= 单次提取 ======================= */

  /**
   * 提取一段。调用方须已持有锁。
   * @returns {Promise<object>} { ok, reason, message, added, dropped, rejected, messages, tokens }
   */
  async function runChunk(forkId) {
    const fail = (reason, message) => ({ ok: false, reason, message });

    if (!window.AssistantMemoryParser || !window.AssistantMemoryStore || !window.AssistantMemoryPrompt || !window.RetroflowAPI) {
      return fail('deps', '记忆提取模块未加载完整');
    }
    if (isReplying()) return fail('replying', '助手正在回复，回复结束后再提取');

    const settings = getSettings();
    const names = AssistantMemoryPrompt.resolveNames();

    let cursor;
    try {
      cursor = await readCursor(forkId);
    } catch (err) {
      return fail('cursor', `读取提取进度失败：${(err && err.message) || err}`);
    }

    let records;
    try {
      records = await loadRecords(forkId);
    } catch (err) {
      return fail('records', `读取聊天记录失败：${(err && err.message) || err}`);
    }

    const plan = planChunk(records, cursor, settings.interval, names);
    if (!plan.chunk.turns || !plan.chunk.cursor) {
      return plan.waitingReply
        ? fail('waiting', '最后一条消息还在等助手回复，回复后再提取')
        : fail('empty', '没有未提取的消息');
    }

    const config = resolveModel();
    if (!config || !config.baseUrl || !config.modelId) {
      return fail('config', '没有可用的模型，请先配置辅助推理模型或主模型');
    }

    let reply;
    try {
      const messages = AssistantMemoryPrompt.build(plan.chunk.lines.join('\n'), {
        ASST_NAME: names.ASST_NAME,
        ENVOY_NAME: names.ENVOY_NAME,
        MIN_COUNT: settings.minCount
      });
      reply = await RetroflowAPI.chat(config, messages, { logTag: LOG_TAG });
    } catch (err) {
      return fail('api', `模型请求失败：${(err && err.message) || err}`);
    }

    const content = String((reply && reply.content) || '');
    const reasoning = String((reply && reply.reasoning) || '');
    let parsed = AssistantMemoryParser.parse(content);
    // 部分思考模型把正文写进 reasoning
    if (!parsed.ok && reasoning) {
      const fromReasoning = AssistantMemoryParser.parse(`${reasoning}\n${content}`);
      if (fromReasoning.ok) parsed = fromReasoning;
    }
    if (!parsed.ok) return fail('parse', `模型输出无法解析：${parsed.error}`);

    // 进度点只前进不后退
    const next = plan.chunk.cursor;
    if (cursor && !isAfterCursor(next, cursor)) return fail('cursor', '提取进度异常，已停止');

    let result;
    try {
      await AssistantMemoryStore.load();
      result = await AssistantMemoryStore.addMany(parsed.memories, {
        source: 'auto',
        docs: [{ key: cursorKeyOf(forkId), value: { createdAt: next.createdAt, id: next.id, updatedAt: Date.now() } }]
      });
    } catch (err) {
      return fail('store', `写入记忆失败：${(err && err.message) || err}`);
    }

    const out = {
      ok: true,
      reason: 'done',
      added: result.added.length,
      removed: result.removed.length,
      dropped: parsed.dropped.length,
      rejected: result.rejected.length,
      messages: plan.chunk.messages,
      tokens: plan.chunk.tokens
    };
    if (parsed.dropped.length || parsed.warnings.length || result.rejected.length) {
      console.info('[AssistantMemoryExtractor] 提取完成，部分记录被丢弃或有提示：', {
        dropped: parsed.dropped, warnings: parsed.warnings, rejected: result.rejected
      });
    }
    emit('retroflow:assistant-memory-extracted', { forkId, added: out.added });
    return out;
  }

  /* ======================= 锁与对外接口 ======================= */

  let running = null;
  let autoPending = false;
  let autoTimer = null;

  function isRunning() {
    return Boolean(running);
  }

  async function withLock(task) {
    if (running) return { ok: false, reason: 'locked', message: '正在提取记忆，请稍后' };
    const p = (async () => task())();
    running = p;
    emit('retroflow:assistant-memory-extract-state', { running: true });
    try {
      return await p;
    } finally {
      running = null;
      emit('retroflow:assistant-memory-extract-state', { running: false });
      if (autoPending) {
        autoPending = false;
        scheduleAuto();
      }
    }
  }

  /** 手动提取：只提取一段（最旧的 N tk，不足就到最新） */
  function extractOnce(forkId) {
    const id = forkId || currentForkId();
    return withLock(() => runChunk(id));
  }

  /** 自动提取：可提取量 ≥ N 时逐段提取，失败一次就停止 */
  async function runAutoQueue() {
    const forkId = currentForkId();
    let added = 0;
    let rounds = 0;
    while (true) {
      const settings = getSettings();
      if (!settings.autoMemory || isReplying()) break;

      let plan;
      try {
        const cursor = await readCursor(forkId);
        const records = await loadRecords(forkId);
        plan = planChunk(records, cursor, settings.interval, AssistantMemoryPrompt.resolveNames());
      } catch (err) {
        console.warn('[AssistantMemoryExtractor] 自动提取前读取失败：', err);
        break;
      }
      if (plan.readyTokens < settings.interval) break;

      const res = await runChunk(forkId);
      if (!res.ok) {
        // 正在回复属于正常让路，不算失败
        if (res.reason !== 'replying') {
          toast({ tag: 'MEMORY // 自动提取失败', message: `${res.message}。已停止排队，下次回复后重试`, type: 'warn', duration: 4200 });
        }
        break;
      }
      added += res.added;
      rounds += 1;
    }
    if (rounds) {
      toast({
        tag: 'MEMORY // 自动提取',
        message: added ? `已整理 ${rounds} 段对话，新增 ${added} 条记忆` : `已整理 ${rounds} 段对话，没有需要记住的内容`,
        type: 'info'
      });
    }
    return { ok: true, rounds, added };
  }

  function scheduleAuto() {
    if (autoTimer) clearTimeout(autoTimer);
    autoTimer = setTimeout(() => {
      autoTimer = null;
      if (!getSettings().autoMemory) return;
      if (running) {
        autoPending = true;
        return;
      }
      withLock(runAutoQueue).catch((err) => console.warn('[AssistantMemoryExtractor] 自动提取异常：', err));
    }, AUTO_DELAY_MS);
  }

  /** 统计当前窗口：总消息数、未提取条数与 token 数 */
  async function getStats(forkId) {
    const id = forkId || currentForkId();
    const settings = getSettings();
    const cursor = await readCursor(id);
    const records = await loadRecords(id);
    const plan = planChunk(records, cursor, settings.interval, AssistantMemoryPrompt.resolveNames());
    return {
      total: plan.totalMessages,
      pending: plan.pendingMessages,
      pendingTokens: plan.pendingTokens,
      readyTokens: plan.readyTokens,
      interval: plan.interval
    };
  }

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('retroflow:assistant-reply-settled', scheduleAuto);
  }

  return {
    // 对外接口
    extractOnce,
    getStats,
    isRunning,
    scheduleAuto,
    // 纯函数，供测试
    formatTime,
    formatLine,
    splitTurns,
    planChunk,
    isAfterCursor
  };
})();

if (typeof window !== 'undefined') window.AssistantMemoryExtractor = AssistantMemoryExtractor;
if (typeof module !== 'undefined' && module.exports) module.exports = AssistantMemoryExtractor;