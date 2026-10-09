/**
 * 溯流计划 · 桌面红卡交互
 *
 * 红卡是纯装饰件（decor 域），照片、名字、签名全都独立，
 * 换个人档案头像或改档案名都不会覆盖它。
 *
 * 唯一与个人档案共享的是序列号 —— 那是全局唯一的身份编号，
 * 真相源在 Store.envoy.identity.serialNo，红卡只负责显示。
 */
(() => {
  const KEY_CARD_PHOTO = DataRegistry.key.profileCard();

  const avatarWrapper = document.querySelector('.photo-layer-front');
  const avatarImg = document.querySelector('.photo-inner img');
  const nameInput = document.querySelector('.profile-name');
  const bioInput = document.querySelector('.profile-bio');
  const serialNumEl = document.getElementById('profileSerialNum');
  const serviceDaysEl = document.getElementById('serviceDaysVal');

  let currentObjectUrl = null;

  function renderCardPhoto(src) {
    if (!src) return;
    if (currentObjectUrl && currentObjectUrl !== src) {
      Storage.revokeAssetSrc(currentObjectUrl);
    }
    currentObjectUrl = src.startsWith('blob:') ? src : null;
    avatarImg.src = src;
    avatarImg.hidden = false;
    avatarImg.style.opacity = '1';
  }

  /** 回到空态：只留装饰底色，不留裂图 */
  function clearCardPhoto() {
    if (currentObjectUrl) {
      Storage.revokeAssetSrc(currentObjectUrl);
      currentObjectUrl = null;
    }
    // 先置空再移除属性，避免残留已解码帧闪现
    avatarImg.src = '';
    avatarImg.removeAttribute('src');
    avatarImg.hidden = true;
  }

  async function saveCardPhoto(value) {
    try {
      await Storage.setAsset(KEY_CARD_PHOTO, value);
      const src = value instanceof Blob ? URL.createObjectURL(value) : value;
      renderCardPhoto(src);
    } catch (err) {
      console.warn('[Profile] 红卡照片保存失败：', err);
      const src = value instanceof Blob ? URL.createObjectURL(value) : value;
      renderCardPhoto(src);
    }
  }

  function debounce(fn, delay = 300) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  const saveName = debounce((value) => Store.save('decor.cardName', value), 300);
  const saveBio = debounce((value) => Store.save('decor.cardBio', value), 300);

  /** 序列号只读转发，真相源在 Store */
  function getSerialId() {
    return Store.getSerialNo();
  }

  /** 刷新红卡上的编号显示。未领取（空串）时呈待签发态，不显示裸 NO. */
  function renderSerial(id) {
    if (!serialNumEl) return;
    const clean = String(id || '').trim();
    serialNumEl.textContent = clean ? `NO.${clean}` : 'NO.------';
  }

  /**
   * 刷新在役履历面板的「加入计划 N 天」。
   * 真相源是观测档案的 psych.career.joinedAt，由开场向导第七步「完成入职」写入，
   * 天数换算统一走 PsychStore.calculateServiceDays（入职当天记为第 1 天）。
   * 尚未入职时显示占位符，不谎报天数。
   */
  function renderServiceDays() {
    if (!serviceDaysEl) return;

    let days = 0;
    try {
      if (window.PsychStore && typeof PsychStore.load === 'function') {
        const profile = PsychStore.load();
        const joinedAt = profile && profile.career ? profile.career.joinedAt : null;
        days = PsychStore.calculateServiceDays(joinedAt);
      }
    } catch (err) {
      console.warn('[Profile] 在役天数计算失败：', err);
      days = 0;
    }

    serviceDaysEl.textContent = days > 0 ? String(days) : '--';
  }

  // 点击红卡照片打开通用选择器
  avatarWrapper.addEventListener('click', () => {
    ImagePicker.open({
      title: '更换红卡照片',
      onSelect: async (res) => {
        if (res.type === 'file') {
          const tempSrc = URL.createObjectURL(res.file);
          renderCardPhoto(tempSrc);
          try {
            const blob = await Storage.compressImage(res.file, 1200, 0.85);
            await saveCardPhoto(blob);
          } catch (err) {
            await saveCardPhoto(res.file);
          }
        } else if (res.type === 'url') {
          renderCardPhoto(res.url);
          await saveCardPhoto(res.url);
        }
      }
    });
  });

  nameInput.addEventListener('input', (e) => saveName(e.target.value));
  bioInput.addEventListener('input', (e) => saveBio(e.target.value));

  // 图源失效（远端 URL 挂了、Blob 被回收）时退回空态，不留裂图
  avatarImg.addEventListener('error', () => {
    if (avatarImg.getAttribute('src')) clearCardPhoto();
  });

  // 档案侧改了编号后同步红卡显示
  window.addEventListener('retroflow:serial-changed', (e) => {
    renderSerial(e.detail || Store.getSerialNo());
  });

  // 入职完成或履历变动后重算在役天数
  window.addEventListener('retroflow:career-changed', () => {
    renderServiceDays();
  });

  // 配置数据装载完成后再填充界面
  Boot.onReady('profile', async () => {
    nameInput.value = Store.decor.cardName;
    bioInput.value = Store.decor.cardBio;
    renderSerial(Store.getSerialNo());
    renderServiceDays();
    const src = await Storage.getAssetSrc(KEY_CARD_PHOTO);
    if (src) renderCardPhoto(src);
  });

  // 向注册表声明本模块在用的资产键，供孤儿探测比对
  DataRegistry.registerUsageProvider('profile', () => [KEY_CARD_PHOTO]);

  // 暴露全局执行员资料控制器（编号只读，写入走 Store.claimSerial）
  window.RetroflowProfile = {
    getSerialId
  };
})();