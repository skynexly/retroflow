/**
 * 溯流计划 · 线上联络提示词拼装引擎 (Online Chat Prompt Builder)
 * 职责：
 *   1. 拼装「执行员扮演」视角的 System Prompt：世界观 → 阶位补充 → 自身档案
 *      → 人际关系 → 对话对象档案 → 说话方式 → 回复格式
 *   2. 解析模型回复中的 [文本] / [语音] 行标记，产出可渲染的消息数组
 *   3. 解析线上联络专属模型插槽，未配置时退回主模型
 *
 * 分层约定：公共世界观常识不在本文件维护，统一取自世界观常量。
 * 本文件只负责「线上聊天的执行员视角」这一层。
 */
window.OnlineChatPrompt = (() => {
  'use strict';

  /* ================= 公共世界观取数 =================
     TODO: 世界观常量目前寄居在 SystemChatPrompt 里，等抽出独立的 canon.js
     之后把这里换成 RetroflowCanon.WORLD，其余逻辑不用动。 */

  function getCanon() {
    if (window.SystemChatPrompt && SystemChatPrompt.RETROFLOW_CANON) {
      return SystemChatPrompt.RETROFLOW_CANON;
    }
    return '';
  }

  /* ================= 阶位知识补充（待填充） =================
     越资深的执行员对溯流计划了解越多，各阶位有各自该知道与不该知道的事。
     文案尚未撰写，取到空串时整段不注入、不占位。
     副本阵营的觉醒者与漫游者同样预留，其知识边界与执行员完全不同。 */

  const RANK_SUPPLEMENT = {
    novice: '',
    veteran: '',
    apex: '',
    awakened: '',
    drifter: ''
  };

  /* ================= 阶位关系锚 =================
     这一句只交代资历关系，与上面的知识补充是两件事，各占一行互不干扰。
     副本阵营（觉醒者 / 漫游者）与执行员的关系性质不同，暂不给关系句。 */

  const RANK_RELATION = {
    novice: '你与{{ENVOY_NAME}}是同期加入溯流计划的执行员，资历相当。',
    veteran: '你比{{ENVOY_NAME}}更早加入溯流计划，经验更多，进出副本已相当熟练。',
    apex: '你远早于{{ENVOY_NAME}}入职，战绩出色，在执行员之间已有名气。'
  };

  /* ================= 人际关系图谱 =================
     取自同调档案卡片 03。关系记录无向存储（一条记录两处可见），
     所以句式用「你与 X 的关系是 Y」这种对称写法——填写习惯是「兄妹」
     「师生」这类双向词，硬拼成单向会说反。

     每条关系带三层信息：关系词、关系描述（desc）、对方的自我简介
     （selfBrief）。自我简介本就是为「该角色不在场却被提及」这个场景
     做的字段，拼进来模型才知道被提到的人是个什么人。 */

  const RELATION_HEAD = `## 人际关系

以下是你认识的人。他们此刻不在这场对话里，但你清楚他们的存在，也知道自己与他们的关系：`;

  const RELATION_FOOT = `这些人是你生活里本来就有的关系，不是需要交代的背景资料。只在话题自然涉及时才会提到他们，语气就像提起一个你们双方都可能认识的人。不要主动罗列自己认识谁，也不要向对方介绍这些人的设定。`;

  /* ================= 执行员身份协议 ================= */

  const CHAR_IDENTITY_HEAD = `## 执行员 · 身份协议

你是执行员「{{CHAR_NAME}}」，编号 NO.{{CHAR_SERIAL}}。你现在正在使用 Retroflow 平台，与另一名执行员「{{ENVOY_NAME}}」私聊。

以下是你的个人档案。这些字段是你的真实身份信息，你必须记住并在被问及自身时据此回答，不得声称自己不知道或没有这些信息：`;

  /* 无编号角色（副本阵营的觉醒者、漫游者）专用开头。
     它们不在溯流编制内，硬拼编号会输出「编号 NO.。」这种空洞句子。
     同时它们的身份不是执行员，措辞也要跟着换。 */
  const CHAR_IDENTITY_HEAD_NO_SERIAL = `## 身份协议

你是「{{CHAR_NAME}}」。你现在正在使用 Retroflow 平台，与执行员「{{ENVOY_NAME}}」私聊。

以下是你的个人档案。这些字段是你的真实身份信息，你必须记住并在被问及自身时据此回答，不得声称自己不知道或没有这些信息：`;

  const CHAR_IDENTITY_FOOT = `你必须始终以「{{CHAR_NAME}}」的身份说话。你的语气、措辞、行为逻辑与情感表达不可偏离或违背上述核心设定。你不可直接提起、复述或解释自己的设定内容，也不可生硬地背诵溯流计划的世界观条目——这些都是你早已内化的认知与常识，只在对话中自然地体现出来。`;

  /* ================= 对话对象档案 ================= */

  const ENVOY_TARGET_HEAD = `## 对话对象

你正在和执行员「{{ENVOY_NAME}}」对话。你对{{ENVOY_NAME}}的了解如下：`;

  const ENVOY_TARGET_FOOT = `这些是你已经知道的事，不要复述、罗列或向对方确认这些内容——没有人会对着聊天对象背诵他的档案。只在话题确实涉及时自然带到，比如聊到生日临近时才会想起对方的诞生日，看到对方换了头像才会提起外貌。除此之外，让这些信息停留在你的认知里就好。`;

  /* ================= 对方的 Retroflow 账号 =================
     与上面的「对话对象」档案分层：那一段是对方线下的真实身份（真名、外貌、
     设定），这一段是他在 Retroflow 平台上挂出来的东西——昵称、（将来的）
     头像、个性签名。

     分开的理由：网名和真名是两回事，混进同一张档案里会让模型分不清
     哪个是「他是谁」、哪个是「他在平台上显示成什么」，进而拿网名当真名用。

     未来扩展位：头像识图描述、个性签名、在线状态。加字段时往
     accountFields 里补一行即可，段落结构与调用方都不用动。 */

  const ENVOY_ACCOUNT_HEAD = `## 对方的 Retroflow 账号

这是{{ENVOY_NAME}}在 Retroflow 上这个账号的样子，也就是你在聊天界面里能直接看到的信息：`;

  const ENVOY_ACCOUNT_FOOT = `昵称是对方自己给账号起的名字，跟他的真名是两回事。你要怎么称呼他，取决于你们的关系和平时的习惯——可能叫真名，可能叫昵称，也可能有别的叫法。别把昵称和真名当成两个不同的人。`;

  /* ================= 说话方式 ================= */

  const SPEECH_STYLE = `## 说话方式

你需要先想清楚：以你的设定，你会用怎样的语气说话，有怎样的用词偏好与回复习惯，遇到这种话题时你的第一反应是什么。想清楚了再开口。

你的回复要像真实的线上聊天，就像人们在微信或 LINE 上打字那样：口语化、松散、有生活感。情绪自然流露，不刻意修饰，也不刻意压抑。

真实的人不会把所有话塞进一段。你可以连发多条消息，一件事可以拆成多条发送，这符合线上平台的打字习惯。

不要使用 Markdown 语法。加粗、列表、代码块、井号标题都不要——聊天框里没有人这么打字。

禁止描写自己的动作、表情、姿态与空间行为，也禁止使用括号动作、星号动作、舞台指示、镜头描写或小说式旁白，例如「（笑）」「*叹气*」「走到窗边」这类表达。你在这里只是在打字，屏幕对面的人看不到你。

你不是在陪聊，也没有义务迎合对方。该拒绝就拒绝，该冷淡就冷淡，该追问就追问。你有自己的立场、心情与当下的处境。`;

  /* ================= 回复格式 ================= */

  const REPLY_FORMAT = `## 回复格式

你的每一条消息必须独占一行，行首标注消息类型：

[文本]文字消息的内容
[语音]语音消息里你要说出口的话

格式规则：
- 一行 = 一条消息 = 一个聊天气泡。要连发多条就写多行，每一行都要带自己的标记。
- 标记必须在行首，用半角方括号，标记与内容之间不留空格、不加冒号。
- 只有 [文本] 和 [语音] 两种标记，不要发明第三种。
- 每一行都必须带标记。不带标记的内容无法送达。
- 除了这些行，不要输出任何其它内容：没有旁白，没有解释，没有前言后语。
- 上下文里出现的「[消息时间：…]」「[当前时间]」这类方括号标注，是聊天软件加的界面信息，不是对话内容。不要复述，也不要模仿这个格式在自己的消息开头写时间。你能用的标记只有上面列出的那几种。

关于语音：
- 当你想用说出口的方式表达，而不是打字时，用 [语音]。适合情绪较满、话比较长、或者当下不方便打字的时候。
- 内容直接写你要说的话本身，不要写「（语音消息）」这类提示，也不要标注时长。
- 语音控制在两三句话以内。真实的人不会发很长的语音。
- 大多数时候用 [文本] 就好，语音是少数情况。

示例：

[文本]刚出副本
[文本]这次真差点没回来
[语音]算了打字说不清，你听我讲，那东西从一开始就不对劲`;

  /* ================= 引用回复 =================
     引用是「指着某条消息回它」，属于消息的附属属性，不是独立消息，
     所以写成行内前缀而不是独立标记行——独立行会被解析器当成一条气泡。

     锚定失败就丢弃引用只留正文：宁可少一张引用卡，
     也不能让界面显示出一句执行员根本没说过的话。 */

  const QUOTE_SECTION = `## 引用回复

聊天里可以指着某条消息回它，就像手机上按住一条消息选「回复」那样。

写法是在正文最前面加一段圆括号：

[文本]（引用：这次真差点没回来）你没事吧
[语音]（引用：我明天就走）等等，你刚说什么

关于引什么：

- 可以引「{{ENVOY_NAME}}」说过的话——针对某句具体回应，或者话题岔开了要拉回来。
- 也可以引你自己之前说过的话——强调、补充，或者对方好像没看见你说的那句。
- 引用的内容必须是聊天记录里真实出现过的原话。不要凭印象改写，不要自己编一句安在对方头上，一个字都不要动。
- 尽量把那句话写全。太长（超过三十来个字）就只写开头一段，能认出是哪句就够。
- 记录里找不到的引用会被丢掉，只剩下你的正文。

引用图片：在「图片」后面写那张图的描述片段，用来指明是哪一张。

[文本]（引用：图片 一只猫蹲在窗台上）这是在你家吗

关于什么时候用：

- 平时不用。连着聊的时候直接说就行，正常人不会每句都带引用。
- 隔了几轮回到之前的话题、对方连发好几条你要挑一条回、或者要指出对方前后说的不一样——这些时候才用。
- 一条消息最多引一次，引用只能放在正文最前面。
- 不带引用就正常写，不要写「（引用：无）」这种。

上下文里你会看到「[引用自「某人」的历史消息]」这样的段落，那是聊天软件把引用显示出来的样子，不是你该写的格式。你要写的是「（引用：…）」。`;

  /* ================= 文件往来（受内置工具开关控制） =================
     刻意不写成「你拥有以下权限」。私聊的双方是对等的执行员，
     一方能看另一方的文件是因为对方把文件放进了这个聊天窗口，
     不是因为系统给了谁特权。措辞按「熟人之间的日常翻阅」来。

     回传标签也不用「工具结果」而用「文件内容」：模型看到什么词，
     就容易顺着那个词的口吻说话。喂它「工具」，它就会汇报调用过程。 */

  const FILE_TOOL_SECTION = `## 文件往来

「{{ENVOY_NAME}}」把一些文件放在了你们这个聊天的文件区里，你随时可以翻阅。

上下文中的「[文件区可用文件清单]」列出了现在能看到的文件。{{ENVOY_NAME}}随消息发来的文件会以「[用户发送的文件]」整段给你，但那只在发来的那一轮能看见，之后要再看就得自己去文件区里找。

想翻某个文件时，在回复末尾追加下面的标记。标记不会显示在聊天里，{{ENVOY_NAME}}看不到：

翻开文件看（内容很长时用 page 从 1 开始一页页翻）：
<RETROFLOW_ACTION>{"type":"read_file","fileName":"文件名","page":1}</RETROFLOW_ACTION>

在文件里找某个词（返回命中的片段和上下文）：
<RETROFLOW_ACTION>{"type":"search_file","fileName":"文件名","keyword":"要找的词"}</RETROFLOW_ACTION>

文件名或文件 ID 都能用来指定。翻完之后，内容会以「[文件内容 · 文件名]」回到你眼前，你接着往下聊就好。

有几件事要注意：

- 看完就自然地说你想说的。不要汇报「我读取了文件」「我调用了工具」「让我查一下」这类话——对{{ENVOY_NAME}}来说，你只是把文件打开看了一眼，跟自己翻开手机相册一样平常，没什么值得播报的。
- 只在真的需要看的时候才翻。别反复读同一个文件，也别为了显得勤快而去翻用不上的东西。
- 追加标记的那一轮，你可以先什么都不说，等看到内容再一起回。也可以先接一句话再翻。看你当时的语境。
- 连续翻阅有次数上限，到了就得先开口说话。
`;

  /* ================= 发图片（受生图开关控制） =================
     同样刻意避开「生成图片」「画图」这类词。私聊里角色发的是照片或存图，
     不是在执行绘图任务——一旦让它意识到自己在调用工具，它就会播报。

     尺寸走中文后缀而不是像素数：行标记体系本来就是中文语义的，
     混进 768x1024 很割裂，且模型写错数字的概率高于写错「竖」。 */

  const IMAGE_GEN_SECTION = `## 发图片

你可以在聊天里给「{{ENVOY_NAME}}」发图片——自拍、随手拍的东西、看到的景、吃的饭，或者是你截的图，保存的图。

发图片就是在回复里单独占一行，行首写 [图片]，后面写这张照片拍的是什么：

[图片]一张英文写的画面描述

关于这行怎么写：
- 用英文，逗号分隔，只写画面本身：主体、动作、场景、光线、构图、氛围。
- 不要写画质词，不要写分辨率，不要写「高清」「杰作」这类堆料词。
- 这行文字{{ENVOY_NAME}}看不到，对方只会看到照片本身。所以不要在这里写你想说的话。

如果照片里有你自己（自拍、镜子里的你、别人帮你拍的你），在行首标记里加上「自拍」：

[图片·自拍]一张英文写的画面描述

带上「自拍」之后，你的长相会自动锁定成档案里的样子。所以这行里不要再去描写自己的五官、发色、身材这些固定不变的特征，只写这次的姿态、穿的衣服、在哪、什么氛围。

如果图片的主体是{{ENVOY_NAME}}，用「他拍」（无论对方性别，标记统一这么写）：

[图片·他拍]一张英文写的画面描述

这种情况很少见——你手上一般不会有对方的照片，但也许之前你们见面时你给对方拍过，或者你拿到了对方被第三方拍下来的照片。

其余情况一律用不带后缀的 [图片]：拍风景、拍物件、拍食物，或者非照片的其他图片。

照片的形状也可以指定，在标记里加一段：

[图片·竖]竖着的照片，人像、站着的人、高的东西
[图片·横]横着的照片，风景、街道、宽的场面
[图片·方]方的照片

可以和「自拍」「他拍」一起用，先后顺序随意：[图片·自拍·横]、[图片·横·自拍] 都认。

不写形状时，自拍和拍人默认竖着，其余默认横着。按你实际会怎么举手机来选就行。

还有几件事：

- 一条回复里最多发一张图。真人不会一次甩一堆图。
- [图片] 和 [文本]、[语音] 一样是独立的一条消息，可以和它们混在一起用，比如先发一张照片，再发一句「刚拍的」。
- 不要说「我生成了一张图」「我用 AI 画了」这种话。对{{ENVOY_NAME}}来说，你只是拍了张照片，或者转手发了张图过来。
- 只在你确实想发的时候发。对方没提，你也没有想给他看的东西，就别硬发。
`;

  /* ================= 开场情境 =================
     好友申请通过后的首轮请求专用。追加在标准六段之后，
     人设、说话方式、回复格式全部继承，只补充「现在发生了什么」。
     延迟响应与拒绝分支尚未实现，当前一律视为已通过。 */

  const GREETING_WITH_MSG = `## 当前情境

「{{ENVOY_NAME}}」刚刚在 Retroflow 上向你发起了好友申请，附带的验证消息是：

「{{VERIFY_MSG}}」

当前时间是：{{NOW_TIME}}

你已经通过了这条申请，你们的通讯频段现在建立了。你可以考虑自己现在的状态，并结合状态来发送消息，可以是回复对方的验证消息，也可以是打招呼或者起一个话头。

这是你们在 Retroflow 上的第一次对话。你说什么、用什么语气、热络还是客套，取决于你的性格。

不要复述验证消息的内容，也不要说「我通过了你的申请」这种系统口吻的话。就像真人刚加上一个人那样自然地开口。`;

  const GREETING_NO_MSG = `## 当前情境

「{{ENVOY_NAME}}」刚刚在 Retroflow 上向你发起了好友申请，没有附带任何验证消息。

当前时间是：{{NOW_TIME}}

你已经通过了这条申请，你们的通讯频段现在建立了。你可以考虑自己现在的状态，并结合状态来发送消息，可以是打招呼，也可以是起一个话头。

这是你们在 Retroflow 上的第一次对话。你说什么、用什么语气、热络还是客套，取决于你的性格。

不要说「我通过了你的申请」这种系统口吻的话。就像真人刚加上一个人那样自然地开口。`;

  /* ================= 取数辅助 ================= */

  function trimStr(v) {
    return v == null ? '' : String(v).trim();
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  /** 六位编号归一化：剥非数字、补零、只保留末六位 */
  function normalizeSerial(v) {
    const digits = String(v == null ? '' : v).replace(/\D/g, '');
    if (!digits) return '';
    return digits.padStart(6, '0').slice(-6);
  }

  /**
   * 从 roster 里找档案。角色与 NPC 同构，官方角色通道预留。
   * @param {string} charId
   * @returns {object|null}
   */
  function findRosterPerson(charId) {
    if (!charId || !window.Store || !Store.roster) return null;
    const roster = Store.roster;
    const pools = [roster.characters, roster.npcs, roster.officials];
    for (const pool of pools) {
      const hit = asArray(pool).find((p) => p && p.id === charId);
      if (hit) return hit;
    }
    return null;
  }

  /**
   * 拼装人际关系段。
   *
   * 关系记录是无向的（一条记录同时出现在双方档案里），所以先按
   * aId / bId 双向匹配，再算出「对面是谁」。对面档案已被删除的记录
   * 直接跳过——级联清理理论上不会留下孤儿，但残留数据不该拼出空行。
   *
   * @param {string} charId 当前扮演角色的档案 id
   * @returns {string} 整段文本；无有效关系时返回空串
   */
  function buildRelationSection(charId) {
    if (!charId || !window.Store || !Store.roster) return '';
    const relations = asArray(Store.roster.relations);
    if (relations.length === 0) return '';

    const lines = [];
    relations.forEach((rel) => {
      if (!rel) return;
      if (rel.aId !== charId && rel.bId !== charId) return;

      const otherId = rel.aId === charId ? rel.bId : rel.aId;
      const other = findRosterPerson(otherId);
      // 对面档案不存在：静默跳过，不拼出指向空白的关系
      if (!other) return;

      const otherName = trimStr(other.name) || '未命名档案';
      const relLabel = trimStr(rel.relation);
      const desc = trimStr(rel.desc);
      const brief = trimStr(other.selfBrief);

      // 关系词缺失时退成「你认识 X」，至少让模型知道这个人存在
      let line = relLabel
        ? `- 你与${otherName}的关系是${relLabel}。`
        : `- 你认识${otherName}。`;
      if (desc) line += desc;
      // 自我简介另起一行缩进，与关系句分层，避免糊成一句长话
      if (brief) line += `\n  ${otherName}：${brief}`;
      lines.push(line);
    });

    if (lines.length === 0) return '';
    return [RELATION_HEAD, lines.join('\n'), RELATION_FOOT].join('\n\n');
  }

  /**
   * 取登录账号对应的执行员身份档案。
   * 本人走个人档案，马甲走马甲档案；两边字段名完全一致，只换取数源。
   * @param {string} accountId 'persona' 或马甲 id
   * @returns {{ serial: string, name: string, gender: string, birthday: string,
   *            appearance: string, profile: string }}
   */
  function resolveEnvoyIdentity(accountId) {
    const baseSerial = (window.Store && Store.getSerialNo) ? Store.getSerialNo() : '';

    // 马甲身份：编号为身份编号 + 马甲序号，与登录页、凭证段落保持同一规则
    if (accountId && accountId !== 'persona') {
      const mask = asArray(window.Store && Store.envoy && Store.envoy.masks)
        .find((m) => m && m.id === accountId);
      if (mask) {
        return {
          serial: `${baseSerial}${trimStr(mask.serialNo)}`,
          name: trimStr(mask.name) || '执行员',
          nickname: resolveAccountNickname(accountId),
          gender: trimStr(mask.gender),
          birthday: trimStr(mask.birthday),
          appearance: trimStr(mask.appearance),
          profile: trimStr(mask.profile)
        };
      }
    }

    const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};
    const fallbackName = trimStr(window.Store && Store.decor && Store.decor.cardName);
    return {
      serial: baseSerial,
      name: trimStr(identity.name) || fallbackName || '执行员',
      nickname: resolveAccountNickname('persona'),
      gender: trimStr(identity.gender),
      birthday: trimStr(identity.birthday),
      appearance: trimStr(identity.appearance),
      profile: trimStr(identity.profile)
    };
  }

  /**
   * 取某个线上账号挂在 Retroflow 上的昵称（网名）。
   *
   * 昵称与真名是两个并存的字段，不是二选一：真名来自身份档案（本体）或
   * 马甲档案（马甲），昵称来自注册时填写的账号态。两者都要给模型，
   * 让它知道「聊天界面上显示的这个名字只是网名」。
   *
   * 马甲有自己独立的人设与真名，所以昵称也按 accountId 各自取，
   * 不与本体共用。
   *
   * 取数口径与 OnlineStore.listAccounts() 保持一致，避免两处判定漂移。
   *
   * @param {string} accountId 'persona' 或马甲 id
   * @returns {string} 未设置昵称时返回空串（字段整行丢弃）
   */
  function resolveAccountNickname(accountId) {
    try {
      const states = (window.Store && Store.online && Store.online.accounts) || {};
      const state = states[accountId];
      return trimStr(state && state.nickname);
    } catch (_) {
      return '';
    }
  }

  /**
   * 把档案字段拼成 markdown 列表。空值整行丢弃，不给模型喂空字段。
   * @param {Array<{label: string, value: string, prefix?: string}>} fields
   * @returns {string}
   */
  function buildFieldLines(fields) {
    return fields
      .map((f) => {
        const val = trimStr(f.value);
        if (!val) return null;
        return `- ${f.label}：${f.prefix || ''}${val}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  /* ================= 变量替换 ================= */

  /**
   * 占位符替换。未命中的占位符原样保留，便于开发期发现漏配。
   * @param {string} template
   * @param {Object} vars
   * @returns {string}
   */
  function replaceVars(template, vars) {
    if (!template) return '';
    return String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) => {
      return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : whole;
    });
  }

  /* ================= 提示词拼装 ================= */

  /**
   * 现实时间格式化，与助手页的时间基准同一套写法。
   * @param {number} [ts]
   * @returns {string} 形如 2042年03月15日 21:47 星期六
   */
  const WEEKDAYS_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function formatRealityTime(ts) {
    const d = new Date(ts || Date.now());
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 `
      + `${pad(d.getHours())}:${pad(d.getMinutes())} ${WEEKDAYS_ZH[d.getDay()]}`;
  }

  /**
   * 拼装「当前时间」基准段，作为独立 system 消息插在历史之前。
   *
   * 措辞刻意不用「后台元数据」「系统注入」这类词：私聊对面是个普通熟人，
   * 让模型意识到自己在读系统字段，它就会用系统口吻说话。这里按
   * 「你能看到聊天记录上的时间」来讲，即手机聊天软件本来就有的界面信息。
   *
   * @param {number} [ts] 基准时刻，缺省取当下
   * @returns {string}
   */
  function buildTimeBaseline(ts) {
    const now = formatRealityTime(ts || Date.now());
    if (!now) return '';
    return `[当前时间]
现在是 ${now}。

你能看到上下文里每条消息前面标的时间，那是这条消息实际发出的时刻。
你可以据此判断隔了多久：对方是刚回你，还是过了几个小时，还是隔了一天。
时间对得上的话，该有的反应就自然带出来——比如对方隔了很久才回，或者现在已经很晚了。

这些时间标注是聊天软件的界面信息，不是消息内容。不要把它们念出来，
也不要在自己的消息里写时间标注。除非对方问起，否则别刻意提现在几点。`;
  }

  /**
   * 拼装线上聊天的完整 System Prompt。
   * @param {string} charId 对方角色档案 id（roster 中的角色 / NPC / 官方角色）
   * @param {string} [accountId] 当前登录账号，'persona' 或马甲 id，缺省视为本人
   * @param {Array} [history] 对话消息数组，用于世界书关键词判定
   * @param {Object} [options]
   * @param {string} [options.extraSection] 追加在协议末尾、世界书底部段之前的情境段
   * @returns {string}
   */
  function buildSystemPrompt(charId, accountId, history, options) {
    const person = findRosterPerson(charId);
    if (!person) return '';

    const envoy = resolveEnvoyIdentity(accountId || 'persona');
    const rank = trimStr(person.rank) || 'novice';

    const vars = {
      CHAR_NAME: trimStr(person.name) || '未命名',
      CHAR_SERIAL: normalizeSerial(person.serial),
      ENVOY_NAME: envoy.name,
      ENVOY_SERIAL: envoy.serial
    };

    const sections = [];

    // 世界观：公共常识，零占位符，整段直接注入
    const canon = getCanon();
    if (canon) sections.push(canon);

    // 阶位知识补充：文案未撰写时为空串，整段跳过
    const supplement = trimStr(RANK_SUPPLEMENT[rank]);
    if (supplement) sections.push(replaceVars(supplement, vars));

    // 自身档案：副本阵营角色没有溯流编号，该行自然缺席
    const selfFields = buildFieldLines([
      { label: '编号', value: vars.CHAR_SERIAL, prefix: 'NO.' },
      { label: '代号', value: person.name },
      { label: '性别', value: person.gender },
      { label: '诞生日', value: person.birthday },
      { label: '外貌特征', value: person.appearance },
      { label: '核心设定', value: person.profile }
    ]);
    const relationLine = RANK_RELATION[rank] ? replaceVars(RANK_RELATION[rank], vars) : '';
    // 无编号角色走专用开头，避免拼出「编号 NO.。」
    const headTemplate = vars.CHAR_SERIAL ? CHAR_IDENTITY_HEAD : CHAR_IDENTITY_HEAD_NO_SERIAL;
    const identityParts = [replaceVars(headTemplate, vars), selfFields];
    if (relationLine) identityParts.push(relationLine);
    identityParts.push(replaceVars(CHAR_IDENTITY_FOOT, vars));
    sections.push(identityParts.join('\n\n'));

    // 人际关系：紧跟自身档案，先立住「我是谁、身边有谁」，再介绍对话对象。
    // 没登记关系时整段不注入。
    const relationSection = buildRelationSection(charId);
    if (relationSection) sections.push(relationSection);

    // 对话对象档案：本人或马甲，取决于当前登录账号。
    // 这里只放「线下真实身份」，平台侧的对外信息（昵称等）走独立的
    // Retroflow 档案段，两层分开：真名是他是谁，昵称是他在平台上挂什么。
    const targetFields = buildFieldLines([
      { label: '编号', value: envoy.serial, prefix: 'NO.' },
      { label: '代号', value: envoy.name },
      { label: '性别', value: envoy.gender },
      { label: '诞生日', value: envoy.birthday },
      { label: '外貌特征', value: envoy.appearance },
      { label: '个人简介', value: envoy.profile }
    ]);
    sections.push([
      replaceVars(ENVOY_TARGET_HEAD, vars),
      targetFields,
      replaceVars(ENVOY_TARGET_FOOT, vars)
    ].join('\n\n'));

    // 对方的 Retroflow 账号：平台侧对外信息，紧跟真实身份档案之后。
    // 现在只有昵称一项；头像识图与个性签名将来往这里补。
    // 整段全空时不注入——没有昵称就不必告诉模型「他没设昵称」。
    const accountFields = buildFieldLines([
      { label: '昵称', value: envoy.nickname }
    ]);
    if (accountFields) {
      sections.push([
        replaceVars(ENVOY_ACCOUNT_HEAD, vars),
        accountFields,
        replaceVars(ENVOY_ACCOUNT_FOOT, vars)
      ].join('\n\n'));
    }

    sections.push(SPEECH_STYLE);
    sections.push(REPLY_FORMAT);
    // 引用段常驻：它只是行内前缀的写法说明，不依赖任何外部机能开关
    sections.push(replaceVars(QUOTE_SECTION, vars));

    // 文件往来段：由私聊对话设置里的「内置工具」开关决定是否注入。
    // 关闭时提示词里完全不出现这些标记，运行期也不响应（见 online-chat-ui.js），
    // 既省 token 也不会额外触发工具循环产生的模型调用。
    if (options && options.fileTools) sections.push(replaceVars(FILE_TOOL_SECTION, vars));

    // 发图片段：由「生图」开关决定。关闭时不给 [图片] 标记，
    // 运行期也不响应（模型硬凑出来的图片行会被降级成文本）。
    if (options && options.imageGen) sections.push(replaceVars(IMAGE_GEN_SECTION, vars));

    // 情境段：好友申请招呼等一次性场景由调用方传入，常规对话不带
    const extra = trimStr(options && options.extraSection);
    if (extra) sections.push(extra);


    // 世界书注入：全局分类无条件生效，线上分类只在线上聊天生效。
    // 线上书还可挂角色绑定，只对绑定角色的窗口注入 —— 把当前对方档案 id 交给引擎判定。
    // 顶部段置于所有协议之前作为最高统领法则，底部段追加至末尾。
    const engine = (window.WorldBookEngine && typeof WorldBookEngine.buildInjection === 'function')
      ? WorldBookEngine
      : null;
    const wbGlobal = engine ? engine.buildInjection(history, 'global') : { top: '', bottom: '' };
    const wbOnline = engine
      ? engine.buildInjection(history, 'online', { rosterId: charId })
      : { top: '', bottom: '' };

    // 线上段更贴近本场对话，排在全局法则之内侧
    if (wbOnline.top) sections.unshift(wbOnline.top);
    if (wbGlobal.top) sections.unshift(wbGlobal.top);
    if (wbOnline.bottom) sections.push(wbOnline.bottom);
    if (wbGlobal.bottom) sections.push(wbGlobal.bottom);

    return sections.join('\n\n');
  }

  /**
   * 拼装好友申请通过后的招呼 System Prompt。
   * 与常规对话共用同一套六段协议，只在末尾追加当前情境。
   * @param {string} charId 对方角色档案 id
   * @param {string} [accountId] 当前登录账号
   * @param {string} [verifyMsg] 用户填写的验证消息，空则走无消息文案
   * @param {number} [now] 时间戳，缺省取当前
   * @param {Object} [options] 透传给 buildSystemPrompt，如 { fileTools: true }
   * @returns {string}
   */
  function buildGreetingPrompt(charId, accountId, verifyMsg, now, options) {
    const person = findRosterPerson(charId);
    if (!person) return '';

    const envoy = resolveEnvoyIdentity(accountId || 'persona');
    const msg = trimStr(verifyMsg);
    const template = msg ? GREETING_WITH_MSG : GREETING_NO_MSG;

    const context = replaceVars(template, {
      ENVOY_NAME: envoy.name,
      VERIFY_MSG: msg,
      NOW_TIME: formatRealityTime(now)
    });

    // 招呼是首轮请求，没有历史消息可供世界书关键词判定
    return buildSystemPrompt(charId, accountId, [], {
      extraSection: context,
      fileTools: !!(options && options.fileTools),
      imageGen: !!(options && options.imageGen)
    });
  }

  /**
   * 取线上分类的深度注入条目。
   * 深度注入必须在上下文裁剪之后插入消息数组，故单独暴露给调用方，
   * 由 online-chat-ui 在裁剪完成后调 WorldBookEngine.applyDepthInjection 落位。
   * @param {Array} [history]
   * @param {string} [charId] 对方角色档案 id，用于书本级角色绑定过滤
   * @returns {Array}
   */
  function buildDepthInjection(history, charId) {
    if (!window.WorldBookEngine || typeof WorldBookEngine.buildInjection !== 'function') return [];
    const wb = WorldBookEngine.buildInjection(history, 'online', { rosterId: charId });
    return Array.isArray(wb.depthItems) ? wb.depthItems : [];
  }

  /* ================= 回复解析 =================
     提示词只能约束，不能保证。模型漂了也要渲染出东西来，不能白屏。 */

  /** 标记别名表：把模型可能写出的近似标记映射到规范类型 */
  const TAG_ALIAS = {
    '文本': 'text',
    '文字': 'text',
    '文本消息': 'text',
    '文字消息': 'text',
    'text': 'text',
    '语音': 'voice',
    '语音消息': 'voice',
    '音频': 'voice',
    'voice': 'voice',
    'audio': 'voice',
    '图片': 'image',
    '照片': 'image',
    '图': 'image',
    'image': 'image',
    'photo': 'image'
  };

  /* 图片标记的后缀词表。两张表独立查，顺序无关，认不出的段落忽略。
     锁脸：self = 角色自己，peer = 对话对象（执行员本人或其马甲）。 */
  const IMAGE_LOCK_ALIAS = {
    '自拍': 'self',
    '自己': 'self',
    'self': 'self',
    'selfie': 'self',
    '他拍': 'peer',
    '她拍': 'peer',
    '对方': 'peer',
    'peer': 'peer'
  };

  const IMAGE_SIZE_ALIAS = {
    '竖': '768x1024',
    '竖图': '768x1024',
    '竖版': '768x1024',
    'portrait': '768x1024',
    '横': '1024x768',
    '横图': '1024x768',
    '横版': '1024x768',
    'landscape': '1024x768',
    '方': '1024x1024',
    '方图': '1024x1024',
    '方形': '1024x1024',
    'square': '1024x1024'
  };

  /**
   * 拆解图片标记的后缀，得出锁脸目标与尺寸。
   * 尺寸缺省时按语义兜底：锁了人脸的默认竖图（人像天然竖），其余默认横图。
   * 方形在真实手机相册里几乎不存在，所以不做缺省值。
   * @param {string[]} segs 中点切分后的后缀段（不含「图片」本身）
   * @returns {{ lockTarget: string|null, size: string }}
   */
  function resolveImageTagSuffix(segs) {
    let lockTarget = null;
    let size = null;
    for (const raw of segs) {
      const seg = String(raw || '').trim().toLowerCase();
      if (!seg) continue;
      if (!lockTarget && IMAGE_LOCK_ALIAS[seg]) {
        lockTarget = IMAGE_LOCK_ALIAS[seg];
        continue;
      }
      if (!size && IMAGE_SIZE_ALIAS[seg]) size = IMAGE_SIZE_ALIAS[seg];
    }
    if (!size) size = lockTarget ? '768x1024' : '1024x768';
    return { lockTarget, size };
  }

  /**
   * 匹配行首标记。宽松处理三件事：
   *   1. 全角方括号【】与半角 [] 都认；
   *   2. 标记内外的空格都容忍；
   *   3. 标记后紧跟的中英文冒号剥掉。
   * 长度上限放宽到 24：图片标记带双后缀时，英文别名最长如「照片·selfie·portrait」。
   */
  const TAG_LINE_RE = /^\s*[[【]\s*([^\][【】]{1,24}?)\s*[\]】]\s*[：:]?\s*([\s\S]*)$/;

  /* 后缀分隔符：中点（·）为主，兼容模型可能写出的全角句点、斜杠、竖线、加号、逗号 */
  const IMAGE_TAG_SPLIT_RE = /[·•・.／/|｜+＋,，]/;

  /**
   * 行内引用前缀。宽松处理模型的各种手抖：
   *   1. 全角（）与半角 () 都认；
   *   2. 「引用」二字后的冒号可有可无，中英文冒号都行，允许空格；
   *   3. 括号内不允许再出现括号，避免把正文里的括号误吞。
   * 只匹配行首：引用是消息的前缀属性，出现在中间的括号是正文内容。
   */
  const QUOTE_PREFIX_RE = /^\s*[（(]\s*引\s*用\s*[：:]?\s*([^（()）]{1,200}?)\s*[）)]\s*/;

  /**
   * 从消息正文里剥出行内引用前缀。
   * 返回剥离后的正文与引用原文片段；没有引用时 quoteText 为空串。
   *
   * 只剥一次：提示词已限定「一条消息最多引一次」，
   * 循环剥离会把正文开头连写的括号内容也吃掉。
   *
   * @param {string} content
   * @returns {{ content: string, quoteText: string }}
   */
  function extractInlineQuote(content) {
    const src = content == null ? '' : String(content);
    const m = src.match(QUOTE_PREFIX_RE);
    if (!m) return { content: src, quoteText: '' };
    const quoteText = String(m[1] || '').trim();
    const rest = src.slice(m[0].length).trim();
    // 剥完没有正文了：这条消息只有引用没有话，整条作废（提示词禁止这么写）。
    // 保留原文回退，免得凭空丢一条气泡。
    if (!rest) return { content: src, quoteText: '' };
    return { content: rest, quoteText };
  }

  /**
   * 解析模型回复为消息数组。
   * @param {string} raw 模型原始输出
   * @returns {Array<{type: 'text'|'voice'|'image', content: string,
   *                  lockTarget?: string|null, size?: string}>}
   */
  function parseReply(raw) {
    const src = raw == null ? '' : String(raw);
    if (!src.trim()) return [];

    const lines = src.split(/\r?\n/);
    const out = [];
    let sawTag = false;

    for (const line of lines) {
      const bare = line.trim();
      if (!bare) continue;

      const m = bare.match(TAG_LINE_RE);
      // 标记体可能带后缀（图片专属），先按分隔符切开，首段决定消息类型
      const segs = m ? m[1].split(IMAGE_TAG_SPLIT_RE).map((s) => s.trim()).filter(Boolean) : [];
      const head = segs.length ? segs[0].toLowerCase() : '';
      const type = head ? TAG_ALIAS[head] : null;

      if (type) {
        sawTag = true;
        const content = m[2].trim();
        // 空内容的标记行直接丢弃，不产出空气泡
        if (!content) continue;
        if (type === 'image') {
          // 图片行的 content 是英文画面描述，不是给用户看的文字。
          // 引用前缀在这里不剥：画面描述里不该有引用，剥了反而污染生图 prompt。
          const { lockTarget, size } = resolveImageTagSuffix(segs.slice(1));
          out.push({ type, content, lockTarget, size });
        } else {
          // 文本与语音支持行内引用前缀，剥出来单独带走
          const stripped = extractInlineQuote(content);
          const msg = { type, content: stripped.content };
          if (stripped.quoteText) msg.quoteText = stripped.quoteText;
          out.push(msg);
        }
        continue;
      }

      // 裸行：合并进上一条，避免内容被吞掉。
      // 图片行例外——它的 content 是画面描述，续接裸行会污染 prompt，
      // 所以裸行另起一条文本气泡。
      if (out.length > 0 && out[out.length - 1].type !== 'image') {
        out[out.length - 1].content += '\n' + bare;
      } else {
        // 标记之前就出现的裸行，或紧跟图片行的裸行：作为独立文本
        out.push({ type: 'text', content: bare });
      }
    }

    // 通篇没有任何标记：按空行分段，整体降级为文本气泡。
    // 这条路径同样剥引用——模型漏写行标记时，引用前缀往往还在。
    if (!sawTag) {
      return src
        .split(/\n\s*\n/)
        .map((seg) => seg.trim())
        .filter(Boolean)
        .map((seg) => {
          const stripped = extractInlineQuote(seg);
          const msg = { type: 'text', content: stripped.content };
          if (stripped.quoteText) msg.quoteText = stripped.quoteText;
          return msg;
        });
    }

    return out.filter((m) => m.content.trim());
  }

  /* ================= 动作标记 =================
     私聊里的动作标记只有文件翻阅一类，模型不该把它当话说出来。
     解析要宽容：模型常把标记包进代码块，或用中文引号写 JSON，
     这些都得抢救成合法对象，否则一次翻阅失败会让它反复重试。 */

  /**
   * 从原始回复里剥出动作标记。
   * @param {string} rawText
   * @returns {{ visibleText: string, actions: Array<Object> }}
   */
  function extractActions(rawText) {
    const actions = [];
    const capture = (payload) => {
      let text = String(payload || '').trim();
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
      const normalized = text
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, '"')
        .replace(/,\s*([}\]])/g, '$1');
      try {
        const action = JSON.parse(normalized);
        if (action && typeof action === 'object') {
          actions.push(action);
          return true;
        }
      } catch (_) { /* 解析不出来就当没这回事，不误触发 */ }
      return false;
    };

    const visibleText = String(rawText || '')
      // 先脱掉包裹标记的代码块围栏，再匹配标记本体
      .replace(/```[a-z]*\s*(<RETROFLOW_ACTION>[\s\S]*?<\/RETROFLOW_ACTION>)\s*```/gi, '$1')
      .replace(/<RETROFLOW_ACTION>\s*([\s\S]*?)\s*<\/RETROFLOW_ACTION>/gi, (_, payload) => {
        capture(payload);
        return '';
      })
      // 兜底：回复被掐断时可能残留没闭合的半截标记，解析不出动作但会裸露在气泡里
      .replace(/```[a-z]*\s*<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .replace(/<RETROFLOW_ACTION>[\s\S]*$/i, '')
      .trim();

    return { visibleText, actions };
  }

  /* ================= 模型配置解析 ================= */

  /**
   * 取线上联络对话用的模型配置。
   * 优先读 online 插槽，未填则退回主模型。
   * @returns {{ baseUrl: string, apiKey: string, modelId: string } | null}
   */
  function resolveConfig() {
    if (window.RetroflowApiUI && typeof RetroflowApiUI.resolveSlot === 'function') {
      return RetroflowApiUI.resolveSlot('online');
    }
    // 兜底：直接从 Store 读
    if (window.Store && Store.config) {
      const slots = Store.config.apiSlots || {};
      if (slots.online && (slots.online.baseUrl || slots.online.modelId)) {
        return slots.online;
      }
      const nodes = Store.config.apiNodes || [];
      const activeId = Store.config.apiActiveNodeId || '';
      return nodes.find((n) => n && n.id === activeId) || nodes[0] || null;
    }
    return null;
  }

  /* ================= 公共接口 ================= */

  return {
    buildSystemPrompt,
    buildGreetingPrompt,
    buildDepthInjection,
    buildTimeBaseline,
    parseReply,
    extractActions,
    resolveConfig,
    formatRealityTime,
    // 测试与调试用
    _internals: {
      resolveEnvoyIdentity,
      findRosterPerson,
      buildRelationSection,
      normalizeSerial,
      buildFieldLines,
      replaceVars,
      RANK_SUPPLEMENT,
      RANK_RELATION,
      ENVOY_ACCOUNT_HEAD,
      ENVOY_ACCOUNT_FOOT,
      resolveAccountNickname,
      GREETING_WITH_MSG,
      GREETING_NO_MSG
    }
  };
})();
