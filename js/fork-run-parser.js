/**
 * ============================================================================
 * 溯流计划 · 推演回复解析器 (Fork Run Reply Parser)
 *
 * 职责单一：吃 AI 一轮原始回复文本，吐出结构化数据对象，喂给 fork-run-ui.js
 * 里的 buildXxxCard 组件渲染。解析与渲染解耦，改格式只动这里。
 *
 * 格式契约见 docs/AI输出格式契约.md。核心结构：
 *   ::: 类型 [名字]
 *   [标签] 值
 *   :::
 * 栅栏块之外的一切都是正文。
 *
 * 六道兜底防线（详见契约第六节）：块缺失静默跳过、字段缺失不渲染、未知标签收拢、
 * 数值降级为文本、栅栏未闭合尽力收束、整段乱码退回纯正文。永不抛异常、永不白屏。
 *
 * raw + warnings 是观测钩子：跑真实 AI 输出时从这两处看 AI 常在哪翻车。
 * ============================================================================
 */
const ForkRunParser = (() => {
  'use strict';

  /** 合法块类型 */
  const BLOCK_TYPES = ['scene', 'state', 'ally', 'npc', 'quest', 'clue', 'recap'];

  /** state/ally/npc 里的保留标签，不进 customStats */
  const RESERVED_FIELD = ['精神值', '着装', '姿势'];

  /* ---------------- 工具 ---------------- */

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  /** 块头正则：::: 类型 [可选名字]。宽松匹配，前后允许空白 */
  function matchBlockHead(line) {
    const m = /^:::\s*([A-Za-z]+)\s*(.*)$/.exec(line.trim());
    if (!m) return null;
    const type = m[1].toLowerCase();
    if (!BLOCK_TYPES.includes(type)) return null;
    return { type, name: trimStr(m[2]) };
  }

  /** 块尾正则：单独一行的 :::（后面没有类型名） */
  function isBlockTail(line) {
    return /^:::\s*$/.test(line.trim());
  }

  /** 字段行正则：[标签] 值。] 之后到行尾都是值 */
  function matchField(line) {
    const m = /^\s*\[([^\]]+)\]\s*(.*)$/.exec(line);
    if (!m) return null;
    return { label: trimStr(m[1]), value: trimStr(m[2]) };
  }

  /**
   * 数值解析兜底：能转数字就转，转不了返回 null（调用侧决定降级为文本）。
   * "85" -> 85；"85/100" -> 85（取斜杠前）；"挺好的" -> null
   */
  function parseNumber(raw) {
    const s = trimStr(raw);
    if (!s) return null;
    const head = s.split('/')[0].trim();
    const n = Number(head);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 变动值解析：值形如 "-5 长时间潜行"，按首个空白拆成 delta 与 reason。
   * delta 尽量转数字，转不了保留原文。
   */
  function parseDelta(name, value) {
    const s = trimStr(value);
    const spaceIdx = s.search(/\s/);
    let deltaRaw, reason;
    if (spaceIdx === -1) {
      deltaRaw = s;
      reason = '';
    } else {
      deltaRaw = s.slice(0, spaceIdx);
      reason = s.slice(spaceIdx + 1).trim();
    }
    const n = Number(deltaRaw);
    return {
      name,
      delta: Number.isFinite(n) ? n : deltaRaw, // 转不了数字就保留原文（兜底 4）
      reason
    };
  }

  /**
   * 解析一组字段行为 state/ally/npc 通用的档案对象。
   * @param {Array<{label,value}>} fields
   * @param {Array<string>} warnings
   * @param {boolean} allowSan 是否接受精神值（npc 不接受）
   */
  function buildProfile(fields, warnings, allowSan) {
    const profile = {
      customStats: [],
      statDeltas: []
    };

    fields.forEach(({ label, value }) => {
      // 变动字段：[变动·XXX]
      if (label.startsWith('变动·') || label.startsWith('变动・')) {
        const statName = label.replace(/^变动[·・]/, '').trim();
        if (!statName) {
          warnings.push(`空的变动标签被忽略：[${label}]`);
          return;
        }
        profile.statDeltas.push(parseDelta(statName, value));
        return;
      }

      // 保留字段
      if (label === '精神值') {
        if (!allowSan) {
          warnings.push(`NPC 不应有精神值，已忽略：[${label}] ${value}`);
          return;
        }
        const n = parseNumber(value);
        if (n === null) {
          profile.sanText = value; // 降级为文本（兜底 4）
          warnings.push(`精神值非数字，降级为文本：${value}`);
        } else {
          profile.san = n;
        }
        return;
      }
      if (label === '着装') {
        profile.attire = value;
        return;
      }
      if (label === '姿势') {
        profile.posture = value;
        return;
      }

      // 其余一律当自定义数值进 customStats（兜底 3）
      profile.customStats.push({ label, val: value });
    });

    return profile;
  }

  /**
   * 场景块字段 -> 组件期望的 scene 对象。
   * 组件要 { timeHero, date, weather, location, scene }，
   * 契约给的是拆开的 [时间][季节][温度][天气][地点][场景]，这里组装映射。
   */
  function buildScene(fields, warnings) {
    const raw = {};
    fields.forEach(({ label, value }) => {
      raw[label] = value;
    });

    const scene = {};

    // [时间] "2026.6.18 星期四 23:00" -> date="2026.6.18 星期四", timeHero="23:00"
    const timeStr = trimStr(raw['时间']);
    if (timeStr) {
      const timeMatch = /(\d{1,2}:\d{2})/.exec(timeStr);
      if (timeMatch) {
        scene.timeHero = timeMatch[1];
        scene.date = timeStr.replace(timeMatch[1], '').trim();
      } else {
        scene.date = timeStr; // 抓不到时分就整串当日期（兜底）
        warnings.push(`时间中未识别到时:分，整串作日期：${timeStr}`);
      }

      // 时间触发要精确到每一位，把 [时间] 拆成结构化的 { year, month, day, hour, minute }。
      // 年月日取 date 里以 . 分隔的前三段（第三段可能带星期，取其中数字）；时分从 HH:MM 取。
      // 每位收敛成纯数字字符串，取不到留空。渲染仍用上面的 timeHero/date，这里只增补。
      const parts = { year: '', month: '', day: '', hour: '', minute: '' };
      const dateSrc = trimStr(scene.date || timeStr);
      const dm = dateSrc.match(/(\d+)\s*[.．/\-年]\s*(\d+)\s*[.．/\-月]\s*(\d+)/);
      if (dm) {
        parts.year = dm[1] ? String(parseInt(dm[1], 10)) : '';
        parts.month = dm[2] ? String(parseInt(dm[2], 10)) : '';
        parts.day = dm[3] ? String(parseInt(dm[3], 10)) : '';
      }
      if (timeMatch) {
        const hm = timeMatch[1].split(':');
        parts.hour = hm[0] != null ? String(parseInt(hm[0], 10)) : '';
        parts.minute = hm[1] != null ? String(parseInt(hm[1], 10)) : '';
      }
      // parseInt 失败会得到 'NaN' 字符串，统一清成空串
      Object.keys(parts).forEach((k) => {
        if (!/^\d+$/.test(parts[k])) parts[k] = '';
      });
      scene.timeParts = parts;
    }

    // [季节][温度][天气] 合成 weather 展示串
    const weatherParts = [raw['季节'], raw['温度'], raw['天气']]
      .map(trimStr)
      .filter(Boolean);
    if (weatherParts.length > 0) {
      scene.weather = weatherParts.join(' ');
    }

    if (trimStr(raw['地点'])) scene.location = trimStr(raw['地点']);
    if (trimStr(raw['场景'])) scene.scene = trimStr(raw['场景']);

    // 收拢未知标签
    Object.keys(raw).forEach((k) => {
      if (!['时间', '季节', '温度', '天气', '地点', '场景'].includes(k)) {
        warnings.push(`scene 中未知标签，已忽略：[${k}]`);
      }
    });

    return Object.keys(scene).length > 0 ? scene : null;
  }

  /**
   * 任务块字段 -> [{ id, text, status }]。
   * [推进中] -> status:'active'；[已完成] -> status:'achieved'。
   *
   * 契约：值形如 `cc_1730000001 潜入4楼取回U盘`——首个 token 若是 `cc_` 开头的
   * 任务编号则切出来当 id，余下部分作为展示文本。AI 漏写编号时 id 为空串，
   * 文本照旧展示（不丢信息），但不参与「任务完成」的持久判定（那条靠 id 认）。
   */
  function buildQuest(fields, warnings) {
    const list = [];
    /** 切首 token：`cc_xxx 任务名` → { id, text }，无编号时 id 为空串 */
    function splitMissionId(value) {
      const v = trimStr(value);
      const m = v.match(/^(cc_[A-Za-z0-9_-]+)\s*(.*)$/);
      if (!m) return { id: '', text: v };
      return { id: m[1], text: trimStr(m[2]) || m[1] };
    }
    fields.forEach(({ label, value }) => {
      if (label === '推进中') {
        list.push({ ...splitMissionId(value), status: 'active' });
      } else if (label === '已完成' || label === '已达成') {
        list.push({ ...splitMissionId(value), status: 'achieved' });
      } else {
        warnings.push(`quest 中未知标签，已忽略：[${label}]`);
      }
    });
    return list.length > 0 ? list : null;
  }

  /**
   * 线索块字段 -> 已提供的线索编号数组。
   * 契约：[已提供] clue_xxxx。宽容处理——只要标签是「已提供」（或空标签兜底），
   * 就把值当线索编号收下。真实的 id 匹配（含容错）交给 fork-run-ui 判定。
   */
  function buildClue(fields, warnings) {
    const ids = [];
    fields.forEach(({ label, value }) => {
      const v = trimStr(value);
      if (!v) return;
      if (label === '已提供' || label === '' || label === '提供') {
        ids.push(v);
      } else {
        warnings.push(`clue 中未知标签，已忽略：[${label}]`);
      }
    });
    return ids;
  }

  /* ---------------- 主解析 ---------------- */

  /**
   * 解析一轮 AI 回复。
   * @param {string} rawText
   * @returns {Object} 见契约第五节的数据形状
   */
  function parseRunReply(rawText) {
    const raw = typeof rawText === 'string' ? rawText : '';
    const warnings = [];

    const result = {
      body: '',
      scene: null,
      state: null,
      allies: [],
      npcs: [],
      quest: null,
      // 本轮概述（::: recap 块的纯文字内容）。供系统/队友等辅助记忆用，
      // 气泡不显示（在 :::  栅栏内，正文剥离时被摘掉）。模型漏输出则为空串，不兜底。
      recap: '',
      // AI 本轮声明「已在正文提供」的线索编号数组（来自 ::: clue 块的 [已提供] 字段）。
      // 空数组表示本轮未亮出任何线索。触发/解锁的判定在 fork-run-ui 侧完成。
      clues: [],
      raw,
      warnings
    };

    if (!raw.trim()) {
      return result; // 空输入直接返回空壳，不报错
    }

    const lines = raw.split(/\r?\n/);
    const bodyLines = [];

    // 已解析出的块：{ type, name, fields:[{label,value}] }
    const blocks = [];

    let i = 0;
    while (i < lines.length) {
      const head = matchBlockHead(lines[i]);
      if (!head) {
        // 不是块头，算正文
        bodyLines.push(lines[i]);
        i++;
        continue;
      }

      // 进入一个块，往下收字段直到块尾 / 下一个块头 / 文本结束（兜底 5）
      const block = { type: head.type, name: head.name, fields: [], rawLines: [] };
      i++;
      while (i < lines.length) {
        if (isBlockTail(lines[i])) {
          i++; // 吃掉块尾
          break;
        }
        if (matchBlockHead(lines[i])) {
          // 遇到下一个块头，当前块未闭合，就此收束（不吃这一行）
          warnings.push(`块 ::: ${block.type} 未见块尾，遇到下一块头提前收束`);
          break;
        }
        // recap 是纯文字块，整行原样留存（它不走 [标签] 值 的字段体系）
        block.rawLines.push(lines[i]);
        const field = matchField(lines[i]);
        if (field) {
          block.fields.push(field);
        } else if (lines[i].trim() && block.type !== 'recap') {
          // 块内出现非字段的非空行，收进 warnings 但不影响解析；recap 块例外（它本就是纯文字）
          warnings.push(`块 ::: ${block.type} 内非字段行被忽略：${lines[i].trim()}`);
        }
        i++;
      }
      blocks.push(block);
    }

    // 正文：去掉首尾多余空行
    result.body = bodyLines.join('\n').replace(/^\n+|\n+$/g, '').trim();

    // 逐块归类
    blocks.forEach((block) => {
      switch (block.type) {
        case 'scene': {
          const scene = buildScene(block.fields, warnings);
          if (scene) {
            if (result.scene) warnings.push('出现多个 scene 块，采用最后一个');
            result.scene = scene;
          }
          break;
        }
        case 'state': {
          const profile = buildProfile(block.fields, warnings, true);
          if (result.state) warnings.push('出现多个 state 块，采用最后一个');
          result.state = profile;
          break;
        }
        case 'ally': {
          const profile = buildProfile(block.fields, warnings, true);
          profile.name = block.name || '同行者';
          if (!block.name) warnings.push('ally 块缺少姓名，兜底为「同行者」');
          result.allies.push(profile);
          break;
        }
        case 'npc': {
          const profile = buildProfile(block.fields, warnings, false);
          profile.name = block.name || '现场目标';
          if (!block.name) warnings.push('npc 块缺少姓名，兜底为「现场目标」');
          result.npcs.push(profile);
          break;
        }
        case 'quest': {
          const quest = buildQuest(block.fields, warnings);
          if (quest) {
            if (result.quest) warnings.push('出现多个 quest 块，合并');
            result.quest = (result.quest || []).concat(quest);
          }
          break;
        }
        case 'clue': {
          const ids = buildClue(block.fields, warnings);
          ids.forEach((id) => {
            if (id && !result.clues.includes(id)) result.clues.push(id);
          });
          break;
        }
        case 'recap': {
          // 纯文字块：取原始行拼接去首尾空行即为概述。多个 recap 采用最后一个。
          const text = (block.rawLines || []).join('\n').replace(/^\n+|\n+$/g, '').trim();
          if (text) {
            if (result.recap) warnings.push('出现多个 recap 块，采用最后一个');
            result.recap = text;
          }
          break;
        }
        default:
          warnings.push(`未知块类型：${block.type}`);
      }
    });

    // 兜底 6：一个块都没解析出来，整段当正文（body 已经就是全文）
    if (
      !result.scene &&
      !result.state &&
      result.allies.length === 0 &&
      result.npcs.length === 0 &&
      !result.quest &&
      result.clues.length === 0 &&
      blocks.length === 0
    ) {
      result.body = raw.trim();
    }

    if (warnings.length > 0) {
      try {
        console.debug('[ForkRunParser] 解析警告：', warnings);
      } catch (e) { /* ignore */ }
    }

    return result;
  }

  return {
    parseRunReply
  };
})();

if (typeof window !== 'undefined') {
  window.ForkRunParser = ForkRunParser;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ForkRunParser;
}