package com.totogutomo.tgpdflab;

import android.util.Log;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.pdf.ExperimentalPdfApi;
import androidx.pdf.PdfDocument;
import androidx.pdf.view.PdfView;
import androidx.pdf.viewer.fragment.PdfViewerFragment;

import java.lang.reflect.Method;

/**
 * Keep AndroidX in charge of displaying PDF content, scrolling and zoom.
 * Every document switch gets a fresh fragment (isolates stale state from V0.3).
 */
public final class LabPdfFragment extends PdfViewerFragment {
    @Override
    @OptIn(markerClass = ExperimentalPdfApi.class)
    public void onPdfViewCreated(@NonNull PdfView view) {
        super.onPdfViewCreated(view);
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).onViewerCreated(this, view);
        }
        view.addOnViewportChangedListener((page, count, rectangles, zoom) -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).onViewportChanged(this,
                    page, count, rectangles, zoom);
            }
        });
        view.addOnFirstContentLoadListener(() -> {
            if (getActivity() instanceof MainActivity) {
                ((MainActivity) getActivity()).onFirstContentReady(this);
            }
        });
        hideEditButton();
        View root = getView();
        if (root != null) {
            root.getViewTreeObserver().addOnGlobalLayoutListener(() -> hideFloatingButtons(root));
        }
    }

    @Override
    public void onLoadDocumentSuccess(@NonNull PdfDocument document) {
        super.onLoadDocumentSuccess(document);
        hideEditButton();
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).onDocumentReady(this, document);
        }
    }

    @Override
    public void onLoadDocumentError(@NonNull Throwable error) {
        super.onLoadDocumentError(error);
        if (getActivity() instanceof MainActivity) {
            ((MainActivity) getActivity()).onDocumentError(this, error);
        }
    }

    @Override
    public void onRequestImmersiveMode(boolean entering) {
        super.onRequestImmersiveMode(entering);
        // Host controls its own toolbar, not AndroidX' internal toolbox.
        hideEditButton();
    }

    /**
     * Tombol pensil (edit/anotasi) bawaan AndroidX tidak dipakai di Lab ini.
     * API beta01 tidak menjamin setter publik, jadi dicoba lewat refleksi lalu
     * disembunyikan langsung dari hierarki view. Bila keduanya gagal, tombol tetap tampil.
     */
    private void hideEditButton() {
        for (String name : new String[]{"setToolboxVisible", "setIsToolboxVisible"}) {
            try {
                Method m = PdfViewerFragment.class.getMethod(name, boolean.class);
                m.invoke(this, false);
                break;
            } catch (Exception ignored) {
                // tidak tersedia di versi ini
            }
        }
        View root = getView();
        if (root != null) hideFloatingButtons(root);
    }

    private static void hideFloatingButtons(View node) {
        try {
            String cls = node.getClass().getName();
            if (cls.contains("FloatingActionButton") || cls.endsWith("ToolBoxView")) {
                if (node.getVisibility() != View.GONE) node.setVisibility(View.GONE);
                return;
            }
            if (node instanceof ViewGroup) {
                ViewGroup group = (ViewGroup) node;
                for (int i = 0; i < group.getChildCount(); i++) {
                    hideFloatingButtons(group.getChildAt(i));
                }
            }
        } catch (RuntimeException e) {
            Log.w("TG_PDF_LAB", "HIDE_EDIT_BUTTON_FAILED", e);
        }
    }
}
