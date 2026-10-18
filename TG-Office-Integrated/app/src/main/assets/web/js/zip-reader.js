const SIG_EOCD=0x06054b50,SIG_CEN=0x02014b50,SIG_LOC=0x04034b50;
const td=new TextDecoder('utf-8');
function u16(v,o){return v.getUint16(o,true)} function u32(v,o){return v.getUint32(o,true)}
async function inflateRaw(bytes){
  if(!('DecompressionStream' in globalThis)) throw new Error('Browser belum mendukung DecompressionStream. Gunakan Chrome/WebView modern.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export class ZipReader{
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
export async function openZip(buffer,opts){return new ZipReader(buffer,opts)}
