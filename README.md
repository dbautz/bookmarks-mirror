# bookmarks-mirror

Firefox extension. Pulls a bookmarks JSON file from a URL and mirrors it into the
browser. One-way: it only ever issues `GET`. There is no code path that writes back.

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

Parsed by the vendored `vendor/js-yaml.js` (4.1.0, MIT, unminified). YAML 1.2 core
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

```sh
web-ext lint
web-ext sign --channel=unlisted --api-key=… --api-secret=…   # AMO signs it; stays private
```

Release Firefox refuses unsigned extensions. `about:debugging` installs are dropped on
restart.
