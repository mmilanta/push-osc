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

## Setup (one-time, per user)

push-osc authenticates directly with OpenStreetMap using OAuth 2.0. Each user
registers their own (free) OAuth application — no secret is required because we
use PKCE:

1. Open <https://www.openstreetmap.org/oauth2/applications/new>
2. **Name**: anything, e.g. `push-osc`
3. **Redirect URI**: the URL of the app, e.g. `https://mmilanta.github.io/push-osc/`
   (click *Settings* in the app to see the exact value to paste)
4. Leave **“Confidential application”** *unchecked*
5. **Scopes**: tick `read_prefs` (user identity) and `write_api` (map edits)
6. Copy the generated **Client ID** into *Settings* inside push-osc

The Client ID is stored in your browser's `localStorage`; the access token is
kept there too until you log out.

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
`http://127.0.0.1:8000/` as an additional Redirect URI if you want to log in
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
js/osc.js                .osc parser + osmChange serializer
js/osm.js                OpenStreetMap API 0.6 client
js/oauth.js              OAuth 2.0 Authorization Code + PKCE
js/map.js                Leaflet map of the changes
js/app.js                UI orchestration
.github/workflows/       GitHub Pages deployment
```

## License

Code: MIT. Data © OpenStreetMap contributors (ODbL).
