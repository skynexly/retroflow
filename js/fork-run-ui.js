/**
 * ============================================================================
 * 溯流计划 · 副本推演终端 (Fork Run UI)
 *
 * 下潜界面。它同时是「玩」和「回看」两件事的载体 —— 已结算/已放弃的线点进来
 * 就是原模原样的推演界面，只是输入台收起、换成封存提示条。不另做历史页，
 * 否则渲染逻辑要抄两遍、还得同步维护。
 *
 * 排版模型（与私聊页刻意不同，别照着 chat- 那套改）：
 *   AI 侧    通栏小说正文。无头像、无气泡、无底色，每段首行缩进两字。
 *            角色行动融在正文里 —— 把 NPC 对话切成小气泡可读性会崩。
 *   状态栏    每轮叙事顶部一条。AI 按约定格式输出，前端渲染成刻度读数槽。
 *   执行员    唯一有气泡的一方，且头像置于气泡上方（署名行），不在右侧。
 *   时间      不显示。副本内的时间是叙事时间，归状态栏管。
 *
 * 本轮范围：页面骨架、状态机（可写/只读）、渲染器、输入台交互、存档接线。
 * 未接入：真实 AI 请求链路、状态栏协议解析（先留 parseStatusBlock 的位置）、
 * 抽屉四格的实际功能、长按 HUD、结算与正史指针写入。
 * ============================================================================
 */
window.ForkRunUI = (() => {
  'use strict';

  /* ================= DOM 引用 ================= */

  let pageEl = null;
  let bodyEl = null;
  let streamEl = null;
  let backBtn = null;
  let menuBtn = null;
  let headerTitle = null;
  let headerMeta = null;
  let footerEl = null;
  let readonlyBar = null;
  let readonlyText = null;
  let textarea = null;
  let sendBtn = null;
  let inferBtn = null;
  let expandBtn = null;
  let plusBtn = null;
  let dockPanel = null;
  let turnCodeEl = null;
  let jumpDeck = null;
  let jumpTopBtn = null;
  let jumpBottomBtn = null;
  let inited = false;
  // 页面是否处于打开态：供 isOpen() 查询与 popstate 判定
  let isOpened = false;

  /* ================= 会话态 ================= */

  let currentForkId = '';
  let currentRunId = '';
  let currentRun = null;
  let currentFork = null;
  // 请求前触发判定的「本轮命中」暂存：请求前置状态时打标，回复落定后挂卡片 + 补记 recordId 后清空。
  //   pendingClueNoticeNames  本轮请求前刚触发/解锁、待在回复块上提示的线索名（线索走 pending，卡片仍由回复后统一挂）
  //   truthNoticePending      本轮请求前刚解明核心真相，回复落定要挂真相卡 + 记 recordId
  //   endingNoticePending     本轮请求前刚定下结局，回复落定要挂结局卡 + 记 recordId
  //   endingNoticeName        待挂结局卡的结局名
  let pendingTriggerNotice = { clueNames: [], truthNoticePending: false, endingNoticePending: false, endingNoticeName: '' };
  let pendingImages = []; // 元素为 { blob, objectUrl }
  let imagePreviewBar = null;
  let pendingFiles = []; // 元素为 { id, name, sizeText, charCount }
  let filePreviewBar = null;

  /**
   * 本轮「识图阻塞」的在途句柄：{ aborted, controller, recordId, row, text, blobs, galleryIds }。
   *
   * 为什么与 currentInference 分开：识图和推演是两段不同的在途任务，取消语义也不同 ——
   * 取消推演保留已流出的正文，取消识图则要把整条行动卡连根拔掉、文字与图片退回输入台。
   * 两者共用一个发送按钮的终止态，但真相源必须各自独立，否则收尾逻辑会互相踩。
   */
  let currentVision = null;
  /** 只读态：已结算或已放弃的线不能再推进 */
  let isReadonly = false;
  /** 本人在本次下潜里显示的头像 objectURL，退出时释放 */
  let envoyAvatarUrl = '';
  /**
   * 本副本作者设定的数值指标（只读快照，进本时从卷宗读一次）。
   * 元素形如 { name, init, min, max }，全为已清洗的字符串/数字。
   * 副本没设数值时保持空数组，状态卡底栏会自适应整块隐藏。
   */
  let currentForkStats = [];

  /**
   * 本轮推演的在途请求句柄：{ controller, aborted }。
   * 空表示当前没有在跑的推演 —— 它同时是「发送按钮处于终止态」的真相源，
   * 不靠 DOM class 判断状态（class 是表现，这里才是事实）。
   */
  let currentInference = null;

  /**
   * 本副本作者预设的 NPC 与角色数值模板（只读快照，进本时从卷宗读一次）。
   * currentForkNpcs：元素形如 { id, name }。
   * currentForkHazardChars：本副本已选高危角色，元素形如 { id, name }（名字取自同调档案）。
   * currentForkCharStats：元素形如 { charIds: [], npcIds: [], metrics: [{ name, init, min, max }] }。
   * 开场拼状态块时反查：某 NPC / 高危角色绑了数值模板才拼进开场（有数值才登场）。
   */
  let currentForkNpcs = [];
  let currentForkHazardChars = [];
  // 原始高危角色 id 快照（未经「同调档案查得到名字」过滤）。
  // 世界书角色绑定按 id 匹配，不该因档案查不到名字就丢 id，故单独留一份。
  let currentForkHazardIds = [];
  let currentForkCharStats = [];

  /**
   * 本副本作者设定的主线任务（只读快照，进本时从卷宗读一次）。
   * 元素形如 { goal }，取自卷宗 clearConditions 的任务目标。
   * 开场全部标「推进中」拼进 :::quest 块（进本时任务都还没完成）。
   */
  let currentForkMissions = [];

  /**
   * 本副本作者设定的开场场景舞台（只读快照，进本时从卷宗读一次）。
   * 形如 { year, month, day, hour, minute, weekday, season, temp, weather, locName, locSub, scene }。
   * 拼开场 ::: scene 块时用：时间逐位补现实时间，气候/地点/场景空则拼「暂无」占位。
   */
  let currentForkOpeningScene = null;

  /**
   * 输入台基线让位，与 CSS 里 .fork-run-body 的 padding-bottom 基线一致。
   * CSS 负责静态让位，JS 只补「实际比基线高出多少」的增量，
   * 理由同私聊页：进场过渡中测出的 footer 高度不可信。
   */
  const FOOTER_BASELINE_PX = 178;

  const AVATAR_FALLBACK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

  // HUD 菜单动作图标 (100% 纯 SVG)
  const HUD_ICONS = {
    copy: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`,
    favorite: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`,
    select: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
    rewrite: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>`,
    continue: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`,
    delete: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`
  };

  let activeHudEl = null;
  let activeLockedBubble = null;
  // 记录刚触发的分支切换动画目标 { recordId: string, dir: 'next' | 'prev' }
  let pendingVariantAnim = null;

  // 战术多选批量状态
  let isBatchMode = false;
  const selectedRows = new Set();
  const SELECTABLE_ROW_SELECTOR = '.fork-run-narration, .fork-run-act';

  // 多选批量操作栏控件
  let batchCancelBtn = null;
  let batchSelectAllBtn = null;
  let headerStatus = null;
  let batchDock = null;
  let batchDeleteBtn = null;
  let batchDeleteCount = null;
  let batchExportBtn = null;
  let batchExportCount = null;

  /**
   * 给推演条目（叙事段 / 行动卡）挂载多选能力。
   * 与系统助手/私聊同构：100% 纯 SVG 勾选框 + 点击切换选中，支持全选与批量删除。
   */
  function attachRowBatchSelection(row) {
    if (!row) return;

    const checkbox = document.createElement('div');
    checkbox.className = 'chat-batch-checkbox';
    checkbox.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
    row.appendChild(checkbox);

    row.addEventListener('click', (e) => {
      if (!isBatchMode) return;
      e.stopPropagation();
      toggleRowSelection(row);
    });
  }

  function updateBatchCount() {
    const count = selectedRows.size;
    if (batchDeleteCount) {
      batchDeleteCount.textContent = `PURGE (${count})`;
    }
    if (batchExportCount) {
      batchExportCount.textContent = `CAPTURE (${count})`;
    }

    if (batchDeleteBtn) {
      batchDeleteBtn.style.opacity = count > 0 ? '1' : '0.5';
      batchDeleteBtn.style.pointerEvents = count > 0 ? 'auto' : 'none';
    }

    if (batchExportBtn) {
      const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
      const shotOk = count >= 1 && count <= limit;
      batchExportBtn.style.opacity = shotOk ? '1' : '0.5';
      batchExportBtn.style.pointerEvents = shotOk ? 'auto' : 'none';
    }
  }

  function toggleRowSelection(row) {
    if (!row) return;
    if (selectedRows.has(row)) {
      selectedRows.delete(row);
      row.classList.remove('is-selected');
    } else {
      selectedRows.add(row);
      row.classList.add('is-selected');
    }
    updateBatchCount();
  }

  function enterBatchMode(initialRow) {
    isBatchMode = true;
    selectedRows.clear();

    if (pageEl) pageEl.classList.add('is-batch-mode');

    // 顶栏切换
    if (backBtn) backBtn.hidden = true;
    if (batchCancelBtn) batchCancelBtn.hidden = false;
    if (menuBtn) menuBtn.hidden = true;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = false;
    if (headerStatus) headerStatus.hidden = true;

    // 底栏切换
    if (batchDock) batchDock.hidden = false;

    // 若从特定气泡进入，默认勾选该行
    if (initialRow) {
      toggleRowSelection(initialRow);
    } else {
      updateBatchCount();
    }
  }

  function exitBatchMode() {
    isBatchMode = false;
    selectedRows.forEach((row) => {
      if (row && row.classList) row.classList.remove('is-selected');
    });
    selectedRows.clear();

    if (pageEl) pageEl.classList.remove('is-batch-mode');

    // 顶栏复位
    if (backBtn) backBtn.hidden = false;
    if (batchCancelBtn) batchCancelBtn.hidden = true;
    if (menuBtn) menuBtn.hidden = false;
    if (batchSelectAllBtn) batchSelectAllBtn.hidden = true;
    if (headerStatus) headerStatus.hidden = false;

    // 底栏复位
    if (batchDock) batchDock.hidden = true;
  }

  function closeActiveHud() {
    if (activeHudEl) {
      activeHudEl.remove();
      activeHudEl = null;
    }
    if (activeLockedBubble) {
      activeLockedBubble.classList.remove('is-locked');
      activeLockedBubble = null;
    }
  }

  /**
   * 复制 AI 叙事纯正文（对齐系统助手复制体验）。
   * 剥离所有 ::: 结构卡块、抽离思考链、剥离 Markdown 语法标记，
   * 仅将干净流畅的小说正文写入系统剪贴板，并提供战术 Toast 反馈。
   */
  async function handleCopyNarration(targetEl, text, rec) {
    const raw = (targetEl && targetEl.dataset && typeof targetEl.dataset.rawText === 'string')
      ? targetEl.dataset.rawText
      : ((rec && (rec.rawText || rec.content || rec.text)) || text || '');

    // 1. 若为契约结构化文本，先剥离结构块提取正文主体
    let bodyText = raw;
    if (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function') {
      try {
        const parsed = ForkRunParser.parseRunReply(raw);
        if (parsed && typeof parsed.body === 'string') {
          bodyText = parsed.body;
        }
      } catch (_) {}
    } else {
      const fenceIdx = bodyText.indexOf('\n:::');
      if (fenceIdx >= 0) bodyText = bodyText.slice(0, fenceIdx);
    }

    // 2. 抽离思考链（<think>...</think>）
    const { cleaned } = extractThinkBlocks(bodyText);

    // 3. 剥离 Markdown 符号，保留段落排版
    const cleanText = (window.RetroflowMarkdown && typeof RetroflowMarkdown.stripMarkdown === 'function')
      ? RetroflowMarkdown.stripMarkdown(cleaned)
      : String(cleaned || '').trim();

    if (!cleanText) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'COPY // 空内容', message: '当前叙事无有效正文可复制', type: 'info' });
      }
      return;
    }

    // 4. 双重写入系统剪贴板（现代 API + execCommand 降级）
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(cleanText);
        copied = true;
      } catch (_) {
        copied = false;
      }
    }

    if (!copied) {
      try {
        const helper = document.createElement('textarea');
        helper.value = cleanText;
        helper.style.position = 'fixed';
        helper.style.opacity = '0';
        document.body.appendChild(helper);
        helper.select();
        copied = document.execCommand('copy');
        helper.remove();
      } catch (_) {
        copied = false;
      }
    }

    if (window.RetroToast) {
      if (copied) {
        RetroToast.show({
          tag: 'COPY // 复制成功',
          message: '纯正文已复制到剪贴板',
          detail: `已剥离标记，共 ${cleanText.length} 字`,
          type: 'info'
        });
      } else {
        RetroToast.show({
          tag: 'COPY // 复制失败',
          message: '未能写入剪贴板，请检查权限',
          type: 'warning'
        });
      }
    }
  }

  /**
   * 重写一段 AI 叙事（多分支版本系统）。
   * 保留当前已生成版本，向模型请求生成全新回复作为新分支，自动切换并落地存档。
   *
   * @param {HTMLElement} targetEl 目标叙事 DOM
   * @param {Object} rec 记录数据
   */
  async function handleRewriteNarration(targetEl, rec) {
    if (isReadonly) return;
    if (currentInference) {
      toast('REWRITE // 推演进行中', '当前已有推演在运行', '请等待本轮结束或点击终止后再重写', 'info');
      return;
    }

    const recordId = (targetEl && targetEl.dataset && targetEl.dataset.recordId) ||
      (rec && rec.recordId) || '';
    if (!recordId) {
      toast('REWRITE // 无法重写', '目标记录缺少持久化标识', '无法为临时条目生成分支', 'warning');
      return;
    }

    if (!window.ForkRunApi || typeof ForkRunApi.requestInference !== 'function') {
      toast('REWRITE // 链路异常', '推演请求模块未就绪', '无法启动模型推理', 'error');
      return;
    }

    // 0. 先收集重写引导：全屏沉浸编辑器，留空即按当前上下文纯净重推，取消则完全中止。
    //    引导只作用于本次请求，用后即焚，不落库、不污染后续世界线。
    let rewriteHint = '';
    if (window.TextEditorModal && typeof TextEditorModal.open === 'function') {
      const hintInput = await TextEditorModal.open({
        title: '重写引导',
        tag: 'REWRITE // 重写引导',
        value: '',
        placeholder: '告诉系统你期望的方向，留空则直接重新推演。',
        maxLength: 2000
      });
      // 取消（null）时中止整个重写流程，不发请求
      if (hintInput == null) return;
      rewriteHint = trimStr(hintInput);
    }

    // 1. 读取完整流水，获取目标记录并截取前文历史作为推演上下文
    let allRecords = [];
    if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function') {
      try {
        allRecords = await ForkRunStore.getRunRecords(currentRunId);
      } catch (err) {
        console.warn('[ForkRun] 重写时读取历史流水失败：', currentRunId, err);
      }
    }

    const targetRec = Array.isArray(allRecords) ? allRecords.find((r) => r && r.id === recordId) : null;
    if (!targetRec) {
      toast('REWRITE // 记录丢失', '未在存档中找到目标叙事', '可能已被删除', 'warning');
      return;
    }

    // 2. 截取目标叙事之前的记录作为推演上下文
    const targetIdx = allRecords.indexOf(targetRec);
    const contextRecords = targetIdx >= 0 ? allRecords.slice(0, targetIdx) : [];

    // 请求前统一触发判定：重写扫的是「目标叙事之前的历史」——即触发这轮的执行员行动 + 再上一轮 AI 回复，
    // 与这轮第一次生成时的扫描窗口一致。幂等安全：已触发/已解明/已命中的不会重复。
    try {
      await processTriggersBeforeRequest(contextRecords, Number(targetRec.turn) || 0);
    } catch (err) {
      console.warn('[ForkRun] 重写请求前触发判定失败：', err);
    }

    // 3. 原地将目标气泡切换为推演等待态（战术十字因果罗盘）
    targetEl.classList.remove('is-streaming');
    targetEl.classList.add('is-pending');
    targetEl.innerHTML = `
      <div class="fork-run-pending-mark" aria-label="分支推演重塑中">${PENDING_MARK_SVG}</div>
      <div class="fork-run-narration-text chat-bubble-content"></div>
    `;

    const pending = {
      block: targetEl,
      textEl: targetEl.querySelector('.fork-run-narration-text')
    };

    settleBottom(true);

    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    currentInference = { controller, aborted: false };
    setSendButtonState(true);

    let full = '';
    let failed = null;

    try {
      full = await ForkRunApi.requestInference({
        fork: currentFork,
        envoyCtx: buildEnvoyCtx(),
        openingCtx: { openingId: trimStr(currentRun && currentRun.openingId) },
        records: contextRecords,
        rewriteHint,
        // 重写只传当前待亮线索保持上下文一致，但不推进线索状态：
        // 重写是「换一版表达」，非剧情推进，触发/解锁只跟正向推进走。
        clueCtx: buildClueCtx(Number(targetRec.turn) || (currentRun && currentRun.turnCount) || 0),
        // 真相常驻块照带（已解明就该一直在场）；但导演指令不发——重写非推进，不重复触发转折
        truthCtx: buildTruthCtx(),
        // 结局收尾基调块照带（已定就该一直在场）；同理不发收尾导演指令
endingCtx: buildEndingCtx(),
        // 任务上下文照带（已解锁/已完成态该一致）；但不结算解锁、不发解锁贴脸指令——重写非推进
        missionCtx: buildMissionCtx(),
        rosterIds: buildRosterIds(),
        wbOverrides: buildWbOverrides(),
        signal: controller ? controller.signal : null,
        onChunk: (delta, fullText) => {
          if (currentInference && currentInference.aborted) return;
          updatePendingNarration(pending, fullText);
        }

      });
    } catch (err) {
      failed = err;
    }

    const wasAborted = !!(currentInference && currentInference.aborted);
    currentInference = null;
    setSendButtonState(false);

    const isAbortErr = !!(failed && failed.name === 'AbortError');
    if (failed && !isAbortErr && !wasAborted) {
      toast('REWRITE // 重写失败', '新分支推演没能完成', trimStr(failed.message) || '链路异常', 'error');
      await renderRunRecords();
      return;
    }

    const newContent = trimStr(full);
    if (!newContent) {
      if (!wasAborted && !isAbortErr) {
        toast('REWRITE // 空回复', '模型没有输出有效内容', '保留原有版本不作修改', 'warning');
      }
      await renderRunRecords();
      return;
    }

    // 4. 版本归档与追加：将新回复作为新分支存入 variants
    const now = Date.now();
    let existingVariants = Array.isArray(targetRec.variants) && targetRec.variants.length > 0
      ? [...targetRec.variants]
      : [{ content: targetRec.content || '', createdAt: targetRec.createdAt || now }];

    // 如果原先激活的版本内容在编辑后与 variants 不一致，先校准原版本
    const activeIdx = (typeof targetRec.activeVariantIndex === 'number' && targetRec.activeVariantIndex >= 0 && targetRec.activeVariantIndex < existingVariants.length)
      ? targetRec.activeVariantIndex
      : 0;
    if (existingVariants[activeIdx] && targetRec.content && existingVariants[activeIdx].content !== targetRec.content) {
      existingVariants[activeIdx].content = targetRec.content;
    }

    // 追加新分支
    existingVariants.push({
      content: newContent,
      createdAt: now
    });

    const newActiveIndex = existingVariants.length - 1;

    if (window.ForkRunStore && typeof ForkRunStore.updateRunRecord === 'function') {
      const ok = await ForkRunStore.updateRunRecord(currentRunId, recordId, {
        content: newContent,
        variants: existingVariants,
        activeVariantIndex: newActiveIndex
      });
      if (!ok) {
        toast('REWRITE // 保存失败', '新分支未能写入存档', '请检查存储空间', 'error');
      } else {
        if (window.RetroToast) {
          RetroToast.show({
            tag: 'REWRITE // 分支生成完毕',
            message: `已切换至分支 ${String(newActiveIndex + 1).padStart(2, '0')} / ${String(existingVariants.length).padStart(2, '0')}`,
            type: 'info'
          });
        }
        // 重写落定后：触发判定已在请求前跑过（processTriggersBeforeRequest），这里只处理
        // 重写新正文里 AI 可能带出的 ::: clue 亮出回执 + 超时兜底，并消费请求前命中的卡片标志。
        // block=null：卡片不即时挂，靠随后的 renderRunRecords 按记录 id 重建。
        try {
          if (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function') {
            const rewriteTurn = Number(targetRec && targetRec.turn) || Number(currentRun && currentRun.turnCount) || 0;
            const rewriteParsed = ForkRunParser.parseRunReply(newContent);
            await processCluesAfterReply(rewriteParsed, rewriteTurn, null);
          }
        } catch (err) {
          console.warn('[ForkRun] 重写后线索处理失败：', err);
        }
      }
    }

    // 5. 重新渲染整线，正文与所有状态卡同步更新
    await renderRunRecords();
    settleBottom(false);
  }

  function handleHudAction(key, type, targetEl, text, rec) {
    if (key === 'copy') {
      if (type === 'narration') {
        handleCopyNarration(targetEl, text, rec);
      }
      return;
    }

    if (key === 'select') {
      enterBatchMode(targetEl);
      return;
    }

    if (key === 'rewrite') {
      if (type === 'narration') {
        handleRewriteNarration(targetEl, rec);
      }
      return;
    }

    if (key === 'edit') {
      handleEditRecord(type, targetEl, rec);
      return;
    }

    if (key === 'rewind') {
      handleRewindRecord(type, targetEl, rec);
      return;
    }

    if (key === 'delete') {
      handleDeleteRecord(type, targetEl, rec);
      return;
    }

    if (key === 'continue') {
      if (type === 'narration') {
        handleContinueNarration(targetEl, rec);
      }
      return;
    }
    // 后续各功能接入留空，不弹 Toast，保持 UI 纯净
  }

  /**
   * 删除一条流水记录：二次确认后从存档里抹除，成功再整条线重渲染。
   *
   * 上下文不必单独处理 —— 每轮推演都是重读库里的完整流水再装配请求，
   * 记录从库里消失后，下一轮自然就不带它了，不存在第二份副本要同步。
   *
   * 只删这一条。删掉行动留下叙事（或反之）会让上下文的因果链略显跳跃，
   * 但这是用户的明确选择，整段砍有「回溯到此」负责。
   */
  async function handleDeleteRecord(type, targetEl, rec) {
    if (isReadonly) return;

    // 推演进行中禁止删：正在流式写入时抽掉记录，收尾落库会错位
    if (currentInference) {
      toast('PURGE // 推演中', '当前正在推演', '请先等本轮结束或点击终止，再删除流水', 'info');
      return;
    }

    const recordId = (targetEl && targetEl.dataset && targetEl.dataset.recordId) ||
      (rec && rec.recordId) || '';

    // 没有 recordId 的是落库失败的临时条目，库里本就没有，删不了也不必删
    if (!recordId) {
      toast('PURGE // 无法抹除', '这条记录未能存入存档', '它只存在于当前画面，退出本页即会消失', 'warning');
      return;
    }

    const isNarration = type === 'narration';

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'PURGE // 抹除流水',
        message: isNarration ? '确认抹除这段推演叙事吗？' : '确认抹除这条执行员行动吗？',
        detail: '该记录将从这条世界线中彻底移除，且不再进入后续推演的上下文，无法撤销。同一轮的另一条记录会保留。',
        confirmText: '确认抹除',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    // 先删存档，成功后才重渲染，避免画面与存档分叉
    if (window.ForkRunStore && typeof ForkRunStore.deleteRunRecord === 'function') {
      const ok = await ForkRunStore.deleteRunRecord(currentRunId, recordId);
      if (!ok) {
        toast('PURGE // 抹除失败', '这条记录没能删掉', '存档未被改动，可稍后重试', 'error');
        return;
      }
    }

    await renderRunRecords();
  }

  /**
   * 回溯到此：完全对齐系统助手页（system-chat-ui.js:rewindFromRow）逻辑。
   * - 若选中执行员行动卡（act/envoy）：删除包含当前行在内的所有后续记录，并将当前行动退回输入框；
   * - 若选中 AI 叙事段（narration）：保留当前叙事，删除其后的所有记录，并将被删的最后一条执行员行动退回输入框。
   */
  async function handleRewindRecord(type, targetEl, rec) {
    if (isReadonly) return;

    if (currentInference) {
      toast('REWIND // 推演中', '当前正在推演', '请先等本轮结束或点击终止，再执行回溯', 'info');
      return;
    }

    if (!streamEl || !targetEl) return;

    // 定位目标行（兼容 targetEl 是 .fork-run-act-bubble 或 .fork-run-act 的情况）
    const targetRow = targetEl.closest(SELECTABLE_ROW_SELECTOR) || targetEl;
    const rows = Array.from(streamEl.querySelectorAll(SELECTABLE_ROW_SELECTOR));
    const targetIndex = rows.indexOf(targetRow);
    if (targetIndex < 0) return;

    const isActRow = targetRow.classList.contains('fork-run-act');

    // 执行员行动卡：包含当前行一起删除并回填；AI 叙事段：保留当前段，删除后续
    const rowsToDelete = isActRow ? rows.slice(targetIndex) : rows.slice(targetIndex + 1);

    if (!rowsToDelete.length) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // NO OPERATION', message: '当前内容已经位于推演末端。', type: 'info' });
      }
      return;
    }

    // 确定要退回输入框的行动原文
    let restoredText = '';
    if (isActRow) {
      restoredText = (targetRow.dataset && typeof targetRow.dataset.rawText === 'string')
        ? targetRow.dataset.rawText
        : trimStr((rec && rec.text) || '');
    } else {
      const latestActRow = rowsToDelete.slice().reverse().find((item) => item.classList.contains('fork-run-act'));
      if (latestActRow) {
        restoredText = (latestActRow.dataset && typeof latestActRow.dataset.rawText === 'string')
          ? latestActRow.dataset.rawText
          : '';
      }
    }

    const recordIds = rowsToDelete
      .map((item) => item && item.dataset && item.dataset.recordId)
      .filter(Boolean);

    const rememberKey = 'retroflow_fork_run_rewind_confirmed_v1';
    let skipConfirm = false;
    try { skipConfirm = localStorage.getItem(rememberKey) === '1'; } catch (_) {}

    if (!skipConfirm && window.RetroModal && typeof RetroModal.confirm === 'function') {
      const confirmed = await RetroModal.confirm({
        tag: 'REWIND // 回溯世界线',
        message: '确认回溯到此节点吗？',
        detail: isActRow
          ? `将删除此条行动及后续共 ${rowsToDelete.length} 条流水，此条行动会退回输入框。这些剧情中解锁的线索、解明的真相与命中的结局会一并退回未达成状态。`
          : `此段叙事之后的 ${rowsToDelete.length} 条流水将被永久抹除，最近一条执行员行动会退回输入框。这些剧情中解锁的线索、解明的真相与命中的结局会一并退回未达成状态。`,
        confirmText: '确认回溯',
        cancelText: '取消',
        danger: true,
        rememberKey
      });
      if (!confirmed) return;
    }

    if (recordIds.length > 0 && window.ForkRunStore && typeof ForkRunStore.deleteRunRecord === 'function') {
      // 删档前先算「回溯后仍存活记录的最大轮次」：
      // 供 store 侧回滚老存档（缺 unlockedRecordId 的线索/真相/结局）时作 turn 兜底阈值。
      // 必须在删除前读，删完就再也算不出被保留区间的真实轮次了。
      let survivingMaxTurn = 0;
      try {
        if (typeof ForkRunStore.getRunRecords === 'function') {
          const allRecords = await ForkRunStore.getRunRecords(currentRunId);
          const deletedSet = new Set(recordIds);
          (Array.isArray(allRecords) ? allRecords : []).forEach((r) => {
            if (!r || deletedSet.has(r.id)) return;
            const t = Number(r.turn) || 0;
            if (t > survivingMaxTurn) survivingMaxTurn = t;
          });
        }
      } catch (_) { /* 读不到就按 0：兜底判定会把所有带 turn 的状态一并回滚，偏保守但不会漏 */ }

      let failCount = 0;
      for (const rid of recordIds) {
        try {
          const ok = await ForkRunStore.deleteRunRecord(currentRunId, rid);
          if (!ok) failCount++;
        } catch (_) {
          failCount++;
        }
      }
      if (failCount > 0 && window.RetroToast) {
        RetroToast.show({ tag: 'REWIND // PARTIAL', message: `有 ${failCount} 条后续记录未能清除`, type: 'warning' });
      }

      // 回溯世界线状态：线索解锁 / 真相解明 / 结局命中这些持久标记必须随剧情一起退回，
      // 否则态势舱数字虚高，而且 System Prompt 会继续把已被删掉的真相与线索喂给 AI，
      // 回溯在叙事层等于没生效。
      if (typeof ForkRunStore.rollbackStatesByRecordIds === 'function') {
        try {
          const rolled = await ForkRunStore.rollbackStatesByRecordIds(currentRunId, recordIds, survivingMaxTurn);
          if (rolled) {
            currentRun = rolled;
            // 态势舱若已渲染过，数字与解明卡要同步退回
            if (typeof refreshResDashboardData === 'function') {
              try { refreshResDashboardData(); } catch (_) {}
            }
          }
        } catch (err) {
          console.warn('[ForkRun] 回溯世界线状态失败：', err);
        }
      }
    }

    // 重渲染整线流水并恢复输入框
    await renderRunRecords();
    settleBottom(false);

    if (textarea && restoredText) {
      textarea.value = restoredText;
      autoResizeTextarea();
      textarea.focus();
    }
  }

  /**
   * 编辑一条流水记录：全屏编辑 AI 原文（含 ::: 块），保存后写回存档并整条重渲染。
   * 只读态（历史回看）禁止编辑。参考助手端 system-chat-ui 的编辑模式：
   * 先覆盖持久化记录，成功后再刷新画面，避免 UI 与存档分叉。
   */
  async function handleEditRecord(type, targetEl, rec) {
    if (isReadonly) return;
    if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;

    const isNarration = type === 'narration';

    // narration 的 dataset.rawText 存的是含 ::: 块的 AI 原文；envoy 存的是行动原文
    const rawValue = (targetEl && targetEl.dataset && typeof targetEl.dataset.rawText === 'string')
      ? targetEl.dataset.rawText
      : trimStr((rec && (rec.rawText || rec.text)) || '');
    const recordId = (targetEl && targetEl.dataset && targetEl.dataset.recordId) ||
      (rec && rec.recordId) || '';

    if (!recordId) return;

    const updated = await TextEditorModal.open({
      title: isNarration ? '编辑推演' : '编辑行动',
      tag: isNarration ? 'RECORD // 修改流水' : 'ACTION // 修改行动',
      value: rawValue,
      // AI 输出可能超过一万字；null 会启用 TextEditorModal 的不限长模式。
      // 用户行动维持宽松上限，避免误粘贴极端大文本。
      maxLength: isNarration ? null : 20000,
      placeholder: isNarration
        ? '按格式契约书写：::: scene / state / npc / quest 等区块与正文'
        : '修改本轮执行员行动描述'
    });

    if (updated == null || updated === rawValue) return;

    // 先写回存档，成功后才重渲染，避免画面与存档分叉
    if (window.ForkRunStore && typeof ForkRunStore.updateRunRecord === 'function') {
      // 若当前记录已有 variants，更新当前激活版本的内容
      let patch = { content: updated };
      try {
        const records = await ForkRunStore.getRunRecords(currentRunId);
        const cur = Array.isArray(records) ? records.find((r) => r && r.id === recordId) : null;
        if (cur && Array.isArray(cur.variants) && cur.variants.length > 0) {
          const vIdx = (typeof cur.activeVariantIndex === 'number' && cur.activeVariantIndex >= 0 && cur.activeVariantIndex < cur.variants.length)
            ? cur.activeVariantIndex
            : 0;
          const nextVariants = [...cur.variants];
          nextVariants[vIdx] = {
            ...nextVariants[vIdx],
            content: updated,
            updatedAt: Date.now()
          };
          patch.variants = nextVariants;
        }
      } catch (_) {}

      const ok = await ForkRunStore.updateRunRecord(currentRunId, recordId, patch);
      if (!ok) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'RECORD // WRITE FAILED', message: '推演流水修改未能写入存档。', type: 'warning' });
        }
        return;
      }

      // 编辑改的是历史记录原文，本身不发推演请求、不产生新的 AI 回复，故不跑触发判定。
      // 编辑后的内容会自然进入「下一次正向推进/继续」的请求前扫描窗口（那时从库里读到的就是新版），
      // 触发在那一刻统一处理，这里只负责落库 + 重渲染。
    }

    // 整条线重渲染，解析器对新原文重新跑一遍，立即看到渲染效果
    await renderRunRecords();
    settleBottom(false);
  }

  function openContextHud(targetEl, type, rec, touchPos) {
    closeActiveHud();
    if (!pageEl || !targetEl) return;

    targetEl.classList.add('is-locked');
    activeLockedBubble = targetEl;

    const isNarration = type === 'narration';
    const text = trimStr(targetEl.dataset.rawText || (rec && rec.text) || targetEl.textContent);

    // 「重写」与「继续」都只在整场推演的最新一条叙事上可用：
    //   - 重写：为最新叙事另开分支重推，插在历史中间会打乱后续因果；
    //   - 继续：以隐式行动向后推进剧情，非末尾则会插进中间破坏时间线。
    // 二者共用同一条件 —— 必须是 AI 叙事、无推演、非只读，且是流里的最后一行。
    let canRewrite = false;
    let canContinue = false;
    if (isNarration && !currentInference && !isReadonly && streamEl) {
      const allRows = Array.from(streamEl.children);
      const targetIdx = allRows.indexOf(targetEl);
      const isLastRow = targetIdx >= 0 && targetIdx === allRows.length - 1;
      canRewrite = isLastRow;
      canContinue = isLastRow;
    }

    const menuItems = isNarration
      ? [
          { key: 'copy', zh: '复制', en: 'COPY', icon: HUD_ICONS.copy },
          { key: 'edit', zh: '编辑', en: 'EDIT', icon: HUD_ICONS.edit },
          { key: 'fav', zh: '收藏', en: 'FAV', icon: HUD_ICONS.favorite },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewrite', zh: '重写', en: 'REWRITE', icon: HUD_ICONS.rewrite, disabled: !canRewrite },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'continue', zh: '继续', en: 'CONTINUE', icon: HUD_ICONS.continue, disabled: !canContinue },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ]
      : [
          { key: 'edit', zh: '编辑', en: 'EDIT', icon: HUD_ICONS.edit },
          { key: 'select', zh: '多选', en: 'SELECT', icon: HUD_ICONS.select },
          { key: 'rewind', zh: '回溯到此', en: 'REWIND', icon: HUD_ICONS.rewind },
          { key: 'delete', zh: '删除', en: 'PURGE', icon: HUD_ICONS.delete, isDanger: true }
        ];

    const hud = document.createElement('div');
    hud.className = 'chat-context-hud';

    const grid = document.createElement('div');
    grid.className = 'chat-hud-grid cols-4';

    menuItems.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `chat-hud-item ${item.isDanger ? 'is-danger' : ''}`;
      btn.dataset.action = item.key;
      btn.disabled = Boolean(item.disabled);
      if (item.disabled) btn.setAttribute('aria-disabled', 'true');

      btn.innerHTML = `
        ${item.icon}
        <span class="chat-hud-item-zh">${item.zh}</span>
        <span class="chat-hud-item-en">${item.en}</span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.disabled) return;
        handleHudAction(item.key, type, targetEl, text, rec);
        closeActiveHud();
      });

      grid.appendChild(btn);
    });

    hud.appendChild(grid);
    pageEl.appendChild(hud);
    activeHudEl = hud;

    const pageRect = pageEl.getBoundingClientRect();
    const targetRect = targetEl.getBoundingClientRect();
    const hudWidth = 260;
    const hudHeight = isNarration ? 134 : 70;

    const anchorX = (touchPos && touchPos.x) ? touchPos.x : (targetRect.left + targetRect.width / 2);
    let left = anchorX - (hudWidth / 2) - pageRect.left;
    left = Math.max(12, Math.min(left, pageRect.width - hudWidth - 12));

    const anchorY = (touchPos && touchPos.y) ? touchPos.y : targetRect.top;
    let top = anchorY - pageRect.top - hudHeight - 20;

    if (top < 68) {
      top = anchorY - pageRect.top + 28;
    }

    const footerEl = pageEl.querySelector('.fork-run-footer');
    const maxTop = footerEl ? (footerEl.getBoundingClientRect().top - pageRect.top - hudHeight - 10) : (pageRect.height - hudHeight - 80);
    top = Math.min(top, maxTop);
    top = Math.max(68, top);

    hud.style.left = `${left}px`;
    hud.style.top = `${top}px`;
  }

  function bindLongPress(el, type, rec) {
    if (!el) return;
    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let moved = false;

    const cancelPress = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    el.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      moved = false;

      cancelPress();
      pressTimer = setTimeout(() => {
        if (!moved) {
          if (navigator.vibrate) {
            try { navigator.vibrate(25); } catch (_) {}
          }
          openContextHud(el, type, rec, { x: lastTouchX, y: lastTouchY });
        }
      }, 450);
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      if (Math.hypot(touch.clientX - startX, touch.clientY - startY) > 8) {
        moved = true;
        cancelPress();
      }
    }, { passive: true });

    el.addEventListener('touchend', cancelPress);
    el.addEventListener('touchcancel', cancelPress);

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openContextHud(el, type, rec, { x: e.clientX, y: e.clientY });
    });
  }
const EMPTY_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 3h2v8h4l-5 6-5-6h4V3zm-6 16h14v2H5v-2z"/></svg>`;

  /** 发送按钮的两种形态图标：上箭头（发送）与方块（终止），与私聊/助手页一致 */
  const SEND_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"/>'
    + '</svg>';
  const STOP_ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<rect x="6" y="6" width="12" height="12" rx="1.5"/>'
    + '</svg>';

  /**
   * 推演等待标识：时空陀螺共振核（Gyro Resonance Core）。
   * 纯原生矢量 SVG + CSS GPU 动画，禁止 emoji，禁止生硬分割线。
   *
   * 视觉构成：
   * 1. 外层时空纬度环（慢速顺时针，带断续刻度与定位方点）
   * 2. 中层因果倾角环（倾斜反向自转，带扫描微弧）
   * 3. 内层测地线八边轴（高频自旋与微摆）
   * 4. 晶核中心共振菱形（双重径向辉光心跳缩放）
   * 5. 战术遥测徽标排版（双行等宽机能代码与呼吸微点）
   */
  /**
   * 推演等待标识：战术十字因果罗盘（Tactical Reticle Core - Precision Edition）。
   * 纯原生矢量线条艺术（Line Art），无阴影、无晕染、无 emoji、无生硬分割线。
   * 外环顺转慢速，扩充内环逆转高速，中央微倾 20° 战术极锐四芒十字星（无中心圆点，刀刃纯粹）。
   */
  const PENDING_MARK_SVG = '<div class="fork-run-gyro-wrapper">'
    + '<svg class="fork-run-gyro-svg" viewBox="0 0 64 64" aria-hidden="true">'
    + '  <!-- 外层正圆纬度刻度环（缓慢匀速顺时针自转，r=26） -->'
    + '  <g class="gyro-ring-outer">'
    + '    <circle class="gyro-base-circle" cx="32" cy="32" r="26" fill="none" stroke-width="1"/>'
    + '    <circle class="gyro-outer-dash" cx="32" cy="32" r="26" fill="none" stroke-width="1.2" stroke-dasharray="12 12 28 12" stroke-linecap="round"/>'
    + '    <rect class="gyro-puck" x="31" y="4.5" width="2" height="3" rx="0.5"/>'
    + '    <rect class="gyro-puck" x="31" y="56.5" width="2" height="3" rx="0.5"/>'
    + '  </g>'
    + '  <!-- 内层高频差速次轨（扩充至 r=19.5，密集微点阵，高速逆时针自转） -->'
    + '  <g class="gyro-ring-sub-reverse">'
    + '    <circle class="gyro-sub-circle" cx="32" cy="32" r="19.5" fill="none" stroke-width="0.8" stroke-dasharray="3 3.5 6 3.5" stroke-linecap="round"/>'
    + '  </g>'
    + '  <!-- 中央战术极锐四芒十字星（无圆点，极致纤薄收腰，物理坐标固化倾斜 20°） -->'
    + '  <g class="gyro-reticle-star">'
    + '    <path class="gyro-star-cross" d="M 35.59 22.13 Q 33 31.53 41.87 35.59 Q 32.47 33 28.41 41.87 Q 31 32.47 22.13 28.41 Q 31.53 31 35.59 22.13 Z" />'
    + '  </g>'
    + '</svg>'
    + '<div class="fork-run-gyro-telemetry">'
    + '  <div class="gyro-tele-header">'
    + '    <span class="gyro-tele-tag">RESONANCE CORE</span>'
    + '    <span class="gyro-tele-status">系统推理中</span>'
    + '  </div>'
    + '  <div class="gyro-tele-sub">'
    + '    <span class="gyro-tele-code">COLLATING PARALLEL VECTORS</span>'
    + '    <span class="gyro-tele-dots">'
    + '      <span class="gyro-dot"></span><span class="gyro-dot"></span><span class="gyro-dot"></span>'
    + '    </span>'
    + '  </div>'
    + '</div>'
    + '</div>';

  /**
   * 同步发送按钮形态：推演请求进行中变为方块终止态，与私聊页交互口径一致。
   * @param {boolean} isRunning 是否处于推演进行中（终止态）
   */
  function setSendButtonState(isRunning) {
    if (!sendBtn) return;
    if (isRunning) {
      sendBtn.classList.add('is-generating');
      sendBtn.innerHTML = STOP_ICON_SVG;
      sendBtn.setAttribute('aria-label', '终止推演');
      sendBtn.setAttribute('title', '终止推演 (ABORT)');
    } else {
      sendBtn.classList.remove('is-generating');
      sendBtn.innerHTML = SEND_ICON_SVG;
      sendBtn.setAttribute('aria-label', '提交行动');
      sendBtn.setAttribute('title', '提交行动');
    }
    sendBtn.disabled = false;
  }

  /**
   * 终止当前推演请求。
   *
   * 先打 aborted 标记再 abort：流式回调此后一律丢弃，避免掐断瞬间
   * 又有一个 chunk 挤进来往已经准备移除的占位块上写字。
   * 已经流出来的正文由 runInference 照常落库 —— 用户看到的字不该凭空消失。
   */
  function abortInference() {
    if (!currentInference) {
      setSendButtonState(false);
      return;
    }
    currentInference.aborted = true;
    if (currentInference.controller) {
      try { currentInference.controller.abort(); } catch (_) { /* 已结束的请求 abort 会抛，忽略 */ }
    }
    setSendButtonState(false);
  }


  /** 战术条码 SVG（纯矢量线条，硬核科技感，禁止使用 emoji） */
  const BARCODE_SVG = `<svg viewBox="0 0 28 10" width="20" height="9" fill="currentColor" aria-hidden="true">
    <rect x="0" y="0" width="2" height="10"/>
    <rect x="3.5" y="0" width="1" height="10"/>
    <rect x="6" y="0" width="3" height="10"/>
    <rect x="11" y="0" width="1.5" height="10"/>
    <rect x="14" y="0" width="2" height="10"/>
    <rect x="17.5" y="0" width="1" height="10"/>
    <rect x="20" y="0" width="3" height="10"/>
    <rect x="24.5" y="0" width="1" height="10"/>
    <rect x="26.5" y="0" width="1.5" height="10"/>
  </svg>`;

  /* ================= 工具 ================= */

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"')
      .replace(/'/g, '&#39;');
  }

  /**
   * 副本专属引号高亮：把对白/强调引号内容套上重点色。
   * 仅作用于副本正文（.fork-run-narration-text），绝不改动助手端通用 Markdown 行为。
   *
   * 覆盖四种成对引号（不含弯单引号，避免英文所有格/缩写 it's、Tom's 误伤）：
   *   · 中文弯双引号 “…”（\u201C…\u201D）
   *   · 日式直角引号 「…」（\u300C…\u300D）
   *   · 日式双直角引号 『…』（\u300E…\u300F）
   *   · 英文直双引号 "…"（成对贪婪匹配，落单奇数不触发）
   *
   * 在 RetroflowMarkdown.render 之后的 HTML 串上跑：行内代码此时已由引擎包成
   * <code> 标签，标签属性里不会出现成对中文引号；直双引号仅可能来自正文，安全。
   * @param {string} html 已渲染的 HTML 字符串
   * @returns {string}
   */
  function highlightForkQuotes(html) {
    if (typeof html !== 'string' || !html) return html || '';

    // 第一层保护：把代码块整段（含内部文本）抽走占位，避免代码里的字符串
    // 字面量（如 return "CONVERGED";）被引号高亮误染。覆盖块级 <pre>…</pre>
    // 与行内 <code>…</code>。
    const guards = [];
    const stash = (m) => {
      const idx = guards.length;
      guards.push(m);
      return `\x1Afq${idx}\x1A`;
    };
    let text = html
      .replace(/<pre[\s\S]*?<\/pre>/gi, stash)
      .replace(/<code>[\s\S]*?<\/code>/gi, stash);

    // 第二层保护：把剩余所有 HTML 标签整段抽走占位。引号正则只能作用于「文本
    // 节点」，绝不能碰标签——否则属性值里的双引号（class="..."、d="M7.41 ..."）
    // 会被劫持、撑破标签结构。
    text = text.replace(/<[^>]+>/g, stash);

    text = text.replace(
      /(\u201C[^\u201D]+\u201D|\u300C[^\u300D]+\u300D|\u300E[^\u300F]+\u300F|"[^"]+")/g,
      '<span class="fork-run-quote">$1</span>'
    );

    // 还原所有被抽走的片段（占位符内容不含引号，一次全量还原即可）
    text = text.replace(/\x1Afq(\d+)\x1A/g, (_, idx) => guards[Number(idx)] || '');
    return text;
  }

  /**
   * 副本专属：从原文里抽取所有 <think>/<thinking> 段落，并返回去掉 think 的正文。
   * 归拢用——把散落各处的思考链统一收进「每轮场景下方」的折叠栏，正文保持干净。
   * 覆盖闭合与流式未闭合两种形态，顺序保留 AI 输出的先后。
   * @param {string} raw 原始叙事文本
   * @returns {{ thinks: string[], cleaned: string }}
   */
  function extractThinkBlocks(raw) {
    const thinks = [];
    if (typeof raw !== 'string' || !raw) return { thinks, cleaned: raw || '' };

    let text = raw;
    // 1. 闭合 <think>...</think> / <thinking>...</thinking>
    text = text.replace(/<(think|thinking)>([\s\S]*?)<\/\1>/gi, (_, _tag, content) => {
      const inner = trimStr(content);
      if (inner) thinks.push(inner);
      return '';
    });
    // 2. 流式未闭合 <think>...（吐到一半）
    text = text.replace(/<(think|thinking)>([\s\S]*)$/gi, (_, _tag, content) => {
      const inner = trimStr(content);
      if (inner) thinks.push(inner);
      return '';
    });

    // 去掉抽走 think 后遗留的多余空行
    const cleaned = text.replace(/\n{3,}/g, '\n\n').trim();
    return { thinks, cleaned };
  }

  /**
   * 读取「组件默认展开」设置。默认 true（展开）。
   * 4 类状态卡（执行员/队友/NPC/任务）初始折叠态由它决定；思考过程不受此影响。
   */
  function shouldExpandComponentsByDefault() {
    if (window.ForkRunSettingsUI && typeof ForkRunSettingsUI.getSettings === 'function') {
      const s = ForkRunSettingsUI.getSettings();
      return s.defaultExpandComponents !== false;
    }
    return true;
  }

  /**
   * 副本专属：构建「每轮归拢思考链」折叠栏，默认折叠。空则返回 null（不渲染空壳）。
   * 先复用助手端 chat-md-think-* 视觉跑通逻辑，副本专属皮肤后续再磨。
   * @param {string[]} thinks 抽取到的多段思考内容
   * @returns {HTMLElement|null}
   */
  function buildThinkFoldCard(thinks) {
    if (!Array.isArray(thinks) || thinks.length === 0) return null;

    // 多段之间空行分隔，保留「分了几段思考」的层次
    const merged = thinks.join('\n\n');

    const details = document.createElement('details');
    details.className = 'chat-md-think-details fork-run-think-fold';
    // 默认折叠：不加 open 属性

    const summary = document.createElement('summary');
    summary.className = 'chat-md-think-summary fork-run-think-summary';
    summary.setAttribute('aria-label', '展开/收起思维推演过程');
    summary.innerHTML =
      '<span class="fork-run-think-chip-left">' +
        '<svg viewBox="0 0 24 24" class="fork-run-think-chip-icon" aria-hidden="true">' +
          '<path d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"/>' +
        '</svg>' +
        '<span class="fork-run-think-tag-wrap">' +
          '<span class="fork-run-think-tag-code">THINK //</span>' +
          '<span class="fork-run-think-tag-label">思维推演</span>' +
        '</span>' +
      '</span>' +
      '<span class="fork-run-think-chevron-icon">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>' +
      '</span>';

    const content = document.createElement('div');
    content.className = 'chat-md-think-content fork-run-think-content';
    // think 内容也走 Markdown 渲染（thinker 可能写了 markdown）；此时已无 think 标签，
    // 不会触发二次抽取。缺引擎时退回纯文本转义。
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.render === 'function') {
      content.innerHTML = RetroflowMarkdown.render(merged);
    } else {
      content.textContent = merged;
    }

    // 抽屉动效包裹层（Grid 0fr -> 1fr 顺滑过渡）
    const drawer = document.createElement('div');
    drawer.className = 'fork-run-think-drawer';
    const drawerInner = document.createElement('div');
    drawerInner.className = 'fork-run-think-drawer-inner';
    drawerInner.appendChild(content);
    drawer.appendChild(drawerInner);

    details.append(summary, drawer);

    // 绑定平滑收拢拦截逻辑：解决原生 details 关闭时无退出动画直接 display:none 的缺陷
    let isClosing = false;
    summary.addEventListener('click', (e) => {
      if (details.open && !isClosing) {
        e.preventDefault();
        isClosing = true;
        details.classList.add('is-closing');
        setTimeout(() => {
          details.open = false;
          details.classList.remove('is-closing');
          isClosing = false;
        }, 240); // 略微小于 CSS 动画时长，完成平滑交接
      }
    });

    // 关键：think 折叠栏直接挂在 block 下，不在任何 .chat-bubble-content 作用域内，
    // 会丢失 chat-md-* 全套样式（图标尺寸、summary 排版、内容底色），导致 chevron
    // SVG 失去 width 约束撑满全屏。故外包一层 chat-bubble-content scope 让它落进作用域，
    // 拿回全套助手端 think 视觉；副本专属皮肤后续在 .fork-run-think-scope 上覆盖。
    const scope = document.createElement('div');
    scope.className = 'chat-bubble-content fork-run-think-scope';
    scope.appendChild(details);
    return scope;
  }

  function toast(tag, message, detail, type) {
    if (!window.RetroToast) return;
    window.RetroToast.show({ tag, message, detail, type: type || 'info' });
  }

  /* ================= 时空锚定卡矢量图标 (100% 纯 SVG，禁止 emoji) ================= */
  const ANCHOR_ICONS = {
    clock: `<svg viewBox="0 0 24 24" class="fork-run-anchor-metric-icon" aria-hidden="true"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>`,
    thermometer: `<svg viewBox="0 0 24 24" class="fork-run-anchor-metric-icon" aria-hidden="true"><path d="M15 13V5c0-1.66-1.34-3-3-3S9 3.34 9 5v8c-1.21.91-2 2.37-2 4 0 2.76 2.24 5 5 5s5-2.24 5-5c0-1.63-.79-3.09-2-4zm-4-8c0-.55.45-1 1-1s1 .45 1 1h-1v1h1v2h-1v1h1v2h-2V5z"/></svg>`,
    weather: `<svg viewBox="0 0 24 24" class="fork-run-anchor-metric-icon" aria-hidden="true"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z"/></svg>`,
    location: `<svg viewBox="0 0 24 24" class="fork-run-anchor-loc-icon" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>`,
    radar: `<svg viewBox="0 0 24 24" class="fork-run-anchor-scene-head-icon" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v2.08c1.85.34 3.32 1.81 3.66 3.66H19v2h-2.34c-.34 1.85-1.81 3.32-3.66 3.66V19h-2v-2.34c-1.85-.34-3.32-1.81-3.66-3.66H5v-2h2.34c.34-1.85 1.81-3.32 3.66-3.66V7zm1 4.25c-1.52 0-2.75 1.23-2.75 2.75s1.23 2.75 2.75 2.75 2.75-1.23 2.75-2.75-1.23-2.75-2.75-2.75z"/></svg>`
  };

  /* ================= 战术控制台抽屉 (TACTICAL DECK DRAWER) ================= */

  /**
   * 7档水相因果专属纯矢量微图腾 (与 fork-ready / fork-archive 体系完全对齐，纯机能线条)
   */
  const FORK_RANK_SVGS = {
    'E': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><path d="M8 2.2 C6.2 5.5 3.8 8.8 3.8 11.2 A4.2 4.2 0 0 0 12.2 11.2 C12.2 8.8 9.8 5.5 8 2.2 Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'D': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><line x1="2.5" y1="5" x2="13.5" y2="5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M3.5 9.5 L8 13.5 L12.5 9.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'C': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><polygon points="8,2 13,9 8,14 3,9" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="9" r="1.5" fill="currentColor"/></svg>`,
    'B': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><path d="M2 11 L5 7 L8 10 L11 5 L14 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    'A': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><path d="M3 8 C3 4.5, 6 3, 8 3 C11 3, 13 5, 13 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13 8 C13 11.5, 10 13, 8 13 C5 13, 3 11, 3 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>`,
    'S': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-dasharray="2 1.5"/><polygon points="8,4 12,11 4,11" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/></svg>`,
    'S+': `<svg viewBox="-1 -1 18 18" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5 V14.5 M1.5 8 H14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polygon points="8,5 11,8 8,11 5,8" fill="currentColor"/></svg>`
  };

  let deckOverlayEl = null;
  let deckDrawerEl = null;
  let deckUserAvatarEl = null;
  let deckUserSerialEl = null;
  let deckUserNameEl = null;
  let deckForkTitleEl = null;
  let deckRankWatermarkIconEl = null;
  let deckResPctEl = null;
  let deckResBarEl = null;
  let deckMapStatusEl = null;
  let deckClueStatusEl = null;
  let deckTruthStatusEl = null;
  let deckEndingStatusEl = null;
  let deckIdentityTypeEl = null;
  let deckIdentityNameEl = null;
  // 战术态势双拼栏：任务推进 + 精神值
  let deckMissionCardEl = null;
  let deckMissionCountEl = null;
  let deckMissionFillEl = null;
  let deckMissionNoteEl = null;
  let deckSanCardEl = null;
  let deckSanValueEl = null;
  let deckSanFillEl = null;
  let deckSanNoteEl = null;
  // 战术能源电量环
  let deckBatteryMeterEl = null;
  let deckBatteryCircleEl = null;
  let deckBatteryNumEl = null;
  let deckBatteryBoltEl = null;
  // 解析度大卡与全景态势舱 DOM
  let deckResolutionCardEl = null;
  let resDashOverlayEl = null;
  let resDashPanelEl = null;
  let resDashBackBtnEl = null;
  let resDashPctEl = null;
  let resMeterCircleEl = null;
  let resMapStatEl = null;
  let resMapSvgEl = null;
  let resClueStatEl = null;
  let resClueListEl = null;
  /** 线索板是否手动展开（超过 4 条时生效，默认收起只展示前 4 条） */
  let isResCluesExpanded = false;
  let resTruthCardEl = null;
  let resTruthBadgeEl = null;
  let resTruthContentEl = null;
  let resEndingStatEl = null;
  let resEndingListEl = null;
  let isResDashOpen = false;
  // 身份档案快速编纂舱 (Pane 3) 状态与 DOM 引用
  let isIdentityEditOpen = false;
  let idnPaneEl = null;
  let idnTypeBadgeEl = null;
  let idnViewListEl = null;
  let idnNameLabelEl = null;
  let idnNameInputEl = null;
  let idnGenderInputEl = null;
  let idnProfileLabelEl = null;
  let idnProfileInputEl = null;
  let idnExtraInputEl = null;
  let idnSaveBtnEl = null;
  // 任务看板 (Pane 4) 状态与 DOM 引用
  let isMissionBoardOpen = false;
  let msbPaneEl = null;
  let msbBadgeEl = null;
  let msbListEl = null;
  let msbDoneNumEl = null;
  let msbOpenNumEl = null;
  let msbTotalNumEl = null;
  // 随行系统助手舱 (Pane 5) 状态。DOM 引用与渲染全在 fork-deck-asst.js 内，
  // 这里只持有开合态，供返回键 / 右滑手势逐级回退判定。
  let isAsstPaneOpen = false;
  // 精神值弹窗当前实时快照（供 SAN 说明卡按副本内实际值打开）
  let deckLatestSan = null;
  let deckLatestSanMax = 100;
  let isDeckOpen = false;

  function initDeckDrawerDOM() {
    if (deckOverlayEl) return;
    deckOverlayEl = document.getElementById('forkRunDeckOverlay');
    deckDrawerEl = document.getElementById('forkRunDeckDrawer');
    deckUserAvatarEl = document.getElementById('forkDeckUserAvatar');
    deckUserSerialEl = document.getElementById('forkDeckUserSerial');
    deckUserNameEl = document.getElementById('forkDeckUserName');
    deckForkTitleEl = document.getElementById('forkDeckForkTitle');
    deckRankWatermarkIconEl = document.getElementById('forkDeckRankWatermarkIcon');
    deckResPctEl = document.getElementById('forkDeckResPct');
    deckResBarEl = document.getElementById('forkDeckResBar');
    deckMapStatusEl = document.getElementById('forkDeckMapStatus');
    deckClueStatusEl = document.getElementById('forkDeckClueStatus');
    deckTruthStatusEl = document.getElementById('forkDeckTruthStatus');
    deckEndingStatusEl = document.getElementById('forkDeckEndingStatus');
    deckIdentityTypeEl = document.getElementById('forkDeckIdentityType');
    deckIdentityNameEl = document.getElementById('forkDeckIdentityName');
    deckMissionCardEl = document.getElementById('forkDeckMissionCard');
    deckMissionCountEl = document.getElementById('forkDeckMissionCount');
    deckMissionFillEl = document.getElementById('forkDeckMissionFill');
    deckMissionNoteEl = document.getElementById('forkDeckMissionNote');
    deckSanCardEl = document.getElementById('forkDeckSanCard');
    deckSanValueEl = document.getElementById('forkDeckSanValue');
    deckSanFillEl = document.getElementById('forkDeckSanFill');
    deckSanNoteEl = document.getElementById('forkDeckSanNote');
    deckBatteryMeterEl = document.querySelector('.fork-deck-battery-meter');
    deckBatteryCircleEl = document.getElementById('forkDeckBatteryCircle');
    deckBatteryNumEl = document.getElementById('forkDeckBatteryNum');
    deckBatteryBoltEl = document.getElementById('forkDeckBatteryBolt');

    // 解析度大卡与抽屉二级态势舱 DOM 元素获取
    deckResolutionCardEl = document.getElementById('forkDeckResolutionCard');
    resDashBackBtnEl = document.getElementById('forkResDashboardBackBtn');
    resDashPctEl = document.getElementById('forkResDashPct');
    resMeterCircleEl = document.getElementById('forkResMeterCircle');
    resMapStatEl = document.getElementById('forkResMapStat');
    resMapSvgEl = document.getElementById('forkResMapSvg');
    resClueStatEl = document.getElementById('forkResClueStat');
    resClueListEl = document.getElementById('forkResClueList');
    resTruthCardEl = document.getElementById('forkResTruthCard');
    resTruthBadgeEl = document.getElementById('forkResTruthBadge');
    resTruthContentEl = document.getElementById('forkResTruthContent');
    resEndingStatEl = document.getElementById('forkResEndingStat');
    resEndingListEl = document.getElementById('forkResEndingList');

    if (deckResolutionCardEl) {
      deckResolutionCardEl.style.cursor = 'pointer';
      deckResolutionCardEl.addEventListener('click', () => {
        openResDashboard();
      });
    }
    if (resDashBackBtnEl) {
      resDashBackBtnEl.addEventListener('click', () => {
        closeResDashboard();
      });
    }

    // 身份档案快速编纂舱 (Pane 3) DOM + 绑定
    idnPaneEl = document.getElementById('forkDeckIdentityPane');
    idnTypeBadgeEl = document.getElementById('forkDeckIdentityTypeBadge');
    idnViewListEl = document.getElementById('forkDeckIdentityViewList');
    idnNameLabelEl = document.getElementById('forkDeckIdentityNameLabel');
    idnNameInputEl = document.getElementById('forkDeckIdentityNameInput');
    idnGenderInputEl = document.getElementById('forkDeckIdentityGenderInput');
    idnProfileLabelEl = document.getElementById('forkDeckIdentityProfileLabel');
    idnProfileInputEl = document.getElementById('forkDeckIdentityProfileInput');
    idnExtraInputEl = document.getElementById('forkDeckIdentityExtraInput');
    idnSaveBtnEl = document.getElementById('forkDeckIdentitySaveBtn');
    const idnEntryBtn = document.getElementById('forkDeckIdentityBtn');
    const idnBackBtn = document.getElementById('forkDeckIdentityBackBtn');
    if (idnEntryBtn) {
      idnEntryBtn.addEventListener('click', () => { openIdentityEdit(); });
    }
    if (idnBackBtn) {
      idnBackBtn.addEventListener('click', () => { closeIdentityEdit(); });
    }
    if (idnSaveBtnEl) {
      idnSaveBtnEl.addEventListener('click', () => {
        Promise.resolve(saveIdentityEdit()).catch((err) => {
          console.warn('[ForkRun] 身份保存异常：', err);
        });
      });
    }

    // 任务看板 (Pane 4) DOM + 绑定。入口就是态势双拼栏里的「任务推进」卡
    msbPaneEl = document.getElementById('forkDeckMissionPane');
    msbBadgeEl = document.getElementById('forkDeckMissionBoardBadge');
    msbListEl = document.getElementById('forkDeckMissionBoardList');
    msbDoneNumEl = document.getElementById('forkMsbDoneNum');
    msbOpenNumEl = document.getElementById('forkMsbOpenNum');
    msbTotalNumEl = document.getElementById('forkMsbTotalNum');
    const msbBackBtn = document.getElementById('forkDeckMissionBackBtn');
    if (deckMissionCardEl) {
      deckMissionCardEl.addEventListener('click', () => { openMissionBoard(); });
    }
    if (msbBackBtn) {
      msbBackBtn.addEventListener('click', () => { closeMissionBoard(); });
    }

    // 呼叫助手：进 DECK 内的随行助手舱（Pane 5），不是全屏二级页
    const deckCallAsstBtn = document.getElementById('forkDeckCallAsstBtn');
    if (deckCallAsstBtn) {
      deckCallAsstBtn.addEventListener('click', () => { openAsstPane(); });
    }
    const asstBackBtn = document.getElementById('forkDeckAsstBackBtn');
    if (asstBackBtn) {
      asstBackBtn.addEventListener('click', () => { closeAsstPane(); });
    }


    // 精神值说明卡：复用观测档案的五档分级 HUD 浮层，用副本内实时 SAN 值打开
    if (deckSanCardEl) {
      deckSanCardEl.addEventListener('click', () => {
        if (window.PsychArchiveApp && typeof PsychArchiveApp.openSanityModal === 'function') {
          PsychArchiveApp.openSanityModal(typeof deckLatestSan === 'number' ? deckLatestSan : undefined);
        }
      });
    }

    // 编辑副本卷宗设定：收起 DECK 与推演页，进当前副本的编纂器；返回时叠回推演页正文。
    // 与 fork-run-settings 跳 API / 世界书同范式：dismiss 只收视图（不动 history / isOpened），
    // 返回时用 reveal 把推演页底层复原。编纂器 close() 会自然把 hash 退回 #fork-run，
    // 推演页 popstate 对 #fork-run 属白名单直接 return（不误关），栈里不多不少。
    // 关键：onClose 里绝不能再 open()——open 会重新 pushState #fork-run 并重跑视图分发，
    // 与编纂器返回的 hash 回退抢跑、逐次累积历史桩，正是「第二次点击闪两下弹回」的根因。
    const deckEditForkBtn = document.getElementById('forkDeckEditForkBtn');
    if (deckEditForkBtn) {
      deckEditForkBtn.addEventListener('click', () => {
        if (!currentForkId || !window.ForkEditorUI || typeof ForkEditorUI.open !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({ tag: 'DOSSIER // 不可用', message: '副本编纂器未就绪', type: 'warning' });
          }
          return;
        }
        const forkId = currentForkId;
        // 收 DECK 视图（不走 closeDeckDrawer 的 history.back —— 那是异步的，
        // 会与随后 ForkEditorUI.open 的同步 pushState 抢跑，导致第二次点击栈错位、
        // 编纂器刚开就被弹出的 popstate 关掉、落回推演页。这是「第二次失效」的真正根因）。
        // 正确做法：把 DECK 压的那层 #fork-run[fork-run-deck] 桩用 replaceState 原地
        // 改写成 #fork-editor，栈层数不变、无异步 back 竞争；返回时编纂器自己 back 一层
        // 即落回推演页首层（#fork-run[fork-run]），reveal 复原视图。
        if (deckOverlayEl && isDeckDrawerOpen()) {
          deckOverlayEl.classList.remove('is-active');
          deckOverlayEl.setAttribute('aria-hidden', 'true');
          isDeckOpen = false;
          resetDeckResolutionCard();
          setTimeout(() => {
            if (!isDeckOpen && deckOverlayEl) deckOverlayEl.hidden = true;
          }, 280);
        }
        try {
          // 把栈顶的 DECK 桩原地替换成编纂器桩：层数不变，避免 back 与 push 竞争。
          if (window.history.state && window.history.state.rfPage === 'fork-run-deck') {
            window.history.replaceState({ rfPage: 'fork-editor' }, '', '#fork-editor');
          }
        } catch (_) {}
        // 推演页与编纂器同为 z-index:900 全屏页且 DOM 靠后，跨页时先收起推演页视图，
        // 返回时用 onClose 回调把推演页叠回底层（reveal，纯视图不动 history）。
        api.dismiss();
        Promise.resolve(ForkEditorUI.open(forkId, {
          onClose: () => {
            if (window.ForkRunUI && typeof ForkRunUI.reveal === 'function') {
              ForkRunUI.reveal();
            }
          }
        })).catch((err) => {
          console.warn('[ForkRun] 打开副本编纂器失败：', forkId, err);
          // 打开失败：把推演页叠回来，避免用户卡在空白
          if (window.ForkRunUI && typeof ForkRunUI.reveal === 'function') ForkRunUI.reveal();
        });
      });
    }

    if (deckOverlayEl) {
      deckOverlayEl.addEventListener('click', (e) => {
        if (e.target === deckOverlayEl) {
          closeDeckDrawer();
        }
      });
    }

    // 抽屉分层右滑返回手势（对齐项目通用 initSwipeBackGesture 范式）：
    // 从左向右滑 > 72px 且纵向偏离不大 → 按当前层级逐级返回：
    //   身份舱开 → 滑回主控台；态势舱开 → 滑回主控台；都没开（主控台）→ 关整个抽屉。
    // 与系统边缘返回手势体验一致，逐级退栈。
    if (deckDrawerEl) {
      let touchStartX = 0;
      let touchStartY = 0;
      let isSwiping = false;
      let isHorizontal = false;
      let isDirectionLocked = false;

      deckDrawerEl.addEventListener('touchstart', (e) => {
        if (!isDeckOpen) return;
        if (e.touches && e.touches.length > 1) { isSwiping = false; return; }
        // 输入框/文本域内不劫持手势：身份舱的编辑框里要能正常选字与移动光标
        const tgt = e.target;
        if (tgt && tgt.closest && tgt.closest('input, textarea, select')) { isSwiping = false; return; }
        const t = e.touches && e.touches[0];
        if (!t) return;
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        isSwiping = true;
        isHorizontal = false;
        isDirectionLocked = false;
      }, { passive: true });

      deckDrawerEl.addEventListener('touchmove', (e) => {
        if (!isSwiping) return;
        const t = e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (!isDirectionLocked) {
          if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
            isDirectionLocked = true;
            // 向右滑动且水平位移明显大于纵向位移才认定为返回手势
            isHorizontal = dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2;
          }
        }
      }, { passive: true });

      deckDrawerEl.addEventListener('touchend', (e) => {
        if (!isSwiping) return;
        isSwiping = false;
        if (!isHorizontal) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        // 触发条件：从左向右滑动超过 72px 且纵向偏离不大
        if (dx > 72 && Math.abs(dy) < dx * 0.8) {
          // 逐级返回：随行助手舱 → 任务看板 → 身份舱 → 态势舱 → 整个抽屉
          if (isAsstPaneOpen) {
            closeAsstPane();
          } else if (isMissionBoardOpen) {
            closeMissionBoard();
          } else if (isIdentityEditOpen) {
            closeIdentityEdit();
          } else if (isResDashOpen) {
            closeResDashboard();
          } else {
            closeDeckDrawer();
          }
        }
      }, { passive: true });

      deckDrawerEl.addEventListener('touchcancel', () => {
        isSwiping = false;
      }, { passive: true });
    }
  }

  function isDeckDrawerOpen() {
    return isDeckOpen;
  }

  /**
   * 打开抽屉二级全景测绘与解析态势舱 (抽屉内滑轨平移)
   */
  function openResDashboard() {
    initDeckDrawerDOM();
    if (!deckDrawerEl) return;
    refreshResDashboardData();
    deckDrawerEl.classList.add('is-res-mode');
    isResDashOpen = true;
  }

  /**
   * 关闭抽屉二级态势舱，平滑滑回控制台主舱
   */
  function closeResDashboard(fromPopState = false) {
    if (!deckDrawerEl || !isResDashOpen) return;
    deckDrawerEl.classList.remove('is-res-mode');
    isResDashOpen = false;
    // 重置微型环形仪表，保证下次进场依然能播放炫酷充能自检
    resetResolutionMeter();
  }

  /* ================= 身份档案快速编纂舱 (Pane 3) ================= */

  // 身份类型 → 徽标文案（自由身份细分本体/马甲）
  function idnTypeLabel(mode) {
    if (mode === 'locked') return 'LOCKED';
    if (mode === 'mask') return 'FREE · 马甲';
    return 'FREE · 本体';
  }

  /**
   * 渲染身份舱：档案全貌（只读，含全字段）+ 三字段回填 + 额外设定回填。
   * 数据源与推演一致 —— 走 buildEnvoyCtx()，保证「看到的就是发给模型的」。
   */
  function renderIdentityEdit() {
    const ctx = buildEnvoyCtx();
    const mode = ctx.mode || 'persona';
    const isLocked = mode === 'locked';

    if (idnTypeBadgeEl) idnTypeBadgeEl.textContent = idnTypeLabel(mode);

    // 档案全貌（只读）：自由身份显示全字段，锁定角色显示其可有的字段
    if (idnViewListEl) {
      const rows = [];
      const push = (key, val) => {
        const v = trimStr(val);
        rows.push({ key, val: v || '—', muted: !v });
      };
      push(isLocked ? '角色' : '代号', ctx.name);
      push('性别', ctx.gender);
      if (!isLocked) push('诞生日', ctx.birthday);
      if (!isLocked) push('外貌', ctx.appearance);
      push(isLocked ? '角色设定' : '个人简介', ctx.profile);
      push('编号', ctx.serial ? ('NO.' + ctx.serial) : '');

      idnViewListEl.innerHTML = '';
      const frag = document.createDocumentFragment();
      rows.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'fork-idn-view-row';
        const k = document.createElement('span');
        k.className = 'fork-idn-view-key';
        k.textContent = r.key;
        const val = document.createElement('span');
        val.className = 'fork-idn-view-val' + (r.muted ? ' is-muted' : '');
        val.textContent = r.val;
        row.appendChild(k);
        row.appendChild(val);
        frag.appendChild(row);
      });
      idnViewListEl.appendChild(frag);
    }

    // 编辑区：三字段回填 + label 随身份切换
    if (idnNameLabelEl) idnNameLabelEl.textContent = isLocked ? '角色名' : '代号';
    if (idnProfileLabelEl) idnProfileLabelEl.textContent = isLocked ? '角色设定' : '个人简介';
    if (idnNameInputEl) idnNameInputEl.value = ctx.name || '';
    if (idnGenderInputEl) idnGenderInputEl.value = ctx.gender || '';
    if (idnProfileInputEl) idnProfileInputEl.value = ctx.profile || '';

    // 额外设定：读当前世界线的 identityExtra
    if (idnExtraInputEl) idnExtraInputEl.value = trimStr(currentRun && currentRun.identityExtra);
  }

  /**
   * 打开身份舱：与态势舱同轨，加 is-identity-mode 触发轨道平移到第三格 + 阶梯进场。
   * 打开前先渲染，保证滑入时内容已就位（阶梯动画作用在已填好的节点上）。
   * 不自己压 history 桩 —— 与态势舱 openResDashboard 完全同范式：复用 DECK 抽屉
   * 打开时已压的 fork-run-deck 桩，返回键 popstate 命中 isIdentityEditOpen 就滑回主控台，
   * 抽屉保持打开。多压一层会导致返回时栈错位、直接弹回推演页。
   */
  function openIdentityEdit() {
    initDeckDrawerDOM();
    if (!deckDrawerEl || !idnPaneEl) return;
    renderIdentityEdit();
    deckDrawerEl.classList.add('is-identity-mode');
    isIdentityEditOpen = true;
  }

  /**
   * 关闭身份舱，平滑滑回控制台主舱（与 closeResDashboard 同范式：只收 class，不动 history）。
   * 点返回按钮与 popstate 走同一路径 —— DECK 抽屉的 fork-run-deck 桩仍在，
   * 用户再按一次返回才收整个抽屉。
   */
  function closeIdentityEdit(fromPopState = false) {
    if (!deckDrawerEl || !isIdentityEditOpen) return;
    deckDrawerEl.classList.remove('is-identity-mode');
    isIdentityEditOpen = false;
  }

  /**
   * 保存身份：档案三字段写回原档案（按身份类型分流）+ 额外设定写回当前世界线，一并提交。
   *   本体 persona → Store.save('envoy.identity', 全量merge)    影响所有副本
   *   马甲 mask    → Store.save('envoy.masks', 整数组)           影响所有副本
   *   锁定 locked  → Store.saveForkDossier(forkId, 整卷宗)       影响本副本所有世界线
   *   额外设定     → ForkRunStore.updateRun(runId, {identityExtra})  仅当前世界线
   * 只改 name/gender/profile 三字段，其余（编号/生日/外貌/立绘/开场绑定等）原样保留。
   */
  async function saveIdentityEdit() {
    if (!window.Store) {
      if (window.RetroToast) RetroToast.show({ tag: 'IDENTITY // 不可用', message: '档案库未就绪', type: 'warning' });
      return;
    }
    const type = trimStr(currentRun && currentRun.identityType);
    const targetId = trimStr(currentRun && (currentRun.identityId || currentRun.maskId));
    const nextName = trimStr(idnNameInputEl && idnNameInputEl.value);
    const nextGender = trimStr(idnGenderInputEl && idnGenderInputEl.value);
    const nextProfile = trimStr(idnProfileInputEl && idnProfileInputEl.value);
    const nextExtra = trimStr(idnExtraInputEl && idnExtraInputEl.value);

    if (idnSaveBtnEl) idnSaveBtnEl.disabled = true;
    try {
      // 1. 档案三字段写回（按身份类型分流）
      if ((type === 'preset' || type === 'locked') && currentFork && Array.isArray(currentFork.lockedRoles)) {
        // 锁定角色：改本副本卷宗里命中的那个角色，仅动三字段，其余（id/avatar/appearance/绑定）保留
        const role = currentFork.lockedRoles.find((r) => r && String(r.id) === targetId);
        if (role) {
          role.name = nextName;
          role.gender = nextGender;
          role.profile = nextProfile;
          if (typeof Store.saveForkDossier === 'function') {
            await Store.saveForkDossier(currentForkId, currentFork);
          }
        }
      } else if (type === 'mask' && targetId && Store.envoy && Array.isArray(Store.envoy.masks)) {
        // 马甲：整数组存回，仅动命中项三字段
        const masks = Store.envoy.masks.map((m) => Object.assign({}, m));
        const hit = masks.find((m) => m && String(m.id) === targetId);
        if (hit) {
          hit.name = nextName;
          hit.gender = nextGender;
          hit.profile = nextProfile;
          if (typeof Store.save === 'function') {
            await Store.save('envoy.masks', masks);
          }
        }
      } else {
        // 本体 persona：取现有全量 merge 三字段（save 的 set 会整体替换，必须带全字段回存）
        const cur = (Store.envoy && Store.envoy.identity) ? Object.assign({}, Store.envoy.identity) : {};
        cur.name = nextName;
        cur.gender = nextGender;
        cur.profile = nextProfile;
        if (typeof Store.save === 'function') {
          await Store.save('envoy.identity', cur);
        }
      }

      // 2. 额外设定写回当前世界线（仅本窗口生效，不碰全局档案）
      if (currentRun) currentRun.identityExtra = nextExtra;
      if (currentRunId && window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
        await ForkRunStore.updateRun(currentRunId, { identityExtra: nextExtra });
      }

      // 3. 刷新 DECK 身份卡显示（名字可能改了），并重渲染舱内全貌
      if (typeof refreshDeckDrawerData === 'function') {
        try { refreshDeckDrawerData(); } catch (_) {}
      }
      renderIdentityEdit();

      if (window.RetroToast) {
        RetroToast.show({ tag: 'IDENTITY // 已提交', message: '身份档案已保存', type: 'info' });
      }
      closeIdentityEdit();
    } catch (err) {
      console.warn('[ForkRun] 身份保存失败：', err);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'IDENTITY // 失败', message: '保存未完成，请重试', type: 'error' });
      }
    } finally {
      if (idnSaveBtnEl) idnSaveBtnEl.disabled = false;
    }
  }

  /* ================= 任务看板 (Pane 4) =================
     DECK「任务推进」卡的点开目标。列出本副本全部主线任务的三态：
       · 已完成 (achieved)  — 持久态，划掉目标、整卡压暗
       · 推进中 (已解锁未完成) — 左缘金条标出当下焦点
       · 锁定   (前置未达成)   — 目标遮成 ???，只露解锁条件
     锁定态存在的意义：交代「全部 5 条、当前只下发 3 条」这个落差，
     否则玩家看主控台计数会以为少了两条。 */

  const MSB_ICONS = {
    done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>',
    active: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
    locked: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm3 12c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',
    gate: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2L2 7v6c0 5.55 3.84 10.74 10 12 6.16-1.26 10-6.45 10-12V7L12 2zm0 10.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5-1.5-.67-1.5-1.5.67-1.5 1.5-1.5zm0-6c.83 0 1.5.67 1.5 1.5v2c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5v-2c0-.83.67-1.5 1.5-1.5z"/></svg>',
    empty: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg>'
  };

  /**
   * 渲染任务看板：按卷宗顺序列出全部任务，依解锁/完成态分三档。
   * 数据源都是本地同步态（卷宗 clearConditions + run.missions），不读库。
   */
  function renderMissionBoard() {
    if (!msbListEl) return;
    const list = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    const valid = list.filter((m) => m && trimStr(m.id));
    const state = getMissionState();
    const unlocked = computeUnlockedMissionIds();

    const totalCount = valid.length;
    const doneCount = valid.filter((m) => state[trimStr(m.id)] && state[trimStr(m.id)].achieved).length;
    const openCount = valid.filter((m) => unlocked.has(trimStr(m.id))).length;

    if (msbDoneNumEl) msbDoneNumEl.textContent = String(doneCount);
    if (msbOpenNumEl) msbOpenNumEl.textContent = String(openCount);
    if (msbTotalNumEl) msbTotalNumEl.textContent = String(totalCount);
    if (msbBadgeEl) msbBadgeEl.textContent = `${doneCount}/${totalCount}`;

    msbListEl.innerHTML = '';
    if (!totalCount) {
      const empty = document.createElement('div');
      empty.className = 'fork-msb-empty';
      empty.innerHTML = `
        ${MSB_ICONS.empty}
        <span class="fork-msb-empty-en">NO OBJECTIVE ASSIGNED</span>
        <span class="fork-msb-empty-zh">本副本未下发主线任务</span>
      `;
      msbListEl.appendChild(empty);
      return;
    }

    // 解锁条件文案：把前置任务的卷宗序号列出来（不露前置任务内容，只给坐标）
    const codeById = new Map();
    valid.forEach((m, i) => {
      codeById.set(trimStr(m.id), `MISSION-${String(i + 1).padStart(2, '0')}`);
    });

    valid.forEach((item, index) => {
      const id = trimStr(item.id);
      const st = state[id];
      const isDone = !!(st && st.achieved);
      const isUnlocked = unlocked.has(id);
      const isLocked = !isUnlocked;
      const code = `MISSION-${String(index + 1).padStart(2, '0')}`;

      let stateCls = 'is-active';
      let badgeCls = 'is-active';
      let badgeIcon = MSB_ICONS.active;
      let badgeText = '推进中';
      if (isDone) {
        stateCls = 'is-done';
        badgeCls = 'is-done';
        badgeIcon = MSB_ICONS.done;
        badgeText = '已完成';
      } else if (isLocked) {
        stateCls = 'is-locked';
        badgeCls = 'is-locked';
        badgeIcon = MSB_ICONS.locked;
        badgeText = '未解锁';
      }

      // 目标正文：锁定态显示占位文案，不透题
      let goalHtml;
      if (isLocked) {
        goalHtml = `<div class="fork-msb-item-goal is-masked">此任务尚未解锁</div>`;
      } else {
        const goal = trimStr(item.goal) || trimStr(item.text) || '未指明具体作战目标';
        goalHtml = `<div class="fork-msb-item-goal${isDone ? ' is-done' : ''}">${escapeHtml(goal)}</div>`;
      }

      // 解锁条件：仅锁定态显示，点明要先完成哪几条（给坐标不给内容）
      let gateHtml = '';
      if (isLocked) {
        const prereqs = Array.isArray(item.prereqIds) ? item.prereqIds.map(trimStr).filter(Boolean) : [];
        const codes = prereqs.map((pid) => codeById.get(pid)).filter(Boolean);
        let gateText;
        if (!codes.length) {
          // 前置全部失效（指向已删任务）：这条永远开不了，如实告知
          gateText = '解锁条件已失效，本任务不会下发';
        } else if (codes.length === 1) {
          gateText = `需先完成 ${codes[0]}`;
        } else if (item.prereqLogic === 'any') {
          gateText = `需完成 ${codes.join(' / ')} 中任一项`;
        } else {
          gateText = `需先完成 ${codes.join('、')}`;
        }
        gateHtml = `
          <div class="fork-msb-item-gate">
            ${MSB_ICONS.gate}
            <span>${escapeHtml(gateText)}</span>
          </div>
        `;
      }

      const card = document.createElement('div');
      card.className = `fork-msb-item ${stateCls}`;
      card.innerHTML = `
        <div class="fork-msb-item-head">
          <span class="fork-msb-item-code">${code}</span>
          <span class="fork-msb-item-badge ${badgeCls}">${badgeIcon}${badgeText}</span>
        </div>
        ${goalHtml}
        ${gateHtml}
      `;
      msbListEl.appendChild(card);
    });
  }

  /**
   * 打开任务看板：与态势舱 / 身份舱同轨，加 is-mission-mode 平移到第四格。
   * 不压 history 桩（靠 DECK 抽屉那层 fork-run-deck 桩），与态势舱范式一致。
   */
  function openMissionBoard() {
    initDeckDrawerDOM();
    if (!deckDrawerEl) return;
    renderMissionBoard();
    deckDrawerEl.classList.add('is-mission-mode');
    isMissionBoardOpen = true;
  }

  /** 关闭任务看板：只收 class 滑回主控台，不动 history（抽屉保持打开） */
  function closeMissionBoard() {
    if (!deckDrawerEl) return;
    deckDrawerEl.classList.remove('is-mission-mode');
    isMissionBoardOpen = false;
  }

  /* ================= 随行系统助手舱 (Pane 5) ================= */

  /**
   * 打开随行助手舱：与任务看板同轨 —— 加 is-asst-mode 触发轨道平移到第五格，
   * 不自己压 history 桩（复用 DECK 抽屉打开时压的 fork-run-deck 桩，返回键
   * popstate 命中 isAsstPaneOpen 就滑回主控台）。多压一层会导致返回时栈错位。
   * 渲染、历史与发送全在 ForkDeckAsst 内部，本函数只负责轨道与开合态。
   */
  function openAsstPane() {
    initDeckDrawerDOM();
    if (!deckDrawerEl) return;
    // 先切轨道（视觉即时响应），历史异步渲染（要等对话就绪 + 读流水）
    deckDrawerEl.classList.add('is-asst-mode');
    isAsstPaneOpen = true;
    if (window.ForkDeckAsst && typeof ForkDeckAsst.open === 'function') {
      ForkDeckAsst.open().catch(function (err) {
        console.warn('[ForkRun] 随行助手舱打开失败：', err);
      });
    }
  }

  /** 关闭随行助手舱：只收 class 滑回主控台，不动 history（抽屉保持打开）。 */
  function closeAsstPane() {
    if (!deckDrawerEl) return;
    deckDrawerEl.classList.remove('is-asst-mode');
    isAsstPaneOpen = false;
    if (window.ForkDeckAsst && typeof ForkDeckAsst.close === 'function') {
      try { ForkDeckAsst.close(); } catch (_) {}
    }
  }

  /**
   * 从 DECK 助手舱跳对话设置页。
   *
   * 设置页 z-index 仅 1200，远低于 DECK 抽屉遮罩（10500），直接 open 会被抽屉盖住。
   * 所以先纯视图收起抽屉（不走 closeDeckDrawer 的异步 history.back —— 那会与设置页
   * 的 pushState 抢跑，是「跨页第二次失效」的老坑），再把栈顶那层 fork-run-deck 桩
   * 用 replaceState 原地改写回 fork-run 层：栈层数不变、无竞态（设置页 open 自己会
   * 再 pushState 一层设置桩叠上去）。
   *
   * 返回：设置页 popstate 收起自己后，栈顶弹回 fork-run 层，推演页 popstate 命中
   * hash 白名单（#fork-run）直接 return，用户稳稳落在推演页主体 —— 符合「设置返回
   * 回推演页」的预期（不回 DECK 抽屉，抽屉已随本次跳转收起）。
   */
  function openAsstSettings() {
    if (!window.SystemChatSettings || typeof SystemChatSettings.open !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'SETTINGS // 不可用', message: '对话设置模块未就绪', type: 'warning' });
      }
      return;
    }
    // 1. 纯视图收起整个 DECK 抽屉（含助手舱轨道态），不触碰 history
    if (deckOverlayEl && isDeckOpen) {
      deckOverlayEl.classList.remove('is-active');
      deckOverlayEl.setAttribute('aria-hidden', 'true');
      isDeckOpen = false;
      isAsstPaneOpen = false;
      if (deckDrawerEl) deckDrawerEl.classList.remove('is-asst-mode');
      if (window.ForkDeckAsst && typeof ForkDeckAsst.close === 'function') {
        try { ForkDeckAsst.close(); } catch (_) {}
      }
      setTimeout(() => {
        if (!isDeckOpen && deckOverlayEl) deckOverlayEl.hidden = true;
      }, 280);
    }
    // 2. 把栈顶 DECK 桩原地替换成设置页桩：层数不变，避免 back 与 push 竞争。
    //    （openSettings 自己还会再 pushState 一层设置桩，所以这里先把 deck 桩改掉，
    //     否则会多留一层 fork-run-deck 孤儿桩，退出推演时要多按一次返回。）
    try {
      if (window.history.state && window.history.state.rfPage === 'fork-run-deck') {
        window.history.replaceState({ rfPage: 'fork-run' }, '', '#fork-run');
      }
    } catch (_) {}
    // 3. 开设置页（它内部会 pushState #system-chat/settings，叠在 fork-run 之上）
    SystemChatSettings.open();
  }

  let resMeterAnimTimer = null;
  let resMeterDelayTimer = null;
  /**
   * 动态驱动顶栏环形进度仪表：电光充能与数字跳频自检动画
   */
  function animateResolutionMeter(targetPct) {
    const validPct = Math.min(100, Math.max(0, Math.round(Number(targetPct) || 0)));
    const perimeter = 87.96; // 2 * π * 14
    const targetOffset = perimeter - (perimeter * (validPct / 100));

    if (resMeterAnimTimer) {
      cancelAnimationFrame(resMeterAnimTimer);
      resMeterAnimTimer = null;
    }
    if (resMeterDelayTimer) {
      clearTimeout(resMeterDelayTimer);
      resMeterDelayTimer = null;
    }

    // 1. 立即重置为 0 状态
    if (resMeterCircleEl) {
      resMeterCircleEl.style.transition = 'none';
      resMeterCircleEl.style.strokeDashoffset = String(perimeter);
    }
    if (resDashPctEl) {
      resDashPctEl.textContent = '0';
    }

    // 2. 错峰起跑：等待 120ms (等顶栏飞升入位且透明度清晰)，让人眼明确捕捉从 0 起步
    resMeterDelayTimer = setTimeout(() => {
      resMeterDelayTimer = null;

      // 环形充能弧：0.58s 的平滑 cubic-bezier 曲线
      if (resMeterCircleEl) {
        resMeterCircleEl.style.transition = 'stroke-dashoffset 0.58s cubic-bezier(0.25, 1, 0.4, 1)';
        resMeterCircleEl.style.strokeDashoffset = String(targetOffset);
      }

      // 数字跳频自检：先平缓起跑、中段爆发、尾部咬合 (0.58s)
      const startTime = performance.now();
      const duration = 580;

      function easeInOutCubic(x) {
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
      }

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        const eased = easeInOutCubic(progress);
        const currentVal = Math.round(eased * validPct);

        if (resDashPctEl) {
          resDashPctEl.textContent = String(currentVal);
        }

        if (progress < 1) {
          resMeterAnimTimer = requestAnimationFrame(step);
        } else {
          resMeterAnimTimer = null;
          if (resDashPctEl) resDashPctEl.textContent = String(validPct);
        }
      }

      resMeterAnimTimer = requestAnimationFrame(step);
    }, 120);
  }

  /**
   * 归位重置微型环形仪表
   */
  function resetResolutionMeter() {
    if (resMeterDelayTimer) {
      clearTimeout(resMeterDelayTimer);
      resMeterDelayTimer = null;
    }
    if (resMeterAnimTimer) {
      cancelAnimationFrame(resMeterAnimTimer);
      resMeterAnimTimer = null;
    }
    if (resMeterCircleEl) {
      resMeterCircleEl.style.transition = 'none';
      resMeterCircleEl.style.strokeDashoffset = '87.96';
    }
    if (resDashPctEl) {
      resDashPctEl.textContent = '0';
    }
  }

  /**
   * 刷新全景解析态势舱各模块内容
   */
  function refreshResDashboardData() {
    initDeckDrawerDOM();
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    const clueState = (currentRun && currentRun.clues) || {};
    const unlockedCluesCount = forkClues.filter((c) => {
      const cid = trimStr(c && c.id);
      return clueState[cid] && clueState[cid].status === 'unlocked';
    }).length;
    const totalClues = forkClues.length;

    const hasTruth = !!(currentFork && currentFork.hiddenTruth && currentFork.hiddenTruth.desc);
    const truthUnlocked = !!(currentRun && currentRun.truthUnlocked);

    const forkEndings = (currentFork && Array.isArray(currentFork.endings)) ? currentFork.endings : [];
    const totalEndings = forkEndings.length;
    const endingSettled = !!(currentRun && currentRun.endingSettled);

    const forkLocations = (currentFork && Array.isArray(currentFork.locations)) ? currentFork.locations : [];
    const totalLocations = forkLocations.length;
    const visitedLocIds = (currentRun && Array.isArray(currentRun.visitedLocationIds)) ? currentRun.visitedLocationIds : [];
    const visitedLocCount = forkLocations.filter((loc) => visitedLocIds.includes(trimStr(loc && loc.id))).length;

    // 综合解析度得分
    let calculatedScore = 0;
    if (totalClues > 0) calculatedScore += (unlockedCluesCount / totalClues) * 40;
    else calculatedScore += 40;
    if (hasTruth) {
      if (truthUnlocked) calculatedScore += 25;
    } else calculatedScore += 25;
    if (totalEndings > 0) {
      if (endingSettled) {
        const GRADE_WEIGHT = { full: 1, major: 0.8, partial: 0.6, faint: 0.4 };
        const hitEnding = forkEndings.find((ed) => trimStr(ed && ed.id) === trimStr(currentRun.endingId));
        const gradeKey = (hitEnding && GRADE_WEIGHT[hitEnding.grade] != null) ? hitEnding.grade : 'full';
        calculatedScore += 20 * GRADE_WEIGHT[gradeKey];
      }
    } else calculatedScore += 20;
    if (totalLocations > 0) calculatedScore += (visitedLocCount / totalLocations) * 15;
    else calculatedScore += 15;
    const finalPct = Math.min(100, Math.max(0, Math.round(calculatedScore)));

    // 动态驱动微型环形仪表：充能弧线 + 数字飞速跳频动画 (0 ~ finalPct)
    animateResolutionMeter(finalPct);

    // 1. 地图绘制
    if (resMapStatEl) resMapStatEl.textContent = totalLocations > 0 ? `${visitedLocCount}/${totalLocations}` : '未录入';
    renderDashboardMap(forkLocations, visitedLocIds);

    // 2. 线索矩阵渲染
    if (resClueStatEl) resClueStatEl.textContent = `${unlockedCluesCount}/${totalClues}`;
    renderDashboardClues(forkClues, clueState);

    // 3. 核心真相渲染
    renderDashboardTruth(currentFork && currentFork.hiddenTruth, truthUnlocked);

    // 4. 结局分支渲染
    if (resEndingStatEl) resEndingStatEl.textContent = endingSettled ? '1/1' : `0/${totalEndings || 1}`;
    renderDashboardEndings(forkEndings, currentRun && currentRun.endingSettled ? currentRun.endingId : null);
  }

  /**
   * 渲染态势舱拟真沙盘地图 (SVG 斜向不规则测绘 + 点亮高光波圈)
   */
  function renderDashboardMap(locations, visitedIds) {
    if (!resMapSvgEl) return;
    resMapSvgEl.innerHTML = '';

    const container = resMapSvgEl.parentElement || resMapSvgEl;
    const width = Math.max(300, container.clientWidth || 360);
    const height = Math.max(180, container.clientHeight || 220);
    const ns = 'http://www.w3.org/2000/svg';

    resMapSvgEl.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const centerX = width / 2;
    const centerY = height / 2;

    // 1. 倾斜 -18 度网格背景
    const gridGroup = document.createElementNS(ns, 'g');
    gridGroup.setAttribute('transform', `rotate(-18 ${centerX} ${centerY})`);

    const vSteps = [-120, -70, -20, 30, 80, 130, 180, 230, 280, 330, 380, 430, 480, 530];
    vSteps.forEach((x, idx) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x);
      line.setAttribute('y1', -150);
      line.setAttribute('x2', x);
      line.setAttribute('y2', height + 150);
      const isMajor = idx % 3 === 0;
      line.setAttribute('stroke', 'var(--decor-color)');
      line.setAttribute('stroke-width', isMajor ? '0.8' : '0.4');
      line.setAttribute('stroke-opacity', isMajor ? '0.15' : '0.06');
      gridGroup.appendChild(line);
    });

    const hSteps = [-100, -50, 0, 50, 100, 150, 200, 250, 300];
    hSteps.forEach((y, idx) => {
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', -150);
      line.setAttribute('y1', y);
      line.setAttribute('x2', width + 150);
      line.setAttribute('y2', y);
      const isMajor = idx % 2 === 0;
      line.setAttribute('stroke', 'var(--decor-color)');
      line.setAttribute('stroke-width', isMajor ? '0.8' : '0.4');
      line.setAttribute('stroke-opacity', isMajor ? '0.15' : '0.06');
      gridGroup.appendChild(line);
    });
    resMapSvgEl.appendChild(gridGroup);

    // 2. 地点散布点位
    const locs = Array.isArray(locations) ? locations : [];
    if (locs.length === 0) {
      const emptyText = document.createElementNS(ns, 'text');
      emptyText.setAttribute('x', String(centerX));
      emptyText.setAttribute('y', String(centerY + 4));
      emptyText.setAttribute('text-anchor', 'middle');
      emptyText.setAttribute('font-family', 'var(--mono-font, monospace)');
      emptyText.setAttribute('font-size', '11');
      emptyText.setAttribute('fill', 'rgba(237, 235, 221, 0.4)');
      emptyText.textContent = 'NO LOCUS DATA // 暂无空间测绘坐标';
      resMapSvgEl.appendChild(emptyText);
      return;
    }

    // 4 列 4 行骨架：中文地名标签宽度可达一整格，列数过多必然导致标签互相侵入，
    // 故降列增行把横向空间让给文字。
    const PATTERN = [
      { c: 0, r: 1 }, { c: 3, r: 0 }, { c: 1, r: 3 }, { c: 2, r: 2 },
      { c: 3, r: 2 }, { c: 0, r: 3 }, { c: 2, r: 0 }, { c: 1, r: 1 },
      { c: 3, r: 3 }, { c: 0, r: 0 }, { c: 2, r: 3 }, { c: 1, r: 2 },
      { c: 3, r: 1 }, { c: 0, r: 2 }, { c: 2, r: 1 }, { c: 1, r: 0 }
    ];
    const COLS = 4;
    const ROWS = 4;
    const MARGIN_X = 30;
    const MARGIN_Y = 26;
    const cellW = (width - MARGIN_X * 2) / COLS;
    const cellH = (height - MARGIN_Y * 2) / ROWS;
    const LABEL_FONT = 9.5;   // 标签字号（与下方 text font-size 保持一致）
    const LABEL_MAX_CH = 7;   // 超长地名截断字数，避免单标签横跨半张图

    // 确定性伪随机：同一地点每次渲染必得同一坐标（不会每次打开乱跳），
    // 但不同地点之间的散布看起来杂乱自然，彻底打散行列对齐的表格感。
    const hashSeed = (str) => {
      let h = 2166136261;
      const s = String(str || '');
      for (let k = 0; k < s.length; k++) {
        h ^= s.charCodeAt(k);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    // 由种子派生 [0, 1) 区间的稳定随机数，channel 用于取不同维度的独立值
    const seedRand = (seed, channel) => {
      let x = (seed + channel * 0x9E3779B9) >>> 0;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return (x >>> 8) / 16777216;
    };

    // ── 第一遍：算出每个节点的初始散布坐标与标签尺寸 ──
    // 横向抖动收窄（保护标签左右空间），纵向放大（错落感由纵向承担，单行标签不怕挤）
    const nodes = locs.map((loc, i) => {
      const cell = PATTERN[i % PATTERN.length];
      const lid = trimStr(loc && loc.id);
      const rawName = trimStr(loc && loc.name);
      const seed = hashSeed(lid || rawName || `loc-${i}`);
      const shown = rawName
        ? (rawName.length > LABEL_MAX_CH ? `${rawName.slice(0, LABEL_MAX_CH)}…` : rawName)
        : `LOC-${String(i + 1).padStart(2, '0')}`;
      return {
        loc,
        index: i,
        lid,
        shown,
        isVisited: Array.isArray(visitedIds) && visitedIds.includes(lid),
        cx: MARGIN_X + cell.c * cellW + cellW * 0.5 + (seedRand(seed, 1) - 0.5) * 0.36 * cellW,
        cy: MARGIN_Y + cell.r * cellH + cellH * 0.5 + (seedRand(seed, 2) - 0.5) * 0.84 * cellH,
        dotR: 3.6 + seedRand(seed, 3) * 1.0,      // 3.6 ~ 4.6
        rippleR: 9 + seedRand(seed, 4) * 3,        // 9 ~ 12
        labelW: shown.length * LABEL_FONT * 1.02,
        labelH: LABEL_FONT * 1.4,
        above: false                               // true 时标签翻到圆点上方
      };
    });

    // ── 第二遍：标签级碰撞疏散 (relaxation) ──
    // 圆点不重叠不等于文字不重叠，这里按标签矩形两两检测，重叠则沿成本更低的轴互推
    const labelRect = (n) => {
      const ly = n.above ? n.cy - 10 : n.cy + 16;
      return { x1: n.cx - n.labelW / 2, x2: n.cx + n.labelW / 2, y1: ly - n.labelH, y2: ly };
    };
    const isOverlap = (a, b) => {
      const A = labelRect(a);
      const B = labelRect(b);
      return !(A.x2 < B.x1 || B.x2 < A.x1 || A.y2 < B.y1 || B.y2 < A.y1);
    };
    const PAD_X = 4;
    const PAD_Y = 3;
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const A = nodes[a];
          const B = nodes[b];
          if (!isOverlap(A, B)) continue;
          moved = true;
          const needX = (A.labelW + B.labelW) / 2 + PAD_X - Math.abs(A.cx - B.cx);
          const needY = (A.labelH + PAD_Y + 10) - Math.abs(A.cy - B.cy);
          if (needY <= needX) {
            const push = needY / 2 + 0.5;
            const dir = (A.cy <= B.cy) ? -1 : 1;
            A.cy += dir * push;
            B.cy -= dir * push;
          } else {
            const push = needX / 2 + 0.5;
            const dir = (A.cx <= B.cx) ? -1 : 1;
            A.cx += dir * push;
            B.cx -= dir * push;
          }
          // 夹回画布安全区，防止推出边界
          [A, B].forEach((n) => {
            n.cx = Math.max(n.labelW / 2 + 4, Math.min(width - n.labelW / 2 - 4, n.cx));
            n.cy = Math.max(14, Math.min(height - 22, n.cy));
          });
        }
      }
      if (!moved) break;
    }
    // 兜底：疏散后仍解不开的，把标签翻到圆点上方错开层级
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        if (isOverlap(nodes[a], nodes[b])) nodes[b].above = !nodes[b].above;
      }
    }

    // ── 第三遍：落地绘制 ──
    nodes.forEach((node) => {
      const { loc, cx, cy, dotR, rippleR, isVisited, shown, above } = node;
      const labelY = above ? cy - 10 : cy + 16;

      const nodeGroup = document.createElementNS(ns, 'g');

      if (isVisited) {
        // 已点亮：扩散高光圈 + 纯暗金实心核
        const ripple = document.createElementNS(ns, 'circle');
        ripple.setAttribute('cx', String(cx));
        ripple.setAttribute('cy', String(cy));
        ripple.setAttribute('r', String(rippleR.toFixed(2)));
        ripple.setAttribute('fill', 'none');
        ripple.setAttribute('stroke', 'var(--decor-color)');
        ripple.setAttribute('stroke-width', '0.8');
        ripple.setAttribute('opacity', '0.45');
        nodeGroup.appendChild(ripple);

        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', String(cy));
        dot.setAttribute('r', String(dotR.toFixed(2)));
        dot.setAttribute('fill', 'var(--decor-color)');
        nodeGroup.appendChild(dot);

        // 文字高亮
        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', String(cx.toFixed(2)));
        label.setAttribute('y', String(labelY.toFixed(2)));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', String(LABEL_FONT));
        label.setAttribute('font-weight', '700');
        label.setAttribute('fill', 'var(--bg-color)');
        label.textContent = shown;
        nodeGroup.appendChild(label);
      } else {
        // 未点亮：虚线空心暗环 + 低透明度地名
        const dot = document.createElementNS(ns, 'circle');
        dot.setAttribute('cx', String(cx));
        dot.setAttribute('cy', String(cy));
        dot.setAttribute('r', String((dotR - 0.4).toFixed(2)));
        dot.setAttribute('fill', 'none');
        dot.setAttribute('stroke', 'rgba(237, 235, 221, 0.3)');
        dot.setAttribute('stroke-dasharray', '2 1.5');
        dot.setAttribute('stroke-width', '1');
        nodeGroup.appendChild(dot);

        const label = document.createElementNS(ns, 'text');
        label.setAttribute('x', String(cx.toFixed(2)));
        label.setAttribute('y', String(labelY.toFixed(2)));
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('font-size', String(LABEL_FONT));
        label.setAttribute('font-weight', '600');
        label.setAttribute('fill', 'rgba(237, 235, 221, 0.32)');
        label.textContent = shown;
        nodeGroup.appendChild(label);
      }

      resMapSvgEl.appendChild(nodeGroup);
    });
  }

  /**
   * 渲染战术线索板（超过 4 条时提供机能展开/收起能力，页面统一滚动，拒绝卡手嵌套）
   */
  function renderDashboardClues(clues, clueState) {
    if (!resClueListEl) return;
    resClueListEl.innerHTML = '';

    if (!Array.isArray(clues) || clues.length === 0) {
      resClueListEl.innerHTML = `
        <div class="fork-res-truth-locked-box">
          <span class="fork-res-truth-locked-title">NO CLUES DEFINED</span>
          <span class="fork-res-truth-locked-desc">本副本未配置现场线索侦测模块</span>
        </div>
      `;
      return;
    }

    const PREVIEW_LIMIT = 4;
    const totalCount = clues.length;
    const needToggle = totalCount > PREVIEW_LIMIT;
    const renderList = (needToggle && !isResCluesExpanded)
      ? clues.slice(0, PREVIEW_LIMIT)
      : clues;

    renderList.forEach((c, idx) => {
      const cid = trimStr(c && c.id);
      const isUnlocked = clueState[cid] && clueState[cid].status === 'unlocked';
      const item = document.createElement('div');
      item.className = `fork-res-clue-item ${isUnlocked ? 'is-unlocked' : 'is-locked'}`;

      const lockSvg = isUnlocked
        ? `<svg class="fork-res-clue-lock-icon" viewBox="0 0 24 24"><path d="M12 17c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm6-9h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm0 12H6V10h12v10z"/></svg>`
        : `<svg class="fork-res-clue-lock-icon" viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`;

      if (isUnlocked) {
        item.innerHTML = `
          <div class="fork-res-clue-top">
            <div class="fork-res-clue-title-wrap">
              <span class="fork-res-clue-code">CLUE-${String(idx + 1).padStart(2, '0')}</span>
              <span class="fork-res-clue-name">${escapeHtml(c.name || '未命名线索')}</span>
            </div>
            ${lockSvg}
          </div>
          <div class="fork-res-clue-detail">${escapeHtml(c.desc || '已取得该线索情报证据。')}</div>
        `;
      } else {
        item.innerHTML = `
          <div class="fork-res-clue-top">
            <div class="fork-res-clue-title-wrap">
              <span class="fork-res-clue-code">CLUE-${String(idx + 1).padStart(2, '0')}</span>
              <span class="fork-res-clue-name" style="opacity: 0.45;">线索未解锁</span>
            </div>
            ${lockSvg}
          </div>
          <div class="fork-res-clue-locked-hint">此线索尚未查明</div>
        `;
      }
      resClueListEl.appendChild(item);
    });

    // 超过 4 条时注入机能展开/收起按钮
    if (needToggle) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'fork-res-clue-toggle-btn';

      if (!isResCluesExpanded) {
        const hiddenCount = totalCount - PREVIEW_LIMIT;
        // 探测隐藏区是否有已解锁线索
        const hiddenClues = clues.slice(PREVIEW_LIMIT);
        const hasHiddenUnlocked = hiddenClues.some((c) => {
          const cid = trimStr(c && c.id);
          return clueState[cid] && clueState[cid].status === 'unlocked';
        });

        toggleBtn.innerHTML = `
          <span>展开其余 ${hiddenCount} 条线索${hasHiddenUnlocked ? ' · <strong class="is-highlight">含已解明</strong>' : ''}</span>
          <svg class="fork-res-clue-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 10l5 5 5-5z"/>
          </svg>
        `;
      } else {
        toggleBtn.innerHTML = `
          <span>收起线索板</span>
          <svg class="fork-res-clue-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 14l5-5 5 5z"/>
          </svg>
        `;
      }

      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        isResCluesExpanded = !isResCluesExpanded;
        renderDashboardClues(clues, clueState);
      });

      resClueListEl.appendChild(toggleBtn);
    }
  }

  /**
   * 渲染核心真相解明卡
   */
  function renderDashboardTruth(truth, isUnlocked) {
    if (!resTruthContentEl || !resTruthBadgeEl) return;
    resTruthContentEl.innerHTML = '';

    if (!truth || !truth.desc) {
      resTruthBadgeEl.textContent = '无配置';
      resTruthBadgeEl.className = 'fork-res-card-badge';
      resTruthContentEl.innerHTML = `
        <div class="fork-res-truth-locked-box">
          <span class="fork-res-truth-locked-title">NO TRUTH RECORDED</span>
          <span class="fork-res-truth-locked-desc">本副本无需解明因果核心真相</span>
        </div>
      `;
      return;
    }

    if (isUnlocked) {
      resTruthBadgeEl.textContent = '已解明';
      resTruthBadgeEl.className = 'fork-res-card-badge is-unveiled';
      resTruthContentEl.innerHTML = `
        <div class="fork-res-truth-unveiled-box">
          <div class="fork-res-truth-text">${escapeHtml(truth.desc)}</div>
        </div>
      `;
    } else {
      resTruthBadgeEl.textContent = '未解明';
      resTruthBadgeEl.className = 'fork-res-card-badge';
      resTruthContentEl.innerHTML = `
        <div class="fork-res-truth-locked-box">
          <svg class="fork-res-truth-lock-svg" viewBox="0 0 24 24">
            <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
          </svg>
          <span class="fork-res-truth-locked-title">核心真相</span>
          <span class="fork-res-truth-locked-desc">核心真相尚未达成揭示条件</span>
        </div>
      `;
    }
  }

  /**
   * 渲染结局分支
   */
  function renderDashboardEndings(endings, hitEndingId) {
    if (!resEndingListEl) return;
    resEndingListEl.innerHTML = '';

    if (!Array.isArray(endings) || endings.length === 0) {
      resEndingListEl.innerHTML = `
        <div class="fork-res-truth-locked-box">
          <span class="fork-res-truth-locked-title">NO ENDINGS CONFIG</span>
          <span class="fork-res-truth-locked-desc">本副本为自由无尽推演模式</span>
        </div>
      `;
      return;
    }

    const GRADE_NAMES = {
      full: '完全揭示 100%',
      major: '拨云见日 80%',
      partial: '雾里看花 60%',
      faint: '迷影重重 40%'
    };

    endings.forEach((ed, idx) => {
      const eid = trimStr(ed && ed.id);
      const isHit = hitEndingId && eid === hitEndingId;
      const item = document.createElement('div');
      item.className = `fork-res-ending-item ${isHit ? 'is-hit' : 'is-locked'}`;

      const gradeKey = ed.grade || 'full';
      const gradeText = GRADE_NAMES[gradeKey] || GRADE_NAMES.full;

      if (isHit) {
        item.innerHTML = `
          <div class="fork-res-ending-top">
            <div class="fork-res-ending-name-wrap">
              <span class="fork-res-ending-code">END-${String(idx + 1).padStart(2, '0')}</span>
              <span class="fork-res-ending-name">${escapeHtml(ed.name || '已达成结局')}</span>
            </div>
            <span class="fork-res-ending-grade-tag">${gradeText}</span>
          </div>
          <div class="fork-res-ending-desc">${escapeHtml(ed.desc || '此因果分支已最终收束。')}</div>
        `;
      } else {
        item.innerHTML = `
          <div class="fork-res-ending-top">
            <div class="fork-res-ending-name-wrap">
              <span class="fork-res-ending-code">END-${String(idx + 1).padStart(2, '0')}</span>
              <span class="fork-res-ending-name" style="opacity: 0.5;">${hitEndingId ? '未命中该分支' : '待推演达成'}</span>
            </div>
            <span class="fork-res-ending-grade-tag" style="opacity: 0.6;">${gradeText}</span>
          </div>
          <div class="fork-res-ending-desc" style="font-style: italic; opacity: 0.4;">
            ${hitEndingId ? '本次推演已收束至其他结局分支' : '尚未达成该结局的触发条件...'}
          </div>
        `;
      }
      resEndingListEl.appendChild(item);
    });
  }

  let deckResAnimTimer = null;
  let deckResDelayTimer = null;

  /**
   * 驱动抽屉主页大解析度卡通电充能与数字跳频
   */
  function animateDeckResolutionCard(targetPct) {
    const validPct = Math.min(100, Math.max(0, Math.round(Number(targetPct) || 0)));

    if (deckResAnimTimer) {
      cancelAnimationFrame(deckResAnimTimer);
      deckResAnimTimer = null;
    }
    if (deckResDelayTimer) {
      clearTimeout(deckResDelayTimer);
      deckResDelayTimer = null;
    }

    // 1. 立即重置为 0 状态
    if (deckResBarEl) {
      deckResBarEl.style.transition = 'none';
      deckResBarEl.style.width = '0%';
    }
    if (deckResPctEl) {
      deckResPctEl.textContent = '0';
    }

    // 2. 抽屉滑出约 60ms 时开启动画
    deckResDelayTimer = setTimeout(() => {
      deckResDelayTimer = null;

      if (deckResBarEl) {
        deckResBarEl.style.transition = 'width 0.48s cubic-bezier(0.16, 1, 0.3, 1)';
        deckResBarEl.style.width = `${validPct}%`;
      }

      const startTime = performance.now();
      const duration = 460;

      function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);
        // 轻缓 Ease-Out 曲线让数字清晰跳动
        const easeOut = 1 - Math.pow(1 - progress, 3);
        const currentVal = Math.round(easeOut * validPct);

        if (deckResPctEl) {
          deckResPctEl.textContent = String(currentVal);
        }

        if (progress < 1) {
          deckResAnimTimer = requestAnimationFrame(step);
        } else {
          deckResAnimTimer = null;
          if (deckResPctEl) deckResPctEl.textContent = String(validPct);
        }
      }

      deckResAnimTimer = requestAnimationFrame(step);
    }, 60);
  }

  function resetDeckResolutionCard() {
    if (deckResDelayTimer) {
      clearTimeout(deckResDelayTimer);
      deckResDelayTimer = null;
    }
    if (deckResAnimTimer) {
      cancelAnimationFrame(deckResAnimTimer);
      deckResAnimTimer = null;
    }
  }

  function openDeckDrawer() {
    initDeckDrawerDOM();
    if (!deckOverlayEl) return;
    refreshDeckDrawerData();
    // 复位轨道到主舱：清掉上次可能残留的态势舱/身份舱/任务看板平移态，保证每次拉开都从一级控制台开始
    if (deckDrawerEl) {
      deckDrawerEl.classList.remove('is-res-mode', 'is-identity-mode', 'is-mission-mode', 'is-asst-mode');
    }
    isResDashOpen = false;
    isIdentityEditOpen = false;
    isMissionBoardOpen = false;
    isAsstPaneOpen = false;
    deckOverlayEl.hidden = false;
    // 强制触发 reflow 以确保 transition 动画平滑播放
    void deckOverlayEl.offsetWidth;
    deckOverlayEl.classList.add('is-active');
    deckOverlayEl.setAttribute('aria-hidden', 'false');
    isDeckOpen = true;

    try {
      window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
    } catch (_) {}
  }

  function closeDeckDrawer(fromPopState = false) {
    if (!deckOverlayEl || !isDeckOpen) return;
    deckOverlayEl.classList.remove('is-active');
    deckOverlayEl.setAttribute('aria-hidden', 'true');
    isDeckOpen = false;
    resetDeckResolutionCard();
    setTimeout(() => {
      if (!isDeckOpen && deckOverlayEl) {
        deckOverlayEl.hidden = true;
      }
    }, 280);

    if (!fromPopState) {
      try {
        if (window.history.state && window.history.state.rfPage === 'fork-run-deck') {
          window.history.back();
        }
      } catch (_) {}
    }
  }

  async function refreshDeckDrawerData() {
    initDeckDrawerDOM();
    const idInfo = resolveIdentityInfo();

    // 1. 头像与编号
    if (deckUserAvatarEl) {
      if (idInfo.avatarUrl) {
        deckUserAvatarEl.src = idInfo.avatarUrl;
        deckUserAvatarEl.style.display = 'block';
      } else {
        deckUserAvatarEl.style.display = 'none';
      }
    }
    if (deckUserSerialEl) {
      deckUserSerialEl.textContent = `NO.${idInfo.serial}`;
    }
    if (deckUserNameEl) {
      deckUserNameEl.textContent = idInfo.name;
    }

    // 2. 副本信息与等级水印 (纯水相微图腾)
    const forkTitle = (currentFork && (currentFork.title || currentFork.name)) || '未命名副本';
    if (deckForkTitleEl) {
      deckForkTitleEl.textContent = forkTitle;
      deckForkTitleEl.title = forkTitle;
    }
    const rawRank = trimStr(currentFork && (currentFork.levelKey || currentFork.difficulty || currentFork.hazardLevel)) || 'C';
    const rankCode = rawRank.toUpperCase();
    if (deckRankWatermarkIconEl) {
      const svg = FORK_RANK_SVGS[rankCode] || FORK_RANK_SVGS['C'];
      deckRankWatermarkIconEl.innerHTML = svg;
    }

    // 3. 解析度综合运算
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    const clueState = (currentRun && currentRun.clues) || {};
    const unlockedCluesCount = forkClues.filter((c) => {
      const cid = trimStr(c && c.id);
      return clueState[cid] && clueState[cid].status === 'unlocked';
    }).length;
    const totalClues = forkClues.length;

    const hasTruth = !!(currentFork && currentFork.hiddenTruth && currentFork.hiddenTruth.desc);
    const truthUnlocked = !!(currentRun && currentRun.truthUnlocked);

    const forkEndings = (currentFork && Array.isArray(currentFork.endings)) ? currentFork.endings : [];
    const totalEndings = forkEndings.length;
    const endingSettled = !!(currentRun && currentRun.endingSettled);

    const forkLocations = (currentFork && Array.isArray(currentFork.locations)) ? currentFork.locations : [];
    const totalLocations = forkLocations.length;
    const visitedLocIds = (currentRun && Array.isArray(currentRun.visitedLocationIds)) ? currentRun.visitedLocationIds : [];
    // 只算命中预设地点的访问（防脏 id），点亮率 = 访问数 / 预设总数
    const visitedLocCount = forkLocations.filter((loc) => visitedLocIds.includes(trimStr(loc && loc.id))).length;

    // 进度权重折算：线索 40%，核心真相 25%，结局 20%，地图点亮 15%
    let calculatedScore = 0;
    if (totalClues > 0) {
      calculatedScore += (unlockedCluesCount / totalClues) * 40;
    } else {
      calculatedScore += 40; // 副本未配线索时直接视为免考通过
    }
    if (hasTruth) {
      if (truthUnlocked) calculatedScore += 25;
    } else {
      calculatedScore += 25;
    }
    if (totalEndings > 0) {
      if (endingSettled) {
        // 结局品级折算：命中的结局按其探索揭示度打分
        //   full=100% / major=80% / partial=60% / faint=40%（旧卷宗无 grade 默认 full）
        const GRADE_WEIGHT = { full: 1, major: 0.8, partial: 0.6, faint: 0.4 };
        const hitEnding = forkEndings.find((ed) => trimStr(ed && ed.id) === trimStr(currentRun.endingId));
        const gradeKey = (hitEnding && GRADE_WEIGHT[hitEnding.grade] != null) ? hitEnding.grade : 'full';
        calculatedScore += 20 * GRADE_WEIGHT[gradeKey];
      }
    } else {
      calculatedScore += 20;
    }
    if (totalLocations > 0) {
      calculatedScore += (visitedLocCount / totalLocations) * 15;
    } else {
      calculatedScore += 15; // 副本未配地点时地图维度免考给满
    }
    const finalPct = Math.min(100, Math.max(0, Math.round(calculatedScore)));

    // 触发主页大卡进度条充能与数字跳频动画
    animateDeckResolutionCard(finalPct);

    if (deckMapStatusEl) deckMapStatusEl.textContent = totalLocations > 0 ? `${visitedLocCount}/${totalLocations}` : '无地图';
    if (deckClueStatusEl) deckClueStatusEl.textContent = `${unlockedCluesCount}/${totalClues}`;
    if (deckTruthStatusEl) deckTruthStatusEl.textContent = truthUnlocked ? '已解明' : '未解明';
    if (deckEndingStatusEl) deckEndingStatusEl.textContent = endingSettled ? '1/1' : `0/${totalEndings || 1}`;

    // 4. 身份信息
    const type = trimStr(currentRun && currentRun.identityType);
    if (deckIdentityTypeEl) {
      deckIdentityTypeEl.textContent = (type === 'preset' || type === 'locked') ? 'IDENTITY // LOCKED' : 'IDENTITY // FREE';
    }
    if (deckIdentityNameEl) {
      deckIdentityNameEl.textContent = `${idInfo.name} · ${idInfo.serial ? 'NO.' + idInfo.serial : '执行员'}`;
    }

    // 5. 战术态势双拼栏：任务推进 + 精神值
    //    数据来源（方案 A）：往回扫最近一条叙事记录，现场用 ForkRunParser 解析其
    //    content，取 quest 作任务、state 作精神值——与气泡卡走同一条解析路径，
    //    单一数据源（content），旧档天然读得对，不依赖任何落库副本字段。
    //    某轮 AI 没写 quest/state 时该轮解析不出，自动继续往前找上一条有效记录，
    //    绝不被半输出/空输出污染。
    let latestMissions = null;
    let latestSan = null;
    let latestSanMax = null;
    try {
      if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function' && currentRunId) {
        const recs = await ForkRunStore.getRunRecords(currentRunId);
        const canParse = window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function';
        if (Array.isArray(recs) && canParse) {
          for (let i = recs.length - 1; i >= 0; i--) {
            const r = recs[i];
            if (!r || typeof r !== 'object') continue;
            // 只有叙事条目带 ::: state / quest 块；执行员行动没有，跳过省解析开销
            if (r.role === 'envoy') continue;
            const content = typeof r.content === 'string' ? r.content : '';
            if (!content) continue;
            const parsed = ForkRunParser.parseRunReply(content);
            // 精神值：最近一条解析出合法数字 san 的叙事
            if (latestSan == null && parsed && parsed.state && typeof parsed.state.san === 'number' && !Number.isNaN(parsed.state.san)) {
              latestSan = parsed.state.san;
            }
            // 任务：最近一条解析出非空 quest 数组的叙事
            if (latestMissions == null && parsed && Array.isArray(parsed.quest) && parsed.quest.length > 0) {
              latestMissions = parsed.quest;
            }
            if (latestSan != null && latestMissions != null) break;
          }
        }
      }
    } catch (err) {
      console.warn('[ForkRun] DECK 态势数据读取失败：', err);
    }

    // 5.1 任务推进（分母 = 当前已解锁的卷宗任务数；分子 = missionState 里的持久完成数）
    //     用持久态而非「最近一轮 missions」：AI 某轮漏输出 quest 块时进度不会凭空倒退。
    //     未解锁的阶段任务不计入分母——玩家看到的是「当前这一阶段的推进度」。
    const forkMissions = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    const unlockedMissionIds = computeUnlockedMissionIds();
    const missionStateMap = getMissionState();
    const totalMissions = forkMissions.filter((m) => unlockedMissionIds.has(trimStr(m && m.id))).length;
    let achievedMissions = forkMissions.filter((m) => {
      const mid = trimStr(m && m.id);
      return unlockedMissionIds.has(mid) && missionStateMap[mid] && missionStateMap[mid].achieved;
    }).length;
    // 老存档没有 missionState（这条线是旧版本跑的）：回落到最近一轮 missions 的 achieved 计数
    if (achievedMissions === 0 && !Object.keys(missionStateMap).length && Array.isArray(latestMissions)) {
      achievedMissions = latestMissions.filter((m) => m && (m.status === 'achieved' || m.achieved === true)).length;
    }
    // 全部卷宗任务（含未解锁的）都完成才算可结算——阶段链没走完不能结
    const allForkMissionCount = forkMissions.filter((m) => trimStr(m && m.id)).length;
    const allAchievedCount = forkMissions.filter((m) => {
      const mid = trimStr(m && m.id);
      return mid && missionStateMap[mid] && missionStateMap[mid].achieved;
    }).length;
    const canSettle = allForkMissionCount > 0 && allAchievedCount >= allForkMissionCount;
    if (deckMissionCountEl) {
      deckMissionCountEl.textContent = totalMissions > 0 ? `${Math.min(achievedMissions, totalMissions)}/${totalMissions}` : '无任务';
    }
    if (deckMissionFillEl) {
      const mPct = totalMissions > 0 ? Math.min(100, Math.round((achievedMissions / totalMissions) * 100)) : 100;
      deckMissionFillEl.style.width = `${canSettle ? 100 : mPct}%`;
    }
    if (deckMissionCardEl) deckMissionCardEl.classList.toggle('is-ready', !!canSettle);
    if (deckMissionNoteEl) {
      deckMissionNoteEl.textContent = canSettle ? '可结算 // READY' : (totalMissions > 0 ? '推进中' : '本副本无主线任务');
    }

    // 5.2 精神值（缺省回落档案 psych.sanity 当前值；再无则显示等待接入）
    if (latestSan == null && window.Store && Store.envoy && Store.envoy.psych) {
      const archSan = Number(Store.envoy.psych.sanity);
      if (Number.isFinite(archSan)) {
        latestSan = archSan;
        const archMax = Number(Store.envoy.psych.maxSanity);
        if (Number.isFinite(archMax) && archMax > 0) latestSanMax = archMax;
      }
    }
    const sanMax = (latestSanMax && latestSanMax > 0) ? latestSanMax
      : ((window.Store && Store.envoy && Store.envoy.psych && Number(Store.envoy.psych.maxSanity) > 0)
        ? Number(Store.envoy.psych.maxSanity) : 100);
    deckLatestSan = latestSan;
    deckLatestSanMax = sanMax;
    const hasSanVal = latestSan != null;
    const sanStatus = (hasSanVal && window.PsychStore && typeof PsychStore.getSanityStatus === 'function')
      ? PsychStore.getSanityStatus(latestSan) : null;
    if (deckSanValueEl) {
      deckSanValueEl.textContent = hasSanVal ? `${latestSan}/${sanMax}` : '--';
    }
    if (deckSanFillEl) {
      const sPct = hasSanVal ? Math.max(0, Math.min(100, Math.round((latestSan / sanMax) * 100))) : 0;
      deckSanFillEl.style.width = `${sPct}%`;
    }
    if (deckSanCardEl) {
      deckSanCardEl.setAttribute('data-sanity-level', sanStatus ? sanStatus.level : '');
    }
    if (deckSanNoteEl) {
      deckSanNoteEl.textContent = sanStatus ? `${sanStatus.text} · ${sanStatus.code}` : '等待接入';
    }

    // 5.3 战术能源核电量感知 (环形进度条 + 实时百分比 + 充电微标)
    refreshDeckBatteryMeter();
  }

  /**
   * 刷新 DECK 装备舱中的真实电量环形仪表
   */
  async function refreshDeckBatteryMeter() {
    if (!deckBatteryCircleEl && !deckBatteryNumEl) return;
    const CIRCLE_CIRCUMFERENCE = 81.68; // 2 * Math.PI * 13

    let pct = 100;
    let charging = false;
    let hasBatteryInfo = false;

    try {
      if (window.EnvAwareness && typeof EnvAwareness.getBatteryInfo === 'function') {
        const info = await EnvAwareness.getBatteryInfo();
        if (info && Number.isFinite(info.pct)) {
          pct = Math.max(0, Math.min(100, Math.round(info.pct)));
          charging = Boolean(info.charging);
          hasBatteryInfo = true;
        }
      } else if (navigator.getBattery) {
        const b = await navigator.getBattery();
        if (b && Number.isFinite(b.level)) {
          pct = Math.max(0, Math.min(100, Math.round(b.level * 100)));
          charging = Boolean(b.charging);
          hasBatteryInfo = true;
        }
      }
    } catch (_) {}
if (deckBatteryNumEl) {
      deckBatteryNumEl.textContent = hasBatteryInfo ? `${pct}` : '99';
    }
    if (deckBatteryBoltEl) {
      deckBatteryBoltEl.style.display = 'none'; // 彻底隐藏原本挤占空间的微标
    }
    if (deckBatteryMeterEl) {
      deckBatteryMeterEl.classList.toggle('is-charging', Boolean(charging));
    }

    if (deckBatteryCircleEl) {
      const offset = CIRCLE_CIRCUMFERENCE * (1 - (pct / 100));
      deckBatteryCircleEl.style.strokeDashoffset = String(offset);
      // 充电态交给 CSS 关键帧柔和过渡接管，非充电态按电量分级着色
      if (charging) {
        deckBatteryCircleEl.style.stroke = '';
      } else if (pct <= 20) {
        deckBatteryCircleEl.style.stroke = 'var(--danger-color, #FF5E5E)';
      } else if (pct <= 40) {
        deckBatteryCircleEl.style.stroke = 'var(--warning-color, #E6A23C)';
      } else {
        deckBatteryCircleEl.style.stroke = 'var(--decor-color)';
      }
    }
  }

  /**
   * 构建特勤执行员双卡折叠面板 (Dual-Card Foldable Envoy Hub)。
   * 卡片 A：精致主题色小卡（高 44px，底色主题色，文字背景色反白，展示姓名与精神值）
   * 卡片 B：展开后的现场特写档案卡（两张卡物理分离 8px，左 2:3 肖像，右衣着姿势与属性，底部副本数值）
   *
   * @param {Object} [vitalData] 状态数据
   */
  /**
   * 动态回溯当前执行员身份真相源。
   * 姓名、立绘跟随当前准备/修改动态生效；编号为全局执行员唯一编号。
   */
  function resolveIdentityInfo() {
    let serial = '';
    if (window.Store && typeof Store.getSerialNo === 'function') {
      try { serial = Store.getSerialNo(); } catch (_) {}
    }
    const cleanSerial = String(serial || '').replace(/\D/g, '').padStart(6, '0').slice(-6) || '000001';

    const type = trimStr(currentRun && currentRun.identityType);
    const targetId = trimStr(currentRun && (currentRun.identityId || currentRun.maskId));

    // 1. 副本预设锁定身份
    if ((type === 'preset' || type === 'locked') && currentFork && Array.isArray(currentFork.lockedRoles)) {
      const role = currentFork.lockedRoles.find((r) => r && String(r.id) === targetId);
      if (role) {
        return {
          name: trimStr(role.name) || '预设角色',
          serial: cleanSerial,
          avatarUrl: role.avatar || envoyAvatarUrl || ''
        };
      }
    }

    // 2. 马甲身份
    if (type === 'mask' && targetId) {
      let mask = null;
      if (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) {
        mask = Store.envoy.masks.find((m) => m && String(m.id) === targetId);
      }
      return {
        name: trimStr(mask && mask.name) || '未命名马甲',
        serial: cleanSerial,
        avatarUrl: envoyAvatarUrl || ''
      };
    }

    // 3. 本人本体身份 (persona)
    let personaName = '';
    if (window.Store && Store.envoy && Store.envoy.identity) {
      personaName = trimStr(Store.envoy.identity.name);
    }
    return {
      name: personaName || '执行员',
      serial: cleanSerial,
      avatarUrl: envoyAvatarUrl || ''
    };
  }

  /**
   * 构建特勤执行员双卡折叠面板 (Dual-Card Foldable Envoy Hub)。
   * 卡片 A：精致主题色小卡（高 44px，底色主题色，文字背景色反白，展示姓名与精神值）
   * 卡片 B：展开后的现场特写档案卡（两张卡物理分离 8px，左 2:3 肖像，右衣着姿势与属性，底部副本数值）
   *
   * @param {Object} [vitalData] 状态数据
   */
  function buildVitalsCard(vitalData) {
    const data = (vitalData && typeof vitalData === 'object') ? vitalData : {};
    const liveIdentity = resolveIdentityInfo();

    // 姓名：AI 输出显式指定 > 动态身份真相源 > 兜底
    const name = trimStr(data.name) || liveIdentity.name || '执行员';
    
    // 编号：全局唯一
    let rawSerial = trimStr(data.serial);
    const cleanSerial = String(rawSerial || liveIdentity.serial).replace(/\D/g, '').padStart(6, '0').slice(-6);
    const serial = cleanSerial || liveIdentity.serial;

    // 部门：优先取传入值，缺省时直读观测档案编制，最后兜底三千世界
    let dept = trimStr(data.dept);
    if (!dept && window.PsychStore && typeof PsychStore.load === 'function') {
      try {
        const psych = PsychStore.load() || {};
        dept = trimStr(PsychStore.getDepartment(psych.department).name);
      } catch (e) { /* ignore */ }
    }
    if (!dept) dept = '三千世界';
    const level = trimStr(data.level) || 'LV.3';
    
    // 精神值：此轮不写死 DEMO 假数据，AI 输出了数值则渲染，没输出则保持空/等待下轮输入
    const sanStatus = trimStr(data.sanStatus) || '';
    const hasSan = typeof data.san === 'number' && !Number.isNaN(data.san);
    const sanCur = hasSan ? data.san : null;
    // 精神值上限以执行员档案为真相源（AI 不重复输出它不掌握的数字）。
    // data.sanMax 显式给了才用，否则读档案 psych.maxSanity，再兜底 100。
    const envoyMaxSan = (window.Store && Store.envoy && Store.envoy.psych
      && Number.isFinite(Number(Store.envoy.psych.maxSanity)))
      ? Number(Store.envoy.psych.maxSanity) : 100;
    const sanMax = typeof data.sanMax === 'number' && !Number.isNaN(data.sanMax) ? data.sanMax : envoyMaxSan;
    const sanPercent = hasSan ? Math.max(0, Math.min(100, Math.round((sanCur / sanMax) * 100))) : 0;

    // parsed 模式：真实数据缺省时不再填 DEMO 文案，改用中性占位提示 AI 下轮补写
    const isParsed = !!data.parsed;
    const PLACEHOLDER = '（等待行动后系统填写）';
    const attireText = trimStr(data.attire)
      || (isParsed ? PLACEHOLDER : '深灰阻燃风衣外罩战术外骨骼背心，战术防毒面罩半挂在颈侧，作战靴沾满泥泞。');
    const postureText = trimStr(data.posture)
      || (isParsed ? PLACEHOLDER : '左膝抵在积水排污管上，右手沉稳握持震荡短刀，身体紧贴湿冷承重柱静息戒备。');
    const avatarUrl = trimStr(data.avatar) || liveIdentity.avatarUrl;

    // 融汇式现场镜头引言（服装与姿势）
    const fusionFocusText = `${attireText} ${postureText}`.trim();

    // 副本专属数值：作者在卷宗里设了哪些就显示哪些，一个都没设则整块不渲染。
    // data.customStats 是留给后续「AI 每轮回传实时数值」的入口，给了就优先用；
    // 没给就退回卷宗设定的初始值（作者留空 init 时即为 MAX 满状态）。
    const customStats = Array.isArray(data.customStats)
      ? data.customStats
      : currentForkStats.map((st) => ({
          label: st.name,
          val: `${st.init}/${st.max}`
        }));

    // 本轮数值变动说明：AI 每轮只写当轮最新的变化，不合并不累积。
    // 卡片绑在各自那一轮的流水记录上，往上翻自然就是当轮的变动，无需额外处理历史。
    // 形如 { name, delta, reason }；没有变动则整块不渲染。
    // parsed 模式：解析器给了就用、没给就是空（不显示 DEMO）；非 parsed 演示态回落 DEMO。
    const DEMO_STAT_DELTAS = [
      { name: '饱食度', delta: -5, reason: '经过两小时的潜行，腹中空乏感开始上涌' },
      { name: '精神值', delta: -3, reason: '培养舱的低频嗡鸣持续侵蚀神经，太阳穴突突发胀' },
      { name: '污染度', delta: 3, reason: '徒手拨开了残液淤积的排污闸门' }
    ];
    const rawDeltas = Array.isArray(data.statDeltas)
      ? data.statDeltas
      : (isParsed ? [] : DEMO_STAT_DELTAS);
    const statDeltas = rawDeltas.filter((d) => d && trimStr(d.name));

    // 外层折叠主容器（默认展开态受「组件默认展开」开关控制）
    const vitalsExpanded = shouldExpandComponentsByDefault();
    const foldWrap = document.createElement('div');
    foldWrap.className = 'fork-run-vitals-fold-wrap' + (vitalsExpanded ? ' is-expanded' : '');

    // 卡片 A：极简冷淡名片流 (Tactical Calling Card)
    const triggerCard = document.createElement('button');
    triggerCard.type = 'button';
    triggerCard.className = 'fork-run-vitals-trigger-card';
    triggerCard.setAttribute('aria-expanded', vitalsExpanded ? 'true' : 'false');
    triggerCard.setAttribute('aria-label', `${vitalsExpanded ? '收起' : '展开'}执行员 ${name} 现场状态详情`);

    triggerCard.innerHTML = `
      <div class="fork-run-vitals-bcard-top">
        <span class="fork-run-vitals-bcard-title">PERSONAL STATUS</span>
        <span class="fork-run-vitals-trigger-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="fork-run-vitals-trigger-arrow-svg">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" fill="currentColor"/>
          </svg>
        </span>
      </div>
      <div class="fork-run-vitals-bcard-bottom">
        <div class="fork-run-vitals-bcard-row-meta">
          <span class="fork-run-vitals-bcard-name">${escapeHtml(name)}</span>
          <span class="fork-run-vitals-bcard-serial">NO. ${escapeHtml(serial)}</span>
        </div>
        ${hasSan ? `
        <div class="fork-run-vitals-bcard-row-vitals">
          <div class="fork-run-vitals-bcard-san-text">
            <span class="fork-run-vitals-bcard-san-lbl">精神值</span>
            <span class="fork-run-vitals-bcard-san-val">${sanCur}/${sanMax}</span>
            ${sanStatus ? `<span class="fork-run-vitals-bcard-san-dot">·</span><span class="fork-run-vitals-bcard-san-status">${escapeHtml(sanStatus)}</span>` : ''}
          </div>
          <div class="fork-run-vitals-bcard-barcode" aria-hidden="true">
            <svg viewBox="0 0 40 10" class="fork-run-vitals-bcard-barcode-svg">
              <rect x="0" y="0" width="1.5" height="10" fill="currentColor"/>
              <rect x="3" y="0" width="1" height="10" fill="currentColor"/>
              <rect x="5.5" y="0" width="2" height="10" fill="currentColor"/>
              <rect x="9.5" y="0" width="1.5" height="10" fill="currentColor"/>
              <rect x="13" y="0" width="2.5" height="10" fill="currentColor"/>
              <rect x="17.5" y="0" width="1" height="10" fill="currentColor"/>
              <rect x="20" y="0" width="2" height="10" fill="currentColor"/>
              <rect x="23.5" y="0" width="1" height="10" fill="currentColor"/>
              <rect x="26" y="0" width="2.5" height="10" fill="currentColor"/>
              <rect x="30" y="0" width="1" height="10" fill="currentColor"/>
              <rect x="32.5" y="0" width="2" height="10" fill="currentColor"/>
              <rect x="36" y="0" width="1" height="10" fill="currentColor"/>
              <rect x="38.5" y="0" width="1.5" height="10" fill="currentColor"/>
            </svg>
          </div>
        </div>
        <div class="fork-run-vitals-bcard-track" aria-hidden="true">
          <div class="fork-run-vitals-bcard-fill" style="width: ${sanPercent}%"></div>
        </div>
        ` : ''}
      </div>
    `;

    // 卡片 B 的动画外壳 (CSS Grid 0fr -> 1fr 丝滑折叠)
    const drawer = document.createElement('div');
    drawer.className = 'fork-run-vitals-drawer';

    const drawerInner = document.createElement('div');
    drawerInner.className = 'fork-run-vitals-drawer-inner';

    // 卡片 B：现场特写副卡（与卡片 A 彻底分离，间距 8px）
    const detailCard = document.createElement('div');
    detailCard.className = 'fork-run-vitals-detail-card';

    // 1. 上半部：左 2:3 肖像 + 右动作姿势与属性
    const dossierRow = document.createElement('div');
    dossierRow.className = 'fork-run-vitals-dossier-split';

    // 左侧：2:3 肖像照 (80px × 120px)
    const photoVault = document.createElement('div');
    photoVault.className = 'fork-run-vitals-photo-vault';
    if (avatarUrl) {
      photoVault.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="Photo" class="fork-run-vitals-photo-img">`;
    } else {
      photoVault.innerHTML = `
        <div class="fork-run-vitals-photo-placeholder">
          <svg viewBox="0 0 48 72" class="fork-run-vitals-photo-silhouette" aria-hidden="true">
            <path d="M24 14c5 0 9 4 9 9s-4 9-9 9-9-4-9-9 4-9 9-9zm0 24c8 0 17 4 17 12v12H7V50c0-8 9-12 17-12z" fill="currentColor"/>
          </svg>
          <div class="fork-run-vitals-photo-seal">ENVOY</div>
          <span class="fork-run-vitals-photo-no">09</span>
        </div>
      `;
    }

    // 右侧：着装与姿态两大档案区块
    const rightCol = document.createElement('div');
    rightCol.className = 'fork-run-vitals-right-col';

    if (attireText) {
      const attireBlock = document.createElement('div');
      attireBlock.className = 'fork-run-vitals-field-block';
      attireBlock.innerHTML = `
        <div class="fork-run-vitals-field-head">
          <span class="fork-run-vitals-field-en">ATTIRE</span>
          <span class="fork-run-vitals-field-slash">//</span>
          <span class="fork-run-vitals-field-zh">着装</span>
        </div>
        <div class="fork-run-vitals-field-body">${escapeHtml(attireText)}</div>
      `;
      rightCol.append(attireBlock);
    }

    if (postureText) {
      const postureBlock = document.createElement('div');
      postureBlock.className = 'fork-run-vitals-field-block';
      postureBlock.innerHTML = `
        <div class="fork-run-vitals-field-head">
          <span class="fork-run-vitals-field-en">POSTURE</span>
          <span class="fork-run-vitals-field-slash">//</span>
          <span class="fork-run-vitals-field-zh">姿态</span>
        </div>
        <div class="fork-run-vitals-field-body">${escapeHtml(postureText)}</div>
      `;
      rightCol.append(postureBlock);
    }

    dossierRow.append(photoVault, rightCol);
    detailCard.append(dossierRow);

    // 2. 底部部分：副本专属数值（数值 数值 数值，无则自适应隐藏）
    if (customStats && customStats.length > 0) {
      const statsSection = document.createElement('div');
      statsSection.className = 'fork-run-vitals-stats-section';
      statsSection.innerHTML = customStats.map(st => `
        <div class="fork-run-vitals-stat-unit">
          <span class="fork-run-vitals-stat-k">${escapeHtml(st.label)}</span>
          <span class="fork-run-vitals-stat-v">${escapeHtml(st.val)}</span>
        </div>
      `).join('');
      detailCard.append(statsSection);
    }

    // 3. 本轮数值变动说明（AI 给出的因果解释，无变动则整块不渲染）
    if (statDeltas.length > 0) {
      const deltaSection = document.createElement('div');
      deltaSection.className = 'fork-run-vitals-delta-section';
      deltaSection.innerHTML = statDeltas.map((d) => {
        // 变动量原样透出：AI 写 -5 就是 -5，写 +3 就是 +3，前端不改写不推算
        const deltaText = (typeof d.delta === 'number' && Number.isFinite(d.delta))
          ? (d.delta > 0 ? `+${d.delta}` : String(d.delta))
          : trimStr(d.delta);
        const reason = trimStr(d.reason);
        return `
        <div class="fork-run-vitals-delta-line">
          <span class="fork-run-vitals-delta-key">${escapeHtml(trimStr(d.name))}</span>
          <span class="fork-run-vitals-delta-num">${escapeHtml(deltaText)}</span>
          ${reason ? `<span class="fork-run-vitals-delta-reason">：${escapeHtml(reason)}</span>` : ''}
        </div>`;
      }).join('');
      detailCard.append(deltaSection);
    }

    drawerInner.append(detailCard);
    drawer.append(drawerInner);

    // 点击交互事件：双卡独立展开/折叠
    triggerCard.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = foldWrap.classList.toggle('is-expanded');
      triggerCard.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      triggerCard.setAttribute(
        'aria-label',
        `${isExpanded ? '收起' : '展开'}执行员 ${name} 现场状态详情`
      );
    });

    foldWrap.append(triggerCard, drawer);
    return foldWrap;
  }

  /**
   * 构建同行执行员队伍折叠状态卡 (Allied Operatives Hub)。
   * - 触发头：沉稳反色黑底 (#1B1717 / var(--secondary-color)) + 米白字 (#EDEBDD / var(--bg-color))
   * - 检视舱内部：
   *   第一排：横向头像切换轨 (Allied Operatives Rail)
   *   第二排：选中队友的姓名、六位工号与精神值状态
   *   第三排及以下：无 2:3 大照片的通栏着装姿态、横向丝滑数值轨与微凹陷变动说明托盘
   *
   * @param {Array<Object>} [alliesList] 同行队友数组
   */
  function buildAlliedVitalsCard(alliesList) {
    // TODO(临时预览): 若未从 AI / 推演数据传入，挂载演示队友数据供真机检视效果
    const DEMO_ALLIES = [
      {
        id: 'ally_01',
        name: '林砚',
        serial: '000412',
        avatar: '',
        san: 88,
        sanMax: 100,
        sanStatus: '良好',
        attire: '深灰高领阻燃战术衣，战术背心紧束胸前，手臂装配便携通信中继模块，靴侧卡槽插着折叠探针。',
        posture: '半蹲在断裂的金属管线旁，食指轻叩终端接收器，目光专注凝视着阴影深处的排污闸口。',
        customStats: [
          { label: '饱食度', val: '90/100' },
          { label: '行动力', val: '4/5' },
          { label: '理智值', val: '88/100' }
        ],
        statDeltas: [
          { name: '饱食度', delta: -5, reason: '断续推进两小时，便携压缩干粮尚未拆封' },
          { name: '行动力', delta: -1, reason: '掩护前出侦察消耗了一次标准战术机动' }
        ]
      },
      {
        id: 'ally_02',
        name: '陈九',
        serial: '000889',
        avatar: '',
        san: 74,
        sanMax: 100,
        sanStatus: '微躁',
        attire: '重型加固防暴服，肩甲与胸前布满暗沉划痕，腰间挂着弹药束带与双联破拆锤。',
        posture: '背靠残破的混凝土掩体，双手紧扣破拆锤握柄，微微喘息间戒备着通道另一端的动静。',
        customStats: [
          { label: '饱食度', val: '80/100' },
          { label: '护甲值', val: '65/100' },
          { label: '体力值', val: '72/100' }
        ],
        statDeltas: [
          { name: '护甲值', delta: -15, reason: '正面承受了闸门坍塌落下的碎石撞击' },
          { name: '精神值', delta: -6, reason: '受狭小空间暗处低频噪音干扰，神经持续紧绷' }
        ]
      }
    ];

    const rawList = Array.isArray(alliesList) && alliesList.length > 0 ? alliesList : DEMO_ALLIES;
    const allies = rawList.filter((a) => a && typeof a === 'object');
    if (allies.length === 0) return null;

    let activeIdx = 0;

    // 外层折叠主容器（默认展开态受「组件默认展开」开关控制）
    const alliesExpanded = shouldExpandComponentsByDefault();
    const foldWrap = document.createElement('div');
    foldWrap.className = 'fork-run-allies-fold-wrap' + (alliesExpanded ? ' is-expanded' : '');

    // 折叠栏触发头：沉稳反色黑底 + 背景色米白文字
    const triggerCard = document.createElement('button');
    triggerCard.type = 'button';
    triggerCard.className = 'fork-run-allies-trigger-card';
    triggerCard.setAttribute('aria-expanded', alliesExpanded ? 'true' : 'false');
    triggerCard.setAttribute('aria-label', alliesExpanded ? '收起队友状态详情' : '展开队友状态详情');

    triggerCard.innerHTML = `
      <div class="fork-run-allies-trigger-top">
        <div class="fork-run-allies-trigger-main">
          <span class="fork-run-allies-trigger-icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" class="fork-run-allies-trigger-icon-svg">
              <!-- 多维战术作战单元 (Squad Matrix) 纯战术方块组合 -->
              <rect x="2" y="2" width="5.5" height="5.5" rx="1" fill="currentColor"/>
              <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.45"/>
              <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" fill="currentColor" opacity="0.45"/>
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" fill="currentColor"/>
            </svg>
          </span>
          <div class="fork-run-allies-trigger-info">
            <span class="fork-run-allies-trigger-tag">TAC-UNIT // FIELD ALLIES</span>
            <span class="fork-run-allies-trigger-heading">队友状态</span>
          </div>
        </div>
        <div class="fork-run-allies-trigger-aside">
          <span class="fork-run-allies-trigger-badge">${allies.length} OPS</span>
          <span class="fork-run-allies-trigger-arrow" aria-hidden="true">
            <svg viewBox="0 0 16 16" class="fork-run-allies-trigger-arrow-svg">
              <path d="M3.5 6L8 10.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>
      </div>
    `;

    // 展开后的抽屉外壳与内部卡片
    const drawer = document.createElement('div');
    drawer.className = 'fork-run-allies-drawer';

    const drawerInner = document.createElement('div');
    drawerInner.className = 'fork-run-allies-drawer-inner';

    const detailCard = document.createElement('div');
    detailCard.className = 'fork-run-allies-detail-card';

    // 第一排：横向头像切换轨 (Allied Operatives Rail) —— 常驻顶部，不随切换重新构建
    const rail = document.createElement('div');
    rail.className = 'fork-run-allies-rail';
    const railItemBtns = [];

    allies.forEach((ally, idx) => {
      const itemBtn = document.createElement('button');
      itemBtn.type = 'button';
      itemBtn.className = `fork-run-allies-rail-item${idx === activeIdx ? ' is-active' : ''}`;
      itemBtn.setAttribute('aria-label', `查看队友 ${ally.name || '队员'}`);

      const avatar = trimStr(ally.avatar);
      const initialLetter = escapeHtml(trimStr(ally.name).slice(0, 1) || '友');

      itemBtn.innerHTML = `
        <span class="fork-run-allies-rail-avatar">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(ally.name || '')}">` : `<span class="fork-run-allies-rail-avatar-fallback">${initialLetter}</span>`}
        </span>
        <span class="fork-run-allies-rail-name">${escapeHtml(ally.name || '特勤')}</span>
      `;

      itemBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeIdx === idx) return;
        activeIdx = idx;
        railItemBtns.forEach((btn, bIdx) => {
          btn.classList.toggle('is-active', bIdx === activeIdx);
        });
        switchActiveAlly();
      });

      railItemBtns.push(itemBtn);
      rail.appendChild(itemBtn);
    });

    // 独立检视舱外壳：专供平移动画 (Dossier Wrap)
    const dossierWrap = document.createElement('div');
    dossierWrap.className = 'fork-run-allies-dossier-wrap';

    // 切换检视舱内容（方案 1：极速淡出 + 微距平移丝滑入场）
    function switchActiveAlly() {
      // 1. 触发瞬时退出微动效
      dossierWrap.classList.remove('is-entering');
      dossierWrap.classList.add('is-exiting');

      setTimeout(() => {
        renderDossierContent();
        dossierWrap.classList.remove('is-exiting');
        dossierWrap.classList.add('is-entering');
      }, 70);
    }

    // 重新填充检视舱具体内容
    function renderDossierContent() {
      dossierWrap.innerHTML = '';

      const activeAlly = allies[activeIdx] || allies[0];
      const name = trimStr(activeAlly.name) || '同行特勤';
      const cleanSerial = String(activeAlly.serial || '000000').replace(/\D/g, '').padStart(6, '0').slice(-6);
      const serial = cleanSerial || '000000';

      const sanCur = typeof activeAlly.san === 'number' ? activeAlly.san : 85;
      const sanMax = typeof activeAlly.sanMax === 'number' ? activeAlly.sanMax : 100;
      const sanStatus = trimStr(activeAlly.sanStatus) || '良好';
      const attireText = trimStr(activeAlly.attire) || '标准执行员常服。';
      const postureText = trimStr(activeAlly.posture) || '在掩体后方静止警戒。';

      // 专属数值：优先取 customStats，若无则尝试读取副本通用数值
      const allyStats = Array.isArray(activeAlly.customStats) && activeAlly.customStats.length > 0
        ? activeAlly.customStats
        : currentForkStats.map((st) => ({
            label: st.name,
            val: `${st.init}/${st.max}`
          }));

      const allyDeltas = Array.isArray(activeAlly.statDeltas) ? activeAlly.statDeltas.filter((d) => d && trimStr(d.name)) : [];

      // 第二排：姓名、六位工号与精神值仪表 (Profile Row)
      const profileRow = document.createElement('div');
      profileRow.className = 'fork-run-allies-profile-row';
      profileRow.innerHTML = `
        <div class="fork-run-allies-profile-meta">
          <span class="fork-run-allies-profile-name">${escapeHtml(name)}</span>
          <span class="fork-run-allies-profile-serial">NO. ${escapeHtml(serial)}</span>
        </div>
        <div class="fork-run-allies-profile-san">
          <span class="fork-run-allies-san-lbl">精神值</span>
          <span class="fork-run-allies-san-val">${sanCur}/${sanMax}</span>
          <span class="fork-run-allies-san-dot">·</span>
          <span class="fork-run-allies-san-status">${escapeHtml(sanStatus)}</span>
        </div>
      `;

      // 第三排：通栏着装与姿态镜头 (Dossier Blocks)
      const dossierSection = document.createElement('div');
      dossierSection.className = 'fork-run-allies-dossier-section';

      if (attireText) {
        const attireBlock = document.createElement('div');
        attireBlock.className = 'fork-run-vitals-field-block';
        attireBlock.innerHTML = `
          <div class="fork-run-vitals-field-head">
            <span class="fork-run-vitals-field-en">ATTIRE</span>
            <span class="fork-run-vitals-field-slash">//</span>
            <span class="fork-run-vitals-field-zh">着装</span>
          </div>
          <div class="fork-run-vitals-field-body">${escapeHtml(attireText)}</div>
        `;
        dossierSection.appendChild(attireBlock);
      }

      if (postureText) {
        const postureBlock = document.createElement('div');
        postureBlock.className = 'fork-run-vitals-field-block';
        postureBlock.innerHTML = `
          <div class="fork-run-vitals-field-head">
            <span class="fork-run-vitals-field-en">POSTURE</span>
            <span class="fork-run-vitals-field-slash">//</span>
            <span class="fork-run-vitals-field-zh">姿态</span>
          </div>
          <div class="fork-run-vitals-field-body">${escapeHtml(postureText)}</div>
        `;
        dossierSection.appendChild(postureBlock);
      }

      dossierWrap.append(profileRow, dossierSection);

      // 第四排：单行丝滑横向滑动轨 (专属数值)
      if (allyStats.length > 0) {
        const statsSection = document.createElement('div');
        statsSection.className = 'fork-run-vitals-stats-section';
        statsSection.setAttribute('role', 'region');
        statsSection.setAttribute('aria-label', `队友 ${name} 专属数值指标`);
        statsSection.innerHTML = allyStats.map((st) => `
          <div class="fork-run-vitals-stat-unit">
            <span class="fork-run-vitals-stat-k">${escapeHtml(st.label)}</span>
            <span class="fork-run-vitals-stat-v">${escapeHtml(st.val)}</span>
          </div>
        `).join('');
        dossierWrap.append(statsSection);
      }

      // 第五排：纯净微凹陷托盘 (当轮变动说明)
      if (allyDeltas.length > 0) {
        const deltaSection = document.createElement('div');
        deltaSection.className = 'fork-run-vitals-delta-section';
        deltaSection.innerHTML = allyDeltas.map((d) => {
          const rawNum = Number(d.delta);
          const deltaText = !Number.isNaN(rawNum)
            ? (rawNum > 0 ? `+${rawNum}` : String(rawNum))
            : String(d.delta || '');
          const reason = trimStr(d.reason);
          return `
            <div class="fork-run-vitals-delta-line">
              <span class="fork-run-vitals-delta-key">${escapeHtml(trimStr(d.name))}</span>
              <span class="fork-run-vitals-delta-num">${escapeHtml(deltaText)}</span>
              ${reason ? `<span class="fork-run-vitals-delta-reason">：${escapeHtml(reason)}</span>` : ''}
            </div>
          `;
        }).join('');
        dossierWrap.append(deltaSection);
      }
    }

    renderDossierContent();
    detailCard.append(rail, dossierWrap);

    drawerInner.append(detailCard);
    drawer.append(drawerInner);

    // 点击交互事件：展开/收起
    triggerCard.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = foldWrap.classList.toggle('is-expanded');
      triggerCard.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
      triggerCard.setAttribute('aria-label', `${isExpanded ? '收起' : '展开'}队友状态详情`);
    });

    foldWrap.append(triggerCard, drawer);
    return foldWrap;
  }

  /**
   * 按 NPC / 高危角色名字反查其立绘资产 src。
   *
   * AI 输出的 :::npc 块里只有名字，没有头像。头像要靠名字回查：
   *   - 副本 NPC：名字命中 currentForkNpcs → npcAvatar(id)
   *   - 高危角色：名字命中 currentForkHazardChars → charAvatar(id)
   * 抓不到返回空串（保留首字兜底）。
   * @param {string} name
   * @returns {Promise<string>} 资产 objectURL / URL，或空串
   */
  async function resolveNpcAvatarByName(name) {
    const nm = trimStr(name);
    if (!nm) return '';

    // 1. 副本 NPC：立绘直接存在卷宗 npc.avatar（dataURL / URL 字符串），不走资产库，同步返回
    const npcHit = (Array.isArray(currentForkNpcs) ? currentForkNpcs : [])
      .find((n) => n && trimStr(n.name) === nm && trimStr(n.avatar));
    if (npcHit) return trimStr(npcHit.avatar);

    // 2. 高危角色：立绘走同调档案资产库 charAvatar(id)
    if (!window.Storage || !window.DataRegistry || !DataRegistry.key) return '';
    const probes = [];
    (Array.isArray(currentForkHazardChars) ? currentForkHazardChars : []).forEach((c) => {
      if (c && trimStr(c.name) === nm && c.id && typeof DataRegistry.key.charAvatar === 'function') {
        probes.push(DataRegistry.key.charAvatar(c.id));
      }
    });
    for (const key of probes) {
      try {
        const src = await Storage.getAssetSrc(key);
        if (src) return src;
      } catch (_) { /* 继续探测下一个 */ }
    }
    return '';
  }

  /**
   * 构建现场目标/NPC 侦测雷达状态卡 (Target / NPC Surveillance Hub)。
   * - 零大长条：收起时呈现为一组纯净精致的 36px 圆形头像轨
   * - 点击头像触发展开/收起/平滑切人
   * - 检视舱内部只保留：第一排纯粹名字、第二排着装姿态、第三排专属数值轨与第四排变动托盘（无编号、无立场偏见）
   *
   * @param {Array<Object>} [npcList] NPC 数据数组
   */
  function buildNpcVitalsCard(npcList) {
    const DEMO_NPCS = [
      {
        id: 'npc_01',
        name: '护士长',
        avatar: '',
        attire: '洗得发白的双排扣护士袍，下摆沾有暗褐色喷溅状污迹，胸前斜插着一只金属体温计。',
        posture: '端坐在巡回分诊台后，双手平摊在病历夹边缘，面带僵硬礼貌的微笑直视前方。',
        customStats: [
          { label: '警戒度', val: '40/100' },
          { label: '生命体征', val: '稳定' }
        ],
        statDeltas: [
          { name: '警戒度', delta: 15, reason: '执行员跨过了隔离黄线，视线随即移转锁定' }
        ]
      },
      {
        id: 'npc_02',
        name: '值班医生',
        avatar: '',
        attire: '深绿手术服外罩薄塑胶围裙，橡胶手套尖端微微泛黄，脖颈挂着听诊器单耳听筒。',
        posture: '背对走廊整理配药推车上的玻璃药剂瓶，动作极其缓慢且毫无声息。',
        customStats: [
          { label: '警惕度', val: '65/100' },
          { label: '活动力', val: '3/5' }
        ],
        statDeltas: []
      }
    ];

    const rawList = Array.isArray(npcList) && npcList.length > 0 ? npcList : DEMO_NPCS;
    const npcs = rawList.filter((n) => n && typeof n === 'object');
    if (npcs.length === 0) return null;

    let activeIdx = 0;
    let isExpanded = shouldExpandComponentsByDefault(); // 默认展开态受「组件默认展开」开关控制

    const hubWrap = document.createElement('div');
    hubWrap.className = 'fork-run-npc-hub-wrap' + (isExpanded ? ' is-expanded' : '');

    // 顶部侦测雷达条 (Surveillance Radar Bar)：零长方块，纯净 36px 头像列
    const radarBar = document.createElement('div');
    radarBar.className = 'fork-run-npc-radar-bar';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'fork-run-npc-radar-label';
    labelWrap.innerHTML = `
      <span class="fork-run-npc-radar-tag">SURV // OBS</span>
      <span class="fork-run-npc-radar-hint">目标侦测</span>
    `;

    const rail = document.createElement('div');
    rail.className = 'fork-run-npc-avatar-rail';
    const avatarBtns = [];

    // 展开抽屉与内部卡片
    const drawer = document.createElement('div');
    drawer.className = 'fork-run-npc-drawer';

    const drawerInner = document.createElement('div');
    drawerInner.className = 'fork-run-npc-drawer-inner';

    const detailCard = document.createElement('div');
    detailCard.className = 'fork-run-npc-detail-card';

    // 检视舱外壳
    const dossierWrap = document.createElement('div');
    dossierWrap.className = 'fork-run-npc-dossier-wrap';

    function renderDossierContent() {
      dossierWrap.innerHTML = '';
      const target = npcs[activeIdx] || npcs[0];
      const name = trimStr(target.name) || '现场目标';
      const attireText = trimStr(target.attire) || '';
      const postureText = trimStr(target.posture) || '';

      const targetStats = Array.isArray(target.customStats) ? target.customStats : [];
      const targetDeltas = Array.isArray(target.statDeltas) ? target.statDeltas.filter((d) => d && trimStr(d.name)) : [];

      // 第一排：纯粹名字与折叠小按扭
      const nameRow = document.createElement('div');
      nameRow.className = 'fork-run-npc-name-row';
      nameRow.innerHTML = `
        <span class="fork-run-npc-name">${escapeHtml(name)}</span>
        <button type="button" class="fork-run-npc-close-btn" aria-label="收起目标详情">
          <svg viewBox="0 0 16 16" class="fork-run-npc-close-svg">
            <path d="M4 6L8 10L12 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      `;

      nameRow.querySelector('.fork-run-npc-close-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleExpand(false);
      });

      // 第二排：通栏着装与姿态独立区块
      const dossierSection = document.createElement('div');
      dossierSection.className = 'fork-run-npc-dossier-section';

      if (attireText) {
        const attireBlock = document.createElement('div');
        attireBlock.className = 'fork-run-vitals-field-block';
        attireBlock.innerHTML = `
          <div class="fork-run-vitals-field-head">
            <span class="fork-run-vitals-field-en">ATTIRE</span>
            <span class="fork-run-vitals-field-slash">//</span>
            <span class="fork-run-vitals-field-zh">着装</span>
          </div>
          <div class="fork-run-vitals-field-body">${escapeHtml(attireText)}</div>
        `;
        dossierSection.appendChild(attireBlock);
      }

      if (postureText) {
        const postureBlock = document.createElement('div');
        postureBlock.className = 'fork-run-vitals-field-block';
        postureBlock.innerHTML = `
          <div class="fork-run-vitals-field-head">
            <span class="fork-run-vitals-field-en">POSTURE</span>
            <span class="fork-run-vitals-field-slash">//</span>
            <span class="fork-run-vitals-field-zh">姿态</span>
          </div>
          <div class="fork-run-vitals-field-body">${escapeHtml(postureText)}</div>
        `;
        dossierSection.appendChild(postureBlock);
      }

      dossierWrap.append(nameRow, dossierSection);

      // 第三排：专属横向滑动数值轨
      if (targetStats.length > 0) {
        const statsSection = document.createElement('div');
        statsSection.className = 'fork-run-vitals-stats-section';
        statsSection.setAttribute('role', 'region');
        statsSection.setAttribute('aria-label', `目标 ${name} 专属数值指标`);
        statsSection.innerHTML = targetStats.map((st) => `
          <div class="fork-run-vitals-stat-unit">
            <span class="fork-run-vitals-stat-k">${escapeHtml(st.label)}</span>
            <span class="fork-run-vitals-stat-v">${escapeHtml(st.val)}</span>
          </div>
        `).join('');
        dossierWrap.append(statsSection);
      }

      // 第四排：纯净微凹陷变动托盘
      if (targetDeltas.length > 0) {
        const deltaSection = document.createElement('div');
        deltaSection.className = 'fork-run-vitals-delta-section';
        deltaSection.innerHTML = targetDeltas.map((d) => {
          const rawNum = Number(d.delta);
          const deltaText = !Number.isNaN(rawNum)
            ? (rawNum > 0 ? `+${rawNum}` : String(rawNum))
            : String(d.delta || '');
          const reason = trimStr(d.reason);
          return `
            <div class="fork-run-vitals-delta-line">
              <span class="fork-run-vitals-delta-key">${escapeHtml(trimStr(d.name))}</span>
              <span class="fork-run-vitals-delta-num">${escapeHtml(deltaText)}</span>
              ${reason ? `<span class="fork-run-vitals-delta-reason">：${escapeHtml(reason)}</span>` : ''}
            </div>
          `;
        }).join('');
        dossierWrap.append(deltaSection);
      }
    }

    function switchActiveNpc() {
      dossierWrap.classList.remove('is-entering');
      dossierWrap.classList.add('is-exiting');

      setTimeout(() => {
        renderDossierContent();
        dossierWrap.classList.remove('is-exiting');
        dossierWrap.classList.add('is-entering');
      }, 70);
    }

    function toggleExpand(expand) {
      isExpanded = expand;
      hubWrap.classList.toggle('is-expanded', isExpanded);
      avatarBtns.forEach((btn, bIdx) => {
        btn.classList.toggle('is-active', isExpanded && bIdx === activeIdx);
      });
    }

    // 渲染 36px 纯圆头像列（去名字冗余，位置靠左）
    npcs.forEach((npc, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `fork-run-npc-avatar-btn${isExpanded && idx === activeIdx ? ' is-active' : ''}`;
      btn.setAttribute('aria-label', `观测目标 ${npc.name || 'NPC'}`);

      const avatar = trimStr(npc.avatar);
      const initialLetter = escapeHtml(trimStr(npc.name).slice(0, 1) || '目');

      btn.innerHTML = `
        <span class="fork-run-npc-avatar-core">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="${escapeHtml(npc.name || '')}">` : `<span class="fork-run-npc-avatar-fallback">${initialLetter}</span>`}
        </span>
      `;

      // AI 块里没有头像字段，按名字异步反查副本 NPC / 高危角色立绘，抓到就替换首字兜底
      if (!avatar) {
        resolveNpcAvatarByName(npc.name).then((src) => {
          if (!src) return;
          const core = btn.querySelector('.fork-run-npc-avatar-core');
          if (!core) return;
          core.innerHTML = `<img src="${escapeHtml(src)}" alt="${escapeHtml(npc.name || '')}">`;
        }).catch(() => {});
      }

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isExpanded && activeIdx === idx) {
          // 点击当前激活头像，收起
          toggleExpand(false);
          return;
        }

        activeIdx = idx;
        if (isExpanded) {
          avatarBtns.forEach((b, bI) => b.classList.toggle('is-active', bI === activeIdx));
          switchActiveNpc();
        } else {
          renderDossierContent();
          toggleExpand(true);
        }
      });

      avatarBtns.push(btn);
      rail.appendChild(btn);
    });

    renderDossierContent();

    // 位置互换：头像轨居左，标题标签靠右
    radarBar.append(rail, labelWrap);
    detailCard.append(dossierWrap);
    drawerInner.append(detailCard);
    drawer.append(drawerInner);

    hubWrap.append(radarBar, drawer);
    return hubWrap;
  }

  /**
   * 构建通关主线任务进度状态卡 (Clear Mission Objectives Hub)。
   * - 警戒红重点色底 (#8E2B2B / var(--primary-color)) + 米白反色字 (#EDEBDD / var(--bg-color))
   * - 刻度指示槽：Segmented Pips 直观反映已达成、推进中与待解锁任务数
   * - 默认展开呈现任务列表，每项带工整编号、达成状态胶囊与判定指引
   *
   * @param {Array<Object>} [missionsData] 任务列表数据
   */
  function buildMissionsCard(missionsData) {
    const DEMO_MISSIONS = [
      {
        id: 'mission_01',
        goal: '调查离心净水塔地下三层配药室的异常死因',
        criteria: '在配药推车或废弃病历夹中寻得含有重金属试剂的分析报告。',
        status: 'achieved' // achieved | active | pending
      },
      {
        id: 'mission_02',
        goal: '夺取或借调值班护士长的特勤通行磁卡',
        criteria: '通过交涉、偷换或战术制服解除其随身保管的门禁中继器。',
        status: 'active'
      },
      {
        id: 'mission_03',
        goal: '启动负三层紧急防灾总排污气动闸门逃生',
        criteria: '排净管道高浓度腐蚀残液后完成手动机械拉闸。',
        status: 'pending'
      }
    ];

    const rawList = Array.isArray(missionsData) && missionsData.length > 0 ? missionsData : DEMO_MISSIONS;
    const missions = rawList.filter((m) => m && typeof m === 'object');
    if (missions.length === 0) return null;

    const achievedCount = missions.filter((m) => m.status === 'achieved' || m.achieved === true).length;
    const totalCount = missions.length;

    // 外层主容器（默认展开态受「组件默认展开」开关控制）
    const missionExpanded = shouldExpandComponentsByDefault();
    const foldWrap = document.createElement('div');
    foldWrap.className = 'fork-run-mission-fold-wrap' + (missionExpanded ? ' is-expanded' : '');

    // 顶部双拼条：左侧主指标卡 (红底) + 右侧独立任务列表按键 (黑底)
    const twinBar = document.createElement('div');
    twinBar.className = 'fork-run-mission-twin-bar';

    // 1. 左侧主卡：展示信标、微字编码与任务进度 0/3
    const mainCard = document.createElement('div');
    mainCard.className = 'fork-run-mission-main-card';
    mainCard.innerHTML = `
      <div class="fork-run-mission-trigger-main">
        <span class="fork-run-mission-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16" class="fork-run-mission-trigger-icon-svg">
            <!-- 战术信标/十字瞄准罗盘纯 SVG -->
            <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/>
            <circle cx="8" cy="8" r="2.5" fill="currentColor"/>
            <path d="M8 0.5V3M8 13V15.5M0.5 8H3M13 8H15.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </span>
        <div class="fork-run-mission-trigger-info">
          <span class="fork-run-mission-trigger-tag">OBJECTIVES // MISSION-LOG</span>
          <div class="fork-run-mission-heading-row">
            <span class="fork-run-mission-trigger-heading">任务进度</span>
            <span class="fork-run-mission-counter-val">${achievedCount}/${totalCount}</span>
          </div>
        </div>
      </div>
    `;

    // 2. 右侧独立按键卡：反色黑底，方案 3 极简双层右对齐 (INDEX + 任务列表，无箭头)
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'fork-run-mission-action-card';
    actionBtn.setAttribute('aria-expanded', missionExpanded ? 'true' : 'false');
    actionBtn.setAttribute('aria-label', missionExpanded ? '收起主线任务列表' : '展开主线任务列表');
    actionBtn.innerHTML = `
      <div class="fork-run-mission-action-content">
        <span class="fork-run-mission-action-tag">INDEX</span>
        <span class="fork-run-mission-action-heading">任务列表</span>
      </div>
    `;

    twinBar.append(mainCard, actionBtn);

    // 展开抽屉与独立小卡片列表容器（无大外壳底板，透出底层背景色）
    const drawer = document.createElement('div');
    drawer.className = 'fork-run-mission-drawer';

    const drawerInner = document.createElement('div');
    drawerInner.className = 'fork-run-mission-drawer-inner';

    const listWrap = document.createElement('div');
    listWrap.className = 'fork-run-mission-list-wrap';

    // 渲染一张张独立任务小卡片（彻底移除后台判定 criteria，纯净二态：已达成 / 推进中）
    missions.forEach((item, index) => {
      const isDone = item.status === 'achieved' || item.achieved === true;
      const goal = trimStr(item.goal || item.text) || '未指明具体作战目标';
      const code = String(index + 1).padStart(2, '0');

      const badgeText = isDone ? '已达成' : '推进中';
      const badgeCls = isDone ? 'is-achieved' : 'is-active';

      const cardItem = document.createElement('div');
      cardItem.className = `fork-run-mission-card-item${isDone ? ' is-done' : ' is-focused'}`;
      cardItem.innerHTML = `
        <span class="fork-run-mission-card-code">${code}</span>
        <span class="fork-run-mission-card-goal">${isDone ? '<span class="fork-run-mission-check-mark">✓ </span>' : '<span class="fork-run-mission-active-mark">▸ </span>'}${escapeHtml(goal)}</span>
        <span class="fork-run-mission-card-badge ${badgeCls}">${badgeText}</span>
      `;
      listWrap.appendChild(cardItem);
    });

    drawerInner.append(listWrap);
    drawer.append(drawerInner);

    // 点击右侧按键（或左侧主卡）触发展开/收起
    function toggleMissionExpand(e) {
      if (e) e.stopPropagation();
      const isExp = foldWrap.classList.toggle('is-expanded');
      actionBtn.setAttribute('aria-expanded', isExp ? 'true' : 'false');
      actionBtn.setAttribute('aria-label', `${isExp ? '收起' : '展开'}主线任务列表`);
    }

    actionBtn.addEventListener('click', toggleMissionExpand);
    mainCard.addEventListener('click', toggleMissionExpand);

    foldWrap.append(twinBar, drawer);
    return foldWrap;
  }

  /**
   * 构建时空定格排版 (Chrono-Spatial Editorial Layout)。
   * 采用极简杂志风：时分巨幅 Hero Typography、错落气象、优雅日期、长地点与场景导读。
   * 无卡片底色与分割线，完全融入正文。
   *
   * @param {number} turn 轮次序号
   * @param {Object|Array} anchorData 锚点数据
   */
  function buildStatusBar(turn, anchorData) {
    const isRich = anchorData && typeof anchorData === 'object' && !Array.isArray(anchorData);

    // 默认假数据演示
    const timeHero = trimStr(isRich ? anchorData.timeHero : '') || '23:15';
    const dateText = trimStr(isRich ? anchorData.date : '') || '2044.11.03 星期四';
    const weatherText = trimStr(isRich ? anchorData.weather : '') || '深秋 15°C 小雨';
    const locText = trimStr(isRich ? anchorData.location : '') || '新沪荒原第七收容所 · 离心净水塔地下三层沉淀走廊';
    const sceneText = trimStr(isRich ? anchorData.scene : '') || '浑浊的工业酸水在脚下生锈的蜂窝钢构管道里轰鸣激荡，潮湿冰冷的雾气夹杂着重烃机油味弥漫在整条狭窄的走廊中，远处隐约传来巡逻机卫沉重的液压步伐声与低频电磁蜂鸣。';

    const container = document.createElement('div');
    container.className = 'fork-run-anchor-card';

    // 1. 上半部分：纵横嵌套区（左侧战术微块 + 右侧矩阵）
    const upperRow = document.createElement('div');
    upperRow.className = 'fork-run-editorial-upper';

    // 左侧：重点色底方块条 + 纵排英文“ANCHOR”（背景色反白字，90度纵向）
    const patchCol = document.createElement('div');
    patchCol.className = 'fork-run-editorial-patch';
    patchCol.setAttribute('aria-hidden', 'true');
    patchCol.innerHTML = `
      <span class="fork-run-editorial-patch-text">ANCHOR</span>
    `;

    // 右侧：时间、气象、日期、长地点
    const mainCol = document.createElement('div');
    mainCol.className = 'fork-run-editorial-main';

    const timeBar = document.createElement('div');
    timeBar.className = 'fork-run-editorial-time-bar';

    const heroEl = document.createElement('span');
    heroEl.className = 'fork-run-editorial-time-hero';
    heroEl.textContent = timeHero;

    const weatherEl = document.createElement('span');
    weatherEl.className = 'fork-run-editorial-weather';
    weatherEl.textContent = weatherText;

    timeBar.append(heroEl, weatherEl);

    const dateEl = document.createElement('div');
    dateEl.className = 'fork-run-editorial-date';
    dateEl.textContent = dateText;

    const locRow = document.createElement('div');
    locRow.className = 'fork-run-editorial-loc';
    locRow.innerHTML = `
      <svg viewBox="0 0 24 24" class="fork-run-editorial-loc-icon" aria-hidden="true">
        <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
      </svg>
      <span class="fork-run-editorial-loc-text">${escapeHtml(locText)}</span>
    `;

    mainCol.append(timeBar, dateEl, locRow);
    upperRow.append(patchCol, mainCol);

    // 2. 下半部分：场景速写（通栏杂志引言导读排版，纯留白呼吸自然衔接正文）
    const sceneEl = document.createElement('div');
    sceneEl.className = 'fork-run-editorial-scene';
    sceneEl.textContent = sceneText;

    container.append(upperRow, sceneEl);
    return container;
  }

  /* ================= 渲染 ================= */

  /**
   * 挂一段 AI 叙事。通栏正文，不是气泡。
   * @param {Object} seg
   * @param {string} seg.text 叙事正文（支持 Markdown）
   * @param {number} [seg.turn] 轮次；给了才渲染状态栏
   * @param {Array} [seg.status] 状态栏读数项
   */
  function appendNarration(seg) {
    if (!streamEl) return null;
    clearEmptyState();

    // parsed 模式：内容来自契约解析器，各状态卡「有数据才渲染」，绝不回落 DEMO；
    // 非 parsed（演示 / 旧调用）：维持原有行为，缺省时组件内部挂 DEMO 兜底。
    const isParsed = !!(seg && seg.parsed);

    const block = document.createElement('div');
    let blockClass = 'fork-run-narration';
    if (pendingVariantAnim && seg && seg.recordId && pendingVariantAnim.recordId === seg.recordId) {
      blockClass += (pendingVariantAnim.dir === 'next' ? ' is-variant-slide-next' : ' is-variant-slide-prev');
    }
    block.className = blockClass;
    // 编辑改的是 AI 原文（含 ::: 块）。parsed 模式优先存 rawText，回退 text。
    block.dataset.rawText = trimStr((seg && seg.rawText) || (seg && seg.text));
    if (seg && seg.recordId) block.dataset.recordId = seg.recordId;

    // 场景锚定卡：parsed 模式下有 scene 才渲染；非 parsed 保持原演示行为
    if (isParsed) {
      if (seg.status) {
        block.appendChild(buildStatusBar((seg && seg.turn) || 1, seg.status));
      }
    } else {
      const anchorData = (seg && seg.status) || {};
      block.appendChild(buildStatusBar((seg && seg.turn) || 1, anchorData));
    }

    const raw = trimStr(seg && seg.text);

    // 副本专属：先把本轮散落各处的 think 全部归拢抽离，得到干净正文；
    // think 折叠栏固定挂在「场景片段」下方、正文之上，默认折叠，空则不渲染。
    const { thinks, cleaned } = extractThinkBlocks(raw);
    const thinkFold = buildThinkFoldCard(thinks);
    if (thinkFold) block.appendChild(thinkFold);

    const textEl = document.createElement('div');
    // 复用助手端整套 chat-md-* Markdown 视觉（代码块/表格/列表/引用/思维链），
    // 副本专属的引号高亮与 think 皮肤再单独叠加覆盖。
    textEl.className = 'fork-run-narration-text chat-bubble-content';

    // 走项目自带的 Markdown 引擎；缺席时退回按空行分段的纯文本，
    // 至少保证首行缩进的排版语义不丢。用抽走 think 后的 cleaned 正文渲染。
    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.render === 'function') {
      // 渲染后再叠一道副本专属引号高亮（对白/强调引号套重点色）
      textEl.innerHTML = highlightForkQuotes(RetroflowMarkdown.render(cleaned));
      // 委托绑定代码块一键复制（复用助手端逻辑）
      if (typeof RetroflowMarkdown.bindCodeCopy === 'function') {
        RetroflowMarkdown.bindCodeCopy(textEl);
      }
    } else {
      textEl.innerHTML = cleaned
        .split(/\n{2,}/)
        .map((p) => `<p>${highlightForkQuotes(escapeHtml(p).replace(/\n/g, '<br>'))}</p>`)
        .join('');
    }

    block.appendChild(textEl);

    // 执行员现场状态卡 (Envoy Vitals Card)：parsed 模式下有 state 块才渲染，
    // 避免 AI 没输出执行员状态时凭空显示卡片误导用户。
    if (isParsed) {
      if (seg.vitals) {
        block.appendChild(buildVitalsCard(seg.vitals));
      }
    } else {
      const vitalData = (seg && seg.vitals) || {};
      block.appendChild(buildVitalsCard(vitalData));
    }

    // 同行队友状态卡：parsed 模式下有队友才渲染；空数组即不渲染
    const alliesData = isParsed ? (Array.isArray(seg.allies) ? seg.allies : []) : ((seg && seg.allies) || null);
    if (!isParsed || alliesData.length > 0) {
      const alliedCard = buildAlliedVitalsCard(alliesData);
      if (alliedCard) block.appendChild(alliedCard);
    }

    // 现场目标/NPC 侦测雷达状态卡：parsed 模式下有 NPC 才渲染
    const npcsData = isParsed ? (Array.isArray(seg.npcs) ? seg.npcs : []) : ((seg && seg.npcs) || null);
    if (!isParsed || npcsData.length > 0) {
      const npcCard = buildNpcVitalsCard(npcsData);
      if (npcCard) block.appendChild(npcCard);
    }

    // 通关主线任务进度状态卡：parsed 模式下有任务才渲染
    const missionsData = isParsed
      ? (Array.isArray(seg.missions) ? seg.missions : [])
      : ((seg && (seg.missions || seg.clearConditions)) || null);
    if (!isParsed || missionsData.length > 0) {
      const missionCard = buildMissionsCard(missionsData);
      if (missionCard) block.appendChild(missionCard);
    }

    // 叙事末尾现实遥测微标：纯英文等宽字体、无图标、无分割线
    // 渲染本轮输出时的现实时间戳与字数统计，并在多版本时渲染战术翻页器
    const telemetryEl = document.createElement('div');
    telemetryEl.className = 'fork-run-narration-telemetry';

    // 时间处理：优先取记录落库时间，无则取当前时间。精简为「月.日 时:分」（如 09.26 10:08）
    const stampDate = (seg && seg.createdAt) ? new Date(Number(seg.createdAt)) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timeStr = `${pad(stampDate.getMonth() + 1)}.${pad(stampDate.getDate())} ${pad(stampDate.getHours())}:${pad(stampDate.getMinutes())}`;

    // 字数统计：优先计算正文字符数
    const bodyStr = String((seg && seg.text) || '').trim();
    const charCount = bodyStr.length;
    const formattedChars = charCount.toLocaleString('en-US');

    // 多分支版本翻页器（纯 SVG 微箭头，无 emoji，机能等宽）
    const variants = (seg && Array.isArray(seg.variants)) ? seg.variants : null;
    const totalVariants = variants ? variants.length : 1;
    const currentVariantIdx = (seg && typeof seg.activeVariantIndex === 'number' && seg.activeVariantIndex >= 0)
      ? seg.activeVariantIndex
      : 0;

    let branchSwitcherHtml = '';
    if (totalVariants > 1) {
      const prevDisabled = currentVariantIdx <= 0;
      const nextDisabled = currentVariantIdx >= totalVariants - 1;
      branchSwitcherHtml = `
        <div class="fork-run-branch-switcher" data-record-id="${escapeHtml(seg.recordId || '')}">
          <button type="button" class="fork-run-branch-btn is-prev" ${prevDisabled ? 'disabled aria-disabled="true"' : ''} title="上一分支">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <span class="fork-run-branch-counter">${String(currentVariantIdx + 1).padStart(2, '0')} / ${String(totalVariants).padStart(2, '0')}</span>
          <button type="button" class="fork-run-branch-btn is-next" ${nextDisabled ? 'disabled aria-disabled="true"' : ''} title="下一分支">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
          </button>
          <button type="button" class="fork-run-branch-btn is-delete" title="删除当前分支">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
          </button>
        </div>
      `;
    }

    telemetryEl.innerHTML = `
      <div class="fork-run-telemetry-left">
        <span class="fork-run-narration-telemetry-time">${timeStr}</span>
        <span class="fork-run-telemetry-dot">·</span>
        <span class="fork-run-narration-telemetry-chars">${formattedChars} CHARS</span>
      </div>
      ${branchSwitcherHtml}
    `;

    // 绑定多分支切换点击事件
    if (totalVariants > 1 && seg.recordId) {
      const prevBtn = telemetryEl.querySelector('.fork-run-branch-btn.is-prev');
      const nextBtn = telemetryEl.querySelector('.fork-run-branch-btn.is-next');

      if (prevBtn) {
        prevBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isReadonly || currentInference || currentVariantIdx <= 0) return;
          if (window.ForkRunStore && typeof ForkRunStore.switchRunRecordVariant === 'function') {
            pendingVariantAnim = { recordId: seg.recordId, dir: 'prev' };
            await ForkRunStore.switchRunRecordVariant(currentRunId, seg.recordId, currentVariantIdx - 1);
            await renderRunRecords();
          }
        });
      }

      if (nextBtn) {
        nextBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isReadonly || currentInference || currentVariantIdx >= totalVariants - 1) return;
          if (window.ForkRunStore && typeof ForkRunStore.switchRunRecordVariant === 'function') {
            pendingVariantAnim = { recordId: seg.recordId, dir: 'next' };
            await ForkRunStore.switchRunRecordVariant(currentRunId, seg.recordId, currentVariantIdx + 1);
            await renderRunRecords();
          }
        });
      }

      const delBtn = telemetryEl.querySelector('.fork-run-branch-btn.is-delete');
      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (isReadonly || currentInference) return;

          let confirmed = true;
          if (window.RetroModal && typeof RetroModal.confirm === 'function') {
            confirmed = await RetroModal.confirm({
              tag: 'BRANCH // 抹除分支',
              message: '确认删除当前分支回复吗？',
              detail: `将移除当前选中的分支（${String(currentVariantIdx + 1).padStart(2, '0')} / ${String(totalVariants).padStart(2, '0')}），保留其余分支。此操作无法撤销。`,
              confirmText: '确认删除',
              cancelText: '取消',
              danger: true
            });
          }

          if (!confirmed) return;

          if (window.ForkRunStore && typeof ForkRunStore.deleteRunRecordVariant === 'function') {
            const res = await ForkRunStore.deleteRunRecordVariant(currentRunId, seg.recordId, currentVariantIdx);
            if (res) {
              toast('BRANCH // 已抹除', '分支已移除', '当前视角已自动切换至相邻分支', 'success');
              await renderRunRecords();
            } else {
              toast('BRANCH // 失败', '分支删除未完成', '请稍后重试', 'warning');
            }
          }
        });
      }
    }

    block.appendChild(telemetryEl);

    // 挂载战术多选复选框与点击交互
    attachRowBatchSelection(block);

    bindLongPress(block, 'narration', seg);
    streamEl.appendChild(block);
    return block;
  }

  /* ================= 线索触发系统 ================= */

  const CLUE_GRACE_TURNS = 3; // 触发后允许 AI 自然亮出的宽限窗口（轮）

  /**
   * 把一条「线索已解锁」提示条追加到某轮叙事块内（正文/状态卡之下、组件之上收尾处）。
   * 纯 SVG 图标、无分割线、机能双语微标，跟着这轮叙事走，重进本翻记录仍在。
   * @param {HTMLElement} block 目标叙事 DOM
   * @param {string} clueName 线索名称
   */
  function appendClueUnlockNotice(block, clueName) {
    if (!block) return;
    const notice = document.createElement('div');
    notice.className = 'fork-run-clue-notice';
    notice.innerHTML = `
      <span class="fork-run-clue-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7zm-3 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1z"/></svg>
      </span>
      <span class="fork-run-clue-notice-text">
        <span class="fork-run-clue-notice-zh">获得新线索 · ${escapeHtml(trimStr(clueName) || '未命名线索')}</span>
        <span class="fork-run-clue-notice-en">CLUE UNLOCKED // ARCHIVED</span>
      </span>
    `;
    // 追加在叙事块末尾（telemetry 之前更贴正文；简起见挂末尾，视觉在遥测下方也成立）
    block.appendChild(notice);
  }

  /**
   * 把一条「核心真相解明」提示条追加到某轮叙事块内。
   * 与线索提示条同一套机能微卡结构，加 is-truth 修饰做视觉分级（真相是终局级揭示，比线索更重）。
   * 纯 SVG 图标（钥匙孔洞察意象）、无分割线、双语微标、无 emoji。
   * @param {HTMLElement} block 目标叙事 DOM
   */
  function appendTruthUnlockNotice(block) {
    if (!block) return;
    const notice = document.createElement('div');
    notice.className = 'fork-run-clue-notice is-truth';
    notice.innerHTML = `
      <span class="fork-run-clue-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16zm0 3a3 3 0 0 0-3 3 1 1 0 0 0 2 0 1 1 0 1 1 1 1c0 .6-.2.9-.8 1.4-.7.6-1.2 1.2-1.2 2.2a1 1 0 0 0 2 0c0-.3.1-.4.5-.8.8-.7 1.5-1.5 1.5-2.8a3 3 0 0 0-3-3zm0 9.5a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z"/></svg>
      </span>
      <span class="fork-run-clue-notice-text">
        <span class="fork-run-clue-notice-zh">核心真相解明</span>
        <span class="fork-run-clue-notice-en">CORE TRUTH UNVEILED // SEALED</span>
      </span>
    `;
    block.appendChild(notice);
  }

  /**
   * 把一条「故事进入尾声」提示条追加到某轮叙事块内。
   * 与线索提示条同一套机能微卡结构，加 is-ending 修饰做视觉分级。
   * 这一刻只是「结局条件命中、开始收尾」，不是「已通关」，故文案强调过程而非终点。
   * 纯 SVG 图标（收束/沙漏意象）、无分割线、双语微标、无 emoji。
   * @param {HTMLElement} block 目标叙事 DOM
   * @param {string} endingName 命中的结局名
   */
  function appendEndingUnlockNotice(block, endingName) {
    if (!block) return;
    const notice = document.createElement('div');
    notice.className = 'fork-run-clue-notice is-ending';
    notice.innerHTML = `
      <span class="fork-run-clue-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M6 2a1 1 0 0 0 0 2h1v3.59a3 3 0 0 0 .88 2.12L10.59 12l-2.71 2.29A3 3 0 0 0 7 16.41V20H6a1 1 0 0 0 0 2h12a1 1 0 0 0 0-2h-1v-3.59a3 3 0 0 0-.88-2.12L13.41 12l2.71-2.29A3 3 0 0 0 17 7.59V4h1a1 1 0 0 0 0-2H6zm3 5.59V4h6v3.59a1 1 0 0 1-.29.7L12 10.59 9.29 8.29A1 1 0 0 1 9 7.59z"/></svg>
      </span>
      <span class="fork-run-clue-notice-text">
        <span class="fork-run-clue-notice-zh">故事进入尾声 · ${escapeHtml(trimStr(endingName) || '未命名结局')}</span>
        <span class="fork-run-clue-notice-en">ENDING APPROACHING // CONVERGING</span>
      </span>
    `;
    block.appendChild(notice);
  }

  /**
   * 重渲染时，算出某条叙事记录该挂哪些「已解锁线索」的提示条名字。
   * 混合策略，跟着记录本身走，删档也不错位：
   *   - AI 亮出（记录 content 里有 ::: clue）：按本条 parsed.clues 反推命中的已解锁线索；
   *   - 超时兜底（无标记）：优先按 unlockedRecordId === 本条记录 id 匹配（稳，不受轮号口径漂移影响）；
   *     老存档没记 recordId 时，退回 unlockedTurn === 本轮 turn 匹配。
   * @param {Object} parsed  本条记录的解析结果
   * @param {number} turn    本条记录的渲染轮次
   * @param {string} recordId 本条记录的持久化 id（超时兜底靠它精准匹配）
   * @returns {string[]} 线索名数组（去重、去空）
   */
  function collectUnlockedClueNamesForRecord(parsed, turn, recordId) {
    const clueState = (currentRun && currentRun.clues) || {};
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    if (!forkClues.length) return [];

    const nameOf = (id) => {
      const clue = forkClues.find((c) => trimStr(c && c.id) === trimStr(id));
      return trimStr(clue && clue.name);
    };
    const unlockedIds = Object.keys(clueState).filter(
      (id) => clueState[id] && clueState[id].status === 'unlocked'
    );
    if (!unlockedIds.length) return [];

    const names = [];
    const seen = new Set();
    const push = (id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const nm = nameOf(id);
      if (nm) names.push(nm);
    };

    // 1. AI 亮出：本条 content 里声明的编号，容错解析到已解锁 id
    const declaredIds = Array.isArray(parsed && parsed.clues) ? parsed.clues : [];
    for (const rawId of declaredIds) {
      const resolved = resolveDeclaredClueId(trimStr(rawId), unlockedIds);
      if (resolved && clueState[resolved] && clueState[resolved].status === 'unlocked') push(resolved);
    }

    // 2. 超时兜底：优先按 unlockedRecordId 精准匹配本条记录；老档没记 id 时退回 unlockedTurn 匹配
    const t = Number(turn) || 0;
    const rid = trimStr(recordId);
    for (const id of unlockedIds) {
      const st = clueState[id];
      if (!st || st.unlockedBy !== 'timeout') continue;
      const stRid = trimStr(st.unlockedRecordId);
      if (stRid) {
        if (rid && stRid === rid) push(id);
      } else if ((Number(st.unlockedTurn) || 0) === t) {
        push(id); // 老存档兼容路径
      }
    }

    return names;
  }

  /**
   * 真相上下文：供 System Prompt 常驻块判定是否拼「已解明的核心真相」。
   * @returns {{ truthUnlocked: boolean }}
   */
  function buildTruthCtx() {
    return { truthUnlocked: !!(currentRun && currentRun.truthUnlocked) };
  }

  /**
   * 构建世界书作用域所需的角色 id 列表（NPC + 高危角色）。
   * 供 requestInference 传给 fork-run-api → worldbook-engine 做副本世界书角色绑定过滤。
   * @returns {string[]}
   */
  function buildRosterIds() {
    const ids = [];
    (Array.isArray(currentForkNpcs) ? currentForkNpcs : []).forEach(function (n) {
      if (n && n.id) ids.push(String(n.id));
    });
    // 高危角色用原始 id 快照（未经名字过滤），保证档案缺名字也能参与世界书角色绑定
    (Array.isArray(currentForkHazardIds) ? currentForkHazardIds : []).forEach(function (id) {
      if (id) ids.push(String(id));
    });
    // 去重
    return ids.filter((id, i, arr) => arr.indexOf(id) === i);
  }

  /**
   * 取当前世界线的世界书会话覆写（黑名单）。供 requestInference 透传给引擎，
   * 让本条线显式关掉的 book / entry 不参与装配。默认全空 = 完全遵从库自身开关。
   * @returns {{disabledBookIds:string[], disabledEntryIds:string[]}}
   */
  function buildWbOverrides() {
    const ov = currentRun && currentRun.worldbookOverrides;
    if (!ov || typeof ov !== 'object') return { disabledBookIds: [], disabledEntryIds: [] };
    return {
      disabledBookIds: Array.isArray(ov.disabledBookIds) ? ov.disabledBookIds.slice() : [],
      disabledEntryIds: Array.isArray(ov.disabledEntryIds) ? ov.disabledEntryIds.slice() : []
    };
  }

  /**
   * 取真相解明的一次性导演指令（深度注入 depthItem）。
   * 仅在「真相已解明 且 导演指令尚未发过」时返回一条，返回后立刻置 truthDirectiveSent，
   * 保证整条世界线只发一次。深度 1（贴执行员最新行动之前），system 角色。
   * @returns {Array} depthItems，无则空数组
   */
  function takeTruthDirectiveDepthItem() {
    if (!currentRun || !currentRun.truthUnlocked || currentRun.truthDirectiveSent) return [];
    const desc = trimStr(currentFork && currentFork.hiddenTruth && currentFork.hiddenTruth.desc);
    if (!desc || !window.ForkRunPrompt || typeof ForkRunPrompt.buildTruthDirectiveBlock !== 'function') return [];
    const content = ForkRunPrompt.buildTruthDirectiveBlock(desc);
    if (!trimStr(content)) return [];
    // 置已发标记：内存态即时生效 + 落库持久化（失败也不重试，避免卡住请求）
    currentRun.truthDirectiveSent = true;
    if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
      ForkRunStore.updateRun(currentRunId, { truthDirectiveSent: true }).catch((err) => {
        console.warn('[ForkRun] 真相导演指令已发标记写入失败：', err);
      });
    }
    return [{ depth: 1, role: 'system', content }];
  }

  /**
   * 结局上下文：供 System Prompt 常驻收尾基调块判定是否拼「本副本的结局走向」。
   * 返回命中的结局 id，prompt 侧据此从 fork.endings 反查 name/desc。
   * @returns {{ endingSettled: boolean, endingId: string }}
   */
  function buildEndingCtx() {
    return {
      endingSettled: !!(currentRun && currentRun.endingSettled),
      endingId: trimStr(currentRun && currentRun.endingId)
    };
  }

  /**
   * 取结局降临的一次性收尾导演指令（深度注入 depthItem）。
   * 仅在「结局已定 且 收尾导演指令尚未发过」时返回一条，返回后立刻置 endingDirectiveSent，
   * 保证整条世界线只发一次。深度 1（贴执行员最新行动之前），system 角色。
   * 常驻收尾基调块另由 System Prompt 每轮承载，此处只是命中当轮的转折信号。
   * @returns {Array} depthItems，无则空数组
   */
  function takeEndingDirectiveDepthItem() {
    if (!currentRun || !currentRun.endingSettled || currentRun.endingDirectiveSent) return [];
    const forkEndings = (currentFork && Array.isArray(currentFork.endings)) ? currentFork.endings : [];
    const hitEnding = forkEndings.find((ed) => trimStr(ed && ed.id) === trimStr(currentRun.endingId));
    const name = trimStr(hitEnding && hitEnding.name);
    const desc = trimStr(hitEnding && hitEnding.desc);
    if (!desc || !window.ForkRunPrompt || typeof ForkRunPrompt.buildEndingDirectiveBlock !== 'function') return [];
    const content = ForkRunPrompt.buildEndingDirectiveBlock(name, desc);
    if (!trimStr(content)) return [];
    // 置已发标记：内存态即时生效 + 落库持久化（失败也不重试，避免卡住请求）
    currentRun.endingDirectiveSent = true;
    if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
      ForkRunStore.updateRun(currentRunId, { endingDirectiveSent: true }).catch((err) => {
        console.warn('[ForkRun] 结局收尾导演指令已发标记写入失败：', err);
      });
    }
    return [{ depth: 1, role: 'system', content }];
  }

  /**
   * 取「精神状态实时通知」深度注入项（每轮都发，非一次性）。
   *
   * 精神值口径与 DECK 面板完全一致：往回扫最近一条叙事记录，用 ForkRunParser 现场
   * 解析其 content 取 ::: state 的 san；首轮还没有任何叙事时回落档案 envoy.psych.sanity。
   * 上限取档案 maxSanity，无则 100（parser 不产出上限）。身份名取 buildEnvoyCtx().name。
   *
   * list 结构为数组，本轮只放执行员一人；未来接队友时把队友精神状态追加进同一数组即可。
   * 深度 1（贴执行员最新行动之前），system 角色。
   * @returns {Promise<Array>} depthItems，无有效内容时空数组
   */
  async function buildPsychDepthItem() {
    if (!window.ForkRunPrompt || typeof ForkRunPrompt.buildPsychNoticeBlock !== 'function') return [];

    // 1. 当前精神值：往回扫最近一条叙事的 ::: state.san（与 DECK 同源）
    let san = null;
    try {
      if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function' && currentRunId) {
        const recs = await ForkRunStore.getRunRecords(currentRunId);
        const canParse = window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function';
        if (Array.isArray(recs) && canParse) {
          for (let i = recs.length - 1; i >= 0; i--) {
            const r = recs[i];
            if (!r || typeof r !== 'object' || r.role === 'envoy') continue;
            const content = typeof r.content === 'string' ? r.content : '';
            if (!content) continue;
            const parsed = ForkRunParser.parseRunReply(content);
            if (parsed && parsed.state && typeof parsed.state.san === 'number' && !Number.isNaN(parsed.state.san)) {
              san = parsed.state.san;
              break;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[ForkRun] 精神状态注入读取失败：', err);
    }

    // 首轮无叙事：回落档案初始精神值
    let max = 100;
    if (window.Store && Store.envoy && Store.envoy.psych) {
      const archMax = Number(Store.envoy.psych.maxSanity);
      if (Number.isFinite(archMax) && archMax > 0) max = archMax;
      if (san == null) {
        const archSan = Number(Store.envoy.psych.sanity);
        if (Number.isFinite(archSan)) san = archSan;
      }
    }
    // 依旧取不到（无档案、无叙事）：不注入，避免凭空播报一个假数值
    if (san == null) return [];

    // 2. 身份名
    let name = '执行员';
    try {
      const ctx = buildEnvoyCtx();
      if (ctx && trimStr(ctx.name)) name = trimStr(ctx.name);
    } catch (_) {}

    // 3. 档位：优先 PsychStore 判定，缺席时让 prompt 侧按 san 现算
    let level = '';
    if (window.PsychStore && typeof PsychStore.getSanityStatus === 'function') {
      const st = PsychStore.getSanityStatus(san);
      level = st && st.level ? st.level : '';
    }

    const content = ForkRunPrompt.buildPsychNoticeBlock([{ name, san, max, level }]);
    if (!trimStr(content)) return [];
    return [{ depth: 1, role: 'system', content }];
  }

  /**
   * 汇总本轮全部深度注入项：真相导演指令（一次性）+ 结局收尾指令（一次性）+
   * 新阶段任务解锁提示（可连发数轮，直到 AI 回执）+ 精神状态实时通知（每轮）。
   * async 是因为精神状态项与任务解锁项都需读/写库。
   * @param {number} [upcomingTurn] 即将生成的这一轮，供任务解锁提示算宽限窗口
   * @returns {Promise<Array>} depthItems
   */
  async function buildAllDepthItems(upcomingTurn) {
    const psych = await buildPsychDepthItem();
    const missionUnlock = await takeMissionUnlockDepthItem(upcomingTurn);
    return takeTruthDirectiveDepthItem()
      .concat(takeEndingDirectiveDepthItem())
      .concat(missionUnlock)
      .concat(psych);
  }

  /**
   * 拼待解锁线索上下文：把处于 pending 且仍在宽限窗口内的线索列给 AI，
   * 作为「即将可解锁」的引导。upcomingTurn 是即将生成的这一轮。
   * @param {number} upcomingTurn 即将生成的轮次
   * @returns {Array} 线索上下文数组
   */
  function buildClueCtx(upcomingTurn) {
    const clueState = (currentRun && currentRun.clues) || {};
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    if (!forkClues.length) return [];

    const ctx = [];
    for (const clue of forkClues) {
      const id = trimStr(clue && clue.id);
      if (!id) continue;
      const st = clueState[id];
      if (!st || st.status !== 'pending') continue;
      // 剩余轮数：宽限窗口 - 已过轮数。upcomingTurn 是即将生成的这轮。
      // 触发轮记为 triggeredTurn，剩余 = GRACE - (upcomingTurn - triggeredTurn - 1)
      const elapsed = Math.max(0, (Number(upcomingTurn) || 0) - (Number(st.triggeredTurn) || 0) - 1);
      const remaining = CLUE_GRACE_TURNS - elapsed;
      if (remaining < 1) continue; // 已超窗口，不再拼（兜底解锁会在回复后处理）
      ctx.push({
        id,
        name: trimStr(clue.name),
        desc: trimStr(clue.desc),
        remaining
      });
    }
    return ctx;
  }

  /* ================= 阶段任务（链式解锁） =================
     卷宗 clearConditions 每项可设 prereqIds + prereqLogic：前置任务按 all/any 完成后，
     这项任务才「解锁」。未解锁的任务完全不进提示词（连存在都不提）。
     完成态记在 run.missions[id].achieved（持久，由 AI 在 ::: quest 块里按 id 回执），
     不随某轮漏输出而回退。 */

  /** 新解锁任务的贴脸提示宽限窗口（轮）：超窗仍未被 AI 回执就静默，不再催 */
  const MISSION_NOTICE_GRACE_TURNS = 3;

  /** 取本世界线任务态 map（恒返回对象） */
  function getMissionState() {
    return (currentRun && currentRun.missions) || {};
  }

  /** 某项任务在本世界线是否已完成 */
  function isMissionAchieved(missionId, state) {
    const st = (state || getMissionState())[trimStr(missionId)];
    return !!(st && st.achieved);
  }

  /**
   * 算「当前已解锁的任务 id 集合」。
   *
   * 解锁 = 无前置，或前置按 prereqLogic 满足（all 全部已完成 / any 任一已完成）。
   * 逐层传播：本轮新解锁的任务不会立刻让它的下游也解锁（下游要等它自己被完成），
   * 所以单遍扫描即可——解锁只依赖「已完成」集合，而完成集合本轮是固定的。
   * 失效 id（指向已删任务）视为永不满足，避免悄悄把门打开。
   *
   * @returns {Set<string>} 已解锁任务 id 集合
   */
  function computeUnlockedMissionIds() {
    const list = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    const state = getMissionState();
    const validIds = new Set(list.map((m) => trimStr(m && m.id)).filter(Boolean));
    const unlocked = new Set();
    for (const m of list) {
      const id = trimStr(m && m.id);
      if (!id) continue;
      const prereqs = Array.isArray(m.prereqIds) ? m.prereqIds.map(trimStr).filter(Boolean) : [];
      // 前置里含失效 id（任务被删）→ 该条永远开不了，但也别让整副本卡死：
      // 失效 id 直接当「不满足」，作者在编纂器里能看到失效药丸提示。
      const live = prereqs.filter((pid) => validIds.has(pid));
      if (!prereqs.length) {
        unlocked.add(id);
        continue;
      }
      if (live.length !== prereqs.length) continue;
      const logic = m.prereqLogic === 'any' ? 'any' : 'all';
      const okAll = live.every((pid) => isMissionAchieved(pid, state));
      const okAny = live.some((pid) => isMissionAchieved(pid, state));
      if (logic === 'any' ? okAny : okAll) unlocked.add(id);
    }
    return unlocked;
  }

  /**
   * 拼任务上下文：告诉 prompt 引擎列哪些任务、哪些标「已完成」、本副本一共有几条。
   * totalCount 含未解锁的任务——prompt 侧据此声明「还有若干项未下发」，
   * 防止 AI 把眼前已解锁的几条当成全部主线、提前判通关。
   * @returns {{ unlockedIds: string[], achievedIds: string[], totalCount: number }}
   */
  function buildMissionCtx() {
    const state = getMissionState();
    const unlocked = computeUnlockedMissionIds();
    const achievedIds = Object.keys(state).filter((id) => state[id] && state[id].achieved);
    const all = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    const totalCount = all.filter((m) => trimStr(m && m.id) && (trimStr(m && m.goal) || trimStr(m && m.text))).length;
    return {
      unlockedIds: Array.from(unlocked),
      achievedIds,
      totalCount
    };
  }

  /**
   * 请求前结算阶段任务解锁：把「因前置完成而新解锁」的任务打上贴脸提示标记。
   * 幂等：已标记过（noticeTurn 已记）或已完成的不重复打。
   *
   * 解锁本身是纯推导（computeUnlockedMissionIds 实时算），这里只负责记录
   * 「什么时候第一次解锁的」，供贴脸提示的宽限窗口计时。
   *
   * @param {number} upcomingTurn 即将生成的这一轮
   */
  async function processMissionUnlockBeforeRequest(upcomingTurn) {
    if (!currentRunId || !window.ForkRunStore) return;
    const list = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    if (!list.length) return;
    const curTurn = Number(upcomingTurn) || 0;
    const state = { ...getMissionState() };
    const unlocked = computeUnlockedMissionIds();
    // 开局即解锁的任务（无前置）不需要贴脸提示——它们本来就一直在提示词里。
    const noPrereqIds = new Set(list
      .filter((m) => !(Array.isArray(m.prereqIds) && m.prereqIds.length))
      .map((m) => trimStr(m && m.id))
      .filter(Boolean));

    const patch = {};
    for (const id of unlocked) {
      if (noPrereqIds.has(id)) continue;
      const st = state[id];
      if (st && (st.achieved || st.noticeTurn)) continue; // 已完成 / 已记过解锁轮
      patch[id] = { noticePending: true, noticeTurn: curTurn };
      state[id] = {
        achieved: false,
        achievedTurn: 0,
        achievedRecordId: '',
        noticePending: true,
        noticeTurn: curTurn
      };
    }
    if (!Object.keys(patch).length) return;
    if (currentRun) currentRun.missions = state;
    try {
      if (typeof ForkRunStore.patchMissionState === 'function') {
        await ForkRunStore.patchMissionState(currentRunId, patch);
      }
    } catch (err) {
      console.warn('[ForkRun] 阶段任务解锁标记写入失败：', err);
    }
  }

  /**
   * 取「溯流系统 · 任务推送」的贴脸导演指令（深度注入 depthItem）。
   * 对所有 noticePending 且仍在宽限窗口内的任务发一条合并指令；
   * 超窗的任务就地消标记（静默解锁，不再催 AI）。
   * 与真相/结局导演指令不同——这条可以连发数轮，直到 AI 在 quest 块里回执为止。
   *
   * @param {number} upcomingTurn 即将生成的这一轮
   * @returns {Promise<Array>} depthItems，无则空数组
   */
  async function takeMissionUnlockDepthItem(upcomingTurn) {
    if (!currentRun || !window.ForkRunPrompt) return [];
    if (typeof ForkRunPrompt.buildMissionUnlockDirectiveBlock !== 'function') return [];
    const list = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    if (!list.length) return [];
    const curTurn = Number(upcomingTurn) || 0;
    const state = { ...getMissionState() };

    const items = [];
    const expirePatch = {};
    for (const id of Object.keys(state)) {
      const st = state[id];
      if (!st || !st.noticePending || st.achieved) continue;
      const elapsed = curTurn - (Number(st.noticeTurn) || 0);
      if (elapsed >= MISSION_NOTICE_GRACE_TURNS) {
        // 超窗：静默解锁，任务仍在提示词的主线列表里，只是不再贴脸催
        expirePatch[id] = { noticePending: false };
        state[id] = { ...st, noticePending: false };
        continue;
      }
      const mission = list.find((m) => trimStr(m && m.id) === id);
      if (mission) items.push(mission);
    }

    if (Object.keys(expirePatch).length) {
      if (currentRun) currentRun.missions = state;
      try {
        if (window.ForkRunStore && typeof ForkRunStore.patchMissionState === 'function') {
          await ForkRunStore.patchMissionState(currentRunId, expirePatch);
        }
      } catch (_) { /* 提示标记过期写失败不影响本轮推演 */ }
    }
    if (!items.length) return [];
    // 点名触发本次解锁的前置任务：取这批新任务的前置里「已完成」的那些目标文本，
    // 让推送指令能写成「执行员已完成『混入医护人员队伍』」而不是笼统的「前置任务」。
    // ALL 逻辑下前置全完成才解锁，所以全列；ANY 下只有命中的那条是真正的触发者。
    const triggerNames = [];
    const seenTrigger = new Set();
    for (const m of items) {
      const prereqs = Array.isArray(m.prereqIds) ? m.prereqIds.map(trimStr).filter(Boolean) : [];
      for (const pid of prereqs) {
        if (seenTrigger.has(pid)) continue;
        if (!isMissionAchieved(pid, state)) continue;
        const prev = list.find((x) => trimStr(x && x.id) === pid);
        const goal = trimStr(prev && prev.goal) || trimStr(prev && prev.text);
        if (!goal) continue;
        seenTrigger.add(pid);
        triggerNames.push(goal);
      }
    }
    const content = ForkRunPrompt.buildMissionUnlockDirectiveBlock(items, triggerNames);
    if (!trimStr(content)) return [];
    return [{ depth: 1, role: 'system', content }];
  }

  /**
   * 回复落定后结算任务完成：读 parsed.quest 里 AI 以 [已完成] 回执的任务 id，
   * 落 run.missions[id].achieved（持久）。
   *
   * 只认「已解锁」的卷宗任务 id——AI 瞎编的编号、未解锁的任务一律忽略，
   * 没写编号的行（id 为空）也不参与判定，它只在任务卡上显示文本。
   * 任何被回执到的已解锁任务（无论推进中还是已完成），都消掉它的贴脸提示标记。
   *
   * @param {Object} parsed 解析器输出
   * @param {number} turn 本轮轮次
   * @param {string} recordId 本轮 narration 记录 id
   */
  async function processMissionsAfterReply(parsed, turn, recordId) {
    if (!currentRunId || !window.ForkRunStore) return;
    const quest = (parsed && Array.isArray(parsed.quest)) ? parsed.quest : [];
    if (!quest.length) return;
    const list = (currentFork && Array.isArray(currentFork.clearConditions)) ? currentFork.clearConditions : [];
    if (!list.length) return;
    const curTurn = Number(turn) || 0;
    const rid = trimStr(recordId);
    const unlocked = computeUnlockedMissionIds();
    const state = { ...getMissionState() };

    const noticeClear = {};
    for (const q of quest) {
      const id = trimStr(q && q.id);
      if (!id || !unlocked.has(id)) continue;
      // AI 认了这项任务 → 贴脸提示的使命完成
      const st = state[id];
      if (st && st.noticePending) {
        noticeClear[id] = { noticePending: false };
        state[id] = { ...st, noticePending: false };
      }
      if (q.status !== 'achieved') continue;
      if (st && st.achieved) continue; // 已完成，幂等
      try {
        await ForkRunStore.markMissionAchieved(currentRunId, id, curTurn, rid);
      } catch (err) {
        console.warn('[ForkRun] 任务完成标记写入失败：', err);
        continue;
      }
      state[id] = {
        achieved: true,
        achievedTurn: curTurn,
        achievedRecordId: rid,
        noticePending: false,
        noticeTurn: st ? (Number(st.noticeTurn) || 0) : 0
      };
      delete noticeClear[id]; // markMissionAchieved 已把 noticePending 清了
    }
    if (Object.keys(noticeClear).length) {
      try {
        if (typeof ForkRunStore.patchMissionState === 'function') {
          await ForkRunStore.patchMissionState(currentRunId, noticeClear);
        }
      } catch (_) { /* 标记清理失败不影响正文 */ }
    }
    if (currentRun) currentRun.missions = state;
  }

  /**
   * 发起推演请求「之前」的统一触发判定。核心：所有触发都基于「截至上一轮的已确定状态」求值，
   * 与世界书 / SillyTavern 的注入时机对齐——请求前扫历史，命中就在本轮请求里注入（导演指令），
   * 卡片延到回复落定时挂在本轮叙事块上。这样卡片、AI 收到提示、recordId 三者同轮，时序自洽。
   *
   * 判定数据源（都在请求前就已确定）：
   *   - 地点 / 时间 / 数值：读 records 里「最后一条 narration」解析出的 scene / state / allies / npcs
   *     （即上一轮 AI 已经演到的状态。AI 本轮才会产出的结构化字段请求前拿不到，故基于上一轮）
   *   - 关键词：扫「最后一条 narration（上一轮 AI 回复）+ 最后一条 envoy（本轮执行员输入）」文本
   *   - 前置线索：截至此刻的已解锁线索集合（跨轮状态）
   *
   * 命中只写状态（线索进 pending / 真相解明 / 结局命中）+ 同步内存态 + 打「待挂卡片」标志，
   * 不在这里挂卡片（本轮 narration 还没生成、拿不到 recordId）。真相/结局状态一置好，
   * 紧随其后的 takeTruthDirectiveDepthItem / takeEndingDirectiveDepthItem 就能把导演指令带进本轮请求。
   *
   * 幂等安全：已触发 / 已解锁 / 已解明 / 已命中的一律跳过，重写路径重复扫也不会重复触发。
   *
   * @param {Array} records     即将作为上下文发出的完整流水（含本轮 envoy 输入）
   * @param {number} upcomingTurn 即将生成的这一轮轮次
   */
  async function processTriggersBeforeRequest(records, upcomingTurn) {
    if (!currentRunId || !window.ForkRunStore) return;
    // 阶段任务解锁先结算：它只依赖任务完成态（跨轮持久），与线索/真相/结局的
    // 触发源无关，所以放在三类触发源的空判之前，免得没配线索的副本漏掉解锁提示。
    await processMissionUnlockBeforeRequest(upcomingTurn);
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    const hiddenTruth = (currentFork && currentFork.hiddenTruth && typeof currentFork.hiddenTruth === 'object')
      ? currentFork.hiddenTruth : null;
    const endings = (currentFork && Array.isArray(currentFork.endings)) ? currentFork.endings : [];
    // 三类触发源都没有配任何东西时直接跳过
    if (!forkClues.length && !hiddenTruth && !endings.length) return;

    const curTurn = Number(upcomingTurn) || 0;
    const recs = Array.isArray(records) ? records : [];

    // 上一轮 AI 回复：最后一条 narration，解析出 scene / state / allies / npcs
    let lastNarration = null;
    for (let i = recs.length - 1; i >= 0; i -= 1) {
      if (recs[i] && recs[i].role === 'narration') { lastNarration = recs[i]; break; }
    }
    const parsed = (lastNarration && window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function')
      ? ForkRunParser.parseRunReply(trimStr(lastNarration.content))
      : { body: '', scene: null, state: null, allies: [], npcs: [] };

    // 关键词扫描窗口：上一轮 AI 回复 + 本轮执行员输入（最后一条 envoy）
    let lastEnvoy = null;
    for (let i = recs.length - 1; i >= 0; i -= 1) {
      if (recs[i] && recs[i].role === 'envoy') { lastEnvoy = recs[i]; break; }
    }

    // 读一份最新存档态（本函数会多次写，用本地副本推进判定）
    let run = currentRun;
    try {
      if (typeof ForkRunStore.getRun === 'function') {
        const fresh = await ForkRunStore.getRun(currentRunId);
        if (fresh) run = fresh;
      }
    } catch (_) { /* 用内存态兜底 */ }
    let clueState = (run && run.clues) ? { ...run.clues } : {};

    // 本轮请求前刚命中的产物，攒起来交给回复后挂卡片
    const clueNoticeNames = [];
    let truthNoticePending = false;
    let endingNoticePending = false;
    let endingNoticeName = '';

    // --- 各触发源的共享数据 ---
    const unlockedBefore = new Set(
      Object.keys(clueState).filter((id) => clueState[id] && clueState[id].status === 'unlocked')
    );
    const truthNeedsEval = !!(hiddenTruth && !run.truthUnlocked
      && Array.isArray(hiddenTruth.triggers) && hiddenTruth.triggers.length);
    const endingNeedsEval = !run.endingSettled && endings.length > 0;
    const sceneLoc = trimStr(parsed && parsed.scene && parsed.scene.location);
    const locations = (currentFork && Array.isArray(currentFork.locations)) ? currentFork.locations : [];

    // 地点访问追踪：AI 的地点串是自由文本（大地点 · 小地点），无法保证写在哪一格，
    // 故把整串按常见分隔拆成片段（整串 + 各段），对每个预设地点做双向包含匹配，
    // 命中就记进本世界线的 visitedLocationIds，供解析度「地图」维度算点亮率。
    if (sceneLoc && locations.length) {
      const segs = [sceneLoc]
        .concat(sceneLoc.split(/[·・|\/\-—\s]+/))
        .map((s) => trimStr(s))
        .filter(Boolean);
      const already = Array.isArray(run.visitedLocationIds) ? run.visitedLocationIds.slice() : [];
      const hitIds = new Set(already);
      locations.forEach((loc) => {
        const lid = trimStr(loc && loc.id);
        const lname = trimStr(loc && loc.name);
        if (!lid || !lname || hitIds.has(lid)) return;
        const matched = segs.some((seg) => seg.includes(lname) || lname.includes(seg));
        if (matched) hitIds.add(lid);
      });
      if (hitIds.size !== already.length) {
        const nextVisited = Array.from(hitIds);
        run.visitedLocationIds = nextVisited;
        if (currentRun) currentRun.visitedLocationIds = nextVisited;
        if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
          ForkRunStore.updateRun(currentRunId, { visitedLocationIds: nextVisited }).catch((err) => {
            console.warn('[ForkRun] 地点访问记录写入失败：', err);
          });
        }
      }
    }

    const timeParts = (parsed && parsed.scene && parsed.scene.timeParts) || null;
    const TIME_KEYS = ['year', 'month', 'day', 'hour', 'minute'];
    const readStat = (customStats, metricName) => {
      if (!Array.isArray(customStats)) return null;
      const found = customStats.find((s) => s && trimStr(s.label) === trimStr(metricName));
      if (!found) return null;
      return parseStatNumber(found.val);
    };
    const findOwnerStats = (ownerName) => {
      const nm = trimStr(ownerName);
      if (!nm) return null;
      const pools = []
        .concat(Array.isArray(parsed && parsed.allies) ? parsed.allies : [])
        .concat(Array.isArray(parsed && parsed.npcs) ? parsed.npcs : []);
      const who = pools.find((p) => p && trimStr(p.name) === nm);
      return who ? who.customStats : null;
    };
    const envoyStats = (parsed && parsed.state && parsed.state.customStats) || null;
    const cmpStat = (op, cur, threshold) => {
      switch (op) {
        case 'gt': return cur > threshold;
        case 'gte': return cur >= threshold;
        case 'lt': return cur < threshold;
        case 'lte': return cur <= threshold;
        case 'eq': return cur === threshold;
        default: return false;
      }
    };
    // 关键词扫描文本：上一轮 narration + 本轮 envoy 输入（只在有 keyword 触发时才拼）
    let kwScanText = '';
    const anyKeywordClue = forkClues.some((clue) => {
      const trs = Array.isArray(clue.triggers) ? clue.triggers : [];
      return trs.includes('keyword') && trimStr(clue.keywords) && !clueState[trimStr(clue.id)];
    });
    const truthNeedsKw = truthNeedsEval
      && hiddenTruth.triggers.includes('keyword') && trimStr(hiddenTruth.keywords);
    const endingNeedsKw = endingNeedsEval && endings.some((ed) => {
      const trs = Array.isArray(ed && ed.triggers) ? ed.triggers : [];
      return trs.includes('keyword') && trimStr(ed.keywords);
    });
    if (anyKeywordClue || truthNeedsKw || endingNeedsKw) {
      kwScanText = [
        trimStr(lastNarration && lastNarration.content),
        trimStr(lastEnvoy && lastEnvoy.content)
      ].filter(Boolean).join('\n');
    }

    // --- 各触发源对单条目标（线索/真相/结局）的求值 ---
    const evalLocation = (target) => {
      const locIds = Array.isArray(target.locationIds) ? target.locationIds : [];
      if (!sceneLoc || !locIds.length) return false;
      return locIds.some((locId) => {
        const loc = locations.find((l) => l && trimStr(l.id) === trimStr(locId));
        const name = trimStr(loc && loc.name);
        return name && sceneLoc.includes(name);
      });
    };
    const evalKeyword = (target) => {
      const kw = trimStr(target.keywords);
      if (!kw || !kwScanText || !window.KeyMatch || typeof KeyMatch.test !== 'function') return false;
      let res = null;
      try {
        res = KeyMatch.test(target.keywords, kwScanText);
      } catch (_) { res = null; }
      if (res && res.errors && res.errors.length) {
        res.errors.forEach((e) => {
          console.warn(`[ForkRun] 关键词有问题：${e.token} → ${e.error}`);
        });
      }
      return !!(res && res.hit);
    };
    const evalTime = (target) => {
      if (!timeParts) return false;
      const cond = (target.time && typeof target.time === 'object') ? target.time : {};
      const setKeys = TIME_KEYS.filter((k) => /^\d+$/.test(trimStr(cond[k])));
      if (!setKeys.length) return false;
      return setKeys.every((k) => {
        const scenePart = trimStr(timeParts[k]);
        if (!/^\d+$/.test(scenePart)) return false;
        return parseInt(scenePart, 10) === parseInt(trimStr(cond[k]), 10);
      });
    };
    const evalStat = (target) => {
      const conds = Array.isArray(target.statConditions) ? target.statConditions : [];
      if (!conds.length) return false;
      const logicAll = target.statLogic !== 'any';
      const results = conds.map((cond) => {
        const threshold = parseStatNumber(cond.value);
        if (threshold === null) return false;
        const metricName = resolveStatMetricName(target, cond);
        const source = cond.scope === 'char' ? findOwnerStats(cond.ownerName) : envoyStats;
        const cur = readStat(source, metricName);
        if (cur === null) return false;
        return cmpStat(cond.op, cur, threshold);
      });
      return logicAll ? results.every(Boolean) : results.some(Boolean);
    };
    const evalPrereq = (target) => {
      const prereqIds = Array.isArray(target.prereqClueIds)
        ? target.prereqClueIds.map((pid) => trimStr(pid)).filter(Boolean)
        : [];
      if (!prereqIds.length) return false;
      const logicAll = target.prereqLogic !== 'any';
      return logicAll
        ? prereqIds.every((pid) => unlockedBefore.has(pid))
        : prereqIds.some((pid) => unlockedBefore.has(pid));
    };
    const EVALUATORS = {
      location: evalLocation,
      keyword: evalKeyword,
      time: evalTime,
      stat: evalStat,
      clue: evalPrereq
    };

    // --- 逐条线索：只对「已勾选」类型求值，按 triggerLogic 汇总，命中即进 pending ---
    for (const clue of forkClues) {
      const id = trimStr(clue && clue.id);
      if (!id) continue;
      if (clueState[id]) continue; // 已触发过，触发只认第一次
      const triggers = (Array.isArray(clue.triggers) ? clue.triggers : [])
        .filter((t) => EVALUATORS[t]);
      if (!triggers.length) continue;
      const logicAll = clue.triggerLogic === 'all'; // 线索默认 any
      const results = triggers.map((t) => EVALUATORS[t](clue));
      const hit = logicAll ? results.every(Boolean) : results.some(Boolean);
      if (hit) {
        await ForkRunStore.markClueTriggered(currentRunId, id, curTurn);
        clueState[id] = { status: 'pending', triggeredTurn: curTurn, unlockedTurn: 0, unlockedBy: '' };
      }
    }

    // --- 核心真相：同构求值，命中即永久解明（无 pending / 无亮出 / 无宽限） ---
    if (truthNeedsEval) {
      const truthTriggers = hiddenTruth.triggers.filter((t) => EVALUATORS[t]);
      if (truthTriggers.length) {
        const logicAll = hiddenTruth.triggerLogic === 'all'; // 真相默认 all
        const results = truthTriggers.map((t) => EVALUATORS[t](hiddenTruth));
        const hit = logicAll ? results.every(Boolean) : results.some(Boolean);
        if (hit) {
          await ForkRunStore.markTruthUnlocked(currentRunId, curTurn, '');
          run.truthUnlocked = true;
          run.truthUnlockedTurn = curTurn;
          truthNoticePending = true;
        }
      }
    }

    // --- 结局：多条，第一个命中即定，此后本世界线不再判定新结局（线索/真相照常） ---
    if (endingNeedsEval) {
      for (const ending of endings) {
        const edId = trimStr(ending && ending.id);
        if (!edId) continue;
        const edTriggers = (Array.isArray(ending.triggers) ? ending.triggers : [])
          .filter((t) => EVALUATORS[t]);
        if (!edTriggers.length) continue;
        const logicAll = ending.triggerLogic === 'all'; // 结局默认 all
        const results = edTriggers.map((t) => EVALUATORS[t](ending));
        const hit = logicAll ? results.every(Boolean) : results.some(Boolean);
        if (hit) {
          const ok = await ForkRunStore.markEndingSettled(currentRunId, edId, curTurn, '');
          if (ok !== null) {
            run.endingSettled = true;
            run.endingId = edId;
            run.endingSettledTurn = curTurn;
            endingNoticePending = true;
            endingNoticeName = trimStr(ending.name);
          }
          break; // 第一个命中即定
        }
      }
    }

    // 同步内存态，供本轮请求侧立即读取（buildClueCtx / buildTruthCtx / takeDirective）
    if (currentRun) {
      currentRun.clues = clueState;
      if (truthNoticePending) {
        currentRun.truthUnlocked = true;
        currentRun.truthUnlockedTurn = curTurn;
      }
      if (endingNoticePending) {
        currentRun.endingSettled = true;
        currentRun.endingId = run.endingId;
        currentRun.endingSettledTurn = curTurn;
      }
    }

    // 攒起本轮命中，交给回复落定后统一挂卡片 + 补记 recordId
    pendingTriggerNotice = {
      clueNames: clueNoticeNames,
      truthNoticePending,
      endingNoticePending,
      endingNoticeName
    };
  }

  /**
   * 一轮推演回复落定后，统一处理线索：AI 亮出、超时兜底，并追加气泡提示。
   * 触发判定已前移到 processTriggersBeforeRequest（请求前扫上一轮状态），这里只保留
   * 依赖 AI 本轮回复内容的两件事（亮出回执 / 超时兜底），外加补挂请求前命中的真相/结局卡。
   *
   * @param {Object} parsed  解析器输出（含 parsed.clues）
   * @param {number} turn    本轮（刚生成的这轮 AI 叙事）的轮次
   * @param {HTMLElement} block 本轮叙事 DOM，用于追加解锁提示条
   */
  async function processCluesAfterReply(parsed, turn, block) {
    if (!currentRunId || !window.ForkRunStore) return;
    const forkClues = (currentFork && Array.isArray(currentFork.clues)) ? currentFork.clues : [];
    if (!forkClues.length) return;

    const curTurn = Number(turn) || 0;
    // 本轮 narration 记录 id：解锁卡片重建靠它按记录匹配（比 turn 稳）。
    const curRecordId = (block && block.dataset && block.dataset.recordId) ? trimStr(block.dataset.recordId) : '';
    // 解锁后要提示的线索名，去重收集，最后统一追加
    const toNotice = [];

    // 读一份最新存档态（processCluesAfterReply 里会多次写，用本地副本推进判定）
    let run = currentRun;
    try {
      if (typeof ForkRunStore.getRun === 'function') {
        const fresh = await ForkRunStore.getRun(currentRunId);
        if (fresh) run = fresh;
      }
    } catch (_) { /* 用内存态兜底 */ }
    let clueState = (run && run.clues) ? { ...run.clues } : {};

    // 触发判定已前移到 processTriggersBeforeRequest（请求前扫上一轮状态）。这里只处理
    // 依赖 AI 本轮回复内容的两件事：AI 亮出回执、超时兜底。

    // ---- AI 亮出：parsed.clues 里的编号（含容错）→ 正式解锁 ----
    const declaredIds = Array.isArray(parsed && parsed.clues) ? parsed.clues : [];
    if (declaredIds.length) {
      const pendingIds = Object.keys(clueState).filter((id) => clueState[id] && clueState[id].status === 'pending');
      const unlockedIds = Object.keys(clueState).filter((id) => clueState[id] && clueState[id].status === 'unlocked');

      // 惯性检测：本轮但凡有一个标记指向已解锁线索，就判定 AI 在照上文格式重复抄标记。
      // 此时关闭「单条 pending 抄错也认」的宽松兜底，避免把重复标记误锁到唯一的 pending 上。
      const inertiaMode = declaredIds.some((rawId) => declaredPointsToUnlocked(trimStr(rawId), unlockedIds));

      for (const rawId of declaredIds) {
        const declared = trimStr(rawId);
        // 惯性重复：指向已解锁线索的标记直接静默跳过（不重复解锁、不重复提示）
        if (declaredPointsToUnlocked(declared, unlockedIds)) continue;
        // 惯性模式下不启用单条兜底，防止重复标记误锁到唯一 pending
        const resolvedId = resolveDeclaredClueId(declared, pendingIds, inertiaMode);
        if (!resolvedId) continue;
        if (clueState[resolvedId] && clueState[resolvedId].status === 'unlocked') continue;
        await ForkRunStore.markClueUnlocked(currentRunId, resolvedId, curTurn, 'ai', curRecordId);
        clueState[resolvedId] = {
          status: 'unlocked',
          triggeredTurn: clueState[resolvedId] ? clueState[resolvedId].triggeredTurn : curTurn,
          unlockedTurn: curTurn,
          unlockedBy: 'ai',
          unlockedRecordId: curRecordId
        };
        const clue = forkClues.find((c) => trimStr(c && c.id) === resolvedId);
        toNotice.push(trimStr(clue && clue.name));
      }
    }

    // ---- 超时兜底：pending 且已过宽限窗口，机械解锁 ----
    for (const id of Object.keys(clueState)) {
      const st = clueState[id];
      if (!st || st.status !== 'pending') continue;
      const elapsed = curTurn - (Number(st.triggeredTurn) || 0);
      if (elapsed >= CLUE_GRACE_TURNS) {
        await ForkRunStore.markClueUnlocked(currentRunId, id, curTurn, 'timeout', curRecordId);
        clueState[id] = { status: 'unlocked', triggeredTurn: st.triggeredTurn, unlockedTurn: curTurn, unlockedBy: 'timeout', unlockedRecordId: curRecordId };
        const clue = forkClues.find((c) => trimStr(c && c.id) === id);
        toNotice.push(trimStr(clue && clue.name));
      }
    }

    // 同步内存态，供本页后续 buildClueCtx 立即反映
    if (currentRun) currentRun.clues = clueState;

    // 消费请求前触发命中：真相/结局在请求前就置了状态、发了导演指令，此刻回复落定，
    // 把卡片挂在本轮叙事块上、补记 recordId（重建时靠它精准匹配本条记录）。
    const trig = pendingTriggerNotice || {};
    const truthUnlockedThisTurn = !!trig.truthNoticePending;
    const endingSettledThisTurn = !!trig.endingNoticePending;
    const endingSettledName = trimStr(trig.endingNoticeName);
    if (currentRun && truthUnlockedThisTurn) {
      currentRun.truthUnlockedRecordId = curRecordId;
      if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
        ForkRunStore.updateRun(currentRunId, { truthUnlockedRecordId: curRecordId }).catch(() => {});
      }
    }
    if (currentRun && endingSettledThisTurn) {
      currentRun.endingRecordId = curRecordId;
      if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
        ForkRunStore.updateRun(currentRunId, { endingRecordId: curRecordId }).catch(() => {});
      }
    }
    // 消费完清空，避免下一轮误挂
    pendingTriggerNotice = { clueNames: [], truthNoticePending: false, endingNoticePending: false, endingNoticeName: '' };

    // 统一追加解锁提示条（去重，跳过空名）
    const seen = new Set();
    for (const name of toNotice) {
      const key = name || '';
      if (seen.has(key)) continue;
      seen.add(key);
      appendClueUnlockNotice(block, name);
    }

    // 核心真相解明卡片：本轮刚解明时挂一张（重建时靠 truthUnlockedRecordId 匹配，见 collectUnlockedClueNamesForRecord）
    if (truthUnlockedThisTurn) appendTruthUnlockNotice(block);
    // 结局收尾卡片：本轮刚定结局时挂一张（重建时靠 endingRecordId 匹配）
    if (endingSettledThisTurn) appendEndingUnlockNotice(block, endingSettledName);
  }

  /**
   * 把 AI 声明的线索编号解析成真实 clueId（含容错）。
   * 精确命中 pending 集合优先；否则当只有一条 pending 时宽容归给它（防 AI 抄错长 id）。
   * @param {string} declaredId AI 输出的编号
   * @param {string[]} pendingIds 当前 pending 的真实 id 列表
   * @param {boolean} [suppressSingleFallback] 惯性模式：关闭「单条 pending 抄错也认」的兜底
   * @returns {string} 解析出的真实 id，无法解析返回空串
   */
  function resolveDeclaredClueId(declaredId, pendingIds, suppressSingleFallback) {
    const raw = trimStr(declaredId);
    if (!raw) return '';
    // 精确命中
    if (pendingIds.includes(raw)) return raw;
    // 容错：只有一条 pending 时，AI 只要输出了 clue 块就归给它（抄错也认）。
    // 惯性模式下关闭这条兜底，避免重复标记被误锁到唯一 pending。
    if (pendingIds.length === 1 && !suppressSingleFallback) return pendingIds[0];
    // 多条时尝试「去掉 clue_ 前缀后尾部匹配」的宽松比对
    const tail = raw.replace(/^clue_?/i, '');
    const loose = pendingIds.find((id) => id.replace(/^clue_?/i, '') === tail);
    return loose || '';
  }

  /**
   * 判断 AI 声明的编号是否指向一条「已解锁」线索。
   * 用于识别 AI 的格式惯性——上一轮亮过某线索后，后续轮次照上文格式又抄了一遍
   * 同一条标记。命中即视为惯性重复，应静默跳过（不重复解锁、不重复提示）。
   * 精确匹配优先，再走去 clue_ 前缀的尾部宽松比对（与 resolveDeclaredClueId 同口径）。
   * @param {string} declaredId AI 输出的编号
   * @param {string[]} unlockedIds 当前已解锁的真实 id 列表
   * @returns {boolean}
   */
  function declaredPointsToUnlocked(declaredId, unlockedIds) {
    const raw = trimStr(declaredId);
    if (!raw || !unlockedIds.length) return false;
    if (unlockedIds.includes(raw)) return true;
    const tail = raw.replace(/^clue_?/i, '');
    return unlockedIds.some((id) => id.replace(/^clue_?/i, '') === tail);
  }

  /**
   * 数值解析：取斜杠前、转数字。"85"->85，"85/100"->85，"挺好"->null。
   * 与解析器 parseNumber 同口径，供数值触发比对复用。
   */
  function parseStatNumber(raw) {
    const s = trimStr(raw);
    if (!s) return null;
    const head = s.split('/')[0].trim();
    const n = Number(head);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 把数值条件反查回「数值名」。AI 输出的 customStats 按数值名（label）组织，
   * 而条件存的是 metricId，需从 fork 卷宗把 id 翻回 name 才能比对。
   *   - 全局（scope=global）：查 currentFork.stats
   *   - 角色（scope=char）  ：查 currentFork.charStats 各模板的 metrics
   * 查不到返回空串（调用侧据此判不匹配）。
   */
  function resolveStatMetricName(clue, cond) {
    const metricId = trimStr(cond && (cond.metricId || cond.statId));
    if (!metricId) return '';
    const fork = currentFork || {};
    if (cond.scope === 'char') {
      const tpls = Array.isArray(fork.charStats) ? fork.charStats : [];
      for (const tpl of tpls) {
        const metrics = Array.isArray(tpl && tpl.metrics) ? tpl.metrics : [];
        const m = metrics.find((x) => x && trimStr(x.id) === metricId);
        if (m) return trimStr(m.name);
      }
      return '';
    }
    const stats = Array.isArray(fork.stats) ? fork.stats : [];
    const s = stats.find((x) => x && trimStr(x.id) === metricId);
    return s ? trimStr(s.name) : '';
  }


  /**
   * 挂一条执行员行动。战术指令卡形态：无外边框、实心卡片色、下层弥散阴影，
   * 内部顶置条码与 TURN // 0X 标识。头像署名在卡片上方靠右对齐。
   * @param {Object} act
   * @param {string} act.text 行动描述
   * @param {string} [act.name] 署名，缺省取当前身份
   * @param {number} [act.turn] 行动所属轮次（一问一答算一轮）
   */
  function appendAct(act) {
    if (!streamEl) return null;
    clearEmptyState();

    const liveIdentity = resolveIdentityInfo();

    const row = document.createElement('div');
    row.className = 'fork-run-act';
    row.dataset.rawText = trimStr(act && act.text);
    if (act && act.recordId) row.dataset.recordId = act.recordId;

    const sign = document.createElement('div');
    sign.className = 'fork-run-act-sign';

    const nameEl = document.createElement('span');
    nameEl.className = 'fork-run-act-name';
    // 气泡署名：优先动态身份真相源（改名即时生效），兜底 act.name 与默认值
    nameEl.textContent = trimStr(liveIdentity.name) || trimStr(act && act.name) || '执行员';

    const avatarEl = document.createElement('span');
    avatarEl.className = 'fork-run-act-avatar';
    avatarEl.innerHTML = AVATAR_FALLBACK_SVG;
    const currentAvatar = liveIdentity.avatarUrl || envoyAvatarUrl;
    if (currentAvatar) {
      avatarEl.innerHTML = '';
      const img = document.createElement('img');
      img.alt = '执行员头像';
      img.src = currentAvatar;
      avatarEl.appendChild(img);
    }

    // 署名与挂载胶囊行：附图胶囊、文件胶囊置于左侧，代号居中，头像居右，整体与气泡右对齐同轴收边
    const pills = [];
    if (act && Array.isArray(act.images) && act.images.length) {
      pills.push(buildActImagePill(act.images, act.visionState));
    }
    if (act && Array.isArray(act.files) && act.files.length) {
      pills.push(buildActFilePill(act.files));
    }
    if (pills.length) {
      sign.append(...pills, nameEl, avatarEl);
    } else {
      sign.append(nameEl, avatarEl);
    }

    const bubble = document.createElement('div');
    bubble.className = 'fork-run-act-bubble';

    // 战术指令卡顶部元信息：纯矢量条形码 + TURN // 0X
    const metaRow = document.createElement('div');
    metaRow.className = 'fork-run-act-meta';

    const barcodeEl = document.createElement('span');
    barcodeEl.className = 'fork-run-act-barcode';
    barcodeEl.innerHTML = BARCODE_SVG;

    const turnEl = document.createElement('span');
    turnEl.className = 'fork-run-act-turn';
    const turnVal = Math.max(1, Number(act && act.turn) || 1);
    turnEl.textContent = `TURN // ${String(turnVal).padStart(2, '0')}`;

    metaRow.append(barcodeEl, turnEl);

    // 行动正文包裹：先剥 HTML 注释（给 AI 的暗号不显形，与正文引擎口径一致），
    // 再转义防 XSS，最后叠副本专属引号高亮（对白引号套重点色）。
    // 用户行动不接完整 Markdown、不做首行缩进——执行员指令通常短句、少分段。
    const contentEl = document.createElement('div');
    contentEl.className = 'fork-run-act-content';
    const actRaw = trimStr(act && act.text).replace(/<!--[\s\S]*?-->/g, '');
    contentEl.innerHTML = highlightForkQuotes(escapeHtml(actRaw));

    if (actRaw) bubble.append(metaRow, contentEl);
    else bubble.append(metaRow);

    bindLongPress(bubble, 'act', act);

    row.append(sign, bubble);

    // 挂载战术多选复选框与点击交互
    attachRowBatchSelection(row);

    streamEl.appendChild(row);
    return row;
  }
  function clearEmptyState() {
    const empty = streamEl && streamEl.querySelector('.fork-run-empty');
    if (empty) empty.remove();
  }

  /* ================= 行动附图：视觉胶囊 + 全屏滑动灯箱 ================= */

  /** 战术文档胶囊图标（纯 SVG，禁止 emoji） */
  const DOC_PILL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>'
    + '</svg>';

  /**
   * 把一条行动附带的文件列表收成一枚机能文档胶囊。
   * 挂在气泡上方的署名行（与头像、代号、附图胶囊同排居右）。
   *
   * @param {Array} files 形如 [{ id, name, sizeText, charCount }]
   * @returns {HTMLElement}
   */
  function buildActFilePill(files) {
    const list = Array.isArray(files) ? files.filter(Boolean) : [];
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'fork-run-act-file-pill';

    const label = list.length === 1
      ? (list[0].name || '战术文档')
      : `战术档案 // ${list.length}`;

    pill.innerHTML = `${DOC_PILL_SVG}<span class="fork-run-act-file-pill-text">${escapeHtml(label)}</span>`
      + '<span class="fork-run-act-file-pill-arrow" aria-hidden="true">'
      + '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 000 1.41L13.17 12l-3.88 3.88a1 1 0 101.42 1.41l4.58-4.58a1 1 0 000-1.42L10.7 6.71a1 1 0 00-1.41 0z"/></svg>'
      + '</span>';
    pill.setAttribute('aria-label', `查看战术文档，共 ${list.length} 份`);
    pill.title = list.map((f) => f.name).join('\n');

    pill.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!list.length) return;
      if (list.length === 1) {
        await previewSingleFile(list[0]);
      } else {
        openMultiFileSelector(list);
      }
    });

    return pill;
  }

  async function previewSingleFile(file) {
    if (!file || !file.id || !window.FileStore || typeof FileStore.getText !== 'function') {
      toast('FILE // 读取失败', '文件档案未命中或模块未就绪', '无法读取内容', 'warning');
      return;
    }
    const text = await FileStore.getText(file.id, getForkFileScope());
    if (text == null) {
      toast('FILE // 已失效', '该文件已从副本文件区移除', '无法打开预览', 'warning');
      return;
    }
    // 派发通用预览事件（FileVaultUI 内置监听，自动弹出只读机能预览模态框）
    window.dispatchEvent(new CustomEvent('retroflow:preview-file', {
      detail: { name: file.name || '战术文档', text }
    }));
  }

  function openMultiFileSelector(files) {
    if (window.SelectModal && typeof SelectModal.open === 'function') {
      SelectModal.open({
        title: '查看战术档案',
        options: files.map((f) => ({
          value: f.id,
          label: f.name || '未命名文档',
          meta: `${f.sizeText || ''} // ${f.charCount || 0} 字符`
        })),
        onSelect: async (fileId) => {
          const target = files.find((f) => f.id === fileId);
          if (target) await previewSingleFile(target);
        }
      });
    } else {
      previewSingleFile(files[0]);
    }
  }

  /** 影像胶囊图标（快门光圈，纯 SVG） */
  const VISION_PILL_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M9 3L7.2 5H4a2 2 0 00-2 2v11a2 2 0 002 2h16a2 2 0 002-2V7a2 2 0 00-2-2h-3.2L15 3H9zm3 5a5 5 0 110 10 5 5 0 010-10zm0 2a3 3 0 100 6 3 3 0 000-6z"/>'
    + '</svg>';

  /**
   * 把一条行动的附图列表收成一枚胶囊。
   *
   * 胶囊只读 images 的长度与识图状态，不预加载任何图 —— 一条线可能有几十条带图行动，
   * 进本时全量拉 Blob 会把主线程和内存一起拖垮。真正取图延后到点开灯箱那一刻。
   *
   * @param {Array} images 形如 [{ galleryId, assetKey }] 的附图清单
   * @param {string} [visionState] 'pending' | 'done' | 'failed'，缺省按 done 渲染
   * @returns {HTMLElement}
   */
  function buildActImagePill(images, visionState) {
    const list = Array.isArray(images) ? images.filter(Boolean) : [];
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'fork-run-act-image-pill';
    if (visionState) pill.dataset.visionState = visionState;

    const label = visionState === 'pending'
      ? 'VISION // 识别中'
      : (visionState === 'failed' ? 'VISION // 识别失败' : `现场影像 // ${list.length}`);

    pill.innerHTML = `${VISION_PILL_SVG}<span class="fork-run-act-image-pill-text">${escapeHtml(label)}</span>`
      + '<span class="fork-run-act-image-pill-arrow" aria-hidden="true">'
      + '<svg viewBox="0 0 24 24"><path d="M9.29 6.71a1 1 0 000 1.41L13.17 12l-3.88 3.88a1 1 0 101.42 1.41l4.58-4.58a1 1 0 000-1.42L10.7 6.71a1 1 0 00-1.41 0z"/></svg>'
      + '</span>';
    pill.setAttribute('aria-label', `查看现场影像，共 ${list.length} 张`);

    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      // 识别中不拦截查看：图已在库里，用户想翻就让他翻
      openForkLightbox(list, 0);
    });

    return pill;
  }

  /** 把附图清单解析成可显示的 src 列表（objectURL，关灯箱时统一 revoke） */
  async function resolveActImageSrcList(images) {
    const list = Array.isArray(images) ? images.filter(Boolean) : [];
    const out = [];
    for (const item of list) {
      let src = '';
      const galleryId = typeof item === 'string' ? item : (item.galleryId || item.id || '');
      try {
        if (galleryId && window.GalleryStore && typeof GalleryStore.getSrc === 'function') {
          src = (await GalleryStore.getSrc(galleryId)) || '';
        }
        // 兜底：老数据里可能只有裸 assetKey 或远端 url
        if (!src && item && item.assetKey && window.Storage && typeof Storage.getAssetSrc === 'function') {
          src = (await Storage.getAssetSrc(item.assetKey)) || '';
        }
        if (!src && item && item.url) src = item.url;
      } catch (err) {
        console.warn('[ForkRun] 附图读取失败：', galleryId || item, err);
      }
      out.push({ src, galleryId });
    }
    return out;
  }

  /** 灯箱在途句柄：{ overlay, srcList } —— 同一时刻只允许一个灯箱 */
  let activeLightbox = null;

  /**
   * 全屏滑动灯箱。
   *
   * 三张卡横向铺在一条 track 上用 transform 平移，而不是每次换图改 img.src：
   * 改 src 会有一帧白屏，滑动手感立刻散架。
   * 顶栏走 env(safe-area-inset-top)，规避 iOS 灵动岛与刘海遮挡。
   *
   * @param {Array} images 附图清单
   * @param {number} startIndex 初始聚焦下标
   */
  async function openForkLightbox(images, startIndex) {
    if (activeLightbox) closeForkLightbox();

    const resolved = await resolveActImageSrcList(images);
    const srcList = resolved.filter((r) => r.src);
    if (!srcList.length) {
      toast('VISION // 影像缺失', '这批影像已不可读', '原图可能已在视界档案中被清理', 'warning');
      return;
    }

    let index = Math.min(Math.max(Number(startIndex) || 0, 0), srcList.length - 1);

    const overlay = document.createElement('div');
    overlay.className = 'fork-lightbox';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '现场影像查看器');

    overlay.innerHTML = `
      <div class="fork-lightbox-top">
        <span class="fork-lightbox-counter"></span>
        <div class="fork-lightbox-tools">
          <button type="button" class="fork-lightbox-btn is-download" aria-label="下载当前影像">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a1 1 0 011 1v9.59l3.3-3.3a1 1 0 011.4 1.42l-5 5a1 1 0 01-1.4 0l-5-5a1 1 0 011.4-1.42l3.3 3.3V4a1 1 0 011-1zM5 19h14a1 1 0 010 2H5a1 1 0 010-2z"/></svg>
          </button>
          <button type="button" class="fork-lightbox-btn is-close" aria-label="关闭查看器">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      </div>
      <div class="fork-lightbox-viewport">
        <div class="fork-lightbox-track"></div>
      </div>
      <div class="fork-lightbox-dots" aria-hidden="true"></div>`;

    const track = overlay.querySelector('.fork-lightbox-track');
    const counter = overlay.querySelector('.fork-lightbox-counter');
    const dotsWrap = overlay.querySelector('.fork-lightbox-dots');

    srcList.forEach((item, i) => {
      const cell = document.createElement('div');
      cell.className = 'fork-lightbox-cell';
      const img = document.createElement('img');
      img.src = item.src;
      img.alt = `现场影像 ${i + 1}`;
      img.draggable = false;
      cell.appendChild(img);
      track.appendChild(cell);

      if (srcList.length > 1) {
        const dot = document.createElement('span');
        dot.className = 'fork-lightbox-dot';
        dotsWrap.appendChild(dot);
      }
    });

    const pad = (n) => String(n).padStart(2, '0');

    function paint(animate) {
      track.style.transition = animate ? 'transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1)' : 'none';
      track.style.transform = `translate3d(${-index * 100}%, 0, 0)`;
      if (counter) counter.textContent = `${pad(index + 1)} / ${pad(srcList.length)}`;
      Array.from(dotsWrap.children).forEach((d, i) => d.classList.toggle('is-active', i === index));
    }

    function go(delta) {
      const next = index + delta;
      if (next < 0 || next > srcList.length - 1) {
        // 边界不循环，给一段回弹阻尼：循环会让人分不清自己在头还是在尾
        track.style.transition = 'transform 0.2s ease';
        track.style.transform = `translate3d(calc(${-index * 100}% + ${delta > 0 ? -18 : 18}px), 0, 0)`;
        setTimeout(() => paint(true), 180);
        return;
      }
      index = next;
      paint(true);
    }

    /* ---- 触摸跟手滑动 ---- */
    let startX = 0;
    let startY = 0;
    let dragging = false;
    let locked = null; // 'x' | 'y'，方向一旦锁定不再改，避免斜滑时抖动

    overlay.addEventListener('touchstart', (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dragging = true;
      locked = null;
      track.style.transition = 'none';
    }, { passive: true });

    overlay.addEventListener('touchmove', (e) => {
      if (!dragging || !e.touches || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!locked) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (locked !== 'x') return;
      if (e.cancelable) e.preventDefault();
      // 到头/到尾时位移打三折，手感上直接告诉用户「没有下一张了」
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === srcList.length - 1);
      const shift = atEdge ? dx * 0.32 : dx;
      track.style.transform = `translate3d(calc(${-index * 100}% + ${shift}px), 0, 0)`;
    }, { passive: false });

    overlay.addEventListener('touchend', (e) => {
      if (!dragging) return;
      dragging = false;
      if (locked !== 'x') { paint(true); return; }
      const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : startX;
      const dx = endX - startX;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      else paint(true);
    });

    /* ---- 控制元件 ---- */
    const closeBtn = overlay.querySelector('.fork-lightbox-btn.is-close');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeForkLightbox(); });

    const dlBtn = overlay.querySelector('.fork-lightbox-btn.is-download');
    if (dlBtn) {
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        try {
          const a = document.createElement('a');
          a.href = srcList[index].src;
          a.download = `retroflow-vision-${Date.now()}-${pad(index + 1)}.png`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          toast('VISION // 已导出', '影像已保存', '文件已写入设备下载目录', 'success');
        } catch (_) {
          toast('VISION // 导出失败', '影像保存未完成', '可长按图片使用系统菜单保存', 'warning');
        }
      });
    }

    // 点空白处关闭：点在图上不关，免得翻图时误触
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || (e.target.classList && e.target.classList.contains('fork-lightbox-viewport'))) {
        closeForkLightbox();
      }
    });

    function onKey(e) {
      if (e.key === 'Escape') closeForkLightbox();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    }
    document.addEventListener('keydown', onKey);

    document.body.appendChild(overlay);
    activeLightbox = { overlay, srcList, onKey };
    paint(false);
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
  }

  /** 关灯箱并回收 objectURL —— 不 revoke 会在反复开合中堆成内存泄漏 */
  function closeForkLightbox() {
    if (!activeLightbox) return;
    const { overlay, srcList, onKey } = activeLightbox;
    activeLightbox = null;
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('is-open');
    setTimeout(() => {
      overlay.remove();
      srcList.forEach((item) => {
        if (item.src && item.src.startsWith('blob:')) {
          try { URL.revokeObjectURL(item.src); } catch (_) {}
        }
      });
    }, 200);
  }


  /* ================= 流式占位块 ================= */

  /**
   * 挂一个推演等待/流式占位块。
   *
   * 为什么不直接复用 appendNarration：那个函数一次性把状态卡、遥测微标全渲染出来，
   * 而流式期间这些数据还没到（scene / state 块通常在末尾才吐完）。占位块只负责
   * 把正文逐段显出来，请求收尾后整块移除、改由 appendNarration 渲染完整成品。
   *
   * @returns {{ block: HTMLElement, textEl: HTMLElement } | null}
   */
  function appendPendingNarration() {
    if (!streamEl) return null;
    clearEmptyState();

    const block = document.createElement('div');
    block.className = 'fork-run-narration is-pending';

    // 等待标识：纯 SVG 脉冲环，无 emoji。首字到达后由 CSS 自动隐去
    const waitEl = document.createElement('div');
    waitEl.className = 'fork-run-pending-mark';
    waitEl.setAttribute('aria-label', '推演进行中');
    waitEl.innerHTML = PENDING_MARK_SVG;

    const textEl = document.createElement('div');
    textEl.className = 'fork-run-narration-text chat-bubble-content';

    block.append(waitEl, textEl);
    streamEl.appendChild(block);
    return { block, textEl };
  }

  /**
   * 流式增量上屏。
   *
   * 每个 chunk 都整段重渲染而非追加：Markdown 是整体语法，半个代码栅栏、
   * 半个列表项单独渲染会得到错误结构，收到下一段又要推翻重来。整段重渲染
   * 的开销在一轮几千字的量级上可以忽略，换来的是任何时刻截断都排版正确。
   *
   * @param {Object} pending appendPendingNarration 的返回值
   * @param {string} fullText 到目前为止的完整正文
   */
  function updatePendingNarration(pending, fullText) {
    if (!pending || !pending.textEl) return;
    const raw = trimStr(fullText);
    if (!raw) return;

    // 首字到达：撤掉等待标识，进入出字态
    pending.block.classList.remove('is-pending');
    pending.block.classList.add('is-streaming');

    // 流式期间 ::: 结构块还没闭合，直接渲染会把半截栅栏显给用户。
    // 故只渲染首个 ::: 之前的正文，结构块等收尾后由解析器统一处理。
    const fenceIdx = raw.indexOf('\n:::');
    const bodyOnly = fenceIdx >= 0 ? raw.slice(0, fenceIdx) : raw;
    const { cleaned } = extractThinkBlocks(bodyOnly);

    if (window.RetroflowMarkdown && typeof RetroflowMarkdown.render === 'function') {
      pending.textEl.innerHTML = highlightForkQuotes(RetroflowMarkdown.render(cleaned));
    } else {
      pending.textEl.innerHTML = cleaned
        .split(/\n{2,}/)
        .map((p) => `<p>${highlightForkQuotes(escapeHtml(p).replace(/\n/g, '<br>'))}</p>`)
        .join('');
    }

    followBottomIfNear();
  }

  /** 移除占位块。完整成品由 appendNarration 重新渲染，避免两套渲染路径分叉 */
  function removePendingNarration(pending) {
    if (pending && pending.block && pending.block.parentNode) {
      pending.block.remove();
    }
  }

  function renderEmptyState() {
    if (!streamEl) return;
    streamEl.innerHTML = `
      <div class="fork-run-empty">
        <span class="fork-run-empty-icon">${EMPTY_ICON_SVG}</span>
        <span class="fork-run-empty-title">因果通道已就绪</span>
        <span class="fork-run-empty-desc">这条下潜线尚未产生任何记录。写下你的第一个行动开始推演。</span>
      </div>
    `;
  }

  /**
   * 回放整条下潜线。历史查看走的也是这一条路径 —— 同一批渲染函数，
   * 所以回看到的排版跟当时玩的时候一模一样。
   */
  async function renderRunRecords() {
    if (!streamEl) return;
    streamEl.innerHTML = '';

    let records = [];
    if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function') {
      try {
        records = await ForkRunStore.getRunRecords(currentRunId);
      } catch (err) {
        console.warn('[ForkRun] 推演记录读取失败：', currentRunId, err);
      }
    }

    // 开场首帧注入：判据是「这条线还没注入过」，不是「流水为空」。
    // 靠流水条数推断的话，一条已经开过的空线事后补写开场就永远进不来。
    if (!isReadonly && currentRun && !currentRun.openingSeeded) {
      const seeded = await seedOpeningFrame();
      // 开场是这条线的起点，插在已有流水最前面而不是追加到末尾
      if (seeded) records = [seeded, ...(Array.isArray(records) ? records : [])];
    }

    if (!Array.isArray(records) || records.length === 0) {
      renderEmptyState();
      return;
    }

    // 轮号按顺序现算，不读存量 record.turn。
    // 理由：turn 是落库时写死的，删掉中间某轮后剩下的记录会留出空号（01、03、04）。
    // 改为渲染时从头数，删掉谁、后面的自动往前顺，永远连续。
    // 开场首帧是没有对应行动的孤立叙事，算第 0 轮，不占号。
    let turnCursor = 0;
    records.forEach((rec) => {
      if (!rec) return;
      // role 口径：envoy = 执行员行动（气泡），其余一律当叙事正文
      if (rec.role === 'envoy') {
        // 每条执行员行动开一轮，紧随其后的叙事沿用同一号
        turnCursor += 1;
        appendAct({
          recordId: rec.id,
          text: rec.content,
          name: rec.name,
          turn: turnCursor,
          images: rec.images || [],
          files: rec.files || []
        });
      } else {
        // 叙事条目的 content 是 AI 原始文本，先过契约解析器拆成结构化数据，
        // 正文与各状态卡分别喂给渲染器。解析器自带六道兜底，永不抛错。
        const parsed = (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function')
          ? ForkRunParser.parseRunReply(rec.content)
          : { body: rec.content, scene: null, state: null, allies: [], npcs: [], quest: null };

        const narrationBlock = appendNarration({
          recordId: rec.id,
          createdAt: rec.createdAt || 0,
          rawText: rec.content,     // 编辑时改的是原文（含 ::: 块），不是解析后的正文
          text: parsed.body,
          turn: turnCursor,
          status: parsed.scene,
          vitals: parsed.state ? { ...parsed.state, parsed: true } : null,
          allies: parsed.allies,
          npcs: parsed.npcs,
          missions: parsed.quest,
          variants: rec.variants,
          activeVariantIndex: rec.activeVariantIndex,
          parsed: true             // 标记走真实模式，组件不再回落 DEMO
        });

        // 已解锁线索的提示条随记录重现（AI 亮出按 ::: clue 反推，超时兜底按记录 id 精准匹配）
        const clueNames = collectUnlockedClueNamesForRecord(parsed, turnCursor, rec && rec.id);
        clueNames.forEach((nm) => appendClueUnlockNotice(narrationBlock, nm));
        // 核心真相解明卡片随记录重现：按 truthUnlockedRecordId 精准匹配本条
        if (currentRun && currentRun.truthUnlocked
          && trimStr(currentRun.truthUnlockedRecordId)
          && trimStr(currentRun.truthUnlockedRecordId) === trimStr(rec && rec.id)) {
          appendTruthUnlockNotice(narrationBlock);
        }
        // 结局收尾卡片随记录重现：按 endingRecordId 精准匹配本条，结局名从 fork.endings 反查
        if (currentRun && currentRun.endingSettled
          && trimStr(currentRun.endingRecordId)
          && trimStr(currentRun.endingRecordId) === trimStr(rec && rec.id)) {
          const forkEndings = (currentFork && Array.isArray(currentFork.endings)) ? currentFork.endings : [];
          const hitEnding = forkEndings.find((ed) => trimStr(ed && ed.id) === trimStr(currentRun.endingId));
          appendEndingUnlockNotice(narrationBlock, trimStr(hitEnding && hitEnding.name));
        }
      }
    });

    // 顶栏 T0X 与气泡轮号同源：按现算出的实际轮数校准存档，避免两处显示打架
    await syncTurnCount(turnCursor);

    // 动画标识用后即焚：避免下次其他原因触发重渲染（如编辑/重命名等）时误播动画
    pendingVariantAnim = null;

    settleBottom(true);
  }

  /**
   * 把存档里的 turnCount 校准成「当前流水真实轮数」。
   *
   * turnCount 仍是顶栏 T0X 与下一条行动轮号的依据，但它不再由累加维护 ——
   * 删除记录后光靠累加会与画面脱节，所以每次重渲染都按实际轮数回写一次。
   * 值没变就不落盘，避免每次开页都白写一次存档。
   *
   * @param {number} turns 现算出的实际轮数
   */
  async function syncTurnCount(turns) {
    const next = Math.max(0, Number(turns) || 0);
    if (!currentRun || currentRun.turnCount === next) {
      syncHeader();
      return;
    }
    currentRun.turnCount = next;
    syncHeader();
    // 只读态（历史回看）不回写存档：翻阅不该改动数据
    if (isReadonly) return;
    if (window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
      try {
        await ForkRunStore.updateRun(currentRunId, { turnCount: next });
      } catch (err) {
        console.warn('[ForkRun] 轮次校准写入失败：', currentRunId, err);
      }
    }
  }

  /**
   * 空档开局：把卷宗里的开场首帧作为第一条叙事落库。
   *
   * 卷宗只读 —— 这里读的是 `opening` 字段（成品正文，不经模型），
   * 与 `prologue`（给模型的导演提示）是两回事，别混用。
   * 留空则返回 null，退回空态由用户点 DIVE 让模型自己开场。
   *
   * @returns {Promise<Object|null>} 落库后的流水记录
   */
  async function seedOpeningFrame() {
    if (!currentRunId || !window.Store || typeof Store.loadForkDossier !== 'function') return null;

    let opening = '';
    try {
      const dossier = await Store.loadForkDossier(currentForkId);
      opening = trimStr(dossier && dossier.opening);
    } catch (err) {
      console.warn('[ForkRun] 卷宗开场首帧读取失败：', currentForkId, err);
      return null;
    }
    if (!opening) return null;

    // 开场拼接：scene 块（时空舞台）排在正文之前，符合每轮回复的标准格式；
    // 执行员状态 / NPC / 任务卡排在正文之后。精神值取档案当前值（只读，不回写），
    // 着装/姿势占位待行动，全局数值按「初始值/上限」拼进 state 块。
    const { sceneBlock, afterBlocks } = buildOpeningStateBlock();
    const parts = [];
    if (sceneBlock) parts.push(sceneBlock);
    parts.push(opening);
    if (afterBlocks) parts.push(afterBlocks);
    const content = parts.join('\n\n');

    if (!window.ForkRunStore || typeof ForkRunStore.appendRunRecord !== 'function') {
      // 存档层缺席时也别吞掉开场：至少让它上屏，只是这次不落库
      return { role: 'narration', content };
    }

    const saved = await ForkRunStore.appendRunRecord(currentRunId, {
      role: 'narration',
      content
    });

    // 打标记，否则下次重进会再注入一遍。
    // 内存里的 currentRun 一并更新，避免同一次会话内重复渲染时又注入。
    if (saved) {
      if (currentRun) currentRun.openingSeeded = true;
      try {
        await ForkRunStore.updateRun(currentRunId, { openingSeeded: true });
      } catch (err) {
        console.warn('[ForkRun] 开场注入标记写入失败：', currentRunId, err);
      }
    }

    return saved || { role: 'narration', content };
  }

  /**
   * 拼开场首帧的执行员状态快照块（:::state）+ 有数值的 NPC 块（:::npc）。
   *
   * state 块：
   * - 精神值：抓档案 Store.envoy.psych.sanity 当前值做快照（只读，不改真实值；
   *   副本里精神值只减不加，结算时才回填，这轮先只抓出来）。纯数字，上限由渲染层
   *   从档案 maxSanity 兜底，不写进块里。
   * - 着装/姿势：开场未行动，填占位句待执行员行动后系统描写。
   * - 全局数值：作者在卷宗设的每个数值拼成「数值名] 初始值/上限」，初始值留空回落上限（满状态）。
   *
   * npc 块（只拼绑了数值模板的 NPC —— 有数值才登场，路人交给 AI 现场生成）：
   * - 每个入选 NPC 拼一个 ::: npc 名字 块，着装/姿势占位，数值按模板 metrics 的初始值/上限拼。
   *
   * 一个数值/NPC 都没有、精神值也读不到时返回空串，seedOpeningFrame 就只落纯开场正文。
   */
  function buildOpeningStateBlock() {
    const lines = [];
    // 数值变动样例：给后续 AI 打个格式样板（[变动·数值名] delta 原因），
    // 开场未行动，一律 0 本轮暂无变动。精神值与各全局数值都各来一条。
    const deltaLines = [];

    // 精神值当前值快照（纯数字）
    if (window.Store && Store.envoy && Store.envoy.psych) {
      const san = Number(Store.envoy.psych.sanity);
      if (Number.isFinite(san)) {
        lines.push(`[精神值] ${san}`);
        deltaLines.push('[变动·精神值] 0 本轮暂无变动');
      }
    }

    // 着装 / 姿势：开场占位
    lines.push('[着装] 等待执行员行动后描写…');
    lines.push('[姿势] 等待执行员行动后描写…');

    // 全局数值：数值名] 初始值/上限
    if (Array.isArray(currentForkStats)) {
      currentForkStats.forEach((st) => {
        const name = trimStr(st && st.name);
        if (!name) return;
        const max = trimStr(st.max) !== '' ? trimStr(st.max) : '100';
        const init = trimStr(st.init) !== '' ? trimStr(st.init) : max;
        lines.push(`[${name}] ${init}/${max}`);
        deltaLines.push(`[变动·${name}] 0 本轮暂无变动`);
      });
    }

    // 变动样例拼在数值之后，跟随同一个 state 块落库，AI 后续照此格式续写
    const all = lines.concat(deltaLines);
    const stateBlock = all.length > 0 ? `::: state\n${all.join('\n')}\n:::` : '';

    // 场景舞台块（时间/气候/地点/场景），拼在最前——先立舞台再上叙事
    const sceneBlock = buildOpeningSceneBlock();

    // 有数值的 NPC 块（绑了数值模板的才拼；路人 NPC 交给 AI 现场生成）
    const npcBlocks = buildOpeningNpcBlocks();

    // 主线任务块（作者设的任务全部标推进中）
    const questBlock = buildOpeningQuestBlock();

    // scene 块按格式契约排在正文之前（先立时空舞台），其余状态卡在正文之后。
    // 返回结构化对象，由 seedOpeningFrame 组装成 scene → 正文 → state/npc/quest。
    const afterBlocks = [];
    if (stateBlock) afterBlocks.push(stateBlock);
    if (npcBlocks) afterBlocks.push(npcBlocks);
    if (questBlock) afterBlocks.push(questBlock);
    return {
      sceneBlock: sceneBlock || '',
      afterBlocks: afterBlocks.join('\n\n')
    };
  }

  /**
   * 拼开场时的场景舞台块（:::scene）。策略甲：空字段也拼「暂无」占位给 AI 打样。
   *
   * - 时间：逐字段补现实时间（用户填了的用填的，空的各自用打开这条线的现实时间对应位补），
   *   永远拼得出完整时间 `年.月.日 星期X 时:分`。星期为空且年月日齐全时自动算，否则用手填值。
   * - 气候：季节/温度/天气有则拼进各标签；三项全空则拼 `[天气] 暂无气候信息`。
   * - 地点：locName · locSub 组合；全空则拼 `[地点] 暂无地点信息`。
   * - 场景：有则拼；空则拼 `[场景] 暂无场景信息`。
   */
  function buildOpeningSceneBlock() {
    const s = currentForkOpeningScene || {};
    const now = new Date();
    const CN_WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

    // 逐字段补现实时间：填了用填的，空的用现实时间对应位
    const pick = (raw, fallback) => {
      const v = trimStr(raw);
      return v !== '' ? v : String(fallback);
    };
    const year = pick(s.year, now.getFullYear());
    const month = pick(s.month, now.getMonth() + 1);
    const day = pick(s.day, now.getDate());
    const hour = pick(s.hour, now.getHours());
    const minute = pick(s.minute, now.getMinutes());

    // 星期：用户手填优先（可为「水曜日」）；空则按年月日算，算不出（非法日期）留空
    let weekday = trimStr(s.weekday);
    if (!weekday) {
      const y = parseInt(year, 10);
      const m = parseInt(month, 10);
      const d = parseInt(day, 10);
      if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
        const dt = new Date(y, m - 1, d);
        if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) {
          weekday = CN_WEEKDAYS[dt.getDay()];
        }
      }
    }

    // 时:分补零对齐，日期串保持作者风格（年.月.日）
    const hh = String(hour).padStart(2, '0');
    const mm = String(minute).padStart(2, '0');
    const dateStr = `${year}.${month}.${day}`;
    const timeVal = weekday ? `${dateStr} ${weekday} ${hh}:${mm}` : `${dateStr} ${hh}:${mm}`;

    const lines = [];
    lines.push(`[时间] ${timeVal}`);

    // 气候：季节/温度/天气各自有则拼，全空拼暂无
    const season = trimStr(s.season);
    const temp = trimStr(s.temp);
    const weather = trimStr(s.weather);
    if (season || temp || weather) {
      if (season) lines.push(`[季节] ${season}`);
      if (temp) lines.push(`[温度] ${temp}`);
      if (weather) lines.push(`[天气] ${weather}`);
    } else {
      lines.push('[天气] 暂无气候信息');
    }

    // 地点：locName · locSub
    const locName = trimStr(s.locName);
    const locSub = trimStr(s.locSub);
    let locVal = '';
    if (locName && locSub) locVal = `${locName} · ${locSub}`;
    else if (locName) locVal = locName;
    else if (locSub) locVal = locSub;
    lines.push(`[地点] ${locVal || '暂无地点信息'}`);

    // 场景
    const scene = trimStr(s.scene);
    lines.push(`[场景] ${scene || '暂无场景信息'}`);

    return `::: scene\n${lines.join('\n')}\n:::`;
  }

  /**
   * 拼开场时「绑了数值模板」的角色状态块（:::npc）。
   *
   * 覆盖两类本副本已有的角色：
   *   1. 副本专属 NPC（charStats.npcIds 命中）；
   *   2. 本副本已选的高危角色（charStats.charIds 命中）。
   * 只有作者给某角色绑了数值模板才拼进开场——有专属数值 = 作者标记的重点角色，
   * 值得开场就挂状态卡；没绑数值的路人交给 AI 现场生成。
   *
   * 每个块：着装/姿势占位待描写，数值按模板 metrics 的初始值/上限拼，
   * 每个数值再附一条 0 变动样例给 AI 打样。角色不接受精神值（解析器会忽略）。
   *
   * 一个符合条件的角色都没有时返回空串。
   */
  function buildOpeningNpcBlocks() {
    if (!Array.isArray(currentForkCharStats) || currentForkCharStats.length === 0) return '';

    const blocks = [];
    const seenNames = new Set();

    // 反查某角色 ID 绑在哪套数值模板里（互斥，只会命中一套；命中第一套即用），
    // 命中且模板有数值时拼一个 :::npc 块。
    const appendBlockFor = (id, name, idField) => {
      const cid = trimStr(id);
      const cname = trimStr(name);
      if (!cid || !cname || seenNames.has(cname)) return;

      const tpl = currentForkCharStats.find((t) => Array.isArray(t[idField]) && t[idField].includes(cid));
      if (!tpl || !Array.isArray(tpl.metrics) || tpl.metrics.length === 0) return;

      const lines = [];
      const deltaLines = [];
      lines.push('[着装] 等待执行员行动后描写…');
      lines.push('[姿势] 等待执行员行动后描写…');
      tpl.metrics.forEach((m) => {
        const mname = trimStr(m && m.name);
        if (!mname) return;
        const max = trimStr(m.max) !== '' ? trimStr(m.max) : '100';
        const init = trimStr(m.init) !== '' ? trimStr(m.init) : max;
        lines.push(`[${mname}] ${init}/${max}`);
        deltaLines.push(`[变动·${mname}] 0 本轮暂无变动`);
      });

      const body = lines.concat(deltaLines).join('\n');
      blocks.push(`::: npc ${cname}\n${body}\n:::`);
      seenNames.add(cname);
    };

    // 副本专属 NPC
    (Array.isArray(currentForkNpcs) ? currentForkNpcs : []).forEach((npc) => {
      appendBlockFor(npc && npc.id, npc && npc.name, 'npcIds');
    });
    // 本副本已选高危角色
    (Array.isArray(currentForkHazardChars) ? currentForkHazardChars : []).forEach((c) => {
      appendBlockFor(c && c.id, c && c.name, 'charIds');
    });

    return blocks.join('\n\n');
  }

  /**
   * 拼开场时的主线任务块（:::quest）。
   *
   * 只拼「开局即解锁」的任务（无前置依赖的阶段任务）——有前置的任务要等前置完成后
   * 才由解锁贴脸指令引导 AI 列出，开场不该露。每条拼成 `[推进中] 任务编号 任务目标`，
   * 编号让后续轮次的完成判定能按 id 对上（解析器切首 token 认 cc_ 前缀）。
   * 一条可列任务都没有时返回空串。
   */
  function buildOpeningQuestBlock() {
    if (!Array.isArray(currentForkMissions) || currentForkMissions.length === 0) return '';

    const lines = currentForkMissions
      .filter((m) => m && !(Array.isArray(m.prereqIds) && m.prereqIds.length))
      .map((m) => {
        const goal = trimStr(m && m.goal) || trimStr(m && m.text);
        if (!goal) return '';
        const id = trimStr(m && m.id);
        return id ? `[推进中] ${id} ${goal}` : `[推进中] ${goal}`;
      })
      .filter(Boolean);

    if (lines.length === 0) return '';
    return `::: quest\n${lines.join('\n')}\n:::`;
  }

  /* ================= 顶栏与状态机 ================= */

  function syncHeader() {
    // 分支名优先：用户给这条线起了名就用它，没起名回落到卷宗名
    const branchLabel = trimStr(currentRun && currentRun.label);
    const title = branchLabel || trimStr(currentFork && currentFork.title) || '副本推演';
    if (headerTitle) headerTitle.textContent = title;

    if (headerMeta) {
      const code = trimStr(currentFork && currentFork.code) || 'FORK';
      const statusMap = window.ForkRunStore ? ForkRunStore.RUN_STATUS : null;
      const stKey = currentRun && currentRun.status ? currentRun.status : 'active';
      const stEn = statusMap && statusMap[stKey] ? statusMap[stKey].en : 'ACTIVE';
      headerMeta.textContent = `${code} // ${stEn}`;
    }

    if (turnCodeEl) {
      const turn = currentRun && currentRun.turnCount ? currentRun.turnCount : 0;
      turnCodeEl.textContent = `T${String(turn).padStart(2, '0')}`;
    }
  }

  /**
   * 可写 / 只读切换。只读不是另一个页面，是本页的一个模式：
   * 输入台整块隐藏、换成封存提示条，其余渲染完全不变。
   */
  function applyReadonly(readonly, statusKey) {
    isReadonly = !!readonly;
    if (pageEl) pageEl.classList.toggle('is-readonly', isReadonly);

    if (isReadonly) toggleDockPanel(false);
    if (footerEl) footerEl.hidden = isReadonly;
    if (readonlyBar) readonlyBar.hidden = !isReadonly;

    if (isReadonly && readonlyText) {
      readonlyText.textContent = statusKey === 'abandoned'
        ? '此线已放弃，仅供翻阅'
        : '此线已结算，仅供翻阅';
    }
  }

  /* ================= 滚动 ================= */

  function settleBottom(instant) {
    if (!bodyEl) return;
    if (instant) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
      return;
    }
    bodyEl.scrollTo({ top: bodyEl.scrollHeight, behavior: 'smooth' });
  }

  function followBottomIfNear() {
    if (!bodyEl) return;
    const distance = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight;
    if (distance > 220) return;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function updateJumpDeckVisibility() {
    if (!jumpDeck || !bodyEl) return;
    const maxScroll = bodyEl.scrollHeight - bodyEl.clientHeight;
    if (maxScroll <= 30) {
      jumpDeck.classList.remove('is-visible');
      return;
    }
    const atTop = bodyEl.scrollTop <= 35;
    const atBottom = (maxScroll - bodyEl.scrollTop) <= 35;
    jumpDeck.classList.toggle('is-visible', !atTop && !atBottom);
  }

  /* ================= 输入台 ================= */

  /** 输入台增量让位。基线由 CSS 静态给出，这里只补运行时真实变高的部分 */
  function syncFooterSpace() {
    if (!bodyEl || !footerEl || footerEl.hidden) return;
    if (!pageEl || !pageEl.classList.contains('active')) return;

    const height = Math.ceil(footerEl.getBoundingClientRect().height || 0);
    if (height <= 0) return;

    const bottomSafe = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--safe-area-bottom')) || 0;
    const extra = Math.max(0, height - bottomSafe - FOOTER_BASELINE_PX);
    bodyEl.style.setProperty('--fork-run-extra-space', `${extra}px`);
  }

  function autoResizeTextarea() {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    if (sendBtn && !currentInference && !currentVision) {
      const hasContent = textarea.value.trim().length > 0 || pendingImages.length > 0 || pendingFiles.length > 0;
      sendBtn.classList.toggle('is-ready', hasContent);
    }
    syncFooterSpace();
  }

  function clearPendingImages() {
    if (pendingImages.length) {
      for (const item of pendingImages) {
        if (item && item.objectUrl) {
          try { URL.revokeObjectURL(item.objectUrl); } catch (_) {}
        }
      }
      pendingImages = [];
    }
    if (imagePreviewBar) imagePreviewBar.remove();
    imagePreviewBar = null;
    autoResizeTextarea();
  }

  function clearPendingFiles() {
    pendingFiles = [];
    if (filePreviewBar) filePreviewBar.remove();
    filePreviewBar = null;
    autoResizeTextarea();
  }

  function removePendingFile(index) {
    if (index >= 0 && index < pendingFiles.length) {
      pendingFiles.splice(index, 1);
      renderPendingFiles();
    }
  }

  /** 渲染待发送文件条：支持多文件，每个呈现为机能 Chip，带纯 SVG 文档与删除按钮 */
  function renderPendingFiles() {
    if (filePreviewBar) {
      filePreviewBar.remove();
      filePreviewBar = null;
    }
    if (!pendingFiles.length) {
      autoResizeTextarea();
      return;
    }
    const shell = textarea && textarea.parentElement;
    if (!shell) return;

    filePreviewBar = document.createElement('div');
    filePreviewBar.className = 'chat-file-preview-bar fork-run-file-preview-bar';

    pendingFiles.forEach((file, idx) => {
      const chip = document.createElement('div');
      chip.className = 'chat-file-preview-chip';

      const icon = document.createElement('span');
      icon.className = 'chat-file-preview-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';

      const name = document.createElement('span');
      name.className = 'chat-file-preview-name';
      name.textContent = file.name || '未命名文件';
      name.title = file.name || '';

      const size = document.createElement('span');
      size.className = 'chat-file-preview-size';
      size.textContent = file.sizeText || '';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'chat-file-preview-remove';
      removeBtn.setAttribute('aria-label', `移除文件 ${file.name}`);
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removePendingFile(idx);
      });

      chip.append(icon, name, size, removeBtn);
      filePreviewBar.appendChild(chip);
    });

    // 挂在图片预览托盘（若有）下方、输入框上方
    if (imagePreviewBar && imagePreviewBar.nextSibling) {
      shell.insertBefore(filePreviewBar, imagePreviewBar.nextSibling);
    } else {
      shell.insertBefore(filePreviewBar, textarea);
    }

    if (sendBtn) sendBtn.classList.add('is-ready');
    autoResizeTextarea();
  }

  function getForkFileScope() {
    return { type: 'fork', id: currentForkId || 'unknown' };
  }

  function selectForkFile() {
    if (!window.FileVaultUI || typeof FileVaultUI.openForPick !== 'function') {
      toast('FILE // 无法开启', '文件区模块尚未就绪', '请稍后重试', 'warning');
      return;
    }
    toggleDockPanel(false);
    FileVaultUI.openForPick(getForkFileScope(), (entries) => {
      if (Array.isArray(entries) && entries.length) {
        // 去重合并入 pendingFiles
        const existIds = new Set(pendingFiles.map((f) => f.id));
        for (const entry of entries) {
          if (!existIds.has(entry.id)) {
            pendingFiles.push(entry);
          }
        }
        renderPendingFiles();
      }
    });
  }

  function removePendingImage(index) {
    if (index >= 0 && index < pendingImages.length) {
      const removed = pendingImages.splice(index, 1)[0];
      if (removed && removed.objectUrl) {
        try { URL.revokeObjectURL(removed.objectUrl); } catch (_) {}
      }
      renderPendingImages();
    }
  }

  function renderPendingImages() {
    if (imagePreviewBar) {
      imagePreviewBar.remove();
      imagePreviewBar = null;
    }
    if (!pendingImages.length) {
      autoResizeTextarea();
      return;
    }
    const shell = textarea && textarea.parentElement;
    if (!shell) return;

    imagePreviewBar = document.createElement('div');
    imagePreviewBar.className = 'chat-image-preview-deck';

    pendingImages.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'chat-image-preview-card';
      const img = document.createElement('img');
      img.src = item.objectUrl;
      img.alt = `预览图 ${idx + 1}`;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'chat-image-preview-remove';
      removeBtn.setAttribute('aria-label', '移除图片');
      removeBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removePendingImage(idx);
      });

      card.append(img, removeBtn);
      imagePreviewBar.appendChild(card);
    });

    const addCard = document.createElement('button');
    addCard.type = 'button';
    addCard.className = 'chat-image-preview-add';
    addCard.setAttribute('aria-label', '继续添加图片');
    addCard.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><span>+ADD</span>';
    addCard.addEventListener('click', (e) => {
      e.stopPropagation();
      selectForkImage().catch((err) => {
        toast('VISION // 失败', '图片选取失败', err.message || '无法打开图片选择器', 'warning');
      });
    });
    imagePreviewBar.appendChild(addCard);

    shell.insertBefore(imagePreviewBar, textarea);
    if (sendBtn) sendBtn.classList.add('is-ready');
    autoResizeTextarea();
  }

  function renderPendingImage(blob) {
    if (!blob) return;
    const objectUrl = URL.createObjectURL(blob);
    pendingImages.push({ blob, objectUrl });
    renderPendingImages();
  }

  async function selectForkImage() {
    if (!window.ImagePicker || typeof ImagePicker.open !== 'function') throw new Error('图片选择器尚未加载');
    ImagePicker.open({
      title: '附带行动线索影像',
      multiple: true,
      onSelect: async (result) => {
        try {
          const blobs = [];
          if (result && result.type === 'file' && result.file) blobs.push(result.file);
          else if (result && result.type === 'files' && Array.isArray(result.files)) blobs.push(...result.files);
          else if (result && result.type === 'url' && result.url) {
            const resp = await fetch(result.url);
            if (!resp.ok) throw new Error('远端图片读取失败');
            blobs.push(await resp.blob());
          } else if (result && result.type === 'urls' && Array.isArray(result.urls)) {
            for (const u of result.urls) {
              const resp = await fetch(u);
              if (resp.ok) blobs.push(await resp.blob());
            }
          }

          const validBlobs = blobs.filter((b) => b && String(b.type || '').startsWith('image/'));
          if (!validBlobs.length) throw new Error('请选择有效的图片文件');

          for (const b of validBlobs) {
            const compressed = window.Storage && typeof Storage.compressImage === 'function'
              ? await Storage.compressImage(b, 1600, 0.84) : b;
            renderPendingImage(compressed);
          }
          toggleDockPanel(false);
        } catch (err) {
          toast('VISION // 失败', '图片载入失败', err.message || '无法读取图片', 'warning');
        }
      }
    });
  }

  function toggleDockPanel(forceState) {
    if (!dockPanel || !plusBtn) return;
    const willOpen = typeof forceState === 'boolean'
      ? forceState
      : !dockPanel.classList.contains('is-open');

    if (willOpen) {
      dockPanel.hidden = false;
      void dockPanel.offsetWidth;
      dockPanel.classList.add('is-open');
      plusBtn.classList.add('is-active');
    } else {
      dockPanel.classList.remove('is-open');
      plusBtn.classList.remove('is-active');
      setTimeout(() => {
        if (!dockPanel.classList.contains('is-open')) dockPanel.hidden = true;
      }, 300);
    }
    syncFooterSpace();
  }

  /* ================= 推演请求上下文 ================= */

  /**
   * 拼提示词引擎要的执行员上下文。
   *
   * 与 resolveIdentityInfo 的区别：那个只供 UI 渲染（姓名 / 编号 / 立绘），
   * 这个要把档案全字段交给模型（性别、外貌、简介、锁定角色设定），
   * 且 mode 用的是 prompt 引擎的口径（persona / mask / locked）。
   *
   * @returns {Object} { mode, roleId, serial, name, gender, birthday, appearance, profile }
   */
  function buildEnvoyCtx() {
    let serial = '';
    if (window.Store && typeof Store.getSerialNo === 'function') {
      try { serial = Store.getSerialNo(); } catch (_) {}
    }
    const cleanSerial = String(serial || '').replace(/\D/g, '').padStart(6, '0').slice(-6) || '000001';

    const type = trimStr(currentRun && currentRun.identityType);
    const targetId = trimStr(currentRun && (currentRun.identityId || currentRun.maskId));

    // 1. 锁定角色：档案取自卷宗 lockedRoles（存档里的 preset 与 locked 同义）
    if ((type === 'preset' || type === 'locked') && currentFork && Array.isArray(currentFork.lockedRoles)) {
      const role = currentFork.lockedRoles.find((r) => r && String(r.id) === targetId);
      if (role) {
        return {
          mode: 'locked',
          roleId: trimStr(role.id),
          serial: cleanSerial,
          name: trimStr(role.name),
          gender: trimStr(role.gender),
          birthday: '',
          appearance: trimStr(role.appearance),
          profile: trimStr(role.profile),
          extra: trimStr(currentRun && currentRun.identityExtra)
        };
      }
    }

    // 2. 马甲：与本体同构字段
    if (type === 'mask' && targetId) {
      let mask = null;
      if (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) {
        mask = Store.envoy.masks.find((m) => m && String(m.id) === targetId);
      }
      if (mask) {
        return {
          mode: 'mask',
          roleId: '',
          serial: cleanSerial,
          name: trimStr(mask.name),
          gender: trimStr(mask.gender),
          birthday: trimStr(mask.birthday),
          appearance: trimStr(mask.appearance),
          profile: trimStr(mask.profile),
          extra: trimStr(currentRun && currentRun.identityExtra)
        };
      }
    }

    // 3. 本体：读不到档案时也给个空壳，提示词引擎会自行丢掉空字段
    const identity = (window.Store && Store.envoy && Store.envoy.identity) || {};
    return {
      mode: 'persona',
      roleId: '',
      serial: cleanSerial,
      name: trimStr(identity.name),
      gender: trimStr(identity.gender),
      birthday: trimStr(identity.birthday),
      appearance: trimStr(identity.appearance),
      profile: trimStr(identity.profile),
      extra: trimStr(currentRun && currentRun.identityExtra)
    };
  }

  /**
   * 提交一条执行员行动，随即发起本轮推演请求。
   *
   * 落库顺序：行动先上屏再落库（落库慢不该卡手感），拿到 recordId 后回填。
   * 请求侧读的是「刚落库后的完整流水」，而不是内存里拼的片段 ——
   * 编辑过的历史、补注入的开场都在库里，只有重读才拿得到真相。
   */
  async function submitAct() {
    if (isReadonly || !textarea) return;
    // 推演/识图进行中不受理新行动：按钮此时是终止态，点击走 abortInference
    if (currentInference || currentVision) return;
    const text = trimStr(textarea.value);
    const imageBlobs = pendingImages.map((p) => p.blob).filter(Boolean);
    const filesToSend = pendingFiles.slice();
    if (!text && !imageBlobs.length && !filesToSend.length) return;

    textarea.value = '';
    clearPendingImages();
    clearPendingFiles();
    toggleDockPanel(false);

    // 计算当前行动所属轮次。
    const nextTurn = (currentRun && Number(currentRun.turnCount) ? Number(currentRun.turnCount) : 0) + 1;
    const actName = (resolveIdentityInfo() || {}).name || '执行员';

    // 归档图片：统一进视界档案（对话缓存 / 按副本成册），行动流水只存图库编号。
    // 不把 base64 写进 records —— 流水是上下文的真相源，塞进大图会把预算瞬间烧穿。
    const savedImages = [];
    if (imageBlobs.length && window.GalleryStore && typeof GalleryStore.record === 'function') {
      const forkTitle = trimStr(currentFork && (currentFork.title || currentFork.name)) || '世界线推演';
      for (const blob of imageBlobs) {
        try {
          const entry = await GalleryStore.record(blob, {
            source: 'fork-run',
            category: 'chat-cache',
            ownerType: 'fork',
            ownerId: currentForkId || 'fork-unknown',
            ownerName: forkTitle
          });
          if (entry && entry.id) savedImages.push({ galleryId: entry.id, assetKey: entry.key });
        } catch (err) {
          console.warn('[ForkRun] 影像归档失败：', err);
        }
      }
    }

    // 整理待发战术文件轻量元数据
    const savedFiles = filesToSend.map((f) => ({
      id: f.id,
      name: f.name,
      sizeText: f.sizeText,
      charCount: f.charCount
    }));

    const hasVision = savedImages.length > 0;

    const actRow = appendAct({
      text,
      name: actName,
      turn: nextTurn,
      images: savedImages,
      files: savedFiles,
      visionState: hasVision ? 'pending' : ''
    });
    settleBottom(true);

    // 落库：推演流水统一走存档层，UI 不直接碰 Storage
    let savedRecordId = '';
    if (window.ForkRunStore && typeof ForkRunStore.appendRunRecord === 'function') {
      const saved = await ForkRunStore.appendRunRecord(currentRunId, {
        role: 'envoy',
        content: text,
        name: actName,
        turn: nextTurn,
        images: savedImages,
        files: savedFiles
      });
      if (!saved) {
        toast('DECK // 落库失败', '这条行动没能存上', '内容仍在屏上，但重进本页会丢失', 'error');
      } else {
        savedRecordId = saved.id;
        if (actRow) actRow.dataset.recordId = saved.id;
      }
    }
    if (currentRun) currentRun.turnCount = nextTurn;
    syncHeader();

    // 无图：直接推演，与旧行为完全一致
    if (!hasVision) {
      await runInference(nextTurn);
      return;
    }

    // 带图：先阻塞识图，识别结果（纯文本）回填进流水后再自动发起推演。
    // 期间发送键保持终止态，用户可随时取消并让行动原样退回输入台。
    const ok = await runVisionGate({
      text,
      blobs: imageBlobs,
      images: savedImages,
      recordId: savedRecordId,
      row: actRow,
      turn: nextTurn
    });
    if (!ok) return;

    await runInference(nextTurn);
  }

  /* ================= 识图闸门 ================= */

  /** 视觉识别超时护栏：单张 90 秒，超时按失败处理，不无限吊着 */
  function withForkVisionTimeout(task, timeoutMs) {
    const timeout = Math.max(1000, Number(timeoutMs) || 90000);
    return Promise.race([
      Promise.resolve().then(task),
      new Promise((_, reject) => setTimeout(() => reject(new Error('视觉识别超时，请确认视觉模型节点可用')), timeout))
    ]);
  }

  /** 单张识图：口径与系统助手页一致，只要纯文本描述 */
  async function recognizeForkImage(blob, userText, signal) {
    return withForkVisionTimeout(async () => {
      if (!window.RetroflowApiUI || typeof RetroflowApiUI.resolveSlot !== 'function' || !window.RetroflowAPI) {
        throw new Error('视觉识别模块尚未加载');
      }
      const config = RetroflowApiUI.resolveSlot('vision');
      if (!config || !config.baseUrl || !config.modelId) throw new Error('尚未配置视觉模型或主模型');

      const dataUrl = await blobToDataUrlForFork(blob);
      const prompt = [
        '请客观、详细地描述这张图片，供后续纯文本推演作为视觉记忆使用。',
        '描述主体、环境、动作、构图、可辨识文字及关键细节；不要回答图片之外的问题，不要使用 Markdown 标题。',
        userText ? `执行员随图行动：${userText}` : ''
      ].filter(Boolean).join('\n');

      const result = await RetroflowAPI.chat(config, [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }], { timeout: 120000, signal });

      const description = trimStr(result && result.content ? result.content : '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .trim();
      if (!description) throw new Error('视觉模型未返回有效描述');
      return description;
    });
  }

  function blobToDataUrlForFork(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 识图闸门：并发识别本轮全部附图，把描述写回流水，再放行推演。
   *
   * 为什么描述写进 images[i].visionDescription 而不是拼进 content：
   * content 是执行员亲手打的字，混入机器描述会让「编辑这条行动」变成一团乱麻。
   * 描述作为附图的元数据存放，由 fork-run-api 在装上下文时临时拼接。
   *
   * @returns {Promise<boolean>} true = 识别收尾、可以发推演；false = 用户中途取消
   */
  async function runVisionGate(ctx) {
    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    currentVision = {
      controller,
      aborted: false,
      recordId: ctx.recordId,
      row: ctx.row,
      text: ctx.text,
      blobs: ctx.blobs,
      images: ctx.images
    };
    setSendButtonState(true);

    const results = await Promise.all(ctx.images.map((_, i) => (
      recognizeForkImage(ctx.blobs[i], ctx.text, controller ? controller.signal : null)
        .then((desc) => desc)
        .catch((err) => {
          console.warn('[ForkRun] 影像识别失败：', err);
          return '';
        })
    )));

    // 取消发生在等待期间：回滚已由 abortVision 处理完，这里直接收手
    if (!currentVision || currentVision.aborted) {
      currentVision = null;
      return false;
    }
    currentVision = null;

    const merged = ctx.images.map((item, i) => Object.assign({}, item, {
      visionDescription: results[i] || ''
    }));
    const okCount = results.filter(Boolean).length;

    // 描述回填流水；写失败不拦推演，只是这轮模型看不到图的内容
    if (ctx.recordId && window.ForkRunStore && typeof ForkRunStore.updateRunRecord === 'function') {
      try {
        await ForkRunStore.updateRunRecord(currentRunId, ctx.recordId, { images: merged });
      } catch (err) {
        console.warn('[ForkRun] 视觉描述回填失败：', err);
      }
    }

    // 胶囊换态：全失败标红，部分成功按成功算
    if (ctx.row) {
      const oldPill = ctx.row.querySelector('.fork-run-act-image-pill');
      if (oldPill && oldPill.parentNode) {
        oldPill.parentNode.replaceChild(
          buildActImagePill(merged, okCount ? 'done' : 'failed'),
          oldPill
        );
      }
    }

    if (!okCount) {
      toast('VISION // 识别失败', '影像未能解析', '本轮推演将不带视觉信息发出', 'warning');
    }

    setSendButtonState(false);
    return true;
  }

  /**
   * 取消识图：把这一轮连根拔掉，让执行员回到按发送键之前的状态。
   *
   * 三件事必须一起做完，缺一件都会留下死链：
   *   1. 抹除流水记录与屏上行动卡（推演还没发，留着它就是一条悬空的用户输入）
   *   2. 文字退回输入框、图片退回待发托盘（用户的输入不该因为取消而消失）
   *   3. 清掉刚落库的图库条目（图还没进入任何因果，不该留在视界档案里）
   */
  async function abortVision() {
    if (!currentVision) return;
    const vision = currentVision;
    vision.aborted = true;
    currentVision = null;

    if (vision.controller) {
      try { vision.controller.abort(); } catch (_) { /* 已结束的请求 abort 会抛，忽略 */ }
    }

    // 1. 抹除流水与屏上行动卡
    if (vision.recordId && window.ForkRunStore && typeof ForkRunStore.deleteRunRecord === 'function') {
      try { await ForkRunStore.deleteRunRecord(currentRunId, vision.recordId); } catch (_) {}
    }
    if (vision.row && vision.row.parentNode) vision.row.remove();

    // 2. 文字与图片退回输入台
    if (textarea && vision.text) {
      textarea.value = vision.text;
    }
    (vision.blobs || []).forEach((blob) => renderPendingImage(blob));
    if (textarea) textarea.focus();
    autoResizeTextarea();

    // 3. 清掉刚落库的图库条目：下次发送会重新压缩、重新入库、重新识别
    const ids = (vision.images || []).map((it) => it && it.galleryId).filter(Boolean);
    if (ids.length && window.GalleryStore && typeof GalleryStore.remove === 'function') {
      try { await GalleryStore.remove(ids, { silentChatRelease: true }); } catch (_) {}
    }

    setSendButtonState(false);
    toast('VISION // 已终止', '本轮行动已撤回', '行动文字与影像已退回输入台，可修改后重发', 'info');
  }

  /**
   * 跑一轮推演：装请求、流式上屏、落库、复位按钮。
   *
   * @param {number} turn 本轮轮次（与触发它的执行员行动同轮）
   */
  async function runInference(turn) {
    if (!window.ForkRunApi || typeof ForkRunApi.requestInference !== 'function') {
      toast('DIVE // 推演链路', '请求模块未加载', '推演请求模块缺席，本轮未发出', 'error');
      return;
    }

    // 读刚落库后的完整流水作为上下文：编辑过的历史、补注入的开场都在库里
    let records = [];
    if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function') {
      try {
        records = await ForkRunStore.getRunRecords(currentRunId);
      } catch (err) {
        console.warn('[ForkRun] 上下文流水读取失败：', currentRunId, err);
      }
    }

    // 请求前统一触发判定：扫「上一轮 AI 回复 + 本轮执行员输入」，命中就置状态，
    // 让真相/结局导演指令能进本轮请求。卡片延到回复落定后挂。
    try {
      await processTriggersBeforeRequest(records, turn);
    } catch (err) {
      console.warn('[ForkRun] 请求前触发判定失败：', err);
    }

    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    currentInference = { controller, aborted: false };
    setSendButtonState(true);

    // 等待态占位：流式首字到达时替换成真实叙事块
    const pending = appendPendingNarration();
    settleBottom(true);

    // 深度注入汇总（含每轮精神状态通知 / 新阶段任务解锁提示）需读库，先 await 出来再发请求
    const depthItems = await buildAllDepthItems(turn);

    let full = '';
    let failed = null;
    try {
      full = await ForkRunApi.requestInference({
        fork: currentFork,
        envoyCtx: buildEnvoyCtx(),
        openingCtx: { openingId: trimStr(currentRun && currentRun.openingId) },
        records,
        clueCtx: buildClueCtx(turn),
        truthCtx: buildTruthCtx(),
        endingCtx: buildEndingCtx(),
        missionCtx: buildMissionCtx(),
        depthItems,
        rosterIds: buildRosterIds(),
        wbOverrides: buildWbOverrides(),
        signal: controller ? controller.signal : null,
        onChunk: (delta, fullText) => {
          if (currentInference && currentInference.aborted) return;
          updatePendingNarration(pending, fullText);
        }
      });
    } catch (err) {
      failed = err;
    }

    const wasAborted = !!(currentInference && currentInference.aborted);
    currentInference = null;
    setSendButtonState(false);
    removePendingNarration(pending);

    // 用户主动中断：已流出的部分照常落库，不当失败处理（AbortError 不弹错）
    const isAbortErr = !!(failed && failed.name === 'AbortError');
    if (failed && !isAbortErr && !wasAborted) {
      toast('DIVE // 推演失败', '本轮推演没能完成', trimStr(failed.message) || '链路异常', 'error');
      if (streamEl && streamEl.children.length === 0) renderEmptyState();
      return;
    }

    const content = trimStr(full);
    if (!content) {
      if (!wasAborted && !isAbortErr) {
        toast('DIVE // 空回复', '模型没有输出内容', '可尝试重新提交本轮行动', 'warning');
      }
      if (streamEl && streamEl.children.length === 0) renderEmptyState();
      return;
    }

    // 落库后再渲染：拿到真实 recordId，长按编辑才有的可改
    let saved = null;
    if (window.ForkRunStore && typeof ForkRunStore.appendRunRecord === 'function') {
      saved = await ForkRunStore.appendRunRecord(currentRunId, {
        role: 'narration',
        content,
        turn
      });
      if (!saved) {
        toast('DECK // 落库失败', '这段叙事没能存上', '内容仍在屏上，但重进本页会丢失', 'error');
      }
    }

    const parsed = (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function')
      ? ForkRunParser.parseRunReply(content)
      : { body: content, scene: null, state: null, allies: [], npcs: [], quest: null };

    const narrationBlock = appendNarration({
      recordId: saved ? saved.id : '',
      createdAt: (saved && saved.createdAt) || Date.now(),
      rawText: content,
      text: parsed.body,
      turn,
      status: parsed.scene,
      vitals: parsed.state ? { ...parsed.state, parsed: true } : null,
      allies: parsed.allies,
      npcs: parsed.npcs,
      missions: parsed.quest,
      variants: saved ? saved.variants : null,
      activeVariantIndex: saved ? saved.activeVariantIndex : 0,
      parsed: true
    });

    // 线索触发系统：地点触发 / AI 亮出 / 超时兜底，并在本轮叙事块内追加解锁提示条
    try {
      await processCluesAfterReply(parsed, turn, narrationBlock);
    } catch (err) {
      console.warn('[ForkRun] 线索处理失败：', err);
    }

    // 阶段任务：按 AI 在 quest 块里回执的任务编号落完成态（持久，供下游任务解锁）
    try {
      await processMissionsAfterReply(parsed, turn, (narrationBlock && narrationBlock.dataset) ? narrationBlock.dataset.recordId : '');
    } catch (err) {
      console.warn('[ForkRun] 阶段任务处理失败：', err);
    }

    settleBottom(false);
  }

  /**
   * 「继续」：把点击视为执行员发了一条隐式的「继续剧情」行动，向后推进剧情。
   *
   * 与 submitAct 的本质区别在于这条行动阅后即焚：
   *   - 不落库：绝不调 appendRunRecord 写这条 envoy 行动，库里干干净净；
   *   - 不上屏：屏幕上不追加行动卡，用户看不到「继续剧情」这四个字；
   *   - 只在内存的 records 数组尾部临时拼一条 envoy 记录喂给模型当本轮输入。
   * 模型据此接着往下写，生成的叙事作为普通 narration 正常落库、正常上屏。
   *
   * @param {HTMLElement} targetEl 触发继续的末尾叙事 DOM（仅用于二次防护）
   * @param {Object} rec 记录数据（未直接使用，保持签名统一）
   */
  async function handleContinueNarration(targetEl, rec) {
    if (isReadonly) return;
    if (currentInference) {
      toast('CONTINUE // 推演进行中', '当前已有推演在运行', '请等待本轮结束或点击终止后再继续', 'info');
      return;
    }
    if (!window.ForkRunApi || typeof ForkRunApi.requestInference !== 'function') {
      toast('CONTINUE // 链路异常', '推演请求模块未就绪', '无法启动模型推理', 'error');
      return;
    }

    // 轮次推进：与 submitAct 同口径，接着当前 turnCount 往上加一轮
    const nextTurn = (currentRun && Number(currentRun.turnCount) ? Number(currentRun.turnCount) : 0) + 1;

    // 读库里已有的完整流水作为上下文（编辑过的历史、补注入的开场都在库里）
    let records = [];
    if (window.ForkRunStore && typeof ForkRunStore.getRunRecords === 'function') {
      try {
        records = await ForkRunStore.getRunRecords(currentRunId);
      } catch (err) {
        console.warn('[ForkRun] 继续剧情上下文读取失败：', currentRunId, err);
      }
    }

    // 隐式行动只活在内存里：拼进上下文尾部当本轮 user 输入，绝不落库。
    // 用后即焚，整场推演的库里永远看不到这条「继续剧情」。
    const continueDirective = '（继续剧情：请紧接上文，自然地把故事往下推进。）';
    const contextRecords = (Array.isArray(records) ? records.slice() : []).concat([{
      role: 'envoy',
      content: continueDirective,
      turn: nextTurn
    }]);

    // 请求前统一触发判定：扫「上一轮 AI 回复 + 本轮隐式继续指令」，命中就置状态，
    // 让真相/结局导演指令能进本轮请求。卡片延到回复落定后挂。
    try {
      await processTriggersBeforeRequest(contextRecords, nextTurn);
    } catch (err) {
      console.warn('[ForkRun] 请求前触发判定失败：', err);
    }

    const controller = (typeof AbortController === 'function') ? new AbortController() : null;
    currentInference = { controller, aborted: false };
    setSendButtonState(true);

    // 等待态占位：流式首字到达时替换成真实叙事块
    const pending = appendPendingNarration();
    settleBottom(true);

    // 深度注入汇总（含每轮精神状态通知 / 新阶段任务解锁提示）需读库，先 await 出来再发请求
    const depthItems = await buildAllDepthItems(turn);

    let full = '';
    let failed = null;
    try {
      full = await ForkRunApi.requestInference({
        fork: currentFork,
        envoyCtx: buildEnvoyCtx(),
        openingCtx: { openingId: trimStr(currentRun && currentRun.openingId) },
        records,
        clueCtx: buildClueCtx(turn),
        truthCtx: buildTruthCtx(),
        endingCtx: buildEndingCtx(),
        missionCtx: buildMissionCtx(),
        depthItems,
        rosterIds: buildRosterIds(),
        wbOverrides: buildWbOverrides(),
        signal: controller ? controller.signal : null,
        onChunk: (delta, fullText) => {
          if (currentInference && currentInference.aborted) return;
          updatePendingNarration(pending, fullText);
        }
      });
    } catch (err) {
      failed = err;
    }

    const wasAborted = !!(currentInference && currentInference.aborted);
    currentInference = null;
    setSendButtonState(false);
    removePendingNarration(pending);

    const isAbortErr = !!(failed && failed.name === 'AbortError');
    if (failed && !isAbortErr && !wasAborted) {
      toast('CONTINUE // 推演失败', '续写没能完成', trimStr(failed.message) || '链路异常', 'error');
      if (streamEl && streamEl.children.length === 0) renderEmptyState();
      return;
    }

    const content = trimStr(full);
    if (!content) {
      if (!wasAborted && !isAbortErr) {
        toast('CONTINUE // 空回复', '模型没有输出内容', '可再点一次继续', 'warning');
      }
      if (streamEl && streamEl.children.length === 0) renderEmptyState();
      return;
    }

    // 只把模型续写的叙事落库，隐式的「继续剧情」行动始终不写。
    let saved = null;
    if (window.ForkRunStore && typeof ForkRunStore.appendRunRecord === 'function') {
      saved = await ForkRunStore.appendRunRecord(currentRunId, {
        role: 'narration',
        content,
        turn: nextTurn
      });
      if (!saved) {
        toast('DECK // 落库失败', '这段叙事没能存上', '内容仍在屏上，但重进本页会丢失', 'error');
      }
    }

    // 轮次推进：叙事已落库，顶栏 T0X 与内存副本同步跟上
    if (currentRun) currentRun.turnCount = nextTurn;
    syncHeader();

    const parsed = (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function')
      ? ForkRunParser.parseRunReply(content)
      : { body: content, scene: null, state: null, allies: [], npcs: [], quest: null };

    const narrationBlock = appendNarration({
      recordId: saved ? saved.id : '',
      createdAt: (saved && saved.createdAt) || Date.now(),
      rawText: content,
      text: parsed.body,
      turn: nextTurn,
      status: parsed.scene,
      vitals: parsed.state ? { ...parsed.state, parsed: true } : null,
      allies: parsed.allies,
      npcs: parsed.npcs,
      missions: parsed.quest,
      variants: saved ? saved.variants : null,
      activeVariantIndex: saved ? saved.activeVariantIndex : 0,
      parsed: true
    });

    // 线索触发系统：地点触发 / AI 亮出 / 超时兜底，并在本轮叙事块内追加解锁提示条
    try {
      await processCluesAfterReply(parsed, nextTurn, narrationBlock);
    } catch (err) {
      console.warn('[ForkRun] 线索处理失败：', err);
    }

    // 阶段任务：按 AI 在 quest 块里回执的任务编号落完成态（持久，供下游任务解锁）
    try {
      await processMissionsAfterReply(parsed, nextTurn, (narrationBlock && narrationBlock.dataset) ? narrationBlock.dataset.recordId : '');
    } catch (err) {
      console.warn('[ForkRun] 阶段任务处理失败：', err);
    }

    settleBottom(false);
  }

  /** 全屏大窗输入，复用项目通用 TextEditorModal */
  async function openExpandEditor() {
    if (isReadonly) return;
    if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;
    const updated = await TextEditorModal.open({
      title: '行动描述',
      tag: 'DIVE // 执行员行动',
      value: textarea ? textarea.value : '',
      placeholder: '详细描述你的行动、话语与判断…',
      maxLength: 4000
    });
    if (updated !== null && updated !== undefined && textarea) {
      textarea.value = updated;
      autoResizeTextarea();
      textarea.focus();
    }
  }

  /* ================= 菜单 / 元设置入口 ================= */

  function openSettings() {
    if (window.ForkRunSettingsUI && typeof ForkRunSettingsUI.open === 'function') {
      ForkRunSettingsUI.open(currentForkId, currentRunId);
    } else {
      toast('SETTINGS // 副本设置', '模块加载中', '推演设置面板初始化中，请稍候', 'info');
    }
  }

  /* ================= 头像 ================= */

  /**
   * 取执行员在本次下潜显示的立绘。
   * 遵循动态身份：锁定角色预设立绘 > 马甲立绘 > 本人立绘。
   */
  async function loadEnvoyAvatar() {
    releaseEnvoyAvatar();
    if (!window.Storage || !window.DataRegistry || !DataRegistry.key) return;
    try {
      const type = trimStr(currentRun && currentRun.identityType);
      const targetId = trimStr(currentRun && (currentRun.identityId || currentRun.maskId));

      // 1. 副本预设锁定角色：直接读卷宗中的 avatar 字段（URL 或 Base64）
      if ((type === 'preset' || type === 'locked') && currentFork && Array.isArray(currentFork.lockedRoles)) {
        const role = currentFork.lockedRoles.find((r) => r && String(r.id) === targetId);
        if (role && role.avatar) {
          envoyAvatarUrl = role.avatar;
          return;
        }
      }

      // 2. 马甲身份立绘
      if (type === 'mask' && targetId) {
        const src = await Storage.getAssetSrc(DataRegistry.key.maskAvatar(targetId));
        if (src) {
          envoyAvatarUrl = src;
          return;
        }
      }

      // 3. 默认读本人本体立绘
      const src = await Storage.getAssetSrc(DataRegistry.key.personaAvatar());
      envoyAvatarUrl = src || '';
    } catch (_) {
      envoyAvatarUrl = '';
    }
  }

  function releaseEnvoyAvatar() {
    if (envoyAvatarUrl && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
      Storage.revokeAssetSrc(envoyAvatarUrl);
    }
    envoyAvatarUrl = '';
  }

  /**
   * 读取本副本作者设定的数值指标，缓存成本次下潜的只读快照。
   *
   * 卷宗只读：这里只取 name / min / max / init，不回写任何字段。
   * 初始值留空是允许的写法，按编辑器的约定回落到 MAX（满状态进本）。
   * 读不到卷宗或作者一个数值都没设，快照留空，状态卡底栏整块不渲染。
   */
  async function loadForkStats() {
    currentForkStats = [];
    currentForkNpcs = [];
    currentForkHazardChars = [];
    currentForkHazardIds = [];
    currentForkCharStats = [];
    currentForkMissions = [];
    currentForkOpeningScene = null;
    if (!currentForkId || !window.Store || typeof Store.loadForkDossier !== 'function') return;

    let rawStats = [];
    let rawNpcs = [];
    let rawCharStats = [];
    let rawMissions = [];
    let rawHazardIds = [];
    try {
      const dossier = await Store.loadForkDossier(currentForkId);
      rawStats = (dossier && Array.isArray(dossier.stats)) ? dossier.stats : [];
      rawNpcs = (dossier && Array.isArray(dossier.npcs)) ? dossier.npcs : [];
      rawCharStats = (dossier && Array.isArray(dossier.charStats)) ? dossier.charStats : [];
      rawMissions = (dossier && Array.isArray(dossier.clearConditions)) ? dossier.clearConditions : [];
      // 本副本已选高危角色 ID（兼容旧版单值 hazardCharId 与新版数组 hazardCharIds）
      if (dossier && Array.isArray(dossier.hazardCharIds) && dossier.hazardCharIds.length > 0) {
        rawHazardIds = dossier.hazardCharIds.slice();
      } else if (dossier && dossier.hazardCharId) {
        rawHazardIds = [dossier.hazardCharId];
      }
      // 原始高危 id 快照：去重、只留非空字符串。世界书角色绑定按 id 匹配，
      // 不受下方「同调档案查得到名字」过滤影响（档案缺名字也应参与绑定判定）。
      currentForkHazardIds = rawHazardIds
        .filter((id) => typeof id === 'string' && id)
        .filter((id, i, arr) => arr.indexOf(id) === i);
      // 开场场景舞台：整个对象快照，读不到就留 null，拼接时按缺省逻辑补
      currentForkOpeningScene = (dossier && dossier.openingScene && typeof dossier.openingScene === 'object')
        ? dossier.openingScene
        : null;
    } catch (err) {
      console.warn('[ForkRun] 卷宗数值设定读取失败：', currentForkId, err);
      return;
    }

    currentForkStats = rawStats
      // 没起名的数值项是作者加了没填的空壳，不该占状态栏的位
      .filter((st) => st && trimStr(st.name))
      .map((st) => {
        // 手填走 input 存的是字符串，导入的 JSON 卷宗可能直接是数字，两种都要接得住
        const readNum = (v) => {
          if (typeof v === 'number' && Number.isFinite(v)) return String(v);
          return trimStr(v);
        };
        const max = readNum(st.max) !== '' ? readNum(st.max) : '100';
        const min = readNum(st.min) !== '' ? readNum(st.min) : '0';
        const init = readNum(st.init) !== '' ? readNum(st.init) : max;
        return { name: trimStr(st.name), init, min, max };
      });

    // NPC 快照：只留有 id 和姓名的（没起名的空壳不进开场）。
    // NPC 立绘直接存在卷宗 npc.avatar（dataURL / URL 字符串），不走资产库，故一并带上。
    currentForkNpcs = rawNpcs
      .filter((n) => n && trimStr(n.id) && trimStr(n.name))
      .map((n) => ({ id: trimStr(n.id), name: trimStr(n.name), avatar: trimStr(n.avatar) }));

    // 角色数值模板快照：整形 metrics、charIds 与 npcIds，供开场反查某 NPC / 高危角色绑了哪套数值
    currentForkCharStats = rawCharStats
      .filter((tpl) => tpl && Array.isArray(tpl.metrics) && tpl.metrics.length > 0)
      .map((tpl) => {
        const readNum = (v) => {
          if (typeof v === 'number' && Number.isFinite(v)) return String(v);
          return trimStr(v);
        };
        const metrics = tpl.metrics
          .filter((m) => m && trimStr(m.name))
          .map((m) => {
            const max = readNum(m.max) !== '' ? readNum(m.max) : '100';
            const min = readNum(m.min) !== '' ? readNum(m.min) : '0';
            const init = readNum(m.init) !== '' ? readNum(m.init) : max;
            return { name: trimStr(m.name), init, min, max };
          });
        const charIds = Array.isArray(tpl.charIds)
          ? tpl.charIds.filter((id) => typeof id === 'string' && id)
          : [];
        const npcIds = Array.isArray(tpl.npcIds)
          ? tpl.npcIds.filter((id) => typeof id === 'string' && id)
          : [];
        return { charIds, npcIds, metrics };
      })
      .filter((tpl) => tpl.metrics.length > 0);

    // 高危角色快照：本副本已选高危角色的名字在同调档案 Store.roster 里（不像 NPC 名字在卷宗内）。
    // 只留本副本确实选了、且在档案中查得到的角色，供开场反查其专属数值。
    if (rawHazardIds.length > 0 && window.Store && Store.roster) {
      const pools = []
        .concat(Array.isArray(Store.roster.characters) ? Store.roster.characters : [])
        .concat(Array.isArray(Store.roster.npcs) ? Store.roster.npcs : []);
      const rosterMap = new Map();
      pools.forEach((item) => {
        if (item && item.id) rosterMap.set(item.id, item);
      });
      const seen = new Set();
      currentForkHazardChars = rawHazardIds
        .filter((id) => typeof id === 'string' && id && !seen.has(id) && seen.add(id))
        .map((id) => {
          const found = rosterMap.get(id);
          return { id, name: trimStr(found && found.name) };
        })
        .filter((c) => c.name);
    }

    // 主线任务快照：取每项任务目标 goal（兼容老卷宗的 text 镜像），空的丢掉
    currentForkMissions = rawMissions
      .map((m) => ({ goal: trimStr(m && (m.goal || m.text)) }))
      .filter((m) => m.goal);
  }

  /* ================= 开关页 ================= */

  /**
   * 随行助手悬浮球的进出场控制。
   *
   * 推演页里已经有 DECK 随行助手舱（Pane 5），和那颗全站悬浮球是同一条对话。
   * 球若还浮在推演页上既冗余又会压住推演 UI，所以进场即收走、退场再复位。
   *
   * 复位必须尊重用户偏好：若执行员在助手设置里把随行中枢整个关了
   * （orbEnabled=false），退场时不能用 showOrb() 把它强行召回 —— showOrb 走
   * applyState(STATE.ORB) 不看启用态。所以退场按 isEnabled() 分流：开着才唤球，
   * 关着就维持隐身，与设置页的权威状态保持一致。
   *
   * 全程做存在性防护：SystemChatOrb 脚本可能尚未加载。
   */
  function hideAssistantOrb() {
    if (window.SystemChatOrb && typeof SystemChatOrb.hide === 'function') {
      try { SystemChatOrb.hide(); } catch (_) {}
    }
  }

  function restoreAssistantOrb() {
    if (!window.SystemChatOrb) return;
    try {
      const enabled = typeof SystemChatOrb.isEnabled === 'function'
        ? SystemChatOrb.isEnabled() : true;
      if (enabled && typeof SystemChatOrb.showOrb === 'function') {
        SystemChatOrb.showOrb();
      } else if (!enabled && typeof SystemChatOrb.hide === 'function') {
        SystemChatOrb.hide();
      }
    } catch (_) {}
  }

  /**
   * 打开推演界面。
   *
   * @param {string} forkId 副本卷宗 id
   * @param {Object} [opts]
   * @param {string} [opts.runId] 指定存档；不传则续最近的 active 线，没有就新建
   * @param {boolean} [opts.readonly] 强制只读（历史回看时由调用侧传）
   */
  async function open(forkId, opts) {
    if (!inited) init();
    if (!pageEl) return false;
    const fid = trimStr(forkId);
    if (!fid) return false;
    currentForkId = fid;

    // 视界壁纸：按副本恢复（同副本所有世界线通用）。放在亮页前注入，避免闪底。
    if (window.ForkRunWallpaper && typeof ForkRunWallpaper.restore === 'function') {
      ForkRunWallpaper.restore(fid);
    }


    // 先同步亮页 + 压栈，再做异步读盘：
    // 与 fork-doc / fork-ready 对齐，避免 await 之后才 pushState 与上一页 popstate 抢跑，
    // 那会导致这次返回把新压的记录一起弹掉，直接退回桌面。
    const isInstant = !!(opts && (opts.instant || opts.noSlide));
    if (isInstant) {
      pageEl.classList.add('is-instant-backdrop');
    }

    // 随行助手悬浮球让位给 DECK 助手舱：球态 / 小窗 / 全屏态都一并收走。
    // 必须在 body.page-active 落笔之前调 —— applyState(HIDDEN) 内部会
    // remove('page-active')（那是它自己的收尾口径），放在亮页之后会把推演页
    // 刚加上的 page-active 一起抹掉，导致桌面景深退避当场失效。
    hideAssistantOrb();

    pageEl.hidden = false;
    pageEl.setAttribute('aria-hidden', 'false');
    void pageEl.offsetWidth;
    pageEl.classList.add('active');
    document.body.classList.add('page-active');
    isOpened = true;

    if (isInstant) {
      requestAnimationFrame(() => {
        // 下一帧即可移除强制覆盖类，恢复后续右滑返回等正常交互能力
        pageEl.classList.remove('is-instant-backdrop');
      });
    }

    if (window.location.hash !== '#fork-run') {
      try {
        window.history.pushState({ rfPage: 'fork-run' }, '', '#fork-run');
      } catch (_) {}
    }

    // 卷宗只读不写：推演永不改写卷宗定义
    const baseEntry = findForkEntry(fid) || { id: fid };
    let fullDossier = null;
    if (window.Store && typeof Store.loadForkDossier === 'function') {
      try {
        fullDossier = await Store.loadForkDossier(fid);
      } catch (err) {
        console.warn('[ForkRun] 完整卷宗加载失败：', fid, err);
      }
    }
    // 合并轻量索引与完整卷宗，确保 lockedRoles / identityType 全量就绪
    currentFork = Object.assign({}, baseEntry, fullDossier || {});

    const run = await resolveRun(fid, opts && opts.runId, opts);
    if (!run) {
      toast('DIVE // 接入失败', '无法建立下潜存档', '存储层未就绪或写入被拒绝', 'error');
      // 页面已亮且历史桩已压，接入失败时收起并消费桩，退回上一级
      close();
      return false;
    }
    currentRun = run;
    currentRunId = run.id;

    // 记录全局当前活跃下潜引用，供桌面一键秒回现场
    if (run.status === 'active' && window.ForkRunStore && typeof ForkRunStore.setOngoingActiveRef === 'function') {
      ForkRunStore.setOngoingActiveRef(fid, run.id).catch(() => {});
    }

    // 准备页手选的开场套：写进这条线的存档，后续续线、切回来都认这套。
    // 只在显式带了 openingId 且与存档不同时才写，避免每次进本都多一次无谓落盘。
    const wantOpeningId = trimStr(opts && opts.openingId);
    if (wantOpeningId && currentRun.openingId !== wantOpeningId
      && window.ForkRunStore && typeof ForkRunStore.updateRun === 'function') {
      currentRun.openingId = wantOpeningId;
      try {
        await ForkRunStore.updateRun(currentRunId, { openingId: wantOpeningId });
      } catch (err) {
        console.warn('[ForkRun] 开场选择写入失败：', currentRunId, err);
      }
    }

    await loadEnvoyAvatar();
    // 数值设定必须在渲染流水之前就位，否则首屏状态卡会拿不到数值
    await loadForkStats();

    const forceReadonly = !!(opts && opts.readonly);
    applyReadonly(forceReadonly || run.status !== 'active', run.status);
    syncHeader();

    await renderRunRecords();
    syncFooterSpace();
    updateJumpDeckVisibility();
    return true;
  }

  /** 从副本库轻量索引里取卷宗展示信息（标题与编号），读不到不阻塞开页 */
  function findForkEntry(forkId) {
    if (!window.Store || !Store.fork || !Array.isArray(Store.fork.index)) return null;
    return Store.fork.index.find((it) => it && it.id === forkId) || null;
  }

  /**
   * 决定这次进的是哪条线。
   *
   * 指定了 runId 就读那条（历史回看）；否则续最近一条 active 的，
   * 一条都没有才新建。「进入副本」不该每次都开新档 —— 那会让用户
   * 点错一次就多出一条废线。开新档由下潜记录页显式发起。
   */
  async function resolveRun(forkId, wantRunId, opts) {
    if (!window.ForkRunStore) return null;

    // 显式指定（切换世界线 / 历史回看）：读那条，并记为当前活跃线
    const rid = trimStr(wantRunId);
    if (rid) {
      const hit = await ForkRunStore.getRun(rid);
      if (hit) {
        try { await ForkRunStore.setActiveRun(forkId, hit.id); } catch (_) { /* 记忆失败不阻塞进本 */ }
        return hit;
      }
    }

    try {
      const runs = await ForkRunStore.listRuns(forkId);

      // 上次活跃线优先：进本默认续用户上次退出前在跑的那条
      let target = null;
      const index = await ForkRunStore.getIndex(forkId);
      if (index && index.activeRunId) {
        target = runs.find((r) => r && r.id === index.activeRunId) || null;
      }
      // 老档没有 activeRunId 指针时，回落到最近一条 active
      if (!target) {
        target = runs.find((r) => r && r.status === 'active') || null;
      }

      if (target) {
        // 如果本次下潜显式携带了身份信息，且与目标存档不同，即时同步覆盖
        const optIdentity = opts && opts.identity ? opts.identity : null;
        const newType = trimStr(opts && opts.identityType)
          || trimStr(optIdentity && optIdentity.type);
        const newId = trimStr(opts && opts.identityId)
          || trimStr(optIdentity && optIdentity.id);

        if (newType && (target.identityType !== newType || String(target.identityId || '') !== String(newId || ''))) {
          try {
            const updated = await ForkRunStore.updateRun(target.id, {
              identityType: newType,
              identityId: newId,
              maskId: newType === 'mask' ? newId : ''
            });
            if (updated) target = updated;
          } catch (syncErr) {
            console.warn('[ForkRun] 同步更新存档身份失败：', syncErr);
          }
        }
        // 续用的这条即为当前活跃线，记住它
        try { await ForkRunStore.setActiveRun(forkId, target.id); } catch (_) { /* ignore */ }
        return target;
      }
    } catch (err) {
      console.warn('[ForkRun] 存档列表读取失败：', forkId, err);
    }

    // 一条线都没有才新建（createRun 内部会把新线设为 activeRunId）
    return await ForkRunStore.createRun(forkId, {
      identity: opts && opts.identity,
      identityType: opts && opts.identity && opts.identity.type,
      identityId: opts && opts.identity && opts.identity.id
    });
  }

  /**
   * 关闭推演界面，回到副本库
   * @param {boolean} fromPopState 为 true 时由手势返回触发，历史桩已被浏览器弹掉，不再重复消费
   */
  function close(fromPopState = false) {
    if (!pageEl) return;
    if (!isOpened) return;
    isOpened = false;
    // 在途推演随退场一并掐掉：留着它跑完会往已移除的 DOM 上写字
    if (currentInference) abortInference();
    // 在途识图同理。退场不做回滚（页面已经不在了，退回输入台没有意义），
    // 只掐请求并清句柄：行动卡与图都已落库，重进这条线仍然看得到。
    if (currentVision) {
      currentVision.aborted = true;
      if (currentVision.controller) {
        try { currentVision.controller.abort(); } catch (_) {}
      }
      currentVision = null;
      setSendButtonState(false);
    }
    closeForkLightbox();
    exitBatchMode();
    closeActiveHud();
    toggleDockPanel(false);
    releaseEnvoyAvatar();
    // 视界壁纸：退出释放运行时 objectURL 并清空壁纸层，避免残留串到下一个副本
    if (window.ForkRunWallpaper && typeof ForkRunWallpaper.teardown === 'function') {
      ForkRunWallpaper.teardown();
    }
    // 数值快照按副本隔离，退出即清，避免下一个副本串到上一个的数值
    currentForkStats = [];

    pageEl.classList.remove('active');
    pageEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('page-active');
    if (textarea) textarea.blur();

    // 退场复位随行助手悬浮球（尊重执行员在助手设置里的启用偏好）
    restoreAssistantOrb();

    setTimeout(() => {
      if (!pageEl.classList.contains('active')) pageEl.hidden = true;
    }, 360);

    // 非手势触发（返回按钮）时消费掉历史桩，让系统返回栈与页面状态对齐
    if (!fromPopState && window.location.hash === '#fork-run') {
      try {
        window.history.back();
      } catch (_) {}
    }
  }

  /* ================= 初始化 ================= */

  function init() {
    pageEl = document.getElementById('forkRunPage');
    if (!pageEl) return;
    inited = true;

    bodyEl = document.getElementById('forkRunBody');
    streamEl = document.getElementById('forkRunStream');
    backBtn = document.getElementById('forkRunBackBtn');
    menuBtn = document.getElementById('forkRunMenuBtn');
    headerTitle = document.getElementById('forkRunHeaderTitle');
    headerMeta = document.getElementById('forkRunHeaderMeta');
    footerEl = document.getElementById('forkRunFooter');
    readonlyBar = document.getElementById('forkRunReadonlyBar');
    readonlyText = document.getElementById('forkRunReadonlyText');
    textarea = document.getElementById('forkRunTextarea');
    sendBtn = document.getElementById('forkRunSendBtn');
    inferBtn = document.getElementById('forkRunInferBtn');
    expandBtn = document.getElementById('forkRunExpandBtn');
    plusBtn = document.getElementById('forkRunPlusBtn');
    dockPanel = document.getElementById('forkRunDockPanel');
    turnCodeEl = document.getElementById('forkRunTurnCode');
    jumpDeck = document.getElementById('forkRunJumpDeck');
    jumpTopBtn = document.getElementById('forkRunJumpTopBtn');
    jumpBottomBtn = document.getElementById('forkRunJumpBottomBtn');

    // 多选批量操作组件初始化
    batchCancelBtn = document.getElementById('forkRunBatchCancelBtn');
    batchSelectAllBtn = document.getElementById('forkRunBatchSelectAllBtn');
    headerStatus = document.getElementById('forkRunHeaderStatus');
    batchDock = document.getElementById('forkRunBatchDock');
    batchDeleteBtn = document.getElementById('forkRunBatchDeleteBtn');
    batchDeleteCount = document.getElementById('forkRunBatchDeleteCount');
    batchExportBtn = document.getElementById('forkRunBatchExportBtn');
    batchExportCount = document.getElementById('forkRunBatchExportCount');

    if (batchCancelBtn) {
      batchCancelBtn.addEventListener('click', exitBatchMode);
    }

    if (batchSelectAllBtn) {
      batchSelectAllBtn.addEventListener('click', () => {
        if (!streamEl) return;
        const allRows = Array.from(streamEl.querySelectorAll(SELECTABLE_ROW_SELECTOR));
        const isAllSelected = allRows.length > 0 && selectedRows.size === allRows.length;

        allRows.forEach((row) => {
          if (isAllSelected) {
            selectedRows.delete(row);
            row.classList.remove('is-selected');
          } else {
            selectedRows.add(row);
            row.classList.add('is-selected');
          }
        });
        updateBatchCount();
      });
    }

    if (batchDeleteBtn) {
      batchDeleteBtn.addEventListener('click', async () => {
        if (isReadonly) return;
        if (currentInference) {
          toast('PURGE // 推演中', '当前正在推演', '请先等本轮结束或点击终止，再删除流水', 'info');
          return;
        }

        const count = selectedRows.size;
        if (count === 0) return;

        let confirmed = true;
        if (window.RetroModal && typeof RetroModal.confirm === 'function') {
          confirmed = await RetroModal.confirm({
            tag: `PURGE // 批量抹除 (${count})`,
            message: `确认要彻底抹除选中的 ${count} 条流水吗？`,
            detail: '选中的推演记录与行动卡将从本世界线中彻底移除，无法撤销。',
            confirmText: `删除 (${count})`,
            cancelText: '取消',
            danger: true
          });
        }
        if (!confirmed) return;

        const rowsToDelete = Array.from(selectedRows).filter(Boolean);
        const recordIds = rowsToDelete.map((r) => r && r.dataset && r.dataset.recordId).filter(Boolean);

        if (recordIds.length === 0) {
          rowsToDelete.forEach((r) => r.remove());
          exitBatchMode();
          return;
        }

        if (window.ForkRunStore && typeof ForkRunStore.deleteRunRecord === 'function') {
          let failCount = 0;
          for (const rid of recordIds) {
            try {
              const ok = await ForkRunStore.deleteRunRecord(currentRunId, rid);
              if (!ok) failCount++;
            } catch (_) {
              failCount++;
            }
          }
          if (failCount > 0 && window.RetroToast) {
            RetroToast.show({ tag: 'PURGE // PARTIAL', message: `有 ${failCount} 条记录删除失败`, type: 'warning' });
          }
        }

        // 重新渲染整线流水，保证因果链排版与状态卡同步更新
        exitBatchMode();
        await renderRunRecords();
        settleBottom(false);
      });
    }

    if (batchExportBtn) {
      batchExportBtn.addEventListener('click', async () => {
        const count = selectedRows.size;
        if (count === 0) return;

        const limit = (window.ChatShot && ChatShot.LIMIT) || 30;
        if (count > limit) {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'CAPTURE // OVERFLOW',
              message: `长图截图单次最多支持 ${limit} 条流水`,
              type: 'warning'
            });
          }
          return;
        }

        if (!window.ChatShot || typeof ChatShot.captureForkNovel !== 'function') {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'CAPTURE // ERROR',
              message: '截图引擎未就绪',
              type: 'error'
            });
          }
          return;
        }

        // 保持屏幕从上到下的阅读流水顺序
        const rows = Array.from(selectedRows).sort((a, b) => {
          if (!streamEl) return 0;
          const allChildren = Array.from(streamEl.children);
          return allChildren.indexOf(a) - allChildren.indexOf(b);
        });

        // 取当前副本标题与世界线展示名（避免显示底层长 ID）
        const forkTitle = (currentFork && (currentFork.title || currentFork.name)) || '副本推演';
        let branchLabel = trimStr(currentRun && (currentRun.label || currentRun.title || currentRun.name));
        if (!branchLabel) {
          if (window.ForkRunStore && typeof ForkRunStore.getRunDisplayLabel === 'function') {
            try {
              const allRuns = await ForkRunStore.listRuns(currentForkId);
              branchLabel = ForkRunStore.getRunDisplayLabel(currentRun, allRuns);
            } catch (_) {}
          }
        }
        if (!branchLabel) branchLabel = '分支 01';

        if (window.RetroToast) {
          RetroToast.show({
            tag: 'CAPTURE // GENERATING',
            message: '正在排版高清推演长图...',
            type: 'info'
          });
        }

        const res = await ChatShot.captureForkNovel({
          rows,
          meta: {
            forkTitle,
            branchLabel
          },
          fileLabel: `${forkTitle}_推演长图`
        });

        if (res && res.ok) {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'CAPTURE // SAVED',
              message: `推演长图已保存：${res.name || '推演纪要.png'}`,
              type: 'info'
            });
          }
          exitBatchMode();
        } else {
          if (window.RetroToast) {
            RetroToast.show({
              tag: 'CAPTURE // FAILED',
              message: '长图生成失败，请重试',
              type: 'warning'
            });
          }
        }
      });
    }

    if (backBtn) backBtn.addEventListener('click', () => close());
    if (menuBtn) {
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openSettings();
      });
    }

    // 系统手势返回 / 物理返回键：历史桩已被浏览器弹掉，收起推演页退回上一级
    window.addEventListener('popstate', (e) => {
      if (!isOpened) return;
      // 全屏文本编辑器叠在本页之上时（如 DECK 随行助手 / 行动编辑的全屏改写），
      // 它关闭时会自己 history.back() 退掉 #text-editor 桩，这次 popstate 归它处理。
      // 本页不响应，否则会连带把助手舱 / 看板等二级舱误关，多退一层弹回主控台。
      const editorOverlay = document.getElementById('textEditorOverlay');
      if (editorOverlay && !editorOverlay.hidden) return;
      // 随行助手舱处于批量多选态：返回先退批量态，舱与抽屉都不动。
      // 进批量态不压 history 桩，所以这次 popstate 消费的是 fork-run-deck 那层，
      // 退完补回一层，保证栈层数守恒（下次返回收的仍是助手舱 / 抽屉）。
      if (isAsstPaneOpen && window.ForkDeckAsst
          && typeof ForkDeckAsst.isBatchMode === 'function' && ForkDeckAsst.isBatchMode()) {
        try { ForkDeckAsst.exitBatchMode(); } catch (_) {}
        try {
          window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // 抽屉内随行助手舱开着：优先滑回控制台主舱，同时保持抽屉开启。
      // 与任务看板同范式 —— 补回一层 fork-run-deck 桩，使下次返回收的是抽屉本体。
      if (isAsstPaneOpen) {
        closeAsstPane();
        try {
          window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // 抽屉内任务看板开着：优先滑回控制台主舱，同时保持抽屉开启
      if (isMissionBoardOpen) {
        closeMissionBoard();
        try {
          window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // 抽屉内身份编纂舱开着：优先滑回控制台主舱（比态势舱更靠上），同时保持抽屉开启
      if (isIdentityEditOpen) {
        closeIdentityEdit(true);
        try {
          window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // 抽屉内二级态势舱开着：优先滑回控制台主舱，同时保持抽屉开启
      if (isResDashOpen) {
        closeResDashboard(true);
        try {
          window.history.pushState({ rfPage: 'fork-run-deck' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // 战术控制台抽屉开着：系统返回 / 物理返回键已经弹掉了抽屉那层 fork-run-deck 桩，
      // 栈顶自然落回推演页的 fork-run 层。所以这里只收抽屉视图、不再 back（传 true），
      // 也不补压 —— 补压会多出一层 fork-run，导致关抽屉后第一次返回被 hash 白名单吞掉、
      // 用户要按两次才退得出推演页。这也是二级舱（它们要保留抽屉、故补回 fork-run-deck）
      // 与本层（关整个抽屉、无需补层）的本质差异，之前本层漏传 true 又多补一层正是症结。
      if (isDeckDrawerOpen()) {
        closeDeckDrawer(true);
        return;
      }
      // 推演设置页开着：这次返回属于设置页，交给它自己关闭，推演页保持不动，
      // 否则会连推演页一起弹掉直接退回桌面。
      if (window.ForkRunSettingsUI && typeof ForkRunSettingsUI.isOpen === 'function'
        && ForkRunSettingsUI.isOpen()) {
        return;
      }
      // 双保险：返回后 hash 仍停在推演相关的任一子层（推演页本身 / 推演设置页 /
      // 从推演设置跳出去的世界书页），说明弹掉的是更上层的桩，推演页垫底不该关闭；
      // 只有 hash 真正离开这些层（回到桌面）时才收起推演页。
      // 注意：跳世界书时设置页被 dismiss（isOpen=false），第一道守卫会失效，
      // 因此这里必须把 #fork-run/settings 与 #worldbook 一并纳入白名单，
      // 否则从世界书返回的那次 popstate 会误把推演页 close 掉，导致后续无法退回推演页。
      const _h = window.location.hash;
      if (_h === '#fork-run' || _h === '#fork-run/settings' || _h === '#worldbook') {
        return;
      }
      // 灯箱开着优先关灯箱，并补回历史桩，避免直接退出整个推演
      if (activeLightbox) {
        closeForkLightbox();
        try {
          window.history.pushState({ rfPage: 'fork-run' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      // HUD 浮层开着优先收 HUD，并补回历史桩
      if (activeHudEl) {
        closeActiveHud();
        try {
          window.history.pushState({ rfPage: 'fork-run' }, '', '#fork-run');
        } catch (_) {}
        return;
      }
      close(true);
    });

    // 点外部收 HUD
    document.addEventListener('click', (e) => {
      if (activeHudEl && !activeHudEl.contains(e.target)) {
        closeActiveHud();
      }
    });

    if (textarea) {
      textarea.addEventListener('input', autoResizeTextarea);
      // 移动端软键盘的回车是换行，提交只走按钮；桌面端给 Ctrl+Enter 快捷
      textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          submitAct();
        }
      });
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        // 推演/识图进行中：此时按钮是方块终止态，点击中断在途任务，不发送新行动
        if (sendBtn.classList.contains('is-generating')) {
          if (currentVision) {
            Promise.resolve(abortVision()).catch((err) => {
              console.warn('[ForkRun] 识图终止异常：', err);
            });
          } else {
            abortInference();
          }
          return;
        }
        Promise.resolve(submitAct()).catch((err) => {
          console.warn('[ForkRun] 提交行动异常：', err);
        });
      });
    }

    if (inferBtn) {
      // 点击唤起右侧战术控制台抽屉 (Tactical Deck Drawer)
      inferBtn.addEventListener('click', () => {
        openDeckDrawer();
      });
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        Promise.resolve(openExpandEditor()).catch(() => {});
      });
    }

    if (plusBtn) {
      plusBtn.addEventListener('click', () => toggleDockPanel());
    }

    if (dockPanel) {
      dockPanel.addEventListener('click', (e) => {
        const item = e.target.closest('[data-run-panel]');
        if (!item) return;
        const panelType = item.dataset.runPanel;
        if (panelType === 'image') {
          toggleDockPanel(false);
          selectForkImage().catch((err) => {
            toast('VISION // 失败', '图片选取失败', err.message || '无法打开图片选择器', 'warning');
          });
          return;
        }
        if (panelType === 'file') {
          selectForkFile();
          return;
        }
      });
    }

    if (bodyEl) {
      bodyEl.addEventListener('scroll', () => {
        closeActiveHud();
        updateJumpDeckVisibility();
      }, { passive: true });
    }
    if (jumpTopBtn) {
      jumpTopBtn.addEventListener('click', () => {
        if (bodyEl) bodyEl.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    if (jumpBottomBtn) {
      jumpBottomBtn.addEventListener('click', () => settleBottom(false));
    }

    window.addEventListener('resize', () => {
      if (!pageEl.classList.contains('active')) return;
      syncFooterSpace();
      followBottomIfNear();
    });
  }

  const api = {
    open,
    close,
    init,
    // 从 DECK 助手舱跳对话设置页（收抽屉 + 栈协调 + 开设置页），返回自然回落推演页。
    openAsstSettings,
    // 只收起推演页视图、不触碰 history / isOpened，供跨页跳转（进 API 页）时
    // 避免推演页（同为 z-index:900 全屏页且 DOM 靠后）盖住 API 设置页。
    dismiss: () => {
      if (!pageEl) return;
      pageEl.classList.remove('active');
      pageEl.setAttribute('aria-hidden', 'true');
      document.body.classList.remove('page-active');
      setTimeout(() => {
        if (!pageEl.classList.contains('active')) pageEl.hidden = true;
      }, 360);
    },
    // 从 API 页返回时把推演页重新叠回底层（不动 history）
    reveal: () => {
      if (!pageEl) return;
      pageEl.hidden = false;
      pageEl.setAttribute('aria-hidden', 'false');
      void pageEl.offsetWidth;
      pageEl.classList.add('active');
      document.body.classList.add('page-active');
    },
    isOpen: () => isOpened,
    // 渲染器对外开放：结算摘要、系统提示这类插入以后要从外部调
    appendNarration,
    appendAct,
    getRunId: () => currentRunId,
    getForkId: () => currentForkId,
    isReadonly: () => isReadonly,
    // 会话级世界书覆写变更：设置页现场开关落库后调此入口，把黑名单同步回内存 currentRun，
    // 否则推演页仍持旧快照，buildWbOverrides 读到空，关掉的条目仍会被注入。
    syncWorldbookOverrides: (next) => {
      if (!currentRun) return;
      const ov = (next && typeof next === 'object') ? next : {};
      currentRun.worldbookOverrides = {
        disabledBookIds: Array.isArray(ov.disabledBookIds) ? ov.disabledBookIds.slice() : [],
        disabledEntryIds: Array.isArray(ov.disabledEntryIds) ? ov.disabledEntryIds.slice() : []
      };
    },
    // 按流水 ID 定位到对应记录行：滚动居中并短暂高亮。供通用检索页命中跳转使用。
    locateRecord: (recordId) => {
      if (!streamEl || !recordId) return false;
      const safeId = String(recordId).replace(/"/g, '\\"');
      const row = streamEl.querySelector(`[data-record-id="${safeId}"]`);
      if (!row) {
        if (window.RetroToast) {
          RetroToast.show({ tag: 'SEARCH // 定位失败', message: '这条记录已不在当前世界线中', type: 'warning' });
        }
        return false;
      }
      row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      row.classList.remove('is-search-located');
      void row.offsetWidth;
      row.classList.add('is-search-located');
      setTimeout(() => row.classList.remove('is-search-located'), 1800);
      return true;
    },
    // 「组件默认展开」开关切换后：批量刷新当前推演流已渲染的 4 类状态卡折叠态。
    // 思考过程组件（.fork-run-think-fold）不受影响，始终保持收起。
    applyComponentExpandState: (expand) => {
      if (!streamEl) return;
      const shouldExpand = expand !== false;
      const wraps = streamEl.querySelectorAll(
        '.fork-run-vitals-fold-wrap, .fork-run-allies-fold-wrap, .fork-run-npc-hub-wrap, .fork-run-mission-fold-wrap'
      );
      wraps.forEach((wrap) => {
        wrap.classList.toggle('is-expanded', shouldExpand);
        // 同步无障碍属性与 NPC 头像激活态
        const triggers = wrap.querySelectorAll('[aria-expanded]');
        triggers.forEach((t) => t.setAttribute('aria-expanded', shouldExpand ? 'true' : 'false'));
        if (wrap.classList.contains('fork-run-npc-hub-wrap')) {
          const avatars = wrap.querySelectorAll('.fork-run-npc-avatar-btn');
          avatars.forEach((a, i) => a.classList.toggle('is-active', shouldExpand && i === 0));
        }
      });
    },
    // 设置页改了分支名后回调：重读当前 run 的 label 再刷顶栏标题
    refreshHeader: async () => {
      if (currentRunId && window.ForkRunStore && typeof ForkRunStore.getRun === 'function') {
        try {
          const fresh = await ForkRunStore.getRun(currentRunId);
          if (fresh && currentRun && fresh.id === currentRun.id) {
            currentRun.label = fresh.label;
          }
        } catch (_) { /* 读失败就用内存里的旧值刷 */ }
      }
      syncHeader();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return api;
})();
