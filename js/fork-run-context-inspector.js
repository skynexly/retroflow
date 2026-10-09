/**
 * ============================================================================
 * 溯流计划 · 上下文查看器 (Context Inspector)
 *
 * 职责：把「最近一次真实发出的上下文」原样摊开给用户看，用于调试。
 *
 * 设计要点：
 * - 数据源可注入：默认取 ForkRunApi.getLastContextSnapshot()（副本推演），
 *   调用方可通过 open({ source }) 传入任意同结构快照的 getter，
 *   因此副本推演与系统助手私聊共用这同一套查看 UI。
 *   快照一律在 finalMessages 定型、发请求前写入 —— 所见即所发：
 *   system prompt 全文、世界书 top/bottom、裁剪后的历史、深度注入全在里面。
 * - 全文拉通：不折叠，每条消息正文完整展示，避免逐条点开。
 * - 只读：本模块不写库、不改快照，纯查看层。
 * - 全屏 slide-in 页 + hash 路由 + popstate 返回，与 ChatHistorySearchUI 同范式。
 * - 严格遵循《工地施工协议》：纯 SVG 图标、零 emoji、零分割线、iOS 灵动岛保护。
 * ============================================================================
 */
window.ForkRunContextInspector = (() => {
  'use strict';

  const PAGE_ID = 'forkRunContextInspectorPage';
  const HASH = '#fork-run/context';

  let page = null;
  let listEl = null;
  let metaEl = null;
  let jumpDeck = null;
  let isOpen = false;
  let pendingProgrammaticBack = false;

  // 当前这次打开所用的数据源与文案。open() 每次调用时重设，
  // 不传则回落副本推演 —— 保证副本那边的原有调用方式完全不变。
  let activeSource = null;
  let activeLabels = null;

  // 默认（副本推演）数据源与文案
  const DEFAULT_SOURCE = () => (window.ForkRunApi && typeof ForkRunApi.getLastContextSnapshot === 'function')
    ? ForkRunApi.getLastContextSnapshot()
    : null;
  const DEFAULT_LABELS = {
    assistantZh: '推演',
    summaryTitle: '最近推演上下文快照',
    emptyDesc: '这条世界线尚未发起过推演，发送一次行动后即可查看。'
  };

  /* ---------------- 工具 ---------------- */

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;')
      .replace(/'/g, '&#39;');
  }

  function formatStamp(timestamp) {
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  // role → 展示标签（纯文字，无 emoji）。assistant 的中文名按场景走，
  // 副本叫「推演」，助手私聊叫「助手」。
  function roleLabel(role) {
    const labels = activeLabels || DEFAULT_LABELS;
    switch (role) {
      case 'system': return { zh: '系统', en: 'SYSTEM' };
      case 'user': return { zh: '执行员', en: 'USER' };
      case 'assistant': return { zh: labels.assistantZh || '助手', en: 'ASSISTANT' };
      default: return { zh: role || '未知', en: String(role || 'UNKNOWN').toUpperCase() };
    }
  }

  /* ---------------- DOM 构建（首次调用时懒建） ---------------- */

  function ensureDOM() {
    if (page) return;

    page = document.createElement('div');
    page.id = PAGE_ID;
    page.className = 'app-fullscreen-page fork-ctx-inspector-page';
    page.setAttribute('aria-hidden', 'true');
    page.hidden = true;

    page.innerHTML = `
      <div class="page-inner-container">
        <header class="chat-settings-header">
          <button class="chat-settings-back-btn" id="forkCtxBackBtn" type="button" aria-label="返回设置" title="返回设置">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
            </svg>
          </button>
          <div class="chat-settings-header-title">
            <span class="chat-settings-title-zh">上下文查看</span>
            <span class="chat-settings-title-en">CONTEXT INSPECTOR</span>
          </div>
          <button class="chat-settings-back-btn fork-ctx-refresh-btn" id="forkCtxRefreshBtn" type="button" aria-label="刷新" title="刷新最新上下文">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M17.65 6.35A7.958 7.958 0 0012 4a8 8 0 108 8h-2a6 6 0 11-6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
            </svg>
          </button>
        </header>

        <div class="fork-ctx-body" id="forkCtxList"></div>

        <!-- 双向跳跃槽：复用聊天页同款，查看器无输入台故单独压低底距 -->
        <div class="chat-jump-deck fork-ctx-jump-deck" id="forkCtxJumpDeck" aria-label="上下文滚动定位">
          <button type="button" class="chat-jump-btn is-top" id="forkCtxJumpTopBtn" aria-label="回到顶部" title="回到顶部 (TOP)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z"/></svg>
          </button>
          <button type="button" class="chat-jump-btn is-bottom" id="forkCtxJumpBottomBtn" aria-label="回到底部" title="回到底部 (BOTTOM)">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z"/></svg>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(page);

    listEl = page.querySelector('#forkCtxList');
    jumpDeck = page.querySelector('#forkCtxJumpDeck');

    const backBtn = page.querySelector('#forkCtxBackBtn');
    if (backBtn) backBtn.addEventListener('click', close);

    const refreshBtn = page.querySelector('#forkCtxRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        render();
        if (window.RetroToast) {
          RetroToast.show({ tag: 'CONTEXT // 已刷新', message: '已拉取最新上下文快照', type: 'info' });
        }
      });
    }

    // 双向跳跃槽：滚动容器是 listEl（.fork-ctx-body 自身滚动）。
    // 这里不需要聊天页那套「逐帧锁底」——上下文全是纯文本，没有图片渐进撑开，
    // 一次 scrollTo 即可到位。
    const jumpTopBtn = page.querySelector('#forkCtxJumpTopBtn');
    const jumpBottomBtn = page.querySelector('#forkCtxJumpBottomBtn');
    if (jumpTopBtn) {
      jumpTopBtn.addEventListener('click', () => {
        if (listEl) listEl.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    if (jumpBottomBtn) {
      jumpBottomBtn.addEventListener('click', () => {
        if (listEl) listEl.scrollTo({ top: listEl.scrollHeight, behavior: 'smooth' });
      });
    }
    if (listEl) {
      listEl.addEventListener('scroll', updateJumpDeckVisibility, { passive: true });
    }

    // 原生右滑返回手势（左缘起手）
    let touchStartX = 0;
    page.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });
    page.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      if (touchStartX < 36 && touchEndX - touchStartX > 70) close();
    }, { passive: true });

    window.addEventListener('popstate', () => {
      if (pendingProgrammaticBack) {
        pendingProgrammaticBack = false;
        return;
      }
      if (isOpen && (window.location.hash || '') !== HASH) {
        dismissUI();
      }
    });
  }

  /* ---------------- 渲染 ---------------- */

  /**
   * 跳跃槽显隐：只在「既不在顶、也不在底」时亮起，与聊天页同口径。
   * 内容不足一屏时一律隐藏。
   */
  function updateJumpDeckVisibility() {
    if (!jumpDeck || !listEl) return;
    const maxScroll = listEl.scrollHeight - listEl.clientHeight;
    if (maxScroll <= 30) {
      jumpDeck.classList.remove('is-visible');
      return;
    }
    const isAtTop = listEl.scrollTop <= 35;
    const isAtBottom = (maxScroll - listEl.scrollTop) <= 35;
    if (!isAtTop && !isAtBottom) {
      jumpDeck.classList.add('is-visible');
    } else {
      jumpDeck.classList.remove('is-visible');
    }
  }

  function renderEmpty(msg) {
    const labels = activeLabels || DEFAULT_LABELS;
    if (listEl) {
      listEl.innerHTML = `
        <div class="fork-ctx-empty">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z"/>
          </svg>
          <span class="fork-ctx-empty-title">暂无上下文</span>
          <span class="fork-ctx-empty-desc">${escapeHtml(msg || labels.emptyDesc || DEFAULT_LABELS.emptyDesc)}</span>
        </div>
      `;
    }
    // 空态不可滚动，跳跃槽一律收起
    if (jumpDeck) jumpDeck.classList.remove('is-visible');
  }

  function render() {
    const labels = activeLabels || DEFAULT_LABELS;
    const getSnap = activeSource || DEFAULT_SOURCE;
    let snap = null;
    try {
      snap = getSnap();
    } catch (err) {
      console.warn('[ContextInspector] 快照读取失败：', err);
    }

    if (!snap || !Array.isArray(snap.messages) || !snap.messages.length) {
      renderEmpty();
      return;
    }

    const m = snap.meta || {};
    const stamp = formatStamp(snap.at);

    if (listEl) {
      const frag = document.createDocumentFragment();

      // 1. 战术概览大卡（置顶融入滚动流，可被自然滚上去）
      const summaryCard = document.createElement('div');
      summaryCard.className = 'fork-ctx-summary-card';
      summaryCard.innerHTML = `
        <div class="fork-ctx-summary-head">
          <div class="fork-ctx-summary-tag">
            <span class="fork-ctx-summary-tag-code">TELEMETRY // SNAPSHOT</span>
            <span class="fork-ctx-summary-tag-title">${escapeHtml(labels.summaryTitle || DEFAULT_LABELS.summaryTitle)}</span>
          </div>
          <span class="fork-ctx-summary-stamp">${escapeHtml(stamp)}</span>
        </div>
        <div class="fork-ctx-summary-grid">
          <div class="fork-ctx-stat-cell is-highlight">
            <span class="fork-ctx-stat-label">TOKENS 估算</span>
            <span class="fork-ctx-stat-val is-accent">${Number(m.totalTokens || 0).toLocaleString()}</span>
          </div>
          <div class="fork-ctx-stat-cell">
            <span class="fork-ctx-stat-label">消息总数</span>
            <span class="fork-ctx-stat-val">${m.messageCount || snap.messages.length} 条</span>
          </div>
          <div class="fork-ctx-stat-cell">
            <span class="fork-ctx-stat-label">历史装入</span>
            <span class="fork-ctx-stat-val">${m.keptRecords || 0} / ${m.totalRecords || 0}</span>
          </div>
          <div class="fork-ctx-stat-cell">
            <span class="fork-ctx-stat-label">深度注入</span>
            <span class="fork-ctx-stat-val">${m.depthCount || 0} 项</span>
          </div>
          <div class="fork-ctx-stat-cell">
            <span class="fork-ctx-stat-label">正文字符</span>
            <span class="fork-ctx-stat-val">${Number(m.totalChars || 0).toLocaleString()}</span>
          </div>
          <div class="fork-ctx-stat-cell">
            <span class="fork-ctx-stat-label">推演模式</span>
            <span class="fork-ctx-stat-val">${m.streamingWillUse ? '流式输出' : '非流式输出'}</span>
          </div>
        </div>
        <div class="fork-ctx-summary-model-row">
          <span class="fork-ctx-model-label">当前模型</span>
          <span class="fork-ctx-model-val">${escapeHtml(m.model || '系统默认')}</span>
        </div>
      `;
      frag.appendChild(summaryCard);

      // 2. 消息流
      snap.messages.forEach((msg, idx) => {
        const label = roleLabel(msg.role);
        const chars = (msg.content || '').length;
        const item = document.createElement('div');
        item.className = `fork-ctx-msg role-${msg.role || 'unknown'}`;
        item.innerHTML = `
          <div class="fork-ctx-msg-head">
            <span class="fork-ctx-msg-index">#${String(idx + 1).padStart(2, '0')}</span>
            <div class="fork-ctx-msg-pill role-${msg.role || 'unknown'}">
              <span class="fork-ctx-msg-role-zh">${escapeHtml(label.zh)}</span>
              <span class="fork-ctx-msg-role-en">${escapeHtml(label.en)}</span>
            </div>
            <span class="fork-ctx-msg-chars">${chars.toLocaleString()} 字</span>
          </div>
          <div class="fork-ctx-msg-body">${escapeHtml(msg.content || '')}</div>
        `;
        frag.appendChild(item);
      });

      listEl.innerHTML = '';
      listEl.appendChild(frag);
      listEl.scrollTop = 0;
      // 内容刚换，高度已变：下一帧按新高度重算跳跃槽显隐
      requestAnimationFrame(updateJumpDeckVisibility);
    }
  }

  /* ---------------- 开关 ---------------- */

  /**
   * 打开查看器。
   * @param {Object} [opts]
   * @param {Function} [opts.source] 快照 getter，返回 { at, messages, meta }。
   *                                 不传则取副本推演的快照（保持原有调用方式）。
   * @param {Object} [opts.labels] 文案覆盖：{ assistantZh, summaryTitle, emptyDesc }
   */
  function open(opts) {
    ensureDOM();
    if (!page) return;

    const o = opts || {};
    activeSource = typeof o.source === 'function' ? o.source : null;
    activeLabels = (o.labels && typeof o.labels === 'object')
      ? Object.assign({}, DEFAULT_LABELS, o.labels)
      : null;

    render();

    page.hidden = false;
    page.setAttribute('aria-hidden', 'false');
    void page.offsetWidth;
    page.classList.add('active');
    document.body.classList.add('page-active');
    isOpen = true;

    try {
      history.pushState({ rfPage: 'fork-ctx' }, '', HASH);
    } catch (e) { /* ignore */ }
  }

  function dismissUI() {
    if (!page) return;
    page.setAttribute('aria-hidden', 'true');
    page.classList.remove('active');
    document.body.classList.remove('page-active');
    // 跳跃槽是 fixed 定位，不随页面隐藏自动消失，必须显式收起
    if (jumpDeck) jumpDeck.classList.remove('is-visible');
    setTimeout(() => {
      if (page && !page.classList.contains('active')) page.hidden = true;
    }, 360);
    isOpen = false;
  }

  function close() {
    if (!page || !page.classList.contains('active')) return;
    dismissUI();
    if ((window.location.hash || '') === HASH) {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (e) { /* ignore */ }
    }
  }

  return { open, close };
})();
