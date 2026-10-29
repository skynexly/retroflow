/**
 * 溯流计划 · Service Worker
 *
 * 策略：全线 network-first + cache:'no-store'，缓存仅作离线兜底。
 * 关键点（开发期必须保证「改动刷新即见」）：
 *   1. fetch 一律带 cache:'no-store'，穿透浏览器 HTTP 缓存，否则拿回来仍是旧文件；
 *   2. install 阶段先清空所有旧缓存再预缓存，新 SW 自行完成换代，无需手动清理；
 *   3. skipWaiting 同步调用，不等 addAll 完成，新 SW 立即接管；
 *   4. 只有 resp.ok 才写入缓存，避免把 404 / 5xx 固化下来。
 */
const CACHE_NAME = 'retroflow-shell-v1274';
const SHELL_ASSETS = [
  './',
  './index.html',
  './data/system-protocols.json',
  './css/variables.css',
  './css/style.css',
  './assets/assistants/asst_system_core.webp',
  './assets/assistants/asst_system_yan.webp',
  './js/storage.js',
  './js/data-registry.js',
  './js/memory-store.js',
  './js/memory-bank-app.js',
  './js/preset-assistants.js',
  './js/store.js',
  './js/boot.js',
  './js/downloader.js',
  './js/chat-shot.js',
  './js/ui-motion.js',
  './js/modal.js',
  './js/toast.js',
  './js/image-picker.js',
  './js/date-picker.js',
  './js/text-editor.js',
  './js/select-modal.js',
  './js/gallery-store.js',
  './js/file-store.js',
  './js/data-vault.js',
  './js/data-vault-ui.js',
  './js/form-editor-modal.js',
  './js/psych-store.js',
  './js/psych-archive-app.js',
  './js/worldbook-ui.js',
  './js/worldbook-mount-modal.js',
  './js/keymatch.js',
  './js/worldbook-engine.js',
  './js/avatar-forge.js',
  './js/gallery-app.js',
  './js/profile.js',
  './js/clock.js',
  './js/apps.js',
  './js/dock.js',
  './js/theme.js',
  './js/theme-ui.js',
  './js/api-core.js',
  './js/tts-cache.js',
  './js/api-ui.js',
  './js/system-protocols.js',
  './js/manual-rag.js',
  './js/manual-app.js',
  './js/api-call-log.js',
  './js/api-call-log-ui.js',
  './js/terminal-config.js',
  './js/keepalive-core.js',
  './assets/audio/silence.m4a',
  './css/api-call-log.css',
  './js/settings.js',
  './js/persona-ui.js',
  './js/resonance-ui.js',
  './js/fork-archive-ui.js',
  './js/fork-pick-ui.js',
  './js/fork-ready-ui.js',
  './js/fork-run-parser.js',
  './js/fork-run-prompt.js',
  './js/system-chat-prompt.js',
  './js/online-chat-prompt.js',
  './js/context-budget.js',
  './js/online-store.js',
  './js/online-ui.js',
  './js/markdown.js',
  './js/chat-day-sep.js',
  './js/online-chat-store.js',
  './js/online-chat-ui.js',
  './js/online-notice.js',
  './js/online-chat-settings.js',
  './js/env-awareness.js',
  './js/system-chat-store.js',
  './js/assistant-chat-core.js',
  './js/system-chat-ui.js',
  './js/system-chat-orb.js',
  './js/file-store-ui.js',
  './js/chat-history-search-ui.js',
  './js/system-chat-settings.js',
  './js/pwa.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './assets/brand/logo.svg',
  './assets/brand/logo2.svg'
];

self.addEventListener('install', (event) => {
  // 同步跳过等待，让新 SW 立刻抢班，不等预缓存跑完
  self.skipWaiting();
  event.waitUntil(
    // 先删除所有旧缓存，再建立当前版本，彻底摆脱手动清缓存的依赖
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => caches.open(CACHE_NAME))
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {})
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/** 网络优先取用：穿透 HTTP 缓存，成功则回写，失败回落缓存 */
function networkFirst(request, fallbackToIndex) {
  return fetch(request, { cache: 'no-store' })
    .then((resp) => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return resp;
    })
    .catch(() => caches.match(request).then((cached) => {
      if (cached) return cached;
      return fallbackToIndex ? caches.match('./index.html') : undefined;
    }));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SW 自身不参与缓存，避免把自己固化住导致无法换代
  if (url.pathname.endsWith('sw.js')) return;

  // 页面导航与 HTML：显式覆盖直接访问 index.html 与根路径两种形态
  const isHtml = req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname === '/'
    || url.pathname === '';

  if (isHtml) {
    event.respondWith(networkFirst(req, true));
    return;
  }

  // 脚本与样式：改动必须刷新即见
  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    event.respondWith(networkFirst(req, false));
    return;
  }

  // 其余静态资源（图标、字体、manifest 等）
  event.respondWith(networkFirst(req, false));
});
