/* QR Code kecil (mode byte, koreksi L, versi 1–5) untuk alamat Presentasi Nirkabel. Tanpa pustaka luar. */
const SPEC=[null,{t:26,e:7,a:[]},{t:44,e:10,a:[6,18]},{t:70,e:15,a:[6,22]},{t:100,e:20,a:[6,26]},{t:134,e:26,a:[6,30]}];
const EXP=new Uint8Array(512),LOG=new Uint8Array(256);
(()=>{let x=1;for(let i=0;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11d}for(let i=255;i<512;i++)EXP[i]=EXP[i-255]})();
const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
function rsGen(n){let g=[1];for(let i=0;i<n;i++){const ng=new Array(g.length+1).fill(0);for(let j=0;j<g.length;j++){ng[j]^=g[j];ng[j+1]^=mul(g[j],EXP[i])}g=ng}return g}
function rsEcc(data,n){const g=rsGen(n),r=new Array(n).fill(0);for(const d of data){const f=d^r[0];r.shift();r.push(0);for(let j=0;j<n;j++)r[j]^=mul(g[j+1],f)}return r}
export function qrMatrix(text){
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
export function qrSvg(text,px=180){
  const g=qrMatrix(text),n=g.length,q=4,s=n+q*2;let d='';
  g.forEach((row,r)=>row.forEach((x,c)=>{if(x)d+=`M${c+q} ${r+q}h1v1h-1z`}));
  return `<svg viewBox="0 0 ${s} ${s}" width="${px}" height="${px}" shape-rendering="crispEdges" role="img" aria-label="Kode QR"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
