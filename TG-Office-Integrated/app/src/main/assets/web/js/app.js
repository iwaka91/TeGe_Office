import {qs,qsa,extOf,formatBytes,clamp} from './utils.js';
import {saveRecent,listRecent,listPinned,getRecent,clearRecent,pinRecent,unpinRecent,updateRecentMeta,removeRecent,dropCopies,storageUsed,clearCopies,clearAllRecent,MAX_TOTAL,MAX_PINNED} from './storage.js';
import {openCast,castAvailable,castBack} from './cast.js';
import {DocxViewer} from './viewers/docx.js';
import {XlsxViewer} from './viewers/xlsx.js';
import {PptxViewer} from './viewers/pptx.js';
import {PdfViewer} from './viewers/pdf.js';

/* TeGe Office — cangkang aplikasi: beranda, menu penampil seragam, cetak, jembatan Android. */
window.__TG_OFFICE_BOOTED__=true;
const APP_VERSION='Versi 1.0.2';
const bridge=window.AndroidBridge||null;
/* Pengaturan (disimpan di perangkat) */
const PREF_KEY='tg-office-prefs',PREF_DEF={progres:true,word:'mengalir',ppt:'satu',pdf:'gulir'};
const prefs={...PREF_DEF};try{Object.assign(prefs,JSON.parse(localStorage.getItem(PREF_KEY)||'{}'))}catch{}
function savePrefs(){try{localStorage.setItem(PREF_KEY,JSON.stringify(prefs))}catch{}try{bridge?.setPdfDefault?.(prefs.pdf)}catch{}}
const SUPPORTED={docx:{label:'DOCX',name:'Dokumen'},xlsx:{label:'XLSX',name:'Tabel'},pptx:{label:'PPTX',name:'Presentasi'},pdf:{label:'PDF',name:'PDF'}};
const KIND={docx:'k-doc',xlsx:'k-xls',pptx:'k-ppt',pdf:'k-pdf'};
const MIME={docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',pdf:'application/pdf'};
const MAX_FILE=120*1024*1024,HOME_PREVIEW=5;
const home=qs('#homeScreen'),viewer=qs('#viewerScreen'),host=qs('#viewerHost'),input=qs('#fileInput'),loading=qs('#loadingState'),sub=qs('#subToolbar');
const menu=qs('#viewerMenu'),menuBtn=qs('#menuBtn'),scrim=qs('#menuScrim'),zoomChip=qs('#zoomChip'),printRoot=qs('#printRoot');
let current=null,currentType=null,currentFile=null,currentFileId=null,nativeName=null,zoom=1,toastTimer,zoomTimer,restorePosition=null,positionTimer=null;
let showAllPinned=false,showAllRecent=false,lastOpened=null,lastUri=null,lastPersist=false,reopenId=null,lastPdfRecId=null;

const ICON={
  play:'M8,5v14l11,-7z',
  view:'M20,13H3c-0.55,0 -1,0.45 -1,1v6c0,0.55 0.45,1 1,1h17c0.55,0 1,-0.45 1,-1v-6C21,13.45 20.55,13 20,13zM20,3H3C2.45,3 2,3.45 2,4v6c0,0.55 0.45,1 1,1h17c0.55,0 1,-0.45 1,-1V4C21,3.45 20.55,3 20,3z',
  doc:'M6,2h9l5,5v13c0,1.1 -0.9,2 -2,2H6c-1.1,0 -2,-0.9 -2,-2V4c0,-1.1 0.9,-2 2,-2zM14,3.5V8h4.5L14,3.5zM7,12h10v1.6H7zM7,15.5h10v1.6H7z',
  grid:'M3,3v8h8V3H3zM9,9H5V5h4v4zM3,13v8h8v-8H3zM9,19H5v-4h4v4zM13,3v8h8V3h-8zM19,9h-4V5h4v4zM13,13v8h8v-8h-8zM19,19h-4v-4h4v4z',
  goto:'M19,15l-6,6 -1.42,-1.42L15.17,16H4V4h2v10h9.17l-3.59,-3.58L13,9l6,6z',
  search:'M15.5,14h-0.79l-0.28,-0.27C15.41,12.59 16,11.11 16,9.5 16,5.91 13.09,3 9.5,3S3,5.91 3,9.5 5.91,16 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zM9.5,14C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5 14,7.01 14,9.5 11.99,14 9.5,14z',
  fit:'M3,5v4h2V5h4V3H5C3.9,3 3,3.9 3,5zM5,15H3v4c0,1.1 0.9,2 2,2h4v-2H5v-4zM19,19h-4v2h4c1.1,0 2,-0.9 2,-2v-4h-2v4zM19,3h-4v2h4v4h2V5c0,-1.1 -0.9,-2 -2,-2z',
  rotate:'M8.5,12.5h12a2,2 0,0 1,2 2v5a2,2 0,0 1,-2 2h-12a2,2 0,0 1,-2 -2v-5a2,2 0,0 1,2 -2zM9.6,14.3v5.4h9.8v-5.4zM16.2,8.2L18.6,11.4 21,8.2zM12.4,2.9c3.7,-0.1 6.8,2.1 7,5.9l-1.7,0.1c-0.2,-2.7 -2.3,-4.3 -5.3,-4.3z',
  full:'M7,14H5v5h5v-2H7v-3zM5,10h2V7h3V5H5v5zM17,17h-3v2h5v-5h-2v3zM14,5v2h3v3h2V5h-5z',
  moon:'M12,3c-4.97,0 -9,4.03 -9,9s4.03,9 9,9 9,-4.03 9,-9c0,-0.46 -0.04,-0.92 -0.1,-1.36 -0.98,1.37 -2.58,2.26 -4.4,2.26 -2.98,0 -5.4,-2.42 -5.4,-5.4 0,-1.81 0.89,-3.42 2.26,-4.4C12.92,3.04 12.46,3 12,3z',
  sun:'M12,7c-2.76,0 -5,2.24 -5,5s2.24,5 5,5 5,-2.24 5,-5 -2.24,-5 -5,-5zM2,13h2c0.55,0 1,-0.45 1,-1s-0.45,-1 -1,-1H2c-0.55,0 -1,0.45 -1,1s0.45,1 1,1zM20,13h2c0.55,0 1,-0.45 1,-1s-0.45,-1 -1,-1h-2c-0.55,0 -1,0.45 -1,1s0.45,1 1,1zM11,2v2c0,0.55 0.45,1 1,1s1,-0.45 1,-1V2c0,-0.55 -0.45,-1 -1,-1s-1,0.45 -1,1zM11,20v2c0,0.55 0.45,1 1,1s1,-0.45 1,-1v-2c0,-0.55 -0.45,-1 -1,-1s-1,0.45 -1,1z',
  print:'M19,8H5c-1.66,0 -3,1.34 -3,3v6h4v4h12v-4h4v-6C22,9.34 20.66,8 19,8zM16,19H8v-5h8V19zM19,12c-0.55,0 -1,-0.45 -1,-1s0.45,-1 1,-1 1,0.45 1,1 -0.45,1 -1,1zM18,3H6v4h12V3z',
  share:'M14,9V5l7,7 -7,7v-4.1c-5,0 -8.5,1.6 -11,5.1 1,-5 4,-10 11,-11z',
  star:'M12,17.27L18.18,21l-1.64,-7.03L22,9.24l-7.19,-0.61L12,2 9.19,8.63 2,9.24l5.46,4.73L5.82,21z',
  starOutline:'M22,9.24l-7.19,-0.62L12,2 9.19,8.63 2,9.24l5.46,4.73L5.82,21 12,17.27 18.18,21l-1.63,-7.03L22,9.24zM12,15.4l-3.76,2.27 1,-4.28 -3.32,-2.88 4.38,-0.38L12,6.1l1.71,4.04 4.38,0.38 -3.32,2.88 1,4.28L12,15.4z',
  warn:'M1,21h22L12,2 1,21zM13,18h-2v-2h2v2zM13,14h-2v-4h2v4z',
  cast:'M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z'
};
/* Ikon format netral: bentuk berbeda per format, tanpa huruf merek */
const GLYPH={
  docx:'<path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fff"/><path d="M14 3l4 4h-3a1 1 0 0 1-1-1z" fill="#000" fill-opacity=".22"/><rect x="8.4" y="10.5" width="7.2" height="1.7" rx=".85" fill="var(--c2)"/><rect x="8.4" y="13.8" width="7.2" height="1.7" rx=".85" fill="var(--c2)" fill-opacity=".55"/><rect x="8.4" y="17" width="4.4" height="1.7" rx=".85" fill="var(--c2)" fill-opacity=".55"/>',
  xlsx:'<rect x="3.5" y="4.5" width="17" height="15" rx="2.6" fill="#fff"/><rect x="3.5" y="4.5" width="17" height="4.6" rx="2.2" fill="var(--c2)" fill-opacity=".3"/><path d="M3.5 9.2h17M3.5 14.2h17M9.3 4.5v15M15 4.5v15" stroke="var(--c2)" stroke-width="1.3"/>',
  pptx:'<rect x="3.2" y="4" width="17.6" height="12" rx="2.2" fill="#fff"/><rect x="6.4" y="10.8" width="2.4" height="3.2" rx=".7" fill="var(--c2)"/><rect x="10.8" y="7.6" width="2.4" height="6.4" rx=".7" fill="var(--c2)" fill-opacity=".75"/><rect x="15.2" y="9.2" width="2.4" height="4.8" rx=".7" fill="var(--c2)" fill-opacity=".55"/><path d="M12 16.4v3M8.6 19.6h6.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
  pdf:'<path d="M6 3h12a1 1 0 0 1 1 1v11l-5 6H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="#fff"/><path d="M19 15l-5 6q-1-5.2 5-6z" fill="var(--c2)" fill-opacity=".5"/><rect x="8" y="7" width="8" height="1.7" rx=".85" fill="var(--c2)"/><rect x="8" y="10.6" width="6" height="1.7" rx=".85" fill="var(--c2)" fill-opacity=".55"/>'
};
const TYPES_I=t=>['docx','xlsx','pptx','pdf'].indexOf(t);
const fmtIcon=(type,cls='')=>`<span class="fmt ${KIND[type]||'k-doc'} ${cls}"><svg viewBox="0 0 24 24" aria-hidden="true">${GLYPH[type]||GLYPH.docx}</svg></span>`;
const svg=(d,s=24)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path fill-rule="evenodd" d="${d}"/></svg>`;
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function toast(msg,ms=3000){const t=qs('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),ms)}
function setLoading(on,title='Membuka dokumen…',text='Menyiapkan penampil'){loading.classList.toggle('hidden',!on);qs('#loadingTitle').textContent=title;qs('#loadingText').textContent=text}
function withMime(file,type){if(file.type)return file;return new File([file],file.name,{type:MIME[type]||'application/octet-stream',lastModified:file.lastModified||Date.now()})}

/* ---------- Memilih file ---------- */
function choose(type){
  if(bridge?.openDocumentPicker){try{bridge.openDocumentPicker(type||'');return}catch(e){console.warn('Native picker unavailable',e)}}
  input.accept=type?`.${type}`:'.docx,.xlsx,.pptx,.pdf';input.value='';try{if(typeof input.showPicker==='function')input.showPicker();else input.click()}catch{input.click()}
}
qsa('.format-chip .fmt-slot').forEach(x=>x.outerHTML=fmtIcon(x.dataset.t,'d'+TYPES_I(x.dataset.t)));
qs('#openFileBtn').onclick=()=>choose();qsa('[data-open-type]').forEach(b=>b.onclick=()=>choose(b.dataset.openType));input.onchange=()=>{if(input.files[0]){nativeName=null;openFile(input.files[0])}};

/* File yang dikirim Android (dari aplikasi lain atau pemilih native) */
window.__TG_OFFICE_NATIVE_OPEN__=async meta=>{
  try{
    setLoading(true,'Membuka '+(meta?.name||'dokumen'),'Membaca file…');viewerShowShell(meta?.name||'Dokumen');
    const res=await fetch(meta.url,{cache:'no-store'});if(!res.ok)throw new Error('File tidak dapat dibaca dari perangkat.');
    const blob=await res.blob();const file=new File([blob],meta.name||'dokumen',{type:meta.mime||blob.type||'',lastModified:0});
    nativeName=file.name;await openFile(file,{fromNative:true,uri:meta.uri||null,persist:!!meta.persist});
  }catch(e){console.error(e);setLoading(false);showError(String(e.message||e))}
};

/* PDF yang dibuka langsung oleh PDF Lab tetap dicatat di Terakhir dibuka */
window.__TG_OFFICE_RECORD__=async meta=>{try{
  let file;if(meta.persist&&meta.uri)file={name:meta.name||'dokumen.pdf',size:+meta.size>0?+meta.size:0,lastModified:0};
  else{const res=await fetch(meta.url,{cache:'no-store'});if(!res.ok)return;const blob=await res.blob();file=new File([blob],meta.name||'dokumen.pdf',{type:'application/pdf',lastModified:0})}
  lastPdfRecId=await saveRecent(file,'pdf',{detail:'PDF Lab',uri:meta.uri||null,persist:!!meta.persist});renderHomeLists()}catch(e){console.warn('Catat PDF gagal',e)}};

/* PDF dari pemilih native: animasi buka segera */
/* Kembali dari pembaca PDF: catat halaman terakhir dan jumlah halaman */
window.__TG_PDF_PROGRESS__=async r=>{try{if(!lastPdfRecId||!r?.pages)return;const it=await getRecent(lastPdfRecId);if(!it)return;await updateRecentMeta(lastPdfRecId,{position:{page:+r.page||1},detail:`${r.pages} halaman`});renderHomeLists()}catch(e){console.warn(e)}};
window.__TG_OPENING__=name=>showOpening(name||'dokumen.pdf','pdf',null,true);

/* ---------- Kirim file ke native (bagikan, cetak PDF, buka PDF Lab) ---------- */
async function pushToNative(file,mime){
  if(!bridge?.beginShare)throw new Error('Fitur ini hanya tersedia di aplikasi Android.');
  if(file.size>MAX_FILE)throw new Error('File melebihi batas 120 MB.');
  const id=bridge.beginShare(file.name,mime,file.size);if(!id)throw new Error('Transfer file tidak tersedia.');
  try{
    for(let pos=0;pos<file.size;pos+=48*1024){
      const bytes=new Uint8Array(await file.slice(pos,pos+48*1024).arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));
      if(!bridge.appendShareChunk(id,btoa(binary)))throw new Error('Transfer file gagal.');
    }
    return id;
  }catch(e){bridge.cancelShare?.(id);throw e}
}

/* ---------- Membuka dokumen ---------- */
/* Log diagnostik ringan (tanpa nama berkas) — dikirim ke berkas log native. */
function dlog(m){try{bridge?.diagLog?.(String(m).replace(/[^\s/"'=:]+\.(pdf|docx|xlsx|pptx)\b/gi,'[berkas].$1'))}catch{}}
window.addEventListener('error',e=>dlog(`JS_ERROR ${e.message} @${String(e.filename||'').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection',e=>dlog(`JS_REJECT ${e.reason?.message||e.reason}`));
async function openFile(file,{fromNative=false,uri=null,persist=false}={}){
  const type=extOf(file.name);const t0=performance.now();dlog(`OPEN ${type} size_kb=${Math.round(file.size/1024)} native=${fromNative} persist=${persist}`);lastUri=uri;lastPersist=persist&&!!uri;const recId=reopenId;reopenId=null;
  if(!SUPPORTED[type]){setLoading(false);hideOpening();return toast('Format file belum didukung.')}
  if(file.size>MAX_FILE){setLoading(false);hideOpening();return toast('File terlalu besar (maks 120 MB).')}
  if(type==='pdf'&&bridge?.canOpenNativePdf?.()){
    try{
      const pdf=withMime(file,'pdf');const id=await pushToNative(pdf,'application/pdf');const start=+(restorePosition?.page||0);restorePosition=null;
      if(!(bridge.finishPdfAt?bridge.finishPdfAt(id,start):bridge.finishPdf(id)))throw new Error('PDF tidak dapat diteruskan ke PDF Lab.');
      dlog(`PDF_HANDOFF ms=${Math.round(performance.now()-t0)} start_page=${start}`);
      showOpening(file.name,'pdf',null,true);
      saveRecent(pdf,'pdf',{detail:'PDF Lab',uri,persist:lastPersist,id:recId}).then(id=>{lastPdfRecId=id;renderHomeLists()}).catch(()=>{});
      setLoading(false);if(!viewer.classList.contains('hidden')&&!current)goHome();
      return;
    }catch(err){console.warn('PDF Lab native gagal; memakai penampil cadangan',err);dlog(`PDF_HANDOFF_FAIL ${err?.message||err}`);hideOpening()}
  }
  await flushPosition();cleanup(false);currentType=type;currentFile=withMime(file,type);zoom=1;lastOpened=file;
  if(!fromNative)nativeName=null;
  viewerShowShell(file.name);qs('#viewerFileMeta').textContent=`${SUPPORTED[type].label} · ${formatBytes(file.size)}`;
  viewer.classList.toggle('thumbs-on',false);viewer.classList.toggle('thumbs-off',false);viewer.classList.remove('ppt-scroll');
  setLoading(true,'Membuka '+file.name,'Membaca struktur dokumen…');hideOpening(260);
  try{
    current=type==='docx'?new DocxViewer(host,sub):type==='xlsx'?new XlsxViewer(host,sub):type==='pptx'?new PptxViewer(host,sub):new PdfViewer(host,sub);
    const info=await current.open(currentFile);if(!restorePosition)await applyDefaultView(type);dlog(`OPEN_OK ${type} ms=${Math.round(performance.now()-t0)}`);qs('#viewerFileMeta').textContent=String(info.detail||'').startsWith(SUPPORTED[type].label)?info.detail:`${SUPPORTED[type].label} · ${info.detail}`;setLoading(false);addSearchClose();
    try{
      currentFileId=await saveRecent(currentFile,type,{detail:info.detail,position:restorePosition,uri:lastUri,persist:lastPersist,id:recId});
      if(restorePosition&&current?.restorePosition)await current.restorePosition(restorePosition);restorePosition=null;renderHomeLists();startPositionMemory();
    }catch(storageErr){console.warn('Riwayat tidak tersedia',storageErr)}
  }catch(e){console.error(e);dlog(`OPEN_FAIL ${type} ms=${Math.round(performance.now()-t0)} ${e?.message||e}`);setLoading(false);showError(String(e.message||e))}
}
function viewerShowShell(name){closeMenu();home.classList.add('hidden');qs('#homeTopbar').classList.add('hidden');viewer.classList.remove('hidden');qs('#viewerFileName').textContent=name;qs('#viewerFileMeta').textContent='Memuat…'}
function showError(detail){
  host.innerHTML=`<div class="error-state"><span class="error-ico">${svg(ICON.warn,32)}</span><h3>File tidak bisa dibuka</h3><p>File mungkin rusak, dilindungi kata sandi, atau bukan format yang didukung.</p><p class="muted" style="font-size:12px">${esc(detail).slice(0,180)}</p><button class="solid-btn" id="retryBtn" type="button">Coba lagi</button><button class="soft-btn" id="otherBtn" type="button" style="border:0">Pilih file lain</button></div>`;
  qs('#retryBtn').onclick=()=>{if(lastOpened)openFile(lastOpened,{fromNative:!!nativeName});else goHome()};qs('#otherBtn').onclick=()=>{goHome();choose()};
}
function cleanup(clearFile=true){clearInterval(positionTimer);positionTimer=null;closeMenu();setSearch(false);current?.destroy?.();current=null;if(clearFile){currentFile=null;nativeName=null}host.replaceChildren();sub.classList.add('hidden');sub.replaceChildren();currentType=null;currentFileId=null;zoomChip.classList.add('hidden')}
async function goHome(){await flushPosition();setFocusMode(false);cleanup();viewer.classList.add('hidden');viewer.classList.remove('thumbs-on','thumbs-off','ppt-scroll');home.classList.remove('hidden');qs('#homeTopbar').classList.remove('hidden');try{bridge?.clearNativeShareTarget?.()}catch{}try{bridge?.setPresentationMode?.(false)}catch{}renderHomeLists()}
qs('#backBtn').onclick=goHome;

function startPositionMemory(){clearInterval(positionTimer);positionTimer=setInterval(flushPosition,1400)}
async function flushPosition(){if(!current?.getPosition||!currentFileId)return;try{await updateRecentMeta(currentFileId,{position:current.getPosition()})}catch{}}

/* ---------- Menu penampil ---------- */
function item(icon,label,action,badge=null,badgeOn=false){return{icon,label,action,badge,badgeOn}}
/* Toggle langsung di menu (menu tetap terbuka) */
function seg(icon,label,options,value,pick){return{icon,label,kind:'seg',options,value,pick}}
function sw(icon,label,on,toggle,disabled=false){return{icon,label,kind:'sw',on,toggle,disabled}}
function menuItems(){
  const t=currentType,dark=document.documentElement.dataset.theme==='dark',v=current;
  const head=[];
  if(t==='pptx'){
    head.push(item(ICON.play,'Presentasikan',()=>startPresentation()));
    if(castAvailable())head.push({...item(ICON.cast,'Presentasi ke Layar Lain',()=>openCast({viewer:current,file:currentFile,pushToNative,toast,openSheet,closeSheet:()=>sheet.close(),svg,esc})),sub:'IFP, laptop, atau proyektor lewat browser'});
    head.push(seg(ICON.view,'Tampilan',[['slide','Satu slide'],['scroll','Gulir']],v?.view==='scroll'?'scroll':'slide',id=>{current?.setView?.(id);viewer.classList.toggle('ppt-scroll',id==='scroll');flushPosition()}));
    head.push('-');
    head.push(sw(ICON.grid,'Thumbnail slide',!(viewer.classList.contains('thumbs-off')||v?.view==='scroll'),()=>toggleThumbs(),v?.view==='scroll'));
    head.push(item(ICON.goto,'Lompat ke slide',()=>openJump()));
  }else if(t==='docx'){
    head.push(seg(ICON.doc,'Tampilan',[['mobile','Mengalir'],['print','Halaman']],v?.mode==='print'?'print':'mobile',id=>setDocxMode(id)));
    head.push('-');
    head.push(item(ICON.goto,'Lompat ke halaman',()=>openJump()));
  }else if(t==='xlsx'){
    head.push(item(ICON.fit,'Pas lebar layar',()=>fitView()));
    head.push('-');
  }else if(t==='pdf'){
    head.push(sw(ICON.grid,'Thumbnail',viewer.classList.contains('thumbs-on'),()=>toggleThumbs()));
    head.push(item(ICON.goto,'Lompat ke halaman',()=>openJump()));
  }
  head.push(item(ICON.search,'Cari teks',()=>setSearch(true)));
  head.push('-');
  if(t!=='pptx')head.push(item(ICON.rotate,'Putar layar',()=>rotateScreen()));
  head.push(item(ICON.full,'Layar penuh',()=>toggleFullscreen()));
  head.push(item(dark?ICON.sun:ICON.moon,dark?'Tema terang':'Tema gelap',()=>toggleTheme()));
  head.push(item(ICON.print,'Cetak',()=>printCurrent()));
  head.push(item(ICON.share,'Bagikan '+(SUPPORTED[t]?.label||'file'),()=>shareCurrent()));
  return head;
}
function openMenu(){
  if(!current)return;menu.replaceChildren();
  for(const it of menuItems()){
    if(it==='-'){const s=document.createElement('div');s.className='menu-sep';menu.append(s);continue}
    if(it.kind==='seg'){
      const r=document.createElement('div');r.className='menu-item menu-seg';
      r.innerHTML=`${svg(it.icon,22)}<span>${esc(it.label)}</span><span class="seg" role="radiogroup" aria-label="${esc(it.label)}">${it.options.map(([id,l])=>`<button type="button" role="radio" aria-checked="${id===it.value}" class="${id===it.value?'on':''}" data-id="${id}">${esc(l)}</button>`).join('')}</span>`;
      r.querySelectorAll('[data-id]').forEach(b=>b.onclick=async e=>{e.stopPropagation();if(b.classList.contains('on'))return;r.querySelectorAll('[data-id]').forEach(x=>{x.classList.toggle('on',x===b);x.setAttribute('aria-checked',x===b)});b.classList.add('busy');await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,40)));try{await it.pick(b.dataset.id)}catch(err){console.warn(err)}b.classList.remove('busy');openMenu()});
      menu.append(r);continue;
    }
    const b=document.createElement('button');b.type='button';b.className='menu-item';b.setAttribute('role',it.kind==='sw'?'menuitemcheckbox':'menuitem');
    if(it.kind==='sw'){
      b.setAttribute('aria-checked',!!it.on);if(it.disabled)b.classList.add('dim');
      b.innerHTML=`${svg(it.icon,22)}<span>${esc(it.label)}</span><i class="sw${it.on?' on':''}" aria-hidden="true"></i>`;
      b.onclick=()=>{if(it.disabled){toast('Thumbnail tidak tampil di mode Gulir.');return}it.toggle();setTimeout(openMenu,30)};menu.append(b);continue;
    }
    b.innerHTML=`${svg(it.icon,22)}<span>${esc(it.label)}${it.sub?`<small class="menu-sub">${esc(it.sub)}</small>`:''}</span>${it.badge?`<em class="badge${it.badgeOn?' on':''}">${esc(it.badge)}</em>`:''}`;
    b.onclick=()=>{closeMenu();it.action()};menu.append(b);
  }
  menu.classList.remove('hidden');scrim.classList.remove('hidden');menuBtn.setAttribute('aria-expanded','true');
}
function closeMenu(){menu.classList.add('hidden');scrim.classList.add('hidden');menuBtn.setAttribute('aria-expanded','false')}
menuBtn.onclick=()=>menu.classList.contains('hidden')?openMenu():closeMenu();scrim.onclick=closeMenu;

