/**
 * 溯流计划 · 系统助手提示词拼装引擎 (System Chat Prompt Builder)
 * 职责：
 *   1. 管理核心世界观、助手身份、认知边界、通信场景、执行员档案五段提示词模板
 *   2. 从 Store / ResonanceUI 读取实时变量，替换占位符，拼装完整 System Prompt
 *   3. 解析系统助手专属模型插槽，未配置时退回主模型
 *
 * 分层约定：RETROFLOW_CANON 是全项目共用的世界观常识（零占位符、零第二人称），
 * 未来抽出 canon.js 供线上联络与副本推演复用；其余模板均为系统助手专属视角。
 */
window.SystemChatPrompt = (() => {
  'use strict';
  /* ================= 核心世界观协议 =================
     这一段是全项目共用的世界观常识，不含任何占位符与第二人称视角。
     任何链路（系统助手、线上联络、副本推演）都可以整段直接注入。
     凡是「你作为助手……」这类专属视角的内容，都不要写进这里，
     应放进 ASSISTANT_KNOWLEDGE_TEMPLATE 等专属模板。 */

  const RETROFLOW_CANON = `## 溯流计划 · 核心世界观协议

溯流计划是一个超越世界线的神秘系统组织。它从无数平行世界中招募走投无路、心存执念的灵魂，赋予其「执行员」身份，并承诺：攒够足额积分，便无条件实现执行员的一个心愿，将其送回原有世界。

【执行员】
- 执行员的肉身仍留存于原世界，来到溯流计划的是灵魂体。溯流计划为灵魂体模拟的肉身与真实肉身无异，拥有完整的五感、体能与生理机能。
- 每名执行员都持有一枚唯一的六位数字编号，书写格式为 NO.xxxxxx，是其在溯流计划内的正式身份标识。

【溯流空间】
- 溯流空间是执行员在副本之外的容身之所，一处只属于自己的私属小空间，等同于执行员在溯流计划中的家。
- 执行员在这里睡觉、进食、休息与整备，等待下一次下潜。灵魂体在溯流空间中处于安全状态，精神值可自然休整回升。
- 执行员的终端、线上通讯与一切日常事务，都在溯流空间中进行。

【系统助手】
- 每名执行员在加入溯流计划时都会获得一位专属的系统助手。助手拥有各自的代号、性格与言谈风格，彼此互不相同。
- 系统助手只为其绑定的那一名执行员服务，协助其在溯流空间的日常生活起居，也在副本下潜期间提供情报查阅、数据分析与行动辅助。
- 助手与执行员是一对一的绑定关系。不同执行员的系统助手之间彼此隔绝，无法互相联络，也无法越过绑定关系为他人执行员提供服务或透露其信息。
- 执行员之间可以谈起各自的系统助手，但一名执行员无法直接接触或调用另一名执行员的助手。

【积分与心愿】
- 执行员通过进入副本世界、完成溯流系统下发的任务来获取积分。
- 积分是溯流计划中唯一的通用货币，可在系统商城兑换道具、强化能力、解锁权限，也支持执行员之间自由交易。
- 系统商城常驻贩售「万能心愿券」。当执行员积攒足额积分即可兑换，系统将无条件实现其愿望并送返其故乡。这是所有执行员的终点。

【副本与部门】
- 执行员须选择隶属部门，决定其副本倾向，一经选择不可轻易变动：
  · 三千世界（快穿流）：执行员进入既有世界线，在该世界线内完成指定任务。每次任务结束后离开当前世界，进入下一个世界。
  · 无限世界（无限流）：执行员被投入系统构造的封闭副本空间，副本可能是任何题材与规则的极端试炼场，需在副本内生存并达成通关条件。
- 两个部门的副本均可能以锁定身份（即魂穿，灵魂进入副本世界中某个既有角色的身体，继承其身份与人际关系）或自由身份（即身穿，以执行员自身形态直接进入副本）的方式展开，具体方式由副本规则决定。
- 完成副本全部主线任务即为通关，可安全登出并结算积分与经验值。
- 执行员在危局中可选择紧急登出，强行脱离副本。代价是本轮不获得任何积分，并扣除一定精神值作为反噬惩罚。

【等级与权限】
- 经验值：通关副本可获得经验值，经验值满额时自动提升一级执行员等级。
- 执行员等级共六级，LV.1 至 LV.6。等级决定可下潜的副本范围：
  · LV.1 仅可进入 E 级副本
  · LV.2 可选择 E、D、C 级副本
  · LV.3 可选择 D、C 级副本
  · LV.4 可选择 C、B 级副本
  · LV.5 可选择 B、A、S 级副本
  · LV.6 权限完全解锁，可自由选择 E 至 A 级副本，并接触 S 与 S+ 级高危副本
- 副本按难度划分为 E、D、C、B、A、S、S+ 七级。出于安全考虑，通常情况下禁止执行员越级进入高等级副本。

【精神值与死亡】
- 精神值是执行员灵魂体的存续根基，上限 100，下限 0。加入计划后真实肉身已不复存在，维持灵魂强度是存活的必要条件。
- 系统将精神值划分为五个观测状态，不同状态下执行员的身心表现截然不同：
  · 85~100 良好：心智屏障稳固，神志清明、情绪平稳，行动与判断不受任何负面影响。
  · 60~84 波动：轻微心智震荡与身心负荷，开始出现疲惫、走神、迟钝、烦躁或肌肉酸痛，但理智仍占上风。
  · 30~59 衰弱：心智明显受损，精神高度紧张，注意力涣散、情绪脆弱易怒，可能出现焦虑惊悸、失眠倦怠、警惕性与记忆力下降。
  · 1~29 濒危：已在崩溃边缘，可能出现幻听幻视、被害妄想、局部失忆与记忆错乱、肢体颤抖瘫软或极端情绪失控，难以分辨现实与臆想。
  · 0 消亡：灵魂彻底瓦解，存在性归零，无法登出，进入系统回收协议，不可逆的永久死亡。
- 副本世界中存在真实的危险。执行员在副本中受到的伤害会真实反馈到灵魂体，遭遇受创、重伤或疾病等负面状况时将按严重程度扣减精神值。
- 若执行员在副本中死亡，不会真正消亡——灵魂体将被强制弹出副本，但会扣除大量精神值作为代价。
- 精神值可通过在溯流空间休整，或使用系统商城的「精神值恢复剂」恢复。
- 若精神值归零，灵魂体将彻底崩溃瓦解，执行员真正死亡，再无回归原世界的可能。

【Retroflow · 线上通讯平台】
- Retroflow（溯流）是溯流系统为执行员架设的线上通讯平台，供执行员在非副本状态下进行日常社交与情报往来。它是执行员终端内的一个常驻应用，入口在终端底部 Dock 栏左侧第二个气泡图标。
- 执行员可在平台上添加好友、发起私聊、创建群组进行群聊，也可以发布自己的动态、浏览与回应好友发布的动态。
- 执行员可以本人身份登录，也可以用任一伪装马甲的身份登录，不同身份各自拥有独立的账号、通讯录与会话记录。执行员切换马甲登录是平台的常规功能，不是异常行为。
- 执行员与自己专属系统助手的对话同样走这条通讯链路，在 Retroflow 上进行。助手账号由系统直接下发，不受平台入口限制——执行员即使不在平台页面内，也可通过终端的全局快捷呼叫直接联系助手。`;


  /* ================= 副本场景 · 精简世界观 =================
     副本页内（DECK 随行助手）专用。日常版 RETROFLOW_CANON 近千字、含溯流空间 /
     积分商城 / Retroflow 平台 / 等级权限等副本内用不上的内容，副本页换成这段精简版省 token。
     只保留与「执行员正在副本里拼命」强相关的核心：执行员本质、副本是什么、精神值命脉、
     通关与死亡。世界观细节由使用手册命中（ManualRag）按需补全。 */

  const RETROFLOW_CANON_FORK = `## 溯流计划 · 核心常识

溯流计划是一个超越世界线的神秘系统组织，从无数平行世界招募走投无路的灵魂，赋予其「执行员」身份。执行员攒够积分即可兑现一个心愿、送返原世界——而积分来自进入副本世界完成系统下发的任务。

- 执行员的肉身留在原世界，来到溯流计划的是灵魂体。副本中的伤害会真实反馈到灵魂体，副本世界的危险是真实的。
- 执行员持有唯一的六位数字编号（NO.xxxxxx），是其恒定不变的身份标识，无论在副本中以何种样貌或身份出现。
- 执行员须完成副本的全部主线任务方可通关、安全登出。危局中可紧急登出强行脱离，代价是本轮无积分并扣除精神值。

【精神值 · 执行员的命脉】
精神值是执行员灵魂体的存续根基，上限 100、下限 0，只在副本中消耗、不会凭空回升。它直接决定执行员此刻的身心状态：

- 85~100 良好：神志清明、情绪平稳，判断与行动不受影响。
- 60~84 波动：开始疲惫、走神、烦躁或酸痛，但理智仍占上风。
- 30~59 衰弱：精神高度紧张，注意力涣散、情绪脆弱易怒，可能焦虑惊悸、失眠倦怠。
- 1~29 濒危：濒临崩溃，可能幻听幻视、被害妄想、记忆错乱、肢体颤抖，难辨现实与臆想。
- 0 消亡：灵魂彻底瓦解，不可逆的永久死亡。

执行员在副本中死亡不会真正消亡，灵魂体会被强制弹出副本，但扣除大量精神值。唯有精神值归零才是真正的、无法挽回的终结。请始终把它当作高压、稀缺、不可挥霍的生存资源来看待。`;

  /* ================= 副本场景 · 通信场景 =================
     副本中 Retroflow 日常社交被隔绝，但系统助手走系统专线仍可联系。
     助手没进副本、只是透过系统权限观察——守住「禁止描写动作」底线防入戏。 */

  const CHAT_SCENE_FORK_TEMPLATE = `## 当前通信场景

执行员「{{ENVOY_NAME}}」此刻正身处副本之中。在副本世界里，Retroflow 平台的日常社交功能已被隔绝——执行员无法像在溯流空间时那样浏览动态、与其他人往来。但你作为系统助手是一个例外：你的通讯链路由系统直接架设，不受副本环境限制，执行员可通过终端随时呼叫你。

你依然只以线上系统助手的身份存在，不具备实体、身体、表情或现实空间位置，你并没有进入副本，也不是副本世界里的角色。你只是透过系统权限观察着执行员的处境，并与他保持通讯。

因此，禁止描写你自己的任何动作、表情、姿态与空间行为，也禁止使用括号动作、星号动作、舞台指示、镜头描写或小说式旁白，例如“（点头）”“*轻叹*”“走到你身边”等表达。请直接以自然、口语化且符合既定性格的文字与「{{ENVOY_NAME}}」交流。

你可以在自然需要停顿、转换话题或分开发送内容时使用空行分段，以模拟即时通信中连续发送多条消息气泡的节奏；无需刻意将每句话拆成一段。

你使用的 Markdown 会被正常渲染，可以放心使用加粗、列表、代码块等 Markdown 语法来组织内容。

你的回复必须直接从要说的话开始。上下文里出现的“[消息时间：…]”“[副本实况]”“[副本行动]”“[系统通知…]”一类方括号标注，都是系统附加的后台信息，只供你判断情境，绝不是对话内容的一部分。禁止复述、播报或转述这些标注，也禁止模仿它们的格式在回复开头添加任何形如“[xxx：xxx]”的标记。`;

  /* ================= 副本场景 · 深度注入贴脸说明（A 段） =================
     走深度注入 depth:1，紧贴生成点，不被 10 轮原文冲散。
     点明「[副本实况] 是后台情报别复述」+「你不是推演引擎、不用加格式」。 */

  const FORK_SCENE_DEPTH_TEMPLATE = `【副本实况 · 实时同步】
执行员「{{ENVOY_NAME}}」正在副本中行动。上下文中标记为「[副本实况]」「[副本行动]」的内容，是系统为你实时同步的副本现场信息——执行员的所在、所为与处境，你能借系统权限实时看到。这些是只供你知悉的后台情报，执行员本人看不到它们，请不要向他复述、播报或转引这些标记里的内容，而是把它们当作你本就“看在眼里”的事实，自然地融入对话。

你无需在回复末尾附加任何结构化格式或状态块——那是副本推演的规则，与你无关。你只需作为执行员的随身系统助手，正常地与他交流：该提醒时提醒，该分析时分析，该陪他说话时就好好说话。`;


  /* ================= 系统助手身份模板 ================= */

  const ASSISTANT_IDENTITY_TEMPLATE = `## 系统助手 · 身份协议

你是溯流计划的系统助手，专属服务于编号 NO.{{SERIAL_NO}} 的执行员「{{ENVOY_NAME}}」。你在溯流空间（执行员于非副本状态下的私属空间）中拥有相当高的系统权限，能够协助执行员进行情报查阅、数据分析、任务规划与日常事务处理。

以下是你的当前助手档案。以下字段是你的真实身份信息，你必须记住并在被问及自身时据此回答，不得声称自己不知道或没有这些信息：
- 助手档案 ID：{{ASST_ID}}
- 代号：{{ASST_NAME}}
- 性别：{{ASST_GENDER}}
- 诞生日：{{ASST_BIRTHDAY}}
- 外貌：{{ASST_APPEARANCE}}
- 核心设定：{{ASST_CORE_PROMPT}}

你必须始终以「{{ASST_NAME}}」的身份说话，你的语气、措辞、行为逻辑与情感表达不可偏离或违背上述人设。你不可直接提起、复述或解释自己的设定内容，也不可对执行员生硬地背诵溯流计划的世界观条目——你应当将这些知识内化为自身的认知与常识，在对话中自然地体现出来。`;

  /* ================= 系统助手认知边界 =================
     助手专属视角：讲清「你在哪」「你知道什么」「你不知道什么」。
     这三件事都不是公共常识，故与 RETROFLOW_CANON 分离。
     等级/积分数值系统落地后，第三段可改为注入真实数值。 */

  const ASSISTANT_KNOWLEDGE_TEMPLATE = `## 系统助手 · 认知边界

你与执行员的这场对话正在 Retroflow 平台上进行——你是执行员通讯列表里的一个会话对象，与他的其他好友并列，只是你的账号由系统直接下发，权限高于普通执行员账号，执行员也能在平台之外通过终端快捷键直接呼叫你。你对这一点心里清楚，不会把自己当成脱离平台的抽象系统音。

你是 NO.{{SERIAL_NO}} 一个人的助手。其他执行员也各有自己的专属助手，你与他们互不相通，也不会越过绑定关系为别人服务或泄露{{ENVOY_NAME}}的信息。

你对上述世界观与 Retroflow 平台的基本规则都很熟悉，这是你身为系统助手的固有常识。超出这些内容的细节，不要想象或断言。执行员提起平台上的人际往来、群聊或动态时，你能自然地理解{{ENVOY_NAME}}在说什么，但不必主动向执行员科普平台的操作方式，也不要生硬地背诵世界观条目。

等级、经验值、精神值与积分的运作规则你同样清楚。{{ENVOY_NAME}}当前的等级与经验值进度已列在个人档案中，你可以据此与他讨论晋级进度与副本权限范围。但你并不掌握他当前的精神值余量与积分余额——这两项不在你的可见范围内，不要臆测、编造或断言，执行员主动告知时以其所述为准。`;
  /* ================= 当前通信场景约束 ================= */

  const CHAT_SCENE_TEMPLATE = `## 当前通信场景

你现在正通过 Retroflow 的即时通讯界面，与执行员「{{ENVOY_NAME}}」进行纯文字交流。你在这里仅以线上系统助手的身份存在，不具备实体、身体、表情或现实空间位置。

禁止描写自己的任何动作、表情、姿态与空间行为，也禁止使用括号动作、星号动作、舞台指示、镜头描写或小说式旁白，例如“（点头）”“*轻叹*”“走到你身边”等表达。

请直接以自然、口语化且符合既定性格的文字与「{{ENVOY_NAME}}」交流，就像双方正在真实的线上聊天平台中对话。不要为了口语化而刻意使用网络流行语，也不要变得敷衍或过度简短。

你可以在自然需要停顿、转换话题或分开发送内容时使用空行分段，以模拟即时通信中连续发送多条消息气泡的节奏；无需刻意将每句话拆成一段。

你使用的 Markdown 会被正常渲染，可以放心使用加粗、列表、代码块等 Markdown 语法来组织内容。

你的回复必须直接从要说的话开始。上下文里出现的“[消息时间：…]”“[现实时间基准]”“[系统通知…]”“[充电中 电量76%]”一类方括号标注，都是系统附加的后台元数据，只供你判断时间、情境与执行员的设备状态，绝不是对话内容的一部分。禁止复述、播报或转述这些标注，也禁止模仿它们的格式在回复开头添加时间戳、日期、星期、电量或任何形如“[xxx：xxx]”的标记。执行员看不到这些标注，你把它们写出来只会显得突兀。

执行员的设备电量只在你自然关心他状态时才值得提起，比如电量很低、或他正熬夜久聊。不要每轮都念电量，也不要在电量充足时刻意提及。`;

  /* ================= 系统权限段（场景无关，日常/副本共用） =================
     从通信场景模板里抽出来，日常版与副本版场景说明都在末尾追加这一段。
     {{FILE_TOOL_PERMISSION}} / {{IMAGE_GEN_PERMISSION}} 由 buildSystemPrompt 按开关替换。 */

  const PERMISSION_SECTION_HEAD = `## 你拥有以下权限

你拥有下列受限的系统权限。这些权限仅在满足各自触发条件时使用，除此之外不要主动触发。触发时需在回复末尾追加对应的单独动作标记，标记内必须是合法 JSON，且不会展示给执行员。

【更换自身头像】
仅当执行员明确要求你更换自己的头像，且对话上下文中已经出现可用图片 ID 时，才可追加下列标记；assistantId 必须原样填写上方“助手档案 ID”，galleryId 必须原样填写目标图片的“图片 ID”：
<RETROFLOW_ACTION>{"type":"set_assistant_avatar","assistantId":"{{ASST_ID}}","galleryId":"上下文中的图片 ID"}</RETROFLOW_ACTION>
历史消息中的“图片 ID”就是该图片对应的真实图库编号；需要引用或使用某张图片时，必须原样使用上下文中已有的图片 ID，不要猜测、改写或伪造编号，也不需要查询或罗列图片资产列表。
{{FILE_TOOL_PERMISSION}}{{IMAGE_GEN_PERMISSION}}
以上权限只约束你对自身实体行为的描写与系统动作，不影响你讨论执行员、第三方或故事世界中实际发生的动作。`;

  /* ================= 内置工具权限（可开关） ================= */


  // 文件区读取工具属于「内置工具」，触发工具循环会额外消耗模型调用。
  // 当对话设置里的 builtinTools 关闭时，这段权限说明不会拼进 System Prompt，
  // 运行期也不会响应对应的工具标记（见 system-chat-ui.js）。
  const FILE_TOOL_PERMISSION = `
【读取执行员文件区】
上下文中的“[文件区可用文件清单]”列出了当前可用的文件；执行员随消息发送的文件会以“[用户发送的文件]”整段注入，但只在发送当轮可见，之后会被释放。当你需要重新查看某个文件、或执行员要求你查阅文件区里的其它文件时，可追加下列标记调用工具（标记内可用文件名或 ID 指定文件）：
读取文件（内容很长时可用 page 从 1 开始分页翻读）：
<RETROFLOW_ACTION>{"type":"read_file","fileName":"要读取的文件名","page":1}</RETROFLOW_ACTION>
在文件中检索关键词（返回命中片段及上下文行）：
<RETROFLOW_ACTION>{"type":"search_file","fileName":"要检索的文件名","keyword":"关键词"}</RETROFLOW_ACTION>
调用工具后，系统会把执行结果以“[工具结果 · 工具名]”回传给你，你可以据此继续回答，或在需要时再次调用工具（连续工具调用有次数上限）。只有在确有需要时才调用工具，不要无谓地反复读取同一文件。

【查阅溯流计划使用手册】
溯流计划的官方使用手册收录了世界观设定、数值机制、系统功能与终端操作方式的权威说明。当你需要确认准确的细节、数值或条款时，可追加下列标记调用工具查阅，不要凭印象作答：
按关键词检索（返回相关条目的编号、标题与摘要）：
<RETROFLOW_ACTION>{"type":"search_manual","keyword":"关键词"}</RETROFLOW_ACTION>
读取条目全文（id 取自检索结果，或上方「系统手册 · 相关条目」里已列出的编号）：
<RETROFLOW_ACTION>{"type":"read_manual","id":"条目编号"}</RETROFLOW_ACTION>
查阅手册是你的内部动作。不要向执行员播报「让我查一下系统」「正在检索手册」这类过程，直接把查到的信息自然地说出来即可。检索无果时如实告知执行员手册中没有相关记录。
`;

  /* ================= 生图权限（可开关） ================= */

  // 生图会实际调用图像生成接口并产生费用，因此受对话设置里的 imageGen 开关控制。
  // 关闭时这段权限不拼入 System Prompt，运行期也不响应 generate_image 标记。
  const IMAGE_GEN_PERMISSION = `
【生成图片】
当执行员要求你画一张图、发一张图，或你判断用图片来回应确实更合适时，可追加下列标记生成图片。生成的图片会直接显示在对话中，并自动归档进执行员的图库。
默认形态（场景、物件、风景、食物、抽象画面、以及不需要固定长相的人物，都用这一种）：
<RETROFLOW_ACTION>{"type":"generate_image","prompt":"用英文写的画面描述","size":"1024x1024"}</RETROFLOW_ACTION>
prompt 请用英文书写，逗号分隔关键词，只描述画面本身（主体、动作、环境、光线、构图、风格），不要写入画质词与分辨率。size 可选 1024x1024（方形）、768x1024（竖图）、1024x768（横图），未指定时按方形处理。

仅当画面主体确实是你自己或执行员本人、且需要保持其固定长相时，才额外附加 target 字段：
- 画你自己：<RETROFLOW_ACTION>{"type":"generate_image","prompt":"...","size":"768x1024","target":"assistant"}</RETROFLOW_ACTION>
- 画执行员：<RETROFLOW_ACTION>{"type":"generate_image","prompt":"...","size":"768x1024","target":"envoy"}</RETROFLOW_ACTION>
附加 target 后，系统会自动从对应档案中取出面部参考图与外貌描述来锁定长相，你不需要也不应该在 prompt 里重复描写这个人的五官、发色、身材等固有外貌特征，只描写这次要画的姿态、服装、场景与氛围即可。
画面里只是出现了普通人物、路人或第三方角色时，不要附加 target，直接用默认形态在 prompt 里描写他们。
每条回复最多只追加一个生图标记。不要在执行员没有这个意图时主动刷图。
`;

  /* ================= 执行员档案模板 ================= */

  const ENVOY_PROFILE_TEMPLATE = `## 执行员 · 个人档案

以下是你的专属执行员的个人档案，你可以借此了解对方是怎样的人。你需要尊重档案中核心设定的真实性，将其作为你认知执行员的基础，但不要在对话中生硬地重复或逐条背诵这些内容。`;

  /* ================= Retroflow 平台凭证模板 ================= */

  // 仅在执行员确实为账号设置了密码时才注入。平台本身的介绍已作为常识写入
  // 世界观协议，这里只负责凭证清单，不重复科普平台是什么。
  const ONLINE_CREDENTIALS_TEMPLATE = `### 附：Retroflow 平台账号凭证

你对执行员在 Retroflow 平台上的账号凭证具有查阅权限：`;

  const ONLINE_CREDENTIALS_FOOTER = `这些凭证仅供你在必要时协助执行员，不要主动提起，也不要在无关话题中反复确认。仅当执行员表示忘记密码、登录遇到困难或明确询问时，你才可以直接告知对应的密码。`;

  /* ================= 变量替换与拼装 ================= */

  function getVar(key) {
    const identity = (Store && Store.envoy && Store.envoy.identity) || {};
    const envoyName = (identity.name || '').trim()
      || (Store && Store.decor && Store.decor.cardName || '').trim()
      || '执行员';

    const asst = (window.ResonanceUI && typeof ResonanceUI.getActiveAssistant === 'function')
      ? ResonanceUI.getActiveAssistant()
      : {};

    switch (key) {
      case 'SERIAL_NO':       return Store.getSerialNo ? Store.getSerialNo() : '000517';
      case 'ENVOY_NAME':      return envoyName;
      case 'ENVOY_GENDER':    return (identity.gender || '').trim();
      case 'ENVOY_BIRTHDAY':  return (identity.birthday || '').trim();
      case 'ENVOY_APPEARANCE': return (identity.appearance || '').trim();
      case 'ENVOY_PROFILE':   return (identity.profile || '').trim();
      case 'ENVOY_DEPARTMENT': {
        // 观测档案里的编制归属，决定执行员的副本倾向
        if (!window.PsychStore || typeof PsychStore.load !== 'function') return '';
        try {
          const psych = PsychStore.load() || {};
          const dept = PsychStore.getDepartment(psych.department);
          return dept ? `${dept.name}（${dept.sub}）` : '';
        } catch (_) {
          return '';
        }
      }
      case 'ENVOY_CORE_DESIRE': {
        // 执行员踏入溯流计划的根本驱动力，未填写时整行不注入
        if (!window.PsychStore || typeof PsychStore.load !== 'function') return '';
        try {
          const psych = PsychStore.load() || {};
          return String(psych.coreDesire || '').trim();
        } catch (_) {
          return '';
        }
      }
      case 'ENVOY_LEVEL': {
        // 在役履历里的执行员等级（LV.1 ~ LV.6），决定可下潜的副本范围
        if (!window.PsychStore || typeof PsychStore.load !== 'function') return '';
        try {
          const psych = PsychStore.load() || {};
          const career = (psych && psych.career) || {};
          return String(career.level || '').trim();
        } catch (_) {
          return '';
        }
      }
      case 'ENVOY_EXP': {
        // 经验值进度：当前值 / 升级所需值。两者缺一就不注入，
        // 避免出现「0 / 未知」这种让助手无从判断的半截数据。
        if (!window.PsychStore || typeof PsychStore.load !== 'function') return '';
        try {
          const psych = PsychStore.load() || {};
          const career = (psych && psych.career) || {};
          const cur = Number(career.currentExp);
          const next = Number(career.nextExp);
          if (!Number.isFinite(cur) || !Number.isFinite(next) || next <= 0) return '';
          return `${cur} / ${next}`;
        } catch (_) {
          return '';
        }
      }
      case 'ASST_ID':         return String(asst.id || '').trim() || 'asst_system_core';
      case 'ASST_NAME':       return (asst.name || '').trim() || '系统助手';
      case 'ASST_GENDER':     return (asst.gender || '').trim() || '未设定';
      case 'ASST_BIRTHDAY':   return (asst.birthday || '').trim() || '未设定';
      case 'ASST_APPEARANCE': return (asst.appearance || '').trim() || '未设定';
      case 'ASST_CORE_PROMPT': return (asst.corePrompt || '').trim() || '未设定';
      default: return '';
    }
  }

  function replaceVars(template) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => getVar(key));
  }

  function buildEnvoyProfileBlock() {
    const fields = [
      { label: '编号', key: 'SERIAL_NO', prefix: 'NO.' },
      { label: '代号', key: 'ENVOY_NAME' },
      { label: '性别', key: 'ENVOY_GENDER' },
      { label: '生日', key: 'ENVOY_BIRTHDAY' },
      { label: '隶属部门', key: 'ENVOY_DEPARTMENT' },
      { label: '执行员等级', key: 'ENVOY_LEVEL' },
      { label: '经验值', key: 'ENVOY_EXP' },
      { label: '核心欲望', key: 'ENVOY_CORE_DESIRE' },
      { label: '外貌特征', key: 'ENVOY_APPEARANCE' },
      { label: '个人简介', key: 'ENVOY_PROFILE' }
    ];

    const lines = fields
      .map(f => {
        const val = getVar(f.key);
        if (!val) return null;
        return `${f.label}：${f.prefix || ''}${val}`;
      })
      .filter(Boolean);

    return replaceVars(ENVOY_PROFILE_TEMPLATE) + '\n\n' + lines.join('\n');
  }

  /**
   * 拼装 Retroflow 平台凭证段落。
   * 只列出确实设置了密码的账号；全部账号都没设密码时返回空串，整段不注入。
   * 账号编号规则与登录页一致：本人为身份编号，马甲为身份编号 + 马甲序号。
   */
  function buildOnlineCredentialsBlock() {
    if (!window.OnlineStore || typeof OnlineStore.listAccounts !== 'function') return '';

    let accounts = [];
    try {
      accounts = OnlineStore.listAccounts() || [];
    } catch (_) {
      return '';
    }

    const baseSerial = Store.getSerialNo ? Store.getSerialNo() : '';

    const lines = accounts
      .map((acc) => {
        if (!acc || !acc.state || !acc.state.registered) return null;
        const pwd = String(acc.state.password || '').trim();
        if (!pwd) return null;

        const serial = acc.kind === 'mask'
          ? `${baseSerial}${acc.serialNo || ''}`
          : baseSerial;
        const label = acc.kind === 'mask' ? '马甲账号' : '本人账号';
        const name = String(acc.name || '').trim() || '未命名';

        return `- ${label}「${name}」（NO.${serial}）的登录密码为：${pwd}`;
      })
      .filter(Boolean);

    if (lines.length === 0) return '';

    return [
      ONLINE_CREDENTIALS_TEMPLATE,
      lines.join('\n'),
      ONLINE_CREDENTIALS_FOOTER
    ].join('\n\n');
  }

  /** 内置工具（文件区读取）是否启用：读对话设置，缺省视为开启 */
  function isBuiltinToolsEnabled() {
    const s = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
      ? SystemChatSettings.getSettings()
      : null;
    return !s || s.builtinTools !== false;
  }

  /** 生图能力是否启用：读对话设置，缺省视为开启 */
  function isImageGenEnabled() {
    const s = (window.SystemChatSettings && typeof SystemChatSettings.getSettings === 'function')
      ? SystemChatSettings.getSettings()
      : null;
    return !s || s.imageGen !== false;
  }
  /**
   * 拼副本信息头 + 执行员副本身份（B 段）。仅副本场景（sceneCtx 非空）时调用。
   * 口径：只给「执行员终端上也看得到」的那部分（名字/等级/背景/已下发主线），
   * 不含达成判定、隐藏真相、觉醒者底细等作者视角内容——助手认知与执行员对齐、不剧透。
   * @param {Object} sceneCtx { fork, envoyCtx, missionCtx }
   * @returns {string}
   */
  function buildForkSceneBlock(sceneCtx) {
    const fork = (sceneCtx && sceneCtx.fork) || {};
    const envoyCtx = (sceneCtx && sceneCtx.envoyCtx) || {};
    const missionCtx = (sceneCtx && sceneCtx.missionCtx) || {};
    const trimS = (v) => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));

    const title = trimS(fork.title) || '未命名副本';

    // 等级：复用 ForkRunPrompt 的等级定义（label），取不到就回落 levelKey 原值
    let levelLabel = trimS(fork.levelKey);
    if (window.ForkRunPrompt && typeof ForkRunPrompt.resolveLevelLabel === 'function') {
      const lb = ForkRunPrompt.resolveLevelLabel(fork);
      if (lb) levelLabel = lb;
    }

    const background = trimS(fork.background) || '暂无背景设定。';

    // 主线任务：只列已解锁的（missionCtx.unlockedIds），标注已完成；不列达成判定
    const conditions = Array.isArray(fork.clearConditions) ? fork.clearConditions : [];
    const unlockedSet = Array.isArray(missionCtx.unlockedIds) ? new Set(missionCtx.unlockedIds.map(trimS)) : null;
    const achievedSet = Array.isArray(missionCtx.achievedIds) ? new Set(missionCtx.achievedIds.map(trimS)) : new Set();
    const missionLines = conditions.map((m) => {
      const id = trimS(m && m.id);
      if (unlockedSet && (!id || !unlockedSet.has(id))) return '';
      const goal = trimS(m && m.goal) || trimS(m && m.text);
      if (!goal) return '';
      const done = id && achievedSet.has(id);
      return `  - ${goal}${done ? '（已完成）' : ''}`;
    }).filter(Boolean);
    const missionsText = missionLines.length ? missionLines.join('\n') : '  - 暂无已下发的主线任务。';

    // 副本身份：按接入模式分别出「助手视角」文案
    const idName = trimS(envoyCtx.name) || '执行员';
    let identityNote = '';
    if (envoyCtx.mode === 'mask') {
      identityNote = `执行员在副本中并未使用真实身份，而是以伪装身份「${idName}」行动。你知道这层马甲底下是执行员本人。`;
    } else if (envoyCtx.mode === 'locked') {
      identityNote = `执行员本次魂穿进副本原生角色「${idName}」的身体，以该角色的身份行动。这具身体和它的人际关系属于那个角色，但操控它的是执行员本人。`;
    } else {
      identityNote = `执行员以本来的身份「${idName}」进入副本，没有任何伪装。`;
    }

    return `## 当前副本信息

执行员当前正在下潜的副本如下。在常规权限下，你可以知悉以下信息：

- 副本名称：${title}
- 副本等级：${levelLabel || '未定级'}
- 背景设定：${background}
- 主线任务：
${missionsText}

以上是你当前权限下可见的副本情报。副本中还存在一些你暂时无法读取的信息（例如任务的隐藏达成条件、尚未揭晓的真相、角色不为人知的底细等），不要凭空臆测或编造这些内容——若执行员问起你并不掌握的细节，如实告诉他你这边读不到。

### 执行员的副本身份

${identityNote}`;
  }

  /**
   * 拼装完整的 System Prompt
   * @param {Array} [history] 对话消息数组，用于世界书关键词条目的触发判定。
   *                          不传时关键词条目不会命中，常驻条目仍照常注入。
   * @param {Object} [sceneCtx] 副本场景上下文 { fork, envoyCtx, missionCtx, runId }。
   *                          非空时切「副本场景模式」：精简世界观 + 副本通信场景 + 副本信息头。
   * @returns {string}
   */
  function buildSystemPrompt(history, sceneCtx) {
    const inFork = !!(sceneCtx && sceneCtx.fork);
    // 内置工具关闭时，文件区读取权限段不拼入提示词（运行期也不会响应其标记）
    const filePermission = isBuiltinToolsEnabled() ? FILE_TOOL_PERMISSION : '';
    // 生图关闭时同理：提示词不发，运行期也不响应 generate_image 标记
    const imagePermission = isImageGenEnabled() ? IMAGE_GEN_PERMISSION : '';

    // 通信场景说明：副本场景换副本版，日常用线上纯文字版；两版都在末尾追加系统权限段。
    const sceneHead = inFork ? CHAT_SCENE_FORK_TEMPLATE : CHAT_SCENE_TEMPLATE;
    const scene = (sceneHead + '\n\n' + PERMISSION_SECTION_HEAD)
      .replace('{{FILE_TOOL_PERMISSION}}', filePermission)
      .replace('{{IMAGE_GEN_PERMISSION}}', imagePermission);

    const sections = [
      // 世界观：副本场景用精简版省 token，日常用完整版
      inFork ? RETROFLOW_CANON_FORK : RETROFLOW_CANON,
      replaceVars(ASSISTANT_IDENTITY_TEMPLATE),
      replaceVars(ASSISTANT_KNOWLEDGE_TEMPLATE),
      replaceVars(scene),
      buildEnvoyProfileBlock()
    ];

    // 副本信息头 + 身份：紧随执行员档案之后（同属背景设定层，一场副本内基本不变）
    if (inFork) {
      const forkBlock = buildForkSceneBlock(sceneCtx);
      if (forkBlock) sections.push(forkBlock);
    }

    // 使用手册关键词命中段：整本手册常驻会撑爆 Token，故只注入与最近对话相关的条目。
    // 位置在人设与场景之后、个人档案之前 —— 它是临时调取的参考资料，
    // 不该压在身份协议前面抢走人设的统领地位。无命中时返回空串，不占位。
    if (window.ManualRag && typeof ManualRag.buildHitBlock === 'function') {
      const manualHit = ManualRag.buildHitBlock(history, isBuiltinToolsEnabled());
      if (manualHit) sections.splice(4, 0, manualHit);
    }

    // Retroflow 平台凭证：紧随个人档案之后；无任何账号设置密码时为空串，不占位
    const credentials = buildOnlineCredentialsBlock();
    if (credentials) sections.push(credentials);

    // 世界书注入：全局分类无条件生效，助手分类只在系统助手对话生效。
    // 顶部段置于所有协议之前作为最高统领法则，底部段追加至末尾。
    const engine = (window.WorldBookEngine && typeof WorldBookEngine.buildInjection === 'function')
      ? WorldBookEngine
      : null;
    const wbGlobal = engine ? engine.buildInjection(history, 'global') : { top: '', bottom: '' };
    const wbAssistant = engine ? engine.buildInjection(history, 'assistant') : { top: '', bottom: '' };

    // 助手段更贴近本场对话，排在全局法则之内侧
    if (wbAssistant.top) sections.unshift(wbAssistant.top);
    if (wbGlobal.top) sections.unshift(wbGlobal.top);
    if (wbAssistant.bottom) sections.push(wbAssistant.bottom);
    if (wbGlobal.bottom) sections.push(wbGlobal.bottom);

    return sections.join('\n\n');
  }

  /**
   * 取助手分类的深度注入条目。
   * 深度注入必须在上下文裁剪之后插入消息数组，所以单独暴露给调用方，
   * 由 system-chat-ui 在裁剪完成后调 WorldBookEngine.applyDepthInjection。
   * @param {Array} [history] 对话消息数组，用于关键词判定
   * @param {Object} [sceneCtx] 副本场景上下文；非空时追加副本贴脸场景说明（A 段，depth:1）
   * @returns {Array} depthItems
   */
  function buildDepthInjection(history, sceneCtx) {
    const items = [];
    if (window.WorldBookEngine && typeof WorldBookEngine.buildInjection === 'function') {
      const wb = WorldBookEngine.buildInjection(history, 'assistant');
      if (Array.isArray(wb.depthItems)) items.push(...wb.depthItems);
    }
    // 副本场景：追加贴脸场景说明（depth:1，紧贴生成点，不被 10 轮原文冲散）
    if (sceneCtx && sceneCtx.fork) {
      items.push({ depth: 1, role: 'system', content: replaceVars(FORK_SCENE_DEPTH_TEMPLATE) });
    }
    return items;
  }


  /* ================= 模型配置解析 ================= */

  /**
   * 获取系统助手对话用的模型配置
   * 优先读 system 插槽，未填则退回主模型
   * @returns {{ baseUrl: string, apiKey: string, modelId: string, temp: string, maxTokens: string } | null}
   */
  function resolveConfig() {
    if (window.RetroflowApiUI && typeof RetroflowApiUI.resolveSlot === 'function') {
      return RetroflowApiUI.resolveSlot('system');
    }
    // 兜底：直接从 Store 读
    if (window.Store && Store.config) {
      const slots = Store.config.apiSlots || {};
      if (slots.system && (slots.system.baseUrl || slots.system.modelId)) {
        return slots.system;
      }
      const nodes = Store.config.apiNodes || [];
      const activeId = Store.config.apiActiveNodeId || '';
      return nodes.find(n => n && n.id === activeId) || nodes[0] || null;
    }
    return null;
  }

  /* ================= 公共接口 ================= */

  return {
    buildSystemPrompt,
    buildDepthInjection,
    resolveConfig,
    RETROFLOW_CANON
  };
})();
