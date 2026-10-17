import { CORE_SCHEMA, load as parseYaml } from "js-yaml";

import { describeSource, getSettings, parseSourceUrl } from "./settings.js";
import { MAX_NODES, ROOTS, merge, validate } from "./validate.js";

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

// Fetch, parse and validate one source. Throws a message fit for the status box.
async function loadSource(url) {
  parseSourceUrl(url);

  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (err) {
    throw new Error(`fetch failed: ${err.message}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  if (text.length > MAX_BYTES) throw new Error(`refused: file is over ${MAX_BYTES} bytes`);

  // Core schema: YAML 1.2 typing (`No:` stays a string) and no merge keys or !!omap,
  // the two constructs js-yaml can be made to spend quadratic time on.
  let doc;
  try {
    doc = parseYaml(text, { schema: CORE_SCHEMA });
  } catch (err) {
    throw new Error(`invalid YAML: ${err.message}`);
  }

  let count;
  try {
    count = validate(doc);
  } catch (err) {
    throw new Error(`invalid file: ${err.message}`);
  }
  return { text, doc, count };
}

// `force` skips the unchanged-content shortcut, so a manual sync repairs a root that
// was edited in the browser even though no file moved.
async function run({ force }) {
  const { sources } = await getSettings();
  if (sources.length === 0) return setStatus(false, "no source configured");

  // All or nothing. A source that cannot be read (offline, VPN down, broken file)
  // leaves every root alone: there is no telling which roots it would have filled.
  const loaded = [];
  for (const [i, url] of sources.entries()) {
    try {
      loaded.push(await loadSource(url));
    } catch (err) {
      return setStatus(false, `source ${i + 1} (${describeSource(url)}): ${err.message}`);
    }
  }

  const count = loaded.reduce((sum, s) => sum + s.count, 0);
  if (count > MAX_NODES) return setStatus(false, `refused: more than ${MAX_NODES} bookmarks across all sources`);
  const summary = `${count} bookmarks from ${sources.length} source${sources.length === 1 ? "" : "s"}`;

  // Rebuilding churns bookmark ids, so only do it when some content actually moved.
  // Ordered, so reordering sources is a real change. NUL-joined: YAML forbids NUL, so
  // the join is unambiguous, and one source hashes exactly as 1.0.x did — upgrading
  // does not rebuild.
  const hash = await sha256(loaded.map((s) => s.text).join("\0"));
  const { lastHash } = await browser.storage.local.get({ lastHash: null });
  if (!force && hash === lastHash) return setStatus(true, `unchanged (${summary})`);

  // lastHash is only written after every root is rebuilt, so an interrupted apply
  // is retried on the next sync rather than recorded as done.
  for (const [name, nodes] of Object.entries(merge(loaded.map((s) => s.doc)))) {
    await replaceRoot(ROOTS[name], nodes);
  }
  await browser.storage.local.set({ lastHash: hash });
  return setStatus(true, `synced ${summary}`);
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
  const { intervalMinutes } = await getSettings();
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
  const { sources } = await getSettings();
  if (sources.length === 0 && reason === "install") return browser.runtime.openOptionsPage();
  await sync();
});

// The options page asks for a sync or a re-arm after the user saves.
browser.runtime.onMessage.addListener((msg) => {
  if (msg === "sync") return sync({ force: true }).then(() => browser.storage.local.get({ lastStatus: null }));
  if (msg === "rearm") return rearm();
});
