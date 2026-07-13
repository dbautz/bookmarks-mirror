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

// Throws on anything malformed. Returns the number of bookmarks (not folders) seen,
// which the caller uses as the refuse-to-wipe failsafe.
function validate(doc) {
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("top level must be an object keyed by root name");
  }

  const names = Object.keys(doc);
  if (names.length === 0) throw new Error("no roots declared");

  const unknown = names.filter((n) => !(n in ROOTS));
  if (unknown.length) {
    throw new Error(`unknown root(s): ${unknown.join(", ")} — expected ${Object.keys(ROOTS).join(", ")}`);
  }

  let bookmarks = 0;

  const walk = (nodes, path) => {
    if (!Array.isArray(nodes)) throw new Error(`${path} must be an array`);
    nodes.forEach((node, i) => {
      const here = `${path}[${i}]`;
      if (node === null || typeof node !== "object") throw new Error(`${here} must be an object`);
      if (typeof node.title !== "string" || node.title === "") throw new Error(`${here} needs a title`);

      const isFolder = "children" in node;
      const isBookmark = "url" in node;
      if (isFolder && isBookmark) throw new Error(`${here} has both url and children`);

      if (isFolder) {
        walk(node.children, `${here}.children`);
      } else if (isBookmark) {
        if (typeof node.url !== "string" || node.url === "") throw new Error(`${here} needs a url`);
        bookmarks += 1;
      } else {
        throw new Error(`${here} has neither url nor children`);
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
    if ("children" in node) {
      const folder = await browser.bookmarks.create({ parentId, title: node.title });
      await create(folder.id, node.children);
    } else {
      await browser.bookmarks.create({ parentId, title: node.title, url: node.url });
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
    doc = JSON.parse(text);
  } catch (err) {
    return setStatus(false, `invalid JSON: ${err.message}`);
  }

  let count;
  try {
    count = validate(doc);
  } catch (err) {
    return setStatus(false, `invalid file: ${err.message}`);
  }

  // The failsafe. Applying an empty file would silently delete every bookmark in
  // every root it names, so a truncated file or a stray "{}" must never be applied.
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
