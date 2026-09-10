'use strict';

/**
 * Parser/serializer for OSM Change files (.osc / .osm with actions).
 *
 * A normalized change looks like:
 *   {
 *     action: 'create' | 'modify' | 'delete',
 *     type:   'node' | 'way' | 'relation',
 *     id:     Number,            // negative for newly created elements
 *     version:Number,
 *     lat, lon,                  // nodes
 *     tags:   { k: v },
 *     nodes:  [ ref, ... ],      // ways
 *     members:[ {type, ref, role} ], // relations
 *     ifUnused: Boolean          // delete ways/relations
 *   }
 */
const OSC = (() => {
  const ELEMENT_TYPES = ['node', 'way', 'relation'];

  function escapeXml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function parseElement(el, action) {
    const type = el.nodeName;
    const change = {
      action,
      type,
      id: parseInt(el.getAttribute('id'), 10),
      version: parseInt(el.getAttribute('version'), 10),
      tags: {},
      nodes: [],
      members: [],
      ifUnused: el.getAttribute('if-unused') === 'true',
      visible: el.getAttribute('visible') !== 'false',
    };

    if (type === 'node') {
      const lat = parseFloat(el.getAttribute('lat'));
      const lon = parseFloat(el.getAttribute('lon'));
      if (!Number.isNaN(lat)) change.lat = lat;
      if (!Number.isNaN(lon)) change.lon = lon;
    }

    for (const child of el.children) {
      switch (child.nodeName) {
        case 'tag':
          change.tags[child.getAttribute('k')] = child.getAttribute('v') ?? '';
          break;
        case 'nd':
          change.nodes.push(parseInt(child.getAttribute('ref'), 10));
          break;
        case 'member':
          change.members.push({
            type: child.getAttribute('type'),
            ref: parseInt(child.getAttribute('ref'), 10),
            role: child.getAttribute('role') || '',
          });
          break;
      }
    }
    return change;
  }

  /**
   * Parse a .osc (osmChange) or JOSM .osm upload file.
   * @returns {{generator: string, changes: Array}}
   */
  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const parseError = doc.getElementsByTagName('parsererror')[0];
    if (parseError) throw new Error('Not valid XML: ' + parseError.textContent.trim());

    const root = doc.documentElement;
    if (!root) throw new Error('The file is empty.');

    const generator = root.getAttribute('generator') || '';
    const changes = [];

    if (root.nodeName === 'osmChange') {
      for (const action of ['create', 'modify', 'delete']) {
        // <create>/<modify>/<delete> wrappers
        const wrappers = root.getElementsByTagName(action);
        for (const wrapper of wrappers) {
          for (const el of wrapper.children) {
            if (ELEMENT_TYPES.includes(el.nodeName)) changes.push(parseElement(el, action));
          }
        }
      }
    } else if (root.nodeName === 'osm') {
      // JOSM upload format: action attribute on each element
      for (const el of root.children) {
        if (!ELEMENT_TYPES.includes(el.nodeName)) continue;
        const action = el.getAttribute('action') || 'modify';
        changes.push(parseElement(el, action));
      }
    } else {
      throw new Error(`Unrecognized root <${root.nodeName}>. Expected an OSM Change (.osc) file.`);
    }

    return { generator, changes };
  }

  function serializeElement(c, changesetId) {
    const attrs = [`id="${c.id}"`];
    if (!Number.isNaN(c.version)) attrs.push(`version="${c.version}"`);
    // The OSM API requires the changeset id on every element in an upload diff
    // (it must match the changeset in the upload URL).
    if (changesetId !== undefined && changesetId !== null && changesetId !== '') {
      attrs.push(`changeset="${escapeXml(String(changesetId))}"`);
    }
    if (c.type === 'node') {
      if (c.lat !== undefined) attrs.push(`lat="${c.lat}"`);
      if (c.lon !== undefined) attrs.push(`lon="${c.lon}"`);
    }
    if (c.action === 'delete' && c.ifUnused && c.type !== 'node') attrs.push('if-unused="true"');

    const children = [];
    if (c.type === 'way') {
      for (const ref of c.nodes) children.push(`    <nd ref="${ref}"/>`);
    } else if (c.type === 'relation') {
      for (const m of c.members) {
        children.push(`    <member type="${escapeXml(m.type)}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`);
      }
    }
    for (const [k, v] of Object.entries(c.tags)) {
      children.push(`    <tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`);
    }

    if (!children.length) return `  <${c.type} ${attrs.join(' ')}/>`;
    return `  <${c.type} ${attrs.join(' ')}>\n${children.join('\n')}\n  </${c.type}>`;
  }

  /**
   * Build the osmChange document used by POST /changeset/{id}/upload.
   * Elements without a version get no version attribute (creates).
   * The changeset id is stamped onto every element, as the API requires.
   */
  function serializeOsmChange(changes, generator = 'push-osc', changesetId) {
    const lines = [`<osmChange version="0.6" generator="${escapeXml(generator)}">`];
    for (const action of ['create', 'modify', 'delete']) {
      const group = changes.filter((c) => c.action === action);
      if (!group.length) continue;
      lines.push(`  <${action}>`);
      for (const c of group) lines.push(serializeElement(c, changesetId));
      lines.push(`  </${action}>`);
    }
    lines.push('</osmChange>');
    return lines.join('\n');
  }

  return { parse, serializeOsmChange, escapeXml };
})();
