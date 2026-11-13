export async function request(path, {method='GET', body, signal}={}) {
  const deadline=AbortSignal.timeout(24000)
  const fetchSignal=signal?AbortSignal.any([signal,deadline]):deadline
  let response
  try{
    response=await fetch('/api/'+path,{method,signal:fetchSignal,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined})
  }catch(error){
    if(deadline.aborted&&!signal?.aborted)throw new Error('The source took too long to respond. Try again.')
    throw error
  }
  const data = await response.json().catch(()=>null)
  if (!response.ok) {
    const detail = typeof data?.detail==='string' ? data.detail : data?.detail?.[0]?.msg
    throw Object.assign(new Error(detail || 'The service is unavailable. Please try again.'), {status:response.status})
  }
  return data
}

const publicResults = /^(?:yatra\/(?:weather|exchange)(?:\?|$)|road-route$|places\/search\?)/

export async function travelData(path, options = {}) {
  if (!publicResults.test(path)) throw new Error('Unsupported travel data request')
  const key = new URL('/__yatra_cache/' + path, location.origin)
  key.searchParams.set('input', JSON.stringify(options.body ?? null))
  const cacheKey = new Request(key)
  const cache = await globalThis.caches?.open('yatra-public-results-v1').catch(() => null)
  let result
  try {
    result = await request(path, options)
  } catch (error) {
    if (options.signal?.aborted || (error.status && error.status < 500)) throw error
    const previous = await cache?.match(cacheKey).then(response => response?.json()).catch(() => null)
    if (previous) return {...previous, freshness: 'cached', cached: true}
    throw error
  }
  const previous = await cache?.match(cacheKey).then(response => response?.json()).catch(() => null)
  if (!result || result.freshness === 'simulated' || result.status === 'unavailable') {
    if (previous) return {...previous, freshness: 'cached', cached: true}
    return result
  }
  const data = {...result, freshness: result.freshness || 'live',
    retrievedAt: result.retrievedAt || new Date().toISOString()}
  if (data.cacheable !== false) {
    try {
      await cache?.put(cacheKey, Response.json(data))
      const keys = await cache?.keys() ?? []
      await Promise.all(keys.slice(0, Math.max(0, keys.length - 100)).map(key => cache.delete(key)))
    } catch { /* public results are still usable without disk cache */ }
  }
  return data
}

export function freshnessLabel(data) {
  if (data.freshness === 'simulated') return 'SIMULATED'
  if (data.freshness === 'cached') {
    const time = new Date(data.retrievedAt).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    })
    return 'CACHED · ' + time + ' IST'
  }
  return 'LIVE'
}
