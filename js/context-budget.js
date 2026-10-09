/**
 * 溯流计划 · 上下文预算裁剪器 (Context Budget)
 *
 * 为什么不按条数截断：
 *   条数是个跟信息量无关的维度。60 条可能是 1200 字，也可能是两万字。
 *   模型的真实约束是 token，所以计量货币必须是 token。
 *
 * 为什么以「轮」为装填单位：
 *   私聊里一轮 = 用户打包发出的连续消息 + 对方一次性回复的连续消息。
 *   这是请求边界，不是语义猜测，能从 role 序列直接重建。按条截断会把
 *   切口落在一轮中间，模型看到自己上轮说了一半的话，或看到对方的提问
 *   却看不到自己的回答，对话逻辑当场断裂。所以轮是不可分割的原子。
 *
 * 为什么从新往旧装：
 *   最近的对话对当下这句回复最重要。装不下的旧轮整轮丢弃，而不是
 *   留半轮 —— 宁可少一轮完整对话，不要一轮残缺对话。
 *
 * 这个模块是未来「多来源上下文装配层」里「聊天历史」那个来源的实现。
 * 记忆、社交事件流、线下叙事摘要接入时，各自分到一份预算，共用同一套
 * token 估算与装填语义，所以估算函数在这里对外暴露。
 */
