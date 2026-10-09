/**
 * ============================================================================
 * 溯流计划 · 副本推演壁纸控制器 (Fork Run Wallpaper)
 *
 * 定位：这是「对话设置」范畴的功能，不属界面美化主题。
 *   - 壁纸资产按副本（forkId）隔离，同副本下所有世界线（runId）通用。
 *   - 资产 key 走全站对话壁纸体系 chatWallpaper('fork_<forkId>') →
 *     decor/chat.wallpaper.fork_<forkId>，导出时被对话块认领，不进主题包。
 *   - 遮罩 / 模糊两个可读性保护开关按壁纸走（即按 forkId 存 localStorage），
 *     因为副本正文是裸露在背景上的小说旁白，直接铺大图会糊字，遮罩几乎是刚需。
 *
 * DOM 分层（防糊字关键）：壁纸注入独立底层 #forkRunWallpaperLayer，
 *   filter:blur() 只作用这一层，正文与滚动条永远清晰。
 * ============================================================================
 */
window.ForkRunWallpaper = (() => {
  'use strict';

  const CFG_STORAGE_KEY = 'retroflow_fork_run_wallpaper_cfg_v1';

  // 遮罩默认开、模糊默认关（与桌面壁纸的默认习惯一致）
  const DEFAULT_CFG = { mask: true, blur: false };

  let layerEl = null;
  // 当前注入到壁纸层的运行时 src（blob: 需主动释放）
  let currentSrc = null;
  // 当前生效的副本 id，供开关实时重绘时反查
  let currentForkId = '';

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function ensureLayer() {
    if (!layerEl) {
      layerEl = document.getElementById('forkRunWallpaperLayer');
    }
    return layerEl;
  }

  function wallpaperAssetKey(forkId) {
    const fid = trimStr(forkId);
    if (!fid) return '';
    if (window.DataRegistry && DataRegistry.key && typeof DataRegistry.key.chatWallpaper === 'function') {
      return DataRegistry.key.chatWallpaper('fork_' + fid);
    }
    return 'decor/chat.wallpaper.fork_' + fid;
  }

  /* ================= 遮罩 / 模糊开关配置（按 forkId 存） ================= */

  function readCfgTable() {
    try {
      const raw = localStorage.getItem(CFG_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function getConfig(forkId) {
    const fid = trimStr(forkId);
    if (!fid) return { ...DEFAULT_CFG };
    const table = readCfgTable();
    const saved = table[fid];
    if (!saved || typeof saved !== 'object') return { ...DEFAULT_CFG };
    return {
      mask: saved.mask === undefined ? DEFAULT_CFG.mask : Boolean(saved.mask),
      blur: saved.blur === undefined ? DEFAULT_CFG.blur : Boolean(saved.blur)
    };
  }

  function setConfig(forkId, patch) {
    const fid = trimStr(forkId);
    if (!fid || !patch) return;
    const table = readCfgTable();
    const merged = { ...getConfig(fid), ...patch };
    table[fid] = { mask: Boolean(merged.mask), blur: Boolean(merged.blur) };
    try {
      localStorage.setItem(CFG_STORAGE_KEY, JSON.stringify(table));
    } catch (e) {
      console.error('[ForkRunWallpaper] 保存壁纸配置失败', e);
    }
    // 若正在显示的是同一副本，实时重绘遮罩 / 模糊
    if (fid === currentForkId) {
      applyProtectionClasses(fid);
    }
  }

  /* ================= 壁纸注入 / 恢复 ================= */

  function releaseCurrentSrc() {
    if (currentSrc && currentSrc.startsWith('blob:') && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
      Storage.revokeAssetSrc(currentSrc);
    }
    currentSrc = null;
  }

  function applyProtectionClasses(forkId) {
    const layer = ensureLayer();
    if (!layer) return;
    const cfg = getConfig(forkId);
    // 只有确有壁纸时遮罩 / 模糊才生效；纯色底不加任何滤镜
    const hasWallpaper = Boolean(currentSrc);
    layer.classList.toggle('has-mask', hasWallpaper && cfg.mask);
    layer.classList.toggle('is-blur', hasWallpaper && cfg.blur);
  }

  function paintLayer(src, forkId) {
    const layer = ensureLayer();
    if (!layer) return;
    if (src) {
      layer.style.backgroundImage = `url("${src}")`;
      layer.classList.add('is-active');
    } else {
      layer.style.backgroundImage = 'none';
      layer.classList.remove('is-active');
    }
    applyProtectionClasses(forkId);
  }

  /**
   * 从 IndexedDB 读取该副本壁纸并注入壁纸层。
   * 进本时 fork-run-ui 的 open() 里调用。
   */
  async function restore(forkId) {
    const fid = trimStr(forkId);
    currentForkId = fid;
    releaseCurrentSrc();
    if (!fid) {
      paintLayer(null, fid);
      return null;
    }
    const key = wallpaperAssetKey(fid);
    try {
      if (window.Storage && typeof Storage.getAssetSrc === 'function' && key) {
        const src = await Storage.getAssetSrc(key);
        // 异步回来时用户可能已切走，只在仍是同一副本时注入
        if (fid !== currentForkId) {
          if (src && src.startsWith('blob:')) Storage.revokeAssetSrc(src);
          return null;
        }
        currentSrc = src || null;
        paintLayer(currentSrc, fid);
        return currentSrc;
      }
    } catch (e) {
      console.warn('[ForkRunWallpaper] 恢复壁纸失败', e);
    }
    paintLayer(null, fid);
    return null;
  }

  /**
   * 设置副本壁纸（file 压缩存盘 / url 直存），并即时重绘。
   * @returns {Promise<boolean>} 是否成功
   */
  async function setWallpaper(forkId, payload) {
    const fid = trimStr(forkId);
    if (!fid || !payload) return false;
    const key = wallpaperAssetKey(fid);
    if (!key || !window.Storage) return false;
    try {
      if (payload.type === 'file' && payload.file) {
        const compressed = await Storage.compressImage(payload.file, 1600, 0.88);
        await Storage.setAsset(key, compressed);
      } else if (payload.type === 'url' && payload.url) {
        await Storage.setAsset(key, trimStr(payload.url));
      } else {
        return false;
      }
      // 重新读盘注入（只在仍是同一副本时生效，restore 内部已判定）
      currentForkId = fid;
      await restore(fid);
      return true;
    } catch (e) {
      console.error('[ForkRunWallpaper] 设置壁纸失败', e);
      return false;
    }
  }

  /** 清除副本壁纸（恢复默认纯色底） */
  async function clear(forkId) {
    const fid = trimStr(forkId);
    if (!fid) return false;
    const key = wallpaperAssetKey(fid);
    try {
      if (window.Storage && typeof Storage.removeAsset === 'function' && key) {
        await Storage.removeAsset(key);
      }
    } catch (e) { /* ignore */ }
    releaseCurrentSrc();
    currentForkId = fid;
    paintLayer(null, fid);
    return true;
  }

  /** 是否已装载壁纸（供设置页状态文案判定） */
  function hasWallpaper() {
    return Boolean(currentSrc);
  }

  /** 退出推演时释放运行时资源，清空壁纸层 */
  function teardown() {
    releaseCurrentSrc();
    const layer = ensureLayer();
    if (layer) {
      layer.style.backgroundImage = 'none';
      layer.classList.remove('is-active', 'has-mask', 'is-blur');
    }
    currentForkId = '';
  }

  return {
    getConfig,
    setConfig,
    restore,
    setWallpaper,
    clear,
    hasWallpaper,
    teardown
  };
})();
