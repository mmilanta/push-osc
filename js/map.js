'use strict';

/** Leaflet map showing the geometry of the changes, coloured by action. */
const MapView = (() => {
  const COLORS = { create: '#22aa55', modify: '#e6a817', delete: '#d63031' };

  let map = null;
  let layer = null;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureMap() {
    if (map) return;
    map = L.map('map', { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }

  function popupHtml(change) {
    const tags = Object.entries(change.tags)
      .slice(0, 6)
      .map(([k, v]) => `<div class="tag"><b>${escapeHtml(k)}</b> = ${escapeHtml(v)}</div>`)
      .join('');
    return (
      `<div class="map-popup"><div class="mp-title">${escapeHtml(change.action)} ` +
      `${escapeHtml(change.type)} ${change.id >= 0 ? '#' + change.id : '(new)'}</div>${tags}</div>`
    );
  }

  /**
   * @param {Array} changes
   * @param {Map<number,[number,number]>} nodeCoords  id -> [lat, lon]
   * @param {Map<number,Array<[number,number]>>} wayGeoms  way id -> polyline
   */
  function render(changes, nodeCoords, wayGeoms) {
    ensureMap();
    layer.clearLayers();

    const bounds = [];
    const addToLayer = (obj, points) => {
      obj.addTo(layer);
      if (points) bounds.push(...points);
    };

    for (const change of changes) {
      const color = COLORS[change.action] || '#555';

      if (change.type === 'node') {
        if (change.lat !== undefined && change.lon !== undefined) {
          const marker = L.circleMarker([change.lat, change.lon], {
            radius: 6, color, weight: 2, fillColor: color, fillOpacity: 0.7,
          }).bindPopup(popupHtml(change));
          addToLayer(marker, [[change.lat, change.lon]]);
        }
      } else if (change.type === 'way') {
        const points = wayGeoms.get(change.id);
        if (points && points.length >= 2) {
          const line = L.polyline(points, { color, weight: 4, opacity: 0.9 }).bindPopup(popupHtml(change));
          addToLayer(line, points);
        }
      } else if (change.type === 'relation') {
        for (const member of change.members) {
          if (member.type === 'node') {
            const point = nodeCoords.get(member.ref);
            if (point) {
              addToLayer(
                L.circleMarker(point, { radius: 4, color, weight: 2, fillColor: color, fillOpacity: 0.5 })
                  .bindPopup(popupHtml(change)),
                [point]
              );
            }
          } else if (member.type === 'way') {
            const points = wayGeoms.get(member.ref);
            if (points && points.length >= 2) {
              addToLayer(
                L.polyline(points, { color, weight: 3, dashArray: '4 4', opacity: 0.7 })
                  .bindPopup(popupHtml(change)),
                points
              );
            }
          }
        }
      }
    }

    if (bounds.length) map.fitBounds(L.latLngBounds(bounds).pad(0.2));
    setTimeout(() => map.invalidateSize(), 0);
  }

  return { render };
})();
