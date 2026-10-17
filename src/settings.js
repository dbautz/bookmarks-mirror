// Shared by the background script and the options page; esbuild inlines it into both.
export const DEFAULTS = { url: "", intervalMinutes: 30 };

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
