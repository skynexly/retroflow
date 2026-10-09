/**
 * 溯流计划 · 文件区页面控制器 (File Vault UI)
 * 职责：
 *   1. 文件区页面的开关（含灵动岛保护、history 栈管理，对齐 gallery-app 规范）
 *   2. 文件上传（限文本类）、列表渲染、查看正文、删除
 *   3. 选择发送模式：供系统聊天进入，勾选文件后回调给聊天层
 *
 * 对外接口：
 *   FileVaultUI.open()                     普通浏览模式
 *   FileVaultUI.openForPick(onConfirm)     选择发送模式，onConfirm(entries) 收到已选文件元数据数组
 */
const FileVaultUI = (() => {
  'use strict';

  const page = document.getElementById('fileVaultPage');
  const closeBtn = document.getElementById('fileVaultCloseBtn');
  const uploadBtn = document.getElementById('fileVaultUploadBtn');
  const fileInput = document.getElementById('fileVaultFileInput');
  const listEl = document.getElementById('fileVaultList');
  const emptyEl = document.getElementById('fileVaultEmpty');
  const totalCountEl = document.getElementById('fileVaultTotalCount');
  const totalSizeEl = document.getElementById('fileVaultTotalSize');
  const totalUnitEl = document.getElementById('fileVaultTotalUnit');
  const pickHint = document.getElementById('fileVaultPickHint');
  const pickDock = document.getElementById('fileVaultPickDock');
  const pickCountEl = document.getElementById('fileVaultPickCount');
  const pickConfirmBtn = document.getElementById('fileVaultPickConfirm');
  const pickDeleteBtn = document.getElementById('fileVaultPickDelete');

  let isOpen = false;
  let isPicking = false;
  let pickCallback = null;
  let selectedIds = new Set();
  let pendingProgrammaticBack = false;
  let activeScope = { type: 'system', id: 'system' };

  function scope() { return activeScope; }

  const DOC_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-3 7V3.5L18.5 9H13z"/></svg>';
  const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
  const DEL_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

  function toast(tag, message, type) {
    if (window.RetroToast && typeof RetroToast.show === 'function') {
      RetroToast.show({ tag, message, type: type || 'info' });
    }
  }

  /* ---------------- 渲染 ---------------- */

  function renderStats() {
    if (!window.FileStore) return;
    const stats = FileStore.getStats(scope());
    if (totalCountEl) totalCountEl.textContent = String(stats.count);
    if (totalSizeEl) totalSizeEl.textContent = String(stats.sizeValue);
    if (totalUnitEl) totalUnitEl.textContent = stats.sizeUnit;
  }

  function renderList() {
    if (!listEl || !window.FileStore) return;
    const items = FileStore.list(scope());
    listEl.innerHTML = '';

    if (!items.length) {
      if (emptyEl) emptyEl.hidden = false;
      renderStats();
      updatePickDock();
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'file-vault-item';
      row.dataset.fileId = item.id;
      if (isPicking && selectedIds.has(item.id)) row.classList.add('is-selected');

      const iconOrCheck = isPicking
        ? `<div class="file-vault-item-check">${CHECK_ICON}</div>`
        : `<div class="file-vault-item-icon">${DOC_ICON}</div>`;

      const delBtn = isPicking
        ? ''
        : `<button class="file-vault-item-del" type="button" aria-label="删除文件" title="删除">${DEL_ICON}</button>`;

      row.innerHTML = `
        ${iconOrCheck}
        <div class="file-vault-item-body">
          <div class="file-vault-item-name">${escapeHtml(item.name)}</div>
          <div class="file-vault-item-meta">
            <span>${escapeHtml(item.sizeText)}</span>
            <span class="file-vault-meta-slash">//</span>
            <span>${item.charCount} 字符</span>
            <span class="file-vault-meta-slash">//</span>
            <span>${escapeHtml(item.timeText)}</span>
          </div>
        </div>
        ${delBtn}
      `;

      // 主体点击：选择模式切换勾选，浏览模式查看正文
      row.addEventListener('click', (e) => {
        if (e.target.closest('.file-vault-item-del')) return;
        if (isPicking) {
          toggleSelect(item.id, row);
        } else {
          viewFile(item);
        }
      });

      if (!isPicking) {
        const del = row.querySelector('.file-vault-item-del');
        if (del) {
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteFile(item);
          });
        }
      }

      listEl.appendChild(row);
    }

    renderStats();
    updatePickDock();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  /* ---------------- 上传 ---------------- */

  async function handleFiles(fileList) {
    if (!window.FileStore || !fileList || !fileList.length) return;
    let ok = 0;
    let rejected = 0;
    for (const file of Array.from(fileList)) {
      const result = await FileStore.record(file, scope());
      if (result && result.error === 'not_text') {
        rejected += 1;
      } else if (result && result.id) {
        ok += 1;
      }
    }
    renderList();
    if (ok > 0) toast('DOC // 归档', `已上传 ${ok} 份文件`, 'success');
    if (rejected > 0) toast('DOC // 已拒绝', `${rejected} 份非文本文件被跳过`, 'warning');
  }

  /* ---------------- 查看 / 删除 ---------------- */

  async function viewFile(entry) {
    const text = await FileStore.getText(entry.id, scope());
    if (text == null) {
      toast('DOC // 读取失败', '文件内容已失效或无法读取', 'warning');
      return;
    }
    openReadOnlyPreview(entry.name, text);
  }

  /* ---------------- 只读预览弹窗（不误用可编辑的 TextEditorModal） ---------------- */

  let previewOverlay = null;

  function closePreview() {
    if (previewOverlay && previewOverlay.parentNode) {
      previewOverlay.parentNode.removeChild(previewOverlay);
    }
    previewOverlay = null;
  }

  function openReadOnlyPreview(name, text) {
    closePreview();
    const overlay = document.createElement('div');
    overlay.className = 'file-preview-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const card = document.createElement('div');
    card.className = 'file-preview-card';

    const header = document.createElement('div');
    header.className = 'file-preview-header';
    const titleWrap = document.createElement('div');
    titleWrap.className = 'file-preview-title-row';
    titleWrap.innerHTML = `
      <svg class="file-preview-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm-3 7V3.5L18.5 9H13z"/></svg>
      <span class="file-preview-title">${escapeHtml(name)}</span>`;
    const closeX = document.createElement('button');
    closeX.className = 'file-preview-close';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', '关闭');
    closeX.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    header.append(titleWrap, closeX);

    const body = document.createElement('div');
    body.className = 'file-preview-body';
    const pre = document.createElement('pre');
    pre.className = 'file-preview-pre';
    pre.textContent = text;
    body.appendChild(pre);

    card.append(header, body);
    overlay.appendChild(card);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePreview(); });
    closeX.addEventListener('click', closePreview);

    document.body.appendChild(overlay);
    previewOverlay = overlay;
  }

  async function deleteFile(entry) {
    const removed = await FileStore.remove([entry.id], scope());
    if (removed > 0) {
      toast('DOC // 清理', `已删除「${entry.name}」`, 'info');
      renderList();
    }
  }

  /* ---------------- 选择发送模式 ---------------- */

  function toggleSelect(id, row) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      if (row) row.classList.remove('is-selected');
    } else {
      selectedIds.add(id);
      if (row) row.classList.add('is-selected');
    }
    updatePickDock();
  }

  function updatePickDock() {
    if (!pickDock) return;
    if (!isPicking) {
      pickDock.hidden = true;
      if (pickHint) pickHint.hidden = true;
      if (listEl) listEl.classList.remove('is-picking');
      return;
    }
    if (pickHint) pickHint.hidden = false;
    pickDock.hidden = false;
    if (listEl) listEl.classList.add('is-picking');
    const n = selectedIds.size;
    if (pickCountEl) pickCountEl.textContent = `已选 ${n} 份`;
    if (pickConfirmBtn) pickConfirmBtn.disabled = n === 0;
    if (pickDeleteBtn) pickDeleteBtn.disabled = n === 0;
  }

  /** 批量删除选中文件，不可逆，走通用二次确认弹窗 */
  async function batchDelete() {
    if (!isPicking) return;
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: `PURGE // 批量清理 (${ids.length})`,
        message: `确认删除选中的 ${ids.length} 份文件吗？`,
        detail: '选中的文件将从文件区永久移除，此操作不可撤销。',
        confirmText: `删除 (${ids.length})`,
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    const removed = await FileStore.remove(ids, scope());
    selectedIds = new Set();
    renderList();
    if (removed > 0) toast('DOC // 清理', `已删除 ${removed} 份文件`, 'info');
  }

  function confirmPick() {
    if (!isPicking || selectedIds.size === 0) return;
    const entries = FileStore.list(scope()).filter((e) => selectedIds.has(e.id));
    const cb = pickCallback;
    // 先收起页面，再回调
    close();
    if (typeof cb === 'function') cb(entries);
  }

  /* ---------------- 开关 ---------------- */

  function openInternal(nextScope) {
    if (nextScope) activeScope = { type: nextScope.type || nextScope.scopeType || 'system', id: nextScope.id || nextScope.scopeId || 'system' };
    if (!page) return;
    page.hidden = false;
    page.setAttribute('aria-hidden', 'false');
    // 强制 reflow，让移除 hidden 与加 active 分帧，进入过渡才会生效
    void page.offsetWidth;
    page.classList.add('active');
    document.body.classList.add('page-active');
    if (window.FileStore && typeof FileStore.reconcile === 'function') {
      FileStore.reconcile(scope()).catch(() => {});
    }
    renderList();
    try {
      history.pushState({ rfPage: 'file-vault' }, '', '#file-vault');
    } catch (e) { /* ignore */ }
    isOpen = true;
  }

  function open() {
    isPicking = false;
    pickCallback = null;
    selectedIds = new Set();
    openInternal();
  }

  function openForPick(scopeOrCallback, maybeCallback) {
    const isScopeArg = scopeOrCallback && typeof scopeOrCallback === 'object';
    const callback = isScopeArg ? maybeCallback : scopeOrCallback;
    const requestedScope = isScopeArg ? scopeOrCallback : null;
    isPicking = true;
    pickCallback = typeof callback === 'function' ? callback : null;
    selectedIds = new Set();
    openInternal(requestedScope);
  }

  /** 仅收起 UI，不触碰 history（供 popstate 复用） */
  function dismissUI() {
    if (!page) return;
    page.setAttribute('aria-hidden', 'true');
    page.classList.remove('active');
    document.body.classList.remove('page-active');
    // 退出过渡 0.36s 结束后再真正隐藏，避免动画被 display:none 吃掉
    setTimeout(() => {
      if (!page.classList.contains('active')) page.hidden = true;
    }, 360);
    isOpen = false;
    isPicking = false;
    pickCallback = null;
    selectedIds = new Set();
  }

  function close() {
    if (!page || !page.classList.contains('active')) return;
    dismissUI();
    if ((window.location.hash || '') === '#file-vault') {
      pendingProgrammaticBack = true;
      try { history.back(); } catch (e) { /* ignore */ }
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      await handleFiles(fileInput.files);
      fileInput.value = '';
    });
  }
  if (pickConfirmBtn) pickConfirmBtn.addEventListener('click', confirmPick);
  if (pickDeleteBtn) pickDeleteBtn.addEventListener('click', batchDelete);

  // 文件区被外部改动（如删除事件）时刷新
  window.addEventListener('retroflow:file-store-changed', () => {
    if (isOpen) renderList();
  });

  // 聊天页文件卡片请求预览时，复用只读预览弹窗
  window.addEventListener('retroflow:preview-file', (e) => {
    const detail = e && e.detail;
    if (detail && typeof detail.text === 'string') {
      openReadOnlyPreview(detail.name || '文件', detail.text);
    }
  });

  window.addEventListener('popstate', () => {
    // 文本编辑器叠在本页之上时，这次返回归它处理
    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }
    if (isOpen) dismissUI();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;
      close();
    }
  });

  return { open: () => { activeScope = { type: 'system', id: 'system' }; openInternal(); }, openForPick, close, isOpen: () => isOpen, getScope: () => ({ ...activeScope }) };
})();

window.FileVaultUI = FileVaultUI;