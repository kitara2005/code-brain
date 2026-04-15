/** Generate interactive HTML dependency graph from code-brain index */
import type { DbDriver } from "../db/db-driver.js";
import fs from "node:fs";
import path from "node:path";

export function generateGraph(db: DbDriver, outputPath: string, projectName: string): { nodes: number; edges: number } {
  // Get top 25 modules by symbol count
  const mods = db.exec("SELECT module, COUNT(*) as cnt FROM symbols WHERE module IS NOT NULL GROUP BY module ORDER BY cnt DESC LIMIT 25");
  if (!mods[0]) return { nodes: 0, edges: 0 };

  const topMods = new Set(mods[0].values.map(v => v[0] as string));

  // Get relations between top modules
  const rels = db.exec("SELECT source, kind, target FROM relations");
  const seen = new Set<string>();
  const edges: { from: string; to: string; kind: string }[] = [];
  for (const [s, k, t] of (rels[0]?.values || [])) {
    if (!topMods.has(s as string) || !topMods.has(t as string) || s === t) continue;
    const key = `${s}:${k}:${t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from: s as string, to: t as string, kind: k as string });
  }

  // Module info
  const modInfoResult = db.exec("SELECT name, purpose, file_count FROM modules");
  const modInfo: Record<string, { purpose: string; fileCount: number }> = {};
  if (modInfoResult[0]) {
    for (const [name, purpose, fc] of modInfoResult[0].values) {
      modInfo[name as string] = {
        purpose: ((purpose as string) || "").split("\n")[0].substring(0, 120),
        fileCount: (fc as number) || 0,
      };
    }
  }

  // Edge counts per module
  const edgeCounts: Record<string, number> = {};
  for (const e of edges) {
    edgeCounts[e.from] = (edgeCounts[e.from] || 0) + 1;
    edgeCounts[e.to] = (edgeCounts[e.to] || 0) + 1;
  }

  // Build nodes
  const colors = ["#4ecdc4", "#ff6b6b", "#45b7d1", "#96ceb4", "#ffeaa7", "#a29bfe", "#fd79a8", "#00cec9", "#e17055", "#0984e3", "#6c5ce7", "#00b894", "#fdcb6e", "#e84393", "#74b9ff", "#55efc4", "#fab1a0", "#81ecec", "#dfe6e9", "#636e72", "#b2bec3", "#2d3436", "#a29bfe", "#fd79a8", "#e17055"];

  const nodes = mods[0].values.map(([name, cnt], i) => {
    const info = modInfo[name as string] || { purpose: "", fileCount: 0 };
    return {
      id: name,
      label: name,
      value: Math.sqrt(cnt as number),
      symbolCount: cnt,
      purpose: info.purpose,
      fileCount: info.fileCount,
      color: { background: colors[i % colors.length], border: colors[i % colors.length] + "99" },
    };
  });

  const edgeData = edges.map(e => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    color: { color: e.kind === "extends" ? "#e74c3c" : e.kind === "implements" ? "#3498db" : "#bdc3c7", opacity: 0.5 },
    width: e.kind !== "depends_on" ? 2 : 1.5,
    dashes: e.kind !== "depends_on" ? [6, 3] : false,
    label: e.kind === "depends_on" ? "" : e.kind,
    arrows: { to: { enabled: true, scaleFactor: 0.4 } },
    smooth: { type: "cubicBezier", roundness: 0.3 },
    font: { size: 9, color: "#666", strokeWidth: 0 },
  }));

  const html = buildHtml(projectName, nodes, edgeData, edges, edgeCounts);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
  return { nodes: nodes.length, edges: edgeData.length };
}

/** HTML-escape a string for safe interpolation into HTML/attributes */
function escHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function buildHtml(projectName: string, nodes: any[], edgeData: any[], edgesRaw: any[], edgeCounts: any): string {
  const safeProjectName = escHtml(projectName);
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>${safeProjectName} — Module Graph</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  *{margin:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#0f0f1a;color:#e0e0e0;overflow:hidden}
  #graph{width:100vw;height:100vh}
  #header{position:fixed;top:0;left:0;right:0;z-index:10;padding:14px 24px;background:linear-gradient(180deg,rgba(15,15,26,.95),rgba(15,15,26,0));display:flex;align-items:center;gap:16px}
  #header h1{font-size:16px;font-weight:600;letter-spacing:.5px}
  .badge{font-size:11px;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.08);color:#888}
  #legend{position:fixed;top:60px;left:20px;z-index:10;background:rgba(20,20,35,.9);backdrop-filter:blur(10px);padding:16px;border-radius:12px;border:1px solid rgba(255,255,255,.06);font-size:12px}
  #legend h3{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;margin-bottom:10px}
  .legend-item{display:flex;align-items:center;gap:8px;margin:6px 0}
  .legend-line{width:20px;height:0;border-top:2px solid;flex-shrink:0}
  .legend-dash{width:20px;height:0;border-top:2px dashed;flex-shrink:0}
  #detail{position:fixed;right:20px;top:60px;z-index:10;background:rgba(20,20,35,.95);backdrop-filter:blur(10px);padding:0;border-radius:14px;border:1px solid rgba(255,255,255,.08);width:320px;max-height:calc(100vh - 100px);overflow-y:auto;transition:opacity .2s,transform .2s;opacity:0;transform:translateX(10px);pointer-events:none}
  #detail.visible{opacity:1;transform:translateX(0);pointer-events:auto}
  #detail-header{padding:20px;border-bottom:1px solid rgba(255,255,255,.06)}
  #detail-header h2{font-size:18px;font-weight:600;margin-bottom:4px}
  .cat{font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.5}
  #detail-stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:rgba(255,255,255,.04)}
  .stat{padding:12px;text-align:center;background:rgba(20,20,35,.95)}
  .stat-value{font-size:18px;font-weight:700}
  .stat-label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#666;margin-top:2px}
  #detail-purpose{padding:16px 20px;font-size:13px;line-height:1.5;color:#aaa;border-bottom:1px solid rgba(255,255,255,.06)}
  #detail-rels{padding:16px 20px}
  #detail-rels h4{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#666;margin:12px 0 6px}
  #detail-rels h4:first-child{margin-top:0}
  .rel-tag{display:inline-block;padding:3px 10px;margin:2px;border-radius:6px;font-size:12px;cursor:pointer;transition:background .15s}
  .rel-tag:hover{filter:brightness(1.3)}
  .rel-dep{background:rgba(189,195,199,.15);color:#bdc3c7}
  .rel-ext{background:rgba(231,76,60,.15);color:#e74c3c}
  .rel-impl{background:rgba(52,152,219,.15);color:#3498db}
  .rel-used{background:rgba(46,204,113,.15);color:#2ecc71}
  #search-box{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:10;background:rgba(20,20,35,.9);backdrop-filter:blur(10px);padding:8px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;gap:8px}
  #search-box input{background:none;border:none;color:#e0e0e0;font-size:14px;outline:none;width:200px;font-family:inherit}
  #search-box input::placeholder{color:#555}
  .shortcut{font-size:10px;color:#444;border:1px solid #333;padding:2px 6px;border-radius:4px}
</style>
</head><body>
<div id="header"><h1>${safeProjectName} Module Graph</h1><span class="badge">${nodes.length} modules</span><span class="badge">${edgeData.length} relations</span><span class="badge">code-brain</span></div>
<div id="legend">
  <h3>Relations</h3>
  <div class="legend-item"><span class="legend-line" style="border-color:#bdc3c7"></span> depends_on</div>
  <div class="legend-item"><span class="legend-dash" style="border-color:#e74c3c"></span> extends</div>
  <div class="legend-item"><span class="legend-dash" style="border-color:#3498db"></span> implements</div>
</div>
<div id="detail">
  <div id="detail-header"><h2>—</h2><div class="cat"></div></div>
  <div id="detail-stats"><div class="stat"><div class="stat-value" id="ds-sym">—</div><div class="stat-label">Symbols</div></div><div class="stat"><div class="stat-value" id="ds-files">—</div><div class="stat-label">Files</div></div><div class="stat"><div class="stat-value" id="ds-rels">—</div><div class="stat-label">Relations</div></div></div>
  <div id="detail-purpose"></div>
  <div id="detail-rels"></div>
</div>
<div id="search-box"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" id="search" placeholder="Search modules..." /><span class="shortcut">/</span></div>
<div id="graph"></div>
<script>
const nodesData=${JSON.stringify(nodes)};const edgesData=${JSON.stringify(edgeData)};const edgesRaw=${JSON.stringify(edgesRaw)};const edgeCounts=${JSON.stringify(edgeCounts)};
const nodes=new vis.DataSet(nodesData.map(n=>({...n,font:{color:'#ddd',size:13,face:'-apple-system,system-ui,sans-serif'},borderWidth:2,shadow:{enabled:true,size:15,x:0,y:4,color:'rgba(0,0,0,0.3)'},scaling:{min:15,max:55,label:{enabled:true,min:11,max:16}}})));
const edges=new vis.DataSet(edgesData);
const network=new vis.Network(document.getElementById('graph'),{nodes,edges},{physics:{forceAtlas2Based:{gravitationalConstant:-50,centralGravity:.005,springLength:200,springConstant:.015,damping:.6,avoidOverlap:.3},solver:'forceAtlas2Based',stabilization:{iterations:300}},interaction:{hover:true,tooltipDelay:50},nodes:{shape:'dot'},edges:{selectionWidth:2}});
function renderRels(container,titleText,list,cls){if(!list.length)return;const h=document.createElement('h4');h.textContent=titleText;container.appendChild(h);for(const m of list){const tag=document.createElement('span');tag.className='rel-tag '+cls;tag.dataset.mod=m;tag.textContent=m;tag.addEventListener('click',()=>{network.selectNodes([m]);network.focus(m,{scale:1.2,animation:true});network.body.emitter.emit('click',{nodes:[m],edges:[]})});container.appendChild(tag)}}
network.on('click',function(p){const panel=document.getElementById('detail');if(!p.nodes.length){panel.classList.remove('visible');nodes.forEach(n=>nodes.update({id:n.id,opacity:1}));return}const id=p.nodes[0],node=nodesData.find(n=>n.id===id);if(!node)return;const ce=edgesRaw.filter(e=>e.from===id||e.to===id),cn=new Set([id]);ce.forEach(e=>{cn.add(e.from);cn.add(e.to)});nodes.forEach(n=>nodes.update({id:n.id,opacity:cn.has(n.id)?1:.15}));document.querySelector('#detail-header h2').textContent=node.label;document.getElementById('ds-sym').textContent=node.symbolCount.toLocaleString();document.getElementById('ds-files').textContent=node.fileCount||'—';document.getElementById('ds-rels').textContent=edgeCounts[id]||0;document.getElementById('detail-purpose').textContent=node.purpose||'Run /code-brain to enrich.';const d=ce.filter(e=>e.from===id&&e.kind==='depends_on').map(e=>e.to),u=ce.filter(e=>e.to===id&&e.kind==='depends_on').map(e=>e.from),x=ce.filter(e=>e.from===id&&e.kind==='extends').map(e=>e.to),im=ce.filter(e=>e.from===id&&e.kind==='implements').map(e=>e.to);const relsEl=document.getElementById('detail-rels');relsEl.textContent='';renderRels(relsEl,'Depends on',d,'rel-dep');renderRels(relsEl,'Used by',u,'rel-used');renderRels(relsEl,'Extends',x,'rel-ext');renderRels(relsEl,'Implements',im,'rel-impl');if(!relsEl.childNodes.length){const p=document.createElement('p');p.style.cssText='color:#555;font-size:12px';p.textContent='No relations';relsEl.appendChild(p)}panel.classList.add('visible')});
const si=document.getElementById('search');document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==si){e.preventDefault();si.focus()}if(e.key==='Escape'){si.blur();si.value='';nodes.forEach(n=>nodes.update({id:n.id,opacity:1}))}});si.addEventListener('input',()=>{const q=si.value.toLowerCase();if(!q){nodes.forEach(n=>nodes.update({id:n.id,opacity:1}));return}nodes.forEach(n=>{const m=n.id.toLowerCase().includes(q)||(n.purpose||'').toLowerCase().includes(q);nodes.update({id:n.id,opacity:m?1:.1})})});
</script></body></html>`;
}
