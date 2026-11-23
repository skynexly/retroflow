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
    containerEl.innerHTML = ''
      + sectionHeader()
      + body(search);
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

  function body(search) {
    return ''
      + '<div class="settings-body-scroll">'
      +   searchModuleHtml(search)
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
      +   '<div class="module-label-row">'
      +     '<span class="module-label-en">SEARCH</span>'
      +     '<span class="module-label-zh">联网检索</span>'
      +   '</div>'
      +   '<div class="chat-bento-card">'
      // 全局开关 + 说明
      +     '<div class="chat-bento-row">'
      +       '<div class="chat-bento-label">'
      +         '<span class="chat-bento-zh">联网搜索能力</span>'
      +         '<span class="chat-bento-en">ENABLE WEB SEARCH · 允许 AI 搜索实时信息</span>'
      +       '</div>'
      +       '<div class="terminal-config-row-actions">'
      +         '<button type="button" class="psych-help-circle-btn" id="svcSearchHelpBtn" aria-label="查看联网搜索说明" title="查看联网搜索说明">'
      +           '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      +             '<circle cx="12" cy="12" r="10"/>'
      +             '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>'
      +             '<path d="M12 17h.01"/>'
      +           '</svg>'
      +         '</button>'
      +         '<label class="chat-bento-switch">'
      +           '<input type="checkbox" id="svcSearchGlobalToggle"' + (globalOn ? ' checked' : '') + '>'
      +           '<span class="chat-switch-slider"></span>'
      +         '</label>'
      +       '</div>'
      +     '</div>'
      // 说明抽屉
      +     '<div class="psych-radar-manual-drawer terminal-config-drawer" id="svcSearchHelpDrawer" hidden>'
      +       '<div class="terminal-config-hint">'
      +         '开启后，AI 助手与线上联络角色均可主动联网搜索实时信息。需至少配置一家搜索服务商并填入有效 API Key。'
      +         '全局开关控制能力总闸，各对话窗口的「联网搜索」开关控制该窗口是否实际使用。'
      +         '多家服务商按列表顺序依次尝试，首家额度耗尽后自动切换下一家，并在调用日志中记录切换原因。'
      +       '</div>'
      +     '</div>'
      // 服务商列表
      +     '<div class="es-provider-list" id="svcProviderList">'
      +       search.providers.map((p, i) => providerCardHtml(p, i, count)).join('')
      +     '</div>'
      +   '</div>'
      + '</div>';
  }

  function providerCardHtml(p, index, total) {
    const meta = ES.PROVIDERS[p.id];
    const status = ES.providerStatus(p);
    const statusText = {
      ok: '已就绪',
      nokey: '未配置 Key',
      disabled: '已停用',
      cooldown: '额度冷却中'
    }[status];
    const statusClass = 'es-status-' + status;
    const cooldown = p.quotaExhaustedUntil > Date.now()
      ? '，预计明日零点恢复' : '';

    return ''
      + '<div class="es-provider-card" data-provider="' + escapeHtml(p.id) + '">'
      // 名称行
      +   '<div class="es-provider-head">'
      +     '<div class="es-provider-info">'
      +       '<span class="es-provider-name">' + escapeHtml(meta.name) + '</span>'
      +       '<span class="es-provider-en">' + escapeHtml(meta.en) + '</span>'
      +     '</div>'
      +     '<div class="es-provider-meta">'
      +       '<span class="es-provider-status ' + statusClass + '" id="svcStatus_' + escapeHtml(p.id) + '">' + escapeHtml(statusText) + cooldown + '</span>'
      +       reorderArrowsHtml(p.id, index, total)
      +     '</div>'
      +   '</div>'
      // 描述
      +   '<div class="es-provider-desc">' + escapeHtml(meta.desc) + '</div>'
      // Key 输入行
      +   '<div class="es-provider-key-row">'
      +     '<input type="password" class="es-key-input" id="svcKey_' + escapeHtml(p.id) + '"'
      +       + ' placeholder="' + escapeHtml(meta.keyHint) + '"'
      +       + ' value="' + escapeHtml(p.apiKey) + '"'
      +       + ' autocomplete="off" spellcheck="false">'
      +   '</div>'
      // 操作行：测试 + 启用
      +   '<div class="es-provider-actions">'
      +     '<button type="button" class="es-test-btn" data-provider="' + escapeHtml(p.id) + '">'
      +       '<svg viewBox="0 0 24 24" aria-hidden="true">'
      +         '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>'
      +       '</svg>'
      +       '<span>测试连接</span>'
      +     '</button>'
      +     '<div class="es-test-result" id="svcTestMsg_' + escapeHtml(p.id) + '" hidden></div>'
      +     '<label class="chat-bento-switch">'
      +       '<input type="checkbox" class="es-provider-toggle" id="svcToggle_' + escapeHtml(p.id) + '"'
      +         + (p.enabled ? ' checked' : '') + '>'
      +       '<span class="chat-switch-slider"></span>'
      +     '</label>'
      +   '</div>'
      + '</div>';
  }

  function reorderArrowsHtml(id, index, total) {
    if (total <= 1) return '';
    return ''
      + '<div class="es-reorder-arrows">'
      +   '<button type="button" class="es-reorder-btn" data-provider="' + escapeHtml(id) + '" data-dir="-1"' + (index === 0 ? ' disabled aria-disabled="true"' : '') + ' aria-label="上移服务商">'
      +     '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6 1.41 1.41z"/></svg>'
      +   '</button>'
      +   '<button type="button" class="es-reorder-btn" data-provider="' + escapeHtml(id) + '" data-dir="1"' + (index === total - 1 ? ' disabled aria-disabled="true"' : '') + ' aria-label="下移服务商">'
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

    // 帮助说明
    const helpBtn = containerEl.querySelector('#svcSearchHelpBtn');
    const helpDrawer = containerEl.querySelector('#svcSearchHelpDrawer');
    if (helpBtn && helpDrawer) {
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
    }

    // 服务商 Key 输入（失焦保存）
    containerEl.querySelectorAll('.es-key-input').forEach((input) => {
      input.onchange = async () => {
        const id = input.id.replace('svcKey_', '');
        const val = input.value.trim();
        await ES.updateProvider(id, { apiKey: val });
        // 填入 Key 后如果之前是未配置状态，刷新整个卡片显示新状态
        render();
      };
    });

    // 服务商开关
    containerEl.querySelectorAll('.es-provider-toggle').forEach((toggle) => {
      toggle.onchange = async () => {
        const id = toggle.id.replace('svcToggle_', '');
        await ES.updateProvider(id, { enabled: toggle.checked });
        render();
      };
    });

    // 测试连接按钮
    containerEl.querySelectorAll('.es-test-btn').forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute('data-provider');
        const msgEl = containerEl.querySelector('#svcTestMsg_' + id);
        if (!msgEl) return;
        // 先把当前输入框的值保存（测试不走 change 事件，这里手动取）
        const keyInput = containerEl.querySelector('#svcKey_' + id);
        if (keyInput && keyInput.value.trim()) {
          const current = ES.getSearchConfig();
          const p = current.providers.find((it) => it.id === id);
          if (p && p.apiKey !== keyInput.value.trim()) {
            await ES.updateProvider(id, { apiKey: keyInput.value.trim() });
          }
        }
        msgEl.removeAttribute('hidden');
        msgEl.textContent = '测试中…';
        msgEl.className = 'es-test-result es-test-pending';
        btn.disabled = true;
        const result = await ES.testProvider(id);
        // 只刷新状态徽标，不整页重渲：测试结果要留在原地给执行员看
        const statusEl = containerEl.querySelector('#svcStatus_' + id);
        if (statusEl) {
          const cfg = ES.getSearchConfig();
          const prov = cfg.providers.find((it) => it.id === id);
          if (prov) {
            const st = ES.providerStatus(prov);
            const text = { ok: '已就绪', nokey: '未配置 Key', disabled: '已停用', cooldown: '额度冷却中' }[st];
            statusEl.textContent = text;
            statusEl.className = 'es-provider-status es-status-' + st;
          }
        }
        msgEl.textContent = result.message;
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
        await ES.moveProvider(id, dir);
        render();
      };
    });
  }

  /* ---------------- 工具 ---------------- */

  function escapeHtml(str) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '"', "'": '&#39;' };
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => map[c]);
  }

  return { init, isInitialized };
})();

window.ExternalServicesUI = ExternalServicesUI;