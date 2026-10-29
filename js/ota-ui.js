/**
 * ============================================================================
 * 溯流计划 · UPDATE // 检查更新 · UI 控制器
 * ============================================================================
 *
 * 挂在设置 → 终端配置，第三个模块。排版复用 terminal-config 系列类，
 * 灵动岛/刘海保护由所在详情页 .settings-header 的 safe-area padding 继承，
 * 本模块不新增任何安全区 padding。
 *
 * 可见性：
 *   HTML 里默认 hidden，仅当 <html> 带 is-native 类时显示。
 *   类由 boot 早期打上（Capacitor 原生壳判定）；浏览器/PWA 里永不显示，
 *   那边的更新走 Service Worker，显示这个模块只会误导。
 *
 * 三态（+下载中）：
 *   up-to-date        已是最新版本
 *   update-available  发现新版本 + 更新说明 + 「立即更新」
 *   unavailable       更新服务暂时不可用，请稍后再试
 *   binary-too-old / schema-too-new  需要重装安装包的两种提示
 *   checking          检查中（按钮转圈禁用）
 *   downloading       进度条 + 百分比（阶段 2 引擎接管后出现）
 *
 * 「立即更新」在应用引擎（RetroflowOTA）就绪前一律禁用并如实标注，
 * 绝不假装更新成功。规范：零 Emoji、零分割线、纯 SVG。
 * ============================================================================
 */
