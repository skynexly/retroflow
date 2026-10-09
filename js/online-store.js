/**
 * ============================================================================
 * 溯流计划 · 线上联络数据层 (Online Store)
 *
 * 职责：线上联络模块的唯一数据入口。管理伪登录账号态、通讯录、会话元数据，
 * 并负责与 envoy / roster 之间的级联删除。
 *
 * 三条核心约定：
 *
 *   1. 账号即身份，不另立体系。
 *      accountId 为 'persona'（个人档案本人）或马甲 id（马甲账号）。
 *      昵称与头像默认继承对应身份，账号态里只存线上专属的覆盖值。
 *
 *   2. 联系人是纯关联记录，不存档案副本。
 *      名字、头像一律实时从 roster 读。档案被删除时联系人连带删除，
 *      不做「已注销」留痕——这是刻意的选择，换来的是没有任何同步分支。
 *
 *   3. 消息本体不在这里。
 *      聊天消息走 IndexedDB records store，forkId 形如
 *      online:{accountId}:{contactId}，与助手的 system-chat:main 天然隔开。
 *      本模块只维护会话元数据（未读、置顶、末条摘要）。
 *
 * 级联删除的三个入口，全部收敛到 purge* 系列方法：
 *   删角色/NPC/官方角色 → purgeByRosterId()
 *   删马甲             → purgeByAccountId()
 *   通讯录删联系人      → removeContact()
 * 三者最终都调用同一套清理逻辑，不存在两份实现。
 * ============================================================================
 */
