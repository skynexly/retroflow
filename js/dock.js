/**
 * 溯流计划 · 底部战术 DOCK 栏控制器
 * 1. 管理设置、聊天、快速下潜、呼叫系统等核心交互
 * 2. 软键盘智能避让：输入法唤起时平滑向下滑出隐藏，收起时自动回弹复位
 */
(() => {
  const dockBar = document.querySelector('.tactical-dock-bar');
  const dockItems = document.querySelectorAll('.dock-item, .dock-dive-core');

  function handleDockAction(action) {
    console.log(`[Retroflow Dock] 触发底栏动作：${action}`);
    if (action === 'settings') {
      if (window.RetroflowSettings) {
        window.RetroflowSettings.open();
      }
    } else if (action === 'chat') {
      if (window.OnlineUI) {
        window.OnlineUI.open();
      }
    } else if (action === 'call-system') {
      if (window.SystemChatUI) {
        window.SystemChatUI.open();
      }
    } else if (action === 'worldbook') {
      if (window.WorldBookUI) {
        window.WorldBookUI.open();
      }
    }
  }

  dockItems.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = btn.dataset.action;
      handleDockAction(action);
    });
  });

  /* ---------------- 软键盘唤起智能避让 ---------------- */
  let isFocused = false;

  function hideDock() {
    if (dockBar) dockBar.classList.add('keyboard-hidden');
  }

  function showDock() {
    if (dockBar && !isFocused) dockBar.classList.remove('keyboard-hidden');
  }

  // 1. 全局输入框聚焦/失焦监听
  document.addEventListener('focusin', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      isFocused = true;
      hideDock();
    }
  });

  document.addEventListener('focusout', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) {
      isFocused = false;
      // 延迟微量时间等待视口恢复
      setTimeout(showDock, 120);
    }
  });

  // 2. 现代 visualViewport 高度变化双重保障
  if (window.visualViewport) {
    const initialHeight = window.innerHeight;
    window.visualViewport.addEventListener('resize', () => {
      // 当视口高度显著缩水（说明软键盘弹起）
      if (window.visualViewport.height < initialHeight * 0.78) {
        hideDock();
      } else {
        if (!isFocused) showDock();
      }
    });
  }
})();