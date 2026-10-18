package com.totogutomo.tgoffice;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.os.ext.SdkExtensions;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.DocumentsContract;
import android.provider.OpenableColumns;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.FileNotFoundException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * TeGe Office shell. Beranda dan penampil DOCX/XLSX/PPTX berjalan di WebView lokal;
 * PDF dibuka oleh PDF Lab v0.6 (native) bila perangkat mendukung.
 */
public final class MainActivity extends Activity {
    private static final String HOME="https://appassets.androidplatform.net/assets/web/index.html";
    private static final String NATIVE="https://appassets.androidplatform.net/native/current";
    private static final String PDF_READER="com.totogutomo.tgpdflab.MainActivity";
    private static final int PICK=501, NATIVE_PICK=502, SAVE=503;
    private static final long TRANSFER_LIMIT=120L*1024*1024;

    private FrameLayout root;
    private WebView web;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> webFileCallback;
    private Uri documentUri;
    private String documentName,documentMime,documentOrigin="local";
    private long documentSize=-1;
    private boolean pendingOpen, pendingRecord, pageReady, landscapeLocked, immersive;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;

    private final Object transferLock=new Object();
    private String transferId,transferMime;
    private File transferFile,pendingSaveFile;
    private boolean pendingSaveAs;
    private int pendingStartPage;
    private Uri pendingSaveSource;
    private CastServer cast;
    private final Handler ui=new Handler(Looper.getMainLooper());
    private FileOutputStream transferOutput;
    private long transferSize,transferExpected;

