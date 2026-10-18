package com.totogutomo.tgpdflab;

import android.graphics.Color;

/** Warna UI pembaca. Halaman PDF asli tidak pernah diwarnai ulang. */
final class ReaderPalette {
    final boolean dark;
    final int background;   // area di sekitar halaman PDF
    final int surface;      // toolbar
    final int surfaceAlt;   // popup, kartu thumbnail
    final int ink;          // ikon dan teks utama
    final int inkMuted;     // teks sekunder
    final int accent;
    final int onAccent;
    final int navBg;        // navigasi melayang (sedikit transparan)
    final int chipBg;
    final int chipInk;
    final int divider;
    final int progress;
    final int star = Color.parseColor("#F2A900");

    private ReaderPalette(boolean dark) {
        this.dark = dark;
        if (dark) {
            background = Color.parseColor("#0E151E");
            surface = Color.parseColor("#172231");
            surfaceAlt = Color.parseColor("#1F2C3E");
            ink = Color.parseColor("#EEF3FA");
            inkMuted = Color.parseColor("#A9B8CB");
            accent = Color.parseColor("#7DB2FF");
            onAccent = Color.parseColor("#0B1A2E");
            navBg = Color.parseColor("#EB1F2C3E");
            chipBg = Color.parseColor("#F0EEF3FA");
            chipInk = Color.parseColor("#13202F");
            divider = Color.parseColor("#33465E");
            progress = Color.parseColor("#7DB2FF");
        } else {
            background = Color.parseColor("#E6ECF4");
            surface = Color.parseColor("#FFFFFF");
            surfaceAlt = Color.parseColor("#FFFFFF");
            ink = Color.parseColor("#14243A");
            inkMuted = Color.parseColor("#56677E");
            accent = Color.parseColor("#1557B5");
            onAccent = Color.WHITE;
            navBg = Color.parseColor("#F2FFFFFF");
            chipBg = Color.parseColor("#EB14243A");
            chipInk = Color.WHITE;
            divider = Color.parseColor("#D3DCE8");
            progress = Color.parseColor("#1557B5");
        }
    }

    static ReaderPalette of(boolean dark) { return new ReaderPalette(dark); }
}
