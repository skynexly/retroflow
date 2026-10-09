/**
 * 溯流计划 · 统一下载命名器 (Downloader)
 *
 * 全项目所有对外导出的文件都必须走这里，保证命名规则唯一：
 *   溯流计划-{类型}-{本地时间戳}.{扩展名}
 *   例：溯流计划-头像-2026-08-29-171530.png
 *
 * 说明：网页/PWA 只能决定文件名，无法指定保存目录（那由系统下载设置决定）。
 * 所以靠文件名自带项目标识来聚拢，在下载目录里按名称排序就会自然挨在一起。
 */
const Downloader = (() => {
  'use strict';

  const BRAND = '溯流计划';

  // 文件系统非法字符（Windows / Android 通用禁用集）+ 控制字符
  const ILLEGAL = /[\\/:*?"<>|\u0000-\u001F]/g;

  /** 本地时间戳：2026-08-29-171530（比 ISO 的 T 与时区偏移更好读） */
  function timestamp(date) {
    const d = date instanceof Date ? date : new Date();
    const p = (n) => String(n).padStart(2, '0');
    return [
      d.getFullYear(),
      p(d.getMonth() + 1),
      p(d.getDate())
    ].join('-') + '-' + [
      p(d.getHours()),
      p(d.getMinutes()),
      p(d.getSeconds())
    ].join('');
  }

  /** 清理用户可控片段，避免非法字符导致下载被浏览器静默丢弃 */
  function sanitize(part) {
    return String(part || '')
      .replace(ILLEGAL, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 拼装标准文件名
   * @param {string} label 类型标签，如 '头像' / '存档' / '日志'
   * @param {string} ext 扩展名，可带点也可不带
   * @returns {string} 溯流计划-头像-2026-08-29-171530.png
   */
  function buildName(label, ext) {
    const tag = sanitize(label) || '文件';
    let suffix = sanitize(ext).replace(/^\.+/, '').toLowerCase();
    // jpeg 统一写成 jpg，避免同类文件出现两种扩展名
    if (suffix === 'jpeg') suffix = 'jpg';
    const base = `${BRAND}-${tag}-${timestamp()}`;
    return suffix ? `${base}.${suffix}` : base;
  }

  /** 从 dataURL 的 MIME 推断扩展名，拿不到就回退 */
  function extFromSrc(src, fallback) {
    const s = String(src || '');
    const mime = (s.match(/^data:([^;,]+)/) || [])[1];
    if (mime) {
      const sub = mime.split('/')[1] || '';
      const clean = sub.replace(/\+xml$/, '').toLowerCase();
      if (clean === 'jpeg') return 'jpg';
      if (clean) return clean;
    }
    // http(s) 链接：取路径末尾的扩展名，忽略 query
    const path = s.split('?')[0].split('#')[0];
    const m = path.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
    return fallback || '';
  }

  /**
   * 触发下载
   * @param {string|Blob} data dataURL / blob: / http(s) 链接，或 Blob
   * @param {string} label 类型标签，如 '头像'
   * @param {string} [ext] 扩展名，省略时自动推断
   * @returns {string} 实际使用的文件名
   */
  function save(data, label, ext) {
    if (!data) return '';

    const isBlob = typeof Blob !== 'undefined' && data instanceof Blob;
    // Blob 需要临时 objectURL，用完必须释放，否则整页生命周期内一直占内存
    const href = isBlob ? URL.createObjectURL(data) : String(data);
    const finalExt = ext || extFromSrc(isBlob ? '' : href, isBlob ? extFromMime(data.type) : '');
    const name = buildName(label, finalExt);

    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    if (isBlob) {
      // 立即 revoke 会让部分浏览器来不及取数据，延后一拍更稳
      setTimeout(() => URL.revokeObjectURL(href), 4000);
    }
    return name;
  }

  function extFromMime(mime) {
    const sub = String(mime || '').split('/')[1] || '';
    const clean = sub.replace(/\+xml$/, '').toLowerCase();
    if (clean === 'jpeg') return 'jpg';
    return clean;
  }

  /* ---------------- 图片专用：多级降级保存 ---------------- */

  /** 任意图片来源（dataURL / blob: / http(s) / Blob）统一收敛成 Blob */
  async function toBlob(data) {
    if (typeof Blob !== 'undefined' && data instanceof Blob) return data;
    const src = String(data || '');
    if (!src) return null;
    const resp = await fetch(src);
    if (!resp.ok) throw new Error('影像读取失败');
    return await resp.blob();
  }

  /**
   * 保存图片。为 standalone PWA（无浏览器 UI 的 WebView）做了三级降级：
   *
   *   1. objectURL + <a download> —— 下载按钮直接保存，不主动唤起分享面板；
   *   2. dataURL 直下 —— 兼容不支持 objectURL 下载的环境；
   *   3. navigator.share 不由下载按钮调用，避免“保存图片”被错误变成分享。
   *
   * 为什么不直接用第 3 级：768x1024 的 PNG 转 base64 后 href 长达数 MB，
   * WebView 的下载管理器对超长 dataURL 处理不稳定，表现为「时灵时不灵」。
   *
   * @param {string|Blob} data 图片来源
   * @param {string} label 类型标签，如 '头像'
   * @param {string} [ext] 扩展名，省略时按 mime 推断
   * @returns {Promise<{name:string, via:'objecturl'|'dataurl'}>}
   */
  async function saveImage(data, label, ext) {
    if (!data) throw new Error('没有可保存的影像');

    const blob = await toBlob(data);
    if (!blob) throw new Error('没有可保存的影像');

    const finalExt = ext || extFromMime(blob.type) || 'png';
    const name = buildName(label, finalExt);

    // 1) objectURL：下载按钮应直接保存，不主动调用 navigator.share。
    // 句柄很短，可以规避超长 dataURL 在 WebView 中的不稳定行为。
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // 立即 revoke 会让部分 WebView 来不及取数据，延后一拍
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return { name, via: 'objecturl' };
    } catch (err) {
      /* 继续降级 */
    }

    // 2) dataURL 兜底
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    save(dataUrl, label, finalExt);
    return { name, via: 'dataurl' };
  }

  return {
    BRAND,
    save,
    saveImage,
    buildName,
    timestamp
  };
})();

// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.Downloader 写法
window.Downloader = Downloader;
