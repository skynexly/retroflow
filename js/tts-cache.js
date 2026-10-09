/**
 * 溯流计划 · 语音合成缓存层 (Retroflow TTS Cache)
 *
 * 目的：语音合成按字符计费，同一段文本 + 同一套声学配置不该重复扣费。
 *
 * 缓存键 = 文本 + 完整配置指纹（端点 / 模型 / 音色 / 语速 / 音调）。
 * 任意一项配置改动都会让键失配，自动重新合成——保证「调完参数点试听」
 * 听到的一定是新参数的效果，而不是旧音频。
 *
 * 同时做 in-flight 去重：连点按钮时复用同一个 Promise，避免并发重复计费。
 */
window.RetroflowTTSCache = (() => {
  /** @type {Map<string, {blob: Blob, url: string, size: number, at: number}>} */
  const store = new Map();
  /** @type {Map<string, Promise<any>>} */
  const inFlight = new Map();

  // 单条语音通常几十 KB，留 24 条足够覆盖试听与短句复用
  const MAX_ENTRIES = 24;

  /**
   * 生成缓存键：文本 + 声学配置指纹
   * 配置任一项变化 → 键变化 → 不命中缓存
   */
  function buildKey(config, text) {
    const cfg = config || {};
    return [
      String(text || ''),
      String(cfg.baseUrl || ''),
      String(cfg.groupId || ''),
      String(cfg.modelId || ''),
      String(cfg.voiceId || ''),
      String(cfg.speed != null ? cfg.speed : ''),
      String(cfg.pitch != null ? cfg.pitch : '')
    ].join('|');
  }

  /** 超出容量时淘汰最早写入的条目，并释放其 Blob URL */
  function evictIfNeeded() {
    while (store.size > MAX_ENTRIES) {
      const oldestKey = store.keys().next().value;
      const entry = store.get(oldestKey);
      if (entry && entry.url) {
        try { URL.revokeObjectURL(entry.url); } catch (err) { /* 已释放 */ }
      }
      store.delete(oldestKey);
    }
  }

  function get(config, text) {
    return store.get(buildKey(config, text)) || null;
  }

  function has(config, text) {
    return store.has(buildKey(config, text));
  }

  function put(config, text, blob) {
    const key = buildKey(config, text);
    const prev = store.get(key);
    if (prev && prev.url) {
      try { URL.revokeObjectURL(prev.url); } catch (err) { /* 已释放 */ }
    }
    const entry = {
      blob,
      url: URL.createObjectURL(blob),
      size: blob.size,
      at: Date.now()
    };
    store.set(key, entry);
    evictIfNeeded();
    return entry;
  }

  /**
   * 取缓存，未命中则调 synthesizer 合成并入缓存。
   * 相同键的并发调用共享同一个 Promise，防止连点重复计费。
   * @returns {Promise<{entry:object, cached:boolean, latency:number}>}
   */
  async function resolve(config, text, synthesizer) {
    const key = buildKey(config, text);

    const hit = store.get(key);
    if (hit) return { entry: hit, cached: true, latency: 0 };

    const pending = inFlight.get(key);
    if (pending) return pending;

    const task = (async () => {
      const result = await synthesizer();
      const entry = put(config, text, result.blob);
      return { entry, cached: false, latency: result.latency || 0 };
    })();

    inFlight.set(key, task);
    task.catch(() => {}).then(() => { inFlight.delete(key); });
    return task;
  }

  /** 清空全部缓存并释放所有 Blob URL */
  function clear() {
    store.forEach((entry) => {
      if (entry && entry.url) {
        try { URL.revokeObjectURL(entry.url); } catch (err) { /* 已释放 */ }
      }
    });
    store.clear();
  }

  function size() {
    return store.size;
  }

  return { buildKey, get, has, put, resolve, clear, size };
})();
