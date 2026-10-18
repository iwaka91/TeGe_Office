package com.totogutomo.tgpdflab;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.graphics.RectF;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupWindow;
import android.widget.TextView;

import androidx.annotation.DrawableRes;
import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AlertDialog;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.pdf.ExperimentalPdfApi;
import androidx.pdf.PdfDocument;
import androidx.pdf.view.PdfView;

import com.totogutomo.tgpdflab.databinding.ActivityMainBinding;

import java.util.Locale;

/** Reader-facing features. AndroidX remains the only full-page viewing engine. */
@OptIn(markerClass = ExperimentalPdfApi.class)
final class ViewerFeatures {
    private static final String PREFS = "lab_prefs";
    private static final long EDGE_JUMP_VISIBLE_MS = 2000;

    private final MainActivity activity;
    private final ActivityMainBinding ui;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hideEdgeJump = this::hideEdgeJumpNow;
    private PdfView pdfView;
    private Uri source;
    private Bookmarks bookmarks;
    private int pages = 0;
    private int page = 0;
    private int restorePage = 0;
    private long restoreUntil = 0;
    private long quietUntil = 0;
    private long lastSave = 0;
    private boolean fullScreen = false;
    private boolean flipbook = false;
    private boolean autoFlipDone = false;
    private boolean twoPage;
    private boolean paperSound;
    private FlipbookMode flipMode;
    private PopupWindow menuPopup;

    ViewerFeatures(MainActivity activity, ActivityMainBinding ui) {
        this.activity = activity;
        this.ui = ui;
        paperSound = prefs().getBoolean("flip_sound", true);
        twoPage = prefs().getBoolean("flip_book", false);

        ui.menuButton.setOnClickListener(v -> showMenu());
        ui.menuButton.setOnLongClickListener(v -> { activity.toggleDiagnostics(); return true; });
        ui.searchQuick.setOnClickListener(v -> {
            if (flipbook) {
                activity.showStatus("Pencarian teks tersedia di mode baca normal", 2500);
                return;
            }
            activity.toggleSearch();
        });
        ui.rotateQuick.setOnClickListener(v -> rotate());
        ui.fullQuick.setOnClickListener(v -> {
            if (!loaded()) { activity.showStatus("Buka PDF dahulu", 2000); return; }
            fullScreen = true;
            applyChrome();
        });
        ui.shareQuick.setOnClickListener(v -> activity.shareCurrent());
        ui.exitFullButton.setOnClickListener(v -> exitImmersive());
        ui.floatPrev.setOnClickListener(v -> step(-1));
        ui.floatNext.setOnClickListener(v -> step(1));
        ui.floatPage.setOnClickListener(v -> askForPage());
        ui.floatGoto.setOnClickListener(v -> askForPage());
        ui.jumpFirst.setOnClickListener(v -> { jump(0); scheduleEdgeHide(); });
        ui.jumpLast.setOnClickListener(v -> { jump(pages - 1); scheduleEdgeHide(); });
        ui.soundQuick.setOnClickListener(v -> togglePaperSound());
        ui.soundFloat.setOnClickListener(v -> togglePaperSound());
        ui.flipView.setListener(new PageCurlView.Listener() {
            @Override public void onSpreadChanged(int firstPage) {
                page = firstPage;
                update();
                persist();
                if (flipMode != null) flipMode.prefetch();
            }
            @Override public void onFlipStarted() {
                if (flipMode != null) flipMode.playFlipSound();
            }
        });
        applyPalette(activity.palette());
        update();
    }

    private android.content.SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private boolean loaded() { return source != null && pages > 0; }

    // ---------------------------------------------------------------- palette

