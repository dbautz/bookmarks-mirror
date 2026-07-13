"use strict";

// Firefox's root folder ids. Platform constants, not configuration.
const ROOTS = {
  menu: "menu________",
  toolbar: "toolbar_____",
  other: "unfiled_____",
  mobile: "mobile______",
};

const DEFAULTS = { url: "", intervalMinutes: 30 };

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Throws on anything malformed. Returns the number of bookmarks (not folders) seen,
// which the caller uses as the refuse-to-wipe failsafe.
//
// A node is a single-key mapping whose value decides what it is:
//   - Proxmox VE: https://…      string  -> bookmark
//   - Infrastructure:            list    -> folder
//       - …
function validate(doc) {
  if (!isPlainObject(doc)) throw new Error("top level must be a mapping of root names");

  const names = Object.keys(doc);
  if (names.length === 0) throw new Error("no roots declared");

  const unknown = names.filter((n) => !(n in ROOTS));
  if (unknown.length) {
    throw new Error(`unknown root(s): ${unknown.join(", ")} — expected ${Object.keys(ROOTS).join(", ")}`);
  }

  let bookmarks = 0;

  const walk = (nodes, path) => {
    if (!Array.isArray(nodes)) throw new Error(`${path} must be a list`);

    nodes.forEach((node, i) => {
      const here = `${path}[${i}]`;
      if (!isPlainObject(node)) throw new Error(`${here} must be a "name: value" mapping`);

      const keys = Object.keys(node);
      if (keys.length !== 1) {
        throw new Error(`${here} must have exactly one key, found ${keys.length}: ${keys.join(", ")}`);
      }

      const title = keys[0];
      const value = node[title];

      if (typeof value === "string") {
        if (value === "") throw new Error(`${here} "${title}" has an empty url`);
        bookmarks += 1;
      } else if (Array.isArray(value)) {
        walk(value, `${here} "${title}"`);
      } else {
        throw new Error(`${here} "${title}" must map to a url string or a list of children`);
      }
    });
  };

  for (const name of names) walk(doc[name], name);

  return bookmarks;
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

async function sync() {
  const { url } = await browser.storage.local.get(DEFAULTS);
  if (!url) return setStatus(false, "no URL configured");

  let response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (err) {
    // Offline, VPN down, DNS — leave the existing bookmarks alone.
    return setStatus(false, `fetch failed: ${err.message}`);
  }
  if (!response.ok) return setStatus(false, `HTTP ${response.status}`);

  const text = await response.text();

  let doc;
  try {
    doc = jsyaml.load(text);
  } catch (err) {
    return setStatus(false, `invalid YAML: ${err.message}`);
  }

  let count;
  try {
    count = validate(doc);
  } catch (err) {
    return setStatus(false, `invalid file: ${err.message}`);
  }

  // The failsafe. Applying an empty file would silently delete every bookmark in
  // every root it names, so a truncated file must never be applied.
  if (count === 0) return setStatus(false, "refused: file contains no bookmarks");

  // Rebuilding churns bookmark ids, so only do it when the content actually moved.
  const hash = await sha256(text);
  const { lastHash } = await browser.storage.local.get({ lastHash: null });
  if (hash === lastHash) return setStatus(true, `unchanged (${count} bookmarks)`);

  for (const [name, nodes] of Object.entries(doc)) {
    await replaceRoot(ROOTS[name], nodes);
  }

  await browser.storage.local.set({ lastHash: hash });
  return setStatus(true, `synced ${count} bookmarks`);
}

async function rearm() {
  const { intervalMinutes } = await browser.storage.local.get(DEFAULTS);
  await browser.alarms.clear("sync");
  browser.alarms.create("sync", { periodInMinutes: Math.max(1, intervalMinutes) });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync") sync();
});

browser.action.onClicked.addListener(() => sync());

browser.runtime.onStartup.addListener(async () => {
  await rearm();
  await sync();
});

browser.runtime.onInstalled.addListener(async () => {
  await rearm();
  await sync();
});

// The options page asks for a sync or a re-arm after the user saves.
browser.runtime.onMessage.addListener((msg) => {
  if (msg === "sync") return sync().then(() => browser.storage.local.get({ lastStatus: null }));
  if (msg === "rearm") return rearm();
});
