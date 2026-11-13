import test from 'node:test'
import assert from 'node:assert/strict'
import {needsOnboarding} from './authGate.mjs'

test('does not interrupt entry while a signed-in profile is still loading',()=>{
  assert.equal(needsOnboarding({id:'returning'}, {profile:null}, false), false)
})

test('starts setup after a loaded library confirms a new account has no profile',()=>{
  assert.equal(needsOnboarding({id:'new'}, {profile:null}, true), true)
})

test('takes returning users directly into the app when their profile is loaded',()=>{
  assert.equal(needsOnboarding({id:'returning'}, {profile:{preferredName:'Traveler'}}, true), false)
})

test('does not show account setup to signed-out users',()=>{
  assert.equal(needsOnboarding(null, {profile:null}, true), false)
})
