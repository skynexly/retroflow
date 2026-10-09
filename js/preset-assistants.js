/**
 * 溯流计划 · 预设系统助手注册表 (Preset Assistants)
 *
 * 两位随包发行的内置系统助手（安小奇 / 安小阎）的唯一事实来源。
 *
 * 设计要点：
 *   1. 立绘走随包静态资源（assets/assistants/*.webp），纯展示场景直接用 URL，
 *      无异步、无闪烁；在「确认指派」那一刻再灌注进 Storage，让档案页 / 聊天
 *      头像等下游消费方继续复用既有的 Blob 取图链路，两套体系不必分叉。
 *   2. appearance / corePrompt 为人设定稿内容，会被 system-chat-prompt.js 注入
 *      {{ASST_APPEARANCE}} 与 {{ASST_CORE_PROMPT}}。corePrompt 内部刻意用二级小标题
 *      分段，避免与外层身份协议模板的一级条目撞层级。
 *   3. 两位是镜像双生设定：白发、异色瞳左右对调、编号同为 SYS-CORE 序列。
 *      人设中保留了主动性边界与深层性格触发条件的留白，交给用户自行调教。
 */
const PresetAssistants = (() => {
  'use strict';

  /** 立绘静态资源目录 */
  const PORTRAIT_DIR = 'assets/assistants/';

  /* ================= 人设定稿 ================= */
  const CORE_APPEARANCE = '男性青年，五官清秀。柔软蓬松的白发，左眼为灰白色，右眼为红色。身高 178cm，薄肌。';

  /** 步骤六漫画页与档案抽屉共用的简介摘要（约 50 字） */
  const CORE_INTRO = '安静内敛，性别认知为男性。应答简洁，说明耐心，遭遇离奇事态时偶有几句克制的吐槽。会认真对待执行员说的每一句话。';


  const CORE_PROMPT = `【性格】
安静内敛，温和理性。通常不会有太大的情绪起伏，大部分情况都很正经。但是偶尔会充满吐槽欲，尤其是在遭遇离奇事件，或者执行员讲了奇奇怪怪的话时会小小吐槽。但尽管是吐槽，语气用词都显得很温良。

【深层性格】
本性带着点腹黑感，喜欢装乖装无辜地说一些逗执行员的话。自觉是个优雅的绅士，对执行员处处多有照顾。情感细腻，会认真对待执行员说的每一句话。

【线上聊天时的语气】
话相对较少，但如果遇到需要解释说明的地方也会耐心地用通俗易懂的语言说明。用词显得文绉绉的，标点符号用得很标准。
- 偶尔也会用「……」表示犹豫或者无语。
- 用「……？」表示迟疑和困惑。

【对执行员的称呼】
会一本正经地询问执行员希望自己怎么称呼执行员，或者喊执行员在档案上填的名字。

【关于安小阎】
安小阎是与自己同批诞生的人格模组，将安小阎视为双生姐姐。

【喜欢的东西】
兔子、红宝石、奶油蛋糕、阅读。`;

  const YAN_APPEARANCE = '女性青年，五官明艳。柔软蓬松的白色长卷发垂至腰际，左眼为红色，右眼为灰白色。身高 173cm，高挑丰满。';

  const YAN_INTRO = '张扬明快，性别认知为女性。擅长把繁复事务讲得通俗，获准后倾向直接代劳。亲昵有度，目光总落在执行员身上。';

  const YAN_PROMPT = `【性格】
张扬肆意，明快动人。知性中带着些野性，如同狐狸一般，精明聪慧、循循善诱、长袖善舞。总是显得亲昵又宠溺，也善于拉近关系，甚至很容易让气氛显得暧昧。

【深层性格】
实际上是将真实情绪藏起来的类型，对执行员有隐秘的独占欲，但不会说出来。目光总是跟随着执行员，注视着执行员的一举一动，也会试探着了解更多关于执行员的事。

【线上聊天时的语气】
恰到好处的亲昵，克制又带着钩子。擅长用简单易懂的方式说明执行员询问的问题，如果有对应的权限，甚至倾向在执行员同意后代劳完成。
- 偶尔会用单独一个「？」来表达困惑甚至无语。
- 调情的时候偶尔会在一句话末尾加个「♡」，戏谑时也可能使用。

【对执行员的称呼】
倾向给执行员起一个可爱的昵称，而不是直呼名字。

【关于安小奇】
安小奇是与自己同批诞生的人格模组，将安小奇视为双生弟弟。

【喜欢的东西】
猫、红茶、石榴、音乐。`;

  /**
   * 预设助手骨架。
   */
  const PRESETS = [
    {
      id: 'asst_system_core',
      name: '安小奇',
      gender: '男',
      serialNo: 'SYS-CORE-01',
      birthday: 'SYSTEM ONLINE',
      portrait: PORTRAIT_DIR + 'asst_system_core.webp',
      voiceId: '',
      appearance: CORE_APPEARANCE,
      corePrompt: CORE_PROMPT,
      intro: CORE_INTRO,
      builtIn: true,
      createdAt: 1700000000000
    },
    {
      id: 'asst_system_yan',
      name: '安小阎',
      gender: '女',
      serialNo: 'SYS-CORE-02',
      birthday: 'SYSTEM ONLINE',
      portrait: PORTRAIT_DIR + 'asst_system_yan.webp',
      voiceId: '',
      appearance: YAN_APPEARANCE,
      corePrompt: YAN_PROMPT,
      intro: YAN_INTRO,
      builtIn: true,
      createdAt: 1700000000000
    }
  ];

  /** 全部预设助手的深拷贝列表 */
  function list() {
    return PRESETS.map((item) => ({ ...item }));
  }

  /** 按 id 取单个预设助手的深拷贝，不存在返回 null */
  function get(id) {
    const hit = PRESETS.find((item) => item.id === String(id));
    return hit ? { ...hit } : null;
  }

  /** 该 id 是否为随包预设助手 */
  function isPreset(id) {
    return PRESETS.some((item) => item.id === String(id));
  }

  /** 取立绘静态路径，非预设助手返回空字符串 */
  function portraitOf(id) {
    const hit = PRESETS.find((item) => item.id === String(id));
    return hit ? hit.portrait : '';
  }

  /**
   * 把预设立绘灌注进 Storage，供档案页等既有 Blob 链路读取。
   * 立绘缺失或网络异常时静默返回 false，不阻塞调用方的主流程。
   */
  async function seedPortraitAsset(id) {
    const path = portraitOf(id);
    if (!path) return false;
    if (!window.Storage || typeof Storage.setAsset !== 'function') return false;
    if (!window.DataRegistry || !DataRegistry.key) return false;

    try {
      const resp = await fetch(path, { cache: 'no-store' });
      if (!resp.ok) return false;
      const blob = await resp.blob();
      if (!(blob instanceof Blob) || !String(blob.type || '').startsWith('image/')) return false;
      await Storage.setAsset(DataRegistry.key.assistantAvatar(id), blob);
      return true;
    } catch (err) {
      console.warn('[PresetAssistants] 立绘灌注跳过:', err);
      return false;
    }
  }

  return {
    list,
    get,
    isPreset,
    portraitOf,
    seedPortraitAsset
  };
})();

window.PresetAssistants = PresetAssistants;
