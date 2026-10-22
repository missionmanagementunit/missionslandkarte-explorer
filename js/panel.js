// Seitenleiste des Explorers: Projektkarte und Listen (Stapel am selben Ort, Suchergebnisse).
// Auf schmalen Bildschirmen wird sie per CSS zum Bottom-Sheet.

(function () {
  'use strict';

  const ROLE_ORDER = ['coordinator', 'sole_applicant', 'participant', 'partner', 'thirdParty',
                      'associatedPartner', 'internationalPartner', null];

  const _euro = new Intl.NumberFormat('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const _number = new Intl.NumberFormat('de-AT');
  const _countries = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['de'], { type: 'region' }) : null;

  let _panel, _content, _handlers;
  let _listState = null;   // zuletzt gezeigte Liste — für "Zurück zur Liste"
  let _currentProjectId = null;

  /** Escape text for safe insertion into HTML. */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function cfg() {
    return window.EXPLORER_CONFIG;
  }

  function missionLabel(mission) {
    return (cfg().missions[mission] || {}).label || mission;
  }

  /** Mission pentagon as in the presentation (assets/logos/Mission_*.svg). */
  function missionIcon(mission, size) {
    const file = (cfg().missions[mission] || {}).icon || 'Climate';
    return `<img class="tile-mission-icon" src="assets/logos/Mission_${file}.svg" width="${size}" height="${size}" alt="" draggable="false">`;
  }

  function countryName(code) {
    const iso = cfg().countryCodeFixes[code] || code;
    try { return _countries ? _countries.of(iso) : code; } catch (e) { return code; }
  }

  /** '2023-01-01' -> '01/2023', '2021' -> '2021'. */
  function formatDate(value) {
    if (!value) return '';
    const m = /^(\d{4})-(\d{2})/.exec(value);
    return m ? `${m[2]}/${m[1]}` : value;
  }

  function formatPeriod(project) {
    const start = formatDate(project.start), end = formatDate(project.end);
    if (start && end) return `${start} – ${end}`;
    return start || end || '';
  }

  function fundingText(part) {
    if (part.funding_status === 'amount') return _euro.format(part.funding_eur);
    return cfg().funding[part.funding_status] || '';
  }

  function orgName(part) {
    return part.short_name && !part.name.toUpperCase().includes(part.short_name.toUpperCase())
      ? `${esc(part.name)} <span class="muted">(${esc(part.short_name)})</span>`
      : esc(part.name);
  }

  // ── Projektkarte ──────────────────────────────────────────────────────

  function partRow(part) {
    const notes = [];
    if (part.ended) notes.push(cfg().notes.ended);
    if (!part.cordis_listed && part.project.source === 'eu_fp') notes.push(cfg().notes.notInCordis);
    const where = part.lat === null
      ? `<span class="muted">${esc(cfg().notes.noLocation)}</span>`
      : esc([part.city, part.bundesland].filter(Boolean).join(' · '));
    const role = cfg().roles[part.role] || cfg().roles.null;
    const lead = part.role === 'coordinator' || part.role === 'sole_applicant' ? ' partner--lead' : '';
    return `<li>
      <button type="button" class="partner${lead}" data-uid="${part.uid}" ${part.lat === null ? 'disabled' : ''}>
        <span class="partner__name">${orgName(part)}</span>
        <span class="partner__where">${where}</span>
        <span class="partner__meta">${esc(role)} – ${esc(fundingText(part))}${notes.length ? ` <span class="muted">(${esc(notes.join(', '))})</span>` : ''}</span>
      </button></li>`;
  }

  function projectCard(project, parts) {
    const c = cfg();
    const sorted = parts.slice().sort((a, b) =>
      ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.name.localeCompare(b.name, 'de'));
    const coordinator = project.coordinator
      ? `${esc(project.coordinator.name)}${project.coordinator.country !== 'AT' ? ` <span class="muted">(${esc(countryName(project.coordinator.country))})</span>` : ''}`
      : '<span class="muted">nicht angegeben</span>';
    const austrianTotal = project.source === 'eu_fp'
      ? parts.reduce((s, p) => s + (p.funding_status === 'amount' ? p.funding_eur : 0), 0) : null;
    const back = _listState
      ? `<button type="button" class="panel__back" data-action="back">← ${esc(_listState.title)}</button>` : '';

    return `${back}
      <article class="card">
        <div class="tile-mission-row">${missionIcon(project.mission, 28)}<span class="tile-mission-label">${esc(missionLabel(project.mission))}</span></div>
        <h2 class="tile-name" id="panel-title">${esc(project.acronym)}</h2>
        ${project.title && project.title !== project.acronym ? `<p class="tile-title">${esc(project.title)}</p>` : ''}
        <dl class="tile-facts">
          <dt>Programm</dt><dd>${esc(project.programme || c.sources[project.source])}</dd>
          ${formatPeriod(project) ? `<dt>Laufzeit</dt><dd>${esc(formatPeriod(project))}</dd>` : ''}
          <dt>Koordination</dt><dd>${coordinator}</dd>
          ${austrianTotal ? `<dt>EU-Förderung österr. Beteiligte</dt><dd>${esc(_euro.format(austrianTotal))}</dd>` : ''}
        </dl>
        ${project.link ? `<a class="tile-link" href="${esc(project.link)}" target="_blank" rel="noopener">${esc(c.linkLabels[project.source])} ↗</a>` : ''}
        <section class="tile-section">
          <h3>Kurzbeschreibung</h3>
          <div class="tile-description" data-abstract="${esc(project.id)}"><p class="muted">Wird geladen …</p></div>
        </section>
        <section class="tile-section">
          <h3>Beteiligte in Österreich <span class="muted">(${parts.length})</span></h3>
          <ul class="partners">${sorted.map(partRow).join('')}</ul>
          ${project.partners_complete ? '' : `<p class="muted small">${esc(c.notes.partnersIncomplete)}</p>`}
        </section>
      </article>`;
  }

  function fillAbstract(projectId) {
    window.EXPLORER_DATA.loadAbstract(projectId).then(abstract => {
      const box = _content.querySelector(`[data-abstract="${CSS.escape(projectId)}"]`);
      if (!box) return;  // inzwischen anderes Projekt geöffnet
      if (!abstract) {
        box.innerHTML = '<p class="muted">Keine Kurzbeschreibung vorhanden.</p>';
        return;
      }
      const note = abstract.lang === 'en' ? `<p class="muted small">${esc(cfg().notes.abstractEnglish)}</p>` : '';
      box.innerHTML = `<p lang="${esc(abstract.lang)}">${esc(abstract.text)}</p>${note}`;
    }).catch(err => {
      console.error('[panel.js] Kurzbeschreibung nicht geladen:', err);
      const box = _content.querySelector('.tile-description');
      if (box) box.innerHTML = '<p class="muted">Kurzbeschreibung konnte nicht geladen werden.</p>';
    });
  }

  /** Show the card of one project. keepList: true when opened from a list (shows a back button). */
  function showProject(project, parts, keepList) {
    if (!keepList) _listState = null;
    _currentProjectId = project.id;
    _content.innerHTML = projectCard(project, parts);
    _open();
    fillAbstract(project.id);
  }

  // ── Listen ────────────────────────────────────────────────────────────

  function listItems(state) {
    const q = window.EXPLORER_DATA.fold(state.filterText || '');
    const items = q ? state.items.filter(it => it.key.includes(q)) : state.items;
    // Keine Obergrenze: selbst alle 1.193 Projekte sind für den Browser kein Problem,
    // und Stapel-Listen haben ihr eigenes Suchfeld.
    if (!items.length) return '<p class="muted">Keine Treffer.</p>';
    return `<ul class="list">${items.map(it => `
      <li><button type="button" class="list__item" data-project="${esc(it.projectId)}">
        <span class="list__head">${missionIcon(it.mission, 18)}<strong>${esc(it.title)}</strong></span>
        <span class="list__sub">${esc(it.subtitle)}</span>
      </button></li>`).join('')}</ul>`;
  }

  function renderList() {
    const s = _listState;
    _content.innerHTML = `
      <h2 class="list__title" id="panel-title">${esc(s.title)}</h2>
      ${s.subtitle ? `<p class="list__subtitle">${esc(s.subtitle)}</p>` : ''}
      ${s.filterable ? `<input type="search" class="list__filter" placeholder="In dieser Liste suchen" value="${esc(s.filterText || '')}" aria-label="In dieser Liste suchen">` : ''}
      <div class="list__items">${listItems(s)}</div>`;
    const input = _content.querySelector('.list__filter');
    if (input) {
      input.addEventListener('input', () => {
        s.filterText = input.value;
        _content.querySelector('.list__items').innerHTML = listItems(s);
      });
    }
    _currentProjectId = null;
    _open();
  }

  /** List of participations stacked at one spot. */
  function showStack(parts) {
    const items = parts
      .map(p => ({
        projectId: p.project.id, mission: p.project.mission,
        title: p.project.acronym,
        subtitle: `${p.name}${p.short_name ? ` (${p.short_name})` : ''}`,
        key: window.EXPLORER_DATA.fold(`${p.project.acronym} ${p.project.title} ${p.name} ${p.short_name || ''}`),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
    const place = [parts[0].city, parts[0].bundesland].filter(Boolean).join(' · ');
    _listState = {
      title: `${_number.format(parts.length)} Beteiligungen an diesem Ort`,
      subtitle: place, items, filterable: true, filterText: '',
    };
    renderList();
  }

  /** List of projects matching the search. */
  function showResults(projects, query) {
    const items = projects
      .map(p => ({
        projectId: p.id, mission: p.mission, title: p.acronym,
        subtitle: p.title !== p.acronym ? p.title : missionLabel(p.mission),
        key: p.searchKey,
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'de'));
    _listState = {
      title: `${_number.format(projects.length)} Projekte`,
      subtitle: `Suche: „${query}“`, items, filterable: false,
    };
    renderList();
  }

  // ── Panel ─────────────────────────────────────────────────────────────

  function _open() {
    _panel.hidden = false;
    _panel.scrollTop = 0;
    _content.scrollTop = 0;
  }

  function hide() {
    _panel.hidden = true;
    _listState = null;
    _currentProjectId = null;
    _handlers.onClose();
  }

  function isOpen() {
    return !_panel.hidden;
  }

  function currentProjectId() {
    return _currentProjectId;
  }

  /** handlers: onOpenProject(projectId, fromList), onShowPart(uid), onBackToList(), onClose() */
  function init(panelId, handlers) {
    _panel = document.getElementById(panelId);
    _content = _panel.querySelector('.panel__content');
    _handlers = handlers;

    _panel.querySelector('.panel__close').addEventListener('click', hide);
    _content.addEventListener('click', e => {
      const back = e.target.closest('[data-action="back"]');
      if (back) { renderList(); handlers.onBackToList(); return; }
      const item = e.target.closest('[data-project]');
      if (item) { handlers.onOpenProject(item.dataset.project, true); return; }
      const partner = e.target.closest('.partner[data-uid]');
      if (partner && !partner.disabled) handlers.onShowPart(Number(partner.dataset.uid));
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) hide();
    });
  }

  window.EXPLORER_PANEL = { init, showProject, showStack, showResults, hide, isOpen, currentProjectId, esc };
})();
