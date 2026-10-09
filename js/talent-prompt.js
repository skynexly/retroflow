/**
 * 溯流计划 · 天赋激发提示词引擎 (Talent Awaken Prompt Builder)
 * 职责：
 *   1. 持有天赋激发协议提示词模板，填充执行员档案 / 部门 / 核心欲望占位符
 *   2. 重新激发（重 roll）时，把上一轮被废弃的五条一并回传，要求系统换方向重解析
 *   3. 解析模型返回的「【天赋名】+ 说明」文本，产出结构化候选数组
 *
 * 分层约定：本文件只负责「入役天赋激发」这一次性场景，不与系统助手对话提示词耦合。
 */
window.TalentPrompt = (() => {
  'use strict';

  /* ================= 天赋激发协议模板 ================= */

  const TALENT_AWAKEN_TEMPLATE = `## 溯流计划 · 天赋激发协议

你是溯流计划的系统。溯流计划是一个超越世界线的神秘系统组织，从无数平行世界中招募走投无路、心存执念的灵魂，赋予其「执行员」身份，派遣他们进入濒临崩溃的世界执行修正任务。执行员来到溯流计划的是灵魂体，肉身仍留存于原世界。攒够足额积分，系统便无条件实现执行员的一个心愿，将其送回原有世界。

现在，一名新执行员刚刚完成入役登记，你正在为其解析专属天赋。天赋是系统从执行员灵魂本质中读取、固化出的先天禀赋，将伴随其在所有副本中的行动，一经确认不可更改。

### 执行员档案
- 姓名：{{ENVOY_NAME}}
- 性别：{{ENVOY_GENDER}}
- 生日：{{ENVOY_BIRTHDAY}}
- 外貌：{{ENVOY_APPEARANCE}}
- 核心设定：{{ENVOY_PROFILE}}

### 任职部门
{{DEPT_NAME}}（{{DEPT_SUB}}）
{{DEPT_DESC}}

### 核心欲望
{{CORE_DESIRE}}

## 你的任务

根据以上全部信息，解析出 5 个候选天赋，供这名执行员从中挑选 1 个固化为自己的专属天赋。

生成要求：
1. 每一个天赋都必须与执行员的档案、部门与核心欲望存在千丝万缕的关联，脱胎于这些信息，而非凭空捏造。
2. 不可只是简单地放大执行员某方面的既有特质，或把设定原话换个说法复述一遍。你需要从其经历、性格、执念与渴求中向外衍生、发散，推演出有内在关联但别出心裁、令人意想不到的禀赋。
3. 五个候选天赋技能要避免重复或过分相似，可以从多个侧重点切入，从执行员的信息推测其可能会喜欢的方向，且每一个的天赋技能的能力大小需要平衡，不可出现其中一个过强或过弱的情况。

能力强度限制（严格遵守）：
- 天赋只会比普通人的能力高出些许，范畴严格限制于「现实中确实可能存在的天才能力」。
- 可参考的范畴示例：过目不忘、记忆宫殿、侧写能力、体魄超群、强烈直觉、心算能力、五感敏锐、通感能力、绝佳视力、心流状态、绝对音感、微表情辨识、空间感知、疼痛耐受、语言天赋、手部精细操控、生物钟精准、方向感卓绝等。
- 严禁出现任何超越现实的奇幻异能、超自然力量与系统外挂，例如时间停止、读心术、预知未来、瞬移、操控元素、因果干涉、不死之身等，一律不允许。
- 不要为天赋标注品阶、等级、评级，也不要附加「每日三次」「冷却时间」之类的游戏化机制。它们是与生俱来的身体与心智特质，不是可释放的招式。
{{REROLL_SECTION}}
## 输出格式

严格按照以下格式输出 5 条，不要输出任何多余的开场白、总结、编号或标题：

【天赋名称】
天赋说明

【天赋名称】
天赋说明

（以此类推，共 5 条）

天赋名称为 2 到 6 个字的中文短语，不要写成英文或中英混排。使用日常用语，或者通俗名词，不要使用生僻的复杂词汇或自造词。风格倾向文学性、哲学感、诗意化。
天赋说明为 40 到 80 字的一段话，只客观描述这项天赋本身的能力表现与作用方式。

天赋说明的硬性约束（严格遵守）：
- 禁止出现任何人称主语，例如「她」「他」「你」「执行员」「其」等，一律改用无主语的客观陈述句式。
- 禁止解释天赋的来历、成因或与过往经历的因果关联，禁止出现「由于」「因为」「源于」「得益于」「正是这段经历」这类溯因句式。
- 只写这项能力「是什么、在什么情形下如何发挥、能达到何种程度」，不写它「为何存在」。
- 禁止生造术语，禁止使用学科专有名词（神经、量子、拓扑、熵、阈值之类）；在保持严谨的同时尽量通俗易懂，能用常见词就不用生僻词，说明实际效果而不是解释原理。
- 关联性依然必须成立：天赋本身要贴合这名执行员，但这种贴合只体现在能力的选取上，不要在文字里明说。`;

  /* ================= 重新激发追加段 =================
     只带上「刚才那一轮」被废弃的五条，不累积历史批次：
     累积会让提示词越滚越长，且模型容易被大段负面清单带偏。 */

  const REROLL_TEMPLATE = `
## 重新解析要求

执行员对上一轮解析出的候选并不满意，要求重新解析。以下是上一轮被废弃的 5 个候选：

{{DISCARDED_LIST}}

本轮必须换一个方向重新解析：
- 不要重复上述任何一条天赋，也不要只是换个名字写出实质相同的能力。
- 请从执行员信息中尚未被挖掘的侧面切入，给出与上述五条气质、切入角度都明显不同的全新候选。
- 其余全部要求（关联性、衍生发散、能力强度限制、输出格式）保持不变。
`;

  /* ================= 取数 ================= */

  function getIdentity() {
    if (window.Store && window.Store.envoy && window.Store.envoy.identity) {
      return window.Store.envoy.identity;
    }
    return {};
  }

  function getPsychProfile() {
    if (window.PsychStore && typeof window.PsychStore.load === 'function') {
      try {
        return window.PsychStore.load() || {};
      } catch (_) {
        return {};
      }
    }
    return {};
  }

  function getVar(key, profile, identity) {
    switch (key) {
      case 'ENVOY_NAME':       return (identity.name || '').trim() || '执行员';
      case 'ENVOY_GENDER':     return (identity.gender || '').trim() || '未设定';
      case 'ENVOY_BIRTHDAY':   return (identity.birthday || '').trim() || '未设定';
      case 'ENVOY_APPEARANCE': return (identity.appearance || '').trim() || '未设定';
      case 'ENVOY_PROFILE':    return (identity.profile || '').trim() || '未设定';
      default: return '';
    }
  }

  /**
   * 拼装天赋激发的完整提示词。
   * @param {Array<{name:string,desc:string}>} [discarded] 上一轮被废弃的候选，重 roll 时传入
   * @returns {string}
   */
  function buildPrompt(discarded) {
    const identity = getIdentity();
    const profile = getPsychProfile();

    const dept = (window.PsychStore && typeof window.PsychStore.getDepartment === 'function')
      ? window.PsychStore.getDepartment(profile.department)
      : { name: '三千世界', sub: '快穿流派 · 节点修正', desc: '' };

    const coreDesire = (profile.coreDesire || '').trim() || '未填写';

    // 重新激发段：只在确实有上一轮候选时才拼入
    let rerollSection = '';
    const list = Array.isArray(discarded) ? discarded.filter((t) => t && t.name) : [];
    if (list.length) {
      const discardedList = list
        .map((t, i) => `${i + 1}. 【${t.name}】${(t.desc || '').trim()}`)
        .join('\n');
      rerollSection = REROLL_TEMPLATE.replace('{{DISCARDED_LIST}}', discardedList);
    }

    return TALENT_AWAKEN_TEMPLATE
      .replace('{{DEPT_NAME}}', dept.name || '')
      .replace('{{DEPT_SUB}}', dept.sub || '')
      .replace('{{DEPT_DESC}}', (dept.desc || '').trim())
      .replace('{{CORE_DESIRE}}', coreDesire)
      .replace('{{REROLL_SECTION}}', rerollSection)
      .replace(/\{\{(\w+)\}\}/g, (_, key) => getVar(key, profile, identity));
  }

  /* ================= 解析 ================= */

  /**
   * 解析模型返回的「【天赋名】+ 说明」文本。
   * 容错处理：剥离 markdown 加粗/标题符号、方括号变体、编号前缀与多余空行。
   * @param {string} raw
   * @returns {Array<{name:string,desc:string}>}
   */
  function parseTalents(raw) {
    const text = String(raw || '').trim();
    if (!text) return [];

    // 统一各类括号变体为【】，顺手清掉可能的 markdown 装饰与行首编号
    const normalized = text
      .replace(/\r\n/g, '\n')
      .replace(/[*#>`]/g, '')
      .replace(/[\[〔［]\s*/g, '【')
      .replace(/\s*[\]〕］]/g, '】')
      .replace(/^\s*\d+\s*[.、)）]\s*/gm, '');

    const out = [];
    // 以【名称】为锚点切段，段内余下的文字即为说明
    const re = /【\s*([^】\n]{1,20})\s*】([\s\S]*?)(?=【|$)/g;
    let m;
    while ((m = re.exec(normalized)) !== null) {
      const name = (m[1] || '').trim();
      const desc = (m[2] || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      if (name && desc) out.push({ name, desc });
    }

    return out;
  }

  /* ================= 公共接口 ================= */

  return {
    buildPrompt,
    parseTalents,
    TALENT_AWAKEN_TEMPLATE
  };
})();
