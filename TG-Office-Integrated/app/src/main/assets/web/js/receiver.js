import {PptxViewer} from './viewers/pptx.js';
import {drawText,hitInk} from './cast.js';
/* Penerima Presentasi Nirkabel (dibuka di browser IFP Android/Windows).
   Pesan dari HP lewat EventSource /api/events, pesan ke HP lewat POST /api/msg. Slide dirender di IFP. */
const $=s=>document.querySelector(s);
const P={prev:'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z',next:'M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z',
  pen:'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  eraser:'M16.24 3.56l4.95 4.94c.78.79.78 2.05 0 2.84L12 20.53a4.01 4.01 0 0 1-5.66 0L2.81 17c-.78-.79-.78-2.05 0-2.84l10.6-10.6c.79-.78 2.05-.78 2.83 0zM4.22 15.58l3.54 3.53c.78.79 2.04.79 2.83 0l3.53-3.53-4.95-4.95-4.95 4.95z',
  laser:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0V3a1 1 0 0 1 1-1zm0 16a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1zM2 12a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2H3a1 1 0 0 1-1-1zm16 0a1 1 0 0 1 1-1h2a1 1 0 0 1 0 2h-2a1 1 0 0 1-1-1z',
  spot:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm0-12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  full:'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  text:'M5 4v3h5.5v12h3V7H19V4z',undo:'M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z',
  close:'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',check:'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'};
const ico=(d,s=26)=>`<svg viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true"><path d="${d}"/></svg>`;
const COLORS=['#E5384F','#F2A900','#2FB36B','#3A86E0','#FFFFFF'],SIZES=[3,6,11],TSIZES=[[30,'Kecil'],[46,'Sedang'],[70,'Besar']];
let token=null,es=null,viewer=null,rev=null,index=0,ink=new Map(),tool=null,barOpen=false,stroke=null,lastSend=0,fadeT=null,ui=null,mediaT=null,mine=[];
let pref={};try{pref=JSON.parse(localStorage.getItem('tg-rx-prefs')||'{}')}catch{}
let color=COLORS.includes(pref.color)?pref.color:COLORS[0],size=SIZES.includes(pref.size)?pref.size:SIZES[1],tcolor=COLORS.includes(pref.tcolor)?pref.tcolor:COLORS[0],tsize=[30,46,70].includes(pref.tsize)?pref.tsize:46;
const savePref=()=>{try{localStorage.setItem('tg-rx-prefs',JSON.stringify({color,size,tcolor,tsize}))}catch{}};
try{token=sessionStorage.getItem('tg-cast-token')}catch{}

async function post(m){if(!token)return;try{await fetch('/api/msg?t='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(m)})}catch{}}

$('#code').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,4)});
$('#gate').addEventListener('submit',async e=>{
  e.preventDefault();const code=$('#code').value;$('#err').textContent='';
  try{document.documentElement.requestFullscreen?.().catch(()=>{})}catch{}
  try{
    const r=await (await fetch('/api/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code})})).json();
    if(!r.ok){$('#err').textContent=r.reason==='locked'?'Terlalu banyak percobaan. Tunggu 30 detik.':'Kode salah. Periksa kode di HP.';$('#code').select();return}
    token=r.token;try{sessionStorage.setItem('tg-cast-token',token)}catch{}connect();
  }catch{$('#err').textContent='HP tidak terjangkau. Pastikan HP dan IFP di jaringan yang sama.'}
});

function showGate(msg=''){$('#gate').classList.remove('hidden');$('#err').textContent=msg;$('#code').value='';setTimeout(()=>$('#code').focus(),50)}
function loading(on,text='Memuat presentasi…'){$('#loading').classList.toggle('hidden',!on);$('#loadingText').textContent=text}

function connect(){
  es?.close();$('#gate').classList.add('hidden');loading(true,'Menyambungkan ke HP…');
  es=new EventSource('/api/events?t='+token);let opened=false;
  es.onopen=()=>{opened=true;setStatus(true)};
  es.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}onMsg(m)};
  es.onerror=()=>{setStatus(false);if(!opened||es.readyState===2){es.close();es=null;token=null;try{sessionStorage.removeItem('tg-cast-token')}catch{}loading(false);showGate('Sambungan ditolak. Masukkan kode terbaru dari HP.')}};
}
function setStatus(on){const s=$('.rx-status');if(!s)return;s.classList.toggle('off',!on);s.querySelector('span').textContent=on?'Terhubung dengan HP':'Sambungan terputus · mencoba lagi…';s.style.opacity='1';clearTimeout(s._t);if(on)s._t=setTimeout(()=>s.style.opacity='.35',4000)}

