package com.totogutomo.tgoffice;

import android.content.res.AssetManager;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * Presentasi Nirkabel: server HTTP kecil di jaringan lokal.
 * IFP membuka alamat HP di browser, memasukkan kode 4 angka, lalu menerima perintah lewat
 * Server-Sent Events (/api/events) dan mengirim balik lewat POST (/api/msg).
 * Hanya melayani aset aplikasi (folder web) dan file presentasi aktif; tidak ada akses ke internet.
 */
final class CastServer {
    interface Listener {
        void onMessage(String json);
        void onStatus(String status);
    }

    private final AssetManager assets;
    private final Listener listener;
    private final SecureRandom random = new SecureRandom();
    private final Object sseLock = new Object();
    private ServerSocket server;
    private Thread acceptThread, beatThread;
    private volatile boolean running;
    private volatile String code, token;
    private volatile File file;
    private volatile String fileName = "presentasi.pptx";
    private volatile long fileRev;
    private OutputStream sse;
    private Socket sseSocket;
    private int wrong;
    private long lockedUntil;
    int port;

    CastServer(AssetManager assets, Listener listener) {
        this.assets = assets;
        this.listener = listener;
    }

    synchronized boolean start() {
        if (running) return true;
        for (int p = 8080; p <= 8090; p++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p));
                server = s;
                port = p;
                break;
            } catch (IOException ignored) {}
        }
        if (server == null) return false;
        running = true;
        newCode();
        acceptThread = new Thread(this::acceptLoop, "tg-cast-accept");
        acceptThread.start();
        beatThread = new Thread(() -> {
            while (running) {
                try { Thread.sleep(15000); } catch (InterruptedException e) { return; }
                writeSse(": hb\n\n");
            }
        }, "tg-cast-beat");
        beatThread.start();
        return true;
    }

    synchronized void stop() {
        running = false;
        token = null;
        closeSse();
        try { if (server != null) server.close(); } catch (IOException ignored) {}
        server = null;
        if (beatThread != null) beatThread.interrupt();
        File f = file;
        file = null;
        if (f != null) f.delete();
    }

    boolean isRunning() { return running; }
    boolean isConnected() { synchronized (sseLock) { return sse != null; } }
    String code() { return code; }

    String newCode() {
        code = String.format(Locale.ROOT, "%04d", random.nextInt(10000));
        token = null;
        closeSse();
        wrong = 0;
        return code;
    }

    void setFile(File f, String name) {
        File old = file;
        file = f;
        fileName = name == null ? "presentasi.pptx" : name;
        fileRev = System.currentTimeMillis();
        if (old != null && !old.equals(f)) old.delete();
        try {
            JSONObject o = new JSONObject();
            o.put("t", "load"); o.put("name", fileName); o.put("rev", fileRev);
            send(o.toString());
        } catch (Exception ignored) {}
    }

    /** Kirim pesan ke IFP (bila tersambung). */
    boolean send(String json) {
        return writeSse("data: " + json.replace("\n", " ") + "\n\n");
    }

    private boolean writeSse(String text) {
        synchronized (sseLock) {
            if (sse == null) return false;
            try {
                sse.write(text.getBytes(StandardCharsets.UTF_8));
                sse.flush();
                return true;
            } catch (IOException e) {
                dropSse();
                return false;
            }
        }
    }

    private void closeSse() {
        synchronized (sseLock) {
            if (sse != null) dropSse();
        }
    }

    private void dropSse() {
        try { if (sseSocket != null) sseSocket.close(); } catch (IOException ignored) {}
        sse = null;
        sseSocket = null;
        listener.onStatus("disconnected");
    }

    /** Alamat IPv4 lokal: Wi-Fi dan hotspot lebih dulu. Format: "nama=alamat". */
    static List<String> addresses() {
        List<String> out = new ArrayList<>(), other = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName().toLowerCase(Locale.ROOT);
                if (n.startsWith("rmnet") || n.startsWith("ccmni") || n.startsWith("dummy") || n.startsWith("tun")) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || a.isLoopbackAddress() || a.isLinkLocalAddress()) continue;
                    String item = n + "=" + a.getHostAddress();
                    if (n.startsWith("wlan") || n.startsWith("ap") || n.startsWith("swlan") || n.startsWith("eth")) out.add(item);
                    else other.add(item);
                }
            }
        } catch (Exception ignored) {}
        out.addAll(other);
        return out;
    }

    private void acceptLoop() {
        while (running) {
            try {
                Socket s = server.accept();
                new Thread(() -> handle(s), "tg-cast-conn").start();
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket s) {
        boolean keep = false;
        try {
            s.setSoTimeout(20000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String head = readHead(in);
            if (head == null) return;
            String[] lines = head.split("\r\n");
            String[] req = lines[0].split(" ");
            if (req.length < 2) return;
            String method = req[0], target = req[1];
            int len = 0;
            for (String l : lines) {
                int i = l.indexOf(':');
                if (i > 0 && l.substring(0, i).trim().equalsIgnoreCase("content-length")) {
                    try { len = Integer.parseInt(l.substring(i + 1).trim()); } catch (Exception ignored) {}
                }
            }
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            String body = "";
            if (len > 0 && len < 512 * 1024) {
                byte[] b = new byte[len];
                int got = 0;
                while (got < len) { int n = in.read(b, got, len - got); if (n < 0) break; got += n; }
                body = new String(b, 0, got, StandardCharsets.UTF_8);
            }
            OutputStream out = s.getOutputStream();
            if ("OPTIONS".equals(method)) { reply(out, 204, "text/plain", new byte[0]); return; }
            if (path.startsWith("/api/")) { keep = api(method, path, param(query, "t"), body, s, out); return; }
            serveAsset(path, out);
        } catch (Exception ignored) {
        } finally {
            if (!keep) try { s.close(); } catch (IOException ignored) {}
        }
    }

    private boolean api(String method, String path, String t, String body, Socket s, OutputStream out) throws IOException {
        switch (path) {
            case "/api/pair": {
                JSONObject r = new JSONObject();
                try {
                    String given = new JSONObject(body.isEmpty() ? "{}" : body).optString("code");
                    long now = System.currentTimeMillis();
                    if (now < lockedUntil) { r.put("ok", false); r.put("reason", "locked"); }
                    else if (code != null && code.equals(given)) {
                        wrong = 0;
                        token = Long.toHexString(random.nextLong()) + Long.toHexString(random.nextLong());
                        r.put("ok", true); r.put("token", token);
                    } else {
                        if (++wrong >= 8) { lockedUntil = now + 30000; wrong = 0; }
                        r.put("ok", false); r.put("reason", "code");
                    }
                } catch (Exception e) { try { r.put("ok", false); } catch (Exception ignored) {} }
                reply(out, 200, "application/json", r.toString().getBytes(StandardCharsets.UTF_8));
                return false;
            }
            case "/api/events": {
                if (!authorized(t)) { reply(out, 403, "text/plain", "kode".getBytes(StandardCharsets.UTF_8)); return false; }
                synchronized (sseLock) {
                    if (sse != null) dropSse();
                    String h = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\n" +
                        "Cache-Control: no-store\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\nretry: 2000\n\n";
                    out.write(h.getBytes(StandardCharsets.UTF_8));
                    out.flush();
                    s.setSoTimeout(0);
                    sse = out;
                    sseSocket = s;
                }
                if (file != null) {
                    try {
                        JSONObject o = new JSONObject();
                        o.put("t", "load"); o.put("name", fileName); o.put("rev", fileRev);
                        send(o.toString());
                    } catch (Exception ignored) {}
                }
                listener.onStatus("connected");
                return true;
            }
            case "/api/file": {
                File f = file;
                if (!authorized(t) || f == null || !f.exists()) { reply(out, 404, "text/plain", "tidak ada".getBytes(StandardCharsets.UTF_8)); return false; }
                String h = "HTTP/1.1 200 OK\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n" +
                    "Content-Length: " + f.length() + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
                out.write(h.getBytes(StandardCharsets.UTF_8));
                try (InputStream fi = new FileInputStream(f)) {
                    byte[] b = new byte[65536]; int n;
                    while ((n = fi.read(b)) >= 0) out.write(b, 0, n);
                }
                out.flush();
                return false;
            }
            case "/api/msg": {
                if (!authorized(t)) { reply(out, 403, "text/plain", new byte[0]); return false; }
                if (!body.isEmpty()) listener.onMessage(body);
                reply(out, 204, "text/plain", new byte[0]);
                return false;
            }
            default:
                reply(out, 404, "text/plain", new byte[0]);
                return false;
        }
    }

    private boolean authorized(String t) { return t != null && token != null && token.equals(t); }

    private void serveAsset(String path, OutputStream out) throws IOException {
        if (path.equals("/") || path.isEmpty()) path = "/receiver.html";
        path = java.net.URLDecoder.decode(path, "UTF-8");
        if (path.contains("..") || path.contains("\\")) { reply(out, 400, "text/plain", new byte[0]); return; }
        byte[] data;
        try (InputStream a = assets.open("web" + path)) { data = readAll(a); }
        catch (IOException e) { reply(out, 404, "text/plain", "Tidak ditemukan".getBytes(StandardCharsets.UTF_8)); return; }
        reply(out, 200, mime(path), data);
    }

    private static String mime(String p) {
        String l = p.toLowerCase(Locale.ROOT);
        if (l.endsWith(".html")) return "text/html; charset=utf-8";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (l.endsWith(".css")) return "text/css; charset=utf-8";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".ttf")) return "font/ttf";
        if (l.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }

    private static void reply(OutputStream out, int status, String type, byte[] body) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 403 ? "Forbidden" : status == 400 ? "Bad Request" : "Not Found";
        String h = "HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length +
            "\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: content-type\r\nConnection: close\r\n\r\n";
        out.write(h.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0, c;
        while ((c = in.read()) >= 0) {
            b.write(c);
            if (b.size() > 16384) return null;
            state = (c == '\r' && (state == 0 || state == 2)) ? state + 1 : (c == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
            if (state == 4) return b.toString("UTF-8");
        }
        return null;
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[65536]; int n;
        while ((n = in.read(buf)) >= 0) b.write(buf, 0, n);
        return b.toByteArray();
    }

    private static String param(String query, String key) {
        for (String kv : query.split("&")) {
            int i = kv.indexOf('=');
            if (i > 0 && kv.substring(0, i).equals(key)) return kv.substring(i + 1);
        }
        return null;
    }
}
