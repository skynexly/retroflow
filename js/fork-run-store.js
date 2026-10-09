/**
 * ============================================================================
 * 溯流计划 · 下潜存档层 (Fork Run Store)
 *
 * 副本推演的存档读写。与卷宗（fork 域）严格分离：
 *
 *   卷宗（fork/ 域）   静态定义，由编纂器维护，**推演永不改写它**
 *   存档（run/ 域）    每次游玩一份，互不干扰，可随时删除
 *
 * 卷宗被推演改写一次，这本副本就被玩坏了 —— 之后重开都是上次的残留。
 * 这条分层是从隔壁 skynex 的 gameplay/customAttrs 体系抄回来的，不要打破。
 *
 * 存储布局：
 *   run/index.{forkId}   索引：runId 列表 + 正史指针 canonicalRunId
 *   run/doc.{runId}      存档本体：状态、参与角色、进度、结算总结
 *   records 表           推演对话流水，forkId 字段用 `run:{runId}`
 *
 * 对话流水走 records 而不是 docs：那张表已有 forkId 索引与前缀查询
 * （Storage.getRecordsByForkPrefix），线上聊天用的就是同一套，不必另建机制。
 *
 * 状态机（详见《副本下潜设计.md》第二节）：
 *   active     进行中。记忆完全隔离，什么都不写给角色
 *   settled    已结算。完整可被承认的候选，但仍不写入角色
 *   abandoned  已放弃 / 通关失败。同样可被指定为正史
 *
 * 「正史」不是第四个状态，而是索引里的一个指针：canonicalRunId。
 * 记忆真正同步给角色的时机是**指定正史**，不是结算。
 *
 * 本轮只实现读侧与建档。结算、正史指针写入、记忆同步留到推演一期之后。
 * ============================================================================
 */
