/**
 * ============================================================================
 * 溯流计划 · 人格心智与在役履历独立全屏应用控制器 (Psych Archive App)
 * 视图控制器：个人档案卡片 03 概览看板 → 全屏深度档案
 * 数据来源：PsychStore（localStorage 持久化）
 * 遵循《工地施工协议》：零 Emoji、纯 SVG、零分割线
 * ============================================================================
 */

(function () {
  'use strict';

  let currentProfile = null;

  /* ---------------- 1. DOM 节点索引 ---------------- */

  const psychPage = document.getElementById('psychArchivePage');
  const psychBackBtn = document.getElementById('psychBackBtn');
  const entryCard = document.getElementById('personaPsychPreviewCard');

  // 概览看板（个人档案卡片 03）
  const previewPolygon = document.getElementById('psychPreviewPolygon');
  const previewDeptCode = document.getElementById('psychPreviewDeptCode');
  const previewDeptName = document.getElementById('psychPreviewDeptName');
  const previewDesire = document.getElementById('psychPreviewDesire');

  // 板块 00：所在部门权威工牌（锁定状态）
  const deptDisplay = document.getElementById('psychDeptDisplay');
  const deptName = document.getElementById('psychDeptName');
  const deptEn = document.getElementById('psychDeptEn');
  const deptCodeText = document.getElementById('psychDeptCodeText');
  const deptBrief = document.getElementById('psychDeptBrief');
  const deptBriefText = document.getElementById('psychDeptBriefText');

  // 板块 01：在职履历与精神值
  const sanityValEl = document.getElementById('psychSanityVal');
  const sanityMaxEl = document.getElementById('psychSanityMax');
  const sanityGaugeFill = document.getElementById('psychSanityGaugeFill');
  const sanityStatusText = document.getElementById('psychSanityStatusText');
  const sanityCodeBadge = document.getElementById('psychSanityCodeBadge');
  const sanityCard = document.getElementById('psychSanityCard');
  const statDays = document.getElementById('psychStatDays');
  const statTotal = document.getElementById('psychStatTotal');
  const statLevel = document.getElementById('psychStatLevel');
  const statRate = document.getElementById('psychStatRate');
  const rankChip = document.getElementById('psychRankChip');

  // 执业经验与权限 HUD 模态窗
  const rankModalOverlay = document.getElementById('psychRankModalOverlay');
  const rankModalCloseBtn = document.getElementById('psychRankModalCloseBtn');
  const rankModalLevel = document.getElementById('psychRankModalLevel');
  const rankModalExpCur = document.getElementById('psychRankModalExpCur');
  const rankModalExpNext = document.getElementById('psychRankModalExpNext');
  const rankModalExpFill = document.getElementById('psychRankModalExpFill');
  const rankCurrentPrivilege = document.getElementById('psychRankCurrentPrivilege');
  const rankNextPrivilege = document.getElementById('psychRankNextPrivilege');

  // 精神状态分级与副本影响说明 HUD 模态窗
  const sanityModalOverlay = document.getElementById('psychSanityModalOverlay');
  const sanityModalCloseBtn = document.getElementById('psychSanityModalCloseBtn');
  const sanityModalCurVal = document.getElementById('psychSanityModalCurVal');
  const sanityModalCurPill = document.getElementById('psychSanityModalCurPill');
  const clearedList = document.getElementById('psychClearedList');
  const clearedCount = document.getElementById('psychClearedCount');

  // 板块 02：六维偏好与核心欲望与说明抽屉
  const fullPolygon = document.getElementById('psychFullPolygon');
  const radarHelpBtn = document.getElementById('psychRadarHelpBtn');
  const radarManualDrawer = document.getElementById('psychRadarManualDrawer');
  const radarLabels = {
    reason: { el: document.getElementById('radarLblReason'), name: '理性' },
    empathy: { el: document.getElementById('radarLblEmpathy'), name: '情感' },
    will: { el: document.getElementById('radarLblWill'), name: '韧性' },
    insight: { el: document.getElementById('radarLblInsight'), name: '洞察' },
    physique: { el: document.getElementById('radarLblPhysique'), name: '体能' },
    creativity: { el: document.getElementById('radarLblCreativity'), name: '创造' }
  };
  const desireText = document.getElementById('psychDesireText');
  const desireBox = document.getElementById('psychDesireBox');

  // 板块 03：专属天赋与技能池（天赋无品阶无等级，故不含 rank 节点）
  const talentName = document.getElementById('psychTalentName');
  const talentDesc = document.getElementById('psychTalentDesc');
  const skillsPool = document.getElementById('psychSkillsPool');
  const addSkillBtn = document.getElementById('psychAddSkillBtn');

  // 板块 04：人格心智与演化侧写
  const matrixZodiac = document.getElementById('matrixZodiac');
  const matrixMbti = document.getElementById('matrixMbti');
  const matrixEnneagram = document.getElementById('matrixEnneagram');
  const matrixAlignment = document.getElementById('matrixAlignment');
  const matrixAttachment = document.getElementById('matrixAttachment');
  const matrixInstinct = document.getElementById('matrixInstinct');
  const matrixTagsWrap = document.querySelector('.psych-matrix-tags');
  const synthStyle = document.getElementById('psychSynthStyle');
  const synthSocial = document.getElementById('psychSynthSocial');
  const synthPersonality = document.getElementById('psychSynthPersonality');
  const synthTimeEl = document.getElementById('psychLastSynthesized');
  const synthBtn = document.getElementById('psychAiSynthesizeBtn');

  /* ---------------- 2. 工具函数 ---------------- */

  /** HTML 转义，避免用户自填内容破坏结构 */
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&#34;')
      .replace(/'/g, '&#39;');
  }

  /** 计算通关率百分比整数。尚无下潜记录时返回 null，由调用方显示占位 */
  function calcRate(career) {
    const total = Number(career.totalRuns) || 0;
    const success = Number(career.successRuns) || 0;
    if (total <= 0) return null;
    return Math.round((success / total) * 100);
  }

  /** 时间戳 → YYYY.MM.DD */
  function fmtDate(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '.' + p(d.getMonth() + 1) + '.' + p(d.getDate());
  }

  /** 时间戳 → YYYY.MM.DD HH:mm */
  function fmtDateTime(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return fmtDate(ts) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /* ---------------- 3. 全屏页开关（对齐图库全屏页标准） ---------------- */

  // 标记「本次 history.back() 是我们主动触发的」，避免 popstate 重复关页
  let pendingProgrammaticBack = false;

  function openArchive() {
    if (!psychPage) return;
    currentProfile = PsychStore.load();
    renderAll(true);

    psychPage.setAttribute('aria-hidden', 'false');
    psychPage.classList.add('active');
    document.body.classList.add('page-active');

    // 压入历史栈，让系统手势返回 / 物理返回键可以退出本页
    try {
      history.pushState({ rfPage: 'psych-archive' }, '', '#psych-archive');
    } catch (e) {
      /* ignore */
    }
  }

  function closeArchive() {
    if (!psychPage || !isArchiveOpen()) return;
    psychPage.setAttribute('aria-hidden', 'true');
    psychPage.classList.remove('active');
    document.body.classList.remove('page-active');
    renderPreviewCard();

    // 主动关闭时消掉自己压入的历史条目，保持栈深度干净
    if ((window.location.hash || '') === '#psych-archive') {
      pendingProgrammaticBack = true;
      try {
        history.back();
      } catch (e) {
        pendingProgrammaticBack = false;
      }
    }
  }

  function isArchiveOpen() {
    return !!(psychPage && psychPage.classList.contains('active'));
  }

  /* ---------------- 4. 渲染与雷达拟合动画 ---------------- */

  let currentRadarAnimId = null;
  let lastAnimatedRadar = null;

  /**
   * 缓动函数：Cubic Ease-Out (干脆、自然减速)
   */
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * 平滑插值动画驱动六维雷达多边形
   * @param {Object} fromRadar 起始形态 { reason, empathy, will, insight, physique, creativity }
   * @param {Object} toRadar 目标形态
   * @param {number} durationMs 动画持续时长（毫秒）
   */
  function animateRadarPolygon(fromRadar, toRadar, durationMs) {
    if (!fullPolygon) return;
    if (currentRadarAnimId) {
      cancelAnimationFrame(currentRadarAnimId);
      currentRadarAnimId = null;
    }

    const keys = ['reason', 'empathy', 'will', 'insight', 'physique', 'creativity'];
    const startTime = performance.now();
    const duration = durationMs || 420;

    function frame(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = easeOutCubic(progress);

      const intermediate = {};
      keys.forEach(function (k) {
        const startVal = Number(fromRadar[k]) || 0;
        const endVal = Number(toRadar[k]) || 0;
        intermediate[k] = startVal + (endVal - startVal) * ease;
      });

      const pointsStr = PsychStore.calculateRadarPoints(intermediate, 100, 100, 80);
      fullPolygon.setAttribute('points', pointsStr);

      if (progress < 1) {
        currentRadarAnimId = requestAnimationFrame(frame);
      } else {
        currentRadarAnimId = null;
        lastAnimatedRadar = Object.assign({}, toRadar);
      }
    }

    currentRadarAnimId = requestAnimationFrame(frame);
  }

  function renderAll(animateDeploy) {
    // 每轮渲染都重新取一次。Store 写入时会重建 envoy.psych 对象，
    // 缓存旧引用会导致向导落库后本页仍显示旧值。
    currentProfile = PsychStore.load();
    renderDepartment();
    renderCareer();
    renderRadar(animateDeploy);
    renderTalent();
    renderSkills();
    renderMatrix();
    renderSynthesis();
    renderPreviewCard();
  }

  /**
   * 板块 00：所在部门权威在职工牌（锁定展示态）
   */
  function renderDepartment() {
    const dept = PsychStore.getDepartment(currentProfile.department);
    if (deptName) deptName.textContent = dept.name;
    if (deptEn) deptEn.textContent = `${dept.en} · ${dept.sub}`;
    if (deptCodeText) deptCodeText.textContent = dept.code;
    if (deptBriefText) deptBriefText.textContent = dept.desc;
  }

  /** 板块 01：在职履历与已通关副本速览与精神值 */
  function renderCareer() {
    // 1. 精神值与生命状态计算
    const curSanity = currentProfile.sanity != null ? Number(currentProfile.sanity) : 100;
    const maxSanity = currentProfile.maxSanity != null ? Number(currentProfile.maxSanity) : 100;
    const sanityStatus = PsychStore.getSanityStatus(curSanity);

    if (sanityValEl) sanityValEl.textContent = curSanity;
    if (sanityMaxEl) sanityMaxEl.textContent = maxSanity;
    if (sanityStatusText) sanityStatusText.textContent = sanityStatus.text;
    if (sanityCodeBadge) {
      sanityCodeBadge.textContent = sanityStatus.code;
      sanityCodeBadge.setAttribute('data-sanity-level', sanityStatus.level);
    }
    if (sanityGaugeFill) {
      const pct = Math.max(0, Math.min(100, Math.round((curSanity / maxSanity) * 100)));
      sanityGaugeFill.style.width = pct + '%';
      sanityGaugeFill.setAttribute('data-sanity-level', sanityStatus.level);
    }
    if (sanityCard) {
      sanityCard.setAttribute('data-sanity-level', sanityStatus.level);
    }

    const career = currentProfile.career || {};
    const days = PsychStore.calculateServiceDays(career.joinedAt);

    if (statDays) statDays.textContent = days;
    if (statTotal) statTotal.textContent = Number(career.totalRuns) || 0;
    if (statLevel) statLevel.textContent = esc(career.level || 'LV.1');
    if (statRate) {
      const rate = calcRate(career);
      statRate.textContent = rate === null ? '--' : rate + '%';
    }

    const list = Array.isArray(career.clearedList) ? career.clearedList : [];
    if (clearedCount) clearedCount.textContent = list.length + ' 卷';

    if (clearedList) {
      if (list.length === 0) {
        clearedList.innerHTML = '<div class="psych-cleared-empty">// 暂无近期通关记录</div>';
      } else {
        // 仅截取展示最新的 3 条近期通关记录
        const recentList = list.slice(0, 3);
        clearedList.innerHTML = recentList.map(function (item) {
          const turns = item.turns ? esc(item.turns) + ' 回合' : '达成同调';
          const lvl = esc(item.level || item.rank || 'LV.1');
          return '<div class="psych-cleared-item">' +
            '<div class="psych-cleared-item-left">' +
              '<span class="psych-cleared-name">' + esc(item.name) + '</span>' +
              '<span class="psych-cleared-time">' + fmtDate(item.clearedAt) + ' // ' + turns + '</span>' +
            '</div>' +
            '<span class="psych-cleared-level">' + lvl + '</span>' +
          '</div>';
        }).join('');
      }
    }
  }

  /** 板块 02：六维雷达与核心欲望 */
  function renderRadar(animateDeploy) {
    const radar = currentProfile.radar || {};

    // 纯维度名称标签（隐藏具体数字，仅保留图文）
    Object.keys(radarLabels).forEach(function (key) {
      const item = radarLabels[key];
      if (!item.el) return;
      item.el.textContent = item.name;
    });

    if (animateDeploy) {
      // 从原点 (0,0,0,0,0,0) 向目标状态动态舒展
      const zeroRadar = { reason: 0, empathy: 0, will: 0, insight: 0, physique: 0, creativity: 0 };
      animateRadarPolygon(zeroRadar, radar, 450);
    } else if (lastAnimatedRadar) {
      // 从上一形态平滑形变
      animateRadarPolygon(lastAnimatedRadar, radar, 350);
    } else {
      // 静态归位
      const pointsStr = PsychStore.calculateRadarPoints(radar, 100, 100, 80);
      if (fullPolygon) fullPolygon.setAttribute('points', pointsStr);
      lastAnimatedRadar = Object.assign({}, radar);
    }

    if (desireText) {
      desireText.textContent = currentProfile.coreDesire || '// 尚未定义核心欲望与时空执念。';
    }
  }

  /** 板块 03：专属天赋技能 */
  function renderTalent() {
    const talent = currentProfile.talent || {};
    if (talentName) talentName.textContent = esc(talent.name || '待解析');
    if (talentDesc) talentDesc.textContent = esc(talent.desc || '// 灵魂特质解析中，专属天赋将于入役仪式完成时正式赋予。');
  }

  /** 板块 03：自生技能池（卡片流排版，支持点击编辑与删除） */
  function renderSkills() {
    if (!skillsPool) return;
    const skills = Array.isArray(currentProfile.skills) ? currentProfile.skills : [];
    if (skills.length === 0) {
      skillsPool.innerHTML = '<div class="psych-cleared-empty">// 暂无登记的生活技能</div>';
    } else {
      skillsPool.innerHTML = skills.map(function (s, idx) {
        const sName = typeof s === 'string' ? s : (s.name || '');
        const sDesc = typeof s === 'object' && s.desc ? s.desc : '';
        const descHtml = sDesc ? '<p class="psych-skill-desc">' + esc(sDesc) + '</p>' : '';
        return '<div class="psych-skill-card" data-idx="' + idx + '" role="button" tabindex="0" title="点击编辑此项技能">' +
          '<div class="psych-skill-card-top">' +
            '<span class="psych-skill-name">' + esc(sName) + '</span>' +
            '<button type="button" class="psych-skill-del-btn" data-del-idx="' + idx + '" aria-label="移除技能 ' + esc(sName) + '" title="移除此技能">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>' +
            '</button>' +
          '</div>' +
          descHtml +
        '</div>';
      }).join('');
    }
  }

  /** 板块 04：心智模型标签 */
  function renderMatrix() {
    const matrix = currentProfile.matrix || {};

    // 星座：用户未手填时，读个人档案生日实时推算
    let zodiac = matrix.zodiac;
    if (!zodiac) {
      const bdayEl = document.getElementById('personaBirthdayInput');
      zodiac = PsychStore.calculateZodiac(bdayEl ? bdayEl.value : '');
    }
    if (matrixZodiac) matrixZodiac.textContent = zodiac;
    if (matrixMbti) matrixMbti.textContent = matrix.mbti || '待测评';
    if (matrixEnneagram) matrixEnneagram.textContent = matrix.enneagram || '待测评';
    if (matrixAlignment) matrixAlignment.textContent = matrix.alignment || '待测评';
    if (matrixAttachment) matrixAttachment.textContent = matrix.attachment || '待测评';
    if (matrixInstinct) matrixInstinct.textContent = matrix.instinct || '待测评';
  }

  /** 板块 04：AI 深度演化侧写 */
  function renderSynthesis() {
    const synth = currentProfile.synthesis || {};
    if (synthStyle) synthStyle.textContent = synth.style || '// 待演化解析';
    if (synthSocial) synthSocial.textContent = synth.social || '// 待演化解析';
    if (synthPersonality) synthPersonality.textContent = synth.personality || '// 待演化解析';
    if (synthTimeEl) synthTimeEl.textContent = fmtDateTime(synth.lastSynthesizedAt);
  }

  /** 概览看板（个人档案卡片 03） */
  function renderPreviewCard() {
    currentProfile = PsychStore.load();
    const radar = currentProfile.radar || {};

    if (previewPolygon) {
      previewPolygon.setAttribute('points', PsychStore.calculateRadarPoints(radar, 100, 100, 80));
    }

    // 部门徽标：编制代号 + 部门名，让用户在个人档案就能看到自己的编制
    const dept = PsychStore.getDepartment(currentProfile.department);
    if (previewDeptCode) previewDeptCode.textContent = dept.code;
    if (previewDeptName) previewDeptName.textContent = dept.name;

    // 核心欲望摘录：未填写时给出待录入占位，不留空白
    if (previewDesire) {
      const desire = String(currentProfile.coreDesire || '').trim();
      previewDesire.textContent = desire || '// 尚未录入核心欲望，等待执行员自陈。';
    }
  }

  /** 执业经验值与副本等级权限说明映射 */
  const LEVEL_PRIVILEGES = {
    'LV.1': { current: '仅可进入 E 级副本', next: '升至 LV.2 解锁 E、D、C 级副本' },
    'LV.2': { current: '可选择 E、D、C 级副本', next: '升至 LV.3 专注 D、C 级进阶副本' },
    'LV.3': { current: '可选择 D、C 级副本', next: '升至 LV.4 解锁 C、B 级危险副本' },
    'LV.4': { current: '可选择 C、B 级副本', next: '升至 LV.5 解锁 B、A、S 级高危副本' },
    'LV.5': { current: '可选择 B、A、S 级副本', next: '升至 LV.6 解锁完全权限与 S+ 极端禁区' },
    'LV.6': { current: '全权限完全解锁，自由进入 E 至 A 级副本，接触 S/S+ 禁区', next: '已达特勤执行员权限顶峰' }
  };

  /** 打开精神状态分级与副本影响说明 HUD 浮层
   *  @param {number} [overrideSanity] 可选覆盖 SAN 值（副本内实时精神值）；不传则读档案当前值
   */
  function openSanityModal(overrideSanity) {
    if (!sanityModalOverlay) return;
    let curSanity;
    if (typeof overrideSanity === 'number' && !Number.isNaN(overrideSanity)) {
      curSanity = overrideSanity;
    } else {
      currentProfile = PsychStore.load();
      curSanity = currentProfile.sanity != null ? Number(currentProfile.sanity) : 100;
    }
    const status = PsychStore.getSanityStatus(curSanity);

    if (sanityModalCurVal) sanityModalCurVal.textContent = curSanity;
    if (sanityModalCurPill) {
      sanityModalCurPill.textContent = `${status.text} · ${status.code}`;
      sanityModalCurPill.style.color = `var(${status.colorVar})`;
      sanityModalCurPill.style.backgroundColor = `rgba(var(${status.colorVar}-rgb, 200, 100, 100), 0.12)`;
    }

    // 高亮当前所在等级卡片
    const cards = sanityModalOverlay.querySelectorAll('.psych-sanity-tier-card');
    cards.forEach((card) => {
      const tier = card.dataset.tier;
      card.classList.toggle('is-current', tier === status.level);
    });

    sanityModalOverlay.hidden = false;
    sanityModalOverlay.setAttribute('aria-hidden', 'false');
  }

  /** 关闭精神状态分级与副本影响说明 HUD 浮层 */
  function closeSanityModal() {
    if (!sanityModalOverlay) return;
    sanityModalOverlay.hidden = true;
    sanityModalOverlay.setAttribute('aria-hidden', 'true');
  }

  /** 打开执业经验值与权限 HUD 浮层 */
  function openRankModal() {
    if (!rankModalOverlay) return;
    currentProfile = PsychStore.load();
    const career = currentProfile.career || {};
    const lvl = String(career.level || 'LV.1').trim().toUpperCase();
    const curExp = Math.max(0, Number(career.currentExp) || 0);
    const nextExp = Math.max(1, Number(career.nextExp) || 100);
    const pct = Math.min(100, Math.round((curExp / nextExp) * 100));

    if (rankModalLevel) rankModalLevel.textContent = lvl;
    if (rankModalExpCur) rankModalExpCur.textContent = curExp;
    if (rankModalExpNext) rankModalExpNext.textContent = nextExp;
    if (rankModalExpFill) rankModalExpFill.style.width = pct + '%';

    const priv = LEVEL_PRIVILEGES[lvl] || LEVEL_PRIVILEGES['LV.1'];
    if (rankCurrentPrivilege) rankCurrentPrivilege.textContent = priv.current;
    if (rankNextPrivilege) rankNextPrivilege.textContent = priv.next;

    rankModalOverlay.hidden = false;
    rankModalOverlay.setAttribute('aria-hidden', 'false');
  }

  /** 关闭执业经验值与权限 HUD 浮层 */
  function closeRankModal() {
    if (!rankModalOverlay) return;
    rankModalOverlay.hidden = true;
    rankModalOverlay.setAttribute('aria-hidden', 'true');
  }

  /* ---------------- 5. 交互编辑 ---------------- */

  /** 编辑核心欲望 */
  async function handleEditDesire() {
    if (!window.TextEditorModal || typeof TextEditorModal.edit !== 'function') return;
    const updated = await TextEditorModal.edit({
      title: '核心欲望',
      tag: 'PSYCH // 核心欲望',
      value: currentProfile.coreDesire || '',
      placeholder: '写下在无尽副本轮回中不可动摇的核心欲望与终极追寻...',
      maxLength: 300
    });
    if (updated === null || updated === undefined) return;

    currentProfile.coreDesire = updated.trim();
    PsychStore.save(currentProfile);
    renderRadar();
    renderPreviewCard();
  }

  /** 
   * 配置心智标签标准化选项库与两步连携选择
   */
  const MBTI_OPTIONS = [
    { value: 'INTJ 战略家', label: 'INTJ 战略家', hint: '洞察全局 / 缜密理性' },
    { value: 'INTP 逻辑学家', label: 'INTP 逻辑学家', hint: '因果解构 / 抽象思辨' },
    { value: 'ENTJ 指挥官', label: 'ENTJ 指挥官', hint: '战略决断 / 统御控场' },
    { value: 'ENTP 辩论家', label: 'ENTP 辩论家', hint: '敏锐革新 / 破局博弈' },
    { value: 'INFJ 提倡者', label: 'INFJ 提倡者', hint: '原初理想 / 精神共鸣' },
    { value: 'INFP 调停者', label: 'INFP 调停者', hint: '纯粹执念 / 灵魂共情' },
    { value: 'ENFJ 主人公', label: 'ENFJ 主人公', hint: '信赖凝聚 / 精神领袖' },
    { value: 'ENFP 竞选者', label: 'ENFP 竞选者', hint: '无限可能 / 热忱感染' },
    { value: 'ISTJ 物流师', label: 'ISTJ 物流师', hint: '严谨纪律 / 秩序基石' },
    { value: 'ISFJ 守卫者', label: 'ISFJ 守卫者', hint: '守护锚点 / 奉献沉静' },
    { value: 'ESTJ 总经理', label: 'ESTJ 总经理', hint: '高效执行 / 规则掌控' },
    { value: 'ESFJ 执政官', label: 'ESFJ 执政官', hint: '人际同调 / 细致周全' },
    { value: 'ISTP 鉴赏家', label: 'ISTP 鉴赏家', hint: '实战机变 / 战术精通' },
    { value: 'ISFP 探险家', label: 'ISFP 探险家', hint: '敏锐感知 / 自由随性' },
    { value: 'ESTP 企业家', label: 'ESTP 企业家', hint: '破势进取 / 风险掌控' },
    { value: 'ESFP 表演家', label: 'ESFP 表演家', hint: '临场感染 / 焦点共振' }
  ];

  const ENNEAGRAM_CORE_TYPES = [
    { type: 1, name: '完美型', role: '改革者 / 秩序维护', wings: [{ w: 9, title: '1w9 理想主义者' }, { w: 2, title: '1w2 倡导者' }] },
    { type: 2, name: '助人型', role: '爱心者 / 关系连接', wings: [{ w: 1, title: '2w1 仆人' }, { w: 3, title: '2w3 主人' }] },
    { type: 3, name: '成就型', role: '实干者 / 目标导向', wings: [{ w: 2, title: '3w2 魅力者' }, { w: 4, title: '3w4 专业者' }] },
    { type: 4, name: '个体型', role: '艺术者 / 独特执念', wings: [{ w: 3, title: '4w3 贵族' }, { w: 5, title: '4w5 波希米亚人' }] },
    { type: 5, name: '理智型', role: '观察者 / 思想先驱', wings: [{ w: 4, title: '5w4 偶像破坏者' }, { w: 6, title: '5w6 问题解决者' }] },
    { type: 6, name: '忠诚型', role: '怀疑者 / 警觉防御', wings: [{ w: 5, title: '6w5 捍卫者' }, { w: 7, title: '6w7 伙伴' }] },
    { type: 7, name: '活跃型', role: '享乐者 / 可能性探索', wings: [{ w: 6, title: '7w6 娱乐家' }, { w: 8, title: '7w8 现实主义者' }] },
    { type: 8, name: '领袖型', role: '挑战者 / 绝对掌控', wings: [{ w: 7, title: '8w7 不妥协者' }, { w: 9, title: '8w9 熊' }] },
    { type: 9, name: '和平型', role: '调停者 / 同调共生', wings: [{ w: 8, title: '9w8 舒适者' }, { w: 1, title: '9w1 梦想家' }] }
  ];

  const ALIGNMENT_OPTIONS = [
    { value: '守序善良', label: '守序善良', hint: '信条如铁 / 仁慈公义' },
    { value: '中立善良', label: '中立善良', hint: '纯善之心 / 超越成规' },
    { value: '混乱善良', label: '混乱善良', hint: '遵从良知 / 叛逆不羁' },
    { value: '守序中立', label: '守序中立', hint: '秩序至上 / 不偏不倚' },
    { value: '绝对中立', label: '绝对中立', hint: '因果均衡 / 冷眼旁观' },
    { value: '混乱中立', label: '混乱中立', hint: '绝对自由 / 随心所向' },
    { value: '守序邪恶', label: '守序邪恶', hint: '冷酷严密 / 规则暴君' },
    { value: '中立邪恶', label: '中立邪恶', hint: '纯粹利己 / 不择手段' },
    { value: '混乱邪恶', label: '混乱邪恶', hint: '毁灭狂潮 / 吞噬一切' }
  ];

  const ATTACHMENT_OPTIONS = [
    { value: '安全型', label: '安全型', hint: '自洽稳定 / 信任连接' },
    { value: '焦虑型', label: '焦虑型', hint: '过度敏感 / 渴求回应' },
    { value: '回避型', label: '回避型', hint: '情感克制 / 独立壁垒' },
    { value: '恐惧型', label: '恐惧型', hint: '拉扯纠缠 / 创伤防御' }
  ];

  /** 点击单个心智标签胶囊调起对应选择弹窗 */
  async function handleEditMatrixField(key) {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    if (!currentProfile.matrix) currentProfile.matrix = {};

    let selectedValue = null;

    if (key === 'mbti') {
      selectedValue = await SelectModal.pick({
        title: '选择 MBTI 心理类型',
        tag: 'MATRIX // MBTI',
        options: MBTI_OPTIONS,
        value: currentProfile.matrix.mbti || 'INTJ 战略家'
      });
    } else if (key === 'enneagram') {
      // 第一步：选核心主型
      const coreOpts = ENNEAGRAM_CORE_TYPES.map((c) => ({
        value: String(c.type),
        label: `${c.type}型 · ${c.name}`,
        hint: c.role
      }));

      const pickedCore = await SelectModal.pick({
        title: '第一步：选择核心主型 (1~9)',
        tag: 'MATRIX // ENNEAGRAM CORE',
        options: coreOpts,
        value: (currentProfile.matrix.enneagram || '').charAt(0) || '5'
      });

      if (!pickedCore) return;

      const typeObj = ENNEAGRAM_CORE_TYPES.find((c) => String(c.type) === String(pickedCore));
      if (!typeObj) return;

      // 第二步：选侧翼（根据主型动态生成）
      const wingOpts = [
        { value: `${typeObj.type}w${typeObj.wings[0].w}`, label: `${typeObj.wings[0].title}`, hint: `主型 ${typeObj.type} 带 ${typeObj.wings[0].w} 翼` },
        { value: `${typeObj.type}w${typeObj.wings[1].w}`, label: `${typeObj.wings[1].title}`, hint: `主型 ${typeObj.type} 带 ${typeObj.wings[1].w} 翼` },
        { value: `纯 ${typeObj.type}型`, label: `纯 ${typeObj.type}型 (${typeObj.name})`, hint: '无明显侧翼偏向' }
      ];

      const pickedWing = await SelectModal.pick({
        title: `第二步：选择 ${typeObj.type}型 侧翼 (Wing)`,
        tag: 'MATRIX // ENNEAGRAM WING',
        options: wingOpts,
        value: currentProfile.matrix.enneagram || wingOpts[0].value
      });

      if (!pickedWing) return;
      selectedValue = pickedWing;
    } else if (key === 'alignment') {
      selectedValue = await SelectModal.pick({
        title: '选择阵营倾向',
        tag: 'MATRIX // ALIGNMENT',
        options: ALIGNMENT_OPTIONS,
        value: currentProfile.matrix.alignment || '混乱中立'
      });
    } else if (key === 'attachment') {
      selectedValue = await SelectModal.pick({
        title: '选择依恋类型',
        tag: 'MATRIX // ATTACHMENT',
        options: ATTACHMENT_OPTIONS,
        value: currentProfile.matrix.attachment || '安全型'
      });
    } else if (key === 'instinct') {
      toast('INSTINCT // 分院协议', '下潜本能情境测评模块接入中...', 'info');
      return;
    }

    if (!selectedValue) return;

    currentProfile.matrix[key] = selectedValue;
    PsychStore.save(currentProfile);
    renderMatrix();
  }

  /** 心智标签点击（事件委托，星座标签给予归档锁定提示） */
  function handleMatrixTagsClick(e) {
    const pill = e.target.closest('.psych-matrix-pill');
    if (!pill) return;
    if (pill.dataset.matrixKey) {
      handleEditMatrixField(pill.dataset.matrixKey);
    } else if (pill.classList.contains('is-auto')) {
      toast('ZODIAC // 固化锚点', '星座由执行员初始生日时空坐标自动推算', 'info');
    }
  }

  /** 添加生活技能（多字段通用表单弹窗） */
  async function handleAddSkill() {
    if (!window.FormEditorModal || typeof FormEditorModal.open !== 'function') return;

    const res = await FormEditorModal.open({
      tag: 'SKILL // 技能登记',
      title: '添加生活技能',
      fields: [
        {
          key: 'name',
          label: 'NAME // 技能名称',
          type: 'input',
          placeholder: '例如：野外急救 / 神经接驳黑客',
          maxLength: 24,
          required: true
        },
        {
          key: 'desc',
          label: 'EFFECT // 技能效果',
          type: 'textarea',
          placeholder: '详细描述该技能在因果剧本与时空观测中的具体运用与效果...',
          rows: 3,
          maxLength: 300,
          required: false
        }
      ],
      confirmText: '登记技能',
      cancelText: '取消'
    });

    if (!res || !res.name) return;

    if (!Array.isArray(currentProfile.skills)) currentProfile.skills = [];
    currentProfile.skills.push({
      name: res.name.trim(),
      desc: (res.desc || '').trim()
    });

    PsychStore.save(currentProfile);
    renderSkills();
  }

  /** 编辑已有生活技能 */
  async function handleEditSkillItem(idx) {
    if (!window.FormEditorModal || typeof FormEditorModal.open !== 'function') return;
    const skills = Array.isArray(currentProfile.skills) ? currentProfile.skills : [];
    const item = skills[idx];
    if (!item) return;

    const sName = typeof item === 'string' ? item : (item.name || '');
    const sDesc = typeof item === 'object' && item.desc ? item.desc : '';

    const res = await FormEditorModal.open({
      tag: 'SKILL // 技能档案',
      title: '编辑生活技能',
      fields: [
        {
          key: 'name',
          label: 'NAME // 技能名称',
          type: 'input',
          value: sName,
          placeholder: '例如：野外急救 / 神经接驳黑客',
          maxLength: 24,
          required: true
        },
        {
          key: 'desc',
          label: 'EFFECT // 技能效果',
          type: 'textarea',
          value: sDesc,
          placeholder: '详细描述该技能在因果剧本与时空观测中的具体运用与效果...',
          rows: 3,
          maxLength: 300,
          required: false
        }
      ],
      confirmText: '保存修改',
      cancelText: '取消'
    });

    if (!res || !res.name) return;

    currentProfile.skills[idx] = {
      name: res.name.trim(),
      desc: (res.desc || '').trim()
    };

    PsychStore.save(currentProfile);
    renderSkills();
  }

  /** 技能池点击（事件委托：点删除按钮移除，点卡片其他区域编辑） */
  function handleSkillPoolClick(e) {
    const delBtn = e.target.closest('.psych-skill-del-btn');
    if (delBtn) {
      e.stopPropagation();
      const idx = parseInt(delBtn.dataset.delIdx, 10);
      if (Number.isNaN(idx)) return;
      if (!Array.isArray(currentProfile.skills)) return;

      currentProfile.skills.splice(idx, 1);
      PsychStore.save(currentProfile);
      renderSkills();
      return;
    }

    const card = e.target.closest('.psych-skill-card');
    if (card) {
      const idx = parseInt(card.dataset.idx, 10);
      if (!Number.isNaN(idx)) {
        handleEditSkillItem(idx);
      }
    }
  }

  /** AI 演化重构（当前为占位流程，接入模型后替换内部实现） */
  function handleSynthesize() {
    if (!synthBtn) return;
    synthBtn.disabled = true;
    toast('SYNTHESIS // 演化中', '正在提取副本抉择与交互记录...', 'info');

    setTimeout(function () {
      synthBtn.disabled = false;
      if (!currentProfile.synthesis) currentProfile.synthesis = {};
      currentProfile.synthesis.lastSynthesizedAt = Date.now();
      PsychStore.save(currentProfile);
      renderSynthesis();
      toast('SYNTHESIS // 演算完成', '心智侧写已同步更新', 'success');
    }, 800);
  }

  /** 统一 Toast 出口 */
  function toast(tag, message, type) {
    if (!window.RetroToast || typeof RetroToast.show !== 'function') return;
    RetroToast.show({ tag: tag, message: message, type: type || 'info' });
  }

  /* ---------------- 6. 事件绑定与初始化 ---------------- */

  function bindEvents() {
    if (entryCard) {
      entryCard.addEventListener('click', openArchive);
      entryCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openArchive();
        }
      });
    }

    if (psychBackBtn) psychBackBtn.addEventListener('click', closeArchive);

    // 系统手势返回 / 物理返回键
    window.addEventListener('popstate', function () {
      if (pendingProgrammaticBack) {
        // UI 已在点击返回时同步关闭，这里只消化事件
        pendingProgrammaticBack = false;
        return;
      }
      // 经验弹窗开启时，优先关闭弹窗
      if (rankModalOverlay && !rankModalOverlay.hidden) {
        closeRankModal();
        return;
      }
      // 精神状态弹窗开启时，优先关闭弹窗
      if (sanityModalOverlay && !sanityModalOverlay.hidden) {
        closeSanityModal();
        return;
      }
      // 文本编辑器叠在本页之上时，这次返回归它处理，本页不响应
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;

      if (isArchiveOpen() && (window.location.hash || '') !== '#psych-archive') {
        // 手势返回：只收起 UI，不再二次操作 history
        psychPage.setAttribute('aria-hidden', 'true');
        psychPage.classList.remove('active');
        document.body.classList.remove('page-active');
        renderPreviewCard();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (rankModalOverlay && !rankModalOverlay.hidden) {
          closeRankModal();
          return;
        }
        if (sanityModalOverlay && !sanityModalOverlay.hidden) {
          closeSanityModal();
          return;
        }
        if (isArchiveOpen()) closeArchive();
      }
    });

    // 板块 00：所在部门为正式在职工牌（权威锁定态，部门不可随意变更）

    // 核心欲望框与心智标签：整框点击直接编辑
    if (desireBox) {
      desireBox.addEventListener('click', handleEditDesire);
      desireBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleEditDesire();
        }
      });
    }
    if (matrixTagsWrap) {
      matrixTagsWrap.addEventListener('click', handleMatrixTagsClick);
      matrixTagsWrap.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const pill = e.target.closest('.psych-matrix-pill[data-matrix-key]');
        if (!pill) return;
        e.preventDefault();
        handleEditMatrixField(pill.dataset.matrixKey);
      });
    }
    if (addSkillBtn) addSkillBtn.addEventListener('click', handleAddSkill);
    if (skillsPool) skillsPool.addEventListener('click', handleSkillPoolClick);
    if (synthBtn) synthBtn.addEventListener('click', handleSynthesize);

    // 六维偏好问号说明抽屉展开/收起
    if (radarHelpBtn && radarManualDrawer) {
      radarHelpBtn.addEventListener('click', function () {
        const isHidden = radarManualDrawer.hidden;
        radarManualDrawer.hidden = !isHidden;
        radarHelpBtn.classList.toggle('active', isHidden);
      });
    }

    // 执业经验与副本权限 HUD 模态窗开关
    if (rankChip) {
      rankChip.addEventListener('click', openRankModal);
      rankChip.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openRankModal();
        }
      });
    }
    if (rankModalCloseBtn) rankModalCloseBtn.addEventListener('click', closeRankModal);
    if (rankModalOverlay) {
      rankModalOverlay.addEventListener('click', function (e) {
        if (e.target === rankModalOverlay) closeRankModal();
      });
    }

    // 精神状态判定与副本影响说明 HUD 模态窗开关
    if (sanityCard) {
      sanityCard.addEventListener('click', openSanityModal);
      sanityCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openSanityModal();
        }
      });
    }
    if (sanityModalCloseBtn) sanityModalCloseBtn.addEventListener('click', closeSanityModal);
    if (sanityModalOverlay) {
      sanityModalOverlay.addEventListener('click', function (e) {
        if (e.target === sanityModalOverlay) closeSanityModal();
      });
    }
  }

  function init() {
    currentProfile = PsychStore.load();
    bindEvents();
    renderPreviewCard();
  }

  if (window.Boot && typeof Boot.onReady === 'function') {
    Boot.onReady('psychArchive', init);
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  /* ---------------- 7. 全局挂载 ---------------- */

  window.PsychArchiveApp = {
    open: openArchive,
    close: closeArchive,
    renderAll: renderAll,
    renderPreview: renderPreviewCard,
    getProfile: function () { return currentProfile || PsychStore.load(); },
    openSanityModal: openSanityModal,
    closeSanityModal: closeSanityModal
  };
})();