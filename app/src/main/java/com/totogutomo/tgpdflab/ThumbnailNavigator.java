package com.totogutomo.tgpdflab;

import android.app.Dialog;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.util.LruCache;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ScaleGestureDetector;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.IntConsumer;

/**
 * Thumbnail layar penuh. PdfRenderer dipakai HANYA untuk pratinjau navigasi;
 * pembacaan halaman tetap oleh AndroidX. Thumbnail dibuat langsung dari file
 * descriptor (tanpa menyalin PDF); salinan cache hanya cadangan.
 */
final class ThumbnailNavigator {
    private static final int RENDER_WIDTH_MAX = 360;

    private final MainActivity activity;
    private final Uri uri;
    private final int pages;
    private final int currentPage;
    private final Bookmarks bookmarks;
    private final ReaderPalette pal;
    private final IntConsumer navigate;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final LruCache<Integer, Bitmap> cache;
    private final ArrayDeque<Integer> queue = new ArrayDeque<>();
    private final Set<Integer> queued = new HashSet<>();
    private final Set<Integer> bound = Collections.synchronizedSet(new HashSet<>());
    private boolean drainScheduled;
    private volatile boolean cancelled;
    private volatile PdfSource source;
    private float pageAspect = 1.4142f;
    private int renderWidth;

    private Dialog dialog;
    private FrameLayout root;
    private GridView grid;
    private TextView tabAll, tabMarks, columnsLabel, emptyText, statusText;
    private FrameLayout previewLayer;
    private ImageView previewImage;
    private TextView previewTitle;
    private ImageButton previewStar;
    private int previewPage = -1;
    private int columns;
    private boolean showMarks;
    private final List<Integer> data = new ArrayList<>();

    ThumbnailNavigator(MainActivity activity, Uri uri, int pages, int currentPage,
            Bookmarks bookmarks, ReaderPalette palette, IntConsumer navigate) {
        this.activity = activity;
        this.uri = uri;
        this.pages = pages;
        this.currentPage = currentPage;
        this.bookmarks = bookmarks;
        this.pal = palette;
        this.navigate = navigate;
        int maxKb = (int) Math.min(24L * 1024L, Runtime.getRuntime().maxMemory() / 1024L / 8L);
        cache = new LruCache<Integer, Bitmap>(Math.max(4 * 1024, maxKb)) {
            @Override protected int sizeOf(Integer key, Bitmap value) {
                return Math.max(1, value.getByteCount() / 1024);
            }
        };
        columns = activity.getSharedPreferences("lab_prefs", 0).getInt("thumb_cols", 3);
        columns = Math.max(2, Math.min(4, columns));
        renderWidth = Math.min(RENDER_WIDTH_MAX,
            activity.getResources().getDisplayMetrics().widthPixels / 2);
    }

    private int dp(float v) { return Math.round(activity.dp(v)); }

    // ------------------------------------------------------------------ UI

    void show() {
        dialog = new Dialog(activity, R.style.Theme_TgPdfLab_FullDialog);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        root = new FrameLayout(activity);
        root.setBackgroundColor(pal.background);

        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        root.addView(column, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Header
        LinearLayout header = new LinearLayout(activity);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setBackgroundColor(pal.surface);
        header.setPadding(dp(4), 0, dp(8), 0);
        header.setElevation(dp(3));
        ImageButton back = iconButton(R.drawable.ic_back, "Tutup thumbnail", pal.ink);
        back.setOnClickListener(v -> dialog.dismiss());
        header.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        LinearLayout titles = new LinearLayout(activity);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView title = text("Thumbnail", 17, pal.ink, true);
        statusText = text(pages + " halaman • sedang di hal " + (currentPage + 1), 12, pal.inkMuted, false);
        titles.addView(title);
        titles.addView(statusText);
        LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0,
            ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        tlp.setMarginStart(dp(4));
        header.addView(titles, tlp);
        columnsLabel = text("", 13, pal.accent, true);
        columnsLabel.setPadding(dp(12), dp(8), dp(12), dp(8));
        columnsLabel.setBackground(pill(Color.TRANSPARENT, pal.accent));
        columnsLabel.setCompoundDrawablePadding(dp(6));
        columnsLabel.setOnClickListener(v -> setColumns(columns >= 4 ? 2 : columns + 1));
        header.addView(columnsLabel);
        column.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(60)));

