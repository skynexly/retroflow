/**
 * 溯流计划 · 聊天跨天日期分隔胶囊 (Chat Day Separator)
 *
 * 三端复用的轻量工具：系统助手、私聊接入；副本推演不用（叙事为主，现实时间不重要）。
 *
 * 语义：聊天时间线从上到下是「旧 → 新」。某一天的第一条消息正上方插一枚
 * 居中日期胶囊，显示「这一天」的日期。往上翻每进入更早的一天，那天第一条
 * 消息头顶就带着它的日期。格式统一为 `年.月.日`（不补零，如 2026.9.26）。
 *
 * 视觉：居中、纯文字（无图标）、无分割线，符合工地施工协议。
 *
 * 接入约定：
 *   - 判断：渲染每条消息前，用 isCrossDay(上一条时间, 当前条时间) 判断是否要插胶囊；
 *     上一条为空（首条）时返回 true，让首条也带上日期。
 *   - 生成：buildPill(ts) 返回一个 .chat-day-sep 元素，插到该条消息行之前。
 *   - 隔离：.chat-day-sep 不是消息行，绝不落进多选选择器 / buildChatHistory 的取数选择器，
 *     天然不会被全选、删除、上下文注入误伤。
 *   - 清理：批量删除消息后调用 pruneOrphans(container)，清掉「下方已无消息」的孤儿胶囊。
 */
window.ChatDaySep = (() => {
  'use strict';

  const PILL_CLASS = 'chat-day-sep';

  /** 取某个时间戳所在「本地日历天」的序号（按本地 00:00 归一，跨天比较用） */
  function dayIndex(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    const d = new Date(n);
    // 用本地年月日拼一个纯日期数字，避免时区/夏令时下毫秒运算的偏差
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  /**
   * 是否需要在「当前条」之前插日期胶囊。
   * @param {number} prevTs 上一条消息时间戳（首条传 0 / null / undefined）
   * @param {number} curTs 当前条消息时间戳
   * @returns {boolean}
   */
  function isCrossDay(prevTs, curTs) {
    const cur = dayIndex(curTs);
    if (Number.isNaN(cur)) return false;         // 当前条没有合法时间，不插
    const prev = dayIndex(prevTs);
    if (Number.isNaN(prev)) return true;          // 首条 / 上一条无时间：首条也带日期
    return cur !== prev;
  }

  /** 格式化为 `年.月.日`（不补零） */
  function formatDay(ts) {
    const n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return '';
    const d = new Date(n);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
  }

  /**
   * 生成一枚居中日期胶囊 DOM。
   * @param {number} ts 该天任意一条消息的时间戳（取其日期）
   * @returns {HTMLElement}
   */
  function buildPill(ts) {
    const el = document.createElement('div');
    el.className = PILL_CLASS;
    // dayKey 供孤儿清理与去重用
    const key = dayIndex(ts);
    if (Number.isFinite(key)) el.dataset.dayKey = String(key);
    const span = document.createElement('span');
    span.className = 'chat-day-sep-text';
    span.textContent = formatDay(ts);
    el.appendChild(span);
    return el;
  }

  /**
   * 清理孤儿胶囊：某天消息被删光后，头顶那枚日期胶囊要一并移除。
   *
   * 判定：一枚胶囊之后、下一枚胶囊之前，若没有任何消息行，则它是孤儿。
   * 只认真正的消息行（.chat-msg-row 及状态胶囊行），不把别的胶囊算进去。
   *
   * @param {HTMLElement} container 消息容器（messagesWrap）
   * @param {string} [msgRowSelector] 消息行选择器，缺省覆盖常见两端形态
   */
  function pruneOrphans(container, msgRowSelector) {
    if (!container) return;
    const sel = msgRowSelector || '.chat-msg-row, .chat-status-pill-row';
    const pills = Array.from(container.querySelectorAll('.' + PILL_CLASS));
    pills.forEach((pill) => {
      // 向后看：直到遇到下一枚胶囊或容器末尾，中间有没有真正的消息行
      let node = pill.nextElementSibling;
      let hasMsg = false;
      while (node) {
        if (node.classList && node.classList.contains(PILL_CLASS)) break;
        if (node.matches && node.matches(sel)) { hasMsg = true; break; }
        node = node.nextElementSibling;
      }
      if (!hasMsg) pill.remove();
    });
  }

  /**
   * 去除同一天的重复胶囊：上滑前插更早消息后，原批首条曾以「最早一条」身份插过一枚
   * 当天胶囊，而前插批的末尾同一天又会插一枚，导致同一天出现两枚。
   *
   * 策略：从上到下遍历胶囊，若某枚 dayKey 与「上一枚已保留的胶囊」相同，则删掉这枚
   * （保留更靠上、位置更正确的那枚——它头顶才是这一天真正的第一条消息）。
   *
   * @param {HTMLElement} container 消息容器
   */
  function dedupeAdjacent(container) {
    if (!container) return;
    const pills = Array.from(container.querySelectorAll('.' + PILL_CLASS));
    let lastKey = null;
    pills.forEach((pill) => {
      const key = pill.dataset ? pill.dataset.dayKey : '';
      if (key && key === lastKey) {
        pill.remove();
        return;
      }
      lastKey = key;
    });
  }

  return {
    PILL_CLASS,
    dayIndex,
    isCrossDay,
    formatDay,
    buildPill,
    pruneOrphans,
    dedupeAdjacent
  };
})();
