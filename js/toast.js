/**
 * 溯流计划 · 全局机能战术提示系统 (RetroToast)
 *
 * 规范与特性：
 * 1. 零分割线，零 emoji，全部状态指示采用纯矢量 SVG
 * 2. 顶部悬浮机能指令条（z-index: 15000），无论在主屏、全屏编辑器或二级弹窗皆清晰可见
 * 3. 色彩体系：底色 var(--bg-color)、反色正文 var(--secondary-color)、重点色标题 var(--primary-color)
 * 4. 丝滑弹性进出场、底部微细倒计时能量条、点击即退场、连续触发自平滑替换
 */

(function () {
  'use strict';

  let container = null;
  let activeToastEl = null;
  let dismissTimer = null;

  // 纯 SVG 状态图标集
  const ICONS = {
    warn: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
      </svg>
    `,
    info: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
      </svg>
    `,
    danger: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z"/>
      </svg>
    `,
    success: `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
      </svg>
    `
  };

  function ensureContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.id = 'retroToastContainer';
      container.className = 'retro-toast-container';
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-atomic', 'true');
      document.body.appendChild(container);
    }
    return container;
  }

  function dismissCurrent(immediate = false) {
    if (dismissTimer) {
      clearTimeout(dismissTimer);
      dismissTimer = null;
    }
    if (!activeToastEl) return;

    const el = activeToastEl;
    activeToastEl = null;

    if (immediate) {
      el.remove();
      return;
    }

    el.classList.remove('is-entering');
    el.classList.add('is-leaving');
    el.addEventListener('transitionend', () => {
      el.remove();
    }, { once: true });
    // 保险兜底
    setTimeout(() => el.remove(), 260);
  }

  /**
   * 显示 Toast
   * @param {Object|string} options
   *   - message: 主提示文案（重点色）
   *   - detail: 副说明文案（可选，反色深灰黑）
   *   - tag: 前缀小标签（可选，如 NEXUS // 关系对象）
   *   - type: 'warn' | 'info' | 'danger' | 'success' (默认 'warn')
   *   - duration: 停留毫秒数 (默认 2800)
   */
  function show(options) {
    if (typeof options === 'string') {
      options = { message: options };
    }
    const opts = Object.assign({
      message: '',
      detail: '',
      tag: 'SYSTEM // 提示',
      type: 'warn',
      duration: 2800
    }, options || {});

    if (!opts.message) return;

    const cont = ensureContainer();
    // 若当前已有 Toast，先快速离场
    dismissCurrent(true);

    const toast = document.createElement('div');
    toast.className = `retro-toast-item type-${opts.type}`;
    toast.setAttribute('role', 'status');

    // 左侧纯 SVG 状态图标
    const iconWrap = document.createElement('div');
    iconWrap.className = 'retro-toast-icon';
    iconWrap.innerHTML = ICONS[opts.type] || ICONS.warn;
    toast.appendChild(iconWrap);

    // 中部文本群组
    const body = document.createElement('div');
    body.className = 'retro-toast-body';

    if (opts.tag) {
      const tagEl = document.createElement('div');
      tagEl.className = 'retro-toast-tag';
      tagEl.textContent = opts.tag;
      body.appendChild(tagEl);
    }

    const titleEl = document.createElement('div');
    titleEl.className = 'retro-toast-title';
    titleEl.textContent = opts.message;
    body.appendChild(titleEl);

    if (opts.detail) {
      const detailEl = document.createElement('div');
      detailEl.className = 'retro-toast-detail';
      detailEl.textContent = opts.detail;
      body.appendChild(detailEl);
    }
    toast.appendChild(body);

    // 底部倒计时能量条
    const progress = document.createElement('div');
    progress.className = 'retro-toast-progress';
    progress.style.transitionDuration = `${opts.duration}ms`;
    toast.appendChild(progress);

    // 右侧纯 SVG 透明底即时关闭按钮
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'retro-toast-close-btn';
    closeBtn.setAttribute('aria-label', '关闭提示');
    closeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
      </svg>
    `;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissCurrent(false);
    });
    toast.appendChild(closeBtn);

    // 点击整个 Toast 也可以退场
    toast.addEventListener('click', () => {
      dismissCurrent(false);
    });

    cont.appendChild(toast);
    activeToastEl = toast;

    // 下一帧触发入场与进度条动画
    requestAnimationFrame(() => {
      toast.classList.add('is-entering');
      requestAnimationFrame(() => {
        progress.classList.add('is-depleting');
      });
    });

    // 自动消退
    dismissTimer = setTimeout(() => {
      dismissCurrent(false);
    }, opts.duration);
  }

  function warn(message, detail = '', tag = 'CAUSAL NOTICE // 提示') {
    show({ message, detail, tag, type: 'warn' });
  }

  function info(message, detail = '', tag = 'SYSTEM LOG // 讯息') {
    show({ message, detail, tag, type: 'info' });
  }

  function danger(message, detail = '', tag = 'ERROR // 阻断') {
    show({ message, detail, tag, type: 'danger' });
  }

  function success(message, detail = '', tag = 'SYNC // 已就绪') {
    show({ message, detail, tag, type: 'success' });
  }

  window.RetroToast = {
    show,
    warn,
    info,
    danger,
    success,
    dismiss: () => dismissCurrent(false)
  };
})();
