// Analytics, advertising, error-monitoring and session-replay beacons. Pages
// send them on their own schedule and on form interactions (Google Ads
// form_start, Amplitude batches), so they say nothing about whether an input
// reached the app or what the app stored. Their URLs carry visitor ids and
// hashed emails.
const HOSTS = [
  "google-analytics.com", "analytics.google.com", "googletagmanager.com", "googleadservices.com",
  "googlesyndication.com", "doubleclick.net", "clarity.ms", "bat.bing.com",
  "segment.io", "segment.com", "amplitude.com", "mixpanel.com", "heapanalytics.com",
  "hotjar.com", "hotjar.io", "fullstory.com", "sentry.io", "bugsnag.com", "nr-data.net",
  "posthog.com", "lr-ingest.io", "px.ads.linkedin.com", "analytics.tiktok.com",
  "hm.baidu.com", "cnzz.com", "umeng.com", "growingio.com", "sensorsdata.cn",
  "mc.yandex.ru", "mc.yandex.com", "plausible.io",
];
const DATADOG = /(^|\.)browser-intake-([a-z0-9]+-)?datadoghq\.(com|eu)$/;
// Google also serves ad and analytics beacons from www.google.<tld>.
const GOOGLE = /(^|\.)google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/;
const GOOGLE_BEACON = /^\/(ccm|rmkt|measurement|pagead|ads|g\/collect|j\/collect|collect)(\/|$)/i;

export function trackerRequest(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  const host = url.hostname.toLowerCase();
  return HOSTS.some((h) => host === h || host.endsWith(`.${h}`)) || DATADOG.test(host)
    || GOOGLE.test(host) && GOOGLE_BEACON.test(url.pathname)
    || /(^|\.)facebook\.com$/.test(host) && /^\/tr\/?$/i.test(url.pathname);
}
