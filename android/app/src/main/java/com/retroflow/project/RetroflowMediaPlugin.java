package com.retroflow.project;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 溯流计划 · 相册写入插件（JS 侧名 RetroflowMedia）。
 *
 * 把图片写进系统相册 Pictures/溯流计划/，相册 app 会把它识别成独立的「溯流计划」相册。
 * 走 MediaStore（Android 10+），app 自己写入的媒体不需要任何存储权限。
 * Android 9 及以下 getInfo 报 supported=false，JS 退回原来的 Download 直写。
 *
 * 分块写入，遵守「大体积数据不过 JS↔原生桥」的 OOM 红线：
 *   beginImage  {name, mime}  → {id}   建一条 IS_PENDING=1 的记录（写完前相册里看不到）
 *   appendImage {id, data}            追加一块 base64
 *   finishImage {id}          → {uri}  关流，IS_PENDING=0，图片出现在相册里
 *   abortImage  {id}                   关流并删除半截记录
 * 进程中途死掉留下的 pending 记录由系统在 7 天后自动清理。
 */
@CapacitorPlugin(name = "RetroflowMedia")
public class RetroflowMediaPlugin extends Plugin {

    static final String ALBUM = "溯流计划";

    private static final class Session {
        final Uri uri;
        final OutputStream out;
        Session(Uri uri, OutputStream out) { this.uri = uri; this.out = out; }
    }

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q;
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("supported", supported());
        r.put("album", ALBUM);
        call.resolve(r);
    }

    @PluginMethod
    public void beginImage(PluginCall call) {
        if (!supported()) { call.reject("系统版本过低，不支持写入相册"); return; }
        String name = call.getString("name");
        String mime = call.getString("mime", "image/png");
        if (name == null || name.isEmpty()) { call.reject("缺少文件名"); return; }

        ContentResolver cr = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
        v.put(MediaStore.Images.Media.MIME_TYPE, mime);
        v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ALBUM);
        v.put(MediaStore.Images.Media.IS_PENDING, 1);

        Uri uri = null;
        try {
            uri = cr.insert(MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
            if (uri == null) { call.reject("相册记录创建失败"); return; }
            OutputStream out = cr.openOutputStream(uri, "w");
            if (out == null) throw new IllegalStateException("无法打开写入流");
            String id = UUID.randomUUID().toString();
            sessions.put(id, new Session(uri, out));
            JSObject r = new JSObject();
            r.put("id", id);
            call.resolve(r);
        } catch (Exception e) {
            if (uri != null) {
                try { cr.delete(uri, null, null); } catch (Exception ignored) {}
            }
            call.reject("相册写入失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void appendImage(PluginCall call) {
        Session s = sessions.get(call.getString("id", ""));
        if (s == null) { call.reject("写入会话不存在"); return; }
        String data = call.getString("data");
        if (data == null) { call.reject("缺少数据"); return; }
        try {
            s.out.write(Base64.decode(data, Base64.DEFAULT));
            call.resolve();
        } catch (Exception e) {
            call.reject("相册写入失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void finishImage(PluginCall call) {
        Session s = sessions.remove(call.getString("id", ""));
        if (s == null) { call.reject("写入会话不存在"); return; }
        ContentResolver cr = getContext().getContentResolver();
        try {
            s.out.flush();
            s.out.close();
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.IS_PENDING, 0);
            cr.update(s.uri, v, null, null);
            JSObject r = new JSObject();
            r.put("uri", s.uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            try { cr.delete(s.uri, null, null); } catch (Exception ignored) {}
            call.reject("相册写入失败：" + e.getMessage());
        }
    }

    @PluginMethod
    public void abortImage(PluginCall call) {
        Session s = sessions.remove(call.getString("id", ""));
        if (s != null) {
            try { s.out.close(); } catch (Exception ignored) {}
            try { getContext().getContentResolver().delete(s.uri, null, null); } catch (Exception ignored) {}
        }
        call.resolve();
    }
}
