/* GA4 events — same names as v1, tagged with the gallery version so v1/v2 can be compared. */
declare global { interface Window { gtag?: (...args: unknown[]) => void } }

export function track(name: string, params: Record<string, unknown> = {}) {
  try { window.gtag?.('event', name, { transport_type: 'beacon', gallery_version: 'v2', ...params }); } catch { /* analytics blocked */ }
}
