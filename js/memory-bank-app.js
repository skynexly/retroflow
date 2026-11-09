/**
 * ============================================================================
 * 溯流计划 · 数据归档 // 记忆库 (MemoryBankApp)
 * 桌面 02「02 数据归档 MEMORY BANK // 记忆库」全屏应用
 *
 * 形态：两层。
 *   外层 = 卷宗格墙：一个副本一张档案卡（封面作证据照 + 等级 + 记忆条数）
 *   内层 = 单本卷宗：认定分支的记忆平铺，其余分支折叠在「其他分支」里
 *
 * 与副本库的关系：副本库把世界装裱成油画供观赏，数据归档把发生过的事
 * 归档成卷宗供查证。两者共用同一份 fork 索引与封面资产，语汇刻意不同。
 *
 * 数据来源全部为真：
 *   副本清单   Store.fork.index（编纂器维护）
 *   分支与认定 ForkRunStore.getIndex / listRuns（canonicalRunId 指针）
 *   记忆本体   MemoryStore.listCandidates（IndexedDB memories）
 *   在场角色名 Store.roster（characters / npcs 现取，不存快照）
 *
 * 规范：零 Emoji、零分割线、纯矢量 SVG、iOS 灵动岛保护、
 *       配色一律走主题变量、接 history 栈支持系统返回手势逐级退。
 * ============================================================================
 */
