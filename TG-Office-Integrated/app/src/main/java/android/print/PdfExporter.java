package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import java.io.File;

/**
 * Menulis isi WebView ke berkas PDF tanpa dialog cetak.
 * Berada di paket android.print karena pemanggil balik layout/tulis milik Android
 * hanya bisa diturunkan dari paket tersebut.
 */
public final class PdfExporter {
    public interface Done { void onDone(boolean ok); }

    private PdfExporter() {}

    public static void export(final PrintDocumentAdapter adapter, PrintAttributes attrs,
                              final File out, final Done done) {
        final ParcelFileDescriptor fd;
        try {
            fd = ParcelFileDescriptor.open(out, ParcelFileDescriptor.MODE_READ_WRITE
                | ParcelFileDescriptor.MODE_CREATE | ParcelFileDescriptor.MODE_TRUNCATE);
        } catch (Exception e) {
            done.onDone(false);
            return;
        }
        adapter.onStart();
        adapter.onLayout(null, attrs, new CancellationSignal(),
            new PrintDocumentAdapter.LayoutResultCallback() {
                @Override public void onLayoutFinished(PrintDocumentInfo info, boolean changed) {
                    adapter.onWrite(new PageRange[]{PageRange.ALL_PAGES}, fd,
                        new CancellationSignal(), new PrintDocumentAdapter.WriteResultCallback() {
                            @Override public void onWriteFinished(PageRange[] pages) {
                                finish(adapter, fd, done, true);
                            }
                            @Override public void onWriteFailed(CharSequence error) {
                                finish(adapter, fd, done, false);
                            }
                            @Override public void onWriteCancelled() {
                                finish(adapter, fd, done, false);
                            }
                        });
                }
                @Override public void onLayoutFailed(CharSequence error) {
                    finish(adapter, fd, done, false);
                }
                @Override public void onLayoutCancelled() {
                    finish(adapter, fd, done, false);
                }
            }, null);
    }

    private static void finish(PrintDocumentAdapter adapter, ParcelFileDescriptor fd,
                               Done done, boolean ok) {
        try { fd.close(); } catch (Exception ignored) {}
        try { adapter.onFinish(); } catch (Exception ignored) {}
        done.onDone(ok);
    }
}