/* Cari */
function addSearchClose(){if(sub.querySelector('.search-close'))return;const b=document.createElement('button');b.type='button';b.className='search-close';b.setAttribute('aria-label','Tutup pencarian');b.textContent='×';b.onclick=()=>setSearch(false);sub.append(b)}
function setSearch(on){viewer.classList.toggle('search-on',!!on);if(on){const inp=sub.querySelector('input[type="search"]');setTimeout(()=>inp?.focus(),60)}else{current?.clearSearch?.()}}

/* Thumbnail */
function toggleThumbs(){
  if(currentType==='pdf')viewer.classList.toggle('thumbs-on');
  else if(currentType==='pptx'){if(current?.view==='scroll'){toast('Thumbnail tidak tampil di mode Gulir.');return}viewer.classList.toggle('thumbs-off');setTimeout(()=>window.dispatchEvent(new Event('resize')),60)}
}

/* Lompat */
const jumpDialog=qs('#jumpDialog'),jumpInput=qs('#jumpInput');
function totalPages(){if(currentType==='pptx')return current?.slideCount||1;if(currentType==='pdf')return current?.pdf?.numPages||1;if(currentType==='docx')return current?.pages?.length||1;return 1}
function currentPage(){if(currentType==='pptx')return (current?.index||0)+1;return current?.currentPage||1}
function openJump(){
  if(currentType==='docx'&&current?.mode!=='print'){setDocxMode('print');toast('Tampilan diubah ke Halaman agar bisa lompat ke halaman.')}
  const total=totalPages(),noun=currentType==='pptx'?'slide':'halaman';
  qs('#jumpTitle').textContent=`Lompat ke ${noun}`;qs('#jumpHint').textContent=`Masukkan nomor antara 1 dan ${total}.`;jumpInput.min=1;jumpInput.max=total;jumpInput.value=currentPage();
  jumpDialog.showModal();setTimeout(()=>{jumpInput.focus();jumpInput.select()},60);
}
qs('#jumpCancel').onclick=()=>jumpDialog.close();
qs('#jumpForm').onsubmit=e=>{e.preventDefault();const n=clamp(Math.round(+jumpInput.value||1),1,totalPages());jumpDialog.close();if(currentType==='pptx')current?.go?.(n-1);else current?.goToPage?.(n)};
host.addEventListener('click',e=>{if(e.target.closest('.floating-count'))openJump()});

