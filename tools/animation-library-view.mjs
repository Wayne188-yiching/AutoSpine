import { URL } from "node:url";

const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );

export function youTubeVideoId(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  const id = ["youtu.be", "www.youtu.be"].includes(url.hostname)
    ? parts[0]
    : ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
      ? ["embed", "shorts"].includes(parts[0])
        ? parts[1]
        : url.searchParams.get("v")
      : null;
  return /^[\w-]{11}$/.test(id ?? "") ? id : null;
}

// A Spine application note does not make an unrelated film a Spine-made reference.
export function referenceCollection(entry) {
  if (youTubeVideoId(entry.source.url)) return entry.topic === "spine" ? "spine" : "animation";
  return "support";
}

// The caller validates the catalogue. URLs and notes are still escaped at the HTML boundary.
export function renderAnimationIndex(data) {
  const { taxonomy: t } = data;
  const displayDate = (value) =>
    new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      dateStyle: "medium",
      timeStyle: "short",
      hour12: false,
    }).format(new Date(value)) + " 台北時間";
  const collections = {
    spine: "Spine 動態影片",
    animation: "2D／3D 動畫影片",
    support: "圖片與教材",
  };
  const counts = Object.fromEntries(
    Object.keys(collections).map((key) => [
      key,
      data.entries.filter((entry) => referenceCollection(entry) === key).length,
    ]),
  );
  const collectionOrder = Object.keys(collections);
  const reviewed = data.entries.filter((entry) => entry.review.status !== "metadata-only").length;
  const select = (id, label, options) =>
    `<label>${label}<select id="${id}"><option value="">全部</option>${Object.entries(options)
      .map(([key, value]) => `<option value="${escape(key)}">${escape(value)}</option>`)
      .join("")}</select></label>`;
  const notes = (label, values) =>
    values.length
      ? `<div class="note-block"><h4>${label}</h4><ul>${values.map((note) => `<li>${escape(note)}</li>`).join("")}</ul></div>`
      : "";
  const time = (seconds) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const cards = [...data.entries]
    .sort(
      (a, b) =>
        collectionOrder.indexOf(referenceCollection(a)) -
        collectionOrder.indexOf(referenceCollection(b)),
    )
    .map((entry, index) => {
      const { review, source } = entry;
      const collection = referenceCollection(entry);
      const video = youTubeVideoId(source.url);
      const sourceUrl = video ? `https://www.youtube.com/watch?v=${video}` : source.url;
      const watchUrl = (seconds) => (video ? `${sourceUrl}&t=${Math.floor(seconds)}s` : sourceUrl);
      const cue = (seconds, label) =>
        `<a class="cue" href="${escape(watchUrl(seconds))}" data-start="${Math.floor(seconds)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
      const points = video
        ? review.samples.map((sample) => cue(sample.seconds, time(sample.seconds))).join("")
        : "";
      const intervals = video
        ? review.segments
            .map((segment) => cue(segment.start, `${time(segment.start)}–${time(segment.end)}`))
            .join("")
        : "";
      const image = source.kind === "image";
      const media = image
        ? `<a class="reference-image" href="${escape(source.imageUrl)}" target="_blank" rel="noopener noreferrer" aria-label="放大圖片：${escape(entry.title)}"><img src="${escape(source.imageUrl)}" alt="${escape(source.imageAlt)}" loading="lazy" referrerpolicy="no-referrer"></a><div class="video-links"><span>點圖放大</span><a class="source-link" href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">原始來源 ↗</a></div>`
        : video
          ? `<div class="video-frame" data-video="${video}" data-title="${escape(entry.title)}"><a class="poster" href="${escape(sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="播放影片：${escape(entry.title)}"><img src="https://i.ytimg.com/vi/${video}/hqdefault.jpg" alt="${escape(entry.work)} 影片封面" loading="lazy" referrerpolicy="no-referrer"><span class="play" aria-hidden="true">▶</span><span class="poster-label">觀看動態影片</span></a></div><div class="video-links"><span>觀看入口</span><div class="cues">${points}${intervals}${!points && !intervals ? cue(0, "從頭觀看") : ""}</div><a class="source-link" href="${escape(sourceUrl)}" target="_blank" rel="noopener noreferrer">YouTube ↗</a></div>`
          : `<a class="document-cover" href="${escape(sourceUrl)}" target="_blank" rel="noopener noreferrer"><span class="doc-icon" aria-hidden="true">↗</span><span class="kicker">PRODUCTION NOTES</span><strong>${escape(entry.work)}</strong><span>開啟官方製作教材</span></a>`;
      const sampled = review.samples
        .map((sample) => `<li><b>${time(sample.seconds)}</b> ${escape(sample.note)}</li>`)
        .join("");
      const segments = review.segments
        .map(
          (segment) =>
            `<li><b>${time(segment.start)}–${time(segment.end)}</b> ${escape(segment.note)}</li>`,
        )
        .join("");
      const queue = review.status === "metadata-only";
      return `<article class="case" id="${escape(entry.id)}" data-collection="${collection}"${collection === "spine" ? "" : " hidden"} data-region="${escape(entry.region)}" data-stage="${escape(entry.stages.join(" "))}" data-technique="${escape(entry.techniques.join(" "))}" data-action="${escape((entry.actions ?? []).join(" "))}" data-form="${escape((entry.forms ?? []).join(" "))}" data-status="${escape(review.status)}" data-kind="${image ? "image" : video ? "video" : "document"}">
<header class="case-heading"><span class="case-no">${String(index + 1).padStart(2, "0")} / ${escape(t.regions[entry.region])}</span><span class="pill ${queue ? "pending" : "reviewed"}">${escape(t.statuses[review.status])}</span><h3>${escape(entry.title)}</h3><p>${escape(source.publisher)} · ${escape(t.mediums[entry.medium])}</p></header>
${media}${image ? `<p class="image-credit">${escape(source.creator)}</p>` : ""}
<div class="tags">${[collections[collection], ...entry.stages.map((tag) => t.stages[tag]), ...entry.techniques.map((tag) => t.techniques[tag])].map((label) => `<span class="tag">${escape(label)}</span>`).join("")}</div>
<div class="tags">${[...(entry.forms ?? []).map((tag) => t.forms?.[tag]), ...(entry.actions ?? []).map((tag) => t.actions?.[tag])].map((label) => `<span class="tag">${escape(label)}</span>`).join("")}</div>
${queue ? '<p class="queue-note">已收錄來源，待檢視與拆解。</p>' : `<details class="evidence"><summary>觀察與 Spine 應用筆記</summary><div class="evidence-body">${notes("觀察筆記", entry.observations)}${notes("帶進 AutoSpine（推論）", entry.application)}</div></details>`}
<details class="evidence"><summary>查證範圍與限制</summary><div class="evidence-body"><p>${escape(review.method)}</p><p class="muted">${escape(review.locator)}</p>${sampled || segments ? `<ul>${sampled}${segments}</ul>` : ""}${notes("證據限制", entry.limits)}<p class="muted">${escape(source.verification)}</p>${source.rights ? `<p class="muted">${escape(source.rights)}</p>` : ""}<p class="record-id">${escape(entry.id)}<br>查證：${escape(displayDate(entry.lastVerified))}</p></div></details></article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="description" content="AutoSpine 動畫知識庫：以 Spine 動態展示為主，搭配 2D／3D 動畫影片、時間碼與製作筆記。"><title>AutoSpine 動畫知識庫</title>
<style>
:root{color-scheme:dark;--base-60:#08131b;--panel:#0e1f2b;--surface-30:#15334a;--accent-10:#ff9a5c;--ink:#f3f6f7;--muted:#a9bcc3;--line:rgba(169,188,195,.22);--soft-accent:rgba(255,154,92,.12);--max:1180px;--gutter:clamp(16px,4vw,40px);--radius:14px;--radius-sm:8px;--font:"Noto Sans TC","Microsoft JhengHei","PingFang TC","Segoe UI",sans-serif;--mono:ui-monospace,"Cascadia Mono",Consolas,"Roboto Mono",monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;background:var(--base-60);color:var(--ink);font:400 17px/1.7 var(--font);overflow-x:hidden}a{color:inherit}button,input,select{font:inherit}a,button,input,select,summary{-webkit-tap-highlight-color:transparent}a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--accent-10);outline-offset:4px}button{cursor:pointer}.wrap{width:min(100% - 2 * var(--gutter),var(--max));margin-inline:auto}.muted{color:var(--muted)}
.top{position:sticky;top:0;z-index:10;background:rgba(8,19,27,.9);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}.top .wrap{display:flex;align-items:center;gap:16px;height:60px}.brand{font-weight:800;letter-spacing:-.01em;white-space:nowrap;text-decoration:none}.brand b{color:var(--accent-10)}.top nav{display:flex;gap:4px;margin-left:auto;overflow-x:auto;white-space:nowrap}.top nav a{color:var(--muted);text-decoration:none;font-weight:700;font-size:15px;padding:6px 10px;border-radius:var(--radius-sm)}.top nav a:hover{color:var(--ink);background:var(--soft-accent)}
section{padding:clamp(48px,8vw,88px) 0;scroll-margin-top:76px}section+section{border-top:1px solid var(--line)}.hero{padding-top:clamp(56px,9vw,104px)}.kicker{display:block;margin:0 0 12px;font:700 13px/1.3 var(--mono);letter-spacing:.12em;color:var(--accent-10)}h1,h2,h3,h4{margin:0;letter-spacing:-.02em}.hero h1{font-size:clamp(2.5rem,6.4vw,4.8rem);font-weight:900;line-height:1.12}.hero h1 em{font-style:normal;color:var(--accent-10)}.lead{margin:20px 0 0;color:var(--muted);font-size:clamp(17px,2vw,21px);max-width:42em}h2{font-size:clamp(1.8rem,4vw,2.8rem);font-weight:900;line-height:1.2}.section-heading{display:flex;justify-content:space-between;align-items:end;gap:20px;flex-wrap:wrap}.section-heading p{margin:0;color:var(--muted);font-size:15px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:40px}.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px}.stat b{display:block;font-size:clamp(2rem,4vw,2.8rem);font-weight:900;line-height:1.1}.stat b em{font-style:normal;color:var(--accent-10)}.stat span{display:block;margin-top:8px;color:var(--muted);font-size:14px}.updated{margin-top:16px;color:var(--muted);font:13px/1.7 var(--mono)}
.filters{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;padding:24px;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);margin-top:32px}label{font-size:13px;color:var(--muted)}input,select{display:block;width:100%;min-width:0;padding:11px 12px;margin-top:6px;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--base-60);color:var(--ink)}input::placeholder{color:var(--muted)}.search{grid-column:1/-1}.filter-bar{display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:20px}.kind-filters{display:flex;gap:8px;flex-wrap:wrap}.kind-filters button{border:1px solid var(--line);border-radius:99px;background:transparent;color:var(--muted);padding:6px 14px;font-size:14px}.kind-filters button[aria-pressed=true]{color:var(--accent-10);border-color:var(--accent-10);background:var(--soft-accent)}#count{margin:0;color:var(--muted);font-size:14px}.empty{padding:44px 0;color:var(--muted)}[hidden]{display:none!important}
.cases{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin-top:24px;align-items:start}.case{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:clamp(16px,2.4vw,24px);overflow-wrap:anywhere;min-width:0}.case-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px}.case-no{font:800 13px/1.3 var(--mono);letter-spacing:.04em;color:var(--accent-10)}.pill{margin-left:auto;font:700 12px/1.2 var(--font);padding:5px 9px;border-radius:99px;white-space:nowrap}.pill.reviewed{color:#b8d1dd;background:var(--surface-30)}.pill.pending{color:var(--accent-10);background:var(--soft-accent)}.case h3{flex-basis:100%;font-size:clamp(1.15rem,2vw,1.45rem);font-weight:800;line-height:1.4}.case-heading p{margin:0;color:var(--muted);font-size:14px;flex-basis:100%}
.video-frame{position:relative;aspect-ratio:16/9;min-height:200px;overflow:hidden;background:#050d12;border-radius:var(--radius-sm)}.poster{display:block;position:absolute;inset:0;text-decoration:none}.poster img{display:block;width:100%;height:100%;object-fit:cover}.poster::after{content:"";position:absolute;inset:0;background:linear-gradient(transparent 40%,rgba(5,13,18,.86))}.play{position:absolute;z-index:1;left:50%;top:50%;transform:translate(-50%,-50%);display:grid;place-items:center;width:62px;height:62px;border-radius:50%;background:var(--accent-10);color:var(--base-60);font-size:24px;padding-left:4px;box-shadow:0 6px 28px #0006}.poster:hover .play{background:#ffb481}.poster-label{position:absolute;z-index:1;bottom:14px;left:16px;font-size:14px;font-weight:700}.video-frame iframe{display:block;width:100%;height:100%;position:absolute;inset:0;border:0}.video-links{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px;font-size:13px;color:var(--muted)}.cues{display:flex;gap:6px;flex-wrap:wrap}.cue{display:inline-block;text-decoration:none;font:700 13px/1.3 var(--mono);padding:5px 8px;border:1px solid var(--line);border-radius:6px;color:var(--accent-10)}.cue:hover{background:var(--soft-accent)}.source-link{margin-left:auto;white-space:nowrap;text-underline-offset:3px}.document-cover{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:220px;aspect-ratio:16/9;border-radius:var(--radius-sm);padding:28px;background:linear-gradient(125deg,var(--surface-30),#102532);text-decoration:none;border:1px solid var(--line)}.document-cover strong{font-size:22px;line-height:1.35;max-width:90%}.document-cover>span:last-child{margin-top:18px;color:var(--muted);font-size:14px}.doc-icon{position:absolute;right:20px;top:12px;font-size:28px;color:var(--accent-10)}
.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:20px}.tag{font:700 12px/1.5 var(--mono);color:var(--accent-10);background:var(--soft-accent);border-radius:6px;padding:3px 8px}.note-block{margin-top:22px}.note-block h4{font-size:15px;font-weight:800}.note-block ul,.evidence ul{margin:8px 0 0;padding-left:20px;color:var(--muted);font-size:15px}.note-block li+li,.evidence li+li{margin-top:6px}.queue-note{margin:20px 0;color:var(--muted);font-size:15px}.evidence{border-top:1px solid var(--line);margin-top:24px}.evidence summary{display:flex;align-items:center;justify-content:space-between;list-style:none;cursor:pointer;padding:16px 0 0;font-size:14px;font-weight:700}.evidence summary::-webkit-details-marker{display:none}.evidence summary::after{content:"+";color:var(--accent-10);font:800 20px var(--mono)}.evidence[open] summary::after{content:"−"}.evidence-body{font-size:14px;padding-top:4px}.record-id{color:var(--muted);font:12px/1.7 var(--mono);margin-bottom:0}
.pipe{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:stretch;gap:12px;margin-top:32px}.node{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px}.node small{font:700 12px/1 var(--mono);letter-spacing:.12em;color:var(--muted)}.node strong{display:block;margin-top:8px;font-size:22px}.node span{display:block;margin-top:8px;font-size:15px;color:var(--muted)}.node.out{border-color:rgba(255,154,92,.55);background:linear-gradient(180deg,rgba(255,154,92,.09),var(--panel))}.arrow{align-self:center;color:var(--accent-10);font:700 22px/1 var(--mono)}.reading-note{color:var(--muted);font-size:14px;max-width:64em;margin:24px 0 0}footer{border-top:1px solid var(--line);padding:28px 0 42px;color:var(--muted);font-size:13px}footer .wrap{display:flex;flex-wrap:wrap;gap:12px 24px;justify-content:space-between}
@media(max-width:860px){.cases{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.pipe{grid-template-columns:1fr}.arrow{justify-self:center;transform:rotate(90deg)}.filters{grid-template-columns:repeat(2,minmax(0,1fr));padding:18px}}@media(max-width:460px){.top nav a{font-size:13px;padding:6px}.brand{font-size:15px}.case-no{font-size:12px}.hero h1{font-size:2.4rem}.video-frame{aspect-ratio:auto;height:210px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
.reference-image{display:flex;align-items:center;justify-content:center;height:360px;min-height:220px;overflow:hidden;background:#fff;border-radius:var(--radius-sm)}.reference-image img{display:block;width:100%;height:100%;object-fit:contain}.image-credit{font-size:13px;color:var(--muted);margin:12px 0}.filter-options{margin-top:20px}.filter-options>summary{cursor:pointer;color:var(--muted);font-size:15px}.filter-options .filters{margin-top:14px}.tags:empty{display:none}.filters{grid-template-columns:repeat(3,minmax(0,1fr))}@media(max-width:760px){.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body id="top"><header class="top"><div class="wrap"><a class="brand" href="#top">AutoSpine <b>動畫知識庫</b></a><nav aria-label="章節"><a href="#library">動態影片</a><a href="#workflow">製作順序</a></nav></div></header>
<main><section class="hero"><div class="wrap"><span class="kicker">ANIMATION REFERENCE LIBRARY</span><h1>從 <em>Spine 動態</em>，<br>拆解角色演出。</h1><p class="lead">優先看 Spine 角色演出與遊戲實機，搭配製作教學；<br>2D／3D 動畫影片補充美感，圖片與文字輔助拆解。</p><div class="stats"><div class="stat"><b><em>${counts.spine}</em></b><span>Spine 動態影片</span></div><div class="stat"><b>${counts.animation}</b><span>2D／3D 動畫影片</span></div><div class="stat"><b>${counts.support}</b><span>圖片與教材</span></div><div class="stat"><b>${reviewed}</b><span>已檢視 · ${data.entries.length - reviewed} 筆待研讀</span></div></div><p class="updated">資料更新 ${escape(displayDate(data.updatedAt))}</p></div></section>
<section id="library"><div class="wrap"><div class="section-heading"><div><span class="kicker">WATCH & STUDY</span><h2>先觀看，再拆解</h2></div><p id="playback-note">點選封面播放，或從已檢視的時間碼觀看。</p></div><div class="filter-bar"><div class="kind-filters" aria-label="參考主題">${Object.entries(
    collections,
  )
    .map(
      ([key, label]) =>
        `<button type="button" data-collection-filter="${key}" aria-pressed="${key === "spine"}">${label} ${counts[key]}</button>`,
    )
    .join(
      "",
    )}<button type="button" data-collection-filter="" aria-pressed="false">全部 ${data.entries.length}</button></div><p id="count" aria-live="polite">顯示 ${counts.spine} 筆</p></div><details class="filter-options"><summary>搜尋與分類篩選</summary><div class="filters"><label class="search">搜尋作品、發布者、技法或筆記<input id="query" type="search" placeholder="例如：Unruly Heroes、重量、角色表演"></label>${select("region", "地域", t.regions)}${select("stage", "製作階段", t.stages)}${select("technique", "技法", t.techniques)}${select("action", "動作類型", t.actions ?? {})}${select("form", "參考圖形式", t.forms ?? {})}${select("status", "閱讀狀態", t.statuses)}</div></details><div class="cases">${cards}</div><p id="empty" class="empty" hidden>沒有符合的資料，試著減少篩選條件。</p></div></section>
<section id="workflow"><div class="wrap"><span class="kicker">POSE FIRST / DETAILS LATER</span><h2>先有表演，再加細節。</h2><div class="pipe"><div class="node"><small>01 / LAYOUT</small><strong>主要 Pose</strong><span>先定構圖、剪影、情緒與接觸點。重要姿勢本身就要說得清楚。</span></div><span class="arrow" aria-hidden="true">→</span><div class="node"><small>02 / BLOCKING</small><strong>節拍與轉折</strong><span>保留主 Pose，補轉折姿勢、重量轉移與停頓，確認動作成立。</span></div><span class="arrow" aria-hidden="true">→</span><div class="node out"><small>03 / FINAL</small><strong>曲線與細節</strong><span>最後調整曲線、表情、跟隨、髮尾、衣物與特效。</span></div></div><p class="reading-note">「畫面抽查」只涵蓋所列時間碼；連續動作與節奏需另行觀看。每筆筆記分開保留觀察、應用推論與證據限制。地域是來源分類，並非單一畫風。</p></div></section></main><footer><div class="wrap"><span>AutoSpine · 公開動畫參考與製作筆記</span><span>圖片與影片保留原始來源，權利屬原權利人。</span></div></footer>
<script>
const controls=['query','region','stage','technique','status','action','form'].map(id=>document.getElementById(id));
const cards=[...document.querySelectorAll('article.case')];
const typeButtons=[...document.querySelectorAll('[data-collection-filter]')];
let selectedCollection='spine';
function stopVideos(){for(const frame of document.querySelectorAll('.video-frame')){frame.querySelector('iframe')?.remove();frame.querySelector('.poster').hidden=false;}}
function filter(){const [query,region,stage,technique,status,action,form]=controls.map(control=>control.value.toLocaleLowerCase());const words=query.trim().split(/\\s+/).filter(Boolean);let count=0;for(const card of cards){const visible=words.every(word=>card.textContent.toLocaleLowerCase().includes(word))&&(!region||card.dataset.region===region)&&(!stage||card.dataset.stage.split(' ').includes(stage))&&(!technique||card.dataset.technique.split(' ').includes(technique))&&(!status||card.dataset.status===status)&&(!action||card.dataset.action.split(' ').includes(action))&&(!form||card.dataset.form.split(' ').includes(form))&&(!selectedCollection||card.dataset.collection===selectedCollection);if(!visible&&card.querySelector('iframe'))stopVideos();card.hidden=!visible;if(visible)count++;}document.getElementById('count').textContent='顯示 '+count+' 筆';document.getElementById('empty').hidden=count!==0;}
controls.forEach(control=>control.addEventListener('input',filter));
typeButtons.forEach(button=>button.addEventListener('click',()=>{selectedCollection=button.dataset.collectionFilter;typeButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));filter();}));
filter();
if(location.protocol==='file:'){document.getElementById('playback-note').textContent='圖片可點選放大；影片與時間碼在 YouTube 開啟。';}
else{document.querySelectorAll('.poster,.cue').forEach(link=>link.addEventListener('click',event=>{if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const frame=link.closest('article').querySelector('.video-frame');if(!frame)return;event.preventDefault();stopVideos();const player=document.createElement('iframe');const seconds=Number(link.dataset.start||0);player.src='https://www.youtube.com/embed/'+frame.dataset.video+'?autoplay=1&mute=1&playsinline=1&rel=0&start='+seconds;player.title=frame.dataset.title;player.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';player.allowFullscreen=true;player.referrerPolicy='strict-origin-when-cross-origin';frame.querySelector('.poster').hidden=true;frame.append(player);}));}
</script></body></html>\n`;
}
