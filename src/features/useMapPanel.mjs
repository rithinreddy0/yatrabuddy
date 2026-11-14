import {useEffect, useState} from 'react'

const desktopMap = '(min-width: 901px) and (pointer: fine)'

export function useMapPanel() {
  const [open, setOpen] = useState(() => window.matchMedia(desktopMap).matches)
  useEffect(() => {
    const media = window.matchMedia(desktopMap)
    function closeOnMobile(event) {
      if (!event.matches) setOpen(false)
    }
    media.addEventListener('change', closeOnMobile)
    closeOnMobile(media)
    return () => media.removeEventListener('change', closeOnMobile)
  }, [])
  return [open, setOpen]
}