async function onMsg(m){
  if(m.t==='load'){if(m.rev!==rev){rev=m.rev;await load(m.name)}return}
  if(!viewer)return;
  if(m.t==='go'){const i=+m.i||0;if(i!==viewer.index){index=i;await viewer.go(i);afterSlide()}}
  else if(m.t==='state'){if(+m.i!==viewer.index){index=+m.i;await viewer.go(index)}ink=new Map(Object.entries(m.ink||{}).map(([k,v])=>[+k,v]));black(!!m.black);afterSlide()}
  else if(m.t==='ink'){const l=ink.get(+m.s)||[],ex=l.find(x=>x.id===m.id),st={id:m.id,c:m.c,z:+m.z||6,pts:m.pts||[]};if(m.k==='t'){st.k='t';st.txt=String(m.txt||'').slice(0,200)}if(ex)Object.assign(ex,st);else l.push(st);ink.set(+m.s,l);if(+m.s===viewer.index)redraw()}
  else if(m.t==='erase'){const l=ink.get(+m.s)||[];ink.set(+m.s,l.filter(x=>!(m.ids||[]).includes(x.id)));if(+m.s===viewer.index)redraw()}
  else if(m.t==='clear'){ink.delete(+m.s);if(+m.s===viewer.index)redraw()}
  else if(m.t==='laser'){const d=ui.laser;if(!m.on){d.style.display='none';return}const r=slideRect();d.style.display='block';d.style.left=(r.x+m.x*r.w)+'px';d.style.top=(r.y+m.y*r.h)+'px';const z=Math.max(8,(+m.z||16)*1.4);d.style.width=d.style.height=z+'px';d.style.margin=`-${z/2}px 0 0 -${z/2}px`;d.style.background=m.c||'#FF2A2A';d.style.boxShadow=`0 0 0 ${Math.round(z/2)}px ${(m.c||'#FF2A2A')}44,0 0 ${z}px ${Math.round(z/3)}px ${(m.c||'#FF2A2A')}cc`}
  else if(m.t==='spot'){if(!m.on){ui.spot.style.display='none';return}const r=slideRect();ui.spot.style.display='block';ui.spot.style.setProperty('--x',(r.x+m.x*r.w)+'px');ui.spot.style.setProperty('--y',(r.y+m.y*r.h)+'px');ui.spot.style.setProperty('--r',Math.round((+m.r||.12)*r.w)+'px')}
  else if(m.t==='black')black(!!m.on);
  else if(m.t==='media')media(m);
  else if(m.t==='end'){es?.close();es=null;token=null;try{sessionStorage.removeItem('tg-cast-token')}catch{}teardown();showGate('Presentasi diakhiri dari HP.')}
}

async function load(name){
  loading(true,'Memuat '+(name||'presentasi')+'…');
  try{
    const res=await fetch('/api/file?t='+token,{cache:'no-store'});if(!res.ok)throw new Error('File tidak tersedia');
    const blob=await res.blob();const file=new File([blob],name||'presentasi.pptx',{type:blob.type});
    teardown(true);viewer=new PptxViewer($('#host'),null);await viewer.open(file);await viewer.present();
    buildUi();index=viewer.index;loading(false);afterSlide();post({t:'ready',n:viewer.slideCount});
  }catch(e){console.error(e);loading(true,'Presentasi gagal dimuat: '+(e.message||e))}
}
function teardown(keepGate){try{viewer?.destroy?.()}catch{}viewer=null;ui?.root.forEach(el=>el.remove());ui=null;clearInterval(mediaT);if(!keepGate)loading(false)}

