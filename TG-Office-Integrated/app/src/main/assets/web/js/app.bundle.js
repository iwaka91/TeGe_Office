(function(){
'use strict';
const __mods=Object.create(null),__cache=Object.create(null);
function __define(id,fn){__mods[id]=fn}
function require(id){if(__cache[id])return __cache[id].exports;if(!__mods[id])throw new Error('Module not found: '+id);const module={exports:{}};__cache[id]=module;__mods[id](module,module.exports,require);return module.exports}
__define('js/utils.js',function(module,exports,require){
const qs = (s, root=document) => root.querySelector(s);
const qsa = (s, root=document) => [...root.querySelectorAll(s)];
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const formatBytes = bytes => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const u=['KB','MB','GB']; let n=bytes/1024,i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}
  return `${n.toFixed(n<10?1:0)} ${u[i]}`;
};
const extOf = name => (name.split('.').pop()||'').toLowerCase();
const basename = path => path.split('/').pop() || path;
const dirname = path => path.includes('/') ? path.slice(0,path.lastIndexOf('/')+1) : '';
function resolvePath(baseFile,target){
  if (!target) return '';
  if (/^[a-z]+:/i.test(target)) return target;
  if (target.startsWith('/')) return target.slice(1);
  const base=dirname(baseFile).split('/').filter(Boolean);
  const parts=target.split('/');
  for(const p of parts){if(!p||p==='.')continue;if(p==='..')base.pop();else base.push(p)}
  return base.join('/');
}
const escapeHtml = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const colName = n => { let s=''; n++; while(n){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)} return s; };
const cellToRC = ref => { const m=/^([A-Z]+)(\d+)$/i.exec(ref||''); if(!m)return null; let c=0; for(const ch of m[1].toUpperCase())c=c*26+ch.charCodeAt(0)-64; return {r:+m[2]-1,c:c-1}; };
const xml = text => new DOMParser().parseFromString(text,'application/xml');
const attr = (el, local, fallback=null) => {
  if(!el) return fallback;
  for(const a of el.attributes||[]) if(a.localName===local || a.name===local || a.name.endsWith(':'+local)) return a.value;
  return fallback;
};
const childrenByLocal = (el,name) => [...(el?.children||[])].filter(x=>x.localName===name);
const firstByLocal = (el,name) => [...(el?.getElementsByTagName('*')||[])].find(x=>x.localName===name)||null;
const allByLocal = (el,name) => [...(el?.getElementsByTagName('*')||[])].filter(x=>x.localName===name);
function colorFromFill(el, fallback='transparent'){
  if(!el) return fallback;
  const solid=[...el.getElementsByTagName('*')].find(x=>x.localName==='solidFill');
  if(!solid) return fallback;
  const rgb=[...solid.children].find(x=>x.localName==='srgbClr');
  const val=attr(rgb,'val'); return val?`#${val}`:fallback;
}
function debounce(fn,ms=120){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}

Object.assign(exports,{qs,qsa,clamp,formatBytes,extOf,basename,dirname,resolvePath,escapeHtml,colName,cellToRC,xml,attr,childrenByLocal,firstByLocal,allByLocal,colorFromFill,debounce});

});
__define('js/storage.js',function(module,exports,require){
const DB='tg-office-v01',STORE='recent-files',MAX_RECENT=10,MAX_BYTES=35*1024*1024,MAX_PINNED=10;
function db(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const txReq=(mode,fn)=>db().then(database=>new Promise((res,rej)=>{const tx=database.transaction(STORE,mode),s=tx.objectStore(STORE),r=fn(s);tx.oncomplete=()=>res(r?.result);tx.onerror=()=>rej(tx.error)}));
async function listAll(){const arr=await txReq('readonly',s=>s.getAll())||[];return arr.sort((a,b)=>b.openedAt-a.openedAt)}
/* Riwayat menyimpan ALAMAT file (URI) bila TG Office punya izin baca permanen.
   Salinan file hanya disimpan untuk akses sementara (mis. file dari WhatsApp), total maks 60 MB. */
async function saveRecent(file,type,meta={}){
  const keepCopy=!(meta.persist&&meta.uri)&&file instanceof Blob;
  if(keepCopy&&file.size>MAX_BYTES)return null;
  const id=meta.id||`${file.name}|${file.size}|${file.lastModified||0}`;
  const old=await getRecent(id).catch(()=>null);
  await txReq('readwrite',s=>s.put({
    id,name:file.name,size:file.size,type,lastModified:file.lastModified||0,openedAt:Date.now(),blob:keepCopy?file:(meta.persist?null:old?.blob||null),
    pinnedAt:old?.pinnedAt||null,detail:meta.detail||old?.detail||'',position:meta.position??old?.position??null,uri:meta.uri||old?.uri||null,persist:!!(meta.persist||(!meta.uri&&old?.persist)),label:old?.label||null
  }));
  const all=await listAll(),unpinned=all.filter(x=>!x.pinnedAt);
  for(const item of unpinned.slice(MAX_RECENT))await removeRecent(item.id);
  await enforceQuota(id);
  return id;
}
/* Sekali jalan: buang salinan lama untuk file yang alamatnya sudah berizin permanen */
async function dropCopies(isPersisted){
  let freed=0;
  for(const x of await listAll()){
    if(x.blob&&x.uri&&isPersisted(x.uri)){freed+=x.blob.size||0;x.blob=null;x.persist=true;await txReq('readwrite',s=>s.put(x))}
  }
  return freed;
}
/* Pengaman ukuran: total salinan file dibatasi 60 MB; salinan tertua yang tidak disematkan dibuang dulu */
const MAX_TOTAL=60*1024*1024;
async function enforceQuota(keepId){
  const all=await listAll();let total=all.reduce((n,x)=>n+(x.blob?.size||0),0);if(total<=MAX_TOTAL)return;
  const victims=all.filter(x=>!x.pinnedAt&&x.id!==keepId).sort((a,b)=>(a.openedAt||0)-(b.openedAt||0));
  for(const v of victims){if(total<=MAX_TOTAL)break;if(!v.blob)continue;await removeRecent(v.id);total-=v.blob.size||0}
}

/* Pengaturan: buang salinan sementara. File berizin permanen tetap di riwayat (memakai alamatnya); sisanya dihapus dari riwayat. */
async function clearCopies(){let n=0;for(const x of await listAll()){if(!x.blob)continue;n++;if(x.uri&&x.persist){x.blob=null;await txReq('readwrite',s=>s.put(x))}else await removeRecent(x.id)}return n}
async function clearAllRecent(){for(const x of await listAll())await removeRecent(x.id)}
async function storageUsed(){const all=await listAll();return all.reduce((n,x)=>n+(x.blob?.size||0),0)}
async function updateRecentMeta(id,patch={}){if(!id)return false;const item=await getRecent(id);if(!item)return false;Object.assign(item,patch);await txReq('readwrite',s=>s.put(item));return true}
async function listRecent(){return (await listAll()).filter(x=>!x.pinnedAt)}
async function listPinned(){return (await listAll()).filter(x=>x.pinnedAt).sort((a,b)=>b.pinnedAt-a.pinnedAt)}
async function getRecent(id){return txReq('readonly',s=>s.get(id))}
async function removeRecent(id){return txReq('readwrite',s=>s.delete(id))}
async function clearRecent(){const all=await listAll();for(const item of all.filter(x=>!x.pinnedAt))await removeRecent(item.id)}
async function pinRecent(id){const item=await getRecent(id);if(!item)return{ok:false,reason:'missing'};if(item.pinnedAt)return{ok:true,pinned:true};const pins=await listPinned();if(pins.length>=MAX_PINNED)return{ok:false,reason:'limit'};item.pinnedAt=Date.now();await txReq('readwrite',s=>s.put(item));return{ok:true,pinned:true}}
async function unpinRecent(id){const item=await getRecent(id);if(!item)return{ok:false,reason:'missing'};item.pinnedAt=null;await txReq('readwrite',s=>s.put(item));return{ok:true,pinned:false}}
async function isPinned(id){const item=await getRecent(id);return !!item?.pinnedAt}

Object.assign(exports,{saveRecent,dropCopies,clearCopies,clearAllRecent,storageUsed,updateRecentMeta,listRecent,listPinned,getRecent,removeRecent,clearRecent,pinRecent,unpinRecent,isPinned,MAX_TOTAL,MAX_PINNED});

});
__define('js/zip-reader.js',function(module,exports,require){
const SIG_EOCD=0x06054b50,SIG_CEN=0x02014b50,SIG_LOC=0x04034b50;
const td=new TextDecoder('utf-8');
function u16(v,o){return v.getUint16(o,true)} function u32(v,o){return v.getUint32(o,true)}
async function inflateRaw(bytes){
  if(!('DecompressionStream' in globalThis)) throw new Error('Browser belum mendukung DecompressionStream. Gunakan Chrome/WebView modern.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
class ZipReader{
  constructor(buffer,{maxEntries=12000,maxUncompressed=300*1024*1024}={}){
    this.buffer=buffer;this.bytes=new Uint8Array(buffer);this.view=new DataView(buffer);this.entries=new Map();
    const min=Math.max(0,this.bytes.length-0xffff-22);let eocd=-1;
    for(let i=this.bytes.length-22;i>=min;i--){if(this.view.getUint32(i,true)===SIG_EOCD){eocd=i;break}}
    if(eocd<0) throw new Error('ZIP/Office file tidak valid (EOCD tidak ditemukan).');
    const count=u16(this.view,eocd+10), cdOffset=u32(this.view,eocd+16);
    if(count>maxEntries) throw new Error('Arsip memiliki terlalu banyak berkas internal.');
    let p=cdOffset,total=0;
    for(let i=0;i<count;i++){
      if(u32(this.view,p)!==SIG_CEN) throw new Error('Central directory ZIP rusak.');
      const method=u16(this.view,p+10),comp=u32(this.view,p+20),uncomp=u32(this.view,p+24),nameLen=u16(this.view,p+28),extraLen=u16(this.view,p+30),commentLen=u16(this.view,p+32),local=u32(this.view,p+42);
      const name=td.decode(this.bytes.subarray(p+46,p+46+nameLen)); total+=uncomp;
      if(total>maxUncompressed) throw new Error('Ukuran hasil ekstraksi terlalu besar untuk viewer dasar.');
      this.entries.set(name,{name,method,comp,uncomp,local});p+=46+nameLen+extraLen+commentLen;
    }
  }
  has(name){return this.entries.has(name)}
  list(prefix=''){return [...this.entries.keys()].filter(x=>x.startsWith(prefix))}
  async bytesOf(name){
    const e=this.entries.get(name);if(!e)throw new Error(`Berkas internal tidak ditemukan: ${name}`);
    const p=e.local;if(u32(this.view,p)!==SIG_LOC)throw new Error('Local header ZIP rusak.');
    const nameLen=u16(this.view,p+26),extraLen=u16(this.view,p+28),start=p+30+nameLen+extraLen;
    const raw=this.bytes.subarray(start,start+e.comp);
    if(e.method===0)return new Uint8Array(raw);
    if(e.method===8)return inflateRaw(raw);
    throw new Error(`Metode kompresi ZIP ${e.method} belum didukung.`);
  }
  async text(name){return td.decode(await this.bytesOf(name))}
  async blobUrl(name,mime='application/octet-stream') {return URL.createObjectURL(new Blob([await this.bytesOf(name)],{type:mime}))}
}
async function openZip(buffer,opts){return new ZipReader(buffer,opts)}

Object.assign(exports,{ZipReader,openZip});

});
__define('js/viewers/docx.js',function(module,exports,require){
const {openZip}=require('js/zip-reader.js');
const {xml,attr,resolvePath,firstByLocal,clamp}=require('js/utils.js');
const MIME={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp',emf:'image/emf',wmf:'image/wmf'};
const PX=96/1440;
const kids=(e,n)=>e?[...e.children].filter(c=>c.localName===n):[];
const kid=(e,n)=>e?[...e.children].find(c=>c.localName===n)||null:null;
const A=(e,k='val')=>e?attr(e,k):null;
const flag=e=>{if(!e)return undefined;const x=attr(e,'val');return !(x==='0'||x==='false'||x==='off')};
const num=(e,k='val')=>{const x=e?attr(e,k):null;return x==null||x===''||isNaN(+x)?undefined:+x};
const el=(tag,cls)=>{const e=document.createElement(tag);if(cls)e.className=cls;return e};

/* ---------- font pengganti (dibundel di web/fonts, lisensi OFL) ---------- */
const FONT_MAP=[
  [/times|serif|georgia|cambria|palatino|garamond|century|bookman|minion|constantia|baskerville|tinos|book antiqua|sylfaen/i,"'TG Serif'",'serif',1.149],
  [/calibri|carlito|aptos|candara|corbel|lato|source sans|noto sans|gill sans/i,"'TG Humanist'",'sans-serif',1.22],
  [/courier|consolas|mono|lucida console/i,"'Courier New',Courier",'monospace',1.13]
];
function fontInfo(name){
  for(const [re,fam,gen,r] of FONT_MAP)if(name&&re.test(name))return{fam,css:`${fam},${gen}`,ratio:r};
  return{fam:"'TG Sans'",css:"'TG Sans',Arial,sans-serif",ratio:1.149};
}
const HILITE={yellow:'FFFF00',green:'00FF00',cyan:'00FFFF',magenta:'FF00FF',blue:'0000FF',red:'FF0000',darkBlue:'000080',darkCyan:'008080',darkGreen:'008000',darkMagenta:'800080',darkRed:'800000',darkYellow:'808000',darkGray:'808080',lightGray:'C0C0C0',black:'000000',white:'FFFFFF'};
const THEME_ALIAS={text1:'dk1',background1:'lt1',text2:'dk2',background2:'lt2',dark1:'dk1',light1:'lt1',dark2:'dk2',light2:'lt2',hyperlink:'hlink',followedHyperlink:'folHlink'};
const SYMBOL_BULLET={'':'•','':'▪','':'➢','':'✓','':'❖','':'◦','':'◦','':'•'};

/* ---------- penguraian properti ---------- */
function parseBorders(e){
  const o={};if(!e)return o;
  for(const c of e.children){
    const n=({start:'left',end:'right'}[c.localName])||c.localName;
    o[n]={val:A(c)||'single',sz:num(c,'sz')??4,color:A(c,'color'),theme:A(c,'themeColor'),space:num(c,'space')||0};
  }
  return o;
}
function parseMar(e){
  const o={};if(!e)return o;
  for(const c of e.children){const n=({start:'left',end:'right'}[c.localName])||c.localName;const w=num(c,'w');if(w!==undefined)o[n]=w}
  return o;
}
const parseShd=c=>({fill:A(c,'fill'),theme:A(c,'themeFill'),tint:A(c,'themeFillTint'),shade:A(c,'themeFillShade')});
/* warna tema + tint/shade (Word): bila ada nilai hex siap pakai, itu yang dipakai */
function tone(hex,tint,shade){
  let v=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));if(v.some(isNaN))return hex;
  if(shade){const f=parseInt(shade,16)/255;if(!isNaN(f))v=v.map(x=>x*f)}
  if(tint){const f=parseInt(tint,16)/255;if(!isNaN(f))v=v.map(x=>x*f+255*(1-f))}
  return v.map(x=>Math.round(Math.max(0,Math.min(255,x))).toString(16).padStart(2,'0')).join('').toUpperCase();
}
const PAGE_FLD=/^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i;
function pageFmt(n,f){
  if(f==='upperRoman'||f==='lowerRoman'){const t=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let r='',x=n;for(const [v,c] of t)while(x>=v){r+=c;x-=v}return f==='lowerRoman'?r.toLowerCase():r}
  if(f==='upperLetter'||f==='lowerLetter'){const c=String.fromCharCode(65+(n-1)%26).repeat(Math.floor((n-1)/26)+1);return f==='lowerLetter'?c.toLowerCase():c}
  return String(n);
}
function parseRPr(e){
  const o={};if(!e)return o;
  for(const c of e.children){
    switch(c.localName){
      case 'rFonts':{const f={};for(const k of ['ascii','hAnsi','asciiTheme','hAnsiTheme']){const x=attr(c,k);if(x)f[k]=x}o.font=f;break}
      case 'b':o.b=flag(c);break;case 'i':o.i=flag(c);break;
      case 'caps':o.caps=flag(c);break;case 'smallCaps':o.sc=flag(c);break;
      case 'strike':o.strike=flag(c);break;case 'dstrike':o.strike=flag(c);break;
      case 'vanish':o.vanish=flag(c);break;
      case 'u':o.u=A(c)||'single';break;
      case 'color':o.color={val:A(c),theme:A(c,'themeColor'),tint:A(c,'themeTint'),shade:A(c,'themeShade')};break;
      case 'sz':o.sz=num(c);break;
      case 'highlight':o.hl=A(c);break;
      case 'shd':o.shd=parseShd(c);break;
      case 'vertAlign':o.va=A(c);break;
      case 'spacing':o.sp=num(c);break;
      case 'position':o.pos=num(c);break;
      case 'rStyle':o.rStyle=A(c);break;
    }
  }
  return o;
}
function parsePPr(e){
  const o={};if(!e)return o;
  for(const c of e.children){
    switch(c.localName){
      case 'pStyle':o.pStyle=A(c);break;
      case 'jc':o.jc=A(c);break;
      case 'spacing':{const s={};for(const k of ['before','after','line']){const x=num(c,k);if(x!==undefined)s[k]=x}const lr=A(c,'lineRule');if(lr)s.lineRule=lr;if(['1','true'].includes(A(c,'beforeAutospacing')))s.bAuto=true;if(['1','true'].includes(A(c,'afterAutospacing')))s.aAuto=true;o.sp=s;break}
      case 'ind':{const i={};for(const [k,n] of [['left','left'],['start','left'],['right','right'],['end','right'],['firstLine','firstLine'],['hanging','hanging']]){const x=num(c,k);if(x!==undefined)i[n]=x}o.ind=i;break}
      case 'tabs':o.tabs=kids(c,'tab').map(t=>({pos:num(t,'pos')||0,val:A(t,'val')||'left',leader:A(t,'leader')||'none'}));break;
      case 'numPr':{o.numId=num(kid(c,'numId'));o.ilvl=num(kid(c,'ilvl'));break}
      case 'pBdr':o.bdr=parseBorders(c);break;
      case 'shd':o.shd=parseShd(c);break;
      case 'contextualSpacing':o.ctx=flag(c);break;
      case 'pageBreakBefore':o.pbb=flag(c);break;
      case 'rPr':o.mark=parseRPr(c);break;
      case 'sectPr':o.sect=c;break;
    }
  }
  return o;
}
function parseTblPr(e){
  const o={};if(!e)return o;
  const b=kid(e,'tblBorders');if(b)o.borders=parseBorders(b);
  const m=kid(e,'tblCellMar');if(m)o.mar=parseMar(m);
  const w=kid(e,'tblW');if(w)o.w={w:num(w,'w')||0,type:A(w,'type')||'auto'};
  const ind=kid(e,'tblInd');if(ind)o.ind=num(ind,'w')||0;
  const jc=kid(e,'jc');if(jc)o.jc=A(jc);
  const lay=kid(e,'tblLayout');if(lay)o.fixed=A(lay,'type')==='fixed';
  const st=kid(e,'tblStyle');if(st)o.style=A(st);
  const lk=kid(e,'tblLook');if(lk){const v=parseInt(A(lk)||'0',16)||0;const f=(n,bit)=>{const x=attr(lk,n);return x==null?!!(v&bit):(x==='1'||x==='true')};o.look={fr:f('firstRow',0x20),lr:f('lastRow',0x40),fc:f('firstColumn',0x80),lc:f('lastColumn',0x100),nh:f('noHBand',0x200),nv:f('noVBand',0x400)}}
  return o;
}
function parseTcPr(e){
  const o={};if(!e)return o;
  const b=kid(e,'tcBorders');if(b)o.borders=parseBorders(b);
  const s=kid(e,'shd');if(s)o.shd=parseShd(s);
  const m=kid(e,'tcMar');if(m)o.mar=parseMar(m);
  const va=kid(e,'vAlign');if(va)o.va=A(va);
  const gs=kid(e,'gridSpan');if(gs)o.span=num(gs)||1;
  const vm=kid(e,'vMerge');if(vm)o.vm=(A(vm)==='restart')?'restart':'cont';
  return o;
}
const mergeSides=(a,b)=>{const o={...(a||{})};for(const k in (b||{}))o[k]={...(o[k]||{}),...b[k]};return o};
function mergeR(a,b){
  const o={...a};
  for(const k in b){if(b[k]===undefined)continue;if(k==='font'){const f={...(a.font||{}),...b.font};if(b.font.ascii&&!b.font.asciiTheme)delete f.asciiTheme;if(b.font.hAnsi&&!b.font.hAnsiTheme)delete f.hAnsiTheme;if(b.font.asciiTheme&&!b.font.ascii)delete f.ascii;if(b.font.hAnsiTheme&&!b.font.hAnsi)delete f.hAnsi;o.font=f}else o[k]=b[k]}
  return o;
}
function mergeP(a,b){
  const o={...a};
  for(const k in b){
    const v=b[k];if(v===undefined)continue;
    if(k==='sp')o.sp={...(a.sp||{}),...v};
    else if(k==='ind'){const i={...(a.ind||{}),...v};if(v.hanging!==undefined&&v.firstLine===undefined)delete i.firstLine;if(v.firstLine!==undefined&&v.hanging===undefined)delete i.hanging;o.ind=i}
    else if(k==='tabs'){const m=new Map((a.tabs||[]).map(t=>[t.pos,t]));for(const t of v){if(t.val==='clear')m.delete(t.pos);else m.set(t.pos,t)}o.tabs=[...m.values()]}
    else if(k==='bdr')o.bdr=mergeSides(a.bdr,v);
    else if(k==='mark')o.mark=mergeR(a.mark||{},v);
    else o[k]=v;
  }
  return o;
}
function mergeT(a,b){
  const o={...a};
  for(const k in b){const v=b[k];if(v===undefined)continue;
    if(k==='borders')o.borders=mergeSides(a.borders,v);else if(k==='mar')o.mar={...(a.mar||{}),...v};else o[k]=v}
  return o;
}

class Theme{
  constructor(d){
    this.colors={};this.major='';this.minor='';if(!d)return;
    const all=[...d.getElementsByTagName('*')],sch=all.find(x=>x.localName==='clrScheme');
    for(const c of sch?.children||[]){const x=c.firstElementChild;if(x)this.colors[c.localName]=(x.localName==='sysClr'?attr(x,'lastClr'):attr(x,'val'))||''}
    const f=n=>{const fs=all.find(x=>x.localName===n);const l=fs&&[...fs.children].find(x=>x.localName==='latin');return l?attr(l,'typeface')||'':''};
    this.major=f('majorFont');this.minor=f('minorFont');
  }
  color(name){return this.colors[THEME_ALIAS[name]||name]||''}
}

class Styles{
  constructor(doc){
    this.map=new Map();this.defR={};this.defP={};this.defPara=null;this.defTable=null;
    if(!doc)return;
    const root=doc.documentElement,dd=kid(root,'docDefaults');
    this.defR=parseRPr(kid(kid(dd,'rPrDefault'),'rPr'));this.defP=parsePPr(kid(kid(dd,'pPrDefault'),'pPr'));
    for(const s of kids(root,'style')){
      const id=attr(s,'styleId'),type=attr(s,'type');
      const st={id,type,based:A(kid(s,'basedOn')),p:parsePPr(kid(s,'pPr')),r:parseRPr(kid(s,'rPr')),tbl:parseTblPr(kid(s,'tblPr')),tc:parseTcPr(kid(s,'tcPr')),cond:{}};
      for(const sp of kids(s,'tblStylePr'))st.cond[attr(sp,'type')]={p:parsePPr(kid(sp,'pPr')),r:parseRPr(kid(sp,'rPr')),tc:parseTcPr(kid(sp,'tcPr')),tbl:parseTblPr(kid(sp,'tblPr'))};
      this.map.set(id,st);
      if(['1','true'].includes(attr(s,'default'))){if(type==='paragraph')this.defPara=id;if(type==='table')this.defTable=id}
    }
  }
  chain(id){const out=[],seen=new Set();while(id&&!seen.has(id)&&this.map.has(id)){seen.add(id);const s=this.map.get(id);out.unshift(s);id=s.based}return out}
  para(id){let p={},r={};for(const s of this.chain(id||this.defPara)){p=mergeP(p,s.p);r=mergeR(r,s.r)}return{p,r}}
  char(id){let r={};for(const s of this.chain(id))r=mergeR(r,s.r);return r}
  table(id){
    const o={tbl:{},p:{},r:{},tc:{},cond:{}};
    for(const s of this.chain(id||this.defTable)){
      o.tbl=mergeT(o.tbl,s.tbl);o.p=mergeP(o.p,s.p);o.r=mergeR(o.r,s.r);o.tc=mergeT(o.tc,s.tc);
      for(const k in s.cond){const c=o.cond[k]||(o.cond[k]={p:{},r:{},tc:{},tbl:{}});c.p=mergeP(c.p,s.cond[k].p);c.r=mergeR(c.r,s.cond[k].r);c.tc=mergeT(c.tc,s.cond[k].tc);c.tbl=mergeT(c.tbl,s.cond[k].tbl)}
    }
    return o;
  }
}

const ROMAN=[[1000,'m'],[900,'cm'],[500,'d'],[400,'cd'],[100,'c'],[90,'xc'],[50,'l'],[40,'xl'],[10,'x'],[9,'ix'],[5,'v'],[4,'iv'],[1,'i']];
function fmtNum(f,n){
  switch(f){
    case 'lowerLetter':return String.fromCharCode(97+(n-1)%26).repeat(Math.ceil(n/26));
    case 'upperLetter':return String.fromCharCode(65+(n-1)%26).repeat(Math.ceil(n/26));
    case 'lowerRoman':case 'upperRoman':{let s='',x=n;for(const [v,r] of ROMAN)while(x>=v){s+=r;x-=v}return f==='upperRoman'?s.toUpperCase():s}
    case 'decimalZero':return n<10?'0'+n:String(n);
    case 'none':case 'bullet':return '';
    default:return String(n);
  }
}
class Numbering{
  constructor(doc){
    this.abs=new Map();this.nums=new Map();this.count=new Map();this.seen=new Set();
    if(!doc)return;
    const root=doc.documentElement;
    for(const a of kids(root,'abstractNum')){
      const lv=[];
      for(const l of kids(a,'lvl'))lv[+attr(l,'ilvl')]={start:num(kid(l,'start'))??1,fmt:A(kid(l,'numFmt'))||'decimal',text:A(kid(l,'lvlText'))??'',suff:A(kid(l,'suff'))||'tab',p:parsePPr(kid(l,'pPr')),r:parseRPr(kid(l,'rPr')),lgl:!!kid(l,'isLgl'),rf:attr(kid(kid(l,'rPr'),'rFonts')||{attributes:[]},'ascii')};
      this.abs.set(attr(a,'abstractNumId'),lv);
    }
    for(const n of kids(root,'num')){
      const ov={};for(const o of kids(n,'lvlOverride')){const s=num(kid(o,'startOverride'));if(s!==undefined)ov[+attr(o,'ilvl')]=s}
      this.nums.set(attr(n,'numId'),{abs:A(kid(n,'abstractNumId')),ov});
    }
  }
  lvl(numId,ilvl){const n=this.nums.get(String(numId));const lv=n&&this.abs.get(n.abs);return lv?lv[ilvl]||null:null}
  take(numId,ilvl){
    const n=this.nums.get(String(numId)),lv=n&&this.abs.get(n.abs);if(!lv||!lv[ilvl])return null;
    let c=this.count.get(n.abs);if(!c){c=[];this.count.set(n.abs,c)}
    const key=n.abs+'|'+numId;
    if(!this.seen.has(key)){this.seen.add(key);for(const k in n.ov){c[k]=n.ov[k]-1;for(let j=+k+1;j<c.length;j++)c[j]=null}}
    c[ilvl]=c[ilvl]==null?lv[ilvl].start:c[ilvl]+1;
    for(let k=ilvl+1;k<c.length;k++)c[k]=null;
    const L=lv[ilvl];
    const text=L.text.replace(/%(\d)/g,(m,d)=>{const k=+d-1;if(!lv[k])return '';return fmtNum(L.lgl&&k!==ilvl?'decimal':lv[k].fmt,c[k]??lv[k].start)});
    return{lvl:L,text:L.fmt==='bullet'?(SYMBOL_BULLET[L.text]||(L.text&&L.text.charCodeAt(0)<0xF000?L.text:'•')):text};
  }
}

const lum=hex=>{const h=hex.replace('#','');const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return(0.299*r+0.587*g+0.114*b)/255};
function bdrCss(b,theme){
  if(!b||/^(nil|none)$/.test(b.val||''))return 'none';
  let col=b.theme?theme.color(b.theme):'';if(!col)col=(b.color&&b.color!=='auto')?b.color:'000000';
  const dbl=/double|thinThick|thickThin|triple/.test(b.val),w=Math.max(dbl?3:1,(b.sz||4)/6);
  const style=dbl?'double':/dot/i.test(b.val)?'dotted':/dash/i.test(b.val)?'dashed':'solid';
  return `${w.toFixed(2)}px ${style} #${col}`;
}

class DocxViewer{
  constructor(host,subToolbar=null){this.host=host;this.subToolbar=subToolbar;this.zoom=1;this.mode='mobile';this.urls=[];this.shell=null;this.source=[];this.secOf=[];this.sections=[];this.pages=[];this.pageGap=true;this.searchHits=[];this.searchIndex=-1;this.searchQuery='';this.scrollHandler=null;this.currentPage=1;this.fitMode='width';this.fontsUsed=new Set();this.imgCache=new Map()}

  async open(file){
    const zip=await openZip(await file.arrayBuffer());if(!zip.has('word/document.xml'))throw new Error('Struktur DOCX tidak dikenali.');
    const rd=async p=>zip.has(p)?xml(await zip.text(p)):null;
    this.theme=new Theme(await rd('word/theme/theme1.xml'));this.styles=new Styles(await rd('word/styles.xml'));this.numbering=new Numbering(await rd('word/numbering.xml'));
    const st=await rd('word/settings.xml');let compat=12,tab=720;
    if(st){const dts=[...st.getElementsByTagName('*')];const t=dts.find(x=>x.localName==='defaultTabStop');if(t)tab=num(t)||720;const cs=dts.find(x=>x.localName==='compatSetting'&&attr(x,'name')==='compatibilityMode');if(cs)compat=num(cs)||12}
    this.compat=compat;this.defTab=tab*PX;
    this.zip=zip;const ctx=await this._ctx('word/document.xml');this.ctx=ctx;
    const d=xml(await zip.text('word/document.xml')),body=[...d.documentElement.children].find(x=>x.localName==='body');
    const nodes=[],secOf=[],sectPrs=[];let si=0;
    for(const n of await this._blocks(body,ctx,{},true)){
      if(n.nodeType===1&&n.dataset?.k==='sec'){sectPrs.push(n._sect);nodes.push(n);secOf.push(si);si++;continue}
      nodes.push(n);secOf.push(si);
    }
    const last=kid(body,'sectPr');sectPrs.push(last);
    this.source=nodes;this.secOf=secOf;
    this.sections=[];const cache=new Map();
    for(const sp of sectPrs)this.sections.push(await this._section(sp,ctx,cache,this.sections.at(-1)));
    this.page=this.sections[0].page;
    await this._loadFonts();
    this._prepareLayout();
    this.shell=document.createElement('div');this.shell.className='docx-shell mobile';this.host.replaceChildren(this.shell);this._toolbar();this._renderMobile();this._buildPrintPages();this._makeFloatingNav();this._apply();this.scrollHandler=()=>this._updateCurrentPage();this.host.addEventListener('scroll',this.scrollHandler,{passive:true});return{engine:'Local OOXML',detail:`DOCX · ${this.pages.length} halaman`}
  }

  /* ---------- konteks bagian (relasi gambar) ---------- */
  async _ctx(part){
    const rels={},dir=part.slice(0,part.lastIndexOf('/')+1),rp=dir+'_rels/'+part.slice(dir.length)+'.rels';
    if(this.zip.has(rp)){const d=xml(await this.zip.text(rp));for(const r of [...d.documentElement.children])rels[attr(r,'Id')]=resolvePath(part,attr(r,'Target'))}
    return{rels,part};
  }
  async _section(sp,ctx,cache,prev){
    const pg=kid(sp,'pgSz'),mar=kid(sp,'pgMar'),g=(e,k,f)=>{const x=num(e,k);return x===undefined?f:x};
    const w=g(pg,'w',11906),h=g(pg,'h',16838);
    const page={w:w*PX,h:h*PX,l:g(mar,'left',1440)*PX,r:g(mar,'right',1440)*PX,t:g(mar,'top',1440)*PX,b:g(mar,'bottom',1440)*PX,hd:g(mar,'header',720)*PX,fd:g(mar,'footer',720)*PX};
    const pn=kid(sp,'pgNumType');const sec={page,titlePg:!!kid(sp,'titlePg'),cont:A(kid(sp,'type'))==='continuous',hdr:{},ftr:{},pgStart:num(pn,'start'),pgFmt:A(pn,'fmt')};
    for(const [kind,tag] of [['hdr','headerReference'],['ftr','footerReference']]){
      for(const ref of kids(sp,tag)){
        const type=attr(ref,'type')||'default',path=ctx.rels[attr(ref,'id')];if(!path||!this.zip.has(path))continue;
        if(!cache.has(path)){const c=await this._ctx(path),d=xml(await this.zip.text(path));const nodes=(await this._blocks(d.documentElement,c,{},false)).filter(n=>!n.dataset?.k);cache.set(path,nodes)}
        sec[kind][type]={nodes:cache.get(path),h:0};
      }
      for(const t of ['default','first'])if(!sec[kind][t]&&prev?.[kind][t]&&!(t==='first'&&!sec.titlePg))sec[kind][t]=prev[kind][t];
    }
    return sec;
  }

  /* ---------- blok: paragraf dan tabel ---------- */
  async _blocks(parent,ctx,tc,top){
    const out=[];
    for(const n of [...parent.children]){
      if(n.localName==='p')out.push(...await this._p(n,ctx,tc));
      else if(n.localName==='tbl')out.push(await this._tbl(n,ctx,tc));
      else if(n.localName==='sdt'){const c=kid(n,'sdtContent');if(c)out.push(...await this._blocks(c,ctx,tc,top))}
    }
    this._contextual(out);
    return out;
  }
  _contextual(list){
    for(let i=1;i<list.length;i++){const a=list[i-1],b=list[i];if(a.dataset?.cs&&a.dataset.cs===b.dataset?.cs){a.style.marginBottom='0';b.style.marginTop='0'}}
  }
  _pEff(d,tc){
    const sty=this.styles.para(d.pStyle);
    let p=mergeP(mergeP(this.styles.defP,tc.p||{}),sty.p);
    const nid=d.numId!==undefined?d.numId:p.numId,lv=d.ilvl!==undefined?d.ilvl:(p.ilvl??0);
    if(nid>0){const L=this.numbering.lvl(nid,lv);if(L)p=mergeP(p,L.p)}
    p=mergeP(p,d);p.numId=nid;p.ilvl=lv;p.styleId=d.pStyle||this.styles.defPara;
    return{p,styleR:mergeR(mergeR(this.styles.defR,tc.r||{}),sty.r)};
  }
  _rCss(r){
    let name=r.font?.ascii||r.font?.hAnsi;
    const th=r.font?.asciiTheme||r.font?.hAnsiTheme;if(th)name=/major/i.test(th)?this.theme.major:this.theme.minor;
    const fi=fontInfo(name||'Times New Roman');this.fontsUsed.add(fi.fam.replace(/'/g,''));
    const sz=(r.sz||20)*2/3;let css=`font-family:${fi.css};font-size:${sz.toFixed(2)}px;font-weight:${r.b?700:400};font-style:${r.i?'italic':'normal'};`;
    const dec=[];if(r.u&&r.u!=='none')dec.push('underline');if(r.strike)dec.push('line-through');
    css+=`text-decoration:${dec.join(' ')||'none'};`;
    if(r.u==='double')css+='text-decoration-style:double;';else if(/dot/.test(r.u||''))css+='text-decoration-style:dotted;';else if(/dash/.test(r.u||''))css+='text-decoration-style:dashed;';else if(/wav/.test(r.u||''))css+='text-decoration-style:wavy;';
    if(r.caps)css+='text-transform:uppercase;';if(r.sc)css+='font-variant:small-caps;';
    const col=r.color?this._tc(r.color.theme,r.color.val,r.color.tint,r.color.shade):'';
    if(col)css+=`color:#${col};`;
    const hl=r.hl&&HILITE[r.hl];let bg=hl||'';if(!bg&&r.shd)bg=this._color(r.shd);
    if(bg)css+=`background-color:#${bg};`;
    if(r.sp)css+=`letter-spacing:${(r.sp*PX).toFixed(2)}px;`;
    if(r.va==='superscript')css+=`font-size:${(sz*.65).toFixed(2)}px;position:relative;top:-${(sz*.35).toFixed(2)}px;line-height:0;`;
    else if(r.va==='subscript')css+=`font-size:${(sz*.65).toFixed(2)}px;position:relative;top:${(sz*.15).toFixed(2)}px;line-height:0;`;
    if(r.pos)css+=`position:relative;top:${(-r.pos*2/3).toFixed(2)}px;`;
    return{css,ratio:fi.ratio,sz,fam:fi.css};
  }
  _stops(p){return(p.tabs||[]).filter(t=>t.val!=='clear').map(t=>({x:t.pos*PX,type:t.val==='end'?'right':t.val==='start'?'left':t.val,leader:t.leader})).sort((a,b)=>a.x-b.x)}

  async _p(p,ctx,tc){
    const d=parsePPr(kid(p,'pPr')),{p:e,styleR}=this._pEff(d,tc);
    const markR=mergeR(styleR,e.mark||{}),mi=this._rCss(markR);
    const ind=e.ind||{},sp=e.sp||{};
    const left=(ind.left||0)*PX,right=(ind.right||0)*PX,hang=(ind.hanging||0)*PX,fl=(ind.firstLine||0)*PX;
    const out=[];
    const mk=()=>{
      const q=el('p');let ml=left,pl=0,m='';
      q.style.cssText=`font-family:${mi.fam};font-size:${mi.sz.toFixed(2)}px;`;
      if(sp.line){
        if(sp.lineRule==='exact'||sp.lineRule==='atLeast'){const lp=sp.line*PX;if(sp.lineRule==='exact'||lp>mi.sz*mi.ratio)q.style.lineHeight=lp.toFixed(2)+'px';else q.style.lineHeight=String(mi.ratio)}
        else q.style.lineHeight=((sp.line/240)*mi.ratio).toFixed(3)
      }else q.style.lineHeight=String(mi.ratio);
            q.style.marginTop=((sp.bAuto&&sp.before===undefined?280:(sp.before||0))*PX).toFixed(2)+'px';
      q.style.marginBottom=((sp.aAuto&&sp.after===undefined?280:(sp.after||0))*PX).toFixed(2)+'px';
      const jc=e.jc;q.style.textAlign=({center:'center',right:'right',end:'right',both:'justify',distribute:'justify'}[jc])||'left';
      q.style.textIndent=hang?`-${hang.toFixed(2)}px`:fl?`${fl.toFixed(2)}px`:'0';
      if(e.bdr){for(const s of ['top','bottom','left','right']){const b=e.bdr[s];if(!b||/^(nil|none)$/.test(b.val))continue;const sp2=(b.space||0)*96/72;q.style['border'+s[0].toUpperCase()+s.slice(1)]=bdrCss(b,this.theme);if(s==='left'){pl=sp2+Math.max(1,(b.sz||4)/6);q.style.paddingLeft=sp2+'px'}else if(s==='right')q.style.paddingRight=sp2+'px';else q.style['padding'+s[0].toUpperCase()+s.slice(1)]=sp2+'px'}if(e.bdr.left)ml-=pl}
      q.style.marginLeft=ml.toFixed(2)+'px';q.style.marginRight=right.toFixed(2)+'px';
      if(e.shd){const f=this._color(e.shd);if(f)q.style.backgroundColor='#'+f}
      q.dataset.left=left;q.dataset.hang=hang;const st=this._stops(e);if(st.length)q.dataset.tabs=JSON.stringify(st);
      if(e.ctx)q.dataset.cs=e.styleId||'';
      return q;
    };
    if(e.pbb)out.push(this._marker('pb'));
    let cur=mk(),hasContent=false,afterBreak=false;
    const addTab=(host,css)=>{const t=el('span','tgd-tab');t.style.cssText=css;host.append(t);host.classList.add('tgd-hastab')};
    const runBase=styleR;
    const flushText=(t,css,ratio)=>{if(!t)return;const s=document.createElement('span');s.textContent=t;let c=css;if(Math.abs(ratio-mi.ratio)>.001&&e.sp?.line&&!(e.sp.lineRule==='exact'||e.sp.lineRule==='atLeast'))c+=`line-height:${((e.sp.line/240)*ratio).toFixed(3)};`;s.style.cssText=c;cur.append(s);hasContent=true;afterBreak=false};
    // nomor/penanda daftar
    if(e.numId>0){
      const lab=this.numbering.take(e.numId,e.ilvl);
      if(lab&&(lab.text||lab.lvl.fmt==='bullet')){
        let lr=mergeR(mergeR(runBase,e.mark||{}),lab.lvl.r);if(lab.lvl.fmt==='bullet'&&/symbol|wingdings/i.test(lab.lvl.rf||'')){lr=mergeR(lr,{font:{ascii:'Arial'}})}
        const li=this._rCss(lr);flushText(lab.text,li.css,li.ratio);
        if(lab.lvl.suff==='tab')addTab(cur,`font-size:${li.sz}px`);else if(lab.lvl.suff==='space')flushText(' ',li.css,li.ratio);
      }
    }
    // field nomor halaman: diisi setelah halaman disusun (_numberPages)
    const fs=[],hide=()=>fs.some(f=>f.res&&f.pg);
    const addFld=(instr,css,cached)=>{const k=PAGE_FLD.exec(instr)[1].toUpperCase();const s=document.createElement('span');s.className='tgd-fld';s.dataset.f=k;s.textContent=cached||'1';s.style.cssText=css;cur.append(s);hasContent=true;afterBreak=false};
    const run=async r=>{
      const rd=parseRPr(kid(r,'rPr'));let reff=mergeR(runBase,rd.rStyle?this.styles.char(rd.rStyle):{});reff=mergeR(reff,rd);
      if(reff.vanish)return;
      const ri=this._rCss(reff);let buf='';
      const flush=()=>{flushText(buf,ri.css,ri.ratio);buf=''};
      for(const n of r.children){
        switch(n.localName){
          case 't':if(!hide())buf+=n.textContent||'';break;
          case 'fldChar':{const t=attr(n,'fldCharType');flush();
            if(t==='begin')fs.push({instr:'',res:false,pg:false,done:false});
            else if(t==='separate'){const f=fs.at(-1);if(f){f.res=true;if(PAGE_FLD.test(f.instr)&&!fs.slice(0,-1).some(x=>x.res&&x.pg)){f.pg=true;addFld(f.instr,ri.css)}}}
            else if(t==='end'){const f=fs.pop();if(f&&!f.res&&PAGE_FLD.test(f.instr)&&!hide())addFld(f.instr,ri.css)}
            break}
          case 'instrText':{const f=fs.at(-1);if(f&&!f.res)f.instr+=n.textContent||'';break}
          case 'noBreakHyphen':buf+='‑';break;
          case 'tab':flush();addTab(cur,`font-size:${ri.sz}px;color:inherit`);hasContent=true;break;
          case 'cr':flush();cur.append(document.createElement('br'));hasContent=true;break;
          case 'br':{flush();const t=attr(n,'type');if(t==='page'){if(hasContent)out.push(cur);out.push(this._marker('pb'));cur=mk();hasContent=false;afterBreak=true}else if(t==='column'){}else{cur.append(document.createElement('br'));hasContent=true}break}
          case 'drawing':case 'pict':flush();await this._drawing(n,cur,ctx);hasContent=true;break;
          case 'AlternateContent':{flush();const ch=kid(n,'Choice');for(const m of ch?[...ch.children]:[])if(m.localName==='drawing'||m.localName==='pict'){await this._drawing(m,cur,ctx);hasContent=true}break}
        }
      }
      flush();
    };
    const walk=async node=>{
      for(const c of node.children){
        switch(c.localName){
          case 'r':await run(c);break;
          case 'fldSimple':{const ins=attr(c,'instr')||'';if(PAGE_FLD.test(ins)&&!hide()){const r0=kid(c,'r'),rd=r0?parseRPr(kid(r0,'rPr')):{};let re=mergeR(runBase,rd.rStyle?this.styles.char(rd.rStyle):{});re=mergeR(re,rd);addFld(ins,this._rCss(re).css)}else await walk(c);break}
          case 'hyperlink':case 'ins':case 'smartTag':case 'customXml':case 'moveTo':await walk(c);break;
          case 'sdt':{const sc=kid(c,'sdtContent');if(sc)await walk(sc);break}
        }
      }
    };
    await walk(p);
    if(!(afterBreak&&!hasContent&&this.compat>=15)){
      if(![...cur.childNodes].some(n=>n.nodeType===3||n.style?.position!=='absolute')){const s=document.createElement('span');s.textContent='\u200b';cur.append(s)}
      out.push(cur);
    }
    if(e.sect||d.sect){const m=this._marker('sec');m._sect=e.sect||d.sect;out.push(m)}
    return out;
  }
  _marker(k){const m=el('div','tgd-pb');m.dataset.k=k;return m}

  /* ---------- gambar & garis ---------- */
  async _drawing(n,host,ctx){
    if(n.localName==='drawing'){
      const anc=[...n.children].find(x=>x.localName==='anchor'||x.localName==='inline');if(!anc)return;
      const ext=kid(anc,'extent'),cx=num(ext,'cx')||0,cy=num(ext,'cy')||0,blip=firstByLocal(anc,'blip');
      const isAnchor=anc.localName==='anchor',noWrap=isAnchor&&kid(anc,'wrapNone');
      let abs=null;
      if(noWrap){
        const ph=kid(anc,'positionH'),pv=kid(anc,'positionV'),hf=A(ph,'relativeFrom'),vf=A(pv,'relativeFrom');
        if(['column','margin','character'].includes(hf)&&['paragraph','line'].includes(vf)&&kid(ph,'posOffset')&&kid(pv,'posOffset'))abs={x:+kid(ph,'posOffset').textContent/9525,y:+kid(pv,'posOffset').textContent/9525};
      }
      let node=null;
      if(blip){
        const url=await this._img(attr(blip,'embed'),ctx);if(!url)return;
        node=document.createElement('img');node.src=url;node.alt='Gambar dokumen';if(cx){node.style.width=(cx/9525)+'px';if(cy)node.style.aspectRatio=`${cx}/${cy}`}
      }else{
        const g=firstByLocal(anc,'prstGeom'),prst=A(g,'prst');
        if(prst&&/line|connector/i.test(prst)){
          const ln=firstByLocal(anc,'ln'),w=Math.max(1,(num(ln,'w')||9525)/9525),clr=firstByLocal(ln,'srgbClr'),c='#'+(A(clr)||'000000');
          node=el('span','tgd-line');if(cy===0||cy<cx/200){node.style.cssText=`display:block;width:${cx/9525}px;border-top:${w}px solid ${c};height:0`}else{node.style.cssText=`display:block;height:${cy/9525}px;border-left:${w}px solid ${c};width:0`}
        }
      }
      if(!node)return;
      if(abs){node.style.position='absolute';node.style.left=abs.x+'px';node.style.top=abs.y+'px';host.style.position='relative';node.style.pointerEvents='none'}
      host.append(node);
    }else{
      const im=firstByLocal(n,'imagedata');if(!im)return;const url=await this._img(attr(im,'id'),ctx);if(!url)return;
      const shp=firstByLocal(n,'shape'),sty=A(shp,'style')||'',gv=k=>{const m=new RegExp(k+':\\s*([\\d.]+)(pt|px|in)?').exec(sty);if(!m)return 0;return +m[1]*({pt:96/72,px:1,in:96}[m[2]||'px'])};
      const img=document.createElement('img');img.src=url;img.alt='Gambar dokumen';const w=gv('width'),h=gv('height');if(w){img.style.width=w+'px';if(h)img.style.aspectRatio=`${w}/${h}`}host.append(img);
    }
  }
  async _img(rid,ctx){
    const path=ctx.rels[rid];if(!path||!this.zip.has(path))return null;
    if(this.imgCache.has(path))return this.imgCache.get(path);
    const ext=(path.split('.').pop()||'').toLowerCase(),url=await this.zip.blobUrl(path,MIME[ext]||'application/octet-stream');this.urls.push(url);this.imgCache.set(path,url);return url;
  }

  /* ---------- tabel ---------- */
  _tc(theme,hex,tint,shade){const ok=!!hex&&/^[0-9a-f]{6}$/i.test(hex);if(theme){if((tint||shade)&&ok)return hex;const c=this.theme.color(theme);if(c)return(tint||shade)?tone(c,tint,shade):c}return ok?hex:''}
  _color(o){return o?this._tc(o.theme,o.fill,o.tint,o.shade):''}
  async _tbl(tbl,ctx,outerTc){
    const own=parseTblPr(kid(tbl,'tblPr')),ts=this.styles.table(own.style);
    const tp=mergeT(ts.tbl,own);
    const grid=kids(kid(tbl,'tblGrid'),'gridCol').map(c=>num(c,'w')||0);
    const trs=kids(tbl,'tr');
    // peta sel: kolom awal, rentang, penggabungan vertikal
    const info=trs.map(tr=>{let col=num(kid(kid(tr,'trPr'),'gridBefore'))||0;return kids(tr,'tc').map(tc=>{const pr=parseTcPr(kid(tc,'tcPr')),c={tc,pr,col,span:pr.span||1,rs:1};col+=c.span;return c})});
    const ncols=Math.max(grid.length,...info.map(r=>r.reduce((m,c)=>Math.max(m,c.col+c.span),0)),1);
    while(grid.length<ncols)grid.push(grid.length?grid[grid.length-1]:1000);
    info.forEach((row,ri)=>row.forEach(c=>{if(c.pr.vm==='restart'){for(let k=ri+1;k<info.length;k++){const nx=info[k].find(x=>x.col===c.col&&x.pr.vm==='cont');if(!nx)break;nx.skip=true;c.rs++}}}));
    const total=grid.reduce((a,b)=>a+b,0),tw=total*PX;
    const table=document.createElement('table');table.className='tgd-tbl';
    const cg=document.createElement('colgroup');for(const g of grid){const c=document.createElement('col');c.style.width=(g/total*100).toFixed(3)+'%';cg.append(c)}table.append(cg);
    table.style.width=(tp.w?.type==='pct'?(tp.w.w/50)+'%':tw.toFixed(2)+'px');
    const defMar={top:0,left:108,bottom:0,right:108,...(ts.tbl.mar||{}),...(own.mar||{})};
    const lookv=tp.look||{fr:false,lr:false,fc:false,lc:false,nh:true,nv:true};
    const ind=(tp.ind||0)*PX,cm=this.compat>=15?0:defMar.left*PX;
    if(tp.jc==='center'){table.style.marginLeft='auto';table.style.marginRight='auto'}else if(tp.jc==='right'||tp.jc==='end'){table.style.marginLeft='auto'}else table.style.marginLeft=(ind-cm).toFixed(2)+'px';
    const tb=document.createElement('tbody');table.append(tb);
    const nrows=trs.length;let g=0,until=0,hdrLead=true;
    for(let ri=0;ri<nrows;ri++){
      const tr=trs[ri],row=document.createElement('tr'),trp=kid(tr,'trPr');
      const th=kid(trp,'trHeight');if(th){const hv=num(th,'val')||0;row.style.height=(hv*PX).toFixed(2)+'px'}
      const isH=!!kid(trp,'tblHeader')&&flag(kid(trp,'tblHeader'))!==false;
      if(isH&&hdrLead)row.dataset.h='1';else hdrLead=false;
      let maxRs=1;
      for(const c of info[ri]){
        if(c.skip)continue;maxRs=Math.max(maxRs,c.rs);
        const td=document.createElement('td');if(c.span>1)td.colSpan=c.span;if(c.rs>1)td.rowSpan=c.rs;
        // gaya tabel bersyarat
        const rowIdx=ri,lastR=ri+c.rs-1===nrows-1,lastC=c.col+c.span>=ncols;
        const conds=['wholeTable'];
        if(!lookv.nh){const bi=rowIdx-(lookv.fr?1:0);if(!(lookv.fr&&rowIdx===0)&&!(lookv.lr&&lastR))conds.push(bi%2===0?'band1Horz':'band2Horz')}
        if(!lookv.nv){const bi=c.col-(lookv.fc?1:0);if(!(lookv.fc&&c.col===0)&&!(lookv.lc&&lastC))conds.push(bi%2===0?'band1Vert':'band2Vert')}
        if(lookv.fc&&c.col===0)conds.push('firstCol');if(lookv.lc&&lastC)conds.push('lastCol');
        if(lookv.fr&&rowIdx===0)conds.push('firstRow');if(lookv.lr&&lastR)conds.push('lastRow');
        if(lookv.fr&&rowIdx===0&&lookv.fc&&c.col===0)conds.push('nwCell');if(lookv.fr&&rowIdx===0&&lookv.lc&&lastC)conds.push('neCell');
        let cp={...ts.p},cr={...ts.r},ctc={...ts.tc};
        for(const k of conds){const cd=ts.cond[k];if(!cd)continue;cp=mergeP(cp,cd.p);cr=mergeR(cr,cd.r);ctc=mergeT(ctc,cd.tc)}
        const tcx={p:mergeP(outerTc.p||{},cp),r:mergeR(outerTc.r||{},cr)};
        // batas
        const tbB=tp.borders||{},cb=mergeSides(ctc.borders,c.pr.borders);
        const sides={top:rowIdx===0?tbB.top:tbB.insideH,bottom:lastR?tbB.bottom:tbB.insideH,left:c.col===0?tbB.left:tbB.insideV,right:lastC?tbB.right:tbB.insideV};
        for(const s of ['top','bottom','left','right']){const b=cb[s]||sides[s];td.style['border'+s[0].toUpperCase()+s.slice(1)]=bdrCss(b,this.theme)}
        // bantalan
        const mar={...defMar,...(ctc.mar||{}),...(c.pr.mar||{})};
        const bw=s=>{const m=/^([\d.]+)px/.exec(td.style['border'+s[0].toUpperCase()+s.slice(1)]||'');return m?+m[1]+.4:0};
        td.style.padding=`${(mar.top*PX).toFixed(2)}px ${Math.max(0,mar.right*PX-bw('right')).toFixed(2)}px ${(mar.bottom*PX).toFixed(2)}px ${Math.max(0,mar.left*PX-bw('left')).toFixed(2)}px`;
        const fill=this._color(c.pr.shd||ctc.shd);if(fill){td.style.backgroundColor='#'+fill;td.style.color=lum(fill)>.55?'#000':'#fff'}
        const va=c.pr.va||ctc.va;td.style.verticalAlign=va==='center'?'middle':va==='bottom'?'bottom':'top';
        const cn=(await this._blocks(c.tc,ctx,tcx,false)).filter(n=>!n.dataset?.k);
        if(!cn.length){const q=el('p');q.textContent='\u200b';cn.push(q)}
        td.append(...cn);row.append(td);
      }
      if(ri>until)g++;until=Math.max(until,ri+maxRs-1);row.dataset.g=g;
      tb.append(row);
    }
    return table;
  }

  /* ---------- tata letak: font, tab, header/footer ---------- */
  async _loadFonts(){
    if(!document.fonts?.load)return;
    const jobs=[];for(const f of this.fontsUsed)for(const w of ['400','700'])for(const s of ['normal','italic'])jobs.push(document.fonts.load(`${s} ${w} 16px "${f}"`).catch(()=>{}));
    await Promise.race([Promise.all(jobs),new Promise(r=>setTimeout(r,4000))]);
  }
  _stage(w){const s=el('div','docx-page tgd tgd-stage');Object.assign(s.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-99999px',top:'0',width:w+'px',height:'auto',overflow:'visible',boxShadow:'none'});document.body.append(s);return s}
  _prepareLayout(){
    const bySec=new Map();this.source.forEach((n,i)=>{if(n.dataset?.k)return;const k=this.secOf[i];if(!bySec.has(k))bySec.set(k,[]);bySec.get(k).push(n)});
    this.sections.forEach((sec,si)=>{
      const cw=Math.max(50,sec.page.w-sec.page.l-sec.page.r),stage=this._stage(cw);
      const nodes=bySec.get(si)||[];stage.append(...nodes);this._resolveTabs(stage);nodes.forEach(n=>n.remove());
      for(const kind of ['hdr','ftr'])for(const t in sec[kind]){const v=sec[kind][t];if(v.done)continue;v.done=true;stage.replaceChildren(...v.nodes);this._resolveTabs(stage);v.h=stage.getBoundingClientRect().height;v.nodes.forEach(n=>n.remove())}
      stage.remove();
    });
  }
  _resolveTabs(root){
    const defTab=this.defTab||48;
    for(const p of root.querySelectorAll('p.tgd-hastab')){
      const tabs=[...p.children].filter(c=>c.classList?.contains('tgd-tab'));if(!tabs.length)continue;
      const stops=JSON.parse(p.dataset.tabs||'[]'),left=+p.dataset.left||0,hang=+p.dataset.hang||0;
      for(const t of tabs){t.style.width='0px';t.className='tgd-tab'}
      const cs=getComputedStyle(p),x0=p.getBoundingClientRect().left+(parseFloat(cs.borderLeftWidth)||0)+(parseFloat(cs.paddingLeft)||0)-left;
      for(let k=0;k<tabs.length;k++){
        const t=tabs[k],cur=t.getBoundingClientRect().left-x0;
        let st=stops.find(s=>s.x>cur+.5);
        if(hang>0&&left>cur+.5&&(!st||left<st.x))st={x:left,type:'left',leader:'none'};
        if(!st){const nx=(Math.floor((cur+.5)/defTab)+1)*defTab;st={x:nx,type:'left',leader:'none'}}
        let w=st.x-cur;
        if(st.type==='right'||st.type==='center'||st.type==='decimal'){
          const seg=this._seg(p,t,tabs[k+1]||null,st.type==='decimal');w=st.type==='center'?st.x-cur-seg/2:st.x-cur-seg;
        }
        t.style.width=Math.max(0,w).toFixed(2)+'px';
        if(st.leader&&st.leader!=='none')t.classList.add(st.leader==='dot'||st.leader==='middleDot'?'tgd-ld-dot':st.leader==='hyphen'?'tgd-ld-dash':'tgd-ld-line');
      }
    }
  }
  _seg(p,t,next,decimal){
    const r=document.createRange();r.setStartAfter(t);if(next)r.setEndBefore(next);else r.setEnd(p,p.childNodes.length);
    if(decimal){
      const txt=r.toString(),i=txt.search(/[.,]/);
      if(i>=0){const w=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let acc=0,n;while((n=w.nextNode())){if(!r.intersectsNode(n))continue;const len=n.nodeValue.length;if(acc+len>i){const r2=r.cloneRange();r2.setEnd(n,i-acc);return r2.getBoundingClientRect().width}acc+=len}}
    }
    return r.getBoundingClientRect().width;
  }

  _renderMobile(){
    this.mobile=document.createElement('article');this.mobile.className='docx-document docx-mobile-document tgd';
    for(const n of this.source){if(n.dataset?.k)continue;const c=n.cloneNode(true);if(c.tagName==='TABLE'){const w=el('div','tgd-scroll');w.append(c);this.mobile.append(w)}else this.mobile.append(c)}
    this.shell.replaceChildren(this.mobile)
  }
  _newPage(sec,first){
    const g=sec.page,p=el('article','docx-page tgd');p.style.width=`${g.w}px`;p.style.height=`${g.h}px`;p.style.position='relative';
    const hv=(first&&sec.titlePg&&sec.hdr.first)?sec.hdr.first:sec.hdr.default,fv=(first&&sec.titlePg&&sec.ftr.first)?sec.ftr.first:sec.ftr.default;
    const cw=g.w-g.l-g.r;let top=g.t,bottom=g.h-g.b;
    if(hv&&hv.h>0){const h=el('div','tgd-hf');h.style.cssText=`position:absolute;left:${g.l}px;top:${g.hd}px;width:${cw}px`;h.append(...hv.nodes.map(n=>n.cloneNode(true)));p.append(h);top=Math.max(top,g.hd+hv.h)}
    if(fv&&fv.h>0){const f=el('div','tgd-hf');f.style.cssText=`position:absolute;left:${g.l}px;bottom:${g.fd}px;width:${cw}px`;f.append(...fv.nodes.map(n=>n.cloneNode(true)));p.append(f);bottom=Math.min(bottom,g.h-g.fd-fv.h)}
    const body=el('div','tgd-body');body.style.cssText=`position:absolute;left:${g.l}px;top:${top}px;width:${cw}px;padding-right:${Math.max(0,g.r)}px;height:${Math.max(40,bottom-top)}px;overflow:hidden`;p.append(body);
    return{page:p,body};
  }
  _buildPrintPages(){
    const host=document.createElement('div');Object.assign(host.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',left:'-99999px',top:'0'});document.body.append(host);
    const pages=[];let cur=null,curSec=-1,secPages=0,brk=true;
    const newPage=si=>{const sec=this.sections[si];secPages=si===curSec?secPages+1:0;curSec=si;cur=this._newPage(sec,secPages===0);cur.page.dataset.si=si;host.append(cur.page);pages.push(cur.page);brk=false};
    const over=()=>cur.body.scrollHeight>cur.body.clientHeight+1;
    const place=(src,si)=>{
      const node=src.cloneNode(true);cur.body.append(node);if(!over())return;
      if(node.tagName==='TABLE'){this._splitTable(node,si,newPage,()=>cur,over);return}
      if(cur.body.children.length>1){node.remove();newPage(si);cur.body.append(node)}
    };
    this.source.forEach((src,i)=>{
      const si=this.secOf[i],k=src.dataset?.k;
      if(k==='pb'){if(!cur)newPage(si);brk=true;return}
      if(k==='sec'){const nx=this.sections[si+1];brk=!(nx&&nx.cont);return}
      const sec=this.sections[si];
      if(!cur||brk||(si!==curSec&&!(sec.cont&&sec.page.w===this.sections[curSec].page.w&&sec.page.h===this.sections[curSec].page.h)))newPage(si);else curSec=si;
      place(src,si);
    });
    if(!pages.length)newPage(0);
    this._numberPages(pages);
    this.printWrap=document.createElement('div');this.printWrap.className='docx-print-wrap';this.printPages=document.createElement('div');this.printPages.className='docx-pages';
    for(const p of pages){p.remove();this.printPages.append(p)}this.printWrap.append(this.printPages);host.remove();this.pages=[...this.printPages.children];
    this.printLayout=document.createElement('div');this.printLayout.className='docx-print-layout';this.printLayout.append(this.printWrap)
  }
  _numberPages(pages){
    const N=pages.length,cnt={};let n=0,last=-1;
    const info=pages.map(p=>{const si=+p.dataset.si||0,sec=this.sections[si]||{};if(si!==last){if(sec.pgStart!==undefined)n=sec.pgStart-1;last=si}n++;cnt[si]=(cnt[si]||0)+1;return{si,n,fmt:sec.pgFmt}});
    pages.forEach((p,i)=>{const x=info[i];for(const f of p.querySelectorAll('.tgd-fld'))f.textContent=f.dataset.f==='PAGE'?pageFmt(x.n,x.fmt):f.dataset.f==='SECTIONPAGES'?String(cnt[x.si]):String(N)});
  }
  _splitTable(node,si,newPage,getCur,over){
    const rows=[...node.tBodies[0].rows],H=[];
    while(rows.length&&rows[0].dataset.h==='1'&&rows.length>1)H.push(rows.shift());
    const G=[];for(const r of rows){const last=G.at(-1);if(last&&last[0].dataset.g===r.dataset.g)last.push(r);else G.push([r])}
    node.remove();
    const shell=()=>{const t=node.cloneNode(false),cg=node.querySelector('colgroup'),tb=document.createElement('tbody');if(cg)t.append(cg.cloneNode(true));t.append(tb);return{t,tb}};
    let part=shell();getCur().body.append(part.t);H.forEach(r=>part.tb.append(r));let n=0;
    for(const g of G){
      g.forEach(r=>part.tb.append(r));
      if(over()){
        if(n>0){g.forEach(r=>r.remove());newPage(si);part=shell();getCur().body.append(part.t);H.forEach(r=>part.tb.append(r.cloneNode(true)));g.forEach(r=>part.tb.append(r));n=0}
        else if(getCur().body.children.length>1){part.t.remove();newPage(si);getCur().body.append(part.t)}
      }
      n++;
    }
  }
  _toolbar(){
    if(!this.subToolbar)return;this.subToolbar.classList.remove('hidden');this.subToolbar.classList.add('docx-subtoolbar');const search=document.createElement('div');search.className='search-box compact-search docx-search-box';search.innerHTML='<input type="search" placeholder="Cari di dokumen…"><button class="mini-btn" data-find>Cari</button><div class="search-results hidden"><span class="search-status"></span><button class="mini-btn" data-prev>↑</button><button class="mini-btn" data-next>↓</button><button class="mini-btn clear-search" data-clear>×</button></div>';this.searchInput=search.querySelector('input');this.searchControls=search.querySelector('.search-results');this.searchStatus=search.querySelector('.search-status');search.querySelector('[data-find]').onclick=()=>this._submitSearch(this.searchInput.value);search.querySelector('[data-prev]').onclick=()=>this._stepSearch(-1);search.querySelector('[data-next]').onclick=()=>this._stepSearch(1);search.querySelector('[data-clear]').onclick=()=>this.clearSearch();this.searchInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this._submitSearch(this.searchInput.value)}};
    const tools=document.createElement('div');tools.className='page-tools docx-page-tools';tools.innerHTML='<button class="mini-btn page-gap-toggle">Gap ON</button><button class="mini-btn" data-fitw>Fit Lebar</button>';this.pageTools=tools;this.gapBtn=tools.querySelector('.page-gap-toggle');this.fitWidthBtn=tools.querySelector('[data-fitw]');this.gapBtn.onclick=()=>{this.pageGap=!this.pageGap;this.printPages?.classList.toggle('no-page-gap',!this.pageGap);this.gapBtn.textContent=`Gap ${this.pageGap?'ON':'OFF'}`};this.fitWidthBtn.onclick=()=>this.fitWidth();this.subToolbar.replaceChildren(search,tools);this._toolbarMode();this._syncFitButtons()
  }
  _makeFloatingNav(){const nav=document.createElement('div');nav.className='floating-position floating-nav hidden';nav.innerHTML='<button data-prev>‹</button><span class="floating-count">1 / 1</span><label>Ke <input inputmode="numeric" type="number" min="1" value="1"></label><button data-go>↵</button><button data-next>›</button>';this.host.append(nav);this.floating=nav;this.floatCount=nav.querySelector('.floating-count');this.floatJump=nav.querySelector('input');nav.querySelector('[data-prev]').onclick=()=>this.goToPage(this.currentPage-1);nav.querySelector('[data-next]').onclick=()=>this.goToPage(this.currentPage+1);nav.querySelector('[data-go]').onclick=()=>this.goToPage(+this.floatJump.value);this.floatJump.onkeydown=e=>{if(e.key==='Enter')this.goToPage(+this.floatJump.value)};this._updatePageControls()}
  _toolbarMode(){if(this.pageTools)this.pageTools.classList.toggle('hidden',this.mode!=='print');if(this.floating)this.floating.classList.toggle('hidden',this.mode!=='print')}
  clearSearch(){for(const m of this.shell.querySelectorAll('mark.tg-search-hit'))m.replaceWith(document.createTextNode(m.textContent));this.searchHits=[];this.searchIndex=-1;this.searchQuery='';if(this.searchStatus)this.searchStatus.textContent='';this.searchControls?.classList.add('hidden');if(this.searchInput)this.searchInput.value=''}
  _submitSearch(q){q=(q||'').trim();if(q&&q===this.searchQuery&&this.searchHits.length){this._stepSearch(1);return}this.search(q)}
  search(q){this.clearSearch();q=(q||'').trim();if(!q)return;this.searchQuery=q;this.searchInput.value=q;const root=this.mode==='print'?this.printPages:this.mobile;if(!root)return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.nodeValue.trim()&&!n.parentElement?.closest('mark')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT}),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);const re=new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi');for(const node of nodes){const text=node.nodeValue;if(!re.test(text)){re.lastIndex=0;continue}re.lastIndex=0;const frag=document.createDocumentFragment();let last=0,m;while((m=re.exec(text))){frag.append(document.createTextNode(text.slice(last,m.index)));const mark=document.createElement('mark');mark.className='tg-search-hit';mark.textContent=m[0];frag.append(mark);last=m.index+m[0].length;if(!m[0].length)re.lastIndex++}frag.append(document.createTextNode(text.slice(last)));node.replaceWith(frag)}this.searchHits=[...root.querySelectorAll('mark.tg-search-hit')];this.searchControls.classList.remove('hidden');if(this.searchHits.length){this.searchIndex=0;this._focusSearch()}else this.searchStatus.textContent='0 hasil'}
  _stepSearch(dir){if(!this.searchHits.length)return;this.searchIndex=(this.searchIndex+dir+this.searchHits.length)%this.searchHits.length;this._focusSearch()}
  _focusSearch(){this.searchHits.forEach((m,i)=>m.classList.toggle('active',i===this.searchIndex));const hit=this.searchHits[this.searchIndex];hit?.scrollIntoView({behavior:'smooth',block:'center'});this.searchStatus.textContent=`${this.searchIndex+1}/${this.searchHits.length}`}
  goToPage(n){if(this.mode!=='print'||!this.pages.length)return;n=clamp(Math.round(n)||1,1,this.pages.length);this.currentPage=n;this.pages[n-1].scrollIntoView({behavior:'smooth',block:'start'});this._setFloating(n)}
  _setFloating(n){this.currentPage=n;if(this.floatCount)this.floatCount.textContent=`${n} / ${this.pages.length}`;if(this.floatJump){this.floatJump.max=this.pages.length;this.floatJump.value=n}}
  _updateCurrentPage(){if(this.mode!=='print'||!this.pages.length)return;const top=this.host.getBoundingClientRect().top+8;let best=0,bestDist=Infinity;this.pages.forEach((p,i)=>{const d=Math.abs(p.getBoundingClientRect().top-top);if(d<bestDist){best=i;bestDist=d}});this._setFloating(best+1)}
  _updatePageControls(){if(this.floatJump){this.floatJump.max=Math.max(1,this.pages.length);this.floatJump.value=1}if(this.floating){this.floatCount.textContent=`1 / ${Math.max(1,this.pages.length)}`;this.floating.classList.toggle('hidden',this.mode!=='print')}}
  setMode(mode){if(mode===this.mode)return;this.clearSearch();this.mode=mode;if(mode==='print'){this.shell.replaceChildren(this.printLayout);this._toolbarMode();requestAnimationFrame(()=>{this.fitWidth();setTimeout(()=>this._updateCurrentPage(),0)});return}this.shell.replaceChildren(this.mobile);this._toolbarMode();this.fitMode='manual';this.zoom=1;this._apply();this._emitZoom();setTimeout(()=>this._updateCurrentPage(),0)}
  _emitZoom(){try{document.dispatchEvent(new CustomEvent('tg-office-zoom',{detail:{zoom:this.zoom}}))}catch{}}
  _syncFitButtons(){this.fitWidthBtn?.classList.toggle('active',this.fitMode==='width')}
  _printViewport(){const w=Math.max(180,this.host.clientWidth-28),h=Math.max(160,this.host.clientHeight-34);return{w,h}}
  fitWidth(){if(this.mode!=='print'){this.fitMode='manual';this.zoom=1;this._apply();this._syncFitButtons();this._emitZoom();return this.zoom}const {w}=this._printViewport();this.fitMode='width';this.zoom=clamp(w/Math.max(1,this.page.w),.2,2.5);this._apply();this._syncFitButtons();this._emitZoom();return this.zoom}
  fitPage(){return this.fitWidth()}
  previewZoom(z){const old=this.zoom,oldMode=this.fitMode;this.zoom=clamp(z,.2,2.5);this.fitMode='manual';this._apply();this.zoom=old;this.fitMode=oldMode}
  setZoom(z){this.fitMode='manual';this.zoom=clamp(z,.2,2.5);this._apply();this._syncFitButtons();return this.zoom}
  _apply(){if(!this.shell)return;this.shell.classList.toggle('mobile',this.mode==='mobile');this.shell.classList.toggle('print',this.mode==='print');if(this.mode==='print'){this.printPages.style.zoom=String(clamp(this.zoom,.2,2.5));this.printPages.classList.toggle('no-page-gap',!this.pageGap)}else if(this.mobile)this.mobile.style.zoom=String(clamp(this.zoom,.2,2.5))}
  getPosition(){return{mode:this.mode,page:this.currentPage,zoom:this.zoom,scrollTop:this.host.scrollTop}}
  async restorePosition(p){if(!p)return;if(p.mode&&p.mode!==this.mode)this.setMode(p.mode);if(p.zoom)this.zoom=clamp(+p.zoom||1,.2,2.5);this._apply();if(this.mode==='print')setTimeout(()=>this.goToPage(+p.page||1),30);else setTimeout(()=>{this.host.scrollTop=+p.scrollTop||0},30)}
  destroy(){this.clearSearch();if(this.scrollHandler)this.host.removeEventListener('scroll',this.scrollHandler);for(const u of this.urls)URL.revokeObjectURL(u);this.urls=[];this.imgCache.clear();if(this.subToolbar){this.subToolbar.classList.remove('docx-subtoolbar');this.subToolbar.classList.add('hidden');this.subToolbar.replaceChildren()}}
}

Object.assign(exports,{DocxViewer});

});
__define('js/viewers/xlsx.js',function(module,exports,require){
const {openZip}=require('js/zip-reader.js');
const {xml,attr,resolvePath,cellToRC,colName,clamp,allByLocal}=require('js/utils.js');
class XlsxViewer{
  constructor(host,subToolbar=null){this.host=host;this.subToolbar=subToolbar;this.zoom=1;this.book=null;this.shell=null;this.paper=null;this.active=0;this.searchHits=[];this.searchIndex=-1;this.searchQuery='';this.fitMode='manual'}
  async open(file){
    const zip=await openZip(await file.arrayBuffer());if(!zip.has('xl/workbook.xml'))throw new Error('Struktur XLSX tidak dikenali.');
    const wb=xml(await zip.text('xl/workbook.xml')),rels=await this._rels(zip),shared=await this._shared(zip),sheets=[];for(const s of allByLocal(wb,'sheet')){const rid=attr(s,'id'),target=rels[rid];if(target&&zip.has(target))sheets.push({name:attr(s,'name','Sheet'),path:target,data:await this._sheet(zip,target,shared)})}
    this.book={sheets};this.shell=document.createElement('div');this.shell.className='xlsx-shell';const tabs=document.createElement('div');tabs.className='sheet-tabs';sheets.forEach((s,i)=>{const b=document.createElement('button');b.className='sheet-tab'+(i===0?' active':'');b.textContent=s.name;b.onclick=()=>this._show(i);tabs.append(b)});this.frame=document.createElement('div');this.frame.className='sheet-frame';this.info=document.createElement('div');this.info.className='sheet-info';this.shell.append(tabs,this.frame,this.info);this.host.replaceChildren(this.shell);this._toolbar();this._show(0);return {engine:'Local OOXML',detail:`${sheets.length} sheet`};
  }
  async _rels(zip){const out={},p='xl/_rels/workbook.xml.rels';if(!zip.has(p))return out;const d=xml(await zip.text(p));for(const r of [...d.documentElement.children])out[attr(r,'Id')]=resolvePath('xl/workbook.xml',attr(r,'Target'));return out}
  async _shared(zip){const p='xl/sharedStrings.xml';if(!zip.has(p))return[];const d=xml(await zip.text(p));return allByLocal(d,'si').map(si=>allByLocal(si,'t').map(t=>t.textContent||'').join(''))}
  async _sheet(zip,path,shared){const d=xml(await zip.text(path)),cells=new Map(),merges=[];let maxR=0,maxC=0;for(const c of allByLocal(d,'c')){const rc=cellToRC(attr(c,'r'));if(!rc)continue;maxR=Math.max(maxR,rc.r);maxC=Math.max(maxC,rc.c);const t=attr(c,'t'),v=allByLocal(c,'v')[0]?.textContent??'',f=allByLocal(c,'f')[0]?.textContent||'';let val=v;if(t==='s')val=shared[+v]??v;else if(t==='inlineStr')val=allByLocal(c,'t').map(x=>x.textContent||'').join('');else if(t==='b')val=v==='1'?'TRUE':'FALSE';if(f&&!val)val=`=${f}`;cells.set(`${rc.r},${rc.c}`,{val,formula:f})}for(const m of allByLocal(d,'mergeCell')){const [a,b]=(attr(m,'ref')||'').split(':').map(cellToRC);if(a&&b){merges.push({a,b});maxR=Math.max(maxR,b.r);maxC=Math.max(maxC,b.c)}}return{cells,merges,maxR,maxC}}
  _show(i){this.active=i;[...this.shell.querySelectorAll('.sheet-tab')].forEach((x,n)=>x.classList.toggle('active',n===i));const s=this.book.sheets[i],d=s.data,maxR=Math.min(d.maxR,299),maxC=Math.min(d.maxC,99),skip=new Set(),starts=new Map();for(const m of d.merges){starts.set(`${m.a.r},${m.a.c}`,m);for(let r=m.a.r;r<=m.b.r;r++)for(let c=m.a.c;c<=m.b.c;c++)if(r!==m.a.r||c!==m.a.c)skip.add(`${r},${c}`)}const paper=document.createElement('div');paper.className='sheet-paper';const table=document.createElement('table');table.className='sheet-grid';const head=document.createElement('thead'),hr=document.createElement('tr'),corner=document.createElement('th');corner.className='row-head';hr.append(corner);for(let c=0;c<=maxC;c++){const th=document.createElement('th');th.textContent=colName(c);hr.append(th)}head.append(hr);table.append(head);const body=document.createElement('tbody');for(let r=0;r<=maxR;r++){const tr=document.createElement('tr'),rh=document.createElement('th');rh.className='row-head';rh.textContent=String(r+1);tr.append(rh);for(let c=0;c<=maxC;c++){const key=`${r},${c}`;if(skip.has(key))continue;const td=document.createElement('td'),data=d.cells.get(key),m=starts.get(key);td.dataset.cell=`${colName(c)}${r+1}`;td.dataset.search=String(data?.val??'');if(m){td.rowSpan=m.b.r-m.a.r+1;td.colSpan=m.b.c-m.a.c+1}if(data){td.textContent=data.val;td.title=data.formula?`=${data.formula}`:String(data.val);if(data.formula)td.classList.add('formula')}td.onclick=()=>{this.info.textContent=`${colName(c)}${r+1}  ${data?.formula?'='+data.formula+'  →  ':''}${data?.val??''}`};tr.append(td)}body.append(tr)}table.append(body);paper.append(table);this.frame.replaceChildren(paper);this.paper=paper;this.info.textContent=`${s.name} · ${d.maxR+1} baris × ${d.maxC+1} kolom${d.maxR>299||d.maxC>99?' · preview dibatasi 300×100 pada V0.32':''}`;this._apply();if(this.searchQuery)this.search(this.searchQuery)}
  _toolbar(){if(!this.subToolbar)return;this.subToolbar.classList.remove('hidden');this.subToolbar.classList.add('xlsx-subtoolbar');const box=document.createElement('div');box.className='search-box compact-search xlsx-search-box';box.innerHTML='<input type="search" placeholder="Cari di sheet aktif…"><button class="mini-btn" data-act="find">Cari</button><div class="search-results hidden"><span class="search-status"></span><button class="mini-btn search-nav-btn" data-act="prev" title="Hasil sebelumnya">↑</button><button class="mini-btn search-nav-btn" data-act="next" title="Hasil berikutnya">↓</button></div>';this.searchInput=box.querySelector('input');this.searchControls=box.querySelector('.search-results');box.querySelector('[data-act=find]').onclick=()=>this._submitSearch(this.searchInput.value);box.querySelector('[data-act=prev]').onclick=()=>this._stepSearch(-1);box.querySelector('[data-act=next]').onclick=()=>this._stepSearch(1);this.searchInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this._submitSearch(this.searchInput.value)}};this.searchInput.addEventListener('search',()=>{if(!this.searchInput.value)this.clearSearch()});this.searchStatus=box.querySelector('.search-status');const fit=document.createElement('button');fit.className='mini-btn xlsx-fit-btn';fit.textContent='Fit Lebar';fit.onclick=()=>this.fitWidth();this.subToolbar.replaceChildren(box,fit)}
  _submitSearch(q){q=(q||'').trim();if(q&&q===this.searchQuery&&this.searchHits.length){this._stepSearch(1);return}this.search(q)}
  clearSearch(){for(const x of this.frame.querySelectorAll('.sheet-search-hit,.sheet-search-active'))x.classList.remove('sheet-search-hit','sheet-search-active');this.searchHits=[];this.searchIndex=-1;this.searchQuery='';if(this.searchInput)this.searchInput.value='';if(this.searchStatus)this.searchStatus.textContent='';this.searchControls?.classList.add('hidden')}
  search(q){this.clearSearch();this.searchQuery=(q||'').trim();if(!this.searchQuery)return;if(this.searchInput)this.searchInput.value=this.searchQuery;const s=this.searchQuery.toLowerCase();this.searchHits=[...this.frame.querySelectorAll('td')].filter(td=>(td.dataset.search||'').toLowerCase().includes(s));this.searchHits.forEach(td=>td.classList.add('sheet-search-hit'));this.searchControls?.classList.remove('hidden');if(this.searchHits.length){this.searchIndex=0;this._focusSearch()}else if(this.searchStatus)this.searchStatus.textContent='0 hasil'}
  _stepSearch(dir){if(!this.searchHits.length)return;this.searchIndex=(this.searchIndex+dir+this.searchHits.length)%this.searchHits.length;this._focusSearch()}
  _focusSearch(){this.searchHits.forEach((x,i)=>x.classList.toggle('sheet-search-active',i===this.searchIndex));const td=this.searchHits[this.searchIndex];td?.scrollIntoView({behavior:'smooth',block:'center',inline:'center'});if(this.searchStatus)this.searchStatus.textContent=`${this.searchIndex+1}/${this.searchHits.length} · ${td?.dataset.cell||''}`}
  setMode(){}
  _emitZoom(){try{document.dispatchEvent(new CustomEvent('tg-office-zoom',{detail:{zoom:this.zoom}}))}catch{}}
  fitWidth(){
    if(!this.paper||!this.frame)return this.zoom;const table=this.paper.querySelector('table');if(!table)return this.zoom;
    const current=Math.max(.05,parseFloat(this.paper.style.zoom)||this.zoom||1),rect=table.getBoundingClientRect(),raw=Math.max(1,rect.width/current),avail=Math.max(120,this.frame.clientWidth-18);
    this.fitMode='width';this.zoom=clamp(avail/raw,.12,2.4);this._apply();this._emitZoom();this.frame.scrollLeft=0;return this.zoom
  }
  previewZoom(z){if(this.paper)this.paper.style.zoom=String(clamp(z,.12,2.4))}
  setZoom(z){this.fitMode='manual';this.zoom=clamp(z,.12,2.4);this._apply();return this.zoom}
  _apply(){if(!this.paper)return;this.paper.style.zoom=String(clamp(this.zoom,.12,2.4))}
  getPosition(){return{sheet:this.active,zoom:this.zoom,scrollTop:this.frame?.scrollTop||0,scrollLeft:this.frame?.scrollLeft||0}}
  async restorePosition(p){if(!p)return;if(Number.isFinite(+p.sheet))this._show(clamp(+p.sheet,0,this.book.sheets.length-1));if(p.zoom)this.zoom=clamp(+p.zoom||1,.12,2.4);this._apply();setTimeout(()=>{if(this.frame){this.frame.scrollTop=+p.scrollTop||0;this.frame.scrollLeft=+p.scrollLeft||0}},20)}
  destroy(){this.clearSearch?.();if(this.subToolbar){this.subToolbar.classList.remove('xlsx-subtoolbar');this.subToolbar.classList.add('hidden');this.subToolbar.replaceChildren()}}
}

Object.assign(exports,{XlsxViewer});

});
__define('js/viewers/pptx.js',function(module,exports,require){
const {openZip}=require('js/zip-reader.js');
const {xml,attr,resolvePath,allByLocal,firstByLocal,colorFromFill,clamp}=require('js/utils.js');
const EMU=914400;const mime=p=>({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',svg:'image/svg+xml',webp:'image/webp'}[(p.split('.').pop()||'').toLowerCase()]||'application/octet-stream');
class PptxViewer{
  constructor(host,subToolbar=null){this.host=host;this.subToolbar=subToolbar;this.zoom=1;this.urls=[];this.slides=[];this.index=0;this.slideSize={cx:12192000,cy:6858000};this.touchStart=null;this.presenting=false;this.slideCount=0;this.thumbHandles=new Map();this.thumbClock=0;this.slideTexts=null;this.searchResults=[];this.searchIndex=-1;this.searchQuery='';this.searchHighlightTimer=null;this.searchOverlay=null;this.view='slide';this.scrollHandles=new Map()}
  async open(file){
    this.buffer=await file.arrayBuffer();this._buildShell();
    try{
      {
        const mod=await Promise.race([import(new URL('vendor/pptx-renderer/aiden0z-pptx-renderer.browser.es.js',document.baseURI).href),new Promise((_,rej)=>setTimeout(()=>rej(new Error('Enhanced renderer timeout')),9000))]);
        if(mod?.PptxViewer){
          this.rendererMod=mod;this.main.classList.add('pptx-enhanced-main');
          this.liveStage=document.createElement('div');this.liveStage.className='pptx-live-stage';this.main.replaceChildren(this.liveStage);
          this.onlineViewer=await mod.PptxViewer.open(this.buffer,this.liveStage,{renderMode:'slide',fitMode:'contain',zipLimits:mod.RECOMMENDED_ZIP_LIMITS,lazySlides:true,lazyMedia:true,pdfjs:false,onSlideChange:(i)=>{if(this.presenting)return;this.index=clamp(Number(i)||0,0,Math.max(0,this.slideCount-1));this._updateNav();this._scheduleSearchHighlight()}});
          this.isEnhanced=true;this.slideCount=this.onlineViewer.slideCount||1;this.index=this.onlineViewer.currentSlideIndex||0;this.viewerResize=()=>requestAnimationFrame(()=>this._fitViewerStage());window.addEventListener('resize',this.viewerResize);window.addEventListener('orientationchange',this.viewerResize);this._fitViewerStage();this._buildEnhancedThumbs();this._toolbar();this._makeFloatingNav();this._bindSwipe(this.main);this._updateNav();return{engine:'Enhanced',detail:`${this.slideCount} slide`}
        }
      }
    }catch(e){console.warn('Enhanced PPTX unavailable, using local fallback',e);this.onlineViewer?.destroy?.();this.onlineViewer=null;this.main.classList.remove('pptx-enhanced-main');this.main.replaceChildren()}
    await this._loadLocal();this.isEnhanced=false;this.slideCount=this.slides.length;this.main.classList.add('local-ppt-main');this._buildLocalThumbs();this._toolbar();this._makeFloatingNav();this._bindSwipe(this.main);await this.go(0);return{engine:'Local OOXML',detail:`${this.slides.length} slide`}
  }
  _buildShell(){this.shell=document.createElement('div');this.shell.className='pptx-shell';this.thumbs=document.createElement('aside');this.thumbs.className='pptx-thumbs';this.main=document.createElement('main');this.main.className='pptx-main';this.shell.append(this.thumbs,this.main);this.host.replaceChildren(this.shell)}
  async _loadLocal(){if(this.localReady)return;const zip=this.zip=await openZip(this.buffer),pres=xml(await zip.text('ppt/presentation.xml')),rels=await this._rels(zip,'ppt/presentation.xml','ppt/_rels/presentation.xml.rels');const size=allByLocal(pres,'sldSz')[0];if(size)this.slideSize={cx:+attr(size,'cx')||12192000,cy:+attr(size,'cy')||6858000};const list=[];for(const id of allByLocal(pres,'sldId')){const rid=[...(id.attributes||[])].find(a=>a.name.includes(':')&&a.localName==='id')?.value||attr(id,'id'),path=rels[rid];if(path&&zip.has(path))list.push(path)}if(!list.length)for(const p of zip.list('ppt/slides/slide').filter(x=>x.endsWith('.xml')).sort())list.push(p);for(const path of list)this.slides.push(await this._slide(zip,path));this.localReady=true;this.slideCount=this.slides.length}
  async _rels(zip,base,path){const out={};if(!zip.has(path))return out;const d=xml(await zip.text(path));for(const r of [...d.documentElement.children])out[attr(r,'Id')]=resolvePath(base,attr(r,'Target'));return out}
  async _slide(zip,path){const d=xml(await zip.text(path)),rels=await this._rels(zip,path,path.replace('/slides/','/slides/_rels/')+'.rels'),items=[],spTree=allByLocal(d,'spTree')[0];if(spTree)for(const n of [...spTree.children]){if(n.localName==='sp')items.push(await this._shape(n));else if(n.localName==='pic')items.push(await this._pic(n,zip,rels));else if(n.localName==='graphicFrame')items.push(await this._graphic(n))}let bg='#ffffff';const bgPr=allByLocal(d,'bgPr')[0];if(bgPr)bg=colorFromFill(bgPr,'#ffffff');return{items,bg}}
  _xfrm(n){const x=allByLocal(n,'xfrm')[0],off=firstByLocal(x,'off'),ext=firstByLocal(x,'ext');return{x:+attr(off,'x')||0,y:+attr(off,'y')||0,cx:+attr(ext,'cx')||1,cy:+attr(ext,'cy')||1}}
  _text(n){const body=allByLocal(n,'txBody')[0];if(!body)return'';return allByLocal(body,'p').map(p=>allByLocal(p,'t').map(t=>t.textContent||'').join('')).join('\n')}
  _shape(n){const pos=this._xfrm(n),text=this._text(n),spPr=allByLocal(n,'spPr')[0],fill=colorFromFill(spPr,'transparent'),ln=allByLocal(spPr,'ln')[0],border=colorFromFill(ln,'transparent'),runs=allByLocal(n,'r'),def=allByLocal(n,'defRPr')[0],rpr=runs.length?allByLocal(runs[0],'rPr')[0]:def,size=+(attr(rpr,'sz')||1800)/100,bold=attr(rpr,'b')==='1',color=(()=>{const sf=allByLocal(rpr,'solidFill')[0],rgb=sf?allByLocal(sf,'srgbClr')[0]:null;return attr(rgb,'val')?`#${attr(rgb,'val')}`:'#111827'})(),p=allByLocal(n,'p')[0],algn=attr(firstByLocal(p,'pPr'),'algn','l');return{type:'shape',pos,text,fill,border,size,bold,color,align:{ctr:'center',r:'right',just:'justify'}[algn]||'left'}}
  async _pic(n,zip,rels){const pos=this._xfrm(n),blip=allByLocal(n,'blip')[0],path=rels[attr(blip,'embed')];let url='';if(path&&zip.has(path)){url=await zip.blobUrl(path,mime(path));this.urls.push(url)}return{type:'pic',pos,url}}
  _graphic(n){const pos=this._xfrm(n),tbl=allByLocal(n,'tbl')[0];if(!tbl)return{type:'shape',pos,text:'[Objek]',fill:'#f3f4f6',border:'#cbd5e1',size:14,bold:false,color:'#64748b',align:'center'};const rows=allByLocal(tbl,'tr').map(tr=>[...tr.children].filter(x=>x.localName==='tc').map(tc=>allByLocal(tc,'t').map(t=>t.textContent||'').join('')));return{type:'table',pos,rows}}
  _buildLocalThumbs(){this.thumbs.replaceChildren();this.slides.forEach((s,i)=>{const t=document.createElement('button');t.type='button';t.className='pptx-thumb'+(i===0?' active':'');const viewport=document.createElement('div');viewport.className='pptx-thumb-viewport';const mini=this._renderSlide(s,true);mini.classList.add('pptx-thumb-slide');viewport.append(mini);const label=document.createElement('span');label.textContent=i+1;t.append(viewport,label);t.onclick=()=>this.go(i);this.thumbs.append(t)})}
  _buildEnhancedThumbs(){
    this.thumbs.replaceChildren();for(let i=0;i<this.slideCount;i++){const t=document.createElement('button');t.type='button';t.className='pptx-thumb'+(i===this.index?' active':'');t.dataset.slide=i;const viewport=document.createElement('div');viewport.className='pptx-thumb-viewport enhanced-thumb-host';viewport.innerHTML='<div class="pptx-thumb-loading">…</div>';const label=document.createElement('span');label.textContent=i+1;t.append(viewport,label);t.onclick=()=>this.go(i);this.thumbs.append(t)}
    if('IntersectionObserver'in window){this.thumbObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)this._ensureEnhancedThumb(+e.target.dataset.slide)},{root:this.thumbs,rootMargin:'180px',threshold:.01});[...this.thumbs.children].forEach(t=>this.thumbObserver.observe(t))}else for(let i=0;i<Math.min(this.slideCount,8);i++)this._ensureEnhancedThumb(i);
    this.thumbResizeHandler=()=>requestAnimationFrame(()=>this._fitAllEnhancedThumbs());window.addEventListener('resize',this.thumbResizeHandler)
  }
  async _ensureEnhancedThumb(index){
    if(!this.isEnhanced||!this.onlineViewer||this.thumbHandles.has(index))return;const btn=this.thumbs.children[index],host=btn?.querySelector('.pptx-thumb-viewport');if(!host)return;host.replaceChildren();
    const sw=this.onlineViewer.slideWidth||1280,sh=this.onlineViewer.slideHeight||720,stage=document.createElement('div');stage.className='pptx-real-thumb-stage';stage.style.width=`${sw}px`;stage.style.height=`${sh}px`;host.append(stage);
    try{const handle=this.onlineViewer.renderSlideToContainer(index,stage);const rec={handle,used:++this.thumbClock,stage,host,sw,sh};this.thumbHandles.set(index,rec);await handle?.ready;this._fitEnhancedThumb(rec);this._trimThumbHandles()}catch(e){console.warn('PPT thumbnail failed',index,e);this.thumbHandles.delete(index);host.textContent=String(index+1)}
  }
  _fitEnhancedThumb(rec){if(!rec?.host?.isConnected||!rec?.stage)return;const rect=rec.host.getBoundingClientRect(),scale=Math.max(.02,Math.min(rect.width/rec.sw,rect.height/rec.sh)),rw=rec.sw*scale,rh=rec.sh*scale;rec.stage.style.transform=`scale(${scale})`;rec.stage.style.left=`${Math.max(0,(rect.width-rw)/2)}px`;rec.stage.style.top=`${Math.max(0,(rect.height-rh)/2)}px`}
  _fitAllEnhancedThumbs(){for(const rec of this.thumbHandles.values())this._fitEnhancedThumb(rec)}
  _trimThumbHandles(){if(this.thumbHandles.size<=14)return;const active=this.index;const list=[...this.thumbHandles.entries()].filter(([i])=>i!==active).sort((a,b)=>a[1].used-b[1].used);while(this.thumbHandles.size>14&&list.length){const [i,x]=list.shift();try{x.handle?.dispose?.()}catch{}this.thumbHandles.delete(i);const host=this.thumbs.children[i]?.querySelector('.pptx-thumb-viewport');if(host)host.innerHTML='<div class="pptx-thumb-loading">…</div>'}}
  _renderSlide(slide,thumb=false){const w=this.slideSize.cx/EMU*96,h=this.slideSize.cy/EMU*96,wrap=document.createElement('div');wrap.className='pptx-slide-wrap';wrap.style.width=`${w}px`;wrap.style.height=`${h}px`;wrap.style.background=slide.bg;for(const it of slide.items){const el=document.createElement('div');el.className='pptx-shape';el.style.left=`${it.pos.x/this.slideSize.cx*100}%`;el.style.top=`${it.pos.y/this.slideSize.cy*100}%`;el.style.width=`${it.pos.cx/this.slideSize.cx*100}%`;el.style.height=`${it.pos.cy/this.slideSize.cy*100}%`;if(it.type==='pic'){if(it.url){const img=document.createElement('img');img.src=it.url;el.append(img)}}else if(it.type==='table'){const tb=document.createElement('table');tb.className='pptx-table';for(const r of it.rows){const tr=document.createElement('tr');for(const v of r){const td=document.createElement('td');td.textContent=v;tr.append(td)}tb.append(tr)}el.append(tb)}else{el.classList.add('pptx-shape-text');el.textContent=it.text;el.style.background=it.fill;el.style.border=it.border!=='transparent'?`1px solid ${it.border}`:'none';el.style.fontSize=`${it.size}px`;el.style.fontWeight=it.bold?'700':'400';el.style.color=it.color;el.style.textAlign=it.align;el.style.padding=thumb?'2px':'4px'}wrap.append(el)}return wrap}
  async _ensureSearchTexts(){
    if(this.slideTexts?.length===this.slideCount)return this.slideTexts;if(this.localReady&&this.slides.length){this.slideTexts=this.slides.map(slide=>slide.items.map(it=>it.type==='table'?it.rows.flat().join(' '):(it.text||'')).join(' '));return this.slideTexts}
    const zip=await openZip(this.buffer),pres=xml(await zip.text('ppt/presentation.xml')),rels=await this._rels(zip,'ppt/presentation.xml','ppt/_rels/presentation.xml.rels'),paths=[];for(const id of allByLocal(pres,'sldId')){const rid=[...(id.attributes||[])].find(a=>a.name.includes(':')&&a.localName==='id')?.value||attr(id,'id'),path=rels[rid];if(path&&zip.has(path))paths.push(path)}if(!paths.length)for(const path of zip.list('ppt/slides/slide').filter(x=>x.endsWith('.xml')).sort())paths.push(path);this.slideTexts=[];for(const path of paths){const d=xml(await zip.text(path));this.slideTexts.push(allByLocal(d,'t').map(t=>t.textContent||'').join(' '))}while(this.slideTexts.length<this.slideCount)this.slideTexts.push('');return this.slideTexts
  }
  _clearSlideHighlight(){clearTimeout(this.searchHighlightTimer);this.searchHighlightTimer=null;this.searchOverlay?.remove();this.searchOverlay=null}
  _scheduleSearchHighlight(){this._clearSlideHighlight();if(!this.searchQuery||this.presenting)return;this.searchHighlightTimer=setTimeout(()=>this._highlightSearchOnActiveSlide(),110)}
  _highlightSearchOnActiveSlide(){
    this._clearSlideHighlight();const q=(this.searchQuery||'').trim().toLocaleLowerCase('id-ID');if(!q||!this.main)return;
    const root=this.main,rootRect=root.getBoundingClientRect(),overlay=document.createElement('div');overlay.className='ppt-search-overlay';const nodes=[...root.querySelectorAll('*')],hits=[];
    for(const el of nodes){
      if(el===overlay||el.closest('.ppt-search-overlay'))continue;const text=(el.textContent||'').trim();if(!text||!text.toLocaleLowerCase('id-ID').includes(q))continue;
      let childHas=false;for(const ch of el.children||[]){if((ch.textContent||'').toLocaleLowerCase('id-ID').includes(q)){childHas=true;break}}if(childHas)continue;
      const r=el.getBoundingClientRect();if(r.width<2||r.height<2||r.width>rootRect.width*.92||r.height>rootRect.height*.75)continue;hits.push(r)
    }
    for(const r of hits.slice(0,24)){const box=document.createElement('span');box.className='ppt-search-highlight';box.style.left=`${r.left-rootRect.left+root.scrollLeft}px`;box.style.top=`${r.top-rootRect.top+root.scrollTop}px`;box.style.width=`${r.width}px`;box.style.height=`${r.height}px`;overlay.append(box)}
    if(overlay.childNodes.length){root.append(overlay);this.searchOverlay=overlay}
  }
  _resetSearchVisual(){this._clearSlideHighlight();if(this.thumbs)for(const t of this.thumbs.children)t.classList.remove('search-match');this.searchResults=[];this.searchIndex=-1;if(this.searchStatus)this.searchStatus.textContent='';this.searchControls?.classList.add('hidden')}
  clearSearch(){this.searchQuery='';this._resetSearchVisual();if(this.searchInput)this.searchInput.value=''}
  async _submitSearch(q){q=(q||'').trim();if(q&&q===this.searchQuery&&this.searchResults.length){await this._stepSearch(1);return}await this.search(q)}
  async search(q){q=(q||'').trim();this._resetSearchVisual();if(!q){this.searchQuery='';return}this.searchQuery=q;if(this.searchInput)this.searchInput.value=q;this.searchControls?.classList.remove('hidden');if(this.searchStatus)this.searchStatus.textContent='Mencari…';try{const texts=await this._ensureSearchTexts(),needle=q.toLocaleLowerCase('id-ID');this.searchResults=texts.map((text,i)=>({slide:i,text})).filter(x=>(x.text||'').toLocaleLowerCase('id-ID').includes(needle)).map(x=>x.slide);for(const i of this.searchResults)this.thumbs?.children[i]?.classList.add('search-match');if(!this.searchResults.length){this.searchStatus.textContent='0 hasil';return}this.searchIndex=0;await this._focusSearch()}catch(e){console.warn('PPT search index failed',e);if(this.searchStatus)this.searchStatus.textContent='Cari gagal'}}
  async _stepSearch(dir){if(!this.searchResults.length)return;this.searchIndex=(this.searchIndex+dir+this.searchResults.length)%this.searchResults.length;await this._focusSearch()}
  async _focusSearch(){const slide=this.searchResults[this.searchIndex];if(!Number.isFinite(slide))return;await this.go(slide);if(this.searchStatus)this.searchStatus.textContent=`${this.searchIndex+1}/${this.searchResults.length} · S${slide+1}`;this._scheduleSearchHighlight()}
  async go(i){
    const next=clamp(Math.round(i)||0,0,Math.max(0,(this.slideCount||1)-1));if(this.presenting){this.index=next;await this._renderPresentationSlide();return}this.index=next;if(this.view==='scroll'){const item=this.scrollBox?.children[next];if(item){this.scrollLock=true;item.scrollIntoView({block:'start'});setTimeout(()=>{this.scrollLock=false},120)}this._updateNav();return}
    if(this.isEnhanced){try{await this.onlineViewer.goToSlide(next,{behavior:'instant'});this.index=clamp(this.onlineViewer.currentSlideIndex??next,0,this.slideCount-1)}catch(e){console.warn('PPT goToSlide failed',next,e);this.index=next}this._updateNav();this._scheduleSearchHighlight();return}
    const wrap=this._renderSlide(this.slides[this.index]);this.main.replaceChildren(wrap);this.current=wrap;this._apply();this._updateNav();this._scheduleSearchHighlight()
  }
  _toolbar(){if(!this.subToolbar)return;this.subToolbar.classList.remove('hidden');this.subToolbar.classList.add('pptx-subtoolbar');const box=document.createElement('div');box.className='search-box compact-search pptx-search-box';box.innerHTML='<input type="search" placeholder="Cari dalam slide…"><button class="mini-btn" data-find>Cari</button><div class="search-results hidden"><span class="search-status"></span><button class="mini-btn search-nav-btn" data-prev title="Hasil sebelumnya">↑</button><button class="mini-btn search-nav-btn" data-next title="Hasil berikutnya">↓</button><button class="mini-btn clear-search" data-clear title="Hapus pencarian">×</button></div>';this.searchInput=box.querySelector('input');this.searchControls=box.querySelector('.search-results');this.searchStatus=box.querySelector('.search-status');box.querySelector('[data-find]').onclick=()=>this._submitSearch(this.searchInput.value);box.querySelector('[data-prev]').onclick=()=>this._stepSearch(-1);box.querySelector('[data-next]').onclick=()=>this._stepSearch(1);box.querySelector('[data-clear]').onclick=()=>this.clearSearch();this.searchInput.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();this._submitSearch(this.searchInput.value)}};const nav=document.createElement('div');nav.className='ppt-toolbar-actions';nav.innerHTML='<button class="mini-btn present-btn" data-play>▶ Presentasi</button>';nav.querySelector('[data-play]').onclick=()=>this.present();this.subToolbar.replaceChildren(box,nav)}
  _makeFloatingNav(){if(this.floating?.isConnected)return;const nav=document.createElement('div');nav.className='floating-position floating-nav';nav.innerHTML='<button data-prev>‹</button><span class="floating-count">1 / 1</span><label>Ke <input inputmode="numeric" type="number" min="1" value="1"></label><button data-go>↵</button><button data-next>›</button>';this.host.append(nav);this.floating=nav;this.floatCount=nav.querySelector('.floating-count');this.floatJump=nav.querySelector('input');nav.querySelector('[data-prev]').onclick=()=>this.go(this.index-1);nav.querySelector('[data-next]').onclick=()=>this.go(this.index+1);nav.querySelector('[data-go]').onclick=()=>this.go(+this.floatJump.value-1);this.floatJump.onkeydown=e=>{if(e.key==='Enter')this.go(+this.floatJump.value-1)};this._updateNav()}
  _updateNav(){const total=Math.max(1,this.slideCount||this.slides.length||1),n=this.index+1;if(this.floatCount)this.floatCount.textContent=`${n} / ${total}`;if(this.floatJump){this.floatJump.max=total;this.floatJump.value=n}if(this.thumbs){[...this.thumbs.children].forEach((x,i)=>x.classList.toggle('active',i===this.index));this.thumbs.children[this.index]?.scrollIntoView?.({block:'nearest',inline:'center'});if(this.isEnhanced)this._ensureEnhancedThumb(this.index)}if(this.presentationCount)this.presentationCount.textContent=`${n} dari ${total}`;if(this.presentationJump){this.presentationJump.max=total;this.presentationJump.value=n}}
  _bindSwipe(target){if(!target||target.dataset.tgSwipe)return;target.dataset.tgSwipe='1';target.addEventListener('touchstart',e=>{if(e.touches?.length!==1)return;const t=e.changedTouches?.[0];if(t)this.touchStart={x:t.clientX,y:t.clientY}},{passive:true});target.addEventListener('touchend',e=>{if(!this.touchStart)return;const t=e.changedTouches?.[0];if(!t)return;const dx=t.clientX-this.touchStart.x,dy=t.clientY-this.touchStart.y;this.touchStart=null;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)*1.2)this.go(this.index+(dx<0?1:-1))},{passive:true})}
  async present(){
    if(this.presenting)return;this.presenting=true;const overlay=document.createElement('div');overlay.className='ppt-present-overlay';overlay.innerHTML='<div class="ppt-present-stage"></div><button type="button" class="ppt-present-nav prev" data-prev aria-label="Slide sebelumnya">‹</button><button type="button" class="ppt-present-nav next" data-next aria-label="Slide berikutnya">›</button><button type="button" class="ppt-present-close" data-close aria-label="Keluar presentasi">✕</button><div class="ppt-present-hud" data-hud><span class="ppt-present-count"></span><label>Ke <input type="number" inputmode="numeric" min="1" value="1" data-jump></label><button type="button" data-go aria-label="Pergi ke slide">↵</button></div>';document.body.append(overlay);this.presentationOverlay=overlay;this.presentStage=overlay.querySelector('.ppt-present-stage');this.presentationHud=overlay.querySelector('[data-hud]');this.presentationCount=overlay.querySelector('.ppt-present-count');this.presentationJump=overlay.querySelector('[data-jump]');overlay.querySelector('[data-prev]').onclick=e=>{e.stopPropagation();this.go(this.index-1)};overlay.querySelector('[data-next]').onclick=e=>{e.stopPropagation();this.go(this.index+1)};overlay.querySelector('[data-close]').onclick=e=>{e.stopPropagation();this.exitPresentation()};overlay.querySelector('[data-go]').onclick=e=>{e.stopPropagation();this.go((+this.presentationJump.value||1)-1);this._showPresentationHud()};this.presentationJump.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();e.stopPropagation();this.go((+this.presentationJump.value||1)-1);this._showPresentationHud()}};overlay.addEventListener('click',e=>{if(e.target.closest('button,input,label'))return;this._togglePresentationHud()});this._bindSwipe(overlay);this.presentationResize=()=>this._fitPresentation();window.addEventListener('resize',this.presentationResize);window.addEventListener('orientationchange',this.presentationResize);this.presentationKey=e=>{if(e.key==='ArrowRight'||e.key==='PageDown')this.go(this.index+1);else if(e.key==='ArrowLeft'||e.key==='PageUp')this.go(this.index-1);else if(e.key==='Escape')this.exitPresentation()};window.addEventListener('keydown',this.presentationKey);await this._renderPresentationSlide();try{await overlay.requestFullscreen?.()}catch{}try{await screen.orientation?.lock?.('landscape')}catch{}setTimeout(()=>this._fitPresentation(),140)
  }
  _showPresentationHud(){if(!this.presentationHud)return;clearTimeout(this.presentationHudTimer);this.presentationHud.classList.add('show');this.presentationHudTimer=setTimeout(()=>this.presentationHud?.classList.remove('show'),3200)}
  _togglePresentationHud(){if(!this.presentationHud)return;if(this.presentationHud.classList.contains('show')){clearTimeout(this.presentationHudTimer);this.presentationHud.classList.remove('show')}else this._showPresentationHud()}
  async _tryLandscape(){try{if(!document.fullscreenElement)await this.presentationOverlay?.requestFullscreen?.();await screen.orientation?.lock?.('landscape')}catch{this.presentationOverlay?.classList.add('landscape-hint');setTimeout(()=>this.presentationOverlay?.classList.remove('landscape-hint'),1800)}setTimeout(()=>this._fitPresentation(),160)}
  async _renderPresentationSlide(){
    if(!this.presenting||!this.presentStage)return;try{this.presentationHandle?.dispose?.()}catch{}this.presentationHandle=null;this.presentStage.replaceChildren();
    const holder=document.createElement('div');holder.className='ppt-present-render-host';this.presentStage.append(holder);this.presentSlide=holder;
    if(this.isEnhanced&&this.onlineViewer){
      const sw=this.onlineViewer.slideWidth||1280,sh=this.onlineViewer.slideHeight||720;holder.style.width=`${sw}px`;holder.style.height=`${sh}px`;
      try{const handle=this.onlineViewer.renderSlideToContainer(this.index,holder);this.presentationHandle=handle;await handle?.ready}catch(e){console.warn('Enhanced presentation slide failed',this.index,e);holder.textContent='Slide gagal dirender'}
    }else{
      const slide=this.slides[this.index];if(slide){const wrap=this._renderSlide(slide);wrap.classList.add('ppt-present-local-slide');holder.style.width=wrap.style.width;holder.style.height=wrap.style.height;holder.append(wrap)}
    }
    this._updateNav();requestAnimationFrame(()=>this._fitPresentation())
  }
  _fitPresentation(){if(!this.presenting||!this.presentStage||!this.presentSlide)return;const sw=parseFloat(this.presentSlide.style.width)||this.onlineViewer?.slideWidth||1280,sh=parseFloat(this.presentSlide.style.height)||this.onlineViewer?.slideHeight||720,rect=this.presentStage.getBoundingClientRect(),reserved=24,scale=Math.max(.05,Math.min((rect.width-24)/sw,(Math.max(120,rect.height-reserved)-24)/sh));this.presentSlide.style.position='relative';this.presentSlide.style.transform=`scale(${scale})`;this.presentSlide.style.transformOrigin='center center'}
  async exitPresentation(){if(!this.presenting)return;this.presenting=false;window.removeEventListener('resize',this.presentationResize);window.removeEventListener('orientationchange',this.presentationResize);window.removeEventListener('keydown',this.presentationKey);this.presentationResize=null;this.presentationKey=null;try{this.presentationHandle?.dispose?.()}catch{}this.presentationHandle=null;this.presentationOverlay?.remove();this.presentationOverlay=null;this.presentStage=null;this.presentSlide=null;this.presentationCount=null;this.presentationJump=null;this.presentationHud=null;clearTimeout(this.presentationHudTimer);try{screen.orientation?.unlock?.()}catch{}if(document.fullscreenElement)try{await document.exitFullscreen?.()}catch{}this._updateNav()}
  _fitViewerStage(){if(!this.isEnhanced||!this.liveStage||!this.main||!this.onlineViewer)return;const sw=this.onlineViewer.slideWidth||1280,sh=this.onlineViewer.slideHeight||720,rect=this.main.getBoundingClientRect(),pad=24,fit=Math.max(.05,Math.min(Math.max(160,rect.width-pad)/sw,Math.max(110,rect.height-pad)/sh)),scale=fit*this.zoom;this.liveStage.style.width=`${Math.max(160,Math.round(sw*scale))}px`;this.liveStage.style.height=`${Math.max(90,Math.round(sh*scale))}px`;this.liveStage.style.aspectRatio=`${sw} / ${sh}`;this.liveStage.style.flex='0 0 auto';this.liveStage.style.position='relative';this.onlineViewer?.setFitMode?.('contain')?.catch?.(()=>{})}
  setMode(){}
  async fitPage(){this.zoom=1;if(this.isEnhanced){this._fitViewerStage();this._scheduleSearchHighlight();return this.zoom}this._apply();return this.zoom}
  previewZoom(z){const old=this.zoom;this.zoom=clamp(z,.35,2.5);if(this.isEnhanced)this._fitViewerStage();else this._apply();this.zoom=old}
  async setZoom(z){this.zoom=clamp(z,.35,2.5);if(this.isEnhanced){this._fitViewerStage();this._scheduleSearchHighlight();return this.zoom}this._apply();this._scheduleSearchHighlight();return this.zoom}
  _apply(){if(!this.current||!this.main)return;const w=parseFloat(this.current.style.width),h=parseFloat(this.current.style.height),fit=Math.min(1,(this.main.clientWidth-36)/w,(this.main.clientHeight-36)/h),scale=fit*this.zoom;this.current.style.transform=`scale(${scale})`;this.current.style.margin='0'}
  getPosition(){return{slide:this.index+1,zoom:1,view:this.view}}
  async restorePosition(p){if(!p)return;this.zoom=1;await this.go((+p.slide||1)-1);if(this.isEnhanced)this._fitViewerStage();if(p.view==='scroll')this.setView('scroll')}
  slidePx(){return this.isEnhanced&&this.onlineViewer?{w:this.onlineViewer.slideWidth||1280,h:this.onlineViewer.slideHeight||720}:{w:this.slideSize.cx/EMU*96,h:this.slideSize.cy/EMU*96}}
  async renderSlideInto(i,stage){const {w,h}=this.slidePx();stage.style.width=`${w}px`;stage.style.height=`${h}px`;if(this.isEnhanced&&this.onlineViewer){const handle=this.onlineViewer.renderSlideToContainer(i,stage);await handle?.ready;return handle}const slide=this.slides[i];if(slide)stage.append(this._renderSlide(slide));return null}
  setView(mode){mode=mode==='scroll'?'scroll':'slide';if(mode===this.view)return;this.view=mode;if(mode==='scroll')this._enterScroll();else this._exitScroll();try{document.dispatchEvent(new CustomEvent('tg-ppt-view',{detail:{view:mode}}))}catch{}}
  _enterScroll(){
    this._exitScroll(true);const box=document.createElement('div');box.className='pptx-scroll';const {w,h}=this.slidePx();
    for(let i=0;i<this.slideCount;i++){const item=document.createElement('div');item.className='pptx-scroll-item';item.dataset.i=i;item.style.aspectRatio=`${w} / ${h}`;item.innerHTML=`<div class="wait">Slide ${i+1}</div><span class="num">${i+1}</span>`;box.append(item)}
    this.main.append(box);this.scrollBox=box;
    if('IntersectionObserver'in window){this.scrollObserver=new IntersectionObserver(es=>{for(const e of es)if(e.isIntersecting)this._renderScrollItem(+e.target.dataset.i)},{root:box,rootMargin:'700px 0px'});[...box.children].forEach(x=>this.scrollObserver.observe(x))}else for(let i=0;i<Math.min(this.slideCount,6);i++)this._renderScrollItem(i);
    this.scrollHandler=()=>{if(this.scrollLock)return;cancelAnimationFrame(this.scrollRaf);this.scrollRaf=requestAnimationFrame(()=>{const top=box.getBoundingClientRect().top+box.clientHeight*.3;let best=0,dist=Infinity;[...box.children].forEach((x,i)=>{const r=x.getBoundingClientRect();const d=r.top<=top&&r.bottom>=top?0:Math.min(Math.abs(r.top-top),Math.abs(r.bottom-top));if(d<dist){dist=d;best=i}});if(best!==this.index){this.index=best;this._updateNav()}})};
    box.addEventListener('scroll',this.scrollHandler,{passive:true});
    this.scrollResize=()=>requestAnimationFrame(()=>{for(const [i,rec] of this.scrollHandles)this._fitScrollItem(i,rec)});window.addEventListener('resize',this.scrollResize);
    const target=box.children[this.index];if(target){this.scrollLock=true;target.scrollIntoView({block:'start'});setTimeout(()=>{this.scrollLock=false},150)}this._updateNav()
  }
  async _renderScrollItem(i){
    if(this.scrollHandles.has(i)||!this.scrollBox)return;const item=this.scrollBox.children[i];if(!item)return;const stage=document.createElement('div');stage.className='stage';const rec={stage,handle:null,used:++this.thumbClock};this.scrollHandles.set(i,rec);item.append(stage);
    try{rec.handle=await this.renderSlideInto(i,stage);item.querySelector('.wait')?.remove();this._fitScrollItem(i,rec)}catch(e){console.warn('PPT scroll render failed',i,e);item.querySelector('.wait')&&(item.querySelector('.wait').textContent='Slide gagal dirender')}
    if(this.scrollHandles.size>16){const far=[...this.scrollHandles.entries()].filter(([n])=>Math.abs(n-this.index)>6).sort((a,b)=>a[1].used-b[1].used);while(this.scrollHandles.size>16&&far.length){const [n,r]=far.shift();try{r.handle?.dispose?.()}catch{}r.stage.remove();this.scrollHandles.delete(n);const it=this.scrollBox.children[n];if(it&&!it.querySelector('.wait')){const wd=document.createElement('div');wd.className='wait';wd.textContent=`Slide ${n+1}`;it.prepend(wd)}}}
  }
  _fitScrollItem(i,rec){const item=this.scrollBox?.children[i];if(!item||!rec?.stage)return;const {w}=this.slidePx();rec.stage.style.transform=`scale(${Math.max(.02,item.clientWidth/w)})`}
  _exitScroll(silent=false){
    if(!this.scrollBox){return}this.scrollObserver?.disconnect?.();this.scrollObserver=null;this.scrollBox.removeEventListener('scroll',this.scrollHandler);if(this.scrollResize)window.removeEventListener('resize',this.scrollResize);for(const r of this.scrollHandles.values())try{r.handle?.dispose?.()}catch{}this.scrollHandles.clear();this.scrollBox.remove();this.scrollBox=null;
    if(!silent){if(this.isEnhanced){this._fitViewerStage();this.go(this.index)}else this.go(this.index)}
  }
  /* Tautan pada bentuk (bukan teks): posisi relatif terhadap ukuran slide */
  /* Catatan pembicara (notesSlide) untuk pengendali Presentasi Nirkabel */
  async notesOf(i){
    this._notes=this._notes||new Map();if(this._notes.has(i))return this._notes.get(i);let text='';
    try{
      await this.shapeLinks(i);const zip=this._lz,path=this._lpaths?.[i];
      if(zip&&path){
        const relPath=path.replace('/slides/','/slides/_rels/')+'.rels';
        if(zip.has(relPath)){
          const rd=xml(await zip.text(relPath));const rel=[...rd.documentElement.children].find(r=>/notesSlide$/.test(attr(r,'Type')||''));
          const np=rel&&resolvePath(path,attr(rel,'Target'));
          if(np&&zip.has(np)){
            const d=xml(await zip.text(np)),parts=[];
            for(const sp of allByLocal(d,'sp')){
              const ph=allByLocal(sp,'ph')[0],tp=ph&&attr(ph,'type');if(tp==='sldNum'||tp==='sldImg'||tp==='hdr'||tp==='ftr'||tp==='dt')continue;
              for(const para of allByLocal(sp,'p')){const t=allByLocal(para,'t').map(x=>x.textContent).join('');if(t.trim())parts.push(t)}
            }
            text=parts.join('\n').trim();
          }
        }
      }
    }catch(e){console.warn('Catatan slide gagal dibaca',e)}
    this._notes.set(i,text);return text;
  }
  async shapeLinks(i){
    this._links=this._links||new Map();if(this._links.has(i))return this._links.get(i);const out=[];
    try{
      const zip=this._lz||(this._lz=await openZip(this.buffer));
      if(!this._lpaths){const pres=xml(await zip.text('ppt/presentation.xml')),rels=await this._rels(zip,'ppt/presentation.xml','ppt/_rels/presentation.xml.rels'),sz=allByLocal(pres,'sldSz')[0];this._lsize={cx:+attr(sz,'cx')||12192000,cy:+attr(sz,'cy')||6858000};const paths=[];for(const id of allByLocal(pres,'sldId')){const rid=[...(id.attributes||[])].find(a=>a.name.includes(':')&&a.localName==='id')?.value||attr(id,'id'),pt=rels[rid];if(pt&&zip.has(pt))paths.push(pt)}this._lpaths=paths}
      const path=this._lpaths[i];
      if(path){
        const relPath=path.replace('/slides/','/slides/_rels/')+'.rels',raw={};
        if(zip.has(relPath)){const rd=xml(await zip.text(relPath));for(const r of [...rd.documentElement.children])if(attr(r,'TargetMode')==='External')raw[attr(r,'Id')]=attr(r,'Target')}
        const d=xml(await zip.text(path)),{cx,cy}=this._lsize;
        for(const nv of allByLocal(d,'cNvPr')){
          const h=[...nv.children].find(c=>c.localName==='hlinkClick');if(!h)continue;
          const rid=[...h.attributes].find(a=>a.localName==='id')?.value,url=raw[rid];if(!url||!/^(https?:|mailto:)/i.test(url))continue;
          const shape=nv.parentNode?.parentNode,xfrm=shape&&allByLocal(shape,'xfrm')[0],off=xfrm&&firstByLocal(xfrm,'off'),ext=xfrm&&firstByLocal(xfrm,'ext');if(!off||!ext)continue;
          out.push({url,x:+attr(off,'x')/cx,y:+attr(off,'y')/cy,w:+attr(ext,'cx')/cx,h:+attr(ext,'cy')/cy});
        }
      }
    }catch(e){console.warn('Tautan bentuk gagal dibaca',e)}
    this._links.set(i,out);return out;
  }
  destroy(){this._exitScroll?.(true);this.clearSearch?.();this._clearSlideHighlight();clearTimeout(this.presentationHudTimer);this.exitPresentation();this.thumbObserver?.disconnect?.();if(this.thumbResizeHandler)window.removeEventListener('resize',this.thumbResizeHandler);if(this.viewerResize){window.removeEventListener('resize',this.viewerResize);window.removeEventListener('orientationchange',this.viewerResize)}for(const x of this.thumbHandles.values())try{x.handle?.dispose?.()}catch{}this.thumbHandles.clear();this.onlineViewer?.destroy?.();for(const u of this.urls)URL.revokeObjectURL(u);if(this.subToolbar){this.subToolbar.classList.remove('pptx-subtoolbar');this.subToolbar.classList.add('hidden');this.subToolbar.replaceChildren()}}
}

