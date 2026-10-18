package com.totogutomo.tgoffice;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** Menjaga sesi Presentasi ke Layar Lain tetap hidup saat tombol Home ditekan.
 *  Server tetap milik MainActivity; layanan ini hanya menaikkan prioritas proses dan menampilkan notifikasi. */
public class CastService extends Service {
    static final String CHANNEL="tg-cast";
    static final String ACTION_END="com.totogutomo.tgoffice.END_CAST";
    static final String EXTRA_TEXT="text";
    private static final int ID=7301;

    private static volatile CastService live;
    static void update(Context ctx,String text){
        CastService svc=live;
        if(svc!=null){svc.refresh(text);return;}
        Intent i=new Intent(ctx,CastService.class).putExtra(EXTRA_TEXT,text);
        try{
            if(Build.VERSION.SDK_INT>=26)ctx.startForegroundService(i);else ctx.startService(i);
        }catch(Exception ignored){}
    }
    static void stop(Context ctx){
        try{ctx.stopService(new Intent(ctx,CastService.class));}catch(Exception ignored){}
    }

    @Override public int onStartCommand(Intent intent,int flags,int startId){
        String text=intent==null?null:intent.getStringExtra(EXTRA_TEXT);
        if(text==null||text.isEmpty())text="Menunggu layar tujuan tersambung";
        Notification n=build(text);
        try{
            if(Build.VERSION.SDK_INT>=29)startForeground(ID,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            else startForeground(ID,n);
        }catch(Exception e){stopSelf();}
        return START_NOT_STICKY;
    }
    @Override public void onCreate(){super.onCreate();live=this;}
    @Override public void onDestroy(){if(live==this)live=null;super.onDestroy();}
    void refresh(String text){
        try{NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);if(nm!=null)nm.notify(ID,build(text));}catch(Exception ignored){}
    }
    private Notification build(String text){
        NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if(Build.VERSION.SDK_INT>=26&&nm!=null&&nm.getNotificationChannel(CHANNEL)==null){
            NotificationChannel ch=new NotificationChannel(CHANNEL,"Presentasi ke Layar Lain",NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Sesi presentasi yang sedang berlangsung");ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int fl=PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE;
        Intent open=new Intent(this,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK);
        Intent end=new Intent(this,MainActivity.class).setAction(ACTION_END).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent pOpen=PendingIntent.getActivity(this,1,open,fl);
        PendingIntent pEnd=PendingIntent.getActivity(this,2,end,fl);
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,CHANNEL):new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_cast).setContentTitle("Presentasi ke layar lain berlangsung").setContentText(text)
            .setContentIntent(pOpen).setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
            .addAction(new Notification.Action.Builder(null,"Kembali",pOpen).build())
            .addAction(new Notification.Action.Builder(null,"Akhiri",pEnd).build());
        if(Build.VERSION.SDK_INT>=31)b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }
    /** Aplikasi digeser dari daftar terbaru: sesi berakhir. */
    @Override public void onTaskRemoved(Intent rootIntent){stopSelf();super.onTaskRemoved(rootIntent);}
    @Override public IBinder onBind(Intent intent){return null;}
}
