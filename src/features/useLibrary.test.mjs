import test from 'node:test'
import assert from 'node:assert/strict'
import {markLibraryDirty,readRecoveryBackups,writeRecoveryBackup} from './useLibrary.mjs'

class MemoryStorage {
  values=new Map()
  failMeta=false
  get length(){return this.values.size}
  key(index){return [...this.values.keys()][index]??null}
  getItem(key){return this.values.get(String(key))??null}
  setItem(key,value){
    key=String(key)
    if(this.failMeta&&key.startsWith('wayfarer.account-meta.'))throw new Error('Metadata storage unavailable')
    this.values.set(key,String(value))
  }
  removeItem(key){this.values.delete(String(key))}
}

function withStorage(t,storage) {
  const original=Object.getOwnPropertyDescriptor(globalThis,'localStorage')
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:storage})
  t.after(()=>{
    if(original)Object.defineProperty(globalThis,'localStorage',original)
    else delete globalThis.localStorage
  })
}

const library=profile=>({trips:[],drafts:[],saved:[],style:'Balanced',profile,sampleExpenses:[]})

test('a metadata failure stores a uniquely keyed recovery snapshot with its base revision',t=>{
  const storage=new MemoryStorage()
  storage.failMeta=true
  withStorage(t,storage)
  const first=library({preferredName:'Ari'})
  const second=library({preferredName:'Ari',homeCity:'Pune'})

  assert.equal(markLibraryDirty('traveler-1',first,12,true),true)
  assert.equal(markLibraryDirty('traveler-1',second,12,true),true)

  const backups=readRecoveryBackups('traveler-1')
  assert.equal(backups.length,2)
  assert.deepEqual(backups.map(item=>item.baseRevision),[12,12])
  assert.deepEqual(new Set(backups.map(item=>item.key)).size,2)
  assert.equal(backups.some(item=>item.library.profile.homeCity==='Pune'),true)
})

test('a failed data-cache write does not queue a dirty marker or backup',t=>{
  const storage=new MemoryStorage()
  withStorage(t,storage)

  assert.equal(markLibraryDirty('traveler-2',library(null),4,false),false)
  assert.deepEqual(readRecoveryBackups('traveler-2'),[])
  assert.equal(storage.getItem('wayfarer.account-meta.traveler-2'),null)
})

test('conflict backups retain different snapshots at the same base revision',t=>{
  const storage=new MemoryStorage()
  withStorage(t,storage)
  const local=library({preferredName:'Ari'})
  const other=library({preferredName:'Ari',homeCity:'Pune'})

  assert.equal(writeRecoveryBackup('traveler-3',local,8,'revision-conflict'),true)
  assert.equal(writeRecoveryBackup('traveler-3',other,8,'revision-conflict'),true)

  const backups=readRecoveryBackups('traveler-3')
  assert.equal(backups.length,2)
  assert.deepEqual(backups.map(item=>item.baseRevision),[8,8])
  assert.ok(backups.every(item=>item.reason==='revision-conflict'))
})
