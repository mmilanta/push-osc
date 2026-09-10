'use strict';

/**
 * Thin client for the OpenStreetMap API 0.6.
 * All requests are made directly from the browser — the OSM API enables CORS
 * (access-control-allow-origin: *) for GET, PUT and POST.
 */
const OSM = (() => {
  const API = 'https://api.openstreetmap.org/api/0.6';
  const CHUNK_SIZE = 100;

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function elementToObject(el, type) {
    const obj = {
      type,
      id: parseInt(el.getAttribute('id'), 10),
      version: parseInt(el.getAttribute('version'), 10),
      visible: el.getAttribute('visible') !== 'false',
      tags: {},
      nodes: [],
      members: [],
    };
    if (type === 'node') {
      obj.lat = parseFloat(el.getAttribute('lat'));
      obj.lon = parseFloat(el.getAttribute('lon'));
    }
    for (const child of el.children) {
      if (child.nodeName === 'tag') {
        obj.tags[child.getAttribute('k')] = child.getAttribute('v') ?? '';
      } else if (child.nodeName === 'nd') {
        obj.nodes.push(parseInt(child.getAttribute('ref'), 10));
      } else if (child.nodeName === 'member') {
        obj.members.push({
          type: child.getAttribute('type'),
          ref: parseInt(child.getAttribute('ref'), 10),
          role: child.getAttribute('role') || '',
        });
      }
    }
    return obj;
  }

  /**
   * Bulk-fetch current elements via the /nodes?nodes=… multi-fetch endpoints.
   * Non-existent (e.g. deleted) ids are simply absent from the result map.
   * @returns {Promise<Map<number, object>>}
   */
  async function fetchElements(type, ids) {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id >= 0).sort((a, b) => a - b);
    const result = new Map();
    // Guards against pathological files full of never-assigned ids: bounds the
    // number of extra requests used to isolate invalid ids in a 404 batch.
    let fallbackBudget = 300;

    async function request(chunk) {
      if (!chunk.length) return;
      const url = `${API}/${type}s?${type}s=${chunk.join(',')}`;
      const resp = await fetch(url);

      if (resp.ok) {
        const doc = new DOMParser().parseFromString(await resp.text(), 'text/xml');
        for (const el of doc.getElementsByTagName(type)) {
          result.set(parseInt(el.getAttribute('id'), 10), elementToObject(el, type));
        }
        return;
      }

      // A single invalid/never-assigned id makes the whole multi-fetch batch
      // return 404, hiding the valid elements in it. Split the batch to isolate
      // the bad ids instead of failing everything.
      if (resp.status === 404 && chunk.length > 1 && fallbackBudget > 0) {
        fallbackBudget--;
        const mid = Math.floor(chunk.length / 2);
        await request(chunk.slice(0, mid));
        await request(chunk.slice(mid));
        return;
      }
      if (resp.status === 404) return; // single id, or budget exhausted: treat as absent

      throw new Error(`Loading ${type}s failed (HTTP ${resp.status}).`);
    }

    for (let i = 0; i < unique.length; i += CHUNK_SIZE) {
      await request(unique.slice(i, i + CHUNK_SIZE));
    }
    return result;
  }

  /** Current logged-in user (requires the read_prefs scope). */
  async function userDetails(accessToken) {
    const resp = await fetch(`${API}/user/details.json`, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!resp.ok) throw new Error('Could not load user details (HTTP ' + resp.status + ').');
    const data = await resp.json();
    return data.user || null;
  }

  /** Create an empty changeset with the given comment. Returns its id. */
  async function createChangeset(comment, accessToken) {
    const host = location.origin + location.pathname;
    const xml =
      '<osm><changeset>' +
      `<tag k="comment" v="${escapeXml(comment)}"/>` +
      '<tag k="created_by" v="push-osc"/>' +
      `<tag k="host" v="${escapeXml(host)}"/>` +
      '</changeset></osm>';

    const resp = await fetch(`${API}/changeset/create`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/xml' },
      body: xml,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(cleanApiError(resp.status, text, 'Creating the changeset'));
    return text.trim();
  }

  /** Upload an osmChange document into an open changeset. */
  async function uploadDiff(changesetId, osmChangeXml, accessToken) {
    const resp = await fetch(`${API}/changeset/${changesetId}/upload`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/xml' },
      body: osmChangeXml,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(cleanApiError(resp.status, text, 'Uploading the changes'));
    return text;
  }

  async function closeChangeset(changesetId, accessToken) {
    const resp = await fetch(`${API}/changeset/${changesetId}/close`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + accessToken },
      body: '',
    });
    if (!resp.ok) throw new Error(`Closing changeset failed (HTTP ${resp.status}).`);
  }

  /** Turn OSM's XML error body into a readable one-liner. */
  function cleanApiError(status, body, what) {
    let detail = '';
    try {
      const doc = new DOMParser().parseFromString(body, 'text/xml');
      const err = doc.getElementsByTagName('error')[0];
      if (err) detail = err.textContent.trim();
    } catch {
      /* ignore */
    }
    if (!detail && body && !body.trimStart().startsWith('<')) detail = body.trim();
    if (status === 409) {
      detail = detail || 'a version conflict';
      return `${what} failed: ${detail}. The data changed on the server — reload the file and review again.`;
    }
    if (status === 412) {
      detail = detail || 'a precondition failed';
      return `${what} failed: ${detail}. Elements are still referenced by others (try deleting with "if-unused").`;
    }
    if (status === 401 || status === 403) {
      return `${what} failed: authorization problem (HTTP ${status}). Log out and log in again.`;
    }
    return `${what} failed (HTTP ${status})${detail ? ': ' + detail : ''}.`;
  }

  return { fetchElements, userDetails, createChangeset, uploadDiff, closeChangeset };
})();
