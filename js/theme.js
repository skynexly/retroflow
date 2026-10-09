/**
 * 溯流计划 · 视界渲染引擎 (Theme Engine)
 * 1. 因果色谱：6 大核心变量交互色环调配 + RGB 通道自动计算 + 持久化
 * 2. 终端视界：桌面壁纸上传/URL 引入，走 IndexedDB 异步存储
 * 3. 文本同调：自定义字体文件注入，动态生成 @font-face
 */
const ThemeEngine = (() => {
  /* ---------------- 色彩变量定义 ---------------- */
  const COLOR_TOKENS = [
    { key: 'bg-color', label: '背景色', en: 'BASE', default: '#EDEBDD', rgb: true },
    { key: 'card-bg-color', label: '卡片色', en: 'CARD', default: '#E2DFD0', rgb: true },
    { key: 'primary-color', label: '重点色', en: 'PRIMARY', default: '#630000', rgb: true },
    { key: 'secondary-color', label: '反色', en: 'INVERSE', default: '#1B1717', rgb: true },
    { key: 'decor-color', label: '装饰色', en: 'DECOR', default: '#E6C280', rgb: true },
    { key: 'text-muted', label: '次文字', en: 'MUTED', default: '#756A5B', rgb: true }
  ];
  // 已从调色盘撤下、但仍需清理历史存档的旧通道
  const RETIRED_COLOR_KEYS = ['text-main'];

  /* ---------------- 首帧影子缓存 ----------------
     配色权威数据在 IndexedDB（随存档导出），但那是异步读取：
     首帧只能拿到 variables.css 的默认色板，等 Boot 装载完才切过去，
     肉眼就是「闪一下默认配色」。
     这里额外往 localStorage 同步落一份色值快照，供 index.html 的
     首帧内联脚本在 CSS 之后立刻写入变量，消除跳变。
     快照只是加速层，不参与存档；IndexedDB 回来后仍会覆盖一次（同值无感）。 */
  const SHADOW_CACHE_KEY = 'retroflow_theme_colors_shadow_v1';

  function writeShadowCache(colors) {
    try {
      localStorage.setItem(SHADOW_CACHE_KEY, JSON.stringify(colors || {}));
    } catch (_) {
      // 隐私模式 / 配额写满：快照失效只是退回闪一下，不影响主流程
    }
  }


  const ASSET_KEY_WALLPAPER = DataRegistry.key.wallpaper();

  /* ---------------- 色彩转换算法 ---------------- */

  function hexToRgb(hex) {
    const clean = String(hex).replace('#', '').trim();
    const full = clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean;
    const num = parseInt(full, 16);
    if (Number.isNaN(num) || full.length !== 6) return null;
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  function rgbToHex(r, g, b) {
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  }

  function rgbToHsv({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;

    let h = 0;
    if (d !== 0) {
      if (max === rn) h = ((gn - bn) / d) % 6;
      else if (max === gn) h = (bn - rn) / d + 2;
      else h = (rn - gn) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }

    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
  }

  function hsvToRgb({ h, s, v }) {
    const c = v * s;
    const hh = (h % 360) / 60;
    const x = c * (1 - Math.abs((hh % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;

    if (hh >= 0 && hh < 1) [r, g, b] = [c, x, 0];
    else if (hh < 2) [r, g, b] = [x, c, 0];
    else if (hh < 3) [r, g, b] = [0, c, x];
    else if (hh < 4) [r, g, b] = [0, x, c];
    else if (hh < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    const m = v - c;
    return {
      r: (r + m) * 255,
      g: (g + m) * 255,
      b: (b + m) * 255
    };
  }

  /* ---------------- 色彩应用与持久化 ---------------- */

  let currentColors = {};

  function loadColors() {
    // 配置已由 Boot 装载进内存，这里是纯同步读
    const saved = Object.assign({}, Store.decor.themeColors);

    // 清理已撤下通道的历史残留，避免其继续写回存档
    let hasRetired = false;
    RETIRED_COLOR_KEYS.forEach((key) => {
      if (key in saved) {
        delete saved[key];
        hasRetired = true;
      }
    });

    COLOR_TOKENS.forEach((token) => {
      currentColors[token.key] = saved[token.key] || token.default;
    });

    if (hasRetired) {
      saveColors();
    }

    return currentColors;
  }

  function applyColor(key, hex) {
    const token = COLOR_TOKENS.find((t) => t.key === key);
    if (!token) return;

    const rgb = hexToRgb(hex);
    if (!rgb) return;

    const root = document.documentElement;
    root.style.setProperty(`--${key}`, hex);
    if (token.rgb) {
      root.style.setProperty(`--${key}-rgb`, `${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}`);
    }

    currentColors[key] = hex;

    // 重点色同步到浏览器/PWA 状态栏主题色，避免与自定义配色脱节
    if (key === 'primary-color') {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', hex);
    }
  }

  function saveColors() {
    // 落盘的同时刷新首帧快照，避免快照过期导致下次启动闪一下旧配色
    writeShadowCache(currentColors);
    return Store.save('decor.themeColors', Object.assign({}, currentColors));
  }

  function applyAllColors() {
    // 清掉已撤下通道遗留在 root 上的内联覆盖值
    const root = document.documentElement;
    RETIRED_COLOR_KEYS.forEach((key) => {
      root.style.removeProperty(`--${key}`);
      root.style.removeProperty(`--${key}-rgb`);
    });

    Object.keys(currentColors).forEach((key) => applyColor(key, currentColors[key]));
    // 本轮生效的完整色板落一份首帧快照，下次启动首帧即正确配色
    writeShadowCache(currentColors);
  }

  function resetColors() {
    COLOR_TOKENS.forEach((token) => {
      currentColors[token.key] = token.default;
      applyColor(token.key, token.default);
    });
    writeShadowCache(currentColors);
    saveColors();
  }

  /* ---------------- 桌面壁纸与遮罩 ---------------- */

  let wallpaperObjectUrl = null;

  function isWallpaperMaskEnabled() {
    const saved = Store.decor.themeWallpaperMask;
    // 默认开启遮罩（未设置过时为 true）
    return saved === null || saved === undefined ? true : Boolean(saved);
  }

  function setWallpaperMaskEnabled(enabled) {
    const val = Boolean(enabled);
    Store.save('decor.themeWallpaperMask', val);
    applyWallpaperMask(val);
  }

  function applyWallpaperMask(enabled) {
    if (enabled) {
      document.body.classList.add('has-wallpaper-mask');
    } else {
      document.body.classList.remove('has-wallpaper-mask');
    }
  }

  /* ---------------- 桌面卡片全息磨砂透光 ---------------- */

  function isFrostedGlassEnabled() {
    const saved = Store.decor.themeFrostedGlass;
    // 默认关闭，尊重用户偏好
    return Boolean(saved);
  }

  function setFrostedGlassEnabled(enabled) {
    const val = Boolean(enabled);
    Store.save('decor.themeFrostedGlass', val);
    applyFrostedGlass(val);
  }

  function applyFrostedGlass(enabled) {
    if (enabled) {
      document.body.classList.add('has-frosted-glass');
    } else {
      document.body.classList.remove('has-frosted-glass');
    }
  }

  function renderWallpaper(src) {
    const layer = document.getElementById('wallpaperLayer');
    if (!layer) return;

    if (src) {
      layer.style.backgroundImage = `url("${src}")`;
      document.body.classList.add('has-wallpaper');
      applyWallpaperMask(isWallpaperMaskEnabled());
    } else {
      layer.style.backgroundImage = '';
      document.body.classList.remove('has-wallpaper');
      document.body.classList.remove('has-wallpaper-mask');
    }
  }

  async function restoreWallpaper() {
    applyWallpaperMask(isWallpaperMaskEnabled());
    applyFrostedGlass(isFrostedGlassEnabled());
    const src = await Storage.getAssetSrc(ASSET_KEY_WALLPAPER);
    if (src) {
      wallpaperObjectUrl = src;
      renderWallpaper(src);
    }
    return src;
  }

  async function setWallpaper(value) {
    await Storage.setAsset(ASSET_KEY_WALLPAPER, value);
  }

  async function clearWallpaper() {
    await Storage.removeAsset(ASSET_KEY_WALLPAPER);
    if (wallpaperObjectUrl) {
      Storage.revokeAssetSrc(wallpaperObjectUrl);
      wallpaperObjectUrl = null;
    }
    renderWallpaper(null);
  }

  /* ---------------- 多字体库管理 ---------------- */

  const ASSET_PREFIX_FONT = DataRegistry.prefix.font;
  const FONT_STYLE_ID = 'retroflow-custom-font';

  // 内置预设字体登记表：key -> 展示名 / 文件路径 / 字号微调
  // sizeAdjust 用 CSS size-adjust 等比缩放渲染，避免篡改字体二进制导致字形失真。
  // 手账本（寒蝉手拙）本身字面偏小，这里放大到 112%。
  const PRESET_FONTS = [
    { id: 'preset:zhenkai',   name: '纸墨古卷', file: 'assets/fonts/font-zhenkai.ttf',   family: 'RetroflowPresetZhenkai',   format: 'TTF', sizeAdjust: null },
    { id: 'preset:chillzhuo', name: '随行手账', file: 'assets/fonts/font-chillzhuo.ttf', family: 'RetroflowPresetChillzhuo', format: 'TTF', sizeAdjust: '112%' },
    { id: 'preset:arkpixel',  name: '复古掌机', file: 'assets/fonts/font-arkpixel.ttf',  family: 'RetroflowPresetArkpixel',  format: 'TTF', sizeAdjust: null },
    { id: 'preset:chillduan', name: '执行终端', file: 'assets/fonts/font-chillduan.otf', family: 'RetroflowPresetChillduan', format: 'OTF', sizeAdjust: null },
    { id: 'preset:mincho',    name: '旧打字机', file: 'assets/fonts/font-mincho.otf',    family: 'RetroflowPresetMincho',    format: 'OTF', sizeAdjust: null }
  ];

  function getPresetFont(id) {
    return PRESET_FONTS.find((f) => f.id === id) || null;
  }

  let activeFontObjectUrl = null;

  function injectFontFace(url) {
    let styleTag = document.getElementById(FONT_STYLE_ID);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = FONT_STYLE_ID;
      document.head.appendChild(styleTag);
    }
    // 全局字体总闸：只改写 --main-font 这一个 CSS 变量。
    // 全站所有文字组件都已收敛到 var(--main-font) / var(--mono-font) / inherit，
    // 因此这里一行变量赋值即可让整个终端（含输入框、按钮、弹窗、列表）同步换字。
    // 等宽通道 --mono-font 不动，保证编号、时钟、序列号等战术组件依旧对齐不歪斜。
    styleTag.textContent = `
      @font-face {
        font-family: 'RetroflowCustom';
        src: url("${url}");
        font-display: swap;
      }
      :root {
        --main-font: 'RetroflowCustom', system-ui, -apple-system, sans-serif;
      }
    `;
    document.body.classList.add('has-custom-font');
  }

  // 注入内置预设字体：走文件 URL 直连，配置 font-display: swap 按需异步加载，
  // 并可携带 size-adjust 做整体字号微调。
  function injectPresetFontFace(preset) {
    let styleTag = document.getElementById(FONT_STYLE_ID);
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = FONT_STYLE_ID;
      document.head.appendChild(styleTag);
    }
    const sizeAdjustLine = preset.sizeAdjust ? `        size-adjust: ${preset.sizeAdjust};\n` : '';
    styleTag.textContent = `
      @font-face {
        font-family: '${preset.family}';
        src: url("${preset.file}");
        font-display: swap;
${sizeAdjustLine}      }
      :root {
        --main-font: '${preset.family}', system-ui, -apple-system, sans-serif;
      }
    `;
    document.body.classList.add('has-custom-font');
  }

  function removeFontFace() {
    const styleTag = document.getElementById(FONT_STYLE_ID);
    if (styleTag) styleTag.remove();
    document.body.classList.remove('has-custom-font');
  }

  function getFontListMeta() {
    // 返回副本，防止调用方直接改到 Store 的内存数组
    return (Store.decor.themeFontListMeta || []).slice();
  }

  function saveFontListMeta(list) {
    return Store.save('decor.themeFontListMeta', list);
  }

  function getActiveFontId() {
    return Store.decor.themeActiveFontId;
  }

  async function addFont(file) {
    const id = 'font_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const meta = {
      id,
      name: file.name.replace(/\.[^/.]+$/, ''),
      fullName: file.name,
      size: file.size,
      type: file.name.split('.').pop().toUpperCase(),
      createdAt: Date.now()
    };

    await Storage.setAsset(`${ASSET_PREFIX_FONT}${id}`, file);
    const list = getFontListMeta();
    list.unshift(meta);
    await saveFontListMeta(list);

    // 默认导入后自动激活
    await switchFont(id);
    return meta;
  }

  async function removeFont(id) {
    const list = getFontListMeta();
    const updated = list.filter((f) => f.id !== id);
    await saveFontListMeta(updated);
    await Storage.removeAsset(`${ASSET_PREFIX_FONT}${id}`);

    if (getActiveFontId() === id) {
      await switchFont('default');
    }
  }

  async function switchFont(id) {
    await Store.save('decor.themeActiveFontId', id);

    if (activeFontObjectUrl) {
      Storage.revokeAssetSrc(activeFontObjectUrl);
      activeFontObjectUrl = null;
    }

    if (id === 'default') {
      removeFontFace();
      return { id: 'default', name: '系统默认' };
    }

    // 内置预设字体：走文件 URL 直连，无需查资产库
    const preset = getPresetFont(id);
    if (preset) {
      injectPresetFontFace(preset);
      return { id: preset.id, name: preset.name };
    }

    const src = await Storage.getAssetSrc(`${ASSET_PREFIX_FONT}${id}`);
    const list = getFontListMeta();
    const target = list.find((f) => f.id === id);

    if (src && target) {
      activeFontObjectUrl = src;
      injectFontFace(src);
      return target;
    } else {
      // 找不到字体时回退默认
      removeFontFace();
      await Store.save('decor.themeActiveFontId', 'default');
      return { id: 'default', name: '系统默认' };
    }
  }

  async function restoreActiveFont() {
    const activeId = getActiveFontId();
    return await switchFont(activeId);
  }

  /* ---------------- 预设与自定义色卡 ---------------- */

  const PRESET_PALETTES = [
    {
      id: 'preset_velvet',
      name: '丝绒',
      isPreset: true,
      colors: {
        'bg-color': '#EDEBDD',
        'card-bg-color': '#E2DFD0',
        'primary-color': '#630000',
        'secondary-color': '#1B1717',
        'decor-color': '#E6C280',
        'text-muted': '#756A5B'
      }
    },
    {
      id: 'preset_bramble',
      name: '刺莓',
      isPreset: true,
      colors: {
        'bg-color': '#EDE0DD',
        'card-bg-color': '#E0CFD7',
        'primary-color': '#B32B47',
        'secondary-color': '#38365E',
        'decor-color': '#E68084',
        'text-muted': '#5B5C75'
      }
    },
    {
      id: 'preset_morpho',
      name: '闪蝶',
      isPreset: true,
      colors: {
        'bg-color': '#D5DDED',
        'card-bg-color': '#CCD1E3',
        'primary-color': '#0004AD',
        'secondary-color': '#00093B',
        'decor-color': '#80DBE6',
        'text-muted': '#5B5D75'
      }
    },
    {
      id: 'preset_mist',
      name: '朝雾',
      isPreset: true,
      colors: {
        'bg-color': '#C9DFED',
        'card-bg-color': '#C1D7E8',
        'primary-color': '#8DB4D9',
        'secondary-color': '#6A8CB8',
        'decor-color': '#78B2F0',
        'text-muted': '#5B6575'
      }
    },
    {
      id: 'preset_cookie',
      name: '曲奇',
      isPreset: true,
      colors: {
        'bg-color': '#DECEBF',
        'card-bg-color': '#D4C7B8',
        'primary-color': '#A66F50',
        'secondary-color': '#5E4336',
        'decor-color': '#E6C480',
        'text-muted': '#756D5B'
      }
    },
    {
      id: 'preset_condemn',
      name: '断罪',
      isPreset: true,
      colors: {
        'bg-color': '#000000',
        'card-bg-color': '#0D0E0F',
        'primary-color': '#9C0517',
        'secondary-color': '#576ABF',
        'decor-color': '#91BCC7',
        'text-muted': '#5E607A'
      }
    },
    {
      id: 'preset_sacred_tree',
      name: '神树',
      isPreset: true,
      colors: {
        'bg-color': '#0E1A0C',
        'card-bg-color': '#142115',
        'primary-color': '#128A00',
        'secondary-color': '#95B584',
        'decor-color': '#FFF591',
        'text-muted': '#516300'
      }
    },
    {
      id: 'preset_hysteria',
      name: '癔症',
      isPreset: true,
      colors: {
        'bg-color': '#0E0C1A',
        'card-bg-color': '#191726',
        'primary-color': '#D994FF',
        'secondary-color': '#8961CF',
        'decor-color': '#C269C9',
        'text-muted': '#FF94AE'
      }
    },
    {
      id: 'preset_mars',
      name: '荧惑',
      isPreset: true,
      colors: {
        'bg-color': '#0F0E0E',
        'card-bg-color': '#211E1D',
        'primary-color': '#FF5B05',
        'secondary-color': '#FFCB63',
        'decor-color': '#5055E6',
        'text-muted': '#7A7056'
      }
    },
    {
      id: 'preset_martyr',
      name: '殉道',
      isPreset: true,
      colors: {
        'bg-color': '#1C1C1C',
        'card-bg-color': '#2E2E2E',
        'primary-color': '#616161',
        'secondary-color': '#93929C',
        'decor-color': '#FFEFCC',
        'text-muted': '#C2B8A7'
      }
    }
  ];

  function getPresetPalettes() {
    return PRESET_PALETTES.slice();
  }

  function getCustomPalettes() {
    const list = Store.decor.customColorPalettes;
    return Array.isArray(list) ? list.slice() : [];
  }

  function getAllPalettes() {
    return [...getPresetPalettes(), ...getCustomPalettes()];
  }

  function saveCustomPalette(name, colors = null) {
    const rawName = String(name || '').trim();
    if (!rawName) return null;

    const snapshot = Object.assign({}, colors || currentColors);
    const list = getCustomPalettes();
    const id = `palette_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newPalette = {
      id,
      name: rawName,
      isPreset: false,
      colors: snapshot,
      createdAt: Date.now()
    };

    list.push(newPalette);
    Store.save('decor.customColorPalettes', list);
    return newPalette;
  }

  function deleteCustomPalette(id) {
    if (!id) return false;
    let list = getCustomPalettes();
    const lenBefore = list.length;
    list = list.filter((p) => p.id !== id);
    if (list.length === lenBefore) return false;
    Store.save('decor.customColorPalettes', list);
    return true;
  }

  function applyPalette(palette) {
    if (!palette || !palette.colors) return false;
    Object.keys(palette.colors).forEach((key) => {
      applyColor(key, palette.colors[key]);
    });
    saveColors();
    return true;
  }
  function isMatchingPalette(palette) {
    if (!palette || !palette.colors) return false;
    return COLOR_TOKENS.every((token) => {
      const cur = (currentColors[token.key] || '').toUpperCase();
      const pal = (palette.colors[token.key] || '').toUpperCase();
      return cur === pal;
    });
  }

  /* ---------------- 桌面磁贴图标美化 ---------------- */

  // 13 张桌面卡片的美化配置清单。
  // canIcon=false 的卡片（音乐/备忘录）是功能组件形态，只支持换背景。
  const TILE_DEFS = [
    { id: 'profile',   name: '红卡',     index: '00', bgSel: '.profile-card',                    iconSel: null,                                                 canIcon: false },
    { id: 'forks',     name: '副本库',   index: '01', bgSel: '.bento-card[data-app="forks"]',     iconSel: '.bento-card[data-app="forks"] .bento-icon-wrap',     canIcon: true },
    { id: 'memory',    name: '数据归档', index: '02', bgSel: '.bento-card[data-app="memory"]',    iconSel: '.bento-card[data-app="memory"] .bento-icon-wrap',    canIcon: true },
    { id: 'persona',   name: '个人档案', index: '03', bgSel: '.bento-card[data-app="persona"]',   iconSel: '.bento-card[data-app="persona"] .bento-icon-wrap',   canIcon: true },
    { id: 'resonance', name: '同调档案', index: '04', bgSel: '.bento-card[data-app="resonance"]', iconSel: '.bento-card[data-app="resonance"] .bento-icon-wrap', canIcon: true },
    { id: 'echo',      name: '溯流论坛', index: '05', bgSel: '.bento-card[data-app="echo"]',      iconSel: '.bento-card[data-app="echo"] .bento-icon-wrap',      canIcon: true },
    { id: 'supply',    name: '系统商城', index: '06', bgSel: '.bento-card[data-app="supply"]',    iconSel: '.bento-card[data-app="supply"] .bento-icon-wrap',    canIcon: true },
    { id: 'vault',     name: '收藏馆',   index: '07', bgSel: '.bento-card[data-app="vault"]',     iconSel: '.bento-card[data-app="vault"] .bento-icon-wrap',     canIcon: true },
    { id: 'reader',    name: '阅读',     index: '08', bgSel: '.bento-card[data-app="reader"]',    iconSel: '.bento-card[data-app="reader"] .bento-icon-wrap',    canIcon: true,  canBg: true },
    { id: 'gallery',   name: '图库',     index: '09', bgSel: null,                                 iconSel: '#bentoGalleryCard .p2-gallery-icon-wrap',            canIcon: true,  canBg: false },
    { id: 'music',     name: '音乐',     index: '10', bgSel: '#bentoAudioDeck',                   iconSel: null,                                                 canIcon: false, canBg: true },
    { id: 'memo',      name: '备忘录',   index: '11', bgSel: '#bentoMemoCard',                    iconSel: null,                                                 canIcon: false, canBg: true },
    { id: 'credits',   name: '积分资产', index: '12', bgSel: '.bento-card[data-app="credits"]',   iconSel: '.bento-card[data-app="credits"] .bento-icon-wrap',   canIcon: true },
    { id: 'inventory', name: '储物室',   index: '13', bgSel: '.bento-card[data-app="inventory"]', iconSel: '.bento-card[data-app="inventory"] .bento-icon-wrap', canIcon: true }
  ];

  // 内部缓存：图标容器的原始 SVG（首次应用前快照，供清除时还原）
  const tileIconOriginalHTML = {};
  // 已生成的 objectURL，按资产键缓存，便于释放
  const tileObjectUrls = {};

  function getTileDefs() {
    return TILE_DEFS.map((t) => Object.assign({}, t));
  }

  function getTileDef(id) {
    return TILE_DEFS.find((t) => t.id === id) || null;
  }

  function getTileConfigs() {
    const cfg = Store.decor.tileConfigs;
    return (cfg && typeof cfg === 'object') ? cfg : {};
  }

  function getTileConfig(id) {
    const all = getTileConfigs();
    const c = all[id];
    return {
      hasBg: !!(c && c.hasBg),
      hasIcon: !!(c && c.hasIcon),
      noBase: !!(c && c.noBase)
    };
  }

  function saveTileConfig(id, patch) {
    const all = Object.assign({}, getTileConfigs());
    const prev = all[id] || {};
    const next = Object.assign({}, prev, patch);
    // 清理全 false 的空壳，避免存档膨胀
    if (!next.hasBg && !next.hasIcon && !next.noBase) {
      delete all[id];
    } else {
      all[id] = next;
    }
    return Store.save('decor.tileConfigs', all);
  }

  function revokeTileUrl(key) {
    if (tileObjectUrls[key]) {
      Storage.revokeAssetSrc(tileObjectUrls[key]);
      delete tileObjectUrls[key];
    }
  }

  // 应用单张卡片的背景
  async function applyTileBackground(id) {
    const def = getTileDef(id);
    if (!def || def.canBg === false) return;
    const el = document.querySelector(def.bgSel);
    if (!el) return;
    const cfg = getTileConfig(id);
    const bgKey = DataRegistry.key.tileBg(id);

    if (cfg.hasBg) {
      const src = await Storage.getAssetSrc(bgKey);
      if (src) {
        revokeTileUrl(bgKey);
        if (typeof src === 'string' && src.startsWith('blob:')) tileObjectUrls[bgKey] = src;
        el.style.backgroundImage = `url("${src}")`;
        el.classList.add('tile-has-bg');
        return;
      }
    }
    // 无背景：还原
    el.style.backgroundImage = '';
    el.classList.remove('tile-has-bg');
  }

  // 应用单张卡片的图标与底座
  async function applyTileIcon(id) {
    const def = getTileDef(id);
    if (!def || !def.canIcon || !def.iconSel) return;
    const wrap = document.querySelector(def.iconSel);
    if (!wrap) return;

    // 首次见到该图标容器时，快照原始 SVG，供清除还原
    if (tileIconOriginalHTML[id] === undefined) {
      tileIconOriginalHTML[id] = wrap.innerHTML;
    }

    const cfg = getTileConfig(id);
    const iconKey = DataRegistry.key.tileIcon(id);

    if (cfg.hasIcon) {
      const src = await Storage.getAssetSrc(iconKey);
      if (src) {
        revokeTileUrl(iconKey);
        if (typeof src === 'string' && src.startsWith('blob:')) tileObjectUrls[iconKey] = src;
        wrap.innerHTML = '';
        const img = document.createElement('img');
        img.className = 'tile-custom-icon';
        img.alt = '';
        img.src = src;
        wrap.appendChild(img);
      }
    } else {
      // 还原原始 SVG
      if (tileIconOriginalHTML[id] !== undefined) {
        wrap.innerHTML = tileIconOriginalHTML[id];
      }
    }

    // 底座开关（单卡配置或全局配置任一为 true 即生效）
    const isGlobalNoBase = isTileNoBaseGlobal();
    if (cfg.noBase || isGlobalNoBase) {
      wrap.classList.add('is-nobase');
    } else {
      wrap.classList.remove('is-nobase');
    }
  }

  function isTileNoBaseGlobal() {
    return Boolean(Store.get('decor.tileNoBaseGlobal', false));
  }

  async function setTileNoBaseGlobal(enabled) {
    const val = Boolean(enabled);
    await Store.save('decor.tileNoBaseGlobal', val);
    // 刷新桌面所有图标的底座状态
    for (const def of TILE_DEFS) {
      if (def.canIcon) {
        // eslint-disable-next-line no-await-in-loop
        await applyTileIcon(def.id);
      }
    }
  }

  async function applyTile(id) {
    await applyTileBackground(id);
    await applyTileIcon(id);
  }

  async function applyAllTiles() {
    for (const def of TILE_DEFS) {
      // eslint-disable-next-line no-await-in-loop
      await applyTile(def.id);
    }
  }

// 保存卡片背景图（Blob 或 URL 字符串）
  async function setTileBackground(id, value) {
    const def = getTileDef(id);
    if (!def || def.canBg === false) return;
    await Storage.setAsset(DataRegistry.key.tileBg(id), value);
    await saveTileConfig(id, { hasBg: true });
    await applyTileBackground(id);
  }

  async function clearTileBackground(id) {
    const bgKey = DataRegistry.key.tileBg(id);
    await Storage.removeAsset(bgKey);
    revokeTileUrl(bgKey);
    await saveTileConfig(id, { hasBg: false });
    await applyTileBackground(id);
  }

  // 将当前卡片的背景图一键同步应用至全部支持背景的卡片
  async function applyTileBgToAll(sourceId) {
    const srcDef = getTileDef(sourceId);
    if (!srcDef || srcDef.canBg === false) return false;
    const srcKey = DataRegistry.key.tileBg(sourceId);
    const rawAsset = await Storage.getAssetRaw(srcKey);
    if (!rawAsset) return false;

    // 取得原始数据实体（Blob 或 URL 字符串）
    const assetPayload = (rawAsset.type === 'blob' && rawAsset.data)
      ? rawAsset.data
      : (rawAsset.url || rawAsset.data);

    if (!assetPayload) return false;

    const allConfigs = Object.assign({}, getTileConfigs());

    for (const def of TILE_DEFS) {
      if (def.id === sourceId || def.canBg === false) continue;
      const targetKey = DataRegistry.key.tileBg(def.id);
      // eslint-disable-next-line no-await-in-loop
      await Storage.setAsset(targetKey, assetPayload);
      allConfigs[def.id] = Object.assign({}, allConfigs[def.id] || {}, { hasBg: true });
    }

    allConfigs[sourceId] = Object.assign({}, allConfigs[sourceId] || {}, { hasBg: true });
    await Store.save('decor.tileConfigs', allConfigs);

    // 同步渲染桌面全部卡片的背景
    for (const def of TILE_DEFS) {
      if (def.canBg === false) continue;
      // eslint-disable-next-line no-await-in-loop
      await applyTileBackground(def.id);
    }
    return true;
  }

  // 保存图标图（Blob 或 URL 字符串）
  async function setTileIcon(id, value) {
    const def = getTileDef(id);
    if (!def || !def.canIcon) return;
    await Storage.setAsset(DataRegistry.key.tileIcon(id), value);
    await saveTileConfig(id, { hasIcon: true });
    await applyTileIcon(id);
  }

  async function clearTileIcon(id) {
    const iconKey = DataRegistry.key.tileIcon(id);
    await Storage.removeAsset(iconKey);
    revokeTileUrl(iconKey);
    await saveTileConfig(id, { hasIcon: false });
    await applyTileIcon(id);
  }

  async function setTileNoBase(id, enabled) {
    const def = getTileDef(id);
    if (!def || !def.canIcon) return;
    await saveTileConfig(id, { noBase: Boolean(enabled) });
    await applyTileIcon(id);
  }

  // 一键还原某张卡片的全部自定义
  async function clearTileAll(id) {
    await Storage.removeAsset(DataRegistry.key.tileBg(id));
    await Storage.removeAsset(DataRegistry.key.tileIcon(id));
    revokeTileUrl(DataRegistry.key.tileBg(id));
    revokeTileUrl(DataRegistry.key.tileIcon(id));
    const all = Object.assign({}, getTileConfigs());
    delete all[id];
    await Store.save('decor.tileConfigs', all);
    await applyTile(id);
  }

  // 恢复默认：清空全部 13 张卡片的背景、图标定制，并关闭全局去底座开关
  async function resetAllTiles() {
    for (const def of TILE_DEFS) {
      // eslint-disable-next-line no-await-in-loop
      await Storage.removeAsset(DataRegistry.key.tileBg(def.id));
      // eslint-disable-next-line no-await-in-loop
      await Storage.removeAsset(DataRegistry.key.tileIcon(def.id));
      revokeTileUrl(DataRegistry.key.tileBg(def.id));
      revokeTileUrl(DataRegistry.key.tileIcon(def.id));
    }
    // 清空所有磁贴配置
    await Store.save('decor.tileConfigs', {});
    // 关闭全局去底座
    await Store.save('decor.tileNoBaseGlobal', false);
    // 全量重绘桌面
    await applyAllTiles();
  }

  /* ---------------- 初始化 ---------------- */


  function init() {
    loadColors();
    applyAllColors();
    restoreWallpaper();
    restoreActiveFont();
  }

  return {
    COLOR_TOKENS,
    hexToRgb,
    rgbToHex,
    rgbToHsv,
    hsvToRgb,
    get colors() { return currentColors; },
    applyColor,
    saveColors,
    resetColors,
    setWallpaper,
    restoreWallpaper,
    clearWallpaper,
    renderWallpaper,
    isWallpaperMaskEnabled,
    setWallpaperMaskEnabled,
    isFrostedGlassEnabled,
    setFrostedGlassEnabled,
    applyFrostedGlass,
    addFont,
    removeFont,
    switchFont,
    getFontListMeta,
    getActiveFontId,
    restoreActiveFont,
    PRESET_FONTS,
    getPresetFont,
    getPresetPalettes,
    getCustomPalettes,
    getAllPalettes,
    saveCustomPalette,
    deleteCustomPalette,
    applyPalette,
    isMatchingPalette,
    getTileDefs,
    getTileDef,
    getTileConfig,
    applyTile,
    applyAllTiles,
    setTileBackground,
    clearTileBackground,
    applyTileBgToAll,
    setTileIcon,
    clearTileIcon,
    setTileNoBase,
    isTileNoBaseGlobal,
    setTileNoBaseGlobal,
    clearTileAll,
    resetAllTiles,
    init
  };
})();
// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.ThemeEngine 写法
window.ThemeEngine = ThemeEngine;

// 向注册表声明主题域在用的资产键：壁纸 + 全部已导入字体 + 磁贴美化图
DataRegistry.registerUsageProvider('theme', () => {
  const keys = [DataRegistry.key.wallpaper()];
  try {
    (ThemeEngine.getFontListMeta() || []).forEach((f) => {
      if (f && f.id) keys.push(DataRegistry.key.font(f.id));
    });
  } catch (e) { /* ignore */ }
  try {
    (ThemeEngine.getTileDefs() || []).forEach((t) => {
      if (!t || !t.id) return;
      const cfg = ThemeEngine.getTileConfig(t.id);
      if (cfg.hasBg) keys.push(DataRegistry.key.tileBg(t.id));
      if (cfg.hasIcon) keys.push(DataRegistry.key.tileIcon(t.id));
    });
  } catch (e) { /* ignore */ }
  return keys;
});