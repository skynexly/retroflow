/**
 * 溯流计划 · 世界书战术装载面板 (WorldBook Tactical Mount Modal)
 *
 * 职责：
 *   1. 在推演/助手/私聊现场，展示当前作用域可吃到的世界书（全局 + 指定分类，过 inScope 绑定过滤）；
 *   2. 手风琴结构：整书开关 + 展开后条目级开关 + 编纂跳转；
 *   3. 会话级黑名单覆写（disabledBookIds / disabledEntryIds），默认全放行。
 *      世界书库新增条目/新书无需重勾，自动生效——只记录「显式关闭」的 id。
 *
 * 设计要点：
 *   - 不改世界书库本身（book.active / entry.enabled 不动），只写调用方的会话覆写；
 *   - 开关变动实时回调 onChange(overrides)，由调用方负责落库（如写进 run）；
 *   - 通用：categoryScope 传 'instance'/'assistant'/'online'，scope 传绑定作用域，
 *     三个场景（副本/助手/私聊）直接复用。
 *
 * 严格遵守《工地施工协议》：纯 SVG 图标、零 Emoji、零物理分割线、全量 CSS 变量。
 *
 * 用法：
 *   WorldBookMountModal.open({
 *     categoryScope: 'instance',              // 除全局外，还纳入哪个分类
 *     scope: { forkId, rosterIds },           // 书本级绑定过滤作用域（可选）
 *     overrides: { disabledBookIds, disabledEntryIds },  // 当前会话已有的黑名单
 *     onChange: (overrides) => { ... },       // 每次开关变动实时回调（调用方落库）
 *     onEditBook: (bookId, category) => { ... } // 点「编纂」按钮的跳转回调（可选）
 *   });
 */
