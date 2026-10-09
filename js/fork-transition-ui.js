/**
 * 溯流计划 · 进本时空跃迁终端动画控制器 (Fork Dive Transition Controller)
 * 职责：
 * 1. 承接下潜决断后的全屏仪式感转场；
 * 2. 居中品牌徽记 (assets/brand/logo2.svg) + 纵向心跳呼吸律动；
 * 3. 单行战术轮播滑入槽 (Reel Flip)，新协议自下而上滑入并挤出上一条；
 * 4. 极细战术能量注水流光线 (Progress Ray)，顺滑同步 20% -> 100%；
 * 5. 严格遵守《工地施工协议》：全量 SVG、零 emoji、零物理分割线、iOS 灵动岛保护、色彩严格走主题色变量。
 */
const ForkTransitionUI = (() => {
  'use strict';

  let overlayEl = null;
  let reelBoxEl = null;
  let progressLineEl = null;
  let progressPercentEl = null;
  let skipBtn = null;
  let isPlaying = false;
  let resolveCurrent = null;
  let activeTimers = [];
  let rafId = null;

  // 纯 SVG 双折线跳过微标（严禁 emoji，纯矢量微标）
  const ICONS = {
    skip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="7 6 13 12 7 18"/>
      <polyline points="13 6 19 12 13 18"/>
    </svg>`
  };

  /** 获取执行员安全工号 */
  function getOperatorSerial() {
    try {
      if (window.Store && window.Store.profile) {
        const p = window.Store.profile;
        if (p.operatorId) {
          const raw = String(p.operatorId).trim();
          return raw.startsWith('NO.') ? raw : `NO.${raw}`;
        }
        if (p.serialNo) {
          const raw = String(p.serialNo).trim();
          return raw.startsWith('NO.') ? raw : `NO.${raw}`;
        }
      }
    } catch (_) {}
    return 'NO.000517';
  }

  /** DOM 初始化 */
  function init() {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'forkTransitionOverlay';
    overlayEl.className = 'fork-transition-overlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.hidden = true;

    overlayEl.innerHTML = `
      <div class="fork-transition-stage">
        <!-- 灵动岛避让顶栏与跳过控制 -->
        <header class="fork-transition-header">
          <div class="fork-transition-signal">
            <span class="signal-dot"></span>
            <span class="signal-text">TACTICAL TRANSIT // DIVE_LINK</span>
          </div>
          <button type="button" class="fork-transition-skip-btn" id="forkTransitionSkipBtn" aria-label="跳过跃迁动画" title="跳过">
            <span class="skip-text">SKIP</span>
            <span class="skip-icon">${ICONS.skip}</span>
          </button>
        </header>

        <!-- 屏幕正中核心反应堆工作区 -->
        <main class="fork-transition-centerpiece">
          <!-- 溯流计划 Logo2 核心徽记 -->
          <div class="fork-transit-brand-wrap">
            <img class="fork-transit-brand-logo" src="./assets/brand/logo2.svg" alt="Retroflow 徽记" width="84" height="84" decoding="async">
            <div class="fork-transit-brand-glow"></div>
          </div>

          <!-- 单行滚动轮播槽：新文字自下而上滑入并挤出上一条 -->
          <div class="fork-transit-reel-slot" id="forkTransitReelSlot" aria-live="polite">
            <div class="fork-transit-reel-line init-line" id="forkTransitReelLine">
              <span class="reel-bullet">▪</span>
              <span class="reel-text">正在确认载入人数……</span>
            </div>
          </div>

          <!-- 极细战术注水进度条 -->
          <div class="fork-transit-progress-box">
            <div class="fork-transit-track">
              <div class="fork-transit-bar" id="forkTransitBar"></div>
            </div>
            <div class="fork-transit-meter">
              <span class="meter-code">PROTOCOL // SYNC</span>
              <span class="meter-percent" id="forkTransitPercent">20.0%</span>
            </div>
          </div>
        </main>
      </div>
    `;

    document.body.appendChild(overlayEl);

    reelBoxEl = overlayEl.querySelector('#forkTransitReelSlot');
    progressLineEl = overlayEl.querySelector('#forkTransitBar');
    progressPercentEl = overlayEl.querySelector('#forkTransitPercent');
    skipBtn = overlayEl.querySelector('#forkTransitionSkipBtn');

    if (skipBtn) {
      skipBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        finish();
      });
    }

    // 屏幕任意位置轻点也可快进跳过
    overlayEl.addEventListener('click', () => {
      if (isPlaying) {
        finish();
      }
    });
  }

  /** 清理所有计划定时器与动效循环 */
  function clearTimers() {
    activeTimers.forEach(t => clearTimeout(t));
    activeTimers = [];
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /** 封装安全延时 */
  function wait(ms) {
    return new Promise(res => {
      const t = setTimeout(() => {
        const idx = activeTimers.indexOf(t);
        if (idx !== -1) activeTimers.splice(idx, 1);
        res();
      }, ms);
      activeTimers.push(t);
    });
  }

  /** 推动单行文本挤压轮播 */
  function pushReelText(text, isFinal = false) {
    if (!reelBoxEl) return;

    const oldLine = reelBoxEl.querySelector('.fork-transit-reel-line:not(.exit-up)');
    if (oldLine) {
      oldLine.classList.add('exit-up');
      setTimeout(() => {
        if (oldLine.parentNode === reelBoxEl) {
          reelBoxEl.removeChild(oldLine);
        }
      }, 300);
    }

    const newLine = document.createElement('div');
    newLine.className = `fork-transit-reel-line enter-down ${isFinal ? 'is-final' : ''}`;
    newLine.innerHTML = `
      <span class="reel-bullet">▪</span>
      <span class="reel-text">${text}</span>
    `;
    reelBoxEl.appendChild(newLine);

    // 触发下一次 microtask 激活入场平移
    requestAnimationFrame(() => {
      newLine.classList.remove('enter-down');
    });
  }

  /** 设置进度条与百分比数值 */
  function setProgress(percent, label = null) {
    if (progressLineEl) {
      progressLineEl.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    }
    if (progressPercentEl) {
      progressPercentEl.textContent = label || `${percent.toFixed(1)}%`;
    }
  }

  /**
   * 播放进本跃迁终端流式动画（丝滑连续注水版）
   * @param {Object} [options]
   * @returns {Promise<boolean>}
   */
  function play(options = {}) {
    init();
    clearTimers();

    isPlaying = true;
    overlayEl.hidden = false;
    overlayEl.setAttribute('aria-hidden', 'false');
    void overlayEl.offsetWidth;
    overlayEl.classList.add('active');

    const operatorSerial = getOperatorSerial();

    // 5 阶段文本与触发进度阈值 (毫秒与百分比解耦，保证绝对连续流动)
    const phases = [
      { text: '正在确认载入人数……', atPct: 0, isFinal: false },
      { text: '副本构建中，请稍后……', atPct: 22, isFinal: false },
      { text: '正在锚定载入节点坐标……', atPct: 48, isFinal: false },
      { text: '正在启动跃迁进程……', atPct: 72, isFinal: false },
      { text: `载入成功，执行员 ${operatorSerial}，祝你一路顺风`, atPct: 92, isFinal: true }
    ];

    if (reelBoxEl) reelBoxEl.innerHTML = '';
    setProgress(0, '0.0%');

    return new Promise((resolve) => {
      resolveCurrent = resolve;

      const totalDuration = 2400; // 总注水时长 2.4 秒
      const startTime = performance.now();
      let currentPhaseIdx = -1;

      function frame(now) {
        if (!isPlaying) return;

        const elapsed = now - startTime;
        const rawProgress = Math.min(1, elapsed / totalDuration);

        // 丝滑缓动曲线：开头平缓 -> 中间平稳推进 -> 结尾略微蓄能吸附
        const eased = rawProgress < 0.8
          ? (rawProgress / 0.8) * 0.85
          : 0.85 + Math.pow((rawProgress - 0.8) / 0.2, 0.85) * 0.15;

        const currentPct = Math.min(100, Math.max(0, eased * 100));

        // 检查是否跨过下一阶段的文字轮播阈值
        for (let i = phases.length - 1; i >= 0; i--) {
          if (currentPct >= phases[i].atPct) {
            if (i > currentPhaseIdx) {
              currentPhaseIdx = i;
              pushReelText(phases[i].text, phases[i].isFinal);
            }
            break;
          }
        }

        // 逐帧连续无顿挫更新进度条与仪表读数
        if (currentPct >= 100) {
          setProgress(100, '100% LOCKED');
          // 达到 100% 后稍作停顿，优雅进入推演终端
          const finishTimer = setTimeout(() => {
            if (isPlaying) finish();
          }, 380);
          activeTimers.push(finishTimer);
          return;
        } else {
          setProgress(currentPct);
          rafId = requestAnimationFrame(frame);
        }
      }

      rafId = requestAnimationFrame(frame);
    });
  }

  /** 结束并优雅淡出 */
  function finish() {
    if (!isPlaying) return;
    isPlaying = false;
    clearTimers();

    if (overlayEl) {
      overlayEl.classList.remove('active');
      overlayEl.classList.add('fade-out');

      setTimeout(() => {
        if (overlayEl) {
          overlayEl.hidden = true;
          overlayEl.setAttribute('aria-hidden', 'true');
          overlayEl.classList.remove('fade-out');
        }
        if (resolveCurrent) {
          const cb = resolveCurrent;
          resolveCurrent = null;
          cb(true);
        }
      }, 260);
    } else {
      if (resolveCurrent) {
        const cb = resolveCurrent;
        resolveCurrent = null;
        cb(true);
      }
    }
  }

  return {
    init,
    play,
    finish
  };
})();

window.ForkTransitionUI = ForkTransitionUI;
