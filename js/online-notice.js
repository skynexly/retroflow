/**
 * 溯流计划 · 顶部消息通知横幅 (Retroflow Online Notice)
 *
 * 职责：
 *   新消息落库时，若用户不在对应的私聊窗口，就在屏幕顶部弹一条横幅，
 *   显示联系人头像、名字与消息摘要，点击直接落回那个会话。
 *
 * 与 RetroToast 的分工：
 *   RetroToast 是系统级提示，单例替换式（新的来了顶掉旧的）。
 *   本模块是「有人给你发消息了」，来几条弹几条，所以走多条堆叠，
 *   每条自带倒计时，互不干扰。层级 14500：压过图片灯箱（14000），
 *   让位于系统提示（15000）——报错永远要盖在消息提醒之上。
 *
 * 接口刻意做成通用的：调用方只给「哪个账号的哪个联系人说了什么」，
 * 名字、头像、跳转全由本模块自己解析。这样将来做「角色主动找你」
 * （后台定时触发、离线补发之类）能直接复用，不必再铺一遍展示层。
 *
 * 规范：纯 SVG 图标，零 emoji，零分割线，顶部走灵动岛安全区。
 */
window.RetroflowOnlineNotice = (() => {
  'use strict';

  /** 同时最多堆叠几条，超出时挤掉最旧的一条 */
  const MAX_STACK = 3;
  /** 单条停留毫秒 */
  const DEFAULT_DURATION = 4600;
  /** 同批多条的逐条出场间隔，与私聊气泡的错峰节奏对齐 */
  const STAGGER_MS = 420;

  /** 无立绘时的兜底头像，与联系人卡片同一张 */
  const AVATAR_FALLBACK_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
    </svg>
  `;

  const CLOSE_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
    </svg>
  `;

  /** 频段接入微标 */
  const SIGNAL_SVG = `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 13h2V9H2v4zm4 0h2V6H6v7zm4 0h2V3h-2v10zm4 0h2V0h-2v13z"/>
    </svg>
  `;

  /** 语音微型声波微标 */
  const VOICE_MINI_SVG = `
    <svg class="notice-type-mini-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1 8h2v2H1zm3-3h2v8H4zm3-2h2v12H7zm3 2h2v8h-2zm3 3h2v2h-2z"/>
    </svg>
  `;

  /** 图片微型视差镜头微标 */
  const IMAGE_MINI_SVG = `
    <svg class="notice-type-mini-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M14 3H2a1 1 0 00-1 1v8a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1zm-1 8H3l2.5-3.3 1.8 2.4 2.7-3.6L13 11z"/>
    </svg>
  `;

  let container = null;
  /** 当前在场的横幅：{ el, timer, accountId, contactId } */
  const active = [];
  /** 待弹队列：同一批消息逐条出队，不一次铺满 */
  const queue = [];
  /** 出队调度句柄 */
  let drainTimer = null;
  /** 上一条实际弹出的时间戳，用于算下一条的等待间隔 */
  let lastShownAt = 0;

  function trimStr(v) {
    return v == null ? '' : String(v).trim();
  }

  function ensureContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.id = 'onlineNoticeContainer';
      container.className = 'online-notice-container';
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    return container;
  }

  function formatTime(ts) {
    const d = new Date(Number(ts) || Date.now());
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * 解析联系人展示信息。
   * 走 OnlineStore 的同一套口径（备注名优先于档案本名），
   * 保证横幅上的名字和消息列表里看到的一致。
   */
  function resolveContact(contactId) {
    try {
      if (!window.OnlineStore || typeof OnlineStore.findContact !== 'function') return null;
      const raw = OnlineStore.findContact(contactId);
      if (!raw) return null;
      if (typeof OnlineStore.resolveContact === 'function') {
        return OnlineStore.resolveContact(raw) || raw;
      }
      return raw;
    } catch (_) {
      return null;
    }
  }

  function resolveSystemIdentity() {
    try {
      const active = window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function'
        ? ResonanceUI.getActiveAssistant()
        : null;
      const name = trimStr(active && active.name) || '系统助手';
      let avatarKey = '';
      if (active && active.id && window.DataRegistry && DataRegistry.key
        && typeof DataRegistry.key.assistantAvatar === 'function') {
        avatarKey = DataRegistry.key.assistantAvatar(active.id);
      }
      return { name, avatarKey };
    } catch (_) {
      return { name: '系统助手', avatarKey: '' };
    }
  }

  /** 用户此刻是否正开着这个会话 */
  function isViewingSession(accountId, contactId, kind) {
    try {
      if (kind === 'system') {
        const ui = window.SystemChatUI;
        return !!(ui && typeof ui.isOpen === 'function' && ui.isOpen());
      }
      const ui = window.OnlineChatUI;
      if (!ui || typeof ui.isOpen !== 'function' || !ui.isOpen()) return false;
      if (typeof ui.getCurrentContactId !== 'function') return false;
      return ui.getCurrentContactId() === contactId
        && ui.getCurrentAccountId() === accountId;
    } catch (_) {
      return false;
    }
  }

  /** 摘要文案统一走落库层，语音/图片/文件的写法与会话列表一致 */
  function previewOf(payload) {
    const explicit = trimStr(payload.text);
    if (explicit) return explicit.replace(/\s+/g, ' ');
    if (payload.record && window.OnlineChatStore
      && typeof OnlineChatStore.summarize === 'function') {
      return trimStr(OnlineChatStore.summarize(payload.record));
    }
    const type = trimStr(payload.type);
    if (type === 'voice') return '[语音]';
    if (type === 'image') return '[图片]';
    if (type === 'file') return '[文件]';
    return '';
  }

  function detach(entry, immediate) {
    if (!entry) return;
    const idx = active.indexOf(entry);
    if (idx >= 0) active.splice(idx, 1);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const el = entry.el;
    if (!el) return;
    if (immediate) {
      el.remove();
      return;
    }
    el.classList.remove('is-entering');
    el.classList.add('is-leaving');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    // 过渡事件丢失时的兜底
    setTimeout(() => el.remove(), 300);
  }

  /**
   * 弹一条新消息横幅。
   *
   * 这里只负责入队，实际渲染由 drainQueue() 逐条推进——同一批落地的多条
   * 消息应当一条接一条冒出来，而不是一帧之内全部铺满屏幕。
   *
   * @param {Object} payload
   * @param {string} payload.accountId 收信账号（本人或马甲）
   * @param {string} payload.contactId 联系人记录 id，点击跳转的归属键
   * @param {string} [payload.text] 摘要文案，缺省则按 record/type 推
   * @param {Object} [payload.record] 落库记录，用它算摘要
   * @param {string} [payload.type] 'text' | 'voice' | 'image' | 'file'
   * @param {number} [payload.createdAt] 时间戳，缺省取现在
   * @param {number} [payload.duration] 停留毫秒
   * @param {boolean} [payload.force] 即使正开着该会话也弹（默认不弹）
   * @returns {boolean} 是否已接受入队（不代表一定会渲染，见 drainQueue）
   */
  function push(payload) {
    const p = payload || {};
    const kind = trimStr(p.kind) || 'online';
    const accountId = trimStr(p.accountId) || 'persona';
    const contactId = trimStr(p.contactId) || (kind === 'system' ? 'system-chat:main' : '');
    if (kind !== 'system' && !contactId) return false;

    // 人就在这个会话里看着，没必要再弹一次
    if (!p.force && isViewingSession(accountId, contactId, kind)) return false;

    queue.push(Object.assign({}, p, { kind, accountId, contactId }));
    scheduleDrain();
    return true;
  }

  /**
   * 排队调度：首条立即出队，其余按 STAGGER_MS 间隔依次推进。
   * 立即弹首条是刻意的——消息已经到了，第一声提醒不该有延迟。
   */
  function scheduleDrain() {
    if (drainTimer || !queue.length) return;
    const wait = lastShownAt ? Math.max(0, STAGGER_MS - (Date.now() - lastShownAt)) : 0;
    drainTimer = setTimeout(() => {
      drainTimer = null;
      drainOne();
      scheduleDrain();
    }, wait);
  }

  /** 出队一条并真正渲染 */
  function drainOne() {
    const p = queue.shift();
    if (!p) return;

    // 排队期间用户可能已经进了那个会话，此时这条提醒失去意义，直接丢弃
    if (!p.force && isViewingSession(p.accountId, p.contactId)) return;

    lastShownAt = Date.now();
    render(p);
  }

  /** 真正把一条横幅挂到屏幕上 */
  function render(p) {
    const kind = p.kind || 'online';
    const accountId = p.accountId;
    const contactId = p.contactId;
    const contact = kind === 'system' ? null : resolveContact(contactId);
    const systemIdentity = kind === 'system' ? resolveSystemIdentity() : null;
    const name = kind === 'system'
      ? systemIdentity.name
      : (trimStr(contact && contact.displayName) || '未知联系人');
    const preview = previewOf(p) || '发来一条消息';
    const stamp = Number(p.createdAt) || Date.now();
    const duration = Math.max(1200, Number(p.duration) || DEFAULT_DURATION);

    const cont = ensureContainer();

    const card = document.createElement('div');
    card.className = 'online-notice-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', `${name} 发来消息：${preview}`);

    // 头像展台（战术工牌切片）
    const avatarStage = document.createElement('div');
    avatarStage.className = 'online-notice-avatar-stage';

    const avatar = document.createElement('div');
    avatar.className = 'online-notice-avatar';
    avatar.innerHTML = AVATAR_FALLBACK_SVG;

    avatarStage.append(avatar);

    const body = document.createElement('div');
    body.className = 'online-notice-body';

    // 战术机能顶栏 (COMM LINK // FREQ)
    const tacticalBar = document.createElement('div');
    tacticalBar.className = 'online-notice-tactical-bar';

    const tagGroup = document.createElement('div');
    tagGroup.className = 'online-notice-tag-group';
    const sigIcon = document.createElement('span');
    sigIcon.className = 'online-notice-signal-icon';
    sigIcon.innerHTML = SIGNAL_SVG;
    const tagText = document.createElement('span');
    tagText.className = 'online-notice-tag-text';
    tagText.textContent = 'COMM LINK // INCOMING';
    tagGroup.append(sigIcon, tagText);

    const timeEl = document.createElement('span');
    timeEl.className = 'online-notice-time';
    timeEl.textContent = formatTime(stamp);

    tacticalBar.append(tagGroup, timeEl);

    // 联系人名称行
    const head = document.createElement('div');
    head.className = 'online-notice-head';
    const nameEl = document.createElement('span');
    nameEl.className = 'online-notice-name';
    nameEl.textContent = name;
    head.append(nameEl);

    // 内容摘要行（带类型微标）
    const textEl = document.createElement('div');
    textEl.className = 'online-notice-text';

    const msgType = trimStr(p.type) || (p.record ? p.record.messageType : '');
    if (msgType === 'voice') {
      const vIcon = document.createElement('span');
      vIcon.className = 'online-notice-type-icon';
      vIcon.innerHTML = VOICE_MINI_SVG;
      textEl.appendChild(vIcon);
    } else if (msgType === 'image') {
      const iIcon = document.createElement('span');
      iIcon.className = 'online-notice-type-icon';
      iIcon.innerHTML = IMAGE_MINI_SVG;
      textEl.appendChild(iIcon);
    }
    const textSpan = document.createElement('span');
    textSpan.className = 'online-notice-text-content';
    textSpan.textContent = preview;
    textEl.appendChild(textSpan);

    body.append(tacticalBar, head, textEl);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'online-notice-close';
    closeBtn.setAttribute('aria-label', '忽略这条消息提醒');
    closeBtn.innerHTML = CLOSE_SVG;

    card.append(avatarStage, body, closeBtn);

    const entry = { el: card, timer: null, accountId, contactId };

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      detach(entry, false);
    });

    function jump() {
      detach(entry, false);
      if (kind === 'system') {
        if (window.RetroflowOnlineNotice && typeof RetroflowOnlineNotice.dismissFor === 'function') {
          RetroflowOnlineNotice.dismissFor(accountId, contactId);
        }
        if (window.SystemChatUI && typeof SystemChatUI.open === 'function') {
          SystemChatUI.open();
        } else if (window.RetroToast) {
          RetroToast.warn('系统助手模块暂不可用');
        }
        return;
      }
      if (window.OnlineChatUI && typeof OnlineChatUI.openFromNotice === 'function') {
        OnlineChatUI.openFromNotice({
          accountId,
          contactId,
          rosterId: trimStr(contact && contact.rosterId),
          rosterType: trimStr(contact && contact.rosterType) || 'char'
        });
      } else if (window.RetroToast) {
        RetroToast.warn('私聊会话模块暂不可用');
      }
    }

    card.addEventListener('click', jump);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        jump();
      }
    });

    // 新的压在最上面：视觉上「刚来的这条」离状态栏最近
    cont.insertBefore(card, cont.firstChild || null);
    active.unshift(entry);

    // 超量时挤掉最旧的一条
    while (active.length > MAX_STACK) {
      detach(active[active.length - 1], false);
    }

    // 异步补真实立绘，取不到就留兜底 SVG
    const avatarKey = kind === 'system'
      ? trimStr(systemIdentity && systemIdentity.avatarKey)
      : trimStr(contact && contact.avatarKey);
    if (avatarKey && window.Storage && typeof Storage.getAssetSrc === 'function') {
      Storage.getAssetSrc(avatarKey).then((src) => {
        if (!src || !card.isConnected) return;
        const img = document.createElement('img');
        img.alt = '';
        img.src = src;
        avatar.innerHTML = '';
        avatar.appendChild(img);
      }).catch(() => {});
    }

    requestAnimationFrame(() => {
      card.classList.add('is-entering');
    });

    entry.timer = setTimeout(() => detach(entry, false), duration);
  }

  /** 进入某会话时清掉指向它的横幅：人已经看到了，提醒就没意义了 */
  function dismissFor(accountId, contactId) {
    const acc = trimStr(accountId) || 'persona';
    const cid = trimStr(contactId);
    if (!cid) return;
    // 已在场的撤掉
    active.slice().forEach((entry) => {
      if (entry.contactId === cid && entry.accountId === acc) detach(entry, false);
    });
    // 还在排队没弹的一并丢弃，否则进了会话还会陆续冒出来
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].contactId === cid && queue[i].accountId === acc) queue.splice(i, 1);
    }
  }

  function dismissAll() {
    queue.length = 0;
    if (drainTimer) {
      clearTimeout(drainTimer);
      drainTimer = null;
    }
    active.slice().forEach((entry) => detach(entry, true));
  }

  return {
    push,
    dismissFor,
    dismissAll,
    isViewingSession
  };
})();