    void applyPalette(@NonNull ReaderPalette p) {
        GradientDrawable nav = new GradientDrawable();
        nav.setColor(p.navBg);
        nav.setStroke(Math.round(activity.dp(1)), p.divider);
        nav.setCornerRadius(activity.dp(24));
        ui.floatingNav.setBackground(nav);
        ColorStateList ink = ColorStateList.valueOf(p.ink);
        ColorStateList accent = ColorStateList.valueOf(p.accent);
        ui.floatPrev.setImageTintList(accent);
        ui.floatNext.setImageTintList(accent);
        ui.floatGoto.setImageTintList(ink);
        ui.floatPage.setTextColor(p.ink);
        ui.soundFloat.setBackground(roundButton(p.navBg, p.divider, p.ink));
        ui.soundFloat.setImageTintList(ink);
        // Tombol ⏏ halaman pertama/terakhir: kapsul kecil transparan, tidak menutupi teks
        for (ImageButton b : new ImageButton[]{ui.jumpFirst, ui.jumpLast}) {
            GradientDrawable cap = new GradientDrawable();
            cap.setCornerRadius(activity.dp(12));
            cap.setColor(0x8C14243A);
            cap.setStroke(Math.round(activity.dp(1)), 0x40FFFFFF);
            b.setBackground(new RippleDrawable(ColorStateList.valueOf(0x40FFFFFF), cap, null));
            b.setImageTintList(ColorStateList.valueOf(0xFFFFFFFF));
            b.setOnTouchListener((v, e) -> {
                int a = e.getActionMasked();
                if (a == android.view.MotionEvent.ACTION_DOWN) { v.animate().alpha(0.9f).setDuration(90).start(); handler.removeCallbacks(hideEdgeJump); }
                else if (a == android.view.MotionEvent.ACTION_UP || a == android.view.MotionEvent.ACTION_CANCEL) { v.animate().alpha(edgeIdleAlpha(v)).setDuration(200).start(); scheduleEdgeHide(); }
                return false;
            });
        }
        ui.exitFullButton.setBackground(roundButton(p.accent, p.accent, p.onAccent));
        ui.exitFullButton.setImageTintList(ColorStateList.valueOf(p.onAccent));
        ui.progressTrack.setBackgroundColor(p.dark ? 0x22FFFFFF : 0x1A14243A);
        ui.progressFill.setBackgroundColor(p.progress);
        ui.progressFill.setPivotX(0f);
        ui.flipView.setColors(p.background, p.dark);
        refreshSoundButtons();
    }

    private RippleDrawable roundButton(int fill, int stroke, int ripple) {
        GradientDrawable circle = new GradientDrawable();
        circle.setShape(GradientDrawable.OVAL);
        circle.setColor(fill);
        circle.setStroke(Math.round(activity.dp(1)), stroke);
        return new RippleDrawable(ColorStateList.valueOf((ripple & 0x00FFFFFF) | 0x33000000),
            circle, null);
    }

    // ---------------------------------------------------------------- hamburger

