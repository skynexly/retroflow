/**
 * 溯流计划 · 通用视图动效控制器 (UI Motion)
 *
 * 职责：统一管理「视图入场动画的重播」。
 *
 * 背景：CSS 的 animation 只在元素首次进入渲染树（或动画属性变化）时触发一次。
 * 当一个视图靠 hidden / .active 反复显隐时，第二次显示不会重新播放入场动画。
 * 想让它每次都播，必须强制浏览器丢弃已完成的动画状态并重新计算 —— 也就是
 * 「清空 animation → 读取一个触发 reflow 的布局属性 → 还原 animation」这三步。
 *
 * 这段样板代码原先散落在各个模块里手写，容易漏写 reflow 那一行（漏了动画就不播），
 * 因此收敛到这里统一提供。
 */
(() => {
  'use strict';

  /**
   * 重播元素的 CSS 入场动画。
   *
   * @param {HTMLElement} el 目标元素。传入空值时静默返回，调用方无需自己判空。
   */
  function replay(el) {
    if (!el) return;
    // 先摘掉动画，让浏览器认为它从未播放过
    el.style.animation = 'none';
    // 读取 offsetHeight 强制同步 reflow：这一步不能省，否则上下两次赋值会被合并优化掉
    void el.offsetHeight;
    // 还原为样式表里声明的动画，触发重新播放
    el.style.animation = '';
  }

  /**
   * 互斥视图切换：隐藏一批、显示一个，并让显示的那个重播入场动画。
   * 适用于走 hidden 属性控制显隐的视图组。
   *
   * @param {HTMLElement} target 要显示的视图
   * @param {HTMLElement[]} siblings 要隐藏的同级视图
   */
  function swap(target, siblings) {
    (siblings || []).forEach((el) => {
      if (el && el !== target) el.hidden = true;
    });
    if (!target) return;
    target.hidden = false;
    replay(target);
  }

  window.Motion = { replay, swap };
})();
