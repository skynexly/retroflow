/**
 * 溯流计划 · 新执行员入役开场向导 (Onboarding UI)
 * 
 * 步骤一：欢迎页 (Welcome / 聘用接入协议)
 * 包含调试期悬浮入口球、三个机能抽屉弹窗 (01 机构目标 / 02 岗位规约 / 03 权责声明)
 */
(function () {
  'use strict';

  // 节点别名与模型 ID 来自用户输入，注入 innerHTML 前必须转义
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;')
      .replace(/'/g, '&#39;');
  }

  // 纯矢量 SVG 图标集（严格禁用 emoji）
  const ICONS = {
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
    arrowRight: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`,
    arrowLeft: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 16.59L10.83 12l4.58-4.59L14 6l-6 6 6 6 1.41-1.41z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>`,
    gear: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
    cpu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2v2h6V2h2v2h1c1.1 0 2 .9 2 2v1h2v2h-2v6h2v2h-2v1c0 1.1-.9 2-2 2h-1v2h-2v-2H9v2H7v-2H6c-1.1 0-2-.9-2-2v-1H2v-2h2V9H2V7h2V6c0-1.1.9-2 2-2h1V2h2zm9 4H6v12h12V6zm-3 3H9v6h6V9z"/></svg>`,
    barcode: `<svg viewBox="0 0 60 12" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" width="3" height="12" fill="currentColor"/><rect x="4.5" y="0" width="1.5" height="12" fill="currentColor"/><rect x="7.5" y="0" width="3.5" height="12" fill="currentColor"/><rect x="12.5" y="0" width="1.5" height="12" fill="currentColor"/><rect x="15.5" y="0" width="4.5" height="12" fill="currentColor"/><rect x="21.5" y="0" width="2" height="12" fill="currentColor"/><rect x="25" y="0" width="2.5" height="12" fill="currentColor"/><rect x="29" y="0" width="5" height="12" fill="currentColor"/><rect x="35.5" y="0" width="1.5" height="12" fill="currentColor"/><rect x="38.5" y="0" width="3.5" height="12" fill="currentColor"/><rect x="43.5" y="0" width="2.5" height="12" fill="currentColor"/><rect x="47.5" y="0" width="1.5" height="12" fill="currentColor"/><rect x="50.5" y="0" width="4" height="12" fill="currentColor"/><rect x="56" y="0" width="4" height="12" fill="currentColor"/></svg>`,
    camera: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
    cube: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 16.5l-9 5.2-9-5.2V7.5L12 2.3l9 5.2v9z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M3.3 7.5L12 12.5l8.7-5M12 12.5v9.2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
    feather: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L3 11.5V21h9.5zM16 8L2 22M17.5 15H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`
  };

  // 三个抽屉的详细说明文案
  const DRAWER_CONTENTS = {
    '01': {
      tag: 'DIRECTIVE // 01 · 机构目标',
      title: '什么是溯流计划？',
      body: `
        <p>「溯流计划」是一个能够通过特殊手段介入不同世界的中枢机构。它独立于所有被观测的世界之外，不属于其中任何一方，只负责观测与干预。</p>
        <p>当某个世界出现混乱崩溃的苗头时，溯流计划会派遣执行员介入其中，通过完成系统下达的任务来影响关键节点，以类似「蝴蝶效应」的方式逐步修正这个世界的走向，阻止它真正走向崩溃。</p>
        <p>执行员会被分派前往以下两类世界之一：<br>
        · <strong>三千世界</strong>——表面运转正常，实则暗藏漏洞与隐患的世界；<br>
        · <strong>无限世界</strong>——本身就极度混乱、随时可能崩溃的世界。</p>
        <p class="onboarding-drawer-note">关于「执行员」的具体职责与身份，详见下一篇「什么是执行员」。</p>
      `
    },
    '02': {
      tag: 'REGULATION // 02 · 岗位规约',
      title: '什么是执行员？',
      body: `
        <p>「执行员」是溯流计划从各个世界中招募的人，负责亲身进入那些濒临崩溃的世界，完成系统下达的任务、修正它们的走向。</p>
        <p>被选中的执行员，往往都有一个共同点：心有所憾，执念难平。或是放不下的人，或是未竟的事，又或是命运里始终缺了的那一角。溯流计划看中的正是这份执念背后的天赋与韧性——它让人愿意为了一个结果，一次次踏入未知的世界。</p>
        <p>作为交换，执行员每完成一次任务都会获得相应的积分报酬。当积分足够，便可以在系统中兑换「万能心愿券」——它能无条件实现你的愿望，并送你回到最初的故乡。</p>
      `
    },
    '03': {
      tag: 'LEGAL // 03 · 权责声明',
      title: '开源用户协议与免责申明',
      body: `
        <p>1. <strong>开源与本地运行</strong>：本项目为纯前端离线 PWA 交互应用，完全基于开源协议运作。你的所有档案、推演日志、立绘资产及私有配置均完全存放于本地浏览器离线数据库（IndexedDB）中，本机构中枢不在任何云端服务器留存你的个人隐私或私密数据。</p>
        <p>2. <strong>AI 与第三方接口声明</strong>：推演过程中涉及的大语言模型推理均由你自主配置的第三方服务商或本地端侧模型提供，相关生成内容的合规性与使用责任遵循相应服务商条款。</p>
        <p>3. <strong>体验免责</strong>：本项目叙述之世界观、任务情境及因果设定纯属虚构体验，请合理安排沉浸时间。</p>
      `
    }
  };

  /**
   * 步骤六自定义槽位的简介文案。
   * 两位预设助手的简介取自 PresetAssistants 的 intro 字段（单一事实来源），
   * 自定义槽位没有预设对象，文案落在这里。
   */
  const CUSTOM_ASSISTANT_INTRO = '空白人格槽位。姓名、外貌与全部性格设定均由执行员自行拟定，接入后即为独立模组。';

  /**
   * 把预设助手的人设拼成抽屉可读的只读档案 HTML。
   * corePrompt 用「【小标题】+ 正文」的分段格式，这里逐段转成小标题与段落，
   * 以 - 开头的行归并为列表项。
   * @param {Object} preset PresetAssistants.get() 返回的预设对象
   * @returns {string} 抽屉正文 HTML
   */
  function buildAssistantDossierBody(preset) {
    if (!preset) return '<p>档案暂不可用。</p>';

    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const parts = [];

    // 元信息行：编号 / 性别 / 上线日
    parts.push(`<p class="onboarding-drawer-note">${esc(preset.serialNo)} · ${esc(preset.gender)} · ${esc(preset.birthday)}</p>`);

    if (preset.appearance) {
      parts.push('<p><strong>外貌</strong></p>');
      parts.push(`<p>${esc(preset.appearance)}</p>`);
    }

    // corePrompt 按【小标题】切段
    const raw = String(preset.corePrompt || '');
    const blocks = raw.split(/\n(?=【)/).map((b) => b.trim()).filter(Boolean);

    blocks.forEach((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (!lines.length) return;

      const head = lines[0].match(/^【(.+?)】$/);
      if (head) {
        parts.push(`<p><strong>${esc(head[1])}</strong></p>`);
        lines.shift();
      }

      // 连续的 - 行合并成一个列表，其余按段落输出
      let bullets = [];
      const flushBullets = () => {
        if (!bullets.length) return;
        const items = bullets.map((b) => `<li>${esc(b)}</li>`).join('');
        parts.push(`<ul class="onboarding-agreement-list">${items}</ul>`);
        bullets = [];
      };

      lines.forEach((line) => {
        if (line.startsWith('- ')) {
          bullets.push(line.slice(2));
        } else {
          flushBullets();
          parts.push(`<p>${esc(line)}</p>`);
        }
      });
      flushBullets();
    });

    return parts.join('\n');
  }

  // 用户协议完整章节内容
  const AGREEMENT_DATA = {
    sub: 'RETROFLOW INITIATIVE // LEGAL TERMS',
    title: '溯流计划 · 用户协议',
    notice: '在开始使用前，请仔细审阅本协议。它明确了本项目的运作定位、离线本地数据边界以及使用过程中的各项权责约定。',
    sections: [
      {
        title: '一、关于本项目',
        content: `
          <p>《溯流计划》是一个开源的纯前端离线 PWA 应用，由独立开发者维护，免费提供。</p>
          <p>本项目本身不提供、不运营、不控制任何 AI 模型。你看到的所有剧情推演内容，都是由你自己配置的第三方 AI 服务，根据你的输入和设定生成的。本项目不参与模型训练与输出审核，因此无法保证 AI 输出的准确性、合法性或稳定性。</p>
          <p>API 调用费用、内容审核规则、服务中断、模型输出限制等问题，由你与你选择的服务商按其条款处理。</p>
        `
      },
      {
        title: '二、开源与二次使用',
        content: `
          <p>本项目开源，你可以自由查看、修改、二次开发和转发分享。但请遵守以下几点：</p>
          <ul class="onboarding-agreement-list">
            <li>不得声称《溯流计划》是你的原创项目，或抹去、篡改原作者署名；</li>
            <li>不得使用本项目进行任何形式的盈利，包括但不限于付费售卖、付费解锁、广告变现、接受以获取本项目为条件的付费；</li>
            <li>不得出售本项目的代码、资源文件、仓库地址或下载链接；</li>
            <li>二次开发的版本请注明来源于《溯流计划》，并同样保持开源与非盈利。</li>
          </ul>
        `
      },
      {
        title: '三、关于你的数据',
        content: `
          <p>你在本应用中产生的全部内容——执行员档案、副本卷宗、推演记录、立绘图片、API Key、主题配置等——<strong>都只保存在你自己设备的浏览器本地存储中</strong>（IndexedDB / LocalStorage）。</p>
          <p>本项目没有服务器，开发者不收集、不上传、也无法读取你的任何数据。所有 AI 请求都由你的浏览器直接发往你配置的服务商，不经过任何中转。</p>
          <p>这也意味着：清除浏览器数据、卸载应用、更换设备或浏览器异常，都可能导致数据永久丢失。请定期前往「设置 → 数据管理」导出备份。</p>
        `
      },
      {
        title: '四、虚构与现实',
        content: `
          <p>本应用中的世界观、角色、剧情、对话均为虚构创作，不构成任何现实建议。</p>
          <p>AI 输出可能出现不准确、过时、偏见或凭空编造（幻觉）的内容。请不要把它作为医疗、法律、金融、心理、情感或人生选择的依据。如果你正处于现实困境中，请寻求专业人士或亲友的帮助，而不是依赖 AI 的回答。</p>
          <p>沉浸是好事，但请留意投入的时间与情绪状态，注意休息。</p>
        `
      },
      {
        title: '五、使用规范',
        content: `
          <p>你应对自己输入、导入、保存、导出和传播的内容负责，并遵守所在国家或地区的法律法规。</p>
          <p>请不要利用本项目产生或传播：违法违规内容、侵害他人名誉或隐私的内容、淫秽色情或暴力恐怖内容、煽动仇恨与歧视的内容，以及其他法律禁止的内容。即使属于虚构创作或角色扮演，也不得以此为由在现实中传播、诱导或教学违法内容。</p>
          <p>因你的使用行为引发的纠纷与责任，由你本人承担。</p>
        `
      },
      {
        title: '六、年龄提示',
        content: `
          <p>本项目的剧情推演由 AI 实时生成，内容不可预测，建议年满 18 周岁再使用。未成年人使用请在监护人知情与陪同下进行。</p>
        `
      },
      {
        title: '七、责任限制',
        content: `
          <p>本项目按「现状」提供，不承诺无错误、无中断，也不承诺永久维护。</p>
          <p>在法律允许的范围内，开发者不对以下情况承担责任：第三方 AI 服务的中断、错误或不当输出；与服务商相关的费用、额度、封号问题；因设备、浏览器环境、用户操作导致的本地数据丢失或损坏；你依据 AI 输出作出的现实决策；以及不可抗力等非开发者可控原因导致的异常。</p>
        `
      },
      {
        title: '八、协议变更',
        content: `
          <p>本协议可能随功能更新或法规要求而调整，继续使用即视为接受调整后的内容。如你不同意本协议，请停止使用本应用，并按需导出或清除本地数据。</p>
        `
      }
    ]
  };

  let pageEl = null;
  let agreementPageEl = null;
  let drawerOverlayEl = null;
  let floatBallEl = null;
  let isAgreementAgreed = false;
  let currentStep = 1; // 1: 欢迎协议, 2: 配置 API, 3: 个人信息, 4: 部门与核心欲望
  let pendingAvatarFile = null; // 步骤三暂存待上传的头像图片文件
  let selectedDept = 'three_thousand'; // 步骤四选中的部门 (默认三千世界)
  let selectedAssistantId = 'asst_system_core'; // 步骤六选中的助手 ID (默认安小奇)

  // 步骤五：天赋激发状态
  let talentCandidates = [];        // 当前展示的 5 条候选天赋
  let lastDiscardedTalents = [];    // 上一轮被废弃的候选，重 roll 时回传给模型要求换方向
  let talentAwakenAbort = null;     // 进行中的激发请求控制器

  // 步骤七：编号签发状态
  let pendingSerialNo = '';        // 待确认的编号（完成入职时才正式落库）
  let serialRollTimer = null;      // 编号牌滚动动效定时器

  /* ================= 向导进度存档 ================= */

  /**
   * 把当前现场写入 meta.onboarding。
   * 每次切步都会调用，所以刻意做成静默失败：存档挂了不该阻断用户往下走。
   * @param {Object} [patch] 需要额外合并进存档的字段
   */
  function saveProgress(patch) {
    if (!window.Store || typeof Store.save !== 'function') return;

    const nameInput = document.getElementById('onboardingTalentCustomName');
    const descInput = document.getElementById('onboardingTalentCustomDesc');

    const snapshot = Object.assign({
      step: currentStep,
      agreed: isAgreementAgreed,
      completed: false,
      assistantId: selectedAssistantId,
      serialNo: pendingSerialNo,
      talentCandidates: talentCandidates,
      discarded: lastDiscardedTalents,
      talentDraft: {
        name: nameInput ? nameInput.value : '',
        desc: descInput ? descInput.value : ''
      },
      updatedAt: Date.now()
    }, patch || {});

    // 已完成标记一旦置上就不再被后续普通切步覆盖回 false
    try {
      const prev = Store.get ? Store.get('meta.onboarding') : null;
      if (prev && prev.completed && !(patch && patch.completed === false)) {
        snapshot.completed = true;
      }
    } catch (_) {}

    Promise.resolve(Store.save('meta.onboarding', snapshot)).catch((err) => {
      console.error('[Onboarding] 进度存档失败:', err);
    });
  }

  /** 读取向导进度存档，读不到时返回 null（交由调用方走默认流程） */
  function loadProgress() {
    if (!window.Store || typeof Store.get !== 'function') return null;
    try {
      return Store.get('meta.onboarding') || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * 步骤三「保存档案」按钮的锁态刷新。
   * 姓名为唯一必填项，填了才解锁。回填存档与用户手输都要走这里，
   * 所以提到模块作用域，避免两处各写一份判断。
   */
  function refreshStep3FinishState() {
    const nameInput = document.getElementById('onboardingNameInput');
    const finishBtn = document.getElementById('onboardingStep3FinishBtn');
    if (!finishBtn) return;

    const hasName = !!(nameInput && nameInput.value.trim());
    finishBtn.disabled = !hasName;
    finishBtn.classList.toggle('is-locked', !hasName);
  }

  /**
   * 步骤四部门拨盘展示配置。
   * 取 PsychStore.DEPARTMENTS 为真相源，避免文案在两处各写一份而漂移。
   */
  const DEPT_CONFIGS = (() => {
    const out = {};
    const list = (window.PsychStore && PsychStore.DEPARTMENTS) || [];
    list.forEach((d) => {
      out[d.id] = { name: d.name, sub: d.sub, desc: d.desc };
    });
    return out;
  })();

  /**
   * 初始化 DOM 结构
   */
  function initDOM() {
    if (pageEl) return;

    // 1. 全屏页面容器
    pageEl = document.createElement('div');
    pageEl.id = 'onboardingPage';
    pageEl.className = 'onboarding-page';
    pageEl.setAttribute('aria-hidden', 'true');

    pageEl.innerHTML = `
      <!-- 顶栏 HUD：状态标识与调试退出按钮 -->
      <div class="onboarding-hud-topbar">
        <div class="onboarding-hud-badge">
          <span class="onboarding-hud-dot"></span>
          <span class="onboarding-hud-code" id="onboardingHudCode">INITIALIZE // 01</span>
        </div>
        <button type="button" class="onboarding-hud-close-btn" id="onboardingCloseBtn" title="关闭向导 (调试模式)">
          ${ICONS.close}
        </button>
      </div>

      <!-- 步骤一：欢迎协议 -->
      <div class="onboarding-step-view is-active" id="onboardingStep1">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">
            
            <!-- 战术标头 -->
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">RETROFLOW INITIATIVE // ONBOARDING DOSSIER</span>
              <span class="onboarding-org-tag">溯流计划 · 人力资源与执勤部</span>
            </div>

            <!-- 主标题 -->
            <h1 class="onboarding-hero-title">执行员聘用接入协议</h1>

            <!-- 正式引言聘书 -->
            <div class="onboarding-statement-card">
              <p class="onboarding-lead-p">欢迎来到溯流计划。</p>
              <p class="onboarding-body-p">
                为了保障你在加入溯流计划后的合法权益，在正式签署聘用协定并分配系统工号之前，请务必仔细审阅以下规约，以确认本机构的核心运作目标及你的职业职责。
              </p>
              <p class="onboarding-body-p">
                本协议一经签署，即代表你已充分知悉多维世界的干涉风险，并自愿遵守溯流计划执行员执勤守则。
              </p>

              <!-- 人力资源与执勤部·机密审核公章 (HR & DUTY OFFICIAL EMBOSSED SEAL) -->
              <div class="onboarding-statement-seal" aria-hidden="true">
                <svg viewBox="0 0 100 100" fill="none">
                  <!-- 双同心圆轮廓 -->
                  <circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="1.8" stroke-dasharray="145 2" />
                  <circle cx="50" cy="50" r="41" stroke="currentColor" stroke-width="0.9" stroke-dasharray="3 2" />
                  <circle cx="50" cy="50" r="26" stroke="currentColor" stroke-width="1" />
                  
                  <!-- 顶弧刻印路径与文字 -->
                  <path id="sealArcTop" d="M 17 50 A 33 33 0 0 1 83 50" fill="none" />
                  <text font-family="var(--mono-font)" font-size="6.8" font-weight="700" letter-spacing="1.2" fill="currentColor">
                    <textPath href="#sealArcTop" startOffset="50%" text-anchor="middle">RETROFLOW INITIATIVE</textPath>
                  </text>

                  <!-- 底弧刻印路径与文字 -->
                  <path id="sealArcBot" d="M 83 50 A 33 33 0 0 1 17 50" fill="none" />
                  <text font-family="var(--mono-font)" font-size="5.8" font-weight="700" letter-spacing="0.9" fill="currentColor">
                    <textPath href="#sealArcBot" startOffset="50%" text-anchor="middle">HR &amp; DUTY DIVISION</textPath>
                  </text>

                  <!-- 核心审核通过印记 -->
                  <text x="50" y="47" font-family="var(--title-font)" font-size="9" font-weight="900" letter-spacing="1.5" text-anchor="middle" fill="currentColor">APPROVED</text>
                  <!-- 战术序列与星芒菱形 -->
                  <polygon points="50,51 52.5,54.5 50,58 47.5,54.5" fill="currentColor" />
                  <text x="50" y="66" font-family="var(--mono-font)" font-size="5" font-weight="700" letter-spacing="1" text-anchor="middle" fill="currentColor">SEC-01</text>
                </svg>
              </div>
            </div>

            <!-- 三个解释入口卡片 -->
            <div class="onboarding-hud-cards">
              <button type="button" class="onboarding-hud-card" data-hud-id="01">
                <span class="onboarding-hud-num">01</span>
                <div class="onboarding-hud-card-info">
                  <span class="onboarding-hud-card-tag">机构目标</span>
                  <span class="onboarding-hud-card-title">什么是溯流计划</span>
                </div>
                <span class="onboarding-hud-card-arrow">${ICONS.arrowRight}</span>
              </button>

              <button type="button" class="onboarding-hud-card" data-hud-id="02">
                <span class="onboarding-hud-num">02</span>
                <div class="onboarding-hud-card-info">
                  <span class="onboarding-hud-card-tag">岗位规约</span>
                  <span class="onboarding-hud-card-title">什么是执行员</span>
                </div>
                <span class="onboarding-hud-card-arrow">${ICONS.arrowRight}</span>
              </button>

              <button type="button" class="onboarding-hud-card" data-hud-id="03">
                <span class="onboarding-hud-num">03</span>
                <div class="onboarding-hud-card-info">
                  <span class="onboarding-hud-card-tag">权责声明</span>
                  <span class="onboarding-hud-card-title">用户协议</span>
                </div>
                <span class="onboarding-hud-card-arrow">${ICONS.arrowRight}</span>
              </button>
            </div>

          </div>
        </div>

        <!-- 步骤一操作栏 -->
        <div class="onboarding-footer-bar">
          <button type="button" class="onboarding-btn-primary" id="onboardingStep1NextBtn">
            <span>签署协定</span>
            <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
          </button>
        </div>
      </div>

      <!-- 步骤二：配置 API -->
      <div class="onboarding-step-view" id="onboardingStep2" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">
            
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">INITIALIZE // 02</span>
              <span class="onboarding-org-tag">配置 AI 接口</span>
            </div>

            <h1 class="onboarding-hero-title">配置 API</h1>

            <div class="onboarding-statement-card">
              <p class="onboarding-body-p">
                在开始之前，需要先配置至少一个 API 预设。
              </p>
              <p class="onboarding-body-p" style="margin-top: 10px;">
                《溯流计划》本身不提供 AI 模型，所有剧情推演都由你自己配置的第三方服务生成。API Key 只保存在你的设备本地，不会上传。
              </p>
            </div>

            <!-- API 节点端子插槽卡片 -->
            <div class="onboarding-api-status-card" id="onboardingApiCard">
              <div class="onboarding-api-status-head">
                <div class="onboarding-api-slot-tag">
                  <span class="onboarding-api-slot-num">SLOT 01</span>
                  <span class="onboarding-api-slot-label">推理端点</span>
                </div>
              </div>

              <div class="onboarding-api-status-body">
                <div class="onboarding-api-model-title" id="onboardingApiModelTitle">STANDBY // 待挂载接口</div>
                <div class="onboarding-api-model-sub" id="onboardingApiModelSub">需接入至少一个主模型推理节点以驱动世界推演</div>
              </div>

              <div class="onboarding-api-status-foot">
                <div class="onboarding-api-barcode" aria-hidden="true">
                  ${ICONS.barcode}
                </div>
                <button type="button" class="onboarding-btn-config" id="onboardingApiConfigBtn">
                  <span class="onboarding-btn-config-icon">${ICONS.gear}</span>
                  <span id="onboardingApiConfigBtnTxt">配置节点</span>
                </button>
              </div>
            </div>

            <!-- 地平线穹顶超视距巨型天体星象水印 (CELESTIAL MACRO HORIZON WATERMARK) -->
            <div class="onboarding-horizon-astrolabe" id="onboardingHorizonAstrolabe" aria-hidden="true">
              <svg class="onboarding-astrolabe-svg" viewBox="0 0 520 260" preserveAspectRatio="xMidYMax slice">
                <!-- 1. 超外逸出破框大环组 (逆时针公转 78s，圆心 260, 260) -->
                <g class="onboarding-orbit-group onboarding-orbit-outer">
                  <!-- 超巨型破框虚点环 (R=258) -->
                  <circle cx="260" cy="260" r="258" class="onboarding-orbit-ring onboarding-orbit-ring-outermost" stroke-dasharray="4 8" />
                  <!-- 极外紧随实线伴生微轨 (R=248，与外环仅距 10px 形成紧密外双子带) -->
                  <circle cx="260" cy="260" r="248" class="onboarding-orbit-ring onboarding-orbit-ring-faint-a" />
                  <!-- 巡弋粒子 01 (极外巡弋，R=258) -->
                  <circle cx="260" cy="2" r="1.8" class="onboarding-orbit-spore onboarding-spore-outer-1" />
                  <!-- 巡弋粒子 02 (伴生环细点，R=248) -->
                  <circle cx="435.4" cy="84.6" r="1.5" class="onboarding-orbit-spore onboarding-spore-outer-2" />
                </g>

                <!-- 2. 中高层主破缺星轨走廊 (顺时针平缓公转 46s，圆心 260, 260) -->
                <!-- 跨越 58px 辽阔留白深渊后汇聚于此 -->
                <g class="onboarding-orbit-group onboarding-orbit-mid">
                  <!-- 主星轨多段破缺圆弧 (R=190) -->
                  <circle cx="260" cy="260" r="190" class="onboarding-orbit-ring onboarding-orbit-ring-mid" stroke-dasharray="185 45 105 38" />
                  <!-- 紧密咬合伴生微轨 (R=182，与主轨仅隔 8px 形成致密主带走廊) -->
                  <circle cx="260" cy="260" r="182" class="onboarding-orbit-ring onboarding-orbit-ring-faint-b" stroke-dasharray="7 5" />
                  <!-- 巡弋粒子 03 (主轨主星，带呼吸微芒，R=190) -->
                  <circle cx="394.3" cy="125.7" r="2.1" class="onboarding-orbit-spore onboarding-spore-mid-pulse" />
                  <!-- 巡弋粒子 04 (反向对角极微星，R=190) -->
                  <circle cx="125.7" cy="394.3" r="1.4" class="onboarding-orbit-spore onboarding-spore-mid-sub" />
                  <!-- 巡弋粒子 05 (双轨伴生微星，R=182) -->
                  <circle cx="260" cy="78" r="1.6" class="onboarding-orbit-spore onboarding-spore-mid-accent" />
                </g>

                <!-- 3. 内层阶梯刻度带与深核微轨 (逆时针公转 28s，圆心 260, 260) -->
                <!-- 跨越 38px 呼吸留白后进入精密内界 -->
                <g class="onboarding-orbit-group onboarding-orbit-inner">
                  <!-- 密实测距齿轨 (R=144) -->
                  <circle cx="260" cy="260" r="144" class="onboarding-orbit-ring onboarding-orbit-ring-inner" stroke-dasharray="4 4" />
                  <!-- 咬合伴生微弧 (R=136，与齿轨仅距 8px) -->
                  <circle cx="260" cy="260" r="136" class="onboarding-orbit-ring onboarding-orbit-ring-sub-tight" stroke-dasharray="65 30" />
                  <!-- 近核破缺微轨 (R=92，隔出 44px 深渊留白) -->
                  <circle cx="260" cy="260" r="92" class="onboarding-orbit-ring onboarding-orbit-ring-faint-d" stroke-dasharray="95 38" />
                  <!-- 巡弋粒子 06 (齿轨微粒子，R=144) -->
                  <circle cx="260" cy="116" r="1.7" class="onboarding-orbit-spore onboarding-spore-inner-pulse" />
                  <!-- 巡弋粒子 07 (近核巡星，R=92) -->
                  <circle cx="325.0" cy="195.0" r="1.3" class="onboarding-orbit-spore onboarding-spore-inner-faint" />
                </g>

                <!-- 4. 核心同心环与底界原点 (静止锚定，圆心 260, 260) -->
                <g class="onboarding-orbit-core">
                  <circle cx="260" cy="260" r="58" class="onboarding-orbit-ring onboarding-orbit-ring-core" />
                  <circle cx="260" cy="260" r="26" class="onboarding-orbit-ring onboarding-orbit-ring-nucleus" stroke-dasharray="3 3" />
                  <circle cx="260" cy="260" r="4.5" class="onboarding-orbit-center-node" />
                  <circle cx="260" cy="260" r="1.8" class="onboarding-orbit-center-dot" />
                </g>
              </svg>
            </div>

          </div>
        </div>

        <!-- 步骤二操作栏 -->
        <div class="onboarding-footer-bar onboarding-footer-split">
          <button type="button" class="onboarding-btn-prev" id="onboardingStep2PrevBtn">
            <span>上一步</span>
          </button>
          <button type="button" class="onboarding-btn-primary is-locked" id="onboardingStep2NextBtn" disabled>
            <span>确认节点</span>
            <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
          </button>
        </div>
      </div>

      <!-- 步骤三：执行员档案录入 -->
      <div class="onboarding-step-view" id="onboardingStep3" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">
            
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">INITIALIZE // 03</span>
              <span class="onboarding-org-tag">档案登记</span>
            </div>

            <h1 class="onboarding-hero-title">执行员档案录入</h1>

            <div class="onboarding-statement-card">
              <p class="onboarding-body-p">
                为了更好地了解你的才能和优势，我们需要收集一些关于你的基础信息。
              </p>
              <p class="onboarding-body-p" style="margin-top: 10px;">
                这些信息将作为你在溯流计划中的个人档案基准，并在你后续进入不同世界、参与剧情推演时生效。录入完成后，你可以随时在系统「个人档案」中修改。
              </p>
            </div>

            <!-- 档案表单组 -->
            <div class="onboarding-profile-form">
              
              <!-- 档案证件照卡片 (2:3 纵向相框) -->
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">PHOTO</span>
                  <span class="onboarding-form-section-title">档案证件照</span>
                </div>
                <div class="onboarding-avatar-uploader" id="onboardingAvatarTrigger" role="button" tabindex="0" title="点击更换证件照 (2:3)">
                  <div class="onboarding-avatar-frame">
                    <img id="onboardingAvatarPreview" class="onboarding-avatar-img" alt="证件照预览" hidden />
                    <div class="onboarding-avatar-placeholder" id="onboardingAvatarPlaceholder">
                      <span class="onboarding-avatar-icon">${ICONS.camera}</span>
                      <span class="onboarding-avatar-tip">上传照片 (2:3)</span>
                    </div>
                  </div>
                  <div class="onboarding-avatar-meta">
                    <div class="onboarding-avatar-title">证件照 / 头像</div>
                    <div class="onboarding-avatar-sub">支持上传单人头像、半身照或立绘，选填</div>
                  </div>
                </div>
              </div>

              <!-- 基础信息卡片 -->
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">IDENTITY</span>
                  <span class="onboarding-form-section-title">基础档案</span>
                </div>

                <!-- 姓名 (必填) -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingNameInput">
                    <span>姓名 / 代号</span>
                    <span class="onboarding-form-required">*必填</span>
                  </label>
                  <input type="text" id="onboardingNameInput" class="onboarding-text-input" placeholder="请输入你的姓名或代号" maxlength="24" autocomplete="off" />
                </div>

                <!-- 性别快捷选择 -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label">
                    <span>性别</span>
                    <span class="onboarding-form-optional">选填</span>
                  </label>
                  <div class="onboarding-gender-pills" id="onboardingGenderPills">
                    <button type="button" class="onboarding-gender-pill is-active" data-gender="女">女</button>
                    <button type="button" class="onboarding-gender-pill" data-gender="男">男</button>
                    <button type="button" class="onboarding-gender-pill" data-gender="未知">未知</button>
                  </div>
                  <input type="hidden" id="onboardingGenderInput" value="女" />
                </div>

                <!-- 生日快捷弹窗 -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingBirthdayTrigger">
                    <span>生日</span>
                    <span class="onboarding-form-optional">选填</span>
                  </label>
                  <button type="button" class="onboarding-date-btn" id="onboardingBirthdayTrigger">
                    <span class="onboarding-date-icon">${ICONS.calendar}</span>
                    <span id="onboardingBirthdayDisplay">点击选择诞生日</span>
                  </button>
                  <input type="hidden" id="onboardingBirthdayInput" value="" />
                </div>
              </div>

              <!-- 深度特征卡片 -->
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">DOSSIER</span>
                  <span class="onboarding-form-section-title">深度特征</span>
                </div>

                <!-- 外貌特征 -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingAppearanceInput">
                    <span>外貌特征</span>
                    <span class="onboarding-form-optional">选填</span>
                  </label>
                  <textarea id="onboardingAppearanceInput" class="onboarding-textarea" rows="2" placeholder="描述发色、瞳色、身形、穿搭或标志性特征……"></textarea>
                </div>

                <!-- 核心设定 / 背景 (去中二、去执念) -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingProfileInput">
                    <span>核心设定 / 背景</span>
                    <span class="onboarding-form-optional">选填</span>
                  </label>
                  <textarea id="onboardingProfileInput" class="onboarding-textarea" rows="3" placeholder="描述你的性格特点、来历背景、专长特长或处事风格……"></textarea>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- 步骤三操作栏 -->
        <div class="onboarding-footer-bar onboarding-footer-split">
          <button type="button" class="onboarding-btn-prev" id="onboardingStep3PrevBtn">
            <span>上一步</span>
          </button>
          <button type="button" class="onboarding-btn-primary is-locked" id="onboardingStep3FinishBtn" disabled>
            <span>登记档案</span>
            <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
          </button>
        </div>
      </div>

      <!-- ================= 步骤四：职能部门与核心欲望 ================= -->
      <div class="onboarding-step-view" id="onboardingStep4" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">

            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">INITIALIZE // 04</span>
              <span class="onboarding-org-tag">求职意向</span>
            </div>

            <h1 class="onboarding-hero-title">职能部门与核心欲望</h1>

            <!-- 顶部引言卡 -->
            <div class="onboarding-statement-card">
              <p class="onboarding-body-p">
                你的基本信息已完成登记。接下来，请选择你的首选任职部门，并告诉我们你为何踏入此处。
              </p>
              <p class="onboarding-body-p" style="margin-top: 10px;">
                这不仅关乎你在溯流计划中的任务倾向，也将作为你在无尽世界中的原初锚点。
              </p>
            </div>

            <!-- 部门与欲望表单组 -->
            <div class="onboarding-profile-form">

              <!-- 卡片 01：所在部门选择 (步进拨盘) -->
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">CAREER</span>
                  <span class="onboarding-form-section-title">求职意向 · 所在部门</span>
                </div>
                
                <!-- 部门步进拨盘：‹ 部门名 › (无底色、居中自适应) -->
                <div class="onboarding-dept-stepper">
                  <button type="button" class="onboarding-dept-arrow" id="onboardingDeptPrevBtn" aria-label="切换到上一个部门">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
                    </svg>
                  </button>

                  <div class="onboarding-dept-display" id="onboardingDeptDisplay">
                    <span class="onboarding-dept-name" id="onboardingDeptName">三千世界</span>
                    <span class="onboarding-dept-sub" id="onboardingDeptSub">快穿流派 · 节点修正</span>
                  </div>

                  <button type="button" class="onboarding-dept-arrow" id="onboardingDeptNextBtn" aria-label="切换到下一个部门">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/>
                    </svg>
                  </button>
                </div>

                <!-- 部门职能简报动态说明 -->
                <div class="onboarding-dept-desc-box" id="onboardingDeptDescBox">
                  <p class="onboarding-dept-desc-text" id="onboardingDeptDescText">
                    表面运转正常、实则暗藏漏洞的世界。介入后多以身份伪装融入环境，偏向利用人心博弈、智计谋略与人际策动，在暗处修正世界走向。
                  </p>
                </div>
              </div>

              <!-- 卡片 02：核心欲望 / 初衷 -->
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">DESIRE</span>
                  <span class="onboarding-form-section-title">原初渴求 · 核心欲望</span>
                </div>

                <!-- 快捷灵感胶囊 -->
                <div class="onboarding-desire-pills" id="onboardingDesirePills">
                  <button type="button" class="onboarding-desire-pill" data-text="获得至高的权力、财富、名望与地位，成为无可撼动的人上人。">
                    <span>名誉与权位</span>
                  </button>
                  <button type="button" class="onboarding-desire-pill" data-text="得到至死不渝的爱，找寻一段至深、纯粹且永恒的精神联结。">
                    <span>爱与永恒联结</span>
                  </button>
                  <button type="button" class="onboarding-desire-pill" data-text="摆脱一切世俗与规则的束缚，永远随心所欲、自由且快乐地活着。">
                    <span>自由与无拘</span>
                  </button>
                  <button type="button" class="onboarding-desire-pill" data-text="勘破世界底层的本质，拥有无尽的学识、深邃的知性与绝顶的智慧。">
                    <span>真知与才智</span>
                  </button>
                </div>

                <!-- 核心欲望多行文本域 -->
                <div class="onboarding-form-row" style="margin-top: 10px;">
                  <textarea id="onboardingDesireInput" class="onboarding-textarea" rows="3" placeholder="点击上方灵感胶囊快速填入，或直接键入你内心的真实渴求……"></textarea>
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- 步骤四操作栏 -->
        <div class="onboarding-footer-bar onboarding-footer-split">
          <button type="button" class="onboarding-btn-prev" id="onboardingStep4PrevBtn">
            <span>上一步</span>
          </button>
          <button type="button" class="onboarding-btn-primary" id="onboardingStep4NextBtn">
            <span>确认意向</span>
            <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
          </button>
        </div>
      </div>

      <!-- ================= 步骤五：天赋权能激发与解析 ================= -->
      <div class="onboarding-step-view" id="onboardingStep5" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">

            <!-- 战术标头 -->
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">TALENT AWAKENING // 05</span>
              <span class="onboarding-org-tag">灵魂特质解析</span>
            </div>

            <h1 class="onboarding-hero-title">天赋技能激发与解析</h1>

            <!-- 权威协议声明 -->
            <div class="onboarding-statement-card" style="margin-bottom: 20px;">
              <p class="onboarding-body-p" style="margin: 0; line-height: 1.75;">
                你的意向已被系统确认。接下来，系统将依据你的任职部门与核心欲望，激发灵魂深处的原初特质，并生成专属天赋技能。天赋技能一经确认后不可更改，但有可能在后续获得进化的机会。
              </p>
            </div>

            <!-- 激发共鸣台核心容器 (待激发态) -->
            <div class="onboarding-awakening-stage" id="onboardingStep5Stage">
              <div class="onboarding-awakening-pulse-ring" aria-hidden="true"></div>
              
              <!-- 战术共鸣核心指示 -->
              <div class="onboarding-awakening-core">
                <div class="onboarding-awakening-core-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 3"/>
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                    <circle cx="12" cy="12" r="3.2" fill="currentColor"/>
                  </svg>
                </div>
                <div class="onboarding-awakening-core-status">
                  <span class="onboarding-awakening-core-code">RESONANCE MATRIX // READY</span>
                  <span class="onboarding-awakening-core-hint">灵魂锚点已锁定 · 共鸣回路就绪</span>
                </div>
              </div>

              <!-- 超酷炫激发按钮 -->
              <button type="button" class="onboarding-btn-awaken" id="onboardingTalentAwakenBtn">
                <span class="onboarding-btn-awaken-glow" aria-hidden="true"></span>
                <span class="onboarding-btn-awaken-corners" aria-hidden="true">
                  <span class="awaken-c awaken-c-tl"></span>
                  <span class="awaken-c awaken-c-tr"></span>
                  <span class="awaken-c awaken-c-bl"></span>
                  <span class="awaken-c awaken-c-br"></span>
                </span>
                <span class="onboarding-btn-awaken-body">
                  <span class="onboarding-btn-awaken-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5z" fill="currentColor"/>
                    </svg>
                  </span>
                  <span class="onboarding-btn-awaken-texts">
                    <span class="onboarding-btn-awaken-primary">激发天赋技能</span>
                    <span class="onboarding-btn-awaken-mono">INITIALIZE TALENT RESONANCE</span>
                  </span>
                </span>
              </button>

              <div class="onboarding-awakening-footnote">
                <span>// 你填写的档案、部门选择和核心欲望都会影响天赋技能</span>
              </div>
            </div>

            <!-- 天赋解析结果与自主编辑区 (激发完成后显示) -->
            <div class="onboarding-talent-result-area" id="onboardingStep5ResultArea" style="display: none;">
              <!-- 候选池战术标头 -->
              <div class="onboarding-talent-pool-header">
                <div class="onboarding-talent-pool-title-wrap">
                  <span class="onboarding-talent-pool-tag">RESONANCE MATRIX // 五选一</span>
                  <h2 class="onboarding-talent-pool-title">灵魂共鸣候选天赋</h2>
                </div>
                <button type="button" class="onboarding-btn-reroll" id="onboardingTalentRerollBtn" title="保留当前设定，重新激发一组新天赋">
                  <span class="onboarding-btn-reroll-icon">${ICONS.refresh}</span>
                  <span>重新激发</span>
                </button>
              </div>

              <!-- 5球弧形轮播天体罗盘舞台 (Orbital Arc Carousel Stage) -->
              <div class="onboarding-talent-arc-stage" id="onboardingTalentArcStage">
                <div class="onboarding-talent-arc-track" id="onboardingTalentArcTrack">
                  <!-- 5个球体由 JS 动态生成并挂载 -->
                </div>
                <div class="onboarding-talent-arc-nav-hint">
                  <span class="onboarding-talent-arc-nav-arrow">${ICONS.arrowLeft}</span>
                  <span class="onboarding-talent-arc-nav-label">左右滑动或点击切换技能</span>
                  <span class="onboarding-talent-arc-nav-arrow">${ICONS.arrowRight}</span>
                </div>
              </div>

              <!-- 当前选定天赋的战术解析长说明展板 -->
              <div class="onboarding-talent-dossier-card" id="onboardingTalentDossierCard">
                <div class="onboarding-talent-dossier-header">
                  <div class="onboarding-talent-dossier-badge">
                    <span class="onboarding-talent-dossier-code" id="onboardingTalentDossierCode">SLOT 01 // SELECTED</span>
                    <span class="onboarding-talent-dossier-index" id="onboardingTalentDossierIndex">01 / 05</span>
                  </div>
                  <h3 class="onboarding-talent-dossier-name" id="onboardingTalentDossierName">--</h3>
                </div>
                <p class="onboarding-talent-dossier-desc" id="onboardingTalentDossierDesc">--</p>
                <div class="onboarding-talent-dossier-footer">
                  <button type="button" class="onboarding-talent-custom-toggle-btn" id="onboardingTalentCustomToggleBtn">
                    <span class="onboarding-talent-custom-toggle-icon">${ICONS.edit}</span>
                    <span id="onboardingTalentCustomToggleLabel">自定义调整</span>
                  </button>
                </div>
              </div>

              <!-- 选定天赋自定义微调与落盘区域 (默认折叠，点开可改) -->
              <div class="onboarding-talent-custom-box" id="onboardingTalentCustomBox" style="display: none;">
                <div class="onboarding-talent-custom-head">
                  <span class="onboarding-talent-custom-tag">CUSTOMIZE & OVERRIDE // 技能微调</span>
                  <span class="onboarding-talent-custom-hint">可直接修改下方名称与说明，亦可完全自由手写</span>
                </div>

                <!-- 天赋名称输入组 -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingTalentCustomName">
                    <span>天赋名称</span>
                    <span class="onboarding-form-optional">TALENT NAME</span>
                  </label>
                  <input type="text" class="onboarding-text-input" id="onboardingTalentCustomName" maxlength="12" placeholder="请输入天赋名称 (2~6字推荐)" autocomplete="off" />
                </div>

                <!-- 天赋说明输入组 -->
                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingTalentCustomDesc">
                    <span>天赋说明</span>
                    <span class="onboarding-form-optional">SPECIFICATION</span>
                  </label>
                  <textarea class="onboarding-textarea onboarding-talent-desc-input" id="onboardingTalentCustomDesc" rows="4" maxlength="200" placeholder="客观描述这项天赋的具体能力表现与作用方式……"></textarea>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- 步骤五操作栏 -->
        <div class="onboarding-footer-bar" id="onboardingStep5FooterBar">
          <!-- 待激发态：单退回按钮 -->
          <div class="onboarding-footer-single" id="onboardingStep5FooterPre" style="width: 100%; display: flex; justify-content: center;">
            <button type="button" class="onboarding-btn-ghost-prev" id="onboardingStep5PrevBtn">
              <span class="onboarding-btn-ghost-icon">${ICONS.arrowLeft}</span>
              <span>返回修改意向</span>
            </button>
          </div>
          <!-- 解析完成态：双操作按钮 -->
          <div class="onboarding-footer-split" id="onboardingStep5FooterPost" style="width: 100%; display: none;">
            <button type="button" class="onboarding-btn-prev" id="onboardingStep5PostPrevBtn">
              <span>上一步</span>
            </button>
            <button type="button" class="onboarding-btn-primary" id="onboardingStep5ConfirmBtn">
              <span>确认天赋</span>
              <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ================= 步骤六：系统助手指派与接入 ================= -->
      <div class="onboarding-step-view" id="onboardingStep6" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">

            <!-- 战术标头 -->
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">SYSTEM ALLOCATION // 06</span>
              <span class="onboarding-org-tag">终端主脑</span>
            </div>

            <h1 class="onboarding-hero-title">系统助手</h1>

            <!-- 顶部引言说明卡片 -->
            <div class="onboarding-statement-card">
              <p class="onboarding-body-p">
                你的天赋技能已被确认，接下来请选择你的系统助手。
              </p>
              <p class="onboarding-body-p" style="margin-top: 10px;">
                Ta会帮助你熟悉溯流计划的各项操作，为你提供决策建议或者情感陪伴。
              </p>
            </div>

            <!-- 漫画分镜格容器 (1:1 正方形漫画总画框，三格斜切构图) -->
            <div class="onboarding-comic-box" id="onboardingComicGrid">

              <!-- 分镜 01：安小奇 (左上 70% 大画幅，左下破框椭圆对话框) -->
              <div class="onboarding-comic-panel onboarding-comic-panel-top-left is-selected" data-assistant-id="asst_system_core">
                <div class="onboarding-comic-visual">
                  <div class="onboarding-comic-inner">
                    <img class="onboarding-comic-portrait" src="assets/assistants/asst_system_core.webp" alt="安小奇" loading="eager" decoding="async">
                  </div>
                </div>
                <div class="onboarding-comic-speech-bubble" aria-label="安小奇">
                  <span class="onboarding-bubble-name">安小奇</span>
                </div>
              </div>

              <!-- 分镜 02：安小阎 (右上 70% 大画幅) -->
              <div class="onboarding-comic-panel onboarding-comic-panel-top-right" data-assistant-id="asst_system_yan">
                <div class="onboarding-comic-visual">
                  <div class="onboarding-comic-inner">
                    <img class="onboarding-comic-portrait" src="assets/assistants/asst_system_yan.webp" alt="安小阎" loading="eager" decoding="async">
                  </div>
                </div>
                <div class="onboarding-comic-caption-v" aria-label="安小阎">
                  <span class="onboarding-caption-name-v">安小阎</span>
                </div>
              </div>

              <!-- 分镜 03：自定义系统助手 (下方 30% 扁平槽位，纯文字排版) -->
              <div class="onboarding-comic-panel onboarding-comic-panel-bottom" data-assistant-id="asst_custom">
                <div class="onboarding-comic-visual">
                  <div class="onboarding-comic-inner"></div>
                </div>
                <div class="onboarding-comic-custom-label">
                  <span class="onboarding-custom-name">自定义系统助手</span>
                </div>
              </div>

            </div>

            <!-- 选中助手简介区：文本随分镜切换淡入淡出，高度锁定避免整页跳动 -->
            <div class="onboarding-asst-brief" id="onboardingAsstBrief">
              <p class="onboarding-asst-brief-text" id="onboardingAsstBriefText"></p>
              <button type="button" class="onboarding-asst-dossier-btn" id="onboardingAsstDossierBtn">
                <span class="onboarding-asst-dossier-icon">${ICONS.cpu}</span>
                <span id="onboardingAsstDossierText">查看完整档案</span>
              </button>
            </div>

          </div>
        </div>

        <!-- 步骤六操作栏 -->
        <div class="onboarding-footer-bar onboarding-footer-split" id="onboardingStep6FooterBar">
          <button type="button" class="onboarding-btn-prev" id="onboardingStep6PrevBtn">
            <span>上一步</span>
          </button>
          <button type="button" class="onboarding-btn-primary" id="onboardingStep6NextBtn">
            <span id="onboardingStep6NextText">接入助手</span>
            <span class="onboarding-btn-icon">${ICONS.arrowRight}</span>
          </button>
        </div>
      </div>

      <!-- ================= 步骤七：编号签发与入职完成 ================= -->
      <div class="onboarding-step-view" id="onboardingStep7" aria-hidden="true">
        <div class="onboarding-scroll-body">
          <div class="onboarding-content-wrap">

            <!-- 战术标头 -->
            <div class="onboarding-sub-badge">
              <span class="onboarding-mono-sub">ENLISTMENT COMPLETE // 07</span>
              <span class="onboarding-org-tag">编号签发</span>
            </div>

            <h1 class="onboarding-hero-title">执行员编号签发</h1>

            <!-- 顶部引言说明卡片 -->
            <div class="onboarding-statement-card">
              <p class="onboarding-body-p" id="onboardingSerialGreeting">
                你的入职手续已全部办理完毕。
              </p>
              <p class="onboarding-body-p" style="margin-top: 10px;">
                这枚编号是你在溯流计划内的正式身份标识，将伴随你穿行于所有世界线。编号不可更改，具备唯一性。
              </p>
            </div>

            <!-- 编号签发牌：进入本步时数字滚动定格 -->
            <div class="onboarding-serial-plate" id="onboardingSerialPlate">
              <div class="onboarding-serial-plate-head">
                <span class="onboarding-serial-plate-tag">RETROFLOW INITIATIVE</span>
                <span class="onboarding-serial-plate-sub">EXECUTIVE SERIAL</span>
              </div>
              <div class="onboarding-serial-plate-body">
                <span class="onboarding-serial-prefix">NO.</span>
                <span class="onboarding-serial-digits" id="onboardingSerialDigits">------</span>
              </div>
              <div class="onboarding-serial-plate-foot">
                <span class="onboarding-serial-plate-note" id="onboardingSerialState">SIGNING // 签发中</span>
              </div>
            </div>

            <!-- 手动改号表单 -->
            <div class="onboarding-profile-form">
              <div class="onboarding-form-section">
                <div class="onboarding-form-section-head">
                  <span class="onboarding-form-section-tag">SERIAL</span>
                  <span class="onboarding-form-section-title">编号改定</span>
                </div>

                <div class="onboarding-form-row">
                  <label class="onboarding-form-label" for="onboardingSerialInput">
                    <span>六位编号</span>
                    <span class="onboarding-form-optional">可自行改定</span>
                  </label>
                  <div class="onboarding-serial-input-wrap">
                    <span class="onboarding-serial-input-prefix">NO.</span>
                    <input
                      type="text"
                      id="onboardingSerialInput"
                      class="onboarding-serial-input"
                      inputmode="numeric"
                      maxlength="6"
                      autocomplete="off"
                      spellcheck="false"
                      placeholder="000000" />
                    <button type="button" class="onboarding-serial-reroll-btn" id="onboardingSerialRerollBtn" title="重新签发一枚编号">
                      <span class="onboarding-serial-reroll-icon">${ICONS.refresh}</span>
                    </button>
                  </div>
                  <p class="onboarding-serial-tip" id="onboardingSerialTip"></p>
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- 步骤七操作栏 -->
        <div class="onboarding-footer-bar onboarding-footer-split" id="onboardingStep7FooterBar">
          <button type="button" class="onboarding-btn-prev" id="onboardingStep7PrevBtn">
            <span>上一步</span>
          </button>
          <button type="button" class="onboarding-btn-primary" id="onboardingStep7FinishBtn">
            <span>完成入职</span>
            <span class="onboarding-btn-icon">${ICONS.check}</span>
          </button>
        </div>
      </div>

      <!-- 抽屉详情弹窗 -->
      <div class="onboarding-drawer-overlay" id="onboardingDrawerOverlay" aria-hidden="true">
        <div class="onboarding-drawer-card">
          <div class="onboarding-drawer-head">
            <div class="onboarding-drawer-meta">
              <span class="onboarding-drawer-tag" id="onboardingDrawerTag">DIRECTIVE</span>
              <h2 class="onboarding-drawer-title" id="onboardingDrawerTitle">标题</h2>
            </div>
            <button type="button" class="onboarding-drawer-close" id="onboardingDrawerClose" title="收起">
              ${ICONS.close}
            </button>
          </div>
          <div class="onboarding-drawer-content" id="onboardingDrawerBody"></div>
          <div class="onboarding-drawer-action">
            <button type="button" class="onboarding-btn-ghost" id="onboardingDrawerConfirm">
              ${ICONS.check}
              <span>阅毕确认</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(pageEl);

    // 2. 注入调试悬浮球
    createFloatBall();

    // 3. 事件绑定
    bindEvents();
  }

  /**
   * 创建调试悬浮球
   */
  function createFloatBall() {
    if (floatBallEl) return;
    floatBallEl = document.createElement('div');
    floatBallEl.id = 'onboardingDebugBall';
    floatBallEl.className = 'onboarding-debug-ball';
    floatBallEl.title = '点击打开入役开场向导 (调试期入口)';
    floatBallEl.innerHTML = `
      <span class="onboarding-ball-icon">${ICONS.spark}</span>
      <span class="onboarding-ball-txt">开场</span>
    `;

    floatBallEl.addEventListener('click', () => {
      open();
    });

    document.body.appendChild(floatBallEl);
  }

  /**
   * 打开抽屉详情
   */
  function openDrawer(hudId) {
    const data = DRAWER_CONTENTS[hudId];
    if (!data) return;

    const overlay = document.getElementById('onboardingDrawerOverlay');
    const tag = document.getElementById('onboardingDrawerTag');
    const title = document.getElementById('onboardingDrawerTitle');
    const body = document.getElementById('onboardingDrawerBody');

    if (tag) tag.textContent = data.tag;
    if (title) title.textContent = data.title;
    if (body) body.innerHTML = data.body;

    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  /**
   * 以外部数据直接拉起抽屉（不经 DRAWER_CONTENTS 注册表）。
   * 助手档案的内容是运行时按预设拼出来的，没法预先写成静态常量。
   * @param {{tag: string, title: string, body: string}} data 抽屉内容
   */
  function openDrawerWith(data) {
    if (!data) return;

    const overlay = document.getElementById('onboardingDrawerOverlay');
    const tag = document.getElementById('onboardingDrawerTag');
    const title = document.getElementById('onboardingDrawerTitle');
    const body = document.getElementById('onboardingDrawerBody');

    if (tag) tag.textContent = data.tag || '';
    if (title) title.textContent = data.title || '';
    if (body) body.innerHTML = data.body || '';

    if (overlay) {
      overlay.classList.add('is-open');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  /**
   * 步骤六：把选中分镜对应的简介与按钮文案刷进简介区。
   * 文本换内容时先摘 is-shown 再补，触发一次淡入；高度由 CSS 锁死，不会顶动布局。
   */
  function syncStep6Brief() {
    const textEl = document.getElementById('onboardingAsstBriefText');
    const btnTextEl = document.getElementById('onboardingAsstDossierText');
    if (!textEl) return;

    let intro = CUSTOM_ASSISTANT_INTRO;
    let btnLabel = '创建助手档案';

    if (selectedAssistantId !== 'asst_custom') {
      const preset = window.PresetAssistants
        ? PresetAssistants.get(selectedAssistantId)
        : null;
      intro = (preset && preset.intro) || '';
      btnLabel = '查看完整档案';
    }

    textEl.classList.remove('is-shown');
    textEl.textContent = intro;
    if (btnTextEl) btnTextEl.textContent = btnLabel;

    // 强制重排后再挂 class，否则同帧内摘挂不会重放动画
    void textEl.offsetWidth;
    textEl.classList.add('is-shown');
  }

  /**
   * 步骤六：把执行员送去同调档案的助手新建态建档，归档后自动回到向导。
   *
   * 实现要点：
   *   1. 同调档案的编辑器是整页视图，必须先 open() 再切维度，否则视图挂在
   *      未展示的页面里等于点了没反应；
   *   2. 归档时机由 ResonanceUI.setEditorExitHook 交还——它挂在 backToActiveList
   *      上，校验失败会留在编辑页不触发，因此不会出现「没保存就回来了」；
   *   3. 回到向导后取最新建的那位为选中对象，立绘塞进漫画格第三格。
   */
  function openCustomAssistantForge() {
    if (!window.ResonanceUI || typeof ResonanceUI.openAsstEditor !== 'function') {
      toastTalent('MODULE // 模块未就绪', '同调档案模块尚未加载', '请刷新页面后重试。', 'error');
      return;
    }

    // 记下进编辑器之前的在册助手，回来时用差集认出新建的那位
    const idsBefore = new Set(
      ((window.Store && Store.roster && Store.roster.assistants) || [])
        .filter((a) => a && a.id)
        .map((a) => a.id)
    );

    if (typeof ResonanceUI.setEditorExitHook === 'function') {
      ResonanceUI.setEditorExitHook(() => {
        // 关掉同调档案整页，把舞台交回向导
        if (typeof ResonanceUI.close === 'function') {
          Promise.resolve(ResonanceUI.close()).catch(() => {});
        }
        adoptForgedAssistant(idsBefore);
      });
    }

    // 向导页先让位，避免两层整页叠在一起
    if (pageEl) pageEl.classList.remove('is-active');

    ResonanceUI.open();
    if (typeof ResonanceUI.switchDimension === 'function') {
      Promise.resolve(ResonanceUI.switchDimension('assistant'))
        .then(() => ResonanceUI.openAsstEditor(null))
        .catch((err) => console.warn('[Onboarding] 进入助手新建态异常:', err));
    } else {
      ResonanceUI.openAsstEditor(null);
    }
  }

  /**
   * 建档归档后回到步骤六：认领新助手、设为激活、把立绘贴进漫画第三格。
   * @param {Set<string>} idsBefore 进编辑器前的在册助手 id 集合
   */
  async function adoptForgedAssistant(idsBefore) {
    // 把向导页请回前台
    if (pageEl) pageEl.classList.add('is-active');

    const list = (window.Store && Store.roster && Store.roster.assistants) || [];
    const forged = list.find((a) => a && a.id && !idsBefore.has(a.id));

    // 用户空手而归（没填名字直接退）：维持原状，什么都不改
    if (!forged) {
      syncStep6Brief();
      return;
    }

    selectedAssistantId = forged.id;

    // 激活新助手，其余一律下线
    try {
      const next = list.map((a) => (a ? { ...a, isActive: a.id === forged.id } : a));
      await Store.save('roster.assistants', next);
    } catch (err) {
      console.error('[Onboarding] 自定义助手激活落盘异常:', err);
    }

    // 漫画第三格：挂上名字与立绘，原本的「自定义系统助手」纯文字槽位就地显形
    const customPanel = document.querySelector('.onboarding-comic-panel[data-assistant-id="asst_custom"]');
    if (customPanel) {
      customPanel.dataset.assistantId = forged.id;

      const nameEl = customPanel.querySelector('.onboarding-custom-name');
      if (nameEl) nameEl.textContent = forged.name || '自定义助手';

      // 立绘走既有 Blob 链路；没传图就保持纯文字槽位不动
      try {
        if (window.Storage && typeof Storage.getAssetSrc === 'function' && window.DataRegistry) {
          const src = await Storage.getAssetSrc(DataRegistry.key.assistantAvatar(forged.id));
          const inner = customPanel.querySelector('.onboarding-comic-inner');
          if (src && inner && !inner.querySelector('.onboarding-comic-portrait')) {
            const img = document.createElement('img');
            img.className = 'onboarding-comic-portrait';
            img.src = src;
            img.alt = forged.name || '自定义助手';
            img.decoding = 'async';
            inner.appendChild(img);
            customPanel.classList.add('has-portrait');
          }
        }
      } catch (err) {
        console.warn('[Onboarding] 自定义助手立绘贴入跳过:', err);
      }

      // 选中态归到这一格
      document.querySelectorAll('.onboarding-comic-panel').forEach((p) => p.classList.remove('is-selected'));
      customPanel.classList.add('is-selected');
    }

    syncStep6NextText();
    syncStep6Brief();
    saveProgress();
  }

  /* ================= 步骤七：编号签发 ================= */

  /**
   * 借用同调档案的编号注册中心做归一化，保证 '517' 与 '000517' 视为同号。
   * 模块未就绪时退化为本地实现，规则保持一致。
   */
  function normalizeSerialInput(raw) {
    if (window.ResonanceUI && typeof ResonanceUI.normalizeSerial === 'function') {
      return ResonanceUI.normalizeSerial(raw);
    }
    if (raw === null || raw === undefined) return '';
    let s = String(raw).trim().replace(/^NO\./i, '').replace(/\D/g, '');
    if (!s) return '';
    if (s.length > 6) s = s.slice(-6);
    return s.padStart(6, '0');
  }

  /**
   * 签发一枚不与系统保留号、已有角色/NPC 冲突的六位编号。
   * 查重规则统一走 ResonanceUI 的编号注册中心，不在此另写一份。
   */
  function issueSerialNo() {
    if (window.ResonanceUI && typeof ResonanceUI.generateUniqueSerial === 'function') {
      return ResonanceUI.generateUniqueSerial();
    }
    // 兜底：注册中心未就绪时仅避开三个系统保留号
    const reserved = new Set(['000000', '000001', '999999']);
    for (let i = 0; i < 200; i += 1) {
      const candidate = String(Math.floor(Math.random() * 999999) + 1).padStart(6, '0');
      if (!reserved.has(candidate)) return candidate;
    }
    return String(Date.now()).slice(-6);
  }

  /**
   * 校验一枚编号能否签发。
   * @returns {{ok: boolean, reason?: string}} 不通过时 reason 为可直接展示的中文说明
   */
  function validateSerialNo(serial) {
    const clean = normalizeSerialInput(serial);
    if (!clean || clean.length !== 6) {
      return { ok: false, reason: '编号需为六位数字。' };
    }
    if (clean === '000000') {
      return { ok: false, reason: '000000 为系统占位号，不可签发。' };
    }

    // 与角色 / NPC / 系统保留池查重。排除执行员本体自己已占的号，
    // 否则反复进出第七步时会把自己刚领的号判成冲突。
    if (window.ResonanceUI && typeof ResonanceUI.collectTakenSerials === 'function') {
      try {
        const taken = ResonanceUI.collectTakenSerials(null);
        const mine = normalizeSerialInput(window.Store ? Store.getSerialNo() : '');
        if (taken.has(clean) && clean !== mine) {
          let owner = null;
          if (typeof ResonanceUI.findSerialOwner === 'function') {
            owner = ResonanceUI.findSerialOwner(clean, null);
          }
          return {
            ok: false,
            reason: owner
              ? `NO.${clean} 已被「${owner}」占用，请换一个编号。`
              : `NO.${clean} 已被占用，请换一个编号。`
          };
        }
      } catch (err) {
        console.warn('[Onboarding] 编号查重跳过:', err);
      }
    }

    return { ok: true };
  }

  /**
   * 编号牌数字滚动定格动效。
   * 六位一起快速乱跳，再从左到右逐位锁定，营造签发机的落位感。
   * @param {string} finalSerial 最终定格的六位编号
   */
  function runSerialRollAnimation(finalSerial) {
    const digitsEl = document.getElementById('onboardingSerialDigits');
    const stateEl = document.getElementById('onboardingSerialState');
    if (!digitsEl) return;

    // 上一轮动画未走完就被再次触发时，先掐掉，避免两个定时器互相打架
    if (serialRollTimer) {
      clearInterval(serialRollTimer);
      serialRollTimer = null;
    }

    const target = String(finalSerial).padStart(6, '0').slice(-6);
    if (stateEl) stateEl.textContent = 'SIGNING // 签发中';
    digitsEl.classList.add('is-rolling');

    let locked = 0;          // 已锁定的位数
    let tick = 0;            // 帧计数
    const TICK_MS = 45;      // 单帧间隔
    const TICKS_PER_LOCK = 4; // 每锁定一位所需帧数

    serialRollTimer = setInterval(() => {
      tick += 1;
      if (tick % TICKS_PER_LOCK === 0 && locked < 6) locked += 1;

      let out = target.slice(0, locked);
      for (let i = locked; i < 6; i += 1) {
        out += String(Math.floor(Math.random() * 10));
      }
      digitsEl.textContent = out;

      if (locked >= 6) {
        clearInterval(serialRollTimer);
        serialRollTimer = null;
        digitsEl.textContent = target;
        digitsEl.classList.remove('is-rolling');
        digitsEl.classList.add('is-locked');
        if (stateEl) stateEl.textContent = 'ISSUED // 已签发';
      }
    }, TICK_MS);
  }

  /**
   * 把编号同步进牌面、输入框与问候语。
   * @param {string} serial 六位编号
   * @param {boolean} [animate] 是否播放滚动定格动效
   */
  function renderSerialPlate(serial, animate) {
    const clean = normalizeSerialInput(serial);
    const digitsEl = document.getElementById('onboardingSerialDigits');
    const inputEl = document.getElementById('onboardingSerialInput');
    const greetEl = document.getElementById('onboardingSerialGreeting');
    const stateEl = document.getElementById('onboardingSerialState');

    if (inputEl && inputEl.value !== clean) inputEl.value = clean;

    if (greetEl) {
      greetEl.textContent = clean
        ? `你的入职手续已全部办理完毕。欢迎你，${clean} 号执行员。`
        : '你的入职手续已全部办理完毕。';
    }

    if (animate) {
      runSerialRollAnimation(clean);
      return;
    }

    if (digitsEl) {
      digitsEl.textContent = clean || '------';
      digitsEl.classList.remove('is-rolling');
      digitsEl.classList.toggle('is-locked', !!clean);
    }
    if (stateEl) stateEl.textContent = clean ? 'ISSUED // 已签发' : 'PENDING // 待签发';
  }

  /** 编号输入区的提示行：空字符串即清空 */
  function setSerialTip(text, isError) {
    const tipEl = document.getElementById('onboardingSerialTip');
    if (!tipEl) return;
    tipEl.textContent = text || '';
    tipEl.classList.toggle('is-error', !!isError);
  }

  /**
   * 进入步骤七：首次自动签发一枚编号，之后沿用存档里的号不再重摇，
   * 否则用户改好的号会在来回翻页时被冲掉。
   */
  function prepareStep7() {
    if (!pendingSerialNo) {
      const saved = loadProgress();
      const fromSave = saved && saved.serialNo ? normalizeSerialInput(saved.serialNo) : '';
      // 存档里的号优先；其次沿用已领取的号；都没有才新签发
      const claimed = normalizeSerialInput(window.Store ? Store.getSerialNo() : '');
      pendingSerialNo = fromSave || claimed || issueSerialNo();
      renderSerialPlate(pendingSerialNo, true);
    } else {
      renderSerialPlate(pendingSerialNo, false);
    }
    setSerialTip('');
    saveProgress({ serialNo: pendingSerialNo });
  }

  /**
   * 初始化全屏用户协议 DOM
   */
  function initAgreementDOM() {
    if (agreementPageEl) return;

    agreementPageEl = document.createElement('div');
    agreementPageEl.id = 'onboardingAgreementPage';
    agreementPageEl.className = 'onboarding-agreement-page';
    agreementPageEl.setAttribute('aria-hidden', 'true');

    const sectionsHTML = AGREEMENT_DATA.sections.map(sec => `
      <section class="onboarding-agreement-section">
        <h3 class="onboarding-agreement-sec-title">${sec.title}</h3>
        ${sec.content}
      </section>
    `).join('');

    agreementPageEl.innerHTML = `
      <div class="onboarding-island-spacer"></div>

      <!-- 顶栏 -->
      <div class="onboarding-agreement-topbar">
        <div class="onboarding-agreement-head-info">
          <span class="onboarding-agreement-sub">${AGREEMENT_DATA.sub}</span>
          <h2 class="onboarding-agreement-title">${AGREEMENT_DATA.title}</h2>
        </div>
        <button type="button" class="onboarding-agreement-close" id="onboardingAgreementCloseBtn" title="关闭">
          ${ICONS.close}
        </button>
      </div>

      <!-- 滚动正文容器 -->
      <div class="onboarding-agreement-scroll" id="onboardingAgreementScroll">
        <div class="onboarding-agreement-content">
          <div class="onboarding-agreement-notice">
            ${AGREEMENT_DATA.notice}
          </div>
          ${sectionsHTML}
        </div>
      </div>

      <!-- 底部操作栏：滚到底部解锁确认 -->
      <div class="onboarding-agreement-footer">
        <span class="onboarding-agreement-hint" id="onboardingAgreementHint">请向下滑动阅读全文 (0%)</span>
        <button type="button" class="onboarding-agreement-btn is-locked" id="onboardingAgreementConfirmBtn" disabled>
          <span id="onboardingAgreementBtnText">请阅读至底部以解锁确认</span>
        </button>
      </div>
    `;

    document.body.appendChild(agreementPageEl);

    // 绑定协议内事件
    const scrollEl = document.getElementById('onboardingAgreementScroll');
    const confirmBtn = document.getElementById('onboardingAgreementConfirmBtn');
    const hintEl = document.getElementById('onboardingAgreementHint');
    const btnTextEl = document.getElementById('onboardingAgreementBtnText');
    const closeBtn = document.getElementById('onboardingAgreementCloseBtn');

    if (closeBtn) {
      closeBtn.addEventListener('click', closeAgreementPage);
    }

    if (scrollEl && confirmBtn) {
      let unlocked = false;

      scrollEl.addEventListener('scroll', () => {
        if (unlocked) return;

        const scrollTop = scrollEl.scrollTop;
        const scrollHeight = scrollEl.scrollHeight;
        const clientHeight = scrollEl.clientHeight;

        const maxScroll = scrollHeight - clientHeight;
        if (maxScroll <= 0) {
          // 内容不足一屏直接解锁
          unlockAgreement(confirmBtn, hintEl, btnTextEl);
          unlocked = true;
          return;
        }

        const progress = Math.min(100, Math.max(0, Math.round((scrollTop / maxScroll) * 100)));
        if (hintEl) {
          hintEl.textContent = `请向下滑动阅读全文 (${progress}%)`;
        }

        // 触底判定（留 24px 裕度）
        if (maxScroll - scrollTop <= 24) {
          unlockAgreement(confirmBtn, hintEl, btnTextEl);
          unlocked = true;
        }
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (confirmBtn.disabled) return;
        isAgreementAgreed = true;

        // 欢迎页 03 卡片视觉点亮
        const card03 = pageEl ? pageEl.querySelector('.onboarding-hud-card[data-hud-id="03"]') : null;
        if (card03) {
          card03.classList.add('is-agreed');
          const arrowEl = card03.querySelector('.onboarding-hud-card-arrow');
          if (arrowEl) {
            arrowEl.innerHTML = ICONS.check;
          }
        }

        // 签署态落档，刷新后不必重签
        saveProgress();

        closeAgreementPage();
      });
    }
  }

  function unlockAgreement(confirmBtn, hintEl, btnTextEl) {
    if (!confirmBtn) return;
    confirmBtn.disabled = false;
    confirmBtn.classList.remove('is-locked');
    confirmBtn.classList.add('is-unlocked');
    if (btnTextEl) {
      btnTextEl.innerHTML = `${ICONS.check} <span>我已阅读并同意以上全部条款</span>`;
    }
    if (hintEl) {
      hintEl.textContent = 'PROTOCOL // 已滑动到底部 · 条款已就绪';
    }
  }

  /**
   * 打开全屏用户协议
   */
  function openAgreementPage() {
    initAgreementDOM();
    if (!agreementPageEl) return;
    agreementPageEl.classList.add('is-open');
    agreementPageEl.setAttribute('aria-hidden', 'false');
  }

  /**
   * 关闭全屏用户协议
   */
  function closeAgreementPage() {
    if (!agreementPageEl) return;
    agreementPageEl.classList.remove('is-open');
    agreementPageEl.setAttribute('aria-hidden', 'true');
  }

  /**
   * 关闭抽屉详情
   */
  function closeDrawer() {
    const overlay = document.getElementById('onboardingDrawerOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  /**
   * 绑定事件
   */
  function bindEvents() {
    // 退出开场
    const closeBtn = document.getElementById('onboardingCloseBtn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        close();
      });
    }

    // 三个说明入口点击：01 / 02 打开半屏抽屉，03 打开全屏用户协议
    const hudCards = pageEl.querySelectorAll('.onboarding-hud-card');
    hudCards.forEach((btn) => {
      btn.addEventListener('click', () => {
        const hudId = btn.getAttribute('data-hud-id');
        if (hudId === '03') {
          openAgreementPage();
        } else {
          openDrawer(hudId);
        }
      });
    });

    // 抽屉收起
    const drawerClose = document.getElementById('onboardingDrawerClose');
    const drawerConfirm = document.getElementById('onboardingDrawerConfirm');
    const drawerOverlay = document.getElementById('onboardingDrawerOverlay');

    if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
    if (drawerConfirm) drawerConfirm.addEventListener('click', closeDrawer);
    if (drawerOverlay) {
      drawerOverlay.addEventListener('click', (e) => {
        if (e.target === drawerOverlay) closeDrawer();
      });
    }

    // 步骤一切换至步骤二
    const step1NextBtn = document.getElementById('onboardingStep1NextBtn');
    if (step1NextBtn) {
      step1NextBtn.addEventListener('click', () => {
        if (!isAgreementAgreed) {
          if (window.RetroToast) {
            window.RetroToast.show({
              tag: 'PROTOCOL // 协议未签署',
              message: '请先完整阅读并同意用户协议',
              detail: '请点击下方 03 项「权责声明 · 用户协议」阅毕确认',
              type: 'warn'
            });
          }
          // 欢迎页 03 卡片高亮提醒
          const card03 = pageEl ? pageEl.querySelector('.onboarding-hud-card[data-hud-id="03"]') : null;
          if (card03) {
            card03.classList.add('is-attention');
            setTimeout(() => card03.classList.remove('is-attention'), 1200);
          }
          return;
        }

        goToStep(2);
      });
    }

    // 步骤二：上一步
    const step2PrevBtn = document.getElementById('onboardingStep2PrevBtn');
    if (step2PrevBtn) {
      step2PrevBtn.addEventListener('click', () => {
        goToStep(1);
      });
    }

    // 步骤二：配置 API 按钮
    const apiConfigBtn = document.getElementById('onboardingApiConfigBtn');
    if (apiConfigBtn) {
      apiConfigBtn.addEventListener('click', () => {
        openApiSettings();
      });
    }

    // 步骤二：下一步按钮
    const step2NextBtn = document.getElementById('onboardingStep2NextBtn');
    if (step2NextBtn) {
      step2NextBtn.addEventListener('click', () => {
        if (step2NextBtn.disabled) return;
        goToStep(3);
      });
    }

    // 步骤三：上一步按钮
    const step3PrevBtn = document.getElementById('onboardingStep3PrevBtn');
    if (step3PrevBtn) {
      step3PrevBtn.addEventListener('click', () => {
        goToStep(2);
      });
    }

    // 步骤三：头像上传点击
    const avatarTrigger = document.getElementById('onboardingAvatarTrigger');
    if (avatarTrigger) {
      avatarTrigger.addEventListener('click', () => {
        if (window.ImagePicker && typeof ImagePicker.open === 'function') {
          ImagePicker.open({
            title: '上传档案证件照 / 头像 (2:3)',
            onSelect: async (res) => {
              if (!res) return;
              if (res.type === 'file' && res.file) {
                pendingAvatarFile = res.file;
                const tempUrl = URL.createObjectURL(res.file);
                const previewImg = document.getElementById('onboardingAvatarPreview');
                const placeholder = document.getElementById('onboardingAvatarPlaceholder');
                if (previewImg) {
                  previewImg.src = tempUrl;
                  previewImg.hidden = false;
                }
                if (placeholder) {
                  placeholder.hidden = true;
                }
              }
            }
          });
        }
      });
    }

    // 步骤三：性别单选胶囊
    const genderPills = document.querySelectorAll('.onboarding-gender-pill');
    const genderInput = document.getElementById('onboardingGenderInput');
    genderPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        genderPills.forEach((p) => p.classList.remove('is-active'));
        pill.classList.add('is-active');
        if (genderInput) {
          genderInput.value = pill.dataset.gender || '女';
        }
      });
    });

    // 步骤三：生日点击唤起通用 DatePickerModal
    const birthdayTrigger = document.getElementById('onboardingBirthdayTrigger');
    const birthdayInput = document.getElementById('onboardingBirthdayInput');
    const birthdayDisplay = document.getElementById('onboardingBirthdayDisplay');
    if (birthdayTrigger) {
      birthdayTrigger.addEventListener('click', async () => {
        if (window.DatePickerModal && typeof DatePickerModal.pick === 'function') {
          const currentVal = birthdayInput ? birthdayInput.value : '';
          const picked = await DatePickerModal.pick({
            title: '选择诞生日',
            value: currentVal
          });
          if (picked !== null && picked !== undefined) {
            if (birthdayInput) birthdayInput.value = picked;
            if (birthdayDisplay) {
              birthdayDisplay.textContent = picked || '点击选择诞生日';
            }
          }
        }
      });
    }

    // 步骤三：姓名输入监听（驱动完成按钮点亮）
    const nameInput = document.getElementById('onboardingNameInput');
    const finishBtn = document.getElementById('onboardingStep3FinishBtn');
    if (nameInput) {
      nameInput.addEventListener('input', refreshStep3FinishState);
    }

    // 步骤三：完成录入并生成档案
    if (finishBtn) {
      finishBtn.addEventListener('click', async () => {
        if (finishBtn.disabled) return;
        const nameVal = nameInput ? nameInput.value.trim() : '';
        if (!nameVal) return;

        const genderVal = genderInput ? genderInput.value.trim() : '女';
        const birthdayVal = birthdayInput ? birthdayInput.value.trim() : '';
        const appearanceInput = document.getElementById('onboardingAppearanceInput');
        const profileInput = document.getElementById('onboardingProfileInput');

        const appearanceVal = appearanceInput ? appearanceInput.value.trim() : '';
        const profileVal = profileInput ? profileInput.value.trim() : '';

        // 1. 持久化存入 Store.envoy.identity
        try {
          if (window.Store && typeof Store.save === 'function') {
            const currentIdentity = Store.envoy && Store.envoy.identity ? Store.envoy.identity : {};
            await Store.save('envoy.identity', {
              ...currentIdentity,
              name: nameVal,
              gender: genderVal,
              birthday: birthdayVal,
              appearance: appearanceVal,
              profile: profileVal
            });
          }
        } catch (err) {
          console.error('[Onboarding] 保存档案数据异常:', err);
        }

        // 2. 如果有头像文件，压缩后存入 personaAvatar
        if (pendingAvatarFile && window.Storage && window.DataRegistry) {
          try {
            const compressed = await Storage.compressImage(pendingAvatarFile, 1200, 0.88);
            await Storage.setAsset(DataRegistry.key.personaAvatar(), compressed);
          } catch (err) {
            console.error('[Onboarding] 头像压缩与保存异常:', err);
          }
        }

        // 3. 顺畅进入步骤四 (部门与核心欲望)
        goToStep(4);
      });
    }

    // 步骤四：上一步按钮
    const step4PrevBtn = document.getElementById('onboardingStep4PrevBtn');
    if (step4PrevBtn) {
      step4PrevBtn.addEventListener('click', () => {
        goToStep(3);
      });
    }

    // 步骤四：部门步进拨盘切换
    const deptPrevBtn = document.getElementById('onboardingDeptPrevBtn');
    const deptNextBtn = document.getElementById('onboardingDeptNextBtn');
    const deptNameEl = document.getElementById('onboardingDeptName');
    const deptSubEl = document.getElementById('onboardingDeptSub');
    const deptDescText = document.getElementById('onboardingDeptDescText');
    const deptDisplay = document.getElementById('onboardingDeptDisplay');
    const deptDescBox = document.getElementById('onboardingDeptDescBox');

    function toggleDepartment() {
      selectedDept = selectedDept === 'three_thousand' ? 'infinite' : 'three_thousand';
      const conf = DEPT_CONFIGS[selectedDept];

      if (deptDisplay) deptDisplay.classList.add('is-switching');
      if (deptDescBox) deptDescBox.classList.add('is-switching');

      setTimeout(() => {
        if (deptNameEl) deptNameEl.textContent = conf.name;
        if (deptSubEl) deptSubEl.textContent = conf.sub;
        if (deptDescText) deptDescText.textContent = conf.desc;

        if (deptDisplay) deptDisplay.classList.remove('is-switching');
        if (deptDescBox) deptDescBox.classList.remove('is-switching');
      }, 160);
    }

    if (deptPrevBtn) deptPrevBtn.addEventListener('click', toggleDepartment);
    if (deptNextBtn) deptNextBtn.addEventListener('click', toggleDepartment);

    // 步骤四：核心欲望灵感胶囊点击注入
    const desirePills = document.querySelectorAll('.onboarding-desire-pill');
    const desireInput = document.getElementById('onboardingDesireInput');
    desirePills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const text = pill.dataset.text || '';
        if (desireInput) {
          desireInput.value = text;
          desireInput.focus();
        }
      });
    });

    // 步骤四：确认意向，进入步骤五激发天赋
    const step4NextBtn = document.getElementById('onboardingStep4NextBtn');
    if (step4NextBtn) {
      step4NextBtn.addEventListener('click', async () => {
        const desireVal = desireInput ? desireInput.value.trim() : '';
        const finalDesire = desireVal || '勘破因果律之终局，于崩塌的世界线中重塑真实锚点。';

        // 写入观测档案（部门 + 核心欲望），落 envoy.psych 域
        // 注意：入役时间戳 joinedAt 不在这里写——在役天数从步骤七「完成入职」那一刻才起算
        try {
          if (window.PsychStore && typeof PsychStore.load === 'function' && typeof PsychStore.save === 'function') {
            const profile = PsychStore.load();
            profile.department = selectedDept;
            profile.coreDesire = finalDesire;

            await PsychStore.save(profile);
          }
        } catch (err) {
          console.error('[Onboarding] 保存部门与欲望异常:', err);
        }

        // 落库后刷新观测档案视图
        try {
          if (window.PsychArchiveApp && typeof PsychArchiveApp.renderAll === 'function') {
            PsychArchiveApp.renderAll();
          }
        } catch (err) {
          console.error('[Onboarding] 刷新观测档案视图异常:', err);
        }

        // 顺畅进入步骤五 (激发天赋)
        goToStep(5);
      });
    }

    // 步骤五：上一步按钮 (待激发态：返回步骤四重新调整部门与欲望)
    const step5PrevBtn = document.getElementById('onboardingStep5PrevBtn');
    if (step5PrevBtn) {
      step5PrevBtn.addEventListener('click', () => {
        goToStep(4);
      });
    }

    // 步骤五：上一步按钮 (解析完成态：返回步骤四重新调整部门与欲望)
    const step5PostPrevBtn = document.getElementById('onboardingStep5PostPrevBtn');
    if (step5PostPrevBtn) {
      step5PostPrevBtn.addEventListener('click', () => {
        goToStep(4);
      });
    }

    // 步骤五：激发天赋权能按钮 (初次激发)
    const talentAwakenBtn = document.getElementById('onboardingTalentAwakenBtn');
    if (talentAwakenBtn) {
      talentAwakenBtn.addEventListener('click', () => {
        runTalentAwaken(talentAwakenBtn);
      });
    }

    // 步骤五：重新激发按钮 (候选池顶部重 roll)
    const talentRerollBtn = document.getElementById('onboardingTalentRerollBtn');
    if (talentRerollBtn) {
      talentRerollBtn.addEventListener('click', () => {
        runTalentAwaken(talentRerollBtn);
      });
    }

    // 步骤五：确认专属天赋 · 固化权能
    const talentConfirmBtn = document.getElementById('onboardingStep5ConfirmBtn');
    if (talentConfirmBtn) {
      talentConfirmBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('onboardingTalentCustomName');
        const descInput = document.getElementById('onboardingTalentCustomDesc');
        const finalName = nameInput ? nameInput.value.trim() : '';
        const finalDesc = descInput ? descInput.value.trim() : '';

        if (!finalName) {
          toastTalent('VALIDATION // 校验未通过', '请填写或选择一项天赋名称', '天赋是执行员的核心技能，不可为空。', 'warning');
          if (nameInput) nameInput.focus();
          return;
        }

        if (!finalDesc) {
          toastTalent('VALIDATION // 校验未通过', '请填写天赋的具体说明', '请为天赋添加简短的能力表现或联系。', 'warning');
          if (descInput) descInput.focus();
          return;
        }

        // 落盘进 PsychStore（envoy.psych 域，与个人档案同源同介质）
        let saved = false;
        try {
          if (window.PsychStore && typeof PsychStore.load === 'function' && typeof PsychStore.save === 'function') {
            const profile = PsychStore.load();
            profile.talent = {
              name: finalName,
              rank: '', // 天赋无品阶无等级，保持空字符串
              desc: finalDesc
            };
            saved = await PsychStore.save(profile);
          } else {
            console.error('[Onboarding] PsychStore 未就绪，天赋写入被跳过');
          }
        } catch (err) {
          console.error('[Onboarding] 固化天赋权能异常:', err);
        }

        // 落盘失败不谎报成功，让执行员知道要重试
        if (!saved) {
          toastTalent(
            'ERROR // 固化失败',
            '天赋未能写入灵魂契约',
            '本地存储异常，请重试或刷新页面后再次确认。',
            'error'
          );
          return;
        }

        // 刷新观测档案板块 03（专属天赋）与预览卡片
        try {
          if (window.PsychArchiveApp && typeof PsychArchiveApp.renderAll === 'function') {
            PsychArchiveApp.renderAll();
          }
        } catch (err) {
          console.error('[Onboarding] 刷新观测档案视图异常:', err);
        }

        // 平滑进入步骤六：选择系统助手
        goToStep(6);
        console.info('[Talent] 天赋已固化落盘，切入步骤六:', { name: finalName, desc: finalDesc });
      });
    }

    // 步骤五：天赋草稿输入即存档，手写内容刷新后不丢
    const talentNameInput = document.getElementById('onboardingTalentCustomName');
    const talentDescInput = document.getElementById('onboardingTalentCustomDesc');
    let talentDraftTimer = null;
    const scheduleDraftSave = () => {
      // 输入过程不必每个字符都写库，停手 400ms 再落一次
      if (talentDraftTimer) clearTimeout(talentDraftTimer);
      talentDraftTimer = setTimeout(() => {
        talentDraftTimer = null;
        saveProgress();
      }, 400);
    };
    if (talentNameInput) talentNameInput.addEventListener('input', scheduleDraftSave);
    if (talentDescInput) talentDescInput.addEventListener('input', scheduleDraftSave);

    // 步骤六：漫画分镜点击选中切换
    const comicPanels = document.querySelectorAll('.onboarding-comic-panel');
    comicPanels.forEach((panel) => {
      panel.addEventListener('click', () => {
        comicPanels.forEach(p => p.classList.remove('is-selected'));
        panel.classList.add('is-selected');
        selectedAssistantId = panel.dataset.assistantId || 'asst_system_core';
        syncStep6NextText();
        syncStep6Brief();
        saveProgress();
      });
    });

    // 步骤六：查看完整档案 / 创建助手档案
    const asstDossierBtn = document.getElementById('onboardingAsstDossierBtn');
    if (asstDossierBtn) {
      asstDossierBtn.addEventListener('click', () => {
        if (selectedAssistantId === 'asst_custom') {
          openCustomAssistantForge();
          return;
        }

        const preset = window.PresetAssistants
          ? PresetAssistants.get(selectedAssistantId)
          : null;
        if (!preset) return;

        openDrawerWith({
          tag: `PERSONA // ${preset.serialNo}`,
          title: `${preset.name} · 人格模组档案`,
          body: buildAssistantDossierBody(preset)
        });
      });
    }

    // 步骤六：上一步按钮 (退回步骤五)
    const step6PrevBtn = document.getElementById('onboardingStep6PrevBtn');
    if (step6PrevBtn) {
      step6PrevBtn.addEventListener('click', () => {
        goToStep(5);
      });
    }

    // 步骤六：确认指派
    const step6NextBtn = document.getElementById('onboardingStep6NextBtn');
    if (step6NextBtn) {
      step6NextBtn.addEventListener('click', async () => {
        if (selectedAssistantId === 'asst_custom') {
          // 自定义槽位本身不是可接入的身份，先送去建档；建完会自动改选为新助手
          openCustomAssistantForge();
          return;
        }

        // 保存/激活选中的预设助手
        try {
          if (window.Store && Store.roster) {
            let list = Array.isArray(Store.roster.assistants) ? Store.roster.assistants.slice() : [];

            // 从预设注册表补齐选中助手的骨架（人设待定稿，此处只落名字/性别/编号/立绘）
            const preset = window.PresetAssistants
              ? PresetAssistants.get(selectedAssistantId)
              : null;
            if (preset) {
              const existing = list.find(a => a && a.id === selectedAssistantId);
              if (existing) {
                // 升级兼容：仅补空缺字段，不覆盖用户已改过的内容
                if (!existing.name) existing.name = preset.name;
                if (!existing.gender) existing.gender = preset.gender;
                if (!existing.serialNo) existing.serialNo = preset.serialNo;
                if (!existing.birthday) existing.birthday = preset.birthday;
                if (!existing.builtIn) existing.builtIn = true;
              } else {
                list.push({ ...preset, isActive: true });
              }
            }

            // 更新激活状态
            list.forEach(a => {
              if (a) a.isActive = (a.id === selectedAssistantId);
            });

            await Store.save('roster.assistants', list);
          }
        } catch (err) {
          console.error('[Onboarding] 助手指派落盘异常:', err);
        }

        // 把随包立绘灌进 Storage，让档案页与聊天头像复用既有 Blob 链路。
        // 失败不阻塞入役流程，仅记录告警。
        if (window.PresetAssistants && PresetAssistants.isPreset(selectedAssistantId)) {
          await PresetAssistants.seedPortraitAsset(selectedAssistantId);
        }

        // 助手已指派，推进到步骤七领取编号（完成标记留到那里打）
        saveProgress();
        console.info('[Onboarding] 助手指派完成，切入步骤七:', selectedAssistantId);
        goToStep(7);
      });
    }

    // 步骤七：上一步按钮 (退回步骤六)
    const step7PrevBtn = document.getElementById('onboardingStep7PrevBtn');
    if (step7PrevBtn) {
      step7PrevBtn.addEventListener('click', () => {
        goToStep(6);
      });
    }

    // 步骤七：手动改号。输入即净化为纯数字，失焦时补零归一并查重
    const serialInput = document.getElementById('onboardingSerialInput');
    if (serialInput) {
      serialInput.addEventListener('input', () => {
        // 只留数字，杜绝中文与符号混进编号
        const digits = serialInput.value.replace(/\D/g, '').slice(0, 6);
        if (serialInput.value !== digits) serialInput.value = digits;

        // 输入中不打断，够六位就即时给出校验反馈
        if (digits.length === 6) {
          const check = validateSerialNo(digits);
          if (check.ok) {
            pendingSerialNo = normalizeSerialInput(digits);
            setSerialTip('');
            renderSerialPlate(pendingSerialNo, false);
            saveProgress({ serialNo: pendingSerialNo });
          } else {
            setSerialTip(check.reason, true);
          }
        } else {
          setSerialTip('');
        }
      });

      serialInput.addEventListener('blur', () => {
        const clean = normalizeSerialInput(serialInput.value);
        // 清空或非法时回落到上一枚有效编号，不留空档
        if (!clean) {
          renderSerialPlate(pendingSerialNo, false);
          setSerialTip('');
          return;
        }

        const check = validateSerialNo(clean);
        if (!check.ok) {
          setSerialTip(check.reason, true);
          return;
        }

        pendingSerialNo = clean;
        setSerialTip('');
        renderSerialPlate(pendingSerialNo, false);
        saveProgress({ serialNo: pendingSerialNo });
      });
    }

    // 步骤七：重新签发一枚编号
    const serialRerollBtn = document.getElementById('onboardingSerialRerollBtn');
    if (serialRerollBtn) {
      serialRerollBtn.addEventListener('click', () => {
        pendingSerialNo = issueSerialNo();
        setSerialTip('');
        renderSerialPlate(pendingSerialNo, true);
        saveProgress({ serialNo: pendingSerialNo });
      });
    }

    // 步骤七：完成入职——编号在此刻才正式写入并锁定
    const step7FinishBtn = document.getElementById('onboardingStep7FinishBtn');
    if (step7FinishBtn) {
      step7FinishBtn.addEventListener('click', async () => {
        if (step7FinishBtn.disabled) return;

        const clean = normalizeSerialInput(
          (serialInput && serialInput.value) || pendingSerialNo
        );
        const check = validateSerialNo(clean);
        if (!check.ok) {
          setSerialTip(check.reason, true);
          if (serialInput) serialInput.focus();
          return;
        }

        step7FinishBtn.disabled = true;

        // 走 claimSerial 的 force 分支：早期版本给新档预置了占位号 000517
        // 并直接锁定，那些存档必须允许被正式签发的编号覆盖一次。
        let claimed = null;
        try {
          if (window.Store && typeof Store.claimSerial === 'function') {
            claimed = await Store.claimSerial(clean, true);
          }
        } catch (err) {
          console.error('[Onboarding] 编号签发异常:', err);
        }

        // 落盘失败不谎报成功，让执行员知道要重试
        if (!claimed || !claimed.ok) {
          step7FinishBtn.disabled = false;
          toastTalent(
            'ERROR // 签发失败',
            '编号未能写入执行员档案',
            '本地存储异常，请重试或刷新页面后再次确认。',
            'error'
          );
          return;
        }

        pendingSerialNo = claimed.serialNo;

        // 入役时间戳：在役天数从「完成入职」这一刻起算。
        // 已有值不覆盖，避免老档重走向导时把累计天数清零。
        try {
          if (window.PsychStore && typeof PsychStore.load === 'function' && typeof PsychStore.save === 'function') {
            const profile = PsychStore.load();
            if (!profile.career) profile.career = {};
            if (!profile.career.joinedAt) {
              profile.career.joinedAt = Date.now();
              await PsychStore.save(profile);
            }
          }
        } catch (err) {
          console.error('[Onboarding] 写入入役时间戳异常:', err);
        }

        // 同步桌面红卡与身份档案的编号显示
        try {
          window.dispatchEvent(new CustomEvent('retroflow:serial-changed', {
            detail: claimed.serialNo
          }));
        } catch (_) { /* ignore */ }

        // 桌面在役履历面板重算「加入计划 N 天」
        try {
          window.dispatchEvent(new CustomEvent('retroflow:career-changed'));
        } catch (_) { /* ignore */ }

        try {
          if (window.PsychArchiveApp && typeof PsychArchiveApp.renderAll === 'function') {
            PsychArchiveApp.renderAll();
          }
        } catch (err) {
          console.error('[Onboarding] 刷新观测档案视图异常:', err);
        }

        // 整个向导至此真正走完
        saveProgress({ completed: true, serialNo: claimed.serialNo });
        console.info('[Onboarding] 入职完成，编号已签发:', claimed.serialNo);
        close();
      });
    }
  }

  /**
   * 步骤五：发起天赋激发请求。
   * 拼提示词 → 请主模型 → 解析五条 → 渲染五选一候选列表与编辑表单。
   * @param {HTMLElement} btn 触发按钮，用于 Loading 态与防连点
   */
  async function runTalentAwaken(btn) {
    if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;

    // 1. 依赖与配置自检：缺任何一环都当场说清楚，不要静默失败
    if (!window.TalentPrompt || !window.RetroflowAPI || !window.RetroflowApiUI) {
      toastTalent('MODULE // 模块未就绪', '天赋解析模块尚未加载', '请刷新页面后重试。', 'error');
      return;
    }

    const config = (typeof RetroflowApiUI.resolveSlot === 'function')
      ? RetroflowApiUI.resolveSlot('main')
      : null;
    if (!config || !config.baseUrl || !config.modelId) {
      toastTalent('API // 节点未接入', '尚未配置可用的模型节点', '请返回步骤二完成 API 配置后再激发。', 'error');
      return;
    }

    // 2. 进入 Loading 脉冲态
    btn.classList.add('is-loading');
    btn.disabled = true;
    talentAwakenAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    try {
      // 3. 拼装提示词：重新激发时带上上一轮被废弃的候选
      const prompt = TalentPrompt.buildPrompt(lastDiscardedTalents);
      console.info('[Talent] ===== 本轮提示词 =====\n' + prompt);

      const result = await RetroflowAPI.chat(
        config,
        [{ role: 'user', content: prompt }],
        { signal: talentAwakenAbort ? talentAwakenAbort.signal : undefined }
      );
      const raw = String((result && result.content) || '').trim();
      console.info('[Talent] ===== 模型原始返回 =====\n' + raw);

      // 4. 解析候选
      const talents = TalentPrompt.parseTalents(raw);
      console.info(`[Talent] ===== 解析结果：共 ${talents.length} 条 =====`);
      talents.forEach((t, i) => {
        console.info(`[Talent] ${i + 1}. 【${t.name}】${t.desc}`);
      });

      if (talents.length !== 5) {
        toastTalent(
          'PARSE // 解析异常',
          `仅解析出 ${talents.length} 条候选天赋`,
          '返回格式不符合协议，请重新激发。',
          'error'
        );
        return;
      }

      // 5. 本轮候选记为「下一次重 roll 需要避开的方向」
      lastDiscardedTalents = talents.slice();
      talentCandidates = talents.slice();

      // 6. 渲染候选列表与结果区
      renderTalentCandidates(talents);

      // 候选与重 roll 记忆一并落档，刷新后候选池不用重新生成
      saveProgress();
    } catch (err) {
      if (err && err.name === 'AbortError') {
        console.info('[Talent] 激发请求已取消');
        return;
      }
      console.error('[Talent] 天赋激发失败:', err);
      toastTalent(
        'ERROR // 共鸣中断',
        '天赋解析请求失败',
        (err && err.message) ? String(err.message) : '网络或节点异常，请稍后重试。',
        'error'
      );
    } finally {
      talentAwakenAbort = null;
      btn.classList.remove('is-loading');
      btn.disabled = false;
    }
  }

  // 天赋 5 球弧形轮播当前选中的索引 (0 ~ 4)
  let activeTalentArcIndex = 0;
  let talentArcTouchStartX = 0;
  let talentArcTouchCurrentX = 0;
  let talentArcIsDragging = false;

  /**
   * 步骤五：5 球弧形轮播位置与外观重绘
   * 根据当前 activeTalentArcIndex，计算 5 个球相对偏量 (offset: -2, -1, 0, 1, 2)
   * 抛物线方程：
   *   X 轴位移：offset * 68px
   *   Y 轴位移：|offset|^1.35 * 18px (下沉成一条优雅微笑弧线)
   *   尺寸与透明度：居中最大最亮，两翼递减
   */
  function updateTalentArcCarousel() {
    const track = document.getElementById('onboardingTalentArcTrack');
    const dossierCard = document.getElementById('onboardingTalentDossierCard');
    const codeEl = document.getElementById('onboardingTalentDossierCode');
    const indexEl = document.getElementById('onboardingTalentDossierIndex');
    const nameEl = document.getElementById('onboardingTalentDossierName');
    const descEl = document.getElementById('onboardingTalentDossierDesc');
    const nameInput = document.getElementById('onboardingTalentCustomName');
    const descInput = document.getElementById('onboardingTalentCustomDesc');

    if (!track || !talentCandidates || talentCandidates.length === 0) return;

    // 5 个相对槽位的有机非对称参数 (方案 A：散聚微差律，打破刻板对称)
    const SLOT_PARAMS = {
      '-2': { x: -136, y: -26, scale: 0.58, opacity: 0.32, zIndex: 1, cls: 'is-faint-2' },
      '-1': { x: -61,  y: -13, scale: 0.77, opacity: 0.65, zIndex: 3, cls: 'is-faint-1' },
      '0':  { x: 0,    y: 0,   scale: 1.0,  opacity: 1.0,  zIndex: 5, cls: 'is-active' },
      '1':  { x: 71,   y: -14, scale: 0.75, opacity: 0.62, zIndex: 3, cls: 'is-faint-1' },
      '2':  { x: 127,  y: -23, scale: 0.56, opacity: 0.30, zIndex: 1, cls: 'is-faint-2' }
    };

    const orbs = track.querySelectorAll('.onboarding-talent-orb');
    orbs.forEach((orb) => {
      const idx = parseInt(orb.dataset.index, 10);
      const offset = idx - activeTalentArcIndex;
      const key = String(offset);

      orb.classList.remove('is-active', 'is-faint-1', 'is-faint-2', 'is-out');

      if (SLOT_PARAMS[key]) {
        const p = SLOT_PARAMS[key];
        orb.classList.add(p.cls);
        orb.style.transform = `translate3d(calc(-50% + ${p.x}px), calc(-50% + ${p.y}px), 0) scale(${p.scale})`;
        orb.style.opacity = p.opacity;
        orb.style.zIndex = p.zIndex;
      } else {
        // 超出视界兜底
        orb.classList.add('is-out');
        const fallbackX = offset > 0 ? 180 : -180;
        orb.style.transform = `translate3d(calc(-50% + ${fallbackX}px), -50%, 0) scale(0.4)`;
        orb.style.opacity = 0;
        orb.style.zIndex = 0;
      }
    });

    // 同步更新下方解析说明展板
    const cur = talentCandidates[activeTalentArcIndex];
    if (cur) {
      if (dossierCard) {
        dossierCard.classList.remove('is-refreshing');
        void dossierCard.offsetWidth; // 触发 reflow 重启动画
        dossierCard.classList.add('is-refreshing');
      }
      if (codeEl) codeEl.textContent = `SLOT 0${activeTalentArcIndex + 1} // ACTIVE RESONANCE`;
      if (indexEl) indexEl.textContent = `0${activeTalentArcIndex + 1} / 05`;
      if (nameEl) nameEl.textContent = cur.name;
      if (descEl) descEl.textContent = cur.desc;

      // 实时同步给微调落盘输入框
      if (nameInput) nameInput.value = cur.name;
      if (descInput) descInput.value = cur.desc;
    }
  }

  /**
   * 步骤五：将 5 条候选天赋渲染进弧形轮播罗盘，并绑定拖拽与点击
   * @param {Array<{name: string, desc: string}>} list 
   */
  function renderTalentCandidates(list) {
    const stageEl = document.getElementById('onboardingStep5Stage');
    const resultAreaEl = document.getElementById('onboardingStep5ResultArea');
    const trackEl = document.getElementById('onboardingTalentArcTrack');
    const footerPre = document.getElementById('onboardingStep5FooterPre');
    const footerPost = document.getElementById('onboardingStep5FooterPost');
    const customToggleBtn = document.getElementById('onboardingTalentCustomToggleBtn');
    const customBox = document.getElementById('onboardingTalentCustomBox');
    const customToggleLabel = document.getElementById('onboardingTalentCustomToggleLabel');

    if (!trackEl) return;

    // 1. 切换至“解析完成与选择态”
    if (stageEl) stageEl.style.display = 'none';
    if (resultAreaEl) resultAreaEl.style.display = 'flex';
    if (footerPre) footerPre.style.display = 'none';
    if (footerPost) footerPost.style.display = 'flex';

    // 2. 清空并生成 5 个圆球节点
    trackEl.innerHTML = '';
    activeTalentArcIndex = 0; // 默认选中第 1 个

    list.forEach((item, index) => {
      const orb = document.createElement('div');
      orb.className = 'onboarding-talent-orb' + (index === 0 ? ' is-active' : '');
      orb.dataset.index = String(index);

      const idxStr = String(index + 1).padStart(2, '0');
      orb.innerHTML = `
        <div class="onboarding-talent-orb-inner">
          <span class="onboarding-talent-orb-badge">${idxStr}</span>
          <span class="onboarding-talent-orb-name">${escapeHtml(item.name)}</span>
          <span class="onboarding-talent-orb-halo" aria-hidden="true"></span>
        </div>
      `;

      // 点击圆球直接切换至该球
      orb.addEventListener('click', () => {
        if (activeTalentArcIndex !== index) {
          activeTalentArcIndex = index;
          updateTalentArcCarousel();
        }
      });

      trackEl.appendChild(orb);
    });

    // 3. 绑定移动端触摸滑动 (Touch Swipe) 监听
    const stageContainer = document.getElementById('onboardingTalentArcStage');
    if (stageContainer && !stageContainer.dataset.bound) {
      stageContainer.dataset.bound = 'true';

      stageContainer.addEventListener('touchstart', (e) => {
        if (!e.touches || e.touches.length === 0) return;
        talentArcTouchStartX = e.touches[0].clientX;
        talentArcTouchCurrentX = talentArcTouchStartX;
        talentArcIsDragging = true;
      }, { passive: true });

      stageContainer.addEventListener('touchmove', (e) => {
        if (!talentArcIsDragging || !e.touches || e.touches.length === 0) return;
        talentArcTouchCurrentX = e.touches[0].clientX;
      }, { passive: true });

      stageContainer.addEventListener('touchend', () => {
        if (!talentArcIsDragging) return;
        talentArcIsDragging = false;
        const diffX = talentArcTouchCurrentX - talentArcTouchStartX;
        const swipeThreshold = 36; // 36px 即触发灵敏切页

        if (diffX < -swipeThreshold) {
          // 向左滑：看右侧下一个 (index + 1)
          if (activeTalentArcIndex < list.length - 1) {
            activeTalentArcIndex++;
            updateTalentArcCarousel();
          }
        } else if (diffX > swipeThreshold) {
          // 向右滑：看左侧上一个 (index - 1)
          if (activeTalentArcIndex > 0) {
            activeTalentArcIndex--;
            updateTalentArcCarousel();
          }
        }
      });
    }

    // 4. 自定义微调折叠展开按钮
    if (customToggleBtn && !customToggleBtn.dataset.bound) {
      customToggleBtn.dataset.bound = 'true';
      customToggleBtn.addEventListener('click', () => {
        if (!customBox) return;
        const isHidden = customBox.style.display === 'none';
        customBox.style.display = isHidden ? 'flex' : 'none';
        if (customToggleLabel) {
          customToggleLabel.textContent = isHidden ? '收起自定义' : '自定义调整';
        }
      });
    }

    // 5. 立即计算并渲染一次初始状态
    updateTalentArcCarousel();
  }

  /** 战术 Toast 薄封装：RetroToast 缺席时安静退化，不阻断主流程 */
  function toastTalent(tag, message, detail, type) {
    if (!window.RetroToast) return;
    window.RetroToast.show({ tag, message, detail, type });
  }

  /**
   * 步骤切换
   */
  /**
   * 步骤切换 (带方向感知的 iOS 级弹性平滑推拉动效)
   */
  function goToStep(step) {
    const prevStep = currentStep;
    currentStep = step;

    // 计算切步方向：正向前进 vs 反向回退
    const isForward = step > prevStep;
    const isDirectional = prevStep > 0 && prevStep !== step;

    const hudCode = document.getElementById('onboardingHudCode');
    if (hudCode) {
      // 步骤七是收尾的编号签发，与前六步的 INITIALIZE 区分开
      const prefix = step === 7 ? 'ENLISTMENT' : 'INITIALIZE';
      hudCode.textContent = `${prefix} // ${String(step).padStart(2, '0')}`;
    }

    // 统一遍历全部步骤视图：目标步激活，其余一律摘掉 is-active 并补 aria-hidden。
    const TOTAL_STEPS = 7;
    for (let i = 1; i <= TOTAL_STEPS; i += 1) {
      const view = document.getElementById(`onboardingStep${i}`);
      if (!view) continue;

      // 无论激活与否，先摘除旧的单次飞入动画 class
      view.classList.remove('is-slide-forward', 'is-slide-backward');

      if (i === step) {
        view.classList.add('is-active');
        view.removeAttribute('aria-hidden');

        // 仅在真实切步时施加方向推拉动画，初次初始化时静默出现
        if (isDirectional) {
          view.classList.add(isForward ? 'is-slide-forward' : 'is-slide-backward');
        }

        // 滚动主体顺手重置到顶端，避免上一步的滚动残留
        const scrollBody = view.querySelector('.onboarding-scroll-body');
        if (scrollBody) scrollBody.scrollTop = 0;
      } else {
        view.classList.remove('is-active');
        view.setAttribute('aria-hidden', 'true');
      }
    }

    // 各步进入时的数据回填与状态刷新
    if (step === 2) {
      checkAndRefreshApiStatus();
    } else if (step === 3) {
      // 回填已存身份档案：姓名/性别/生日/外貌/设定与证件照都不从头再填
      prefillStep3();
    } else if (step === 4) {
      // 回填已存档案：部门拨盘与核心欲望不从头开始，来回翻页不丢已填内容
      prefillStep4();
    } else if (step === 5) {
      // 回显选中的部门与核心欲望
      updateStep5Echo();
    } else if (step === 6) {
      // 刷新选中助手的简介与档案按钮文案
      syncStep6Brief();
    } else if (step === 7) {
      // 首次进入自动签发编号并播放定格动效
      prepareStep7();
    }

    // 每次切步都落一次存档，翻到哪存到哪
    saveProgress();
  }

  /**
   * 步骤五：刷新回显执行员确认的部门与欲望
   */
  function updateStep5Echo() {
    const deptEl = document.getElementById('onboardingStep5DeptVal');
    const desireEl = document.getElementById('onboardingStep5DesireVal');
    const desireInput = document.getElementById('onboardingDesireInput');

    const curDept = (window.PsychStore && PsychStore.getDepartment(selectedDept)) || {
      name: '三千世界',
      sub: '快穿流派 · 节点修正'
    };
    if (deptEl) {
      deptEl.textContent = `${curDept.name} (${curDept.sub})`;
    }

    const desireVal = desireInput ? desireInput.value.trim() : '';
    const finalDesire = desireVal || (window.PsychStore && PsychStore.load()?.coreDesire) || '勘破因果律之终局，于崩塌的世界线中重塑真实锚点。';
    if (desireEl) {
      desireEl.textContent = finalDesire;
    }
  }

  /**
   * 步骤三回填：把已落库的身份档案同步回表单与证件照预览。
   * 与 prefillStep4 同款保守策略：只在输入框为空时回填，绝不覆盖正在编辑的内容。
   */
  function prefillStep3() {
    const identity = (window.Store && Store.envoy && Store.envoy.identity) || null;
    if (!identity) return;

    const setIfEmpty = (id, val) => {
      const el = document.getElementById(id);
      const text = String(val || '').trim();
      if (el && !el.value.trim() && text) el.value = text;
    };

    setIfEmpty('onboardingNameInput', identity.name);
    setIfEmpty('onboardingAppearanceInput', identity.appearance);
    setIfEmpty('onboardingProfileInput', identity.profile);

    // 生日：隐藏域与按钮展示文案要同步，否则会出现「有值但显示未选择」
    const birthday = String(identity.birthday || '').trim();
    const birthdayInput = document.getElementById('onboardingBirthdayInput');
    const birthdayDisplay = document.getElementById('onboardingBirthdayDisplay');
    if (birthdayInput && !birthdayInput.value && birthday) {
      birthdayInput.value = birthday;
      if (birthdayDisplay) birthdayDisplay.textContent = birthday;
    }

    // 性别：胶囊高亮与隐藏域一起复位
    const gender = String(identity.gender || '').trim();
    if (gender) {
      const genderInput = document.getElementById('onboardingGenderInput');
      if (genderInput) genderInput.value = gender;
      document.querySelectorAll('.onboarding-gender-pill').forEach((pill) => {
        pill.classList.toggle('is-active', pill.dataset.gender === gender);
      });
    }

    // 证件照：已存过就把资产读回来铺进预览框
    restoreAvatarPreview();

    // 姓名是必填项，回填后要顺手解锁「保存档案」按钮
    refreshStep3FinishState();
  }

  /** 从 Storage 取回已存的证件照，回填进步骤三预览框 */
  async function restoreAvatarPreview() {
    if (pendingAvatarFile) return; // 本次会话已另选图片，不要覆盖
    if (!window.Storage || !window.DataRegistry) return;

    const previewImg = document.getElementById('onboardingAvatarPreview');
    const placeholder = document.getElementById('onboardingAvatarPlaceholder');
    if (!previewImg || !previewImg.hidden) return;

    try {
      const blob = await Storage.getAsset(DataRegistry.key.personaAvatar());
      if (!blob) return;
      previewImg.src = URL.createObjectURL(blob);
      previewImg.hidden = false;
      if (placeholder) placeholder.hidden = true;
    } catch (_) {
      // 没存过头像属正常情况，静默即可
    }
  }

  /**
   * 步骤四回填：把已落库的部门与核心欲望同步到拨盘与输入框。
   * 用户从步骤四退回步骤三再进来时，不会看到被重置成默认值。
   */
  function prefillStep4() {
    if (!window.PsychStore || typeof PsychStore.load !== 'function') return;

    let profile = null;
    try {
      profile = PsychStore.load();
    } catch (_) {
      return;
    }
    if (!profile) return;

    // 部门：已存过就跟随存档，否则保留当前拨盘选择
    const dept = PsychStore.getDepartment(profile.department);
    if (dept && DEPT_CONFIGS[dept.id]) {
      selectedDept = dept.id;
      const conf = DEPT_CONFIGS[selectedDept];
      const nameEl = document.getElementById('onboardingDeptName');
      const subEl = document.getElementById('onboardingDeptSub');
      const descEl = document.getElementById('onboardingDeptDescText');
      if (nameEl) nameEl.textContent = conf.name;
      if (subEl) subEl.textContent = conf.sub;
      if (descEl) descEl.textContent = conf.desc;
    }

    // 核心欲望：只在用户还没输入时回填，不覆盖正在编辑的内容
    const input = document.getElementById('onboardingDesireInput');
    const saved = String(profile.coreDesire || '').trim();
    if (input && !input.value.trim() && saved) {
      input.value = saved;
    }
  }

  /**
   * 检查并刷新 API 节点配置状态
   */
  function checkAndRefreshApiStatus() {
    let activeNode = null;
    try {
      if (window.RetroflowApiUI && typeof RetroflowApiUI.getActiveNode === 'function') {
        activeNode = RetroflowApiUI.getActiveNode();
      }
    } catch (_) {}

    const card = document.getElementById('onboardingApiCard');
    const title = document.getElementById('onboardingApiModelTitle');
    const sub = document.getElementById('onboardingApiModelSub');
    const nextBtn = document.getElementById('onboardingStep2NextBtn');
    const astrolabe = document.getElementById('onboardingHorizonAstrolabe');

    const isReady = !!(activeNode && (activeNode.baseUrl || activeNode.modelId));

    if (isReady) {
      if (card) card.classList.add('is-ready');
      if (astrolabe) astrolabe.classList.add('is-ready');
      
      const alias = activeNode.alias || '主力节点';
      const model = activeNode.modelId || '默认模型';
      if (title) {
        title.innerHTML = `
          <span class="onboarding-api-alias-pill">${escapeHtml(alias)}</span>
          <span class="onboarding-api-model-name">${escapeHtml(model)}</span>
        `;
      }
      if (sub) sub.textContent = 'ENDPOINT READY // 推理通信端点已配置，链路自洽';
      
      const configBtnTxt = document.getElementById('onboardingApiConfigBtnTxt');
      if (configBtnTxt) configBtnTxt.textContent = '修改配置';

      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.classList.remove('is-locked');
      }
    } else {
      if (card) card.classList.remove('is-ready');
      if (astrolabe) astrolabe.classList.remove('is-ready');
      if (title) title.textContent = 'STANDBY // 待挂载接口';
      if (sub) sub.textContent = '需接入至少一个主模型推理节点以驱动世界推演';
      
      const configBtnTxt = document.getElementById('onboardingApiConfigBtnTxt');
      if (configBtnTxt) configBtnTxt.textContent = '配置节点';

      if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.classList.add('is-locked');
      }
    }
  }

  /**
   * 唤起设置中的 API 面板
   */
  function openApiSettings() {
    if (window.RetroflowSettings && typeof RetroflowSettings.openDetail === 'function') {
      // 设置页层级 (z-index: 900) 低于开场向导 (13000)，唤起前必须让向导临时隐身，
      // 否则设置页虽已推入，仍被向导整层遮挡并吃掉全部点击。
      if (pageEl) pageEl.classList.add('is-suspended');

      RetroflowSettings.openDetail('api', {
        returnLabel: '开场向导 · 步骤二',
        onReturn: () => {
          // 返回向导：撤除让位态并重新探活
          if (pageEl) pageEl.classList.remove('is-suspended');
          checkAndRefreshApiStatus();
        },
        afterEnter: () => {
          // 如果当前没有任何节点，直接拉开新建表单
          try {
            if (window.RetroflowApiUI) {
              const nodes = RetroflowApiUI.getNodes ? RetroflowApiUI.getNodes() : [];
              if (nodes.length === 0 && typeof RetroflowApiUI.openAdd === 'function') {
                RetroflowApiUI.openAdd();
              }
            }
          } catch (_) {}
        }
      });
    }
  }

  /**
   * 打开开场欢迎页。
   * 有存档时恢复现场（停留步骤、协议签署态、天赋候选与助手选择），
   * 让刷新后接着上次继续，而不是从第一步重来。
   */
  function open() {
    initDOM();
    if (!pageEl) return;
    document.body.classList.add('onboarding-active');
    pageEl.classList.add('is-active');
    pageEl.setAttribute('aria-hidden', 'false');
    restoreProgress();
  }

  /** 依据存档恢复向导现场。无存档时保持默认的第一步。 */
  function restoreProgress() {
    const saved = loadProgress();
    if (!saved) return;

    // 1. 协议签署态：状态与视觉一起恢复，避免「已签但看着没签」
    if (saved.agreed) {
      isAgreementAgreed = true;
      const card03 = pageEl ? pageEl.querySelector('.onboarding-hud-card[data-hud-id="03"]') : null;
      if (card03) {
        card03.classList.add('is-agreed');
        const arrowEl = card03.querySelector('.onboarding-hud-card-arrow');
        if (arrowEl) arrowEl.innerHTML = ICONS.check;
      }
    }

    // 2. 助手选择态：同步分镜高亮与底部按钮文案
    if (saved.assistantId) {
      selectedAssistantId = saved.assistantId;
      const panels = document.querySelectorAll('.onboarding-comic-panel');
      panels.forEach((p) => {
        p.classList.toggle('is-selected', p.dataset.assistantId === selectedAssistantId);
      });
      syncStep6NextText();
    }

    // 2.5 待确认编号：刷新后沿用同一枚，不再重摇，否则改好的号会被冲掉
    if (saved.serialNo) {
      pendingSerialNo = normalizeSerialInput(saved.serialNo);
    }

    // 3. 天赋候选：候选池连同编辑框草稿一起复原，重 roll 记忆也接上
    lastDiscardedTalents = Array.isArray(saved.discarded) ? saved.discarded.slice() : [];
    if (Array.isArray(saved.talentCandidates) && saved.talentCandidates.length) {
      talentCandidates = saved.talentCandidates.slice();
      renderTalentCandidates(talentCandidates);

      // 用户手改过的草稿优先于候选默认值
      const draft = saved.talentDraft || {};
      const nameInput = document.getElementById('onboardingTalentCustomName');
      const descInput = document.getElementById('onboardingTalentCustomDesc');
      if (nameInput && draft.name) nameInput.value = draft.name;
      if (descInput && draft.desc) descInput.value = draft.desc;

      // 草稿与哪张卡片一致就高亮那张，对不上则不强行高亮（属于自由手写）
      if (draft.name) {
        const cards = document.querySelectorAll('.onboarding-talent-card-item');
        let matched = false;
        cards.forEach((card, idx) => {
          const hit = talentCandidates[idx] && talentCandidates[idx].name === draft.name;
          card.classList.toggle('is-selected', !!hit);
          if (hit) matched = true;
        });
        if (!matched) cards.forEach((c) => c.classList.remove('is-selected'));
      }
    }

    // 4. 跳回上次停留的步骤
    const step = Number(saved.step) || 1;
    if (step > 1) goToStep(step);
  }

  /** 步骤六底部按钮文案跟随当前选中的助手 (统一保持 4 字战术动作) */
  function syncStep6NextText() {
    const el = document.getElementById('onboardingStep6NextText');
    if (!el) return;
    el.textContent = '接入助手';
  }

  /**
   * 关闭开场页
   */
  function close() {
    if (!pageEl) return;
    document.body.classList.remove('onboarding-active');
    pageEl.classList.remove('is-active');
    pageEl.setAttribute('aria-hidden', 'true');
    closeDrawer();

    // 编号牌滚动动效可能仍在跑，关页时一并掐掉，避免定时器泄漏
    if (serialRollTimer) {
      clearInterval(serialRollTimer);
      serialRollTimer = null;
    }
  }

  // 暴露全局实例
  window.OnboardingUI = {
    open,
    close
  };

  // 页面就绪后创建悬浮入口球
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDOM);
  } else {
    initDOM();
  }
})();