function buildUi(){
  const cv=document.createElement('canvas');cv.className='rx-ink';const laser=document.createElement('i');laser.className='rx-laser';const spot=document.createElement('div');spot.className='rx-spot';
  const blk=document.createElement('div');blk.className='rx-black';blk.textContent='Ketuk untuk kembali';
  const bar=document.createElement('div');bar.className='rx-bar';
  bar.innerHTML=`<button data-a="prev" aria-label="Sebelumnya">${ico(P.prev)}</button><span class="rx-count">1 / 1</span><button data-a="next" aria-label="Berikutnya">${ico(P.next)}</button><span class="rx-sep"></span><button data-t="pen">${ico(P.pen)}Pena</button><button data-t="text">${ico(P.text)}Teks</button><button data-t="eraser">${ico(P.eraser)}Hapus</button><button data-t="laser">${ico(P.laser)}Laser</button><button data-t="spot">${ico(P.spot)}Sorot</button><button data-a="undo">${ico(P.undo)}Urung</button><span class="rx-sep"></span><button data-a="full">${ico(P.full)}Penuh</button>`;
  const pop=document.createElement('div');pop.className='rx-pop hidden';
  const st=document.createElement('div');st.className='rx-status';st.innerHTML='<i></i><span>Terhubung dengan HP</span>';
  const tbox=document.createElement('form');tbox.className='rx-tbox hidden';tbox.innerHTML=`<input maxlength="200" enterkeyhint="done" placeholder="Ketik teks…" aria-label="Teks"><button type="submit" aria-label="Taruh teks">${ico(P.check,24)}</button><button type="button" data-cancel aria-label="Batal">${ico(P.close,22)}</button>`;
  (viewer.presentationOverlay||document.body).append(cv,spot,laser,blk,pop,tbox,bar,st);
  ui={root:[cv,spot,laser,blk,pop,tbox,bar,st],cv,ctx:cv.getContext('2d'),laser,spot,blk,bar,pop,tbox};
  tbox.onsubmit=e=>{e.preventDefault();commitText()};tbox.querySelector('[data-cancel]').onclick=()=>hideText();
  bar.querySelector('[data-a="undo"]').onclick=undo;
  bar.querySelector('[data-a="prev"]').onclick=()=>nav(viewer.index-1);bar.querySelector('[data-a="next"]').onclick=()=>nav(viewer.index+1);
  bar.querySelector('[data-a="full"]').onclick=()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>{})};
  bar.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>setTool(b.dataset.t));
  blk.onclick=()=>{black(false);post({t:'black',on:false})};
  window.addEventListener('resize',()=>setTimeout(()=>{sizeCanvas();redraw()},200));
  ['pointermove','pointerdown','keydown'].forEach(n=>window.addEventListener(n,wake,{passive:true}));
  window.addEventListener('keydown',e=>{if(e.target?.tagName==='INPUT')return;if(e.key==='Escape'){if(textAt)hideText();else if(tool)setTool(tool)}if(e.key==='ArrowRight'||e.key==='PageDown')nav(viewer.index+1);else if(e.key==='ArrowLeft'||e.key==='PageUp')nav(viewer.index-1)});
  const pos=e=>{const r=slideRect();return[(e.clientX-r.x)/r.w,(e.clientY-r.y)/r.h]};
  cv.addEventListener('pointerdown',e=>{if(!tool)return;if(tool==='text'){showText(e);return}cv.setPointerCapture?.(e.pointerId);draw(e,true)});
  cv.addEventListener('pointermove',e=>{if(e.buttons||e.pressure>0)draw(e,false)});
  const up=()=>{if(stroke){post({t:'ink',s:viewer.index,id:stroke.id,c:stroke.c,z:stroke.z,pts:stroke.pts});stroke=null}if(tool==='laser')laser.style.display='none'};
  cv.addEventListener('pointerup',up);cv.addEventListener('pointercancel',up);
  function draw(e,down){
    const p=pos(e);
    if(tool==='pen'){if(down){stroke={id:'i'+Math.random().toString(36).slice(2,9),c:color,z:size,pts:[p]};const l=ink.get(viewer.index)||[];l.push(stroke);ink.set(viewer.index,l);mine.push({s:viewer.index,id:stroke.id})}else stroke?.pts.push(p);redraw();const now=Date.now();if(stroke&&now-lastSend>60){lastSend=now;post({t:'ink',s:viewer.index,id:stroke.id,c:stroke.c,z:stroke.z,pts:stroke.pts})}}
    else if(tool==='eraser'){const r=slideRect(),l=ink.get(viewer.index)||[],gone=l.filter(s=>hitInk(ui.ctx,s,p,r.w,r.h,24));if(gone.length){ink.set(viewer.index,l.filter(s=>!gone.includes(s)));redraw();post({t:'erase',s:viewer.index,ids:gone.map(s=>s.id)})}}
    else if(tool==='laser'){laser.style.display='block';laser.style.left=e.clientX+'px';laser.style.top=e.clientY+'px'}
    else if(tool==='spot'){spot.style.setProperty('--x',e.clientX+'px');spot.style.setProperty('--y',e.clientY+'px')}
  }
  sizeCanvas();renderPop();wake();
  mediaT=setInterval(reportMedia,1000);
  /* Geser di IFP (sentuh) juga memindah slide: kabari HP */
  setInterval(()=>{if(viewer&&viewer.index!==index){index=viewer.index;afterSlide();post({t:'go',i:index})}},300);
}
function wake(){if(!ui)return;ui.bar.classList.remove('fade');clearTimeout(fadeT);fadeT=setTimeout(()=>{if(!tool&&!barOpen)ui.bar.classList.add('fade')},4000)}
async function nav(i){if(!viewer)return;i=Math.max(0,Math.min((viewer.slideCount||1)-1,i));if(i===viewer.index)return;index=i;await viewer.go(i);afterSlide();post({t:'go',i})}
/* Alat aktif diketuk lagi: bilah tertutup → buka; bilah terbuka → matikan alat. Bilah hanya tutup lewat ✕. */
function setTool(t){
  if(tool===t){if(!barOpen&&(t==='pen'||t==='text')){barOpen=true;renderPop();wake();return}tool=null;barOpen=false}else{tool=t;barOpen=true}
  if(tool!=='text')hideText();
  ui.bar.querySelectorAll('[data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===tool));ui.cv.classList.toggle('on',!!tool);
  ui.spot.style.display=tool==='spot'?'block':'none';if(tool==='spot'){ui.spot.style.setProperty('--x','50%');ui.spot.style.setProperty('--y','50%');ui.spot.style.setProperty('--r',Math.round(slideRect().w*.12)+'px')}
  ui.laser.style.display='none';renderPop();wake();
}
function renderPop(){
  ui.bar.querySelector('[data-t="pen"]').style.setProperty('--dot',color);ui.bar.querySelector('[data-t="text"]').style.setProperty('--dot',tcolor);
  const show=barOpen&&(tool==='pen'||tool==='text');ui.pop.classList.toggle('hidden',!show);if(!show)return;
  const dots=(cur,k)=>COLORS.map(c=>`<button data-${k}="${c}" style="background:${c}" class="${c===cur?'on':''}" aria-label="Warna"></button>`).join('');
  ui.pop.innerHTML=(tool==='pen'?dots(color,'c')+'<i class="rx-psep"></i>'+SIZES.map(z=>`<button data-z="${z}" class="sz ${z===size?'on':''}" aria-label="Tebal"><i style="width:${z*2}px;height:${z*2}px"></i></button>`).join('')
    :`<span class="rx-hint">Ketuk slide untuk menaruh teks</span>`+TSIZES.map(([z,l])=>`<button data-tz="${z}" class="tz ${z===tsize?'on':''}" style="font-size:${Math.round(z/2.6)}px" aria-label="${l}">A<small>${l}</small></button>`).join('')+'<i class="rx-psep"></i>'+dots(tcolor,'tc'))
    +`<button class="rx-x" data-x aria-label="Tutup bilah">${ico(P.close,20)}</button>`;
  const on=(sel,fn)=>ui.pop.querySelectorAll(sel).forEach(b=>b.onclick=()=>{fn(b);savePref();renderPop()});
  on('[data-c]',b=>color=b.dataset.c);on('[data-z]',b=>size=+b.dataset.z);on('[data-tc]',b=>{tcolor=b.dataset.tc;styleText()});on('[data-tz]',b=>{tsize=+b.dataset.tz;styleText()});
  ui.pop.querySelector('[data-x]').onclick=()=>{barOpen=false;renderPop()};
}
let textAt=null;
function showText(e){
  const r=slideRect();textAt=[(e.clientX-r.x)/r.w,(e.clientY-r.y)/r.h];if(textAt[0]<0||textAt[1]<0||textAt[0]>1||textAt[1]>1){textAt=null;return}
  const tb=ui.tbox;tb.classList.remove('hidden');tb.style.left=Math.min(innerWidth-420,Math.max(8,e.clientX))+'px';tb.style.top=Math.min(innerHeight-90,Math.max(8,e.clientY-30))+'px';
  styleText();const inp=tb.querySelector('input');inp.value='';setTimeout(()=>inp.focus(),30);
}
function styleText(){const inp=ui?.tbox.querySelector('input');if(!inp)return;inp.style.color=tcolor;inp.style.fontSize=Math.max(14,Math.round(tsize*slideRect().w/1000))+'px'}
function hideText(){textAt=null;ui?.tbox.classList.add('hidden')}
function commitText(){
  const txt=ui.tbox.querySelector('input').value.trim().slice(0,200),p=textAt;hideText();if(!txt||!p)return;
  const st={id:'t'+Math.random().toString(36).slice(2,9),k:'t',txt,c:tcolor,z:tsize,pts:[p]};const l=ink.get(viewer.index)||[];l.push(st);ink.set(viewer.index,l);mine.push({s:viewer.index,id:st.id});redraw();
  post({t:'ink',s:viewer.index,id:st.id,c:st.c,z:st.z,k:'t',txt,pts:st.pts});
}
function undo(){
  const i=viewer.index,l=ink.get(i)||[];
  for(let k=mine.length-1;k>=0;k--){const m=mine[k];if(m.s!==i)continue;mine.splice(k,1);const st=l.find(x=>x.id===m.id);if(!st)continue;ink.set(i,l.filter(x=>x!==st));redraw();post({t:'erase',s:i,ids:[st.id]});return}
}
function slideRect(){const el=viewer?.presentSlide;const r=el?.getBoundingClientRect?.();return r&&r.width?{x:r.left,y:r.top,w:r.width,h:r.height}:{x:0,y:0,w:innerWidth,h:innerHeight}}
function sizeCanvas(){if(!ui)return;const d=devicePixelRatio||1;ui.cv.width=innerWidth*d;ui.cv.height=innerHeight*d;ui.cv.style.width=innerWidth+'px';ui.cv.style.height=innerHeight+'px';ui.ctx.setTransform(d,0,0,d,0,0)}
function redraw(){
  if(!ui||!viewer)return;const ctx=ui.ctx;ctx.clearRect(0,0,innerWidth,innerHeight);const r=slideRect();
  for(const s of ink.get(viewer.index)||[]){if(!s.pts?.length)continue;if(s.k==='t'){drawText(ctx,s,r.w,r.h,r.x,r.y);continue}ctx.strokeStyle=s.c;ctx.lineWidth=s.z*(r.w/1000);ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();s.pts.forEach(([x,y],k)=>{const px=r.x+x*r.w,py=r.y+y*r.h;k?ctx.lineTo(px,py):ctx.moveTo(px,py)});if(s.pts.length===1)ctx.lineTo(r.x+s.pts[0][0]*r.w+.1,r.y+s.pts[0][1]*r.h);ctx.stroke()}
}
function afterSlide(){if(!ui)return;ui.bar.querySelector('.rx-count').textContent=`${viewer.index+1} / ${viewer.slideCount||1}`;setTimeout(redraw,200);setTimeout(redraw,700)}
function black(on){ui?.blk.classList.toggle('on',on)}
function vid(){return viewer?.presentStage?.querySelector('video,audio')||null}
function media(m){
  const v=vid();if(!v)return;
  if(m.a==='toggle'){v.paused?v.play().catch(()=>{}):v.pause()}else if(m.a==='back10')v.currentTime=Math.max(0,v.currentTime-10);else if(m.a==='fwd10')v.currentTime=Math.min(v.duration||1e9,v.currentTime+10);else if(m.a==='vol'){v.volume=Math.max(0,Math.min(1,+m.v||0));v.muted=v.volume===0}
  setTimeout(reportMedia,150);
}
let lastMedia='';
function reportMedia(){const v=vid();const s=v?{t:'mstate',has:true,paused:v.paused,cur:Math.floor(v.currentTime||0),dur:Math.floor(v.duration||0),vol:Math.round((v.muted?0:v.volume)*100)/100}:{t:'mstate',has:false};const k=JSON.stringify(s);if(k!==lastMedia){lastMedia=k;post(s)}}

if(token)connect();else showGate();
