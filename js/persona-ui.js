/**
 * 溯流计划 · 个人档案系统 (Persona UI Controller)
 * 职责：
 *   1. 桌面 Bento「03 个人档案」点击推入 / 退出全屏视图
 *   2. 双轨分段切换（01 身份档案 vs 02 马甲库）
 *   3. 身份档案（本体）：立绘更换、基础凭证、外貌与核心设定数据读取与持久化保存
 *   4. 与桌面红卡只共享序列号，名字与照片各自独立
 *
 * 数据归属：执行员身份与马甲库都属 envoy 域，走 Store.envoy.*
 */
(() => {
  const ASSET_KEY_AVATAR = DataRegistry.key.personaAvatar();
  const ASSET_KEY_FACE_ID = DataRegistry.key.personaFaceId();

  // 默认核心档案沿用 Store 的定义，保持单一真相源
  const DEFAULT_IDENTITY = Store.DEFAULT_IDENTITY;

  // DOM 引用
  const personaPage = document.getElementById('personaPage');
  const personaBackBtn = document.getElementById('personaBackBtn');
  const personaSaveBtn = document.getElementById('personaSaveBtn');
  const personaCardBtn = document.querySelector('.bento-card[data-app="persona"]');

  // 双轨 Tab
  const tabIdentity = document.getElementById('tabIdentity');
  const tabMaskVault = document.getElementById('tabMaskVault');
  const panelIdentity = document.getElementById('panelIdentity');
  const panelMaskVault = document.getElementById('panelMaskVault');

  // 身份表单字段
  const avatarFrame = document.getElementById('personaAvatarFrame');
  const avatarImg = document.getElementById('personaAvatarImg');
  const avatarPlaceholder = document.getElementById('personaAvatarPlaceholder');
  const clearAvatarBtn = document.getElementById('personaClearAvatarBtn');
  const serialNoInput = document.getElementById('personaSerialNo');
  const nameInput = document.getElementById('personaNameInput');
  const genderInput = document.getElementById('personaGenderInput');
  const birthdayInput = document.getElementById('personaBirthdayInput');
  const appearanceInput = document.getElementById('personaAppearanceInput');
  const profileInput = document.getElementById('personaProfileInput');

  // 面部识别 (FACE ID) 字段
  const faceIdFrame = document.getElementById('personaFaceIdFrame');
  const faceIdImg = document.getElementById('personaFaceIdImg');
  const faceIdPlaceholder = document.getElementById('personaFaceIdPlaceholder');
  const faceIdStatus = document.getElementById('personaFaceIdStatus');
  const faceIdClearBtn = document.getElementById('personaFaceIdClearBtn');

  // 桌面红卡关联字段（仅序列号共享，那是全局唯一的身份编号；
  // 红卡的名字与照片都是独立装饰内容，由 profile.js 单独管理，这里不碰）
  const desktopSerial = document.getElementById('profileSerialNum');

  let currentAvatarSrc = null;
  let isOpen = false;

  /* ---------------- 数据读写 ---------------- */

  function loadIdentity() {
    return Object.assign({}, DEFAULT_IDENTITY, Store.envoy.identity || {});
  }

  /**
   * 保存身份档案（本体）。
   *
   * @param {Object} [opts]
   * @param {boolean} [opts.viaExit=false] 由退出流程触发。
   *        顶栏保存键那段「已保存」文字动画在退出时看不见（按钮跟着页面一起滑走），
   *        所以退出路径改走 Toast，手动点保存仍用按钮内联反馈，不弹 Toast 免得太碎。
   * @returns {Promise<boolean>} 是否写库成功。失败时已弹 Toast，
   *        调用方据此决定是否放行退出，避免存储写满时静默把人送走。
   */
  async function saveIdentity(opts) {
    const viaExit = !!(opts && opts.viaExit);
    const data = {
      // 编号不从表单取值：它是锁死的身份编号，Store 侧还有护栏兜底
      name: nameInput ? nameInput.value.trim() : DEFAULT_IDENTITY.name,
      gender: genderInput ? genderInput.value.trim() : DEFAULT_IDENTITY.gender,
      birthday: birthdayInput ? birthdayInput.value.trim() : '',
      appearance: appearanceInput ? appearanceInput.value.trim() : '',
      profile: profileInput ? profileInput.value.trim() : ''
    };

    const ok = await Store.save('envoy.identity', data);
    if (!ok) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'STORAGE // 写入失败',
          message: '身份档案保存失败',
          detail: '存储空间可能已满，本次修改未能固化。',
          type: 'error'
        });
      }
      return false;
    }

    // 编号可能被护栏改回真值，回填表单与红卡保持一致
    const serialNo = Store.getSerialNo();
    if (serialNoInput) serialNoInput.value = serialNo;
    if (desktopSerial) desktopSerial.textContent = `NO.${serialNo}`;

    if (viaExit) {
      // 退出即归档是隐式动作，必须给回执，否则用户无从判断存没存上
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'SAVED // 身份归档',
          message: `执行员「${data.name || '未命名'}」档案已保存`,
          type: 'success'
        });
      }
      return true;
    }

    // 手动点保存：按钮就在眼前，用内联反馈（保持 SVG 图标不被文字覆盖）
    if (personaSaveBtn) {
      const textSpan = personaSaveBtn.querySelector('span');
      if (textSpan) {
        const orig = textSpan.textContent;
        textSpan.textContent = '已保存';
        personaSaveBtn.style.opacity = '0.75';
        setTimeout(() => {
          textSpan.textContent = orig;
          personaSaveBtn.style.opacity = '';
        }, 1000);
      }
    }
    return true;
  }

  function fillForm(data) {
    if (serialNoInput) serialNoInput.value = data.serialNo || DEFAULT_IDENTITY.serialNo;
    if (nameInput) nameInput.value = data.name || '';
    if (genderInput) genderInput.value = data.gender || '';
    if (birthdayInput) birthdayInput.value = data.birthday || '';
    if (appearanceInput) appearanceInput.value = data.appearance || '';
    if (profileInput) profileInput.value = data.profile || '';
  }

  /* ---------------- 头像/立绘异步存取 ---------------- */

  function renderAvatar(src) {
    if (!avatarImg || !avatarPlaceholder) return;
    if (src) {
      avatarImg.src = src;
      avatarImg.style.display = 'block';
      avatarPlaceholder.style.display = 'none';
      // 清除按钮常驻占位，仅在无头像时转入弱化待命态
      if (clearAvatarBtn) clearAvatarBtn.classList.remove('is-idle');
    } else {
      avatarImg.removeAttribute('src');
      avatarImg.style.display = 'none';
      avatarPlaceholder.style.display = 'flex';
      if (clearAvatarBtn) clearAvatarBtn.classList.add('is-idle');
    }
  }

  async function clearAvatar() {
    renderAvatar(null);
    currentAvatarSrc = null;
    await Storage.removeAsset(ASSET_KEY_AVATAR);
  }

  async function restoreAvatar() {
    const src = await Storage.getAssetSrc(ASSET_KEY_AVATAR);
    if (src) {
      currentAvatarSrc = src;
      renderAvatar(src);
    } else {
      renderAvatar(null);
    }
    return src;
  }

  function openAvatarPicker() {
    ImagePicker.open({
      title: '更换头像 (2:3)',
      onSelect: async (res) => {
        if (res.type === 'file') {
          const tempUrl = URL.createObjectURL(res.file);
          renderAvatar(tempUrl);
          const compressed = await Storage.compressImage(res.file, 1200, 0.88);
          await Storage.setAsset(ASSET_KEY_AVATAR, compressed);
        } else if (res.type === 'url') {
          renderAvatar(res.url);
          await Storage.setAsset(ASSET_KEY_AVATAR, res.url);
        }
      }
    });
  }

  /* ---------------- 面部识别 (FACE ID) 异步存取 ---------------- */

  function renderFaceId(src) {
    if (!faceIdImg || !faceIdPlaceholder) return;
    if (src) {
      faceIdImg.src = src;
      faceIdImg.style.display = 'block';
      faceIdPlaceholder.style.display = 'none';
      if (faceIdStatus) {
        faceIdStatus.textContent = '已录入面容';
        faceIdStatus.classList.add('recorded');
      }
      if (faceIdClearBtn) faceIdClearBtn.classList.remove("is-idle");
    } else {
      faceIdImg.removeAttribute('src');
      faceIdImg.style.display = 'none';
      faceIdPlaceholder.style.display = 'flex';
      if (faceIdStatus) {
        faceIdStatus.textContent = '未录入面容';
        faceIdStatus.classList.remove('recorded');
      }
      if (faceIdClearBtn) faceIdClearBtn.classList.add("is-idle");
    }
  }

  async function restoreFaceId() {
    const src = await Storage.getAssetSrc(ASSET_KEY_FACE_ID);
    renderFaceId(src || null);
    return src;
  }

  function openFaceIdPicker() {
    ImagePicker.open({
      title: '录入面部识别 (1:1 垫图)',
      onSelect: async (res) => {
        if (res.type === 'file') {
          const tempUrl = URL.createObjectURL(res.file);
          renderFaceId(tempUrl);
          const compressed = await Storage.compressImage(res.file, 800, 0.9);
          await Storage.setAsset(ASSET_KEY_FACE_ID, compressed);
        } else if (res.type === 'url') {
          renderFaceId(res.url);
          await Storage.setAsset(ASSET_KEY_FACE_ID, res.url);
        }
      }
    });
  }

  async function clearFaceId() {
    renderFaceId(null);
    await Storage.removeAsset(ASSET_KEY_FACE_ID);
  }

  /* ---------------- 页面推入与退出 ---------------- */

  function open(opts) {
    if (isOpen) return;
    isOpen = true;
    const data = loadIdentity();
    fillForm(data);
    restoreAvatar();
    restoreFaceId();

    if (personaPage) personaPage.classList.add('active');
    document.body.classList.add('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.add('keyboard-hidden');

    // skipHistory：调用方已经把路由指向 #persona，不再重复压栈
    if (opts && opts.skipHistory) return;

    try {
      history.pushState({ rfPage: 'persona' }, '', '#persona');
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * 关闭整页回桌面。退出即归档：本体与马甲都在这里落定。
   *
   * 顺序上先收马甲、再存本体：马甲详情态时 close() 会被物理返回键或路由
   * 直接调到，那一层必须先归档掉。
   *
   * 本体是单例档案，无条件存一遍就好——加脏值追踪反而是过度设计，
   * 一次 Store.save 的成本远低于漏存的代价（表单改过又切去马甲库的情况）。
   * 但 Toast 只在停留于身份档案 Tab 时弹：从马甲库退出时马甲自己已经弹过，
   * 一次返回连弹两个反而看不清哪个是哪个。
   *
   * @returns {Promise<boolean>} 是否真的关掉了页面
   */
  async function close() {
    if (!isOpen) return false;

    // 物理返回键与路由也可能在马甲详情态直接调 close()，
    // 这里补一次归档，避免绕过顶栏返回把编辑内容丢掉。
    if (isMaskEditing) {
      await leaveMaskWithSave();
      // 马甲归档没过（将来加校验时会出现），留在详情页别把人送走
      if (isMaskEditing) return false;
    }

    // 本体归档。写库失败（存储写满）时留在页面，不静默丢数据。
    const stayingOnIdentity = isIdentityTab();
    const savedIdentity = await saveIdentity({ viaExit: stayingOnIdentity });
    if (!savedIdentity) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'PERSONA // 退出中止',
          message: '归档未完成，已留在个人档案',
          detail: '请检查存储空间后重试，避免本次编辑内容丢失',
          type: 'error'
        });
      }
      return false;
    }

    isOpen = false;
    if (personaPage) personaPage.classList.remove('active');
    document.body.classList.remove('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.remove('keyboard-hidden');

    const hash = window.location.hash || '';
    if (hash === '#persona') {
      try {
        history.back();
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* ---------------- 双轨切换 ---------------- */

  async function switchTab(target) {
    // 从马甲详情态切回身份档案 Tab 也算离开详情，同样要归档，
    // 否则「退出即保存」在这条路径上失效。必须在切可见性之前 await。
    if (isMaskEditing) {
      await leaveMaskWithSave();
      // 归档没过（将来加校验时会出现），留在详情页，取消这次切换
      if (isMaskEditing) return;
    }

    if (target === 'identity') {
      if (tabIdentity) { tabIdentity.classList.add('active'); tabIdentity.setAttribute('aria-selected', 'true'); }
      if (tabMaskVault) { tabMaskVault.classList.remove('active'); tabMaskVault.setAttribute('aria-selected', 'false'); }
      if (panelMaskVault) panelMaskVault.hidden = true;
      if (panelIdentity) {
        panelIdentity.hidden = false;
        Motion.replay(panelIdentity);
      }
      if (personaSaveBtn) personaSaveBtn.hidden = false;
    } else {
      if (tabIdentity) { tabIdentity.classList.remove('active'); tabIdentity.setAttribute('aria-selected', 'false'); }
      if (tabMaskVault) { tabMaskVault.classList.add('active'); tabMaskVault.setAttribute('aria-selected', 'true'); }
      if (panelIdentity) panelIdentity.hidden = true;
      if (panelMaskVault) {
        panelMaskVault.hidden = false;
        Motion.replay(panelMaskVault);
      }
      if (personaSaveBtn) personaSaveBtn.hidden = true;
      renderMaskList();
    }
  }

  /* ---------------- ========================================== ---------------- */
  /* ---------------- 02 马甲库 (Mask Vault) 模块实现 ---------------- */
  /* ---------------- ========================================== ---------------- */

  const ASSET_PREFIX_MASK_AVATAR = DataRegistry.prefix.maskAvatar;
  const ASSET_PREFIX_MASK_FACE_ID = DataRegistry.prefix.maskFaceId;

  // 马甲库 DOM 引用
  const maskVaultListView = document.getElementById('maskVaultListView');
  const maskVaultEditView = document.getElementById('maskVaultEditView');
  const maskVaultList = document.getElementById('maskVaultList');
  const maskVaultEmpty = document.getElementById('maskVaultEmpty');
  const maskVaultCount = document.getElementById('maskVaultCount');
  const maskVaultCreateBtn = document.getElementById('maskVaultCreateBtn');

  // 马甲详情 DOM 引用：返回/保存/删除已收进顶栏烤串
  const maskKebabWrap = document.getElementById('maskKebabWrap');
  const maskMoreBtn = document.getElementById('maskMoreBtn');
  const maskMenuPopover = document.getElementById('maskMenuPopover');
  // 删除项保留原变量名，让既有的 hidden = true/false 新建态逻辑无需改动
  const maskEditDeleteBtn = document.getElementById('maskMenuDestroyBtn');

  const maskAvatarFrame = document.getElementById('maskAvatarFrame');
  const maskAvatarImg = document.getElementById('maskAvatarImg');
  const maskAvatarPlaceholder = document.getElementById('maskAvatarPlaceholder');
  const maskClearAvatarBtn = document.getElementById('maskClearAvatarBtn');
  const maskForgeAvatarBtn = document.getElementById('maskForgeAvatarBtn');

  const maskSerialNoInput = document.getElementById('maskSerialNoInput');
  const maskNameInput = document.getElementById('maskNameInput');
  const maskGenderInput = document.getElementById('maskGenderInput');
  const maskBirthdayWrap = document.getElementById('maskBirthdayWrap');
  const maskBirthdayInput = document.getElementById('maskBirthdayInput');

  const maskFaceIdFrame = document.getElementById('maskFaceIdFrame');
  const maskFaceIdImg = document.getElementById('maskFaceIdImg');
  const maskFaceIdPlaceholder = document.getElementById('maskFaceIdPlaceholder');
  const maskFaceIdStatus = document.getElementById('maskFaceIdStatus');
  const maskFaceIdClearBtn = document.getElementById('maskFaceIdClearBtn');

  const maskAppearanceInput = document.getElementById('maskAppearanceInput');
  const maskAppearanceExpandBtn = document.getElementById('maskAppearanceExpandBtn');
  const maskProfileInput = document.getElementById('maskProfileInput');
  const maskProfileExpandBtn = document.getElementById('maskProfileExpandBtn');

  // 当前正在编辑的马甲状态
  let currentEditingMaskId = null; // null 表示新建，string 表示已有马甲的 id
  let currentMaskAvatarPending = null; // 暂存立绘资源（Blob / URL / null）
  let currentMaskAvatarSrc = null; // 暂存立绘预览 URL
  let currentMaskFaceIdPending = null; // 暂存面容参考图资源
  let currentMaskFaceIdSrc = null; // 暂存面容参考图预览 URL
  let isMaskAvatarDirty = false; // 是否修改了头像
  let isMaskFaceIdDirty = false; // 是否修改了面容

  function loadMasks() {
    return (Store.envoy.masks || []).slice();
  }

  function saveMasksList(list) {
    return Store.save('envoy.masks', list || []);
  }

  function generateMaskId() {
    return 'mask_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function getNextMaskSerial(list) {
    const nextNum = (list ? list.length : 0) + 1;
    return nextNum < 10 ? '0' + nextNum : String(nextNum);
  }

  /* ---------------- 马甲列表渲染 ---------------- */

  async function renderMaskList() {
    if (!maskVaultList) return;
    const masks = loadMasks();

    if (maskVaultCount) maskVaultCount.textContent = masks.length;

    if (masks.length === 0) {
      maskVaultList.innerHTML = '';
      if (maskVaultEmpty) maskVaultEmpty.hidden = false;
      return;
    }

    if (maskVaultEmpty) maskVaultEmpty.hidden = true;
    maskVaultList.innerHTML = '';

    for (let i = 0; i < masks.length; i++) {
      const mask = masks[i];
      const card = document.createElement('div');
      card.className = 'mask-vault-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.dataset.maskId = mask.id;

      // 异步读取该马甲的立绘与 FACE ID 状态
      const avatarSrc = await Storage.getAssetSrc(ASSET_PREFIX_MASK_AVATAR + mask.id);
      const faceIdSrc = await Storage.getAssetSrc(ASSET_PREFIX_MASK_FACE_ID + mask.id);

      const nameText = mask.name || '未命名伪装';
      const serialText = `NO.${mask.serialNo || ('0' + (i + 1))}`;

      const avatarHtml = avatarSrc
        ? `<img class="mask-card-img" src="${avatarSrc}" alt="${nameText}">`
        : `<div class="mask-card-placeholder">
             <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
             <span>MASK</span>
           </div>`;

      const faceBadgeHtml = faceIdSrc
        ? `<span class="mask-card-face-tag" title="已挂载独立 FACE ID 锁脸">FACE ID</span>`
        : '';

      card.innerHTML = `
        <div class="mask-card-photo-col">
          <div class="mask-card-frame">
            ${avatarHtml}
            ${faceBadgeHtml}
          </div>
          <div class="mask-card-seal" aria-hidden="true">
            <svg viewBox="0 0 60 8" preserveAspectRatio="none">
              <rect x="0" y="0" width="3" height="8" fill="currentColor"/>
              <rect x="4" y="0" width="2" height="8" fill="currentColor"/>
              <rect x="7" y="0" width="5" height="8" fill="currentColor"/>
              <rect x="13" y="0" width="2" height="8" fill="currentColor"/>
              <rect x="16" y="0" width="4" height="8" fill="currentColor"/>
              <rect x="22" y="0" width="3" height="8" fill="currentColor"/>
              <rect x="27" y="0" width="6" height="8" fill="currentColor"/>
              <rect x="35" y="0" width="2" height="8" fill="currentColor"/>
              <rect x="39" y="0" width="4" height="8" fill="currentColor"/>
              <rect x="45" y="0" width="2" height="8" fill="currentColor"/>
              <rect x="49" y="0" width="5" height="8" fill="currentColor"/>
              <rect x="56" y="0" width="4" height="8" fill="currentColor"/>
            </svg>
          </div>
        </div>
        <div class="mask-card-info-col">
          <span class="mask-card-serial">${serialText}</span>
          <span class="mask-card-name" title="${nameText}">${nameText}</span>
        </div>
      `;

      card.addEventListener('click', () => openMaskDetail(mask.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openMaskDetail(mask.id);
        }
      });

      maskVaultList.appendChild(card);
    }
  }

  /* ---------------- 马甲立绘与面容渲染（详情态） ---------------- */

  function renderMaskAvatar(src) {
    if (!maskAvatarImg || !maskAvatarPlaceholder) return;
    if (src) {
      maskAvatarImg.src = src;
      maskAvatarImg.style.display = 'block';
      maskAvatarPlaceholder.style.display = 'none';
      // 清除按钮常驻占位，仅在无立绘时转入弱化待命态
      if (maskClearAvatarBtn) maskClearAvatarBtn.classList.remove('is-idle');
    } else {
      maskAvatarImg.removeAttribute('src');
      maskAvatarImg.style.display = 'none';
      maskAvatarPlaceholder.style.display = 'flex';
      if (maskClearAvatarBtn) maskClearAvatarBtn.classList.add('is-idle');
    }
  }

  function renderMaskFaceId(src) {
    if (!maskFaceIdImg || !maskFaceIdPlaceholder) return;
    if (src) {
      maskFaceIdImg.src = src;
      maskFaceIdImg.style.display = 'block';
      maskFaceIdPlaceholder.style.display = 'none';
      if (maskFaceIdStatus) {
        maskFaceIdStatus.textContent = '已录入面容';
        maskFaceIdStatus.classList.add('recorded');
      }
      if (maskFaceIdClearBtn) maskFaceIdClearBtn.classList.remove("is-idle");
    } else {
      maskFaceIdImg.removeAttribute('src');
      maskFaceIdImg.style.display = 'none';
      maskFaceIdPlaceholder.style.display = 'flex';
      if (maskFaceIdStatus) {
        maskFaceIdStatus.textContent = '未录入面容';
        maskFaceIdStatus.classList.remove('recorded');
      }
      if (maskFaceIdClearBtn) maskFaceIdClearBtn.classList.add("is-idle");
    }
  }

  /* ---------------- 马甲详情打开与表单装填 ---------------- */

  async function openMaskDetail(maskId) {
    currentEditingMaskId = maskId;
    isMaskAvatarDirty = false;
    isMaskFaceIdDirty = false;
    currentMaskAvatarPending = null;
    currentMaskAvatarSrc = null;
    currentMaskFaceIdPending = null;
    currentMaskFaceIdSrc = null;
    if (maskVaultListView) maskVaultListView.hidden = true;
    if (maskVaultEditView) {
      maskVaultEditView.hidden = false;
      Motion.replay(maskVaultEditView);
    }

    // 顶栏切到详情形态：亮烤串、收走身份档案的保存键
    setMaskEditing(true);

    if (!maskId) {
      // 新建马甲
      const masks = loadMasks();
      if (maskSerialNoInput) maskSerialNoInput.value = getNextMaskSerial(masks);
      if (maskNameInput) maskNameInput.value = '';
      if (maskGenderInput) maskGenderInput.value = '';
      if (maskBirthdayInput) maskBirthdayInput.value = '';
      if (maskAppearanceInput) maskAppearanceInput.value = '';
      if (maskProfileInput) maskProfileInput.value = '';

      renderMaskAvatar(null);
      renderMaskFaceId(null);
      if (maskEditDeleteBtn) maskEditDeleteBtn.hidden = true;
    } else {
      // 编辑已有马甲
      const masks = loadMasks();
      const mask = masks.find(m => m.id === maskId);
      if (!mask) {
        closeMaskDetail();
        return;
      }

      if (maskSerialNoInput) maskSerialNoInput.value = mask.serialNo || '';
      if (maskNameInput) maskNameInput.value = mask.name || '';
      if (maskGenderInput) maskGenderInput.value = mask.gender || '';
      if (maskBirthdayInput) maskBirthdayInput.value = mask.birthday || '';
      if (maskAppearanceInput) maskAppearanceInput.value = mask.appearance || '';
      if (maskProfileInput) maskProfileInput.value = mask.profile || '';

      const avatarSrc = await Storage.getAssetSrc(ASSET_PREFIX_MASK_AVATAR + maskId);
      currentMaskAvatarSrc = avatarSrc;
      renderMaskAvatar(avatarSrc);

      const faceIdSrc = await Storage.getAssetSrc(ASSET_PREFIX_MASK_FACE_ID + maskId);
      currentMaskFaceIdSrc = faceIdSrc;
      renderMaskFaceId(faceIdSrc);

      if (maskEditDeleteBtn) maskEditDeleteBtn.hidden = false;
    }
  }

  function closeMaskDetail() {
    if (maskVaultEditView) maskVaultEditView.hidden = true;
    if (maskVaultListView) {
      maskVaultListView.hidden = false;
      Motion.replay(maskVaultListView);
    }
    currentEditingMaskId = null;
    // 顶栏退回列表形态：熄灭烤串并收起可能还开着的冒泡
    setMaskEditing(false);
    renderMaskList();
  }

  /* ---------------- 保存马甲 ---------------- */

  async function saveMaskDetail() {
    const masks = loadMasks();
    const isNew = !currentEditingMaskId;
    const maskId = isNew ? generateMaskId() : currentEditingMaskId;

    const data = {
      id: maskId,
      serialNo: maskSerialNoInput ? maskSerialNoInput.value.trim() : (isNew ? getNextMaskSerial(masks) : '01'),
      name: maskNameInput ? maskNameInput.value.trim() : '',
      gender: maskGenderInput ? maskGenderInput.value.trim() : '',
      birthday: maskBirthdayInput ? maskBirthdayInput.value.trim() : '',
      appearance: maskAppearanceInput ? maskAppearanceInput.value.trim() : '',
      profile: maskProfileInput ? maskProfileInput.value.trim() : '',
      updatedAt: Date.now()
    };

    if (isNew) {
      data.createdAt = Date.now();
      masks.push(data);
    } else {
      const idx = masks.findIndex(m => m.id === maskId);
      if (idx !== -1) {
        data.createdAt = masks[idx].createdAt || Date.now();
        masks[idx] = data;
      } else {
        masks.push(data);
      }
    }

    await saveMasksList(masks);

    // 处理立绘图片存储
    if (isMaskAvatarDirty) {
      if (currentMaskAvatarPending) {
        await Storage.setAsset(ASSET_PREFIX_MASK_AVATAR + maskId, currentMaskAvatarPending);
      } else {
        await Storage.removeAsset(ASSET_PREFIX_MASK_AVATAR + maskId);
      }
    }

    // 处理面容识别图片存储
    if (isMaskFaceIdDirty) {
      if (currentMaskFaceIdPending) {
        await Storage.setAsset(ASSET_PREFIX_MASK_FACE_ID + maskId, currentMaskFaceIdPending);
      } else {
        await Storage.removeAsset(ASSET_PREFIX_MASK_FACE_ID + maskId);
      }
    }

    // 新建马甲落库后必须把编辑态锚到这条记录上。
    // 原先靠 600ms 后自动跳回列表掩盖了这点，现在保存不跳页，
    // 不回写 id 的话连点两次「保存马甲」会生出两条重复记录。
    if (isNew) {
      currentEditingMaskId = maskId;
      if (maskEditDeleteBtn) maskEditDeleteBtn.hidden = false;
      // 图片已落到正式键上，脏标记归零，避免重复写库
      isMaskAvatarDirty = false;
      isMaskFaceIdDirty = false;
    }

    // 触发保存反馈。原来这里借保存按钮做「已保存」文字动画并在 600ms 后
    // 自动跳回列表，现在按钮已收进烤串，改为 Toast 反馈且不自动跳转——
    // 跳转由调用方（顶栏返回）决定，菜单点完页面自己跳走会很突兀。
    if (window.RetroToast) {
      RetroToast.show({
        tag: 'SAVED // 马甲归档',
        message: `伪装身份「${data.name || '未命名马甲'}」已保存`,
        type: 'success'
      });
    }
    return true;
  }

  /* ---------------- 马甲详情态：烤串菜单与退出即保存 ---------------- */

  // 详情态标记：false=马甲列表态或身份档案 Tab。顶栏返回与烤串靠它分发。
  // 用状态位而非读 DOM 的 hidden，与同调档案同一口径。
  let isMaskEditing = false;

  // 退出归档进行中：拦住重复点返回导致的并发写库
  let isLeavingMask = false;

  /**
   * 进入/退出马甲详情态时同步顶栏：
   * 详情态显示烤串、藏起身份档案那个「保存」按钮，两者不同时出现。
   */
  function setMaskEditing(on) {
    isMaskEditing = !!on;
    if (maskKebabWrap) maskKebabWrap.hidden = !isMaskEditing;
    // 详情态下身份档案的保存键必须让位，否则顶栏右侧会挤两个动作
    if (personaSaveBtn) personaSaveBtn.hidden = isMaskEditing || !isIdentityTab();
    if (!isMaskEditing) closeMaskMenu();
  }

  /** 当前是否停在 01 身份档案 Tab */
  function isIdentityTab() {
    return !!(panelIdentity && !panelIdentity.hidden);
  }

  function closeMaskMenu() {
    if (!maskMenuPopover) return;
    maskMenuPopover.hidden = true;
    maskMenuPopover.setAttribute('aria-hidden', 'true');
    if (maskMoreBtn) {
      maskMoreBtn.classList.remove('is-active');
      maskMoreBtn.setAttribute('aria-expanded', 'false');
    }
  }

  function openMaskMenu() {
    if (!maskMenuPopover) return;
    maskMenuPopover.hidden = false;
    maskMenuPopover.setAttribute('aria-hidden', 'false');
    if (maskMoreBtn) {
      maskMoreBtn.classList.add('is-active');
      maskMoreBtn.setAttribute('aria-expanded', 'true');
    }
  }

  function toastMask(tag, message, detail, type) {
    if (!window.RetroToast) return;
    RetroToast.show({ tag, message, detail: detail || '', type: type || 'info' });
  }

  /**
   * 当前是否为「尚未落库的空白新建马甲」。
   * 点进「新建马甲」却什么都没填就退出时不该凭空生出一条无名马甲。
   * 只看名字：只传了图却没名字的条目留着也无意义。
   */
  function isBlankMaskDraft() {
    if (!isMaskEditing) return false;
    if (currentEditingMaskId) return false;
    return !(maskNameInput && maskNameInput.value.trim());
  }

  /**
   * 马甲详情退出：退出即归档。
   * saveMaskDetail 无校验分支、必然成功，但仍按同调档案的口径等写库结果，
   * 保持三个页面行为一致，也为将来加校验留好位置。
   */
  async function leaveMaskWithSave() {
    if (!isMaskEditing) return;
    if (isLeavingMask) return;
    isLeavingMask = true;
    if (personaBackBtn) personaBackBtn.disabled = true;

    try {
      if (isBlankMaskDraft()) {
        closeMaskDetail();
        return;
      }
      const saved = await saveMaskDetail();
      if (saved === false) {
        toastMask('EDITOR // 退出中止', '归档未完成，已留在编辑页', '请按提示修正后重试，避免本次编辑内容丢失', 'error');
        return;
      }
      closeMaskDetail();
    } finally {
      isLeavingMask = false;
      if (personaBackBtn) personaBackBtn.disabled = false;
    }
  }

  if (maskMoreBtn) {
    maskMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (maskMenuPopover && maskMenuPopover.hidden) openMaskMenu();
      else closeMaskMenu();
    });
  }

  if (maskMenuPopover) {
    maskMenuPopover.addEventListener('click', (e) => {
      const item = e.target.closest('.retro-kebab-item');
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.action;
      closeMaskMenu();

      switch (action) {
        case 'save':
          // 保存留在原地，不自动跳走
          Promise.resolve(saveMaskDetail()).catch((err) => {
            console.warn('[Persona] 马甲归档异常：', err);
          });
          break;
        case 'ai-assist':
          toastMask('AI // 写作助手', '智能推演准备中', 'AI 辅助生成马甲设定功能即将接入', 'info');
          break;
        case 'export-json':
          toastMask('IO // 导出JSON', '导出通道准备中', '马甲档案导出功能即将接入', 'info');
          break;
        case 'import-override':
          toastMask('IO // 导入覆盖', '导入通道准备中', '马甲档案导入功能即将接入', 'info');
          break;
        case 'destroy':
          Promise.resolve(deleteMaskDetail()).catch((err) => {
            console.warn('[Persona] 销毁马甲异常：', err);
          });
          break;
        default:
          break;
      }
    });
  }

  // 轻触外部空白收起菜单
  document.addEventListener('click', (e) => {
    if (!maskMenuPopover || maskMenuPopover.hidden) return;
    if (maskMenuPopover.contains(e.target)) return;
    if (maskMoreBtn && maskMoreBtn.contains(e.target)) return;
    closeMaskMenu();
  });

  /* ---------------- 删除马甲 ---------------- */

  async function deleteMaskDetail() {
    if (!currentEditingMaskId) return;

    const masks = loadMasks();
    const target = masks.find(m => m.id === currentEditingMaskId);
    const maskName = target ? (target.name || '该马甲') : '该马甲';

    const ok = await RetroModal.confirm({
      message: `确认要销毁伪装马甲「${maskName}」吗？`,
      detail: '该马甲的专属头像与独立面容数据将被同时物理抹除，其名下线上马甲账号的通讯录、聊天记录与朋友圈也将一并删除，无法恢复。',
      confirmText: '确认销毁',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;

    // 级联清除该马甲名下的线上马甲账号数据。
    // 放在马甲本体删除前：purgeByAccountId 需要账号仍可被 listAccounts 解析出来。
    try {
      if (window.OnlineStore && typeof OnlineStore.purgeByAccountId === 'function') {
        const stat = await OnlineStore.purgeByAccountId(currentEditingMaskId);
        if (stat && (stat.contacts > 0 || stat.records > 0)) {
          console.log(`[Persona] 已级联清除线上马甲账号数据：联系人 ${stat.contacts} / 消息 ${stat.records}`);
        }
      }
    } catch (e) {
      console.warn('[Persona] 清理线上马甲账号数据失败:', e);
    }

    const filtered = masks.filter(m => m.id !== currentEditingMaskId);
    await saveMasksList(filtered);

    // 清理关联资产
    await Storage.removeAsset(ASSET_PREFIX_MASK_AVATAR + currentEditingMaskId);
    await Storage.removeAsset(ASSET_PREFIX_MASK_FACE_ID + currentEditingMaskId);

    closeMaskDetail();
  }

  /* ---------------- 马甲立绘与面容选择/清除/生图 ---------------- */

  function pickMaskAvatar() {
    ImagePicker.open({
      title: '更换马甲头像 (2:3)',
      onSelect: async (res) => {
        isMaskAvatarDirty = true;
        if (res.type === 'file') {
          const tempUrl = URL.createObjectURL(res.file);
          renderMaskAvatar(tempUrl);
          currentMaskAvatarSrc = tempUrl;
          currentMaskAvatarPending = await Storage.compressImage(res.file, 1200, 0.88);
        } else if (res.type === 'url') {
          renderMaskAvatar(res.url);
          currentMaskAvatarSrc = res.url;
          currentMaskAvatarPending = res.url;
        }
      }
    });
  }

  function clearMaskAvatar() {
    isMaskAvatarDirty = true;
    currentMaskAvatarPending = null;
    currentMaskAvatarSrc = null;
    renderMaskAvatar(null);
  }

  function pickMaskFaceId() {
    ImagePicker.open({
      title: '录入马甲独立面容 (1:1 垫图)',
      onSelect: async (res) => {
        isMaskFaceIdDirty = true;
        if (res.type === 'file') {
          const tempUrl = URL.createObjectURL(res.file);
          renderMaskFaceId(tempUrl);
          currentMaskFaceIdSrc = tempUrl;
          currentMaskFaceIdPending = await Storage.compressImage(res.file, 800, 0.9);
        } else if (res.type === 'url') {
          renderMaskFaceId(res.url);
          currentMaskFaceIdSrc = res.url;
          currentMaskFaceIdPending = res.url;
        }
      }
    });
  }

  function clearMaskFaceId() {
    isMaskFaceIdDirty = true;
    currentMaskFaceIdPending = null;
    currentMaskFaceIdSrc = null;
    renderMaskFaceId(null);
  }

  // 唤起绘像工坊生成马甲头像
  async function forgeMaskAvatar() {
    if (!window.AvatarForge) return;
    const appearance = maskAppearanceInput ? maskAppearanceInput.value.trim() : '';
    let faceIdSrc = currentMaskFaceIdSrc;
    if (!faceIdSrc && currentEditingMaskId) {
      faceIdSrc = await Storage.getAssetSrc(ASSET_PREFIX_MASK_FACE_ID + currentEditingMaskId);
    }

    window.AvatarForge.open({
      prompt: '',
      source: 'mask',
      appearance: appearance,
      faceIdSrc: faceIdSrc || null,
      onApply: async (storableAsset, displaySrc) => {
        isMaskAvatarDirty = true;
        currentMaskAvatarPending = storableAsset;
        currentMaskAvatarSrc = displaySrc;
        renderMaskAvatar(displaySrc);
      }
    });
  }

  // 马甲诞生日选择
  async function handlePickMaskBirthday() {
    const currentVal = maskBirthdayInput ? maskBirthdayInput.value : '';
    const picked = await DatePickerModal.pick({
      value: currentVal,
      title: '选择伪装诞生日'
    });
    if (picked !== null && maskBirthdayInput) {
      maskBirthdayInput.value = picked;
    }
  }

  // 马甲全屏文本编辑
  async function openMaskTextEditor(fieldKey) {
    if (fieldKey === 'appearance') {
      const current = maskAppearanceInput ? maskAppearanceInput.value : '';
      const updated = await TextEditorModal.open({
        title: '伪装外貌编辑',
        tag: 'APPEARANCE // 伪装外貌',
        value: current,
        placeholder: '描述该身份的外貌特征、服饰风格等...',
        maxLength: 3000
      });
      if (updated !== null && maskAppearanceInput) {
        maskAppearanceInput.value = updated;
      }
    } else if (fieldKey === 'profile') {
      const current = maskProfileInput ? maskProfileInput.value : '';
      const updated = await TextEditorModal.open({
        title: '身份背景编辑',
        tag: 'PROFILE SETTING // 身份背景',
        value: current,
        placeholder: '描述该身份的背景经历、动机与设定...',
        maxLength: 5000
      });
      if (updated !== null && maskProfileInput) {
        maskProfileInput.value = updated;
      }
    }
  }

  /* ---------------- 全屏长文本编辑接入 ---------------- */

  async function openTextEditor(fieldKey) {
    if (fieldKey === 'appearance') {
      const current = appearanceInput ? appearanceInput.value : '';
      const updated = await TextEditorModal.open({
        title: '外貌特征编辑',
        tag: 'APPEARANCE // 外貌形象',
        value: current,
        placeholder: '详细描述外貌形象（发型发色、瞳色、身高体态、着装习惯等等）...',
        maxLength: 3000
      });
      if (updated !== null && appearanceInput) {
        appearanceInput.value = updated;
      }
    } else if (fieldKey === 'profile') {
      const current = profileInput ? profileInput.value : '';
      const updated = await TextEditorModal.open({
        title: '核心设定编辑',
        tag: 'PROFILE SETTING // 身份设定',
        value: current,
        placeholder: '详细描述身份背景、性格气质、行事准则、喜好习惯、核心羁绊等等...',
        maxLength: 5000
      });
      if (updated !== null && profileInput) {
        profileInput.value = updated;
      }
    }
  }

  const personaAppearanceExpandBtn = document.getElementById('personaAppearanceExpandBtn');
  if (personaAppearanceExpandBtn) {
    personaAppearanceExpandBtn.addEventListener('click', () => openTextEditor('appearance'));
  }

  const personaProfileExpandBtn = document.getElementById('personaProfileExpandBtn');
  if (personaProfileExpandBtn) {
    personaProfileExpandBtn.addEventListener('click', () => openTextEditor('profile'));
  }

  if (appearanceInput) {
    appearanceInput.addEventListener('dblclick', () => openTextEditor('appearance'));
  }

  if (profileInput) {
    profileInput.addEventListener('dblclick', () => openTextEditor('profile'));
  }

  /* ---------------- 事件绑定 ---------------- */

  // 诞生日点击/选择交互：唤起机能日期选择弹窗
  async function handlePickBirthday() {
    const currentVal = personaBirthdayInput ? personaBirthdayInput.value : '';
    const picked = await DatePickerModal.pick({
      value: currentVal,
      title: '选择诞生日'
    });

    if (picked !== null && personaBirthdayInput) {
      personaBirthdayInput.value = picked;
    }
  }
  // 生日整框可点：交互统一由 wrap 承载，input 为只读投影不单独绑定


  const personaBirthdayWrap = document.getElementById('personaBirthdayWrap');
  if (personaBirthdayWrap) {
    personaBirthdayWrap.addEventListener('click', handlePickBirthday);
    // 键盘可达性：Enter / 空格同样可唤起
    personaBirthdayWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlePickBirthday();
      }
    });
  }

  if (personaCardBtn) {
    // 显式包一层：避免把 MouseEvent 当作 open 的 opts 传入
    personaCardBtn.addEventListener('click', () => open());
  }

  if (personaBackBtn) {
    personaBackBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // 层级语义：马甲详情态只退一层回列表（并归档），其余情况才关整页回桌面
      if (isMaskEditing) {
        Promise.resolve(leaveMaskWithSave()).catch((err) => {
          console.warn('[Persona] 马甲详情退出异常：', err);
        });
        return;
      }
      Promise.resolve(close()).catch((err) => {
        console.warn('[Persona] 关闭个人档案异常：', err);
      });
    });
  }

  if (personaSaveBtn) {
    // 包一层：否则 MouseEvent 会被当作 saveIdentity 的 opts 传进去，
    // opts.viaExit 恰好是 undefined 所以现在不出错，但这是个定时炸弹
    personaSaveBtn.addEventListener('click', () => {
      Promise.resolve(saveIdentity()).catch((err) => {
        console.warn('[Persona] 身份档案归档异常：', err);
      });
    });
  }

  if (avatarFrame) {
    avatarFrame.addEventListener('click', openAvatarPicker);
    avatarFrame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openAvatarPicker();
      }
    });
  }

  if (clearAvatarBtn) {
    clearAvatarBtn.addEventListener('click', clearAvatar);
  }

  // 面部识别事件绑定
  if (faceIdFrame) {
    faceIdFrame.addEventListener('click', openFaceIdPicker);
    faceIdFrame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openFaceIdPicker();
      }
    });
  }

  if (faceIdClearBtn) {
    faceIdClearBtn.addEventListener('click', clearFaceId);
  }

  /* ---------------- 马甲库事件绑定 ---------------- */
  if (maskVaultCreateBtn) {
    maskVaultCreateBtn.addEventListener('click', () => openMaskDetail(null));
  }

  // 马甲的返回/保存/销毁已全部收进顶栏烤串，这里不再有独立动作条按钮。
  // 事件接线见上方「马甲详情态：烤串菜单与退出即保存」一节。


  if (maskAvatarFrame) {
    maskAvatarFrame.addEventListener('click', pickMaskAvatar);
    maskAvatarFrame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pickMaskAvatar();
      }
    });
  }

  if (maskClearAvatarBtn) {
    maskClearAvatarBtn.addEventListener('click', clearMaskAvatar);
  }

  if (maskForgeAvatarBtn) {
    maskForgeAvatarBtn.addEventListener('click', forgeMaskAvatar);
  }

  if (maskFaceIdFrame) {
    maskFaceIdFrame.addEventListener('click', pickMaskFaceId);
    maskFaceIdFrame.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pickMaskFaceId();
      }
    });
  }

  if (maskFaceIdClearBtn) {
    maskFaceIdClearBtn.addEventListener('click', clearMaskFaceId);
  }

  if (maskBirthdayWrap) {
    maskBirthdayWrap.addEventListener('click', handlePickMaskBirthday);
    maskBirthdayWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handlePickMaskBirthday();
      }
    });
  }

  if (maskAppearanceExpandBtn) {
    maskAppearanceExpandBtn.addEventListener('click', () => openMaskTextEditor('appearance'));
  }

  if (maskProfileExpandBtn) {
    maskProfileExpandBtn.addEventListener('click', () => openMaskTextEditor('profile'));
  }

  if (maskAppearanceInput) {
    maskAppearanceInput.addEventListener('dblclick', () => openMaskTextEditor('appearance'));
  }

  if (maskProfileInput) {
    maskProfileInput.addEventListener('dblclick', () => openMaskTextEditor('profile'));
  }

  if (tabIdentity) {
    tabIdentity.addEventListener('click', () => {
      Promise.resolve(switchTab('identity')).catch((err) => {
        console.warn('[Persona] 切换身份档案异常：', err);
      });
    });
  }
  if (tabMaskVault) {
    tabMaskVault.addEventListener('click', () => {
      Promise.resolve(switchTab('vault')).catch((err) => {
        console.warn('[Persona] 切换马甲库异常：', err);
      });
    });
  }

  // ESC 键退出：与顶栏返回同一层级语义，详情态只退一层
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      if (isMaskEditing) {
        Promise.resolve(leaveMaskWithSave()).catch((err) => {
          console.warn('[Persona] 马甲详情退出异常：', err);
        });
        return;
      }
      Promise.resolve(close()).catch((err) => {
        console.warn('[Persona] 关闭个人档案异常：', err);
      });
    }
  });

  // popstate 返回
  window.addEventListener('popstate', () => {
    // 文本编辑器叠在本页之上时，这次返回归它处理，本页不响应
    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;

    const hash = window.location.hash || '';
    if (hash !== '#persona' && isOpen) {
      Promise.resolve(close()).then((closed) => {
        // 归档失败留在页面时，手势已经把历史条目消耗掉了。
        // 补回一条，否则下次返回会直接跳出整个应用。
        if (!closed && isOpen) {
          try {
            history.pushState({ rfPage: 'persona' }, '', '#persona');
          } catch (_) { /* ignore */ }
        }
      }).catch((err) => {
        console.warn('[Persona] 路由关闭异常：', err);
      });
    }
  });

  // 初始化：把已存身份编号同步至桌面红卡（名字与照片由 profile.js 独立管理）
  function init() {
    const serial = Store.getSerialNo();
    // 未领取（空串）时呈待签发态，避免显示裸 NO.
    if (desktopSerial) desktopSerial.textContent = serial ? `NO.${serial}` : 'NO.------';
    if (serialNoInput) serialNoInput.value = serial;
    restoreAvatar();
    restoreFaceId();
  }

  Boot.onReady('persona', init);

  // 挂载全局
  window.RetroflowPersonaUI = {
    open,
    close,
    /**
     * 打开个人档案并直接切到马甲库。
     * @param {Object} [opts]
     * @param {boolean} [opts.create] 为 true 时顺带打开新建马甲表单
     */
    openMaskVault: (opts) => {
      // 调用方（如线上联络跳转）可能已把 hash 置为 #persona，
      // 此时 open() 再 pushState 会多压一条重复记录，导致要按两次返回。
      const alreadyRouted = (window.location.hash || '') === '#persona';
      if (alreadyRouted) {
        isOpen = false; // 确保 open() 不被提前 return 挡掉
      }
      open({ skipHistory: alreadyRouted });
      // switchTab 现在是 async（要等马甲详情归档），必须串起来再开新建表单
      return Promise.resolve(switchTab('vault')).then(() => {
        if (opts && opts.create) {
          return openMaskDetail(null);
        }
      }).catch((err) => {
        console.warn('[Persona] 打开马甲库异常：', err);
      });
    },
    /** 马甲数量，供外部判断是否已有可用身份 */
    getMaskCount: () => loadMasks().length,
    save: saveIdentity,
    load: loadIdentity,
    getFaceId: () => Storage.getAssetSrc(ASSET_KEY_FACE_ID),
    // 供绘像工坊回写：统一走这里，保证档案内部状态同步
    setAvatar: async (value, displaySrc) => {
      await Storage.setAsset(ASSET_KEY_AVATAR, value);
      const src = displaySrc || (typeof value === 'string' ? value : null)
        || await Storage.getAssetSrc(ASSET_KEY_AVATAR);
      currentAvatarSrc = src;
      renderAvatar(src);
    }
  };

  // 向注册表声明本模块在用的资产键：档案本体 + 全部马甲的立绘与面容
  DataRegistry.registerUsageProvider('persona', () => {
    const keys = [ASSET_KEY_AVATAR, ASSET_KEY_FACE_ID];
    loadMasks().forEach((mask) => {
      if (!mask || !mask.id) return;
      keys.push(ASSET_PREFIX_MASK_AVATAR + mask.id);
      keys.push(ASSET_PREFIX_MASK_FACE_ID + mask.id);
    });
    return keys;
  });
})();