const ForkRunStore = (() => {
  'use strict';

  /** 存档状态枚举。存 key 不存中文，换文案不用迁数据 */
  const RUN_STATUS = {
    active: { zh: '进行中', en: 'ACTIVE' },
    settled: { zh: '已结算', en: 'SETTLED' },
    abandoned: { zh: '已放弃', en: 'ABANDONED' }
  };

  const STATUS_IDS = Object.keys(RUN_STATUS);

  /* ---------------- 键名 ---------------- */

  function indexKey(forkId) {
    return window.DataRegistry
      ? DataRegistry.key.runIndex(forkId)
      : `run/index.${forkId}`;
  }

  function docKey(runId) {
    return window.DataRegistry
      ? DataRegistry.key.runDoc(runId)
      : `run/doc.${runId}`;
  }

  const GLOBAL_ACTIVE_KEY = 'run/activeForkRef';

  /**
   * 记录系统当前最近处于活跃（active 进行中）状态的副本与下潜线引用。
   * 供桌面快捷 DIVE 入口秒回推演现场使用。
   */
  async function setOngoingActiveRef(forkId, runId) {
    if (!window.Storage || typeof Storage.setDoc !== 'function') return false;
    const fid = trimStr(forkId);
    const rid = trimStr(runId);
    if (!fid) {
      try { await Storage.removeDoc(GLOBAL_ACTIVE_KEY); } catch (_) {}
      return true;
    }
    return await Storage.setDoc(GLOBAL_ACTIVE_KEY, {
      forkId: fid,
      runId: rid,
      updatedAt: Date.now()
    });
  }

  /** 活跃线的新鲜度时间戳。推演每写一次流水都会推进 updatedAt，拿它排序最准 */
  function activeFreshness(run) {
    if (!run) return 0;
    return Number(run.updatedAt) || Number(run.createdAt) || 0;
  }

  /**
   * 从一批存档里挑出「最近活跃」的那条 active 线。
   * listRuns 是按 createdAt 倒序的，但执行员完全可能回到一条老线上继续推，
   * 所以只认 updatedAt —— 谁最后被写过，谁就是现场。
   */
  function pickFreshestActive(runs) {
    if (!Array.isArray(runs)) return null;
    let best = null;
    for (const run of runs) {
      if (!run || run.status !== 'active') continue;
      if (!best || activeFreshness(run) > activeFreshness(best)) best = run;
    }
    return best;
  }

  /**
   * 探测并返回当前「最近活跃」的那条进行中下潜线（status === 'active'）。
   *
   * 允许库里同时存在多条 active（多世界线并行是设定内核，不在这里做收敛），
   * 但桌面快捷 DIVE 的落点永远唯一：全库 updatedAt 最新的那条活跃线。
   * @returns {Promise<{ forkId: string, runId: string, run: Object } | null>}
   */
  async function findOngoingActiveFork() {
    if (!window.Storage || typeof Storage.getDoc !== 'function') return null;

    // 1. 扫全库活跃线，取最近被写过的那条
    let best = null;
    let bestForkId = '';

    if (window.Store && Store.fork && Array.isArray(Store.fork.index)) {
      for (const entry of Store.fork.index) {
        if (!entry || !entry.id) continue;
        try {
          const index = await getIndex(entry.id);
          if (!index || !Array.isArray(index.runIds) || index.runIds.length === 0) continue;
          const runs = await listRuns(entry.id);
          const freshest = pickFreshestActive(runs);
          if (freshest && (!best || activeFreshness(freshest) > activeFreshness(best))) {
            best = freshest;
            bestForkId = entry.id;
          }
        } catch (_) {}
      }
    }

    if (best) {
      // 顺手把全局指针校准到真正的最新现场
      setOngoingActiveRef(bestForkId, best.id).catch(() => {});
      return { forkId: bestForkId, runId: best.id, run: best };
    }

    // 2. 副本索引不可用时（Store 未就绪）才回落到全局指针
    try {
      const ref = await Storage.getDoc(GLOBAL_ACTIVE_KEY, null);
      if (ref && ref.forkId) {
        const runId = trimStr(ref.runId);
        if (runId) {
          const run = await getRun(runId);
          if (run && run.status === 'active' && run.forkId === ref.forkId) {
            return { forkId: ref.forkId, runId: run.id, run };
          }
        }
        const runs = await listRuns(ref.forkId);
        const activeRun = pickFreshestActive(runs);
        if (activeRun) {
          setOngoingActiveRef(ref.forkId, activeRun.id).catch(() => {});
          return { forkId: ref.forkId, runId: activeRun.id, run: activeRun };
        }
      }
    } catch (_) {}

    return null;
  }

  /**
   * 推演对话流水在 records 表里的分区键。
   * 用 `run:` 前缀与线上聊天的 `online:` 区分，前缀查询就能按线取全部对话。
   */
  function recordScope(runId) {
    return `run:${runId}`;
  }

  /* ---------------- 工具 ---------------- */

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /** 生成 runId。时间戳前缀让它天然按创建顺序可排，随机尾巴防同毫秒碰撞 */
  function makeRunId() {
    return `R${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * 索引结构归一化。
   * 老数据缺字段、或读到脏值时统一收敛成可用形状，调用侧不必到处判空。
   */
  function normalizeIndex(raw, forkId) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const runIds = Array.isArray(src.runIds)
      ? src.runIds.map(trimStr).filter(Boolean)
      : [];
    let canonicalRunId = trimStr(src.canonicalRunId);
    // 正史指向的存档若已被删除，指针必须失效，否则渲染时会挂在一条不存在的线上
    if (canonicalRunId && !runIds.includes(canonicalRunId)) canonicalRunId = '';
    // 上次活跃线指针：进本时默认续这条。与 canonicalRunId（正史）是两个独立指针。
    // 死引用同样失效，避免进本挂在一条已删的线上。
    let activeRunId = trimStr(src.activeRunId);
    if (activeRunId && !runIds.includes(activeRunId)) activeRunId = '';
    return {
      forkId: trimStr(src.forkId) || trimStr(forkId),
      runIds,
      canonicalRunId,
      activeRunId,
      updatedAt: Number(src.updatedAt) || 0
    };
  }

  /**
   * 存档本体归一化。
   *
   * `participants` 与锚点字段现在就留出来 —— 记忆库要靠它们做摘要与检索，
   * 事后再加意味着已有存档全没这些信息，只能对旧档降级处理。
   */
  function normalizeRun(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const status = STATUS_IDS.includes(src.status) ? src.status : 'active';
    return {
      id: trimStr(src.id),
      forkId: trimStr(src.forkId),
      status,
      // 这条线带了哪些角色。结算成正史时只给这些角色同步记忆，没去的不该知道
      participants: Array.isArray(src.participants)
        ? src.participants.map(trimStr).filter(Boolean)
        : [],
      // 进入副本时用的马甲（兼容旧字段）
      maskId: trimStr(src.maskId),
      // 身份索引：persona（本体）| mask（马甲）| preset / locked（副本预设锁定角色）
      identityType: (src.identityType === 'mask' || src.identityType === 'preset' || src.identityType === 'locked')
        ? src.identityType
        : (src.maskId ? 'mask' : 'persona'),
      identityId: trimStr(src.identityId) || trimStr(src.maskId),
      // 用户给这条线起的分支名（选填）。没起名时展示层回落到「分支 01/02...」默认名
      label: trimStr(src.label),
      // 推演轮次，也是对话流水的锚点之一
      turnCount: Number(src.turnCount) || 0,
      // 当前所在场景/地点 id，供记忆检索定位
      currentSceneId: trimStr(src.currentSceneId),
      // 已访问过的预设地点 id 集合（按世界线隔离，去重）。
      // 供解析度「地图」维度算点亮率；旧存档无此字段默认空数组，往后逐轮累积。
      visitedLocationIds: Array.isArray(src.visitedLocationIds)
        ? Array.from(new Set(src.visitedLocationIds.map(trimStr).filter(Boolean)))
        : [],
      // 开场首帧是否已注入过。
      // 不能靠「流水为空」来推断 —— 那样一条已经开过的空线，
      // 事后在卷宗里补写开场就永远注入不进来（真实踩过）。
      // 显式标记还顺带允许「先建线、后补开场」这种正常创作顺序。
      openingSeeded: !!src.openingSeeded,
      // 执行员在准备页手选的那套开场 id。
      // 老存档没有这个字段，读出来是空串 —— 提示词引擎会退回按当前身份
      // 自动匹配（专属优先、回落通用），与准备页同一套规则，不会串台。
      openingId: trimStr(src.openingId),
      // 结算总结。指定为正史后注入角色上下文的就是这段（引用式，不拷贝）
      summary: trimStr(src.summary),
      // 结局分支 id，走到哪个结局
      endingId: trimStr(src.endingId),
      // 结局收尾态（按世界线隔离）。结局有多条，第一个命中即定，此后不再命中新结局：
      //   endingId            已命中的结局 id（复用上面的字段，命中即写）
      //   endingSettled       是否已命中结局（进入尾声，剧情开始收束）
      //   endingSettledTurn   命中轮次（判断「是否本轮刚命中」，决定要不要发收尾导演指令）
      //   endingRecordId      命中发生在哪条 narration 记录上（收尾卡片重建靠它精准匹配）
      //   endingDirectiveSent 收尾导演指令是否已发过（一次性贴脸指令，只在命中后的下一轮请求发一次）
      endingSettled: !!src.endingSettled,
      endingSettledTurn: Number(src.endingSettledTurn) || 0,
      endingRecordId: trimStr(src.endingRecordId),
      endingDirectiveSent: !!src.endingDirectiveSent,
      // 线索推演态（按世界线隔离）。key 为线索 id，value 记录该线索在这条线的进度：
      //   status        'pending'（已触发，待亮出）| 'unlocked'（已正式解锁）
      //   triggeredTurn 命中触发的轮次（用于算剩余轮数、超时兜底判定）
      //   unlockedTurn  正式解锁的轮次
      //   unlockedBy    'ai'（AI 在正文亮出）| 'timeout'（超窗口机械兜底）
      clues: normalizeClueState(src.clues),
      // 任务推进态（按世界线隔离）。key 为任务 id（卷宗 clearConditions 的 id），value 记录：
      //   achieved      是否已完成（AI 在 ::: quest 块里以 [已完成] 回执过，持久不回退）
      //   achievedTurn  完成轮次
      //   noticePending 新解锁后是否仍需贴脸提示 AI（AI 回执过该任务即消）
      //   noticeTurn    解锁轮次（算贴脸提示的宽限窗口）
      missions: normalizeMissionState(src.missions),
      // 核心真相解明态（按世界线隔离）。真相只有一条、无 id，故用扁平字段而非 map：
      //   truthUnlocked        是否已解明（一触发即永久解锁，无 pending / 无亮出 / 无宽限）
      //   truthUnlockedTurn    解明轮次（用于判断「是否本轮刚解明」，决定要不要发导演指令）
      //   truthUnlockedRecordId 解明发生在哪条 narration 记录上（解明卡片重建靠它精准匹配）
      truthUnlocked: !!src.truthUnlocked,
      truthUnlockedTurn: Number(src.truthUnlockedTurn) || 0,
      truthUnlockedRecordId: trimStr(src.truthUnlockedRecordId),
      // 真相解明导演指令是否已发过（一次性贴脸转折指令，只在解明后的下一轮请求发一次，发完置真）
      truthDirectiveSent: !!src.truthDirectiveSent,
      // 世界书会话级覆写（按世界线隔离）。默认全空 = 完全遵从世界书自身开关；
      // 只记录「显式关闭」的 book / entry id（黑名单），世界书库新增内容无需重勾即自动生效。
      worldbookOverrides: normalizeWbOverrides(src.worldbookOverrides),
      createdAt: Number(src.createdAt) || 0,
      updatedAt: Number(src.updatedAt) || 0,
      settledAt: Number(src.settledAt) || 0
    };
  }

  /** 线索推演态归一化：保证是对象、逐条清脏值。老存档无此字段则回落空对象 */
  function normalizeClueState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const id = trimStr(key);
      if (!id) continue;
      const entry = src[key] && typeof src[key] === 'object' ? src[key] : {};
      const status = entry.status === 'unlocked' ? 'unlocked' : 'pending';
      const unlockedBy = (entry.unlockedBy === 'ai' || entry.unlockedBy === 'timeout')
        ? entry.unlockedBy
        : '';
      out[id] = {
        status,
        triggeredTurn: Number(entry.triggeredTurn) || 0,
        unlockedTurn: Number(entry.unlockedTurn) || 0,
        unlockedBy,
        // 解锁发生在哪条 narration 记录上。超时兜底重建卡片靠它匹配（比 turn 稳，不受删档/继续等口径漂移影响）。
        // 老存档没有 → 空串，重建时退回按 unlockedTurn 匹配。
        unlockedRecordId: trimStr(entry.unlockedRecordId)
      };
    }
    return out;
  }

  /** 任务推进态归一化：保证是对象、逐条清脏值。老存档无此字段则回落空对象 */
  function normalizeMissionState(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    for (const key of Object.keys(src)) {
      const id = trimStr(key);
      if (!id) continue;
      const entry = src[key] && typeof src[key] === 'object' ? src[key] : {};
      out[id] = {
        achieved: !!entry.achieved,
        achievedTurn: Number(entry.achievedTurn) || 0,
        achievedRecordId: trimStr(entry.achievedRecordId),
        // 新解锁后的贴脸提示：解锁当轮置真，AI 回执过该任务或超宽限窗口即消
        noticePending: !!entry.noticePending,
        noticeTurn: Number(entry.noticeTurn) || 0
      };
    }
    return out;
  }

  /**
   * 世界书会话覆写归一化：保证是 { disabledBookIds:[], disabledEntryIds:[] } 形状。
   * 只存显式关闭的 id（黑名单）；老存档无此字段则回落全空对象（= 全部遵从库自身开关）。
   */
  function normalizeWbOverrides(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const uniqStr = (arr) => (Array.isArray(arr) ? arr : [])
      .map(trimStr)
      .filter(Boolean)
      .filter((id, i, a) => a.indexOf(id) === i);
    return {
      disabledBookIds: uniqStr(src.disabledBookIds),
      disabledEntryIds: uniqStr(src.disabledEntryIds)
    };
  }

  /* ---------------- 索引读写 ---------------- */

  /** 读某副本的下潜索引。无记录时返回空壳而非 null，调用侧不必判空 */
  async function getIndex(forkId) {
    const id = trimStr(forkId);
    if (!id) return normalizeIndex(null, '');
    if (!window.Storage) return normalizeIndex(null, id);
    const raw = await Storage.getDoc(indexKey(id), null);
    return normalizeIndex(raw, id);
  }

  async function putIndex(index) {
    if (!window.Storage) return false;
    const next = normalizeIndex(index, index && index.forkId);
    if (!next.forkId) return false;
    next.updatedAt = Date.now();
    return await Storage.setDoc(indexKey(next.forkId), next);
  }

  /* ---------------- 存档读取 ---------------- */

  /** 读单条存档，不存在返回 null */
  async function getRun(runId) {
    const id = trimStr(runId);
    if (!id || !window.Storage) return null;
    const raw = await Storage.getDoc(docKey(id), null);
    if (!raw) return null;
    const run = normalizeRun(raw);
    return run.id ? run : null;
  }

  /**
   * 列出某副本的全部存档，按创建时间倒序（最近的在前）。
   *
   * 索引里存在但本体已丢失的 runId 会被跳过并从索引里剔除，
   * 避免列表渲染出一堆读不到内容的空条目。
   */
  async function listRuns(forkId) {
    const index = await getIndex(forkId);
    if (!index.runIds.length) return [];

    const runs = [];
    const missing = [];
    for (const runId of index.runIds) {
      const run = await getRun(runId);
      if (run) runs.push(run);
      else missing.push(runId);
    }

    // 自愈：清掉索引里的死引用
    if (missing.length) {
      const keep = index.runIds.filter((id) => !missing.includes(id));
      await putIndex({ ...index, runIds: keep });
    }

    return runs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  /** 存档条数。入口行的次数角标用它，不必拉全量本体 */
  async function countRuns(forkId) {
    const index = await getIndex(forkId);
    return index.runIds.length;
  }

  /** 读正史那条存档，没有则返回 null */
  async function getCanonicalRun(forkId) {
    const index = await getIndex(forkId);
    if (!index.canonicalRunId) return null;
    return await getRun(index.canonicalRunId);
  }

  /**
   * 卷宗详情要用的汇总。一次读完，省得 UI 侧连着发三次查询。
   * @returns {Promise<{total:number, active:number, settled:number, abandoned:number, canonicalRunId:string, canonicalStatus:string}>}
   */
  async function getForkRunSummary(forkId) {
    const index = await getIndex(forkId);
    const runs = await listRuns(forkId);
    const tally = { active: 0, settled: 0, abandoned: 0 };
    runs.forEach((r) => {
      if (tally[r.status] !== undefined) tally[r.status] += 1;
    });
    const canonical = index.canonicalRunId
      ? runs.find((r) => r.id === index.canonicalRunId) || null
      : null;
    return {
      total: runs.length,
      active: tally.active,
      settled: tally.settled,
      abandoned: tally.abandoned,
      canonicalRunId: canonical ? canonical.id : '',
      canonicalStatus: canonical ? canonical.status : ''
    };
  }

  /* ---------------- 建档与删除 ---------------- */

  /**
   * 新建一条下潜线。
   *
   * 允许同一副本存在多条 active —— 用户要「多条线一起跑最后才选喜欢哪个」。
   * 这些线本就是未被承认的因果分支，是可能性而非现实，并行不矛盾。
   *
   * @param {string} forkId 卷宗 id
   * @param {Object} [opts]
   * @param {string[]} [opts.participants] 同行角色 id 列表
   * @param {string} [opts.maskId] 使用的马甲 id（兼容旧参数）
   * @param {string} [opts.identityType] 身份类别 ('persona' | 'mask' | 'preset' | 'locked')
   * @param {string} [opts.identityId] 身份对应 ID
   * @param {Object} [opts.identity] 完整的准备页所选身份对象
   * @returns {Promise<Object|null>} 新建的存档，失败返回 null
   */
  async function createRun(forkId, opts) {
    const fid = trimStr(forkId);
    if (!fid || !window.Storage) return null;

    const optIdentity = opts && opts.identity ? opts.identity : null;
    const resolvedType = trimStr(opts && opts.identityType)
      || trimStr(optIdentity && optIdentity.type)
      || (opts && opts.maskId ? 'mask' : 'persona');
    const resolvedId = trimStr(opts && opts.identityId)
      || trimStr(optIdentity && optIdentity.id)
      || trimStr(opts && opts.maskId);

    const now = Date.now();
    const run = normalizeRun({
      id: makeRunId(),
      forkId: fid,
      status: 'active',
      participants: opts && opts.participants,
      maskId: resolvedType === 'mask' ? resolvedId : (opts && opts.maskId),
      identityType: resolvedType,
      identityId: resolvedId,
      createdAt: now,
      updatedAt: now
    });

    const ok = await Storage.setDoc(docKey(run.id), run);
    if (!ok) return null;

    const index = await getIndex(fid);
    // 新的排在前面，与 listRuns 的倒序一致。新建即成为当前活跃线。
    const written = await putIndex({
      ...index,
      forkId: fid,
      runIds: [run.id, ...index.runIds.filter((id) => id !== run.id)],
      activeRunId: run.id
    });
    if (!written) {
      // 索引没写进去就回滚本体，避免留下索引外的孤儿存档
      await Storage.removeDoc(docKey(run.id));
      return null;
    }
    return run;
  }

  /**
   * 更新存档字段。只覆盖传入的键，其余保持原样。
   * 存档不存在时返回 null，绝不「顺手创建」—— 那会掩盖调用侧的 id 错误。
   */
  async function updateRun(runId, patch) {
    const existing = await getRun(runId);
    if (!existing || !window.Storage) return null;
    const next = normalizeRun({
      ...existing,
      ...(patch && typeof patch === 'object' ? patch : {}),
      id: existing.id,
      forkId: existing.forkId,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    });
    const ok = await Storage.setDoc(docKey(next.id), next);
    return ok ? next : null;
  }

  /* ---------------- 线索推演态写入 ---------------- */

  /**
   * 标记某条线索在这条世界线「已触发」（进入待亮出）。
   * 幂等：已有记录（无论 pending 还是 unlocked）一律不覆盖，触发只认第一次。
   * @param {string} runId
   * @param {string} clueId
   * @param {number} turn 命中触发的轮次
   * @returns {Promise<Object|null>} 更新后的存档，无变化或失败返回 null
   */
  async function markClueTriggered(runId, clueId, turn) {
    const cid = trimStr(clueId);
    if (!cid) return null;
    const existing = await getRun(runId);
    if (!existing) return null;
    const clues = existing.clues || {};
    if (clues[cid]) return null; // 已触发过，触发只认第一次
    const nextClues = {
      ...clues,
      [cid]: {
        status: 'pending',
        triggeredTurn: Number(turn) || 0,
        unlockedTurn: 0,
        unlockedBy: ''
      }
    };
    return await updateRun(runId, { clues: nextClues });
  }

  /**
   * 标记某条线索「已正式解锁」（AI 亮出或超时兜底）。
   * 幂等：已解锁的不重复写。未触发过的线索直接解锁也允许（写入 triggered/unlocked 同轮）。
   * @param {string} runId
   * @param {string} clueId
   * @param {number} turn 解锁轮次
   * @param {'ai'|'timeout'} by 解锁来源
   * @param {string} [recordId] 解锁发生在哪条 narration 记录上（超时兜底重建卡片靠它匹配，比 turn 稳）
   * @returns {Promise<Object|null>} 更新后的存档，无变化或失败返回 null
   */
  async function markClueUnlocked(runId, clueId, turn, by, recordId) {
    const cid = trimStr(clueId);
    if (!cid) return null;
    const existing = await getRun(runId);
    if (!existing) return null;
    const clues = existing.clues || {};
    const prev = clues[cid];
    if (prev && prev.status === 'unlocked') return null; // 已解锁，不重复
    const unlockedBy = (by === 'ai' || by === 'timeout') ? by : 'ai';
    const nextClues = {
      ...clues,
      [cid]: {
        status: 'unlocked',
        triggeredTurn: prev ? prev.triggeredTurn : (Number(turn) || 0),
        unlockedTurn: Number(turn) || 0,
        unlockedBy,
        unlockedRecordId: trimStr(recordId)
      }
    };
    return await updateRun(runId, { clues: nextClues });
  }

  /**
   * 标记某项主线任务「已完成」（AI 在 ::: quest 块里以 [已完成] 回执）。
   * 幂等：已完成的不重复写，完成态持久、不随某轮漏输出回退。
   * 同时清掉该任务的新解锁贴脸提示（AI 已经知道它了）。
   * @param {string} runId
   * @param {string} missionId 卷宗 clearConditions 的任务 id
   * @param {number} turn 完成轮次
   * @param {string} [recordId] 完成发生在哪条 narration 记录上
   * @returns {Promise<Object|null>} 更新后的存档，无变化或失败返回 null
   */
  async function markMissionAchieved(runId, missionId, turn, recordId) {
    const mid = trimStr(missionId);
    if (!mid) return null;
    const existing = await getRun(runId);
    if (!existing) return null;
    const missions = existing.missions || {};
    const prev = missions[mid];
    if (prev && prev.achieved) return null; // 已完成，不重复
    const nextMissions = {
      ...missions,
      [mid]: {
        achieved: true,
        achievedTurn: Number(turn) || 0,
        achievedRecordId: trimStr(recordId),
        noticePending: false,
        noticeTurn: prev ? (Number(prev.noticeTurn) || 0) : 0
      }
    };
    return await updateRun(runId, { missions: nextMissions });
  }

  /**
   * 批量落盘任务态补丁（新解锁贴脸标记置位 / 消除、宽限到期静默等）。
   * 与 markMissionAchieved 分开：那条只管「完成」这一件不可逆的事，
   * 这条管 noticePending 这类会反复开关的辅助标记。
   * @param {string} runId
   * @param {Object} patchMap { [missionId]: { noticePending?, noticeTurn? } }
   * @returns {Promise<Object|null>}
   */
  async function patchMissionState(runId, patchMap) {
    const src = patchMap && typeof patchMap === 'object' ? patchMap : {};
    const ids = Object.keys(src).map(trimStr).filter(Boolean);
    if (!ids.length) return null;
    const existing = await getRun(runId);
    if (!existing) return null;
    const missions = { ...(existing.missions || {}) };
    for (const id of ids) {
      const prev = missions[id] || {};
      const patch = src[id] && typeof src[id] === 'object' ? src[id] : {};
      missions[id] = {
        achieved: ('achieved' in patch) ? !!patch.achieved : !!prev.achieved,
        achievedTurn: ('achievedTurn' in patch) ? (Number(patch.achievedTurn) || 0) : (Number(prev.achievedTurn) || 0),
        achievedRecordId: ('achievedRecordId' in patch) ? trimStr(patch.achievedRecordId) : trimStr(prev.achievedRecordId),
        noticePending: ('noticePending' in patch) ? !!patch.noticePending : !!prev.noticePending,
        noticeTurn: ('noticeTurn' in patch) ? (Number(patch.noticeTurn) || 0) : (Number(prev.noticeTurn) || 0)
      };
    }
    return await updateRun(runId, { missions });
  }

  /**
   * 标记本条世界线的核心真相「已解明」（一触发即永久解锁）。
   * 幂等：已解明的不重复写（返回 null），保证 truthUnlockedTurn/RecordId 只认第一次解明。
   * @param {string} runId
   * @param {number} turn 解明轮次
   * @param {string} [recordId] 解明发生在哪条 narration 记录上（解明卡片重建靠它匹配）
   * @returns {Promise<Object|null>} 更新后的存档，无变化或失败返回 null
   */
  async function markTruthUnlocked(runId, turn, recordId) {
    const existing = await getRun(runId);
    if (!existing) return null;
    if (existing.truthUnlocked) return null; // 已解明，永久解锁只认第一次
    return await updateRun(runId, {
      truthUnlocked: true,
      truthUnlockedTurn: Number(turn) || 0,
      truthUnlockedRecordId: trimStr(recordId)
    });
  }

  /**
   * 标记本条世界线「已命中结局」（多结局，第一个命中即定，此后不再命中新结局）。
   * 幂等：已命中的不重复写（返回 null），保证 endingId/轮次/记录只认第一次命中。
   * @param {string} runId
   * @param {string} endingId 命中的结局 id
   * @param {number} turn 命中轮次
   * @param {string} [recordId] 命中发生在哪条 narration 记录上（收尾卡片重建靠它匹配）
   * @returns {Promise<Object|null>} 更新后的存档，无变化或失败返回 null
   */
  async function markEndingSettled(runId, endingId, turn, recordId) {
    const eid = trimStr(endingId);
    if (!eid) return null;
    const existing = await getRun(runId);
    if (!existing) return null;
    if (existing.endingSettled) return null; // 已命中结局，只认第一次
    return await updateRun(runId, {
      endingId: eid,
      endingSettled: true,
      endingSettledTurn: Number(turn) || 0,
      endingRecordId: trimStr(recordId)
    });
  }

  /**
   * 回溯世界线状态：把「解锁线索 / 解明真相 / 命中结局」这些落在存档里的持久标记，
   * 随流水记录一起回滚，让世界线状态与被删掉的剧情保持一致。
   *
   * 判定基准：优先按 recordId 命中（unlockedRecordId / truthUnlockedRecordId /
   * endingRecordId 落在 deletedRecordIds 集合里即回滚）；该字段为空的老存档，
   * 退回按 turn 比较（对应轮次 > survivingMaxTurn 即回滚）。
   *
   * 关于「清空世界线」这一档：survivingMaxTurn 为 0 意味着回溯后已不剩任何带轮次的
   * 叙事（整条线被删空或只剩开场）。此时若仍用 turn > 0 判定，早期档里 unlockedTurn
   * 本身就是 0 的解锁状态会永远判不中 —— 剧情全删了真相却还挂着已解明。
   * 故该档位下把所有「无 recordId 可依据」的状态一律回滚，宁可多退不可留脏。
   *
   * 回滚口径：
   *   - 线索：命中即删除整个 key（回到完全未触发态），pending 与 unlocked 一视同仁。
   *   - 真相：命中则 truthUnlocked=false、轮次/recordId 清零，并清掉 truthDirectiveSent
   *           （否则重新解明时那条一次性导演指令不再发，转折演出会缺失）。
   *   - 结局：命中则 endingSettled=false、endingId/轮次/recordId 清零，并清掉
   *           endingDirectiveSent（理由同真相）。
   *
   * 地点探访（visitedLocationIds）本轮不回滚：它是纯 id 数组、未记录轮次/recordId，
   * 无法精准判定，留待后续为其补齐溯源信息再单独处理。
   *
   * @param {string} runId
   * @param {string[]} deletedRecordIds 本次被删除的记录 id 集合
   * @param {number} survivingMaxTurn 回溯后仍存活的最大轮次（老存档缺 recordId 时的兜底阈值）
   * @returns {Promise<Object|null>} 更新后的存档；无任何字段需要回滚或失败返回 null
   */
  async function rollbackStatesByRecordIds(runId, deletedRecordIds, survivingMaxTurn) {
    const existing = await getRun(runId);
    if (!existing) return null;

    const deletedSet = new Set((Array.isArray(deletedRecordIds) ? deletedRecordIds : [])
      .map(trimStr)
      .filter(Boolean));
    const survTurn = Number(survivingMaxTurn) || 0;
    // 世界线已被清空到不剩任何带轮次的叙事：无 recordId 的状态全部作废。
    // 必须同时要求确有记录被删，否则空集合调用会误清一条完好世界线的状态。
    const wipedToStart = survTurn <= 0 && deletedSet.size > 0;

    // 命中判定：recordId 在被删集合里 → 命中；
    // recordId 为空 → 退回按 turn 比较，清空档位下无条件命中。
    const hit = (recordId, turn) => {
      const rid = trimStr(recordId);
      if (rid) return deletedSet.has(rid);
      if (wipedToStart) return true;
      return (Number(turn) || 0) > survTurn;
    };

    const patch = {};
    let changed = false;

    // 1. 线索：命中即删整个 key，回到完全未触发态。
    const clues = existing.clues || {};
    const nextClues = {};
    let clueChanged = false;
    for (const cid of Object.keys(clues)) {
      const entry = clues[cid] || {};
      // 解锁态按 unlockedRecordId/unlockedTurn 判；仅触发未解锁的按 triggeredTurn 判。
      const rolled = entry.status === 'unlocked'
        ? hit(entry.unlockedRecordId, entry.unlockedTurn)
        : hit('', entry.triggeredTurn);
      if (rolled) {
        clueChanged = true; // 命中：整条 key 丢弃
      } else {
        nextClues[cid] = entry;
      }
    }
    if (clueChanged) {
      patch.clues = nextClues;
      changed = true;
    }
    // 1.5 任务：完成态按 achievedRecordId/achievedTurn 判，命中即删整个 key
    //      （回到未完成态，连带清掉贴脸提示标记——重新解锁时会重新置位）。
    const missions = existing.missions || {};
    const nextMissions = {};
    let missionChanged = false;
    for (const mid of Object.keys(missions)) {
      const entry = missions[mid] || {};
      const rolled = entry.achieved
        ? hit(entry.achievedRecordId, entry.achievedTurn)
        : hit('', entry.noticeTurn);
      if (rolled) {
        missionChanged = true;
      } else {
        nextMissions[mid] = entry;
      }
    }
    if (missionChanged) {
      patch.missions = nextMissions;
      changed = true;
    }

    // 2. 真相：命中则整体退回未解明，并清掉一次性导演指令标记。
    if (existing.truthUnlocked && hit(existing.truthUnlockedRecordId, existing.truthUnlockedTurn)) {
      patch.truthUnlocked = false;
      patch.truthUnlockedTurn = 0;
      patch.truthUnlockedRecordId = '';
      patch.truthDirectiveSent = false;
      changed = true;
    }

    // 3. 结局：命中则退回未收尾，并清掉一次性导演指令标记。
    if (existing.endingSettled && hit(existing.endingRecordId, existing.endingSettledTurn)) {
      patch.endingSettled = false;
      patch.endingId = '';
      patch.endingSettledTurn = 0;
      patch.endingRecordId = '';
      patch.endingDirectiveSent = false;
      changed = true;
    }

    if (!changed) return null;
    return await updateRun(runId, patch);
  }

  /**
   * 删除一条下潜线：存档本体 + 对话流水 + 索引条目，一并清掉，当无事发生。
   *
   * 若删的正是正史，指针一并清空（normalizeIndex 也会兜这层，双保险）。
   * @returns {Promise<boolean>}
   */
  async function deleteRun(runId) {
    const id = trimStr(runId);
    if (!id || !window.Storage) return false;

    const run = await getRun(id);
    const forkId = run ? run.forkId : '';

    try {
      if (typeof Storage.removeRecordsByForkPrefix === 'function') {
        await Storage.removeRecordsByForkPrefix(recordScope(id));
      }
    } catch (err) {
      console.warn('[ForkRunStore] 清理推演流水失败：', id, err);
    }

    await Storage.removeDoc(docKey(id));

    if (forkId) {
      const index = await getIndex(forkId);
      await putIndex({
        ...index,
        runIds: index.runIds.filter((x) => x !== id),
        canonicalRunId: index.canonicalRunId === id ? '' : index.canonicalRunId
      });
    }
    return true;
  }

  /**
   * 删除某副本的全部下潜记录。副本被删除时级联调用。
   * @returns {Promise<number>} 删除条数
   */
  async function deleteRunsByFork(forkId) {
    const index = await getIndex(forkId);
    if (!index.runIds.length) {
      if (window.Storage) await Storage.removeDoc(indexKey(trimStr(forkId)));
      return 0;
    }
    let removed = 0;
    for (const runId of [...index.runIds]) {
      const ok = await deleteRun(runId);
      if (ok) removed += 1;
    }
    if (window.Storage) await Storage.removeDoc(indexKey(trimStr(forkId)));
    return removed;
  }

  /* ---------------- 对话流水 ---------------- */

  /** 读某条下潜线的全部对话，按时间正序 */
  async function getRunRecords(runId) {
    const id = trimStr(runId);
    if (!id || !window.Storage) return [];
    if (typeof Storage.getRecordsByForkPrefix !== 'function') return [];
    return await Storage.getRecordsByForkPrefix(recordScope(id));
  }

  /**
   * 追加一条推演流水。
   *
   * 存档状态与推演内容一起动：写入成功后顺手把 updatedAt 推进，
   * 否则下潜记录列表按 updatedAt 排序时，跑得最勤的那条线反而排在后面。
   * turn 只在叙事条目上带（一轮 = 一段叙事），执行员行动不单独占轮次。
   *
   * @param {string} runId
   * @param {Object} rec
   * @param {'envoy'|'narration'} rec.role
   * @param {string} rec.content
   * @param {number} [rec.turn] 轮次，叙事条目用
   * @param {Array} [rec.status] 状态栏读数项，随叙事一起存
   * @param {string} [rec.name] 署名，执行员行动用
   * @returns {Promise<Object|null>} 落库后的记录，失败返回 null
   */
  async function appendRunRecord(runId, rec) {
    const id = trimStr(runId);
    if (!id || !window.Storage || typeof Storage.putRecord !== 'function') return null;

    const now = Date.now();
    const record = {
      // records 表要求显式 id：时间戳 + 随机尾巴，与 runId 同一套生成规则
      id: `RR${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      forkId: recordScope(id),
      role: rec && rec.role === 'envoy' ? 'envoy' : 'narration',
      content: typeof (rec && rec.content) === 'string' ? rec.content : '',
      createdAt: now
    };
    if (rec && Number(rec.turn)) record.turn = Number(rec.turn);
    if (rec && Array.isArray(rec.status)) record.status = rec.status;
    if (rec && trimStr(rec.name)) record.name = trimStr(rec.name);
    if (rec && Array.isArray(rec.images)) record.images = rec.images;
    if (rec && Array.isArray(rec.files)) record.files = rec.files;

    try {
      await Storage.putRecord(record);
    } catch (err) {
      console.warn('[ForkRunStore] 推演流水写入失败：', id, err);
      return null;
    }

    // 存档时间戳推进失败不回滚流水：内容已经落住了，
    // 排序错位是可修的显示问题，丢内容不是。
    //
    // turnCount 只许前进不许后退：显示用的轮号由 UI 按流水顺序现算并校准，
    // 这里若无条件覆盖，一条补写的旧轮记录就会把校准过的值拽回去。
    const patch = { updatedAt: now };
    if (record.turn) {
      let baseTurn = 0;
      try {
        const cur = await getRun(id);
        baseTurn = cur ? Number(cur.turnCount) || 0 : 0;
      } catch (_) { /* 读不到就按 0 起算 */ }
      patch.turnCount = Math.max(baseTurn, record.turn);
    }
    try { await updateRun(id, patch); } catch (_) { /* ignore */ }

    return record;
  }

  /**
   * 更新一条已存在的推演流水（用户手动编辑气泡走这里）。
   *
   * records 的 putRecord 按 record.id 做 upsert，所以更新 = 读回原 record、
   * 打补丁、用同一个 id 重新 put。找不到 recordId 返回 null，不新建。
   *
   * @param {string} runId 所属下潜线
   * @param {string} recordId 目标流水 id
   * @param {Object} patch 允许改的字段（目前主要是 content）
   * @returns {Promise<Object|null>} 更新后的记录，失败返回 null
   */
  async function updateRunRecord(runId, recordId, patch) {
    const rid = trimStr(runId);
    const recId = trimStr(recordId);
    if (!rid || !recId || !window.Storage || typeof Storage.putRecord !== 'function') return null;

    const records = await getRunRecords(rid);
    const target = Array.isArray(records) ? records.find((r) => r && r.id === recId) : null;
    if (!target) return null;

    const next = { ...target };
    if (patch && typeof patch.content === 'string') next.content = patch.content;
    if (patch && Array.isArray(patch.variants)) next.variants = patch.variants;
    if (patch && typeof patch.activeVariantIndex === 'number') next.activeVariantIndex = patch.activeVariantIndex;
    // 附图清单（含识图后回填的 visionDescription）整体替换，不做逐项合并：
    // 调用方手上本来就是完整清单，合并只会在图被删掉时留下幽灵条目。
    if (patch && Array.isArray(patch.images)) next.images = patch.images;
    if (patch && Array.isArray(patch.files)) next.files = patch.files;

    try {
      await Storage.putRecord(next);
    } catch (err) {
      console.warn('[ForkRunStore] 推演流水更新失败：', rid, recId, err);
      return null;
    }

    // 内容动了，存档时间戳跟着推进，保持列表排序新鲜
    try { await updateRun(rid, { updatedAt: Date.now() }); } catch (_) { /* ignore */ }

    return next;
  }

  /**
   * 删除一条推演流水（气泡菜单的删除走这里）。
   *
   * 删前先校验该记录确实属于这条线：recordId 是全局唯一的，直接删会让
   * 传错 runId 的调用悄悄删掉别条线的记录，这种错很难查。
   *
   * 只删这一条，不连带同轮的另一条 —— 用户点的是「删除这条」，
   * 整段砍由「回溯到此」负责，两者职责分开。
   *
   * turnCount 不回退：轮次是单调递增的时间戳语义，回退会让新记录
   * 与已删记录撞上同一个轮号，回看时反而更乱。跳号只是显示不连续，无害。
   *
   * @param {string} runId 所属下潜线
   * @param {string} recordId 目标流水 id
   * @returns {Promise<boolean>} 是否删除成功
   */
  async function deleteRunRecord(runId, recordId) {
    const rid = trimStr(runId);
    const recId = trimStr(recordId);
    if (!rid || !recId || !window.Storage || typeof Storage.removeRecord !== 'function') return false;

    const records = await getRunRecords(rid);
    const target = Array.isArray(records) ? records.find((r) => r && r.id === recId) : null;
    // 不属于这条线（或已经不存在）：不删，让调用方按失败处理
    if (!target) return false;

    try {
      await Storage.removeRecord(recId);
    } catch (err) {
      console.warn('[ForkRunStore] 推演流水删除失败：', rid, recId, err);
      return false;
    }

    // 流水动了，存档时间戳跟着推进，保持列表排序新鲜
    try { await updateRun(rid, { updatedAt: Date.now() }); } catch (_) { /* ignore */ }

    return true;
  }

  /**
   * 给一条线改分支名。选填，传空即清空回落到默认名。
   * @param {string} runId 目标下潜线
   * @param {string} label 新分支名（会被 trim；超 30 字截断防溢出）
   * @returns {Promise<Object|null>} 更新后的存档，失败返回 null
   */
  async function renameRun(runId, label) {
    const clean = trimStr(label).slice(0, 30);
    return await updateRun(runId, { label: clean });
  }

  /**
   * 记录某副本「上次活跃在跑的线」。进本默认续这条。
   * 传入的 runId 不在索引内则不写（防止指到不存在的线）。
   * @param {string} forkId 卷宗 id
   * @param {string} runId 目标下潜线
   * @returns {Promise<boolean>}
   */
  async function setActiveRun(forkId, runId) {
    const fid = trimStr(forkId);
    const rid = trimStr(runId);
    if (!fid || !rid) return false;
    const index = await getIndex(fid);
    if (!index.runIds.includes(rid)) return false;
    if (index.activeRunId === rid) return true;
    return await putIndex({ ...index, activeRunId: rid });
  }

  /**
   * 取一条线的展示名。
   * 用户起了名就用用户的；没起名按「这条线在本副本里的建线顺序」回落到「分支 01/02...」。
   *
   * 建线序号语义：最早创建的是「分支 01」。listRuns 是倒序（新→旧），
   * 所以序号 = 该副本总线数 - 在倒序列表中的下标。
   *
   * @param {Object} run 目标存档
   * @param {Object[]} allRuns 同副本的全部存档（listRuns 的倒序结果）
   * @returns {string}
   */
  function getRunDisplayLabel(run, allRuns) {
    if (!run) return '分支 01';
    const custom = trimStr(run.label);
    if (custom) return custom;

    const list = Array.isArray(allRuns) ? allRuns : [];
    const idx = list.findIndex((r) => r && r.id === run.id);
    // 找得到就按倒序位置反推建线序号；找不到（脱离列表单查）兜个 01
    const ordinal = idx >= 0 ? (list.length - idx) : 1;
    return `分支 ${String(ordinal).padStart(2, '0')}`;
  }

  /**
   * 切换叙事记录的分支回复版本（Variants 翻页）。
   * 将当前生效的 content 替换为目标版本的 content，并更新 activeVariantIndex。
   *
   * @param {string} runId 所属下潜线
   * @param {string} recordId 目标流水 id
   * @param {number} targetIndex 目标版本下标
   * @returns {Promise<Object|null>} 更新后的记录，失败返回 null
   */
  async function switchRunRecordVariant(runId, recordId, targetIndex) {
    const rid = trimStr(runId);
    const recId = trimStr(recordId);
    const idx = Number(targetIndex);
    if (!rid || !recId || isNaN(idx) || !window.Storage || typeof Storage.putRecord !== 'function') return null;

    const records = await getRunRecords(rid);
    const target = Array.isArray(records) ? records.find((r) => r && r.id === recId) : null;
    if (!target) return null;

    // 若目标记录尚未初始化 variants，自动以当前 content 建立第一版
    let variants = Array.isArray(target.variants) && target.variants.length > 0
      ? target.variants
      : [{ content: target.content || '', createdAt: target.createdAt || Date.now() }];

    if (idx < 0 || idx >= variants.length) return null;

    const next = {
      ...target,
      variants,
      activeVariantIndex: idx,
      content: variants[idx].content
    };

    try {
      await Storage.putRecord(next);
    } catch (err) {
      console.warn('[ForkRunStore] 分支回复切换失败：', rid, recId, err);
      return null;
    }

    try { await updateRun(rid, { updatedAt: Date.now() }); } catch (_) { /* ignore */ }
    return next;
  }

  /**
   * 删除叙事记录的某个分支回复版本。
   * 仅在 variants 数量大于 1 时允许删除。删除后自动重定位 activeVariantIndex，
   * 并将 content 同步为新定位版本的 content。
   *
   * @param {string} runId 所属下潜线
   * @param {string} recordId 目标流水 id
   * @param {number} targetIndex 要删除的分支版本下标
   * @returns {Promise<Object|null>} 更新后的记录，失败返回 null
   */
  async function deleteRunRecordVariant(runId, recordId, targetIndex) {
    const rid = trimStr(runId);
    const recId = trimStr(recordId);
    const idx = Number(targetIndex);
    if (!rid || !recId || isNaN(idx) || !window.Storage || typeof Storage.putRecord !== 'function') return null;

    const records = await getRunRecords(rid);
    const target = Array.isArray(records) ? records.find((r) => r && r.id === recId) : null;
    if (!target) return null;

    let variants = Array.isArray(target.variants) && target.variants.length > 0
      ? target.variants.slice()
      : [{ content: target.content || '', createdAt: target.createdAt || Date.now() }];

    if (variants.length <= 1) {
      // 只有一个版本时不属于分支删除范畴
      return null;
    }

    if (idx < 0 || idx >= variants.length) return null;

    // 移除目标版本
    variants.splice(idx, 1);

    // 计算新的 activeVariantIndex
    let currentActive = typeof target.activeVariantIndex === 'number' ? target.activeVariantIndex : 0;
    let nextActive = currentActive;
    if (currentActive === idx) {
      nextActive = Math.min(idx, variants.length - 1);
    } else if (currentActive > idx) {
      nextActive = currentActive - 1;
    }
    nextActive = Math.max(0, Math.min(nextActive, variants.length - 1));

    const next = {
      ...target,
      variants,
      activeVariantIndex: nextActive,
      content: (variants[nextActive] && variants[nextActive].content) || ''
    };

    try {
      await Storage.putRecord(next);
    } catch (err) {
      console.warn('[ForkRunStore] 分支回复删除失败：', rid, recId, err);
      return null;
    }

    try { await updateRun(rid, { updatedAt: Date.now() }); } catch (_) { /* ignore */ }
    return next;
  }

  return {
    RUN_STATUS,
    STATUS_IDS,
    recordScope,
    getIndex,
    getRun,
    listRuns,
    countRuns,
    getCanonicalRun,
    getForkRunSummary,
    createRun,
    updateRun,
    markClueTriggered,
    markClueUnlocked,
    markMissionAchieved,
    patchMissionState,
    markTruthUnlocked,
    markEndingSettled,
    rollbackStatesByRecordIds,
    renameRun,
    setActiveRun,
    setOngoingActiveRef,
    findOngoingActiveFork,
    getRunDisplayLabel,
    deleteRun,
    deleteRunsByFork,
    getRunRecords,
    appendRunRecord,
    updateRunRecord,
    switchRunRecordVariant,
    deleteRunRecordVariant,
    deleteRunRecord
  };
})();

window.ForkRunStore = ForkRunStore;