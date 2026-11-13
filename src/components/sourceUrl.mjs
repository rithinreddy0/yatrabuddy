export function visibleSource(url) {
  try {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    if (/(^|\.)openstreetmap\.org$/i.test(parsed.hostname) && parsed.pathname !== '/copyright') return null
    return parsed
  } catch {
    return null
  }
}
