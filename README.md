# bookmarks-mirror

Firefox extension. Pulls a bookmarks YAML file from a URL and mirrors it into the
browser. One-way: it only ever issues `GET`. There is no code path that writes back.

Firefox 140+ (Android 142+) — `optional_host_permissions` and
`data_collection_permissions` set the floor.

Replaces Floccus for the read-only case — no git client in the browser, no
credentials, no merge strategy.

## Config

Options page (`about:addons` → Bookmarks Mirror → Preferences):

| Setting  | Default | Notes                                                  |
| -------- | ------- | ------------------------------------------------------ |
| URL      | —       | Any `http(s)` URL serving the JSON. Host permission is requested on save, for that origin only. |
| Interval | 30 min  | Poll period.                                            |

Toolbar button = sync now. Badge shows `!` on failure; hover for the reason.

## File format

YAML. A node is a **single-key mapping**; the value's type decides what it is —
a string is a bookmark, a list is a folder.

```yaml
menu:
  - Infrastructure:
      - Proxmox VE: https://proxmox.home.dbautz.com/
      - NAS: http://nas.home.dbautz.com/
  - Finance:
      - PayPal: https://www.paypal.com/de/signin
```

One line per bookmark, so pruning is deleting a line — no trailing-comma trap, no
`highestId` counter, no HTML entities.

Top-level keys are the browser roots the file owns: `menu`, `toolbar`, `other`,
`mobile`. **Roots not named in the file are never touched.**

Parsed by `js-yaml`, pinned in `package.json` and bundled at build time. YAML 1.2 core
schema, so `No:` stays the string `"No"` rather than becoming `false`.

## Hard rules

- Every root named in the file is **replaced wholesale** on each change. Bookmarks
  added in the browser inside those roots are deleted on the next sync. The file is
  the source of truth; edit it, not the browser.
- Sync is skipped when the fetched content hash is unchanged, so ids only churn on a
  real edit.
- A file with zero bookmarks is **refused**, not applied — otherwise a truncated file
  or an HTML error page would silently erase every root it names.
- A failed fetch (offline, VPN down, DNS) leaves existing bookmarks alone.

## Build

`src/` is the source, `dist/` is generated — esbuild bundles `src/background.js` and
its one dependency into a single file, the rest is copied. Never edit `dist/`; it is
gitignored and rebuilt on every command below.

```sh
npm ci
npm test                          # the format's accept/refuse rules
npm run lint                      # build + web-ext lint; must be 0 errors, 0 warnings
npm run package                   # -> web-ext-artifacts/bookmarks_mirror-<version>.zip
npm run sign -- --api-key=… --api-secret=…   # AMO signs it; stays unlisted
```

Credentials come from the AMO Developer Hub (Manage API Keys); `sign` uploads,
waits for review and writes the signed `.xpi` next to the build.

The version lives in `src/manifest.json` only — `package.json` is `private` and carries
no version, so there is nothing to keep in sync.

Release Firefox refuses unsigned extensions. `about:debugging` installs are dropped on
restart.
