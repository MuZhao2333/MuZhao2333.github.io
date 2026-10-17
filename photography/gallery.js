"use strict";
(()=>{
  const $=id=>document.getElementById(id),items=Array.from(document.querySelectorAll('.photo'));
  const dialog=$('lightbox'),image=$('lightbox-image'),stage=$('lightbox-stage');
  let active=0,returnFocus=null,loadVersion=0,originalHash='',filter='all',zoomed=false,touchStart=null;
  const visible=()=>items.filter(item=>!item.hidden);
  function setFilter(value){
    filter=value;
    document.querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===value)));
    items.forEach(item=>{item.hidden=value!=='all'&&item.dataset.group!==value;});
    const count=visible().length;
    $('gallery-status').textContent=`${String(count).padStart(2,'0')} photographs · Select an image to view it in full.`;
    document.querySelector('.gallery').setAttribute('aria-label',`${value==='all'?'All':value==='color'?'Color':'Black and white'} photographs, ${count} works`);
  }
  function setZoom(value){
    zoomed=!!value;dialog.classList.toggle('is-zoomed',zoomed);
    $('zoom-photo').setAttribute('aria-pressed',String(zoomed));$('zoom-photo').textContent=zoomed?'Fit view':'Zoom in';
    image.setAttribute('aria-label',image.alt+' '+(zoomed?'Photograph at full image resolution. Click to fit the view.':'Photograph fitted to the screen. Click to enlarge.'));
    requestAnimationFrame(()=>{stage.scrollLeft=zoomed?Math.max(0,(image.offsetWidth-stage.clientWidth)/2):0;stage.scrollTop=zoomed?Math.max(0,(image.offsetHeight-stage.clientHeight)/2):0;});
  }
  function showPhoto(index){
    const list=visible(),item=list[(index+list.length)%list.length];if(!item)return;
    active=items.indexOf(item);const link=item.querySelector('a'),thumb=item.querySelector('img'),version=++loadVersion;
    setZoom(false);image.style.opacity='0';$('photo-status').hidden=false;$('photo-status').textContent='Loading photograph…';$('zoom-photo').disabled=true;
    $('photo-counter').textContent=`${String(list.indexOf(item)+1).padStart(2,'0')} / ${String(list.length).padStart(2,'0')}`;
    $('photo-description').textContent=thumb.alt;
    const capture=$('photo-capture'),capturedAt=item.dataset.capturedAt;
    const [captureDate,captureTime]=capturedAt?capturedAt.split('T'):[];
    capture.hidden=!capturedAt;
    capture.textContent=captureDate?`Taken · ${captureDate.replaceAll('-','.')}${captureTime?` · ${captureTime}`:''}`:'';
    if(capturedAt)capture.dateTime=capturedAt;
    else capture.removeAttribute('datetime');
    image.alt=thumb.alt;
    image.onload=()=>{if(version!==loadVersion)return;image.style.opacity='1';$('photo-status').hidden=true;$('zoom-photo').disabled=false;};
    image.onerror=()=>{if(version!==loadVersion)return;$('photo-status').textContent='This photograph could not load. Try the next image.';};
    image.src=link.href;
    history.replaceState(history.state,'',`#photo-${item.id.replace('photo-','')}`);
    // Only preload the adjacent full-size images after a visitor opens the viewer.
    for(const offset of [-1,1]){const neighbor=list[(list.indexOf(item)+offset+list.length)%list.length];const next=new Image();next.src=neighbor.querySelector('a').href;}
  }
  function open(item,trigger){
    if(!item)return;
    if(item.hidden)setFilter('all');
    if(!dialog.open){originalHash=location.hash;returnFocus=trigger||item.querySelector('a');dialog.showModal();document.body.classList.add('viewer-open');}
    showPhoto(visible().indexOf(item));
  }
  function move(delta){const list=visible(),index=list.indexOf(items[active]);showPhoto(index+delta);}
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>setFilter(button.dataset.filter)));
  document.querySelectorAll('[data-photo]').forEach(link=>link.addEventListener('click',event=>{
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();open(items.find(item=>item.id===`photo-${link.dataset.photo}`),link);
  }));
  $('close-lightbox').addEventListener('click',()=>dialog.close());
  $('previous-photo').addEventListener('click',()=>move(-1));$('next-photo').addEventListener('click',()=>move(1));
  $('zoom-photo').addEventListener('click',()=>setZoom(!zoomed));
  image.addEventListener('click',()=>{if(!image.complete||!image.naturalWidth)return;setZoom(!zoomed);});
  dialog.addEventListener('close',()=>{
    loadVersion++;document.body.classList.remove('viewer-open');setZoom(false);
    const target=originalHash.startsWith('#photo-')?'#gallery':originalHash;
    history.replaceState(history.state,'',location.pathname+location.search+target);
    if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  });
  dialog.addEventListener('keydown',event=>{
    if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();move(event.key==='ArrowRight'?1:-1);}
    if(event.key==='Home'||event.key==='End'){event.preventDefault();showPhoto(event.key==='Home'?0:visible().length-1);}
  });
  stage.addEventListener('touchstart',event=>{touchStart=event.touches.length===1?{x:event.touches[0].clientX,y:event.touches[0].clientY}:null;},{passive:true});
  stage.addEventListener('touchend',event=>{
    if(zoomed||!touchStart)return;
    const end=event.changedTouches[0],dx=end.clientX-touchStart.x,dy=end.clientY-touchStart.y;
    if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5)move(dx<0?1:-1);
    touchStart=null;
  },{passive:true});
  $('photo-filters').hidden=false;
  function openFromHash(){
    const item=items.find(item=>`#${item.id}`===location.hash);
    if(item)open(item);
  }
  window.addEventListener('hashchange',openFromHash);
  openFromHash();
})();
