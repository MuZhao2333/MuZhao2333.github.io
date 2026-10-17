"use strict";
(async()=>{
  const container=document.getElementById('lab-preview'),button=document.getElementById('preview-rotate');
  let viewer,rotating=!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function updateRotation(){if(!viewer)return;viewer.spin(rotating&&!document.hidden?'y':false,.35);button.setAttribute('aria-pressed',String(rotating));button.setAttribute('aria-label',rotating?'Pause molecule rotation':'Rotate molecule');button.textContent=rotating?'Ⅱ':'▶';}
  button.addEventListener('click',()=>{rotating=!rotating;updateRotation();});
  document.addEventListener('visibilitychange',updateRotation);
  try{
    const response=await fetch('preview.json');if(!response.ok)throw new Error('Preview unavailable');const {molecule}=await response.json();
    viewer=$3Dmol.createViewer(container,{backgroundColor:'#080f1c',backgroundAlpha:0,antialias:true});viewer.setProjection('orthographic');
    const model=viewer.addModel(molecule.molblock,'sdf');const colorscheme={prop:'elem',map:{C:'#a0ded8',O:'#c2a3fa',N:'#91b2ff',H:'#d7e3ef'}};
    model.setStyle({},{stick:{radius:.17,colorscheme},sphere:{scale:.32,colorscheme}});viewer.zoomTo();viewer.zoom(1.08);viewer.render();updateRotation();
    new ResizeObserver(()=>{viewer.resize();viewer.render();}).observe(container);
  }catch(_error){button.hidden=true;container.textContent='Aspirin · C₉H₈O₄';container.classList.add('preview-unavailable');}
})();
