'use strict';

/**
 * OpenStreetMap OAuth 2.0 (Authorization Code + PKCE).
 *
 * push-osc is a public client (single page app), so no client secret is
 * needed. We generate a PKCE verifier/challenge for each login and exchange
 * the authorization code for a Bearer access token. Tokens do not expire
 * automatically and are kept in localStorage until the user logs out.
 */
const OAuth = (() => {
  const AUTH_URL = 'https://www.openstreetmap.org/oauth2/authorize';
  const TOKEN_URL = 'https://www.openstreetmap.org/oauth2/token';
  const REVOKE_URL = 'https://www.openstreetmap.org/oauth2/revoke';
  const SCOPE = 'read_prefs write_api';

  const SETTINGS_KEY = 'push-osc.settings';
  const TOKEN_KEY = 'push-osc.token';
  const STATE_KEY = 'push-osc.state';
  const VERIFIER_KEY = 'push-osc.verifier';

  // ---------- small helpers ----------

  function base64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function randomString(byteLength) {
    const bytes = new Uint8Array(byteLength);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }

  async function sha256(text) {
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  }

  async function pkceChallenge(verifier) {
    return base64url(await sha256(verifier));
  }

  function readJson(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  }

  // ---------- public config ----------

  /** The exact URL this app is served from, without query/hash. Must match
   *  the Redirect URI registered on openstreetmap.org. */
  function redirectUri() {
    return location.origin + location.pathname.replace(/[?#].*$/, '');
  }

  function getSettings() {
    const stored = readJson(SETTINGS_KEY) || {};
    const fallback = (globalThis.PUSH_OSC_CONFIG && globalThis.PUSH_OSC_CONFIG.clientId) || '';
    // A client ID saved in Settings wins; otherwise use the bundled default.
    return { ...stored, clientId: stored.clientId || fallback };
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function getToken() {
    return readJson(TOKEN_KEY);
  }

  // ---------- flow ----------

  /** Kick off the Authorization Code + PKCE flow. */
  async function startLogin(clientId) {
    const state = randomString(24);
    const verifier = randomString(48);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    const challenge = await pkceChallenge(verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri(),
      scope: SCOPE,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    location.assign(`${AUTH_URL}?${params.toString()}`);
  }

  /**
   * If we were redirected back with ?code=..., exchange it for a token.
   * @returns {null | {ok: boolean, error?: string}} null when there is no callback.
   */
  async function handleCallback() {
    const params = new URLSearchParams(location.search);
    const error = params.get('error');
    const code = params.get('code');

    if (error) {
      return { ok: false, error: `OpenStreetMap denied authorization (${error}).` };
    }
    if (!code) return null;

    const expectedState = sessionStorage.getItem(STATE_KEY);
    if (!expectedState || params.get('state') !== expectedState) {
      return { ok: false, error: 'Login state mismatch (possible CSRF). Please try again.' };
    }

    const settings = getSettings();
    if (!settings.clientId) {
      return { ok: false, error: 'Missing OAuth client ID — open Settings and add it.' };
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      client_id: settings.clientId,
      code_verifier: sessionStorage.getItem(VERIFIER_KEY) || '',
    });

    let data = {};
    let resp;
    try {
      resp = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      data = await resp.json().catch(() => ({}));
    } catch (err) {
      return { ok: false, error: 'Could not reach the OSM token endpoint: ' + err.message };
    }

    if (!resp.ok || !data.access_token) {
      const reason = data.error_description || data.error || `HTTP ${resp.status}`;
      return { ok: false, error: 'Token exchange failed: ' + reason };
    }

    localStorage.setItem(
      TOKEN_KEY,
      JSON.stringify({
        access_token: data.access_token,
        scope: data.scope,
        created_at: Date.now(),
      })
    );

    // Strip ?code=...&state=... from the address bar.
    history.replaceState(null, '', redirectUri());
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    return { ok: true };
  }

  async function logout() {
    const token = getToken();
    if (token?.access_token) {
      try {
        await fetch(REVOKE_URL, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token.access_token,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            token: token.access_token,
            token_type_hint: 'access_token',
          }).toString(),
        });
      } catch {
        /* best effort */
      }
    }
    localStorage.removeItem(TOKEN_KEY);
  }

  return { startLogin, handleCallback, logout, getToken, getSettings, saveSettings, redirectUri };
})();
