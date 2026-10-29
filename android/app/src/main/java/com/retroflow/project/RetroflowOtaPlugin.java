package com.retroflow.project;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 溯流计划 · OTA 应用引擎（原生插件，JS 侧名 RetroflowOta）。
 *
 * 设计红线：下载、校验、解压全部在原生 Java 完成，更新包的字节永不过 JS↔原生桥。
 * 这是从「导出 108MB 备份整串过桥触发 OutOfMemoryError 崩掉整个 app」的事故里定的规矩——
 * 大体积数据一旦经 MessageHandler 的 JSON 序列化就会撑爆 256MB 原生堆。JS 只发指令、收进度事件。
 *
 * 方法：
 *   applyUpdate({url, sha256, size, build, version}) → 下载→校验→解压→原子切换→写守卫标记，resolve({ok,build})。
 *   confirmBoot() → JS 确认覆盖层正常启动，解除回滚守卫。
 *   getAppliedVersion() → 返回当前生效覆盖层的 {build, version, hotUpdated}。
 *
 * 进度经 notifyListeners("otaProgress", {phase, percent}) 推送，JS 侧用 addListener 接收。
 */
@CapacitorPlugin(name = "RetroflowOta")
public class RetroflowOtaPlugin extends Plugin {

    private static final int CONNECT_TIMEOUT_MS = 20000;
    private static final int READ_TIMEOUT_MS = 30000;
    private static final int MAX_REDIRECTS = 5;

