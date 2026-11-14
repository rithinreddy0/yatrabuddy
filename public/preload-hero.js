// Start the home hero photo download before the app code runs (home page only).
// A separate file rather than an inline script so a strict Content-Security-Policy allows it.
if (!location.hash || location.hash === '#home') {
  const hero = document.createElement('link')
  hero.rel = 'preload'
  hero.as = 'image'
  hero.href = '/images/kerala.jpg'
  hero.fetchPriority = 'high'
  document.head.append(hero)
}