/* Lembar pilihan (bottom sheet) */
const sheet=qs('#sheetDialog'),sheetBody=qs('#sheetBody');
function openSheet(html,bind){sheetBody.innerHTML=html;bind?.(sheetBody);sheet.showModal()}
sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.close()});
function optionSheet(title,options,selected,onPick,note){
  openSheet(`<h3 class="sheet-title">${esc(title)}</h3>${options.map(o=>`<button type="button" class="opt${o.id===selected?' on':''}" data-id="${o.id}"><span class="rad"></span><span><strong>${esc(o.label)}</strong><small>${esc(o.desc)}</small></span></button>`).join('')}${note?`<p class="sheet-note" style="text-align:center">${esc(note)}</p>`:''}`,
    box=>box.querySelectorAll('.opt').forEach(b=>b.onclick=()=>{sheet.close();onPick(b.dataset.id)}));
}
/* Tampilan bawaan dari Pengaturan; file yang pernah dibuka tetap memakai tampilan terakhirnya */
async function applyDefaultView(type){try{if(type==='docx'&&prefs.word==='halaman')await current?.setMode?.('print');else if(type==='pptx'&&prefs.ppt==='gulir')current?.setView?.('scroll')}catch(e){console.warn('Tampilan bawaan',e)}}
async function setDocxMode(id){await current?.setMode?.(id);flushPosition()}
document.addEventListener('tg-ppt-view',e=>viewer.classList.toggle('ppt-scroll',e.detail?.view==='scroll'));

