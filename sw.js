/* global self, clients */
const VERSION = 'v1.0.1';
const APP_SHELL = [
  'index.html',
  'manifest.webmanifest',
  'styles.css',
  'main.js'
];
const RUNTIME_CACHE = `runtime-${VERSION}`;
const SHELL_CACHE = `shell-${VERSION}`;
const API_BASE = 'https://api.example.com'; // ← remplace par ton API

// Helper: SW-safe fetch with timeout
const swFetch = (req, { timeout = 8000 } = {}) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch(req, { signal: controller.signal }).finally(() => clearTimeout(id));
};

// Install: precache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => {
      if (![SHELL_CACHE, RUNTIME_CACHE].includes(k)) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

// Network strategies
const cacheFirst = async (req) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const match = await cache.match(req);
  if (match) return match;
  try {
    const res = await swFetch(req);
    if (res && res.ok && req.method === 'GET') cache.put(req, res.clone());
    return res;
  } catch (e) {
    return caches.match('/offline.html');
  }
};

const networkFirst = async (req) => {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await swFetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    return cached || caches.match('/offline.html');
  }
};

const staleWhileRevalidate = async (req) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const fetchPromise = swFetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => cached || caches.match('/offline.html'));
  return cached || fetchPromise;
};

// Route selection
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin or our API
  if (url.origin !== self.location.origin && !url.href.startsWith(API_BASE)) return;

  // HTML navigation → Network First (fresh content)
  if (request.mode === 'navigate' || (request.destination === 'document')) {
    e.respondWith(networkFirst(request));
    return;
  }

  // API calls → Network First
  if (url.href.startsWith(API_BASE)) {
    e.respondWith(networkFirst(request));
    return;
  }

  // Static assets: CSS/JS → Stale-While-Revalidate
  if (['script', 'style', 'worker'].includes(request.destination)) {
    e.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Images → Cache First with fallback
  if (request.destination === 'image') {
    e.respondWith(cacheFirst(request));
    return;
  }

  // Default: cache first
  e.respondWith(cacheFirst(request));
});

// Offline fallback for navigation errors
self.addEventListener('fetcherror', (evt) => {
  evt.respondWith(caches.match('/offline.html'));
});

// Background Sync
self.addEventListener('sync', async (event) => {
  if (event.tag === 'sync-tasks') {
    event.waitUntil(syncPending());
  }
});

async function syncPending() {
  // petite lib IDB inlined
  const db = await openDB('tasks-db', 1, (upgradeDb) => {
    if (!upgradeDb.objectStoreNames.contains('queue')) {
      upgradeDb.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    }
  });
  const all = await dbGetAll(db, 'queue');
  for (const item of all) {
    try {
      const res = await fetch(`${API_BASE}/tasks`, {
        method: item.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload || {})
      });
      if (res.ok) await dbDelete(db, 'queue', item.id);
    } catch (_) {/* reste en file */}
  }
  sendClientMessage({ type: 'SYNC_DONE' });
}

function sendClientMessage(msg) {
  self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(cs => {
    cs.forEach(c => c.postMessage(msg));
  });
}

// Minimal IndexedDB helpers
function openDB(name, version, upgradeCb) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (e) => upgradeCb && upgradeCb(e.target.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function dbTx(db, store, mode) { return db.transaction(store, mode).objectStore(store); }
function dbAdd(db, store, value) {
  return new Promise((resolve, reject) => { const r = dbTx(db, store, 'readwrite').add(value); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
}
function dbGetAll(db, store) {
  return new Promise((resolve, reject) => { const r = dbTx(db, store, 'readonly').getAll(); r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error); });
}
function dbDelete(db, store, key) {
  return new Promise((resolve, reject) => { const r = dbTx(db, store, 'readwrite').delete(key); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
}

// Push notifications
self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || 'Nouvelle notification';
  const options = {
    body: payload.body || 'Ouvrir l’application',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: payload.url || '/' },
    vibrate: [80, 40, 80],
    actions: [
      { action: 'open', title: 'Ouvrir' },
      { action: 'done', title: 'Marquer comme fait' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  if (event.action === 'done') {
    // Optionnel: envoyer un signal d’action
    sendClientMessage({ type: 'NOTIF_DONE' });
  }
  event.waitUntil(clients.openWindow(url));
});
