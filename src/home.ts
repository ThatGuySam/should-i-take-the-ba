import { DIRECTIONS, type DirectionId } from "./config";
import { MAP } from "./map-data";
import type { PublicStatus } from "./status";

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

// Full-screen color per answer, after Is there a burn ban. White large text passes WCAG AA large-text
// (3:1) on green and red; the small meta line uses a deep shade of the background (4.5:1 or better).
export const THEMES = {
  yes: { word: "Yes", bg: "#2a9d70", meta: "#0a261b", flow: "#0a261b" },
  no: { word: "No", bg: "#e5484d", meta: "#3a1312", flow: "#b4161b" },
  unknown: { word: "Not sure", bg: "#123646", meta: "#d0d7da", flow: "#ffffff" },
} as const;

type View = {
  direction: DirectionId;
  answer: PublicStatus["answer"];
  sentence: string;
  checkedAt: string | null;
};

const view = (s: PublicStatus): View => ({ direction: s.direction, answer: s.answer, sentence: s.headline, checkedAt: s.checkedAt });

const CSS = `
@property --bg{syntax:"<color>";inherits:true;initial-value:#123646}
:root{--font:"Montserrat","Avenir Next","Segoe UI","Helvetica Neue",Arial,sans-serif;--ease-out:cubic-bezier(.23,1,.32,1);--ease-in-out:cubic-bezier(.77,0,.175,1);--focus:#ffd34d}
*,*::before,*::after{box-sizing:border-box}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--font);color:#fff;background:var(--bg);transition:--bg .35s ease}
a{color:inherit}
:focus-visible{outline:3px solid var(--focus);outline-offset:2px;box-shadow:0 0 0 5px #1a1a1a;border-radius:6px}
.map{position:fixed;inset:0;width:100%;height:100%;display:block;z-index:0;pointer-events:none}
.focus{position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 75% 60% at 50% var(--focus-y,72%),transparent 0 35%,color-mix(in srgb,var(--bg) 82%,transparent) 100%)}
.hero{position:relative;z-index:1;min-height:100vh;min-height:100svh;display:flex;flex-direction:column;align-items:center;text-align:center;
 padding:max(1.25rem,env(safe-area-inset-top)) max(1.25rem,env(safe-area-inset-right)) max(.75rem,env(safe-area-inset-bottom)) max(1.25rem,env(safe-area-inset-left))}
.toggle{position:relative;display:inline-grid;grid-template-columns:1fr 1fr;padding:4px;border-radius:999px;background:color-mix(in srgb,var(--meta) 30%,transparent);isolation:isolate}
.toggle a{position:relative;z-index:1;display:block;min-width:8.5rem;padding:.6rem 1rem;border-radius:999px;font-weight:700;font-size:.95rem;text-decoration:none;color:#fff;transition:color .2s ease}
.toggle a[aria-current="true"]{color:var(--bg)}
.toggle .thumb{position:absolute;z-index:0;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:999px;background:#fff;transform:translateX(calc(100% * var(--i,0)))}
.answer{margin:auto 0;padding:clamp(1.5rem,8vh,5rem) 0 clamp(10rem,34vh,20rem);width:100%;max-width:56rem}
.q{margin:0 0 .25rem;font-size:clamp(1rem,2.6vw,1.35rem);font-weight:700;opacity:.92}
.word{font-size:clamp(4.5rem,min(22vw,24vh),14rem);font-weight:800;line-height:.95;letter-spacing:-.03em;margin:0;padding-bottom:.08em}
.word[data-long]{font-size:clamp(3.25rem,min(14vw,16vh),9rem)}
.sentence{font-size:clamp(1.2rem,3.2vw,1.9rem);font-weight:700;line-height:1.25;margin:.75rem auto 0;max-width:36rem;text-wrap:balance}
.meta{margin:.85rem auto 0;font-size:.95rem;font-weight:600;color:var(--meta)}
.links{margin:1.25rem 0 0;display:flex;flex-wrap:wrap;justify-content:center;gap:0 1.25rem}
.links a{font-size:.95rem;font-weight:600;color:var(--meta);padding:.6rem .25rem;text-decoration-thickness:1px;text-underline-offset:.2em}
.road{fill:none;stroke-linecap:round;stroke-linejoin:round}
.hw{stroke:#fff;stroke-opacity:.3;stroke-width:calc(var(--u,2) * 2.5px)}
.casing{stroke:#fff;stroke-width:calc(var(--u,2) * 15px)}
.flow{stroke:var(--flow);stroke-width:calc(var(--u,2) * 7px);stroke-dasharray:calc(var(--u,2) * 9px) calc(var(--u,2) * 9px);transition:stroke .35s ease}
.dot{fill:var(--meta);stroke:#fff;stroke-width:calc(var(--u,2) * 4px);transition:fill .35s ease}
.label{fill:#fff;font:700 calc(var(--u,2) * 14px) var(--font);paint-order:stroke;stroke:var(--meta);stroke-width:calc(var(--u,2) * 4px);stroke-linejoin:round;transition:stroke .35s ease}
@keyframes flow{to{stroke-dashoffset:calc(var(--u,2) * -18px)}}
@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes appear{from{opacity:0}}
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@media (prefers-reduced-motion:no-preference){
 .toggle .thumb{transition:transform .24s var(--ease-out)}
 .toggle a:active{transform:scale(.97)}
 .toggle a{transition:color .2s ease,transform .16s var(--ease-out)}
 .casing{stroke-dasharray:1;animation:draw 1.1s var(--ease-out) .15s both}
 .flow{animation:flow var(--speed,.7s) linear infinite var(--dir,normal),appear .4s ease 1.1s both}
 .answer>*{animation:rise .5s var(--ease-out) both}
 .answer>:nth-child(2){animation-delay:40ms}.answer>:nth-child(3){animation-delay:80ms}.answer>:nth-child(4){animation-delay:120ms}.answer>:nth-child(5){animation-delay:160ms}
 .swap{transition:opacity .16s ease,transform .16s var(--ease-out),filter .16s ease}
 .swap.out{opacity:0;transform:translateY(-6px);filter:blur(2px)}
}
@media (hover:hover) and (pointer:fine){.links a:hover{text-decoration-thickness:2px}.toggle a:not([aria-current="true"]):hover{background:color-mix(in srgb,#fff 12%,transparent)}}
`;

