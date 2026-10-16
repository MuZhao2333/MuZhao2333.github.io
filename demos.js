"use strict";

(() => {
  const root = document.querySelector("#demos");
  if (!root) return;
  const svgNamespace = "http://www.w3.org/2000/svg";
  const byId = id => root.querySelector(`#${id}`);
  const svgNode = (tag, attributes, content) => {
    const node = document.createElementNS(svgNamespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const text = (parent, x, y, label, attributes = {}) => parent.appendChild(svgNode("text", {x, y, ...attributes}, label));

  // Integrate a finite-domain toy density by the trapezoidal rule.
  const temperature = byId("temperature");
  const boltzmannFigure = byId("boltzmann-figure");
  const boltzmannDrawing = svgNode("g", {});
  boltzmannFigure.appendChild(boltzmannDrawing);
  let sampleSeed = 42;
  const points = Array.from({length:641}, (_, i) => -1.6 + i * 0.005);
  const potential = x => 3 * (x*x - 1)**2 + 0.6*x;
  function randomGenerator(seed) {
    return () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }
  function renderBoltzmann() {
    if (byId("demo-boltzmann").hidden) return;
    const width = Math.max(240, Math.round(boltzmannFigure.getBoundingClientRect().width));
    const height = 296;
    boltzmannFigure.setAttribute("viewBox", `0 0 ${width} ${height}`);
    boltzmannFigure.style.height = `${height}px`;
    const thermalEnergy = Number(temperature.value);
    const energies = points.map(potential);
    const minimum = Math.min(...energies);
    const weights = energies.map(value => Math.exp(-(value - minimum) / thermalEnergy));
    const dx = points[1] - points[0];
    const cdf = [0];
    for (let i=1; i<points.length; i++) cdf.push(cdf[i-1] + (weights[i-1]+weights[i])*dx/2);
    const normalization = cdf[cdf.length-1];
    const density = weights.map(value => value/normalization);
    const probabilities = cdf.map(value => value/normalization);
    const leftProbability = probabilities[320];
    const random = randomGenerator(sampleSeed);
    const samples = Array.from({length:80}, () => {
      const target = random();
      let low=1, high=points.length-1;
      while(low<high) { const mid=(low+high)>>1; if(probabilities[mid]<target) low=mid+1; else high=mid; }
      const previous=probabilities[low-1];
      const fraction=(target-previous)/(probabilities[low]-previous || 1);
      return points[low-1]+dx*fraction;
    });
    boltzmannDrawing.replaceChildren();
    const left = 43, right = width - 18;
    const x = value => left+(value+1.6)/3.2*(right-left);
    const energyTop=28, energyBottom=108, probabilityTop=164, probabilityBottom=244;
    const ymax=Math.max(...density)*1.14;
    const yEnergy = value => energyBottom-(value+1)/10*(energyBottom-energyTop);
    const yDensity = value => probabilityBottom-value/ymax*(probabilityBottom-probabilityTop);
    const line = (xs, ys) => xs.map((value,i) => `${i ? "L" : "M"}${x(value).toFixed(2)},${ys[i].toFixed(2)}`).join(" ");
    const tickValues = width<400 ? [-1,0,1] : [-1.5,-1,-0.5,0,0.5,1,1.5];
    for(const [top,bottom] of [[energyTop,energyBottom],[probabilityTop,probabilityBottom]]) {
      boltzmannDrawing.appendChild(svgNode("line",{x1:left,y1:top,x2:left,y2:bottom,class:"plot-axis"}));
      boltzmannDrawing.appendChild(svgNode("line",{x1:left,y1:bottom,x2:right,y2:bottom,class:"plot-axis"}));
      boltzmannDrawing.appendChild(svgNode("line",{x1:x(0),y1:top,x2:x(0),y2:bottom,class:"plot-divider"}));
      for(const tick of tickValues) {
        boltzmannDrawing.appendChild(svgNode("line",{x1:x(tick),y1:bottom,x2:x(tick),y2:bottom+4,class:"plot-axis"}));
        text(boltzmannDrawing,x(tick),bottom+18,String(tick),{class:"plot-tick","text-anchor":"middle"});
      }
    }
    text(boltzmannDrawing,left,16,"Potential energy U(x)",{class:"plot-label"});
    text(boltzmannDrawing,left,151,width<420?"Density p(x)":"Probability density p(x)",{class:"plot-label"});
    text(boltzmannDrawing,(left+right)/2,height-6,"Reaction coordinate x · reduced units",{class:"plot-tick","text-anchor":"middle"});
    for(const energy of [0,4,8]) text(boltzmannDrawing,left-8,yEnergy(energy)+4,String(energy),{class:"plot-tick","text-anchor":"end"});
    for(const value of [0,ymax/2]) text(boltzmannDrawing,left-8,yDensity(value)+4,value.toFixed(1),{class:"plot-tick","text-anchor":"end"});
    boltzmannDrawing.appendChild(svgNode("path",{d:line(points,energies.map(yEnergy)),class:"energy-path"}));
    const densityPath=line(points,density.map(yDensity));
    boltzmannDrawing.appendChild(svgNode("path",{d:`${densityPath} L${right},${probabilityBottom} L${left},${probabilityBottom} Z`,class:"density-area"}));
    boltzmannDrawing.appendChild(svgNode("path",{d:densityPath,class:"density-path"}));
    for(const sample of samples) boltzmannDrawing.appendChild(svgNode("line",{x1:x(sample),y1:probabilityBottom-1,x2:x(sample),y2:probabilityBottom-8,class:"sample-mark"}));
    text(boltzmannDrawing,right,151,width<420?"80 samples":"80 sampled positions",{class:"plot-tick","text-anchor":"end"});
    byId("temperature-value").value = thermalEnergy.toFixed(2);
    byId("boltzmann-readout").textContent = `Left basin (x < 0): ${(leftProbability*100).toFixed(1)}% · Right basin: ${((1-leftProbability)*100).toFixed(1)}%`;
    const freeEnergyDifference=-thermalEnergy*Math.log((1-leftProbability)/leftProbability);
    byId("free-energy-readout").textContent=`Basin free-energy difference, F(right) − F(left): ${freeEnergyDifference.toFixed(2)} in reduced units. Computed as −kᵦT ln(P(right) / P(left)).`;
    boltzmannFigure.dataset.freeEnergyDifference=String(freeEnergyDifference);
    byId("boltzmann-desc").textContent = `At reduced temperature ${thermalEnergy.toFixed(2)}, the left basin contains ${(leftProbability*100).toFixed(1)} percent of the normalized probability, and the right basin contains ${((1-leftProbability)*100).toFixed(1)} percent. Rug marks indicate 80 samples from this toy density.`;
    boltzmannFigure.dataset.integral = density.reduce((sum,value,i)=>sum+value*dx*(i===0||i===density.length-1?0.5:1),0).toFixed(8);
    boltzmannFigure.dataset.leftProbability = String(leftProbability);
    boltzmannFigure.dataset.samplePositions = JSON.stringify(samples.map(value=>Number(value.toFixed(6))));
  }
  temperature.addEventListener("input", renderBoltzmann);
  root.querySelectorAll("[data-temperature]").forEach(button=>button.addEventListener("click",()=>{
    temperature.value=button.dataset.temperature;
    renderBoltzmann();
  }));
  byId("resample").addEventListener("click", () => { sampleSeed+=101; renderBoltzmann(); });

  root.querySelectorAll(".demo-interactive").forEach(element=>{element.hidden=false;});
  renderBoltzmann();
  if("ResizeObserver" in window) {
    const observer=new ResizeObserver(()=>{
      renderBoltzmann();
    });
    observer.observe(root);
  } else window.addEventListener("resize",renderBoltzmann);
})();
