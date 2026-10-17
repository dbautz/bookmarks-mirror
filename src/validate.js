// Firefox's root folder ids. Platform constants, not configuration.
export const ROOTS = {
  menu: "menu________",
  toolbar: "toolbar_____",
  other: "unfiled_____",
  mobile: "mobile______",
};

// Aliases let a 1 KB file expand into millions of nodes; a hand-kept bookmarks file
// never comes near these.
export const MAX_NODES = 10000;
export const MAX_DEPTH = 32;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Bookmarks get clicked, so only web URLs: a javascript:/data:/file: entry from a
// hostile file would run or open things in whatever page the user is on.
function checkUrl(value, where) {
  if (value !== value.trim()) throw new Error(`${where} has whitespace around its url`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${where} has an invalid url: ${value}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${where} must be an http(s) url, got ${url.protocol}`);
  }
}

// Throws on anything malformed — before the caller touches a single bookmark.
// Returns the number of bookmarks (not folders) seen.
//
// A node is a single-key mapping whose value decides what it is:
//   - Example: https://example.com/      string  -> bookmark
//   - Folder:                            list    -> folder
//       - …
export function validate(doc) {
  if (!isPlainObject(doc)) throw new Error("top level must be a mapping of root names");

  const names = Object.keys(doc);
  if (names.length === 0) throw new Error("no roots declared");

  // hasOwn, not `in`: `toString:` or `constructor:` must not pass as a root.
  const unknown = names.filter((n) => !Object.hasOwn(ROOTS, n));
  if (unknown.length) {
    throw new Error(`unknown root(s): ${unknown.join(", ")} — expected ${Object.keys(ROOTS).join(", ")}`);
  }

  let nodes = 0;

  const walk = (list, path, depth) => {
    if (!Array.isArray(list)) throw new Error(`${path} must be a list`);
    if (depth > MAX_DEPTH) throw new Error(`${path} nests deeper than ${MAX_DEPTH} folders`);

    let bookmarks = 0;
    list.forEach((node, i) => {
      const here = `${path}[${i}]`;
      if (++nodes > MAX_NODES) throw new Error(`more than ${MAX_NODES} entries`);
      if (!isPlainObject(node)) throw new Error(`${here} must be a "name: value" mapping`);

      const keys = Object.keys(node);
      if (keys.length !== 1) {
        throw new Error(`${here} must have exactly one key, found ${keys.length}: ${keys.join(", ")}`);
      }

      const title = keys[0];
      const value = node[title];

      if (typeof value === "string") {
        checkUrl(value, `${here} "${title}"`);
        bookmarks += 1;
      } else if (Array.isArray(value)) {
        bookmarks += walk(value, `${here} "${title}"`, depth + 1);
      } else {
        throw new Error(`${here} "${title}" must map to a url string or a list of children`);
      }
    });
    return bookmarks;
  };

  // The failsafe, per root rather than per file: a truncated `menu: []` next to a
  // healthy toolbar would otherwise pass and silently empty the menu. To leave a
  // root alone, omit it.
  let total = 0;
  for (const name of names) {
    const count = walk(doc[name], name, 1);
    if (count === 0) throw new Error(`refused: ${name} contains no bookmarks`);
    total += count;
  }
  return total;
}

// Several validated documents -> one: each root lists the first source's entries,
// then the next source's, in the order the sources are configured.
export function merge(docs) {
  const merged = {};
  for (const doc of docs) {
    for (const [name, nodes] of Object.entries(doc)) (merged[name] ??= []).push(...nodes);
  }
  return merged;
}