/* Presentasikan: HP mendatar + layar penuh + layar menyala. Hanya Pena, Hapus, Bersihkan. Geser/ketuk tepi untuk pindah slide, Back keluar. */
const PI={pen:'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  eraser:'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.01 4.01 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z',
  clear:'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  close:'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'};
let wakeLock=null,presentTools=null;
async function startPresentation(){
  try{bridge?.setPresentationMode?.(true)}catch{}try{wakeLock=await navigator.wakeLock?.request?.('screen')}catch{}
  await current?.present?.();const ov=qs('.ppt-present-overlay');if(ov)attachPresentTools(ov);watchPresentationEnd();
  if(!bridge?.setPresentationMode){try{await ov?.requestFullscreen?.()}catch{}}
}
function watchPresentationEnd(){const t=setInterval(()=>{if(!current?.presenting){clearInterval(t);try{bridge?.setPresentationMode?.(false)}catch{}try{wakeLock?.release?.()}catch{}wakeLock=null;presentTools?.stop()}},700)}
function attachPresentTools(ov){
  ov.classList.add('tg-tools');const v=current;
  const COLORS=['#E5384F','#F2A900','#2FB36B','#3A86E0','#FFFFFF'],SIZES=[3,6,11];
  let pref={};try{pref=JSON.parse(localStorage.getItem('tg-present-pen')||'{}')}catch{}
  const st={tool:null,bar:false,color:COLORS.includes(pref.color)?pref.color:COLORS[0],size:SIZES.includes(pref.size)?pref.size:SIZES[1],ink:new Map(),stroke:null,shown:-1};
  const save=()=>{try{localStorage.setItem('tg-present-pen',JSON.stringify({color:st.color,size:st.size}))}catch{}};
  const cv=document.createElement('canvas');cv.className='tgp-ink';const ctx=cv.getContext('2d');
  const bar=document.createElement('div');bar.className='tgp-bar';
  bar.innerHTML=`<button type="button" class="tgp-b" data-k="pen" aria-label="Pena">${svg(PI.pen,24)}<span>Pena</span></button><button type="button" class="tgp-b" data-k="eraser" aria-label="Hapus">${svg(PI.eraser,24)}<span>Hapus</span></button><button type="button" class="tgp-b" data-k="clear" aria-label="Bersihkan">${svg(PI.clear,24)}<span>Bersihkan</span></button><span class="tgp-n"></span>`;
  const pop=document.createElement('div');pop.className='tgp-pop hidden';
  ov.append(cv,pop,bar);
  const stopEv=e=>e.stopPropagation();[bar,pop,cv].forEach(el=>['touchstart','touchmove','touchend','click','pointerdown'].forEach(n=>el.addEventListener(n,stopEv)));
  const slideRect=()=>{const el=v?.presentSlide;const r=el?.getBoundingClientRect?.();const o=ov.getBoundingClientRect();return r&&r.width?{x:r.left-o.left,y:r.top-o.top,w:r.width,h:r.height}:{x:0,y:0,w:o.width,h:o.height}};
  const toN=e=>{const r=slideRect(),o=ov.getBoundingClientRect();return[(e.clientX-o.left-r.x)/r.w,(e.clientY-o.top-r.y)/r.h]};
  function size(){const r=ov.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=Math.round(r.width*d);cv.height=Math.round(r.height*d);cv.style.width=r.width+'px';cv.style.height=r.height+'px';ctx.setTransform(d,0,0,d,0,0);redraw()}
  function redraw(){const o=ov.getBoundingClientRect();ctx.clearRect(0,0,o.width,o.height);const r=slideRect();for(const s of st.ink.get(v.index)||[]){if(!s.pts.length)continue;ctx.strokeStyle=s.c;ctx.lineWidth=s.z*(r.w/1000);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();s.pts.forEach(([x,y],i)=>{const px=r.x+x*r.w,py=r.y+y*r.h;i?ctx.lineTo(px,py):ctx.moveTo(px,py)});if(s.pts.length===1)ctx.lineTo(r.x+s.pts[0][0]*r.w+.1,r.y+s.pts[0][1]*r.h);ctx.stroke()}st.shown=v.index}
  function renderPop(){
    bar.querySelector('[data-k="pen"]').style.setProperty('--dot',st.color);
    const show=st.bar&&st.tool==='pen';pop.classList.toggle('hidden',!show);if(!show)return;
    pop.innerHTML=COLORS.map(c=>`<button type="button" class="tgp-dot${c===st.color?' on':''}" data-c="${c}" style="background:${c}" aria-label="Warna"></button>`).join('')+'<i class="tgp-sep"></i>'+SIZES.map((z,i)=>`<button type="button" class="tgp-size${z===st.size?' on':''}" data-z="${z}" aria-label="Ukuran ${i+1}"><i style="width:${Math.round(z*1.6)}px;height:${Math.round(z*1.6)}px"></i></button>`).join('')+`<button type="button" class="tgp-x" data-x aria-label="Tutup bilah">${svg(PI.close,18)}</button>`;
    pop.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{st.color=b.dataset.c;save();renderPop()});
    pop.querySelectorAll('[data-z]').forEach(b=>b.onclick=()=>{st.size=+b.dataset.z;save();renderPop()});
    pop.querySelector('[data-x]').onclick=()=>{st.bar=false;renderPop()};
  }
  /* Alat aktif diketuk lagi: bilah tertutup → buka; bilah terbuka → matikan alat (geser slide aktif lagi). */
  function setTool(k){
    if(k==='clear'){st.ink.delete(v.index);redraw();return}
    if(st.tool===k){if(k==='pen'&&!st.bar){st.bar=true;renderPop();return}st.tool=null;st.bar=false}else{st.tool=k;st.bar=k==='pen'}
    bar.querySelectorAll('[data-k]').forEach(b=>b.classList.toggle('on',b.dataset.k===st.tool));cv.classList.toggle('on',!!st.tool);renderPop();
  }
  bar.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>setTool(b.dataset.k));
  cv.addEventListener('pointerdown',e=>{if(!st.tool)return;cv.setPointerCapture?.(e.pointerId);move(e,true)});
  cv.addEventListener('pointermove',e=>{if(e.buttons||e.pressure>0)move(e,false)});
  const end=()=>{st.stroke=null};cv.addEventListener('pointerup',end);cv.addEventListener('pointercancel',end);
  function move(e,down){
    const p=toN(e);
    if(st.tool==='pen'){if(down){st.stroke={c:st.color,z:st.size,pts:[p]};const l=st.ink.get(v.index)||[];l.push(st.stroke);st.ink.set(v.index,l)}else st.stroke?.pts.push(p);redraw()}
    else if(st.tool==='eraser'){const r=slideRect(),l=st.ink.get(v.index)||[];const keep=l.filter(s=>!s.pts.some(([a,b])=>Math.hypot((a-p[0])*r.w,(b-p[1])*r.h)<22));if(keep.length!==l.length){st.ink.set(v.index,keep);redraw()}}
  }
  /* Ketuk sisi kanan/kiri slide untuk pindah (saat alat mati) */
  const stage=ov.querySelector('.ppt-present-stage');
  const onTap=e=>{if(st.tool||e.target.closest?.('.tgp-bar,.tgp-pop'))return;const o=ov.getBoundingClientRect(),x=(e.clientX-o.left)/o.width;if(x>.62)v.go(v.index+1);else if(x<.38)v.go(v.index-1);wake()};
  stage?.addEventListener('click',onTap);
  let fadeT=null;const wake=()=>{bar.classList.remove('fade');clearTimeout(fadeT);fadeT=setTimeout(()=>{if(!st.tool)bar.classList.add('fade')},3500)};
  ov.addEventListener('pointerdown',wake,{passive:true});
  const n=bar.querySelector('.tgp-n');
  const tick=setInterval(()=>{n.textContent=`${v.index+1} / ${v.slideCount||1}`;if(st.shown!==v.index)setTimeout(redraw,250)},400);
  const onResize=()=>setTimeout(size,180);window.addEventListener('resize',onResize);
  size();renderPop();wake();
  presentTools={stop(){clearInterval(tick);clearTimeout(fadeT);window.removeEventListener('resize',onResize);presentTools=null}};
}

