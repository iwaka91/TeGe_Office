import {attr} from '../utils.js';
/* Penampil persamaan Word (OMML) -> HTML/CSS/SVG murni.
   Tidak bergantung pada MathML atau font matematika, sehingga sama di semua WebView dan saat dicetak. */
const SVGNS='http://www.w3.org/2000/svg';
const kids=(e,n)=>e?[...e.children].filter(c=>c.localName===n):[];
const kid=(e,n)=>e?[...e.children].find(c=>c.localName===n)||null:null;
const mv=(e,n,d)=>{const c=kid(e,n);if(!c)return d;const v=attr(c,'val');return v==null?d:v};
const off=v=>v==='0'||v==='false'||v==='off';
const el=(cls,tag='span')=>{const e=document.createElement(tag);if(cls)e.className=cls;return e};
const txt=(s,cls)=>{const e=el(cls);e.textContent=s;return e};
const svg=(w,h,paths,extra={})=>{
  const s=document.createElementNS(SVGNS,'svg');
  s.setAttribute('viewBox',`0 0 ${w} ${h}`);s.setAttribute('preserveAspectRatio',extra.fit||'none');
  s.setAttribute('class','tgm-svg');s.setAttribute('aria-hidden','true');
  for(const d of paths){const p=document.createElementNS(SVGNS,'path');p.setAttribute('d',d);p.setAttribute('fill',extra.fill?'currentColor':'none');p.setAttribute('stroke','currentColor');p.setAttribute('stroke-width',extra.sw||'1.2');p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');p.setAttribute('vector-effect','non-scaling-stroke');s.append(p)}
  return s;
};
const REL=new Set('=<>≤≥≈≠≡≪≫∼≃≅∝∈∉⊂⊃⊆⊇→←↔⇒⇐⇔↦∥⊥'.split(''));
const BIN=new Set('+−-×÷±∓·∗⋅∘∪∩∧∨⊕⊗∖'.split(''));
const ITAL=/[A-Za-zα-ωϑϕϖϱϵ]/;
const FUNCS=new Set(['sin','cos','tan','cot','sec','csc','log','ln','lim','exp','min','max','arcsin','arccos','arctan','sinh','cosh','tanh','det','gcd','sup','inf','mod']);

/* kurung/penutup yang ikut meregang mengikuti tinggi isi */
const FENCE={
  '(':['M8 1C2 25 2 75 8 99'],')':['M2 1C8 25 8 75 2 99'],
  '[':['M8 1H3V99H8'],']':['M2 1H7V99H2'],
  '{':['M8 1C4 1 5 20 5 40C5 47 3 50 1 50C3 50 5 53 5 60C5 80 4 99 8 99'],
  '}':['M2 1C6 1 5 20 5 40C5 47 7 50 9 50C7 50 5 53 5 60C5 80 6 99 2 99'],
  '|':['M5 1V99'],'‖':['M3 1V99','M7 1V99'],
  '⟨':['M8 1L2 50L8 99'],'〈':['M8 1L2 50L8 99'],'<':['M8 1L2 50L8 99'],
  '⟩':['M2 1L8 50L2 99'],'〉':['M2 1L8 50L2 99'],'>':['M2 1L8 50L2 99'],
  '⌊':['M8 1H3V99'],'⌋':['M2 99H7V1'],'⌈':['M3 99V1H8'],'⌉':['M2 1H7V99']
};
function fence(ch){
  const p=FENCE[ch];
  if(!p)return txt(ch,'tgm-op');
  const w=document.createElement('span');w.className='tgm-fence';
  w.append(svg(10,100,p,{sw:'1.1'}));return w;
}

export function renderOmml(node,base){
  /* base: {fam, sz, rpr(el)->{sz,b,i,color}} */
  const R=base||{};
  const build=(n,ctx)=>{
    const out=document.createDocumentFragment();
    for(const c of n.children)out.append(one(c,ctx));
    return out;
  };
  const arg=(n,ctx)=>{
    const s=el('tgm-g');if(n)s.append(build(n,ctx));
    let prev=null;
    for(const c of s.children){
      if(c.classList.contains('tgm-bin')&&(!prev||prev.classList.contains('tgm-bin')||prev.classList.contains('tgm-rel')||prev.classList.contains('tgm-cm')))c.classList.add('tgm-un');
      prev=c;
    }
    return s;
  };
  const scr=(ctx,k)=>({...ctx,lvl:Math.min((ctx.lvl||0)+(k||1),2)});
  function run(r,ctx){
    const rp=[...r.children].filter(c=>c.localName==='rPr');
    const isM=c=>/math/i.test(c.namespaceURI||'');
    const pr=rp.find(isM)||null,wrp=rp.find(c=>!isM(c))||null;
    const sty=pr?mv(pr,'sty',null):null;
    const nor=!!(pr&&kid(pr,'nor')&&!off(mv(pr,'nor','1')));
    const wd=wrp&&R.rpr?R.rpr(wrp):null;
    let s='';for(const t of kids(r,'t'))s+=t.textContent||'';
    if(!s)return document.createDocumentFragment();
    const o=document.createDocumentFragment();
    const plain=nor||sty==='p'||sty==='b';
    const bold=sty==='b'||sty==='bi'||(wd&&wd.b);
    const italicForced=sty==='i'||sty==='bi';
    // nama fungsi lengkap ditulis tegak
    const word=/^[A-Za-z]{2,}$/.test(s)&&(plain||FUNCS.has(s));
    let buf='';
    const flush=(it)=>{if(!buf)return;const e=txt(buf,'tgm-t');if(it)e.style.fontStyle='italic';if(bold)e.style.fontWeight='700';if(wd&&wd.sz&&R.sz)e.style.fontSize=(wd.sz*2/3).toFixed(2)+'px';o.append(e);buf=''};
    let cur=null;
    for(const ch of s){
      let it=!plain&&!word&&(italicForced||ITAL.test(ch));
      if(sty==='p'||sty==='b'||nor)it=false;
      if(ch===','||ch===';'){flush(cur);cur=null;o.append(txt(ch,'tgm-t tgm-cm'));continue}
      if(REL.has(ch)||BIN.has(ch)){
        flush(cur);cur=null;
        const e=txt(ch,'tgm-t '+(REL.has(ch)?'tgm-rel':'tgm-bin'));
        if(bold)e.style.fontWeight='700';
        o.append(e);continue;
      }
      if(cur!==null&&cur!==it){flush(cur)}
      cur=it;buf+=ch;
    }
    flush(cur);
    return o;
  }
  function frac(n,ctx){
    const type=mv(kid(n,'fPr'),'type','bar');
    const w=el(type==='lin'?'tgm-lin':'tgm-frac');
    const num=arg(kid(n,'num'),scr(ctx,0)),den=arg(kid(n,'den'),scr(ctx,0));
    if(type==='lin'){w.append(num,txt('/','tgm-op'),den);return w}
    const a=el('tgm-num'),b=el('tgm-den');a.append(num);b.append(den);
    if(type==='noBar'){a.style.borderBottom='0'}
    w.append(a,b);return w;
  }
  function sup(n,ctx){const w=el('tgm-ss');w.append(arg(kid(n,'e'),ctx));const u=el('tgm-sup');u.append(arg(kid(n,'sup'),scr(ctx)));w.append(u);return w}
  function sub(n,ctx){const w=el('tgm-ss');w.append(arg(kid(n,'e'),ctx));const u=el('tgm-sub');u.append(arg(kid(n,'sub'),scr(ctx)));w.append(u);return w}
  function subsup(n,ctx){
    const w=el('tgm-ss');w.append(arg(kid(n,'e'),ctx));
    const st=el('tgm-stack');const a=el('tgm-sup'),b=el('tgm-sub');
    a.append(arg(kid(n,'sup'),scr(ctx)));b.append(arg(kid(n,'sub'),scr(ctx)));st.append(a,b);w.append(st);return w;
  }
  function pre(n,ctx){
    const w=el('tgm-ss');const st=el('tgm-stack tgm-pre');const a=el('tgm-sup'),b=el('tgm-sub');
    a.append(arg(kid(n,'sup'),scr(ctx)));b.append(arg(kid(n,'sub'),scr(ctx)));st.append(a,b);w.append(st,arg(kid(n,'e'),ctx));return w;
  }
  function rad(n,ctx){
    const pr=kid(n,'radPr');const hide=mv(pr,'degHide','0');
    const hasDeg=!(hide==='1'||hide==='true'||hide==='on')&&kid(n,'deg')&&(kid(n,'deg').textContent||'').trim();
    const w=el('tgm-rad');
    if(hasDeg){const d=el('tgm-deg');d.append(arg(kid(n,'deg'),scr(ctx,2)));w.append(d)}
    const sign=el('tgm-rsign');
    sign.append(svg(12,20,['M0.5 11L2.5 9.6L5.2 17.5L11.6 0.5'],{sw:'1.1'}));
    const body=el('tgm-rbody');body.append(arg(kid(n,'e'),ctx));
    w.append(sign,body);return w;
  }
  function nary(n,ctx){
    const pr=kid(n,'naryPr');
    const chr=kid(pr,'chr')?attr(kid(pr,'chr'),'val'):'∫';
    const hideSub=mv(pr,'subHide','0'),hideSup=mv(pr,'supHide','0');
    const isInt=/[∫∬∭∮∯∰]/.test(chr||'∫')||chr==='';
    const loc=mv(pr,'limLoc',isInt?'subSup':'undOvr');
    const hasSub=!(hideSub==='1'||hideSub==='true'||hideSub==='on')&&(kid(n,'sub')?.textContent||'').trim();
    const hasSup=!(hideSup==='1'||hideSup==='true'||hideSup==='on')&&(kid(n,'sup')?.textContent||'').trim();
    const w=el('tgm-nary');
    let glyph;
    if(isInt){
      const k={'∬':2,'∭':3,'∯':2,'∰':3}[chr]||1;
      glyph=el('tgm-int');
      for(let i=0;i<k;i++)glyph.append(svg(10,30,['M8.6 3.2C8.6 1.4 7.2 0.8 6 1.6C4.6 2.6 5 8 5 15C5 22 5.4 27.4 4 28.4C2.8 29.2 1.4 28.6 1.4 26.8'],{sw:'1.25'}));
      if(chr==='∮'||chr==='∯'||chr==='∰'){const c=svg(10,10,['M5 2.2A2.8 2.2 0 1 0 5.01 2.2'],{sw:'1'});c.setAttribute('class','tgm-svg tgm-circ');glyph.append(c)}
    }else{
      const map={'∑':'Σ','∏':'Π','⋃':'∪','⋂':'∩','⋁':'∨','⋀':'∧'};
      glyph=txt(map[chr]||chr,'tgm-big');
    }
    const lo=hasSub?(()=>{const e=el('tgm-lim');e.append(arg(kid(n,'sub'),scr(ctx)));return e})():null;
    const up=hasSup?(()=>{const e=el('tgm-lim');e.append(arg(kid(n,'sup'),scr(ctx)));return e})():null;
    if(loc==='undOvr'){
      const col=el('tgm-und');if(up)col.append(up);col.append(glyph);if(lo)col.append(lo);w.append(col);
    }else{
      const g=el('tgm-sidelim');g.append(glyph);
      if(up||lo){const st=el('tgm-stack tgm-nstack');const a=el('tgm-sup'),b=el('tgm-sub');if(up)a.append(up);if(lo)b.append(lo);st.append(a,b);g.append(st)}
      w.append(g);
    }
    const body=el('tgm-nbody');body.append(arg(kid(n,'e'),ctx));w.append(body);return w;
  }
  function delim(n,ctx){
    const pr=kid(n,'dPr');
    const bc=kid(pr,'begChr'),ec=kid(pr,'endChr'),sc=kid(pr,'sepChr');
    const b=bc?attr(bc,'val'):'(',e=ec?attr(ec,'val'):')',s=sc?attr(sc,'val'):'|';
    const w=el('tgm-d');
    if(b)w.append(fence(b));
    const es=kids(n,'e');
    const inner=el('tgm-di');
    es.forEach((x,i)=>{if(i&&s)inner.append(fence(s));inner.append(arg(x,ctx))});
    w.append(inner);
    if(e)w.append(fence(e));
    return w;
  }
  function func(n,ctx){
    const w=el('tgm-func');const nm=el('tgm-fname');nm.append(arg(kid(n,'fName'),ctx));
    for(const t of nm.querySelectorAll('.tgm-t'))t.style.fontStyle='normal';
    w.append(nm,arg(kid(n,'e'),ctx));return w;
  }
  function matrix(n,ctx){
    const t=el('tgm-mx');
    for(const r of kids(n,'mr')){
      const row=el('tgm-mr');
      for(const c of kids(r,'e')){const cell=el('tgm-mc');cell.append(arg(c,ctx));row.append(cell)}
      t.append(row);
    }
    return t;
  }
  function eqarr(n,ctx){
    const t=el('tgm-eqa');
    for(const e of kids(n,'e')){const r=el('tgm-eqr');r.append(arg(e,ctx));t.append(r)}
    return t;
  }
  function acc(n,ctx){
    const c=kid(kid(n,'accPr'),'chr');const ch=c?attr(c,'val'):'̂';
    const map={'̂':'^','̃':'~','̄':'¯','̅':'¯','⃗':'→','̇':'˙','̈':'¨','̌':'ˇ','́':'´','̀':'`','̆':'˘'};
    const w=el('tgm-acc');const a=txt(map[ch]||ch,'tgm-ac');
    if(ch==='̄'||ch==='̅'||ch==='¯'){w.className='tgm-ovl';w.append(arg(kid(n,'e'),ctx));return w}
    const b=el('tgm-ab');b.append(arg(kid(n,'e'),ctx));w.append(a,b);return w;
  }
  function bar(n,ctx){
    const pos=mv(kid(n,'barPr'),'pos','bot');
    const w=el(pos==='top'?'tgm-ovl':'tgm-unl');w.append(arg(kid(n,'e'),ctx));return w;
  }
  function limLow(n,ctx){
    const w=el('tgm-und');const b=arg(kid(n,'e'),ctx);const l=el('tgm-lim');l.append(arg(kid(n,'lim'),scr(ctx)));
    for(const t of b.querySelectorAll('.tgm-t'))if(FUNCS.has(t.textContent))t.style.fontStyle='normal';
    w.append(b,l);return w;
  }
  function limUpp(n,ctx){
    const w=el('tgm-und');const b=arg(kid(n,'e'),ctx);const l=el('tgm-lim');l.append(arg(kid(n,'lim'),scr(ctx)));w.append(l,b);return w;
  }
  function group(n,ctx){
    const c=kid(kid(n,'groupChrPr'),'chr');const ch=c?attr(c,'val'):'⏟';const pos=mv(kid(n,'groupChrPr'),'pos','bot');
    const w=el('tgm-und');const b=arg(kid(n,'e'),ctx);
    const brace=el('tgm-gc');brace.append(svg(100,10,pos==='top'?['M1 9C1 4 20 8 48 1C50 0 50 0 52 1C80 8 99 4 99 9']:['M1 1C1 6 20 2 48 9C50 10 50 10 52 9C80 2 99 6 99 1'],{sw:'1'}));
    if(pos==='top')w.append(brace,b);else w.append(b,brace);return w;
  }
  function border(n,ctx){
    const w=el('tgm-box');w.append(arg(kid(n,'e'),ctx));return w;
  }
  function one(c,ctx){
    switch(c.localName){
      case 'r':return run(c,ctx);
      case 'f':return frac(c,ctx);
      case 'sSup':return sup(c,ctx);
      case 'sSub':return sub(c,ctx);
      case 'sSubSup':return subsup(c,ctx);
      case 'sPre':return pre(c,ctx);
      case 'rad':return rad(c,ctx);
      case 'nary':return nary(c,ctx);
      case 'd':return delim(c,ctx);
      case 'func':return func(c,ctx);
      case 'm':return matrix(c,ctx);
      case 'eqArr':return eqarr(c,ctx);
      case 'acc':return acc(c,ctx);
      case 'bar':return bar(c,ctx);
      case 'limLow':return limLow(c,ctx);
      case 'limUpp':return limUpp(c,ctx);
      case 'groupChr':return group(c,ctx);
      case 'borderBox':return border(c,ctx);
      case 'box':case 'phant':return arg(kid(c,'e'),ctx);
      case 'oMath':return arg(c,ctx);
      case 'sSupPr':case 'sSubPr':case 'sSubSupPr':case 'fPr':case 'dPr':case 'radPr':case 'naryPr':case 'ctrlPr':case 'rPr':case 'accPr':case 'barPr':case 'funcPr':case 'limLowPr':case 'limUppPr':case 'mPr':case 'eqArrPr':case 'sPrePr':case 'groupChrPr':case 'borderBoxPr':case 'boxPr':case 'phantPr':case 'oMathParaPr':return document.createDocumentFragment();
      default:return arg(c,ctx);
    }
  }
  const root=el('tgm');
  root.style.cssText=`${R.fam?`font-family:${R.fam};`:''}${R.sz?`font-size:${R.sz.toFixed(2)}px;`:''}`;
  root.append(arg(node,{lvl:0}));
  return root;
}
