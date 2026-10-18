const DB='tg-office-v01',STORE='recent-files',MAX_RECENT=10,MAX_BYTES=35*1024*1024,MAX_PINNED=10;
function db(){return new Promise((res,rej)=>{const r=indexedDB.open(DB,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
const txReq=(mode,fn)=>db().then(database=>new Promise((res,rej)=>{const tx=database.transaction(STORE,mode),s=tx.objectStore(STORE),r=fn(s);tx.oncomplete=()=>res(r?.result);tx.onerror=()=>rej(tx.error)}));
async function listAll(){const arr=await txReq('readonly',s=>s.getAll())||[];return arr.sort((a,b)=>b.openedAt-a.openedAt)}
/* Riwayat menyimpan ALAMAT file (URI) bila TG Office punya izin baca permanen.
   Salinan file hanya disimpan untuk akses sementara (mis. file dari WhatsApp), total maks 60 MB. */
export async function saveRecent(file,type,meta={}){
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
export async function dropCopies(isPersisted){
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
export {MAX_TOTAL};
/* Pengaturan: buang salinan sementara. File berizin permanen tetap di riwayat (memakai alamatnya); sisanya dihapus dari riwayat. */
export async function clearCopies(){let n=0;for(const x of await listAll()){if(!x.blob)continue;n++;if(x.uri&&x.persist){x.blob=null;await txReq('readwrite',s=>s.put(x))}else await removeRecent(x.id)}return n}
export async function clearAllRecent(){for(const x of await listAll())await removeRecent(x.id)}
export async function storageUsed(){const all=await listAll();return all.reduce((n,x)=>n+(x.blob?.size||0),0)}
export async function updateRecentMeta(id,patch={}){if(!id)return false;const item=await getRecent(id);if(!item)return false;Object.assign(item,patch);await txReq('readwrite',s=>s.put(item));return true}
export async function listRecent(){return (await listAll()).filter(x=>!x.pinnedAt)}
export async function listPinned(){return (await listAll()).filter(x=>x.pinnedAt).sort((a,b)=>b.pinnedAt-a.pinnedAt)}
export async function getRecent(id){return txReq('readonly',s=>s.get(id))}
export async function removeRecent(id){return txReq('readwrite',s=>s.delete(id))}
export async function clearRecent(){const all=await listAll();for(const item of all.filter(x=>!x.pinnedAt))await removeRecent(item.id)}
export async function pinRecent(id){const item=await getRecent(id);if(!item)return{ok:false,reason:'missing'};if(item.pinnedAt)return{ok:true,pinned:true};const pins=await listPinned();if(pins.length>=MAX_PINNED)return{ok:false,reason:'limit'};item.pinnedAt=Date.now();await txReq('readwrite',s=>s.put(item));return{ok:true,pinned:true}}
export async function unpinRecent(id){const item=await getRecent(id);if(!item)return{ok:false,reason:'missing'};item.pinnedAt=null;await txReq('readwrite',s=>s.put(item));return{ok:true,pinned:false}}
export async function isPinned(id){const item=await getRecent(id);return !!item?.pinnedAt}
export {MAX_PINNED};
