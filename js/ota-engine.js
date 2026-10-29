/**
 * ============================================================================
 * 溯流计划 · OTA 应用引擎（JS 侧薄封装，window.RetroflowOTA）
 * ============================================================================
 *
 * 与原生插件 RetroflowOta 对接。真正的下载 / 校验 / 解压 / 原子切换 / 回滚守卫
 * 全在原生 Java 里做，更新包的字节不过 JS↔原生桥（OOM 教训，见插件类注释）。
 * 本文件只负责：把检查结论里的包信息交给原生、把原生进度事件转给 UI、
 * 应用成功后重载、以及启动确认（解除回滚守卫）。
 *
 * 仅在装机版（<html> 带 is-native）生效；浏览器 / PWA 里 applyUpdate 直接拒绝，
 * 那边的更新走 Service Worker，不需要也不应该走这里。
 *
 * 规范：零 Emoji、零分割线、纯 SVG。
 * ============================================================================
 */
(() => {
  'use strict';

  function nativeOta() {
    return (window.Capacitor && window.Capacitor.Plugins &&
      window.Capacitor.Plugins.RetroflowOta) || null;
  }

  function isNative() {
    return document.documentElement.classList.contains('is-native');
  }

  let progressListenerAdded = false;

  /**
   * 应用一次更新。
   * @param {object} checkResult RetroflowUpdate.checkForUpdate() 的返回（须为 update-available）
   * @param {{onProgress?: (p:{phase:string,percent:number})=>void}} [opts]
   * @returns {Promise<{ok:boolean, build:number}>}
   */
  async function applyUpdate(checkResult, opts) {
    const ota = nativeOta();
    if (!ota || !isNative()) {
      throw new Error('更新引擎不可用（需装机版）');
    }
    if (!checkResult || checkResult.status !== 'update-available' || !checkResult.remote) {
      throw new Error('没有可应用的更新');
    }
    const pkg = checkResult.remote.packages && checkResult.remote.packages.full;
    if (!pkg || !pkg.url) throw new Error('更新清单缺少下载地址');
    if (!pkg.sha256) throw new Error('更新清单缺少校验值，拒绝安装');

    // 进度事件：addListener 全程只注册一次，避免重复回调叠加
    if (!progressListenerAdded && typeof ota.addListener === 'function') {
      progressListenerAdded = true;
      try {
        await ota.addListener('otaProgress', (p) => {
          if (opts && typeof opts.onProgress === 'function') opts.onProgress(p || {});
        });
      } catch (e) {
        // 监听失败不阻断更新，只是没有进度条
      }
    }

    const res = await ota.applyUpdate({
      url: pkg.url,
      sha256: pkg.sha256,
      size: pkg.size || 0,
      build: checkResult.remote.build || 0,
      version: checkResult.remote.version || ''
    });

    if (!res || !res.ok) throw new Error('更新未成功');

    // 覆盖层已就位，重载让 WebView 重新经路由处理器加载新资源。
    // 延迟一点，给 UI 一个「安装完成」的可见瞬间。
    setTimeout(() => { try { window.location.reload(); } catch (e) {} }, 400);
    return res;
  }

  /**
   * 启动确认：覆盖层的核心脚本能跑到这里，说明它没有把 app 弄崩，
   * 通知原生解除回滚守卫（删除 pending-confirm 标记）。
   * 若覆盖层是坏的，本函数永不执行，下次启动原生会自动回滚到内置资源。
   */
  function confirmBoot() {
    const ota = nativeOta();
    if (ota && isNative() && typeof ota.confirmBoot === 'function') {
      try { ota.confirmBoot().catch(() => {}); } catch (e) {}
    }
  }

  /** 读取当前生效覆盖层版本（用于界面区分「内置」与「热更」）。 */
  async function getAppliedVersion() {
    const ota = nativeOta();
    if (!ota || !isNative() || typeof ota.getAppliedVersion !== 'function') {
      return { hotUpdated: false };
    }
    try {
      return await ota.getAppliedVersion();
    } catch (e) {
      return { hotUpdated: false };
    }
  }

  window.RetroflowOTA = { applyUpdate, confirmBoot, getAppliedVersion };

  // 启动确认时机：以 Boot 的 store-ready 为主（配置装载完成最能代表 app 正常），
  // 辅以 load 事件与「加载时已 ready」两种兜底。confirmBoot 幂等，多次调用无害。
  function scheduleConfirm() {
    if (!isNative()) return;
    const fire = () => setTimeout(confirmBoot, 300);
    if (window.Boot && typeof window.Boot.isReady === 'function' && window.Boot.isReady()) {
      fire();
      return;
    }
    window.addEventListener('retroflow:store-ready', fire, { once: true });
    window.addEventListener('load', () => setTimeout(fire, 800), { once: true });
  }
  scheduleConfirm();
})();