Object.assign(exports,{PptxViewer});

});
__define('js/viewers/pdf.js',function(module,exports,require){
const {clamp}=require('js/utils.js');
const PDFJS_VERSION='6.3.289';
const PDFJS_BASE=new URL('vendor/pdfjs/',document.baseURI).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class PdfViewer{
  constructor(host,subToolbar){
    this.host=host;this.subToolbar=subToolbar;this.zoom=1;this.urls=[];this.pdf=null;this.pageGap=true;this.currentPage=1;
    this.pageEls=[];this.thumbEls=[];this.rendered=new Set();this.everRendered=new Set();this.rendering=new Map();this.textData=[];this.pageGeoms=[];this.pageViewports=[];
    this.searchResults=[];this.searchIndex=-1;this.searchQuery='';this.searchToken=0;this.destroyed=false;this.progressTimer=null;this.scrollRaf=0;
    this.queue=[];this.queued=new Map();this.activeJob=null;this.liveRadius=2;this.evictRadius=3;
    this.pageDpr=[];this.hqTimer=null;this.hqRendering=new Map();this.qualityMode='large';this.renderSamples=[];this.deviceMemory=Number(navigator.deviceMemory||4);
  }
  async open(file){
    this.buffer=await file.arrayBuffer();
    try{
      const pdfjs=await Promise.race([import(`${PDFJS_BASE}build/pdf.min.js`),new Promise((_,rej)=>setTimeout(()=>rej(new Error('PDF.js timeout')),6500))]);
      pdfjs.GlobalWorkerOptions.workerSrc=`${PDFJS_BASE}build/pdf.worker.min.js`;this.pdfjs=pdfjs;
      this.pdf=await pdfjs.getDocument({data:new Uint8Array(this.buffer.slice(0)),cMapUrl:`${PDFJS_BASE}cmaps/`,cMapPacked:true,standardFontDataUrl:`${PDFJS_BASE}standard_fonts/`,iccUrl:`${PDFJS_BASE}iccs/`,wasmUrl:`${PDFJS_BASE}wasm/`,useWasm:true,isImageDecoderSupported:false,isOffscreenCanvasSupported:false,canvasMaxAreaInBytes:-1,useSystemFonts:true,stopAtErrors:false}).promise;
      this._configureQualityMode();await this._build();return{engine:`PDF.js ${this.qualityMode==='max'?'Max':this.qualityMode==='balanced'?'Balanced':'Virtual'}`,detail:`${this.pdf.numPages} halaman`};
    }catch(e){console.warn('PDF.js unavailable, native fallback',e);this._native(file);return{engine:'Native Fallback',detail:'PDF'}}
  }
  _configureQualityMode(){
    const total=this.pdf?.numPages||1;
    if(total<=15){this.qualityMode='max';this.liveRadius=total;this.evictRadius=total}
    else if(total<=60){this.qualityMode='balanced';this.liveRadius=4;this.evictRadius=8}
    else{this.qualityMode='large';this.liveRadius=2;this.evictRadius=3}
  }
  _qualityLabel(){return this.qualityMode==='max'?'Quality Max':this.qualityMode==='balanced'?'Balanced':'Large PDF'}
  async _build(){
    this.shell=document.createElement('div');this.shell.className='pdf-shell';this.thumbs=document.createElement('aside');this.thumbs.className='pdf-thumbs';this.pages=document.createElement('main');this.pages.className='pdf-pages';this.pageStack=document.createElement('div');this.pageStack.className='pdf-page-stack';this.pages.append(this.pageStack);this.shell.append(this.thumbs,this.pages);this.host.replaceChildren(this.shell);
    this.progress=document.createElement('div');this.progress.className='render-progress';this.progress.textContent=`Memuat halaman 1/${this.pdf.numPages}`;this.host.append(this.progress);
    this._toolbar();this._makeFloatingNav();
    const first=await this.pdf.getPage(1),base=first.getViewport({scale:1});this.baseRatio=base.height/base.width;this.baseWidth=base.width;this.baseHeight=base.height;
    for(let i=1;i<=this.pdf.numPages;i++)this._makePlaceholder(i);
    await this._ensurePage(1,100,true);this._setupObserver();this._bindScroll();this._setFloating(1);this._maintainWindow(1);if(this.qualityMode==='max')for(let i=2;i<=this.pdf.numPages;i++)this._ensurePage(i,40-i*.1,true);
  }
  _makePlaceholder(num){
    const avail=Math.max(280,(this.pages.clientWidth||this.host.clientWidth)-36),fit=Math.min(1.65,avail/this.baseWidth),w=this.baseWidth*fit,h=this.baseHeight*fit;
    const wrap=document.createElement('div');wrap.className='pdf-page pdf-page-placeholder';wrap.dataset.page=num;wrap.style.width=`${w}px`;wrap.style.height=`${h}px`;wrap.innerHTML=`<div class="page-placeholder-label">Halaman ${num}</div>`;this.pageStack.append(wrap);this.pageEls.push(wrap);
    const thumb=document.createElement('button');thumb.type='button';thumb.className='pdf-thumb thumb-placeholder';thumb.innerHTML=`<div class="thumb-placeholder-label">${num}</div><span>${num}</span>`;thumb.onclick=()=>this.goToPage(num);this.thumbs.append(thumb);this.thumbEls.push(thumb)
  }
  _toolbar(){
    this.subToolbar.classList.remove('hidden');this.subToolbar.classList.add('pdf-subtoolbar');const box=document.createElement('div');box.className='search-box compact-search pdf-search-box';
    box.innerHTML='<input type="search" placeholder="Cari PDF…"><button class="mini-btn" data-find title="Cari">⌕</button><div class="search-results hidden"><span class="search-status"></span><button class="mini-btn" data-prev title="Hasil sebelumnya">↑</button><button class="mini-btn" data-next title="Hasil berikutnya">↓</button><button class="mini-btn clear-search" data-clear title="Hapus pencarian">×</button></div>';
    this.searchInput=box.querySelector('input');this.searchControls=box.querySelector('.search-results');this.searchStatus=box.querySelector('.search-status');
    box.querySelector('[data-find]').onclick=()=>this.search(this.searchInput.value);box.querySelector('[data-prev]').onclick=()=>this._stepSearch(-1);box.querySelector('[data-next]').onclick=()=>this._stepSearch(1);box.querySelector('[data-clear]').onclick=()=>this.clearSearch();
    this.searchInput.onkeydown=e=>{if(e.key==='Enter'){if(this.searchQuery===this.searchInput.value.trim()&&this.searchResults.length)this._stepSearch(1);else this.search(this.searchInput.value)}};
    const tools=document.createElement('div');tools.className='page-tools compact-page-tools';tools.innerHTML='<button class="mini-btn page-gap-toggle">Gap ON</button><button class="mini-btn" data-fitw title="Pas lebar">Fit Lebar</button>';
    this.gapBtn=tools.querySelector('.page-gap-toggle');this.gapBtn.onclick=()=>{this.pageGap=!this.pageGap;this.pages.classList.toggle('no-page-gap',!this.pageGap);this.gapBtn.textContent=`Gap ${this.pageGap?'ON':'OFF'}`};tools.querySelector('[data-fitw]').onclick=()=>this.fitWidth();this.subToolbar.replaceChildren(box,tools)
  }
  _makeFloatingNav(){
    const nav=document.createElement('div');nav.className='floating-position floating-nav';nav.innerHTML='<button data-prev aria-label="Halaman sebelumnya">‹</button><span class="floating-count">1 / 1</span><label>Ke <input inputmode="numeric" type="number" min="1" value="1" aria-label="Pergi ke halaman"></label><button data-go aria-label="Pergi">↵</button><button data-next aria-label="Halaman berikutnya">›</button>';
    this.host.append(nav);this.floating=nav;this.floatCount=nav.querySelector('.floating-count');this.floatJump=nav.querySelector('input');nav.querySelector('[data-prev]').onclick=()=>this.goToPage(this.currentPage-1);nav.querySelector('[data-next]').onclick=()=>this.goToPage(this.currentPage+1);nav.querySelector('[data-go]').onclick=()=>this.goToPage(+this.floatJump.value);this.floatJump.onkeydown=e=>{if(e.key==='Enter')this.goToPage(+this.floatJump.value)};this._setFloating(1)
  }
  _setupObserver(){
    if(!('IntersectionObserver'in window))return;this.observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){const n=+e.target.dataset.page;this._ensurePage(n,70)}},{root:this.pages,rootMargin:'55% 0px',threshold:.01});this.pageEls.forEach(p=>this.observer.observe(p))
  }
  _bindScroll(){this.scrollHandler=()=>{if(this.scrollRaf)return;this.scrollRaf=requestAnimationFrame(()=>{this.scrollRaf=0;this._updateCurrentPage()})};this.pages.addEventListener('scroll',this.scrollHandler,{passive:true})}
  _calcViewport(page){const base=page.getViewport({scale:1}),avail=Math.max(280,this.pages.clientWidth-36),fit=Math.min(1.65,avail/base.width);return page.getViewport({scale:fit})}
  _canvasDpr(vp,high=false){
    const coarse=window.matchMedia?.('(pointer:coarse)')?.matches||innerWidth<1024,px=Math.max(1,vp.width*vp.height),mem=this.deviceMemory||4;
    if(this.qualityMode==='max'){
      const cap=coarse?(mem>=6?2.25:2.0):(mem>=6?2.5:2.2),maxPixels=mem>=6?7200000:5200000;
      return Math.max(1,Math.min(devicePixelRatio||1,cap,Math.sqrt(maxPixels/px)));
    }
    const zoomBoost=high?Math.min(1.4,Math.max(1,this.zoom||1)):1;
    let dpr=Math.min(devicePixelRatio||1,high?(coarse?1.95:2.15):(this.qualityMode==='balanced'?(coarse?1.45:1.7):(coarse?1.18:1.45)))*zoomBoost;
    const maxPixels=high?(coarse?5000000:6400000):(this.qualityMode==='balanced'?(coarse?3200000:4400000):(coarse?2200000:3600000));
    dpr=Math.min(dpr,Math.sqrt(maxPixels/px));return Math.max(1,dpr)
  }
  _ensurePage(num,priority=50,force=false){
    if(this.destroyed||!this.pdf||num<1||num>this.pdf.numPages)return Promise.resolve(null);if(this.rendered.has(num))return Promise.resolve(this.pageEls[num-1]);if(this.rendering.has(num))return this.rendering.get(num);if(this.queued.has(num))return this.queued.get(num).promise;
    let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej}),job={num,priority,force,resolve,reject,promise};this.queue.push(job);this.queued.set(num,job);this._sortQueue();this._pumpQueue();return promise
  }
  _sortQueue(){this.queue.sort((a,b)=>b.priority-a.priority||Math.abs(a.num-this.currentPage)-Math.abs(b.num-this.currentPage))}
  async _pumpQueue(){
    if(this.activeJob||this.destroyed)return;let job=this.queue.shift();if(!job)return;this.queued.delete(job.num);
    if(!job.force&&Math.abs(job.num-this.currentPage)>this.evictRadius+1){job.resolve(null);return this._pumpQueue()}
    this.activeJob=job;this._showProgress(`${this._qualityLabel()} · Memuat ${job.num}/${this.pdf.numPages}`);const started=performance.now(),task=this._renderPage(job.num);this.rendering.set(job.num,task);
    try{const out=await task;this._recordRenderTime(performance.now()-started);job.resolve(out)}catch(e){console.warn('PDF render page failed',job.num,e);const w=this.pageEls[job.num-1];if(w){w.replaceChildren();const er=document.createElement('div');er.className='page-render-error';er.textContent='Halaman gagal dirender';w.append(er)}job.resolve(null)}finally{this.rendering.delete(job.num);this.activeJob=null;this._evictFar(this.currentPage);this._showProgress(`${this._qualityLabel()} · Halaman ${this.currentPage}/${this.pdf.numPages} siap`,true);this._pumpQueue()}
  }
  _recordRenderTime(ms){
    if(!Number.isFinite(ms))return;this.renderSamples.push(ms);if(this.renderSamples.length>6)this.renderSamples.shift();
    if(this.qualityMode==='balanced'&&this.renderSamples.length>=3&&this.deviceMemory>=6){
      const avg=this.renderSamples.reduce((a,b)=>a+b,0)/this.renderSamples.length;
      if(avg<120){this.liveRadius=6;this.evictRadius=12}
    }
  }
  async _renderPage(num){
    const page=await this.pdf.getPage(num);if(this.destroyed)return null;const vp=this._calcViewport(page),wrap=this.pageEls[num-1];this.pageViewports[num-1]=vp;wrap.style.width=`${vp.width}px`;wrap.style.height=`${vp.height}px`;wrap.classList.remove('pdf-page-placeholder');wrap.replaceChildren();
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false}),dpr=this._canvasDpr(vp,this.qualityMode==='max'||num===this.currentPage),rvp=page.getViewport({scale:vp.scale*dpr});canvas.width=Math.max(1,Math.floor(rvp.width));canvas.height=Math.max(1,Math.floor(rvp.height));canvas.style.width=`${vp.width}px`;canvas.style.height=`${vp.height}px`;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);wrap.append(canvas);this.pageDpr[num-1]=dpr;
    const layer=document.createElement('div');layer.className='pdf-text-layer';layer.style.width=`${vp.width}px`;layer.style.height=`${vp.height}px`;wrap.append(layer);
    await page.render({canvasContext:ctx,viewport:rvp,intent:'display',background:'rgb(255,255,255)'}).promise;
    if(this.searchQuery){await this._ensureTextPage(num);this._buildGeoms(num,vp);this._paintSearchPage(num)}
    this.rendered.add(num);this.everRendered.add(num);this._renderThumbFromCanvas(canvas,num);return wrap
  }
  _maintainWindow(center){
    if(!this.pdf)return;const total=this.pdf.numPages;this._ensurePage(center,100,true);
    if(this.qualityMode==='max'){for(let i=1;i<=total;i++)if(i!==center)this._ensurePage(i,45-Math.abs(i-center)*.2,true);this._sortQueue();return}
    for(let d=1;d<=this.liveRadius;d++){if(center+d<=total)this._ensurePage(center+d,80-d*5);if(center-d>=1)this._ensurePage(center-d,80-d*5)}
    this.queue=this.queue.filter(job=>{if(job.force||Math.abs(job.num-center)<=this.evictRadius+1)return true;this.queued.delete(job.num);job.resolve(null);return false});this._sortQueue();this._evictFar(center)
  }
  _evictFar(center){if(this.qualityMode==='max')return;for(const n of [...this.rendered])if(Math.abs(n-center)>this.evictRadius)this._evictPage(n)}
  _evictPage(num){
    const wrap=this.pageEls[num-1];if(!wrap)return;for(const c of wrap.querySelectorAll('canvas')){try{c.width=1;c.height=1}catch{}}wrap.replaceChildren();const label=document.createElement('div');label.className='page-placeholder-label';label.textContent=`Halaman ${num}`;wrap.append(label);wrap.classList.add('pdf-page-placeholder');this.rendered.delete(num);this.pageGeoms[num-1]=null;this.pageViewports[num-1]=null;this.pageDpr[num-1]=0
  }
  _scheduleActiveQuality(num=this.currentPage){if(this.qualityMode==='max')return;clearTimeout(this.hqTimer);this.hqTimer=setTimeout(()=>this._upgradeActiveQuality(num),180)}
  async _upgradeActiveQuality(num){
    if(this.destroyed||!this.pdf||num!==this.currentPage||!this.rendered.has(num)||this.hqRendering.has(num))return;
    const wrap=this.pageEls[num-1],oldCanvas=wrap?.querySelector('canvas'),vp=this.pageViewports[num-1];if(!wrap||!oldCanvas||!vp)return;
    const target=this._canvasDpr(vp,true),have=this.pageDpr[num-1]||1;if(have>=target*.92)return;
    const task=(async()=>{try{const page=await this.pdf.getPage(num);if(this.destroyed||num!==this.currentPage)return;const rvp=page.getViewport({scale:vp.scale*target}),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{alpha:false});canvas.width=Math.max(1,Math.floor(rvp.width));canvas.height=Math.max(1,Math.floor(rvp.height));canvas.style.width=`${vp.width}px`;canvas.style.height=`${vp.height}px`;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);await page.render({canvasContext:ctx,viewport:rvp,intent:'display',background:'rgb(255,255,255)'}).promise;if(this.destroyed||num!==this.currentPage)return;const live=wrap.querySelector('canvas');if(live){live.replaceWith(canvas);try{live.width=1;live.height=1}catch{}}else wrap.prepend(canvas);this.pageDpr[num-1]=target}catch(e){console.warn('PDF active quality upgrade failed',num,e)}finally{this.hqRendering.delete(num)}})();
    this.hqRendering.set(num,task);await task
  }
  async _ensureTextPage(num){
    if(this.textData[num-1])return this.textData[num-1];try{const p=await this.pdf.getPage(num),tc=await p.getTextContent({includeMarkedContent:false});const data={text:(tc.items||[]).map(x=>x.str||'').join(' '),items:(tc.items||[]).filter(x=>x.str),styles:tc.styles||{}};this.textData[num-1]=data;return data}catch{const data={text:'',items:[],styles:{}};this.textData[num-1]=data;return data}
  }
  _buildGeoms(num,vp){const td=this.textData[num-1];if(!td||!vp)return[];const items=[],styles=td.styles||{};for(const item of td.items||[]){const tx=this.pdfjs.Util.transform(vp.transform,item.transform),fontHeight=Math.max(1,Math.hypot(tx[2],tx[3])),angle=Math.atan2(tx[1],tx[0]),targetWidth=Math.max(1,(item.width||item.str.length*fontHeight*.5)*vp.scale),style=styles[item.fontName]||{},ascent=Number.isFinite(style.ascent)?style.ascent:(Number.isFinite(style.descent)?1+style.descent:1),fontAscent=Math.max(1,ascent*fontHeight);items.push({str:item.str,x:tx[4],y:tx[5]-fontAscent,w:targetWidth,h:fontHeight,angle,font:style.fontFamily||'sans-serif'})}this.pageGeoms[num-1]=items;return items}
  _renderThumbFromCanvas(source,num){const btn=this.thumbEls[num-1];if(!btn||btn.dataset.ready||!source)return;try{const maxW=110,scale=Math.min(1,maxW/Math.max(1,source.width)),tc=document.createElement('canvas'),ctx=tc.getContext('2d',{alpha:false});tc.width=Math.max(1,Math.round(source.width*scale));tc.height=Math.max(1,Math.round(source.height*scale));ctx.fillStyle='#fff';ctx.fillRect(0,0,tc.width,tc.height);ctx.drawImage(source,0,0,tc.width,tc.height);btn.querySelector('.thumb-placeholder-label')?.remove();btn.prepend(tc);btn.dataset.ready='1';btn.classList.remove('thumb-placeholder')}catch(e){console.warn('PDF thumb snapshot failed',num,e)}}
  _showProgress(text,settle=false){if(!this.progress)return;clearTimeout(this.progressTimer);this.progress.classList.remove('hidden');this.progress.textContent=text;if(settle)this.progressTimer=setTimeout(()=>this.progress?.classList.add('hidden'),900)}
  async _ensureTextIndex(token){this.searchStatus.textContent='Membaca teks…';this.searchControls.classList.remove('hidden');for(let i=1;i<=this.pdf.numPages;i++){if(this.destroyed||token!==this.searchToken)return false;if(!this.textData[i-1])await this._ensureTextPage(i);if(i%3===0||i===this.pdf.numPages){this.searchStatus.textContent=`Teks ${i}/${this.pdf.numPages}`;await sleep(0)}}return true}
  _toast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>t.classList.remove('show'),2800)}
  clearSearch(){this.searchToken++;this.searchQuery='';if(this.searchInput)this.searchInput.value='';this.searchResults=[];this.searchIndex=-1;for(const n of this.rendered){const l=this.pageEls[n-1]?.querySelector('.pdf-text-layer');l?.replaceChildren()}this.searchControls?.classList.add('hidden');if(this.searchStatus)this.searchStatus.textContent=''}
  async search(q){
    q=(q||'').trim();this.clearSearch();if(!q)return;this.searchQuery=q;if(this.searchInput)this.searchInput.value=q;this.searchControls.classList.remove('hidden');const token=++this.searchToken;if(!await this._ensureTextIndex(token)||token!==this.searchToken)return;const needle=q.toLocaleLowerCase('id-ID');const results=[];
    for(let pi=0;pi<this.pdf.numPages;pi++){const td=this.textData[pi]||{text:'',items:[]};let exact=0;for(let ii=0;ii<td.items.length;ii++){const raw=td.items[ii].str||'',low=raw.toLocaleLowerCase('id-ID');let from=0,pos;while((pos=low.indexOf(needle,from))!==-1){results.push({page:pi+1,itemIndex:ii,start:pos,len:q.length});exact++;from=pos+Math.max(1,q.length)}}if(!exact&&td.text.toLocaleLowerCase('id-ID').includes(needle))results.push({page:pi+1,itemIndex:null,start:0,len:0})}
    this.searchResults=results;if(!results.length){const any=this.textData.some(x=>x?.text?.trim());if(any){this.searchStatus.textContent='0 hasil'}else{this.searchControls.classList.add('hidden');this.searchStatus.textContent='';this._toast('Teks tidak dapat dicari karena PDF berupa hasil scan/gambar.')}return}for(const n of this.rendered){const vp=this.pageViewports[n-1];if(vp&&!this.pageGeoms[n-1])this._buildGeoms(n,vp);this._paintSearchPage(n)}this.searchIndex=0;await this._focusSearch()
  }
  _paintSearchPage(num){const layer=this.pageEls[num-1]?.querySelector('.pdf-text-layer');if(!layer)return;layer.replaceChildren();if(!this.searchQuery)return;const geoms=this.pageGeoms[num-1]||[];for(let ri=0;ri<this.searchResults.length;ri++){const r=this.searchResults[ri];if(r.page!==num||r.itemIndex==null)continue;const g=geoms[r.itemIndex];if(!g)continue;const raw=(this.textData[num-1]?.items?.[r.itemIndex]?.str)||'',ratioStart=raw.length?r.start/raw.length:0,ratioLen=raw.length?r.len/raw.length:1;const hit=document.createElement('span');hit.className='pdf-search-rect';hit.dataset.result=ri;hit.style.left=`${g.x+g.w*ratioStart}px`;hit.style.top=`${g.y}px`;hit.style.width=`${Math.max(5,g.w*ratioLen)}px`;hit.style.height=`${Math.max(4,g.h*1.05)}px`;if(g.angle)hit.style.transform=`rotate(${g.angle}rad)`;layer.append(hit)}}
  _stepSearch(dir){if(!this.searchResults.length)return;this.searchIndex=(this.searchIndex+dir+this.searchResults.length)%this.searchResults.length;this._focusSearch()}
  async _focusSearch(){const r=this.searchResults[this.searchIndex];if(!r)return;await this.goToPage(r.page,false);await this._ensureTextPage(r.page);const vp=this.pageViewports[r.page-1];if(vp)this._buildGeoms(r.page,vp);this._paintSearchPage(r.page);for(const n of this.rendered)for(const m of this.pageEls[n-1]?.querySelectorAll('.pdf-search-rect.active')||[])m.classList.remove('active');const el=this.pageEls[r.page-1]?.querySelector(`.pdf-search-rect[data-result="${this.searchIndex}"]`);el?.classList.add('active');setTimeout(()=>el?.scrollIntoView?.({behavior:'smooth',block:'center',inline:'center'}),35);this.searchStatus.textContent=`${this.searchIndex+1}/${this.searchResults.length}`}
  _setFloating(n){n=clamp(n,1,this.pdf?.numPages||1);const changed=n!==this.currentPage;this.currentPage=n;if(this.floatCount)this.floatCount.textContent=`${n} / ${this.pdf?.numPages||1}`;if(this.floatJump){this.floatJump.max=this.pdf?.numPages||1;this.floatJump.value=n}this.thumbEls.forEach((x,i)=>x.classList.toggle('active',i===n-1));this.thumbEls[n-1]?.scrollIntoView?.({block:'nearest'});if(changed)this._maintainWindow(n);this._scheduleActiveQuality(n)}
  async goToPage(n,smooth=true){if(!this.pageEls.length)return;n=clamp(Math.round(n)||1,1,this.pageEls.length);this.currentPage=n;if(this.floatCount)this.floatCount.textContent=`${n} / ${this.pdf.numPages}`;if(this.floatJump)this.floatJump.value=n;this._maintainWindow(n);await this._ensurePage(n,120,true);this.pageEls[n-1].scrollIntoView({behavior:smooth?'smooth':'auto',block:'start'});this._setFloating(n)}
  _updateCurrentPage(){if(!this.pageEls.length)return;const box=this.pages.getBoundingClientRect(),probe=box.top+Math.min(120,box.height*.28);let best=this.currentPage-1,bestDist=Infinity;for(let i=0;i<this.pageEls.length;i++){const r=this.pageEls[i].getBoundingClientRect();if(r.bottom<box.top-200||r.top>box.bottom+200)continue;const center=Math.max(r.top,Math.min(probe,r.bottom)),d=Math.abs(center-probe);if(d<bestDist){best=i;bestDist=d}}this._setFloating(best+1)}
  _applyZoom(value=this.zoom){if(!this.pageStack)return;this.pageStack.style.transform='';this.pageStack.style.zoom=String(clamp(value,.5,2.4))}
  async fitWidth(){const page=this.pageEls[this.currentPage-1],base=Math.max(1,page?.offsetWidth||this.baseWidth);return this.setZoom(clamp((this.pages.clientWidth-36)/base,.5,2.4))}
  async fitPage(){return this.fitWidth()}
  previewZoom(z){this._applyZoom(clamp(z,.5,2.4))}
  async setZoom(z){const keep=this.currentPage;this.zoom=clamp(z,.5,2.4);this._applyZoom();requestAnimationFrame(()=>this.pageEls[keep-1]?.scrollIntoView?.({block:'start'}));this._scheduleActiveQuality(keep);return this.zoom}
  endPinch(){this._applyZoom();this._scheduleActiveQuality(this.currentPage)}
  getPosition(){return{page:this.currentPage,zoom:this.zoom}}
  async restorePosition(p){if(!p)return;if(p.zoom){this.zoom=clamp(+p.zoom||1,.5,2.4);this._applyZoom()}await this.goToPage(+p.page||1,false)}
  _native(file){const url=URL.createObjectURL(file);this.urls.push(url);const wrap=document.createElement('div');wrap.className='pdf-fallback';const bar=document.createElement('div');bar.className='pdf-fallback-bar';bar.textContent='Renderer PDF lokal tidak tersedia. Menggunakan viewer PDF bawaan browser/perangkat.';const iframe=document.createElement('iframe');iframe.className='pdf-native';iframe.src=url;wrap.append(bar,iframe);this.host.replaceChildren(wrap);this.subToolbar.classList.add('hidden')}
  setMode(){}
  destroy(){this.destroyed=true;this.searchToken++;clearTimeout(this.progressTimer);clearTimeout(this.hqTimer);cancelAnimationFrame(this.scrollRaf);this.queue.splice(0).forEach(j=>j.resolve(null));this.queued.clear();this.observer?.disconnect?.();if(this.scrollHandler&&this.pages)this.pages.removeEventListener('scroll',this.scrollHandler);for(const n of [...this.rendered])this._evictPage(n);this.clearSearch();for(const u of this.urls)URL.revokeObjectURL(u);this.subToolbar.classList.remove('pdf-subtoolbar');this.subToolbar.classList.add('hidden');this.subToolbar.replaceChildren()}
}

