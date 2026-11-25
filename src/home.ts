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
  since: string | null;
  next: string | null;
  stretches: PublicStatus["stretches"];
};

const view = (s: PublicStatus): View => ({
  direction: s.direction,
  answer: s.answer,
  sentence: s.headline,
  checkedAt: s.checkedAt,
  since: s.answer === "unknown" ? null : s.answerSince,
  next: s.nextCheckAt,
  stretches: s.stretches,
});

/** Apple Maps opens the Maps app on iPhone and Mac with traffic on the route; elsewhere the web. */
export function mapLinks(direction: DirectionId) {
  const d = DIRECTIONS[direction];
  const a = `${d.origin.lat},${d.origin.lng}`;
  const b = `${d.destination.lat},${d.destination.lng}`;
  return {
    apple: `https://maps.apple.com/directions?source=${a}&destination=${b}&mode=driving`,
    google: `https://www.google.com/maps/dir/?api=1&origin=${a}&destination=${b}&travelmode=driving`,
  };
}

/** "Jammed: Memorial to 129th E Ave." in travel order for the direction. */
export function jamText(direction: DirectionId, stretches: PublicStatus["stretches"]): string {
  if (!stretches) return "";
  const ordered = direction === "westbound" ? [...stretches].reverse().map((x) => ({ ...x, from: x.to, to: x.from })) : stretches;
  const part = (level: string, label: string) => {
    const names = ordered.filter((x) => x.level === level).map((x) => `${x.from} to ${x.to}`);
    return names.length ? `${label}: ${names.join(", ")}.` : "";
  };
  return [part("jammed", "Jammed"), part("slow", "Slow")].filter(Boolean).join(" ");
}

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
.toggle a{position:relative;z-index:1;display:block;min-width:8.5rem;padding:.45rem 1rem;border-radius:999px;font-weight:700;font-size:.95rem;line-height:1.2;text-decoration:none;color:#fff;transition:color .2s ease}
.toggle small{display:block;font-size:.72rem;font-weight:600;opacity:.85}
.toggle a[aria-current="true"]{color:var(--bg)}
.toggle .thumb{position:absolute;z-index:0;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:999px;background:#fff;transform:translateX(calc(100% * var(--i,0)))}
.toggle{cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
/* Phones: the switch is the main control, so it sits in thumb reach at the bottom. */
@media (max-width:40rem){
 .toggle{position:fixed;z-index:5;left:50%;bottom:max(1rem,calc(env(safe-area-inset-bottom) + .5rem));translate:-50% 0;box-shadow:0 6px 24px rgb(0 0 0 / .28);background:color-mix(in srgb,var(--meta) 55%,var(--bg))}
 .toggle a{min-width:9rem;padding:.65rem 1rem}
 .hero{padding-bottom:calc(6.5rem + env(safe-area-inset-bottom))}
}
.answer{margin:auto 0;padding:clamp(1.5rem,8vh,5rem) 0 clamp(10rem,34vh,20rem);width:100%;max-width:56rem}
.q{margin:0 0 .25rem;font-size:clamp(1rem,2.6vw,1.35rem);font-weight:700;opacity:.92}
.word{font-size:clamp(4.5rem,min(22vw,24vh),14rem);font-weight:800;line-height:.95;letter-spacing:-.03em;margin:0;padding-bottom:.08em}
.word[data-long]{font-size:clamp(3.25rem,min(14vw,16vh),9rem)}
.sentence{font-size:clamp(1.2rem,3.2vw,1.9rem);font-weight:700;line-height:1.25;margin:.75rem auto 0;max-width:36rem;text-wrap:balance}
.jams{margin:.6rem auto 0;font-size:1rem;font-weight:700;max-width:34rem;text-wrap:balance}
.jams:empty{display:none}
.glare{margin:.6rem auto 0;font-size:.95rem;font-weight:700;max-width:34rem}.glare:empty{display:none}
.watch{margin:1rem auto 0;max-width:30rem}.watch[hidden]{display:none}
.watch button{font:inherit;font-weight:700;font-size:1rem;min-height:2.9rem;padding:.7rem 1.3rem;border:0;border-radius:999px;background:#fff;color:var(--bg);cursor:pointer}
.watch p{margin:.4rem 0 0;font-size:.85rem;font-weight:600;color:var(--meta)}
.watch .stop{background:none;color:var(--meta);min-height:auto;padding:.3rem;text-decoration:underline;font-size:.85rem}
.saved{margin:.5rem 0 0;font-size:.8rem;font-weight:600;color:var(--meta)}.saved[hidden]{display:none}.saved button{font:inherit;color:inherit;background:none;border:0;padding:.4rem .2rem;text-decoration:underline;cursor:pointer}
.meta.source{margin-top:.2rem;font-size:.82rem;opacity:.85}
.meta{margin:.85rem auto 0;font-size:.95rem;font-weight:600;color:var(--meta)}
.links{margin:1.25rem 0 0;display:flex;flex-wrap:wrap;justify-content:center;gap:0 1.25rem}
.links a{font-size:.95rem;font-weight:600;color:var(--meta);padding:.6rem .25rem;text-decoration-thickness:1px;text-underline-offset:.2em}
.road{fill:none;stroke-linecap:round;stroke-linejoin:round}
.hw{stroke:#fff;stroke-opacity:.3;stroke-width:calc(var(--u,2) * 2.5px)}
.casing{stroke:#fff;stroke-width:calc(var(--u,2) * 15px)}
.flow{stroke:var(--flow);stroke-width:calc(var(--u,2) * 7px);stroke-dasharray:calc(var(--u,2) * 9px) calc(var(--u,2) * 9px);transition:stroke .35s ease}
.flow[data-level=clear]{stroke:#1f7a55}.flow[data-level=slow]{stroke:#e8930c}.flow[data-level=jammed]{stroke:#c4161c}
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
 .flow[data-level=clear]{animation-duration:.7s,.4s}.flow[data-level=slow]{animation-duration:1.8s,.4s}.flow[data-level=jammed]{animation-duration:3.6s,.4s}
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
const C=${JSON.stringify(MAP.corridor)},THEMES=${JSON.stringify(THEMES)},LINKS=${JSON.stringify({ eastbound: mapLinks("eastbound"), westbound: mapLinks("westbound") })};
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
const clock=iso=>new Date(iso).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'});
const ago=iso=>{if(!iso)return'not checked yet';const m=Math.round((Date.now()-Date.parse(iso))/60000);return m<1?'checked just now':m<60?'checked '+m+' min ago':'checked at '+clock(iso)};
const status=v=>[v.since?(v.answer==='no'?'Backed up':'Moving')+' since '+clock(v.since):'',ago(v.checkedAt),v.next&&Date.parse(v.next)>Date.now()?'next check ~'+clock(v.next):''].filter(Boolean).join(' · ');
const $=s=>document.querySelector(s);
function jamText(v){if(!v.stretches)return'';let o=v.stretches.map(x=>({...x}));if(v.direction==='westbound')o=o.reverse().map(x=>({...x,from:x.to,to:x.from}));const p=(l,n)=>{const a=o.filter(x=>x.level===l).map(x=>x.from+' to '+x.to);return a.length?n+': '+a.join(', ')+'.':''};return[p('jammed','Jammed'),p('slow','Slow')].filter(Boolean).join(' ')}
// Remember a direction choice per half of the day (before or after noon) on this device.
const half=()=>new Date().getHours()<12?'am':'pm';
// Sun position (NOAA low-precision formulas), Tulsa. Glare when the sun is low and ahead.
function sunAt(ms){const r=Math.PI/180,d=ms/864e5-10957.5,g=(357.529+.98560028*d)*r,q=280.459+.98564736*d,L=(q+1.915*Math.sin(g)+.02*Math.sin(2*g))*r,e=(23.439-36e-8*d)*r,ra=Math.atan2(Math.cos(e)*Math.sin(L),Math.cos(L)),dec=Math.asin(Math.sin(e)*Math.sin(L)),gmst=(18.697374558+24.06570982441908*d)%24,lat=36.09*r,H=((gmst*15-95.86)*r)-ra;const el=Math.asin(Math.sin(lat)*Math.sin(dec)+Math.cos(lat)*Math.cos(dec)*Math.cos(H));const az=(Math.atan2(Math.sin(H),Math.cos(H)*Math.sin(lat)-Math.tan(dec)*Math.cos(lat))/r+180)%360;return{el:el/r,az}}
const HEADING={eastbound:115,westbound:295};
function glareWindow(dir,day){const start=new Date(day);start.setHours(5,0,0,0);let a=null,b=null;for(let t=start.getTime();t<start.getTime()+16*36e5;t+=5*6e4){const s=sunAt(t),off=Math.abs(((s.az-HEADING[dir])+540)%360-180),hit=s.el>0&&s.el<20&&off<30;if(hit&&a===null)a=t;if(hit)b=t;if(!hit&&a!==null&&b!==null&&t-b>36e5)break}return a===null?null:{a,b:b+5*6e4}}
function glareText(dir){const w=glareWindow(dir,new Date()),now=Date.now();if(!w||now>w.b||w.a-now>3*36e5)return'';const f=t=>clock(new Date(t).toISOString());return(now>=w.a?'Low sun in your eyes '+(dir==='eastbound'?'eastbound':'westbound')+' until about '+f(w.b)+'.':'Low sun ahead '+(dir==='eastbound'?'eastbound':'westbound')+' about '+f(w.a)+'–'+f(w.b)+'.')}
const remembered=()=>{try{return localStorage.getItem('ba:dir:'+half())}catch{return null}};
let current=$('[data-direction]').dataset.direction;
function paint(v,animate){
 const t=THEMES[v.answer]||THEMES.unknown;
 root.style.setProperty('--bg',t.bg);root.style.setProperty('--meta',t.meta);root.style.setProperty('--flow',t.flow);
 root.style.setProperty('--speed',v.answer==='no'?'3.6s':'.7s');root.style.setProperty('--dir',v.direction==='westbound'?'reverse':'normal');
 document.querySelector('meta[name=theme-color]').content=t.bg;
 const i=v.direction==='eastbound'?1:0;$('.toggle').style.setProperty('--i',i);
 document.querySelectorAll('.toggle a').forEach(a=>a.setAttribute('aria-current',String(a.dataset.to===v.direction)));
 $('[data-map=apple]').href=LINKS[v.direction].apple;$('[data-map=google]').href=LINKS[v.direction].google;
 document.querySelectorAll('.flow').forEach((p,k)=>{const s=v.stretches&&v.stretches[k];if(s)p.dataset.level=s.level;else delete p.dataset.level});
 $('.glare').textContent=glareText(v.direction);showWatch(v);
 const word=$('.word'),sent=$('.sentence'),meta=$('.meta [data-ago]'),jams=$('.jams');
 const apply=()=>{word.textContent=t.word;word.toggleAttribute('data-long',t.word.length>3);sent.textContent=v.sentence;jams.textContent=jamText(v);meta.textContent=status(v);word.classList.remove('out');sent.classList.remove('out')};
 if(animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){word.classList.add('out');sent.classList.add('out');setTimeout(apply,160)}else apply();
}
// Tapping anywhere on the switch flips to the other direction, not only the other half.
$('.toggle').addEventListener('click',e=>{
 e.preventDefault();const to=current==='eastbound'?'westbound':'eastbound';current=to;
 try{localStorage.setItem('ba:dir:'+half(),to)}catch{}
 saved.hidden=true;
 history.replaceState(null,'','?direction='+to);paint(data[to],true);
});
// Tell me when it clears: one push on the next confirmed No to Yes for this direction.
const VAPID=document.querySelector('meta[name=vapid]').content,watchEl=$('.watch');
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
const canPush='serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
const getWatch=()=>{try{const w=JSON.parse(localStorage.getItem('ba:watch')||'null');return w&&Date.parse(w.expiresAt)>Date.now()?w:null}catch{return null}};
function showWatch(v){const w=getWatch();const btn=watchEl.querySelector('.go'),msg=watchEl.querySelector('.msg'),stop=watchEl.querySelector('.stop');
 if(w&&w.direction===v.direction){watchEl.hidden=false;btn.hidden=true;stop.hidden=false;msg.textContent='Watching until '+clock(w.expiresAt)+'. You get one notification when it clears.';return}
 stop.hidden=true;if(v.answer!=='no'){watchEl.hidden=true;return}watchEl.hidden=false;
 if(ios&&!standalone){btn.hidden=true;msg.textContent='To get a notice when it clears on iPhone, tap Share, then Add to Home Screen, and open it from there.';return}
 if(!canPush){btn.hidden=true;msg.textContent='';watchEl.hidden=true;return}
 btn.hidden=false;msg.textContent='One notification when it’s moving again. Watches for up to 90 minutes.'}
const b64=s=>{const p='='.repeat((4-s.length%4)%4),r=atob((s+p).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(r,c=>c.charCodeAt(0))};
watchEl.querySelector('.go').addEventListener('click',async()=>{const msg=watchEl.querySelector('.msg');try{
 const reg=await navigator.serviceWorker.register('/sw.js');if(await Notification.requestPermission()!=='granted'){msg.textContent='Notifications are blocked for this site in your browser settings.';return}
 const sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(VAPID)});
 const r=await fetch('/api/v1/watch',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),direction:current,minutes:90})}).then(r=>r.json());
 if(!r.ok)throw new Error(r.error);localStorage.setItem('ba:watch',JSON.stringify({direction:current,expiresAt:r.expiresAt,endpoint:sub.endpoint}));showWatch(data[current])}
 catch(e){msg.textContent='Could not start watching. Try again in a moment.'}});
watchEl.querySelector('.stop').addEventListener('click',async()=>{const w=getWatch();localStorage.removeItem('ba:watch');if(w)fetch('/api/v1/watch',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:w.endpoint})}).catch(()=>{});showWatch(data[current])});
showWatch(data[current]);$('.glare').textContent=glareText(current);
const def=current,saved=$('.saved');
{const r=remembered();if(!new URLSearchParams(location.search).has('direction')&&r&&r!==current&&data[r]){current=r;paint(data[r],false);saved.firstChild.textContent='Your saved '+(half()==='am'?'morning':'afternoon')+' direction · ';saved.hidden=false}}
saved.querySelector('button').addEventListener('click',()=>{try{localStorage.removeItem('ba:dir:'+half())}catch{}saved.hidden=true;if(current!==def){current=def;paint(data[def],true)}});
$('.meta [data-ago]').textContent=status(data[current]);
setInterval(()=>{$('.meta [data-ago]').textContent=status(data[current])},30000);
async function refresh(){try{const r=await fetch('/api/v1/status',{cache:'no-store'});const j=await r.json();for(const s of j.directions)data[s.direction]={direction:s.direction,answer:s.answer,sentence:s.headline,checkedAt:s.checkedAt,since:s.answer==='unknown'?null:s.answerSince,next:s.nextCheckAt,stretches:s.stretches};paint(data[current],false)}catch{}}
setInterval(refresh,120000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
})();`;

export function homePage(status: PublicStatus, all: PublicStatus[], origin: string, vapidKey = "") {
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
    `<a href="/?direction=${id}" data-to="${id}" aria-current="${id === status.direction}">${DIRECTIONS[id].label}<small>${id === "westbound" ? "BA to Tulsa" : "Tulsa to BA"}</small></a>`;
  const links = mapLinks(status.direction);
  const levelAttr = (k: number) => (status.stretches?.[k] ? ` data-level="${status.stretches[k].level}"` : "");
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
<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><meta name="vapid" content="${esc(vapidKey)}">
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
${MAP.stretches.map((d, k) => `<path class="road flow"${levelAttr(k)} d="${d}"/>`).join("")}
<circle class="dot" cx="${dx}" cy="${dy}" r="9"/><circle class="dot" cx="${bx}" cy="${by}" r="9"/>
<text class="label" x="${dx}" y="${dy - 22}" text-anchor="middle">Downtown</text>
<text class="label" x="${bx}" y="${by + 38}" text-anchor="middle">Broken Arrow</text>
</svg>
<div class="focus"></div>
<main class="hero" data-direction="${status.direction}">
<nav class="toggle" aria-label="Direction" style="--i:${i}"><span class="thumb"></span>${tab("westbound")}${tab("eastbound")}</nav>
<p class="saved" hidden><span></span><button type="button">Use time-of-day default</button></p>
<div class="answer" aria-live="polite">
<h1 class="q">Should I take the BA?</h1>
<p class="word swap"${t.word.length > 3 ? " data-long" : ""}>${t.word}</p>
<p class="sentence swap">${esc(status.headline)}</p>
<p class="jams">${esc(jamText(status.direction, status.stretches))}</p>
<p class="glare"></p>
<div class="watch" hidden><button type="button" class="go">Tell me when it clears</button><p class="msg"></p><button type="button" class="stop" hidden>Stop watching</button></div>
<p class="meta">${ago}</p>
<p class="meta source">Traffic from Google Maps</p>
<p class="links"><a data-map="apple" href="${links.apple}">Open in Apple Maps</a><a data-map="google" href="${links.google}">Google Maps</a><a href="/about">How it works</a></p>
</div>
</main>
<script type="application/json" id="views">${JSON.stringify(views).replace(/</g, "\\u003c")}</script>
<script>${CLIENT}</script>
</body></html>`;
}