    @Override protected void onCreate(Bundle state){
        super.onCreate(state);
        com.totogutomo.tgpdflab.DiagLog.init(this);
        com.totogutomo.tgpdflab.DiagLog.log(this,"APP","APP_START restored="+(state!=null)+" action="+(getIntent()==null?"-":getIntent().getAction())
            +" "+com.totogutomo.tgpdflab.DiagLog.memory(this));
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        applyBars(false);
        root=new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(230,236,244));
        setContentView(root);
        root.setOnApplyWindowInsetsListener((v,insets)->{
            if(Build.VERSION.SDK_INT>=30){
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars());
                v.setPadding(0,bars.top,0,bars.bottom);
            }else{
                v.setPadding(0,insets.getSystemWindowInsetTop(),0,insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        assets=new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/",new WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/native/",this::nativeResponse)
            .build();
        web=new WebView(this);
        root.addView(web,new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT));
        configureWeb();
        cleanOldTransfers();
        handleIncoming(getIntent());
        web.loadUrl(HOME);
    }
    private void configureWeb(){
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccess(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString()+" TGOfficeAndroid/1.0.0");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setBackgroundColor(Color.rgb(230,236,244));
        web.addJavascriptInterface(new Bridge(),"AndroidBridge");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();
                if(!request.isForMainFrame())return false;
                if(u.toString().startsWith("https://appassets.androidplatform.net/"))return false;
                if("https".equalsIgnoreCase(u.getScheme())||"http".equalsIgnoreCase(u.getScheme())){
                    try{startActivity(new Intent(Intent.ACTION_VIEW,u));return true;}
                    catch(Exception ignored){}
                }
                return false;
            }
            @Override public void onPageFinished(WebView view,String url){
                if(url.startsWith(HOME)){pageReady=true;deliverPending();}
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> cb,FileChooserParams params){
                if(webFileCallback!=null)webFileCallback.onReceiveValue(null);
                webFileCallback=cb;
                Intent chooser;
                try{chooser=params.createIntent();}
                catch(Exception error){chooser=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    chooser.setType("*/*");chooser.addCategory(Intent.CATEGORY_OPENABLE);}
                chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try{startActivityForResult(chooser,PICK);}
                catch(Exception e){webFileCallback.onReceiveValue(null);webFileCallback=null;}
                return true;
            }
            @Override public void onShowCustomView(View view,CustomViewCallback callback){
                if(customView!=null){callback.onCustomViewHidden();return;}
                customView=view;customCallback=callback;
                web.setVisibility(View.GONE);
                root.addView(view,new FrameLayout.LayoutParams(-1,-1));
            }
            @Override public void onHideCustomView(){hideCustom();}
        });
    }
    private void hideCustom(){
        if(customView==null)return;
        root.removeView(customView);customView=null;
        web.setVisibility(View.VISIBLE);
        if(customCallback!=null)customCallback.onCustomViewHidden();
        customCallback=null;
    }
    private String mimeForName(String name){
        if(name==null)return null;
        String lower=name.toLowerCase(Locale.ROOT);
        if(lower.endsWith(".pdf"))return "application/pdf";
        if(lower.endsWith(".docx"))return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if(lower.endsWith(".xlsx"))return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if(lower.endsWith(".pptx"))return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        int dot=lower.lastIndexOf('.');
        return dot<0?null:MimeTypeMap.getSingleton().getMimeTypeFromExtension(lower.substring(dot+1));
    }
    private String nameOf(Uri uri){
        if(uri==null)return "document";
        if("file".equals(uri.getScheme()))return uri.getLastPathSegment();
        try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(c!=null&&c.moveToFirst())return c.getString(0);
        }catch(Exception ignored){}
        return uri.getLastPathSegment()==null?"document":uri.getLastPathSegment();
    }
    private String displayName(Uri uri){
        try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){
            if(c!=null&&c.moveToFirst()&&!c.isNull(0))return c.getString(0);
        }catch(Exception ignored){}
        return null;
    }
    /** Izin baca permanen (dari pemilih file TG Office): riwayat cukup menyimpan alamat, tanpa salinan. */
    private boolean persisted(Uri uri){
        if(uri==null||!"content".equals(uri.getScheme()))return false;
        try{for(android.content.UriPermission p:getContentResolver().getPersistedUriPermissions())
            if(p.getUri().equals(uri)&&p.isReadPermission())return true;}catch(Exception ignored){}
        return false;
    }
    private boolean canRead(Uri uri){
        try(ParcelFileDescriptor pfd=getContentResolver().openFileDescriptor(uri,"r")){return pfd!=null;}
        catch(Exception e){return false;}
    }
    private long sizeOf(Uri uri){
        try(Cursor c=getContentResolver().query(uri,new String[]{OpenableColumns.SIZE},null,null,null)){
            if(c!=null&&c.moveToFirst()&&!c.isNull(0))return c.getLong(0);
        }catch(Exception ignored){}
        return -1;
    }
    private boolean nativePdfSupported(){
        if(Build.VERSION.SDK_INT>=35)return true;
        if(Build.VERSION.SDK_INT<31)return false;
        try{return SdkExtensions.getExtensionVersion(Build.VERSION_CODES.R)>=13;}
        catch(Exception error){return false;}
    }
    /** Hapus salinan sementara lama agar cache tidak menumpuk. */
    private void cleanOldTransfers(){
        new Thread(()->{
            File[] files=transferDir().listFiles();if(files==null)return;
            long limit=System.currentTimeMillis()-10*60*1000L;
            for(File f:files)if(f.lastModified()<limit)f.delete();
            File[] old=new File(getCacheDir(),"cast").listFiles();
            if(old!=null&&(cast==null||!cast.isRunning()))for(File f:old)f.delete();
            File[] shares=new File(getCacheDir(),"shares").listFiles();
            if(shares!=null)for(File f:shares)if(f.lastModified()<limit)f.delete();
        }).start();
    }
    /**
     * Bug ganti PDF A ke B: pembaca lama kadang belum selesai ditutup saat pembaca baru dibuka.
     * Tunggu sampai tidak ada pembaca aktif dan beri jeda singkat (maks 3 detik).
     */
    private void openPdf(Uri uri){openPdfWhenReady(uri,SystemClock.elapsedRealtime());}
    private void openPdfWhenReady(Uri uri,long startedAt){
        long now=SystemClock.elapsedRealtime();
        boolean busy=com.totogutomo.tgpdflab.MainActivity.liveReaders>0||
            now-com.totogutomo.tgpdflab.MainActivity.lastDestroyedAt<450;
        if(busy&&now-startedAt<3000){ui.postDelayed(()->openPdfWhenReady(uri,startedAt),120);return;}
        com.totogutomo.tgpdflab.DiagLog.log(this,"APP","PDF_LAUNCH waited_ms="+(now-startedAt)+" live_readers="
            +com.totogutomo.tgpdflab.MainActivity.liveReaders+" busy="+busy);
        launchPdf(uri);
    }
    private void launchPdf(Uri uri){
        try{
            Intent i=new Intent(Intent.ACTION_VIEW);
            i.setClassName(this,PDF_READER);
            if(pendingStartPage>0)i.putExtra(com.totogutomo.tgpdflab.MainActivity.EXTRA_START_PAGE,pendingStartPage);
            pendingStartPage=0;
            com.totogutomo.tgpdflab.MainActivity.reportName=null;
            i.setDataAndType(uri,"application/pdf");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setClipData(ClipData.newRawUri("TeGe Office PDF",uri));
            startActivity(i);
        }catch(Exception e){
            Toast.makeText(this,"PDF native gagal dibuka: "+e.getMessage(),Toast.LENGTH_LONG).show();
            rememberDocument(uri,null);
            pendingOpen=true;deliverPending();
        }
    }
    private void notifyOpening(String name){
        if(web==null||!pageReady)return;
        web.evaluateJavascript("window.__TG_OPENING__&&window.__TG_OPENING__("+JSONObject.quote(name==null?"dokumen.pdf":name)+");",null);
    }
    private boolean supported(Uri uri,String mime){
        String name=nameOf(uri);
        String x=mimeForName(name);
        if(x==null)x=mime;
        return "application/pdf".equals(x)||
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".equals(x)||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".equals(x)||
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".equals(x);
    }
    private void rememberDocument(Uri uri,Intent source){
        documentUri=uri;
        documentName=nameOf(uri);
        documentMime=mimeForName(documentName);
        if(documentMime==null)documentMime=getContentResolver().getType(uri);
        documentSize=sizeOf(uri);
        String a=uri.getAuthority()==null?"":uri.getAuthority().toLowerCase(Locale.ROOT);
        documentOrigin=a.contains("google.android.apps.docs")?"gdrive":
            (a.contains("skydrive")||a.contains("onedrive")?"onedrive":"local");
        try{
            int flags=source==null?0:source.getFlags();
            int keep=flags&(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            if(keep!=0){
                try{getContentResolver().takePersistableUriPermission(uri,keep);}
                catch(Exception e){getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);}
            }
        }catch(Exception ignored){}
    }
    private void consumeUri(Uri uri,Intent source){
        if(uri==null)return;
        if(!supported(uri,source==null?null:source.getType())){
            Toast.makeText(this,"Format file belum didukung.",Toast.LENGTH_SHORT).show();return;
        }
        String mime=mimeForName(nameOf(uri));
        if(mime==null&&source!=null)mime=source.getType();
        if("application/pdf".equals(mime)&&nativePdfSupported()){
            pendingOpen=false;
            rememberDocument(uri,source);
            pendingRecord=true;deliverPending();
            notifyOpening(documentName);
            openPdf(uri);
        }else{
            rememberDocument(uri,source);pendingOpen=true;deliverPending();
        }
    }
    private void handleIncoming(Intent intent){
        if(intent==null)return;
        Uri uri=null;
        if(Intent.ACTION_VIEW.equals(intent.getAction()))uri=intent.getData();
        else if(Intent.ACTION_SEND.equals(intent.getAction())){
            Object extra=intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if(extra instanceof Uri)uri=(Uri)extra;
            if(uri==null&&intent.getClipData()!=null&&intent.getClipData().getItemCount()>0)
                uri=intent.getClipData().getItemAt(0).getUri();
        }
        if(uri!=null)com.totogutomo.tgpdflab.DiagLog.log(this,"APP","INCOMING action="+intent.getAction()+" type="+intent.getType()+" scheme="+uri.getScheme());
        consumeUri(uri,intent);
    }
    @Override protected void onNewIntent(Intent intent){
        super.onNewIntent(intent);
        if(CastService.ACTION_END.equals(intent.getAction())){castToWeb("__TG_CAST_END__","1");return;}
        setIntent(intent);handleIncoming(intent);deliverPending();
    }
    @Override protected void onActivityResult(int request,int result,Intent data){
        super.onActivityResult(request,result,data);
        if(request==NATIVE_PICK){
            if(result==RESULT_OK&&data!=null)consumeUri(data.getData(),data);
            return;
        }
        if(request==PICK){
            if(webFileCallback!=null){
                webFileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));
                webFileCallback=null;
            }
            return;
        }
        if(request==SAVE){
            File f=pendingSaveFile;pendingSaveFile=null;
            final boolean saveAs=pendingSaveAs;pendingSaveAs=false;
            if(saveAs){
                Uri src=pendingSaveSource;pendingSaveSource=null;
                if(result==RESULT_OK&&data!=null&&data.getData()!=null&&(f!=null||src!=null))saveCopy(f,src,data);
                else{if(f!=null)f.delete();savedAs(false,null,null);}
                return;
            }
            if(result==RESULT_OK&&data!=null&&data.getData()!=null&&f!=null){
                final Uri target=data.getData();
                new Thread(()->{
                    try(InputStream in=new java.io.FileInputStream(f);
                        java.io.OutputStream out=getContentResolver().openOutputStream(target)){
                        if(out==null)throw new IOException("Tujuan simpan tidak ditemukan");
                        byte[] b=new byte[65536];int n;
                        while((n=in.read(b))>=0)out.write(b,0,n);
                        runOnUiThread(()->Toast.makeText(this,"File disimpan",Toast.LENGTH_SHORT).show());
                    }catch(Exception e){
                        runOnUiThread(()->Toast.makeText(this,"Gagal menyimpan",Toast.LENGTH_SHORT).show());
                    }finally{f.delete();}
                }).start();
            }
        }
    }
    /** Simpan salinan bernama baru (file dari WhatsApp dsb. yang tidak bisa diganti namanya langsung). */
    private void saveCopy(File f,Uri src,Intent data){
        final Uri target=data.getData();
        try{getContentResolver().takePersistableUriPermission(target,
            Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){}
        new Thread(()->{
            try(InputStream in=f!=null?new java.io.FileInputStream(f):getContentResolver().openInputStream(src);
                java.io.OutputStream out=getContentResolver().openOutputStream(target)){
                if(in==null||out==null)throw new IOException("Tujuan simpan tidak ditemukan");
                byte[] b=new byte[65536];int n;
                while((n=in.read(b))>=0)out.write(b,0,n);
                out.flush();
                savedAs(true,target.toString(),nameOf(target));
            }catch(Exception e){savedAs(false,null,null);}
            finally{if(f!=null)f.delete();}
        }).start();
    }
    private void savedAs(boolean ok,String uri,String name){
        runOnUiThread(()->{
            if(web==null)return;
            try{
                JSONObject r=new JSONObject();r.put("ok",ok);
                if(uri!=null)r.put("uri",uri);if(name!=null)r.put("name",name);
                web.evaluateJavascript("window.__TG_SAVED_AS__&&window.__TG_SAVED_AS__("+r+");",null);
            }catch(Exception ignored){}
        });
    }
    /** Ganti nama file asli lewat DocumentsContract. Hasil JSON: ok, uri, name, reason. */
    private String renameDocumentNow(String uriText,String newName){
        JSONObject r=new JSONObject();
        try{
            r.put("ok",false);
            if(uriText==null||newName==null||newName.trim().isEmpty()){r.put("reason","invalid");return r.toString();}
            Uri uri=Uri.parse(uriText);
            if(!DocumentsContract.isDocumentUri(this,uri)){r.put("reason","not-document");return r.toString();}
            int flags=0;
            try(Cursor c=getContentResolver().query(uri,new String[]{DocumentsContract.Document.COLUMN_FLAGS},null,null,null)){
                if(c!=null&&c.moveToFirst())flags=c.getInt(0);
            }
            if((flags&DocumentsContract.Document.FLAG_SUPPORTS_RENAME)==0){r.put("reason","no-rename");return r.toString();}
            String wanted=newName.trim();
            Uri next=DocumentsContract.renameDocument(getContentResolver(),uri,wanted);
            if(next==null)next=uri;
            try{getContentResolver().takePersistableUriPermission(next,
                Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);}catch(Exception ignored){}
            // Folder Download bisa memberi alamat baru yang belum bisa dibaca: pakai alamat yang masih bisa dibuka.
            Uri keep=canRead(next)?next:(canRead(uri)?uri:next);
            // Nama dari alamat baru kadang berupa kode internal (msf:123). Pakai nama yang diketik pengguna.
            String shown=displayName(keep);
            if(shown==null||shown.indexOf('.')<0||shown.startsWith("msf:"))shown=wanted;
            r.put("ok",true);r.put("uri",keep.toString());r.put("name",shown);
        }catch(SecurityException e){try{r.put("reason","no-permission");}catch(Exception ignored){}}
        catch(Exception e){try{r.put("reason","failed");}catch(Exception ignored){}}
        return r.toString();
    }
    private WebResourceResponse nativeResponse(String path){
        if(documentUri==null||path==null||!path.startsWith("current"))
            return errorResponse(404,"File tidak tersedia");
        try{
            InputStream in=getContentResolver().openInputStream(documentUri);
            if(in==null)return errorResponse(404,"Tidak dapat membuka dokumen");
            Map<String,String> hdr=new HashMap<>();
            hdr.put("Cache-Control","no-store");hdr.put("Access-Control-Allow-Origin","*");
            return new WebResourceResponse(documentMime==null?"application/octet-stream":documentMime,
                null,200,"OK",hdr,in);
        }catch(FileNotFoundException e){return errorResponse(404,"File hilang");}
    }
    private WebResourceResponse errorResponse(int code,String message){
        return new WebResourceResponse("text/plain","UTF-8",code,"Not Found",
            Collections.singletonMap("Cache-Control","no-store"),
            new java.io.ByteArrayInputStream(message.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    private void deliverPending(){
        if(!pageReady||documentUri==null)return;
        if(pendingRecord&&!pendingOpen){
            pendingRecord=false;
            try{
                JSONObject meta=new JSONObject();
                meta.put("url",NATIVE+"?v="+System.nanoTime());
                meta.put("name",documentName);meta.put("mime",documentMime);meta.put("size",documentSize);
                meta.put("uri",documentUri.toString());meta.put("persist",persisted(documentUri));
                web.evaluateJavascript("window.__TG_OFFICE_RECORD__&&window.__TG_OFFICE_RECORD__("+meta.toString()+");",null);
            }catch(Exception ignored){}
            return;
        }
        if(!pendingOpen)return;
        pendingOpen=false;pendingRecord=false;
        try{
            JSONObject meta=new JSONObject();
            meta.put("url",NATIVE+"?v="+System.nanoTime());
            meta.put("name",documentName);
            meta.put("mime",documentMime);
            meta.put("size",documentSize);
            meta.put("origin",documentOrigin);
            meta.put("uri",documentUri.toString());meta.put("persist",persisted(documentUri));
            web.evaluateJavascript("window.__TG_OFFICE_NATIVE_OPEN__&&window.__TG_OFFICE_NATIVE_OPEN__("+
                meta.toString()+");",null);
        }catch(Exception e){Toast.makeText(this,"File gagal dikirim ke viewer",Toast.LENGTH_SHORT).show();}
    }
    private void pickLocal(String extension){
        Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        String mime=mimeForName("file."+extension);
        if(mime!=null)i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{mime});
        else i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation"});
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try{startActivityForResult(i,NATIVE_PICK);}
        catch(ActivityNotFoundException e){Toast.makeText(this,"Pemilih file tidak tersedia",Toast.LENGTH_SHORT).show();}
    }
    private void applyBars(boolean dark){
        int bar=dark?Color.rgb(14,21,30):Color.rgb(230,236,244);
        getWindow().setStatusBarColor(bar);
        getWindow().setNavigationBarColor(bar);
        View decor=getWindow().getDecorView();
        if(Build.VERSION.SDK_INT>=30){
            WindowInsetsController c=decor.getWindowInsetsController();
            if(c!=null){
                int light=WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS|WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark?0:light,light);
            }
        }else{
            decor.setSystemUiVisibility(dark?0:View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if(root!=null)root.setBackgroundColor(bar);
        if(web!=null)web.setBackgroundColor(bar);
    }
    private void setImmersiveMode(boolean on){
        immersive=on;
        View decor=getWindow().getDecorView();
        if(Build.VERSION.SDK_INT>=30){
            WindowInsetsController c=decor.getWindowInsetsController();
            if(c==null)return;
            if(on){
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }else c.show(WindowInsets.Type.systemBars());
        }else{
            decor.setSystemUiVisibility(on?(View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY):0);
        }
    }
    private void printWebPage(String job){
        PrintManager pm=(PrintManager)getSystemService(PRINT_SERVICE);
        if(pm==null||web==null){notifyPrintDone();return;}
        final PrintDocumentAdapter inner=web.createPrintDocumentAdapter(job);
        PrintDocumentAdapter wrapped=new PrintDocumentAdapter(){
            @Override public void onStart(){inner.onStart();}
            @Override public void onLayout(PrintAttributes o,PrintAttributes n,CancellationSignal c,LayoutResultCallback cb,Bundle e){inner.onLayout(o,n,c,cb,e);}
            @Override public void onWrite(PageRange[] p,ParcelFileDescriptor d,CancellationSignal c,WriteResultCallback cb){inner.onWrite(p,d,c,cb);}
            @Override public void onFinish(){inner.onFinish();notifyPrintDone();}
        };
        try{pm.print(job,wrapped,new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());}
        catch(Exception e){notifyPrintDone();Toast.makeText(this,"Dialog cetak tidak tersedia",Toast.LENGTH_SHORT).show();}
    }
    private void notifyPrintDone(){
        runOnUiThread(()->{if(web!=null)web.evaluateJavascript("window.__TG_PRINT_DONE__&&window.__TG_PRINT_DONE__();",null);});
    }
    private void printPdfFile(File file,String job){
        PrintManager pm=(PrintManager)getSystemService(PRINT_SERVICE);
        if(pm==null){file.delete();return;}
        PrintDocumentAdapter adapter=new PrintDocumentAdapter(){
            @Override public void onLayout(PrintAttributes o,PrintAttributes n,CancellationSignal c,LayoutResultCallback cb,Bundle e){
                if(c.isCanceled()){cb.onLayoutCancelled();return;}
                cb.onLayoutFinished(new PrintDocumentInfo.Builder(job).setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN).build(),true);
            }
            @Override public void onWrite(PageRange[] pages,ParcelFileDescriptor dest,CancellationSignal c,WriteResultCallback cb){
                try(InputStream in=new java.io.FileInputStream(file);
                    FileOutputStream out=new FileOutputStream(dest.getFileDescriptor())){
                    byte[] b=new byte[65536];int n;
                    while((n=in.read(b))>=0){if(c.isCanceled()){cb.onWriteCancelled();return;}out.write(b,0,n);}
                    cb.onWriteFinished(new PageRange[]{PageRange.ALL_PAGES});
                }catch(Exception e){cb.onWriteFailed(e.getMessage());}
            }
            @Override public void onFinish(){file.delete();}
        };
        try{pm.print(job,adapter,null);}catch(Exception e){file.delete();Toast.makeText(this,"Dialog cetak tidak tersedia",Toast.LENGTH_SHORT).show();}
    }
    private File transferDir(){
        File folder=new File(getCacheDir(),"tg-office-share");
        if(!folder.exists())folder.mkdirs();
        return folder;
    }
    private String safeName(String name){
        return name==null?"document.pdf":name.replaceAll("[^a-zA-Z0-9._() -]","_");
    }
    private void cancelTransfer(){
        try{if(transferOutput!=null)transferOutput.close();}catch(Exception ignored){}
        if(transferFile!=null)transferFile.delete();
        transferId=null;transferFile=null;transferOutput=null;transferExpected=0;transferSize=0;
    }
    private void shareFile(File file,String mime){
        runOnUiThread(()->{
            try{
                Uri shared=FileProvider.getUriForFile(this,getPackageName()+".fileprovider",file);
                Intent send=new Intent(Intent.ACTION_SEND);
                send.setType(mime==null?"application/octet-stream":mime);
                send.putExtra(Intent.EXTRA_STREAM,shared);
                send.setClipData(ClipData.newRawUri("TeGe Office",shared));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(send,"Bagikan dokumen dengan…"));
            }catch(Exception e){Toast.makeText(this,"Gagal berbagi file",Toast.LENGTH_SHORT).show();}
        });
    }
    /** Kembali dari pembaca PDF: kirim halaman terakhir dan jumlah halaman ke beranda. */
    @Override protected void onResume(){
        super.onResume();
        // Kembali dari pembaca PDF: salinan sementara (>1 menit) sudah tidak dipakai, hapus.
        new Thread(()->{
            File[] files=transferDir().listFiles();if(files==null)return;
            long limit=System.currentTimeMillis()-60*1000L;
            File active;synchronized(transferLock){active=transferFile;}
            for(File f:files)if(f.lastModified()<limit&&!f.equals(active))f.delete();
        }).start();
        String name=com.totogutomo.tgpdflab.MainActivity.reportName;
        if(name==null||web==null||!pageReady)return;
        com.totogutomo.tgpdflab.MainActivity.reportName=null;
        try{
            JSONObject r=new JSONObject();r.put("name",name);
            r.put("page",com.totogutomo.tgpdflab.MainActivity.reportPage);
            r.put("pages",com.totogutomo.tgpdflab.MainActivity.reportPages);
            web.evaluateJavascript("window.__TG_PDF_PROGRESS__&&window.__TG_PDF_PROGRESS__("+r+");",null);
        }catch(Exception ignored){}
    }
    @Override public void onBackPressed(){
        if(customView!=null){hideCustom();return;}
        if(web==null){super.onBackPressed();return;}
        web.evaluateJavascript("(function(){try{return window.__TG_BACK__?window.__TG_BACK__():'none'}catch(e){return 'none'}})()",result->{
                if(!"\"none\"".equals(result))return;
                if(web!=null&&web.canGoBack())web.goBack();
                else MainActivity.super.onBackPressed();
            });
    }
    @Override protected void onDestroy(){
        synchronized(transferLock){cancelTransfer();}
        if(cast!=null){cast.stop();cast=null;}
        CastService.stop(this);
        if(web!=null){web.removeJavascriptInterface("AndroidBridge");web.destroy();web=null;}
        super.onDestroy();
    }
    /* ---------- Presentasi Nirkabel ---------- */
    private String castInfo(){
        JSONObject r=new JSONObject();
        try{
            r.put("ok",cast!=null&&cast.isRunning());
            if(cast!=null&&cast.isRunning()){
                r.put("port",cast.port);r.put("code",cast.code());r.put("connected",cast.isConnected());
                org.json.JSONArray a=new org.json.JSONArray();
                for(String x:CastServer.addresses()){int i=x.indexOf('=');JSONObject o=new JSONObject();o.put("name",x.substring(0,i));o.put("ip",x.substring(i+1));a.put(o);}
                r.put("addrs",a);
            }
        }catch(Exception ignored){}
        return r.toString();
    }
    private void castToWeb(String fn,String payload){
        runOnUiThread(()->{
            if(web==null)return;
            String q=JSONObject.quote(payload).replace("\u2028","\\u2028").replace("\u2029","\\u2029");
            web.evaluateJavascript("window."+fn+"&&window."+fn+"("+q+");",null);
        });
    }
    public final class Bridge {
        @JavascriptInterface public void onWebReady(){
            runOnUiThread(()->{pageReady=true;deliverPending();});
        }
        @JavascriptInterface public void openDocumentPicker(String ext){
            String x=ext==null?"":ext.replaceAll("[^a-zA-Z]","").toLowerCase(Locale.ROOT);
            runOnUiThread(()->pickLocal(x));
        }
        @JavascriptInterface public void setSystemTheme(boolean dark){
            runOnUiThread(()->applyBars(dark));
        }
        @JavascriptInterface public String toggleOrientation(){
            landscapeLocked=!landscapeLocked;
            final boolean l=landscapeLocked;
            runOnUiThread(()->setRequestedOrientation(l?ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE:
                ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
            return l?"landscape":"portrait";
        }
        @JavascriptInterface public void forcePortrait(){
            landscapeLocked=false;
            runOnUiThread(()->setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        }
        @JavascriptInterface public void setImmersive(boolean on){
            runOnUiThread(()->setImmersiveMode(on));
        }
        @JavascriptInterface public boolean printWeb(String job){
            final String name=job==null||job.isEmpty()?"TeGe Office":job;
            runOnUiThread(()->printWebPage(name));
            return true;
        }
        @JavascriptInterface public boolean finishPrintPdf(String id){
            File f=completed(id);if(f==null)return false;
            final String job=f.getName().replaceFirst("^tg-[a-z0-9]+-","");
            runOnUiThread(()->printPdfFile(f,job));
            return true;
        }
        @JavascriptInterface public boolean shareCurrentFile(String name){
            Uri uri=documentUri;
            if(uri==null||documentName==null||!documentName.equals(name))return false;
            new Thread(()->{
                File output=new File(transferDir(),"tg-"+System.nanoTime()+"-"+safeName(name));
                try(InputStream in=getContentResolver().openInputStream(uri);
                    FileOutputStream out=new FileOutputStream(output)){
                    if(in==null)throw new IOException("File kosong");
                    byte[] b=new byte[65536];long total=0;int n;
                    while((n=in.read(b))!=-1){
                        total+=n;if(total>TRANSFER_LIMIT)throw new IOException("File terlalu besar");
                        out.write(b,0,n);
                    }
                    shareFile(output,documentMime);
                }catch(Exception e){output.delete();}
            }).start();
            return true;
        }
        @JavascriptInterface public String beginShare(String name,String mime,long size){
            if(size<0||size>TRANSFER_LIMIT||mimeForName(name)==null)return "";
            synchronized(transferLock){
                cancelTransfer();
                try{
                    transferId=Long.toHexString(System.nanoTime());
                    transferFile=new File(transferDir(),"tg-"+transferId+"-"+safeName(name));
                    transferOutput=new FileOutputStream(transferFile);
                    transferExpected=size;transferMime=mime;return transferId;
                }catch(Exception e){cancelTransfer();return "";}
            }
        }
        @JavascriptInterface public boolean appendShareChunk(String id,String encoded){
            synchronized(transferLock){
                if(transferId==null||!transferId.equals(id)||transferOutput==null||
                    encoded==null||encoded.length()>150000)return false;
                try{
                    byte[] bytes=Base64.decode(encoded,Base64.DEFAULT);
                    if(transferSize+bytes.length>transferExpected)return false;
                    transferOutput.write(bytes);transferSize+=bytes.length;return true;
                }catch(Exception e){return false;}
            }
        }
        private File completed(String id){
            synchronized(transferLock){
                if(transferId==null||!transferId.equals(id)||transferSize!=transferExpected)return null;
                try{transferOutput.close();}catch(Exception e){return null;}
                File file=transferFile;
                transferId=null;transferFile=null;transferOutput=null;transferSize=0;transferExpected=0;
                return file;
            }
        }
        @JavascriptInterface public boolean finishShare(String id){
            File f=completed(id);if(f==null)return false;shareFile(f,transferMime);return true;
        }
        @JavascriptInterface public boolean finishSave(String id){
            File f=completed(id);if(f==null)return false;
            String mime=transferMime;
            runOnUiThread(()->{
                pendingSaveFile=f;
                Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime==null?"application/octet-stream":mime);
                i.putExtra(Intent.EXTRA_TITLE,f.getName().replaceFirst("^tg-[a-z0-9]+-",""));
                startActivityForResult(i,SAVE);
            });
            return true;
        }
        @JavascriptInterface public String renameDocument(String uri,String name){
            return renameDocumentNow(uri,name);
        }
        @JavascriptInterface public boolean finishSaveAs(String id,String name){
            File f=completed(id);if(f==null)return false;
            String mime=transferMime;
            runOnUiThread(()->{
                pendingSaveFile=f;pendingSaveAs=true;
                Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType(mime==null?"application/octet-stream":mime);
                i.putExtra(Intent.EXTRA_TITLE,name==null?f.getName():name);
                try{startActivityForResult(i,SAVE);}
                catch(Exception e){pendingSaveFile=null;pendingSaveAs=false;f.delete();savedAs(false,null,null);}
            });
            return true;
        }
        @JavascriptInterface public boolean finishPdfAt(String id,int page){
            pendingStartPage=Math.max(0,page);
            return finishPdf(id);
        }
        @JavascriptInterface public String getMediaVolume(){
            android.media.AudioManager am=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);
            if(am==null)return "";
            return am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)+"/"+am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
        }
        @JavascriptInterface public void setMediaVolume(float fraction){
            android.media.AudioManager am=(android.media.AudioManager)getSystemService(AUDIO_SERVICE);
            if(am==null)return;
            int max=am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC);
            int v=Math.round(Math.max(0f,Math.min(1f,fraction))*max);
            try{am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC,v,0);}catch(Exception ignored){}
        }
        @JavascriptInterface public void openExternal(String url){
            if(url==null||!(url.startsWith("https://")||url.startsWith("http://")||url.startsWith("mailto:")))return;
            runOnUiThread(()->{
                try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)));}
                catch(Exception e){Toast.makeText(MainActivity.this,"Tidak ada aplikasi untuk membuka tautan",Toast.LENGTH_SHORT).show();}
            });
        }
        @JavascriptInterface public boolean finishPdf(String id){
            File f=completed(id);
            if(f==null)return false;
            runOnUiThread(()->{
                if(nativePdfSupported()){
                    try{
                        Uri u=FileProvider.getUriForFile(MainActivity.this,getPackageName()+".fileprovider",f);
                        openPdf(u);
                    }catch(Exception e){Toast.makeText(MainActivity.this,
                        "Gagal membuka PDF tersimpan",Toast.LENGTH_LONG).show();}
                }
            });
            return true;
        }
        @JavascriptInterface public void cancelShare(String id){
            synchronized(transferLock){if(id!=null&&id.equals(transferId))cancelTransfer();}
        }
        @JavascriptInterface public void clearNativeShareTarget(){
            documentUri=null;documentName=null;documentMime=null;documentSize=-1;
        }
        @JavascriptInterface public void setPresentationMode(boolean enabled){
            runOnUiThread(()->{
                landscapeLocked=false;
                setRequestedOrientation(enabled?ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE:
                    ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                setImmersiveMode(enabled);
                // Mode Presentasi: layar tetap menyala selama presentasi
                if(enabled)getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
        @JavascriptInterface public boolean canOpenNativePdf(){return nativePdfSupported();}
        /* Riwayat berbasis alamat */
        @JavascriptInterface public boolean isPersisted(String uri){
            try{return uri!=null&&persisted(Uri.parse(uri));}catch(Exception e){return false;}
        }
        /** Buka lagi file dari riwayat lewat alamatnya. Hasil: ok / missing. */
        @JavascriptInterface public String openUri(String uriText,int page){
            final Uri u;
            try{u=Uri.parse(uriText);}catch(Exception e){return "missing";}
            if(u==null||!canRead(u))return "missing";
            runOnUiThread(()->{
                rememberDocument(u,null);
                if("application/pdf".equals(documentMime)&&nativePdfSupported()){
                    pendingOpen=false;pendingRecord=false;pendingStartPage=Math.max(0,page);openPdf(u);
                }else{pendingOpen=true;deliverPending();}
            });
            return "ok";
        }
        @JavascriptInterface public boolean saveCopyFromUri(String uriText,String name){
            final Uri src;
            try{src=Uri.parse(uriText);}catch(Exception e){return false;}
            if(src==null||!canRead(src))return false;
            runOnUiThread(()->{
                pendingSaveFile=null;pendingSaveSource=src;pendingSaveAs=true;
                Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                String m=mimeForName(name);i.setType(m==null?"application/octet-stream":m);
                i.putExtra(Intent.EXTRA_TITLE,name);
                try{startActivityForResult(i,SAVE);}
                catch(Exception e){pendingSaveSource=null;pendingSaveAs=false;savedAs(false,null,null);}
            });
            return true;
        }
        /* Presentasi Nirkabel */
        @JavascriptInterface public String castStart(String id,String name){
            File f=completed(id);
            if(f==null)return "{\"ok\":false,\"reason\":\"file\"}";
            File dir=new File(getCacheDir(),"cast");dir.mkdirs();
            File dest=new File(dir,"tg-"+System.nanoTime()+".pptx");
            if(!f.renameTo(dest)){dest=f;}
            if(cast==null)cast=new CastServer(getAssets(),new CastServer.Listener(){
                @Override public void onMessage(String json){
                    try{castToWeb("__TG_CAST__",new JSONObject(json).toString());}catch(Exception ignored){}
                }
                @Override public void onStatus(String status){
                    castToWeb("__TG_CAST_STATUS__",status);
                    CastService.update(MainActivity.this,"connected".equals(status)?"Terhubung ke layar tujuan":"Menunggu layar tujuan tersambung");
                }
            });
            if(!cast.start())return "{\"ok\":false,\"reason\":\"port\"}";
            cast.setFile(dest,name);
            runOnUiThread(()->{
                if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=android.content.pm.PackageManager.PERMISSION_GRANTED)
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},7302);
                CastService.update(MainActivity.this,"Menunggu layar tujuan tersambung");
            });
            return castInfo();
        }
        @JavascriptInterface public String castInfoJson(){return castInfo();}
        @JavascriptInterface public boolean castSend(String json){return cast!=null&&cast.send(json);}
        @JavascriptInterface public String castNewCode(){return cast==null?"":cast.newCode();}
        @JavascriptInterface public void castStop(){
            if(cast!=null){CastServer c=cast;cast=null;new Thread(c::stop).start();}
            CastService.stop(MainActivity.this);
        }
        @JavascriptInterface public void keepScreenOn(boolean on){
            runOnUiThread(()->{
                if(on)getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            });
        }
        @JavascriptInterface public String platform(){return "android-tg-office-beta";}
        /* Pengaturan: tampilan PDF bawaan dibaca pembaca PDF native saat halaman sudah tampil */
        @JavascriptInterface public void setPdfDefault(String v){
            getSharedPreferences("tg_office_prefs",MODE_PRIVATE).edit().putString("pdf_view","flipbook".equals(v)?"flipbook":"gulir").apply();
        }
        /* ---- Log diagnostik (tersembunyi di Tentang; tanpa nama berkas) ---- */
        @JavascriptInterface public void diagLog(String msg){
            com.totogutomo.tgpdflab.DiagLog.log(MainActivity.this,"WEB",msg==null?"":(msg.length()>600?msg.substring(0,600):msg));
        }
        @JavascriptInterface public boolean diagCopy(){
            try{
                android.content.ClipboardManager cb=(android.content.ClipboardManager)getSystemService(CLIPBOARD_SERVICE);
                cb.setPrimaryClip(ClipData.newPlainText("TeGe Office log",com.totogutomo.tgpdflab.DiagLog.read(MainActivity.this)));
                return true;
            }catch(Exception e){return false;}
        }
        @JavascriptInterface public boolean diagShare(){
            try{
                java.io.File f=com.totogutomo.tgpdflab.DiagLog.export(MainActivity.this);
                Uri u=FileProvider.getUriForFile(MainActivity.this,getPackageName()+".fileprovider",f);
                Intent send=new Intent(Intent.ACTION_SEND);
                send.setType("text/plain");
                send.putExtra(Intent.EXTRA_STREAM,u);
                send.putExtra(Intent.EXTRA_SUBJECT,"Log TeGe Office");
                send.setClipData(ClipData.newRawUri("TeGe Office log",u));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(()->startActivity(Intent.createChooser(send,"Kirim log TeGe Office")));
                return true;
            }catch(Exception e){return false;}
        }
    }
}