// Fits the map so the BA corridor sits in the lower part of the screen on any aspect ratio.
const CLIENT = `
(()=>{
const C=${JSON.stringify(MAP.corridor)},THEMES=${JSON.stringify(THEMES)};
const root=document.documentElement,svg=document.querySelector('.map'),data=JSON.parse(document.getElementById('views').textContent);
root.classList.add('js');
function fit(){
 const w=innerWidth,h=innerHeight,a=w/h,cw=C[2]-C[0],ch=C[3]-C[1],cx=(C[0]+C[2])/2,cy=(C[1]+C[3])/2;
 const portrait=a<0.9,fy=portrait?0.77:0.83;
 let W=cw/(portrait?0.7:0.42),H=W/a;
 const room=portrait?0.28:0.24;if(ch>room*H){H=ch/room;W=H*a}
 svg.setAttribute('viewBox',[cx-W/2,cy-fy*H,W,H].map(v=>v.toFixed(1)).join(' '));
 root.style.setProperty('--u',(W/w).toFixed(3));root.style.setProperty('--focus-y',(fy*100).toFixed(0)+'%');
}
fit();addEventListener('resize',fit);
const ago=iso=>{if(!iso)return'not checked yet';const m=Math.round((Date.now()-Date.parse(iso))/60000);return m<1?'checked just now':m<60?'checked '+m+' min ago':'checked '+new Date(iso).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})};
const $=s=>document.querySelector(s);
let current=$('[data-direction]').dataset.direction;
function paint(v,animate){
 const t=THEMES[v.answer]||THEMES.unknown;
 root.style.setProperty('--bg',t.bg);root.style.setProperty('--meta',t.meta);root.style.setProperty('--flow',t.flow);
 root.style.setProperty('--speed',v.answer==='no'?'3.6s':'.7s');root.style.setProperty('--dir',v.direction==='westbound'?'reverse':'normal');
 document.querySelector('meta[name=theme-color]').content=t.bg;
 const i=v.direction==='eastbound'?1:0;$('.toggle').style.setProperty('--i',i);
 document.querySelectorAll('.toggle a').forEach(a=>a.setAttribute('aria-current',String(a.dataset.to===v.direction)));
 const word=$('.word'),sent=$('.sentence'),meta=$('.meta [data-ago]');
 const apply=()=>{word.textContent=t.word;word.toggleAttribute('data-long',t.word.length>3);sent.textContent=v.sentence;meta.textContent=ago(v.checkedAt);word.classList.remove('out');sent.classList.remove('out')};
 if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){word.classList.add('out');sent.classList.add('out');setTimeout(apply,160)}else apply();
}
document.querySelectorAll('.toggle a').forEach(a=>a.addEventListener('click',e=>{
 e.preventDefault();const to=a.dataset.to;if(to===current)return;current=to;
 history.replaceState(null,'','?direction='+to);paint(data[to],true);
}));
setInterval(()=>{$('.meta [data-ago]').textContent=ago(data[current].checkedAt)},30000);
async function refresh(){try{const r=await fetch('/api/v1/status',{cache:'no-store'});const j=await r.json();for(const s of j.directions)data[s.direction]={direction:s.direction,answer:s.answer,sentence:s.headline,checkedAt:s.checkedAt};paint(data[current],false)}catch{}}
setInterval(refresh,120000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
})();`;

