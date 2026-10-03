// Render a self-contained local review page from measured data; no external requests.
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { createHash } from "node:crypto";
import { attachmentEntries } from "./reference-topology.mjs";
import { checkArtistCorpus } from "./artist-corpus-policy.mjs";

const [reportPath, configPath] = process.argv.slice(2);
if (!reportPath || !configPath)
  throw new Error("Usage: node tools/render-reference-review.mjs report.json config.json");
const report = JSON.parse(await readFile(reportPath, "utf8"));
const config = JSON.parse(await readFile(configPath, "utf8"));
for (const project of report.projects) {
  const source = config.projects.find((p) => p.id === project.id);
  const bytes = await readFile(source.export);
  if (createHash("sha256").update(bytes).digest("hex") !== project.exportSha256)
    throw new Error("Export changed since measurement");
  if (
    createHash("sha256")
      .update(await readFile(source.source))
      .digest("hex") !== project.sourceSha256
  )
    throw new Error("Source project changed since measurement");
  project.requiredMeshIds = attachmentEntries(JSON.parse(bytes.toString("utf8")))
    .filter((x) => x.attachment.type === "mesh")
    .map((x) => `${project.id}/${x.skin}/${x.slot}/${x.name}`);
}
report.precheck = checkArtistCorpus(report);
const out = dirname(resolve(reportPath));
const reviewBytes = JSON.stringify(report, null, 2);
await writeFile(join(out, "review-data.json"), reviewBytes, { flag: "wx" });
const reviewHash = createHash("sha256").update(reviewBytes).digest("hex");
const hundredRunCases = report.cases.filter(
  (c) => c.sourceType === "mesh" && c.deterministicRuns >= 100,
).length;
await writeFile(
  join(out, "jev-review-bundle.json"),
  JSON.stringify(
    {
      gate: 3.2,
      revision: report.policyVersion,
      referenceReportPath: join(out, "review-data.json"),
      referenceReportSha256: reviewHash,
      objective:
        "Learn static topology from primary Yuuna/panda/pig projects; absolute +/-5 vertices, position and manual edge evidence; tutorials secondary",
      summary: report.summary,
      knownLimitations: [
        ...(report.incrementalEvidence
          ? [
              `Incremental evidence: ${report.incrementalEvidence.regeneratedCases.length} regenerated; ${report.incrementalEvidence.reusedMeshCases} unchanged-path mesh records reused from ${report.incrementalEvidence.baselineGeneratedAt}`,
            ]
          : []),
        "Reference-conditioned foreground selection uses artist hull; not independent semantic segmentation or learned generalization",
        "Baseline measurement, not an accepted generator",
        "Fresh export and line classification are checked per source",
        "Tutorial observations cover selected frames only, not full video/audio",
        `${hundredRunCases} attachments have 100-run evidence; remaining cases are incomplete or use ${report.runs} runs`,
        "Formal Jev acceptance has not been requested for this failing corpus; design advice is not Gate approval",
      ],
    },
    null,
    2,
  ),
  { flag: "wx" },
);
const payload = JSON.stringify(report).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoSpine Gate 3.2 人工佈線審核</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#101624;color:#e7edf8;font:16px/1.5 system-ui,"Microsoft JhengHei",sans-serif}main{max-width:1480px;margin:auto;padding:28px}h1{font-size:30px;margin:0 0 12px}h2{font-size:21px;margin:0 0 10px}p{margin:6px 0 14px}.muted{color:#a9b8cd}.status{color:#ffc37a}.stats{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}.stat{background:#1d293b;border:1px solid #34445d;border-radius:8px;padding:12px 20px;min-width:160px}.stat b{display:block;font-size:29px}.panels{display:grid;grid-template-columns:1fr 1fr;gap:18px}.panel,section{border:1px solid #34445d;background:#182235;padding:18px;border-radius:10px;margin:12px 0}select{padding:10px;background:#25344b;color:white;border:1px solid #52647e;max-width:100%;font-size:16px}svg{display:block;width:100%;height:420px;background:repeating-conic-gradient(#293345 0% 25%,#344158 0% 50%) 50%/20px 20px}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:8px;border-bottom:1px solid #34445d}.legend{display:flex;gap:20px;flex-wrap:wrap;margin:10px 0}.cyan{color:#40e6ed}.orange{color:#ffbd62}.gray{color:#b8c8de}.error{color:#ff9b9b}.good{color:#69deb0}.small{font-size:13px}.scroll{overflow:auto;max-height:520px}button{padding:6px 10px;cursor:pointer} @media(max-width:800px){.panels{grid-template-columns:1fr}svg{height:330px}}
</style><main><header><p class="muted">AutoSpine / Gate 3.2 追加優化 / 本機實測</p><h1>人工佈線與目前生成結果</h1><p class="status">本機前置審核：${report.precheck.status} · 正式 Jev 驗收：未送審（方案裁決不是通過）</p><p>這是實際 JSON 座標與 PNG 的對照；不是 Spine 編輯器截圖。來源原檔保留，未修改。</p><div class="stats" id="stats"></div><p class="muted" id="provenance"></p></header>
<section><h2>逐附件對照</h2><select id="cases" aria-label="附件"></select><div class="legend"><span class="cyan">━ 外框</span><span class="orange">━ 人工明確連線</span><span class="gray">┄ 自動三角化線</span><span>點：頂點位置</span></div><p class="muted small">缺少 nonessential edges 的來源不能驗收線型。兩側皆按實際 manualEdges 顯示實線；未標記的內部邊是虛線，不能代替結構線。</p><div id="metrics"></div><p id="coverage"></p><div class="panels"><div class="panel"><h2 id="artistTitle"></h2><div id="artist"></div></div><div class="panel"><h2 id="generatedTitle"></h2><div id="generated"></div></div></div><p class="error" id="error"></p></section>
<section><h2>已確認：同附件人工留白與實際使用範圍</h2><p>本輪是人工參考限定生成：原始 PNG 前景與人工外框交集，構成本附件的檢查範圍；不是模型自行辨認或獨立生成的證據。漏覆仍 ≤2%，透明留白不超過同附件人工實測，分母皆為此附件的有效前景。人工排除的其他前景若重新被生成外框納入，另列失敗，不拿透明留白額度抵銷。</p><p>僅量測 PNG 像素中心。來源原檔不改；未複製人工頂點陣列。無參考生成路徑和前處理丟棄／補洞預算不變。</p></section>
<section><h2>審核門檻與缺口</h2><p>數量：逐附件 ±5。位置：外框／內部一對一最小最大誤差匹配，最大誤差 ≤ PNG 對角線 5%。多出的外框點量到對側外框線段；多出的內部點量到對側內部點，不能省略或改配外框。對側缺少內部點則失敗。</p><p>線型：外框／結構實線保留率 100%，自動虛線 ≥80%。允許同類邊沿原連線細分，偏離 ≤1 像素、投影單調，不可刪除已匹配特徵或以虛線冒充實線。這是 Jev 方案裁決採用的 v5 規則；不等於 Spine 編輯器往返驗證。</p><p class="status">仍未完成：生成器的位置與邊流改善；全語料 100 次驗收；教學完整操作／語音審閱；正式 Jev 驗收。本輪 ${hundredRunCases} 個附件完成 100 次一致性檢查，其餘為 ${report.runs} 次或生成受阻。</p></section>
<section><h2>教學輔助：實際時間點截圖</h2><p>只記錄已檢視畫面，不冒充看完整部影片或完成模型訓練。</p><div id="tutorial"></div></section>
<section><h2>完整附件清單</h2><div class="scroll"><table><thead><tr><th>來源／附件</th><th>人工</th><th>生成</th><th>點數差</th><th>位置</th><th>狀態</th></tr></thead><tbody id="rows"></tbody></table></div></section></main>
<script type="application/json" id="data">${payload}</script><script>
const report=JSON.parse(document.getElementById('data').textContent), cases=report.cases.filter(c=>c.sourceType==='mesh');
if(report.incrementalEvidence){const note=document.createElement('p');note.className='muted';note.textContent='增量審核：本輪只重新生成 '+report.incrementalEvidence.regeneratedCases.length+' 件受影響案例；其餘 '+report.incrementalEvidence.reusedMeshCases+' 件沿用 '+report.incrementalEvidence.baselineGeneratedAt+' 的未受影響路徑證據，其中 '+report.incrementalEvidence.reusedPassedCases+' 件原已通過、不再重跑。已核對來源雜湊與新舊程式隔離差異，不宣稱全 164 件都是本輪重新生成。';document.querySelector('header').append(note);}
if(report.referenceStructureFamilies){const note=document.createElement('p');note.className='muted';note.textContent='本輪啟用人工參考的粗略結構分類：'+cases.filter(c=>c.referenceStructure).length+' 件使用長條類型。只將類型、數量、留白預算送入生成器，不傳人工座標或邊索引；這不是無參考語意辨識。';document.querySelector('header').append(note);}
if(report.rasterRegionConstraints){const note=document.createElement('p');note.className='muted';note.textContent='本輪另將原圖與人工選用前景的 alpha 分開作為區域約束：每次區域修正的外框位移上限為 1.5 像素，人工排除前景不得重新覆蓋。這仍是人工參考限定區域，不是獨立區域辨識。';document.querySelector('header').append(note);}
if(report.boundaryDecimation){const note=document.createElement('p');note.className='muted';note.textContent='本輪啟用外框減點：僅限沒有內點或人工實線的生成網格，依局部幾何面積排序嘗試減點及重新三角化，每步仍檢查漏覆、留白與排除區域。多步累積位移不受單次 1.5 像素上限保證；最後另作原有位置與實虛線比對。';document.querySelector('header').append(note);}
const el=id=>document.getElementById(id); const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
el('stats').innerHTML=[['人工 Mesh',report.summary.meshCases],['成功生成',report.summary.generated],['點數 ±5 通過',report.summary.countPassed],['位置通過',report.summary.positionsPassed],['留白／漏覆通過',report.summary.coveragePassed??'—'],['完整靜態通過',report.summary.staticChecksPassed]].map(([k,v])=>'<div class="stat"><b>'+v+'</b>'+k+'</div>').join('');
el('provenance').textContent=report.projects.map(p=>p.id+'：'+p.meshes+' Mesh，'+(p.freshExport?'原始 .spine 重新匯出':'舊匯出，未驗證')).join('；')+'。Yuuna 先前 0 Mesh 的舊 JSON 已排除。';
el('tutorial').innerHTML=(report.tutorialEvidence||[]).map(x=>'<p>'+esc(x.observation)+'</p><img style="max-width:100%" alt="教學時間點 '+x.timeSeconds+' 秒" src="'+x.frame+'">').join('')||'<p>尚未提供影片畫面證據</p>';
el('cases').innerHTML=cases.map((c,i)=>'<option value="'+i+'">'+esc(c.project+' / '+c.slot+' / '+c.attachment)+'</option>').join('');
function allEdges(tri){const m=new Map();for(let i=0;i<tri.length;i+=3){let t=tri.slice(i,i+3);for(let j=0;j<3;j++){const a=t[j],b=t[(j+1)%3];m.set([a,b].sort((x,y)=>x-y).join(':'),[a,b]);}}return [...m.values()];}
function draw(c,mesh){if(!mesh)return '<p class="error">未產生有效網格</p>';const w=c.width,h=c.height,pad=Math.max(w,h)*.035;const edges=allEdges(mesh.triangles),key=([a,b])=>[a,b].sort((x,y)=>x-y).join(':'),hull=mesh.hull.map((a,i)=>[a,mesh.hull[(i+1)%mesh.hull.length]]),hs=new Set(hull.map(key));const manual=mesh.manualEdges||[],ms=new Set(manual.map(key));const line=(e,color,dash)=>{const a=mesh.vertices[e[0]],b=mesh.vertices[e[1]];return '<line x1="'+a[0]+'" y1="'+a[1]+'" x2="'+b[0]+'" y2="'+b[1]+'" stroke="'+color+'" stroke-width="1.3" vector-effect="non-scaling-stroke" '+(dash?'stroke-dasharray="5 4"':'')+'/>'};return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="'+[-pad,-pad,w+pad*2,h+pad*2].join(' ')+'"><image href="'+c.image+'" width="'+w+'" height="'+h+'" opacity=".72"/>'+edges.filter(e=>!hs.has(key(e))&&!ms.has(key(e))).map(e=>line(e,'#b8c8de',true)).join('')+manual.map(e=>line(e,'#ffbd62',false)).join('')+hull.map(e=>line(e,'#40e6ed',false)).join('')+mesh.vertices.map(([x,y],i)=>'<circle cx="'+x+'" cy="'+y+'" r="'+(Math.max(w,h)/160)+'" fill="'+(mesh.hull.includes(i)?'#40e6ed':'#ffbd62')+'"/>').join('')+'</svg>';}
function show(index){const c=cases[index];el('cases').value=String(index);el('artistTitle').textContent='人工 / '+(c.artist?.vertices.length??'—')+' 點';el('generatedTitle').textContent='參考限定生成 / '+(c.generated?.vertices.length??'—')+' 點';el('artist').innerHTML=draw(c,c.artist);el('generated').innerHTML=draw(c,c.generated);el('error').textContent=c.error||(!c.freshExport?'既有匯出尚未對照原 .spine，人工線型不能驗收。':'');const p=c.positions?.groups;const fmt=x=>x===undefined?'—':x===null?'無有效對應':(x*100).toFixed(2)+'%';el('metrics').innerHTML='<p>狀態：<b>'+esc(c.status)+'</b> / 點數差：'+esc(c.count?.signedVertexDifference??'—')+' / 外框最大：'+fmt(p?.hull.max)+' / 內部最大：'+fmt(p?.interior.max)+' / 人工內部線保留：'+esc(c.edges?.retained??'—')+'/'+esc(c.edges?.required??'—')+' / 外框線：'+fmt(c.typedEdges?.hull?.recall)+' / 實線：'+fmt(c.typedEdges?.manual?.recall)+' / 虛線：'+fmt(c.typedEdges?.automatic?.recall)+'</p>'+(c.artist?.manualEdges===null?'<p class="status">人工內部線：未分類（匯出缺少 edges）</p>':'');el('coverage').textContent='人工留白上限：'+fmt(c.artistCoverage?.addedFraction)+' / 生成留白：'+fmt(c.coverage?.generated.addedFraction)+' / 有效前景漏覆：'+fmt(c.coverage?.generated.missedFraction)+'（上限 2%） / 覆蓋審核：'+(c.coverage?.status??'未生成')+'；原圖前景 '+(c.referenceRegion?.sourceForeground??'—')+' / 有效 '+(c.referenceRegion?.targetForeground??'—')+' / 人工排除 '+(c.referenceRegion?.excludedForeground??'—')+' / 生成誤納 '+(c.coverage?.outsideReferenceForeground??'—')+' 像素。';}
el('cases').addEventListener('change',()=>show(Number(el('cases').value)));el('rows').innerHTML=cases.map((c,i)=>'<tr><td><button data-index="'+i+'">'+esc(c.project+' / '+c.slot)+'</button></td><td>'+(c.artist?.vertices.length??'—')+'</td><td>'+(c.generated?.vertices.length??'—')+'</td><td>'+(c.count?.signedVertexDifference??'—')+'</td><td>'+(c.positions?c.positions.passed?'通過':'未通過':'—')+'</td><td>'+esc(c.status)+'</td></tr>').join('');el('rows').addEventListener('click',e=>{if(e.target.dataset.index!==undefined){show(Number(e.target.dataset.index));window.scrollTo(0,0)}});const requested=new URLSearchParams(location.search).get('case');const selected=requested?cases.findIndex(c=>c.id===requested):cases.findIndex(c=>c.project==='yuuna'&&c.slot==='F_Hair04');show(selected<0?0:selected);window.selectReviewCase=show;window.reviewCases=cases;
</script></html>`;
await writeFile(join(out, "review.html"), html, { flag: "wx" });
console.log(
  JSON.stringify({
    page: join(out, "review.html"),
    precheck: report.precheck.status,
    failures: report.precheck.failures.length,
  }),
);
