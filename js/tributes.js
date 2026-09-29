/* ==========================================================================
 * tributes.js — GM.Tributes: roster, tribute objects, low-poly animated
 * meshes, locomotion (budgeted A* path queue + steering), needs, status
 * effects, damage / death / kill credit and the hovercraft body pickup.
 *
 *   generateRoster(count, mix, seed)   spawnAll(roster)
 *   get / alive / aliveCount / nearest / inRadius
 *   damage / kill / heal / stun / knockback / setStatus / setSleeping
 *   moveTo / stop / faceToward / arrived
 *   consume / drink / forage
 *   extras: flash, playAttack, gesture, refreshGear, statusList, speedOf,
 *           headPos, canAct, list
 *
 * Tribute rig (<= 10 meshes): torso (+ vest, backpack, back weapon), head
 * (skin + hair baked in one vertex-coloured geometry), 2 arms, 2 legs and a
 * held weapon. Name tag + status icon are sprites whose size is adjusted per
 * camera in onBeforeRender so they stay readable at any distance.
 *
 * Owner: TRIBUTES.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const CFG = GM.CFG;
  const TAU = Math.PI * 2;
  const HP = Math.PI / 2;

  // ================================================================ strings
  GM.i18n.add({
    en: {
      'tribute.interest.death': '{name} has fallen',
      'tribute.interest.fight': '{a} vs {b}',
      'tribute.interest.body': 'A hovercraft takes {name}',
      'tribute.hovercraft': 'Hovercraft',
      'tribute.gender.f': 'Girl',
      'tribute.gender.m': 'Boy',
      'tribute.placement': '#{n}',
      'tribute.ammo': 'Ammo: {n}',
      'tribute.stat.health': 'Health',
      'tribute.stat.stamina': 'Stamina',
      'tribute.stat.hunger': 'Hunger',
      'tribute.stat.thirst': 'Thirst',
      'tribute.stat.energy': 'Energy',
      'tribute.stat.kills': 'Kills',
      'tribute.stat.damage': 'Damage dealt',

      'status.stun': 'Stunned',
      'status.poison': 'Poisoned',
      'status.madness': 'Mad',
      'status.panic': 'Panic',
      'status.burning': 'Burning',
      'status.stung': 'Stung',
      'status.bleeding': 'Bleeding',
      'status.asleep': 'Asleep',
      'status.swimming': 'Swimming',
      'status.drowning': 'Drowning',
      'status.cold': 'Freezing',
      'status.starving': 'Starving',
      'status.thirsty': 'Very thirsty',
      'status.exhausted': 'Exhausted',
      'status.hidden': 'Hidden',
      'status.sneaking': 'Sneaking',
      'status.healing': 'Healing',
      'status.armored': 'Armor',
      'status.stun.desc': 'Cannot move or fight.',
      'status.poison.desc': 'Loses health. A medical kit helps.',
      'status.madness.desc': 'Sees enemies everywhere and attacks anyone.',
      'status.panic.desc': 'Runs away from everything.',
      'status.burning.desc': 'On fire! Water puts it out.',
      'status.stung.desc': 'Tracker jacker poison. Sees strange things.',
      'status.bleeding.desc': 'Loses health. A medical kit stops it.',
      'status.asleep.desc': 'Sleeping. Easy to attack.',
      'status.swimming.desc': 'Swimming uses a lot of stamina.',
      'status.drowning.desc': 'No stamina left in the water!',
      'status.cold.desc': 'The cold hurts at night. A sleeping bag helps.',
      'status.starving.desc': 'Loses health because of hunger.',
      'status.thirsty.desc': 'Loses health because of thirst.',
      'status.exhausted.desc': 'Too tired. Moves slowly.',
      'status.hidden.desc': 'Hard to see.',
      'status.sneaking.desc': 'Moves quietly.',
      'status.healing.desc': 'A medical kit is working.',
      'status.armored.desc': 'Takes less damage.',

      'log.death.fire.1': '{victim} burned to death.',
      'log.death.fire.2': '{victim} could not escape the fire.',
      'log.death.fireball.1': 'A fireball hit {victim}.',
      'log.death.fireball.2': '{victim} died in the rain of fire.',
      'log.death.explosion.1': '{victim} died in an explosion.',
      'log.death.lightning.1': 'Lightning struck {victim}.',
      'log.death.lightning.2': '{victim} died in the storm.',
      'log.death.mutt.1': 'The mutts killed {victim}.',
      'log.death.mutt.2': 'The wolves caught {victim}.',
      'log.death.wasps.1': '{victim} died from tracker jacker stings.',
      'log.death.gas.1': '{victim} died in the poison fog.',
      'log.death.gas.2': '{victim} could not get out of the poison fog.',
      'log.death.drown.1': '{victim} drowned.',
      'log.death.drown.2': '{victim} was too tired to swim and drowned.',
      'log.death.starve.1': '{victim} starved to death.',
      'log.death.thirst.1': '{victim} died of thirst.',
      'log.death.cold.1': '{victim} froze to death.',
      'log.death.cold.2': 'The cold night killed {victim}.',
      'log.death.forcefield.1': 'The force field killed {victim}.',
      'log.death.forcefield.2': '{victim} was too slow to escape the force field.',
      'log.death.trap.1': '{victim} died in a trap.',
      'log.death.poison.1': '{victim} ate poison berries and died.',
      'log.death.quake.1': '{victim} died in the earthquake.',
      'log.death.fall.1': '{victim} fell and died.',
      'log.death.smite.1': 'The Game Master struck down {victim}.',
      'log.death.weapon.1': '{victim} bled to death.',
      'log.death.fists.1': '{victim} died from the beating.',
      'log.death.unknown.1': '{victim} died.',

      'log.kill.melee.1': '{killer} killed {victim} with {weapon}.',
      'log.kill.melee.2': '{killer} struck down {victim} with {weapon}.',
      'log.kill.melee.3': '{victim} lost the fight against {killer} ({weapon}).',
      'log.kill.melee.4': '{killer} finished off {victim} with {weapon}.',
      'log.kill.bow.1': '{killer} shot {victim} with an arrow.',
      'log.kill.bow.2': '{killer} hit {victim} with a deadly arrow from far away.',
      'log.kill.thrown.1': '{killer} killed {victim} with a thrown knife.',
      'log.kill.fists.1': '{killer} killed {victim} with bare hands.',
      'log.kill.fists.2': '{killer} killed {victim} in a fist fight.',
      'log.kill.sleep.1': '{killer} killed {victim} in their sleep.',
      'log.kill.sneak.1': '{killer} attacked {victim} by surprise and killed them.',
      'log.kill.bleed.1': '{victim} bled to death. {killer} made the wound.',
      'log.kill.trap.1': '{victim} died in a trap set by {killer}.',
      'log.kill.env.1': '{victim} died ({cause}). The kill goes to {killer}.',
      'log.kill.env.2': '{victim} ran from {killer} and died ({cause}).',
      'log.kill.firstBlood': 'First blood!',
      'log.kill.streak': '{killer} has {n} kills now.',
      'log.kill.revenge': '{killer} took revenge for {partner}.',
      'log.kill.partner': '{killer} killed {victim}, a tribute from the same district!',
    },
    hu: {
      'tribute.interest.death': 'Elesett: {name}',
      'tribute.interest.fight': '{a} – {b}',
      'tribute.interest.body': 'A légpárnás elviszi: {name}',
      'tribute.hovercraft': 'Légpárnás',
      'tribute.gender.f': 'Lány',
      'tribute.gender.m': 'Fiú',
      'tribute.placement': '{n}. hely',
      'tribute.ammo': 'Lőszer: {n}',
      'tribute.stat.health': 'Életerő',
      'tribute.stat.stamina': 'Állóképesség',
      'tribute.stat.hunger': 'Éhség',
      'tribute.stat.thirst': 'Szomjúság',
      'tribute.stat.energy': 'Energia',
      'tribute.stat.kills': 'Ölések',
      'tribute.stat.damage': 'Okozott sebzés',

      'status.stun': 'Kábult',
      'status.poison': 'Mérgezett',
      'status.madness': 'Megőrült',
      'status.panic': 'Pánikban',
      'status.burning': 'Ég',
      'status.stung': 'Megcsípték',
      'status.bleeding': 'Vérzik',
      'status.asleep': 'Alszik',
      'status.swimming': 'Úszik',
      'status.drowning': 'Fuldoklik',
      'status.cold': 'Fagyoskodik',
      'status.starving': 'Éhezik',
      'status.thirsty': 'Nagyon szomjas',
      'status.exhausted': 'Kimerült',
      'status.hidden': 'Rejtőzik',
      'status.sneaking': 'Lopakodik',
      'status.healing': 'Gyógyul',
      'status.armored': 'Páncél',
      'status.stun.desc': 'Nem tud mozogni és harcolni.',
      'status.poison.desc': 'Életerőt veszít. Az elsősegélycsomag segít.',
      'status.madness.desc': 'Mindenhol ellenséget lát, és bárkit megtámad.',
      'status.panic.desc': 'Mindenki elől elfut.',
      'status.burning.desc': 'Lángol! A víz eloltja.',
      'status.stung.desc': 'Vérdarázsméreg. Furcsa dolgokat lát.',
      'status.bleeding.desc': 'Életerőt veszít. Az elsősegélycsomag megállítja.',
      'status.asleep.desc': 'Alszik. Könnyű megtámadni.',
      'status.swimming.desc': 'Az úszás nagyon fárasztó.',
      'status.drowning.desc': 'Elfogyott az ereje a vízben!',
      'status.cold.desc': 'Éjjel árt a hideg. A hálózsák segít.',
      'status.starving.desc': 'Az éhség miatt életerőt veszít.',
      'status.thirsty.desc': 'A szomjúság miatt életerőt veszít.',
      'status.exhausted.desc': 'Túl fáradt. Lassan mozog.',
      'status.hidden.desc': 'Nehéz észrevenni.',
      'status.sneaking.desc': 'Csendben mozog.',
      'status.healing.desc': 'Hat az elsősegélycsomag.',
      'status.armored.desc': 'Kevesebb sebzést kap.',

      'log.death.fire.1': '{victim} halálra égett.',
      'log.death.fire.2': '{victim} nem tudott elmenekülni a tűz elől.',
      'log.death.fireball.1': 'Tűzgolyó találta el: {victim}.',
      'log.death.fireball.2': '{victim} meghalt a tűzesőben.',
      'log.death.explosion.1': '{victim} meghalt egy robbanásban.',
      'log.death.lightning.1': 'Villám sújtotta: {victim}.',
      'log.death.lightning.2': '{victim} meghalt a viharban.',
      'log.death.mutt.1': 'A mutánsok megölték: {victim}.',
      'log.death.mutt.2': 'A farkasok elkapták: {victim}.',
      'log.death.wasps.1': '{victim} belehalt a vérdarázscsípésekbe.',
      'log.death.gas.1': '{victim} meghalt a mérges ködben.',
      'log.death.gas.2': '{victim} nem jutott ki a mérges ködből.',
      'log.death.drown.1': '{victim} vízbe fulladt.',
      'log.death.drown.2': '{victim} túl fáradt volt az úszáshoz, és vízbe fulladt.',
      'log.death.starve.1': '{victim} éhen halt.',
      'log.death.thirst.1': '{victim} szomjan halt.',
      'log.death.cold.1': '{victim} halálra fagyott.',
      'log.death.cold.2': 'A hideg éjszaka megölte: {victim}.',
      'log.death.forcefield.1': 'Az erőtér megölte: {victim}.',
      'log.death.forcefield.2': '{victim} túl lassú volt, és az erőtér utolérte.',
      'log.death.trap.1': '{victim} csapdában halt meg.',
      'log.death.poison.1': '{victim} mérges bogyót evett, és meghalt.',
      'log.death.quake.1': '{victim} meghalt a földrengésben.',
      'log.death.fall.1': '{victim} lezuhant, és meghalt.',
      'log.death.smite.1': 'A Játékmester lesújtott: {victim}.',
      'log.death.weapon.1': '{victim} elvérzett.',
      'log.death.fists.1': '{victim} belehalt a verésbe.',
      'log.death.unknown.1': '{victim} meghalt.',

      'log.kill.melee.1': '{killer} megölte: {victim} ({weapon}).',
      'log.kill.melee.2': '{killer} leterítette: {victim} ({weapon}).',
      'log.kill.melee.3': '{victim} elvesztette a harcot. Győztes: {killer} ({weapon}).',
      'log.kill.melee.4': '{killer} végzett vele: {victim} ({weapon}).',
      'log.kill.bow.1': '{killer} lelőtte egy nyíllal: {victim}.',
      'log.kill.bow.2': '{killer} messziről, halálos nyíllal eltalálta: {victim}.',
      'log.kill.thrown.1': '{killer} egy dobókéssel megölte: {victim}.',
      'log.kill.fists.1': '{killer} puszta kézzel megölte: {victim}.',
      'log.kill.fists.2': '{killer} ökölharcban megölte: {victim}.',
      'log.kill.sleep.1': '{victim} álmában halt meg. Gyilkos: {killer}.',
      'log.kill.sneak.1': '{killer} rajtaütött, és megölte: {victim}.',
      'log.kill.bleed.1': '{victim} elvérzett. A sebet {killer} ejtette.',
      'log.kill.trap.1': '{victim} meghalt egy csapdában. A csapdát {killer} állította.',
      'log.kill.env.1': '{victim} meghalt ({cause}). A pontot {killer} kapja.',
      'log.kill.env.2': '{victim} menekült előle: {killer}. Meghalt ({cause}).',
      'log.kill.firstBlood': 'Az első vér!',
      'log.kill.streak': '{killer} már {n} ellenfelet ölt meg.',
      'log.kill.revenge': '{killer} bosszút állt {partner} haláláért.',
      'log.kill.partner': '{killer} megölte: {victim}. Ugyanabból a körzetből jöttek!',
    },
  });
  // number of variants per message family (keys end in .1 .. .n)
  const VARIANTS = {
    'log.death.fire': 2, 'log.death.fireball': 2, 'log.death.explosion': 1, 'log.death.lightning': 2,
    'log.death.mutt': 2, 'log.death.wasps': 1, 'log.death.gas': 2, 'log.death.drown': 2,
    'log.death.starve': 1, 'log.death.thirst': 1, 'log.death.cold': 2, 'log.death.forcefield': 2,
    'log.death.trap': 1, 'log.death.poison': 1, 'log.death.quake': 1, 'log.death.fall': 1,
    'log.death.smite': 1, 'log.death.weapon': 1, 'log.death.fists': 1, 'log.death.unknown': 1,
    'log.kill.melee': 4, 'log.kill.bow': 2, 'log.kill.thrown': 1, 'log.kill.fists': 2, 'log.kill.sleep': 1,
    'log.kill.sneak': 1, 'log.kill.bleed': 1, 'log.kill.trap': 1, 'log.kill.env': 2,
  };
  function variant(base) {
    const n = VARIANTS[base] || 1;
    return base + '.' + (1 + Math.floor(Math.random() * n));
  }

  // ================================================================= names
  const F_NAMES = [
    'Mara', 'Lina', 'Nia', 'Zoe', 'Iris', 'Ava', 'Maya', 'Leah', 'Tess', 'Nora', 'Ella', 'Ruby', 'Luna',
    'Ivy', 'Clara', 'Sofia', 'Emma', 'Hana', 'Yuki', 'Mei', 'Aiko', 'Priya', 'Asha', 'Zara', 'Leila',
    'Amira', 'Noor', 'Ayla', 'Elif', 'Olga', 'Katya', 'Mila', 'Vera', 'Ingrid', 'Freya', 'Astrid', 'Greta',
    'Lucia', 'Carmen', 'Rosa', 'Ines', 'Paloma', 'Chloe', 'Amelie', 'Nadia', 'Imani', 'Zuri', 'Amara',
    'Kaia', 'Talia', 'Naomi', 'Esme', 'Aria', 'Kira', 'Selin', 'Anna', 'Réka', 'Zsófi', 'Eszter', 'Dóra',
    'Lili', 'Petra',
  ];
  const M_NAMES = [
    'Leo', 'Finn', 'Kai', 'Max', 'Theo', 'Owen', 'Liam', 'Noah', 'Eli', 'Jack', 'Sam', 'Ben', 'Luca',
    'Marco', 'Diego', 'Mateo', 'Pablo', 'Rafael', 'Hugo', 'Felix', 'Oscar', 'Emil', 'Anton', 'Ivan',
    'Nikolai', 'Dmitri', 'Pavel', 'Lars', 'Sven', 'Erik', 'Björn', 'Omar', 'Karim', 'Tariq', 'Yusuf',
    'Emre', 'Deniz', 'Arjun', 'Ravi', 'Kenji', 'Haru', 'Jin', 'Wei', 'Tomas', 'Jonas', 'Milo', 'Rhys',
    'Declan', 'Kofi', 'Tunde', 'Malik', 'Jabari', 'Andre', 'Silas', 'Jude', 'Reza', 'Bence', 'Levente',
    'Máté', 'Gergő', 'Zsolt', 'Ádám',
  ];

  const ARCH_IDS = ['career', 'survivor', 'scavenger', 'opportunist', 'strategist', 'berserker', 'protector', 'lonewolf'];
  const MIX_WEIGHTS = {
    balanced: { career: 1.25, survivor: 1, scavenger: 1, opportunist: 1, strategist: 1, berserker: 0.9, protector: 1, lonewolf: 0.9 },
    bloodthirsty: { career: 3, survivor: 0.6, scavenger: 0.5, opportunist: 1.2, strategist: 1, berserker: 2.5, protector: 0.5, lonewolf: 2 },
    peaceful: { career: 0.5, survivor: 3, scavenger: 2.5, opportunist: 0.8, strategist: 1.2, berserker: 0.3, protector: 2.5, lonewolf: 0.5 },
    chaos: { career: 1, survivor: 1, scavenger: 1, opportunist: 1, strategist: 1, berserker: 1, protector: 1, lonewolf: 1 },
  };
  // fallback personality when the AI module is missing (SPEC 9.1)
  const FALLBACK_TRAITS = {
    career: [0.85, 0.8, 0.5, 0.6, 0.45, 0.5, 0.4, 0.6],
    survivor: [0.2, 0.5, 0.4, 0.4, 0.6, 0.6, 0.8, 0.75],
    scavenger: [0.15, 0.2, 0.9, 0.35, 0.4, 0.6, 0.6, 0.55],
    opportunist: [0.55, 0.45, 0.6, 0.4, 0.2, 0.9, 0.7, 0.6],
    strategist: [0.4, 0.55, 0.45, 0.45, 0.6, 0.85, 0.9, 0.85],
    berserker: [0.95, 0.9, 0.4, 0.3, 0.35, 0.3, 0.2, 0.2],
    protector: [0.35, 0.7, 0.3, 0.85, 0.95, 0.5, 0.6, 0.75],
    lonewolf: [0.7, 0.7, 0.4, 0.05, 0.3, 0.7, 0.75, 0.7],
  };
  const TRAIT_NAMES = ['aggression', 'bravery', 'greed', 'sociability', 'loyalty', 'cunning', 'patience', 'stability'];
  const FALLBACK_SKILL_BIAS = {
    career: { strength: 0.2, aim: 0.1 }, survivor: { survival: 0.25, stealth: 0.1 }, scavenger: { speed: 0.15, stealth: 0.1 },
    opportunist: { stealth: 0.1, aim: 0.1 }, strategist: { survival: 0.1, aim: 0.1 }, berserker: { strength: 0.2, speed: 0.05 },
    protector: { strength: 0.1, survival: 0.1 }, lonewolf: { stealth: 0.25, aim: 0.15 },
  };

  function archIds() {
    return Array.isArray(GM.ARCHETYPE_IDS) && GM.ARCHETYPE_IDS.length ? GM.ARCHETYPE_IDS : ARCH_IDS;
  }

  /** Seeded RNG object with the same API as GM.R (for roster generation). */
  function makeRng(seed) {
    const f = GM.makeRng(seed >>> 0);
    const r = {
      seed: function () {},
      random: f,
      range: function (a, b) { return a + (b - a) * f(); },
      int: function (a, b) { return a + Math.floor((b - a + 1) * f()); },
      chance: function (p) { return f() < p; },
      pick: function (arr) { return arr.length ? arr[Math.floor(f() * arr.length)] : undefined; },
      angle: function () { return f() * TAU; },
      shuffle: function (arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(f() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
      gauss: function (mean, sd) {
        let u = 0, v = 0;
        while (u === 0) u = f();
        while (v === 0) v = f();
        return (mean || 0) + (sd === undefined ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
      },
      weighted: function (entries) {
        const list = Array.isArray(entries) ? entries : Object.entries(entries);
        let total = 0;
        for (let i = 0; i < list.length; i++) total += Math.max(0, list[i][1]);
        if (total <= 0) return list.length ? list[0][0] : undefined;
        let x = f() * total;
        for (let i = 0; i < list.length; i++) {
          x -= Math.max(0, list[i][1]);
          if (x <= 0) return list[i][0];
        }
        return list[list.length - 1][0];
      },
    };
    return r;
  }

  function localPickArchetypes(n, mix, rng) {
    const w = MIX_WEIGHTS[mix] || MIX_WEIGHTS.balanced;
    const out = [];
    if (mix === 'balanced') {
      // even spread: shuffled bags of all archetypes, careers capped at ~15 %
      const maxCareers = Math.max(1, Math.round(n * 0.15));
      let careers = 0;
      while (out.length < n) {
        const bag = rng.shuffle(ARCH_IDS.slice());
        for (let i = 0; i < bag.length && out.length < n; i++) {
          if (bag[i] === 'career') { if (careers >= maxCareers) continue; careers++; }
          out.push(bag[i]);
        }
      }
      return out;
    }
    for (let i = 0; i < n; i++) out.push(rng.weighted(w));
    return out;
  }

  const Tributes = (GM.Tributes = {});

  /**
   * Build a roster: 2 tributes per district (girl, boy), unique names,
   * archetypes from GM.AI.pickArchetypes (local fallback). Careers are
   * placed in the classic career districts (1, 2, 4) first.
   */
  Tributes.generateRoster = function (count, mix, seed) {
    count = U.clamp((count | 0) || CFG.DEFAULT_TRIBUTES, CFG.MIN_TRIBUTES, CFG.MAX_TRIBUTES);
    mix = MIX_WEIGHTS[mix] ? mix : 'balanced';
    const rng = makeRng(((seed >>> 0) ^ 0x9e3779b9) >>> 0);
    let archs = null;
    if (GM.AI && typeof GM.AI.pickArchetypes === 'function') {
      try { archs = GM.AI.pickArchetypes(count, mix, rng); } catch (err) { GM.reportError('Tributes.pickArchetypes', err); archs = null; }
    }
    const valid = archIds();
    if (!Array.isArray(archs) || archs.length < count) archs = localPickArchetypes(count, mix, rng);
    archs = archs.slice(0, count).map(function (a) { return valid.indexOf(a) >= 0 ? a : rng.pick(valid); });

    // careers prefer districts 1, 2 and 4
    const pref = [0, 1, 2, 3, 6, 7].filter(function (i) { return i < count; });
    const careers = archs.filter(function (a) { return a === 'career'; });
    const others = archs.filter(function (a) { return a !== 'career'; });
    const slots = new Array(count).fill(null);
    for (let i = 0; i < pref.length && careers.length; i++) slots[pref[i]] = careers.shift();
    for (let i = 0; i < count; i++) {
      if (slots[i]) continue;
      slots[i] = others.length ? others.shift() : careers.shift();
    }

    const fNames = rng.shuffle(F_NAMES.slice());
    const mNames = rng.shuffle(M_NAMES.slice());
    let fi = 0, mi = 0;
    const roster = [];
    for (let i = 0; i < count; i++) {
      const gender = i % 2 === 0 ? 'f' : 'm';
      let name;
      if (gender === 'f') name = fi < fNames.length ? fNames[fi++] : 'Tribute ' + (i + 1);
      else name = mi < mNames.length ? mNames[mi++] : 'Tribute ' + (i + 1);
      roster.push({ name: name, district: Math.floor(i / 2) + 1, gender: gender, archetype: slots[i] || 'survivor' });
    }
    return roster;
  };

  // ============================================================ constants
  const SPEEDS = { walk: 2.2, run: 5, sprint: 6.5, sneak: 1.4 };
  const SWIM_SPEED = 1.7;
  const SWIM_DEPTH = 1.2;
  const WADE_DEPTH = 0.25;
  const RADIUS = 0.45;
  const LEG = 0.9;                 // hip height
  const MAX_PATHS_PER_STEP = 4;
  const MAX_PATHS_PER_FRAME = 8;
  const DIRECT_RANGE = 14;
  const KILL_CREDIT_WINDOW = 8;
  const BODY_PICKUP_DELAY = 25;
  const DAY = CFG.DAY_LENGTH;
  const HUNGER_RATE = 100 / (2.5 * DAY);
  const THIRST_RATE = 100 / (1.5 * DAY);
  const ENERGY_DRAIN = 100 / (1.2 * DAY);
  const SLEEP_GAIN = 100 / (0.3 * DAY);
  const ARMOR_CAUSES = { weapon: 1, fists: 1, mutt: 1, explosion: 1, fireball: 1, trap: 1 };
  const DIRECT_CAUSES = { weapon: 1, fists: 1 };
  const STATUS_NAMES = ['stun', 'poison', 'madness', 'panic', 'burning', 'stung', 'bleeding'];

  const SKIN = [0xf1c7a5, 0xe3b08a, 0xc98d64, 0xa86c45, 0x7f4c2d, 0x5b3622];
  const HAIR = [0x1d1815, 0x3b2518, 0x6a4128, 0xa8612f, 0xd8b56a, 0x8c8c8c, 0x9e2f1c];
  const PANTS = [0x2e3440, 0x3b3a34, 0x2b3a2f, 0x40362c, 0x1f2a3a];

  // ============================================================== helpers
  function hasThree() { return typeof THREE !== 'undefined'; }
  function Ter() { return GM.Terrain; }
  function groundY(x, z) {
    const t = Ter();
    if (t && typeof t.heightAt === 'function') {
      const y = t.heightAt(x, z);
      if (y === y) return y;
    }
    return 0;
  }
  function waterY() {
    const t = Ter();
    if (t && typeof t.waterLevel === 'function') {
      const y = t.waterLevel();
      if (y === y) return y;
    }
    return GM.Env && typeof GM.Env.waterLevel === 'number' ? GM.Env.waterLevel : CFG.BASE_WATER_LEVEL;
  }
  function waterDepth(x, z) {
    const t = Ter();
    if (t && typeof t.waterDepth === 'function') {
      const d = t.waterDepth(x, z);
      return d === d ? d : 0;
    }
    return Math.max(0, waterY() - groundY(x, z));
  }
  function isWater(x, z) {
    const t = Ter();
    if (t && typeof t.isWater === 'function') return !!t.isWater(x, z);
    return waterY() > groundY(x, z);
  }
  function slopeAt(x, z) {
    const t = Ter();
    if (t && typeof t.slopeAt === 'function') {
      const s = t.slopeAt(x, z);
      return s === s ? s : 0;
    }
    return 0;
  }
  function walkable(x, z) {
    const t = Ter();
    if (t && typeof t.walkable === 'function') {
      try { return !!t.walkable(x, z); } catch (e) { return true; }
    }
    return Math.sqrt(x * x + z * z) < CFG.ARENA_RADIUS - 1;
  }
  function biomeAt(x, z) {
    const t = Ter();
    if (t && typeof t.biomeAt === 'function') {
      try { return t.biomeAt(x, z); } catch (e) { return 'grass'; }
    }
    return 'grass';
  }
  function forestAt(x, z) {
    const t = Ter();
    if (t && typeof t.forestAt === 'function') {
      try { return t.forestAt(x, z) || 0; } catch (e) { return 0; }
    }
    return 0;
  }
  function envCall(name, def) {
    const E = GM.Env;
    if (!E || typeof E[name] !== 'function') return def;
    try { return E[name](); } catch (e) { return def; }
  }
  function isNight() { return !!envCall('isNight', false); }
  function sfx(name, pos, volume, rate) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, { pos: pos, volume: volume == null ? 1 : volume, rate: rate || 1 }); } catch (err) { GM.reportError('Tributes.audio', err); }
  }
  function fx(method, a, b, c, d, e) {
    const F = GM.FX;
    if (!F || typeof F[method] !== 'function') return;
    try { F[method](a, b, c, d, e); } catch (err) { GM.reportError('Tributes.FX.' + method, err); }
  }
  function aiNoise(pos, radius, kind, src) {
    const AI = GM.AI;
    if (!AI || typeof AI.noise !== 'function') return;
    try { AI.noise(pos, radius, kind, src == null ? null : src); } catch (err) { GM.reportError('Tributes.noise', err); }
  }
  function num(v, d) { return typeof v === 'number' && v === v ? v : d; }
  function skill(t, name) { const s = t.skills; return s && typeof s[name] === 'number' ? s[name] : 0.5; }
  function now() { return GM.state.time; }

  // ================================================== geometry + materials
  let _m4, _q, _e, _p, _s, _c, _v1, _v2;
  function initTemps() {
    if (_m4) return;
    _m4 = new THREE.Matrix4(); _q = new THREE.Quaternion(); _e = new THREE.Euler();
    _p = new THREE.Vector3(); _s = new THREE.Vector3(); _c = new THREE.Color();
    _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3();
  }

  /** Merge parts [{g, c, p, r, s}] into one non-indexed geometry with vertex colours. */
  function mergeParts(parts) {
    initTemps();
    const list = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const g = part.g.index ? part.g.toNonIndexed() : part.g.clone();
      part.g.dispose();
      const r = part.r || [0, 0, 0], p = part.p || [0, 0, 0], s = part.s == null ? 1 : part.s;
      _e.set(r[0], r[1], r[2]);
      _q.setFromEuler(_e);
      _p.set(p[0], p[1], p[2]);
      if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
      _m4.compose(_p, _q, _s);
      g.applyMatrix4(_m4);
      list.push({ g: g, c: part.c, fn: part.fn || null });
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (let i = 0; i < list.length; i++) {
      const g = list[i].g, pa = g.attributes.position, na = g.attributes.normal;
      _c.set(list[i].c);
      for (let v = 0; v < pa.count; v++, o++) {
        const x = pa.getX(v), y = pa.getY(v), z = pa.getZ(v);
        pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z;
        if (na) { nor[o * 3] = na.getX(v); nor[o * 3 + 1] = na.getY(v); nor[o * 3 + 2] = na.getZ(v); }
        if (list[i].fn) {
          const k = list[i].fn(x, y, z);
          col[o * 3] = k; col[o * 3 + 1] = k; col[o * 3 + 2] = k;
        } else {
          col[o * 3] = _c.r; col[o * 3 + 1] = _c.g; col[o * 3 + 2] = _c.b;
        }
      }
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.computeBoundingSphere();
    return out;
  }

  const K = { geo: Object.create(null), mat: Object.create(null) };

  function kitGeo(key, build) {
    if (!K.geo[key]) K.geo[key] = build();
    return K.geo[key];
  }
  function kitMat(key, build) {
    if (!K.mat[key]) K.mat[key] = build();
    return K.mat[key];
  }
  function lambert(color, vc) {
    return new THREE.MeshLambertMaterial({ color: color, flatShading: true, vertexColors: !!vc });
  }
  /** District shirt material (vertex colours darken the belt/collar). */
  function shirtMat(district) {
    return kitMat('shirt' + district, function () { return lambert(GM.districtColor(district), true); });
  }
  function skinMat(i) { return kitMat('skin' + i, function () { return lambert(SKIN[i % SKIN.length], false); }); }
  function pantsMat(i) { return kitMat('pants' + i, function () { return lambert(PANTS[i % PANTS.length], true); }); }
  function vcMat() { return kitMat('vc', function () { return lambert(0xffffff, true); }); }
  function gearMat() {
    if (GM.Items && typeof GM.Items.material === 'function') {
      const m = GM.Items.material();
      if (m) return m;
    }
    return vcMat();
  }
  function flashMat() {
    return kitMat('flash', function () { return new THREE.MeshBasicMaterial({ color: 0xff8a7a }); });
  }

  function torsoGeo(female) {
    return kitGeo(female ? 'torsoF' : 'torsoM', function () {
      const w = female ? 0.185 : 0.2;
      return mergeParts([
        { g: new THREE.CylinderGeometry(w, female ? 0.165 : 0.17, 0.5, 7), c: 0xffffff, p: [0, 0.29, 0], s: [1, 1, 0.62] },
        { g: new THREE.CylinderGeometry(0.172, 0.172, 0.075, 7), c: 0x444444, p: [0, 0.04, 0], s: [1, 1, 0.66] },
        { g: new THREE.CylinderGeometry(0.075, 0.1, 0.06, 7), c: 0xd8d8d8, p: [0, 0.55, 0], s: [1, 1, 0.8] },
        { g: new THREE.SphereGeometry(0.085, 6, 4), c: 0xffffff, p: [w + 0.005, 0.47, 0] },
        { g: new THREE.SphereGeometry(0.085, 6, 4), c: 0xffffff, p: [-w - 0.005, 0.47, 0] },
      ]);
    });
  }
  function vestGeo() {
    return kitGeo('vest', function () {
      return mergeParts([
        { g: new THREE.CylinderGeometry(0.218, 0.19, 0.4, 7), c: 0x55623a, p: [0, 0.3, 0], s: [1, 1, 0.7] },
        { g: new THREE.BoxGeometry(0.13, 0.16, 0.04), c: 0x3b4528, p: [0.075, 0.33, 0.14] },
        { g: new THREE.BoxGeometry(0.13, 0.16, 0.04), c: 0x3b4528, p: [-0.075, 0.33, 0.14] },
        { g: new THREE.BoxGeometry(0.28, 0.2, 0.04), c: 0x3b4528, p: [0, 0.32, -0.145] },
      ]);
    });
  }
  function packGeo() {
    return kitGeo('pack', function () {
      return mergeParts([
        { g: new THREE.BoxGeometry(0.3, 0.36, 0.16), c: 0xe07b1f, p: [0, 0.18, 0] },
        { g: new THREE.BoxGeometry(0.22, 0.14, 0.05), c: 0xb35d12, p: [0, 0.12, -0.1] },
        { g: new THREE.BoxGeometry(0.31, 0.07, 0.17), c: 0xb35d12, p: [0, 0.34, 0] },
        { g: new THREE.CylinderGeometry(0.055, 0.055, 0.32, 6), c: 0x2f6b43, p: [0, 0.41, 0], r: [0, 0, HP] },
      ]);
    });
  }
  function armGeo() {
    return kitGeo('arm', function () {
      const g = new THREE.CapsuleGeometry(0.056, 0.48, 2, 6);
      g.translate(0, -0.296, 0);
      return g;
    });
  }
  function legGeo() {
    return kitGeo('leg', function () {
      return mergeParts([
        { g: new THREE.CapsuleGeometry(0.078, 0.72, 2, 6), c: 0xffffff, p: [0, -0.438, 0], fn: function (x, y) { return y < -0.7 ? 0.3 : 1; } },
        { g: new THREE.BoxGeometry(0.13, 0.08, 0.22), c: 0x4d4d4d, p: [0, -0.86, 0.04] },
      ]);
    });
  }
  /** Head + hair + face baked into one geometry per (skin, hair, style). */
  function headGeo(look) {
    const key = 'head' + look.skin + '_' + look.hair + '_' + look.style;
    return kitGeo(key, function () {
      const sk = SKIN[look.skin % SKIN.length];
      const hc = HAIR[look.hair % HAIR.length];
      const parts = [
        { g: new THREE.IcosahedronGeometry(0.125, 1), c: sk, p: [0, 0, 0], s: [0.95, 1.05, 1] },
        { g: new THREE.BoxGeometry(0.03, 0.05, 0.04), c: sk, p: [0, -0.015, 0.122] },
        { g: new THREE.BoxGeometry(0.026, 0.02, 0.012), c: 0x16181c, p: [0.045, 0.02, 0.113] },
        { g: new THREE.BoxGeometry(0.026, 0.02, 0.012), c: 0x16181c, p: [-0.045, 0.02, 0.113] },
        { g: new THREE.CylinderGeometry(0.05, 0.055, 0.08, 6), c: sk, p: [0, -0.14, -0.005] },
      ];
      const cap = function (r, thetaLen, y, z) {
        return { g: new THREE.SphereGeometry(r, 8, 4, 0, TAU, 0, thetaLen), c: hc, p: [0, y || 0.012, z || -0.012] };
      };
      switch (look.style) {
        case 'buzz': parts.push(cap(0.129, Math.PI * 0.38, 0.01, -0.01)); break;
        case 'short': parts.push(cap(0.136, Math.PI * 0.46)); break;
        case 'mop':
          parts.push(cap(0.142, Math.PI * 0.5));
          parts.push({ g: new THREE.BoxGeometry(0.2, 0.05, 0.05), c: hc, p: [0, 0.075, 0.1], r: [0.3, 0, 0] });
          break;
        case 'long':
          parts.push(cap(0.14, Math.PI * 0.52));
          parts.push({ g: new THREE.BoxGeometry(0.25, 0.3, 0.07), c: hc, p: [0, -0.1, -0.095] });
          break;
        case 'pony':
          parts.push(cap(0.137, Math.PI * 0.48));
          parts.push({ g: new THREE.ConeGeometry(0.045, 0.26, 5), c: hc, p: [0, -0.07, -0.16], r: [Math.PI - 0.35, 0, 0] });
          break;
        case 'bun':
          parts.push(cap(0.136, Math.PI * 0.48));
          parts.push({ g: new THREE.SphereGeometry(0.06, 6, 4), c: hc, p: [0, 0.09, -0.12] });
          break;
        default: break; // bald
      }
      return mergeParts(parts);
    });
  }
  /** Fallback weapon geometry (grip at origin, blade along +X) if Items is missing. */
  function weaponGeo(type) {
    if (GM.Items && typeof GM.Items.geometryOf === 'function') {
      const g = GM.Items.geometryOf(type);
      if (g) return g;
    }
    return kitGeo('w_' + type, function () {
      const len = { spear: 1.6, trident: 1.5, sword: 0.85, axe: 0.7, mace: 0.6, bow: 0.9, sickle: 0.4, knife: 0.32 }[type] || 0.4;
      return mergeParts([
        { g: new THREE.BoxGeometry(len, 0.03, 0.05), c: 0xcfd8e0, p: [len / 2 - 0.08, 0, 0] },
        { g: new THREE.BoxGeometry(0.12, 0.04, 0.04), c: 0x6b4226, p: [0, 0, 0] },
      ]);
    });
  }

  // held-weapon transforms (weapon mesh inside the hand group)
  const HELD = {
    knife: { r: [-0.4, -HP, 0], s: 1.25 },
    sickle: { r: [-0.4, -HP, 0], s: 1.25 },
    axe: { r: [-0.35, -HP, 0], s: 1.05, p: [0, 0, -0.06] },
    sword: { r: [-0.4, -HP, 0], s: 1.05 },
    mace: { r: [-0.35, -HP, 0], s: 1.1 },
    spear: { r: [-0.1, -HP, 0], s: 1.0 },
    trident: { r: [-0.1, -HP, 0], s: 1.0 },
    throwing_knives: { r: [-0.4, -HP, 0], s: 1.25, geo: 'knife' },
    bow: { r: [0, 0, -HP], s: 1.0, left: true },
  };

  // =========================================================== the rig
  /**
   * Build the tribute's scene graph. Returns the root Group (at the feet).
   * rig parts are kept in t.rig for posing.
   */
  function buildRig(t) {
    initTemps();
    const look = t.look;
    const female = t.gender === 'f';
    const quality = GM.state.settings ? GM.state.settings.quality : 'high';
    const shadows = quality !== 'low';

    const root = new THREE.Group();
    root.name = 'tribute:' + t.id;
    root.userData.tributeId = t.id;
    const body = new THREE.Group();
    root.add(body);
    const hips = new THREE.Group();
    hips.position.y = LEG;
    body.add(hips);

    const torso = new THREE.Mesh(torsoGeo(female), shirtMat(t.district));
    hips.add(torso);
    const vest = new THREE.Mesh(vestGeo(), gearMat());
    vest.visible = false;
    torso.add(vest);
    const pack = new THREE.Mesh(packGeo(), gearMat());
    pack.position.set(0, 0.1, -0.2);
    pack.visible = false;
    torso.add(pack);
    const back = new THREE.Mesh(weaponGeo('sword'), gearMat());
    back.visible = false;
    back.rotation.order = 'ZYX';
    torso.add(back);

    const neck = new THREE.Group();
    neck.position.y = 0.56;
    torso.add(neck);
    const head = new THREE.Mesh(headGeo(look), vcMat());
    head.position.y = 0.17;
    neck.add(head);

    const sw = female ? 0.235 : 0.25;
    const shL = new THREE.Group();
    shL.position.set(sw, 0.48, 0);
    torso.add(shL);
    const armL = new THREE.Mesh(armGeo(), skinMat(look.skin));
    shL.add(armL);
    const handL = new THREE.Group();
    handL.position.set(0, -0.58, 0.02);
    shL.add(handL);
    const shR = new THREE.Group();
    shR.position.set(-sw, 0.48, 0);
    torso.add(shR);
    const armR = new THREE.Mesh(armGeo(), skinMat(look.skin));
    shR.add(armR);
    const handR = new THREE.Group();
    handR.position.set(0, -0.58, 0.02);
    shR.add(handR);

    const weapon = new THREE.Mesh(weaponGeo('knife'), gearMat());
    weapon.visible = false;
    handR.add(weapon);

    const hipL = new THREE.Group();
    hipL.position.set(0.1, 0, 0);
    hips.add(hipL);
    const legL = new THREE.Mesh(legGeo(), pantsMat(look.pants));
    hipL.add(legL);
    const hipR = new THREE.Group();
    hipR.position.set(-0.1, 0, 0);
    hips.add(hipR);
    const legR = new THREE.Mesh(legGeo(), pantsMat(look.pants));
    hipR.add(legR);

    const meshes = [torso, head, armL, armR, legL, legR];
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].castShadow = shadows;
      meshes[i].userData.tributeId = t.id;
    }
    vest.castShadow = shadows;
    pack.castShadow = shadows;
    weapon.castShadow = shadows;
    vest.userData.tributeId = pack.userData.tributeId = weapon.userData.tributeId = back.userData.tributeId = t.id;
    root.scale.setScalar(look.height);

    t.rig = {
      root: root, body: body, hips: hips, torso: torso, vest: vest, pack: pack, back: back, neck: neck, head: head,
      shL: shL, shR: shR, armL: armL, armR: armR, handL: handL, handR: handR, weapon: weapon,
      hipL: hipL, hipR: hipR, legL: legL, legR: legR,
      meshes: meshes, baseMats: meshes.map(function (m) { return m.material; }), flashing: false,
      gearKey: -1, heldType: null, heldLeft: false, backType: null,
      tag: null, icon: null, iconKey: '',
    };
    return root;
  }

  // ======================================================== scene helpers
  function sceneRef() {
    const W = GM.World;
    return W && W.scene ? W.scene : null;
  }
  function addToScene(obj) {
    const sc = sceneRef();
    if (!sc || !obj) return false;
    if (obj.parent !== sc) sc.add(obj);
    return true;
  }
  function removeFromScene(obj) {
    if (obj && obj.parent) obj.parent.remove(obj);
  }
  function tagsOn() {
    const s = GM.state.settings;
    return !s || s.nameTags !== false;
  }

  // ============================================================ name tags
  // Tags and icons are sprites whose world size is set per camera in
  // onBeforeRender, so they keep a steady screen size in every view.
  const TAG_W = 256, TAG_H = 80;
  const TAG_BASE = 2.05;          // metres above the feet
  const TAG_FRAC = 0.028;         // tag height as a fraction of the view height
  const ICON_FRAC = 0.03;
  const TAG_FADE_NEAR = 150, TAG_FADE_FAR = 235;
  const TAG_FONT = '600 30px system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const CHIP_FONT = '700 24px system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const ICON_FONT = '40px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  const ICON_CACHE = Object.create(null);
  let _tw = null, _cw = null;

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function lumOf(hex) {
    const n = parseInt(String(hex).slice(1), 16) || 0;
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  }
  function hpColor(f) { return f > 0.6 ? '#5fd068' : f > 0.3 ? '#f2c14e' : '#e5534b'; }

  /** Per-camera sizing of tag / icon sprites (this = sprite). */
  function spriteBeforeRender(renderer, sc, camera) {
    const p = this.parent;
    if (!p || !_tw) return;
    const ud = this.userData;
    _tw.setFromMatrixPosition(p.matrixWorld);
    _cw.setFromMatrixPosition(camera.matrixWorld);
    const dist = _tw.distanceTo(_cw);
    const k = camera.isPerspectiveCamera ? 2 * Math.tan(camera.fov * Math.PI / 360) : 1.04;
    const ps = p.scale.y || 1;
    const hTag = U.clamp(dist * k * TAG_FRAC, 0.2, 7);
    let h = hTag, y = TAG_BASE;
    if (ud.icon) {
      h = U.clamp(dist * k * ICON_FRAC, 0.22, 8);
      if (ud.stack && ud.stack.visible) y += hTag * 1.02;
    }
    if (ud.lift) y += ud.lift;
    this.scale.set(h * ud.aspect / ps, h / ps, 1);
    this.position.y = y / ps;
    this.material.opacity = 1 - U.smoothstep(TAG_FADE_NEAR, TAG_FADE_FAR, dist);
    this.updateMatrix();
    this.matrixWorld.multiplyMatrices(p.matrixWorld, this.matrix);
  }

  function drawTag(t, tag) {
    const c = tag.ctx;
    const W = TAG_W;
    c.clearRect(0, 0, W, TAG_H);
    const sel = GM.state.selectedId === t.id;
    const alive = t.alive;
    c.font = TAG_FONT;
    const chipW = 40, pad = 8;
    const nameW = Math.min(c.measureText(t.name).width, W - chipW - pad * 3 - 10);
    const boxW = Math.max(110, chipW + nameW + pad * 3);
    const x0 = Math.round((W - boxW) / 2), y0 = 4, bh = 48;
    roundRect(c, x0, y0, boxW, bh, 10);
    c.fillStyle = alive ? 'rgba(9, 11, 15, 0.74)' : 'rgba(34, 34, 34, 0.62)';
    c.fill();
    c.lineWidth = sel ? 4 : 2;
    c.strokeStyle = sel ? '#ffd257' : 'rgba(255, 255, 255, 0.16)';
    c.stroke();
    // district chip
    const col = alive ? t.color : '#6b6b6b';
    roundRect(c, x0 + 6, y0 + 7, chipW - 4, bh - 14, 7);
    c.fillStyle = col;
    c.fill();
    c.font = CHIP_FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = lumOf(col) > 0.6 ? '#101216' : '#ffffff';
    c.fillText(String(t.district), x0 + 6 + (chipW - 4) / 2, y0 + bh / 2 + 1);
    // name
    c.font = TAG_FONT;
    c.textAlign = 'left';
    c.fillStyle = alive ? '#f4efe4' : '#a0a0a0';
    const nx = x0 + chipW + pad + 2;
    c.fillText(t.name, nx, y0 + bh / 2 + 1, nameW);
    if (!alive) {
      c.fillStyle = 'rgba(210, 70, 60, 0.9)';
      c.fillRect(nx - 2, y0 + bh / 2, nameW + 4, 3);
    } else {
      // health bar
      const f = U.clamp01(t.health / (t.maxHealth || 100));
      const bx = x0 + 4, by = y0 + bh + 7, bw = boxW - 8, bhh = 11;
      roundRect(c, bx, by, bw, bhh, 5);
      c.fillStyle = 'rgba(0, 0, 0, 0.68)';
      c.fill();
      if (f > 0) {
        roundRect(c, bx + 2, by + 2, Math.max(5, (bw - 4) * f), bhh - 4, 3);
        c.fillStyle = hpColor(f);
        c.fill();
      }
    }
    tag.tex.needsUpdate = true;
  }

  function iconMat(ch) {
    if (ICON_CACHE[ch]) return ICON_CACHE[ch];
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(9, 11, 15, 0.6)';
    c.beginPath();
    c.arc(32, 32, 29, 0, TAU);
    c.fill();
    c.font = ICON_FONT;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, 32, 35);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    ICON_CACHE[ch] = m;
    return m;
  }

  /** Name tag (canvas sprite, redrawn only on change) + status icon sprite. */
  function buildTag(t) {
    if (!_tw) { _tw = new THREE.Vector3(); _cw = new THREE.Vector3(); }
    const root = t.rig.root;
    const canvas = document.createElement('canvas');
    canvas.width = TAG_W;
    canvas.height = TAG_H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false });
    const spr = new THREE.Sprite(mat);
    spr.center.set(0.5, 0);
    spr.renderOrder = 10;
    spr.frustumCulled = false;
    spr.onBeforeRender = spriteBeforeRender;
    spr.userData = { aspect: TAG_W / TAG_H, icon: false, lift: 0 };
    spr.position.y = TAG_BASE;
    root.add(spr);
    const icon = new THREE.Sprite(iconMat('💤'));
    icon.center.set(0.5, 0);
    icon.renderOrder = 11;
    icon.frustumCulled = false;
    icon.visible = false;
    icon.onBeforeRender = spriteBeforeRender;
    icon.userData = { aspect: 1, icon: true, stack: spr, lift: 0 };
    root.add(icon);
    t.rig.tag = { sprite: spr, canvas: canvas, ctx: canvas.getContext('2d'), tex: tex, key: '' };
    t.rig.icon = icon;
    t.rig.iconKey = '';
  }

  /** Emoji hint above the head (asleep / stunned / afraid / mad ...). */
  function iconFor(t) {
    if (!t.alive) return '';
    const s = t.status;
    if (t.sleeping) return '💤';
    if (s.stun > 0) return '💫';
    if (s.burning > 0) return '🔥';
    if (s.madness > 0 || t.mood === 'mad') return '🤪';
    if (s.panic > 0) return '😱';
    if (t.drowning) return '🌊';
    if (s.stung > 0) return '🌀';
    if (t.mood === 'afraid' || (t.emotion && t.emotion.fear > 0.8)) return '😨';
    if (t.mood === 'angry' && t.emotion && t.emotion.rage > 0.75) return '💢';
    if (s.poison > 0) return '🤢';
    if (s.bleeding > 0) return '🩸';
    return '';
  }

  function updateTag(t, show) {
    const rig = t.rig;
    const tag = rig.tag;
    if (!tag) return;
    const lifting = !!(t.body && t.body.stage >= 2);
    const sel = GM.state.selectedId === t.id;
    const visible = show && !lifting && (t.alive || sel);
    tag.sprite.visible = visible;
    if (visible) {
      const key = t.name + '|' + (t.alive ? Math.ceil(t.health / 2) : -1) + '|' + (sel ? 1 : 0);
      if (key !== tag.key) {
        tag.key = key;
        drawTag(t, tag);
      }
    }
    const icon = rig.icon;
    const ch = show && !lifting ? iconFor(t) : '';
    if (ch !== rig.iconKey) {
      rig.iconKey = ch;
      if (ch) icon.material = iconMat(ch);
    }
    icon.visible = !!ch;
    tag.sprite.userData.lift = icon.userData.lift = t.sleeping ? -1.2 : t.swimming ? -1.1 : 0;
  }

  // ========================================================= selection ring
  let selRing = null;
  function ensureRing() {
    if (selRing || !hasThree()) return selRing;
    const g = new THREE.RingGeometry(0.6, 0.8, 40, 1);
    g.rotateX(-HP);
    const m = new THREE.MeshBasicMaterial({
      color: 0xffd257, transparent: true, opacity: 0.85, depthWrite: false,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
    });
    selRing = new THREE.Mesh(g, m);
    selRing.name = 'tribute-selection';
    selRing.renderOrder = 4;
    selRing.visible = false;
    return selRing;
  }
  function updateRing() {
    const st = GM.state;
    const t = st.selectedId == null ? null : st.tributes[st.selectedId];
    if (!t || !t.mesh || !t.mesh.parent || (t.body && t.body.stage >= 2)) {
      if (selRing) selRing.visible = false;
      return;
    }
    const r = ensureRing();
    if (!r) return;
    if (!r.parent) addToScene(r);
    r.visible = true;
    r.position.set(t.pos.x, t.pos.y + 0.07, t.pos.z);
    const pulse = 1 + 0.07 * Math.sin(st.realTime * 5);
    r.scale.setScalar(pulse * (t.alive ? (t.sleeping ? 1.35 : 1) : 1.6));
    r.material.opacity = t.alive ? 0.85 : 0.4;
  }

  // ============================================================== spawning
  const STYLES_F = ['long', 'pony', 'bun', 'short', 'long', 'pony', 'mop'];
  const STYLES_M = ['short', 'buzz', 'mop', 'short', 'bald', 'long', 'buzz'];
  const SKILL_NAMES = ['strength', 'speed', 'stealth', 'survival', 'aim'];

  function makeLook(t, rng) {
    const f = t.gender === 'f';
    let hair = rng.int(0, HAIR.length - 1);
    if (hair === 5 && rng.chance(0.7)) hair = rng.int(0, 4);   // grey hair is rare
    return {
      skin: rng.int(0, SKIN.length - 1),
      hair: hair,
      style: rng.pick(f ? STYLES_F : STYLES_M),
      pants: rng.int(0, PANTS.length - 1),
      height: f ? rng.range(0.93, 1.0) : rng.range(0.98, 1.06),
    };
  }
  function emptyInv() {
    if (GM.Items && typeof GM.Items.emptyInventory === 'function') return GM.Items.emptyInventory();
    return { melee: null, ranged: null, ammo: 0, armor: false, food: 0, water: 0, medkit: 0, berries: 0, traps: 0, sleepingBag: false, goggles: false };
  }
  function fallbackPedestals(n) {
    const out = [];
    const R0 = CFG.PEDESTAL_RADIUS;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const x = Math.sin(a) * R0, z = Math.cos(a) * R0;
      out.push({ x: x, y: groundY(x, z), z: z, heading: Math.atan2(-x, -z) });
    }
    return out;
  }
  /** Personality when the AI module is missing (so the sim still runs). */
  function fallbackMind(t) {
    const base = FALLBACK_TRAITS[t.archetype] || FALLBACK_TRAITS.survivor;
    const tr = {};
    for (let i = 0; i < TRAIT_NAMES.length; i++) tr[TRAIT_NAMES[i]] = U.clamp(base[i] + GM.R.gauss(0, 0.12), 0.02, 0.98);
    t.traits = tr;
    const bias = FALLBACK_SKILL_BIAS[t.archetype] || {};
    for (const k in bias) t.skills[k] = U.clamp(t.skills[k] + bias[k], 0.05, 1);
    t.emotion = { fear: 0.2, rage: 0.05, confidence: 0.5, sanity: 1 };
    t.mood = 'calm';
    t.action = 'idle';
    t.thought = { key: 'tribute.thought.none', params: {} };
    t.mind = t.mind || {};
  }

  function createTribute(entry, id, ped) {
    const R = GM.R;
    entry = entry || {};
    const district = (entry.district | 0) > 0 ? (entry.district | 0) : Math.floor(id / 2) + 1;
    const gender = entry.gender === 'm' ? 'm' : entry.gender === 'f' ? 'f' : (id % 2 ? 'm' : 'f');
    const x = num(ped.x, 0), z = num(ped.z, 0);
    const y = num(ped.y, groundY(x, z));
    const heading = num(ped.heading, Math.atan2(-x, -z));
    const skills = {};
    for (let i = 0; i < SKILL_NAMES.length; i++) skills[SKILL_NAMES[i]] = U.clamp(R.gauss(0.5, 0.14), 0.12, 0.88);
    const status = {};
    for (let i = 0; i < STATUS_NAMES.length; i++) status[STATUS_NAMES[i]] = 0;
    const t = {
      kind: 'tribute',
      id: id,
      name: String(entry.name || ('Tribute ' + (id + 1))).slice(0, 24),
      district: district,
      gender: gender,
      color: GM.districtColor(district),
      archetype: entry.archetype || 'survivor',
      traits: {},
      skills: skills,
      alive: true,
      health: 100,
      maxHealth: 100,
      stamina: 100,
      hunger: R.range(4, 14),
      thirst: R.range(4, 14),
      energy: R.range(88, 100),
      emotion: { fear: 0.2, rage: 0.05, confidence: 0.5, sanity: 1 },
      mood: 'calm',
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      heading: heading,
      radius: RADIUS,
      inv: emptyInv(),
      status: status,
      sleeping: false, hidden: false, sneaking: false, swimming: false, inWater: false,
      drowning: false, cold: false,
      nav: {
        moving: false, hasGoal: false, mode: 'walk', gx: x, gz: z,
        path: null, wp: 0, queued: false, direct: true, planGX: 1e9, planGZ: 1e9, planAt: -1e9,
        fails: 0, directUntil: 0, stuck: 0, checkAt: 0, lastX: x, lastZ: z,
        sideT: 0, sideX: 0, sideZ: 0, kx: 0, kz: 0, speed: 0, faceUntil: 0,
        onPed: true, pedX: x, pedY: y, pedZ: z,
      },
      action: 'idle',
      thought: { key: 'tribute.thought.none', params: {} },
      targetId: null,
      allianceId: null,
      mind: {},
      kills: 0,
      damageDealt: 0,
      killedBy: null,
      deathCause: null,
      deathWeapon: null,
      deathTime: null,
      deathDay: null,
      placement: null,
      popularity: 0.3,
      mesh: null,
      rig: null,
      lastAttackedBy: null,
      lastAttackedAt: -1e9,
      combat: { next: 0, mode: 'melee', modeAt: -1e9, lastAttackAt: -1e9, lastTargetId: null },
      anim: {
        walk: R.range(0, TAU), move: 0, swim: 0, crouch: 0, sleep: 0, dead: 0, deathDir: -1, deathTwist: 0,
        atk: { on: false, type: '', t: 0, dur: 0.5 }, gest: { on: false, type: '', t: 0, dur: 0.6 },
        flash: 0, stun: 0, lift: 0, liftSpin: 0, phase: R.range(0, 100),
      },
      look: null,
      healLeft: 0,
      woundBy: null,
      forageT: 0,
      sleepAt: -1e9,
      wokeAt: -1e9,
      dot: { starve: 0, thirst: 0, cold: 0, poison: 0, bleeding: 0, burning: 0, drown: 0 },
      dotT: R.range(0, 0.5),
      body: null,
      bodyGone: false,
      fxT: 0,
      cheerT: 2,
    };
    const lookSeed = (GM.hashString(t.name) ^ Math.imul(id + 1, 0x9e3779b1) ^ (GM.state.seed >>> 0)) >>> 0;
    t.look = makeLook(t, makeRng(lookSeed));
    return t;
  }

  function buildMesh(t) {
    if (!hasThree()) return;
    const root = buildRig(t);
    t.mesh = root;
    root.position.copy(t.pos);
    root.rotation.y = t.heading;
    buildTag(t);
    Tributes.refreshGear(t);
    addToScene(root);
  }

  function disposeTribute(t) {
    if (!t) return;
    if (t.mesh) removeFromScene(t.mesh);
    const rig = t.rig;
    if (rig && rig.tag) {
      try {
        rig.tag.tex.dispose();
        rig.tag.sprite.material.dispose();
      } catch (err) { /* already gone */ }
      rig.tag = null;
    }
    t.mesh = null;
  }

  /**
   * Create tribute objects + meshes on the pedestals (World.pedestals(n)),
   * give each a mind (GM.AI.initMind) and store them in GM.state.tributes.
   */
  Tributes.spawnAll = function (roster) {
    const st = GM.state;
    if (!hasThree()) return [];
    const old = st.tributes || [];
    for (let i = 0; i < old.length; i++) disposeTribute(old[i]);
    pathQueue.length = 0;
    removePickups();
    if (!Array.isArray(roster) || roster.length < CFG.MIN_TRIBUTES) {
      roster = Tributes.generateRoster(CFG.DEFAULT_TRIBUTES, 'balanced', st.seed);
    }
    const n = Math.min(roster.length, CFG.MAX_TRIBUTES);
    let peds = null;
    if (GM.World && typeof GM.World.pedestals === 'function') {
      try { peds = GM.World.pedestals(n); } catch (err) { GM.reportError('Tributes.pedestals', err); peds = null; }
    }
    if (!Array.isArray(peds) || peds.length < n) peds = fallbackPedestals(n);
    const list = st.tributes || (st.tributes = []);
    list.length = 0;
    for (let i = 0; i < n; i++) list.push(createTribute(roster[i], i, peds[i] || {}));
    const AI = GM.AI;
    for (let i = 0; i < n; i++) {
      const t = list[i];
      let ok = false;
      if (AI && typeof AI.initMind === 'function') {
        try { AI.initMind(t); ok = true; } catch (err) { GM.reportError('Tributes.initMind', err); }
      }
      if (!ok) fallbackMind(t);
      if (!t.thought) t.thought = { key: 'tribute.thought.none', params: {} };
    }
    for (let i = 0; i < n; i++) buildMesh(list[i]);
    return list;
  };

  // ================================================================ queries
  /** Tribute by id, or null. */
  Tributes.get = function (id) {
    if (id == null) return null;
    return GM.state.tributes[id] || null;
  };
  /** All tribute objects (the live GM.state.tributes array). */
  Tributes.list = function () { return GM.state.tributes; };
  /** Living tributes (new array). */
  Tributes.alive = function () {
    const out = [];
    const list = GM.state.tributes;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].alive) out.push(list[i]);
    return out;
  };
  Tributes.aliveCount = function () {
    let n = 0;
    const list = GM.state.tributes;
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].alive) n++;
    return n;
  };
  /** Nearest living tribute within maxDist (optional filter(t) → bool). */
  Tributes.nearest = function (pos, maxDist, filter) {
    if (!pos) return null;
    const list = GM.state.tributes;
    let best = null;
    let bd = maxDist == null ? Infinity : maxDist * maxDist;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.alive) continue;
      const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > bd) continue;
      if (filter && !filter(t)) continue;
      bd = d2;
      best = t;
    }
    return best;
  };
  /** Living tributes within r (optional filter). */
  Tributes.inRadius = function (pos, r, filter) {
    const out = [];
    if (!pos) return out;
    const list = GM.state.tributes;
    const r2 = r * r;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.alive) continue;
      const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z;
      if (dx * dx + dz * dz > r2) continue;
      if (filter && !filter(t)) continue;
      out.push(t);
    }
    return out;
  };
  /** Can the tribute act right now (alive, awake, not stunned)? */
  Tributes.canAct = function (t) {
    return !!(t && t.alive && !t.sleeping && !(t.status && t.status.stun > 0));
  };
  /** Head position (projectile aim / FX), written into out (or a new Vector3). */
  Tributes.headPos = function (t, out) {
    out = out || new THREE.Vector3();
    const h = t.look ? t.look.height : 1;
    let y = t.pos.y + 1.62 * h;
    if (!t.alive || t.sleeping) y = t.pos.y + 0.3;
    else if (t.swimming) y = t.pos.y + 0.25;
    else if (t.anim && t.anim.crouch > 0.3) y -= 0.25 * t.anim.crouch;
    return out.set(t.pos.x, y, t.pos.z);
  };
  /** Chest position (where hits land). */
  Tributes.chestPos = function (t, out) {
    out = out || new THREE.Vector3();
    const h = t.look ? t.look.height : 1;
    let y = t.pos.y + 1.22 * h;
    if (!t.alive || t.sleeping) y = t.pos.y + 0.22;
    else if (t.swimming) y = t.pos.y + 0.1;
    else if (t.anim && t.anim.crouch > 0.3) y -= 0.18 * t.anim.crouch;
    return out.set(t.pos.x, y, t.pos.z);
  };

  // ================================================================== gear
  function carried(t) {
    const I = GM.Items;
    if (I && typeof I.carriedCount === 'function') {
      try { return I.carriedCount(t) || 0; } catch (err) { return 0; }
    }
    const inv = t.inv || {};
    return (inv.food || 0) + (inv.water || 0) + (inv.medkit || 0) + (inv.berries || 0) + (inv.traps || 0) + (inv.sleepingBag ? 1 : 0);
  }

  /**
   * Sync the visible gear with the inventory: weapon in hand (ranged when the
   * tribute is shooting, else melee), the other weapon on the back, armor
   * vest, backpack when carrying supplies. Called by Items after pickups.
   */
  Tributes.refreshGear = function (t) {
    const rig = t && t.rig;
    if (!rig) return;
    const inv = t.inv || {};
    let held = null, back = null;
    if (t.alive) {
      const ranged = !!inv.ranged && !!t.combat && t.combat.mode === 'ranged';
      if (ranged) { held = inv.ranged; back = inv.melee; } else { held = inv.melee; back = inv.ranged; }
    }
    if (held !== rig.heldType) {
      rig.heldType = held;
      const w = rig.weapon;
      if (held) {
        const cfg = HELD[held] || HELD.knife;
        w.geometry = weaponGeo(cfg.geo || held);
        const hand = cfg.left ? rig.handL : rig.handR;
        if (w.parent !== hand) hand.add(w);
        w.rotation.set(cfg.r[0], cfg.r[1], cfg.r[2]);
        w.scale.setScalar(cfg.s || 1);
        if (cfg.p) w.position.set(cfg.p[0], cfg.p[1], cfg.p[2]); else w.position.set(0, 0, 0);
        w.visible = true;
      } else {
        w.visible = false;
      }
    }
    if (back !== rig.backType) {
      rig.backType = back;
      const b = rig.back;
      if (back) {
        b.geometry = weaponGeo(back);
        const big = back === 'bow' || back === 'spear' || back === 'trident';
        b.position.set(0.14, big ? 0.1 : 0.18, -0.17);
        b.rotation.set(0, 0, back === 'bow' ? HP + 0.35 : HP + 0.75);
        b.scale.setScalar(back === 'throwing_knives' ? 1 : 0.9);
        b.visible = true;
      } else {
        b.visible = false;
      }
    }
    rig.vest.visible = !!(t.alive && inv.armor);
    rig.pack.visible = !!(t.alive && (carried(t) >= 3 || inv.sleepingBag));
  };

  // ============================================================ locomotion
  const pathQueue = [];          // tribute ids waiting for an A* run
  let pathsThisFrame = 0;
  let animClock = 0;             // sim seconds (freezes while paused)
  const SEP = { x: 0, z: 0 };
  const FXP = { x: 0, y: 0, z: 0 };

  function requestPath(t) {
    const nav = t.nav;
    if (nav.queued) return;
    nav.queued = true;
    pathQueue.push(t.id);
  }
  /** Run at most MAX_PATHS_PER_STEP A* searches per update (and 8 per frame). */
  function processPaths() {
    let budget = MAX_PATHS_PER_STEP;
    const T = Ter();
    const list = GM.state.tributes;
    while (pathQueue.length && budget > 0 && pathsThisFrame < MAX_PATHS_PER_FRAME) {
      const t = list[pathQueue.shift()];
      if (!t || !t.nav) continue;
      t.nav.queued = false;
      if (!t.alive || !t.nav.moving) continue;
      budget--;
      pathsThisFrame++;
      planPath(t, T);
    }
  }
  function planPath(t, T) {
    const nav = t.nav;
    let path = null;
    if (T && typeof T.findPath === 'function') {
      try { path = T.findPath(t.pos.x, t.pos.z, nav.gx, nav.gz, { maxNodes: 4000 }); } catch (err) { GM.reportError('Tributes.findPath', err); path = null; }
    }
    nav.planAt = now();
    nav.planGX = nav.gx;
    nav.planGZ = nav.gz;
    if (Array.isArray(path) && path.length && path[0] && typeof path[0].x === 'number') {
      nav.path = path;
      nav.wp = 0;
      while (nav.wp < path.length - 1) {
        const p = path[nav.wp];
        const dx = p.x - t.pos.x, dz = p.z - t.pos.z;
        if (dx * dx + dz * dz > 2.25) break;
        nav.wp++;
      }
      nav.fails = 0;
    } else {
      // no path: steer straight at the goal for a while (direct-steer fallback)
      nav.path = null;
      nav.fails++;
      nav.directUntil = now() + 3 + nav.fails;
    }
  }
  /** Straight line walkable and without deep water (sampled every 3 m)? */
  function clearLine(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az;
    const d = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.ceil(d / 3));
    const wet = waterDepth(ax, az) > SWIM_DEPTH;
    for (let i = 1; i <= n; i++) {
      const f = i / n;
      const x = ax + dx * f, z = az + dz * f;
      if (!walkable(x, z)) return false;
      if (!wet && waterDepth(x, z) > SWIM_DEPTH) return false;
    }
    return true;
  }
  function stopNav(t) {
    const nav = t.nav;
    nav.moving = false;
    nav.path = null;
    nav.wp = 0;
    nav.sideT = 0;
  }

  /**
   * Walk/run/sprint/sneak toward (x, z). Plans an A* path through the
   * budgeted queue when the goal is far or blocked, else steers directly.
   * Cheap to call every tick: no re-plan while the goal moved < 2 m.
   */
  Tributes.moveTo = function (t, x, z, mode) {
    if (!t || !t.alive || !t.nav || !(x === x) || !(z === z)) return false;
    const nav = t.nav;
    mode = SPEEDS[mode] ? mode : 'walk';
    if (t.sleeping) Tributes.setSleeping(t, false);
    nav.mode = mode;
    t.sneaking = mode === 'sneak';
    const r = Math.sqrt(x * x + z * z), maxR = CFG.ARENA_RADIUS - 2.5;
    if (r > maxR) { x = x / r * maxR; z = z / r * maxR; }
    const dgx = x - nav.gx, dgz = z - nav.gz;
    const same = nav.moving && dgx * dgx + dgz * dgz < 4;
    nav.moving = true;
    nav.hasGoal = true;
    if (same) return true;
    nav.gx = x;
    nav.gz = z;
    const dx = x - t.pos.x, dz = z - t.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= DIRECT_RANGE && clearLine(t.pos.x, t.pos.z, x, z)) {
      nav.path = null;
      return true;
    }
    const px = x - nav.planGX, pz = z - nav.planGZ;
    if (!nav.path || px * px + pz * pz > Math.max(9, d * d * 0.04)) {
      if (!nav.path && now() < nav.directUntil && nav.fails > 0 && px * px + pz * pz < 64) return true;
      requestPath(t);
    }
    return true;
  };

  /** Stop moving (keeps facing). */
  Tributes.stop = function (t) {
    if (!t || !t.nav) return;
    stopNav(t);
    t.nav.hasGoal = false;
    t.nav.gx = t.pos.x;
    t.nav.gz = t.pos.z;
  };

  /** Turn to face a point (x, z) or a position object. */
  Tributes.faceToward = function (t, x, z) {
    if (!t || !t.pos) return;
    if (x && typeof x === 'object') { z = x.z; x = x.x; }
    const dx = x - t.pos.x, dz = z - t.pos.z;
    if (!(dx * dx + dz * dz > 1e-6)) return;
    t.heading = Math.atan2(dx, dz);
    if (t.nav) t.nav.faceUntil = now() + 0.6;
  };

  /** Is the tribute within dist of its current move goal (true when it has none)? */
  Tributes.arrived = function (t, dist) {
    if (!t || !t.nav) return true;
    const nav = t.nav;
    if (!nav.hasGoal) return true;
    const d = dist == null ? 1.5 : dist;
    const dx = nav.gx - t.pos.x, dz = nav.gz - t.pos.z;
    return dx * dx + dz * dz <= d * d;
  };

  /** Movement speed (m/s) for a mode right now (skills, stamina, wounds, terrain, weather). */
  Tributes.speedOf = function (t, mode, depth) {
    if (!t) return 0;
    mode = mode || (t.nav ? t.nav.mode : 'walk');
    if (depth == null) depth = waterDepth(t.pos.x, t.pos.z);
    const sk = 0.85 + 0.3 * skill(t, 'speed');
    if (depth > SWIM_DEPTH) return SWIM_SPEED * sk * (t.stamina <= 0 ? 0.45 : 1);
    let base = SPEEDS[mode] || SPEEDS.walk;
    if (mode === 'sprint' && t.stamina < 4) base = SPEEDS.run;
    if ((mode === 'run' || mode === 'sprint') && t.stamina < 1) base = SPEEDS.walk * 1.25;
    let f = sk;
    if (t.stamina < 20) f *= 0.8 + 0.01 * t.stamina;
    const hp = t.health / (t.maxHealth || 100);
    if (hp < 0.5) f *= 0.65 + 0.7 * hp;
    if (t.energy < 20) f *= 0.8 + 0.01 * t.energy;
    if (t.hunger >= 90 || t.thirst >= 90) f *= 0.9;
    f *= num(envCall('moveFactor', 1), 1);
    if (depth > WADE_DEPTH) f *= U.lerp(0.8, 0.5, U.clamp01((depth - WADE_DEPTH) / (SWIM_DEPTH - WADE_DEPTH)));
    f *= 1 - 0.45 * U.clamp01(slopeAt(t.pos.x, t.pos.z) * 1.3);
    return base * f;
  };

  function separation(t) {
    const list = GM.state.tributes;
    let sx = 0, sz = 0;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!o || o === t || !o.alive) continue;
      let dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 1.21) continue;
      if (d2 < 1e-6) { dx = (t.id - o.id) * 0.01 || 0.01; dz = 0.005; }
      const d = Math.sqrt(dx * dx + dz * dz);
      const f = (1.1 - Math.min(1.1, d)) / 1.1;
      sx += dx / d * f;
      sz += dz / d * f;
    }
    SEP.x = sx;
    SEP.z = sz;
  }

  /** Path following, steering, separation, water, stamina, snapping, stuck handling. */
  function locomotion(t, dt, phase) {
    const nav = t.nav, pos = t.pos, vel = t.vel;
    const depth = waterDepth(pos.x, pos.z);
    t.inWater = depth > WADE_DEPTH;
    t.swimming = depth > SWIM_DEPTH;
    if (t.swimming && t.sleeping) Tributes.setSleeping(t, false);
    const stunned = t.status.stun > 0;
    const counting = phase === 'countdown';
    const canMove = !stunned && !t.sleeping && !counting;
    let desX = 0, desZ = 0;

    if (canMove && nav.moving) {
      let tx = nav.gx, tz = nav.gz, final = true;
      const path = nav.path;
      if (path) {
        let wp = path[nav.wp];
        while (nav.wp < path.length - 1) {
          const ddx = wp.x - pos.x, ddz = wp.z - pos.z;
          if (ddx * ddx + ddz * ddz > 3.2) break;
          nav.wp++;
          wp = path[nav.wp];
        }
        if (nav.wp < path.length - 1) {
          tx = wp.x; tz = wp.z; final = false;
        } else {
          const ex = wp.x - nav.gx, ez = wp.z - nav.gz;
          if (ex * ex + ez * ez > 9) { tx = wp.x; tz = wp.z; }   // goal unreachable: stop at the path end
        }
      }
      let dx = tx - pos.x, dz = tz - pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (final && d < 0.45) {
        stopNav(t);
      } else if (d > 1e-4) {
        let spd = Tributes.speedOf(t, nav.mode, depth);
        if (final && d < 1.5) spd *= Math.max(0.35, d / 1.5);
        dx /= d; dz /= d;
        if (nav.sideT > 0) {
          nav.sideT -= dt;
          dx += nav.sideX * 0.9; dz += nav.sideZ * 0.9;
          const l = Math.sqrt(dx * dx + dz * dz) || 1;
          dx /= l; dz /= l;
        }
        desX = dx * spd;
        desZ = dz * spd;
      }
    }
    if (!counting && !t.sleeping) {
      separation(t);
      desX += SEP.x * 2.2;
      desZ += SEP.z * 2.2;
    }

    // smooth velocity + knockback impulse
    const k = 1 - Math.exp(-(t.swimming ? 3.5 : 9) * dt);
    vel.x += (desX - vel.x) * k;
    vel.z += (desZ - vel.z) * k;
    vel.y = 0;
    const mx = vel.x + nav.kx, mz = vel.z + nav.kz;
    const kd = Math.exp(-5 * dt);
    nav.kx *= kd;
    nav.kz *= kd;
    if (nav.kx * nav.kx + nav.kz * nav.kz < 1e-4) { nav.kx = 0; nav.kz = 0; }
    if (mx * mx + mz * mz > 1e-8) {
      let nx = pos.x + mx * dt, nz = pos.z + mz * dt;
      if (!walkable(nx, nz) && walkable(pos.x, pos.z)) {
        if (walkable(nx, pos.z)) nz = pos.z;
        else if (walkable(pos.x, nz)) nx = pos.x;
        else { nx = pos.x; nz = pos.z; vel.x *= 0.5; vel.z *= 0.5; }
      }
      const r = Math.sqrt(nx * nx + nz * nz), maxR = CFG.ARENA_RADIUS - 1;
      if (r > maxR) { nx *= maxR / r; nz *= maxR / r; }
      pos.x = nx;
      pos.z = nz;
    }

    // facing follows the velocity (unless an attack just turned us)
    const sp = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    nav.speed = sp;
    if (sp > 0.3 && now() >= nav.faceUntil) {
      const want = Math.atan2(vel.x, vel.z);
      t.heading = U.wrapAngle(t.heading + U.angleDiff(t.heading, want) * Math.min(1, (t.swimming ? 5 : 10) * dt));
    }

    // snap to ground / water surface (and the pedestal before stepping off)
    const gy = groundY(pos.x, pos.z);
    pos.y = t.swimming ? Math.max(gy, waterY()) : gy;
    if (nav.onPed) {
      const px = pos.x - nav.pedX, pz = pos.z - nav.pedZ;
      if (px * px + pz * pz < 0.81) pos.y = Math.max(pos.y, nav.pedY);
      else if (!counting) nav.onPed = false;
    }

    // walk cycle phase follows the distance travelled
    const stride = U.lerp(1.35, 2.4, U.clamp01((sp - 2) / 4)) * (t.look ? t.look.height : 1);
    t.anim.walk = (t.anim.walk + sp * dt * TAU / stride * (t.swimming ? 0.55 : 1)) % TAU;

    // stamina: running, sprinting and swimming drain it
    let drain = 0;
    if (t.swimming) drain = 3.4 - 1.4 * skill(t, 'survival');
    else if (sp > 5.6) drain = 7.5;
    else if (sp > 3.6) drain = 1.4;
    if (drain > 0) {
      t.stamina = Math.max(0, t.stamina - drain * dt);
    } else {
      let regen = t.sleeping ? 12 : sp < 0.3 ? 8 : 5;
      if (t.energy < 15) regen *= 0.5;
      if (t.hunger >= 100 || t.thirst >= 100) regen *= 0.5;
      t.stamina = Math.min(100, t.stamina + regen * dt);
    }
    t.drowning = t.swimming && t.stamina <= 0;
    if (t.drowning && phase === 'running') t.dot.drown += 7 * dt;

    // stuck detection: sidestep, then re-plan, then direct steering
    if (nav.moving && canMove) {
      nav.checkAt += dt;
      if (nav.checkAt >= 1.2) {
        const mdx = pos.x - nav.lastX, mdz = pos.z - nav.lastZ;
        if (mdx * mdx + mdz * mdz < 0.12) {
          nav.stuck++;
          const a = GM.R.angle();
          nav.sideX = Math.sin(a);
          nav.sideZ = Math.cos(a);
          nav.sideT = 0.9;
          if (nav.stuck >= 4) {
            nav.path = null;
            nav.directUntil = now() + 3;
            nav.stuck = 0;
          } else if (nav.stuck >= 2) {
            nav.planGX = 1e9;
            requestPath(t);
          }
        } else {
          nav.stuck = 0;
        }
        nav.checkAt = 0;
        nav.lastX = pos.x;
        nav.lastZ = pos.z;
      }
    } else {
      nav.checkAt = 0;
      nav.stuck = 0;
      nav.lastX = pos.x;
      nav.lastZ = pos.z;
    }
  }

  // ======================================================= needs + status
  const BIOME_FOOD = { forest: 0.55, grass: 0.3, swamp: 0.35, sand: 0.08, plaza: 0.02, rock: 0.08, snow: 0.03, water: 0 };
  const DOT_CAUSE = { starve: 'starve', thirst: 'thirst', cold: 'cold', poison: 'poison', bleeding: 'weapon', burning: 'fire', drown: 'drown' };
  const DOT_KEYS = Object.keys(DOT_CAUSE);
  const STATUS_ICONS = {
    stun: '💫', poison: '🤢', madness: '🤪', panic: '😱', burning: '🔥', stung: '🐝', bleeding: '🩸',
    asleep: '💤', swimming: '🏊', drowning: '🌊', cold: '🥶', starving: '🍖', thirsty: '💧', exhausted: '😩',
    hidden: '🌿', sneaking: '👣', healing: '💚', armored: '🦺',
  };

  function weatherNow() { return GM.Env && GM.Env.weather ? GM.Env.weather : 'clear'; }

  /** Hunger, thirst, energy, cold, slow natural healing (phase 'running' only). */
  function needs(t, dt) {
    const sl = t.sleeping;
    const weather = weatherNow();
    t.hunger = Math.min(100, t.hunger + HUNGER_RATE * dt * (sl ? 0.6 : 1));
    t.thirst = Math.min(100, t.thirst + THIRST_RATE * dt * (weather === 'heat' ? 2 : 1) * (sl ? 0.6 : 1));
    if (sl) t.energy = Math.min(100, t.energy + SLEEP_GAIN * dt * (t.inv.sleepingBag ? 1.35 : 1));
    else t.energy = Math.max(0, t.energy - ENERGY_DRAIN * dt * (t.nav.speed > 4 ? 1.4 : 1));
    if (t.hunger >= 100) t.dot.starve += 0.45 * dt;
    if (t.thirst >= 100) t.dot.thirst += 0.75 * dt;

    // cold: snowy nights hurt, a sleeping bag protects
    let cold = false;
    if (isNight() && (weather === 'snow' || biomeAt(t.pos.x, t.pos.z) === 'snow')) cold = !(t.inv.sleepingBag && sl);
    t.cold = cold;
    if (cold) t.dot.cold += (t.inv.sleepingBag ? 0.12 : 0.35) * dt;

    const s = t.status;
    if (t.health < t.maxHealth && t.hunger < 75 && t.thirst < 75 && !(s.bleeding > 0) && !(s.poison > 0) && !(s.burning > 0) && !cold) {
      t.health = Math.min(t.maxHealth, t.health + (sl ? 0.12 : 0.035) * dt);
    }
    // collapse from exhaustion (unless just attacked); wake up when rested
    if (!sl && t.energy <= 0 && !t.swimming && now() - t.lastAttackedAt > 8) Tributes.setSleeping(t, true);
    else if (sl && t.energy >= 100 && now() - t.sleepAt > 20) Tributes.setSleeping(t, false);
  }

  /** Status timers tick down; poison / bleeding / burning add damage over time. */
  function statusTick(t, dt, running) {
    const s = t.status;
    const weather = weatherNow();
    const wet = weather === 'rain' || weather === 'storm';
    for (let i = 0; i < STATUS_NAMES.length; i++) {
      const k = STATUS_NAMES[i];
      if (s[k] > 0) s[k] = Math.max(0, s[k] - dt * (k === 'burning' && wet ? 2.5 : 1));
    }
    if (s.burning > 0 && t.inWater) {
      s.burning = 0;
      FXP.x = t.pos.x; FXP.y = t.pos.y + 0.8; FXP.z = t.pos.z;
      fx('burst', FXP, { count: 10, color: 0xdfe6ea, color2: 0x9aa3a8, speed: 1.5, up: 2.5, gravity: 1.5, size: 0.35, life: 0.9 });
      sfx('splash', t.pos, 0.5);
    }
    if (t.healLeft > 0) {
      const h = Math.min(t.healLeft, 9 * dt);
      t.healLeft = Math.max(0, t.healLeft - h);
      t.health = Math.min(t.maxHealth, t.health + h);
    }
    if (!running) return;
    if (s.poison > 0) t.dot.poison += 1.6 * dt;
    if (s.bleeding > 0) t.dot.bleeding += 1.3 * dt;
    else t.woundBy = null;
    if (s.burning > 0) {
      t.dot.burning += 5 * dt;
      t.fxT -= dt;
      if (t.fxT <= 0) {
        t.fxT = 0.09;
        FXP.x = t.pos.x + (Math.random() - 0.5) * 0.4;
        FXP.y = t.pos.y + 0.6 + Math.random() * 0.8;
        FXP.z = t.pos.z + (Math.random() - 0.5) * 0.4;
        fx('emit', FXP, { count: 2, color: 0xff7a1a, color2: 0xffd24a, speed: 0.8, spread: 0.3, up: 2.6, gravity: 2, size: 0.28, life: 0.45, additive: true });
      }
    }
  }

  /** Apply accumulated damage-over-time twice per second (fewer events). */
  function dotFlush(t, dt) {
    t.dotT -= dt;
    if (t.dotT > 0) return;
    t.dotT = 0.5;
    const d = t.dot;
    for (let i = 0; i < DOT_KEYS.length && t.alive; i++) {
      const k = DOT_KEYS[i];
      const v = d[k];
      if (!(v > 0)) continue;
      d[k] = 0;
      const bleed = k === 'bleeding';
      Tributes.damage(t, v, {
        cause: DOT_CAUSE[k], attacker: null, mutt: null, weapon: null, pos: t.pos,
        dot: true, bleed: bleed, bleedBy: bleed ? t.woundBy : null,
      });
    }
  }

  // ======================================================= damage and death
  /**
   * Damage a tribute. info {cause, attacker, mutt, weapon, pos, sneak, trapOwnerId, dot}.
   * Armor reduces weapon / mutt / explosion damage. Ignored when the Games ended.
   * Returns the damage actually dealt.
   */
  Tributes.damage = function (t, amount, info) {
    if (!t || !t.alive || !(amount > 0)) return 0;
    const phase = GM.state.phase;
    if (phase === 'ended' || phase === 'setup') return 0;
    info = info || {};
    const cause = info.cause || (info.attacker ? 'weapon' : 'unknown');
    info.cause = cause;
    let dmg = amount;
    if (t.inv && t.inv.armor && ARMOR_CAUSES[cause] && !info.dot) {
      const A = GM.ItemDefs && GM.ItemDefs.armor;
      dmg *= 1 - (A && typeof A.reduce === 'number' ? A.reduce : 0.3);
    }
    dmg = Math.min(dmg, t.health);
    if (!(dmg > 0)) return 0;
    if (info.wasAsleep == null) info.wasAsleep = t.sleeping;
    t.health -= dmg;
    const atk = info.attacker && info.attacker.kind === 'tribute' && info.attacker !== t ? info.attacker : null;
    if (atk) {
      t.lastAttackedBy = atk.id;
      t.lastAttackedAt = now();
      atk.damageDealt = (atk.damageDealt || 0) + dmg;
    }
    if (t.sleeping && !(info.dot && (cause === 'starve' || cause === 'thirst' || cause === 'cold'))) Tributes.setSleeping(t, false);
    if (!info.dot || dmg >= 3) {
      t.anim.flash = Math.max(t.anim.flash, info.dot ? 0.08 : 0.14);
      if (!info.dot && dmg >= 6 && t.health > 0 && !t.anim.atk.on) Tributes.gesture(t, 'flinch', 0.35);
    }
    const AI = GM.AI;
    if (AI && typeof AI.onDamaged === 'function') {
      try { AI.onDamaged(t, info); } catch (err) { GM.reportError('Tributes.onDamaged', err); }
    }
    GM.emit('tribute:damaged', { tribute: t, amount: dmg, cause: cause, attacker: atk, pos: t.pos });
    if (t.alive && t.health <= 0.001) {
      t.health = 0;
      Tributes.kill(t, info);
    }
    return dmg;
  };

  function districtPartner(t) {
    const list = GM.state.tributes;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (o && o !== t && o.district === t.district) return o;
    }
    return null;
  }

  function logDeath(t, killer, credit, cause, info, wasAsleep, firstBlood) {
    const pos = t.pos;
    if (killer) {
      const D = GM.ItemDefs || {};
      const weapon = info.weapon && D[info.weapon] ? info.weapon : null;
      const p = {
        killer: killer.name, victim: t.name,
        weapon: '@item.' + (weapon || 'fists') + '.a', cause: '@cause.' + cause,
      };
      let key;
      if (credit === 'trap') key = variant('log.kill.trap');
      else if (credit === 'bleed') key = variant('log.kill.bleed');
      else if (credit === 'env') key = variant('log.kill.env');
      else if (killer.district === t.district) key = 'log.kill.partner';
      else if (wasAsleep) key = variant('log.kill.sleep');
      else if (info.sneak) key = variant('log.kill.sneak');
      else if (weapon === 'bow') key = variant('log.kill.bow');
      else if (weapon === 'throwing_knives') key = variant('log.kill.thrown');
      else if (!weapon || cause === 'fists') key = variant('log.kill.fists');
      else key = variant('log.kill.melee');
      const ids = [killer.id, t.id];
      GM.log('kill', key, p, { pos: pos, tributeIds: ids, important: true });
      if (firstBlood) GM.log('kill', 'log.kill.firstBlood', {}, { pos: pos, tributeIds: ids, important: true });
      const partner = districtPartner(killer);
      if (partner && partner !== t && !partner.alive && partner.killedBy === t.id) {
        GM.log('kill', 'log.kill.revenge', { killer: killer.name, partner: partner.name }, { pos: pos, tributeIds: ids });
      }
      if (killer.kills >= 3) GM.log('kill', 'log.kill.streak', { killer: killer.name, n: killer.kills }, { pos: pos, tributeIds: [killer.id] });
    } else {
      const base = 'log.death.' + cause;
      GM.log('death', VARIANTS[base] ? variant(base) : variant('log.death.unknown'), { victim: t.name }, { pos: pos, tributeIds: [t.id], important: true });
    }
  }

  /**
   * Death: fall animation, inventory dropped, kill credit (direct attacker,
   * trap owner, bleeding wound, or whoever hit t in the last 8 s before an
   * environmental death), placement, log, 'tribute:died', interest.
   */
  Tributes.kill = function (t, info) {
    if (!t || !t.alive) return;
    const st = GM.state;
    info = info || {};
    const cause = info.cause || 'unknown';
    const wasAsleep = info.wasAsleep != null ? !!info.wasAsleep : t.sleeping;
    const firstBlood = !st.deaths || st.deaths.length === 0;
    t.alive = false;
    t.health = 0;
    t.sleeping = false;
    t.sneaking = false;
    t.hidden = false;
    t.drowning = false;
    t.cold = false;
    stopNav(t);
    t.nav.hasGoal = false;
    t.nav.kx = t.nav.kz = 0;
    t.nav.speed = 0;
    t.vel.set(0, 0, 0);
    for (let i = 0; i < STATUS_NAMES.length; i++) t.status[STATUS_NAMES[i]] = 0;
    for (let i = 0; i < DOT_KEYS.length; i++) t.dot[DOT_KEYS[i]] = 0;
    t.healLeft = 0;

    // kill credit
    let killer = info.attacker && info.attacker.kind === 'tribute' && info.attacker !== t ? info.attacker : null;
    let credit = killer ? 'direct' : null;
    if (!killer && info.trapOwnerId != null) {
      const o = Tributes.get(info.trapOwnerId);
      if (o && o !== t) { killer = o; credit = 'trap'; }
    }
    if (!killer && info.bleed && info.bleedBy != null) {
      const o = Tributes.get(info.bleedBy);
      if (o && o !== t) { killer = o; credit = 'bleed'; }
    }
    if (!killer && !DIRECT_CAUSES[cause] && cause !== 'smite' && t.lastAttackedBy != null && now() - t.lastAttackedAt <= KILL_CREDIT_WINDOW) {
      const o = Tributes.get(t.lastAttackedBy);
      if (o && o !== t) { killer = o; credit = 'env'; }
    }
    if (killer) killer.kills = (killer.kills || 0) + 1;
    t.killedBy = killer ? killer.id : null;
    t.deathCause = cause;
    t.deathWeapon = info.weapon || null;
    t.deathTime = now();
    t.deathDay = st.day;
    t.placement = Tributes.aliveCount() + 1;

    // fall away from whatever killed us
    const a = t.anim;
    a.dead = 0;
    a.atk.on = false;
    a.gest.on = false;
    a.flash = 0.2;
    let dir = -1;
    const src = (killer && credit === 'direct' ? killer.pos : null) || (info.mutt && info.mutt.pos) || info.pos || null;
    if (src) {
      const hx = src.x - t.pos.x, hz = src.z - t.pos.z;
      if (hx * hx + hz * hz > 0.01) dir = Math.abs(U.angleDiff(t.heading, Math.atan2(hx, hz))) < HP ? -1 : 1;
    }
    a.deathDir = dir;
    a.deathTwist = Math.random() < 0.5 ? -1 : 1;

    if (GM.Items && typeof GM.Items.dropAll === 'function') {
      try { GM.Items.dropAll(t); } catch (err) { GM.reportError('Tributes.dropAll', err); }
    } else {
      t.inv = emptyInv();
    }
    Tributes.refreshGear(t);

    try { logDeath(t, killer, credit, cause, info, wasAsleep, firstBlood); } catch (err) { GM.reportError('Tributes.logDeath', err); }
    GM.emit('tribute:died', { tribute: t, killer: killer, cause: cause, weapon: info.weapon || null, pos: t.pos });
    GM.addInterest({
      pos: t.pos, score: 10, duration: 12, kind: 'death', key: 'death:' + t.id,
      label: { key: 'tribute.interest.death', params: { name: t.name } },
      followId: killer && killer.alive ? killer.id : null,
    });
    aiNoise(t.pos, 35, 'scream', t.id);
    sfx('scream', t.pos, 0.7);
  };

  /** Heal (clamped to maxHealth). Emits 'tribute:healed'. Returns the amount healed. */
  Tributes.heal = function (t, amount) {
    if (!t || !t.alive || !(amount > 0)) return 0;
    const h = Math.min(amount, t.maxHealth - t.health);
    if (!(h > 0)) return 0;
    t.health += h;
    GM.emit('tribute:healed', { tribute: t, amount: h });
    return h;
  };

  // ======================================================== status + sleep
  Tributes.setSleeping = function (t, on) {
    if (!t || !t.alive) return false;
    on = !!on;
    if (t.sleeping === on) return true;
    if (on && t.swimming) return false;
    t.sleeping = on;
    if (on) {
      stopNav(t);
      t.sneaking = false;
      t.sleepAt = now();
      t.anim.atk.on = false;
      t.anim.gest.on = false;
    } else {
      t.wokeAt = now();
    }
    return true;
  };

  /** Set a status timer (sim s): max of old and new; seconds <= 0 clears it. */
  Tributes.setStatus = function (t, name, seconds) {
    if (!t || !t.alive || !t.status || !name) return;
    seconds = +seconds || 0;
    if (seconds <= 0) { t.status[name] = 0; return; }
    if (name === 'burning' && t.inWater) return;
    t.status[name] = Math.max(t.status[name] || 0, seconds);
    if (name === 'stun') {
      if (t.sleeping) Tributes.setSleeping(t, false);
      t.anim.atk.on = false;
    }
  };

  Tributes.stun = function (t, seconds) {
    if (!t || !t.alive || !(seconds > 0)) return;
    Tributes.setStatus(t, 'stun', seconds);
  };

  /** Push a tribute (force ≈ initial m/s, decays quickly). */
  Tributes.knockback = function (t, dirX, dirZ, force) {
    if (!t || !t.alive || !t.nav) return;
    const l = Math.sqrt(dirX * dirX + dirZ * dirZ);
    if (!(l > 1e-6) || !(force > 0)) return;
    const f = force * (t.swimming ? 0.5 : 1);
    const nav = t.nav;
    nav.kx += dirX / l * f;
    nav.kz += dirZ / l * f;
    const m = Math.sqrt(nav.kx * nav.kx + nav.kz * nav.kz);
    if (m > 14) { nav.kx *= 14 / m; nav.kz *= 14 / m; }
    if (t.sleeping) Tributes.setSleeping(t, false);
  };

  /** Short red hit flash on the body. */
  Tributes.flash = function (t, seconds) {
    if (!t || !t.anim) return;
    t.anim.flash = Math.max(t.anim.flash, seconds || 0.12);
  };
  /** Body gesture: pickup, forage, trap, drink, eat, heal, victory, wave, flinch. */
  Tributes.gesture = function (t, type, seconds) {
    if (!t || !t.alive || !t.anim) return;
    if (t.sleeping && type !== 'flinch') return;
    const g = t.anim.gest;
    g.on = true;
    g.type = type || 'pickup';
    g.t = 0;
    g.dur = seconds || 0.8;
  };
  /** Attack animation: slash, chop, stab, thrust, punch, draw (bow), throw. */
  Tributes.playAttack = function (t, type, seconds) {
    if (!t || !t.alive || !t.anim) return;
    const k = t.anim.atk;
    k.on = true;
    k.type = type || 'slash';
    k.t = 0;
    k.dur = Math.max(0.15, seconds || 0.5);
    t.anim.gest.on = false;
  };

  /** Active effects for the UI: [{id, key, descKey, icon, time}]. */
  Tributes.statusList = function (t) {
    const out = [];
    if (!t || !t.alive) return out;
    const s = t.status || {};
    const add = function (id, time) {
      out.push({ id: id, key: 'status.' + id, descKey: 'status.' + id + '.desc', icon: STATUS_ICONS[id] || '', time: time || 0 });
    };
    if (t.sleeping) add('asleep');
    for (let i = 0; i < STATUS_NAMES.length; i++) if (s[STATUS_NAMES[i]] > 0) add(STATUS_NAMES[i], s[STATUS_NAMES[i]]);
    if (t.drowning) add('drowning'); else if (t.swimming) add('swimming');
    if (t.cold) add('cold');
    if (t.hunger >= 100) add('starving');
    if (t.thirst >= 100) add('thirsty');
    if (t.energy < 10 && !t.sleeping) add('exhausted');
    if (t.healLeft > 0) add('healing', t.healLeft / 9);
    if (t.hidden) add('hidden'); else if (t.sneaking) add('sneaking');
    if (t.inv && t.inv.armor) add('armored');
    return out;
  };

  // ============================================================ survival
  /** Use one carried supply: 'food' | 'water' | 'medkit' | 'berries'. */
  Tributes.consume = function (t, what) {
    if (!t || !t.alive || !t.inv || !(t.inv[what] > 0)) return false;
    const D = GM.ItemDefs || {};
    const def = D[what] || {};
    const inv = t.inv;
    if (t.sleeping) Tributes.setSleeping(t, false);
    switch (what) {
      case 'food':
        inv.food--;
        t.hunger = Math.max(0, t.hunger - num(def.hunger, 45));
        Tributes.gesture(t, 'eat', 1.1);
        sfx('eat', t.pos, 0.7);
        break;
      case 'water':
        inv.water--;
        t.thirst = Math.max(0, t.thirst - num(def.thirst, 50));
        Tributes.gesture(t, 'eat', 1.0);
        sfx('eat', t.pos, 0.5, 1.3);
        break;
      case 'medkit': {
        inv.medkit--;
        const amount = num(def.heal, 45);
        const expected = Math.min(amount, t.maxHealth - t.health);
        t.healLeft += amount;
        t.status.bleeding = 0;
        t.status.poison = 0;
        t.woundBy = null;
        if (expected > 0) GM.emit('tribute:healed', { tribute: t, amount: expected });
        Tributes.gesture(t, 'heal', 1.6);
        sfx('heal', t.pos, 0.8);
        FXP.x = t.pos.x; FXP.y = t.pos.y + 1.1; FXP.z = t.pos.z;
        fx('burst', FXP, { count: 10, color: 0x7dff9a, color2: 0xffffff, speed: 1.2, up: 1.5, gravity: 0.5, size: 0.18, life: 0.9, additive: true });
        break;
      }
      case 'berries': {
        inv.berries--;
        t.hunger = Math.max(0, t.hunger - num(def.hunger, 20));
        Tributes.gesture(t, 'eat', 0.9);
        sfx('eat', t.pos, 0.6, 1.2);
        const p = num(def.nightlock, 0.1) * (1 - skill(t, 'survival'));
        if (GM.R.chance(p)) {
          Tributes.setStatus(t, 'poison', 22);
          GM.log('item', 'log.item.nightlock', { name: t.name }, { pos: t.pos, tributeIds: [t.id], important: true });
          GM.addInterest({
            pos: t.pos, score: 4, duration: 8, followId: t.id, kind: 'poison', key: 'nightlock:' + t.id,
            label: { key: 'tribute.interest.poison', params: { name: t.name } },
          });
        }
        break;
      }
      default:
        return false;
    }
    Tributes.refreshGear(t);
    GM.emit('item:used', { tribute: t, type: what });
    return true;
  };

  /** Drink from nearby water (must be within ~3 m of it). */
  Tributes.drink = function (t) {
    if (!t || !t.alive) return false;
    const p = t.pos;
    let ok = t.inWater || isWater(p.x, p.z);
    for (let r = 1.5; r <= 3.01 && !ok; r += 1.5) {
      for (let k = 0; k < 8; k++) {
        const a = k * TAU / 8;
        if (isWater(p.x + Math.sin(a) * r, p.z + Math.cos(a) * r)) {
          ok = true;
          t.heading = a;
          if (t.nav) t.nav.faceUntil = now() + 1.5;
          break;
        }
      }
    }
    if (!ok) return false;
    if (t.sleeping) Tributes.setSleeping(t, false);
    t.thirst = Math.max(0, t.thirst - 60);
    if (t.status.burning > 0) t.status.burning = 0;
    Tributes.gesture(t, 'drink', 1.6);
    sfx('splash', p, 0.45);
    return true;
  };

  /**
   * Search for food (call repeatedly with dt). Chance by survival skill and
   * cover; returns 'berries' | 'food' when something was found, else null.
   */
  Tributes.forage = function (t, dt) {
    if (!t || !t.alive || t.swimming || !t.inv) return null;
    dt = num(dt, 0.5);
    const p = t.pos;
    const b = biomeAt(p.x, p.z);
    const rich = Math.max(BIOME_FOOD[b] != null ? BIOME_FOOD[b] : 0.1, forestAt(p.x, p.z));
    let rate = (0.015 + 0.06 * skill(t, 'survival')) * (0.25 + rich);
    if (isNight() && !t.inv.goggles) rate *= 0.6;
    t.forageT += dt;
    if (t.forageT > 1.6) {
      t.forageT = 0;
      Tributes.gesture(t, 'forage', 1.3);
    }
    if (!GM.R.chance(Math.min(0.5, rate * dt))) return null;
    const D = GM.ItemDefs || {};
    let type = GM.R.random() < 0.62 + 0.1 * rich ? 'berries' : 'food';
    const capOf = function (ty) { return (D[ty] && D[ty].cap) || (ty === 'berries' ? 10 : 6); };
    if ((t.inv[type] || 0) >= capOf(type)) type = type === 'berries' ? 'food' : 'berries';
    if ((t.inv[type] || 0) >= capOf(type)) return null;
    t.inv[type] = (t.inv[type] || 0) + 1;
    Tributes.gesture(t, 'pickup', 0.7);
    Tributes.refreshGear(t);
    GM.emit('item:pickup', { tribute: t, type: type, source: 'forage' });
    return type;
  };

  // ============================================================= animation
  // Pose values are gathered in P (no allocations) and written to the rig.
  const P = {
    bodyY: 0, bodyZ: 0, bodyRX: 0, bodyRY: 0, bodyRZ: 0, hipsY: LEG,
    tX: 0, tY: 0, tZ: 0, nX: 0, nY: 0, nZ: 0,
    lsX: 0, lsY: 0, lsZ: 0, rsX: 0, rsY: 0, rsZ: 0, lhX: 0, lhZ: 0, rhX: 0, rhZ: 0,
  };
  function resetPose() {
    P.bodyY = 0; P.bodyZ = 0; P.bodyRX = 0; P.bodyRY = 0; P.bodyRZ = 0; P.hipsY = LEG;
    P.tX = 0; P.tY = 0; P.tZ = 0; P.nX = 0; P.nY = 0; P.nZ = 0;
    P.lsX = 0; P.lsY = 0; P.lsZ = 0.07; P.rsX = 0; P.rsY = 0; P.rsZ = -0.07;
    P.lhX = 0; P.lhZ = 0; P.rhX = 0; P.rhZ = 0;
  }
  /** Attack curve: ease into the wind-up (w), snap to the strike (s), recover to 0. */
  function atkVal(p, w, s) {
    if (p < 0.38) { const u = p / 0.38; return w * u * (2 - u); }
    if (p < 0.56) { const u = (p - 0.38) / 0.18; return w + (s - w) * u * u * (3 - 2 * u); }
    const u = (p - 0.56) / 0.44;
    return s * (1 - u * u * (3 - 2 * u));
  }
  /** Bow curve: long draw and hold, quick release. */
  function drawVal(p, w, s) {
    if (p < 0.72) return w * Math.min(1, (p / 0.72) * 1.8);
    if (p < 0.8) return w + (s - w) * ((p - 0.72) / 0.08);
    return s * (1 - (p - 0.8) / 0.2);
  }
  function bump(p) { return Math.sin(Math.PI * U.clamp01(p)); }
  function holdCurve(p) { const k = U.clamp01(p); return Math.min(1, k / 0.18, (1 - k) / 0.2); }
  function lerpP(key, v, k) { P[key] += (v - P[key]) * k; }

  function poseAttack(atk) {
    const p = U.clamp01(atk.t / Math.max(0.05, atk.dur));
    switch (atk.type) {
      case 'slash':
        P.rsX += atkVal(p, -2.3, -0.9); P.rsZ += atkVal(p, -0.8, 0.65);
        P.tY += atkVal(p, -0.45, 0.45); P.tX += atkVal(p, -0.05, 0.12);
        P.lsX += atkVal(p, -0.5, 0.2);
        break;
      case 'chop':
        P.rsX += atkVal(p, -2.9, -0.55); P.rsZ += atkVal(p, -0.15, 0.1);
        P.lsX += atkVal(p, -1.2, -0.3);
        P.tX += atkVal(p, -0.18, 0.35); P.tY += atkVal(p, -0.2, 0.15);
        break;
      case 'thrust':
        P.rsX += atkVal(p, -0.55, -1.45); P.lsX += atkVal(p, -0.95, -1.5);
        P.rsZ += atkVal(p, 0.1, 0.3); P.lsZ += atkVal(p, -0.2, -0.35);
        P.tX += atkVal(p, -0.1, 0.28); P.tY += atkVal(p, -0.25, 0.1);
        P.bodyZ += atkVal(p, -0.08, 0.28);
        break;
      case 'draw':
        P.lsX += drawVal(p, -1.52, -1.5); P.lsZ += drawVal(p, -0.12, -0.1);
        P.rsX += drawVal(p, -1.45, -1.2); P.rsZ += drawVal(p, 0.85, 0.3);
        P.tY += drawVal(p, 0.55, 0.45); P.nY += drawVal(p, -0.5, -0.4);
        break;
      case 'throw':
        P.rsX += atkVal(p, -2.7, -0.55); P.rsZ += atkVal(p, -0.4, 0.2);
        P.lsX += atkVal(p, -0.9, 0.3);
        P.tY += atkVal(p, -0.5, 0.45); P.tX += atkVal(p, -0.12, 0.2);
        break;
      case 'punch':
        P.lsX += -0.95 * bump(p); P.lsZ += -0.2 * bump(p);
        P.rsX += atkVal(p, 0.35, -1.55); P.rsZ += atkVal(p, -0.05, 0.3);
        P.tY += atkVal(p, -0.3, 0.35);
        break;
      default: // stab
        P.rsX += atkVal(p, 0.4, -1.55); P.rsZ += atkVal(p, -0.1, 0.25);
        P.tY += atkVal(p, -0.3, 0.35); P.tX += atkVal(p, 0, 0.12);
        break;
    }
  }

  function poseGesture(g, ip) {
    const p = U.clamp01(g.t / Math.max(0.05, g.dur));
    const b = g.type === 'flinch' ? bump(p) : holdCurve(p);
    switch (g.type) {
      case 'pickup':
      case 'forage':
        P.tX += 0.95 * b; P.hipsY -= 0.1 * b; P.nX -= 0.25 * b;
        P.rsX += -0.85 * b + (g.type === 'forage' ? Math.sin(ip * 9) * 0.15 * b : 0);
        P.lsX += -0.55 * b;
        P.lhX += -0.25 * b; P.rhX += 0.2 * b;
        break;
      case 'trap':
        P.tX += 1.05 * b; P.hipsY -= 0.2 * b; P.nX -= 0.3 * b;
        P.lhX += -0.55 * b; P.rhX += 0.35 * b;
        P.rsX += (-0.95 + Math.sin(ip * 12) * 0.18) * b;
        P.lsX += (-0.8 + Math.sin(ip * 12 + 1.5) * 0.18) * b;
        break;
      case 'drink':
        P.tX += 1.2 * b; P.hipsY -= 0.26 * b; P.nX -= 0.2 * b;
        P.lhX += -0.6 * b; P.rhX += 0.4 * b;
        P.rsX += -1.1 * b; P.lsX += -1.0 * b;
        break;
      case 'eat':
        P.rsX += -2.25 * b; P.rsZ += 0.6 * b;
        P.nX += 0.12 * b + Math.sin(ip * 10) * 0.04 * b;
        break;
      case 'heal':
        P.lsX += -0.85 * b; P.rsX += -0.9 * b; P.lsZ += -0.55 * b; P.rsZ += 0.55 * b;
        P.tX += 0.3 * b; P.nX += 0.35 * b;
        break;
      case 'victory':
        P.lsX += -2.9 * b; P.rsX += -2.9 * b; P.lsZ += 0.25 * b; P.rsZ -= 0.25 * b;
        P.tX -= 0.12 * b; P.nX -= 0.25 * b;
        break;
      case 'wave':
        P.rsX += -2.6 * b; P.rsZ += (-0.3 + Math.sin(ip * 10) * 0.35) * b;
        break;
      case 'flinch':
        P.tX -= 0.28 * b; P.nX -= 0.3 * b; P.tZ += 0.1 * b; P.lsX -= 0.4 * b; P.rsX -= 0.3 * b;
        break;
      default:
        break;
    }
  }

  function poseSwim(k, sp, ph, ip) {
    const mv = U.clamp01(sp / 0.8);
    P.bodyRX += (HP * 0.92 * mv - P.bodyRX) * k;
    P.bodyY += (mv * -0.22 + (1 - mv) * -1.3 - P.bodyY) * k;
    P.bodyZ += (-0.92 * mv - P.bodyZ) * k;
    lerpP('hipsY', LEG, k);
    lerpP('tX', 0, k);
    lerpP('tY', Math.sin(ph) * 0.25 * mv, k);
    lerpP('nX', -0.85 * mv, k);
    lerpP('nY', 0, k);
    // crawl stroke when moving, sculling when treading water
    const scull = Math.sin(ip * 4) * 0.25;
    lerpP('lsX', mv > 0.5 ? -ph : -0.3 + scull, k);
    lerpP('rsX', mv > 0.5 ? -(ph + Math.PI) : -0.3 - scull, k);
    lerpP('lsZ', mv > 0.5 ? 0.15 : 0.9, k);
    lerpP('rsZ', mv > 0.5 ? -0.15 : -0.9, k);
    const kick = Math.sin((mv > 0.5 ? ph : ip * 2) * 3) * 0.3;
    lerpP('lhX', kick, k);
    lerpP('rhX', -kick, k);
  }

  function poseSleep(k, ip) {
    lerpP('bodyRZ', HP, k);
    lerpP('bodyY', 0.2, k);
    lerpP('bodyRX', 0, k);
    lerpP('hipsY', LEG, k);
    lerpP('tX', 0.12 + Math.sin(ip * 1.1) * 0.025, k);
    lerpP('tY', 0, k);
    lerpP('tZ', 0, k);
    lerpP('nX', 0.25, k);
    lerpP('nY', 0, k);
    lerpP('lhX', -0.75, k);
    lerpP('rhX', -0.35, k);
    lerpP('lsX', -1.0, k);
    lerpP('rsX', -0.7, k);
    lerpP('lsZ', -0.2, k);
    lerpP('rsZ', -0.1, k);
  }

  function poseDeath(a) {
    const p = U.clamp01(a.dead);
    let e;
    if (p < 0.72) { const u = p / 0.72; e = u * u; } else e = 1 - 0.06 * Math.sin(((p - 0.72) / 0.28) * Math.PI);
    P.bodyRX = a.deathDir * HP * 0.96 * e;
    P.bodyY = 0.13 * U.clamp01(e);
    P.lsZ = 1.25 * e;
    P.rsZ = -1.1 * e;
    P.lsX = -0.2 * e;
    P.rsX = 0.15 * e;
    P.lhZ = 0.14 * e;
    P.rhZ = -0.1 * e;
    P.lhX = 0.12 * e;
    P.nY = 0.7 * a.deathTwist * e;
    P.nX = -0.15 * e;
  }

  function applyPose(t, time) {
    const rig = t.rig, a = t.anim;
    resetPose();
    const ip = time + a.phase;
    if (!t.alive) {
      poseDeath(a);
    } else {
      const sp = t.nav.speed;
      const moveK = a.move;
      const runK = U.clamp01((sp - 2.4) / 2.8);
      const ph = a.walk, s = Math.sin(ph), c = Math.cos(ph);
      const busy = a.atk.on || a.gest.on;
      // locomotion
      const legAmp = (0.42 + 0.38 * runK) * moveK;
      P.lhX = s * legAmp;
      P.rhX = -s * legAmp;
      const armAmp = (0.32 + 0.6 * runK) * moveK * (busy ? 0.25 : 1);
      P.lsX = -s * armAmp;
      P.rsX = s * armAmp;
      P.lsZ = 0.07 + 0.05 * runK;
      P.rsZ = -0.07 - 0.05 * runK;
      P.hipsY = LEG * Math.cos(Math.abs(s) * legAmp) + Math.abs(c) * 0.035 * runK * moveK;
      P.tX = 0.05 * moveK + 0.17 * runK * moveK;
      P.tY = s * 0.09 * moveK;
      // idle: breathing and looking around
      const idle = 1 - moveK;
      P.tX += Math.sin(ip * 1.9) * 0.018 * idle;
      P.nY = Math.sin(ip * 0.37) * 0.45 * idle;
      P.nX = Math.sin(ip * 0.23 + 1.3) * 0.08 * idle;
      P.lsZ += Math.sin(ip * 1.9) * 0.02 * idle;
      P.rsZ -= Math.sin(ip * 1.9) * 0.02 * idle;
      // sneaking / hiding crouch
      const cr = a.crouch;
      if (cr > 0.01) {
        P.hipsY -= 0.12 * cr;
        P.lhX += -0.38 * cr;
        P.rhX += 0.3 * cr;
        P.tX += 0.45 * cr;
        P.nX -= 0.35 * cr;
        P.lsX -= 0.35 * cr;
        P.rsX -= 0.45 * cr;
      }
      if (a.atk.on) poseAttack(a.atk);
      if (a.gest.on) poseGesture(a.gest, ip);
      // stunned wobble
      if (a.stun > 0.01) {
        const k = a.stun;
        P.tZ += Math.sin(ip * 9) * 0.13 * k;
        P.nZ += Math.sin(ip * 11 + 1) * 0.22 * k;
        P.tX += 0.18 * k;
        P.nX += 0.25 * k;
        P.lsZ += 0.15 * k;
        P.rsZ -= 0.15 * k;
      }
      if (a.swim > 0.01) poseSwim(a.swim, sp, ph, ip);
      if (a.sleep > 0.01) poseSleep(a.sleep, ip);
    }
    rig.body.position.set(0, P.bodyY, P.bodyZ);
    rig.body.rotation.set(P.bodyRX, P.bodyRY, P.bodyRZ);
    rig.hips.position.y = P.hipsY;
    rig.torso.rotation.set(P.tX, P.tY, P.tZ);
    rig.neck.rotation.set(P.nX, P.nY, P.nZ);
    rig.shL.rotation.set(P.lsX, P.lsY, P.lsZ);
    rig.shR.rotation.set(P.rsX, P.rsY, P.rsZ);
    rig.hipL.rotation.set(P.lhX, 0, P.lhZ);
    rig.hipR.rotation.set(P.rhX, 0, P.rhZ);
  }

  function applyFlash(t, realDt) {
    const rig = t.rig, a = t.anim;
    if (a.flash > 0) a.flash = Math.max(0, a.flash - realDt);
    const on = a.flash > 0;
    if (on === rig.flashing) return;
    rig.flashing = on;
    const fm = on ? flashMat() : null;
    for (let i = 0; i < rig.meshes.length; i++) rig.meshes[i].material = on ? fm : rig.baseMats[i];
  }

  /** Sim-time animation state: attack / gesture timers and smooth blends. */
  function animTick(t, dt) {
    const a = t.anim;
    if (a.atk.on) { a.atk.t += dt; if (a.atk.t >= a.atk.dur) a.atk.on = false; }
    if (a.gest.on) { a.gest.t += dt; if (a.gest.t >= a.gest.dur) a.gest.on = false; }
    const k8 = 1 - Math.exp(-8 * dt);
    a.move += (U.clamp01(t.nav.speed / 1.2) - a.move) * k8;
    a.swim += ((t.swimming ? 1 : 0) - a.swim) * (1 - Math.exp(-5 * dt));
    a.sleep += ((t.sleeping ? 1 : 0) - a.sleep) * (1 - Math.exp(-3 * dt));
    a.crouch += ((t.sneaking ? 1 : t.hidden ? 0.75 : 0) - a.crouch) * (1 - Math.exp(-6 * dt));
    a.stun += ((t.status.stun > 0 ? 1 : 0) - a.stun) * k8;
  }

  // ================================================= hovercraft body pickup
  const pickups = [];
  const CRAFT_HOVER = 16;

  function craftGeo() {
    return kitGeo('craft', function () {
      return mergeParts([
        { g: new THREE.CylinderGeometry(2.1, 3.1, 0.9, 8), c: 0x2b2f36, s: [1, 1, 1.6] },
        { g: new THREE.CylinderGeometry(1.2, 2.0, 0.8, 8), c: 0x3c424c, p: [0, 0.8, 0.4], s: [1, 1, 1.4] },
        { g: new THREE.BoxGeometry(9, 0.2, 1.7), c: 0x23272d, p: [0, 0.1, -0.9] },
        { g: new THREE.BoxGeometry(1.5, 0.32, 0.7), c: 0x8fd3ff, p: [0, 0.95, 1.95] },
        { g: new THREE.CylinderGeometry(0.35, 0.35, 0.22, 8), c: 0xff4a3c, p: [4.3, 0.22, -0.9] },
        { g: new THREE.CylinderGeometry(0.35, 0.35, 0.22, 8), c: 0x5cff7a, p: [-4.3, 0.22, -0.9] },
        { g: new THREE.CylinderGeometry(0.95, 1.15, 0.3, 8), c: 0x121417, p: [0, -0.55, 0] },
        { g: new THREE.BoxGeometry(0.4, 0.5, 1.2), c: 0xc9a227, p: [0, 0.2, -3.0] },
      ]);
    });
  }
  function cableGeo() {
    return kitGeo('cable', function () {
      const g = new THREE.CylinderGeometry(0.05, 0.05, 1, 5);
      g.translate(0, -0.5, 0);
      return g;
    });
  }
  function clawGeo() {
    return kitGeo('claw', function () {
      const parts = [{ g: new THREE.CylinderGeometry(0.22, 0.28, 0.2, 6), c: 0x6d737c }];
      for (let i = 0; i < 3; i++) {
        const a = i * TAU / 3;
        parts.push({ g: new THREE.BoxGeometry(0.07, 0.6, 0.07), c: 0x9aa1aa, p: [Math.sin(a) * 0.3, -0.3, Math.cos(a) * 0.3], r: [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45] });
      }
      return mergeParts(parts);
    });
  }

  function startPickup(t) {
    const pos = t.pos;
    const ang = Math.random() * TAU;
    const hy = pos.y + CRAFT_HOVER;
    const pk = {
      t: t, stage: 0, timer: 0, group: null, cable: null, claw: null,
      sx: pos.x + Math.sin(ang) * 110, sy: hy + 30, sz: pos.z + Math.cos(ang) * 110,
      hx: pos.x, hy: hy, hz: pos.z,
      ex: pos.x - Math.sin(ang) * 150, ey: hy + 55, ez: pos.z - Math.cos(ang) * 150,
    };
    t.body = pk;
    if (hasThree() && sceneRef()) {
      const g = new THREE.Group();
      g.name = 'hovercraft';
      const craft = new THREE.Mesh(craftGeo(), vcMat());
      craft.castShadow = GM.state.settings ? GM.state.settings.quality !== 'low' : true;
      g.add(craft);
      const cable = new THREE.Mesh(cableGeo(), vcMat());
      cable.position.y = -0.6;
      cable.scale.y = 0.001;
      g.add(cable);
      const claw = new THREE.Mesh(clawGeo(), vcMat());
      claw.position.y = -0.6;
      g.add(claw);
      g.position.set(pk.sx, pk.sy, pk.sz);
      g.rotation.y = Math.atan2(pk.hx - pk.sx, pk.hz - pk.sz);
      pk.group = g;
      pk.cable = cable;
      pk.claw = claw;
      addToScene(g);
    }
    GM.addInterest({
      pos: pos, score: 3, duration: 14, kind: 'hovercraft', key: 'body:' + t.id,
      label: { key: 'tribute.interest.body', params: { name: t.name } },
    });
    pickups.push(pk);
  }

  function setCable(pk, len) {
    if (!pk.cable) return;
    len = Math.max(0.001, len);
    pk.cable.scale.y = len;
    pk.claw.position.y = -0.6 - len;
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const pk = pickups[i];
      const t = pk.t;
      const g = pk.group;
      pk.timer += dt;
      const bob = Math.sin(animClock * 1.3 + t.id) * 0.25;
      if (pk.stage === 0) {                       // fly in
        const u = U.smoothstep(0, 1, pk.timer / 4);
        if (g) g.position.set(U.lerp(pk.sx, pk.hx, u), U.lerp(pk.sy, pk.hy, u) + bob * u, U.lerp(pk.sz, pk.hz, u));
        if (pk.timer >= 4) { pk.stage = 1; pk.timer = 0; }
      } else if (pk.stage === 1) {                // lower the claw
        const u = U.clamp01(pk.timer / 1.4);
        if (g) g.position.y = pk.hy + bob;
        setCable(pk, (pk.hy - 0.9 - (t.pos.y + 0.3)) * u);
        if (pk.timer >= 1.4) {
          pk.stage = 2;
          pk.timer = 0;
          fx('beam', new THREE.Vector3(pk.hx, pk.hy - 0.7, pk.hz), new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z), 0x9fe8ff, 0.9, 4.4);
          sfx('zap', t.pos, 0.6, 0.7);
        }
      } else if (pk.stage === 2) {                // lift the body
        const u = U.smoothstep(0, 1, pk.timer / 4.2);
        if (g) g.position.y = pk.hy + bob;
        t.anim.lift = u * Math.max(0, pk.hy - 1.4 - t.pos.y);
        t.anim.liftSpin = u * 1.6;
        setCable(pk, pk.hy - 0.9 - (t.pos.y + 0.3 + t.anim.lift));
        if (pk.timer >= 4.2) {
          pk.stage = 3;
          pk.timer = 0;
          if (t.mesh) removeFromScene(t.mesh);
          t.bodyGone = true;
          setCable(pk, 0);
        }
      } else {                                    // fly away
        const u = pk.timer / 4.5;
        const e = u * u;
        if (g) {
          g.position.set(U.lerp(pk.hx, pk.ex, e), U.lerp(pk.hy, pk.ey, e), U.lerp(pk.hz, pk.ez, e));
          g.rotation.y = Math.atan2(pk.ex - pk.hx, pk.ez - pk.hz);
        }
        if (pk.timer >= 4.5) {
          if (g) removeFromScene(g);
          pk.group = pk.cable = pk.claw = null;
          pickups.splice(i, 1);
        }
      }
    }
  }

  function removePickups() {
    for (let i = 0; i < pickups.length; i++) if (pickups[i].group) removeFromScene(pickups[i].group);
    pickups.length = 0;
  }

  function deadTick(t, dt) {
    const a = t.anim;
    if (a.dead < 1) a.dead = Math.min(1, a.dead + dt / 0.85);
    if (!t.body) {
      // bodies rest on the ground (or float) even when the terrain changes
      const gy = groundY(t.pos.x, t.pos.z);
      t.pos.y = Math.max(gy, isWater(t.pos.x, t.pos.z) ? waterY() : gy);
      if (!t.bodyGone && t.deathTime != null && now() - t.deathTime >= BODY_PICKUP_DELAY) startPickup(t);
    }
  }

  // ================================================================ system
  function update(dt) {
    const st = GM.state;
    const list = st.tributes;
    if (!list || !list.length) return;
    animClock += dt;
    const phase = st.phase;
    const running = phase === 'running';
    if (running || phase === 'ended') processPaths();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t || !t.nav) continue;
      if (!t.alive) { deadTick(t, dt); continue; }
      if (running) needs(t, dt);
      statusTick(t, dt, running);
      locomotion(t, dt, phase);
      animTick(t, dt);
      if (running) dotFlush(t, dt);
      if (phase === 'ended' && st.winner === t.id && t.alive) {
        t.cheerT -= dt;
        if (t.cheerT <= 0 && !t.nav.moving && !t.anim.gest.on && !t.sleeping) {
          t.cheerT = 5 + Math.random() * 3;
          Tributes.gesture(t, 'victory', 2.2);
        }
      }
    }
    updatePickups(dt);
  }

  function frame(realDt) {
    pathsThisFrame = 0;
    const st = GM.state;
    const list = st.tributes;
    if (list && list.length) {
      const show = tagsOn();
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        if (!t || !t.mesh || !t.rig || !t.mesh.parent) continue;
        const m = t.mesh;
        m.position.set(t.pos.x, t.pos.y + t.anim.lift, t.pos.z);
        m.rotation.y = t.heading + t.anim.liftSpin;
        applyPose(t, animClock);
        applyFlash(t, realDt);
        updateTag(t, show);
      }
    }
    updateRing();
  }

  function clear() {
    const list = GM.state.tributes || [];
    for (let i = 0; i < list.length; i++) disposeTribute(list[i]);
    removePickups();
    pathQueue.length = 0;
    pathsThisFrame = 0;
    animClock = 0;
    if (selRing) {
      selRing.visible = false;
      removeFromScene(selRing);
    }
  }

  function reset(settings) {
    Tributes.spawnAll(settings && settings.roster);
  }

  GM.registerSystem({
    name: 'Tributes',
    order: 50,
    clear: clear,
    reset: reset,
    update: update,
    frame: frame,
  });
})();
