/**
 * ============================================================================
 * 溯流计划 · 外部服务 UI (ExternalServicesUI)
 *
 * 负责设置页「外部服务」子页的渲染与交互，与 ExternalServices 数据层解耦。
 * 本期只有联网搜索 Tavily，结构按「多服务商列表」设计，后续加服务商只需
 * 调 init() 重渲即可，不需改 UI 层。
 *
 * 视觉完全参照终端配置页的模块布局（theme-module + chat-bento-card），
 * 无分割线、全 SVG 图标、setting-header 承担灵动岛 safe-area。
 * ============================================================================
 */
const ExternalServicesUI = (() => {
  'use strict';

  const ES = window.ExternalServices;

  /* ---------------- 状态 ---------------- */

  let containerEl = null;
  let initialized = false;

  // Key 显隐按钮图标：睁眼 = 点击显示明文；划线眼 = 点击收起
  const KEY_EYE_SHOW_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>'
    + '</svg>';
  const KEY_EYE_HIDE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>'
    + '</svg>';

  /* ---------------- 入口 ---------------- */

  function init() {
    containerEl = document.getElementById('servicesDetailSection');
    if (!containerEl || !ES) return;
    render();
    initialized = true;
  }

  function isInitialized() {
    return initialized;
  }

  /* ---------------- 渲染 ---------------- */

  function render() {
    if (!containerEl) return;
    const search = ES.getSearchConfig();
    const fetchCfg = ES.getFetchConfig();
    containerEl.innerHTML = ''
      + sectionHeader()
      + body(search, fetchCfg);
    bindEvents();
  }

  function sectionHeader() {
    // 本页标题不用双斜杠：英文 + 中文并排（es-header-title 变体）
    return ''
      + '<header class="settings-header">'
      +   '<button class="settings-back-btn" type="button" aria-label="返回配置列表" title="返回配置列表">'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true">'
      +       '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>'
      +     '</svg>'
      +   '</button>'
      +   '<div class="settings-header-title es-header-title">'
      +     '<span class="settings-title-en">SERVICES</span>'
      +     '<span class="settings-title-zh">外部服务</span>'
      +   '</div>'
      + '</header>';
  }

  function body(search, fetchCfg) {
    return ''
      + '<div class="settings-body-scroll">'
      +   searchModuleHtml(search)
      +   fetchModuleHtml(fetchCfg)
      +   placeholderModuleHtml('IMAGERY', '图像素材', '图库搜索与抓取，为角色、壁纸和对话配图提供视觉素材。接入 Unsplash 等服务商。', '暂未开放')
      +   placeholderModuleHtml('PROTOCOL', '扩展协议', 'MCP（模型上下文协议）允许 AI 调用外部工具：数据库、文件系统、第三方 API 等。', '暂未开放')
      +   placeholderModuleHtml('RELAY', '自备后端', '用户可自建服务器，实现消息推送、定时任务与多端同步等高级功能。', '暂未开放')
      + '</div>';
  }

  /* ---------------- 搜索模块 ---------------- */

  function searchModuleHtml(search) {
    const globalOn = search.enabled;
    const count = search.providers.length;
    return ''
      + '<div class="theme-module">'
      // 裸控制行：无大卡片包裹，直接放在页面底色上
      +   '<div class="chat-bento-row es-module-toggle-row">'
      +     '<div class="chat-bento-label">'
      +       '<span class="chat-bento-zh">联网搜索能力</span>'
      +       '<span class="chat-bento-en">ENABLE WEB SEARCH · 允许 AI 搜索实时信息</span>'
      +     '</div>'
      +     '<div class="terminal-config-row-actions">'
      +       '<button type="button" class="psych-help-circle-btn" id="svcSearchHelpBtn" aria-label="查看联网搜索说明" title="查看联网搜索说明">'
      +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      +           '<circle cx="12" cy="12" r="10"/>'
      +           '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>'
      +           '<path d="M12 17h.01"/>'
      +         '</svg>'
      +       '</button>'
      +       '<label class="chat-bento-switch">'
      +         '<input type="checkbox" id="svcSearchGlobalToggle"' + (globalOn ? ' checked' : '') + '>'
      +         '<span class="chat-switch-slider"></span>'
      +       '</label>'
      +     '</div>'
      +   '</div>'
      // 说明抽屉
      +   '<div class="psych-radar-manual-drawer terminal-config-drawer" id="svcSearchHelpDrawer" hidden>'
      +     '<div class="terminal-config-hint">'
      +       'AI 可搜索实时信息。需配置至少一家服务商，并在对话窗口开启「联网搜索」。'
      +       '按列表顺序尝试，额度耗尽后自动切换。'
      +     '</div>'
      +     providerHelpHtml(search.providers, 'search')
      +   '</div>'
      // 服务商列表
      +   '<div class="es-provider-list" id="svcProviderList">'
      +     search.providers.map((p, i) => providerCardHtml(p, i, count, 'search')).join('')
      +   '</div>'
      + '</div>';
  }

  /* ---------------- 网页抓取模块 ---------------- */

  function fetchModuleHtml(fetchCfg) {
    const globalOn = fetchCfg.enabled;
    const count = fetchCfg.providers.length;
    return ''
      + '<div class="theme-module">'
      +   '<div class="chat-bento-row es-module-toggle-row">'
      +     '<div class="chat-bento-label">'
      +       '<span class="chat-bento-zh">读取网页能力</span>'
      +       '<span class="chat-bento-en">ENABLE PAGE READER · 允许 AI 打开链接读正文</span>'
      +     '</div>'
      +     '<div class="terminal-config-row-actions">'
      +       '<button type="button" class="psych-help-circle-btn" id="svcFetchHelpBtn" aria-label="查看网页抓取说明" title="查看网页抓取说明">'
      +         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      +           '<circle cx="12" cy="12" r="10"/>'
      +           '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>'
      +           '<path d="M12 17h.01"/>'
      +         '</svg>'
      +       '</button>'
      +       '<label class="chat-bento-switch">'
      +         '<input type="checkbox" id="svcFetchGlobalToggle"' + (globalOn ? ' checked' : '') + '>'
      +         '<span class="chat-switch-slider"></span>'
      +       '</label>'
      +     '</div>'
      +   '</div>'
      +   '<div class="psych-radar-manual-drawer terminal-config-drawer" id="svcFetchHelpDrawer" hidden>'
      +     '<div class="terminal-config-hint">'
      +       'AI 可打开网址读取正文，常与联网搜索配合。单次最多读取前 ' + ES.FETCH_MAX_CHARS + ' 字。'
      +       '按列表顺序尝试，前一家读不到会自动换下一家。'
      +       '需在对话窗口开启「联网搜索」。'
      +     '</div>'
      +     providerHelpHtml(fetchCfg.providers, 'fetch')
      +   '</div>'
      +   '<div class="es-provider-list" id="svcFetcherList">'
      +     fetchCfg.providers.map((p, i) => providerCardHtml(p, i, count, 'fetch')).join('')
      +   '</div>'
      + '</div>';
  }

  const STATUS_TEXT = {
    ok: '已就绪',
    nokey: '未配置 Key',
    disabled: '已停用',
    cooldown: '额度冷却中',
    anon: '匿名可用',
    unsupported: '仅装机版可用'
  };

  /** 按模块取元数据与状态：search 走 PROVIDERS，fetch 走 FETCHERS */
  function kindMeta(kind, id) {
    return kind === 'fetch' ? ES.FETCHERS[id] : ES.PROVIDERS[id];
  }
  function kindStatus(kind, p) {
    return kind === 'fetch' ? ES.fetcherStatus(p) : ES.providerStatus(p);
  }
  function kindConfig(kind) {
    return kind === 'fetch' ? ES.getFetchConfig() : ES.getSearchConfig();
  }
  function kindUpdate(kind, id, fields) {
    return kind === 'fetch' ? ES.updateFetcher(id, fields) : ES.updateProvider(id, fields);
  }
  /** DOM id 片段：两个模块的服务商 id 可能重名，抓取模块加 f_ 前缀 */
  function domKey(kind, id) {
    return (kind === 'fetch' ? 'f_' : '') + id;
  }

  function providerHelpHtml(providers, kind) {
    return '<div class="es-provider-help-list">'
      + providers.map((p) => {
        const meta = kindMeta(kind, p.id);
        return '<div class="es-provider-help-item">'
          + '<span class="es-provider-help-name">' + escapeHtml(meta.name) + '</span>'
          + escapeHtml(meta.desc)
          + '</div>';
      }).join('')
      + '</div>';
  }

  function providerCardHtml(p, index, total, kind) {
    const meta = kindMeta(kind, p.id);
    const status = kindStatus(kind, p);
    const statusText = STATUS_TEXT[status];
    const statusClass = 'es-status-' + status;
    const cooldown = p.quotaExhaustedUntil > Date.now()
      ? '，预计明日零点恢复' : '';
    const dk = escapeHtml(domKey(kind, p.id));
    const dataAttrs = ' data-provider="' + escapeHtml(p.id) + '" data-kind="' + escapeHtml(kind) + '"';

    return ''
      + '<div class="es-provider-card"' + dataAttrs + '>'
      // 名称行
      +   '<div class="es-provider-head">'
      +     '<div class="es-provider-info">'
      +       '<span class="es-provider-name">' + escapeHtml(meta.name) + '</span>'
      +       '<span class="es-provider-en">' + escapeHtml(meta.en) + '</span>'
      +     '</div>'
      +     '<div class="es-provider-meta">'
      +       '<span class="es-provider-status ' + statusClass + '" id="svcStatus_' + dk + '">' + escapeHtml(statusText) + cooldown + '</span>'
      +       reorderArrowsHtml(p.id, index, total, kind)
      +     '</div>'
      +   '</div>'
      // Key 输入行（免 Key 的服务商如本机直连不渲染）
      + (meta.noKey ? '' : ''
      +   '<div class="es-provider-key-row">'
      +     '<input type="password" class="es-key-input" id="svcKey_' + dk + '"' + dataAttrs
      +       ' placeholder="' + escapeHtml(meta.keyHint) + '"'
      +       ' value="' + escapeHtml(p.apiKey) + '"'
      +       ' autocomplete="off" spellcheck="false">'
      // 显隐切换：默认圆点，点眼睛看明文，再点收起
      +     '<button type="button" class="es-key-eye"' + dataAttrs
      +       ' aria-label="显示 Key" title="显示 Key" aria-pressed="false">'
      +       KEY_EYE_SHOW_SVG
      +     '</button>'
      +   '</div>')
      // 操作行：测试按钮 + 常驻状态框（启用由全局开关统一控制，不再单卡开关）
      +   '<div class="es-provider-actions">'
      +     '<button type="button" class="es-test-btn"' + dataAttrs + '>'
      +       '<svg viewBox="0 0 24 24" aria-hidden="true">'
      +         '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>'
      +       '</svg>'
      +       '<span>测试连接</span>'
      +     '</button>'
      +     '<div class="es-test-result" id="svcTestMsg_' + dk + '" role="status" aria-live="polite">'
      +       '<span class="es-test-indicator" aria-hidden="true"></span>'
      +       '<span class="es-test-text">STANDBY · 待命</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function reorderArrowsHtml(id, index, total, kind) {
    if (total <= 1) return '';
    const attrs = ' data-provider="' + escapeHtml(id) + '" data-kind="' + escapeHtml(kind || 'search') + '"';
    return ''
      + '<div class="es-reorder-arrows">'
      +   '<button type="button" class="es-reorder-btn"' + attrs + ' data-dir="-1"' + (index === 0 ? ' disabled aria-disabled="true"' : '') + ' aria-label="上移服务商">'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/></svg>'
      +   '</button>'
      +   '<button type="button" class="es-reorder-btn"' + attrs + ' data-dir="1"' + (index === total - 1 ? ' disabled aria-disabled="true"' : '') + ' aria-label="下移服务商">'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>'
      +   '</button>'
      + '</div>';
  }

  /* ---------------- 占位模块 ---------------- */

  function placeholderModuleHtml(en, zh, desc, badge) {
    return ''
      + '<div class="theme-module">'
      +   '<div class="module-label-row">'
      +     '<span class="module-label-en">' + escapeHtml(en) + '</span>'
      +     '<span class="module-label-zh">' + escapeHtml(zh) + '</span>'
      +   '</div>'
      +   '<div class="chat-bento-card es-placeholder-card">'
      +     '<div class="es-placeholder-row">'
      +       '<div class="es-placeholder-text">' + escapeHtml(desc) + '</div>'
      +       '<span class="es-placeholder-badge">' + escapeHtml(badge) + '</span>'
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    if (!containerEl) return;

    // 返回按钮不在此绑定：settings.js 在 detailView 上做了统一事件委托

    // 全局搜索开关
    const globalToggle = containerEl.querySelector('#svcSearchGlobalToggle');
    if (globalToggle) {
      globalToggle.onchange = async () => {
        await ES.setSearchEnabled(globalToggle.checked);
        render();
      };
    }
    // 全局网页抓取开关
    const fetchToggle = containerEl.querySelector('#svcFetchGlobalToggle');
    if (fetchToggle) {
      fetchToggle.onchange = async () => {
        await ES.setFetchEnabled(fetchToggle.checked);
        render();
      };
    }

    // 帮助说明（两个模块各一组按钮 + 抽屉）
    [['#svcSearchHelpBtn', '#svcSearchHelpDrawer'], ['#svcFetchHelpBtn', '#svcFetchHelpDrawer']].forEach(([btnSel, drawerSel]) => {
      const helpBtn = containerEl.querySelector(btnSel);
      const helpDrawer = containerEl.querySelector(drawerSel);
      if (!helpBtn || !helpDrawer) return;
      helpBtn.onclick = () => {
        const hidden = helpDrawer.hasAttribute('hidden');
        if (hidden) {
          helpDrawer.removeAttribute('hidden');
          helpBtn.classList.add('active');
        } else {
          helpDrawer.setAttribute('hidden', '');
          helpBtn.classList.remove('active');
        }
      };
    });

    // 服务商 Key 输入（失焦保存）
    containerEl.querySelectorAll('.es-key-input').forEach((input) => {
      input.onchange = async () => {
        const id = input.getAttribute('data-provider');
        const kind = input.getAttribute('data-kind');
        const val = input.value.trim();
        await kindUpdate(kind, id, { apiKey: val });
        // 填入 Key 后如果之前是未配置状态，刷新整个卡片显示新状态
        render();
      };
    });

    // Key 显隐切换：只改输入框 type，不触发保存与重渲
    containerEl.querySelectorAll('.es-key-eye').forEach((btn) => {
      // pointerdown 阻止默认，避免点眼睛时输入框失焦触发 change → 整页重渲吞掉这次点击
      btn.onpointerdown = (e) => e.preventDefault();
      btn.onclick = () => {
        const dk = domKey(btn.getAttribute('data-kind'), btn.getAttribute('data-provider'));
        const input = containerEl.querySelector('#svcKey_' + dk);
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.innerHTML = reveal ? KEY_EYE_HIDE_SVG : KEY_EYE_SHOW_SVG;
        const label = reveal ? '隐藏 Key' : '显示 Key';
        btn.setAttribute('aria-label', label);
        btn.setAttribute('title', label);
        btn.setAttribute('aria-pressed', reveal ? 'true' : 'false');
      };
    });

    // 测试连接按钮
    containerEl.querySelectorAll('.es-test-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-provider');
        const kind = btn.getAttribute('data-kind');
        const dk = domKey(kind, id);
        const msgEl = containerEl.querySelector('#svcTestMsg_' + dk);
        if (!msgEl) return;
        // 先把当前输入框的值保存（测试不走 change 事件，这里手动取）。
        // 抓取模块 Key 选填，清空也要落盘，否则测的还是旧 Key。
        const keyInput = containerEl.querySelector('#svcKey_' + dk);
        if (keyInput) {
          const typed = keyInput.value.trim();
          const p = kindConfig(kind).providers.find((it) => it.id === id);
          if (p && p.apiKey !== typed && (typed || kind === 'fetch')) {
            await kindUpdate(kind, id, { apiKey: typed });
          }
        }
        const textEl = msgEl.querySelector('.es-test-text');
        if (textEl) textEl.textContent = '测试中…';
        msgEl.className = 'es-test-result es-test-pending';
        btn.disabled = true;
        const result = kind === 'fetch' ? await ES.testFetcher(id) : await ES.testProvider(id);
        // 只刷新状态徽标，不整页重渲：测试结果要留在原地给执行员看
        const statusEl = containerEl.querySelector('#svcStatus_' + dk);
        if (statusEl) {
          const prov = kindConfig(kind).providers.find((it) => it.id === id);
          if (prov) {
            const st = kindStatus(kind, prov);
            statusEl.textContent = STATUS_TEXT[st];
            statusEl.className = 'es-provider-status es-status-' + st;
          }
        }
        if (textEl) textEl.textContent = result.message;
        msgEl.className = 'es-test-result ' + (result.ok ? 'es-test-ok' : 'es-test-fail');
        btn.disabled = false;
      };
    });

    // 排序按钮
    containerEl.querySelectorAll('.es-reorder-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-provider');
        const dir = parseInt(btn.getAttribute('data-dir'), 10);
        if (!id || (dir !== 1 && dir !== -1)) return;
        if (btn.getAttribute('data-kind') === 'fetch') await ES.moveFetcher(id, dir);
        else await ES.moveProvider(id, dir);
        render();
      };
    });
  }

  /* ---------------- 工具 ---------------- */

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
  }

  return { init, isInitialized };
})();

window.ExternalServicesUI = ExternalServicesUI;