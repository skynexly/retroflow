/**
 * 溯流计划 · 世界书注入引擎 (WorldBook Injection Engine)
 *
 * 职责：
 *   1. 从 Store.worldbook 读取书本与条目，筛出当前应生效的内容；
 *   2. 常驻条目无条件生效；关键词条目交给 KeyMatch 判定（支持子串 / 正则 / 全词精确）；
 *   3. 按注入位置分组：系统顶部 / 系统底部产出文本段，深度注入产出待插消息项。
 *
 * 关于扫描范围：
 *   关键词判定只看最近 SCAN_MESSAGE_COUNT 条消息，不拿全量历史。
 *   一是符合「近期语境才触发」的直觉，二是限制正则的输入长度，
 *   避免用户写出灾难性回溯的模式时把主线程拖死。
 *
 * 关于深度注入：
 *   深度按「从消息数组末尾往前数的插入位置」计：
 *   深度 0 落在最新消息之后（最靠近模型），深度 1 落在最新消息之前，依此类推。
 *   必须在上下文裁剪完成后再插入，否则可能被裁掉。
 *   私聊上下文里同角色连发的气泡已在 toApiMessages 阶段合并成单条，
 *   数组天然 user/assistant 交替，所以按条数数深度等价于按对话轮次数。
 *
 * 关于书本级角色绑定：
 *   线上分类的书本可挂 bindRosterIds（角色档案 id 数组）。挂了就只对这些角色的
 *   私聊窗口生效，空数组或缺省视为对全部窗口生效。绑定的档案被删掉时匹配不上
 *   任何会话，自然不注入，id 保留着等用户换绑。
 */
