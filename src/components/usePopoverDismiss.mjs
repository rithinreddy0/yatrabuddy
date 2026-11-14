import {useEffect, useEffectEvent} from 'react'

export function usePopoverDismiss({open, panel, trigger, onDismiss}) {
  const dismiss = useEffectEvent(onDismiss)
  useEffect(() => {
    if (!open) return
    function outside(event) {
      if (!panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) dismiss()
    }
    function escape(event) {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return
      event.preventDefault()
      dismiss()
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open, panel, trigger])
}
