# push-osc

Review and upload OpenStreetMap changes from `.osc` files — right in the browser.

Drop one or more OSM Change files onto the page. push-osc parses them, loads the
current state of every touched element from the **live OpenStreetMap API**,
checks whether the changes are still compatible (version conflicts, already
deleted elements, …), draws them on a map and shows a per-element diff. When
everything checks out you write a changeset comment, log in with your OSM
account and upload.

The app is 100% static and runs entirely client-side — no backend, no build
step. It is hosted on GitHub Pages:

**https://mmilanta.github.io/push-osc/**

## Features

- Drag & drop multiple `.osc` / JOSM `.osm` files
- Parses `<create>`, `<modify>` and `<delete>` of nodes, ways and relations
- Fetches current data from the OSM API and flags:
  - version conflicts (`file v3` vs `server v5`)
  - elements that were already deleted on the server
- Per-change diff of tags, node positions, versions and member counts
- Leaflet map with the geometry of the changes, coloured by action
- OSM **OAuth 2.0 with PKCE** login (public client — no client secret needed)
- Creates a changeset, uploads the diff and closes the changeset
- Re-verifies everything against the live server right before uploading

## Authentication

push-osc authenticates directly with OpenStreetMap using OAuth 2.0 with PKCE.
A public **client ID is bundled** (see `js/config.js`), so **users don't need to
configure anything** — just click *Log in with OpenStreetMap*, authorize the
app, and your edits are applied under your own account.

One OAuth application serves **all** users: the client ID identifies the app,
not the person, and each user gets their own access token for their own OSM
account. Because it's a public PKCE client there is **no client secret**, so
publishing the ID with the static site is safe (the same model used by iD,
JOSM and OSMCha).

The app owner registers/manages it once at
<https://www.openstreetmap.org/oauth2/applications>:

1. **Redirect URI**: exactly `https://mmilanta.github.io/push-osc/`
2. Leave **“Confidential application”** *unchecked* (PKCE, no secret)
3. **Scopes**: tick `read_prefs` (user identity) and `write_api` (map edits)
4. Put the generated Client ID in `js/config.js`

Users can still override the client ID from the in-app *Settings* dialog; their
choice is stored in `localStorage`, alongside the access token (kept until they
log out).

## Privacy / safety

- No data is sent anywhere except to `openstreetmap.org` and the OSM tile
  server used by the map. Everything else happens in your browser.
- Uploads are applied under **your OSM account**. Read the changeset carefully
  before uploading. For testing, prefer the
  [dev server](https://master.apis.dev.openstreetmap.org) (the app currently
  targets the production API).

## Running locally

Because everything is static, any web server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

OAuth redirect URIs must use `https`, except for `http://127.0.0.1`, so register
`http://127.0.0.1:8000/` as an additional Redirect URI (and temporarily use your
local client ID in Settings) if you want to log in
locally.

## Deploying

Pushing to `main` triggers the workflow in `.github/workflows/deploy.yml`, which
publishes the repository root to GitHub Pages. Enable it once under
**Settings → Pages → Build and deployment → Source: GitHub Actions**.

## How compatibility checking works

For every `modify`/`delete` element push-osc bulk-fetches the current object
from `https://api.openstreetmap.org/api/0.6/{nodes,ways,relations}?…=…`:

- missing from the response → it no longer exists (already deleted) → **blocked**
- server version ≠ version in the file → **conflict** → **blocked**
- equal → **ok**

`create` elements use negative ids and are merely reported as new. Anything
blocked cannot be uploaded until the file is regenerated from fresh data.

## Project layout

```
index.html               single page app
styles.css               styles
js/config.js             bundled public OAuth client ID
js/osc.js                .osc parser + osmChange serializer
js/osm.js                OpenStreetMap API 0.6 client
js/oauth.js              OAuth 2.0 Authorization Code + PKCE
js/map.js                Leaflet map of the changes
js/app.js                UI orchestration
.github/workflows/       GitHub Pages deployment
```

## License

Code: MIT. Data © OpenStreetMap contributors (ODbL).
