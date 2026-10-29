/**
 * 溯流计划 · PWA 注册层
 * 注册 Service Worker，让桌面终端具备离线可用与安装能力
 */
(() => {
  if (!('serviceWorker' in navigator)) return;

  // Capacitor 原生壳守卫：APK 里 WebView 跑在 https://localhost 虚拟域，
  // 资源全是随包/OTA 下发的本地文件，秒开且天然离线。此时既不需要 SW 缓存，
  // 且 SW 会与自建 OTA 的资源更新抢缓存、导致热更后仍读旧壳。原生壳直接跳过注册。
  // 纯 Web / 已安装 PWA 环境（window.Capacitor 不存在）行为完全不变。
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
    && window.Capacitor.isNativePlatform()) {
    console.log('[Retroflow] 检测到 Capacitor 原生壳，跳过 Service Worker 注册（离线能力由壳 + OTA 提供）');
    return;
  }

  // 刻意不监听 controllerchange 做整页重载：
  // 新 SW 接管是异步的，往往落在用户刚点进某个功能的瞬间，
  // 那一下重载会把人打回桌面（hash 没有启动恢复逻辑），且首帧还会闪一下默认配色。
  // 新版本改为「下次启动自然生效」，接管本身照常完成，离线缓存不受影响。
  window.addEventListener('load', () => {
    // updateViaCache: 'none' —— 强制每次都向网络校验 sw.js 本身，
    // 否则 SW 脚本会被 HTTP 缓存挟持，导致新缓存策略迟迟无法接管。
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        console.log('[Retroflow] Service Worker 已就绪：', reg.scope);
        // 主动探一次更新，让开发期的策略变更尽快换代
        reg.update().catch(() => {});

        // 监听是否有等待中的新 SW，若有则通知其立即激活
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              console.log('[Retroflow] 新版本已安装，准备激活...');
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => {
        console.warn('[Retroflow] Service Worker 注册失败：', err);
      });
  });
})();
