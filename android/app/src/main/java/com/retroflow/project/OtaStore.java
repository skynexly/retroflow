package com.retroflow.project;

import android.content.Context;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;

/**
 * 溯流计划 · OTA 覆盖层存储与回滚守卫（原生侧共享工具）。
 *
 * 目录布局（全部位于 app 内部私有存储 getFilesDir()/ota，无需任何运行时权限，
 * 卸载即清，且不会被系统媒体扫描器索引到用户可见位置）：
 *
 *   files/ota/current/           当前生效的覆盖层。RetroflowRouteProcessor 优先从这里取文件，
 *                                缺失的（如常驻字体）自动回退到 APK 内置 assets/public。
 *   files/ota/staging/           下载与解压的暂存区，应用完成后清空。
 *   files/ota/current.bak/       切换瞬间的旧覆盖层备份，切换成功后立即删除。
 *   files/ota/meta.json          当前生效覆盖层的版本信息 {build, version, appliedAt}。
 *   files/ota/pending-confirm.json  回滚守卫标记 {build, attempts}。
 *
 * 回滚守卫原理（防止拉到坏包后 app 打不开）：
 *   应用覆盖层时写 pending(attempts=0) → JS reload → onCreate 读到 pending，
 *   attempts=0 说明是「刚装好、正要验证」的层，放行并置 attempts=1，给它一次完整启动机会。
 *   若新层正常，JS 会调 confirmBoot() 删除 pending；若新层是坏的（白屏 / JS 崩），
 *   confirmBoot 永不触发，用户下次启动时 onCreate 读到 attempts=1（≥1），判定为坏层，
 *   删除 current 回退到 APK 内置资源，app 恢复可用。
 */
final class OtaStore {

    private static final String TAG = "RetroflowOTA";
    private static final Charset UTF8 = Charset.forName("UTF-8");

    private OtaStore() {}

    static File root(Context c) { return new File(c.getFilesDir(), "ota"); }
    static File current(Context c) { return new File(root(c), "current"); }
    static File staging(Context c) { return new File(root(c), "staging"); }
    static File pendingFile(Context c) { return new File(root(c), "pending-confirm.json"); }
    static File metaFile(Context c) { return new File(root(c), "meta.json"); }

    static void log(String m) { Log.i(TAG, m); }

    static void deleteRecursively(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) {
                for (File k : kids) deleteRecursively(k);
            }
        }
        // 删除失败无需处理：下次 cleanStaging / swap 仍会重试
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    static void cleanStaging(Context c) {
        File s = staging(c);
        deleteRecursively(s);
        //noinspection ResultOfMethodCallIgnored
        s.mkdirs();
    }

    static JSONObject readJson(File f) {
        if (f == null || !f.isFile()) return null;
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] buf = new byte[(int) Math.max(f.length(), 1)];
            int read = 0;
            while (read < buf.length) {
                int n = in.read(buf, read, buf.length - read);
                if (n < 0) break;
                read += n;
            }
            return new JSONObject(new String(buf, 0, read, UTF8));
        } catch (Exception e) {
            return null;
        } finally {
            if (in != null) {
                try { in.close(); } catch (Exception ignored) {}
            }
        }
    }

    static void writeJson(File f, JSONObject o) throws IOException {
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();
        }
        FileOutputStream out = null;
        try {
            out = new FileOutputStream(f);
            out.write(o.toString().getBytes(UTF8));
            out.getFD().sync();
        } finally {
            if (out != null) {
                try { out.close(); } catch (Exception ignored) {}
            }
        }
    }

    /** 应用新覆盖层前调用：清掉上一次遗留的暂存。 */
    static void writeMeta(Context c, int build, String version) {
        try {
            JSONObject o = new JSONObject();
            o.put("build", build);
            o.put("version", version == null ? "" : version);
            o.put("appliedAt", System.currentTimeMillis());
            writeJson(metaFile(c), o);
        } catch (Exception ignored) {}
    }

    static JSONObject readMeta(Context c) { return readJson(metaFile(c)); }

    static void writePending(Context c, int build) {
        try {
            JSONObject o = new JSONObject();
            o.put("build", build);
            o.put("attempts", 0);
            writeJson(pendingFile(c), o);
        } catch (Exception ignored) {}
    }

    /** JS 确认覆盖层能正常启动后调用：清除回滚守卫标记。幂等。 */
    static void confirm(Context c) {
        File p = pendingFile(c);
        if (p.isFile()) {
            //noinspection ResultOfMethodCallIgnored
            p.delete();
            log("覆盖层启动已确认，回滚守卫解除");
        }
    }

    /**
     * 启动时的回滚守卫。必须在创建 Bridge（会加载首页）之前调用。
     * 见类注释的 attempts 计数原理。
     */
    static void rollbackIfUnconfirmed(Context c) {
        File p = pendingFile(c);
        if (!p.isFile()) return; // 无覆盖层或已确认，正常启动
        JSONObject o = readJson(p);
        if (o == null) {
            // 标记损坏，保守起见清掉标记但保留 current（current 可能是好的）
            //noinspection ResultOfMethodCallIgnored
            p.delete();
            return;
        }
        int attempts = o.optInt("attempts", 0);
        if (attempts >= 1) {
            log("覆盖层上次启动未确认（attempts=" + attempts + "），判定为坏层，回滚到 APK 内置资源");
            deleteRecursively(current(c));
            //noinspection ResultOfMethodCallIgnored
            p.delete();
        } else {
            // 第一次加载这个覆盖层，给它一次完整启动机会
            try {
                o.put("attempts", 1);
                writeJson(p, o);
            } catch (Exception e) {
                //noinspection ResultOfMethodCallIgnored
                p.delete();
            }
        }
    }

    /**
     * 原子切换：把 staging/unzipped 提升为 current。
     * 同处于 getFilesDir()/ota 内，rename 在同一文件系统上是原子的。
     * 任何一步失败都尽量恢复到切换前状态，绝不留半截覆盖层。
     */
    static void swapStagingToCurrent(Context c) throws IOException {
        File cur = current(c);
        File unzipped = new File(staging(c), "unzipped");
        if (!unzipped.isDirectory()) throw new IOException("暂存区无解压内容");

        File bak = new File(root(c), "current.bak");
        deleteRecursively(bak);

        if (cur.exists()) {
            if (!cur.renameTo(bak)) throw new IOException("无法备份当前覆盖层");
        }
        if (!unzipped.renameTo(cur)) {
            // 提升失败，尝试把备份还原，保证 app 仍能用上旧覆盖层
            if (bak.exists()) {
                //noinspection ResultOfMethodCallIgnored
                bak.renameTo(cur);
            }
            throw new IOException("无法启用新覆盖层");
        }
        deleteRecursively(bak);
    }
}
