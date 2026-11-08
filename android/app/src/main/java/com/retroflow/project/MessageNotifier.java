package com.retroflow.project;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Build;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * 溯流计划 · 消息系统通知（系统助手 / 私聊）。
 *
 * 一个会话只占一条通知：tag 用会话键（accountId|contactId），同会话连发直接替换，
 * 正文永远是最新一条，标题尾巴带累计条数，不刷屏。
 *
 * 点击：PendingIntent 打开 MainActivity 并携带 EXTRA_* 字段，由插件的 handleOnNewIntent
 * 接住。冷启动时 BridgeActivity.onCreate 末尾也会把启动 Intent 交给 onNewIntent，
 * 所以冷热两路走的是同一个入口。
 *
 * 头像：JS 侧先缩到 128px 的 JPEG 再以 base64 过桥（几 KB），绝不传原图——
 * 遵守「大体积数据不过 JS↔原生桥」的 OOM 红线。
 */
final class MessageNotifier {

    static final String CHANNEL_ID = "rf_message";
    static final String EXTRA_TAP = "rf_notice_tap";
    static final String EXTRA_KIND = "rf_notice_kind";
    static final String EXTRA_ACCOUNT = "rf_notice_account";
    static final String EXTRA_CONTACT = "rf_notice_contact";
    static final String EXTRA_ROSTER_ID = "rf_notice_roster_id";
    static final String EXTRA_ROSTER_TYPE = "rf_notice_roster_type";

    /** 所有消息通知共用的 id；按 tag 区分会话 */
    static final int NOTIFICATION_ID = 2001;
    /** 头像 base64 上限：128px JPEG 正常只有几 KB，超过说明 JS 没缩图，直接丢弃头像 */
    private static final int MAX_AVATAR_B64 = 200 * 1024;

    private MessageNotifier() {}

    static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        // IMPORTANCE_HIGH：弹横幅；声音振动用系统默认，用户可在系统设置里单独调这个渠道
        NotificationChannel ch = new NotificationChannel(
            CHANNEL_ID, "消息", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("系统助手与私聊的新消息");
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }

    /**
     * 发或更新一条会话通知。
     * @return false = 通知权限 / 总开关被系统关掉，没有发出去
     */
    static boolean notify(Context c, String tag, String title, String text, int count,
                          String avatarB64, long when, Intent tapExtras) {
        NotificationManagerCompat nmc = NotificationManagerCompat.from(c);
        if (!nmc.areNotificationsEnabled()) return false;
        ensureChannel(c);

        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        open.putExtras(tapExtras);
        open.putExtra(EXTRA_TAP, true);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        // requestCode 用 tag 的哈希：不同会话各自一个 PendingIntent，否则后发的会把先发的 extras 覆盖掉
        PendingIntent pi = PendingIntent.getActivity(c, tag.hashCode(), open, flags);

        String shownTitle = count > 1 ? title + "（" + count + " 条）" : title;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_keepalive)
            .setContentTitle(shownTitle)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setWhen(when > 0 ? when : System.currentTimeMillis())
            .setShowWhen(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // 锁屏显示与通知栏一致：是否露出正文由 app 内「显示消息内容」开关决定，
            // JS 侧在开关关闭时已把 text 换成占位文案
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setNumber(count);

        Bitmap avatar = decodeAvatar(avatarB64);
        if (avatar != null) b.setLargeIcon(avatar);

        try {
            nmc.notify(tag, NOTIFICATION_ID, b.build());
            return true;
        } catch (SecurityException e) {
            // Android 13+ 运行时权限被收回
            return false;
        }
    }

    static void cancel(Context c, String tag) {
        NotificationManagerCompat.from(c).cancel(tag, NOTIFICATION_ID);
    }

    static void cancelAll(Context c) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        // 只清消息通知，不碰驻留通知（它的 id 是 1101、无 tag）
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            for (android.service.notification.StatusBarNotification sbn : nm.getActiveNotifications()) {
                if (sbn.getId() == NOTIFICATION_ID) nm.cancel(sbn.getTag(), NOTIFICATION_ID);
            }
        }
    }

    private static Bitmap decodeAvatar(String b64) {
        if (b64 == null || b64.isEmpty() || b64.length() > MAX_AVATAR_B64) return null;
        try {
            int comma = b64.indexOf(',');
            String raw = comma >= 0 ? b64.substring(comma + 1) : b64; // 兼容 data URL 前缀
            byte[] bytes = Base64.decode(raw, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        } catch (Exception e) {
            return null;
        }
    }
}