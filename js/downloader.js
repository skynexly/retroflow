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

  /* ---------------- 原生壳直写（Capacitor Filesystem） ----------------
   *
   * 装机版 WebView 没有下载器（Capacitor 6 的 BridgeWebView 从不挂
   * DownloadListener），blob: 的 <a download> 会被静默丢弃——这就是
   * 「APK 里点导出没有文件」的根因。原生壳下改走 Filesystem 插件直接写盘。
   *
   * 目录策略（Filesystem 6.0.4 的 getDirectory 不支持 DOWNLOADS，
   * 传了会 reject INVALID_DIR，所以用 EXTERNAL_STORAGE + 相对路径）：
   *   首选  EXTERNAL_STORAGE/Download/{name}  —— 公共下载目录。
   *         Android 11+ 经 FUSE 重定向直写、免任何权限；
   *         Android 10 依赖 requestLegacyExternalStorage + 存储权限；
   *         Android 9- 靠 Manifest 声明的 WRITE_EXTERNAL_STORAGE 运行时请求。
   *   回退  DOCUMENTS/{name} —— 插件对 DOCUMENTS 有完整的权限请求与
   *         MediaScanner 索引逻辑，作为写 Download 失败时的兜底。
   * 写失败抛错，由调用方如实提示——绝不假装成功。
   */

  function nativeFs() {
    return (window.Capacitor && window.Capacitor.Plugins &&
      window.Capacitor.Plugins.Filesystem) || null;
  }

  /** 原生保存可用判定：壳标记 + 插件已注册，二者缺一都退回浏览器路径 */
  function isNativeSave() {
    return Boolean(nativeFs()) &&
      document.documentElement.classList.contains('is-native');
  }

  /** Blob → 纯 base64（不含 data: 前缀），Filesystem.writeFile 只收这种 */
  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const s = String(reader.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(new Error('文件内容读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /** 分块大小（原始字节）。必须是 3 的倍数：
   * 每块独立 base64 编码后，各块拼接仍可无损解码还原。
   * 3MB 原始 → 4MB base64/桥消息。真机实测教训：108MB 备份整串过桥
   * 时，原生 MessageHandler 解析 JSON 直接 OOM（256MB 堆上限）崩掉整个
   * app——分块就是为这个 OOM 设计的，单条桥消息必须保持在个位数 MB。 */
  const CHUNK_BYTES = 3 * 1024 * 1024;

  /** 任意来源收敛成 Blob 后分块写盘；失败清理半截文件再抛错 */
  async function writeViaFilesystem(name, blob, onProgress) {
    const FS = nativeFs();
    if (!blob || !blob.size) throw new Error('文件内容为空');
    const total = blob.size;

    const attempt = async (path, directory) => {
      let wrote = false;
      try {
        for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
          const end = Math.min(offset + CHUNK_BYTES, total);
          const b64 = await blobToBase64(blob.slice(offset, end));
          if (!wrote) {
            // 首块创建文件（recursive 顺带建目录）
            await FS.writeFile({ path, data: b64, directory, recursive: true });
            wrote = true;
          } else {
            await FS.appendFile({ path, data: b64, directory });
          }
          if (onProgress) onProgress({ loaded: end, total });
        }
        return true;
      } catch (err) {
        // 清理半截文件：残留的截断 JSON 备份若被日后导入 = 静默数据损坏
        if (wrote) {
          try { await FS.deleteFile({ path, directory }); } catch (_) { /* 尽力而为 */ }
        }
        throw err;
      }
    };

    try {
      await attempt(`Download/${name}`, 'EXTERNAL_STORAGE');
      return { name, via: 'native', dir: 'Download' };
    } catch (err) {
      // Download 写不进（老设备权限被拒 / 厂商魔改限制）→ Documents 兜底
    }
    await attempt(name, 'DOCUMENTS');
    return { name, via: 'native', dir: 'Documents' };
  }

  /**
   * 触发保存。
   * 原生壳：Filesystem 分块直写公共目录，Promise 在文件真正落盘后才 resolve。
   * 浏览器/PWA：<a download> + objectURL，行为与原来完全一致。
   *
   * @param {string|Blob} data dataURL / blob: / http(s) 链接，或 Blob
   * @param {string} label 类型标签，如 '头像'
   * @param {string} [ext] 扩展名，省略时自动推断
   * @param {{onProgress?:function({loaded:number,total:number}):void}} [opts] 大文件进度回调
   * @returns {Promise<{name:string, via:'native'|'objecturl', dir?:string}>}
   */
  async function save(data, label, ext, opts) {
    if (!data) return { name: '', via: 'none' };

    const isBlob = typeof Blob !== 'undefined' && data instanceof Blob;

    // 原生壳：收敛成 Blob 后分块直写，不走 <a download>。
    // 任何来源（dataURL / objectURL / http）都先 toBlob——
    // 整串 base64 一次过桥会撑爆原生 MessageHandler（实测 108MB OOM 崩溃）。
    if (isNativeSave()) {
      const finalExt = ext || extFromSrc(isBlob ? '' : String(data), isBlob ? extFromMime(data.type) : '');
      const name = buildName(label, finalExt);
      const blob = isBlob ? data : await toBlob(data);
      if (!blob) throw new Error('文件内容读取失败');
      return await writeViaFilesystem(name, blob, opts && opts.onProgress);
    }

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
    return { name, via: 'objecturl' };
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
   * 保存图片。
   *
   * 原生壳（is-native + Filesystem 插件）：收敛成 Blob 后直写文件系统，
   * 目录策略与 save() 相同（Download 首选、Documents 兜底），落盘才 resolve。
   *
   * 浏览器 / standalone PWA 保持三级降级：
   *   1. objectURL + <a download> —— 下载按钮直接保存，不主动唤起分享面板；
   *   2. dataURL 直下 —— 兼容不支持 objectURL 下载的环境；
   *   3. navigator.share 不由下载按钮调用，避免"保存图片"被错误变成分享。
   *
   * 为什么不直接用第 3 级：768x1024 的 PNG 转 base64 后 href 长达数 MB，
   * WebView 的下载管理器对超长 dataURL 处理不稳定，表现为「时灵时不灵」。
   *
   * @param {string|Blob} data 图片来源
   * @param {string} label 类型标签，如 '头像'
   * @param {string} [ext] 扩展名，省略时按 mime 推断
   * @returns {Promise<{name:string, via:'native'|'objecturl'|'dataurl', dir?:string}>}
   */
  async function saveImage(data, label, ext) {
    if (!data) throw new Error('没有可保存的影像');

    const blob = await toBlob(data);
    if (!blob) throw new Error('没有可保存的影像');

    const finalExt = ext || extFromMime(blob.type) || 'png';
    const name = buildName(label, finalExt);

    // 原生壳：Filesystem 分块直写，落盘才返回
    if (isNativeSave()) {
      return await writeViaFilesystem(name, blob);
    }

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
