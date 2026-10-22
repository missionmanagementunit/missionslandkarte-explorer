// Lädt die Explorer-Daten (erzeugt von build_explorer_data.py) und baut die Nachschlage-Strukturen.
// Enthält außerdem die Filter- und Suchlogik als reine Funktionen — ohne DOM, damit sie sich
// in Node gegen die echten Daten prüfen lässt.

(function () {
  'use strict';

  const PROJECTS_URL       = 'data/projects.json';
  const PARTICIPATIONS_URL = 'data/participations.json';
  const ABSTRACTS_URL      = 'data/abstracts.json';
  const META_URL           = 'data/meta.json';

  let _abstractsPromise = null;

  /** Fold text for search: lower case, umlauts and accents removed. */
  function fold(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      // CORDIS schreibt Umlaute oft als "ue/oe/ae" — beides gleich behandeln
      .replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
  }

  /** Fetch one JSON file and fail loudly with its URL. */
  function fetchJson(url) {
    return fetch(url).then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status} beim Laden von ${url}`);
      return res.json();
    });
  }

  /** Build lookups: projects by id, participations by project, a search key per project. */
  function index(projects, participations, meta) {
    const projectsById = new Map(projects.map(p => [p.id, p]));
    const partsByProject = new Map(projects.map(p => [p.id, []]));

    participations.forEach((part, i) => {
      part.uid = i;  // stabile Kennung je Beteiligung, für Marker und Prüfungen
      const project = projectsById.get(part.project_id);
      if (!project) throw new Error(`Beteiligung ohne Projekt: ${part.project_id}`);
      part.project = project;
      partsByProject.get(part.project_id).push(part);
    });

    projects.forEach(p => {
      const names = partsByProject.get(p.id).flatMap(x => [x.name, x.short_name || '']);
      p.searchKey = fold([p.acronym, p.title, p.coordinator && p.coordinator.name, ...names].join(' '));
      p.located = partsByProject.get(p.id).some(x => x.lat !== null);
    });

    return { projects, participations, projectsById, partsByProject, meta };
  }

  /** Load projects, participations and meta; abstracts are loaded later on demand. */
  function load() {
    return Promise.all([fetchJson(PROJECTS_URL), fetchJson(PARTICIPATIONS_URL), fetchJson(META_URL)])
      .then(([projects, participations, meta]) => index(projects, participations, meta));
  }

  /** Return the abstract of one project; the file is fetched on the first call only. */
  function loadAbstract(projectId) {
    if (!_abstractsPromise) _abstractsPromise = fetchJson(ABSTRACTS_URL);
    return _abstractsPromise.then(all => all[projectId] || null);
  }

  // ── Filter ──────────────────────────────────────────────────────────────

  /**
   * filter = { missions: Set|null, bundeslaender: Set|null, source: string|null, query: string }
   * Mission, Quelle und Suchtext wirken auf Projekte, das Bundesland auf die einzelne Beteiligung.
   */
  function projectMatches(project, filter) {
    if (filter.missions && !filter.missions.has(project.mission)) return false;
    if (filter.source && project.source !== filter.source) return false;
    if (filter.query) {
      const patterns = compileQuery(filter.query);
      if (!patterns.every(re => re.test(project.searchKey))) return false;
    }
    return true;
  }

  const SHORT_TERM_MAX = 2;   // "tu", "e7": nur als ganzes Wort — sonst trifft "tu" auch "Institut"
  const PREFIX_TERM_MAX = 3;  // "ait": am Wortanfang; ab 4 Zeichen überall, damit "wasser" auch "Abwasser" findet
  const _queryCache = new Map();

  /** Turn a search query into one RegExp per term; stricter for short terms. */
  function compileQuery(query) {
    if (_queryCache.has(query)) return _queryCache.get(query);
    const patterns = fold(query).split(/[^a-z0-9]+/).filter(Boolean).map(term => {
      const t = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (term.length <= SHORT_TERM_MAX) return new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`);
      if (term.length <= PREFIX_TERM_MAX) return new RegExp(`(^|[^a-z0-9])${t}`);
      return new RegExp(t);
    });
    _queryCache.set(query, patterns);
    return patterns;
  }

  /** Participations that should appear as dots under the filter. */
  function visibleParticipations(data, filter) {
    return data.participations.filter(part =>
      part.lat !== null
      && projectMatches(part.project, filter)
      && (!filter.bundeslaender || filter.bundeslaender.has(part.bundesland)));
  }

  /** Projects that match the filter (for the search result list). */
  function matchingProjects(data, filter) {
    return data.projects.filter(p => {
      if (!projectMatches(p, filter)) return false;
      if (!filter.bundeslaender) return true;
      return data.partsByProject.get(p.id).some(x => filter.bundeslaender.has(x.bundesland));
    });
  }

  const api = { load, loadAbstract, fold, index, projectMatches, visibleParticipations, matchingProjects };
  if (typeof window !== 'undefined') window.EXPLORER_DATA = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
