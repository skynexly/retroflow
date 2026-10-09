/**
 * 溯流计划 · 副本挑选页控制器 (Fork Pick UI Controller)
 * 职责：
 *  1. 统一接管桌面红卡「DIVE // 进入副本」与 Dock 栏中央「快速下潜」入口
 *  2. 提取执行员在役权限等级（LV.1 ~ LV.6），依据权限准则从副本库智能抽取 3 本候选副本
 *  3. 提供古典沙龙绛红展墙与 1:1 实木装裱画框交互，支持左右按键与手势滑动切换
 *  4. 呈现接入身份、容纳人数与主线任务量，提供「查看副本」与「进入副本」双出口
 *  5. 严格遵守《工地施工协议》：全量 SVG 图标、零 emoji、零物理分割线、iOS 灵动岛保护
 */

const ForkPickUI = (() => {
  'use strict';

  // 等级权限映射规则表 (LV.1 ~ LV.6)
  const LEVEL_PERMISSIONS = {
    'LV.1': ['E'],
    'LV.2': ['E', 'D', 'C'],
    'LV.3': ['D', 'C'],
    'LV.4': ['C', 'B'],
    'LV.5': ['B', 'A', 'S'],
    'LV.6': ['E', 'D', 'C', 'B', 'A', 'S', 'S+']
  };

  // 水相因果评级字典
  const LEVEL_MAP = {
    'E': { letter: 'E', name: '静水', enName: 'STILL' },
    'D': { letter: 'D', name: '流深', enName: 'DEPTH' },
    'C': { letter: 'C', name: '清源', enName: 'SPRING' },
    'B': { letter: 'B', name: '狂澜', enName: 'SURGE' },
    'A': { letter: 'A', name: '潮汐', enName: 'TIDE' },
    'S': { letter: 'S', name: '深渊', enName: 'ABYSS' },
    'S+': { letter: 'S+', name: '归墟', enName: 'VORTEX' }
  };

  // 纯 SVG 7档战术水相微图腾 (纯矢量机能线条，严禁 emoji)
  const LEVEL_SVGS = {
    'E': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'D': `<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'C': `<svg viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    'B': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'A': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    'S': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    'S+': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  const TONE_CYCLE = ['obsidian-gold', 'deep-crimson', 'slate-blue', 'twilight-purple', 'gold-amber'];

  // DOM 节点缓存
  let pageEl = null;
  let backBtn = null;
  let rerollBtn = null;
  let oilFrameEl = null;
  let canvasMediaEl = null;
  let itemCodeEl = null;
  let itemLevelIconEl = null;
  let itemLevelCodeEl = null;
  let itemLevelNameEl = null;
  let prevBtn = null;
  let nextBtn = null;
  let stepNumEl = null;
  let stepTotalEl = null;
  let titleEl = null;
  let descEl = null;
  let chipIdentityText = null;
  let chipCapacityText = null;
  let chipObjectivesText = null;
  let viewBtn = null;
  let enterBtn = null;
  let envoySerialEl = null;
  let restrictedStateEl = null;
  let restrictedDescEl = null;
  let frameTheaterEl = null;
  let stepperIndicatorEl = null;
  let infoPanelEl = null;

  // 内部状态
  let isOpened = false;
  let candidateForks = [];
  let currentIndex = 0;
  let currentObjectUrl = null;

  /** 获取当前执行员在役等级 */
  function getCurrentLevel() {
    try {
      if (window.PsychStore && typeof PsychStore.loadSync === 'function') {
        const psych = PsychStore.loadSync();
        if (psych && psych.career && psych.career.level) {
          return String(psych.career.level).trim().toUpperCase();
        }
      }
    } catch (_) {}
    return 'LV.1';
  }

  /** 初始化 DOM 引用并绑定事件 */
  function ensureElements() {
    if (pageEl) return;
    pageEl = document.getElementById('forkPickPage');
    if (!pageEl) return;

    backBtn = document.getElementById('forkPickBackBtn');
    rerollBtn = document.getElementById('forkPickRerollBtn');
    oilFrameEl = document.getElementById('forkPickOilFrame');
    canvasMediaEl = document.getElementById('forkPickCanvasMedia');
    itemCodeEl = document.getElementById('forkPickItemCode');
    itemLevelIconEl = document.getElementById('forkPickItemLevelIcon');
    itemLevelCodeEl = document.getElementById('forkPickItemLevelCode');
    itemLevelNameEl = document.getElementById('forkPickItemLevelName');
    prevBtn = document.getElementById('forkPickPrevBtn');
    nextBtn = document.getElementById('forkPickNextBtn');
    stepNumEl = document.getElementById('forkPickStepNum');
    stepTotalEl = document.getElementById('forkPickStepTotal');
    titleEl = document.getElementById('forkPickTitle');
    descEl = document.getElementById('forkPickDesc');
    chipIdentityText = document.getElementById('forkPickChipIdentityText');
    chipCapacityText = document.getElementById('forkPickChipCapacityText');
    chipObjectivesText = document.getElementById('forkPickChipObjectivesText');
    viewBtn = document.getElementById('forkPickViewBtn');
    enterBtn = document.getElementById('forkPickEnterBtn');
    envoySerialEl = document.getElementById('forkPickEnvoySerial');
    restrictedStateEl = document.getElementById('forkPickRestrictedState');
    restrictedDescEl = document.getElementById('forkPickRestrictedDesc');
    frameTheaterEl = pageEl.querySelector('.fork-pick-frame-theater');
    stepperIndicatorEl = document.getElementById('forkPickStepperIndicator');
    infoPanelEl = pageEl.querySelector('.fork-pick-info-panel');

    // 返回
    if (backBtn) {
      backBtn.addEventListener('click', () => close());
    }

    // 重新抽取
    if (rerollBtn) {
      rerollBtn.addEventListener('click', () => {
        reroll();
      });
    }

    // 左右切换
    if (prevBtn) {
      prevBtn.addEventListener('click', () => step(-1));
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => step(1));
    }

    // 查看副本 (统一对齐调阅四大情报章节的副本资料公文档案页)
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        const fork = candidateForks[currentIndex];
        if (!fork) return;
        if (window.ForkDocUI && typeof ForkDocUI.open === 'function') {
          ForkDocUI.open(fork);
        } else if (window.ForkArchiveUI && typeof ForkArchiveUI.openDossier === 'function') {
          ForkArchiveUI.openDossier(fork.id);
        } else if (window.RetroToast) {
          window.RetroToast.show({
            tag: 'FORK // 副本详情',
            message: fork.title || '卷宗详情',
            detail: `${fork.code || 'FORK'} · 等级 ${fork.levelKey || 'E'}`,
            type: 'info'
          });
        }
      });
    }

    // 进入副本（选定后转入副本准备页）
    if (enterBtn) {
      enterBtn.addEventListener('click', () => {
        const fork = candidateForks[currentIndex];
        if (!fork) return;
        dispatchForkChosen(fork);
      });
    }

    // 手势滑动支持
    bindTouchSwipe();
  }

  /** 绑定手势滑动切换 */
  function bindTouchSwipe() {
    const theater = pageEl.querySelector('.fork-pick-frame-theater');
    if (!theater) return;

    let startX = 0;
    let startY = 0;

    theater.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    theater.addEventListener('touchend', (e) => {
      if (e.changedTouches.length !== 1) return;
      const diffX = e.changedTouches[0].clientX - startX;
      const diffY = e.changedTouches[0].clientY - startY;

      // 仅响应主要为水平的手势滑动 (位移 > 45px 且 横向大于纵向)
      if (Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX > 0) step(-1);
        else step(1);
      }
    }, { passive: true });
  }

  let isTransitioning = false;

  /** 步进切换（带方向性阻尼推移与文本浮显丝滑转场） */
  function step(delta) {
    if (!candidateForks || candidateForks.length <= 1) return;
    if (isTransitioning) return; // 防抖锁

    isTransitioning = true;
    const nextIndex = (currentIndex + delta + candidateForks.length) % candidateForks.length;
    const isNext = delta > 0;

    const frameWrapper = pageEl ? pageEl.querySelector('.fork-pick-frame-wrapper') : null;
    const infoPanel = pageEl ? pageEl.querySelector('.fork-pick-info-panel') : null;

    // 1. 出场动画 (110ms)
    if (frameWrapper) {
      frameWrapper.classList.remove('is-sliding-out-left', 'is-sliding-out-right', 'is-preparing-left', 'is-preparing-right');
      frameWrapper.classList.add(isNext ? 'is-sliding-out-left' : 'is-sliding-out-right');
    }
    if (infoPanel) {
      infoPanel.classList.add('is-swapping');
    }
    if (stepNumEl) {
      stepNumEl.classList.add('is-flipping');
    }

    setTimeout(async () => {
      currentIndex = nextIndex;
      await renderCurrentFork();

      // 2. 将画框无过渡瞬移至反方向待命
      if (frameWrapper) {
        frameWrapper.classList.remove('is-sliding-out-left', 'is-sliding-out-right');
        frameWrapper.classList.add(isNext ? 'is-preparing-left' : 'is-preparing-right');

        // 强制回流以确保瞬移生效
        void frameWrapper.offsetWidth;

        // 3. 施加机械弹簧曲线平滑归位 (200ms)
        frameWrapper.classList.remove('is-preparing-left', 'is-preparing-right');
      }

      if (infoPanel) {
        infoPanel.classList.remove('is-swapping');
      }
      if (stepNumEl) {
        stepNumEl.classList.remove('is-flipping');
      }

      setTimeout(() => {
        isTransitioning = false;
      }, 200);
    }, 110);
  }

  /** 读取所有可用副本 */
  function getAllForks() {
    if (window.Store && Store.fork && Array.isArray(Store.fork.index)) {
      return Store.fork.index.filter(Boolean);
    }
    return [];
  }

  /** 将权限等级数组格式化为公文可读串（如「E、D、C」） */
  function formatAllowedLevels(levels) {
    if (!Array.isArray(levels) || levels.length === 0) return 'E';
    return levels.join('、');
  }

  /**
   * 切换权限受限空态与常规展陈态
   * 空态下隐藏画框剧场、步进指示器与信息区，禁用双操作按键，
   * 但保留顶栏、战术致辞与底部古典题铭，维持视觉骨架不塌。
   */
  function applyRestrictedState(isRestricted) {
    if (restrictedStateEl) restrictedStateEl.hidden = !isRestricted;
    if (frameTheaterEl) frameTheaterEl.hidden = isRestricted;
    if (stepperIndicatorEl) stepperIndicatorEl.hidden = isRestricted;
    if (infoPanelEl) infoPanelEl.hidden = isRestricted;

    if (viewBtn) viewBtn.disabled = isRestricted;
    if (enterBtn) enterBtn.disabled = isRestricted;

    // 空态时动态回填当前等级与可接入范围，指明该去编纂什么等级的卷宗
    if (isRestricted && restrictedDescEl) {
      const level = getCurrentLevel();
      const allowed = LEVEL_PERMISSIONS[level] || LEVEL_PERMISSIONS['LV.1'];
      restrictedDescEl.textContent =
        `执行员当前权限为 ${level}，可接入 ${formatAllowedLevels(allowed)} 级副本。`
        + '请前往副本库编纂对应等级卷宗，或提升在役等级以解锁更高危分支。';
    }
  }

  /** 依据当前等级权限抽取 3 本候选副本（严格遵从《使用手册·数值机制》准入规范，禁止越级回退） */
  function pickCandidateForks() {
    const level = getCurrentLevel();
    const allowedLevels = LEVEL_PERMISSIONS[level] || LEVEL_PERMISSIONS['LV.1'];
    const allForks = getAllForks();

    // 严格按权限过滤等级，不符权限的高危副本绝不出现在候选池
    const pool = allForks.filter((fork) => {
      const lk = (fork.levelKey || 'E').toUpperCase();
      return allowedLevels.includes(lk);
    });

    // 权限范围内无可接入副本时保持空态，不做任何越级兜底
    if (pool.length === 0) {
      candidateForks = [];
      currentIndex = 0;
      return;
    }

    // 洗牌算法随机抽选 3 个
    const shuffled = pool.slice().sort(() => Math.random() - 0.5);
    candidateForks = shuffled.slice(0, 3);
    currentIndex = 0;
  }

  /** 渲染当前选中的副本卡片 */
  async function renderCurrentFork() {
    // 权限范围内无可接入副本：切入受限公文空态
    if (!candidateForks || candidateForks.length === 0) {
      applyRestrictedState(true);
      return;
    }
    const fork = candidateForks[currentIndex];
    if (!fork) {
      applyRestrictedState(true);
      return;
    }

    applyRestrictedState(false);

    // 清理先前的 ObjectUrl
    if (currentObjectUrl) {
      URL.revokeObjectURL(currentObjectUrl);
      currentObjectUrl = null;
    }

    // 1. 等级与代号
    const lvlKey = (fork.levelKey || 'E').toUpperCase();
    const lvlInfo = LEVEL_MAP[lvlKey] || LEVEL_MAP['E'];
    const lvlSvg = LEVEL_SVGS[lvlKey] || LEVEL_SVGS['E'];

    if (itemLevelIconEl) itemLevelIconEl.innerHTML = lvlSvg;
    if (itemLevelCodeEl) itemLevelCodeEl.textContent = lvlInfo.letter;
    if (itemLevelNameEl) itemLevelNameEl.textContent = lvlInfo.name;

    const seqNum = Number(fork.seq);
    const hasSeq = Number.isFinite(seqNum) && seqNum > 0;
    const paddedIndex = hasSeq ? String(seqNum).padStart(2, '0') : '01';
    if (itemCodeEl) itemCodeEl.textContent = fork.code || `FORK-${paddedIndex}`;

    // 2. 实木画框底色调
    const toneSeed = hasSeq ? seqNum - 1 : currentIndex;
    const tone = fork.tone || TONE_CYCLE[toneSeed % TONE_CYCLE.length];
    if (oilFrameEl) {
      oilFrameEl.className = `fork-oil-frame tone-${tone}`;
    }

    // 3. 异步装载封面
    let loadedCover = false;
    if (canvasMediaEl) {
      // 保持底衬与图腾结构
      canvasMediaEl.innerHTML = `
        <div class="fork-canvas-texture"></div>
        <div class="fork-canvas-art-center">
          <div class="fork-art-motif">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" fill-opacity="0.35"/>
            </svg>
          </div>
        </div>
      `;

      if (window.Storage && fork.hasCover) {
        try {
          const key = window.DataRegistry ? DataRegistry.key.forkCover(fork.id) : `fork/cover.${fork.id}`;
          const src = await Storage.getAssetSrc(key);
          if (src) {
            currentObjectUrl = src;
            const img = document.createElement('img');
            img.className = 'fork-canvas-img';
            img.src = src;
            img.alt = fork.title || '副本封面';
            canvasMediaEl.appendChild(img);
            if (oilFrameEl) oilFrameEl.classList.add('has-cover');
            loadedCover = true;
          }
        } catch (_) {}
      }

      if (!loadedCover && oilFrameEl) {
        oilFrameEl.classList.remove('has-cover');
      }
    }

    // 4. 指示器 [ 01 / 03 ]
    if (stepNumEl) stepNumEl.textContent = String(currentIndex + 1).padStart(2, '0');
    if (stepTotalEl) stepTotalEl.textContent = String(candidateForks.length).padStart(2, '0');

    // 5. 标题与概述
    if (titleEl) titleEl.textContent = fork.title || '未命名副本';
    if (descEl) {
      const overview = String(fork.overview || fork.desc || '').trim();
      if (overview) {
        descEl.textContent = overview;
        descEl.classList.remove('is-empty');
      } else {
        descEl.textContent = '// 副本接入准备中，等待执行员下潜干涉。';
        descEl.classList.add('is-empty');
      }
    }

    // 6. 三联机能徽标行
    // 身份机制
    const isLocked = fork.identityType === 'locked';
    if (chipIdentityText) chipIdentityText.textContent = isLocked ? '锁定身份' : '自由身份';

    // 人数容量
    if (chipCapacityText) {
      const envoys = (window.Store && typeof Store.forkEnvoyCapacity === 'function')
        ? Store.forkEnvoyCapacity(fork)
        : Math.min(5, Math.max(1, Number(fork.maxEnvoys) || 1));
      chipCapacityText.textContent = isLocked ? `${envoys} 席位` : `容纳 ${envoys} 人`;
    }

    // 主线任务数
    if (chipObjectivesText) {
      const count = (window.Store && typeof Store.forkObjectiveCount === 'function')
        ? Store.forkObjectiveCount(fork)
        : (Array.isArray(fork.clearConditions) ? fork.clearConditions.length : 0);
      chipObjectivesText.textContent = `${count} 项主线任务`;
    }
  }

  /** 重新抽取候选副本 */
  function reroll() {
    pickCandidateForks();
    renderCurrentFork();

    const level = getCurrentLevel();
    const hasCandidates = candidateForks && candidateForks.length > 0;

    if (window.RetroToast) {
      if (hasCandidates) {
        window.RetroToast.show({
          tag: 'DIVE // 因果雷达',
          message: '世界线频段已重新调谐',
          detail: `符合 ${level} 权限等级的 ${candidateForks.length} 份卷宗已推演成形`,
          type: 'info'
        });
      } else {
        const allowed = LEVEL_PERMISSIONS[level] || LEVEL_PERMISSIONS['LV.1'];
        window.RetroToast.show({
          tag: 'DENIED // 权限管制',
          message: '未检索到符合权限的时空分支',
          detail: `${level} 仅可接入 ${formatAllowedLevels(allowed)} 级副本，禁止越级下潜`,
          type: 'warning'
        });
      }
    }
  }

  /** 选定副本转场（派发事件并通知准备页） */
  function dispatchForkChosen(fork) {
    console.log('[ForkPickUI] 执行员选定副本：', fork.id, fork.title);

    // 派发全局事件
    const event = new CustomEvent('retroflow:fork-chosen', {
      detail: { forkId: fork.id, fork }
    });
    window.dispatchEvent(event);

    // 转场至准备页：保留 #fork-pick 这层历史，仅静默收起本页视图，
    // 让准备页自己压栈，全程只有一次历史变更，避免 back() 的异步 popstate 把新记录弹掉。
    if (window.ForkReadyUI && typeof ForkReadyUI.open === 'function') {
      close(true);
      ForkReadyUI.open(fork);
    }
  }

  /** 读取当前执行员编号（单一真相源） */
  function getEnvoySerialNo() {
    try {
      if (window.Store && typeof Store.getSerialNo === 'function') {
        const s = Store.getSerialNo();
        if (s) return s;
      }
      if (window.RetroflowProfile && typeof RetroflowProfile.getSerialId === 'function') {
        const s = RetroflowProfile.getSerialId();
        if (s) return s;
      }
    } catch (_) {}
    return '------';
  }

  /** 打开挑选页 */
  function open() {
    ensureElements();
    if (!pageEl) return;

    // 回填执行员编号致辞
    if (envoySerialEl) {
      envoySerialEl.textContent = getEnvoySerialNo();
    }

    pickCandidateForks();
    renderCurrentFork();
    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      pageEl.classList.add('active');
    });

    isOpened = true;

    // Hash 路由保护
    if (window.location.hash !== '#fork-pick') {
      window.history.pushState({ modal: 'fork-pick' }, '', '#fork-pick');
    }
  }

  /**
   * 关闭挑选页
   *
   * @param {boolean} silent 为 true 时只收起视图、不触碰 history。
   *   转场到准备页必须走静默模式：close() 内部的 history.back() 是异步的，
   *   其 popstate 会在准备页 pushState('#fork-ready') 之后才到达，
   *   把刚压入的记录弹掉，结果直接退回桌面（与 online-ui 同款陷阱）。
   */
  function close(silent) {
    if (!pageEl || !isOpened) return;

    pageEl.classList.remove('active');
    setTimeout(() => {
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
    }, 240);

    isOpened = false;

    if (!silent && window.location.hash === '#fork-pick') {
      window.history.back();
    }
  }

  /** 响应桌面与 Dock 栏的快速 DIVE 请求：若有活跃推演则秒回现场，否则开挑选页 */
  async function handleFastDive() {
    if (window.ForkRunStore && typeof ForkRunStore.findOngoingActiveFork === 'function') {
      try {
        const active = await ForkRunStore.findOngoingActiveFork();
        if (active && active.forkId && window.ForkRunUI && typeof ForkRunUI.open === 'function') {
          await ForkRunUI.open(active.forkId, { runId: active.runId });
          return;
        }
      } catch (err) {
        console.warn('[ForkPickUI] 探测活跃副本失败，回落挑选页：', err);
      }
    }
    open();
  }

  /** 初始化全局事件监听（桌面红卡与 Dock 栏快速下潜打通） */
  function init() {
    ensureElements();

    // 1. 桌面红卡右下角「DIVE // 进入副本」抽拉标签
    const profileFolderTab = document.querySelector('.profile-folder-tab');
    if (profileFolderTab) {
      profileFolderTab.addEventListener('click', (e) => {
        e.preventDefault();
        handleFastDive();
      });
    }

    // 2. 底部 Dock 栏「快速下潜」中央反应堆按键
    const dockDiveCore = document.querySelector('.dock-dive-core[data-action="quick-dive"]');
    if (dockDiveCore) {
      dockDiveCore.addEventListener('click', (e) => {
        e.preventDefault();
        handleFastDive();
      });
    }

    // 3. 监听浏览器前进后退 PopState
    window.addEventListener('popstate', () => {
      // 准备页在本页之上时，这次返回归它处理（它会负责静默收起并唤回本页）。
      // 以 isOpen() 状态为准：准备页的 hidden 是延迟 240ms 才落的，用 DOM 判定会误判。
      if (window.ForkReadyUI && typeof ForkReadyUI.isOpen === 'function' && ForkReadyUI.isOpen()) return;

      if (isOpened && window.location.hash !== '#fork-pick') {
        pageEl.classList.remove('active');
        setTimeout(() => {
          pageEl.hidden = true;
          pageEl.setAttribute('aria-hidden', 'true');
          if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
          }
        }, 240);
        isOpened = false;
      }
    });
  }

  // 页面加载完成后自挂载
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    open,
    close,
    reroll
  };
})();

window.ForkPickUI = ForkPickUI;
