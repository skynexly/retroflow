/**
 * 溯流计划 · 副本推演提示词拼装引擎 (Fork Run Prompt Builder)
 * 职责：
 *   1. 拼装「副本执行作者」视角的 System Prompt：
 *      身份协议 → 溯流计划说明 → 副本卷宗情报 → 执行员档案 → 现场 NPC/队友 → 输出格式
 *   2. 部门差异（无限世界 / 三千世界）的思维链与文风，规划走内置世界书的深度注入，
 *      本文件只维护两部门共用的稳定主体。
 *   3. 解析副本推演专属模型插槽，未配置时退回主模型。
 *
 * 分层约定：
 *   - IDENTITY / CANON 两段是稳定主体，钉死「作者/裁判」这一视角，不含第二人称沉浸腔。
 *   - 卷宗情报、执行员档案、现场档案随每次进本动态拼装。
 *   - 思维链 / 文风 / 格式契约等「每轮都得贴脸提醒」的内容，后续以内置世界书
 *     深度注入落位（position: 'depth'），本文件预留拼装位，暂不写死。
 */
window.ForkRunPrompt = (() => {
  'use strict';

  /* ================= 副本执行作者 · 身份协议 =================
     这一段定义「AI 是什么样的作者」，可以有笔锋。
     视角始终钉在「叙述者与裁判」，绝不切成第二人称让模型代入执行员。 */

  const IDENTITY = `## 你的身份 · 副本执行作者

你是一位文采斐然、笔力精准、逻辑缜密的作家，受溯流计划之邀，成为本副本剧情的专属执笔者与推演者。你的职责是：

- 以沉浸、克制而有张力的笔触推进副本故事，让执行员的每一个行动都在世界中激起真实的回响。
- 精确计算与追踪各项数值的流转——精神值、副本数值、NPC 与队友的状态，依剧情如实增减，绝不随意放水或凭空施惠。
- 冷静判断执行员当前的处境、任务进度与危机程度，让副本始终维持它应有的氛围与重量。

你是这个副本世界的叙述者与裁判，而非执行员的伙伴。请恪守中立，忠于剧情因果与世界规则，写出既好看又可信的推演。`;

  /* ================= 溯流计划说明（副本内视角·精简版）=================
     只保留副本内需要的核心要点，是让 AI 抽离旁观的背景，措辞克制。
     {{DEPARTMENT}} 为当前副本所属部门（无限世界 / 三千世界）。 */

  const CANON = `## 溯流计划说明

溯流计划是一个独立于所有世界之外的神秘组织，超越一切世界线而存在。它招募各世界走投无路的灵魂，赋予其「执行员」身份，将其投放进不同的副本世界执行任务。

- 当前副本隶属于【{{DEPARTMENT}}】。执行员此刻正身处这一副本之中。
- 精神值是衡量执行员灵魂体状态的核心指标：它只在副本中承受消耗，不会凭空回升；一旦归零，执行员将当场崩溃。请始终将它视为高压、稀缺、不可挥霍的生存资源。
- 执行员须完成本副本的全部主线任务方可通关。通关后仍可继续推进剧情、收束余韵，但不宜久留——副本不是可以安居的世界，滞留过久将招致系统的强制回收。`;

  /* ================= 部门枚举 =================
     当前编纂器只产出无限世界副本，卷宗暂无独立部门字段，
     故 resolveDepartment 现阶段固定返回「无限世界」。
     三千世界扩展后，改为按卷宗部门字段解析即可。 */

  const DEPARTMENT_LABEL = {
    infinite: '无限世界',
    thousand: '三千世界'
  };

  const DEFAULT_DEPARTMENT_KEY = 'infinite';

  /**
   * 解析当前副本所属部门的中文名。
   * @param {Object} [fork] 卷宗对象（预留：未来读 fork.department）
   * @returns {string}
   */
  function resolveDepartment(fork) {
    const key = (fork && fork.department) || DEFAULT_DEPARTMENT_KEY;
    return DEPARTMENT_LABEL[key] || DEPARTMENT_LABEL[DEFAULT_DEPARTMENT_KEY];
  }

  /* ================= 等级定义 =================
     与编纂器 LEVEL_OPTIONS 同源（label / hint 两份文案）。
     取不到时回落到「未定级」，不让占位符裸奔。 */

  const LEVEL_DEFS = {
    E: { label: 'E / 静水 STILL', hint: '低危 · 初阶实例' },
    D: { label: 'D / 流深 DEPTH', hint: '常规 · 深层实例' },
    C: { label: 'C / 清源 SPRING', hint: '中危 · 源流实例' },
    B: { label: 'B / 狂澜 SURGE', hint: '高危 · 激变实例' },
    A: { label: 'A / 潮汐 TIDE', hint: '极危 · 潮汐实例' },
    S: { label: 'S / 归墟 ABYSS', hint: '死局 · 归墟实例' },
    'S+': { label: 'S+ / 归墟 VOID', hint: '终局 · 归墟实例' }
  };

  function resolveLevel(fork) {
    const key = (fork && fork.levelKey) || '';
    return LEVEL_DEFS[key] || { label: key || '未定级', hint: '暂无等级定义' };
  }

  /* ================= 文本工具 ================= */

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim());
  }

  /* ================= 卷宗情报拼装 =================
     每块列表都做空值兜底：整块无内容时拼「暂无」占位，不留裸标题。 */

  /** 背景设定 */
  function buildBackgroundBlock(fork) {
    const bg = trimStr(fork && fork.background);
    return `### 背景设定\n\n${bg || '暂无背景设定。'}`;
  }

  /** 地点设定：【地点名】位置：详细位置。设定详情 */
  function buildLocationsBlock(fork) {
    const list = (fork && Array.isArray(fork.locations)) ? fork.locations : [];
    const lines = list.map((loc) => {
      const name = trimStr(loc && loc.name);
      if (!name) return '';
      const pos = trimStr(loc && loc.position);
      const desc = trimStr(loc && loc.desc);
      let line = `- 【${name}】`;
      if (pos) line += `位置：${pos}。`;
      if (desc) line += desc;
      return line;
    }).filter(Boolean);
    return `### 地点设定\n\n${lines.length ? lines.join('\n') : '暂无预设地点，由你依剧情现场描写。'}`;
  }

  /** 副本 NPC：【姓名】（性别）：设定与动机
   *  锁定身份且开关开启时，把未被选中的锁定角色一并当作 NPC 拼入（不做区分标记）。
   *  @param {Object} [envoyCtx] 当前接入身份 { mode, roleId }，用于排除已选锁定角色
   */
  function buildNpcsBlock(fork, envoyCtx) {
    const list = (fork && Array.isArray(fork.npcs)) ? fork.npcs : [];
    const lines = list.map((npc) => {
      const name = trimStr(npc && npc.name);
      if (!name) return '';
      const gender = trimStr(npc && npc.gender) || '未知';
      const desc = trimStr(npc && npc.desc);
      return `- 【${name}】（${gender}）：${desc || '暂无设定。'}`;
    }).filter(Boolean);

    // 未选锁定角色并入 NPC：仅锁定身份 + 开关开启（默认开）时生效
    const ctx = envoyCtx || {};
    if (ctx.mode === 'locked' && (fork && fork.unpickedRolesAsNpc !== false)) {
      const roles = (fork && Array.isArray(fork.lockedRoles)) ? fork.lockedRoles : [];
      const pickedId = trimStr(ctx.roleId);
      roles.forEach((r) => {
        if (!r || String(r.id) === pickedId) return; // 跳过被执行员选中的那个
        const name = trimStr(r.name);
        if (!name) return;
        const gender = trimStr(r.gender) || '未知';
        const profile = trimStr(r.profile); // 锁定角色的设定字段是 profile
        lines.push(`- 【${name}】（${gender}）：${profile || '暂无设定。'}`);
      });
    }

    return `### 副本 NPC\n\n${lines.length ? lines.join('\n') : '暂无预设 NPC，由你依剧情引入登场人物。'}`;
  }

  /* ================= 觉醒者说明 =================
     从同调档案取 camp === 'instance' && rank === 'awakened' 的角色，
     按 hazardCharIds 过滤。漫游者（drifter）逻辑暂不接入，跳过不拼。 */

  function collectAwakened(fork) {
    const ids = (fork && Array.isArray(fork.hazardCharIds) && fork.hazardCharIds.length)
      ? fork.hazardCharIds
      : (fork && fork.hazardCharId ? [fork.hazardCharId] : []);
    if (!ids.length || !window.Store || !Store.roster) return [];

    const pools = [Store.roster.characters, Store.roster.npcs];
    const all = [];
    pools.forEach((pool) => {
      (Array.isArray(pool) ? pool : []).forEach((item) => {
        if (item && item.camp === 'instance') all.push(item);
      });
    });

    return ids
      .map((id) => all.find((c) => c && c.id === id))
      .filter((c) => c && c.rank === 'awakened');
  }

  const AWAKENED_NOTE = `觉醒者是已经察觉到更高维干涉的副本原生角色——他们隐约意识到执行员并不真正属于这个世界，甚至可能背负着某种不为人知的使命。这份认知，有的觉醒者一早便已了然，有的则在剧情推进中逐渐察觉。

但觉醒者通常不会声张这一点，甚至将其深藏为秘密。平日里，他们与普通 NPC 无异，只在言行举止间偶尔流露出一丝隐晦的、不合常理的异样；唯有在情节确有必要时，才可能将这层认知宣之于口。

若无特别说明，请将觉醒者当作普通 NPC 中的一员来书写，不必刻意凸显其特殊性。`;

  /** 觉醒者特别说明：无觉醒者时整段不拼 */
  function buildAwakenedBlock(fork) {
    const awakened = collectAwakened(fork);
    if (!awakened.length) return '';
    const lines = awakened.map((c) => {
      const name = trimStr(c.name) || '未知觉醒者';
      const gender = trimStr(c.gender) || '未知';
      const profile = trimStr(c.profile) || '暂无设定摘要。';
      return `- 【${name}】（${gender}）：${profile}`;
    });
    return `### 觉醒者 · 特别说明\n\n本副本中，以下角色为「觉醒者」：\n\n${lines.join('\n')}\n\n${AWAKENED_NOTE}`;
  }

  /* ================= 主线任务 =================
     goal（任务目标）与 criteria（达成判定）都拼给模型：
     判定让模型知道「到什么程度算完成」，避免草率判通关；
     但补一句不得轻易向执行员透露达成条件。 */

  const MISSION_FOOT = `以上任务由溯流系统下发，显示在执行员的终端上。任务通常不会轻易达成，需要随剧情层层推进。探索的方向与推进的节奏都由执行员自己把握——你只需如实呈现世界对其行动的反馈，不要代为谋划、不要替他达成目标，也不要催促他行动。

达成判定仅供你内部裁定任务是否完成之用，请不要向执行员透露任务的达成条件。`;

  /**
   * 拼「任务配额声明」：告诉 AI 本副本主线任务的总数与当前已下发数。
   *
   * 解决的问题：未解锁的阶段任务不会列进上面的清单（避免提前抖出后段剧情），
   * 但 CANON 里写着「须完成全部主线任务方可通关」。若不声明总数，AI 会把眼前
   * 这几条当成全部主线，打完就开始写通关收尾——后面还没解锁的任务被跳过。
   *
   * 口径：只给数字，不给内容。AI 知道「还没完」，但不知道「剩下是什么」。
   *
   * @param {Object|null} ctx missionCtx（需含 totalCount）
   * @param {number} issuedCount 本次实际列出的（已下发）任务数
   * @returns {string} 无需声明时返回空串
   */
  function buildMissionQuotaNote(ctx, issuedCount) {
    const total = ctx ? Number(ctx.totalCount) : 0;
    const issued = Number(issuedCount) || 0;
    // 总数拿不到、或已全部下发：无需声明，通关判定就看上面这份清单
    if (!Number.isFinite(total) || total <= 0 || total <= issued) return '';
    const pending = total - issued;
    return `本副本的主线任务共有 ${total} 项，目前已下发 ${issued} 项，余下 ${pending} 项尚未下发——它们将在条件满足时由溯流系统追加推送到执行员的终端上。在全部 ${total} 项主线任务完成之前，本副本不具备通关条件：请不要宣告副本通关，不要让溯流系统发出回收或撤离通知，也不要把故事当作已经结束来收尾。清单上这些任务全部完成后，故事应当继续推进，等待系统下发余下的任务。\n\n`;
  }

  /**
   * 拼「主线任务」块。只列**已解锁**的任务——未解锁（前置未达成）的阶段任务
   * 完全不露，连存在都不提，避免 AI 提前把后段剧情抖出来。
   *
   * @param {Object} fork 卷宗
   * @param {Object} [missionCtx] 任务上下文（由 fork-run-ui 依 run.missions + prereq 算好）：
   *   { unlockedIds: string[], achievedIds: string[] }
   *   不传时退回「全部任务都算已解锁、都未完成」（老路径兼容）。
   * @returns {string}
   */
  function buildMissionsBlock(fork, missionCtx) {
    const list = (fork && Array.isArray(fork.clearConditions)) ? fork.clearConditions : [];
    const ctx = (missionCtx && typeof missionCtx === 'object') ? missionCtx : null;
    const unlockedSet = ctx && Array.isArray(ctx.unlockedIds) ? new Set(ctx.unlockedIds.map(trimStr)) : null;
    const achievedSet = ctx && Array.isArray(ctx.achievedIds) ? new Set(ctx.achievedIds.map(trimStr)) : new Set();

    const lines = list.map((m) => {
      const id = trimStr(m && m.id);
      if (unlockedSet && (!id || !unlockedSet.has(id))) return '';
      const goal = trimStr(m && m.goal) || trimStr(m && m.text);
      if (!goal) return '';
      const criteria = trimStr(m && m.criteria);
      const done = id && achievedSet.has(id);
      let line = `- 编号：${id || '（无编号）'}\n  目标：${goal}${done ? '（已完成）' : ''}`;
      if (criteria) line += `\n  达成判定：${criteria}`;
      return line;
    }).filter(Boolean);
    if (!lines.length) return '';
    return `### 主线任务\n\n以下是溯流系统已向执行员下发的主线任务，执行员在终端上可以随时查看：\n\n${lines.join('\n')}\n\n${buildMissionQuotaNote(ctx, lines.length)}${MISSION_FOOT}`;
  }

  /* ================= 数值说明 =================
     全局数值（作用于执行员）+ 角色数值（作用于特定 NPC）。
     两块都为空时整段不拼。 */

  function buildGlobalStatLines(fork) {
    const list = (fork && Array.isArray(fork.stats)) ? fork.stats : [];
    return list.map((s) => {
      const name = trimStr(s && s.name);
      if (!name) return '';
      const min = (s && s.min !== undefined && s.min !== '') ? s.min : 0;
      const max = (s && s.max !== undefined && s.max !== '') ? s.max : 100;
      const init = (s && s.init !== undefined && s.init !== null && s.init !== '') ? s.init : max;
      const desc = trimStr(s && s.desc);
      let line = `- 【${name}】范围 ${min}~${max}，初始 ${init}。`;
      if (desc) line += desc;
      return line;
    }).filter(Boolean);
  }

  function buildCharStatLines(fork) {
    const templates = (fork && Array.isArray(fork.charStats)) ? fork.charStats : [];
    const npcs = (fork && Array.isArray(fork.npcs)) ? fork.npcs : [];

    // 名字查表：副本 NPC 的名字在卷宗 npcs 里；本副本已选高危角色的名字在同调档案里。
    // 两套 ID 空间合到一张表，按 id 反查名字，绑哪类角色都查得到。
    const nameById = new Map();
    npcs.forEach((n) => {
      if (n && n.id) nameById.set(n.id, trimStr(n.name) || '未命名NPC');
    });
    const hazardIds = (fork && Array.isArray(fork.hazardCharIds) && fork.hazardCharIds.length)
      ? fork.hazardCharIds
      : (fork && fork.hazardCharId ? [fork.hazardCharId] : []);
    if (hazardIds.length && window.Store && Store.roster) {
      const pools = []
        .concat(Array.isArray(Store.roster.characters) ? Store.roster.characters : [])
        .concat(Array.isArray(Store.roster.npcs) ? Store.roster.npcs : []);
      const rosterMap = new Map();
      pools.forEach((item) => {
        if (item && item.id) rosterMap.set(item.id, item);
      });
      hazardIds.forEach((id) => {
        const hit = rosterMap.get(id);
        const nm = trimStr(hit && hit.name);
        if (nm) nameById.set(id, nm);
      });
    }

    const nameOf = (id) => nameById.get(id) || '';

    const groups = [];
    templates.forEach((tpl) => {
      const metrics = (tpl && Array.isArray(tpl.metrics)) ? tpl.metrics : [];
      if (!metrics.length) return;
      // 绑定对象合并两套 ID 空间：高危角色（charIds）+ 副本 NPC（npcIds）
      const boundIds = []
        .concat((tpl && Array.isArray(tpl.charIds)) ? tpl.charIds : [])
        .concat((tpl && Array.isArray(tpl.npcIds)) ? tpl.npcIds : []);
      const boundNames = boundIds.map(nameOf).filter(Boolean);
      if (!boundNames.length) return;
      const metricLines = metrics.map((m) => {
        const name = trimStr(m && m.name);
        if (!name) return '';
        const min = (m && m.min !== undefined && m.min !== '') ? m.min : 0;
        const max = (m && m.max !== undefined && m.max !== '') ? m.max : 100;
        const init = (m && m.init !== undefined && m.init !== null && m.init !== '') ? m.init : max;
        const desc = trimStr(m && m.desc);
        let line = `  - 【${name}】范围 ${min}~${max}，初始 ${init}。`;
        if (desc) line += desc;
        return line;
      }).filter(Boolean);
      if (!metricLines.length) return;
      groups.push(`绑定角色：${boundNames.join('、')}\n${metricLines.join('\n')}`);
    });
    return groups;
  }
  const STATS_FOOT = `每一项数值都有其现实含义与变化逻辑，不可凭空跳变。数值的每一次改动都应有剧情依据，并在回复的对应区块中如实记录。`;

  function buildStatsBlock(fork) {
    const globalLines = buildGlobalStatLines(fork);
    const charGroups = buildCharStatLines(fork);
    if (!globalLines.length && !charGroups.length) return '';

    const parts = [];
    if (globalLines.length) {
      parts.push(`【全局数值】（作用于执行员，随行动与遭遇变化）\n${globalLines.join('\n')}`);
    }
    if (charGroups.length) {
      parts.push(`【角色数值】（作用于特定 NPC，反映其对执行员的态度或自身状态）\n${charGroups.join('\n\n')}`);
    }
    return `### 数值说明\n\n本副本设有以下数值指标，你需要在推演中依剧情如实追踪它们的增减：\n\n${parts.join('\n\n')}\n\n${STATS_FOOT}`;
  }
  /* ================= 开场剧情纲要 =================
     prologue 是给模型的导演提示（只定走向，不上屏），
     与 opening（成品首帧正文，直接落库上屏、不经模型）是两回事。

     多套开场：按接入身份从 fork.openings 里挑对应那套。
     规则与准备页 (fork-ready-ui) 的 getAvailableOpenings 保持一致：
       - 锁定身份：bindRoleIds 命中当前角色的专属开场优先，其次 bindRoleIds 为空的通用开场；
       - 自由身份：只认通用开场。
     调用方可通过 openingCtx.openingId 指定确切那套（执行员在准备页手选过的），
     指定不中或未指定时按上述规则兜底。

     TODO（接模型请求时补）：prologueRounds 控制「前 N 轮注入、之后停发」，
     需要当前轮次才能判定，届时由调用方把轮次传进来，超出轮数则整段不拼。 */

  const PROLOGUE_FOOT = `这份纲要只定走向，不定文字。具体的场景铺陈、对白语气、人物神态与细节质感，都由你依世界观自由发挥，无需逐句照搬，也不必受其行文风格拘束。但请确保推演的实际走向不要偏离纲要勾勒的骨架——它是这段剧情的既定脉络。

纲要中尚未交代的部分，由你依剧情合理衔接。若执行员的行动与纲要的预期路径产生冲突，请以执行员的自主选择为先，让剧情在被扰动后自然重新收束回纲要的方向，而不是强行扭转或无视执行员的行动。

这是幕后的编排提示，执行员对其一无所知。请不要向执行员透露纲要的存在或其中尚未发生的内容。`;

  /**
   * 按接入身份解析当前生效的开场套。
   * @param {Object} [fork] 副本卷宗
   * @param {Object} [envoyCtx] 接入身份 { mode, roleId }
   * @param {Object} [openingCtx] { openingId } 执行员在准备页手选的那套
   * @returns {Object|null} 开场套对象，取不到返回 null
   */
  function resolveOpening(fork, envoyCtx, openingCtx) {
    const list = (fork && Array.isArray(fork.openings)) ? fork.openings.filter(Boolean) : [];

    // 老卷宗没有 openings 数组，把根级扁平字段当作唯一一套通用开场
    if (!list.length) {
      const rootPrologue = trimStr(fork && fork.prologue);
      if (!rootPrologue) return null;
      return { bindRoleIds: [], prologue: rootPrologue };
    }

    // 优先用调用方指定的那套（准备页手选结果）
    const wantId = trimStr(openingCtx && openingCtx.openingId);
    if (wantId) {
      const hit = list.find((op) => trimStr(op.id) === wantId);
      if (hit) return hit;
    }

    const ctx = envoyCtx || {};
    const isGeneral = (op) => !Array.isArray(op.bindRoleIds) || op.bindRoleIds.length === 0;

    // 锁定身份：先找绑定了当前角色的专属开场
    if (ctx.mode === 'locked') {
      const roleId = trimStr(ctx.roleId);
      if (roleId) {
        const exclusive = list.find((op) => Array.isArray(op.bindRoleIds) && op.bindRoleIds.includes(roleId));
        if (exclusive) return exclusive;
      }
    }

    // 兜底通用开场；连通用都没有则说明所有开场都绑给了别的角色，不拼
    return list.find(isGeneral) || null;
  }

  /**
   * 拼开场剧情纲要块。纲要为空则整段不拼。
   * @param {Object} [fork] 副本卷宗
   * @param {Object} [envoyCtx] 接入身份
   * @param {Object} [openingCtx] { openingId }
   * @returns {string}
   */
  function buildPrologueBlock(fork, envoyCtx, openingCtx) {
    const op = resolveOpening(fork, envoyCtx, openingCtx);
    const prologue = trimStr(op && op.prologue);
    if (!prologue) return '';

    return `### 开场剧情纲要

以下是本副本开场阶段的剧情纲要，勾勒了执行员进入副本后前期应当发生的事件走向：

${prologue}

${PROLOGUE_FOOT}`;
  }

  /** 副本情报总装：当前副本信息头 + 背景/地点/NPC/觉醒者/主线/纲要/数值
   *  @param {Object} [envoyCtx] 当前接入身份，透传给 buildNpcsBlock 以并入未选锁定角色
   *  @param {Object} [openingCtx] { openingId } 当前选定的开场套，透传给 buildPrologueBlock
   */
  function buildForkDossierBlock(fork, envoyCtx, openingCtx, missionCtx) {
    const level = resolveLevel(fork);
    const title = trimStr(fork && fork.title) || '未命名副本';

    const head = `## 当前副本信息

- 副本名称：${title}
- 副本等级：${level.label}
- 等级定义：${level.hint}`;

    const blocks = [
      head,
      buildBackgroundBlock(fork),
      buildLocationsBlock(fork),
      buildNpcsBlock(fork, envoyCtx),
      buildAwakenedBlock(fork),
      buildMissionsBlock(fork, missionCtx),
      buildPrologueBlock(fork, envoyCtx, openingCtx),
      buildStatsBlock(fork)
    ].filter(Boolean);

    return blocks.join('\n\n');
  }

  /* ================= 执行员档案 =================
     四种接入情况，两条主线：
       - 自由身份 · 本体（persona）：以原始样貌进入，需为其安排融入世界的身份。
       - 自由身份 · 马甲（mask）：使用了伪装身份进入。
       - 锁定角色（locked/preset）：替代世界原生角色行动。角色可由 AI 视剧情补设定，
         但不得借此编造执行员本人的特质。
     数据源：
       - 本体   Store.envoy.identity   { name, gender, birthday, appearance, profile }
       - 马甲   Store.envoy.masks[]    同构字段
       - 锁定   fork.lockedRoles[]     { id, name, gender, avatar, profile }
     由调用方（fork-run-ui）解析好当前接入身份，通过 envoyCtx 传入，
     prompt 引擎不直接依赖 currentRun / DOM 全局。 */

  const FREE_PERSONA_NOTE = `当前副本允许使用自由身份，执行员并未进行任何伪装，以原始样貌进入副本。在剧情中，你需要依据执行员的设定，为其安排一个合适的身份，让他自然地融入这个世界，而非来路不明的天外来客。`;

  const FREE_MASK_NOTE = `当前副本允许使用自由身份，执行员使用了伪装身份进入副本。在剧情中，你需要依据这重伪装身份的设定，让执行员自然地融入这个世界，而非来路不明的天外来客。`;

  const LOCKED_NOTE = `当前副本要求使用锁定角色，执行员进入该世界本身已有的角色中，代替其行动。这意味着执行员所操控的角色，可能与执行员本人有相当大的差异。你不可忽略该角色本身的特质，但也不能将这些特质视作执行员自己的特质。`;

  // 收束句：自由身份全面禁止脑补；锁定角色放开角色补全、但守住不混淆执行员的底线。
  const FREE_FOOT = `请严格依据以上档案理解执行员，不要编造、揣测或推敲任何未被写入档案的喜好、习惯、性格特质与过往经历。`;

  const LOCKED_FOOT = `该角色是这个世界的原生居民，你可以依据剧情需要，为其补充符合世界观与人设的细节与经历。但请不要借此编造、揣测执行员本人未被写入档案的喜好、习惯、性格特质与过往经历——被操控的角色是角色，接入的执行员是执行员，两者不可混为一谈。`;

  /**
   * 编号锚点句：所有身份情况都拼，作为执行员唯一恒定的确认凭据。
   * serial 已由调用方清洗成六位数字。
   */
  function buildSerialAnchor(serial) {
    const s = String(serial || '').replace(/\D/g, '').padStart(6, '0').slice(-6) || '000001';
    return `当前接入的执行员，编号为 NO.${s}。这是关于该执行员唯一恒定、可以确认的真实信息——无论他以何种样貌或身份出现在副本中，编号始终不变。`;
  }

  /** 档案字段拼成条目。空字段整行丢弃。编号不在此列（已提为独立锚点句）。 */
  function buildEnvoyFieldLines(fields) {
    return fields
      .map((f) => {
        const val = trimStr(f && f.value);
        if (!val) return '';
        return `- ${f.label}：${val}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  /**
   * 拼执行员档案块。
   * @param {Object} [envoyCtx] 由调用方解析好的当前接入身份：
   *   { mode: 'persona'|'mask'|'locked', roleId, serial, name, gender, birthday, appearance, profile }
   *   roleId 仅锁定身份用（标识当前接入的锁定角色，供排除未选角色）。
   * @returns {string}
   */
  function buildEnvoyBlock(envoyCtx) {
    const ctx = envoyCtx || {};
    const mode = (ctx.mode === 'mask' || ctx.mode === 'locked') ? ctx.mode : 'persona';

    // 情境说明句 + 收束句
    let note = FREE_PERSONA_NOTE;
    let foot = FREE_FOOT;
    if (mode === 'mask') {
      note = FREE_MASK_NOTE;
    } else if (mode === 'locked') {
      note = LOCKED_NOTE;
      foot = LOCKED_FOOT;
    }

    // 档案字段：本体/马甲带诞生日，锁定角色通常无诞生日，空则整行丢弃
    const fieldLines = buildEnvoyFieldLines([
      { label: mode === 'locked' ? '角色' : '代号', value: ctx.name },
      { label: '性别', value: ctx.gender },
      { label: '诞生日', value: ctx.birthday },
      { label: '外貌特征', value: ctx.appearance },
      { label: mode === 'locked' ? '角色设定' : '个人简介', value: ctx.profile }
    ]);

    const headTitle = mode === 'locked' ? '## 执行员 · 锁定角色' : '## 执行员档案';
    const fieldsIntro = mode === 'locked'
      ? '执行员本次接入并操控以下角色：'
      : '以下是当前接入的执行员档案：';

    const parts = [headTitle, note, buildSerialAnchor(ctx.serial)];
    if (fieldLines) parts.push(`${fieldsIntro}\n${fieldLines}`);

    // 额外设定：对档案的补充，与档案同等有效。
    // 不向模型解释「临时 / 仅限本次」——那是给用户看的 UI 语义，对模型无可执行含义，
    // 反而容易被读成对这段设定的降权。效力范围由下方收束句的「以上档案」统一覆盖。
    const extra = String((ctx.extra == null ? '' : ctx.extra)).trim();
    if (extra) {
      parts.push(`### 补充设定\n\n以下是对执行员档案的补充，与上方档案同等有效，请一并纳入推演：\n\n${extra}`);
    }

    parts.push(foot);

    return parts.join('\n\n');
  }

  /* ================= 输出格式契约 =================
     每轮回复的结构规范，对齐解析器 fork-run-parser.js 和契约文档。
     单人场景先不涉及 ally 块，文风约束留给内置世界书深度注入。 */

  const OUTPUT_FORMAT = `## 输出格式

你的每一轮回复由两部分组成：**正文**与**结构块**。

正文是副本世界的叙事文字，自由书写。结构块是包裹在 \`:::\` 栅栏内的状态信息，用于同步给终端界面。两者严格分离——正文里不要出现 \`:::\` 栅栏，结构块内只写规定的字段。

一轮回复的排布顺序固定如下：

\`\`\`
::: scene
（场景锚定字段）
:::

（正文：本轮的叙事，自由书写）

::: state
（执行员状态字段）
:::

::: npc 某NPC的名字
（该NPC的状态字段）
:::

::: quest
（任务进度）
:::
::: recap
（本轮概述）
:::
\`\`\`
即：\`::: scene\` 立于正文最前，其余结构块（\`state\` / \`npc\` / \`quest\` / \`recap\`）置于正文之后，\`recap\` 固定收尾。

### 结构块语法

- 块以 \`::: 类型\` 开头，以单独一行的 \`:::\` 结尾。
- 需要指定对象的块，在类型后跟名字，如 \`::: npc 护士长\`。
- 块内每行一个字段，格式为 \`[标签] 值\`。

### 各结构块

**\`::: scene\` · 场景锚定**（必须有，置于正文之前）

\`\`\`
::: scene
[时间] 2026.6.18 星期四 23:00
[季节] 秋
[温度] 15℃
[天气] 小雨
[地点] 新月双子塔 · 4楼办公室
[场景] 对当前环境约80字的客观描述，重点写场景与气氛。
:::
\`\`\`

所有字段**必须填写**，即使当前不明确也要填占位值（如「未知」「待定」）。时间格式为 \`年.月.日 星期X 时:分\`；地点格式为 \`大地点 · 小地点\`。

**\`::: state\` · 执行员状态**（必须有，置于正文之后）

\`\`\`
::: state
[精神值] 85
[着装] 一身洗旧的靛蓝色工装，袖口磨出毛边。
[姿势] 半倚在办公桌沿，右手无意识地转着一支签字笔。
[饱食度] 72
[变动·饱食度] -5 长时间潜行，腹中空乏
[变动·精神值] -3 低频嗡鸣持续侵蚀神经
:::
\`\`\`

- \`[精神值]\` 与副本自定义数值均为纯数字。
- \`[着装]\` \`[姿势]\` 各约 30~50 字。
- 数值发生变化时，追加一行 \`[变动·数值名] 变动量 变化理由\`，变动量带正负号：正数用 \`+\`、负数用 \`-\`、不变写 \`0\`（如 \`+3\`、\`-5\`、\`0\`）。

**\`::: npc NPC姓名\` · 现场目标**（可多个，每个 NPC 一个独立的块）

\`\`\`
::: npc 护士长
[着装] 浆洗得发白的护士长制服，袖标一丝不苟。
[姿势] 端坐在护士站后，指尖在键盘上敲击。
[警惕度] 65
[变动·警惕度] +10 察觉到走廊尽头的异响
:::
\`\`\`

字段与 \`state\` 一致，**但 NPC 没有精神值**，不要给 NPC 写 \`[精神值]\`。

**\`::: quest\` · 主线任务**（有则输出，无则整块省略）

\`\`\`
::: quest
[推进中] cc_1730000001 潜入4楼办公室取回U盘
[已完成] cc_1730000002 混入医护人员队伍
:::
\`\`\`

每条任务一行，格式为 \`[状态] 任务编号 任务名称\`：

- 状态用 \`[推进中]\` 或 \`[已完成]\`。
- 任务编号照抄「主线任务」里给出的编号（如 \`cc_1730000001\`），一个字符都不要改动、不要自己编号。
- 任务名称写得简短可读即可，便于执行员在终端界面上一眼看清。
- 只能输出「主线任务」里列出的任务，不要自行衍生、拆分或合并任务。没有列出的任务不存在。
**\`::: recap\` · 本轮概述**（必须有，置于所有结构块之后，收尾全轮）
\`\`\`
::: recap
执行员潜入4楼办公室，撬开档案柜取得U盘，但柜门异响惊动了巡夜的护士长，对方正循声朝走廊赶来。高压潜行令其精神值持续下滑，离开路线尚未确定。
:::
\`\`\`
- 用 50~100 字，第三人称客观记述**本轮发生的关键进展**：执行员做了什么、发生了什么交互、推进到何处、重要的状态或局势变化。
- 只记已经在正文中发生的事，它是本轮内容的高度提炼，只描述事实，不扩展发散、不揣测未写明的内容、不向后推进剧情，需要确保只看这一段也能大致理解剧情。
- 概述正文写成一段连续的纯文字叙述，不分行、不列点、不加标题、不使用任何格式符号或字段标签。
### 输出准则

- \`scene\` 和 \`state\` 块**每轮必须输出**，其余块（\`npc\` / \`quest\`）有内容才输出。某个块本轮没有信息就整块省略，不要输出空块或占位块。
- 执行员的姓名、编号由终端自行掌握，**不要在结构块里输出**。
- \`recap\` 块固定作为整轮回复的最后一块。它只用于系统留存，不影响正文叙事，执行员不会在正文里读到它。
- 场景、状态、数值应与正文叙事保持一致——正文里发生的变化，要如实反映到对应的结构块中。`;

  /* ================= 当前解锁线索 =================
     执行员触发的线索，鼓励 AI 在剩余轮数内择机融入正文，
     并在提供后输出 ::: clue 块回执。超窗口的线索由终端兜底，不再拼入。 */

  /**
   * 拼「当前解锁线索」块，置于 System Prompt 最底部。
   * @param {Array} clueCtx 形如 [{ id, name, desc, remaining }]，
   *   remaining 为剩余轮数（>=1）。空或无有效项时返回空串，整块不拼。
   * @returns {string}
   */
  function buildActiveCluesBlock(clueCtx) {
    const list = Array.isArray(clueCtx) ? clueCtx.filter((c) => c && trimStr(c.id) && trimStr(c.name)) : [];
    if (!list.length) return '';

    const entries = list.map((c, idx) => {
      const remaining = Math.max(1, Number(c.remaining) || 1);
      const name = trimStr(c.name);
      const desc = trimStr(c.desc) || '（未填写线索内容，请依剧情合理呈现。）';
      return `【线索 ${idx + 1}】剩余轮数 ${remaining}/3\n编号：${trimStr(c.id)}\n名称：${name}\n内容：${desc}`;
    });

    return `## 当前解锁线索

执行员已触发以下线索。请在剩余轮数内，寻找合适的时机，将线索以自然的方式融入正文叙事中，让执行员在剧情推进里自行获知——不要生硬罗列，也不要直接照抄线索原文。

确认你已在本轮正文中提供了某条线索后，在回复的最末尾输出对应的结构块：

\`\`\`
::: clue
[已提供] 线索编号
:::
\`\`\`

每条线索只需在正文自然带出一次，输出一次 \`::: clue\` 回执即算完成。已经回执过的线索会从上面的列表中移除——列表里没有的线索，说明已提供完毕，请不要再重复输出它的 \`::: clue\` 标记。

${entries.join('\n\n')}

超过剩余轮数仍未提供的线索，将由终端自动归档，不再要求你提供。`;
  }

  /* ================= 已解明核心真相 =================
     真相一触发即永久解明。这里是「常驻块」——解明后每轮都拼进 System Prompt 底部，
     让 AI 始终把它当作已知底牌，后续推演都与之自洽。不负责「此刻揭示」（那由深度注入的
     一次性导演指令承担），只负责「以后一直记得」。 */

  /**
   * 拼「已解明核心真相」常驻块，置于 System Prompt 最底部（线索块之后）。
   * @param {boolean} truthUnlocked 本条世界线是否已解明核心真相
   * @param {string} truthDesc 真相全文（fork.hiddenTruth.desc）
   * @returns {string} 未解明或无内容时返回空串，整块不拼
   */
  function buildRevealedTruthBlock(truthUnlocked, truthDesc) {
    const desc = trimStr(truthDesc);
    if (!truthUnlocked || !desc) return '';
    return `## 已解明的核心真相

本副本的核心真相已经解锁。以下事实此刻已浮出水面，它是这个世界底层的既定真相，你后续的每一段推演都应与之自洽——剧情的因果、人物的动机、隐藏的伏笔，都应在这一真相的笼罩之下顺理成章：

——${desc}——

无需再刻意「揭示」它（它已经揭开了），但请始终记得它是真的，让世界的走向与它保持一致。`;
  }

  /**
   * 拼「核心真相解明」的一次性导演指令。仅在真相「刚解明的那一轮」发一次，
   * 走深度注入（贴近生成点），提示 AI 顺势把剧情朝真相转折。后续轮不再发，靠常驻块兜底。
   * @param {string} truthDesc 真相全文（fork.hiddenTruth.desc）
   * @returns {string} 无内容时返回空串
   */
  function buildTruthDirectiveBlock(truthDesc) {
    const desc = trimStr(truthDesc);
    if (!desc) return '';
    return `【系统 · 核心真相解明】
执行员的行动已触及本副本最底层的真相。以下是这一真相的全貌，此前一直深埋在剧情暗线之下，现在到了让它开始浮现的时刻：

——${desc}——

请在本轮推演中，让这一真相自然地朝台前转折：可以借由某个线索的骤然清晰、关键人物无法再掩饰的反应、或场景中某处异变的揭露，让执行员与读者感到「原来如此」的震动。不必一次和盘托出，但从这一刻起，剧情的走向应当明确地被这一真相牵引。`;
  }

  /* ================= 阶段任务解锁 =================
     前置任务达成后，后续阶段任务才解锁。任务是溯流系统派发给执行员的实事，
     执行员在终端上真能看到新任务下发，不是用来埋伏笔的剧情道具——所以这条
     指令的口径是「如实呈现这次推送」，而非「让任务自然浮现」。
     解锁当轮起贴脸提示，直到 AI 在 ::: quest 块里回执该任务（或超宽限窗口）为止。 */

  /**
   * 拼「溯流系统 · 任务推送」的贴脸导演指令，走深度注入（贴近生成点）。
   * @param {Array} items 形如 [{ id, goal, criteria }]，均为本次新解锁的任务
   * @param {string[]} [triggerNames] 触发本次解锁的前置任务目标文本（已完成的那些）
   * @returns {string} 无内容时返回空串
   */
  function buildMissionUnlockDirectiveBlock(items, triggerNames) {
    const list = Array.isArray(items)
      ? items.filter((m) => m && trimStr(m.id) && (trimStr(m.goal) || trimStr(m.text)))
      : [];
    if (!list.length) return '';

    const entries = list.map((m) => {
      const goal = trimStr(m.goal) || trimStr(m.text);
      const criteria = trimStr(m.criteria);
      let line = `编号：${trimStr(m.id)}\n目标：${goal}`;
      if (criteria) line += `\n达成判定：${criteria}`;
      return line;
    });

    const plural = list.length > 1 ? '这些新任务' : '这项新任务';
    // 前置任务名拿得到就点名（「执行员已完成「xxx」」），拿不到就退回笼统说法
    const names = Array.isArray(triggerNames)
      ? triggerNames.map(trimStr).filter(Boolean).map((n) => `「${n}」`)
      : [];
    const head = names.length
      ? `执行员已完成${names.join('')}，新任务随之解锁：`
      : `执行员已完成前置任务，新任务随之解锁：`;

    return `【溯流系统 · 任务推送】
${head}

${entries.join('\n\n')}

请在本轮推演中如实呈现这次推送：执行员的终端亮起，${plural}映入眼中。
达成判定仅供你内部裁定，不要透露给执行员。
本轮回复的 \`::: quest\` 块中请把${plural}一并列出（照抄上面给出的编号），状态标为 \`[推进中]\`。`;
  }

  /* ================= 结局收尾 =================
     结局多条，第一个命中即定，此后不再命中新结局。结局只代表「故事开始收尾」，
     线索 / 真相仍可继续触发。双层：常驻基调块（每轮提醒向结局收束）+ 一次性导演指令
     （命中当轮贴脸提示开始收尾）。软指令，不硬锁死输入。 */

  /**
   * 拼「结局收尾」的一次性导演指令。仅在结局「刚命中的那一轮」发一次，走深度注入（贴近生成点）。
   * @param {string} endingName 结局名（endings[i].name）
   * @param {string} endingDesc 结局描述（endings[i].desc）
   * @returns {string} 无内容时返回空串
   */
  function buildEndingDirectiveBlock(endingName, endingDesc) {
    const name = trimStr(endingName) || '未命名结局';
    const desc = trimStr(endingDesc);
    if (!desc && !trimStr(endingName)) return '';
    const descLine = desc ? `\n${desc}` : '';
    return `【系统 · 结局降临】
执行员的行动已将本副本导向一个确定的结局。这一副本的故事从此刻起进入尾声，接下来的推演应当朝着这个结局收束：

——本副本走向的结局：${name}——${descLine}

请从本轮开始着手收尾：让未尽的冲突走向了结，让在场的人物迎来各自的落点，让笼罩全篇的悬念沉淀下来。不必在这一轮就仓促终结，但叙事的重心应当明确地从「展开」转向「收束」，把故事稳稳地带向这个结局。`;
  }

  /**
   * 拼「本副本的结局走向」常驻基调块，置于 System Prompt 底部。
   * 结局命中后每轮都拼，持续提醒 AI 朝结局收束。
   * @param {boolean} endingSettled 本条世界线是否已命中结局
   * @param {string} endingName 结局名
   * @param {string} endingDesc 结局描述
   * @returns {string} 未命中或无内容时返回空串，整块不拼
   */
  function buildEndingToneBlock(endingSettled, endingName, endingDesc) {
    if (!endingSettled) return '';
    const name = trimStr(endingName) || '未命名结局';
    const desc = trimStr(endingDesc);
    if (!desc && !trimStr(endingName)) return '';
    const descLine = desc ? `\n${desc}` : '';
    return `## 本副本的结局走向

本副本已进入尾声，故事正朝以下结局收束：

——${name}——${descLine}

你后续的每一轮推演都应服务于这个收尾方向：收拢仍未了结的线索，让人物走向他们的归宿，不要再开启与结局无关的新支线或新冲突。你可以从容地铺陈收尾过程，但整体走向必须始终朝着这个结局，直到故事自然抵达终点。`;
  }

  /* ================= 占位符替换 ================= */

  function replaceVars(tpl, vars) {
    let out = String(tpl || '');
    Object.keys(vars || {}).forEach((k) => {
      out = out.split('{{' + k + '}}').join(vars[k] == null ? '' : String(vars[k]));
    });
    return out;
  }

   /**
    * 拼装副本推演 System Prompt 的稳定主体（身份 + 说明 + 卷宗情报 + 执行员档案 + 输出格式）。
    * 现场 NPC/队友档案将在后续迭代中追加。
    *
    * 世界书注入：全局 + 副本（instance）分类无条件生效。
    * 顶部段 (top) 作为最高统领法则置于所有协议之前，底部段 (bottom) 追加至末尾。
    * 深度注入 (depthItems) 另由 buildDepthInjection 暴露，调用方在裁剪后落位。
    *
    * 注意：重写引导不在这里拼。它属于「高时效指令」，拼在 System Prompt 末尾会被
    * 后面几千字的历史流水冲散注意力（实测距生成点约六成全文长度）。
    * 改由 fork-run-api 在装配 messages 时插到最后一条执行员行动之前，紧贴生成点。
    *
    * @param {Object} [fork] 当前副本卷宗对象
    * @param {Object} [envoyCtx] 当前接入执行员身份（由 fork-run-ui 解析后传入）：
    *   { mode: 'persona'|'mask'|'locked', serial, name, gender, birthday, appearance, profile }
    * @param {Object} [openingCtx] 当前选定的开场套：{ openingId }
    *   由准备页手选后一路带进来；不传则按接入身份自动匹配。
    * @param {Array} [clueCtx] 当前解锁线索上下文
    * @param {Object} [truthCtx] 真相上下文 { truthUnlocked }
    * @param {Object} [endingCtx] 结局上下文 { endingSettled, endingId }
   * @param {Array} [scanMessages] 扫描用消息数组（尾部若干条 {role,content}），
     *   供世界书关键词判定。由调用方从 records 尾部凑出，不传则世界书只激活常驻条目。
     * @param {Object} [wbScope] 世界书作用域，供引擎书本级绑定过滤：
     *   { forkId: string, rosterIds: string[] }。不传则不做绑定过滤。
     * @param {Object} [missionCtx] 任务上下文 { unlockedIds, achievedIds }，
     *   决定主线任务块里列哪些任务、哪些标「已完成」。不传则全部任务都列。
     * @returns {string}
     */
    function buildSystemPrompt(fork, envoyCtx, openingCtx, clueCtx, truthCtx, endingCtx, scanMessages, wbScope, missionCtx) {
     const department = resolveDepartment(fork);

     const truth = (truthCtx && typeof truthCtx === 'object') ? truthCtx : {};
     const truthDesc = trimStr(fork && fork.hiddenTruth && fork.hiddenTruth.desc);

     // 结局常驻块：命中后每轮拼。按 endingCtx.endingId 从卷宗反查 name/desc
     const ending = (endingCtx && typeof endingCtx === 'object') ? endingCtx : {};
     let endingName = '';
     let endingDesc = '';
     if (ending.endingSettled) {
       const list = (fork && Array.isArray(fork.endings)) ? fork.endings : [];
       const hit = list.find((e) => e && trimStr(e.id) === trimStr(ending.endingId));
       if (hit) { endingName = trimStr(hit.name); endingDesc = trimStr(hit.desc); }
     }

     const sections = [
       IDENTITY,
       replaceVars(CANON, { DEPARTMENT: department }),
       buildForkDossierBlock(fork, envoyCtx, openingCtx, missionCtx),
       buildEnvoyBlock(envoyCtx),
       OUTPUT_FORMAT,
       buildActiveCluesBlock(clueCtx),
       buildRevealedTruthBlock(!!truth.truthUnlocked, truthDesc),
       buildEndingToneBlock(!!ending.endingSettled, endingName, endingDesc)
       // TODO: 现场 NPC/队友档案，逐块追加
     ];

     // 世界书注入：全局分类无条件生效，副本分类 (instance) 在推演中生效。
     // 顶部段置于所有协议之前作为最高统领法则，底部段追加至末尾。
     // wbScope 透传给引擎做书本级绑定过滤（副本绑定 / 角色绑定）。
     const msgs = Array.isArray(scanMessages) ? scanMessages : [];
     const scope = (wbScope && typeof wbScope === 'object') ? wbScope : undefined;
     const engine = (window.WorldBookEngine && typeof WorldBookEngine.buildInjection === 'function')
       ? WorldBookEngine
       : null;
     const wbGlobal = engine ? engine.buildInjection(msgs, 'global') : { top: '', bottom: '' };
     const wbInstance = engine ? engine.buildInjection(msgs, 'instance', scope) : { top: '', bottom: '' };

     // 副本段更贴近本场推演，排在全局法则之内侧
     if (wbInstance.top) sections.unshift(wbInstance.top);
     if (wbGlobal.top) sections.unshift(wbGlobal.top);

     // 底部段追加至末尾（全局在外侧、副本在内侧——底部更靠后的离生成点更近）
     if (wbGlobal.bottom) sections.push(wbGlobal.bottom);
     if (wbInstance.bottom) sections.push(wbInstance.bottom);

     return sections.filter(Boolean).join('\n\n');
   }

/**
     * 取副本推演的世界书深度注入条目（全局 + 副本分类）。
     * 深度注入必须在上下文裁剪之后插入消息数组，所以单独暴露给调用方，
     * 由 fork-run-api 在裁剪完成后调 WorldBookEngine.applyDepthInjection 落位。
     * @param {Array} [scanMessages] 扫描用消息数组，用于关键词判定
     * @param {Object} [wbScope] 世界书作用域 { forkId, rosterIds }
     * @returns {Array} depthItems
     */
    function buildDepthInjection(scanMessages, wbScope) {
      if (!window.WorldBookEngine || typeof WorldBookEngine.buildInjection !== 'function') return [];
      const msgs = Array.isArray(scanMessages) ? scanMessages : [];
      const scope = (wbScope && typeof wbScope === 'object') ? wbScope : undefined;
      const wbGlobal = WorldBookEngine.buildInjection(msgs, 'global');
      const wbInstance = WorldBookEngine.buildInjection(msgs, 'instance', scope);
      const globalItems = Array.isArray(wbGlobal.depthItems) ? wbGlobal.depthItems : [];
      const instanceItems = Array.isArray(wbInstance.depthItems) ? wbInstance.depthItems : [];
      return globalItems.concat(instanceItems);
    }

  /**
   * 重写引导指令块。仅在执行员触发重写且填写了引导方向时生成，
   * 用后即焚：只作用于本次推演请求，不写入流水、不污染后续世界线。
   *
   * 由 fork-run-api 作为独立 system 消息插在上下文末端（最后一条执行员行动之前），
   * 而不是拼进 System Prompt —— 高时效指令必须紧贴生成点才不会被历史冲散。
   *
   * @param {string} [rewriteHint] 执行员填写的调整方向
   * @returns {string} 指令块文本，无引导时返回空串
   */
  function buildRewriteDirectiveBlock(rewriteHint) {
    const hint = String(rewriteHint == null ? '' : rewriteHint).trim();
    if (!hint) return '';

    return `[重写指令 // REWRITE DIRECTIVE]
执行员对上一次回复不满意，要求重新调整。本轮演算请重点按以下方向调整展开，同时严格遵循所有格式契约与角色世界观：
${hint}`;
  }

  /* ================= 精神状态实时通知 =================
     深度注入，每轮贴生成点播报当前在场角色的精神值与对应档位的书写指引。
     与真相/结局导演指令不同：它不是一次性转折信号，每轮都发（实时态）。
     五档阈值对齐 PsychStore.getSanityStatus：
       良好 85-100 / 波动 60-84 / 衰弱 30-59 / 濒危 1-29 / 消亡 0。
     单个角色形如 { name, san, max, level }，level 为 PsychStore 判定的档 code
     （optimal/stable/warning/critical/deceased）；缺 level 时按 san 现算。
     list 为数组是为队友扩展预留：未来在场队友一并塞进来，同一条通知逐人列出。 */

  /** 由精神值现算档位 code（PsychStore 缺席时的兜底，阈值须与之保持一致） */
  function resolvePsychLevel(san) {
    const n = Math.max(0, Math.min(100, Math.round(Number(san) || 0)));
    if (n >= 85) return 'optimal';
    if (n >= 60) return 'stable';
    if (n >= 30) return 'warning';
    if (n >= 1) return 'critical';
    return 'deceased';
  }

  /**
   * 拼单个角色的精神状态段（不含通知头，供多角色循环复用）。
   * @param {Object} ent { name, san, max, level }
   * @returns {string}
   */
  function buildPsychEntrySegment(ent) {
    const e = ent || {};
    const name = trimStr(e.name) || '执行员';
    const san = Math.max(0, Math.min(Number(e.max) > 0 ? Number(e.max) : 100, Math.round(Number(e.san) || 0)));
    const max = Number(e.max) > 0 ? Math.round(Number(e.max)) : 100;
    const level = ['optimal', 'stable', 'warning', 'critical', 'deceased'].indexOf(e.level) >= 0
      ? e.level
      : resolvePsychLevel(san);

    const HINT_LIGHT = '书写提示：无需每一轮都刻意强调执行员的精神状态，让它自然融入剧情即可。';
    const HINT_HEAVY = '书写提示：无需每一轮都刻意强调执行员的精神状态。精神值不良并不意味着执行员时刻深陷负面情绪之中——他仍有清醒与自持的时刻。请把负面状态更多地体现为关键时刻对行动的戏剧化干扰，让它在恰当的节点自然浮现、影响剧情，而不是沦为每轮重复的状态说明。';
    const HINT_CRITICAL = '书写提示：无需每一轮都刻意强调执行员的精神状态。即便濒临崩溃，执行员也仍有短暂回神的间隙。请把负面状态更多地体现为关键时刻对行动的戏剧化干扰，让它在恰当的节点猛然浮现、扰乱剧情，而不是沦为每轮重复的状态说明。';

    if (level === 'optimal') {
      return `根据你上一次的回复，已确认【${name}】当前精神值为：${san} / ${max}（良好）。

此精神值下，执行员神志清明、情绪平稳，思维与判断不受干扰，能够冷静应对现场的压力与突发状况。

若精神值持续下降至 84 以下，将进入「波动」：届时执行员会开始感到疲惫与隐约的不安，情绪不再全然受控。

${HINT_LIGHT}`;
    }
    if (level === 'stable') {
      return `根据你上一次的回复，已确认【${name}】当前精神值为：${san} / ${max}（波动）。

此精神值下，执行员开始感到疲惫、心绪不宁，偶有烦躁或走神，但尚能自我克制，理智仍占上风。

若精神值持续下降至 59 以下，将进入「衰弱」：届时执行员的注意力将明显涣散，情绪愈发脆弱，感知开始出现偏差。

${HINT_LIGHT}`;
    }
    if (level === 'warning') {
      return `根据你上一次的回复，已确认【${name}】当前精神值为：${san} / ${max}（衰弱）。

此精神值下，执行员注意力涣散、情绪脆弱易怒，判断力下降，偶有短暂的感知偏差、耳鸣或恍惚，已难以维持长久的冷静。

若精神值持续下降至 29 以下，将进入「濒危」：届时执行员将出现明确的幻觉与被害妄想，手部颤抖难以持稳器物，理智濒临失控。

${HINT_HEAVY}`;
    }
    if (level === 'critical') {
      return `根据你上一次的回复，已确认【${name}】当前精神值为：${san} / ${max}（濒危）。

此精神值下，执行员已濒临崩溃：明确的幻觉与被害妄想交替袭来，四肢颤抖、呼吸紊乱，难以分辨现实与臆想，理智仅靠残存的意志勉强维系。

若精神值继续下降归零，执行员的灵魂体将彻底崩解，当场湮灭，不可挽回。

${HINT_CRITICAL}`;
    }
    // deceased
    return `根据你上一次的回复，已确认【${name}】当前精神值为：${san} / ${max}（消亡）。

执行员的精神值已归零，灵魂体正在崩解——意识溃散、自我瓦解，再无法维持任何清醒的思考或行动。

这是不可逆的终局：执行员已在此刻当场湮灭。请依此书写执行员精神彻底崩溃、灵魂消亡的结局，不必再考虑其后续行动。`;
  }

  /**
   * 拼「精神状态实时通知」深度注入块。
   * @param {Array<Object>} list 在场角色精神状态数组，本轮为执行员单人；未来队友一并传入
   * @returns {string} 无有效角色时返回空串
   */
  function buildPsychNoticeBlock(list) {
    const arr = (Array.isArray(list) ? list : []).filter((e) => e && trimStr(e.name));
    if (!arr.length) return '';
    const segments = arr.map(buildPsychEntrySegment).filter(Boolean);
    if (!segments.length) return '';
    return `[溯流系统实时通知：当前执行员精神状态]

${segments.join('\n\n———\n\n')}`;
  }

  /* ================= 公共接口 ================= */

  return {
    buildSystemPrompt,
    buildDepthInjection,
    buildRewriteDirectiveBlock,
    buildRevealedTruthBlock,
    buildTruthDirectiveBlock,
    buildMissionUnlockDirectiveBlock,
    buildEndingDirectiveBlock,
    buildEndingToneBlock,
    buildPsychNoticeBlock,
    resolveDepartment,
    buildForkDossierBlock,
    buildEnvoyBlock,
    resolveOpening,
    buildPrologueBlock,
    // 测试与调试用
    _internals: {
      IDENTITY,
      CANON,
      OUTPUT_FORMAT,
      DEPARTMENT_LABEL,
      LEVEL_DEFS,
      resolveLevel,
      collectAwakened,
      buildBackgroundBlock,
      buildLocationsBlock,
      buildNpcsBlock,
      buildAwakenedBlock,
      buildMissionsBlock,
      buildPrologueBlock,
      buildStatsBlock,
      buildEnvoyBlock,
      buildSerialAnchor,
      replaceVars
    }
  };
})();
