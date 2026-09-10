'use strict';

/** UI orchestration: file intake, live-data review, map, auth and upload. */
const App = (() => {
  const state = {
    files: [],          // { name, generator, changes }
    changes: [],        // merged normalized changes
    live: null,         // { node, way, relation: Map }
    nodeCoords: new Map(),
    wayGeoms: new Map(),
    hasIssues: false,
  };

  const $ = (id) => document.getElementById(id);

  const ACTION_LABELS = { create: 'create', modify: 'modify', delete: 'delete' };
  const TYPE_ICONS = { node: '●', way: '／', relation: '⧉' };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(message, kind = '') {
    const node = $('status');
    node.textContent = message || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setStatusHtml(html, kind = '') {
    const node = $('status');
    node.innerHTML = html;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  // ------------------------------------------------------------------ init

  function init() {
    const dropzone = $('dropzone');
    const fileInput = $('fileInput');

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = [...(e.dataTransfer?.files || [])];
      if (files.length) addFiles(files);
    });
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      addFiles([...fileInput.files]);
      fileInput.value = '';
    });

    $('loginBtn').addEventListener('click', login);
    $('logoutBtn').addEventListener('click', onLogout);
    $('settingsBtn').addEventListener('click', openSettings);
    $('settingsClose').addEventListener('click', closeSettings);
    $('settingsSave').addEventListener('click', saveSettings);
    $('uploadBtn').addEventListener('click', upload);
    $('comment').addEventListener('input', updateUploadButton);
    $('clearBtn').addEventListener('click', reset);

    handleCallback();
    renderAuth();
    updateUploadButton();
  }

  async function handleCallback() {
    let result;
    try {
      result = await OAuth.handleCallback();
    } catch (err) {
      setStatus('Login failed: ' + err.message, 'error');
      return;
    }
    if (result) {
      if (result.ok) setStatus('Logged in to OpenStreetMap.', 'ok');
      else setStatus(result.error, 'error');
      renderAuth();
      updateUploadButton();
    }
  }

  // ------------------------------------------------------------ file intake

  async function addFiles(files) {
    for (const file of files) {
      let parsed;
      try {
        parsed = OSC.parse(await file.text());
      } catch (err) {
        setStatus(`Could not read "${file.name}": ${err.message}`, 'error');
        continue;
      }
      if (!parsed.changes.length) {
        setStatus(`"${file.name}" contains no changes.`, 'warn');
        continue;
      }
      state.files.push({ name: file.name, generator: parsed.generator, changes: parsed.changes });
    }
    if (state.files.length) await refresh();
  }

  function reset() {
    state.files = [];
    state.changes = [];
    state.live = null;
    state.nodeCoords = new Map();
    state.wayGeoms = new Map();
    state.hasIssues = false;

    $('summary').hidden = true;
    $('review').hidden = true;
    $('uploadRow').hidden = true;
    $('mapWrap').hidden = true;
    $('issuesBanner').hidden = true;
    $('changes').innerHTML = '';
    $('comment').value = '';
    setStatus('', '');
    updateUploadButton();
  }

  // ----------------------------------------------------------- live review

  async function refresh() {
    state.changes = state.files.flatMap((f) => f.changes);
    setStatus('Fetching live OpenStreetMap data…', 'info');
    try {
      state.live = await gatherLiveData(state.changes);
    } catch (err) {
      setStatus(err.message, 'error');
      state.live = { node: new Map(), way: new Map(), relation: new Map() };
    }
    buildCoordsAndGeoms();
    renderAll();
  }

  /** Fetch every server element needed for version checks and map geometry. */
  async function gatherLiveData(changes) {
    const nodeIds = new Set();
    const wayIds = new Set();
    const relationIds = new Set();

    for (const change of changes) {
      if (change.type === 'node') {
        nodeIds.add(change.id);
      } else if (change.type === 'way') {
        wayIds.add(change.id);
        change.nodes.forEach((n) => nodeIds.add(n));
      } else if (change.type === 'relation') {
        relationIds.add(change.id);
        for (const m of change.members) {
          if (m.type === 'node') nodeIds.add(m.ref);
          else if (m.type === 'way') wayIds.add(m.ref);
          else if (m.type === 'relation') relationIds.add(m.ref);
        }
      }
    }

    const live = { node: new Map(), way: new Map(), relation: new Map() };
    live.way = await OSM.fetchElements('way', [...wayIds]);
    live.relation = await OSM.fetchElements('relation', [...relationIds]);

    for (const [, way] of live.way) way.nodes.forEach((n) => nodeIds.add(n));
    for (const [, rel] of live.relation) {
      for (const m of rel.members) if (m.type === 'node') nodeIds.add(m.ref);
    }

    live.node = await OSM.fetchElements('node', [...nodeIds]);
    return live;
  }

  function buildCoordsAndGeoms() {
    state.nodeCoords = new Map();
    state.wayGeoms = new Map();

    // Coordinates of newly created nodes come straight from the change file.
    for (const change of state.changes) {
      if (change.type === 'node' && change.lat !== undefined && change.lon !== undefined) {
        state.nodeCoords.set(change.id, [change.lat, change.lon]);
      }
    }
    for (const [id, node] of state.live.node) {
      if (node.visible !== false && Number.isFinite(node.lat) && Number.isFinite(node.lon)) {
        state.nodeCoords.set(id, [node.lat, node.lon]);
      }
    }

    // Which ways do we need geometry for?
    const waysToDraw = new Map();
    for (const change of state.changes) {
      if (change.type === 'way') {
        let refs = change.nodes;
        if (!refs.length) {
          const liveWay = state.live.way.get(change.id);
          if (liveWay) refs = liveWay.nodes;
        }
        waysToDraw.set(change.id, refs);
      } else if (change.type === 'relation') {
        for (const m of change.members) {
          if (m.type === 'way' && !waysToDraw.has(m.ref)) {
            const liveWay = state.live.way.get(m.ref);
            if (liveWay) waysToDraw.set(m.ref, liveWay.nodes);
          }
        }
      }
    }

    for (const [id, refs] of waysToDraw) {
      const points = refs.map((r) => state.nodeCoords.get(r)).filter(Boolean);
      if (points.length >= 2) state.wayGeoms.set(id, points);
    }
  }

  /** Compare one change against the current server state. */
  function checkCompatibility(change) {
    if (change.action === 'create') {
      if (!Number.isInteger(change.id) || change.id >= 0) {
        return { status: 'warn', message: 'create with non-negative id' };
      }
      return { status: 'ok', message: 'new element' };
    }

    const current = state.live?.[change.type]?.get(change.id);
    if (!current || current.visible === false) {
      return { status: 'error', message: 'not visible (already deleted)' };
    }
    if (change.version !== current.version) {
      return {
        status: 'conflict',
        message: `version conflict — file v${change.version}, server v${current.version}`,
      };
    }
    return { status: 'ok', message: `matches server v${current.version}` };
  }

  // -------------------------------------------------------------- rendering

  function renderAll() {
    const changes = state.changes;
    const counts = { create: 0, modify: 0, delete: 0 };
    for (const change of changes) counts[change.action]++;

    $('summary').hidden = changes.length === 0;
    $('mapWrap').hidden = changes.length === 0;
    $('review').hidden = changes.length === 0;
    $('uploadRow').hidden = changes.length === 0;

    if (changes.length) {
      $('summaryCounts').textContent =
        `${changes.length} change${changes.length === 1 ? '' : 's'}: ` +
        `${counts.create} create · ${counts.modify} modify · ${counts.delete} delete`;
      $('summaryFiles').textContent = 'From: ' + state.files.map((f) => f.name).join(', ');
    }

    renderChanges();
    if (changes.length) MapView.render(changes, state.nodeCoords, state.wayGeoms);

    updateUploadButton();
    if (changes.length) setStatus('Review the changes below, then upload.', 'ok');
  }

  function renderChanges() {
    const container = $('changes');
    container.innerHTML = '';
    state.hasIssues = false;

    for (const change of state.changes) {
      const compatibility = checkCompatibility(change);
      if (compatibility.status === 'conflict' || compatibility.status === 'error') {
        state.hasIssues = true;
      }
      container.appendChild(renderChange(change, compatibility));
    }

    const banner = $('issuesBanner');
    banner.hidden = !state.hasIssues;
    banner.textContent = state.hasIssues
      ? '⚠ Some changes conflict with live OSM data. Fix or remove them before uploading.'
      : '';
  }

  function renderChange(change, compatibility) {
    const wrapper = el('div', `change change-${change.action}`);
    const details = el('details');
    const summary = el('summary', 'summary-row');

    summary.appendChild(el('span', `badge badge-${change.action}`, ACTION_LABELS[change.action]));
    summary.appendChild(el('span', 'type-icon', TYPE_ICONS[change.type] || '?'));

    const idEl = el('span', 'id');
    if (change.id >= 0) {
      const link = el('a', null, `${change.type} #${change.id}`);
      link.href = `https://www.openstreetmap.org/${change.type}/${change.id}`;
      link.target = '_blank';
      link.rel = 'noopener';
      idEl.appendChild(link);
    } else {
      idEl.textContent = `${change.type} (new)`;
    }
    summary.appendChild(idEl);
    summary.appendChild(el('span', `compat compat-${compatibility.status}`, compatibility.message));
    summary.appendChild(el('span', 'tags-preview', tagPreview(change.tags)));

    details.appendChild(summary);
    details.appendChild(buildDiff(change));
    wrapper.appendChild(details);
    return wrapper;
  }

  function tagPreview(tags) {
    const entries = Object.entries(tags);
    if (!entries.length) return '';
    const text = entries.slice(0, 4).map(([k, v]) => `${k}=${v}`).join('  ');
    return text + (entries.length > 4 ? ' …' : '');
  }

  function buildDiff(change) {
    const current = change.action === 'create' ? null : state.live?.[change.type]?.get(change.id);
    const rows = [];

    if (change.action !== 'create') {
      const cls = !current || current.version !== change.version ? 'chg' : '';
      rows.push(diffRow('Version', current ? String(current.version) : '— (missing)', String(change.version), cls));
    }

    if (change.type === 'node') {
      const fmt = (lat, lon) => (lat === undefined ? '—' : `${lat.toFixed(6)}, ${lon.toFixed(6)}`);
      if (change.action === 'create') {
        rows.push(diffRow('Position', '—', fmt(change.lat, change.lon), 'add'));
      } else {
        const changed = current && (current.lat !== change.lat || current.lon !== change.lon);
        rows.push(diffRow('Position', current ? fmt(current.lat, current.lon) : '—', fmt(change.lat, change.lon), changed ? 'chg' : ''));
      }
    }

    const keys = new Set([...Object.keys(current?.tags || {}), ...Object.keys(change.tags)]);
    for (const key of [...keys].sort()) {
      const oldValue = current ? current.tags[key] : undefined;
      const newValue = change.tags[key];
      let cls = '';
      if (oldValue === undefined && newValue !== undefined) cls = 'add';
      else if (oldValue !== undefined && newValue === undefined) cls = 'del';
      else if (oldValue !== newValue) cls = 'chg';
      else continue; // unchanged tag on a modify — skip to reduce noise

      rows.push(
        diffRow(
          `tag <code>${escapeHtml(key)}</code>`,
          oldValue === undefined ? '—' : escapeHtml(oldValue),
          newValue === undefined ? '—' : escapeHtml(newValue),
          cls
        )
      );
    }

    if (change.type === 'way') {
      rows.push(diffRow('Nodes', current ? `${current.nodes.length}` : '—', `${change.nodes.length}`, ''));
    }
    if (change.type === 'relation') {
      rows.push(diffRow('Members', current ? `${current.members.length}` : '—', `${change.members.length}`, ''));
    }

    const diff = el('div', 'diff');
    diff.innerHTML = `<table><tr><th>Property</th><th>Live (server)</th><th>This change</th></tr>${rows.join('')}</table>`;
    return diff;
  }

  function diffRow(label, oldValue, newValue, cls) {
    return `<tr class="${cls}"><td>${label}</td><td>${oldValue}</td><td>${newValue}</td></tr>`;
  }

  // ------------------------------------------------------------------- auth

  async function renderAuth() {
    const token = OAuth.getToken();
    $('loginBtn').hidden = !!token;
    $('logoutBtn').hidden = !token;

    if (!token) {
      $('userInfo').textContent = '';
      return;
    }
    $('userInfo').textContent = 'Logged in…';
    try {
      const user = await OSM.userDetails(token.access_token);
      $('userInfo').textContent = user ? `Logged in as ${user.display_name}` : 'Logged in';
    } catch {
      $('userInfo').textContent = 'Logged in (username unavailable)';
    }
  }

  function login() {
    const settings = OAuth.getSettings();
    if (!settings.clientId) {
      openSettings();
      setStatus('Add your OSM OAuth 2 client ID in Settings first (instructions inside).', 'warn');
      return;
    }
    setStatus('Redirecting to OpenStreetMap…', 'info');
    OAuth.startLogin(settings.clientId);
  }

  async function onLogout() {
    await OAuth.logout();
    setStatus('Logged out.', 'ok');
    renderAuth();
    updateUploadButton();
  }

  function openSettings() {
    $('clientId').value = OAuth.getSettings().clientId || '';
    $('redirectUri').textContent = OAuth.redirectUri();
    $('settingsDialog').showModal();
  }

  function closeSettings() {
    $('settingsDialog').close();
  }

  function saveSettings() {
    const settings = OAuth.getSettings();
    settings.clientId = $('clientId').value.trim();
    OAuth.saveSettings(settings);
    closeSettings();
    setStatus('Settings saved.', 'ok');
    updateUploadButton();
  }

  // ----------------------------------------------------------------- upload

  function updateUploadButton() {
    const hasToken = !!OAuth.getToken();
    const hasChanges = state.changes.length > 0;
    const hasComment = $('comment').value.trim().length > 0;
    $('uploadBtn').disabled = !(hasToken && hasChanges && hasComment && !state.hasIssues);

    let hint = '';
    if (!hasChanges) hint = 'Add an .osc file to get started.';
    else if (state.hasIssues) hint = 'Resolve the conflicts above before uploading.';
    else if (!hasToken) hint = 'Log in with your OpenStreetMap account to upload.';
    else if (!hasComment) hint = 'Write a commit message to enable upload.';
    $('uploadHint').textContent = hint;
  }

  async function upload() {
    const token = OAuth.getToken();
    if (!token) return login();

    const comment = $('comment').value.trim();
    if (!comment) {
      setStatus('Please write a commit message.', 'warn');
      $('comment').focus();
      return;
    }

    const uploadBtn = $('uploadBtn');
    uploadBtn.disabled = true;

    // Re-check against the live server right before uploading.
    setStatus('Re-checking changes against the live server…', 'info');
    try {
      state.live = await gatherLiveData(state.changes);
      buildCoordsAndGeoms();
    } catch (err) {
      setStatus('Could not verify against the server: ' + err.message, 'error');
      updateUploadButton();
      return;
    }

    const conflicts = state.changes
      .map((change) => ({ change, compatibility: checkCompatibility(change) }))
      .filter(({ compatibility }) => compatibility.status === 'conflict' || compatibility.status === 'error');

    renderChanges();
    if (state.changes.length) MapView.render(state.changes, state.nodeCoords, state.wayGeoms);

    if (conflicts.length) {
      setStatus(`Upload blocked: ${conflicts.length} change(s) now conflict with the server. See the review list.`, 'error');
      updateUploadButton();
      return;
    }

    const osmChangeXml = OSC.serializeOsmChange(state.changes, 'push-osc');
    let changesetId = null;
    try {
      setStatus('Creating changeset…', 'info');
      changesetId = await OSM.createChangeset(comment, token.access_token);

      setStatus(`Uploading ${state.changes.length} change(s) to changeset ${changesetId}…`, 'info');
      await OSM.uploadDiff(changesetId, osmChangeXml, token.access_token);
      await OSM.closeChangeset(changesetId, token.access_token);
    } catch (err) {
      if (changesetId) {
        // Best effort: don't leave an empty changeset open.
        try {
          await OSM.closeChangeset(changesetId, token.access_token);
        } catch {
          /* ignore */
        }
      }
      setStatus(err.message, 'error');
      updateUploadButton();
      return;
    }

    const url = `https://www.openstreetmap.org/changeset/${changesetId}`;
    setStatusHtml(
      `✓ Uploaded! Changeset <a href="${url}" target="_blank" rel="noopener">#${changesetId}</a> is now live on OpenStreetMap.`,
      'ok'
    );
    updateUploadButton();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
