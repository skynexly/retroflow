/**
 * ============================================================================
 * 溯流计划 · 生活服务后勤整备数据层 (Life Store)
 *
 * 职责：
 *   1. 六大板块（记账 ledger / 运动健康 fitness & weight / 经期 period /
 *      药盒 meds / 睡眠 sleep / 备忘录 memo）的持久化流水与配置管理。
 *   2. 流水记录统一落入 IndexedDB `records` 表，采用 `forkId = 'life:<module>'`
 *      分区前缀，天然支持 DataVault 独立备份、恢复与单域清理，绝不污染聊天或副本。
 *   3. 轻量配置（月度预算、多账户与信用透支、分期计划、收支分类库与子预算、
 *      双形态订阅与次卡卡包、经期周期参数、药盒常备清单）存入
 *      IndexedDB `docs` 表的 `life/config` 键下，并在内存中维护同步快照。
 * ============================================================================
 */
const LifeStore = (() => {
  'use strict';

  const CONFIG_DOC_KEY = 'life/config';
  const RECORD_PREFIX = 'life:';

  const MODULE_FORK = {
    ledger: 'life:ledger',
    fitness: 'life:fitness',
    weight: 'life:weight',
    diet: 'life:diet',
    period: 'life:period',
    periodLog: 'life:period_log',
    meds: 'life:meds_log',
    sleep: 'life:sleep',
    memo: 'life:memo'
  };

  const DEFAULT_ACCOUNTS = [
    {
      id: 'acc_wechat',
      name: '微信钱包',
      type: 'cash', // 'cash' | 'debit' | 'credit'
      iconKey: 'wallet',
      initialBalance: 0,
      includeInNetWorth: true,
      note: '日常移动支付'
    },
    {
      id: 'acc_alipay',
      name: '支付宝',
      type: 'cash',
      iconKey: 'bolt',
      initialBalance: 0,
      includeInNetWorth: true,
      note: '线上消费与生活缴费'
    },
    {
      id: 'acc_bank',
      name: '主力储蓄卡',
      type: 'debit',
      iconKey: 'bank',
      initialBalance: 0,
      includeInNetWorth: true,
      note: '工资入账与储蓄基准'
    },
    {
      id: 'acc_credit',
      name: '花呗 / 信用卡',
      type: 'credit',
      iconKey: 'credit',
      initialBalance: 0, // 对 credit 而言代表初始已用欠款（正数=欠款）
      includeInNetWorth: true,
      creditLimit: 10000,
      statementDay: 1,
      dueDay: 10,
      dailyInterestRate: 0.05, // 日利率 %（如 0.05 代表万分之五）
      note: '信用透支与账单管理'
    }
  ];

  const DEFAULT_LEDGER_CATEGORIES = {
    expense: [
      { id: 'cat_exp_food', type: 'expense', name: '餐饮补给', iconKey: 'food', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_drink', type: 'expense', name: '咖啡茶饮', iconKey: 'drink', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_trans', type: 'expense', name: '交通出行', iconKey: 'transit', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_shop', type: 'expense', name: '装备购物', iconKey: 'bag', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_cloth', type: 'expense', name: '服饰美妆', iconKey: 'sparkle', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_home', type: 'expense', name: '居住水电', iconKey: 'home', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_fun', type: 'expense', name: '娱乐订阅', iconKey: 'game', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_med', type: 'expense', name: '医疗健康', iconKey: 'medical', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_tech', type: 'expense', name: '数码算力', iconKey: 'chip', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_pet', type: 'expense', name: '宠物关怀', iconKey: 'paw', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_social', type: 'expense', name: '人情礼物', iconKey: 'gift', monthlyBudget: 0, builtin: true },
      { id: 'cat_exp_study', type: 'expense', name: '学习进修', iconKey: 'book', monthlyBudget: 0, builtin: true }
    ],
    income: [
      { id: 'cat_inc_salary', type: 'income', name: '薪酬津贴', iconKey: 'salary', monthlyBudget: 0, builtin: true },
      { id: 'cat_inc_bonus', type: 'income', name: '奖金绩效', iconKey: 'award', monthlyBudget: 0, builtin: true },
      { id: 'cat_inc_side', type: 'income', name: '兼职副业', iconKey: 'briefcase', monthlyBudget: 0, builtin: true },
      { id: 'cat_inc_invest', type: 'income', name: '理财收益', iconKey: 'trend', monthlyBudget: 0, builtin: true },
      { id: 'cat_inc_gift', type: 'income', name: '红包礼金', iconKey: 'gift', monthlyBudget: 0, builtin: true },
      { id: 'cat_inc_other', type: 'income', name: '其他入账', iconKey: 'layers', monthlyBudget: 0, builtin: true }
    ]
  };

  const DEFAULT_CONFIG = {
    monthlyBudget: 3000,
    currencySymbol: '¥',
    weekStartsOnMonday: true,
    initialWeight: null,
    targetWeight: 52.0,
    dailyCalorieGoal: 400,
    sleepGoalHours: 8.0,
    periodCycleDays: 28,
    periodDurationDays: 5,
    accounts: DEFAULT_ACCOUNTS,
    ledgerCategories: DEFAULT_LEDGER_CATEGORIES,
    installments: [],
    valueCards: [],
    // 药盒常备方案清单
    medPlans: [
      { id: 'med_default_1', name: '复合维生素 B 族', dose: '1 粒', slot: 'MORNING // 晨间', active: true },
      { id: 'med_default_2', name: '深海鱼油 Omega-3', dose: '2 粒', slot: 'NOON // 午后', active: true },
      { id: 'med_default_3', name: '镁剂缓释片', dose: '1 片', slot: 'NIGHT // 睡前', active: true }
    ],
    // 订阅协议常驻清单（支持 recurring 周期续费 / onetime 一次性限时 / lifetime 买断摊销）
    subscriptions: [],
    // 运动计划清单（支持定量目标时长/打卡次数，或无目标自由计划）
    fitnessPlans: []
  };

  let configCache = null;
  let initialized = false;

  function cloneDefaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /** 解析 YYYY-MM-DD 为本地零点 Date */
  function parseDateKeyLocal(dk) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dk || '').trim());
    if (!m) {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  /** 在日期键基础上推进 N 个日/周/月/年，返回新的 YYYY-MM-DD */
  function addCycleToDateKey(dateKeyStr, cycle, count) {
    const d = parseDateKeyLocal(dateKeyStr);
    const step = Math.max(1, Math.round(Number(count) || 1));
    if (cycle === 'daily') {
      d.setDate(d.getDate() + step);
    } else if (cycle === 'weekly') {
      d.setDate(d.getDate() + step * 7);
    } else if (cycle === 'yearly') {
      const origDay = d.getDate();
      d.setDate(1);
      d.setFullYear(d.getFullYear() + step);
      const maxD = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(origDay, maxD));
    } else {
      const origDay = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + step);
      const maxD = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(origDay, maxD));
    }
    return toDateKey(d.getTime());
  }

  /** 计算目标 YYYY-MM-DD 距离参考日的天数差（正数=未来剩余天数，负数=已过去天数） */
  function diffDaysFromRef(targetDateKey, refDate) {
    const now = refDate || new Date();
    const refMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const tgtMid = parseDateKeyLocal(targetDateKey).getTime();
    return Math.round((tgtMid - refMid) / 86400000);
  }

  /** 严格校验 YYYY-MM-DD，拒绝 2 月 30 日等会被 Date 自动进位的伪日期 */
  function isValidDateKey(dateKeyStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKeyStr || '').trim());
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
  }

  /** 在合法日期键上推进 N 天（N 可为负数），始终使用本地零点避免时区漂移 */
  function addDaysToDateKey(dateKeyStr, days) {
    if (!isValidDateKey(dateKeyStr)) return '';
    const d = parseDateKeyLocal(dateKeyStr);
    d.setDate(d.getDate() + Math.round(Number(days) || 0));
    return toDateKey(d.getTime());
  }

  function clampPeriodInteger(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  /**
   * 经期纯函数推算。持续天数包含首日：
   * 预计结束 = 首日 + 持续天数 - 1；预计下次开始 = 首日 + 周期长度。
   * actualEndDate 只代表人工确认/延长的目标，不会自动生成下一次经期。
   */
  function calcPeriodPrediction({ startDate, durationDays = 5, cycleDays = 28, actualEndDate = '' }) {
    if (!isValidDateKey(startDate)) return null;
    const duration = clampPeriodInteger(durationDays, 2, 15, 5);
    const cycle = clampPeriodInteger(cycleDays, 15, 60, 28);
    const predictedEndDate = addDaysToDateKey(startDate, duration - 1);
    const nextStartDate = addDaysToDateKey(startDate, cycle);
    const hasActualEnd = isValidDateKey(actualEndDate) && diffDaysFromRef(actualEndDate, parseDateKeyLocal(startDate)) >= 0;
    const targetEndDate = hasActualEnd ? actualEndDate : predictedEndDate;
    const effectiveDurationDays = Math.max(1, diffDaysFromRef(targetEndDate, parseDateKeyLocal(startDate)) + 1);
    return {
      startDate,
      durationDays: duration,
      cycleDays: cycle,
      predictedEndDate,
      nextStartDate,
      actualEndDate: hasActualEnd ? actualEndDate : '',
      targetEndDate,
      effectiveDurationDays
    };
  }

  function normalizePeriodRecord(record, fallbackConfig) {
    const cfg = fallbackConfig || configCache || DEFAULT_CONFIG;
    const startDate = isValidDateKey(record && record.startDate) ? record.startDate : (record && record.dateKey) || toDateKey(record && record.createdAt);
    if (!isValidDateKey(startDate)) return null;
    const durationDays = clampPeriodInteger(record && (record.durationDays || record.days), 2, 15, cfg.periodDurationDays || 5);
    const cycleDays = clampPeriodInteger(record && record.cycleDays, 15, 60, cfg.periodCycleDays || 28);
    // 兼容旧数据：无 status 的历史记录全部作为已结束，不冒充当前进行中周期。
    const status = record && record.status === 'active' ? 'active' : 'ended';
    const rawEnd = record && record.actualEndDate;
    const actualEndDate = isValidDateKey(rawEnd) && diffDaysFromRef(rawEnd, parseDateKeyLocal(startDate)) >= 0 ? rawEnd : '';
    const prediction = calcPeriodPrediction({ startDate, durationDays, cycleDays, actualEndDate });
    return Object.assign({}, record, {
      startDate,
      dateKey: startDate,
      durationDays,
      days: durationDays,
      cycleDays,
      actualEndDate,
      status,
      predictedEndDate: prediction.predictedEndDate,
      nextStartDate: prediction.nextStartDate,
      targetEndDate: prediction.targetEndDate,
      effectiveDurationDays: prediction.effectiveDurationDays
    });
  }

  function buildPeriodState(records, todayKey) {
    const list = (Array.isArray(records) ? records : []).map((r) => normalizePeriodRecord(r)).filter(Boolean);
    const active = list.find((r) => r.status === 'active') || null;
    const latest = active || list[0] || null;
    const base = {
      phaseCode: 'STANDBY', phaseZh: '待校准', dayInCycle: 0, daysUntilNext: '--', lastStartDate: '--',
      status: 'none', activePeriod: null, currentPeriod: null, predictedEndDate: '', nextStartDate: '',
      targetEndDate: '', currentDay: 0, awaitingEndConfirm: false
    };
    if (!latest) return base;
    const startDate = latest.startDate;
    const prediction = calcPeriodPrediction(latest);
    const dayInCycle = Math.max(1, diffDaysFromRef(todayKey, parseDateKeyLocal(startDate)) + 1);
    const daysUntilNext = Math.max(0, diffDaysFromRef(prediction.nextStartDate, parseDateKeyLocal(todayKey)));
    if (latest.status === 'active') {
      const awaitingEndConfirm = diffDaysFromRef(todayKey, parseDateKeyLocal(prediction.targetEndDate)) > 0;
      return Object.assign(base, {
        phaseCode: awaitingEndConfirm ? 'AWAIT_END' : 'MENSTRUAL',
        phaseZh: awaitingEndConfirm ? '等待确认结束' : '经期行进中',
        dayInCycle, daysUntilNext, lastStartDate: startDate, status: 'active', activePeriod: latest, currentPeriod: latest,
        predictedEndDate: prediction.predictedEndDate, nextStartDate: prediction.nextStartDate,
        targetEndDate: prediction.targetEndDate, currentDay: dayInCycle, awaitingEndConfirm
      });
    }
    let phaseCode = 'FOLLICULAR';
    let phaseZh = '周期间隔中';
    const dayAfterCycle = dayInCycle - latest.cycleDays;
    if (dayAfterCycle >= latest.cycleDays - 16 && dayAfterCycle <= latest.cycleDays - 12) {
      phaseCode = 'OVULATION'; phaseZh = '排卵高敏窗';
    } else if (dayAfterCycle > latest.cycleDays - 12 && dayAfterCycle <= latest.cycleDays) {
      phaseCode = 'LUTEAL'; phaseZh = '黄体蓄能期';
    }
    return Object.assign(base, {
      phaseCode, phaseZh, dayInCycle, daysUntilNext, lastStartDate: startDate, status: 'ended',
      predictedEndDate: prediction.predictedEndDate, nextStartDate: prediction.nextStartDate,
      targetEndDate: prediction.targetEndDate, currentDay: dayInCycle
    });
  }

  /** 新周期锁定登记当时的持续天数与周期长度，未来配置变更不回溯历史 */
  async function startPeriod(payload) {
    if (!initialized) await loadConfig();
    const input = payload || {};
    const startDate = input.startDate || toDateKey();
    if (!isValidDateKey(startDate)) throw new Error('请选择合法的经期首日');
    const existing = await listModuleRecords('period');
    const normalized = existing.map((r) => normalizePeriodRecord(r)).filter(Boolean);
    if (normalized.some((r) => r.status === 'active')) throw new Error('当前已有进行中的经期，请先确认结束');
    if (normalized.some((r) => r.startDate === startDate)) throw new Error('该首日已有经期记录，请编辑原记录');
    const durationDays = clampPeriodInteger(input.durationDays, 2, 15, configCache.periodDurationDays || 5);
    const cycleDays = clampPeriodInteger(input.cycleDays, 15, 60, configCache.periodCycleDays || 28);
    return await addModuleRecord('period', {
      startDate, dateKey: startDate, durationDays, days: durationDays, cycleDays,
      status: 'active', actualEndDate: '', startedAt: Date.now(),
      note: String(input.note || '').trim().slice(0, 500)
    });
  }

  /** 延长当前经期只更新本次目标结束日，保持 active，等待人工确认 */
  async function extendPeriod(recordId, payload) {
    const list = await listModuleRecords('period');
    const target = list.find((r) => r.id === recordId);
    if (!target) throw new Error('找不到本次经期记录');
    const current = normalizePeriodRecord(target);
    if (current.status !== 'active') throw new Error('只有进行中的经期可以延长');
    const input = payload || {};
    let actualEndDate = input.actualEndDate || '';
    if (!actualEndDate && Number(input.days) > 0) actualEndDate = addDaysToDateKey(current.targetEndDate, Number(input.days));
    if (!isValidDateKey(actualEndDate)) throw new Error('请选择合法的延长结束日');
    if (diffDaysFromRef(actualEndDate, parseDateKeyLocal(current.targetEndDate)) <= 0) throw new Error('延长结束日必须晚于当前目标结束日');
    return await updateModuleRecord('period', recordId, {
      actualEndDate, status: 'active', durationDays: current.durationDays, days: current.durationDays,
      cycleDays: current.cycleDays, extendedAt: Date.now()
    });
  }

  /** 提前结束或到期确认结束，仅写入本次 actualEndDate */
  async function endPeriod(recordId, actualEndDate) {
    const list = await listModuleRecords('period');
    const target = list.find((r) => r.id === recordId);
    if (!target) throw new Error('找不到本次经期记录');
    const current = normalizePeriodRecord(target);
    if (current.status !== 'active') throw new Error('本次经期已经结束');
    const endKey = actualEndDate || toDateKey();
    if (!isValidDateKey(endKey) || diffDaysFromRef(endKey, parseDateKeyLocal(current.startDate)) < 0) throw new Error('实际结束日不能早于经期首日');
    return await updateModuleRecord('period', recordId, {
      actualEndDate: endKey, status: 'ended', endedAt: Date.now(),
      durationDays: current.durationDays, days: current.durationDays, cycleDays: current.cycleDays
    });
  }

  /** 历史/当前经期日期修正，锁定的周期参数保持不变 */
  async function updatePeriodRecord(recordId, patch) {
    const list = await listModuleRecords('period');
    const target = list.find((r) => r.id === recordId);
    if (!target) throw new Error('找不到这条经期记录');
    const current = normalizePeriodRecord(target);
    const input = patch || {};
    const startDate = input.startDate || current.startDate;
    if (!isValidDateKey(startDate)) throw new Error('请选择合法的经期首日');
    if (list.some((r) => r.id !== recordId && r.startDate === startDate)) throw new Error('该首日已有另一条经期记录');
    const rawEnd = Object.prototype.hasOwnProperty.call(input, 'actualEndDate') ? input.actualEndDate : current.actualEndDate;
    const actualEndDate = rawEnd || '';
    if (actualEndDate && (!isValidDateKey(actualEndDate) || diffDaysFromRef(actualEndDate, parseDateKeyLocal(startDate)) < 0)) throw new Error('实际结束日不能早于经期首日');
    return await updateModuleRecord('period', recordId, {
      startDate, dateKey: startDate, actualEndDate,
      durationDays: current.durationDays, days: current.durationDays, cycleDays: current.cycleDays,
      status: current.status
    });
  }

  /** 每日体感以 dateKey 为唯一业务键，同日覆盖且保留原 id/createdAt */
  async function savePeriodDailyLog(payload) {
    const input = payload || {};
    const dateKey = input.dateKey || toDateKey();
    if (!isValidDateKey(dateKey)) throw new Error('请选择合法的体感记录日期');
    const note = String(input.note || '').trim().slice(0, 2000);
    if (!note) throw new Error('请填写当日体感');
    const list = await listModuleRecords('periodLog');
    const existing = list.find((r) => r.dateKey === dateKey);
    if (existing) return await updateModuleRecord('periodLog', existing.id, { dateKey, note });
    return await addModuleRecord('periodLog', { dateKey, note, loggedAt: Date.now() });
  }

  function normalizeAccount(a, idx) {
    const type = (a.type === 'credit' || a.type === 'debit') ? a.type : 'cash';
    const initBal = Number(a.initialBalance);
    const out = {
      id: String(a.id || `acc_${Date.now()}_${idx}`),
      name: String(a.name || '未命名账户').trim().slice(0, 24),
      type,
      iconKey: String(a.iconKey || (type === 'credit' ? 'credit' : type === 'debit' ? 'bank' : 'wallet')).trim(),
      initialBalance: Number.isFinite(initBal) ? Number(initBal.toFixed(2)) : 0,
      includeInNetWorth: a.includeInNetWorth !== false,
      note: String(a.note || '').trim().slice(0, 40)
    };
    if (type === 'credit') {
      const lim = Number(a.creditLimit);
      const sDay = Math.round(Number(a.statementDay) || 1);
      const dDay = Math.round(Number(a.dueDay) || 10);
      const rate = Number(a.dailyInterestRate);
      out.creditLimit = Number.isFinite(lim) && lim >= 0 ? Number(lim.toFixed(2)) : 10000;
      out.statementDay = Math.min(31, Math.max(1, sDay));
      out.dueDay = Math.min(31, Math.max(1, dDay));
      out.dailyInterestRate = Number.isFinite(rate) && rate >= 0 ? Number(rate.toFixed(4)) : 0.05;
    }
    return out;
  }

  function normalizeCategoryItem(c, forceType, idx) {
    const b = Number(c.monthlyBudget);
    return {
      id: String(c.id || `cat_${forceType}_${Date.now()}_${idx}`),
      type: forceType,
      name: String(c.name || '未命名分类').trim().slice(0, 16),
      iconKey: String(c.iconKey || (forceType === 'income' ? 'salary' : 'food')).trim(),
      monthlyBudget: Number.isFinite(b) && b > 0 ? Number(b.toFixed(2)) : 0,
      builtin: Boolean(c.builtin)
    };
  }

  function normalizeInstallment(ins, idx) {
    const principal = Math.max(0, Number(ins.principal) || 0);
    const periods = Math.max(1, Math.min(60, Math.round(Number(ins.periods) || 3)));
    const feeRate = Math.max(0, Number(ins.feeRatePerPeriod) || 0);
    const fixedFee = Math.max(0, Number(ins.fixedFeePerPeriod) || 0);
    const paidPeriods = Math.max(0, Math.min(periods, Math.round(Number(ins.paidPeriods) || 0)));
    return {
      id: String(ins.id || `ins_${Date.now()}_${idx}`),
      accountId: String(ins.accountId || 'acc_credit'),
      title: String(ins.title || '分期账单').trim().slice(0, 28),
      principal: Number(principal.toFixed(2)),
      periods,
      feeRatePerPeriod: Number(feeRate.toFixed(4)),
      fixedFeePerPeriod: Number(fixedFee.toFixed(2)),
      paidPeriods,
      startDateKey: String(ins.startDateKey || toDateKey()),
      active: ins.active !== false && paidPeriods < periods
    };
  }

  function normalizeFitnessPlan(p, idx) {
    const now = Date.now();
    const hasMin = p && p.targetMinutes !== '' && p.targetMinutes !== null && p.targetMinutes !== undefined;
    const hasCnt = p && p.targetCheckins !== '' && p.targetCheckins !== null && p.targetCheckins !== undefined;
    const rawMin = hasMin ? Number(p.targetMinutes) : NaN;
    const rawCnt = hasCnt ? Number(p.targetCheckins) : NaN;
    const createdAt = Number(p && p.createdAt) > 0 ? Number(p.createdAt) : now;
    const updatedAt = Number(p && p.updatedAt) > 0 ? Number(p.updatedAt) : createdAt;
    return {
      id: String((p && p.id) || `fplan_${now}_${idx}`),
      name: String((p && p.name) || '未命名计划').trim().slice(0, 32),
      description: String((p && p.description) || '').trim().slice(0, 120),
      targetMinutes: Number.isFinite(rawMin) && rawMin > 0 ? Math.round(rawMin) : null,
      targetCheckins: Number.isFinite(rawCnt) && rawCnt > 0 ? Math.max(1, Math.round(rawCnt)) : null,
      isLegacyBucket: Boolean(p && p.isLegacyBucket),
      createdAt,
      updatedAt
    };
  }

  function normalizeConfig(raw) {
    const base = cloneDefaultConfig();
    if (!raw || typeof raw !== 'object') return base;

    const budget = Number(raw.monthlyBudget);
    if (Number.isFinite(budget) && budget >= 0) base.monthlyBudget = budget;

    if (typeof raw.currencySymbol === 'string' && raw.currencySymbol.trim()) {
      base.currencySymbol = raw.currencySymbol.trim().slice(0, 4);
    }

    if (typeof raw.weekStartsOnMonday === 'boolean') {
      base.weekStartsOnMonday = raw.weekStartsOnMonday;
    }

    const tw = Number(raw.targetWeight);
    if (Number.isFinite(tw) && tw > 0) base.targetWeight = Number(tw.toFixed(1));

    if (raw.initialWeight !== null && raw.initialWeight !== undefined && String(raw.initialWeight).trim() !== '') {
      const iw = Number(raw.initialWeight);
      if (Number.isFinite(iw) && iw > 0) base.initialWeight = Number(iw.toFixed(1));
    }

    const cal = Number(raw.dailyCalorieGoal);
    if (Number.isFinite(cal) && cal > 0) base.dailyCalorieGoal = Math.round(cal);

    const sh = Number(raw.sleepGoalHours);
    if (Number.isFinite(sh) && sh > 0 && sh <= 24) base.sleepGoalHours = Number(sh.toFixed(1));

    const pCycle = Number(raw.periodCycleDays);
    if (Number.isFinite(pCycle) && pCycle >= 15 && pCycle <= 60) base.periodCycleDays = Math.round(pCycle);

    const pDur = Number(raw.periodDurationDays);
    if (Number.isFinite(pDur) && pDur >= 2 && pDur <= 15) base.periodDurationDays = Math.round(pDur);

    if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
      base.accounts = raw.accounts
        .filter((a) => a && typeof a === 'object' && a.name)
        .map((a, idx) => normalizeAccount(a, idx));
      if (!base.accounts.length) base.accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    }

    if (raw.ledgerCategories && typeof raw.ledgerCategories === 'object') {
      if (Array.isArray(raw.ledgerCategories.expense) && raw.ledgerCategories.expense.length > 0) {
        base.ledgerCategories.expense = raw.ledgerCategories.expense
          .filter((c) => c && typeof c === 'object' && c.name)
          .map((c, i) => normalizeCategoryItem(c, 'expense', i));
      }
      if (Array.isArray(raw.ledgerCategories.income) && raw.ledgerCategories.income.length > 0) {
        base.ledgerCategories.income = raw.ledgerCategories.income
          .filter((c) => c && typeof c === 'object' && c.name)
          .map((c, i) => normalizeCategoryItem(c, 'income', i));
      }
    }

    if (Array.isArray(raw.installments)) {
      base.installments = raw.installments
        .filter((ins) => ins && typeof ins === 'object' && ins.title)
        .map((ins, idx) => normalizeInstallment(ins, idx));
    }

    if (Array.isArray(raw.valueCards)) {
      base.valueCards = raw.valueCards
        .filter((vc) => vc && typeof vc === 'object' && vc.name)
        .map((vc, idx) => {
          const cardType = vc.cardType === 'balance' ? 'balance' : 'count';
          const totalValue = Math.max(0, Number(vc.totalValue) || 0);
          const remainRaw = vc.remainValue !== undefined ? Number(vc.remainValue) : totalValue;
          return {
            id: String(vc.id || `vc_${Date.now()}_${idx}`),
            name: String(vc.name || '').trim().slice(0, 28),
            cardType,
            unit: String(vc.unit || (cardType === 'balance' ? '元' : '次')).trim().slice(0, 6),
            totalValue: Number(totalValue.toFixed(2)),
            remainValue: Number(Math.max(0, remainRaw).toFixed(2)),
            costPaid: Number(Math.max(0, Number(vc.costPaid) || 0).toFixed(2)),
            startDate: String(vc.startDate || toDateKey()),
            expireDate: String(vc.expireDate || ''),
            tag: String(vc.tag || (cardType === 'balance' ? 'CARD' : 'PASS')).trim().toUpperCase().slice(0, 10),
            accountId: String(vc.accountId || ''),
            logs: Array.isArray(vc.logs) ? vc.logs.slice(0, 12) : []
          };
        });
    }

    if (Array.isArray(raw.medPlans)) {
      base.medPlans = raw.medPlans
        .filter((m) => m && typeof m === 'object' && m.name)
        .map((m, idx) => ({
          id: String(m.id || `med_${Date.now()}_${idx}`),
          name: String(m.name || '').trim(),
          dose: String(m.dose || '1 份').trim(),
          slot: String(m.slot || 'DAILY // 日常').trim(),
          active: m.active !== false
        }));
    }

    const LEGACY_SEED_SUB_IDS = { sub_default_1: true, sub_default_2: true, sub_default_3: true };
    if (Array.isArray(raw.subscriptions)) {
      base.subscriptions = raw.subscriptions
        .filter((s) => s && typeof s === 'object' && s.name && !LEGACY_SEED_SUB_IDS[s.id])
        .map((s, idx) => {
          const subMode = (s.subMode === 'onetime' || s.subMode === 'lifetime') ? s.subMode : 'recurring';
          const cycle = (s.cycle === 'yearly' || s.cycle === 'weekly' || s.cycle === 'daily') ? s.cycle : 'monthly';
          const intervalCount = Math.max(1, Math.round(Number(s.intervalCount) || 1));
          const billDay = Math.min(31, Math.max(1, Math.round(Number(s.billDay) || 15)));
          const startDate = String(s.startDate || toDateKey());
          let nextBillDate = String(s.nextBillDate || '');
          if (subMode === 'recurring' && !nextBillDate) {
            const nowD = new Date();
            const y = nowD.getFullYear();
            const m = nowD.getMonth();
            const maxCur = new Date(y, m + 1, 0).getDate();
            let cand = new Date(y, m, Math.min(billDay, maxCur));
            const todayMid = new Date(y, m, nowD.getDate());
            if (cand < todayMid) {
              const maxNext = new Date(y, m + 2, 0).getDate();
              cand = new Date(y, m + 1, Math.min(billDay, maxNext));
            }
            nextBillDate = toDateKey(cand.getTime());
          }
          let expireDate = String(s.expireDate || '');
          if (subMode === 'onetime' && !expireDate) {
            expireDate = addCycleToDateKey(startDate, cycle, intervalCount);
          }
          return {
            id: String(s.id || `sub_${Date.now()}_${idx}`),
            name: String(s.name || '').trim().slice(0, 28),
            subMode,
            price: Number(Math.max(0, Number(s.price) || 0).toFixed(2)),
            cycle,
            intervalCount,
            autoRenew: subMode === 'recurring' ? (s.autoRenew !== false) : false,
            billDay,
            startDate,
            nextBillDate,
            expireDate,
            tag: String(s.tag || (subMode === 'lifetime' ? 'LIFE' : subMode === 'onetime' ? 'PACK' : 'SUB')).trim().toUpperCase().slice(0, 10),
            accountId: String(s.accountId || ''),
            category: String(s.category || '娱乐订阅')
          };
        });
    }

    if (Array.isArray(raw.fitnessPlans)) {
      base.fitnessPlans = raw.fitnessPlans
        .filter((p) => p && typeof p === 'object' && String(p.name || '').trim())
        .map((p, idx) => normalizeFitnessPlan(p, idx));
    }

    return base;
  }

  configCache = normalizeConfig(DEFAULT_CONFIG);

  /** 初始化装载配置 */
  async function loadConfig() {
    try {
      if (window.Storage && typeof Storage.getDoc === 'function') {
        const saved = await Storage.getDoc(CONFIG_DOC_KEY, null);
        configCache = normalizeConfig(saved);
        if (saved && Array.isArray(saved.subscriptions) && saved.subscriptions.some((s) => s && (s.id === 'sub_default_1' || s.id === 'sub_default_2' || s.id === 'sub_default_3'))) {
          if (typeof Storage.setDoc === 'function') {
            await Storage.setDoc(CONFIG_DOC_KEY, configCache);
          }
        }
      } else if (!configCache) {
        configCache = normalizeConfig(DEFAULT_CONFIG);
      }
      initialized = true;
    } catch (err) {
      console.warn('[LifeStore] 读取后勤配置失败：', err);
      configCache = normalizeConfig(DEFAULT_CONFIG);
    }
    return configCache;
  }

  /** 获取当前配置快照 */
  function getConfig() {
    return configCache;
  }

  /** 保存并更新配置 */
  async function saveConfig(patch) {
    const merged = Object.assign({}, configCache, patch || {});
    configCache = normalizeConfig(merged);
    if (window.Storage && typeof Storage.setDoc === 'function') {
      const ok = await Storage.setDoc(CONFIG_DOC_KEY, configCache);
      return ok;
    }
    return false;
  }

  /** 生成当天日期键 YYYY-MM-DD */
  function toDateKey(ts) {
    const d = ts ? new Date(ts) : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /** 计算距每月固定日 (1~31) 的剩余天数 */
  function calcDaysUntilDayOfMonth(targetDay, refDate) {
    const now = refDate || new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const todayStart = new Date(y, m, now.getDate()).getTime();
    const maxDayCurMonth = new Date(y, m + 1, 0).getDate();
    let candidate = new Date(y, m, Math.min(targetDay, maxDayCurMonth)).getTime();
    if (candidate < todayStart) {
      const maxDayNextMonth = new Date(y, m + 2, 0).getDate();
      candidate = new Date(y, m + 1, Math.min(targetDay, maxDayNextMonth)).getTime();
    }
    return Math.max(0, Math.round((candidate - todayStart) / 86400000));
  }

  /** 分期计划利息与近似年化试算（纯函数，供 UI 实时预览与入库复用） */
  function calcInstallmentMetrics(principal, periods, feeRatePerPeriod, fixedFeePerPeriod) {
    const P = Math.max(0, Number(principal) || 0);
    const N = Math.max(1, Math.round(Number(periods) || 1));
    const rate = Math.max(0, Number(feeRatePerPeriod) || 0); // % per period
    const fixed = Math.max(0, Number(fixedFeePerPeriod) || 0);

    const principalPerPeriod = P / N;
    const feePerPeriod = fixed > 0 ? fixed : (P * (rate / 100));
    const payPerPeriod = principalPerPeriod + feePerPeriod;
    const totalFee = feePerPeriod * N;
    const totalPay = P + totalFee;
    // 资金平均占用近似法 IRR 年化估算: APR ≈ (总手续费 / 本金) / (期数/12) * (2N / (N + 1))
    const approxApr = P > 0
      ? ((totalFee / P) / (N / 12)) * ((2 * N) / (N + 1)) * 100
      : 0;

    return {
      principal: Number(P.toFixed(2)),
      periods: N,
      principalPerPeriod: Number(principalPerPeriod.toFixed(2)),
      feePerPeriod: Number(feePerPeriod.toFixed(2)),
      payPerPeriod: Number(payPerPeriod.toFixed(2)),
      totalFee: Number(totalFee.toFixed(2)),
      totalPay: Number(totalPay.toFixed(2)),
      approxApr: Number(approxApr.toFixed(2))
    };
  }

  /** 读取指定板块流水（按日期与创建时间倒序，最新在前） */
  async function listModuleRecords(moduleKey) {
    const forkId = MODULE_FORK[moduleKey] || `${RECORD_PREFIX}${moduleKey}`;
    if (!window.Storage || typeof Storage.getRecordsByFork !== 'function') return [];
    const list = await Storage.getRecordsByFork(forkId);
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
      if (moduleKey === 'ledger') {
        const da = String(a.dateKey || '');
        const db = String(b.dateKey || '');
        if (da !== db) return db.localeCompare(da);
      }
      if (moduleKey === 'diet') {
        const da = String(a.dateKey || '');
        const db = String(b.dateKey || '');
        if (da !== db) return db.localeCompare(da);
        const ta = Number(a.occurredAt) || Number(a.createdAt) || 0;
        const tb = Number(b.occurredAt) || Number(b.createdAt) || 0;
        if (ta !== tb) return tb - ta;
      }
      if (moduleKey === 'fitness' || moduleKey === 'weight') {
        const ta = Number(a.occurredAt) || Number(a.createdAt) || 0;
        const tb = Number(b.occurredAt) || Number(b.createdAt) || 0;
        if (ta !== tb) return tb - ta;
      }
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  /** 新增或覆盖一条板块记录 */
  async function addModuleRecord(moduleKey, payload) {
    const forkId = MODULE_FORK[moduleKey] || `${RECORD_PREFIX}${moduleKey}`;
    const now = Date.now();
    const id = (payload && payload.id)
      ? String(payload.id)
      : `life_${moduleKey}_${now}_${Math.random().toString(36).slice(2, 7)}`;

    const record = Object.assign({}, payload, {
      id,
      kind: `life:${moduleKey}`,
      forkId,
      dateKey: (payload && payload.dateKey) ? payload.dateKey : toDateKey(payload && payload.createdAt ? payload.createdAt : now),
      createdAt: (payload && Number(payload.createdAt)) ? Number(payload.createdAt) : now
    });

    await Storage.putRecord(record);
    return record;
  }

  /** 编辑更新一条已有板块记录（保留原 id、归属与创建时间） */
  async function updateModuleRecord(moduleKey, recordId, patch) {
    if (!recordId) return null;
    const list = await listModuleRecords(moduleKey);
    const target = list.find((r) => r.id === recordId);
    if (!target) return null;
    const updated = Object.assign({}, target, patch || {}, {
      id: target.id,
      kind: `life:${moduleKey}`,
      forkId: target.forkId || MODULE_FORK[moduleKey] || `${RECORD_PREFIX}${moduleKey}`,
      createdAt: target.createdAt,
      updatedAt: Date.now()
    });
    await Storage.putRecord(updated);
    return updated;
  }

  /** 编辑更新一条已有记账流水（保留原 id 与 createdAt，联动重算全盘余额） */
  async function updateLedgerRecord(recordId, patch) {
    if (!recordId) return null;
    const list = await listModuleRecords('ledger');
    const target = list.find((r) => r.id === recordId);
    if (!target) return null;
    const updated = Object.assign({}, target, patch || {}, {
      id: target.id,
      kind: 'life:ledger',
      forkId: MODULE_FORK.ledger,
      updatedAt: Date.now()
    });
    await Storage.putRecord(updated);
    return updated;
  }

  /** 删除单条流水记录 */
  async function deleteRecord(recordId) {
    if (!recordId || !window.Storage || typeof Storage.removeRecord !== 'function') return false;
    return await Storage.removeRecord(recordId);
  }

  /** 新增或编辑保存运动计划 */
  async function saveFitnessPlan(payload) {
    if (!initialized) await loadConfig();
    const name = String((payload && payload.name) || '').trim().slice(0, 32);
    if (!name) return null;
    const now = Date.now();
    const plans = Array.isArray(configCache.fitnessPlans) ? configCache.fitnessPlans.slice() : [];
    const editId = payload && payload.id ? String(payload.id) : '';
    const idx = editId ? plans.findIndex((p) => p.id === editId) : -1;

    const normalized = normalizeFitnessPlan({
      id: idx >= 0 ? plans[idx].id : `fplan_${now}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      description: payload && payload.description !== undefined ? payload.description : (idx >= 0 ? plans[idx].description : ''),
      targetMinutes: payload ? payload.targetMinutes : null,
      targetCheckins: payload ? payload.targetCheckins : null,
      isLegacyBucket: idx >= 0 ? Boolean(plans[idx].isLegacyBucket) : false,
      createdAt: idx >= 0 ? plans[idx].createdAt : now,
      updatedAt: now
    }, idx >= 0 ? idx : plans.length);

    if (idx >= 0) {
      plans[idx] = normalized;
    } else {
      plans.unshift(normalized);
    }
    await saveConfig({ fitnessPlans: plans });
    return normalized;
  }

  /** 删除运动计划并级联清理其名下所有打卡记录 */
  async function deleteFitnessPlan(planId) {
    if (!planId) return null;
    if (!initialized) await loadConfig();
    const plans = Array.isArray(configCache.fitnessPlans) ? configCache.fitnessPlans : [];
    const nextPlans = plans.filter((p) => p.id !== planId);
    await saveConfig({ fitnessPlans: nextPlans });

    const records = await listModuleRecords('fitness');
    const matched = records.filter((r) => r.planId === planId);
    if (matched.length > 0) {
      await Promise.all(matched.map((r) => deleteRecord(r.id)));
    }
    return { deletedPlanId: planId, deletedCheckins: matched.length };
  }

  /** 编辑更新一条运动打卡记录（保留原 id / planId / createdAt） */
  async function updateFitnessRecord(recordId, patch) {
    if (!recordId || !window.Storage || typeof Storage.putRecord !== 'function') return null;
    const list = await listModuleRecords('fitness');
    const target = list.find((r) => r.id === recordId);
    if (!target) return null;
    const updated = Object.assign({}, target, patch || {}, {
      id: target.id,
      planId: target.planId,
      kind: 'life:fitness',
      forkId: MODULE_FORK.fitness,
      createdAt: target.createdAt || Date.now(),
      updatedAt: Date.now()
    });
    await Storage.putRecord(updated);
    return updated;
  }

  /** 兼容迁移无 planId 的旧版运动记录至「历史运动记录」自由计划 */
  async function ensureLegacyFitnessMigration(fitnessRecords) {
    if (!Array.isArray(fitnessRecords) || !fitnessRecords.length) return;
    const orphans = fitnessRecords.filter((r) => r && !r.planId);
    if (!orphans.length) return;

    const plans = Array.isArray(configCache.fitnessPlans) ? configCache.fitnessPlans.slice() : [];
    let legacyPlan = plans.find((p) => p.id === 'fplan_legacy' || p.isLegacyBucket);
    if (!legacyPlan) {
      const earliestTs = orphans.reduce((minTs, r) => {
        const ts = Number(r.createdAt) > 0 ? Number(r.createdAt) : Date.now();
        return ts < minTs ? ts : minTs;
      }, Date.now());
      legacyPlan = normalizeFitnessPlan({
        id: 'fplan_legacy',
        name: '历史运动记录',
        description: '旧版运动打卡自动归档计划',
        targetMinutes: null,
        targetCheckins: null,
        isLegacyBucket: true,
        createdAt: earliestTs,
        updatedAt: Date.now()
      }, plans.length);
      plans.push(legacyPlan);
      await saveConfig({ fitnessPlans: plans });
    }

    if (window.Storage && typeof Storage.putRecord === 'function') {
      for (let i = 0; i < orphans.length; i++) {
        const rec = orphans[i];
        const fallbackTs = Number(rec.createdAt) > 0
          ? Number(rec.createdAt)
          : parseDateKeyLocal(rec.dateKey || toDateKey()).getTime() + 9 * 3600000;
        rec.planId = legacyPlan.id;
        if (!rec.occurredAt) rec.occurredAt = fallbackTs;
        if (!rec.dateKey) rec.dateKey = toDateKey(rec.occurredAt);
        await Storage.putRecord(rec);
      }
    }
  }

  /**
   * 实时计算各账户当前净值/欠款与财务汇总
   * 规则约定：
   *   - 储蓄/现金账户（type: 'cash' | 'debit'）：balance 为正数代表可用存款。
   *     支出扣减 balance，收入/退款增加 balance，转出扣减 (amount + fee)，转入增加 amount。
   *   - 信用账户（type: 'credit'）：usedDebt 为正数代表当前已用欠款（待还金额）。
   *     支出增加欠款，退款/收入冲抵欠款，作为转入方（还款）减少欠款，作为转出方（透支取现）增加欠款 (amount + fee)。
   */
  function computeLedgerAnalytics(ledgerRecords, cfg, nowDate) {
    const accounts = (cfg.accounts && cfg.accounts.length) ? cfg.accounts : DEFAULT_ACCOUNTS;
    const defaultAccId = accounts[0].id;
    const accMap = new Map();

    accounts.forEach((acc) => {
      accMap.set(acc.id, Object.assign({}, acc, {
        // 内部统一用 signedBalance 表示对净资产的贡献：储蓄卡存款 +100 => +100；信用卡欠款 100 => -100
        signedBalance: acc.type === 'credit' ? -Number(acc.initialBalance || 0) : Number(acc.initialBalance || 0),
        txCount: 0
      }));
    });

    const getAcc = (id) => {
      if (id && accMap.has(id)) return accMap.get(id);
      return accMap.get(defaultAccId);
    };

    const now = nowDate || new Date();
    const curMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todayKey = toDateKey(now);

    let monthGrossExpense = 0;
    let monthRefundTotal = 0;
    let monthIncome = 0;
    let todayExpense = 0;

    // 当月各支出分类净消费 Map(categoryName -> netAmount)
    const monthCatSpentMap = new Map();
    const pendingReimbursements = [];

    ledgerRecords.forEach((item) => {
      const type = item.type || 'expense';
      const amt = Math.max(0, Number(item.amount) || 0);
      const fee = Math.max(0, Number(item.fee) || 0);
      const dk = String(item.dateKey || '');
      const isCurMonth = dk.startsWith(curMonthPrefix);
      const isToday = dk === todayKey;
      const catName = String(item.category || '其他');

      if (type === 'expense') {
        const acc = getAcc(item.accountId);
        if (acc) {
          acc.signedBalance -= amt;
          acc.txCount += 1;
        }
        const countInExpense = !item.excludeFromStats;
        if (countInExpense) {
          if (isCurMonth) {
            monthGrossExpense += amt;
            monthCatSpentMap.set(catName, (monthCatSpentMap.get(catName) || 0) + amt);
          }
          if (isToday) todayExpense += amt;
        }
        if (item.reimbursable && !item.reimbursed) {
          pendingReimbursements.push(item);
        }
        if (item.reimbursable && item.reimbursed) {
          const targetAcc = getAcc(item.reimburseAccountId || item.accountId);
          if (targetAcc) {
            targetAcc.signedBalance += amt;
          }
          if (countInExpense && isCurMonth) {
            monthRefundTotal += amt;
            monthCatSpentMap.set(catName, (monthCatSpentMap.get(catName) || 0) - amt);
          }
        }
      } else if (type === 'income') {
        const acc = getAcc(item.accountId);
        if (acc) {
          acc.signedBalance += amt;
          acc.txCount += 1;
        }
        if (isCurMonth) monthIncome += amt;
      } else if (type === 'refund') {
        const acc = getAcc(item.accountId);
        if (acc) {
          acc.signedBalance += amt;
          acc.txCount += 1;
        }
        if (isCurMonth) {
          monthRefundTotal += amt;
          monthCatSpentMap.set(catName, (monthCatSpentMap.get(catName) || 0) - amt);
        }
        if (isToday) todayExpense = Math.max(0, todayExpense - amt);
      } else if (type === 'transfer') {
        const fromAcc = getAcc(item.fromAccountId || item.accountId);
        const toAcc = getAcc(item.toAccountId);
        if (fromAcc) {
          fromAcc.signedBalance -= (amt + fee);
          fromAcc.txCount += 1;
        }
        if (toAcc) {
          toAcc.signedBalance += amt;
          toAcc.txCount += 1;
        }
        if (fee > 0) {
          if (isCurMonth) {
            monthGrossExpense += fee;
            monthCatSpentMap.set('转账手续费', (monthCatSpentMap.get('转账手续费') || 0) + fee);
          }
          if (isToday) todayExpense += fee;
        }
      } else if (type === 'adjust') {
        const delta = Number(item.delta) || 0;
        const acc = getAcc(item.accountId);
        if (acc) {
          acc.signedBalance += delta;
          acc.txCount += 1;
        }
      }
    });

    let totalAssets = 0;
    let totalDebt = 0;
    let nearestCreditDue = null;

    const accountStates = Array.from(accMap.values()).map((acc) => {
      const signed = Number(acc.signedBalance.toFixed(2));
      if (acc.type === 'credit') {
        const usedDebt = signed < 0 ? Number((-signed).toFixed(2)) : 0;
        const overflowCredit = signed > 0 ? signed : 0;
        const limit = Math.max(0, Number(acc.creditLimit) || 0);
        const availableCredit = Number(Math.max(0, limit - usedDebt + overflowCredit).toFixed(2));
        const usageRatio = limit > 0 ? Math.min(100, Math.round((usedDebt / limit) * 100)) : 0;
        const daysToStatement = calcDaysUntilDayOfMonth(acc.statementDay || 1, now);
        const daysToDue = calcDaysUntilDayOfMonth(acc.dueDay || 10, now);
        const dailyInterestEst = Number((usedDebt * ((Number(acc.dailyInterestRate) || 0) / 100)).toFixed(2));

        if (acc.includeInNetWorth !== false) {
          totalDebt += usedDebt;
          totalAssets += overflowCredit;
        }

        const enriched = Object.assign({}, acc, {
          balance: signed,
          displayAmount: usedDebt,
          usedDebt,
          overflowCredit,
          availableCredit,
          usageRatio,
          daysToStatement,
          daysToDue,
          dailyInterestEst
        });

        if (usedDebt > 0 && (!nearestCreditDue || daysToDue < nearestCreditDue.daysToDue)) {
          nearestCreditDue = enriched;
        }
        return enriched;
      }

      if (acc.includeInNetWorth !== false) {
        if (signed >= 0) totalAssets += signed;
        else totalDebt += (-signed);
      }
      return Object.assign({}, acc, {
        balance: signed,
        displayAmount: signed
      });
    });

    const netWorth = Number((totalAssets - totalDebt).toFixed(2));
    const monthExpense = Math.max(0, Number((monthGrossExpense - monthRefundTotal).toFixed(2)));
    const budget = Math.max(1, Number(cfg.monthlyBudget) || 3000);
    const budgetRemain = Math.max(0, Number((budget - monthExpense).toFixed(2)));
    const budgetRatio = Math.max(0, Math.min(100, Math.round((budgetRemain / budget) * 100)));

    const expCats = (cfg.ledgerCategories && cfg.ledgerCategories.expense) || DEFAULT_LEDGER_CATEGORIES.expense;
    const categoryStats = expCats.map((cat) => {
      const spent = Math.max(0, Number((monthCatSpentMap.get(cat.name) || 0).toFixed(2)));
      const subBudget = Number(cat.monthlyBudget) || 0;
      const ratio = subBudget > 0 ? Math.min(100, Math.round((spent / subBudget) * 100)) : 0;
      return Object.assign({}, cat, {
        monthSpent: spent,
        budgetUsedRatio: ratio,
        overBudget: subBudget > 0 && spent > subBudget
      });
    });

    const installments = (cfg.installments || []).map((ins) => {
      const metrics = calcInstallmentMetrics(ins.principal, ins.periods, ins.feeRatePerPeriod, ins.fixedFeePerPeriod);
      const remainPeriods = Math.max(0, ins.periods - ins.paidPeriods);
      const remainPay = Number((remainPeriods * metrics.payPerPeriod).toFixed(2));
      const acc = accMap.get(ins.accountId);
      return Object.assign({}, ins, metrics, {
        accountName: acc ? acc.name : '信用账户',
        remainPeriods,
        remainPay
      });
    });

    return {
      accounts: accountStates,
      defaultAccountId: defaultAccId,
      totalAssets: Number(totalAssets.toFixed(2)),
      totalDebt: Number(totalDebt.toFixed(2)),
      netWorth,
      nearestCreditDue,
      monthGrossExpense: Number(monthGrossExpense.toFixed(2)),
      monthRefundTotal: Number(monthRefundTotal.toFixed(2)),
      monthExpense,
      monthIncome: Number(monthIncome.toFixed(2)),
      todayExpense: Math.max(0, Number(todayExpense.toFixed(2))),
      budget,
      budgetRemain,
      budgetRatio,
      categoryStats,
      pendingReimbursements,
      installments
    };
  }

  /**
   * 四维时间统计报表引擎（日 day / 周 week [周一~周日] / 月 month [热力日历] / 年 year [1~12月]）
   * @param {Array} ledgerRecords 全部账单流水
   * @param {'day'|'week'|'month'|'year'} dimension 时间维度
   * @param {number} offset 相对当前周期偏移（0=本周期，-1=上一周期，+1=下一周期）
   * @param {Object} cfgSnapshot 可选配置快照
   */
  function computeLedgerPeriodReport(ledgerRecords, dimension = 'month', offset = 0, cfgSnapshot) {
    const cfg = cfgSnapshot || configCache || normalizeConfig(DEFAULT_CONFIG);
    const records = Array.isArray(ledgerRecords) ? ledgerRecords : [];
    const step = Math.round(Number(offset) || 0);
    const now = new Date();
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayKey = toDateKey(todayMid.getTime());
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    let startDateKey = todayKey;
    let endDateKey = todayKey;
    let periodTitle = '';
    let periodSub = '';
    let spanDays = 1;
    let anchorYear = todayMid.getFullYear();
    let anchorMonth = todayMid.getMonth();
    let mondayDate = null;

    if (dimension === 'day') {
      const target = new Date(todayMid.getTime());
      target.setDate(target.getDate() + step);
      startDateKey = toDateKey(target.getTime());
      endDateKey = startDateKey;
      const wd = weekdayNames[target.getDay()];
      periodTitle = `${startDateKey} · ${wd}`;
      periodSub = step === 0 ? 'TODAY 今日账单快照' : (step < 0 ? `${Math.abs(step)} 天前` : `${step} 天后`);
      spanDays = 1;
    } else if (dimension === 'week') {
      // 严格以周一为起点（JS getDay(): 周日=0 -> 偏移6，周一=1 -> 偏移0 ... 周六=6 -> 偏移5）
      const dayOfWeekMon0 = (todayMid.getDay() + 6) % 7;
      mondayDate = new Date(todayMid.getTime());
      mondayDate.setDate(mondayDate.getDate() - dayOfWeekMon0 + step * 7);
      const sundayDate = new Date(mondayDate.getTime());
      sundayDate.setDate(mondayDate.getDate() + 6);
      startDateKey = toDateKey(mondayDate.getTime());
      endDateKey = toDateKey(sundayDate.getTime());
      const fmtMD = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
      periodTitle = `${fmtMD(mondayDate)} 周一 ~ ${fmtMD(sundayDate)} 周日`;
      periodSub = step === 0 ? `${mondayDate.getFullYear()} · 本周 (MON-SUN)` : `${mondayDate.getFullYear()} · 周区间`;
      spanDays = 7;
    } else if (dimension === 'year') {
      anchorYear = todayMid.getFullYear() + step;
      startDateKey = `${anchorYear}-01-01`;
      endDateKey = `${anchorYear}-12-31`;
      const isLeap = (anchorYear % 4 === 0 && anchorYear % 100 !== 0) || (anchorYear % 400 === 0);
      spanDays = isLeap ? 366 : 365;
      periodTitle = `${anchorYear} 全年账本`;
      periodSub = step === 0 ? 'CURRENT YEAR 年度收支总览' : `${anchorYear} ANNUAL REPORT`;
    } else {
      const targetMonthFirst = new Date(todayMid.getFullYear(), todayMid.getMonth() + step, 1);
      anchorYear = targetMonthFirst.getFullYear();
      anchorMonth = targetMonthFirst.getMonth();
      const daysInM = new Date(anchorYear, anchorMonth + 1, 0).getDate();
      startDateKey = `${anchorYear}-${String(anchorMonth + 1).padStart(2, '0')}-01`;
      endDateKey = `${anchorYear}-${String(anchorMonth + 1).padStart(2, '0')}-${String(daysInM).padStart(2, '0')}`;
      spanDays = daysInM;
      periodTitle = `${anchorYear} 年 ${String(anchorMonth + 1).padStart(2, '0')} 月`;
      periodSub = step === 0 ? 'CURRENT MONTH 本月热力与构成' : `${anchorYear}-${String(anchorMonth + 1).padStart(2, '0')} MONTHLY`;
    }

    // 图标映射字典
    const catIconMap = new Map();
    const expCatCfg = (cfg.ledgerCategories && cfg.ledgerCategories.expense) || DEFAULT_LEDGER_CATEGORIES.expense;
    const incCatCfg = (cfg.ledgerCategories && cfg.ledgerCategories.income) || DEFAULT_LEDGER_CATEGORIES.income;
    expCatCfg.forEach((c) => catIconMap.set(c.name, c.iconKey || 'layers'));
    incCatCfg.forEach((c) => catIconMap.set(c.name, c.iconKey || 'salary'));

    let grossExpense = 0;
    let refundOffset = 0;
    let totalIncome = 0;
    let txCount = 0;

    const expCatMap = new Map(); // name -> { amount, count }
    const incCatMap = new Map(); // name -> { amount, count }
    const dailyExpMap = new Map(); // YYYY-MM-DD -> netExpense
    const dailyIncMap = new Map(); // YYYY-MM-DD -> income
    const monthBucketExp = new Array(12).fill(0);
    const monthBucketInc = new Array(12).fill(0);
    const matchedRecords = [];
    const topExpenseCandidates = [];

    const addDailyExp = (dk, val) => {
      dailyExpMap.set(dk, (dailyExpMap.get(dk) || 0) + val);
      const mIdx = Number(dk.slice(5, 7)) - 1;
      if (mIdx >= 0 && mIdx < 12) monthBucketExp[mIdx] += val;
    };

    const addDailyInc = (dk, val) => {
      dailyIncMap.set(dk, (dailyIncMap.get(dk) || 0) + val);
      const mIdx = Number(dk.slice(5, 7)) - 1;
      if (mIdx >= 0 && mIdx < 12) monthBucketInc[mIdx] += val;
    };

    records.forEach((r) => {
      const dk = String(r.dateKey || '');
      if (!dk || dk < startDateKey || dk > endDateKey) return;

      matchedRecords.push(r);
      txCount += 1;

      const type = r.type || 'expense';
      const amt = Math.max(0, Number(r.amount) || 0);
      const fee = Math.max(0, Number(r.fee) || 0);
      const cat = String(r.category || (type === 'income' ? '其他收入' : '其他支出'));

      if (type === 'expense') {
        if (!r.excludeFromStats) {
          if (r.reimbursable && r.reimbursed) {
            // 已报销垫付净支出冲抵为 0
          } else {
            grossExpense += amt;
            addDailyExp(dk, amt);
            const prev = expCatMap.get(cat) || { amount: 0, count: 0 };
            prev.amount += amt;
            prev.count += 1;
            expCatMap.set(cat, prev);
            if (amt > 0) topExpenseCandidates.push(r);
          }
        }
      } else if (type === 'refund') {
        refundOffset += amt;
        addDailyExp(dk, -amt);
        const prev = expCatMap.get(cat) || { amount: 0, count: 0 };
        prev.amount -= amt;
        expCatMap.set(cat, prev);
      } else if (type === 'income') {
        totalIncome += amt;
        addDailyInc(dk, amt);
        const prev = incCatMap.get(cat) || { amount: 0, count: 0 };
        prev.amount += amt;
        prev.count += 1;
        incCatMap.set(cat, prev);
      } else if (type === 'transfer' && fee > 0) {
        grossExpense += fee;
        addDailyExp(dk, fee);
        const prev = expCatMap.get('转账手续费') || { amount: 0, count: 0 };
        prev.amount += fee;
        prev.count += 1;
        expCatMap.set('转账手续费', prev);
      }
    });

    const netExpense = Math.max(0, Number((grossExpense - refundOffset).toFixed(2)));
    const netBalance = Number((totalIncome - netExpense).toFixed(2));

    // 计算日均有效分母（若为当前未过完的周/月/年，按已过天数算日均更真实）
    let elapsedDays = spanDays;
    if (step === 0 && todayKey >= startDateKey && todayKey <= endDateKey) {
      elapsedDays = Math.max(1, diffDaysFromRef(todayKey, parseDateKeyLocal(startDateKey)) + 1);
    }
    const dailyAvgExpense = Number((netExpense / Math.max(1, elapsedDays)).toFixed(2));
    const monthlyAvgExpense = dimension === 'year'
      ? Number((netExpense / (step === 0 ? Math.max(1, todayMid.getMonth() + 1) : 12)).toFixed(2))
      : netExpense;

    // 构造分类排行榜
    const buildRanking = (mapObj, totalRef, fallbackIcon) => {
      const arr = [];
      mapObj.forEach((v, name) => {
        const cleanAmt = Math.max(0, Number(v.amount.toFixed(2)));
        if (cleanAmt <= 0) return;
        arr.push({
          name,
          iconKey: catIconMap.get(name) || fallbackIcon,
          amount: cleanAmt,
          count: Math.max(1, v.count),
          ratio: totalRef > 0 ? Math.min(100, Math.round((cleanAmt / totalRef) * 100)) : 0
        });
      });
      arr.sort((a, b) => b.amount - a.amount);
      return arr;
    };

    const expenseRanking = buildRanking(expCatMap, netExpense, 'layers');
    const incomeRanking = buildRanking(incCatMap, totalIncome, 'salary');

    // 构造维度专属可视化序列
    let series = [];
    let calendarCells = [];

    if (dimension === 'week' && mondayDate) {
      const shortLabels = ['一', '二', '三', '四', '五', '六', '日'];
      let maxVal = 0;
      for (let i = 0; i < 7; i++) {
        const d = new Date(mondayDate.getTime());
        d.setDate(d.getDate() + i);
        const dk = toDateKey(d.getTime());
        const expVal = Math.max(0, Number((dailyExpMap.get(dk) || 0).toFixed(2)));
        const incVal = Math.max(0, Number((dailyIncMap.get(dk) || 0).toFixed(2)));
        if (expVal > maxVal) maxVal = expVal;
        series.push({
          key: dk,
          label: `周${shortLabels[i]}`,
          shortDate: dk.slice(8, 10),
          expense: expVal,
          income: incVal,
          isToday: dk === todayKey
        });
      }
      series = series.map((s) => Object.assign({}, s, {
        heightPct: maxVal > 0 ? Math.max(s.expense > 0 ? 8 : 0, Math.round((s.expense / maxVal) * 100)) : 0
      }));
    } else if (dimension === 'month') {
      const firstDay = new Date(anchorYear, anchorMonth, 1);
      const leadingBlanks = (firstDay.getDay() + 6) % 7; // 周一=0 ... 周日=6
      for (let b = 0; b < leadingBlanks; b++) {
        calendarCells.push({ empty: true });
      }
      let maxDayExp = 0;
      for (let day = 1; day <= spanDays; day++) {
        const dk = `${anchorYear}-${String(anchorMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const expVal = Math.max(0, Number((dailyExpMap.get(dk) || 0).toFixed(2)));
        if (expVal > maxDayExp) maxDayExp = expVal;
      }
      for (let day = 1; day <= spanDays; day++) {
        const dk = `${anchorYear}-${String(anchorMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const expVal = Math.max(0, Number((dailyExpMap.get(dk) || 0).toFixed(2)));
        const incVal = Math.max(0, Number((dailyIncMap.get(dk) || 0).toFixed(2)));
        let heatLevel = 0;
        if (expVal > 0 && maxDayExp > 0) {
          const r = expVal / maxDayExp;
          heatLevel = r >= 0.7 ? 3 : r >= 0.3 ? 2 : 1;
        }
        calendarCells.push({
          empty: false,
          dateKey: dk,
          day,
          expense: expVal,
          income: incVal,
          heatLevel,
          isToday: dk === todayKey
        });
      }
    } else if (dimension === 'year') {
      let maxM = 0;
      for (let m = 0; m < 12; m++) {
        const ev = Math.max(0, Number(monthBucketExp[m].toFixed(2)));
        if (ev > maxM) maxM = ev;
      }
      for (let m = 0; m < 12; m++) {
        const ev = Math.max(0, Number(monthBucketExp[m].toFixed(2)));
        const iv = Math.max(0, Number(monthBucketInc[m].toFixed(2)));
        series.push({
          key: `${anchorYear}-${String(m + 1).padStart(2, '0')}`,
          label: `${m + 1}月`,
          expense: ev,
          income: iv,
          isCurrent: step === 0 && m === todayMid.getMonth(),
          heightPct: maxM > 0 ? Math.max(ev > 0 ? 8 : 0, Math.round((ev / maxM) * 100)) : 0
        });
      }
    }

    topExpenseCandidates.sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0));
    const topExpenses = topExpenseCandidates.slice(0, 5);

    return {
      dimension,
      offset: step,
      startDateKey,
      endDateKey,
      periodTitle,
      periodSub,
      spanDays,
      elapsedDays,
      netExpense,
      totalIncome: Number(totalIncome.toFixed(2)),
      netBalance,
      dailyAvgExpense,
      monthlyAvgExpense,
      txCount,
      expenseRanking,
      incomeRanking,
      series,
      calendarCells,
      topExpenses,
      records: matchedRecords
    };
  }

  /**
   * 一键平账（校准指定账户余额 / 当前欠款）
   * @param {string} accountId 目标账户 ID
   * @param {number} actualAmount 用户输入的真实金额（储蓄卡填当前真实余额；信用卡填当前真实待还欠款）
   * @param {'record'|'initial'} mode 'record' 生成一条平账差额流水；'initial' 直接修改账户初始基准
   */
  async function calibrateAccountBalance(accountId, actualAmount, mode = 'record') {
    if (!initialized) await loadConfig();
    const ledger = await listModuleRecords('ledger');
    const analytics = computeLedgerAnalytics(ledger, configCache, new Date());
    const targetAcc = analytics.accounts.find((a) => a.id === accountId);
    if (!targetAcc) return null;

    const val = Number(actualAmount);
    if (!Number.isFinite(val)) return null;

    const desiredSigned = targetAcc.type === 'credit' ? -Math.max(0, val) : val;
    const diffSigned = Number((desiredSigned - targetAcc.balance).toFixed(2));
    if (Math.abs(diffSigned) < 0.005) return { changed: false, diff: 0 };

    if (mode === 'initial') {
      const nextAccounts = configCache.accounts.map((a) => {
        if (a.id !== accountId) return a;
        const curInitSigned = a.type === 'credit' ? -Number(a.initialBalance || 0) : Number(a.initialBalance || 0);
        const nextInitSigned = curInitSigned + diffSigned;
        return Object.assign({}, a, {
          initialBalance: Number((a.type === 'credit' ? -nextInitSigned : nextInitSigned).toFixed(2))
        });
      });
      await saveConfig({ accounts: nextAccounts });
      return { changed: true, diff: diffSigned, mode: 'initial' };
    }

    await addModuleRecord('ledger', {
      type: 'adjust',
      accountId,
      amount: Math.abs(diffSigned),
      delta: diffSigned,
      category: '余额平账',
      note: `校准 [${targetAcc.name}] 账面差额`
    });
    return { changed: true, diff: diffSigned, mode: 'record' };
  }

  /** 待报销账单一键核销回款 */
  async function settleReimbursement(recordId, reimburseAccountId) {
    if (!recordId) return null;
    const list = await listModuleRecords('ledger');
    const target = list.find((r) => r.id === recordId);
    if (!target || !target.reimbursable) return null;

    const updated = Object.assign({}, target, {
      reimbursed: true,
      reimbursedAt: Date.now(),
      reimburseAccountId: reimburseAccountId || target.accountId
    });
    await Storage.putRecord(updated);
    return updated;
  }

  /** 信用卡 / 花呗一键转账还款 */
  async function payCreditAccount(creditAccountId, fromAccountId, amount, fee = 0, note = '') {
    const amt = Number(amount);
    if (!creditAccountId || !fromAccountId || !Number.isFinite(amt) || amt <= 0) return null;
    return await addModuleRecord('ledger', {
      type: 'transfer',
      fromAccountId,
      toAccountId: creditAccountId,
      amount: Number(amt.toFixed(2)),
      fee: Math.max(0, Number((Number(fee) || 0).toFixed(2))),
      category: '信用还款',
      note: note || '信用卡/花呗账单还款'
    });
  }

  /** 分期计划推进一期还款（记录支出/还款流水并更新已还期数） */
  async function payInstallmentPeriod(installmentId, payFromAccountId) {
    if (!initialized) await loadConfig();
    const idx = (configCache.installments || []).findIndex((i) => i.id === installmentId);
    if (idx < 0) return null;
    const ins = configCache.installments[idx];
    if (ins.paidPeriods >= ins.periods) return null;

    const m = calcInstallmentMetrics(ins.principal, ins.periods, ins.feeRatePerPeriod, ins.fixedFeePerPeriod);
    const nextPeriodNo = ins.paidPeriods + 1;

    await addModuleRecord('ledger', {
      type: 'expense',
      accountId: payFromAccountId || ins.accountId,
      amount: m.payPerPeriod,
      category: '分期本息',
      note: `${ins.title} (${nextPeriodNo}/${ins.periods}期 · 含息费${m.feePerPeriod})`
    });

    const nextInstallments = configCache.installments.slice();
    nextInstallments[idx] = Object.assign({}, ins, {
      paidPeriods: nextPeriodNo,
      active: nextPeriodNo < ins.periods
    });
    await saveConfig({ installments: nextInstallments });
    return nextInstallments[idx];
  }

  /** 自动巡检周期续费订阅：若开启自动续费且已到达扣费日，自动补记流水并顺延扣费日 */
  async function syncAutoRenewSubscriptions() {
    if (!initialized) await loadConfig();
    const subs = Array.isArray(configCache.subscriptions) ? configCache.subscriptions : [];
    const todayKey = toDateKey();
    let changed = false;
    const nextSubs = subs.map((s) => Object.assign({}, s));
    const fallbackAccId = (configCache.accounts && configCache.accounts[0] && configCache.accounts[0].id) || 'acc_wechat';

    for (let i = 0; i < nextSubs.length; i++) {
      const sub = nextSubs[i];
      if (sub.subMode !== 'recurring' || !sub.autoRenew || !sub.nextBillDate) continue;
      let guard = 0;
      while (sub.nextBillDate <= todayKey && guard < 12) {
        if (sub.price > 0) {
          await addModuleRecord('ledger', {
            type: 'expense',
            accountId: sub.accountId || fallbackAccId,
            amount: sub.price,
            category: sub.category || '娱乐订阅',
            note: `[自动续费] ${sub.name}`,
            dateKey: sub.nextBillDate
          });
        }
        sub.nextBillDate = addCycleToDateKey(sub.nextBillDate, sub.cycle, sub.intervalCount || 1);
        changed = true;
        guard += 1;
      }
    }

    if (changed) {
      await saveConfig({ subscriptions: nextSubs });
    }
    return changed;
  }

  /** 手动续期一周期订阅（支持周期续费提前续费 / 一次性限时包续期），并可选同步记账 */
  async function renewSubscriptionManual(subId, recordExpense = true) {
    if (!initialized) await loadConfig();
    const subs = Array.isArray(configCache.subscriptions) ? configCache.subscriptions.slice() : [];
    const idx = subs.findIndex((s) => s.id === subId);
    if (idx < 0) return null;
    const sub = Object.assign({}, subs[idx]);
    if (sub.subMode === 'lifetime') return sub;

    const todayKey = toDateKey();
    const fallbackAccId = (configCache.accounts && configCache.accounts[0] && configCache.accounts[0].id) || 'acc_wechat';

    if (sub.subMode === 'onetime') {
      const baseDate = (sub.expireDate && sub.expireDate >= todayKey) ? sub.expireDate : todayKey;
      sub.expireDate = addCycleToDateKey(baseDate, sub.cycle || 'monthly', sub.intervalCount || 1);
    } else {
      const baseDate = (sub.nextBillDate && sub.nextBillDate >= todayKey) ? sub.nextBillDate : todayKey;
      sub.nextBillDate = addCycleToDateKey(baseDate, sub.cycle || 'monthly', sub.intervalCount || 1);
    }

    if (recordExpense && sub.price > 0) {
      await addModuleRecord('ledger', {
        type: 'expense',
        accountId: sub.accountId || fallbackAccId,
        amount: sub.price,
        category: sub.category || '娱乐订阅',
        note: `[订阅续期] ${sub.name}`
      });
    }

    subs[idx] = sub;
    await saveConfig({ subscriptions: subs });
    return sub;
  }

  /** 次卡划卡 (-N次) 或 储值余额卡核销扣卡金（纯卡内扣减，不重复扣减资金账户与月度预算） */
  async function redeemValueCard(cardId, deltaValue = 1, note = '') {
    if (!initialized) await loadConfig();
    const cards = Array.isArray(configCache.valueCards) ? configCache.valueCards.slice() : [];
    const idx = cards.findIndex((c) => c.id === cardId);
    if (idx < 0) return null;
    const card = Object.assign({}, cards[idx]);
    const rawDelta = Number(deltaValue);
    const deduct = Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : (card.cardType === 'count' ? 1 : 0);
    if (deduct <= 0 || card.remainValue <= 0) return null;

    const actualDeduct = Number(Math.min(card.remainValue, deduct).toFixed(2));
    card.remainValue = Number(Math.max(0, card.remainValue - actualDeduct).toFixed(2));
    const logs = Array.isArray(card.logs) ? card.logs.slice() : [];
    logs.unshift({
      id: `vclog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'redeem',
      amount: actualDeduct,
      dateKey: toDateKey(),
      note: String(note || (card.cardType === 'balance' ? '储值核销' : '划卡核销')).trim().slice(0, 36)
    });
    card.logs = logs.slice(0, 12);

    cards[idx] = card;
    await saveConfig({ valueCards: cards });
    return card;
  }

  /** 次卡 / 储值卡续充（支持充赠面值与实付分离，可选同步记一笔资金账户支出流水） */
  async function topupValueCard(cardId, addValue, costPaid = 0, accountId = '', recordExpense = true) {
    if (!initialized) await loadConfig();
    const cards = Array.isArray(configCache.valueCards) ? configCache.valueCards.slice() : [];
    const idx = cards.findIndex((c) => c.id === cardId);
    if (idx < 0) return null;
    const addVal = Number(addValue);
    if (!Number.isFinite(addVal) || addVal <= 0) return null;
    const paidVal = Math.max(0, Number(costPaid) || 0);

    const card = Object.assign({}, cards[idx]);
    card.totalValue = Number((card.totalValue + addVal).toFixed(2));
    card.remainValue = Number((card.remainValue + addVal).toFixed(2));
    card.costPaid = Number((card.costPaid + paidVal).toFixed(2));
    if (accountId) card.accountId = accountId;

    const logs = Array.isArray(card.logs) ? card.logs.slice() : [];
    logs.unshift({
      id: `vclog_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: 'topup',
      amount: Number(addVal.toFixed(2)),
      costPaid: Number(paidVal.toFixed(2)),
      dateKey: toDateKey(),
      note: paidVal > 0 ? `续充实付 ¥${paidVal.toFixed(2)}` : '权益续充'
    });
    card.logs = logs.slice(0, 12);

    const fallbackAccId = (configCache.accounts && configCache.accounts[0] && configCache.accounts[0].id) || 'acc_wechat';
    if (recordExpense && paidVal > 0) {
      await addModuleRecord('ledger', {
        type: 'expense',
        accountId: accountId || card.accountId || fallbackAccId,
        amount: Number(paidVal.toFixed(2)),
        category: '休闲娱乐',
        note: `[卡包续充] ${card.name} (+${addVal}${card.unit})`
      });
    }

    cards[idx] = card;
    await saveConfig({ valueCards: cards });
    return card;
  }

  /** 聚合全部板块数据，供机能总控二级页与子面板一次性快速渲染 */
  async function getFullSnapshot() {
    if (!initialized) await loadConfig();
    await syncAutoRenewSubscriptions();

    const [ledger, fitness, weight, diet, period, medsLog, sleep, memo] = await Promise.all([
      listModuleRecords('ledger'),
      listModuleRecords('fitness'),
      listModuleRecords('weight'),
      listModuleRecords('diet'),
      listModuleRecords('period'),
      listModuleRecords('meds'),
      listModuleRecords('sleep'),
      listModuleRecords('memo')
    ]);

    const now = new Date();
    const todayKey = toDateKey(now);

    // 1. 记账多账户、净资产、分类子预算与流水分析
    const ledgerAnalytics = computeLedgerAnalytics(ledger, configCache, now);

    // 2. 运动计划、打卡与体重汇总（自动兼容迁移无 planId 的历史记录）
    await ensureLegacyFitnessMigration(fitness);
    let todayMinutes = 0;
    let totalFitnessMinutes = 0;
    let weekSessions = 0;
    const sevenDaysAgo = Date.now() - 7 * 86400000;
    const planBucketMap = new Map();

    fitness.forEach((item) => {
      const dur = Math.max(0, Number(item.duration) || 0);
      const occTs = Number(item.occurredAt) || Number(item.createdAt) || 0;
      const itemDateKey = item.dateKey || (occTs > 0 ? toDateKey(occTs) : '');
      totalFitnessMinutes += dur;
      if (itemDateKey === todayKey) {
        todayMinutes += dur;
      }
      if (occTs >= sevenDaysAgo) weekSessions += 1;
      if (item.planId) {
        if (!planBucketMap.has(item.planId)) planBucketMap.set(item.planId, []);
        planBucketMap.get(item.planId).push(item);
      }
    });

    const fitnessPlans = (configCache.fitnessPlans || []).map((plan) => {
      const planRecords = (planBucketMap.get(plan.id) || []).slice().sort((a, b) => {
        const ta = Number(a.occurredAt) || Number(a.createdAt) || 0;
        const tb = Number(b.occurredAt) || Number(b.createdAt) || 0;
        return tb - ta;
      });
      const totalMinutes = planRecords.reduce((acc, r) => acc + (Math.max(0, Number(r.duration) || 0)), 0);
      const totalCheckins = planRecords.length;
      const targetMinutes = plan.targetMinutes && plan.targetMinutes > 0 ? plan.targetMinutes : null;
      const targetCheckins = plan.targetCheckins && plan.targetCheckins > 0 ? plan.targetCheckins : null;
      const minutesProgress = targetMinutes ? Math.min(100, Math.round((totalMinutes / targetMinutes) * 100)) : null;
      const checkinsProgress = targetCheckins ? Math.min(100, Math.round((totalCheckins / targetCheckins) * 100)) : null;
      return Object.assign({}, plan, {
        totalMinutes,
        totalCheckins,
        minutesProgress,
        checkinsProgress,
        isFreePlan: !targetMinutes && !targetCheckins,
        latestRecord: planRecords[0] || null,
        records: planRecords
      });
    });

    const latestWeight = weight.length ? Number(weight[0].weight) : null;
    const prevWeight = weight.length > 1 ? Number(weight[1].weight) : null;
    const weightDelta = (latestWeight !== null && prevWeight !== null)
      ? Number((latestWeight - prevWeight).toFixed(1))
      : 0;
    const initialWeight = configCache.initialWeight;
    const targetWeight = configCache.targetWeight;
    const initialWeightDelta = (latestWeight !== null && initialWeight !== null)
      ? Number((latestWeight - initialWeight).toFixed(1))
      : null;
    const targetWeightDelta = latestWeight !== null
      ? Number((latestWeight - targetWeight).toFixed(1))
      : null;

    // 3. 经期周期推算
    const cycleLen = configCache.periodCycleDays || 28;
    const durLen = configCache.periodDurationDays || 5;
    let periodState = {
      phaseCode: 'STANDBY',
      phaseZh: '待校准',
      dayInCycle: 0,
      daysUntilNext: '--',
      lastStartDate: '--'
    };
    if (period.length > 0) {
      const latestPeriod = period[0];
      const startTs = new Date(latestPeriod.startDate + 'T00:00:00').getTime();
      if (Number.isFinite(startTs)) {
        const diffDays = Math.floor((Date.now() - startTs) / 86400000);
        const dayInCycle = ((diffDays % cycleLen) + cycleLen) % cycleLen + 1;
        const daysUntilNext = Math.max(0, cycleLen - dayInCycle + 1);
        let phaseCode = 'FOLLICULAR';
        let phaseZh = '卵泡平稳期';
        if (dayInCycle <= durLen) {
          phaseCode = 'MENSTRUAL';
          phaseZh = '经期行进中';
        } else if (dayInCycle >= cycleLen - 16 && dayInCycle <= cycleLen - 12) {
          phaseCode = 'OVULATION';
          phaseZh = '排卵高敏窗';
        } else if (dayInCycle > cycleLen - 12) {
          phaseCode = 'LUTEAL';
          phaseZh = '黄体蓄能期';
        }
        periodState = {
          phaseCode,
          phaseZh,
          dayInCycle,
          daysUntilNext,
          lastStartDate: latestPeriod.startDate
        };
      }
    }

    // 4. 药盒今日核销进度
    const takenSet = new Set(
      medsLog.filter((r) => r.dateKey === todayKey && r.medId).map((r) => r.medId)
    );
    const activePlans = (configCache.medPlans || []).filter((p) => p.active !== false);
    const medDoneCount = activePlans.filter((p) => takenSet.has(p.id)).length;

    // 5. 睡眠最近一次记录
    const latestSleep = sleep.length ? sleep[0] : null;
    let avgSleepHours = 0;
    if (sleep.length) {
      const sample = sleep.slice(0, 7);
      const sum = sample.reduce((acc, s) => acc + (Number(s.hours) || 0), 0);
      avgSleepHours = Number((sum / sample.length).toFixed(1));
    }

    // 6. 订阅三形态（周期续费 / 一次性限时 / 买断摊销）与次卡·储值卡包分析
    const subs = configCache.subscriptions || [];
    let monthlySubTotal = 0;
    let lifetimeAmortizedDailyTotal = 0;
    let nearestSub = null;
    const subItems = subs.map((s) => {
      const p = Number(s.price) || 0;
      const ic = Math.max(1, Number(s.intervalCount) || 1);
      const subMode = (s.subMode === 'onetime' || s.subMode === 'lifetime') ? s.subMode : 'recurring';
      let daysLeft = 0;
      let heldDays = 1;
      let monthlyEquivalent = 0;
      let dailyAmortized = 0;
      let expired = false;

      if (subMode === 'lifetime') {
        heldDays = Math.max(1, -diffDaysFromRef(s.startDate || todayKey, now) + 1);
        dailyAmortized = Number((p / heldDays).toFixed(2));
        lifetimeAmortizedDailyTotal += dailyAmortized;
        daysLeft = 99999;
      } else if (subMode === 'onetime') {
        const expKey = s.expireDate || addCycleToDateKey(s.startDate || todayKey, s.cycle || 'monthly', ic);
        daysLeft = diffDaysFromRef(expKey, now);
        expired = daysLeft < 0;
        const totalSpanDays = Math.max(1, diffDaysFromRef(expKey, parseDateKeyLocal(s.startDate || todayKey)));
        if (!expired) {
          monthlyEquivalent = Number(((p / totalSpanDays) * 30).toFixed(1));
          monthlySubTotal += monthlyEquivalent;
        }
        dailyAmortized = Number((p / totalSpanDays).toFixed(2));
      } else {
        if (s.cycle === 'yearly') monthlyEquivalent = Number((p / (12 * ic)).toFixed(1));
        else if (s.cycle === 'weekly') monthlyEquivalent = Number(((p * 4.33) / ic).toFixed(1));
        else if (s.cycle === 'daily') monthlyEquivalent = Number(((p * 30) / ic).toFixed(1));
        else monthlyEquivalent = Number((p / ic).toFixed(1));
        monthlySubTotal += monthlyEquivalent;

        daysLeft = s.nextBillDate
          ? diffDaysFromRef(s.nextBillDate, now)
          : calcDaysUntilDayOfMonth(s.billDay || 1, now);
      }

      const enriched = Object.assign({}, s, {
        subMode,
        daysLeft,
        heldDays,
        monthlyEquivalent,
        dailyAmortized,
        expired
      });
      if (subMode !== 'lifetime' && !expired) {
        if (!nearestSub || daysLeft < nearestSub.daysLeft) nearestSub = enriched;
      }
      return enriched;
    });

    const rawCards = configCache.valueCards || [];
    let activeCardCount = 0;
    let totalCountRemain = 0;
    let totalBalanceRemain = 0;
    const cardItems = rawCards.map((vc) => {
      const totalVal = Math.max(0, Number(vc.totalValue) || 0);
      const remainVal = Math.max(0, Number(vc.remainValue) || 0);
      const costPaid = Math.max(0, Number(vc.costPaid) || 0);
      const remainRatio = totalVal > 0 ? Math.min(100, Math.round((remainVal / totalVal) * 100)) : 0;
      const daysToExpire = vc.expireDate ? diffDaysFromRef(vc.expireDate, now) : null;
      const expired = daysToExpire !== null && daysToExpire < 0;
      const exhausted = remainVal <= 0;
      if (!expired && !exhausted) {
        activeCardCount += 1;
        if (vc.cardType === 'balance') totalBalanceRemain += remainVal;
        else totalCountRemain += remainVal;
      }
      const unitCost = totalVal > 0 ? Number((costPaid / totalVal).toFixed(2)) : 0;
      const discountFold = (vc.cardType === 'balance' && totalVal > 0 && costPaid > 0)
        ? Number(((costPaid / totalVal) * 10).toFixed(1))
        : null;
      return Object.assign({}, vc, {
        remainRatio,
        daysToExpire,
        expired,
        exhausted,
        unitCost,
        discountFold
      });
    });

    // 7. 备忘录（待办 TODO / 购物单 WISH / 自由便签 NOTE）
    const memoTodos = memo.filter((m) => m.mode === 'todo');
    const memoWishes = memo.filter((m) => m.mode === 'wish');
    const memoNotes = memo.filter((m) => m.mode === 'note' || !m.mode);
    const pendingTodos = memoTodos.filter((m) => !m.done);
    const pendingWishes = memoWishes.filter((m) => !m.done);
    const pendingCount = pendingTodos.length + pendingWishes.length;
    const latestActiveMemo = pendingTodos[0] || pendingWishes[0] || memoNotes[0] || memo[0] || null;

    // 综合机能运转率（0~100%，供左上角双环战术仪表盘展示）
    let readinessScore = 60;
    if (ledgerAnalytics.budgetRatio >= 40) readinessScore += 12;
    if (todayMinutes > 0 || weekSessions >= 2) readinessScore += 10;
    if (activePlans.length > 0 && medDoneCount === activePlans.length) readinessScore += 10;
    if (latestSleep && Number(latestSleep.hours) >= 6.5) readinessScore += 8;
    if (memoTodos.length > 0 && pendingTodos.length === 0) readinessScore += 4;
    readinessScore = Math.min(99, Math.max(18, readinessScore));

    const dietTodayRecords = diet.filter((record) => String(record.dateKey || '') === todayKey);
    const dietHistoryBucket = new Map();
    diet.forEach((record) => {
      const dateKey = String(record.dateKey || '');
      if (!dateKey || dateKey === todayKey) return;
      if (!dietHistoryBucket.has(dateKey)) dietHistoryBucket.set(dateKey, []);
      dietHistoryBucket.get(dateKey).push(record);
    });
    const dietHistoryGroups = Array.from(dietHistoryBucket.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([dateKey, records]) => ({ dateKey, records, count: records.length }));
    const dietHistoryDates = dietHistoryGroups.map((group) => group.dateKey);

    return {
      config: configCache,
      todayKey,
      readinessScore,
      ledger: Object.assign({
        records: ledger
      }, ledgerAnalytics),
      fitness: {
        plans: fitnessPlans,
        planCount: fitnessPlans.length,
        records: fitness,
        totalMinutes: totalFitnessMinutes,
        totalCheckins: fitness.length,
        todayMinutes,
        weekSessions
      },
      weight: {
        records: weight,
        latestWeight,
        weightDelta,
        initialWeight,
        initialWeightDelta,
        targetWeight,
        targetWeightDelta
      },
      diet: {
        records: diet,
        todayRecords: dietTodayRecords,
        todayCount: dietTodayRecords.length,
        historyGroups: dietHistoryGroups,
        historyDates: dietHistoryDates,
        totalCount: diet.length
      },
      period: {
        records: period,
        cycleLen,
        durLen,
        state: periodState
      },
      meds: {
        plans: activePlans,
        takenSet,
        doneCount: medDoneCount,
        totalCount: activePlans.length,
        logs: medsLog
      },
      sleep: {
        records: sleep,
        latest: latestSleep,
        avgHours: avgSleepHours,
        goalHours: configCache.sleepGoalHours
      },
      sub: {
        items: subItems,
        monthlyTotal: Number(monthlySubTotal.toFixed(1)),
        lifetimeDailyTotal: Number(lifetimeAmortizedDailyTotal.toFixed(2)),
        nearest: nearestSub,
        cards: cardItems,
        activeCardCount,
        totalCountRemain: Number(totalCountRemain.toFixed(1)),
        totalBalanceRemain: Number(totalBalanceRemain.toFixed(2))
      },
      memo: {
        records: memo,
        todos: memoTodos,
        wishes: memoWishes,
        notes: memoNotes,
        pendingCount,
        totalCount: memo.length,
        latestActive: latestActiveMemo
      }
    };
  }

  /** 切换备忘录（待办 / 购物草单）完成状态 */
  async function toggleMemoDone(recordId) {
    if (!recordId) return null;
    const list = await listModuleRecords('memo');
    const target = list.find((r) => r.id === recordId);
    if (!target) return null;
    const nextDone = !target.done;
    const updated = Object.assign({}, target, {
      done: nextDone,
      doneAt: nextDone ? Date.now() : 0
    });
    await Storage.putRecord(updated);
    return { done: nextDone };
  }

  /** 今日药盒打卡切换（已服则撤销，未服则打卡） */
  async function toggleMedToday(medId) {
    if (!medId) return false;
    const todayKey = toDateKey();
    const logs = await listModuleRecords('meds');
    const existing = logs.find((r) => r.dateKey === todayKey && r.medId === medId);
    if (existing) {
      await deleteRecord(existing.id);
      return { taken: false };
    }
    await addModuleRecord('meds', {
      medId,
      dateKey: todayKey,
      takenAt: Date.now()
    });
    return { taken: true };
  }

  if (window.Boot && typeof Boot.onReady === 'function') {
    Boot.onReady(() => {
      loadConfig();
    });
  } else {
    loadConfig();
  }

  return {
    CONFIG_DOC_KEY,
    RECORD_PREFIX,
    DEFAULT_ACCOUNTS,
    DEFAULT_LEDGER_CATEGORIES,
    loadConfig,
    getConfig,
    saveConfig,
    toDateKey,
    addCycleToDateKey,
    diffDaysFromRef,
    calcInstallmentMetrics,
    computeLedgerPeriodReport,
    listModuleRecords,
    addModuleRecord,
    updateModuleRecord,
    updateLedgerRecord,
    updateFitnessRecord,
    saveFitnessPlan,
    deleteFitnessPlan,
    deleteRecord,
    calibrateAccountBalance,
    settleReimbursement,
    payCreditAccount,
    payInstallmentPeriod,
    syncAutoRenewSubscriptions,
    renewSubscriptionManual,
    redeemValueCard,
    topupValueCard,
    toggleMedToday,
    toggleMemoDone,
    // 经期管理
    startPeriod,
    extendPeriod,
    endPeriod,
    updatePeriodRecord,
    savePeriodDailyLog,
    getFullSnapshot
  };
})();

window.LifeStore = LifeStore;