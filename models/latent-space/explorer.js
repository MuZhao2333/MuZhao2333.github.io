"use strict";
(()=>{
  const $=id=>document.getElementById(id),lab=window.MolecularLab;
  const state={catalog:null,source:null,customId:null,result:null,frame:0,hover:null,zoom:1,center:[0,0],transform:null,loadToken:0,loading:true};
  const canvas=$('latent-map'),ctx=canvas.getContext('2d');
  const signed=n=>(n>=0?'+':'')+n.toFixed(2),pointText=p=>`${signed(p[0])}, ${signed(p[1])} σ`;
  function vector(){const angle=Number($('nav-angle').value)*Math.PI/180,d=Number($('nav-distance').value);return [Math.cos(angle)*d,Math.sin(angle)*d];}
  function controls(){
    $('run').disabled=lab.busy||state.loading||!state.source;
    for(const id of ['atlas-source','atlas-target','atlas-search','nav-angle','nav-distance'])$(id).disabled=lab.busy||state.loading;
  }
  function selectedPoint(){return state.source;}
  function updateDirection(resetResult=true){
    const angle=Number($('nav-angle').value),d=Number($('nav-distance').value),delta=vector();
    $('angle-value').textContent=`${angle}°`;$('distance-value').textContent=`${d.toFixed(2)} σ`;
    $('compass-arrow').style.transform=`rotate(${-angle}deg)`;
    $('nav-vector').textContent=`ΔPC1 ${signed(delta[0])} σ · ΔPC2 ${signed(delta[1])} σ`;
    $('position-move').textContent=`${angle}° · ${d.toFixed(2)} σ`;
    if(state.source){$('position-start').textContent=pointText(state.source.position);$('position-target').textContent=pointText(state.source.position.map((v,i)=>v+delta[i]));}
    if(resetResult){state.result=null;lab.clearSequence();$('map-neighbors').replaceChildren();}
    draw();
  }
  function aim(position){
    if(!state.source||lab.busy)return;
    const delta=position.map((v,i)=>v-state.source.position[i]),distance=Math.hypot(...delta),limited=Math.min(3,distance);
    $('nav-angle').value=String(Math.round((Math.atan2(delta[1],delta[0])*180/Math.PI+360)%360)%360);
    $('nav-distance').value=String(Math.round(limited*20)/20);
    $('target-note').textContent=distance>3?'The target is more than 3 σ away. This path moves 3 σ toward it.':'';
    updateDirection();
  }
  function updateSelected(point){
    state.source=point;
    $('selected-name').textContent=point.name;
    $('selected-properties').textContent=[point.formula,`${point.atom_count} heavy atoms`,point.qed===undefined?'':`QED ${point.qed.toFixed(2)}`].filter(Boolean).join(' · ');
    $('selected-smiles').textContent=point.smiles||'';
    $('atlas-source').value=point.id;
    $('target-note').textContent='';$('atlas-target').value='';
    updateDirection();controls();
  }
  async function choosePoint(point){
    if(lab.busy||state.loading)return;
    state.customId=null;updateSelected(point);
    await lab.run('latent-select',{point_id:point.id});
  }
  function populateSources(){
    if(!state.catalog)return;
    const query=$('atlas-search').value.toLowerCase(),current=state.source?.id;
    const points=state.catalog.points.filter(p=>`${p.name} ${p.formula} ${p.smiles}`.toLowerCase().includes(query));
    $('atlas-source').replaceChildren();
    for(const p of points){const option=new Option(p.name,p.id);$('atlas-source').add(option);}
    if(points.some(p=>p.id===current))$('atlas-source').value=current;
    if(!points.length)$('atlas-source').add(new Option('No matching molecules',''));
  }
  async function loadMap(){
    const token=++state.loadToken;state.loading=true;state.source=null;state.result=null;state.customId=null;state.catalog=null;controls();
    $('selected-name').textContent='Loading map…';$('selected-preview').replaceChildren();$('selected-properties').textContent='';$('selected-smiles').textContent='';
    $('map-loading').hidden=false;$('map-loading').textContent='Loading encoded molecules…';
    $('map-neighbors').replaceChildren();$('atlas-search').value='';
    try{
      const response=await fetch(`${lab.model}.json?v=20261017-atlas`);if(!response.ok)throw new Error('This model map could not be loaded.');
      const data=await response.json();if(token!==state.loadToken)return;
      if(data.model!==lab.model)throw new Error('The selected model and map do not match.');
      state.catalog=data;state.loading=false;state.zoom=1;state.center=[0,0];
      $('map-loading').hidden=true;$('map-count').textContent=`${data.count} molecules · ${data.source.zinc_count} ZINC + ${data.source.named_count} named references`;
      const ratios=data.projection.explained_variance_ratio;
      $('map-projection').textContent=`PC1 ${(ratios[0]*100).toFixed(1)}% · PC2 ${(ratios[1]*100).toFixed(1)}% · ${((ratios[0]+ratios[1])*100).toFixed(1)}% of structural Zh variance shown. Axes are in standard deviations (σ).`;
      $('atlas-target').replaceChildren(new Option('Choose a target molecule…',''));
      for(const p of data.points)$('atlas-target').add(new Option(p.name,p.id));
      populateSources();draw();controls();
      await choosePoint(data.points.find(p=>p.name==='Caffeine')||data.points[0]);
    }catch(error){if(token===state.loadToken){state.loading=false;$('map-loading').textContent=error.message;lab.showError(error);controls();}}
  }
  function color(value){
    const name=$('map-color').value,values=state.catalog.points.map(p=>p[name]),min=Math.min(...values),max=Math.max(...values),t=Math.max(0,Math.min(1,(value-min)/(max-min||1)));
    const a=[100,225,207],b=[185,148,255];return `rgb(${a.map((v,i)=>Math.round(v+(b[i]-v)*t)).join(',')})`;
  }
  function draw(){
    const width=Math.round(canvas.getBoundingClientRect().width),height=Math.round(canvas.getBoundingClientRect().height);if(!width||!height)return;
    const dpr=window.devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    if(!state.catalog)return;
    const pad={l:48,r:20,t:28,b:43};
    const positions=state.catalog.points.map(p=>p.position);
    if(state.source){positions.push(state.source.position);positions.push(state.source.position.map((v,i)=>v+vector()[i]));}
    if(state.result)for(const frame of state.result.frames){positions.push(frame.map_position);if(frame.decoded_map_position)positions.push(frame.decoded_map_position);}
    const bounds=[0,1].map(i=>[Math.min(...positions.map(p=>p[i]))-.45,Math.max(...positions.map(p=>p[i]))+.45]);
    const xMid=(bounds[0][0]+bounds[0][1])/2+state.center[0],yMid=(bounds[1][0]+bounds[1][1])/2+state.center[1];
    const scaleX=(width-pad.l-pad.r)/(bounds[0][1]-bounds[0][0])*state.zoom,scaleY=(height-pad.t-pad.b)/(bounds[1][1]-bounds[1][0])*state.zoom;
    const x=v=>(width+pad.l-pad.r)/2+(v-xMid)*scaleX,y=v=>(height+pad.t-pad.b)/2-(v-yMid)*scaleY;
    state.transform={x,y,invert:(px,py)=>[xMid+(px-(width+pad.l-pad.r)/2)/scaleX,yMid-(py-(height+pad.t-pad.b)/2)/scaleY]};
    ctx.save();ctx.beginPath();ctx.rect(pad.l,pad.t,width-pad.l-pad.r,height-pad.t-pad.b);ctx.clip();
    const min=state.transform.invert(pad.l,height-pad.b),max=state.transform.invert(width-pad.r,pad.t);
    ctx.lineWidth=1;ctx.font='9px monospace';
    const tick=state.zoom>2?.5:1;
    for(let value=Math.ceil(min[0]/tick)*tick;value<=max[0];value+=tick){ctx.strokeStyle=Math.abs(value)<.001?'#3b5876':'#21364d';ctx.beginPath();ctx.moveTo(x(value),pad.t);ctx.lineTo(x(value),height-pad.b);ctx.stroke();}
    for(let value=Math.ceil(min[1]/tick)*tick;value<=max[1];value+=tick){ctx.strokeStyle=Math.abs(value)<.001?'#3b5876':'#21364d';ctx.beginPath();ctx.moveTo(pad.l,y(value));ctx.lineTo(width-pad.r,y(value));ctx.stroke();}
    const field=$('map-color').value;
    for(const point of state.catalog.points){const [px,py]=point.position,selected=point.id===state.source?.id,hovered=point.id===state.hover?.id;
      ctx.beginPath();ctx.arc(x(px),y(py),selected?6:hovered?5:3.5,0,Math.PI*2);ctx.fillStyle=color(point[field]);ctx.globalAlpha=selected||hovered?1:.72;ctx.fill();ctx.globalAlpha=1;
    }
    if(state.source){
      const source=state.source.position,delta=vector(),target=source.map((v,i)=>v+delta[i]),sx=x(source[0]),sy=y(source[1]),tx=x(target[0]),ty=y(target[1]);
      ctx.beginPath();ctx.arc(sx,sy,10,0,Math.PI*2);ctx.strokeStyle='#dcfcf5';ctx.lineWidth=1.6;ctx.stroke();
      ctx.strokeStyle='#f2c58a';ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);ctx.stroke();ctx.setLineDash([]);
      const angle=Math.atan2(ty-sy,tx-sx);ctx.fillStyle='#f2c58a';ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-9*Math.cos(angle-.45),ty-9*Math.sin(angle-.45));ctx.lineTo(tx-9*Math.cos(angle+.45),ty-9*Math.sin(angle+.45));ctx.closePath();ctx.fill();
      ctx.beginPath();ctx.arc(tx,ty,7,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#b8d9df';ctx.font='10px sans-serif';ctx.fillText(state.source.name,x(source[0])+13,y(source[1])-12);
    }
    if(state.result){
      const frame=state.result.frames[state.frame],p=frame.map_position,decoded=frame.decoded_map_position;
      ctx.fillStyle='#f2c58a';ctx.beginPath();ctx.arc(x(p[0]),y(p[1]),5,0,Math.PI*2);ctx.fill();
      if(decoded){ctx.setLineDash([2,4]);ctx.strokeStyle='#f29bc4';ctx.beginPath();ctx.moveTo(x(p[0]),y(p[1]));ctx.lineTo(x(decoded[0]),y(decoded[1]));ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(x(decoded[0]),y(decoded[1]),6,0,Math.PI*2);ctx.stroke();}
    }
    ctx.restore();
    ctx.fillStyle='#829bbc';ctx.font='9px monospace';ctx.textAlign='center';
    for(let value=Math.ceil(min[0]/tick)*tick;value<=max[0];value+=tick)ctx.fillText(value.toFixed(tick===1?0:1),x(value),height-pad.b+17);
    ctx.textAlign='right';for(let value=Math.ceil(min[1]/tick)*tick;value<=max[1];value+=tick)ctx.fillText(value.toFixed(tick===1?0:1),pad.l-10,y(value)+3);
    ctx.fillStyle='#8db7bd';ctx.textAlign='center';ctx.fillText('PC1 / σ',(width+pad.l-pad.r)/2,height-7);
    ctx.save();ctx.translate(13,height/2);ctx.rotate(-Math.PI/2);ctx.fillText('PC2 / σ',0,0);ctx.restore();
    const vals=state.catalog.points.map(p=>p[field]);$('map-color-scale').textContent=`${Math.min(...vals).toFixed(field==='atom_count'?0:1)} → ${Math.max(...vals).toFixed(field==='atom_count'?0:1)} ${field==='atom_count'?'atoms':field==='qed'?'QED':'logP'}`;
  }
  function hit(event){
    if(!state.catalog||!state.transform)return null;
    const rect=canvas.getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;let best=null,distance=11;
    for(const point of state.catalog.points){const d=Math.hypot(state.transform.x(point.position[0])-mx,state.transform.y(point.position[1])-my);if(d<distance){distance=d;best=point;}}
    return best;
  }
  canvas.addEventListener('pointermove',event=>{
    if(lab.busy)return;
    state.hover=hit(event);const tooltip=$('map-tooltip');tooltip.hidden=!state.hover;
    if(state.hover){tooltip.replaceChildren();const title=document.createElement('strong'),text=document.createElement('span');title.textContent=state.hover.name;text.textContent=`${state.hover.formula} · ${state.hover.atom_count} atoms · ${pointText(state.hover.position)}`;tooltip.append(title,text);const rect=canvas.getBoundingClientRect();tooltip.style.left=Math.min(rect.width-220,Math.max(8,event.clientX-rect.left+15))+'px';tooltip.style.top=Math.max(5,event.clientY-rect.top-55)+'px';}
    canvas.style.cursor=state.hover?'pointer':'crosshair';draw();
  });
  canvas.addEventListener('pointerleave',()=>{state.hover=null;$('map-tooltip').hidden=true;draw();});
  canvas.addEventListener('click',event=>{
    if(lab.busy||!state.transform)return;
    const point=hit(event);if(point){choosePoint(point);return;}
    const rect=canvas.getBoundingClientRect();$('atlas-target').value='';aim(state.transform.invert(event.clientX-rect.left,event.clientY-rect.top));
  });
  canvas.addEventListener('wheel',event=>{if(!state.catalog)return;event.preventDefault();state.zoom=Math.max(.65,Math.min(4,state.zoom*Math.exp(-event.deltaY*.001)));draw();},{passive:false});
  canvas.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
    event.preventDefault();state.center[0]+=event.key==='ArrowRight'?.25:event.key==='ArrowLeft'?-.25:0;state.center[1]+=event.key==='ArrowUp'?.25:event.key==='ArrowDown'?-.25:0;draw();
  });
  $('map-reset').addEventListener('click',()=>{state.zoom=1;state.center=[0,0];draw();});
  $('map-color').addEventListener('change',draw);
  $('atlas-search').addEventListener('input',populateSources);
  $('atlas-source').addEventListener('change',()=>{const p=state.catalog.points.find(p=>p.id===$('atlas-source').value);if(p)choosePoint(p);});
  $('atlas-target').addEventListener('change',()=>{const p=state.catalog.points.find(p=>p.id===$('atlas-target').value);if(p)aim(p.position);});
  for(const id of ['nav-angle','nav-distance'])$(id).addEventListener('input',()=>{$('atlas-target').value='';$('target-note').textContent='';updateDirection();});
  document.addEventListener('latent-navigate-request',()=>{
    if(!state.source||!state.catalog)return;
    const [delta_x,delta_y]=vector();
    lab.run('latent-navigate',{point_id:state.customId?null:state.source.id,encoding_id:state.customId,
      map_version:state.catalog.version,delta_x,delta_y,frames:Number($('frames').value)});
  });
  document.addEventListener('molecular-result',event=>{
    if(['latent-select','latent-locate'].includes(event.detail.operation))$('selected-preview').replaceChildren(lab.thumbnail(event.detail.result.input));
    if(event.detail.operation==='latent-locate'){
      state.customId=event.detail.result.encoding_id;updateSelected(event.detail.result.atlas.point);
      $('atlas-source').add(new Option('Your molecule',state.customId));$('atlas-source').value=state.customId;draw();
    }
    if(event.detail.operation==='latent-navigate'){
      state.result=event.detail.result;state.frame=0;
      const container=$('map-neighbors');container.replaceChildren();const label=document.createElement('span');label.textContent='Near the requested endpoint in this 2D projection:';container.append(label);
      for(const p of state.result.navigation.nearest_in_projection.slice(0,3)){const b=document.createElement('button');b.type='button';b.textContent=`${p.name} · ${p.map_distance.toFixed(2)} σ`;b.addEventListener('click',()=>choosePoint(p));container.append(b);}
      draw();
    }
  });
  document.addEventListener('molecular-frame',event=>{if(event.detail.result.kind==='latent-navigation'){state.result=event.detail.result;state.frame=event.detail.index;draw();}});
  document.addEventListener('molecular-model',loadMap);
  document.addEventListener('molecular-controls',event=>{controls();if(event.detail.connected&&!state.catalog&&state.loading)loadMap();});
  new ResizeObserver(draw).observe(canvas);
  // The shared app may connect before this deferred controller is evaluated.
  if($('connection').classList.contains('connected'))loadMap();
})();
