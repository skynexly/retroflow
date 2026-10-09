/**
 * 溯流计划 · 世界书架构中枢全屏控制器 (WorldBook UI Controller)
 * 职责：
 * 1. 管理全屏独立页面 (#worldbookPage) 进出过渡与历史记录哈希栈 (#worldbook)；
 * 2. 调度 5 大战术分类（全局 / 助手 / 线上 / 副本 / 生成）与右翼战术导轨；
 * 3. 数据驱动渲染：分类 → 书本 (Book) → 条目 (Entry)，读写 Store.worldbook.books；
 * 4. 严格遵守《工地施工协议》：全纯 SVG、零 Emoji、零分割线、iOS 灵动岛及状态栏保护。
 *
 * 数据模型：
 *   book  { id, category, name, desc, active, bindRosterIds[], entries[] }
 *   entry { id, title, enabled, mode:'constant'|'keyword', keys, position:'sys-top'|'sys-bottom'|'depth', depth, role, content }
 *
 * 关于 bindRosterIds：
 *   线上分类专属。挂了角色 id 就只对这些角色的私聊窗口注入，空数组即全部窗口。
 *   绑定的档案被删掉时引擎匹配不上，静默不注入，id 留着等用户换绑。
 */
const WorldBookUI = (() => {
  'use strict';

  // 5 大战术分类定义（全局置顶）
  const CATEGORIES = [
    { id: 'global', zh: '全局', en: 'GLOBAL DIRECTIVES' },
    { id: 'assistant', zh: '助手', en: 'SYSTEM ASSISTANT' },
    { id: 'online', zh: '线上', en: 'ONLINE CHAT' },
    { id: 'instance', zh: '副本', en: 'OFFLINE PLOT' },
    { id: 'generation', zh: '生成', en: 'OTHER GENERATION' }
  ];

  // 支持深度注入的分类。全局分类只暴露系统顶部与底部（全局设定要穿透总结、
  // 记忆提取等无对话轮次的场景，深度注入无处可插）；助手与线上都有完整对话流，
  // 深度注入才有落点。
  const DEPTH_CATEGORIES = ['assistant', 'online', 'instance'];

  // 支持角色绑定的分类：线上私聊有明确的「对方是谁」，副本推演有 NPC/高危角色
  const BIND_CATEGORIES = ['online', 'instance'];

  // 注入位置选项
  const INJECTION_POSITIONS = [
    { value: 'sys-top', label: '系统顶部 (SYSTEM TOP)', hint: '注入至 Prompt 最前列作为最高统领法则' },
    { value: 'sys-bottom', label: '系统底部 (SYSTEM BOTTOM)', hint: '注入至系统指令末尾，强化近期执行约束' }
  ];

  const DEPTH_POSITION = {
    value: 'depth',
    label: '深度注入 (AT DEPTH)',
    hint: '作为独立消息插入对话流指定深度，比系统指令更贴近当前语境'
  };

  // 深度注入的消息角色
  const INJECTION_ROLES = [
    { value: 'system', label: '系统 (SYSTEM)', hint: '以系统身份下达，指令感最强，不参与角色扮演' },
    { value: 'assistant', label: '助手 (ASSISTANT)', hint: '伪装成助手的既往发言，用于自我设定与口吻锚定' },
    { value: 'user', label: '用户 (USER)', hint: '伪装成执行员的发言，用于制造既定的用户诉求' }
  ];

  /** 当前编辑中书本的分类（回落到当前分类） */
  function editingCategory() {
    const book = findBook(editingBookId);
    return (book && book.category) || currentCategory;
  }

  /** 当前分类是否支持深度注入 */
  function allowsDepth(catId) {
    return DEPTH_CATEGORIES.indexOf(catId || editingCategory()) >= 0;
  }

  /** 当前分类是否支持书本级角色绑定 */
  function allowsBind(catId) {
    return BIND_CATEGORIES.indexOf(catId || editingCategory()) >= 0;
  }

  /** 当前分类可用的注入位置选项 */
  function positionOptions() {
    return allowsDepth()
      ? INJECTION_POSITIONS.concat([DEPTH_POSITION])
      : INJECTION_POSITIONS;
  }

  /** 按取值找注入位置定义，找不到时回落首项 */
  function findPosition(value) {
    const all = INJECTION_POSITIONS.concat([DEPTH_POSITION]);
    return all.find((p) => p.value === value) || INJECTION_POSITIONS[0];
  }

  /** 按取值找注入角色定义，找不到时回落系统 */
  function findRole(value) {
    return INJECTION_ROLES.find((r) => r.value === value) || INJECTION_ROLES[0];
  }

  const SVG_TRASH = '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>';

  // 副本分类内置世界书：固定 id，不可删除、不可改名。条目可自由编辑。
  const BUILTIN_BOOKS = [
    { id: 'wb_builtin_style', name: '文风', desc: '副本推演的文风指令' },
    { id: 'wb_builtin_cot', name: '思维链', desc: '副本推演的思维链指令' }
  ];
  const BUILTIN_IDS = BUILTIN_BOOKS.map((b) => b.id);

  /** 判断是否为系统内置世界书 */
  function isBuiltin(bookId) {
    return BUILTIN_IDS.indexOf(bookId) >= 0;
  }

  let pageEl = null;
  let backBtn = null;
  let indexRail = null;
  let bodyLayout = null;
  let listView = null;
  let editView = null;
  let editBackBtn = null;
  let saveBtn = null;
  let addEntryBtn = null;
  let entriesContainer = null;
  let nameInput = null;
  let descInput = null;
  let editTitleEl = null;
  let bindGroup = null;
  let bindTrigger = null;
  let bindInput = null;
  let bindChipRow = null;
  let bindForkGroup = null;
  let bindForkTrigger = null;
  let bindForkInput = null;
  let bindForkChipRow = null;
  let isOpen = false;
  let bound = false;
  let currentCategory = 'global';
  let currentLayer = 'list';
  // 当前编辑中的书本 id
  let editingBookId = null;
  // 跨页返回回调：跳进来时由调用方传入，关页时执行以回到来源页
  let returnTarget = null;
  // 字段改动的防抖落盘句柄
  let saveTimer = null;

  function initElements() {
    pageEl = document.getElementById('worldbookPage');
    backBtn = document.getElementById('worldbookBackBtn');
    indexRail = document.getElementById('worldbookIndexRail');
    bodyLayout = document.getElementById('worldbookBodyLayout');
    listView = document.getElementById('wbListView');
    editView = document.getElementById('wbEditView');
    editBackBtn = document.getElementById('wbEditBackBtn');
    saveBtn = document.getElementById('wbSaveBtn');
    addEntryBtn = document.getElementById('wbAddEntryBtn');
    entriesContainer = document.getElementById('wbEntriesContainer');
    nameInput = document.getElementById('wbNameInput');
    descInput = document.getElementById('wbDescInput');
    editTitleEl = document.getElementById('wbEditTitleZh');
    bindGroup = document.getElementById('wbBindGroup');
    bindTrigger = document.getElementById('wbBindTrigger');
    bindInput = document.getElementById('wbBindInput');
    bindChipRow = document.getElementById('wbBindChipRow');
    bindForkGroup = document.getElementById('wbBindForkGroup');
    bindForkTrigger = document.getElementById('wbBindForkTrigger');
    bindForkInput = document.getElementById('wbBindForkInput');
    bindForkChipRow = document.getElementById('wbBindForkChipRow');
  }

  /* ================= 数据存取 ================= */

  function getBooks() {
    if (!window.Store || !Store.worldbook || !Array.isArray(Store.worldbook.books)) return [];
    return Store.worldbook.books;
  }

  function findBook(id) {
    return getBooks().find((b) => b && b.id === id) || null;
  }

  function toast(tag, message, type) {
    if (window.RetroToast && typeof RetroToast.show === 'function') {
      RetroToast.show({ tag, message, type: type || 'info' });
    }
  }

  async function persist() {
    if (!window.Store || typeof Store.save !== 'function') return false;
    // 底层守卫：数据未加载完不写盘，防止用内存初始态覆盖库里真实数据。
    if (typeof Store.isLoaded === 'function' && !Store.isLoaded()) {
      console.warn('[WorldBook] Store 未就绪，跳过本次写盘以防覆盖真实数据');
      return false;
    }
    const ok = await Store.save('worldbook.books', getBooks());
    if (!ok) toast('STORAGE // 写入失败', '世界书保存失败', 'warning');
    return ok;
  }

  function schedulePersist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persist();
    }, 600);
  }

  function flushPersist() {
    if (!saveTimer) return null;
    clearTimeout(saveTimer);
    saveTimer = null;
    return persist();
  }

  function makeId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 确保副本分类的系统内置世界书存在。
   * 首次启动或老用户升级时自动创建，已存在则跳过。
   * 调用时机：renderList 之前（initElements 之后），保证列表渲染时数据已就绪。
   * @returns {boolean} 是否有新建（需要 persist）
   */
  function ensureBuiltinBooks() {
    if (!window.Store || !Store.worldbook || !Array.isArray(Store.worldbook.books)) return false;
    const books = Store.worldbook.books;
    let created = false;

    BUILTIN_BOOKS.forEach((def) => {
      const exists = books.some((b) => b && b.id === def.id);
      if (exists) return;

      // 插到数组头部，保证内置书始终排在最前
      books.unshift({
        id: def.id,
        category: 'instance',
        name: def.name,
        desc: def.desc,
        active: true,
        builtin: true,
        bindRosterIds: [],
        entries: []
      });
      created = true;
    });

    return created;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '"').replace(/'/g, '&#39;');
  }

  function paneListId(catId) {
    return 'wbList' + catId.charAt(0).toUpperCase() + catId.slice(1);
  }

  /* ================= 角色绑定取数 ================= */

  /** 取角色与 NPC 档案池，扁平成 { id, name, group } */
  function rosterPool() {
    if (!window.Store || !Store.roster) return [];
    const out = [];
    const push = (list, group) => {
      (Array.isArray(list) ? list : []).forEach((p) => {
        if (!p || !p.id) return;
        out.push({ id: String(p.id), name: p.name || '未命名档案', group });
      });
    };
    push(Store.roster.characters, 'CHARACTERS // 角色档案');
    push(Store.roster.npcs, 'NPC // 配角档案');
    return out;
  }

  /** 书本的绑定 id 数组（永远返回数组，不改动原对象） */
  function bindIdsOf(book) {
    if (!book || !Array.isArray(book.bindRosterIds)) return [];
    return book.bindRosterIds.filter(Boolean).map((v) => String(v));
  }

  /**
   * 把绑定 id 翻译成展示名。
   * 档案被删掉的 id 不产出名字，但计入 missing，好让用户知道有绑定失效了。
   */
  function resolveBindNames(book) {
    const ids = bindIdsOf(book);
    if (ids.length === 0) return { names: [], missing: 0 };
    const pool = rosterPool();
    const names = [];
    let missing = 0;
    ids.forEach((id) => {
      const hit = pool.find((p) => p.id === id);
      if (hit) names.push(hit.name);
      else missing += 1;
    });
    return { names, missing };
  }

  /* ================= 列表层渲染 ================= */

  function countActiveEntries(book) {
    // 整本停用时对外一律显示 0，避免让人误以为仍在注入
    if (book.active === false) return 0;
    const entries = Array.isArray(book.entries) ? book.entries : [];
    return entries.filter((e) => e && e.enabled !== false).length;
  }

  /** 卡片下方的绑定角色/副本名字小标签；没绑定就不渲染任何东西 */
  function bindChipsHtml(book) {
    const parts = [];

    // 角色绑定标签（线上 + 副本）
    if (allowsBind(book.category)) {
      const { names, missing } = resolveBindNames(book);
      if (names.length > 0 || missing > 0) {
        names.forEach((n) => parts.push('<span class="wb-bind-chip">' + escapeHtml(n) + '</span>'));
        if (missing > 0) parts.push('<span class="wb-bind-chip is-lost">档案失效 ' + missing + '</span>');
      }
    }

    // 副本绑定标签（仅副本分类）
    if (book.category === 'instance') {
      const forkIds = Array.isArray(book.bindForkIds) ? book.bindForkIds.filter(Boolean) : [];
      if (forkIds.length > 0) {
        const forks = (window.Store && Store.fork && Array.isArray(Store.fork.index)) ? Store.fork.index : [];
        let forkMissing = 0;
        forkIds.forEach((fid) => {
          const hit = forks.find((f) => f && String(f.id) === String(fid));
          if (hit) parts.push('<span class="wb-bind-chip wb-bind-chip-fork">' + escapeHtml(hit.title || hit.name || '未命名副本') + '</span>');
          else forkMissing += 1;
        });
        if (forkMissing > 0) parts.push('<span class="wb-bind-chip is-lost">副本失效 ' + forkMissing + '</span>');
      }
    }

    if (parts.length === 0) return '';
    return '<div class="wb-book-bind-row">' + parts.join('') + '</div>';
  }

  function renderList() {
    CATEGORIES.forEach((cat) => {
      const listEl = document.getElementById(paneListId(cat.id));
      if (!listEl) return;

      const books = getBooks().filter((b) => b && b.category === cat.id);
      // 内置书始终排在最前
      books.sort((a, b) => (isBuiltin(b.id) ? 1 : 0) - (isBuiltin(a.id) ? 1 : 0));
      if (books.length === 0) {
        listEl.innerHTML = '<div class="api-node-empty">暂无' + cat.zh
          + '世界书<br>点击右上角「新建」录入</div>';
        return;
      }

      listEl.innerHTML = books.map((book) => {
        const on = book.active !== false;
        return '<div class="wb-book-card' + (on ? '' : ' wb-book-off')
          + '" data-book-id="' + escapeHtml(book.id) + '">'
          + '<button type="button" class="wb-book-indicator wb-book-toggle"'
          + ' data-book-toggle="' + escapeHtml(book.id) + '"'
          + ' title="' + (on ? '点击停用此世界书' : '点击启用此世界书') + '"'
          + ' aria-label="' + (on ? '停用此世界书' : '启用此世界书') + '"'
          + ' aria-pressed="' + (on ? 'true' : 'false') + '"></button>'
          + '<div class="wb-book-info">'
          + '<div class="wb-book-title-row">'
          + '<span class="wb-book-name">' + escapeHtml(book.name || '未命名世界书') + '</span>'
          + '<button type="button" class="wb-book-badge wb-book-toggle'
          + (on ? '' : ' off') + '" data-book-toggle="' + escapeHtml(book.id) + '"'
          + ' title="' + (on ? '点击停用此世界书' : '点击启用此世界书') + '"'
          + ' aria-pressed="' + (on ? 'true' : 'false') + '">'
          + (on ? 'ACTIVE' : 'OFF')
          + '</button>'
          + '</div>'
          + '<span class="wb-book-desc">' + escapeHtml(book.desc || '暂无简介') + '</span>'
          + '<div class="wb-book-meta-row">'
          + '<span class="wb-book-count">' + countActiveEntries(book) + ' 个生效条目</span>'
          + '</div>'
          + bindChipsHtml(book)
          + '</div>'
          + (isBuiltin(book.id)
            ? ''
            : '<button type="button" class="wb-book-delete-btn" title="删除世界书" aria-label="删除世界书">'
            + '<svg viewBox="0 0 24 24" aria-hidden="true">' + SVG_TRASH + '</svg>'
            + '</button>')
          + '</div>';
      }).join('');
    });
  }

  /* ================= 编辑层渲染 ================= */

  function manualDrawerHtml() {
    const star = '<svg class="manual-item-star" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"/></svg>';

    const items = [
      {
        name: '普通文本',
        code: '破限',
        desc: '直接写词。正文包含该词即命中，不区分大小写。'
      },
      {
        name: '正则匹配',
        code: '/(晨|早).{0,6}光柱/i',
        desc: '用斜杠包裹，可带 i / m / s / u 标志。斜杠内部的逗号与空格不会被当成分隔符，大小写由 i 自行控制。'
      },
      {
        name: '全词精确',
        code: '"cat"',
        desc: '用引号包裹，两侧不能紧邻同类字符，可避免 cat 被 concatenate 误命中。纯中文没有词边界，此写法会退化为包含匹配。'
      }
    ];

    return '<div class="psych-radar-manual-drawer wb-keys-manual" hidden>'
      + '<div class="radar-manual-intro">'
      + '<span class="manual-intro-prefix">填写规则：</span>'
      + '多个关键词用逗号或空格分隔，任意一项命中即触发本条目。判定只扫描最近两轮对话。'
      + '</div>'
      + '<div class="radar-manual-list">'
      + items.map((it) => '<div class="radar-manual-item">'
        + '<div class="manual-item-head">'
        + star
        + '<span class="manual-item-name">' + it.name + '</span>'
        + '<span class="wb-manual-code">' + escapeHtml(it.code) + '</span>'
        + '</div>'
        + '<p class="manual-item-desc">' + it.desc + '</p>'
        + '</div>').join('')
      + '</div>'
      + '</div>';
  }

  function entryCardHtml(entry, index) {
    const isKeyword = entry.mode === 'keyword';
    const posItem = findPosition(entry.position);
    const isDepth = posItem.value === 'depth';
    // 深度注入与注入角色仅在有完整对话流的分类可用
    const allowDepth = allowsDepth();
    const depthVal = Math.min(10, Math.max(0, parseInt(entry.depth, 10) || 0));
    const roleItem = findRole(entry.role);

    return '<div class="wb-entry-card" data-entry-id="' + escapeHtml(entry.id) + '">'
      // 头部：序号 + 标题 + 启用开关 + 删除
      + '<div class="wb-entry-head">'
      + '<div class="wb-entry-head-left">'
      + '<span class="api-card-tag">' + String(index + 1).padStart(2, '0') + '</span>'
      + '<input class="wb-entry-title-input" type="text" data-field="title" value="'
      + escapeHtml(entry.title || '') + '" placeholder="输入条目标题…">'
      + '</div>'
      + '<div class="wb-entry-head-actions">'
      + '<label class="theme-switch-wrap" title="启用/禁用此条目">'
      + '<input type="checkbox" class="theme-switch-input" data-field="enabled"'
      + (entry.enabled !== false ? ' checked' : '') + '>'
      + '<span class="theme-switch-track"><span class="theme-switch-thumb"></span></span>'
      + '</label>'
      + '<button type="button" class="wb-entry-del-btn" title="删除条目" aria-label="删除条目">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true">' + SVG_TRASH + '</svg>'
      + '</button>'
      + '</div>'
      + '</div>'

      // 触发模式
      + '<div class="api-field-group">'
      + '<div class="api-field-label-row">'
      + '<span class="api-field-label">TRIGGER MODE // 触发模式</span>'
      + '</div>'
      + '<div class="wb-segmented-row">'
      + '<button type="button" class="wb-segmented-btn' + (isKeyword ? '' : ' active')
      + '" data-mode="constant">常驻启用</button>'
      + '<button type="button" class="wb-segmented-btn' + (isKeyword ? ' active' : '')
      + '" data-mode="keyword">关键词触发</button>'
      + '</div>'
      + '</div>'

      // 关键词组（含填写说明抽屉与校验回显）
      + '<div class="api-field-group wb-keyword-group' + (isKeyword ? '' : ' wb-field-disabled') + '">'
      + '<div class="api-field-label-row">'
      + '<label class="api-field-label">KEYWORDS // 触发关键词</label>'
      + '<button type="button" class="psych-help-circle-btn wb-keys-help-btn"'
      + ' aria-label="查看关键词填写说明" title="查看关键词填写说明">'
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<circle cx="12" cy="12" r="10"/>'
      + '<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>'
      + '<path d="M12 17h.01"/>'
      + '</svg>'
      + '</button>'
      + '</div>'
      + manualDrawerHtml()
      + '<div class="api-input-wrap">'
      + '<input class="api-input" type="text" data-field="keys" value="'
      + escapeHtml(entry.keys || '')
      + '" placeholder="例如：破限, /解.{0,3}构/i" autocomplete="off" spellcheck="false">'
      + '</div>'
      + '<div class="wb-keys-validate" hidden></div>'
      + '</div>'

      // 注入位置
      + '<div class="api-field-group">'
      + '<div class="api-field-label-row">'
      + '<label class="api-field-label">INJECTION POSITION // 注入位置</label>'
      + '<span class="api-field-hint">点击切换</span>'
      + '</div>'
      + '<div class="api-input-wrap clickable wb-pos-trigger" role="button" tabindex="0"'
      + ' title="点击选择注入位置" data-pos="' + escapeHtml(posItem.value) + '">'
      + '<span class="api-input-prefix">POS</span>'
      + '<input type="text" class="api-input clickable-input wb-pos-input" value="'
      + escapeHtml(posItem.label) + '" readonly autocomplete="off">'
      + '<svg class="wb-select-arrow" viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M7 10l5 5 5-5z"/></svg>'
      + '</div>'
      + '</div>'

      // 注入深度滑条（仅助手分类且选中深度注入时显示）
      + (allowDepth
        ? '<div class="api-field-group wb-depth-group"' + (isDepth ? '' : ' hidden') + '>'
        + '<div class="api-slider-head">'
        + '<div class="api-param-info">'
        + '<span class="api-param-name">INJECTION DEPTH</span>'
        + '<span class="api-param-zh">注入深度 (0 紧随最新消息 ~ 10 上溯十条)</span>'
        + '</div>'
        + '<span class="api-param-num wb-depth-display">' + depthVal + '</span>'
        + '</div>'
        + '<input type="range" class="theme-slider api-slider wb-depth-slider" data-field="depth"'
        + ' min="0" max="10" step="1" value="' + depthVal + '">'
        + '</div>'
        : '')

      // 注入角色（仅助手分类且选中深度注入时显示）
      + (allowDepth
        ? '<div class="api-field-group wb-role-group"' + (isDepth ? '' : ' hidden') + '>'
        + '<div class="api-field-label-row">'
        + '<label class="api-field-label">INJECTION ROLE // 注入角色</label>'
        + '<span class="api-field-hint">点击切换</span>'
        + '</div>'
        + '<div class="api-input-wrap clickable wb-role-trigger" role="button" tabindex="0"'
        + ' title="点击选择注入角色" data-role="' + escapeHtml(roleItem.value) + '">'
        + '<span class="api-input-prefix">ROLE</span>'
        + '<input type="text" class="api-input clickable-input wb-role-input" value="'
        + escapeHtml(roleItem.label) + '" readonly autocomplete="off">'
        + '<svg class="wb-select-arrow" viewBox="0 0 24 24" aria-hidden="true">'
        + '<path d="M7 10l5 5 5-5z"/></svg>'
        + '</div>'
        + '</div>'
        : '')

      // 条目内容（支持全屏沉浸编辑）
      + '<div class="api-field-group">'
      + '<div class="api-field-label-row">'
      + '<label class="api-field-label">CONTENT // 条目内容</label>'
      + '<div class="api-field-actions">'
      + '<button type="button" class="field-expand-btn wb-content-expand-btn"'
      + ' title="全屏沉浸编辑" aria-label="全屏编辑条目内容">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>'
      + '</svg>'
      + '<span>全屏</span>'
      + '</button>'
      + '</div>'
      + '</div>'
      + '<textarea class="wb-textarea" rows="4" data-field="content"'
      + ' placeholder="在此输入条目规则提示词内容…（支持双击全屏编辑）">' + escapeHtml(entry.content || '') + '</textarea>'
      + '</div>'

      + '</div>';
  }

  /** 编辑页绑定区回显：角色绑定（线上 + 副本）+ 副本绑定（仅副本分类） */
  function renderBindField(book) {
    // --- 角色绑定 ---
    if (bindGroup) {
      const show = allowsBind(book.category);
      bindGroup.hidden = !show;
      if (show) {
        const { names, missing } = resolveBindNames(book);
        const total = names.length + missing;

        if (bindInput) {
          bindInput.value = total === 0
            ? '全部角色'
            : ('已绑定 ' + total + ' 个角色');
        }

        if (bindChipRow) {
          if (total === 0) {
            bindChipRow.hidden = true;
            bindChipRow.innerHTML = '';
          } else {
            bindChipRow.hidden = false;
            bindChipRow.innerHTML = names.map((n) => '<span class="wb-bind-chip">'
              + escapeHtml(n) + '</span>').join('')
              + (missing > 0
                ? '<span class="wb-bind-chip is-lost">档案失效 ' + missing + '</span>'
                : '');
          }
        }
      }
    }

    // --- 副本绑定（仅副本分类） ---
    if (bindForkGroup) {
      const showFork = book.category === 'instance';
      bindForkGroup.hidden = !showFork;
      if (showFork) {
        const forkIds = Array.isArray(book.bindForkIds) ? book.bindForkIds.filter(Boolean) : [];
        const forkNames = [];
        let forkMissing = 0;
        const forks = (window.Store && Store.fork && Array.isArray(Store.fork.index)) ? Store.fork.index : [];
        forkIds.forEach((fid) => {
          const hit = forks.find((f) => f && String(f.id) === String(fid));
          if (hit) forkNames.push(hit.title || hit.name || '未命名副本');
          else forkMissing += 1;
        });
        const forkTotal = forkNames.length + forkMissing;

        if (bindForkInput) {
          bindForkInput.value = forkTotal === 0
            ? '全部副本'
            : ('已绑定 ' + forkTotal + ' 个副本');
        }

        if (bindForkChipRow) {
          if (forkTotal === 0) {
            bindForkChipRow.hidden = true;
            bindForkChipRow.innerHTML = '';
          } else {
            bindForkChipRow.hidden = false;
            bindForkChipRow.innerHTML = forkNames.map((n) => '<span class="wb-bind-chip">'
              + escapeHtml(n) + '</span>').join('')
              + (forkMissing > 0
                ? '<span class="wb-bind-chip is-lost">副本失效 ' + forkMissing + '</span>'
                : '');
          }
        }
      }
    }
  }

  /** 打开角色绑定多选面板 */
  async function pickBindRoster() {
    const book = findBook(editingBookId);
    if (!book) return;
    if (!window.SelectModal || typeof SelectModal.pickMulti !== 'function') return;

    const pool = rosterPool();
    // 没有可绑档案时直接不开面板：空面板本身就说明了情况，不必再弹提示
    if (pool.length === 0) return;

    const picked = await SelectModal.pickMulti({
      title: '绑定角色',
      tag: 'BIND // 作用范围',
      options: pool.map((p) => ({ value: p.id, label: p.name, group: p.group })),
      values: bindIdsOf(book),
      confirmText: '确认绑定',
      searchable: pool.length > 8
    });
    // 取消返回 null，此时什么都不动；确认返回数组（可以是空数组＝清空绑定）
    if (!Array.isArray(picked)) return;

    book.bindRosterIds = picked;
    await persist();
    renderBindField(book);
  }

  /** 打开副本绑定多选面板 */
  async function pickBindFork() {
    const book = findBook(editingBookId);
    if (!book) return;
    if (!window.SelectModal || typeof SelectModal.pickMulti !== 'function') return;

    const forks = (window.Store && Store.fork && Array.isArray(Store.fork.index)) ? Store.fork.index : [];
    const pool = forks.filter((f) => f && f.id).map((f) => ({
      value: String(f.id),
      label: f.title || f.name || '未命名副本'
    }));
    if (pool.length === 0) return;

    const current = Array.isArray(book.bindForkIds) ? book.bindForkIds.filter(Boolean).map(String) : [];
    const picked = await SelectModal.pickMulti({
      title: '绑定副本',
      tag: 'BIND // 作用范围',
      options: pool,
      values: current,
      confirmText: '确认绑定',
      searchable: pool.length > 8
    });
    if (!Array.isArray(picked)) return;

    book.bindForkIds = picked;
    await persist();
    renderBindField(book);
  }

  function renderEditView() {
    const book = findBook(editingBookId);
    if (!book) return;

    const locked = isBuiltin(book.id);

    if (nameInput) {
      nameInput.value = book.name || '';
      nameInput.readOnly = locked;
      if (locked) {
        nameInput.classList.add('wb-readonly');
      } else {
        nameInput.classList.remove('wb-readonly');
      }
    }
    if (descInput) descInput.value = book.desc || '';
    if (editTitleEl) editTitleEl.textContent = book.name || '世界书编辑';
    renderBindField(book);

    if (!entriesContainer) return;
    const entries = Array.isArray(book.entries) ? book.entries : [];

    if (entries.length === 0) {
      entriesContainer.innerHTML = '<div class="api-node-empty">暂无条目<br>点击上方「添加条目」录入规则</div>';
      return;
    }
    entriesContainer.innerHTML = entries.map((e, i) => entryCardHtml(e, i)).join('');

    // 关键词模式的卡片进入即回显识别结果
    entriesContainer.querySelectorAll('.wb-entry-card').forEach((card) => {
      const active = card.querySelector('.wb-segmented-btn[data-mode].active');
      if (active && active.dataset.mode === 'keyword') renderKeysValidation(card);
    });
  }

  /* ================= 层级切换 ================= */

  function openBook(bookId) {
    const book = findBook(bookId);
    if (!book || !listView || !editView) return;
    editingBookId = bookId;
    currentLayer = 'edit';

    renderEditView();

    listView.hidden = true;
    editView.hidden = false;

    const scroller = editView.querySelector('.settings-body-scroll');
    if (scroller) scroller.scrollTop = 0;

    // 编辑层压入独立历史桩，使列表层与编辑层各持一层，返回逻辑对称
    try {
      history.pushState({ rfPage: 'worldbook', wbLayer: 'edit' }, '', '#worldbook/edit');
    } catch (_) {}
  }

  function backToList(fromPopState = false) {
    if (!listView || !editView) return;
    flushPersist();

    const wasEdit = currentLayer === 'edit';
    currentLayer = 'list';
    editingBookId = null;

    editView.hidden = true;
    listView.hidden = false;
    renderList();

    // 非 popstate（UI 返回键 / ESC）触发时，消费掉编辑层历史桩退回列表层
    if (!fromPopState && wasEdit && (window.location.hash || '') === '#worldbook/edit') {
      try {
        history.back();
      } catch (_) {}
    }
  }

  /* ================= 书本增删 ================= */

  async function createBook(category) {
    const book = {
      id: makeId('wb'),
      category: category,
      name: '未命名世界书',
      desc: '',
      active: true,
      bindRosterIds: [],
      entries: []
    };
    getBooks().push(book);
    await persist();
    renderList();
    openBook(book.id);
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }

  async function deleteBook(bookId) {
    const books = getBooks();
    const idx = books.findIndex((b) => b && b.id === bookId);
    if (idx < 0) return;
    const name = books[idx].name || '未命名世界书';

    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: 'WORLDBOOK // 删除世界书',
        title: '删除世界书',
        message: '确认要删除世界书「' + name + '」吗？',
        detail: '书内包含的所有规则条目将被同时清除，无法撤销。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    books.splice(idx, 1);
    await persist();
    renderList();
  }

  /**
   * 整本启用 / 停用。
   * 只影响注入，不动数据：停用后条目内容全部保留，重新启用即恢复。
   */
  async function toggleBook(bookId) {
    const book = findBook(bookId);
    if (!book) return;

    book.active = book.active === false;
    await persist();
    renderList();
  }

  /* ================= 条目增删改 ================= */

  function getEditingEntries() {
    const book = findBook(editingBookId);
    if (!book) return null;
    if (!Array.isArray(book.entries)) book.entries = [];
    return book.entries;
  }

  function findEntry(entryId) {
    const entries = getEditingEntries();
    if (!entries) return null;
    return entries.find((e) => e && e.id === entryId) || null;
  }

  async function addEntry() {
    const entries = getEditingEntries();
    if (!entries) return;
    entries.push({
      id: makeId('wbe'),
      title: '',
      enabled: true,
      mode: 'constant',
      keys: '',
      position: 'sys-top',
      depth: 0,
      role: 'system',
      content: ''
    });
    await persist();
    renderEditView();

    const cards = entriesContainer ? entriesContainer.querySelectorAll('.wb-entry-card') : [];
    const last = cards[cards.length - 1];
    if (last) {
      const input = last.querySelector('.wb-entry-title-input');
      if (input) input.focus();
      last.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  async function deleteEntry(entryId) {
    const entries = getEditingEntries();
    if (!entries) return;
    const idx = entries.findIndex((e) => e && e.id === entryId);
    if (idx < 0) return;
    const title = entries[idx].title ? '「' + entries[idx].title + '」' : '该条目';

    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      const ok = await RetroModal.confirm({
        tag: 'WORLDBOOK // 删除条目',
        title: '删除条目',
        message: '确认要删除条目' + title + '吗？',
        detail: '条目内容将被移除，无法撤销。',
        confirmText: '确认删除',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    entries.splice(idx, 1);
    await persist();
    renderEditView();
  }

  function updateEntryField(entryId, field, value) {
    const entry = findEntry(entryId);
    if (!entry) return;
    entry[field] = value;
    schedulePersist();
  }

  /** 关键词实时校验回显（依赖 KeyMatch.validate） */
  function renderKeysValidation(card) {
    const box = card.querySelector('.wb-keys-validate');
    const input = card.querySelector('[data-field="keys"]');
    if (!box || !input) return;

    const val = String(input.value || '').trim();
    if (!val || !window.KeyMatch || typeof KeyMatch.validate !== 'function') {
      box.hidden = true;
      box.textContent = '';
      return;
    }

    const items = KeyMatch.validate(val);
    const bad = items.filter((i) => !i.ok);

    box.hidden = false;
    if (bad.length === 0) {
      const counts = { text: 0, regex: 0, exact: 0 };
      items.forEach((i) => { counts[i.type] = (counts[i.type] || 0) + 1; });
      const parts = [];
      if (counts.text) parts.push(counts.text + ' 项文本');
      if (counts.regex) parts.push(counts.regex + ' 项正则');
      if (counts.exact) parts.push(counts.exact + ' 项精确');
      box.className = 'wb-keys-validate';
      box.textContent = '已识别 ' + parts.join(' · ');
    } else {
      box.className = 'wb-keys-validate is-error';
      box.textContent = bad.map((b) => b.token + ' → ' + b.error).join('；');
    }
  }

  /** 同步触发模式：常驻时置灰关键词整组 */
  function syncTriggerMode(card) {
    if (!card) return;
    const activeBtn = card.querySelector('.wb-segmented-btn[data-mode].active');
    const mode = activeBtn ? activeBtn.dataset.mode : 'constant';
    const kwGroup = card.querySelector('.wb-keyword-group');
    if (kwGroup) kwGroup.classList.toggle('wb-field-disabled', mode !== 'keyword');
  }

  /** 同步深度注入相关字段的显隐：只有选中深度注入时才露出深度与角色 */
  function syncDepthFields(card) {
    if (!card) return;
    const trigger = card.querySelector('.wb-pos-trigger');
    const isDepth = trigger && trigger.dataset.pos === 'depth';
    const depthGroup = card.querySelector('.wb-depth-group');
    const roleGroup = card.querySelector('.wb-role-group');
    if (depthGroup) depthGroup.hidden = !isDepth;
    if (roleGroup) roleGroup.hidden = !isDepth;
  }

  /** 打开条目内容的全屏文本编辑器（复用项目通用 TextEditorModal） */
  async function openEntryContentEditor(card) {
    if (!card) return;
    if (!window.TextEditorModal || typeof TextEditorModal.open !== 'function') return;

    const textarea = card.querySelector('textarea[data-field="content"]');
    const titleInput = card.querySelector('.wb-entry-title-input');
    const entryTitle = (titleInput && titleInput.value.trim()) || '未命名条目';
    const current = textarea ? textarea.value : '';

    const updated = await TextEditorModal.open({
      title: '条目内容编辑',
      tag: 'WORLDBOOK // ' + entryTitle,
      value: current,
      placeholder: '在此输入条目规则提示词内容…',
      maxLength: 8000
    });

    if (updated !== null && updated !== undefined && textarea) {
      textarea.value = updated;
      updateEntryField(card.dataset.entryId, 'content', updated);
    }
  }

  async function pickInjectionPosition(triggerEl) {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    const card = triggerEl.closest('.wb-entry-card');
    const options = positionOptions();

    const picked = await SelectModal.pick({
      title: '选择注入位置',
      tag: 'INJECTION // 注入策略',
      options: options,
      value: triggerEl.dataset.pos || 'sys-top',
      searchable: false
    });
    if (!picked) return;

    const item = options.find((p) => p.value === picked);
    if (!item) return;
    triggerEl.dataset.pos = picked;
    const input = triggerEl.querySelector('.wb-pos-input');
    if (input) input.value = item.label;
    if (card) updateEntryField(card.dataset.entryId, 'position', picked);
    syncDepthFields(card);
  }

  async function pickInjectionRole(triggerEl) {
    if (!window.SelectModal || typeof SelectModal.pick !== 'function') return;
    const card = triggerEl.closest('.wb-entry-card');

    const picked = await SelectModal.pick({
      title: '选择注入角色',
      tag: 'ROLE // 消息身份',
      options: INJECTION_ROLES,
      value: triggerEl.dataset.role || 'system',
      searchable: false
    });
    if (!picked) return;

    const item = findRole(picked);
    triggerEl.dataset.role = item.value;
    const input = triggerEl.querySelector('.wb-role-input');
    if (input) input.value = item.label;
    if (card) updateEntryField(card.dataset.entryId, 'role', item.value);
  }

  /* ================= 事件绑定 ================= */

  function bindListEvents() {
    if (!listView) return;
    listView.addEventListener('click', (e) => {
      // 新建世界书
      const addBtn = e.target.closest('[data-wb-add]');
      if (addBtn) {
        createBook(addBtn.dataset.wbAdd);
        return;
      }

      // 删除世界书（拦截，不进详情）
      const delBtn = e.target.closest('.wb-book-delete-btn');
      if (delBtn) {
        e.stopPropagation();
        const card = delBtn.closest('.wb-book-card');
        if (card) deleteBook(card.dataset.bookId);
        return;
      }

      // 启用开关（拦截，不进详情）
      const toggleBtn = e.target.closest('.wb-book-toggle');
      if (toggleBtn) {
        e.stopPropagation();
        toggleBook(toggleBtn.dataset.bookToggle);
        return;
      }

      const card = e.target.closest('.wb-book-card');
      if (card) openBook(card.dataset.bookId);
    });
  }

  function bindEditViewEvents() {
    if (editBackBtn) editBackBtn.addEventListener('click', backToList);
    if (addEntryBtn) addEntryBtn.addEventListener('click', addEntry);

    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        // 不弹全局 Toast：输入时已在自动落库，点保存只是把待写的防抖任务立刻冲掉。
        // 参考个人档案交互：按钮就地给 1s 的「已保存」内联微反馈，保留 SVG 图标。
        flushPersist();
        await persist();

        const textSpan = saveBtn.querySelector('span');
        if (textSpan && !saveBtn.dataset.savingFeedback) {
          saveBtn.dataset.savingFeedback = '1';
          const orig = textSpan.textContent;
          textSpan.textContent = '已保存';
          saveBtn.style.opacity = '0.75';
          setTimeout(() => {
            textSpan.textContent = orig;
            saveBtn.style.opacity = '';
            delete saveBtn.dataset.savingFeedback;
          }, 1000);
        }
      });
    }

    if (nameInput) {
      nameInput.addEventListener('input', () => {
        const book = findBook(editingBookId);
        if (!book) return;
        book.name = nameInput.value;
        if (editTitleEl) editTitleEl.textContent = nameInput.value || '世界书编辑';
        schedulePersist();
      });
    }

    if (descInput) {
      descInput.addEventListener('input', () => {
        const book = findBook(editingBookId);
        if (!book) return;
        book.desc = descInput.value;
        schedulePersist();
      });
    }

    if (bindTrigger) {
      bindTrigger.addEventListener('click', pickBindRoster);
      // 只读输入框走 role=button，键盘操作要自己接
      bindTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickBindRoster();
        }
      });
    }

    if (bindForkTrigger) {
      bindForkTrigger.addEventListener('click', pickBindFork);
      bindForkTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickBindFork();
        }
      });
    }

    if (!entriesContainer) return;

    // 点击类交互
    entriesContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.wb-entry-card');

      // 关键词填写说明抽屉
      const helpBtn = e.target.closest('.wb-keys-help-btn');
      if (helpBtn) {
        e.preventDefault();
        const drawer = card ? card.querySelector('.wb-keys-manual') : null;
        if (drawer) {
          const willShow = drawer.hidden;
          drawer.hidden = !willShow;
          helpBtn.classList.toggle('active', willShow);
        }
        return;
      }

      // 全屏沉浸编辑条目内容
      const expandBtn = e.target.closest('.wb-content-expand-btn');
      if (expandBtn && card) {
        openEntryContentEditor(card);
        return;
      }

      // 删除条目
      const delBtn = e.target.closest('.wb-entry-del-btn');
      if (delBtn && card) {
        deleteEntry(card.dataset.entryId);
        return;
      }

      // 注入位置
      const posTrigger = e.target.closest('.wb-pos-trigger');
      if (posTrigger) {
        pickInjectionPosition(posTrigger);
        return;
      }

      // 注入角色
      const roleTrigger = e.target.closest('.wb-role-trigger');
      if (roleTrigger) {
        pickInjectionRole(roleTrigger);
        return;
      }

      // 触发模式分段切换
      const segBtn = e.target.closest('.wb-segmented-btn');
      if (segBtn && card) {
        const row = segBtn.closest('.wb-segmented-row');
        if (!row) return;
        row.querySelectorAll('.wb-segmented-btn').forEach((b) => {
          b.classList.toggle('active', b === segBtn);
        });
        if (segBtn.dataset.mode) {
          syncTriggerMode(card);
          updateEntryField(card.dataset.entryId, 'mode', segBtn.dataset.mode);
          if (segBtn.dataset.mode === 'keyword') renderKeysValidation(card);
        }
      }
    });

    // 双击条目文本框全屏编辑
    entriesContainer.addEventListener('dblclick', (e) => {
      const textarea = e.target.closest('textarea[data-field="content"]');
      if (!textarea) return;
      const card = textarea.closest('.wb-entry-card');
      if (card) openEntryContentEditor(card);
    });

    // 文本输入类
    entriesContainer.addEventListener('input', (e) => {
      const field = e.target.dataset ? e.target.dataset.field : null;
      if (!field || field === 'enabled') return;
      const card = e.target.closest('.wb-entry-card');
      if (!card) return;

      // 深度滑条：存整数并同步右上角数值显示
      if (field === 'depth') {
        const depth = Math.min(10, Math.max(0, parseInt(e.target.value, 10) || 0));
        const display = card.querySelector('.wb-depth-display');
        if (display) display.textContent = String(depth);
        updateEntryField(card.dataset.entryId, 'depth', depth);
        return;
      }

      updateEntryField(card.dataset.entryId, field, e.target.value);
      if (field === 'keys') renderKeysValidation(card);
    });

    // 启用开关走 change
    entriesContainer.addEventListener('change', (e) => {
      if (!e.target.dataset || e.target.dataset.field !== 'enabled') return;
      const card = e.target.closest('.wb-entry-card');
      if (!card) return;
      updateEntryField(card.dataset.entryId, 'enabled', !!e.target.checked);
    });
  }

  function bindEvents() {
    if (!pageEl || bound) return;
    bound = true;

    if (backBtn) backBtn.addEventListener('click', () => close());

    // 右翼战术导轨点击切换与角标收折
    if (indexRail) {
      indexRail.addEventListener('click', (e) => {
        const toggleBtn = e.target.closest('.rail-notch-toggle-btn');
        if (toggleBtn) {
          e.stopPropagation();
          const isCollapsed = indexRail.classList.toggle('is-collapsed');
          toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
          if (bodyLayout) bodyLayout.classList.toggle('rail-collapsed', isCollapsed);
          return;
        }

        const bookmark = e.target.closest('.index-bookmark');
        if (!bookmark) return;
        const cat = bookmark.dataset.category;
        if (!cat || cat === currentCategory) return;
        switchCategory(cat);
      });
    }

    bindListEvents();
    bindEditViewEvents();

    // ESC 键回退（编辑层优先退回列表层）
    window.addEventListener('keydown', (e) => {
      if (isOpen && (e.key === 'Escape' || e.key === 'Esc')) {
        e.preventDefault();
        if (currentLayer === 'edit') backToList();
        else close();
      }
    });

    // popstate 回退：编辑层 -> 列表层 -> 关页，各层各持独立历史桩，逐级对称退回
    window.addEventListener('popstate', (e) => {
      if (!isOpen) return;
      const state = e.state || {};
      const inEditStub = state.rfPage === 'worldbook' && state.wbLayer === 'edit';
      const inListStub = state.rfPage === 'worldbook' && !state.wbLayer;

      // 弹出后仍停在编辑桩（前进键等边缘场景）：确保视图对齐编辑层，不处理
      if (inEditStub) return;

      // 弹出后落在列表桩：说明刚从编辑层退回，切回列表视图
      if (inListStub) {
        if (currentLayer === 'edit') backToList(true);
        return;
      }

      // 弹出后已离开 worldbook：正常关页
      close(true);
    });
  }

  function switchCategory(catId) {
    currentCategory = catId;

    if (indexRail) {
      indexRail.querySelectorAll('.index-bookmark').forEach((b) => {
        b.classList.toggle('active', b.dataset.category === catId);
      });
    }
    if (pageEl) {
      pageEl.querySelectorAll('.worldbook-pane').forEach((pane) => {
        pane.classList.toggle('active', pane.dataset.category === catId);
      });
    }
  }

  function open(category, opts) {
    if (!pageEl) initElements();
    bindEvents();
    if (isOpen) return;
    isOpen = true;

    // 跨页返回回调：从别的页面（如推演设置）跳进来时传入，关页时调它回到来源页。
    // 不传则按常规退栈返回上一层（桌面）。
    returnTarget = (opts && typeof opts.onReturn === 'function') ? opts.onReturn : null;

    if (category) currentCategory = category;

    switchCategory(currentCategory);
    // 初始化直接复位到列表视图，不走带 history 副作用的 backToList
    currentLayer = 'list';
    editingBookId = null;
    if (editView) editView.hidden = true;
    if (listView) listView.hidden = false;

    // 数据就绪后再播种内置书 + 渲染。
    //
    // 【关键】绝不能在 Store 未加载完成时 persist：那样会把内存里的初始空数组
    // 写回库，覆盖掉用户已有的世界书（这正是「世界书莫名消失」的成因）。
    // ensureBuiltinBooks 只有在数据确实加载后才允许触发写盘。
    const proceed = () => {
      if (window.Store && typeof Store.isLoaded === 'function' && Store.isLoaded()) {
        if (ensureBuiltinBooks()) persist();
      }
      renderList();
    };
    if (window.Store && typeof Store.load === 'function' && typeof Store.isLoaded === 'function' && !Store.isLoaded()) {
      // 数据尚未就绪：先渲染当前（可能为空）避免闪烁，等加载完再补种 + 重渲染
      renderList();
      Store.load().then(proceed).catch(() => renderList());
    } else {
      proceed();
    }

    pageEl.classList.add('active');
    pageEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.add('keyboard-hidden');

    try {
      history.pushState({ rfPage: 'worldbook' }, '', '#worldbook');
    } catch (_) {}
  }

  function close(fromPopState = false) {
    if (!isOpen) return;
    isOpen = false;

    // 关页前把未落盘的改动冲刷掉
    flushPersist();

    if (pageEl) {
      pageEl.classList.remove('active');
      pageEl.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('page-active');

    const dockBar = document.querySelector('.tactical-dock-bar');
    if (dockBar) dockBar.classList.remove('keyboard-hidden');

    // 跨页返回：若有来源回调，收起本页后回到来源页（如推演设置），不落回桌面
    const cb = returnTarget;
    returnTarget = null;

    // 世界书页是 pushState 新压一层（#worldbook）的模型：无论是否有来源回调，
    // 返回时都必须 history.back() 退掉这一层，把历史栈交还给来源页那一层。
    // 来源回调只做「视图复原」，绝不再碰 history（否则会多留一层，导致来源页
    // 返回时层数错乱、直接跳回桌面）。
    if (!fromPopState) {
      const hash = window.location.hash || '';
      if (hash === '#worldbook') {
        try {
          history.back();
        } catch (_) {
          window.location.hash = '';
        }
      }
    }

    if (typeof cb === 'function') {
      // 稍等本页退场，再叠回来源页，过渡更顺
      setTimeout(() => { try { cb(); } catch (_) {} }, fromPopState ? 0 : 60);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    initElements();
    bindEvents();
  });

  return {
    open,
    close,
    switchCategory,
    openBook,
    backToList,
    addEntry,
    renderList,
    isBuiltin,
    BUILTIN_BOOKS,
    CATEGORIES,
    INJECTION_POSITIONS
  };
})();

window.WorldBookUI = WorldBookUI;
