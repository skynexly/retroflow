/**
 * 溯流计划 · 04 同调档案系统 (Resonance UI Controller)
 * 
 * 职责：
 * 1. 路由与导轨：管理 04 同调档案主页面及四维右翼导轨索引切换（角色 / NPC / 资料 / 人际）。
 * 2. 角色画廊（CHAR）：双子视图（列表画廊 ↔ 详情编辑），接入通用动效 Motion.swap 与 Motion.replay。
 * 3. 角色详情 CRUD：
 *    - 卡片 01：2:3 立绘存取（Storage.getAssetSrc / Storage.setAsset / Storage.removeAsset）、生图工坊联动、编号/姓名/性别/诞生日（机能日期选择器）。
 *    - 卡片 02：独立 FACE ID 存取、外貌与核心设定全屏长文本沉浸编辑。
 *    - 卡片 03：六维人格心智雷达图。
 *    - 级联销毁与安全清理。
 */
(() => {
  'use strict';

  const ASSET_PREFIX_CHAR_AVATAR = DataRegistry.prefix.charAvatar;
  const ASSET_PREFIX_CHAR_FACE_ID = DataRegistry.prefix.charFaceId;
  const ASSET_PREFIX_ASST_AVATAR = DataRegistry.prefix.assistantAvatar;
  const ASSET_PREFIX_ASST_FACE_ID = DataRegistry.prefix.assistantFaceId;
  const ASSET_PREFIX_NPC_AVATAR = DataRegistry.prefix.npcAvatar;

  let isOpen = false;
  let currentDimension = 'char';
  let characters = [];
  let npcs = [];
  let assistants = [];
  /**
   * loadAssistants() 做元数据补齐时触发的那次落盘。
   *
   * 它必须被等待：这是个异步写入，若保存人设前不等它落定，
   * 这个「补齐后但不含用户最新编辑」的旧快照会慢一拍覆盖掉刚写入的新人设，
   * 导致写入校验读回旧值 → 整体回滚 → 表现为「人设改不动、头像不生效」。
   */
  let pendingRosterNormalize = null;
  let editingCharId = null;
  let editingCharCamp = 'operative'; // 'operative' | 'instance'
  let editingCharRank = 'novice';     // 'novice' | 'veteran' | 'apex' | 'awakened' | 'drifter'
  // 会话内编号缓存：切到副本阵营时暂存执行员编号，切回时原号复位（幂等，反复切不丢号）
  let stashedOperativeSerial = '';

  // 助手编辑会话态
  let editingAsstId = null;
  let pendingAsstAvatarAsset = null;
  let pendingAsstAvatarDisplay = null;
  let pendingAsstFaceIdAsset = null;
  let pendingAsstFaceIdDisplay = null;
  let isAsstAvatarDirty = false;
  let isAsstFaceIdDirty = false;

  // 编辑器归档收页后的一次性回跳钩子（开场向导自定义建档用）
  let pendingEditorExitHook = null;

  // NPC 编辑会话态
  let editingNpcId = null;
  let editingNpcCamp = 'operative';
  let editingNpcRank = 'novice';
  let stashedNpcOperativeSerial = '';

  // 暂存当前正在编辑的图片资产（base64、Blob 或 display URL）
  let pendingAvatarAsset = null;
  let pendingAvatarDisplay = null;
  let pendingFaceIdAsset = null;
  let pendingFaceIdDisplay = null;
  let isAvatarDirty = false;
  let isFaceIdDirty = false;

  // NPC 暂存立绘
  let pendingNpcAvatarAsset = null;
  let pendingNpcAvatarDisplay = null;
  let isNpcAvatarDirty = false;

  // DOM 引用：主页面与导轨
  const resonancePage = document.getElementById('resonancePage');
  const resonanceCloseBtn = document.getElementById('resonanceCloseBtn');
  const resonanceBentoCard = document.querySelector('.bento-card[data-app="resonance"]');
  const resonanceIndexRail = document.getElementById('resonanceIndexRail');
  const resonanceRailLayout = document.querySelector('.resonance-body-with-rail');
  const railBookmarks = resonanceIndexRail ? resonanceIndexRail.querySelectorAll('.index-bookmark') : [];
  const listPanes = {
    char: document.getElementById('paneResonanceChar'),
    npc: document.getElementById('paneResonanceNpc'),
    assistant: document.getElementById('paneResonanceAssistant'),
    builtin: document.getElementById('paneResonanceBuiltin'),
    relation: document.getElementById('paneResonanceRelation')
  };

  // DOM 引用：03 系统助手维次
  const asstListView = document.getElementById('resonanceAsstListView');
  const asstEditView = document.getElementById('resonanceAsstEditView');
  const asstCardList = document.getElementById('resonanceAsstList');
  const asstCountBadge = document.getElementById('resonanceAsstCount');
  const asstAddBtn = document.getElementById('resonanceAsstAddBtn');
  const asstEmptyView = document.getElementById('resonanceAsstEmpty');
  // DOM 引用：顶栏详情态烤串菜单（四维共用一套）
  const resonanceKebabWrap = document.getElementById('resonanceKebabWrap');
  const resonanceMoreBtn = document.getElementById('resonanceMoreBtn');
  const resonanceMenuPopover = document.getElementById('resonanceMenuPopover');
  const resonanceMenuSaveText = document.getElementById('resonanceMenuSaveText');
  const resonanceMenuDestroyText = document.getElementById('resonanceMenuDestroyText');
  const resonanceMenuDestroyBtn = document.getElementById('resonanceMenuDestroyBtn');

  // 详情态归属：null=列表态。四个维度共用一个顶栏，靠它分发保存/销毁。
  // 用状态位而非读 DOM 的 hidden：Motion.swap 有过渡期，那段时间两个视图都可见。
  let activeEditor = null; // 'char' | 'npc' | 'asst'

  // 各维度的文案与新建态判定
  const EDITOR_META = {
    char: { zh: '角色', nameOf: () => (charNameInput?.value || '').trim() },
    npc: { zh: 'NPC', nameOf: () => (npcNameInput?.value || '').trim() },
    asst: { zh: '助手', nameOf: () => (asstNameInput?.value || '').trim() }
  };

  /**
   * 进入/退出详情态时同步顶栏烤串的可见性与文案。
   * @param {string|null} dim 'char' | 'npc' | 'asst'，传 null 表示回到列表态
   */
  function setActiveEditor(dim) {
    activeEditor = dim || null;
    if (resonanceKebabWrap) resonanceKebabWrap.hidden = !activeEditor;
    if (!activeEditor) {
      closeResonanceMenu();
      return;
    }
    const meta = EDITOR_META[activeEditor];
    if (meta) {
      if (resonanceMenuSaveText) resonanceMenuSaveText.textContent = `保存${meta.zh}`;
      if (resonanceMenuDestroyText) resonanceMenuDestroyText.textContent = `销毁${meta.zh}`;
    }
  }

  // 三个维度的「删除」全部收进烤串，指向同一个销毁项。
  // 保留原变量名，让既有的 hidden = true/false 新建态逻辑无需改动。
  const charEditDeleteBtn = resonanceMenuDestroyBtn;
  const npcEditDeleteBtn = resonanceMenuDestroyBtn;
  const asstEditDeleteBtn = resonanceMenuDestroyBtn;

  const asstAvatarFrame = document.getElementById('asstAvatarFrame');
  const asstAvatarImg = document.getElementById('asstAvatarImg');
  const asstAvatarPlaceholder = document.getElementById('asstAvatarPlaceholder');
  const asstAvatarGenerateBtn = document.getElementById('asstAvatarGenerateBtn');
  const asstAvatarClearBtn = document.getElementById('asstAvatarClearBtn');

  const asstFaceIdFrame = document.getElementById('asstFaceIdFrame');
  const asstFaceIdImg = document.getElementById('asstFaceIdImg');
  const asstFaceIdPlaceholder = document.getElementById('asstFaceIdPlaceholder');
  const asstFaceIdStatus = document.getElementById('asstFaceIdStatus');
  const asstFaceIdClearBtn = document.getElementById('asstFaceIdClearBtn');

  const asstNameInput = document.getElementById('asstNameInput');
  const asstGenderInput = document.getElementById('asstGenderInput');
  const asstSerialInput = document.getElementById('asstSerialInput');
  const asstBirthdayInput = document.getElementById('asstBirthdayInput');
  const asstVoiceIdInput = document.getElementById('asstVoiceIdInput');
  const asstAppearanceInput = document.getElementById('asstAppearanceInput');
  const asstAppearanceExpandBtn = document.getElementById('asstAppearanceExpandBtn');
  const asstProfileInput = document.getElementById('asstProfileInput');
  const asstProfileExpandBtn = document.getElementById('asstProfileExpandBtn');

  // DOM 引用：04 人际关系总览 (Relation Matrix)
  const nexusMatrixList = document.getElementById('resonanceNexusMatrixList');
  const nexusTotalCountBadge = document.getElementById('resonanceNexusTotalCount');
  const nexusGlobalAddBtn = document.getElementById('resonanceNexusAddBtn');
  const nexusEmptyView = document.getElementById('resonanceNexusEmpty');
  const nexusEmptyDesc = document.getElementById('resonanceNexusEmptyDesc');
  const nexusFilterPills = document.querySelectorAll('.nexus-filter-pill');
  const nexusPersonTrigger = document.getElementById('resonanceNexusPersonTrigger');
  const nexusPersonLabel = document.getElementById('resonanceNexusPersonLabel');

  // DOM 引用：01 角色子视图
  const charListView = document.getElementById('resonanceCharListView');
  const charEditView = document.getElementById('resonanceCharEditView');
  const charCardList = document.getElementById('resonanceCharList');
  const charEmptyView = document.getElementById('resonanceCharEmpty');
  const charCountBadge = document.getElementById('resonanceCharCount');
  const charAddBtn = document.getElementById('resonanceCharAddBtn');

  // DOM 引用：角色详情编辑控件（返回/保存/删除已收进顶栏烤串）

  // 卡片 00：身份抉择（双极因果滑块）
  const charCampPivotCard = document.querySelector('.camp-pivot-card');
  const charCampStatusTag = document.getElementById('charCampStatusTag');
  const charCampValveTrack = document.getElementById('charCampValveTrack');
  const campOptOperative = document.getElementById('campOptOperative');
  const campOptInstance = document.getElementById('campOptInstance');
  const charCampDescCode = document.getElementById('charCampDescCode');
  const charCampDescContent = document.getElementById('charCampDescContent');

  // 阶位手风琴卷宗 Deck
  const rankDeckOperative = document.getElementById('rankDeckOperative');
  const rankDeckInstance = document.getElementById('rankDeckInstance');
  const allRankCards = document.querySelectorAll('.rank-dossier-card');

  // 卡片 01
  const charAvatarFrame = document.getElementById('charAvatarFrame');
  const charAvatarImg = document.getElementById('charAvatarImg');
  const charAvatarPlaceholder = document.getElementById('charAvatarPlaceholder');
  const charForgeAvatarBtn = document.getElementById('charForgeAvatarBtn');
  const charClearAvatarBtn = document.getElementById('charClearAvatarBtn');
  const charSerialInput = document.getElementById('charSerialInput');
  const charSerialFieldGroup = document.getElementById('charSerialFieldGroup');
  const charNameInput = document.getElementById('charNameInput');
  const charGenderInput = document.getElementById('charGenderInput');
  const charBirthdayInput = document.getElementById('charBirthdayInput');
  const charBirthdayWrap = document.getElementById('charBirthdayWrap');

  // 卡片 02
  const charFaceIdFrame = document.getElementById('charFaceIdFrame');
  const charFaceIdImg = document.getElementById('charFaceIdImg');
  const charFaceIdPlaceholder = document.getElementById('charFaceIdPlaceholder');
  const charFaceIdStatus = document.getElementById('charFaceIdStatus');
  const charFaceIdClearBtn = document.getElementById('charFaceIdClearBtn');
  const charVoiceIdInput = document.getElementById('charVoiceIdInput');
  const charAppearanceInput = document.getElementById('charAppearanceInput');
  const charAppearanceExpandBtn = document.getElementById('charAppearanceExpandBtn');
  const charProfileInput = document.getElementById('charProfileInput');
  const charSelfBriefInput = document.getElementById('charSelfBriefInput');
  const charProfileExpandBtn = document.getElementById('charProfileExpandBtn');

  /* ================= 数据层 ================= */

  // 历史遗留：早期版本曾把 2 位示例角色（char_000001 林晚 / char_000002 陆沉）
  // 通过 DEFAULT_CHARACTERS 写进 resonance.characters，这些占位卡片会在老设备上
  // 持续出现且可以点入编辑，需要一次性静默清除。
  // 注意：旧种子自带 createdAt，不能靠时间戳缺失来判定。
  const LEGACY_SEED_IDS = ['char_000001', 'char_000002'];
  const LEGACY_SEED_NAMES = ['林晚', '陆沉'];

  function isLegacySeed(c) {
    if (!c || typeof c !== 'object') return true;
    const id = String(c.id || '');
    const name = String(c.name || '').trim();
    // 旧种子的三重指纹：固定 id + 固定姓名 + 独有的 tagline 字段（新版本不再写入）
    return LEGACY_SEED_IDS.includes(id)
      && LEGACY_SEED_NAMES.includes(name)
      && Object.prototype.hasOwnProperty.call(c, 'tagline');
  }

  async function purgeLegacySeedData() {
    try {
      if (Store.meta.legacyPurged) return;

      const list = (Store.roster.characters || []).slice();
      const cleaned = list.filter((c) => !isLegacySeed(c));

      if (cleaned.length !== list.length) {
        // 级联清理被移除角色的图片资产，避免 IndexedDB 里留孤儿数据
        list.filter((c) => isLegacySeed(c)).forEach((c) => {
          if (!c || !c.id) return;
          try {
            Storage.removeAsset(ASSET_PREFIX_CHAR_AVATAR + c.id);
            Storage.removeAsset(ASSET_PREFIX_CHAR_FACE_ID + c.id);
          } catch (e) {
            /* ignore */
          }
        });
        await Store.save('roster.characters', cleaned);
        console.log(`[Resonance] 已清除 ${list.length - cleaned.length} 条历史占位角色`);
      }

      await Store.save('meta.legacyPurged', true);
    } catch (e) {
      console.warn('[Resonance] 清除历史占位角色失败:', e);
    }
  }

  function loadCharacters() {
    characters = (Store.roster.characters || []).slice();
    return characters;
  }

  function saveCharacters() {
    return Store.save('roster.characters', characters);
  }

  /* ================= NPC 数据层 ================= */

  function loadNpcs() {
    npcs = (Store.roster.npcs || []).slice();
    return npcs;
  }

  function saveNpcs() {
    return Store.save('roster.npcs', npcs);
  }

  /* ================= 人际关系图谱数据层 (Nexus Relations) =================
     一条记录代表一条无向关系，不存两份镜像。
     「在 B 档案里加的关系会出现在 A 档案里」由查询实现：
     匹配 aId === me || bId === me，再算出对面那个人。
     这样两边永远一致，不存在同步问题。 */

  let relations = [];

  function loadRelations() {
    relations = (Store.roster.relations || []).slice();
    return relations;
  }

  function saveRelations() {
    return Store.save('roster.relations', relations);
  }

  // 取某人的全部关系，并把「对面是谁」一并算出
  function getRelationsOf(charId) {
    if (!charId) return [];
    return relations
      .filter((r) => r && (r.aId === charId || r.bId === charId))
      .map((r) => ({
        ...r,
        otherId: r.aId === charId ? r.bId : r.aId
      }));
  }

  // 判断两人之间是否已有关系，用于候选列表排重
  function hasRelationBetween(idA, idB) {
    return relations.some(
      (r) => r && ((r.aId === idA && r.bId === idB) || (r.aId === idB && r.bId === idA))
    );
  }

  function upsertRelation({ id, aId, bId, relation, desc }) {
    const now = Date.now();
    if (id) {
      const idx = relations.findIndex((r) => r && r.id === id);
      if (idx >= 0) {
        relations[idx] = { ...relations[idx], relation, desc, updatedAt: now };
        saveRelations();
        return relations[idx];
      }
    }
    const rec = {
      id: `rel_${now}_${Math.random().toString(36).slice(2, 7)}`,
      aId,
      bId,
      relation,
      desc,
      updatedAt: now
    };
    relations.push(rec);
    saveRelations();
    return rec;
  }

  function removeRelation(id) {
    const before = relations.length;
    relations = relations.filter((r) => r && r.id !== id);
    if (relations.length !== before) saveRelations();
  }

  // 角色被销毁时级联清除其全部关系，避免留下指向空 id 的孤儿记录
  function purgeRelationsOf(charId) {
    if (!charId) return 0;
    const before = relations.length;
    relations = relations.filter((r) => r && r.aId !== charId && r.bId !== charId);
    const removed = before - relations.length;
    if (removed > 0) saveRelations();
    return removed;
  }

  /* ================= 助手数据层 ================= */

  const DEFAULT_SYS_ASSISTANT = (() => {
    // 单一事实来源：安小奇的骨架统一由预设注册表提供，避免两处各写一份人设。
    const preset = window.PresetAssistants
      ? PresetAssistants.get('asst_system_core')
      : null;
    if (preset) return { ...preset, isActive: true };
    // 兜底：注册表未加载时给最小可用骨架，人设留空待定稿
    return {
      id: 'asst_system_core',
      name: '安小奇',
      gender: '男',
      serialNo: 'SYS-CORE-01',
      birthday: 'SYSTEM ONLINE',
      voiceId: '',
      appearance: '',
      corePrompt: '',
      isActive: true,
      builtIn: true,
      createdAt: 1700000000000
    };
  })();

  function formatAssistantDate(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}.${month}.${day}`;
  }

  function getNextAssistantSerial() {
    const maxNo = assistants.reduce((max, asst) => {
      const match = String(asst && asst.serialNo || '').match(/^SYS-CORE-(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 1);
    return `SYS-CORE-${String(maxNo + 1).padStart(2, '0')}`;
  }

  /**
   * 预设助手自愈：确保随包发行的两位系统助手（安小奇 / 安小阎）恒定在册。
   *
   * 早期版本只在「开场向导确认指派」时才写入安小阎，导致已走完向导的存档
   * 永远等不到那段代码，助手列表里凭空少人。这里改为每次装载时兜底补齐，
   * 让新旧存档都能自行长出预设助手。
   *
   * 只补缺失项与空字段，绝不覆盖用户已改过的名字 / 人设。
   * @returns {boolean} 是否发生了变更（供调用方决定要不要落盘）
   */
  function ensurePresetAssistants() {
    if (!window.PresetAssistants || typeof PresetAssistants.list !== 'function') return false;

    let changed = false;
    PresetAssistants.list().forEach((preset) => {
      const existing = assistants.find((a) => a && a.id === preset.id);
      if (!existing) {
        // 缺席则补入。是否激活留给下面统一裁决，避免多个 isActive 并存。
        assistants.push({ ...preset, isActive: false });
        changed = true;
        return;
      }
      // 在册则仅补空字段
      if (!existing.name) { existing.name = preset.name; changed = true; }
      if (!existing.gender) { existing.gender = preset.gender; changed = true; }
      if (!existing.serialNo) { existing.serialNo = preset.serialNo; changed = true; }
      if (!existing.birthday) { existing.birthday = preset.birthday; changed = true; }
      if (!existing.builtIn) { existing.builtIn = true; changed = true; }
    });

    // 补入新成员后可能出现「全员未激活」，兜底激活第一位，否则聊天页取不到身份
    if (assistants.length > 0 && !assistants.some((a) => a && a.isActive)) {
      assistants[0].isActive = true;
      changed = true;
    }

    return changed;
  }

  /**
   * 预设立绘自愈：预设助手缺 Blob 立绘时，从随包静态资源补灌一次。
   *
   * 同上，早期只在指派时灌注，旧存档里的助手立绘是空的。异步执行，
   * 不阻塞列表渲染；补灌成功后派发事件让已渲染的卡片自行刷新。
   */
  async function ensurePresetPortraits() {
    if (!window.PresetAssistants || typeof PresetAssistants.seedPortraitAsset !== 'function') return;
    // 用 getAssetRaw 而非 getAssetSrc：只探在不在，不生成 objectURL，免去泄漏
    if (!window.Storage || typeof Storage.getAssetRaw !== 'function') return;

    for (const preset of PresetAssistants.list()) {
      // 仅为在册的预设助手补图，避免给已被用户删掉的助手凭空造资产
      if (!assistants.some((a) => a && a.id === preset.id)) continue;
      try {
        const existing = await Storage.getAssetRaw(ASSET_PREFIX_ASST_AVATAR + preset.id);
        if (existing) continue;
        const ok = await PresetAssistants.seedPortraitAsset(preset.id);
        if (ok) {
          window.dispatchEvent(new CustomEvent('retroflow:assistant-avatar-changed', {
            detail: { assistantId: preset.id }
          }));
        }
      } catch (err) {
        console.warn('[Resonance] 预设立绘自愈跳过:', preset.id, err);
      }
    }
  }

  function loadAssistants() {
    // 启动早期可能有顶栏等模块提前查询当前助手。Store 尚未完成装载时只提供
    // 临时默认值，绝不向 IndexedDB 回写，避免用空内存覆盖已保存的助手数组。
    if (!Store.isLoaded || !Store.isLoaded()) {
      const memoryList = (Store.roster.assistants || []).slice();
      assistants = memoryList.length ? memoryList : [{ ...DEFAULT_SYS_ASSISTANT }];
      return assistants;
    }

    assistants = (Store.roster.assistants || []).slice();

    // 预设助手兜底补齐，新旧存档一视同仁
    let changed = ensurePresetAssistants();

    const core = assistants.find((asst) => asst && asst.id === 'asst_system_core');
    if (core) {
      // 仅补齐缺失的元数据字段（升级兼容），不强制覆盖用户可编辑的 name/gender/appearance/corePrompt
      if (!core.serialNo) { core.serialNo = DEFAULT_SYS_ASSISTANT.serialNo; changed = true; }
      if (!core.birthday) { core.birthday = DEFAULT_SYS_ASSISTANT.birthday; changed = true; }
      if (!core.builtIn) { core.builtIn = true; changed = true; }
    }
    let nextNo = assistants.reduce((max, asst) => {
      const match = String(asst && asst.serialNo || '').match(/^SYS-CORE-(\d+)$/i);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 1);
    assistants.forEach((asst) => {
      if (!asst || typeof asst !== 'object') return;
      if (!asst.serialNo) {
        asst.serialNo = `SYS-CORE-${String(++nextNo).padStart(2, '0')}`;
        changed = true;
      }
      if (!asst.birthday) {
        asst.birthday = asst.id === 'asst_system_core'
          ? 'SYSTEM ONLINE'
          : formatAssistantDate(asst.createdAt || Date.now());
        changed = true;
      }
    });
    if (changed) {
      // 这次补齐写入必须可等待：它是异步落盘，若不等就直接去改 target 并保存，
      // 这个慢一拍的旧快照会把随后写入的新人设整个覆盖回去 ——
      // 表现就是「人设改不动、头像看似存了但没生效」（校验读回旧值→回滚）。
      pendingRosterNormalize = Store.save('roster.assistants', assistants);
    }
    if (assistants.length === 0) {
      assistants = [{ ...DEFAULT_SYS_ASSISTANT }];
      pendingRosterNormalize = Store.save('roster.assistants', assistants);
    }
    return assistants;
  }

  function saveAssistants() {
    return Store.save('roster.assistants', assistants);
  }

  /** 仅允许当前激活助手从图库有效 Blob 更新立绘。 */
  async function applyAssistantAvatarFromGallery(assistantId, galleryId) {
    loadAssistants();
    const target = assistants.find((item) => item && String(item.id) === String(assistantId));
    const active = assistants.find((item) => item && item.isActive);
    if (!target || !active || target.id !== active.id) throw new Error('只能修改当前激活助手的立绘');
    if (!window.GalleryStore || typeof GalleryStore.getBlob !== 'function') throw new Error('图库模块尚未加载');
    const entry = typeof GalleryStore.getEntry === 'function' ? GalleryStore.getEntry(galleryId) : null;
    if (!entry) throw new Error(`图库中找不到编号 ${galleryId}`);
    const blob = await GalleryStore.getBlob(galleryId);
    if (!(blob instanceof Blob) || !String(blob.type || '').startsWith('image/')) throw new Error(`图片 ${galleryId} 的影像缓存已释放`);
    await Storage.setAsset(ASSET_PREFIX_ASST_AVATAR + target.id, blob);
    target.updatedAt = Date.now();
    await saveAssistants();
    if (window.SystemChatUI && typeof SystemChatUI.refreshAssistantAvatars === 'function') {
      SystemChatUI.refreshAssistantAvatars(target.id);
    }
    window.dispatchEvent(new CustomEvent('retroflow:assistant-avatar-changed', {
      detail: { assistantId: target.id }
    }));
    return target;
  }

  function getActiveAssistant() {
    const list = loadAssistants();
    const active = list.find((a) => a && a.isActive);
    return active || list[0] || DEFAULT_SYS_ASSISTANT;
  }

  async function setActiveAssistant(id) {
    loadAssistants();
    assistants.forEach((a) => {
      a.isActive = (a.id === id);
    });
    await saveAssistants();
    await renderAsstList();

    // 统一刷新聊天页身份显示；备注存在时仍由聊天控制器保留备注
    const active = getActiveAssistant();
    if (window.SystemChatUI && typeof SystemChatUI.syncHeaderIdentity === 'function') {
      SystemChatUI.syncHeaderIdentity();
    }

    if (window.RetroToast && typeof RetroToast.show === 'function') {
      RetroToast.show({
        tag: 'ASSISTANT // 智脑同调',
        message: `已装载助手拟态模组：${active.name}`,
        type: 'success'
      });
    }
  }

  /* ================= 助手画廊 UI 层 ================= */

  // 并发渲染守卫：同 renderCharList，防止两轮渲染交错追加
  let asstListRenderToken = 0;

  async function renderAsstList() {
    if (!asstCardList) return;
    const token = ++asstListRenderToken;

    const list = loadAssistants();

    // 预设立绘自愈：异步补灌，不阻塞本轮渲染。补成后靠事件刷新卡片。
    ensurePresetPortraits();

    if (asstCountBadge) {
      asstCountBadge.textContent = list.length;
    }

    if (list.length === 0) {
      asstCardList.innerHTML = '';
      if (asstEmptyView) asstEmptyView.hidden = false;
      return;
    }
    if (asstEmptyView) asstEmptyView.hidden = true;
    // 分离当前激活助手（主槽）与待命助手
    const activeAsst = list.find((a) => a && a.isActive) || list[0];
    const standbyList = list.filter((a) => a && a.id !== activeAsst.id);

    const frag = document.createDocumentFragment();

    // 1. 顶部主槽：当前激活助手的 2:3 大画幅卡片
    if (activeAsst) {
      const activeCard = document.createElement('div');
      activeCard.className = 'asst-staggered-card is-active-asst';
      activeCard.dataset.asstId = activeAsst.id;

      const genderText = (activeAsst.gender || '').trim() || '机能';

      activeCard.innerHTML = `
        <!-- 左侧战术物理紧固栓（微破框 8px，强化主槽装载锁死感） -->
        <div class="asst-core-lock-latch" aria-hidden="true">
          <svg class="asst-latch-bolt" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <circle cx="5" cy="5" r="1.5" fill="var(--primary-color)" />
          </svg>
          <span class="asst-latch-label">CORE</span>
          <svg class="asst-latch-bolt" viewBox="0 0 10 10">
            <circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />
            <circle cx="5" cy="5" r="1.5" fill="var(--primary-color)" />
          </svg>
        </div>

        <!-- 左侧 2:3 黄金展台 -->
        <div class="asst-portrait-stage" title="点击编辑 ${escapeHtml(activeAsst.name)} 档案">
          <img class="asst-portrait-img" id="asstCardAvatar_${activeAsst.id}" alt="${escapeHtml(activeAsst.name)}" hidden>
          <div class="asst-portrait-ph" id="asstCardPh_${activeAsst.id}">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9zM7 14h1v4H7v-4zm10 4v-4h1v4h-1z"/>
            </svg>
            <span>2:3 PORTRAIT</span>
          </div>
        </div>

        <!-- 右侧错位横跨悬浮岛 -->
        <div class="asst-island-col">
          <!-- 上岛：战术身份黑牌（带芯片触点装饰与战术切角） -->
          <div class="asst-island-badge" title="点击编辑详情">
            <div class="asst-chip-header">
              <span class="asst-chip-model">${escapeHtml(activeAsst.serialNo || 'SYS-CORE-01')}</span>
              <svg class="asst-chip-pins" viewBox="0 0 32 8" aria-hidden="true">
                <rect x="2" y="0" width="4" height="7" rx="0.5" />
                <rect x="10" y="0" width="4" height="7" rx="0.5" />
                <rect x="18" y="0" width="4" height="7" rx="0.5" />
                <rect x="26" y="0" width="4" height="7" rx="0.5" />
              </svg>
            </div>
            <div class="asst-badge-row-top">
              <span class="asst-badge-name">${escapeHtml(activeAsst.name || '系统助理')}</span>
              <span class="asst-badge-gender">${genderText}</span>
            </div>
            <div class="asst-badge-status-row">
              <span class="asst-status-dot"></span>
              <span class="asst-status-text">当前激活人格</span>
            </div>
          </div>

          <!-- 下岛：醒目进入聊天胶囊按钮 -->
          <button type="button" class="asst-chat-pill-btn" data-action="chat" data-id="${activeAsst.id}" title="与 ${escapeHtml(activeAsst.name)} 开启推演对话">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/>
            </svg>
            <span>进入聊天</span>
          </button>
        </div>
      `;

      // 异步加载立绘
      Storage.getAssetSrc(ASSET_PREFIX_ASST_AVATAR + activeAsst.id).then((src) => {
        const img = activeCard.querySelector(`#asstCardAvatar_${activeAsst.id}`);
        const ph = activeCard.querySelector(`#asstCardPh_${activeAsst.id}`);
        if (img && ph && src) {
          img.src = src;
          img.hidden = false;
          ph.hidden = true;
        }
      });

      // 绑定交互
      const stage = activeCard.querySelector('.asst-portrait-stage');
      const badge = activeCard.querySelector('.asst-island-badge');
      const chatBtn = activeCard.querySelector('[data-action="chat"]');

      if (stage) stage.addEventListener('click', () => openAsstEditor(activeAsst.id));
      if (badge) badge.addEventListener('click', () => openAsstEditor(activeAsst.id));
      if (chatBtn) {
        chatBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          close();
          const sysChatApp = document.querySelector('.bento-card[data-app="systemChat"]');
          if (sysChatApp) {
            sysChatApp.click();
          } else if (window.SystemChatUI && typeof window.SystemChatUI.open === 'function') {
            window.SystemChatUI.open();
          }
        });
      }

      frag.appendChild(activeCard);
    }

    // 2. 待命助手区域（STANDBY CORES）
    if (standbyList.length > 0) {
      const standbyWrap = document.createElement('div');
      standbyWrap.className = 'asst-standby-section';

      standbyWrap.innerHTML = `
        <div class="asst-standby-header">
          <span class="asst-standby-tag">STANDBY</span>
          <span class="asst-standby-slash">//</span>
          <span class="asst-standby-label">待命拟态模组</span>
          <span class="asst-standby-count">${standbyList.length}</span>
        </div>
        <div class="asst-standby-list"></div>
      `;

      const listContainer = standbyWrap.querySelector('.asst-standby-list');

      for (const asst of standbyList) {
        const item = document.createElement('div');
        item.className = 'asst-standby-card';
        item.dataset.asstId = asst.id;

        const genderText = (asst.gender || '').trim() || '机能';
        const summaryText = (asst.corePrompt || asst.appearance || '尚未配置具体人设与核心指令。').trim();

        item.innerHTML = `
          <!-- 左侧微缩头像 / 立绘 -->
          <div class="asst-standby-avatar-box">
            <img class="asst-standby-avatar-img" id="asstStandbyAvatar_${asst.id}" alt="${escapeHtml(asst.name)}" hidden>
            <div class="asst-standby-avatar-ph" id="asstStandbyPh_${asst.id}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1a9 9 0 00-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7a9 9 0 00-9-9zM7 14h1v4H7v-4zm10 4v-4h1v4h-1z"/>
              </svg>
            </div>
          </div>

          <!-- 中部信息 -->
          <div class="asst-standby-info">
            <div class="asst-standby-name-row">
              <span class="asst-standby-serial">${escapeHtml(asst.serialNo || 'SYS')}</span>
              <span class="asst-standby-name">${escapeHtml(asst.name || '助手')}</span>
              <span class="asst-standby-gender">${genderText}</span>
            </div>
            <div class="asst-standby-desc">${escapeHtml(summaryText)}</div>
          </div>

          <!-- 右侧装载按键 -->
          <button type="button" class="asst-standby-activate-btn" data-action="activate" data-id="${asst.id}" title="将 ${escapeHtml(asst.name)} 装载至主槽">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>
            </svg>
            <span>装载</span>
          </button>
        `;

        // 异步加载待命助手立绘
        Storage.getAssetSrc(ASSET_PREFIX_ASST_AVATAR + asst.id).then((src) => {
          const img = item.querySelector(`#asstStandbyAvatar_${asst.id}`);
          const ph = item.querySelector(`#asstStandbyPh_${asst.id}`);
          if (img && ph && src) {
            img.src = src;
            img.hidden = false;
            ph.hidden = true;
          }
        });

        // 绑定事件：点击卡片进入详情编辑；点击装载切换激活
        item.addEventListener('click', () => openAsstEditor(asst.id));

        const actBtn = item.querySelector('[data-action="activate"]');
        if (actBtn) {
          actBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            setActiveAssistant(asst.id);
          });
        }

        listContainer.appendChild(item);
      }

      frag.appendChild(standbyWrap);
    }

    // 本轮为最新渲染：整体替换列表内容，杜绝并发交错造成的重复卡片
    if (token !== asstListRenderToken) return;
    asstCardList.innerHTML = '';
    asstCardList.appendChild(frag);
  }

  function showAsstListView() {
    setActiveEditor(null);
    if (!asstListView || !asstEditView) return;
    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(asstListView, [asstEditView]);
    } else {
      asstEditView.hidden = true;
      asstListView.hidden = false;
    }
    editingAsstId = null;
    setRailVisible(true);
    renderAsstList();
  }

  function setAsstAvatarDisplay(src) {
    pendingAsstAvatarDisplay = src;
    if (src) {
      if (asstAvatarImg) {
        asstAvatarImg.src = src;
        asstAvatarImg.style.display = 'block';
      }
      if (asstAvatarPlaceholder) asstAvatarPlaceholder.style.display = 'none';
      if (asstAvatarClearBtn) asstAvatarClearBtn.classList.remove('is-idle');
    } else {
      if (asstAvatarImg) {
        asstAvatarImg.removeAttribute('src');
        asstAvatarImg.style.display = 'none';
      }
      if (asstAvatarPlaceholder) asstAvatarPlaceholder.style.display = 'flex';
      if (asstAvatarClearBtn) asstAvatarClearBtn.classList.add('is-idle');
    }
  }

  function setAsstFaceIdDisplay(src) {
    pendingAsstFaceIdDisplay = src;
    if (src) {
      if (asstFaceIdImg) {
        asstFaceIdImg.src = src;
        asstFaceIdImg.style.display = 'block';
      }
      if (asstFaceIdPlaceholder) asstFaceIdPlaceholder.style.display = 'none';
      if (asstFaceIdStatus) asstFaceIdStatus.textContent = '已录入面容';
      if (asstFaceIdClearBtn) asstFaceIdClearBtn.classList.remove('is-idle');
    } else {
      if (asstFaceIdImg) {
        asstFaceIdImg.removeAttribute('src');
        asstFaceIdImg.style.display = 'none';
      }
      if (asstFaceIdPlaceholder) asstFaceIdPlaceholder.style.display = 'flex';
      if (asstFaceIdStatus) asstFaceIdStatus.textContent = '未录入面容';
      if (asstFaceIdClearBtn) asstFaceIdClearBtn.classList.add('is-idle');
    }
  }

  async function openAsstEditor(asstId) {
    if (!asstListView || !asstEditView) return;
    editingAsstId = asstId;
    setActiveEditor('asst');
    isAsstAvatarDirty = false;
    isAsstFaceIdDirty = false;
    pendingAsstAvatarAsset = null;
    pendingAsstFaceIdAsset = null;

    if (asstId) {
      const list = loadAssistants();
      const asst = list.find((a) => a && a.id === asstId);
      if (!asst) return;

      // 只有非默认核心助手才允许彻底删除
      if (asstEditDeleteBtn) {
        asstEditDeleteBtn.hidden = (asst.id === 'asst_system_core');
      }

      if (asstNameInput) asstNameInput.value = asst.name || '';
      if (asstGenderInput) asstGenderInput.value = asst.gender || '';
      if (asstSerialInput) asstSerialInput.value = asst.serialNo || 'SYS-CORE-02';
      if (asstBirthdayInput) asstBirthdayInput.value = asst.birthday || formatAssistantDate(asst.createdAt); 
      if (asstVoiceIdInput) asstVoiceIdInput.value = asst.voiceId || '';
      if (asstAppearanceInput) asstAppearanceInput.value = asst.appearance || '';
      if (asstProfileInput) asstProfileInput.value = asst.corePrompt || '';

      // 恢复立绘
      let avatar = null;
      try {
        avatar = await Storage.getAssetSrc(ASSET_PREFIX_ASST_AVATAR + asstId);
      } catch (e) { /* ignore */ }
      setAsstAvatarDisplay(avatar);

      // 恢复 Face ID
      let faceId = null;
      try {
        faceId = await Storage.getAssetSrc(ASSET_PREFIX_ASST_FACE_ID + asstId);
      } catch (e) { /* ignore */ }
      setAsstFaceIdDisplay(faceId);

    } else {
      // 新建助手：编号取现有最大序号 + 1，诞生日取创建当天
      loadAssistants();
      const createdAt = Date.now();
      if (asstEditDeleteBtn) asstEditDeleteBtn.hidden = true;
      if (asstNameInput) asstNameInput.value = '';
      if (asstGenderInput) asstGenderInput.value = '机能';
      if (asstSerialInput) asstSerialInput.value = getNextAssistantSerial();
      if (asstBirthdayInput) asstBirthdayInput.value = formatAssistantDate(createdAt);
      if (asstVoiceIdInput) asstVoiceIdInput.value = '';
      if (asstAppearanceInput) asstAppearanceInput.value = '';
      if (asstProfileInput) asstProfileInput.value = '';

      setAsstAvatarDisplay(null);
      setAsstFaceIdDisplay(null);
    }

    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(asstEditView, [asstListView]);
    } else {
      asstListView.hidden = true;
      asstEditView.hidden = false;
    }

    // 详情编辑态独占全宽：导轨退场，并把滚动位置复位到卡片 01
    setRailVisible(false);

    const scroller = resonancePage ? resonancePage.querySelector('.settings-body-scroll') : null;
    if (scroller) scroller.scrollTop = 0;
  }

  async function saveAsstEditor() {
    const name = (asstNameInput ? asstNameInput.value : '').trim();
    if (!name) {
      // RetroModal 只导出 confirm/alert/close，没有 toast —— 原先写成
      // `RetroModal.toast` 的条件永远为假，这三处提示从来没弹过。
      // 本页统一走 toastResonance（内部用 RetroToast）。
      toastResonance('VALIDATION // 校验未通过', '请为助手填写代号或名称', '', 'warning');
      return false;
    }

    loadAssistants();
    // 等掉 loadAssistants 可能触发的元数据补齐落盘，否则那次写入会慢一拍
    // 覆盖掉下面保存的新人设（校验随之读回旧值并回滚）。
    if (pendingRosterNormalize) {
      try {
        await pendingRosterNormalize;
      } catch (_) { /* 补齐失败不阻塞本次保存 */ }
      pendingRosterNormalize = null;
    }
    const previousAssistants = assistants.map((item) => ({ ...item }));
    const isNew = !editingAsstId;
    const asstId = isNew ? `asst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` : editingAsstId;

    let target = assistants.find((a) => a && a.id === asstId);
    if (!target) {
      target = {
        id: asstId,
        isActive: assistants.length === 0,
        createdAt: Date.now()
      };
      assistants.unshift(target);
    }
    // 认领 id：新建后 editingAsstId 必须指向这条，否则下一次保存又生成随机 id，重复 INSERT。
    editingAsstId = asstId;

    target.name = name;
    target.gender = asstGenderInput ? asstGenderInput.value.trim() : '';
    target.serialNo = asstSerialInput ? asstSerialInput.value.trim() : (target.serialNo || getNextAssistantSerial());
    target.birthday = asstBirthdayInput ? asstBirthdayInput.value.trim() : (target.birthday || formatAssistantDate(target.createdAt));
    target.voiceId = asstVoiceIdInput ? asstVoiceIdInput.value.trim() : '';
    target.appearance = asstAppearanceInput ? asstAppearanceInput.value.trim() : '';
    target.corePrompt = asstProfileInput ? asstProfileInput.value.trim() : '';
    target.updatedAt = Date.now();

    // 资产持久化
    if (isAsstAvatarDirty) {
      if (pendingAsstAvatarAsset) {
        await Storage.setAsset(ASSET_PREFIX_ASST_AVATAR + asstId, pendingAsstAvatarAsset);
      } else {
        await Storage.removeAsset(ASSET_PREFIX_ASST_AVATAR + asstId);
      }
    }

    if (isAsstFaceIdDirty) {
      if (pendingAsstFaceIdAsset) {
        await Storage.setAsset(ASSET_PREFIX_ASST_FACE_ID + asstId, pendingAsstFaceIdAsset);
      } else {
        await Storage.removeAsset(ASSET_PREFIX_ASST_FACE_ID + asstId);
      }
    }

    const saved = await saveAssistants();
    const persisted = saved ? await Storage.getDoc(Store.KEYS.rosterAssistants, []) : [];
    const persistedTarget = Array.isArray(persisted)
      ? persisted.find((item) => item && item.id === asstId)
      : null;
    const verified = !!(
      saved
      && persistedTarget
      && persistedTarget.name === target.name
      && (persistedTarget.corePrompt || '') === (target.corePrompt || '')
    );

    if (!verified) {
      assistants = previousAssistants;
      await Store.save('roster.assistants', previousAssistants);
      toastResonance('SAVE ERROR // 落盘失败', '助手档案未能写入本地数据库', '请保留当前页面并重试', 'error');
      // 必须显式返回 false：调用方 saveActiveEditor 判的是 `!== false`，
      // 裸 return（undefined）会让这次「回滚」被当成保存成功，
      // 于是编辑器照常退回列表、不报错，用户看到的就是「改了但没生效」。
      return false;
    }

    // 如果保存的是当前激活态助手，统一刷新聊天页身份显示（备注优先级不受影响）
    if (target.isActive && window.SystemChatUI && typeof SystemChatUI.syncHeaderIdentity === 'function') {
      SystemChatUI.syncHeaderIdentity();
    }
    // 立绘有变动时，把已渲染的气泡头像一并刷新，并广播给其它展示位（列表卡片等）。
    // 否则数据虽已落盘，界面上仍是旧图 —— 就是「换了头像但窗口没换」。
    if (isAsstAvatarDirty) {
      if (window.SystemChatUI && typeof SystemChatUI.refreshAssistantAvatars === 'function') {
        try {
          await SystemChatUI.refreshAssistantAvatars(asstId);
        } catch (_) { /* 刷新失败不影响已落盘的数据 */ }
      }
      window.dispatchEvent(new CustomEvent('retroflow:assistant-avatar-changed', {
        detail: { assistantId: asstId }
      }));
    }

    toastResonance('SAVED // 拟态已保存', `助手档案「${target.name}」已更新`, '', 'success');

    // 不在此处跳转：调用方自行决定是否退回列表
    return true;
  }

  async function deleteAsstEditor() {
    if (!editingAsstId || editingAsstId === 'asst_system_core') return;

    if (window.RetroModal && RetroModal.confirm) {
      const ok = await RetroModal.confirm({
        title: '销毁助手拟态',
        message: '确定要彻底移除此系统助手人格模组吗？此操作不可逆。',
        confirmText: '彻底销毁',
        danger: true
      });
      if (!ok) return;
    }

    loadAssistants();
    const wasActive = assistants.some((a) => a && a.id === editingAsstId && a.isActive);
    assistants = assistants.filter((a) => a && a.id !== editingAsstId);

    if (wasActive && assistants.length > 0) {
      assistants[0].isActive = true;
    }

    // 清理图片资产
    try {
      await Storage.removeAsset(ASSET_PREFIX_ASST_AVATAR + editingAsstId);
      await Storage.removeAsset(ASSET_PREFIX_ASST_FACE_ID + editingAsstId);
    } catch (e) { /* ignore */ }

    await saveAssistants();
    showAsstListView();
  }

  /* ================= 角色/NPC 通用名称解析 ================= */
  function resolveCharName(id) {
    const c = characters.find((x) => x && x.id === id);
    if (c) return c.name || '未命名角色';
    const n = npcs.find((x) => x && x.id === id);
    if (n) return n.name || '未命名NPC';
    return '（档案已移除）';
  }

  async function resolveAvatarSrc(id) {
    if (!id) return null;
    try {
      if (id.startsWith('npc_')) {
        return await Storage.getAssetSrc(ASSET_PREFIX_NPC_AVATAR + id);
      }
      return await Storage.getAssetSrc(ASSET_PREFIX_CHAR_AVATAR + id);
    } catch (e) {
      return null;
    }
  }

  /* ================= 人际关系 UI 层 ================= */

  const NEXUS_PLACEHOLDER_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  `;

  // 弹窗会话态
  let nexusEditingRelId = null;   // 编辑既有关系时的记录 id
  let nexusSelfId = null;         // 左侧当前角色
  let nexusTargetId = null;       // 右侧已选对象
  let nexusScope = 'char';        // 'char' | 'npc' | 'builtin'
  let nexusPrevFocus = null;

  function setNexusAvatar(imgEl, phEl, src) {
    if (!imgEl || !phEl) return;
    if (src) {
      imgEl.src = src;
      imgEl.hidden = false;
      phEl.hidden = true;
    } else {
      imgEl.removeAttribute('src');
      imgEl.hidden = true;
      phEl.hidden = false;
    }
  }

  // 渲染卡片 03 的关系列表
  async function renderCharNexusList() {
    const listEl = document.getElementById('charNexusList');
    const emptyEl = document.getElementById('charNexusEmpty');
    const sectionEl = document.getElementById('charNexusSection');
    const lockedTip = document.getElementById('charNexusLockedTip');
    if (!listEl) return;

    // 新建角色尚无 id，无法建立关系（关系两端都需要真实 id）
    const isNewChar = !editingCharId;
    if (sectionEl) sectionEl.classList.toggle('is-locked', isNewChar);
    if (lockedTip) lockedTip.hidden = !isNewChar;

    listEl.innerHTML = '';

    if (isNewChar) {
      if (emptyEl) emptyEl.hidden = true;
      return;
    }

    const mine = getRelationsOf(editingCharId);
    if (mine.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    for (const rel of mine) {
      const row = document.createElement('div');
      row.className = 'nexus-relation-row';
      row.dataset.relId = rel.id;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      let avatarSrc = null;
      try {
        avatarSrc = await resolveAvatarSrc(rel.otherId);
      } catch (e) {
        /* ignore */
      }

      const otherName = resolveCharName(rel.otherId);
      row.innerHTML = `
        <div class="nexus-row-avatar">
          ${avatarSrc ? `<img src="${avatarSrc}" alt="">` : NEXUS_PLACEHOLDER_SVG}
        </div>
        <div class="nexus-row-text">
          <div class="nexus-row-head">
            <span class="nexus-row-name">${escapeHtml(otherName)}</span>
            <span class="nexus-row-relation">${escapeHtml(rel.relation || '未定')}</span>
          </div>
          <div class="nexus-row-desc">${escapeHtml(rel.desc || '')}</div>
        </div>
        <button type="button" class="nexus-row-remove-btn" aria-label="移除这条关系">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.nexus-row-remove-btn')) return;
        openNexusModal(rel.id);
      });
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNexusModal(rel.id);
        }
      });

      const rmBtn = row.querySelector('.nexus-row-remove-btn');
      if (rmBtn) {
        rmBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await RetroModal.confirm({
            message: `移除与「${otherName}」的关系记录？`,
            detail: '这条关系在双方档案中都会消失，角色档案本身不受影响。',
            confirmText: '确认移除',
            cancelText: '取消',
            danger: true
          });
          if (!ok) return;
          removeRelation(rel.id);
          refreshActiveNexusList();
        });
      }

      listEl.appendChild(row);
    }
  }

  // 按指定范围取候选对象，排除自己和已建立关系的人
  function collectNexusCandidates(scope = nexusScope) {
    if (scope === 'char') {
      return characters
        .filter((c) => c && c.id !== nexusSelfId)
        .filter((c) => !hasRelationBetween(nexusSelfId, c.id) || c.id === nexusTargetId)
        .map((c) => ({
          value: c.id,
          label: c.name || '未命名角色',
          hint: c.camp === 'instance'
            ? 'SRC.FORK // 副本'
            : `SRC.SYS // ${c.serial ? 'NO.' + c.serial : '无编号'}`
        }));
    }
    if (scope === 'npc') {
      return npcs
        .filter((n) => n && n.id !== nexusSelfId)
        .filter((n) => !hasRelationBetween(nexusSelfId, n.id) || n.id === nexusTargetId)
        .map((n) => ({
          value: n.id,
          label: n.name || '未命名NPC',
          hint: n.camp === 'instance'
            ? 'NPC.FORK // 副本'
            : `NPC.SYS // ${n.serial ? 'NO.' + n.serial : '无编号'}`
        }));
    }
    // 官方角色维次尚未落地，先返回空
    return [];
  }

  // 跨维度全域候选：角色 + NPC 通取（点击对方头像时使用）
  function collectAllNexusCandidates() {
    return [
      ...collectNexusCandidates('char'),
      ...collectNexusCandidates('npc')
    ];
  }

  // 依据当前实际编辑态刷新对应的关系列表（角色档案 / NPC 档案）
  function refreshActiveNexusList() {
    const npcEditVisible = npcEditView && !npcEditView.hidden;
    if (npcEditVisible) {
      renderNpcNexusList();
    } else {
      renderCharNexusList();
    }
  }

  async function pickNexusTarget(preferredScope = null) {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;

    // 无参调用（点击对方头像）：跨维度全域取候选，不受当前筛选维度限制
    const isGlobal = !preferredScope;
    if (preferredScope) {
      nexusScope = preferredScope;
    }
    const currentScope = nexusScope;
    const opts = isGlobal ? collectAllNexusCandidates() : collectNexusCandidates(currentScope);
    const scopeLabel = currentScope === 'char' ? '角色' : currentScope === 'npc' ? 'NPC' : '官方角色';

    if (opts.length === 0) {
      if (window.RetroToast) {
        if (isGlobal) {
          RetroToast.show({
            tag: 'NEXUS // 关系对象',
            message: '没有可建立关系的对象',
            detail: '角色与 NPC 档案尚未建档，或已全部登记过关系。',
            type: 'warn'
          });
        } else {
          RetroToast.show({
            tag: `NEXUS // ${scopeLabel}`,
            message: currentScope === 'char' ? '没有可建立关系的角色' : `${scopeLabel}档案还没有数据`,
            detail: currentScope === 'char'
              ? '其他角色尚未建档，或已全部登记过关系。'
              : `先去 ${scopeLabel} 维次建立档案，之后即可在此处关联。`,
            type: 'warn'
          });
        }
      }
      return;
    }

    const picked = await SelectModal.pick({
      title: isGlobal ? '选择关系对象' : `选择${scopeLabel}`,
      tag: 'NEXUS // 关系对象',
      options: opts,
      value: nexusTargetId || ''
    });
    if (!picked) return;

    nexusTargetId = picked;
    await refreshNexusTargetDisplay();
    syncNexusSaveState();
  }

  async function refreshNexusTargetDisplay() {
    const img = document.getElementById('nexusTargetAvatarImg');
    const ph = document.getElementById('nexusTargetAvatarPh');
    const nameEl = document.getElementById('nexusTargetName');
    const roleEl = document.getElementById('nexusTargetRole');

    if (!nexusTargetId) {
      setNexusAvatar(img, ph, null);
      if (nameEl) {
        nameEl.textContent = '待选择';
        nameEl.classList.add('is-muted');
      }
      if (roleEl) roleEl.textContent = 'TARGET';
      return;
    }

    let src = null;
    try {
      src = await resolveAvatarSrc(nexusTargetId);
    } catch (e) {
      /* ignore */
    }
    setNexusAvatar(img, ph, src);

    if (nameEl) {
      nameEl.textContent = resolveCharName(nexusTargetId);
      nameEl.classList.remove('is-muted');
    }
    if (roleEl) {
      const t = characters.find((c) => c && c.id === nexusTargetId);
      if (t) {
        roleEl.textContent = t.camp === 'instance' ? 'SRC.FORK' : 'SRC.SYS';
      } else {
        const n = npcs.find((x) => x && x.id === nexusTargetId);
        roleEl.textContent = n && n.camp === 'instance' ? 'NPC.FORK' : 'NPC.SYS';
      }
    }
  }

  function syncNexusSaveState() {
    const saveBtn = document.getElementById('nexusModalSaveBtn');
    const relInput = document.getElementById('nexusRelationInput');
    if (!saveBtn) return;
    const hasBoth = !!(nexusSelfId && nexusTargetId && nexusSelfId !== nexusTargetId);
    const hasRelation = !!(relInput && relInput.value.trim());
    saveBtn.disabled = !(hasBoth && hasRelation);
  }

  async function refreshNexusSelfDisplay() {
    const img = document.getElementById('nexusSelfAvatarImg');
    const ph = document.getElementById('nexusSelfAvatarPh');
    const nameEl = document.getElementById('nexusSelfName');
    const roleEl = document.getElementById('nexusSelfRole');

    if (!nexusSelfId) {
      setNexusAvatar(img, ph, null);
      if (nameEl) {
        nameEl.textContent = '待选择';
        nameEl.classList.add('is-muted');
      }
      if (roleEl) roleEl.textContent = 'SOURCE';
      return;
    }

    let src = null;
    try {
      src = await resolveAvatarSrc(nexusSelfId);
    } catch (e) {
      /* ignore */
    }
    setNexusAvatar(img, ph, src);

    if (nameEl) {
      nameEl.textContent = resolveCharName(nexusSelfId);
      nameEl.classList.remove('is-muted');
    }
    if (roleEl) {
      const t = characters.find((c) => c && c.id === nexusSelfId);
      if (t) {
        roleEl.textContent = t.camp === 'instance' ? 'SRC.FORK' : 'SRC.SYS';
      } else {
        const n = npcs.find((x) => x && x.id === nexusSelfId);
        roleEl.textContent = n && n.camp === 'instance' ? 'NPC.FORK' : 'NPC.SYS';
      }
    }
  }

  async function pickNexusSelf() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    if (nexusEditingRelId) return; // 编辑既有关系时不可改人

    const opts = [
      ...collectNexusCandidates('char', nexusTargetId),
      ...collectNexusCandidates('npc', nexusTargetId)
    ];

    if (opts.length === 0) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'NEXUS // 主体人物',
          message: '没有可选择的主体人物',
          detail: '请先录入角色或 NPC 档案。',
          type: 'warn'
        });
      }
      return;
    }

    const picked = await SelectModal.pick({
      title: '选择主体人物',
      tag: 'NEXUS // 关系发起方',
      options: opts,
      value: nexusSelfId || ''
    });
    if (!picked) return;

    nexusSelfId = picked;
    await refreshNexusSelfDisplay();
    syncNexusSaveState();

    // 如果右侧尚未选择，贴心地自动引导选择右侧客体
    if (!nexusTargetId) {
      setTimeout(() => pickNexusTarget(), 200);
    }
  }

  async function openNexusModal(relId = null, defaultSelfId = null) {
    const overlay = document.getElementById('nexusModalOverlay');
    if (!overlay) return;

    nexusPrevFocus = document.activeElement;
    nexusEditingRelId = relId;
    nexusSelfId = defaultSelfId || editingCharId || null;
    nexusScope = 'char';

    const relInput = document.getElementById('nexusRelationInput');
    const descInput = document.getElementById('nexusDescInput');
    const titleEl = document.getElementById('nexusModalTitle');
    const tagEl = document.getElementById('nexusModalTag');
    const saveBtn = document.getElementById('nexusModalSaveBtn');
    const selfAvatarBtn = document.getElementById('nexusSelfAvatar');
    const targetAvatarBtn = document.getElementById('nexusTargetAvatar');

    if (relId) {
      const rec = relations.find((r) => r && r.id === relId);
      if (rec) {
        // 如果是从某人档案打开的，保持那个人在左边；否则默认 aId 在左
        if (nexusSelfId && (rec.aId === nexusSelfId || rec.bId === nexusSelfId)) {
          nexusTargetId = rec.aId === nexusSelfId ? rec.bId : rec.aId;
        } else {
          nexusSelfId = rec.aId;
          nexusTargetId = rec.bId;
        }
      } else {
        nexusTargetId = null;
      }
      if (relInput) relInput.value = rec ? (rec.relation || '') : '';
      if (descInput) descInput.value = rec ? (rec.desc || '') : '';
      if (titleEl) titleEl.textContent = '编辑人际关系';
      if (tagEl) tagEl.textContent = 'NEXUS // 关系修订';
      if (saveBtn) saveBtn.textContent = '保存修改';
      // 编辑既有关系时不允许换人，避免语义漂移；要换人请移除后重建
      if (selfAvatarBtn) {
        selfAvatarBtn.classList.remove('is-pickable');
        selfAvatarBtn.disabled = true;
      }
      if (targetAvatarBtn) {
        targetAvatarBtn.classList.remove('is-pickable');
        targetAvatarBtn.disabled = true;
      }
    } else {
      nexusTargetId = null;
      if (relInput) relInput.value = '';
      if (descInput) descInput.value = '';
      if (titleEl) titleEl.textContent = '添加人际关系';
      if (tagEl) tagEl.textContent = 'NEXUS // 关系登记';
      if (saveBtn) saveBtn.textContent = '登记关系';
      if (selfAvatarBtn) {
        selfAvatarBtn.classList.add('is-pickable');
        selfAvatarBtn.disabled = false;
      }
      if (targetAvatarBtn) {
        targetAvatarBtn.classList.add('is-pickable');
        targetAvatarBtn.disabled = false;
      }
    }

    await refreshNexusSelfDisplay();
    await refreshNexusTargetDisplay();
    syncNexusSaveState();

    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('active'));

    // 如果左右两边都是空的（全局新建），自动引导选左边
    if (!nexusEditingRelId && !nexusSelfId) {
      setTimeout(() => pickNexusSelf(), 220);
    }
  }

  function closeNexusModal() {
    const overlay = document.getElementById('nexusModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => {
      overlay.hidden = true;
      nexusEditingRelId = null;
      nexusSelfId = null;
      nexusTargetId = null;
      if (nexusPrevFocus && typeof nexusPrevFocus.focus === 'function') {
        nexusPrevFocus.focus();
      }
      nexusPrevFocus = null;
    }, 200);
  }

  async function handleSaveNexusRelation() {
    const relInput = document.getElementById('nexusRelationInput');
    const descInput = document.getElementById('nexusDescInput');
    const relation = (relInput?.value || '').trim();
    const desc = (descInput?.value || '').trim();

    if (!nexusSelfId || !nexusTargetId || !relation) return;

    // 新建时二次确认未重复（弹窗开着期间数据可能被别处改动）
    if (!nexusEditingRelId && hasRelationBetween(nexusSelfId, nexusTargetId)) {
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'NEXUS // 羁绊冲突',
          message: '这两人之间已有关系记录',
          detail: '一对角色之间只保留一条关系。回到列表里编辑那一条即可。',
          type: 'warn'
        });
      }
      return;
    }

    upsertRelation({
      id: nexusEditingRelId,
      aId: nexusSelfId,
      bId: nexusTargetId,
      relation,
      desc
    });

    closeNexusModal();
    refreshActiveNexusList();
    renderNexusMatrixList();
  }

  function bindNexusEvents() {
    const addBtn = document.getElementById('charNexusAddBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => openNexusModal(null));
    }

    const closeBtn = document.getElementById('nexusModalCloseBtn');
    const cancelBtn = document.getElementById('nexusModalCancelBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeNexusModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeNexusModal);

    const overlay = document.getElementById('nexusModalOverlay');
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeNexusModal();
      });
    }

    window.addEventListener('keydown', (e) => {
      const ov = document.getElementById('nexusModalOverlay');
      if (e.key === 'Escape' && ov && !ov.hidden) closeNexusModal();
    });

    const selfBtn = document.getElementById('nexusSelfAvatar');
    if (selfBtn) {
      selfBtn.addEventListener('click', () => pickNexusSelf());
    }

    const targetBtn = document.getElementById('nexusTargetAvatar');
    if (targetBtn) {
      targetBtn.addEventListener('click', () => pickNexusTarget());
    }

    const relInput = document.getElementById('nexusRelationInput');
    if (relInput) {
      relInput.addEventListener('input', syncNexusSaveState);
    }

    const saveBtn = document.getElementById('nexusModalSaveBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', handleSaveNexusRelation);
    }

    document.querySelectorAll('#nexusScopeRow .nexus-scope-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scope = btn.dataset.scope || 'char';
        // 点击任意维度直接以该维度拉起选择面板
        pickNexusTarget(scope);
      });
    });
  }

  /* ================= 编号注册中心 (Serial Registry) ================= */

  // 系统保留编号池：内置角色（维次 03）尚未落地，先建立统一登记处，
  // 待内置角色实装后其编号从同一池读取，去重逻辑无需重写。
  const RESERVED_SERIALS = [
    '000000', // 系统占位
    '000001', // 溯流计划系统本体
    '999999'  // 因果律观测者（保留）
  ];

  // 编号规范化：剥离 NO. 前缀、只留数字并补齐 6 位，
  // 保证 '517' 与 '000517' 被视为同一编号，无法绕过校验。
  function normalizeSerial(raw) {
    if (raw === null || raw === undefined) return '';
    let s = String(raw).trim().replace(/^NO\./i, '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length > 6) s = s.slice(-6);
    return s.padStart(6, '0');
  }

  // 读取执行员本体当前的名字，用于弹窗中指名道姓地提示占用方。
  // 编号归个人档案管，所以优先取档案身份里的名字；
  // 红卡上的名字是独立装饰内容，仅在档案未填名时兜底。
  function getEnvoyName() {
    const n = String((Store.envoy.identity && Store.envoy.identity.name) || '').trim();
    if (n) return n;
    const cardName = String(Store.decor.cardName || '').trim();
    if (cardName) return cardName;
    return '执行员';
  }

  // 查出某个编号具体被谁占用，返回可直接展示的占用方名称
  function findSerialOwner(serial, excludeCharId = null) {
    const target = normalizeSerial(serial);
    if (!target) return null;

    // 执行员本体：编号是单一真相源，就在个人档案身份里
    if (normalizeSerial(Store.getSerialNo()) === target) return getEnvoyName();

    // 其他角色档案与NPC档案（副本阵营无编号，不参与占用）
    const clashChar = (characters || []).find((c) => {
      if (!c) return false;
      if (c.camp === 'instance') return false;
      if (excludeCharId && c.id === excludeCharId) return false;
      return normalizeSerial(c.serial) === target;
    });
    if (clashChar) return clashChar.name || '未命名角色';

    const clashNpc = (npcs || []).find((n) => {
      if (!n) return false;
      if (n.camp === 'instance') return false;
      if (excludeCharId && n.id === excludeCharId) return false;
      return normalizeSerial(n.serial) === target;
    });
    if (clashNpc) return clashNpc.name || '未命名NPC';

    // 系统保留编号
    if (RESERVED_SERIALS.some((s) => normalizeSerial(s) === target)) {
      return '溯流计划系统';
    }

    return null;
  }

  // 汇总当前已被占用的全部编号（执行员本体 + 其他角色 + 系统保留）
  // @param {string|null} excludeCharId 编辑态下需排除自身，避免自己撞自己
  function collectTakenSerials(excludeCharId = null) {
    const taken = new Set();

    RESERVED_SERIALS.forEach((s) => taken.add(normalizeSerial(s)));

    // 执行员本体编号（单一真相源）
    const envoySerial = normalizeSerial(Store.getSerialNo());
    if (envoySerial) taken.add(envoySerial);

    // 其余角色档案与NPC编号（副本阵营无编号，不占号）
    (characters || []).forEach((c) => {
      if (!c) return;
      if (c.camp === 'instance') return;
      if (excludeCharId && c.id === excludeCharId) return;
      const n = normalizeSerial(c.serial);
      if (n) taken.add(n);
    });

    (npcs || []).forEach((npc) => {
      if (!npc) return;
      if (npc.camp === 'instance') return;
      if (excludeCharId && npc.id === excludeCharId) return;
      const n = normalizeSerial(npc.serial);
      if (n) taken.add(n);
    });

    return taken;
  }

  // 创建角色时随机签发一枚不冲突的 6 位编号
  function generateUniqueSerial() {
    const taken = collectTakenSerials(null);

    for (let i = 0; i < 200; i++) {
      const candidate = String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
      if (!taken.has(candidate)) return candidate;
    }

    // 极端兜底：随机 200 次仍全部撞号时线性扫描第一个空位
    for (let n = 1; n <= 999999; n++) {
      const candidate = String(n).padStart(6, '0');
      if (!taken.has(candidate)) return candidate;
    }

    return String(Date.now()).slice(-6);
  }

  function formatSerial(serial, fallbackIndex) {
    if (serial && String(serial).trim()) {
      const s = String(serial).trim();
      return s.startsWith('NO.') ? s : `NO.${s}`;
    }
    const idx = (fallbackIndex + 1).toString().padStart(6, '0');
    return `NO.${idx}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  /* ================= 列表渲染 ================= */

  // 阵营 → 侧条微标代号（读 char.camp：operative / instance）
const CAMP_TAG_MAP = {
  operative: 'SRC.SYS',
  instance: 'SRC.FORK'
};

function resolveFactionTag(char) {
  const camp = (char && char.camp === 'instance') ? 'instance' : 'operative';
  return CAMP_TAG_MAP[camp];
}

// 阶位 → 火漆印印文（全大写英文代号，圆形印面内单行排布）
  // 注：印面为圆形，字数越多有效弦长越窄，故一律控制在 7 字母以内
  const RANK_SEAL_TEXT = {
    novice: 'NOVICE',
    veteran: 'VETERAN',
    apex: 'APEX',
    awakened: 'AWAKE',
    drifter: 'DRIFTER'
  };

  // 阶位 → 点阵深度（菱形印记数量 1~3）
  const RANK_SEAL_PIPS = {
    novice: 1,
    veteran: 2,
    apex: 3,
    awakened: 1,
    drifter: 2
  };

  function resolveRankInfo(char) {
    const camp = char && char.camp === 'instance' ? 'instance' : 'operative';
    const fallback = camp === 'instance' ? 'awakened' : 'novice';
    const rank = (char && char.rank) || fallback;
    const sealText = RANK_SEAL_TEXT[rank] || RANK_SEAL_TEXT[fallback];
    const pipCount = RANK_SEAL_PIPS[rank] || 1;
    return { rank, sealText, pipCount };
  }
  // 并发渲染守卫：open() 与 switchDimension() 会先后触发同一轮渲染，
  // 循环内 await 立绘期间两轮会交错追加导致卡片重复，用递增令牌让旧轮次自行作废。
  let charListRenderToken = 0;

  async function renderCharList() {
    if (!charCardList) return;
    const token = ++charListRenderToken;

    const list = characters || [];
    if (charCountBadge) {
      charCountBadge.textContent = list.length;
    }

    if (list.length === 0) {
      charCardList.innerHTML = '';
      if (charEmptyView) charEmptyView.hidden = false;
      return;
    }

    if (charEmptyView) charEmptyView.hidden = true;

    // 卡片先攒进碎片，最后整体替换，避免半渲染态闪现与并发交错
    const frag = document.createDocumentFragment();


    for (let i = 0; i < list.length; i++) {
      const char = list[i];
      const card = document.createElement('div');
      card.className = 'resonance-gallery-card';
      card.dataset.id = char.id;
      // 阵营标记：驱动侧条配色（执行员=反色 / 副本=重点色）
      card.dataset.camp = char.camp === 'instance' ? 'instance' : 'operative';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', `查看角色档案：${char.name || '未命名'}`);

      // 从 Storage 读取立绘
      let avatarSrc = null;
      try {
        avatarSrc = await Storage.getAssetSrc(ASSET_PREFIX_CHAR_AVATAR + char.id);
      } catch (e) {
        console.warn(`[Resonance] 读取角色立绘失败:`, e);
      }

      // 本轮渲染已被更新的一轮取代，直接放弃，避免重复追加
      if (token !== charListRenderToken) return;

      const serialText = formatSerial(char.serial, i);
      const nameText = char.name || '未命名角色';
      const factionTag = resolveFactionTag(char);
      // 副本阵营不属于溯流编制、无编号，侧条改显阵营代号而非编号
      const isInstanceCamp = char.camp === 'instance';
      const sidebarSerialText = isInstanceCamp ? 'NO ENTRY' : serialText;
      const { rank: charRank, sealText, pipCount } = resolveRankInfo(char);

      const pipsHtml = Array.from({ length: pipCount })
        .map(() => '<span class="resonance-seal-pip"></span>')
        .join('');

      const displayHtml = avatarSrc
        ? `<img class="resonance-card-img" src="${escapeHtml(avatarSrc)}" alt="${escapeHtml(nameText)}" loading="lazy">`
        : `
          <div class="resonance-card-placeholder">
            <span class="resonance-ph-tag">RETROFLOW // CHAR</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/>
            </svg>
            <span class="resonance-ph-tip">STANDBY // 待接入头像</span>
          </div>
        `;

      card.innerHTML = `
        <!-- 左侧纯实色辅助条：长编号 + 阵营代号 + 大字姓名 + 机读光学条码 -->
        <div class="resonance-card-sidebar">
          <div class="resonance-sidebar-top">
            <div class="resonance-sidebar-serial">${escapeHtml(sidebarSerialText)}</div>
            <div class="resonance-sidebar-tag">${escapeHtml(factionTag)}</div>
          </div>
          <div class="resonance-sidebar-bottom">
            <div class="resonance-sidebar-name">${escapeHtml(nameText)}</div>
            <svg class="resonance-sidebar-barcode" viewBox="0 0 12 20" aria-hidden="true">
              <!-- 5 根非对称高度机读条码横条（竖向延伸） -->
              <rect x="0" y="0" width="12" height="2" />
              <rect x="0" y="4" width="12" height="1" />
              <rect x="0" y="7" width="12" height="3" />
              <rect x="0" y="12" width="12" height="1.5" />
              <rect x="0" y="16" width="12" height="4" />
            </svg>
          </div>
        </div>

        <!-- 右侧满铺大头像展台 -->
        <div class="resonance-card-display">
          ${displayHtml}
        </div>

        <!-- 阶位火漆印：卡片右缘垂直 3/4 处破框，2/3 压在展台内 -->
        <div class="resonance-rank-seal" data-rank="${escapeHtml(charRank)}" data-len="${sealText.length}" aria-hidden="true">
          <span class="resonance-seal-auth">AUTH</span>
          <span class="resonance-seal-text">${escapeHtml(sealText)}</span>
          <div class="resonance-seal-pips">
            ${pipsHtml}
          </div>
        </div>
      `;

      card.addEventListener('click', () => {
        openCharEditor(char.id);
      });

      frag.appendChild(card);
    }

    // 本轮为最新渲染：整体替换列表内容，杜绝并发交错造成的重复卡片
    if (token !== charListRenderToken) return;
    charCardList.innerHTML = '';
    charCardList.appendChild(frag);
  }

  /* ================= 视图切换与编辑流程 ================= */

  // 详情编辑态需要独占全宽：导轨退场并收回 63px 避让通道（含顶栏通道）
  function setRailVisible(visible) {
    if (resonanceIndexRail) resonanceIndexRail.hidden = !visible;
    if (resonanceRailLayout) {
      resonanceRailLayout.classList.toggle('rail-collapsed', !visible);
    }
    // 顶栏通道同步收放，避免导轨退场后右侧留出空白缺口
    const resonanceHeader = document.querySelector('#resonancePage .settings-header');
    if (resonanceHeader) {
      resonanceHeader.classList.toggle('with-rail', visible);
    }
  }

  /* ================= 阵营切换阀门控制器 ================= */

  const CAMP_CONFIG = {
    operative: {
      tag: 'OPERATIVE // 执行员',
      code: 'SYS_OPERATIVE // 溯流员工编制',
      desc: '溯流计划员工，进入不同副本执行任务。'
    },
    instance: {
      tag: 'INSTANCE // 副本高位',
      code: 'ANOMALY_CORE // 副本世界知情者',
      desc: '副本世界中的高位存在，知晓执行员的来历，亦知晓自身所处的世界是副本。'
    }
  };

  function setCharCamp(camp, animate = true) {
    const targetCamp = camp === 'instance' ? 'instance' : 'operative';
    editingCharCamp = targetCamp;

    const conf = CAMP_CONFIG[targetCamp];

    if (charCampStatusTag) charCampStatusTag.textContent = conf.tag;
    if (charCampDescCode) charCampDescCode.textContent = conf.code;
    if (charCampDescContent) charCampDescContent.textContent = conf.desc;

    if (charCampValveTrack) {
      charCampValveTrack.classList.toggle('instance-selected', targetCamp === 'instance');
    }
    if (charCampPivotCard) {
      charCampPivotCard.classList.toggle('instance-active', targetCamp === 'instance');
    }

    if (campOptOperative) {
      const isOp = targetCamp === 'operative';
      campOptOperative.classList.toggle('active', isOp);
      campOptOperative.setAttribute('aria-checked', isOp ? 'true' : 'false');
    }
    if (campOptInstance) {
      const isInst = targetCamp === 'instance';
      campOptInstance.classList.toggle('active', isInst);
      campOptInstance.setAttribute('aria-checked', isInst ? 'true' : 'false');
    }

    // 动态描述平滑呼吸重放
    const descBox = document.getElementById('charCampDescBox');
    if (animate && descBox && window.Motion && typeof Motion.replay === 'function') {
      Motion.replay(descBox);
    }

    // 阶位卡组（Deck）互斥显隐
    if (rankDeckOperative && rankDeckInstance) {
      const isOp = targetCamp === 'operative';
      if (window.Motion && typeof Motion.swap === 'function') {
        Motion.swap(isOp ? rankDeckOperative : rankDeckInstance, [isOp ? rankDeckInstance : rankDeckOperative]);
      } else {
        rankDeckOperative.hidden = !isOp;
        rankDeckInstance.hidden = isOp;
      }
    }

    // 阵营切换时，校准该阵营下的阶位（若当前 rank 不属于该阵营，切回该阵营默认首项）
    const operativeRanks = ['novice', 'veteran', 'apex'];
    const instanceRanks = ['awakened', 'drifter'];

    if (targetCamp === 'operative' && !operativeRanks.includes(editingCharRank)) {
      setCharRank('novice');
    } else if (targetCamp === 'instance' && !instanceRanks.includes(editingCharRank)) {
      setCharRank('awakened');
    } else {
      setCharRank(editingCharRank);
    }

    // 编号联动：副本阵营无执行员编制，编号字段淡化锁定并清空
    applySerialLock(targetCamp);
  }

  /* ================= 编号字段阵营联动 ================= */

  // 副本阵营（instance）不属于溯流编制，因此没有执行员编号：
  // 淡化整组字段、清空并锁定输入；切回执行员时优先复位原号，
  // 原号缺失或已被他人占用时才摇一个新的未占用编号。
  function applySerialLock(camp) {
    const isInstance = camp === 'instance';

    if (charSerialFieldGroup) {
      charSerialFieldGroup.classList.toggle('serial-locked', isInstance);
    }

    if (!charSerialInput) return;

    if (isInstance) {
      const cur = (charSerialInput.value || '').trim();
      if (cur) stashedOperativeSerial = cur;
      charSerialInput.value = '';
      charSerialInput.readOnly = true;
      charSerialInput.tabIndex = -1;
      charSerialInput.setAttribute('aria-disabled', 'true');
      charSerialInput.placeholder = '副本角色无编号';
    } else {
      charSerialInput.readOnly = false;
      charSerialInput.tabIndex = 0;
      charSerialInput.removeAttribute('aria-disabled');
      charSerialInput.placeholder = '000001';

      if (!(charSerialInput.value || '').trim()) {
        const stashed = normalizeSerial(stashedOperativeSerial);
        const taken = collectTakenSerials(editingCharId);
        charSerialInput.value = (stashed && !taken.has(stashed))
          ? stashed
          : generateUniqueSerial();
      }
    }
  }

  /* ================= 阶位手风琴选择控制器 ================= */

  function setCharRank(rank) {
    editingCharRank = rank;

    // 更新当前可见 Deck 内各小卡的手风琴展开状态
    allRankCards.forEach((card) => {
      const cardRank = card.dataset.rank;
      const isSelected = cardRank === rank;
      card.classList.toggle('active', isSelected);
      card.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
  }

  function showCharListView() {
    setActiveEditor(null);
    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(charListView, [charEditView]);
    } else {
      if (charEditView) charEditView.hidden = true;
      if (charListView) charListView.hidden = false;
    }
    editingCharId = null;
    pendingAvatarAsset = null;
    pendingAvatarDisplay = null;
    pendingFaceIdAsset = null;
    pendingFaceIdDisplay = null;
    isAvatarDirty = false;
    isFaceIdDirty = false;
    setRailVisible(true);
    renderCharList();
  }

  async function openCharEditor(charId = null) {
    editingCharId = charId;
    setActiveEditor('char');
    isAvatarDirty = false;
    isFaceIdDirty = false;
    pendingAvatarAsset = null;
    pendingAvatarDisplay = null;
    pendingFaceIdAsset = null;
    pendingFaceIdDisplay = null;
    // 每次进入编辑器都重置编号缓存，避免跨角色串号
    stashedOperativeSerial = '';

    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(charEditView, [charListView]);
    } else {
      if (charListView) charListView.hidden = true;
      if (charEditView) charEditView.hidden = false;
    }

    setRailVisible(false);

    const scroller = resonancePage ? resonancePage.querySelector('.settings-body-scroll') : null;
    if (scroller) scroller.scrollTop = 0;

    if (charId) {
      // 编辑已有角色
      const char = characters.find((c) => c.id === charId);
      if (!char) {
        showCharListView();
        return;
      }

      if (charEditDeleteBtn) charEditDeleteBtn.hidden = false;

      // 恢复阵营与阶位
      setCharCamp(char.camp || 'operative', false);
      setCharRank(char.rank || (char.camp === 'instance' ? 'awakened' : 'novice'));

      if (charSerialInput) charSerialInput.value = char.serial || '';
      if (charNameInput) charNameInput.value = char.name || '';
      if (charGenderInput) charGenderInput.value = char.gender || '';
      if (charBirthdayInput) charBirthdayInput.value = char.birthday || '';
      if (charVoiceIdInput) charVoiceIdInput.value = char.voiceId || '';
      if (charAppearanceInput) charAppearanceInput.value = char.appearance || '';
      if (charProfileInput) charProfileInput.value = char.profile || '';
      if (charSelfBriefInput) charSelfBriefInput.value = char.selfBrief || '';

      // setCharCamp 早于编号赋值执行，此处按落库阵营复算一次编号锁定状态
      applySerialLock(char.camp === 'instance' ? 'instance' : 'operative');

      // 恢复立绘
      let avatar = null;
      try {
        avatar = await Storage.getAssetSrc(ASSET_PREFIX_CHAR_AVATAR + charId);
      } catch (e) {
        /* ignore */
      }
      setAvatarDisplay(avatar);

      // 恢复 FACE ID
      let faceId = null;
      try {
        faceId = await Storage.getAssetSrc(ASSET_PREFIX_CHAR_FACE_ID + charId);
      } catch (e) {
        /* ignore */
      }
      setFaceIdDisplay(faceId);

    } else {
      // 新建角色（默认执行员阵营 + 同期新人）
      setCharCamp('operative', false);
      setCharRank('novice');

      if (charEditDeleteBtn) charEditDeleteBtn.hidden = true;

      if (charNameInput) charNameInput.value = '';
      if (charGenderInput) charGenderInput.value = '';
      if (charBirthdayInput) charBirthdayInput.value = '';
      if (charVoiceIdInput) charVoiceIdInput.value = '';
      if (charAppearanceInput) charAppearanceInput.value = '';
      if (charProfileInput) charProfileInput.value = '';
      if (charSelfBriefInput) charSelfBriefInput.value = '';

      // 编号由 setCharCamp('operative') 内的 applySerialLock 摇出，空值时兜底补一枚
      if (charSerialInput && !(charSerialInput.value || '').trim()) {
        charSerialInput.value = generateUniqueSerial();
      }

      setAvatarDisplay(null);
      setFaceIdDisplay(null);
    }

    // 关系区随编辑目标刷新（新建态会自动锁定）
    renderCharNexusList();
  }

  /* ================= 立绘与 FACE ID 界面渲染 ================= */

  function setAvatarDisplay(src) {
    if (src) {
      if (charAvatarImg) {
        charAvatarImg.src = src;
        charAvatarImg.style.display = 'block';
      }
      if (charAvatarPlaceholder) charAvatarPlaceholder.style.display = 'none';
      // 清除按钮常驻占位，仅在无立绘时转入弱化待命态
      if (charClearAvatarBtn) charClearAvatarBtn.classList.remove('is-idle');
    } else {
      if (charAvatarImg) {
        charAvatarImg.removeAttribute('src');
        charAvatarImg.style.display = 'none';
      }
      if (charAvatarPlaceholder) charAvatarPlaceholder.style.display = 'flex';
      if (charClearAvatarBtn) charClearAvatarBtn.classList.add('is-idle');
    }
  }

  function setFaceIdDisplay(src) {
    if (src) {
      if (charFaceIdImg) {
        charFaceIdImg.src = src;
        charFaceIdImg.style.display = 'block';
      }
      if (charFaceIdPlaceholder) charFaceIdPlaceholder.style.display = 'none';
      if (charFaceIdStatus) {
        charFaceIdStatus.textContent = '已录入';
        charFaceIdStatus.classList.add('active');
      }
      if (charFaceIdClearBtn) charFaceIdClearBtn.classList.remove("is-idle");
    } else {
      if (charFaceIdImg) {
        charFaceIdImg.removeAttribute('src');
        charFaceIdImg.style.display = 'none';
      }
      if (charFaceIdPlaceholder) charFaceIdPlaceholder.style.display = 'flex';
      if (charFaceIdStatus) {
        charFaceIdStatus.textContent = '未录入面容';
        charFaceIdStatus.classList.remove('active');
      }
      if (charFaceIdClearBtn) charFaceIdClearBtn.classList.add("is-idle");
    }
  }

  /* ================= 保存与删除 ================= */

  async function handleSaveChar() {
    const isNew = !editingCharId;
    const campVal = editingCharCamp === 'instance' ? 'instance' : 'operative';
    const isInstance = campVal === 'instance';

    // 副本阵营不属于溯流编制，无编号，故跳过去重校验直接落空值
    let serialVal = '';

    if (!isInstance) {
      // 编号去重校验：与执行员本体、其他角色、系统保留编号统一比对
      const serialRaw = (charSerialInput?.value || '').trim();
      serialVal = normalizeSerial(serialRaw) || generateUniqueSerial();
      const taken = collectTakenSerials(editingCharId);

      if (taken.has(serialVal)) {
        const owner = findSerialOwner(serialVal, editingCharId);
        const detailText = owner
          ? `编号 NO.${serialVal} 已被「${owner}」占用，请更换一个未被使用的六位编号。`
          : `编号 NO.${serialVal} 已被占用，请更换一个未被使用的六位编号。`;

        await RetroModal.alert({
          message: '编号存在重复，请修改',
          detail: detailText,
          confirmText: '返回修改',
          danger: true
        });

        // 校验未通过：不写入任何数据，保留用户输入并聚焦编号输入框
        if (charSerialInput) {
          charSerialInput.focus();
          charSerialInput.select();
        }
        return false;
      }

      // 回写规范化后的编号，杜绝 '517' 这类非标准格式落库
      if (charSerialInput) charSerialInput.value = serialVal;
    }

    const nameVal = (charNameInput?.value || '').trim() || '未命名角色';
    const genderVal = (charGenderInput?.value || '').trim();
    const birthdayVal = (charBirthdayInput?.value || '').trim();
    const voiceIdVal = (charVoiceIdInput?.value || '').trim();
    const appearanceVal = (charAppearanceInput?.value || '').trim();
    const profileVal = (charProfileInput?.value || '').trim();
    const selfBriefVal = (charSelfBriefInput?.value || '').trim();

    const charId = editingCharId || `char_${Date.now()}`;

    const charObj = {
      id: charId,
      camp: campVal,
      rank: editingCharRank || (isInstance ? 'awakened' : 'novice'),
      serial: serialVal,
      name: nameVal,
      gender: genderVal,
      birthday: birthdayVal,
      voiceId: voiceIdVal,
      appearance: appearanceVal,
      profile: profileVal,
      selfBrief: selfBriefVal,
      updatedAt: Date.now()
    };

    if (isNew) {
      charObj.createdAt = Date.now();
      characters.push(charObj);
      // 关键：认领刚建的 id。否则 editingCharId 停在 null，
      // 下一次保存（退出触发 / 再点保存）仍判为新建 → 要么重复 INSERT 造出多条，
      // 要么去重时把刚存的自己当成占用方，误报「编号重复」。
      editingCharId = charId;
    } else {
      const idx = characters.findIndex((c) => c.id === charId);
      if (idx >= 0) {
        charObj.createdAt = characters[idx].createdAt || Date.now();
        characters[idx] = charObj;
      } else {
        characters.push(charObj);
      }
    }

    saveCharacters();

    // 固化立绘资产到 IndexedDB
    if (isAvatarDirty) {
      try {
        if (pendingAvatarAsset) {
          await Storage.setAsset(ASSET_PREFIX_CHAR_AVATAR + charId, pendingAvatarAsset);
        } else {
          await Storage.removeAsset(ASSET_PREFIX_CHAR_AVATAR + charId);
        }
      } catch (e) {
        console.error('[Resonance] 固化立绘失败:', e);
      }
    }

    // 固化 FACE ID 资产到 IndexedDB
    if (isFaceIdDirty) {
      try {
        if (pendingFaceIdAsset) {
          await Storage.setAsset(ASSET_PREFIX_CHAR_FACE_ID + charId, pendingFaceIdAsset);
        } else {
          await Storage.removeAsset(ASSET_PREFIX_CHAR_FACE_ID + charId);
        }
      } catch (e) {
        console.error('[Resonance] 固化 FACE ID 失败:', e);
      }
    }

    // 不在此处跳转：调用方（顶栏返回 / 烤串保存）自行决定是否退回列表
    return true;
  }

  async function handleDeleteChar() {
    if (!editingCharId) return;
    const char = characters.find((c) => c.id === editingCharId);
    const charName = char ? char.name || '该角色' : '该角色';

    const confirmed = await RetroModal.confirm({
      message: `确定要彻底移除「${charName}」的角色档案吗？`,
      detail: '此操作将同时物理销毁该角色的专属头像与面部识别数据，清除其全部人际关系，并一并删除线上联络中与其相关的通讯录、聊天记录与朋友圈互动，无法恢复。',
      confirmText: '确认销毁',
      cancelText: '取消',
      danger: true
    });

    if (!confirmed) return;

    // 级联物理清除 IndexedDB 资产
    try {
      await Storage.removeAsset(ASSET_PREFIX_CHAR_AVATAR + editingCharId);
      await Storage.removeAsset(ASSET_PREFIX_CHAR_FACE_ID + editingCharId);
    } catch (e) {
      console.warn('[Resonance] 清理角色图片缓存失败:', e);
    }

    // 级联清除线上联络数据（通讯录 / 会话 / 消息流水 / 朋友圈）。
    // 必须在角色本体删除前调用：OnlineStore 需要靠 rosterId 反查联系人。
    try {
      if (window.OnlineStore && typeof OnlineStore.purgeByRosterId === 'function') {
        const stat = await OnlineStore.purgeByRosterId(editingCharId);
        if (stat && stat.contacts > 0) {
          console.log(`[Resonance] 已级联清除线上数据：联系人 ${stat.contacts} / 消息 ${stat.records}`);
        }
      }
    } catch (e) {
      console.warn('[Resonance] 清理线上联络数据失败:', e);
    }

    characters = characters.filter((c) => c.id !== editingCharId);
    saveCharacters();

    // 级联清除该角色的全部人际关系，避免留下指向空 id 的孤儿记录
    const purged = purgeRelationsOf(editingCharId);
    if (purged > 0) {
      console.log(`[Resonance] 已级联清除 ${purged} 条关联人际关系`);
    }

    showCharListView();
  }

  /* ================= 顶栏烤串菜单与详情态退出 ================= */

  /** 收起顶栏冒泡菜单 */
  function closeResonanceMenu() {
    if (!resonanceMenuPopover) return;
    resonanceMenuPopover.hidden = true;
    resonanceMenuPopover.setAttribute('aria-hidden', 'true');
    if (resonanceMoreBtn) {
      resonanceMoreBtn.classList.remove('is-active');
      resonanceMoreBtn.setAttribute('aria-expanded', 'false');
    }
  }

  /** 展开顶栏冒泡菜单 */
  function openResonanceMenu() {
    if (!resonanceMenuPopover) return;
    resonanceMenuPopover.hidden = false;
    resonanceMenuPopover.setAttribute('aria-hidden', 'false');
    if (resonanceMoreBtn) {
      resonanceMoreBtn.classList.add('is-active');
      resonanceMoreBtn.setAttribute('aria-expanded', 'true');
    }
  }

  /** 菜单反馈 Toast 统一出口 */
  function toastResonance(tag, message, detail, type) {
    if (!window.RetroToast) return;
    window.RetroToast.show({ tag, message, detail: detail || '', type: type || 'info' });
  }

  /**
   * 当前详情态是否为「尚未落库的空白新建」。
   *
   * 退出即保存的护栏：点进「录入角色」却什么都没填就退出时，
   * 不该凭空生出一条无名档案。只看名字，头像/长文本不参与判定
   * ——只传了图却没名字的条目留着也无意义。
   */
  function isBlankDraft() {
    if (!activeEditor) return false;
    const isNew = activeEditor === 'char' ? !editingCharId
      : activeEditor === 'npc' ? !editingNpcId
        : !editingAsstId;
    if (!isNew) return false;
    const meta = EDITOR_META[activeEditor];
    return !meta || !meta.nameOf();
  }

  /** 按当前维度分发到对应的保存函数，统一返回是否成功 */
  async function saveActiveEditor() {
    if (!activeEditor) return false;
    if (activeEditor === 'char') return await handleSaveChar() !== false;
    if (activeEditor === 'npc') return await handleSaveNpc() !== false;
    if (activeEditor === 'asst') return await saveAsstEditor() !== false;
    return false;
  }

  /** 按当前维度退回对应的列表视图 */
  function backToActiveList() {
    if (activeEditor === 'char') showCharListView();
    else if (activeEditor === 'npc') showNpcListView();
    else if (activeEditor === 'asst') showAsstListView();

    // 一次性回跳钩子：外部流程（如开场向导）把用户送进新建态时登记，
    // 编辑器归档收页后在此交还控制权。只触发一次，触发前先摘钩，
    // 避免回调内再次进出编辑器造成递归。
    if (pendingEditorExitHook) {
      const hook = pendingEditorExitHook;
      pendingEditorExitHook = null;
      try {
        hook();
      } catch (err) {
        console.warn('[Resonance] 编辑器回跳钩子异常：', err);
      }
    }
  }

  /**
   * 登记一次性的编辑器退出回调，供开场向导等外部流程接管归档后的去向。
   * @param {Function|null} fn 回调；传 null 撤销登记
   */
  function setEditorExitHook(fn) {
    pendingEditorExitHook = (typeof fn === 'function') ? fn : null;
  }

  /** 按当前维度分发销毁 */
  async function destroyActiveEditor() {
    if (activeEditor === 'char') return await handleDeleteChar();
    if (activeEditor === 'npc') return await handleDeleteNpc();
    if (activeEditor === 'asst') return await deleteAsstEditor();
  }

  // 退出归档进行中：拦住重复点返回导致的并发写库
  let isLeavingEditor = false;

  /**
   * 详情态退出：退出即归档。
   *
   * 与副本编纂器同一口径——必须等写库结果再收页。三个保存函数都可能
   * 校验失败（角色编号重复、助手名称为空），失败时留在详情页让人有机会
   * 改正，否则用户只看到弹窗一闪而过，编辑内容已经丢了。
   */
  async function leaveEditorWithSave() {
    if (!activeEditor) return;
    if (isLeavingEditor) return;
    isLeavingEditor = true;
    if (resonanceCloseBtn) resonanceCloseBtn.disabled = true;

    try {
      // 空白新建：直接丢弃，不落库也不报错
      if (isBlankDraft()) {
        backToActiveList();
        return;
      }

      const saved = await saveActiveEditor();
      if (!saved) {
        toastResonance('EDITOR // 退出中止', '归档未完成，已留在编辑页', '请按提示修正后重试，避免本次编辑内容丢失', 'error');
        return;
      }

      // 退出即归档是隐式动作，必须给回执。手动点烤串里的保存也弹，
      // 两条路径口径一致，与副本编纂器、马甲库对齐。
      // 助手维度的 saveAsstEditor 自己已经弹过，这里跳过免得连弹两个。
      if (activeEditor !== 'asst') {
        const meta = EDITOR_META[activeEditor] || { zh: '档案' };
        const name = meta.nameOf ? meta.nameOf() : '';
        toastResonance('SAVED // 档案归档', `${meta.zh}「${name || '未命名'}」已保存`, '', 'success');
      }
      backToActiveList();
    } finally {
      isLeavingEditor = false;
      if (resonanceCloseBtn) resonanceCloseBtn.disabled = false;
    }
  }

  if (resonanceMoreBtn) {
    resonanceMoreBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (resonanceMenuPopover && resonanceMenuPopover.hidden) openResonanceMenu();
      else closeResonanceMenu();
    });
  }

  if (resonanceMenuPopover) {
    resonanceMenuPopover.addEventListener('click', (e) => {
      const item = e.target.closest('.retro-kebab-item');
      if (!item) return;
      e.stopPropagation();
      const action = item.dataset.action;
      closeResonanceMenu();

      const meta = EDITOR_META[activeEditor] || { zh: '档案' };

      switch (action) {
        case 'save':
          Promise.resolve(saveActiveEditor()).then((okSaved) => {
            // 保存留在原地，不自动跳走：菜单点完页面自己跳会很突兀。
            // 助手维度的 saveAsstEditor 自带 Toast，跳过免得连弹两个。
            if (okSaved && activeEditor !== 'asst') {
              toastResonance('SAVED // 档案归档', `${meta.zh}档案已保存`, '', 'success');
            }
          }).catch((err) => {
            console.warn('[Resonance] 手动归档异常：', err);
          });
          break;
        case 'ai-assist':
          toastResonance('AI // 写作助手', '智能推演准备中', `AI 辅助生成${meta.zh}设定功能即将接入`, 'info');
          break;
        case 'export-json':
          toastResonance('IO // 导出JSON', '导出通道准备中', `${meta.zh}档案导出功能即将接入`, 'info');
          break;
        case 'import-override':
          toastResonance('IO // 导入覆盖', '导入通道准备中', `${meta.zh}档案导入功能即将接入`, 'info');
          break;
        case 'destroy':
          Promise.resolve(destroyActiveEditor()).catch((err) => {
            console.warn('[Resonance] 销毁档案异常：', err);
          });
          break;
        default:
          break;
      }
    });
  }

  // 轻触外部空白收起菜单
  document.addEventListener('click', (e) => {
    if (!resonanceMenuPopover || resonanceMenuPopover.hidden) return;
    if (resonanceMenuPopover.contains(e.target)) return;
    if (resonanceMoreBtn && resonanceMoreBtn.contains(e.target)) return;
    closeResonanceMenu();
  });

  /* ================= 导轨与主页面控制 ================= */

  async function switchDimension(dim) {
    // 切维度也算离开详情态，同样要归档，否则「退出即保存」在这条路径上失效。
    // 必须在切换可见性之前 await，校验失败时留在原维度不跳走。
    if (activeEditor && activeEditor !== (dim === 'assistant' ? 'asst' : dim)) {
      const leaving = activeEditor;
      await leaveEditorWithSave();
      // 归档没过（编号重复等），activeEditor 仍在原维度，取消这次切换
      if (activeEditor === leaving) return;
    }

    currentDimension = dim;
    railBookmarks.forEach((bm) => {
      bm.classList.toggle('active', bm.dataset.dimension === dim);
    });

    Object.entries(listPanes).forEach(([k, el]) => {
      if (!el) return;
      const isTarget = k === dim;
      el.classList.toggle('active', isTarget);
      if (isTarget && window.Motion && typeof Motion.replay === 'function') {
        Motion.replay(el);
      }
    });

    if (dim === 'char') {
      renderCharList();
    } else if (dim === 'npc') {
      renderNpcList();
    } else if (dim === 'assistant') {
      renderAsstList();
    } else if (dim === 'relation') {
      renderNexusMatrixList();
    }
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    purgeLegacySeedData();
    loadCharacters();
    loadNpcs();
    loadAssistants();
    loadRelations();
    // 三维度子视图一并复位到列表态，杜绝重进后停留在上次的详情页
    showCharListView();
    showNpcListView();
    showAsstListView();
    setRailVisible(true);
    switchDimension(currentDimension || 'char');

    if (resonancePage) {
      resonancePage.classList.add('active');
      resonancePage.setAttribute('aria-hidden', 'false');
    }
    document.body.classList.add('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.add('keyboard-hidden');

    try {
      history.pushState({ rfPage: 'resonance' }, '', '#resonance');
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * 关闭整页回桌面。
   * @returns {Promise<boolean>} 是否真的关掉了页面（归档失败时留在详情页）
   */
  async function close() {
    if (!isOpen) return false;

    // 物理返回键与路由也可能在详情态直接调 close()，
    // 这里补一次归档，避免绕过顶栏返回把编辑内容丢掉。
    if (activeEditor) {
      await leaveEditorWithSave();
      // 归档没过（编号重复等），留在详情页别把人送走
      if (activeEditor) return false;
    }

    isOpen = false;
    if (resonancePage) {
      resonancePage.classList.remove('active');
      resonancePage.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.remove('keyboard-hidden');

    const hash = window.location.hash || '';
    if (hash === '#resonance') {
      try {
        history.back();
      } catch (e) {
        window.location.hash = '';
      }
    }
  }

  /* ================= 事件监听与弹窗接入 ================= */

  // 1. 页面进入与关闭
  if (resonanceBentoCard) {
    resonanceBentoCard.addEventListener('click', (e) => {
      e.preventDefault();
      open();
    });
  }

  if (resonanceCloseBtn) {
    resonanceCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      // 层级语义：详情态只退一层回列表（并归档），列表态才关整页回桌面
      if (activeEditor) {
        Promise.resolve(leaveEditorWithSave()).catch((err) => {
          console.warn('[Resonance] 详情退出异常：', err);
        });
        return;
      }
      close();
    });
  }

  // 2. 导轨切换与顶部角标收起/展开
  railBookmarks.forEach((bm) => {
    bm.addEventListener('click', (e) => {
      e.preventDefault();
      const dim = bm.dataset.dimension;
      if (dim) switchDimension(dim);
    });
  });

  if (resonanceIndexRail) {
    const railToggleBtn = resonanceIndexRail.querySelector('.rail-notch-toggle-btn');
    if (railToggleBtn) {
      railToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = resonanceIndexRail.classList.toggle('is-collapsed');
        railToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        
        // 让同调档案主内容容器同步切换避让 padding
        if (resonanceRailLayout) {
          resonanceRailLayout.classList.toggle('rail-collapsed', isCollapsed);
        }
      });
    }
  }

  // 3. 阵营切换阀门点击
  if (campOptOperative) {
    campOptOperative.addEventListener('click', () => setCharCamp('operative', true));
  }

  if (campOptInstance) {
    campOptInstance.addEventListener('click', () => setCharCamp('instance', true));
  }

  // 4. 阶位手风琴小卡点击交互
  allRankCards.forEach((card) => {
    card.addEventListener('click', () => {
      const r = card.dataset.rank;
      if (r) setCharRank(r);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const r = card.dataset.rank;
        if (r) setCharRank(r);
      }
    });
  });

  // 5. 录入角色 & 返回列表
  if (charAddBtn) {
    charAddBtn.addEventListener('click', () => openCharEditor(null));
  }

  // 返回、保存、删除均由顶栏烤串统一分发，此处不再单独绑定

  // 5. 日期弹窗
  if (charBirthdayWrap) {
    charBirthdayWrap.addEventListener('click', async () => {
      if (!window.DatePickerModal || typeof DatePickerModal.pick !== 'function') return;
      const current = charBirthdayInput ? charBirthdayInput.value : '';
      const chosen = await DatePickerModal.pick(current);
      if (chosen !== null && charBirthdayInput) {
        charBirthdayInput.value = chosen;
      }
    });
  }

  // 6. 全屏文本编辑器
  async function openCharTextEditor(fieldKey) {
    if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
    if (fieldKey === 'appearance') {
      const current = charAppearanceInput ? charAppearanceInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '外貌特征编辑',
        tag: 'CHARACTER // 外貌设定',
        value: current,
        placeholder: '描述角色的外貌形象、发型、着装与特征...',
        maxLength: 3000
      });
      if (updated !== null && charAppearanceInput) {
        charAppearanceInput.value = updated;
      }
    } else if (fieldKey === 'profile') {
      const current = charProfileInput ? charProfileInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '核心设定编辑',
        tag: 'CHARACTER // 核心档案',
        value: current,
        placeholder: '描述该角色的性格、背景故事、动机与核心设定...',
        maxLength: 5000
      });
      if (updated !== null && charProfileInput) {
        charProfileInput.value = updated;
      }
    } else if (fieldKey === 'selfBrief') {
      const current = charSelfBriefInput ? charSelfBriefInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '自我简介编辑',
        tag: 'NEXUS // 自我简介',
        value: current,
        placeholder: '一段话概括角色设定，用以在该角色不在场却被提及时作为说明提供给系统。',
        maxLength: 2000
      });
      if (updated !== null && charSelfBriefInput) {
        charSelfBriefInput.value = updated;
      }
    }
  }

  if (charAppearanceExpandBtn) {
    charAppearanceExpandBtn.addEventListener('click', () => openCharTextEditor('appearance'));
  }
  if (charAppearanceInput) {
    charAppearanceInput.addEventListener('dblclick', () => openCharTextEditor('appearance'));
  }

  if (charProfileExpandBtn) {
    charProfileExpandBtn.addEventListener('click', () => openCharTextEditor('profile'));
  }
  if (charProfileInput) {
    charProfileInput.addEventListener('dblclick', () => openCharTextEditor('profile'));
  }

  const charSelfBriefExpandBtn = document.getElementById('charSelfBriefExpandBtn');
  if (charSelfBriefExpandBtn) {
    charSelfBriefExpandBtn.addEventListener('click', () => openCharTextEditor('selfBrief'));
  }
  if (charSelfBriefInput) {
    charSelfBriefInput.addEventListener('dblclick', () => openCharTextEditor('selfBrief'));
  }

  // 人际关系卡与登记弹窗事件
  bindNexusEvents();

  // 7. 立绘上传与生图工坊
  if (charAvatarFrame) {
    charAvatarFrame.addEventListener('click', () => {
      if (!window.ImagePicker) return;
      window.ImagePicker.open({
        title: '更换角色头像 (2:3)',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            // 本地文件：先用 objectURL 即时预览，压缩后的 Blob 待保存时固化
            pendingAvatarDisplay = URL.createObjectURL(res.file);
            pendingAvatarAsset = await Storage.compressImage(res.file, 1200, 0.88);
          } else if (res.type === 'url' && res.url) {
            pendingAvatarDisplay = res.url;
            pendingAvatarAsset = res.url;
          } else {
            return;
          }
          isAvatarDirty = true;
          setAvatarDisplay(pendingAvatarDisplay);
        }
      });
    });
  }

  if (charClearAvatarBtn) {
    charClearAvatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingAvatarAsset = null;
      pendingAvatarDisplay = null;
      isAvatarDirty = true;
      setAvatarDisplay(null);
    });
  }

  if (charForgeAvatarBtn) {
    charForgeAvatarBtn.addEventListener('click', async () => {
      if (!window.AvatarForge || typeof AvatarForge.open !== 'function') {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'FORGE // 模块状态',
            message: 'AI 绘像工坊尚未就绪',
            detail: '绘像模块尚未完全载入，请稍候再试。',
            type: 'warn'
          });
        }
        return;
      }
      const appearanceText = charAppearanceInput ? charAppearanceInput.value : '';
      let faceIdSrc = pendingFaceIdDisplay;
      if (!faceIdSrc && editingCharId) {
        faceIdSrc = await Storage.getAssetSrc(ASSET_PREFIX_CHAR_FACE_ID + editingCharId);
      }

      AvatarForge.open({
        prompt: '',
        source: 'character',
        appearance: appearanceText,
        faceIdSrc: faceIdSrc || null,
        onApply: (storableAsset, displaySrc) => {
          pendingAvatarAsset = storableAsset || displaySrc;
          pendingAvatarDisplay = displaySrc;
          isAvatarDirty = true;
          setAvatarDisplay(displaySrc);
        }
      });
    });
  }

  // 8. FACE ID 面部识别参考图上传与清除
  if (charFaceIdFrame) {
    charFaceIdFrame.addEventListener('click', () => {
      if (!window.ImagePicker) return;
      window.ImagePicker.open({
        title: '录入面部识别参考图 (1:1 垫图)',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            // 面容作为生图垫图，压到 768 长边足够且省空间
            pendingFaceIdDisplay = URL.createObjectURL(res.file);
            pendingFaceIdAsset = await Storage.compressImage(res.file, 768, 0.9);
          } else if (res.type === 'url' && res.url) {
            pendingFaceIdDisplay = res.url;
            pendingFaceIdAsset = res.url;
          } else {
            return;
          }
          isFaceIdDirty = true;
          setFaceIdDisplay(pendingFaceIdDisplay);
        }
      });
    });
  }

  if (charFaceIdClearBtn) {
    charFaceIdClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingFaceIdAsset = null;
      pendingFaceIdDisplay = null;
      isFaceIdDirty = true;
      setFaceIdDisplay(null);
    });
  }

  // 助手立绘与 Face ID 选择
  if (asstAvatarFrame) {
    asstAvatarFrame.addEventListener('click', () => {
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
      ImagePicker.open({
        title: '更换助手头像',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            setAsstAvatarDisplay(URL.createObjectURL(res.file));
            pendingAsstAvatarAsset = await Storage.compressImage(res.file, 1200, 0.88);
            isAsstAvatarDirty = true;
          } else if (res.type === 'url' && res.url) {
            setAsstAvatarDisplay(res.url);
            pendingAsstAvatarAsset = res.url;
            isAsstAvatarDirty = true;
          }
        }
      });
    });
  }

  if (asstAvatarGenerateBtn) {
    asstAvatarGenerateBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!window.AvatarForge || typeof AvatarForge.open !== 'function') {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'FORGE // 模块状态',
            message: 'AI 绘像工坊尚未就绪',
            detail: '绘像模块尚未完全载入，请稍候再试。',
            type: 'warn'
          });
        }
        return;
      }

      const appearanceText = asstAppearanceInput ? asstAppearanceInput.value : '';
      // 未改动过 Face ID 时回读已落盘的参考图，保证垫图不丢
      let faceIdSrc = pendingAsstFaceIdDisplay;
      if (!faceIdSrc && editingAsstId) {
        faceIdSrc = await Storage.getAssetSrc(ASSET_PREFIX_ASST_FACE_ID + editingAsstId);
      }

      AvatarForge.open({
        prompt: '',
        source: 'assistant',
        appearance: appearanceText,
        faceIdSrc: faceIdSrc || null,
        onApply: (storableAsset, displaySrc) => {
          pendingAsstAvatarAsset = storableAsset || displaySrc;
          isAsstAvatarDirty = true;
          setAsstAvatarDisplay(displaySrc);
        }
      });
    });
  }

  if (asstAvatarClearBtn) {
    asstAvatarClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingAsstAvatarAsset = null;
      pendingAsstAvatarDisplay = null;
      isAsstAvatarDirty = true;
      setAsstAvatarDisplay(null);
    });
  }

  if (asstFaceIdFrame) {
    asstFaceIdFrame.addEventListener('click', () => {
      if (!window.ImagePicker || typeof ImagePicker.open !== 'function') return;
      ImagePicker.open({
        title: '更换助手 Face ID 参考图',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            setAsstFaceIdDisplay(URL.createObjectURL(res.file));
            pendingAsstFaceIdAsset = await Storage.compressImage(res.file, 800, 0.9);
            isAsstFaceIdDirty = true;
          } else if (res.type === 'url' && res.url) {
            setAsstFaceIdDisplay(res.url);
            pendingAsstFaceIdAsset = res.url;
            isAsstFaceIdDirty = true;
          }
        }
      });
    });
  }

  if (asstFaceIdClearBtn) {
    asstFaceIdClearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingAsstFaceIdAsset = null;
      pendingAsstFaceIdDisplay = null;
      isAsstFaceIdDirty = true;
      setAsstFaceIdDisplay(null);
    });
  }

  // 助手列表按钮绑定（返回/保存/删除走顶栏烤串）
  if (asstAddBtn) asstAddBtn.addEventListener('click', () => openAsstEditor(null));

  if (asstAppearanceExpandBtn && asstAppearanceInput) {
    asstAppearanceExpandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const updated = await TextEditorModal.edit({
        title: '拟态外貌特征',
        tag: 'APPEARANCE // 提示词装配',
        value: asstAppearanceInput.value
      });
      // 确认返回文本、取消 / 返回手势返回 null —— null 不回写，保留原值
      if (updated !== null && updated !== undefined) asstAppearanceInput.value = updated;
    });
  }

  if (asstProfileExpandBtn && asstProfileInput) {
    asstProfileExpandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const updated = await TextEditorModal.edit({
        title: '系统核心指令与人设',
        tag: 'SYSTEM INSTRUCTIONS // 推演核心',
        value: asstProfileInput.value
      });
      if (updated !== null && updated !== undefined) asstProfileInput.value = updated;
    });
  }

  /* ================= NPC 视图与交互控制器 ================= */

  // DOM 引用：NPC 子视图
  const npcListView = document.getElementById('resonanceNpcListView');
  const npcEditView = document.getElementById('resonanceNpcEditView');
  const npcCardList = document.getElementById('resonanceNpcList');
  const npcEmptyView = document.getElementById('resonanceNpcEmpty');
  const npcCountBadge = document.getElementById('resonanceNpcCount');
  const npcAddBtn = document.getElementById('resonanceNpcAddBtn');

  // NPC 详情编辑控件（返回/保存/删除已收进顶栏烤串）

  // 卡片 00
  const npcCampPivotCard = document.getElementById('npcCampPivotCard');
  const npcCampStatusTag = document.getElementById('npcCampStatusTag');
  const npcCampValveTrack = document.getElementById('npcCampValveTrack');
  const npcCampOptOperative = document.getElementById('npcCampOptOperative');
  const npcCampOptInstance = document.getElementById('npcCampOptInstance');
  const npcCampDescCode = document.getElementById('npcCampDescCode');
  const npcCampDescContent = document.getElementById('npcCampDescContent');
  const npcRankDeckOperative = document.getElementById('npcRankDeckOperative');
  const npcRankDeckInstance = document.getElementById('npcRankDeckInstance');
  const allNpcRankCards = npcCampPivotCard ? npcCampPivotCard.querySelectorAll('.rank-dossier-card') : [];

  // 卡片 01
  const npcAvatarFrame = document.getElementById('npcAvatarFrame');
  const npcAvatarImg = document.getElementById('npcAvatarImg');
  const npcAvatarPlaceholder = document.getElementById('npcAvatarPlaceholder');
  const npcForgeAvatarBtn = document.getElementById('npcForgeAvatarBtn');
  const npcClearAvatarBtn = document.getElementById('npcClearAvatarBtn');
  const npcSerialInput = document.getElementById('npcSerialInput');
  const npcSerialFieldGroup = document.getElementById('npcSerialFieldGroup');
  const npcNameInput = document.getElementById('npcNameInput');
  const npcGenderInput = document.getElementById('npcGenderInput');
  const npcBirthdayInput = document.getElementById('npcBirthdayInput');
  const npcBirthdayWrap = document.getElementById('npcBirthdayWrap');

  // 卡片 02
  const npcAppearanceInput = document.getElementById('npcAppearanceInput');
  const npcAppearanceExpandBtn = document.getElementById('npcAppearanceExpandBtn');
  const npcProfileInput = document.getElementById('npcProfileInput');
  const npcProfileExpandBtn = document.getElementById('npcProfileExpandBtn');

  // 卡片 03
  const npcSelfBriefInput = document.getElementById('npcSelfBriefInput');
  const npcSelfBriefExpandBtn = document.getElementById('npcSelfBriefExpandBtn');
  const npcNexusSection = document.getElementById('npcNexusSection');
  const npcNexusAddBtn = document.getElementById('npcNexusAddBtn');
  const npcNexusList = document.getElementById('npcNexusList');
  const npcNexusEmpty = document.getElementById('npcNexusEmpty');
  const npcNexusLockedTip = document.getElementById('npcNexusLockedTip');

  function setNpcCamp(camp, isUserClick = false) {
    editingNpcCamp = camp === 'instance' ? 'instance' : 'operative';
    const isInstance = editingNpcCamp === 'instance';

    if (npcCampPivotCard) {
      npcCampPivotCard.classList.toggle('camp-instance-active', isInstance);
    }
    if (npcCampStatusTag) {
      npcCampStatusTag.textContent = isInstance ? 'FORK // 副本原生' : 'OPERATIVE // 执行员';
    }
    if (npcCampValveTrack) {
      npcCampValveTrack.classList.toggle('is-instance', isInstance);
    }
    if (npcCampOptOperative) {
      npcCampOptOperative.classList.toggle('active', !isInstance);
      npcCampOptOperative.setAttribute('aria-checked', !isInstance ? 'true' : 'false');
    }
    if (npcCampOptInstance) {
      npcCampOptInstance.classList.toggle('active', isInstance);
      npcCampOptInstance.setAttribute('aria-checked', isInstance ? 'true' : 'false');
    }

    if (npcCampDescCode) {
      npcCampDescCode.textContent = isInstance
        ? 'FORK_INSTANCE // 副本原生存在'
        : 'SYS_OPERATIVE // 溯流员工编制';
    }
    if (npcCampDescContent) {
      npcCampDescContent.textContent = isInstance
        ? '原生于特定副本世界，可能随世界因果轮回而发生变动。'
        : '溯流计划员工，进入不同副本执行任务。';
    }

    if (npcRankDeckOperative) npcRankDeckOperative.hidden = isInstance;
    if (npcRankDeckInstance) npcRankDeckInstance.hidden = !isInstance;

    if (isUserClick) {
      setNpcRank(isInstance ? 'awakened' : 'novice');
    }

    applyNpcSerialLock(editingNpcCamp);
  }

  function setNpcRank(rank) {
    editingNpcRank = rank;
    allNpcRankCards.forEach((card) => {
      const isTarget = card.dataset.rank === rank;
      card.classList.toggle('active', isTarget);
      card.setAttribute('aria-checked', isTarget ? 'true' : 'false');
    });
  }

  function applyNpcSerialLock(camp) {
    const isInstance = camp === 'instance';
    if (!npcSerialInput) return;

    if (isInstance) {
      const cur = npcSerialInput.value.trim();
      if (cur) stashedNpcOperativeSerial = cur;
      npcSerialInput.value = '';
      npcSerialInput.disabled = true;
      npcSerialInput.placeholder = '无编号（副本原生）';
    } else {
      npcSerialInput.disabled = false;
      npcSerialInput.placeholder = '000001';
      if (!(npcSerialInput.value || '').trim()) {
        const stashed = normalizeSerial(stashedNpcOperativeSerial);
        const taken = collectTakenSerials(editingNpcId);
        npcSerialInput.value = (stashed && !taken.has(stashed))
          ? stashed
          : generateUniqueSerial();
      }
    }

    if (npcSerialFieldGroup) {
      npcSerialFieldGroup.classList.toggle('is-serial-disabled', isInstance);
    }
  }

  function setNpcAvatarDisplay(src) {
    if (src) {
      if (npcAvatarImg) {
        npcAvatarImg.src = src;
        npcAvatarImg.style.display = 'block';
      }
      if (npcAvatarPlaceholder) npcAvatarPlaceholder.style.display = 'none';
      if (npcClearAvatarBtn) npcClearAvatarBtn.classList.remove('is-idle');
    } else {
      if (npcAvatarImg) {
        npcAvatarImg.removeAttribute('src');
        npcAvatarImg.style.display = 'none';
      }
      if (npcAvatarPlaceholder) npcAvatarPlaceholder.style.display = 'flex';
      if (npcClearAvatarBtn) npcClearAvatarBtn.classList.add('is-idle');
    }
  }

  async function renderNpcNexusList() {
    if (!npcNexusList) return;
    const isNew = !editingNpcId;
    if (npcNexusSection) npcNexusSection.classList.toggle('is-locked', isNew);
    if (npcNexusLockedTip) npcNexusLockedTip.hidden = !isNew;

    npcNexusList.innerHTML = '';
    if (isNew) {
      if (npcNexusEmpty) npcNexusEmpty.hidden = true;
      return;
    }

    const mine = getRelationsOf(editingNpcId);
    if (mine.length === 0) {
      if (npcNexusEmpty) npcNexusEmpty.hidden = false;
      return;
    }
    if (npcNexusEmpty) npcNexusEmpty.hidden = true;

    for (const rel of mine) {
      const row = document.createElement('div');
      row.className = 'nexus-relation-row';
      row.dataset.relId = rel.id;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      let avatarSrc = null;
      try {
        avatarSrc = await resolveAvatarSrc(rel.otherId);
      } catch (e) {
        /* ignore */
      }

      const otherName = resolveCharName(rel.otherId);
      row.innerHTML = `
        <div class="nexus-row-avatar">
          ${avatarSrc ? `<img src="${avatarSrc}" alt="">` : NEXUS_PLACEHOLDER_SVG}
        </div>
        <div class="nexus-row-text">
          <div class="nexus-row-head">
            <span class="nexus-row-name">${escapeHtml(otherName)}</span>
            <span class="nexus-row-relation">${escapeHtml(rel.relation || '未定')}</span>
          </div>
          <div class="nexus-row-desc">${escapeHtml(rel.desc || '')}</div>
        </div>
        <button type="button" class="nexus-row-remove-btn" aria-label="移除这条关系">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.nexus-row-remove-btn')) return;
        openNexusModalForNpc(rel.id);
      });

      const rmBtn = row.querySelector('.nexus-row-remove-btn');
      if (rmBtn) {
        rmBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const ok = await RetroModal.confirm({
            message: `移除与「${otherName}」的关系记录？`,
            detail: '这条关系在双方档案中都会消失，档案本身不受影响。',
            confirmText: '确认移除',
            cancelText: '取消',
            danger: true
          });
          if (!ok) return;
          removeRelation(rel.id);
          renderNpcNexusList();
        });
      }

      npcNexusList.appendChild(row);
    }
  }

  function openNexusModalForNpc(relId = null) {
    if (!editingNpcId) return;
    editingCharId = editingNpcId; // 借用 nexus 会话变量
    openNexusModal(relId);
  }

  /* ---------------- 渲染 NPC 画廊横卡列表 ---------------- */

  // 并发渲染守卫：open() 与 switchDimension() 可能同时触发渲染，
  // 异步 await 期间两轮渲染会交错追加导致卡片重复，用递增令牌让旧轮次自行作废。
  let npcListRenderToken = 0;

  async function renderNpcList() {
    if (!npcCardList) return;
    const token = ++npcListRenderToken;

    loadNpcs();
    loadRelations();

    if (npcCountBadge) npcCountBadge.textContent = String(npcs.length);

    if (npcs.length === 0) {
      npcCardList.innerHTML = '';
      if (npcEmptyView) npcEmptyView.hidden = false;
      return;
    }
    if (npcEmptyView) npcEmptyView.hidden = true;

    // 先在离屏碎片里构建完整列表，最后一次性替换，避免中途出现半成品或重复
    const frag = document.createDocumentFragment();

    for (const npc of npcs) {
      const card = document.createElement('div');
      card.className = 'resonance-npc-card';
      card.dataset.npcId = npc.id;
      card.dataset.camp = npc.camp || 'operative';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      let avatarSrc = null;
      try {
        avatarSrc = await Storage.getAssetSrc(ASSET_PREFIX_NPC_AVATAR + npc.id);
      } catch (e) {
        /* ignore */
      }

      // 本轮渲染已被更新的一轮取代，直接放弃，避免重复追加
      if (token !== npcListRenderToken) return;

      const serialDisplay = npc.camp === 'instance'
        ? 'FORK // 副本原生'
        : `NO.${npc.serial || '000000'}`;

      const campLabel = npc.camp === 'instance' ? 'INSTANCE' : 'OPERATIVE';
      const campClass = npc.camp === 'instance' ? 'instance' : 'operative';

      // 关系摘要
      const npcRels = getRelationsOf(npc.id);
      let relSummaryHtml = '<span class="resonance-npc-rel-empty">暂无羁绊链路</span>';
      if (npcRels.length > 0) {
        const topRels = npcRels.slice(0, 3);
        relSummaryHtml = topRels.map((r) => {
          const otherName = resolveCharName(r.otherId);
          return `
            <span class="resonance-npc-rel-badge">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>
              ${escapeHtml(r.relation || '羁绊')} (${escapeHtml(otherName)})
            </span>
          `;
        }).join('');
        if (npcRels.length > 3) {
          relSummaryHtml += `<span class="resonance-npc-rel-empty">+${npcRels.length - 3}</span>`;
        }
      }

      const summaryText = npc.profile || npc.appearance || '尚未填写核心设定与外貌描述。';

      card.innerHTML = `
        <div class="resonance-npc-camp-badge ${campClass}">${campLabel}</div>
        <div class="resonance-npc-avatar-box">
          ${avatarSrc
            ? `<img src="${avatarSrc}" class="resonance-npc-avatar-img" alt="">`
            : `<div class="resonance-npc-avatar-ph">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                <span>NO AVATAR</span>
              </div>`
          }
        </div>
        <div class="resonance-npc-info-col">
          <div class="resonance-npc-row-serial">${escapeHtml(serialDisplay)}</div>
          <div class="resonance-npc-row-name-gender">
            <span class="resonance-npc-name">${escapeHtml(npc.name || '未命名NPC')}</span>
            ${npc.gender ? `<span class="resonance-npc-gender">${escapeHtml(npc.gender)}</span>` : ''}
          </div>
          <div class="resonance-npc-row-summary">${escapeHtml(summaryText)}</div>
          <div class="resonance-npc-row-relations">${relSummaryHtml}</div>
        </div>
      `;

      card.addEventListener('click', () => openNpcEditor(npc.id));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openNpcEditor(npc.id);
        }
      });

      frag.appendChild(card);
    }

    // 本轮为最新渲染：整体替换列表内容，杜绝并发交错造成的重复卡片
    if (token !== npcListRenderToken) return;
    npcCardList.innerHTML = '';
    npcCardList.appendChild(frag);
  }

  function showNpcListView() {
    setActiveEditor(null);
    editingNpcId = null;
    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(npcListView, [npcEditView]);
    } else {
      if (npcEditView) npcEditView.hidden = true;
      if (npcListView) npcListView.hidden = false;
    }
    setRailVisible(true);
    renderNpcList();
  }

  async function openNpcEditor(npcId = null) {
    editingNpcId = npcId;
    setActiveEditor('npc');
    isNpcAvatarDirty = false;
    pendingNpcAvatarAsset = null;
    pendingNpcAvatarDisplay = null;
    stashedNpcOperativeSerial = '';

    if (window.Motion && typeof Motion.swap === 'function') {
      Motion.swap(npcEditView, [npcListView]);
    } else {
      if (npcListView) npcListView.hidden = true;
      if (npcEditView) npcEditView.hidden = false;
    }

    setRailVisible(false);

    const scroller = resonancePage ? resonancePage.querySelector('.settings-body-scroll') : null;
    if (scroller) scroller.scrollTop = 0;

    if (npcId) {
      const npc = npcs.find((n) => n && n.id === npcId);
      if (!npc) {
        showNpcListView();
        return;
      }
      if (npcEditDeleteBtn) npcEditDeleteBtn.hidden = false;

      setNpcCamp(npc.camp || 'operative', false);
      setNpcRank(npc.rank || (npc.camp === 'instance' ? 'awakened' : 'novice'));

      if (npcSerialInput) npcSerialInput.value = npc.serial || '';
      if (npcNameInput) npcNameInput.value = npc.name || '';
      if (npcGenderInput) npcGenderInput.value = npc.gender || '';
      if (npcBirthdayInput) npcBirthdayInput.value = npc.birthday || '';
      if (npcAppearanceInput) npcAppearanceInput.value = npc.appearance || '';
      if (npcProfileInput) npcProfileInput.value = npc.profile || '';
      if (npcSelfBriefInput) npcSelfBriefInput.value = npc.selfBrief || '';

      applyNpcSerialLock(npc.camp === 'instance' ? 'instance' : 'operative');

      let avatar = null;
      try {
        avatar = await Storage.getAssetSrc(ASSET_PREFIX_NPC_AVATAR + npcId);
      } catch (e) {
        /* ignore */
      }
      setNpcAvatarDisplay(avatar);
    } else {
      setNpcCamp('operative', false);
      setNpcRank('novice');

      if (npcEditDeleteBtn) npcEditDeleteBtn.hidden = true;

      if (npcNameInput) npcNameInput.value = '';
      if (npcGenderInput) npcGenderInput.value = '';
      if (npcBirthdayInput) npcBirthdayInput.value = '';
      if (npcAppearanceInput) npcAppearanceInput.value = '';
      if (npcProfileInput) npcProfileInput.value = '';
      if (npcSelfBriefInput) npcSelfBriefInput.value = '';

      // 先清空上一位 NPC 残留的编号，再摇一枚全局未占用的新号
      if (npcSerialInput) {
        npcSerialInput.value = '';
        npcSerialInput.value = generateUniqueSerial();
      }

      setNpcAvatarDisplay(null);
    }

    renderNpcNexusList();
  }

  async function handleSaveNpc() {
    const isNew = !editingNpcId;
    const campVal = editingNpcCamp === 'instance' ? 'instance' : 'operative';
    const isInstance = campVal === 'instance';

    let serialVal = '';
    if (!isInstance) {
      const serialRaw = (npcSerialInput?.value || '').trim();
      serialVal = normalizeSerial(serialRaw) || generateUniqueSerial();
      const taken = collectTakenSerials(editingNpcId);

      if (taken.has(serialVal)) {
        const owner = findSerialOwner(serialVal, editingNpcId);
        const detailText = owner
          ? `编号 NO.${serialVal} 已被「${owner}」占用，请更换一个未被使用的六位编号。`
          : `编号 NO.${serialVal} 已被占用，请更换一个未被使用的六位编号。`;

        await RetroModal.alert({
          message: '编号存在重复，请修改',
          detail: detailText,
          confirmText: '返回修改',
          danger: true
        });

        if (npcSerialInput) {
          npcSerialInput.focus();
          npcSerialInput.select();
        }
        return;
      }

      if (npcSerialInput) npcSerialInput.value = serialVal;
    }

    const nameVal = (npcNameInput?.value || '').trim() || '未命名NPC';
    const genderVal = (npcGenderInput?.value || '').trim();
    const birthdayVal = (npcBirthdayInput?.value || '').trim();
    const appearanceVal = (npcAppearanceInput?.value || '').trim();
    const profileVal = (npcProfileInput?.value || '').trim();
    const selfBriefVal = (npcSelfBriefInput?.value || '').trim();

    const npcId = editingNpcId || `npc_${Date.now()}`;

    const npcObj = {
      id: npcId,
      camp: campVal,
      rank: editingNpcRank || (isInstance ? 'awakened' : 'novice'),
      serial: serialVal,
      name: nameVal,
      gender: genderVal,
      birthday: birthdayVal,
      appearance: appearanceVal,
      profile: profileVal,
      selfBrief: selfBriefVal,
      updatedAt: Date.now()
    };

    if (isNew) {
      npcObj.createdAt = Date.now();
      npcs.push(npcObj);
      // 认领刚建的 id，否则下一次保存仍判为新建，造成重复 INSERT。
      editingNpcId = npcId;
    } else {
      const idx = npcs.findIndex((n) => n.id === npcId);
      if (idx >= 0) {
        npcObj.createdAt = npcs[idx].createdAt || Date.now();
        npcs[idx] = npcObj;
      } else {
        npcs.push(npcObj);
      }
    }

    saveNpcs();

    if (isNpcAvatarDirty) {
      try {
        if (pendingNpcAvatarAsset) {
          await Storage.setAsset(ASSET_PREFIX_NPC_AVATAR + npcId, pendingNpcAvatarAsset);
        } else {
          await Storage.removeAsset(ASSET_PREFIX_NPC_AVATAR + npcId);
        }
      } catch (e) {
        console.error('[Resonance] 固化NPC头像失败:', e);
      }
    }

    // 不在此处跳转：调用方自行决定是否退回列表
    return true;
  }

  async function handleDeleteNpc() {
    if (!editingNpcId) return;
    const npc = npcs.find((n) => n.id === editingNpcId);
    const npcName = npc ? npc.name || '该NPC' : '该NPC';

    const confirmed = await RetroModal.confirm({
      message: `确定要彻底移除「${npcName}」的NPC档案吗？`,
      detail: '此操作将同时物理销毁该NPC的专属头像，清除其全部人际关系，并一并删除线上联络中与其相关的通讯录、聊天记录与朋友圈互动，无法恢复。',
      confirmText: '确认销毁',
      cancelText: '取消',
      danger: true
    });

    if (!confirmed) return;

    try {
      await Storage.removeAsset(ASSET_PREFIX_NPC_AVATAR + editingNpcId);
    } catch (e) {
      console.warn('[Resonance] 清理NPC图片缓存失败:', e);
    }

    // 级联清除线上联络数据，必须早于 NPC 本体删除
    try {
      if (window.OnlineStore && typeof OnlineStore.purgeByRosterId === 'function') {
        const stat = await OnlineStore.purgeByRosterId(editingNpcId);
        if (stat && stat.contacts > 0) {
          console.log(`[Resonance] 已级联清除线上数据：联系人 ${stat.contacts} / 消息 ${stat.records}`);
        }
      }
    } catch (e) {
      console.warn('[Resonance] 清理线上联络数据失败:', e);
    }

    npcs = npcs.filter((n) => n.id !== editingNpcId);
    saveNpcs();

    const purged = purgeRelationsOf(editingNpcId);
    if (purged > 0) {
      console.log(`[Resonance] 已级联清除 ${purged} 条NPC关联人际关系`);
    }

    showNpcListView();
  }

  // 绑定 NPC 专属事件
  if (npcCampOptOperative) {
    npcCampOptOperative.addEventListener('click', () => setNpcCamp('operative', true));
  }
  if (npcCampOptInstance) {
    npcCampOptInstance.addEventListener('click', () => setNpcCamp('instance', true));
  }

  allNpcRankCards.forEach((card) => {
    card.addEventListener('click', () => {
      const r = card.dataset.rank;
      if (r) setNpcRank(r);
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const r = card.dataset.rank;
        if (r) setNpcRank(r);
      }
    });
  });

  if (npcAddBtn) {
    npcAddBtn.addEventListener('click', () => openNpcEditor(null));
  }
  // 返回、保存、删除均由顶栏烤串统一分发，此处不再单独绑定

  if (npcBirthdayWrap) {
    npcBirthdayWrap.addEventListener('click', async () => {
      if (!window.DatePickerModal || typeof DatePickerModal.pick !== 'function') return;
      const current = npcBirthdayInput ? npcBirthdayInput.value : '';
      const chosen = await DatePickerModal.pick(current);
      if (chosen !== null && npcBirthdayInput) {
        npcBirthdayInput.value = chosen;
      }
    });
  }

  if (npcAppearanceExpandBtn) {
    npcAppearanceExpandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const current = npcAppearanceInput ? npcAppearanceInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '外貌特征编辑',
        tag: 'NPC // 外貌设定',
        value: current,
        placeholder: '描述NPC的外貌形象、发型、着装与特征...',
        maxLength: 3000
      });
      if (updated !== null && npcAppearanceInput) {
        npcAppearanceInput.value = updated;
      }
    });
  }

  if (npcProfileExpandBtn) {
    npcProfileExpandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const current = npcProfileInput ? npcProfileInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '核心设定编辑',
        tag: 'NPC // 核心设定',
        value: current,
        placeholder: '描述该NPC的性格、背景故事、动机与核心设定...',
        maxLength: 5000
      });
      if (updated !== null && npcProfileInput) {
        npcProfileInput.value = updated;
      }
    });
  }

  if (npcSelfBriefExpandBtn) {
    npcSelfBriefExpandBtn.addEventListener('click', async () => {
      if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
      const current = npcSelfBriefInput ? npcSelfBriefInput.value : '';
      const updated = await TextEditorModal.edit({
        title: '自我简介编辑',
        tag: 'NPC // 自我简介',
        value: current,
        placeholder: '一段话概括NPC设定，用以在该角色不在场却被提及时作为说明提供给系统。',
        maxLength: 1000
      });
      if (updated !== null && npcSelfBriefInput) {
        npcSelfBriefInput.value = updated;
      }
    });
  }

  if (npcAvatarFrame) {
    npcAvatarFrame.addEventListener('click', () => {
      if (!window.ImagePicker) return;
      window.ImagePicker.open({
        title: '选择NPC立绘 (2:3 纵向)',
        onSelect: async (res) => {
          if (!res) return;
          if (res.type === 'file' && res.file) {
            pendingNpcAvatarDisplay = URL.createObjectURL(res.file);
            pendingNpcAvatarAsset = await Storage.compressImage(res.file, 1200, 0.92);
          } else if (res.type === 'url' && res.url) {
            pendingNpcAvatarDisplay = res.url;
            pendingNpcAvatarAsset = res.url;
          } else {
            return;
          }
          isNpcAvatarDirty = true;
          setNpcAvatarDisplay(pendingNpcAvatarDisplay);
        }
      });
    });
  }

  if (npcClearAvatarBtn) {
    npcClearAvatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pendingNpcAvatarAsset = null;
      pendingNpcAvatarDisplay = null;
      isNpcAvatarDirty = true;
      setNpcAvatarDisplay(null);
    });
  }

  if (npcForgeAvatarBtn) {
    npcForgeAvatarBtn.addEventListener('click', async () => {
      if (!window.AvatarForge || typeof AvatarForge.open !== 'function') {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'FORGE // 模块状态',
            message: 'AI 绘像工坊尚未就绪',
            detail: '绘像模块尚未完全载入，请稍候再试。',
            type: 'warn'
          });
        }
        return;
      }
      const appearanceText = npcAppearanceInput ? npcAppearanceInput.value : '';
      AvatarForge.open({
        prompt: '',
        source: 'npc',
        appearance: appearanceText,
        faceIdSrc: null,
        onApply: (storableAsset, displaySrc) => {
          pendingNpcAvatarAsset = storableAsset || displaySrc;
          pendingNpcAvatarDisplay = displaySrc;
          isNpcAvatarDirty = true;
          setNpcAvatarDisplay(displaySrc);
        }
      });
    });
  }

  /* ==========================================================================
     维次 04：人际关系总览 (Nexus Matrix) 渲染控制器
     ========================================================================== */

  let nexusFilterScope = 'all'; // 'all' | 'char' | 'npc' | 'builtin'
  let nexusFilterPersonId = null; // null: 全部人物; string: 具体人物 id
  let nexusMatrixRenderToken = 0;

  function setNexusFilterScope(scope) {
    nexusFilterScope = scope;
    nexusFilterPills.forEach((pill) => {
      pill.classList.toggle('active', pill.dataset.filterScope === scope);
    });
    // 切换大范围时，如果当前聚焦的人不属于该范围，则重置聚焦人
    if (nexusFilterPersonId) {
      const isChar = characters.some((c) => c && c.id === nexusFilterPersonId);
      const isNpc = npcs.some((n) => n && n.id === nexusFilterPersonId);
      if (scope === 'char' && !isChar) nexusFilterPersonId = null;
      if (scope === 'npc' && !isNpc) nexusFilterPersonId = null;
    }
    updateNexusPersonLabel();
    renderNexusMatrixList();
  }

  function updateNexusPersonLabel() {
    if (!nexusPersonLabel) return;
    if (!nexusFilterPersonId) {
      nexusPersonLabel.textContent = '全部人物';
    } else {
      nexusPersonLabel.textContent = resolveCharName(nexusFilterPersonId);
    }
  }

  async function pickNexusFilterPerson() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;

    let opts = [];
    opts.push({
      value: '__ALL__',
      label: '全部人物',
      hint: '查看所有羁绊链路'
    });

    if (nexusFilterScope === 'all' || nexusFilterScope === 'char') {
      (characters || []).forEach((c) => {
        if (!c) return;
        opts.push({
          value: c.id,
          label: c.name || '未命名角色',
          hint: c.camp === 'instance' ? 'SRC.FORK // 副本' : `SRC.SYS // ${c.serial ? 'NO.' + c.serial : '无编号'}`
        });
      });
    }

    if (nexusFilterScope === 'all' || nexusFilterScope === 'npc') {
      (npcs || []).forEach((n) => {
        if (!n) return;
        opts.push({
          value: n.id,
          label: n.name || '未命名NPC',
          hint: n.camp === 'instance' ? 'NPC.FORK // 副本' : `NPC.SYS // ${n.serial ? 'NO.' + n.serial : '无编号'}`
        });
      });
    }

    const picked = await SelectModal.pick({
      title: '按人物聚焦筛选',
      tag: 'NEXUS // 聚焦点',
      options: opts,
      value: nexusFilterPersonId || '__ALL__'
    });

    if (!picked) return;
    nexusFilterPersonId = picked === '__ALL__' ? null : picked;
    updateNexusPersonLabel();
    renderNexusMatrixList();
  }

  async function renderNexusMatrixList() {
    if (!nexusMatrixList) return;
    const token = ++nexusMatrixRenderToken;

    loadCharacters();
    loadNpcs();
    loadRelations();

    if (nexusTotalCountBadge) {
      nexusTotalCountBadge.textContent = String(relations.length);
    }

    if (relations.length === 0) {
      nexusMatrixList.innerHTML = '';
      if (nexusEmptyView) nexusEmptyView.hidden = false;
      if (nexusEmptyDesc) {
        nexusEmptyDesc.textContent = '尚未在任何角色或配角之间建立羁绊。点击上方「登记关系」开启人际网络。';
      }
      return;
    }

    // 1. 确定要聚类排查的主体人物清单
    // 顺序：角色 1, 2... 然后 NPC 1, 2...
    let orderedPersons = [];
    if (nexusFilterScope === 'all' || nexusFilterScope === 'char') {
      (characters || []).forEach((c) => {
        if (c && c.id) orderedPersons.push({ id: c.id, name: c.name || '未命名角色', dim: 'char' });
      });
    }
    if (nexusFilterScope === 'all' || nexusFilterScope === 'npc') {
      (npcs || []).forEach((n) => {
        if (n && n.id) orderedPersons.push({ id: n.id, name: n.name || '未命名NPC', dim: 'npc' });
      });
    }

    // 如果指定了特定人物聚焦，直接过滤为主体人物仅为该人
    if (nexusFilterPersonId) {
      orderedPersons = orderedPersons.filter((p) => p.id === nexusFilterPersonId);
    }

    // 2. 遍历主体人物，归集各自的关系，并进行已渲染关系全局去重
    const renderedRelIds = new Set();
    const clusters = [];

    orderedPersons.forEach((person) => {
      // 找出涉及该人的所有关系
      const myRels = relations.filter((r) => {
        if (!r) return false;
        const involves = r.aId === person.id || r.bId === person.id;
        if (!involves) return false;
        // 如果不是按特定人物聚焦，则在全景顺序列出时进行去重
        if (!nexusFilterPersonId) {
          if (renderedRelIds.has(r.id)) return false;
        }
        return true;
      });

      if (myRels.length > 0) {
        myRels.forEach((r) => renderedRelIds.add(r.id));
        clusters.push({
          person,
          rels: myRels
        });
      }
    });

    if (token !== nexusMatrixRenderToken) return;

    if (clusters.length === 0) {
      nexusMatrixList.innerHTML = '';
      if (nexusEmptyView) nexusEmptyView.hidden = false;
      if (nexusEmptyDesc) {
        nexusEmptyDesc.textContent = '当前筛选条件下未检索到相关的人际关系。';
      }
      return;
    }

    if (nexusEmptyView) nexusEmptyView.hidden = true;

    // 3. 构建 DOM 离屏片断
    const fragment = document.createDocumentFragment();

    for (const cluster of clusters) {
      const groupEl = document.createElement('div');
      groupEl.className = 'resonance-nexus-cluster-group';

      const dimLabel = cluster.person.dim === 'char' ? '角色' : cluster.person.dim === 'npc' ? 'NPC' : '官方';
      const dimClass = cluster.person.dim;

      groupEl.innerHTML = `
        <div class="resonance-nexus-cluster-header">
          <div class="resonance-nexus-cluster-title-wrap">
            <span class="resonance-nexus-cluster-dim-tag ${dimClass}">${dimLabel}</span>
            <span class="resonance-nexus-cluster-name resonance-char-name">${escapeHtml(cluster.person.name)}</span>
          </div>
          <span class="resonance-nexus-cluster-count">${cluster.rels.length} 条羁绊</span>
        </div>
        <div class="resonance-nexus-card-stream"></div>
      `;

      const cardStream = groupEl.querySelector('.resonance-nexus-card-stream');

      for (const rel of cluster.rels) {
        // 主体放左边，客体放右边
        const leftId = cluster.person.id;
        const rightId = rel.aId === leftId ? rel.bId : rel.aId;
        const leftName = resolveCharName(leftId);
        const rightName = resolveCharName(rightId);

        const cardEl = document.createElement('div');
        cardEl.className = 'resonance-nexus-card';
        cardEl.setAttribute('role', 'button');
        cardEl.setAttribute('tabindex', '0');
        cardEl.setAttribute('title', `点击修订 ${leftName} 与 ${rightName} 的关系`);

        cardEl.innerHTML = `
          <!-- 左侧主体 -->
          <div class="resonance-nexus-node">
            <div class="resonance-nexus-avatar-square" id="nexusAvatarSquare_${rel.id}_L">
              ${NEXUS_PLACEHOLDER_SVG}
            </div>
            <span class="resonance-nexus-node-name resonance-char-name">${escapeHtml(leftName)}</span>
          </div>

          <!-- 中间羁绊信息 -->
          <div class="resonance-nexus-center-col">
            <span class="resonance-nexus-relation-pill">‹‹ ${escapeHtml(rel.relation || '未定义关系')} ››</span>
            ${rel.desc ? `<p class="resonance-nexus-desc-summary">${escapeHtml(rel.desc)}</p>` : ''}
          </div>

          <!-- 右侧客体 -->
          <div class="resonance-nexus-node">
            <div class="resonance-nexus-avatar-square" id="nexusAvatarSquare_${rel.id}_R">
              ${NEXUS_PLACEHOLDER_SVG}
            </div>
            <span class="resonance-nexus-node-name resonance-char-name">${escapeHtml(rightName)}</span>
          </div>
        `;

        // 异步注入双方头像
        resolveAvatarSrc(leftId).then((src) => {
          const sq = cardEl.querySelector(`#nexusAvatarSquare_${rel.id}_L`);
          if (sq && src) {
            sq.innerHTML = `<img src="${src}" alt="${escapeHtml(leftName)}" loading="lazy">`;
          }
        });
        resolveAvatarSrc(rightId).then((src) => {
          const sq = cardEl.querySelector(`#nexusAvatarSquare_${rel.id}_R`);
          if (sq && src) {
            sq.innerHTML = `<img src="${src}" alt="${escapeHtml(rightName)}" loading="lazy">`;
          }
        });

        // 点击卡片直接唤起编辑弹窗（保留主体在左侧）
        cardEl.addEventListener('click', () => {
          openNexusModal(rel.id, leftId);
        });

        cardStream.appendChild(cardEl);
      }

      fragment.appendChild(groupEl);
    }

    if (token !== nexusMatrixRenderToken) return;
    nexusMatrixList.innerHTML = '';
    nexusMatrixList.appendChild(fragment);
  }

  // 绑定维次 04 人际关系总览专属交互
  nexusFilterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      const scope = pill.dataset.filterScope || 'all';
      setNexusFilterScope(scope);
    });
  });

  if (nexusPersonTrigger) {
    nexusPersonTrigger.addEventListener('click', () => pickNexusFilterPerson());
  }

  if (nexusGlobalAddBtn) {
    nexusGlobalAddBtn.addEventListener('click', () => openNexusModal(null));
  }

  if (npcNexusAddBtn) {
    npcNexusAddBtn.addEventListener('click', () => openNexusModalForNpc(null));
  }

  // 9. 路由监听
  window.addEventListener('popstate', () => {
    // 文本编辑器叠在本页之上时，这次返回归它处理，本页不响应
    const editorOverlay = document.getElementById('textEditorOverlay');
    if (editorOverlay && !editorOverlay.hidden) return;

    const hash = window.location.hash || '';
    if (isOpen && hash !== '#resonance') {
      Promise.resolve(close()).then((closed) => {
        // 归档失败留在详情页时，手势已经把历史条目消耗掉了。
        // 补回一条，否则下次返回会直接跳出整个应用。
        if (!closed && isOpen) {
          try {
            history.pushState({ rfPage: 'resonance' }, '', '#resonance');
          } catch (_) { /* ignore */ }
        }
      }).catch((err) => {
        console.warn('[Resonance] 路由关闭异常：', err);
      });
    } else if (!isOpen && hash === '#resonance') {
      open();
    }
  });

  // 10. 启动即清除历史占位数据，不必等用户进入同调档案
  Boot.onReady('resonance', () => purgeLegacySeedData());

  window.addEventListener('retroflow:assistant-avatar-changed', () => {
    if (isOpen && currentDimension === 'assistant') renderAsstList();
  });

  // 全局导出
  window.ResonanceUI = {
    open,
    close,
    switchDimension,
    renderCharList,
    openCharEditor,
    showCharListView,
    renderNpcList,
    openNpcEditor,
    showNpcListView,
    renderAsstList,
    openAsstEditor,
    showAsstListView,
    setEditorExitHook,
    normalizeSerial,
    generateUniqueSerial,
    collectTakenSerials,
    findSerialOwner,
    getActiveAssistant,
    setActiveAssistant,
    applyAssistantAvatarFromGallery,
    renderNexusMatrixList,
    openNexusModal,
    purgeLegacySeedData
  };

  // 向注册表声明本模块在用的资产键：全部角色的立绘与面容 + 全部助手立绘与面容 + 全部 NPC 立绘
  DataRegistry.registerUsageProvider('resonance', () => {
    const keys = [];
    const charList = Store.roster.characters || [];
    const npcList = Store.roster.npcs || [];
    const asstList = Store.roster.assistants || [];

    charList.forEach((c) => {
      if (!c || !c.id) return;
      keys.push(ASSET_PREFIX_CHAR_AVATAR + c.id);
      keys.push(ASSET_PREFIX_CHAR_FACE_ID + c.id);
    });

    asstList.forEach((a) => {
      if (!a || !a.id) return;
      keys.push(ASSET_PREFIX_ASST_AVATAR + a.id);
      keys.push(ASSET_PREFIX_ASST_FACE_ID + a.id);
    });

    npcList.forEach((n) => {
      if (!n || !n.id) return;
      keys.push(ASSET_PREFIX_NPC_AVATAR + n.id);
    });

    return keys;
  });
})();