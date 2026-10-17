import { DEFAULTS, parseSourceUrl } from "./settings.js";

const urlInput = document.getElementById("url");
const intervalInput = document.getElementById("interval");
const statusBox = document.getElementById("status");

function render(status) {
  if (!status) {
    statusBox.textContent = "Not synced yet.";
    statusBox.className = "";
    return;
  }
  const when = new Date(status.at).toLocaleString();
  statusBox.textContent = `${status.ok ? "OK" : "FAILED"} — ${status.message} (${when})`;
  statusBox.className = status.ok ? "ok" : "err";
}

const fail = (message) => render({ ok: false, message, at: new Date().toISOString() });

async function load() {
  const { url, intervalMinutes, lastStatus } = await browser.storage.local.get({
    ...DEFAULTS,
    lastStatus: null,
  });
  urlInput.value = url;
  intervalInput.value = intervalMinutes;
  render(lastStatus);
}

document.getElementById("save").addEventListener("click", async () => {
  const url = urlInput.value.trim();
  const intervalMinutes = Math.max(1, Number(intervalInput.value) || DEFAULTS.intervalMinutes);

  // Host access is optional in the manifest, so the extension can only reach the
  // one host the user actually points it at. No port: Firefox match patterns
  // cannot carry one, and a pattern with a port matches nothing.
  if (url) {
    let parsed;
    try {
      parsed = parseSourceUrl(url);
    } catch (err) {
      return fail(err.message);
    }
    const origin = `${parsed.protocol}//${parsed.hostname}/*`;
    if (!(await browser.permissions.request({ origins: [origin] }))) {
      return fail(`permission denied for ${origin}`);
    }
  }

  await browser.storage.local.set({ url, intervalMinutes });
  await browser.runtime.sendMessage("rearm");
  render({ ok: true, message: "settings saved", at: new Date().toISOString() });
});

document.getElementById("syncNow").addEventListener("click", async () => {
  statusBox.textContent = "Syncing…";
  statusBox.className = "";
  const { lastStatus } = await browser.runtime.sendMessage("sync");
  render(lastStatus);
});

load();
