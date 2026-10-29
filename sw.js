const CACHE = "bukchat-v2";
const FILES = ["./", "./index.html", "./app.js", "./config.js", "./logo.svg", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkThenCache(req, ms) {
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match(req).then((r) => r && !done && (done = true, resolve(r)));
    const timer = setTimeout(fallback, ms); // slow network: show the saved copy
    fetch(req).then((res) => {
      clearTimeout(timer);
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      if (!done) { done = true; resolve(res); }
    }).catch(() => { clearTimeout(timer); fallback().then(() => { if (!done) resolve(Response.error()); }); });
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    // Our own files: newest from network, saved copy if the network is slow/offline.
    e.respondWith(networkThenCache(req, 2500));
  } else if (url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/")) {
    // Firebase code is versioned and never changes: serve from cache instantly.
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
  }
});
