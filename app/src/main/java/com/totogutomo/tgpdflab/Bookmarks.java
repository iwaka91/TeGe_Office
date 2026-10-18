package com.totogutomo.tgpdflab;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Bookmark halaman per dokumen, disimpan di perangkat (SharedPreferences). */
final class Bookmarks {
    private final SharedPreferences prefs;
    private final String key;
    private final Set<Integer> pages = new HashSet<>();

    Bookmarks(Context context, Uri uri) {
        prefs = context.getSharedPreferences("lab_prefs", Context.MODE_PRIVATE);
        key = "bm_v1_" + uri;
        Set<String> stored = prefs.getStringSet(key, null);
        if (stored != null) {
            for (String s : stored) {
                try { pages.add(Integer.parseInt(s)); } catch (NumberFormatException ignored) {}
            }
        }
    }

    boolean contains(int page) { return pages.contains(page); }

    int count() { return pages.size(); }

    /** @return true bila halaman kini ditandai. */
    boolean toggle(int page) {
        boolean marked;
        if (pages.contains(page)) { pages.remove(page); marked = false; }
        else { pages.add(page); marked = true; }
        Set<String> out = new HashSet<>();
        for (int p : pages) out.add(Integer.toString(p));
        prefs.edit().putStringSet(key, out).apply();
        return marked;
    }

    List<Integer> sorted(int pageCount) {
        List<Integer> list = new ArrayList<>();
        for (int p : pages) if (p >= 0 && p < pageCount) list.add(p);
        Collections.sort(list);
        return list;
    }
}
