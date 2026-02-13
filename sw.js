/**
 * ============================================
 * GOCHAT SERVICE WORKER
 * PWA Offline Support
 * ============================================
 */

const CACHE_NAME = 'gochat-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip API requests
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) {
    return;
  }

  // Cache strategy: Network first, fallback to cache
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Clone the response
        const responseClone = response.clone();
        
        // Cache the response
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(request, responseClone);
          });
        
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            
            // If not in cache and it's a navigation request, return index.html
            if (request.mode === 'navigate') {
              return caches.match('/index.html');
            }
            
            return new Response('Offline', {
              status: 503,
              statusText: 'Service Unavailable'
            });
          });
      })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body || 'Nova notificação do GoChat',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag || 'default',
    requireInteraction: false,
    actions: data.actions || [],
    data: data.data || {}
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || 'GoChat',
      options
    )
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification click:', event);
  
  event.notification.close();
  
  const notificationData = event.notification.data;
  let url = '/';
  
  if (notificationData?.chatId) {
    url = `/chat/${notificationData.chatId}`;
  } else if (notificationData?.liveId) {
    url = `/live/${notificationData.liveId}`;
  } else if (notificationData?.userId) {
    url = `/profile/${notificationData.userId}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window' })
      .then((clientList) => {
        // Focus existing window if open
        for (const client of clientList) {
          if (client.url === url && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Open new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(url);
        }
      })
  );
});

// Background sync event
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

async function syncMessages() {
  // Sync pending messages when back online
  const db = await openDB('gochat-db', 1);
  const pendingMessages = await db.getAll('pending-messages');
  
  for (const msg of pendingMessages) {
    try {
      await fetch('/api/chats/' + msg.chatId + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
      await db.delete('pending-messages', msg.id);
    } catch (error) {
      console.error('[SW] Failed to sync message:', error);
    }
  }
}

// Helper function to open IndexedDB
function openDB(name, version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pending-messages')) {
        db.createObjectStore('pending-messages', { keyPath: 'id' });
      }
    };
  });
}

// Message event (from main thread)
self.addEventListener('message', (event) => {
  console.log('[SW] Message from main thread:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service Worker loaded');
