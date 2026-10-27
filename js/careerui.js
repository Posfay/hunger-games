/* ==========================================================================
 * careerui.js — the interface of career mode.
 *
 *   hub        full-screen studio on the setup screen: season, upgrades,
 *              unlocked powers, trophies, profile + backup
 *   brief HUD  the episode objectives, live, over the main view
 *   report     rewards block inside the victory card
 *   switch     "Career mode" button on the free-play setup screen
 *
 * The hub replaces the free-play setup sheet while GM.Career.mode() is
 * 'career'. Strings live here (EN + HU). Logic lives in career.js.
 * Owner: UI.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const C = GM.Career;

  // ================================================================ strings
  GM.i18n.add({
    en: {
      'career.mode.career': 'Career mode',
      'career.mode.free': 'Free play',
      'career.level': 'Level {n}',
      'career.rep': 'Reputation',
      'career.credits': 'Credits',
      'career.tab.season': 'Season',
      'career.tab.studio': 'Studio',
      'career.tab.powers': 'Powers',
      'career.tab.trophies': 'Trophies',
      'career.tab.profile': 'Profile',

      'career.welcome.kicker': 'Network control',
      'career.welcome.title': 'Run your own network',
      'career.welcome.text': 'Each season has six episodes. The Studio gives you a brief for every episode: reach the ratings target and hit the bonus goals. Earn credits and reputation to unlock new powers, bigger casts and upgrades for your control room.',
      'career.welcome.start': 'Start career',
      'career.welcome.free': 'Free play instead',
      'career.welcome.tip': 'Free play stays open and unchanged. Your career progress is saved in this browser.',

      'career.season.title': 'Season {n}',
      'career.season.stars': '{n} / {max} stars',
      'career.ep': 'Episode {n}',
      'career.ep.next': 'Up next',
      'career.ep.locked': 'Not yet',
      'career.title.fmt': 'The {adj} {noun}',
      'career.brief.kicker': 'Studio brief',
      'career.brief.cast': '{n} contestants',
      'career.brief.arena': 'Arena #{n}',
      'career.brief.primary': 'Ratings target',
      'career.brief.bonus': 'Bonus goal',
      'career.brief.rewards': 'Rewards',
      'career.brief.start': 'Start episode',
      'career.brief.startSub': 'Episode {n} · {title}',
      'career.reward': '+{c} credits · +{r} rep',
      'career.reward.short': '+{c} cr · +{r} rep',
      'career.seasonDone.title': 'Season complete',
      'career.seasonDone.text': 'The network renews you! You earned {n} stars this season.',
      'career.seasonDone.next': 'Begin season {n}',
      'career.noBrief': 'No episode is waiting.',

      'career.obj.grade': 'Earn a rating of {g} or better',
      'career.obj.viewers': 'Reach {n} million viewers',
      'career.obj.betrayals': 'Witness {n} betrayals',
      'career.obj.betrayals_one': 'Witness a betrayal',
      'career.obj.crown': 'The winner is a {a}',
      'career.obj.long': 'Reach day {n}',
      'career.obj.quick': 'Finish by day {n}',
      'career.obj.variety': 'Use {n} different powers',
      'career.obj.category': 'Use {n} different powers of type: {c}',
      'career.obj.beasts': 'Beasts or wasps kill {n} contestants',
      'career.obj.beasts_one': 'Beasts or wasps kill a contestant',
      'career.obj.minimal': 'Use at most {n} powers',
      'career.obj.favorite': 'The winner is a fan favorite ({n}%+)',
      'career.obj.topkill': 'One contestant gets {n} kills',

      'career.hud.title': 'Episode {n}',
      'career.hud.collapse': 'Show or hide the brief',
      'career.hud.done': 'Done',
      'career.hud.failed': 'Missed',

      'career.res.title': 'Episode report',
      'career.res.goals': 'Goals',
      'career.res.credits': 'Credits',
      'career.res.rep': 'Reputation',
      'career.res.total': 'Balance: {n} credits',
      'career.res.levelup': 'Level up! You are now level {n}.',
      'career.res.unlocked': 'Unlocked: {list}',
      'career.res.cast': 'Bigger cast: up to {n} contestants',
      'career.res.trophy': 'Trophy: {name}',
      'career.res.season': 'Season complete: {n} stars and a {b} credit bonus!',
      'career.res.continue': 'Back to the studio',
      'career.res.scale': 'Season bonus ×{n}',

      'career.studio.title': 'Studio upgrades',
      'career.studio.hint': 'Upgrades only work in career episodes. Credits come from ratings, goals and trophies.',
      'career.up.power': 'Power grid',
      'career.up.power.desc': 'Maximum energy +10 per level.',
      'career.up.regen': 'Fan engagement',
      'career.up.regen.desc': 'Energy recharges 10% faster per level.',
      'career.up.rigging': 'Fast rigging',
      'career.up.rigging.desc': 'Power cooldowns are 5% shorter per level.',
      'career.up.hype': 'Hype machine',
      'career.up.hype.desc': 'Exciting moments raise the ratings 6% more per level.',
      'career.up.sponsors': 'Sponsor network',
      'career.up.sponsors.desc': 'Start every episode with +10 energy per level.',
      'career.up.writers': 'Writers room',
      'career.up.writers.desc': 'Unlocks the assistant Showrunner, who acts when the audience is bored.',
      'career.up.level': 'Level {a} / {b}',
      'career.up.max': 'Maxed out',
      'career.up.buy': 'Buy · {n}',
      'career.up.needLevel': 'Needs career level {n}',
      'career.up.needCredits': 'Not enough credits',
      'career.up.bought': 'Upgrade bought',

      'career.powers.title': 'Levels and unlocks',
      'career.powers.hint': 'Reputation raises your level. Free play has every power from the start.',
      'career.powers.cast': 'Casts up to {n}',
      'career.powers.now': 'You are here',

      'career.tr.title': 'Trophies',
      'career.tr.earned': 'Earned',
      'career.tr.reward': '+{n} credits',
      'career.tr.debut': 'Pilot',
      'career.tr.debut.desc': 'Finish your first episode.',
      'career.tr.rating_a': 'Rising star',
      'career.tr.rating_a.desc': 'Earn an A rating or better.',
      'career.tr.rating_s': 'Legend',
      'career.tr.rating_s.desc': 'Earn an S rating.',
      'career.tr.three_stars': 'Perfect brief',
      'career.tr.three_stars.desc': 'Complete all three goals of one episode.',
      'career.tr.season_done': 'Season finale',
      'career.tr.season_done.desc': 'Complete a whole season.',
      'career.tr.viewers_30': 'Blockbuster',
      'career.tr.viewers_30.desc': 'Reach 30 million viewers.',
      'career.tr.betrayal_5': 'Plot twist',
      'career.tr.betrayal_5.desc': 'Witness 5 betrayals in one Show.',
      'career.tr.kills_100': 'Body count',
      'career.tr.kills_100.desc': 'See 100 contestants fall in your episodes.',
      'career.tr.underdog': 'Underdog story',
      'career.tr.underdog.desc': 'Make the winner type from the brief win.',
      'career.tr.upgrade_max': 'Fully loaded',
      'career.tr.upgrade_max.desc': 'Max out one studio upgrade.',
      'career.tr.level_5': 'Veteran',
      'career.tr.level_5.desc': 'Reach career level 5.',
      'career.tr.level_10': 'Network mogul',
      'career.tr.level_10.desc': 'Reach career level 10.',

      'career.prof.title': 'Profile',
      'career.prof.stats': 'Lifetime stats',
      'career.prof.shows': 'Career episodes',
      'career.prof.free': 'Free play Shows',
      'career.prof.viewers': 'Best viewers',
      'career.prof.score': 'Best show score',
      'career.prof.kills': 'Contestants fallen',
      'career.prof.powers': 'Powers used',
      'career.prof.stars': 'Stars earned',
      'career.prof.grades': 'Ratings',
      'career.prof.history': 'Recent episodes',
      'career.prof.historyEmpty': 'No episodes yet.',
      'career.prof.row': 'S{s} · E{e}',
      'career.prof.backup': 'Backup',
      'career.prof.backup.text': 'Your progress is saved in this browser. Copy the backup code to keep it safe or to move it to another device.',
      'career.prof.noStorage': 'This browser does not allow saving. Your progress is lost when you close the page. Copy the backup code now and then.',
      'career.prof.export': 'Show backup code',
      'career.prof.copy': 'Copy',
      'career.prof.copied': 'Copied!',
      'career.prof.codePh': 'Paste a backup code here',
      'career.prof.import': 'Restore from code',
      'career.prof.imported': 'Progress restored.',
      'career.prof.err.empty': 'Paste a backup code first.',
      'career.prof.err.format': 'That is not a valid backup code.',
      'career.prof.err.checksum': 'The code is damaged. Copy it again.',
      'career.prof.err.version': 'This code comes from a newer version of the game.',
      'career.prof.reset': 'Reset career',
      'career.prof.resetSure': 'Click again to erase all progress',
      'career.prof.resetDone': 'Career erased.',

      'ui.pow.reason.locked': 'Locked. Reach career level {n} to unlock.',
      'ui.toast.assistantLocked': 'The assistant needs the Writers room upgrade.',
      'ui.top.exitCareer': 'Click again to leave. This episode will not count!',

      'career.adj.0': 'Golden', 'career.adj.1': 'Crimson', 'career.adj.2': 'Silent', 'career.adj.3': 'Burning',
      'career.adj.4': 'Frozen', 'career.adj.5': 'Hollow', 'career.adj.6': 'Wild', 'career.adj.7': 'Last',
      'career.adj.8': 'Broken', 'career.adj.9': 'Electric', 'career.adj.10': 'Midnight', 'career.adj.11': 'Savage',
      'career.noun.0': 'Harvest', 'career.noun.1': 'Gauntlet', 'career.noun.2': 'Eclipse', 'career.noun.3': 'Reckoning',
      'career.noun.4': 'Tide', 'career.noun.5': 'Spire', 'career.noun.6': 'Thunder', 'career.noun.7': 'Cascade',
      'career.noun.8': 'Verdict', 'career.noun.9': 'Carnival', 'career.noun.10': 'Siege', 'career.noun.11': 'Dawn',
    },
    hu: {
      'career.mode.career': 'Karrier mód',
      'career.mode.free': 'Szabad játék',
      'career.level': '{n}. szint',
      'career.rep': 'Hírnév',
      'career.credits': 'Kreditek',
      'career.tab.season': 'Évad',
      'career.tab.studio': 'Stúdió',
      'career.tab.powers': 'Képességek',
      'career.tab.trophies': 'Trófeák',
      'career.tab.profile': 'Profil',

      'career.welcome.kicker': 'Csatornairányítás',
      'career.welcome.title': 'Vezesd a saját csatornádat',
      'career.welcome.text': 'Minden évad hat epizódból áll. A Stúdió minden epizódhoz megbízást ad: érd el a nézettségi célt, és teljesítsd a bónusz célokat. Kreditet és hírnevet szerzel, amiből új képességeket, nagyobb szereplőgárdát és fejlesztéseket kapsz az irányítótermedbe.',
      'career.welcome.start': 'Karrier indítása',
      'career.welcome.free': 'Inkább szabad játék',
      'career.welcome.tip': 'A szabad játék marad, ahogy volt. A karrier haladásod ebben a böngészőben mentődik.',

      'career.season.title': '{n}. évad',
      'career.season.stars': '{n} / {max} csillag',
      'career.ep': '{n}. epizód',
      'career.ep.next': 'Következő',
      'career.ep.locked': 'Még nem',
      'career.title.fmt': '{adj} {noun}',
      'career.brief.kicker': 'Stúdió megbízás',
      'career.brief.cast': '{n} versenyző',
      'career.brief.arena': 'Aréna #{n}',
      'career.brief.primary': 'Nézettségi cél',
      'career.brief.bonus': 'Bónusz cél',
      'career.brief.rewards': 'Jutalmak',
      'career.brief.start': 'Epizód indítása',
      'career.brief.startSub': '{n}. epizód · {title}',
      'career.reward': '+{c} kredit · +{r} hírnév',
      'career.reward.short': '+{c} kr · +{r} hírnév',
      'career.seasonDone.title': 'Az évad lezárult',
      'career.seasonDone.text': 'A csatorna megújít! Ebben az évadban {n} csillagot szereztél.',
      'career.seasonDone.next': 'Új évad kezdése: {n}.',
      'career.noBrief': 'Nincs várakozó epizód.',

      'career.obj.grade': 'Érj el {g} vagy jobb értékelést',
      'career.obj.viewers': 'Érj el {n} millió nézőt',
      'career.obj.betrayals': 'Láss {n} árulást',
      'career.obj.betrayals_one': 'Láss {n} árulást',
      'career.obj.crown': 'A győztes típusa: {a}',
      'career.obj.long': 'Elérendő nap: {n}.',
      'career.obj.quick': 'Befejezés legkésőbb: {n}. nap',
      'career.obj.variety': 'Használj {n} különböző képességet',
      'career.obj.category': 'Használj {n} különböző képességet ebből a típusból: {c}',
      'career.obj.beasts': 'Fenevadak vagy darazsak {n} versenyzőt ölnek meg',
      'career.obj.beasts_one': 'Fenevadak vagy darazsak {n} versenyzőt ölnek meg',
      'career.obj.minimal': 'Legfeljebb {n} képességet használj',
      'career.obj.favorite': 'A győztes közönségkedvenc ({n}%+)',
      'career.obj.topkill': 'Egy versenyző {n} ölést szerez',

      'career.hud.title': '{n}. epizód',
      'career.hud.collapse': 'A megbízás megjelenítése vagy elrejtése',
      'career.hud.done': 'Kész',
      'career.hud.failed': 'Nem sikerült',

      'career.res.title': 'Epizód jelentés',
      'career.res.goals': 'Célok',
      'career.res.credits': 'Kreditek',
      'career.res.rep': 'Hírnév',
      'career.res.total': 'Egyenleg: {n} kredit',
      'career.res.levelup': 'Szintet léptél! Új szint: {n}.',
      'career.res.unlocked': 'Feloldva: {list}',
      'career.res.cast': 'Nagyobb szereplőgárda: legfeljebb {n} versenyző',
      'career.res.trophy': 'Trófea: {name}',
      'career.res.season': 'Az évad lezárult: {n} csillag és {b} kredit bónusz!',
      'career.res.continue': 'Vissza a stúdióba',
      'career.res.scale': 'Évadszorzó: ×{n}',

      'career.studio.title': 'Stúdió fejlesztések',
      'career.studio.hint': 'A fejlesztések csak a karrier epizódokban hatnak. Kreditet a nézettség, a célok és a trófeák adnak.',
      'career.up.power': 'Energiahálózat',
      'career.up.power.desc': 'Maximális energia: +10 szintenként.',
      'career.up.regen': 'Rajongói bevonás',
      'career.up.regen.desc': 'Az energia szintenként 10%-kal gyorsabban töltődik.',
      'career.up.rigging': 'Gyors szerelés',
      'career.up.rigging.desc': 'A képességek várakozási ideje szintenként 5%-kal rövidebb.',
      'career.up.hype': 'Hype-gép',
      'career.up.hype.desc': 'Az izgalmas pillanatok szintenként 6%-kal jobban emelik a nézettséget.',
      'career.up.sponsors': 'Szponzorhálózat',
      'career.up.sponsors.desc': 'Minden epizódot szintenként +10 energiával kezdesz.',
      'career.up.writers': 'Forgatókönyvírók',
      'career.up.writers.desc': 'Feloldja a segéd Showrunnert, aki közbelép, ha unatkozik a közönség.',
      'career.up.level': 'Szint: {a} / {b}',
      'career.up.max': 'Teljesen kifejlesztve',
      'career.up.buy': 'Vásárlás · {n}',
      'career.up.needLevel': '{n}. karrierszint kell hozzá',
      'career.up.needCredits': 'Nincs elég kredit',
      'career.up.bought': 'Fejlesztés megvéve',

      'career.powers.title': 'Szintek és feloldások',
      'career.powers.hint': 'A hírnév növeli a szintedet. A szabad játékban az összes képesség az elejétől elérhető.',
      'career.powers.cast': 'Legfeljebb {n} versenyző',
      'career.powers.now': 'Itt tartasz',

      'career.tr.title': 'Trófeák',
      'career.tr.earned': 'Megszerezve',
      'career.tr.reward': '+{n} kredit',
      'career.tr.debut': 'Pilot',
      'career.tr.debut.desc': 'Fejezd be az első epizódodat.',
      'career.tr.rating_a': 'Feltörekvő sztár',
      'career.tr.rating_a.desc': 'Szerezz A vagy jobb értékelést.',
      'career.tr.rating_s': 'Legenda',
      'career.tr.rating_s.desc': 'Szerezz S értékelést.',
      'career.tr.three_stars': 'Hibátlan megbízás',
      'career.tr.three_stars.desc': 'Teljesítsd egy epizód mindhárom célját.',
      'career.tr.season_done': 'Évadzáró',
      'career.tr.season_done.desc': 'Fejezz be egy teljes évadot.',
      'career.tr.viewers_30': 'Kasszasiker',
      'career.tr.viewers_30.desc': 'Érj el 30 millió nézőt.',
      'career.tr.betrayal_5': 'Fordulat',
      'career.tr.betrayal_5.desc': 'Láss 5 árulást egyetlen Műsorban.',
      'career.tr.kills_100': 'Áldozatok',
      'career.tr.kills_100.desc': 'Nézd végig 100 versenyző bukását az epizódjaidban.',
      'career.tr.underdog': 'Esélytelenek története',
      'career.tr.underdog.desc': 'Nyerjen a megbízásban kijelölt típusú versenyző.',
      'career.tr.upgrade_max': 'Teljes felszerelés',
      'career.tr.upgrade_max.desc': 'Fejlessz ki egy stúdió fejlesztést a maximumig.',
      'career.tr.level_5': 'Veterán',
      'career.tr.level_5.desc': 'Érj el 5. karrierszintet.',
      'career.tr.level_10': 'Médiamágnás',
      'career.tr.level_10.desc': 'Érj el 10. karrierszintet.',

      'career.prof.title': 'Profil',
      'career.prof.stats': 'Összesített adatok',
      'career.prof.shows': 'Karrier epizódok',
      'career.prof.free': 'Szabad játék Műsorok',
      'career.prof.viewers': 'Legtöbb néző',
      'career.prof.score': 'Legjobb Műsor pontszám',
      'career.prof.kills': 'Elesett versenyzők',
      'career.prof.powers': 'Használt képességek',
      'career.prof.stars': 'Szerzett csillagok',
      'career.prof.grades': 'Értékelések',
      'career.prof.history': 'Legutóbbi epizódok',
      'career.prof.historyEmpty': 'Még nincs epizód.',
      'career.prof.row': '{s}. évad · {e}. epizód',
      'career.prof.backup': 'Mentés',
      'career.prof.backup.text': 'A haladásod ebben a böngészőben van elmentve. Másold ki a mentőkódot, hogy biztonságban legyen, vagy átvidd másik eszközre.',
      'career.prof.noStorage': 'Ez a böngésző nem engedi a mentést. Az oldal bezárásakor a haladásod elvész. Időnként másold ki a mentőkódot.',
      'career.prof.export': 'Mentőkód megjelenítése',
      'career.prof.copy': 'Másolás',
      'career.prof.copied': 'Kimásolva!',
      'career.prof.codePh': 'Illeszd be ide a mentőkódot',
      'career.prof.import': 'Visszaállítás kódból',
      'career.prof.imported': 'A haladás visszaállítva.',
      'career.prof.err.empty': 'Előbb illessz be egy mentőkódot.',
      'career.prof.err.format': 'Ez nem érvényes mentőkód.',
      'career.prof.err.checksum': 'A kód sérült. Másold ki újra.',
      'career.prof.err.version': 'Ez a kód a játék újabb verziójából való.',
      'career.prof.reset': 'Karrier törlése',
      'career.prof.resetSure': 'Kattints újra: minden haladás törlődik',
      'career.prof.resetDone': 'A karrier törölve.',

      'ui.pow.reason.locked': 'Zárolva. Ehhez {n}. karrierszint kell.',
      'ui.toast.assistantLocked': 'A segédhez a Forgatókönyvírók fejlesztés kell.',
      'ui.top.exitCareer': 'Kattints újra a kilépéshez. Ez az epizód nem számít!',

      'career.adj.0': 'Arany', 'career.adj.1': 'Vérvörös', 'career.adj.2': 'Néma', 'career.adj.3': 'Lángoló',
      'career.adj.4': 'Fagyott', 'career.adj.5': 'Üreges', 'career.adj.6': 'Vad', 'career.adj.7': 'Utolsó',
      'career.adj.8': 'Megtört', 'career.adj.9': 'Elektromos', 'career.adj.10': 'Éjféli', 'career.adj.11': 'Kegyetlen',
      'career.noun.0': 'Aratás', 'career.noun.1': 'Próba', 'career.noun.2': 'Napfogyatkozás', 'career.noun.3': 'Leszámolás',
      'career.noun.4': 'Dagály', 'career.noun.5': 'Torony', 'career.noun.6': 'Mennydörgés', 'career.noun.7': 'Zuhatag',
      'career.noun.8': 'Ítélet', 'career.noun.9': 'Karnevál', 'career.noun.10': 'Ostrom', 'career.noun.11': 'Hajnal',
    },
  });

  // ================================================================ helpers
  const t = function (k, p) { return GM.t(k, p); };
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }
  function play(name) { try { if (GM.Audio && GM.Audio.play) GM.Audio.play(name); } catch (e) { /* optional */ } }
  function num(v, d) { return GM.i18n.num(v, d); }

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

  function titleText(title) {
    return t('career.title.fmt', { adj: '@career.adj.' + title.a, noun: '@career.noun.' + title.n });
  }
  function objParams(type, p) {
    if (type === 'crown') return { a: '@arch.' + p.a };
    if (type === 'category') return { n: p.n, c: '@ui.pow.cat.' + p.c };
    return p;
  }
  function objText(o) { return t('career.obj.' + o.type, objParams(o.type, o.params)); }
  function rewardText(r, short) { return t(short ? 'career.reward.short' : 'career.reward', { c: r.credits, r: r.rep }); }
  /** "12 / 20" style progress for the HUD. */
  function progText(p) {
    if (p.type === 'grade') return p.now + ' / ' + p.goal;
    if (p.type === 'viewers') return num(p.now, 1) + 'M / ' + p.goal + 'M';
    if (p.type === 'crown') return '';
    if (p.type === 'long' || p.type === 'quick') return t('common.day', { n: p.now }) + ' / ' + p.goal;
    if (p.type === 'favorite') return p.now == null ? '' : p.now + '% / ' + p.goal + '%';
    return p.now + ' / ' + p.goal;
  }
  function powerInfo(id) {
    const P = GM.Powers;
    const d = P && typeof P.def === 'function' ? P.def(id) : null;
    return { icon: (d && d.icon) || '◆', name: t('power.' + id) };
  }
  function starsText(n, max) {
    let s = '';
    for (let i = 0; i < (max || 3); i++) s += i < n ? '★' : '☆';
    return s;
  }
  function gradeEl(g) { return h('span', { class: 'cr-grade g-' + g }, [g]); }

  // =================================================================== state
  const ui = {
    built: false,
    tab: 'season',
    hubShown: false,
    previewSeed: -1,
    previewTimer: 0,
    thumbVer: -1,
    thumbSeed: -1,
    hudCollapsed: false,
    hudSig: '',
    hudAcc: 0,
    resetArmedUntil: 0,
    backupOpen: false,
    importMsg: null,         // { ok, text }
    copiedUntil: 0,
    toastUntil: 0,
  };
  const dom = {};
  const now = function () { return GM.state.realTime || 0; };

  // ================================================================== hub
  const TABS = ['season', 'studio', 'powers', 'trophies', 'profile'];

  function buildHub(root) {
    dom.hub = h('section', { class: 'cr-hub', id: 'career-hub', hidden: true, 'aria-label': 'Career' });
    const sheet = h('div', { class: 'cr-sheet' });

    // ---- header
    dom.crBrand = h('div', { class: 'cr-brand' }, [h('span', { class: 'cr-brand-ico', 'aria-hidden': 'true' }, ['⬢']), h('span', { class: 'cr-brand-name' })]);
    dom.crLang = h('div', { class: 'seg seg-lang', role: 'group' });
    ['en', 'hu'].forEach(function (l) {
      dom.crLang.appendChild(h('button', { type: 'button', class: 'seg-btn', 'data-lang': l, onclick: function () { GM.i18n.setLang(l); } }));
    });
    dom.crFree = h('button', { type: 'button', class: 'btn btn-ghost cr-free', onclick: function () { play('click'); C.setMode('freeplay'); } });
    dom.crLevel = h('div', { class: 'cr-level' }, [
      h('span', { class: 'cr-lv-badge mono' }),
      h('span', { class: 'cr-lv-body' }, [h('span', { class: 'cr-lv-lbl' }), h('span', { class: 'cr-lv-bar' }, [h('i')])]),
    ]);
    dom.crCredits = h('div', { class: 'cr-credits' }, [h('span', { class: 'cr-cr-ico', 'aria-hidden': 'true' }, ['ⓒ']), h('span', { class: 'cr-cr-body' }, [h('span', { class: 'cr-cr-lbl' }), h('span', { class: 'cr-cr-val mono' })])]);
    dom.crTabs = h('nav', { class: 'cr-tabs', role: 'tablist' });
    TABS.forEach(function (id) {
      dom.crTabs.appendChild(h('button', {
        type: 'button', class: 'cr-tab', role: 'tab', 'data-tab': id,
        onclick: function () { if (ui.tab !== id) { ui.tab = id; play('click'); renderHub(); } },
      }));
    });
    sheet.appendChild(h('header', { class: 'cr-head' }, [
      h('div', { class: 'cr-head-top' }, [dom.crBrand, h('span', { class: 'cr-spacer' }), dom.crLevel, dom.crCredits, dom.crLang, dom.crFree]),
      dom.crTabs,
    ]));

    dom.crBody = h('div', { class: 'cr-body' });
    sheet.appendChild(dom.crBody);

    // ---- footer: the big start button (season tab)
    dom.crStart = h('button', { type: 'button', class: 'start-btn cr-start', onclick: startEpisode }, [
      h('span', { class: 'start-glow', 'aria-hidden': 'true' }),
      h('span', { class: 'start-label' }),
      h('span', { class: 'start-sub mono' }),
    ]);
    dom.crFoot = h('footer', { class: 'cr-foot' }, [dom.crStart]);
    sheet.appendChild(dom.crFoot);
    dom.hub.appendChild(sheet);
    root.appendChild(dom.hub);
  }

  function startEpisode() {
    if (dom.crStart.classList.contains('busy') || dom.crStart.disabled) return;
    play('click');
    C.startEpisode();
  }

  function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

  /** Header: translated labels, level, credits, tabs. */
  function renderHead() {
    setText(dom.crBrand.lastChild, t('app.title'));
    setText(dom.crFree, t('career.mode.free'));
    const lang = GM.i18n.lang;
    Array.prototype.forEach.call(dom.crLang.children, function (b) {
      const l = b.getAttribute('data-lang');
      setText(b, t('lang.' + l));
      b.classList.toggle('on', l === lang);
      b.setAttribute('aria-pressed', l === lang ? 'true' : 'false');
    });
    Array.prototype.forEach.call(dom.crTabs.children, function (b) {
      const id = b.getAttribute('data-tab');
      setText(b, t('career.tab.' + id));
      b.classList.toggle('on', id === ui.tab);
      b.setAttribute('aria-selected', id === ui.tab ? 'true' : 'false');
    });
    const started = C.data.started;
    dom.crLevel.hidden = !started;
    dom.crCredits.hidden = !started;
    dom.crTabs.hidden = !started;
    if (started) {
      const lp = C.levelProgress();
      setText(dom.crLevel.firstChild, 'L' + lp.level);
      setText(dom.crLevel.querySelector('.cr-lv-lbl'), lp.max ? t('career.level', { n: lp.level }) + ' · ' + t('career.rep') + ' ' + num(C.rep()) : t('career.level', { n: lp.level }) + ' · ' + num(lp.cur) + ' / ' + num(lp.next));
      dom.crLevel.querySelector('.cr-lv-bar i').style.width = Math.round(lp.frac * 100) + '%';
      setText(dom.crCredits.querySelector('.cr-cr-lbl'), t('career.credits'));
      setText(dom.crCredits.querySelector('.cr-cr-val'), num(C.credits()));
    }
  }

  function renderHub() {
    renderHead();
    dom.crBody.textContent = '';
    dom.crFoot.hidden = true;
    if (!C.data.started) { renderWelcome(); return; }
    if (ui.tab === 'season') renderSeason();
    else if (ui.tab === 'studio') renderStudio();
    else if (ui.tab === 'powers') renderPowers();
    else if (ui.tab === 'trophies') renderTrophies();
    else renderProfile();
    dom.crBody.scrollTop = 0;
  }

  // ---------------------------------------------------------------- welcome
  function renderWelcome() {
    dom.crBody.appendChild(h('div', { class: 'cr-welcome' }, [
      h('div', { class: 'setup-kicker' }, [h('span', { text: t('career.welcome.kicker') }), h('span', { class: 'kicker-rule' })]),
      h('h2', { class: 'cr-w-title', text: t('career.welcome.title') }),
      h('p', { class: 'cr-w-text', text: t('career.welcome.text') }),
      h('div', { class: 'cr-w-actions' }, [
        h('button', { type: 'button', class: 'start-btn', onclick: function () { play('click'); C.begin(); ui.tab = 'season'; } }, [
          h('span', { class: 'start-glow', 'aria-hidden': 'true' }), h('span', { class: 'start-label', text: t('career.welcome.start') }),
        ]),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: function () { play('click'); C.setMode('freeplay'); }, text: t('career.welcome.free') }),
      ]),
      h('p', { class: 'hint', text: t('career.welcome.tip') }),
    ]));
  }

  // ------------------------------------------------------------------ season
  function objRow(o, opts) {
    opts = opts || {};
    return h('li', { class: 'cr-obj' + (o.primary ? ' primary' : '') + (opts.cls ? ' ' + opts.cls : '') }, [
      h('span', { class: 'cr-obj-mark', 'aria-hidden': 'true' }, [o.primary ? '★' : '◆']),
      h('span', { class: 'cr-obj-body' }, [
        h('span', { class: 'cr-obj-kind mono', text: t(o.primary ? 'career.brief.primary' : 'career.brief.bonus') }),
        h('span', { class: 'cr-obj-text', text: objText(o) }),
      ]),
      h('span', { class: 'cr-obj-rew mono', text: rewardText(o.reward, true) }),
    ]);
  }

  function renderSeason() {
    const d = C.data;
    const sea = d.seasons[d.season] || { eps: {}, stars: 0 };
    const grid = h('div', { class: 'cr-season' });

    // timeline
    const list = h('ol', { class: 'cr-eps' });
    for (let ep = 1; ep <= C.EPISODES; ep++) {
      const rec = sea.eps[ep];
      const current = !d.seasonDone && ep === d.episode;
      const title = titleText(C.titleFor(d.season, ep));
      const row = h('li', { class: 'cr-ep' + (rec ? ' done' : current ? ' current' : ' locked') }, [
        h('span', { class: 'cr-ep-n mono', text: String(ep) }),
        h('span', { class: 'cr-ep-body' }, [
          h('span', { class: 'cr-ep-title', text: rec || current ? title : t('career.ep.locked') }),
          h('span', { class: 'cr-ep-sub mono', text: rec ? t('career.ep', { n: ep }) + ' · ' + num(rec.viewers / 1e6, 1) + 'M' : current ? t('career.ep.next') : t('career.ep', { n: ep }) }),
        ]),
        rec ? h('span', { class: 'cr-ep-res' }, [gradeEl(rec.grade), h('span', { class: 'cr-ep-stars', text: starsText(rec.stars) })]) : null,
      ]);
      list.appendChild(row);
    }
    grid.appendChild(h('section', { class: 'card cr-card' }, [
      h('div', { class: 'card-title-row' }, [
        h('h2', { class: 'card-title' }, [h('span', { text: t('career.season.title', { n: d.season }) })]),
        h('span', { class: 'summary mono', text: t('career.season.stars', { n: sea.stars, max: C.EPISODES * 3 }) }),
      ]),
      list,
    ]));

    // right: brief or season summary
    if (d.seasonDone) {
      grid.appendChild(h('section', { class: 'card cr-card cr-done' }, [
        h('div', { class: 'cr-done-ico', 'aria-hidden': 'true' }, ['📺']),
        h('h2', { class: 'cr-done-title', text: t('career.seasonDone.title') }),
        h('div', { class: 'cr-done-stars mono', text: starsText(Math.round(sea.stars / C.EPISODES), 3) + '  ' + t('career.season.stars', { n: sea.stars, max: C.EPISODES * 3 }) }),
        h('p', { class: 'cr-w-text', text: t('career.seasonDone.text', { n: sea.stars }) }),
        h('button', { type: 'button', class: 'start-btn', onclick: function () { play('click'); C.nextSeason(); renderHub(); } }, [
          h('span', { class: 'start-glow', 'aria-hidden': 'true' }), h('span', { class: 'start-label', text: t('career.seasonDone.next', { n: d.season + 1 }) }),
        ]),
      ]));
      dom.crFoot.hidden = true;
    } else {
      const b = C.brief();
      if (b) {
        const thumb = h('canvas', { class: 'cr-thumb', width: 160, height: 160, 'aria-hidden': 'true' });
        dom.crThumb = thumb;
        ui.thumbVer = -1;
        const objs = h('ul', { class: 'cr-objs' });
        b.objectives.forEach(function (o) { objs.appendChild(objRow(o)); });
        let tc = 0, tr = 0;
        b.objectives.forEach(function (o) { tc += o.reward.credits; tr += o.reward.rep; });
        const scale = 1 + 0.12 * (b.season - 1);
        grid.appendChild(h('section', { class: 'card cr-card cr-brief-card' }, [
          h('div', { class: 'cr-kick mono', text: t('career.brief.kicker') + ' · ' + t('career.ep', { n: b.episode }) }),
          h('h2', { class: 'cr-b-title', text: titleText(b.title) }),
          h('div', { class: 'cr-b-meta' }, [
            thumb,
            h('div', { class: 'cr-chips' }, [
              h('span', { class: 'cr-chip', text: '👥 ' + t('career.brief.cast', { n: b.count }) }),
              h('span', { class: 'cr-chip', text: '🎭 ' + t('setup.mix.' + b.mix) }),
              h('span', { class: 'cr-chip mono', text: '🗺️ ' + t('career.brief.arena', { n: b.seed }) }),
            ]),
          ]),
          objs,
          h('div', { class: 'cr-b-total mono', text: t('career.brief.rewards') + ': ' + rewardText({ credits: Math.round(tc * scale), rep: Math.round(tr * scale) }) }),
        ]));
        dom.crFoot.hidden = false;
        setText(dom.crStart.querySelector('.start-label'), t('career.brief.start'));
        setText(dom.crStart.querySelector('.start-sub'), t('career.brief.startSub', { n: b.episode, title: titleText(b.title) }));
        schedulePreview(b.seed);
      } else {
        grid.appendChild(h('section', { class: 'card cr-card' }, [h('p', { class: 'hint', text: t('career.noBrief') })]));
      }
    }
    dom.crBody.appendChild(grid);
  }

  /** Show the episode's arena behind the hub (deferred so the click paints first). */
  function schedulePreview(seed) {
    if (ui.previewSeed === seed && (GM.state.seed >>> 0) === seed) return;
    clearTimeout(ui.previewTimer);
    ui.previewTimer = setTimeout(function () {
      if (GM.state.phase !== 'setup' || C.mode() !== 'career') return;
      ui.previewSeed = seed;
      if ((GM.state.seed >>> 0) !== seed && GM.Game && GM.Game.previewArena) {
        try { GM.Game.previewArena(seed, 'verdant'); } catch (e) { GM.reportError('CareerUI.preview', e); }
      }
    }, 60);
  }

  /** Arena thumbnail from the minimap terrain image. */
  function drawThumb() {
    const cv = dom.crThumb;
    const M = GM.Minimap;
    if (!cv || !cv.isConnected || !M || typeof M.terrainImage !== 'function') return;
    const b = C.data.brief;
    if (!b || (GM.state.seed >>> 0) !== b.seed) return;
    const ver = M.version || 0;
    if (ui.thumbVer === ver && ui.thumbSeed === b.seed) return;
    const img = M.terrainImage();
    if (!img) return;
    ui.thumbVer = ver;
    ui.thumbSeed = b.seed;
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

  // ------------------------------------------------------------------ studio
  function pips(level, max) {
    const el = h('span', { class: 'cr-pips', 'aria-hidden': 'true' });
    for (let i = 0; i < max; i++) el.appendChild(h('i', { class: i < level ? 'on' : '' }));
    return el;
  }
  function renderStudio() {
    const grid = h('div', { class: 'cr-ups' });
    C.UPGRADES.forEach(function (u) {
      const lv = C.upgradeLevel(u.id);
      const can = C.canBuy(u.id);
      let btnText, disabled = !can.ok;
      if (can.reason === 'max') btnText = t('career.up.max');
      else if (can.reason === 'level') btnText = t('career.up.needLevel', { n: u.minLevel });
      else if (can.reason === 'credits') btnText = t('career.up.buy', { n: can.cost });
      else btnText = t('career.up.buy', { n: can.cost });
      const btn = h('button', {
        type: 'button', class: 'btn cr-buy' + (can.ok ? ' ready' : '') + (can.reason === 'max' ? ' maxed' : ''),
        disabled: disabled ? true : null,
        title: can.reason === 'credits' ? t('career.up.needCredits') : null,
        onclick: function () { if (C.buy(u.id)) { play('click'); flashToast(t('career.up.bought')); } },
        text: btnText,
      });
      grid.appendChild(h('article', { class: 'card cr-card cr-up' + (lv > 0 ? ' owned' : '') }, [
        h('div', { class: 'cr-up-top' }, [
          h('span', { class: 'cr-up-ico', 'aria-hidden': 'true' }, [u.icon]),
          h('span', { class: 'cr-up-name', text: t('career.up.' + u.id) }),
          h('span', { class: 'cr-up-lv mono', text: t('career.up.level', { a: lv, b: u.max }) }),
        ]),
        h('p', { class: 'cr-up-desc', text: t('career.up.' + u.id + '.desc') }),
        h('div', { class: 'cr-up-foot' }, [pips(lv, u.max), btn]),
      ]));
    });
    dom.crBody.appendChild(h('div', { class: 'cr-pane' }, [
      h('div', { class: 'card-title-row' }, [h('h2', { class: 'card-title', text: t('career.studio.title') }), h('span', { class: 'summary mono', text: t('career.credits') + ': ' + num(C.credits()) })]),
      h('p', { class: 'hint', text: t('career.studio.hint') }),
      grid,
    ]));
  }

  // ------------------------------------------------------------------ powers
  function renderPowers() {
    const lvNow = C.level();
    const list = h('ol', { class: 'cr-ladder' });
    for (let lv = 1; lv <= C.MAX_LEVEL; lv++) {
      const ids = Object.keys(C.POWERS).filter(function (id) { return C.POWERS[id].lv === lv; });
      const reached = lv <= lvNow;
      const kids = ids.map(function (id) {
        const info = powerInfo(id);
        return h('span', { class: 'cr-pw cat-' + C.POWERS[id].cat, title: info.name }, [h('span', { class: 'cr-pw-ico', 'aria-hidden': 'true' }, [info.icon]), h('span', { text: info.name })]);
      });
      list.appendChild(h('li', { class: 'cr-lv' + (reached ? ' reached' : '') + (lv === lvNow ? ' now' : '') }, [
        h('span', { class: 'cr-lv-n mono', text: String(lv) }),
        h('span', { class: 'cr-lv-body' }, [
          h('span', { class: 'cr-lv-pws' }, kids),
          h('span', { class: 'cr-lv-cast mono', text: t('career.powers.cast', { n: C.castCap(lv) }) }),
        ]),
        lv === lvNow ? h('span', { class: 'cr-lv-here mono', text: t('career.powers.now') }) : null,
      ]));
    }
    dom.crBody.appendChild(h('div', { class: 'cr-pane' }, [
      h('div', { class: 'card-title-row' }, [h('h2', { class: 'card-title', text: t('career.powers.title') })]),
      h('p', { class: 'hint', text: t('career.powers.hint') }),
      list,
    ]));
  }

  // ---------------------------------------------------------------- trophies
  function renderTrophies() {
    const grid = h('div', { class: 'cr-trs' });
    let got = 0;
    C.TROPHIES.forEach(function (tr) {
      const ts = C.data.trophies[tr.id];
      if (ts) got++;
      grid.appendChild(h('article', { class: 'cr-tr' + (ts ? ' got' : '') }, [
        h('span', { class: 'cr-tr-ico', 'aria-hidden': 'true' }, [tr.icon]),
        h('span', { class: 'cr-tr-body' }, [
          h('span', { class: 'cr-tr-name', text: t('career.tr.' + tr.id) }),
          h('span', { class: 'cr-tr-desc', text: t('career.tr.' + tr.id + '.desc') }),
        ]),
        h('span', { class: 'cr-tr-rew mono', text: ts ? t('career.tr.earned') : t('career.tr.reward', { n: tr.reward }) }),
      ]));
    });
    dom.crBody.appendChild(h('div', { class: 'cr-pane' }, [
      h('div', { class: 'card-title-row' }, [h('h2', { class: 'card-title', text: t('career.tr.title') }), h('span', { class: 'summary mono', text: got + ' / ' + C.TROPHIES.length })]),
      grid,
    ]));
  }

  // ----------------------------------------------------------------- profile
  function renderProfile() {
    const s = C.data.stats;
    const stat = function (lbl, val) {
      return h('div', { class: 'vs' }, [h('span', { class: 'vs-l', text: lbl }), h('span', { class: 'vs-v mono', text: val })]);
    };
    const grades = h('div', { class: 'cr-grades' });
    ['S', 'A', 'B', 'C', 'D'].forEach(function (g) {
      grades.appendChild(h('span', { class: 'cr-gcount' }, [gradeEl(g), h('span', { class: 'mono', text: '×' + (s.grades[g] || 0) })]));
    });
    const stats = h('section', { class: 'card cr-card' }, [
      h('h2', { class: 'card-title', text: t('career.prof.stats') }),
      h('div', { class: 'v-stats' }, [
        stat(t('career.prof.shows'), num(s.shows)),
        stat(t('career.prof.free'), num(s.freeShows)),
        stat(t('career.prof.viewers'), s.bestViewers ? GM.i18n.compact(s.bestViewers) : '—'),
        stat(t('career.prof.score'), s.bestScore ? num(s.bestScore, 1) : '—'),
        stat(t('career.prof.kills'), num(s.kills)),
        stat(t('career.prof.powers'), num(s.powers)),
        stat(t('career.prof.stars'), num(s.stars)),
      ]),
      h('div', { class: 'vs-l cr-gap', text: t('career.prof.grades') }),
      grades,
    ]);

    const hist = h('ul', { class: 'cr-hist' });
    const rows = C.data.history.slice(-8).reverse();
    if (!rows.length) hist.appendChild(h('li', { class: 'hint', text: t('career.prof.historyEmpty') }));
    rows.forEach(function (r) {
      hist.appendChild(h('li', { class: 'cr-hrow' }, [
        gradeEl(r.grade),
        h('span', { class: 'cr-hrow-t', text: titleText(C.titleFor(r.season, r.episode)) }),
        h('span', { class: 'cr-hrow-s mono', text: t('career.prof.row', { s: r.season, e: r.episode }) + ' · ' + GM.i18n.compact(r.viewers) }),
      ]));
    });
    const history = h('section', { class: 'card cr-card' }, [h('h2', { class: 'card-title', text: t('career.prof.history') }), hist]);

    // backup
    const code = h('textarea', { class: 'inp cr-code mono', rows: 3, spellcheck: 'false', autocomplete: 'off', placeholder: t('career.prof.codePh') });
    const msg = h('div', { class: 'cr-msg', 'aria-live': 'polite' });
    const showMsg = function (ok, text) { msg.className = 'cr-msg ' + (ok ? 'ok' : 'bad'); msg.textContent = text; };
    if (ui.importMsg) showMsg(ui.importMsg.ok, ui.importMsg.text);
    const exportBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: t('career.prof.export'), onclick: function () {
      code.value = GM.Save.exportCode();
      code.focus();
      code.select();
      ui.importMsg = null;
      msg.textContent = '';
    } });
    const copyBtn = h('button', { type: 'button', class: 'btn btn-ghost', text: t('career.prof.copy'), onclick: function () {
      if (!code.value) code.value = GM.Save.exportCode();
      code.select();
      let ok = false;
      try { ok = document.execCommand && document.execCommand('copy'); } catch (e) { ok = false; }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code.value).catch(function () {}); ok = true; }
      if (ok) showMsg(true, t('career.prof.copied'));
    } });
    const importBtn = h('button', { type: 'button', class: 'btn', text: t('career.prof.import'), onclick: function () {
      const r = GM.Save.importCode(code.value);
      ui.importMsg = r.ok ? { ok: true, text: t('career.prof.imported') } : { ok: false, text: t('career.prof.err.' + r.error) };
      if (r.ok) { play('click'); renderHub(); } else showMsg(false, ui.importMsg.text);
    } });
    const resetBtn = h('button', { type: 'button', class: 'btn btn-danger cr-reset', text: now() < ui.resetArmedUntil ? t('career.prof.resetSure') : t('career.prof.reset'), onclick: function () {
      if (now() < ui.resetArmedUntil) {
        ui.resetArmedUntil = 0;
        C.reset();
        ui.importMsg = { ok: true, text: t('career.prof.resetDone') };
        ui.tab = 'season';
        renderHub();
      } else {
        ui.resetArmedUntil = now() + 4;
        resetBtn.textContent = t('career.prof.resetSure');
      }
    } });
    const backup = h('section', { class: 'card cr-card cr-backup' }, [
      h('h2', { class: 'card-title', text: t('career.prof.backup') }),
      GM.Save.persistent() ? null : h('p', { class: 'warn', text: t('career.prof.noStorage') }),
      h('p', { class: 'hint', text: t('career.prof.backup.text') }),
      code,
      h('div', { class: 'cr-backup-btns' }, [exportBtn, copyBtn, importBtn, h('span', { class: 'cr-spacer' }), resetBtn]),
      msg,
    ]);
    dom.crBody.appendChild(h('div', { class: 'cr-profile' }, [stats, history, backup]));
  }

  function flashToast(text) {
    if (!dom.crToast) return;
    dom.crToast.textContent = text;
    dom.crToast.classList.add('on');
    ui.toastUntil = now() + 1.8;
  }

  // =============================================================== brief HUD
  function buildHud() {
    const vp = document.getElementById('viewport');
    if (!vp) return;
    dom.hud = h('aside', { class: 'cr-brief', hidden: true, 'aria-live': 'polite' });
    dom.hudHead = h('button', { type: 'button', class: 'cr-brief-head', onclick: function () { ui.hudCollapsed = !ui.hudCollapsed; dom.hud.classList.toggle('min', ui.hudCollapsed); } });
    dom.hudHead.setAttribute('data-tip', 'career.hud.collapse');
    dom.hudList = h('ul', { class: 'cr-brief-list' });
    dom.hud.appendChild(dom.hudHead);
    dom.hud.appendChild(dom.hudList);
    vp.appendChild(dom.hud);
  }

  function hudRender(prog, brief) {
    dom.hudHead.textContent = '';
    dom.hudHead.appendChild(h('span', { class: 'cr-brief-ep mono', text: t('career.hud.title', { n: brief.episode }) }));
    dom.hudHead.appendChild(h('span', { class: 'cr-brief-name', text: titleText(brief.title) }));
    dom.hudHead.appendChild(h('span', { class: 'cr-brief-chev', 'aria-hidden': 'true' }, ['▾']));
    dom.hudList.textContent = '';
    prog.forEach(function (p) {
      const state = p.locked ? (p.done ? 'ok' : 'bad') : p.done ? 'on-track' : 'pending';
      const o = { type: p.type, params: p.params };
      dom.hudList.appendChild(h('li', { class: 'cr-bo ' + state + (p.primary ? ' primary' : '') }, [
        h('span', { class: 'cr-bo-mark', 'aria-hidden': 'true' }, [state === 'ok' ? '✔' : state === 'bad' ? '✖' : state === 'on-track' ? '◉' : '○']),
        h('span', { class: 'cr-bo-text', text: objText(o) }),
        h('span', { class: 'cr-bo-prog mono', text: progText(p) }),
      ]));
    });
  }

  function hudTick(dt) {
    if (!dom.hud) return;
    const st = GM.state;
    const on = C.active() && (st.phase === 'countdown' || st.phase === 'running' || st.phase === 'ended');
    if (dom.hud.hidden === on) dom.hud.hidden = !on;
    if (!on) { ui.hudSig = ''; return; }
    ui.hudAcc += dt;
    if (ui.hudAcc < 0.25 && ui.hudSig) return;
    ui.hudAcc = 0;
    const brief = C.data.brief || (C.results() && C.results().brief);
    const prog = C.progress();
    if (!brief || !prog.length) return;
    const sig = GM.i18n.lang + '|' + prog.map(function (p) { return (p.locked ? 'L' : '') + (p.done ? 1 : 0) + ':' + p.now; }).join('|');
    // (the final verdicts differ from live estimates; the signature includes `locked`/`done`, so they repaint)
    if (sig === ui.hudSig) return;
    ui.hudSig = sig;
    hudRender(prog, brief);
  }

  // ============================================================ results block
  function resultsHtml(res) {
    const goals = res.objectives.map(function (o) {
      return '<li class="cr-ro ' + (o.done ? 'ok' : 'bad') + '"><span class="cr-ro-mark">' + (o.done ? '✔' : '✖') + '</span>' +
        '<span class="cr-ro-text">' + esc(objText(o)) + '</span>' +
        '<span class="cr-ro-rew mono">' + (o.done ? esc(rewardText(o.reward, true)) : '') + '</span></li>';
    }).join('');
    let extra = '';
    if (res.levelAfter > res.levelBefore) {
      extra += '<div class="cr-note up">🎉 ' + esc(t('career.res.levelup', { n: res.levelAfter })) + '</div>';
      if (res.unlocked.length) {
        extra += '<div class="cr-note">' + esc(t('career.res.unlocked', { list: res.unlocked.map(function (id) { const i = powerInfo(id); return i.icon + ' ' + i.name; }).join(', ') })) + '</div>';
      }
      extra += '<div class="cr-note">' + esc(t('career.res.cast', { n: res.castCap })) + '</div>';
    }
    res.trophies.forEach(function (id) {
      const tr = C.TROPHIES.filter(function (x) { return x.id === id; })[0];
      extra += '<div class="cr-note trophy">' + esc((tr ? tr.icon : '🏆') + ' ' + t('career.res.trophy', { name: t('career.tr.' + id) })) + '</div>';
    });
    if (res.season && res.season.done) {
      extra += '<div class="cr-note season">📺 ' + esc(t('career.res.season', { n: res.season.stars, b: res.season.bonus })) + '</div>';
    }
    return '<div class="cr-res">' +
      '<div class="cr-res-head"><span class="cr-res-kick mono">' + esc(t('career.res.title')) + ' · ' + esc(titleText(res.brief.title)) + '</span>' +
      '<span class="cr-stars" aria-label="' + res.stars + '/3">' + starsText(res.stars) + '</span></div>' +
      '<div class="cr-res-grid">' +
      '<div class="cr-res-goals"><div class="vs-l">' + esc(t('career.res.goals')) + '</div><ul class="cr-ros">' + goals + '</ul></div>' +
      '<div class="cr-res-pay">' +
      '<div class="cr-pay"><span class="vs-l">' + esc(t('career.res.credits')) + '</span><b class="mono">+' + esc(num(res.credits)) + '</b></div>' +
      '<div class="cr-pay"><span class="vs-l">' + esc(t('career.res.rep')) + '</span><b class="mono">+' + esc(num(res.rep)) + '</b></div>' +
      (res.scale > 1 ? '<div class="cr-scale mono">' + esc(t('career.res.scale', { n: num(res.scale, 2) })) + '</div>' : '') +
      '<div class="cr-bal mono">' + esc(t('career.res.total', { n: num(res.creditsTotal) })) + '</div>' +
      '</div></div>' + extra + '</div>';
  }

  function injectResults(e) {
    const res = C.results();
    if (!C.active() || !res || !e || !e.root) return;
    const card = e.root.querySelector('.victory-card');
    if (!card) return;
    const actions = card.querySelector('.v-actions');
    const wrap = document.createElement('div');
    wrap.innerHTML = resultsHtml(res);
    if (actions) card.insertBefore(wrap.firstChild, actions);
    else card.appendChild(wrap.firstChild);
    const lbl = card.querySelector('.v-new .start-label');
    if (lbl) lbl.textContent = t('career.res.continue');
  }

  // ============================================================ mode switch
  function buildSwitch() {
    const kicker = document.querySelector('#setup .setup-kicker');
    if (!kicker) return;
    dom.swBtn = h('button', { type: 'button', class: 'btn btn-ghost cr-sw', onclick: function () { play('click'); C.setMode('career'); } });
    kicker.appendChild(dom.swBtn);
  }

  // ============================================================== visibility
  function applyVisibility() {
    const st = GM.state;
    const setupEl = document.getElementById('setup');
    const inSetup = st.phase === 'setup';
    const showHub = inSetup && C.mode() === 'career';
    if (dom.hub.hidden === showHub) {
      dom.hub.hidden = !showHub;
      if (showHub) { ui.previewSeed = -1; renderHub(); }
    }
    if (setupEl) {
      const wantSetup = inSetup && !showHub;
      if (setupEl.hidden === wantSetup) setupEl.hidden = !wantSetup;
    }
    if (dom.swBtn) setText(dom.swBtn, '▶ ' + t('career.mode.career'));
  }

  function refreshAll() {
    if (!ui.built) return;
    if (dom.hub && !dom.hub.hidden) renderHub();
    ui.hudSig = '';
  }

  GM.registerSystem({
    name: 'CareerUI',
    order: 111,
    init() {
      const root = document.getElementById('ui-root');
      if (!root) return;
      buildHub(root);
      dom.crToast = h('div', { class: 'cr-toast', role: 'status' });
      dom.hub.appendChild(dom.crToast);
      buildHud();
      buildSwitch();
      ui.built = true;
      GM.on('lang:changed', refreshAll);
      GM.on('career:changed', function () { applyVisibility(); refreshAll(); });
      GM.on('save:imported', refreshAll);
      GM.on('save:reset', refreshAll);
      GM.on('save:external', refreshAll);
      GM.on('ui:victory', injectResults);
      // after the UI module has shown its own setup sheet: pick the right screen at once (no flash)
      GM.on('game:setup', function () { ui.previewSeed = -1; ui.hudSig = ''; applyVisibility(); refreshAll(); });
    },
    frame(dt) {
      if (!ui.built) return;
      applyVisibility();
      if (!dom.hub.hidden) {
        if (ui.tab === 'season') drawThumb();
        if (ui.toastUntil && now() > ui.toastUntil) { ui.toastUntil = 0; dom.crToast.classList.remove('on'); }
      }
      hudTick(dt);
    },
  });
})();
