package com.retroflow.project;

import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

/**
 * 溯流计划 · 原生入口。
 *
 * 在 super.onCreate() 构建 Bridge（会加载首页）之前完成四件事，顺序不可调换：
 *   1. 覆盖层过期守卫：若装机 versionCode 已高于覆盖层记录的版本，说明 APK 内置资源
 *      比覆盖层新（刚升过壳），删掉覆盖层。必须最先做，否则新壳的改动会被旧覆盖层遮住，
 *      且客户端会自报旧 versionCode 被 minBinary 永久拒更新。
 *   2. 回滚守卫：若上次热更的覆盖层从未被 JS 确认能正常启动，判定为坏层，
 *      删除覆盖层回退到 APK 内置资源。必须早于任何页面加载，否则又会加载坏层。
 *   3. 注册原生插件：RetroflowOta（下载/校验/解压/切换/确认）、
 *      RetroflowKeepalive（后台驻留前台服务启停与权限）、
 *      RetroflowMedia（图片写入系统相册「溯流计划」）。
 *   4. 装覆盖层优先路由处理器：让 WebView 的资源请求「覆盖层优先、缺失回退内置」，
 *      实现字体常驻 + 其余热更。
 *
 * bridgeBuilder 是 BridgeActivity 的 protected 字段，构造期即就绪，
 * 故可在 super.onCreate() 之前设置 routeProcessor 与插件。
 *
 * super.onCreate() 之后：5. 接管系统返回键 / 手势返回（见 onSystemBack）。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 1. 覆盖层过期守卫（升壳后让位给 APK 内置资源）
        OtaStore.discardStaleOverlay(getApplicationContext());

        // 2. 回滚守卫（早于 Bridge 加载首页）
        OtaStore.rollbackIfUnconfirmed(getApplicationContext());

        // 3. 注册原生插件
        registerPlugin(RetroflowOtaPlugin.class);
        registerPlugin(RetroflowKeepalivePlugin.class);
        registerPlugin(RetroflowMediaPlugin.class);

        // 4. 覆盖层优先路由处理器
        bridgeBuilder.setRouteProcessor(new RetroflowRouteProcessor(getApplicationContext()));

        super.onCreate(savedInstanceState);

        // 5. 系统返回键 / 手势返回（必须在 super.onCreate 之后：bridge 那时才建好）
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                onSystemBack();
            }
        });
    }

    /** 两次返回的判定窗口，与提示停留时长一致 */
    private static final long EXIT_WINDOW_MS = 2000L;
    private long lastRootBackAt = 0L;

    /**
     * Capacitor 6 的 BridgeActivity 不接管返回键，默认行为是 finish() 关掉 Activity，
     * 网页的 popstate 一次也收不到。这里改为：
     *   · WebView 还有历史可退：goBack()，触发 popstate，各页面原有的逐级返回逻辑照常生效；
     *   · 已在主桌面：第一次只提示，窗口期内再按一次才退到后台。
     * 「退出」用 moveTaskToBack 而不是 finish：Activity 与 WebView 保留，
     * 后台生成和消息通知不中断（前台服务只保进程，不保已销毁的页面）。
     */
    private void onSystemBack() {
        WebView wv = bridge == null ? null : bridge.getWebView();
        if (wv != null && wv.canGoBack()) {
            lastRootBackAt = 0L;
            wv.goBack();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (now - lastRootBackAt <= EXIT_WINDOW_MS) {
            lastRootBackAt = 0L;
            moveTaskToBack(true);
            return;
        }
        lastRootBackAt = now;
        showExitHint(wv);
    }

    /** 优先用页面自己的 RetroToast 保持界面风格；页面没就绪（脚本未加载）时退回系统 Toast */
    private void showExitHint(WebView wv) {
        if (wv == null) {
            nativeExitHint();
            return;
        }
        String js = "(function(){try{if(window.RetroToast&&typeof RetroToast.show==='function'){"
            + "RetroToast.show({message:'再按一次返回退出',tag:'SYSTEM LOG // 讯息',type:'info',duration:"
            + EXIT_WINDOW_MS + "});return 1;}}catch(e){}return 0;})()";
        wv.evaluateJavascript(js, value -> {
            if (!"1".equals(value)) nativeExitHint();
        });
    }

    private void nativeExitHint() {
        Toast.makeText(this, "再按一次返回退出", Toast.LENGTH_SHORT).show();
    }
}