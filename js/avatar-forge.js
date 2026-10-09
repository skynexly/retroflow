/**
 * 溯流计划 · AI 头像绘像工坊 (Avatar Forge Modal Controller)
 * 职责：
 *   1. 提示词输入弹窗（Prompt View）→ 2:3 结果展台（Result View）双态切换
 *   2. 提示词装配：全局正向词 + 外貌特征 + 本次输入词，负向词走 negativePrompt
 *   3. 有面部识别参考图（persona.face_id）时走 /images/edits 垫图锁脸，
 *      没有时走 /images/generations 纯文生图
 *   4. 全屏灯箱放大、下载保存、设为立绘
 */
(() => {
  'use strict';

  const ASSET_KEY_AVATAR = DataRegistry.key.personaAvatar();
  const ASSET_KEY_FACE_ID = DataRegistry.key.personaFaceId();

  // 头像固定 2:3 竖图，与立绘相框一致
  const AVATAR_SIZE = '768x1024';
  // 画质后缀：提升头像出图质量，属于系统内置装配，不进用户输入框
  const QUALITY_SUFFIX = 'portrait, upper body, front-facing, high quality, detailed';

  // DOM 引用
  const forgeBtn = document.getElementById('personaForgeAvatarBtn');
  const overlay = document.getElementById('avatarForgeOverlay');
  const card = document.getElementById('avatarForgeCard');
  const backBtn = document.getElementById('avatarForgeBackBtn');
  const cancelBtn = document.getElementById('avatarForgeCancelBtn');
  const submitBtn = document.getElementById('avatarForgeSubmitBtn');
  const promptInput = document.getElementById('avatarForgePromptInput');

  // 视图分流
  const inputView = document.getElementById('avatarForgeInputView');
  const resultView = document.getElementById('avatarForgeResultView');
  const resultImg = document.getElementById('avatarForgeResultImg');
  const stageInner = document.getElementById('avatarForgeStageInner');
  const stageLoading = document.getElementById('avatarForgeStageLoading');
  const stageError = document.getElementById('avatarForgeStageError');
  const stageBadge = document.getElementById('avatarForgeStageBadge');
  const errorText = document.getElementById('avatarForgeErrorText');
  const metaRow = document.getElementById('avatarForgeMetaRow');
  const faceTag = document.getElementById('avatarForgeFaceTag');
  const modelTag = document.getElementById('avatarForgeModelTag');
  const latencyEl = document.getElementById('avatarForgeLatency');
  const reBtn = document.getElementById('avatarForgeReBtn');
  const downloadBtn = document.getElementById('avatarForgeDownloadBtn');
  const applyBtn = document.getElementById('avatarForgeApplyBtn');
  const loadingActions = document.getElementById('avatarForgeLoadingActions');
  const resultActions = document.getElementById('avatarForgeResultActions');
  const abortBtn = document.getElementById('avatarForgeAbortBtn');

  // 全屏灯箱
  const lightboxOverlay = document.getElementById('avatarLightboxOverlay');
  const lightboxImg = document.getElementById('avatarLightboxImg');
  const lightboxCloseBtn = document.getElementById('avatarLightboxCloseBtn');

  let currentResultSrc = null;
  let isOpen = false;
  let isGenerating = false;
  let abortCtrl = null;
  let activeOptions = null;

  /* ---------------- 配置与数据读取 ---------------- */

  // 读取生图插槽配置。未配置时返回 null，由调用方给出明确提示
  function getImageSlotConfig() {
    const cfg = Store.config.apiSlots && Store.config.apiSlots.imageGen;
    if (!cfg || !cfg.baseUrl || !cfg.apiKey) return null;
    return cfg;
  }

  function getIdentity() {
    return Store.envoy.identity || {};
  }

  /**
   * 装配本次生图的正向提示词。
   * 顺序：外貌特征 → 本次输入词 → 画质后缀。
   * 全局正向词由 api-core 内部拼在最前，这里不重复处理。
   */
  function buildPrompt(userPrompt) {
    const identity = getIdentity();
    const parts = [];
    const appearance = (activeOptions && activeOptions.appearance !== undefined
      ? activeOptions.appearance
      : (identity.appearance || '')).trim();
    if (appearance) parts.push(appearance);
    const own = (userPrompt || '').trim();
    if (own) parts.push(own);
    parts.push(QUALITY_SUFFIX);
    return parts.join(', ');
  }

  /* ---------------- 视图与状态切换 ---------------- */

  function showInputView() {
    if (inputView) inputView.hidden = false;
    if (resultView) resultView.hidden = true;
  }

  // 结果态三种状态：loading / error / image
  function setStageState(state, payload) {
    if (resultView) resultView.hidden = false;
    if (inputView) inputView.hidden = true;

    const isLoading = state === 'loading';
    const isError = state === 'error';
    const isImage = state === 'image';

    if (stageLoading) stageLoading.hidden = !isLoading;
    if (stageError) stageError.hidden = !isError;
    if (resultImg) resultImg.style.display = isImage ? 'block' : 'none';
    if (stageBadge) stageBadge.hidden = !isImage;

    // 右上状态面板：载入态显示 TELEMETRY / 算力绘制中，出图态显示参数，失败态显示异常
    if (metaRow) {
      metaRow.hidden = false;
      if (isLoading && latencyEl) latencyEl.textContent = 'RENDERING...';
      if (isError && latencyEl) latencyEl.textContent = 'FAILED';
    }

    // 载入中只留「中止生成」，出图或失败后才换回三按钮组
    if (loadingActions) loadingActions.hidden = !isLoading;
    if (resultActions) resultActions.hidden = isLoading;

    if (isError && errorText) {
      errorText.textContent = (payload && payload.message) || '生成失败';
    }
    if (isImage && payload && payload.image && resultImg) {
      resultImg.src = payload.image;
      currentResultSrc = payload.image;
    }

    // 载入中与失败时，下载/设为头像无意义，禁掉避免误触
    const disabled = !isImage;
    if (downloadBtn) downloadBtn.disabled = disabled;
    if (applyBtn) applyBtn.disabled = disabled;
    if (stageInner) stageInner.style.cursor = isImage ? 'zoom-in' : 'default';
  }

  function setSubmitBusy(busy) {
    isGenerating = busy;
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    const span = submitBtn.querySelector('span');
    if (span) span.textContent = busy ? '生成中' : '开始生成';
  }

  /* ---------------- 弹窗控制 ---------------- */

  function open(optionsOrPrompt) {
    if (!overlay || !card) return;
    isOpen = true;
    overlay.hidden = false;
    overlay.classList.add('active');

    // 解析参数（支持旧签名 open(initialPrompt) 或新签名 open({ prompt, appearance, faceIdSrc, onApply })）
    if (typeof optionsOrPrompt === 'string') {
      activeOptions = { prompt: optionsOrPrompt };
    } else if (optionsOrPrompt && typeof optionsOrPrompt === 'object') {
      activeOptions = Object.assign({}, optionsOrPrompt);
    } else {
      activeOptions = null;
    }

    // 清理上一轮的结果图，避免残留与裂图
    currentResultSrc = null;
    if (resultImg) {
      resultImg.removeAttribute('src');
      resultImg.style.display = 'none';
    }
    setSubmitBusy(false);
    showInputView();

    if (promptInput) {
      const initialPrompt = (activeOptions && activeOptions.prompt) || '';
      promptInput.value = initialPrompt;
      setTimeout(() => promptInput.focus(), 100);
    }
  }

  function close() {
    if (!overlay) return;
    // 生成中关闭：中止请求，避免请求悬空
    if (isGenerating && abortCtrl) {
      try { abortCtrl.abort(); } catch (e) { /* ignore */ }
    }
    isOpen = false;
    overlay.classList.remove('active');
    setTimeout(() => {
      if (!isOpen) overlay.hidden = true;
    }, 200);
  }

  /* ---------------- 核心：真实生图 ---------------- */

  async function runGenerate() {
    if (isGenerating) return;

    const cfg = getImageSlotConfig();
    if (!cfg) {
      setStageState('error', {
        message: '未配置生图模型 · 请到设置 › API 算力接入 › 图像生成中填写'
      });
      return;
    }

    const userPrompt = promptInput ? promptInput.value.trim() : '';
    const finalPrompt = buildPrompt(userPrompt);

    // 面容参考图：优先使用外部传入的 faceIdSrc，其次读取本体 face_id
    let faceRef = null;
    let shouldRevokeFaceRef = false;
    try {
      if (activeOptions && activeOptions.faceIdSrc !== undefined) {
        faceRef = activeOptions.faceIdSrc;
      } else {
        faceRef = await Storage.getAssetSrc(ASSET_KEY_FACE_ID);
        shouldRevokeFaceRef = true;
      }
    } catch (err) {
      faceRef = null;
    }

    setSubmitBusy(true);
    setStageState('loading');
    if (faceTag) {
      faceTag.textContent = faceRef ? 'FACE REF // 已挂载锁脸' : 'FACE REF // 未参与';
      faceTag.classList.toggle('active', !!faceRef);
    }
    if (modelTag) {
      const mid = (cfg.modelId || 'DEFAULT').toUpperCase();
      modelTag.textContent = `MODEL // ${mid}`;
    }

    abortCtrl = new AbortController();
    const started = Date.now();

    try {
      let res;
      if (faceRef) {
        // 垫图：锁脸指令由 api-core 内部前置，负向词在 edits 接口不发
        res = await RetroflowAPI.generateImageEdit(cfg, faceRef, {
          prompt: finalPrompt,
          size: AVATAR_SIZE,
          ratioHint: RetroflowAPI.RATIO_HINT_PORTRAIT,
          signal: abortCtrl.signal
        });
      } else {
        res = await RetroflowAPI.generateImage(cfg, {
          prompt: finalPrompt,
          size: AVATAR_SIZE,
          ratioHint: RetroflowAPI.RATIO_HINT_PORTRAIT,
          signal: abortCtrl.signal
        });
      }

      if (!res || !res.image) throw new Error('服务端未返回图像');

      setStageState('image', { image: res.image });

      // 生成即归档：不管用户后续是否点「设为立绘」、之后又换成什么头像，
      // 这张图都会留在图库里，兜住「当时没来得及存图」的场景。
      // 归档失败只告警，绝不影响生图主流程。
      if (window.GalleryStore && typeof GalleryStore.record === 'function') {
        GalleryStore.record(res.image, {
          source: (activeOptions && activeOptions.source) || 'persona'
        }).catch((err) => {
          console.warn('[AvatarForge] 图库归档失败：', err);
        });
      }

      if (latencyEl) {
        const sec = ((res.latency || (Date.now() - started)) / 1000).toFixed(1);
        latencyEl.textContent = `METRICS // ${sec}s · ${res.size || AVATAR_SIZE}`;
      }
    } catch (err) {
      // 主动取消不算失败，直接静默
      if (err && err.name === 'AbortError') return;
      setStageState('error', { message: (err && err.message) || '生成失败' });
    } finally {
      setSubmitBusy(false);
      abortCtrl = null;
      // getAssetSrc 返回的 objectURL 用完即释放，避免每次生图泄漏一个
      if (faceRef && shouldRevokeFaceRef) Storage.revokeAssetSrc(faceRef);
    }
  }

  /* ---------------- 灯箱放大查看 ---------------- */

  function openLightbox(src) {
    if (!lightboxOverlay || !lightboxImg || !src) return;
    lightboxImg.src = src;
    lightboxOverlay.hidden = false;
    lightboxOverlay.classList.add('active');
  }

  function closeLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.classList.remove('active');
    setTimeout(() => {
      lightboxOverlay.hidden = true;
    }, 180);
  }

  /* ---------------- 下载与应用 ---------------- */

  /**
   * 下载成图。
   * 走 Downloader.saveImage 的三级降级（share → objectURL → dataURL）：
   * standalone PWA 的 WebView 对超长 dataURL 的 <a download> 处理不稳定，
   * 直接用 dataURL 会时灵时不灵。
   */
  async function downloadImage(src) {
    if (!src) return;
    if (downloadBtn) downloadBtn.disabled = true;
    try {
      const res = await Downloader.saveImage(src, '头像');
      if (window.RetroToast) {
        // 走系统分享面板时由用户自己选目标，措辞要跟直接落盘区分开
        const isShare = res.via === 'share';
        RetroToast.show({
          tag: 'FORGE // 导出影像',
          message: isShare ? '已唤起系统保存' : '已触发下载',
          detail: isShare
            ? `${res.name}｜在面板里选择「保存到相册」或任意应用。`
            : `${res.name}｜若相册未出现可长按大图另存。`,
          type: 'success'
        });
      }
    } catch (err) {
      console.error('[AvatarForge] 下载失败:', err);
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'FORGE // 导出失败',
          message: (err && err.message) || '影像导出失败',
          detail: '可点击展台放大后长按大图，用系统自带的保存图片。',
          type: 'warning'
        });
      }
    } finally {
      // 仅在仍有成图时恢复，避免把「无图禁用态」错误地解禁
      if (downloadBtn) downloadBtn.disabled = !currentResultSrc;
    }
  }

  // dataURL 直接存 IndexedDB 会有 33% 的 base64 膨胀，先收敛成 Blob 再落库
  async function toStorableAsset(src) {
    if (!/^(data:|blob:)/.test(src)) return src;
    try {
      const resp = await fetch(src);
      if (!resp.ok) return src;
      return await resp.blob();
    } catch (err) {
      return src;
    }
  }

  async function applyAsAvatar(src) {
    if (!src) return;
    const storable = await toStorableAsset(src);

    // 若外部调用方传入了自定义 onApply 回调（如马甲库编辑），优先走回调
    if (activeOptions && typeof activeOptions.onApply === 'function') {
      try {
        await activeOptions.onApply(storable, src);
      } catch (err) {
        console.error('AvatarForge onApply failed:', err);
      }
    } else if (window.RetroflowPersonaUI && window.RetroflowPersonaUI.setAvatar) {
      // 优先走 persona-ui 的正式入口，保证档案内部状态同步
      await window.RetroflowPersonaUI.setAvatar(storable, src);
    } else {
      // 兜底路径：只写档案头像，不碰桌面红卡（红卡是独立的 decor 域装饰位）
      await Storage.setAsset(ASSET_KEY_AVATAR, storable);
      const avatarImg = document.getElementById('personaAvatarImg');
      const avatarPlaceholder = document.getElementById('personaAvatarPlaceholder');
      const clearAvatarBtn = document.getElementById('personaClearAvatarBtn');
      if (avatarImg) {
        avatarImg.src = src;
        avatarImg.style.display = 'block';
      }
      if (avatarPlaceholder) avatarPlaceholder.style.display = 'none';
      if (clearAvatarBtn) clearAvatarBtn.classList.remove('is-idle');
    }

    if (applyBtn) {
      const span = applyBtn.querySelector('span');
      if (span) {
        const orig = span.textContent;
        span.textContent = '已设为头像';
        setTimeout(() => {
          span.textContent = orig;
          close();
        }, 600);
        return;
      }
    }
    close();
  }

  /* ---------------- 事件绑定 ---------------- */

  if (forgeBtn) forgeBtn.addEventListener('click', () => open());
  if (backBtn) backBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);

  // 点击遮罩空白处关闭
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  if (submitBtn) submitBtn.addEventListener('click', runGenerate);

  // 重填：退回输入态（若正在生成则先中止）
  function backToInput() {
    if (isGenerating && abortCtrl) {
      try { abortCtrl.abort(); } catch (e) { /* ignore */ }
      setSubmitBusy(false);
    }
    showInputView();
    if (promptInput) promptInput.focus();
  }

  if (reBtn) reBtn.addEventListener('click', backToInput);
  if (abortBtn) abortBtn.addEventListener('click', backToInput);

  // 点击展台放大（仅在有成图时）
  if (stageInner) {
    stageInner.addEventListener('click', () => {
      if (currentResultSrc) openLightbox(currentResultSrc);
    });
  }

  if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
  if (lightboxOverlay) {
    lightboxOverlay.addEventListener('click', (e) => {
      if (e.target === lightboxOverlay || e.target === lightboxImg) closeLightbox();
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => downloadImage(currentResultSrc));
  }

  if (applyBtn) {
    applyBtn.addEventListener('click', () => applyAsAvatar(currentResultSrc));
  }

  // ESC：优先关灯箱，其次关弹窗
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (lightboxOverlay && !lightboxOverlay.hidden) {
      closeLightbox();
    } else if (isOpen) {
      close();
    }
  });

  // 全局导出
  window.AvatarForge = {
    open,
    close,
    generate: runGenerate,
    openLightbox,
    buildPrompt
  };
})();