        // Tab
        LinearLayout tabs = new LinearLayout(activity);
        tabs.setOrientation(LinearLayout.HORIZONTAL);
        tabs.setPadding(dp(12), dp(10), dp(12), dp(4));
        tabAll = text("", 14, pal.ink, true);
        tabMarks = text("", 14, pal.ink, true);
        for (TextView t : new TextView[]{tabAll, tabMarks}) {
            t.setPadding(dp(16), dp(8), dp(16), dp(8));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.setMarginEnd(dp(8));
            tabs.addView(t, lp);
        }
        tabAll.setOnClickListener(v -> setTab(false));
        tabMarks.setOnClickListener(v -> setTab(true));
        column.addView(tabs);

        // Grid + empty state
        FrameLayout gridHost = new FrameLayout(activity);
        grid = new GridView(activity);
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setVerticalSpacing(dp(12));
        grid.setHorizontalSpacing(dp(10));
        grid.setPadding(dp(12), dp(8), dp(12), dp(24));
        grid.setClipToPadding(false);
        grid.setSelector(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> {
            int page = data.get(position);
            dialog.dismiss();
            navigate.accept(page);
        });
        grid.setOnItemLongClickListener((parent, view, position, id) -> {
            openPreview(data.get(position));
            return true;
        });
        grid.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override public void onScrollStateChanged(AbsListView v, int state) {}
            @Override public void onScroll(AbsListView v, int first, int visible, int total) {}
        });
        attachPinch();
        gridHost.addView(grid);
        emptyText = text("Belum ada bookmark.\nKetuk ☆ pada thumbnail atau pakai menu\n\"Tandai halaman ini\" saat membaca.",
            14, pal.inkMuted, false);
        emptyText.setGravity(Gravity.CENTER);
        emptyText.setVisibility(View.GONE);
        gridHost.addView(emptyText, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        column.addView(gridHost, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        TextView hint = text("Ketuk = buka • Tekan lama = pratinjau • Cubit = ubah kolom",
            12, pal.inkMuted, false);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(12), dp(8), dp(12), dp(10));
        hint.setBackgroundColor(pal.surface);
        column.addView(hint);

        buildPreviewLayer();

        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            androidx.core.graphics.Insets safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });

        dialog.setContentView(root);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.setStatusBarColor(pal.surface);
            window.setNavigationBarColor(pal.surface);
            androidx.core.view.WindowInsetsControllerCompat bars =
                new androidx.core.view.WindowInsetsControllerCompat(window, root);
            bars.setAppearanceLightStatusBars(!pal.dark);
            bars.setAppearanceLightNavigationBars(!pal.dark);
        }
        dialog.setOnKeyListener((d, keyCode, event) -> {
            if (keyCode == android.view.KeyEvent.KEYCODE_BACK
                    && event.getAction() == android.view.KeyEvent.ACTION_UP
                    && previewLayer.getVisibility() == View.VISIBLE) {
                closePreview();
                return true;
            }
            return false;
        });
        dialog.setOnDismissListener(d -> release());

        setColumns(columns);
        setTab(false);
        dialog.show();
        ViewCompat.requestApplyInsets(root);
        openRenderer();
    }

    private void buildPreviewLayer() {
        previewLayer = new FrameLayout(activity);
        previewLayer.setBackgroundColor(0xE6000000);
        previewLayer.setVisibility(View.GONE);
        previewLayer.setClickable(true);
        previewLayer.setOnClickListener(v -> closePreview());

        previewImage = new ImageView(activity);
        previewImage.setScaleType(ImageView.ScaleType.FIT_CENTER);
        FrameLayout.LayoutParams ilp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        ilp.setMargins(dp(16), dp(64), dp(16), dp(88));
        previewLayer.addView(previewImage, ilp);

        previewTitle = text("", 15, Color.WHITE, true);
        FrameLayout.LayoutParams tlp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.CENTER_HORIZONTAL);
        tlp.topMargin = dp(20);
        previewLayer.addView(previewTitle, tlp);

        LinearLayout actions = new LinearLayout(activity);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        actions.setGravity(Gravity.CENTER_VERTICAL);
        previewStar = iconButton(R.drawable.ic_star_outline, "Bookmark", Color.WHITE);
        previewStar.setOnClickListener(v -> {
            if (previewPage < 0) return;
            bookmarks.toggle(previewPage);
            refreshPreviewStar();
            refreshTabs();
            if (showMarks) reloadData();
            else adapter.notifyDataSetChanged();
        });
        actions.addView(previewStar, new LinearLayout.LayoutParams(dp(52), dp(52)));
        TextView close = text("Tutup", 15, Color.WHITE, true);
        close.setPadding(dp(18), dp(12), dp(18), dp(12));
        close.setBackground(pill(Color.TRANSPARENT, 0x99FFFFFF));
        close.setOnClickListener(v -> closePreview());
        LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        clp.setMarginStart(dp(8));
        actions.addView(close, clp);
        TextView open = text("Buka halaman", 15, pal.onAccent, true);
        open.setPadding(dp(18), dp(12), dp(18), dp(12));
        open.setBackground(pill(pal.accent, pal.accent));
        open.setOnClickListener(v -> {
            int page = previewPage;
            dialog.dismiss();
            if (page >= 0) navigate.accept(page);
        });
        LinearLayout.LayoutParams olp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        olp.setMarginStart(dp(10));
        actions.addView(open, olp);
        FrameLayout.LayoutParams alp = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        alp.bottomMargin = dp(20);
        previewLayer.addView(actions, alp);
        root.addView(previewLayer, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(activity);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private ImageButton iconButton(int icon, String description, int tint) {
        ImageButton b = new ImageButton(activity);
        b.setImageResource(icon);
        b.setImageTintList(ColorStateList.valueOf(tint));
        b.setContentDescription(description);
        b.setScaleType(ImageView.ScaleType.FIT_CENTER);
        b.setPadding(dp(12), dp(12), dp(12), dp(12));
        TypedValue ripple = new TypedValue();
        activity.getTheme().resolveAttribute(
            android.R.attr.selectableItemBackgroundBorderless, ripple, true);
        b.setBackgroundResource(ripple.resourceId);
        return b;
    }

    private GradientDrawable pill(int fill, int stroke) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setStroke(dp(1.5f), stroke);
        d.setCornerRadius(dp(20));
        return d;
    }

    private void setColumns(int n) {
        columns = Math.max(2, Math.min(4, n));
        activity.getSharedPreferences("lab_prefs", 0).edit().putInt("thumb_cols", columns).apply();
        int first = grid.getFirstVisiblePosition();
        grid.setNumColumns(columns);
        columnsLabel.setText(columns + " kolom");
        adapter.notifyDataSetChanged();
        grid.post(() -> grid.setSelection(first));
    }

    private void setTab(boolean marks) {
        showMarks = marks;
        refreshTabs();
        reloadData();
        if (!marks) grid.post(() -> grid.setSelection(Math.max(0, currentPage - columns)));
    }

    private void refreshTabs() {
        tabAll.setText("Semua (" + pages + ")");
        tabMarks.setText("★ Bookmark (" + bookmarks.count() + ")");
        styleTab(tabAll, !showMarks);
        styleTab(tabMarks, showMarks);
    }

    private void styleTab(TextView t, boolean selected) {
        t.setBackground(pill(selected ? pal.accent : Color.TRANSPARENT,
            selected ? pal.accent : pal.divider));
        t.setTextColor(selected ? pal.onAccent : pal.ink);
    }

    private void reloadData() {
        data.clear();
        if (showMarks) data.addAll(bookmarks.sorted(pages));
        else for (int i = 0; i < pages; i++) data.add(i);
        emptyText.setVisibility(showMarks && data.isEmpty() ? View.VISIBLE : View.GONE);
        adapter.notifyDataSetChanged();
    }

    private void attachPinch() {
        final float[] accumulated = {1f};
        ScaleGestureDetector detector = new ScaleGestureDetector(activity,
            new ScaleGestureDetector.SimpleOnScaleGestureListener() {
                @Override public boolean onScaleBegin(ScaleGestureDetector d) {
                    accumulated[0] = 1f;
                    return true;
                }
                @Override public boolean onScale(ScaleGestureDetector d) {
                    accumulated[0] *= d.getScaleFactor();
                    if (accumulated[0] > 1.25f && columns > 2) {
                        setColumns(columns - 1);   // cubit membesar = thumbnail lebih besar
                        accumulated[0] = 1f;
                    } else if (accumulated[0] < 0.8f && columns < 4) {
                        setColumns(columns + 1);
                        accumulated[0] = 1f;
                    }
                    return true;
                }
            });
        grid.setOnTouchListener((v, event) -> {
            detector.onTouchEvent(event);
            if (event.getPointerCount() > 1) {
                // Batalkan gulir/klik ketika dua jari dipakai untuk mencubit.
                MotionEvent cancel = MotionEvent.obtain(event);
                cancel.setAction(MotionEvent.ACTION_CANCEL);
                v.onTouchEvent(cancel);
                cancel.recycle();
                return true;
            }
            return false;
        });
    }

    // ------------------------------------------------------------------ preview

    private void openPreview(int page) {
        previewPage = page;
        previewTitle.setText("Halaman " + (page + 1) + " dari " + pages);
        Bitmap small = cache.get(page);
        previewImage.setImageBitmap(small);
        refreshPreviewStar();
        previewLayer.setAlpha(0f);
        previewLayer.setVisibility(View.VISIBLE);
        previewLayer.animate().alpha(1f).setDuration(160).start();
        int target = Math.min(activity.getResources().getDisplayMetrics().widthPixels, 1400);
        worker.execute(() -> {
            Bitmap big = renderPage(page, target, 2_400_000d);
            activity.runOnUiThread(() -> {
                if (cancelled || previewPage != page || big == null) return;
                previewImage.setImageBitmap(big);
            });
        });
    }

    private void refreshPreviewStar() {
        boolean marked = previewPage >= 0 && bookmarks.contains(previewPage);
        previewStar.setImageResource(marked ? R.drawable.ic_star : R.drawable.ic_star_outline);
        previewStar.setImageTintList(ColorStateList.valueOf(marked ? pal.star : Color.WHITE));
    }

    private void closePreview() {
        previewPage = -1;
        previewLayer.animate().alpha(0f).setDuration(140).withEndAction(() -> {
            previewLayer.setVisibility(View.GONE);
            previewImage.setImageDrawable(null);
        }).start();
    }

    // ------------------------------------------------------------------ rendering

    private void openRenderer() {
        worker.execute(() -> {
            try {
                PdfSource opened = PdfSource.open(activity, uri, "pdf_thumbs", () -> cancelled);
                if (cancelled) { opened.close(); return; }
                source = opened;
                if (opened.renderer.getPageCount() > 0) {
                    try (PdfRenderer.Page first = opened.renderer.openPage(0)) {
                        pageAspect = (float) first.getHeight() / Math.max(1, first.getWidth());
                    }
                }
                activity.runOnUiThread(() -> {
                    if (cancelled) return;
                    adapter.notifyDataSetChanged();
                });
            } catch (Exception e) {
                activity.runOnUiThread(() -> {
                    if (cancelled) return;
                    statusText.setText("Thumbnail tidak tersedia (" + e.getClass().getSimpleName()
                        + "). Navigasi tetap bisa lewat nomor halaman.");
                });
            }
        });
    }

    /** Antrean LIFO: halaman yang terakhir diminta (yang sedang terlihat) dirender dulu. */
    private void schedule(int page) {
        if (cancelled || cache.get(page) != null) return;
        if (queued.contains(page)) {
            queue.remove(page);
        } else {
            queued.add(page);
        }
        queue.addFirst(page);
        drain();
    }

    private void drain() {
        if (drainScheduled || cancelled || source == null) return;
        Integer next = queue.pollFirst();
        while (next != null && !bound.contains(next)) {   // sudah tergulir keluar layar
            queued.remove(next);
            next = queue.pollFirst();
        }
        if (next == null) return;
        final int page = next;
        drainScheduled = true;
        worker.execute(() -> {
            Bitmap bitmap = renderPage(page, renderWidth, 400_000d);
            activity.runOnUiThread(() -> {
                drainScheduled = false;
                queued.remove(page);
                if (cancelled) return;
                if (bitmap != null) {
                    cache.put(page, bitmap);
                    deliver(page, bitmap);
                }
                drain();
            });
        });
    }

    private void deliver(int page, Bitmap bitmap) {
        for (int i = 0; i < grid.getChildCount(); i++) {
            View child = grid.getChildAt(i);
            Object tag = child.getTag();
            if (tag instanceof Holder && ((Holder) tag).page == page) {
                ((Holder) tag).image.setImageBitmap(bitmap);
            }
        }
    }

    /** Hanya dipanggil di thread worker (PdfRenderer tidak thread-safe). */
    private Bitmap renderPage(int page, int targetWidth, double maxPixels) {
        PdfSource s = source;
        if (s == null || cancelled || page < 0 || page >= s.renderer.getPageCount()) return null;
        try (PdfRenderer.Page pdf = s.renderer.openPage(page)) {
            int width = Math.max(1, targetWidth);
            int height = Math.max(1, Math.round((float) width * pdf.getHeight() / pdf.getWidth()));
            double bound = Math.min(1d, Math.sqrt(maxPixels / ((double) width * height)));
            width = Math.max(1, (int) (width * bound));
            height = Math.max(1, (int) (height * bound));
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            Matrix m = new Matrix();
            m.setScale((float) width / pdf.getWidth(), (float) height / pdf.getHeight());
            pdf.render(bitmap, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
            return bitmap;
        } catch (Exception | OutOfMemoryError ignored) {
            // Thumbnail opsional tidak boleh mengganggu pembacaan.
            return null;
        }
    }

    private void release() {
        cancelled = true;
        queue.clear();
        worker.execute(() -> {
            PdfSource s = source;
            source = null;
            if (s != null) s.close();
        });
        worker.shutdown();
        cache.evictAll();
    }

    // ------------------------------------------------------------------ adapter

    private static final class Holder {
        int page = -1;
        FrameLayout card;
        ImageView image;
        TextView label;
        ImageButton star;
    }

    private final BaseAdapter adapter = new BaseAdapter() {
        @Override public int getCount() { return data.size(); }
        @Override public Object getItem(int position) { return data.get(position); }
        @Override public long getItemId(int position) { return data.get(position); }

        @Override public View getView(int position, View convert, ViewGroup parent) {
            Holder h;
            View item;
            if (convert != null && convert.getTag() instanceof Holder) {
                item = convert;
                h = (Holder) convert.getTag();
            } else {
                h = new Holder();
                LinearLayout cell = new LinearLayout(activity);
                cell.setOrientation(LinearLayout.VERTICAL);
                cell.setGravity(Gravity.CENTER_HORIZONTAL);
                h.card = new FrameLayout(activity);
                h.card.setPadding(dp(3), dp(3), dp(3), dp(3));
                h.image = new ImageView(activity);
                h.image.setScaleType(ImageView.ScaleType.FIT_CENTER);
                h.image.setBackgroundColor(Color.WHITE);
                h.card.addView(h.image, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                h.star = new ImageButton(activity);
                h.star.setScaleType(ImageView.ScaleType.FIT_CENTER);
                h.star.setPadding(dp(6), dp(6), dp(6), dp(6));
                GradientDrawable starBg = new GradientDrawable();
                starBg.setShape(GradientDrawable.OVAL);
                starBg.setColor(0x99000000);
                h.star.setBackground(starBg);
                h.star.setFocusable(false);
                FrameLayout.LayoutParams slp = new FrameLayout.LayoutParams(dp(32), dp(32),
                    Gravity.TOP | Gravity.END);
                slp.setMargins(0, dp(4), dp(4), 0);
                h.card.addView(h.star, slp);
                cell.addView(h.card, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, dp(160)));
                h.label = new TextView(activity);
                h.label.setGravity(Gravity.CENTER);
                h.label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                h.label.setPadding(0, dp(5), 0, 0);
                cell.addView(h.label, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
                item = cell;
                item.setTag(h);
            }

            final int page = data.get(position);
            if (h.page >= 0 && h.page != page) bound.remove(h.page);
            h.page = page;
            bound.add(page);

            // Tinggi kartu mengikuti lebar kolom dan rasio halaman.
            int gridWidth = grid.getWidth() - grid.getPaddingLeft() - grid.getPaddingRight();
            if (gridWidth <= 0) gridWidth = activity.getResources().getDisplayMetrics().widthPixels - dp(24);
            int colWidth = (gridWidth - dp(10) * (columns - 1)) / columns;
            ViewGroup.LayoutParams cardLp = h.card.getLayoutParams();
            int cardHeight = Math.round(colWidth * pageAspect);
            if (cardLp.height != cardHeight) {
                cardLp.height = cardHeight;
                h.card.setLayoutParams(cardLp);
            }

            boolean current = page == currentPage;
            GradientDrawable frame = new GradientDrawable();
            frame.setCornerRadius(dp(8));
            frame.setColor(current ? pal.accent : pal.surfaceAlt);
            frame.setStroke(dp(current ? 0 : 1), pal.divider);
            h.card.setBackground(frame);
            h.label.setText(current ? (page + 1) + " • dibaca" : Integer.toString(page + 1));
            h.label.setTextColor(current ? pal.accent : pal.inkMuted);
            h.label.setTypeface(current ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);

            boolean marked = bookmarks.contains(page);
            h.star.setImageResource(marked ? R.drawable.ic_star : R.drawable.ic_star_outline);
            h.star.setImageTintList(ColorStateList.valueOf(marked ? pal.star : Color.WHITE));
            h.star.setContentDescription(marked ? "Hapus bookmark" : "Tambah bookmark");
            h.star.setOnClickListener(v -> {
                bookmarks.toggle(page);
                refreshTabs();
                if (showMarks) reloadData(); else notifyDataSetChanged();
            });

            Bitmap bitmap = cache.get(page);
            if (bitmap != null) {
                h.image.setImageBitmap(bitmap);
            } else {
                h.image.setImageDrawable(null);
                schedule(page);
            }
            return item;
        }
    };
}