(() => {
  'use strict';

  let els = {};
  let lastCheck = null;
  let busy = false;

  function cacheEls() {
    els = {
      module: document.getElementById('otaUpdateModule'),
      versionText: document.getElementById('otaVersionText'),
      hotChip: document.getElementById('otaHotChip'),
      hotChipText: document.getElementById('otaHotChipText'),
      checkBtn: document.getElementById('otaCheckBtn'),
      checkLabel: document.getElementById('otaCheckLabel'),
      statusRow: document.getElementById('otaStatusRow'),
      statusIcon: document.getElementById('otaStatusIcon'),
      statusText: document.getElementById('otaStatusText'),
      notesDrawer: document.getElementById('otaNotesDrawer'),
      notesList: document.getElementById('otaNotesList'),
      applyRow: document.getElementById('otaApplyRow'),
      applyBtn: document.getElementById('otaApplyBtn'),
      applyLabel: document.getElementById('otaApplyLabel'),
      progressRow: document.getElementById('otaProgressRow'),
      progressBar: document.getElementById('otaProgressBar'),
      progressText: document.getElementById('otaProgressText'),
      helpBtn: document.getElementById('otaHelpBtn'),
      manualDrawer: document.getElementById('otaManualDrawer')
    };
    return els.module;
  }

  /** 当前版本行：读 RetroflowVersion（app-version.js 同步生成，同源可信赖） */
  function fillVersion() {
    if (!els.versionText) return;
    const v = window.RetroflowVersion;
    els.versionText.textContent = (v && v.label) ? v.label : 'v?.?.? (b?)';
    fillHotChip();
  }

  /**
   * 热更标记：当前跑的是覆盖层资源（而非 APK 内置）时显示，并标出覆盖层的 build。
   *
   * 为什么要单独标：RetroflowVersion 来自 app-version.js，它本身就是被覆盖层替换过的
   * 那份文件，所以热更后显示的 build 已经是新的——但用户无从判断这个数字是「装进去的」
   * 还是「拉下来的」。这个标记补上这层信息，也是排查热更是否真的生效的直接依据。
   *
   * 无覆盖层（纯内置）时保持 hidden，界面与热更前完全一致。
   */
  async function fillHotChip() {
    if (!els.hotChip) return;
    if (!window.RetroflowOTA || typeof RetroflowOTA.getAppliedVersion !== 'function') return;
    try {
      const applied = await RetroflowOTA.getAppliedVersion();
      if (!applied || !applied.hotUpdated) return; // 纯内置，不显示
      els.hotChip.hidden = false;
      if (els.hotChipText && Number.isFinite(applied.build)) {
        els.hotChipText.textContent = `热更 b${applied.build}`;
      }
    } catch (err) {
      // 读不到就不显示，绝不让版本行因此空白或报错
    }
  }

  /** 检查更新文字：检查中换文案并禁用（纯文字，无转圈图标） */
  function setCheckButton(label, disabled) {
    if (!els.checkBtn) return;
    els.checkBtn.disabled = Boolean(disabled);
    if (label && els.checkLabel) els.checkLabel.textContent = label;
  }

  /**
   * 更新状态行的图标与文案。
   * 图标一律整体重建为单个 path —— 不用 querySelector 改 d：
   * 若原图标是 circle，给 circle 设 d 是无效属性，会静默不生效。
   */
  function setStatus(iconPath, text, kind) {
    if (els.statusRow) els.statusRow.hidden = false;
    if (els.statusIcon && iconPath) {
      els.statusIcon.innerHTML = `<path d="${iconPath}"></path>`;
    }
    if (els.statusText) els.statusText.textContent = text;
    if (els.statusRow) {
      els.statusRow.className = `terminal-config-hint ota-status ${kind ? 'ota-status-' + kind : ''}`;
    }
  }

  function hideStatus() {
    if (els.statusRow) els.statusRow.hidden = true;
    if (els.statusText) els.statusText.textContent = '';
  }

  function hideNotes() {
    if (els.notesDrawer) els.notesDrawer.hidden = true;
    if (els.applyRow) els.applyRow.hidden = true;
  }

  function renderNotes(notes) {
    if (!els.notesList) return;
    els.notesList.textContent = '';
    (Array.isArray(notes) ? notes : []).forEach((n) => {
      if (typeof n !== 'string' || !n.trim()) return;
      const li = document.createElement('li');
      li.textContent = n;
      li.className = 'ota-note-item';
      els.notesList.appendChild(li);
    });
    if (els.notesList.children.length && els.notesDrawer) {
      els.notesDrawer.hidden = false;
    }
  }

  /** 三态渲染入口 */
  function renderResult(res) {
    lastCheck = res;
    hideNotes();
    if (els.progressRow) els.progressRow.hidden = true;

    switch (res.status) {
      case 'up-to-date': {
        setStatus('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z', res.message, 'ok');
        break;
      }
      case 'update-available': {
        setStatus('M12 2 4 4v13a6 6 0 0 0 5 5.9V22h2v-3.1a6 6 0 0 0 5-5.9l-1.5 0A5.5 5.5 0 0 1 12 17.5 5.5 5.5 0 0 1 6.5 12V5.4L12 4l6 1.4V8h2V4z', res.message, 'info');
        renderNotes(res.remote && res.remote.notes);
        // 阶段 1：引擎未就绪时如实禁用，不假装
        if (els.applyRow) {
          const ready = window.RetroflowUpdate && RetroflowUpdate.isEngineReady();
          els.applyRow.hidden = false;
          if (els.applyBtn) {
            els.applyBtn.disabled = !ready;
            if (els.applyLabel) {
              els.applyLabel.textContent = ready ? '立即更新' : '更新引擎未就绪（待装机版升级）';
            }
          }
        }
        break;
      }
      case 'binary-too-old':
      case 'schema-too-new': {
        setStatus('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', res.message, 'warn');
        break;
      }
      default: { // unavailable 及一切未预期状态
        setStatus('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', res.message || '更新服务暂时不可用，请稍后再试', 'warn');
      }
    }
  }

  /** 检查动作：按钮防重入，检查中转圈 */
  async function onCheck() {
    if (busy) return;
    if (!window.RetroflowUpdate) {
      setStatus('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', '更新模块未加载', 'warn');
      return;
    }
    busy = true;
    setCheckButton('拉取中…', true);
    setStatus('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', '正在检查更新……', 'muted');
    try {
      const res = await RetroflowUpdate.checkForUpdate();
      renderResult(res);
    } catch (err) {
      renderResult({ status: 'unavailable', message: '更新服务暂时不可用，请稍后再试' });
    } finally {
      busy = false;
      setCheckButton('拉取新版本', false);
    }
  }

  /** 立即更新：交给原生应用引擎。防重入 + 分阶段进度文案。 */
  let applying = false;
  const PHASE_TEXT = {
    download: (p) => `正在下载 ${Math.round(p)}%`,
    verify: () => '正在校验更新包',
    unzip: () => '正在解压更新包',
    install: () => '正在应用更新'
  };
  async function onApply() {
    if (applying) return;
    if (!window.RetroflowOTA || typeof RetroflowOTA.applyUpdate !== 'function') return;
    applying = true;
    if (els.applyBtn) els.applyBtn.disabled = true;
    if (els.checkBtn) els.checkBtn.disabled = true;
    try {
      await RetroflowOTA.applyUpdate(lastCheck, {
        onProgress(p) {
          const phase = p && p.phase;
          const pct = Number.isFinite(p && p.percent) ? p.percent : 0;
          if (els.progressRow) {
            els.progressRow.hidden = false;
            // download 阶段按百分比推进；verify/unzip/install 无百分比，条保持满
            if (els.progressBar) {
              els.progressBar.style.width = (phase === 'download' ? Math.round(pct) : 100) + '%';
            }
            if (els.progressText) {
              const fn = PHASE_TEXT[phase];
              els.progressText.textContent = fn ? fn(pct) : '正在更新…';
            }
          }
        }
      });
      // 成功：applyUpdate 内部会延时 reload，这里给出可见的收尾文案
      if (els.progressText) els.progressText.textContent = '安装完成，即将重启';
      if (els.progressBar) els.progressBar.style.width = '100%';
      setStatus('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z', '更新已安装，正在重启应用', 'ok');
    } catch (err) {
      if (els.progressRow) els.progressRow.hidden = true;
      setStatus('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z', (err && err.message) || '更新失败，请稍后重试', 'warn');
      // 失败恢复可点，让用户重试
      if (els.applyBtn) els.applyBtn.disabled = false;
      if (els.checkBtn) els.checkBtn.disabled = false;
      applying = false;
    }
    // 成功路径不恢复按钮：马上要 reload，保持禁用避免重复点击
  }


  function bindHelpDrawer() {
    const btn = els.helpBtn;
    const drawer = els.manualDrawer;
    if (!btn || !drawer) return;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const willShow = drawer.hidden;
      drawer.hidden = !willShow;
      btn.classList.toggle('active', willShow);
    });
  }

  function init() {
    if (!cacheEls()) return;
    // 可见性开关：<html> 带 is-native（boot.js 顶层打标）才解除 hidden。
    // 浏览器 / PWA 里保持隐藏并直接返回——那边更新走 Service Worker，
    // 不绑事件、不发请求，避免误导用户去点一个永远不可用的更新。
    if (!document.documentElement.classList.contains('is-native')) {
      return;
    }
    els.module.hidden = false;
    fillVersion();
    if (els.checkBtn) els.checkBtn.addEventListener('click', onCheck);
    if (els.applyBtn) els.applyBtn.addEventListener('click', onApply);
    bindHelpDrawer();
    hideStatus();
    hideNotes();
  }

  window.OTAUI = { init, renderResult };
})();