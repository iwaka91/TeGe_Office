package com.totogutomo.tgpdflab;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.util.AttributeSet;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.os.SystemClock;
import android.view.VelocityTracker;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.animation.DecelerateInterpolator;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import java.util.ArrayList;
import java.util.List;

/**
 * Tampilan Flipbook dengan efek lipatan halaman (page curl) yang digambar di Canvas.
 *
 * Model: satu "spread" = yang terlihat sekaligus. Mode tunggal: 1 halaman per spread.
 * Mode buku: halaman 1 (sampul) sendiri di kanan, lalu 2–3, 4–5, dst.
 * Animasi selalu dimodelkan sebagai halaman kanan spread {@code from} yang dibalik
 * ke kiri dengan progres 0→1. Membalik mundur = animasi yang sama dari 1→0
 * pada spread sebelumnya, sehingga hanya ada satu geometri.
 *
 * Geometri lipatan: sudut halaman C ditarik ke titik P. Garis lipat adalah garis
 * sumbu (tegak lurus, lewat titik tengah) dari ruas C–P. Bagian halaman di sisi C
 * terangkat; bayangannya dicerminkan terhadap garis lipat menjadi "flap" yang
 * memperlihatkan sisi belakang kertas.
 */
public final class PageCurlView extends View {

    interface Listener {
        void onSpreadChanged(int firstPage);
        void onFlipStarted();
    }

    interface Provider {
        @Nullable Bitmap page(int index);
    }

    private static final float HINT = 0.045f;   // lipatan kecil di sudut kanan atas saat diam
    private static final long FULL_FLIP_MS = 720;

    private Listener listener;
    private Provider provider;
    private int count;
    private float aspect = 1.4142f;             // tinggi / lebar halaman
    private boolean book;
    private int spread;

    // state animasi
    private int fromSpread = -1;
    private float progress;
    private boolean topCorner = true;
    private ValueAnimator animator;

    // state sentuhan
    private float downX, downY;
    private boolean dragging, dragForward, touchActive;
    private VelocityTracker velocity;
    private final int touchSlop;
    private final float density;

    // geometri
    private final RectF leftRect = new RectF();
    private final RectF rightRect = new RectF();
    private final RectF scratch = new RectF();
    private final float[] corners = new float[8];
    private final float[] removedPts = new float[16];
    private final float[] remainingPts = new float[16];
    private final Path removedPath = new Path();
    private final Path remainingPath = new Path();
    private final Path flapPath = new Path();
    private final Matrix reflect = new Matrix();
    private final float[] reflectValues = new float[9];

