/* ==========================================================================
 * dailyui.js — the interface of the daily challenge.
 *
 *   daily screen   full-screen overlay opened from the "Daily" buttons of the setup
 *                  screen and the career hub: Today / Leaderboard / Records
 *   result card    daily block inside the victory card (score, records, submit)
 *
 * Logic lives in daily.js, the online board in leaderboard.js. Strings live here
 * (EN + HU). Reuses the career hub's layout classes (css/career.css). Owner: UI.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const D = GM.Daily;
  const LB = GM.Leaderboard;
  const REC = GM.Records;

  // ================================================================ strings
  GM.i18n.add({
    en: {
      'daily.open': 'Daily',
      'daily.title': 'Daily challenge',
      'daily.back': 'Back',
      'daily.tab.today': 'Today',
      'daily.tab.board': 'Leaderboard',
      'daily.tab.records': 'Records',

      'daily.kicker': 'Daily challenge · {date}',
      'daily.arena': 'Arena #{n}',
      'daily.cast': '{n} contestants',
      'daily.resets': 'New challenge in {t}',
      'daily.rules': 'Everybody plays the same arena with the same cast. No studio upgrades and no sandbox: every power is open. Retry as often as you like; your best score of the day counts.',
      'daily.twist': 'Today\'s twist',
      'daily.twist.classic': 'Classic',
      'daily.twist.classic.desc': 'No twist. The standard control room.',
      'daily.twist.lean': 'Lean budget',
      'daily.twist.lean.desc': 'A smaller battery (75) that refills 20% faster. Spend wisely.',
      'daily.twist.quickdraw': 'Quick draw',
      'daily.twist.quickdraw.desc': 'Powers cool down 35% faster, but energy refills 20% slower.',
      'daily.twist.showtime': 'Showtime',
      'daily.twist.showtime.desc': 'Exciting moments lift the ratings 25% more, but the battery is smaller (85).',
      'daily.twist.crowd': 'Packed arena',
      'daily.twist.crowd.desc': 'Eight extra contestants. More chaos, more betrayals.',

      'daily.best': 'Your best today',
      'daily.noBest': 'Not played yet',
      'daily.points': 'points',
      'daily.play': 'Play today\'s Show',
      'daily.playAgain': 'Try again',
      'daily.playSub': 'Arena #{n} · {twist}',
      'daily.streak': 'Streak',
      'daily.streak.days': '{n} days',
      'daily.streak.days_one': '1 day',
      'daily.streak.longest': 'Longest: {n}',
      'daily.streak.hint': 'Play every day to keep it going.',
      'daily.recent': 'Recent days',
      'daily.recentEmpty': 'Play your first daily Show to start a streak.',

      'daily.board.today': 'Today',
      'daily.board.alltime': 'All time',
      'daily.board.name': 'Your leaderboard name',
      'daily.board.namePh': 'Pick a name (max 16)',
      'daily.board.save': 'Save name',
      'daily.board.saved': 'Name saved.',
      'daily.board.nameNeeded': 'Pick a name first.',
      'daily.board.loading': 'Loading scores…',
      'daily.board.refresh': 'Refresh',
      'daily.board.empty': 'Nobody has posted a score yet. Be the first!',
      'daily.board.total': '{n} players',
      'daily.board.total_one': '1 player',
      'daily.board.stats': '{players} players · {runs} scores',
      'daily.board.rank': '#',
      'daily.board.player': 'Player',
      'daily.board.score': 'Score',
      'daily.board.viewers': 'Viewers',
      'daily.board.you': 'you',
      'daily.board.off.title': 'The online leaderboard is not connected',
      'daily.board.off.text': 'This build keeps scores on this device only. Your own results are listed below, and nothing is sent anywhere.',
      'daily.board.local': 'Scores on this device',
      'daily.err.offline': 'Could not reach the leaderboard. Check your connection.',
      'daily.err.timeout': 'The leaderboard took too long to answer.',
      'daily.err.bad': 'The leaderboard sent something unexpected.',
      'daily.err.http': 'The leaderboard refused the request.',
      'daily.err.date_out_of_range': 'This challenge is no longer open for scores.',
      'daily.err.cast_mismatch': 'That result does not belong to this challenge.',
      'daily.err.twist_mismatch': 'That result does not belong to this challenge.',
      'daily.err.grade_mismatch': 'That result looks inconsistent and was refused.',

      'daily.rec.title': 'Records',
      'daily.rec.hint': 'Your personal bests across every Show. Sandbox Shows never count.',
      'daily.rec.score': 'Best Show score',
      'daily.rec.viewers': 'Most viewers',
      'daily.rec.longest': 'Longest Show',
      'daily.rec.quickest': 'Fastest finish',
      'daily.rec.topKills': 'Most kills by one contestant',
      'daily.rec.betrayals': 'Most betrayals in a Show',
      'daily.rec.cast': 'Biggest cast finished',
      'daily.rec.none': 'No record yet',
      'daily.mode.daily': 'Daily',
      'daily.mode.career': 'Career',
      'daily.mode.free': 'Free play',
      'daily.totals': 'Totals',
      'daily.totals.shows': 'Shows finished',
      'daily.totals.daily': 'Daily Shows',
      'daily.totals.streak': 'Longest streak',
      'daily.totals.grades': 'Ratings',
      'daily.totals.wins': 'Winners by type',
      'daily.totals.winsNone': 'No winners yet.',

      'daily.res.kicker': 'Daily challenge · {date}',
      'daily.res.score': 'Show score',
      'daily.res.newBest': 'New best of the day!',
      'daily.res.bestToday': 'Best today: {n}',
      'daily.res.record': 'New record: {name}',
      'daily.res.streak': 'Streak: {n} days',
      'daily.res.streak_one': 'Streak: 1 day',
      'daily.res.submit': 'Submit best of the day',
      'daily.res.sending': 'Sending…',
      'daily.res.sent': 'Submitted! You are #{rank} of {total} today.',
      'daily.res.again': 'Submit again',
      'daily.res.off': 'The online leaderboard is not connected in this build. Your score is saved on this device.',
      'daily.res.privacy': 'Sends your name, score and show stats. Nothing else.',
      'daily.res.back': 'Back to the daily challenge',
    },
    hu: {
      'daily.open': 'Napi',
      'daily.title': 'Napi kihívás',
      'daily.back': 'Vissza',
      'daily.tab.today': 'Ma',
      'daily.tab.board': 'Ranglista',
      'daily.tab.records': 'Rekordok',

      'daily.kicker': 'Napi kihívás · {date}',
      'daily.arena': 'Aréna #{n}',
      'daily.cast': '{n} versenyző',
      'daily.resets': 'Új kihívás: {t} múlva',
      'daily.rules': 'Mindenki ugyanabban az arénában, ugyanazzal a szereplőgárdával játszik. Nincsenek stúdió fejlesztések és nincs homokozó: minden képesség nyitva áll. Annyiszor próbálkozhatsz, ahányszor akarsz; a nap legjobb pontszáma számít.',
      'daily.twist': 'A mai csavar',
      'daily.twist.classic': 'Klasszikus',
      'daily.twist.classic.desc': 'Nincs csavar. A megszokott irányítóterem.',
      'daily.twist.lean': 'Szűkös keret',
      'daily.twist.lean.desc': 'Kisebb akkumulátor (75), de 20%-kal gyorsabban töltődik. Gazdálkodj okosan.',
      'daily.twist.quickdraw': 'Gyorskezű',
      'daily.twist.quickdraw.desc': 'A képességek 35%-kal gyorsabban töltődnek újra, de az energia 20%-kal lassabban.',
      'daily.twist.showtime': 'Showtime',
      'daily.twist.showtime.desc': 'Az izgalmas pillanatok 25%-kal jobban emelik a nézettséget, de kisebb az akkumulátor (85).',
      'daily.twist.crowd': 'Tömött aréna',
      'daily.twist.crowd.desc': 'Nyolc extra versenyző. Több káosz, több árulás.',

      'daily.best': 'A mai legjobbad',
      'daily.noBest': 'Még nem játszottál',
      'daily.points': 'pont',
      'daily.play': 'A mai Műsor indítása',
      'daily.playAgain': 'Új próbálkozás',
      'daily.playSub': 'Aréna #{n} · {twist}',
      'daily.streak': 'Sorozat',
      'daily.streak.days': '{n} nap',
      'daily.streak.days_one': '{n} nap',
      'daily.streak.longest': 'Leghosszabb: {n}',
      'daily.streak.hint': 'Játssz minden nap, hogy ne szakadjon meg.',
      'daily.recent': 'Utóbbi napok',
      'daily.recentEmpty': 'Játszd le az első napi Műsorodat, és indul a sorozatod.',

      'daily.board.today': 'Ma',
      'daily.board.alltime': 'Mindenkori',
      'daily.board.name': 'Neved a ranglistán',
      'daily.board.namePh': 'Válassz nevet (legfeljebb 16)',
      'daily.board.save': 'Név mentése',
      'daily.board.saved': 'Név elmentve.',
      'daily.board.nameNeeded': 'Előbb válassz nevet.',
      'daily.board.loading': 'Pontszámok betöltése…',
      'daily.board.refresh': 'Frissítés',
      'daily.board.empty': 'Még senki nem küldött pontszámot. Légy te az első!',
      'daily.board.total': '{n} játékos',
      'daily.board.total_one': '{n} játékos',
      'daily.board.stats': '{players} játékos · {runs} pontszám',
      'daily.board.rank': '#',
      'daily.board.player': 'Játékos',
      'daily.board.score': 'Pontszám',
      'daily.board.viewers': 'Nézők',
      'daily.board.you': 'te',
      'daily.board.off.title': 'Az online ranglista nincs bekötve',
      'daily.board.off.text': 'Ez a verzió csak ezen az eszközön tárolja a pontszámokat. Lent a saját eredményeid láthatók, és semmi nem megy ki sehová.',
      'daily.board.local': 'Pontszámok ezen az eszközön',
      'daily.err.offline': 'A ranglista nem érhető el. Ellenőrizd az internetkapcsolatot.',
      'daily.err.timeout': 'A ranglista túl lassan válaszolt.',
      'daily.err.bad': 'A ranglista váratlan választ küldött.',
      'daily.err.http': 'A ranglista elutasította a kérést.',
      'daily.err.date_out_of_range': 'Ehhez a kihíváshoz már nem lehet pontszámot küldeni.',
      'daily.err.cast_mismatch': 'Ez az eredmény nem ehhez a kihíváshoz tartozik.',
      'daily.err.twist_mismatch': 'Ez az eredmény nem ehhez a kihíváshoz tartozik.',
      'daily.err.grade_mismatch': 'Az eredmény ellentmondásosnak tűnt, ezért elutasítottuk.',

      'daily.rec.title': 'Rekordok',
      'daily.rec.hint': 'A személyes legjobbjaid az összes Műsorból. A homokozó módú Műsorok nem számítanak.',
      'daily.rec.score': 'Legjobb Műsor pontszám',
      'daily.rec.viewers': 'Legtöbb néző',
      'daily.rec.longest': 'Leghosszabb Műsor',
      'daily.rec.quickest': 'Leggyorsabb befejezés',
      'daily.rec.topKills': 'Legtöbb ölés egy versenyzőtől',
      'daily.rec.betrayals': 'Legtöbb árulás egy Műsorban',
      'daily.rec.cast': 'Legnagyobb befejezett szereplőgárda',
      'daily.rec.none': 'Még nincs rekord',
      'daily.mode.daily': 'Napi',
      'daily.mode.career': 'Karrier',
      'daily.mode.free': 'Szabad játék',
      'daily.totals': 'Összesítés',
      'daily.totals.shows': 'Befejezett Műsorok',
      'daily.totals.daily': 'Napi Műsorok',
      'daily.totals.streak': 'Leghosszabb sorozat',
      'daily.totals.grades': 'Értékelések',
      'daily.totals.wins': 'Győztesek típus szerint',
      'daily.totals.winsNone': 'Még nincs győztes.',

      'daily.res.kicker': 'Napi kihívás · {date}',
      'daily.res.score': 'Műsor pontszám',
      'daily.res.newBest': 'A nap új legjobbja!',
      'daily.res.bestToday': 'Mai legjobb: {n}',
      'daily.res.record': 'Új rekord: {name}',
      'daily.res.streak': 'Sorozat: {n} nap',
      'daily.res.streak_one': 'Sorozat: {n} nap',
      'daily.res.submit': 'A nap legjobbjának beküldése',
      'daily.res.sending': 'Küldés…',
      'daily.res.sent': 'Beküldve! Ma a(z) {rank}. vagy a(z) {total} játékosból.',
      'daily.res.again': 'Beküldés újra',
      'daily.res.off': 'Az online ranglista ebben a verzióban nincs bekötve. A pontszámod ezen az eszközön mentődik.',
      'daily.res.privacy': 'A neved, a pontszámod és a Műsor adatai mennek el. Semmi más.',
      'daily.res.back': 'Vissza a napi kihíváshoz',
    },
  });

  // ================================================================ helpers
  const t = function (k, p) { return GM.t(k, p); };
  function num(v, d) { return GM.i18n.num(v, d); }
  function play(name) { try { if (GM.Audio && GM.Audio.play) GM.Audio.play(name); } catch (e) { /* optional */ } }
  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

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
      const list = Array.isArray(kids) ? kids : [kids];
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
      }
    }
    return el;
  }
  function gradeEl(g) { return h('span', { class: 'cr-grade g-' + g }, [g]); }

  function dateLabel(date, short) {
    const ms = D.dateMs(date);
    if (!isFinite(ms)) return date;
    try {
      const o = short ? { day: 'numeric', month: 'short', timeZone: 'UTC' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
      return new Intl.DateTimeFormat(GM.i18n.lang === 'hu' ? 'hu-HU' : 'en-GB', o).format(ms);
    } catch (e) { return date; }
  }
  function clock(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
  }
  function twistName(id) { return t('daily.twist.' + id); }
  function streakText(n) { return t('daily.streak.days', { n: n }); }

  // =================================================================== state
  const TABS = ['today', 'board', 'records'];
  const ui = {
    built: false,
    open: false,
    tab: 'today',
    board: 'today',            // 'today' | 'alltime'
    load: { status: 'idle', kind: '', data: null, error: '' },
    loadToken: 0,
    nameMsg: null,             // { ok, text }
    prevSeed: -1,
    prevArena: 'verdant',
    shownDate: '',
    previewTimer: 0,
    thumbVer: -1,
    thumbSeed: -1,
    tickAt: 0,
    returnToDaily: false,
    sub: null,                 // { ts, state: 'idle'|'sending'|'ok'|'err', rank, total, text }
  };
  const dom = {};

  // ============================================================== the screen
  function buildHub(root) {
    dom.hub = h('section', { class: 'cr-hub dl-hub', id: 'daily-hub', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Daily challenge' });
    const sheet = h('div', { class: 'cr-sheet' });

    dom.brand = h('div', { class: 'cr-brand' }, [h('span', { class: 'cr-brand-ico', 'aria-hidden': 'true' }, ['📅']), h('span', { class: 'cr-brand-name' })]);
    dom.lang = h('div', { class: 'seg seg-lang', role: 'group' });
    ['en', 'hu'].forEach(function (l) {
      dom.lang.appendChild(h('button', { type: 'button', class: 'seg-btn', 'data-lang': l, onclick: function () { GM.i18n.setLang(l); } }));
    });
    dom.closeBtn = h('button', { type: 'button', class: 'btn btn-ghost cr-free', onclick: function () { play('click'); closeHub(); } });
    dom.tabs = h('nav', { class: 'cr-tabs', role: 'tablist' });
    TABS.forEach(function (id) {
      dom.tabs.appendChild(h('button', {
        type: 'button', class: 'cr-tab', role: 'tab', 'data-tab': id,
        onclick: function () { if (ui.tab !== id) { ui.tab = id; play('click'); if (id === 'board') loadBoard(false); renderAll(); } },
      }));
    });
    sheet.appendChild(h('header', { class: 'cr-head' }, [
      h('div', { class: 'cr-head-top' }, [dom.brand, h('span', { class: 'cr-spacer' }), dom.lang, dom.closeBtn]),
      dom.tabs,
    ]));

    dom.body = h('div', { class: 'cr-body' });
    sheet.appendChild(dom.body);

    dom.start = h('button', { type: 'button', class: 'start-btn cr-start', onclick: startToday }, [
      h('span', { class: 'start-glow', 'aria-hidden': 'true' }),
      h('span', { class: 'start-label' }),
      h('span', { class: 'start-sub mono' }),
    ]);
    dom.foot = h('footer', { class: 'cr-foot' }, [dom.start]);
    sheet.appendChild(dom.foot);
    dom.hub.appendChild(sheet);
    root.appendChild(dom.hub);
  }

  function startToday() {
    if (dom.start.disabled) return;
    play('click');
    ui.prevSeed = -1;                     // the Show replaces the arena: nothing to restore
    clearTimeout(ui.previewTimer);
    dom.hub.hidden = true;
    ui.open = false;
    ui.returnToDaily = false;
    D.start();
  }

  function openHub(tab) {
    if (!ui.built || GM.state.phase !== 'setup') return;
    ui.open = true;
    ui.tab = tab || 'today';
    ui.nameMsg = null;
    ui.prevSeed = GM.state.seed >>> 0;
    ui.prevArena = GM.Arenas.active();
    dom.hub.hidden = false;
    if (ui.tab === 'board') loadBoard(false);
    renderAll();
    schedulePreview(D.today().seed);
    try { dom.start.focus({ preventScroll: true }); } catch (e) { /* hidden footer */ }
  }
  function closeHub() {
    if (!ui.open) return;
    ui.open = false;
    dom.hub.hidden = true;
    clearTimeout(ui.previewTimer);
    const back = ui.prevSeed;
    ui.prevSeed = -1;
    // put the arena of the screen underneath back (setup / career hub)
    if (back >= 0 && GM.state.phase === 'setup' && ((GM.state.seed >>> 0) !== back || GM.Arenas.active() !== ui.prevArena) && GM.Game && GM.Game.previewArena) {
      try { GM.Game.previewArena(back, ui.prevArena); } catch (e) { GM.reportError('DailyUI.restore', e); }
    }
  }

  /** Show today's arena behind the screen (deferred so the click paints first). */
  function schedulePreview(seed) {
    clearTimeout(ui.previewTimer);
    if ((GM.state.seed >>> 0) === seed && GM.Arenas.active() === 'verdant') return;
    ui.previewTimer = setTimeout(function () {
      if (!ui.open || GM.state.phase !== 'setup') return;
      try { GM.Game.previewArena(seed, 'verdant'); } catch (e) { GM.reportError('DailyUI.preview', e); }
    }, 60);
  }

  // ----------------------------------------------------------------- render
  function renderHead() {
    setText(dom.brand.lastChild, t('daily.title'));
    setText(dom.closeBtn, '← ' + t('daily.back'));
    const lang = GM.i18n.lang;
    Array.prototype.forEach.call(dom.lang.children, function (b) {
      const l = b.getAttribute('data-lang');
      setText(b, t('lang.' + l));
      b.classList.toggle('on', l === lang);
      b.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
    });
    Array.prototype.forEach.call(dom.tabs.children, function (b) {
      const id = b.getAttribute('data-tab');
      setText(b, t('daily.tab.' + id));
      b.classList.toggle('on', id === ui.tab);
      b.setAttribute('aria-selected', id === ui.tab ? 'true' : 'false');
    });
  }

  function renderAll() {
    if (!ui.built) return;
    renderHead();
    dom.body.textContent = '';
    dom.foot.hidden = true;
    dom.thumb = null;
    dom.countdown = null;
    if (ui.tab === 'today') renderToday();
    else if (ui.tab === 'board') renderBoard();
    else renderRecords();
  }

  // ------------------------------------------------------------------ today
  function renderToday() {
    const c = D.today();
    ui.shownDate = c.date;
    const best = D.best(c.date);
    const sk = D.streak();

    dom.thumb = h('canvas', { class: 'cr-thumb', width: 160, height: 160, 'aria-hidden': 'true' });
    ui.thumbVer = -1;
    dom.countdown = h('span', { class: 'cr-chip mono' });
    updateCountdown();

    const challenge = h('section', { class: 'card cr-card cr-brief-card' }, [
      h('div', { class: 'cr-kick mono', text: t('daily.kicker', { date: dateLabel(c.date) }) }),
      h('h2', { class: 'cr-b-title', text: t('daily.arena', { n: c.seed }) }),
      h('div', { class: 'cr-b-meta' }, [
        dom.thumb,
        h('div', { class: 'cr-chips' }, [
          h('span', { class: 'cr-chip', text: '👥 ' + t('daily.cast', { n: c.count }) }),
          h('span', { class: 'cr-chip', text: '🎭 ' + t('setup.mix.' + c.mix) }),
          dom.countdown,
        ]),
      ]),
      h('div', { class: 'dl-twist' }, [
        h('span', { class: 'dl-twist-kick mono', text: t('daily.twist') }),
        h('span', { class: 'dl-twist-name', text: twistName(c.twist) }),
        h('span', { class: 'dl-twist-desc', text: t('daily.twist.' + c.twist + '.desc') }),
      ]),
      h('p', { class: 'hint', text: t('daily.rules') }),
    ]);

    const bestCard = h('section', { class: 'card cr-card dl-best' }, [
      h('h2', { class: 'card-title', text: t('daily.best') }),
      best
        ? h('div', { class: 'dl-best-row' }, [gradeEl(best.grade), h('span', { class: 'dl-best-score mono', text: num(best.score, 1) }), h('span', { class: 'dl-best-pts', text: t('daily.points') })])
        : h('p', { class: 'hint', text: t('daily.noBest') }),
    ]);

    const streakCard = h('section', { class: 'card cr-card dl-streak' }, [
      h('h2', { class: 'card-title', text: t('daily.streak') }),
      h('div', { class: 'dl-streak-row' }, [
        h('span', { class: 'dl-flame' + (sk.cur > 0 ? ' on' : ''), 'aria-hidden': 'true' }, ['🔥']),
        h('span', { class: 'dl-streak-n mono', text: streakText(sk.cur) }),
        h('span', { class: 'dl-streak-max mono', text: t('daily.streak.longest', { n: sk.max }) }),
      ]),
      h('p', { class: 'hint', text: t('daily.streak.hint') }),
    ]);

    const rows = D.history(7);
    const recent = h('section', { class: 'card cr-card' }, [
      h('h2', { class: 'card-title', text: t('daily.recent') }),
      rows.length ? localList(rows) : h('p', { class: 'hint', text: t('daily.recentEmpty') }),
    ]);

    dom.body.appendChild(h('div', { class: 'dl-today' }, [challenge, h('div', { class: 'dl-side' }, [bestCard, streakCard, recent])]));

    dom.foot.hidden = false;
    setText(dom.start.querySelector('.start-label'), best ? t('daily.playAgain') : t('daily.play'));
    setText(dom.start.querySelector('.start-sub'), t('daily.playSub', { n: c.seed, twist: twistName(c.twist) }));
  }

  /** "Mon 26 Oct  A  74.2" rows for the player's own days. */
  function localList(rows) {
    const ul = h('ul', { class: 'cr-hist' });
    rows.forEach(function (r) {
      ul.appendChild(h('li', { class: 'cr-hrow' }, [
        gradeEl(r.grade),
        h('span', { class: 'cr-hrow-t', text: dateLabel(r.date, true) }),
        h('span', { class: 'cr-hrow-s mono', text: num(r.score, 1) + ' · ' + GM.i18n.compact(r.viewers) }),
      ]));
    });
    return ul;
  }

  function updateCountdown() {
    if (dom.countdown && dom.countdown.isConnected) setText(dom.countdown, '⏳ ' + t('daily.resets', { t: clock(D.msToReset()) }));
  }

  /** Arena thumbnail from the minimap terrain image. */
  function drawThumb() {
    const cv = dom.thumb;
    const M = GM.Minimap;
    if (!cv || !cv.isConnected || !M || typeof M.terrainImage !== 'function') return;
    const seed = D.today().seed;
    if ((GM.state.seed >>> 0) !== seed) return;
    const ver = M.version || 0;
    if (ui.thumbVer === ver && ui.thumbSeed === seed) return;
    const img = M.terrainImage();
    if (!img) return;
    ui.thumbVer = ver;
    ui.thumbSeed = seed;
    const size = cv.width;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.drawImage(img, 0, 0, size, size);
    const k = size / ((M.viewHalf || GM.CFG.MAP_SIZE / 2) * 2);
    g.strokeStyle = 'rgba(120,220,255,0.85)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(size / 2, size / 2, GM.CFG.ARENA_RADIUS * k, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#f2c14e';
    g.beginPath();
    g.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // ------------------------------------------------------------ leaderboard
  function errText(r) {
    if (!r) return t('daily.err.bad');
    if (r.error === 'http' && r.message && GM.i18n.has('daily.err.' + r.message)) return t('daily.err.' + r.message);
    return t('daily.err.' + (GM.i18n.has('daily.err.' + r.error) ? r.error : 'bad'));
  }

  function loadBoard(force) {
    ui.board = ui.board === 'alltime' ? 'alltime' : 'today';
    if (!LB.enabled()) { ui.load = { status: 'off', kind: ui.board, data: null, error: '' }; return; }
    const kind = ui.board;
    const token = ++ui.loadToken;
    ui.load = { status: 'loading', kind: kind, data: null, error: '' };
    if (force) { /* the client cache is short-lived; a manual refresh just asks again after it expires */ }
    const p = kind === 'alltime' ? LB.allTime(50) : LB.daily(D.dateKey(), 50);
    p.then(function (r) {
      if (token !== ui.loadToken) return;               // a newer request replaced this one
      ui.load = r.ok ? { status: 'ok', kind: kind, data: r, error: '' } : { status: 'error', kind: kind, data: null, error: errText(r) };
      if (ui.open && ui.tab === 'board') renderAll();
    });
  }

  function nameRow() {
    const inp = h('input', { type: 'text', class: 'inp dl-name-in', maxlength: String(D.NAME_MAX), value: D.name(), placeholder: t('daily.board.namePh'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('daily.board.name') });
    const msg = h('span', { class: 'cr-msg' + (ui.nameMsg ? (ui.nameMsg.ok ? ' ok' : ' bad') : ''), 'aria-live': 'polite', text: ui.nameMsg ? ui.nameMsg.text : '' });
    const save = function () {
      const n = D.setName(inp.value);
      inp.value = n;
      ui.nameMsg = n ? { ok: true, text: t('daily.board.saved') } : { ok: false, text: t('daily.board.nameNeeded') };
      msg.className = 'cr-msg ' + (n ? 'ok' : 'bad');
      msg.textContent = ui.nameMsg.text;
    };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    return h('div', { class: 'dl-name' }, [
      h('label', { class: 'vs-l' }, [t('daily.board.name')]),
      h('div', { class: 'dl-name-row' }, [inp, h('button', { type: 'button', class: 'btn', text: t('daily.board.save'), onclick: save }), msg]),
    ]);
  }

  function boardTable(entries, withDate) {
    if (!entries.length) return h('p', { class: 'hint dl-empty', text: t('daily.board.empty') });
    const ol = h('ol', { class: 'dl-rows' });
    ol.appendChild(h('li', { class: 'dl-row dl-head mono' }, [
      h('span', { class: 'dl-c-rank', text: t('daily.board.rank') }),
      h('span', { class: 'dl-c-name', text: t('daily.board.player') }),
      h('span', { class: 'dl-c-grade' }),
      h('span', { class: 'dl-c-score', text: t('daily.board.score') }),
      h('span', { class: 'dl-c-view', text: t('daily.board.viewers') }),
    ]));
    entries.forEach(function (e) {
      ol.appendChild(h('li', { class: 'dl-row' + (e.mine ? ' mine' : '') + (e.rank <= 3 ? ' top top-' + e.rank : '') }, [
        h('span', { class: 'dl-c-rank mono', text: String(e.rank) }),
        h('span', { class: 'dl-c-name' }, [
          h('span', { class: 'dl-nm', text: e.name || '—' }),
          e.mine ? h('span', { class: 'dl-you mono', text: t('daily.board.you') }) : null,
          withDate && e.date ? h('span', { class: 'dl-sub mono', text: dateLabel(e.date, true) }) : null,
        ]),
        h('span', { class: 'dl-c-grade' }, [e.grade ? gradeEl(e.grade) : null]),
        h('span', { class: 'dl-c-score mono', text: num(e.score, 1) }),
        h('span', { class: 'dl-c-view mono', text: e.viewers ? GM.i18n.compact(e.viewers) : '—' }),
      ]));
    });
    return ol;
  }

  function renderBoard() {
    const L = ui.load;
    const pane = h('div', { class: 'cr-pane' });
    pane.appendChild(nameRow());

    if (L.status === 'off' || !LB.enabled()) {
      const rows = D.history(14);
      pane.appendChild(h('section', { class: 'card cr-card' }, [
        h('h2', { class: 'card-title', text: t('daily.board.off.title') }),
        h('p', { class: 'hint', text: t('daily.board.off.text') }),
      ]));
      pane.appendChild(h('section', { class: 'card cr-card' }, [
        h('h2', { class: 'card-title', text: t('daily.board.local') }),
        rows.length ? localList(rows) : h('p', { class: 'hint', text: t('daily.recentEmpty') }),
      ]));
      dom.body.appendChild(pane);
      return;
    }

    const seg = h('div', { class: 'seg', role: 'group' });
    ['today', 'alltime'].forEach(function (k) {
      seg.appendChild(h('button', {
        type: 'button', class: 'seg-btn' + (ui.board === k ? ' on' : ''), 'aria-pressed': ui.board === k ? 'true' : 'false', text: t('daily.board.' + k),
        onclick: function () { if (ui.board !== k) { ui.board = k; play('click'); loadBoard(false); renderAll(); } },
      }));
    });
    const meta = h('span', { class: 'summary mono' });
    if (L.status === 'ok') {
      if (L.kind === 'alltime') meta.textContent = t('daily.board.stats', { players: num(L.data.stats.players), runs: num(L.data.stats.runs) });
      else meta.textContent = t('daily.board.total', { n: L.data.total });
    }
    const refresh = h('button', { type: 'button', class: 'btn btn-ghost', text: t('daily.board.refresh'), onclick: function () { play('click'); loadBoard(true); renderAll(); } });
    const card = h('section', { class: 'card cr-card dl-board' }, [
      h('div', { class: 'card-title-row' }, [seg, h('span', { class: 'cr-spacer' }), meta, refresh]),
    ]);
    if (L.status === 'loading') card.appendChild(h('p', { class: 'hint dl-empty' }, [h('span', { class: 'spinner' }), ' ' + t('daily.board.loading')]));
    else if (L.status === 'error') card.appendChild(h('p', { class: 'cr-msg bad', text: L.error }));
    else if (L.status === 'ok') card.appendChild(boardTable(L.data.entries, L.kind === 'alltime'));
    pane.appendChild(card);
    dom.body.appendChild(pane);
  }

  // ---------------------------------------------------------------- records
  function recordValue(id, v) {
    switch (id) {
      case 'score': return num(v, 1);
      case 'viewers': return GM.i18n.compact(v);
      case 'longest': return t('common.day', { n: v });
      case 'quickest': return U.formatDuration(v);
      default: return num(v);
    }
  }

  function renderRecords() {
    const grid = h('div', { class: 'dl-recs' });
    REC.list().forEach(function (r) {
      const has = r.value != null;
      grid.appendChild(h('article', { class: 'dl-rec' + (has ? ' got' : '') }, [
        h('span', { class: 'dl-rec-ico', 'aria-hidden': 'true' }, [r.icon]),
        h('span', { class: 'dl-rec-body' }, [
          h('span', { class: 'dl-rec-name', text: t('daily.rec.' + r.id) }),
          h('span', { class: 'dl-rec-sub mono', text: has ? t('daily.mode.' + r.mode) + ' · ' + dateLabel(new Date(r.ts).toISOString().slice(0, 10), true) : t('daily.rec.none') }),
        ]),
        h('span', { class: 'dl-rec-val mono', text: has ? recordValue(r.id, r.value) : '—' }),
      ]));
    });

    const sk = D.streak();
    const stat = function (lbl, val) {
      return h('div', { class: 'vs' }, [h('span', { class: 'vs-l', text: lbl }), h('span', { class: 'vs-v mono', text: val })]);
    };
    const grades = h('div', { class: 'cr-grades' });
    ['S', 'A', 'B', 'C', 'D'].forEach(function (g) {
      grades.appendChild(h('span', { class: 'cr-gcount' }, [gradeEl(g), h('span', { class: 'mono', text: '×' + (REC.data.grades[g] || 0) })]));
    });
    const winners = Object.keys(REC.data.wins).sort(function (a, b) { return REC.data.wins[b] - REC.data.wins[a]; });
    const wins = h('div', { class: 'cr-chips' }, winners.length
      ? winners.map(function (id) { return h('span', { class: 'cr-chip', text: t('arch.' + id) + ' ×' + REC.data.wins[id] }); })
      : [h('span', { class: 'hint', text: t('daily.totals.winsNone') })]);
    const totals = h('section', { class: 'card cr-card' }, [
      h('h2', { class: 'card-title', text: t('daily.totals') }),
      h('div', { class: 'v-stats' }, [
        stat(t('daily.totals.shows'), num(REC.data.shows)),
        stat(t('daily.totals.daily'), num(D.data.played)),
        stat(t('daily.streak'), streakText(sk.cur)),
        stat(t('daily.totals.streak'), streakText(sk.max)),
      ]),
      h('div', { class: 'vs-l cr-gap', text: t('daily.totals.grades') }),
      grades,
      h('div', { class: 'vs-l cr-gap', text: t('daily.totals.wins') }),
      wins,
    ]);

    dom.body.appendChild(h('div', { class: 'cr-pane' }, [
      h('div', { class: 'card-title-row' }, [h('h2', { class: 'card-title', text: t('daily.rec.title') })]),
      h('p', { class: 'hint', text: t('daily.rec.hint') }),
      grid,
      totals,
    ]));
  }

  // ============================================================== result card
  function submitBest(res) {
    const best = D.best(res.date);
    if (!best) return;
    ui.sub = { ts: res.ts, state: 'sending' };
    rerenderVictory();
    LB.submit(res.date, D.payload({ score: best.score, grade: best.grade, viewers: best.viewers, day: best.day, cast: best.cast, winner: best.winner, twist: res.twist })).then(function (r) {
      if (r.ok) {
        D.markSent(res.date);
        ui.sub = { ts: res.ts, state: 'ok', rank: r.rank, total: r.total };
      } else {
        ui.sub = { ts: res.ts, state: 'err', text: errText(r) };
      }
      rerenderVictory();
    });
  }

  /** Repaint just our block (the rest of the victory card is the UI module's). */
  function rerenderVictory() {
    const card = document.querySelector('.victory-card');
    const res = D.result();
    if (!card || !res) return;
    const old = card.querySelector('.dl-res');
    const fresh = resultBlock(res);
    if (old) old.replaceWith(fresh);
  }

  function resultBlock(res) {
    const best = D.best(res.date);
    const notes = [];
    if (res.improved && res.previous != null) notes.push(h('div', { class: 'cr-note up', text: '🎉 ' + t('daily.res.newBest') }));
    else if (!res.improved && best) notes.push(h('div', { class: 'cr-note', text: t('daily.res.bestToday', { n: num(best.score, 1) }) }));
    res.broken.forEach(function (id) { notes.push(h('div', { class: 'cr-note trophy', text: '🏅 ' + t('daily.res.record', { name: t('daily.rec.' + id) }) })); });
    if (res.streak > 1) notes.push(h('div', { class: 'cr-note season', text: '🔥 ' + t('daily.res.streak', { n: res.streak }) }));

    const sub = ui.sub && ui.sub.ts === res.ts ? ui.sub : null;
    let submit;
    if (!LB.enabled()) {
      submit = h('p', { class: 'hint', text: t('daily.res.off') });
    } else {
      const inp = h('input', { type: 'text', class: 'inp dl-name-in', maxlength: String(D.NAME_MAX), value: D.name(), placeholder: t('daily.board.namePh'), autocomplete: 'off', spellcheck: 'false', 'aria-label': t('daily.board.name') });
      const sending = sub && sub.state === 'sending';
      const btn = h('button', {
        type: 'button', class: 'btn' + (sub && sub.state === 'ok' ? '' : ' ready'), disabled: sending ? true : null,
        text: sending ? t('daily.res.sending') : sub && sub.state === 'ok' ? t('daily.res.again') : t('daily.res.submit'),
        onclick: function () {
          const n = D.setName(inp.value);
          if (!n) { inp.focus(); ui.sub = { ts: res.ts, state: 'err', text: t('daily.board.nameNeeded') }; rerenderVictory(); return; }
          play('click');
          submitBest(res);
        },
      });
      const status = sub && sub.state === 'ok' ? h('span', { class: 'cr-msg ok', text: t('daily.res.sent', { rank: sub.rank, total: sub.total }) })
        : sub && sub.state === 'err' ? h('span', { class: 'cr-msg bad', text: sub.text })
          : h('span', { class: 'dl-priv', text: t('daily.res.privacy') });
      submit = h('div', { class: 'dl-submit' }, [h('div', { class: 'dl-name-row' }, [inp, btn]), status]);
    }

    return h('div', { class: 'cr-res dl-res' }, [
      h('div', { class: 'cr-res-head' }, [
        h('span', { class: 'cr-res-kick mono', text: t('daily.res.kicker', { date: dateLabel(res.date) }) }),
        h('span', { class: 'cr-chip', text: twistName(res.twist) }),
      ]),
      h('div', { class: 'dl-res-main' }, [
        gradeEl(res.grade),
        h('span', { class: 'dl-res-score mono', text: num(res.score, 1) }),
        h('span', { class: 'vs-l', text: t('daily.res.score') }),
      ]),
      notes.length ? h('div', { class: 'dl-res-notes' }, notes) : null,
      submit,
    ]);
  }

  function injectResult(e) {
    const root = e && e.root;
    if (!root || !D.active()) return;
    const res = D.result();
    const s = GM.state.settings;
    if (!res || !s || !s.daily || res.date !== s.daily.date) return;
    const card = root.querySelector('.victory-card');
    if (!card || card.querySelector('.dl-res')) return;
    const actions = card.querySelector('.v-actions');
    const block = resultBlock(res);
    if (actions) card.insertBefore(block, actions); else card.appendChild(block);
    const lbl = card.querySelector('.v-new .start-label');
    if (lbl) lbl.textContent = t('daily.res.back');
  }

  // ============================================================ entry buttons
  function buildEntries() {
    dom.entries = [];
    const mk = function (cls) {
      const b = h('button', { type: 'button', class: cls, onclick: function () { play('click'); openHub('today'); } });
      dom.entries.push(b);
      return b;
    };
    const head = document.querySelector('#career-hub .cr-head-top');
    const free = head && head.querySelector('.cr-free');
    if (head) head.insertBefore(mk('btn btn-ghost dl-open'), free || null);
    const kicker = document.querySelector('#setup .setup-kicker');
    if (kicker) kicker.appendChild(mk('btn btn-ghost cr-sw dl-sw'));
  }
  function renderEntries() {
    (dom.entries || []).forEach(function (b) { setText(b, '📅 ' + t('daily.open')); });
  }

  // ================================================================== system
  function onKey(e) {
    if (ui.open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHub(); }
  }

  GM.registerSystem({
    name: 'DailyUI',
    order: 113,
    init() {
      const root = document.getElementById('ui-root');
      if (!root) return;
      buildHub(root);
      buildEntries();
      renderEntries();
      ui.built = true;
      document.addEventListener('keydown', onKey, true);
      GM.on('lang:changed', function () { renderEntries(); if (ui.open) renderAll(); });
      GM.on('save:imported', function () { if (ui.open) renderAll(); });
      GM.on('save:reset', function () { if (ui.open) renderAll(); });
      GM.on('ui:victory', injectResult);
      GM.on('daily:result', function () {
        ui.returnToDaily = true;
        // the victory card may already be on screen (it was built before the result existed)
        const card = document.querySelector('.victory-card');
        if (card) injectResult({ root: card.parentNode });
      });
      // the Show is over and we are back on the setup screen: go straight back to the daily screen
      GM.on('game:setup', function () {
        ui.open = false;
        dom.hub.hidden = true;
        if (ui.returnToDaily) { ui.returnToDaily = false; openHub('today'); }
      });
      GM.on('game:new', function () { ui.sub = null; if (ui.open) { ui.open = false; dom.hub.hidden = true; } });
    },
    frame() {
      if (!ui.built || !ui.open) return;
      if (GM.state.phase !== 'setup') { ui.open = false; dom.hub.hidden = true; return; }
      const now = GM.state.realTime || 0;
      if (now - ui.tickAt >= 0.5) {
        ui.tickAt = now;
        if (ui.tab === 'today') {
          if (ui.shownDate && D.dateKey() !== ui.shownDate) { renderAll(); schedulePreview(D.today().seed); }   // midnight passed while open
          updateCountdown();
        }
      }
      if (ui.tab === 'today') drawThumb();
    },
  });
})();
