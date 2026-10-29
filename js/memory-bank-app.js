/**
 * ============================================================================
 * 溯流计划 · 数据归档 // 记忆库 (MemoryBankApp)
 * 桌面 02「02 数据归档 MEMORY BANK // 记忆库」全屏应用
 *
 * 规范依据：
 *   - design/记忆库架构与事件记忆规范.md
 *   - iOS 灵动岛保护、零 Emoji、零物理分割线、纯矢量 SVG
 *   - 方案 A：底部悬浮「因果双模微型梭芯」（Tactical Shuttle Pill）
 * ============================================================================
 */
const MemoryBankApp = (() => {
  'use strict';

  // 状态机
  let isOpen = false;
  let activeTab = 'fork'; // 'fork' | 'char'
  let currentFilter = 'all'; // 'all' | 'canonical' | 'candidate'
  let selectedCharId = 'all'; // 'all' | 'char-eva' | ...
  let activeKeyword = '';
  let searchQuery = '';
  let isSearchOpen = false;

  // 假数据角色档案字典（用于在场角色名牌与角色 Tab 展现）
  const CHAR_PROFILES = {
    'char-eva': {
      id: 'char-eva',
      name: '伊娃',
      code: 'EVA // 07',
      role: '方舟领航员 · 高危角色',
      threat: 'CRITICAL',
      desc: '在第七回响中同行的核心变量，持有部分深潜频段密钥。'
    },
    'char-chen': {
      id: 'char-chen',
      name: '陈队长',
      code: 'CAPT. CHEN',
      role: '地表防卫队指挥官',
      threat: 'HIGH',
      desc: '第七哨所最高战术指挥，多次在避难所因果抉择现场。'
    },
    'char-lucia': {
      id: 'char-lucia',
      name: '露西亚',
      code: 'LUCIA // OBS',
      role: '晚宴见证者 · 教会隐秘密探',
      threat: 'ELEVATED',
      desc: '绯色晚宴中暗中观测执行员的目击者，具有跨线记忆痕迹。'
    }
  };

  /* ---------------- SVG 资产（严格零 Emoji） ---------------- */
  const ICONS = {
    back: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    fork: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/><path d="M18 9v0"/></svg>`,
    char: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    canonStar: `<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`
  };

  /* ---------------- DOM 结构装配 ---------------- */
  let containerEl = null;

  function ensureDOM() {
    if (containerEl) return;

    containerEl = document.createElement('div');
    containerEl.id = 'memoryBankApp';
    containerEl.className = 'mem-app-container';
    containerEl.setAttribute('role', 'dialog');
    containerEl.setAttribute('aria-label', '数据归档记忆库');
    containerEl.setAttribute('aria-modal', 'true');

    containerEl.innerHTML = `
      <div class="mem-app-inner">
        <!-- 顶部灵动岛安全区保护层 + 战术顶栏 -->
        <header class="mem-header">
          <div class="mem-header-main">
            <button class="mem-icon-btn mem-back-btn" id="memBackBtn" type="button" aria-label="返回桌面">
              ${ICONS.back}
            </button>
            <div class="mem-title-block">
              <span class="mem-code-tag">02 // MEMORY BANK</span>
              <h2 class="mem-title-text">数据归档 · 记忆中枢</h2>
            </div>
            <div class="mem-header-actions">
              <button class="mem-icon-btn" id="memSearchToggleBtn" type="button" aria-label="检索">
                ${ICONS.search}
              </button>
            </div>
          </div>

          <!-- 可折叠搜索输入框 -->
          <div class="mem-search-bar" id="memSearchBar" hidden>
            <div class="mem-search-inner">
              <span class="mem-search-icon">${ICONS.search}</span>
              <input type="text" id="memSearchInput" class="mem-search-input" placeholder="检索记忆因果、关键词、在场角色..." autocomplete="off">
              <button type="button" id="memSearchClearBtn" class="mem-search-clear-btn" aria-label="清空检索">
                ${ICONS.close}
              </button>
            </div>
          </div>
        </header>

        <!-- 滚动主视口 -->
        <main class="mem-viewport" id="memViewport">
          <!-- 统计概览微仪表区 -->
          <section class="mem-stats-section" id="memStatsSection"></section>

          <!-- 模式专属筛选器（正史/候选/关键词/角色抽屉） -->
          <section class="mem-filter-section" id="memFilterSection"></section>

          <!-- 记忆卡片流 -->
          <section class="mem-stream-section" id="memStreamSection"></section>
        </main>

        <!-- 方案 A：底部悬浮「因果双模微型梭芯」（Tactical Shuttle Pill） -->
        <div class="mem-shuttle-wrapper" id="memShuttleWrapper">
          <nav class="mem-shuttle-pill" role="tablist" aria-label="记忆双模视界切换">
            <div class="mem-shuttle-slider" id="memShuttleSlider"></div>
            <button type="button" class="mem-shuttle-item is-active" id="memTabFork" data-tab="fork" role="tab" aria-selected="true">
              <span class="mem-shuttle-icon">${ICONS.fork}</span>
              <span class="mem-shuttle-label">事件记忆</span>
              <span class="mem-shuttle-sub">EVENT MEMORY</span>
            </button>
            <button type="button" class="mem-shuttle-item" id="memTabChar" data-tab="char" role="tab" aria-selected="false">
              <span class="mem-shuttle-icon">${ICONS.char}</span>
              <span class="mem-shuttle-label">角色回响</span>
              <span class="mem-shuttle-sub">RESONANCE</span>
            </button>
          </nav>
        </div>
      </div>
    `;

    document.body.appendChild(containerEl);
    bindEvents();
  }

  function bindEvents() {
    // 返回
    const backBtn = containerEl.querySelector('#memBackBtn');
    if (backBtn) backBtn.addEventListener('click', close);

    // 搜索开关
    const searchToggleBtn = containerEl.querySelector('#memSearchToggleBtn');
    const searchBar = containerEl.querySelector('#memSearchBar');
    const searchInput = containerEl.querySelector('#memSearchInput');
    const searchClearBtn = containerEl.querySelector('#memSearchClearBtn');

    if (searchToggleBtn && searchBar && searchInput) {
      searchToggleBtn.addEventListener('click', () => {
        isSearchOpen = !isSearchOpen;
        searchBar.hidden = !isSearchOpen;
        if (isSearchOpen) {
          searchInput.focus();
        } else {
          searchQuery = '';
          searchInput.value = '';
          renderContent();
        }
      });

      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim().toLowerCase();
        renderContent();
      });

      if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
          searchQuery = '';
          searchInput.value = '';
          renderContent();
          searchInput.focus();
        });
      }
    }

    // 底部双模微梭芯切档
    const tabFork = containerEl.querySelector('#memTabFork');
    const tabChar = containerEl.querySelector('#memTabChar');

    if (tabFork) {
      tabFork.addEventListener('click', () => switchTab('fork'));
    }
    if (tabChar) {
      tabChar.addEventListener('click', () => switchTab('char'));
    }
  }

  /* ---------------- 模态开启与关闭 ---------------- */
  async function open() {
    ensureDOM();
    // 确保假数据已播种
    if (window.MemoryStore && typeof MemoryStore.seedDemoMemories === 'function') {
      await MemoryStore.seedDemoMemories();
    }
    isOpen = true;
    containerEl.classList.add('is-open');
    document.body.classList.add('mem-bank-modal-active');
    await renderAll();
  }

  function close() {
    if (!containerEl) return;
    isOpen = false;
    containerEl.classList.remove('is-open');
    document.body.classList.remove('mem-bank-modal-active');
  }

  /* ---------------- 切换 Tab ---------------- */
  async function switchTab(tab) {
    if (activeTab === tab) return;
    activeTab = tab;
    activeKeyword = '';
    selectedCharId = 'all';

    const tabFork = containerEl.querySelector('#memTabFork');
    const tabChar = containerEl.querySelector('#memTabChar');
    const slider = containerEl.querySelector('#memShuttleSlider');

    if (tab === 'fork') {
      tabFork.classList.add('is-active');
      tabFork.setAttribute('aria-selected', 'true');
      tabChar.classList.remove('is-active');
      tabChar.setAttribute('aria-selected', 'false');
      if (slider) slider.style.transform = 'translateX(0%)';
    } else {
      tabChar.classList.add('is-active');
      tabChar.setAttribute('aria-selected', 'true');
      tabFork.classList.remove('is-active');
      tabFork.setAttribute('aria-selected', 'false');
      if (slider) slider.style.transform = 'translateX(100%)';
    }

    await renderContent();
  }

  /* ---------------- 核心渲染逻辑 ---------------- */
  async function renderAll() {
    await renderStats();
    await renderContent();
  }

  /** 渲染顶部统计微指标 */
  async function renderStats() {
    const statsEl = containerEl.querySelector('#memStatsSection');
    if (!statsEl) return;

    let stats = { total: 4, eventCount: 4, forkCount: 2, candidateCount: 4 };
    if (window.MemoryStore && typeof MemoryStore.getStats === 'function') {
      stats = await MemoryStore.getStats();
    }

    statsEl.innerHTML = `
      <div class="mem-stats-strip">
        <div class="mem-stat-pill">
          <span class="mem-stat-dot"></span>
          <span class="mem-stat-num">${stats.eventCount}</span>
          <span class="mem-stat-label">归档事实</span>
        </div>
        <div class="mem-stat-pill">
          <span class="mem-stat-num">${stats.forkCount}</span>
          <span class="mem-stat-label">涉入世界</span>
        </div>
        <div class="mem-stat-pill">
          <span class="mem-stat-num">${Object.keys(CHAR_PROFILES).length}</span>
          <span class="mem-stat-label">在场高危</span>
        </div>
        <div class="mem-stat-pill mem-stat-canon">
          <span class="mem-stat-num">2</span>
          <span class="mem-stat-label">正史生效</span>
        </div>
      </div>
    `;
  }

  /** 渲染当前 Tab 对应的主体与卡片流 */
  async function renderContent() {
    const filterEl = containerEl.querySelector('#memFilterSection');
    const streamEl = containerEl.querySelector('#memStreamSection');
    if (!filterEl || !streamEl) return;

    if (activeTab === 'fork') {
      await renderForkView(filterEl, streamEl);
    } else {
      await renderCharView(filterEl, streamEl);
    }
  }

  /* ---------------- 视图 1：副本记忆（CHRONICLE） ---------------- */
  async function renderForkView(filterEl, streamEl) {
    // 1. 取出全部事件记忆
    let allMemories = [];
    if (window.Storage && typeof Storage.getAllMemories === 'function') {
      allMemories = await Storage.getAllMemories();
    }
    const events = allMemories.filter((m) => m.memKind === 'event');

    // 2. 收集高频关键词
    const kwMap = new Map();
    events.forEach((m) => {
      (m.keywords || []).forEach((k) => {
        kwMap.set(k, (kwMap.get(k) || 0) + 1);
      });
    });
    const topKeywords = Array.from(kwMap.keys()).slice(0, 7);

    // 3. 渲染筛选区（正史/候选过滤 + 关键词微标签）
    filterEl.innerHTML = `
      <div class="mem-subfilter-row">
        <div class="mem-status-filter-pills">
          <button type="button" class="mem-status-pill ${currentFilter === 'all' ? 'is-active' : ''}" data-status="all">全部事件</button>
          <button type="button" class="mem-status-pill ${currentFilter === 'canonical' ? 'is-active' : ''}" data-status="canonical">仅正史生效</button>
          <button type="button" class="mem-status-pill ${currentFilter === 'candidate' ? 'is-active' : ''}" data-status="candidate">候补待决</button>
        </div>
      </div>

      <div class="mem-keyword-cloud">
        <span class="mem-kw-title">因果锚点:</span>
        <button type="button" class="mem-kw-chip ${activeKeyword === '' ? 'is-active' : ''}" data-kw="">全部</button>
        ${topKeywords.map((k) => `
          <button type="button" class="mem-kw-chip ${activeKeyword === k ? 'is-active' : ''}" data-kw="${escapeHtml(k)}">#${escapeHtml(k)}</button>
        `).join('')}
      </div>
    `;

    // 绑定筛选事件
    filterEl.querySelectorAll('.mem-status-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentFilter = btn.dataset.status;
        renderContent();
      });
    });

    filterEl.querySelectorAll('.mem-kw-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        activeKeyword = btn.dataset.kw;
        renderContent();
      });
    });

    // 4. 执行数据过滤
    let filtered = events;
    if (currentFilter === 'canonical') {
      // 假数据中 run-demo-canon 视作当前正史
      filtered = filtered.filter((m) => m.runId === 'run-demo-canon' || m.status === 'settled');
    } else if (currentFilter === 'candidate') {
      filtered = filtered.filter((m) => m.status === 'abandoned');
    }

    if (activeKeyword) {
      filtered = filtered.filter((m) => (m.keywords || []).includes(activeKeyword));
    }

    if (searchQuery) {
      filtered = filtered.filter((m) => {
        const text = `${m.forkTitle || ''} ${m.summary || ''} ${(m.keywords || []).join(' ')}`.toLowerCase();
        return text.includes(searchQuery);
      });
    }

    // 5. 渲染卡片流
    if (filtered.length === 0) {
      streamEl.innerHTML = `
        <div class="mem-empty-box">
          <div class="mem-empty-code">NO CAUSAL TRACE // 无因果痕迹</div>
          <div class="mem-empty-text">当前筛选条件下未检索到相关事件归档</div>
        </div>
      `;
      return;
    }

    streamEl.innerHTML = filtered.map((m) => renderEventCard(m)).join('');
  }

  function renderEventCard(m) {
    const isCanon = m.runId === 'run-demo-canon' || (m.status === 'settled' && m.forkId !== 'fork-ark-01');
    const isAbandoned = m.status === 'abandoned';

    return `
      <article class="mem-card ${isCanon ? 'is-canonical' : ''} ${isAbandoned ? 'is-abandoned' : ''}">
        <!-- 卡头：副本名 + 周目代号 + 正史金标 -->
        <div class="mem-card-head">
          <div class="mem-card-head-left">
            <span class="mem-card-fork-title">${escapeHtml(m.forkTitle || '未知分支')}</span>
            <span class="mem-card-run-badge">RUN-${m.runSeq || 1}</span>
          </div>
          <div class="mem-card-head-right">
            ${isCanon ? `
              <span class="mem-canon-badge">
                ${ICONS.canonStar}
                <span>正史生效</span>
              </span>
            ` : `
              <span class="mem-candidate-badge">候补候选</span>
            `}
            <span class="mem-imp-tag">PRI.${m.importance || 3}</span>
          </div>
        </div>

        <!-- 卡片正文：精简因果叙事 -->
        <p class="mem-card-summary">${escapeHtml(m.summary || '')}</p>

        <!-- 关键词微胶囊组（严格 5~6 枚） -->
        <div class="mem-card-keywords">
          ${(m.keywords || []).map((k) => `
            <span class="mem-card-kw-pill">#${escapeHtml(k)}</span>
          `).join('')}
        </div>

        <!-- 卡尾：在场高危角色微标与时间 -->
        <div class="mem-card-foot">
          <div class="mem-card-witnesses">
            <span class="mem-witness-label">${ICONS.eye} 在场目击:</span>
            ${(m.witnessIds || []).map((wId) => {
              const prof = CHAR_PROFILES[wId] || { name: wId, threat: 'UNKNOWN' };
              return `
                <span class="mem-witness-chip threat-${(prof.threat || '').toLowerCase()}">
                  ${escapeHtml(prof.name)}
                </span>
              `;
            }).join('')}
          </div>
          <span class="mem-card-time">${formatTimeAgo(m.createdAt)}</span>
        </div>
      </article>
    `;
  }

  /* ---------------- 视图 2：角色记忆（RESONANCE） ---------------- */
  async function renderCharView(filterEl, streamEl) {
    // 1. 角色名录抽屉
    const charList = Object.values(CHAR_PROFILES);

    filterEl.innerHTML = `
      <div class="mem-char-selector-drawer">
        <button type="button" class="mem-char-chip ${selectedCharId === 'all' ? 'is-active' : ''}" data-char="all">
          <span class="mem-char-chip-name">全在场名单</span>
          <span class="mem-char-chip-count">${charList.length}</span>
        </button>
        ${charList.map((c) => `
          <button type="button" class="mem-char-chip ${selectedCharId === c.id ? 'is-active' : ''}" data-char="${c.id}">
            <span class="mem-char-chip-name">${escapeHtml(c.name)}</span>
            <span class="mem-char-chip-threat">${c.threat}</span>
          </button>
        `).join('')}
      </div>
    `;

    filterEl.querySelectorAll('.mem-char-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCharId = btn.dataset.char;
        renderContent();
      });
    });

    // 2. 角色档案概览（若选中单一角色）
    let charHeaderHtml = '';
    if (selectedCharId !== 'all') {
      const activeChar = CHAR_PROFILES[selectedCharId];
      if (activeChar) {
        charHeaderHtml = `
          <div class="mem-char-profile-card">
            <div class="mem-char-pro-head">
              <span class="mem-char-pro-name">${escapeHtml(activeChar.name)}</span>
              <span class="mem-char-pro-code">${escapeHtml(activeChar.code)}</span>
              <span class="mem-char-pro-threat threat-${activeChar.threat.toLowerCase()}">${activeChar.threat}</span>
            </div>
            <div class="mem-char-pro-role">${escapeHtml(activeChar.role)}</div>
            <p class="mem-char-pro-desc">${escapeHtml(activeChar.desc)}</p>
          </div>
        `;
      }
    }

    // 3. 取出该角色目击的事件记忆
    let memories = [];
    if (window.Storage && typeof Storage.getAllMemories === 'function') {
      const all = await Storage.getAllMemories();
      memories = all.filter((m) => m.memKind === 'event');
    }

    let charEvents = memories;
    if (selectedCharId !== 'all') {
      charEvents = memories.filter((m) => (m.witnessIds || []).includes(selectedCharId));
    }

    if (searchQuery) {
      charEvents = charEvents.filter((m) => {
        const text = `${m.forkTitle || ''} ${m.summary || ''} ${(m.keywords || []).join(' ')}`.toLowerCase();
        return text.includes(searchQuery);
      });
    }

    if (charEvents.length === 0) {
      streamEl.innerHTML = `
        ${charHeaderHtml}
        <div class="mem-empty-box">
          <div class="mem-empty-code">NO SHARED WITNESS // 无共时目击</div>
          <div class="mem-empty-text">该角色在当前检索范围内未见证任何归档事实</div>
        </div>
      `;
      return;
    }

    streamEl.innerHTML = `
      ${charHeaderHtml}
      <div class="mem-char-stream-header">
        <span class="mem-char-stream-title">回响事件列表（该角色在场经历）:</span>
        <span class="mem-char-stream-count">${charEvents.length} 条</span>
      </div>
      ${charEvents.map((m) => renderEventCard(m)).join('')}
    `;
  }

  /* ---------------- 工具函数 ---------------- */
  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"' };
    return String(str || '').replace(/[&<>"]/g, (c) => map[c]);
  }

  function formatTimeAgo(ts) {
    if (!ts) return '近期';
    const diff = Date.now() - Number(ts);
    const hours = Math.floor(diff / 3600000);
    if (hours < 1) return '刚刚';
    if (hours < 24) return `${hours}小时前`;
    const days = Math.floor(hours / 24);
    return `${days}天前`;
  }

  return {
    open,
    close,
    switchTab
  };
})();

window.MemoryBankApp = MemoryBankApp;
