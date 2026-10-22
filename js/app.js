// Verdrahtet Daten, Karte, Filter, Suche und Seitenleiste des Explorers.
// Deep Links: #p=<Projekt-ID> öffnet die Projektkarte. Selbsttest: ?selftest=1

(function () {
  'use strict';

  const SEARCH_DEBOUNCE_MS = 200;
  const SEARCH_MIN_CHARS   = 2;
  const HASH_PREFIX        = '#p=';
  const BUNDESLAENDER = ['Burgenland', 'Kärnten', 'Niederösterreich', 'Oberösterreich', 'Salzburg',
                         'Steiermark', 'Tirol', 'Vorarlberg', 'Wien'];

  const D = window.EXPLORER_DATA;
  const P = window.EXPLORER_PANEL;
  const esc = P.esc;
  const _number = new Intl.NumberFormat('de-AT');

  let data = null;
  let mapCtrl = null;
  const filter = { missions: null, bundesland: null, source: null, query: '' };

  // ── Filter-Leiste ─────────────────────────────────────────────────────

  function buildFilterBar() {
    const c = window.EXPLORER_CONFIG;
    document.getElementById('mission-chips').innerHTML = Object.entries(c.missions).map(([key, m]) =>
      `<button type="button" class="chip" data-mission="${key}" aria-pressed="false">
         <span class="swatch" style="background:${m.color}"></span>${esc(m.label)}</button>`).join('');
    document.getElementById('filter-bundesland').innerHTML =
      '<option value="">Alle Bundesländer</option>' + BUNDESLAENDER.map(b => `<option>${esc(b)}</option>`).join('');
    document.getElementById('filter-source').innerHTML =
      '<option value="">Alle Quellen</option>' + Object.entries(c.sources).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

    document.getElementById('mission-chips').addEventListener('click', e => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
      const pressed = [...document.querySelectorAll('.chip[aria-pressed="true"]')].map(b => b.dataset.mission);
      filter.missions = pressed.length ? new Set(pressed) : null;  // keine gewählt = alle
      applyFilter();
    });
    document.getElementById('filter-bundesland').addEventListener('change', e => {
      filter.bundesland = e.target.value || null;
      applyFilter();
    });
    document.getElementById('filter-source').addEventListener('change', e => {
      filter.source = e.target.value || null;
      applyFilter();
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

  /** Re-render dots and the counter for the current filter. */
  function applyFilter() {
    const parts = D.visibleParticipations(data, filter);
    mapCtrl.render(parts);
    const projects = new Set(parts.map(p => p.project_id)).size;
    document.getElementById('counter').textContent =
      `${_number.format(projects)} Projekte · ${_number.format(parts.length)} Beteiligungen auf der Karte`;
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
      buildFilterBar();
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
      filter.bundesland = b;
      check(`Bundesland ${b}`, renderedMatches(applyFilter()), `${mapCtrl.renderedUids().length}`);
    });
    filter.bundesland = null;
    applyFilter();

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
        const text = document.querySelector('.card__abstract').textContent;
        check('Kurzbeschreibung geladen', !!a && text.includes(a.text.slice(0, 40)), '');
        const out = document.getElementById('selftest');
        out.hidden = false;
        out.textContent = JSON.stringify(result, null, 1);
      }, 0);
    });
  }

  init();
})();
