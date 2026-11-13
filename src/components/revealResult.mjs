/** Reveal user-requested content without moving scroll on background updates. */
export function revealResult(target,{focus=false}={}) {
  requestAnimationFrame(()=>{
    const element=typeof target==='function'?target():target
    if(!element?.isConnected)return
    if(focus)element.focus({preventScroll:true})
    const box=element.getBoundingClientRect()
    if(box.top<76||box.top>innerHeight-160)element.scrollIntoView({block:'start',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
  })
}
