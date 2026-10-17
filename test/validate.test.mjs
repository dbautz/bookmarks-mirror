import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CORE_SCHEMA, load as loadYaml } from "js-yaml";

import { MAX_DEPTH, MAX_NODES, merge, validate } from "../src/validate.js";

// Same parse as background.js — the schema is part of what is being tested.
const load = (text) => loadYaml(text, { schema: CORE_SCHEMA });
const check = (text) => validate(load(text));

// The shapes the format allows. Anything else must throw rather than sync,
// because a file that parses but means something else silently rewrites roots.
test("counts bookmarks, not folders, at any depth", () => {
  const doc = `
menu:
  - Folder:
      - A: https://a.example/
      - Nested:
          - B: http://b.example/
  - C: https://c.example/
`;
  assert.equal(check(doc), 3);
});

test("accepts every root, and only the four real ones", () => {
  assert.equal(check("toolbar:\n  - A: https://a/\nmobile:\n  - B: https://b/\n"), 2);
  assert.throws(() => check("bookmarks_bar:\n  - A: https://a/\n"), /unknown root/);
  // Inherited names must not pass as roots: ROOTS.toString is a function, not an id.
  for (const name of ["toString", "constructor", "hasOwnProperty"]) {
    assert.throws(() => check(`${name}:\n  - A: https://a/\n`), /unknown root/);
  }
});

test("refuses a file that would wipe roots", () => {
  assert.throws(() => check("menu: []"), /menu contains no bookmarks/);
  assert.throws(() => check("menu:\n  - F: []\n  - G:\n      - H: []\n"), /menu contains no bookmarks/);
  assert.throws(() => check("{}"), /no roots declared/);
  assert.throws(() => check(""), /top level must be a mapping/);
  assert.throws(() => check("- a\n- b"), /top level must be a mapping/);
});

test("refuses an empty root even when another root has bookmarks", () => {
  // A truncated menu next to a healthy toolbar must not empty the menu.
  assert.throws(() => check("menu: []\ntoolbar:\n  - A: https://a/\n"), /menu contains no bookmarks/);
});

test("refuses a malformed node rather than guessing", () => {
  assert.throws(() => check("menu:\n  - A: https://a/\n    B: https://b/\n"), /exactly one key/);
  assert.throws(() => check("menu:\n  - A: 42\n"), /url string or a list/);
  assert.throws(() => check("menu:\n  - A:\n"), /url string or a list/);
  assert.throws(() => check("menu:\n  - A:\n      B: https://b/\n"), /url string or a list/);
  assert.throws(() => check("menu:\n  - plain string\n"), /"name: value" mapping/);
  assert.throws(() => check("menu:\n  A: https://a/\n"), /must be a list/);
  assert.throws(() => check("menu:\n"), /must be a list/);
});

test("accepts only http(s) urls", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "place:sort=8", "about:config"]) {
    assert.throws(() => check(`menu:\n  - A: "${url}"\n`), /must be an http\(s\) url/, url);
  }
  assert.throws(() => check('menu:\n  - A: ""\n'), /invalid url/);
  assert.throws(() => check("menu:\n  - A: example.com/no-scheme\n"), /invalid url/);
  assert.throws(() => check('menu:\n  - A: " https://a/ "\n'), /whitespace/);
});

// Merge keys and !!omap are where js-yaml can be pushed into quadratic time; the core
// schema does not know them, so they cannot reach validate() as anything but junk.
test("core schema: no merge keys, no !!omap", () => {
  assert.throws(() => check("menu:\n  - <<: {A: https://a/}\n"), /url string or a list/);
  assert.throws(() => check("menu: !!omap [ {A: https://a/} ]\n"), /unknown tag/);
});

test("caps alias expansion and nesting", () => {
  // ~10^5 nodes from a few hundred bytes.
  let yaml = "menu:\n  - L0: &a0 [ {A: https://a/} ]\n";
  for (let i = 1; i <= 5; i++) {
    yaml += `  - L${i}: &a${i} [ ${Array(10).fill(`{F: *a${i - 1}}`).join(", ")} ]\n`;
  }
  assert.throws(() => check(yaml), new RegExp(`more than ${MAX_NODES} entries`));

  let deep = "menu:\n";
  for (let i = 0; i <= MAX_DEPTH; i++) deep += `${"  ".repeat(i + 1)}- F${i}:\n`;
  deep += `${"  ".repeat(MAX_DEPTH + 2)}- A: https://a/\n`;
  assert.throws(() => check(deep), /nests deeper than/);
});

// The reason for YAML 1.2 core schema: a title like `No` or `Off` must stay a string.
// Under YAML 1.1 it would parse as a boolean and the node would be unrecognisable.
test("keeps 1.1 boolean-ish titles as strings", () => {
  const doc = load("menu:\n  - No: https://no.example/\n  - Off: https://off.example/\n");
  assert.deepEqual(Object.keys(doc.menu[0]), ["No"]);
  assert.equal(validate(doc), 2);
});

// AMO reviewers test against this file; it must stay valid.
test("example/bookmarks.yml is a valid file", () => {
  assert.equal(check(readFileSync(new URL("../example/bookmarks.yml", import.meta.url), "utf8")), 3);
});

test("merge concatenates each root in source order", () => {
  const a = load("menu:\n  - A: https://a/\ntoolbar:\n  - T: https://t/\n");
  const b = load("menu:\n  - B: https://b/\nother:\n  - O: https://o/\n");
  assert.deepEqual(merge([a, b]), {
    menu: [{ A: "https://a/" }, { B: "https://b/" }],
    toolbar: [{ T: "https://t/" }],
    other: [{ O: "https://o/" }],
  });
  assert.deepEqual(merge([b, a]).menu, [{ B: "https://b/" }, { A: "https://a/" }]);
  // The inputs are not touched: a later sync must not see entries doubled.
  assert.deepEqual(a.menu, [{ A: "https://a/" }]);
});
