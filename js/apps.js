/**
 * 溯流计划 · 桌面应用矩阵与分页交互控制器
 * 管理多页滑动、指示器同步、Page 02 拟物黑胶、相框与磁贴路由
 */
(() => {
  // 1. 分页滑动与指示器同步
  const viewport = document.getElementById('desktopCarouselViewport');
  const indicatorDots = document.querySelectorAll('.page-indicator-dot');
  let currentPage = 0;

  function setPage(pageIndex, smooth = true) {
    if (!viewport) return;
    currentPage = pageIndex;
    const scrollWidth = viewport.clientWidth;
    viewport.scrollTo({
      left: pageIndex * scrollWidth,
      behavior: smooth ? 'smooth' : 'auto'
    });
    updateIndicator(pageIndex);
  }

  function updateIndicator(pageIndex) {
    indicatorDots.forEach((dot) => {
      const idx = parseInt(dot.dataset.page, 10);
      const isActive = idx === pageIndex;
      dot.classList.toggle('active', isActive);
      dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  if (viewport) {
    let scrollTimeout = null;
    viewport.addEventListener('scroll', () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const scrollLeft = viewport.scrollLeft;
        const width = viewport.clientWidth || 1;
        const page = Math.round(scrollLeft / width);
        if (page !== currentPage) {
          currentPage = page;
          updateIndicator(page);
        }
      }, 50);
    }, { passive: true });
  }

  indicatorDots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const idx = parseInt(dot.dataset.page, 10);
      if (!isNaN(idx)) setPage(idx, true);
    });
  });

  // 2. 磁贴路由点击分发（Page 01 与 Page 02 通用）
  function handleAppClick(appId, appName) {
    console.log(`[Retroflow] 正在进入模块：${appName} (${appId})`);
    if (appId === 'persona') {
      if (window.PersonaUI && typeof PersonaUI.open === 'function') {
        PersonaUI.open();
      }
    } else if (appId === 'forks') {
      if (window.ForkArchiveUI && typeof ForkArchiveUI.open === 'function') {
        ForkArchiveUI.open();
      }
    } else if (appId === 'resonance') {
      if (window.ResonanceUI && typeof ResonanceUI.open === 'function') {
        ResonanceUI.open();
      }
    } else if (appId === 'gallery') {
      if (window.GalleryApp && typeof GalleryApp.open === 'function') {
        GalleryApp.open();
      }
    } else {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'SYSTEM // 模块连接',
          message: `${appName || appId} 正在构筑中`,
          detail: '核心时空通道校准中，后续更新开放。',
          type: 'info'
        });
      }
    }
  }

  // 绑定所有带有 data-app 的磁贴卡片与按钮
  document.querySelectorAll('[data-app]').forEach((el) => {
    el.addEventListener('click', (e) => {
      // 如果点击的是相框内部的封面，不要触发进入图库
      if (e.target.closest('#bentoGalleryFrame')) return;
      const appId = el.dataset.app;
      const appTitle = el.querySelector('.bento-title, .p2-gallery-zh')?.textContent || appId;
      handleAppClick(appId, appTitle);
    });
  });

  // 3. Page 02 图库相框封面更换
  const galleryFrame = document.getElementById('bentoGalleryFrame');
  const galleryCoverImg = document.getElementById('bentoGalleryCoverImg');
  const galleryPlaceholder = document.getElementById('bentoGalleryPlaceholder');
  const ASSET_KEY_GALLERY_COVER = DataRegistry.key.galleryCover();
  let galleryCoverObjectUrl = null;

  function applyGalleryCover(src) {
    if (!galleryCoverImg) return;
    // 释放上一枚 objectURL，避免内存泄漏
    if (galleryCoverObjectUrl && galleryCoverObjectUrl !== src) {
      Storage.revokeAssetSrc(galleryCoverObjectUrl);
      galleryCoverObjectUrl = null;
    }
    if (typeof src === 'string' && src.startsWith('blob:')) {
      galleryCoverObjectUrl = src;
    }
    galleryCoverImg.src = src;
    galleryCoverImg.hidden = false;
    if (galleryPlaceholder) galleryPlaceholder.hidden = true;
  }

  async function loadGalleryCover() {
    try {
      const src = await Storage.getAssetSrc(ASSET_KEY_GALLERY_COVER);
      if (src) applyGalleryCover(src);
    } catch (e) {
      /* ignore */
    }
  }

  // 封面加载失败时回退到占位图，避免出现裂图
  if (galleryCoverImg) {
    galleryCoverImg.addEventListener('error', () => {
      galleryCoverImg.removeAttribute('src');
      galleryCoverImg.hidden = true;
      if (galleryPlaceholder) galleryPlaceholder.hidden = false;
    });
  }

  if (galleryFrame) {
    galleryFrame.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
      ImagePicker.open({
        title: '更换图库桌面快照封面',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            // 先用 objectURL 即时预览，再把压缩后的 Blob 固化进 IndexedDB
            applyGalleryCover(URL.createObjectURL(res.file));
            const blob = await Storage.compressImage(res.file, 1200, 0.9);
            await Storage.setAsset(ASSET_KEY_GALLERY_COVER, blob);
          } else if (res.type === 'url' && res.url) {
            applyGalleryCover(res.url);
            await Storage.setAsset(ASSET_KEY_GALLERY_COVER, res.url);
          }
        }
      });
    });
  }

  // 4. Page 02 拟物黑胶唱片机能控制
  const audioDeck = document.getElementById('bentoAudioDeck');
  const playBtn = document.getElementById('p2AudioPlayBtn');
  const loopBtn = document.getElementById('p2AudioLoopBtn');
  const playlistBtn = document.getElementById('p2AudioPlaylistBtn');
  const prevBtn = document.getElementById('p2AudioPrevBtn');
  const nextBtn = document.getElementById('p2AudioNextBtn');
  const iconPlay = playBtn ? playBtn.querySelector('.icon-play') : null;
  const iconPause = playBtn ? playBtn.querySelector('.icon-pause') : null;
  let isAudioPlaying = false;
  let isAudioLoop = false;

  if (playBtn && audioDeck) {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isAudioPlaying = !isAudioPlaying;
      audioDeck.classList.toggle('is-playing', isAudioPlaying);
      if (iconPlay) iconPlay.hidden = isAudioPlaying;
      if (iconPause) iconPause.hidden = !isAudioPlaying;

      if (window.RetroToast && isAudioPlaying) {
        RetroToast.show({
          tag: 'AUDIO // 声纹广播',
          message: '已开始播放：溯流协议 · 主题因果波',
          detail: '黑胶唱机同调运转中。',
          type: 'info'
        });
      }
    });
  }

  // 扩展按键事件绑定 (预留音乐库与模式扩展)
  if (loopBtn) {
    loopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      isAudioLoop = !isAudioLoop;
      loopBtn.classList.toggle('is-active', isAudioLoop);
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'AUDIO // 播放模式',
          message: isAudioLoop ? '单曲循环已启用' : '列表顺序播放',
          type: 'info'
        });
      }
    });
  }

  if (playlistBtn) {
    playlistBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'AUDIO // 音轨阵列',
          message: '声纹列表库构筑中',
          detail: '默认音轨：溯流协议 · 主题因果波',
          type: 'info'
        });
      }
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'AUDIO // 音轨切换',
          message: '已回退至上一因果频段',
          type: 'info'
        });
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'AUDIO // 音轨切换',
          message: '已切至下一因果频段',
          type: 'info'
        });
      }
    });
  }

  // 5. Page 02 战术便签在线编辑
  const memoCard = document.getElementById('bentoMemoCard');
  const memoContent = document.getElementById('p2MemoContent');

  function fillMemo() {
    const saved = Store.memo.content;
    if (saved && memoContent) {
      memoContent.textContent = saved;
    }
  }

  if (memoCard) {
    memoCard.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const current = memoContent ? memoContent.textContent.trim() : '';
      const updated = await TextEditorModal.edit({
        title: '随身便笺编辑',
        tag: 'MEMO // 备忘录',
        value: current,
        placeholder: '写下当前的副本观测备忘、线索或警示...',
        maxLength: 500
      });
      if (updated !== null && memoContent) {
        memoContent.textContent = updated || '// 暂无备忘事项。';
        const ok = await Store.save('memo.content', updated || '');
        if (!ok && window.RetroToast) {
          RetroToast.show({
            tag: 'STORAGE // 写入失败',
            message: '便笺保存失败',
            detail: '存储空间可能已满，内容未能固化。',
            type: 'error'
          });
        }
      }
    });
  }

  // 配置装载完成后再填充数据
  Boot.onReady('desktop', async () => {
    fillMemo();
    await loadGalleryCover();
    // 应用桌面磁贴图标美化（背景 / 图标 / 移除底座）
    if (window.ThemeEngine && typeof ThemeEngine.applyAllTiles === 'function') {
      try { await ThemeEngine.applyAllTiles(); } catch (e) { /* ignore */ }
    }
  });

  // 向注册表声明桌面装饰位在用的键
  DataRegistry.registerUsageProvider('desktop', () => [ASSET_KEY_GALLERY_COVER]);
})();
