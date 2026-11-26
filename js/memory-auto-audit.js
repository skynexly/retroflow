/**
 * ============================================================================
 * 溯流计划 · 每七天自动记忆巡检 (Memory Auto Audit)
 * ============================================================================
 * 统一收口 memory/config、手动/自动执行锁、到期调度、只读预检与结果通知。
 * 自动巡检无候选时不调用 AI、不覆盖备份；有候选时先确认模型和备份再合并。
 * ============================================================================
 */
const MemoryAutoAudit = (() => {
  'use strict';

  const PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
  const RETRY_MS = 24 * 60 * 60 * 1000;
  const BOOT_DELAY_MS = 1800;
  const STATE_EVENT = 'retroflow:memory-audit-state';
  const COMPLETE_EVENT = 'retroflow:memory-audit-completed';

  let running = false;
  let activeKind = '';
  let initialized = false;
  let abortCtrl = null;      // 本次巡检的终止信号
  let stopping = false;      // 已请求终止、正在收尾
  let retryDialogOpen = false;

  function getWin() {
    return typeof window !== 'undefined' ? window : {};
  }

  function configKey() {
    const registry = getWin().DataRegistry;
    return registry && registry.key && typeof registry.key.memoryConfig === 'function'
      ? registry.key.memoryConfig()
      : 'memory/config';
  }

  function auditor() {
    return getWin().MemoryAuditor || null;
  }

  function toast(options) {
    const api = getWin().RetroToast;
    if (!api || typeof api.show !== 'function') return;
    try {
      api.show(Object.assign({ tag: 'MEMORY 自动巡检' }, options));
    } catch (_) { /* 提示失败不阻断巡检 */ }
  }

  function emitState() {
    try {
      window.dispatchEvent(new CustomEvent(STATE_EVENT, {
        detail: { running, kind: activeKind, stopping }
      }));
    } catch (_) { /* 非 DOM 环境下忽略 */ }
  }

  function emitCompleted(detail) {
    try {
      window.dispatchEvent(new CustomEvent(COMPLETE_EVENT, { detail }));
    } catch (_) { /* 非 DOM 环境下忽略 */ }
  }

  function finiteTime(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * 归一化每批巡检条数。范围与钳制规则只在 MemoryAuditor 里定义一份，
   * 这里只做「取不到引擎时回落默认值」的兜底，避免 UI/配置/引擎三处各写一套常数。
   * @param {*} value
   * @returns {number} 1~300 之间的整数
   */
  function normalizeAuditBatchSize(value) {
    const aud = auditor();
    if (aud && typeof aud.normalizeBatchSize === 'function') {
      return aud.normalizeBatchSize(value);
    }
    // 引擎尚未加载（极早期或脚本缺失）时不影响配置读写，回落默认 100
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n <= 0) return 100;
    return n > 300 ? 300 : n;
  }

  function normalizeResult(value) {
    const src = value && typeof value === 'object' ? value : {};
    return {
      status: typeof src.status === 'string' ? src.status : '',
      at: finiteTime(src.at),
      merged: Math.max(0, Number(src.merged) || 0),
      skipped: Math.max(0, Number(src.skipped) || 0),
      failed: Math.max(0, Number(src.failed) || 0),
      groupCount: Math.max(0, Number(src.groupCount) || 0),
      recordCount: Math.max(0, Number(src.recordCount) || 0),
      error: typeof src.error === 'string' ? src.error.slice(0, 500) : '',
      stoppedAt: typeof src.stoppedAt === 'string' ? src.stoppedAt.slice(0, 100) : ''
    };
  }

  function normalizeConfig(value) {
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return Object.assign({}, src, {
      autoAuditEnabled: src.autoAuditEnabled === true,
      autoAuditEnabledAt: finiteTime(src.autoAuditEnabledAt),
      autoAuditNextDueAt: finiteTime(src.autoAuditNextDueAt),
      autoAuditLastCompletedAt: finiteTime(src.autoAuditLastCompletedAt),
      autoAuditLastAttemptAt: finiteTime(src.autoAuditLastAttemptAt),
      autoAuditRetryAt: finiteTime(src.autoAuditRetryAt),
      autoAuditLastResult: normalizeResult(src.autoAuditLastResult),
      // 每批巡检条数：手动与自动共用这一份设置。范围与钳制逻辑统一交给 MemoryAuditor，
      // 避免 UI、配置、引擎三处各写一套 1/300。
      auditBatchSize: normalizeAuditBatchSize(src.auditBatchSize)
    });
  }

  async function getConfig() {
    const st = getWin().Storage;
    if (!st || typeof st.getDoc !== 'function') return normalizeConfig(null);
    try {
      return normalizeConfig(await st.getDoc(configKey()));
    } catch (err) {
      console.error('[MemoryAutoAudit] 读取巡检配置失败:', err);
      return normalizeConfig(null);
    }
  }

  /** 浅合并保存，保留 memory/config 中其他模块或后续版本写入的字段。 */
  async function saveConfig(patch) {
    const st = getWin().Storage;
    if (!st || typeof st.getDoc !== 'function' || typeof st.setDoc !== 'function') {
      throw new Error('Storage 未初始化，无法保存巡检配置');
    }
    const current = await st.getDoc(configKey());
    const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
    const next = Object.assign({}, base, patch || {});
    const ok = await st.setDoc(configKey(), next);
    if (!ok) throw new Error('巡检配置写入失败');
    return normalizeConfig(next);
  }

  function isRunning() {
    return running;
  }

  function getState() {
    return { running, kind: activeKind, stopping, periodMs: PERIOD_MS, retryMs: RETRY_MS };
  }

  /**
   * 终止正在进行的巡检：中断当前请求，后续批次不再执行。
   * 已合并的记忆和巡检前备份都保留。
   * @returns {boolean} 是否发出了终止信号
   */
  function stop() {
    if (!running || !abortCtrl || abortCtrl.signal.aborted) return false;
    stopping = true;
    abortCtrl.abort();
    // 重试弹窗还开着时一并收掉，按「停止巡检」处理
    if (retryDialogOpen) {
      const modal = getWin().RetroModal;
      if (modal && typeof modal.close === 'function') modal.close(false);
    }
    emitState();
    return true;
  }

  /** 一批失败时询问重试或停止；没有弹窗模块时直接停止 */
  async function askBatchRetry(info) {
    const modal = getWin().RetroModal;
    if (!modal || typeof modal.confirm !== 'function') return 'stop';
    const reason = info.isTimeout ? '请求超过 180 秒未完成' : (info.error || '模型返回异常');
    const where = info.scope ? `「${info.scope}」` : '';
    retryDialogOpen = true;
    try {
      const ok = await modal.confirm({
        message: '这一批巡检没有完成',
        detail: `${where}${info.recordCount || 0} 条记忆：${reason}。重试会重新发送这一批；停止巡检会保留已合并的记忆。`,
        confirmText: '重试',
        cancelText: '停止巡检',
        danger: true
      });
      return ok ? 'retry' : 'stop';
    } finally {
      retryDialogOpen = false;
    }
  }

  async function setEnabled(enabled) {
    const on = enabled === true;
    const now = Date.now();
    if (on) {
      const config = await getConfig();
      if (config.autoAuditEnabled) return config;
      // 从本次开启起完整等待七天，避免刚打开开关就消耗 Token。
      return saveConfig({
        autoAuditEnabled: true,
        autoAuditEnabledAt: now,
        autoAuditNextDueAt: now + PERIOD_MS,
        autoAuditRetryAt: 0
      });
    }
    return saveConfig({
      autoAuditEnabled: false,
      autoAuditNextDueAt: 0,
      autoAuditRetryAt: 0
    });
  }

  /** 保存每批巡检条数。手动与自动共用这一个值；越界与非法输入统一由引擎钳制。 */
  async function setAuditBatchSize(size) {
    const value = normalizeAuditBatchSize(size);
    const saved = await saveConfig({ auditBatchSize: value });
    return saved;
  }

  function resultSummary(status, at, result, extra) {
    return normalizeResult(Object.assign({
      status,
      at,
      merged: result && result.merged,
      skipped: result && result.skipped,
      failed: result && result.failed,
      groupCount: result && result.groupCount,
      recordCount: result && result.recordCount,
      firstError: ''
    }, extra || {}, {
      error: (extra && extra.error) || (result && result.firstError) || ''
    }));
  }

  async function recordSuccess(kind, now, result, preflight) {
    const config = await getConfig();
    const patch = {
      autoAuditLastAttemptAt: now,
      autoAuditLastCompletedAt: now,
      autoAuditRetryAt: 0,
      autoAuditLastResult: resultSummary(
        preflight && preflight.groupCount === 0 ? 'no-candidates' : 'success',
        now,
        result,
        preflight || {}
      )
    };
    // 只有开关仍开启时才推进周期；手动巡检不会在关闭状态下偷偷启用它。
    if (config.autoAuditEnabled) patch.autoAuditNextDueAt = now + PERIOD_MS;
    await saveConfig(patch);
  }

  /**
   * 终止（含失败后在重试弹窗选「停止巡检」）不算失败：不设 24 小时补试。
   * 自动巡检把下次时间推到 7 天后，避免回到前台又立刻重跑。
   */
  async function recordStopped(kind, now, err, result, preflight) {
    const config = await getConfig();
    const patch = {
      autoAuditLastAttemptAt: now,
      autoAuditLastResult: resultSummary('stopped', now, result || {}, Object.assign({}, preflight || {}, {
        error: err && err.stopReason === 'failed' ? (err.message || '') : '',
        stoppedAt: (err && err.stoppedAt) || ''
      }))
    };
    if (kind === 'auto' && config.autoAuditEnabled) {
      patch.autoAuditRetryAt = 0;
      patch.autoAuditNextDueAt = now + PERIOD_MS;
    }
    try {
      await saveConfig(patch);
    } catch (saveErr) {
      console.error('[MemoryAutoAudit] 保存终止状态失败:', saveErr);
    }
  }

  async function recordFailure(kind, now, error, result, preflight) {
    const config = await getConfig();
    const summary = resultSummary('failed', now, result || {}, Object.assign({}, preflight || {}, {
      error: (error && error.message) || String(error || '未知错误')
    }));
    const patch = {
      autoAuditLastAttemptAt: now,
      autoAuditLastResult: summary
    };
    if (kind === 'auto' && config.autoAuditEnabled) {
      patch.autoAuditRetryAt = now + RETRY_MS;
      patch.autoAuditNextDueAt = now + RETRY_MS;
    }
    try {
      await saveConfig(patch);
    } catch (saveErr) {
      console.error('[MemoryAutoAudit] 保存失败状态失败:', saveErr);
    }
  }

  /**
   * 手动与自动共用的唯一执行入口。调用方不可绕过此函数并发执行 auditAll。
   */
  async function execute(kind) {
    if (running) return { ok: false, reason: 'busy', kind: activeKind };
    const source = kind === 'manual' ? 'manual' : 'auto';
    const aud = auditor();
    if (!aud) throw new Error('MemoryAuditor 未初始化');

    running = true;
    activeKind = source;
    stopping = false;
    abortCtrl = new AbortController();
    const signal = abortCtrl.signal;
    emitState();

    let preflight = null;
    let result = null;
    let config = null;
    try {
      // 每批条数在手动与自动两条路径共用，所以在此统一读一次配置，向下传给预检和真实巡检。
      config = await getConfig();
      if (source === 'auto' && typeof aud.inspectCandidates === 'function') {
        preflight = await aud.inspectCandidates({ batchSize: config.auditBatchSize });
        if (!preflight.groupCount) {
          const now = Date.now();
          const emptyResult = { merged: 0, skipped: 0, failed: 0 };
          await recordSuccess(source, now, emptyResult, preflight);
          return { ok: true, status: 'no-candidates', ...emptyResult, preflight };
        }
      }

      if (typeof aud.hasAvailableModel === 'function' && !aud.hasAvailableModel()) {
        throw new Error('没有可用的模型，请先配置辅助推理模型或主模型');
      }

      if (source === 'auto') {
        toast({
          message: '开始自动整理记忆',
          detail: `发现 ${preflight ? preflight.groupCount : '若干'} 组相似记忆，正在备份并整理`,
          type: 'info',
          duration: 4200
        });
      }

      // createBackup 内部会校验写入返回值；备份失败时这里不会进入 auditAll。
      await aud.createBackup();
      result = await aud.auditAll({ signal, onBatchError: askBatchRetry, batchSize: config.auditBatchSize });
      const now = Date.now();
      const failed = Math.max(0, Number(result.failed) || 0);

      if (failed > 0) {
        const partial = new Error(result.firstError || '部分巡检批次未完成');
        await recordFailure(source, now, partial, result, preflight);
        if ((Number(result.merged) || 0) > 0) {
          emitCompleted({ source, result: Object.assign({ status: 'partial' }, result) });
        }
        return Object.assign({ ok: false, partial: true, status: 'partial' }, result);
      }

      await recordSuccess(source, now, result, preflight);
      emitCompleted({ source, result: Object.assign({ status: 'success' }, result) });
      return Object.assign({ ok: true, status: 'success' }, result);
    } catch (err) {
      if (err && err.isAuditStop) {
        const partial = Object.assign({ merged: 0, skipped: 0, failed: 0, firstError: '' }, err.partial || {});
        await recordStopped(source, Date.now(), err, partial, preflight);
        if ((Number(partial.merged) || 0) > 0) {
          emitCompleted({ source, result: Object.assign({ status: 'stopped' }, partial) });
        }
        return Object.assign({
          ok: false,
          stopped: true,
          status: 'stopped',
          stopReason: err.stopReason || 'user',
          stoppedAt: err.stoppedAt || '',
          preflight
        }, partial);
      }
      await recordFailure(source, Date.now(), err, result, preflight);
      throw err;
    } finally {
      running = false;
      activeKind = '';
      stopping = false;
      abortCtrl = null;
      emitState();
    }
  }

  async function runManual() {
    return execute('manual');
  }

  function formatAutoResult(result) {
    const parts = [result.merged > 0 ? `合并 ${result.merged} 组记忆` : '没有合并记忆'];
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 组`);
    if (result.failed > 0) parts.push(`失败 ${result.failed} 批，将在 24 小时后补试`);
    return parts.join('，');
  }

  /** 到期检查可重复触发；配置时间与全局锁共同保证不会重复请求。 */
  async function checkDue(source) {
    if (running) return { ok: false, reason: 'busy' };
    const config = await getConfig();
    if (!config.autoAuditEnabled) return { ok: false, reason: 'disabled' };

    const now = Date.now();
    let dueAt = config.autoAuditNextDueAt;
    if (!dueAt && config.autoAuditEnabledAt) dueAt = config.autoAuditEnabledAt + PERIOD_MS;
    if (!dueAt) {
      // 老配置缺时间戳时只补齐周期，不立即执行。
      await saveConfig({
        autoAuditEnabledAt: now,
        autoAuditNextDueAt: now + PERIOD_MS,
        autoAuditRetryAt: 0
      });
      return { ok: false, reason: 'scheduled' };
    }
    if (now < dueAt) return { ok: false, reason: 'not-due', nextDueAt: dueAt };

    try {
      const result = await runAutomatic(source || 'schedule');
      return result;
    } catch (err) {
      console.error('[MemoryAutoAudit] 自动巡检失败:', err);
      return { ok: false, reason: 'error', error: (err && err.message) || String(err) };
    }
  }

  async function runAutomatic(source) {
    if (running) return { ok: false, reason: 'busy' };
    const result = await execute('auto');
    if (result.status === 'no-candidates') return result;

    if (result.ok) {
      toast({
        message: '自动记忆巡检完成',
        detail: formatAutoResult(result),
        type: 'success',
        duration: 4500
      });
    } else if (result.stopped) {
      const parts = [result.merged > 0 ? `已合并 ${result.merged} 组记忆` : '没有合并记忆'];
      if (result.stoppedAt) parts.push(`停在「${result.stoppedAt}」`);
      toast({
        message: '自动巡检已终止',
        detail: `${parts.join('，')}。下次自动巡检在 7 天后`,
        type: 'info',
        duration: 5200
      });
    } else if (result.partial) {
      toast({
        message: '自动巡检部分完成',
        detail: `${formatAutoResult(result)}。${result.firstError || ''}`,
        type: 'warn',
        duration: 6500
      });
    }
    return result;
  }

  function init() {
    if (initialized) return;
    initialized = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      checkDue('foreground').catch((err) => console.error('[MemoryAutoAudit] 前台检查失败:', err));
    });

    const boot = getWin().Boot;
    if (boot && typeof boot.onReady === 'function') {
      boot.onReady('MemoryAutoAudit', () => {
        window.setTimeout(() => {
          checkDue('boot').catch((err) => console.error('[MemoryAutoAudit] 启动检查失败:', err));
        }, BOOT_DELAY_MS);
      });
    }
  }

  init();

  return {
    PERIOD_MS,
    RETRY_MS,
    STATE_EVENT,
    COMPLETE_EVENT,
    getConfig,
    setEnabled,
    setAuditBatchSize,
    normalizeAuditBatchSize,
    getState,
    isRunning,
    checkDue,
    runManual,
    stop,
    formatTime(timestamp) {
      const t = finiteTime(timestamp);
      if (!t) return '尚未巡检';
      const d = new Date(t);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  };
})();

if (typeof window !== 'undefined') {
  window.MemoryAutoAudit = MemoryAutoAudit;
}
