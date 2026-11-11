/**
 * ============================================================================
 * 溯流计划 · 记忆巡检引擎 (Memory Auditor)
 * ============================================================================
 * 职责：
 *   1. 关键词聚类：用并查集找出相似关键词组（妈/妈妈/母亲 → 一组）
 *   2. 分批打包：每批最多 50 条记忆，按相似关键词组聚合
 *   3. AI 判断：发给主模型，返回 JSON 格式的合并指令
 *   4. 执行合并：更新记忆、删除旧记录、记录 mergeLog
 *   5. 备份恢复：巡检前自动备份，支持一键恢复
 * ============================================================================
 */
const MemoryAuditor = (() => {
  'use strict';

  const BATCH_SIZE = 50; // 每批最多 50 条记忆
  const KEYWORD_SIMILARITY_THRESHOLD = 0.7; // 关键词相似度阈值
  const TITLE_BOOST_THRESHOLD = 0.5; // title 词汇交集可以降低关键词阈值到这个值

  // 停用词表（简单版）
  const STOP_WORDS = new Set([
    '的', '了', '是', '在', '有', '和', '或', '与', '及', '等', '也', '都', '很', '就', '不', '要',
    '这', '那', '个', '里', '到', '着', '给', '从', '把', '被', '让', '为', '又', '还', '但', '可',
    '对', '去', '来', '会', '能', '用', '以', '而', '于', '上', '下', '中', '说', '做', '看', '想'
  ]);

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function store() {
    return getWin().AssistantMemoryStore || null;
  }

  function apiCore() {
    return getWin().RetroflowAPI || null;
  }

  /**
   * 解析巡检用的模型配置（与助手记忆提取器同一套回退顺序）
   */
  function resolveModel() {
    const win = getWin();
    if (win.RetroflowApiUI && typeof win.RetroflowApiUI.resolveSlot === 'function') {
      return win.RetroflowApiUI.resolveSlot('assistant');
    }
    if (win.SystemChatPrompt && typeof win.SystemChatPrompt.resolveConfig === 'function') {
      return win.SystemChatPrompt.resolveConfig();
    }
    return null;
  }

  function dataVault() {
    return getWin().DataVault || null;
  }

  function storage() {
    return getWin().Storage || null;
  }

  /* ======================= 相似度计算 ======================= */

  /**
   * Levenshtein 编辑距离
   */
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a || !b) return Math.max(a.length, b.length);
    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost
        );
      }
    }
    return dp[m][n];
  }

  /**
   * 关键词相似度：字符包含 + 编辑距离
   * "妈" ↔ "妈妈" → 0.9
   * "小张" ↔ "张三" → 0.5（不够聚）
   */
  function keywordSimilarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    // 短词是长词的子串 → 高相似度
    if (long.includes(short)) {
      return 0.8 + (short.length / long.length) * 0.2;
    }
    // 否则用编辑距离
    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    return 1 - (dist / maxLen);
  }

  /**
   * 提取 title 的词汇（去停用词、单字词）
   */
  function extractTitleWords(title) {
    if (!title) return [];
    // 简单分词：按标点和空格切
    const raw = title.split(/[\s,，。！？；：、""''（）()]+/);
    const words = [];
    raw.forEach((w) => {
      const clean = w.trim();
      // 排除停用词和单字词（除非是常见人名单字，这里简化处理）
      if (clean.length > 1 && !STOP_WORDS.has(clean)) {
        words.push(clean);
      }
    });
    return words;
  }

  /**
   * title 词汇交集判断：两个 title 是否有共同关键词
   */
  function hasTitleOverlap(title1, title2) {
    const words1 = extractTitleWords(title1);
    const words2 = extractTitleWords(title2);
    if (!words1.length || !words2.length) return false;
    const set1 = new Set(words1);
    return words2.some(w => set1.has(w));
  }

  /* ======================= 并查集聚类 ======================= */

  class UnionFind {
    constructor() {
      this.parent = new Map();
    }

    find(x) {
      if (!this.parent.has(x)) {
        this.parent.set(x, x);
        return x;
      }
      if (this.parent.get(x) !== x) {
        this.parent.set(x, this.find(this.parent.get(x))); // 路径压缩
      }
      return this.parent.get(x);
    }

    union(x, y) {
      const rx = this.find(x);
      const ry = this.find(y);
      if (rx !== ry) {
        this.parent.set(rx, ry);
      }
    }

    getGroups() {
      const groups = new Map();
      for (const key of this.parent.keys()) {
        const root = this.find(key);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(key);
      }
      return Array.from(groups.values());
    }
  }

  /**
   * 聚类关键词：a↔b 相似、b↔c 相似 → a、b、c 聚成一组
   * @param {Array<object>} records 记忆列表
   * @returns {Array<Array<string>>} 相似关键词组
   */
  function clusterKeywords(records) {
    const uf = new UnionFind();
    const keywordToRecords = new Map(); // primaryKeyword → [记忆列表]

    // 收集所有关键词
    records.forEach((r) => {
      const kw = r.primaryKeyword || '';
      if (!kw) return;
      if (!keywordToRecords.has(kw)) keywordToRecords.set(kw, []);
      keywordToRecords.get(kw).push(r);
    });

    const keywords = Array.from(keywordToRecords.keys());

    // 1. 相同关键词但有多条记录 → 也作为候选组（最基础的重复）
    keywords.forEach((kw) => {
      const recs = keywordToRecords.get(kw) || [];
      if (recs.length >= 2) {
        // 自己跟自己 union，确保这个关键词被记录到并查集里
        uf.union(kw, kw);
      }
    });

    // 2. 两两比较不同关键词的相似度
    for (let i = 0; i < keywords.length; i++) {
      for (let j = i + 1; j < keywords.length; j++) {
        const kw1 = keywords[i];
        const kw2 = keywords[j];
        const kwSim = keywordSimilarity(kw1, kw2);

        if (kwSim >= KEYWORD_SIMILARITY_THRESHOLD) {
          // 直接相似，聚合
          uf.union(kw1, kw2);
        } else if (kwSim >= TITLE_BOOST_THRESHOLD) {
          // 关键词不够相似，但如果 title 有交集，也聚合
          const records1 = keywordToRecords.get(kw1) || [];
          const records2 = keywordToRecords.get(kw2) || [];
          let hasOverlap = false;
          for (const r1 of records1) {
            for (const r2 of records2) {
              if (hasTitleOverlap(r1.title, r2.title)) {
                hasOverlap = true;
                break;
              }
            }
            if (hasOverlap) break;
          }
          if (hasOverlap) {
            uf.union(kw1, kw2);
          }
        }
      }
    }

    // 返回聚类结果：[[kw1, kw2], [kw3], ...]
    const groups = uf.getGroups();
    // 只返回有 2 个及以上关键词的组（单个关键词不需要合并）
    // 但相同关键词的多条记录已被上面 union 过，会作为一个单元素组出现
    return groups;
  }

  /**
   * 按关键词组分组记忆
   * @param {Array<object>} records 记忆列表
   * @param {Array<Array<string>>} clusters 关键词组
   * @returns {Array<{keywords: string[], records: object[]}>}
   */
  function groupRecordsByCluster(records, clusters) {
    const result = [];
    clusters.forEach((kwGroup) => {
      const kwSet = new Set(kwGroup);
      const matchedRecords = records.filter(r => kwSet.has(r.primaryKeyword));
      if (matchedRecords.length >= 2) {
        result.push({
          keywords: kwGroup,
          records: matchedRecords
        });
      }
    });
    return result;
  }

  /* ======================= AI Prompt 构造 ======================= */

  /**
   * 完整巡检提示词（内嵌常量，与 design/memory-audit-prompt.md 保持同步；
   * 该 md 文件只是设计文档，WebView 无法读取文件系统，运行时以此为准）
   */
  const FULL_PROMPT = `你是溯流计划的记忆管理助手。你的职责是分析和整理记忆（包括助手记忆、副本记忆等），识别重复、矛盾和同源信息，并提供合理的合并或修改建议。

## 合并类型及规则

1. 重复记录 → 删除新的，保留旧的：两条记录内容基本相同；旧记录的时间更可信，删除新的，保留旧的 ID 和原始 time。
2. 同一件事+后续演进 → 保留最新一条，历史写进 body：body 按时间顺序记录，格式 [YYYY-MM-DD] 描述 → [YYYY-MM-DD] 进展；删除旧条目。
3. 同一个人/对象的不同说法（如"妈""妈妈""母亲"）→ 统一表述，整合所有信息，不遗漏细节；删除旧条目。
4. 同一关键词但指向不同对象（如"管理员"是两个人）→ 先判断组内有几个对象，对每个对象分别做重复检查和整理，用 subgroups 输出。
5. 前后矛盾 → 以最新为主，body 中标注旧日期旧说法：[YYYY-MM-DD 旧说法：...]；删除旧条目。
6. 同类项但内容不同（喜欢苹果 vs 喜欢小龙虾）→ 不合并。
7. 包含关系 → 合并成信息最全的那条；新的更全用新 ID 和 time，旧的更全保留旧 ID。
8. 拿不准就不合并 → 宁可漏合，不可错合。

## 跨分类规则
同一 Tab 内可合并；不同 Tab 即使同事件也不合并，最多在 reason 里标记"建议关联"。

## 字段处理
- title：最清晰最全的表述
- body：整合所有信息，按时间序列排列，时间点标注 [YYYY-MM-DD]
- keywords：合并去重
- primaryKeyword：选最具代表性的一个
- time：使用最新时间，格式 YYYY-MM-DDTHH:mm:ssZ
- rank：取高优先级（pinned > important > normal）
- evidence：全部保留（数组）
- source：数组

## 输出格式（严格 JSON，不要输出 JSON 以外的任何内容）
{
  "groups": [
    {
      "group_id": "group_1_xxx",
      "keywords": ["..."],
      "record_count": 3,
      "decision": "merge | skip | split_and_merge",
      "reason": "判断依据",
      "kept_id": "保留的记忆 ID（仅 merge 需要）",
      "merged_ids": ["被删除的记忆 ID 列表（仅 merge 需要）"],
      "new_title": "合并后 title",
      "new_body": "合并后 body，含时间标注",
      "new_keywords": ["..."],
      "new_primary_keyword": "...",
      "new_time": "YYYY-MM-DDTHH:mm:ssZ",
      "new_rank": "normal | important | pinned",
      "new_evidence": ["..."],
      "new_source": ["..."],
      "subgroups": [ { 同上结构，decision 为 merge 或 skip } ]
    }
  ],
  "summary": { "total_groups": 0, "merged": 0, "skipped": 0, "notes": "..." }
}

要求：merge 时 kept_id 和 merged_ids 必须使用输入中出现过的真实记忆 id；单组内不同对象用 split_and_merge 的 subgroups；不确定一律 skip。`;

  /**
   * 读取提示词模板（返回内嵌完整版）
   */
  async function loadPromptTemplate() {
    return FULL_PROMPT;
  }

  /**
   * 构造发给 AI 的 prompt
   */
  function buildPromptBatch(groups, category, groupId) {
    const categoryName = category || '未知分类';
    const groupName = groupId || '（无 Tab，整个分类）';
    
    let userMessage = `【category: ${categoryName} / groupId: ${groupName}】\n\n`;
    
    groups.forEach((group, idx) => {
      userMessage += `组 ${idx + 1}（相似关键词：${group.keywords.join('、')}）：\n`;
      group.records.forEach((r, rIdx) => {
        const time = r.time || '';
        const title = r.title || '';
        const body = r.body || '';
        const keywords = (r.keywords || []).join(', ');
        const primaryKeyword = r.primaryKeyword || '';
        const rank = r.rank || 'normal';
        const evidence = (r.evidence || []).join(', ');
        const source = r.source || 'manual';
        
        userMessage += `  记忆 ${rIdx + 1} (id: ${r.id}):\n`;
        userMessage += `    time: ${time}\n`;
        userMessage += `    title: ${title}\n`;
        userMessage += `    body: ${body}\n`;
        userMessage += `    keywords: [${keywords}]\n`;
        userMessage += `    primaryKeyword: ${primaryKeyword}\n`;
        userMessage += `    rank: ${rank}\n`;
        if (evidence) userMessage += `    evidence: [${evidence}]\n`;
        userMessage += `    source: ${source}\n`;
        userMessage += `\n`;
      });
      userMessage += `\n`;
    });

    return userMessage;
  }

  /* ======================= AI 调用 ======================= */

  /**
   * 转义 JSON 字符串字面量内部的裸控制字符（换行、回车、制表符等）。
   * 模型常在 body/reason 里直接换行，JSON.parse 会报 Bad control character。
   * 只处理双引号字符串内部，字符串外的结构性空白原样保留。
   */
  function escapeControlCharsInStrings(s) {
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (!inString) {
        if (ch === '"') inString = true;
        out += ch;
        continue;
      }
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        out += ch;
        continue;
      }
      if (ch === '"') {
        inString = false;
        out += ch;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '\\u' + code.toString(16).padStart(4, '0');
        continue;
      }
      out += ch;
    }
    return out;
  }

  /**
   * 从模型返回文本中抢救出 JSON 对象
   * 兼容：代码围栏包裹、前后夹带解释文字、字符串内裸换行/制表符、中文引号、尾随逗号
   */
  function parseAuditJSON(content) {
    let s = String(content || '').replace(/^\uFEFF/, '').trim();

    // 去掉代码围栏
    s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```\s*$/, '').trim();

    // 截取最外层花括号（应对前后夹带的自然语言说明）
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);

    // 1. 直接尝试
    try {
      return JSON.parse(s);
    } catch (_) { /* 继续抢救 */ }

    // 2. 转义字符串内部的控制字符 + 去尾随逗号
    const step2 = escapeControlCharsInStrings(s).replace(/,(\s*[}\]])/g, '$1');
    try {
      return JSON.parse(step2);
    } catch (_) { /* 继续抢救 */ }

    // 3. 中文双引号当作结构引号（模型偶尔整段用中文引号），再转义一次
    const step3 = escapeControlCharsInStrings(
      s.replace(/[“”]/g, '"').replace(/,(\s*[}\]])/g, '$1')
    );
    return JSON.parse(step3); // 抛错由调用方处理
  }

  /**
   * 调用模型进行巡检分析
   * @param {string} systemPrompt 系统提示词
   * @param {string} userMessage 用户消息（包含记忆组）
   * @returns {Promise<object>} 解析后的 JSON 对象
   */
  async function callAuditAPI(systemPrompt, userMessage) {
    const api = apiCore();
    if (!api || typeof api.chat !== 'function') {
      throw new Error('RetroflowAPI 未初始化或 chat 方法不存在');
    }

    const config = resolveModel();
    if (!config || !config.baseUrl || !config.modelId) {
      throw new Error('没有可用的模型，请先配置辅助推理模型或主模型');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ];

    // 项目 chat 签名为 chat(config, messages, options)；
    // 部分端点不支持 response_format，这里不强制传，改由提示词 + 容错解析保证。
    try {
      const response = await api.chat(config, messages, {
        timeout: 120000,
        logTag: '记忆巡检'
      });
      const content = String((response && response.content) || '').trim();
      if (!content) throw new Error('模型返回空内容');

      return parseAuditJSON(content);
    } catch (err) {
      console.error('[MemoryAuditor] AI 调用或解析失败:', err);
      const desc = (api && typeof api.describeNetworkError === 'function')
        ? api.describeNetworkError(err)
        : ((err && err.message) || String(err));
      throw new Error(desc);
    }
  }

  /* ======================= 合并执行 ======================= */

  /**
   * 校验 AI 返回的 ID 是否合法（在当前分类中存在）
   * @param {string} id 记录 ID
   * @param {string} category 分类
   * @returns {boolean}
   */
  function isValidRecordId(id, category) {
    const st = store();
    if (!st || typeof st.get !== 'function') return false;
    try {
      const rec = st.get(id);
      return rec && rec.category === category;
    } catch (_) {
      return false;
    }
  }

  /**
   * 执行 AI 返回的合并指令
   * @param {object} plan AI 返回的 JSON 对象
   * @param {string} category 当前分类
   * @param {string} groupId 当前 Tab
   * @returns {Promise<{merged: number, skipped: number}>}
   */
  async function executeAuditPlan(plan, category, groupId) {
    const st = store();
    if (!st || typeof st.commit !== 'function' || typeof st.normalize !== 'function') {
      throw new Error('AssistantMemoryStore 未初始化');
    }

    const groups = (plan && Array.isArray(plan.groups)) ? plan.groups : [];
    let mergedCount = 0;
    let skippedCount = 0;

    for (const group of groups) {
      const decision = group.decision || 'skip';
      
      if (decision === 'skip') {
        skippedCount++;
        continue;
      }

      if (decision === 'merge') {
        // 执行合并
        const keptId = group.kept_id;
        const mergedIds = Array.isArray(group.merged_ids) ? group.merged_ids : [];
        
        // 白名单校验：kept_id 和 merged_ids 必须在当前分类中存在
        if (!keptId || !isValidRecordId(keptId, category)) {
          console.warn('[MemoryAuditor] kept_id 不存在或不属于当前分类，跳过:', keptId);
          skippedCount++;
          continue;
        }
        
        const validMergedIds = mergedIds.filter(id => isValidRecordId(id, category));
        if (validMergedIds.length === 0) {
          console.warn('[MemoryAuditor] 没有有效的 merged_ids，跳过');
          skippedCount++;
          continue;
        }

        // 构造新记录并规范化
        const rawRecord = {
          id: keptId,
          category: category,
          groupId: groupId,
          title: group.new_title || '',
          body: group.new_body || '',
          keywords: Array.isArray(group.new_keywords) ? group.new_keywords : [],
          primaryKeyword: group.new_primary_keyword || '',
          time: group.new_time || new Date().toISOString(),
          rank: group.new_rank || 'normal',
          evidence: Array.isArray(group.new_evidence) ? group.new_evidence : [],
          source: 'manual', // 简化处理：统一用 manual，避免 source 数组导致 normalize 失败
          mergeLog: [{
            mergedIds: validMergedIds,
            date: new Date().toISOString().split('T')[0],
            reason: group.reason || 'audit'
          }]
        };

        let newRecord;
        try {
          newRecord = st.normalize(rawRecord);
        } catch (err) {
          console.error('[MemoryAuditor] 记录规范化失败:', err);
          skippedCount++;
          continue;
        }

        // 提交：put 新记录，remove 旧记录
        try {
          await st.commit({
            put: [newRecord],
            remove: validMergedIds
          });
          mergedCount++;
        } catch (err) {
          console.error('[MemoryAuditor] 合并失败:', err);
          skippedCount++;
        }
      } else if (decision === 'split_and_merge' && Array.isArray(group.subgroups)) {
        // 同关键词不同对象，分别处理每个子组
        for (const sub of group.subgroups) {
          if (sub.decision === 'merge') {
            const keptId = sub.kept_id;
            const mergedIds = Array.isArray(sub.merged_ids) ? sub.merged_ids : [];
            
            // 白名单校验
            if (!keptId || !isValidRecordId(keptId, category)) {
              console.warn('[MemoryAuditor] 子组 kept_id 不存在或不属于当前分类，跳过:', keptId);
              skippedCount++;
              continue;
            }
            
            const validMergedIds = mergedIds.filter(id => isValidRecordId(id, category));
            if (validMergedIds.length === 0) {
              console.warn('[MemoryAuditor] 子组没有有效的 merged_ids，跳过');
              skippedCount++;
              continue;
            }

            const rawRecord = {
              id: keptId,
              category: category,
              groupId: groupId,
              title: sub.new_title || '',
              body: sub.new_body || '',
              keywords: Array.isArray(sub.new_keywords) ? sub.new_keywords : [],
              primaryKeyword: sub.new_primary_keyword || '',
              time: sub.new_time || new Date().toISOString(),
              rank: sub.new_rank || 'normal',
              evidence: Array.isArray(sub.new_evidence) ? sub.new_evidence : [],
              source: 'manual',
              mergeLog: [{
                mergedIds: validMergedIds,
                date: new Date().toISOString().split('T')[0],
                reason: sub.reason || 'audit'
              }]
            };

            let newRecord;
            try {
              newRecord = st.normalize(rawRecord);
            } catch (err) {
              console.error('[MemoryAuditor] 子组记录规范化失败:', err);
              skippedCount++;
              continue;
            }

            try {
              await st.commit({
                put: [newRecord],
                remove: validMergedIds
              });
              mergedCount++;
            } catch (err) {
              console.error('[MemoryAuditor] 子组合并失败:', err);
              skippedCount++;
            }
          } else {
            skippedCount++;
          }
        }
      } else {
        skippedCount++;
      }
    }

    return { merged: mergedCount, skipped: skippedCount };
  }

  /* ======================= 备份恢复 ======================= */

  const BACKUP_KEY = 'backup/memory_audit';

  /**
   * 创建巡检前备份
   */
  async function createBackup() {
    const st = storage();
    if (!st || typeof st.getDoc !== 'function' || typeof st.setDoc !== 'function') {
      throw new Error('Storage 未初始化');
    }

    const memStore = store();
    if (!memStore || typeof memStore.all !== 'function') {
      throw new Error('AssistantMemoryStore 未初始化');
    }

    // 确保缓存已加载（all() 是同步缓存读取）
    if (typeof memStore.load === 'function') {
      try { await memStore.load(); } catch (_) { /* 缓存加载失败时 all() 返回已有缓存 */ }
    }

    // 读取所有助手记忆
    const memories = memStore.all();

    // 读取提取进度点
    let cursor = {};
    try {
      const mainCursor = await st.getDoc('sysChat/memcursor.main');
      if (mainCursor) cursor.main = mainCursor;
    } catch (_) { /* ignore */ }

    const backup = {
      timestamp: Date.now(),
      memories: memories,
      cursor: cursor
    };

    await st.setDoc(BACKUP_KEY, backup);
    console.log('[MemoryAuditor] 备份已创建:', backup.timestamp);
    return backup.timestamp;
  }

  /**
   * 获取备份信息（用于 UI 显示）
   */
  async function getBackupInfo() {
    const st = storage();
    if (!st || typeof st.getDoc !== 'function') return null;

    try {
      const backup = await st.getDoc(BACKUP_KEY);
      if (!backup || !backup.timestamp) return null;
      return {
        timestamp: backup.timestamp,
        count: Array.isArray(backup.memories) ? backup.memories.length : 0
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * 恢复备份
   */
  async function restoreBackup() {
    const st = storage();
    if (!st || typeof st.getDoc !== 'function') {
      throw new Error('Storage 未初始化');
    }

    const backup = await st.getDoc(BACKUP_KEY);
    if (!backup || !Array.isArray(backup.memories)) {
      throw new Error('备份不存在或格式错误');
    }

    // 构造 data-vault 格式的导入包（与 data-vault.js applyImport 认的格式一致：
    // payload 顶层平铺 stores/docs，blocks 只声明 'memory'）
    const pkg = {
      app: 'retroflow',
      kind: 'data-vault',
      version: 1,
      exportedAt: backup.timestamp,
      blocks: ['memory'],
      payload: {
        stores: {
          assistantMemories: backup.memories
        },
        docs: {}
      }
    };

    // 如果有 cursor，加进去（docPrefixes 'sysChat/memcursor.' 归 memory 块）
    if (backup.cursor && backup.cursor.main) {
      pkg.payload.docs['sysChat/memcursor.main'] = backup.cursor.main;
    }

    const dv = dataVault();
    if (!dv || typeof dv.applyImport !== 'function') {
      throw new Error('DataVault 未初始化');
    }

    // 导入（返回 {ok, blocks, reason}，不抛错）
    const res = await dv.applyImport(pkg, 'memory');
    if (!res || res.ok !== true) {
      throw new Error(`恢复失败：${(res && res.reason) || '未知原因'}`);
    }

    // 清空向量（applyImport 的 memory 块本身会清，这里兜底；旧向量对应已替换的记忆）
    const vectors = getWin().MemoryVectors;
    if (vectors && typeof vectors.clearAllVectors === 'function') {
      try { await vectors.clearAllVectors(); } catch (_) { /* ignore */ }
    }

    console.log('[MemoryAuditor] 备份已恢复');
  }

  /* ======================= 主入口 ======================= */

  /**
   * 巡检一个 Tab
   * @param {string} category 分类（如 'operator'）
   * @param {string} groupId Tab ID（如 'recent_status'）
   * @returns {Promise<{merged: number, skipped: number}>}
   */
  async function audit(category, groupId) {
    const st = store();
    if (!st || typeof st.list !== 'function') {
      throw new Error('AssistantMemoryStore 未初始化');
    }

    // 1. 读取该 Tab 下的所有记忆
    const allRecords = st.list(category);
    const records = allRecords.filter(r => r.groupId === groupId);

    return auditRecords(category, groupId, records);
  }

  /**
   * 巡检一组记忆（核心逻辑，供 audit 和 auditAll 复用）
   * @param {string} category 分类
   * @param {string} groupId Tab ID（无 Tab 分类时传 'all'）
   * @param {Array<object>} records 该组的所有记忆
   * @returns {Promise<{merged: number, skipped: number}>}
   */
  async function auditRecords(category, groupId, records) {
    if (records.length < 2) {
      console.log('[MemoryAuditor] 记忆数量少于 2 条，无需巡检');
      return { merged: 0, skipped: 0 };
    }

    // 2. 关键词聚类
    const clusters = clusterKeywords(records);
    if (clusters.length === 0) {
      console.log('[MemoryAuditor] 未发现相似关键词组');
      return { merged: 0, skipped: 0 };
    }

    // 3. 按关键词组分组记忆
    const groups = groupRecordsByCluster(records, clusters);
    if (groups.length === 0) {
      console.log('[MemoryAuditor] 未发现需要合并的记忆组');
      return { merged: 0, skipped: 0 };
    }

    // 4. 分批处理（每批最多 50 条记忆）
    let totalMerged = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let firstError = '';

    const systemPrompt = await loadPromptTemplate();

    // 单批执行：失败只记数，不中断后续批次
    const runBatch = async (batchGroups) => {
      let plan;
      try {
        const userMessage = buildPromptBatch(batchGroups, category, groupId);
        plan = await callAuditAPI(systemPrompt, userMessage);
      } catch (err) {
        console.warn(`[MemoryAuditor] ${category}/${groupId} 一批请求或解析失败，已跳过:`, err);
        totalFailed++;
        if (!firstError) firstError = (err && err.message) || String(err);
        return;
      }
      const result = await executeAuditPlan(plan, category, groupId);
      totalMerged += result.merged;
      totalSkipped += result.skipped;
    };

    // 按组打包：凑到 50 条就发一批，单组不拆
    let batch = [];
    let batchRecordCount = 0;

    for (const group of groups) {
      const groupRecordCount = group.records.length;

      if (batchRecordCount + groupRecordCount > BATCH_SIZE && batch.length > 0) {
        await runBatch(batch);
        batch = [];
        batchRecordCount = 0;
      }

      batch.push(group);
      batchRecordCount += groupRecordCount;
    }

    // 处理最后一批
    if (batch.length > 0) {
      await runBatch(batch);
    }

    return { merged: totalMerged, skipped: totalSkipped, failed: totalFailed, firstError };
  }

  /**
   * 巡检所有助手记忆（所有分类和 Tab）
   * @returns {Promise<{merged: number, skipped: number}>}
   */
  async function auditAll() {
    const st = store();
    if (!st) throw new Error('AssistantMemoryStore 未初始化');

    // 确保缓存已加载（list/all/get 都是同步缓存读取）
    if (typeof st.load === 'function') {
      try { await st.load(); } catch (err) {
        throw new Error(`助手记忆加载失败：${(err && err.message) || err}`);
      }
    }

    // 分类定义：operator/self 有 groupId，其他分类直接聚合所有记录
    const SCHEMA = {
      // 有 Tab 的分类：逐个 groupId 巡检
      tabbed: {
        operator: ['info', 'habit', 'like', 'dislike', 'relationship', 'daily_piece', 'recent_status'],
        self: ['understanding', 'desire', 'shadow', 'wish', 'emotion']
      },
      // 没有 Tab 的分类：聚合所有记录一起巡检
      flat: ['bond', 'events', 'pending', 'knowledge']
      // forks 明确跳过：副本记忆结构不同，且内容较少
    };

    let totalMerged = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let firstError = '';

    const add = (result) => {
      totalMerged += result.merged || 0;
      totalSkipped += result.skipped || 0;
      totalFailed += result.failed || 0;
      if (!firstError && result.firstError) firstError = result.firstError;
    };

    // 1. 处理有 Tab 的分类
    for (const category of Object.keys(SCHEMA.tabbed)) {
      const groupIds = SCHEMA.tabbed[category];
      for (const groupId of groupIds) {
        add(await audit(category, groupId));
      }
    }

    // 2. 处理没有 Tab 的分类：把整个分类当作一个"Tab"来巡检
    for (const category of SCHEMA.flat) {
      // 读取该分类下所有记忆（这些分类没有 groupId）
      const allRecords = st.list(category);
      if (allRecords.length < 2) continue;

      // groupId 传空：normalize 对无 Tab 分类不写 groupId
      add(await auditRecords(category, '', allRecords));
    }

    return { merged: totalMerged, skipped: totalSkipped, failed: totalFailed, firstError };
  }

  return {
    audit,
    auditAll,
    createBackup,
    getBackupInfo,
    restoreBackup,
    // 导出内部函数供测试
    _test: {
      levenshtein,
      keywordSimilarity,
      extractTitleWords,
      clusterKeywords,
      escapeControlCharsInStrings,
      parseAuditJSON
    }
  };
})();

if (typeof window !== 'undefined') {
  window.MemoryAuditor = MemoryAuditor;
}
