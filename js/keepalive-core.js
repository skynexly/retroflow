/**
 * 溯流计划 · 后台保活核心 (Keepalive Core)
 * 参考 Qu Phone 的 keepalive-core.js 设计（静音音轨 + 屏幕常亮，双开关互不依赖）：
 *
 *   on   静音音轨。管「切走之后这一页还跑不跑」——手机浏览器只肯为「正在出声的页面」
 *        留住 CPU，让它一直循环播一段听不见的音频，前台定时器与长任务才不会被冻住。
 *   wake 屏幕常亮（Wake Lock API）。管「看着的时候屏幕熄不熄」——与音轨毫无关系，
 *        只是同一张设置卡里的邻居。
 *
 * 关键设计（全部沿用曲曲机踩坑后的结论）：
 * 1. 保活源必须是仓库里的真文件（assets/audio/silence.m4a，2 秒 -18dB/60Hz 正弦 AAC），
 *    loop + 低音量双保险。不能是全零采样的数字静音：Chrome 按实际输出功率判定
 *    「是否在播放音频」，全零文件系统层不认账（无媒体通知、无后台豁免，真机实测）；
 * 2. 手势闩：浏览器不允许无用户激活就出声，开机自动 play 被拒后，在
 *    pointerdown/touchend/click 三事件的捕获阶段挂钩子，搭用户必然会做的那一下
 *    （三事件都挂是因为各自会漏：上滑不产生 click、老 WebKit 不认 pointerdown）；
 * 3. 被抢自愈：来电/别的 App 抢音频焦点/iOS 自己掐——pause 事件里带 2 秒节流重播；
 *    节流窗口内再被掐要「推迟不是丢弃」，否则一串抢夺的最后一次没人接；
 * 4. 音乐让路钩子 kaWatchMusic()：真实音乐在放时静音轨停掉（iOS 同页两路音频互抢
 *    会让音乐卡断）。本项目桌面唱机是假播放器（无真实 audio），暂无让路对象；
 *    聊天 TTS 就几秒，不让路。将来接入真音乐时调 kaWatchMusic(el) 认领即可；
 * 5. Wake Lock 三个坑：系统切后台单方面收回锁且不还（回前台必须重新申请）、
 *    异步申请竞态（拿到手再校验开关与可见性）、低电量直接拒（不动开关，
 *    状态行照实报「未生效」）；
 * 6. 状态自证：off/yield/run/wait 四态如实上报，'wait'（开关亮着但没跑）最关键，
 *    不报出来用户永远不知道保活是断的。
 * 7. MediaSession 媒体身份证：音轨真播起来后挂 MediaMetadata + playbackState，
 *    让系统把 App 归类为「媒体播放中」，争取更高的后台优先级（部分安卓 ROM 的
 *    网络管制会因此放宽，吃不吃看设备，实测为准）。媒体通知的 pause 键被接管为
 *    「用户主动关保活」——否则暂停会被当成音频被抢而两秒后重播，永远按不死。
 *
 * 加载时序：挂 index.html 首批脚本（保活要在任何页面都活着），
 * 开机恢复在 Boot.onReady 后执行。前缀 ka，设置页那半边在 terminal-config.js（ska*）。
 */
