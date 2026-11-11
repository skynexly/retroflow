/**
 * ============================================================================
 * 溯流计划 · 记忆巡检弹窗控制器 (Memory Audit Modal)
 * ============================================================================
 * 职责：
 *   1. 弹窗 UI：立刻开始巡检、恢复备份、自动巡检开关（即将推出）
 *   2. 调用 MemoryAuditor 执行巡检
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

  let isOpen = false;
  let isProcessing = false;

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function auditor() {
    return getWin().MemoryAuditor || null;
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

    if (!overlay) return false;

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
    
    // 刷新备份信息
    refreshBackupInfo();
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
      backupInfoEl.textContent = '暂无备份';
      restoreBtn.disabled = true;
      return;
    }

    try {
      const info = await aud.getBackupInfo();
      if (info && info.timestamp) {
        const date = new Date(info.timestamp);
        const formatted = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        backupInfoEl.innerHTML = `<span class="memory-audit-backup-label">记忆备份</span> <span class="memory-audit-backup-time">${formatted}</span>`;
        restoreBtn.disabled = false;
      } else {
        backupInfoEl.textContent = '暂无备份';
        restoreBtn.disabled = true;
      }
    } catch (err) {
      console.error('[MemoryAuditModal] 获取备份信息失败:', err);
      backupInfoEl.textContent = '暂无备份';
      restoreBtn.disabled = true;
    }
  }

  /**
   * 立刻开始巡检
   */
  async function handleStartAudit() {
    if (isProcessing) return;

    const modal = retroModal();
    const toast = retroToast();
    const aud = auditor();

    if (!aud) {
      console.error('[MemoryAuditModal] MemoryAuditor 未初始化');
      return;
    }

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
    close(); // 关闭弹窗

    // 显示 toast（RetroToast 无 duration:0 长驻模式，用较长时长；期间可点击关闭）
    if (toast && typeof toast.show === 'function') {
      toast.show({
        tag: 'AUDIT // 记忆巡检',
        message: '正在巡检中…',
        detail: '系统正在分析记忆并生成合并方案，可点击关闭本提示',
        type: 'info',
        duration: 600000 // 10 分钟兜底，结果弹窗出现前由 dismiss 收掉
      });
    }

    try {
      // 1. 创建备份
      await aud.createBackup();

      // 2. 执行巡检
      const result = await aud.auditAll();

      // 3. 关闭 toast
      if (toast && typeof toast.dismiss === 'function') {
        toast.dismiss();
      }

      // 4. 显示结果
      const merged = result.merged || 0;
      const skipped = result.skipped || 0;
      const failed = result.failed || 0;
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
      
      // 关闭 toast
      if (toast && typeof toast.dismiss === 'function') {
        toast.dismiss();
      }

      // 显示错误
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
    }
  }

  /**
   * 恢复备份
   */
  async function handleRestoreBackup() {
    if (isProcessing) return;

    const modal = retroModal();
    const aud = auditor();

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