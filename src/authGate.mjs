export function needsOnboarding(user, library, profileReady) {
  return Boolean(user && profileReady && !library?.profile)
}
