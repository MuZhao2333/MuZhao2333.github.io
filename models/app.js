"use strict";
(() => {
  const $=id=>document.getElementById(id);
  const API=(window.MOLECULAR_DEMO_API_BASE||"").replace(/\/$/,"");
  const mode=document.body.dataset.experiment||"reconstruction";
  const state={mode,busy:false,connected:false,encoded:null,current:null,reconstruction:null,path:null,latent:null,models:[],viewers:{},style:"ballstick",selectedNode:null,playing:false,playTimer:null,focus:null,files:{a:"",b:""}};
  const examples={aspirin:"CC(=O)Oc1ccccc1C(=O)O",caffeine:"Cn1c(=O)c2c(ncn2C)n(C)c1=O",phenacetin:"CCOc1ccc(NC(C)=O)cc1"};
  const palette=["#6ae5d8","#b49aff","#f2c58a","#86adff","#f58db7","#92d69b","#d7a3fb","#71cbea","#e1b96f","#babef5"];
  const elementColors={H:"#cad8e9",C:"#bad0e9",N:"#83aaff",O:"#ff7c9b",F:"#6ae5bd",P:"#ffaf77",S:"#f5d474",Cl:"#6ae5bd",Br:"#d4946c",I:"#bd9aff"};
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const camera={homes:{},lastViews:{},muted:0,driver:'viewer-a',pose:{rotation:[0,0,0,1],pan:[0,0,0],distance:1}};

  function withCameraMuted(action) {
    camera.muted++;
    try{return action();}finally{camera.muted--;}
  }
  function rememberView(id,view) {
    camera.lastViews[id]=view.slice();
  }
  function cameraPose(id,view) {
    const home=camera.homes[id],v=state.viewers[id];
    return {rotation:view.slice(4,8),pan:view.slice(0,3).map((value,i)=>(value-home.center[i])/home.distance),
      distance:(v.CAMERA_Z-view[3])/home.distance};
  }
  function applyCamera(id,pose) {
    const home=camera.homes[id],v=state.viewers[id];if(!home)return;
    const view=[...home.center.map((value,i)=>value+pose.pan[i]*home.distance),
      v.CAMERA_Z-pose.distance*home.distance,...pose.rotation];
    v.setView(view);rememberView(id,view);
  }
  function cameraChanged(id,view) {
    const previous=camera.lastViews[id];rememberView(id,view);
    if(camera.muted||!camera.homes[id]||!$('sync-views').checked)return;
    // 3Dmol also calls this on hover and ordinary renders. Only a changed
    // camera should drive peers, otherwise rendering causes feedback loops.
    if(previous&&view.every((value,i)=>Math.abs(value-previous[i])<1e-10))return;
    camera.driver=id;camera.pose=cameraPose(id,view);
    withCameraMuted(()=>Object.keys(state.viewers).forEach(peer=>{if(peer!==id)applyCamera(peer,camera.pose);}));
  }
  function updateSpin() {
    Object.values(state.viewers).forEach(v=>v.spin(false));
    if(!$('auto-rotate').checked||document.hidden)return;
    const ready=Object.keys(state.viewers).filter(id=>camera.homes[id]);
    if($('sync-views').checked){
      const driver=ready.includes(camera.driver)?camera.driver:ready[0];
      if(driver)state.viewers[driver].spin('y',.45);
    }else ready.forEach(id=>state.viewers[id].spin('y',.45));
  }

  async function request(path,options={}) {
    if(location.protocol==="file:"&&!API)throw new Error("Open this demo through the running model server to connect to the trained checkpoints.");
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch(`${API}/api/${path}`,{...options,signal:controller.signal,headers:{"Content-Type":"application/json",...options.headers}});
      const data=await response.json();
      if(!response.ok)throw new Error(typeof data.detail==="string"?data.detail:`Request failed (${response.status}). Check the input and try again.`);
      return data;
    } finally {clearTimeout(timer);}
  }

  function showError(error) {$('error').textContent=error.message||String(error);$('error').hidden=false;}
  function controls() {
    $('experiment-controls').disabled=state.busy||!state.connected;
    document.querySelectorAll('[data-mode]').forEach(button=>{button.disabled=state.busy;});
    $('decode').disabled=!state.encoded;
    $('overlay').disabled=!state.current?.decoded||state.mode!=="reconstruction";
  }
  function invalidate() {
    state.encoded=null;
    $('decode').disabled=true;
    if(state.current||state.path)$('result-summary').textContent="Inputs changed — run again to update these results.";
  }
  function modelDescription() {
    $('model-description').textContent=$('model').value==="molalign3d"?
      "8 geometric nodes · 16 structural + 64 UniMol channels per node":
      "10 geometric nodes · 32 structural features per node · no external semantic conditioning";
    $('node-count').textContent=$('model').value==="molalign3d"?"8 global nodes":"10 global nodes";
  }
  function setMode(mode) {
    if(state.busy)return;
    state.mode=mode;
    const interpolate=mode==="interpolation";
    document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===mode)));
    for(const id of ['input-b','frames-field','alignment-field','view-card-b'])$(id).hidden=!interpolate;
    $('inputs').classList.toggle('paired',interpolate);
    $('viewer-grid').classList.toggle('four',interpolate);
    $('input-label-a').textContent=interpolate?"Endpoint A · SMILES":"Input molecule · SMILES";
    $('viewer-a-label').textContent=interpolate?"Endpoint A":"Input molecule";
    $('decoded-label').textContent=interpolate?"Decoded interpolation":"Decoded molecule";
    $('run').textContent=interpolate?"Encode endpoints + interpolate":"Encode + decode";
    $('encode-only').hidden=interpolate;
    $('decode').hidden=interpolate;
    $('frame-control').hidden=!interpolate||!state.path;
    $('download-path').hidden=!interpolate||!state.path;
    $('overlay').checked=false;
    if(!interpolate&&state.reconstruction)renderReconstruction(state.reconstruction);
    if(interpolate&&state.path)renderPath(state.path);
    invalidate();controls();resizeViewers();
  }

  function viewer(id) {
    if(!state.viewers[id]) {
      if(!window.$3Dmol)throw new Error("The 3D viewer could not be loaded. Reload this page.");
      $(id).replaceChildren();
      state.viewers[id]=$3Dmol.createViewer($(id),{backgroundColor:'#0b1627',backgroundAlpha:0,antialias:true,minimumZoomToDistance:id==='viewer-z'?1e-5:3});
      state.viewers[id].setProjection('orthographic');
      state.viewers[id].setViewChangeCallback(view=>cameraChanged(id,view));
      const activate=()=>{
        if(!camera.homes[id])return;
        camera.driver=id;
        if($('auto-rotate').checked)updateSpin();
      };
      $(id).addEventListener('pointerdown',activate);
      $(id).addEventListener('touchstart',activate,{passive:true});
    }
    const v=state.viewers[id];
    withCameraMuted(()=>{v.spin(false);v.removeAllModels();v.removeAllShapes();v.removeAllLabels();v.removeAllSurfaces();});
    return v;
  }
  function addMolecule(v,molecule,override) {
    if(!molecule)return;
    let model;
    if(molecule.molblock)model=v.addModel(molecule.molblock,'sdf');
    else {
      model=v.addModel();
      model.addAtoms(molecule.coordinates.map((point,i)=>({x:point[0],y:point[1],z:point[2],elem:element(molecule.atomic_numbers[i]),bonds:[],bondOrder:[]})));
    }
    const colorscheme={prop:'elem',map:elementColors};
    const style=state.style==='spacefill'?{sphere:{scale:.92,colorscheme}}:
      {stick:{radius:.15,colorscheme},sphere:{scale:.28,colorscheme}};
    model.setStyle({},override||style);
    if(state.style==='surface'&&!override) {
      const surface=v.addSurface($3Dmol.SurfaceType.VDW,{opacity:1,colorscheme},{});
      Promise.resolve(surface).then(()=>v.render()).catch(()=>showError(new Error('The molecular surface could not be rendered. Try Ball & stick.')));
    }
  }
  function finishViewer(v,previousView) {
    const id=Object.keys(state.viewers).find(id=>state.viewers[id]===v);
    withCameraMuted(()=>{
      v.resize();
      if(previousView)v.setView(previousView);
      else{
        v.zoomTo();v.zoom(1.18);
        const home=v.getView();camera.homes[id]={center:home.slice(0,3),distance:v.getPerceivedDistance()};
      }
      // Normalize zoom and pan to each scene's fitted extent. Molecules and
      // latent nodes can have very different coordinate ranges and centers.
      if($('sync-views').checked)applyCamera(id,camera.pose);
      v.render();rememberView(id,v.getView());
    });
    updateSpin();
  }
  function element(number) {
    return ({6:'C',7:'N',8:'O',9:'F',15:'P',16:'S',17:'Cl',35:'Br',53:'I'})[number]||'C';
  }
  function drawMolecule(id,molecule,preserve=false) {
    const previous=preserve&&state.viewers[id]?.getView();
    const v=viewer(id);addMolecule(v,molecule);finishViewer(v,previous);
  }
  function drawLatent(latent,preserve=false) {
    state.latent=latent;
    const previous=preserve&&state.viewers['viewer-z']?.getView();
    const v=viewer('viewer-z');
    const model=v.addModel();
    model.addAtoms(latent.positions.map((point,i)=>({x:point[0],y:point[1],z:point[2],elem:'C',serial:i+1,bonds:[],bondOrder:[]})));
    const distance=(a,b)=>Math.hypot(...a.map((value,j)=>value-b[j]));
    const pairs=latent.positions.flatMap((p,i)=>latent.positions.slice(i+1).map(q=>distance(p,q)));
    const extent=Math.max(...pairs,0),radius=extent>0?extent*.027:.02;
    if($('node-guides').checked) {
      const edges=new Set();
      latent.positions.forEach((p,i)=>{
        const nearest=latent.positions.map((q,j)=>({j,d:distance(p,q)})).filter(r=>r.j!==i).sort((a,b)=>a.d-b.d).slice(0,2);
        nearest.forEach(({j})=>edges.add([Math.min(i,j),Math.max(i,j)].join(':')));
      });
      edges.forEach(edge=>{
        const [a,b]=edge.split(':').map(Number),point=p=>({x:p[0],y:p[1],z:p[2]});
        v.addCylinder({start:point(latent.positions[a]),end:point(latent.positions[b]),radius:Math.max(extent*.0025,1e-6),color:'#425a7c',opacity:1,fromCap:1,toCap:1});
      });
    }
    latent.positions.forEach((point,i)=>{
      const color=palette[i%palette.length],selected=state.selectedNode===i;
      model.setStyle({index:i},{sphere:{radius:radius*(selected?1.28:1),color,opacity:state.selectedNode===null||selected?1:.48}});
      if(selected||state.selectedNode===null)v.addSphere({center:{x:point[0],y:point[1],z:point[2]},radius:radius*(selected?2.1:1.65),color,opacity:selected ? .16 : .07});
      if(selected)v.addLabel(`G${i+1}`,{position:{x:point[0],y:point[1],z:point[2]},fontSize:11,fontColor:color,backgroundColor:'#172336',backgroundOpacity:.85,borderThickness:0,inFront:true});
    });
    const labelNode=(atom,view)=>{
      view.removeAllLabels();view.addLabel(`G${atom.index+1}`,{position:{x:atom.x,y:atom.y,z:atom.z},fontSize:11,fontColor:palette[atom.index%palette.length],backgroundColor:'#172336',backgroundOpacity:.9,borderThickness:0,inFront:true});view.render();
    };
    model.setHoverable({},true,labelNode,(_atom,view)=>{view.removeAllLabels();view.render();});
    model.setClickable({},true,atom=>selectNode(atom.index));
    finishViewer(v,previous);
    $('viewer-z').setAttribute('aria-label',`${latent.positions.length} learned global nodes. Click a node to inspect its features. Lines are nearest-neighbor visual guides, not chemical bonds.`);
    $('node-count').textContent=`${latent.positions.length} global nodes`;
    $('latent-caption').textContent=`Zx span ${extent.toPrecision(3)} · closest pair ${Math.min(...pairs).toPrecision(3)}. Node guides are visual aids; coordinates are unchanged.`;
    buildNodeSelector();drawHeatmap();
  }
  function drawOutput(preserve=false) {
    const result=state.current;if(!result?.decoded)return;
    const previous=preserve&&state.viewers['viewer-out']?.getView();
    const v=viewer('viewer-out');
    if($('overlay').checked&&state.mode==='reconstruction') {
      const aligned={...result.decoded,molblock:result.decoded.aligned_molblock||result.decoded.molblock};
      addMolecule(v,result.input,{stick:{radius:.10,color:'#b49aff',opacity:.35},sphere:{scale:.19,color:'#b49aff',opacity:.24}});
      addMolecule(v,aligned,{stick:{radius:.16,color:'#6ae5d8'},sphere:{scale:.28,color:'#6ae5d8'}});
    } else addMolecule(v,result.decoded);
    finishViewer(v,previous);
  }
  function metrics(entries) {
    $('metrics').replaceChildren();
    for(const [label,value] of entries) {
      const item=document.createElement('span');item.textContent=label;
      const strong=document.createElement('strong');strong.textContent=value;
      item.append(strong);$('metrics').append(item);
    }
  }
  function outputCaption(decoded) {
    if(!decoded)return 'Encode complete. Decode the cached latent to reconstruct the molecule.';
    const validity=decoded.rdkit_valid?'RDKit sanitization passed':'RDKit sanitization failed';
    return `${decoded.smiles||'Raw predicted atoms'} · ${validity} · ${decoded.fragments} fragment${decoded.fragments===1?'':'s'}`;
  }
  function renderReconstruction(result) {
    stopPlayback();state.path=null;state.selectedNode=null;
    state.current=result;
    state.reconstruction=result;
    state.encoded=result.encoding_id;
    state.latent=result.latent;
    $('save-scene').disabled=false;
    $('input-atoms').textContent=`${result.input.atom_count} atoms`;
    $('input-smiles').textContent=`${result.input.smiles} · ${result.input.source}`;
    drawMolecule('viewer-a',result.input);drawLatent(result.latent);
    if(result.decoded) {
      drawOutput();$('decoded-atoms').textContent=`${result.decoded.atom_count} atoms`;
    } else if(state.viewers['viewer-out']) {
      const empty=viewer('viewer-out');empty.render();
      $('decoded-atoms').textContent='';
    }
    $('decoded-smiles').textContent=outputCaption(result.decoded);
    $('result-summary').textContent=`${result.model_name||result.model} · real checkpoint output`;
    const entries=[['Structural latent',result.latent.feature_shape.join(' × ')],['Decoder input',result.latent.decoder_shape.join(' × ')],['Encode',`${result.encode_seconds.toFixed(2)} s`]];
    if(result.decoded) {
      entries.push(['Decode',`${result.decode_seconds.toFixed(2)} s`]);
      entries.push(['Aligned RMSD',result.decoded.aligned_rmsd===null?'No graph correspondence':`${result.decoded.aligned_rmsd.toFixed(3)} Å`]);
    }
    metrics(entries);
    $('run-details').textContent=JSON.stringify({model:result.model,provenance:result.provenance,seed:result.seed,structural_shape:result.latent.feature_shape,decoder_shape:result.latent.decoder_shape,input_source:result.input.source,decoder_steps:result.decoded?.steps,encode_seconds:result.encode_seconds,decode_seconds:result.decode_seconds,rdkit_valid:result.decoded?.rdkit_valid,bond_perception_succeeded:result.decoded?.bond_perception_succeeded},null,2);
    $('download-sdf').disabled=!result.decoded?.molblock;
    $('download-latent').disabled=false;
    controls();
  }
  function renderPath(result) {
    stopPlayback();state.selectedNode=null;state.path=result;
    const first=result.a||result.input;
    $('input-atoms').textContent=`${first.atom_count} atoms`;
    $('input-smiles').textContent=first.smiles;
    drawMolecule('viewer-a',first);
    if(result.b){$('input-atoms-b').textContent=`${result.b.atom_count} atoms`;$('input-smiles-b').textContent=`${result.b.smiles} · ${result.alignment}`;drawMolecule('viewer-b',result.b);}
    $('frame-slider').max=String(result.frames.length-1);$('frame-slider').value='0';
    $('frame-control').hidden=false;$('download-path').hidden=false;
    $('result-summary').textContent=`${result.model_name} · ${result.frames.length} decoded frames · ${result.runtime_seconds.toFixed(2)} s`;
    $('run-details').textContent=JSON.stringify({model:result.model,provenance:result.provenance,seed:result.seed,steps:result.steps,frames:result.frames.length,alignment:result.alignment,sampling:result.sampling,space:result.space,step_size:result.step_size,runtime_seconds:result.runtime_seconds},null,2);
    $('sequence-start').textContent=result.frames[0].label;
    $('sequence-end').textContent=result.frames.at(-1).label;
    buildFrameStrip();$('save-scene').disabled=false;
    showFrame(false);
  }
  function showFrame(preserve=true) {
    if(!state.path)return;
    const frame=state.path.frames[Number($('frame-slider').value)];
    $('alpha').value=frame.label;
    state.current={model:state.path.model,input:state.path.a||state.path.input,decoded:frame.decoded,latent:frame.latent};
    drawLatent(frame.latent,preserve);drawOutput(preserve);updateFrameStrip();
    $('decoded-atoms').textContent=`${frame.decoded.atom_count} atoms`;
    $('decoded-smiles').textContent=outputCaption(frame.decoded);
    metrics([['Frame',frame.label],['Output atoms',String(frame.decoded.predicted_atom_count)],['Structural latent',frame.latent.feature_shape.join(' × ')],['RDKit sanitization',frame.decoded.rdkit_valid?'Passed':'Failed']]);
    $('download-sdf').disabled=!frame.decoded.molblock;$('download-latent').disabled=false;
  }

  function matrixScale(matrix) {
    const kind=$('feature-kind').value;
    const matrices=state.path?.frames.map(f=>f.latent[kind])||[matrix];
    return Math.max(...matrices.flat(2).map(Math.abs),1e-9);
  }
  function drawHeatmap() {
    const matrix=state.latent?.[$('feature-kind').value];if(!matrix)return;
    const canvas=$('heatmap'),width=Math.round(canvas.getBoundingClientRect().width),height=224;
    if(!width)return;
    const dpr=window.devicePixelRatio||1;canvas.width=Math.round(width*dpr);canvas.height=height*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
    const left=35,right=12,top=22,bottom=26,cw=(width-left-right)/matrix[0].length,ch=(height-top-bottom)/matrix.length,max=matrixScale(matrix);
    matrix.forEach((row,i)=>row.forEach((value,j)=>{
      const amount=Math.min(1,Math.abs(value)/max),target=value<0?[85,213,210]:[180,153,248],base=[15,29,48];
      ctx.fillStyle=`rgb(${target.map((v,k)=>Math.round(base[k]+(v-base[k])*amount)).join(',')})`;
      ctx.globalAlpha=state.selectedNode===null||state.selectedNode===i?1:.35;
      ctx.fillRect(left+j*cw+.5,top+i*ch+.5,Math.max(.5,cw-1),Math.max(1,ch-1));
    }));ctx.globalAlpha=1;
    if(state.selectedNode!==null){ctx.strokeStyle=palette[state.selectedNode%palette.length];ctx.lineWidth=1;ctx.strokeRect(left-.5,top+state.selectedNode*ch-.5,width-left-right+1,ch+1);}
    ctx.font='9px monospace';ctx.fillStyle='#718bab';ctx.textAlign='right';
    matrix.forEach((_,i)=>ctx.fillText(`G${i+1}`,left-7,top+(i+.6)*ch));
    const structural=state.latent.feature_shape[1];
    if(matrix[0].length>structural){const x=left+structural*cw;ctx.strokeStyle='#b49aff88';ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(x,top-4);ctx.lineTo(x,height-bottom+3);ctx.stroke();ctx.setLineDash([]);ctx.font='8px monospace';ctx.textAlign='left';ctx.fillStyle='#b49aff';ctx.fillText('Zh',left,12);ctx.fillStyle='#7c9ba9';ctx.fillText('UniMol',x+5,12);}
    ctx.textAlign='left';ctx.fillText('1',left,height-8);ctx.textAlign='right';ctx.fillText(String(matrix[0].length),width-right,height-8);ctx.textAlign='center';ctx.fillStyle='#657f9e';ctx.fillText('FEATURE CHANNEL',(left+width-right)/2,height-8);
    $('heatmap-empty').hidden=true;
    $('feature-shape').textContent=`${matrix.length} × ${matrix[0].length} · ±${max.toPrecision(3)}${state.path?' · fixed scale across frames':''}`;
    canvas.setAttribute('aria-label',`${matrix.length} global nodes by ${matrix[0].length} channels. Cyan is negative, violet is positive. Click a row to select a node; arrow keys inspect values.`);
    drawProfile();
  }
  function buildNodeSelector() {
    const container=$('node-selector'),count=state.latent.positions.length;
    if(state.selectedNode>=count)state.selectedNode=null;
    if(container.children.length!==count+1){
      container.replaceChildren();
      for(let i=-1;i<count;i++){
        const button=document.createElement('button');button.type='button';button.textContent=i<0?'All nodes':`G${i+1}`;
        button.style.setProperty('--node-color',palette[i%palette.length]);button.addEventListener('click',()=>selectNode(i<0?null:i));container.append(button);
      }
    }
    Array.from(container.children).forEach((button,i)=>button.setAttribute('aria-pressed',String(i===0?state.selectedNode===null:state.selectedNode===i-1)));
  }
  function selectNode(index) {
    state.selectedNode=index===state.selectedNode?null:index;
    if(state.latent)drawLatent(state.latent,true);
  }
  function drawProfile() {
    const matrix=state.latent?.[$('feature-kind').value];if(!matrix)return;
    const row=state.selectedNode===null?matrix[0].map((_,j)=>matrix.reduce((sum,r)=>sum+r[j],0)/matrix.length):matrix[state.selectedNode];
    const canvas=$('feature-profile'),width=Math.round(canvas.getBoundingClientRect().width),height=92;if(!width)return;
    const dpr=window.devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const max=matrixScale(matrix),left=35,right=12,top=11,bottom=18;
    const x=i=>left+i*(width-left-right)/Math.max(1,row.length-1),y=v=>top+(height-top-bottom)*(1-v/max)/2,zero=y(0);
    ctx.strokeStyle='#2c4059';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(left,zero);ctx.lineTo(width-right,zero);ctx.stroke();ctx.setLineDash([]);
    const color=state.selectedNode===null?'#6ae5d8':palette[state.selectedNode%palette.length];
    ctx.beginPath();ctx.moveTo(x(0),zero);row.forEach((v,i)=>ctx.lineTo(x(i),y(v)));ctx.lineTo(x(row.length-1),zero);ctx.closePath();
    const gradient=ctx.createLinearGradient(0,top,0,height-bottom);gradient.addColorStop(0,color+'45');gradient.addColorStop(1,color+'05');ctx.fillStyle=gradient;ctx.fill();
    ctx.beginPath();row.forEach((v,i)=>i?ctx.lineTo(x(i),y(v)):ctx.moveTo(x(i),y(v)));ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle='#526f90';ctx.font='8px monospace';ctx.textAlign='right';ctx.fillText('0',left-8,zero+3);ctx.fillText('+',left-8,top+3);ctx.fillText('−',left-8,height-bottom);ctx.textAlign='left';ctx.fillText('1',left,height-3);ctx.textAlign='right';ctx.fillText(String(row.length),width-right,height-3);
    $('profile-title').textContent=state.selectedNode===null?'Feature profile · mean across nodes':`Feature profile · G${state.selectedNode+1}`;
    const rms=Math.sqrt(row.reduce((sum,value)=>sum+value*value,0)/row.length);$('profile-note').textContent=`RMS ${rms.toPrecision(3)} · ${row.length} channels`;
    canvas.setAttribute('aria-label',`${$('profile-title').textContent}. Root mean square ${rms.toPrecision(3)}.`);
  }
  function heatmapCell(event) {
    const matrix=state.latent?.[$('feature-kind').value];if(!matrix)return null;
    const rect=$('heatmap').getBoundingClientRect();
    const column=Math.floor((event.clientX-rect.left-35)/(rect.width-47)*matrix[0].length),row=Math.floor((event.clientY-rect.top-22)/176*matrix.length);
    return row>=0&&row<matrix.length&&column>=0&&column<matrix[0].length?{row,column,matrix}:null;
  }
  $('heatmap').addEventListener('pointermove',event=>{const cell=heatmapCell(event);if(cell)$('feature-value').value=`G${cell.row+1} / ch ${cell.column+1} = ${cell.matrix[cell.row][cell.column].toFixed(5)}`;});
  $('heatmap').addEventListener('click',event=>{const cell=heatmapCell(event);if(cell)selectNode(cell.row);});
  $('heatmap').addEventListener('keydown',event=>{
    const matrix=state.latent?.[$('feature-kind').value];if(!matrix)return;
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(event.key))return;
    event.preventDefault();let row=state.selectedNode??0,col=state.keyboardChannel??0;
    if(event.key==='ArrowDown')row=Math.min(matrix.length-1,row+1);if(event.key==='ArrowUp')row=Math.max(0,row-1);
    if(event.key==='ArrowRight')col=Math.min(matrix[0].length-1,col+1);if(event.key==='ArrowLeft')col=Math.max(0,col-1);
    state.keyboardChannel=col;state.selectedNode=row;drawLatent(state.latent,true);
    $('feature-value').value=`G${row+1} / ch ${col+1} = ${matrix[row][col].toFixed(5)}`;
  });

  async function moleculeInput(suffix) {
    if(state.files[suffix])return {smiles:'',molblock:state.files[suffix]};
    const smiles=$(`smiles-${suffix}`).value.trim();if(!smiles)throw new Error('Enter a SMILES string or upload a 3D molecule.');
    return {smiles,molblock:''};
  }
  async function run(operation) {
    if(state.busy||!state.connected)return;
    stopPlayback();document.body.classList.add('is-computing');
    state.busy=true;controls();$('error').hidden=true;$('job-status').hidden=false;$('job-progress').value=0;
    $('job-message').textContent='Submitting experiment…';
    const start=Date.now();const clock=setInterval(()=>{$('elapsed').textContent=`${((Date.now()-start)/1000).toFixed(1)} s`;},200);
    try {
      const common={model:$('model').value,steps:Number($('steps').value),seed:Number($('seed').value)};
      let payload;
      if(operation==='decode')payload={encoding_id:state.encoded,steps:common.steps,seed:common.seed};
      else if(operation==='interpolate'||operation==='swap'){
        payload={...common,a:await moleculeInput('a'),b:await moleculeInput('b'),align:$('align').checked};
        if(operation==='interpolate')payload.frames=Number($('frames').value);
      }
      else if(operation==='wander')payload={...common,...await moleculeInput('a'),frames:Number($('frames').value),step_size:Number($('step-size').value),space:$('walk-space').value};
      else if(operation==='atom-edit')payload={...common,...await moleculeInput('a'),radius:Number($('atom-radius').value)};
      else payload={...common,...await moleculeInput('a')};
      const {job_id}=await request(operation,{method:'POST',body:JSON.stringify(payload)});
      let job;
      do {
        await new Promise(resolve=>setTimeout(resolve,450));
        job=await request(`jobs/${job_id}`);
        $('job-message').textContent=job.message;$('job-progress').value=job.progress;
        if(Date.now()-start>600000)throw new Error('This request is taking too long. Reload to check the model service.');
      } while(job.status==='queued'||job.status==='running');
      if(job.status==='error')throw new Error(job.message);
      if(job.result.frames)renderPath(job.result);
      else {
        const result=operation==='decode'?{...state.current,...job.result}:job.result;
        renderReconstruction(result);
      }
    } catch(error){showError(error);$('job-message').textContent='Experiment did not complete.';}
    finally{clearInterval(clock);state.busy=false;document.body.classList.remove('is-computing');controls();}
  }
  function download(content,name,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('download-sdf').addEventListener('click',()=>download(`${state.current.decoded.molblock}\n$$$$\n`,`${state.current.model}-decoded.sdf`,'chemical/x-mdl-sdfile'));
  $('download-latent').addEventListener('click',()=>download(JSON.stringify({model:state.current.model,experiment:state.mode,provenance:state.current.provenance||state.path?.provenance,latent:state.latent},null,2),`${state.current.model}-latent.json`,'application/json'));
  $('download-path').addEventListener('click',()=>download(state.path.frames.map(frame=>`${frame.decoded.molblock}\n> <experiment_frame>\n${frame.label}\n\n$$$$\n`).join(''),`${state.path.model}-${state.path.kind}.sdf`,'chemical/x-mdl-sdfile'));
  $('overlay').addEventListener('change',()=>drawOutput(true));
  $('feature-kind').addEventListener('change',drawHeatmap);
  $('frame-slider').addEventListener('input',()=>{stopPlayback();showFrame();});
  function thumbnail(molecule) {
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 120 78');svg.setAttribute('aria-hidden','true');
    const coords=molecule.coordinates||[],numbers=molecule.atomic_numbers||[];if(!coords.length)return svg;
    const points=coords.map(p=>[.90*p[0]+.44*p[2],.90*p[1]-.2*p[2]]),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(95/Math.max(maxX-minX,.1),55/Math.max(maxY-minY,.1));
    const projected=points.map(p=>[60+(p[0]-(maxX+minX)/2)*scale,39-(p[1]-(maxY+minY)/2)*scale]);
    const lines=(molecule.molblock||'').split('\n'),atoms=parseInt(lines[3]?.slice(0,3)),bonds=parseInt(lines[3]?.slice(3,6));
    if(Number.isFinite(atoms)&&Number.isFinite(bonds))for(let k=0;k<bonds;k++){
      const line=lines[4+atoms+k]||'',a=Number(line.slice(0,3))-1,b=Number(line.slice(3,6))-1,order=Number(line.slice(6,9));
      if(!projected[a]||!projected[b])continue;
      const [p,q]=[projected[a],projected[b]],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy)||1;
      for(const offset of order===2?[-1,1]:order===3?[-1.6,0,1.6]:[0]){
        const edge=document.createElementNS(ns,'line');edge.setAttribute('x1',p[0]-offset*dy/length);edge.setAttribute('y1',p[1]+offset*dx/length);edge.setAttribute('x2',q[0]-offset*dy/length);edge.setAttribute('y2',q[1]+offset*dx/length);edge.setAttribute('stroke','#7f99b6');edge.setAttribute('stroke-width','1.3');edge.setAttribute('stroke-linecap','round');svg.append(edge);
      }
    }
    projected.forEach((point,i)=>{const circle=document.createElementNS(ns,'circle');circle.setAttribute('cx',point[0]);circle.setAttribute('cy',point[1]);circle.setAttribute('r',numbers[i]===6?'2.7':'3.3');circle.setAttribute('fill',elementColors[element(numbers[i])]||'#cad8e9');svg.append(circle);});
    return svg;
  }
  function buildFrameStrip() {
    const strip=$('frame-strip');strip.replaceChildren();
    state.path.frames.forEach((frame,i)=>{
      const button=document.createElement('button');button.type='button';button.className='frame-tile';button.dataset.valid=String(frame.decoded.rdkit_valid);button.setAttribute('aria-label',`${frame.label}, ${frame.decoded.predicted_atom_count} atoms. RDKit sanitization ${frame.decoded.rdkit_valid?'passed':'failed'}.`);
      button.append(thumbnail(frame.decoded));
      const caption=document.createElement('span'),label=document.createElement('span'),count=document.createElement('small');label.textContent=frame.label;count.textContent=`${frame.decoded.predicted_atom_count} atoms`;caption.append(label,count);button.append(caption);
      button.addEventListener('click',()=>{stopPlayback();$('frame-slider').value=String(i);showFrame();});strip.append(button);
    });
  }
  function updateFrameStrip() {
    const index=Number($('frame-slider').value),strip=$('frame-strip');
    Array.from(strip.children).forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));
    const tile=strip.children[index];if(!tile)return;
    const left=tile.offsetLeft-strip.firstElementChild.offsetLeft;
    if(left<strip.scrollLeft||left+tile.offsetWidth>strip.scrollLeft+strip.clientWidth)strip.scrollTo({left:Math.max(0,left-strip.clientWidth/2+tile.offsetWidth/2),behavior:reducedMotion?'instant':'smooth'});
  }
  function stopPlayback() {
    clearInterval(state.playTimer);state.playTimer=null;state.playing=false;
    $('play-frames').textContent='▶ Play';$('play-frames').setAttribute('aria-label','Play sequence');$('play-frames').setAttribute('aria-pressed','false');
  }
  function playFrames() {
    if(!state.path||state.busy)return;
    state.playing=true;$('play-frames').textContent='Ⅱ Pause';$('play-frames').setAttribute('aria-label','Pause sequence');$('play-frames').setAttribute('aria-pressed','true');
    clearInterval(state.playTimer);
    state.playTimer=setInterval(()=>{
      $('frame-slider').value=String((Number($('frame-slider').value)+1)%state.path.frames.length);showFrame();
    },Number($('playback-speed').value));
  }
  $('play-frames').addEventListener('click',()=>state.playing?stopPlayback():playFrames());
  $('playback-speed').addEventListener('change',()=>{if(state.playing)playFrames();});
  for(const [id,delta] of [['previous-frame',-1],['next-frame',1]])$(id).addEventListener('click',()=>{
    if(!state.path)return;stopPlayback();const count=state.path.frames.length;
    $('frame-slider').value=String((Number($('frame-slider').value)+delta+count)%count);showFrame();
  });
  document.querySelectorAll('[data-style]').forEach(button=>button.addEventListener('click',()=>{
    state.style=button.dataset.style;document.querySelectorAll('[data-style]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    if(state.current?.input)drawMolecule('viewer-a',state.current.input,true);
    if(state.path?.b)drawMolecule('viewer-b',state.path.b,true);
    drawOutput(true);
  }));
  $('auto-rotate').addEventListener('change',updateSpin);
  $('sync-views').addEventListener('change',()=>{
    if($('sync-views').checked){
      const id=camera.homes[camera.driver]?camera.driver:Object.keys(camera.homes)[0];
      if(id){
        camera.pose=cameraPose(id,state.viewers[id].getView());
        withCameraMuted(()=>Object.keys(state.viewers).forEach(peer=>applyCamera(peer,camera.pose)));
      }
    }
    updateSpin();
  });
  $('node-guides').addEventListener('change',()=>{if(state.latent)drawLatent(state.latent,true);});
  $('reset-view').addEventListener('click',()=>{
    camera.pose={rotation:[0,0,0,1],pan:[0,0,0],distance:1};
    withCameraMuted(()=>Object.entries(state.viewers).forEach(([id,v])=>{
      if(camera.homes[id])applyCamera(id,camera.pose);
    }));
    updateSpin();
  });
  document.querySelectorAll('[data-focus]').forEach(button=>button.addEventListener('click',()=>{
    state.focus=state.focus===button.dataset.focus?null:button.dataset.focus;
    $('viewer-grid').classList.toggle('focused',!!state.focus);
    document.querySelectorAll('.view-card').forEach(card=>card.classList.toggle('is-focused',card.dataset.view===state.focus));
    document.querySelectorAll('[data-focus]').forEach(b=>{const active=b.dataset.focus===state.focus;b.setAttribute('aria-pressed',String(active));b.textContent=active?'↙':'⤢';});
    resizeViewers();
  }));
  $('save-scene').addEventListener('click',()=>{
    const focused=state.focus==='viewer-out'&&!state.current?.decoded?null:state.focus;
    const id=focused||(state.current?.decoded?'viewer-out':'viewer-a'),v=state.viewers[id];if(!v)return;
    v.render();const a=document.createElement('a');a.href=v.pngURI();a.download=`${state.current?.model||'molecule'}-${id}.png`;a.click();
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)stopPlayback();
    updateSpin();
  });

  const operations={reconstruction:'reconstruct',interpolation:'interpolate',wander:'wander','atom-edit':'atom-edit',swap:'swap'};
  $('run').addEventListener('click',()=>run(operations[state.mode]));
  $('encode-only').addEventListener('click',()=>run('encode'));
  $('decode').addEventListener('click',()=>run('decode'));
  document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>setMode(button.dataset.mode)));
  document.querySelectorAll('[data-example]').forEach(button=>button.addEventListener('click',()=>{
    $('smiles-a').value=examples[button.dataset.example];state.files.a='';$('sdf-a').value='';$('file-name-a').textContent='No file selected';$('clear-file-a').hidden=true;invalidate();
  }));
  for(const suffix of ['a','b']) {
    $(`smiles-${suffix}`).addEventListener('input',invalidate);
    $(`sdf-${suffix}`).addEventListener('change',async()=>{
      const file=$(`sdf-${suffix}`).files[0];if(!file)return;
      if(file.size>200000){showError(new Error('Please upload a file smaller than 200 KB.'));$(`sdf-${suffix}`).value='';return;}
      state.files[suffix]=await file.text();$(`file-name-${suffix}`).textContent=`${file.name} · first molecule`;$(`clear-file-${suffix}`).hidden=false;invalidate();
    });
    $(`clear-file-${suffix}`).addEventListener('click',()=>{state.files[suffix]='';$(`sdf-${suffix}`).value='';$(`file-name-${suffix}`).textContent='No file selected';$(`clear-file-${suffix}`).hidden=true;invalidate();});
  }
  $('model').addEventListener('change',()=>{modelDescription();invalidate();});
  modelDescription();
  function resizeViewers() {
    withCameraMuted(()=>Object.entries(state.viewers).forEach(([id,v])=>{
      if($(id).offsetWidth){v.resize();v.render();rememberView(id,v.getView());}
    }));drawHeatmap();
  }
  window.addEventListener('resize',resizeViewers);
  if('ResizeObserver' in window)new ResizeObserver(resizeViewers).observe($('viewer-grid'));
  request('models').then(data=>{
    state.models=data.models;state.connected=true;$('connection').textContent='Model service connected · real checkpoint inference';$('connection').className='connection connected';controls();
  }).catch(error=>{$('connection').textContent='Model service unavailable';$('connection').className='connection failed';showError(error);});
})();
