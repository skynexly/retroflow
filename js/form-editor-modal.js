/**
 * ============================================================================
 * 溯流计划 · 全局通用多字段表单弹窗控制器 (FormEditorModal)
 * 职责：
 * 1. 提供针对「单行输入 + 多行描述」等多属性表单的通用异步弹窗
 * 2. 纯 SVG 矢量图标、零 emoji、零物理分割线、全面变量系统
 * 3. 支持 Promise 异步调用，确认返回表单键值对，取消/关闭返回 null
 * ============================================================================
 */

(function () {
  'use strict';

  let overlay = null;
  let tagEl = null;
  let titleEl = null;
  let fieldsContainer = null;
  let cancelBtn = null;
  let confirmBtn = null;
  let closeBtn = null;

  let currentResolver = null;
  let currentFields = [];

  function initDOM() {
    overlay = document.getElementById('formEditorModalOverlay');
    if (!overlay) return false;

    tagEl = document.getElementById('formEditorModalTag');
    titleEl = document.getElementById('formEditorModalTitle');
    fieldsContainer = document.getElementById('formEditorModalFields');
    cancelBtn = document.getElementById('formEditorModalCancelBtn');
    confirmBtn = document.getElementById('formEditorModalConfirmBtn');
    closeBtn = document.getElementById('formEditorModalCloseBtn');

    if (cancelBtn) cancelBtn.addEventListener('click', () => dismiss(null));
    if (closeBtn) closeBtn.addEventListener('click', () => dismiss(null));

    if (confirmBtn) {
      confirmBtn.addEventListener('click', handleConfirm);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) dismiss(null);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay && !overlay.hidden) {
        dismiss(null);
      }
    });

    return true;
  }

  function handleConfirm() {
    if (!fieldsContainer) return;
    const result = {};
    let hasError = false;

    currentFields.forEach((f) => {
      const el = fieldsContainer.querySelector(`[data-field-key="${f.key}"]`);
      if (!el) return;
      const val = el.value.trim();

      if (f.required && !val) {
        hasError = true;
        el.focus();
        if (window.RetroToast) {
          window.RetroToast.show(f.label || '字段', '该项为必填内容', 'warning');
        }
      }
      result[f.key] = val;
    });

    if (hasError) return;
    dismiss(result);
  }

  function dismiss(val) {
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => {
      overlay.hidden = true;
      if (fieldsContainer) fieldsContainer.innerHTML = '';
      if (typeof currentResolver === 'function') {
        const cb = currentResolver;
        currentResolver = null;
        cb(val);
      }
    }, 180);
  }

  /**
   * 打开多字段编辑弹窗
   * @param {Object} options
   * @param {string} options.tag 顶栏战术英文标签，如 'SKILL // 技能登记'
   * @param {string} options.title 弹窗大标题，如 '生活技能'
   * @param {Array} options.fields 字段列表 [{ key, label, type, placeholder, value, rows, maxLength, required }]
   * @param {string} options.confirmText 确认按钮文案
   * @param {string} options.cancelText 取消按钮文案
   * @returns {Promise<Object|null>}
   */
  function open(options) {
    if (!overlay && !initDOM()) {
      console.warn('[FormEditorModal] 找不到弹窗 DOM 节点');
      return Promise.resolve(null);
    }

    const opts = Object.assign({
      tag: 'FORM // 数据录入',
      title: '编辑信息',
      fields: [],
      confirmText: '确认保存',
      cancelText: '取消'
    }, options || {});

    currentFields = Array.isArray(opts.fields) ? opts.fields : [];

    if (tagEl) tagEl.textContent = opts.tag;
    if (titleEl) titleEl.textContent = opts.title;
    if (confirmBtn) confirmBtn.textContent = opts.confirmText;
    if (cancelBtn) cancelBtn.textContent = opts.cancelText;

    if (fieldsContainer) {
      fieldsContainer.innerHTML = '';
      currentFields.forEach((f) => {
        const group = document.createElement('div');
        group.className = 'form-modal-field-group';

        const labelRow = document.createElement('div');
        labelRow.className = 'form-modal-label-row';

        const lbl = document.createElement('label');
        lbl.className = 'form-modal-label';
        lbl.textContent = f.label || f.key;
        labelRow.appendChild(lbl);

        if (f.maxLength) {
          const count = document.createElement('span');
          count.className = 'form-modal-count';
          count.textContent = `0/${f.maxLength}`;
          labelRow.appendChild(count);
        }

        group.appendChild(labelRow);

        let inputEl;
        if (f.type === 'textarea') {
          inputEl = document.createElement('textarea');
          inputEl.className = 'persona-textarea form-modal-textarea';
          inputEl.rows = f.rows || 3;
          inputEl.placeholder = f.placeholder || '';
          inputEl.value = f.value || '';
          inputEl.spellcheck = false;
        } else {
          inputEl = document.createElement('input');
          inputEl.type = 'text';
          inputEl.className = 'persona-input form-modal-input';
          inputEl.placeholder = f.placeholder || '';
          inputEl.value = f.value || '';
          inputEl.autocomplete = 'off';
          inputEl.spellcheck = false;
        }

        inputEl.dataset.fieldKey = f.key;
        if (f.maxLength) inputEl.maxLength = f.maxLength;

        if (f.maxLength) {
          const countEl = labelRow.querySelector('.form-modal-count');
          const updateCount = () => {
            if (countEl) countEl.textContent = `${inputEl.value.length}/${f.maxLength}`;
          };
          inputEl.addEventListener('input', updateCount);
          updateCount();
        }

        group.appendChild(inputEl);
        fieldsContainer.appendChild(group);
      });
    }

    overlay.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add('active');
      const firstInput = fieldsContainer ? fieldsContainer.querySelector('input, textarea') : null;
      if (firstInput) {
        setTimeout(() => firstInput.focus(), 100);
      }
    });

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  window.FormEditorModal = {
    open,
    edit: open,
    close: () => dismiss(null)
  };
})();
