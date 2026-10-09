/**
 * 溯流计划 · 副本推演二级对话设置控制器 (Fork Run Settings UI)
 *
 * 职责：
 * 1. 管理 #forkRunSettingsPage 的展示、退出与 popstate 路由栈；
 * 2. 对齐系统助理设置页 Bento 结构（纯卡片流、零分割线）；
 * 3. 严格遵循《工地施工协议》：纯 SVG 图标、零 emoji、iOS 灵动岛保护；
 * 4. 纯 UI 搭建阶段，不接入真实未就绪业务逻辑。
 */
window.ForkRunSettingsUI = (() => {
  'use strict';

  /* ================= 推演设置存储 =================
     全局单份（不按副本 / 世界线隔离）：流式输出这类是用户的算力口味，
     跟具体推的是哪个本无关。走 localStorage 存轻量标量，与助手页同范式。 */

  const STORAGE_KEY = 'retroflow_fork_run_settings_v1';

  const DEFAULT_SETTINGS = {
    // 流式输出：默认开。关掉则整段生成完一次性上屏
    streaming: true,
    // 自动重试：本期不实现，开关留位但运行期不读
    autoRetry: false,
    autoMemory: true,
    // 组件默认展开：默认开。关掉后 4 类状态卡（执行员/队友/NPC/任务）初始收起，
    // 思考过程组件不受此开关影响，始终保持收起。
    defaultExpandComponents: true
  };

  /** 只读开关有哪些：key 即 DOM id 后缀 forkRunToggle_<key> */
  const TOGGLE_KEYS = ['streaming', 'autoRetry', 'autoMemory', 'defaultExpandComponents'];

  let settingsCache = null;

  function getSettings() {
    if (settingsCache) return { ...settingsCache };
    let parsed = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.warn('[ForkRunSettings] 读取设置失败，回退默认', e);
    }
    settingsCache = { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    return { ...settingsCache };
  }

  function patchSettings(patch) {
    if (!patch) return;
    settingsCache = { ...getSettings(), ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsCache));
    } catch (e) {
      console.error('[ForkRunSettings] 保存设置失败', e);
    }
  }

  let settingsPage = null;
  let backBtn = null;
  let branchNameInput = null;
  let worldlinesRow = null;
  let searchRow = null;
  let contextRow = null;
  let jumpApiBtn = null;
  let currentModelNameEl = null;
  let currentModelStatusEl = null;
  let extractMemoryBtn = null;
  let wallpaperPickBtn = null;
  let wallpaperClearBtn = null;
  let wallpaperMaskToggle = null;
  let wallpaperBlurToggle = null;
  let wallpaperPreviewText = null;
  let deleteCurrentRunBtn = null;
  let worldbookMountRow = null;
  let worldbookStatusText = null;
  /** 开关 DOM 台账：key → input 元素 */
  const toggleEls = {};
  let isOpened = false;

  let currentContext = {
    forkId: '',
    runId: ''
  };

  function initDOM() {
    if (settingsPage) return;
    settingsPage = document.getElementById('forkRunSettingsPage');
    if (!settingsPage) return;

    backBtn = document.getElementById('forkRunSettingsBackBtn');
    branchNameInput = document.getElementById('forkRunSettingBranchName');
    worldlinesRow = document.getElementById('forkRunSettingWorldlinesRow');
    searchRow = document.getElementById('forkRunSettingSearchRow');
    contextRow = document.getElementById('forkRunSettingContextRow');
    jumpApiBtn = document.getElementById('forkRunJumpApiSettingsBtn');
    currentModelNameEl = document.getElementById('forkRunCurrentModelName');
    currentModelStatusEl = document.getElementById('forkRunCurrentModelStatus');
    extractMemoryBtn = document.getElementById('forkRunExtractMemoryNowBtn');
    wallpaperPickBtn = document.getElementById('forkRunWallpaperPickBtn');
    wallpaperClearBtn = document.getElementById('forkRunWallpaperClearBtn');
    wallpaperMaskToggle = document.getElementById('forkRunWallpaperMaskToggle');
    wallpaperBlurToggle = document.getElementById('forkRunWallpaperBlurToggle');
    wallpaperPreviewText = document.getElementById('forkRunWallpaperPreviewText');
    deleteCurrentRunBtn = document.getElementById('forkRunDeleteCurrentRunBtn');
    worldbookMountRow = document.getElementById('forkRunWorldbookMountRow');
    worldbookStatusText = document.getElementById('forkRunWorldbookStatusText');

    // 开关：全局单份，change 即落库。回填在 syncToggles 里做
    TOGGLE_KEYS.forEach((key) => {
      const el = document.getElementById('forkRunToggle_' + key);
      if (!el) return;
      toggleEls[key] = el;
      el.addEventListener('change', () => {
        patchSettings({ [key]: el.checked });
        // 组件默认展开开关：切换后立即刷新当前推演流已渲染卡片的折叠态
        if (key === 'defaultExpandComponents'
          && window.ForkRunUI && typeof ForkRunUI.applyComponentExpandState === 'function') {
          ForkRunUI.applyComponentExpandState(el.checked);
        }
      });
    });

    if (deleteCurrentRunBtn) {
      deleteCurrentRunBtn.addEventListener('click', () => handleDeleteCurrentRun());
    }

    // 世界书挂载：唤起通用装载面板，读写当前世界线的会话黑名单覆写
    if (worldbookMountRow) {
      worldbookMountRow.addEventListener('click', () => openWorldbookMount());
    }

    // 上下文查看：叠在设置页之上唤起查看器，看这一窗最近一次真实发出的完整上下文
    if (contextRow) {
      contextRow.addEventListener('click', () => {
        if (window.ForkRunContextInspector && typeof ForkRunContextInspector.open === 'function') {
          ForkRunContextInspector.open();
        } else if (window.RetroToast) {
          RetroToast.show({ tag: 'CONTEXT // 不可用', message: '上下文查看器未就绪', type: 'warning' });
        }
      });
    }

    if (backBtn) {
      backBtn.addEventListener('click', () => close());
    }

    // 分支名：实时保存到当前 run 的 label，并同步刷新推演页顶栏标题
    if (branchNameInput) {
      branchNameInput.addEventListener('input', async () => {
        const runId = currentContext.runId;
        if (!runId || !window.ForkRunStore || typeof ForkRunStore.renameRun !== 'function') return;
        const newLabel = branchNameInput.value.trim();
        try {
          await ForkRunStore.renameRun(runId, newLabel);
        } catch (e) {
          console.warn('[ForkRunSettings] 分支名保存失败:', e);
        }
        // 同步刷新推演页顶栏标题（分支名优先，空则回落卷宗名）
        if (window.ForkRunUI && typeof ForkRunUI.refreshHeader === 'function') {
          ForkRunUI.refreshHeader();
        }
      });
    }

    // 查看世界线：复用通用 SelectModal 选择弹窗展示全部分支，可切换/删除/新建
    if (worldlinesRow) {
      worldlinesRow.addEventListener('click', () => {
        openWorldlinesModal();
      });
    }

    // 查找聊天记录：唤起通用检索中枢，命中后回跳定位当前世界线的流水
    if (searchRow) {
      searchRow.addEventListener('click', () => {
        if (!currentContext.runId) {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'SEARCH // 无记录', message: '当前世界线还没有推演记录', type: 'info' });
          }
          return;
        }
        if (!window.ChatHistorySearchUI || typeof ChatHistorySearchUI.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'SEARCH // 不可用', message: '检索模块未就绪', type: 'warning' });
          }
          return;
        }

        // 推演流水在 records 表里的分区键为 `run:{runId}`，与线上聊天同一套前缀查询
        const forkId = `run:${currentContext.runId}`;
        const label = (branchNameInput && branchNameInput.value.trim()) || '当前世界线';

        ChatHistorySearchUI.open({
          forkId,
          label,
          onLocate: (recordId) => {
            // 命中后落回推演页：先收起设置页，再交给推演页滚动定位
            close();
            setTimeout(() => {
              if (window.ForkRunUI && typeof ForkRunUI.locateRecord === 'function') {
                ForkRunUI.locateRecord(recordId);
              }
            }, 380);
          }
        });
      });
    }
    // 接口配置跳转：直达 API 页主模型列表（副本推演直接用系统主模型）
    if (jumpApiBtn) {
      jumpApiBtn.addEventListener('click', () => {
        // 与助手对话设置同构：不能走 close()（会触发 history.back 把随后 openDetail
        // 压入的 #settings/api 一起弹掉）。这里只收视图不退栈，再用 replaceEntry
        // 折叠模式把本页历史条目原地改写成 API 子页，返回时由 returnTo 回调重建本页路由。
        dismiss();
        // 推演页与 API 设置页同为 z-index:900 全屏页，推演页 DOM 靠后会盖住 API 页，
        // 因此跨页时把推演页也一并收起（返回时 reveal 复原），与助手 dismiss 聊天页同理。
        if (window.ForkRunUI && typeof ForkRunUI.dismiss === 'function') {
          ForkRunUI.dismiss();
        }

        if (window.RetroflowSettings && typeof RetroflowSettings.openDetail === 'function') {
          RetroflowSettings.openDetail('api', {
            returnLabel: 'forkRunSettings',
            replaceEntry: true,
            // 副本直接用主模型，进 API 页停在默认的「主模型节点库」列表（View A），
            // 不调 openSlot，让用户直接查看 / 切换当前主模型。
            onReturn: () => {
              returnToForkRunSettings();
            }
          });
        } else {
          // 兜底：触发设置主入口后切到 API 分区
          const settingsMasterBtn = document.getElementById('settingsBtn') || document.querySelector('[data-view="settings"]');
          if (settingsMasterBtn) {
            settingsMasterBtn.click();
            setTimeout(() => {
              const apiSectionBtn = document.querySelector('.settings-nav-item[data-section="api"]');
              if (apiSectionBtn) apiSectionBtn.click();
            }, 60);
          }
        }
      });
    }


    // 手动提取记忆
    if (extractMemoryBtn) {
      extractMemoryBtn.addEventListener('click', () => {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'MEMORY // 记忆提取',
            message: '因果记忆中枢推演提取中',
            type: 'info'
          });
        }
      });
    }

    // 壁纸操作：调用全局通用 ImagePicker 弹窗，按副本存入 IndexedDB（对话资产）
    if (wallpaperPickBtn) {
      wallpaperPickBtn.addEventListener('click', () => {
        const forkId = currentContext.forkId;
        if (!forkId) {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'WALLPAPER // 无副本', message: '当前没有可装载壁纸的副本', type: 'info' });
          }
          return;
        }
        if (!window.ImagePicker || typeof ImagePicker.open !== 'function') {
          console.warn('[ForkRunSettings] ImagePicker 未挂载');
          return;
        }
        ImagePicker.open({
          title: '更换副本视界壁纸',
          onSelect: async (res) => {
            if (!res || !window.ForkRunWallpaper) return;
            let ok = false;
            if (res.type === 'file' && res.file) {
              ok = await ForkRunWallpaper.setWallpaper(forkId, { type: 'file', file: res.file });
            } else if (res.type === 'url' && res.url) {
              ok = await ForkRunWallpaper.setWallpaper(forkId, { type: 'url', url: res.url });
            }
            if (ok) {
              syncWallpaperUI();
              if (window.RetroToast) {
                RetroToast.show({ tag: 'WALLPAPER // 视界装载', message: '副本专属背景壁纸已装载', type: 'success' });
              }
            }
          }
        });
      });
    }

    if (wallpaperClearBtn) {
      wallpaperClearBtn.addEventListener('click', async () => {
        const forkId = currentContext.forkId;
        if (!forkId || !window.ForkRunWallpaper) return;
        await ForkRunWallpaper.clear(forkId);
        syncWallpaperUI();
        if (window.RetroToast) {
          RetroToast.show({ tag: 'WALLPAPER // 视界复位', message: '对话壁纸已恢复默认纯色', type: 'info' });
        }
      });
    }

    // 暗调保护膜开关（按副本存，实时重绘遮罩）
    if (wallpaperMaskToggle) {
      wallpaperMaskToggle.addEventListener('change', () => {
        const forkId = currentContext.forkId;
        if (!forkId || !window.ForkRunWallpaper) return;
        ForkRunWallpaper.setConfig(forkId, { mask: wallpaperMaskToggle.checked });
      });
    }

    // 景深模糊开关（按副本存，实时重绘模糊）
    if (wallpaperBlurToggle) {
      wallpaperBlurToggle.addEventListener('change', () => {
        const forkId = currentContext.forkId;
        if (!forkId || !window.ForkRunWallpaper) return;
        ForkRunWallpaper.setConfig(forkId, { blur: wallpaperBlurToggle.checked });
      });
    }

    // 监听返回键与手势
    window.addEventListener('popstate', () => {
      if (isOpened && window.location.hash !== '#fork-run/settings') {
        close(true);
      }
    });

    // 原生右滑返回手势
    let touchStartX = 0;
    settingsPage.addEventListener('touchstart', (e) => {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    settingsPage.addEventListener('touchend', (e) => {
      const touchEndX = e.changedTouches[0].clientX;
      if (touchStartX < 36 && touchEndX - touchStartX > 70) {
        close();
      }
    }, { passive: true });
  }

  /**
   * 拉起「查看世界线」弹窗：列出本副本全部分支，可切换/删除/新建。
   * 删除后会重新拉起自身刷新列表，不必手动重开。
   */
  async function openWorldlinesModal() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    if (!window.ForkRunStore || !currentContext.forkId) return;

    const runId = currentContext.runId;

    let allRuns = [];
    try {
      allRuns = await ForkRunStore.listRuns(currentContext.forkId);
    } catch (_) {
      allRuns = [];
    }

    const statusMap = ForkRunStore.RUN_STATUS || null;
    const onlyOne = allRuns.length <= 1;

    // 每条真实分支一个选项，非当前活跃线且总数>1时带删除按钮
    const optList = allRuns.map((run) => {
      const isCurrent = run.id === runId;
      const label = ForkRunStore.getRunDisplayLabel(run, allRuns);
      const stKey = run.status || 'active';
      const stEn = statusMap && statusMap[stKey] ? statusMap[stKey].en : 'ACTIVE';
      const hint = isCurrent ? `${stEn} · 正在推演中` : stEn;

      const opt = { value: run.id, label, hint };

      // 删除按钮：唯一分支不给删；当前活跃线由设置页底部的危险按钮处理
      if (!onlyOne && !isCurrent) {
        opt.actionLabel = '删除此分支';
        opt.onAction = () => handleDeleteRunFromModal(run.id, label);
      }
      return opt;
    });

    optList.push({
      value: '__new_worldline__',
      label: '+ 开辟新的分支',
      hint: '新建平行世界线'
    });

    const picked = await SelectModal.pick({
      tag: 'WORLDLINES // 分支',
      title: '查看与切换世界线',
      options: optList,
      value: runId
    });

    if (!picked) return;

    if (picked === '__new_worldline__') {
      await handleCreateNewWorldline();
      return;
    }

    if (picked === runId) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'WORLDLINES // 活跃分支',
          message: '已锁定当前世界线',
          type: 'info'
        });
      }
      return;
    }

    // 切换到另一条线：关设置页，让推演页重开目标线
    if (window.ForkRunUI && typeof ForkRunUI.open === 'function') {
      close();
      ForkRunUI.open(currentContext.forkId, { runId: picked });
    }
  }

  /**
   * 世界线弹窗内删除某条分支。二次确认后物理删除，成功则重新拉起弹窗刷新列表。
   */
  async function handleDeleteRunFromModal(targetRunId, label) {
    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'WORLDLINES // 删除分支',
        message: `确认彻底删除「${label}」吗？`,
        detail: '该分支的全部对话流水与推演状态将被物理抹除，无法恢复。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    // 收起当前弹窗再删，避免删完还挂在旧列表上
    if (window.SelectModal && typeof SelectModal.close === 'function') {
      SelectModal.close(null);
    }

    try {
      await ForkRunStore.deleteRun(targetRunId);
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'WORLDLINES // 已删除',
          message: `分支「${label}」已抹除`,
          type: 'success'
        });
      }
    } catch (e) {
      console.warn('[ForkRunSettings] 删除分支失败:', e);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'WORLDLINES // 删除失败', message: '分支删除失败', type: 'warning' });
      }
      return;
    }

    // 稍等弹窗退场动画结束，再重新拉起刷新后的列表
    setTimeout(() => { openWorldlinesModal(); }, 220);
  }

  /**
   * 开辟新的世界线：沿用当前线的身份建一条全新分支，建成后切过去。
   * 新线 openingSeeded 为 false，进本会注入卷宗最新开场首帧。
   */
  async function handleCreateNewWorldline() {
    if (!window.ForkRunStore || !currentContext.forkId) return;

    // 沿用当前线的身份（本体/马甲/预设锁定）建新线，保持因果躯壳一致
    let identityType = '';
    let identityId = '';
    try {
      if (currentContext.runId && typeof ForkRunStore.getRun === 'function') {
        const cur = await ForkRunStore.getRun(currentContext.runId);
        if (cur) {
          identityType = cur.identityType || '';
          identityId = cur.identityId || '';
        }
      }
    } catch (_) { /* 读不到就让 createRun 走默认 persona */ }

    let newRun = null;
    try {
      newRun = await ForkRunStore.createRun(currentContext.forkId, {
        identityType,
        identityId
      });
    } catch (e) {
      console.warn('[ForkRunSettings] 新建分支失败:', e);
    }

    if (!newRun) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'WORLDLINES // 开辟失败', message: '新分支创建失败', type: 'warning' });
      }
      return;
    }

    // 关设置页，让推演页开新线（新线进本会注入最新开场首帧）
    close();
    if (window.ForkRunUI && typeof ForkRunUI.open === 'function') {
      ForkRunUI.open(currentContext.forkId, { runId: newRun.id });
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'WORLDLINES // 已开辟',
          message: '新的世界线已开启',
          type: 'success'
        });
      }
    }
  }

  /**
   * 设置页底部「删除此世界线」：删的是当前正在推演的这条线。
   * 唯一分支不可删；删成功后关设置页，自动切到剩余最近的一条线。
   */
  async function handleDeleteCurrentRun() {
    if (!window.ForkRunStore || !currentContext.forkId || !currentContext.runId) return;

    let allRuns = [];
    try {
      allRuns = await ForkRunStore.listRuns(currentContext.forkId);
    } catch (_) {
      allRuns = [];
    }

    // 唯一分支不可删
    if (allRuns.length <= 1) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'WORLDLINES // 保护',
          message: '唯一分支不可删除',
          detail: '推演必须保留至少一条世界线作为因果底座',
          type: 'info'
        });
      }
      return;
    }

    const curRun = allRuns.find((r) => r && r.id === currentContext.runId);
    const label = curRun ? ForkRunStore.getRunDisplayLabel(curRun, allRuns) : '当前分支';

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'WORLDLINES // 删除分支',
        message: `确认彻底删除当前分支「${label}」吗？`,
        detail: '删除后将自动切换到最近的一条留存世界线。该分支的全部流水与状态将被物理抹除，无法恢复。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    const deletedId = currentContext.runId;
    try {
      await ForkRunStore.deleteRun(deletedId);
    } catch (e) {
      console.warn('[ForkRunSettings] 删除当前分支失败:', e);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'WORLDLINES // 删除失败', message: '分支删除失败', type: 'warning' });
      }
      return;
    }

    // 找剩余最近的一条线（listRuns 倒序，最近在前），切过去
    const remaining = allRuns.filter((r) => r && r.id !== deletedId);
    const nextRun = remaining[0] || null;

    close();

    if (nextRun && window.ForkRunUI && typeof ForkRunUI.open === 'function') {
      ForkRunUI.open(currentContext.forkId, { runId: nextRun.id });
      if (window.RetroToast) {
        const nextLabel = ForkRunStore.getRunDisplayLabel(nextRun, remaining);
        RetroToast.show({
          tag: 'WORLDLINES // 已切换',
          message: `已切换至世界线「${nextLabel}」`,
          type: 'success'
        });
      }
    }
  }

  /**
   * 唤起世界书装载面板：展示全局 + 副本分类的书，现场开关，写回当前世界线的会话黑名单。
   * 覆写只按世界线（run）隔离；世界书库新增内容无需重勾，自动生效。
   */
  async function openWorldbookMount() {
    if (!window.WorldBookMountModal || typeof WorldBookMountModal.open !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'WORLDBOOK // 面板缺席', message: '装载面板模块未就绪', type: 'warning' });
      }
      return;
    }
    const runId = currentContext.runId;
    const forkId = currentContext.forkId;

    // 读当前世界线已有的会话覆写
    let overrides = { disabledBookIds: [], disabledEntryIds: [] };
    if (runId && window.ForkRunStore && typeof ForkRunStore.getRun === 'function') {
      try {
        const run = await ForkRunStore.getRun(runId);
        if (run && run.worldbookOverrides && typeof run.worldbookOverrides === 'object') {
          overrides = {
            disabledBookIds: Array.isArray(run.worldbookOverrides.disabledBookIds)
              ? run.worldbookOverrides.disabledBookIds.slice() : [],
            disabledEntryIds: Array.isArray(run.worldbookOverrides.disabledEntryIds)
              ? run.worldbookOverrides.disabledEntryIds.slice() : []
          };
        }
      } catch (_) { /* 读不到就按全空 */ }
    }

    // 构建绑定作用域：副本 id + 副本内角色 id（供 inScope 过滤绑了角色/副本的书）
    let rosterIds = [];
    if (forkId && window.Store && typeof Store.loadForkDossier === 'function') {
      try {
        const dossier = await Store.loadForkDossier(forkId);
        const hazard = (dossier && Array.isArray(dossier.hazardCharIds)) ? dossier.hazardCharIds
          : (dossier && dossier.hazardCharId ? [dossier.hazardCharId] : []);
        const npcs = (dossier && Array.isArray(dossier.npcs)) ? dossier.npcs.map((n) => n && n.id) : [];
        rosterIds = hazard.concat(npcs)
          .map((id) => (typeof id === 'string' ? id.trim() : ''))
          .filter(Boolean)
          .filter((id, i, arr) => arr.indexOf(id) === i);
      } catch (_) { /* 读不到就空作用域 */ }
    }
    const scope = { forkId: forkId || '', rosterIds };

    WorldBookMountModal.open({
      categoryScope: 'instance',
      scope,
      overrides,
      title: '世界书装载',
      onChange: async (next) => {
        if (!runId || !window.ForkRunStore || typeof ForkRunStore.updateRun !== 'function') return;
        try {
          await ForkRunStore.updateRun(runId, { worldbookOverrides: next });
        } catch (e) {
          console.warn('[ForkRunSettings] 世界书覆写保存失败:', e);
        }
        // 落库后把黑名单同步回推演页内存快照，否则本轮推演仍读旧 currentRun（空），关掉的条目照样注入。
        if (window.ForkRunUI && typeof ForkRunUI.syncWorldbookOverrides === 'function'
          && typeof ForkRunUI.getRunId === 'function' && ForkRunUI.getRunId() === runId) {
          ForkRunUI.syncWorldbookOverrides(next);
        }
        syncWorldbookStatus(next);
      },
      onEditBook: () => {
        // 跳转世界书编纂器（副本分类列表）。先收视图不退栈，返回时经 onReturn 回到推演设置页。
        dismiss();
        if (window.ForkRunUI && typeof ForkRunUI.dismiss === 'function') ForkRunUI.dismiss();
        if (window.WorldBookUI && typeof WorldBookUI.open === 'function') {
          WorldBookUI.open('instance', {
            onReturn: () => {
              // 世界书页返回：先复原推演页底层，再叠回推演设置页
              if (window.ForkRunUI && typeof ForkRunUI.reveal === 'function') ForkRunUI.reveal();
              returnToForkRunSettings();
            }
          });
        }
      }
    });
  }

  /** 刷新世界书挂载行的状态文案（关了几本几条） */
  function syncWorldbookStatus(overrides) {
    if (!worldbookStatusText) return;
    const ov = overrides || {};
    const offB = Array.isArray(ov.disabledBookIds) ? ov.disabledBookIds.length : 0;
    const offE = Array.isArray(ov.disabledEntryIds) ? ov.disabledEntryIds.length : 0;
    if (offB === 0 && offE === 0) {
      worldbookStatusText.textContent = '全局总则 + 本副本设定';
    } else {
      const parts = [];
      if (offB) parts.push('停用 ' + offB + ' 本');
      if (offE) parts.push('停用 ' + offE + ' 条');
      worldbookStatusText.textContent = parts.join(' · ');
    }
  }

  function open(forkId, runId) {
    initDOM();
    if (!settingsPage) return;

    currentContext.forkId = forkId || '';
    currentContext.runId = runId || '';

    // 开关回填：全局设置，每次开页都同步一次真值
    const st = getSettings();
    TOGGLE_KEYS.forEach((key) => {
      const el = toggleEls[key];
      if (el) el.checked = !!st[key];
    });

    // 回填当前主模型信息（副本直接用系统主模型）
    syncModelInfo();
    // 回填壁纸开关与状态文案（按副本读）
    syncWallpaperUI();
    // 回填世界书挂载状态文案（按当前世界线读会话覆写）
    syncWorldbookStatus({ disabledBookIds: [], disabledEntryIds: [] });
    if (currentContext.runId && window.ForkRunStore && typeof ForkRunStore.getRun === 'function') {
      ForkRunStore.getRun(currentContext.runId).then((run) => {
        if (run && currentContext.runId === run.id) {
          syncWorldbookStatus(run.worldbookOverrides || {});
        }
      }).catch(() => {});
    }
    if (branchNameInput) {
      branchNameInput.value = '';
      if (currentContext.runId && window.ForkRunStore && typeof ForkRunStore.getRun === 'function') {
        ForkRunStore.getRun(currentContext.runId).then((run) => {
          // 异步回来时用户可能已切走，只在仍是同一条线时回填
          if (run && currentContext.runId === run.id && branchNameInput) {
            branchNameInput.value = run.label || '';
          }
        }).catch(() => {});
      }
    }

    settingsPage.hidden = false;
    settingsPage.setAttribute('aria-hidden', 'false');
    void settingsPage.offsetWidth;
    settingsPage.classList.add('active');
    isOpened = true;

    try {
      history.pushState({ rfPage: 'fork-run-settings' }, '', '#fork-run/settings');
    } catch (_) {}
  }

  function close(fromPopState = false) {
    if (!settingsPage || !isOpened) return;
    isOpened = false;

    settingsPage.classList.remove('active');
    settingsPage.setAttribute('aria-hidden', 'true');

    if (!fromPopState) {
      if (window.location.hash === '#fork-run/settings') {
        try { history.back(); } catch (_) {}
      }
    }

    setTimeout(() => {
      if (!isOpened && settingsPage) {
        settingsPage.hidden = true;
      }
    }, 280);
  }

  /**
   * 解析副本推演当前生效模型：副本直接用系统主模型（不检测任何插槽）。
   * @returns {{name:string, type:string}}
   */
  function resolveCurrentModel() {
    try {
      if (window.RetroflowApiUI && typeof RetroflowApiUI.getActiveNode === 'function') {
        const node = RetroflowApiUI.getActiveNode();
        if (node && (node.modelId || node.baseUrl)) {
          return {
            name: node.modelId || node.alias || node.baseUrl || '主模型节点',
            type: 'MODEL // MAIN'
          };
        }
      }
    } catch (_) { /* ignore */ }
    return { name: '未配置主模型', type: 'MODEL // FORK DIVE' };
  }

  /** 把当前主模型信息回填到卡片（每次开页 / 从 API 页返回时刷新） */
  function syncModelInfo() {
    const info = resolveCurrentModel();
    if (currentModelNameEl) currentModelNameEl.textContent = info.name;
    if (currentModelStatusEl) currentModelStatusEl.textContent = info.type;
  }

  /** 回填壁纸状态文案 + 遮罩/模糊开关（按当前副本读，每次开页刷新） */
  function syncWallpaperUI() {
    const forkId = currentContext.forkId;
    const cfg = (window.ForkRunWallpaper && typeof ForkRunWallpaper.getConfig === 'function')
      ? ForkRunWallpaper.getConfig(forkId)
      : { mask: true, blur: false };
    if (wallpaperMaskToggle) wallpaperMaskToggle.checked = !!cfg.mask;
    if (wallpaperBlurToggle) wallpaperBlurToggle.checked = !!cfg.blur;
    if (wallpaperPreviewText) {
      const has = window.ForkRunWallpaper && typeof ForkRunWallpaper.hasWallpaper === 'function'
        ? ForkRunWallpaper.hasWallpaper()
        : false;
      wallpaperPreviewText.textContent = has ? '已装载副本专属视界' : '默认机能纯色视界';
    }
  }

  /**
   * 只收起设置页视图、不触碰 history，供跨页跳转（进 API 页）时避免多次 back 造成路由竞态。
   */
  function dismiss() {
    if (!settingsPage) return;
    isOpened = false;
    settingsPage.classList.remove('active');
    settingsPage.setAttribute('aria-hidden', 'true');
    setTimeout(() => {
      if (!isOpened && settingsPage) settingsPage.hidden = true;
    }, 280);
  }

  /**
   * 从 API 设置页返回时的复位入口（由 settings.js 的 returnTarget 回调触发）。
   * 折叠模式（replaceEntry）下 settings.js 不退栈，当前历史条目是本页被原地改写成
   * #settings/api 的产物，这里必须用 replaceState 把路由改写回本页，不能 pushState。
   */
  function returnToForkRunSettings() {
    initDOM();
    if (!settingsPage) return;

    // 先把推演页底层复原（跳 API 时被 dismiss 收起过），再叠回设置页
    if (window.ForkRunUI && typeof ForkRunUI.reveal === 'function') {
      ForkRunUI.reveal();
    }

    const st = getSettings();
    TOGGLE_KEYS.forEach((key) => {
      const el = toggleEls[key];
      if (el) el.checked = !!st[key];
    });
    syncModelInfo();

    settingsPage.hidden = false;
    settingsPage.setAttribute('aria-hidden', 'false');
    void settingsPage.offsetWidth;
    settingsPage.classList.add('active');
    isOpened = true;

    // 折叠模式不新增历史层，避免从推演设置返回时再次落回 API 页。
    try {
      history.replaceState({ rfPage: 'fork-run-settings' }, '', '#fork-run/settings');
    } catch (_) {}
  }

  return {
    open,
    close,
    isOpen: () => isOpened,
    // 运行期读设置（fork-run-api 读流式开关走这里）
    getSettings
  };
})();
