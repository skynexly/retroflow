/**
 * ============================================================================
 * 溯流计划 · DECK 系统相机模块 (ForkDeckCamera)
 * 职责：
 *   · DECK 抽屉第 6 舱 (Pane 6) 的界面生命周期与多 Pane 滑轨切换。
 *   · 提取副本推演当前现场场景（剧情/姿态/着装）作为生图基准。
 *   · 画幅比例选择 (1:1 / 3:4 / 9:16 / 16:9)。
 *   · 出镜角色锁脸勾选 (执行员与在场 NPC)。
 *   · 按下快门触发二次确认冲洗显影卡片。
 *   · 个人快照相册浏览、拍立得大图/详情弹窗与删除。
 * 规范：
 *   · 严格零 Emoji，全纯矢量 SVG。
 *   · 零分割线，纯机能色阶与卡片间距分层。
 *   · iOS 灵动岛保护在顶部由 DECK 外层/顶栏统一提供。
 * ============================================================================
 */
(function(global) {
  'use strict';

  // 相册本地存储 Key
  const ALBUM_STORAGE_KEY = 'retroflow_system_camera_album_v1';
  // 草稿本地存储 Key
  const DRAFT_STORAGE_KEY = 'retroflow_system_camera_draft_v1';

  // 默认画幅
  const DEFAULT_RATIO = '1:1';
  const DEFAULT_SIZE = '1024x1024';

  let inited = false;
  let isOpen = false;
  let activeTab = 'shoot'; // 'shoot' | 'album'

  // 当前选中的参数
  let currentRatio = DEFAULT_RATIO;
  let currentSize = DEFAULT_SIZE;
  let selectedCastIds = new Set(['envoy']); // 默认勾选执行员自己

  // DOM 引用
  let paneEl = null;
  let sceneInputEl = null;
  let ratioGroupEl = null;
  let castListEl = null;
  let shutterBtnEl = null;
  let resetBtnEl = null;
  let toAlbumBtnEl = null;
  let tabShootBtnEl = null;
  let tabAlbumBtnEl = null;
  let shootViewEl = null;
  let albumViewEl = null;
  let albumGridEl = null;
  let albumEmptyEl = null;
  let albumCountBadgeEl = null;
  let backBtnEl = null;
  let aiRefineBtnEl = null;

  // 确认浮层 DOM
  let confirmOverlayEl = null;
  let confirmSheetEl = null;
  let confirmRatioValEl = null;
  let confirmCastValEl = null;
  let confirmPromptTextEl = null;
  let confirmCancelBtnEl = null;
  let confirmProceedBtnEl = null;

  // 总结画面指导浮层 DOM
  let refineOverlayEl = null;
  let refineSheetEl = null;
  let refineGuidanceInputEl = null;
  let refineCancelBtnEl = null;
  let refineProceedBtnEl = null;

  // 照片详情弹窗 DOM
  let photoModalEl = null;
  let photoModalBackdropEl = null;
  let photoModalCloseBtnEl = null;
  let modalImgWrapEl = null;
  let modalDescEl = null;
  let modalTimeEl = null;
  let modalLocEl = null;
  let modalDelBtnEl = null;
  let currentDetailPhotoId = null;

  // 缓存提取到的基准场景（用于草稿校验与重置）
  let baseExtractedScene = '';

  // 最近一次现场快照（scene/state/allies/npcs），供出镜锁脸列表复用，避免重复扫档
  let latestSceneSnap = null;

  // 出镜卡片正在使用的 FACE ID objectURL 列表，重建列表时统一释放，避免泄漏
  let activeCastFaceUrls = [];

  /**
   * 初始化 DOM 引用与事件绑定
   */
  function init() {
    if (inited) return;

    paneEl = document.getElementById('forkDeckCameraPane');
    if (!paneEl) return;

    backBtnEl = document.getElementById('forkDeckCameraBackBtn');
    tabShootBtnEl = document.getElementById('forkCamTabShootBtn');
    tabAlbumBtnEl = document.getElementById('forkCamTabAlbumBtn');
    albumCountBadgeEl = document.getElementById('forkCamAlbumCountBadge');

    shootViewEl = document.getElementById('forkCamShootView');
    albumViewEl = document.getElementById('forkCamAlbumView');
    albumGridEl = document.getElementById('forkCamAlbumGrid');
    albumEmptyEl = document.getElementById('forkCamAlbumEmpty');

    sceneInputEl = document.getElementById('forkCamSceneInput');
    aiRefineBtnEl = document.getElementById('forkCamAiRefineBtn');
    ratioGroupEl = document.getElementById('forkCamRatioGroup');
    castListEl = document.getElementById('forkCamCastList');

    shutterBtnEl = document.getElementById('forkCamShutterBtn');
    resetBtnEl = document.getElementById('forkCamResetBtn');
    toAlbumBtnEl = document.getElementById('forkCamToAlbumBtn');

    // 确认浮层
    confirmOverlayEl = document.getElementById('forkCamConfirmOverlay');
    confirmSheetEl = document.getElementById('forkCamConfirmSheet');
    confirmRatioValEl = document.getElementById('forkCamConfirmRatioVal');
    confirmCastValEl = document.getElementById('forkCamConfirmCastVal');
    confirmPromptTextEl = document.getElementById('forkCamConfirmPromptText');
    confirmCancelBtnEl = document.getElementById('forkCamConfirmCancelBtn');
    confirmProceedBtnEl = document.getElementById('forkCamConfirmProceedBtn');

    // 总结画面指导浮层
    refineOverlayEl = document.getElementById('forkCamRefineOverlay');
    refineSheetEl = document.getElementById('forkCamRefineSheet');
    refineGuidanceInputEl = document.getElementById('forkCamGuidanceInput');
    refineCancelBtnEl = document.getElementById('forkCamRefineCancelBtn');
    refineProceedBtnEl = document.getElementById('forkCamRefineProceedBtn');

    // 照片详情
    photoModalEl = document.getElementById('forkCamPhotoModal');
    photoModalBackdropEl = document.getElementById('forkCamPhotoModalBackdrop');
    photoModalCloseBtnEl = document.getElementById('forkCamPhotoModalCloseBtn');
    modalImgWrapEl = document.getElementById('forkCamModalImgWrap');
    modalDescEl = document.getElementById('forkCamModalDesc');
    modalTimeEl = document.getElementById('forkCamModalTime');
    modalLocEl = document.getElementById('forkCamModalLoc');
    modalDelBtnEl = document.getElementById('forkCamModalDelBtn');

    // 绑定事件
    if (backBtnEl) backBtnEl.addEventListener('click', close);
    if (tabShootBtnEl) tabShootBtnEl.addEventListener('click', () => switchTab('shoot'));
    if (tabAlbumBtnEl) tabAlbumBtnEl.addEventListener('click', () => switchTab('album'));
    if (toAlbumBtnEl) toAlbumBtnEl.addEventListener('click', () => switchTab('album'));
    if (resetBtnEl) resetBtnEl.addEventListener('click', resetScene);
    if (shutterBtnEl) shutterBtnEl.addEventListener('click', onShutter);
    if (aiRefineBtnEl) aiRefineBtnEl.addEventListener('click', onAiRefine);

    // 画幅比例点击
    if (ratioGroupEl) {
      ratioGroupEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.fork-cam-ratio-pill');
        if (!btn) return;
        ratioGroupEl.querySelectorAll('.fork-cam-ratio-pill').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        currentRatio = btn.dataset.ratio || DEFAULT_RATIO;
        currentSize = btn.dataset.size || DEFAULT_SIZE;
      });
    }

    // 文本输入草稿保存
    if (sceneInputEl) {
      sceneInputEl.addEventListener('input', () => {
        saveDraft(sceneInputEl.value);
      });
    }

    // 确认浮层按钮
    if (confirmCancelBtnEl) confirmCancelBtnEl.addEventListener('click', closeConfirmSheet);
    if (confirmProceedBtnEl) confirmProceedBtnEl.addEventListener('click', onProceedDevelop);
    if (confirmOverlayEl) {
      confirmOverlayEl.addEventListener('click', (e) => {
        if (e.target === confirmOverlayEl) closeConfirmSheet();
      });
    }

    // 总结画面指导浮层按钮
    if (refineCancelBtnEl) refineCancelBtnEl.addEventListener('click', closeRefineSheet);
    if (refineProceedBtnEl) refineProceedBtnEl.addEventListener('click', onProceedRefine);
    if (refineOverlayEl) {
      refineOverlayEl.addEventListener('click', (e) => {
        if (e.target === refineOverlayEl) closeRefineSheet();
      });
    }

    // 照片详情弹窗关闭
    if (photoModalBackdropEl) photoModalBackdropEl.addEventListener('click', closePhotoDetail);
    if (photoModalCloseBtnEl) photoModalCloseBtnEl.addEventListener('click', closePhotoDetail);
    if (modalDelBtnEl) modalDelBtnEl.addEventListener('click', onDeleteCurrentPhoto);

    inited = true;
  }

  /**
   * 倒序扫描推演流水，抽取最近一份现场快照。
   * 与 DECK 状态栏同源：ForkRunStore.getRunRecords + ForkRunParser.parseRunReply。
   * scene / state 各自独立取最近一条有效值；allies / npcs 以最近一条
   * 「规整叙事轮」（带 state 或 scene 块）的申报为准——AI 每轮都会重新
   * 申报在场者，最近一轮没申报就视为不在场。
   * @returns {Promise<{scene:Object|null,state:Object|null,allies:Array,npcs:Array}>}
   */
  async function extractLatestSceneSnapshot() {
    const snap = { scene: null, state: null, allies: [], npcs: [] };
    try {
      if (!window.ForkRunStore || typeof ForkRunStore.getRunRecords !== 'function') return snap;
      if (!window.ForkRunParser || typeof ForkRunParser.parseRunReply !== 'function') return snap;

      let runId = '';
      if (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function') {
        const ctx = ForkRunUI.buildAsstSceneCtx();
        if (ctx && ctx.runId) runId = ctx.runId;
      }
      if (!runId) return snap;

      const recs = await ForkRunStore.getRunRecords(runId);
      if (!Array.isArray(recs) || recs.length === 0) return snap;

      let presenceLocked = false; // allies/npcs 只认最近一条规整叙事轮的申报
      for (let i = recs.length - 1; i >= 0; i--) {
        const r = recs[i];
        if (!r || typeof r !== 'object' || r.role === 'envoy') continue;

        // 变体分支：取当前激活版本的内容，保证与画面上屏的叙事一致
        let content = typeof r.content === 'string' ? r.content : '';
        if (Array.isArray(r.variants) && r.variants.length > 0) {
          const vIdx = (typeof r.activeVariantIndex === 'number' && r.activeVariantIndex >= 0 && r.activeVariantIndex < r.variants.length)
            ? r.activeVariantIndex
            : 0;
          const v = r.variants[vIdx];
          if (v && typeof v.content === 'string') content = v.content;
        }
        if (!content) continue;

        let parsed = null;
        try {
          parsed = ForkRunParser.parseRunReply(content);
        } catch (_) { continue; }
        if (!parsed) continue;

        if (!snap.scene && parsed.scene) snap.scene = parsed.scene;
        if (!snap.state && parsed.state && (parsed.state.attire || parsed.state.posture)) {
          snap.state = parsed.state;
        }
        if (!presenceLocked && (parsed.scene || parsed.state)) {
          snap.allies = Array.isArray(parsed.allies) ? parsed.allies : [];
          snap.npcs = Array.isArray(parsed.npcs) ? parsed.npcs : [];
          presenceLocked = true;
        }

        if (snap.scene && snap.state && presenceLocked) break;
      }
    } catch (err) {
      console.warn('[ForkDeckCamera] 抽取现场快照异常：', err);
    }
    return snap;
  }

  /**
   * 按姓名反查性别：副本 NPC 卷宗 → 同调档案池（含高危角色）。
   * 查不到返回空串（调用侧省略括号，不写"未知"）。
   * @param {string} name
   * @param {Object|null} fork 当前副本卷宗（buildAsstSceneCtx().fork）
   * @returns {string}
   */
  function resolveGenderByName(name, fork) {
    const nm = String(name || '').trim();
    if (!nm) return '';
    try {
      // 1. 副本专属 NPC：卷宗 npcs[]（与提示词引擎喂 AI 的性别同源）
      if (fork && Array.isArray(fork.npcs)) {
        const hit = fork.npcs.find((n) => n && String(n.name || '').trim() === nm);
        if (hit && hit.gender) return String(hit.gender).trim();
      }
      // 2. 同调档案池：characters + npcs（高危角色档案在 characters 里）
      if (window.Store && Store.roster) {
        const pools = []
          .concat(Array.isArray(Store.roster.characters) ? Store.roster.characters : [])
          .concat(Array.isArray(Store.roster.npcs) ? Store.roster.npcs : []);
        const hit = pools.find((c) => c && String(c.name || '').trim() === nm);
        if (hit && hit.gender) return String(hit.gender).trim();
      }
    } catch (_) {}
    return '';
  }

  /**
   * 拼「XX（性别）的外貌/着装/姿势」档案行，缺项跳过。
   * @param {Array<string>} lines
   * @param {string} name
   * @param {Object|null} profile { attire, posture }
   * @param {Object} [opts] { gender, appearance } 性别为空则不带括号；外貌为空则整行跳过
   */
  function pushProfileLines(lines, name, profile, opts) {
    if (!name) return;
    const o = opts || {};
    const display = o.gender ? `${name}（${o.gender}）` : name;
    if (o.appearance) lines.push(`${display}的外貌：${o.appearance}`);
    if (!profile) return;
    if (profile.attire) lines.push(`${display}的着装：${profile.attire}`);
    if (profile.posture) lines.push(`${display}的姿势：${profile.posture}`);
  }

  /**
   * 从推演流水合成当前现场文本（异步，需倒序扫存档）
   * 格式：
   *   场景：{地点} · {时间} · {天气} · {场景描述}
   *   {当前身份名}（{性别}）的外貌：...（仅本体/马甲填了外貌时）
   *   {当前身份名}（{性别}）的着装：...
   *   {当前身份名}（{性别}）的姿势：...
   *   {在场队友/NPC}（{性别}）的着装/姿势：...（性别按姓名反查卷宗/同调档案，查不到省略）
   */
  async function composeCurrentSceneText() {
    const lines = [];

    // 当前身份档案（本体/伪装/锁定角色），真相源与 DECK 身份舱一致：
    // name/gender/appearance 一次取齐；锁定角色无外貌字段，取出来是空串自动跳过
    let selfName = '执行员';
    let selfGender = '';
    let selfAppearance = '';
    let fork = null;
    try {
      if (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function') {
        const ctx = ForkRunUI.buildAsstSceneCtx();
        if (ctx) {
          fork = ctx.fork || null;
          if (ctx.envoyCtx) {
            if (ctx.envoyCtx.name) selfName = ctx.envoyCtx.name;
            if (ctx.envoyCtx.gender) selfGender = ctx.envoyCtx.gender;
            if (ctx.envoyCtx.appearance) selfAppearance = ctx.envoyCtx.appearance;
          }
        }
      }
    } catch (_) {}

    const snap = await extractLatestSceneSnapshot();
    latestSceneSnap = snap; // 缓存现场快照，供出镜锁脸列表复用

    // 1. 场景行：地点 · 时间 · 天气 · 场景描述，有哪段拼哪段
    if (snap.scene) {
      const segs = [];
      if (snap.scene.location) segs.push(snap.scene.location);
      const timeStr = snap.scene.timeHero || snap.scene.date;
      if (timeStr) segs.push(timeStr);
      if (snap.scene.weather) segs.push(snap.scene.weather);
      if (snap.scene.scene) segs.push(snap.scene.scene);
      if (segs.length > 0) lines.push(`场景：${segs.join(' · ')}`);
    }

    // 2. 执行员（当前身份）外貌、着装与姿势
    pushProfileLines(lines, selfName, snap.state, {
      gender: selfGender,
      appearance: selfAppearance
    });

    // 3. 在场队友（当前契约尚未产出 ally 块，逻辑预留）
    (snap.allies || []).forEach((ally) => {
      const nm = (ally && ally.name) || '同行者';
      pushProfileLines(lines, nm, ally, { gender: resolveGenderByName(nm, fork) });
    });

    // 4. 在场 NPC：性别按姓名反查卷宗/同调档案（高危角色档案写了性别就能查到）
    (snap.npcs || []).forEach((npc) => {
      const nm = (npc && npc.name) || '现场目标';
      pushProfileLines(lines, nm, npc, { gender: resolveGenderByName(nm, fork) });
    });

    // 兜底：结构化块全扫不到时，退回最近一条叙事气泡的尾段
    if (lines.length === 0) {
      const lastNarr = document.querySelector('.fork-run-bubble.is-narration:last-child .fork-narr-content');
      if (lastNarr && lastNarr.textContent) {
        const snippet = lastNarr.textContent.trim().slice(-140);
        if (snippet) lines.push(snippet);
      }
    }

    const res = lines.join('\n').trim();
    return res || '空旷的现场，等待因果定格...';
  }

  /**
   * 刷新出镜锁脸角色列表：只显示上传过 FACE ID 参考图的角色。
   *
   * 锁脸源真相（与个人档案/同调档案的上传口一致）：
   *   - 执行员本体 → DataRegistry.key.personaFaceId()
   *   - 马甲       → DataRegistry.key.maskFaceId(id)（envoyCtx 不带马甲 id，按姓名反查 Store.envoy.masks）
   *   - 锁定身份   → 无 FACE ID 锁脸源，不显示
   *   - 在场 NPC / 高危角色 → 姓名命中同调档案 characters 后探测 charFaceId(id)
   * 普通副本 NPC 与路人没有锁脸源，一律不进列表。
   *
   * 异步探测（getAssetSrc 返回 null 即未上传）。头像直接用 FACE ID 参考图，
   * objectURL 记入 activeCastFaceUrls，下次重建列表时统一释放。
   * 每张卡片把 faceRefKey 挂进 dataset，第二期生图接入时按选中项收集参考图。
   */
  async function refreshCastList() {
    if (!castListEl) return;

    const castList = [];
    const canAsset = !!(window.Storage && typeof Storage.getAssetSrc === 'function'
      && window.DataRegistry && DataRegistry.key);

    let ctx = null;
    try {
      if (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function') {
        ctx = ForkRunUI.buildAsstSceneCtx();
      }
    } catch (_) {}

    if (canAsset) {
      // 1. 执行员自己：按当前身份模式探测 FACE ID
      const ec = (ctx && ctx.envoyCtx) || null;
      if (ec) {
        let faceKey = '';
        let roleLabel = '执行员';
        if (ec.mode === 'persona') {
          faceKey = DataRegistry.key.personaFaceId();
        } else if (ec.mode === 'mask') {
          const masks = (window.Store && Store.envoy && Array.isArray(Store.envoy.masks)) ? Store.envoy.masks : [];
          const hit = masks.find((m) => m && String(m.name || '').trim() === String(ec.name || '').trim());
          if (hit && hit.id) faceKey = DataRegistry.key.maskFaceId(hit.id);
          roleLabel = '马甲';
        }
        // locked（锁定身份）没有 FACE ID 源，faceKey 保持空串自然跳过
        if (faceKey) {
          let src = null;
          try { src = await Storage.getAssetSrc(faceKey); } catch (_) { src = null; }
          if (src) {
            castList.push({
              id: 'envoy',
              name: ec.name || '执行员',
              role: roleLabel,
              gender: ec.gender || '',
              avatar: src,
              isSelf: true,
              faceRefKey: faceKey
            });
          }
        }
      }

      // 2. 在场 NPC / 高危角色：现场快照报名字 → 同调档案命中 → 探测 charFaceId
      let snap = latestSceneSnap;
      if (!snap) {
        snap = await extractLatestSceneSnapshot();
        latestSceneSnap = snap;
      }
      const rosterChars = (window.Store && Store.roster && Array.isArray(Store.roster.characters))
        ? Store.roster.characters : [];
      const present = []
        .concat(Array.isArray(snap.allies) ? snap.allies : [])
        .concat(Array.isArray(snap.npcs) ? snap.npcs : []);
      const seenNames = new Set();
      for (const p of present) {
        const nm = String((p && p.name) || '').trim();
        if (!nm || seenNames.has(nm)) continue;
        seenNames.add(nm);
        const hit = rosterChars.find((c) => c && String(c.name || '').trim() === nm);
        if (!hit || !hit.id) continue;
        const faceKey = DataRegistry.key.charFaceId(hit.id);
        let src = null;
        try { src = await Storage.getAssetSrc(faceKey); } catch (_) { src = null; }
        if (!src) continue;
        castList.push({
          id: 'char_' + hit.id,
          name: nm,
          role: '高危角色',
          gender: String(hit.gender || '').trim(),
          avatar: src,
          isSelf: false,
          faceRefKey: faceKey
        });
      }
    }

    // 释放上一批头像 objectURL（新一批已生成，旧的不再被引用）
    activeCastFaceUrls.forEach((u) => {
      try { Storage.revokeAssetSrc(u); } catch (_) {}
    });
    activeCastFaceUrls = castList.map((c) => c.avatar).filter((u) => typeof u === 'string' && u.startsWith('blob:'));

    // 勾选集合对齐：只保留仍在列表里的角色；执行员没锁脸时把默认勾选摘掉
    const validIds = new Set(castList.map((c) => c.id));
    selectedCastIds.forEach((id) => {
      if (!validIds.has(id)) selectedCastIds.delete(id);
    });

    // 渲染卡片
    castListEl.innerHTML = '';

    if (castList.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'fork-cam-cast-empty';
      empty.textContent = '当前现场无可锁脸角色';
      castListEl.appendChild(empty);
      return;
    }

    castList.forEach(c => {
      const chip = document.createElement('div');
      chip.className = `fork-cam-cast-chip ${selectedCastIds.has(c.id) ? 'is-selected' : ''}`;
      chip.dataset.castId = c.id;
      if (c.faceRefKey) chip.dataset.faceRefKey = c.faceRefKey;
      if (c.name) chip.dataset.castName = c.name;
      if (c.gender) chip.dataset.castGender = c.gender;

      chip.innerHTML = `
        <span class="fork-cam-cast-avatar"><img src="${c.avatar}" alt="${c.name}" /></span>
        <span class="fork-cam-cast-name">${c.name}</span>
        <span class="fork-cam-cast-role">${c.role}</span>
      `;

      chip.addEventListener('click', () => {
        if (selectedCastIds.has(c.id)) {
          selectedCastIds.delete(c.id);
          chip.classList.remove('is-selected');
        } else {
          selectedCastIds.add(c.id);
          chip.classList.add('is-selected');
        }
      });

      castListEl.appendChild(chip);
    });
  }

  /**
   * 保存草稿
   */
  function saveDraft(text) {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        text: text,
        baseScene: baseExtractedScene,
        updatedAt: Date.now()
      }));
    } catch (_) {}
  }

  /**
   * 重置回原生场景（抽取为异步扫档，先给占位再回填）
   */
  async function resetScene() {
    if (sceneInputEl) sceneInputEl.value = '正在重新扫描现场态势...';
    const fresh = await composeCurrentSceneText();
    baseExtractedScene = fresh;
    if (sceneInputEl) {
      sceneInputEl.value = baseExtractedScene;
    }
    saveDraft(baseExtractedScene);
    if (window.RetroToast) {
      RetroToast.show({ tag: 'CAMERA // RESET', message: '已重置为当前最新现场', type: 'info' });
    }
  }

  /**
   * 点击【总结画面】：弹出指导要求浮层
   */
  function onAiRefine() {
    if (!sceneInputEl) return;
    const raw = sceneInputEl.value.trim();
    if (!raw) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // EMPTY', message: '当前取景器内容为空', type: 'warning' });
      }
      return;
    }

    if (refineOverlayEl) {
      refineOverlayEl.hidden = false;
    }
    if (refineGuidanceInputEl) {
      refineGuidanceInputEl.focus();
    }
  }

  /**
   * 关闭总结画面浮层
   */
  function closeRefineSheet() {
    if (refineOverlayEl) {
      refineOverlayEl.hidden = true;
    }
  }

  /**
   * 取最近 N 轮副本主线叙事正文（剥掉 ::: 结构块），供画面总结注入上下文。
   * 倒序扫描，不足 N 条有多少拿多少；解析失败退回原始 content。
   * @param {number} count
   * @returns {Promise<string[]>} 按时间正序（旧→新）
   */
  async function fetchRecentNarrationBodies(count) {
    const out = [];
    try {
      if (!window.ForkRunStore || typeof ForkRunStore.getRunRecords !== 'function') return out;

      let runId = '';
      if (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function') {
        const ctx = ForkRunUI.buildAsstSceneCtx();
        if (ctx && ctx.runId) runId = ctx.runId;
      }
      if (!runId) return out;

      const recs = await ForkRunStore.getRunRecords(runId);
      if (!Array.isArray(recs) || recs.length === 0) return out;

      for (let i = recs.length - 1; i >= 0 && out.length < count; i--) {
        const r = recs[i];
        if (!r || typeof r !== 'object' || r.role === 'envoy') continue;

        // 变体分支：取当前激活版本，与画面上屏的叙事一致
        let content = typeof r.content === 'string' ? r.content : '';
        if (Array.isArray(r.variants) && r.variants.length > 0) {
          const vIdx = (typeof r.activeVariantIndex === 'number' && r.activeVariantIndex >= 0 && r.activeVariantIndex < r.variants.length)
            ? r.activeVariantIndex
            : 0;
          const v = r.variants[vIdx];
          if (v && typeof v.content === 'string') content = v.content;
        }
        if (!content.trim()) continue;

        // 剥结构块只留正文；解析器缺席或异常时退回原始内容
        let body = content;
        try {
          if (window.ForkRunParser && typeof ForkRunParser.parseRunReply === 'function') {
            const parsed = ForkRunParser.parseRunReply(content);
            if (parsed && parsed.body) body = parsed.body;
          }
        } catch (_) {}
        if (body.trim()) out.unshift(body.trim());
      }
    } catch (err) {
      console.warn('[ForkDeckCamera] 读取近期主线叙事失败：', err);
    }
    return out;
  }

  /**
   * 解析画面总结用的模型配置：辅助推理模型插槽，留空自动退回主模型节点。
   * @returns {{baseUrl:string,apiKey:string,modelId:string}|null}
   */
  function resolveRefineConfig() {
    try {
      if (window.RetroflowApiUI && typeof RetroflowApiUI.resolveSlot === 'function') {
        return RetroflowApiUI.resolveSlot('assistant');
      }
      // 兜底：API 页尚未初始化时直读 Store（与 system-chat-prompt 同款套路）
      if (window.Store && Store.config) {
        const slots = Store.config.apiSlots || {};
        if (slots.assistant && (slots.assistant.baseUrl || slots.assistant.modelId)) {
          return slots.assistant;
        }
        const nodes = Array.isArray(Store.config.apiNodes) ? Store.config.apiNodes : [];
        return nodes.find((n) => n && n.id === Store.config.apiActiveNodeId) || null;
      }
    } catch (_) {}
    return null;
  }

  /** 画面总结 System Prompt：视觉引擎人设 + 生图提示词硬性规则 */
  const REFINE_SYSTEM_PROMPT = `你是溯流计划战术终端内置的视觉定格引擎。你的任务：根据提供的近期剧情、现场态势与执行员的指导要求，生成一段用于 AI 生图的提示词。

硬性规则：
1. 只输出一段纯英文提示词本体，不要任何中文、解释、引号或 markdown 标记。
2. 画面中出现人物时，必须写明其性别（gender）、外貌特征（appearance）、着装（attire）与姿势（posture）——现场态势中已提供这些档案信息，如实翻译并织入描述，严禁凭空编造或遗漏性别。
3. 执行员的指导要求拥有最高优先级：视角、构图、光线、色调、氛围、特写重点等，逐条落实。
4. 以现场态势为画面事实基准（地点、时间、天气、人物状态），近期剧情仅用于补足氛围与情绪基调，不要引入画面中不存在的元素。
5. 提示词长度控制在 120 词以内：主体描述 + 环境光影 + 镜头语言（如 cinematic lighting, shallow depth of field, low angle shot）+ 画质修饰（如 highly detailed, masterpiece）自然融合，写成通顺的描述性短语流，不要机械堆砌。`;

  /**
   * 执行总结画面：辅助推理模型（留空退主模型）生成纯英文生图提示词，直接替换取景框内容
   */
  async function onProceedRefine() {
    if (!sceneInputEl) return;
    const raw = sceneInputEl.value.trim();
    const guidance = refineGuidanceInputEl ? refineGuidanceInputEl.value.trim() : '';

    closeRefineSheet();

    const config = resolveRefineConfig();
    if (!config || !config.baseUrl || !config.modelId) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'AI SCENE // 未配置', message: '请先在 API 设置中配置辅助推理模型或主模型', type: 'error' });
      }
      return;
    }
    if (!window.RetroflowAPI || typeof RetroflowAPI.chat !== 'function') {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'AI SCENE // 不可用', message: 'API 内核尚未加载', type: 'error' });
      }
      return;
    }

    if (aiRefineBtnEl) {
      aiRefineBtnEl.classList.add('is-refining');
    }

    try {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'AI SCENE // 总结', message: guidance ? `正在按指导【${guidance.slice(0, 10)}...】提炼画面...` : '正在提炼现场画面...', type: 'info' });
      }

      // ① 最近两轮副本主线（全文注入，不截尾）
      const narrations = await fetchRecentNarrationBodies(2);

      // ② 取景框当前内容 + ③ 用户指导要求，拼成单条 user 消息
      const userParts = [];
      if (narrations.length > 0) {
        userParts.push(`【近期剧情（最近${narrations.length}轮，旧→新）】\n${narrations.join('\n\n')}`);
      }
      userParts.push(`【现场态势】\n${raw}`);
      if (guidance) {
        userParts.push(`【执行员指导要求】\n${guidance}`);
      }

      const res = await RetroflowAPI.chat(config, [
        { role: 'system', content: REFINE_SYSTEM_PROMPT },
        { role: 'user', content: userParts.join('\n\n') }
      ], { timeout: 120000, logTag: '相机总结画面' });

      const refined = String((res && res.content) || '').trim();
      if (!refined) {
        throw new Error('模型返回为空');
      }

      // 直接替换取景框内容并存草稿，不满意可按重置找回最新现场
      sceneInputEl.value = refined;
      saveDraft(refined);

      if (window.RetroToast) {
        RetroToast.show({ tag: 'SCENE // 画面', message: '现场画面已总结完成', type: 'success' });
      }
    } catch (err) {
      console.warn('[ForkDeckCamera] 画面总结失败：', err);
      if (window.RetroToast) {
        RetroToast.show({ tag: 'AI SCENE // 失败', message: (err && err.message) ? `总结失败：${err.message}` : '画面总结失败，请检查算力链路', type: 'error' });
      }
    } finally {
      if (aiRefineBtnEl) {
        aiRefineBtnEl.classList.remove('is-refining');
      }
    }
  }

  /**
   * 点击快门：弹出二次确认显影浮层
   */
  function onShutter() {
    if (!sceneInputEl) return;
    const prompt = sceneInputEl.value.trim();
    if (!prompt) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // BLANK', message: '取景器尚未捕捉到场景画面', type: 'warning' });
      }
      return;
    }

    // 填充确认浮层数据
    if (confirmRatioValEl) confirmRatioValEl.textContent = `${currentRatio} (${currentSize})`;
    
    // 汇总出镜角色名字
    const castNames = [];
    if (castListEl) {
      castListEl.querySelectorAll('.fork-cam-cast-chip.is-selected .fork-cam-cast-name').forEach(el => {
        castNames.push(el.textContent);
      });
    }
    if (confirmCastValEl) {
      confirmCastValEl.textContent = castNames.length ? castNames.join('、') : '无（纯风景/环境）';
    }

    if (confirmPromptTextEl) {
      confirmPromptTextEl.textContent = prompt;
    }

    // 显示确认浮层
    if (confirmOverlayEl) {
      confirmOverlayEl.hidden = false;
    }
  }

  /**
   * 关闭二次确认浮层
   */
  function closeConfirmSheet() {
    if (confirmOverlayEl) {
      confirmOverlayEl.hidden = true;
    }
  }

  /**
   * 画幅 → 英文构图兜底提示（部分接口不认 size 参数，靠提示词纠正比例）
   */
  function ratioHintFor(ratio) {
    const r = String(ratio || '1:1');
    if (r === '1:1') return 'square 1:1 aspect ratio composition';
    const parts = r.split(':');
    const w = Number(parts[0]) || 1;
    const h = Number(parts[1]) || 1;
    return h > w
      ? `vertical portrait ${r} aspect ratio composition`
      : `wide horizontal ${r} aspect ratio composition`;
  }

  /** 性别中译英（生图提示词内部指令用），认不出就原样带上 */
  function genderToEnglish(g) {
    const s = String(g || '').trim();
    if (!s) return '';
    if (s.includes('男')) return 'male';
    if (s.includes('女')) return 'female';
    return s;
  }

  // 显影进行中标志：防连点快门重复生图
  let isDeveloping = false;

  /**
   * 收集勾选出镜角色的 FACE ID 参考图。
   * 卡片 dataset 上挂着 faceRefKey / castName / castGender（refreshCastList 写入），
   * 按卡片顺序逐张取图，返回 [{ name, gender, src }]。
   */
  async function collectFaceRefs() {
    const refs = [];
    if (!castListEl || !window.Storage || typeof Storage.getAssetSrc !== 'function') return refs;
    const chips = castListEl.querySelectorAll('.fork-cam-cast-chip.is-selected');
    for (const chip of chips) {
      const key = chip.dataset.faceRefKey;
      if (!key) continue;
      let src = null;
      try { src = await Storage.getAssetSrc(key); } catch (_) { src = null; }
      if (!src) continue;
      refs.push({
        name: chip.dataset.castName || '',
        gender: genderToEnglish(chip.dataset.castGender || ''),
        src
      });
    }
    return refs;
  }

  /**
   * 拼多参考图锁脸英文指令（只随 API 发出，不进用户可见提示词框）。
   * 逐张指认参考图是谁，再要求把每张脸原样织入画面；关掉 api-core 内置的单图 FACE_LOCK_HINT。
   */
  function buildFaceLockInstruction(faceRefs) {
    const idLines = faceRefs.map((r, i) => {
      const who = r.gender ? `${r.name || 'person'} (${r.gender})` : (r.name || 'person');
      return `Reference image ${i + 1} is ${who}.`;
    }).join(' ');
    return idLines + ' Keep each referenced person\'s facial features, hairstyle and overall likeness exactly as in their reference image, and render them into the scene described below. The angle, pose and expression may vary freely unless the description explicitly requests otherwise.';
  }

  /**
   * 确认拍摄：把取景框内容交给生图 API（有锁脸走图生图，无锁脸走纯文生图），
   * 成图归档进图库「图像生成 · 副本快照册」（以副本名成册），相机相册只存 galleryKey 轻量元数据。
   */
  async function onProceedDevelop() {
    closeConfirmSheet();
    if (isDeveloping) return;

    const prompt = sceneInputEl ? sceneInputEl.value.trim() : '';
    if (!prompt) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // BLANK', message: '取景器尚未捕捉到场景画面', type: 'warning' });
      }
      return;
    }

    // 生图插槽配置（imageGen 独立配置，不回退主模型）
    let cfg = null;
    try {
      if (window.SystemChatUI && typeof SystemChatUI.getImageSlotConfig === 'function') {
        cfg = SystemChatUI.getImageSlotConfig();
      }
    } catch (_) { cfg = null; }
    if (!cfg) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // 未配置', message: '请先在 API 设置中配置图像生成端点', type: 'error' });
      }
      return;
    }
    if (!window.RetroflowAPI || (typeof RetroflowAPI.generateImage !== 'function')) {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // 不可用', message: '生图内核尚未加载', type: 'error' });
      }
      return;
    }

    // 副本归属信息（图库成册 + 相册 location 快照）
    let forkId = '';
    let forkTitle = '溯流空间';
    try {
      if (window.ForkRunUI && typeof ForkRunUI.buildAsstSceneCtx === 'function') {
        const ctx = ForkRunUI.buildAsstSceneCtx();
        if (ctx && ctx.fork) {
          forkId = String(ctx.fork.id || '');
          forkTitle = String(ctx.fork.title || ctx.fork.name || forkTitle);
        }
      }
    } catch (_) {}

    isDeveloping = true;
    if (shutterBtnEl) shutterBtnEl.classList.add('is-developing');
    if (confirmProceedBtnEl) confirmProceedBtnEl.disabled = true;

    let faceRefs = [];
    try {
      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // 显影', message: '正在交给AI生成，请稍候...', type: 'info' });
      }

      faceRefs = await collectFaceRefs();
      const ratioHint = ratioHintFor(currentRatio);

      let res = null;
      if (faceRefs.length > 0 && typeof RetroflowAPI.generateImageEdit === 'function') {
        // 锁脸图生图：内部英文指令 + 取景框内容
        const instruction = buildFaceLockInstruction(faceRefs);
        res = await RetroflowAPI.generateImageEdit(cfg, faceRefs.map((r) => r.src), {
          prompt: `${instruction}\n\nScene description: ${prompt}`,
          size: currentSize,
          ratioHint,
          faceLock: false, // 多人指认指令已自带，关掉内置单图锁脸句
          logTag: '系统相机 · 锁脸生图'
        });
      } else {
        // 纯文生图：取景框内容直塞，不强制先总结
        res = await RetroflowAPI.generateImage(cfg, {
          prompt,
          size: currentSize,
          ratioHint,
          logTag: '系统相机 · 快照生图'
        });
      }
      if (!res || !res.image) throw new Error('服务端未返回图像');

      // 归档进图库：图像生成分类下按副本成册（副本名 = 相册名）
      let galleryKey = '';
      try {
        if (window.GalleryStore && typeof GalleryStore.record === 'function') {
          const entry = await GalleryStore.record(res.image, {
            source: 'fork-camera',
            category: 'image-gen',
            ownerType: 'fork',
            ownerId: forkId || 'fork-unknown',
            ownerName: forkTitle
          });
          if (entry && entry.key) galleryKey = entry.key;
        }
      } catch (err) {
        console.warn('[ForkDeckCamera] 快照归档图库失败：', err);
      }

      const photoId = 'photo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date().toLocaleDateString();

      // 相机相册条目：只存图库 assetKey 轻量元数据，base64 不进 localStorage（配额炸弹）
      const photoItem = {
        id: photoId,
        mode: 'shoot',
        prompt: prompt,
        ratio: currentRatio,
        size: (res && res.size) || currentSize,
        location: forkTitle,
        time: `${dateStr} ${timeStr}`,
        createdAt: Date.now(),
        galleryKey: galleryKey,
        imgUrl: ''
      };
      savePhotoToAlbum(photoItem);

      if (window.RetroToast) {
        RetroToast.show({ tag: 'CAMERA // SNAP', message: '快照已显影并定格入相册', type: 'success' });
      }

      // 自动切到相册 Tab 浏览最新卡片
      switchTab('album');
    } catch (err) {
      console.warn('[ForkDeckCamera] 显影失败：', err);
      if (window.RetroToast) {
        RetroToast.show({
          tag: 'CAMERA // 显影失败',
          message: (err && err.message) ? `生成失败：${err.message}` : '生成失败，请检查生图端点',
          type: 'error'
        });
      }
    } finally {
      // 参考图 objectURL 用完即还，避免泄漏
      faceRefs.forEach((r) => {
        try {
          if (r.src && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
            Storage.revokeAssetSrc(r.src);
          }
        } catch (_) {}
      });
      isDeveloping = false;
      if (shutterBtnEl) shutterBtnEl.classList.remove('is-developing');
      if (confirmProceedBtnEl) confirmProceedBtnEl.disabled = false;
    }
  }

  /**
   * 本地相册持久化读写
   */
  function loadAlbum() {
    try {
      const raw = localStorage.getItem(ALBUM_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function savePhotoToAlbum(photo) {
    const list = loadAlbum();
    list.unshift(photo);
    try {
      localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
    updateAlbumCountBadge();
  }

  function deletePhotoFromAlbum(id) {
    let list = loadAlbum();
    list = list.filter(p => p.id !== id);
    try {
      localStorage.setItem(ALBUM_STORAGE_KEY, JSON.stringify(list));
    } catch (_) {}
    updateAlbumCountBadge();
    renderAlbum();
  }

  function updateAlbumCountBadge() {
    const list = loadAlbum();
    if (albumCountBadgeEl) {
      if (list.length > 0) {
        albumCountBadgeEl.hidden = false;
        albumCountBadgeEl.textContent = list.length;
      } else {
        albumCountBadgeEl.hidden = true;
      }
    }
  }

  /**
   * 相册图片水合缓存：photoId -> objectURL（由 galleryKey 经 Storage.getAssetSrc 取出）。
   * localStorage 只存 galleryKey 轻量元数据，base64 大图一律放图库 IndexedDB，
   * 渲染时按需异步水合；每轮 renderAlbum 先释放上一轮缓存，防反复开关累积泄漏。
   */
  const albumUrlCache = new Map();
  let albumHydrateToken = 0;

  function releaseAlbumUrls() {
    albumUrlCache.forEach((src) => {
      try {
        if (src && window.Storage && typeof Storage.revokeAssetSrc === 'function') {
          Storage.revokeAssetSrc(src);
        }
      } catch (_) {}
    });
    albumUrlCache.clear();
  }

  /**
   * 异步水合一张相册图的 objectURL；成功后写入缓存并回调。
   * token 失效（期间发生了重渲染）则丢弃结果并立即释放，不上屏。
   */
  async function hydratePhotoUrl(photo, token, onReady) {
    if (!photo || !photo.galleryKey) return;
    if (albumUrlCache.has(photo.id)) {
      onReady(albumUrlCache.get(photo.id));
      return;
    }
    if (!window.Storage || typeof Storage.getAssetSrc !== 'function') return;
    let src = null;
    try { src = await Storage.getAssetSrc(photo.galleryKey); } catch (_) { src = null; }
    if (!src) return;
    if (token !== albumHydrateToken) {
      try { if (window.Storage && typeof Storage.revokeAssetSrc === 'function') Storage.revokeAssetSrc(src); } catch (_) {}
      return;
    }
    albumUrlCache.set(photo.id, src);
    onReady(src);
  }

  /**
   * 渲染相册网格
   */
  function renderAlbum() {
    if (!albumGridEl || !albumEmptyEl) return;

    // 新一轮渲染：作废上一轮水合任务并释放缓存 objectURL
    albumHydrateToken += 1;
    const token = albumHydrateToken;
    releaseAlbumUrls();

    const list = loadAlbum();

    if (list.length === 0) {
      albumGridEl.innerHTML = '';
      albumEmptyEl.hidden = false;
      return;
    }

    albumEmptyEl.hidden = true;
    albumGridEl.innerHTML = '';

    list.forEach(p => {
      const card = document.createElement('div');
      card.className = 'fork-cam-polaroid';
      card.dataset.id = p.id;

      // 先占位：文本快照直接显示提示词；图库快照显示"显影中"占位，水合完成后替换成图
      const frameEl = document.createElement('div');
      frameEl.className = 'fork-cam-polaroid-frame';
      frameEl.innerHTML = p.galleryKey
        ? `<div class="fork-cam-polaroid-text-content">显影中...</div>`
        : `<div class="fork-cam-polaroid-text-content">${escapeHtml(p.prompt)}</div>`;

      card.innerHTML = `
        <div class="fork-cam-polaroid-info">
          <div class="fork-cam-polaroid-loc">${escapeHtml(p.location || '现场快照')}</div>
          <div class="fork-cam-polaroid-time">${escapeHtml(p.time || '')}</div>
        </div>
      `;
      card.insertBefore(frameEl, card.firstChild);

      card.addEventListener('click', () => {
        openPhotoDetail(p);
      });

      albumGridEl.appendChild(card);

      // 异步水合：取到 objectURL 后替换占位内容（token 校验防跨轮上屏）
      if (p.galleryKey) {
        hydratePhotoUrl(p, token, (src) => {
          if (token !== albumHydrateToken || !card.isConnected) return;
          frameEl.innerHTML = `<img class="fork-cam-polaroid-img" src="${src}" alt="快照" />`;
        });
      }
    });
  }

  /**
   * 查看单张照片大卡详情
   */
  function openPhotoDetail(photo) {
    currentDetailPhotoId = photo.id;
    if (!photoModalEl) return;

    const renderModalBody = (src) => {
      if (!modalImgWrapEl) return;
      modalImgWrapEl.innerHTML = src
        ? `<img src="${src}" alt="大图" />`
        : `<div style="padding:24px;font-size:13px;line-height:1.7;color:rgba(255,255,255,0.85);max-height:36vh;overflow-y:auto;word-break:break-word;">${escapeHtml(photo.prompt)}</div>`;
    };

    // 网格水合过就直接复用缓存；没水合完则先占位提示词，取到后若弹窗还开着同一张再换图
    const cached = albumUrlCache.get(photo.id);
    if (cached) {
      renderModalBody(cached);
    } else if (photo.galleryKey) {
      renderModalBody(null);
      const token = albumHydrateToken;
      hydratePhotoUrl(photo, token, (src) => {
        if (currentDetailPhotoId === photo.id && token === albumHydrateToken) {
          renderModalBody(src);
        }
      });
    } else {
      renderModalBody(null);
    }

    if (modalDescEl) modalDescEl.textContent = photo.prompt;
    if (modalTimeEl) modalTimeEl.textContent = `${photo.time} · 画幅 ${photo.ratio || '1:1'}`;
    if (modalLocEl) modalLocEl.textContent = photo.location || '';

    photoModalEl.hidden = false;
  }

  function closePhotoDetail() {
    if (photoModalEl) {
      photoModalEl.hidden = true;
    }
    currentDetailPhotoId = null;
  }

  function onDeleteCurrentPhoto() {
    if (!currentDetailPhotoId) return;
    deletePhotoFromAlbum(currentDetailPhotoId);
    closePhotoDetail();
    if (window.RetroToast) {
      RetroToast.show({ tag: 'ALBUM // PURGE', message: '已彻底删除该张快照', type: 'info' });
    }
  }

  /**
   * 切换 Tab
   */
  function switchTab(tab) {
    activeTab = tab;
    if (tab === 'shoot') {
      if (tabShootBtnEl) tabShootBtnEl.classList.add('is-active');
      if (tabAlbumBtnEl) tabAlbumBtnEl.classList.remove('is-active');
      if (shootViewEl) shootViewEl.hidden = false;
      if (albumViewEl) albumViewEl.hidden = true;
    } else {
      if (tabShootBtnEl) tabShootBtnEl.classList.remove('is-active');
      if (tabAlbumBtnEl) tabAlbumBtnEl.classList.add('is-active');
      if (shootViewEl) shootViewEl.hidden = true;
      if (albumViewEl) albumViewEl.hidden = false;
      renderAlbum();
    }
  }

  /**
   * 打开系统相机舱 (Pane 6)
   */
  function open() {
    init();
    const drawerEl = document.getElementById('forkRunDeckDrawer');
    if (!drawerEl || !paneEl) return;

    // 清除其他 pane 专属激活态，加入 is-camera-mode
    drawerEl.classList.remove('is-res-mode', 'is-identity-mode', 'is-mission-mode', 'is-asst-mode');
    drawerEl.classList.add('is-camera-mode');
    isOpen = true;

    // 读取草稿；无草稿则异步扫描现场态势回填
    let draftText = '';
    try {
      const draftRaw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (draftRaw) {
        const d = JSON.parse(draftRaw);
        if (d && d.text) draftText = d.text;
      }
    } catch (_) {}

    // baseExtractedScene 始终取最新抽取结果（供草稿新旧校验与重置），有草稿则显示草稿
    const scanPromise = composeCurrentSceneText()
      .then((text) => {
        baseExtractedScene = text;
        // 抽取期间用户可能已手动输入，只在输入框仍是占位/空时才回填
        if (!draftText && sceneInputEl && (!sceneInputEl.value || sceneInputEl.value === '正在扫描现场态势...')) {
          sceneInputEl.value = text;
        }
        return text;
      })
      .catch((err) => {
        console.warn('[ForkDeckCamera] 现场态势扫描失败：', err);
        return '';
      });
    void scanPromise;

    if (sceneInputEl) {
      sceneInputEl.value = draftText || '正在扫描现场态势...';
    }

    // 刷新角色与角标
    refreshCastList();
    updateAlbumCountBadge();
    switchTab('shoot');
  }

  /**
   * 关闭系统相机舱，平滑回滑至 Pane 1 主控制台
   */
  function close() {
    const drawerEl = document.getElementById('forkRunDeckDrawer');
    if (drawerEl) {
      drawerEl.classList.remove('is-camera-mode');
    }
    isOpen = false;
    closeConfirmSheet();
    closePhotoDetail();
    // 关闭舱体：作废在途水合任务并释放相册 objectURL 缓存
    albumHydrateToken += 1;
    releaseAlbumUrls();
  }

  function isOpened() {
    return isOpen;
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  // 暴露公共接口
  global.ForkDeckCamera = {
    init,
    open,
    close,
    isOpened,
    switchTab
  };

})(window);