/* Tautan luar: konfirmasi dulu */
function confirmLink(url){
  openSheet(`<h3 class="sheet-title">Buka tautan luar?</h3><p class="sheet-text link-url"></p><p class="sheet-note">Tautan dibuka di peramban dan membutuhkan internet.</p><div class="dialog-actions"><button type="button" class="soft-btn" id="linkNo">Batal</button><button type="button" class="solid-btn" id="linkGo">Buka</button></div>`,box=>{
    box.querySelector('.link-url').textContent=url;box.querySelector('#linkNo').onclick=()=>sheet.close();
    box.querySelector('#linkGo').onclick=()=>{sheet.close();if(bridge?.openExternal)bridge.openExternal(url);else window.open(url,'_blank','noopener')};
  });
}
document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(!a)return;if(!a.closest('#viewerHost,.ppt-present-overlay,#printRoot'))return;const href=a.getAttribute('href')||'';if(!/^(https?:|mailto:)/i.test(href))return;e.preventDefault();e.stopPropagation();confirmLink(a.href)},true);

/* Zoom */
function showZoom(z){qs('#zoomLabel').textContent=Math.round(z*100)+'%';zoomChip.classList.remove('hidden');clearTimeout(zoomTimer);zoomTimer=setTimeout(()=>zoomChip.classList.add('hidden'),2200)}
async function fitView(){let z=1;if(currentType==='pdf'&&current?._applyZoom){current.zoom=1;current._applyZoom(1)}else if(current?.fitWidth)z=await current.fitWidth();else if(current?.fitPage)z=await current.fitPage();else z=await current?.setZoom?.(1)||1;zoom=z||1;showZoom(zoom)}
qs('#fitBtn').onclick=fitView;
document.addEventListener('tg-office-zoom',e=>{const z=clamp(+e.detail?.zoom||1,.12,2.5);zoom=z});

/* Putar layar & layar penuh */
let landscape=false;
async function rotateScreen(){
  if(bridge?.toggleOrientation){landscape=bridge.toggleOrientation()==='landscape';toast(landscape?'Layar mendatar':'Layar tegak',1400);return}
  try{if(!landscape){await screen.orientation.lock('landscape');landscape=true}else{screen.orientation.unlock();landscape=false}}catch{toast('Putar layar tidak didukung di perangkat ini.')}
}
const exitFocusBtn=qs('#exitFocusBtn');
function setFocusMode(on){viewer.classList.toggle('focus-mode',on);exitFocusBtn.classList.toggle('hidden',!on)}
exitFocusBtn.onclick=async()=>{setFocusMode(false);try{bridge?.setImmersive?.(false)}catch{}if(document.fullscreenElement)try{await document.exitFullscreen?.()}catch{}};
async function toggleFullscreen(){
  if(viewer.classList.contains('focus-mode'))return exitFocusBtn.click();
  if(bridge?.setImmersive){bridge.setImmersive(true);setFocusMode(true);return}
  try{if(document.fullscreenEnabled&&viewer.requestFullscreen)await viewer.requestFullscreen()}catch{}setFocusMode(true);
}
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&viewer.classList.contains('focus-mode')&&!bridge?.setImmersive)setFocusMode(false)});

/* Bagikan */
async function shareCurrent(){
  if(!currentFile)return toast('Tidak ada file aktif.');const f=withMime(currentFile,currentType);
  if(bridge){
    try{if(nativeName&&bridge.shareCurrentFile?.(nativeName))return;const id=await pushToNative(f,f.type||MIME[currentType]);if(!bridge.finishShare(id))throw new Error('Gagal membagikan file.');return}
    catch(e){return toast(String(e.message||e))}
  }
  try{if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[f]}))){await navigator.share({files:[f],title:f.name});return}}catch(e){if(e?.name==='AbortError')return}
  const url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),8000);
}

/* ---------- Cetak ---------- */
let printStyle=null;
function setPageSize(css){printStyle?.remove();printStyle=document.createElement('style');printStyle.textContent=`@media print{@page{size:${css};margin:0}}`;document.head.append(printStyle)}
function finishPrint(){document.body.classList.remove('printing');printRoot.classList.remove('preparing');printRoot.replaceChildren();printStyle?.remove();printStyle=null}
window.__TG_PRINT_DONE__=finishPrint;
async function waitImages(root){const imgs=[...root.querySelectorAll('img')];await Promise.all(imgs.map(i=>i.complete?null:new Promise(r=>{i.onload=i.onerror=r;setTimeout(r,4000)})));await new Promise(r=>setTimeout(r,250))}
async function runPrint(job){
  document.body.classList.add('printing');await waitImages(printRoot);
  if(bridge?.printWeb){if(!bridge.printWeb(job))finishPrint();return}
  window.print();setTimeout(finishPrint,800);
}
function printCurrent(){
  if(!current)return;
  if(currentType==='pdf')return printPdf();
  if(currentType==='docx')return printDocx();
  if(currentType==='pptx')return pptPrintSheet();
  if(currentType==='xlsx')return xlsxPrintSheet();
}
async function printPdf(){
  if(!bridge?.finishPrintPdf){toast('Cetak PDF tersedia di aplikasi Android.');return}
  try{const id=await pushToNative(withMime(currentFile,'pdf'),'application/pdf');if(!bridge.finishPrintPdf(id))throw new Error('Dialog cetak tidak tersedia.')}catch(e){toast(String(e.message||e))}
}
async function printDocx(){
  const pages=current?.pages||[];if(!pages.length)return toast('Halaman dokumen belum siap.');
  const pw=current.page?.w||794,ph=current.page?.h||1123;setPageSize(`${(pw/96).toFixed(3)}in ${(ph/96).toFixed(3)}in`);
  printRoot.replaceChildren();printRoot.classList.add('preparing');const wrap=document.createElement('div');wrap.className='print-docx';
  for(const p of pages){const page=document.createElement('div');page.className='print-page';const c=p.cloneNode(true);c.querySelectorAll('mark.tg-search-hit').forEach(m=>m.replaceWith(document.createTextNode(m.textContent)));page.append(c);wrap.append(page)}
  printRoot.append(wrap);toast('Menyiapkan cetak…',1500);await runPrint(baseName()+' (TeGe Office)');
}
function baseName(){return (currentFile?.name||'Dokumen').replace(/\.[^.]+$/,'')}
function segHtml(name,opts,sel){return `<div class="seg" data-seg="${name}">${opts.map(([v,l])=>`<button type="button" data-v="${v}" class="${v===sel?'on':''}">${esc(l)}</button>`).join('')}</div>`}
function bindSeg(box){box.querySelectorAll('.seg').forEach(seg=>seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{seg.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');seg.dataset.value=b.dataset.v;box.dispatchEvent(new Event('change'))}))}
function segVal(box,name){const seg=box.querySelector(`[data-seg="${name}"]`);return seg?.querySelector('button.on')?.dataset.v}
function pptPrintSheet(){
  const total=current?.slideCount||1;
  openSheet(`<h3 class="sheet-title">Cetak PowerPoint</h3><div class="sheet-label">SLIDE PER LEMBAR</div>${segHtml('per',[['1','1'],['4','4'],['6','6']],'1')}<div class="sheet-label">RENTANG</div>${segHtml('range',[['all','Semua'],['cur','Slide ini']],'all')}<p class="sheet-note" id="pptNote"></p><button class="solid-btn" id="pptGo" type="button">Lanjut ke dialog cetak</button>`,box=>{
    bindSeg(box);const note=()=>{const per=+segVal(box,'per'),n=segVal(box,'range')==='cur'?1:total;box.querySelector('#pptNote').textContent=`${n} slide akan menjadi ${Math.ceil(n/per)} lembar. Slide digambar dulu sebelum dicetak, jadi file besar butuh beberapa detik.`};note();box.addEventListener('change',note);
    box.querySelector('#pptGo').onclick=()=>{const per=+segVal(box,'per'),range=segVal(box,'range');sheet.close();printPpt(per,range)};
  });
}
async function printPpt(per,range){
  const total=current.slideCount||1,list=range==='cur'?[current.index||0]:[...Array(total).keys()];
  const portrait=per===6,pageW=portrait?790:1119,pageH=portrait?1119:790,cols=per===1?1:2,rows=per===1?1:per===4?2:3,pad=per===1?24:30,gap=per===1?0:16;
  setPageSize(portrait?'A4 portrait':'A4 landscape');printRoot.replaceChildren();printRoot.classList.add('preparing');setLoading(true,'Menyiapkan cetak','Menggambar slide…');
  const {w:sw,h:sh}=current.slidePx();const cellW=(pageW-pad*2-gap*(cols-1))/cols,cellH=(pageH-pad*2-gap*(rows-1))/rows,scale=Math.min(cellW/sw,cellH/sh);
  try{
    for(let p=0;p<list.length;p+=per){
      const page=document.createElement('div');page.className='print-page';page.style.cssText=`width:${pageW}px;height:${pageH}px;padding:${pad}px;box-sizing:border-box;display:grid;grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},1fr);gap:${gap}px;align-items:center;justify-items:center`;
      for(const i of list.slice(p,p+per)){qs('#loadingText').textContent=`Menggambar slide ${i+1} dari ${total}…`;const cell=document.createElement('div');cell.className='print-slide';cell.style.cssText=`width:${sw*scale}px;height:${sh*scale}px`;const stage=document.createElement('div');stage.className='stage';stage.style.transform=`scale(${scale})`;cell.append(stage);page.append(cell);printRoot.append(page);await current.renderSlideInto(i,stage)}
      printRoot.append(page);
    }
  }catch(e){console.error(e);setLoading(false);finishPrint();return toast('Slide gagal disiapkan untuk dicetak.')}
  setLoading(false);await runPrint(baseName()+' (TeGe Office)');
}
function xlsxPrintSheet(){
  const many=(current?.book?.sheets?.length||1)>1;
  openSheet(`<h3 class="sheet-title">Cetak Excel</h3>${many?`<div class="sheet-label">YANG DICETAK</div>${segHtml('what',[['cur','Sheet ini'],['all','Semua sheet']],'cur')}`:''}<div class="sheet-label">UKURAN</div>${segHtml('fit',[['fit','Muat lebar kertas'],['real','Ukuran asli']],'fit')}<div class="sheet-label">ARAH KERTAS</div>${segHtml('orient',[['portrait','Tegak'],['landscape','Mendatar']],'landscape')}<p class="sheet-note">Tabel yang lebar diperkecil agar semua kolom muat dalam satu lembar.</p><button class="solid-btn" id="xlsGo" type="button">Lanjut ke dialog cetak</button>`,box=>{
    bindSeg(box);box.querySelector('#xlsGo').onclick=()=>{const o={what:segVal(box,'what')||'cur',fit:segVal(box,'fit'),orient:segVal(box,'orient')};sheet.close();printXlsx(o)};
  });
}
async function printXlsx({what,fit,orient}){
  const v=current,active=v.active||0,idx=what==='all'?v.book.sheets.map((_,i)=>i):[active];const pageW=orient==='portrait'?790:1119,avail=pageW-70;
  setPageSize(`A4 ${orient}`);printRoot.replaceChildren();printRoot.classList.add('preparing');
  for(const i of idx){
    if(i!==v.active)v._show(i);const table=v.frame?.querySelector('table');if(!table)continue;
    const page=document.createElement('div');page.className='print-page print-sheet';const title=document.createElement('div');title.style.cssText='font:700 11pt sans-serif;margin:0 0 3mm';title.textContent=v.book.sheets[i].name;
    const clone=table.cloneNode(true);clone.style.zoom='1';const holder=document.createElement('div');holder.append(clone);page.append(title,holder);printRoot.append(page);
    if(fit==='fit'){const w=table.scrollWidth/(parseFloat(v.paper?.style.zoom)||1);holder.style.zoom=String(Math.min(1,avail/Math.max(1,w)))}
  }
  if(v.active!==active)v._show(active);
  await runPrint(baseName()+' (TeGe Office)');
}

/* ---------- Animasi buka file (segera setelah disentuh) ---------- */
const openFx=qs('#openFx');let openFxTimer=null,openFxWaitHidden=false;
function showOpening(name,type,rect=null,waitNative=false){
  if(!openFx)return;clearTimeout(openFxTimer);
  openFx.querySelector('.open-fx-ico').innerHTML=fmtIcon(type||extOf(name)||'pdf','huge still');
  openFx.querySelector('.open-fx-name').textContent=name||'Dokumen';
  const card=openFx.querySelector('.open-fx-card');
  card.style.transformOrigin=rect?`50% ${Math.round(rect.top+rect.height/2-window.innerHeight*.3)}px`:'50% 50%';
  openFx.classList.remove('hidden','out');void openFx.offsetWidth;openFx.classList.add('show');
  openFxWaitHidden=waitNative;openFxTimer=setTimeout(()=>hideOpening(),waitNative?15000:8000);
}
function hideOpening(delay=0){
  if(!openFx||openFx.classList.contains('hidden'))return;clearTimeout(openFxTimer);
  openFxTimer=setTimeout(()=>{openFx.classList.add('out');setTimeout(()=>{openFx.classList.add('hidden');openFx.classList.remove('show','out')},220)},delay);openFxWaitHidden=false;
}
/* PDF dibuka pembaca native: tutup animasi saat pengguna kembali ke TeGe Office */
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&openFxWaitHidden){openFxWaitHidden=false;clearTimeout(openFxTimer);openFxTimer=setTimeout(()=>hideOpening(),400)}else if(document.visibilityState==='visible')hideOpening(150)});

