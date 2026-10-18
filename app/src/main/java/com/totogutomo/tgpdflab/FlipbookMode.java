package com.totogutomo.tgpdflab;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.pdf.PdfRenderer;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.net.Uri;
import android.util.Log;
import android.util.LruCache;

import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Flipbook opsional. AndroidX tetap pembaca default. Halaman dirender sesuai
 * kebutuhan dengan PdfRenderer platform (tanpa menyalin PDF bila memungkinkan)
 * dan ditampilkan oleh {@link PageCurlView}.
 */
final class FlipbookMode implements PageCurlView.Provider {
    private static final String TAG = "TG_PDF_LAB";
    private static final double MAX_PIXELS = 2_400_000d;

    private final MainActivity activity;
    private final PageCurlView view;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final LruCache<Integer, Bitmap> cache;
    private final Set<Integer> pending = new HashSet<>();
    private final Random random = new Random();
    private final SoundPool sounds;
    private final int flipSound;
    private volatile boolean soundReady;
    private volatile boolean closed;
    private volatile int windowLo = 0, windowHi = Integer.MAX_VALUE;
    private volatile int slotWidth = 1, slotHeight = 1;
    private volatile PdfSource source;
    private int count;
    private boolean soundOn = true;

    FlipbookMode(MainActivity activity, PageCurlView view) {
        this.activity = activity;
        this.view = view;
        // Zoom cubit: render ulang halaman terlihat dengan resolusi lebih tinggi agar tetap tajam.
        view.setZoomListener(() -> view.post(this::prefetch));
        int maxKb = (int) Math.min(72L * 1024L, Runtime.getRuntime().maxMemory() / 1024L / 6L);
        cache = new LruCache<Integer, Bitmap>(Math.max(8 * 1024, maxKb)) {
            @Override protected int sizeOf(Integer key, Bitmap value) {
                return Math.max(1, value.getByteCount() / 1024);
            }
        };
        sounds = new SoundPool.Builder()
            .setMaxStreams(3)
            .setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build())
            .build();
        sounds.setOnLoadCompleteListener((pool, id, status) -> soundReady = status == 0);
        flipSound = sounds.load(activity, R.raw.page_flip, 1);
    }

    void setSoundEnabled(boolean enabled) { soundOn = enabled; }

    void open(Uri uri, int startingPage, boolean twoPage) {
        view.reset();
        io.execute(() -> {
            try {
                PdfSource opened = PdfSource.open(activity, uri, "flipbook", () -> closed);
                if (closed) { opened.close(); return; }
                source = opened;
                count = opened.renderer.getPageCount();
                float aspect = 1.4142f;
                if (count > 0) {
                    try (PdfRenderer.Page first = opened.renderer.openPage(0)) {
                        aspect = (float) first.getHeight() / Math.max(1, first.getWidth());
                    }
                }
                final float pageAspect = aspect;
                Log.i(TAG, "FLIPBOOK_OPEN pages=" + count + " direct=" + opened.direct);
                activity.runOnUiThread(() -> {
                    if (closed) return;
                    view.setup(this, count, pageAspect, twoPage,
                        Math.max(0, Math.min(startingPage, count - 1)));
                    prefetch();
                });
            } catch (Exception e) {
                Log.e(TAG, "FLIPBOOK_OPEN_FAILED", e);
                activity.runOnUiThread(() -> {
                    if (!closed) activity.showStatus(
                        "Flipbook gagal memuat PDF: " + e.getClass().getSimpleName(), 4000);
                });
            }
        });
    }

    void setTwoPage(boolean twoPage, int keepPage) {
        view.setBook(twoPage, keepPage);
        view.post(this::prefetch);
    }

    void onResized() { view.post(this::prefetch); }

    @Override
    public Bitmap page(int index) { return cache.get(index); }

    /**
     * Render halaman spread sekarang dan tetangganya; halaman lain dilewati.
     * Saat zoom: hanya halaman yang terlihat yang dirender lebih tajam (maks 2,5x) dan ukurannya
     * dijaga di bawah seperempat cache, agar gambar tidak saling mengusir (penyebab "Memuat" tanpa akhir).
     */
    void prefetch() {
        if (closed || source == null) return;
        int[] slot = view.pageSlotSize();
        slotWidth = slot[0];
        slotHeight = slot[1];
        float z = Math.min(view.zoomFactor(), 2.5f);
        List<Integer> wanted = view.wantedPages();
        if (wanted.isEmpty()) return;
        List<Integer> visible = view.visiblePages();
        int lo = Integer.MAX_VALUE, hi = Integer.MIN_VALUE;
        for (int p : wanted) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
        windowLo = lo;
        windowHi = hi;
        double budget = Math.max(MAX_PIXELS, cache.maxSize() * 1024d / 4d / 4d);
        for (int p : wanted) {
            boolean sharp = z > 1.01f && visible.contains(p);
            final int tw = sharp ? Math.round(slotWidth * z) : slotWidth;
            final int th = sharp ? Math.round(slotHeight * z) : slotHeight;
            final double maxPx = sharp ? Math.min(6_000_000d, budget) : MAX_PIXELS;
            Bitmap have = cache.get(p);
            double cap = Math.sqrt(maxPx / Math.max(1d, (double) tw * th));
            float need = (float) Math.min(1d, cap) * 0.8f;
            boolean sharpEnough = have != null
                && (have.getWidth() >= tw * need || have.getHeight() >= th * need);
            if (sharpEnough || pending.contains(p)) continue;
            pending.add(p);
            io.execute(() -> render(p, tw, th, maxPx));
        }
    }

    private void render(int index, int slotW, int slotH, double maxPx) {
        if (closed || source == null) { done(index, null); return; }
        if (index < windowLo - 1 || index > windowHi + 1) { done(index, null); return; }
        Bitmap bitmap = null;
        try (PdfRenderer.Page pdf = source.renderer.openPage(index)) {
            float scale = Math.min((float) slotW / pdf.getWidth(),
                (float) slotH / pdf.getHeight());
            int width = Math.max(1, Math.round(pdf.getWidth() * scale));
            int height = Math.max(1, Math.round(pdf.getHeight() * scale));
            double bound = Math.min(1d, Math.sqrt(maxPx / ((double) width * height)));
            width = Math.max(1, (int) (width * bound));
            height = Math.max(1, (int) (height * bound));
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            Matrix m = new Matrix();
            m.setScale((float) width / pdf.getWidth(), (float) height / pdf.getHeight());
            pdf.render(bitmap, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
        } catch (Exception | OutOfMemoryError e) {
            Log.e(TAG, "FLIPBOOK_PAGE_FAILED " + index, e);
            bitmap = null;
        }
        done(index, bitmap);
    }

    private void done(int index, Bitmap bitmap) {
        activity.runOnUiThread(() -> {
            pending.remove(index);
            if (closed) return;
            if (bitmap != null) {
                cache.put(index, bitmap);
                view.invalidate();
            }
        });
    }

    void playFlipSound() {
        if (!soundOn || closed || !soundReady) return;
        float rate = 0.93f + random.nextFloat() * 0.14f;   // variasi kecil agar tidak monoton
        float volume = 0.8f + random.nextFloat() * 0.2f;
        sounds.play(flipSound, volume, volume, 1, 0, rate);
    }

    void close() {
        closed = true;
        view.reset();
        io.execute(() -> {
            if (source != null) source.close();
            source = null;
        });
        io.shutdown();
        sounds.release();
        cache.evictAll();
    }
}
