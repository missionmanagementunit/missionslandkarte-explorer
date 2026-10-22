// Anzeigetexte und Farben des Explorers. Alle Formulierungen der Projektkarte stehen hier,
// damit sie ohne Code-Änderung angepasst werden können.

(function () {
  'use strict';

  window.EXPLORER_CONFIG = {
    // Missionen — Bezeichnungen und Farben wie in der Präsentation
    missions: {
      climate: { label: 'Klimawandel meistern',         color: '#d34a56', icon: 'Climate' },
      cities:  { label: 'Klimaneutrale Stadt',          color: '#76a772', icon: 'Cities' },
      cancer:  { label: 'Krebs besiegen',               color: '#d39c45', icon: 'Cancer' },
      soil:    { label: 'Gesunde Böden',                color: '#7d5e9c', icon: 'Soil' },
      water:   { label: 'Wasser und Gewässer schützen', color: '#6a8cb7', icon: 'Waters' },
    },

    sources: {
      eu_fp: 'EU-Rahmenprogramm',
      ffg:   'FFG',
      life:  'LIFE',
      other: 'Sonstige',
    },

    linkLabels: {
      eu_fp: 'Projektseite bei CORDIS',
      ffg:   'Projektseite bei der FFG',
      life:  'Projektseite in der LIFE-Datenbank',
      other: 'Projektseite',
    },

    // Rolle einer Beteiligung (null = in der Quelle nicht angegeben)
    roles: {
      coordinator:          'Koordination',
      sole_applicant:       'Einzelantragsteller',
      participant:          'Partner',
      partner:              'Partner',
      thirdParty:           'Verbundener Dritter',
      associatedPartner:    'Assoziierter Partner',
      internationalPartner: 'Internationaler Partner',
      null:                 'Rolle nicht angegeben',
    },

    // Förderstatus — "amount" zeigt den Betrag selbst
    funding: {
      no_eu_funding: 'ohne EU-Förderung',
      third_party:   'Förderung über Partner',
      not_public:    'Förderung nicht öffentlich',
      in_kind:       'In-kind',
      unknown:       'Förderung nicht bekannt',
    },

    notes: {
      partnersIncomplete: 'Weitere Partner sind in dieser Quelle nicht erfasst.',
      notInCordis:        'in CORDIS nicht gelistet',
      ended:              'ausgeschieden',
      noLocation:         'Standort nicht veröffentlicht',
      abstractEnglish:    'Kurzbeschreibung auf Englisch, aus CORDIS',
    },

    // CORDIS verwendet zwei Ländercodes, die nicht ISO 3166 entsprechen
    countryCodeFixes: { UK: 'GB', EL: 'GR' },
  };
})();
