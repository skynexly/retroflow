/**
 * 溯流计划 · API 设置界面控制器 (API UI Controller)
 * 三大视图：
 *   View A  apiListView      三大算力矩阵列表（右翼导轨切换：模型 / 功能 / 音画）
 *   View B  apiEditView      主模型节点编辑/新增（00 节点名称 + 01~03 + 测试）
 *   View C  apiSlotEditView  功能/音画插槽配置（00 从主模型中选择 + 01~03 + 测试）
 * 持久化：IndexedDB docs store，全部走 Store（config 域）
 */
(() => {
  /* ================= 数据层 ================= */

  // 插槽元信息：标题、所属维度、协议类型
  const SLOT_META = {
    system: { title: '系统助手模型', fallback: true, protocol: 'openai' },
    online: { title: '线上联络模型', fallback: true, protocol: 'openai' },
    assistant: { title: '辅助推理模型', fallback: true, protocol: 'openai' },
    vision: { title: '视觉识别模型', fallback: true, protocol: 'openai' },
    imageGen: { title: '图像生成', fallback: false, protocol: 'openai', emptyLabel: '未设置' },
    tts: { title: 'TTS 语音合成', fallback: false, protocol: 'minimax', emptyLabel: '未设置' }
  };

  function getActiveId() {
    return Store.config.apiActiveNodeId;
  }

  function setActiveId(id) {
    return Store.save('config.apiActiveNodeId', id || '');
  }

  function genId() {
    return 'node_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // 内存工作副本。数据由 Boot 装载，init() 时从 Store 同步过来。
  let nodes = [];
  let slots = {};

  /** 从 Store 内存副本刷新本模块的工作副本 */
  function syncFromStore() {
    nodes = (Store.config.apiNodes || []).slice();
    slots = Object.assign({}, Store.config.apiSlots);
  }

  function persistNodes() {
    return Store.save('config.apiNodes', nodes);
  }

  function persistSlots() {
    return Store.save('config.apiSlots', slots);
  }

  let editingId = null;   // 主模型节点编辑中的 id（null = 新增）
  let editingSlot = null; // 插槽编辑中的 key
  // 直达模式回调：从外部入口（如助理对话设置）直接跳进某个插槽表单时置位。
  // 此时模型列表页是无意义的中间层，返回动作应交回来源页而不是退到列表。
  // 必须在此声明：showListView 会读它，而那里的调用早于函数体所在位置。
  let slotDirectReturn = null;

  /* ================= DOM ================= */
  const listView = document.getElementById('apiListView');
  const editView = document.getElementById('apiEditView');
  const slotView = document.getElementById('apiSlotEditView');

  const nodeListEl = document.getElementById('apiNodeList');
  const addNodeBtn = document.getElementById('apiAddNodeHeaderBtn');
  const nodeSaveBtn = document.getElementById('apiNodeSaveBtn');
  const editBackBtn = document.querySelector('#apiEditView .node-edit-back-btn');

  // 主模型表单
  const aliasInput = document.getElementById('apiNodeAlias');
  const baseUrlInput = document.getElementById('apiBaseUrl');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKeyToggleBtn = document.getElementById('apiKeyToggleBtn');
  const modelIdInput = document.getElementById('apiModelId');
  const fetchModelsBtn = document.getElementById('apiFetchModelsBtn');
  const tempSlider = document.getElementById('apiTempSlider');
  const tempDisplay = document.getElementById('apiTempDisplay');
  const contextInput = document.getElementById('apiContextInput');
  const contextDisplay = document.getElementById('apiContextDisplay');
  const maxTokensInput = document.getElementById('apiMaxTokens');
  const testBtn = document.getElementById('apiTestBtn');
  const testResult = document.getElementById('apiTestResult');
  const testResultText = document.getElementById('apiTestResultText');
  const modelPool = document.getElementById('apiModelPool');
  const modelPoolList = document.getElementById('apiModelPoolList');
  const modelPoolCount = document.getElementById('apiModelPoolCount');
  const modelFilter = document.getElementById('apiModelFilter');

  // 插槽表单
  const slotBackBtn = document.querySelector('#apiSlotEditView .slot-edit-back-btn');
  const slotSaveBtn = document.getElementById('apiSlotSaveBtn');
  const slotEditTitle = document.getElementById('slotEditTitle');
  const slotEditSubLabel = document.getElementById('slotEditSubLabel');
  const slotImportCard = document.getElementById('slotImportCard');
  const slotImportTrigger = document.getElementById('slotImportTrigger');
  const slotImportLabel = document.getElementById('slotImportLabel');
  const slotLoadBtn = document.getElementById('slotLoadBtn');
  const slotClearBtn = document.getElementById('slotClearBtn');
  const slotCredCard = document.getElementById('slotCredCard');
  const slotBaseUrl = document.getElementById('slotBaseUrl');
  const slotKeyInput = document.getElementById('slotKeyInput');
  const slotKeyToggleBtn = document.getElementById('slotKeyToggleBtn');
  const slotModelCard = document.getElementById('slotModelCard');
  const slotModelCardTitle = document.getElementById('slotModelCardTitle');
  const slotModelId = document.getElementById('slotModelId');
  const slotModelHint = document.getElementById('slotModelHint');
  const slotFetchModelsBtn = document.getElementById('slotFetchModelsBtn');
  const slotVoiceGroup = document.getElementById('slotVoiceGroup');
  const slotVoiceId = document.getElementById('slotVoiceId');
  const slotGroupIdGroup = document.getElementById('slotGroupIdGroup');
  const slotGroupId = document.getElementById('slotGroupId');
  const slotTempSlider = document.getElementById('slotTempSlider');
  const slotTempDisplay = document.getElementById('slotTempDisplay');
  const slotContextInput = document.getElementById('slotContextInput');
  const slotContextDisplay = document.getElementById('slotContextDisplay');
  const slotMaxTokens = document.getElementById('slotMaxTokens');
  const slotParamCardInference = document.getElementById('slotParamCardInference');
  const slotParamCardImageGen = document.getElementById('slotParamCardImageGen');
  const slotImagePrompt = document.getElementById('slotImagePrompt');
  const slotImageNegPrompt = document.getElementById('slotImageNegPrompt');
  const slotParamCardTts = document.getElementById('slotParamCardTts');
  const slotSpeedSlider = document.getElementById('slotSpeedSlider');
  const slotSpeedDisplay = document.getElementById('slotSpeedDisplay');
  const slotPitchSlider = document.getElementById('slotPitchSlider');
  const slotPitchDisplay = document.getElementById('slotPitchDisplay');
  const slotTestBtn = document.getElementById('slotTestBtn');
  const slotTestBtnText = document.getElementById('slotTestBtnText');
  const slotTestResult = document.getElementById('slotTestResult');
  const slotTestResultText = document.getElementById('slotTestResultText');
  const slotImageStage = document.getElementById('slotImageStage');
  const slotImageStagePlaceholder = document.getElementById('slotImageStagePlaceholder');
  const slotStageImg = document.getElementById('slotStageImg');
  const slotModelPool = document.getElementById('slotModelPool');
  const slotModelPoolList = document.getElementById('slotModelPoolList');
  const slotModelPoolCount = document.getElementById('slotModelPoolCount');
  const slotModelFilter = document.getElementById('slotModelFilter');

  // 导轨
  const indexRail = document.getElementById('apiIndexRail');
  const bookmarks = indexRail ? indexRail.querySelectorAll('.index-bookmark') : [];

  const listPanes = {
    main: document.getElementById('paneListMain'),
    functional: document.getElementById('paneListFunctional'),
    multimedia: document.getElementById('paneListMultimedia')
  };

  const slotCards = document.querySelectorAll('.api-slot-card');

  const DEFAULT_TEMP = '0.70';
  const DEFAULT_CONTEXT = '200000';
  const DEFAULT_SPEED = '1.0';
  const DEFAULT_PITCH = '0';

  // MiniMax 现行端点与型号：旧域名 api.minimaxi.chat 已废弃，speech-01-turbo 为老型号
  const TTS_DEFAULT_URL = 'https://api.minimaxi.com/v1';
  const TTS_DEFAULT_MODEL = 'speech-2.8-hd';

  /* ================= 工具 ================= */
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  function shortHost(url) {
    if (!url) return '未设置端点';
    try {
      return new URL(url).host || url;
    } catch (err) {
      return url.replace(/^https?:\/\//, '').split('/')[0] || url;
    }
  }

  function bindEyeToggle(btn, input) {
    if (!btn || !input) return;
    const open = btn.querySelector('.eye-open-icon');
    const closed = btn.querySelector('.eye-closed-icon');
    btn.addEventListener('click', () => {
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      if (open && closed) {
        open.style.display = isPwd ? 'none' : 'block';
        closed.style.display = isPwd ? 'block' : 'none';
      }
    });
  }

  function resetEye(btn, input) {
    if (!btn || !input) return;
    input.type = 'password';
    const open = btn.querySelector('.eye-open-icon');
    const closed = btn.querySelector('.eye-closed-icon');
    if (open && closed) {
      open.style.display = 'block';
      closed.style.display = 'none';
    }
  }

  function resetTestPanel(resultEl, textEl) {
    if (resultEl && textEl) {
      resultEl.className = 'api-test-result';
      textEl.textContent = 'STANDBY // 待命';
    }
  }

  function fmtNum(v) {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? '—' : n.toLocaleString();
  }

  /* ================= 真实链路：测试连接 ================= */

  /**
   * 走 RetroflowAPI.testConnection：优先 GET /models，被屏蔽时退化为 chat 探针。
   * 探测成功且拿到模型列表时，顺手把清单渲染进模型池。
   * ctx 提供该视图对应的模型池 DOM，可为空。
   */
  async function runTest(btn, resultEl, textEl, urlInput, keyInput, modelInput, ctx) {
    if (!btn || !resultEl || !textEl) return;
    const btnSpan = btn.querySelector('span');
    const url = urlInput ? urlInput.value.trim() : '';
    const key = keyInput ? keyInput.value.trim() : '';
    const model = modelInput ? modelInput.value.trim() : '';

    // 插槽页三项全空 = 明确的「继承主模型」，不必打网络
    if (!url && !key && !model) {
      resultEl.className = 'api-test-result success';
      textEl.textContent = '继承主模型 · 无需单独测试';
      return;
    }
    if (!url) {
      resultEl.className = 'api-test-result error';
      textEl.textContent = 'ERR · 请填写 BASE URL';
      return;
    }

    if (btnSpan) btnSpan.textContent = '测试中';
    btn.disabled = true;
    resultEl.className = 'api-test-result testing';
    textEl.textContent = 'CONNECTING // 链路探测中...';

    let res;
    try {
      res = await RetroflowAPI.testConnection(url, key, model);
    } catch (err) {
      res = { ok: false, message: RetroflowAPI.describeNetworkError(err), models: [] };
    }

    if (btnSpan) btnSpan.textContent = '测试连接';
    btn.disabled = false;
    resultEl.className = 'api-test-result ' + (res.ok ? 'success' : 'error');
    textEl.textContent = res.ok ? res.message : 'ERR · ' + res.message;

    if (res.ok && res.models && res.models.length && ctx) {
      renderModelPool(ctx, res.models);
    }
  }

  /* ================= 真实链路：拉取模型列表 ================= */

  async function runFetchModels(btn, urlInput, keyInput, ctx, resultEl, textEl) {
    if (!btn) return;
    const textSpan = btn.querySelector('span');
    const url = urlInput ? urlInput.value.trim() : '';
    const key = keyInput ? keyInput.value.trim() : '';

    if (!url) {
      if (resultEl && textEl) {
        resultEl.className = 'api-test-result error';
        textEl.textContent = 'ERR · 请先填写 BASE URL';
      }
      return;
    }

    if (textSpan) textSpan.textContent = '拉取中';
    btn.disabled = true;
    if (ctx && ctx.count) ctx.count.textContent = '拉取中...';
    if (ctx && ctx.pool) ctx.pool.hidden = false;
    if (ctx && ctx.list) ctx.list.innerHTML = '<div class="model-pool-empty">正在从服务端获取模型清单</div>';

    try {
      const models = await RetroflowAPI.fetchModelList(url, key);
      // 生图插槽：从全量清单里筛出疑似生图模型
      if (editingSlot === 'imageGen') {
        const res = RetroflowAPI.filterImageModels(models);
        renderModelPool(ctx, res.list, res.filtered
          ? `${res.list.length} 个生图模型 · 已从 ${models.length} 个中筛出`
          : `未识别到生图模型 · 显示全部 ${models.length} 个`);
      } else {
        renderModelPool(ctx, models);
      }
      if (resultEl && textEl) {
        resultEl.className = 'api-test-result success';
        textEl.textContent = `拉取成功 · ${models.length} 个模型`;
      }
    } catch (err) {
      const msg = err.status ? err.message : RetroflowAPI.describeNetworkError(err);
      if (ctx) {
        if (ctx.count) ctx.count.textContent = '拉取失败';
        if (ctx.list) ctx.list.innerHTML = `<div class="model-pool-empty">${escapeHtml(msg)}</div>`;
      }
      if (resultEl && textEl) {
        resultEl.className = 'api-test-result error';
        textEl.textContent = 'ERR · ' + msg;
      }
    } finally {
      if (textSpan) textSpan.textContent = '拉取';
      btn.disabled = false;
    }
  }

  /* ================= 模型池渲染 ================= */

  // ctx: { pool, list, count, filter, input }
  function renderModelPool(ctx, models, countLabel) {
    if (!ctx || !ctx.pool || !ctx.list) return;
    ctx.models = models || [];
    ctx.pool.hidden = false;
    if (ctx.count) {
      ctx.count.textContent = countLabel || `${ctx.models.length} 个可用模型`;
    }
    paintModelPool(ctx);
  }

  function paintModelPool(ctx) {
    if (!ctx || !ctx.list) return;
    const kw = ctx.filter ? ctx.filter.value.trim().toLowerCase() : '';
    const picked = ctx.input ? ctx.input.value.trim() : '';
    const list = (ctx.models || []).filter((m) => !kw || m.toLowerCase().includes(kw));

    if (!list.length) {
      ctx.list.innerHTML = `<div class="model-pool-empty">${
        ctx.models && ctx.models.length ? '没有匹配的模型' : '暂无模型，点「拉取」获取'
      }</div>`;
      return;
    }

    ctx.list.innerHTML = list.map((m) => `
      <div class="model-pool-item${m === picked ? ' picked' : ''}" data-model="${escapeHtml(m)}">
        <span class="model-pool-dot"></span>
        <span class="model-pool-name">${escapeHtml(m)}</span>
      </div>`).join('');

    ctx.list.querySelectorAll('.model-pool-item').forEach((item) => {
      item.addEventListener('click', () => {
        if (ctx.input) ctx.input.value = item.dataset.model;
        paintModelPool(ctx);
      });
    });
  }

  function hideModelPool(ctx) {
    if (!ctx) return;
    ctx.models = [];
    if (ctx.filter) ctx.filter.value = '';
    if (ctx.list) ctx.list.innerHTML = '';
    if (ctx.pool) ctx.pool.hidden = true;
  }

  /* ================= 真实链路：测试生图 ================= */

  // 切换测试按钮的图标与加载态
  function setTestBtnBusy(btn, busy, busyText, idleText) {
    if (!btn) return;
    const icon = btn.querySelector('.test-btn-icon');
    const spinner = btn.querySelector('.test-spinner-icon');
    const label = btn.querySelector('span');
    btn.disabled = busy;
    if (icon) icon.style.display = busy ? 'none' : 'block';
    if (spinner) spinner.style.display = busy ? 'block' : 'none';
    if (label) label.textContent = busy ? busyText : idleText;
  }

  // 展台三态：placeholder / loading / image
  function setStageState(state, imageSrc) {
    if (!slotImageStage) return;
    if (slotStageImg) {
      slotStageImg.style.display = state === 'image' ? 'block' : 'none';
      if (state === 'image' && imageSrc) slotStageImg.src = imageSrc;
      if (state !== 'image') slotStageImg.removeAttribute('src');
    }
    if (!slotImageStagePlaceholder) return;
    slotImageStagePlaceholder.style.display = state === 'image' ? 'none' : 'flex';

    const hint = slotImageStagePlaceholder.querySelector('.image-stage-hint');
    const svg = slotImageStagePlaceholder.querySelector('svg');
    if (state === 'loading') {
      if (hint) hint.textContent = 'RENDERING // 生成中';
      if (svg) svg.classList.add('test-spinner-icon');
    } else {
      if (hint) hint.textContent = 'STANDBY // 图像渲染暂存区';
      if (svg) svg.classList.remove('test-spinner-icon');
    }
  }

  // 真实发起一次生图，用于验证生图链路
  async function runImageTest() {
    const url = slotBaseUrl ? slotBaseUrl.value.trim() : '';
    const key = slotKeyInput ? slotKeyInput.value.trim() : '';
    const model = slotModelId ? slotModelId.value.trim() : '';

    if (!url) {
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result error';
        slotTestResultText.textContent = 'ERR · 请填写 BASE URL';
      }
      return;
    }

    setTestBtnBusy(slotTestBtn, true, '测试中', '测试生图');
    if (slotTestResult && slotTestResultText) {
      slotTestResult.className = 'api-test-result testing';
      slotTestResultText.textContent = 'RENDERING // 生成中，生图较慢请稍候';
    }
    setStageState('loading');

    try {
      const res = await RetroflowAPI.generateImage({
        baseUrl: url,
        apiKey: key,
        modelId: model,
        prompt: slotImagePrompt ? slotImagePrompt.value.trim() : '',
        negativePrompt: slotImageNegPrompt ? slotImageNegPrompt.value.trim() : ''
      }, { logTag: 'API 设置 · 生图测试' });

      setStageState('image', res.image);
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result success';
        const secs = (res.latency / 1000).toFixed(1);
        slotTestResultText.textContent = res.downgraded
          ? `${secs}s · 生成成功 · 该服务商不支持 3:2，已降级 ${res.size}`
          : `${secs}s · 生成成功 · ${res.size}`;
      }
    } catch (err) {
      setStageState('placeholder');
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result error';
        slotTestResultText.textContent = 'ERR · ' + (err.message || '生图失败');
      }
    } finally {
      setTestBtnBusy(slotTestBtn, false, '测试中', '测试生图');
    }
  }

  /* ================= 真实链路：测试语音 ================= */

  // 试听播放器：单例复用，避免多次点击叠音
  let ttsAudioEl = null;

  function getTtsAudio() {
    if (!ttsAudioEl) {
      // 必须用 <audio> 元素：iOS 静音拨键会掐掉 Web Audio 输出（表现为全线无声），
      // 媒体元素不受影响。
      ttsAudioEl = new Audio();
      ttsAudioEl.preload = 'auto';
    }
    return ttsAudioEl;
  }

  // 真实发起一次 MiniMax 语音合成并试听
  async function runTtsTest() {
    const url = slotBaseUrl ? slotBaseUrl.value.trim() : '';
    const key = slotKeyInput ? slotKeyInput.value.trim() : '';

    if (!url) {
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result error';
        slotTestResultText.textContent = 'ERR · 请填写 BASE URL';
      }
      return;
    }
    if (!key) {
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result error';
        slotTestResultText.textContent = 'ERR · 请填写 MiniMax API Key';
      }
      return;
    }

    // 声学配置指纹：任一项改动都会让缓存失配，从而真实反映新参数
    const cfg = {
      baseUrl: url,
      apiKey: key,
      groupId: slotGroupId ? slotGroupId.value.trim() : '',
      modelId: slotModelId ? slotModelId.value.trim() : '',
      voiceId: slotVoiceId ? slotVoiceId.value.trim() : '',
      speed: slotSpeedSlider ? slotSpeedSlider.value : DEFAULT_SPEED,
      pitch: slotPitchSlider ? slotPitchSlider.value : DEFAULT_PITCH
    };
    const text = RetroflowAPI.BUILTIN_TTS_TEST_TEXT;

    setTestBtnBusy(slotTestBtn, true, '测试中', '测试语音');
    if (slotTestResult && slotTestResultText) {
      slotTestResult.className = 'api-test-result testing';
      slotTestResultText.textContent = RetroflowTTSCache.has(cfg, text)
        ? 'LOADING // 命中缓存，正在载入试听'
        : 'SYNTHESIZING // 正在合成试听音频';
    }

    try {
      const res = await RetroflowTTSCache.resolve(
        cfg,
        text,
        () => RetroflowAPI.synthesizeSpeech(cfg, { text, logTag: 'API 设置 · TTS 试音' })
      );

      const audio = getTtsAudio();
      audio.pause();
      audio.src = res.entry.url;
      try {
        await audio.play();
      } catch (playErr) {
        // 浏览器拦截自动播放时，音频已就绪，仅提示手动触发
        if (slotTestResult && slotTestResultText) {
          slotTestResult.className = 'api-test-result success';
          slotTestResultText.textContent = '合成成功 · 浏览器拦截了自动播放，请再点一次';
        }
        return;
      }

      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result success';
        const kb = (res.entry.size / 1024).toFixed(0);
        if (res.cached) {
          slotTestResultText.textContent = `试听播放中 · ${kb}KB · 命中缓存未计费`;
        } else {
          const secs = (res.latency / 1000).toFixed(1);
          slotTestResultText.textContent = `${secs}s · 合成成功 · ${kb}KB · 试听播放中`;
        }
      }
    } catch (err) {
      if (slotTestResult && slotTestResultText) {
        slotTestResult.className = 'api-test-result error';
        slotTestResultText.textContent = 'ERR · ' + (err.message || '语音合成失败');
      }
    } finally {
      setTestBtnBusy(slotTestBtn, false, '测试中', '测试语音');
    }
  }

  // 两个视图各自的模型池上下文
  const mainPoolCtx = {
    pool: modelPool,
    list: modelPoolList,
    count: modelPoolCount,
    filter: modelFilter,
    input: modelIdInput,
    models: []
  };

  const slotPoolCtx = {
    pool: slotModelPool,
    list: slotModelPoolList,
    count: slotModelPoolCount,
    filter: slotModelFilter,
    input: slotModelId,
    models: []
  };
  /* ================= 视图 A：节点库列表 ================= */

  /**
   * 点红点 / STANDBY 角标切换当前主模型。
   * 与世界书的整本启用开关同构：指示灯本体即开关，点了就地生效，不弹面板。
   */
  async function pickNode(nodeId) {
    if (!nodeId || nodeId === getActiveId()) return;
    if (!nodes.some((n) => n.id === nodeId)) return;

    await setActiveId(nodeId);
    // 红点、ACTIVE 角标由 renderNodeList 重绘
    renderNodeList();
    // 插槽的「继承主模型」文案随激活节点变化
    renderSlotCards();
  }


  function renderNodeList() {
    if (!nodeListEl) return;
    const activeId = getActiveId();

    if (!nodes.length) {
      nodeListEl.innerHTML =
        '<div class="api-node-empty">尚未录入任何 API 节点<br>点击上方「录入节点」添加第一个 OpenAI 兼容端点</div>';
      return;
    }

    nodeListEl.innerHTML = nodes.map((n) => {
      const isActive = n.id === activeId;
      const hostLabel = n.baseUrl ? escapeHtml(shortHost(n.baseUrl)) : '未设置';
      const modelLabel = n.modelId ? escapeHtml(n.modelId) : '未指派';
      const pickTitle = isActive ? '已是当前主模型' : '点击设为当前主模型';
      return `
        <div class="api-node-card${isActive ? ' active' : ''}" data-id="${n.id}">
          <button type="button" class="api-node-indicator api-node-pick" data-node-pick="${n.id}"
            title="${pickTitle}" aria-label="${pickTitle}" aria-pressed="${isActive}"></button>
          <div class="api-node-info">
            <div class="api-node-title-row">
              <span class="api-node-name">${escapeHtml(n.alias || '未命名节点')}</span>
              ${isActive
          ? '<span class="api-node-badge">ACTIVE</span>'
          : `<button type="button" class="api-node-badge off api-node-pick" data-node-pick="${n.id}"
                       title="点击设为当前主模型" aria-pressed="false">STANDBY</button>`}
            </div>
            <div class="api-node-meta-flow">
              <div class="api-node-meta-row">
                <span class="api-binding-label">端点状态:</span>
                <span class="api-binding-muted">${hostLabel}</span>
              </div>
              <div class="api-node-meta-row">
                <span class="api-binding-label">当前指派:</span>
                <span class="api-binding-val">${modelLabel}</span>
              </div>
            </div>
          </div>
          <button type="button" class="api-node-delete-btn" data-del="${n.id}" title="删除节点" aria-label="删除节点">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    nodeListEl.querySelectorAll('.api-node-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.api-node-delete-btn')) return;
        // 红点与 STANDBY 角标：切换主模型，拦截掉进编辑页的冒泡
        const pick = e.target.closest('.api-node-pick');
        if (pick) {
          e.stopPropagation();
          pickNode(pick.dataset.nodePick);
          return;
        }
        openEdit(card.dataset.id);
      });
    });
    nodeListEl.querySelectorAll('.api-node-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNode(btn.dataset.del);
      });
    });
  }

  // 刷新插槽卡片上的「当前指派」状态
  function renderSlotCards() {
    slotCards.forEach((card) => {
      const key = card.dataset.slot;
      const meta = SLOT_META[key] || {};
      const cfg = slots[key];
      const valEl = card.querySelector('.api-binding-val');
      if (!valEl) return;

      const configured = cfg && (cfg.baseUrl || cfg.modelId);
      if (configured) {
        const label = cfg.modelId
          ? cfg.modelId
          : shortHost(cfg.baseUrl);
        valEl.textContent = label;
      } else if (meta.fallback) {
        valEl.textContent = '继承主模型 (MAIN)';
      } else {
        valEl.textContent = meta.emptyLabel || '未配置 (OPTIONAL)';
      }
    });
  }

  /* ================= 右翼导轨切换 ================= */
  function switchDimension(dim) {
    bookmarks.forEach((bm) => {
      bm.classList.toggle('active', bm.dataset.dimension === dim);
    });
    Object.entries(listPanes).forEach(([k, el]) => {
      if (!el) return;
      const isTarget = k === dim;
      el.classList.toggle('active', isTarget);
      // 书签自身保留原有的抽拉位移，这里只让切出来的内容区重播淡入
      if (isTarget) Motion.replay(el);
    });
  }

  bookmarks.forEach((bm) => {
    bm.addEventListener('click', () => switchDimension(bm.dataset.dimension));
  });

  // 导轨顶部角标折叠/展开开关
  if (indexRail) {
    const railToggleBtn = indexRail.querySelector('.rail-notch-toggle-btn');
    if (railToggleBtn) {
      railToggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = indexRail.classList.toggle('is-collapsed');
        railToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        
        // 让工作区主容器同步切换避让 padding
        const apiBody = document.querySelector('#apiSettingsSection .api-body-layout, #apiSettingsPage .api-body-layout, #apiMasterView .api-body-layout, #apiListView .api-body-layout');
        if (apiBody) {
          apiBody.classList.toggle('rail-collapsed', isCollapsed);
        }
      });
    }
  }

  /* ================= 视图切换 ================= */
  function showListView() {
    Motion.swap(listView, [editView, slotView]);
    editingId = null;
    editingSlot = null;
    // 回到列表意味着直达链路已结束，清掉标记防止污染下一次常规进入
    slotDirectReturn = null;
    renderNodeList();
    renderSlotCards();
  }

  function scrollTop(view) {
    const scroller = view ? view.querySelector('.settings-body-scroll') : null;
    if (scroller) scroller.scrollTop = 0;
  }

  function showEditView() {
    Motion.swap(editView, [listView, slotView]);
    syncMainDisplays();
    scrollTop(editView);
  }

  function showSlotView() {
    Motion.swap(slotView, [listView, editView]);
    syncSlotDisplays();
    scrollTop(slotView);
  }

  /* ================= 主模型表单 ================= */
  function fillMainForm(node) {
    if (aliasInput) aliasInput.value = node ? (node.alias || '') : '';
    if (baseUrlInput) baseUrlInput.value = node ? (node.baseUrl || '') : '';
    if (apiKeyInput) apiKeyInput.value = node ? (node.apiKey || '') : '';
    resetEye(apiKeyToggleBtn, apiKeyInput);
    if (modelIdInput) modelIdInput.value = node ? (node.modelId || '') : '';
    if (tempSlider) tempSlider.value = node && node.temp != null ? node.temp : DEFAULT_TEMP;
    if (contextInput) contextInput.value = node && node.context != null ? node.context : DEFAULT_CONTEXT;
    if (maxTokensInput) maxTokensInput.value = node && node.maxTokens != null ? node.maxTokens : '';
    hideModelPool(mainPoolCtx);
    resetTestPanel(testResult, testResultText);
  }

  function collectMainForm() {
    return {
      alias: aliasInput ? aliasInput.value.trim() : '',
      baseUrl: baseUrlInput ? baseUrlInput.value.trim() : '',
      apiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
      modelId: modelIdInput ? modelIdInput.value.trim() : '',
      temp: tempSlider ? tempSlider.value : DEFAULT_TEMP,
      context: contextInput && contextInput.value.trim() ? contextInput.value.trim() : DEFAULT_CONTEXT,
      maxTokens: maxTokensInput ? maxTokensInput.value.trim() : ''
    };
  }

  function syncMainDisplays() {
    if (tempSlider && tempDisplay) tempDisplay.textContent = Number(tempSlider.value).toFixed(2);
    if (contextInput && contextDisplay) contextDisplay.textContent = fmtNum(contextInput.value);
  }

  function openAdd() {
    editingId = null;
    fillMainForm(null);
    showEditView();
  }

  function openEdit(id) {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    editingId = id;
    fillMainForm(node);
    showEditView();
  }

  function saveNode() {
    const data = collectMainForm();
    if (!data.alias) {
      data.alias = data.baseUrl ? shortHost(data.baseUrl) : '未命名节点';
    }

    if (editingId) {
      const idx = nodes.findIndex((n) => n.id === editingId);
      if (idx !== -1) nodes[idx] = Object.assign({}, nodes[idx], data);
    } else {
      const id = genId();
      nodes.push(Object.assign({ id }, data));
      if (nodes.length === 1) setActiveId(id);
    }

    persistNodes();
    showListView();
  }

  async function deleteNode(id) {
    const node = nodes.find((n) => n.id === id);
    const name = node ? (node.alias || '该节点') : '该节点';
    const ok = await RetroModal.confirm({
      message: `确认要彻底移除节点「${name}」吗？`,
      detail: '删除后无法恢复，若该节点正在被激活使用，系统将自动回退首个可用节点。',
      confirmText: '确认删除',
      cancelText: '取消',
      danger: true
    });
    if (!ok) return;

    nodes = nodes.filter((n) => n.id !== id);
    await persistNodes();

    if (getActiveId() === id) {
      await setActiveId(nodes.length ? nodes[0].id : '');
    }
    renderNodeList();
  }

  /* ================= 插槽表单 ================= */

  /**
   * 当前在「从主模型中选择」里选中的节点 id。
   * 原本这个状态由原生 <select> 的 value 持有，改用通用选项面板后
   * 没有宿主控件可存，提到模块级变量里。
   */
  let importPickedId = '';

  /** 节点显示名：带上 ACTIVE 角标，与节点库列表口径一致 */
  function nodeLabelOf(node) {
    if (!node) return '';
    return `${node.alias || '未命名节点'}${node.id === getActiveId() ? ' · ACTIVE' : ''}`;
  }

  /**
   * 刷新载入源的显示。
   * 默认落在当前激活节点上：多数情况下用户想载入的就是它。
   * 选中的节点被删掉时回落到激活节点，不留一个指向空气的 id。
   */
  function renderImportOptions() {
    if (!slotImportLabel) return;

    if (!nodes.length) {
      importPickedId = '';
      slotImportLabel.value = '节点库为空，请先录入主模型';
      return;
    }

    const activeId = getActiveId();
    if (!importPickedId || !nodes.some((n) => n.id === importPickedId)) {
      importPickedId = (activeId && nodes.some((n) => n.id === activeId))
        ? activeId
        : nodes[0].id;
    }
    slotImportLabel.value = nodeLabelOf(nodes.find((n) => n.id === importPickedId));
  }

  /** 点击载入源那一行：唤起通用单选面板挑节点 */
  async function pickImportNode() {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    // 节点库为空时不开面板：空面板给不出任何可选项，点「一键载入」才会说明原因
    if (!nodes.length) return;

    const activeId = getActiveId();
    const picked = await SelectModal.pick({
      title: '选择载入来源',
      tag: 'IMPORT // 节点库',
      options: nodes.map((n) => ({
        value: n.id,
        label: n.alias || '未命名节点',
        hint: n.id === activeId
          ? `ACTIVE · ${n.modelId || '未指派模型'}`
          : (n.modelId || '未指派模型')
      })),
      value: importPickedId,
      searchable: nodes.length > 8
    });
    if (!picked) return;

    importPickedId = picked;
    renderImportOptions();
  }

  function fillSlotForm(cfg) {
    const isTts = editingSlot === 'tts';
    // TTS 预设端点与模型：api.minimaxi.chat 已废弃，现行国内域名为 api.minimaxi.com
    const defaultUrl = isTts ? TTS_DEFAULT_URL : '';
    const defaultModel = isTts ? TTS_DEFAULT_MODEL : '';

    if (slotBaseUrl) slotBaseUrl.value = cfg && cfg.baseUrl ? cfg.baseUrl : defaultUrl;
    if (slotKeyInput) slotKeyInput.value = cfg ? (cfg.apiKey || '') : '';
    resetEye(slotKeyToggleBtn, slotKeyInput);
    if (slotModelId) slotModelId.value = cfg && cfg.modelId ? cfg.modelId : defaultModel;
    if (slotVoiceId) slotVoiceId.value = cfg ? (cfg.voiceId || '') : '';
    if (slotGroupId) slotGroupId.value = cfg ? (cfg.groupId || '') : '';
    if (slotSpeedSlider) slotSpeedSlider.value = cfg && cfg.speed != null ? cfg.speed : DEFAULT_SPEED;
    if (slotPitchSlider) slotPitchSlider.value = cfg && cfg.pitch != null ? cfg.pitch : DEFAULT_PITCH;
    if (slotTempSlider) slotTempSlider.value = cfg && cfg.temp != null ? cfg.temp : DEFAULT_TEMP;
    if (slotContextInput) slotContextInput.value = cfg && cfg.context != null ? cfg.context : DEFAULT_CONTEXT;
    if (slotMaxTokens) slotMaxTokens.value = cfg && cfg.maxTokens != null ? cfg.maxTokens : '';
    if (slotImagePrompt) slotImagePrompt.value = cfg ? (cfg.prompt || '') : '';
    if (slotImageNegPrompt) slotImageNegPrompt.value = cfg ? (cfg.negativePrompt || '') : '';
    syncSlotDisplays();
    setStageState('placeholder');
    hideModelPool(slotPoolCtx);
    resetTestPanel(slotTestResult, slotTestResultText);
  }

  function collectSlotForm() {
    const isImage = editingSlot === 'imageGen';
    const isTts = editingSlot === 'tts';
    const base = {
      baseUrl: slotBaseUrl ? slotBaseUrl.value.trim() : '',
      apiKey: slotKeyInput ? slotKeyInput.value.trim() : '',
      modelId: slotModelId ? slotModelId.value.trim() : ''
    };

    if (isTts) {
      return Object.assign(base, {
        groupId: slotGroupId ? slotGroupId.value.trim() : '',
        voiceId: slotVoiceId ? slotVoiceId.value.trim() : '',
        speed: slotSpeedSlider ? slotSpeedSlider.value : DEFAULT_SPEED,
        pitch: slotPitchSlider ? slotPitchSlider.value : DEFAULT_PITCH
      });
    }

    if (isImage) {
      return Object.assign(base, {
        prompt: slotImagePrompt ? slotImagePrompt.value.trim() : '',
        negativePrompt: slotImageNegPrompt ? slotImageNegPrompt.value.trim() : ''
      });
    }

    return Object.assign(base, {
      temp: slotTempSlider ? slotTempSlider.value : DEFAULT_TEMP,
      context: slotContextInput && slotContextInput.value.trim() ? slotContextInput.value.trim() : DEFAULT_CONTEXT,
      maxTokens: slotMaxTokens ? slotMaxTokens.value.trim() : ''
    });
  }

  function syncSlotDisplays() {
    if (slotTempSlider && slotTempDisplay) slotTempDisplay.textContent = Number(slotTempSlider.value).toFixed(2);
    if (slotContextInput && slotContextDisplay) slotContextDisplay.textContent = fmtNum(slotContextInput.value);
    if (slotSpeedSlider && slotSpeedDisplay) slotSpeedDisplay.textContent = Number(slotSpeedSlider.value).toFixed(2) + 'x';
    if (slotPitchSlider && slotPitchDisplay) {
      const p = Number(slotPitchSlider.value);
      slotPitchDisplay.textContent = p > 0 ? `+${p}` : String(p);
    }
  }

  /**
   * 离开插槽表单。
   * 直达模式下把控制权交回来源页（跳过模型列表这个中间层）；
   * 常规进入则退回模型列表页。
   */
  function leaveSlotView() {
    if (slotDirectReturn) {
      const back = slotDirectReturn;
      slotDirectReturn = null;
      editingSlot = null;
      try {
        back();
        return;
      } catch (err) {
        console.warn('[Retroflow API] 直达返回失败，退回列表:', err);
      }
    }
    showListView();
  }

  function openSlot(key, options) {
    const meta = SLOT_META[key];
    if (!meta) return;
    editingSlot = key;
    const opts = options || {};
    slotDirectReturn = typeof opts.onBack === 'function' ? opts.onBack : null;

    if (slotEditTitle) slotEditTitle.textContent = meta.title;
    if (slotEditSubLabel) {
      slotEditSubLabel.textContent = meta.fallback
        ? '留空则自动退回主模型'
        : (meta.protocol === 'minimax' ? 'MiniMax 语音合成端点' : 'OpenAI 兼容生图端点');
    }

    const isImage = key === 'imageGen';
    const isTts = key === 'tts';

    // 00 卡片：TTS 属于独立 MiniMax 语音协议，隐藏主模型载入
    if (slotImportCard) slotImportCard.hidden = isTts;

    // 01 卡片 placeholder
    if (slotBaseUrl) {
      slotBaseUrl.placeholder = isTts ? TTS_DEFAULT_URL : '留空则继承主模型';
    }
    if (slotKeyInput) {
      slotKeyInput.placeholder = isTts ? '填入 MiniMax API Key' : '留空则继承主模型';
    }
    // GROUP ID 仅 TTS 需要（老版 key 必填）
    if (slotGroupIdGroup) slotGroupIdGroup.hidden = !isTts;

    // 02 卡片：模型与音色
    if (slotModelCardTitle) {
      slotModelCardTitle.textContent = isTts ? '模型与音色指派' : '模型指派';
    }
    if (slotModelHint) {
      slotModelHint.textContent = isTts ? 'MiniMax 语音合成模型' : '支持手动输入或从服务端获取';
    }
    if (slotModelId) {
      slotModelId.placeholder = isTts ? TTS_DEFAULT_MODEL : '留空则继承主模型';
    }
    if (slotFetchModelsBtn) {
      // TTS 走独立协议，隐藏 OpenAI 式的模型拉取
      slotFetchModelsBtn.style.display = isTts ? 'none' : '';
    }
    if (slotVoiceGroup) slotVoiceGroup.hidden = !isTts;

    // 03 卡片：3 向互斥分流（对话显示 3A，生图显示 3B，TTS 显示 3C）
    if (slotParamCardInference) slotParamCardInference.hidden = isImage || isTts;
    if (slotParamCardImageGen) slotParamCardImageGen.hidden = !isImage;
    if (slotParamCardTts) slotParamCardTts.hidden = !isTts;
    if (slotImageStage) slotImageStage.hidden = !isImage;

    renderImportOptions();
    fillSlotForm(slots[key]);

    // 按钮与状态文案分流
    let btnText = '测试连接';
    let statusText = 'STANDBY // 待命';
    if (isImage) {
      btnText = '测试生图';
      statusText = 'STANDBY // 点击按钮发送请求测试生图';
    } else if (isTts) {
      btnText = '测试语音';
      statusText = 'STANDBY // 点击按钮发送请求测试语音合成';
    }

    setTestBtnBusy(slotTestBtn, false, '测试中', btnText);
    if (slotTestResult && slotTestResultText) {
      slotTestResult.className = 'api-test-result';
      slotTestResultText.textContent = statusText;
    }

    showSlotView();
  }

  // 一键载入：把选中节点的配置复制进当前插槽表单
  function loadFromNode() {
    const node = nodes.find((n) => n.id === importPickedId);
    if (!node) {
      RetroModal.alert({
        message: '节点库为空',
        detail: '请先在「模型」页录入至少一个 API 节点，之后才能一键载入其配置。',
        confirmText: '知道了'
      });
      return;
    }
    fillSlotForm({
      baseUrl: node.baseUrl,
      apiKey: node.apiKey,
      modelId: node.modelId,
      temp: node.temp,
      context: node.context,
      maxTokens: node.maxTokens
    });
    syncSlotDisplays();
  }

  // 清空留空：退回继承主模型
  function clearSlotForm() {
    fillSlotForm(null);
    syncSlotDisplays();
  }

  function saveSlot() {
    if (!editingSlot) return;
    const data = collectSlotForm();
    const isEmpty = !data.baseUrl && !data.apiKey && !data.modelId;

    if (isEmpty) {
      delete slots[editingSlot];
    } else {
      slots[editingSlot] = data;
    }

    persistSlots();
    // 直达模式下保存即返回来源页，避免把用户甩到无关的模型列表
    leaveSlotView();
  }

  /* ================= 事件绑定 ================= */
  bindEyeToggle(apiKeyToggleBtn, apiKeyInput);
  bindEyeToggle(slotKeyToggleBtn, slotKeyInput);
  if (tempSlider && tempDisplay) {
    tempSlider.addEventListener('input', () => {
      tempDisplay.textContent = Number(tempSlider.value).toFixed(2);
    });
  }
  if (contextInput && contextDisplay) {
    contextInput.addEventListener('input', () => {
      contextDisplay.textContent = fmtNum(contextInput.value);
    });
  }
  if (slotTempSlider && slotTempDisplay) {
    slotTempSlider.addEventListener('input', () => {
      slotTempDisplay.textContent = Number(slotTempSlider.value).toFixed(2);
    });
  }
  if (slotContextInput && slotContextDisplay) {
    slotContextInput.addEventListener('input', () => {
      slotContextDisplay.textContent = fmtNum(slotContextInput.value);
    });
  }
  if (slotSpeedSlider && slotSpeedDisplay) {
    slotSpeedSlider.addEventListener('input', () => {
      slotSpeedDisplay.textContent = Number(slotSpeedSlider.value).toFixed(2) + 'x';
    });
  }
  if (slotPitchSlider && slotPitchDisplay) {
    slotPitchSlider.addEventListener('input', () => {
      const p = Number(slotPitchSlider.value);
      slotPitchDisplay.textContent = p > 0 ? `+${p}` : String(p);
    });
  }

  // 模型池筛选框
  if (modelFilter) modelFilter.addEventListener('input', () => paintModelPool(mainPoolCtx));
  if (slotModelFilter) slotModelFilter.addEventListener('input', () => paintModelPool(slotPoolCtx));

  if (addNodeBtn) addNodeBtn.addEventListener('click', openAdd);
  if (editBackBtn) editBackBtn.addEventListener('click', showListView);
  if (nodeSaveBtn) nodeSaveBtn.addEventListener('click', saveNode);

  if (slotBackBtn) slotBackBtn.addEventListener('click', leaveSlotView);
  if (slotSaveBtn) slotSaveBtn.addEventListener('click', saveSlot);
  if (slotLoadBtn) slotLoadBtn.addEventListener('click', loadFromNode);
  if (slotClearBtn) slotClearBtn.addEventListener('click', clearSlotForm);

  // 载入源选择：整框可点，键盘也能触发（与世界书的注入位置选择器同构）
  if (slotImportTrigger) {
    slotImportTrigger.addEventListener('click', pickImportNode);
    slotImportTrigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        pickImportNode();
      }
    });
  }

  // 插槽卡片：点击推入插槽配置页
  slotCards.forEach((card) => {
    card.addEventListener('click', () => openSlot(card.dataset.slot));
  });

  if (testBtn) {
    testBtn.addEventListener('click', () => {
      runTest(testBtn, testResult, testResultText, baseUrlInput, apiKeyInput, modelIdInput, mainPoolCtx);
    });
  }
  if (slotTestBtn) {
    slotTestBtn.addEventListener('click', () => {
      // 生图走真实生图，TTS 走真实语音合成，其余走链路探测
      if (editingSlot === 'imageGen') {
        runImageTest();
      } else if (editingSlot === 'tts') {
        runTtsTest();
      } else {
        runTest(slotTestBtn, slotTestResult, slotTestResultText, slotBaseUrl, slotKeyInput, slotModelId, slotPoolCtx);
      }
    });
  }
  if (fetchModelsBtn) {
    fetchModelsBtn.addEventListener('click', () => {
      runFetchModels(fetchModelsBtn, baseUrlInput, apiKeyInput, mainPoolCtx, testResult, testResultText);
    });
  }
  if (slotFetchModelsBtn) {
    slotFetchModelsBtn.addEventListener('click', () => {
      runFetchModels(slotFetchModelsBtn, slotBaseUrl, slotKeyInput, slotPoolCtx, slotTestResult, slotTestResultText);
    });
  }


  /* ================= 暴露给设置中枢 ================= */
  window.RetroflowApiUI = {
    init: () => {
      // 每次进入 API 页都从 Store 重新同步，避免其他入口改过配置后不一致
      syncFromStore();
      showListView();
      switchDimension('main');
      renderNodeList();
      renderSlotCards();
    },
    getNodes: () => nodes.slice(),
    getActiveNode: () => nodes.find((n) => n.id === getActiveId()) || null,
    getSlot: (key) => slots[key] || null,
    // 取插槽的有效配置：插槽未配置时自动退回激活的主模型节点
    resolveSlot: (key) => {
      const cfg = slots[key];
      if (cfg && (cfg.baseUrl || cfg.modelId)) return cfg;
      return nodes.find((n) => n.id === getActiveId()) || null;
    },
    activateNode: (id) => {
      setActiveId(id);
      renderNodeList();
      // 与面板内切换保持同一套联动：插槽的「继承主模型」也要跟着变
      renderSlotCards();
    },
    // 直达特定插槽配置页
    openSlot: (key) => {
      syncFromStore();
      openSlot(key);
    },
    // 直达新增主模型节点表单
    openAdd: () => {
      syncFromStore();
      openAdd();
    }
  };

  // 配置装载完成后同步数据并首屏渲染
  Boot.onReady('api', () => {
    syncFromStore();
    renderNodeList();
    renderSlotCards();
  });
})();