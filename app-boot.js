// Runs first inside app.html (the tower itself): hands the tower its Google-backed tools and live voice settings,
// and keeps the Google sign-in fresh. If there is no sign-in in this tab, it goes back to the sign-in page.
(function(){
'use strict';
if(!window.HOST){location.replace('./');return;}
if(!HOST.fresh()&&!sessionStorage.getItem('at.tok')){location.replace('./');return;}
window.claude=HOST.claude;window.TOWER_HOSTED=true;
try{const l=JSON.parse(sessionStorage.getItem('at.live')||'null');if(l){HOST.liveCfg=l;window.TOWER_LIVE_CFG=l;}}catch(e){}
window.TOWER_ID_TOKEN=()=>HOST.idToken();
let chip=null;
function chipEl(){if(chip)return chip;chip=document.createElement('div');
  chip.style.cssText='position:fixed;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));background:#000c;color:#fff;padding:8px 14px;border-radius:20px;font:13px system-ui,sans-serif;z-index:2147483647;cursor:pointer;display:none';
  chip.onclick=e=>{e.stopPropagation();HOST.signIn(true).then(()=>{chip.style.display='none';},()=>{chip.textContent='Sign-in did not finish. Tap to try again';});};
  (document.body||document.documentElement).appendChild(chip);return chip;}
HOST.auth.onNeed=()=>{const c=chipEl();c.textContent='Tap here to stay signed in';c.style.display='block';};
// Refresh the Google token inside a tap shortly before it runs out, so calls never stall.
const nudge=()=>{const a=HOST.auth;if(a.exp&&a.exp-Date.now()<10*60000)HOST.signIn(true).then(()=>{if(chip)chip.style.display='none';},()=>{});};
document.addEventListener('pointerdown',nudge,true);document.addEventListener('keydown',nudge,true);
})();
// Flight recorder: keeps the last network calls and errors that matter for voice and chat, and saves them to
// CEO Office/Diagnostics in Drive shortly after something fails, so a failure on the phone can be read later.
(function(){
'use strict';
if(!window.HOST)return;
const DIR='1R6Yjrr7a9MsftgniHlztGQ-TilBuxXk8',LOG=[],cut=s=>String(s==null?'':s).slice(0,400);
let timer=0,last=0;
const rec=(kind,o)=>{LOG.push(Object.assign({t:new Date().toISOString(),kind},o));if(LOG.length>60)LOG.shift();};
function flush(why){if(timer)return;timer=setTimeout(async()=>{timer=0;if(Date.now()-last<45000)return;last=Date.now();
  const body=JSON.stringify({schema:'agent-tower/host-diag/1',why,at:new Date().toISOString(),ua:navigator.userAgent,origin:location.origin,top:window.top===window,
    standalone:!!(navigator.standalone||matchMedia('(display-mode: standalone)').matches),live:!!window.TOWER_LIVE_CFG,vapi:!!window.Vapi,
    mic:await (navigator.permissions&&navigator.permissions.query?navigator.permissions.query({name:'microphone'}).then(p=>p.state,()=>'?'):Promise.resolve('?')),log:LOG},null,1);
  try{await HOST.mcp.callTool('Google Drive','create_file',{title:'host-diag '+new Date().toISOString().replace(/[:.]/g,'-')+'.json',parentId:DIR,textContent:body,contentMimeType:'application/json',disableConversionToGoogleType:true});}catch(e){}
},6000);}
window.TOWER_DIAG={log:LOG,flush};
const WATCH=/script\.google|googleusercontent|vapi|daily\.co/i;
const f0=window.fetch.bind(window);
window.fetch=async function(input,init){const url=typeof input==='string'?input:(input&&input.url)||'';if(!WATCH.test(url))return f0(input,init);
  const t0=Date.now();try{const r=await f0(input,init);let peek='';try{peek=await r.clone().text();}catch(e){}
    rec('fetch',{url:cut(url.replace(/([?&](web_key|key|token)=)[^&]+/gi,'$1***')),method:(init&&init.method)||'GET',status:r.status,ms:Date.now()-t0,body:cut(peek.replace(/"(web_key|jarvis_web_key|id_token)"\s*:\s*"[^"]*"/g,'"$1":"***"'))});
    if(!r.ok||/"error"/.test(peek))flush('fetch '+r.status);return r;}
  catch(e){rec('fetch-fail',{url:cut(url),ms:Date.now()-t0,error:cut(e&&e.message||e)});flush('fetch-fail');throw e;}};
addEventListener('error',e=>{rec('error',{msg:cut(e.message),src:cut(e.filename)+':'+e.lineno});flush('error');});
addEventListener('unhandledrejection',e=>{const r=e.reason;rec('rejection',{msg:cut(r&&(r.message||JSON.stringify(r))||r)});flush('rejection');});
const ce=console.error.bind(console);console.error=function(...a){rec('console',{msg:cut(a.map(x=>{try{return typeof x==='string'?x:x&&x.message||JSON.stringify(x);}catch(e){return String(x);}}).join(' '))});flush('console');return ce(...a);};
// The tower's own status line: catch "Trouble on the line" and "Could not start" as soon as they show.
new MutationObserver(ms=>{for(const m of ms){const n=m.target&&m.target.nodeType===3?m.target.parentNode:m.target;if(!n||n===document.body||n===document.documentElement)continue;const t=n.textContent||'';if(/Trouble on the line|Could not start|Microphone blocked/.test(t)&&t.length<600){rec('status',{text:cut(t)});flush('status');break;}}})
  .observe(document.documentElement,{subtree:true,childList:true,characterData:true});

// A tower opened from the phone's saved copy can be an old build. Whenever the tower comes to the front,
// compare it with the site's newest build and go back through the sign-in page to load the new one.
let upd=null;
async function freshCheck(){
  let meta=null;try{meta=await (await fetch('site.json',{cache:'no-store'})).json();}catch(e){return;}
  const have=(window.TOWER_BUILD||{}).sha||'';if(!meta||!meta.sha||meta.sha===have)return;
  let tried='';try{tried=sessionStorage.getItem('at.upd')||'';}catch(e){}
  if(tried!==meta.sha&&HOST.fresh()){try{sessionStorage.setItem('at.upd',meta.sha);}catch(e){}location.replace('./');return;}
  if(!upd){upd=document.createElement('div');upd.style.cssText='position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));background:#d9b45c;color:#1b1420;padding:9px 16px;border-radius:20px;font:600 13px system-ui,sans-serif;z-index:2147483647;cursor:pointer;box-shadow:0 2px 0 #0006';
    upd.onclick=e=>{e.stopPropagation();try{sessionStorage.removeItem('at.upd');}catch(x){}location.replace('./');};(document.body||document.documentElement).appendChild(upd);}
  upd.textContent='Tower version '+meta.v+' is ready. Tap to update';
}
addEventListener('load',()=>setTimeout(freshCheck,1500));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')freshCheck();});
})();