/* ---------- Beranda: hero, riwayat, sematan ---------- */
async function openCached(item,rect=null){
  const x=await getRecent(item.id);if(!x)return;const type=x.type||extOf(x.name);
  /* Utama: buka lewat alamat file (riwayat tanpa salinan) */
  if(x.uri&&bridge?.openUri&&(x.persist||!x.blob)){
    const page=type==='pdf'?+(x.position?.page||0):0;
    restorePosition=type==='pdf'?null:(x.position||null);reopenId=x.id;
    const r=bridge.openUri(x.uri,page);
    if(r==='ok'){showOpening(x.name,type,rect,type==='pdf');if(type==='pdf'){reopenId=null;lastPdfRecId=x.id;await updateRecentMeta(x.id,{openedAt:Date.now()});renderHomeLists()}return}
    reopenId=null;restorePosition=null;if(!x.blob)return missingFile(x);
  }
  if(x.blob){restorePosition=x.position||null;showOpening(x.name,type,rect,type==='pdf');const f=new File([x.blob],x.name,{type:x.blob.type||MIME[x.type]||'',lastModified:x.lastModified});nativeName=null;setTimeout(()=>{reopenId=x.id;openFile(f)},60)}
  else missingFile(x);
}
function missingFile(x){
  const type=x.type||extOf(x.name);
  openSheet(`<div class="sheet-file">${fmtIcon(type,'small still')}<span><strong></strong><small>File tidak ditemukan</small></span></div><p class="sheet-text">File mungkin sudah dipindah, diganti nama di aplikasi lain, atau dihapus. Pilih lagi file tersebut dari perangkat.</p><div class="dialog-actions"><button type="button" class="soft-btn" id="mfDel">Hapus dari riwayat</button><button type="button" class="solid-btn" id="mfPick">Pilih lagi</button></div>`,box=>{
    box.querySelector('.sheet-file strong').textContent=x.name;
    box.querySelector('#mfDel').onclick=async()=>{sheet.close();await removeRecent(x.id);renderHomeLists();toast('Dihapus dari riwayat.')};
    box.querySelector('#mfPick').onclick=()=>{sheet.close();choose(type)};
  });
}
function whenText(ts){if(!ts)return'';const d=new Date(ts),now=new Date(),y=new Date(now);y.setDate(now.getDate()-1);const hm=d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});if(d.toDateString()===now.toDateString())return `Hari ini, ${hm}`;if(d.toDateString()===y.toDateString())return `Kemarin, ${hm}`;return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+', '+hm}
async function togglePin(it,pinned){if(pinned)await unpinRecent(it.id);else{const r=await pinRecent(it.id);if(!r.ok&&r.reason==='limit')return toast(`Maksimal ${MAX_PINNED} file dapat disematkan.`)}renderHomeLists()}
function countOf(it){const m=String(it.detail||'').match(/(\d+)\s*(halaman|slide|sheet)/i);return m?{n:+m[1],noun:m[2].toLowerCase()}:null}
function progressOf(it){
  const type=it.type||extOf(it.name),pos=it.position||{},c=countOf(it);if(!c)return null;
  if(type==='xlsx'){const cur=(+pos.sheet||0)+1;return{pct:null,text:`Sheet ${Math.min(cur,c.n)} dari ${c.n}`}}
  const cur=+(pos.slide||pos.page||0);if(!cur)return null;
  return{pct:clamp(cur/c.n,0,1),text:`${type==='pptx'?'Slide':'Halaman'} ${Math.min(cur,c.n)} dari ${c.n}`};
}
/* Tekan lama pada baris: menu Ganti nama / Sematkan / Hapus */
function bindLongPress(el,fn){
  let t=null,sx=0,sy=0,fired=false;const cancel=()=>{clearTimeout(t);t=null};
  el.addEventListener('touchstart',e=>{fired=false;const p=e.touches[0];sx=p.clientX;sy=p.clientY;t=setTimeout(()=>{fired=true;t=null;try{navigator.vibrate?.(12)}catch{}fn()},480)},{passive:true});
  el.addEventListener('touchmove',e=>{const p=e.touches[0];if(Math.hypot(p.clientX-sx,p.clientY-sy)>10)cancel()},{passive:true});
  el.addEventListener('touchend',e=>{cancel();if(fired){e.preventDefault();fired=false;el.dataset.lp='1';setTimeout(()=>delete el.dataset.lp,400)}});
  el.addEventListener('touchcancel',cancel);
  el.addEventListener('contextmenu',e=>{e.preventDefault();if(!fired&&!el.dataset.lp){fired=false;fn()}});
}
function makeRow(it,pinned){
  const row=document.createElement('div');row.className='row';const type=it.type||extOf(it.name);
  row.innerHTML=`<button type="button" class="row-open">${fmtIcon(type,'small still')}<span class="row-copy"><strong></strong><small></small></span></button><button type="button" class="row-pin${pinned?' on':''}" aria-label="${pinned?'Lepas sematan':'Sematkan'}">${svg(pinned?ICON.star:ICON.starOutline)}</button>`;
  const c=countOf(it);row.querySelector('strong').textContent=it.name;row.querySelector('small').textContent=[it.size?formatBytes(+it.size):'',whenText(it.openedAt),c?`${c.n} ${c.noun}`:''].filter(Boolean).join(' · ');
  const open=row.querySelector('.row-open');open.onclick=()=>{if(open.dataset.lp)return;openCached(it,row.getBoundingClientRect())};
  bindLongPress(open,()=>rowActions(it,pinned));row.querySelector('.row-pin').onclick=()=>togglePin(it,pinned);return row;
}
function renderList(list,items,{pinned,all}){
  list.replaceChildren();
  if(!items.length){
    if(pinned){const e=document.createElement('div');e.className='empty compact';e.textContent='Ketuk bintang atau tekan lama file di Terakhir dibuka untuk menyematkannya di sini.';list.append(e)}
    else{const e=document.createElement('div');e.className='empty compact';e.textContent='File yang Anda buka akan muncul di sini, lengkap dengan posisi terakhir baca.';list.append(e)}
    return;
  }
  for(const it of all?items:items.slice(0,HOME_PREVIEW))list.append(makeRow(it,pinned));
}
const TYPES=['docx','xlsx','pptx','pdf'];
/* Sapaan sesuai jam HP: pagi 04–10, siang 11–14, sore 15–17, malam sisanya */
function greeting(){const h=new Date().getHours(),w=h>=4&&h<11?'pagi':h>=11&&h<15?'siang':h>=15&&h<18?'sore':'malam';return `Selamat ${w}! Lanjut membaca yang tadi?`}
function renderHero(last){
  const hero=qs('#hero');if(!hero)return;
  if(!last){
    hero.className='hero hx-empty';
    hero.innerHTML=`<div class="hx-dots"></div><div class="hx-floor"></div><div class="hx-cluster">${TYPES.map((t,i)=>`<button type="button" class="hx-tile t${i}" data-open-type="${t}" aria-label="Buka file ${SUPPORTED[t].label}">${fmtIcon(t,'hx-ico d'+i)}</button>`).join('')}</div><div class="hx-copy"><strong>Buka dokumen apa hari ini?</strong><span>DOCX · XLSX · PPTX · PDF · tanpa internet</span></div>`;
  }else{
    const type=last.type||extOf(last.name),pr=progressOf(last);hero.className='hero hx-continue';
    const r=20,c=2*Math.PI*r,ring=pr&&pr.pct!=null?`<svg class="hx-ring" viewBox="0 0 48 48" aria-label="${Math.round(pr.pct*100)} persen"><circle cx="24" cy="24" r="${r}" class="track"/><circle cx="24" cy="24" r="${r}" class="bar" stroke-dasharray="${(c*pr.pct).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 24 24)"/><text x="24" y="28.5" text-anchor="middle">${Math.round(pr.pct*100)}%</text></svg>`:'';
    hero.innerHTML=`<div class="hx-dots"></div><div class="hx-head"><span class="hx-greet">${greeting()}</span></div><div class="hx-stack s2"></div><div class="hx-stack s1"></div><div class="hx-card"><div class="hx-card-top"><span class="hx-thumb ${KIND[type]||'k-doc'}"><i></i><b></b><b></b><b></b></span><span class="hx-info"><strong></strong><small></small></span>${ring}</div><button type="button" class="hx-go">Lanjutkan ${svg('M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z',20)}</button></div>`;
    hero.querySelector('.hx-info strong').textContent=last.name;hero.querySelector('.hx-info small').textContent=pr?.text||[SUPPORTED[type]?.label,whenText(last.openedAt)].filter(Boolean).join(' · ');
    const go=()=>openCached(last,hero.querySelector('.hx-card').getBoundingClientRect());hero.querySelector('.hx-go').onclick=go;hero.querySelector('.hx-thumb').onclick=go;
  }
  hero.querySelectorAll('[data-open-type]').forEach(b=>b.onclick=()=>choose(b.dataset.openType));
}
async function renderHomeLists(){
  const [pins,recents]=await Promise.all([listPinned().catch(()=>[]),listRecent().catch(()=>[])]);
  recents.sort((a,b)=>(b.openedAt||0)-(a.openedAt||0));
  const last=[...pins,...recents].sort((a,b)=>(b.openedAt||0)-(a.openedAt||0))[0]||null;renderHero(prefs.progres?last:null);
  qs('#pinnedSection').classList.toggle('hidden',!pins.length&&!recents.length);qs('#recentSection').classList.toggle('hidden',!recents.length&&!pins.length);
  renderList(qs('#pinnedList'),pins,{pinned:true,all:showAllPinned});renderList(qs('#recentList'),recents,{pinned:false,all:showAllRecent});
  const mp=qs('#morePinnedBtn'),mr=qs('#moreRecentBtn');mp.classList.toggle('hidden',pins.length<=HOME_PREVIEW);mp.textContent=showAllPinned?'Ringkas':'Selengkapnya';
  mr.classList.toggle('hidden',recents.length<=HOME_PREVIEW);mr.textContent=showAllRecent?'Ringkas':'Selengkapnya';qs('#clearRecentBtn').classList.toggle('hidden',!recents.length);
}
qs('#morePinnedBtn').onclick=()=>{showAllPinned=!showAllPinned;renderHomeLists()};qs('#moreRecentBtn').onclick=()=>{showAllRecent=!showAllRecent;renderHomeLists()};
qs('#clearRecentBtn').onclick=async()=>{await clearRecent();showAllRecent=false;await renderHomeLists();toast('Riwayat dibersihkan. File yang disematkan tetap ada.')};

