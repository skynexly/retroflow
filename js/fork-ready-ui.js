/**
 * 溯流计划 · 副本下潜准备全屏视图控制器 (Fork Ready UI Controller)
 * 职责：
 *  1. 承接从挑选页选定副本后的特勤就绪整备工作区 (Fork Ready View)
 *  2. 回显副本卷宗简报，并提供「查看副本」次操作入口
 *  3. 自由身份模式下提供接驳身份插槽，支持在执行员本人与所有马甲间自由切换，或一键跳转新建马甲
 *  4. 依据副本容纳人数动态构建同行者席位编制
 *  5. 提供「单人模式 / 组队模式 / 补位匹配」三维下潜模式公文条款切换与主操作决断
 *  6. 严格遵守《工地施工协议》：全量 SVG 图标、零 emoji、零物理分割线、iOS 灵动岛与手势区保护
 */

const ForkReadyUI = (() => {
  'use strict';

  // DOM 节点引用
  let pageEl = null;
  let backBtn = null;
  let viewBtn = null;
  let itemCodeEl = null;
  let titleEl = null;
  let levelCrestBtn = null;
  let levelCrestIcon = null;
  let overviewEl = null;
  let chipIdentityText = null;
  let chipCapacityText = null;
  let chipObjectivesText = null;

  let synapseSlot = null;
  let slotAvatar = null;
  let slotPlaceholder = null;
  let slotBadge = null;
  let slotName = null;
  let slotSerial = null;
  let slotDesc = null;

  let teamCapacityText = null;
  let rosterStream = null;

  let modeClause = null;
  let modeCrestBox = null;
  let modeNameEl = null;
  let modeEnEl = null;
  let modeDescEl = null;
  let launchBtn = null;
  let launchText = null;

  // 开场公文条款 DOM 节点
  let openingClause = null;
  let openingCrestBox = null;
  let openingNameEl = null;
  let openingEnEl = null;
  let openingDescEl = null;
  let openingSwitchBtn = null;

  // 内部状态
  let isOpened = false;
  let currentFork = null;
  let selectedIdentity = null; // { type: 'persona' | 'mask', id: string, name: string, serial: string, desc: string, avatarUrl: string | null }
  let selectedOpeningId = null; // 当前选定的开场 ID
  let currentMode = 'solo'; // 'solo' | 'team' | 'fill'
  // 已邀请的同行者名册（预留：联络通讯信标接通后由此驱动席位与组队模式可用性）
  let invitedCompanions = [];
  // 立绘 objectURL 台账：getAssetSrc 可能返回持久 URL（type=url），
  // 只有 blob: 开头的才是本页创建的临时句柄，退场时仅回收这一类，避免误伤外链图。
  let liveObjectUrls = [];

  /**
   * 水相因果评级字典（七档水相意象，单一真相源）
   */
  const LEVEL_MAP = {
    'E': { letter: 'E', name: '静水', enName: 'STILL', priv: 'LV.1 准入' },
    'D': { letter: 'D', name: '流深', enName: 'DEPTH', priv: 'LV.2 准入' },
    'C': { letter: 'C', name: '清源', enName: 'SPRING', priv: 'LV.2 准入' },
    'B': { letter: 'B', name: '狂澜', enName: 'SURGE', priv: 'LV.4 准入' },
    'A': { letter: 'A', name: '潮汐', enName: 'TIDE', priv: 'LV.5 准入' },
    'S': { letter: 'S', name: '深渊', enName: 'ABYSS', priv: 'LV.5 准入' },
    'S+': { letter: 'S+', name: '归墟', enName: 'VORTEX', priv: 'LV.6 准入' }
  };

  /**
   * 纯 SVG 7档战术水相微图腾 (禁止emoji，纯矢量机能线条)
   */
  const LEVEL_SVGS = {
    'E': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'D': `<svg viewBox="0 0 16 16" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'C': `<svg viewBox="0 0 16 16" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    'B': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'A': `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    'S': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    'S+': `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  /**
   * 下潜模式字典（单一真相源）。
   * zh/en 供条款标题回显，desc 为条款正文完整释义，brief 为切换弹窗内的精简摘要，
   * crestSvg 为专属纯 SVG 特勤契约几何印章徽标，launch 为底部决断主按键的文案。
   */
  const DIVE_MODES = [
    {
      value: 'solo',
      zh: '单人模式',
      en: 'SOLO',
      brief: '独自进入，独享全部结算',
      launch: '启动单人下潜',
      crestSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <!-- 外层细圆与四向战术对齐刻度 -->
          <circle cx="12" cy="12" r="9.5" stroke-opacity="0.35"/>
          <line x1="12" y1="1" x2="12" y2="4"/>
          <line x1="12" y1="20" x2="12" y2="23"/>
          <line x1="1" y1="12" x2="4" y2="12"/>
          <line x1="20" y1="12" x2="23" y2="12"/>
          <!-- 核心：孤立单兵正菱形与绝对因果点 -->
          <polygon points="12,6 18,12 12,18 6,12" stroke-width="1.4"/>
          <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
        </svg>
      `,
      desc: '独自一人进入副本，独立完成全部主线任务。无论该副本允许接入多少名执行员，此模式下副本内始终只有你一人。结算时独享全部积分与经验值。'
    },
    {
      value: 'team',
      zh: '组队模式',
      en: 'TEAM',
      brief: '与邀请的队友共享同一份主线任务',
      launch: '启动协同下潜',
      crestSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <!-- 契约双环互锁拓扑拓扑线 (Linked Resonant Rings) -->
          <circle cx="9" cy="12" r="5.5" stroke-width="1.35"/>
          <circle cx="15" cy="12" r="5.5" stroke-width="1.35"/>
          <!-- 核心协同交叠双向信标点 -->
          <circle cx="9" cy="12" r="1.3" fill="currentColor"/>
          <circle cx="15" cy="12" r="1.3" fill="currentColor"/>
          <!-- 上下战术同调对准准星 -->
          <line x1="12" y1="3" x2="12" y2="6" stroke-opacity="0.6"/>
          <line x1="12" y1="18" x2="12" y2="21" stroke-opacity="0.6"/>
        </svg>
      `,
      desc: '与你邀请的队友共同进入副本，共享同一份主线任务并协力完成。结算时按贡献度在队内分配积分与经验值。'
    },
    {
      value: 'fill',
      zh: '补位匹配',
      en: 'FILL',
      brief: '空缺席位由系统随机匹配填补',
      launch: '启动匹配下潜',
      crestSvg: `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <!-- 虚实双环拓扑：左侧在役实环 + 右侧待补位虚线环 -->
          <circle cx="9" cy="12" r="5.5" stroke-width="1.35"/>
          <circle cx="15" cy="12" r="5.5" stroke-width="1.35" stroke-dasharray="2.5 1.8" stroke-opacity="0.75"/>
          <!-- 左侧已就绪信标实心锚点 -->
          <circle cx="9" cy="12" r="1.3" fill="currentColor"/>
          <!-- 上下战术同调对准刻度 -->
          <line x1="12" y1="3" x2="12" y2="6" stroke-opacity="0.6"/>
          <line x1="12" y1="18" x2="12" y2="21" stroke-opacity="0.6"/>
        </svg>
      `,
      desc: '副本的空缺席位由系统随机匹配其他执行员填补。他们可能与你共享同一份主线任务，也可能被分配了截然不同的任务，因此你们之间可能互不相干、彼此协力，亦可能敌对。结算时你的积分与经验值独立核算，不与匹配到的执行员共享；若你带有队友，则在队内按贡献度分配。'
    }
  ];

  /** 按 value 取模式条目，取不到兜底单人模式 */
  function getModeEntry(value) {
    return DIVE_MODES.find((m) => m.value === value) || DIVE_MODES[0];
  }

  /**
   * 判定各下潜模式在当前副本编制下是否可选。
   * 规则（与副本编制、已邀请队友数强绑定）：
   *   - 单人模式：恒可选；
   *   - 组队模式：副本需允许多人进入，且已至少邀请一名队友；
   *   - 补位匹配：副本需允许多人进入，且尚有空缺席位（未满员）。
   * @returns {object} { solo: {ok, reason}, team: {...}, fill: {...} }
   */
  function evaluateModeAvailability() {
    const maxEnvoys = getEnvoyCapacity(currentFork);
    const companionCapacity = Math.max(0, maxEnvoys - 1);
    const invited = invitedCompanions.length;
    // 在役人数 = 执行员本人 + 已邀请队友
    const occupied = 1 + invited;

    const soloOnly = companionCapacity <= 0;

    return {
      solo: { ok: true, reason: '' },
      team: soloOnly
        ? { ok: false, reason: '当前副本仅限一名执行员进入，无法组队。' }
        : (invited <= 0
          ? { ok: false, reason: '尚未邀请任何队友，请先在同行者席位发出邀请。' }
          : { ok: true, reason: '' }),
      fill: soloOnly
        ? { ok: false, reason: '当前副本仅限一名执行员进入，没有可补位的席位。' }
        : (occupied >= maxEnvoys
          ? { ok: false, reason: '同行者席位已满员，没有空缺席位可供匹配。' }
          : { ok: true, reason: '' })
    };
  }

  /** 获取执行员本人序列号（单一真相源） */
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
    return '000000';
  }

  /** 登记本页创建的 blob 句柄，供退场时统一回收 */
  function trackObjectUrl(src) {
    if (typeof src === 'string' && src.indexOf('blob:') === 0 && liveObjectUrls.indexOf(src) === -1) {
      liveObjectUrls.push(src);
    }
    return src;
  }

  /** 获取本人立绘（走 getAssetSrc，同时兼容 Blob 与 URL 两种存储形态） */
  async function loadPersonaAvatar() {
    try {
      if (window.Storage && typeof Storage.getAssetSrc === 'function' && window.DataRegistry) {
        const src = await Storage.getAssetSrc(DataRegistry.key.personaAvatar());
        if (src) return trackObjectUrl(src);
      }
    } catch (e) {
      console.warn('[ForkReadyUI] 本人立绘读取失败：', e);
    }
    return null;
  }

  /** 获取马甲立绘（走 getAssetSrc，同时兼容 Blob 与 URL 两种存储形态） */
  async function loadMaskAvatar(maskId) {
    try {
      if (window.Storage && typeof Storage.getAssetSrc === 'function' && window.DataRegistry && maskId) {
        const src = await Storage.getAssetSrc(DataRegistry.key.maskAvatar(maskId));
        if (src) return trackObjectUrl(src);
      }
    } catch (e) {
      console.warn('[ForkReadyUI] 马甲立绘读取失败：', e);
    }
    return null;
  }

  /** 压成单行摘要：吃掉换行与多余空白，超长截断，供公文条款与弹窗 hint 共用 */
  function toSummaryLine(text, maxLen) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const limit = Number(maxLen) || 40;
    return s.length > limit ? s.slice(0, limit) + '…' : s;
  }

  /**
   * 读取执行员本人档案摘要（单一真相源：Store.envoy.identity）
   * 核心设定 profile 优先，其次外貌 appearance，最后兜底文案。
   */
  function readPersonaProfile() {
    let name = '';
    let desc = '';
    try {
      if (window.Store && Store.envoy && Store.envoy.identity) {
        const identity = Store.envoy.identity;
        name = String(identity.name || '').trim();
        desc = String(identity.profile || '').trim() || String(identity.appearance || '').trim();
      }
      // 姓名兜底：档案未填名时沿用桌面红卡的装饰名
      if (!name && window.Store && Store.decor) {
        name = String(Store.decor.cardName || '').trim();
      }
    } catch (_) {}

    return {
      name: name || '执行员',
      desc: desc || '核心设定尚未录入，心智屏障维持默认配置。'
    };
  }

  /** 获取默认本人身份对象 */
  async function getDefaultPersonaIdentity() {
    const { name, desc } = readPersonaProfile();
    const avatarUrl = await loadPersonaAvatar();
    return {
      type: 'persona',
      id: 'persona',
      name,
      serial: `NO.${getEnvoySerialNo()}`,
      desc,
      avatarUrl
    };
  }

  /** 折算副本可接入执行员总数（含本人），统一走 Store 的单一真相源 */
  function getEnvoyCapacity(fork) {
    if (window.Store && typeof Store.forkEnvoyCapacity === 'function') {
      return Store.forkEnvoyCapacity(fork);
    }
    // Store 未就绪时的保守回落
    if (!fork) return 1;
    if (fork.identityType === 'locked' && Array.isArray(fork.lockedRoles) && fork.lockedRoles.length) {
      return Math.max(1, fork.lockedRoles.length);
    }
    return Math.min(5, Math.max(1, Number(fork.maxEnvoys) || 1));
  }

  /** 统计主线任务数，统一走 Store 的单一真相源 */
  function getObjectiveCount(fork) {
    if (window.Store && typeof Store.forkObjectiveCount === 'function') {
      return Store.forkObjectiveCount(fork);
    }
    if (!fork) return 0;
    if (Array.isArray(fork.clearConditions)) return fork.clearConditions.length;
    if (Array.isArray(fork.objectives)) return fork.objectives.length;
    const cached = Math.floor(Number(fork.objectiveCount));
    return Number.isFinite(cached) && cached > 0 ? cached : 0;
  }

  /**
   * 补齐副本在轻量索引里缺失的字段（接入编制 + 主线目标数）。
   * fork.index 是轻量索引，早期版本没往里写 identityType / maxEnvoys /
   * lockedRoles / objectiveCount，存量副本读出来这几个字段是 undefined，
   * 会被兜底成「自由身份 1 人、0 项目标」。
   * 这里对缺字段的副本按需读一次卷宗本体补齐，读不到就保持原值。
   */
  async function ensureForkCapacity(fork) {
    if (!fork || !fork.id) return fork;

    // 任一字段缺失就得补读：
    // 自由身份缺 maxEnvoys 会兜底成 1 人；锁定身份缺 lockedRoles 算不出席位数；
    // 缺 clearConditions 与 objectiveCount 则统计不出主线目标数。
    const missingType = fork.identityType === undefined;
    const missingMax = fork.maxEnvoys === undefined;
    const missingRoles = fork.identityType === 'locked' && !Array.isArray(fork.lockedRoles);
    const missingObjectives = !Array.isArray(fork.clearConditions)
      && !Array.isArray(fork.objectives)
      && fork.objectiveCount === undefined;
    const missingOpenings = !Array.isArray(fork.openings);
    if (!missingType && !missingMax && !missingRoles && !missingObjectives && !missingOpenings) return fork;

    try {
      if (window.Store && typeof Store.loadForkDossier === 'function') {
        const dossier = await Store.loadForkDossier(fork.id);
        if (dossier) {
          if (fork.identityType === undefined) fork.identityType = dossier.identityType;
          if (fork.maxEnvoys === undefined) fork.maxEnvoys = dossier.maxEnvoys;
          if (!Array.isArray(fork.lockedRoles) && Array.isArray(dossier.lockedRoles)) {
            fork.lockedRoles = dossier.lockedRoles;
          }
          if (!Array.isArray(fork.clearConditions) && Array.isArray(dossier.clearConditions)) {
            fork.clearConditions = dossier.clearConditions;
          }
          if (!Array.isArray(fork.openings) && Array.isArray(dossier.openings)) {
            fork.openings = dossier.openings;
          }
          if (fork.opening === undefined && dossier.opening !== undefined) {
            fork.opening = dossier.opening;
          }
          if (fork.prologue === undefined && dossier.prologue !== undefined) {
            fork.prologue = dossier.prologue;
          }
        }
      }
    } catch (e) {
      console.warn('[ForkReadyUI] 补齐副本编制与目标数失败：', e);
    }
    return fork;
  }

  /** 初始化 DOM 引用并绑定事件 */
  function ensureElements() {
    if (pageEl) return;
    pageEl = document.getElementById('forkReadyPage');
    if (!pageEl) return;

    backBtn = document.getElementById('forkReadyBackBtn');
    viewBtn = document.getElementById('forkReadyViewBtn');
    itemCodeEl = document.getElementById('forkReadyItemCode');
    titleEl = document.getElementById('forkReadyTitle');
    levelCrestBtn = document.getElementById('forkReadyLevelCrestBtn');
    levelCrestIcon = document.getElementById('forkReadyLevelCrestIcon');
    overviewEl = document.getElementById('forkReadyOverview');
    chipIdentityText = document.getElementById('forkReadyChipIdentityText');
    chipCapacityText = document.getElementById('forkReadyChipCapacityText');
    chipObjectivesText = document.getElementById('forkReadyChipObjectivesText');

    synapseSlot = document.getElementById('forkReadySynapseSlot');
    slotAvatar = document.getElementById('forkReadySlotAvatar');
    slotPlaceholder = document.getElementById('forkReadySlotPlaceholder');
    slotBadge = document.getElementById('forkReadySlotBadge');
    slotName = document.getElementById('forkReadySlotName');
    slotSerial = document.getElementById('forkReadySlotSerial');
    slotDesc = document.getElementById('forkReadySlotDesc');

    teamCapacityText = document.getElementById('forkReadyTeamCapacityText');
    rosterStream = document.getElementById('forkReadyRosterStream');

    modeClause = document.getElementById('forkReadyModeClause');
    modeCrestBox = document.getElementById('forkReadyModeCrest');
    modeNameEl = document.getElementById('forkReadyModeName');
    modeEnEl = document.getElementById('forkReadyModeEn');
    modeDescEl = document.getElementById('forkReadyModeDesc');
    launchBtn = document.getElementById('forkReadyLaunchBtn');
    launchText = document.getElementById('forkReadyLaunchText');

    openingClause = document.getElementById('forkReadyOpeningClause');
    openingCrestBox = document.getElementById('forkReadyOpeningCrest');
    openingNameEl = document.getElementById('forkReadyOpeningName');
    openingEnEl = document.getElementById('forkReadyOpeningEn');
    openingDescEl = document.getElementById('forkReadyOpeningDesc');
    openingSwitchBtn = document.getElementById('forkReadyOpeningSwitchAction');

    // 返回按钮：通过回退历史栈退回挑选页
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        if (window.location.hash === '#fork-ready') {
          window.history.back();
        } else {
          close(true);
          if (window.ForkPickUI && typeof ForkPickUI.open === 'function') {
            ForkPickUI.open();
          }
        }
      });
    }

    // 查看副本资料按钮：打开副本资料公文档案页 (脱敏只读、四大情报章节)
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        if (!currentFork) return;
        if (window.ForkDocUI && typeof ForkDocUI.open === 'function') {
          ForkDocUI.open(currentFork, { openingId: selectedOpeningId });
        } else if (window.ForkArchiveUI && typeof ForkArchiveUI.openDossier === 'function') {
          ForkArchiveUI.openDossier(currentFork.id);
        } else if (window.RetroToast) {
          window.RetroToast.show({
            tag: 'FORK // 卷宗详情',
            message: currentFork.title || '副本详情',
            detail: `${currentFork.code || 'FORK'} · 等级 ${currentFork.levelKey || 'E'}`,
            type: 'info'
          });
        }
      });
    }

    // 副本等级水相徽标：点击唤起评定与结算 HUD 检视窗
    if (levelCrestBtn) {
      levelCrestBtn.addEventListener('click', () => {
        openForkLevelModal();
      });
    }

    // 点击身份插槽：若为锁定身份唤起画廊式「预设身份池」，自由身份唤起通用选择弹窗
    if (synapseSlot) {
      synapseSlot.addEventListener('click', () => {
        if (currentFork && currentFork.identityType === 'locked') {
          openLockedRoleModal();
        } else {
          openIdentityPickerModal();
        }
      });
    }

    // 开场档案条款：点击整条或切换动作链接唤起开场选择弹窗
    if (openingClause) {
      openingClause.addEventListener('click', () => {
        openOpeningPickerModal();
      });
      openingClause.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openOpeningPickerModal();
        }
      });
    }

    // 下潜模式条款：点击整条或回车／空格唤起模式切换弹窗
    if (modeClause) {
      modeClause.addEventListener('click', () => {
        openModePickerModal();
      });
      modeClause.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openModePickerModal();
        }
      });
    }

    // 主操作按键：开始下潜进入
    if (launchBtn) {
      launchBtn.addEventListener('click', () => {
        handleLaunch();
      });
    }
  }

  /**
   * 收集在当前接驳身份下可用的开场套列表。
   * 规则：
   *  - 锁定身份：命中 bindRoleIds.includes(roleId) 的专属开场 + bindRoleIds 为空的通用开场；
   *  - 自由身份：仅 bindRoleIds 为空的通用开场；
   *  - 若卷宗没有 openings 数组，则把根级 opening 字段封装为一套通用开场兜底。
   * @returns {Array<{ op: object, index: number, isExclusive: boolean }>}
   */
  function getAvailableOpenings() {
    if (!currentFork) return [];
    let list = Array.isArray(currentFork.openings) ? currentFork.openings : [];
    if (list.length === 0 && (currentFork.opening || currentFork.prologue)) {
      list = [{
        id: 'op_legacy_root',
        bindRoleIds: [],
        opening: currentFork.opening || '',
        prologue: currentFork.prologue || '',
        prologueRounds: currentFork.prologueRounds || 5,
        openingScene: currentFork.openingScene || {}
      }];
    }

    const isLocked = currentFork.identityType === 'locked';
    const roleId = (isLocked && selectedIdentity && selectedIdentity.type === 'preset')
      ? selectedIdentity.id
      : null;

    const available = [];
    list.forEach((op, idx) => {
      if (!op) return;
      const binds = Array.isArray(op.bindRoleIds) ? op.bindRoleIds : [];
      if (isLocked && roleId) {
        if (binds.includes(roleId)) {
          available.push({ op, index: idx, isExclusive: true });
        } else if (binds.length === 0) {
          available.push({ op, index: idx, isExclusive: false });
        }
      } else {
        if (binds.length === 0) {
          available.push({ op, index: idx, isExclusive: false });
        }
      }
    });

    return available;
  }

  /**
   * 确保 selectedOpeningId 在当前接驳身份下合法。
   * 若当前开场无效或未选，优先选中可用列表中的首个专属开场，无专属则选首个通用开场。
   */
  function syncOpeningSelection() {
    const available = getAvailableOpenings();
    if (available.length === 0) {
      selectedOpeningId = null;
      renderOpeningClause();
      return;
    }

    const stillValid = available.some((item) => item.op && item.op.id === selectedOpeningId);
    if (!stillValid) {
      // 优先专属开场，其次首个可用
      const firstExclusive = available.find((item) => item.isExclusive);
      selectedOpeningId = firstExclusive ? firstExclusive.op.id : available[0].op.id;
    }

    renderOpeningClause();
  }

  /** 渲染当前选定开场条款（编号 + 专属/通用微标 + 首帧摘要） */
  function renderOpeningClause() {
    if (!openingNameEl || !openingDescEl) return;

    const available = getAvailableOpenings();
    if (available.length === 0) {
      if (openingNameEl) openingNameEl.textContent = '自由推演';
      if (openingEnEl) openingEnEl.textContent = 'FREE FORM';
      if (openingDescEl) {
        openingDescEl.textContent = '当前身份未录入预置开场。载入锚点后，终端将协同模型实时推演首帧叙事。';
      }
      if (openingSwitchBtn) openingSwitchBtn.hidden = true;
      return;
    }

    if (openingSwitchBtn) {
      openingSwitchBtn.hidden = available.length <= 1;
    }

    let activeItem = available.find((item) => item.op && item.op.id === selectedOpeningId);
    if (!activeItem) activeItem = available[0];

    const numStr = String(activeItem.index + 1).padStart(2, '0');
    if (openingNameEl) openingNameEl.textContent = `开场 ${numStr}`;
    if (openingEnEl) {
      openingEnEl.textContent = activeItem.isExclusive ? 'EXCLUSIVE' : 'GENERAL';
    }

    const op = activeItem.op;
    let summary = (op && typeof op.opening === 'string' ? op.opening : '').trim();
    if (!summary && op && typeof op.prologue === 'string') {
      // 首帧留空时退回情节指引正文，摘要位置不标来源，完整内容在「查看副本资料」里看
      summary = op.prologue.trim();
    }
    if (!summary) {
      summary = '已就绪。首帧叙事由推演引擎依世界线推演生成。';
    }

    if (openingDescEl) {
      openingDescEl.textContent = toSummaryLine(summary, 100);
    }
  }

  /** 打开切换开场选择弹窗 */
  async function openOpeningPickerModal() {
    const available = getAvailableOpenings();
    if (available.length === 0) {
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'OPENING // 自由推演',
          message: '当前身份无预置开场，进本将自由推演',
          type: 'info'
        });
      }
      return;
    }

    if (available.length === 1) {
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'OPENING // 开场档案',
          message: '当前接驳身份仅有一套可用开场',
          type: 'info'
        });
      }
      return;
    }

    if (!window.SelectModal || typeof window.SelectModal.pick !== 'function') {
      return;
    }

    const options = available.map((item) => {
      const numStr = String(item.index + 1).padStart(2, '0');
      const kindLabel = item.isExclusive ? '专属绑定' : '通用开场';
      const rawText = (item.op && item.op.opening) || (item.op && item.op.prologue) || '';
      const snippet = toSummaryLine(rawText, 40);
      const descText = snippet ? `「${snippet}」` : '依世界线自由推演';
      return {
        value: item.op.id,
        label: `开场 ${numStr} · ${kindLabel}`,
        description: descText
      };
    });

    const picked = await window.SelectModal.pick({
      title: '切换载入开场',
      tag: 'OPENING // 开场档案',
      options: options,
      value: selectedOpeningId,
      searchable: options.length > 6
    });

    if (picked && picked !== selectedOpeningId) {
      selectedOpeningId = picked;
      renderOpeningClause();
    }
  }

  /** 渲染当前生效的下潜模式条款（徽标印鉴 + 名称 + 英文微标 + 完整释义 + 主按键文案） */
  function renderModeClause() {
    const entry = getModeEntry(currentMode);

    if (modeCrestBox) {
      modeCrestBox.innerHTML = entry.crestSvg || '';
    }
    if (modeNameEl) modeNameEl.textContent = entry.zh;
    if (modeEnEl) modeEnEl.textContent = entry.en;
    if (modeDescEl) modeDescEl.textContent = entry.desc;
    if (launchText) launchText.textContent = entry.launch;
  }

  /**
   * 设置下潜模式。
   * 会先校验该模式在当前编制下是否可选，不可选时拒绝切换并给出原因。
   * @param {string} mode 'solo' | 'team' | 'fill'
   * @param {boolean} silent 为 true 时不弹拒绝提示（供自动纠偏调用）
   */
  function setMode(mode, silent) {
    const entry = getModeEntry(mode);
    const availability = evaluateModeAvailability();
    const state = availability[entry.value];

    if (state && !state.ok) {
      if (!silent && window.RetroToast) {
        window.RetroToast.show({
          tag: 'LOCKED // 条件未满足',
          message: `「${entry.zh}」当前不可选`,
          detail: state.reason,
          type: 'info'
        });
      }
      return false;
    }

    currentMode = entry.value;
    renderModeClause();
    return true;
  }

  /**
   * 编制或队友变动后纠偏当前模式。
   * 例如原本选了补位匹配，换到单人副本后该模式失效，自动退回单人模式。
   */
  function syncModeAvailability() {
    const availability = evaluateModeAvailability();
    const state = availability[currentMode];
    if (state && !state.ok) {
      currentMode = 'solo';
    }
    renderModeClause();
  }

  /** 打开下潜模式切换弹窗（复用全局 SelectModal，带专属几何印章，不可选项置灰陈列） */
  async function openModePickerModal() {
    if (!window.SelectModal || typeof window.SelectModal.pick !== 'function') return;

    const availability = evaluateModeAvailability();

    const options = DIVE_MODES.map((m) => {
      const state = availability[m.value] || { ok: true, reason: '' };
      return {
        value: m.value,
        label: m.zh,
        hint: state.ok ? m.brief : state.reason,
        iconSvg: m.crestSvg,
        disabled: !state.ok,
        disabledReason: state.reason
      };
    });

    const picked = await window.SelectModal.pick({
      title: '选择下潜模式',
      tag: 'DIVE MODE // 下潜模式',
      options: options,
      value: currentMode,
      searchable: false
    });

    if (!picked) return; // 用户取消
    setMode(picked);
  }

  /** 渲染副本简报数据 */
  function renderDossier() {
    if (!currentFork) return;

    if (itemCodeEl) itemCodeEl.textContent = currentFork.code || 'FORK-001';
    if (titleEl) titleEl.textContent = currentFork.title || '未命名副本';

    // 右侧纯 SVG 水相徽标微印鉴（无文字、右对齐）
    const lvlKey = (currentFork.levelKey || 'E').toUpperCase();
    const lvlInfo = LEVEL_MAP[lvlKey] || LEVEL_MAP['E'];
    const lvlSvg = LEVEL_SVGS[lvlInfo.letter] || LEVEL_SVGS['E'];
    if (levelCrestIcon) {
      levelCrestIcon.innerHTML = lvlSvg;
    }
    if (levelCrestBtn) {
      levelCrestBtn.setAttribute('title', `副本等级：${lvlInfo.letter} // ${lvlInfo.name}（点击查看说明）`);
      levelCrestBtn.setAttribute('aria-label', `副本等级：${lvlInfo.letter} // ${lvlInfo.name}（点击查看说明）`);
    }

    const rawOverview = currentFork.overview || currentFork.desc || '';
    if (overviewEl) {
      if (rawOverview && rawOverview.trim().length > 0) {
        overviewEl.textContent = rawOverview.trim();
        overviewEl.classList.remove('is-empty');
      } else {
        overviewEl.textContent = '// 副本接入准备中，等待执行员下潜干涉。';
        overviewEl.classList.add('is-empty');
      }
    }

    // 身份机制
    const isLocked = currentFork.identityType === 'locked';
    if (chipIdentityText) {
      chipIdentityText.textContent = isLocked ? '锁定身份' : '自由身份';
    }

    // 人数容量
    const maxEnvoys = getEnvoyCapacity(currentFork);

    if (chipCapacityText) {
      chipCapacityText.textContent = isLocked ? `${maxEnvoys} 席位` : `容纳 ${maxEnvoys} 人`;
    }

    // 主线任务
    if (chipObjectivesText) {
      chipObjectivesText.textContent = `${getObjectiveCount(currentFork)} 项主线任务`;
    }
  }

  /** 渲染接驳身份插槽 */
  function renderSynapseSlot() {
    if (!selectedIdentity) return;

    if (slotName) slotName.textContent = selectedIdentity.name || '未命名身份';
    if (slotSerial) slotSerial.textContent = selectedIdentity.serial || 'NO.000000';
    if (slotDesc) {
      slotDesc.textContent = toSummaryLine(selectedIdentity.desc, 36)
        || '核心设定尚未录入，心智屏障维持默认配置。';
    }
    if (slotBadge) {
      if (currentFork && currentFork.identityType === 'locked' || selectedIdentity.type === 'preset') {
        slotBadge.textContent = '预设身份';
      } else {
        slotBadge.textContent = selectedIdentity.type === 'persona' ? '原始身份' : '马甲身份';
      }
    }

    if (selectedIdentity.avatarUrl) {
      if (slotAvatar) {
        slotAvatar.src = selectedIdentity.avatarUrl;
        slotAvatar.hidden = false;
      }
      if (slotPlaceholder) slotPlaceholder.hidden = true;
    } else {
      if (slotAvatar) {
        slotAvatar.src = '';
        slotAvatar.hidden = true;
      }
      if (slotPlaceholder) slotPlaceholder.hidden = false;
    }
  }

  /** 渲染同行者席位流 (锁定多角色双层公文流 vs 自由身份外部圆形席位) */
  function renderRosterStream() {
    if (!rosterStream || !currentFork) return;
    rosterStream.innerHTML = '';

    const isLocked = currentFork.identityType === 'locked';
    const lockedRoles = Array.isArray(currentFork.lockedRoles) ? currentFork.lockedRoles : [];
    const maxEnvoys = getEnvoyCapacity(currentFork);

    // 同行者容量：副本总编制减去执行员本人（1 席）
    const companionCapacity = maxEnvoys - 1;

    // 单人专属副本：零边框、零底色纯公文文本叙述
    if (companionCapacity <= 0) {
      if (teamCapacityText) {
        teamCapacityText.textContent = '单人专享';
      }
      const soloText = document.createElement('p');
      soloText.className = 'fork-ready-solo-deed-text';
      soloText.textContent = '当前副本仅限一名执行员进入。';
      rosterStream.appendChild(soloText);
      return;
    }

    // 锁定身份且池中有多预设角色：启用双层特勤公文结构（第一层邀请微条 + 第二层预设角色池清单）
    if (isLocked && lockedRoles.length > 1) {
      if (teamCapacityText) {
        teamCapacityText.textContent = `0 / ${companionCapacity} 席位`;
      }

      const container = document.createElement('div');
      container.className = 'fork-ready-locked-companions-wrap';

      // --- 第一层：邀请同行执行员条形栏 (左侧问号按钮+单行轻盈文案，右侧队友微缩头像) ---
      const inviteBar = document.createElement('div');
      inviteBar.className = 'fork-ready-invite-bar';
      inviteBar.innerHTML = `
        <div class="fork-ready-invite-left">
          <button type="button" class="fork-ready-invite-help-btn" id="forkReadyInviteHelpBtn"
            aria-label="查看邀请同行执行员说明" title="查看邀请同行执行员说明">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
              <path d="M12 17h.01"/>
            </svg>
          </button>
          <span class="fork-ready-invite-zh">邀请同行执行员 +</span>
        </div>
        <div class="fork-ready-invite-avatars" id="forkReadyInviteAvatars">
          <!-- 预留 4 个微缩席位插槽 (UI 阶段展示微弱占位信标) -->
          <div class="fork-ready-mini-avatar empty" title="待接入席位"></div>
          <div class="fork-ready-mini-avatar empty" title="待接入席位"></div>
        </div>
      `;
      container.appendChild(inviteBar);

      // 规则抽屉说明（点击问号展开/收起，零物理分割线，微暗背衬）
      const manualDrawer = document.createElement('div');
      manualDrawer.className = 'fork-ready-invite-manual-drawer';
      manualDrawer.hidden = true;
      manualDrawer.innerHTML = `
        <p class="fork-ready-invite-manual-text">你可以邀请其他执行员选择剩余的预设身份，与你共同进入副本。</p>
      `;
      container.appendChild(manualDrawer);

      const helpBtn = inviteBar.querySelector('#forkReadyInviteHelpBtn');
      if (helpBtn) {
        helpBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const willShow = manualDrawer.hidden;
          manualDrawer.hidden = !willShow;
          helpBtn.classList.toggle('active', willShow);
        });
      }

      // --- 第二层：未被当前玩家选择的预设角色圆形席位流 (上圆下名，点击唤起预设身份画廊查看身世) ---
      const avatarRow = document.createElement('div');
      avatarRow.className = 'fork-ready-preset-avatar-row';

      // 排除掉自己在 [ 01 ] 已选取的角色（转为字符串严密比对）
      const myRoleId = (selectedIdentity && selectedIdentity.type === 'preset' && selectedIdentity.id != null)
        ? String(selectedIdentity.id)
        : null;
      const unselectedRoles = lockedRoles.filter((r) => String(r.id) !== myRoleId);

      unselectedRoles.forEach((role) => {
        const fullIndex = lockedRoles.findIndex((r) => r.id === role.id);
        const seqStr = String((fullIndex >= 0 ? fullIndex : 0) + 1).padStart(2, '0');
        const roleCode = `ROLE-${seqStr}`;

        // 目前假定未被选择（后续多人组队接入队友真实状态）
        const isChosenByPeer = !!role.chosenByPeerName;
        const statusClass = isChosenByPeer ? 'is-peer-chosen' : 'is-unselected';

        const seatBtn = document.createElement('button');
        seatBtn.type = 'button';
        seatBtn.className = `fork-ready-preset-avatar-seat ${statusClass}`;
        seatBtn.setAttribute('aria-label', `查看预设角色 ${role.name || roleCode} 设定档案`);

        // 点击头像：打开预设身份画廊弹窗并定位到该角色
        seatBtn.addEventListener('click', () => {
          openLockedRoleModal(fullIndex >= 0 ? fullIndex : 0);
        });

        // 圆形头像框内结构：有图显示图+滤镜遮罩，无图显示默认特勤剪影
        let boxInnerHtml = '';
        if (role.avatar) {
          boxInnerHtml = `
            <img class="fork-ready-preset-avatar-img" src="${escapeHtml(role.avatar)}" alt="${escapeHtml(role.name || roleCode)}" loading="lazy">
            <div class="fork-ready-preset-avatar-overlay" aria-hidden="true"></div>
          `;
        } else {
          boxInnerHtml = `
            <div class="fork-ready-preset-avatar-ph" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
              </svg>
            </div>
            <div class="fork-ready-preset-avatar-overlay" aria-hidden="true"></div>
          `;
        }

        seatBtn.innerHTML = `
          <div class="fork-ready-preset-avatar-box">
            ${boxInnerHtml}
          </div>
          <span class="fork-ready-preset-avatar-name">${escapeHtml(role.name || roleCode)}</span>
          <span class="fork-ready-preset-avatar-code">${roleCode}</span>
        `;

        avatarRow.appendChild(seatBtn);
      });

      container.appendChild(avatarRow);
      rosterStream.appendChild(container);
      return;
    }

    // 自由身份多人副本：展示纯外部同行者的席位配额（当前就绪 0 位）
    if (teamCapacityText) {
      teamCapacityText.textContent = `0 / ${companionCapacity} 席位`;
    }

    const row = document.createElement('div');
    row.className = 'fork-ready-circle-roster-row';

    // 仅渲染 companionCapacity 个纯圆待邀请席位槽（上圆下名，无卡片外框、无杂音字标）
    for (let i = 1; i <= companionCapacity; i++) {
      const seatBtn = document.createElement('button');
      seatBtn.type = 'button';
      seatBtn.className = 'fork-ready-circle-seat is-empty';
      seatBtn.setAttribute('aria-label', `邀请第 ${i} 位同行执行员`);
      seatBtn.innerHTML = `
        <div class="fork-ready-circle-box">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
          </svg>
        </div>
        <span class="fork-ready-circle-name">邀请</span>
      `;

      seatBtn.addEventListener('click', () => {
        if (window.RetroToast) {
          window.RetroToast.show({
            tag: 'LINK // 协同链路',
            message: '联络通讯信标处于待命中',
            detail: '可选择「补位匹配」或「单人模式」直接开始推演',
            type: 'info'
          });
        }
      });

      row.appendChild(seatBtn);
    }

    rosterStream.appendChild(row);
  }

  /** 打开身份选择通用弹窗（复用全局 SelectModal，文案严格对齐：原始身份 / 马甲身份） */
  async function openIdentityPickerModal() {
    if (!window.SelectModal || typeof window.SelectModal.pick !== 'function') return;

    // 1. 本人数据
    // 1. 本人数据（单一真相源：Store.envoy.identity，核心设定优先）
    const personaProfile = readPersonaProfile();
    const personaName = personaProfile.name;
    const personaDesc = personaProfile.desc;

    // 2. 马甲库数据
    let masks = [];
    try {
      if (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) {
        masks = Store.envoy.masks.filter(Boolean);
      }
    } catch (_) {}

    const envoySerial = getEnvoySerialNo();

    // 构造 SelectModal 选项列表：编号在前，紧随核心设定摘要
    const options = [
      {
        value: 'persona',
        label: personaName,
        hint: `NO.${envoySerial} · ${toSummaryLine(personaDesc, 42)}`,
        group: '原始身份'
      }
    ];

    masks.forEach((mask, index) => {
      const serialNo = mask.serialNo || String(index + 1).padStart(2, '0');
      const maskDesc = String(mask.profile || '').trim() || String(mask.appearance || '').trim();
      options.push({
        value: mask.id,
        label: mask.name || '未命名马甲',
        hint: `MASK.${serialNo} · ${toSummaryLine(maskDesc, 42) || '核心设定尚未录入'}`,
        group: '马甲身份'
      });
    });

    // 提供直接跳转编纂新马甲的选项
    options.push({
      value: '__CREATE_NEW_MASK__',
      label: '+ 编纂新马甲档案',
      hint: '前往个人档案库新建伪装马甲',
      group: '马甲身份'
    });

    const currentVal = selectedIdentity ? selectedIdentity.id : 'persona';

    const picked = await window.SelectModal.pick({
      title: '选择接驳身份',
      tag: 'SYNAPSE // 神经接驳',
      options: options,
      value: currentVal,
      searchable: options.length > 7
    });

    if (!picked) return; // 用户取消

    // 特殊选项：跳转编纂新马甲
    if (picked === '__CREATE_NEW_MASK__') {
      if (window.RetroflowPersonaUI && typeof RetroflowPersonaUI.open === 'function') {
        RetroflowPersonaUI.open('mask');
      } else if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'VAULT // 马甲库',
          message: '请前往个人档案模块编纂新马甲',
          type: 'info'
        });
      }
      return;
    }

    // 选中原始身份
    if (picked === 'persona') {
      const personaAvatarUrl = await loadPersonaAvatar();
      selectedIdentity = {
        type: 'persona',
        id: 'persona',
        name: personaName,
        serial: `NO.${envoySerial}`,
        desc: personaDesc,
        avatarUrl: personaAvatarUrl
      };
    } else {
      // 选中特定马甲
      const targetMask = masks.find(m => m.id === picked);
      if (targetMask) {
        const maskAvatarUrl = await loadMaskAvatar(targetMask.id);
        const idx = masks.indexOf(targetMask);
        const serialNo = targetMask.serialNo || String(idx + 1).padStart(2, '0');
        const maskDesc = String(targetMask.profile || '').trim()
          || String(targetMask.appearance || '').trim();
        selectedIdentity = {
          type: 'mask',
          id: targetMask.id,
          name: targetMask.name || '未命名马甲',
          serial: `MASK.${serialNo}`,
          desc: maskDesc || '核心设定尚未录入，伪装屏障维持默认配置。',
          avatarUrl: maskAvatarUrl
        };
      }
    }

    renderSynapseSlot();
    renderRosterStream();
    syncOpeningSelection();
  }

  /** 处理最终下潜指令 */
  function handleLaunch() {
    if (!currentFork) return;

    // 出发前再校验一次：编制或队友在选定后可能已变动
    const availability = evaluateModeAvailability();
    const state = availability[currentMode];
    if (state && !state.ok) {
      syncModeAvailability();
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'LOCKED // 条件未满足',
          message: '下潜模式已失效，已退回单人模式',
          detail: state.reason,
          type: 'info'
        });
      }
      return;
    }

    const modeEntry = getModeEntry(currentMode);

    console.log('[ForkReadyUI] 下潜准备就绪，提交载荷：', {
      forkId: currentFork.id,
      identity: selectedIdentity,
      mode: currentMode,
      companions: invitedCompanions
    });

    const targetFork = currentFork;
    const targetIdentity = selectedIdentity;
    const targetMode = currentMode;
    const targetOpeningId = selectedOpeningId;

    // 触发跃迁时空终端流式动画与异步预加载
    if (window.ForkTransitionUI && typeof ForkTransitionUI.play === 'function') {
      // 启动全屏跃迁动画，并在动画期间预加载推演终端
      ForkTransitionUI.play({
        fork: targetFork,
        identity: targetIdentity,
        mode: targetMode,
        openingId: targetOpeningId
      }).then(() => {
        close(true);
        if (window.ForkRunUI && typeof ForkRunUI.open === 'function') {
          ForkRunUI.open(targetFork.id, {
            identity: targetIdentity,
            mode: targetMode,
            openingId: targetOpeningId,
            instant: true
          });
        } else if (window.RetroflowForkRunUI && typeof RetroflowForkRunUI.openRun === 'function') {
          RetroflowForkRunUI.openRun(targetFork.id, {
            identity: targetIdentity,
            mode: targetMode,
            openingId: targetOpeningId,
            instant: true
          });
        }
      });
      return;
    }

    // 兜底直接跳转
    close(true);
    if (window.ForkRunUI && typeof ForkRunUI.open === 'function') {
      ForkRunUI.open(targetFork.id, {
        identity: targetIdentity,
        mode: targetMode,
        openingId: targetOpeningId
      });
    } else if (window.RetroflowForkRunUI && typeof RetroflowForkRunUI.openRun === 'function') {
      RetroflowForkRunUI.openRun(targetFork.id, {
        identity: targetIdentity,
        mode: targetMode,
        openingId: targetOpeningId
      });
    }
  }

  /** 打开预设身份池画廊式选择模态窗
   * @param {number|null} initialIndex 指定唤起时的初始角色索引，不传则默认当前已选角色
   */
  function openLockedRoleModal(initialIndex = null) {
    const overlay = document.getElementById('forkLockedRoleModalOverlay');
    const backBtn = document.getElementById('forkLockedRoleModalBackBtn');
    const counterEl = document.getElementById('forkLockedRoleCounter');
    const prevBtn = document.getElementById('forkLockedRolePrevBtn');
    const nextBtn = document.getElementById('forkLockedRoleNextBtn');
    const bodyAnim = document.getElementById('forkLockedRoleBodyAnim');
    const avatarImg = document.getElementById('forkLockedRoleAvatarImg');
    const avatarPh = document.getElementById('forkLockedRoleAvatarPh');
    const codeBadge = document.getElementById('forkLockedRoleCodeBadge');
    const nameEl = document.getElementById('forkLockedRoleName');
    const genderTag = document.getElementById('forkLockedRoleGenderTag');
    const profileScroll = document.getElementById('forkLockedRoleProfileScroll');
    const profileText = document.getElementById('forkLockedRoleProfileText');
    const applyBtn = document.getElementById('forkLockedRoleApplyBtn');

    if (!overlay || !currentFork) return;

    const roles = Array.isArray(currentFork.lockedRoles) ? currentFork.lockedRoles : [];
    if (roles.length === 0) {
      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'VESSEL // 暂无躯壳',
          message: '当前副本尚未录入预设身份档案',
          type: 'info'
        });
      }
      return;
    }

    // 初始浏览指针：优先使用传入的指定索引，其次定位至当前已选角色索引，找不到则从 0 开始
    let viewingIndex = 0;
    if (typeof initialIndex === 'number' && initialIndex >= 0 && initialIndex < roles.length) {
      viewingIndex = initialIndex;
    } else if (selectedIdentity && selectedIdentity.type === 'preset') {
      const foundIdx = roles.findIndex((r) => r.id === selectedIdentity.id);
      if (foundIdx >= 0) viewingIndex = foundIdx;
    }

    function renderCurrentRole(direction = null) {
      const total = roles.length;
      const role = roles[viewingIndex] || roles[0];
      const seqStr = String(viewingIndex + 1).padStart(2, '0');
      const totalStr = String(total).padStart(2, '0');

      if (counterEl) counterEl.textContent = `${seqStr} / ${totalStr}`;
      if (codeBadge) codeBadge.textContent = `ROLE-${seqStr}`;
      if (nameEl) nameEl.textContent = role.name || '未命名角色';

      // 切换动画：轻微左右滑入淡入（底部翻页键与顶栏保持静止）
      if (bodyAnim && direction) {
        bodyAnim.classList.remove('is-slide-next', 'is-slide-prev');
        // 强制重绘刷新动画帧，支持快速连点
        void bodyAnim.offsetWidth;
        bodyAnim.classList.add(direction === 'next' ? 'is-slide-next' : 'is-slide-prev');
      }

      // 重置长文滚动位置至顶部
      if (profileScroll) {
        profileScroll.scrollTop = 0;
      }

      // 性别胶囊展示
      if (genderTag) {
        const g = (role.gender || '').trim();
        if (g) {
          genderTag.textContent = g;
          genderTag.hidden = false;
        } else {
          genderTag.hidden = true;
        }
      }

      // 设定正文
      if (profileText) {
        profileText.textContent = (role.profile || '').trim() || '该预设身份暂无详细身世设定。';
      }

      // 头像挂接
      if (role.avatar) {
        if (avatarImg) {
          avatarImg.onerror = () => {
            avatarImg.hidden = true;
            if (avatarPh) avatarPh.hidden = false;
          };
          avatarImg.src = role.avatar;
          avatarImg.hidden = false;
        }
        if (avatarPh) avatarPh.hidden = true;
      } else {
        if (avatarImg) {
          avatarImg.removeAttribute('src');
          avatarImg.hidden = true;
        }
        if (avatarPh) avatarPh.hidden = false;
      }

      // 翻页按键可用性控制（单个角色时全禁用）
      if (prevBtn) prevBtn.disabled = total <= 1;
      if (nextBtn) nextBtn.disabled = total <= 1;

      // 底部应用按键状态判断：
      // 1. 本人已选：显示「已选择此身份」，禁用并标 active；
      // 2. 队友已选：显示「xxx 已选此角色」，禁用；
      // 3. 未被选择：显示「使用此身份」，正常可用。
      const isAlreadyUsing = selectedIdentity && selectedIdentity.type === 'preset'
        && selectedIdentity.id === role.id;
      const chosenPeer = role.chosenByPeerName ? String(role.chosenByPeerName).trim() : '';

      if (applyBtn) {
        if (isAlreadyUsing) {
          applyBtn.textContent = '已选择此身份';
          applyBtn.classList.add('is-active');
          applyBtn.disabled = true;
        } else if (chosenPeer) {
          applyBtn.textContent = `${chosenPeer} 已选此角色`;
          applyBtn.classList.remove('is-active');
          applyBtn.disabled = true;
        } else {
          applyBtn.textContent = '使用此身份';
          applyBtn.classList.remove('is-active');
          applyBtn.disabled = false;
        }
      }
    }

    function handlePrev() {
      if (roles.length <= 1) return;
      viewingIndex = (viewingIndex - 1 + roles.length) % roles.length;
      renderCurrentRole('prev');
    }

    function handleNext() {
      if (roles.length <= 1) return;
      viewingIndex = (viewingIndex + 1) % roles.length;
      renderCurrentRole('next');
    }

    function handleApply() {
      const role = roles[viewingIndex];
      if (!role) return;

      const seqStr = String(viewingIndex + 1).padStart(2, '0');
      selectedIdentity = {
        type: 'preset',
        id: role.id,
        name: role.name || '预设角色',
        gender: role.gender || '',
        serial: `ROLE-${seqStr}`,
        desc: role.profile || '原生预设因果躯壳，设定已锁定。',
        avatarUrl: role.avatar || null
      };

      renderSynapseSlot();
      renderRosterStream();
      syncOpeningSelection();
      handleClose();

      if (window.RetroToast) {
        window.RetroToast.show({
          tag: 'VESSEL // 接驳成功',
          message: `已接驳预设身份「${selectedIdentity.name}」`,
          type: 'success'
        });
      }
    }

    function handleClose() {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      if (backBtn) backBtn.removeEventListener('click', handleClose);
      if (prevBtn) prevBtn.removeEventListener('click', handlePrev);
      if (nextBtn) nextBtn.removeEventListener('click', handleNext);
      if (applyBtn) applyBtn.removeEventListener('click', handleApply);
      overlay.removeEventListener('click', handleOverlayClick);
      window.removeEventListener('keydown', handleKeyDown);
    }

    function handleOverlayClick(e) {
      if (e.target === overlay) handleClose();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') handleClose();
      if (e.key === 'ArrowLeft') handlePrev();
      if (e.key === 'ArrowRight') handleNext();
    }

    if (backBtn) backBtn.addEventListener('click', handleClose);
    if (prevBtn) prevBtn.addEventListener('click', handlePrev);
    if (nextBtn) nextBtn.addEventListener('click', handleNext);
    if (applyBtn) applyBtn.addEventListener('click', handleApply);
    overlay.addEventListener('click', handleOverlayClick);
    window.addEventListener('keydown', handleKeyDown);

    renderCurrentRole();
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  /** 打开副本水相等级评定 HUD 检视窗（对齐精神值弹窗交互架构） */
  function openForkLevelModal() {
    const overlay = document.getElementById('forkLevelModalOverlay');
    const closeBtn = document.getElementById('forkLevelModalCloseBtn');
    const curValEl = document.getElementById('forkLevelModalCurVal');
    const curEnEl = document.getElementById('forkLevelModalCurEn');
    const curPrivEl = document.getElementById('forkLevelModalCurPriv');
    const curIconEl = document.getElementById('forkLevelModalCurIcon');
    const listEl = document.getElementById('forkLevelSpectrumList');
    if (!overlay) return;

    const lvlKey = (currentFork && currentFork.levelKey ? currentFork.levelKey : 'E').toUpperCase();
    const lvlInfo = LEVEL_MAP[lvlKey] || LEVEL_MAP['E'];
    const lvlSvg = LEVEL_SVGS[lvlInfo.letter] || LEVEL_SVGS['E'];

    if (curValEl) curValEl.textContent = `${lvlInfo.letter} // ${lvlInfo.name}`;
    if (curEnEl) curEnEl.textContent = lvlInfo.enName || '';
    if (curPrivEl) curPrivEl.textContent = lvlInfo.priv || 'LV.1 准入';
    if (curIconEl) curIconEl.innerHTML = lvlSvg;

    // 高亮当前副本所在等级卡片
    if (listEl) {
      const cards = listEl.querySelectorAll('.fork-level-tier-card');
      cards.forEach((card) => {
        const cLvl = card.dataset.level;
        const isCur = cLvl === lvlInfo.letter;
        card.classList.toggle('is-current', isCur);
        if (isCur) {
          // 微任务平滑滚动至当前卡片视口
          setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 80);
        }
      });
    }

    // 关闭回调与事件注销
    function handleClose() {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      if (closeBtn) closeBtn.removeEventListener('click', handleClose);
      overlay.removeEventListener('click', handleOverlayClick);
      window.removeEventListener('keydown', handleKeyDown);
    }

    function handleOverlayClick(e) {
      if (e.target === overlay) handleClose();
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') handleClose();
    }

    if (closeBtn) closeBtn.addEventListener('click', handleClose);
    overlay.addEventListener('click', handleOverlayClick);
    window.addEventListener('keydown', handleKeyDown);

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  /** 打开准备页 */
  async function open(fork) {
    ensureElements();
    if (!pageEl) return;

    currentFork = fork || currentFork;
    if (!currentFork) {
      // 兜底读取首个可用副本
      if (window.Store && Store.fork && Array.isArray(Store.fork.index) && Store.fork.index[0]) {
        currentFork = Store.fork.index[0];
      }
    }

    // 先同步亮出页面与压栈，再做异步立绘读取：
    // 否则 await 之后才 pushState，会与上一页的 popstate 抢跑导致直接退回桌面。
    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      pageEl.classList.add('active');
    });
    isOpened = true;

    if (window.location.hash !== '#fork-ready') {
      window.history.pushState({ modal: 'fork-ready' }, '', '#fork-ready');
    }

    // 同步可得的副本简报先落屏，避免等头像 IO
    renderDossier();
    // 每次开页重置为单人模式：队友邀请不跨场次留存
    invitedCompanions = [];
    currentMode = 'solo';
    renderModeClause();

    // 先确定身份（尤其是锁定身份副本优先确保接驳同本预设角色），再行渲染插槽与同行者席位
    if (currentFork && currentFork.identityType === 'locked') {
      const roles = Array.isArray(currentFork.lockedRoles) ? currentFork.lockedRoles : [];
      if (roles.length > 0) {
        const stillValid = selectedIdentity && selectedIdentity.type === 'preset'
          && roles.some((r) => String(r.id) === String(selectedIdentity.id));
        if (!stillValid) {
          const first = roles[0];
          selectedIdentity = {
            type: 'preset',
            id: first.id,
            name: first.name || '预设角色',
            gender: first.gender || '',
            serial: 'ROLE-01',
            desc: first.profile || '原生预设因果躯壳，设定已锁定。',
            avatarUrl: first.avatar || null
          };
        }
      }
    } else {
      // 自由身份副本：若无身份或残留预设身份，自动读取本人或马甲
      if (!selectedIdentity || selectedIdentity.type === 'preset') {
        selectedIdentity = await getDefaultPersonaIdentity();
      } else if (selectedIdentity.type === 'persona') {
        // 每次开页都重新取一次本人档案：用户可能刚改过姓名、核心设定或立绘
        const fresh = readPersonaProfile();
        selectedIdentity.name = fresh.name;
        selectedIdentity.desc = fresh.desc;
        selectedIdentity.serial = `NO.${getEnvoySerialNo()}`;
        selectedIdentity.avatarUrl = await loadPersonaAvatar();
      } else if (selectedIdentity.type === 'mask') {
        // 马甲立绘同理重取：上次退场时 blob 句柄已被回收，必须重新拿
        selectedIdentity.avatarUrl = await loadMaskAvatar(selectedIdentity.id);
      }
    }

    renderSynapseSlot();
    renderRosterStream();

    // 存量副本的接入编制、开场套数与目标数可能不在轻量索引里，按需补读卷宗。
    // 判定要用折算后的值：锁定身份补的是 lockedRoles，maxEnvoys 可能始终为 undefined。
    const capBefore = getEnvoyCapacity(currentFork);
    const objBefore = getObjectiveCount(currentFork);
    await ensureForkCapacity(currentFork);
    if (getEnvoyCapacity(currentFork) !== capBefore
      || getObjectiveCount(currentFork) !== objBefore) {
      renderDossier();
      renderRosterStream();
      // 编制补齐后模式可用性会变（单人本 → 多人本），纠偏一次
      syncModeAvailability();
    }

    // 确保开场套数选定与条款渲染
    syncOpeningSelection();
  }

  /**
   * 关闭准备页
   * @param {boolean} silent 为 true 时只收起视图、不触碰 history（供页面互跳与 popstate 复用）
   */
  function close(silent) {
    if (!pageEl || !isOpened) return;
    pageEl.classList.remove('active');

    setTimeout(() => {
      pageEl.hidden = true;
      pageEl.setAttribute('aria-hidden', 'true');
      try {
        // 只回收本页自己创建的 blob 句柄；持久 URL 不归本页管
        liveObjectUrls.forEach(url => {
          try { URL.revokeObjectURL(url); } catch (_) {}
        });
        liveObjectUrls = [];
      } catch (e) {
        console.warn('[ForkReadyUI] 立绘资源回收异常：', e);
      }
    }, 240);

    isOpened = false;

    if (!silent && window.location.hash === '#fork-ready') {
      window.history.back();
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  /** 初始化全局事件监听 */
  function init() {
    ensureElements();

    // 副本选定事件仅作全局广播（供系统助手等旁路模块感知），
    // 开页由 ForkPickUI 直接调用 open(fork) 单一路径负责，避免重复触发压栈两次。

    // 监听浏览器 PopState（系统手势返回 / 物理返回键）
    window.addEventListener('popstate', () => {
      if (!isOpened) return;
      if (window.location.hash === '#fork-ready') return;

      // 关闭本页与唤回挑选页各自独立兜底：
      // 任何一侧抛错都不能吞掉另一侧，否则用户会被直接甩回桌面。
      try {
        close(true);
      } catch (e) {
        console.warn('[ForkReadyUI] 收起准备页异常：', e);
        isOpened = false;
        if (pageEl) {
          pageEl.classList.remove('active');
          pageEl.hidden = true;
          pageEl.setAttribute('aria-hidden', 'true');
        }
      }

      try {
        if (window.ForkPickUI && typeof ForkPickUI.open === 'function') {
          ForkPickUI.open();
        }
      } catch (e) {
        console.warn('[ForkReadyUI] 唤回挑选页异常：', e);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    open,
    close,
    setMode,
    /** 供挑选页判定本页是否处于栈顶（比 DOM hidden 更可靠，不受收起动画时序影响） */
    isOpen: () => isOpened
  };
})();

window.ForkReadyUI = ForkReadyUI;
