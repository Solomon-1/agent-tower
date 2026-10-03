// Keeps the sign-in shell available offline, and serves app.html (the opened tower) from the cache the sign-in page fills.
const C='at-shell-v3',APP='at-app',F=['./','index.html','config.js','shim.js','loader.js','app-boot.js','manifest.webmanifest','icon.svg','icon-180.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C&&k!==APP).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
  if(u.pathname.endsWith('/app.html')){e.respondWith(caches.open(APP).then(c=>c.match('app.html')).then(r=>r||Response.redirect('./',302)));return;}
  if(u.pathname.endsWith('/site.bin'))return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));});
