import {defineConfig} from '@playwright/test'
import {existsSync} from 'node:fs'

const venvPython = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python'
const python = existsSync(venvPython) ? venvPython : 'python'

// Uses the installed Microsoft Edge, so no browser download is needed.
// Start the API and web servers yourself, or let Playwright start them (sign-in disabled for local tests).
export default defineConfig({
  testDir:'e2e',
  testMatch:/.*\.spec\.mjs/,
  timeout:60_000,
  expect:{timeout:15_000},
  fullyParallel:false,
  workers:1,
  retries:0,
  reporter:[['list']],
  use:{baseURL:'http://localhost:3000', channel:'msedge', trace:'retain-on-failure', screenshot:'only-on-failure'},
  projects:[
    {name:'mobile', use:{viewport:{width:390, height:844}, isMobile:true, hasTouch:true}},
    {name:'desktop', use:{viewport:{width:1280, height:800}}},
  ],
  webServer:[
    {command:`${python} -m backend.run`,
      port:8000, reuseExistingServer:true, timeout:60_000, env:{REQUIRE_GOOGLE_SIGN_IN:'0', SECURE_COOKIES:'0'}},
    {command:'npm run dev', port:3000, reuseExistingServer:true, timeout:60_000},
  ],
})
