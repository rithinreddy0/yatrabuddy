import {chromium} from '@playwright/test'

// Launch the installed Edge. With GPU=1 the browser uses the machine's graphics card instead of
// software rendering, which gives realistic paint and layout timings.
export function launch() {
  const gpu = process.env.GPU === '1'
  return chromium.launch({
    channel:'msedge',
    args:gpu ? ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11'] : [],
  })
}
