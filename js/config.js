'use strict';

/**
 * Bundled OAuth 2.0 client ID for this deployment of push-osc.
 *
 * This is a *public* client: it uses PKCE and has no client secret, so the ID
 * is not sensitive and is safe to publish with the static site. Users can
 * still override it in the in-app Settings dialog (stored in localStorage).
 *
 * Register / manage the application at:
 *   https://www.openstreetmap.org/oauth2/applications
 * (Redirect URI must be exactly https://mmilanta.github.io/push-osc/,
 *  scopes: read_prefs + write_api, "Confidential application" unchecked.)
 */
globalThis.PUSH_OSC_CONFIG = {
  clientId: 'HKFQzO__D4M9onE-Y6ZH9WZ4hjWuLOFFKERAJlDgpD8',
};