window.WorldBookMountModal = (() => {
  'use strict';

  const SVG_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>';

  // 分类标签映射（展示用）
  const CAT_LABELS = {
    global: 'GLOBAL',
    assistant: 'ASSISTANT',
    online: 'ONLINE',
    instance: 'INSTANCE',
    generation: 'GENERATION'
  };

  let overlay = null;
  let listEl = null;
  let emptyEl = null;
  let summaryText = null;
  let closeBtn = null;
  let titleEl = null;
  let editAllBtn = null;
  let inited = false;

  // 当前会话上下文
  let ctx = null;
  // 展开态记录（bookId → bool），仅本次面板生命周期内有效
  let expandedSet = null;

  function trimStr(v) {
    return typeof v === 'string' ? v.trim() : '';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }
function initDOM() {
    if (inited) return;
    overlay = document.getElementById('wbMountOverlay');
    if (!overlay) return;
    listEl = document.getElementById('wbMountList');
    emptyEl = document.getElementById('wbMountEmpty');
    summaryText = document.getElementById('wbMountSummaryText');
    closeBtn = document.getElementById('wbMountCloseBtn');
    titleEl = document.getElementById('wbMountTitle');
    editAllBtn = document.getElementById('wbMountEditAllBtn');

    // 统一事件委托：所有点击都挂在 overlay（静态骨架，必然存在）上，靠 closest 分派。
    // 相比给每个子节点单独 addEventListener，这样只需一个必定成功的监听器，
    // 杜绝「某个子节点引用时机不对导致监听器永久缺失」的脆弱路径。
    overlay.addEventListener('click', (e) => {
      // 关闭按钮
      if (e.target.closest('#wbMountCloseBtn')) { close(); return; }
      // 前往世界书编辑
      if (e.target.closest('#wbMountEditAllBtn')) {
        const cb = ctx && ctx.onEditBook;
        close();
        if (typeof cb === 'function') cb();
        return;
      }
      // 列表内交互（整书开关 / 条目开关 / 展开折叠）
      if (e.target.closest('#wbMountList')) { onListClick(e); return; }
      // 点遮罩空白关闭
      if (e.target === overlay) { close(); return; }
    });

    inited = true;
  }


  /** 从 Store 取当前作用域内的书（全局 + 指定分类，过 inScope 绑定过滤） */
  function collectBooks() {
    const all = (window.Store && Store.worldbook && Array.isArray(Store.worldbook.books))
      ? Store.worldbook.books : [];
    const cats = ['global'];
    if (ctx.categoryScope && ctx.categoryScope !== 'global') cats.push(ctx.categoryScope);
    const engine = window.WorldBookEngine;
    return all.filter((b) => {
      if (!b || cats.indexOf(b.category) < 0) return false;
      // 书本级绑定过滤：绑了角色/副本的书，作用域不匹配就不在本场景展示
      if (engine && typeof engine.inScope === 'function' && ctx.scope) {
        if (!engine.inScope(b, ctx.scope)) return false;
      }
      return true;
    });
  }

  /** 某本书在本会话是否被显式关闭 */
  function isBookOff(bookId) {
    return ctx.overrides.disabledBookIds.indexOf(bookId) >= 0;
  }

  /** 某条目在本会话是否被显式关闭 */
  function isEntryOff(entryId) {
    return ctx.overrides.disabledEntryIds.indexOf(entryId) >= 0;
  }

  /** 条目模式标签文案 */
  function entryModeLabel(entry) {
    if (entry.mode === 'keyword') {
      const keys = trimStr(entry.keys);
      return keys ? ('关键词: ' + keys.slice(0, 18) + (keys.length > 18 ? '…' : '')) : '关键词';
    }
    if (entry.position === 'depth') {
      const d = parseInt(entry.depth, 10);
      return '深度 ' + (Number.isFinite(d) ? d : 0);
    }
    return '常驻';
  }

  /** 条目显示标题：没起名时截取正文前段 */
  function entryTitle(entry) {
    const t = trimStr(entry.title);
    if (t) return t;
    const c = trimStr(entry.content);
    return c ? (c.slice(0, 16) + (c.length > 16 ? '…' : '')) : '未命名条目';
  }

  function switchHtml(on, dataAttr) {
    return '<label class="wb-mount-switch" ' + dataAttr + '>'
      + '<input type="checkbox"' + (on ? ' checked' : '') + '>'
      + '<span class="wb-mount-switch-slider"></span>'
      + '</label>';
  }

  function render() {
    if (!listEl) return;
    const books = collectBooks();

    if (books.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) emptyEl.hidden = false;
      updateSummary(0, 0, 0, 0);
      return;
    }
    if (emptyEl) emptyEl.hidden = true;

    let activeBooks = 0;
    let totalEntries = 0;
    let activeEntries = 0;

    const html = books.map((book) => {
      const bookOn = book.active !== false && !isBookOff(book.id);
      if (bookOn) activeBooks++;

      const entries = Array.isArray(book.entries) ? book.entries : [];
      const catLabel = CAT_LABELS[book.category] || (book.category || '').toUpperCase();
      const builtin = window.WorldBookUI && typeof WorldBookUI.isBuiltin === 'function'
        && WorldBookUI.isBuiltin(book.id);
      const expanded = expandedSet.has(book.id);

      // 条目行
      const entryRows = entries.map((entry) => {
        if (!entry || !entry.id) return '';
        totalEntries++;
        const eOn = entry.enabled !== false && !isEntryOff(entry.id) && bookOn;
        if (entry.enabled !== false && !isEntryOff(entry.id)) activeEntries++;
        return '<div class="wb-mount-entry-row' + (eOn ? '' : ' is-off') + '">'
          + '<div class="wb-mount-entry-info">'
          + '<span class="wb-mount-entry-mode">' + escapeHtml(entryModeLabel(entry)) + '</span>'
          + '<span class="wb-mount-entry-title">' + escapeHtml(entryTitle(entry)) + '</span>'
          + '</div>'
          + switchHtml(entry.enabled !== false && !isEntryOff(entry.id),
              'data-entry-toggle="' + escapeHtml(entry.id) + '"')
          + '</div>';
      }).join('');

      return '<div class="wb-mount-book' + (bookOn ? '' : ' is-off')
        + (expanded ? ' is-expanded' : '') + '" data-book-id="' + escapeHtml(book.id) + '">'
        // 书本头
        + '<div class="wb-mount-book-head">'
        + '<button type="button" class="wb-mount-book-main" data-book-expand="' + escapeHtml(book.id) + '">'
        + '<span class="wb-mount-book-chevron">' + SVG_CHEVRON + '</span>'
        + '<span class="wb-mount-book-textwrap">'
        + '<span class="wb-mount-book-name">' + escapeHtml(book.name || '未命名世界书')
        + (builtin ? '<span class="wb-mount-tag wb-mount-tag-builtin">内置</span>' : '')
        + '<span class="wb-mount-tag">' + escapeHtml(catLabel) + '</span>'
        + '</span>'
        + '<span class="wb-mount-book-count">' + entries.length + ' 条规则</span>'
        + '</span>'
        + '</button>'
        + '<div class="wb-mount-book-actions">'
        + switchHtml(bookOn, 'data-book-toggle="' + escapeHtml(book.id) + '"')
        + '</div>'
        + '</div>'
        // 条目抽屉
        + '<div class="wb-mount-entries">' + (entryRows || '<div class="wb-mount-entry-empty">此书暂无条目</div>') + '</div>'
        + '</div>';
    }).join('');

    listEl.innerHTML = html;
    updateSummary(activeBooks, books.length, activeEntries, totalEntries);
  }

  /** 局部刷新顶部统计，无需重绘列表 */
  function refreshSummary() {
    const books = collectBooks();
    let activeBooks = 0;
    let totalEntries = 0;
    let activeEntries = 0;
    books.forEach((book) => {
      const bookOn = book.active !== false && !isBookOff(book.id);
      if (bookOn) activeBooks++;
      const entries = Array.isArray(book.entries) ? book.entries : [];
      entries.forEach((entry) => {
        if (!entry || !entry.id) return;
        totalEntries++;
        if (entry.enabled !== false && !isEntryOff(entry.id) && bookOn) {
          activeEntries++;
        }
      });
    });
    updateSummary(activeBooks, books.length, activeEntries, totalEntries);
  }

  function updateSummary(activeBooks, totalBooks, activeEntries, totalEntries) {
    if (!summaryText) return;
    const scopeLabel = ctx.categoryScope
      ? ('全局 + ' + (CAT_LABELS[ctx.categoryScope] || ctx.categoryScope))
      : '全局';
    summaryText.textContent = 'SCOPE ' + scopeLabel
      + ' · 书 ' + activeBooks + '/' + totalBooks
      + ' · 条目 ' + activeEntries + '/' + totalEntries;
  }

  /** 把改动通过回调交给调用方落库 */
  function emitChange() {
    if (ctx && typeof ctx.onChange === 'function') {
      ctx.onChange({
        disabledBookIds: ctx.overrides.disabledBookIds.slice(),
        disabledEntryIds: ctx.overrides.disabledEntryIds.slice()
      });
    }
  }

  function toggleInArray(arr, id) {
    const i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
  }

  /** 幂等设置：off=true 时确保 id 在黑名单里，off=false 时确保移除。可被重复调用而不翻转。 */
  function setDisabled(arr, id, off) {
    const i = arr.indexOf(id);
    if (off) {
      if (i < 0) arr.push(id);
    } else if (i >= 0) {
      arr.splice(i, 1);
    }
  }

  function onListClick(e) {
    // 整书开关：局部更新，绝不全量 render() 重绘 DOM，
    // 使得 CSS 的 0.22s 滑块位移 + 颜色反转动画能够丝滑走完全程。
    const bookToggle = e.target.closest('[data-book-toggle]');
    if (bookToggle) {
      const bookId = bookToggle.dataset.bookToggle;
      const input = bookToggle.querySelector('input[type="checkbox"]');
      const bookCard = bookToggle.closest('.wb-mount-book');
      setTimeout(() => {
        const on = !!(input && input.checked);
        setDisabled(ctx.overrides.disabledBookIds, bookId, !on);
        if (bookCard) {
          bookCard.classList.toggle('is-off', !on);
          // 整书关闭时，其下所有条目行一并置灰；整书开启时，按各条目自身 checkbox 状态复原
          bookCard.querySelectorAll('.wb-mount-entry-row').forEach((row) => {
            const entryToggle = row.querySelector('[data-entry-toggle]');
            const entryInput = entryToggle && entryToggle.querySelector('input[type="checkbox"]');
            const entryChecked = entryInput ? entryInput.checked : true;
            row.classList.toggle('is-off', !on || !entryChecked);
          });
        }
        emitChange();
        refreshSummary();
      }, 0);
      return;
    }

    // 条目开关：同样局部更新，保留滑块物理弹性与平滑动效
    const entryToggle = e.target.closest('[data-entry-toggle]');
    if (entryToggle) {
      const entryId = entryToggle.dataset.entryToggle;
      const input = entryToggle.querySelector('input[type="checkbox"]');
      const entryRow = entryToggle.closest('.wb-mount-entry-row');
      const bookCard = entryToggle.closest('.wb-mount-book');
      const bookId = bookCard && bookCard.dataset.bookId;
      const bookOn = bookId ? !isBookOff(bookId) : true;
      setTimeout(() => {
        const on = !!(input && input.checked);
        setDisabled(ctx.overrides.disabledEntryIds, entryId, !on);
        if (entryRow) {
          entryRow.classList.toggle('is-off', !on || !bookOn);
        }
        emitChange();
        refreshSummary();
      }, 0);
      return;
    }

    // 展开/折叠：局部切换 is-expanded 类，箭头平滑旋转，抽屉顺滑展开，绝不重刷 DOM
    const expandBtn = e.target.closest('[data-book-expand]');
    if (expandBtn) {
      const bookId = expandBtn.dataset.bookExpand;
      const bookCard = expandBtn.closest('.wb-mount-book');
      if (expandedSet.has(bookId)) {
        expandedSet.delete(bookId);
        if (bookCard) bookCard.classList.remove('is-expanded');
      } else {
        expandedSet.add(bookId);
        if (bookCard) bookCard.classList.add('is-expanded');
      }
      return;
    }
  }

  /**
   * 打开装载面板。
   * @param {Object} opts 见文件头用法说明
   */
  function open(opts) {
    initDOM();
    if (!overlay) return;

    const o = opts || {};
    const ov = (o.overrides && typeof o.overrides === 'object') ? o.overrides : {};
    ctx = {
      categoryScope: trimStr(o.categoryScope),
      scope: (o.scope && typeof o.scope === 'object') ? o.scope : null,
      overrides: {
        disabledBookIds: Array.isArray(ov.disabledBookIds) ? ov.disabledBookIds.slice() : [],
        disabledEntryIds: Array.isArray(ov.disabledEntryIds) ? ov.disabledEntryIds.slice() : []
      },
      onChange: typeof o.onChange === 'function' ? o.onChange : null,
      onEditBook: typeof o.onEditBook === 'function' ? o.onEditBook : null
    };
    expandedSet = new Set();

    if (titleEl && o.title) titleEl.textContent = o.title;

    render();

    overlay.hidden = false;
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-open');
    setTimeout(() => {
      if (overlay && !overlay.classList.contains('is-open')) overlay.hidden = true;
    }, 220);
    ctx = null;
    expandedSet = null;
  }

  return { open, close };
})();
