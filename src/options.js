import { DEFAULTS, getSettings, originPattern, parseSourceList } from "./settings.js";

const sourcesInput = document.getElementById("sources");
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
  const { sources, intervalMinutes } = await getSettings();
  const { lastStatus } = await browser.storage.local.get({ lastStatus: null });
  sourcesInput.value = sources.join("\n");
  intervalInput.value = intervalMinutes;
  render(lastStatus);
}

document.getElementById("save").addEventListener("click", async () => {
  let sources;
  try {
    sources = parseSourceList(sourcesInput.value);
  } catch (err) {
    return fail(err.message);
  }
  const intervalMinutes = Math.max(1, Number(intervalInput.value) || DEFAULTS.intervalMinutes);

  // Host access is optional in the manifest, so the extension can only reach the
  // hosts the user actually lists. One request, before any await: Firefox only
  // shows the prompt while the click is still being handled.
  if (sources.length) {
    const origins = [...new Set(sources.map(originPattern))];
    if (!(await browser.permissions.request({ origins }))) {
      return fail(`permission denied for ${origins.join(", ")}`);
    }
  }

  await browser.storage.local.set({ sources, intervalMinutes });
  await browser.storage.local.remove("url");
  sourcesInput.value = sources.join("\n");
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
