const shell = 'yatra-shell-v1'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(shell)
    const root = new URL('./', self.registration.scope)
    const response = await fetch(root, {cache: 'reload'})
    if (!response.ok) throw new Error('Could not prepare the offline app')
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)]
      .map(([, asset]) => new URL(asset, root).href)
    await cache.addAll(assets)
    await cache.put(root, response)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', event => {
  const {request} = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate' && url.pathname === new URL(self.registration.scope).pathname) {
    event.respondWith(fetch(request).catch(() => caches.open(shell).then(cache => cache.match(self.registration.scope))))
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/')) {
    event.respondWith((async () => {
      const cache = await caches.open(shell)
      const saved = await cache.match(request)
      if (saved) return saved
      const response = await fetch(request)
      if (response.ok) await cache.put(request, response.clone())
      return response
    })())
  }
})
