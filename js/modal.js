/**
 * 溯流计划 · 全局通用执行员战术弹窗控制器 (Retroflow Modal Controller)
 * 零 emoji、纯 SVG 图标、零物理分割线、Promise 级复用
 *
 * 用法示例：
 *   const ok = await RetroModal.confirm({
 *     tag: 'WARNING',
 *     title: '视界复位',
 *     message: '确定将 6 大色彩通道恢复为默认值吗？',
 *     detail: '已保存的壁纸与字体资产不受影响。',
 *     confirmText: '确认重置',
 *     cancelText: '取消',
 *     danger: true
 *   });
 *   if (ok) { ... }
 */
window.RetroModal = (() => {
  const overlay = document.getElementById('retroModalOverlay');
  const iconBadge = document.getElementById('retroModalIconBadge');
  const msgEl = document.getElementById('retroModalMessage');
  const detailEl = document.getElementById('retroModalDetail');
  const cancelBtn = document.getElementById('retroModalCancelBtn');
  const confirmBtn = document.getElementById('retroModalConfirmBtn');
  const rememberWrap = document.getElementById('retroModalRememberWrap');
  const rememberCheckbox = document.getElementById('retroModalRememberCheckbox');

  let currentResolver = null;
  let currentRememberKey = '';

  function close(result) {
    if (overlay) overlay.hidden = true;
    const remember = Boolean(result && currentRememberKey && rememberCheckbox && rememberCheckbox.checked);
    const rememberKey = currentRememberKey;
    currentRememberKey = '';
    if (remember) {
      try { localStorage.setItem(rememberKey, '1'); } catch (_) { /* 忽略偏好写入失败 */ }
    }
    if (rememberCheckbox) rememberCheckbox.checked = false;
    if (currentResolver) {
      const fn = currentResolver;
      currentResolver = null;
      fn(Boolean(result));
    }
  }

  if (overlay) {
    overlay.addEventListener('click', (e) => {
      // 点遮罩空白处等同于取消
      if (e.target === overlay) close(false);
    });
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => close(false));
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => close(true));
  }

  window.addEventListener('keydown', (e) => {
    if (overlay && !overlay.hidden) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    }
  });

  /**
   * 唤起通用执行员战术确认弹窗（极简 Hero Text 模式）
   * @param {object} options
   * @param {string} [options.message='确定要执行此操作吗？'] 核心大正文
   * @param {string} [options.detail=''] 辅助说明
   * @param {string} [options.confirmText='确认'] 确认按钮文字
   * @param {string} [options.cancelText='取消'] 取消按钮文字
   * @param {boolean} [options.danger=false] 是否危险动作（高亮感叹号与确认键）
   * @returns {Promise<boolean>}
   */
  function confirm(options) {
    const opts = Object.assign({
      message: '确定要执行此操作吗？',
      detail: '',
      confirmText: '确认',
      cancelText: '取消',
      danger: false,
      rememberKey: ''
    }, options || {});

    if (msgEl) msgEl.textContent = opts.message;
    if (detailEl) detailEl.textContent = opts.detail;
    currentRememberKey = String(opts.rememberKey || '');
    if (rememberWrap) rememberWrap.hidden = !currentRememberKey;
    if (rememberCheckbox) rememberCheckbox.checked = false;
    // 复原双按钮形态（alert 单按钮模式可能隐藏过取消键）
    if (cancelBtn) {
      cancelBtn.hidden = false;
      cancelBtn.textContent = opts.cancelText;
    }

    if (iconBadge) {
      iconBadge.className = 'retro-modal-icon-badge' + (opts.danger ? ' danger' : '');
    }

    if (confirmBtn) {
      confirmBtn.textContent = opts.confirmText;
      confirmBtn.className = 'retro-modal-btn confirm' + (opts.danger ? ' danger' : '');
    }

    if (overlay) overlay.hidden = false;

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  /**
   * 唤起单按钮告知型弹窗（仅「知道了」，用于校验失败等阻断提示）
   * @param {object} options
   * @param {string} [options.message] 核心大正文
   * @param {string} [options.detail=''] 辅助说明
   * @param {string} [options.confirmText='知道了'] 按钮文字
   * @param {boolean} [options.danger=false] 是否高亮警示
   * @returns {Promise<boolean>}
   */
  function alert(options) {
    currentRememberKey = '';
    if (rememberWrap) rememberWrap.hidden = true;
    if (rememberCheckbox) rememberCheckbox.checked = false;
    const opts = Object.assign({
      message: '',
      detail: '',
      confirmText: '知道了',
      danger: false
    }, options || {});

    if (msgEl) msgEl.textContent = opts.message;
    if (detailEl) detailEl.textContent = opts.detail;

    // 单按钮模式：取消键退场，避免出现无意义的第二选择
    if (cancelBtn) cancelBtn.hidden = true;

    if (iconBadge) {
      iconBadge.className = 'retro-modal-icon-badge' + (opts.danger ? ' danger' : '');
    }

    if (confirmBtn) {
      confirmBtn.textContent = opts.confirmText;
      confirmBtn.className = 'retro-modal-btn confirm' + (opts.danger ? ' danger' : '');
    }

    if (overlay) overlay.hidden = false;

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  return {
    confirm,
    alert,
    close
  };
})();