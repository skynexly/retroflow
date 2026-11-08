package com.retroflow.project;

import android.os.Bundle;

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
 *   3. 注册 OTA 插件 RetroflowOta（下载/校验/解压/切换/确认）。
 *   4. 装覆盖层优先路由处理器：让 WebView 的资源请求「覆盖层优先、缺失回退内置」，
 *      实现字体常驻 + 其余热更。
 *
 * bridgeBuilder 是 BridgeActivity 的 protected 字段，构造期即就绪，
 * 故可在 super.onCreate() 之前设置 routeProcessor 与插件。
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 1. 覆盖层过期守卫（升壳后让位给 APK 内置资源）
        OtaStore.discardStaleOverlay(getApplicationContext());

        // 2. 回滚守卫（早于 Bridge 加载首页）
        OtaStore.rollbackIfUnconfirmed(getApplicationContext());

        // 3. 注册 OTA 插件
        registerPlugin(RetroflowOtaPlugin.class);

        // 4. 覆盖层优先路由处理器
        bridgeBuilder.setRouteProcessor(new RetroflowRouteProcessor(getApplicationContext()));

        super.onCreate(savedInstanceState);
    }
}