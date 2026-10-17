# Bookmarks Mirror

Firefox extension. Pulls a bookmarks YAML file from an `https://` URL and mirrors it
into the browser. One-way: it only ever issues `GET`, and nothing is sent anywhere.

Firefox desktop 140+. Not Android — Firefox for Android has no bookmarks API; with
Firefox Sync, the mirrored bookmarks reach your phone anyway.

## Config

Options page (`about:addons` → Bookmarks Mirror → Preferences; opens by itself on
first install):

| Setting  | Default | Notes                                                  |
| -------- | ------- | ------------------------------------------------------ |
| URL      | —       | `https://` only. Host permission is requested on save, for that host only. |
| Interval | 30 min  | Poll period.                                            |

Toolbar button = sync now. Badge shows `!` on failure; hover for the reason.

Run it on **one** device. With Firefox Sync on, the bookmarks reach the others; two
mirrors rebuilding the same root at once make Sync merge competing copies.

## File format

YAML. A node is a **single-key mapping**; the value's type decides what it is —
a string is a bookmark, a list is a folder.

```yaml
menu:
  - News:
      - Hacker News: https://news.ycombinator.com/
      - LWN: https://lwn.net/
  - Mozilla: https://www.mozilla.org/
toolbar:
  - MDN: https://developer.mozilla.org/
```

A complete example: [`example/bookmarks.yml`](example/bookmarks.yml).

Top-level keys are the browser roots the file owns: `menu`, `toolbar`, `other`,
`mobile`. **Roots not named in the file are never touched.**

Parsed with the YAML 1.2 core schema, so `No:` stays the string `"No"`. Anchors and
aliases work; merge keys (`<<`) and tags like `!!omap` do not.

## Hard rules

- Every root named in the file is **replaced wholesale** when the file changes, and
  on every manual sync. Bookmarks added in the browser inside those roots are
  deleted then. Edit the file, not the browser.
- Automatic syncs skip when the fetched content is unchanged, so bookmark ids only
  churn on a real edit.
- The whole file is validated before anything is touched. Refused, nothing applied:
  - a root with zero bookmarks (a truncated file must not empty it — omit a root to
    leave it alone);
  - any url that is not `http://` or `https://`;
  - more than 10 000 entries, folders nested deeper than 32, a file over 1 MB.
- A failed fetch (offline, VPN down, DNS) leaves existing bookmarks alone.

## Build

`src/` is the source, `dist/` is generated: esbuild bundles `src/background.js` and
`src/options.js` (with `src/settings.js`, `src/validate.js` and js-yaml from
`package-lock.json`) into one file each, unminified; `manifest.json`, `options.html`
and `icon.svg` are copied. Never edit `dist/`.

Reproduce the submitted build (Linux, Node 24, npm 11):

```sh
npm ci
npm run build          # -> dist/, identical to the .xpi contents
```

Development:

```sh
npm test               # the format's accept/refuse rules
npm run lint           # build + web-ext lint; must be 0 errors, 0 warnings
npm run package        # -> web-ext-artifacts/bookmarks_mirror-<version>.zip
```

The version lives in `src/manifest.json` only.

## Release

Bump `version` in `src/manifest.json`, push to `main`. Jenkins tests every push and
mirrors `main` to GitHub;
when that version has no Gitea release yet it submits it to AMO (listed, with
`amo-metadata.json` and a `git archive` source zip) and creates Gitea release
`v<version>` with that source zip. AMO reviews, signs and serves the update.

- AMO never accepts a version number twice — a rejected version needs a bump.
- Jenkins credentials: `amo-api` (AMO JWT issuer / secret),
  `bookmarks-mirror-webhook-token`, `github-bookmarks-mirror-deploy` (SSH deploy key,
  write, on the GitHub repo), and the jenkins bot PAT, which needs **Write** on this
  repo.
- GitHub is a mirror: change it here, never there — the next push overwrites it.

## License

MIT — see [LICENSE](LICENSE).
