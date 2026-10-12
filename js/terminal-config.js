/**
 * 溯流计划 · 设置页「终端配置」子页控制器 (Terminal Config UI)
 * 职责：
 * 1. 随行悬浮球启用开关的回填与绑定（权威状态归 SystemChatOrb 的 localStorage，
 *    这里只做视图代理，不进 settings 对象）。
 * 2. 后台服务区（保活 / 屏幕常亮）双开关的回填、绑定与状态自证行刷新。
 *    权威状态归 KeepaliveCore 的 localStorage（retroflow_keepalive_v1），
 *    这里同样只做视图代理；前缀 ska（settings-keepalive）与核心侧 ka 区分。
 * 规范：严格零 Emoji、零分割线、纯 SVG。
 */
(() => {
  'use strict';
  let inited = false;
  let orbToggleEl = null;
  let goOrbSkinBtn = null;

  // ===== 随行中枢 =====
  function onOrbToggleChange() {
    if (!orbToggleEl) return;
    if (window.SystemChatOrb && typeof SystemChatOrb.setEnabled === 'function') {
      SystemChatOrb.setEnabled(orbToggleEl.checked);
    }
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'ORB // 随行中枢',
        message: orbToggleEl.checked ? '悬浮球已启用' : '悬浮球已收起',
        type: 'info'
      });
    }
  }
  /** 跳转「界面主题 → 悬浮球美化」：原地改写路由条目，返回时不多退一层 */
  function onGoOrbSkin() {
    if (!window.RetroflowSettings || typeof RetroflowSettings.openDetail !== 'function') return;
    RetroflowSettings.openDetail('theme', {
      replaceEntry: true,
      afterEnter: () => {
        const zone = document.getElementById('orbSkinPreviewZone');
        if (zone && typeof zone.scrollIntoView === 'function') {
          zone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  }
  // ===== 后台服务（保活 / 屏幕常亮）=====
  let skaOnEl = null;      // 后台保活开关
  let skaWakeEl = null;    // 屏幕常亮开关
  let skaStatusRow = null; // 状态自证行容器
  let skaStatusText = null;

  // 音轨四态 + 屏幕锁四态 → 一句人话。
  // 判据全部来自 KeepaliveCore 的如实上报，不自己猜
  function skaDescribe() {
    const KA = window.KeepaliveCore;
    if (!KA) return '保活核心未加载';
    const st = KA.getState();
    const wk = KA.getWakeState();
    const parts = [];
    // 音轨侧
    if (st === 'run') parts.push('保活音轨运行中');
    else if (st === 'wait') parts.push('保活已开启 · 等待一次触屏激活（浏览器不允许无手势出声）');
    else if (st === 'yield') parts.push('保活让路中（真音乐播放时静音轨暂停）');
    // 屏幕锁侧
    if (wk === 'on') parts.push('屏幕常亮生效中');
    else if (wk === 'wait') parts.push('常亮已开启 · 当前未生效（切后台被系统收回或低电量被拒，回前台自动重申）');
    else if (wk === 'dead') parts.push('此浏览器不支持屏幕常亮');
    if (!parts.length) return '后台服务待机中';
    // 媒体身份证自证尾巴：排查「音轨运行中但系统不认账」的关键证据。
    // unsupported = 浏览器无 MediaSession API；idle = 身份证没挂上（play 未成功）；
    // mounted = 已挂（此时还没媒体卡就是响度/ROM 判定问题）。version 用于确认 SW 换班后跑的是新脚本
    const ms = typeof KA.getMediaState === 'function' ? KA.getMediaState() : null;
    if (ms === 'mounted') parts.push('媒体会话已挂载');
    else if (ms === 'idle') parts.push('媒体会话未挂载');
    else if (ms === 'unsupported') parts.push('此浏览器无媒体会话 API');
    if (KA.version) parts.push('core ' + KA.version);
    return parts.join(' · ');
  }

  // 状态行刷新。KeepaliveCore 侧任何状态变化都会回调 window.skaSyncNote
  function skaSyncNote() {
    if (!skaStatusRow || !skaStatusText) return;
    const KA = window.KeepaliveCore;
    if (!KA) { skaStatusRow.hidden = true; return; }
    const cfg = KA.getConfig();
    // 开关勾选态跟着权威状态回填：保活可能从媒体通知的 pause 键被关掉，
    // 设置页开着时开关必须如实跟随，不能说谎
    if (skaOnEl && skaOnEl.checked !== cfg.on) skaOnEl.checked = cfg.on;
    if (skaWakeEl && skaWakeEl.checked !== cfg.wake) skaWakeEl.checked = cfg.wake;
    // 两颗开关都关着就不占一行地方
    if (!cfg.on && !cfg.wake) { skaStatusRow.hidden = true; return; }
    skaStatusRow.hidden = false;
    skaStatusText.textContent = skaDescribe();
  }
  // 暴露给核心侧回调（keepalive-core.js 的 kaNote 找的就是这个全局钩子）
  window.skaSyncNote = skaSyncNote;

  function skaFill() {
    const KA = window.KeepaliveCore;
    if (!KA) return;
    const cfg = KA.getConfig();
    if (skaOnEl) skaOnEl.checked = cfg.on;
    if (skaWakeEl) {
      skaWakeEl.checked = cfg.wake;
      // 不支持 Wake Lock 的浏览器：开关置灰但仍可见，状态行会说明
      skaWakeEl.disabled = !KA.isWakeSupported();
    }
    skaSyncNote();
  }

  // 开关的 change 处理器直接调 KeepaliveCore.set*：
  // 用户点开关这一下就是用户激活上下文，play() 能被放行，无需再等手势闩
  function onSkaToggle() {
    if (!window.KeepaliveCore || !skaOnEl) return;
    KeepaliveCore.setOn(skaOnEl.checked);
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'BACKGROUND // 后台服务',
        message: skaOnEl.checked ? '后台保活已开启' : '后台保活已关闭',
        type: 'info'
      });
    }
    // play 结果异步落地，稍后再刷一次让状态行跟上
    skaSyncNote();
    setTimeout(skaSyncNote, 400);
  }
  function onSkaWakeToggle() {
    if (!window.KeepaliveCore || !skaWakeEl) return;
    KeepaliveCore.setWake(skaWakeEl.checked);
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'BACKGROUND // 后台服务',
        message: skaWakeEl.checked ? '屏幕常亮已开启' : '屏幕常亮已关闭',
        type: 'info'
      });
    }
    // 申请是异步的，稍后再刷一次让状态行跟上结果
    skaSyncNote();
    setTimeout(skaSyncNote, 400);
  }

  function init() {
    if (!inited) {
      orbToggleEl = document.getElementById('terminalToggleFloatingOrb');
      if (orbToggleEl) {
        orbToggleEl.addEventListener('change', onOrbToggleChange);
      }
      goOrbSkinBtn = document.getElementById('terminalGoOrbSkinBtn');
      if (goOrbSkinBtn) {
        goOrbSkinBtn.addEventListener('click', onGoOrbSkin);
      }
      skaOnEl = document.getElementById('terminalToggleKeepalive');
      if (skaOnEl) skaOnEl.addEventListener('change', onSkaToggle);
      skaWakeEl = document.getElementById('terminalToggleWakeLock');
      if (skaWakeEl) skaWakeEl.addEventListener('change', onSkaWakeToggle);
      skaStatusRow = document.getElementById('terminalKeepaliveStatus');
      skaStatusText = document.getElementById('terminalKeepaliveStatusText');

      // 问号说明抽屉交互（对齐世界书 wb-keys-help-btn 规范）
      function bindHelpDrawer(btnId, drawerId) {
        const btn = document.getElementById(btnId);
        const drawer = document.getElementById(drawerId);
        if (!btn || !drawer) return;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const willShow = drawer.hidden;
          drawer.hidden = !willShow;
          btn.classList.toggle('active', willShow);
        });
      }
      bindHelpDrawer('terminalOrbHelpBtn', 'terminalOrbManualDrawer');
      bindHelpDrawer('terminalKeepaliveHelpBtn', 'terminalKeepaliveManualDrawer');

      inited = true;
    }
    // 每次进页回填最新状态（开关可能从其他途径变过）
    if (orbToggleEl && window.SystemChatOrb && typeof SystemChatOrb.isEnabled === 'function') {
      orbToggleEl.checked = SystemChatOrb.isEnabled();
    }
    skaFill();
  }

  window.TerminalConfigUI = { init };
})();