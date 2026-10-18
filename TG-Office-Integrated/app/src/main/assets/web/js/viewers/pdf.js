import {clamp} from '../utils.js';
const PDFJS_VERSION='6.3.289';
const PDFJS_BASE=new URL('vendor/pdfjs/',document.baseURI).href;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export class PdfViewer{
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
