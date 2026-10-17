import { CORE_SCHEMA, load as parseYaml } from "js-yaml";

import { DEFAULTS, parseSourceUrl } from "./settings.js";
import { ROOTS, validate } from "./validate.js";

// A bookmarks file is a few KB; anything this size is not one.
const MAX_BYTES = 1024 * 1024;

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Sequential on purpose: browser.bookmarks.create appends, so ordering the awaits
// is what preserves the order of the file.
async function create(parentId, nodes) {
  for (const node of nodes) {
    const title = Object.keys(node)[0];
    const value = node[title];

    if (Array.isArray(value)) {
      const folder = await browser.bookmarks.create({ parentId, title });
      await create(folder.id, value);
    } else {
      await browser.bookmarks.create({ parentId, title, url: value });
    }
  }
}

async function replaceRoot(rootId, nodes) {
  for (const child of await browser.bookmarks.getChildren(rootId)) {
    await browser.bookmarks.removeTree(child.id);
  }
  await create(rootId, nodes);
}

async function setStatus(ok, message) {
  await browser.storage.local.set({
    lastStatus: { ok, message, at: new Date().toISOString() },
  });
  await browser.action.setBadgeText({ text: ok ? "" : "!" });
  await browser.action.setBadgeBackgroundColor({ color: "#c0392b" });
  await browser.action.setTitle({
    title: ok ? `Bookmarks Mirror — ${message}` : `Bookmarks Mirror — FAILED: ${message}`,
  });
}

// `force` skips the unchanged-content shortcut, so a manual sync repairs a root that
// was edited in the browser even though the file did not move.
async function run({ force }) {
  const { url } = await browser.storage.local.get(DEFAULTS);
  if (!url) return setStatus(false, "no URL configured");
  try {
    parseSourceUrl(url);
  } catch (err) {
    return setStatus(false, err.message);
  }

  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (err) {
    // Offline, VPN down, DNS — leave the existing bookmarks alone.
    return setStatus(false, `fetch failed: ${err.message}`);
  }
  if (!response.ok) return setStatus(false, `HTTP ${response.status}`);

  const text = await response.text();
  if (text.length > MAX_BYTES) return setStatus(false, `refused: file is over ${MAX_BYTES} bytes`);

  // Core schema: YAML 1.2 typing (`No:` stays a string) and no merge keys or !!omap,
  // the two constructs js-yaml can be made to spend quadratic time on.
  let doc;
  try {
    doc = parseYaml(text, { schema: CORE_SCHEMA });
  } catch (err) {
    return setStatus(false, `invalid YAML: ${err.message}`);
  }

  let count;
  try {
    count = validate(doc);
  } catch (err) {
    return setStatus(false, `invalid file: ${err.message}`);
  }

  // Rebuilding churns bookmark ids, so only do it when the content actually moved.
  const hash = await sha256(text);
  const { lastHash } = await browser.storage.local.get({ lastHash: null });
  if (!force && hash === lastHash) return setStatus(true, `unchanged (${count} bookmarks)`);

  // lastHash is only written after every root is rebuilt, so an interrupted apply
  // is retried on the next sync rather than recorded as done.
  for (const [name, nodes] of Object.entries(doc)) {
    await replaceRoot(ROOTS[name], nodes);
  }
  await browser.storage.local.set({ lastHash: hash });
  return setStatus(true, `synced ${count} bookmarks`);
}

// One sync at a time. Two overlapping rebuilds of the same root interleave their
// removes and creates and leave duplicates behind — a double-click is enough.
let running = null;

function sync({ force = false } = {}) {
  running ??= run({ force })
    .catch((err) => setStatus(false, `sync failed: ${err.message}`))
    .finally(() => {
      running = null;
    });
  return running;
}

async function rearm() {
  const { intervalMinutes } = await browser.storage.local.get(DEFAULTS);
  await browser.alarms.clear("sync");
  browser.alarms.create("sync", { periodInMinutes: intervalMinutes });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync") sync();
});

// The toolbar button opens the settings; "Sync now" lives there, next to the status.
browser.action.onClicked.addListener(() => browser.runtime.openOptionsPage());

browser.runtime.onStartup.addListener(async () => {
  await rearm();
  await sync();
});

browser.runtime.onInstalled.addListener(async ({ reason }) => {
  await rearm();
  const { url } = await browser.storage.local.get(DEFAULTS);
  if (!url && reason === "install") return browser.runtime.openOptionsPage();
  await sync();
});

// The options page asks for a sync or a re-arm after the user saves.
browser.runtime.onMessage.addListener((msg) => {
  if (msg === "sync") return sync({ force: true }).then(() => browser.storage.local.get({ lastStatus: null }));
  if (msg === "rearm") return rearm();
});
