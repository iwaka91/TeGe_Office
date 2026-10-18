package com.totogutomo.tgpdflab;

import android.content.Context;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Log;

import java.io.Closeable;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.function.BooleanSupplier;

/**
 * Membuka PdfRenderer platform untuk thumbnail dan Flipbook.
 * Utamakan file descriptor langsung (tanpa menyalin PDF). Bila penyedia file
 * tidak memberi descriptor yang dapat di-seek (mis. sebagian penyedia cloud),
 * baru salin ke cache internal sebagai cadangan.
 */
final class PdfSource implements Closeable {
    private static final long MAX_COPY = 450L * 1024L * 1024L;

    final PdfRenderer renderer;
    final boolean direct;
    private final ParcelFileDescriptor descriptor;
    private final File temporary;

    private PdfSource(PdfRenderer renderer, ParcelFileDescriptor descriptor,
            File temporary, boolean direct) {
        this.renderer = renderer;
        this.descriptor = descriptor;
        this.temporary = temporary;
        this.direct = direct;
    }

    static PdfSource open(Context context, Uri uri, String cacheFolder,
            BooleanSupplier cancelled) throws IOException {
        ParcelFileDescriptor fd = null;
        try {
            fd = context.getContentResolver().openFileDescriptor(uri, "r");
            if (fd != null) {
                PdfRenderer renderer = new PdfRenderer(fd);
                return new PdfSource(renderer, fd, null, true);
            }
        } catch (Exception direct) {
            Log.i("TG_PDF_LAB", "PDF_SOURCE_DIRECT_UNAVAILABLE " + direct.getClass().getSimpleName());
            closeQuietly(fd);
        }

        File folder = new File(context.getCacheDir(), cacheFolder);
        if (!folder.exists() && !folder.mkdirs()) throw new IOException("Cache tidak tersedia");
        File copy = File.createTempFile("src-", ".pdf", folder);
        try {
            long total = 0;
            try (InputStream in = context.getContentResolver().openInputStream(uri);
                 FileOutputStream out = new FileOutputStream(copy)) {
                if (in == null) throw new IOException("PDF tidak terbaca");
                byte[] block = new byte[65536];
                int n;
                while ((n = in.read(block)) != -1) {
                    if (cancelled.getAsBoolean()) throw new IOException("Dibatalkan");
                    total += n;
                    if (total > MAX_COPY) throw new IOException("PDF terlalu besar");
                    if (n > 0) out.write(block, 0, n);
                }
            }
            ParcelFileDescriptor copyFd =
                ParcelFileDescriptor.open(copy, ParcelFileDescriptor.MODE_READ_ONLY);
            try {
                return new PdfSource(new PdfRenderer(copyFd), copyFd, copy, false);
            } catch (IOException | RuntimeException e) {
                closeQuietly(copyFd);
                throw e;
            }
        } catch (IOException | RuntimeException e) {
            //noinspection ResultOfMethodCallIgnored
            copy.delete();
            throw e;
        }
    }

    private static void closeQuietly(ParcelFileDescriptor fd) {
        if (fd == null) return;
        try { fd.close(); } catch (Exception ignored) {}
    }

    @Override
    public void close() {
        try { renderer.close(); } catch (Exception ignored) {}
        closeQuietly(descriptor);
        if (temporary != null) {
            //noinspection ResultOfMethodCallIgnored
            temporary.delete();
        }
    }
}
