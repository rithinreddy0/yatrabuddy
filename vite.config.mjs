import {defineConfig} from 'vite'
const apiTarget=process.env.WAYFARER_API_TARGET||'http://127.0.0.1:8000'
export default defineConfig({
  server:{host:'127.0.0.1',port:3000,strictPort:true,proxy:{'/api':apiTarget}},
  preview:{host:'127.0.0.1',port:3000,strictPort:true,proxy:{'/api':apiTarget}}
})
