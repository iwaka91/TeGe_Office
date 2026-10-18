package com.totogutomo.tgpdflab;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.content.res.Configuration;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.view.ViewGroup;
import android.widget.Button;
import androidx.core.view.WindowInsetsControllerCompat;
import android.graphics.RectF;
import android.util.SparseArray;
import androidx.pdf.PdfDocument;
import androidx.pdf.view.PdfView;
import android.os.ext.SdkExtensions;
import android.view.View;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.SystemClock;
import android.provider.OpenableColumns;
import android.util.Log;
import android.widget.Toast;

import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.content.FileProvider;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.totogutomo.tgpdflab.databinding.ActivityMainBinding;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends AppCompatActivity {
    private static final String TAG = "TG_PDF_LAB";
    private static final String PREFS = "lab_prefs";
    private static final String KEY_LAST_URI = "last_uri";
    private static final String KEY_DARK = "dark";
    private static final String STATE_URI = "state_uri";

    private ActivityMainBinding ui;
    private LabPdfFragment pdfFragment;
    private ViewerFeatures features;
    private Uri currentUri;
    private long loadStartedAt;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final StringBuilder diagnosticLog = new StringBuilder();
    private boolean useLocalCache = false;
    private volatile int requestId = 0;
    private boolean documentWasEverOpened = false;
    private String currentName;
    private ReaderPalette palette = ReaderPalette.of(false);
    private final Handler statusHandler = new Handler(Looper.getMainLooper());
    private static final String EXTRA_SWITCH_SESSION = "tg_pdf_switch_session";
    private static final String EXTRA_AUTO_RETRY = "tg_pdf_auto_retry";
    /** Dibaca TG Office: tunggu pembaca lama benar-benar tertutup sebelum membuka PDF baru. */
    public static volatile int liveReaders = 0;
    public static volatile long lastDestroyedAt = 0L;
    /** Halaman terakhir dan jumlah halaman, dibaca TG Office untuk progres di beranda. */
    public static final String EXTRA_START_PAGE = "tg_start_page";
    public static volatile String reportName = null;
    public static volatile int reportPage = 0, reportPages = 0;
    static void report(String name, int page1, int pages) {
        reportName = name; reportPage = page1; reportPages = pages;
    }
    private volatile boolean firstContentSeen = false;
    private boolean nextIsAutoRetry = false;
    private androidx.appcompat.app.AlertDialog stuckDialog;
    private final Runnable hideStatusRunnable = this::hideStatus;

    /* ---------- Pengawas awal-buka (12 detik pertama) ----------
     * Dijalankan di utas terpisah agar tetap hidup walau utas utama tersangkut, dan memakai
     * Handler sendiri (bukan statusHandler) sehingga tidak ikut terhapus oleh showStatus/hideStatus.
     * Bukti utama = evaluator tampilan (cuplikan PixelCopy area baca), sinyal mesin PDF = pendukung. */
    private static final long GUARD_WINDOW_MS = 12000L;
    private static final long GUARD_SAMPLE_MS = 2000L;
    private static final long STALL_MS = 8000L;
    private android.os.HandlerThread guardThread;
    private Handler guardHandler;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private volatile int guardGen = 0;
    private volatile long guardStart = 0L;
    private volatile boolean guardActive = false, contentConfirmed = false, guardDeferred = false;
    private volatile boolean resumedNow = false;
    private volatile long beatSentAt = 0L, beatOkAt = 0L;
    private volatile int[] areaRect = null;
    private volatile Uri guardUri = null;
    private volatile int guardPage = 0;
    private volatile String guardName = null;
    private int lastVerdict = 0, prevVerdict = 0; // 0 tak diketahui, 1 kosong, 2 berisi
    private int lastHash = 0, prevHash = 0, lastCenter = 0, prevCenter = 0;
    private int tapCount = 0;
    private long firstTapAt = 0L;
    private View softBar;
    private boolean layoutHooked = false;
    private static final String EXTRA_CACHE_MODE = "tg_pdf_cache_mode";
    private static final long MAX_CACHE_SIZE = 450L * 1024L * 1024L;

    private final ActivityResultLauncher<String[]> picker = registerForActivityResult(
        new ActivityResultContracts.OpenDocument(), uri -> {
            if (uri == null) return;
            boolean persistent = false;
            try {
                getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
                persistent = true;
            } catch (SecurityException ignored) {
                // Some providers issue read-only temporary access.
            }
            if (persistent) {
                getSharedPreferences(PREFS, MODE_PRIVATE)
                    .edit().putString(KEY_LAST_URI, uri.toString()).apply();
            }
            if (documentWasEverOpened) {
                launchFreshReaderSession(uri, "PICKER_SWITCH");
            } else {
                openPdf(uri);
            }
        }
    );

    @Override
    protected void onCreate(@Nullable Bundle state) {
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        // V0.4.2: avoid AppCompatDelegate dark-mode Activity recreation while
        // a PDF is open. A stable host theme is recolored in place below.
        AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_NO);
        super.onCreate(state);
        liveReaders++;

        ui = ActivityMainBinding.inflate(getLayoutInflater());
        setContentView(ui.getRoot());
        features = new ViewerFeatures(this, ui);
        ViewCompat.setOnApplyWindowInsetsListener(ui.getRoot(), (view, insets) -> {
            androidx.core.graphics.Insets safe =
                insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            return insets;
        });

        pdfFragment = (LabPdfFragment) getSupportFragmentManager().findFragmentByTag("pdf_lab");
        // Do not inflate AndroidX viewer until a PDF is actually opened.
        // This keeps the start screen safe even if a renderer is incompatible.

        // Retain the known-good direct engine path; cache/retry Lab controls removed.
        useLocalCache = false;
        ui.diagnosticPanel.setVisibility(View.GONE);
        ui.diagnosticsText.setVisibility(View.GONE);
        ui.diagnosticsText.setTextIsSelectable(true);
        ui.deviceText.setText(deviceInfo());
        DiagLog.init(this);
        diagnostic("APP_START reader session=" + System.identityHashCode(this)
            + " switched=" + getIntent().getBooleanExtra(EXTRA_SWITCH_SESSION, false)
            + " " + deviceInfo());
        diagnostic("ENGINE AndroidX pdf-viewer-fragment 1.0.0-beta01");
        diagnostic("Catatan: onLoadDocumentSuccess bukan bukti bitmap halaman berhasil dirender");

        ui.logButton.setOnClickListener(v -> {
            boolean visible = ui.diagnosticsText.getVisibility() == View.VISIBLE;
            ui.diagnosticsText.setVisibility(visible ? View.GONE : View.VISIBLE);
            diagnostic("LOG_VIEW " + memoryInfo());
        });
        ui.copyLogButton.setOnClickListener(v -> {
            ClipboardManager cb = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
            if (cb != null) {
                cb.setPrimaryClip(ClipData.newPlainText("TG PDF LAB Log", diagnosticLog.toString()));
                Toast.makeText(this, "Log disalin", Toast.LENGTH_SHORT).show();
            }
        });
        ui.sendLogButton.setOnClickListener(v -> {
            diagnostic("LOG_SHARE " + memoryInfo());
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_TEXT, DiagLog.read(this));
            startActivity(Intent.createChooser(send, "Bagikan log diagnostik"));
        });
        ui.openButton.setOnClickListener(v -> picker.launch(new String[]{"application/pdf"}));
        ui.fallbackButton.setOnClickListener(v -> openWithAnotherApp());
        ui.themeQuick.setOnClickListener(v -> {
            boolean dark = !prefs.getBoolean(KEY_DARK, false);
            prefs.edit().putBoolean(KEY_DARK, dark).apply(); // pilihan tema disimpan
            applyReaderPalette(dark); // no Activity/Fragment recreation
            diagnostic("THEME_UI_ONLY " + (dark ? "DARK" : "LIGHT")
                + " session=" + System.identityHashCode(this)
                + " pages=" + (features == null ? 0 : features.pageCount()));
        });
        // Default terang; pilihan pengguna tersimpan.
        applyReaderPalette(prefs.getBoolean(KEY_DARK, false));
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (features != null && features.handleBack()) return;
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
        // Enter immersive UI immediately when launched in landscape; do not reload PDF.
        features.onWindowResized();

        Uri incoming = incomingPdf(getIntent());
        if (incoming == null && state != null) {
            String saved = state.getString(STATE_URI);
            if (saved != null && !saved.isEmpty()) incoming = Uri.parse(saved);
        }
        if (incoming == null) {
            String last = prefs.getString(KEY_LAST_URI, null);
            if (last != null) incoming = Uri.parse(last);
        }
        if (incoming != null) openPdf(incoming);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri incoming = incomingPdf(intent);
        if (incoming != null) {
            if (documentWasEverOpened) launchFreshReaderSession(incoming, "NEW_INTENT");
            else openPdf(incoming);
        }
    }

    @Nullable
    private Uri incomingPdf(@Nullable Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        if (!Intent.ACTION_SEND.equals(intent.getAction())
            || !"application/pdf".equals(intent.getType())) return null;

        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        @SuppressWarnings("deprecation")
        Uri result = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return result;
    }

    /**
     * A new Activity session reproduces the known-good cold-open path of V0.3.
     * Do not reuse the old FragmentManager/loader session for the next document.
     * This is an in-app handover: the user does not need to kill or restart the app.
     */
    private void launchFreshReaderSession(@NonNull Uri uri, @NonNull String why) {
        diagnostic("SWITCH_BEGIN reason=" + why
            + " old=" + (currentUri != null)
            + " uri_scheme=" + uri.getScheme()
            + " " + memoryInfo());
        if (features != null) features.persist();
        final Intent next = new Intent(this, MainActivity.class);
        next.setAction(Intent.ACTION_VIEW);
        next.setDataAndType(uri, "application/pdf");
        next.setClipData(ClipData.newUri(getContentResolver(), "PDF", uri));
        next.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        next.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
        next.putExtra(EXTRA_SWITCH_SESSION, true);
        if (nextIsAutoRetry) {
            next.putExtra(EXTRA_AUTO_RETRY, true);
            next.putExtra(EXTRA_START_PAGE, getIntent().getIntExtra(EXTRA_START_PAGE, 0));
        }
        // Keep the stable direct path; no cache mode in V0.4.2.
        try {
            ++requestId; // prevent old cache tasks completing in the wrong session
            startActivity(next);
            finish();
        } catch (RuntimeException error) {
            diagnosticError("SWITCH_ACTIVITY_FAILED", error);
            // Keep the existing reader available if Android refuses the handover.
            Toast.makeText(this, "Ganti PDF gagal: " + error.getClass().getSimpleName(),
                Toast.LENGTH_LONG).show();
        }
    }

    private void openPdf(@NonNull Uri uri) {
        documentWasEverOpened = true;
        features.beforeOpen(uri);
        currentUri = uri;
        int id = ++requestId;
        loadStartedAt = SystemClock.elapsedRealtime();

        String name = readableName(uri);
        currentName = name;
        long bytes = fileSize(uri);
        ui.titleText.setText(name);
        showStatus("Memuat " + name + "…", 0);
        firstContentSeen = false;
        diagnostic(String.format(Locale.US,
            "OPEN_START id=%d mode=%s scheme=%s size_kb=%d persisted=%b after_restart=%b start_page=%d %s",
            id, useLocalCache ? "CACHE" : "DIRECT", uri.getScheme(), bytes < 0 ? -1 : bytes / 1024,
            hasPersistedRead(uri), getIntent().getBooleanExtra(EXTRA_AUTO_RETRY, false),
            getIntent().getIntExtra(EXTRA_START_PAGE, 0), memoryInfo()));
        startGuard("OPEN");
        if (useLocalCache) {
            io.execute(() -> stagePdf(uri, id));
        } else {
            renderPdf(uri, id);
        }
    }

    private void stagePdf(@NonNull Uri uri, int id) {
        File staging = null;
        try {
            File dir = new File(getCacheDir(), "pdf_stage");
            if (!dir.exists() && !dir.mkdirs()) {
                throw new IllegalStateException("Tidak dapat membuat cache PDF");
            }
            staging = new File(dir, "stage-" + SystemClock.elapsedRealtimeNanos() + ".pdf");
            long bytes = 0;
            try (InputStream in = getContentResolver().openInputStream(uri);
                 OutputStream out = new FileOutputStream(staging)) {
                if (in == null) throw new IllegalStateException("Sumber PDF tidak dapat dibaca");
                byte[] buffer = new byte[65536];
                int n;
                while ((n = in.read(buffer)) != -1) {
                    if (id != requestId) {
                        staging.delete();
                        return;
                    }
                    bytes += n;
                    if (bytes > MAX_CACHE_SIZE) {
                        throw new IllegalStateException("File terlalu besar untuk cache (>450MB)");
                    }
                    if (n > 0) out.write(buffer, 0, n);
                }
            }
            if (id != requestId) return;
            final long count = bytes;
            Uri localUri = FileProvider.getUriForFile(
                this, getPackageName() + ".fileprovider", staging);
            runOnUiThread(() -> {
                if (id != requestId || isFinishing() || isDestroyed()) return;
                diagnostic("CACHE_READY bytes=" + count + " copy_ms="
                    + (SystemClock.elapsedRealtime() - loadStartedAt) + " " + memoryInfo());
                renderPdf(localUri, id);
            });
        } catch (Exception e) {
            if (staging != null) staging.delete();
            runOnUiThread(() -> {
                if (id != requestId || isFinishing() || isDestroyed()) return;
                diagnosticError("STAGING_FAILURE", e);
                onPdfLoadFinished(e);
            });
        }
    }

    private void renderPdf(@NonNull Uri readUri, int id) {
        if (id != requestId) return;
        diagnostic("ANDROIDX_SET_DOCUMENT_URI id=" + id + " scheme="
            + readUri.getScheme() + " " + memoryInfo());
        try {
            // V0.4 bug fix: isolate document state by creating a fresh PdfViewerFragment.
            // Previous fragment is detached and its jobs/resources are released by FragmentManager.
            LabPdfFragment next = new LabPdfFragment();
            getSupportFragmentManager().beginTransaction()
                .replace(R.id.pdfContainer, next, "pdf_lab").commitNow();
            pdfFragment = next;
            next.setDocumentUri(readUri);
        } catch (RuntimeException | LinkageError e) {
            diagnosticError("ANDROIDX_START_FAILURE", e);
            onPdfLoadFinished(e);
        }
    }

    void onViewerCreated(LabPdfFragment source, PdfView view) {
        // The new fragment is created synchronously before pdfFragment is assigned;
        // older callbacks are guarded once document loading begins.
        if (features != null) features.onViewerCreated(view);
    }

    void onViewportChanged(LabPdfFragment fragment, int page, int count,
            SparseArray<RectF> rectangles, float zoom) {
        if (fragment == pdfFragment && features != null) {
            features.onViewport(page, rectangles, zoom);
            if (features.pageCount() > 0) guardPage = features.pageNumber();
        }
    }

    void onFirstContentReady(LabPdfFragment fragment) {
        if (fragment == pdfFragment) {
            firstContentSeen = true;
            diagnostic("SIGNAL_FIRST_CONTENT t_ms=" + (SystemClock.elapsedRealtime() - loadStartedAt));
            if (features != null) features.onFirstContentReady();
        }
    }

    void onDocumentReady(LabPdfFragment fragment, PdfDocument document) {
        if (fragment != pdfFragment) return;
        features.onDocumentReady(document);
        onPdfLoadFinished(null);
    }

    void onDocumentError(LabPdfFragment fragment, Throwable error) {
        if (fragment != pdfFragment) return;
        if (autoRetry("LOAD_ERROR")) return;
        stopGuard("LOAD_ERROR");
        onPdfLoadFinished(error);
        showSoftBar("LOAD_ERROR", "PDF tidak dapat dimuat");
    }

    /**
     * Bug ganti PDF (A lalu B gagal, normal lagi setelah aplikasi dibuka ulang):
     * satu kali coba ulang otomatis lewat sesi Activity baru, jalur cold-open yang terbukti stabil.
     */
    private boolean autoRetry(@NonNull String why) {
        if (currentUri == null || getIntent().getBooleanExtra(EXTRA_AUTO_RETRY, false)) return false;
        diagnostic("AUTO_RETRY reason=" + why + " " + memoryInfo());
        nextIsAutoRetry = true;
        launchFreshReaderSession(currentUri, "AUTO_RETRY_" + why);
        return true;
    }

    /* ---------- Pemulihan PDF macet ---------- */
    private void showStuck(@NonNull String why) {
        if (isFinishing() || isDestroyed() || currentUri == null) return;
        if (stuckDialog != null && stuckDialog.isShowing()) return;
        diagnostic("STUCK_DIALOG reason=" + why + " " + memoryInfo());
        hideSoftBar();
        stuckDialog = new androidx.appcompat.app.AlertDialog.Builder(this)
            .setTitle("PDF tidak kunjung terbuka")
            .setMessage("Mesin PDF sedang macet. Coba lagi akan memulai ulang TeGe Office lalu langsung membuka PDF ini di halaman yang sama.")
            .setPositiveButton("Coba lagi", (d, w) -> { diagnostic("USER_RETRY via=dialog"); restartAndReopen(); })
            .create();
        stuckDialog.show();
    }

    private boolean hasPersistedRead(@NonNull Uri uri) {
        try {
            for (android.content.UriPermission p : getContentResolver().getPersistedUriPermissions())
                if (p.isReadPermission() && uri.equals(p.getUri())) return true;
        } catch (Exception ignored) { }
        return false;
    }

    /** Mulai ulang proses aplikasi lalu buka PDF yang sama di halaman terakhir. */
    void restartAndReopen() {
        final Uri uri = currentUri;
        if (uri == null) return;
        final int page = features != null && features.pageCount() > 0
            ? features.pageNumber() : getIntent().getIntExtra(EXTRA_START_PAGE, 0);
        final String name = currentName == null ? "dokumen.pdf" : currentName;
        if (features != null) features.persist();
        showStatus("Memulai ulang TeGe Office…", 0);
        diagnostic("RESTART_PROCESS page=" + page + " " + memoryInfo());
        io.execute(() -> restartNow(uri, page, name));
    }

    /** Boleh dipanggil dari utas mana pun (juga dari pengawas saat utas utama tersangkut). */
    private void restartNow(@NonNull Uri uri, int page, @NonNull String name) {
        {
            Uri target = uri;
            String scheme = uri.getScheme();
            boolean own = uri.getAuthority() != null && uri.getAuthority().startsWith(getPackageName());
            if (!"file".equals(scheme) && !own && !hasPersistedRead(uri)) {
                // Izin baca sementara bisa hilang saat proses mati: pakai salinan lokal.
                try {
                    File dir = new File(getCacheDir(), "pdf-restart");
                    File[] old = dir.listFiles();
                    if (old != null) for (File f : old) f.delete();
                    if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cache");
                    String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                    if (!safe.toLowerCase(Locale.ROOT).endsWith(".pdf")) safe = safe + ".pdf";
                    File out = new File(dir, safe);
                    try (InputStream in = getContentResolver().openInputStream(uri);
                         OutputStream os = new FileOutputStream(out)) {
                        if (in == null) throw new IllegalStateException("stream");
                        byte[] buf = new byte[256 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                    }
                    target = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", out);
                } catch (Exception e) {
                    diagnosticError("RESTART_COPY_FAILED", e);
                }
            }
            final Uri t = target;
            java.util.ArrayList<Intent> next = new java.util.ArrayList<>();
            Intent home = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (home != null && !home.getComponent().getClassName().equals(MainActivity.class.getName())) next.add(home);
            Intent reader = new Intent(this, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setDataAndType(t, "application/pdf")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                .putExtra(EXTRA_START_PAGE, Math.max(0, page))
                .putExtra(EXTRA_AUTO_RETRY, true);
            next.add(reader);
            DiagLog.log(this, "PDF", "RESTART_LAUNCH copied=" + (t != uri));
            RestartActivity.restart(getApplicationContext(), next);
        }
    }

    /** Cetak PDF asli lewat dialog cetak Android (printer Wi-Fi atau Simpan sebagai PDF). */
    void printCurrent() {
        final Uri uri = currentUri;
        if (uri == null) { showStatus("Buka PDF dahulu", 2000); return; }
        android.print.PrintManager pm = (android.print.PrintManager) getSystemService(Context.PRINT_SERVICE);
        if (pm == null) { showStatus("Layanan cetak tidak tersedia", 3000); return; }
        final String job = currentName == null ? "TeGe Office PDF" : currentName;
        android.print.PrintDocumentAdapter adapter = new android.print.PrintDocumentAdapter() {
            @Override public void onLayout(android.print.PrintAttributes oldA, android.print.PrintAttributes newA,
                    android.os.CancellationSignal cancel, LayoutResultCallback cb, Bundle extras) {
                if (cancel.isCanceled()) { cb.onLayoutCancelled(); return; }
                int count = features != null && features.pageCount() > 0 ? features.pageCount()
                    : android.print.PrintDocumentInfo.PAGE_COUNT_UNKNOWN;
                cb.onLayoutFinished(new android.print.PrintDocumentInfo.Builder(job)
                    .setContentType(android.print.PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(count).build(), true);
            }
            @Override public void onWrite(android.print.PageRange[] pages, android.os.ParcelFileDescriptor dest,
                    android.os.CancellationSignal cancel, WriteResultCallback cb) {
                io.execute(() -> {
                    try (InputStream in = getContentResolver().openInputStream(uri);
                         OutputStream os = new FileOutputStream(dest.getFileDescriptor())) {
                        if (in == null) throw new IllegalStateException("stream");
                        byte[] buf = new byte[128 * 1024];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancel.isCanceled()) { runOnUiThread(cb::onWriteCancelled); return; }
                            os.write(buf, 0, n);
                        }
                        runOnUiThread(() -> cb.onWriteFinished(new android.print.PageRange[]{android.print.PageRange.ALL_PAGES}));
                    } catch (Exception e) {
                        diagnosticError("PRINT_WRITE_FAILED", e);
                        runOnUiThread(() -> cb.onWriteFailed("PDF tidak dapat dibaca untuk dicetak"));
                    }
                });
            }
        };
        try { pm.print(job, adapter, null); }
        catch (Exception e) { diagnosticError("PRINT_FAILED", e); showStatus("Cetak gagal dimulai", 3000); }
    }

    void closePdf() {
        if (features != null) features.close();
        ++requestId;
        currentUri = null;
        currentName = null;
        ui.titleText.setText("TG PDF Lab");

        getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_LAST_URI).apply();
        if (pdfFragment != null) {
            try {
                getSupportFragmentManager().beginTransaction().remove(pdfFragment).commitNow();
            } catch (IllegalStateException e) {
                Log.w(TAG, "Cannot remove fragment after state saved", e);
            }
            pdfFragment = null;
        }
        showStatus("PDF ditutup. Ketuk ikon folder untuk membuka dokumen lain.", 3000);
    }

    /** PDF metadata load result; this does not prove rendered pages are visible. */
    void onPdfLoadFinished(@Nullable Throwable error) {
        if (ui == null || isFinishing() || isDestroyed()) return;
        long elapsed = SystemClock.elapsedRealtime() - loadStartedAt;

        if (error == null) {
            hideStatus();
            diagnostic("DOCUMENT_LOAD_SUCCESS elapsed_ms=" + elapsed + " "
                + memoryInfo() + " [render bitmap belum terverifikasi]");
        } else {
            showStatus("PDF gagal dimuat. Pilih dokumen lain.", 6000);
            if (features != null) features.onError();
            diagnosticError("DOCUMENT_LOAD_ERROR elapsed_ms=" + elapsed, error);
            diagnostic("Tekan lama tombol menu untuk panel diagnostik.");
        }
    }

    /**
     * Draw host UI palette directly. AndroidX keeps its existing PdfView,
     * Uri, bitmap tiles, page position, and FragmentManager untouched.
     * Original PDF pages are not recolored.
     */
    private void applyReaderPalette(boolean dark) {
        if (ui == null) return;
        palette = ReaderPalette.of(dark);
        ReaderPalette p = palette;
        ui.readerRoot.setBackgroundColor(p.surface);
        ui.contentArea.setBackgroundColor(p.background);
        ui.pdfContainer.setBackgroundColor(p.background);
        ui.flipbookOverlay.setBackgroundColor(p.background);
        ui.mainToolbar.setBackgroundColor(p.surface);
        ui.diagnosticPanel.setBackgroundColor(p.surface);
        ui.titleText.setTextColor(p.ink);
        ui.deviceText.setTextColor(p.inkMuted);
        ui.diagnosticsText.setTextColor(p.ink);
        ColorStateList ink = ColorStateList.valueOf(p.ink);
        for (View v : new View[]{ui.openButton, ui.searchQuick, ui.themeQuick, ui.soundQuick,
                ui.rotateQuick, ui.fullQuick, ui.shareQuick, ui.menuButton}) {
            ((android.widget.ImageButton) v).setImageTintList(ink);
        }
        ui.themeQuick.setImageResource(dark ? R.drawable.ic_sun : R.drawable.ic_moon);
        ui.themeQuick.setContentDescription(dark ? "Tema terang" : "Tema gelap");
        colorButtons(ui.diagnosticPanel, p.accent, p.onAccent);
        GradientDrawable chip = new GradientDrawable();
        chip.setColor(p.chipBg);
        chip.setCornerRadius(dp(18));
        ui.statusChip.setBackground(chip);
        ui.statusChip.setTextColor(p.chipInk);
        getWindow().setStatusBarColor(p.surface);
        getWindow().setNavigationBarColor(p.background);
        WindowInsetsControllerCompat bars =
            new WindowInsetsControllerCompat(getWindow(), ui.readerRoot);
        bars.setAppearanceLightStatusBars(!dark);
        bars.setAppearanceLightNavigationBars(!dark);
        if (features != null) features.applyPalette(p);
    }

    private void colorButtons(@NonNull View node, int tint, int text) {
        if (node instanceof Button) {
            Button button = (Button) node;
            button.setBackgroundTintList(ColorStateList.valueOf(tint));
            button.setTextColor(text);
        } else if (node instanceof ViewGroup) {
            ViewGroup group = (ViewGroup) node;
            for (int i = 0; i < group.getChildCount(); i++) {
                colorButtons(group.getChildAt(i), tint, text);
            }
        }
    }

    ReaderPalette palette() { return palette; }

    @Nullable String currentName() { return currentName; }

    float dp(float value) { return value * getResources().getDisplayMetrics().density; }

    /** Chip status singkat di atas halaman; durationMs 0 = tetap sampai diganti. */
    void showStatus(@NonNull String text, long durationMs) {
        if (ui == null) return;
        statusHandler.removeCallbacks(hideStatusRunnable);
        ui.statusChip.setText(text);
        if (ui.statusChip.getVisibility() != View.VISIBLE) {
            ui.statusChip.setAlpha(0f);
            ui.statusChip.setVisibility(View.VISIBLE);
        }
        ui.statusChip.animate().cancel();
        ui.statusChip.animate().alpha(1f).setDuration(160).start();
        if (durationMs > 0) statusHandler.postDelayed(hideStatusRunnable, durationMs);
    }

    void hideStatus() {
        if (ui == null || ui.statusChip.getVisibility() != View.VISIBLE) return;
        statusHandler.removeCallbacks(hideStatusRunnable);
        ui.statusChip.animate().cancel();
        ui.statusChip.animate().alpha(0f).setDuration(220)
            .withEndAction(() -> { if (ui != null) ui.statusChip.setVisibility(View.GONE); })
            .start();
    }

    void toggleDiagnostics() {
        boolean show = ui.diagnosticPanel.getVisibility() != View.VISIBLE;
        ui.diagnosticPanel.setVisibility(show ? View.VISIBLE : View.GONE);
        Toast.makeText(this, show ? "Panel diagnostik dibuka" : "Panel diagnostik ditutup",
            Toast.LENGTH_SHORT).show();
    }

    void toggleSearch() {
        if (pdfFragment == null || currentUri == null) {
            showStatus("Buka PDF dahulu", 2000);
            return;
        }
        pdfFragment.setTextSearchActive(!pdfFragment.isTextSearchActive());
    }

    boolean hasDocument() { return currentUri != null; }

    @Override
    public void onConfigurationChanged(@NonNull Configuration config) {
        super.onConfigurationChanged(config);
        if (ui == null) return;
        String direction = config.orientation == Configuration.ORIENTATION_LANDSCAPE
            ? "LANDSCAPE" : "PORTRAIT";
        diagnostic("CONFIG_CHANGED orientation=" + direction
            + " session=" + System.identityHashCode(this)
            + " uri_present=" + (currentUri != null)
            + " " + memoryInfo());
        // Do not call openPdf() or setDocumentUri(): preserve loaded bitmap state.
        ui.readerRoot.post(() -> {
            if (ui == null || isFinishing() || isDestroyed()) return;
            ui.readerRoot.requestLayout();
            if (features != null) features.onWindowResized();
            diagnostic("VIEWER_RESIZED orientation=" + direction);
        });
    }

    private String deviceInfo() {
        int ext = -1;
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                ext = SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R);
            } catch (RuntimeException e) {
                Log.w(TAG, "Extension query failed", e);
            }
        }
        return "Android " + Build.VERSION.RELEASE + " / API " + Build.VERSION.SDK_INT
            + " / R Extension " + (ext < 0 ? "N/A" : ext)
            + " / Heap Max " + (Runtime.getRuntime().maxMemory() / 1048576L) + " MiB";
    }

    private String memoryInfo() {
        Runtime rt = Runtime.getRuntime();
        long heap = (rt.totalMemory() - rt.freeMemory()) / 1048576L;
        long pss = -1;
        try { pss = Debug.getPss() / 1024L; } catch (RuntimeException ignored) {}
        return "heap=" + heap + "MiB PSS=" + pss + "MiB";
    }

    private void diagnostic(@NonNull String message) {
        String line = "[" + SystemClock.elapsedRealtime() + "] " + message;
        Log.i(TAG, line);
        DiagLog.log(this, "PDF", message);
        if (diagnosticLog.length() > 24000) diagnosticLog.delete(0, 8000);
        diagnosticLog.append(line).append('\n');
        if (ui != null && ui.diagnosticsText.getVisibility() == View.VISIBLE) {
            ui.diagnosticsText.setText(diagnosticLog.toString());
        }
    }

    private void diagnosticError(String message, Throwable error) {
        diagnostic(message + " " + error.getClass().getName() + ": "
            + error.getMessage() + " " + memoryInfo());
        Log.e(TAG, message, error);
        StackTraceElement[] stack = error.getStackTrace();
        for (int i = 0; i < Math.min(6, stack.length); i++) {
            diagnostic(" at " + stack[i].toString());
        }
    }

    private long fileSize(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(uri,
                new String[]{OpenableColumns.SIZE}, null, null, null)) {
                if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getLong(0);
            } catch (Exception ignored) {}
        }
        return -1L;
    }

    @NonNull
    private String readableName(@Nullable Uri uri) {
        if (uri == null) return "belum ada file";
        if ("content".equals(uri.getScheme())) {
            try (Cursor c = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst()) return c.getString(0);
            } catch (Exception ignored) {
            }
        }
        String last = uri.getLastPathSegment();
        return last != null ? last : "Dokumen PDF";
    }

    /** Fallback uses an installed PDF viewer, avoiding PDF.js and WebView. */
    private void openWithAnotherApp() {
        if (currentUri == null) {
            Toast.makeText(this, "Pilih PDF terlebih dahulu", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(currentUri, "application/pdf");
        view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        view.setClipData(ClipData.newUri(getContentResolver(), "PDF", currentUri));
        try {
            startActivity(Intent.createChooser(view, "Buka PDF dengan aplikasi lain"));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Belum ada aplikasi PDF lain di perangkat",
                Toast.LENGTH_LONG).show();
        }
    }

    void shareCurrent() {
        if (currentUri == null) {
            showStatus("Buka PDF dahulu", 2000);
            return;
        }
        Uri source = currentUri;
        showStatus("Menyiapkan PDF untuk dibagikan…", 0);
        io.execute(() -> {
            try {
                File dir = new File(getCacheDir(), "shares");
                if (!dir.exists() && !dir.mkdirs()) {
                    throw new IllegalStateException("Cache share tidak tersedia");
                }
                File dest = new File(dir, "tg-pdf-lab-share.pdf");
                try (InputStream in = getContentResolver().openInputStream(source);
                     OutputStream out = new FileOutputStream(dest)) {
                    if (in == null) throw new IllegalStateException("File tidak dapat dibaca");
                    byte[] buffer = new byte[65536];
                    int n;
                    while ((n = in.read(buffer)) != -1) out.write(buffer, 0, n);
                }
                Uri shared = FileProvider.getUriForFile(
                    this, getPackageName() + ".fileprovider", dest);
                runOnUiThread(() -> {
                    hideStatus();
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("application/pdf");
                    send.putExtra(Intent.EXTRA_STREAM, shared);
                    send.setClipData(ClipData.newUri(getContentResolver(), "PDF", shared));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try {
                        startActivity(Intent.createChooser(send, "Bagikan PDF"));
                    } catch (ActivityNotFoundException e) {
                        Toast.makeText(this, "Aplikasi penerima tidak ditemukan",
                            Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "PDF_SHARE_FAILED", e);
                runOnUiThread(() -> {
                    showStatus("Bagikan gagal, pilih ulang sumber PDF.", 4000);
                    Toast.makeText(this, "Share gagal: " + e.getClass().getSimpleName(),
                        Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    @Override
    public boolean dispatchTouchEvent(android.view.MotionEvent ev) {
        // Cadangan manual: ketuk 5x dalam 3 detik selama PDF belum terbukti tampil.
        // Hanya bila sudah menunggu >4 dtk dan halaman belum terlihat (kosong/tak terbaca): tidak ada alarm palsu.
        if (!contentConfirmed && currentUri != null && softBar == null
                && SystemClock.elapsedRealtime() - guardStart >= 4000L
                && (lastVerdict == 1 || !firstContentSeen)
                && (stuckDialog == null || !stuckDialog.isShowing())
                && ev.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) {
            long now = SystemClock.elapsedRealtime();
            if (now - firstTapAt > 3000L) { firstTapAt = now; tapCount = 0; }
            if (++tapCount >= 5) {
                tapCount = 0;
                diagnostic("TAP5 t_ms=" + (now - loadStartedAt) + " signal=" + firstContentSeen
                    + " verdict=" + lastVerdict);
                showSoftBar("TAP5", "Halaman belum merespons");
            }
        }
        return super.dispatchTouchEvent(ev);
    }

    @Override protected void onResume() { super.onResume(); resumedNow = true; }
    @Override protected void onPause() { resumedNow = false; super.onPause(); }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && guardDeferred && !contentConfirmed && currentUri != null) {
            guardDeferred = false;
            diagnostic("GUARD_RESUME_AFTER_FOCUS");
            startGuard("REFOCUS");
        }
    }

    /* ================= Pengawas + evaluator tampilan ================= */

    private void startGuard(@NonNull String why) {
        if (guardThread == null) {
            guardThread = new android.os.HandlerThread("tg-pdf-guard");
            guardThread.start();
            guardHandler = new Handler(guardThread.getLooper());
        }
        final int gen = ++guardGen;
        guardStart = SystemClock.elapsedRealtime();
        guardActive = true;
        contentConfirmed = false;
        lastVerdict = prevVerdict = 0;
        lastHash = prevHash = lastCenter = prevCenter = 0;
        beatSentAt = beatOkAt = 0L;
        guardUri = currentUri;
        guardName = currentName;
        guardPage = getIntent().getIntExtra(EXTRA_START_PAGE, 0);
        updateAreaRect();
        if (!layoutHooked) {
            layoutHooked = true;
            ui.pdfContainer.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> updateAreaRect());
        }
        diagnostic("GUARD_START why=" + why + " window_ms=" + GUARD_WINDOW_MS);
        guardHandler.removeCallbacksAndMessages(null);
        guardHandler.postDelayed(() -> guardTick(gen), 1000L);
    }

    private void stopGuard(@NonNull String why) {
        if (!guardActive) return;
        guardActive = false;
        ++guardGen;
        if (guardHandler != null) guardHandler.removeCallbacksAndMessages(null);
        DiagLog.log(this, "PDF", "GUARD_STOP why=" + why + " t_ms=" + (SystemClock.elapsedRealtime() - guardStart));
    }

    private void updateAreaRect() {
        if (ui == null) return;
        int[] loc = new int[2];
        ui.pdfContainer.getLocationInWindow(loc);
        int w = ui.pdfContainer.getWidth(), h = ui.pdfContainer.getHeight();
        if (w > 0 && h > 0) areaRect = new int[]{loc[0], loc[1], loc[0] + w, loc[1] + h};
    }

    /** Detak tiap 1 detik (utas pengawas). */
    private void guardTick(final int gen) {
        if (gen != guardGen || !guardActive) return;
        long now = SystemClock.elapsedRealtime();
        long t = now - guardStart;
        // 1) Detak jantung utas utama.
        if (beatSentAt > beatOkAt && now - beatSentAt > STALL_MS) {
            onMainStall(now - beatSentAt);
            return;
        }
        if (beatOkAt >= beatSentAt) {
            final long sent = now;
            beatSentAt = sent;
            uiHandler.post(() -> beatOkAt = Math.max(beatOkAt, sent));
        }
        // 2) Cuplikan tampilan tiap 2 detik.
        if (t >= GUARD_SAMPLE_MS && (t / 1000L) % (GUARD_SAMPLE_MS / 1000L) == 0) sample(gen, t);
        else if (t > GUARD_WINDOW_MS + 1500L && beatOkAt >= beatSentAt) { decide(gen); return; }
        guardHandler.postDelayed(() -> guardTick(gen), 1000L);
    }

    private void onMainStall(long stalledMs) {
        guardActive = false;
        DiagLog.log(this, "PDF", "GUARD_MAIN_STALL stalled_ms=" + stalledMs + " signal=" + firstContentSeen
            + " verdict=" + lastVerdict + " " + DiagLog.memory(this));
        Uri u = guardUri;
        if (u == null) return;
        if (getIntent().getBooleanExtra(EXTRA_AUTO_RETRY, false)) {
            DiagLog.log(this, "PDF", "GUARD_MAIN_STALL_NO_LOOP (sudah dimulai ulang sekali)");
            return;
        }
        restartNow(u, guardPage, guardName == null ? "dokumen.pdf" : guardName);
    }

    private void sample(final int gen, final long t) {
        final int[] r = areaRect;
        if (r == null || !resumedNow || Build.VERSION.SDK_INT < 26) { record(gen, t, 0, 0, 0, "no_window"); return; }
        try {
            final android.graphics.Bitmap bmp = android.graphics.Bitmap.createBitmap(180, 320,
                android.graphics.Bitmap.Config.ARGB_8888);
            android.view.PixelCopy.request(getWindow(), new android.graphics.Rect(r[0], r[1], r[2], r[3]), bmp,
                result -> {
                    if (result != android.view.PixelCopy.SUCCESS) { record(gen, t, 0, 0, 0, "copy_" + result); }
                    else analyze(gen, t, bmp);
                    bmp.recycle();
                }, guardHandler);
        } catch (Throwable e) {
            record(gen, t, 0, 0, 0, "copy_err_" + e.getClass().getSimpleName());
        }
    }

    /**
     * Evaluator tampilan: teks/gambar menghasilkan banyak transisi terang-gelap per baris/kolom,
     * sedangkan layar kosong atau kotak halaman kosong (placeholder) hanya 0–2 transisi.
     * Pita atas (chip status), bawah (navigasi) dan kotak tengah (indikator memuat) diabaikan.
     */
    private void analyze(int gen, long t, android.graphics.Bitmap b) {
        int w = b.getWidth(), h = b.getHeight();
        int[] px = new int[w * h];
        b.getPixels(px, 0, w, 0, 0, w, h);
        int[] lum = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int c = px[i];
            lum[i] = (((c >> 16) & 255) * 30 + ((c >> 8) & 255) * 59 + (c & 255) * 11) / 100;
        }
        int y0 = h * 15 / 100, y1 = h * 85 / 100;
        int mx0 = w * 30 / 100, mx1 = w * 70 / 100, my0 = h * 35 / 100, my1 = h * 65 / 100;
        int busyRows = 0, rows = 0, busyCols = 0, cols = 0, hash = 17, center = 17;
        for (int y = y0; y < y1; y++) {
            int tr = 0, prev = 0;
            for (int x = 0; x < w - 1; x++) {
                int i = y * w + x;
                boolean mid = x >= mx0 && x <= mx1 && y >= my0 && y <= my1;
                if (mid) { prev = 0; if ((x & 3) == 0 && (y & 3) == 0) center = center * 31 + (lum[i] >> 4); continue; }
                int d = lum[i + 1] - lum[i], sg = d > 16 ? 1 : d < -16 ? -1 : 0;
                if (sg != 0 && sg != prev) tr++; // tepi blur berurutan searah = satu transisi
                prev = sg;
                if ((x & 7) == 0 && (y & 7) == 0) hash = hash * 31 + (lum[i] >> 4);
            }
            rows++;
            if (tr >= 4) busyRows++;
        }
        for (int x = 0; x < w; x++) {
            int tr = 0, prev = 0;
            for (int y = y0; y < y1 - 1; y++) {
                if (x >= mx0 && x <= mx1 && y >= my0 && y <= my1) { prev = 0; continue; }
                int i = y * w + x;
                int d = lum[i + w] - lum[i], sg = d > 16 ? 1 : d < -16 ? -1 : 0;
                if (sg != 0 && sg != prev) tr++;
                prev = sg;
            }
            cols++;
            if (tr >= 4) busyCols++;
        }
        float ratio = (busyRows + busyCols) * 100f / Math.max(1, rows + cols);
        int verdict = ratio >= 6f ? 2 : 1;
        record(gen, t, verdict, hash, center, String.format(Locale.US,
            "detail=%.1f%% rows=%d/%d cols=%d/%d", ratio, busyRows, rows, busyCols, cols));
    }

    private void record(int gen, long t, int verdict, int hash, int center, String note) {
        if (gen != guardGen) return;
        prevVerdict = lastVerdict; prevHash = lastHash; prevCenter = lastCenter;
        lastVerdict = verdict; lastHash = hash; lastCenter = center;
        boolean sig = firstContentSeen;
        DiagLog.log(this, "PDF", "GUARD_SAMPLE t_ms=" + t + " verdict="
            + (verdict == 2 ? "BERISI" : verdict == 1 ? "KOSONG" : "TAK_DIKETAHUI") + " " + note
            + " signal=" + sig + " same=" + (hash == prevHash) + " center_same=" + (center == prevCenter));
        if (verdict == 2 && sig) {
            confirmContent("SAMPLE");
        }
    }

    private void confirmContent(String why) {
        if (contentConfirmed) return;
        contentConfirmed = true;
        stopGuard("CONTENT_OK_" + why);
        uiHandler.post(() -> {
            hideSoftBar();
            if (stuckDialog != null && stuckDialog.isShowing()) stuckDialog.dismiss();
            if (features != null) features.onContentConfirmed();
        });
    }

    /** Keputusan akhir setelah jendela 12 detik (utas pengawas, lalu tindakan di utas utama). */
    private void decide(final int gen) {
        if (gen != guardGen) return;
        final boolean sig = firstContentSeen;
        final boolean twoBlank = lastVerdict == 1 && prevVerdict == 1;
        final boolean frozen = lastHash == prevHash && lastCenter == prevCenter;
        final String level;
        if (sig && lastVerdict != 1) level = "OK";                 // sinyal siap, layar tidak kosong / tak terukur
        else if (!sig && twoBlank && frozen) level = "YAKIN";      // kosong, diam, tanpa sinyal
        else level = "RAGU";
        uiHandler.post(() -> {
            if (gen != guardGen || isFinishing() || isDestroyed() || currentUri == null) return;
            diagnostic("GUARD_DECIDE level=" + level + " signal=" + sig + " last=" + lastVerdict
                + " prev=" + prevVerdict + " frozen=" + frozen + " focus=" + hasWindowFocus() + " " + memoryInfo());
            if ("OK".equals(level)) { confirmContent("SIGNAL"); return; }
            if (!hasWindowFocus()) {
                // Ada jendela lain di atas (mis. dialog kata sandi PDF): tunda, ulangi saat kembali fokus.
                guardActive = false;
                guardDeferred = true;
                diagnostic("GUARD_DEFER no_focus");
                return;
            }
            guardActive = false;
            if ("YAKIN".equals(level)) showStuck("GUARD_YAKIN");
            else showSoftBar("GUARD_RAGU", "Halaman belum merespons");
        });
    }

    /** Notifikasi ringan di bawah: pesan + Muat ulang | Kembali, hilang sendiri. */
    private void showSoftBar(@NonNull String why, @NonNull String text) {
        if (ui == null || isFinishing() || isDestroyed()) return;
        if (stuckDialog != null && stuckDialog.isShowing()) return;
        hideSoftBar();
        diagnostic("SOFT_BAR reason=" + why);
        ReaderPalette p = palette;
        android.widget.LinearLayout bar = new android.widget.LinearLayout(this);
        bar.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        bar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        int pad = Math.round(dp(14));
        bar.setPadding(pad, Math.round(dp(6)), Math.round(dp(6)), Math.round(dp(6)));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(p.ink);
        bg.setCornerRadius(dp(14));
        bar.setBackground(bg);
        bar.setElevation(dp(10));
        android.widget.TextView msg = new android.widget.TextView(this);
        msg.setText(text);
        msg.setTextColor(p.surface);
        msg.setTextSize(14);
        bar.addView(msg, new android.widget.LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bar.addView(barButton("Muat ulang", p, v -> { diagnostic("USER_RETRY via=" + why); hideSoftBar(); restartAndReopen(); }));
        bar.addView(barButton("Kembali", p, v -> {
            diagnostic("USER_BACK via=" + why);
            hideSoftBar();
            stopGuard("USER_BACK");
            if (isTaskRoot()) closePdf(); else finish();
        }));
        android.widget.FrameLayout.LayoutParams lp = new android.widget.FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.Gravity.BOTTOM);
        int m = Math.round(dp(12));
        lp.setMargins(m, m, m, Math.round(dp(18)));
        ui.contentArea.addView(bar, lp);
        softBar = bar;
        bar.setAlpha(0f);
        bar.animate().alpha(1f).setDuration(160).start();
        final View mine = bar;
        uiHandler.postDelayed(() -> { if (softBar == mine) hideSoftBar(); }, 10000L);
    }

    private android.widget.TextView barButton(String label, ReaderPalette p, View.OnClickListener l) {
        android.widget.TextView b = new android.widget.TextView(this);
        b.setText(label);
        b.setTextColor(p.dark ? 0xFF1557B5 : 0xFF7DB2FF);
        b.setTextSize(14);
        b.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        int ph = Math.round(dp(12)), pv = Math.round(dp(10));
        b.setPadding(ph, pv, ph, pv);
        b.setOnClickListener(l);
        return b;
    }

    private void hideSoftBar() {
        if (softBar == null || ui == null) { softBar = null; return; }
        View v = softBar;
        softBar = null;
        ui.contentArea.removeView(v);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle out) {
        if (currentUri != null) out.putString(STATE_URI, currentUri.toString());
        super.onSaveInstanceState(out);
    }

    @Override
    protected void onDestroy() {
        if (features != null) { features.persist(); features.close(); }
        ++requestId;
        statusHandler.removeCallbacksAndMessages(null);
        uiHandler.removeCallbacksAndMessages(null);
        ++guardGen;
        guardActive = false;
        if (guardThread != null) guardThread.quitSafely();
        io.shutdown();
        liveReaders = Math.max(0, liveReaders - 1);
        lastDestroyedAt = SystemClock.elapsedRealtime();
        super.onDestroy();
    }
}
