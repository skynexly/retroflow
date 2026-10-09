/**
 * 溯流计划 · 全屏沉浸式文本编辑器 (TextEditorModal Controller)
 * 职责：
 * 1. 提供针对设定、Prompt、人设等长文本的全屏编辑体验
 * 2. 实时字数统计与超出警示
 * 3. 支持快捷辅助操作：清空、一键还原、快捷换行、剪贴板粘贴
 * 4. 提供 Promise 接口 TextEditorModal.open({ title, tag, value, placeholder, maxLength })
 *    maxLength 传 null / false / 非正数时启用不限长模式。
 */
const TextEditorModal = (() => {
  'use strict';

  let overlay = null;
  let tagEl = null;
  let titleEl = null;
  let counterEl = null;
  let textarea = null;
  let cancelBtn = null;
  let confirmBtn = null;
  let pasteBtn = null;
  let clearBtn = null;

  let currentResolver = null;
  let originalValue = '';
  let maxLen = 5000;
  let isInitialized = false;
  // 标记「本次 history.back() 是我们主动触发的」，避免 popstate 重复处理
  let pendingProgrammaticBack = false;

  function initDOM() {
    if (isInitialized) return;
    overlay = document.getElementById('textEditorOverlay');
    if (!overlay) return;

    tagEl = document.getElementById('textEditorTag');
    titleEl = document.getElementById('textEditorTitle');
    counterEl = document.getElementById('textEditorCounter');
    textarea = document.getElementById('textEditorTextarea');
    cancelBtn = document.getElementById('textEditorCancelBtn');
    confirmBtn = document.getElementById('textEditorConfirmBtn');
    pasteBtn = document.getElementById('textEditorPasteBtn');
    clearBtn = document.getElementById('textEditorClearBtn');

    // 实时字数统计
    textarea.addEventListener('input', updateCounter);

    // 粘贴快捷动作
    if (pasteBtn) {
      pasteBtn.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const clipText = await navigator.clipboard.readText();
            if (clipText) {
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const val = textarea.value;
              textarea.value = val.slice(0, start) + clipText + val.slice(end);
              textarea.selectionStart = textarea.selectionEnd = start + clipText.length;
              textarea.focus();
              updateCounter();
            }
          } else {
            textarea.focus();
          }
        } catch (e) {
          textarea.focus();
        }
      });
    }

    // 清空快捷动作
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        textarea.value = '';
        textarea.focus();
        updateCounter();
      });
    }

    // 取消退出（不保存更改）
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => close(null));
    }

    // 确认保存
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        close(textarea.value);
      });
    }

    // ESC 键退出
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.hidden) {
        close(null);
      }
    });

    // 系统手势返回 / 物理返回键：等同「取消」，不保存更改（与 ESC 行为一致）
    window.addEventListener('popstate', () => {
      if (pendingProgrammaticBack) {
        // UI 已在点击取消/确认时同步关闭，这里只消化事件
        pendingProgrammaticBack = false;
        return;
      }
      if (overlay && !overlay.hidden) {
        // 手势已消掉历史条目，只收 UI，不再二次操作 history
        dismissEditorUI(null);
      }
    });

    isInitialized = true;
  }

  function updateCounter() {
    if (!counterEl || !textarea) return;
    const len = textarea.value.length;
    const hasLimit = Number.isFinite(maxLen) && maxLen > 0;
    counterEl.textContent = hasLimit ? `${len} / ${maxLen}` : `${len}`;
    counterEl.classList.toggle('exceeded', hasLimit && len > maxLen);
  }

  function open(options = {}) {
    initDOM();
    if (!overlay) return Promise.resolve(null);

    const {
      title = '长文本编辑',
      tag = 'TEXT EDITOR // 全屏输入',
      value = '',
      placeholder = '在此输入详细文本内容...',
      maxLength = 5000,
      // 只读模式：禁用输入与保存，仅供查看（如生图提示词 / 识图结果）
      readOnly = false
    } = options;

    originalValue = value || '';
    maxLen = Number.isFinite(maxLength) && maxLength > 0 ? maxLength : null;

    if (tagEl) tagEl.textContent = tag;
    if (titleEl) titleEl.textContent = title;
    if (textarea) {
      textarea.value = originalValue;
      textarea.placeholder = placeholder;
      if (maxLen) {
        textarea.maxLength = maxLen;
      } else {
        textarea.removeAttribute('maxlength');
      }
      // 只读态：禁止编辑；可编辑态需显式还原（弹窗单例，上次只读不复位会残留）
      textarea.readOnly = !!readOnly;
    }

    // 只读态收起写入相关控件：保存钮、工具栏（粘贴 / 清空），返回钮语义变「关闭」
    const toolbarEl = overlay.querySelector('.text-editor-toolbar');
    if (confirmBtn) confirmBtn.hidden = !!readOnly;
    if (toolbarEl) toolbarEl.hidden = !!readOnly;
    if (cancelBtn) cancelBtn.setAttribute('aria-label', readOnly ? '关闭' : '取消并返回');

    updateCounter();

    overlay.hidden = false;
    document.body.classList.add('editor-active');

    // 压入历史栈，让系统手势返回 / 物理返回键可以退出编辑器
    try {
      history.pushState({ rfPage: 'text-editor' }, '', '#text-editor');
    } catch (e) {
      /* ignore */
    }

    requestAnimationFrame(() => {
      overlay.classList.add('active');
      if (textarea) {
        textarea.focus();
        // 光标移至末尾
        const end = textarea.value.length;
        textarea.setSelectionRange(end, end);
      }
    });

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  /** 仅收起 UI 并兑现 Promise，不触碰 history（供 popstate 复用） */
  function dismissEditorUI(result) {
    if (!overlay) return;
    overlay.classList.remove('active');
    document.body.classList.remove('editor-active');

    setTimeout(() => {
      overlay.hidden = true;
      if (currentResolver) {
        currentResolver(result);
        currentResolver = null;
      }
    }, 220);
  }

  function close(result) {
    if (!overlay || overlay.hidden) return;
    dismissEditorUI(result);

    // 主动关闭时消掉自己压入的历史条目，保持栈深度干净
    if ((window.location.hash || '') === '#text-editor') {
      pendingProgrammaticBack = true;
      try {
        history.back();
      } catch (e) {
        pendingProgrammaticBack = false;
      }
    }
  }

  return {
    open,
    // edit 为 open 的等价别名：各档案页（角色/身份/马甲）统一按 edit 调用
    edit: open,
    close
  };
})();

// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.TextEditorModal 写法
window.TextEditorModal = TextEditorModal;