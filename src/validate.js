"use strict";

// Firefox's root folder ids. Platform constants, not configuration.
export const ROOTS = {
  menu: "menu________",
  toolbar: "toolbar_____",
  other: "unfiled_____",
  mobile: "mobile______",
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Throws on anything malformed. Returns the number of bookmarks (not folders) seen,
// which the caller uses as the refuse-to-wipe failsafe.
//
// A node is a single-key mapping whose value decides what it is:
//   - Proxmox VE: https://…      string  -> bookmark
//   - Infrastructure:            list    -> folder
//       - …
export function validate(doc) {
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
