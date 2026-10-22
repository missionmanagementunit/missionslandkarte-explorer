// Verdrahtet Daten, Karte, Filter, Suche und Seitenleiste des Explorers.
// Deep Links: #p=<Projekt-ID> öffnet die Projektkarte. Selbsttest: ?selftest=1

(function () {
  'use strict';

  const SEARCH_DEBOUNCE_MS = 200;
  const SEARCH_MIN_CHARS   = 2;
  const HASH_PREFIX        = '#p=';
  const REPO_COMMIT_URL    = 'https://github.com/missionmanagementunit/missionslandkarte-explorer/commit/';
  const BUNDESLAENDER = ['Burgenland', 'Kärnten', 'Niederösterreich', 'Oberösterreich', 'Salzburg',
                         'Steiermark', 'Tirol', 'Vorarlberg', 'Wien'];

  const D = window.EXPLORER_DATA;
  const P = window.EXPLORER_PANEL;
  const esc = P.esc;
  const _number = new Intl.NumberFormat('de-AT');

  let data = null;
  let mapCtrl = null;
  const filter = { missions: null, bundeslaender: null, source: null, query: '' };

  // ── Seitenleiste: Legende, Quelle, aktive Filter ──────────────────────

  // Reihenfolge wie in der Legende der Präsentation
  const LEGEND_BUNDESLAENDER = ['Wien', 'Niederösterreich', 'Oberösterreich', 'Steiermark',
                                'Tirol', 'Salzburg', 'Kärnten', 'Vorarlberg', 'Burgenland'];
  let legendView = 'mission';   // 'mission' | 'bundesland'

  /**
   * Count projects per legend entry. Each count respects all other active filters
   * but not the list's own dimension — so the numbers show what clicking would give.
   */
  function legendCounts() {
    if (legendView === 'mission') {
      return Object.keys(window.EXPLORER_CONFIG.missions).map(key => ({
        key, count: D.matchingProjects(data, { ...filter, missions: new Set([key]) }).length,
      }));
    }
    return LEGEND_BUNDESLAENDER.map(key => ({
      key, count: D.matchingProjects(data, { ...filter, bundeslaender: new Set([key]) }).length,
    }));
  }

  function renderLegend() {
    const missions = window.EXPLORER_CONFIG.missions;
    const activeMission = filter.missions ? [...filter.missions][0] : null;
    document.getElementById('legend-list').innerHTML = legendCounts().map(({ key, count }) => {
      const isMission = legendView === 'mission';
      const active = isMission ? key === activeMission : !!(filter.bundeslaender && filter.bundeslaender.has(key));
      const icon = isMission
        ? `<img src="assets/logos/Mission_${missions[key].icon}.svg" class="legend-icon" width="24" height="24" alt="" draggable="false">`
        : '<span class="legend-dot"></span>';
      const label = isMission ? missions[key].label : key;
      return `<button type="button" class="legend-item${active ? ' active' : ''}${count ? '' : ' is-empty'}"
                data-key="${esc(key)}" aria-pressed="${active}">
          ${icon}<span class="legend-label">${esc(label)}</span><span class="legend-count">${_number.format(count)}</span>
        </button>`;
    }).join('');

    document.querySelectorAll('.legend-toggle-btn').forEach(btn => {
      const on = btn.dataset.view === legendView;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });

    // Aktive Filter als Pillen — auch der aus der gerade ausgeblendeten Liste
    const pills = [];
    if (activeMission) pills.push(['mission', missions[activeMission].label]);
    (filter.bundeslaender ? [...filter.bundeslaender] : []).forEach(b => pills.push([`bundesland:${b}`, b]));
    const box = document.getElementById('active-filters');
    box.hidden = !pills.length;
    box.innerHTML = pills.map(([type, label]) =>
      `<button type="button" class="filter-pill" data-clear="${type}" aria-label="Filter ${esc(label)} entfernen">${esc(label)}<span class="filter-pill__x" aria-hidden="true">×</span></button>`).join('');

    document.querySelectorAll('.source-btn').forEach(btn =>
      btn.classList.toggle('active', (btn.dataset.source || null) === filter.source));
  }

  function buildSidebar() {
    const sources = window.EXPLORER_CONFIG.sources;
    document.getElementById('source-toggle').innerHTML =
      `<button type="button" class="source-btn active" data-source="">Alle</button>`
      + Object.entries(sources).map(([k, v]) =>
        `<button type="button" class="source-btn" data-source="${k}">${esc(k === 'eu_fp' ? 'EU' : v)}</button>`).join('');

    document.querySelector('.legend-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.legend-toggle-btn');
      if (!btn) return;
      legendView = btn.dataset.view;   // Umschalten löscht keinen Filter — Kombinationen bleiben
      renderLegend();
    });
    document.getElementById('legend-list').addEventListener('click', e => {
      const item = e.target.closest('.legend-item');
      if (!item) return;
      const key = item.dataset.key;
      if (legendView === 'mission') {
        const same = filter.missions && filter.missions.has(key);
        filter.missions = same ? null : new Set([key]);   // zweiter Klick hebt auf, wie in der Präsentation
      } else {
        toggleBundesland(key);   // mehrere Bundesländer möglich
      }
      applyFilter();
      if (legendView === 'bundesland') zoomToBundeslaender();
    });
    document.getElementById('active-filters').addEventListener('click', e => {
      const pill = e.target.closest('.filter-pill');
      if (!pill) return;
      if (pill.dataset.clear === 'mission') {
        filter.missions = null;
        applyFilter();
      } else {
        toggleBundesland(pill.dataset.clear.slice('bundesland:'.length));
        applyFilter();
        zoomToBundeslaender();
      }
    });
    document.getElementById('source-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.source-btn');
      if (!btn) return;
      filter.source = btn.dataset.source || null;
      applyFilter();
    });

    // Schublade auf schmalen Bildschirmen
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('filter-toggle');
    toggle.addEventListener('click', () => {
      const open = !sidebar.classList.contains('open');
      sidebar.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });

    let timer = null;
    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = input.value.trim();
        filter.query = q.length >= SEARCH_MIN_CHARS ? q : '';
        applyFilter();
        if (filter.query) P.showResults(D.matchingProjects(data, filter), filter.query);
      }, SEARCH_DEBOUNCE_MS);
    });
  }

  /** Add or remove one Bundesland from the selection; an empty selection means "all". */
  function toggleBundesland(name) {
    const set = new Set(filter.bundeslaender || []);
    if (set.has(name)) set.delete(name); else set.add(name);
    filter.bundeslaender = set.size ? set : null;
  }

  /** One Bundesland selected: it fills the map. None or several: all of Austria. */
  function zoomToBundeslaender(animate) {
    return mapCtrl.fitBundeslaender(filter.bundeslaender ? [...filter.bundeslaender] : [], panelCover(), animate);
  }

  /** Re-render dots, legend and counter for the current filter. */
  function applyFilter() {
    const parts = D.visibleParticipations(data, filter);
    mapCtrl.render(parts);
    const projects = new Set(parts.map(p => p.project_id)).size;
    document.getElementById('counter').textContent =
      `${_number.format(projects)} Projekte · ${_number.format(parts.length)} Beteiligungen auf der Karte`;
    renderLegend();
    return parts;
  }

  // ── Projekt öffnen / schließen ────────────────────────────────────────

  function openProject(projectId, fromList, focus, animate) {
    const project = data.projectsById.get(projectId);
    if (!project) return false;
    const parts = data.partsByProject.get(projectId);
    P.showProject(project, parts, fromList);
    mapCtrl.highlightParts(parts);
    if (focus) mapCtrl.focusParts(parts, panelCover(), animate);
    history.replaceState(null, '', HASH_PREFIX + encodeURIComponent(projectId));
    return true;
  }

  /** Pixels of the map hidden by the open panel: [right, bottom]. */
  function panelCover() {
    if (!P.isOpen()) return [0, 0];   // ein verborgenes Panel hat ein Null-Rechteck — nichts verdeckt
    const panel = document.getElementById('panel').getBoundingClientRect();
    const map = document.getElementById('map').getBoundingClientRect();
    const sheet = panel.width >= map.width - 1;  // Bottom-Sheet auf schmalen Bildschirmen
    return sheet ? [0, Math.max(0, map.bottom - panel.top)] : [Math.max(0, map.right - panel.left), 0];
  }

  function readHash() {
    if (!location.hash.startsWith(HASH_PREFIX)) return null;
    return decodeURIComponent(location.hash.slice(HASH_PREFIX.length));
  }

  function clearHash() {
    history.replaceState(null, '', location.pathname + location.search);
  }

  // ── Start ─────────────────────────────────────────────────────────────

  function init() {
    mapCtrl = window.EXPLORER_MAP.create('map', {
      onPartClick: part => openProject(part.project_id, false, false),
      onStackClick: parts => { mapCtrl.clearHighlight(); clearHash(); P.showStack(parts); },
    });
    P.init('panel', {
      onOpenProject: (id, fromList) => openProject(id, fromList, true),
      onShowPart: uid => mapCtrl.showPart(data.participations[uid]),
      onBackToList: () => { mapCtrl.clearHighlight(); clearHash(); },
      onClose: () => { mapCtrl.clearHighlight(); clearHash(); },
    });

    D.load().then(loaded => {
      data = loaded;
      buildSidebar();
      renderVersion();
      mapCtrl.map.invalidateSize({ pan: false });  // sofort, nicht erst beim nächsten ResizeObserver-Takt
      applyFilter();
      document.getElementById('meta-line').innerHTML =
        `${esc(data.meta.attribution)} Datenstand CORDIS: ${esc(formatMetaDate(data.meta.cordis_data_dates.HORIZON))}.`;
      const id = readHash();
      if (id && !openProject(id, false, true, false)) clearHash();
      window.addEventListener('hashchange', () => {
        const next = readHash();
        if (next && next !== P.currentProjectId()) openProject(next, false, true);
      });
      if (new URLSearchParams(location.search).has('selftest')) runSelfTest();
    }).catch(err => {
      console.error('[app.js]', err);
      document.getElementById('counter').textContent = 'Daten konnten nicht geladen werden.';
    });
  }

  /** "Version a15ba9e · 22.10.2026", linked to the commit; "Version: lokal" outside the deployed site. */
  function renderVersion() {
    const v = window.EXPLORER_VERSION || {};
    const el = document.getElementById('version-line');
    if (!v.commit) {
      el.textContent = 'Version: lokal';
      return;
    }
    const built = v.built ? ` · ${formatMetaDate(v.built)}` : '';
    el.innerHTML = `<a href="${REPO_COMMIT_URL}${esc(v.commit)}" target="_blank" rel="noopener" title="Commit ${esc(v.commit)}">`
      + `Version ${esc(v.commit.slice(0, 7))}</a>${esc(built)}`;
  }

  function formatMetaDate(httpDate) {
    const d = new Date(httpDate);
    return isNaN(d) ? httpDate : d.toLocaleDateString('de-AT');
  }

  // ── Selbsttest ────────────────────────────────────────────────────────

  /** Checks the real page: every dot exactly once (also per filter), Danube4All card, search. */
  function runSelfTest() {
    const result = { checks: [], ok: true };
    const check = (name, pass, detail) => {
      result.checks.push({ name, pass, detail });
      if (!pass) result.ok = false;
    };
    const renderedMatches = expected => {
      const uids = mapCtrl.renderedUids();
      return uids.length === expected.length && new Set(uids).size === uids.length
        && expected.every(p => uids.includes(p.uid));
    };

    const all = applyFilter();
    check('alle Punkte genau einmal', renderedMatches(all), `${mapCtrl.renderedUids().length} von ${all.length}`);
    check('keine Beteiligung mit Standort fehlt',
      all.length === data.participations.filter(p => p.lat !== null).length, `${all.length}`);

    Object.keys(window.EXPLORER_CONFIG.missions).forEach(m => {
      filter.missions = new Set([m]);
      check(`Mission ${m}`, renderedMatches(applyFilter()), `${mapCtrl.renderedUids().length}`);
    });
    filter.missions = null;
    BUNDESLAENDER.forEach(b => {
      filter.bundeslaender = new Set([b]);
      check(`Bundesland ${b}`, renderedMatches(applyFilter()), `${mapCtrl.renderedUids().length}`);
    });
    filter.bundeslaender = null;
    applyFilter();

    // Seitenleiste über die echte Oberfläche: Mission + Bundesland kombiniert
    const clickLegend = key => document.querySelector(`.legend-item[data-key="${key}"]`).click();
    const clickToggle = view => document.querySelector(`.legend-toggle-btn[data-view="${view}"]`).click();
    clickToggle('mission');
    clickLegend('soil');
    clickToggle('bundesland');
    const tirolCount = Number(document.querySelector('.legend-item[data-key="Tirol"] .legend-count').textContent.replace(/\D/g, ''));
    clickLegend('Tirol');
    const combo = D.visibleParticipations(data, filter);
    const comboProjects = new Set(combo.map(p => p.project_id)).size;
    check('Kombination Mission + Bundesland bleibt aktiv',
      filter.missions && filter.missions.has('soil') && filter.bundeslaender && filter.bundeslaender.has('Tirol')
      && document.querySelectorAll('.filter-pill').length === 2, `${document.querySelectorAll('.filter-pill').length} Pillen`);
    check('Kombination: richtige Punkte', renderedMatches(combo), `${mapCtrl.renderedUids().length} Punkte`);
    check('Legendenzahl = Projekte nach Klick', tirolCount === comboProjects, `Legende ${tirolCount}, Projekte ${comboProjects}`);
    document.querySelectorAll('.filter-pill').forEach(() => document.querySelector('.filter-pill').click());
    check('Pillen heben Filter auf', !filter.missions && !filter.bundeslaender && renderedMatches(D.visibleParticipations(data, filter)), '');
    clickToggle('mission');

    const versionText = document.getElementById('version-line').textContent.trim();
    check('Versionsangabe sichtbar', /^Version/.test(versionText), versionText);

    const boku = D.matchingProjects(data, { ...filter, query: 'BOKU' }).length;
    check('Suche „BOKU“ findet Projekte', boku > 0, `${boku}`);

    openProject('101093985', false, true, false);
    const outside = mapCtrl.partsOutsideView(data.partsByProject.get('101093985'), panelCover());
    const cover = panelCover();
    const lowest = Math.max(...data.partsByProject.get('101093985').filter(p => p.lat !== null)
      .map(p => mapCtrl.map.latLngToContainerPoint([p.lat, p.lng]).y));
    check('Danube4All: alle Beteiligten im sichtbaren Kartenteil', outside === 0,
      `${outside} außerhalb; tiefster Punkt y=${Math.round(lowest)} px, sichtbar bis ${Math.round(mapCtrl.map.getSize().y - cover[1])} px`);
    const card = document.getElementById('panel').textContent;
    check('Danube4All: BOKU koordiniert', card.includes('UNIVERSITAET FUER BODENKULTUR WIEN') && card.includes('Koordination'), '');
    check('Danube4All: assoziierte Partner ohne EU-Förderung', card.includes('Assoziierter Partner – ohne EU-Förderung'), '');
    check('Deep Link gesetzt', location.hash === '#p=101093985', location.hash);
    const ringsExpected = data.partsByProject.get('101093985').filter(p => p.lat !== null).length;
    check('Danube4All: Ringe um alle Beteiligten', mapCtrl.highlightCount() === ringsExpected,
      `${mapCtrl.highlightCount()} von ${ringsExpected}`);
    check('kein seitliches Scrollen der Seite',
      document.documentElement.scrollWidth <= window.innerWidth, `${document.documentElement.scrollWidth} px bei ${window.innerWidth} px`);

    // Stapel: der Ort mit den meisten Beteiligungen muss sich als Liste öffnen, nicht als Fächer
    const spots = new Map();
    data.participations.filter(p => p.lat !== null).forEach(p => {
      const key = `${p.lat},${p.lng}`;
      spots.set(key, (spots.get(key) || []).concat(p));
    });
    const biggest = [...spots.values()].sort((a, b) => b.length - a.length)[0];
    P.hide();
    const hit = mapCtrl.testClickClusterOf(biggest[0].uid);
    const listItems = document.querySelectorAll('#panel .list__item').length;
    check('größter Stapel öffnet die Liste', hit.count >= biggest.length && listItems === hit.count,
      `${biggest.length} am Ort ${biggest[0].city}; Bündel ${JSON.stringify(hit)}; Liste ${listItems}`);
    const listFilter = document.querySelector('#panel .list__filter');
    if (listFilter) {
      listFilter.value = biggest[0].project.acronym;
      listFilter.dispatchEvent(new Event('input'));
    }
    const filtered = document.querySelectorAll('#panel .list__item').length;
    check('Filter in der Liste', !!listFilter && filtered >= 1 && filtered < listItems, `${filtered}`);
    const firstItem = document.querySelector('#panel .list__item');
    if (firstItem) firstItem.click();
    const backBtn = document.querySelector('#panel .panel__back');
    check('Karte aus der Liste hat „Zurück“', !!backBtn, backBtn ? backBtn.textContent.trim() : '');
    if (backBtn) backBtn.click();
    check('„Zurück“ führt zur Liste', document.querySelectorAll('#panel .list__item').length >= 1, '');
    openProject('101093985', false, false);

    D.loadAbstract('101093985').then(a => {
      setTimeout(() => {
        const text = document.querySelector('.tile-description').textContent;
        check('Kurzbeschreibung geladen', !!a && text.includes(a.text.slice(0, 40)), '');
        runZoomChecks(check).then(() => {
          const out = document.getElementById('selftest');
          out.hidden = false;
          out.textContent = JSON.stringify(result, null, 1);
        });
      }, 0);
    });
  }

  /** Zoom checks: one Bundesland fills the visible map (beside the open card), several show Austria. */
  function runZoomChecks(check) {
    const m = mapCtrl.map;
    const visibleBox = () => {
      const [right, bottom] = panelCover();
      const size = m.getSize();
      return { w: size.x - right, h: size.y - bottom };
    };
    const pixelBox = bounds => {
      const nw = m.latLngToContainerPoint(bounds.getNorthWest());
      const se = m.latLngToContainerPoint(bounds.getSouthEast());
      return { x0: nw.x, y0: nw.y, x1: se.x, y1: se.y };
    };
    const insideView = (box, view) => box.x0 >= -1 && box.y0 >= -1 && box.x1 <= view.w + 1 && box.y1 <= view.h + 1;

    filter.bundeslaender = new Set(['Tirol']);
    applyFilter();
    // Projektkarte bleibt offen — Tirol muss neben bzw. über ihr Platz finden
    return zoomToBundeslaender(false).then(target => {
      const box = pixelBox(target), view = visibleBox();
      const fill = Math.max((box.x1 - box.x0) / view.w, (box.y1 - box.y0) / view.h);
      check('ein Bundesland füllt die Karte', insideView(box, view) && fill >= 0.6,
        `Tirol füllt ${Math.round(fill * 100)} % der sichtbaren Karte, ganz sichtbar: ${insideView(box, view)}`);
      filter.bundeslaender = new Set(['Tirol', 'Wien']);
      applyFilter();
      return zoomToBundeslaender(false);
    }).then(target => {
      const box = pixelBox(target);
      check('zwei Bundesländer zeigen ganz Österreich', insideView(box, visibleBox())
        && target.contains(L.latLng(48.2, 16.37)) && target.contains(L.latLng(47.27, 11.39)), '');
      filter.bundeslaender = null;
      applyFilter();
      return zoomToBundeslaender(false);
    }).then(target => {
      check('ohne Auswahl wieder ganz Österreich', insideView(pixelBox(target), visibleBox()), '');
    });
  }

  init();
})();