window.ContextBudget = (() => {
  'use strict';

  /** 配置里 context 小于这个值时视为用户填错（或填了「1」这种），走默认 */
  const MIN_TRUSTED_CONTEXT = 1000;

  /** 读不到配置时的保守假设：现在的模型普遍不低于这个量级 */
  const DEFAULT_CONTEXT = 200000;

  /** 未配置 maxTokens 时的输出预留上限 */
  const DEFAULT_OUTPUT_RESERVE = 4096;

  /**
   * 留给 tokenizer 估算误差与消息封装开销的余量。
   * 各家 tokenizer 对中文的切法差异不小，估算只能保守。
   */
  const SAFETY_RATIO = 0.9;

  /** 预算再怎么算也不能低于这个值，否则一轮都装不下就没意义了 */
  const MIN_BUDGET = 256;

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  /**
   * 无 tokenizer 依赖下的保守 token 估算。
   * 中日韩字符按 1 token 计，其余文本约 4 字符 / token。
   * 与助手页 system-chat-ui 的估算口径一致，两侧迁移时行为不会跳变。
   * @param {string} text
   * @returns {number}
   */
  function estimateTokens(text) {
    const value = String(text == null ? '' : text);
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    return cjk + Math.ceil((value.length - cjk) / 4) + 4;
  }

  /**
   * 单条 API 消息的开销。额外 4 token 是 role 字段与分隔符的封装成本。
   * @param {{role: string, content: string}} message
   * @returns {number}
   */
  function estimateMessageTokens(message) {
    return estimateTokens(message && message.content) + 4;
  }

  /**
   * 算出可用于装历史的输入预算。
   * @param {Object} config 模型配置，读 context / maxTokens
   * @returns {{contextLimit: number, outputReserve: number, inputBudget: number}}
   */
  function resolveBudget(config) {
    const configuredContext = parseInt(config && config.context, 10);
    const contextLimit = Number.isFinite(configuredContext) && configuredContext >= MIN_TRUSTED_CONTEXT
      ? configuredContext
      : DEFAULT_CONTEXT;

    const configuredOutput = parseInt(config && config.maxTokens, 10);
    const outputReserve = Number.isFinite(configuredOutput) && configuredOutput > 0
      ? configuredOutput
      : Math.min(DEFAULT_OUTPUT_RESERVE, Math.floor(contextLimit * 0.2));

    const inputBudget = Math.max(MIN_BUDGET, Math.floor(contextLimit * SAFETY_RATIO) - outputReserve);
    return { contextLimit, outputReserve, inputBudget };
  }

  /**
   * 把私聊消息流水切成「轮」。
   *
   * 一轮 = 连续的 envoy 块 + 紧随其后的连续 char 块。
   * 判定只看 role 序列：envoy 在 char 之后出现即开新轮。
   *
   * 三种边界情况：
   *   1. 开头就是 char（对方主动打招呼）—— 单独成一轮，没有 envoy 部分。
   *   2. 末尾是 envoy（用户刚发出、还没回复）—— 单独成一轮，没有 char 部分。
   *      这一轮就是「待回复轮」，必须强制保留，见 fitRecordsToBudget。
   *   3. 撤回通知（role system / messageType notice）—— 不影响轮边界，
   *      跟着它前面那一轮走。撤回不是一次问答。
   *
   * @param {Array} records 按时间正序的消息记录
   * @returns {Array<Array>} 每个元素是一轮的记录数组
   */
  function splitIntoTurns(records) {
    const list = asArray(records).filter(Boolean);
    const turns = [];
    let current = null;
    // 当前轮里是否已经出现过对方发言。出现过之后再来 envoy 就是下一轮了。
    let sawChar = false;

    for (const r of list) {
      const isNotice = r.role === 'system' || r.messageType === 'notice';
      const isEnvoy = !isNotice && r.role !== 'char';

      if (!current) {
        current = [];
        turns.push(current);
        sawChar = false;
      } else if (isEnvoy && sawChar) {
        // 对方已经回过话，用户又开口：新一轮
        current = [];
        turns.push(current);
        sawChar = false;
      }

      current.push(r);
      if (!isNotice && r.role === 'char') sawChar = true;
    }

    return turns;
  }

  /**
   * 按 token 预算从新到旧装填整轮记录。
   *
   * 强制保留最后一轮：那是用户刚发出、正等回复的内容。预算再紧也不能
   * 静默吞掉用户刚说的话 —— 宁可超预算让 API 报错，也不要模型答非所问。
   *
   * 装填时遇到装不下的轮就停，不继续往更旧的轮找「小到能塞进去」的。
   * 跳着装会让上下文出现时间空洞，模型读到的对话是断续的。
   *
   * @param {Array} records 按时间正序的消息记录
   * @param {Object} options
   * @param {number} options.budget 可用 token 数
   * @param {Function} options.costOf 单轮开销估算，收一轮记录数组返回 token 数
   * @returns {{records: Array, meta: Object}}
   */
  function fitRecordsToBudget(records, options) {
    const list = asArray(records).filter(Boolean);
    const opts = options || {};
    const budget = Number.isFinite(opts.budget) ? opts.budget : MIN_BUDGET;
    const costOf = typeof opts.costOf === 'function'
      ? opts.costOf
      : (turn) => turn.reduce((sum, r) => sum + estimateTokens(r && r.content) + 8, 0);

    const turns = splitIntoTurns(list);
    if (!turns.length) {
      return {
        records: [],
        meta: { totalTurns: 0, keptTurns: 0, droppedTurns: 0, totalRecords: 0, keptRecords: 0, usedTokens: 0, budget, forcedLastTurn: false }
      };
    }

    const kept = [];
    let used = 0;
    let forcedLastTurn = false;

    // 最后一轮无条件装入
    const lastTurn = turns[turns.length - 1];
    kept.unshift(lastTurn);
    used += costOf(lastTurn);
    if (used > budget) forcedLastTurn = true;

    for (let i = turns.length - 2; i >= 0; i -= 1) {
      const cost = costOf(turns[i]);
      if (used + cost > budget) break;
      kept.unshift(turns[i]);
      used += cost;
    }

    const keptRecords = [];
    kept.forEach((turn) => { turn.forEach((r) => keptRecords.push(r)); });

    return {
      records: keptRecords,
      meta: {
        totalTurns: turns.length,
        keptTurns: kept.length,
        droppedTurns: turns.length - kept.length,
        totalRecords: list.length,
        keptRecords: keptRecords.length,
        usedTokens: used,
        budget,
        forcedLastTurn
      }
    };
  }

  return {
    estimateTokens,
    estimateMessageTokens,
    resolveBudget,
    splitIntoTurns,
    fitRecordsToBudget,
    _constants: { MIN_TRUSTED_CONTEXT, DEFAULT_CONTEXT, DEFAULT_OUTPUT_RESERVE, SAFETY_RATIO, MIN_BUDGET }
  };
})();
