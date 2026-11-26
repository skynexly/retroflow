/**
 * ============================================================================
 * 溯流计划 · 记忆巡检弹窗控制器 (Memory Audit Modal)
 * ============================================================================
 * 职责：
 *   1. 弹窗 UI：立刻开始巡检、恢复备份、自动巡检开关与最近结果
 *   2. 通过 MemoryAutoAudit 的统一执行锁调用手动巡检
 *   3. 显示结果：toast + RetroModal.alert
 * ============================================================================
 */
const MemoryAuditModal = (() => {
  'use strict';

  let overlay = null;
  let closeBtn = null;
  let startBtn = null;
  let restoreBtn = null;
  let backupInfoEl = null;
  let autoToggle = null;
  let autoStatusEl = null;
  let lastResultEl = null;
  let batchInput = null;

  let isOpen = false;
  let isProcessing = false;
  let isToggleSaving = false;
  let hasBackup = false;
  let autoInfoRequest = 0;
  let isStopConfirming = false;

  // 按钮两种形态：开始巡检（对勾）/ 终止巡检（实心方块）
  const START_ICON = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
  const STOP_ICON = 'M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z';
  const START_LABEL = '立刻开始记忆巡检';
  const STOP_LABEL = '终止巡检';
  const STOPPING_LABEL = '正在终止…';

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function auditor() {
    return getWin().MemoryAuditor || null;
  }

  function autoAudit() {
    return getWin().MemoryAutoAudit || null;
  }

  function formatTime(timestamp) {
    const auto = autoAudit();
    if (auto && typeof auto.formatTime === 'function') return auto.formatTime(timestamp);
    const t = Number(timestamp);
    if (!t) return '尚未巡检';
    const d = new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function retroModal() {
    return getWin().RetroModal || null;
  }

  function retroToast() {
    return getWin().RetroToast || null;
  }

  function initDOM() {
    overlay = document.getElementById('memoryAuditModalOverlay');
    closeBtn = document.getElementById('memAuditCloseBtn');
    startBtn = document.getElementById('memAuditStartBtn');
    restoreBtn = document.getElementById('memAuditRestoreBtn');
    backupInfoEl = document.getElementById('memAuditBackupInfo');
    autoToggle = document.getElementById('memAutoAuditToggle');
    autoStatusEl = document.getElementById('memAutoAuditStatus');
    lastResultEl = document.getElementById('memAuditLastResult');
    batchInput = document.getElementById('memAuditBatchInput');

    if (!overlay) return false;

    // 每批条数的范围与引擎常量同源，避免 UI 与逻辑各写一套 1/300
    if (batchInput) {
      const aud = auditor();
      const min = (aud && Number.isFinite(aud.AUDIT_BATCH_MIN)) ? aud.AUDIT_BATCH_MIN : 1;
      const max = (aud && Number.isFinite(aud.AUDIT_BATCH_MAX)) ? aud.AUDIT_BATCH_MAX : 300;
      batchInput.min = String(min);
      batchInput.max = String(max);
      batchInput.step = '1';
      batchInput.addEventListener('change', handleBatchSizeChange);
      batchInput.addEventListener('blur', handleBatchSizeChange);

      const rangeEl = document.getElementById('memAuditBatchRange');
      if (rangeEl) rangeEl.textContent = `${min}~${max}`;
    }

    // 关闭按钮
    if (closeBtn) {
      closeBtn.addEventListener('click', close);
    }

    // 立刻开始巡检
    if (startBtn) {
      startBtn.addEventListener('click', handleStartAudit);
    }

    // 恢复备份
    if (restoreBtn) {
      restoreBtn.addEventListener('click', handleRestoreBackup);
    }

    if (autoToggle) {
      autoToggle.addEventListener('change', handleAutoToggle);
    }

    window.addEventListener('retroflow:memory-audit-state', syncRunningState);
    window.addEventListener('retroflow:memory-audit-completed', () => {
      refreshAutoAuditInfo();
      refreshBackupInfo();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });

    // ESC 键关闭
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) close();
    });

    return true;
  }

  function open() {
    if (!overlay && !initDOM()) {
      console.warn('[MemoryAuditModal] 弹窗 DOM 未找到');
      return;
    }

    isOpen = true;
    overlay.hidden = false;
    
    // 刷新备份信息与自动巡检状态
    refreshBackupInfo();
    refreshAutoAuditInfo();
  }

  function close() {
    if (!overlay) return;

    isOpen = false;
    overlay.hidden = true;
  }

  /**
   * 刷新备份信息显示
   */
  async function refreshBackupInfo() {
    if (!backupInfoEl || !restoreBtn) return;

    const aud = auditor();
    if (!aud || typeof aud.getBackupInfo !== 'function') {
      hasBackup = false;
      backupInfoEl.textContent = '暂无备份';
      syncRunningState();
      return;
    }

    try {
      const info = await aud.getBackupInfo();
      hasBackup = Boolean(info && info.timestamp);
      if (hasBackup) {
        backupInfoEl.innerHTML = `<span class="memory-audit-backup-label">记忆备份</span> <span class="memory-audit-backup-time">${formatTime(info.timestamp)}</span>`;
      } else {
        backupInfoEl.textContent = '暂无备份';
      }
    } catch (err) {
      hasBackup = false;
      console.error('[MemoryAuditModal] 获取备份信息失败:', err);
      backupInfoEl.textContent = '暂无备份';
    }
    syncRunningState();
  }

  /**
   * 自动巡检开关、调度时间与最近结果。
   */
  async function refreshAutoAuditInfo() {
    const auto = autoAudit();
    const request = ++autoInfoRequest;
    if (!auto || typeof auto.getConfig !== 'function') {
      if (autoToggle) {
        autoToggle.checked = false;
        autoToggle.disabled = true;
      }
      if (autoStatusEl) autoStatusEl.textContent = '自动巡检模块尚未就绪';
      if (lastResultEl) lastResultEl.hidden = true;
      syncRunningState();
      return;
    }

    try {
      const config = await auto.getConfig();
      if (request !== autoInfoRequest) return;
      if (autoToggle) autoToggle.checked = config.autoAuditEnabled === true;
      // 输入框回填当前生效值；巡检进行中不回填，避免把正在编辑的内容冲掉
      if (batchInput && !isProcessing) batchInput.value = String(config.auditBatchSize);

      if (autoStatusEl) {
        if (!config.autoAuditEnabled) {
          autoStatusEl.textContent = '已关闭，开启后每 7 天检查一次';
        } else {
          const nextAt = config.autoAuditNextDueAt || config.autoAuditRetryAt;
          const lines = [`已开启 · 下次巡检 ${formatTime(nextAt)}`];
          if (config.autoAuditLastCompletedAt) {
            lines.push(`上次完成 ${formatTime(config.autoAuditLastCompletedAt)}`);
          }
          autoStatusEl.textContent = lines.join('\n');
        }
      }

      const result = config.autoAuditLastResult || {};
      if (lastResultEl) {
        if (!result.at || !result.status) {
          lastResultEl.hidden = true;
          lastResultEl.textContent = '';
          lastResultEl.classList.remove('is-error');
        } else {
          const parts = [];
          const stopped = result.status === 'stopped';
          if (result.status === 'no-candidates') parts.push('没有发现可合并的相似记忆');
          else parts.push(result.merged > 0 ? `合并 ${result.merged} 组记忆` : '没有合并记忆');
          if (result.groupCount > 0) parts.push(`候选 ${result.groupCount} 组`);
          if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 组`);
          if (stopped) {
            if (result.stoppedAt) parts.push(`停在「${result.stoppedAt}」`);
          } else if (result.failed > 0) {
            parts.push(`失败 ${result.failed} 批`);
          }
          const failed = !stopped && (result.status === 'failed' || result.failed > 0);
          const error = (failed || stopped) && result.error ? `\n${result.error}` : '';
          const suffix = stopped ? '（已终止）' : '';
          lastResultEl.textContent = `最近巡检 ${formatTime(result.at)}${suffix}\n${parts.join('，')}${error}`;
          lastResultEl.classList.toggle('is-error', failed);
          lastResultEl.hidden = false;
        }
      }
    } catch (err) {
      if (request !== autoInfoRequest) return;
      console.error('[MemoryAuditModal] 读取自动巡检状态失败:', err);
      if (autoStatusEl) autoStatusEl.textContent = '自动巡检状态读取失败';
    }
    syncRunningState();
  }

  function setStartButtonMode(mode) {
    if (!startBtn) return;
    const stopMode = mode !== 'start';
    startBtn.classList.toggle('is-stop', stopMode);
    const path = startBtn.querySelector('svg path');
    if (path) path.setAttribute('d', stopMode ? STOP_ICON : START_ICON);
    const label = startBtn.querySelector('span');
    const text = mode === 'stopping' ? STOPPING_LABEL : (stopMode ? STOP_LABEL : START_LABEL);
    if (label && label.textContent !== text) label.textContent = text;
  }

  function syncRunningState() {
    const auto = autoAudit();
    const state = auto && typeof auto.getState === 'function' ? auto.getState() : { running: false };
    const running = Boolean(state && state.running);
    const stopping = running && Boolean(state.stopping);
    if (startBtn) {
      // 巡检中按钮原地变成「终止巡检」并保持可点；恢复备份等其他处理中仍禁用
      setStartButtonMode(running ? (stopping ? 'stopping' : 'stop') : 'start');
      startBtn.disabled = running ? (stopping || isStopConfirming) : isProcessing;
    }
    if (restoreBtn) restoreBtn.disabled = isProcessing || running || !hasBackup;
    if (autoToggle) autoToggle.disabled = isProcessing || running || isToggleSaving || !auto;
  }

  async function handleAutoToggle() {
    if (!autoToggle || isToggleSaving) return;
    const auto = autoAudit();
    const requested = autoToggle.checked;
    if (!auto || typeof auto.setEnabled !== 'function') {
      autoToggle.checked = false;
      return;
    }

    if (requested) {
      const modal = retroModal();
      if (modal && typeof modal.confirm === 'function') {
        const ok = await modal.confirm({
          message: '开启每周自动记忆巡检？',
          detail: '开启后每 7 天检查一次相似记忆；有可合并项时会先自动备份，再调用模型整理。首次巡检将在开启 7 天后执行。',
          confirmText: '确认开启',
          cancelText: '取消',
          danger: false
        });
        if (!ok) {
          autoToggle.checked = false;
          return;
        }
      }
    }

    isToggleSaving = true;
    syncRunningState();
    try {
      await auto.setEnabled(requested);
      await refreshAutoAuditInfo();
    } catch (err) {
      console.error('[MemoryAuditModal] 保存自动巡检开关失败:', err);
      await refreshAutoAuditInfo();
      const modal = retroModal();
      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: '自动巡检设置保存失败',
          detail: err.message || '请稍后重试。',
          confirmText: '知道了',
          danger: true
        });
      }
    } finally {
      isToggleSaving = false;
      syncRunningState();
    }
  }

  /**
   * 保存每批巡检条数。空值回填原值，越界由 MemoryAutoAudit 钳制后回填，
   * 保证输入框显示的永远是实际生效的值。
   */
  async function handleBatchSizeChange() {
    if (!batchInput) return;
    if (isProcessing) return;
    const auto = autoAudit();
    if (!auto || typeof auto.setAuditBatchSize !== 'function') return;

    const raw = String(batchInput.value == null ? '' : batchInput.value).trim();
    if (!raw) {
      // 空值不当作 0：回读当前生效值，避免把用户的清空动作存成 1
      try {
        const config = await auto.getConfig();
        batchInput.value = String(config.auditBatchSize);
      } catch (_) { /* 读取失败时保持原样 */ }
      return;
    }

    try {
      const saved = await auto.setAuditBatchSize(raw);
      batchInput.value = String(saved.auditBatchSize);
    } catch (err) {
      console.error('[MemoryAuditModal] 保存每批巡检条数失败:', err);
      try {
        const config = await auto.getConfig();
        batchInput.value = String(config.auditBatchSize);
      } catch (_) { /* 忽略回读失败 */ }
    }
  }

  /**
   * 提交前把输入框里的值同步落盘。
   * change 事件在手机上不一定触发（比如直接点按钮），避免「改完立刻巡检」丢掉设置。
   */
  async function flushBatchSize() {
    if (!batchInput) return;
    await handleBatchSizeChange();
  }

  /**
   * 终止巡检：手动和自动巡检都走这里。
   * 已合并的记忆和备份保留；结果提示由发起巡检的一方负责。
   */
  async function handleStopAudit() {
    const auto = autoAudit();
    if (!auto || typeof auto.stop !== 'function' || isStopConfirming) return;
    const modal = retroModal();
    isStopConfirming = true;
    syncRunningState();
    try {
      if (modal && typeof modal.confirm === 'function') {
        const ok = await modal.confirm({
          message: '确认终止巡检吗？',
          detail: '已合并的记忆会保留，正在处理的这一批会作废。',
          confirmText: '终止巡检',
          cancelText: '继续巡检',
          danger: true
        });
        if (!ok) return;
      }
      const state = typeof auto.getState === 'function' ? auto.getState() : null;
      if (!state || !state.running) return;
      auto.stop();
    } finally {
      isStopConfirming = false;
      syncRunningState();
    }
  }

  /**
   * 立刻开始巡检；巡检进行中时同一个按钮负责终止
   */
  async function handleStartAudit() {
    const auto = autoAudit();
    if (auto && typeof auto.getState === 'function' && auto.getState().running) {
      await handleStopAudit();
      return;
    }
    if (isProcessing) return;

    const modal = retroModal();
    const toast = retroToast();

    if (!auto || typeof auto.runManual !== 'function') {
      console.error('[MemoryAuditModal] MemoryAutoAudit 未初始化');
      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: '暂时无法开始巡检',
          detail: '巡检调度模块尚未就绪，请重新载入页面后重试。',
          confirmText: '知道了',
          danger: true
        });
      }
      return;
    }

    // 先把输入框里的条数落盘再开始：手机上未必触发 change，避免改完直接点按钮时丢设置
    await flushBatchSize();

    // 二次确认
    if (modal && typeof modal.confirm === 'function') {
      const ok = await modal.confirm({
        message: '确认开始记忆巡检吗？',
        detail: '系统将自动备份当前记忆，然后分析并合并重复、矛盾的记忆条目。巡检可能需要几分钟，请耐心等待。',
        confirmText: '开始巡检',
        cancelText: '取消',
        danger: false
      });
      if (!ok) return;
    }

    isProcessing = true;
    syncRunningState();
    close(); // 关闭弹窗

    // 显示 toast（RetroToast 无 duration:0 长驻模式，用较长时长；期间可点击关闭）
    if (toast && typeof toast.show === 'function') {
      toast.show({
        tag: 'AUDIT 记忆巡检',
        message: '正在巡检中…',
        detail: '可重新打开巡检面板终止，可点击关闭本提示',
        type: 'info',
        duration: 600000 // 10 分钟兜底，结果弹窗出现前由 dismiss 收掉
      });
    }

    try {
      // 与自动巡检共用执行锁，由调度层统一处理模型校验、备份、执行及状态记录。
      const result = await auto.runManual();
      if (toast && typeof toast.dismiss === 'function') toast.dismiss();

      if (result && result.reason === 'busy') {
        if (toast && typeof toast.show === 'function') {
          toast.show({
            tag: 'AUDIT 记忆巡检',
            message: '巡检正在进行中',
            detail: '请等待当前巡检结束后再试',
            type: 'info',
            duration: 3200
          });
        }
        return;
      }

      const merged = result.merged || 0;
      const skipped = result.skipped || 0;
      const failed = result.failed || 0;

      if (result.stopped) {
        const byUser = result.stopReason !== 'failed';
        const lines = [merged > 0 ? `已合并 ${merged} 组记忆` : '没有合并任何记忆'];
        if (skipped > 0) lines.push(`跳过 ${skipped} 组`);
        if (result.stoppedAt) lines.push(`停在「${result.stoppedAt}」`);
        const reason = !byUser && result.firstError ? `失败原因：${result.firstError}。` : '';
        if (modal && typeof modal.alert === 'function') {
          await modal.alert({
            message: byUser ? '巡检已终止' : '巡检已停止',
            detail: `${lines.join('，')}。${reason}已合并的记忆已保留，若发现异常，可重新打开巡检面板恢复备份。`,
            confirmText: '知道了',
            danger: false
          });
        }
        return;
      }

      const parts = [merged > 0 ? `合并了 ${merged} 组记忆` : '没有合并任何记忆'];
      if (skipped > 0) parts.push(`跳过 ${skipped} 组`);
      if (failed > 0) parts.push(`${failed} 批未处理（${result.firstError || '模型返回异常'}），可稍后再巡检一次`);
      const resultText = parts.join('，');

      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: failed > 0 ? '巡检部分完成' : '巡检完成',
          detail: `${resultText}。若发现异常，可重新打开巡检面板恢复备份。`,
          confirmText: '知道了',
          danger: false
        });
      }

    } catch (err) {
      console.error('[MemoryAuditModal] 巡检失败:', err);
      if (toast && typeof toast.dismiss === 'function') toast.dismiss();

      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: '巡检失败',
          detail: err.message || '请检查 API 配置或网络连接，稍后重试。',
          confirmText: '知道了',
          danger: true
        });
      }
    } finally {
      isProcessing = false;
      syncRunningState();
      await Promise.all([refreshAutoAuditInfo(), refreshBackupInfo()]);
    }
  }

  /**
   * 恢复备份
   */
  async function handleRestoreBackup() {
    if (isProcessing) return;

    const modal = retroModal();
    const aud = auditor();
    const auto = autoAudit();
    const running = auto && typeof auto.getState === 'function' && auto.getState().running;
    if (running) {
      syncRunningState();
      return;
    }

    if (!aud || typeof aud.restoreBackup !== 'function') {
      console.error('[MemoryAuditModal] MemoryAuditor 未初始化');
      return;
    }

    // 二次确认
    if (modal && typeof modal.confirm === 'function') {
      const ok = await modal.confirm({
        message: '确认恢复到巡检前的状态吗？',
        detail: '当前记忆将被备份内容覆盖，此操作不可撤销。恢复后页面会自动重载。',
        confirmText: '确认恢复',
        cancelText: '取消',
        danger: true
      });
      if (!ok) return;
    }

    isProcessing = true;
    syncRunningState();

    try {
      await aud.restoreBackup();
      
      // 恢复成功，重载页面
      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: '备份已恢复',
          detail: '页面将重新载入以应用恢复的记忆。',
          confirmText: '立即重载',
          danger: false
        });
      }

      try { location.reload(); } catch (_) { /* ignore */ }
    } catch (err) {
      console.error('[MemoryAuditModal] 恢复备份失败:', err);
      
      if (modal && typeof modal.alert === 'function') {
        await modal.alert({
          message: '恢复失败',
          detail: err.message || '备份可能不存在或已损坏。',
          confirmText: '知道了',
          danger: true
        });
      }
    } finally {
      isProcessing = false;
      syncRunningState();
      await Promise.all([refreshAutoAuditInfo(), refreshBackupInfo()]);
    }
  }

  return {
    open,
    close
  };
})();

if (typeof window !== 'undefined') {
  window.MemoryAuditModal = MemoryAuditModal;
}