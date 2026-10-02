// Keeps the sign-in shell available offline. The tower build itself is cached by the page from Drive.
const C='at-shell-v1',F=['./','index.html','config.js','shim.js','loader.js','manifest.webmanifest','icon.svg','icon-180.png','icon-512.png']; // site.bin is fetched fresh, then kept in IndexedDB;
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(F)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==location.origin||e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));});
