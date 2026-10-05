===== sw.js =====
const CACHE_NAME='budget-app-v6';
const ASSETS=['./','./index.html','./style.css','./app.js','./data.json','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',(e)=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',(e)=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE_NAME).map(x=>caches.delete(x)))));self.clients.claim();});
self.addEventListener('fetch',(e)=>{e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).catch(()=>caches.match('./index.html'))));});