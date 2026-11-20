/**
 * 溯流计划 · 启动引导 (Boot)
 *
 * 职责：在各模块填充数据之前，先把配置数据从 IndexedDB 装载进内存。
 *
 * 为什么需要它：
 *   配置数据存在 IndexedDB（容量大、不易被清理），读取本质是异步的。
 *   各模块的 DOM 事件绑定可以立即执行，但「把数据填进界面」这一步
 *   必须等装载完成。这个门禁把两者的时序摆在明面上，而不是让每个
 *   模块自己猜数据什么时候就绪。
 *
 * 用法：需要数据的模块把填充逻辑注册进来，Boot 会在装载完成后按序调用。
 *   Boot.onReady('模块名', () => { ...填充界面... });
 *
 * 已注册过 onReady 且装载已完成时，回调会立即执行，
 * 所以模块无需关心自己是在装载前还是装载后加载的。
 */

/**
 * 诊断开关：停掉全站 CSS 动画，用来排查「渲染线程持续吃满 CPU」的耗电问题。
 *
 * 用法（三种触发方式，任一命中即生效）：
 *   · URL 带 ?noanim=1
 *   · 控制台执行 localStorage.setItem('retroflow_reduce_motion', '1') 后重开
 *   · 系统打开「减弱动态效果」时自动跟随（这一条常驻生效，不需要上面的开关）
 *
 * 生效方式：在 <html> 上加 no-anim 类，由 css/style.css 末尾的规则统一暂停。
 * 只作用于 CSS 动画与过渡，不改任何布局和视觉结果，随时可逆。
 * 排查完把开关关掉即可恢复，代码不必回退。
 */
function resolveAnimationPolicy() {
  let forced = false;
  try {
    const q = new URLSearchParams(window.location.search || '');
    forced = q.get('noanim') === '1';
    if (!forced && window.localStorage && localStorage.getItem('retroflow_reduce_motion') === '1') {
      forced = true;
    }
  } catch (err) {
    // 隐私模式 / 参数异常都按「不强制」处理，不影响启动
  }
  let systemReduce = false;
  try {
    systemReduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  } catch (err) {}
  return { forced, systemReduce };
}

/** 按当前策略给 <html> 打标记，返回策略快照供控制台自查 */
function applyAnimationPolicy() {
  const p = resolveAnimationPolicy();
  const root = document.documentElement;
  root.classList.toggle('no-anim', p.forced);
  root.classList.toggle('respect-reduced-motion', p.systemReduce);
  return p;
}

if (typeof window !== 'undefined') {
  window.RetroflowMotion = {
    apply: applyAnimationPolicy,
    /** 运行时切换（调试用）：on=true 停动画，on=false 恢复 */
    set(forced) {
      try { localStorage.setItem('retroflow_reduce_motion', forced ? '1' : '0'); } catch (err) {}
      return applyAnimationPolicy();
    },
    /** 当前是否处于「停动画」状态（供设置页开关回填，权威判据是 html 上的类） */
    isOn() {
      return document.documentElement.classList.contains('no-anim');
    }
  };
  applyAnimationPolicy();
}

const Boot = (() => {
  'use strict';

  // 原生壳标记（全站唯一判定点）：Capacitor 装机版在 <html> 上打 is-native 类。
  // 放在模块顶层、脚本一加载即执行，早于任何视图渲染，避免 UPDATE 等
  // 「仅装机版可见」的模块先显示再隐藏造成闪动。浏览器 / PWA 不打此类。
  // 其他模块（如 ota-ui.js）只读这个类，不再各自重复 isNativePlatform 判定。
  try {
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform()) {
      document.documentElement.classList.add('is-native');
    }
  } catch (err) {
    // 判定失败一律按非原生处理，不影响启动
  }

  const callbacks = [];
  let ready = false;
  let bootPromise = null;

  /**
   * 注册数据就绪回调
   * @param {string} name 模块名，出错时用于定位
   * @param {() => void|Promise<void>} fn 数据填充逻辑
   */
  function onReady(name, fn) {
    if (typeof fn !== 'function') return;

    if (ready) {
      // 装载已完成，直接执行
      runOne({ name, fn });
      return;
    }
    callbacks.push({ name, fn });
  }

  function runOne(entry) {
    try {
      const r = entry.fn();
      if (r && typeof r.catch === 'function') {
        r.catch((err) => console.error(`[Boot] ${entry.name} 初始化失败：`, err));
      }
    } catch (err) {
      console.error(`[Boot] ${entry.name} 初始化失败：`, err);
    }
  }

  /**
   * 执行启动流程：装载配置数据 → 依次触发各模块的数据填充。
   * 重复调用返回同一个 Promise。
   */
  function start() {
    if (bootPromise) return bootPromise;

    bootPromise = (async () => {
      try {
        await Store.load();
      } catch (err) {
        // 装载失败也要让界面跑起来，各模块会拿到默认值
        console.error('[Boot] 配置装载失败，将以默认值启动：', err);
      }

      ready = true;
      const pending = callbacks.splice(0, callbacks.length);
      pending.forEach(runOne);

      window.dispatchEvent(new CustomEvent('retroflow:store-ready'));
    })();

    return bootPromise;
  }

  function isReady() {
    return ready;
  }

  return { onReady, start, isReady };
})();

window.Boot = Boot;