/* ==========================================================================
 * save.js — persistent player profile (localStorage).
 *
 *   GM.Save.section(name, defaults)  -> live object for one section of the save
 *                                       (missing keys are filled from defaults,
 *                                       so new versions never break old saves)
 *   GM.Save.commit()                 write the whole document now
 *   GM.Save.persistent()             false when the browser refuses to store data
 *   GM.Save.exportCode() / importCode(text)   copy / paste backup code
 *   GM.Save.reset()                  back to defaults (every section, in place)
 *
 * Section objects are mutated IN PLACE by import / reset / other-tab changes, so
 * modules can keep their reference. Events: 'save:imported', 'save:reset',
 * 'save:external' (another tab wrote the save).
 *
 * A running Show is never saved (it is a live 3D simulation); progress is saved
 * when something is earned.
 * Owner: core. Never throws: storage errors fall back to memory.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;

  const KEY = 'arena-showrunner-save-v1';
  const VERSION = 1;
  const CODE_PREFIX = 'ARS1.';

  const sections = Object.create(null);   // name -> { data, defaults }
  let doc = { v: VERSION, created: 0, updated: 0, sections: {} };
  let storageOk = false;
  let writeFailed = false;

  const Save = (GM.Save = {
    KEY: KEY,
    VERSION: VERSION,
    /** true when data really reaches localStorage. */
    persistent() { return storageOk && !writeFailed; },
  });

  // ---------------------------------------------------------------- helpers
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

  /** Fill keys missing in target from defaults (deep for plain objects). */
  function fill(target, defaults) {
    for (const k in defaults) {
      const d = defaults[k];
      if (target[k] === undefined) target[k] = clone(d);
      else if (isObj(d) && isObj(target[k])) fill(target[k], d);
    }
    return target;
  }
  function replaceInPlace(target, src) {
    for (const k of Object.keys(target)) delete target[k];
    for (const k in src) target[k] = src[k];
  }
  function validDoc(d) {
    return isObj(d) && typeof d.v === 'number' && d.v >= 1 && isObj(d.sections);
  }

  function readRaw() {
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function probeStorage() {
    try {
      const k = KEY + '.probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  function parseDoc(raw) {
    const d = JSON.parse(raw);
    if (!validDoc(d)) throw new Error('bad save shape');
    return d;
  }

  // ------------------------------------------------------------------- load
  function load() {
    storageOk = probeStorage();
    doc = { v: VERSION, created: Date.now(), updated: 0, sections: {} };
    const raw = readRaw();
    if (!raw) return;
    try {
      const d = parseDoc(raw);
      d.v = Math.max(VERSION, d.v);      // saved by a newer build: keep its data, don't downgrade
      doc = d;
    } catch (e) {
      GM.reportError('Save.load', e);
      // keep the unreadable text so it can be recovered by hand, then start fresh
      try { window.localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) { /* ignore */ }
    }
  }
  load();

  // ---------------------------------------------------------------- sections
  Save.section = function (name, defaults) {
    if (sections[name]) return sections[name].data;
    const raw = doc.sections[name];
    const data = isObj(raw) ? raw : {};
    fill(data, defaults);
    doc.sections[name] = data;
    sections[name] = { data: data, defaults: defaults };
    return data;
  };

  Save.commit = function () {
    doc.updated = Date.now();
    if (!storageOk) return false;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(doc));
      writeFailed = false;
      return true;
    } catch (e) {
      writeFailed = true;
      GM.reportError('Save.commit', e);
      return false;
    }
  };

  Save.reset = function () {
    for (const name in sections) {
      const s = sections[name];
      replaceInPlace(s.data, clone(s.defaults));
      doc.sections[name] = s.data;
    }
    doc.created = Date.now();
    Save.commit();
    GM.emit('save:reset', {});
  };

  // ------------------------------------------------------- backup code (text)
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64dec(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function hex8(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

  /** One-line backup code of the whole save. */
  Save.exportCode = function () {
    const json = JSON.stringify({ v: doc.v, sections: doc.sections });
    return CODE_PREFIX + hex8(GM.hashString(json)) + '.' + b64enc(json);
  };

  /**
   * Replace the save with a backup code. -> { ok: true } or
   * { ok: false, error: 'format' | 'checksum' | 'version' | 'empty' }
   */
  Save.importCode = function (text) {
    const code = String(text == null ? '' : text).replace(/\s+/g, '');
    if (!code) return { ok: false, error: 'empty' };
    if (code.indexOf(CODE_PREFIX) !== 0) return { ok: false, error: 'format' };
    const rest = code.slice(CODE_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot !== 8) return { ok: false, error: 'format' };
    let json, incoming;
    try {
      json = b64dec(rest.slice(dot + 1));
    } catch (e) { return { ok: false, error: 'format' }; }
    if (hex8(GM.hashString(json)) !== rest.slice(0, dot)) return { ok: false, error: 'checksum' };
    try { incoming = JSON.parse(json); } catch (e) { return { ok: false, error: 'format' }; }
    if (!validDoc(incoming)) return { ok: false, error: 'format' };
    if (incoming.v > VERSION) return { ok: false, error: 'version' };
    for (const name in sections) {
      const s = sections[name];
      const src = isObj(incoming.sections[name]) ? incoming.sections[name] : {};
      replaceInPlace(s.data, fill(src, s.defaults));
      doc.sections[name] = s.data;
    }
    for (const name in incoming.sections) if (!sections[name]) doc.sections[name] = incoming.sections[name];
    Save.commit();
    GM.emit('save:imported', {});
    return { ok: true };
  };

  // ------------------------------------------------- another tab saved a change
  try {
    window.addEventListener('storage', function (e) {
      if (e.key !== KEY) return;
      try {
        if (e.newValue == null) {
          for (const name in sections) {
            replaceInPlace(sections[name].data, clone(sections[name].defaults));
            doc.sections[name] = sections[name].data;
          }
        } else {
          const d = parseDoc(e.newValue);
          for (const name in sections) {
            const src = isObj(d.sections[name]) ? d.sections[name] : {};
            replaceInPlace(sections[name].data, fill(src, sections[name].defaults));
            doc.sections[name] = sections[name].data;
          }
        }
        GM.emit('save:external', {});
      } catch (err) { GM.reportError('Save.storageEvent', err); }
    });
  } catch (e) { /* no window events (tests) */ }
})();
