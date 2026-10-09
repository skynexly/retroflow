/**
 * 溯流计划 - 系统助理二级对话设置控制器 (System Chat Settings Controller)
 * 职责：管理系统助理专属设置、纯净 Bento 卡片状态持久化、壁纸装载与自定义 CSS 注入
 */
(function() {
  'use strict';

  // 默认配置矩阵（壁纸已迁移至 IndexedDB，不再存入 localStorage）
  const DEFAULT_SETTINGS = {
    remark: '',
    streaming: true,
    autoRetry: false,
    imageGen: true,
    timePerception: true,
    batteryPerception: true,
    builtinTools: true,
    webSearch: true,
    mcpProtocol: true,
    // 单次回复内连续调用文件工具的上限
    toolLoopLimit: 10,
    // 历史上下文里保留完整工具结果的轮数，超出的降级为占位摘要
    toolResultKeepTurns: 3,
    autoMemory: true,
    memoryTokenInterval: 60000,
    memoryTool: false,
    markdownRender: true,
    segmentedBubbles: false,
    hideThinking: false,
    customCssOpponent: '',
    customCssSelf: ''
  };

  const STORAGE_KEY = 'retroflow_system_chat_settings_v1';
  const WALLPAPER_ASSET_KEY = DataRegistry.key.chatWallpaper('system');
  let currentSettings = { ...DEFAULT_SETTINGS };

  // 壁纸运行时状态（objectURL 需要主动释放）
  let currentWallpaperSrc = null;
  let legacyWallpaperSrc = null;

  // DOM 元素引用
  let settingsPage = null;
  let backBtn = null;
  let remarkInput = null;
  let convRow = null;
  let convCountEl = null;
  let searchBtn = null;
  let contextRow = null;
  let currentModelNameEl = null;
  let currentModelStatusEl = null;
  let jumpApiSettingsBtn = null;
  let extractMemoryNowBtn = null;
  let wallpaperUploadBtn = null;
  let wallpaperClearBtn = null;
  let wallpaperPreviewText = null;
  let customCssOpponentTextarea = null;
  let customCssSelfTextarea = null;
  let memoryIntervalInput = null;
  // 工具循环相关滑条
  let toolLoopSlider = null;
  let toolLoopDisplay = null;
  let toolKeepSlider = null;
  let toolKeepDisplay = null;

  // 开关字典
  const toggles = {};
  function loadSettings() {
    legacyWallpaperSrc = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // 暂存旧版壁纸，待 IndexedDB 可用后迁移
        if (parsed && typeof parsed.wallpaper === 'string' && parsed.wallpaper.trim()) {
          legacyWallpaperSrc = parsed.wallpaper.trim();
        }
        // wallpaper 属于旧版字段，读取时丢弃，避免再次写回 localStorage
        if (parsed) delete parsed.wallpaper;
        currentSettings = { ...DEFAULT_SETTINGS, ...(parsed || {}) };
      }
    } catch (e) {
      console.warn('[SystemChatSettings] 读取设置失败，回退默认', e);
      currentSettings = { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings() {
    try {
      const settingsToSave = { ...currentSettings };
      delete settingsToSave.wallpaper;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsToSave));
      applySettingsToUI();
    } catch (e) {
      console.error('[SystemChatSettings] 保存设置失败', e);
    }
  }
  // 动态应用设置到 DOM / 样式
  function applySettingsToUI() {
    const chatPage = document.getElementById('systemChatPage');
    if (!chatPage) return;

    // 0. 备注只影响聊天顶栏；名称解析统一交由 SystemChatUI，避免各模块互相抢写
    if (window.SystemChatUI && typeof SystemChatUI.syncHeaderIdentity === 'function') {
      SystemChatUI.syncHeaderIdentity();
    } else {
      const titleEl = document.getElementById('systemChatHeaderTitle');
      if (titleEl) {
        let assistantName = '系统助手';
        try {
          if (window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function') {
            const active = ResonanceUI.getActiveAssistant();
            if (active && String(active.name || '').trim()) assistantName = String(active.name).trim();
          }
        } catch (_) { /* 使用兜底名称 */ }
        // 眉栏优先显示对话标题，没设标题才回落助手名
        let convTitle = '';
        try {
          if (window.SystemChatUI && typeof SystemChatUI.getCurrentConvTitle === 'function') {
            convTitle = String(SystemChatUI.getCurrentConvTitle() || '').trim();
          }
        } catch (_) { /* 读不到标题就用助手名 */ }
        titleEl.textContent = convTitle || assistantName;
      }
    }

    // 1. 壁纸注入（从内存中的 objectURL / 网络URL 渲染）
    if (currentWallpaperSrc) {
      chatPage.style.backgroundImage = `url(${currentWallpaperSrc})`;
      chatPage.style.backgroundSize = 'cover';
      chatPage.style.backgroundPosition = 'center';
    } else {
      chatPage.style.backgroundImage = 'none';
    }

    // 2. 自定义气泡 CSS 注入
    let styleEl = document.getElementById('systemChatCustomBubbleStyle');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'systemChatCustomBubbleStyle';
      document.head.appendChild(styleEl);
    }

    let cssRules = '';
    if (currentSettings.customCssOpponent && currentSettings.customCssOpponent.trim()) {
      cssRules += `\n#systemChatPage .chat-bubble.assistant { ${currentSettings.customCssOpponent} }\n`;
    }
    if (currentSettings.customCssSelf && currentSettings.customCssSelf.trim()) {
      cssRules += `\n#systemChatPage .chat-bubble.user { ${currentSettings.customCssSelf} }\n`;
    }
    styleEl.textContent = cssRules;
  }

  // 获取当前生效模型名称（检测系统助手专属插槽 / 回退主模型）
  function resolveCurrentModel() {
    try {
      if (window.RetroflowApiUI && typeof window.RetroflowApiUI.resolveSlot === 'function') {
        const slotCfg = window.RetroflowApiUI.getSlot ? window.RetroflowApiUI.getSlot('system') : null;
        if (slotCfg && (slotCfg.modelId || slotCfg.baseUrl)) {
          return {
            name: slotCfg.modelId || slotCfg.baseUrl || '自定义端点',
            type: 'MODEL // SYSTEM SLOT'
          };
        }
        const activeNode = window.RetroflowApiUI.getActiveNode ? window.RetroflowApiUI.getActiveNode() : null;
        if (activeNode && activeNode.modelId) {
          return {
            name: activeNode.modelId,
            type: 'MODEL // MAIN'
          };
        }
      }

      // Store.config 兜底
      if (window.Store && Store.config) {
        const slots = Store.config.apiSlots || {};
        if (slots.system && (slots.system.modelId || slots.system.baseUrl)) {
          return {
            name: slots.system.modelId || slots.system.baseUrl,
            type: 'MODEL // SYSTEM SLOT'
          };
        }
        const nodes = Store.config.apiNodes || [];
        const activeId = Store.config.apiActiveNodeId;
        const activeNode = nodes.find(n => n.id === activeId);
        if (activeNode && activeNode.modelId) {
          return {
            name: activeNode.modelId,
            type: 'MODEL // MAIN'
          };
        }
      }
    } catch (e) {
      console.warn('[SystemChatSettings] 解析算力模型失败', e);
    }
    return { name: '未配置算力节点', type: 'MODEL // UNSET' };
  }

  // 获取世界书启用状态
  function resolveWorldbookStatus() {
    try {
      const wbRaw = localStorage.getItem('retroflow_worldbook_active_v1');
      if (wbRaw) {
        const list = JSON.parse(wbRaw);
        if (Array.isArray(list) && list.length > 0) {
          return `已挂载 ${list.length} 本世界书 (${list.slice(0, 2).join(', ')}${list.length > 2 ? '...' : ''})`;
        }
      }
    } catch (e) {}
    return '已挂载 1 本全局系统世界书 (溯流因果律总则)';
  }

  function initDOM() {
    settingsPage = document.getElementById('systemChatSettingsPage');
    if (!settingsPage) return;

    backBtn = document.getElementById('systemChatSettingsBackBtn');
    remarkInput = document.getElementById('systemChatSettingRemark');
    convRow = document.getElementById('systemChatSettingConvRow');
    convCountEl = document.getElementById('systemChatConvCount');
    searchBtn = document.getElementById('systemChatSettingSearchRow');
    contextRow = document.getElementById('systemChatSettingContextRow');
    currentModelNameEl = document.getElementById('systemChatCurrentModelName');
    currentModelStatusEl = document.getElementById('systemChatCurrentModelStatus');
    jumpApiSettingsBtn = document.getElementById('systemChatJumpApiSettingsBtn');
    extractMemoryNowBtn = document.getElementById('systemChatExtractMemoryNowBtn');
    wallpaperUploadBtn = document.getElementById('systemChatWallpaperUploadBtn');
    wallpaperClearBtn = document.getElementById('systemChatWallpaperClearBtn');
    wallpaperPreviewText = document.getElementById('systemChatWallpaperPreviewText');
    customCssOpponentTextarea = document.getElementById('systemChatCustomCssOpponent');
    customCssSelfTextarea = document.getElementById('systemChatCustomCssSelf');
    memoryIntervalInput = document.getElementById('systemChatMemoryIntervalInput');
    toolLoopSlider = document.getElementById('systemChatToolLoopSlider');
    toolLoopDisplay = document.getElementById('systemChatToolLoopDisplay');
    toolKeepSlider = document.getElementById('systemChatToolKeepSlider');
    toolKeepDisplay = document.getElementById('systemChatToolKeepDisplay');

    // 绑定所有 toggle 开关
    const toggleKeys = [
      'streaming', 'autoRetry', 'imageGen', 'timePerception',
      'batteryPerception', 'builtinTools', 'webSearch', 'mcpProtocol',
      'autoMemory', 'memoryTool', 'markdownRender', 'segmentedBubbles', 'hideThinking'
    ];

    toggleKeys.forEach(key => {
      const el = document.getElementById(`systemChatToggle_${key}`);
      if (el) {
        toggles[key] = el;
        el.addEventListener('change', () => {
          currentSettings[key] = el.checked;
          saveSettings();
          if ((key === 'markdownRender' || key === 'segmentedBubbles' || key === 'hideThinking') && window.SystemChatUI && typeof SystemChatUI.rerenderAllMessages === 'function') {
            SystemChatUI.rerenderAllMessages();
          }
        });
      }
    });

    // 返回按钮
    if (backBtn) {
      backBtn.addEventListener('click', closeSettings);
    }

    // 随行悬浮球开关：权威状态存在 SystemChatOrb 自己的 localStorage 里，
    // 不进 settings 对象（它是视图层偏好，与模型/渲染配置无关）。
    const orbToggle = document.getElementById('systemChatToggle_floatingOrb');
    if (orbToggle) {
      if (window.SystemChatOrb && typeof SystemChatOrb.isEnabled === 'function') {
        orbToggle.checked = SystemChatOrb.isEnabled();
      }
      orbToggle.addEventListener('change', () => {
        if (window.SystemChatOrb && typeof SystemChatOrb.setEnabled === 'function') {
          SystemChatOrb.setEnabled(orbToggle.checked);
        }
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'ORB // 随行中枢',
            message: orbToggle.checked ? '悬浮球已启用' : '悬浮球已收起',
            type: 'info'
          });
        }
      });
    }

    // 对话标题输入：写进当前对话的 title，不再存进全局 settings
    if (remarkInput) {
      remarkInput.addEventListener('input', () => {
        const title = remarkInput.value;
        if (window.SystemChatUI && typeof SystemChatUI.renameCurrentConv === 'function') {
          SystemChatUI.renameCurrentConv(title);
        }
      });
    }

    // 对话列表：进多对话管理页
    if (convRow) {
      convRow.addEventListener('click', () => {
        if (window.SystemChatUI && typeof SystemChatUI.openConvPage === 'function') {
          SystemChatUI.openConvPage();
        }
      });
    }

    // 查找聊天记录：唤起通用检索视窗，命中后回跳定位
    if (searchBtn) {
      searchBtn.addEventListener('click', () => {
        if (!window.ChatHistorySearchUI || typeof ChatHistorySearchUI.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'SEARCH // 不可用', message: '检索模块未就绪', type: 'warning' });
          }
          return;
        }
        ChatHistorySearchUI.open({
          // 只检索当前这条对话的流水，别把别的窗口的消息混进来
          forkId: (window.SystemChatUI && typeof SystemChatUI.getCurrentForkId === 'function')
            ? SystemChatUI.getCurrentForkId()
            : 'system-chat:main',
          label: '随身系统助手',
          onLocate: (recordId) => {
            // 命中后要落回聊天页：先收起设置页，再交给聊天页滚动定位
            closeSettings();
            setTimeout(() => {
              if (window.SystemChatUI && typeof SystemChatUI.locateRecord === 'function') {
                SystemChatUI.locateRecord(recordId);
              }
            }, 380);
          }
        });
      });
    }

    // 上下文查看：复用副本那套查看器 UI，只换数据源与文案
    if (contextRow) {
      contextRow.addEventListener('click', () => {
        if (!window.ForkRunContextInspector || typeof ForkRunContextInspector.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'CONTEXT // 不可用', message: '上下文查看模块未就绪', type: 'warning' });
          }
          return;
        }
        ForkRunContextInspector.open({
          source: () => (window.SystemChatUI && typeof SystemChatUI.getLastContextSnapshot === 'function')
            ? SystemChatUI.getLastContextSnapshot()
            : null,
          labels: {
            assistantZh: '助手',
            summaryTitle: '最近助手上下文快照',
            emptyDesc: '本次启动后尚未向助手发起过请求，发送一条消息后即可查看。'
          }
        });
      });
    }

    // 提取频率
    if (memoryIntervalInput) {
      memoryIntervalInput.value = currentSettings.memoryTokenInterval || 60000;
      memoryIntervalInput.addEventListener('change', () => {
        const val = parseInt(memoryIntervalInput.value, 10);
        if (!isNaN(val) && val >= 1000) {
          currentSettings.memoryTokenInterval = val;
          saveSettings();
        }
      });
    }

    // 工具调用上限滑条：拖动时实时更新数值，松手落盘
    if (toolLoopSlider) {
      toolLoopSlider.value = String(currentSettings.toolLoopLimit || 10);
      if (toolLoopDisplay) toolLoopDisplay.textContent = toolLoopSlider.value;
      toolLoopSlider.addEventListener('input', () => {
        if (toolLoopDisplay) toolLoopDisplay.textContent = toolLoopSlider.value;
      });
      toolLoopSlider.addEventListener('change', () => {
        const val = parseInt(toolLoopSlider.value, 10);
        if (!isNaN(val) && val >= 1) {
          currentSettings.toolLoopLimit = val;
          saveSettings();
        }
      });
    }

    // 工具结果保留轮数滑条
    if (toolKeepSlider) {
      const keep = currentSettings.toolResultKeepTurns;
      toolKeepSlider.value = String(typeof keep === 'number' ? keep : 3);
      if (toolKeepDisplay) toolKeepDisplay.textContent = toolKeepSlider.value;
      toolKeepSlider.addEventListener('input', () => {
        if (toolKeepDisplay) toolKeepDisplay.textContent = toolKeepSlider.value;
      });
      toolKeepSlider.addEventListener('change', () => {
        const val = parseInt(toolKeepSlider.value, 10);
        if (!isNaN(val) && val >= 1) {
          currentSettings.toolResultKeepTurns = val;
          saveSettings();
        }
      });
    }

    // 立即提取记忆按键
    if (extractMemoryNowBtn) {
      extractMemoryNowBtn.addEventListener('click', () => {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'MEMORY // 手动提取',
            message: '已触发因果记忆即时提取推演',
            type: 'success'
          });
        }
      });
    }

    // 跳转底层 API 配置（直达系统助手模型插槽）
    if (jumpApiSettingsBtn) {
      jumpApiSettingsBtn.addEventListener('click', () => {
        // 关键：这里不能走 closeSettings() / SystemChatUI.close()。
        // 那两者各自会触发一次异步 history.back()，会把 openDetail 随后压入的
        // #settings/api 一起弹掉，最终退回桌面。
        // 因此只收起视图，再用 replaceEntry 把本页的历史条目原地改写成 API 子页：
        // 整段跨页跳转只占一层，返回时不退栈，由 returnTo 自己重建本页路由，
        // 栈里不会残留中间条目（否则下次返回会把模型列表页翻出来）。
        dismissSettingsUI();
        if (window.SystemChatUI && typeof SystemChatUI.dismiss === 'function') {
          SystemChatUI.dismiss();
        }

        // 打开设置页并直达 API 配置中的「系统助手模型」插槽。
        // onReturn：从 API 页返回时不回主桌面，而是重新落回助理对话设置页。
        // afterEnter：由 settings.js 在子页 init() 之后调度，不再依赖魔法延时；
        //             onBack 让插槽表单的返回按钮跳过模型列表这个中间层。
        if (window.RetroflowSettings && typeof RetroflowSettings.openDetail === 'function') {
          RetroflowSettings.openDetail('api', {
            returnLabel: 'systemChatSettings',
            replaceEntry: true,
            afterEnter: () => {
              if (window.RetroflowApiUI && typeof RetroflowApiUI.openSlot === 'function') {
                RetroflowApiUI.openSlot('system', {
                  onBack: () => {
                    if (window.RetroflowSettings && typeof RetroflowSettings.closeDetail === 'function') {
                      RetroflowSettings.closeDetail();
                    }
                  }
                });
              }
            },
            onReturn: () => {
              returnToSystemChatSettings();
            }
          });
        } else {
          // 兜底：触发设置按钮点击
          const settingsMasterBtn = document.getElementById('settingsBtn') || document.querySelector('[data-view="settings"]');
          if (settingsMasterBtn) {
            settingsMasterBtn.click();
            setTimeout(() => {
              const apiSectionBtn = document.querySelector('.settings-nav-item[data-section="api"]');
              if (apiSectionBtn) apiSectionBtn.click();
              setTimeout(() => {
                if (window.RetroflowApiUI && typeof RetroflowApiUI.openSlot === 'function') {
                  RetroflowApiUI.openSlot('system');
                }
              }, 200);
            }, 300);
          }
        }
      });
    }

    // 壁纸选择 (调用全局统一通用 ImagePicker 弹窗，存入 IndexedDB decor 域)
    if (wallpaperUploadBtn) {
      wallpaperUploadBtn.addEventListener('click', () => {
        if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
          console.warn('[SystemChatSettings] ImagePicker 未挂载');
          return;
        }
        ImagePicker.open({
          title: '更换对话壁纸',
          onSelect: async (res) => {
            if (!res) return;
            try {
              if (res.type === 'file' && res.file) {
                // 压缩后存入 IndexedDB
                const compressed = await Storage.compressImage(res.file, 1600, 0.88);
                await Storage.setAsset(WALLPAPER_ASSET_KEY, compressed);
                // 刷新运行时壁纸
                if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
                  Storage.revokeAssetSrc(currentWallpaperSrc);
                }
                currentWallpaperSrc = URL.createObjectURL(compressed);
                applySettingsToUI();
                updateWallpaperStatus();
                // 壁纸换完界面立刻就变了，视觉本身即回执，不再弹 Toast 添噪
              } else if (res.type === 'url' && res.url) {
                const url = res.url.trim();
                await Storage.setAsset(WALLPAPER_ASSET_KEY, url);
                if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
                  Storage.revokeAssetSrc(currentWallpaperSrc);
                }
                currentWallpaperSrc = url;
                applySettingsToUI();
                updateWallpaperStatus();
              }
            } catch (err) {
              console.error('[SystemChatSettings] 壁纸存储失败', err);
            }
          }
        });
      });
    }

    if (wallpaperClearBtn) {
      wallpaperClearBtn.addEventListener('click', async () => {
        try {
          await Storage.removeAsset(WALLPAPER_ASSET_KEY);
        } catch (e) { /* ignore */ }
        if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
          Storage.revokeAssetSrc(currentWallpaperSrc);
        }
        currentWallpaperSrc = null;
        applySettingsToUI();
        updateWallpaperStatus();
      });
    }

    // 自定义气泡 CSS
    if (customCssOpponentTextarea) {
      customCssOpponentTextarea.value = currentSettings.customCssOpponent || '';
      customCssOpponentTextarea.addEventListener('input', () => {
        currentSettings.customCssOpponent = customCssOpponentTextarea.value;
        saveSettings();
      });
    }

    if (customCssSelfTextarea) {
      customCssSelfTextarea.value = currentSettings.customCssSelf || '';
      customCssSelfTextarea.addEventListener('input', () => {
        currentSettings.customCssSelf = customCssSelfTextarea.value;
        saveSettings();
      });
    }
  }

  function updateWallpaperStatus() {
    if (wallpaperPreviewText) {
      wallpaperPreviewText.textContent = currentWallpaperSrc ? '已装载自定义视界壁纸' : '默认纯色机能底色';
    }
  }

  /** 刷新「对话列表」行右侧的条数角标 */
  async function refreshConvCount() {
    if (!convCountEl || !window.SystemChatStore) return;
    try {
      const n = await SystemChatStore.countConvs();
      convCountEl.textContent = `${n} 个`;
    } catch (_) { /* 读不到就保持原值 */ }
  }

  function syncUIFromSettings() {
    if (!settingsPage) return;

    // 同步 toggle 状态
    Object.keys(toggles).forEach(key => {
      if (toggles[key]) {
        toggles[key].checked = !!currentSettings[key];
      }
    });

    // 对话标题与条数：实时读当前对话，不再读全局 remark
    if (remarkInput && window.SystemChatUI && typeof SystemChatUI.getCurrentConvTitle === 'function') {
      remarkInput.value = SystemChatUI.getCurrentConvTitle() || '';
    }
    refreshConvCount();

    // 悬浮球开关不在 toggles 表里（状态归 SystemChatOrb 管），每次开页单独回填
    const orbToggleEl = document.getElementById('systemChatToggle_floatingOrb');
    if (orbToggleEl && window.SystemChatOrb && typeof SystemChatOrb.isEnabled === 'function') {
      orbToggleEl.checked = SystemChatOrb.isEnabled();
    }
    if (memoryIntervalInput) memoryIntervalInput.value = currentSettings.memoryTokenInterval || 60000;
    if (toolLoopSlider) {
      toolLoopSlider.value = String(currentSettings.toolLoopLimit || 10);
      if (toolLoopDisplay) toolLoopDisplay.textContent = toolLoopSlider.value;
    }
    if (toolKeepSlider) {
      const keepVal = currentSettings.toolResultKeepTurns;
      toolKeepSlider.value = String(typeof keepVal === 'number' ? keepVal : 3);
      if (toolKeepDisplay) toolKeepDisplay.textContent = toolKeepSlider.value;
    }
    if (customCssOpponentTextarea) customCssOpponentTextarea.value = currentSettings.customCssOpponent || '';
    if (customCssSelfTextarea) customCssSelfTextarea.value = currentSettings.customCssSelf || '';

    // 同步模型与世界书信息
    const modelInfo = resolveCurrentModel();
    if (currentModelNameEl) currentModelNameEl.textContent = modelInfo.name;
    if (currentModelStatusEl) currentModelStatusEl.textContent = modelInfo.type;

    const wbEl = document.getElementById('systemChatWorldbookStatusText');
    if (wbEl) {
      wbEl.textContent = resolveWorldbookStatus();
    }

    updateWallpaperStatus();
  }

  let pendingSettingsProgrammaticBack = false;

  function dismissSettingsUI() {
    if (!settingsPage) return;
    settingsPage.classList.remove('active');
    setTimeout(() => {
      settingsPage.hidden = true;
      settingsPage.setAttribute('aria-hidden', 'true');
    }, 280);
  }

  /**
   * 从 API 设置页返回时的复位入口（由 settings.js 的 returnTarget 回调）。
   * 折叠模式（replaceEntry）下当前历史条目就是本页条目的原地改写，settings.js
   * 不退栈，因此这里必须用 replaceState 把路由改写回本页——不能 pushState，
   * 否则会多出一层，下次返回会把 API 子页翻出来。
   */
  function returnToSystemChatSettings() {
    // 1. 先把系统聊天页恢复成可见的底层
    if (window.SystemChatUI && typeof SystemChatUI.reveal === 'function') {
      SystemChatUI.reveal();
    }

    // 2. 再叠回对话设置页（同步刷新最新模型信息，用户可能刚改过插槽）
    if (!settingsPage) initDOM();
    if (!settingsPage) return;

    loadSettings();
    syncUIFromSettings();

    settingsPage.hidden = false;
    settingsPage.setAttribute('aria-hidden', 'false');
    void settingsPage.offsetWidth; // 触发 reflow，保证过渡分帧播放
    settingsPage.classList.add('active');

    // 3. 把被折叠改写掉的路由还原成本页，使后续返回键行为与常规进入完全一致
    try {
      history.replaceState({ rfPage: 'system-chat-settings' }, '', '#system-chat/settings');
    } catch (_) {}
  }

  async function openSettings() {
    if (!settingsPage) initDOM();
    if (!settingsPage) return;

    // 设置页是常规二级页（z-index 1200），压不过 Mini 浮窗（12400）。
    // 若此刻正挂在小窗态，先把聊天窗放大回全屏，设置页才能正常盖在上层。
    if (window.SystemChatOrb && typeof SystemChatOrb.getState === 'function'
      && SystemChatOrb.getState() === 'mini' && typeof SystemChatOrb.toFull === 'function') {
      SystemChatOrb.toFull();
    }

    loadSettings();
    // 从 IndexedDB 异步加载壁纸状态
    await restoreWallpaper();
    syncUIFromSettings();

    settingsPage.hidden = false;
    settingsPage.setAttribute('aria-hidden', 'false');
    void settingsPage.offsetWidth; // 触发 reflow
    settingsPage.classList.add('active');

    try {
      history.pushState({ rfPage: 'system-chat-settings' }, '', '#system-chat/settings');
    } catch (_) {}
  }

  function closeSettings() {
    if (!settingsPage || !settingsPage.classList.contains('active')) return;
    dismissSettingsUI();

    if ((window.location.hash || '') === '#system-chat/settings') {
      pendingSettingsProgrammaticBack = true;
      try {
        history.back();
      } catch (_) {
        pendingSettingsProgrammaticBack = false;
      }
    }
  }

  // popstate 路由与系统返回监听
  window.addEventListener('popstate', () => {
    if (pendingSettingsProgrammaticBack) {
      pendingSettingsProgrammaticBack = false;
      return;
    }

    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;

    const hash = window.location.hash || '';
    if (settingsPage && settingsPage.classList.contains('active') && hash !== '#system-chat/settings') {
      dismissSettingsUI();
    }
  });

  // ESC 键退出二级对话设置
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settingsPage && settingsPage.classList.contains('active')) {
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;
      closeSettings();
    }
  });

  // 二级对话设置页原生边缘/右滑返回手势支持
  (function initSettingsSwipeBackGesture() {
    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;
    let isHorizontal = false;
    let isDirectionLocked = false;

    function attachGesture() {
      if (!settingsPage) initDOM();
      if (!settingsPage) return;

      settingsPage.addEventListener('touchstart', (e) => {
        if (!settingsPage.classList.contains('active')) return;
        if (e.touches && e.touches.length > 1) return;
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        isSwiping = true;
        isHorizontal = false;
        isDirectionLocked = false;
      }, { passive: true });

      settingsPage.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        const t = e.touches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        if (!isDirectionLocked) {
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            isDirectionLocked = true;
            // 向右滑动且水平主导
            isHorizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
          }
        }
      }, { passive: true });

      settingsPage.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;
        if (!isHorizontal) return;

        const t = e.changedTouches ? e.changedTouches[0] : null;
        if (!t) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        if (dx > 72 && Math.abs(dy) < dx * 0.8) {
          closeSettings();
        }
      }, { passive: true });

      settingsPage.addEventListener('touchcancel', () => {
        isSwiping = false;
      }, { passive: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachGesture);
    } else {
      attachGesture();
    }
  })();

  // 初始化入口
  async function init() {
    loadSettings();
    initDOM();

    // 一次性迁移：如果 localStorage 里还残留旧版 wallpaper 字段，搬入 IndexedDB
    await migrateOldWallpaper();

    // 从 IndexedDB 异步恢复对话壁纸
    await restoreWallpaper();
    applySettingsToUI();

    // 绑定系统聊天顶栏右上角设置按钮
    const menuBtn = document.getElementById('systemChatMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', openSettings);
    }
  }

  // 一次性迁移：localStorage wallpaper → IndexedDB
  async function migrateOldWallpaper() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed.wallpaper) return;

      // 将旧数据写入 IndexedDB
      if (parsed.wallpaper.startsWith('data:')) {
        // Base64 → Blob
        const resp = await fetch(parsed.wallpaper);
        const blob = await resp.blob();
        await Storage.setAsset(WALLPAPER_ASSET_KEY, blob);
      } else {
        // URL 字符串
        await Storage.setAsset(WALLPAPER_ASSET_KEY, parsed.wallpaper);
      }

      // 清除 localStorage 中的旧字段
      delete parsed.wallpaper;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      console.log('[SystemChatSettings] 壁纸已从 localStorage 迁移至 IndexedDB');
    } catch (e) {
      console.warn('[SystemChatSettings] 壁纸迁移失败，忽略', e);
    }
  }

  // 从 IndexedDB 异步加载对话壁纸到运行时
  async function restoreWallpaper() {
    try {
      let src = await Storage.getAssetSrc(WALLPAPER_ASSET_KEY);
      // 一次性兼容迁移旧版 localStorage 壁纸（仅支持 URL 或 data URL）
      if (!src && legacyWallpaperSrc) {
        await Storage.setAsset(WALLPAPER_ASSET_KEY, legacyWallpaperSrc);
        src = await Storage.getAssetSrc(WALLPAPER_ASSET_KEY);
        legacyWallpaperSrc = null;
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            delete parsed.wallpaper;
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          }
        } catch (e) { /* ignore cleanup failure */ }
      }
      if (src) {
        // 释放上一枚 objectURL
        if (currentWallpaperSrc && currentWallpaperSrc.startsWith('blob:')) {
          Storage.revokeAssetSrc(currentWallpaperSrc);
        }
        currentWallpaperSrc = src;
      } else {
        currentWallpaperSrc = null;
      }
    } catch (e) {
      console.warn('[SystemChatSettings] 恢复壁纸失败', e);
      currentWallpaperSrc = null;
    }
  }

  // 向注册表声明本模块在用的资产键（防止孤儿回收误删）
  if (window.DataRegistry && typeof DataRegistry.registerUsageProvider === 'function') {
    DataRegistry.registerUsageProvider('systemChat', () => [WALLPAPER_ASSET_KEY]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 全局导出
  window.SystemChatSettings = {
    open: openSettings,
    close: closeSettings,
    // 只收起界面、不触碰 history，供跨页跳转时避免多次 back 造成路由竞态
    dismiss: dismissSettingsUI,
    getSettings: () => ({ ...currentSettings })
  };
})();
