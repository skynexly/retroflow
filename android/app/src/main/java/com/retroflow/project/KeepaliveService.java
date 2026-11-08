package com.retroflow.project;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * 溯流计划 · 后台驻留前台服务。
 *
 * 作用：把进程优先级抬到「前台服务」级，系统不再把切到后台的 app 当缓存进程冻结，
 * WebView 里的流式生成与定时器得以在切走 / 锁屏后继续运行。
 *
 * 能力边界（如实记录，别对它有过高期待）：
 *   · 保住的是进程，不是页面。用户从最近任务划掉卡片会销毁 Activity 与 WebView，
 *     JS 侧的逻辑随之停止；服务本身可能存活，但没有页面可跑。
 *   · 强制停止、系统极端内存压力下照样会被杀。
 *   · 深度休眠下的网络限制需配合「忽略电池优化」，三星另有自家休眠名单，无 API 可改。
 *
 * 服务类型选 specialUse 而非 dataSync：dataSync 语义是有限时长传输，targetSdk ≥ 35
 * 后每日上限 6 小时；本服务是用户主动开启的常驻驻留，specialUse 无时长上限。
 *
 * 生命周期由 JS 的保活总闸（KeepaliveCore 的 cfg.on）唯一决定，经 RetroflowKeepalivePlugin
 * 下发 start / stop。返回 START_STICKY：进程被系统回收后尝试重建服务（重建时只挂通知，
 * WebView 要等 Activity 重新打开才回来）。
 */
public class KeepaliveService extends Service {

    static final String TAG = "RetroflowKeepalive";
    static final String CHANNEL_ID = "rf_keepalive";
    static final int NOTIFICATION_ID = 1101;

    /** 运行标记。进程内单例，供插件 getStatus 如实上报。 */
    static volatile boolean running = false;

    static void start(Context c) {
        Intent i = new Intent(c, KeepaliveService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            c.startForegroundService(i);
        } else {
            c.startService(i);
        }
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, KeepaliveService.class));
    }

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = buildNotification(this);
        try {
            int type = 0;
            if (Build.VERSION.SDK_INT >= 34) {
                type = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            }
            ServiceCompat.startForeground(this, NOTIFICATION_ID, n, type);
            running = true;
            Log.i(TAG, "前台服务已启动");
        } catch (Exception e) {
            // Android 12+ 后台启动前台服务会抛 ForegroundServiceStartNotAllowedException。
            // 正常路径都在 app 前台时启动，走到这里说明时机不对：如实停掉，别留半死服务。
            running = false;
            Log.w(TAG, "前台服务启动失败：" + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        Log.i(TAG, "前台服务已停止");
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_MIN：不响、不振、不弹横幅、状态栏不显示图标，只在通知抽屉里折叠存在
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "后台驻留", NotificationManager.IMPORTANCE_MIN);
        ch.setDescription("后台保活开启时常驻，维持终端在后台继续运行");
        ch.setShowBadge(false);
        ch.setSound(null, null);
        ch.enableVibration(false);
        nm.createNotificationChannel(ch);
    }

    static Notification buildNotification(Context c) {
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open == null) open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) piFlags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(c, 0, open, piFlags);

        return new NotificationCompat.Builder(c, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_keepalive)
            .setContentTitle("溯流终端 · 后台驻留中")
            .setContentText("关闭请前往 设置 → 终端配置 → 后台保活")
            .setContentIntent(pi)
            .setOngoing(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // Android 12+ 默认会把前台服务通知延迟 10 秒显示；立即显示，让用户知道它在跑
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
    }
}