const WorldBookEngine = (() => {
  'use strict';

  // 关键词扫描的消息条数（最近两轮往来 ≈ 4 条）
  const SCAN_MESSAGE_COUNT = 4;

  // 深度注入允许的深度上限（与 UI 滑条一致）
  const MAX_DEPTH = 10;

  // 深度注入允许的消息角色
  const VALID_ROLES = ['system', 'assistant', 'user'];

  /**
   * 书本是否落在当前作用域内。
   *
   * 两种绑定维度独立判定：
   *   - bindRosterIds：线上场景传 scope.rosterId（单个），副本场景传 scope.rosterIds（数组），
   *     有交集即通过。挂了但当前作用域无任何匹配角色 → 不通过。
   *   - bindForkIds：副本场景传 scope.forkId，命中即通过。
   *   - 两种都挂了 → 都得满足（AND）。
   *   - 都没挂 → 一律通过。
   *
   * @param {Object} book
   * @param {Object} [scope] { rosterId, rosterIds, forkId }
   * @returns {boolean}
   */
  function inScope(book, scope) {
    const s = scope || {};

    // --- 角色绑定判定 ---
    const bindRoster = Array.isArray(book.bindRosterIds) ? book.bindRosterIds.filter(Boolean) : [];
    let rosterOk = true;
    if (bindRoster.length > 0) {
      // scope.rosterId（线上单角色）或 scope.rosterIds（副本多角色）
      const ids = [];
      if (s.rosterId) ids.push(String(s.rosterId));
      if (Array.isArray(s.rosterIds)) s.rosterIds.forEach(function (v) { if (v) ids.push(String(v)); });
      if (ids.length === 0) {
        rosterOk = false;
      } else {
        rosterOk = bindRoster.some(function (bid) { return ids.indexOf(String(bid)) >= 0; });
      }
    }

    // --- 副本绑定判定 ---
    const bindFork = Array.isArray(book.bindForkIds) ? book.bindForkIds.filter(Boolean) : [];
    let forkOk = true;
    if (bindFork.length > 0) {
      const fid = s.forkId ? String(s.forkId) : '';
      forkOk = fid ? bindFork.some(function (bid) { return String(bid) === fid; }) : false;
    }

    return rosterOk && forkOk;
  }

  /**
   * 取出指定分类下所有启用书本的启用条目。
   * @param {string} category
   * @param {Object} [scope] 作用域，如 { rosterId, rosterIds, forkId } —— 用于书本级角色/副本绑定过滤。
   *   另可带 scope.wbOverrides = { disabledBookIds, disabledEntryIds }：会话级黑名单，
   *   命中的 book / entry 在本次装配中跳过（默认全空 = 完全遵从库自身开关）。
   */
  function collectEntries(category, scope) {
    const books = (window.Store && Store.worldbook && Array.isArray(Store.worldbook.books))
      ? Store.worldbook.books
      : [];

    const ov = (scope && scope.wbOverrides && typeof scope.wbOverrides === 'object')
      ? scope.wbOverrides : null;
    const offBooks = ov && Array.isArray(ov.disabledBookIds) ? ov.disabledBookIds : [];
    const offEntries = ov && Array.isArray(ov.disabledEntryIds) ? ov.disabledEntryIds : [];

    const out = [];
    books.forEach((book) => {
      if (!book || book.active === false) return;
      if (category && book.category !== category) return;
      if (!inScope(book, scope)) return;
      // 会话级黑名单：本世界线显式关掉的整本书跳过
      if (offBooks.length && offBooks.indexOf(book.id) >= 0) return;
      const entries = Array.isArray(book.entries) ? book.entries : [];
      entries.forEach((entry) => {
        if (!entry || entry.enabled === false) return;
        // 会话级黑名单：本世界线显式关掉的单条条目跳过
        if (offEntries.length && entry.id && offEntries.indexOf(entry.id) >= 0) return;
        const content = String(entry.content || '').trim();
        if (!content) return;
        out.push({ entry, content, bookName: book.name || '' });
      });
    });
    return out;
  }

  /**
   * 从消息数组尾部截取扫描文本。
   * @param {Array<{role:string, content:string}>} messages
   * @returns {string}
   */
  function buildScanText(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return '';
    return messages
      .slice(-SCAN_MESSAGE_COUNT)
      .map((m) => (m && typeof m.content === 'string' ? m.content : ''))
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 判定单个条目是否命中。
   * @returns {boolean}
   */
  function isActivated(entry, scanText) {
    // 常驻：无条件生效
    if (entry.mode !== 'keyword') return true;

    const keys = String(entry.keys || '').trim();
    if (!keys) return false;
    if (!scanText) return false;

    // 引擎缺失时保守处理：不注入，避免把关键词条目误当常驻塞进去
    if (!window.KeyMatch || typeof KeyMatch.test !== 'function') return false;

    const result = KeyMatch.test(keys, scanText);
    if (result.errors && result.errors.length) {
      result.errors.forEach((e) => {
        console.warn(`[WorldBook] 条目「${entry.title || '未命名'}」关键词有问题：${e.token} → ${e.error}`);
      });
    }
    return !!result.hit;
  }

  /** 规范化深度值：非法或缺失时回落 0，并夹在 0..MAX_DEPTH */
  function normalizeDepth(v) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return 0;
    return Math.min(MAX_DEPTH, Math.max(0, n));
  }

  /** 规范化注入角色：非法或缺失时回落 system */
  function normalizeRole(v) {
    const r = String(v || '').trim();
    return VALID_ROLES.indexOf(r) >= 0 ? r : 'system';
  }

  /**
   * 构建注入内容。
   * @param {Array} messages 对话消息数组（用于关键词判定，可空）
   * @param {string} category 分类，默认 global
   * @param {Object} [scope] 作用域，如 { rosterId } —— 传了才参与书本级绑定过滤
   * @returns {{ top: string, bottom: string, depthItems: Array, hitCount: number }}
   */
  function buildInjection(messages, category, scope) {
    const cat = category || 'global';
    const scanText = buildScanText(messages);
    const items = collectEntries(cat, scope);

    const topParts = [];
    const bottomParts = [];
    const depthItems = [];
    let hitCount = 0;

    items.forEach(({ entry, content }) => {
      if (!isActivated(entry, scanText)) return;
      hitCount++;

      if (entry.position === 'depth') {
        depthItems.push({
          depth: normalizeDepth(entry.depth),
          role: normalizeRole(entry.role),
          content
        });
      } else if (entry.position === 'sys-bottom') {
        bottomParts.push(content);
      } else {
        topParts.push(content);
      }
    });

    return {
      top: topParts.join('\n\n'),
      bottom: bottomParts.join('\n\n'),
      depthItems,
      hitCount
    };
  }

  /**
   * 把深度注入条目插进消息数组。
   *
   * 深度语义：从数组末尾往前数的插入位置。
   *   深度 0 → 插到最末尾（最新消息之后，最靠近模型）
   *   深度 1 → 插到最新消息之前
   *   深度 N → 往前数 N 条
   * 深度超过消息条数时钳到数组头部。
   *
   * 必须在上下文裁剪之后调用，否则插入的条目可能被裁掉。
   *
   * @param {Array} messages 已裁剪的消息数组
   * @param {Array} depthItems buildInjection 产出的 depthItems
   * @returns {Array} 新数组（不修改入参）
   */
  function applyDepthInjection(messages, depthItems) {
    const list = Array.isArray(messages) ? messages.slice() : [];
    if (!Array.isArray(depthItems) || depthItems.length === 0) return list;

    // 按深度从小到大插入会让后插的条目挤动先插的位置，
    // 所以从深的开始插：深度大的靠前，插入点不受后续影响。
    const sorted = depthItems.slice().sort((a, b) => normalizeDepth(b.depth) - normalizeDepth(a.depth));

    sorted.forEach((item) => {
      const content = String(item && item.content || '').trim();
      if (!content) return;
      const depth = normalizeDepth(item && item.depth);
      const role = normalizeRole(item && item.role);
      const at = Math.max(0, list.length - depth);
      list.splice(at, 0, { role, content });
    });

    return list;
  }

  return {
    buildInjection,
    applyDepthInjection,
    collectEntries,
    SCAN_MESSAGE_COUNT,
    MAX_DEPTH
  };
})();

window.WorldBookEngine = WorldBookEngine;
