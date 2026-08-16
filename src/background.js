"use strict";

import { load as parseYaml } from "js-yaml";

import { ROOTS, validate } from "./validate.js";

const DEFAULTS = { url: "", intervalMinutes: 30 };

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
    doc = parseYaml(text);
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
