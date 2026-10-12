/**
 * ============================================================================
 * 溯流计划 · 图库应用模块 (Gallery / Optic Archives)
 * 视图控制器：相册总览 → 相册内网格 → 全屏大图查看器
 * 数据来源：GalleryStore（生图产出在生成瞬间即归档，与是否设为头像无关）
 * 遵循《工地施工协议》：零 Emoji、纯 SVG、零分割线、全面穿透全局自定义字体
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. DOM 节点索引
  const galleryPage = document.getElementById('galleryPage');
  const galleryCloseBtn = document.getElementById('galleryCloseBtn');
  const galleryMasterView = document.getElementById('galleryMasterView');
  const galleryDetailView = document.getElementById('galleryDetailView');
  const galleryDetailBackBtn = document.getElementById('galleryDetailBackBtn');
  const gallerySegmentTabs = document.querySelectorAll('.gallery-segment-tab');
  const galleryPhotosGrid = document.getElementById('galleryPhotosGrid');
  // 最近视图：不分相册，铺最近 7 天全部图片
  const galleryRecentScroll = document.getElementById('galleryRecentScroll');
  const galleryRecentGrid = document.getElementById('galleryRecentGrid');
  const galleryAlbumsScroll = document.getElementById('galleryAlbumsScroll');
  const galleryBatchBtn = document.getElementById('galleryBatchBtn');
  const galleryDetailBatchBtn = document.getElementById('galleryDetailBatchBtn');
  const galleryTotalStatsGroup = document.getElementById('galleryTotalStatsGroup');
  const galleryTacticalLabel = document.getElementById('galleryTacticalLabel');

  // 统计与相册元信息节点
  const galleryCountRecent = document.getElementById('galleryCountRecent');
  const galleryCountAll = document.getElementById('galleryCountAll');
  const galleryCountGen = document.getElementById('galleryCountGen');
  const galleryCountCache = document.getElementById('galleryCountCache');
  const galleryTotalCount = document.getElementById('galleryTotalCount');
  const galleryTotalSize = document.getElementById('galleryTotalSize');
  const galleryTotalUnit = document.getElementById('galleryTotalUnit');
  const albumCoverImg = document.getElementById('galleryAvatarAlbumCover');
  const albumCountText = document.getElementById('galleryAvatarAlbumCountText');
  const galleryAlbumsGrid = document.getElementById('galleryAlbumsGrid');
  const galleryChatCacheEmpty = document.getElementById('galleryChatCacheEmpty');
  const galleryDetailEn = document.getElementById('galleryDetailEn');
  const galleryDetailZh = document.getElementById('galleryDetailZh');

  // Lightbox 大图查看器节点
  const galleryLightbox = document.getElementById('galleryLightbox');
  const galleryLightboxCloseBtn = document.getElementById('galleryLightboxCloseBtn');
  const galleryLightboxStage = document.getElementById('galleryLightboxStage');
  const galleryLightboxTrack = document.getElementById('galleryLightboxTrack');
  const galleryLightboxImgPrev = document.getElementById('galleryLightboxImgPrev');
  const galleryLightboxImgCurr = document.getElementById('galleryLightboxImgCurr');
  const galleryLightboxImgNext = document.getElementById('galleryLightboxImgNext');
  const galleryLightboxCounter = document.getElementById('galleryLightboxCounter');
  const galleryLightboxTime = document.getElementById('galleryLightboxTime');
  const galleryLightboxTag = document.getElementById('galleryLightboxTag');
  const gallerySetCoverBtn = document.getElementById('gallerySetCoverBtn');
  const galleryLightboxMenuBtn = document.getElementById('galleryLightboxMenuBtn');
  const galleryLightboxMenu = document.getElementById('galleryLightboxMenu');
  const galleryDownloadBtn = document.getElementById('galleryDownloadBtn');

  // 2. 运行时状态
  let photoList = [];
  let allPhotoList = [];
  let activeAlbumId = 'image_gen';
  let currentActiveIndex = 0;
  let isBatchMode = false;
  const selectedPhotoIds = new Set();
  // 所有由 getAssetSrc 生成的 objectURL，统一登记便于释放，避免内存泄漏
  const liveObjectUrls = new Set();
  // 标记「本次 history.back() 是我们主动触发的」，避免 popstate 重复处理
  let pendingGalleryBack = false;

  // 3. 大图手势滑动状态（三图轨道方案）
  let touchStartX = 0;
  let touchStartY = 0;
  let touchCurrentX = 0;
  let touchStartTime = 0;
  let isSwiping = false;
  let isDirectionLocked = false;
  let isHorizontal = false;
  let isTransitioning = false;
  let cellWidth = 0;

  /* ---------------- 资源 URL 管理 ---------------- */

  function trackUrl(url) {
    if (typeof url === 'string' && url.startsWith('blob:')) {
      liveObjectUrls.add(url);
    }
    return url;
  }

  function releaseAllUrls() {
    liveObjectUrls.forEach((url) => {
      try { Storage.revokeAssetSrc(url); } catch (e) { /* ignore */ }
    });
    liveObjectUrls.clear();
  }

  /* ---------------- 数据装载 ---------------- */

  async function reloadData() {
    // 先释放上一轮的 objectURL，避免反复打开图库累积泄漏
    releaseAllUrls();

    if (!window.GalleryStore) {
      photoList = [];
      return;
    }
    // 与 IndexedDB 对账，清掉索引里的孤儿条目
    try { await GalleryStore.reconcile(); } catch (e) { /* ignore */ }

    allPhotoList = GalleryStore.list();

    for (const photo of allPhotoList) {
      const src = await Storage.getAssetSrc(photo.key);
      photo.src = src ? trackUrl(src) : null;
    }
    photoList = allPhotoList.slice();
  }

  function renderStats() {
    const stats = window.GalleryStore
      ? GalleryStore.getStats()
      : { count: 0, sizeValue: '0', sizeUnit: 'B' };
    const countText = String(stats.count);

    if (galleryCountAll) galleryCountAll.textContent = countText;
    const imageGenCount = allPhotoList.filter(p => p.category === 'image-gen').length;
    const chatCacheCount = allPhotoList.filter(p => p.category === 'chat-cache').length;
    if (galleryCountGen) galleryCountGen.textContent = String(imageGenCount);
    if (galleryCountCache) galleryCountCache.textContent = String(chatCacheCount);
    if (galleryTotalCount) galleryTotalCount.textContent = countText;
    if (galleryTotalSize) galleryTotalSize.textContent = stats.sizeValue;
    if (galleryTotalUnit) galleryTotalUnit.textContent = stats.sizeUnit;
    if (albumCountText) albumCountText.textContent = `${imageGenCount} 张`;
  }

  /* ---------------- 相册筛选 ---------------- */

  // 相册定义：
  //  - image_gen     图像生成：无归属的散图（绘像工坊及未来独立生图入口的产出）
  //  - genfork:<id>  副本快照：image-gen 分类下按副本（ownerType === 'fork'）动态成册
  //  - chat:<id>     对话缓存：按对话对象（ownerId）动态成册，卡片在有图时才渲染，无图不占位
  const AVATAR_FORGE_ALBUM_ID = 'image_gen';

  /** 图像生成相册：仅无归属的散图（副本快照归各自副本册，不在此混排） */
  function filterImageGen(list) {
    return list.filter(p => p.category === 'image-gen' && !(p.ownerType === 'fork' && p.ownerId));
  }

  /** 副本快照：按 ownerId 归拢，返回 [{ ownerId, ownerName, photos }]，photos 已按时间倒序 */
  function groupForkGenByOwner(list) {
    const buckets = new Map();
    list.forEach((p) => {
      if (p.category !== 'image-gen' || p.ownerType !== 'fork' || !p.ownerId) return;
      if (!buckets.has(p.ownerId)) {
        buckets.set(p.ownerId, {
          ownerId: p.ownerId,
          ownerName: p.ownerName || '副本快照',
          photos: []
        });
      }
      buckets.get(p.ownerId).photos.push(p);
    });
    // 按最新一张时间倒序
    return Array.from(buckets.values()).sort((a, b) => {
      const at = (a.photos[0] && a.photos[0].createdAt) || 0;
      const bt = (b.photos[0] && b.photos[0].createdAt) || 0;
      return bt - at;
    });
  }

  /** 对话缓存：按 ownerId 归拢，返回 [{ ownerId, ownerType, ownerName, photos }]，photos 已按时间倒序 */
  function groupChatCacheByOwner(list) {
    const buckets = new Map();
    list.forEach((p) => {
      if (p.category !== 'chat-cache') return;
      const ownerId = p.ownerId || (window.GalleryStore && GalleryStore.SYSTEM_ASSISTANT_OWNER_ID) || 'system';
      if (!buckets.has(ownerId)) {
        buckets.set(ownerId, {
          ownerId,
          ownerType: p.ownerType || 'assistant',
          ownerName: p.ownerName || '系统助手',
          photos: []
        });
      }
      buckets.get(ownerId).photos.push(p);
    });
    // 系统助手固定排最前，其余按最新一张时间倒序
    const sysId = (window.GalleryStore && GalleryStore.SYSTEM_ASSISTANT_OWNER_ID) || 'system';
    return Array.from(buckets.values()).sort((a, b) => {
      if (a.ownerId === sysId) return -1;
      if (b.ownerId === sysId) return 1;
      const at = (a.photos[0] && a.photos[0].createdAt) || 0;
      const bt = (b.photos[0] && b.photos[0].createdAt) || 0;
      return bt - at;
    });
  }

  /** 按相册 id 取图：image_gen 走无归属散图，genfork:<ownerId> 走副本快照册，chat:<ownerId> 走对话缓存对应对象 */
  function filterByAlbum(list, albumId) {
    if (albumId === AVATAR_FORGE_ALBUM_ID) return filterImageGen(list);
    if (albumId && albumId.indexOf('genfork:') === 0) {
      const ownerId = albumId.slice('genfork:'.length);
      return list.filter(p => p.category === 'image-gen' && p.ownerType === 'fork' && p.ownerId === ownerId);
    }
    if (albumId && albumId.indexOf('chat:') === 0) {
      const ownerId = albumId.slice('chat:'.length);
      return list.filter(p => p.category === 'chat-cache' && (p.ownerId || 'system') === ownerId);
    }
    // 兜底：图像生成
    return filterImageGen(list);
  }

  /* ---------------- 相册卡片（封面 = 最新一张） ---------------- */

  /** 转义，动态卡片文本安全注入 */
  const HTML_ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '\u0022': '&' + 'quot;',
    '\u0027': '&#39;'
  };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>\u0022\u0027]/g, (c) => HTML_ESCAPE_MAP[c]);
  }

  /** 构建一张对话缓存相册卡片（对话对象维度） */
  function buildChatAlbumCard(bucket) {
    const first = bucket.photos.find((p) => p.src);
    const btn = document.createElement('button');
    btn.className = 'gallery-album-card';
    btn.type = 'button';
    btn.dataset.albumId = `chat:${bucket.ownerId}`;
    btn.dataset.category = 'chat-cache';
    if (bucket.photos.length === 0) btn.classList.add('is-empty');

    const coverHtml = first
      ? `<img class="gallery-album-cover-img" src="${escapeHtml(first.src)}" alt="${escapeHtml(bucket.ownerName)}对话相册封面">`
      : `<div class="gallery-album-cover-empty" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-2 0H5V5h14v14zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H6l2.5-4.5z"/></svg></div>`;

    // 系统助手用系统徽标，副本推演用世界线徽标，其余对话对象用人物徽标
    const sysId = (window.GalleryStore && GalleryStore.SYSTEM_ASSISTANT_OWNER_ID) || 'system';
    const isSystem = bucket.ownerId === sysId;
    const isFork = bucket.ownerType === 'fork';
    let badgeSvg;
    let badgeText;
    let enText;
    if (isFork) {
      // 世界线下潜标识：同心轨道 + 中央坐标点，纯矢量机能风
      badgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 2a8 8 0 016.32 12.91A8 8 0 1112 4zm0 3a5 5 0 100 10 5 5 0 000-10zm0 3.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>`;
      badgeText = 'DIVE';
      enText = 'WORLDLINE DIVE';
    } else if (isSystem) {
      badgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9z"/></svg>`;
      badgeText = 'SYS';
      enText = 'SYSTEM ASSISTANT';
    } else {
      badgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
      badgeText = 'CHAR';
      enText = 'CHARACTER CHAT';
    }

    btn.innerHTML = `
      <div class="gallery-album-frame">
        <div class="gallery-album-cover-box">${coverHtml}</div>
        <div class="gallery-album-badge">${badgeSvg}<span>${badgeText}</span></div>
      </div>
      <div class="gallery-album-meta">
        <div class="gallery-album-zh">${escapeHtml(bucket.ownerName)}</div>
        <div class="gallery-album-sub">
          <span class="gallery-album-en">${enText}</span>
          <span class="gallery-album-slash">//</span>
          <span class="gallery-album-desc">${bucket.photos.length} 张</span>
        </div>
      </div>`;

    btn.addEventListener('click', () => showDetailView(`chat:${bucket.ownerId}`, bucket.ownerName));
    return btn;
  }

  /** 构建一张副本快照相册卡片（副本维度，image-gen 分类下按副本成册） */
  function buildForkGenAlbumCard(bucket) {
    const first = bucket.photos.find((p) => p.src);
    const btn = document.createElement('button');
    btn.className = 'gallery-album-card';
    btn.type = 'button';
    btn.dataset.albumId = `genfork:${bucket.ownerId}`;
    btn.dataset.category = 'image-gen-fork';
    if (bucket.photos.length === 0) btn.classList.add('is-empty');

    const coverHtml = first
      ? `<img class="gallery-album-cover-img" src="${escapeHtml(first.src)}" alt="${escapeHtml(bucket.ownerName)}副本快照封面">`
      : `<div class="gallery-album-cover-empty" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-2 0H5V5h14v14zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H6l2.5-4.5z"/></svg></div>`;

    // 战术相机徽标：取景框四角标 + 中央镜头圆点，与 DECK 相机舱同语言
    const badgeSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h6v2H5v4H3V3zm12 0h6v6h-2V5h-4V3zM3 15h2v4h4v2H3v-6zm16 0h2v6h-6v-2h4v-4zm-7-4.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z"/></svg>`;

    btn.innerHTML = `
      <div class="gallery-album-frame">
        <div class="gallery-album-cover-box">${coverHtml}</div>
        <div class="gallery-album-badge">${badgeSvg}<span>CAM</span></div>
      </div>
      <div class="gallery-album-meta">
        <div class="gallery-album-zh">${escapeHtml(bucket.ownerName)}</div>
        <div class="gallery-album-sub">
          <span class="gallery-album-en">DIVE CAM</span>
          <span class="gallery-album-slash">//</span>
          <span class="gallery-album-desc">${bucket.photos.length} 张</span>
        </div>
      </div>`;

    btn.addEventListener('click', () => showDetailView(`genfork:${bucket.ownerId}`, bucket.ownerName));
    return btn;
  }

  /** 渲染相册总览：图像生成卡（静态）+ 副本快照卡（按副本动态）+ 对话缓存卡（按对话对象动态） */
  function renderAlbumCover() {
    // 图像生成相册（静态卡片，只更新封面/计数）
    const imageGenCard = document.querySelector('.gallery-album-card[data-album-id="image_gen"]');
    const imageGen = filterImageGen(allPhotoList);
    const first = imageGen.find((p) => p.src);
    if (albumCoverImg) {
      if (first) {
        albumCoverImg.src = first.src;
        albumCoverImg.hidden = false;
      } else {
        albumCoverImg.src = '';
        albumCoverImg.removeAttribute('src');
        albumCoverImg.hidden = true;
      }
    }
    const coverEmpty = imageGenCard ? imageGenCard.querySelector('.gallery-album-cover-empty') : null;
    if (coverEmpty) coverEmpty.hidden = !!first;
    if (imageGenCard) imageGenCard.classList.toggle('is-empty', imageGen.length === 0);
    if (albumCountText) albumCountText.textContent = `${imageGen.length} 张`;

    // 对话缓存相册：清掉旧动态卡片，按对话对象重建；无任何对话产图时不渲染卡片
    if (galleryAlbumsGrid) {
      galleryAlbumsGrid.querySelectorAll('.gallery-album-card[data-category="chat-cache"]')
        .forEach((el) => el.remove());
      const buckets = groupChatCacheByOwner(allPhotoList);
      buckets.forEach((bucket) => {
        galleryAlbumsGrid.appendChild(buildChatAlbumCard(bucket));
      });

      // 副本快照相册：image-gen 分类下按副本动态成册，插在对话缓存卡之前
      galleryAlbumsGrid.querySelectorAll('.gallery-album-card[data-category="image-gen-fork"]')
        .forEach((el) => el.remove());
      const forkBuckets = groupForkGenByOwner(allPhotoList);
      const chatFirstCard = galleryAlbumsGrid.querySelector('.gallery-album-card[data-category="chat-cache"]');
      forkBuckets.forEach((bucket) => {
        const card = buildForkGenAlbumCard(bucket);
        if (chatFirstCard) {
          galleryAlbumsGrid.insertBefore(card, chatFirstCard);
        } else {
          galleryAlbumsGrid.appendChild(card);
        }
      });
    }
  }

  /* ---------------- 照片网格单元 ---------------- */

  // 最近视图时间窗：7 天
  const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * 构建一个照片网格单元
   * @param {object} photo 照片条目
   * @param {number} realIndex 该图在 photoList 里的真实索引（供 lightbox 连续翻页）
   */
  function buildPhotoItem(photo, realIndex) {
    const item = document.createElement('div');
    item.className = 'gallery-photo-item';
    item.dataset.photoId = photo.id;
    if (selectedPhotoIds.has(photo.id)) item.classList.add('is-selected');

    const img = document.createElement('img');
    img.className = 'gallery-photo-thumb';
    img.loading = 'lazy';
    img.alt = `${photo.sourceZh} ${photo.timeText}`;
    if (photo.src) img.src = photo.src;
    item.appendChild(img);

    const tag = document.createElement('span');
    tag.className = 'gallery-photo-tag';
    tag.textContent = photo.dateShort;
    item.appendChild(tag);

    const checkbox = document.createElement('div');
    checkbox.className = 'gallery-photo-checkbox';
    checkbox.setAttribute('aria-hidden', 'true');
    checkbox.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
    item.appendChild(checkbox);

    item.addEventListener('click', () => {
      if (isBatchMode) {
        toggleSelectPhoto(photo.id, item);
      } else {
        openLightbox(realIndex);
      }
    });

    return item;
  }

  /* ---------------- 相册内 3 列网格 ---------------- */

  function renderPhotoGrid() {
    if (!galleryPhotosGrid) return;
    galleryPhotosGrid.innerHTML = '';

    if (photoList.length === 0) {
      galleryPhotosGrid.classList.add('is-empty');
      galleryPhotosGrid.appendChild(buildEmptyState());
      return;
    }
    galleryPhotosGrid.classList.remove('is-empty');

    photoList.forEach((photo, idx) => {
      galleryPhotosGrid.appendChild(buildPhotoItem(photo, idx));
    });
  }

  /* ---------------- 最近视图（不分相册，最近 7 天，从近到远） ---------------- */

  function renderRecentGrid() {
    if (!galleryRecentGrid) return;
    galleryRecentGrid.innerHTML = '';

    // photoList 已按 createdAt 倒序，最近 7 天的正好是其前缀
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    let recentCount = 0;

    photoList.forEach((photo, idx) => {
      if ((photo.createdAt || 0) < cutoff) return;
      // 用真实索引，保证大图翻页在完整列表里连续
      galleryRecentGrid.appendChild(buildPhotoItem(photo, idx));
      recentCount += 1;
    });

    if (galleryCountRecent) galleryCountRecent.textContent = String(recentCount);

    if (recentCount === 0) {
      galleryRecentGrid.classList.add('is-empty');
      galleryRecentGrid.appendChild(buildEmptyState());
    } else {
      galleryRecentGrid.classList.remove('is-empty');
    }
  }

  /**
   * 应用分段筛选：最近视图与相册视图互斥
   * @param {string} filter recent / all / generated / cached
   */
  function applySegmentFilter(filter) {
    const isRecent = filter === 'recent';
    // 总量统计只属于「全部」相册卡片视图
    if (galleryTotalStatsGroup) galleryTotalStatsGroup.hidden = filter !== 'all';
    // 战术标签仅在「最近」单视图中与批量按钮搭配显示；在相册卡片列表页（全部/生成/缓存）保持极简
    if (galleryTacticalLabel) galleryTacticalLabel.hidden = filter !== 'recent';

    // 批量管理只在单图平铺列表（最近 / 相册内详情）生效，在相册卡片入口列表页隐藏
    if (galleryBatchBtn) galleryBatchBtn.hidden = !isRecent;

    if (galleryRecentScroll) galleryRecentScroll.hidden = !isRecent;
    if (galleryAlbumsScroll) galleryAlbumsScroll.hidden = isRecent;

    if (isRecent) {
      renderRecentGrid();
      return;
    }

    // 相册视图：按分类筛选相册卡片
    // 副本快照册标记为 image-gen-fork（建卡/重建时精准删旧卡用），
    // 但它归属「图像生成」Tab，筛选时需一并放行
    let visibleCards = 0;
    document.querySelectorAll('.gallery-album-card').forEach((card) => {
      const match = filter === 'all'
        || card.dataset.category === filter
        || (filter === 'image-gen' && card.dataset.category === 'image-gen-fork');
      card.style.display = match ? 'flex' : 'none';
      if (match) visibleCards += 1;
    });

    // 对话缓存分类下无任何相册（无对话产图）时，呈现空态占位而非空白页
    if (galleryChatCacheEmpty) {
      galleryChatCacheEmpty.hidden = !(filter === 'chat-cache' && visibleCards === 0);
    }
  }

  /** 空态占位：纯 SVG 光学回环标识 + 机能缺省文案，零 Emoji */
  function buildEmptyState() {
    const box = document.createElement('div');
    box.className = 'gallery-empty-state';
    box.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zm-2 0H5V5h14v14zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H6l2.5-4.5z"/>
      </svg>
      <div class="gallery-empty-title">尚无归档影像</div>
      <div class="gallery-empty-desc">NO OPTIC RECORD // 生成头像后将自动归档至此</div>
    `;
    return box;
  }

  /* ---------------- 打开与关闭图库 ---------------- */

  /**
   * 激活指定分段 tab（同步高亮态并应用筛选）
   * @param {string} filter recent / all / generated / cached
   */
  function activateSegment(filter) {
    gallerySegmentTabs.forEach((t) => {
      const on = t.dataset.filter === filter;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    applySegmentFilter(filter);
  }

  /** 取当前激活的分段 filter，默认 recent */
  function getActiveSegment() {
    const active = Array.prototype.find.call(
      gallerySegmentTabs,
      (t) => t.classList.contains('is-active')
    );
    return active ? active.dataset.filter : 'recent';
  }

  async function openGallery() {
    if (!galleryPage) return;
    galleryPage.setAttribute('aria-hidden', 'false');
    galleryPage.classList.add('active');
    document.body.classList.add('page-active');

    // 压入历史栈，让系统手势返回 / 物理返回键可以逐级退出
    try {
      history.pushState({ rfPage: 'gallery' }, '', '#gallery');
    } catch (e) {
      /* ignore */
    }

    await reloadData();
    renderStats();
    renderAlbumCover();
    renderPhotoGrid();
    // 默认落到「最近」视图
    activateSegment('recent');
    showMasterView();
  }

  /** 仅收起 UI，不触碰 history（供 popstate 复用） */
  function dismissGalleryUI() {
    if (!galleryPage) return;
    galleryPage.setAttribute('aria-hidden', 'true');
    galleryPage.classList.remove('active');
    document.body.classList.remove('page-active');
    closeLightbox();
    exitBatchMode();
  }

  /**
   * 内层（大图 / 相册内）被手势退回后，历史条目已被系统消耗掉。
   * 这里补回一条，保证下一次手势返回仍有栈可退，而不会直接跳出整个应用。
   */
  function restoreGalleryHistoryEntry() {
    try {
      history.pushState({ rfPage: 'gallery' }, '', '#gallery');
    } catch (e) {
      /* ignore */
    }
  }

  function closeGallery() {
    if (!galleryPage || !galleryPage.classList.contains('active')) return;
    dismissGalleryUI();

    // 主动关闭时消掉自己压入的历史条目
    if ((window.location.hash || '') === '#gallery') {
      pendingGalleryBack = true;
      try {
        history.back();
      } catch (e) {
        pendingGalleryBack = false;
      }
    }
  }

  /* ---------------- 层级视图切换 ---------------- */

  function showMasterView() {
    if (galleryMasterView) galleryMasterView.classList.remove('is-pushed');
    if (galleryDetailView) {
      galleryDetailView.classList.remove('is-active');
      galleryDetailView.setAttribute('aria-hidden', 'true');
    }
    exitBatchMode();
  }

  function showDetailView(albumId, titleZh) {
    activeAlbumId = albumId || AVATAR_FORGE_ALBUM_ID;
    photoList = filterByAlbum(allPhotoList, activeAlbumId);
    // 详情顶栏标题：图像生成走固定文案，副本快照走副本名，对话缓存走对话对象名
    const isChat = activeAlbumId.indexOf('chat:') === 0;
    const isForkGen = activeAlbumId.indexOf('genfork:') === 0;
    if (galleryDetailZh) {
      galleryDetailZh.textContent = isChat ? (titleZh || '对话影像')
        : isForkGen ? (titleZh || '副本快照')
        : '图像生成';
    }
    if (galleryDetailEn) {
      galleryDetailEn.textContent = isChat ? 'CHAT MEDIA'
        : isForkGen ? 'DIVE CAM'
        : 'IMAGE GEN';
    }
    if (galleryMasterView) galleryMasterView.classList.add('is-pushed');
    if (galleryDetailView) {
      galleryDetailView.classList.add('is-active');
      galleryDetailView.setAttribute('aria-hidden', 'false');
    }
    renderPhotoGrid();
  }

  /* ---------------- Lightbox 大图查看器 ---------------- */

  function renderLightboxMeta() {
    const photo = photoList[currentActiveIndex];
    if (!photo) return;

    if (galleryLightboxCounter) {
      galleryLightboxCounter.textContent =
        `${String(currentActiveIndex + 1).padStart(2, '0')} / ${String(photoList.length).padStart(2, '0')}`;
    }
    if (galleryLightboxTime) galleryLightboxTime.textContent = photo.timeText;
    if (galleryLightboxTag) galleryLightboxTag.textContent = `${photo.sourceEn} · ${photo.sizeText}`;
  }

  /** 给单个槽位绑定图源；无对应图（越界）则清空并隐藏 */
  function setSlotImage(imgEl, photo) {
    if (!imgEl) return;
    if (photo && photo.src) {
      imgEl.src = photo.src;
      imgEl.hidden = false;
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
    }
  }

  /**
   * 把图库条目的 Blob 读成 dataURL，并缓存在 photo.dataUrl 上。
   *
   * 为什么必须这么做：Android WebView 对 blob: 协议的图片既不给「保存图片」
   * 长按菜单项，也无法通过 <a download> 落盘（长按只会剩分享/复制/查看）。
   * dataURL 才会被当成真实图片数据，长按菜单里才有保存项。
   * 缩略图网格仍用 blob: URL（省内存），只有大图与下载走 dataURL。
   */
  async function ensurePhotoDataUrl(photo) {
    if (!photo) return null;
    if (photo.dataUrl) return photo.dataUrl;
    try {
      const raw = await Storage.getAssetRaw(photo.key);
      if (!raw) return null;
      // 已经是外链/dataURL 字符串的直接用
      if (raw.type === 'url' && typeof raw.data === 'string') {
        photo.dataUrl = raw.data;
        return photo.dataUrl;
      }
      if (!(raw.data instanceof Blob)) return null;
      photo.dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('影像读取失败'));
        reader.readAsDataURL(raw.data);
      });
      return photo.dataUrl;
    } catch (e) {
      console.warn('[Gallery] dataURL 转换失败：', e);
      return null;
    }
  }

  /**
   * 把当前大图升级成 dataURL 版本，让系统长按菜单出现「保存图片」。
   * 先用 blob: 立刻显示（不等 IO，翻页手感不受影响），转换完成后再无感替换。
   * 期间若用户已翻到别的图，则丢弃这次结果，避免图错位。
   */
  async function upgradeCurrentSlotForSaving() {
    const photo = photoList[currentActiveIndex];
    if (!photo || !galleryLightboxImgCurr) return;
    const indexAtStart = currentActiveIndex;
    const dataUrl = await ensurePhotoDataUrl(photo);
    if (!dataUrl) return;
    if (indexAtStart !== currentActiveIndex) return;
    if (!galleryLightbox || !galleryLightbox.classList.contains('is-active')) return;
    galleryLightboxImgCurr.src = dataUrl;
  }

  /** 按 currentActiveIndex 填充三格窗口：[上一张, 当前, 下一张] */
  function fillTrack() {
    setSlotImage(galleryLightboxImgPrev, photoList[currentActiveIndex - 1]);
    setSlotImage(galleryLightboxImgCurr, photoList[currentActiveIndex]);
    setSlotImage(galleryLightboxImgNext, photoList[currentActiveIndex + 1]);
    // 当前图异步换成 dataURL，让长按能出现系统「保存图片」
    upgradeCurrentSlotForSaving();
  }

  /** 量一格宽度（含 padding，即舞台可视宽） */
  function measureCell() {
    if (galleryLightboxStage) {
      cellWidth = galleryLightboxStage.clientWidth || cellWidth;
    }
  }

  /**
   * 设置轨道横向偏移
   * @param {number} px 像素偏移
   * @param {boolean} animated 是否带缓动
   */
  function setTrackOffset(px, animated) {
    if (!galleryLightboxTrack) return;
    if (animated) {
      // 从跟手态（transition:none）切回动画态时，先移除拖拽类并强制 reflow
      // 提交当前位置，再改 transform，否则同帧内 none→有值不会触发过渡
      galleryLightboxTrack.classList.remove('is-dragging');
      void galleryLightboxTrack.offsetWidth;
    } else {
      galleryLightboxTrack.classList.add('is-dragging');
    }
    galleryLightboxTrack.style.transform = `translate3d(${px}px, 0, 0)`;
  }

  /** 无动画归位到基准位（当前图居中，即偏移 -1 格） */
  function snapTrackToBase() {
    measureCell();
    setTrackOffset(-cellWidth, false);
  }

  function openLightbox(index) {
    if (!galleryLightbox || !galleryLightboxTrack) return;
    if (photoList.length === 0) return;

    currentActiveIndex = Math.max(0, Math.min(index, photoList.length - 1));
    const photo = photoList[currentActiveIndex];
    if (!photo) return;

    fillTrack();
    renderLightboxMeta();

    galleryLightbox.setAttribute('aria-hidden', 'false');
    galleryLightbox.hidden = false;
    galleryLightbox.classList.add('is-active');

    // 开窗后布局稳定，再量宽归位（两帧确保拿到非零 clientWidth）
    snapTrackToBase();
    requestAnimationFrame(() => {
      requestAnimationFrame(snapTrackToBase);
    });
  }

  function closeLightbox() {
    if (!galleryLightbox) return;
    galleryLightbox.setAttribute('aria-hidden', 'true');
    galleryLightbox.classList.remove('is-active');
    closeLightboxMenu();
    // 关闭后从渲染/命中树移除，避免 Android WebView 让 fixed + backdrop-filter 层继续拦截图库点击
    galleryLightbox.hidden = true;
    isSwiping = false;
    isTransitioning = false;
  }

  /**
   * 翻页切换大图：先把轨道动画滑到目标格，
   * 动画结束后重排窗口、无动画归位到基准位。
   * @param {number} targetIndex 目标索引
   * @param {'next'|'prev'} direction 滑动方向
   */
  function navigateLightbox(targetIndex, direction) {
    if (isTransitioning) return;
    measureCell();

    // 越界：回弹到基准位
    if (targetIndex < 0 || targetIndex >= photoList.length || targetIndex === currentActiveIndex) {
      setTrackOffset(-cellWidth, true);
      return;
    }

    isTransitioning = true;
    // next: 轨道再左移一格到 -2；prev: 右移到 0
    const targetOffset = direction === 'next' ? -cellWidth * 2 : 0;
    setTrackOffset(targetOffset, true);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      galleryLightboxTrack.removeEventListener('transitionend', onEnd);

      currentActiveIndex = targetIndex;
      fillTrack();
      renderLightboxMeta();
      snapTrackToBase();
      isTransitioning = false;
    };
    const onEnd = (e) => {
      if (e.target === galleryLightboxTrack && e.propertyName === 'transform') finish();
    };
    galleryLightboxTrack.addEventListener('transitionend', onEnd);
    // 兜底：transitionend 未触发时按时长强制收尾
    setTimeout(finish, 380);
  }

  function showNextPhoto() {
    navigateLightbox(currentActiveIndex + 1, 'next');
  }

  function showPrevPhoto() {
    navigateLightbox(currentActiveIndex - 1, 'prev');
  }

  /* ---------------- 手势滑动触摸控制 ---------------- */

  function handleTouchStart(e) {
    if (!galleryLightbox || !galleryLightbox.classList.contains('is-active')) return;
    if (isTransitioning || photoList.length <= 1) return;

    measureCell();
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    touchCurrentX = touch.clientX;
    touchStartTime = Date.now();
    isSwiping = true;
    isDirectionLocked = false;
    isHorizontal = false;
  }

  function handleTouchMove(e) {
    if (!isSwiping || isTransitioning) return;

    const touch = e.touches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;

    if (!isDirectionLocked) {
      // 移动超过 6px 时锁定滑动主方向
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        isDirectionLocked = true;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
      }
    }

    if (isHorizontal) {
      // 水平方向：阻断页面纵向原生滚动，整条轨道跟手位移
      e.preventDefault();
      touchCurrentX = touch.clientX;

      // 边界橡皮筋阻尼（首张向右拉 / 末张向左拉，阻尼 0.32）
      let renderDx = dx;
      const isAtFirst = currentActiveIndex === 0 && dx > 0;
      const isAtLast = currentActiveIndex === photoList.length - 1 && dx < 0;
      if (isAtFirst || isAtLast) {
        renderDx = dx * 0.32;
      }

      setTrackOffset(-cellWidth + renderDx, false);
    }
  }

  function handleTouchEnd() {
    if (!isSwiping) return;
    isSwiping = false;

    if (!isHorizontal || isTransitioning) return;

    const dx = touchCurrentX - touchStartX;
    const dt = Math.max(1, Date.now() - touchStartTime);
    const velocity = Math.abs(dx) / dt; // px/ms

    // 翻页判定阈值：位移 > 1/4 格宽 或 快速轻扫 (速度 > 0.35 且 位移 > 20px)
    const isQuickFlick = velocity > 0.35 && Math.abs(dx) > 20;
    const isDragPass = Math.abs(dx) > cellWidth * 0.25;

    if (isQuickFlick || isDragPass) {
      if (dx < 0) {
        showNextPhoto(); // 向左滑 -> 下一张
      } else {
        showPrevPhoto(); // 向右滑 -> 上一张
      }
    } else {
      // 未达阈值，平滑回弹到基准位
      setTrackOffset(-cellWidth, true);
    }
  }

  /* ---------------- 批量管理 ---------------- */

  function toggleBatchMode() {
    if (photoList.length === 0) return;
    isBatchMode = !isBatchMode;
    applyBatchModeUI();
    if (!isBatchMode) clearSelection();
  }

  function applyBatchModeUI() {
    if (galleryDetailView) galleryDetailView.classList.toggle('gallery-batch-mode', isBatchMode);
    if (galleryBatchBtn) galleryBatchBtn.classList.toggle('is-active', isBatchMode);
    if (galleryDetailBatchBtn) galleryDetailBatchBtn.classList.toggle('is-active', isBatchMode);
    updateBatchButtonLabel();
  }

  function exitBatchMode() {
    isBatchMode = false;
    if (galleryDetailView) galleryDetailView.classList.remove('gallery-batch-mode');
    if (galleryBatchBtn) galleryBatchBtn.classList.remove('is-active');
    if (galleryDetailBatchBtn) galleryDetailBatchBtn.classList.remove('is-active');
    clearSelection();
  }

  function clearSelection() {
    selectedPhotoIds.clear();
    document.querySelectorAll('.gallery-photo-item.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
    });
    updateBatchButtonLabel();
  }

  function toggleSelectPhoto(id, element) {
    if (selectedPhotoIds.has(id)) {
      selectedPhotoIds.delete(id);
      element.classList.remove('is-selected');
    } else {
      selectedPhotoIds.add(id);
      element.classList.add('is-selected');
    }
    updateBatchButtonLabel();
  }

  /** 批量态按钮文案：选中 N 张时变「删除 N」，未选变「取消」，非批量态回「批量」 */
  function updateBatchButtonLabel() {
    const n = selectedPhotoIds.size;
    [galleryBatchBtn, galleryDetailBatchBtn].forEach((btn) => {
      if (!btn) return;
      const label = btn.querySelector('.gallery-batch-text');
      if (!label) return;
      if (isBatchMode && n > 0) {
        label.textContent = `删除 ${n}`;
        btn.classList.add('is-danger');
      } else if (isBatchMode) {
        label.textContent = '取消';
        btn.classList.remove('is-danger');
      } else {
        label.textContent = '批量';
        btn.classList.remove('is-danger');
      }
    });
  }

  async function handleBatchButtonClick() {
    if (isBatchMode && selectedPhotoIds.size > 0) {
      await confirmAndDelete();
    } else {
      toggleBatchMode();
    }
  }

  /** 删除不可逆，走二次确认 */
  async function confirmAndDelete() {
    const ids = Array.from(selectedPhotoIds);
    if (ids.length === 0) return;

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        message: `确认删除 ${ids.length} 张归档影像？`,
        detail: '影像将从视界档案中永久移除，此操作不可撤销。',
        confirmText: '删除',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    const removed = await GalleryStore.remove(ids);
    selectedPhotoIds.clear();

    await reloadData();
    photoList = filterByAlbum(allPhotoList, activeAlbumId);
    renderStats();
    renderAlbumCover();
    renderPhotoGrid();
    // 刷新当前所在的分段视图（最近 / 相册）
    applySegmentFilter(getActiveSegment());

    if (photoList.length === 0) exitBatchMode();
    else applyBatchModeUI();

    if (window.RetroToast) {
      RetroToast.show({
        tag: 'OPTIC // 档案清理',
        message: `已删除 ${removed} 张影像`,
        detail: '视界档案容量统计已同步更新。',
        type: 'success'
      });
    }
  }

  /* ---------------- 设为桌面封面 ---------------- */

  async function setAsDesktopCover() {
    const photo = photoList[currentActiveIndex];
    if (!photo) return;
    try {
      // 取原始 Blob 落库，避免把 objectURL 存进去（刷新后即失效）
      const raw = await Storage.getAssetRaw(photo.key);
      const payload = raw && raw.data ? raw.data : photo.src;
      await Storage.setAsset(DataRegistry.key.galleryCover(), payload);

      const desktopCoverImg = document.getElementById('bentoGalleryCoverImg');
      const desktopPlaceholder = document.getElementById('bentoGalleryPlaceholder');
      if (desktopCoverImg && photo.src) {
        desktopCoverImg.src = photo.src;
        desktopCoverImg.hidden = false;
      }
      if (desktopPlaceholder) desktopPlaceholder.hidden = true;

      if (window.RetroToast) {
        RetroToast.show({
          tag: 'OPTIC // 封面同步',
          message: '已设为桌面图库封面',
          detail: `${photo.sourceZh} · ${photo.timeText} 已同步至随身终端相框。`,
          type: 'success'
        });
      }
    } catch (e) {
      console.error('[Gallery] 设为封面失败:', e);
    }
  }

  /* ---------------- 烤串菜单与下载 ---------------- */

  function closeLightboxMenu() {
    if (!galleryLightboxMenu) return;
    galleryLightboxMenu.hidden = true;
    if (galleryLightboxMenuBtn) galleryLightboxMenuBtn.setAttribute('aria-expanded', 'false');
  }

  function toggleLightboxMenu() {
    if (!galleryLightboxMenu) return;
    const willOpen = galleryLightboxMenu.hidden;
    galleryLightboxMenu.hidden = !willOpen;
    if (galleryLightboxMenuBtn) galleryLightboxMenuBtn.setAttribute('aria-expanded', String(willOpen));
  }

  /**
   * 下载当前大图。
   * 取原始 Blob（而非 objectURL）交给 Downloader，拿到的是入库那张原图，
   * 不经二次编码；扩展名由 Blob 的 mime 自动推断。
   */
  async function downloadCurrentPhoto() {
    const photo = photoList[currentActiveIndex];
    if (!photo) return;
    // 相册来源决定文件名里的类型标签，下载目录里能按名字自然聚拢
    const label = photo.source === 'system-chat' ? '聊天图' : '生成图';
    try {
      // 走 Downloader.saveImage 的三级降级（share → objectURL → dataURL）：
      // standalone PWA 的 WebView 对超长 dataURL 的 <a download> 不稳定。
      const payload = await ensurePhotoDataUrl(photo);
      if (!payload) throw new Error('影像缓存已释放');
      const res = await Downloader.saveImage(payload, label);
      if (window.RetroToast) {
        const isShare = res.via === 'share';
        RetroToast.show({
          tag: 'OPTIC // 导出影像',
          message: isShare ? '已唤起系统保存' : '已触发下载',
          detail: isShare
            ? `${res.name}｜在面板里选择「保存到相册」或任意应用。`
            : `${res.name}｜若相册未出现可长按大图另存。`,
          type: 'success'
        });
      }
    } catch (e) {
      console.error('[Gallery] 下载失败:', e);
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'OPTIC // 导出失败',
          message: (e && e.message) || '影像导出失败',
          detail: '可长按大图，用系统自带的保存图片。',
          type: 'warning'
        });
      }
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    if (galleryCloseBtn) galleryCloseBtn.addEventListener('click', closeGallery);
    if (galleryDetailBackBtn) galleryDetailBackBtn.addEventListener('click', showMasterView);
    if (galleryLightboxCloseBtn) galleryLightboxCloseBtn.addEventListener('click', closeLightbox);
    if (galleryBatchBtn) galleryBatchBtn.addEventListener('click', handleBatchButtonClick);
    if (galleryDetailBatchBtn) galleryDetailBatchBtn.addEventListener('click', handleBatchButtonClick);
    if (gallerySetCoverBtn) {
      gallerySetCoverBtn.addEventListener('click', async () => {
        closeLightboxMenu();
        await setAsDesktopCover();
      });
    }
    if (galleryDownloadBtn) {
      galleryDownloadBtn.addEventListener('click', async () => {
        closeLightboxMenu();
        await downloadCurrentPhoto();
      });
    }
    if (galleryLightboxMenuBtn) {
      galleryLightboxMenuBtn.addEventListener('click', (e) => {
        // 阻断冒泡，否则会被下面的「点空白关菜单」立刻收回去
        e.stopPropagation();
        toggleLightboxMenu();
      });
    }
    // 点大图或顶栏空白处收起菜单；菜单自身的点击不冒泡到这里
    if (galleryLightbox) {
      galleryLightbox.addEventListener('click', () => closeLightboxMenu());
    }
    if (galleryLightboxMenu) {
      galleryLightboxMenu.addEventListener('click', (e) => e.stopPropagation());
    }

    // 分段选择器：最近 / 全部 / 图像生成 / 图片缓存
    gallerySegmentTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        activateSegment(tab.dataset.filter);
      });
    });

    // 点击相册卡片进入详情：图像生成为静态卡，对话缓存卡片由 renderAlbumCover 动态生成并自带绑定
    const imageGenAlbumCard = document.querySelector('.gallery-album-card[data-album-id="image_gen"]');
    if (imageGenAlbumCard) {
      imageGenAlbumCard.addEventListener('click', () => showDetailView('image_gen'));
    }

    // ESC 逐级回退 / 左右方向键切图
    window.addEventListener('keydown', (e) => {
      if (galleryLightbox && galleryLightbox.classList.contains('is-active')) {
        if (e.key === 'Escape') {
          closeLightbox();
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          showNextPhoto();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          showPrevPhoto();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (galleryDetailView && galleryDetailView.classList.contains('is-active')) {
          showMasterView();
        } else if (galleryPage && galleryPage.classList.contains('active')) {
          closeGallery();
        }
      }
    });

    // 系统手势返回 / 物理返回键：大图 -> 相册内 -> 总览 -> 关闭，逐级退回
    window.addEventListener('popstate', () => {
      if (pendingGalleryBack) {
        // UI 已在点击返回时同步处理，这里只消化事件
        pendingGalleryBack = false;
        return;
      }
      if (!galleryPage || !galleryPage.classList.contains('active')) return;

      // 文本编辑器叠在本页之上时，这次返回归它处理，本页不响应
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;

      // 三级：大图查看器开着，先收大图
      if (galleryLightbox && galleryLightbox.classList.contains('is-active')) {
        closeLightbox();
        restoreGalleryHistoryEntry();
        return;
      }
      // 二级：相册内网格，退回总览
      if (galleryDetailView && galleryDetailView.classList.contains('is-active')) {
        showMasterView();
        restoreGalleryHistoryEntry();
        return;
      }
      // 一级：总览，直接收起整页（history 已被系统消掉，不再二次操作）
      dismissGalleryUI();
    });

    // 触摸手势事件绑定到大图展示舞台
    if (galleryLightboxStage) {
      galleryLightboxStage.addEventListener('touchstart', handleTouchStart, { passive: true });
      galleryLightboxStage.addEventListener('touchmove', handleTouchMove, { passive: false });
      galleryLightboxStage.addEventListener('touchend', handleTouchEnd, { passive: true });
      galleryLightboxStage.addEventListener('touchcancel', handleTouchEnd, { passive: true });
    }

    // 屏幕尺寸/旋转变化时，若大图开着则重新量宽归位，避免基准偏移错位
    window.addEventListener('resize', () => {
      if (galleryLightbox && galleryLightbox.classList.contains('is-active') && !isSwiping && !isTransitioning) {
        snapTrackToBase();
      }
    });

    window.addEventListener('pagehide', releaseAllUrls);
  }

  bindEvents();

  // 全局导出
  window.GalleryApp = {
    open: openGallery,
    close: closeGallery,
    openLightbox,
    reload: async () => {
      await reloadData();
      if (galleryDetailView && galleryDetailView.classList.contains('is-active')) {
        photoList = filterByAlbum(allPhotoList, activeAlbumId);
      }
      renderStats();
      renderAlbumCover();
      renderPhotoGrid();
      // 刷新当前所在的分段视图（最近 / 相册）
      applySegmentFilter(getActiveSegment());
    }
  };

})();