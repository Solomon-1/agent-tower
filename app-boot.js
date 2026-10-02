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