const OnlineStore = (() => {
  'use strict';

  /** 本人账号（个人档案本体）的固定账号 id */
  const PERSONA_ACCOUNT_ID = 'persona';

  /** 会话 forkId 前缀，records 里按它做隔离 */
  const FORK_ROOT = 'online:';

  /* ---------------- 工具 ---------------- */

  function genId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  function asObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }

  /** 会话 forkId：online:{accountId}:{contactId} */
  function forkIdOf(accountId, contactId) {
    return `${FORK_ROOT}${accountId}:${contactId}`;
  }

  /** 某账号名下全部会话的 forkId 前缀 */
  function forkPrefixOfAccount(accountId) {
    return `${FORK_ROOT}${accountId}:`;
  }

  /* ---------------- 账号（伪登录） ---------------- */

  /**
   * 枚举可用账号。本人账号恒在首位，其后是马甲账号。
   * 这里不做落盘，账号列表是 envoy 的投影，随马甲增删自动变化。
   */
  function listAccounts() {
    const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};
    const masks = asArray(window.Store && Store.envoy && Store.envoy.masks);
    const states = asObject(Store.online.accounts);

    const personaState = asObject(states[PERSONA_ACCOUNT_ID]);
    const personaDisplayName = (personaState.nickname && String(personaState.nickname).trim())
      || identity.name
      || '执行员';

    const out = [{
      id: PERSONA_ACCOUNT_ID,
      kind: 'persona',
      name: personaDisplayName,
      originalName: identity.name || '执行员',
      serialNo: identity.serialNo || '',
      avatarKey: DataRegistry.key.personaAvatar(),
      state: personaState
    }];

    masks.forEach((mask) => {
      if (!mask || !mask.id) return;
      const maskState = asObject(states[mask.id]);
      const maskDisplayName = (maskState.nickname && String(maskState.nickname).trim())
        || mask.name
        || '未命名马甲';

      out.push({
        id: mask.id,
        kind: 'mask',
        name: maskDisplayName,
        originalName: mask.name || '未命名马甲',
        serialNo: mask.serialNo || '',
        avatarKey: DataRegistry.key.maskAvatar(mask.id),
        state: maskState
      });
    });

    return out;
  }

  function getAccount(accountId) {
    return listAccounts().find((a) => a.id === accountId) || null;
  }

  /** 当前已登录账号；无则返回 null（应展示登录页） */
  function getActiveAccount() {
    const states = asObject(Store.online.accounts);
    const activeId = Object.keys(states).find((id) => states[id] && states[id].loggedIn);
    if (!activeId) return null;
    return getAccount(activeId);
  }

  /**
   * 该账号是否设置了访问密码（注册时填了密码即为 true）。
   * 密码是平台内的演出凭证，明文存放，仅用于登录校验与助手提醒。
   */
  function hasPassword(accountId) {
    const acc = getAccount(accountId);
    if (!acc) return false;
    return !!String((acc.state && acc.state.password) || '').trim();
  }

  /**
   * 校验账号密码。未设置密码的账号一律放行（免密登录）。
   * @returns {boolean}
   */
  function verifyPassword(accountId, input) {
    if (!hasPassword(accountId)) return true;
    const acc = getAccount(accountId);
    const saved = String((acc.state && acc.state.password) || '').trim();
    return String(input || '').trim() === saved;
  }

  /**
   * 登录（伪登录演出）。设置过密码的账号必须通过密码校验。
   * 同一时刻只允许一个账号在线，登录新账号会自动挤下旧账号。
   */
  async function login(accountId, password) {
    if (!getAccount(accountId)) return { ok: false, reason: 'account_not_found' };
    if (!verifyPassword(accountId, password)) return { ok: false, reason: 'wrong_password' };

    const states = asObject(Store.online.accounts);
    const next = {};
    Object.keys(states).forEach((id) => {
      next[id] = Object.assign({}, states[id], { loggedIn: false });
    });
    next[accountId] = Object.assign({}, next[accountId], {
      loggedIn: true,
      lastActiveAt: Date.now()
    });

    const ok = await Store.save('online.accounts', next);
    return { ok, accountId };
  }

  async function logout() {
    const states = asObject(Store.online.accounts);
    const next = {};
    Object.keys(states).forEach((id) => {
      next[id] = Object.assign({}, states[id], { loggedIn: false });
    });
    return await Store.save('online.accounts', next);
  }

  /** 更新账号的线上专属资料（昵称、签名等覆盖值） */
  async function updateAccountProfile(accountId, patch) {
    if (!getAccount(accountId)) return false;
    const states = asObject(Store.online.accounts);
    const next = Object.assign({}, states);
    next[accountId] = Object.assign({}, next[accountId], asObject(patch));
    return await Store.save('online.accounts', next);
  }

  /* ---------------- 通讯录 ---------------- */

  /**
   * 从 roster 解析联系人的展示信息。
   * 返回 null 表示源档案已不存在——正常情况下不会发生（级联删除会先清掉联系人），
   * 出现即说明有脏数据，调用方应当过滤掉。
   */
  function resolveContact(contact) {
    if (!contact || !contact.rosterId) return null;
    const roster = (window.Store && Store.roster) || {};

    let source = null;
    let avatarKey = '';
    if (contact.rosterType === 'npc') {
      source = asArray(roster.npcs).find((n) => n && n.id === contact.rosterId);
      avatarKey = DataRegistry.key.npcAvatar(contact.rosterId);
    } else {
      // char 与 official 都存在 roster.characters 里，靠 camp 区分
      source = asArray(roster.characters).find((c) => c && c.id === contact.rosterId);
      avatarKey = DataRegistry.key.charAvatar(contact.rosterId);
    }
    if (!source) return null;

    return {
      ...contact,
      // 备注名优先于档案本名，这是线上专属的显示层覆盖
      displayName: contact.remark || source.name || '未命名',
      realName: source.name || '未命名',
      // 编号供卡片与聊天页顶栏显示；副本阵营档案本身无编号，这里原样透传空值
      serial: source.serial || '',
      avatarKey,
      appearance: source.appearance || '',
      profile: source.profile || source.corePrompt || '',
      camp: source.camp || ''
    };
  }

  /** 列出某账号下的联系人（已解析展示信息，自动过滤脏数据） */
  function listContacts(accountId) {
    return asArray(Store.online.contacts)
      .filter((c) => c && c.accountId === accountId)
      .map(resolveContact)
      .filter(Boolean);
  }

  function findContact(contactId) {
    return asArray(Store.online.contacts).find((c) => c && c.id === contactId) || null;
  }

  /** 判断某个档案是否已在该账号的通讯录里，避免重复添加 */
  function hasContact(accountId, rosterId) {
    return asArray(Store.online.contacts)
      .some((c) => c && c.accountId === accountId && c.rosterId === rosterId);
  }

  /**
   * 添加联系人。
   * @param {string} accountId
   * @param {string} rosterId 档案 id
   * @param {'char'|'npc'|'official'} rosterType
   */
  async function addContact(accountId, rosterId, rosterType) {
    if (!accountId || !rosterId) return { ok: false, reason: 'invalid_args' };
    if (hasContact(accountId, rosterId)) return { ok: false, reason: 'already_exists' };

    const contact = {
      id: genId('oc'),
      accountId,
      rosterId,
      rosterType: rosterType || 'char',
      remark: '',
      blocked: false,
      feedPermission: 'all',
      addedAt: Date.now()
    };

    const next = asArray(Store.online.contacts).concat([contact]);
    const ok = await Store.save('online.contacts', next);
    return { ok, contact };
  }

  async function updateContact(contactId, patch) {
    const list = asArray(Store.online.contacts);
    const idx = list.findIndex((c) => c && c.id === contactId);
    if (idx < 0) return false;
    const next = list.slice();
    next[idx] = Object.assign({}, next[idx], asObject(patch));
    return await Store.save('online.contacts', next);
  }

  /* ---------------- 会话元数据 ---------------- */

  function listSessions(accountId) {
    return asArray(Store.online.sessions)
      .filter((s) => s && s.accountId === accountId)
      .sort((a, b) => {
        // 置顶优先，其次按最后活跃时间倒序
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return (b.lastMessageAt || 0) - (a.lastMessageAt || 0);
      });
  }

  function findSession(accountId, contactId) {
    return asArray(Store.online.sessions)
      .find((s) => s && s.accountId === accountId && s.contactId === contactId) || null;
  }

  /** 取得会话，不存在则创建。返回会话元数据。 */
  async function ensureSession(accountId, contactId) {
    const existing = findSession(accountId, contactId);
    if (existing) return existing;

    const session = {
      id: genId('os'),
      accountId,
      contactId,
      forkId: forkIdOf(accountId, contactId),
      unread: 0,
      pinned: false,
      lastMessage: '',
      lastMessageAt: 0,
      createdAt: Date.now()
    };
    const next = asArray(Store.online.sessions).concat([session]);
    await Store.save('online.sessions', next);
    return session;
  }

  async function updateSession(sessionId, patch) {
    const list = asArray(Store.online.sessions);
    const idx = list.findIndex((s) => s && s.id === sessionId);
    if (idx < 0) return false;
    const next = list.slice();
    next[idx] = Object.assign({}, next[idx], asObject(patch));
    return await Store.save('online.sessions', next);
  }

  /* ---------------- 级联删除 ---------------- */

  /**
   * 清理一批联系人及其全部衍生数据。
   * 这是所有删除路径的唯一落点：联系人记录、会话元数据、消息流水、
   * 朋友圈条目、线上专属资产，一次清干净。
   * @param {Array} targets 联系人对象数组
   * @returns {Promise<{contacts:number, sessions:number, records:number, feed:number}>}
   */
  async function purgeContacts(targets) {
    const victims = asArray(targets).filter(Boolean);
    if (!victims.length) return { contacts: 0, sessions: 0, records: 0, feed: 0 };

    const victimIds = new Set(victims.map((c) => c.id));
    const stat = { contacts: victims.length, sessions: 0, records: 0, feed: 0 };

    // 1) 消息流水：按 forkId 精确删
    for (const c of victims) {
      try {
        stat.records += await Storage.removeRecordsByForkPrefix(forkIdOf(c.accountId, c.id));
      } catch (err) {
        console.warn('[OnlineStore] 清理会话流水失败：', c.id, err);
      }
    }

    // 2) 线上专属资产（联系人自定义头像、会话壁纸）
    for (const c of victims) {
      try {
        await Storage.removeAsset(DataRegistry.key.onlineContactAvatar(c.id));
        const session = findSession(c.accountId, c.id);
        if (session) {
          await Storage.removeAsset(DataRegistry.key.onlineChatWallpaper(session.id));
        }
      } catch (err) { /* 资产不存在属正常，忽略 */ }
    }

    // 3) 会话元数据
    const sessions = asArray(Store.online.sessions);
    const keptSessions = sessions.filter((s) => !(s && victimIds.has(s.contactId)));
    stat.sessions = sessions.length - keptSessions.length;
    if (stat.sessions > 0) await Store.save('online.sessions', keptSessions);

    // 4) 朋友圈条目（本轮仅占位，结构未定，先按 contactId 关联清理）
    const feed = asArray(Store.online.feed);
    const keptFeed = feed.filter((f) => !(f && victimIds.has(f.contactId)));
    stat.feed = feed.length - keptFeed.length;
    if (stat.feed > 0) await Store.save('online.feed', keptFeed);

    // 5) 联系人本体，最后删，前面任何一步失败都还能靠它找回残留
    const contacts = asArray(Store.online.contacts);
    const keptContacts = contacts.filter((c) => !(c && victimIds.has(c.id)));
    await Store.save('online.contacts', keptContacts);

    return stat;
  }

  /** 通讯录里手动删除单个联系人。与档案级联走同一套清理。 */
  async function removeContact(contactId) {
    const target = findContact(contactId);
    if (!target) return { contacts: 0, sessions: 0, records: 0, feed: 0 };
    return await purgeContacts([target]);
  }

  /**
   * 档案被删除时调用：清掉所有账号下引用该档案的联系人。
   * 同一个角色可能同时在本人账号和多个马甲账号的通讯录里，所以要全账号扫。
   * @param {string} rosterId
   */
  async function purgeByRosterId(rosterId) {
    if (!rosterId) return { contacts: 0, sessions: 0, records: 0, feed: 0 };
    const victims = asArray(Store.online.contacts).filter((c) => c && c.rosterId === rosterId);
    return await purgeContacts(victims);
  }

  /**
   * 马甲被删除时调用：清掉该账号名下的一切线上数据。
   * @param {string} accountId 马甲 id
   */
  async function purgeByAccountId(accountId) {
    if (!accountId || accountId === PERSONA_ACCOUNT_ID) {
      // 本人账号不可删除，拦住以免误调
      return { contacts: 0, sessions: 0, records: 0, feed: 0, accountState: false };
    }

    const victims = asArray(Store.online.contacts).filter((c) => c && c.accountId === accountId);
    const stat = await purgeContacts(victims);

    // 兜底：即便该账号没有任何联系人，也可能残留流水与账号资产
    try {
      stat.records += await Storage.removeRecordsByForkPrefix(forkPrefixOfAccount(accountId));
    } catch (err) { /* ignore */ }
    try {
      await Storage.removeAsset(DataRegistry.key.onlineAccountAvatar(accountId));
      await Storage.removeAsset(DataRegistry.key.onlineAccountCover(accountId));
    } catch (err) { /* ignore */ }

    // 账号登录态
    const states = asObject(Store.online.accounts);
    if (states[accountId]) {
      const next = Object.assign({}, states);
      delete next[accountId];
      stat.accountState = await Store.save('online.accounts', next);
    } else {
      stat.accountState = true;
    }

    return stat;
  }

  return {
    PERSONA_ACCOUNT_ID,
    FORK_ROOT,
    forkIdOf,
    forkPrefixOfAccount,

    // 账号
    listAccounts,
    getAccount,
    getActiveAccount,
    hasPassword,
    verifyPassword,
    login,
    logout,
    updateAccountProfile,

    // 通讯录
    listContacts,
    findContact,
    hasContact,
    resolveContact,
    addContact,
    updateContact,
    // 会话
    listSessions,
    findSession,
    ensureSession,
    updateSession,
    forkIdOf,

    // 级联删除
    removeContact,
    purgeContacts,
    purgeByRosterId,
    purgeByAccountId
  };
})();

window.OnlineStore = OnlineStore;
