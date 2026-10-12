/**
 * 溯流计划 · 设置页「调用日志」子页控制器 (Api Call Log UI)
 * 职责：
 *   1. 渲染 ApiCallLog 的环形日志列表（调用方 / 类型 / 状态 / 时间 / 耗时）
 *   2. 展开详情：端点、模型、请求摘要、响应原文（等宽滚动框）、诊断与可能原因
 *   3. 筛选（全部 / 仅失败）、清空、导出 JSON、暂停记录开关
 * 规范：严格零 Emoji，全纯 SVG；零物理分割线；灵动岛保护由复用的 .settings-header 承担。
 */
window.ApiCallLogUI = (() => {
  let inited = false;
  let listEl = null;
  let summaryEl = null;
  let emptyEl = null;
  let filterBarEl = null;
  let clearBtnEl = null;
  let exportBtnEl = null;
  let pauseBtnEl = null;

  // 当前筛选：'all' | 'fail'
  let currentFilter = 'all';
  let cachedEntries = [];
  // 展开中的条目 id 集合：重渲染时保持展开状态
  const openIds = new Set();

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  function formatTime(ts) {
    const d = new Date(Number(ts) || 0);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatLatency(ms) {
    const n = Number(ms) || 0;
    return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`;
  }

  /* ---------------- 渲染 ---------------- */

  function buildCard(entry) {
    const card = document.createElement('div');
    card.className = 'api-log-card' + (entry.ok ? '' : ' is-fail');
    card.dataset.id = entry.id;

    const head = document.createElement('div');
    head.className = 'api-log-card-head';
    head.innerHTML = `
      <span class="api-log-status-dot" aria-hidden="true"></span>
      <span class="api-log-caller">${escapeHtml(entry.caller)}</span>
      <span class="api-log-kind-badge">${escapeHtml(entry.kindLabel || entry.kind)}</span>
      <span class="api-log-head-meta">
        <span>${escapeHtml(formatTime(entry.ts))}</span>
        <span>${escapeHtml(formatLatency(entry.latency))}${entry.status ? ' · HTTP ' + entry.status : ''}</span>
      </span>
      <svg class="api-log-chevron" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
      </svg>`;
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'api-log-card-body';
    body.hidden = true;

    const sections = [];

    // 端点与模型
    sections.push(`
      <div>
        <div class="api-log-field-label">ENDPOINT // 端点</div>
        <div class="api-log-well">${escapeHtml(entry.url || '')}${entry.model ? `<div class="api-log-model-tag">MODEL: ${escapeHtml(entry.model)}</div>` : ''}</div>
      </div>`);

    // 报错与可能原因（失败时置顶展示）
    if (!entry.ok) {
      if (entry.errorMessage) {
        sections.push(`
          <div>
            <div class="api-log-field-label">ERROR // 报错</div>
            <div class="api-log-error-text">${escapeHtml(entry.errorMessage)}</div>
          </div>`);
      }
      if (Array.isArray(entry.causes) && entry.causes.length) {
        sections.push(`
          <div>
            <div class="api-log-field-label">DIAGNOSIS // 可能原因</div>
            <div class="api-log-causes">
              ${entry.causes.map((c) => `
                <div class="api-log-cause-item">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/></svg>
                  <span>${escapeHtml(c)}</span>
                </div>`).join('')}
            </div>
          </div>`);
      }
    }

    // 请求摘要
    if (entry.reqSummary) {
      sections.push(`
        <div>
          <div class="api-log-field-label">REQUEST // 请求摘要</div>
          <div class="api-log-pre">${escapeHtml(entry.reqSummary)}</div>
        </div>`);
    }
    if (entry.reqMeta) {
      sections.push(`
        <div>
          <div class="api-log-field-label">PARAMS // 附加参数</div>
          <div class="api-log-field-value">${escapeHtml(entry.reqMeta)}</div>
        </div>`);
    }

    // 响应原文（全量，等宽滚动框）
    if (entry.respBody) {
      sections.push(`
        <div>
          <div class="api-log-field-label">RESPONSE // 响应原文${entry.ok ? '' : '（报错体）'}</div>
          <div class="api-log-pre">${escapeHtml(entry.respBody)}</div>
        </div>`);
    }

    body.innerHTML = sections.join('');
    card.appendChild(body);

    head.addEventListener('click', () => {
      const isOpen = card.classList.toggle('is-open');
      body.hidden = !isOpen;
      if (isOpen) openIds.add(entry.id);
      else openIds.delete(entry.id);
    });

    return card;
  }

  function getFilteredEntries() {
    if (currentFilter === 'fail') return cachedEntries.filter((e) => !e.ok);
    return cachedEntries;
  }

  function renderList() {
    if (!listEl) return;
    const filtered = getFilteredEntries();

    if (summaryEl) {
      const failCount = cachedEntries.filter((e) => !e.ok).length;
      summaryEl.innerHTML = `
        <span>共 ${cachedEntries.length} 条</span>
        <span>失败 ${failCount} 条</span>
        <span>环形缓冲上限 ${window.ApiCallLog ? ApiCallLog.MAX_ENTRIES : 50}</span>`;
    }

    listEl.innerHTML = '';
    if (filtered.length === 0) {
      if (emptyEl) {
        emptyEl.hidden = false;
        const emptyTitle = emptyEl.querySelector('.api-log-empty-title');
        const emptyDesc = emptyEl.querySelector('.api-log-empty-desc');
        if (cachedEntries.length === 0) {
          if (emptyTitle) emptyTitle.textContent = '尚无调用记录';
          if (emptyDesc) emptyDesc.textContent = 'NO RECORD // 发起任意推演、对话或生图后自动收录';
        } else {
          if (emptyTitle) emptyTitle.textContent = '该筛选下暂无记录';
          if (emptyDesc) emptyDesc.textContent = 'NO MATCH // 换个筛选条件看看';
        }
      }
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    const frag = document.createDocumentFragment();
    filtered.forEach((entry) => {
      const card = buildCard(entry);
      // 重渲染时恢复展开状态
      if (openIds.has(entry.id)) {
        card.classList.add('is-open');
        const body = card.querySelector('.api-log-card-body');
        if (body) body.hidden = false;
      }
      frag.appendChild(card);
    });
    listEl.appendChild(frag);
  }

  async function refreshPauseBtn() {
    if (!pauseBtnEl || !window.ApiCallLog) return;
    const paused = await ApiCallLog.isPaused();
    pauseBtnEl.classList.toggle('is-paused', paused);
    const label = pauseBtnEl.querySelector('span');
    if (label) label.textContent = paused ? '已暂停记录' : '暂停记录';
  }

  async function refresh() {
    if (!window.ApiCallLog || typeof ApiCallLog.list !== 'function') return;
    cachedEntries = await ApiCallLog.list();
    renderList();
    await refreshPauseBtn();
  }

  /* ---------------- 导出 ---------------- */

  async function onExport() {
    try {
      const json = await ApiCallLog.exportJson();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const pad = (n) => String(n).padStart(2, '0');
      const d = new Date();
      a.download = `retroflow_api_log_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.json`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 延后释放，给 WebView 留取数窗口（与 Downloader 同款策略）
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'LOG // EXPORT', message: '调用日志已导出为 JSON', type: 'success' });
      }
    } catch (err) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'LOG // EXPORT', message: '导出失败，请重试', type: 'error' });
      }
    }
  }

  async function onClear() {
    if (!window.confirm('确定清空全部调用日志？此操作不可恢复。')) return;
    openIds.clear();
    await ApiCallLog.clear();
    await refresh();
    if (window.RetroToast) {
      RetroToast.show({ tag: 'LOG // PURGE', message: '调用日志已清空', type: 'info' });
    }
  }

  async function onPauseToggle() {
    if (!window.ApiCallLog) return;
    const paused = await ApiCallLog.isPaused();
    const next = await ApiCallLog.setPaused(!paused);
    await refreshPauseBtn();
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'LOG // RECORDER',
        message: next ? '已暂停记录（本次会话内的调用不再入册）' : '已恢复记录',
        type: 'info'
      });
    }
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    if (inited) {
      // 每次进入子页都重新拉取最新日志
      refresh();
      return;
    }

    listEl = document.getElementById('apiCallLogList');
    summaryEl = document.getElementById('apiCallLogSummary');
    emptyEl = document.getElementById('apiCallLogEmpty');
    filterBarEl = document.getElementById('apiCallLogFilterBar');
    clearBtnEl = document.getElementById('apiCallLogClearBtn');
    exportBtnEl = document.getElementById('apiCallLogExportBtn');
    pauseBtnEl = document.getElementById('apiCallLogPauseBtn');

    if (filterBarEl) {
      filterBarEl.addEventListener('click', (e) => {
        const pill = e.target.closest('.api-log-filter-pill');
        if (!pill) return;
        filterBarEl.querySelectorAll('.api-log-filter-pill').forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        currentFilter = pill.dataset.logFilter === 'fail' ? 'fail' : 'all';
        renderList();
      });
    }
    if (clearBtnEl) clearBtnEl.addEventListener('click', onClear);
    if (exportBtnEl) exportBtnEl.addEventListener('click', onExport);
    if (pauseBtnEl) pauseBtnEl.addEventListener('click', onPauseToggle);

    inited = true;
    refresh();
  }

  return { init, refresh };
})();