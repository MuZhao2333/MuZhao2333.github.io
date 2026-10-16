"use strict";
(() => {
  const $=id=>document.getElementById(id);
  const API=(window.MOLECULAR_DEMO_API_BASE||"").replace(/\/$/,"");
  const state={mode:"reconstruction",busy:false,connected:false,encoded:null,current:null,reconstruction:null,path:null,latent:null,models:[],viewers:{},files:{a:"",b:""}};
  const examples={aspirin:"CC(=O)Oc1ccccc1C(=O)O",caffeine:"Cn1c(=O)c2c(ncn2C)n(C)c1=O",phenacetin:"CCOc1ccc(NC(C)=O)cc1"};
  const palette=["#2f6b91","#5e927e","#bc865b","#787f9f","#6b9da8","#a17d87","#7f9660","#b69d65","#6b8cbe","#9b8f79"];

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
      "10 geometric nodes · 128 structural features + 512 UniMol features per node":
      "10 geometric nodes · 32 structural features per node · no external semantic conditioning";
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
      state.viewers[id]=$3Dmol.createViewer($(id),{backgroundColor:"white",antialias:true});
    }
    const v=state.viewers[id];
    v.removeAllModels();v.removeAllShapes();v.removeAllLabels();
    return v;
  }
  function addMolecule(v,molecule,style={stick:{radius:.14},sphere:{scale:.23}}) {
    if(!molecule)return;
    let model;
    if(molecule.molblock)model=v.addModel(molecule.molblock,'sdf');
    else {
      model=v.addModel();
      model.addAtoms(molecule.coordinates.map((point,i)=>({x:point[0],y:point[1],z:point[2],elem:element(molecule.atomic_numbers[i]),bonds:[],bondOrder:[]})));
    }
    model.setStyle({},style);
  }
  function element(number) {
    return ({6:'C',7:'N',8:'O',9:'F',15:'P',16:'S',17:'Cl',35:'Br',53:'I'})[number]||'C';
  }
  function drawMolecule(id,molecule) {
    const v=viewer(id);addMolecule(v,molecule);v.zoomTo();v.resize();v.render();
  }
  function drawLatent(latent) {
    state.latent=latent;
    const v=viewer('viewer-z');
    const model=v.addModel();
    model.addAtoms(latent.positions.map((point,i)=>({x:point[0],y:point[1],z:point[2],elem:'C',serial:i+1,bonds:[],bondOrder:[]})));
    latent.positions.forEach((point,i)=>model.setStyle({index:i},{sphere:{radius:.4,color:palette[i%palette.length]}}));
    const labelNode=(atom,view)=>{
      view.removeAllLabels();
      view.addLabel(`G${atom.index+1}`,{position:{x:atom.x,y:atom.y,z:atom.z},fontSize:12,fontColor:'#547084',backgroundColor:'white',backgroundOpacity:.85,borderThickness:0,inFront:true});
      view.render();
    };
    model.setHoverable({},true,labelNode,(_atom,view)=>{view.removeAllLabels();view.render();});
    model.setClickable({},true,labelNode);
    v.zoomTo();v.zoom(.75);v.resize();v.render();
    $('viewer-z').setAttribute('aria-label',`${latent.positions.length} learned geometric global nodes. Structural feature shape ${latent.feature_shape.join(' by ')}.`);
    drawHeatmap();
  }
  function drawOutput() {
    const result=state.current;
    if(!result?.decoded)return;
    const v=viewer('viewer-out');
    if($('overlay').checked&&state.mode==='reconstruction') {
      const aligned={...result.decoded,molblock:result.decoded.aligned_molblock||result.decoded.molblock};
      addMolecule(v,result.input,{stick:{radius:.10,color:'#5d8fb5',opacity:.55},sphere:{scale:.17,color:'#5d8fb5',opacity:.35}});
      addMolecule(v,aligned,{stick:{radius:.15,color:'#ba8755'},sphere:{scale:.23,color:'#ba8755'}});
    } else addMolecule(v,result.decoded);
    v.zoomTo();v.resize();v.render();
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
    state.current=result;
    state.reconstruction=result;
    state.encoded=result.encoding_id;
    state.latent=result.latent;
    $('input-atoms').textContent=`${result.input.atom_count} atoms`;
    $('input-smiles').textContent=`${result.input.smiles} · ${result.input.source}`;
    drawMolecule('viewer-a',result.input);drawLatent(result.latent);
    if(result.decoded) {
      drawOutput();$('decoded-atoms').textContent=`${result.decoded.atom_count} atoms`;
    } else if(state.viewers['viewer-out']) {
      state.viewers['viewer-out'].removeAllModels();state.viewers['viewer-out'].render();
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
    $('run-details').textContent=JSON.stringify({model:result.model,checkpoint:state.models.find(m=>m.id===result.model)?.checkpoint,seed:result.seed,structural_shape:result.latent.feature_shape,decoder_shape:result.latent.decoder_shape,input_source:result.input.source,decoder_steps:result.decoded?.steps,encode_seconds:result.encode_seconds,decode_seconds:result.decode_seconds,rdkit_valid:result.decoded?.rdkit_valid,bond_perception_succeeded:result.decoded?.bond_perception_succeeded},null,2);
    $('download-sdf').disabled=!result.decoded?.molblock;
    $('download-latent').disabled=false;
    controls();
  }
  function renderPath(result) {
    state.path=result;
    $('input-atoms').textContent=`${result.a.atom_count} atoms`;
    $('input-atoms-b').textContent=`${result.b.atom_count} atoms`;
    $('input-smiles').textContent=result.a.smiles;
    $('input-smiles-b').textContent=`${result.b.smiles} · ${result.alignment}`;
    drawMolecule('viewer-a',result.a);drawMolecule('viewer-b',result.b);
    $('frame-slider').max=String(result.frames.length-1);$('frame-slider').value='0';
    $('frame-control').hidden=false;$('download-path').hidden=false;
    $('result-summary').textContent=`${result.model_name} · ${result.frames.length} decoded frames · ${result.runtime_seconds.toFixed(2)} s`;
    $('run-details').textContent=JSON.stringify({model:result.model,seed:result.seed,steps:result.steps,frames:result.frames.length,alignment:result.alignment,sampling:result.sampling,runtime_seconds:result.runtime_seconds},null,2);
    showFrame();
  }
  function showFrame() {
    if(!state.path)return;
    const frame=state.path.frames[Number($('frame-slider').value)];
    $('alpha').value=`t = ${frame.alpha.toFixed(2)}`;
    state.current={model:state.path.model,input:state.path.a,decoded:frame.decoded,latent:frame.latent};
    drawLatent(frame.latent);drawOutput();
    $('decoded-atoms').textContent=`${frame.decoded.atom_count} atoms`;
    $('decoded-smiles').textContent=outputCaption(frame.decoded);
    metrics([['t',frame.alpha.toFixed(2)],['Output atoms',String(frame.decoded.predicted_atom_count)],['Structural latent',frame.latent.feature_shape.join(' × ')],['RDKit sanitization',frame.decoded.rdkit_valid?'Passed':'Failed']]);
    $('download-sdf').disabled=!frame.decoded.molblock;$('download-latent').disabled=false;
  }

  function drawHeatmap() {
    const matrix=state.latent?.[$('feature-kind').value];
    if(!matrix)return;
    const canvas=$('heatmap');const width=Math.round(canvas.getBoundingClientRect().width);if(!width)return;
    const height=195,dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,width,height);
    const left=35,right=12,top=19,bottom=25;
    const cellWidth=(width-left-right)/matrix[0].length,cellHeight=(height-top-bottom)/matrix.length;
    const max=Math.max(...matrix.flat().map(Math.abs),1e-9);
    matrix.forEach((row,i)=>row.forEach((value,j)=>{
      const amount=Math.min(1,Math.abs(value)/max);
      const target=value<0?[52,107,155]:[183,119,98];
      ctx.fillStyle=`rgb(${target.map(v=>Math.round(247+(v-247)*amount)).join(',')})`;
      ctx.fillRect(left+j*cellWidth,top+i*cellHeight,Math.max(1,cellWidth+.1),cellHeight+.1);
    }));
    ctx.font='10px Arial';ctx.fillStyle='#7b8e9f';ctx.textAlign='right';
    matrix.forEach((_,i)=>ctx.fillText(`G${i+1}`,left-7,top+(i+.65)*cellHeight));
    ctx.textAlign='left';ctx.fillText('1',left,height-8);ctx.textAlign='right';ctx.fillText(String(matrix[0].length),width-right,height-8);
    ctx.textAlign='center';ctx.fillText('Feature channel',(left+width-right)/2,height-8);
    $('heatmap-empty').hidden=true;
    $('feature-shape').textContent=`${matrix.length} global nodes × ${matrix[0].length} channels · scale ±${max.toFixed(2)}`;
    canvas.setAttribute('aria-label',`Feature heatmap with ${matrix.length} global-node rows and ${matrix[0].length} channels. Negative values are blue; positive values are brown. Download latent JSON for numerical values.`);
  }
  $('heatmap').addEventListener('mousemove',event=>{
    const matrix=state.latent?.[$('feature-kind').value];if(!matrix)return;
    const rect=$('heatmap').getBoundingClientRect();
    const column=Math.floor((event.clientX-rect.left-35)/(rect.width-47)*matrix[0].length);
    const row=Math.floor((event.clientY-rect.top-19)/(195-44)*matrix.length);
    if(row>=0&&row<matrix.length&&column>=0&&column<matrix[0].length)$('feature-value').value=`G${row+1} · channel ${column+1}: ${matrix[row][column].toFixed(5)}`;
  });

  async function moleculeInput(suffix) {
    if(state.files[suffix])return {smiles:'',molblock:state.files[suffix]};
    const smiles=$(`smiles-${suffix}`).value.trim();if(!smiles)throw new Error('Enter a SMILES string or upload a 3D molecule.');
    return {smiles,molblock:''};
  }
  async function run(operation) {
    if(state.busy||!state.connected)return;
    state.busy=true;controls();$('error').hidden=true;$('job-status').hidden=false;$('job-progress').value=0;
    $('job-message').textContent='Submitting experiment…';
    const start=Date.now();const clock=setInterval(()=>{$('elapsed').textContent=`${((Date.now()-start)/1000).toFixed(1)} s`;},200);
    try {
      const common={model:$('model').value,steps:Number($('steps').value),seed:Number($('seed').value)};
      let payload;
      if(operation==='decode')payload={encoding_id:state.encoded,steps:common.steps,seed:common.seed};
      else if(operation==='interpolate')payload={...common,a:await moleculeInput('a'),b:await moleculeInput('b'),frames:Number($('frames').value),align:$('align').checked};
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
      if(operation==='interpolate')renderPath(job.result);
      else {
        const result=operation==='decode'?{...state.current,...job.result}:job.result;
        renderReconstruction(result);
      }
    } catch(error){showError(error);$('job-message').textContent='Experiment did not complete.';}
    finally{clearInterval(clock);state.busy=false;controls();}
  }
  function download(content,name,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('download-sdf').addEventListener('click',()=>download(`${state.current.decoded.molblock}\n$$$$\n`,`${state.current.model}-decoded.sdf`,'chemical/x-mdl-sdfile'));
  $('download-latent').addEventListener('click',()=>download(JSON.stringify({model:state.current.model,latent:state.latent},null,2),`${state.current.model}-latent.json`,'application/json'));
  $('download-path').addEventListener('click',()=>download(state.path.frames.map(frame=>`${frame.decoded.molblock}\n> <alpha>\n${frame.alpha}\n\n$$$$\n`).join(''),`${state.path.model}-interpolation.sdf`,'chemical/x-mdl-sdfile'));
  $('overlay').addEventListener('change',drawOutput);
  $('feature-kind').addEventListener('change',drawHeatmap);
  $('frame-slider').addEventListener('input',showFrame);
  $('run').addEventListener('click',()=>run(state.mode==='interpolation'?'interpolate':'reconstruct'));
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
  function resizeViewers() {
    Object.entries(state.viewers).forEach(([id,v])=>{if($(id).offsetWidth){v.resize();v.render();}});drawHeatmap();
  }
  window.addEventListener('resize',resizeViewers);
  if('ResizeObserver' in window)new ResizeObserver(resizeViewers).observe($('viewer-grid'));
  request('models').then(data=>{
    state.models=data.models;state.connected=true;$('connection').textContent='Model service connected · real checkpoint inference';$('connection').className='connection connected';controls();
  }).catch(error=>{$('connection').textContent='Model service unavailable';$('connection').className='connection failed';showError(error);});
})();
