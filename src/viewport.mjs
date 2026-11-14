// Marks <html data-keyboard="open"> while an on-screen keyboard covers part of the page.
// Layout reacts to the keyboard itself rather than to input focus: hiding UI on focus/blur makes
// the page jump when a traveller taps a suggestion chip right after typing, so the tap misses.
const KEYBOARD_MIN_HEIGHT = 150

export function keyboardOpen(layoutHeight, visualHeight) {
  return Number.isFinite(layoutHeight) && Number.isFinite(visualHeight) && layoutHeight - visualHeight > KEYBOARD_MIN_HEIGHT
}

export function watchKeyboard(target = globalThis) {
  const viewport = target.visualViewport
  const root = target.document?.documentElement
  if (!viewport || !root) return () => {}
  let frame = 0
  const update = () => {
    frame = 0
    const open = keyboardOpen(target.innerHeight, viewport.height)
    if (open) root.dataset.keyboard = 'open'
    else delete root.dataset.keyboard
  }
  const schedule = () => { if (!frame) frame = target.requestAnimationFrame(update) }
  viewport.addEventListener('resize', schedule)
  update()
  return () => {
    viewport.removeEventListener('resize', schedule)
    if (frame) target.cancelAnimationFrame(frame)
  }
}
