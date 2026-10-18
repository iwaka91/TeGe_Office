package com.totogutomo.tgpdflab;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Process;

import java.util.ArrayList;

/**
 * Pemulai ulang aplikasi (pola "phoenix"): berjalan di proses terpisah, menunggu proses utama
 * mati, lalu membuka lagi beranda + pembaca PDF di halaman yang sama. Dipakai saat mesin PDF macet.
 */
public final class RestartActivity extends Activity {
    private static final String EXTRA_INTENTS = "tg_restart_intents";
    private static final String EXTRA_PID = "tg_restart_pid";

    static void restart(Context ctx, ArrayList<Intent> next) {
        Intent i = new Intent(ctx, RestartActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION)
            .putParcelableArrayListExtra(EXTRA_INTENTS, next)
            .putExtra(EXTRA_PID, Process.myPid());
        ctx.startActivity(i);
        // Proses utama (termasuk mesin PDF yang macet) dihentikan sepenuhnya.
        Runtime.getRuntime().exit(0);
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int pid = getIntent().getIntExtra(EXTRA_PID, -1);
        if (pid > 0 && pid != Process.myPid()) {
            try { Process.killProcess(pid); } catch (Exception ignored) { }
        }
        ArrayList<Intent> next = getIntent().getParcelableArrayListExtra(EXTRA_INTENTS);
        if (next != null && !next.isEmpty()) {
            next.get(0).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            try { startActivities(next.toArray(new Intent[0])); } catch (Exception ignored) { }
        }
        finish();
        overridePendingTransition(0, 0);
        Runtime.getRuntime().exit(0);
    }
}
