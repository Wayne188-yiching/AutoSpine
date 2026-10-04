import type { buildChainWave } from "@autospine/pipeline";

/** Local, self-contained IR preview. This is not an editor playback certificate. */
export function previewHtml(result: ReturnType<typeof buildChainWave>, pngBase64: string): string {
  const data = JSON.stringify({
    mesh: result.mesh,
    frames: result.frames,
    diagnostics: result.diagnostics,
  }).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AutoSpine chain-wave preview</title><style>body{font:16px/1.6 system-ui;color:#dce9f3;background:#101e2b;margin:24px;max-width:1000px}canvas{width:100%;background:#152b3d;border:1px solid #4e718d}button{padding:10px;margin:8px}pre{white-space:pre-wrap}</style><h1>AutoSpine · chain-wave 實測預覽</h1><p>圖片 → 網格 → 顯式骨鏈 → 距離權重 → wave。這是 IR 預覽，不代表人工品質、Spine 編輯器視覺或 Gate 驗收通過。</p><button id="pause">暫停／播放</button><button id="wire">顯示／隱藏網格</button><canvas id="view" width="1000" height="520"></canvas><p id="time"></p><pre id="metrics"></pre><script>
const data=${data},canvas=document.querySelector('#view'),ctx=canvas.getContext('2d'),img=new Image();let paused=false,wire=true,elapsed=0,lastTime;
document.querySelector('#pause').onclick=()=>paused=!paused;document.querySelector('#wire').onclick=()=>wire=!wire;
document.querySelector('#metrics').textContent=JSON.stringify(data.diagnostics,null,2);
let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
for(const frame of data.frames)for(const p of frame.vertices){minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
const scale=Math.min(900/Math.max(1,maxX-minX),420/Math.max(1,maxY-minY)),origin=[(1000-(maxX-minX)*scale)/2-minX*scale,(520-(maxY-minY)*scale)/2-minY*scale];
function triangle(ids,points){const uv=ids.map(i=>[data.mesh.uvs[i][0]*img.width,data.mesh.uvs[i][1]*img.height]),dst=ids.map(i=>[points[i][0]*scale+origin[0],points[i][1]*scale+origin[1]]);const [s0,s1,s2]=uv,[d0,d1,d2]=dst,x1=s1[0]-s0[0],y1=s1[1]-s0[1],x2=s2[0]-s0[0],y2=s2[1]-s0[1],det=x1*y2-x2*y1;if(Math.abs(det)<1e-12)return;const a=((d1[0]-d0[0])*y2-(d2[0]-d0[0])*y1)/det,c=((d2[0]-d0[0])*x1-(d1[0]-d0[0])*x2)/det,b=((d1[1]-d0[1])*y2-(d2[1]-d0[1])*y1)/det,d=((d2[1]-d0[1])*x1-(d1[1]-d0[1])*x2)/det;ctx.save();ctx.beginPath();dst.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.clip();ctx.transform(a,b,c,d,d0[0]-a*s0[0]-c*s0[1],d0[1]-b*s0[0]-d*s0[1]);ctx.drawImage(img,0,0);ctx.restore();if(wire){ctx.strokeStyle='#8bcbe6';ctx.beginPath();dst.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}}
function drawBones(a,b,u){ctx.strokeStyle='#ffcf5d';ctx.fillStyle='#ffcf5d';ctx.lineWidth=3;for(let i=0;i<a.bones.length;i++){const left=a.bones[i],right=b.bones[i],mix=key=>left[key].map((v,j)=>((v+(right[key][j]-v)*u)*scale)+origin[j]),head=mix('head'),tip=mix('tip');ctx.beginPath();ctx.moveTo(...head);ctx.lineTo(...tip);ctx.stroke();ctx.beginPath();ctx.arc(...head,4,0,Math.PI*2);ctx.fill();}ctx.lineWidth=1;}
function render(now){if(lastTime!==undefined&&!paused)elapsed+=(now-lastTime)/1000;lastTime=now;const duration=data.frames.at(-1).time,t=elapsed%duration;let index=1;while(index<data.frames.length-1&&data.frames[index].time<t)index++;const a=data.frames[index-1],b=data.frames[index],u=(t-a.time)/(b.time-a.time),points=a.vertices.map((p,i)=>[p[0]+(b.vertices[i][0]-p[0])*u,p[1]+(b.vertices[i][1]-p[1])*u]);ctx.clearRect(0,0,1000,520);for(let i=0;i<data.mesh.triangles.length;i+=3)triangle(data.mesh.triangles.slice(i,i+3),points);drawBones(a,b,u);document.querySelector('#time').textContent=t.toFixed(2)+' 秒 · '+data.mesh.vertices.length+' 頂點 · '+a.bones.length+' 骨';requestAnimationFrame(render);}
img.onload=()=>requestAnimationFrame(render);img.src='data:image/png;base64,${pngBase64}';</script></html>`;
}