Object.assign(exports,{PdfViewer});

});
__define('js/qr.js',function(module,exports,require){
/* QR Code kecil (mode byte, koreksi L, versi 1–5) untuk alamat Presentasi Nirkabel. Tanpa pustaka luar. */
const SPEC=[null,{t:26,e:7,a:[]},{t:44,e:10,a:[6,18]},{t:70,e:15,a:[6,22]},{t:100,e:20,a:[6,26]},{t:134,e:26,a:[6,30]}];
const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
(()=>{let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d}for(let i=255;i<512;i++)EXP[i]=EXP[i-255]})();
const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
function rsGen(n){let g=[1];for(let i=0;i<n;i++){const ng=new Array(g.length+1).fill(0);for(let j=0;j<g.length;j++){ng[j]^=g[j];ng[j+1]^=mul(g[j],EXP[i])}g=ng}return g}
function rsEcc(data,n){const g=rsGen(n),r=new Array(n).fill(0);for(const d of data){const f=d^r[0];r.shift();r.push(0);for(let j=0;j<n;j++)r[j]^=mul(g[j+1],f)}return r}
function qrMatrix(text){
  const bytes=[...new TextEncoder().encode(text)];let v=1;while(v<=5&&bytes.length+2>SPEC[v].t-SPEC[v].e)v++;if(v>5)throw new Error('Teks terlalu panjang untuk QR');
  const sp=SPEC[v],dataLen=sp.t-sp.e,bits=[];const put=(val,n)=>{for(let i=n-1;i>=0;i--)bits.push((val>>i)&1)};
  put(4,4);put(bytes.length,8);bytes.forEach(b=>put(b,8));for(let i=0;i<4&&bits.length<dataLen*8;i++)bits.push(0);while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8)data.push(parseInt(bits.slice(i,i+8).join(''),2));for(let p=0;data.length<dataLen;p++)data.push(p%2?0x11:0xEC);
  const all=data.concat(rsEcc(data,sp.e)),size=17+4*v;
  const m=[...Array(size)].map(()=>new Array(size).fill(null)),fixed=[...Array(size)].map(()=>new Array(size).fill(false));
  const set=(r,c,val)=>{m[r][c]=val;fixed[r][c]=true};
  const finder=(r,c)=>{for(let y=-1;y<=7;y++)for(let x=-1;x<=7;x++){const rr=r+y,cc=c+x;if(rr<0||cc<0||rr>=size||cc>=size)continue;const on=y>=0&&y<=6&&x>=0&&x<=6&&(y===0||y===6||x===0||x===6||(y>=2&&y<=4&&x>=2&&x<=4));set(rr,cc,on)}};
  finder(0,0);finder(0,size-7);finder(size-7,0);
  for(let i=8;i<size-8;i++){set(6,i,i%2===0);set(i,6,i%2===0)}
  for(const r of sp.a)for(const c of sp.a){if(fixed[r][c])continue;for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++)set(r+y,c+x,Math.max(Math.abs(x),Math.abs(y))!==1)}
  for(let i=0;i<9;i++){if(!fixed[8][i])set(8,i,false);if(!fixed[i][8])set(i,8,false)}for(let i=0;i<8;i++){set(8,size-1-i,false);set(size-1-i,8,false)}
  set(size-8,8,true);
  const stream=[];all.forEach(b=>{for(let i=7;i>=0;i--)stream.push((b>>i)&1)});
  let k=0,up=true;for(let c=size-1;c>0;c-=2){if(c===6)c--;for(let n=0;n<size;n++){const r=up?size-1-n:n;for(const cc of [c,c-1]){if(fixed[r][cc])continue;m[r][cc]=k<stream.length?!!stream[k++]:false}}up=!up}
  const MASK=[(r,c)=>(r+c)%2===0,(r)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,(r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>r*c%2+r*c%3===0,(r,c)=>(r*c%2+r*c%3)%2===0,(r,c)=>((r+c)%2+r*c%3)%2===0];
  const fmtBits=mask=>{const d=(1<<3|mask);let b=d<<10;for(let i=14;i>=10;i--)if(b>>i&1)b^=0x537<<(i-10);return ((d<<10)|b)^0x5412};
  const build=mask=>{const g=m.map((row,r)=>row.map((x,c)=>fixed[r][c]?x:(x!==MASK[mask](r,c))));const f=fmtBits(mask);
    for(let i=0;i<15;i++){const bit=!!(f>>i&1);
      if(i<6)g[i][8]=bit;else if(i===6)g[7][8]=bit;else if(i===7)g[8][8]=bit;else if(i===8)g[8][7]=bit;else g[8][14-i]=bit;
      if(i<8)g[8][size-1-i]=bit;else g[size-15+i][8]=bit}
    return g};
  const penalty=g=>{let p=0;for(let r=0;r<size;r++){let run=1;for(let c=1;c<size;c++){if(g[r][c]===g[r][c-1]){run++;if(run===5)p+=3;else if(run>5)p++}else run=1}}
    for(let c=0;c<size;c++){let run=1;for(let r=1;r<size;r++){if(g[r][c]===g[r-1][c]){run++;if(run===5)p+=3;else if(run>5)p++}else run=1}}
    for(let r=0;r<size-1;r++)for(let c=0;c<size-1;c++){const x=g[r][c];if(x===g[r+1][c]&&x===g[r][c+1]&&x===g[r+1][c+1])p+=3}
    let dark=0;g.forEach(row=>row.forEach(x=>{if(x)dark++}));p+=Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10;return p};
  let best=null,bp=1e9;for(let mk=0;mk<8;mk++){const g=build(mk),p=penalty(g);if(p<bp){bp=p;best=g}}
  return best;
}
function qrSvg(text,px=180){
  const g=qrMatrix(text),n=g.length,q=4,s=n+q*2;let d='';
  g.forEach((row,r)=>row.forEach((x,c)=>{if(x)d+=`M${c+q} ${r+q}h1v1h-1z`}));
  return `<svg viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Kode QR"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

Object.assign(exports,{qrMatrix,qrSvg});

});
__define('js/cast.js',function(module,exports,require){
const {qrSvg}=require('js/qr.js');
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
function castAvailable(){return !!bridge?.castStart}
function castBack(){if(!S)return false;S.root.classList.remove('hidden');confirmEnd();return true}
function castActive(){return !!S}
function loadOpts(){let o={};try{o=JSON.parse(localStorage.getItem(OPT_KEY)||'{}')}catch{}return{notes:o.notes!==false,next:o.next!==false,ifpInk:o.ifpInk!==false,awake:o.awake!==false}}
function saveOpts(){try{localStorage.setItem(OPT_KEY,JSON.stringify(S.opts))}catch{}}
const send=m=>{try{bridge?.castSend?.(JSON.stringify(m))}catch{}};

async function openCast(ctx){
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
function endCast(){
  if(!S)return;send({t:'end'});
  setTimeout(()=>{try{bridge?.castStop?.()}catch{}},250);
  try{bridge?.keepScreenOn?.(false)}catch{}
  clearInterval(S.tick);window.removeEventListener('resize',S.onResize);
  S.root.querySelectorAll('.cast-stage').forEach(st=>{try{st._h?.dispose?.()}catch{}});
  S.root.remove();window.__TG_CAST__=null;window.__TG_CAST_STATUS__=null;window.__TG_CAST_END__=null;S=null;
}

/* Dipakai juga oleh penerima: gambar teks dan uji sentuh penghapus. */
function drawText(ctx,s,w,h,ox,oy){const fs=Math.max(8,s.z*(w/1000));ctx.font=`800 ${fs}px 'Plus Jakarta Sans',system-ui,sans-serif`;ctx.textBaseline='middle';ctx.fillStyle=s.c;ctx.lineWidth=Math.max(2,fs/9);ctx.strokeStyle=s.c==='#FFFFFF'?'rgba(0,0,0,.55)':'rgba(255,255,255,.85)';ctx.lineJoin='round';const x=ox+s.pts[0][0]*w,y=oy+s.pts[0][1]*h;ctx.strokeText(s.txt||'',x,y);ctx.fillText(s.txt||'',x,y)}
function hitInk(ctx,s,p,w,h,r){
  if(s.k==='t'){const fs=Math.max(8,s.z*(w/1000));ctx.save();ctx.font=`800 ${fs}px 'Plus Jakarta Sans',system-ui,sans-serif`;const tw=ctx.measureText(s.txt||'').width;ctx.restore();const x=s.pts[0][0]*w,y=s.pts[0][1]*h,px=p[0]*w,py=p[1]*h;return px>=x-r&&px<=x+tw+r&&py>=y-fs/2-r&&py<=y+fs/2+r}
  return s.pts.some(([a,b])=>Math.hypot((a-p[0])*w,(b-p[1])*h)<r);
}

Object.assign(exports,{castAvailable,castBack,castActive,openCast,endCast,drawText,hitInk});

});
__define('js/app.js',function(module,exports,require){
const {qs,qsa,extOf,formatBytes,clamp}=require('js/utils.js');
const {saveRecent,listRecent,listPinned,getRecent,clearRecent,pinRecent,unpinRecent,updateRecentMeta,removeRecent,dropCopies,storageUsed,clearCopies,clearAllRecent,MAX_TOTAL,MAX_PINNED}=require('js/storage.js');
const {openCast,castAvailable,castBack}=require('js/cast.js');
const {DocxViewer}=require('js/viewers/docx.js');
const {XlsxViewer}=require('js/viewers/xlsx.js');
const {PptxViewer}=require('js/viewers/pptx.js');
const {PdfViewer}=require('js/viewers/pdf.js');
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


});
require('js/app.js');
})();
