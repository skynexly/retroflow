/**
 * 溯流计划 · 线上联络私聊二级对话设置控制器 (Online Chat Settings UI)
 *
 * 职责：
 *   1. 管理 #onlineChatSettingsPage 的展示、退出与 popstate 路由栈；
 *   2. 联系人备注实时修改与落库；
 *   3. 查找聊天记录唤起通用检索中枢并在命中后回跳定位；
 *   4. 私聊独立对话壁纸（IndexedDB decor / online 域，通过通用 ImagePicker 弹窗上传与清除）；
 *   5. 滑块与开关的双向绑定与持久化。
 */
window.OnlineChatSettings = (() => {
  'use strict';

  /* ================= 设置存储 =================
     私聊设置按联系人隔离：同一个账号下不同的人，工具开关与参数互不干扰。
     壁纸走 IndexedDB 资产库（见 wallpaperAssetKey），这里只存轻量标量。 */

  const STORAGE_KEY = 'retroflow_online_chat_settings_v1';

  const DEFAULT_SETTINGS = {
    imageGen: true,
    timePerception: true,
    // 内置工具 = 文件区翻阅能力。关闭时提示词不注入文件段，运行期也不响应标记。
    builtinTools: true,
    webSearch: true,
    mcpProtocol: true,
    // 单条回复内连续翻阅文件的次数上限
    toolLoopLimit: 10,
    // 历史上下文里保留完整文件内容的轮数，超出的降级为占位
    toolResultKeepTurns: 3
  };

  /** 全量表：{ [contactId]: settings } */
  let settingsMap = null;

  function readAll() {
    if (settingsMap) return settingsMap;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      settingsMap = raw ? (JSON.parse(raw) || {}) : {};
    } catch (e) {
      console.warn('[OnlineChatSettings] 读取设置失败，回退默认', e);
      settingsMap = {};
    }
    return settingsMap;
  }

  function writeAll() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(readAll()));
    } catch (e) {
      console.error('[OnlineChatSettings] 保存设置失败', e);
    }
  }

  /**
   * 取某个联系人的设置，缺省项补默认值。
   * @param {string} contactId
   * @returns {Object}
   */
  function getSettings(contactId) {
    if (!contactId) return { ...DEFAULT_SETTINGS };
    const all = readAll();
    return { ...DEFAULT_SETTINGS, ...(all[contactId] || {}) };
  }

  /** 写入某个联系人的单项设置 */
  function patchSettings(contactId, patch) {
    if (!contactId || !patch) return;
    const all = readAll();
    all[contactId] = { ...getSettings(contactId), ...patch };
    writeAll();
  }

  let settingsPage = null;
  let backBtn = null;
  let remarkInput = null;
  let searchRow = null;
  let wallpaperUploadBtn = null;
  let wallpaperClearBtn = null;
  let wallpaperPreviewText = null;
  let pendingProgrammaticBack = false;

  /** 开关键名与 DOM id 后缀一致（onlineChatToggle_xxx） */
  const TOGGLE_KEYS = ['imageGen', 'timePerception', 'builtinTools', 'webSearch', 'mcpProtocol'];
  const toggleEls = {};
  let loopSlider = null;
  let loopDisplay = null;
  let keepSlider = null;
  let keepDisplay = null;

  let currentContext = null;
  let currentWallpaperSrc = null;

  function wallpaperAssetKey(contactId) {
    if (!contactId) return 'decor.chat.wallpaper.online_default';
    if (window.DataRegistry && window.DataRegistry.key && typeof DataRegistry.key.onlineChatWallpaper === 'function') {
      return DataRegistry.key.onlineChatWallpaper(contactId);
    }
    return `decor.chat.wallpaper.online.${contactId}`;
  }

  function updateWallpaperStatus() {
    if (!wallpaperPreviewText) return;
    if (currentWallpaperSrc) {
      wallpaperPreviewText.textContent = '已装载专属对话壁纸';
      wallpaperPreviewText.style.color = 'var(--primary-color)';
    } else {
      wallpaperPreviewText.textContent = '默认纯色机能底色';
      wallpaperPreviewText.style.color = 'var(--text-muted)';
    }
  }

  function applyWallpaperToChatPage() {
    const chatPage = document.getElementById('onlineChatPage');
    if (!chatPage) return;
    if (currentWallpaperSrc) {
      chatPage.style.backgroundImage = `url(${currentWallpaperSrc})`;
      chatPage.style.backgroundSize = 'cover';
      chatPage.style.backgroundPosition = 'center';
      chatPage.style.backgroundRepeat = 'no-repeat';
    } else {
      chatPage.style.backgroundImage = '';
      chatPage.style.backgroundSize = '';
      chatPage.style.backgroundPosition = '';
      chatPage.style.backgroundRepeat = '';
    }
  }

  async function restoreWallpaper(contactId) {
    if (!contactId || !window.Storage || typeof Storage.getAssetSrc !== 'function') return;
    try {
      const key = wallpaperAssetKey(contactId);
      const src = await Storage.getAssetSrc(key);
      if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
        Storage.revokeAssetSrc(currentWallpaperSrc);
      }
      currentWallpaperSrc = src || null;
      applyWallpaperToChatPage();
      updateWallpaperStatus();
    } catch (e) {
      console.warn('[OnlineChatSettings] 读取壁纸失败:', e);
    }
  }

  function initDOM() {
    if (settingsPage) return;
    settingsPage = document.getElementById('onlineChatSettingsPage');
    if (!settingsPage) return;

    backBtn = document.getElementById('onlineChatSettingsBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', () => close());
    }

    // 备注输入：实时保存并同步给通讯录与顶栏
    remarkInput = document.getElementById('onlineChatSettingRemark');
    if (remarkInput) {
      remarkInput.addEventListener('input', async () => {
        if (!currentContext || !currentContext.contactId) return;
        const newRemark = remarkInput.value.trim();
        currentContext.remark = newRemark;

        // 1. 保存到联系人存储
        if (window.OnlineStore && typeof OnlineStore.updateContact === 'function') {
          try {
            await OnlineStore.updateContact(currentContext.contactId, { remark: newRemark });
          } catch (e) {
            console.warn('[OnlineChatSettings] 备注保存失败:', e);
          }
        }

        // 2. 同步刷新私聊页顶栏标题
        const headerTitle = document.getElementById('onlineChatHeaderTitle');
        if (headerTitle) {
          headerTitle.textContent = newRemark || currentContext.name || '未命名';
        }
      });
    }

    // 查找聊天记录：唤起通用检索中枢，命中后回跳定位
    searchRow = document.getElementById('onlineChatSettingSearchRow');
    if (searchRow) {
      searchRow.addEventListener('click', () => {
        if (!currentContext || !currentContext.contactId) return;
        if (!window.ChatHistorySearchUI || typeof ChatHistorySearchUI.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'SEARCH // 不可用', message: '检索模块未就绪', type: 'warning' });
          }
          return;
        }

        const forkId = `online:${currentContext.accountId || 'persona'}:${currentContext.contactId}`;
        const label = currentContext.remark || currentContext.name || '联系人';

        ChatHistorySearchUI.open({
          forkId,
          label,
          onLocate: (recordId) => {
            // 命中后落回私聊页：先收起设置页，再交给私聊页定位
            close();
            setTimeout(() => {
              if (window.OnlineChatUI && typeof OnlineChatUI.locateRecord === 'function') {
                OnlineChatUI.locateRecord(recordId);
              }
            }, 380);
          }
        });
      });
    }

    // 壁纸操作：更换壁纸 (调用通用 ImagePicker 弹窗)
    wallpaperUploadBtn = document.getElementById('onlineChatWallpaperUploadBtn');
    wallpaperClearBtn = document.getElementById('onlineChatWallpaperClearBtn');
    wallpaperPreviewText = document.getElementById('onlineChatWallpaperPreviewText');

    if (wallpaperUploadBtn) {
      wallpaperUploadBtn.addEventListener('click', () => {
        if (!currentContext || !currentContext.contactId) return;
        if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'WALLPAPER // 异常', message: '图片选择器未就绪', type: 'warning' });
          }
          return;
        }

        const contactName = currentContext.remark || currentContext.name || '联系人';
        ImagePicker.open({
          title: `更换与「${contactName}」的对话壁纸`,
          onSelect: async (res) => {
            if (!res || !currentContext) return;
            const key = wallpaperAssetKey(currentContext.contactId);
            try {
              if (res.type === 'file' && res.file) {
                const compressed = await Storage.compressImage(res.file, 1600, 0.88);
                await Storage.setAsset(key, compressed);
                if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
                  Storage.revokeAssetSrc(currentWallpaperSrc);
                }
                currentWallpaperSrc = URL.createObjectURL(compressed);
              } else if (res.type === 'url' && res.url) {
                const url = res.url.trim();
                await Storage.setAsset(key, url);
                if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
                  Storage.revokeAssetSrc(currentWallpaperSrc);
                }
                currentWallpaperSrc = url;
              }
              applyWallpaperToChatPage();
              updateWallpaperStatus();
              if (window.RetroToast) {
                RetroToast.show({
                  tag: 'WALLPAPER // 视界壁纸',
                  message: '私聊背景已更新',
                  type: 'info'
                });
              }
            } catch (err) {
              console.error('[OnlineChatSettings] 壁纸存储失败', err);
            }
          }
        });
      });
    }

    if (wallpaperClearBtn) {
      wallpaperClearBtn.addEventListener('click', async () => {
        if (!currentContext || !currentContext.contactId) return;
        const key = wallpaperAssetKey(currentContext.contactId);
        try {
          await Storage.removeAsset(key);
        } catch (_) {}
        if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
          Storage.revokeAssetSrc(currentWallpaperSrc);
        }
        currentWallpaperSrc = null;
        applyWallpaperToChatPage();
        updateWallpaperStatus();
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'WALLPAPER // 恢复默认',
            message: '已清除私聊壁纸，恢复机能底色',
            type: 'info'
          });
        }
      });
    }

    // 开关与滑块：改动即落库，按当前联系人隔离
    TOGGLE_KEYS.forEach((key) => {
      const el = document.getElementById(`onlineChatToggle_${key}`);
      if (!el) return;
      toggleEls[key] = el;
      el.addEventListener('change', () => {
        if (!currentContext || !currentContext.contactId) return;
        patchSettings(currentContext.contactId, { [key]: el.checked });
      });
    });

    loopSlider = document.getElementById('onlineChatToolLoopSlider');
    loopDisplay = document.getElementById('onlineChatToolLoopDisplay');
    if (loopSlider) {
      loopSlider.addEventListener('input', () => {
        if (loopDisplay) loopDisplay.textContent = loopSlider.value;
      });
      // 拖动过程只更新数字，松手才落库，避免一次拖拽写十几次 localStorage
      loopSlider.addEventListener('change', () => {
        if (!currentContext || !currentContext.contactId) return;
        patchSettings(currentContext.contactId, { toolLoopLimit: parseInt(loopSlider.value, 10) || 10 });
      });
    }

    keepSlider = document.getElementById('onlineChatToolKeepSlider');
    keepDisplay = document.getElementById('onlineChatToolKeepDisplay');
    if (keepSlider) {
      keepSlider.addEventListener('input', () => {
        if (keepDisplay) keepDisplay.textContent = keepSlider.value;
      });
      keepSlider.addEventListener('change', () => {
        if (!currentContext || !currentContext.contactId) return;
        patchSettings(currentContext.contactId, { toolResultKeepTurns: parseInt(keepSlider.value, 10) || 3 });
      });
    }
  }

  /** 把某联系人的设置回填到控件上 */
  function applySettingsToUI(contactId) {
    const s = getSettings(contactId);
    TOGGLE_KEYS.forEach((key) => {
      const el = toggleEls[key];
      if (el) el.checked = s[key] !== false;
    });
    if (loopSlider) {
      loopSlider.value = String(s.toolLoopLimit);
      if (loopDisplay) loopDisplay.textContent = String(s.toolLoopLimit);
    }
    if (keepSlider) {
      keepSlider.value = String(s.toolResultKeepTurns);
      if (keepDisplay) keepDisplay.textContent = String(s.toolResultKeepTurns);
    }
  }

  function dismissUI() {
    if (!settingsPage) return;
    settingsPage.classList.remove('active');
    settingsPage.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!settingsPage.classList.contains('active')) {
        settingsPage.hidden = true;
      }
    }, 360);
  }

  async function open(context) {
    initDOM();
    if (!settingsPage) return;

    currentContext = context || null;

    // 1. 同步顶栏英文标题
    const titleEn = document.getElementById('onlineChatSettingsTitleEn');
    if (titleEn && currentContext && (currentContext.remark || currentContext.name)) {
      const displayName = currentContext.remark || currentContext.name;
      titleEn.textContent = `SETTINGS // ${displayName.toUpperCase()}`;
    } else if (titleEn) {
      titleEn.textContent = 'SETTINGS // CONTACT';
    }
 // 2. 同步备注输入框
    if (remarkInput && currentContext) {
      remarkInput.value = currentContext.remark || '';
    }

    // 2.5 回填该联系人的开关与滑块
    applySettingsToUI(currentContext && currentContext.contactId);

    // 3. 恢复与同步壁纸状态
    if (currentContext && currentContext.contactId) {
      await restoreWallpaper(currentContext.contactId);
    } else {
      currentWallpaperSrc = null;
      updateWallpaperStatus();
    }

    settingsPage.hidden = false;
    settingsPage.setAttribute('aria-hidden', 'false');
    void settingsPage.offsetWidth;
    settingsPage.classList.add('active');

    try {
      history.pushState({ rfPage: 'online-chat-settings' }, '', '#online-chat/settings');
    } catch (_) {}
  }

  function close() {
    if (!settingsPage || !settingsPage.classList.contains('active')) return;
    dismissUI();

    if ((window.location.hash || '') === '#online-chat/settings') {
      pendingProgrammaticBack = true;
      try {
        history.back();
      } catch (_) {
        pendingProgrammaticBack = false;
      }
    }
  }

  window.addEventListener('popstate', () => {
    if (pendingProgrammaticBack) {
      pendingProgrammaticBack = false;
      return;
    }
    const hash = window.location.hash || '';
    if (settingsPage && settingsPage.classList.contains('active') && hash !== '#online-chat/settings') {
      dismissUI();
    }
  });

  window.addEventListener('DOMContentLoaded', initDOM);

  return {
    open,
    close,
    restoreWallpaper,
    getSettings
  };
})();
