/**
 * 溯流计划 · 通用图片选择器弹窗控制器 (Image Picker Modal)
 * 提供给「执行员立绘更换」与「桌面壁纸更换」统一复用
 */
const ImagePicker = (() => {
  const modal = document.getElementById('imagePickerModal');
  const titleEl = document.getElementById('imagePickerTitle');
  const closeBtn = document.getElementById('imagePickerCloseBtn');
  const cancelBtn = document.getElementById('imagePickerCancelBtn');
  const fileInput = document.getElementById('imagePickerFileInput');
  const fileCard = document.getElementById('imagePickerFileCard');
  const urlInput = document.getElementById('imagePickerUrlInput');
  const confirmBtn = document.getElementById('imagePickerUrlConfirm');

  let currentCallback = null;
  let isMultiple = false;

  function open({ title = '更换图片', multiple = false, onSelect }) {
    if (!modal) return;
    if (titleEl) titleEl.textContent = title;
    currentCallback = onSelect;
    isMultiple = Boolean(multiple);
    if (fileInput) {
      if (isMultiple) {
        fileInput.setAttribute('multiple', '');
      } else {
        fileInput.removeAttribute('multiple');
      }
    }
    if (urlInput) urlInput.value = '';
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
  }

  function close() {
    if (!modal) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    currentCallback = null;
  }

  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  // 本地上传卡片：与文件区、字体上传同一套成熟写法 —— hidden 属性 + 显式 click。
  // input 用 hidden 隐藏后，label 的原生关联在部分 WebView 上不会触发，
  // 这里由 JS 在用户手势的同一个调用栈里直接唤起，保证相册能弹出。
  if (fileCard && fileInput) {
    fileCard.addEventListener('click', (e) => {
      // 事件源就是 input 本身时不再转发，否则会递归成双弹
      if (e.target === fileInput) return;
      fileInput.click();
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  // 监听 ESC 键
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      close();
    }
  });

  // 本地文件选取
  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      // 用户在系统相册里取消：不触发回调，也不关弹窗，留在原地让人再选一次
      if (!files.length) return;

      const cb = currentCallback;
      close();
      fileInput.value = '';

      if (cb) {
        if (isMultiple) {
          cb({ type: 'files', files });
        } else {
          cb({ type: 'file', file: files[0] });
        }
      }
    });

    // 系统相册取消时不会派发 change，靠 cancel 事件收尾（新版 WebView 支持）
    fileInput.addEventListener('cancel', () => {
      fileInput.value = '';
    });
  }

  // URL 提交
  function handleUrlConfirm() {
    if (!urlInput) return;
    const url = urlInput.value.trim();
    if (!url) return;

    const cb = currentCallback;
    close();
    urlInput.value = '';

    if (cb) {
      if (isMultiple) {
        cb({ type: 'urls', urls: [url] });
      } else {
        cb({ type: 'url', url });
      }
    }
  }

  if (confirmBtn) confirmBtn.addEventListener('click', handleUrlConfirm);
  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleUrlConfirm();
    });
  }

  return { open, close };
})();

// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.ImagePicker 写法
window.ImagePicker = ImagePicker;