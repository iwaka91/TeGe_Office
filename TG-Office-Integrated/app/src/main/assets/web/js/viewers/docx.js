import {openZip} from '../zip-reader.js';
import {xml,attr,resolvePath,firstByLocal,clamp} from '../utils.js';
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

export class DocxViewer{
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
