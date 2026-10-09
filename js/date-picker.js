/**
 * 溯流计划 · 机能日期选择弹窗 (DatePicker Modal Controller)
 * 职责：
 * 1. 提供年(可选/可留空)、月、日三轨联动选择
 * 2. 动态计算星座 (Zodiac) 与年龄 (Age)
 * 3. 自动根据年份与月份校验当月最大天数 (28/29/30/31)
 * 4. 提供 Promise 接口 DatePickerModal.pick({ value, title })
 */
const DatePickerModal = (() => {
  'use strict';

  // 星座定义表
  const ZODIAC_LIST = [
    { name: '摩羯座', en: 'CAPRICORN', startMonth: 12, startDay: 22, endMonth: 1, endDay: 19 },
    { name: '水瓶座', en: 'AQUARIUS', startMonth: 1, startDay: 20, endMonth: 2, endDay: 18 },
    { name: '双鱼座', en: 'PISCES', startMonth: 2, startDay: 19, endMonth: 3, endDay: 20 },
    { name: '白羊座', en: 'ARIES', startMonth: 3, startDay: 21, endMonth: 4, endDay: 19 },
    { name: '金牛座', en: 'TAURUS', startMonth: 4, startDay: 20, endMonth: 5, endDay: 20 },
    { name: '双子座', en: 'GEMINI', startMonth: 5, startDay: 21, endMonth: 6, endDay: 21 },
    { name: '巨蟹座', en: 'CANCER', startMonth: 6, startDay: 22, endMonth: 7, endDay: 22 },
    { name: '狮子座', en: 'LEO', startMonth: 7, startDay: 23, endMonth: 8, endDay: 22 },
    { name: '处女座', en: 'VIRGO', startMonth: 8, startDay: 23, endMonth: 9, endDay: 22 },
    { name: '天秤座', en: 'LIBRA', startMonth: 9, startDay: 23, endMonth: 10, endDay: 23 },
    { name: '天蝎座', en: 'SCORPIO', startMonth: 10, startDay: 24, endMonth: 11, endDay: 22 },
    { name: '射手座', en: 'SAGITTARIUS', startMonth: 11, startDay: 23, endMonth: 12, endDay: 21 }
  ];

  // DOM 节点
  let overlay = null;
  let titleEl = null;
  let previewText = null;
  let previewZodiac = null;
  let previewAge = null;
  let yearTrigger = null;
  let monthTrigger = null;
  let dayTrigger = null;
  let yearText = null;
  let monthText = null;
  let dayText = null;
  let clearYearBtn = null;
  let closeBtn = null;
  let clearBtn = null;
  let confirmBtn = null;

  // 当前选择状态（改由状态变量驱动，不再依赖原生 select 的 value）
  let selYear = '';
  let selMonth = '08';
  let selDay = '29';

  let currentResolver = null;
  let isInitialized = false;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  // 获取某年某月的最大天数（年为空时默认按平年 28 天或 29 天均可，按 28 兜底）
  function getDaysInMonth(year, month) {
    if (!month) return 31;
    const m = Number(month);
    if ([1, 3, 5, 7, 8, 10, 12].includes(m)) return 31;
    if ([4, 6, 9, 11].includes(m)) return 30;
    if (m === 2) {
      if (!year) return 29; // 年份未指定时包容 29 天
      const y = Number(year);
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      return isLeap ? 29 : 28;
    }
    return 31;
  }

  // 计算星座
  function getZodiac(month, day) {
    const m = Number(month);
    const d = Number(day);
    if (!m || !d) return { name: '未定', en: 'UNKNOWN' };

    for (const z of ZODIAC_LIST) {
      if (z.startMonth === 12 && z.endMonth === 1) {
        if ((m === 12 && d >= z.startDay) || (m === 1 && d <= z.endDay)) return z;
      } else {
        if ((m === z.startMonth && d >= z.startDay) || (m === z.endMonth && d <= z.endDay)) return z;
      }
    }
    return { name: '未定', en: 'UNKNOWN' };
  }

  // 计算年龄（基于当前年份）
  function getAge(year, month, day) {
    if (!year) return null;
    const y = Number(year);
    const m = Number(month) || 1;
    const d = Number(day) || 1;
    const today = new Date();
    let age = today.getFullYear() - y;
    const birthThisYear = new Date(today.getFullYear(), m - 1, d);
    if (today < birthThisYear) {
      age -= 1;
    }
    return age >= 0 ? age : 0;
  }

  // 初始化 DOM 引用与交互绑定
  function initDOM() {
    if (isInitialized) return;
    overlay = document.getElementById('datePickerOverlay');
    if (!overlay) return;

    titleEl = document.getElementById('datePickerTitle');
    previewText = document.getElementById('datePreviewText');
    previewZodiac = document.getElementById('datePreviewZodiac');
    previewAge = document.getElementById('datePreviewAge');
    yearTrigger = document.getElementById('dateYearTrigger');
    monthTrigger = document.getElementById('dateMonthTrigger');
    dayTrigger = document.getElementById('dateDayTrigger');
    yearText = document.getElementById('dateYearText');
    monthText = document.getElementById('dateMonthText');
    dayText = document.getElementById('dateDayText');
    clearYearBtn = document.getElementById('dateClearYearBtn');
    closeBtn = document.getElementById('datePickerCloseBtn');
    clearBtn = document.getElementById('datePickerClearBtn');
    confirmBtn = document.getElementById('datePickerConfirmBtn');

    // 年份选择：调起通用机能单选面板（自带搜索过滤）
    if (yearTrigger) {
      yearTrigger.addEventListener('click', async () => {
        const currentYear = new Date().getFullYear();
        const opts = [{ value: '', label: '-- 不设', hint: '不指定出生年份' }];
        for (let y = currentYear + 2; y >= 1940; y--) {
          opts.push({ value: String(y), label: `${y} 年` });
        }
        const picked = await SelectModal.pick({
          title: '选择出生年份',
          tag: 'CALENDAR // 年份校准',
          options: opts,
          value: selYear
        });
        if (picked !== null) {
          selYear = picked;
          clampDay();
          renderTriggers();
          updatePreview();
        }
      });
    }

    // 月份选择
    if (monthTrigger) {
      monthTrigger.addEventListener('click', async () => {
        const opts = [];
        for (let m = 1; m <= 12; m++) {
          opts.push({ value: pad(m), label: `${pad(m)} 月` });
        }
        const picked = await SelectModal.pick({
          title: '选择月份',
          tag: 'CALENDAR // 月份校准',
          options: opts,
          value: selMonth,
          searchable: false
        });
        if (picked !== null) {
          selMonth = picked;
          clampDay();
          renderTriggers();
          updatePreview();
        }
      });
    }

    // 日期选择（天数随年月动态合法化）
    if (dayTrigger) {
      dayTrigger.addEventListener('click', async () => {
        const maxDays = getDaysInMonth(selYear, selMonth);
        const opts = [];
        for (let d = 1; d <= maxDays; d++) {
          opts.push({ value: pad(d), label: `${pad(d)} 日` });
        }
        const picked = await SelectModal.pick({
          title: '选择日期',
          tag: `CALENDAR // 当月共 ${maxDays} 天`,
          options: opts,
          value: selDay
        });
        if (picked !== null) {
          selDay = picked;
          renderTriggers();
          updatePreview();
        }
      });
    }

    if (clearYearBtn) {
      clearYearBtn.addEventListener('click', () => {
        selYear = '';
        clampDay();
        renderTriggers();
        updatePreview();
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => close(null));
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        close('');
      });
    }

    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        if (!selMonth || !selDay) {
          close('');
          return;
        }
        const result = selYear ? `${selYear}.${selMonth}.${selDay}` : `${selMonth}.${selDay}`;
        close(result);
      });
    }

    // 点击遮罩层空白处关闭
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        close(null);
      }
    });

    isInitialized = true;
  }

  // 校正日期合法性（例如从 3.31 切到 2 月须回落至 28/29）
  function clampDay() {
    const maxDays = getDaysInMonth(selYear, selMonth);
    if (Number(selDay) > maxDays) {
      selDay = pad(maxDays);
    }
  }

  // 把当前状态投影到三个触发器上
  function renderTriggers() {
    if (yearText) yearText.textContent = selYear || '--';
    if (monthText) monthText.textContent = selMonth || '--';
    if (dayText) dayText.textContent = selDay || '--';
  }

  // 刷新实时 Hero 预览区
  function updatePreview() {
    const y = selYear;
    const m = selMonth || '01';
    const d = selDay || '01';

    if (previewText) {
      previewText.textContent = y ? `${y}.${m}.${d}` : `-- · ${m}.${d}`;
    }

    if (previewZodiac) {
      const z = getZodiac(m, d);
      previewZodiac.textContent = `${z.name} · ${z.en}`;
    }

    if (previewAge) {
      if (y) {
        const age = getAge(y, m, d);
        previewAge.textContent = `${age} 岁`;
        previewAge.hidden = false;
      } else {
        previewAge.hidden = true;
      }
    }
  }

  // 解析传入的字符串并回填状态
  function parseAndSet(val) {
    const applyDefault = () => {
      selYear = '';
      selMonth = '08';
      selDay = '29';
    };

    if (!val || typeof val !== 'string') {
      applyDefault();
    } else {
      const trimmed = val.trim();
      // 匹配 YYYY.MM.DD 或 YYYY-MM-DD 或 YYYY/MM/DD
      const matchFull = trimmed.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
      // 匹配 MM.DD 或 MM-DD 或 MM/DD
      const matchShort = trimmed.match(/^(\d{1,2})[./-](\d{1,2})$/);

      if (matchFull) {
        selYear = matchFull[1];
        selMonth = pad(matchFull[2]);
        selDay = pad(matchFull[3]);
      } else if (matchShort) {
        selYear = '';
        selMonth = pad(matchShort[1]);
        selDay = pad(matchShort[2]);
      } else {
        applyDefault();
      }
    }

    clampDay();
    renderTriggers();
    updatePreview();
  }

  function open(options = {}) {
    initDOM();
    if (!overlay) return Promise.resolve(null);

    const { value = '', title = '选择诞生日' } = options;
    if (titleEl) titleEl.textContent = title;

    parseAndSet(value);

    overlay.hidden = false;
    // 触发平滑进场动画
    requestAnimationFrame(() => {
      overlay.classList.add('active');
    });

    return new Promise((resolve) => {
      currentResolver = resolve;
    });
  }

  function close(result) {
    if (!overlay) return;
    overlay.classList.remove('active');
    setTimeout(() => {
      overlay.hidden = true;
      if (currentResolver) {
        currentResolver(result);
        currentResolver = null;
      }
    }, 200);
  }

  return {
    pick: open,
    getZodiac,
    getAge
  };
})();

// 顶层 const 不会自动挂载到 window，显式暴露以兼容 window.DatePickerModal 写法
window.DatePickerModal = DatePickerModal;