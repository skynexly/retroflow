/**
 * 溯流计划 · 线上私聊消息落库 (Online Chat Store)
 *
 * 职责：
 *   1. 私聊消息的写入、读取与删除，落在 IndexedDB 的 records 表
 *   2. 会话摘要（lastMessage / lastMessageAt / unread）同步维护
 *   3. 消息数组 → API 上下文的角色映射
 *
 * forkId 规则沿用 OnlineStore.forkIdOf：online:{accountId}:{contactId}
 * 这样级联删除（purgeContacts / purgeByAccountId）能按前缀一次清干净，
 * 无需本模块额外注册清理钩子。
 *
 * role 用 envoy / char 而非 user / assistant：私聊双方都是执行员，
 * 用 user/assistant 在角色扮演语境里会误导。请求时才映射成 API 角色。
 */
window.OnlineChatStore = (() => {
  'use strict';

  /** 消息流水的 kind，与助手页的 system_chat_message 区分开 */
  const RECORD_KIND = 'online_chat_message';

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function trimStr(v) {
    return v == null ? '' : String(v).trim();
  }

  function makeRecordId() {
    return `ochat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /** forkId 构造。OnlineStore 已有同名内部函数，这里保持同一规则 */
  /** forkId 构造。OnlineStore 已有同名内部函数，这里保持同一规则 */
  function forkIdOf(accountId, contactId) {
    return `online:${accountId}:${contactId}`;
  }

  function getEnvoyName() {
    try {
      const identityName = window.Store && Store.envoy && Store.envoy.identity
        ? trimStr(Store.envoy.identity.name)
        : '';
      const cardName = window.Store && Store.decor
        ? trimStr(Store.decor.cardName)
        : '';
      return identityName || cardName || '执行员';
    } catch (_) {
      return '执行员';
    }
  }

  /* ================= 写入 ================= */

  /**
   * 落一条私聊消息。
   * @param {Object} params
   * @param {string} params.accountId 登录账号：'persona' 或马甲 id
   * @param {string} params.contactId 联系人记录 id（不是角色档案 id）
   * @param {'envoy'|'char'} params.role 发送方
     * @param {'text'|'voice'|'notice'|'image'} [params.type] 消息形态，缺省 text
     * @param {string} params.content
   * @param {boolean} [params.isVerifyMsg] 是否为好友申请的验证消息
   * @param {string} [params.recordId] 指定 id，用于重写既有记录
   * @param {number} [params.createdAt]
   * @returns {Promise<Object|null>} 落库后的记录，失败返回 null
   */
  async function putMessage(params) {
    if (!window.Storage || typeof Storage.putRecord !== 'function') return null;
    const p = params || {};
    if (!p.accountId || !p.contactId) return null;

    const record = {
      id: p.recordId || makeRecordId(),
      kind: RECORD_KIND,
      forkId: forkIdOf(p.accountId, p.contactId),
      accountId: p.accountId,
      contactId: p.contactId,
      role: p.role === 'envoy' ? 'envoy' : (p.role === 'system' ? 'system' : 'char'),
      messageType: p.type === 'voice' ? 'voice' : (p.type === 'notice' ? 'notice' : (p.type === 'image' ? 'image' : (p.type === 'file' ? 'file' : 'text'))),
      content: String(p.content == null ? '' : p.content),
      quote: p.quote && p.quote.text ? { ...p.quote } : null,
      messageGroupId: p.messageGroupId || null,
      imageRef: p.imageRef ? { ...p.imageRef } : null,
      fileRefs: Array.isArray(p.fileRefs) ? p.fileRefs.map((f) => ({ id: f.id, name: f.name, sizeText: f.sizeText, charCount: f.charCount })) : [],
      // 验证消息在气泡上要带专属标记，落库时就标记好，渲染时不必再猜
      isVerifyMsg: !!p.isVerifyMsg,
      createdAt: p.createdAt || Date.now()
    };

    try {
      await Storage.putRecord(record);
    } catch (err) {
      console.warn('[OnlineChatStore] 消息落库失败：', err);
      return null;
    }
    return record;
  }

  /* ================= 读取 ================= */

  /**
   * 读取一个会话的全部消息，按时间正序。
   * 只取 online_chat_message 这一种 kind，其它流水（未来的通知卡等）不混进来。
   * @returns {Promise<Array>}
   */
  async function listMessages(accountId, contactId) {
    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') return [];
    if (!accountId || !contactId) return [];
    try {
      const all = await Storage.getRecordsByFork(forkIdOf(accountId, contactId));
      return asArray(all)
        .filter((r) => r && r.kind === RECORD_KIND)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    } catch (err) {
      console.warn('[OnlineChatStore] 读取消息失败：', err);
      return [];
    }
  }

  /* ================= 删除 ================= */

  /** 删除指定 id 的若干条消息，返回实际删除条数 */
  async function removeMessages(recordIds) {
    if (!window.Storage || typeof Storage.removeRecord !== 'function') return 0;
    const initialIds = Array.from(new Set(asArray(recordIds).filter(Boolean).map(String)));
    if (!initialIds.length) return 0;
    let ids = initialIds;
    if (typeof Storage.getRecordsByFork === 'function') {
      const records = asArray(typeof Storage.getAllRecords === 'function'
        ? await Storage.getAllRecords().catch(() => [])
        : []);
      const seedRecords = records.filter(r => r && initialIds.includes(String(r.id)));
      const forkIds = new Set(seedRecords.map(r => String(r.forkId || '')).filter(Boolean));
      const groups = new Set(seedRecords.filter(r => r.messageGroupId).map(r => String(r.messageGroupId)));
      ids = Array.from(new Set(records
        .filter(r => r && forkIds.has(String(r.forkId || ''))
          && (initialIds.includes(String(r.id)) || (r.messageGroupId && groups.has(String(r.messageGroupId)))))
        .map(r => String(r.id))));
    }
    if (window.GalleryStore && typeof GalleryStore.removeByChatRecordIds === 'function') {
      await GalleryStore.removeByChatRecordIds(ids);
    }
    let count = 0;
    for (const id of ids) {
      try { await Storage.removeRecord(id); count++; } catch (_) { /* 单条失败不阻断其余 */ }
    }
    return count;
  }

  /**
   * 回溯：删掉指定消息及其之后的所有消息。
   * @returns {Promise<number>} 删除条数
   */
  async function truncateFrom(accountId, contactId, recordId) {
    const list = await listMessages(accountId, contactId);
    const idx = list.findIndex((r) => r && r.id === recordId);
    if (idx < 0) return 0;
    return await removeMessages(list.slice(idx).map((r) => r.id));
  }

  /* ================= 会话摘要 ================= */

  /**
   * 摘要文案：语音消息在列表里显示为 [语音]，与常见平台一致。
   */
  function summarize(record) {
    if (!record) return '';
    if (record.messageType === 'voice') return '[语音]';
    if (record.messageType === 'image') return '[图片]';
    if (record.messageType === 'file') return `[文件] ${record.fileRefs && record.fileRefs.length ? record.fileRefs.map((f) => f.name).join('、') : ''}`;
    return trimStr(record.content).replace(/\s+/g, ' ');
  }

  /**
   * 把会话元数据同步到最新一条消息。
   * @param {string} accountId
   * @param {string} contactId
   * @param {Object} lastRecord 最新一条消息
   * @param {Object} [opts]
   * @param {number} [opts.unreadDelta] 未读增量，正数累加，0 或缺省不变
   * @param {boolean} [opts.clearUnread] 置为已读
   */
  async function syncSession(accountId, contactId, lastRecord, opts) {
    if (!window.OnlineStore) return;
    const o = opts || {};
    try {
      const session = typeof OnlineStore.ensureSession === 'function'
        ? await OnlineStore.ensureSession(accountId, contactId)
        : null;
      if (!session || typeof OnlineStore.updateSession !== 'function') return;

      const patch = {};
      if (lastRecord) {
        patch.lastMessage = summarize(lastRecord);
        patch.lastMessageAt = lastRecord.createdAt || Date.now();
      }
      if (o.clearUnread) {
        patch.unread = 0;
      } else if (o.unreadDelta) {
        patch.unread = Math.max(0, (Number(session.unread) || 0) + Number(o.unreadDelta));
      }
      await OnlineStore.updateSession(session.id, patch);
    } catch (err) {
      console.warn('[OnlineChatStore] 会话摘要同步失败：', err);
    }
  }

  /** 单独把某会话标记为已读 */
  async function markRead(accountId, contactId) {
    if (!window.OnlineStore || typeof OnlineStore.findSession !== 'function') return;
    try {
      const session = OnlineStore.findSession(accountId, contactId);
      if (session && Number(session.unread) > 0 && typeof OnlineStore.updateSession === 'function') {
        await OnlineStore.updateSession(session.id, { unread: 0 });
      }
    } catch (_) { /* ignore */ }
  }

  /* ================= API 上下文 ================= */

  const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  /**
   * 把时间戳格成消息时间前缀。格式与助手页完全一致，
   * 这样两侧共用同一份「模型复述时间」的裁剪正则，不必各写一套。
   * @param {number} value 时间戳
   * @returns {string} 形如「[消息时间：2026年09月08日 10:47 星期二]」，无效时间返回空串
   */
  function timeStampOf(value) {
    const ts = Number(value);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `[消息时间：${y}年${mo}月${day}日 ${h}:${mi} ${WEEKDAYS_ZH[d.getDay()]}]`;
  }

  /**
   * 把单条记录渲染成上下文文本行。
   *
   * 拆出这一步是为了让 token 成本算得准：文件内联、图片画面描述、引用段
   * 都是渲染时才产生的，它们的体量远大于 record.content 本身。按原始
   * content 估算预算会严重低估，一条内联文件就能把预算冲爆。
   *
   * 不含时间戳前缀、不做同角色合并 —— 那两件事属于装配阶段。
   *
   * @param {Object} r 单条消息记录
   * @param {Object} ctx 渲染上下文
   * @param {Object} ctx.latestFileRecord 最新的那条带文件的用户消息（只有它内联全文）
   * @param {Object} ctx.fileScope 文件读取作用域
   * @param {number} ctx.inlineLimit 单文件内联字符上限
   * @param {Array} ctx.allRecords 全量记录，供引用按 recordId 回查（被引用目标可能已滚出上下文）
   * @param {boolean} [ctx.skipFileInline] 跳过文件正文内联，只留文件名占位。
   *        供「探测装配」用：世界书关键词判定与提示词生成都不看文件正文，
   *        为它去读一遍 IndexedDB 纯属浪费。
   * @returns {Promise<{role: string, content: string}|null>}
   */
  async function renderRecordLine(r, ctx) {
    if (!r) return null;
    const { latestFileRecord, fileScope, inlineLimit, allRecords } = ctx;

    // 撤回是 Retroflow 平台事件：让模型知道发生过，但不要伪装成用户发言。
    // 只使用当前用户档案真名，不读取通知记录里可能遗留的旧显示名。
    if (r.role === 'system' || r.messageType === 'notice') {
      return {
        role: 'system',
        content: `Retroflow聊天页面：「${getEnvoyName()}」撤回了一条消息`
      };
    }

    const isChar = r.role === 'char';
    const apiRole = isChar ? 'assistant' : 'user';

    let line = trimStr(r.content);
    if (!isChar && r.messageType === 'file' && Array.isArray(r.fileRefs) && r.fileRefs.length) {
      if (r !== latestFileRecord || ctx.skipFileInline) {
        line = r.fileRefs.map((f) => `[已发送文件：${f.name}（内容已释放）]`).join('\n');
      } else {
        const parts = [];
        for (const f of r.fileRefs) {
          const name = String(f.name || '未命名文件');
          const text = window.FileStore && typeof FileStore.getText === 'function'
            ? await FileStore.getText(f.id, fileScope)
            : null;
          if (text == null) {
            parts.push(`[用户发送的文件]\n文件 ID：${f.id}\n文件名：${name}\n内容：（文件已从当前私聊文件区删除，无法读取）`);
            continue;
          }
          const body = text.length > inlineLimit ? text.slice(0, inlineLimit) : text;
          const note = text.length > inlineLimit
            ? `\n（内容过长，此处仅注入前 ${inlineLimit} 字符，共 ${text.length} 字符）`
            : '';
          parts.push(`[用户发送的文件]\n文件 ID：${f.id}\n文件名：${name}\n内容：\n${body}${note}`);
        }
        line = parts.join('\n\n');
      }
    }
    if (!isChar && r.messageType === 'image' && r.imageRef && trimStr(r.imageRef.visionDescription)) {
      line = `[用户发送的图片]\n图片内容：${trimStr(r.imageRef.visionDescription)}${line ? `\n${line}` : ''}`;
    }

    // 对方侧带回格式标记，让模型看清自己上一轮的输出格式。
    // 本人侧原则上是纯粹的用户输入，不加标记——但语音是例外：
    // 打字发出的「语音条」在现实里是说出口的话，模型必须知道这个区别，
    // 否则它会把一段语气很口语的话当成打字，回应的节奏就不对了。
    if (isChar) {
      if (r.messageType === 'image') {
        // 对方自己发过的图：用它当初写的画面描述回灌，并还原成 [图片] 标记，
        // 这样它能看清自己发过什么、也记得这套标记的写法。
        // content 恒为空，描述全在 imageRef.visionDescription 里。
        const desc = trimStr(r.imageRef && r.imageRef.visionDescription);
        line = `[图片]${desc || '（画面描述已丢失）'}`;
      } else {
        line = `[${r.messageType === 'voice' ? '语音' : '文本'}]${line}`;
      }
    } else if (r.messageType === 'voice') {
      line = `[语音]${line}`;
    } else if (r.isVerifyMsg) {
      // 验证消息在上下文里点明来源，避免模型把它当成普通聊天
      line = `（好友申请验证消息）${line}`;
    }

    // 引用段落必须在所有格式标记（[文本]/[语音]/[图片]）包裹完成之后再拼。
    // 放在前面会被后续的前缀包裹和整体覆写吃掉：
    // 对方发图那条是 line = `[图片]…` 直接重写，引用会整段丢失。
    if (r.quote && r.quote.text) {
      const quoteSender = trimStr(r.quote.senderName) || (r.quote.role === 'char' ? '对方' : '执行员');
      // 引用图片时，quote.text 存的是给人看的「[图片]」标签，对模型没有信息量。
      // 靠 recordId 回查那条图片记录的画面描述，模型才知道被引用的是哪张图。
      // 回查走全量记录而非裁剪后的：被引的那条可能已经滚出上下文，
      // 但引用卡还挂在保留的消息上，此时更要把画面描述补回去。
      let quoteBody = trimStr(r.quote.text);
      if (r.quote.recordId) {
        const target = asArray(allRecords).find((x) => x && x.id === r.quote.recordId);
        if (target && target.messageType === 'image') {
          const desc = trimStr(target.imageRef && target.imageRef.visionDescription);
          quoteBody = desc ? `[图片]${desc}` : '[图片]（画面描述已丢失）';
        }
      }
      if (quoteBody) {
        line = `[引用自「${quoteSender}」的历史消息]\n${quoteBody}\n[/引用]\n${line}`;
      }
    }

    return { role: apiRole, content: line };
  }

  /**
   * 把消息流水映射成 API 消息数组。
   *
   * 角色映射：char（对方，也就是模型扮演的人）→ assistant，envoy（用户）→ user。
   * 对方的多条消息要合并成一条 assistant，否则连续多个 assistant 会让部分
   * 服务端报错；合并时保留 [文本]/[语音] 标记，这样模型能看清自己上次的输出格式。
   *
   * limit 是条数硬截断，仅供不关心预算的旧链路使用。走 token 预算的链路
   * 应该先用 ContextBudget 裁剪出记录子集，再把子集连同 allRecords 传进来。
   *
   * @param {Array} records 要注入的记录（已裁剪或全量）
   * @param {number} [limit] 只取最近若干条，缺省不限
   * @param {Object} [scope] 文件读取作用域
   * @param {boolean} [withTime] 是否给每组消息加 [消息时间：…] 前缀（时间感知开关）
   * @param {Array} [allRecords] 全量记录，供引用回查；缺省用 records 自身
   * @param {Object} [renderOpts] 渲染开关，目前支持 { skipFileInline }
   * @returns {Array<{role: string, content: string}>}
   */
  async function toApiMessages(records, limit, scope, withTime, allRecords, renderOpts) {
    const list = asArray(records);
    const sliced = (limit && limit > 0 && list.length > limit)
      ? list.slice(-limit)
      : list;

    const ctx = {
      latestFileRecord: [...sliced].reverse().find((r) => r && r.role === 'envoy' && r.messageType === 'file' && Array.isArray(r.fileRefs) && r.fileRefs.length),
      inlineLimit: 60000,
      fileScope: scope || { type: 'system', id: 'system' },
      allRecords: asArray(allRecords).length ? allRecords : list,
      skipFileInline: !!(renderOpts && renderOpts.skipFileInline)
    };

    const out = [];
    for (const r of sliced) {
      const rendered = await renderRecordLine(r, ctx);
      if (!rendered) continue;
      const prev = out[out.length - 1];
      if (prev && prev.role === rendered.role) {
        prev.content += '\n' + rendered.content;
      } else {
        // 消息时间前缀只在一组的首条上加：对方连发会合并成一条 assistant，
        // 每行都插时间会把气泡节奏读成断裂的多轮对话。
        const stamp = withTime ? timeStampOf(r.createdAt) : '';
        out.push({ role: rendered.role, content: stamp ? `${stamp}\n${rendered.content}` : rendered.content });
      }
    }
    return out;
  }

  /**
   * 按 token 预算装配 API 消息。
   *
   * 与 toApiMessages 的区别是装填单位：这里以「轮」为原子，按预算从新到旧
   * 装填，而不是按条数一刀切。切口永远落在轮边界上，模型不会读到半轮对话。
   *
   * 成本估算走真实渲染后的文本（含内联文件、图片描述、引用段与时间戳），
   * 所以要先渲染再算账。为此每条只渲染一次，结果缓存在 rendered 里复用。
   *
   * @param {Array} records listMessages 的结果（全量，正序）
   * @param {Object} options
   * @param {number} options.budget 可用于历史的 token 预算
   * @param {Object} [options.scope] 文件读取作用域
   * @param {boolean} [options.withTime] 是否加消息时间前缀
   * @returns {Promise<{messages: Array, records: Array, meta: Object}>}
   */
  async function toBudgetedApiMessages(records, options) {
    const opts = options || {};
    const list = asArray(records).filter(Boolean);
    const budget = Number.isFinite(opts.budget) ? opts.budget : 0;

    const ctx = {
      latestFileRecord: [...list].reverse().find((r) => r && r.role === 'envoy' && r.messageType === 'file' && Array.isArray(r.fileRefs) && r.fileRefs.length),
      inlineLimit: 60000,
      fileScope: opts.scope || { type: 'system', id: 'system' },
      allRecords: list
    };

    // 先整体渲染一遍。文件内联要读 IndexedDB，重复渲染既慢也可能不一致。
    const rendered = new Map();
    for (const r of list) {
      rendered.set(r, await renderRecordLine(r, ctx));
    }

    const budgetApi = window.ContextBudget;
    if (!budgetApi || typeof budgetApi.fitRecordsToBudget !== 'function') {
      // 裁剪器缺失时退回全量，宁可请求偏大也不静默丢历史
      const messages = await toApiMessages(list, 0, ctx.fileScope, opts.withTime, list);
      return { messages, records: list, meta: { fallback: true, totalRecords: list.length, keptRecords: list.length } };
    }

    // 单轮成本 = 该轮每条渲染文本的 token 之和；时间戳只有组首条会加，
    // 这里按每条都加算，宁可高估也不要装超。
    const stampCost = opts.withTime ? budgetApi.estimateTokens('[消息时间：2042年03月15日 21:47 星期六]') : 0;
    const costOf = (turn) => turn.reduce((sum, r) => {
      const item = rendered.get(r);
      return sum + budgetApi.estimateMessageTokens(item) + stampCost;
    }, 0);

    const fitted = budgetApi.fitRecordsToBudget(list, { budget, costOf });
    // 装配阶段仍走 toApiMessages，确保合并与时间戳规则只有一份实现。
    const messages = await toApiMessages(fitted.records, 0, ctx.fileScope, opts.withTime, list);

    return { messages, records: fitted.records, meta: fitted.meta };
  }

  /* ================= 公共接口 ================= */

  return {
    RECORD_KIND,
    forkIdOf,
    putMessage,
    listMessages,
    removeMessages,
    truncateFrom,
    syncSession,
    markRead,
    summarize,
    toApiMessages,
    toBudgetedApiMessages
  };
})();
