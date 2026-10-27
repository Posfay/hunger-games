/* ==========================================================================
 * arenaui.js — the arena type picker on the free-play setup screen.
 *
 * One card per arena theme (js/arenas.js). Arenas of a pack that is not installed show
 * as locked cards that describe the pack and link to its store page (ARENA_CONFIG.packUrl).
 * Career and daily Shows always use the classic arena; this picker is for free play.
 * Strings live here (EN + HU). Owner: UI.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const A = GM.Arenas;

  GM.i18n.add({
    en: {
      'arena.pick': 'Arena type',
      'arena.pick.hint': 'The arena code still decides the layout; the type decides the land, the sky and the weather.',
      'arena.locked': 'Locked',
      'arena.inPack': 'Part of the {pack}',
      'arena.packInfo': '{pack}: {text}',
      'arena.get': 'Get the pack',
    },
    hu: {
      'arena.pick': 'Aréna típusa',
      'arena.pick.hint': 'Az aréna kódja továbbra is a felépítést adja; a típus a tájat, az eget és az időjárást.',
      'arena.locked': 'Zárolva',
      'arena.inPack': 'A(z) {pack} része',
      'arena.packInfo': '{pack}: {text}',
      'arena.get': 'A csomag megszerzése',
    },
  });

  const t = function (k, p) { return GM.t(k, p); };
  function play(name) { try { if (GM.Audio && GM.Audio.play) GM.Audio.play(name); } catch (e) { /* optional */ } }

  function h(tag, props, kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    if (kids != null) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c == null || c === false) return;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return el;
  }

  const ui = { built: false, note: '', syncAt: 0 };
  const dom = {};

  function packUrl() {
    const c = window.ARENA_CONFIG;
    const u = c && typeof c.packUrl === 'string' ? c.packUrl.trim() : '';
    return /^https?:\/\//i.test(u) ? u : '';
  }

  function pick(item) {
    if (item.owned) {
      if (!A.select(item.id)) return;
      play('click');
      ui.note = '';
      // show the new arena type behind the setup sheet right away
      if (GM.state.phase === 'setup' && GM.Game && GM.Game.previewArena) {
        try { GM.Game.previewArena(GM.state.seed, item.id); } catch (e) { GM.reportError('ArenaUI.preview', e); }
      }
      render();
      return;
    }
    play('click');
    const url = packUrl();
    if (url) { try { window.open(url, '_blank', 'noopener'); } catch (e) { /* popup blocked */ } }
    ui.note = t('arena.packInfo', { pack: '@pack.' + item.pack, text: '@pack.' + item.pack + '.desc' });
    render();
  }

  function render() {
    if (!ui.built) return;
    dom.title.textContent = t('arena.pick');
    dom.hint.textContent = t('arena.pick.hint');
    dom.grid.textContent = '';
    const sel = A.selected();
    A.list().forEach(function (item) {
      const on = item.owned && item.id === sel;
      const card = h('button', {
        type: 'button', class: 'ar-card' + (on ? ' on' : '') + (item.owned ? '' : ' locked'),
        'aria-pressed': item.owned ? (on ? 'true' : 'false') : null, 'data-arena': item.id,
        onclick: function () { pick(item); },
      }, [
        h('span', { class: 'ar-ico', 'aria-hidden': 'true' }, [item.owned ? item.icon : '🔒']),
        h('span', { class: 'ar-body' }, [
          h('span', { class: 'ar-name', text: t('arena.' + item.id) }),
          h('span', { class: 'ar-desc', text: item.owned ? t('arena.' + item.id + '.desc') : t('arena.inPack', { pack: '@pack.' + item.pack }) }),
        ]),
      ]);
      dom.grid.appendChild(card);
    });
    dom.note.textContent = ui.note;
    dom.note.hidden = !ui.note;
  }

  function build() {
    const host = document.querySelector('#setup .s-arena');
    if (!host) return false;
    dom.title = h('div', { class: 'lbl ar-title' });
    dom.hint = h('p', { class: 'hint' });
    dom.grid = h('div', { class: 'ar-grid', role: 'group' });
    dom.note = h('p', { class: 'ar-note', 'aria-live': 'polite', hidden: true });
    host.appendChild(h('div', { class: 'ar-pick' }, [dom.title, dom.hint, dom.grid, dom.note]));
    ui.built = true;
    return true;
  }

  GM.registerSystem({
    name: 'ArenaUI',
    order: 114,
    init() {
      if (!build()) return;
      render();
      GM.on('lang:changed', render);
      GM.on('arenas:changed', render);
    },
    frame() {
      if (!ui.built || GM.state.phase !== 'setup') return;
      const now = GM.state.realTime || 0;
      if (now - ui.syncAt < 0.5) return;
      ui.syncAt = now;
      // free-play setup visible and showing another arena type (e.g. after a career / daily Show): show the picked one
      const setupEl = document.getElementById('setup');
      const daily = document.getElementById('daily-hub');
      if (!setupEl || setupEl.hidden || (daily && !daily.hidden)) return;
      const want = A.selected();
      if (A.active() !== want && GM.Game && GM.Game.previewArena) {
        try { GM.Game.previewArena(GM.state.seed, want); } catch (e) { GM.reportError('ArenaUI.sync', e); }
      }
    },
  });
})();
