const startup = document.querySelector('.startup-status')
const app = document.getElementById('app')
const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
const animation = '/images/brand/startup-plane.webp'
// 51 frames at 30 ms each. Start the clock when the animated asset can play.
const duration = 1530

const mounted = new Promise(resolve => {
  if (app.childElementCount) return resolve()
  const observer = new MutationObserver(() => {
    if (!app.childElementCount) return
    observer.disconnect()
    resolve()
  })
  observer.observe(app, {childList:true})
})

async function play() {
  if (motion.matches) return
  const plane = startup.querySelector('.startup-plane')
  plane.src = animation
  try { await plane.decode() }
  catch { return }
  if (motion.matches) return
  await new Promise(resolve => {
    const timer = window.setTimeout(finish, duration)
    function finish() {
      window.clearTimeout(timer)
      motion.removeEventListener('change', skip)
      resolve()
    }
    function skip(event) {
      if (event.matches) finish()
    }
    motion.addEventListener('change', skip)
  })
}

// The animation only decorates the wait. Reveal the app as soon as it has rendered instead of
// holding a ready app behind the splash until the animation finishes.
void play()
mounted.then(() => {
  startup.remove()
  app.inert = false
})
