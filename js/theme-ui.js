/**
 * 溯流计划 · 视界渲染交互层 (Theme UI Controller)
 * 1. Canvas 360° 交互色环绘制与触控拖拽
 * 2. 6 大色彩通道胶囊切换与实时预览
 * 3. 壁纸上传/URL 与字体注入交互
 */
(() => {
  const tabsWrap = document.getElementById('colorTokenTabs');
  const canvas = document.getElementById('hueWheelCanvas');
  const cursor = document.getElementById('wheelCursor');
  const core = document.getElementById('wheelCore');
  const satSlider = document.getElementById('satSlider');
  const valSlider = document.getElementById('valSlider');
  const satValue = document.getElementById('satValue');
  const valValue = document.getElementById('valValue');
  const hexInput = document.getElementById('hexInput');

  const wallpaperPreview = document.getElementById('wallpaperPreview');
  const wallpaperFileInput = document.getElementById('wallpaperFileInput');
  const wallpaperUrlInput = document.getElementById('wallpaperUrlInput');
  const wallpaperUrlConfirm = document.getElementById('wallpaperUrlConfirm');
  const wallpaperClearBtn = document.getElementById('wallpaperClearBtn');

  const fontFileInput = document.getElementById('fontFileInput');
  const fontPresetGrid = document.getElementById('fontPresetGrid');
  const fontVaultList = document.getElementById('fontVaultList');
  const fontStatusName = document.getElementById('fontStatusName');
  const fontPreviewText = document.getElementById('fontPreviewText');

  if (!canvas || !tabsWrap) return;

  let activeToken = ThemeEngine.COLOR_TOKENS[0].key;
  let hsv = { h: 0, s: 1, v: 1 };

  /* ---------------- 色环绘制 ---------------- */

  const SIZE = 260;
  const RING_OUTER = 126;
  const RING_INNER = 88;

  function drawWheel() {
    const ctx = canvas.getContext('2d');
    const cx = SIZE / 2;
    const cy = SIZE / 2;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 逐度绘制色相环扇区
    for (let deg = 0; deg < 360; deg += 1) {
      const start = ((deg - 0.6) * Math.PI) / 180;
      const end = ((deg + 0.6) * Math.PI) / 180;
      const rgb = ThemeEngine.hsvToRgb({ h: deg, s: 1, v: 1 });

      ctx.beginPath();
      ctx.arc(cx, cy, RING_OUTER, start, end, false);
      ctx.arc(cx, cy, RING_INNER, end, start, true);
      ctx.closePath();
      ctx.fillStyle = `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
      ctx.fill();
    }
  }

  /* ---------------- 光标与核心色块同步 ---------------- */

  function updateCursorPosition() {
    const rad = (hsv.h * Math.PI) / 180;
    const radius = (RING_OUTER + RING_INNER) / 2;
    const stageSize = canvas.offsetWidth || SIZE;
    const scale = stageSize / SIZE;

    const x = stageSize / 2 + Math.cos(rad) * radius * scale;
    const y = stageSize / 2 + Math.sin(rad) * radius * scale;

    cursor.style.left = `${x}px`;
    cursor.style.top = `${y}px`;

    const pureRgb = ThemeEngine.hsvToRgb({ h: hsv.h, s: 1, v: 1 });
    cursor.style.backgroundColor = `rgb(${Math.round(pureRgb.r)}, ${Math.round(pureRgb.g)}, ${Math.round(pureRgb.b)})`;
  }

  function currentHex() {
    const rgb = ThemeEngine.hsvToRgb(hsv);
    return ThemeEngine.rgbToHex(rgb.r, rgb.g, rgb.b);
  }

  function syncPreview(commit = true) {
    const hex = currentHex();
    core.style.backgroundColor = hex;
    hexInput.value = hex;
    satValue.textContent = Math.round(hsv.s * 100);
    valValue.textContent = Math.round(hsv.v * 100);
    satSlider.value = Math.round(hsv.s * 100);
    valSlider.value = Math.round(hsv.v * 100);
    updateCursorPosition();

    if (commit) {
      ThemeEngine.applyColor(activeToken, hex);
      ThemeEngine.saveColors();
      refreshTabSwatches();
      refreshPaletteCapsules();
    }
  }

  /* ---------------- 6 大通道胶囊 ---------------- */

  function buildTabs() {
    tabsWrap.innerHTML = '';
    ThemeEngine.COLOR_TOKENS.forEach((token) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-token-tab';
      btn.dataset.token = token.key;
      if (token.key === activeToken) btn.classList.add('active');

      const swatch = document.createElement('span');
      swatch.className = 'token-swatch';
      swatch.style.backgroundColor = ThemeEngine.colors[token.key];

      const label = document.createElement('span');
      label.className = 'token-label';
      label.textContent = token.label;

      btn.append(swatch, label);
      btn.addEventListener('click', () => selectToken(token.key));
      tabsWrap.appendChild(btn);
    });
  }

  function refreshTabSwatches() {
    tabsWrap.querySelectorAll('.color-token-tab').forEach((btn) => {
      const swatch = btn.querySelector('.token-swatch');
      if (swatch) swatch.style.backgroundColor = ThemeEngine.colors[btn.dataset.token];
    });
  }

  function selectToken(key) {
    activeToken = key;
    tabsWrap.querySelectorAll('.color-token-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.token === key);
    });

    const rgb = ThemeEngine.hexToRgb(ThemeEngine.colors[key]);
    if (rgb) hsv = ThemeEngine.rgbToHsv(rgb);
    syncPreview(false);
  }

  /* ---------------- 色环触控交互 ---------------- */

  let dragging = false;

  function pickHueFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    const dx = point.clientX - (rect.left + rect.width / 2);
    const dy = point.clientY - (rect.top + rect.height / 2);

    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;

    hsv.h = deg;
    syncPreview(true);
  }

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    pickHueFromEvent(e);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging) pickHueFromEvent(e);
  });

  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointercancel', () => { dragging = false; });

  /* ---------------- 滑块与 Hex 输入 ---------------- */

  satSlider.addEventListener('input', () => {
    hsv.s = Number(satSlider.value) / 100;
    syncPreview(true);
  });

  valSlider.addEventListener('input', () => {
    hsv.v = Number(valSlider.value) / 100;
    syncPreview(true);
  });

  hexInput.addEventListener('change', () => {
    const rgb = ThemeEngine.hexToRgb(hexInput.value);
    if (!rgb) {
      hexInput.value = currentHex();
      return;
    }
    hsv = ThemeEngine.rgbToHsv(rgb);
    syncPreview(true);
  });

  /* ---------------- 壁纸交互 ---------------- */

  const wallpaperOpenPickerBtn = document.getElementById('wallpaperOpenPickerBtn');
  const wallpaperMaskCheckbox = document.getElementById('wallpaperMaskCheckbox');
  const frostedGlassCheckbox = document.getElementById('frostedGlassCheckbox');

  if (wallpaperMaskCheckbox) {
    wallpaperMaskCheckbox.checked = ThemeEngine.isWallpaperMaskEnabled();
    wallpaperMaskCheckbox.addEventListener('change', () => {
      ThemeEngine.setWallpaperMaskEnabled(wallpaperMaskCheckbox.checked);
    });
  }

  if (frostedGlassCheckbox) {
    frostedGlassCheckbox.checked = ThemeEngine.isFrostedGlassEnabled();
    frostedGlassCheckbox.addEventListener('change', () => {
      ThemeEngine.setFrostedGlassEnabled(frostedGlassCheckbox.checked);
    });
  }

  function renderWallpaperPreview(src) {
    if (!wallpaperPreview) return;
    if (src) {
      wallpaperPreview.style.backgroundImage = `url("${src}")`;
      wallpaperPreview.classList.add('has-image');
    } else {
      wallpaperPreview.style.backgroundImage = '';
      wallpaperPreview.classList.remove('has-image');
    }
  }

  if (wallpaperOpenPickerBtn) {
    wallpaperOpenPickerBtn.addEventListener('click', () => {
      ImagePicker.open({
        title: '更换桌面壁纸',
        onSelect: async (res) => {
          if (res.type === 'file') {
            const tempUrl = URL.createObjectURL(res.file);
            renderWallpaperPreview(tempUrl);
            ThemeEngine.renderWallpaper(tempUrl);
            const compressed = await Storage.compressImage(res.file, 1600, 0.86);
            await ThemeEngine.setWallpaper(compressed);
          } else if (res.type === 'url') {
            renderWallpaperPreview(res.url);
            ThemeEngine.renderWallpaper(res.url);
            await ThemeEngine.setWallpaper(res.url);
          }
        }
      });
    });
  }

  if (wallpaperClearBtn) {
    wallpaperClearBtn.addEventListener('click', async () => {
      await ThemeEngine.clearWallpaper();
      renderWallpaperPreview(null);
    });
  }

  /* ---------------- 色卡胶囊交互与归档 ---------------- */

  const paletteCapsulesWrap = document.getElementById('paletteCapsules');
  const savePaletteBtn = document.getElementById('savePaletteBtn');

  // 命名弹窗 DOM
  const paletteNameModalOverlay = document.getElementById('paletteNameModalOverlay');
  const paletteModalBackBtn = document.getElementById('paletteModalBackBtn');
  const paletteModalCancelBtn = document.getElementById('paletteModalCancelBtn');
  const paletteModalConfirmBtn = document.getElementById('paletteModalConfirmBtn');
  const paletteNameInput = document.getElementById('paletteNameInput');

  function renderPaletteCapsules() {
    if (!paletteCapsulesWrap) return;
    paletteCapsulesWrap.innerHTML = '';

    const all = ThemeEngine.getAllPalettes();

    all.forEach((palette) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'palette-capsule';
      btn.dataset.paletteId = palette.id;

      const isMatch = ThemeEngine.isMatchingPalette(palette);
      if (isMatch) btn.classList.add('active');

      // 代表色：直接显示该色卡的重点色 primary-color
      const primaryHex = (palette.colors && palette.colors['primary-color']) || '#630000';
      const swatch = document.createElement('span');
      swatch.className = 'palette-swatch';
      swatch.style.backgroundColor = primaryHex;

      // 名称
      const label = document.createElement('span');
      label.className = 'palette-label';
      label.textContent = palette.name;

      btn.append(swatch, label);

      // 自定义色卡额外渲染删除叉叉按钮（100% 纯 SVG）
      if (!palette.isPreset) {
        const delBtn = document.createElement('span');
        delBtn.className = 'palette-del-btn';
        delBtn.setAttribute('role', 'button');
        delBtn.setAttribute('aria-label', `删除色卡「${palette.name}」`);
        delBtn.innerHTML = `
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        `;

        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await RetroModal.confirm({
            message: `确认删除色卡「${palette.name}」？`,
            detail: '删除后无法恢复。',
            confirmText: '确认删除',
            cancelText: '取消',
            danger: true
          });
          if (!ok) return;

          ThemeEngine.deleteCustomPalette(palette.id);
          renderPaletteCapsules();
        });

        btn.appendChild(delBtn);
      }

      // 点击色卡胶囊：平滑交叉过渡换色
      btn.addEventListener('click', () => {
        applyPaletteWithTransition(palette);
      });

      paletteCapsulesWrap.appendChild(btn);
    });
  }

  function refreshPaletteCapsules() {
    if (!paletteCapsulesWrap) return;
    const all = ThemeEngine.getAllPalettes();
    paletteCapsulesWrap.querySelectorAll('.palette-capsule').forEach((btn) => {
      const pal = all.find((p) => p.id === btn.dataset.paletteId);
      const isMatch = pal ? ThemeEngine.isMatchingPalette(pal) : false;
      btn.classList.toggle('active', isMatch);
    });
  }

  /**
   * 色卡切换平滑过渡执行器
   * 1. 优先使用浏览器原生 View Transition API（GPU 级无缝交叉溶解）
   * 2. 降级使用 CSS 动态挂载 .theme-color-transition 类，动画完成后立即卸载，保证色环 0 延迟拖拽
   */
  let transitionTimer = null;

  function applyPaletteWithTransition(palette) {
    const doApply = () => {
      ThemeEngine.applyPalette(palette);
      refreshTabSwatches();
      selectToken(activeToken);
      refreshPaletteCapsules();
    };

    if (typeof document.startViewTransition === 'function') {
      try {
        document.startViewTransition(() => {
          doApply();
        });
        return;
      } catch (_) {}
    }

    // 降级机制：挂载过渡类 -> 应用新色 -> 360ms 后清除过渡类
    const root = document.documentElement;
    if (transitionTimer) {
      clearTimeout(transitionTimer);
      transitionTimer = null;
    }

    root.classList.add('theme-color-transition');
    doApply();

    transitionTimer = setTimeout(() => {
      root.classList.remove('theme-color-transition');
      transitionTimer = null;
    }, 360);
  }

  /* ---- 色卡命名弹窗逻辑 ---- */

  function openPaletteNameModal() {
    if (!paletteNameModalOverlay) return;
    if (paletteNameInput) {
      paletteNameInput.value = '';
    }
    paletteNameModalOverlay.hidden = false;
    void paletteNameModalOverlay.offsetWidth;
    paletteNameModalOverlay.classList.add('active');
    setTimeout(() => {
      if (paletteNameInput) paletteNameInput.focus();
    }, 120);
  }

  function closePaletteNameModal() {
    if (!paletteNameModalOverlay) return;
    paletteNameModalOverlay.classList.remove('active');
    setTimeout(() => {
      if (!paletteNameModalOverlay.classList.contains('active')) {
        paletteNameModalOverlay.hidden = true;
      }
    }, 200);
  }

  function handleSaveCurrentPalette() {
    if (!paletteNameInput) return;
    const name = paletteNameInput.value.trim();
    if (!name) {
      paletteNameInput.focus();
      return;
    }

    const saved = ThemeEngine.saveCustomPalette(name);
    if (saved) {
      closePaletteNameModal();
      renderPaletteCapsules();
    }
  }

  if (savePaletteBtn) {
    savePaletteBtn.addEventListener('click', openPaletteNameModal);
  }

  if (paletteModalBackBtn) {
    paletteModalBackBtn.addEventListener('click', closePaletteNameModal);
  }

  if (paletteModalCancelBtn) {
    paletteModalCancelBtn.addEventListener('click', closePaletteNameModal);
  }

  if (paletteModalConfirmBtn) {
    paletteModalConfirmBtn.addEventListener('click', handleSaveCurrentPalette);
  }

  if (paletteNameInput) {
    paletteNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveCurrentPalette();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closePaletteNameModal();
      }
    });
  }

  if (paletteNameModalOverlay) {
    paletteNameModalOverlay.addEventListener('click', (e) => {
      if (e.target === paletteNameModalOverlay) {
        closePaletteNameModal();
      }
    });
  }

  /* ---------------- 字体库交互与渲染 ---------------- */

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // 预设字形阵列：CYBER KEYCAP 机械键帽
  // 01. ~ 06. 编号 + 所见即所得字形类名
  const PRESET_KEYCAPS = [
    { id: 'default',          index: '01.', name: '系统原生', previewClass: 'font-preview-default' },
    { id: 'preset:zhenkai',   index: '02.', name: '纸墨古卷', previewClass: 'font-preview-zhenkai' },
    { id: 'preset:chillzhuo', index: '03.', name: '随行手账', previewClass: 'font-preview-chillzhuo' },
    { id: 'preset:arkpixel',  index: '04.', name: '复古掌机', previewClass: 'font-preview-arkpixel' },
    { id: 'preset:chillduan', index: '05.', name: '执行终端', previewClass: 'font-preview-chillduan' },
    { id: 'preset:mincho',    index: '06.', name: '旧打字机', previewClass: 'font-preview-mincho' }
  ];

  function renderPresetGrid() {
    if (!fontPresetGrid) return;
    fontPresetGrid.innerHTML = '';

    const activeId = ThemeEngine.getActiveFontId();

    PRESET_KEYCAPS.forEach((cap) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `font-preset-keycap ${cap.previewClass} ${activeId === cap.id ? 'active' : ''}`;
      btn.dataset.id = cap.id;

      const name = document.createElement('span');
      name.className = 'font-keycap-name';
      name.textContent = cap.name;

      btn.append(name);
      btn.addEventListener('click', async () => {
        const target = await ThemeEngine.switchFont(cap.id);
        if (fontStatusName) fontStatusName.textContent = target.name || cap.name;
        refreshFontUI();
      });
      fontPresetGrid.appendChild(btn);
    });
  }

  // 预设胶囊与自定义卡片高亮互斥，统一刷新
  function refreshFontUI() {
    renderPresetGrid();
    renderFontVaultList();
  }

  function renderFontVaultList() {
    if (!fontVaultList) return;
    fontVaultList.innerHTML = '';

    const activeId = ThemeEngine.getActiveFontId();
    const list = ThemeEngine.getFontListMeta();

    // 自定义字体项（系统默认与预设字体已上移至胶囊阵列）
    list.forEach((font) => {
      const item = document.createElement('div');
      item.className = `font-vault-item ${activeId === font.id ? 'active' : ''}`;
      
      const sizeStr = formatFileSize(font.size);
      const desc = sizeStr ? `${sizeStr} · 已入库` : '已入库';

      item.innerHTML = `
        <div class="font-vault-item-left">
          <span class="font-active-indicator"></span>
          <div class="font-item-meta">
            <div class="font-item-title-row">
              <span class="font-item-title" title="${font.fullName || font.name}">${font.name}</span>
              <span class="font-item-format-tag">${font.type || 'FONT'}</span>
            </div>
            <span class="font-item-desc">${desc}</span>
          </div>
        </div>
        <button class="font-delete-btn" type="button" title="删除字体" data-id="${font.id}">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
          </svg>
        </button>
      `;

      // 点击卡片切换字体
      item.querySelector('.font-vault-item-left').addEventListener('click', async () => {
        const target = await ThemeEngine.switchFont(font.id);
        fontStatusName.textContent = target.name || font.name;
        refreshFontUI();
      });

      // 删除按钮
      const delBtn = item.querySelector('.font-delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        const isActive = ThemeEngine.getActiveFontId() === font.id;
        const ok = await RetroModal.confirm({
          message: `确认要移除字体「${font.name}」吗？`,
          detail: isActive
            ? '该字体正在使用中，移除后界面将立刻回退为系统默认字体。此操作无法恢复。'
            : '字体文件将从本地库中物理删除，无法恢复。',
          confirmText: '确认移除',
          cancelText: '取消',
          danger: true
        });
        if (!ok) return;

        await ThemeEngine.removeFont(font.id);
        const currentActive = await ThemeEngine.restoreActiveFont();
        fontStatusName.textContent = currentActive.name;
        refreshFontUI();
      });

      fontVaultList.appendChild(item);
    });
  }

  if (fontFileInput) {
    fontFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      fontFileInput.value = '';
      const meta = await ThemeEngine.addFont(file);
      fontStatusName.textContent = meta.name;
      refreshFontUI();
    });
  }

  /* ---------------- 图标美化工坊 ---------------- */

  const tileWorkbenchIndex = document.getElementById('tileWorkbenchIndex');
  const tileWorkbenchName = document.getElementById('tileWorkbenchName');
  const tileBgSlot = document.getElementById('tileBgSlot');
  const tileBgSlotImg = document.getElementById('tileBgSlotImg');
  const tileBgSlotEmpty = document.getElementById('tileBgSlotEmpty');
  const tileBgSlotBadge = document.getElementById('tileBgSlotBadge');
  const tileIconSlot = document.getElementById('tileIconSlot');
  const tileIconSlotImg = document.getElementById('tileIconSlotImg');
  const tileIconSlotEmpty = document.getElementById('tileIconSlotEmpty');
  const tileIconSlotLocked = document.getElementById('tileIconSlotLocked');
  const tileNoBaseRow = document.getElementById('tileNoBaseRow');
  const tileNoBaseCheckbox = document.getElementById('tileNoBaseCheckbox');
  const tileSyncAllBgBtn = document.getElementById('tileSyncAllBgBtn');
  const tileResetAllBtn = document.getElementById('tileResetAllBtn');
  const tileClearBtn = document.getElementById('tileClearBtn');
  const tilePickerGrid = document.getElementById('tilePickerGrid');
  const tileClearSheetOverlay = document.getElementById('tileClearSheetOverlay');
  const tileClearBgBtn = document.getElementById('tileClearBgBtn');
  const tileClearIconBtn = document.getElementById('tileClearIconBtn');
  const tileClearAllBtn = document.getElementById('tileClearAllBtn');
  const tileClearCancelBtn = document.getElementById('tileClearCancelBtn');

  // 占位 SVG（红卡/音乐/备忘录在列表里的缩略图）
  const TILE_PLACEHOLDER_SVG = {
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4V6h16v12zm-8-2h6v-2h-6v2zm0-4h6v-2h-6v2zm-5 4h3v-6H7v6z"/></svg>',
    music: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10.55A4 4 0 1014 17V7h4V3h-6z"/></svg>',
    memo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
  };

  let currentTileId = ThemeEngine.getTileDefs()[0] ? ThemeEngine.getTileDefs()[0].id : 'forks';
  let tileBgSlotUrl = null;
  let tileIconSlotUrl = null;

  function revokeSlotUrl(which) {
    if (which === 'bg' && tileBgSlotUrl) {
      Storage.revokeAssetSrc(tileBgSlotUrl);
      tileBgSlotUrl = null;
    } else if (which === 'icon' && tileIconSlotUrl) {
      Storage.revokeAssetSrc(tileIconSlotUrl);
      tileIconSlotUrl = null;
    }
  }

  // 取某卡片当前应显示在列表缩略图里的内容：自定义图标 img 或桌面原生 SVG 或占位
  function buildTileThumb(def) {
    const cfg = ThemeEngine.getTileConfig(def.id);
    const thumb = document.createElement('span');
    thumb.className = 'tile-picker-thumb';

    if (def.canIcon && cfg.hasIcon) {
      const img = document.createElement('img');
      img.alt = '';
      Storage.getAssetSrc(DataRegistry.key.tileIcon(def.id)).then((src) => {
        if (src) img.src = src;
      });
      thumb.appendChild(img);
      return thumb;
    }

    // 无自定义图标：优先克隆桌面原生 SVG
    let svgMarkup = '';
    if (def.iconSel) {
      const originSvg = document.querySelector(def.iconSel + ' svg');
      if (originSvg) svgMarkup = originSvg.outerHTML;
    }
    if (!svgMarkup) svgMarkup = TILE_PLACEHOLDER_SVG[def.id] || TILE_PLACEHOLDER_SVG.memo;
    thumb.innerHTML = svgMarkup;
    return thumb;
  }

  function renderTilePicker() {
    if (!tilePickerGrid) return;
    tilePickerGrid.innerHTML = '';
    ThemeEngine.getTileDefs().forEach((def) => {
      const cfg = ThemeEngine.getTileConfig(def.id);
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `tile-picker-item ${def.id === currentTileId ? 'is-active' : ''}`;
      item.dataset.tileId = def.id;

      item.appendChild(buildTileThumb(def));

      const text = document.createElement('span');
      text.className = 'tile-picker-text';
      const idx = document.createElement('span');
      idx.className = 'tile-picker-index';
      idx.textContent = def.index;
      const name = document.createElement('span');
      name.className = 'tile-picker-name';
      name.textContent = def.name;
      text.append(idx, name);
      item.appendChild(text);

      // 已定制标记点
      if (cfg.hasBg || cfg.hasIcon || cfg.noBase) {
        const dot = document.createElement('span');
        dot.className = 'tile-picker-dot';
        item.appendChild(dot);
      }

      item.addEventListener('click', () => {
        currentTileId = def.id;
        renderTilePicker();
        renderTileWorkbench();
      });

      tilePickerGrid.appendChild(item);
    });
  }

  async function renderTileWorkbench() {
    const def = ThemeEngine.getTileDef(currentTileId);
    if (!def) return;
    const cfg = ThemeEngine.getTileConfig(def.id);

    if (tileWorkbenchIndex) tileWorkbenchIndex.textContent = def.index;
    if (tileWorkbenchName) tileWorkbenchName.textContent = def.name;

    // 背景槽
    revokeSlotUrl('bg');
    const tileBgSlotLocked = document.getElementById('tileBgSlotLocked');

    if (def.canBg === false) {
      // 图库等卡片：锁定态，无背景
      if (tileBgSlot) tileBgSlot.classList.add('is-locked');
      if (tileBgSlotImg) { tileBgSlotImg.hidden = true; tileBgSlotImg.removeAttribute('src'); }
      if (tileBgSlotEmpty) tileBgSlotEmpty.hidden = true;
      if (tileBgSlotLocked) tileBgSlotLocked.hidden = false;
      if (tileBgSlotBadge) tileBgSlotBadge.hidden = true;
      if (tileSyncAllBgBtn) tileSyncAllBgBtn.disabled = true;
    } else {
      if (tileBgSlot) tileBgSlot.classList.remove('is-locked');
      if (tileBgSlotLocked) tileBgSlotLocked.hidden = true;

      if (cfg.hasBg) {
        const src = await Storage.getAssetSrc(DataRegistry.key.tileBg(def.id));
        if (src) {
          if (typeof src === 'string' && src.startsWith('blob:')) tileBgSlotUrl = src;
          if (tileBgSlotImg) { tileBgSlotImg.src = src; tileBgSlotImg.hidden = false; }
          if (tileBgSlotEmpty) tileBgSlotEmpty.hidden = true;
          if (tileBgSlotBadge) tileBgSlotBadge.hidden = false;
        }
        if (tileSyncAllBgBtn) tileSyncAllBgBtn.disabled = false;
      } else {
        if (tileBgSlotImg) { tileBgSlotImg.hidden = true; tileBgSlotImg.removeAttribute('src'); }
        if (tileBgSlotEmpty) tileBgSlotEmpty.hidden = false;
        if (tileBgSlotBadge) tileBgSlotBadge.hidden = true;
        if (tileSyncAllBgBtn) tileSyncAllBgBtn.disabled = true;
      }
    }

    // 全局移除底座开关状态回显（始终可用）
    if (tileNoBaseCheckbox) {
      tileNoBaseCheckbox.checked = ThemeEngine.isTileNoBaseGlobal();
    }
    if (tileNoBaseRow) {
      tileNoBaseRow.classList.remove('is-disabled');
    }

    // 图标槽
    revokeSlotUrl('icon');
    if (!def.canIcon) {
      // 音乐/备忘录：锁定态，无图标
      if (tileIconSlot) tileIconSlot.classList.add('is-locked');
      if (tileIconSlotImg) { tileIconSlotImg.hidden = true; tileIconSlotImg.removeAttribute('src'); }
      if (tileIconSlotEmpty) tileIconSlotEmpty.hidden = true;
      if (tileIconSlotLocked) tileIconSlotLocked.hidden = false;
    } else {
      if (tileIconSlot) tileIconSlot.classList.remove('is-locked');
      if (tileIconSlotLocked) tileIconSlotLocked.hidden = true;

      if (cfg.hasIcon) {
        const src = await Storage.getAssetSrc(DataRegistry.key.tileIcon(def.id));
        if (src) {
          if (typeof src === 'string' && src.startsWith('blob:')) tileIconSlotUrl = src;
          if (tileIconSlotImg) { tileIconSlotImg.src = src; tileIconSlotImg.hidden = false; }
          if (tileIconSlotEmpty) tileIconSlotEmpty.hidden = true;
        }
      } else {
        if (tileIconSlotImg) { tileIconSlotImg.hidden = true; tileIconSlotImg.removeAttribute('src'); }
        if (tileIconSlotEmpty) tileIconSlotEmpty.hidden = false;
      }
    }
  }

  // 背景槽点击：上传卡片背景
  if (tileBgSlot) {
    tileBgSlot.addEventListener('click', () => {
      const def = ThemeEngine.getTileDef(currentTileId);
      if (!def || def.canBg === false) return;
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
      ImagePicker.open({
        title: `更换「${def.name}」卡片背景`,
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            const blob = await Storage.compressImage(res.file, 1200, 0.88);
            await ThemeEngine.setTileBackground(def.id, blob);
          } else if (res.type === 'url' && res.url) {
            await ThemeEngine.setTileBackground(def.id, res.url);
          }
          await renderTileWorkbench();
          renderTilePicker();
        }
      });
    });
  }

  // 图标槽点击：上传图标（锁定态不响应）
  if (tileIconSlot) {
    tileIconSlot.addEventListener('click', () => {
      const def = ThemeEngine.getTileDef(currentTileId);
      if (!def || !def.canIcon) return;
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
      ImagePicker.open({
        title: `更换「${def.name}」图标（支持透明 PNG）`,
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            // 透明图（PNG/WebP）用 png 输出以保留透明通道；其余用 jpeg 压缩省空间
            const srcType = (res.file.type || '').toLowerCase();
            const keepAlpha = srcType.includes('png') || srcType.includes('webp');
            const blob = await Storage.compressImage(res.file, 512, 0.92, keepAlpha ? 'image/png' : 'image/jpeg');
            await ThemeEngine.setTileIcon(def.id, blob);
          } else if (res.type === 'url' && res.url) {
            await ThemeEngine.setTileIcon(def.id, res.url);
          }
          await renderTileWorkbench();
          renderTilePicker();
        }
      });
    });
  }

  // 全局移除底座开关
  if (tileNoBaseCheckbox) {
    tileNoBaseCheckbox.addEventListener('change', async () => {
      await ThemeEngine.setTileNoBaseGlobal(tileNoBaseCheckbox.checked);
      renderTilePicker();
    });
  }

  // 一键将当前卡片背景应用至全部卡片
  if (tileSyncAllBgBtn) {
    tileSyncAllBgBtn.addEventListener('click', async () => {
      const def = ThemeEngine.getTileDef(currentTileId);
      if (!def) return;
      const cfg = ThemeEngine.getTileConfig(def.id);
      if (!cfg.hasBg) return;

      tileSyncAllBgBtn.disabled = true;
      try {
        const ok = await ThemeEngine.applyTileBgToAll(def.id);
        if (ok) {
          renderTilePicker();
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'DECOR // 背景同步',
              message: `已将「${def.name}」背景应用至全部卡片`,
              type: 'success'
            });
          }
        }
      } finally {
        tileSyncAllBgBtn.disabled = false;
      }
    });
  }

  // 恢复默认：清空全部卡片定制
  if (tileResetAllBtn) {
    tileResetAllBtn.addEventListener('click', async () => {
      const ok = await RetroModal.confirm({
        message: '确认恢复图标美化的默认状态？',
        detail: '将清空全部卡片的自定义背景与图标，并关闭全局移除底座。此操作无法撤销。',
        confirmText: '确认恢复',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;

      tileResetAllBtn.disabled = true;
      try {
        await ThemeEngine.resetAllTiles();
        await renderTileWorkbench();
        renderTilePicker();
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'DECOR // 恢复默认',
            message: '已恢复图标美化默认状态',
            type: 'success'
          });
        }
      } finally {
        tileResetAllBtn.disabled = false;
      }
    });
  }

  // 清除抽屉开合
  function openTileClearSheet() {
    if (!tileClearSheetOverlay) return;
    const cfg = ThemeEngine.getTileConfig(currentTileId);
    const def = ThemeEngine.getTileDef(currentTileId);
    // 按可用性置灰
    if (tileClearBgBtn) tileClearBgBtn.disabled = !(def && def.canBg !== false && cfg.hasBg);
    if (tileClearIconBtn) tileClearIconBtn.disabled = !(def && def.canIcon && cfg.hasIcon);
    if (tileClearAllBtn) tileClearAllBtn.disabled = !(cfg.hasBg || cfg.hasIcon || cfg.noBase);
    tileClearSheetOverlay.hidden = false;
    // 强制回流后加类触发过渡
    void tileClearSheetOverlay.offsetWidth;
    tileClearSheetOverlay.classList.add('is-open');
  }

  function closeTileClearSheet() {
    if (!tileClearSheetOverlay) return;
    tileClearSheetOverlay.classList.remove('is-open');
    setTimeout(() => { tileClearSheetOverlay.hidden = true; }, 280);
  }

  if (tileClearBtn) {
    tileClearBtn.addEventListener('click', openTileClearSheet);
  }

  if (tileClearCancelBtn) {
    tileClearCancelBtn.addEventListener('click', closeTileClearSheet);
  }

  if (tileClearSheetOverlay) {
    tileClearSheetOverlay.addEventListener('click', (e) => {
      if (e.target === tileClearSheetOverlay) closeTileClearSheet();
    });
  }

  if (tileClearBgBtn) {
    tileClearBgBtn.addEventListener('click', async () => {
      await ThemeEngine.clearTileBackground(currentTileId);
      closeTileClearSheet();
      await renderTileWorkbench();
      renderTilePicker();
    });
  }

  if (tileClearIconBtn) {
    tileClearIconBtn.addEventListener('click', async () => {
      await ThemeEngine.clearTileIcon(currentTileId);
      closeTileClearSheet();
      await renderTileWorkbench();
      renderTilePicker();
    });
  }

  if (tileClearAllBtn) {
    tileClearAllBtn.addEventListener('click', async () => {
      await ThemeEngine.clearTileAll(currentTileId);
      closeTileClearSheet();
      await renderTileWorkbench();
      renderTilePicker();
    });
  }

  /* ---------------- 初始化 ---------------- */

  drawWheel();
  buildTabs();

  function updateFontPreview() {
    if (!fontPreviewText) return;
    const serialId = Store.getSerialNo();
    fontPreviewText.textContent = `RETROFLOW // 溯流计划 · ${serialId}`;
  }

  window.addEventListener('retroflow:serial-changed', updateFontPreview);

  /* ---------------- 悬浮球美化工坊 ---------------- */
  const orbSkinResetBtn = document.getElementById('orbSkinResetBtn');
  const orbSkinPreviewOrb = document.getElementById('orbSkinPreviewOrb');
  const orbSkinPreviewImg = document.getElementById('orbSkinPreviewImg');
  const orbSkinNormalSlot = document.getElementById('orbSkinNormalSlot');
  const orbSkinNormalSlotImg = document.getElementById('orbSkinNormalSlotImg');
  const orbSkinNormalSlotEmpty = document.getElementById('orbSkinNormalSlotEmpty');
  const orbSkinNormalClear = document.getElementById('orbSkinNormalClear');
  const orbSkinDragSlot = document.getElementById('orbSkinDragSlot');
  const orbSkinDragSlotImg = document.getElementById('orbSkinDragSlotImg');
  const orbSkinDragSlotEmpty = document.getElementById('orbSkinDragSlotEmpty');
  const orbSkinDragClear = document.getElementById('orbSkinDragClear');
  const orbSkinScaleInput = document.getElementById('orbSkinScaleInput');
  const orbSkinScaleValue = document.getElementById('orbSkinScaleValue');
  const orbSkinBorderedCheckbox = document.getElementById('orbSkinBorderedCheckbox');
  // 槽位缩略图 objectURL（重渲染时负责 revoke，防泄漏）
  let orbSkinNormalUrl = null;
  let orbSkinDragUrl = null;
  let orbSkinPreviewUrl = null;

  function revokeOrbSkinUrl(which) {
    if (which === 'normal' && orbSkinNormalUrl) {
      Storage.revokeAssetSrc(orbSkinNormalUrl);
      orbSkinNormalUrl = null;
    } else if (which === 'drag' && orbSkinDragUrl) {
      Storage.revokeAssetSrc(orbSkinDragUrl);
      orbSkinDragUrl = null;
    } else if (which === 'preview' && orbSkinPreviewUrl) {
      Storage.revokeAssetSrc(orbSkinPreviewUrl);
      orbSkinPreviewUrl = null;
    }
  }

  /** 预览小球跟随调校即时刷新（尺寸 / 边框 / 皮肤图）。
   预览区只有 132px 宽，视觉缩放宽封顶 200%，避免 400% 时撑爆预览框；
   右侧百分比标签仍显示真实值，由 setSkinCfg 钳制保证与真球一致。 */
  const ORB_PREVIEW_MAX_SCALE = 200;
  function renderOrbSkinPreview(cfg, normalSrc) {
    if (!orbSkinPreviewOrb) return;
    const previewScale = Math.min(cfg.scale, ORB_PREVIEW_MAX_SCALE);
    orbSkinPreviewOrb.style.setProperty('--orb-scale', String(previewScale / 100));
    orbSkinPreviewOrb.classList.toggle('orb-borderless', !cfg.bordered);
    const hasSkin = Boolean(normalSrc);
    orbSkinPreviewOrb.classList.toggle('has-skin', hasSkin);
    if (orbSkinPreviewImg) {
      if (hasSkin) {
        orbSkinPreviewImg.src = normalSrc;
        orbSkinPreviewImg.hidden = false;
      } else {
        orbSkinPreviewImg.removeAttribute('src');
        orbSkinPreviewImg.hidden = true;
      }
    }
  }

  /** 从权威数据源回填整个工坊（槽位缩略图 / 滑杆 / 开关 / 预览） */
  async function renderOrbSkinWorkbench() {
    if (!orbSkinNormalSlot) return;
    const cfg = (window.SystemChatOrb && SystemChatOrb.getSkinCfg)
      ? SystemChatOrb.getSkinCfg()
      : { scale: 100, bordered: true };
    if (orbSkinScaleInput) orbSkinScaleInput.value = String(cfg.scale);
    if (orbSkinScaleValue) orbSkinScaleValue.textContent = `${cfg.scale}%`;
    if (orbSkinBorderedCheckbox) orbSkinBorderedCheckbox.checked = cfg.bordered;
    // 槽位缩略图
    let normalSrc = null;
    let dragSrc = null;
    try {
      normalSrc = await Storage.getAssetSrc(DataRegistry.key.orbSkinNormal());
      dragSrc = await Storage.getAssetSrc(DataRegistry.key.orbSkinDrag());
    } catch (_) {}
    revokeOrbSkinUrl('normal');
    revokeOrbSkinUrl('drag');
    revokeOrbSkinUrl('preview');
    orbSkinNormalUrl = normalSrc && normalSrc.startsWith('blob:') ? normalSrc : null;
    orbSkinDragUrl = dragSrc && dragSrc.startsWith('blob:') ? dragSrc : null;
    orbSkinPreviewUrl = orbSkinNormalUrl;
    if (orbSkinNormalSlotImg) {
      orbSkinNormalSlotImg.src = normalSrc || '';
      orbSkinNormalSlotImg.hidden = !normalSrc;
    }
    if (orbSkinNormalSlotEmpty) orbSkinNormalSlotEmpty.hidden = Boolean(normalSrc);
    if (orbSkinNormalClear) orbSkinNormalClear.hidden = !normalSrc;
    if (orbSkinDragSlotImg) {
      orbSkinDragSlotImg.src = dragSrc || '';
      orbSkinDragSlotImg.hidden = !dragSrc;
    }
    if (orbSkinDragSlotEmpty) orbSkinDragSlotEmpty.hidden = Boolean(dragSrc);
    if (orbSkinDragClear) orbSkinDragClear.hidden = !dragSrc;
    renderOrbSkinPreview(cfg, normalSrc);
  }

  /** 打开图片选择器并把结果写进指定皮肤位（原样存储不转码，保 GIF 动图） */
  function pickOrbSkin(which) {
    if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
    const isNormal = which === 'normal';
    ImagePicker.open({
      title: isNormal ? '上传悬浮球常态图' : '上传悬浮球拖拽图',
      onSelect: async (res) => {
        if (!res) return;
        try {
          const key = isNormal ? DataRegistry.key.orbSkinNormal() : DataRegistry.key.orbSkinDrag();
          if (res.type === 'file' && res.file) {
            await Storage.setAsset(key, res.file);
          } else if (res.type === 'url' && res.url) {
            await Storage.setAsset(key, res.url);
          } else {
            return;
          }
          if (window.SystemChatOrb && SystemChatOrb.refreshSkin) await SystemChatOrb.refreshSkin();
          await renderOrbSkinWorkbench();
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'DECOR // 悬浮球美化',
              message: isNormal ? '常态皮肤已换装' : '拖拽皮肤已换装',
              type: 'success'
            });
          }
        } catch (err) {
          console.error('[ThemeUI] 悬浮球皮肤写入失败:', err);
        }
      }
    });
  }

  /** 清除指定皮肤位（拖拽位清除后自动回退共用常态图） */
  async function clearOrbSkin(which) {
    try {
      const key = which === 'normal' ? DataRegistry.key.orbSkinNormal() : DataRegistry.key.orbSkinDrag();
      await Storage.removeAsset(key);
      if (window.SystemChatOrb && SystemChatOrb.refreshSkin) await SystemChatOrb.refreshSkin();
      await renderOrbSkinWorkbench();
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'DECOR // 悬浮球美化',
          message: which === 'normal' ? '常态皮肤已清除，回到罗盘芯' : '拖拽皮肤已清除',
          type: 'info'
        });
      }
    } catch (err) {
      console.error('[ThemeUI] 悬浮球皮肤清除失败:', err);
    }
  }

  if (orbSkinNormalSlot) {
    orbSkinNormalSlot.addEventListener('click', (e) => {
      if (e.target.closest('.orb-skin-slot-clear')) return;
      pickOrbSkin('normal');
    });
  }
  if (orbSkinDragSlot) {
    orbSkinDragSlot.addEventListener('click', (e) => {
      if (e.target.closest('.orb-skin-slot-clear')) return;
      pickOrbSkin('drag');
    });
  }
  if (orbSkinNormalClear) {
    orbSkinNormalClear.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await RetroModal.confirm({
        message: '确认清除常态皮肤？',
        detail: '清除后悬浮球回到默认罗盘芯。若已设拖拽图，会一并失去共用来源。',
        confirmText: '清除',
        cancelText: '取消',
        danger: true
      });
      if (ok) await clearOrbSkin('normal');
    });
  }
  if (orbSkinDragClear) {
    orbSkinDragClear.addEventListener('click', async (e) => {
      e.stopPropagation();
      await clearOrbSkin('drag');
    });
  }
  if (orbSkinScaleInput) {
    orbSkinScaleInput.addEventListener('input', () => {
      const scale = parseInt(orbSkinScaleInput.value, 10) || 100;
      if (orbSkinScaleValue) orbSkinScaleValue.textContent = `${scale}%`;
      if (window.SystemChatOrb && SystemChatOrb.setSkinCfg) {
        SystemChatOrb.setSkinCfg({ scale });
        renderOrbSkinPreview(SystemChatOrb.getSkinCfg(), orbSkinPreviewUrl);
      }
    });
  }
  if (orbSkinBorderedCheckbox) {
    orbSkinBorderedCheckbox.addEventListener('change', () => {
      if (window.SystemChatOrb && SystemChatOrb.setSkinCfg) {
        SystemChatOrb.setSkinCfg({ bordered: orbSkinBorderedCheckbox.checked });
        renderOrbSkinPreview(SystemChatOrb.getSkinCfg(), orbSkinPreviewUrl);
      }
    });
  }
  // 恢复默认：清双图 + 调校归位
  if (orbSkinResetBtn) {
    orbSkinResetBtn.addEventListener('click', async () => {
      const ok = await RetroModal.confirm({
        message: '确认恢复悬浮球默认外观？',
        detail: '将清除常态图与拖拽图，尺寸回到 100%，圆形边框重新启用。此操作无法撤销。',
        confirmText: '确认恢复',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
      orbSkinResetBtn.disabled = true;
      try {
        await Storage.removeAsset(DataRegistry.key.orbSkinNormal());
        await Storage.removeAsset(DataRegistry.key.orbSkinDrag());
        if (window.SystemChatOrb) {
          if (SystemChatOrb.setSkinCfg) SystemChatOrb.setSkinCfg({ scale: 100, bordered: true });
          if (SystemChatOrb.refreshSkin) await SystemChatOrb.refreshSkin();
        }
        await renderOrbSkinWorkbench();
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'DECOR // 恢复默认',
            message: '悬浮球已恢复罗盘芯默认外观',
            type: 'success'
          });
        }
      } finally {
        orbSkinResetBtn.disabled = false;
      }
    });
  }

  // 主题配置在内存就绪后才能应用色彩、壁纸与字体
  Boot.onReady('theme', async () => {
    ThemeEngine.init();
    // 色彩数据此刻方才载入内存，回填 6 大通道胶囊的预览色卡
    refreshTabSwatches();
    selectToken(activeToken);
    renderPaletteCapsules();
    updateFontPreview();

    // 恢复壁纸与字体库状态展示
    const src = await ThemeEngine.restoreWallpaper();
    renderWallpaperPreview(src);

    const active = await ThemeEngine.restoreActiveFont();
    if (active && fontStatusName) fontStatusName.textContent = active.name;
    refreshFontUI();

    // 初始化图标美化工坊
    renderTilePicker();
    renderTileWorkbench();
    // 初始化悬浮球美化工坊（回填皮肤槽位与调校）
    renderOrbSkinWorkbench();
  });

  window.addEventListener('resize', updateCursorPosition);

  /* ---------------- 主题包导入导出（右上角烤串菜单） ---------------- */

  const themeKebabWrap = document.getElementById('themeKebabWrap');
  const themeMoreBtn = document.getElementById('themeMoreBtn');
  const themeMenuPopover = document.getElementById('themeMenuPopover');
  const themeImportInput = document.getElementById('themeImportInput');

  function themeToast(tag, message, type) {
    if (window.RetroToast && typeof RetroToast.show === 'function') {
      RetroToast.show({ tag, message, type: type || 'info' });
    }
  }

  function closeThemeMenu() {
    if (!themeMenuPopover) return;
    themeMenuPopover.hidden = true;
    themeMenuPopover.setAttribute('aria-hidden', 'true');
    if (themeMoreBtn) {
      themeMoreBtn.classList.remove('is-active');
      themeMoreBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function openThemeMenu() {
    if (!themeMenuPopover) return;
    themeMenuPopover.hidden = false;
    themeMenuPopover.setAttribute('aria-hidden', 'false');
    if (themeMoreBtn) {
      themeMoreBtn.classList.add('is-active');
      themeMoreBtn.setAttribute('aria-expanded', 'true');
    }
  }

  async function doExportTheme() {
    if (!window.DataVault || typeof DataVault.exportTheme !== 'function') {
      themeToast('THEME // 导出', '主题导出模块未就绪', 'warning');
      return;
    }
    try {
      await DataVault.exportTheme();
      themeToast('THEME // 导出主题包', '主题包已生成并触发下载', 'info');
    } catch (_) {
      themeToast('THEME // 导出失败', '主题包生成过程出错', 'warning');
    }
  }

  function triggerThemeImport() {
    if (themeImportInput) {
      themeImportInput.value = '';
      themeImportInput.click();
    }
  }

  async function handleThemeImportFile(file) {
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch (_) {
      themeToast('THEME // 读取失败', '无法读取所选文件', 'warning');
      return;
    }

    const pkg = window.DataVault && typeof DataVault.parsePackage === 'function'
      ? DataVault.parsePackage(text)
      : null;
    if (!pkg) {
      themeToast('THEME // 格式错误', '这不是有效的溯流数据/主题包文件', 'warning');
      return;
    }

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'THEME // 导入主题包',
        message: '确认导入这份主题包吗？',
        detail: '将以主题包内容覆盖当前的配色、色卡、字体、壁纸（含遮罩与磨砂）、以及卡片背景与图标（含底座配置）。此操作无法撤销，完成后页面会自动重载。',
        confirmText: '确认导入',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    themeToast('THEME // 写入中', '正在应用主题，请稍候…', 'info');
    let result;
    try {
      result = await DataVault.applyThemeImport(pkg);
    } catch (_) {
      themeToast('THEME // 导入失败', '写入过程出错，主题可能不完整', 'warning');
      return;
    }

    if (!result || !result.ok) {
      themeToast('THEME // 导入失败', '主题包内容无法应用', 'warning');
      return;
    }

    if (window.RetroModal && typeof RetroModal.alert === 'function') {
      await RetroModal.alert({
        tag: 'THEME // 导入完成',
        message: '主题已写入本地存储',
        detail: '页面将重新载入以应用导入的主题外观。',
        confirmText: '立即重载'
      });
    }
    try { location.reload(); } catch (_) { /* ignore */ }
  }

  if (themeMoreBtn) {
    themeMoreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (themeMenuPopover && themeMenuPopover.hidden) openThemeMenu();
      else closeThemeMenu();
    });
  }

  if (themeMenuPopover) {
    themeMenuPopover.addEventListener('click', (e) => {
      const item = e.target.closest('.retro-kebab-item');
      if (!item) return;
      e.stopPropagation();
      closeThemeMenu();
      const action = item.dataset.action;
      if (action === 'export-theme') doExportTheme();
      else if (action === 'import-theme') triggerThemeImport();
    });
  }

  // 轻触外部空白收起菜单
  document.addEventListener('click', (e) => {
    if (!themeMenuPopover || themeMenuPopover.hidden) return;
    if (themeMenuPopover.contains(e.target)) return;
    if (themeMoreBtn && themeMoreBtn.contains(e.target)) return;
    closeThemeMenu();
  });

  if (themeImportInput) {
    themeImportInput.addEventListener('change', async () => {
      const file = themeImportInput.files && themeImportInput.files[0];
      await handleThemeImportFile(file);
      themeImportInput.value = '';
    });
  }

  // 暴露给设置控制器，在二级页面滑入后重新校准光标位置
  window.RetroflowThemeUI = {
    recalibrate: () => {
      drawWheel();
      updateCursorPosition();
      // 每次进页回填悬浮球美化最新状态（皮肤可能在别处被恢复默认过）
      renderOrbSkinWorkbench();
    }
  };
})();