/* ---------- Ganti nama file ---------- */
function rowActions(it,pinned){
  const type=it.type||extOf(it.name);
  openSheet(`<div class="sheet-file">${fmtIcon(type,'small still')}<span><strong></strong><small>${esc(SUPPORTED[type]?.label||'')}</small></span></div>
    <button type="button" class="act" data-a="rename">${svg('M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',22)}<span>Ganti nama</span></button>
    <button type="button" class="act" data-a="pin">${svg(pinned?ICON.star:ICON.starOutline,22)}<span>${pinned?'Lepas sematan':'Sematkan file'}</span></button>
    <button type="button" class="act danger" data-a="remove">${svg('M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',22)}<span>Hapus dari riwayat</span></button>
    <p class="sheet-note">Menghapus dari riwayat tidak menghapus file di perangkat.</p>`,box=>{
    box.querySelector('.sheet-file strong').textContent=it.name;
    box.querySelectorAll('.act').forEach(b=>b.onclick=async()=>{sheet.close();const a=b.dataset.a;
      if(a==='rename')renameSheet(it);else if(a==='pin')togglePin(it,pinned);else{await removeRecent(it.id);renderHomeLists();toast('Dihapus dari riwayat.')}});
  });
}
function splitName(n){const i=n.lastIndexOf('.');return i>0?[n.slice(0,i),n.slice(i)]:[n,'']}
function renameSheet(it){
  const [base,ext]=splitName(it.name);
  openSheet(`<h3 class="sheet-title">Ganti nama file</h3><form id="renameForm" class="rename-form"><div class="rename-field"><input id="renameInput" type="text" maxlength="120" autocomplete="off" spellcheck="false"><span>${esc(ext)}</span></div><p class="sheet-note">Nama file asli di perangkat ikut berubah bila sumbernya mengizinkan.</p><div class="dialog-actions"><button type="button" class="soft-btn" id="renameCancel">Batal</button><button type="submit" class="solid-btn">Simpan</button></div></form>`,box=>{
    const inp=box.querySelector('#renameInput');inp.value=base;setTimeout(()=>{inp.focus();inp.select()},80);
    box.querySelector('#renameCancel').onclick=()=>sheet.close();
    box.querySelector('#renameForm').onsubmit=e=>{e.preventDefault();const v=inp.value.replace(/[\\/:*?"<>|]+/g,' ').replace(/\s+/g,' ').trim();if(!v)return inp.focus();sheet.close();if(v+ext!==it.name)doRename(it,v+ext)};
  });
}
async function doRename(it,newName){
  if(bridge?.renameDocument&&it.uri){
    let r={};try{r=JSON.parse(bridge.renameDocument(it.uri,newName)||'{}')}catch{}
    if(r.ok){await updateRecentMeta(it.id,{name:r.name||newName,uri:r.uri||it.uri});renderHomeLists();return toast('Nama file diganti.')}
  }
  if(!bridge?.finishSaveAs){await updateRecentMeta(it.id,{name:newName});renderHomeLists();return toast('Nama diganti di riwayat.')}
  openSheet(`<h3 class="sheet-title">Tidak bisa ganti nama langsung</h3><p class="sheet-text">File ini berasal dari aplikasi lain (misalnya WhatsApp) atau hanya boleh dibaca. TeGe Office bisa menyimpan salinan bernama <strong></strong>, lalu riwayat memakai salinan itu.</p><div class="dialog-actions"><button type="button" class="soft-btn" id="copyCancel">Batal</button><button type="button" class="solid-btn" id="copyGo">Simpan salinan</button></div>`,box=>{
    box.querySelector('.sheet-text strong').textContent=newName;box.querySelector('#copyCancel').onclick=()=>sheet.close();
    box.querySelector('#copyGo').onclick=()=>{sheet.close();saveCopyAs(it,newName)};
  });
}
let savedAsResolve=null;window.__TG_SAVED_AS__=r=>{savedAsResolve?.(r||{ok:false});savedAsResolve=null};
async function saveCopyAs(it,newName){
  try{
    const x=await getRecent(it.id);
    if(!x?.blob&&x?.uri&&bridge?.saveCopyFromUri){const done=new Promise(res=>{savedAsResolve=res});if(!bridge.saveCopyFromUri(x.uri,newName))throw new Error('File asli tidak ditemukan. Pilih lagi dari perangkat.');const r=await done;if(!r.ok)return toast('Salinan tidak disimpan.');await updateRecentMeta(it.id,{name:r.name||newName,uri:r.uri||null,persist:!!r.uri});renderHomeLists();return toast('Salinan tersimpan. Riwayat kini memakai '+(r.name||newName)+'.',4000)}
    if(!x?.blob)throw new Error('Salinan file tidak ditemukan. Buka lagi dari perangkat.');
    const type=x.type||extOf(x.name),f=new File([x.blob],newName,{type:MIME[type]||x.blob.type||''});
    const id=await pushToNative(f,f.type);const done=new Promise(res=>{savedAsResolve=res});
    if(!bridge.finishSaveAs(id,newName))throw new Error('Dialog simpan tidak tersedia.');
    const r=await done;if(!r.ok)return toast('Salinan tidak disimpan.');
    await updateRecentMeta(it.id,{name:r.name||newName,uri:r.uri||null,persist:!!r.uri,blob:r.uri?null:x.blob});renderHomeLists();toast('Salinan tersimpan. Riwayat kini memakai '+(r.name||newName)+'.',4000);
  }catch(e){toast(String(e.message||e))}
}

/* ---------- Tema ---------- */
const root=document.documentElement;
function applyTheme(t){root.dataset.theme=t;const dark=t==='dark';qs('meta[name="theme-color"]')?.setAttribute('content',dark?'#0E151E':'#E6ECF4');try{bridge?.setSystemTheme?.(dark)}catch{}}
function toggleTheme(){const t=root.dataset.theme==='dark'?'light':'dark';applyTheme(t);try{localStorage.setItem('tg-office-theme',t)}catch{}}
let savedTheme=null;try{savedTheme=localStorage.getItem('tg-office-theme')}catch{}
applyTheme(savedTheme||(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light'));
qs('#themeBtn').onclick=toggleTheme;

/* ---------- Tentang ---------- */
const about=qs('#aboutDialog');qs('#aboutVersion').textContent=APP_VERSION;
/* ---------- Pengaturan ---------- */
const settings=qs('#settingsDialog');qs('#setAboutVer').textContent=APP_VERSION;
const mb=n=>(n/1048576).toFixed(1).replace('.',',');
async function refreshUsage(){let used=0;try{used=await storageUsed()}catch{}qs('#setUsageText').textContent=`${mb(used)} MB dari ${Math.round(MAX_TOTAL/1048576)} MB`;qs('#setUsageBar').style.width=Math.min(100,used/MAX_TOTAL*100).toFixed(1)+'%'}
function renderSettings(){
  const p=qs('#setProgres');p.setAttribute('aria-checked',String(!!prefs.progres));p.querySelector('.sw').classList.toggle('on',!!prefs.progres);
  qsa('.set-seg',settings).forEach(g=>g.querySelectorAll('button').forEach(b=>{const on=prefs[g.dataset.pref]===b.dataset.v;b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}));
  refreshUsage();
}
qs('#settingsBtn').onclick=()=>{renderSettings();settings.showModal()};
qs('#closeSettingsBtn').onclick=()=>settings.close();
qs('#setProgres').onclick=()=>{prefs.progres=!prefs.progres;savePrefs();renderSettings();renderHomeLists()};
qsa('.set-seg',settings).forEach(g=>g.onclick=e=>{const b=e.target.closest('button');if(!b)return;prefs[g.dataset.pref]=b.dataset.v;savePrefs();renderSettings()});
function confirmSheet(title,text,okLabel,danger,run){
  openSheet(`<h3 class="sheet-title"></h3><p class="sheet-text"></p><div class="dialog-actions"><button type="button" class="soft-btn" id="cfNo">Batal</button><button type="button" class="solid-btn${danger?' danger':''}" id="cfYes"></button></div>`,box=>{
    box.querySelector('.sheet-title').textContent=title;box.querySelector('.sheet-text').textContent=text;box.querySelector('#cfYes').textContent=okLabel;
    box.querySelector('#cfNo').onclick=()=>sheet.close();box.querySelector('#cfYes').onclick=async()=>{sheet.close();await run()};
  });
}
qs('#setClearCopies').onclick=()=>confirmSheet('Bersihkan salinan sementara?','File dari aplikasi lain (misalnya WhatsApp) akan hilang dari riwayat. File aslinya di HP tidak ikut terhapus.','Bersihkan',false,async()=>{const n=await clearCopies().catch(()=>0);await renderHomeLists();refreshUsage();toast(n?'Salinan sementara dibersihkan.':'Tidak ada salinan sementara.')});
qs('#setClearAll').onclick=()=>confirmSheet('Hapus semua riwayat?','Semua file di Terakhir dibuka dan File tersemat dihapus dari daftar, termasuk salinan sementara. File di HP tidak ikut terhapus.','Hapus semua',true,async()=>{await clearAllRecent().catch(()=>{});showAllRecent=false;showAllPinned=false;await renderHomeLists();refreshUsage();toast('Semua riwayat dihapus.')});
qs('#setFeedback').onclick=()=>{const url='mailto:totogutomo92@gmail.com?subject='+encodeURIComponent('Masukan TeGe Office '+APP_VERSION.replace('Versi ',''));if(bridge?.openExternal)bridge.openExternal(url);else location.href=url};
qs('#setAbout').onclick=()=>about.showModal();
savePrefs();
/* Diagnostik tersembunyi: ketuk versi 5x untuk menampilkan Salin/Kirim log. */
{let n=0,tm=0;const v=qs('#aboutVersion'),d=qs('#diagCard');if(v&&d){v.addEventListener('click',()=>{clearTimeout(tm);tm=setTimeout(()=>n=0,2500);if(++n>=5){n=0;d.hidden=!d.hidden;if(!d.hidden)d.scrollIntoView({behavior:'smooth',block:'center'})}});
  const flash=(b,t)=>{const o=b.dataset.label||(b.dataset.label=b.textContent);b.textContent=t;setTimeout(()=>b.textContent=o,1800)};
  qs('#diagCopyBtn').onclick=e=>flash(e.currentTarget,bridge?.diagCopy?.()?'Tersalin ✓':'Tidak tersedia');
  qs('#diagShareBtn').onclick=e=>{if(!bridge?.diagShare?.())flash(e.currentTarget,'Tidak tersedia')};}}qs('#closeAboutBtn').onclick=()=>about.close();

/* ---------- Tombol kembali Android ---------- */
window.__TG_BACK__=()=>{
  if(document.body.classList.contains('printing'))return 'handled';
  {const ds=qsa('dialog[open]');if(ds.length){ds[ds.length-1].close();return 'handled'}}
  if(!menu.classList.contains('hidden')){closeMenu();return 'handled'}
  if(castBack())return 'handled';
  const pc=qs('.ppt-present-close');if(pc){pc.click();return 'handled'}
  if(viewer.classList.contains('focus-mode')){exitFocusBtn.click();return 'handled'}
  if(viewer.classList.contains('search-on')){setSearch(false);return 'handled'}
  if(openFx&&!openFx.classList.contains('hidden')){hideOpening();return 'handled'}
  /* Mendatar: Back pertama kembali ke tegak dulu, baru Back berikutnya ke beranda */
  if(!viewer.classList.contains('hidden')&&(landscape||window.innerWidth>window.innerHeight)&&bridge?.forcePortrait){landscape=false;bridge.forcePortrait();return 'handled'}
  if(!viewer.classList.contains('hidden')){goHome();return 'handled'}
  return 'none';
};

/* ---------- Cubit zoom (dokumen saja, toolbar tetap) ---------- */
let pinch=null,pinchRaf=0;function touchDistance(t){const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.hypot(dx,dy)}
/* PowerPoint: zoom dimatikan (berat di HP). Arahkan ke Presentasikan. */
let pptZoomHintAt=0;
function pptZoomHint(){const now=Date.now();if(now-pptZoomHintAt<4000)return;pptZoomHintAt=now;toast('Untuk tampilan lebih luas, gunakan menu Presentasikan.',2600)}
host.addEventListener('touchstart',e=>{if(e.touches.length===2&&currentType==='pptx'){pinch=null;pptZoomHint();return}if(e.touches.length===2){pinch={start:touchDistance(e.touches),base:zoom,last:zoom};current?.beginPinch?.()}},{passive:true});
host.addEventListener('touchmove',e=>{if(!pinch||e.touches.length!==2)return;const next=clamp(pinch.base*(touchDistance(e.touches)/Math.max(1,pinch.start)),.12,2.5);pinch.last=next;cancelAnimationFrame(pinchRaf);pinchRaf=requestAnimationFrame(()=>{current?.previewZoom?.(next);showZoom(next)})},{passive:true});
host.addEventListener('touchend',async e=>{if(!pinch||e.touches.length>=2)return;const final=pinch.last;pinch=null;zoom=await current?.setZoom?.(final)||final;current?.endPinch?.();showZoom(zoom)},{passive:true});

(async()=>{try{if(bridge?.isPersisted){const freed=await dropCopies(u=>{try{return bridge.isPersisted(u)}catch{return false}});if(freed)console.info('Salinan riwayat dibuang',freed)}}catch(e){console.warn(e)}renderHomeLists()})();
try{bridge?.onWebReady?.()}catch{}
