/**
 * 溯流计划 · 系统时钟组件
 * 实时同步本地系统时间：时分、年月日、中英对照星期
 */
(() => {
  const DAYS_MAP = [
    { en: 'SUNDAY', zh: '星期日' },
    { en: 'MONDAY', zh: '星期一' },
    { en: 'TUESDAY', zh: '星期二' },
    { en: 'WEDNESDAY', zh: '星期三' },
    { en: 'THURSDAY', zh: '星期四' },
    { en: 'FRIDAY', zh: '星期五' },
    { en: 'SATURDAY', zh: '星期六' }
  ];

  const timeEl = document.getElementById('clockTime');
  const dateEl = document.getElementById('clockDate');
  const dayEnEl = document.getElementById('clockDayEn');
  const dayZhEl = document.getElementById('clockDayZh');

  function pad(num) {
    return num.toString().padStart(2, '0');
  }

  function updateClock() {
    const now = new Date();

    const hours = pad(now.getHours());
    const minutes = pad(now.getMinutes());
    const year = now.getFullYear();
    const month = pad(now.getMonth() + 1);
    const date = pad(now.getDate());
    const dayInfo = DAYS_MAP[now.getDay()];

    if (timeEl) timeEl.textContent = `${hours}:${minutes}`;
    if (dateEl) dateEl.textContent = `${year} · ${month}.${date}`;
    if (dayEnEl) dayEnEl.textContent = dayInfo.en;
    if (dayZhEl) dayZhEl.textContent = dayInfo.zh;
  }

  // 准点对齐刷新（每分钟起始跳动）
  function scheduleNextMinute() {
    updateClock();
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50;
    setTimeout(() => {
      updateClock();
      setInterval(updateClock, 60000);
    }, Math.max(100, msToNextMinute));
  }

  // 页面唤醒时立即校准
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      updateClock();
    }
  });

  scheduleNextMinute();
})();