    @PluginMethod
    public void applyUpdate(final PluginCall call) {
        final String url = call.getString("url");
        final String sha256 = call.getString("sha256");
        final int build = call.getInt("build", 0);
        final String version = call.getString("version", "");

        if (url == null || url.trim().isEmpty()) {
            call.reject("缺少更新包下载地址");
            return;
        }
        if (sha256 == null || sha256.trim().isEmpty()) {
            call.reject("更新清单缺少 SHA-256，拒绝安装");
            return;
        }

        call.setKeepAlive(true);
        final String fUrl = url.trim();
        final String fSha = sha256.trim().toLowerCase();
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    doApply(call, fUrl, fSha, build, version);
                } catch (Exception e) {
                    OtaStore.log("applyUpdate 失败: " + e);
                    try {
                        call.reject("更新失败：" + (e.getMessage() == null ? e.toString() : e.getMessage()));
                    } catch (Exception ignored) {}
                }
            }
        }).start();
    }

    private void doApply(PluginCall call, String url, String sha256, int build, String version) throws Exception {
        Context ctx = getContext();

        emit("download", 0);
        OtaStore.cleanStaging(ctx);
        File zip = new File(OtaStore.staging(ctx), "package.zip");

        downloadTo(url, zip);

        emit("verify", 100);
        String actual = sha256(zip);
        if (!actual.equalsIgnoreCase(sha256)) {
            OtaStore.deleteRecursively(zip);
            throw new IOException("校验失败，更新包已损坏或被篡改");
        }

        emit("unzip", 100);
        File unzipped = new File(OtaStore.staging(ctx), "unzipped");
        OtaStore.deleteRecursively(unzipped);
        unzip(zip, unzipped);
        if (!new File(unzipped, "index.html").isFile()) {
            throw new IOException("更新包缺少 index.html，拒绝安装");
        }

        emit("install", 100);
        OtaStore.swapStagingToCurrent(ctx);
        OtaStore.writeMeta(ctx, build, version);
        OtaStore.writePending(ctx, build);

        // 收尾清理，失败不影响结果
        OtaStore.deleteRecursively(zip);
        OtaStore.cleanStaging(ctx);

        OtaStore.log("覆盖层已应用 build=" + build + " version=" + version);
        JSObject r = new JSObject();
        r.put("ok", true);
        r.put("build", build);
        call.resolve(r);
    }

    @PluginMethod
    public void confirmBoot(PluginCall call) {
        OtaStore.confirm(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getAppliedVersion(PluginCall call) {
        JSONObject meta = OtaStore.readMeta(getContext());
        JSObject o = new JSObject();
        boolean hasCurrent = OtaStore.current(getContext()).isDirectory();
        if (meta != null && hasCurrent) {
            o.put("hotUpdated", true);
            o.put("build", meta.optInt("build", 0));
            o.put("version", meta.optString("version", ""));
        } else {
            o.put("hotUpdated", false);
        }
        call.resolve(o);
    }

    /* ------------------------------- 内部实现 ------------------------------- */

    private void emit(String phase, int percent) {
        JSObject o = new JSObject();
        o.put("phase", phase);
        o.put("percent", percent);
        notifyListeners("otaProgress", o);
    }

    private void downloadTo(String urlStr, File dest) throws IOException {
        HttpURLConnection conn = null;
        String cur = urlStr;
        int redirects = 0;
        while (true) {
            URL u = new URL(cur);
            conn = (HttpURLConnection) u.openConnection();
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(false);
            conn.setRequestProperty("User-Agent", "RetroflowOTA/1.0");
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400) {
                String loc = conn.getHeaderField("Location");
                conn.disconnect();
                if (loc == null || loc.isEmpty()) throw new IOException("重定向缺少 Location");
                if (++redirects > MAX_REDIRECTS) throw new IOException("重定向次数过多");
                cur = loc;
                continue;
            }
            if (code != HttpURLConnection.HTTP_OK) {
                conn.disconnect();
                throw new IOException("下载失败，HTTP " + code);
            }
            break;
        }

        long total = conn.getContentLength(); // 包体 MB 级，int 足够；-1 表示未知
        InputStream in = null;
        FileOutputStream out = null;
        try {
            in = conn.getInputStream();
            out = new FileOutputStream(dest);
            byte[] buf = new byte[65536];
            long done = 0;
            int n;
            int lastPct = -1;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
                done += n;
                if (total > 0) {
                    int pct = (int) (done * 100 / total);
                    if (pct != lastPct) {
                        lastPct = pct;
                        emit("download", pct);
                    }
                }
            }
            out.getFD().sync();
        } finally {
            if (in != null) { try { in.close(); } catch (Exception ignored) {} }
            if (out != null) { try { out.close(); } catch (Exception ignored) {} }
            conn.disconnect();
        }
    }

    private String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        FileInputStream in = null;
        try {
            in = new FileInputStream(f);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        } finally {
            if (in != null) { try { in.close(); } catch (Exception ignored) {} }
        }
        byte[] dig = md.digest();
        StringBuilder sb = new StringBuilder(dig.length * 2);
        for (byte b : dig) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** 解压，带 Zip Slip 防护：任何越出目标目录的条目一律拒绝。 */
    private void unzip(File zip, File destDir) throws IOException {
        //noinspection ResultOfMethodCallIgnored
        destDir.mkdirs();
        String canon = destDir.getCanonicalPath();
        ZipInputStream zis = null;
        try {
            zis = new ZipInputStream(new FileInputStream(zip));
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = zis.getNextEntry()) != null) {
                File out = new File(destDir, e.getName());
                String outCanon = out.getCanonicalPath();
                if (!outCanon.equals(canon) && !outCanon.startsWith(canon + File.separator)) {
                    throw new IOException("Zip Slip 越界条目：" + e.getName());
                }
                if (e.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                } else {
                    File parent = out.getParentFile();
                    if (parent != null && !parent.isDirectory()) {
                        //noinspection ResultOfMethodCallIgnored
                        parent.mkdirs();
                    }
                    FileOutputStream fos = null;
                    try {
                        fos = new FileOutputStream(out);
                        int n;
                        while ((n = zis.read(buf)) != -1) fos.write(buf, 0, n);
                    } finally {
                        if (fos != null) { try { fos.close(); } catch (Exception ignored) {} }
                    }
                }
                zis.closeEntry();
            }
        } finally {
            if (zis != null) { try { zis.close(); } catch (Exception ignored) {} }
        }
    }
}