    private final Paint bitmapPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint ghostPaint = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.ANTI_ALIAS_FLAG);
    private final Paint paperPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint backPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint bookShadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint flapShadowPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint gradientPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);

    private int background = Color.parseColor("#E6ECF4");

    // zoom cubit
    private static final float MAX_ZOOM = 4f;
    private float zoom = 1f, panX = 0f, panY = 0f, lastX, lastY;
    private boolean scaling, panning, multiTouch;
    private float overscrollX;
    private long lastTapAt;
    private float lastTapX, lastTapY;
    private Runnable pendingClick, zoomListener;
    private ScaleGestureDetector scaler;

    public PageCurlView(Context context) { this(context, null); }

    public PageCurlView(Context context, @Nullable AttributeSet attrs) {
        super(context, attrs);
        density = context.getResources().getDisplayMetrics().density;
        touchSlop = ViewConfiguration.get(context).getScaledTouchSlop();
        paperPaint.setColor(Color.WHITE);
        backPaint.setColor(Color.parseColor("#F6F3EC"));
        ghostPaint.setAlpha(46);
        bookShadowPaint.setColor(Color.WHITE);
        bookShadowPaint.setShadowLayer(10 * density, 0, 3 * density, 0x40000000);
        flapShadowPaint.setColor(Color.parseColor("#F6F3EC"));
        flapShadowPaint.setShadowLayer(12 * density, 0, 0, 0x55000000);
        textPaint.setTextAlign(Paint.Align.CENTER);
        textPaint.setTextSize(14 * density);
        textPaint.setColor(0xFF7A8798);
        setClickable(true);
        scaler = new ScaleGestureDetector(context, new ScaleGestureDetector.SimpleOnScaleGestureListener() {
            @Override public boolean onScaleBegin(@NonNull ScaleGestureDetector d) {
                if (busy()) { cancelAnimation(); }
                scaling = true;
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                return true;
            }
            @Override public boolean onScale(@NonNull ScaleGestureDetector d) {
                zoomBy(d.getScaleFactor(), d.getFocusX(), d.getFocusY());
                return true;
            }
            @Override public void onScaleEnd(@NonNull ScaleGestureDetector d) {
                scaling = false;
                if (zoom < 1.05f) resetZoom(); else notifyZoom();
            }
        });
        scaler.setQuickScaleEnabled(false);
    }

    // ------------------------------------------------------------------ zoom

    void setZoomListener(Runnable r) { zoomListener = r; }
    float zoomFactor() { return zoom; }
    boolean isZoomed() { return zoom > 1.01f; }

    private void zoomBy(float factor, float fx, float fy) {
        float next = clamp(zoom * factor, 1f, MAX_ZOOM);
        float cx = (fx - panX) / zoom, cy = (fy - panY) / zoom;
        panX = fx - cx * next;
        panY = fy - cy * next;
        zoom = next;
        clampPan();
        invalidate();
    }

    private void clampPan() {
        float w = getWidth(), h = getHeight();
        panX = clamp(panX, w - w * zoom, 0f);
        panY = clamp(panY, h - h * zoom, 0f);
    }

    void resetZoom() {
        boolean was = isZoomed();
        zoom = 1f; panX = 0f; panY = 0f;
        invalidate();
        if (was) notifyZoom();
    }

    private void quietResetZoom() { zoom = 1f; panX = 0f; panY = 0f; }

    private void notifyZoom() { if (zoomListener != null) zoomListener.run(); }

    @Override protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        quietResetZoom();
    }

    /** Ketuk: tepi membalik halaman, tengah menampilkan menu; ketuk dua kali di tengah = zoom. */
    private void handleTap(float x, float y) {
        long now = SystemClock.uptimeMillis();
        boolean dbl = now - lastTapAt < 300 && Math.hypot(x - lastTapX, y - lastTapY) < 48 * density;
        lastTapAt = now; lastTapX = x; lastTapY = y;
        if (dbl) {
            if (pendingClick != null) { removeCallbacks(pendingClick); pendingClick = null; }
            lastTapAt = 0;
            if (isZoomed()) resetZoom(); else { zoomBy(2.5f, x, y); notifyZoom(); }
            return;
        }
        if (isZoomed()) {
            if (x > getWidth() * 0.85f) { resetZoom(); next(); }
            else if (x < getWidth() * 0.15f) { resetZoom(); prev(); }
            return;
        }
        if (x > getWidth() * 0.62f) next();
        else if (x < getWidth() * 0.38f) prev();
        else {
            pendingClick = () -> { pendingClick = null; performClick(); };
            postDelayed(pendingClick, 280);
        }
    }

    private boolean zoomedTouch(MotionEvent e) {
        float x = e.getX(), y = e.getY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                lastX = downX = x; lastY = downY = y; panning = false; overscrollX = 0f;
                if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                return true;
            case MotionEvent.ACTION_MOVE:
                if (!panning && Math.hypot(x - downX, y - downY) > touchSlop) panning = true;
                if (panning) {
                    float before = panX, dx = x - lastX;
                    panX += dx; panY += y - lastY; clampPan(); invalidate();
                    overscrollX += dx - (panX - before); // dorongan yang mentok di tepi halaman
                }
                lastX = x; lastY = y;
                return true;
            case MotionEvent.ACTION_UP: {
                // Sudah mentok di tepi lalu tetap digesek: pindah halaman (seperti galeri foto).
                float flip = 70 * density;
                if (panning && overscrollX < -flip && canNext()) { resetZoom(); next(); }
                else if (panning && overscrollX > flip && canPrev()) { resetZoom(); prev(); }
                else if (!panning) handleTap(x, y);
                panning = false; overscrollX = 0f;
                return true;
            }
            default:
                panning = false;
                return true;
        }
    }

    // ------------------------------------------------------------------ API

    void setListener(Listener l) { listener = l; }

    void setColors(int backgroundColor, boolean dark) {
        background = backgroundColor;
        textPaint.setColor(dark ? 0xFFA9B8CB : 0xFF56677E);
        invalidate();
    }

    void setup(@NonNull Provider p, int pageCount, float pageAspect, boolean bookMode, int startPage) {
        cancelAnimation();
        provider = p;
        count = pageCount;
        if (pageAspect > 0.2f && pageAspect < 5f) aspect = pageAspect;
        book = bookMode;
        quietResetZoom();
        spread = clampSpread(spreadOf(startPage));
        fromSpread = -1;
        progress = 0f;
        notifyChanged();
        invalidate();
    }

    void reset() {
        cancelAnimation();
        provider = null;
        count = 0;
        spread = 0;
        fromSpread = -1;
        progress = 0f;
        invalidate();
    }

    void setBook(boolean bookMode, int keepPage) {
        cancelAnimation();
        quietResetZoom();
        book = bookMode;
        spread = clampSpread(spreadOf(keepPage));
        notifyChanged();
        requestLayout();
        invalidate();
    }

    boolean isBook() { return book; }

    boolean canNext() { return count > 0 && spread + 1 < spreadCount(); }

    boolean canPrev() { return count > 0 && spread > 0; }

    void next() {
        if (busy() || !canNext()) return;
        quietResetZoom();
        final int from = spread;
        fromSpread = from;
        topCorner = true;
        progress = HINT; // lanjut dari lipatan sudut yang sudah terlihat
        if (listener != null) listener.onFlipStarted();
        animateTo(1f, () -> spread = from + 1);
    }

    void prev() {
        if (busy() || !canPrev()) return;
        quietResetZoom();
        final int from = spread - 1;
        fromSpread = from;
        topCorner = true;
        progress = 1f;
        if (listener != null) listener.onFlipStarted();
        animateTo(0f, () -> spread = from);
    }

    void goToPage(int page, boolean animate) {
        if (count <= 0) return;
        int target = clampSpread(spreadOf(Math.max(0, Math.min(count - 1, page))));
        if (target == spread) return;
        quietResetZoom();
        if (animate && !busy() && target == spread + 1) { next(); return; }
        if (animate && !busy() && target == spread - 1) { prev(); return; }
        cancelAnimation();
        spread = target;
        notifyChanged();
        invalidate();
    }

    /** Label halaman terlihat, 1-based (mis. "2–3"). */
    String spreadLabel() {
        if (count <= 0) return "—";
        int l = leftPage(spread), r = rightPage(spread);
        if (l >= 0 && r >= 0) return (l + 1) + "–" + (r + 1);
        return Integer.toString(Math.max(l, r) + 1);
    }

    int lastVisiblePage() {
        return Math.max(leftPage(spread), rightPage(spread));
    }

    /** Halaman yang perlu dirender, urut prioritas: spread kini, berikut, sebelum, berikutnya lagi. */
    /** Halaman yang sedang tampil (untuk render tajam saat zoom). */
    List<Integer> visiblePages() {
        List<Integer> out = new ArrayList<>();
        if (count <= 0) return out;
        int l = leftPage(spread), r = rightPage(spread);
        if (l >= 0) out.add(l);
        if (r >= 0) out.add(r);
        return out;
    }

    List<Integer> wantedPages() {
        List<Integer> out = new ArrayList<>();
        int[] order = {spread, spread + 1, spread - 1, spread + 2};
        for (int s : order) {
            if (s < 0 || s >= spreadCount()) continue;
            int l = leftPage(s), r = rightPage(s);
            if (r >= 0 && !out.contains(r)) out.add(r);
            if (l >= 0 && !out.contains(l)) out.add(l);
        }
        return out;
    }

    /** Ukuran satu slot halaman dalam piksel (untuk resolusi render). */
    int[] pageSlotSize() {
        int w = getWidth(), h = getHeight();
        if (w <= 0 || h <= 0) {
            w = getResources().getDisplayMetrics().widthPixels;
            h = getResources().getDisplayMetrics().heightPixels;
        }
        computeRects(w, h);
        return new int[]{Math.max(1, Math.round(rightRect.width())),
            Math.max(1, Math.round(rightRect.height()))};
    }

    // ------------------------------------------------------------------ spread math

    private int spreadCount() {
        if (count <= 0) return 0;
        return book ? 1 + count / 2 : count;
    }

    private int clampSpread(int s) { return Math.max(0, Math.min(spreadCount() - 1, s)); }

    private int spreadOf(int page) {
        if (!book) return page;
        return page <= 0 ? 0 : (page + 1) / 2;
    }

    private int leftPage(int s) {
        if (!book || s <= 0 || s >= spreadCount()) return -1;
        return 2 * s - 1;
    }

    private int rightPage(int s) {
        if (s < 0 || s >= spreadCount()) return -1;
        if (!book) return s;
        if (s == 0) return 0;
        return 2 * s < count ? 2 * s : -1;
    }

    private int firstPage(int s) { return book ? (s <= 0 ? 0 : 2 * s - 1) : s; }

    private void notifyChanged() {
        if (listener != null && count > 0) listener.onSpreadChanged(firstPage(spread));
    }

    private boolean busy() { return dragging || (animator != null && animator.isRunning()); }

    // ------------------------------------------------------------------ animation

    private void animateTo(float target, Runnable commit) {
        if (animator != null) animator.cancel();
        float distance = Math.abs(target - progress);
        ValueAnimator a = ValueAnimator.ofFloat(progress, target);
        a.setDuration(Math.max(160L, (long) (FULL_FLIP_MS * distance)));
        a.setInterpolator(new DecelerateInterpolator(1.3f));
        a.addUpdateListener(v -> {
            progress = (float) v.getAnimatedValue();
            invalidate();
        });
        a.addListener(new AnimatorListenerAdapter() {
            private boolean cancelled;
            @Override public void onAnimationCancel(Animator animation) { cancelled = true; }
            @Override public void onAnimationEnd(Animator animation) {
                if (animator == animation) animator = null;
                if (cancelled) return;
                int before = spread;
                commit.run();
                fromSpread = -1;
                progress = 0f;
                if (spread != before) notifyChanged();
                invalidate();
            }
        });
        animator = a;
        a.start();
    }

    private void cancelAnimation() {
        if (animator != null) {
            ValueAnimator a = animator;
            animator = null;
            a.cancel();
        }
        dragging = false;
        fromSpread = -1;
        progress = 0f;
    }

    // ------------------------------------------------------------------ touch

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (count <= 0 || provider == null) return super.onTouchEvent(e);
        scaler.onTouchEvent(e);
        int act = e.getActionMasked();
        if (act == MotionEvent.ACTION_DOWN) multiTouch = false;
        if (scaling || e.getPointerCount() > 1) {
            multiTouch = true;
            if (dragging) { dragging = false; cancelAnimation(); invalidate(); }
            touchActive = false; panning = false;
            return true;
        }
        if (multiTouch) {
            if (act == MotionEvent.ACTION_UP || act == MotionEvent.ACTION_CANCEL) multiTouch = false;
            if (isZoomed() && act == MotionEvent.ACTION_MOVE) { lastX = e.getX(); lastY = e.getY(); }
            return true;
        }
        if (isZoomed()) return zoomedTouch(e);
        float x = e.getX(), y = e.getY();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                if (animator != null && animator.isRunning()) animator.end();
                downX = x;
                downY = y;
                dragging = false;
                touchActive = true;
                if (velocity != null) velocity.recycle();
                velocity = VelocityTracker.obtain();
                velocity.addMovement(e);
                return true;
            case MotionEvent.ACTION_MOVE: {
                if (!touchActive) return true;
                if (velocity != null) velocity.addMovement(e);
                float dx = x - downX, dy = y - downY;
                if (!dragging) {
                    if (Math.abs(dx) <= touchSlop || Math.abs(dx) < Math.abs(dy)) return true;
                    if (dx < 0 && canNext()) {
                        dragForward = true;
                        fromSpread = spread;
                    } else if (dx > 0 && canPrev()) {
                        dragForward = false;
                        fromSpread = spread - 1;
                    } else {
                        return true;
                    }
                    dragging = true;
                    // Mulai dari bagian bawah halaman = tarik sudut bawah; selain itu sudut kanan atas.
                    topCorner = downY < rightRect.top + rightRect.height() * 0.7f;
                    if (getParent() != null) getParent().requestDisallowInterceptTouchEvent(true);
                    if (listener != null) listener.onFlipStarted();
                }
                float span = Math.max(1f, rightRect.width() * 1.1f);
                if (dragForward) progress = clamp(-dx / span, 0.02f, 1f);
                else progress = 1f - clamp(dx / span, 0f, 0.98f);
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_UP: {
                touchActive = false;
                float vx = 0f;
                if (velocity != null) {
                    velocity.addMovement(e);
                    velocity.computeCurrentVelocity(1000);
                    vx = velocity.getXVelocity();
                    velocity.recycle();
                    velocity = null;
                }
                if (dragging) {
                    dragging = false;
                    finishDrag(vx);
                } else if (Math.abs(x - downX) < touchSlop && Math.abs(y - downY) < touchSlop) {
                    handleTap(x, y);
                }
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                touchActive = false;
                if (velocity != null) { velocity.recycle(); velocity = null; }
                if (dragging) {
                    dragging = false;
                    finishDrag(0f);
                }
                return true;
            default:
                return true;
        }
    }

    private void finishDrag(float vx) {
        final int from = fromSpread;
        float fling = 900 * density;
        if (dragForward) {
            boolean commit = (progress > 0.28f || vx < -fling) && vx < fling;
            animateTo(commit ? 1f : 0f, () -> spread = commit ? from + 1 : from);
        } else {
            boolean commit = (progress < 0.72f || vx > fling) && vx > -fling;
            animateTo(commit ? 0f : 1f, () -> spread = commit ? from : from + 1);
        }
    }

    @Override
    public boolean performClick() { return super.performClick(); }

    private static float clamp(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }

    // ------------------------------------------------------------------ drawing

    private void computeRects(int width, int height) {
        float pad = 14 * density;
        float aw = Math.max(1f, width - 2 * pad);
        float ah = Math.max(1f, height - 2 * pad - 56 * density); // sisakan ruang navigasi bawah
        float cx = width / 2f;
        float top;
        if (book) {
            float pw = Math.min(aw / 2f, ah / aspect);
            float ph = pw * aspect;
            top = pad + (ah - ph) / 2f;
            leftRect.set(cx - pw, top, cx, top + ph);
            rightRect.set(cx, top, cx + pw, top + ph);
        } else {
            float pw = Math.min(aw, ah / aspect);
            float ph = pw * aspect;
            top = pad + (ah - ph) / 2f;
            rightRect.set(cx - pw / 2f, top, cx + pw / 2f, top + ph);
            leftRect.setEmpty();
        }
    }

    @Override
    protected void onDraw(@NonNull Canvas c) {
        if (!isZoomed()) { drawContent(c); return; }
        c.drawColor(background);
        c.save();
        c.translate(panX, panY);
        c.scale(zoom, zoom);
        drawContent(c);
        c.restore();
    }

    private void drawContent(@NonNull Canvas c) {
        c.drawColor(background);
        if (provider == null || count <= 0) {
            c.drawText("Menyiapkan Flipbook…", getWidth() / 2f, getHeight() / 2f, textPaint);
            return;
        }
        computeRects(getWidth(), getHeight());

        final int s;
        final float p;
        if (fromSpread >= 0) {
            s = fromSpread;
            p = progress;
        } else {
            s = spread;
            p = canNext() ? HINT : 0f;
        }
        int fromL = leftPage(s), fromR = rightPage(s);
        boolean hasTo = s + 1 < spreadCount();
        int toL = hasTo ? leftPage(s + 1) : -1;
        int toR = hasTo ? rightPage(s + 1) : -1;

        // Bayangan buku dan halaman kiri statis.
        if (book) {
            if (fromL >= 0) c.drawRect(leftRect, bookShadowPaint);
            if (fromR >= 0 || toR >= 0) c.drawRect(rightRect, bookShadowPaint);
            if (fromL >= 0) drawPage(c, fromL, leftRect, false, null);
        } else {
            c.drawRect(rightRect, bookShadowPaint);
        }

        if (p <= 0f || !hasTo) {
            if (fromR >= 0) drawPage(c, fromR, rightRect, false, null);
            if (book) drawSpine(c, fromL >= 0, fromR >= 0);
            return;
        }

        // Halaman di bawah (yang akan terlihat).
        if (toR >= 0) drawPage(c, toR, rightRect, false, null);
        else c.drawRect(rightRect, paperPaint);

        // Titik sudut C dan titik tarik P.
        float W = rightRect.width(), H = rightRect.height();
        float cx = rightRect.right;
        float cy = topCorner ? rightRect.top : rightRect.bottom;
        float px = cx - 2f * W * p;
        float py = cy + (topCorner ? 1f : -1f) * H * 0.32f * (float) Math.sin(Math.PI * p);
        float vx = cx - px, vy = cy - py;
        float len = (float) Math.hypot(vx, vy);
        if (len < 0.5f) {
            if (fromR >= 0) drawPage(c, fromR, rightRect, false, null);
            return;
        }
        float ux = vx / len, uy = vy / len;
        float mx = (cx + px) / 2f, my = (cy + py) / 2f;

        corners[0] = rightRect.left;  corners[1] = rightRect.top;
        corners[2] = rightRect.right; corners[3] = rightRect.top;
        corners[4] = rightRect.right; corners[5] = rightRect.bottom;
        corners[6] = rightRect.left;  corners[7] = rightRect.bottom;
        int nRemoved = clip(corners, mx, my, ux, uy, true, removedPts);
        int nRemaining = clip(corners, mx, my, ux, uy, false, remainingPts);
        toPath(removedPts, nRemoved, removedPath);
        toPath(remainingPts, nRemaining, remainingPath);

        // Bagian halaman sekarang yang masih rata.
        if (fromR >= 0 && nRemaining >= 3) {
            c.save();
            c.clipPath(remainingPath);
            drawPage(c, fromR, rightRect, false, null);
            c.restore();
        }
        if (book) drawSpine(c, fromL >= 0, true);

        if (nRemoved < 3) return;

        // Bayangan lembut pada halaman yang baru terbuka, menempel di garis lipat.
        float reach = len / 2f;
        c.save();
        c.clipPath(removedPath);
        gradientPaint.setShader(new LinearGradient(mx, my,
            mx + ux * Math.min(W * 0.35f, reach + 1f), my + uy * Math.min(W * 0.35f, reach + 1f),
            0x66000000, 0x00000000, Shader.TileMode.CLAMP));
        c.drawPaint(gradientPaint);
        c.restore();

        // Cermin terhadap garis lipat.
        float dot = mx * ux + my * uy;
        reflectValues[0] = 1 - 2 * ux * ux; reflectValues[1] = -2 * ux * uy; reflectValues[2] = 2 * dot * ux;
        reflectValues[3] = -2 * ux * uy;    reflectValues[4] = 1 - 2 * uy * uy; reflectValues[5] = 2 * dot * uy;
        reflectValues[6] = 0; reflectValues[7] = 0; reflectValues[8] = 1;
        reflect.setValues(reflectValues);
        flapPath.set(removedPath);
        flapPath.transform(reflect);

        // Bayangan jatuh dari flap ke halaman di bawahnya.
        c.drawPath(flapPath, flapShadowPaint);

        // Isi flap = sisi belakang kertas.
        c.save();
        c.concat(reflect);
        c.clipPath(removedPath);
        if (book && toL >= 0) {
            // Sisi belakang halaman kanan = halaman kiri berikutnya (dibalik cermin).
            drawPage(c, toL, rightRect, true, null);
        } else {
            c.drawRect(rightRect, backPaint);
            if (fromR >= 0) drawPage(c, fromR, rightRect, true, ghostPaint); // tembus pandang tipis
        }
        // Gradasi lengkung kertas.
        gradientPaint.setShader(new LinearGradient(mx, my, mx + ux * reach, my + uy * reach,
            new int[]{0x40000000, 0x08000000, 0x00000000, 0x18000000},
            new float[]{0f, 0.25f, 0.7f, 1f}, Shader.TileMode.CLAMP));
        c.drawPaint(gradientPaint);
        c.restore();
        gradientPaint.setShader(null);
    }

    private void drawSpine(Canvas c, boolean left, boolean right) {
        if (!left && !right) return;
        float spine = rightRect.left;
        float w = rightRect.width() * 0.07f;
        float l = left ? spine - w : spine;
        float r = right ? spine + w : spine;
        gradientPaint.setShader(new LinearGradient(spine - w, 0, spine + w, 0,
            new int[]{0x00000000, 0x2E000000, 0x00000000}, new float[]{0f, 0.5f, 1f},
            Shader.TileMode.CLAMP));
        c.drawRect(l, rightRect.top, r, rightRect.bottom, gradientPaint);
        gradientPaint.setShader(null);
    }

    /** Gambar halaman fit-center di dalam rect; mirrored = dibalik horizontal di dalam rect. */
    private void drawPage(Canvas c, int index, RectF rect, boolean mirrored, @Nullable Paint paint) {
        if (paint == null) c.drawRect(rect, paperPaint);
        Bitmap bitmap = provider == null ? null : provider.page(index);
        if (mirrored) {
            c.save();
            c.scale(-1f, 1f, rect.centerX(), rect.centerY());
        }
        if (bitmap != null && !bitmap.isRecycled()) {
            float bw = bitmap.getWidth(), bh = bitmap.getHeight();
            float scale = Math.min(rect.width() / bw, rect.height() / bh);
            float dw = bw * scale, dh = bh * scale;
            scratch.set(rect.centerX() - dw / 2f, rect.centerY() - dh / 2f,
                rect.centerX() + dw / 2f, rect.centerY() + dh / 2f);
            c.drawBitmap(bitmap, null, scratch, paint == null ? bitmapPaint : paint);
        } else if (paint == null) {
            c.drawText("Memuat halaman " + (index + 1) + "…", rect.centerX(), rect.centerY(), textPaint);
        }
        if (mirrored) c.restore();
    }

    /** Sutherland–Hodgman untuk satu bidang: f(X) = (X − M)·u. */
    private static int clip(float[] in, float mx, float my, float ux, float uy,
            boolean keepPositive, float[] out) {
        int n = in.length / 2;
        int k = 0;
        for (int i = 0; i < n; i++) {
            float ax = in[2 * i], ay = in[2 * i + 1];
            int j = (i + 1) % n;
            float bx = in[2 * j], by = in[2 * j + 1];
            float fa = (ax - mx) * ux + (ay - my) * uy;
            float fb = (bx - mx) * ux + (by - my) * uy;
            if (!keepPositive) { fa = -fa; fb = -fb; }
            boolean ina = fa > 0, inb = fb > 0;
            if (ina) { out[2 * k] = ax; out[2 * k + 1] = ay; k++; }
            if (ina != inb) {
                float t = fa / (fa - fb);
                out[2 * k] = ax + (bx - ax) * t;
                out[2 * k + 1] = ay + (by - ay) * t;
                k++;
            }
        }
        return k;
    }

    private static void toPath(float[] pts, int n, Path path) {
        path.reset();
        if (n < 3) return;
        path.moveTo(pts[0], pts[1]);
        for (int i = 1; i < n; i++) path.lineTo(pts[2 * i], pts[2 * i + 1]);
        path.close();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        if (animator != null) animator.cancel();
    }
}
