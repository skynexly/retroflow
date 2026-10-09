/**
 * 溯流计划 · 通用聊天记录检索 (Chat History Search Hub)
 *
 * 职责：对任意 forkId 下的流水记录做关键词检索，命中后可跳回原会话定位。
 *
 * 设计要点：
 * - 通用：调用方传入 { forkId, label, onLocate }，随身系统助手与线上联络共用同一视窗。
 * - 只读：本模块不写库、不删记录，纯查询层，跳转由 onLocate 回调交还给调用方。
 * - 检索面覆盖正文、识图描述、生图提示词、文件名与工具执行结果，与「能进上下文的都能被检索」口径一致。
 */
const ChatHistorySearchUI = (() => {
  'use strict';

  const page = document.getElementById('chatHistorySearchPage');
  const backBtn = document.getElementById('chatSearchBackBtn');
  const contextLabel = document.getElementById('chatSearchContextLabel');
  const countBadge = document.getElementById('chatSearchCountBadge');
  const input = document.getElementById('chatSearchInput');
  const clearBtn = document.getElementById('chatSearchClearBtn');
  const filtersBar = document.getElementById('chatSearchFiltersBar');
  const listEl = document.getElementById('chatSearchResultsList');
  const emptyEl = document.getElementById('chatSearchEmptyState');
  const emptyTitle = emptyEl ? emptyEl.querySelector('.chat-search-empty-title') : null;
  const emptyDesc = emptyEl ? emptyEl.querySelector('.chat-search-empty-desc') : null;

  const RECORD_KIND = 'system_chat_message';
  const ONLINE_RECORD_KIND = 'online_chat_message';
  const TOOL_KIND = 'system_chat_tool_call';
  const NOTICE_KIND = 'system_chat_notice';

  let isOpen = false;
  let pendingProgrammaticBack = false;
  let activeFilter = 'all';
  let keyword = '';
  let records = [];
  let session = { forkId: null, label: '', onLocate: null };
  let debounceTimer = null;

  /* ---------------- 工具 ---------------- */

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegExp(text) {
    return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function formatStamp(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    const sameYear = d.getFullYear() === new Date().getFullYear();
    const date = sameYear
      ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * 把一条流水记录摊平成检索条目。
   * 不可检索的记录（空正文的占位、未知 kind）返回 null，由调用方过滤。
   */
  function toEntry(record) {
    if (!record) return null;

    if (record.kind === TOOL_KIND) {
      const name = String(record.toolName || '未知工具');
      const output = String(record.toolOutput || '');
      const inputText = record.toolInput ? safeStringify(record.toolInput) : '';
      return {
        id: record.id,
        role: 'tool',
        roleTag: 'TOOL',
        sender: name,
        text: output || inputText || '（无执行输出）',
        haystack: `${name}\n${inputText}\n${output}`,
        createdAt: record.createdAt || 0,
        category: 'tool'
      };
    }

    if (record.kind === NOTICE_KIND) {
      const text = String(record.content || '');
      return {
        id: record.id,
        role: 'system',
        roleTag: 'SYS',
        sender: '系统提示',
        text,
        haystack: text,
        createdAt: record.eventAt || record.createdAt || 0,
        category: 'system'
      };
    }

    // 副本推演流水：无 kind 字段，靠 forkId 的 `run:` 前缀识别。
    // role 只有 'envoy'（执行员行动）与 'narration'（AI 叙事）两种。
    if (!record.kind && typeof record.forkId === 'string' && record.forkId.startsWith('run:')) {
      const isEnvoy = record.role === 'envoy';
      const text = String(record.content || '').trim();
      if (!text) return null;
      const forkParts = [text];
      if (Array.isArray(record.files) && record.files.length) {
        forkParts.push(`[文件] ${record.files.map((f) => String(f && f.name || '')).filter(Boolean).join('、')}`);
      }
      return {
        id: record.id,
        role: isEnvoy ? 'user' : 'assistant',
        roleTag: isEnvoy ? 'ENVOY' : 'NARR',
        sender: isEnvoy ? (String(record.name || '').trim() || '执行员') : '世界线推演',
        text: forkParts.join('\n'),
        haystack: forkParts.join('\n'),
        createdAt: record.createdAt || 0,
        category: (Array.isArray(record.files) && record.files.length) ? 'media' : (isEnvoy ? 'user' : 'assistant')
      };
    }

    if (record.kind !== RECORD_KIND && record.kind !== ONLINE_RECORD_KIND) return null;

    const isOnline = record.kind === ONLINE_RECORD_KIND;
    const isUser = isOnline ? (record.role === 'envoy') : (record.role === 'user');
    const role = isUser ? 'user' : 'assistant';
    
    // 角色标签与发送者名称（区分随身系统助手与私聊会话）
    const roleTag = isOnline 
      ? (isUser ? 'ENVOY' : 'CONTACT') 
      : (isUser ? 'USER' : 'ASST');
      
    const defaultSender = isOnline 
      ? (isUser ? '执行员' : (session.label || '对方')) 
      : (isUser ? '执行员' : '随身系统助手');
      
    const sender = String(record.senderName || record.assistantName || defaultSender);
    const parts = [];
    let category = role;

    const content = String(record.content || '').trim();
    if (content) parts.push(content);

    // 图片消息：正文可能为空，检索面落在识图描述上
    if (record.imageRef) {
      category = 'media';
      const desc = String(record.imageRef.visionDescription || '').trim();
      if (desc) parts.push(`[图片] ${desc}`);
      else parts.push('[图片]');
    }
    if (record.genImageRef) {
      category = 'media';
      const prompt = String(record.genImageRef.prompt || '').trim();
      parts.push(prompt ? `[生成图] ${prompt}` : '[生成图]');
    }
    if (Array.isArray(record.fileRefs) && record.fileRefs.length) {
      category = 'media';
      parts.push(`[文件] ${record.fileRefs.map((f) => String(f && f.name || '')).filter(Boolean).join('、')}`);
    }
    if (record.quote && record.quote.text) {
      parts.push(`[引用] ${String(record.quote.text)}`);
    }

    const text = parts.join('\n').trim();
    if (!text) return null;

    return {
      id: record.id,
      role,
      roleTag,
      sender,
      text,
      haystack: text,
      createdAt: record.createdAt || 0,
      category
    };
  }

  function safeStringify(value) {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return '';
    }
  }

  function matchFilter(entry) {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'media') return entry.category === 'media';
    if (activeFilter === 'tool') return entry.category === 'tool';
    return entry.role === activeFilter;
  }

  /**
   * 生成命中片段：以首个命中位置为中心裁剪，避免长文里命中词被 line-clamp 截在视野外。
   */
  function buildSnippet(text, kw) {
    const flat = String(text || '').replace(/\s*\n\s*/g, ' ⁄ ');
    if (!kw) return escapeHtml(flat.slice(0, 160));

    const lower = flat.toLowerCase();
    const hit = lower.indexOf(kw.toLowerCase());
    const WINDOW = 150;
    let start = 0;
    let prefix = '';
    if (hit > 40) {
      start = hit - 30;
      prefix = '…';
    }
    const clipped = flat.slice(start, start + WINDOW);
    const suffix = start + WINDOW < flat.length ? '…' : '';
    const safe = escapeHtml(clipped);
    const highlighted = safe.replace(
      new RegExp(escapeRegExp(escapeHtml(kw)), 'gi'),
      (m) => `<span class="chat-search-hit">${m}</span>`
    );
    return `${prefix}${highlighted}${suffix}`;
  }

  /* ---------------- 渲染 ---------------- */

  function showEmpty(title, desc) {
    if (!emptyEl) return;
    emptyEl.hidden = false;
    if (emptyTitle) emptyTitle.textContent = title;
    if (emptyDesc) emptyDesc.textContent = desc;
  }

  function updateCount(n, hasKeyword) {
    if (!countBadge) return;
    countBadge.textContent = hasKeyword ? `${n} 项` : `${records.length} 条`;
    countBadge.classList.toggle('is-hit', hasKeyword && n > 0);
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = '';

    const kw = keyword.trim();
    if (!kw) {
      updateCount(0, false);
      showEmpty('输入关键词开启检索', '支持按正文、识图描述、文件名与工具执行结果即时检索');
      return;
    }

    const lowerKw = kw.toLowerCase();
    const hits = records
      .filter((entry) => matchFilter(entry) && entry.haystack.toLowerCase().includes(lowerKw))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    updateCount(hits.length, true);

    if (!hits.length) {
      showEmpty('没有匹配的记录', `未找到包含「${kw}」的内容，换个关键词或切换过滤维度试试`);
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    for (const entry of hits) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `chat-search-result-item role-${entry.role}`;
      item.dataset.recordId = entry.id;
      item.innerHTML = `
        <div class="chat-search-result-head">
          <span class="chat-search-role-tag">${escapeHtml(entry.roleTag)}</span>
          <span class="chat-search-sender">${escapeHtml(entry.sender)}</span>
          <span class="chat-search-time">${escapeHtml(formatStamp(entry.createdAt))}</span>
        </div>
        <p class="chat-search-snippet">${buildSnippet(entry.text, kw)}</p>`;
      item.addEventListener('click', () => locate(entry));
      frag.appendChild(item);
    }
    listEl.appendChild(frag);
  }

  function scheduleRender() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      render();
    }, 120);
  }

  /* ---------------- 命中跳转 ---------------- */

  function locate(entry) {
    const cb = session.onLocate;
    close();
    if (typeof cb === 'function') {
      // 两级页面依次退栈：检索页的 history.back 需要先落定，
      // 否则调用方紧接着再 back 会与本次退栈互相打断，出现停在设置页或多退一层。
      setTimeout(() => {
        try { cb(entry.id, entry); } catch (e) { /* ignore */ }
      }, 460);
    }
  }

  /* ---------------- 数据装载 ---------------- */

  async function loadRecords() {
    records = [];
    if (!session.forkId || !window.Storage || typeof Storage.getRecordsByFork !== 'function') return;
    try {
      const raw = await Storage.getRecordsByFork(session.forkId);
      records = (raw || []).map(toEntry).filter(Boolean);
    } catch (e) {
      records = [];
    }
    updateCount(0, false);
  }

  /* ---------------- 开关 ---------------- */

  function open(options) {
    if (!page) return;
    const opts = options || {};
    session = {
      forkId: opts.forkId || 'system-chat:main',
      label: opts.label || '随身系统助手',
      onLocate: typeof opts.onLocate === 'function' ? opts.onLocate : null
    };

    if (contextLabel) contextLabel.textContent = session.label;
    keyword = '';
    activeFilter = 'all';
    if (input) input.value = '';
    if (clearBtn) clearBtn.hidden = true;
    syncFilterPills();
    if (listEl) listEl.innerHTML = '';
    showEmpty('输入关键词开启检索', '支持按正文、识图描述、文件名与工具执行结果即时检索');

    page.hidden = false;
    page.setAttribute('aria-hidden', 'false');
    // 强制 reflow，让移除 hidden 与加 active 分帧，进入过渡才会生效
    void page.offsetWidth;
    page.classList.add('active');
    document.body.classList.add('page-active');
    isOpen = true;

    try {
      history.pushState({ rfPage: 'chat-search' }, '', '#chat-search');
    } catch (e) { /* ignore */ }

    loadRecords();
    // 让进场动画先跑，再唤起键盘，避免过渡被布局抖动打断
    setTimeout(() => {
      if (isOpen && input) input.focus();
    }, 400);
  }

  /** 仅收起 UI，不触碰 history（供 popstate 复用） */
  function dismissUI() {
    if (!page) return;
    if (input) input.blur();
    page.setAttribute('aria-hidden', 'true');
    page.classList.remove('active');
    document.body.classList.remove('page-active');
    setTimeout(() => {
      if (!page.classList.contains('active')) page.hidden = true;
    }, 360);
    isOpen = false;
  }

  function close() {
    if (!page || !page.classList.contains('active')) return;
    dismissUI();
    if ((window.location.hash || '') === '#chat-search') {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (e) { /* ignore */ }
    }
  }

  function syncFilterPills() {
    if (!filtersBar) return;
    const fid = (session && session.forkId) || '';
    const isOnline = fid.startsWith('online:');
    const isFork = fid.startsWith('run:');
    
    // 动态调整维度胶囊文案与可见性
    const userPill = filtersBar.querySelector('[data-filter="user"]');
    const asstPill = filtersBar.querySelector('[data-filter="assistant"]');
    const toolPill = filtersBar.querySelector('[data-filter="tool"]');

    if (userPill) userPill.textContent = (isOnline || isFork) ? (isFork ? '执行员' : '我') : '执行员';
    if (asstPill) asstPill.textContent = isFork ? '推演' : (isOnline ? (session.label || '对方') : '助手');
    if (toolPill) {
      // 私聊会话与副本推演都无独立工具调用记录，隐藏工具维度
      toolPill.hidden = Boolean(isOnline || isFork);
    }

    filtersBar.querySelectorAll('.chat-search-filter-pill').forEach((pill) => {
      pill.classList.toggle('is-active', (pill.dataset.filter || 'all') === activeFilter);
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  if (backBtn) backBtn.addEventListener('click', close);

  if (input) {
    input.addEventListener('input', () => {
      keyword = input.value || '';
      if (clearBtn) clearBtn.hidden = !keyword;
      scheduleRender();
    });
    // 回车收键盘即可，检索本身是即时的
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      keyword = '';
      if (input) {
        input.value = '';
        input.focus();
      }
      clearBtn.hidden = true;
      render();
    });
  }

  if (filtersBar) {
    filtersBar.addEventListener('click', (e) => {
      const pill = e.target && e.target.closest ? e.target.closest('.chat-search-filter-pill') : null;
      if (!pill) return;
      activeFilter = pill.dataset.filter || 'all';
      syncFilterPills();
      render();
    });
  }

  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }
    if (isOpen) dismissUI();
  });

  return { open, close, isOpen: () => isOpen };
})();

window.ChatHistorySearchUI = ChatHistorySearchUI;