const MemoryBankApp = (() => {
  'use strict';

  /* ---------------- 等级字典（与副本库同源，水相七档） ---------------- */
  const LEVEL_MAP = {
    'E': { letter: 'E', name: '静水', enName: 'STILL' },
    'D': { letter: 'D', name: '流深', enName: 'DEPTH' },
    'C': { letter: 'C', name: '清源', enName: 'SPRING' },
    'B': { letter: 'B', name: '狂澜', enName: 'SURGE' },
    'A': { letter: 'A', name: '潮汐', enName: 'TIDE' },
    'S': { letter: 'S', name: '深渊', enName: 'ABYSS' },
    'S+': { letter: 'S+', name: '归墟', enName: 'VOID' }
  };

  const LEVEL_SVGS = {
    'E': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'D': `<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'C': `<svg viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    'B': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'A': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    'S': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    'S+': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  /* ---------------- SVG 图标（零 Emoji） ---------------- */
  const ICONS = {
    back: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>`,
    chevron: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`,
    seal: `<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><path d="M7.9 12.3l2.8 2.8 5.4-5.8"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
    witness: `<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 12s3.9-6.6 10.2-6.6S22.2 12 22.2 12s-3.9 6.6-10.2 6.6S1.8 12 1.8 12z"/><circle cx="12" cy="12" r="2.7"/></svg>`,
    emptyBox: `<svg viewBox="0 0 48 48" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 18h32v20a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3V18z"/><path d="M5 12h38v6H5z"/><path d="M20 25h8"/></svg>`
  };

  /* ---------------- 运行态 ---------------- */
  let containerEl = null;
  let viewportEl = null;
  let headerEl = null;
  let isOpened = false;
  let pendingProgrammaticBack = false;
  /** 当前展开的副本 id；空串 = 停在卷宗格墙 */
  let currentForkId = '';
  /** 「其他分支」是否展开 */
  let othersExpanded = false;
  /** 本次持有的封面 objectURL，重绘或关页统一释放 */
  let coverUrls = [];

  /** 早期版本会往库里播种 4 条演示记忆，这里一次性清掉，之后不再播种 */
  const DEMO_PURGE_FLAG = 'retroflow_memory_demo_purged_v1';

  async function purgeDemoOnce() {
    try {
      if (localStorage.getItem(DEMO_PURGE_FLAG)) return;
      if (window.MemoryStore && typeof MemoryStore.purgeDemoMemories === 'function') {
        await MemoryStore.purgeDemoMemories();
      }
      localStorage.setItem(DEMO_PURGE_FLAG, '1');
    } catch (_) { /* 清不掉也不挡页面 */ }
  }

  /* ---------------- 数据读取 ---------------- */

  /** 副本清单：与副本库同源，按创建序号升序，无号的老数据沉底 */
  function readForkIndex() {
    if (!window.Store || !Store.fork || !Array.isArray(Store.fork.index)) return [];
    const seqOf = (it) => {
      const n = Number(it && it.seq);
      return Number.isFinite(n) && n > 0 ? n : 0;
    };
    return Store.fork.index
      .filter(Boolean)
      .slice()
      .sort((a, b) => {
        const sa = seqOf(a);
        const sb = seqOf(b);
        if (sa && sb) return sa - sb;
        if (sa) return -1;
        if (sb) return 1;
        return (a.updatedAt || 0) - (b.updatedAt || 0);
      });
  }

  /** 一次取全量记忆，按 forkId 汇总条数（避免逐副本各查一次全表） */
  async function collectCounts() {
    const map = new Map();
    if (!window.Storage || typeof Storage.getAllMemories !== 'function') return map;
    try {
      const all = await Storage.getAllMemories();
      all.forEach((m) => {
        if (!m || m.memKind !== 'event') return;
        const k = String(m.forkId || '');
        if (!k) return;
        map.set(k, (map.get(k) || 0) + 1);
      });
    } catch (_) { /* 读不到就按 0 条呈现 */ }
    return map;
  }

  /** 在场角色名：roster 是权威源，记忆里只存 ID */
  function rosterName(id) {
    const key = String(id || '').trim();
    if (!key) return '';
    const roster = (window.Store && Store.roster) || {};
    const chars = Array.isArray(roster.characters) ? roster.characters : [];
    const npcs = Array.isArray(roster.npcs) ? roster.npcs : [];
    const hit = chars.find((c) => c && c.id === key) || npcs.find((n) => n && n.id === key);
    return (hit && hit.name) ? String(hit.name) : key;
  }

  function levelOf(item) {
    return LEVEL_MAP[(item && item.levelKey) || 'C'] || LEVEL_MAP['C'];
  }

  function forkCode(item) {
    if (item && item.code) return String(item.code);
    const seq = Number(item && item.seq);
    return Number.isFinite(seq) && seq > 0 ? `FORK-${String(seq).padStart(2, '0')}` : 'FORK-待归档';
  }

  /* ---------------- DOM 装配 ---------------- */

  function ensureDOM() {
    if (containerEl) return;
    containerEl = document.createElement('div');
    containerEl.id = 'memoryBankApp';
    containerEl.className = 'mem-app';
    containerEl.setAttribute('role', 'dialog');
    containerEl.setAttribute('aria-label', '数据归档记忆库');
    containerEl.setAttribute('aria-modal', 'true');
    containerEl.innerHTML = `
      <div class="mem-app-inner">
        <header class="mem-header" id="memHeader"></header>
        <main class="mem-viewport" id="memViewport"></main>
      </div>
    `;
    document.body.appendChild(containerEl);
    headerEl = containerEl.querySelector('#memHeader');
    viewportEl = containerEl.querySelector('#memViewport');
  }

  function renderHeader(mode, fork) {
    if (!headerEl) return;
    if (mode === 'detail') {
      const lvl = levelOf(fork);
      headerEl.innerHTML = `
        <button class="mem-icon-btn" id="memBackBtn" type="button" aria-label="返回卷宗墙">${ICONS.back}</button>
        <div class="mem-title-block">
          <span class="mem-code-tag">${escapeHtml(forkCode(fork))} // ${lvl.letter} ${lvl.name}</span>
          <h2 class="mem-title-text">${escapeHtml((fork && fork.title) || '未命名副本')}</h2>
        </div>
      `;
    } else {
      headerEl.innerHTML = `
        <button class="mem-icon-btn" id="memBackBtn" type="button" aria-label="返回桌面">${ICONS.back}</button>
        <div class="mem-title-block">
          <span class="mem-code-tag">02 // MEMORY BANK</span>
          <h2 class="mem-title-text">数据归档</h2>
        </div>
      `;
    }
    const btn = headerEl.querySelector('#memBackBtn');
    if (btn) {
      btn.addEventListener('click', () => {
        if (currentForkId) backToWall();
        else close();
      });
    }
  }

  /* ---------------- 外层：卷宗格墙 ---------------- */

  function cardHtml(item, count) {
    const lvl = levelOf(item);
    const lvlSvg = LEVEL_SVGS[lvl.letter] || LEVEL_SVGS['C'];
    const title = (item && item.title) || '未命名副本';
    const fid = escapeHtml(item.id);
    return `
      <button type="button" class="mem-card" data-fork-id="${fid}" aria-label="${escapeHtml(title)} 的记忆卷宗">
        <span class="mem-card-photo" data-fork-id="${fid}">
          <span class="mem-card-totem">${lvlSvg}</span>
          <span class="mem-card-level" title="副本等级：${lvl.letter} / ${lvl.name}">
            <span class="mem-card-level-icon">${lvlSvg}</span>
            <span class="mem-card-level-letter">${lvl.letter}</span>
            <span class="mem-card-level-sep">/</span>
            <span class="mem-card-level-name">${lvl.name}</span>
          </span>
          ${count > 0 ? `<span class="mem-card-pip">${count}</span>` : ''}
        </span>
        <span class="mem-card-body">
          <span class="mem-card-code">${escapeHtml(forkCode(item))}</span>
          <span class="mem-card-title">${escapeHtml(title)}</span>
          <span class="mem-card-count ${count > 0 ? '' : 'is-empty'}">
            ${count > 0 ? `归档 ${count} 条` : '尚未归档'}
          </span>
        </span>
      </button>
    `;
  }

  async function renderWall() {
    if (!viewportEl) return;
    currentForkId = '';
    releaseCovers();
    renderHeader('wall');

    const forks = readForkIndex();
    const counts = await collectCounts();

    if (!forks.length) {
      viewportEl.innerHTML = `<div class="mem-wall mem-view-in">${emptyBoxHtml('ARCHIVE EMPTY', '副本库里还没有卷宗，先去编纂一个副本')}</div>`;
      return;
    }

    viewportEl.innerHTML = `
      <div class="mem-wall mem-view-in">
        <div class="mem-grid">
          ${forks.map((f) => cardHtml(f, counts.get(f.id) || 0)).join('')}
        </div>
      </div>
    `;

    viewportEl.querySelectorAll('.mem-card').forEach((card) => {
      card.addEventListener('click', () => {
        const fid = card.getAttribute('data-fork-id');
        if (fid) openFork(fid);
      });
    });

    hydrateCovers(forks);
  }

  /** 结构先落地，封面异步补挂；没有封面的卡片保留水相图腾占位 */
  async function hydrateCovers(items) {
    if (!viewportEl || !window.Storage || typeof Storage.getAssetSrc !== 'function') return;
    for (const item of items) {
      if (!item || !item.hasCover) continue;
      const key = window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.forkCover === 'function'
        ? DataRegistry.key.forkCover(item.id)
        : `fork/cover.${item.id}`;
      let src = '';
      try { src = await Storage.getAssetSrc(key); } catch (_) { continue; }
      if (!src) continue;
      // 用户可能已经切走或关页，挂载前确认还在墙上
      if (!isOpened || currentForkId) {
        try { Storage.revokeAssetSrc(src); } catch (_) {}
        continue;
      }
      const photo = viewportEl.querySelector(`.mem-card-photo[data-fork-id="${item.id}"]`);
      if (!photo) {
        try { Storage.revokeAssetSrc(src); } catch (_) {}
        continue;
      }
      coverUrls.push(src);
      const img = document.createElement('img');
      img.className = 'mem-card-img';
      img.src = src;
      img.alt = item.title || '副本封面';
      img.loading = 'lazy';
      photo.insertBefore(img, photo.firstChild);
      photo.classList.add('has-cover');
    }
  }

  function releaseCovers() {
    if (!coverUrls.length) return;
    coverUrls.forEach((u) => {
      try { Storage.revokeAssetSrc(u); } catch (_) {}
    });
    coverUrls = [];
  }

  /* ---------------- 内层：单本卷宗 ---------------- */

  async function openFork(forkId) {
    currentForkId = forkId;
    othersExpanded = false;
    try {
      window.history.pushState({ rfPage: 'memory-bank', forkId }, '', `#memory-bank/${forkId}`);
    } catch (_) {}
    await renderDetail(forkId);
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  async function renderDetail(forkId) {
    if (!viewportEl) return;
    releaseCovers();
    const forks = readForkIndex();
    const fork = forks.find((f) => f && f.id === forkId) || { id: forkId };
    renderHeader('detail', fork);

    let index = { canonicalRunId: '' };
    let runs = [];
    let memories = [];
    try { index = await ForkRunStore.getIndex(forkId); } catch (_) {}
    try { runs = await ForkRunStore.listRuns(forkId); } catch (_) {}
    try { memories = await MemoryStore.listCandidates(forkId); } catch (_) {}

    if (!memories.length) {
      viewportEl.innerHTML = `<div class="mem-detail mem-view-in">${emptyBoxHtml('NO RECORD', '这个副本还没有归档任何记忆')}</div>`;
      return;
    }

    // 按分支归组；组内按发生时间正序
    const byRun = new Map();
    memories.forEach((m) => {
      const k = String(m.runId || '');
      if (!byRun.has(k)) byRun.set(k, []);
      byRun.get(k).push(m);
    });
    byRun.forEach((list) => list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));

    const adoptedId = index && index.canonicalRunId ? index.canonicalRunId : '';
    const adopted = adoptedId ? (byRun.get(adoptedId) || []) : [];
    const otherKeys = Array.from(byRun.keys()).filter((k) => k !== adoptedId);
    const otherCount = otherKeys.reduce((n, k) => n + byRun.get(k).length, 0);

    const runLabel = (runId) => {
      const run = runs.find((r) => r && r.id === runId);
      if (run && window.ForkRunStore && typeof ForkRunStore.getRunDisplayLabel === 'function') {
        return ForkRunStore.getRunDisplayLabel(run, runs);
      }
      return '未归档分支';
    };

    let html = `<div class="mem-detail mem-view-in">`;

    // 认定分支
    if (adopted.length) {
      html += `
        <section class="mem-run-block is-adopted">
          <div class="mem-run-head">
            <span class="mem-run-label">${escapeHtml(runLabel(adoptedId))}</span>
            <span class="mem-run-badge">${ICONS.seal}<span>已认定</span></span>
          </div>
          ${adopted.map((m) => slipHtml(m)).join('')}
        </section>
      `;
    } else {
      html += `
        <section class="mem-run-block">
          <div class="mem-run-head">
            <span class="mem-run-label">尚未认定分支</span>
          </div>
          <p class="mem-run-hint">这个副本还没有认定任何分支。认定之后，那条分支的记忆会平铺在这里，助手与角色也只引用它。</p>
        </section>
      `;
    }

    // 其他分支（默认折叠）
    if (otherCount > 0) {
      html += `
        <button type="button" class="mem-other-toggle ${othersExpanded ? 'is-open' : ''}" id="memOtherToggle"
                aria-expanded="${othersExpanded ? 'true' : 'false'}">
          <span>其他分支 · ${otherCount} 条</span>
          <span class="mem-other-chevron">${ICONS.chevron}</span>
        </button>
        <div class="mem-others ${othersExpanded ? 'is-open' : ''}" id="memOthers">
          ${otherKeys.map((k) => `
            <section class="mem-run-block is-other">
              <div class="mem-run-head">
                <span class="mem-run-label">${escapeHtml(runLabel(k))}</span>
              </div>
              ${byRun.get(k).map((m) => slipHtml(m)).join('')}
            </section>
          `).join('')}
        </div>
      `;
    }

    html += `</div>`;
    viewportEl.innerHTML = html;

    const toggle = viewportEl.querySelector('#memOtherToggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        othersExpanded = !othersExpanded;
        toggle.classList.toggle('is-open', othersExpanded);
        toggle.setAttribute('aria-expanded', othersExpanded ? 'true' : 'false');
        const box = viewportEl.querySelector('#memOthers');
        if (box) box.classList.toggle('is-open', othersExpanded);
      });
    }
  }

  /** 一条记忆 = 一张档案条：正文为主，脚注一行交代时间与在场者 */
  function slipHtml(m) {
    const witnesses = (m.witnessIds || []).map(rosterName).filter(Boolean);
    return `
      <article class="mem-slip">
        <p class="mem-slip-text">${escapeHtml(m.summary || '')}</p>
        <div class="mem-slip-foot">
          <span class="mem-slip-meta">${ICONS.clock}${escapeHtml(formatTimeAgo(m.createdAt))}</span>
          ${witnesses.length ? `<span class="mem-slip-meta">${ICONS.witness}${escapeHtml(witnesses.join('、'))}</span>` : ''}
        </div>
      </article>
    `;
  }

  function emptyBoxHtml(code, text) {
    return `
      <div class="mem-empty">
        <span class="mem-empty-icon">${ICONS.emptyBox}</span>
        <div class="mem-empty-code">${escapeHtml(code)}</div>
        <div class="mem-empty-text">${escapeHtml(text)}</div>
      </div>
    `;
  }

  /* ---------------- 开关与路由 ---------------- */

  async function open() {
    ensureDOM();
    await purgeDemoOnce();
    isOpened = true;
    othersExpanded = false;
    currentForkId = '';
    containerEl.classList.add('is-open');
    if ((window.location.hash || '') !== '#memory-bank') {
      try {
        window.history.pushState({ rfPage: 'memory-bank' }, '', '#memory-bank');
      } catch (_) {}
    }
    await renderWall();
    if (viewportEl) viewportEl.scrollTop = 0;
  }

  /**
   * @param {boolean} silent 为 true 时只收视图、不动 history（popstate 复用）
   */
  function close(silent) {
    if (!containerEl || !isOpened) return;
    isOpened = false;
    currentForkId = '';
    releaseCovers();
    containerEl.classList.remove('is-open');
    if (silent) return;
    const hash = window.location.hash || '';
    if (hash === '#memory-bank' || hash.indexOf('#memory-bank/') === 0) {
      pendingProgrammaticBack = true;
      try { window.history.back(); } catch (_) { pendingProgrammaticBack = false; }
      setTimeout(() => { pendingProgrammaticBack = false; }, 320);
    }
  }

  /** 从卷宗详情退回格墙：优先退栈，退不动就直接重绘 */
  function backToWall() {
    const hash = window.location.hash || '';
    if (hash.indexOf('#memory-bank/') !== 0) {
      currentForkId = '';
      renderWall();
      return;
    }
    pendingProgrammaticBack = true;
    try {
      window.history.back();
    } catch (_) {
      pendingProgrammaticBack = false;
      currentForkId = '';
      renderWall();
      return;
    }
    // 栈已到底时 popstate 不会触发，兜底自己重绘
    setTimeout(() => {
      if (pendingProgrammaticBack) {
        pendingProgrammaticBack = false;
        currentForkId = '';
        renderWall();
      }
    }, 320);
  }

  // 系统返回键 / 手势返回：按 hash 决定退到格墙还是收起整页
  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) pendingProgrammaticBack = false;
    if (!isOpened || !containerEl) return;
    const hash = window.location.hash || '';
    if (hash.indexOf('#memory-bank/') === 0) {
      const fid = hash.slice('#memory-bank/'.length);
      currentForkId = fid;
      othersExpanded = false;
      renderDetail(fid);
    } else if (hash === '#memory-bank') {
      currentForkId = '';
      renderWall();
    } else {
      // hash 已离开本页（例如从卷宗直接跳去别的应用）：静默收起
      close(true);
    }
  });

  /* ---------------- 工具 ---------------- */

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' };
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
  }

  function formatTimeAgo(ts) {
    const t = Number(ts);
    if (!t) return '时间不详';
    const diff = Date.now() - t;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  return {
    open,
    close
  };
})();

window.MemoryBankApp = MemoryBankApp;