<p align="center">
  <img src="src/icon.svg" width="96" alt="">
</p>

<h1 align="center">Bookmarks Mirror</h1>

<p align="center">
  Keep Firefox bookmarks in a YAML file. The browser follows the file.<br>
  <a href="https://addons.mozilla.org/firefox/addon/bookmarks-mirror/">Install from addons.mozilla.org</a>
</p>

---

Write your bookmarks as plain YAML, put the file anywhere reachable over `https://`
(a git repo's raw URL, a web server, a gist) and point the add-on at it. Firefox
mirrors it, re-checking every 30 minutes (configurable).

- **One-way, read-only.** The add-on only ever fetches. Nothing is uploaded, nothing is
  written back, no account.
- **Several files.** List more than one URL — say, personal and work — and they are
  combined in order.
- **Safe by default.** Every file is validated before a single bookmark is touched. A
  broken, truncated or unreachable file changes nothing.
- **Only what you name.** The file says which roots it owns (menu, toolbar, …); the
  rest of your bookmarks are never touched.

## Quick start

1. Install the add-on. Its settings open on first install; later, click the toolbar
   button.
2. Paste the URL of your bookmarks file, **Save**, and allow access to that host.
3. **Sync now.**

To try it without writing a file, use the example:
`https://raw.githubusercontent.com/dbautz/bookmarks-mirror/main/example/bookmarks.yml`
(it replaces your Bookmarks Toolbar).

## File format

A node is a **single-key mapping**; the value decides what it is — a string is a
bookmark, a list is a folder.

```yaml
menu:
  - News:
      - Hacker News: https://news.ycombinator.com/
      - LWN: https://lwn.net/
  - Mozilla: https://www.mozilla.org/
toolbar:
  - MDN: https://developer.mozilla.org/
```

Top-level keys are the roots the file owns: `menu` (Bookmarks Menu), `toolbar`,
`other` (Other Bookmarks), `mobile`. One line per bookmark, so removing one is deleting
a line. Full example: [`example/bookmarks.yml`](example/bookmarks.yml).

YAML 1.2 core schema: `No:` stays the title "No". Anchors and aliases work; merge keys
(`<<`) and tags like `!!omap` do not.

## Several sources

One URL per line in the settings. When more than one file names the same root, the
root lists the first file's entries, then the second's, in the order of the list.

```text
https://example.com/personal.yml     menu: Personal stuff…
https://example.org/work.yml         menu: …then work stuff;  toolbar: work only
```

## Rules

- Every root the files name is **replaced wholesale** when a file changes, and on every
  **Sync now**. Bookmarks added in the browser inside those roots are deleted then —
  edit the file, not the browser.
- Roots no file names are never touched. Dropping a root from all files leaves its
  current bookmarks in place.
- Automatic checks skip unchanged files, so bookmarks are only rebuilt on a real edit.
- **All or nothing.** If any source cannot be fetched or fails validation, nothing
  changes and the toolbar button shows `!` (the settings page says why). Refused:
  - a root with no bookmarks — a truncated file must not empty it;
  - a bookmark url that is not `http://` or `https://`;
  - unknown roots, malformed entries, more than 10 000 entries, folders nested deeper
    than 32, a file over 1 MB.
- Source URLs must be `https://`. Host access is requested for exactly the hosts you
  list.

## Firefox Sync and Android

Run the mirror on **one** Firefox. With Sync's bookmarks on, the result reaches your
other devices, including Android — which can't run it itself (Firefox for Android has
no bookmarks API). Two mirrors rebuilding the same roots make Sync merge competing
copies.

## Build

Requires Firefox 140+. `src/` is the source, `dist/` is generated: esbuild bundles
`src/background.js` and `src/options.js` with their imports and js-yaml (pinned in
`package-lock.json`) into one unminified file each; `manifest.json`, `options.html` and
`icon.svg` are copied. Never edit `dist/`.

Reproduce a release build (Linux, Node 24, npm 11):

```sh
npm ci
npm run build          # -> dist/, identical to the published add-on's files
```

Development:

```sh
npm test               # format, merge and settings rules
npm run lint           # build + web-ext lint; must be 0 errors, 0 warnings
npm run package        # -> web-ext-artifacts/bookmarks_mirror-<version>.zip
```

## Releasing (maintainer)

The source of truth is a private Gitea; this GitHub repo is a mirror — changes made
here are overwritten. Bump `version` in `src/manifest.json` and push to `main`. Jenkins
tests every push and mirrors it here; when the version has no Gitea release yet it
submits it to AMO (listed, `amo-metadata.json`, a `git archive` source zip) and creates
Gitea release `v<version>` with that zip. AMO reviews, signs and ships the update.

- AMO never accepts a version number twice — a rejected version needs a bump.
- Jenkins credentials: `amo-api` (AMO JWT issuer / secret),
  `bookmarks-mirror-webhook-token`, `github-bookmarks-mirror-deploy` (SSH deploy key,
  write, on this repo), and the jenkins bot PAT with **Write** on the Gitea repo.

## License

MIT — see [LICENSE](LICENSE).