    private void showMenu() {
        if (menuPopup != null && menuPopup.isShowing()) { menuPopup.dismiss(); return; }
        ReaderPalette p = activity.palette();
        LinearLayout list = new LinearLayout(activity);
        list.setOrientation(LinearLayout.VERTICAL);
        int pad = Math.round(activity.dp(6));
        list.setPadding(0, pad, 0, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(p.surfaceAlt);
        bg.setCornerRadius(activity.dp(16));
        bg.setStroke(Math.round(activity.dp(1)), p.divider);
        list.setBackground(bg);
        // Lebar sama dengan menu Word/Excel/PPTX: min(300dp, layar - 20dp).
        int screenW = activity.getResources().getDisplayMetrics().widthPixels;
        int menuW = Math.min(Math.round(activity.dp(300)), screenW - Math.round(activity.dp(20)));

        PopupWindow popup = new PopupWindow(list, menuW,
            ViewGroup.LayoutParams.WRAP_CONTENT, true);
        popup.setBackgroundDrawable(new ColorDrawable(0));
        popup.setOutsideTouchable(true);
        popup.setElevation(activity.dp(12));

        addMenuRow(list, popup, R.drawable.ic_flip, "Flipbook", flipbook ? "AKTIF" : null,
            loaded(), this::requestFlipbook);
        if (flipbook) {
            addMenuRow(list, popup, R.drawable.ic_book, "Mode buku 2 halaman",
                twoPage ? "NYALA" : "MATI", true, () -> setTwoPage(!twoPage));
        }
        addMenuRow(list, popup, R.drawable.ic_grid, "Thumbnail", null, loaded(), this::openThumbnails);
        boolean marked = bookmarks != null && bookmarks.contains(page);
        addMenuRow(list, popup, marked ? R.drawable.ic_star : R.drawable.ic_star_outline,
            marked ? "Hapus tanda halaman " + (page + 1) : "Tandai halaman ini",
            null, loaded(), this::toggleBookmark);
        addMenuSeparator(list, p);
        // Bagian bawah seragam dengan menu Word, Excel, dan PowerPoint.
        addMenuRow(list, popup, R.drawable.ic_rotate, "Putar layar", null, true, this::rotate);
        addMenuRow(list, popup, R.drawable.ic_fullscreen, "Layar penuh", null, loaded(),
            () -> ui.fullQuick.performClick());
        addMenuRow(list, popup, p.dark ? R.drawable.ic_sun : R.drawable.ic_moon,
            p.dark ? "Tema terang" : "Tema gelap", null, true, () -> ui.themeQuick.performClick());
        addMenuRow(list, popup, R.drawable.ic_print, "Cetak", null,
            activity.hasDocument(), activity::printCurrent);
        addMenuRow(list, popup, R.drawable.ic_share, "Bagikan PDF", null,
            activity.hasDocument(), activity::shareCurrent);

        menuPopup = popup;
        // Rata kanan layar (jarak 10dp), tepat di bawah bilah atas.
        int[] loc = new int[2];
        ui.menuButton.getLocationInWindow(loc);
        int y = loc[1] + ui.menuButton.getHeight() + Math.round(activity.dp(2));
        popup.showAtLocation(ui.menuButton, Gravity.TOP | Gravity.END,
            Math.round(activity.dp(10)), y);
    }

    private void addMenuSeparator(LinearLayout list, ReaderPalette p) {
        View line = new View(activity);
        line.setBackgroundColor(p.divider);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, Math.round(activity.dp(1))));
        int m = Math.round(activity.dp(6));
        lp.setMargins(0, m, 0, m);
        list.addView(line, lp);
    }

    private void addMenuRow(LinearLayout list, PopupWindow popup, @DrawableRes int icon,
            String label, String badge, boolean enabled, Runnable action) {
        ReaderPalette p = activity.palette();
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        int h = Math.round(activity.dp(18));
        int v = Math.round(activity.dp(13));
        row.setPadding(h, v, h, v);
        TypedValue ripple = new TypedValue();
        activity.getTheme().resolveAttribute(android.R.attr.selectableItemBackground, ripple, true);
        row.setBackgroundResource(ripple.resourceId);

        ImageView image = new ImageView(activity);
        image.setImageResource(icon);
        image.setImageTintList(ColorStateList.valueOf(
            icon == R.drawable.ic_star ? p.star : p.ink));
        int size = Math.round(activity.dp(22));
        row.addView(image, new LinearLayout.LayoutParams(size, size));

        TextView text = new TextView(activity);
        text.setText(label);
        text.setTextColor(p.ink);
        text.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        LinearLayout.LayoutParams textLp = new LinearLayout.LayoutParams(0,
            ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        textLp.setMarginStart(Math.round(activity.dp(16)));
        row.addView(text, textLp);

        if (badge != null) {
            TextView pill = new TextView(activity);
            pill.setText(badge);
            pill.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            pill.setTypeface(pill.getTypeface(), android.graphics.Typeface.BOLD);
            boolean on = "AKTIF".equals(badge) || "NYALA".equals(badge);
            GradientDrawable pillBg = new GradientDrawable();
            pillBg.setCornerRadius(activity.dp(10));
            pillBg.setColor(on ? p.accent : p.divider);
            pill.setBackground(pillBg);
            pill.setTextColor(on ? p.onAccent : p.inkMuted);
            int ph = Math.round(activity.dp(8));
            int pv = Math.round(activity.dp(3));
            pill.setPadding(ph, pv, ph, pv);
            LinearLayout.LayoutParams pillLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            pillLp.setMarginStart(Math.round(activity.dp(12)));
            row.addView(pill, pillLp);
        }
        row.setEnabled(enabled);
        row.setAlpha(enabled ? 1f : 0.4f);
        row.setOnClickListener(x -> {
            popup.dismiss();
            action.run();
        });
        list.addView(row, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private void toggleBookmark() {
        if (bookmarks == null || !loaded()) return;
        boolean marked = bookmarks.toggle(page);
        activity.showStatus(marked
            ? "★ Halaman " + (page + 1) + " ditandai"
            : "Tanda halaman " + (page + 1) + " dihapus", 1800);
    }

    private void openThumbnails() {
        if (!loaded() || bookmarks == null) return;
        new ThumbnailNavigator(activity, source, pages, page, bookmarks,
            activity.palette(), this::jump).show();
    }

    // ---------------------------------------------------------------- document lifecycle

    void beforeOpen(@NonNull Uri newSource) {
        if (flipbook) activateFlipbook(false);
        persist();
        autoFlipDone = false;
        source = newSource;
        bookmarks = new Bookmarks(activity, newSource);
        pdfView = null;
        pages = 0;
        page = 0;
        int start = activity.getIntent().getIntExtra(MainActivity.EXTRA_START_PAGE, 0);
        restorePage = start > 0 ? start - 1 : prefs().getInt(key(newSource), 0);
        restoreUntil = 0;
        update();
    }

    void onViewerCreated(PdfView view) {
        pdfView = view;
    }

    void onDocumentReady(PdfDocument doc) {
        pages = doc.getPageCount();
        int target = Math.max(0, Math.min(pages - 1, restorePage));
        restoreUntil = SystemClock.elapsedRealtime() + 4000;
        quietUntil = SystemClock.elapsedRealtime() + 1500;
        update();
        if (pages > 0 && target > 0 && pdfView != null) {
            PdfView active = pdfView;
            active.postDelayed(() -> {
                if (pdfView != active || source == null) return;
                scrollTo(target);
            }, 260);
        } else {
            restoreUntil = 0;
        }
    }

    void onViewport(int first, android.util.SparseArray<RectF> locations, float zoom) {
        if (flipbook) return;
        if (source == null || pages <= 0) return;
        int visible = Math.max(0, Math.min(pages - 1, first));
        if (restoreUntil > SystemClock.elapsedRealtime() && visible != restorePage) {
            return; // Prevent an initial page-1 callback overwriting saved progress.
        }
        restoreUntil = 0;
        page = visible;
        update();
        if (SystemClock.elapsedRealtime() > quietUntil) showEdgeJump();
        long now = SystemClock.elapsedRealtime();
        if (now - lastSave > 800) {
            persist();
            lastSave = now;
        }
    }

    /** TeGe Office: tampilan PDF bawaan (Pengaturan). Dipanggil setelah halaman terbukti tampil. */
    void onContentConfirmed() {
        if (autoFlipDone || flipbook || !loaded()) return;
        autoFlipDone = true;
        String v = activity.getSharedPreferences("tg_office_prefs", Activity.MODE_PRIVATE).getString("pdf_view", "gulir");
        if (!"flipbook".equals(v)) return;
        if (page == 0 && restorePage > 0) page = Math.min(pages - 1, restorePage);
        requestFlipbook();
    }

    void onFirstContentReady() {
        String name = activity.currentName();
        activity.showStatus((name == null ? "Dokumen" : name) + " • " + pages + " halaman", 2200);
    }

    void onError() {
        update();
    }

    void close() {
        if (flipbook) activateFlipbook(false);
        persist();
        source = null;
        bookmarks = null;
        pdfView = null;
        pages = 0;
        page = 0;
        restoreUntil = 0;
        fullScreen = false;
        applyChrome();
        update();
    }

    void persist() {
        if (source == null || pages < 1) return;
        prefs().edit().putInt(key(source), page).apply();
        MainActivity.report(activity.currentName(), page + 1, pages);
    }

    int pageCount() { return pages; }
    int pageNumber() { return page; }

    private String key(Uri uri) { return "resume_v04_" + uri.toString(); }

    // ---------------------------------------------------------------- navigation

    private void step(int delta) {
        if (flipbook && flipMode != null) {
            if (delta > 0) ui.flipView.next(); else ui.flipView.prev();
            return;
        }
        jump(page + delta);
    }

    void jump(int index) {
        if (flipbook && flipMode != null) {
            ui.flipView.goToPage(index, true);
            return;
        }
        if (pdfView == null || pages <= 0 || index < 0 || index >= pages) return;
        scrollTo(index);
    }

    private void scrollTo(int index) {
        if (pdfView == null || pages <= 0) return;
        int safe = Math.max(0, Math.min(index, pages - 1));
        pdfView.scrollToPage(safe);
        page = safe;
        restoreUntil = 0;
        persist();
        update();
    }

    private void askForPage() {
        if (pages <= 0) return;
        EditText field = new EditText(activity);
        field.setInputType(InputType.TYPE_CLASS_NUMBER);
        field.setSingleLine(true);
        field.setText(Integer.toString(page + 1));
        field.selectAll();
        int pad = Math.round(activity.dp(20));
        android.widget.FrameLayout holder = new android.widget.FrameLayout(activity);
        holder.setPadding(pad, 0, pad, 0);
        holder.addView(field);
        AlertDialog dialog = new AlertDialog.Builder(activity).setTitle("Ke halaman (1–" + pages + ")")
            .setView(holder)
            .setNegativeButton("Batal", null)
            .setPositiveButton("Buka", (d, which) -> {
                try {
                    int number = Integer.parseInt(field.getText().toString().trim());
                    if (number >= 1 && number <= pages) jump(number - 1);
                    else activity.showStatus("Masukkan 1–" + pages, 2000);
                } catch (NumberFormatException e) {
                    activity.showStatus("Nomor halaman tidak valid", 2000);
                }
            }).create();
        dialog.setOnShowListener(d -> {
            field.requestFocus();
            if (dialog.getWindow() != null) {
                dialog.getWindow().setSoftInputMode(
                    android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
            }
        });
        dialog.show();
    }

    private void showEdgeJump() {
        if (!loaded() || flipbook || pages < 3) return;
        if (ui.edgeJump.getVisibility() != View.VISIBLE) {
            ui.edgeJump.setAlpha(0f);
            ui.edgeJump.setVisibility(View.VISIBLE);
            ui.edgeJump.animate().alpha(1f).setDuration(150).start();
        }
        ui.jumpFirst.setAlpha(edgeIdleAlpha(ui.jumpFirst));
        ui.jumpLast.setAlpha(edgeIdleAlpha(ui.jumpLast));
        scheduleEdgeHide();
    }

    /** 40% saat diam; 18% bila sudah di halaman pertama/terakhir. */
    private float edgeIdleAlpha(View v) {
        boolean atEdge = v == ui.jumpFirst ? page <= 0 : page >= pages - 1;
        return atEdge ? 0.18f : 0.4f;
    }

    private void scheduleEdgeHide() {
        handler.removeCallbacks(hideEdgeJump);
        handler.postDelayed(hideEdgeJump, EDGE_JUMP_VISIBLE_MS);
    }

    private void hideEdgeJumpNow() {
        if (ui.edgeJump.getVisibility() != View.VISIBLE) return;
        ui.edgeJump.animate().alpha(0f).setDuration(220)
            .withEndAction(() -> ui.edgeJump.setVisibility(View.GONE)).start();
    }

    // ---------------------------------------------------------------- orientation / fullscreen

    private boolean isLandscape() {
        return activity.getResources().getConfiguration().orientation
            == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
    }

    private void rotate() {
        persist();
        activity.setRequestedOrientation(isLandscape()
            ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    /** Keluar dari layar penuh; bila sedang landscape, kembali ke portrait. */
    private void exitImmersive() {
        fullScreen = false;
        if (isLandscape()) {
            persist();
            activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }
        applyChrome();
    }

    /** Toolbar tampil di mode baca biasa; disembunyikan hanya saat landscape atau layar penuh. */
    private void applyChrome() {
        boolean immersive = fullScreen || isLandscape();
        ui.mainToolbar.setVisibility(immersive ? View.GONE : View.VISIBLE);
        if (immersive) ui.diagnosticPanel.setVisibility(View.GONE);
        ui.exitFullButton.setVisibility(immersive ? View.VISIBLE : View.GONE);
        WindowInsetsControllerCompat controller =
            new WindowInsetsControllerCompat(activity.getWindow(), ui.readerRoot);
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        if (immersive) controller.hide(WindowInsetsCompat.Type.systemBars());
        else controller.show(WindowInsetsCompat.Type.systemBars());
        if (menuPopup != null && immersive) menuPopup.dismiss();
        refreshSoundButtons();
        ui.readerRoot.requestApplyInsets();
    }

    boolean handleBack() {
        if (fullScreen || isLandscape()) { exitImmersive(); return true; }
        if (flipbook) { activateFlipbook(false); return true; }
        return false;
    }

    void onWindowResized() {
        applyChrome();
        // AndroidX PdfView recalculates its layout in place; never reload the PDF.
        if (pdfView != null) {
            pdfView.requestLayout();
            pdfView.invalidate();
        }
        if (flipbook && flipMode != null) flipMode.onResized();
    }

    // ---------------------------------------------------------------- flipbook

    private void refreshSoundButtons() {
        boolean immersive = fullScreen || isLandscape();
        ui.soundQuick.setVisibility(flipbook && !immersive ? View.VISIBLE : View.GONE);
        ui.soundFloat.setVisibility(flipbook && immersive ? View.VISIBLE : View.GONE);
        int icon = paperSound ? R.drawable.ic_volume_on : R.drawable.ic_volume_off;
        ui.soundQuick.setImageResource(icon);
        ui.soundFloat.setImageResource(icon);
        ReaderPalette p = activity.palette();
        ui.menuButton.setImageTintList(ColorStateList.valueOf(flipbook ? p.accent : p.ink));
        ui.searchQuick.setAlpha(flipbook ? 0.4f : 1f);
    }

    private void togglePaperSound() {
        if (!flipbook) return;
        paperSound = !paperSound;
        prefs().edit().putBoolean("flip_sound", paperSound).apply();
        if (flipMode != null) flipMode.setSoundEnabled(paperSound);
        refreshSoundButtons();
        activity.showStatus(paperSound ? "Suara kertas nyala" : "Suara kertas mati", 1400);
    }

    private void setTwoPage(boolean enabled) {
        twoPage = enabled;
        prefs().edit().putBoolean("flip_book", enabled).apply();
        if (flipMode != null) flipMode.setTwoPage(enabled, page);
        if (enabled && !isLandscape()) {
            activity.showStatus("Tip: putar ke landscape agar tampilan buku lebih lega", 3200);
        }
        update();
    }

    private void requestFlipbook() {
        if (flipbook) { activateFlipbook(false); return; }
        if (!loaded()) {
            activity.showStatus("Buka PDF dahulu", 2000);
            return;
        }
        if (pages >= 100) {
            new AlertDialog.Builder(activity).setTitle("Dokumen dengan Banyak Halaman")
                .setMessage("Dokumen ini memiliki " + pages + " halaman. Mode Flipbook dapat menambah beban render dan mengurangi kenyamanan membaca.\n\nUntuk performa terbaik, gunakan Mode Baca Normal.")
                .setNegativeButton("Aktifkan Flipbook", (d, w) -> activateFlipbook(true))
                .setPositiveButton("Tetap Baca Normal", (d, w) -> activateFlipbook(false))
                .show();
        } else activateFlipbook(true);
    }

    private void activateFlipbook(boolean enabled) {
        if (enabled == flipbook) return;
        flipbook = enabled;
        hideEdgeJumpNow();
        if (enabled) {
            ui.pdfContainer.setVisibility(View.INVISIBLE);
            ui.flipbookOverlay.setVisibility(View.VISIBLE);
            flipMode = new FlipbookMode(activity, ui.flipView);
            flipMode.setSoundEnabled(paperSound);
            flipMode.open(source, page, twoPage);
        } else {
            if (flipMode != null) { flipMode.close(); flipMode = null; }
            ui.flipbookOverlay.setVisibility(View.GONE);
            ui.pdfContainer.setVisibility(View.VISIBLE);
            if (pdfView != null) scrollTo(page);
        }
        refreshSoundButtons();
        update();
    }

    // ---------------------------------------------------------------- indicators

    private void update() {
        String label;
        if (pages <= 0) {
            label = "—/—";
        } else if (flipbook && twoPage) {
            label = ui.flipView.spreadLabel() + "/" + pages;
        } else {
            label = String.format(Locale.US, "%d/%d", page + 1, pages);
        }
        ui.floatPage.setText(label);
        boolean canPrev, canNext;
        if (flipbook) {
            canPrev = ui.flipView.canPrev();
            canNext = ui.flipView.canNext();
        } else {
            canPrev = page > 0;
            canNext = page < pages - 1;
        }
        ui.floatPrev.setAlpha(canPrev ? 1f : 0.35f);
        ui.floatNext.setAlpha(canNext ? 1f : 0.35f);
        boolean loaded = loaded();
        ui.floatingNav.setVisibility(loaded ? View.VISIBLE : View.GONE);
        ui.progressTrack.setVisibility(loaded ? View.VISIBLE : View.INVISIBLE);
        float progress = pages <= 0 ? 0f : (float) (page + 1) / pages;
        if (flipbook && twoPage && pages > 0) {
            progress = Math.min(1f, (float) (ui.flipView.lastVisiblePage() + 1) / pages);
        }
        ui.progressFill.setScaleX(progress);
        float dim = loaded ? 1f : 0.4f;
        ui.fullQuick.setAlpha(dim);
        ui.shareQuick.setAlpha(activity.hasDocument() ? 1f : 0.4f);
        if (!flipbook) ui.searchQuick.setAlpha(dim);
    }
}
