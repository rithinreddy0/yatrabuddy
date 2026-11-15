const startup = document.querySelector('.startup-status')
const app = document.getElementById('app')

function revealApp() {
  startup.remove()
  app.inert = false
}

if (app.childElementCount) {
  revealApp()
} else {
  const observer = new MutationObserver(() => {
    if (!app.childElementCount) return
    observer.disconnect()
    revealApp()
  })
  observer.observe(app, {childList:true})
}
