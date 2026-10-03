// Agent Tower loader: signs in, pulls the newest tower build from Elisha's private Drive, and runs it full screen.
// The built page never lives in this public repo. Browser storage is only a cache of that Drive file.
(function(){
'use strict';
const CFG=window.TOWER_CFG||{};
const $=id=>document.getElementById(id);
const msg=t=>{$('msg').textContent=t;};
const bar=p=>{$('bar').style.display=p==null?'none':'block';$('bar').firstElementChild.style.width=Math.round((p||0)*100)+'%';};

// tiny IndexedDB cache for the last tower build
const idb=()=>new Promise((ok,no)=>{const r=indexedDB.open('agent-tower',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
async function kv(k,v){try{const db=await idb();return await new Promise((ok,no)=>{const tx=db.transaction('kv',v===undefined?'readonly':'readwrite');const st=tx.objectStore('kv');const r=v===undefined?st.get(k):st.put(v,k);r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});}catch(e){return null;}}

// The tower runs as its own top-level page (app.html) on this site's real address. A frame would give it no
// address ("null" origin), and Vapi and the microphone refuse calls from there. The service worker serves app.html
// from a cache this page fills with the opened build.
function inject(html){
  const boot='<script src="config.js"><\/script><script src="https://accounts.google.com/gsi/client" async><\/script><script src="shim.js"><\/script><script src="app-boot.js"><\/script>';
  // The build is a bare fragment (claude.ai adds the page skeleton); without a doctype and viewport an iPhone draws it as a 980px desktop page.
  const head='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
  const i=html.search(/<head[^>]*>/i);
  if(i<0)return head+boot+html;
  const j=html.indexOf('>',i)+1;return html.slice(0,j)+boot+html.slice(j);
}
async function show(html){
  try{if(HOST.liveCfg)sessionStorage.setItem('at.live',JSON.stringify(HOST.liveCfg));}catch(e){}
  try{
    if(!('serviceWorker' in navigator)||!window.caches)throw new Error('no service worker');
    await navigator.serviceWorker.ready;
    const c=await caches.open('at-app');
    await c.put(new Request('app.html'),new Response(inject(html),{headers:{'Content-Type':'text/html; charset=utf-8'}}));
    location.replace('app.html');
  }catch(e){
    // Fallback: write the tower into this page. Same address, so Vapi and the mic still work.
    document.open();document.write(inject(html));document.close();
  }
}

// The build sits in this repo sealed (site.bin); the key to open it lives only in Elisha's Drive.
async function siteKey(){
  const c=await kv('key');if(c)return c;
  const d=await HOST.mcp.callTool('Google Drive','download_file_content',{fileId:CFG.keyFileId});
  const raw=Uint8Array.from(atob(atob(d.payload.content).trim()),ch=>ch.charCodeAt(0));
  const k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);await kv('key',k);return k;
}
async function open(buf){
  const k=await siteKey();const b=new Uint8Array(buf);
  const p=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},k,b.slice(12));
  return new TextDecoder().decode(p);
}
// Live chat and voice settings come from endpoint.json in Drive after sign-in, so no key is ever in this repo.
async function liveCfg(){
  if(!CFG.endpointFolderId)return;
  try{const l=await HOST.mcp.callTool('Google Drive','search_files',{query:"parentId = '"+CFG.endpointFolderId+"' and title = 'endpoint.json'",pageSize:5,orderBy:'modifiedTime desc'});
    const f=((l.payload||{}).files||[])[0];if(!f)return;
    const d=await HOST.mcp.callTool('Google Drive','download_file_content',{fileId:f.id});
    const e=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(d.payload.content),c=>c.charCodeAt(0))));
    if(e.url&&e.web_key)HOST.liveCfg={url:e.url,web_key:e.web_key,pk:e.vapi_public_key,aid:e.assistant_id};
  }catch(e){}
}
async function boot(){
  $('go').style.display='none';$('offline').style.display='none';msg('Checking for the newest tower');bar(.2);
  const cached=await kv('build');await liveCfg();
  let meta=null;try{meta=await (await fetch('site.json',{cache:'no-store'})).json();}catch(e){}
  if(cached&&(!meta||cached.sha===meta.sha)){bar(1);return show(cached.html);}
  if(!meta){msg('Could not reach the site. Check your connection.');$('go').style.display='block';$('go').textContent='Try again';bar(null);return;}
  msg('Opening version '+meta.v);bar(.5);
  try{
    const buf=await (await fetch('site.bin?'+meta.sha)).arrayBuffer();bar(.8);
    const html=await open(buf);
    await kv('build',{sha:meta.sha,v:meta.v,html,at:Date.now()});bar(1);show(html);
  }catch(e){
    if(cached)return show(cached.html);
    msg('Could not open the tower: '+(e.message||e.name));$('go').style.display='block';$('go').textContent='Try again';bar(null);
  }
}
$('go').onclick=()=>{
  if(!CFG.clientId){msg('This site is waiting on its Google client ID.');return;}
  if(HOST.fresh())return boot();
  msg('Signing in');HOST.idToken();HOST.signIn(false).then(boot,e=>{msg('Sign-in did not finish ('+e.message+'). Tap to try again.');});
};
$('offline').onclick=async()=>{const c=await kv('build');if(c)show(c.html);};
window.TOWER_KV=kv;
(async()=>{
  if((await kv('build')))$('offline').style.display='block';
  if(HOST.fresh())boot();
})();
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