export function homePage(status: PublicStatus, all: PublicStatus[], origin: string) {
  const t = THEMES[status.answer];
  const views = Object.fromEntries(all.map((s) => [s.direction, view(s)]));
  const title = "Should I take the BA? Live Broken Arrow Expressway traffic in Tulsa";
  const description =
    "A live yes or no on whether to drive the Broken Arrow Expressway (OK-51) between downtown Tulsa and Broken Arrow, checked every 5 minutes at rush hour.";
  const card = `${origin}/card/latest.jpg?direction=${status.direction}&v=${encodeURIComponent(status.checkedAt ?? "none")}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Should I take the BA?",
    description,
    url: `${origin}/`,
    ...(status.checkedAt ? { dateModified: status.checkedAt } : {}),
    about: { "@type": "Place", name: "Broken Arrow Expressway (OK-51), Tulsa, Oklahoma" },
  };
  const i = status.direction === "eastbound" ? 1 : 0;
  const tab = (id: DirectionId) =>
    `<a href="/?direction=${id}" data-to="${id}" aria-current="${id === status.direction}">${DIRECTIONS[id].label}</a>`;
  const ago = status.checkedAt
    ? `<time datetime="${status.checkedAt}" data-ago>checked at ${new Date(status.checkedAt).toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}</time>`
    : `<span data-ago>not checked yet</span>`;
  const [dx, dy] = MAP.downtown;
  const [bx, by] = MAP.brokenArrow;
  const W = MAP.width;
  const H = MAP.height;
  const flowDir = status.direction === "westbound" ? "reverse" : "normal";
  const speed = status.answer === "no" ? "3.6s" : ".7s";

  return `<!doctype html><html lang="en" style="--bg:${t.bg};--meta:${t.meta};--flow:${t.flow};--dir:${flowDir};--speed:${speed}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="${t.bg}">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${origin}/"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="text/markdown" href="${origin}/index.md" title="Markdown">
<meta property="og:site_name" content="Should I take the BA?"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${origin}/">
<meta property="og:image" content="${card}"><meta property="og:image:width" content="1080"><meta property="og:image:height" content="1350">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&display=swap">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>${CSS}</style></head><body>
<svg class="map" viewBox="${(MAP.corridor[0] + MAP.corridor[2]) / 2 - 470} ${MAP.corridor[1] - 900} 940 1700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<image href="/map/streets.svg" width="${W}" height="${H}"/>
<path class="road hw" d="${MAP.highways}"/>
<path class="road casing" pathLength="1" d="${MAP.route}"/>
<path class="road flow" d="${MAP.route}"/>
<circle class="dot" cx="${dx}" cy="${dy}" r="9"/><circle class="dot" cx="${bx}" cy="${by}" r="9"/>
<text class="label" x="${dx}" y="${dy - 22}" text-anchor="middle">Downtown</text>
<text class="label" x="${bx}" y="${by + 38}" text-anchor="middle">Broken Arrow</text>
</svg>
<div class="focus"></div>
<main class="hero" data-direction="${status.direction}">
<nav class="toggle" aria-label="Direction" style="--i:${i}"><span class="thumb"></span>${tab("westbound")}${tab("eastbound")}</nav>
<div class="answer" aria-live="polite">
<h1 class="q">Should I take the BA?</h1>
<p class="word swap"${t.word.length > 3 ? " data-long" : ""}>${t.word}</p>
<p class="sentence swap">${esc(status.headline)}</p>
<p class="meta">Google Maps traffic · ${ago}</p>
<p class="links"><a href="/about">How it works</a></p>
</div>
</main>
<script type="application/json" id="views">${JSON.stringify(views).replace(/</g, "\\u003c")}</script>
<script>${CLIENT}</script>
</body></html>`;
}
