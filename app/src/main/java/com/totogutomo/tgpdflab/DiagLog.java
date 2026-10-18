package com.totogutomo.tgpdflab;

import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Process;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Log diagnostik TG Office, disimpan ke berkas agar tetap ada walau aplikasi dimatikan paksa.
 * Privasi: nama berkas, alamat berkas, dan isi dokumen TIDAK dicatat (disaring otomatis).
 * Ukuran dibatasi ~200 KB (log.txt + log.1.txt bergiliran).
 */
public final class DiagLog {
    private static final String TAG = "TG_DIAG";
    private static final long MAX_BYTES = 100L * 1024L; // per berkas, 2 berkas = ~200 KB
    private static final Object LOCK = new Object();
    private static final Pattern URI = Pattern.compile("(content|file)://\\S+");
    private static final Pattern PATH = Pattern.compile("/(storage|sdcard|data|mnt)/\\S+");
    private static final Pattern DOC = Pattern.compile(
        "[^\\s/\"'=:]+\\.(pdf|docx|xlsx|pptx|doc|xls|ppt)\\b", Pattern.CASE_INSENSITIVE);
    private static Context app;

    private DiagLog() { }

    public static void init(Context ctx) { if (app == null && ctx != null) app = ctx.getApplicationContext(); }

    /** Hapus nama/alamat berkas dari teks bebas (mis. pesan galat). */
    public static String scrub(String s) {
        if (s == null) return "";
        s = URI.matcher(s).replaceAll("$1://[disembunyikan]");
        s = PATH.matcher(s).replaceAll("/$1/[disembunyikan]");
        s = DOC.matcher(s).replaceAll("[berkas].$1");
        return s;
    }

    public static void log(Context ctx, String tag, String msg) {
        init(ctx);
        if (app == null) return;
        String line = new SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(new Date())
            + " p" + Process.myPid() + " " + tag + " " + scrub(msg) + "\n";
        Log.i(TAG, line.trim());
        synchronized (LOCK) {
            try {
                File dir = new File(app.getFilesDir(), "diag");
                if (!dir.exists() && !dir.mkdirs()) return;
                File cur = new File(dir, "log.txt");
                if (cur.length() > MAX_BYTES) {
                    File old = new File(dir, "log.1.txt");
                    if (old.exists()) old.delete();
                    cur.renameTo(old);
                    cur = new File(dir, "log.txt");
                }
                try (FileOutputStream out = new FileOutputStream(cur, true)) {
                    out.write(line.getBytes(StandardCharsets.UTF_8));
                    out.getFD().sync();
                }
            } catch (Exception ignored) { }
        }
    }

    public static void log(String tag, String msg) { log(app, tag, msg); }

    public static String header(Context ctx) {
        StringBuilder b = new StringBuilder();
        b.append("TeGe Office — log diagnostik (tanpa nama berkas)\n");
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            b.append("Versi: ").append(pi.versionName).append(" (").append(pi.getLongVersionCode()).append(")\n");
        } catch (Exception ignored) { }
        b.append("Perangkat: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
            .append(" · Android ").append(Build.VERSION.RELEASE).append(" / API ").append(Build.VERSION.SDK_INT).append('\n');
        try {
            PackageInfo wv = android.webkit.WebView.getCurrentWebViewPackage();
            if (wv != null) b.append("WebView: ").append(wv.packageName).append(' ').append(wv.versionName).append('\n');
        } catch (Exception ignored) { }
        b.append("Mesin PDF: AndroidX pdf-viewer-fragment 1.0.0-beta01\n");
        b.append("Memori: ").append(memory(ctx)).append('\n');
        b.append("Dibuat: ").append(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(new Date())).append("\n\n");
        return b.toString();
    }

    public static String memory(Context ctx) {
        Runtime rt = Runtime.getRuntime();
        String s = "heap " + ((rt.totalMemory() - rt.freeMemory()) >> 20) + "/" + (rt.maxMemory() >> 20) + " MiB";
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            s += " · RAM bebas " + (mi.availMem >> 20) + "/" + (mi.totalMem >> 20) + " MiB" + (mi.lowMemory ? " (RENDAH)" : "");
        } catch (Exception ignored) { }
        return s;
    }

    /** Header + seluruh isi log (lama dulu, lalu terbaru). */
    public static String read(Context ctx) {
        init(ctx);
        StringBuilder b = new StringBuilder(header(ctx));
        synchronized (LOCK) {
            File dir = new File(ctx.getFilesDir(), "diag");
            for (String n : new String[]{"log.1.txt", "log.txt"}) {
                File f = new File(dir, n);
                if (!f.exists()) continue;
                try (InputStream in = new FileInputStream(f)) {
                    byte[] buf = new byte[(int) Math.min(f.length(), 2L * MAX_BYTES)];
                    int off = 0, r;
                    while (off < buf.length && (r = in.read(buf, off, buf.length - off)) > 0) off += r;
                    b.append(new String(buf, 0, off, StandardCharsets.UTF_8));
                } catch (Exception ignored) { }
            }
        }
        return b.toString();
    }

    /** Tulis log ke cache berbagi (tg-office-share/) untuk dikirim lewat FileProvider. */
    public static File export(Context ctx) throws Exception {
        File dir = new File(ctx.getCacheDir(), "tg-office-share");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
        File out = new File(dir, "tg-office-log.txt");
        try (FileOutputStream os = new FileOutputStream(out)) {
            os.write(read(ctx).getBytes(StandardCharsets.UTF_8));
        }
        return out;
    }
}
