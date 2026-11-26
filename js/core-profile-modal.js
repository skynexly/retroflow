/**
 * ============================================================================
 * 溯流计划 · 核心档案弹窗控制器 (Core Profile Modal)
 * ============================================================================
 * 职责：
 *   1. 控制弹窗：统计、查看档案、提取一批、设置（条数/字数上限）、
 *      自动提取（即将推出）、恢复备份、重置提取进度
 *   2. 全屏编辑页：按六个板块分格展示，逐条增删改，保存时拼回标准格式
 * 依赖（运行期按需取 window 上的模块）：
 *   AssistantProfileStore / AssistantProfileParser / AssistantProfileExtractor
 *   RetroModal / RetroToast
 * ============================================================================
 */
const CoreProfileModal = (() => {
  'use strict';

  const TOAST_TAG = 'PROFILE 核心档案';

  const ICON_REMOVE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
  const ICON_ADD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';

  let els = null;
  let isOpen = false;
  let isProcessing = false;

  /** 编辑页状态 */
  let editorOpen = false;
  let editorDirty = false;
  let editorMaxChars = 0;

  /* ======================= 依赖 ======================= */

  function win() { return typeof window !== 'undefined' ? window : {}; }
  function store() { return win().AssistantProfileStore || null; }
  function parser() { return win().AssistantProfileParser || null; }
  function extractor() { return win().AssistantProfileExtractor || null; }
  function retroModal() { return win().RetroModal || null; }
  function retroToast() { return win().RetroToast || null; }

  function depsReady() {
    return Boolean(store() && parser() && extractor());
  }

  async function alertMsg(message, detail, danger) {
    const modal = retroModal();
    if (modal && typeof modal.alert === 'function') {
      await modal.alert({ message, detail: detail || '', confirmText: '知道了', danger: Boolean(danger) });
    } else {
      console.warn('[CoreProfileModal]', message, detail || '');
    }
  }

  async function confirmMsg(message, detail, confirmText, danger) {
    const modal = retroModal();
    if (!modal || typeof modal.confirm !== 'function') return true;
    return await modal.confirm({ message, detail, confirmText, cancelText: '取消', danger: Boolean(danger) });
  }

  function toastShow(message, detail, type, duration) {
    const toast = retroToast();
    if (toast && typeof toast.show === 'function') {
      toast.show({ tag: TOAST_TAG, message, detail: detail || '', type: type || 'info', duration: duration || 2600 });
    }
  }

  function toastDismiss() {
    const toast = retroToast();
    if (toast && typeof toast.dismiss === 'function') toast.dismiss();
  }

  function formatTime(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  /* ======================= DOM 初始化 ======================= */

  function initDOM() {
    const $ = (id) => document.getElementById(id);
    const overlay = $('coreProfileModalOverlay');
    const editor = $('coreProfileEditorPage');
    if (!overlay || !editor) return false;

    els = {
      overlay,
      closeBtn: $('coreProfileCloseBtn'),
      statPending: $('coreProfileStatPending'),
      statAbsorbed: $('coreProfileStatAbsorbed'),
      statChars: $('coreProfileStatChars'),
      viewBtn: $('coreProfileViewBtn'),
      extractBtn: $('coreProfileExtractBtn'),
      batchInput: $('coreProfileBatchInput'),
      charsInput: $('coreProfileCharsInput'),
      eventsInput: $('coreProfileEventsInput'),
      batchRange: $('coreProfileBatchRange'),
      charsRange: $('coreProfileCharsRange'),
      eventsRange: $('coreProfileEventsRange'),
      backupInfo: $('coreProfileBackupInfo'),
      restoreBtn: $('coreProfileRestoreBtn'),
      resetBtn: $('coreProfileResetBtn'),
      editor,
      editorBack: $('coreProfileEditorBack'),
      editorSave: $('coreProfileEditorSave'),
      editorCount: $('coreProfileEditorCount'),
      editorBody: $('coreProfileEditorBody')
    };

    const s = store();
    if (s) {
      els.batchInput.min = String(s.BATCH_MIN);
      els.batchInput.max = String(s.BATCH_MAX);
      els.charsInput.min = String(s.CHARS_MIN);
      els.charsInput.max = String(s.CHARS_MAX);
      els.eventsInput.min = String(s.EVENTS_MIN);
      els.eventsInput.max = String(s.EVENTS_MAX);
      els.batchRange.textContent = `${s.BATCH_MIN}~${s.BATCH_MAX}`;
      els.charsRange.textContent = `${s.CHARS_MIN}~${s.CHARS_MAX}`;
      els.eventsRange.textContent = `${s.EVENTS_MIN}~${s.EVENTS_MAX}`;
    }

    els.closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    els.viewBtn.addEventListener('click', handleView);
    els.extractBtn.addEventListener('click', handleExtract);
    els.restoreBtn.addEventListener('click', handleRestore);
    els.resetBtn.addEventListener('click', handleReset);
    els.batchInput.addEventListener('change', () => handleSettingChange('batchSize', els.batchInput));
    els.charsInput.addEventListener('change', () => handleSettingChange('maxChars', els.charsInput));
    els.eventsInput.addEventListener('change', () => handleSettingChange('maxEvents', els.eventsInput));

    els.editorBack.addEventListener('click', handleEditorBack);
    els.editorSave.addEventListener('click', handleEditorSave);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (editorOpen) handleEditorBack();
      else if (isOpen) close();
    });

    return true;
  }

  function ensureDOM() {
    if (els) return true;
    if (initDOM()) return true;
    console.warn('[CoreProfileModal] 弹窗 DOM 未找到');
    return false;
  }

  /* ======================= 控制弹窗 ======================= */

  async function open() {
    if (!ensureDOM()) return;
    if (!depsReady()) {
      await alertMsg('核心档案模块未加载', '请重启应用后再试。', true);
      return;
    }
    isOpen = true;
    els.overlay.hidden = false;
    await refresh();
  }

  function close() {
    if (!els) return;
    isOpen = false;
    els.overlay.hidden = true;
  }

  /** 刷新统计、设置与备份信息 */
  async function refresh() {
    if (!els || !depsReady()) return;
    let doc;
    try {
      doc = await store().load();
    } catch (err) {
      els.statPending.textContent = '--';
      els.statAbsorbed.textContent = '--';
      els.statChars.textContent = '--';
      els.backupInfo.textContent = (err && err.message) || '核心档案读取失败';
      els.restoreBtn.disabled = true;
      return;
    }

    els.batchInput.value = String(doc.settings.batchSize);
    els.charsInput.value = String(doc.settings.maxChars);
    els.eventsInput.value = String(doc.settings.maxEvents);

    const chars = parser().countChars(doc.content);
    const contentChars = parser().isEmptyProfile(doc.content) ? 0 : chars;
    els.statChars.textContent = `${contentChars}/${doc.settings.maxChars}`;
    els.statChars.classList.toggle('is-over', contentChars > doc.settings.maxChars);

    try {
      const stats = await extractor().computeStats(doc);
      els.statPending.textContent = String(stats.pending);
      els.statAbsorbed.textContent = String(stats.absorbed);
    } catch (err) {
      console.warn('[CoreProfileModal] 统计失败：', err);
      els.statPending.textContent = '--';
      els.statAbsorbed.textContent = '--';
    }

    const info = store().backupInfo(doc);
    if (info) {
      els.backupInfo.innerHTML = '';
      const label = document.createElement('span');
      label.className = 'memory-audit-backup-label';
      label.textContent = `${info.charCount} 字 · 已吸收 ${info.absorbedCount} 条`;
      const time = document.createElement('span');
      time.className = 'memory-audit-backup-time';
      time.textContent = formatTime(info.backedUpAt);
      els.backupInfo.appendChild(label);
      els.backupInfo.appendChild(time);
      els.restoreBtn.disabled = false;
    } else {
      els.backupInfo.textContent = '暂无备份，提取前会自动备份当前档案';
      els.restoreBtn.disabled = true;
    }
  }

  /** 设置项：失焦/回车即保存，越界自动夹到范围内并回填 */
  async function handleSettingChange(key, input) {
    const s = store();
    if (!s) return;
    const raw = String(input.value || '').trim();
    try {
      const current = (await s.load()).settings;
      if (!raw) {
        input.value = String(current[key]);
        return;
      }
      const next = s.normalizeSettings({ ...current, [key]: raw });
      input.value = String(next[key]);
      if (next[key] === current[key]) return;
      await s.saveSettings({ [key]: next[key] });
      await refresh();
    } catch (err) {
      await alertMsg('设置保存失败', (err && err.message) || String(err), true);
    }
  }

  /** 读取输入框里尚未触发 change 的值并保存，避免「改完直接点提取」时丢设置 */
  async function flushSettings() {
    const s = store();
    const current = (await s.load()).settings;
    const next = s.normalizeSettings({
      batchSize: String(els.batchInput.value || '').trim() || current.batchSize,
      maxChars: String(els.charsInput.value || '').trim() || current.maxChars,
      maxEvents: String(els.eventsInput.value || '').trim() || current.maxEvents
    });
    els.batchInput.value = String(next.batchSize);
    els.charsInput.value = String(next.maxChars);
    els.eventsInput.value = String(next.maxEvents);
    if (
      next.batchSize !== current.batchSize ||
      next.maxChars !== current.maxChars ||
      next.maxEvents !== current.maxEvents
    ) {
      await s.saveSettings(next);
    }
    return next;
  }

  /* ======================= 提取 ======================= */

  async function handleExtract() {
    if (isProcessing) return;
    const ex = extractor();
    if (ex.isBusy()) {
      toastShow('核心档案正在整理中', '请等这一批完成后再试', 'info');
      return;
    }

    let settings;
    let stats;
    try {
      settings = await flushSettings();
      stats = await ex.computeStats();
    } catch (err) {
      await alertMsg('读取失败', (err && err.message) || String(err), true);
      return;
    }

    if (!stats.pending) {
      await alertMsg('没有待整理的新记忆', '所有助手记忆都已经吸收进核心档案了。');
      return;
    }

    const take = Math.min(settings.batchSize, stats.pending);
    const ok = await confirmMsg(
      '确认提取核心档案吗？',
      `本次会整理最早的 ${take} 条记忆（共 ${stats.pending} 条待整理），档案字数上限 ${settings.maxChars} 字，情感事件每次最多新增 ${settings.maxEvents} 条。提取前会自动备份当前档案，整理需要一点时间。`,
      '开始提取',
      false
    );
    if (!ok) return;

    isProcessing = true;
    close();
    toastShow('正在提取核心档案…', '模型正在把记忆浓缩进档案，可点击关闭本提示', 'info', 600000);

    try {
      await store().createBackup();
      const res = await ex.extractBatch({
        batchSize: settings.batchSize,
        maxChars: settings.maxChars,
        maxEvents: settings.maxEvents
      });
      toastDismiss();

      if (!res.ok) {
        await alertMsg('提取失败', `${res.error || '未知错误'}。档案没有改动。`, true);
        return;
      }
      if (res.empty) {
        await alertMsg('没有待整理的新记忆', '所有助手记忆都已经吸收进核心档案了。');
        return;
      }

      const parts = [`吸收了 ${res.absorbedNow} 条记忆`, `还剩 ${res.remaining} 条待整理`];
      parts.push(`档案现在 ${res.charCount} 字`);
      let detail = `${parts.join('，')}。`;
      if (res.exceeded) detail += `已超出上限 ${res.maxChars} 字，可以在「查看核心档案」里手动精简。`;
      if (res.repaired) detail += '模型输出格式有小问题，已自动修正。';
      detail += '若结果不满意，可在核心档案面板恢复备份。';

      await alertMsg(res.exceeded ? '提取完成（超出字数上限）' : '提取完成', detail, false);
    } catch (err) {
      toastDismiss();
      await alertMsg('提取失败', (err && err.message) || String(err), true);
    } finally {
      isProcessing = false;
    }
  }

  /* ======================= 恢复备份 / 重置进度 ======================= */

  async function handleRestore() {
    if (isProcessing) return;
    if (extractor().isBusy()) {
      toastShow('核心档案正在整理中', '请等这一批完成后再恢复', 'info');
      return;
    }
    const ok = await confirmMsg(
      '确认恢复备份吗？',
      '当前档案正文和吸收进度会被备份内容覆盖，备份本身会保留。',
      '确认恢复',
      true
    );
    if (!ok) return;

    isProcessing = true;
    try {
      await store().restoreBackup();
      await refresh();
      toastShow('备份已恢复', '档案正文与吸收进度已回到备份时的状态', 'success');
    } catch (err) {
      await alertMsg('恢复失败', (err && err.message) || String(err), true);
    } finally {
      isProcessing = false;
    }
  }

  async function handleReset() {
    if (isProcessing) return;
    if (extractor().isBusy()) {
      toastShow('核心档案正在整理中', '请等这一批完成后再重置', 'info');
      return;
    }
    const ok = await confirmMsg(
      '确认重置提取进度吗？',
      '所有记忆的「已吸收」标记会被清除，下次提取会从最早的记忆重新开始。当前档案正文和备份都会保留。',
      '确认重置',
      true
    );
    if (!ok) return;

    isProcessing = true;
    try {
      await extractor().resetProgress({ clearContent: false });
      await refresh();
      toastShow('提取进度已重置', '全部记忆重新变为待整理', 'success');
    } catch (err) {
      await alertMsg('重置失败', (err && err.message) || String(err), true);
    } finally {
      isProcessing = false;
    }
  }

  /* ======================= 全屏编辑页 ======================= */

  /** 存储的正文不带外层标签，解析前补上 */
  function parseStored(content) {
    const p = parser();
    const empty = {};
    p.SECTIONS.forEach((name) => { empty[name] = []; });
    const text = String(content || '');
    if (!text.trim()) return { ok: true, sections: empty };
    const res = p.parse(`<${p.TAG}>\n${text}\n</${p.TAG}>`);
    if (!res.ok) return { ok: false, error: res.error };
    const sections = {};
    p.SECTIONS.forEach((name) => {
      sections[name] = Array.isArray(res.sections[name]) ? res.sections[name].slice() : [];
    });
    return { ok: true, sections };
  }

  /** 单条正文规范化：去换行、去用户手打的项目符号 */
  function cleanItem(value) {
    return String(value || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/^\s*[-－—•·*]\s*/, '')
      .trim();
  }

  function collectSections() {
    const p = parser();
    const sections = {};
    p.SECTIONS.forEach((name) => { sections[name] = []; });
    els.editorBody.querySelectorAll('.core-profile-section').forEach((sec) => {
      const name = sec.dataset.section;
      if (!sections[name]) return;
      sec.querySelectorAll('.core-profile-item-input').forEach((ta) => {
        const text = cleanItem(ta.value);
        if (text && text !== p.EMPTY_MARK) sections[name].push(text);
      });
    });
    if (sections[p.TIMELINE_SECTION].length > 1) {
      sections[p.TIMELINE_SECTION] = p.sortTimeline(sections[p.TIMELINE_SECTION]);
    }
    return sections;
  }

  function updateEditorCount() {
    const p = parser();
    const rendered = p.render(collectSections());
    const chars = p.isEmptyProfile(rendered) ? 0 : p.countChars(rendered);
    els.editorCount.textContent = `${chars}/${editorMaxChars}`;
    els.editorCount.classList.toggle('is-over', chars > editorMaxChars);
    els.editorBody.querySelectorAll('.core-profile-section').forEach((sec) => {
      const n = Array.from(sec.querySelectorAll('.core-profile-item-input'))
        .filter((ta) => cleanItem(ta.value)).length;
      const countEl = sec.querySelector('.core-profile-section-count');
      if (countEl) countEl.textContent = String(n);
    });
  }

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }

  function markDirty() {
    editorDirty = true;
    els.editorSave.disabled = false;
    updateEditorCount();
  }

  function createItemRow(text) {
    const row = document.createElement('div');
    row.className = 'core-profile-item';

    const ta = document.createElement('textarea');
    ta.className = 'core-profile-item-input';
    ta.rows = 1;
    ta.value = text || '';
    ta.placeholder = '写一条…';
    ta.addEventListener('input', () => { autoGrow(ta); markDirty(); });
    // 一条就是一行：回车不换行
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) e.preventDefault();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'core-profile-item-remove';
    del.setAttribute('aria-label', '删除这一条');
    del.innerHTML = ICON_REMOVE;
    del.addEventListener('click', () => {
      row.remove();
      markDirty();
    });

    row.appendChild(ta);
    row.appendChild(del);
    return row;
  }

  function createSection(name, items) {
    const p = parser();
    const sec = document.createElement('section');
    sec.className = 'core-profile-section';
    sec.dataset.section = name;

    const head = document.createElement('div');
    head.className = 'core-profile-section-head';
    const title = document.createElement('span');
    title.className = 'core-profile-section-title';
    title.textContent = name;
    const count = document.createElement('span');
    count.className = 'core-profile-section-count';
    count.textContent = String(items.length);
    head.appendChild(title);
    head.appendChild(count);
    sec.appendChild(head);

    if (name === p.TIMELINE_SECTION) {
      const hint = document.createElement('div');
      hint.className = 'core-profile-section-hint';
      hint.textContent = '以 YYYY-MM-DD 开头的条目保存时会按日期从旧到近排序';
      sec.appendChild(hint);
    }

    const list = document.createElement('div');
    list.className = 'core-profile-item-list';
    items.forEach((text) => list.appendChild(createItemRow(text)));
    sec.appendChild(list);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'core-profile-add-btn';
    add.innerHTML = `${ICON_ADD}<span>添加一条</span>`;
    add.addEventListener('click', () => {
      const row = createItemRow('');
      list.appendChild(row);
      const ta = row.querySelector('textarea');
      autoGrow(ta);
      ta.focus();
    });
    sec.appendChild(add);

    return sec;
  }

  async function handleView() {
    if (isProcessing) return;
    let doc;
    try {
      doc = await store().load();
    } catch (err) {
      await alertMsg('核心档案读取失败', (err && err.message) || String(err), true);
      return;
    }
    const parsed = parseStored(doc.content);
    if (!parsed.ok) {
      await alertMsg('档案格式无法解析', `${parsed.error}。为避免覆盖原文，暂不能编辑，可尝试恢复备份。`, true);
      return;
    }

    editorMaxChars = doc.settings.maxChars;
    els.editorBody.innerHTML = '';
    parser().SECTIONS.forEach((name) => {
      els.editorBody.appendChild(createSection(name, parsed.sections[name]));
    });

    close();
    editorOpen = true;
    editorDirty = false;
    els.editorSave.disabled = true;
    els.editor.hidden = false;
    els.editorBody.scrollTop = 0;
    els.editorBody.querySelectorAll('.core-profile-item-input').forEach(autoGrow);
    updateEditorCount();
  }

  function closeEditor() {
    editorOpen = false;
    editorDirty = false;
    els.editor.hidden = true;
    els.editorBody.innerHTML = '';
  }

  async function handleEditorBack() {
    if (!editorOpen) return;
    if (editorDirty) {
      const ok = await confirmMsg('放弃未保存的修改吗？', '返回后本次编辑的内容不会保存。', '放弃修改', true);
      if (!ok) return;
    }
    closeEditor();
    await open();
  }

  async function handleEditorSave() {
    if (!editorOpen || !editorDirty) return;
    if (extractor().isBusy()) {
      toastShow('核心档案正在整理中', '请等这一批完成后再保存，避免互相覆盖', 'info');
      return;
    }
    const rendered = parser().render(collectSections());
    els.editorSave.disabled = true;
    try {
      await store().saveContent(parser().isEmptyProfile(rendered) ? '' : rendered);
      editorDirty = false;
      // 重新按保存结果渲染一次，让排序和清理后的条目立即可见
      const parsed = parseStored(rendered);
      if (parsed.ok) {
        els.editorBody.innerHTML = '';
        parser().SECTIONS.forEach((name) => {
          els.editorBody.appendChild(createSection(name, parsed.sections[name]));
        });
        els.editorBody.querySelectorAll('.core-profile-item-input').forEach(autoGrow);
      }
      updateEditorCount();
      toastShow('核心档案已保存', '下一轮对话起生效', 'success');
    } catch (err) {
      els.editorSave.disabled = false;
      await alertMsg('保存失败', (err && err.message) || String(err), true);
    }
  }

  return {
    open,
    close,
    refresh
  };
})();

if (typeof window !== 'undefined') {
  window.CoreProfileModal = CoreProfileModal;
}
