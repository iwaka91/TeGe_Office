import {qrSvg} from './qr.js';
/* Presentasi Nirkabel — sisi HP: pasangkan (QR, alamat, kode) lalu pengendali.
   Pesan ke IFP lewat AndroidBridge.castSend; pesan dari IFP masuk lewat window.__TG_CAST__. */
const bridge=window.AndroidBridge||null;
const I={back:'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',menu:'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  prev:'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',next:'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z',
  pen:'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  eraser:'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.01 4.01 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z',
  laser:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1zM2 12a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm16 0a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2h-2a1 1 0 0 1-1-1z',
  spot:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  blank:'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5v2h3v2H7v-2h3v-2H5a2 2 0 0 1-2-2z',
  play:'M8 5v14l11-7z',pause:'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
  back10:'M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z',
  fwd10:'M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6 2.69-6 6-6v4l5-5-5-5v4c-4.42 0-8 3.58-8 8s3.58 8 8 8 8-3.58 8-8h-2z',
  vol:'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z',
  note:'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  wifi:'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3a4.237 4.237 0 0 0-6 0zm-4-4l2 2a7.074 7.074 0 0 1 10 0l2-2C15.14 9.14 8.87 9.14 5 13z',
  check:'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',close:'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  text:'M5 4v3h5.5v12h3V7H19V4z',undo:'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z'};
const COLORS=['#E5384F','#F2A900','#2FB36B','#3A86E0','#FFFFFF'],SIZES=[3,6,11],LCOLORS=['#FF2A2A','#2FB36B','#3A86E0','#F2A900','#FFFFFF'],LSIZES=[10,16,24],SPOTS=[.08,.12,.18];
const TSIZES=[[30,'Kecil'],[46,'Sedang'],[70,'Besar']];
const OPT_KEY='tg-cast-opts',PREF_KEY='tg-ink-prefs';
function loadPrefs(){let o={};try{o=JSON.parse(localStorage.getItem(PREF_KEY)||'{}')}catch{}const pick=(v,list,d)=>list.includes(v)?v:d;
  return{color:pick(o.color,COLORS,COLORS[0]),size:pick(o.size,SIZES,SIZES[1]),lcolor:pick(o.lcolor,LCOLORS,LCOLORS[0]),lsize:pick(o.lsize,LSIZES,LSIZES[1]),spot:pick(o.spot,SPOTS,SPOTS[1]),tcolor:pick(o.tcolor,COLORS,COLORS[0]),tsize:pick(o.tsize,TSIZES.map(x=>x[0]),46)}}
function savePrefs(){try{const {color,size,lcolor,lsize,spot,tcolor,tsize}=S;localStorage.setItem(PREF_KEY,JSON.stringify({color,size,lcolor,lsize,spot,tcolor,tsize}))}catch{}}
let S=null;
export function castAvailable(){return !!bridge?.castStart}
export function castBack(){if(!S)return false;S.root.classList.remove('hidden');confirmEnd();return true}
export function castActive(){return !!S}
function loadOpts(){let o={};try{o=JSON.parse(localStorage.getItem(OPT_KEY)||'{}')}catch{}return{notes:o.notes!==false,next:o.next!==false,ifpInk:o.ifpInk!==false,awake:o.awake!==false}}
function saveOpts(){try{localStorage.setItem(OPT_KEY,JSON.stringify(S.opts))}catch{}}
const send=m=>{try{bridge?.castSend?.(JSON.stringify(m))}catch{}};

export async function openCast(ctx){
  if(S){S.root.classList.remove('hidden');return}
  const {viewer,file,pushToNative,toast}=ctx;
  if(!viewer||!file)return toast('Buka file PPTX dulu.');
  toast('Menyiapkan Presentasi ke Layar Lain…',1600);
  let info;
  try{
    const id=await pushToNative(file,file.type||'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    info=JSON.parse(bridge.castStart(id,file.name)||'{}');
  }catch(e){return toast(String(e.message||e))}
  if(!info.ok)return toast(info.reason==='port'?'Port jaringan sedang dipakai aplikasi lain.':'Presentasi ke Layar Lain gagal dimulai.');
  S={ctx,viewer,info,opts:loadOpts(),ink:new Map(),tool:null,barOpen:false,textAt:null,mine:[],...loadPrefs(),
    connected:false,t0:0,media:null,black:false,handles:[],renderSeq:0,remoteIndex:-1};
  build();showPair();
  window.__TG_CAST_STATUS__=st=>{if(!S)return;if(st==='connected'){S.connected=true;if(!S.t0)S.t0=Date.now();showControl();syncAll()}else if(st==='disconnected'){S.connected=false;S.media=null;showPair(true)}};
  window.__TG_CAST_END__=()=>{if(S)endCast()};
  window.__TG_CAST__=raw=>{if(!S)return;let m;try{m=JSON.parse(raw)}catch{return}onRemote(m)};
  if(S.opts.awake)bridge?.keepScreenOn?.(true);
}

function build(){
  const {svg,esc}=S.ctx;const root=document.createElement('div');root.className='cast';S.root=root;
  root.innerHTML=`<header class="cast-top"><button type="button" class="cast-ib" data-a="back" aria-label="Kembali">${svg(I.back,24)}</button><div class="cast-title"><strong></strong><small class="cast-status"><i></i><span>Menunggu layar tujuan…</span></small></div><button type="button" class="cast-ib alt" data-a="menu" aria-label="Menu">${svg(I.menu,24)}</button></header>
  <div class="cast-pair"></div>
  <div class="cast-ctl hidden">
    <div class="cast-main"><div class="cast-preview"><div class="cast-stage"></div><canvas class="cast-ink"></canvas><div class="cast-spot"></div><i class="cast-laser"></i><div class="cast-blackmark">Layar tujuan hitam · ketuk Hitam lagi</div><i class="cast-tmark"></i></div></div>
    <div class="cast-aux"><div class="cast-next"><b>BERIKUTNYA</b><div class="cast-next-box"><div class="cast-stage"></div></div></div><div class="cast-notes"><b>${svg(I.note,13)} CATATAN</b><p></p></div></div>
    <div class="cast-nav"><button type="button" class="cast-big" data-a="prev" aria-label="Slide sebelumnya">${svg(I.prev,30)}</button><span class="cast-count"><strong>1 / 1</strong><small>00:00</small></span><button type="button" class="cast-big pri" data-a="next" aria-label="Slide berikutnya">${svg(I.next,30)}</button></div>
    <div class="cast-tools">${[['pen','Pena'],['text','Teks'],['eraser','Hapus'],['laser','Laser'],['spot','Sorot'],['blank','Hitam'],['undo','Urung']].map(([k,l])=>`<button type="button" class="cast-tool" data-tool="${k}">${svg(I[k],22)}<span>${l}</span></button>`).join('')}</div>
    <div class="cast-opts"></div>
    <div class="cast-media hidden"><button type="button" class="cast-mb" data-m="back10" aria-label="Mundur 10 detik">${svg(I.back10,22)}</button><button type="button" class="cast-mb" data-m="toggle" aria-label="Putar atau jeda">${svg(I.play,22)}</button><button type="button" class="cast-mb" data-m="fwd10" aria-label="Maju 10 detik">${svg(I.fwd10,22)}</button><span class="cast-mtime">0:00</span><span class="cast-vol">${svg(I.vol,20)}<input type="range" min="0" max="100" value="100" aria-label="Volume video di layar tujuan"></span></div>
  </div>`;
  root.querySelector('.cast-title strong').textContent=S.ctx.file.name;
  document.body.append(root);
  root.querySelector('[data-a="back"]').onclick=confirmEnd;root.querySelector('[data-a="menu"]').onclick=menuSheet;
  root.querySelector('[data-a="prev"]').onclick=()=>go(S.viewer.index-1);root.querySelector('[data-a="next"]').onclick=()=>go(S.viewer.index+1);
  root.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  root.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>send({t:'media',a:b.dataset.m}));
  root.querySelector('.cast-vol input').oninput=e=>send({t:'media',a:'vol',v:+e.target.value/100});
  bindInk();
  S.tick=setInterval(()=>{if(!S?.connected)return;const sec=Math.floor((Date.now()-S.t0)/1000);root.querySelector('.cast-count small').textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`},1000);
  S.onResize=()=>setTimeout(()=>{fitPreview();redraw()},120);window.addEventListener('resize',S.onResize);
}

/* ---------- Layar pasangkan ---------- */
function pickAddr(list){const hot=list.find(a=>/^(ap|swlan)/.test(a.name)||(/^wlan[1-9]/.test(a.name)&&/^192\.168\.43\./.test(a.ip)));return hot||list.find(a=>/^wlan/.test(a.name))||list[0]||null}
function showPair(lost=false){
  const {svg,esc}=S.ctx;let info={};try{info=JSON.parse(bridge.castInfoJson()||'{}')}catch{}if(info.ok)S.info=info;
  const list=S.info.addrs||[],a=pickAddr(list),url=a?`http://${a.ip}:${S.info.port}`:'',hot=a&&/^(ap|swlan)/.test(a.name);
  status(lost?'Layar tujuan terputus · menunggu lagi…':'Menunggu layar tujuan…','wait');
  if(lost)S.ctx.toast('Layar tujuan terputus. Buka lagi alamatnya di browser bila tidak tersambung sendiri.',3200);
  S.root.querySelector('.cast-ctl').classList.add('hidden');const box=S.root.querySelector('.cast-pair');box.classList.remove('hidden');
  box.innerHTML=`<section class="cast-card"><div class="cast-lbl">1 · DI IFP, LAPTOP, ATAU TV: BUKA BROWSER LALU KETIK ALAMAT INI</div>${a?`<div class="cast-url">${esc(url.replace('http://',''))}</div><div class="cast-qr">${qrSvg(url,168)}</div><p class="cast-small">Atau pindai QR bila perangkat punya kamera.${list.length>1?` Alamat lain: ${list.filter(x=>x!==a).map(x=>esc(x.ip+':'+S.info.port)).join(', ')}`:''}</p>`:`<p class="cast-warn">HP belum tersambung ke Wi-Fi dan hotspot belum menyala. Sambungkan HP ke Wi-Fi yang sama dengan layar tujuan, atau nyalakan hotspot HP.</p><button type="button" class="soft-btn" data-a="refresh">Periksa lagi</button>`}</section>
  <section class="cast-card"><div class="cast-lbl">2 · MASUKKAN KODE INI DI LAYAR TUJUAN</div><div class="cast-code">${String(S.info.code||'----').split('').map(d=>`<span>${d}</span>`).join('')}</div><button type="button" class="cast-link" data-a="code">Ganti kode</button></section>
  <section class="cast-card"><div class="cast-lbl">JARINGAN</div><div class="cast-nets"><span class="${hot?'':'on'}">${svg(I.wifi,18)} Wi-Fi sama</span><span class="${hot?'on':''}">${svg(I.wifi,18)} Hotspot HP</span></div><p class="cast-small">HP dan layar tujuan (IFP, laptop, atau TV dengan browser) harus di jaringan yang sama. Bila Wi-Fi sekolah memblokir sambungan antarperangkat, nyalakan hotspot HP lalu sambungkan layar tujuan ke hotspot itu.</p></section>`;
  box.querySelector('[data-a="refresh"]')?.addEventListener('click',()=>showPair());
  box.querySelector('[data-a="code"]').onclick=()=>{const c=bridge.castNewCode?.();if(c){S.info.code=c;showPair()}};
}
function status(text,kind){const s=S.root.querySelector('.cast-status');s.className='cast-status '+kind;s.querySelector('span').textContent=text}

/* ---------- Pengendali ---------- */
function showControl(){
  status('Terhubung ke layar tujuan','ok');S.root.querySelector('.cast-pair').classList.add('hidden');const ctl=S.root.querySelector('.cast-ctl');ctl.classList.remove('hidden');
  applyOpts();renderAll();renderOpts();
}
function applyOpts(){const r=S.root;r.querySelector('.cast-next').classList.toggle('hidden',!S.opts.next);r.querySelector('.cast-notes').classList.toggle('hidden',!S.opts.notes);r.querySelector('.cast-aux').classList.toggle('hidden',!S.opts.next&&!S.opts.notes);bridge?.keepScreenOn?.(!!S.opts.awake)}
async function renderInto(box,i){
  const v=S.viewer,stage=box.querySelector('.cast-stage');if(!stage)return;
  const old=stage._h;stage._h=null;try{old?.dispose?.()}catch{}stage.replaceChildren();
  box.toggleAttribute('data-end',i<0||i>=(v.slideCount||1));if(box.hasAttribute('data-end'))return;
  const inner=document.createElement('div');inner.className='cast-slide';stage.append(inner);
  try{stage._h=await v.renderSlideInto(i,inner)}catch(e){inner.textContent='Slide gagal dirender'}
  inner.querySelectorAll('video,audio').forEach(m=>{m.muted=true;m.removeAttribute('autoplay');try{m.pause()}catch{}});
  fitStage(box);
}
function fitStage(box){const inner=box.querySelector('.cast-slide');if(!inner)return;const {w,h}=S.viewer.slidePx(),bw=box.clientWidth;const sc=bw/w;inner.style.transform=`scale(${sc})`;box.style.height=Math.round(h*sc)+'px'}
function fitPreview(){S.root.querySelectorAll('.cast-preview,.cast-next-box').forEach(fitStage);sizeInk()}
async function renderAll(){
  const seq=++S.renderSeq,i=S.viewer.index,n=S.viewer.slideCount||1;
  S.root.querySelector('.cast-count strong').textContent=`${i+1} / ${n}`;
  await renderInto(S.root.querySelector('.cast-preview'),i);if(seq!==S.renderSeq)return;
  sizeInk();redraw();
  if(S.opts.next){S.root.querySelector('.cast-next b').textContent=i+1<n?`BERIKUTNYA · ${i+2}`:'SLIDE TERAKHIR';await renderInto(S.root.querySelector('.cast-next-box'),i+1)}
  if(S.opts.notes){const t=await S.viewer.notesOf?.(i);if(seq===S.renderSeq)S.root.querySelector('.cast-notes p').textContent=t||'Tidak ada catatan di slide ini.'}
}
async function go(i,fromRemote=false){
  const n=S.viewer.slideCount||1;i=Math.max(0,Math.min(n-1,i));if(i===S.viewer.index&&!fromRemote)return;
  await S.viewer.go(i);if(!fromRemote)send({t:'go',i});S.media=null;updMedia();renderAll();
}
function syncAll(){const ink={};for(const [s,l] of S.ink)ink[s]=l;send({t:'state',i:S.viewer.index,ink,black:S.black})}

/* Tinta, laser, sorot di pratinjau */
function bindInk(){
  const cv=S.root.querySelector('.cast-ink');S.cv=cv;S.cx=cv.getContext('2d');let stroke=null,lastSend=0;
  const pos=e=>{const r=cv.getBoundingClientRect();return[(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height]};
  const flush=(done)=>{if(!stroke)return;const now=Date.now();if(done||now-lastSend>45){lastSend=now;send({t:'ink',s:S.viewer.index,id:stroke.id,c:stroke.c,z:stroke.z,pts:stroke.pts})}};
  cv.addEventListener('pointerdown',e=>{if(!S.tool||S.tool==='blank')return;if(S.tool==='text'){const p=pos(e);if(p[0]>=0&&p[1]>=0&&p[0]<=1&&p[1]<=1)textAt(p);return}cv.setPointerCapture?.(e.pointerId);handle(e,true)});
  cv.addEventListener('pointermove',e=>{if(e.buttons||e.pressure>0)handle(e,false)});
  const up=()=>{if(stroke){flush(true);stroke=null}if(S.tool==='laser'){S.root.querySelector('.cast-laser').style.display='none';send({t:'laser',on:false})}};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  function handle(e,down){
    const p=pos(e);if(p[0]<0||p[1]<0||p[0]>1||p[1]>1)return;
    if(S.tool==='pen'){if(down){stroke={id:Math.random().toString(36).slice(2,10),c:S.color,z:S.size,pts:[p]};const l=S.ink.get(S.viewer.index)||[];l.push(stroke);S.ink.set(S.viewer.index,l);S.mine.push({s:S.viewer.index,id:stroke.id})}else stroke?.pts.push(p);redraw();flush(false)}
    else if(S.tool==='eraser'){const l=S.ink.get(S.viewer.index)||[],w=cv.clientWidth,h=cv.clientHeight,gone=l.filter(s=>hitInk(S.cx,s,p,w,h,16));if(gone.length){S.ink.set(S.viewer.index,l.filter(s=>!gone.includes(s)));redraw();send({t:'erase',s:S.viewer.index,ids:gone.map(s=>s.id)})}}
    else if(S.tool==='laser'){const d=S.root.querySelector('.cast-laser');d.style.display='block';d.style.left=p[0]*100+'%';d.style.top=p[1]*100+'%';d.style.background=S.lcolor;send({t:'laser',on:true,x:p[0],y:p[1],c:S.lcolor,z:S.lsize})}
    else if(S.tool==='spot'){spotAt(p);send({t:'spot',on:true,x:p[0],y:p[1],r:S.spot})}
  }
}
/* Teks sederhana: ketuk slide, ketik, centang. Ukuran preset, tanpa cubit. */
function textAt(p){
  S.textAt=p;const m=S.root.querySelector('.cast-tmark');m.style.left=p[0]*100+'%';m.style.top=p[1]*100+'%';m.classList.add('on');
  S.barOpen=true;renderOpts();setTimeout(()=>S.root.querySelector('.cast-tin')?.focus(),30);
}
function commitText(){
  const inp=S.root.querySelector('.cast-tin'),txt=(inp?.value||'').trim().slice(0,200),p=S.textAt;
  S.textAt=null;S.root.querySelector('.cast-tmark').classList.remove('on');
  if(txt&&p){const st={id:'t'+Math.random().toString(36).slice(2,9),k:'t',txt,c:S.tcolor,z:S.tsize,pts:[p]};const l=S.ink.get(S.viewer.index)||[];l.push(st);S.ink.set(S.viewer.index,l);S.mine.push({s:S.viewer.index,id:st.id});redraw();send({t:'ink',s:S.viewer.index,id:st.id,c:st.c,z:st.z,k:'t',txt,pts:st.pts})}
  renderOpts();
}
function undo(){
  const i=S.viewer.index,l=S.ink.get(i)||[];
  for(let k=S.mine.length-1;k>=0;k--){const m=S.mine[k];if(m.s!==i)continue;S.mine.splice(k,1);const st=l.find(x=>x.id===m.id);if(!st)continue;S.ink.set(i,l.filter(x=>x!==st));redraw();send({t:'erase',s:i,ids:[st.id]});return}
  S.ctx.toast('Tidak ada coretan di slide ini untuk diurungkan.',1600);
}
function spotAt(p){const sp=S.root.querySelector('.cast-spot'),w=S.cv.clientWidth;sp.style.setProperty('--x',p[0]*100+'%');sp.style.setProperty('--y',p[1]*100+'%');sp.style.setProperty('--r',Math.round(S.spot*w)+'px')}
function sizeInk(){const cv=S.cv;if(!cv)return;const r=cv.getBoundingClientRect(),d=window.devicePixelRatio||1;cv.width=Math.max(1,Math.round(r.width*d));cv.height=Math.max(1,Math.round(r.height*d));S.cx.setTransform(d,0,0,d,0,0)}
function redraw(){
  const cv=S.cv,ctx=S.cx;if(!cv)return;const w=cv.clientWidth,h=cv.clientHeight;ctx.clearRect(0,0,w,h);
  for(const s of S.ink.get(S.viewer.index)||[]){if(s.remote&&!S.opts.ifpInk)continue;if(!s.pts.length)continue;if(s.k==='t'){drawText(ctx,s,w,h,0,0);continue}ctx.strokeStyle=s.c;ctx.lineWidth=Math.max(1,s.z*(w/1000));ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();s.pts.forEach(([x,y],k)=>k?ctx.lineTo(x*w,y*h):ctx.moveTo(x*w,y*h));if(s.pts.length===1)ctx.lineTo(s.pts[0][0]*w+.1,s.pts[0][1]*h);ctx.stroke()}
}
function setTool(k){
  if(k==='undo'){undo();return}
  if(k==='blank'){S.black=!S.black;send({t:'black',on:S.black});S.root.querySelector('[data-tool="blank"]').classList.toggle('on',S.black);S.root.querySelector('.cast-blackmark').classList.toggle('on',S.black);return}
  const prev=S.tool;
  /* Alat aktif diketuk lagi: bilah tertutup → buka; bilah terbuka → matikan alat. Alat lain → aktif dengan bilahnya. */
  if(prev===k){if(!S.barOpen){S.barOpen=true;renderOpts();return}S.tool=null;S.barOpen=false}else{S.tool=k;S.barOpen=true}
  if(prev==='text'&&S.tool!=='text'){S.textAt=null;S.root.querySelector('.cast-tmark').classList.remove('on')}
  if(prev==='spot'&&S.tool!=='spot')send({t:'spot',on:false});
  if(prev==='laser')send({t:'laser',on:false});
  S.root.querySelectorAll('[data-tool]').forEach(b=>{if(b.dataset.tool!=='blank'&&b.dataset.tool!=='undo')b.classList.toggle('on',b.dataset.tool===S.tool)});
  S.cv.classList.toggle('on',!!S.tool);S.root.querySelector('.cast-spot').classList.toggle('on',S.tool==='spot');
  if(S.tool==='spot'){spotAt([.5,.5]);send({t:'spot',on:true,x:.5,y:.5,r:S.spot})}
  renderOpts();
}
function toolDots(){
  const set=(k,c)=>{const b=S.root.querySelector(`[data-tool="${k}"]`);if(b)b.style.setProperty('--dot',c)};
  set('pen',S.color);set('text',S.tcolor);set('laser',S.lcolor);
}
function renderOpts(){
  const box=S.root.querySelector('.cast-opts'),t=S.tool;let h='';toolDots();
  const dots=(list,cur,k)=>list.map(c=>`<button type="button" class="cast-dot${c===cur?' on':''}" data-${k}="${c}" style="background:${c}" aria-label="Warna"></button>`).join('');
  const sizes=(list,cur,k,sc)=>list.map((z,i)=>`<button type="button" class="cast-size${z===cur?' on':''}" data-${k}="${z}" aria-label="Ukuran ${i+1}"><i style="width:${Math.round(z*sc)}px;height:${Math.round(z*sc)}px"></i></button>`).join('');
  if(t==='pen')h=`<div class="cast-row">${dots(COLORS,S.color,'c')}</div><div class="cast-row">${sizes(SIZES,S.size,'z',1.6)}</div>`;
  else if(t==='text')h=(S.textAt?`<div class="cast-row cast-trow"><input class="cast-tin" type="text" maxlength="200" enterkeyhint="done" placeholder="Ketik teks…" aria-label="Teks"><button type="button" class="cast-ok" data-tok aria-label="Taruh teks">${S.ctx.svg(I.check,22)}</button></div>`:`<div class="cast-row"><span class="cast-small">Ketuk slide untuk menaruh teks</span></div>`)
    +`<div class="cast-row">${TSIZES.map(([z,l])=>`<button type="button" class="cast-tsize${z===S.tsize?' on':''}" data-tz="${z}" style="font-size:${Math.round(z/3.4)}px" aria-label="${l}">A<small>${l}</small></button>`).join('')}</div><div class="cast-row">${dots(COLORS,S.tcolor,'tc')}</div>`;
  else if(t==='laser')h=`<div class="cast-row">${dots(LCOLORS,S.lcolor,'lc')}</div><div class="cast-row">${sizes(LSIZES,S.lsize,'lz',.9)}</div>`;
  else if(t==='spot')h=`<div class="cast-row">${sizes(SPOTS,S.spot,'sp',110)}<span class="cast-small">Ukuran sorot</span></div>`;
  else if(t==='eraser')h=`<div class="cast-row"><span class="cast-small">Gores coretan atau teks untuk menghapus</span><button type="button" class="cast-link" data-clear>Bersihkan slide</button></div>`;
  const show=!!h&&S.barOpen;
  box.innerHTML=show?`<div class="cast-optbody">${h}</div><button type="button" class="cast-x" data-x aria-label="Tutup bilah">${S.ctx.svg(I.close,18)}</button>`:'';box.classList.toggle('hidden',!show);
  if(!show)return;
  box.querySelector('[data-x]').onclick=()=>{if(S.textAt&&S.root.querySelector('.cast-tin')?.value.trim()){commitText()}S.textAt=null;S.root.querySelector('.cast-tmark').classList.remove('on');S.barOpen=false;renderOpts()};
  const keep=S.root.querySelector('.cast-tin')?.value||'';
  const pick=(sel,fn)=>box.querySelectorAll(sel).forEach(b=>b.onclick=()=>{fn(b);savePrefs();const v=S.root.querySelector('.cast-tin')?.value;renderOpts();const ni=S.root.querySelector('.cast-tin');if(ni&&v!=null){ni.value=v;ni.focus()}});
  pick('[data-c]',b=>S.color=b.dataset.c);pick('[data-z]',b=>S.size=+b.dataset.z);pick('[data-lc]',b=>S.lcolor=b.dataset.lc);pick('[data-lz]',b=>S.lsize=+b.dataset.lz);
  pick('[data-tc]',b=>S.tcolor=b.dataset.tc);pick('[data-tz]',b=>S.tsize=+b.dataset.tz);
  pick('[data-sp]',b=>{S.spot=+b.dataset.sp;spotAt([.5,.5]);send({t:'spot',on:true,x:.5,y:.5,r:S.spot})});
  box.querySelector('[data-clear]')?.addEventListener('click',()=>{S.ink.delete(S.viewer.index);redraw();send({t:'clear',s:S.viewer.index})});
  const tin=box.querySelector('.cast-tin');if(tin){tin.value=keep;tin.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitText()}};box.querySelector('[data-tok]').onclick=commitText}
}
const fmtT=t=>{t=Math.max(0,Math.floor(t||0));return `${Math.floor(t/60)}:${String(t%60).padStart(2,'0')}`};
function updMedia(){
  const m=S.media,box=S.root.querySelector('.cast-media');box.classList.toggle('hidden',!m?.has);if(!m?.has)return;
  box.querySelector('[data-m="toggle"]').innerHTML=S.ctx.svg(m.paused?I.play:I.pause,22);box.querySelector('.cast-mtime').textContent=`${fmtT(m.cur)} / ${fmtT(m.dur)}`;
  const vol=box.querySelector('.cast-vol input');if(document.activeElement!==vol&&m.vol!=null)vol.value=Math.round(m.vol*100);
}
function onRemote(m){
  const v=S.viewer;
  if(m.t==='go'){if(+m.i!==v.index)go(+m.i,true)}
  else if(m.t==='ink'&&Array.isArray(m.pts)){const l=S.ink.get(+m.s)||[];const ex=l.find(x=>x.id===m.id);const st={id:String(m.id),c:String(m.c||'#E5384F'),z:+m.z||6,pts:m.pts.slice(0,4000),remote:true};if(m.k==='t'){st.k='t';st.txt=String(m.txt||'').slice(0,200)}if(ex)Object.assign(ex,st);else l.push(st);S.ink.set(+m.s,l);if(+m.s===v.index)redraw()}
  else if(m.t==='erase'&&Array.isArray(m.ids)){const l=S.ink.get(+m.s)||[];S.ink.set(+m.s,l.filter(x=>!m.ids.includes(x.id)));if(+m.s===v.index)redraw()}
  else if(m.t==='clear'){S.ink.delete(+m.s);if(+m.s===v.index)redraw()}
  else if(m.t==='mstate'){S.media={has:!!m.has,paused:!!m.paused,cur:+m.cur||0,dur:+m.dur||0,vol:m.vol==null?null:+m.vol};updMedia()}
  else if(m.t==='black'){S.black=!!m.on;S.root.querySelector('[data-tool="blank"]').classList.toggle('on',S.black);S.root.querySelector('.cast-blackmark').classList.toggle('on',S.black)}
  else if(m.t==='ready'){syncAll()}
}

/* Menu centang */
function menuSheet(){
  const {openSheet,closeSheet,svg}=S.ctx,o=S.opts;
  const ck=(k,l,d)=>`<button type="button" class="cast-ck${o[k]?' on':''}" data-k="${k}"><span class="box">${svg(I.check,18)}</span><span><strong>${l}</strong><small>${d}</small></span></button>`;
  openSheet(`<h3 class="sheet-title">Presentasi ke Layar Lain</h3><div class="sheet-label">TAMPILAN DI HP</div>${ck('notes','Catatan pembicara','Tampilkan catatan slide (jika ada)')}${ck('next','Pratinjau slide berikutnya','Gambar kecil slide setelah ini')}${ck('ifpInk','Coretan di layar tujuan ikut tampil di HP','Pena dan teks dari IFP/laptop tampil di pratinjau HP')}${ck('awake','Layar HP tetap menyala','Selama sesi presentasi')}
    <div class="sheet-label">SESI</div><button type="button" class="act" data-a="code"><span>Ganti kode pairing</span></button><button type="button" class="act danger" data-a="end"><span>Putuskan dan akhiri</span></button>`,box=>{
    box.querySelectorAll('.cast-ck').forEach(b=>b.onclick=()=>{const k=b.dataset.k;o[k]=!o[k];b.classList.toggle('on',o[k]);saveOpts();applyOpts();if(S.connected)renderAll();redraw()});
    box.querySelector('[data-a="code"]').onclick=()=>{closeSheet();const c=bridge.castNewCode?.();if(c){S.info.code=c;S.connected=false;showPair()}};
    box.querySelector('[data-a="end"]').onclick=()=>{closeSheet();endCast()};
  });
}
function confirmEnd(){
  const {openSheet,closeSheet,esc}=S.ctx,n=S.viewer.slideCount||1;
  openSheet(`<h3 class="sheet-title">Anda sedang presentasi ke layar lain</h3><p class="sheet-text">${S.connected?'Terhubung ke layar tujuan':'Menunggu layar tujuan'} · slide ${S.viewer.index+1} dari ${n}.</p><p class="sheet-text">Keluar akan memutus sambungan dan layar tujuan kembali ke halaman kode. Untuk melanjutkan tanpa memutus, kembali ke presentasi. Tombol Home tidak memutus sambungan.</p><div class="cast-dlg"><button type="button" class="solid-btn" id="ceNo">Kembali ke presentasi</button><button type="button" class="soft-btn danger" id="ceGo">Keluar presentasi</button></div>`,box=>{
    box.querySelector('#ceNo').onclick=closeSheet;box.querySelector('#ceGo').onclick=()=>{closeSheet();endCast()};
  });
}
export function endCast(){
  if(!S)return;send({t:'end'});
  setTimeout(()=>{try{bridge?.castStop?.()}catch{}},250);
  try{bridge?.keepScreenOn?.(false)}catch{}
  clearInterval(S.tick);window.removeEventListener('resize',S.onResize);
  S.root.querySelectorAll('.cast-stage').forEach(st=>{try{st._h?.dispose?.()}catch{}});
  S.root.remove();window.__TG_CAST__=null;window.__TG_CAST_STATUS__=null;window.__TG_CAST_END__=null;S=null;
}

/* Dipakai juga oleh penerima: gambar teks dan uji sentuh penghapus. */
export function drawText(ctx,s,w,h,ox,oy){const fs=Math.max(8,s.z*(w/1000));ctx.font=`800 ${fs}px 'Plus Jakarta Sans',system-ui,sans-serif`;ctx.textBaseline='middle';ctx.fillStyle=s.c;ctx.lineWidth=Math.max(2,fs/9);ctx.strokeStyle=s.c==='#FFFFFF'?'rgba(0,0,0,.55)':'rgba(255,255,255,.85)';ctx.lineJoin='round';const x=ox+s.pts[0][0]*w,y=oy+s.pts[0][1]*h;ctx.strokeText(s.txt||'',x,y);ctx.fillText(s.txt||'',x,y)}
export function hitInk(ctx,s,p,w,h,r){
  if(s.k==='t'){const fs=Math.max(8,s.z*(w/1000));ctx.save();ctx.font=`800 ${fs}px 'Plus Jakarta Sans',system-ui,sans-serif`;const tw=ctx.measureText(s.txt||'').width;ctx.restore();const x=s.pts[0][0]*w,y=s.pts[0][1]*h,px=p[0]*w,py=p[1]*h;return px>=x-r&&px<=x+tw+r&&py>=y-fs/2-r&&py<=y+fs/2+r}
  return s.pts.some(([a,b])=>Math.hypot((a-p[0])*w,(b-p[1])*h)<r);
}
