// Shared by the background script and the options page; esbuild inlines it into both.
export const DEFAULTS = { sources: [], intervalMinutes: 30 };

// 1.0.x stored a single `url`. Read-only fallback rather than a migration, so nothing
// writes at startup and nothing can race the options page; its Save drops `url`.
export async function getSettings() {
  const stored = await browser.storage.local.get({ ...DEFAULTS, url: "" });
  const sources = stored.sources.length === 0 && stored.url ? [stored.url] : stored.sources;
  return { sources, intervalMinutes: stored.intervalMinutes };
}

// Returns the parsed source URL or throws a message fit for the status box. https
// only: anyone on the path of an http fetch could rewrite every root the file names.
export function parseSourceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`not a valid URL: ${value}`);
  }
  if (url.protocol !== "https:") throw new Error("the URL must start with https://");
  return url;
}

// The options page's text box: one URL per line, blank lines ignored. A URL listed
// twice would put its bookmarks in twice, so that is an error too.
export function parseSourceList(text) {
  const urls = [];
  const seen = new Set();
  for (const [i, line] of text.split("\n").entries()) {
    const value = line.trim();
    if (!value) continue;
    // `new URL` would quietly encode a space, turning two pasted URLs into one.
    if (/\s/.test(value)) throw new Error(`line ${i + 1}: one URL per line`);
    let href;
    try {
      href = parseSourceUrl(value).href;
    } catch (err) {
      throw new Error(`line ${i + 1}: ${err.message}`);
    }
    // Normalized, so `https://A.example/x#` is caught as a repeat of `https://a.example/x`.
    if (seen.has(href.replace(/#$/, ""))) throw new Error(`line ${i + 1}: listed twice`);
    seen.add(href.replace(/#$/, ""));
    urls.push(value);
  }
  return urls;
}

// How a source appears in status messages: no query or credentials, which may hold a
// token and would otherwise show up in the toolbar tooltip.
export function describeSource(value) {
  const url = new URL(value);
  return `${url.host}${url.pathname}`;
}

// Host permission pattern for a source. No port: Firefox match patterns cannot carry
// one, and a pattern with a port matches nothing.
export function originPattern(value) {
  const url = parseSourceUrl(value);
  return `${url.protocol}//${url.hostname}/*`;
}
