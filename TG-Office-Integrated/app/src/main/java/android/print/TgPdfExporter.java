package android.print;

import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * Menulis isi WebView langsung ke berkas PDF tanpa dialog cetak.
 * Berada di paket android.print karena pembuat LayoutResultCallback / WriteResultCallback
 * hanya dapat diakses dari paket tersebut. Harus dipanggil dari thread utama.
 */
public final class TgPdfExporter {
    public interface Listener {
        void onDone(File file);
        void onFail(String reason);
    }

    private TgPdfExporter() {}

    public static void export(final PrintDocumentAdapter adapter, final PrintAttributes attrs,
                              final File out, final Listener listener) {
        adapter.onStart();
        adapter.onLayout(null, attrs, new CancellationSignal(), new PrintDocumentAdapter.LayoutResultCallback() {
            @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                final ParcelFileDescriptor fd;
                try {
                    fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_READ_WRITE
                        | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
                } catch (Exception e) {
                    adapter.onFinish();
                    listener.onFail(String.valueOf(e));
                    return;
                }
                adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, fd, new CancellationSignal(),
                    new PrintDocumentAdapter.WriteResultCallback() {
                        @Override public void onWriteFinished(PageRange[] pages) {
                            closeQuietly(fd);
                            adapter.onFinish();
                            listener.onDone(out);
                        }
                        @Override public void onWriteFailed(CharSequence error) {
                            closeQuietly(fd);
                            adapter.onFinish();
                            listener.onFail(String.valueOf(error));
                        }
                        @Override public void onWriteCancelled() {
                            closeQuietly(fd);
                            adapter.onFinish();
                            listener.onFail("dibatalkan");
                        }
                    });
            }
            @Override public void onLayoutFailed(CharSequence error) {
                adapter.onFinish();
                listener.onFail(String.valueOf(error));
            }
            @Override public void onLayoutCancelled() {
                adapter.onFinish();
                listener.onFail("dibatalkan");
            }
        }, new Bundle());
    }

    private static void closeQuietly(ParcelFileDescriptor fd) {
        try { fd.close(); } catch (Exception ignored) {}
    }
}
