/** Trust the application's configured URL, never client-supplied Forwarded headers. */
export function isCalendarWriteOriginAllowed(origin: string | null, requestOrigin: string, configuredUrl = process.env.AUTH_URL || process.env.AGILECAMPUS_URL) {
  if (!origin || origin === requestOrigin) return true;
  try { return !!configuredUrl && new URL(configuredUrl).origin === origin; } catch { return false; }
}
