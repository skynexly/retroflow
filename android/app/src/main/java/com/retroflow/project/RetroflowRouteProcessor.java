package com.retroflow.project;

import android.content.Context;

import com.getcapacitor.ProcessedRoute;
import com.getcapacitor.RouteProcessor;

import java.io.File;

/**
 * 溯流计划 · 覆盖层优先路由处理器。
 *
 * 让 WebView 的本地资源请求「覆盖层优先、缺失回退 APK 内置 asset」：
 *   命中 files/ota/current/<rel> → isAsset=false，返回绝对路径，走 openFile(FileInputStream)。
 *   未命中（如常驻字体 assets/fonts/*）→ isAsset=true，走 openAsset("public"+rel)，读 APK 内置。
 *
 * 这正是「字体常驻 + 其余热更」的实现支点：字体不打进更新包，覆盖层里没有，
 * 于是每个字体请求都自然回退到 APK 内置的那份，热更只覆盖变化的网页资源。
 *
 * 两处调用点（WebViewLocalServer）对 basePath 的传参不同，必须分别处理：
 *   1. 普通资源：process("", "/css/style.css")
 *      未命中需返回 "/css/style.css"，因为随后执行 openAsset(basePath + path) = openAsset("public/css/style.css")。
 *   2. SPA 首页：process("public", "/index.html")
 *      未命中需返回 "public/index.html"，因为随后执行 openAsset(path)，不再拼 basePath。
 *   区分办法：basePath 为空是普通资源调用，非空是首页调用；未命中时统一返回 basePath + "/" + rel，
 *   两种情况分别得到 "/css/style.css" 与 "public/index.html"，恰好都对。
 *   命中覆盖层时两处都返回绝对路径 + isAsset=false，openFile 语义一致。
 *
 * 安全：对每个请求路径做 canonical 校验，拒绝越出 current 目录的穿越（如 /../../）。
 */
public class RetroflowRouteProcessor implements RouteProcessor {

    private final File overlay; // files/ota/current

    public RetroflowRouteProcessor(Context context) {
        this.overlay = OtaStore.current(context);
    }

    @Override
    public ProcessedRoute process(String basePath, String path) {
        ProcessedRoute route = new ProcessedRoute();
        String p = (path == null) ? "/" : path;
        String rel = p.startsWith("/") ? p.substring(1) : p;

        if (rel.isEmpty()) {
            // 理论上不会到达（WebViewLocalServer 对 "/" 有专门分支），保守回退内置首页
            route.setAsset(true);
            route.setPath(prefix(basePath) + "/index.html");
            return route;
        }

        if (overlay.isDirectory()) {
            File f = new File(overlay, rel);
            try {
                String canon = overlay.getCanonicalPath();
                String target = f.getCanonicalPath();
                if (f.isFile() && (target.equals(canon) || target.startsWith(canon + File.separator))) {
                    route.setAsset(false);
                    route.setPath(f.getAbsolutePath());
                    return route;
                }
            } catch (Exception ignored) {
                // canonical 失败按未命中处理，回退内置 asset，绝不用可疑路径
            }
        }

        // 未命中覆盖层：回退 APK 内置 assets/public/<rel>
        route.setAsset(true);
        route.setPath(prefix(basePath) + "/" + rel);
        return route;
    }

    /** 普通资源调用 basePath 为空；首页调用 basePath="public"。见类注释。 */
    private static String prefix(String basePath) {
        return (basePath == null || basePath.isEmpty()) ? "" : basePath;
    }
}
