/* ==========================================================================
 * i18n.js — English / Hungarian localisation.
 *
 *   GM.i18n.add({ en: {...}, hu: {...} })   register strings (each module adds its own)
 *   GM.t(key, params)                        translate; '{name}' placeholders
 *   GM.i18n.setLang('hu') / toggle()         switches instantly, emits 'lang:changed'
 *   GM.i18n.apply(root)                      refresh [data-i18n*] attributes in the DOM
 *
 * Param rules:
 *   - A string param starting with '@' is itself a key:  {weapon: '@item.spear'}
 *   - An object param {key, params} is translated recursively.
 *   - If params.n === 1 and `${key}_one` exists, that variant is used (English plurals).
 *
 * Hungarian style rule: never glue a case suffix onto a placeholder
 * ("{name}-t" breaks vowel harmony). Use "Label: {name}" or nominative forms.
 *
 * Owner: core. Shared vocabulary lives here (causes, weather, time words);
 * module-specific strings live in the modules.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;

  const dict = { en: Object.create(null), hu: Object.create(null) };
  const warned = new Set();

  function resolveParam(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.charAt(0) === '@' ? I.t(v.slice(1)) : v;
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : I.num(v, 1);
    if (typeof v === 'object' && v.key) return I.t(v.key, v.params);
    return String(v);
  }

  const I = (GM.i18n = {
    lang: 'en',
    langs: ['en', 'hu'],

    /** Merge a dictionary: { en: {key: text}, hu: {key: text} }. */
    add(d) {
      for (const lang in d) {
        if (!dict[lang]) dict[lang] = Object.create(null);
        Object.assign(dict[lang], d[lang]);
      }
    },

    has(key, lang) {
      return !!dict[lang || I.lang] && dict[lang || I.lang][key] !== undefined;
    },

    /** Translate a key with params. Falls back to English, then to the key itself. */
    t(key, params) {
      if (key == null) return '';
      if (typeof key === 'object' && key.key) return I.t(key.key, key.params);
      let k = key;
      if (params && params.n === 1 && dict[I.lang][key + '_one'] !== undefined) k = key + '_one';
      let s = dict[I.lang][k];
      if (s === undefined) {
        s = dict.en[k];
        if (!warned.has(I.lang + ':' + k)) {
          warned.add(I.lang + ':' + k);
          console.warn('[i18n] missing ' + I.lang + ' key: ' + k);
        }
        if (s === undefined) return String(key);
      }
      if (params && s.indexOf('{') >= 0) {
        s = s.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined ? resolveParam(params[p]) : m));
      }
      return s;
    },

    /** Locale-aware number: 12.5 -> "12.5" (en) / "12,5" (hu). */
    num(v, decimals) {
      const d = decimals == null ? 0 : decimals;
      try {
        return Number(v).toLocaleString(I.lang === 'hu' ? 'hu-HU' : 'en-US', {
          minimumFractionDigits: 0,
          maximumFractionDigits: d,
        });
      } catch (e) {
        return Number(v).toFixed(d);
      }
    },

    /** 12400000 -> "12.4M" / "12,4 M" */
    compact(v) {
      const units = I.lang === 'hu' ? ['', ' E', ' M', ' Mrd'] : ['', 'K', 'M', 'B'];
      let u = 0;
      while (Math.abs(v) >= 1000 && u < units.length - 1) { v /= 1000; u++; }
      return I.num(v, v < 10 && u > 0 ? 1 : 0) + units[u];
    },

    setLang(lang) {
      if (!dict[lang] || lang === I.lang) return;
      I.lang = lang;
      try { localStorage.setItem('gm-arena-lang', lang); } catch (e) { /* storage blocked */ }
      document.documentElement.lang = lang;
      I.apply(document);
      GM.emit('lang:changed', { lang });
    },

    toggle() { I.setLang(I.lang === 'en' ? 'hu' : 'en'); },

    /** Pick the saved language, else the browser language. Called by main.js at boot. */
    init() {
      let lang = null;
      try { lang = localStorage.getItem('gm-arena-lang'); } catch (e) { /* ignore */ }
      if (!lang || !dict[lang]) {
        const nav = (navigator.language || 'en').toLowerCase();
        lang = nav.indexOf('hu') === 0 ? 'hu' : 'en';
      }
      I.lang = lang;
      document.documentElement.lang = lang;
      I.apply(document);
    },

    /**
     * Refresh static DOM text:
     *   data-i18n="key"            -> textContent
     *   data-i18n-html="key"       -> innerHTML (trusted strings only)
     *   data-i18n-title="key"      -> title attribute (tooltips)
     *   data-i18n-placeholder="key"
     *   data-i18n-aria="key"       -> aria-label
     *   data-i18n-params='{"n":3}' -> params for any of the above (JSON)
     */
    apply(root) {
      root = root || document;
      if (!root.querySelectorAll) return;
      const params = (el) => {
        const raw = el.getAttribute('data-i18n-params');
        if (!raw) return undefined;
        try { return JSON.parse(raw); } catch (e) { return undefined; }
      };
      root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = I.t(el.getAttribute('data-i18n'), params(el)); });
      root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = I.t(el.getAttribute('data-i18n-html'), params(el)); });
      root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = I.t(el.getAttribute('data-i18n-title'), params(el)); });
      root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = I.t(el.getAttribute('data-i18n-placeholder'), params(el)); });
      root.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', I.t(el.getAttribute('data-i18n-aria'), params(el))); });
    },

    /** Dev helper: keys that exist in one language but not the other. */
    missing() {
      const out = { hu: [], en: [] };
      for (const k in dict.en) if (dict.hu[k] === undefined) out.hu.push(k);
      for (const k in dict.hu) if (dict.en[k] === undefined) out.en.push(k);
      return out;
    },

    /** Dev helper: every key known in English. */
    keys() { return Object.keys(dict.en); },
  });

  GM.t = function (key, params) { return I.t(key, params); };

  // ------------------------------------------------------------------------
  // Shared vocabulary (used by several modules). Keep words simple.
  // ------------------------------------------------------------------------
  I.add({
    en: {
      'app.title': "The Game Master's Arena",
      'app.subtitle': 'Control room',
      'app.fatal3d': 'The 3D engine could not load. Please check your internet connection and reload the page.',
      'lang.en': 'English',
      'lang.hu': 'Magyar',
      'lang.toggle': 'Change language',

      'common.day': 'Day {n}',
      'common.district': 'District {n}',
      'common.districtShort': 'D{n}',
      'common.tribute': 'Tribute',
      'common.tributes': 'Tributes',
      'common.alive': 'Alive',
      'common.dead': 'Dead',
      'common.unknown': 'Unknown',
      'common.nobody': 'Nobody',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.on': 'On',
      'common.off': 'Off',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.ok': 'OK',
      'common.seconds': '{n} s',
      'common.mutt': 'Mutt',

      'tod.dawn': 'Dawn',
      'tod.day': 'Day',
      'tod.dusk': 'Dusk',
      'tod.night': 'Night',

      'weather.clear': 'Clear',
      'weather.rain': 'Rain',
      'weather.storm': 'Storm',
      'weather.fog': 'Fog',
      'weather.snow': 'Snow',
      'weather.heat': 'Heat wave',

      // Death causes (tribute.deathCause values)
      'cause.weapon': 'Weapon',
      'cause.fists': 'Bare hands',
      'cause.fire': 'Fire',
      'cause.fireball': 'Fireball',
      'cause.explosion': 'Explosion',
      'cause.lightning': 'Lightning',
      'cause.mutt': 'Mutts',
      'cause.wasps': 'Tracker jackers',
      'cause.gas': 'Poison fog',
      'cause.drown': 'Drowning',
      'cause.starve': 'Hunger',
      'cause.thirst': 'Thirst',
      'cause.cold': 'Cold',
      'cause.forcefield': 'Force field',
      'cause.trap': 'Trap',
      'cause.poison': 'Poison berries',
      'cause.quake': 'Earthquake',
      'cause.fall': 'Fall',
      'cause.smite': 'Game Master strike',
      'cause.unknown': 'Unknown cause',

      // Core flow
      'ann.bloodbath': 'The Games have begun!',
      'ann.bloodbathSub': 'Let the bloodbath begin.',
      'ann.victor': 'Victor: {name}, District {district}!',
      'ann.noVictor': 'No one survived. There is no victor.',
      'log.gamesBegin': 'The Games begin with {n} tributes.',
      'log.victor': '{name} from District {district} wins the Games!',
      'log.noVictor': 'The last tributes died together. No victor.',
    },
    hu: {
      'app.title': 'A Játékmester Arénája',
      'app.subtitle': 'Irányítóterem',
      'app.fatal3d': 'A 3D motor nem töltődött be. Ellenőrizd az internetkapcsolatot, és töltsd újra az oldalt.',
      'lang.en': 'English',
      'lang.hu': 'Magyar',
      'lang.toggle': 'Nyelv váltása',

      'common.day': '{n}. nap',
      'common.district': '{n}. körzet',
      'common.districtShort': '{n}. k.',
      'common.tribute': 'Kiválasztott',
      'common.tributes': 'Kiválasztottak',
      'common.alive': 'Él',
      'common.dead': 'Halott',
      'common.unknown': 'Ismeretlen',
      'common.nobody': 'Senki',
      'common.yes': 'Igen',
      'common.no': 'Nem',
      'common.on': 'Be',
      'common.off': 'Ki',
      'common.close': 'Bezárás',
      'common.cancel': 'Mégse',
      'common.ok': 'OK',
      'common.seconds': '{n} mp',
      'common.mutt': 'Mutáns',

      'tod.dawn': 'Hajnal',
      'tod.day': 'Nappal',
      'tod.dusk': 'Alkony',
      'tod.night': 'Éjszaka',

      'weather.clear': 'Derült',
      'weather.rain': 'Eső',
      'weather.storm': 'Vihar',
      'weather.fog': 'Köd',
      'weather.snow': 'Havazás',
      'weather.heat': 'Hőség',

      'cause.weapon': 'Fegyver',
      'cause.fists': 'Puszta kéz',
      'cause.fire': 'Tűz',
      'cause.fireball': 'Tűzgolyó',
      'cause.explosion': 'Robbanás',
      'cause.lightning': 'Villám',
      'cause.mutt': 'Mutánsok',
      'cause.wasps': 'Vérdarazsak',
      'cause.gas': 'Mérges köd',
      'cause.drown': 'Vízbe fulladás',
      'cause.starve': 'Éhezés',
      'cause.thirst': 'Szomjúság',
      'cause.cold': 'Hideg',
      'cause.forcefield': 'Erőtér',
      'cause.trap': 'Csapda',
      'cause.poison': 'Mérges bogyó',
      'cause.quake': 'Földrengés',
      'cause.fall': 'Zuhanás',
      'cause.smite': 'A Játékmester csapása',
      'cause.unknown': 'Ismeretlen ok',

      'ann.bloodbath': 'Kezdődik a Viadal!',
      'ann.bloodbathSub': 'Kezdődjön a vérfürdő.',
      'ann.victor': 'A győztes: {name}, {district}. körzet!',
      'ann.noVictor': 'Senki sem élte túl. Nincs győztes.',
      'log.gamesBegin': 'A Viadal {n} kiválasztottal kezdődik.',
      'log.victor': 'A Viadalt {name} nyerte ({district}. körzet)!',
      'log.noVictor': 'Az utolsó kiválasztottak együtt haltak meg. Nincs győztes.',
    },
  });
})();
