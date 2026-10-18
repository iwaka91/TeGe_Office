export const qs = (s, root=document) => root.querySelector(s);
export const qsa = (s, root=document) => [...root.querySelectorAll(s)];
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export const formatBytes = bytes => {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const u=['KB','MB','GB']; let n=bytes/1024,i=0;
  while(n>=1024&&i<u.length-1){n/=1024;i++}
  return `${n.toFixed(n<10?1:0)} ${u[i]}`;
};
export const extOf = name => (name.split('.').pop()||'').toLowerCase();
export const basename = path => path.split('/').pop() || path;
export const dirname = path => path.includes('/') ? path.slice(0,path.lastIndexOf('/')+1) : '';
export function resolvePath(baseFile,target){
  if (!target) return '';
  if (/^[a-z]+:/i.test(target)) return target;
  if (target.startsWith('/')) return target.slice(1);
  const base=dirname(baseFile).split('/').filter(Boolean);
  const parts=target.split('/');
  for(const p of parts){if(!p||p==='.')continue;if(p==='..')base.pop();else base.push(p)}
  return base.join('/');
}
export const escapeHtml = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const colName = n => { let s=''; n++; while(n){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)} return s; };
export const cellToRC = ref => { const m=/^([A-Z]+)(\d+)$/i.exec(ref||''); if(!m)return null; let c=0; for(const ch of m[1].toUpperCase())c=c*26+ch.charCodeAt(0)-64; return {r:+m[2]-1,c:c-1}; };
export const xml = text => new DOMParser().parseFromString(text,'application/xml');
export const attr = (el, local, fallback=null) => {
  if(!el) return fallback;
  for(const a of el.attributes||[]) if(a.localName===local || a.name===local || a.name.endsWith(':'+local)) return a.value;
  return fallback;
};
export const childrenByLocal = (el,name) => [...(el?.children||[])].filter(x=>x.localName===name);
export const firstByLocal = (el,name) => [...(el?.getElementsByTagName('*')||[])].find(x=>x.localName===name)||null;
export const allByLocal = (el,name) => [...(el?.getElementsByTagName('*')||[])].filter(x=>x.localName===name);
export function colorFromFill(el, fallback='transparent'){
  if(!el) return fallback;
  const solid=[...el.getElementsByTagName('*')].find(x=>x.localName==='solidFill');
  if(!solid) return fallback;
  const rgb=[...solid.children].find(x=>x.localName==='srgbClr');
  const val=attr(rgb,'val'); return val?`#${val}`:fallback;
}
export function debounce(fn,ms=120){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
