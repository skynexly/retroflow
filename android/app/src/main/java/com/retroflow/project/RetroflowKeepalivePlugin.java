package com.retroflow.project;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 溯流计划 · 后台驻留插件（JS 侧名 RetroflowKeepalive）。
 *
 * 只做指令转发与状态上报，不持有任何业务状态：保活开不开由 JS 的 KeepaliveCore
 * 唯一决定（cfg.on），本插件照令启停 KeepaliveService。
 *
 * 方法：
 *   start / stop                        启停前台服务
 *   getStatus                           {running, batteryExempt, notifications}
 *   requestNotificationPermission       Android 13+ 弹系统授权框，低版本直接返回 granted
 *   requestIgnoreBatteryOptimizations   弹系统「允许后台运行」对话框；已豁免则不弹
 *
 * 消息通知（系统助手 / 私聊，见 MessageNotifier）：
 *   notifyMessage      发或更新一条会话通知 {tag, title, text, count, avatar, when, kind, accountId, contactId, rosterId, rosterType}
 *   cancelMessage      撤掉某会话的通知 {tag}
 *   cancelAllMessages  撤掉全部消息通知（不碰驻留通知）
 *   takePendingTap     取走冷启动时暂存的那次点击（JS 就绪后调一次）
 *   事件 noticeTap     热启动（app 已在运行）时点通知，直接推给 JS
 *   （不叫 notify / cancel：避免与 Object.notify() 同名引起误读）
 */
@CapacitorPlugin(
    name = "RetroflowKeepalive",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class RetroflowKeepalivePlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        try {
            KeepaliveService.start(getContext());
            call.resolve(status());
        } catch (Exception e) {
            // 后台启动前台服务被系统拒（Android 12+）等情况：如实回报，JS 静默降级
            call.reject("前台服务启动失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        KeepaliveService.stop(getContext());
        call.resolve(status());
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || notificationsGranted()) {
            call.resolve(status());
            return;
        }
        requestPermissionForAlias("notifications", call, "onNotificationPermission");
    }

    @PermissionCallback
    private void onNotificationPermission(PluginCall call) {
        // 拒绝不算失败：服务照样运行，只是通知不进通知栏。状态如实回报即可
        call.resolve(status());
    }

    /**
     * 弹系统的「忽略电池优化」对话框。需要 REQUEST_IGNORE_BATTERY_OPTIMIZATIONS 权限。
     * 对话框是异步的，这里只负责弹出；结果由 JS 在 app 回到前台时调 getStatus 重新读取。
     */
    @SuppressLint("BatteryLife")
    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || batteryExempt()) {
            call.resolve(status());
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            JSObject r = status();
            r.put("prompted", true);
            call.resolve(r);
        } catch (Exception e) {
            // 个别 ROM 屏蔽了这个 Intent：退回电池优化列表页，让用户手动找
            try {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                JSObject r = status();
                r.put("prompted", true);
                r.put("fallback", true);
                call.resolve(r);
            } catch (Exception e2) {
                call.reject("无法打开电池优化设置：" + e2.getMessage());
            }
        }
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("running", KeepaliveService.running);
        o.put("batteryExempt", batteryExempt());
        o.put("notifications", notificationsGranted());
        return o;
    }

    /* ================= 消息通知 ================= */

    /**
     * 冷启动时暂存的点击。插件实例在 Bridge 建好时就存在，但 JS 那时还没加载，
     * notifyListeners 发出去没人接，所以先存着等 JS 来取。热启动时直接发事件。
     */
    private JSObject pendingTap = null;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || !intent.getBooleanExtra(MessageNotifier.EXTRA_TAP, false)) return;
        JSObject tap = new JSObject();
        tap.put("kind", intent.getStringExtra(MessageNotifier.EXTRA_KIND));
        tap.put("accountId", intent.getStringExtra(MessageNotifier.EXTRA_ACCOUNT));
        tap.put("contactId", intent.getStringExtra(MessageNotifier.EXTRA_CONTACT));
        tap.put("rosterId", intent.getStringExtra(MessageNotifier.EXTRA_ROSTER_ID));
        tap.put("rosterType", intent.getStringExtra(MessageNotifier.EXTRA_ROSTER_TYPE));
        // 同一个 Intent 别被处理两次（配置变化重建 Activity 时 getIntent 还是它）
        intent.removeExtra(MessageNotifier.EXTRA_TAP);
        if (hasListeners("noticeTap")) {
            notifyListeners("noticeTap", tap);
        } else {
            pendingTap = tap;
        }
    }

    @PluginMethod
    public void takePendingTap(PluginCall call) {
        JSObject r = new JSObject();
        if (pendingTap != null) {
            r.put("tap", pendingTap);
            pendingTap = null;
        }
        call.resolve(r);
    }

    @PluginMethod
    public void notifyMessage(PluginCall call) {
        String tag = call.getString("tag");
        String title = call.getString("title");
        if (tag == null || tag.isEmpty() || title == null) {
            call.reject("notify 缺少 tag 或 title");
            return;
        }
        Intent extras = new Intent();
        extras.putExtra(MessageNotifier.EXTRA_KIND, call.getString("kind", "online"));
        extras.putExtra(MessageNotifier.EXTRA_ACCOUNT, call.getString("accountId", ""));
        extras.putExtra(MessageNotifier.EXTRA_CONTACT, call.getString("contactId", ""));
        extras.putExtra(MessageNotifier.EXTRA_ROSTER_ID, call.getString("rosterId", ""));
        extras.putExtra(MessageNotifier.EXTRA_ROSTER_TYPE, call.getString("rosterType", ""));
        Long when = call.getLong("when");
        boolean shown = MessageNotifier.notify(
            getContext(), tag, title, call.getString("text", ""),
            call.getInt("count", 1), call.getString("avatar"),
            when == null ? 0L : when, extras);
        JSObject r = new JSObject();
        r.put("shown", shown);
        call.resolve(r);
    }

    @PluginMethod
    public void cancelMessage(PluginCall call) {
        String tag = call.getString("tag");
        if (tag != null && !tag.isEmpty()) MessageNotifier.cancel(getContext(), tag);
        call.resolve();
    }

    @PluginMethod
    public void cancelAllMessages(PluginCall call) {
        MessageNotifier.cancelAll(getContext());
        call.resolve();
    }

    private boolean batteryExempt() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        Context c = getContext();
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName());
    }

    private boolean notificationsGranted() {
        Context c = getContext();
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return false;
        }
        // 权限给了但用户在系统设置里把本 app 通知整体关掉，同样算「不显示」
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }
}
