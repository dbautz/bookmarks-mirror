import assert from "node:assert/strict";
import test from "node:test";

import { load } from "js-yaml";

import { validate } from "../src/validate.js";

// The shapes the format allows. Anything else must throw rather than sync,
// because a file that parses but means something else silently rewrites roots.
test("counts bookmarks, not folders, at any depth", () => {
  const doc = load(`
menu:
  - Infrastructure:
      - Proxmox VE: https://proxmox.home.dbautz.com/
      - Nested:
          - NAS: https://nas.home.dbautz.com/
  - Twitch: https://www.twitch.tv/
`);
  assert.equal(validate(doc), 3);
});

test("accepts every root, and only the four real ones", () => {
  const ok = load("toolbar:\n  - A: https://a/\nmobile:\n  - B: https://b/\n");
  assert.equal(validate(ok), 2);
  assert.throws(() => validate(load("bookmarks_bar:\n  - A: https://a/\n")), /unknown root/);
});

test("refuses a file that would wipe roots", () => {
  // 0 is not an error here — sync() treats it as the refuse-to-apply signal.
  assert.equal(validate(load("menu: []")), 0);
  assert.throws(() => validate(load("{}")), /no roots declared/);
  assert.throws(() => validate(load("")), /top level must be a mapping/);
  assert.throws(() => validate(load("- a\n- b")), /top level must be a mapping/);
});

test("refuses a malformed node rather than guessing", () => {
  assert.throws(() => validate(load("menu:\n  - A: https://a/\n    B: https://b/\n")), /exactly one key/);
  assert.throws(() => validate(load('menu:\n  - A: ""\n')), /empty url/);
  assert.throws(() => validate(load("menu:\n  - A: 42\n")), /url string or a list/);
  assert.throws(() => validate(load("menu:\n  - plain string\n")), /"name: value" mapping/);
  assert.throws(() => validate(load("menu:\n  A: https://a/\n")), /must be a list/);
});

// The reason the file is YAML 1.2 core schema: a title like `No` or `Off` must stay
// a string. Under YAML 1.1 it would parse as a boolean and the node would be
// unrecognisable as a bookmark.
test("keeps 1.1 boolean-ish titles as strings", () => {
  const doc = load("menu:\n  - No: https://no.example/\n  - Off: https://off.example/\n");
  assert.deepEqual(Object.keys(doc.menu[0]), ["No"]);
  assert.equal(validate(doc), 2);
});
