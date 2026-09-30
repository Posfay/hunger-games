/* ==========================================================================
 * powers.js — the Game Master's console, the audience and the assistant.
 *
 *   GM.Powers.defs                     18 powers in display order (see SPEC 8.10)
 *   GM.Powers.def(id) -> def
 *   GM.Powers.energy / maxEnergy / cooldowns {id: seconds left}
 *   GM.Powers.canUse(id) -> {ok, reason: null|'cooldown'|'energy'|'phase'|'missing'}
 *   GM.Powers.use(id, target, optionId) -> bool
 *   GM.Powers.setAim(id, point|null)   3D targeting reticle hugging the ground
 *   GM.Powers.aim / lures / feastCountdown()   read-only state for UI + minimap
 *
 *   GM.Audience.excitement 0..100, viewers, history (one sample per historyStep s)
 *   GM.Audience.add(amount, reasonKey) / grade() / moodKey() / favorite()
 *
 *   GM.AutoGM.enabled / setEnabled(bool) / status()
 *
 * System 'Powers' (order 80). Owner: GAMEMAKER.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- strings
  GM.i18n.add({
    en: {
      'power.supply_drop': 'Supply drop',
      'power.supply_drop.desc': 'A crate falls on a parachute. It holds 3–5 good items and lures tributes to the spot.',
      'power.sponsor_gift': 'Sponsor gift',
      'power.sponsor_gift.desc': 'A silver parachute lands next to one tribute. It brings what they need most right now.',
      'power.feast': 'Feast',
      'power.feast.desc': 'Announce a feast at the Cornucopia. After 20 seconds rich crates appear, and many tributes go there.',
      'power.weather': 'Weather',
      'power.weather.desc': 'Change the weather for two minutes. Fog hides, snow slows, heat makes them thirsty, storms bring lightning.',
      'power.time_skip': 'Time skip',
      'power.time_skip.desc': 'Move the arena clock. At night it is dark and hard to see.',
      'power.flood': 'Flood',
      'power.flood.desc': 'The water rises about 4 metres for one minute. Tributes run to high ground.',
      'power.quake': 'Earthquake',
      'power.quake.desc': 'The ground shakes. It makes a hole or a hill and throws tributes to the ground.',
      'power.terraform': 'Shape the land',
      'power.terraform.desc': 'Raise, lower or flatten the ground. Build hills, walls or pits.',
      'power.fireball': 'Fireballs',
      'power.fireball.desc': 'Five fireballs fall from the sky. They explode and set the forest on fire.',
      'power.lightning': 'Lightning',
      'power.lightning.desc': 'One lightning strike. It is very dangerous up close and can start a fire.',
      'power.poison_fog': 'Poison fog',
      'power.poison_fog.desc': 'A poison cloud that moves with the wind. Breathing it hurts.',
      'power.madness_gas': 'Madness gas',
      'power.madness_gas.desc': 'A purple gas. Tributes who breathe it go mad and attack anyone.',
      'power.mutts': 'Wolf mutts',
      'power.mutts.desc': 'A pack of four wolf mutts comes out of the ground and hunts the nearest tributes.',
      'power.wasps': 'Wasp nest',
      'power.wasps.desc': 'A nest of tracker jackers (killer wasps). The swarm attacks tributes nearby, and the stings cause bad visions. Water helps.',
      'power.lure': 'Lure',
      'power.lure.desc': 'A loud siren and a blinking light. Tributes nearby come to see what it is.',
      'power.reveal': 'Reveal',
      'power.reveal.desc': 'For 30 seconds every tribute knows where all the others are. Hunters love it.',
      'power.shrink_zone': 'Close arena',
      'power.shrink_zone.desc': 'Close the force field: in 60 seconds it shrinks around the point to 55% of its size. Outside it hurts.',
      'power.smite': 'Smite',
      'power.smite.desc': 'A Capitol strike from the sky kills one tribute. The audience may not like it.',

      'power.opt.dawn': 'Dawn',
      'power.opt.noon': 'Noon',
      'power.opt.dusk': 'Dusk',
      'power.opt.midnight': 'Midnight',
      'power.opt.raise': 'Raise',
      'power.opt.lower': 'Lower',
      'power.opt.flatten': 'Flatten',

      'power.cat.gift': 'Gifts',
      'power.cat.nature': 'Nature',
      'power.cat.hazard': 'Danger',
      'power.cat.rule': 'Rules',

      'power.interest.lure': 'A strange signal',
      'power.interest.smite': 'The Capitol strikes',
      'power.interest.feast': 'The feast is coming',
      'power.interest.reveal': 'Nowhere to hide',
      'power.target.tribute': 'Target: {name}',

      'ann.gm.feast': 'A feast at the Cornucopia in {n} seconds!',
      'ann.gm.flood': 'Flood! The water is rising.',
      'ann.gm.quake': 'Earthquake!',
      'ann.gm.fireball': 'Fire falls from the sky!',
      'ann.gm.poison_fog': 'Poison fog!',
      'ann.gm.madness_gas': 'Madness gas!',
      'ann.gm.mutts': 'Mutts are loose in the arena!',
      'ann.gm.wasps': 'Tracker jackers!',
      'ann.gm.reveal': 'Nowhere to hide! Everyone knows where everyone is.',
      'ann.gm.shrink_zone': 'The force field is closing!',
      'ann.gm.smite': 'The Capitol strikes: {name}!',
      'ann.gm.weather': 'Weather: {weather}',
      'ann.gm.time_skip': 'The clock jumps: {time}',

      'log.gm.supply_drop': 'The Game Master sent a supply drop.',
      'log.gm.sponsor_gift': 'Sponsors sent a gift to {name}: {item}.',
      'log.gm.feast': 'The Game Master announced a feast at the Cornucopia.',
      'log.gm.weather': 'The Game Master changed the weather: {weather}.',
      'log.gm.time_skip': 'The Game Master moved the clock: {time}.',
      'log.gm.flood': 'The Game Master opened the dams. The water is rising!',
      'log.gm.quake': 'The Game Master made the ground shake.',
      'log.gm.terraform': 'The Game Master changed the land: {mode}.',
      'log.gm.fireball': 'The Game Master sent fireballs from the sky.',
      'log.gm.lightning': 'The Game Master called down lightning.',
      'log.gm.poison_fog': 'The Game Master released poison fog.',
      'log.gm.madness_gas': 'The Game Master released madness gas.',
      'log.gm.mutts': 'The Game Master released a pack of wolf mutts.',
      'log.gm.wasps': 'The Game Master dropped a tracker jacker nest.',
      'log.gm.lure': 'The Game Master set off a loud signal to lure the tributes.',
      'log.gm.reveal': 'The Game Master showed every tribute where the others are.',
      'log.gm.shrink_zone': 'The Game Master is closing the force field to {n} m.',
      'log.gm.smite': 'The Game Master struck down {name}.',
      'log.gm.byAssistant': 'The assistant used a power: {power}.',
      'log.gm.assistantOn': 'The assistant Game Master is now on.',
      'log.gm.assistantOff': 'The assistant Game Master is now off.',
      'log.gm.revealEnd': 'The reveal is over. The tributes can hide again.',
      'log.gm.bored': 'The audience is bored. The viewers want action.',

      'audience.title': 'Audience',
      'audience.excitement': 'Excitement',
      'audience.viewers': 'Viewers',
      'audience.grade': 'Grade',
      'audience.popularity': 'Popularity',
      'audience.favorite': 'Audience favourite: {name}',
      'audience.mood.bored': 'Bored',
      'audience.mood.calm': 'Calm',
      'audience.mood.interested': 'Interested',
      'audience.mood.excited': 'Excited',
      'audience.mood.wild': 'Wild',
      'audience.reason.kill': 'A kill!',
      'audience.reason.death': 'A tribute died',
      'audience.reason.betrayal': 'Betrayal!',
      'audience.reason.betrayalKill': 'Killed by a friend!',
      'audience.reason.alliance': 'A new alliance',
      'audience.reason.fight': 'A fight',
      'audience.reason.power': 'The Game Master acts',
      'audience.reason.feast': 'The feast',
      'audience.reason.finale': 'The final fight',
      'audience.reason.bloodbath': 'The bloodbath',
      'audience.reason.smiteBad': 'They loved that tribute',
      'audience.reason.smiteGood': 'Nobody liked that tribute',
      'audience.reason.mutt': 'A mutt was killed',
      'audience.reason.trap': 'A trap!',
      'audience.reason.gift': 'A sponsor gift',
      'audience.reason.madness': 'Someone lost their mind',
      'audience.reason.victor': 'We have a victor!',
      'audience.reason.zone': 'The force field moves',
      'audience.reason.hazard': 'The arena strikes',

      'autogm.name': 'Assistant',
      'autogm.desc': 'A helper Game Master. It acts when the audience is bored.',
      'autogm.on': 'Assistant on',
      'autogm.off': 'Assistant off',
      'autogm.status.off': 'The assistant is off.',
      'autogm.status.idle': 'The assistant is watching.',
      'autogm.status.soon': 'The audience is bored. The assistant will act soon.',
      'autogm.status.noEnergy': 'The assistant needs more energy.',
      'autogm.status.acted': 'The assistant used: {power}',
    },
    hu: {
      'power.supply_drop': 'Utánpótlás',
      'power.supply_drop.desc': 'Egy láda érkezik ejtőernyővel. 3–5 jó tárgy van benne, és odacsalja a kiválasztottakat.',
      'power.sponsor_gift': 'Ajándék',
      'power.sponsor_gift.desc': 'Szponzori ajándék: egy ezüst ejtőernyő landol egy kiválasztott mellett. Azt hozza, amire most a legjobban szüksége van.',
      'power.feast': 'Lakoma',
      'power.feast.desc': 'Lakomát hirdetsz a Bőségszarunál. 20 másodperc múlva gazdag ládák jelennek meg, és sokan odamennek.',
      'power.weather': 'Időjárás',
      'power.weather.desc': 'Két percre megváltoztatod az időjárást. A köd elrejt, a hó lassít, a hőségtől szomjasak lesznek, a viharban villámlik.',
      'power.time_skip': 'Időugrás',
      'power.time_skip.desc': 'Átállítod az aréna óráját. Éjjel sötét van, és nehéz látni.',
      'power.flood': 'Árvíz',
      'power.flood.desc': 'A víz kb. 4 métert emelkedik egy percre. A kiválasztottak a magas helyekre futnak.',
      'power.quake': 'Földrengés',
      'power.quake.desc': 'Megrázza a földet. Gödröt vagy dombot csinál, és a földre dönti a kiválasztottakat.',
      'power.terraform': 'Tájformálás',
      'power.terraform.desc': 'Megemeled, lesüllyeszted vagy elsimítod a földet. Építs dombot, falat vagy gödröt.',
      'power.fireball': 'Tűzgolyók',
      'power.fireball.desc': 'Öt tűzgolyó zuhan az égből. Felrobbannak, és felgyújtják az erdőt.',
      'power.lightning': 'Villám',
      'power.lightning.desc': 'Egy villám csap le. Közelről nagyon veszélyes, és tüzet is okozhat.',
      'power.poison_fog': 'Mérges köd',
      'power.poison_fog.desc': 'Mérges felhő, amelyet a szél sodor. Aki belélegzi, megsérül.',
      'power.madness_gas': 'Őrület-gáz',
      'power.madness_gas.desc': 'Lila gáz. Aki belélegzi, megőrül, és bárkit megtámad.',
      'power.mutts': 'Farkasok',
      'power.mutts.desc': 'Négy farkasmutáns bújik elő a földből, és a legközelebbi kiválasztottakra vadászik.',
      'power.wasps': 'Vérdarazsak',
      'power.wasps.desc': 'Egy vérdarázsfészek. A raj megtámadja a közeli kiválasztottakat, és a csípésük rémképeket okoz. A víz segít.',
      'power.lure': 'Csali',
      'power.lure.desc': 'Hangos sziréna és villogó fény. A közeli kiválasztottak odamennek megnézni.',
      'power.reveal': 'Leleplezés',
      'power.reveal.desc': '30 másodpercig minden kiválasztott tudja, hol vannak a többiek. A vadászok imádják.',
      'power.shrink_zone': 'Aréna zárása',
      'power.shrink_zone.desc': 'Összehúzod az erőteret: 60 másodperc alatt a pont körül a mostani méret 55%-ára szűkül. Kint sérülnek.',
      'power.smite': 'Csapás',
      'power.smite.desc': 'A Kapitólium lesújt az égből, és megöl egy kiválasztottat. Lehet, hogy a közönségnek nem tetszik.',

      'power.opt.dawn': 'Hajnal',
      'power.opt.noon': 'Dél',
      'power.opt.dusk': 'Alkony',
      'power.opt.midnight': 'Éjfél',
      'power.opt.raise': 'Emelés',
      'power.opt.lower': 'Süllyesztés',
      'power.opt.flatten': 'Simítás',

      'power.cat.gift': 'Ajándékok',
      'power.cat.nature': 'Természet',
      'power.cat.hazard': 'Veszély',
      'power.cat.rule': 'Szabályok',

      'power.interest.lure': 'Különös jel',
      'power.interest.smite': 'Lesújt a Kapitólium',
      'power.interest.feast': 'Hamarosan lakoma',
      'power.interest.reveal': 'Nincs hová bújni',
      'power.target.tribute': 'Célpont: {name}',

      'ann.gm.feast': 'Lakoma a Bőségszarunál {n} másodperc múlva!',
      'ann.gm.flood': 'Árvíz! Emelkedik a víz.',
      'ann.gm.quake': 'Földrengés!',
      'ann.gm.fireball': 'Tűz hullik az égből!',
      'ann.gm.poison_fog': 'Mérges köd!',
      'ann.gm.madness_gas': 'Őrület-gáz!',
      'ann.gm.mutts': 'Mutánsok az arénában!',
      'ann.gm.wasps': 'Vérdarazsak!',
      'ann.gm.reveal': 'Nincs hová bújni! Mindenki tudja, hol vannak a többiek.',
      'ann.gm.shrink_zone': 'Szűkül az erőtér!',
      'ann.gm.smite': 'Lesújt a Kapitólium: {name}!',
      'ann.gm.weather': 'Időjárás: {weather}',
      'ann.gm.time_skip': 'Ugrik az óra: {time}',

      'log.gm.supply_drop': 'A Játékmester utánpótlást küldött.',
      'log.gm.sponsor_gift': 'A szponzorok ajándékot küldtek. Címzett: {name}, ajándék: {item}.',
      'log.gm.feast': 'A Játékmester lakomát hirdetett a Bőségszarunál.',
      'log.gm.weather': 'A Játékmester megváltoztatta az időjárást: {weather}.',
      'log.gm.time_skip': 'A Játékmester átállította az órát: {time}.',
      'log.gm.flood': 'A Játékmester kinyitotta a gátakat. Emelkedik a víz!',
      'log.gm.quake': 'A Játékmester megrázta a földet.',
      'log.gm.terraform': 'A Játékmester átalakította a tájat: {mode}.',
      'log.gm.fireball': 'A Játékmester tűzgolyókat küldött az égből.',
      'log.gm.lightning': 'A Játékmester villámot küldött.',
      'log.gm.poison_fog': 'A Játékmester mérges ködöt engedett ki.',
      'log.gm.madness_gas': 'A Játékmester őrület-gázt engedett ki.',
      'log.gm.mutts': 'A Játékmester elengedett egy farkasmutáns-falkát.',
      'log.gm.wasps': 'A Játékmester ledobott egy vérdarázsfészket.',
      'log.gm.lure': 'A Játékmester hangos jelet adott, hogy odacsalja a kiválasztottakat.',
      'log.gm.reveal': 'A Játékmester mindenkinek megmutatta, hol vannak a többiek.',
      'log.gm.shrink_zone': 'A Játékmester szűkíti az erőteret. Új méret: {n} m.',
      'log.gm.smite': 'A Játékmester lesújtott rá: {name}.',
      'log.gm.byAssistant': 'A segéd képességet használt: {power}.',
      'log.gm.assistantOn': 'A segéd Játékmester bekapcsolt.',
      'log.gm.assistantOff': 'A segéd Játékmester kikapcsolt.',
      'log.gm.revealEnd': 'Vége a leleplezésnek. A kiválasztottak újra elbújhatnak.',
      'log.gm.bored': 'A közönség unatkozik. A nézők izgalmat akarnak.',

      'audience.title': 'Közönség',
      'audience.excitement': 'Izgalom',
      'audience.viewers': 'Nézők',
      'audience.grade': 'Értékelés',
      'audience.popularity': 'Népszerűség',
      'audience.favorite': 'A közönség kedvence: {name}',
      'audience.mood.bored': 'Unatkozik',
      'audience.mood.calm': 'Nyugodt',
      'audience.mood.interested': 'Figyel',
      'audience.mood.excited': 'Izgatott',
      'audience.mood.wild': 'Tombol',
      'audience.reason.kill': 'Egy gyilkosság!',
      'audience.reason.death': 'Meghalt egy kiválasztott',
      'audience.reason.betrayal': 'Árulás!',
      'audience.reason.betrayalKill': 'A barátja ölte meg!',
      'audience.reason.alliance': 'Új szövetség',
      'audience.reason.fight': 'Harc',
      'audience.reason.power': 'A Játékmester közbelép',
      'audience.reason.feast': 'A lakoma',
      'audience.reason.finale': 'A végső harc',
      'audience.reason.bloodbath': 'A vérfürdő',
      'audience.reason.smiteBad': 'Szerették azt a kiválasztottat',
      'audience.reason.smiteGood': 'Senki sem szerette azt a kiválasztottat',
      'audience.reason.mutt': 'Meghalt egy mutáns',
      'audience.reason.trap': 'Egy csapda!',
      'audience.reason.gift': 'Szponzori ajándék',
      'audience.reason.madness': 'Valaki megőrült',
      'audience.reason.victor': 'Megvan a győztes!',
      'audience.reason.zone': 'Mozog az erőtér',
      'audience.reason.hazard': 'Lecsap az aréna',

      'autogm.name': 'Segéd',
      'autogm.desc': 'Segéd Játékmester. Közbelép, ha unatkozik a közönség.',
      'autogm.on': 'Segéd be',
      'autogm.off': 'Segéd ki',
      'autogm.status.off': 'A segéd ki van kapcsolva.',
      'autogm.status.idle': 'A segéd figyel.',
      'autogm.status.soon': 'A közönség unatkozik. A segéd hamarosan közbelép.',
      'autogm.status.noEnergy': 'A segédnek több energia kell.',
      'autogm.status.acted': 'A segéd ezt használta: {power}',
    },
  });

  const THREE = window.THREE || null;

  // -------------------------------------------------------------- constants
  const START_ENERGY = 60;
  const MAX_ENERGY = 100;
  const SANDBOX_CD = 0.25;
  const FEAST_DELAY = 20;          // sim s between the announcement and the crates
  const REVEAL_TIME = 30;
  const LURE_TIME = 20;
  const LURE_NOISE = 160;
  const SMITE_DELAY = 0.9;         // column of light first, then the strike
  const HISTORY_STEP = 5;          // sim s per audience history sample
  const HISTORY_MAX = 360;         // then the history is halved (step doubles)
  const BORED_LEVEL = 15;          // excitement drifts here when nothing happens
  const AUTO_BORED = 30;           // AutoGM: excitement below this ...
  const AUTO_WAIT = 20;            // ... for this many sim seconds -> act
  const AUTO_GAP = 25;             // min sim s between assistant actions
  const MAX_LURES = 4;
  const CAT_COLORS = { gift: 0xffc94d, nature: 0x52d68a, hazard: 0xff5b3a, rule: 0x62b6ff };
  const INVALID_COLOR = 0x8a8f99;

  // ------------------------------------------------------------ power table
  function opt(id, icon, key) { return { id: id, icon: icon, key: key || 'power.opt.' + id }; }
  const DEFS = [
    { id: 'supply_drop', category: 'gift', icon: '📦', cost: 15, cooldown: 20, target: 'point', radius: 6, options: null, weight: 1 },
    { id: 'sponsor_gift', category: 'gift', icon: '🪂', cost: 10, cooldown: 8, target: 'tribute', radius: 2.5, options: null, weight: 0.6 },
    { id: 'feast', category: 'gift', icon: '🍗', cost: 35, cooldown: 150, target: 'none', radius: null, options: null, weight: 1.4 },
    {
      id: 'weather', category: 'nature', icon: '🌦️', cost: 10, cooldown: 25, target: 'none', radius: null, weight: 0.8,
      options: [
        opt('clear', '☀️', 'weather.clear'), opt('rain', '🌧️', 'weather.rain'), opt('storm', '⛈️', 'weather.storm'),
        opt('fog', '🌫️', 'weather.fog'), opt('snow', '❄️', 'weather.snow'), opt('heat', '🔥', 'weather.heat'),
      ],
    },
    {
      id: 'time_skip', category: 'nature', icon: '⏩', cost: 5, cooldown: 20, target: 'none', radius: null, weight: 0.5,
      options: [opt('dawn', '🌅'), opt('noon', '🌞'), opt('dusk', '🌇'), opt('midnight', '🌙')],
    },
    { id: 'flood', category: 'nature', icon: '🌊', cost: 30, cooldown: 90, target: 'none', radius: null, options: null, weight: 1.4 },
    { id: 'quake', category: 'nature', icon: '🌋', cost: 25, cooldown: 40, target: 'point', radius: 22, options: null, weight: 1.2 },
    {
      id: 'terraform', category: 'nature', icon: '⛰️', cost: 5, cooldown: 1.5, target: 'point', radius: 12, weight: 0.15,
      options: [opt('raise', '⬆️'), opt('lower', '⬇️'), opt('flatten', '➖')],
    },
    { id: 'fireball', category: 'hazard', icon: '☄️', cost: 20, cooldown: 20, target: 'point', radius: 18, options: null, weight: 1.3 },
    { id: 'lightning', category: 'hazard', icon: '⚡', cost: 10, cooldown: 6, target: 'point', radius: 8, options: null, weight: 0.7 },
    { id: 'poison_fog', category: 'hazard', icon: '☠️', cost: 25, cooldown: 60, target: 'point', radius: 20, options: null, weight: 1.2 },
    { id: 'madness_gas', category: 'hazard', icon: '🌀', cost: 25, cooldown: 60, target: 'point', radius: 16, options: null, weight: 1.3 },
    { id: 'mutts', category: 'hazard', icon: '🐺', cost: 30, cooldown: 60, target: 'point', radius: 10, options: null, weight: 1.5 },
    { id: 'wasps', category: 'hazard', icon: '🐝', cost: 20, cooldown: 45, target: 'point', radius: 10, options: null, weight: 1.2 },
    { id: 'lure', category: 'rule', icon: '📣', cost: 8, cooldown: 15, target: 'point', radius: 30, options: null, weight: 0.6 },
    { id: 'reveal', category: 'rule', icon: '👁️', cost: 20, cooldown: 90, target: 'none', radius: null, options: null, weight: 1 },
    { id: 'shrink_zone', category: 'rule', icon: '⭕', cost: 40, cooldown: 120, target: 'point', radius: Math.round(CFG.ARENA_RADIUS * 0.55), options: null, weight: 1.5 },
    { id: 'smite', category: 'rule', icon: '🌩️', cost: 60, cooldown: 180, target: 'tribute', radius: 2.5, options: null, weight: 0 },
  ];
  const BY_ID = Object.create(null);
  for (let i = 0; i < DEFS.length; i++) {
    const d = DEFS[i];
    d.nameKey = 'power.' + d.id;
    d.descKey = 'power.' + d.id + '.desc';
    d.color = '#' + (CAT_COLORS[d.category] || 0xffffff).toString(16).padStart(6, '0');
    d.big = d.weight >= 1.2;
    BY_ID[d.id] = d;
  }
  const TIME_SKIP_TOD = { dawn: CFG.DAWN + 0.004, noon: 0.5, dusk: CFG.DUSK + 0.004, midnight: 0.001 };
  const TERRAFORM = { raise: { amount: 4, mode: 'raise' }, lower: { amount: 4, mode: 'lower' }, flatten: { amount: 1, mode: 'flatten' } };

  // shared, never-mutated canUse() results (the UI calls canUse every frame)
  const R_OK = Object.freeze({ ok: true, reason: null });
  const R_PHASE = Object.freeze({ ok: false, reason: 'phase' });
  const R_COOLDOWN = Object.freeze({ ok: false, reason: 'cooldown' });
  const R_ENERGY = Object.freeze({ ok: false, reason: 'energy' });
  const R_MISSING = Object.freeze({ ok: false, reason: 'missing' });

  // ---------------------------------------------------------------- helpers
  function settings() { return GM.state.settings || null; }
  function isSandbox() { const s = settings(); return !!(s && s.sandbox); }
  function isLow() { const s = settings(); return !!(s && s.quality === 'low'); }
  function running() { return GM.state.phase === 'running'; }
  function fx(method, a, b, c, d, e) {
    const F = GM.FX;
    if (!F || typeof F[method] !== 'function') return;
    try { F[method](a, b, c, d, e); } catch (err) { GM.reportError('Powers.FX.' + method, err); }
  }
  function sfx(name, pos, volume) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, pos ? { pos: pos, volume: volume == null ? 1 : volume } : { volume: volume == null ? 1 : volume }); } catch (err) { GM.reportError('Powers.audio', err); }
  }
  function aiNoise(pos, radius, kind) {
    const AI = GM.AI;
    if (!AI || typeof AI.noise !== 'function') return;
    try { AI.noise(pos, radius, kind, null); } catch (err) { GM.reportError('Powers.noise', err); }
  }
  function interest(o) {
    try { GM.addInterest(o); } catch (err) { GM.reportError('Powers.interest', err); }
  }
  function shake(intensity, seconds) {
    const C = GM.Cameras;
    if (!C || typeof C.shake !== 'function') return;
    try { C.shake(intensity, seconds); } catch (err) { GM.reportError('Powers.shake', err); }
  }
  function groundY(x, z) {
    const Tr = GM.Terrain;
    if (Tr && typeof Tr.heightAt === 'function') {
      const y = Tr.heightAt(x, z);
      if (y === y) return y;
    }
    return 0;
  }
  function waterY() {
    const Tr = GM.Terrain;
    if (Tr && typeof Tr.waterLevel === 'function') {
      try { const w = Tr.waterLevel(); if (w === w && w != null) return w; } catch (err) { /* fall through */ }
    }
    const E = GM.Env;
    if (E && typeof E.waterLevel === 'number') return E.waterLevel;
    return CFG.BASE_WATER_LEVEL;
  }
  function surfaceY(x, z) { const g = groundY(x, z); const w = waterY(); return g > w ? g : w; }
  function P3(x, y, z) { return { x: x, y: y, z: z }; }
  function isPoint(p) { return !!p && typeof p === 'object' && isFinite(+p.x) && isFinite(+p.z); }
  function scene() { return GM.World && GM.World.scene ? GM.World.scene : null; }
  function tribCall(method, a, b, c, d) {
    const T = GM.Tributes;
    if (!T || typeof T[method] !== 'function') return undefined;
    try { return T[method](a, b, c, d); } catch (err) { GM.reportError('Powers.Tributes.' + method, err); return undefined; }
  }
  /** Living tributes (new array; only used by low-frequency code). */
  function livingTributes() {
    const out = [];
    const trs = GM.state.tributes;
    for (let i = 0; i < trs.length; i++) if (trs[i] && trs[i].alive) out.push(trs[i]);
    return out;
  }
  function aliveCount() {
    let n = 0;
    const trs = GM.state.tributes;
    for (let i = 0; i < trs.length; i++) if (trs[i] && trs[i].alive) n++;
    return n;
  }
  /** Clamp a ground point inside the arena (keeps a small margin from the wall). */
  function clampArena(x, z, margin) {
    const maxR = CFG.ARENA_RADIUS - (margin == null ? 3 : margin);
    const d = Math.sqrt(x * x + z * z);
    if (d > maxR && d > 0) { x *= maxR / d; z *= maxR / d; }
    return { x: x, z: z };
  }
  function nearestTributeTo(x, z, maxDist) {
    const trs = GM.state.tributes;
    let best = null, bd = maxDist * maxDist;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!t || !t.alive || !t.pos) continue;
      const dx = t.pos.x - x, dz = t.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  /** Where the feast table goes: in front of the cornucopia mouth (same rule as Items). */
  function feastPos() {
    const Tr = GM.Terrain;
    const lm = Tr && Tr.landmarks && Tr.landmarks.cornucopia;
    let x = 0, z = 0, heading = null;
    if (lm) {
      x = +lm.x || 0; z = +lm.z || 0;
      if (typeof lm.heading === 'number') heading = lm.heading;
      else if (typeof lm.mouthHeading === 'number') heading = lm.mouthHeading;
      else if (lm.mouth && typeof lm.mouth.x === 'number') heading = Math.atan2(lm.mouth.x - x, lm.mouth.z - z);
    }
    if (heading === null) {
      const W = GM.World;
      const c = W && W.cornucopia;
      if (c && c.userData && typeof c.userData.mouthHeading === 'number') heading = c.userData.mouthHeading;
      else if (W && typeof W.cornucopiaHeading === 'number') heading = W.cornucopiaHeading;
    }
    if (heading === null) heading = 0;
    return { x: x + Math.sin(heading) * 9, z: z + Math.cos(heading) * 9 };
  }

  // ================================================================ VISUALS
  // Everything lives under one group (vis.root) so a scene rebuild can be
  // detected and repaired with a single parent check per frame.
  const RET_VS = [
    'attribute float aR;',
    'attribute float aA;',
    'varying float vR;',
    'varying float vA;',
    'void main() {',
    '  vR = aR;',
    '  vA = aA;',
    '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    '}',
  ].join('\n');
  const RET_FS = [
    'uniform vec3 uColor;',
    'uniform float uTime;',
    'uniform float uAlpha;',
    'uniform float uSmall;',
    'varying float vR;',
    'varying float vA;',
    'void main() {',
    '  float fill = 0.09 + 0.11 * vR * vR;',
    '  float rimW = mix(0.03, 0.12, uSmall);',
    '  float rim = smoothstep(1.0 - rimW * 2.0, 1.0 - rimW, vR) * (1.0 - smoothstep(0.985, 1.0, vR));',
    '  float w = fract(uTime * 0.55);',
    '  float pulse = (1.0 - smoothstep(0.0, 0.05 + 0.06 * uSmall, abs(vR - w))) * (1.0 - w);',
    '  float tick = step(0.55, fract(vA * 36.0 + uTime * 0.12)) * smoothstep(0.82, 0.84, vR)',
    '             * (1.0 - smoothstep(0.88, 0.9, vR)) * (1.0 - uSmall);',
    '  float hair = (1.0 - smoothstep(0.004, 0.012, abs(fract(vA * 4.0 + 0.5) - 0.5) * vR * 6.0))',
    '              * smoothstep(0.08, 0.1, vR) * (1.0 - smoothstep(0.22, 0.26, vR)) * (1.0 - uSmall);',
    '  float core = 1.0 - smoothstep(0.012, 0.045, vR);',
    '  float breathe = 0.82 + 0.18 * sin(uTime * 4.0);',
    '  float a = (fill + rim * 0.95 * breathe + pulse * 0.55 + tick * 0.5 + hair * 0.6 + core * 0.8) * uAlpha;',
    '  vec3 col = mix(uColor, vec3(1.0), clamp(rim * 0.3 + core * 0.6 + hair * 0.3, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));',
    '}',
  ].join('\n');
  // Vertical light column (reveal beams, aim pillar, lure halo, smite, feast).
  // Works on plain meshes and on InstancedMesh (per-instance colour).
  const BEAM_VS = [
    'varying vec2 vUv;',
    'varying vec3 vCol;',
    'void main() {',
    '  vUv = uv;',
    '  #ifdef USE_INSTANCING_COLOR',
    '    vCol = instanceColor;',
    '  #else',
    '    vCol = vec3(1.0);',
    '  #endif',
    '  vec4 p = vec4(position, 1.0);',
    '  #ifdef USE_INSTANCING',
    '    p = instanceMatrix * p;',
    '  #endif',
    '  gl_Position = projectionMatrix * modelViewMatrix * p;',
    '}',
  ].join('\n');
  const BEAM_FS = [
    'uniform vec3 uColor;',
    'uniform vec4 gmPost;',
    'uniform float uAlpha;',
    'uniform float uTime;',
    'varying vec2 vUv;',
    'varying vec3 vCol;',
    'void main() {',
    '  float h = vUv.y;',
    '  float fade = pow(1.0 - h, 1.6);',
    '  float foot = smoothstep(0.0, 0.015, h);',
    '  float band = 0.7 + 0.3 * sin(uTime * 5.0 - h * 34.0);',
    '  float a = uAlpha * fade * foot * band;',
    '  gl_FragColor = vec4(uColor * vCol * (0.65 + 0.9 * fade) * 2.4 * gmPost.y, clamp(a, 0.0, 1.0));',
    '}',
  ].join('\n');

  const RINGS = [0, 0.03, 0.07, 0.13, 0.2, 0.28, 0.37, 0.46, 0.55, 0.64, 0.72, 0.8, 0.86, 0.91, 0.95, 0.975, 1];
  const SEGS = 72;
  const SEG_SIN = new Float32Array(SEGS + 1);
  const SEG_COS = new Float32Array(SEGS + 1);
  for (let s = 0; s <= SEGS; s++) { SEG_SIN[s] = Math.sin((s / SEGS) * TAU); SEG_COS[s] = Math.cos((s / SEGS) * TAU); }

  let vis = null;
  let visTime = 0;
  const colorCache = Object.create(null);
  const tmpM = THREE ? new THREE.Matrix4() : null;

  function makeBeamMat(color, alpha) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: alpha == null ? 1 : alpha }, uTime: { value: 0 }, gmPost: GM.Gfx ? GM.Gfx.uniforms.gmPost : { value: [1, 1, 0, 0] } },
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
  }
  function noPick(o) { o.userData.noPick = true; o.frustumCulled = false; return o; }

  /** Build the persistent meshes lazily (needs World.scene). Returns vis or null. */
  function buildVisuals() {
    if (vis) return vis;
    if (!THREE) return null;
    const sc = scene();
    if (!sc) return null;
    try {
      const root = new THREE.Group();
      root.name = 'PowersFX';
      noPick(root);

      // --- targeting reticle: a polar grid whose vertices follow the ground
      const NR = RINGS.length, NS = SEGS + 1;
      const pos = new Float32Array(NR * NS * 3);
      const aR = new Float32Array(NR * NS);
      const aA = new Float32Array(NR * NS);
      for (let r = 0; r < NR; r++) {
        for (let s = 0; s < NS; s++) { const i = r * NS + s; aR[i] = RINGS[r]; aA[i] = s / SEGS; }
      }
      const idx = [];
      for (let r = 0; r < NR - 1; r++) {
        for (let s = 0; s < SEGS; s++) {
          const a = r * NS + s, b = a + 1, c = a + NS, d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      const retGeo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(pos, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      retGeo.setAttribute('position', posAttr);
      retGeo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
      retGeo.setAttribute('aA', new THREE.BufferAttribute(aA, 1));
      retGeo.setIndex(idx);
      const retMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0xffffff) },
          uTime: { value: 0 },
          uAlpha: { value: 1 },
          uSmall: { value: 0 },
        },
        vertexShader: RET_VS,
        fragmentShader: RET_FS,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const reticle = noPick(new THREE.Mesh(retGeo, retMat));
      reticle.renderOrder = 12;
      reticle.visible = false;
      root.add(reticle);

      // --- shared beam geometry (unit cylinder standing on y = 0)
      const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
      beamGeo.translate(0, 0.5, 0);

      const pillarMat = makeBeamMat(0xffffff, 0.8);
      const pillar = noPick(new THREE.Mesh(beamGeo, pillarMat));
      pillar.renderOrder = 13;
      pillar.visible = false;
      root.add(pillar);

      // --- reveal: one instanced beam per living tribute
      const maxT = CFG.MAX_TRIBUTES;
      const revealMat = makeBeamMat(0xffffff, 0);
      const reveal = noPick(new THREE.InstancedMesh(beamGeo, revealMat, maxT));
      reveal.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const white = new THREE.Color(0xffffff);
      tmpM.makeScale(0.001, 0.001, 0.001);
      for (let i = 0; i < maxT; i++) { reveal.setMatrixAt(i, tmpM); reveal.setColorAt(i, white); }
      reveal.count = 0;
      reveal.visible = false;
      reveal.renderOrder = 11;
      root.add(reveal);

      // --- lure beacon parts (shared by all lures)
      const lureBaseGeo = new THREE.CylinderGeometry(0.45, 0.6, 0.3, 8);
      lureBaseGeo.translate(0, 0.15, 0);
      const lurePoleGeo = new THREE.CylinderGeometry(0.06, 0.09, 3, 6);
      lurePoleGeo.translate(0, 1.6, 0);
      const lureHornGeo = new THREE.ConeGeometry(0.32, 0.55, 8, 1, true);
      lureHornGeo.rotateX(Math.PI / 2);
      lureHornGeo.translate(0, 2.55, 0.25);
      const lureLampGeo = new THREE.SphereGeometry(0.28, 12, 8);
      lureLampGeo.translate(0, 3.25, 0);
      const lureMetal = new THREE.MeshStandardMaterial({ color: 0x3b4049, roughness: 0.4, metalness: 0.8 });
      const lureLampMat = new THREE.MeshBasicMaterial({ color: 0xff3030 });
      lureLampMat.color.multiplyScalar(6);
      const lureHaloMat = makeBeamMat(0xff3a2a, 0.8);

      // --- feast beacon (golden column over the table during the countdown)
      const feastMat = makeBeamMat(0xffd36b, 0);
      const feastBeam = noPick(new THREE.Mesh(beamGeo, feastMat));
      feastBeam.visible = false;
      feastBeam.renderOrder = 11;
      root.add(feastBeam);

      sc.add(root);
      vis = {
        root, reticle, retGeo, retMat, posAttr, pillar, pillarMat, beamGeo, reveal, revealMat,
        lureBaseGeo, lurePoleGeo, lureHornGeo, lureLampGeo, lureMetal, lureLampMat, lureHaloMat,
        feastBeam, feastMat,
      };
      aim.dirty = true;
      // lures / smites created before the scene existed get their meshes now
      for (let i = 0; i < lures.length; i++) if (!lures[i].group) lures[i].group = makeLureGroup(lures[i]);
      for (let i = 0; i < smites.length; i++) if (!smites[i].mesh) makeSmiteMeshes(smites[i]);
    } catch (err) {
      GM.reportError('Powers.buildVisuals', err);
      vis = null;
    }
    return vis;
  }

  function ensureInScene() {
    const sc = scene();
    if (vis && sc && vis.root.parent !== sc) sc.add(vis.root);
  }

  function tributeColor(t) {
    let c = colorCache[t.id];
    if (!c) c = colorCache[t.id] = new THREE.Color(t.color || GM.districtColor(t.district || 1));
    return c;
  }
  function clearColorCache() { for (const k in colorCache) delete colorCache[k]; }

  // ----------------------------------------------------------------- aiming
  const aim = {
    active: false, id: null, x: 0, z: 0,      // requested point
    cx: 0, cz: 0, radius: 0,                  // where the reticle really is
    tributeId: null, valid: false, dirty: true,
    lastCx: NaN, lastCz: NaN, lastR: -1,
  };

  function sampleReticle(cx, cz, R) {
    const pos = vis.posAttr.array;
    const NS = SEGS + 1;
    const wy = waterY();
    const lift = 0.16 + Math.min(0.6, R * 0.006);
    let k = 0;
    for (let r = 0; r < RINGS.length; r++) {
      const rr = RINGS[r] * R;
      for (let s = 0; s < NS; s++) {
        const ox = SEG_SIN[s] * rr, oz = SEG_COS[s] * rr;
        let y = groundY(cx + ox, cz + oz);
        if (y < wy) y = wy;
        pos[k++] = ox; pos[k++] = y + lift; pos[k++] = oz;
      }
    }
    vis.posAttr.needsUpdate = true;
    vis.reticle.position.set(cx, 0, cz);
    aim.lastCx = cx; aim.lastCz = cz; aim.lastR = R; aim.dirty = false;
  }

  /** Resolve the reticle centre + radius for the current aim (also used by the minimap). */
  function resolveAim() {
    const def = BY_ID[aim.id];
    let cx, cz, R, small = 0, alpha = 1;
    aim.tributeId = null;
    if (def.target === 'tribute') {
      const t = nearestTributeTo(aim.x, aim.z, 6);
      small = 1;
      if (t) { cx = t.pos.x; cz = t.pos.z; R = def.radius || 2.5; aim.tributeId = t.id; }
      else { cx = aim.x; cz = aim.z; R = 1.4; alpha = 0.45; }
    } else if (def.id === 'shrink_zone') {
      const H = GM.Hazards;
      const zr = H && H.zone && H.zone.radius > 0 ? H.zone.radius : CFG.ARENA_RADIUS;
      const r = zr * 0.55;
      let pz = null;
      if (H && typeof H.previewZone === 'function') {
        try { pz = H.previewZone({ x: aim.x, z: aim.z }, r); } catch (err) { pz = null; }
      }
      if (pz && isFinite(pz.x) && isFinite(pz.radius)) { cx = pz.x; cz = pz.z; R = pz.radius; }
      else { const c = clampArena(aim.x, aim.z, r); cx = c.x; cz = c.z; R = r; }
      def.radius = Math.round(R);
    } else {
      const c = clampArena(aim.x, aim.z, 3);
      cx = c.x; cz = c.z; R = def.radius || 5;
    }
    aim.cx = cx; aim.cz = cz; aim.radius = R;
    return { small: small, alpha: alpha };
  }

  function drawAim() {
    const m = vis.reticle;
    if (!aim.active || !BY_ID[aim.id]) {
      m.visible = false;
      vis.pillar.visible = false;
      return;
    }
    const def = BY_ID[aim.id];
    const r = resolveAim();
    const R = aim.radius;
    if (aim.dirty || Math.abs(aim.cx - aim.lastCx) > 0.2 || Math.abs(aim.cz - aim.lastCz) > 0.2 || Math.abs(R - aim.lastR) > 0.05) {
      sampleReticle(aim.cx, aim.cz, R);
    }
    const ok = Powers.canUse(aim.id).ok;
    aim.valid = ok;
    const color = ok ? (CAT_COLORS[def.category] || 0xffffff) : INVALID_COLOR;
    const u = vis.retMat.uniforms;
    u.uColor.value.setHex(color);
    u.uTime.value = visTime;
    u.uAlpha.value = r.alpha * (ok ? 1 : 0.55);
    u.uSmall.value = r.small;
    m.visible = true;
    // a thin light pillar marks the centre (visible from far away / behind hills)
    const p = vis.pillar;
    const pu = vis.pillarMat.uniforms;
    pu.uColor.value.setHex(color);
    pu.uTime.value = visTime;
    pu.uAlpha.value = (ok ? 0.75 : 0.35) * r.alpha;
    const pw = r.small ? 0.16 : U.clamp(R * 0.012, 0.18, 0.6);
    const ph = r.small ? 7 : U.clamp(8 + R * 0.35, 10, 34);
    p.scale.set(pw, ph, pw);
    p.position.set(aim.cx, surfaceY(aim.cx, aim.cz), aim.cz);
    p.visible = true;
  }

  // ----------------------------------------------------------------- reveal
  let revealStart = -1;
  let revealActive = false;

  function drawReveal() {
    const st = GM.state;
    const mesh = vis.reveal;
    const on = st.revealUntil > st.time && (st.phase === 'running' || st.phase === 'ended');
    if (!on) { mesh.visible = false; mesh.count = 0; return; }
    const left = st.revealUntil - st.time;
    const since = revealStart >= 0 ? st.time - revealStart : 1;
    const a = U.clamp01(Math.min(left / 2.5, since / 0.8));
    const trs = st.tributes;
    let n = 0;
    for (let i = 0; i < trs.length && n < CFG.MAX_TRIBUTES; i++) {
      const t = trs[i];
      if (!t || !t.alive || !t.pos) continue;
      tmpM.makeScale(0.3, 42, 0.3);
      tmpM.setPosition(t.pos.x, t.pos.y + 0.1, t.pos.z);
      mesh.setMatrixAt(n, tmpM);
      mesh.setColorAt(n, tributeColor(t));
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const u = vis.revealMat.uniforms;
    u.uAlpha.value = 0.9 * a;
    u.uTime.value = visTime;
    mesh.visible = n > 0 && a > 0.01;
  }

  function updateReveal() {
    const st = GM.state;
    if (revealActive && st.time >= st.revealUntil) {
      revealActive = false;
      if (st.phase === 'running') GM.log('gm', 'log.gm.revealEnd', {}, {});
    }
  }

  // ------------------------------------------------------------------ lures
  const lures = [];   // {x, y, z, start, until, nextNoise, nextRing, nextSiren, group}
  let lureUid = 0;

  function makeLureGroup(l) {
    if (!vis) return null;
    const g = new THREE.Group();
    noPick(g);
    g.add(noPick(new THREE.Mesh(vis.lureBaseGeo, vis.lureMetal)));
    g.add(noPick(new THREE.Mesh(vis.lurePoleGeo, vis.lureMetal)));
    g.add(noPick(new THREE.Mesh(vis.lureHornGeo, vis.lureMetal)));
    g.add(noPick(new THREE.Mesh(vis.lureLampGeo, vis.lureLampMat)));
    const halo = noPick(new THREE.Mesh(vis.beamGeo, vis.lureHaloMat));
    halo.scale.set(0.9, 10, 0.9);
    g.add(halo);
    g.position.set(l.x, l.y, l.z);
    g.rotation.y = GM.U.headingTo(l, { x: 0, z: 0 });
    vis.root.add(g);
    return g;
  }

  function spawnLure(x, z) {
    const st = GM.state;
    while (lures.length >= MAX_LURES) removeLure(0);
    const l = {
      id: ++lureUid, x: x, y: surfaceY(x, z), z: z,
      start: st.time, until: st.time + LURE_TIME,
      nextNoise: st.time, nextRing: st.time, nextSiren: st.time,
      group: null,
    };
    if (vis || buildVisuals()) l.group = makeLureGroup(l);
    lures.push(l);
    interest({ pos: P3(x, l.y, z), score: 4, duration: LURE_TIME, kind: 'power', key: 'lure:' + l.id, label: { key: 'power.interest.lure' } });
    return l;
  }

  function removeLure(i) {
    const l = lures[i];
    if (!l) return;
    if (l.group && l.group.parent) l.group.parent.remove(l.group);
    l.group = null;
    lures.splice(i, 1);
  }

  function updateLures() {
    const st = GM.state;
    for (let i = lures.length - 1; i >= 0; i--) {
      const l = lures[i];
      if (st.time >= l.until) { removeLure(i); continue; }
      const P = P3(l.x, l.y + 2.5, l.z);
      if (st.time >= l.nextNoise) {
        l.nextNoise = st.time + 5;
        if (st.phase === 'running') aiNoise(P, LURE_NOISE, 'lure');
      }
      if (st.time >= l.nextRing) {
        l.nextRing = st.time + 1.6;
        fx('ring', P3(l.x, l.y + 0.3, l.z), 0xff4a3a, 26, 1.4);
      }
      if (st.time >= l.nextSiren) {
        l.nextSiren = st.time + 6.5;
        sfx('alarm', P, 0.9);
      }
    }
  }

  function drawLures() {
    if (!lures.length) return;
    const on = (visTime % 0.5) < 0.25;
    vis.lureLampMat.color.setHex(on ? 0xff2a2a : 0x3a0c0c);
    const u = vis.lureHaloMat.uniforms;
    u.uAlpha.value = on ? 0.85 : 0.18;
    u.uTime.value = visTime;
    const now = GM.state.time;
    for (let i = 0; i < lures.length; i++) {
      const l = lures[i];
      if (!l.group) continue;
      // sink into the ground during the last second
      const left = l.until - now;
      l.group.position.y = l.y - (left < 1 ? (1 - left) * 3.6 : 0);
    }
  }

  // ------------------------------------------------------------------ smite
  const smites = [];  // {t, x, y, z, start, struck, mesh, core, mat, coreMat}

  function makeSmiteMeshes(s) {
    if (!vis) return;
    s.mat = makeBeamMat(0xffe9a8, 0);
    s.coreMat = makeBeamMat(0xffffff, 0);
    s.mesh = noPick(new THREE.Mesh(vis.beamGeo, s.mat));
    s.core = noPick(new THREE.Mesh(vis.beamGeo, s.coreMat));
    s.mesh.renderOrder = 14;
    s.core.renderOrder = 15;
    vis.root.add(s.mesh);
    vis.root.add(s.core);
  }

  function startSmite(t) {
    const s = {
      t: t, x: t.pos.x, y: t.pos.y, z: t.pos.z,
      start: GM.state.time, struck: false,
      mesh: null, core: null, mat: null, coreMat: null,
    };
    if (vis || buildVisuals()) makeSmiteMeshes(s);
    smites.push(s);
    sfx('zap', P3(s.x, s.y, s.z), 0.8);
    fx('ring', P3(s.x, s.y + 0.3, s.z), 0xffe7a0, 6, SMITE_DELAY);
    return s;
  }

  function strikeSmite(s) {
    s.struck = true;
    const t = s.t;
    if (t && t.alive && t.pos) { s.x = t.pos.x; s.y = t.pos.y; s.z = t.pos.z; }
    const P = P3(s.x, s.y, s.z);
    const H = GM.Hazards;
    let bolt = false;
    if (H && typeof H.lightning === 'function') {
      try { H.lightning(P, { visualOnly: true, ignite: false, damage: 0 }); bolt = true; } catch (err) { GM.reportError('Powers.smiteBolt', err); }
    }
    if (!bolt) {
      fx('beam', P3(s.x, s.y + 90, s.z), P3(s.x, s.y + 0.5, s.z), 0xfff4d0, 1.4, 0.45);
      sfx('thunder', P, 1);
    }
    fx('flash', P3(s.x, s.y + 3, s.z), 0xfff0c0, 7, 70, 0.55);
    fx('burst', P3(s.x, s.y + 1, s.z), {
      count: isLow() ? 24 : 52, color: 0xfff3c4, color2: 0xffb640, speed: 11, spread: 0.8,
      up: 7, gravity: -9, size: 0.32, life: 1.2, additive: true,
    });
    fx('ring', P3(s.x, s.y + 0.3, s.z), 0xffe7a0, 16, 0.9);
    sfx('explosion', P, 0.6);
    shake(0.55, 0.7);
    if (t && t.alive && GM.state.phase === 'running') {
      tribCall('damage', t, 100000, { cause: 'smite', attacker: null, mutt: null, weapon: null, pos: t.pos });
      if (t.alive) tribCall('kill', t, { cause: 'smite', killer: null, attacker: null, weapon: null, pos: t.pos });
    }
  }

  function removeSmite(i) {
    const s = smites[i];
    if (!s) return;
    if (s.mesh && s.mesh.parent) s.mesh.parent.remove(s.mesh);
    if (s.core && s.core.parent) s.core.parent.remove(s.core);
    if (s.mat) s.mat.dispose();
    if (s.coreMat) s.coreMat.dispose();
    smites.splice(i, 1);
  }

  function updateSmites() {
    const now = GM.state.time;
    for (let i = smites.length - 1; i >= 0; i--) {
      const s = smites[i];
      if (!s.struck) {
        if (s.t && s.t.alive && s.t.pos) { s.x = s.t.pos.x; s.y = s.t.pos.y; s.z = s.t.pos.z; }
        if (now >= s.start + SMITE_DELAY) strikeSmite(s);
      } else if (now >= s.start + SMITE_DELAY + 2.4) {
        removeSmite(i);
      }
    }
  }

  function drawSmites() {
    const now = GM.state.time;
    for (let i = 0; i < smites.length; i++) {
      const s = smites[i];
      if (!s.mesh) continue;
      const el = now - s.start;
      let r, a;
      if (el < SMITE_DELAY) {
        const k = U.clamp01(el / SMITE_DELAY);
        r = 0.2 + 2.1 * k * k;
        a = 0.25 + 0.75 * k;
      } else {
        const f = U.clamp01((el - SMITE_DELAY) / 2.4);
        r = 2.3 + 2.6 * f;
        a = 1.5 * (1 - f) * (1 - f);
      }
      s.mesh.scale.set(r, 170, r);
      s.mesh.position.set(s.x, s.y - 0.2, s.z);
      s.core.scale.set(r * 0.32, 170, r * 0.32);
      s.core.position.set(s.x, s.y - 0.2, s.z);
      s.mat.uniforms.uAlpha.value = a;
      s.mat.uniforms.uTime.value = visTime;
      s.coreMat.uniforms.uAlpha.value = Math.min(1, a * 1.3);
      s.coreMat.uniforms.uTime.value = visTime;
      s.mesh.visible = s.core.visible = a > 0.01;
    }
  }

  // ------------------------------------------------------------------ feast
  let feastPending = null;   // {at, x, y, z, nextRing, nextBeep}
  let feastFadeUntil = 0;
  let feastUsed = false;

  function updateFeast() {
    const st = GM.state;
    const f = feastPending;
    if (!f) return;
    if (st.time >= f.nextRing) {
      f.nextRing = st.time + 2;
      fx('ring', P3(f.x, f.y + 0.3, f.z), 0xffd36b, 18, 1.6);
    }
    if (st.time >= f.nextBeep && st.time < f.at) {
      f.nextBeep = st.time + 1;
      sfx('beep', P3(f.x, f.y + 2, f.z), 0.7);
    }
    if (st.time < f.at) return;
    feastPending = null;
    feastFadeUntil = st.time + 3;
    if (st.phase !== 'running' && st.phase !== 'ended') return;
    const I = GM.Items;
    let spawned = false;
    if (I && typeof I.spawnFeast === 'function') {
      try { I.spawnFeast(); spawned = true; } catch (err) { GM.reportError('Powers.spawnFeast', err); }
    }
    if (!spawned) {
      // no loot module: keep the contract so listeners (camera, AI) still react
      if (st.feast) st.feast.ready = true;
      GM.emit('feast:ready', { pos: P3(f.x, f.y, f.z) });
    }
    fx('flash', P3(f.x, f.y + 4, f.z), 0xffd36b, 4, 50, 0.5);
  }

  function drawFeast() {
    const m = vis.feastBeam;
    const now = GM.state.time;
    let a = 0, x = 0, y = 0, z = 0;
    if (feastPending) {
      const f = feastPending;
      const left = f.at - now;
      a = 0.55 + 0.25 * Math.sin(visTime * (left < 5 ? 9 : 3));
      x = f.x; y = f.y; z = f.z;
    } else if (now < feastFadeUntil && GM.state.feast) {
      a = 0.8 * U.clamp01((feastFadeUntil - now) / 3);
      x = GM.state.feast.x; z = GM.state.feast.z; y = surfaceY(x, z);
    }
    if (a <= 0.01) { m.visible = false; return; }
    m.position.set(x, y, z);
    m.scale.set(1.4, 110, 1.4);
    vis.feastMat.uniforms.uAlpha.value = a;
    vis.feastMat.uniforms.uTime.value = visTime;
    m.visible = true;
  }

  // ------------------------------------------------------------ timed tasks
  const tasks = [];   // {at, fn}
  function schedule(at, fn) { tasks.push({ at: at, fn: fn }); }
  function runTasks() {
    if (!tasks.length) return;
    const now = GM.state.time;
    for (let i = 0; i < tasks.length; i++) {
      const tk = tasks[i];
      if (tk.at > now) continue;
      tasks.splice(i, 1);
      i--;
      try { tk.fn(); } catch (err) { GM.reportError('Powers.task', err); }
    }
  }

  // ================================================================ POWERS
  const Powers = (GM.Powers = {
    defs: DEFS,
    maxEnergy: MAX_ENERGY,
    energy: START_ENERGY,
    cooldowns: {},
    used: {},              // id -> uses this game
    totalUsed: 0,
    lastUsed: null,        // {id, time, auto}
    lastFail: null,        // {id, reason}
    aim: aim,
    lures: lures,
    categories: ['gift', 'nature', 'hazard', 'rule'],
  });

  function resetCooldowns() {
    for (let i = 0; i < DEFS.length; i++) Powers.cooldowns[DEFS[i].id] = 0;
  }
  resetCooldowns();

  function cooldownOf(def) { return def.cooldown * (isSandbox() ? SANDBOX_CD : 1); }

  /** Power definition by id (or null). */
  Powers.def = function (id) { return BY_ID[id] || null; };
  /** Energy the power costs right now (0 in sandbox). */
  Powers.cost = function (id) { const d = BY_ID[id]; return d ? (isSandbox() ? 0 : d.cost) : 0; };
  /** Full cooldown of a power with sandbox rules applied. */
  Powers.cooldownOf = function (id) { const d = BY_ID[id]; return d ? cooldownOf(d) : 0; };
  /** 0..1 progress of the cooldown (1 = ready), for button sweeps. */
  Powers.readiness = function (id) {
    const d = BY_ID[id];
    if (!d) return 0;
    const full = cooldownOf(d);
    const left = Powers.cooldowns[id] || 0;
    return full > 0 ? U.clamp01(1 - left / full) : 1;
  };
  Powers.categoryColor = function (cat) { return '#' + (CAT_COLORS[cat] || 0xffffff).toString(16).padStart(6, '0'); };
  /** Energy per sim second (SPEC: 0.6 + excitement / 45). */
  Powers.regenRate = function () { return isSandbox() ? 0 : 0.6 + GM.Audience.excitement / 45; };
  /** Seconds until the announced feast opens (0 when none is pending). */
  Powers.feastCountdown = function () { return feastPending ? Math.max(0, feastPending.at - GM.state.time) : 0; };
  /** Seconds of reveal left. */
  Powers.revealLeft = function () { const st = GM.state; return Math.max(0, st.revealUntil - st.time); };

  /** Can the power be used now? Shared result objects: do not mutate. */
  Powers.canUse = function (id) {
    const def = BY_ID[id];
    if (!def) return R_MISSING;
    if (GM.state.phase !== 'running') return R_PHASE;
    if ((Powers.cooldowns[id] || 0) > 0) return R_COOLDOWN;
    if (!isSandbox() && Powers.energy < def.cost) return R_ENERGY;
    return R_OK;
  };

  function fail(id, reason) { Powers.lastFail = { id: id, reason: reason }; return false; }

  function resolveTribute(target) {
    let t = null;
    const trs = GM.state.tributes;
    if (typeof target === 'number') t = trs[target] || null;
    else if (target && typeof target === 'object') {
      if (target.kind === 'tribute' || (target.pos && target.name != null && typeof target.id === 'number')) t = trs[target.id] === target ? target : trs[target.id] || null;
      else if (isPoint(target)) t = nearestTributeTo(+target.x, +target.z, 6);
    }
    return t && t.alive && t.pos ? t : null;
  }

  // Each effect gets a context {def, auto, option, x, z, pos, tribute} and returns
  // false (nothing happened: no cost) or {params, pos?, ids?, important?, ann?, log?}.
  let lastTerraformLog = -999;
  let lastTerraformMode = null;
  function haz(method) {
    const H = GM.Hazards;
    return H && typeof H[method] === 'function' ? H : null;
  }

  const EFFECTS = {
    supply_drop(c) {
      const I = GM.Items;
      if (!I || typeof I.supplyDrop !== 'function') return false;
      const item = I.supplyDrop(c.x, c.z, { tier: GM.R.chance(0.35) ? 3 : 2 });
      if (!item) return false;
      aiNoise(c.pos, 90, 'lure');
      return { params: {} };
    },

    sponsor_gift(c) {
      const I = GM.Items;
      const t = c.tribute;
      if (!I || typeof I.sponsorGift !== 'function' || !t) return false;
      let type = null;
      if (typeof I.neededGift === 'function') {
        try { type = I.neededGift(t); } catch (err) { type = null; }
      }
      const item = I.sponsorGift(t, type);
      if (!item) return false;
      if (!type) type = (item.contents && item.contents[0]) || 'food';
      bumpPopularity(t, 0.02);
      return { params: { name: t.name, item: '@item.' + type }, ids: [t.id] };
    },

    feast() {
      const st = GM.state;
      if (feastPending) return false;
      const p = feastPos();
      const y = surfaceY(p.x, p.z);
      st.feast = { x: p.x, z: p.z, at: st.time + FEAST_DELAY, ready: false, over: false, announcedAt: st.time };
      feastPending = { at: st.time + FEAST_DELAY, x: p.x, y: y, z: p.z, nextRing: st.time, nextBeep: st.time + FEAST_DELAY - 5 };
      feastUsed = true;
      const pos = P3(p.x, y, p.z);
      GM.emit('feast:announced', { pos: pos, at: st.feast.at });
      interest({ pos: pos, score: 6, duration: FEAST_DELAY + 4, kind: 'feast', key: 'feast', label: { key: 'power.interest.feast' } });
      sfx('announce', null, 1);
      return {
        params: {}, pos: pos, important: true,
        ann: { key: 'ann.gm.feast', params: { n: FEAST_DELAY }, style: 'gold', duration: 5 },
      };
    },

    weather(c) {
      const E = GM.Env;
      if (!E || typeof E.setWeather !== 'function') return false;
      const w = c.option || 'storm';
      E.setWeather(w, 120);
      const wk = '@weather.' + w;
      return {
        params: { weather: wk },
        ann: w === 'clear' ? null : { key: 'ann.gm.weather', params: { weather: wk }, style: 'gm', duration: 3 },
      };
    },

    time_skip(c) {
      const E = GM.Env;
      if (!E || typeof E.setTimeOfDay !== 'function') return false;
      const o = TIME_SKIP_TOD[c.option] != null ? c.option : 'noon';
      E.setTimeOfDay(TIME_SKIP_TOD[o]);
      const tk = '@power.opt.' + o;
      return { params: { time: tk }, ann: { key: 'ann.gm.time_skip', params: { time: tk }, style: 'gm', duration: 2.5 } };
    },

    flood() {
      const H = haz('flood');
      if (!H || H.flood(4, 60) === false) return false;
      return { params: {}, important: true, ann: { key: 'ann.gm.flood', style: 'danger', duration: 4 } };
    },

    quake(c) {
      const H = haz('earthquake');
      if (!H) return false;
      H.earthquake(c.pos, c.def.radius, 1);
      return { params: {}, important: true, ann: { key: 'ann.gm.quake', style: 'danger', duration: 3 } };
    },

    terraform(c) {
      const Tr = GM.Terrain;
      if (!Tr || typeof Tr.deform !== 'function') return false;
      const mode = TERRAFORM[c.option] ? c.option : 'raise';
      const o = TERRAFORM[mode];
      Tr.deform(c.x, c.z, c.def.radius, o.amount, o.mode);
      const y = surfaceY(c.x, c.z);
      fx('burst', P3(c.x, y + 0.5, c.z), {
        count: isLow() ? 10 : 22, color: 0x8a7658, color2: 0x5d5040, speed: 3, spread: c.def.radius * 0.5,
        up: 2.5, gravity: -6, size: 0.9, life: 1.2,
      });
      fx('ring', P3(c.x, y + 0.3, c.z), 0xb8a27a, c.def.radius, 0.6);
      sfx('quake', c.pos, 0.35);
      aim.dirty = true;
      // sculpting is quick and repeated: one log line per burst of work
      const now = GM.state.time;
      const log = now - lastTerraformLog > 8 || lastTerraformMode !== mode;
      lastTerraformLog = now;
      lastTerraformMode = mode;
      return { params: { mode: '@power.opt.' + mode }, log: log };
    },

    fireball(c) {
      const H = haz('fireball');
      if (!H) return false;
      const R = c.def.radius;
      let at = GM.state.time;
      for (let k = 0; k < 5; k++) {
        const a = GM.R.angle();
        const r = k === 0 ? GM.R.range(0, R * 0.2) : Math.sqrt(GM.R.random()) * R * 0.85;
        const p = clampArena(c.x + Math.sin(a) * r, c.z + Math.cos(a) * r, 3);
        if (k > 0) at += GM.R.range(0.3, 0.65);
        schedule(at, function () {
          const Hz = haz('fireball');
          if (Hz) Hz.fireball({ x: p.x, z: p.z });
        });
      }
      return { params: {}, important: true, ann: { key: 'ann.gm.fireball', style: 'danger', duration: 3 } };
    },

    lightning(c) {
      const H = haz('lightning');
      if (!H) return false;
      H.lightning(c.pos, { natural: false });
      return { params: {} };
    },

    poison_fog(c) {
      const H = haz('gasCloud');
      if (!H || !H.gasCloud(c.pos, c.def.radius, 45, 'poison')) return false;
      return { params: {}, important: true, ann: { key: 'ann.gm.poison_fog', style: 'danger', duration: 3 } };
    },

    madness_gas(c) {
      const H = haz('gasCloud');
      if (!H || !H.gasCloud(c.pos, c.def.radius, 35, 'madness')) return false;
      return { params: {}, important: true, ann: { key: 'ann.gm.madness_gas', style: 'danger', duration: 3 } };
    },

    mutts(c) {
      const M = GM.Mutts;
      if (!M || typeof M.spawn !== 'function') return false;
      const list = M.spawn('wolf', c.x, c.z, 4);
      if (!list || !list.length) return false;
      return { params: {}, important: true, ann: { key: 'ann.gm.mutts', style: 'danger', duration: 3.5 } };
    },

    wasps(c) {
      const M = GM.Mutts;
      if (!M || typeof M.spawn !== 'function') return false;
      const list = M.spawn('wasps', c.x, c.z);
      if (!list || !list.length) return false;
      return { params: {}, important: true, ann: { key: 'ann.gm.wasps', style: 'danger', duration: 3 } };
    },

    lure(c) {
      spawnLure(c.x, c.z);
      aiNoise(P3(c.x, c.pos.y + 2.5, c.z), LURE_NOISE, 'lure');
      return { params: {} };
    },

    reveal() {
      const st = GM.state;
      st.revealUntil = st.time + REVEAL_TIME;
      revealStart = st.time;
      revealActive = true;
      GM.emit('reveal', { until: st.revealUntil, duration: REVEAL_TIME });
      sfx('zap', null, 0.8);
      if (!vis) buildVisuals();
      return { params: {}, important: true, ann: { key: 'ann.gm.reveal', style: 'gm', duration: 3.5 } };
    },

    shrink_zone(c) {
      const H = haz('shrinkZone');
      if (!H) return false;
      const zr = H.zone && H.zone.radius > 0 ? H.zone.radius : CFG.ARENA_RADIUS;
      const r = zr * 0.55;
      if (H.shrinkZone({ x: c.x, z: c.z }, r, 60) === false) return false;
      const target = H.zone && H.zone.targetRadius > 0 ? H.zone.targetRadius : r;
      return {
        params: { n: Math.round(target) }, important: true,
        ann: { key: 'ann.gm.shrink_zone', style: 'danger', duration: 4 },
      };
    },

    smite(c) {
      const t = c.tribute;
      if (!t || !t.alive) return false;
      for (let i = 0; i < smites.length; i++) if (smites[i].t === t && !smites[i].struck) return false;
      startSmite(t);
      tribCall('stun', t, SMITE_DELAY + 1.2);
      // the crowd judges the strike: killing a favourite hurts the show
      const pop = typeof t.popularity === 'number' ? t.popularity : 0.3;
      const delta = 18 - 70 * pop;
      GM.Audience.add(delta, delta < 0 ? 'audience.reason.smiteBad' : 'audience.reason.smiteGood');
      interest({
        pos: t.pos, score: 11, duration: 6, followId: t.id, kind: 'power', key: 'smite:' + t.id,
        label: { key: 'power.interest.smite' },
      });
      return {
        params: { name: t.name }, ids: [t.id], important: true,
        ann: { key: 'ann.gm.smite', params: { name: t.name }, style: 'danger', duration: 4 },
      };
    },
  };

  /**
   * Use a power. target: {x, z} for point powers, a tribute (or id) for tribute
   * powers, null for the rest. optionId picks an option (default: the first).
   * opts {auto: true} marks assistant use (logged as "Assistant").
   */
  Powers.use = function (id, target, optionId, opts) {
    const def = BY_ID[id];
    if (!def) return fail(id, 'missing');
    const chk = Powers.canUse(id);
    if (!chk.ok) return fail(id, chk.reason);
    const c = { def: def, auto: !!(opts && opts.auto), option: null, x: 0, z: 0, pos: null, tribute: null };
    if (def.options) {
      let o = null;
      for (let i = 0; i < def.options.length; i++) if (def.options[i].id === optionId) o = def.options[i];
      c.option = (o || def.options[0]).id;
    }
    if (def.target === 'point') {
      let p = target;
      if (p && p.pos && isPoint(p.pos)) p = p.pos;
      if (!isPoint(p)) return fail(id, 'target');
      const q = clampArena(+p.x, +p.z, 3);
      c.x = q.x; c.z = q.z;
      c.pos = P3(q.x, surfaceY(q.x, q.z), q.z);
    } else if (def.target === 'tribute') {
      const t = resolveTribute(target);
      if (!t) return fail(id, 'target');
      c.tribute = t;
      c.x = t.pos.x; c.z = t.pos.z;
      c.pos = P3(t.pos.x, t.pos.y, t.pos.z);
    }
    let res = false;
    try { res = EFFECTS[id](c); } catch (err) { GM.reportError('Powers.use.' + id, err); res = false; }
    if (!res) return fail(id, 'failed');

    const st = GM.state;
    if (!isSandbox()) Powers.energy = Math.max(0, Powers.energy - def.cost);
    Powers.cooldowns[id] = cooldownOf(def);
    Powers.used[id] = (Powers.used[id] || 0) + 1;
    Powers.totalUsed++;
    Powers.lastUsed = { id: id, time: st.time, auto: c.auto };
    Powers.lastFail = null;

    if (res.log !== false) {
      const key = 'log.gm.' + id;
      const params = res.params || {};
      const lopts = {
        pos: res.pos || c.pos || null,
        tributeIds: res.ids || (c.tribute ? [c.tribute.id] : []),
        important: !!res.important,
      };
      if (c.auto) GM.log('gm', 'log.gm.byAssistant', { power: '@power.' + id }, lopts);
      else GM.log('gm', key, params, lopts);
    }
    if (res.ann) GM.announce(res.ann.key, res.ann.params || {}, { style: res.ann.style || 'gm', duration: res.ann.duration || 3.5 });
    const evTarget = def.target === 'tribute' ? c.tribute : def.target === 'point' ? c.pos : null;
    GM.emit('power:used', { id: id, target: evTarget, option: c.option, auto: c.auto, cost: isSandbox() ? 0 : def.cost });
    return true;
  };

  /** Show (point) or hide (null) the 3D targeting reticle for a power. */
  Powers.setAim = function (id, point) {
    const def = id ? BY_ID[id] : null;
    if (!def || def.target === 'none' || !isPoint(point)) {
      aim.active = false;
      aim.id = null;
      aim.tributeId = null;
      return;
    }
    if (aim.id !== id) aim.dirty = true;
    aim.active = true;
    aim.id = id;
    aim.x = +point.x;
    aim.z = +point.z;
    if (!vis) buildVisuals();
    if (!vis) resolveAim();   // keep aim.cx/cz/radius useful for the minimap
  };

  function updatePowers(dt) {
    const st = GM.state;
    const cds = Powers.cooldowns;
    for (let i = 0; i < DEFS.length; i++) {
      const id = DEFS[i].id;
      const c = cds[id];
      if (c > 0) cds[id] = c > dt ? c - dt : 0;
    }
    if (st.phase === 'running') {
      if (isSandbox()) Powers.energy = MAX_ENERGY;
      else {
        Powers.energy += Powers.regenRate() * dt;
        if (Powers.energy > MAX_ENERGY) Powers.energy = MAX_ENERGY;
      }
    }
    runTasks();
    updateFeast();
    updateLures();
    updateSmites();
    updateReveal();
  }

  function frameVisuals(realDt) {
    if (!vis) {
      const need = aim.active || lures.length || smites.length || feastPending || GM.state.revealUntil > GM.state.time;
      if (!need || !buildVisuals()) return;
    }
    ensureInScene();
    visTime += realDt;
    drawAim();
    drawReveal();
    drawLures();
    drawSmites();
    drawFeast();
  }

  function clearPowers() {
    const st = GM.state;
    Powers.energy = START_ENERGY;
    resetCooldowns();
    for (const k in Powers.used) delete Powers.used[k];
    Powers.totalUsed = 0;
    Powers.lastUsed = null;
    Powers.lastFail = null;
    tasks.length = 0;
    feastPending = null;
    feastFadeUntil = 0;
    feastUsed = false;
    while (lures.length) removeLure(lures.length - 1);
    while (smites.length) removeSmite(smites.length - 1);
    revealActive = false;
    revealStart = -1;
    if (st.revealUntil > 0) st.revealUntil = 0;
    lastTerraformLog = -999;
    lastTerraformMode = null;
    aim.active = false;
    aim.id = null;
    aim.tributeId = null;
    aim.dirty = true;
    clearColorCache();
    const shrink = BY_ID.shrink_zone;
    if (shrink) shrink.radius = Math.round(CFG.ARENA_RADIUS * 0.55);
    if (vis) {
      vis.reticle.visible = false;
      vis.pillar.visible = false;
      vis.reveal.visible = false;
      vis.reveal.count = 0;
      vis.feastBeam.visible = false;
    }
  }

  // ============================================================== AUDIENCE
  const Audience = (GM.Audience = {
    excitement: 30,
    viewers: 0,
    history: [],             // excitement samples, one per historyStep sim seconds
    historyStep: HISTORY_STEP,
    peakViewers: 0,
    peakExcitement: 30,
    trend: 0,                // excitement change over the last ~5 s
    recent: [],              // [{key, amount, time}] newest first (UI ticker)
    last: null,
  });

  let lastEventTime = 0;     // sim time of the last exciting thing
  let fightBudget = 0;       // caps the +3 per hit
  let powerHeat = 0;         // diminishing returns when powers are spammed
  let sampleAcc = 0;
  let popAcc = 0;
  let emitAcc = 0;
  let trendRef = 30;
  let trendAcc = 0;
  let boredLogAt = -999;
  let lowSince = -1;
  let scoreCache = 30;
  const betrayals = Object.create(null);   // tribute id -> sim time of their last betrayal

  function popOf(t) { return t && typeof t.popularity === 'number' ? t.popularity : 0.3; }
  function bumpPopularity(t, amount) {
    if (!t || typeof t !== 'object') return;
    t.popularity = U.clamp01(popOf(t) + amount);
  }

  function viewersTarget() {
    const e = Audience.excitement;
    return (6e6 + 0.2e6 * e) * (1 + 0.15 * (GM.state.day || 1));
  }

  /**
   * Change the excitement. Positive amounts shrink when the crowd is already
   * hyped. reasonKey ('audience.reason.*') feeds the UI ticker. Returns the real change.
   */
  Audience.add = function (amount, reasonKey) {
    amount = +amount || 0;
    if (!amount) return 0;
    let a = amount;
    if (a > 0) a *= 1 - 0.5 * (Audience.excitement / 100);
    const before = Audience.excitement;
    Audience.excitement = U.clamp(before + a, 0, 100);
    const real = Audience.excitement - before;
    if (amount >= 3) lastEventTime = GM.state.time;
    if (Audience.excitement > Audience.peakExcitement) Audience.peakExcitement = Audience.excitement;
    if (reasonKey) {
      const r = { key: reasonKey, amount: Math.round(real * 10) / 10, time: GM.state.time };
      Audience.last = r;
      Audience.recent.unshift(r);
      if (Audience.recent.length > 8) Audience.recent.length = 8;
    }
    return real;
  };

  function computeScore() {
    const h = Audience.history;
    if (!h.length) return Audience.excitement;
    let sum = 0;
    for (let i = 0; i < h.length; i++) sum += h[i];
    const avg = sum / h.length;
    const sorted = h.slice().sort(function (a, b) { return b - a; });
    const n = Math.max(1, Math.ceil(sorted.length * 0.2));
    let top = 0;
    for (let i = 0; i < n; i++) top += sorted[i];
    return avg * 0.65 + (top / n) * 0.35;
  }
  /** 0..100 show quality (average excitement blended with the best moments). */
  Audience.score = function () {
    return Audience.history.length ? scoreCache : Audience.excitement;
  };
  /** Audience grade for the whole Games so far: 'S' | 'A' | 'B' | 'C' | 'D'. */
  Audience.grade = function () {
    const s = Audience.score();
    return s >= 62 ? 'S' : s >= 50 ? 'A' : s >= 38 ? 'B' : s >= 27 ? 'C' : 'D';
  };
  /** 'audience.mood.*' key for the current excitement. */
  Audience.moodKey = function () {
    const e = Audience.excitement;
    return 'audience.mood.' + (e < 20 ? 'bored' : e < 35 ? 'calm' : e < 55 ? 'interested' : e < 75 ? 'excited' : 'wild');
  };
  /** The most popular living tribute (the winner after the Games), or null. */
  Audience.favorite = function () {
    const st = GM.state;
    if (st.winner != null && st.tributes[st.winner]) return st.tributes[st.winner];
    let best = null;
    const trs = st.tributes;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (t && t.alive && (!best || popOf(t) > popOf(best))) best = t;
    }
    return best;
  };
  Audience.viewersTarget = viewersTarget;

  function pushSample() {
    const h = Audience.history;
    h.push(Math.round(Audience.excitement * 10) / 10);
    if (h.length > HISTORY_MAX) {
      // keep the whole Games in the sparkline: halve the resolution
      const out = [];
      for (let i = 0; i + 1 < h.length; i += 2) out.push(Math.round((h[i] + h[i + 1]) * 5) / 10);
      if (h.length % 2) out.push(h[h.length - 1]);
      h.length = 0;
      for (let i = 0; i < out.length; i++) h.push(out[i]);
      Audience.historyStep *= 2;
    }
    scoreCache = computeScore();
  }

  function initPopularity() {
    const base = { career: 0.42, berserker: 0.36, protector: 0.38, lonewolf: 0.34, strategist: 0.32 };
    const trs = GM.state.tributes;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!t) continue;
      const jitter = ((((t.id + 1) * 2654435761) >>> 0) % 1000) / 1000 * 0.1 - 0.05;
      t.popularity = U.clamp01((base[t.archetype] || 0.3) + jitter);
    }
  }

  /** Slow drift toward a baseline: kills, long survival and being hurt make stars. */
  function popularityTick() {
    const trs = GM.state.tributes;
    const total = trs.length || 1;
    const survival = 1 - aliveCount() / total;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!t || !t.alive) continue;
      const hurt = t.maxHealth > 0 && t.health / t.maxHealth < 0.35 ? 0.04 : 0;
      const target = 0.18 + 0.05 * Math.min(t.kills || 0, 6) + 0.3 * survival + hurt;
      t.popularity = U.clamp01(popOf(t) + (target - popOf(t)) * 0.012);
    }
  }

  function updateAudience(dt) {
    const st = GM.state;
    if (st.phase !== 'running' && st.phase !== 'ended') return;
    const idle = st.time - lastEventTime;
    const e = Audience.excitement;
    if (st.phase === 'running') {
      // boredom: drift toward BORED_LEVEL, faster when nothing happened for a while
      const k = e > BORED_LEVEL ? (idle > 15 ? 0.03 : 0.012) : 0.02;
      Audience.excitement = U.damp(e, BORED_LEVEL, k, dt);
    }
    fightBudget = Math.max(0, fightBudget - 1.5 * dt);
    powerHeat *= Math.exp(-dt / 25);

    const vt = viewersTarget() * (1 + 0.004 * Math.sin(st.time * 0.7));
    Audience.viewers = Audience.viewers > 0 ? U.damp(Audience.viewers, vt, 0.35, dt) : vt;
    if (Audience.viewers > Audience.peakViewers) Audience.peakViewers = Audience.viewers;
    if (st.stats && Audience.viewers > (st.stats.peakViewers || 0)) st.stats.peakViewers = Math.round(Audience.viewers);

    if (st.phase !== 'running') return;
    sampleAcc += dt;
    if (sampleAcc >= Audience.historyStep) { sampleAcc -= Audience.historyStep; pushSample(); }
    trendAcc += dt;
    if (trendAcc >= 5) { trendAcc = 0; Audience.trend = Audience.excitement - trendRef; trendRef = Audience.excitement; }
    popAcc += dt;
    if (popAcc >= 1) { popAcc = 0; popularityTick(); }

    // a gentle nudge in the log when the show is dull for long
    if (Audience.excitement < 20) {
      if (lowSince < 0) lowSince = st.time;
      if (st.time - lowSince > 40 && st.time - boredLogAt > 150 && !AutoGM.enabled) {
        boredLogAt = st.time;
        GM.log('gm', 'log.gm.bored', {}, {});
      }
    } else lowSince = -1;
  }

  function emitAudience() {
    GM.emit('audience:changed', {
      excitement: Audience.excitement,
      viewers: Audience.viewers,
      trend: Audience.trend,
      grade: Audience.grade(),
      mood: Audience.moodKey(),
    });
  }

  function clearAudience() {
    Audience.excitement = 30;
    Audience.history.length = 0;
    Audience.historyStep = HISTORY_STEP;
    Audience.peakViewers = 0;
    Audience.peakExcitement = 30;
    Audience.trend = 0;
    Audience.recent.length = 0;
    Audience.last = null;
    Audience.viewers = viewersTarget();
    lastEventTime = 0;
    fightBudget = 0;
    powerHeat = 0;
    sampleAcc = 0;
    popAcc = 0;
    trendRef = 30;
    trendAcc = 0;
    boredLogAt = -999;
    lowSince = -1;
    scoreCache = 30;
    for (const k in betrayals) delete betrayals[k];
  }

  // --- event reactions
  function live() { return GM.state.phase === 'running'; }

  function onDied(e) {
    if (!e || !e.tribute || !live()) return;
    const st = GM.state;
    const t = e.tribute;
    const killer = e.killer && e.killer.kind !== 'mutt' && typeof e.killer === 'object' ? e.killer : null;
    const left = aliveCount();
    const finale = left >= 1 && left <= 3;
    if (e.cause === 'smite') {                    // judged when the strike was ordered
      if (finale) Audience.add(10, 'audience.reason.finale');
      return;
    }
    if (killer) {
      const betrayal = (betrayals[killer.id] != null && st.time - betrayals[killer.id] < 30) ||
        (killer.allianceId != null && killer.allianceId === t.allianceId);
      let amount = 25;
      let key = 'audience.reason.kill';
      if (betrayal) { amount += 15; key = 'audience.reason.betrayalKill'; }
      if (finale) { amount += 15; if (!betrayal) key = 'audience.reason.finale'; }
      Audience.add(amount, key);
      let bump = 0.06;
      if (popOf(t) > popOf(killer)) bump += 0.05;                 // took down a favourite
      if ((t.kills || 0) >= Math.max(1, (killer.kills || 1) - 1)) bump += 0.04;   // underdog win
      if (betrayal) bump -= 0.1;
      bumpPopularity(killer, bump);
    } else {
      Audience.add(finale ? 30 : 15, finale ? 'audience.reason.finale' : 'audience.reason.death');
    }
  }

  function onAttack(e) {
    if (!e || !e.hit || !live()) return;
    if (fightBudget < 18) {
      fightBudget += 3;
      Audience.add(3, 'audience.reason.fight');
    }
  }

  function onPowerUsed(e) {
    if (!e || !live()) return;
    const def = BY_ID[e.id];
    if (!def || !def.weight) return;              // smite is judged separately
    const amount = (8 * def.weight) / (1 + powerHeat * 0.6);
    powerHeat += def.weight;
    Audience.add(amount, 'audience.reason.power');
  }

  function onAllianceBroken(e) {
    if (!e || !e.betrayal || !live()) return;
    const st = GM.state;
    if (e.byId != null) {
      betrayals[e.byId] = st.time;
      bumpPopularity(st.tributes[e.byId], -0.12);
    }
    Audience.add(30, 'audience.reason.betrayal');
  }

  function onAllianceFormed(e) {
    if (!live()) return;
    Audience.add(12, 'audience.reason.alliance');
    const a = e && e.alliance;
    if (a && Array.isArray(a.members)) {
      for (let i = 0; i < a.members.length; i++) bumpPopularity(GM.state.tributes[a.members[i]], 0.02);
    }
  }

  // ================================================================ AUTOGM
  const AutoGM = (GM.AutoGM = {
    enabled: false,
    boredFor: 0,              // sim seconds the audience has been bored
    actions: 0,
    lastAction: null,         // {id, time}
    state: 'off',             // 'off' | 'idle' | 'soon' | 'noEnergy' | 'acted'
  });
  let autoLastTime = -999;
  let autoNextTry = 0;
  let camperAcc = 0;
  const campers = Object.create(null);    // tribute id -> {x, z, since}

  /** Turn the assistant on or off (also mirrors settings.autoGM). */
  AutoGM.setEnabled = function (b) {
    b = !!b;
    const s = settings();
    if (s) s.autoGM = b;
    if (b === AutoGM.enabled) return;
    AutoGM.enabled = b;
    AutoGM.boredFor = 0;
    AutoGM.state = b ? 'idle' : 'off';
    const ph = GM.state.phase;
    if (ph === 'running' || ph === 'countdown') GM.log('gm', b ? 'log.gm.assistantOn' : 'log.gm.assistantOff', {}, {});
    GM.emit('autogm:changed', { enabled: b });
  };
  AutoGM.toggle = function () { AutoGM.setEnabled(!AutoGM.enabled); };
  /** {key, params} describing what the assistant is doing (for a status line). */
  AutoGM.status = function () {
    if (AutoGM.state === 'acted' && AutoGM.lastAction) {
      return { key: 'autogm.status.acted', params: { power: '@power.' + AutoGM.lastAction.id } };
    }
    return { key: 'autogm.status.' + AutoGM.state, params: {} };
  };

  function trackCampers(dt) {
    camperAcc += dt;
    if (camperAcc < 5) return;
    camperAcc = 0;
    const st = GM.state;
    const trs = st.tributes;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!t || !t.pos) continue;
      if (!t.alive) { delete campers[t.id]; continue; }
      const c = campers[t.id];
      if (!c) { campers[t.id] = { x: t.pos.x, z: t.pos.z, since: st.time }; continue; }
      const dx = t.pos.x - c.x, dz = t.pos.z - c.z;
      if (dx * dx + dz * dz > 64) { c.x = t.pos.x; c.z = t.pos.z; c.since = st.time; }
    }
  }

  function centroid(list) {
    let x = 0, z = 0;
    for (let i = 0; i < list.length; i++) { x += list[i].pos.x; z += list[i].pos.z; }
    const n = Math.max(1, list.length);
    return { x: x / n, z: z / n };
  }

  function isWaterAt(x, z) {
    const Tr = GM.Terrain;
    if (Tr && typeof Tr.isWater === 'function') {
      try { return !!Tr.isWater(x, z); } catch (err) { return false; }
    }
    return false;
  }

  /** A dry point close to (x, z), clamped inside the arena. */
  function landNear(x, z) {
    let p = clampArena(x, z, 8);
    if (!isWaterAt(p.x, p.z)) return p;
    for (let k = 0; k < 10; k++) {
      const a = GM.R.angle();
      const r = 6 + k * 3;
      const q = clampArena(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r, 8);
      if (!isWaterAt(q.x, q.z)) return q;
    }
    return p;
  }

  /** Biggest group of tributes within r of one member (>= minSize), or null. */
  function findGroup(alive, r, minSize) {
    const r2 = r * r;
    let best = null, bestN = minSize - 1;
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      let n = 0;
      for (let j = 0; j < alive.length; j++) {
        if (i === j) continue;
        const b = alive[j];
        const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
        if (dx * dx + dz * dz <= r2) n++;
      }
      if (n >= bestN) { bestN = n; best = a; }
    }
    if (!best) return null;
    const members = [];
    for (let j = 0; j < alive.length; j++) {
      const b = alive[j];
      const dx = best.pos.x - b.pos.x, dz = best.pos.z - b.pos.z;
      if (dx * dx + dz * dz <= r2) members.push(b);
    }
    const c = centroid(members);
    return { x: c.x, z: c.z, n: members.length };
  }

  /** The tribute that stayed in one spot the longest (>= 45 s), or null. */
  function findCamper(alive) {
    const now = GM.state.time;
    let best = null, bestT = 45;
    for (let i = 0; i < alive.length; i++) {
      const t = alive[i];
      const c = campers[t.id];
      if (!c) continue;
      const dur = now - c.since;
      if (dur >= bestT && !t.inWater) { bestT = dur; best = t; }
    }
    return best;
  }

  /** The loneliest tribute and its nearest neighbour when they are far apart. */
  function findLonerPair(alive) {
    let best = null, bestMate = null, bestD = 45;
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      let nd = Infinity, mate = null;
      for (let j = 0; j < alive.length; j++) {
        if (i === j) continue;
        const b = alive[j];
        const d = U.distXZ(a.pos, b.pos);
        if (d < nd) { nd = d; mate = b; }
      }
      if (mate && nd > bestD && nd < 170) { bestD = nd; best = a; bestMate = mate; }
    }
    return best ? [best, bestMate] : null;
  }

  /** Pick and use the best fitting power. Returns its id or null. */
  function autoAct() {
    const st = GM.state;
    const alive = livingTributes();
    if (alive.length < 2) return null;
    const cands = [];
    function add(id, target, option, score) {
      cands.push({ id: id, target: target, option: option, score: score + GM.R.range(0, 0.8) });
    }
    const H = GM.Hazards;
    const zone = H && H.zone;

    // few remain: close the force field around them
    if (alive.length <= 4 && zone && !zone.shrinking && (zone.radius || CFG.ARENA_RADIUS) > 60) {
      add('shrink_zone', centroid(alive), null, 9);
    }
    // late in the Games: a feast pulls everyone together
    if (st.day >= 2 && !feastUsed && alive.length >= 4) add('feast', null, null, 8);
    else if (st.day >= 3 && alive.length >= 3) add('feast', null, null, 4);
    // groups: mutts and hazards next to them
    const grp = findGroup(alive, 24, 3);
    if (grp) {
      const a = GM.R.angle();
      add('mutts', landNear(grp.x + Math.sin(a) * 16, grp.z + Math.cos(a) * 16), null, 7);
      add('wasps', landNear(grp.x + Math.sin(a) * 8, grp.z + Math.cos(a) * 8), null, 5);
      add('fireball', clampArena(grp.x + Math.sin(a + 1) * 10, grp.z + Math.cos(a + 1) * 10, 6), null, 4);
    }
    // campers: a lightning strike next to them gets them moving
    const camper = findCamper(alive);
    if (camper) {
      const a = GM.R.angle();
      add('lightning', clampArena(camper.pos.x + Math.sin(a) * 4.5, camper.pos.z + Math.cos(a) * 4.5, 3), null, 6.5);
    }
    // two loners: a supply drop or a lure between them makes them meet
    const pair = findLonerPair(alive);
    if (pair) {
      const mid = landNear((pair[0].pos.x + pair[1].pos.x) / 2, (pair[0].pos.z + pair[1].pos.z) / 2);
      add('supply_drop', mid, null, 6);
      add('lure', mid, null, 4.5);
    }
    // change the mood of the arena
    const E = GM.Env;
    if (E && (!E.weather || E.weather === 'clear')) add('weather', null, GM.R.pick(['storm', 'fog', 'fog', 'rain']), 3);
    add('reveal', null, null, alive.length <= 8 ? 5 : 2.5);

    cands.sort(function (a, b) { return b.score - a.score; });
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (!Powers.canUse(c.id).ok) continue;
      if (Powers.use(c.id, c.target, c.option, { auto: true })) return c.id;
    }
    return null;
  }

  function autoUpdate(dt) {
    const st = GM.state;
    if (!AutoGM.enabled) { AutoGM.state = 'off'; AutoGM.boredFor = 0; return; }
    if (st.phase !== 'running') { AutoGM.state = 'idle'; AutoGM.boredFor = 0; return; }
    trackCampers(dt);
    if (Audience.excitement < AUTO_BORED) AutoGM.boredFor += dt;
    else AutoGM.boredFor = Math.max(0, AutoGM.boredFor - dt * 2);
    const recent = AutoGM.lastAction && st.time - AutoGM.lastAction.time < 6;
    if (AutoGM.state !== 'noEnergy' || AutoGM.boredFor < AUTO_WAIT) {
      AutoGM.state = recent ? 'acted' : AutoGM.boredFor > 5 ? 'soon' : 'idle';
    }
    if (AutoGM.boredFor < AUTO_WAIT || st.time - autoLastTime < AUTO_GAP || st.time < autoNextTry) return;
    autoNextTry = st.time + 4;
    const id = autoAct();
    if (id) {
      autoLastTime = st.time;
      AutoGM.boredFor = 0;
      AutoGM.actions++;
      AutoGM.lastAction = { id: id, time: st.time };
      AutoGM.state = 'acted';
      GM.emit('autogm:acted', { id: id });
    } else {
      AutoGM.state = 'noEnergy';
    }
  }

  function clearAuto() {
    AutoGM.boredFor = 0;
    AutoGM.actions = 0;
    AutoGM.lastAction = null;
    AutoGM.state = AutoGM.enabled ? 'idle' : 'off';
    autoLastTime = -999;
    autoNextTry = 0;
    camperAcc = 0;
    for (const k in campers) delete campers[k];
  }

  // ================================================================ SYSTEM
  GM.registerSystem({
    name: 'Powers',
    order: 80,

    init() {
      buildVisuals();   // World (order 20) normally has its scene by now; else built lazily
      GM.on('tribute:died', onDied);
      GM.on('combat:attack', onAttack);
      GM.on('power:used', onPowerUsed);
      GM.on('alliance:broken', onAllianceBroken);
      GM.on('alliance:formed', onAllianceFormed);
      GM.on('mind:snap', function () { if (live()) Audience.add(8, 'audience.reason.madness'); });
      GM.on('trap:triggered', function () { if (live()) Audience.add(8, 'audience.reason.trap'); });
      GM.on('mutt:died', function (e) {
        if (!live() || !e || !e.killer) return;
        Audience.add(6, 'audience.reason.mutt');
        bumpPopularity(e.killer, 0.05);
      });
      GM.on('gift:sent', function (e) { if (e && e.tribute) bumpPopularity(e.tribute, 0.01); });
      GM.on('feast:ready', function () { if (live()) Audience.add(15, 'audience.reason.feast'); });
      GM.on('zone:shrink', function () { if (live()) Audience.add(6, 'audience.reason.zone'); });
      GM.on('hazard:quake', function () { if (live()) lastEventTime = GM.state.time; });
      GM.on('game:start', function () {
        Audience.excitement = Math.max(Audience.excitement, 55);
        Audience.add(20, 'audience.reason.bloodbath');
        trendRef = Audience.excitement;
        pushSample();
      });
      GM.on('game:end', function (e) {
        const w = e && e.winner;
        if (w) {
          Audience.add(35, 'audience.reason.victor');
          bumpPopularity(w, 0.25);
        }
        pushSample();
        emitAudience();
      });
      GM.on('terrain:changed', function () { aim.dirty = true; });
      GM.on('water:changed', function () { aim.dirty = true; });
    },

    clear() {
      clearPowers();
      clearAudience();
      clearAuto();
      emitAudience();
    },

    reset(s) {
      clearPowers();
      clearAudience();
      AutoGM.enabled = !!(s && s.autoGM);
      clearAuto();
      Powers.energy = s && s.sandbox ? MAX_ENERGY : START_ENERGY;
      initPopularity();
      Audience.viewers = viewersTarget();
      Audience.peakViewers = Audience.viewers;
      emitAudience();
    },

    update(dt) {
      updatePowers(dt);
      updateAudience(dt);
      autoUpdate(dt);
    },

    frame(realDt) {
      frameVisuals(realDt);
      emitAcc += realDt;
      if (emitAcc >= 1) {
        emitAcc = 0;
        const ph = GM.state.phase;
        if (ph === 'countdown' || ph === 'running' || ph === 'ended') emitAudience();
      }
    },
  });
})();