(() => {
  'use strict';

  const KA_STORAGE_KEY = 'retroflow_keepalive_v1';
  // 保活音轨：2 秒 60Hz 正弦波、-18dB、AAC，本地真文件。
  // 为什么不是数字静音：Chrome 判定「正在播放音频」看的是实际输出功率而不是
  // 元素状态——anullsrc 那种全零采样的文件在 JS 层 paused=false，系统层却
  // 认定「没出声」，媒体通知不弹、后台网络豁免也不给（真机实测证实）。
  // 也不能压太狠：-50dB 经 AAC 低电平量化后实测只剩 -71dB（几乎贴零），
  // 仍有被判静音的风险。-18dB × volume 0.2 ≈ -32dB 实际输出：功率稳稳非零，
  // 60Hz 低频在手机小喇叭上本就难以再现，人耳至多感到一丝底噪。
  // 版本戳穿透 HTTP 磁盘缓存，别拿回旧的全零文件。
  const KA_SRC = 'assets/audio/silence.m4a?v=3';
  // 第二道音量闸。1.0 = 响度完全交给文件本身的 -39dB 控制：
  // 之前压到 0.2（实际输出 ≈ -53dB）真机实测仍被 Chrome 判无声（无小喇叭、无媒体卡）。
  // 60Hz 低频手机喇叭物理上出不来多少声，文件电平已足够安静，无需再乘系数
  const KA_VOLUME = 1.0;
  // 自证版本：真机状态行显示这个尾巴，一眼确认 SW 换班后跑的是不是新脚本
  const KA_VERSION = 'v4';
  // 被抢走焦点之后重播的最小间隔，防止 pause→play→pause 空转
  const KA_REPLAY_GAP = 2000;

  let kaCfg = null;
  let kaAudio = null;        // 那一个 <audio>，懒建，不进 DOM
  let kaArmed = false;       // 手势闩挂着没有
  let kaMusicEl = null;      // 认领到的真实音乐元素（当前项目暂无）
  let kaReplayAt = 0;        // 上次因为被掐而重播的时刻
  let kaReplayTimer = null;  // 节流窗口里被推迟的那一次重播
  let kaWakeLock = null;     // WakeLockSentinel
  let kaWakeBusy = false;    // 申请在飞，别叠第二次
  let kaMediaMounted = false; // 媒体身份证挂上了没有（kaMediaState 自证用）

  // ===== 配置 =====
  function loadCfg() {
    if (kaCfg) return kaCfg;
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KA_STORAGE_KEY) || 'null'); } catch (_) {}
    const o = raw && typeof raw === 'object' ? raw : {};
    // 两颗开关出厂都关着：保活费电，不该替用户默认打开
    kaCfg = { on: o.on === true, wake: o.wake === true };
    return kaCfg;
  }
  function saveCfg() {
    try { localStorage.setItem(KA_STORAGE_KEY, JSON.stringify(kaCfg)); } catch (_) {}
  }

  // ===== 单一收口 =====
  // 所有事件（可见性变化、音乐起停、开关、手势）最后都落到这里，
  // 别在别处单独 play() 或 release()，那样状态迟早各说各话
  function kaSync() {
    kaAudioSync();
    kaWakeSync();
    kaNote();
  }

  // 设置页开着才有人接状态行；多数时候这个函数不存在
  function kaNote() {
    if (typeof window.skaSyncNote === 'function') window.skaSyncNote();
  }

  // ===== 静音音轨 =====
  function kaAudioEl() {
    if (kaAudio) return kaAudio;
    kaAudio = new Audio(KA_SRC);
    kaAudio.loop = true;
    kaAudio.preload = 'auto';
    kaAudio.volume = KA_VOLUME; // 第二道闸：文件本身已是 -50dB 低频，再乘 0.2 ≈ -64dB 实际输出
    kaAudio.addEventListener('pause', kaAudioStolen);
    return kaAudio;
  }

  // 音轨被掐（来电/音频焦点被抢/iOS 自己动手）后自己站起来。
  // 不设「是不是我自己停的」标志位：kaAudioSync 的判据本来就能算出该不该播
  // （自己停的那几路会算出 want=false 什么都不做），且 pause 事件是异步派发的，
  // 标志位在事件到达前早已复位，那种写法从一开始就不成立。
  function kaAudioStolen() {
    const t = Date.now();
    const wait = KA_REPLAY_GAP - (t - kaReplayAt);
    // 窗口里再被掐要推迟、不是丢弃：丢掉的话一串抢夺里最后一次没人接，
    // 音轨就一直躺着等下一次回前台。只留一个待办，多次被掐塌成一次。
    if (wait > 0) {
      if (kaReplayTimer === null) {
        kaReplayTimer = setTimeout(() => {
          kaReplayTimer = null;
          kaAudioStolen();
        }, wait);
      }
      return;
    }
    kaReplayAt = t;
    // 页面在后台时这次 play 多半被拒，那就由 kaAudioSync 挂上手势闩等用户回来碰一下
    kaSync();
  }

  function kaAudioSync() {
    const want = loadCfg().on && !kaMusicLive();
    if (!want) {
      // 建都没建过就什么都不做，别为了「停下」把音频对象创出来
      if (kaAudio && !kaAudio.paused) {
        kaAudio.pause();
        kaAudio.currentTime = 0;
      }
      kaMediaOff(); // 轨停了身份证也收走，通知栏不留尸体
      return;
    }
    const el = kaAudioEl();
    if (!el.paused) return;
    el.volume = KA_VOLUME;
    let p = null;
    try {
      p = el.play();
    } catch (_) {
      kaArm();
      return;
    }
    // 老浏览器 play() 不返回 Promise，没法知道成没成，也就没法补闩
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        kaArm(); // 十有八九是「还没有用户手势」，等下一次点击
        kaNote();
      });
      p.then(() => {
        kaMediaOn(); // 真播起来了才挂身份证，play 被拒不挂
        kaNote();
      }).catch(() => {});
    } else {
      kaMediaOn(); // 无 Promise 可等，尽力而为直接挂
    }
  }

  // ===== MediaSession：媒体身份证 =====
  // 光有静音轨，部分安卓 ROM 仍把页面当「不出声的网页」收网络通道。
  // 挂上 MediaMetadata 后系统把 App 归类为「媒体播放中」，后台优先级更高，
  // 网络管制有机会放宽（吃不吃这套看 ROM，实测为准）。
  // 不支持 MediaSession 的浏览器（iOS Safari 部分版本）静默跳过，零副作用。
  function kaMediaOn() {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try {
      if (!navigator.mediaSession.metadata && typeof MediaMetadata === 'function') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: '溯流计划',
          artist: '战术核心 · 后台驻留',
          album: 'RETROFLOW'
        });
      }
      navigator.mediaSession.playbackState = 'playing';
      // 接管媒体通知上的键，别让系统直接作用于音频元素：
      // play = 补播（走单一收口）；pause = 用户主动关保活——
      // 若不接管，暂停会被 kaAudioStolen 当成「被抢」两秒后重播，通知栏的暂停键永远按不死它
      navigator.mediaSession.setActionHandler('play', () => { kaSync(); });
      navigator.mediaSession.setActionHandler('pause', () => {
        loadCfg().on = false;
        saveCfg();
        kaSync(); // want=false：停轨、清身份证、状态行如实变 off
      });
      kaMediaMounted = true;
    } catch (_) {}
  }
  function kaMediaOff() {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = 'none';
    } catch (_) {}
    kaMediaMounted = false;
  }
  /** 媒体身份证三态：unsupported 无 API / mounted 已挂 / idle 音轨没真播起来 */
  function kaMediaState() {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return 'unsupported';
    return kaMediaMounted ? 'mounted' : 'idle';
  }

  // ===== 音乐让路 =====
  // 判据只能是「那个 audio 真的在出声」，不能用 UI 播放状态——
  // 假播放（如桌面黑胶唱机）不产生音频流，跟着让路等于白白把页面交出去被冻
  function kaMusicLive() {
    if (!kaMusicEl) return false;
    return !kaMusicEl.paused && !kaMusicEl.ended;
  }

  /**
   * 认领真实音乐元素（对外接口）。将来接入真音源的音乐页在建出 audio 后调一次。
   * @param {HTMLMediaElement} el
   */
  function kaWatchMusic(el) {
    if (kaMusicEl || !el) return;
    kaMusicEl = el;
    el.addEventListener('play', kaSync);
    el.addEventListener('pause', kaSync);
    el.addEventListener('ended', kaSync);
  }

  // ===== 手势闩 =====
  function kaArm() {
    if (kaArmed) return;
    kaArmed = true;
    document.addEventListener('pointerdown', kaGesture, true);
    document.addEventListener('touchend', kaGesture, true);
    document.addEventListener('click', kaGesture, true);
  }
  function kaDisarm() {
    if (!kaArmed) return;
    kaArmed = false;
    document.removeEventListener('pointerdown', kaGesture, true);
    document.removeEventListener('touchend', kaGesture, true);
    document.removeEventListener('click', kaGesture, true);
  }
  // 先摘闩再播：播不成的话 kaAudioSync 会重新挂一次，等下一下点击
  function kaGesture() {
    kaDisarm();
    kaAudioSync();
    kaNote();
  }

  // ===== 屏幕常亮 =====
  function kaWakeSupported() {
    return !!(navigator.wakeLock && navigator.wakeLock.request);
  }
  function kaWakeSync() {
    const want = loadCfg().wake && kaWakeSupported() && document.visibilityState === 'visible';
    if (!want) { kaWakeDrop(); return; }
    if (kaWakeLock || kaWakeBusy) return;
    kaWakeBusy = true;
    navigator.wakeLock.request('screen').then((s) => {
      kaWakeBusy = false;
      // 申请是异步的，这期间用户可能已关开关或切走 App。
      // 不补这道校验，锁会挂在一个「已经不该有锁」的状态上
      if (!loadCfg().wake || document.visibilityState !== 'visible') {
        kaWakeRelease(s);
        return;
      }
      kaWakeLock = s;
      // 系统单方面收回时也要让状态行跟着变，否则页面上一直写着「已生效」
      s.addEventListener('release', () => {
        kaWakeLock = null;
        kaNote();
      });
      kaNote();
    }).catch(() => {
      kaWakeBusy = false;
      // 低电量模式下系统直接拒。不动开关——用户没做错什么，
      // 退出低电量回一次前台就自动生效，状态行会照实说「当前未生效」
      kaNote();
    });
  }
  function kaWakeDrop() {
    if (!kaWakeLock) return;
    const s = kaWakeLock;
    kaWakeLock = null;
    kaWakeRelease(s);
  }
  function kaWakeRelease(s) {
    try { s.release(); } catch (_) {}
  }

  // ===== 设置页调的口子 =====
  // 每一项即时生效、即时落盘，所以保活设置卡没有「保存」按钮。
  // kaSetOn(true) 必须在用户点击的那一下里调：play() 只在用户激活的上下文里被放行，
  // 开关的 click 处理器直接调它，正好落在这个上下文里
  function kaSetOn(on) {
    loadCfg().on = !!on;
    saveCfg();
    kaAudioSync();
  }
  function kaSetWake(on) {
    loadCfg().wake = !!on;
    saveCfg();
    kaWakeSync();
  }

  // ===== 状态自证 =====
  /** 音轨四态：off 关着 / yield 音乐让路 / run 正在播 / wait 开关亮着但没跑（等手势） */
  function kaState() {
    if (!loadCfg().on) return 'off';
    if (kaMusicLive()) return 'yield';
    if (kaAudio && !kaAudio.paused) return 'run';
    return 'wait';
  }
  /** 屏幕锁三态：dead 不支持 / off 关着 / on 生效中 / wait 开着但没拿到（未回前台或被拒） */
  function kaWakeState() {
    if (!kaWakeSupported()) return 'dead';
    if (!loadCfg().wake) return 'off';
    return kaWakeLock ? 'on' : 'wait';
  }

  // ===== 接线 =====
  // 回到前台补一次：iOS 会在切走之后掐掉音轨，屏幕锁则一律被系统收回。
  // 只认 visible 这一边——切走时什么都不用做，那两样系统自己会收
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    kaSync();
  });

  // 开机恢复。放在 Boot.onReady 之后，避免抢在存储与页面骨架之前
  function kaBootRestore() {
    const cfg = loadCfg();
    if (cfg.wake) kaWakeSync();
    // 这一次十有八九被拒（页面刚起来还没有用户操作），
    // 被拒后 kaAudioSync 自己会挂上手势闩，等用户随便点哪儿那一下
    if (cfg.on) kaAudioSync();
  }
  if (window.Boot && typeof Boot.onReady === 'function') {
    Boot.onReady('core', kaBootRestore);
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', kaBootRestore);
  } else {
    kaBootRestore();
  }

  // 暴露给全局（设置页 terminal-config.js 消费）
  window.KeepaliveCore = {
    getConfig: () => ({ ...loadCfg() }),
    setOn: kaSetOn,
    setWake: kaSetWake,
    getState: kaState,
    getWakeState: kaWakeState,
    isWakeSupported: kaWakeSupported,
    getMediaState: kaMediaState,
    version: KA_VERSION,
    watchMusic: kaWatchMusic
  };
})();
