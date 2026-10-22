// Leaflet-Karte des Explorers: ein Punkt pro österreichischer Beteiligung, gebündelt mit
// Leaflet.markercluster. Bündel zeigen die Missionsanteile als Torte (wie in der Präsentation).
// Liegen viele Beteiligungen am selben Ort (AIT: 90+), öffnet ein Klick die Seitenliste
// statt eines unlesbaren Spinnen-Fächers.

(function () {
  'use strict';

  const GEOJSON_URL = 'https://raw.githubusercontent.com/ginseng666/GeoJSON-TopoJSON-Austria/master/2017/simplified-99.5/laender_995_geo.json';
  const TILE_URL    = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Esri, HERE, Garmin';

  // Startansicht: ganz Österreich, passend zur verfügbaren Breite (fester Zoom 7 schneidet am Handy ab)
  const AUSTRIA_BOUNDS = [[46.37, 9.53], [49.02, 17.16]];
  const START_PADDING  = [16, 16];
  const MAX_ZOOM       = 16;   // Grenze des Esri-Kacheldienstes
  const FOCUS_MAX_ZOOM = 11;   // beim Anspringen eines Projekts nicht näher heran
  const FOCUS_ROOMY_HEIGHT = 400;  // ab so viel sichtbarer Kartenhöhe großzügiger Rand beim Anspringen
  const SPIDER_MAX     = 12;   // bis zu so vielen Punkten am selben Ort: auffächern, darüber: Liste
  const CLUSTER_RADIUS = 46;
  const DOT_SIZE       = 14;
  const HIGHLIGHT_RADIUS = 11;

  const LEAD_ROLES = new Set(['coordinator', 'sole_applicant']);

  function _missionColor(mission) {
    return (window.EXPLORER_CONFIG.missions[mission] || {}).color || '#888';
  }

  // ── Icons ─────────────────────────────────────────────────────────────

  /** Single dot; coordinators get a dark ring. */
  function _dotIcon(part) {
    const lead = LEAD_ROLES.has(part.role) ? ' dot--lead' : '';
    return L.divIcon({
      html: `<span class="dot${lead}" style="background:${_missionColor(part.project.mission)}"></span>`,
      className: 'dot-icon',
      iconSize: [DOT_SIZE, DOT_SIZE],
      iconAnchor: [DOT_SIZE / 2, DOT_SIZE / 2],
    });
  }

  /** Cluster icon: mission pie with the count in a white centre. */
  function _clusterIcon(cluster) {
    const counts = {};
    cluster.getAllChildMarkers().forEach(m => {
      const mission = m.part.project.mission;
      counts[mission] = (counts[mission] || 0) + 1;
    });
    const total = cluster.getChildCount();
    const size = total < 10 ? 30 : total < 100 ? 38 : 46;
    const r = size / 2;
    const entries = Object.entries(counts);

    let shapes;
    if (entries.length === 1) {
      shapes = `<circle cx="${r}" cy="${r}" r="${r}" fill="${_missionColor(entries[0][0])}"/>`;
    } else {
      let cum = 0;
      shapes = entries.map(([mission, count]) => {
        const a0 = (cum / total) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((cum + count) / total) * 2 * Math.PI - Math.PI / 2;
        cum += count;
        const x1 = r + r * Math.cos(a0), y1 = r + r * Math.sin(a0);
        const x2 = r + r * Math.cos(a1), y2 = r + r * Math.sin(a1);
        const large = count / total > 0.5 ? 1 : 0;
        return `<path d="M${r},${r}L${x1.toFixed(2)},${y1.toFixed(2)}A${r},${r},0,${large},1,${x2.toFixed(2)},${y2.toFixed(2)}Z" fill="${_missionColor(mission)}"/>`;
      }).join('');
    }
    const inner = r * 0.58;
    return L.divIcon({
      html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${shapes}`
          + `<circle cx="${r}" cy="${r}" r="${inner}" fill="#2b2422"/></svg>`
          + `<span class="cluster__count">${total}</span>`,
      className: 'cluster-icon',
      iconSize: [size, size],
    });
  }

  // ── Grundkarte ────────────────────────────────────────────────────────

  /** Ray-casting: is [lng, lat] inside the ring? */
  function _pointInRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** A ring counts as inside another when a clear majority of its points are (shared borders are fuzzy). */
  function _ringInside(ring, other) {
    const sample = ring.filter((_, i) => i % 5 === 0);
    return sample.filter(pt => _pointInRing(pt, other)).length > sample.length * 0.8;
  }

  function _addAustria(map) {
    fetch(GEOJSON_URL)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
        const rings = [];
        data.features.forEach(f => {
          const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
          polys.forEach(poly => rings.push(poly[0]));
        });
        // Wien liegt im Außenring von Niederösterreich. Beide Ringe auszuschneiden hieße Wien doppelt
        // ausschneiden — bei gerade/ungerade-Füllung ist es dann wieder dunkel (so auch in der Präsentation).
        // Darum nur Ringe ausschneiden, die nicht in einem anderen Ring liegen.
        const holes = rings
          .filter(ring => !rings.some(other => other !== ring && _ringInside(ring, other)))
          .map(ring => ring.map(([lng, lat]) => [lat, lng]));
        // Grenzen und Maske mit denselben Werten wie in der Präsentation (map.js dort)
        L.geoJSON(data, {
          style: { fill: false, color: 'rgba(184,163,159,0.55)', weight: 1, dashArray: '5 4' },
          interactive: false,
        }).addTo(map);
        L.polygon([world, ...holes], {
          color: 'rgba(200,184,176,0.75)', weight: 1.5,
          fillColor: '#1a1410', fillOpacity: 0.62, interactive: false,
        }).addTo(map);
      })
      .catch(err => console.error('[map.js] Bundesländer-Grenzen nicht geladen:', err));
  }

  // ── Fabrik ────────────────────────────────────────────────────────────

  /**
   * Creates the explorer map in containerId.
   * handlers.onPartClick(part)   — a single dot was clicked
   * handlers.onStackClick(parts) — a stack too big to fan out was clicked
   */
  function create(containerId, handlers) {
    const map = L.map(containerId, { maxZoom: MAX_ZOOM, zoomSnap: 0.5, zoomControl: true });
    map.fitBounds(AUSTRIA_BOUNDS, { padding: START_PADDING });

    // Leaflet misst seinen Container nur beim Start. Wird die Filterleiste danach höher
    // (Chips geladen, Umbruch, Drehen des Handys), stimmen sonst alle Zoom-Berechnungen nicht.
    new ResizeObserver(() => map.invalidateSize({ pan: false })).observe(map.getContainer());
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: MAX_ZOOM }).addTo(map);
    _addAustria(map);

    const clusters = L.markerClusterGroup({
      maxClusterRadius: CLUSTER_RADIUS,
      iconCreateFunction: _clusterIcon,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: false,     // Klick-Verhalten regelt der Handler unten
      spiderfyOnMaxZoom: false,
      // Ohne chunkedLoading sind alle Punkte nach render() sofort im Baum — 1.700 Marker schafft das in einem Schritt.
      chunkedLoading: false,
    });
    map.addLayer(clusters);

    // Ring um alle österreichischen Beteiligten des geöffneten Projekts. Eigene Ebene über den Markern
    // (markerPane = 600) — in der normalen Overlay-Ebene lägen die Ringe unter den Bündel-Symbolen.
    map.createPane('highlightPane');
    map.getPane('highlightPane').style.zIndex = 650;
    map.getPane('highlightPane').style.pointerEvents = 'none';
    const highlightRenderer = L.svg({ pane: 'highlightPane' });
    const highlight = L.layerGroup().addTo(map);
    const markersByUid = new Map();

    clusters.on('clusterclick', e => {
      const cluster = e.layer;
      const bounds = cluster.getBounds();
      const sameSpot = bounds.getNorthEast().equals(bounds.getSouthWest());
      if (!sameSpot && map.getZoom() < MAX_ZOOM) {
        cluster.zoomToBounds({ padding: [40, 40] });
      } else if (cluster.getChildCount() <= SPIDER_MAX) {
        cluster.spiderfy();
      } else {
        handlers.onStackClick(cluster.getAllChildMarkers().map(m => m.part));
      }
    });

    /** Replace all dots with the given participations. */
    function render(parts) {
      clusters.clearLayers();
      markersByUid.clear();
      const markers = parts.map(part => {
        const marker = L.marker([part.lat, part.lng], {
          icon: _dotIcon(part),
          title: `${part.project.acronym} – ${part.name}`,
          alt: `${part.project.acronym} – ${part.name}`,
        });
        marker.part = part;
        marker.on('click', () => handlers.onPartClick(part));
        markersByUid.set(part.uid, marker);
        return marker;
      });
      clusters.addLayers(markers);
    }

    /** Ring the dots of one project (all its located participations, filtered or not). */
    function highlightParts(parts) {
      highlight.clearLayers();
      parts.filter(p => p.lat !== null).forEach(p => {
        L.circleMarker([p.lat, p.lng], {
          radius: HIGHLIGHT_RADIUS, color: '#2b2422', weight: 2.5, fill: false, interactive: false,
          pane: 'highlightPane', renderer: highlightRenderer,
        }).addTo(highlight);
      });
    }

    function clearHighlight() {
      highlight.clearLayers();
    }

    /**
     * Move the view so all located participations of a project are visible.
     * covered = [right, bottom] in pixels hidden by the panel (desktop: right, phone: bottom sheet).
     * animate = false jumps without a flight (deep link on page load).
     */
    function focusParts(parts, covered, animate) {
      const located = parts.filter(p => p.lat !== null).map(p => [p.lat, p.lng]);
      if (!located.length) return;
      // Direkt vor der Zoom-Berechnung neu messen — der ResizeObserver meldet sich erst asynchron,
      // ein Deep Link beim Laden käme ihm zuvor (die Filterleiste wächst noch, wenn der Zähler umbricht).
      map.invalidateSize({ pan: false });
      const [right, bottom] = covered || [0, 0];
      // Auf dem Handy bleibt über dem Bottom-Sheet nur ein schmaler Streifen — dort wenig Rand
      const pad = map.getSize().y - bottom > FOCUS_ROOMY_HEIGHT ? 60 : 16;
      const options = {
        paddingTopLeft: [pad, pad], paddingBottomRight: [right + pad, bottom + pad], maxZoom: FOCUS_MAX_ZOOM,
      };
      if (animate === false) map.fitBounds(L.latLngBounds(located), { ...options, animate: false });
      else map.flyToBounds(L.latLngBounds(located), { ...options, duration: 0.8 });
    }

    /** Count located parts whose dot lies outside the visible map area (not under the panel). */
    function partsOutsideView(parts, covered) {
      const [right, bottom] = covered || [0, 0];
      const size = map.getSize();
      return parts.filter(p => p.lat !== null).filter(p => {
        const pt = map.latLngToContainerPoint([p.lat, p.lng]);
        return pt.x < 0 || pt.y < 0 || pt.x > size.x - right || pt.y > size.y - bottom;
      }).length;
    }

    /** Number of highlight rings currently drawn, for the self-test. */
    function highlightCount() {
      return highlight.getLayers().length;
    }

    /** Zoom in until one participation's own dot is visible (opens its cluster if needed). */
    function showPart(part) {
      const marker = markersByUid.get(part.uid);
      if (marker) clusters.zoomToShowLayer(marker);
    }

    /** Self-test hook: zoom fully onto one dot and fire the same event a click on its cluster fires. */
    function testClickClusterOf(uid) {
      const marker = markersByUid.get(uid);
      map.setView(marker.getLatLng(), MAX_ZOOM, { animate: false });
      const parent = clusters.getVisibleParent(marker);
      if (!parent || parent === marker) return { error: `kein Bündel sichtbar (Zoom ${map.getZoom()})` };
      // "click" wie ein echter Klick — markercluster macht daraus selbst "clusterclick",
      // weil die Ebene ein Bündel ist (ein direktes "clusterclick" würde zu "clusterclusterclick").
      clusters.fire('click', { layer: parent, latlng: marker.getLatLng() });
      return { count: parent.getChildCount(), zoom: map.getZoom() };
    }

    /** Number of dots currently in the cluster group, for the self-test. */
    function renderedUids() {
      return clusters.getLayers().map(m => m.part.uid);
    }

    return { map, render, highlightParts, clearHighlight, focusParts, partsOutsideView, showPart, renderedUids, highlightCount, testClickClusterOf };
  }

  window.EXPLORER_MAP = { create };
})();
