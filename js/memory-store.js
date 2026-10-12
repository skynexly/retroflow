/**
 * ============================================================================
 * 溯流计划 · 记忆库存取模块 (MemoryStore)
 *
 * 设计依据：design/记忆库架构与事件记忆规范.md
 * 底层通道：Storage.putMemory / getMemoriesByIndex（IndexedDB memories store）
 *
 * 职责：
 *   1. 事件记忆的写入（候选）与读取（正史/候选池分流）；
 *   2. 关键词、在场角色的反查检索；
 *   3. 正史过滤：结合 ForkRunStore 索引的 canonicalRunId 指针，
 *      换正史线时记忆引用无缝热切换，无需重写记忆本体；
 *   4. 假数据播种（seedDemoMemories），供桌面 02 UI 开发期联调。
 *
 * 记忆本体不冗余角色快照：witnessIds 只存 ID，
 * 名字/威胁等级展示时从角色档案库现取。
 *
 * 角色记忆（memKind:'char'）schema 已在索引层预留（by_char_time），
 * 本阶段只提供存取原语，不做业务封装。
 * ============================================================================
 */
const MemoryStore = (() => {
  'use strict';

  const MEM_KIND_EVENT = 'event';
  const MEM_KIND_CHAR = 'char';

  /* ---------------- 写入 ---------------- */

  /**
   * 写入/更新一条事件记忆。
   * @param {object} mem 需含 forkId / runId / summary / keywords / witnessIds
   * @returns {Promise<object>} 落库后的完整记录
   */
  async function putEventMemory(mem) {
    const now = Date.now();
    const record = {
      id: mem.id || `mem-ev-${now}-${Math.random().toString(36).slice(2, 8)}`,
      memKind: MEM_KIND_EVENT,
      forkId: String(mem.forkId || ''),
      forkTitle: String(mem.forkTitle || ''),
      runId: String(mem.runId || ''),
      runSeq: Number(mem.runSeq) || 0,
      // 状态机：settled / abandoned 才可成为候选；active 态记忆严格隔离不入库
      status: mem.status === 'abandoned' ? 'abandoned' : 'settled',
      summary: String(mem.summary || ''),
      keywords: normalizeKeywords(mem.keywords),
      witnessIds: normalizeIds(mem.witnessIds),
      importance: clampInt(mem.importance, 1, 5, 3),
      tags: normalizeIds(mem.tags),
      createdAt: Number(mem.createdAt) || now,
      updatedAt: now
    };
    await Storage.putMemory(record);
    return record;
  }

  /** 关键词规范：去重去空，截断至 6 枚（规范上限 5~6） */
  function normalizeKeywords(raw) {
    const seen = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((k) => {
      const s = String(k || '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    });
    return out.slice(0, 6);
  }

  /** ID 数组规范：去重去空（字符串型） */
  function normalizeIds(raw) {
    const seen = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((x) => {
      const s = String(x || '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    });
    return out;
  }

  function clampInt(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /* ---------------- 读取 ---------------- */

  /** 按 ID 读取单条记忆 */
  async function get(id) {
    return Storage.getMemory(id);
  }

  /**
   * 取某副本某条下潜线的全部事件记忆（正史线或候选线均可）。
   * @param {string} forkId
   * @param {string} runId
   */
  async function listByRun(forkId, runId) {
    const all = await Storage.getMemoriesByIndex('by_fork_run', [forkId, runId]);
    return all
      .filter((m) => m.memKind === MEM_KIND_EVENT)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * 取某副本的正史事件记忆：读 ForkRunStore 索引的 canonicalRunId 指针过滤。
   * 换正史线时本函数返回结果自动切换，记忆本体零重写。
   * @param {string} forkId
   * @returns {Promise<{canonicalRunId:string, memories:object[]}>}
   */
  async function listCanonical(forkId) {
    let canonicalRunId = '';
    try {
      const index = await ForkRunStore.getIndex(forkId);
      canonicalRunId = index && index.canonicalRunId ? index.canonicalRunId : '';
    } catch (err) {
      console.warn('[MemoryStore] 读取正史指针失败：', forkId, err);
    }
    if (!canonicalRunId) return { canonicalRunId: '', memories: [] };
    const memories = await listByRun(forkId, canonicalRunId);
    return { canonicalRunId, memories };
  }

  /**
   * 取某副本全部候选记忆（所有 settled/abandoned 线，按 runId 分组展示用）。
   * @param {string} forkId
   * @returns {Promise<object[]>} 全量事件记忆（调用方可自行按 runId 分组）
   */
  async function listCandidates(forkId) {
    // forkId 单维度没有专属索引，全捞事件后按 forkId 过滤（记忆量级下可接受，
    // 若未来量大再为 forkId 补单列索引）
    const everything = await Storage.getAllMemories();
    return everything
      .filter((m) => m.memKind === MEM_KIND_EVENT && m.forkId === forkId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** 按关键词反查（multiEntry 索引，零扫描） */
  async function searchByKeyword(keyword) {
    const k = String(keyword || '').trim();
    if (!k) return [];
    const hits = await Storage.getMemoriesByIndex('by_keywords', k);
    return hits
      .filter((m) => m.memKind === MEM_KIND_EVENT)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 角色回想：取某角色在场的事件记忆（by_witness multiEntry 索引）。
   * 系统助手不走这里——设定上全知，直接 listCanonical 无条件命中。
   * @param {string} charId
   * @param {object} [opts] { onlyCanonicalForks: [forkId...] 已生效正史的副本列表 }
   */
  async function recallByWitness(charId, opts) {
    const id = String(charId || '').trim();
    if (!id) return [];
    const hits = await Storage.getMemoriesByIndex('by_witness', id);
    let list = hits
      .filter((m) => m.memKind === MEM_KIND_EVENT)
      .sort((a, b) => b.createdAt - a.createdAt);
    // 若调用方给了正史过滤名单，只保留其 runId 命中对应副本正史指针的记忆
    const forks = (opts && Array.isArray(opts.onlyCanonicalForks)) ? opts.onlyCanonicalForks : null;
    if (forks && forks.length) {
      const canonicalMap = {};
      for (const fid of forks) {
        const { canonicalRunId } = await listCanonical(fid);
        canonicalMap[fid] = canonicalRunId;
      }
      list = list.filter((m) => canonicalMap[m.forkId] && m.runId === canonicalMap[m.forkId]);
    }
    return list;
  }

  /** 删除单条记忆 */
  async function remove(id) {
    return Storage.removeMemory(id);
  }

  /** 清空记忆库（调试/播种重置用），返回删除条数 */
  async function clearAll() {
    return Storage.clearAllMemories();
  }

  /* ---------------- 假数据播种（UI 开发期联调） ---------------- */

  const DEMO_SEEDS = [
    {
      id: 'mem-ev-demo-001',
      forkId: 'fork-ark-01',
      forkTitle: '方舟降临：第七回响',
      runId: 'run-demo-canon',
      runSeq: 3,
      status: 'settled',
      summary: '执行员在核心控制区拒绝交出黑匣子，强行启动备用冷却回路，导致主控系统局部过载，但成功保全了地下避难所的供氧循环。',
      keywords: ['黑匣子', '核心控制区', '冷却回路', '系统过载', '避难所供氧', '抉择'],
      witnessIds: ['char-eva', 'char-chen'],
      importance: 5,
      tags: ['核心抉择', '设施破坏', '生还'],
      createdAt: Date.now() - 86400000 * 3
    },
    {
      id: 'mem-ev-demo-002',
      forkId: 'fork-ark-01',
      forkTitle: '方舟降临：第七回响',
      runId: 'run-demo-canon',
      runSeq: 3,
      status: 'settled',
      summary: '执行员在撤离通道与伊娃交换了通讯频段密码，约定战后于三号哨塔碰面；该频段随后被用于最后一次求援广播。',
      keywords: ['通讯频段', '撤离通道', '三号哨塔', '求援广播', '约定'],
      witnessIds: ['char-eva'],
      importance: 3,
      tags: ['人际', '伏笔'],
      createdAt: Date.now() - 86400000 * 3 + 3600000
    },
    {
      id: 'mem-ev-demo-003',
      forkId: 'fork-ark-01',
      forkTitle: '方舟降临：第七回响',
      runId: 'run-demo-alt',
      runSeq: 2,
      status: 'abandoned',
      summary: '（候补线）执行员选择交出黑匣子换取通行许可，避难所供氧在第七日中断，撤离计划彻底失败。该线已被放弃，记忆保留为候选。',
      keywords: ['黑匣子', '通行许可', '供氧中断', '撤离失败', '放弃'],
      witnessIds: ['char-chen'],
      importance: 2,
      tags: ['失败线', '候补'],
      createdAt: Date.now() - 86400000 * 5
    },
    {
      id: 'mem-ev-demo-004',
      forkId: 'fork-crimson-02',
      forkTitle: '绯色晚宴',
      runId: 'run-demo-crimson',
      runSeq: 1,
      status: 'settled',
      summary: '执行员识破晚宴主人在红酒中掺入镇静剂，借打翻烛台制造混乱脱身，主人身份暴露后宅邸被教会查封。',
      keywords: ['镇静剂', '红酒', '烛台', '教会查封', '脱身'],
      witnessIds: ['char-lucia'],
      importance: 4,
      tags: ['识破', '脱身'],
      createdAt: Date.now() - 86400000
    }
  ];

  /**
   * 播种假数据：已存在同 ID 记录则跳过（幂等，可重复调用）。
   * @returns {Promise<{seeded:number, skipped:number}>}
   */
  async function seedDemoMemories() {
    let seeded = 0;
    let skipped = 0;
    for (const seed of DEMO_SEEDS) {
      const existing = await Storage.getMemory(seed.id);
      if (existing) { skipped += 1; continue; }
      await Storage.putMemory({ ...seed, memKind: MEM_KIND_EVENT, updatedAt: seed.createdAt });
      seeded += 1;
    }
    return { seeded, skipped };
  }

  /** 清除假数据（按 demo ID 前缀），返回删除条数 */
  async function purgeDemoMemories() {
    const all = await Storage.getAllMemories();
    const demos = all.filter((m) => String(m.id).startsWith('mem-ev-demo-'));
    for (const m of demos) {
      await Storage.removeMemory(m.id);
    }
    return demos.length;
  }

  /* ---------------- 统计 ---------------- */

  /** 记忆库概览统计（桌面 02 顶部仪表区用） */
  async function getStats() {
    const all = await Storage.getAllMemories();
    const events = all.filter((m) => m.memKind === MEM_KIND_EVENT);
    const chars = all.filter((m) => m.memKind === MEM_KIND_CHAR);
    const forkIds = new Set(events.map((m) => m.forkId));
    return {
      total: all.length,
      eventCount: events.length,
      charCount: chars.length,
      forkCount: forkIds.size,
      candidateCount: events.filter((m) => m.status === 'abandoned' || m.status === 'settled').length
    };
  }

  return {
    MEM_KIND_EVENT,
    MEM_KIND_CHAR,
    putEventMemory,
    get,
    listByRun,
    listCanonical,
    listCandidates,
    searchByKeyword,
    recallByWitness,
    remove,
    clearAll,
    seedDemoMemories,
    purgeDemoMemories,
    getStats
  };
})();

window.MemoryStore = MemoryStore;
