/**
 * 溯流计划 · 数据管理面板控制器 (Data Vault UI)
 * 职责：
 *   1. 渲染总用量总览（浏览器预估配额）
 *   2. 分块用量展示大卡（纯展示，每块一行）
 *   3. 备份与迁移模块：胶囊单选作用范围（全部 / 各分块），
 *      对选中范围导出或清理；导入走文件自识别（读包里 blocks）
 *
 * 交互约定：
 *   - 胶囊单选决定「导出 / 清理」的作用范围；'all' 表示全部分块。
 *   - 底层存储各块独立，但操作胶囊可按 DataVault.OP_GROUPS 合并展示
 *     （如「线上数据」= 聊天记录 + 线上联络），避免胶囊无限增殖。
 *   - 「全部」允许导出，但禁止清理（避免一键清空全部数据）。
 *   - 导入不看胶囊，读文件里的 blocks 字段自动识别要覆盖哪些块。
 *
 * 接入：由 settings.js 在进入 data 二级页时调用 DataVaultUI.render()
 */
const DataVaultUI = (() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let bound = false;
  let rendering = false;
  // 当前胶囊选中范围：'all' 或某个 blockId
  let selectedScope = 'all';
  // 缓存最近一次分块统计，供胶囊切换时即时算合计，避免重复扫库
  let lastStats = null;

  function toast(tag, message, type) {
    if (window.RetroToast && typeof RetroToast.show === 'function') {
      RetroToast.show({ tag, message, type: type || 'info' });
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '"');
  }

  /* ---------------- 渲染 ---------------- */

  async function render() {
    if (!window.DataVault || rendering) return;
    rendering = true;
    try {
      const stat = await DataVault.statAll();
      lastStats = stat;
      renderOverviewFigure(stat);
      await renderQuota();
      renderStatsRows(stat);
      renderChips();
      updateOpsBar();
      bindOnce();
    } finally {
      rendering = false;
    }
  }

  function renderOverviewFigure(stat) {
    const num = $('dataVaultTotalNum');
    const unit = $('dataVaultTotalUnit');
    if (num) num.textContent = stat.totalSizeValue;
    if (unit) unit.textContent = stat.totalSizeUnit;
  }

  async function renderQuota() {
    const est = await DataVault.estimateQuota();
    const fill = $('dataVaultQuotaFill');
    const hint = $('dataVaultQuotaHint');
    if (est.supported && est.quota > 0) {
      const pct = Math.min(100, Math.round((est.usage / est.quota) * 100));
      if (fill) fill.style.width = `${Math.max(2, pct)}%`;
      const usageSize = DataVault.formatSize(est.usage);
      const quotaSize = DataVault.formatSize(est.quota);
      if (hint) hint.textContent = `浏览器预估：已用 ${usageSize.value}${usageSize.unit} / 上限约 ${quotaSize.value}${quotaSize.unit}`;
    } else {
      if (fill) fill.style.width = '0%';
      if (hint) hint.textContent = '用量由浏览器预估，仅供参考';
    }
  }

  /** 分块用量展示大卡：每块一行，纯展示 */
  function renderStatsRows(stat) {
    const wrap = $('dataVaultStatsRows');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const s of stat.blocks) {
      const row = document.createElement('div');
      row.className = 'data-vault-stats-row';
      row.innerHTML = `
        <div class="data-vault-stats-row-title">
          <span class="data-vault-stats-row-zh">${escapeHtml(s.zh)}</span>
          <span class="data-vault-stats-row-en">${escapeHtml(s.en)}</span>
        </div>
        <div class="data-vault-stats-row-meta">
          <span class="data-vault-stats-row-count">${s.count} 项</span>
          <span class="data-vault-stats-row-size">${escapeHtml(s.sizeValue)}${escapeHtml(s.sizeUnit)}</span>
        </div>
      `;
      wrap.appendChild(row);
    }
  }

  /** 胶囊单选：全部 + 各作用域（合并组算一枚，如「线上数据」） */
  function renderChips() {
    const wrap = $('dataVaultChips');
    if (!wrap) return;
    wrap.innerHTML = '';

    const chips = [{ id: 'all', zh: '全部' }].concat(DataVault.listOpScopes());

    for (const c of chips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'data-vault-chip' + (c.id === selectedScope ? ' is-active' : '');
      btn.dataset.scope = c.id;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', c.id === selectedScope ? 'true' : 'false');
      btn.textContent = c.zh;
      wrap.appendChild(btn);
    }
  }

  /** 计算选中范围的合计大小（合并组把组内各块加总） */
  function scopeStat() {
    if (!lastStats) return { label: '全部', value: '--', unit: '', bytes: 0 };
    if (selectedScope === 'all') {
      return {
        label: '全部',
        value: lastStats.totalSizeValue,
        unit: lastStats.totalSizeUnit,
        bytes: lastStats.totalBytes
      };
    }

    const ids = DataVault.resolveScope(selectedScope);
    if (!ids.length) return { label: '全部', value: '--', unit: '', bytes: 0 };

    let bytes = 0;
    for (const id of ids) {
      const s = lastStats.blocks.find((b) => b.id === id);
      if (s) bytes += s.bytes;
    }
    const size = DataVault.formatSize(bytes);
    return {
      label: DataVault.scopeLabel(selectedScope),
      value: size.value,
      unit: size.unit,
      bytes
    };
  }

  /** 更新操作条：范围标签、合计大小、清理按钮可用性 */
  function updateOpsBar() {
    const st = scopeStat();
    const label = $('dataVaultOpsLabel');
    const num = $('dataVaultOpsNum');
    const unit = $('dataVaultOpsUnit');
    if (label) label.textContent = st.label;
    if (num) num.textContent = st.value;
    if (unit) unit.textContent = st.unit;

    // 「全部」禁止清理；空范围也禁止清理
    const clearBtn = $('dataVaultClearBtn');
    if (clearBtn) {
      clearBtn.disabled = selectedScope === 'all' || st.bytes === 0;
    }
    // 导出：空范围禁用
    const exportBtn = $('dataVaultExportBtn');
    if (exportBtn) exportBtn.disabled = st.bytes === 0;
  }

  /* ---------------- 导出 ---------------- */

  let exporting = false;

  async function doExport() {
    // 防重入：原生壳分块写大备份要数秒到数十秒，期间再点必须挡住
    if (exporting) return;
    exporting = true;
    const exportBtn = $('dataVaultExportBtn');
    const origLabel = exportBtn ? exportBtn.textContent : '';
    if (exportBtn) {
      exportBtn.disabled = true;
      exportBtn.textContent = '正在导出…';
    }
    // 节流进度刷新：每 200ms 最多更新一次按钮文案，避免高频 DOM 写
    let lastTick = 0;
    const onProgress = ({ loaded, total }) => {
      const now = Date.now();
      if (now - lastTick < 200 || !exportBtn) return;
      lastTick = now;
      exportBtn.textContent = `正在写入 ${Math.round((loaded / total) * 100)}%`;
    };
    try {
      const opts = { onProgress };
      if (selectedScope === 'all') {
        await DataVault.exportAll(opts);
        toast('EXPORT // 全量导出', '完整备份已导出为 JSON', 'success');
      } else {
        await DataVault.exportScope(selectedScope, opts);
        toast('EXPORT // 导出完成', `「${DataVault.scopeLabel(selectedScope)}」已导出为 JSON`, 'success');
      }
    } catch (err) {
      toast('EXPORT // 导出失败', '导出过程出错，请重试', 'warning');
    } finally {
      exporting = false;
      if (exportBtn) {
        exportBtn.textContent = origLabel || '导出';
        // 恢复可用性：与顶部禁用判定同口径（scopeStat 按当前选中范围算 bytes）
        exportBtn.disabled = scopeStat().bytes === 0;
      }
    }
  }

  /* ---------------- 清理 ---------------- */

  async function doClear() {
    if (selectedScope === 'all') return; // 全部不允许清理
    const label = DataVault.scopeLabel(selectedScope);
    const ids = DataVault.resolveScope(selectedScope);
    if (!ids.length) return;

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'PURGE // 清理分块',
        message: `确认清空「${label}」的全部数据吗？`,
        detail: '该范围下的所有数据将从本地存储永久移除，此操作不可撤销。清理后页面会自动重载。',
        confirmText: '确认清理',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    let removed = 0;
    try {
      removed = await DataVault.clearScope(selectedScope);
    } catch (err) {
      toast('PURGE // 清理失败', '清理过程出错，请重试', 'warning');
      return;
    }

    if (window.RetroModal && typeof RetroModal.alert === 'function') {
      await RetroModal.alert({
        tag: 'PURGE // 清理完成',
        message: `「${label}」已清理 ${removed} 项`,
        detail: '页面将重新载入以刷新界面状态。',
        confirmText: '立即重载'
      });
    }
    try { location.reload(); } catch (_) { /* ignore */ }
  }

  /* ---------------- 导入（文件自识别） ---------------- */

  function triggerImport() {
    const input = $('dataVaultImportInput');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  async function handleImportFile(file) {
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch (_) {
      toast('IMPORT // 读取失败', '无法读取所选文件', 'warning');
      return;
    }

    const pkg = DataVault.parsePackage(text);
    if (!pkg) {
      toast('IMPORT // 格式错误', '这不是有效的溯流数据备份文件', 'warning');
      return;
    }

    const pkgBlocks = Array.isArray(pkg.blocks) ? pkg.blocks : [];
    if (!pkgBlocks.length) {
      toast('IMPORT // 空备份', '这份备份不含任何可导入的分块', 'warning');
      return;
    }

    // 列出包里识别到的分块名，让用户在确认时看清将覆盖什么
    const names = pkgBlocks
      .map((id) => (DataVault.BLOCKS[id] ? DataVault.BLOCKS[id].zh : id))
      .join('、');

    let confirmed = true;
    if (window.RetroModal && typeof RetroModal.confirm === 'function') {
      confirmed = await RetroModal.confirm({
        tag: 'IMPORT // 覆盖导入',
        message: `识别到 ${pkgBlocks.length} 个分块，确认导入吗？`,
        detail: `将覆盖：${names}。导入以备份内容替换当前对应数据，无法撤销，完成后页面会自动重载。`,
        confirmText: '确认导入',
        cancelText: '取消',
        danger: true
      });
    }
    if (!confirmed) return;

    toast('IMPORT // 写入中', '正在写入数据，请稍候…', 'info');
    let result;
    try {
      // 不传 onlyBlock，applyImport 按包里 blocks 全量覆盖导入
      result = await DataVault.applyImport(pkg, null);
    } catch (err) {
      toast('IMPORT // 导入失败', '写入过程出错，数据可能不完整', 'warning');
      return;
    }

    if (!result || !result.ok) {
      toast('IMPORT // 导入失败', '备份内容无法应用', 'warning');
      return;
    }

    if (window.RetroModal && typeof RetroModal.alert === 'function') {
      await RetroModal.alert({
        tag: 'IMPORT // 导入完成',
        message: '数据已写入本地存储',
        detail: '页面将重新载入以应用导入的数据。',
        confirmText: '立即重载'
      });
    }
    try { location.reload(); } catch (_) { /* ignore */ }
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindOnce() {
    if (bound) return;
    bound = true;

    const chips = $('dataVaultChips');
    if (chips) {
      chips.addEventListener('click', (e) => {
        const btn = e.target.closest('.data-vault-chip');
        if (!btn) return;
        const scope = btn.dataset.scope;
        if (!scope || scope === selectedScope) return;
        selectedScope = scope;
        chips.querySelectorAll('.data-vault-chip').forEach((el) => {
          const on = el.dataset.scope === scope;
          el.classList.toggle('is-active', on);
          el.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        updateOpsBar();
      });
    }

    const exportBtn = $('dataVaultExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => { if (!exportBtn.disabled) doExport(); });

    const clearBtn = $('dataVaultClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => { if (!clearBtn.disabled) doClear(); });

    const importBtn = $('dataVaultImportBtn');
    if (importBtn) importBtn.addEventListener('click', triggerImport);

    const input = $('dataVaultImportInput');
    if (input) {
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        await handleImportFile(file);
        input.value = '';
      });
    }
  }

  return { render };
})();

window.DataVaultUI = DataVaultUI;