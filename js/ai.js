/* ==========================================================================
 * ai.js — the minds of the contestants: archetypes, perception, emotions,
 * utility-based decisions, action execution, alliances and betrayal.
 *
 *   GM.Archetypes[id]         {id, icon, color, nameKey, descKey, traits, skillBias, ...}
 *   GM.ARCHETYPE_IDS          ['elite','survivor','scavenger','opportunist',
 *                              'strategist','berserker','protector','lonewolf']
 *   GM.AI.pickArchetypes(n, mix, rng)   -> [archetype ids]
 *   GM.AI.initMind(t)                   traits, skills, emotions, memory, relations
 *   GM.AI.onDamaged(t, info)            fear / rage / grudge reactions
 *   GM.AI.noise(pos, radius, kind, sourceId)   something audible happened
 *   GM.AI.applyStatus(t, status, seconds)      madness / panic / stung (+ others)
 *   GM.AI.alliances / allianceOf(t)
 *   GM.AI.ACTIONS / actionIcon(id) / moodIcon(mood)
 *   extras: GM.AI.MOODS, TRAITS, EMOTIONS, relation(a, b), tension(), describe(t)
 *
 * Design (SPEC section 9):
 *   - Every contestant has a private mind (t.mind): memory of other contestants
 *     (last seen position / time), known items, water, dangers, heard noises,
 *     relations (trust, grudges), timers and the current plan.
 *   - Perception runs every ~0.35-0.5 sim s per contestant (staggered): sight
 *     cone, night / fog / forest cover / sneaking, beasts, items, crates,
 *     hazards, the force field and floods.
 *   - Emotions (fear, rage, confidence, sanity) move every tick toward
 *     baselines computed by perception, plus impulses from events.
 *   - Decisions every ~0.3-0.6 sim s: a utility score for every candidate
 *     action (needs x traits x emotions x situation), hysteresis for the
 *     current plan and erratic noise when sanity is low.
 *   - The chosen plan is executed every tick through GM.Contestants / GM.Combat /
 *     GM.Items; movement orders are only re-issued when the goal changes.
 *   - Pacing: tension rises every day and with every quiet minute; late in
 *     the Show everybody drifts toward the centre and the last known enemies.
 *
 * Every cross-module call is feature-detected: the AI never crashes when a
 * module is missing or broken.
 *
 * Owner: AI.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const U = GM.U;
  const R = GM.R;
  const TAU = Math.PI * 2;
  const MAXN = Math.max(48, CFG.MAX_CONTESTANTS | 0);
  const ARENA_R = CFG.ARENA_RADIUS;

  // ======================================================================
  // Strings (namespaces: arch.* act.* thought.* mood.* trait.*
  //          log.alliance.* log.betray.* log.mind.*)
  // ======================================================================
  GM.i18n.add({
    en: {
      // ---- archetypes
      'arch.elite': 'Elite',
      'arch.elite.desc': 'A trained killer. Runs to the Nexus, hunts in a pack with the other Elites, and trusts no one at the end.',
      'arch.survivor': 'Survivor',
      'arch.survivor.desc': 'Careful and clever. Finds food and water, hides well, and fights only when there is no way out.',
      'arch.scavenger': 'Scavenger',
      'arch.scavenger.desc': 'A scared looter. Runs from everyone, takes things from bodies and sleeping contestants, and loves supply drops.',
      'arch.opportunist': 'Opportunist',
      'arch.opportunist.desc': 'Lets the others fight first. Follows the sound of fights, finishes the wounded, and betrays friends.',
      'arch.strategist': 'Strategist',
      'arch.strategist.desc': 'Calm and patient. Sets traps near water and paths, and waits in ambush.',
      'arch.berserker': 'Berserker',
      'arch.berserker.desc': 'Wild and unstable. Gets angry fast, charges at enemies, and sometimes loses control, even against friends.',
      'arch.protector': 'Protector',
      'arch.protector.desc': 'Loyal and kind. Makes friends, defends them, shares food, and never betrays anyone.',
      'arch.lonewolf': 'Lone wolf',
      'arch.lonewolf.desc': 'Hunts alone. Moves quietly, follows lonely contestants, and likes to hunt at night.',

      // ---- traits
      'trait.aggression': 'Aggression',
      'trait.bravery': 'Bravery',
      'trait.greed': 'Greed',
      'trait.sociability': 'Friendliness',
      'trait.loyalty': 'Loyalty',
      'trait.cunning': 'Cunning',
      'trait.patience': 'Patience',
      'trait.stability': 'Stability',
      'trait.aggression.desc': 'How much this contestant wants to attack others.',
      'trait.bravery.desc': 'How well this contestant controls fear.',
      'trait.greed.desc': 'How much this contestant wants loot and supply drops.',
      'trait.sociability.desc': 'How easily this contestant makes friends.',
      'trait.loyalty.desc': 'How long this contestant stays true to allies.',
      'trait.cunning.desc': 'Tricks, traps, ambushes and betrayal.',
      'trait.patience.desc': 'How long this contestant can wait for the right moment.',
      'trait.stability.desc': 'How well the mind holds up under stress.',

      // ---- moods and emotions
      'mood.calm': 'Calm',
      'mood.afraid': 'Afraid',
      'mood.angry': 'Angry',
      'mood.confident': 'Confident',
      'mood.desperate': 'Desperate',
      'mood.mad': 'Mad',
      'mood.asleep': 'Asleep',
      'mood.hurt': 'Hurt',
      'mood.fear': 'Fear',
      'mood.rage': 'Rage',
      'mood.confidence': 'Confidence',
      'mood.sanity': 'Sanity',

      // ---- actions
      'act.idle': 'Waiting',
      'act.wander': 'Wandering',
      'act.loot': 'Looting',
      'act.flee': 'Fleeing',
      'act.hide': 'Hiding',
      'act.hunt': 'Hunting',
      'act.fight': 'Fighting',
      'act.stalk': 'Stalking',
      'act.drink': 'Drinking',
      'act.eat': 'Eating',
      'act.forage': 'Finding food',
      'act.rest': 'Resting',
      'act.sleep': 'Sleeping',
      'act.heal': 'Healing',
      'act.ally': 'Making an alliance',
      'act.follow': 'Following',
      'act.guard': 'Guarding',
      'act.trap': 'Setting a trap',
      'act.ambush': 'Ambush',
      'act.steal': 'Stealing',
      'act.investigate': 'Checking a noise',
      'act.feast': 'Going to the feast',
      'act.avoid': 'Avoiding danger',
      'act.escape_zone': 'Escaping the force field',
      'act.panic': 'Panic',
      'act.mad': 'Madness',
      'act.berserk': 'Blind rage',
      'act.kickoff': 'Opening rush',
      'act.scatter': 'Running away',

      // ---- thoughts
      'thought.pedestalRush': 'Looking at the weapons in the Nexus',
      'thought.pedestalEdge': 'Plan: grab something and run',
      'thought.pedestalScatter': 'Looking for a way out',
      'thought.pedestalElite': 'Smiling at the other Elites',
      'thought.kickoff': 'Running to the Nexus',
      'thought.grab': 'Grabbing {item}',
      'thought.scatter': 'Getting away from the opening rush',
      'thought.wander': 'Looking around',
      'thought.explore': 'Exploring the arena',
      'thought.drift': 'Going to the center. This must end.',
      'thought.searchEnemy': 'Looking for {target}',
      'thought.loot': 'Going for {item}',
      'thought.lootBody': 'Searching the body of {name}',
      'thought.crate': 'A supply drop! Going to get it',
      'thought.crateWait': 'Waiting for the parachute to land',
      'thought.flee': 'Too scared — running from {target}',
      'thought.fleeHurt': 'Badly hurt — getting away from {target}',
      'thought.fleeSight': 'Someone is here! Running from {target}',
      'thought.fleeNoise': 'Fighting nearby. Moving away.',
      'thought.fleeWolves': 'Running from the wolf beasts',
      'thought.fleeWasps': 'Killer wasps! Running to the water',
      'thought.fleeWaspsDry': 'Running from the killer wasps',
      'thought.hide': 'Hiding in the forest',
      'thought.hideRocks': 'Hiding between the rocks',
      'thought.hideQuiet': 'Staying very quiet',
      'thought.revealHide': 'Everyone knows where I am! Hiding',
      'thought.hunt': 'Hunting {target}',
      'thought.huntTrack': 'Tracking {target}',
      'thought.huntRevenge': 'Revenge! Hunting {target}',
      'thought.huntPack': 'The pack hunts {target}',
      'thought.huntNight': 'Hunting {target} in the dark',
      'thought.huntReveal': 'Now I know where {target} is',
      'thought.huntSleeper': '{target} is asleep. Easy prey.',
      'thought.finish': '{target} is weak. Time to finish this.',
      'thought.fight': 'Fighting {target}',
      'thought.fightCornered': 'Cornered! Fighting {target}',
      'thought.fightBack': 'Fighting back against {target}',
      'thought.fightWolf': 'Fighting a wolf beast',
      'thought.defend': 'Defending {ally}',
      'thought.finalFight': 'Only one of us can go home. Fighting {target}',
      'thought.ambushStrike': 'Now! Attacking {target} from hiding',
      'thought.stalk': 'Following {target} quietly',
      'thought.stalkFight': 'Watching the fight from a distance',
      'thought.stalkLone': '{target} is alone. Waiting for a chance.',
      'thought.drink': 'Looking for water',
      'thought.drinking': 'Drinking',
      'thought.drinkBottle': 'Drinking from a bottle',
      'thought.thirsty': 'So thirsty… must find water',
      'thought.eat': 'Eating',
      'thought.eatBerries': 'Eating berries. I hope they are safe.',
      'thought.forage': 'Looking for food',
      'thought.starving': 'Too hungry to think',
      'thought.rest': 'Catching my breath',
      'thought.sleepFind': 'Looking for a safe place to sleep',
      'thought.sleep': 'Sleeping',
      'thought.sleepGuarded': 'Sleeping while {ally} keeps watch',
      'thought.heal': 'Treating my wounds',
      'thought.ally': 'Asking {target} to team up',
      'thought.follow': 'Following {leader}',
      'thought.stayClose': 'Staying close to {leader}',
      'thought.guard': 'Guarding the Nexus supplies',
      'thought.watch': 'Keeping watch while {ally} sleeps',
      'thought.trap': 'Setting a trap',
      'thought.trapWater': 'Setting a trap near the water',
      'thought.ambush': 'Waiting in ambush',
      'thought.ambushWater': 'Waiting at the water. Everyone must drink.',
      'thought.ambushFog': 'Nobody can see me. Waiting.',
      'thought.steal': 'Stealing from {target}',
      'thought.investigate': 'What was that noise?',
      'thought.investigateFight': 'Sounds of a fight. Going to look.',
      'thought.investigateLure': 'A strange signal. Going to look.',
      'thought.investigateBlast': 'A big explosion. Going to look.',
      'thought.feast': 'Going to the feast',
      'thought.feastWait': 'Waiting near the feast',
      'thought.avoidFire': 'Running from the fire',
      'thought.avoidGas': 'Leaving the gas cloud',
      'thought.avoidBlast': 'Getting away from the explosions',
      'thought.avoidQuake': 'The ground is shaking! Moving away',
      'thought.avoidLightning': 'Lightning! Getting away',
      'thought.avoidDanger': 'Danger! Moving away',
      'thought.highGround': 'The water is rising! Going to high ground',
      'thought.leaveWater': 'Getting out of the water',
      'thought.cold': 'So cold… looking for shelter',
      'thought.escapeZone': 'Getting inside the force field',
      'thought.zoneEarly': 'The force field is closing. Moving in.',
      'thought.panic': 'Panic! Just run!',
      'thought.mad': 'Something is wrong… I see things',
      'thought.madAttack': 'Everyone is an enemy! Attacking {target}',
      'thought.stung': 'The trees are moving… (stung)',
      'thought.berserk': 'Blind rage! Charging at {target}',
      'thought.betray': 'Betraying {target}',
      'thought.leaveAlly': 'Only one can win. Leaving the alliance.',
      'thought.idle': 'Waiting',
      'thought.lonely': 'Talking to myself',
      'thought.won': 'I won! I am going home.',
      'thought.spare': 'Letting {target} go',
      'thought.gift': 'A gift from a sponsor! Someone likes me.',

      // ---- log: alliances
      'log.alliance.formed': '{a} and {b} form an alliance.',
      'log.alliance.joined': '{name} joins the alliance of {leader}.',
      'log.alliance.elites': 'The Elites form a pack: {names}.',
      'log.alliance.left': '{name} leaves the alliance. Only one can win.',
      'log.alliance.dissolved': 'The alliance of {leader} breaks apart.',
      'log.alliance.alone': '{name} is alone again.',
      'log.alliance.final': 'Only two are left: {a} and {b}. The alliance is over.',
      'log.alliance.share': '{name} helps ally {ally} ({item}).',
      'log.alliance.defend': '{name} jumps in to defend {ally}!',
      'log.alliance.leader': '{name} is the new leader of the alliance.',
      'log.alliance.broken': '{name} and {target} are not allies anymore.',
      'log.alliance.friendlyFire': '{name} attacked ally {target} in a rage!',

      // ---- log: betrayal
      'log.betray.attack': 'BETRAYAL! {name} turns on their ally {target}!',
      'log.betray.sleep': 'BETRAYAL! {name} attacks their sleeping ally {target}!',
      'log.betray.steal': '{name} steals from ally {target} and runs away.',
      'log.betray.victim': '{name} will never trust anyone again.',

      // ---- log: minds
      'log.mind.snap': '{name} is losing their mind!',
      'log.mind.panic': '{name} panics and runs blindly.',
      'log.mind.berserk': '{name} goes into a blind rage!',
      'log.mind.revenge': '{name} swears revenge on {target}.',
      'log.mind.spare': '{name} lets {target} run away.',
      'log.mind.steal': '{name} steals from the sleeping {target}.',
      'log.mind.lonely': '{name} is talking to themselves.',
      'log.mind.recover': '{name} comes back to their senses.',
      'log.mind.grief': '{name} saw their ally {ally} die.',
      'log.mind.trap': '{name} sets a hidden trap.',
      'log.mind.ambush': '{name} attacks {target} from an ambush!',
      'log.mind.gift': '{name} is happy about the gift.',
      'log.mind.i.alliance': 'New alliance: {a} and {b}',
      'log.mind.i.betray': 'Betrayal: {name}',
      'log.mind.i.stalk': '{name} stalks {target}',
      'log.mind.i.ambush': 'Ambush: {name}',
      'log.mind.i.hunt': '{name} hunts {target}',
      'log.mind.i.pack': 'The pack hunts {target}',
      'log.mind.i.mad': '{name} lost their mind',
      'log.mind.i.steal': 'Thief: {name}',
      'log.mind.i.final': 'Final duel: {a} and {b}',
    },
    hu: {
      // ---- archetypes
      'arch.elite': 'Elit',
      'arch.elite.desc': 'Kiképzett gyilkos. A Nexushoz rohan, a többi elittel falkában vadászik, de a végén senkiben sem bízik.',
      'arch.survivor': 'Túlélő',
      'arch.survivor.desc': 'Óvatos és ügyes. Ételt és vizet talál, jól elbújik, és csak akkor harcol, ha nincs más út.',
      'arch.scavenger': 'Fosztogató',
      'arch.scavenger.desc': 'Félénk tolvaj. Mindenki elől elfut, elviszi a halottak és az alvók holmiját, és imádja a ledobott ládákat.',
      'arch.opportunist': 'Haszonleső',
      'arch.opportunist.desc': 'Hagyja, hogy előbb mások harcoljanak. A harc hangját követi, végez a sebesültekkel, és elárulja a társait.',
      'arch.strategist': 'Stratéga',
      'arch.strategist.desc': 'Nyugodt és türelmes. Csapdát állít a víz és az ösvények mellé, és lesből támad.',
      'arch.berserker': 'Őrjöngő',
      'arch.berserker.desc': 'Vad és kiszámíthatatlan. Gyorsan dühbe gurul, rátámad az ellenségre, és néha elveszti az uralmát, még a barátai ellen is.',
      'arch.protector': 'Védelmező',
      'arch.protector.desc': 'Hűséges és kedves. Barátokat szerez, megvédi őket, megosztja az ételét, és soha senkit nem árul el.',
      'arch.lonewolf': 'Magányos farkas',
      'arch.lonewolf.desc': 'Egyedül vadászik. Csendben mozog, a magányos versenyzőket követi, és szeret éjjel vadászni.',

      // ---- traits
      'trait.aggression': 'Agresszió',
      'trait.bravery': 'Bátorság',
      'trait.greed': 'Kapzsiság',
      'trait.sociability': 'Barátságosság',
      'trait.loyalty': 'Hűség',
      'trait.cunning': 'Ravaszság',
      'trait.patience': 'Türelem',
      'trait.stability': 'Lelki erő',
      'trait.aggression.desc': 'Mennyire akar másokat megtámadni.',
      'trait.bravery.desc': 'Mennyire tud uralkodni a félelmén.',
      'trait.greed.desc': 'Mennyire vágyik zsákmányra és ledobott ládákra.',
      'trait.sociability.desc': 'Milyen könnyen barátkozik.',
      'trait.loyalty.desc': 'Meddig marad hű a szövetségeseihez.',
      'trait.cunning.desc': 'Trükkök, csapdák, lesből támadás és árulás.',
      'trait.patience.desc': 'Meddig tud várni a jó pillanatra.',
      'trait.stability.desc': 'Mennyire bírja a lelke a nyomást.',

      // ---- moods and emotions
      'mood.calm': 'Nyugodt',
      'mood.afraid': 'Fél',
      'mood.angry': 'Dühös',
      'mood.confident': 'Magabiztos',
      'mood.desperate': 'Kétségbeesett',
      'mood.mad': 'Megőrült',
      'mood.asleep': 'Alszik',
      'mood.hurt': 'Sérült',
      'mood.fear': 'Félelem',
      'mood.rage': 'Düh',
      'mood.confidence': 'Önbizalom',
      'mood.sanity': 'Józan ész',

      // ---- actions
      'act.idle': 'Vár',
      'act.wander': 'Kóborol',
      'act.loot': 'Zsákmányol',
      'act.flee': 'Menekül',
      'act.hide': 'Bujkál',
      'act.hunt': 'Vadászik',
      'act.fight': 'Harcol',
      'act.stalk': 'Becserkész',
      'act.drink': 'Iszik',
      'act.eat': 'Eszik',
      'act.forage': 'Élelmet keres',
      'act.rest': 'Pihen',
      'act.sleep': 'Alszik',
      'act.heal': 'Gyógyul',
      'act.ally': 'Szövetséget köt',
      'act.follow': 'Követ',
      'act.guard': 'Őrködik',
      'act.trap': 'Csapdát állít',
      'act.ambush': 'Lesben áll',
      'act.steal': 'Lop',
      'act.investigate': 'Utánanéz egy zajnak',
      'act.feast': 'A lakomára megy',
      'act.avoid': 'Kerüli a veszélyt',
      'act.escape_zone': 'Menekül az erőtér elől',
      'act.panic': 'Pánik',
      'act.mad': 'Őrület',
      'act.berserk': 'Vak düh',
      'act.kickoff': 'Nyitó roham',
      'act.scatter': 'Elfut',

      // ---- thoughts
      'thought.pedestalRush': 'A fegyvereket nézi a Nexusban',
      'thought.pedestalEdge': 'Terv: felkap valamit, és elfut',
      'thought.pedestalScatter': 'A menekülés útját keresi',
      'thought.pedestalElite': 'Összemosolyog a többi elittel',
      'thought.kickoff': 'Rohan a Nexushoz',
      'thought.grab': 'Felkapja: {item}',
      'thought.scatter': 'Menekül a nyitó rohamból',
      'thought.wander': 'Körülnéz',
      'thought.explore': 'Felfedezi az arénát',
      'thought.drift': 'Megy a közép felé. Ennek véget kell érnie.',
      'thought.searchEnemy': 'Keresi: {target}',
      'thought.loot': 'Érte megy: {item}',
      'thought.lootBody': 'Átkutatja a holttestet: {name}',
      'thought.crate': 'Ledobott láda! Megszerzi',
      'thought.crateWait': 'Várja, hogy leérjen az ejtőernyő',
      'thought.flee': 'Túlságosan fél — menekül előle: {target}',
      'thought.fleeHurt': 'Súlyosan sérült — menekül előle: {target}',
      'thought.fleeSight': 'Valaki van itt! Elfut előle: {target}',
      'thought.fleeNoise': 'A közelben harcolnak. Elmegy innen.',
      'thought.fleeWolves': 'Menekül a farkasfenevadak elől',
      'thought.fleeWasps': 'Gyilkosdarazsak! Fut a víz felé',
      'thought.fleeWaspsDry': 'Menekül a gyilkosdarazsak elől',
      'thought.hide': 'Elbújik az erdőben',
      'thought.hideRocks': 'Elbújik a sziklák között',
      'thought.hideQuiet': 'Nagyon csendben marad',
      'thought.revealHide': 'Mindenki tudja, hol vagyok! Elbújik',
      'thought.hunt': 'Vadászik rá: {target}',
      'thought.huntTrack': 'Nyomon követi: {target}',
      'thought.huntRevenge': 'Bosszú! Vadászik rá: {target}',
      'thought.huntPack': 'A falka vadászik rá: {target}',
      'thought.huntNight': 'A sötétben vadászik rá: {target}',
      'thought.huntReveal': 'Most már tudja, hol van: {target}',
      'thought.huntSleeper': 'Alszik: {target}. Könnyű préda.',
      'thought.finish': 'Gyenge: {target}. Itt az ideje végezni vele.',
      'thought.fight': 'Harcol vele: {target}',
      'thought.fightCornered': 'Sarokba szorult! Harcol vele: {target}',
      'thought.fightBack': 'Visszaüt neki: {target}',
      'thought.fightWolf': 'Harcol egy farkasfenevaddal',
      'thought.defend': 'Megvédi a társát: {ally}',
      'thought.finalFight': 'Csak egyikünk mehet haza. Ellenfél: {target}',
      'thought.ambushStrike': 'Most! Lesből támad rá: {target}',
      'thought.stalk': 'Csendben követi: {target}',
      'thought.stalkFight': 'Távolról figyeli a harcot',
      'thought.stalkLone': 'Egyedül van: {target}. Az alkalomra vár.',
      'thought.drink': 'Vizet keres',
      'thought.drinking': 'Iszik',
      'thought.drinkBottle': 'Iszik a kulacsból',
      'thought.thirsty': 'Nagyon szomjas… vizet kell találnia',
      'thought.eat': 'Eszik',
      'thought.eatBerries': 'Bogyót eszik. Remélhetőleg nem mérgező.',
      'thought.forage': 'Élelmet keres',
      'thought.starving': 'Túl éhes, nem tud gondolkodni',
      'thought.rest': 'Kifújja magát',
      'thought.sleepFind': 'Biztonságos helyet keres az alváshoz',
      'thought.sleep': 'Alszik',
      'thought.sleepGuarded': 'Alszik, amíg a társa őrködik: {ally}',
      'thought.heal': 'Ellátja a sebeit',
      'thought.ally': 'Szövetséget ajánl neki: {target}',
      'thought.follow': 'Követi a vezetőt: {leader}',
      'thought.stayClose': 'A vezető közelében marad: {leader}',
      'thought.guard': 'Őrzi a Nexus készleteit',
      'thought.watch': 'Őrködik, amíg a társa alszik: {ally}',
      'thought.trap': 'Csapdát állít',
      'thought.trapWater': 'Csapdát állít a víz mellett',
      'thought.ambush': 'Lesben áll',
      'thought.ambushWater': 'A víznél vár. Mindenkinek innia kell.',
      'thought.ambushFog': 'Senki sem látja. Vár.',
      'thought.steal': 'Lop tőle: {target}',
      'thought.investigate': 'Mi volt ez a zaj?',
      'thought.investigateFight': 'Harc hangja. Megnézi.',
      'thought.investigateLure': 'Furcsa jelzés. Megnézi.',
      'thought.investigateBlast': 'Nagy robbanás. Megnézi.',
      'thought.feast': 'Megy a lakomára',
      'thought.feastWait': 'A lakoma közelében vár',
      'thought.avoidFire': 'Menekül a tűz elől',
      'thought.avoidGas': 'Kimegy a gázfelhőből',
      'thought.avoidBlast': 'Távolodik a robbanásoktól',
      'thought.avoidQuake': 'Remeg a föld! Elmegy innen',
      'thought.avoidLightning': 'Villám! Elmenekül',
      'thought.avoidDanger': 'Veszély! Elmegy innen',
      'thought.highGround': 'Emelkedik a víz! Magasabbra megy',
      'thought.leaveWater': 'Kimászik a vízből',
      'thought.cold': 'Nagyon fázik… menedéket keres',
      'thought.escapeZone': 'Bejut az erőtér belsejébe',
      'thought.zoneEarly': 'Szűkül az erőtér. Befelé megy.',
      'thought.panic': 'Pánik! Csak futni!',
      'thought.mad': 'Valami nincs rendben… dolgokat lát',
      'thought.madAttack': 'Mindenki ellenség! Rátámad: {target}',
      'thought.stung': 'Mozognak a fák… (megcsípték)',
      'thought.berserk': 'Vak düh! Rátámad: {target}',
      'thought.betray': 'Elárulja: {target}',
      'thought.leaveAlly': 'Csak egy győzhet. Kilép a szövetségből.',
      'thought.idle': 'Vár',
      'thought.lonely': 'Magában beszél',
      'thought.won': 'Nyertem! Hazamegyek.',
      'thought.spare': 'Futni hagyja: {target}',
      'thought.gift': 'Ajándék egy szponzortól! Valaki kedveli.',

      // ---- log: alliances
      'log.alliance.formed': 'Szövetséget kötöttek: {a} és {b}.',
      'log.alliance.joined': '{name} csatlakozik {leader} szövetségéhez.',
      'log.alliance.elites': 'Az elitek falkát alkotnak: {names}.',
      'log.alliance.left': '{name} kilép a szövetségből. Csak egy győzhet.',
      'log.alliance.dissolved': '{leader} szövetsége felbomlik.',
      'log.alliance.alone': '{name} újra egyedül maradt.',
      'log.alliance.final': 'Már csak ketten maradtak: {a} és {b}. A szövetségnek vége.',
      'log.alliance.share': '{name} segít a társának: {ally} ({item}).',
      'log.alliance.defend': '{name} a társa védelmére kel: {ally}!',
      'log.alliance.leader': '{name} a szövetség új vezetője.',
      'log.alliance.broken': 'Már nem szövetségesek: {name} és {target}.',
      'log.alliance.friendlyFire': '{name} dühében a társára támadt: {target}!',

      // ---- log: betrayal
      'log.betray.attack': 'ÁRULÁS! {name} megtámadja a szövetségesét: {target}!',
      'log.betray.sleep': 'ÁRULÁS! {name} rátámad alvó szövetségesére: {target}!',
      'log.betray.steal': '{name} meglopja a szövetségesét, és elfut. Áldozat: {target}.',
      'log.betray.victim': '{name} soha többé nem bízik meg senkiben.',

      // ---- log: minds
      'log.mind.snap': '{name} kezdi elveszteni az eszét!',
      'log.mind.panic': '{name} pánikba esik, és vakon rohan.',
      'log.mind.berserk': '{name} vak dühbe gurul!',
      'log.mind.revenge': '{name} bosszút esküszik. Célpont: {target}.',
      'log.mind.spare': '{name} futni hagyja: {target}.',
      'log.mind.steal': '{name} meglop egy alvó versenyzőt: {target}.',
      'log.mind.lonely': '{name} magában beszél.',
      'log.mind.recover': '{name} magához tér.',
      'log.mind.grief': '{name} látta meghalni a társát: {ally}.',
      'log.mind.trap': '{name} rejtett csapdát állít.',
      'log.mind.ambush': '{name} lesből támad. Célpont: {target}!',
      'log.mind.gift': '{name} örül az ajándéknak.',
      'log.mind.i.alliance': 'Új szövetség: {a} és {b}',
      'log.mind.i.betray': 'Árulás: {name}',
      'log.mind.i.stalk': '{name} becserkészi: {target}',
      'log.mind.i.ambush': 'Lesből támadás: {name}',
      'log.mind.i.hunt': '{name} vadászik rá: {target}',
      'log.mind.i.pack': 'A falka vadászik rá: {target}',
      'log.mind.i.mad': 'Megőrült: {name}',
      'log.mind.i.steal': 'Tolvaj: {name}',
      'log.mind.i.final': 'Végső párbaj: {a} és {b}',
    },
  });

  // ======================================================================
  // Archetypes
  // ======================================================================
  const ARCHETYPE_IDS = ['elite', 'survivor', 'scavenger', 'opportunist', 'strategist', 'berserker', 'protector', 'lonewolf'];
  const TRAITS = ['aggression', 'bravery', 'greed', 'sociability', 'loyalty', 'cunning', 'patience', 'stability'];
  const SKILLS = ['strength', 'speed', 'stealth', 'survival', 'aim'];
  const EMOTIONS = ['fear', 'rage', 'confidence', 'sanity'];

  /**
   * Behaviour knobs (extra, not in the spec contract):
   *   rush      tendency to run into the kickoff
   *   hunt      bonus to the hunting urge
   *   hide      bonus to hiding
   *   loot      bonus to looting / crates
   *   forage    bonus to foraging
   *   trap      trap setting, ambush: waiting in ambush
   *   stalk     following prey at a distance
   *   finish    interest in wounded / fighting prey
   *   steal     stealing from sleepers
   *   night     night hunter bonus
   *   fleeOnSight  runs from anyone it sees (scared looter)
   *   ally      alliance bonus (-1 = never)
   *   defend    jumps in when an ally is attacked
   *   share     shares supplies
   *   spare     may let fleeing enemies go
   *   neverBetray
   *   rageGain  rage multiplier when hurt
   *   conf      base confidence offset
   */
  function def(id, icon, color, traits, skillBias, knobs) {
    const a = {
      id: id,
      icon: icon,
      color: color,
      nameKey: 'arch.' + id,
      descKey: 'arch.' + id + '.desc',
      traits: traits,
      skillBias: skillBias,
    };
    const base = {
      rush: 0.3, hunt: 0, hide: 0, loot: 0, forage: 0, trap: 0, ambush: 0, stalk: 0, finish: 0,
      steal: 0, night: 0, fleeOnSight: 0, ally: 0, defend: 0.2, share: 0.3, spare: 0,
      neverBetray: false, rageGain: 1, conf: 0,
    };
    for (const k in base) a[k] = knobs && knobs[k] !== undefined ? knobs[k] : base[k];
    return a;
  }

  const Archetypes = {
    elite: def('elite', '⚔️', '#d64541',
      { aggression: 0.85, bravery: 0.8, greed: 0.55, sociability: 0.6, loyalty: 0.45, cunning: 0.45, patience: 0.35, stability: 0.6 },
      { strength: 0.2, aim: 0.15, speed: 0.05, survival: -0.12, stealth: -0.12 },
      { rush: 0.95, hunt: 0.3, hide: -0.2, loot: 0.1, defend: 0.35, share: 0.2, conf: 0.12 }),
    survivor: def('survivor', '🌿', '#2fa36b',
      { aggression: 0.2, bravery: 0.5, greed: 0.35, sociability: 0.45, loyalty: 0.65, cunning: 0.55, patience: 0.8, stability: 0.75 },
      { survival: 0.3, stealth: 0.15, speed: 0.05, strength: -0.05 },
      { rush: 0.1, hunt: -0.25, hide: 0.18, forage: 0.25, trap: 0.08, loot: 0.05, defend: 0.25, share: 0.45 }),
    scavenger: def('scavenger', '🎒', '#c9a13b',
      { aggression: 0.15, bravery: 0.2, greed: 0.9, sociability: 0.3, loyalty: 0.35, cunning: 0.6, patience: 0.45, stability: 0.5 },
      { speed: 0.2, stealth: 0.15, strength: -0.12, aim: -0.05 },
      { rush: 0.28, hunt: -0.35, hide: 0.1, loot: 0.35, steal: 0.5, fleeOnSight: 0.62, defend: 0.05, share: 0.1, conf: -0.1 }),
    opportunist: def('opportunist', '🦊', '#e67e22',
      { aggression: 0.5, bravery: 0.45, greed: 0.6, sociability: 0.5, loyalty: 0.2, cunning: 0.9, patience: 0.7, stability: 0.6 },
      { stealth: 0.15, aim: 0.1 },
      { rush: 0.35, hunt: -0.05, stalk: 0.35, finish: 0.5, steal: 0.22, loot: 0.1, defend: 0.08, share: 0.08 }),
    strategist: def('strategist', '♟️', '#3a7bd5',
      { aggression: 0.45, bravery: 0.55, greed: 0.4, sociability: 0.45, loyalty: 0.6, cunning: 0.85, patience: 0.9, stability: 0.85 },
      { survival: 0.15, aim: 0.12, stealth: 0.1 },
      { rush: 0.25, hunt: -0.05, trap: 0.45, ambush: 0.4, hide: 0.05, stalk: 0.1, finish: 0.2, defend: 0.25, share: 0.35 }),
    berserker: def('berserker', '💢', '#b0203a',
      { aggression: 0.95, bravery: 0.9, greed: 0.3, sociability: 0.25, loyalty: 0.3, cunning: 0.15, patience: 0.1, stability: 0.2 },
      { strength: 0.25, speed: 0.05, stealth: -0.2, aim: -0.1 },
      { rush: 0.9, hunt: 0.4, hide: -0.3, rageGain: 2.2, defend: 0.3, share: 0.1, conf: 0.1 }),
    protector: def('protector', '🛡️', '#1abc9c',
      { aggression: 0.35, bravery: 0.7, greed: 0.3, sociability: 0.85, loyalty: 0.95, cunning: 0.35, patience: 0.6, stability: 0.75 },
      { strength: 0.1, survival: 0.15 },
      { rush: 0.3, hunt: -0.1, ally: 0.35, defend: 0.55, share: 1, spare: 0.65, neverBetray: true, forage: 0.1 }),
    lonewolf: def('lonewolf', '🎯', '#7d6be0',
      { aggression: 0.7, bravery: 0.7, greed: 0.4, sociability: 0.05, loyalty: 0.3, cunning: 0.7, patience: 0.75, stability: 0.6 },
      { stealth: 0.3, aim: 0.15, speed: 0.05 },
      { rush: 0.4, hunt: 0.15, stalk: 0.35, finish: 0.25, night: 0.35, ally: -1, trap: 0.1, ambush: 0.15, hide: 0.05, defend: 0, share: 0 }),
  };

  // Alliance compatibility between archetypes (symmetric lookup, default 0.4).
  const COMPAT = {
    'elite|elite': 1,
    'protector|protector': 0.9, 'protector|survivor': 0.9, 'protector|strategist': 0.8,
    'protector|scavenger': 0.6, 'protector|opportunist': 0.6, 'protector|berserker': 0.25,
    'survivor|survivor': 0.7, 'survivor|strategist': 0.7, 'survivor|scavenger': 0.45, 'survivor|opportunist': 0.45,
    'strategist|strategist': 0.6, 'strategist|opportunist': 0.5, 'strategist|scavenger': 0.4,
    'scavenger|scavenger': 0.35, 'scavenger|opportunist': 0.4, 'opportunist|opportunist': 0.3,
    'berserker|elite': 0.3, 'berserker|berserker': 0.15,
  };
  function compat(a, b) {
    if (a === 'lonewolf' || b === 'lonewolf') return 0;
    if ((a === 'elite') !== (b === 'elite')) {
      const other = a === 'elite' ? b : a;
      return other === 'berserker' ? 0.3 : 0.08;   // Elites keep to themselves
    }
    const k1 = a + '|' + b;
    if (COMPAT[k1] !== undefined) return COMPAT[k1];
    const k2 = b + '|' + a;
    if (COMPAT[k2] !== undefined) return COMPAT[k2];
    if (a === 'berserker' || b === 'berserker') return 0.2;
    return 0.4;
  }

  // ======================================================================
  // Actions, moods
  // ======================================================================
  const ACTION_ICONS = {
    idle: '⏳', wander: '🚶', loot: '🎒', flee: '🏃', hide: '🌲', hunt: '🎯', fight: '⚔️',
    stalk: '👁️', drink: '💧', eat: '🍖', forage: '🍄', rest: '🧘', sleep: '💤', heal: '🩹',
    ally: '🤝', follow: '👣', guard: '🛡️', trap: '🪤', ambush: '🐍', steal: '🧤',
    investigate: '🔍', feast: '🍗', avoid: '⚠️', escape_zone: '🧱', panic: '😱', mad: '🌀',
    berserk: '💢', kickoff: '💥', scatter: '💨',
  };
  const ACTIONS = {};
  for (const id in ACTION_ICONS) ACTIONS[id] = { icon: ACTION_ICONS[id], key: 'act.' + id };

  const MOODS = ['calm', 'afraid', 'angry', 'confident', 'desperate', 'mad', 'asleep', 'hurt'];
  const MOOD_ICONS = {
    calm: '😐', afraid: '😨', angry: '😠', confident: '😎', desperate: '😰', mad: '🤪', asleep: '😴', hurt: '🤕',
  };

  // Plans that keep the contestant standing still (no movement orders).
  const STATIONARY = { idle: 1, eat: 1, heal: 1, rest: 1 };
  // Actions that look hostile to an observer.
  const HOSTILE_ACT = { hunt: 1, fight: 1, berserk: 1, mad: 1, stalk: 1, kickoff: 0 };

  // ======================================================================
  // Archetype picking
  // ======================================================================
  function rngFn(rng) {
    if (rng && typeof rng.random === 'function') return function () { return rng.random(); };
    if (typeof rng === 'function') return rng;
    return R.random;
  }

  /**
   * Choose n archetype ids for a roster. Elites come first so that
   * generateRoster gives them the low teams (1, 2 ...), like the books.
   *   mix: 'balanced' | 'bloodthirsty' | 'peaceful' | 'chaos'
   */
  function pickArchetypes(n, mix, rng) {
    n = Math.max(0, n | 0);
    const rnd = rngFn(rng);
    const shuffle = function (arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
      }
      return arr;
    };
    if (mix === 'chaos') {
      const out = [];
      for (let i = 0; i < n; i++) out.push(ARCHETYPE_IDS[Math.floor(rnd() * ARCHETYPE_IDS.length) % ARCHETYPE_IDS.length]);
      return out;
    }
    let eliteFrac = 0.15;
    let w = { survivor: 1, scavenger: 1, opportunist: 1, strategist: 1, berserker: 1, protector: 1, lonewolf: 1 };
    if (mix === 'bloodthirsty') {
      eliteFrac = 0.25;
      w = { survivor: 0.55, scavenger: 0.45, opportunist: 1, strategist: 0.8, berserker: 2, protector: 0.5, lonewolf: 1.8 };
    } else if (mix === 'peaceful') {
      eliteFrac = 0.08;
      w = { survivor: 2, scavenger: 1.6, opportunist: 0.6, strategist: 1.2, berserker: 0.3, protector: 2, lonewolf: 0.4 };
    }
    let elites = Math.round(n * eliteFrac);
    if (elites === 1 && n >= 6) elites = 2;          // a pack needs at least two
    if (n >= 8 && elites < 2 && mix !== 'peaceful') elites = 2;
    elites = Math.min(elites, n);
    const out = [];
    for (let i = 0; i < elites; i++) out.push('elite');
    // Largest-remainder distribution of the rest -> even and fair.
    const rest = n - elites;
    const ids = Object.keys(w);
    let sum = 0;
    for (const id of ids) sum += w[id];
    const quota = [];
    let used = 0;
    for (const id of ids) {
      const exact = sum > 0 ? rest * w[id] / sum : 0;
      const fl = Math.floor(exact);
      quota.push({ id: id, n: fl, frac: exact - fl + rnd() * 1e-3 });
      used += fl;
    }
    quota.sort(function (a, b) { return b.frac - a.frac; });
    for (let i = 0; used < rest && quota.length; i = (i + 1) % quota.length) { quota[i].n++; used++; }
    const list = [];
    for (const q of quota) for (let i = 0; i < q.n; i++) list.push(q.id);
    shuffle(list);
    return out.concat(list);
  }

  // ======================================================================
  // Small helpers (defensive cross-module access)
  // ======================================================================
  const NO_STATUS = { stun: 0, poison: 0, madness: 0, panic: 0, burning: 0, stung: 0, bleeding: 0 };
  const NO_INV = { melee: null, ranged: null, ammo: 0, armor: false, food: 0, water: 0, medkit: 0, berries: 0, traps: 0, sleepingBag: false, goggles: false };
  const clamp = U.clamp;
  const clamp01 = U.clamp01;

  function now() { return GM.state.time; }
  function trib(id) {
    if (id == null || id < 0) return null;
    const t = GM.state.contestants[id];
    return t || null;
  }
  function statusOf(t) { return t.status || NO_STATUS; }
  function invOf(t) { return t.inv || NO_INV; }
  function hpFrac(t) { return clamp01((t.health || 0) / (t.maxHealth || 100)); }
  function num(v, d) { return typeof v === 'number' && v === v ? v : d; }

  function dxz(t, x, z) {
    const dx = x - t.pos.x, dz = z - t.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
  function dd(a, b) {
    const dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function tCall(name, a, b, c, d) {
    const T = GM.Contestants;
    if (!T || typeof T[name] !== 'function') return undefined;
    try { return T[name](a, b, c, d); } catch (e) { GM.reportError('AI.Contestants.' + name, e); return undefined; }
  }
  function iCall(name, a, b, c) {
    const I = GM.Items;
    if (!I || typeof I[name] !== 'function') return undefined;
    try { return I[name](a, b, c); } catch (e) { GM.reportError('AI.Items.' + name, e); return undefined; }
  }
  function cCall(name, a, b) {
    const C = GM.Combat;
    if (!C || typeof C[name] !== 'function') return undefined;
    try { return C[name](a, b); } catch (e) { GM.reportError('AI.Combat.' + name, e); return undefined; }
  }
  function fxCall(name, a, b) {
    const F = GM.FX;
    if (!F || typeof F[name] !== 'function') return;
    try { F[name](a, b); } catch (e) { GM.reportError('AI.FX.' + name, e); }
  }
  function sfx(name, pos, volume) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, { pos: pos, volume: volume == null ? 1 : volume }); } catch (e) { GM.reportError('AI.audio', e); }
  }

  // ---- terrain queries
  function heightAt(x, z) {
    const T = GM.Terrain;
    if (T && T.heightAt) { const y = T.heightAt(x, z); if (y === y) return y; }
    return 0;
  }
  function coverAt(x, z) {
    const T = GM.Terrain;
    if (T && T.forestAt) { const c = T.forestAt(x, z); if (c === c) return c; }
    return 0;
  }
  function isWater(x, z) {
    const T = GM.Terrain;
    if (T && T.isWater) return !!T.isWater(x, z);
    return false;
  }
  function biomeAt(x, z) {
    const T = GM.Terrain;
    if (T && T.biomeAt) return T.biomeAt(x, z);
    return 'grass';
  }
  function dangerAt(x, z) {
    const H = GM.Hazards;
    if (H && H.dangerAt) {
      try { const d = H.dangerAt(x, z); if (d === d) return d; } catch (e) { GM.reportError('AI.dangerAt', e); }
    }
    return 0;
  }
  function inArena(x, z, margin) {
    const T = GM.Terrain;
    if (T && T.inArena) return T.inArena(x, z, margin || 0);
    const r = ARENA_R - (margin || 0);
    return x * x + z * z <= r * r;
  }
  function zoneInfo() {
    const H = GM.Hazards;
    const z = H && H.zone;
    return z && z.active && z.center ? z : null;
  }

  // Shared scratch point (never kept by callers).
  const P = { x: 0, z: 0 };
  function clampToArena(o, margin) {
    const r = Math.sqrt(o.x * o.x + o.z * o.z);
    const max = ARENA_R - (margin == null ? 6 : margin);
    if (r > max && r > 0) { o.x *= max / r; o.z *= max / r; }
    const zn = zoneInfo();
    if (zn) {
      const dx = o.x - zn.center.x, dz = o.z - zn.center.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const zmax = Math.max(4, zn.radius - 4);
      if (d > zmax && d > 0) { o.x = zn.center.x + dx / d * zmax; o.z = zn.center.z + dz / d * zmax; }
    }
    return o;
  }

  function itemName(type) {
    const D = GM.ItemDefs;
    const d = D && D[type];
    return '@' + (d && d.nameKey ? d.nameKey : 'item.' + type);
  }
  function weaponDef(id) {
    const D = GM.ItemDefs;
    return (D && id && D[id]) || null;
  }
  function defRange(d, fallback) { return d ? num(d.range, num(d.reach, fallback)) : fallback; }
  function defDamage(d, fallback) { return d ? num(d.dmg, num(d.damage, fallback)) : fallback; }
  function hasWeapon(t) {
    const inv = invOf(t);
    return !!inv.melee || (!!inv.ranged && inv.ammo > 0);
  }
  function rangedRange(t) {
    const inv = invOf(t);
    if (!inv.ranged || !(inv.ammo > 0)) return 0;
    const w = cCall('weaponOf', t, true);
    if (w && w.kind === 'ranged') return defRange(w, 20);
    return defRange(weaponDef(inv.ranged), 20);
  }
  function meleeRange(t) {
    const w = cCall('weaponOf', t, false);
    if (w && w.kind !== 'ranged') return defRange(w, 1.8);
    return defRange(weaponDef(invOf(t).melee), 1.6);
  }
  /** 0..1 how good the contestant's best weapon is. */
  function weaponQuality(t) {
    const inv = invOf(t);
    let best = 0.18;   // fists
    if (inv.melee) best = Math.max(best, clamp01(defDamage(weaponDef(inv.melee), 18) / 32));
    if (inv.ranged && inv.ammo > 0) best = Math.max(best, clamp01(defDamage(weaponDef(inv.ranged), 22) / 30) * 0.95);
    return best;
  }

  /** Fighting strength (GM.Combat.power when available). */
  function powerOf(t) {
    const C = GM.Combat;
    if (C && typeof C.power === 'function') {
      try {
        const p = C.power(t);
        if (p > 0 && p < Infinity) return p;
      } catch (e) { GM.reportError('AI.power', e); }
    }
    const inv = invOf(t);
    let dmg = 6;
    if (inv.melee) dmg = Math.max(dmg, defDamage(weaponDef(inv.melee), 18));
    if (inv.ranged && inv.ammo > 0) dmg = Math.max(dmg, defDamage(weaponDef(inv.ranged), 20) * 0.9);
    const str = t.skills ? 0.8 + 0.45 * num(t.skills.strength, 0.5) : 1;
    return Math.max(0.05, (t.health || 0) * dmg * str * (inv.armor ? 1.4 : 1) / 100);
  }

  // ======================================================================
  // Minds
  // ======================================================================
  function makePlan() {
    return {
      id: 'idle', targetId: -1, ref: null, x: 0, z: 0, flavor: '', score: 0,
      since: 0, until: 0, stage: 0, timer: 0, t2: 0, n: 0, done: false, prev: 'idle',
      ex: 0, ez: 0,          // secondary point (escape / patrol / approach)
      aux: -1, obj: null,    // extra id / object (defended ally, feast crate)
    };
  }

  function createMind(t, a) {
    const n = MAXN;
    const seenT = new Float32Array(n);
    seenT.fill(-1e6);
    return {
      v: 1,
      arch: a,
      style: 'scatter',
      // memory of other contestants (indexed by id)
      seenT: seenT,
      seenX: new Float32Array(n),
      seenZ: new Float32Array(n),
      visible: new Uint8Array(n),
      trust: new Float32Array(n),
      grudge: new Float32Array(n),
      sworn: new Uint8Array(n),
      spareUntil: new Float32Array(n),
      spareRoll: new Float32Array(n),
      giveUp: new Float32Array(n),          // sim time until which a target is ignored
      // perception summary
      visCount: 0, alliesNear: 0,
      nearEnemyId: -1, nearEnemyD: 1e9,
      threatId: -1, threatLevel: 0, threatD: 1e9,
      sleeperId: -1,
      allyCandId: -1, allyCandScore: 0,
      defendId: -1, defendAttackerId: -1,
      beastRef: null, beastD: 1e9, beastCount: 0, beastType: '',
      itemRef: null, itemScore: 0, itemBody: -1,
      crateRef: null, crateScore: 0,
      dangerLevel: 0, dangerNear: false, dangerX: 0, dangerZ: 0, dangerR: 0, dangerType: '', dangerLvl: 0,
      zoneOut: 0, zoneX: 0, zoneZ: 0,
      flood: false, floodX: 0, floodZ: 0, floodAt: -1e6,
      cold: false, coldX: 0, coldZ: 0, coldAt: -1e6,
      coverHere: 0,
      heardX: 0, heardZ: 0, heardKind: '', heardT: -1e6, heardStr: 0, heardSrc: -1,
      waterX: 0, waterZ: 0, waterOk: false, waterAt: -1e6, waterQX: 1e9, waterQZ: 1e9, noWaterUntil: 0,
      // emotion baselines
      fearBase: 0.15, confBase: 0.5, rageBase: 0.05, sanityRate: 0, rageDecay: 0.06,
      // timers
      nextThink: 0, nextPerceive: 0, nextAttack: 0, lastThink: 0,
      lastHitAt: -1e6, lastHitBy: -1, lastDmgAt: -1e6, hpSeen: t.health || 100,
      lastKillAt: -1e6, lastTrapAt: -1e6, trapX: 0, trapZ: 0, hasTrapSpot: false,
      ambushCool: 0, allyCool: 0, nextSnapAt: 60, nextPanicAt: 30, nextBerserkLog: 0,
      lastLonelyLog: -1e6, lastDefendLog: -1e6, lastRevengeLog: -1e6, lastGriefLog: -1e6,
      cornered: 0, snapped: false, avoidId: -1, avoidUntil: 0,
      betrayId: -1, betrayUntil: 0, betrayed: 0, paranoia: 0,
      stalkSince: 0, stalkId: -1, lastInterest: -1e6, forageFail: 0,
      // movement
      goalX: 0, goalZ: 0, goalMode: '', goalAt: -1e6, moving: false,
      stuckT: 0, stuckX: 0, stuckZ: 0, stuckN: 0, detourUntil: 0, detourX: 0, detourZ: 0,
      homeX: t.pos ? t.pos.x : 0, homeZ: t.pos ? t.pos.z : 0,
      pickups: 0, bbStart: 0,
      // extra bookkeeping
      itemScanAt: -1e6, dangerScanAt: -1e6, badItem: null, badItemUntil: 0,
      zoneEarly: false, inWaterBad: false, wasMad: false, lastPanicLog: -1e6,
      lastHideEnd: -1e6, lastGiftLog: -1e6, lastFFLog: -1e6, lastWakeAt: -1e6, holdUntil: 0,
      execAt: 0, execDt: 0, lastMadLog: -1e6, lastAmbushLog: -1e6, lastGriefAt: -1e6,
      // plan + thought cache
      plan: makePlan(),
      thKey: '', thA: null, thB: null,
    };
  }

  function kickoffStyle(t) {
    const a = t.mind.arch, tr = t.traits;
    const p = a.rush * 0.6 + tr.aggression * 0.2 + tr.bravery * 0.2 - (1 - tr.bravery) * 0.1 + R.gauss(0, 0.1);
    if (p > 0.6) return 'rush';
    if (p > 0.3 || tr.greed > 0.72) return 'edge';
    return 'scatter';
  }

  /** Build personality, skills, emotions and the private mind of a contestant. */
  function initMind(t) {
    if (!t) return;
    if (!Archetypes[t.archetype]) t.archetype = ARCHETYPE_IDS[((t.id | 0) * 7 + 3) % ARCHETYPE_IDS.length];
    const a = Archetypes[t.archetype];
    const tr = {};
    for (const k of TRAITS) tr[k] = clamp(a.traits[k] + R.gauss(0, 0.12), 0.02, 0.98);
    t.traits = tr;
    const sk = t.skills || (t.skills = {});
    for (const k of SKILLS) sk[k] = clamp(num(sk[k], 0.5) + (a.skillBias[k] || 0), 0.05, 1);
    t.emotion = {
      fear: clamp01(0.12 + (1 - tr.bravery) * 0.25 + R.range(-0.04, 0.04)),
      rage: clamp01(0.03 + tr.aggression * 0.06),
      confidence: clamp01(0.35 + a.conf + tr.bravery * 0.2 + R.range(-0.05, 0.05)),
      sanity: clamp01(0.78 + tr.stability * 0.22),
    };
    t.mood = 'calm';
    t.action = 'idle';
    t.targetId = null;
    t.allianceId = null;
    t.sneaking = false;
    t.hidden = false;
    const m = (t.mind = createMind(t, a));
    m.rageDecay = a.id === 'berserker' ? 0.018 : 0.035 + tr.stability * 0.04;
    m.nextThink = R.range(0, 0.5);
    m.nextPerceive = R.range(0, 0.45);
    m.style = kickoffStyle(t);
    t.thought = { key: pedestalThought(t), params: {} };
    m.thKey = t.thought.key;
  }

  function pedestalThought(t) {
    const m = t.mind;
    if (m.arch.id === 'elite' && m.style === 'rush') return 'thought.pedestalElite';
    if (m.style === 'rush') return 'thought.pedestalRush';
    if (m.style === 'edge') return 'thought.pedestalEdge';
    return 'thought.pedestalScatter';
  }

  /** Initial relations once everybody exists (same team, Elites). */
  function initRelations() {
    const trs = GM.state.contestants;
    for (const t of trs) {
      if (!t || !t.mind) continue;
      const m = t.mind;
      for (const o of trs) {
        if (!o || o === t || o.id >= MAXN) continue;
        let tr = 0;
        if (o.team === t.team) tr += 0.3;
        if (t.archetype === 'elite' && o.archetype === 'elite') tr += 0.3;
        if (o.archetype === 'elite' && t.archetype !== 'elite') tr -= 0.15;
        m.trust[o.id] = tr;
      }
    }
  }

  // ======================================================================
  // Module state (reset in clear())
  // ======================================================================
  const alliances = [];              // public: GM.AI.alliances (same array for the whole session)
  let allianceUid = 0;
  const POW = new Float32Array(MAXN);  // fighting power cache (refreshed ~2x per sim s)
  let powAt = -1e9;
  let aliveN = 0, totalN = 0;
  let tension = 0;
  let pace = 0;                       // 0..0.5: contestants killed each other faster than planned -> hunt less
  let tribKills = 0;                  // deaths caused by contestants (not by the arena / Showrunner)
  let cornStock = 0;                  // loose items around the Nexus
  let lastDeathAt = 0;
  let statAt = -1e9, allyAt = -1e9, senseAt = 0;
  let revealOn = false;
  let finalLogged = false;
  // Transient dangers from events (lightning, explosions, quakes): fixed pool.
  const BLASTS = [];
  for (let i = 0; i < 16; i++) BLASTS.push({ x: 0, z: 0, r: 0, until: -1, type: '' });
  // Recent deaths (bodies to loot).
  const BODIES = [];
  for (let i = 0; i < 16; i++) BODIES.push({ x: 0, z: 0, t: -1e6, id: -1, name: '' });
  let bodyIdx = 0;
  // Environment snapshot (refreshed every update).
  const ENV = { vis: 1, night: false, cold: false, fog: false, water: CFG.BASE_WATER_LEVEL, waterPrev: CFG.BASE_WATER_LEVEL, rising: 0, floodUntil: 0 };

  // ======================================================================
  // Thoughts, logs, interests
  // ======================================================================
  /** Set t.thought only when it changes (no allocation otherwise). */
  function say(t, key, n1, v1, n2, v2) {
    const m = t.mind;
    if (m.holdUntil > GM.state.time) return;     // a short special thought is showing
    if (m.thKey === key && m.thA === (v1 === undefined ? null : v1) && m.thB === (v2 === undefined ? null : v2)) return;
    m.thKey = key;
    m.thA = v1 === undefined ? null : v1;
    m.thB = v2 === undefined ? null : v2;
    const params = {};
    if (n1) params[n1] = v1;
    if (n2) params[n2] = v2;
    t.thought = { key: key, params: params };
  }
  /** Show a special thought for a few seconds (gift, sparing, betrayal...). */
  function sayHold(t, key, n1, v1, seconds) {
    const m = t.mind;
    m.holdUntil = 0;
    say(t, key, n1, v1);
    m.holdUntil = GM.state.time + (seconds || 3);
  }
  function mlog(type, key, params, t, other, important) {
    const ids = [];
    if (t) ids.push(t.id);
    if (other && other !== t) ids.push(other.id);
    try {
      GM.log(type, key, params, { pos: t ? t.pos : null, contestantIds: ids, important: !!important });
    } catch (e) { GM.reportError('AI.log', e); }
  }
  function interest(t, score, duration, key, label, kind, pos) {
    try {
      GM.addInterest({
        pos: pos || t.pos, score: score, duration: duration || 8, label: label,
        followId: t ? t.id : null, kind: kind || 'mind', key: key,
      });
    } catch (e) { GM.reportError('AI.interest', e); }
  }

  // ======================================================================
  // Movement helpers
  // ======================================================================
  /** Order a move only when the goal or the gait changes meaningfully. */
  function go(t, x, z, mode, tol) {
    const m = t.mind;
    if (!(x === x) || !(z === z)) return;
    P.x = x; P.z = z;
    clampToArena(P, 5);
    x = P.x; z = P.z;
    if (mode === 'sprint' && (t.stamina || 0) < 12) mode = 'run';
    const nowT = now();
    // detour after getting stuck
    if (m.detourUntil > nowT) { x = m.detourX; z = m.detourZ; }
    const dx = x - m.goalX, dz = z - m.goalZ;
    const tl = tol == null ? 1.5 : tol;
    if (m.moving && mode === m.goalMode && dx * dx + dz * dz < tl * tl && nowT - m.goalAt < 4) return;
    m.goalX = x; m.goalZ = z; m.goalMode = mode; m.goalAt = nowT;
    if (!m.moving) { m.stuckT = 0; m.stuckX = t.pos.x; m.stuckZ = t.pos.z; }
    m.moving = true;
    t.sneaking = mode === 'sneak';
    tCall('moveTo', t, x, z, mode);
  }
  /** Chase a moving target: re-issue when it moved relative to the distance. */
  function chase(t, x, z, mode) {
    const d = dxz(t, x, z);
    go(t, x, z, mode, clamp(d * 0.12, 0.35, 3));
  }
  function halt(t) {
    const m = t.mind;
    if (m.moving) {
      m.moving = false;
      m.goalMode = '';
      tCall('stop', t);
    }
    t.sneaking = false;
  }
  function arrivedAt(t, x, z, r) {
    const dx = x - t.pos.x, dz = z - t.pos.z;
    return dx * dx + dz * dz <= r * r;
  }
  /** Detect a contestant that does not make progress and give it a detour. */
  function trackStuck(t, dt) {
    const m = t.mind;
    if (!m.moving || t.sleeping) { m.stuckT = 0; return; }
    m.stuckT += dt;
    if (m.stuckT < 3) return;
    const moved = Math.sqrt((t.pos.x - m.stuckX) * (t.pos.x - m.stuckX) + (t.pos.z - m.stuckZ) * (t.pos.z - m.stuckZ));
    const goalD = dxz(t, m.goalX, m.goalZ);
    const st = statusOf(t);
    if (moved < 1.0 && goalD > 3 && !(st.stun > 0)) {
      m.stuckN++;
      const a = R.angle();
      m.detourX = t.pos.x + Math.sin(a) * 10;
      m.detourZ = t.pos.z + Math.cos(a) * 10;
      m.detourUntil = now() + 2.5;
      m.goalAt = -1e6;               // force a re-issue
      if (m.stuckN >= 4) { m.plan.done = true; m.stuckN = 0; }
    } else if (moved > 3) {
      m.stuckN = 0;
    }
    m.stuckT = 0;
    m.stuckX = t.pos.x;
    m.stuckZ = t.pos.z;
  }

  /**
   * Pick a flight point `dist` metres away from (sx, sz): tries 7 directions
   * and scores them (arena edge, force field, water, danger, cover).
   * Result in the shared scratch point P.
   */
  const ESC_OFFS = [0, 0.55, -0.55, 1.1, -1.1, 1.65, -1.65];
  function pickEscape(t, sx, sz, dist, preferWater, preferCover) {
    let ax = t.pos.x - sx, az = t.pos.z - sz;
    let l = Math.sqrt(ax * ax + az * az);
    if (l < 0.01) { const r0 = R.angle(); ax = Math.sin(r0); az = Math.cos(r0); l = 1; }
    const base = Math.atan2(ax / l, az / l);
    const zn = zoneInfo();
    let best = -1e9, bx = t.pos.x, bz = t.pos.z;
    for (let i = 0; i < ESC_OFFS.length; i++) {
      const off = ESC_OFFS[i];
      const a = base + off;
      const x = t.pos.x + Math.sin(a) * dist, z = t.pos.z + Math.cos(a) * dist;
      let s = -Math.abs(off) * 0.4;
      const r = Math.sqrt(x * x + z * z);
      if (r > ARENA_R - 12) s -= 1 + (r - (ARENA_R - 12)) * 0.12;
      if (zn) {
        const zx = x - zn.center.x, zz = z - zn.center.z;
        if (zx * zx + zz * zz > (zn.radius - 6) * (zn.radius - 6)) s -= 2.5;
      }
      if (isWater(x, z)) s += preferWater ? 1.6 : -1.2;
      s -= dangerAt(x, z) * 3;
      if (preferCover) s += coverAt(x, z) * 0.9;
      const ex = x - sx, ez = z - sz;
      s += Math.sqrt(ex * ex + ez * ez) * 0.012;
      if (s > best) { best = s; bx = x; bz = z; }
    }
    P.x = bx; P.z = bz;
    return clampToArena(P, 8);
  }

  /** A good hiding place near the contestant (cover, rocks, caves). Result in P. */
  function findHideSpot(t, maxDist) {
    const T = GM.Terrain;
    const x = t.pos.x, z = t.pos.z;
    let bestS = -1e9, bx = x, bz = z, found = false;
    const spots = T && T.hideSpots;
    if (spots && spots.length) {
      for (let i = 0; i < spots.length; i++) {
        const s = spots[i];
        const d = Math.sqrt((s.x - x) * (s.x - x) + (s.z - z) * (s.z - z));
        if (d > maxDist) continue;
        const sc = num(s.quality, 0.5) - d / maxDist * 0.6 - dangerAt(s.x, s.z) * 2;
        if (sc > bestS) { bestS = sc; bx = s.x; bz = s.z; found = true; }
      }
    }
    if (!found && T && typeof T.findCover === 'function') {
      try {
        const c = T.findCover(x, z, maxDist);
        if (c) { bx = c.x; bz = c.z; found = true; }
      } catch (e) { GM.reportError('AI.findCover', e); }
    }
    if (!found) {
      // sample a few points around
      let best = coverAt(x, z) - 0.05;
      for (let i = 0; i < 10; i++) {
        const a = R.angle(), r = R.range(8, maxDist);
        const px = x + Math.sin(a) * r, pz = z + Math.cos(a) * r;
        if (!inArena(px, pz, 10) || isWater(px, pz)) continue;
        const c = coverAt(px, pz) - r / maxDist * 0.2;
        if (c > best) { best = c; bx = px; bz = pz; }
      }
    }
    P.x = bx; P.z = bz;
    return clampToArena(P, 8);
  }

  /** Nearest known water (cached query). Returns true when m.waterX/Z is valid. */
  function knowWater(t) {
    const m = t.mind, nowT = now();
    if (m.noWaterUntil > nowT) return false;
    const moved = Math.abs(t.pos.x - m.waterQX) + Math.abs(t.pos.z - m.waterQZ);
    if (m.waterOk && moved < 25 && nowT - m.waterAt < 60) return true;
    const T = GM.Terrain;
    if (!T || typeof T.nearestWater !== 'function') return false;
    let w = null;
    try { w = T.nearestWater(t.pos.x, t.pos.z, 160); } catch (e) { GM.reportError('AI.nearestWater', e); }
    m.waterQX = t.pos.x; m.waterQZ = t.pos.z; m.waterAt = nowT;
    if (w && w.x === w.x) {
      m.waterX = w.x; m.waterZ = w.z; m.waterOk = true;
      return true;
    }
    m.waterOk = false;
    m.noWaterUntil = nowT + 20;
    return false;
  }

  /** Nearest lake centre within maxDist (deep water to shake off wasps). Result in P or null. */
  function nearestLake(t, maxDist) {
    const T = GM.Terrain;
    const lakes = T && T.landmarks && T.landmarks.lakes;
    if (!lakes || !lakes.length) return null;
    let best = maxDist, found = null;
    for (let i = 0; i < lakes.length; i++) {
      const L = lakes[i];
      const d = dxz(t, L.x, L.z) - num(L.r, 10) * 0.5;
      if (d < best) { best = d; found = L; }
    }
    if (!found) return null;
    P.x = found.x; P.z = found.z;
    return P;
  }

  // ======================================================================
  // Alliances
  // ======================================================================
  function allianceOf(t) {
    if (!t || t.allianceId == null) return null;
    for (let i = 0; i < alliances.length; i++) if (alliances[i].id === t.allianceId) return alliances[i];
    return null;
  }
  function allied(a, b) {
    return a !== b && a.allianceId != null && a.allianceId === b.allianceId;
  }
  function leaderScore(t) {
    const e = t.emotion || { confidence: 0.5 };
    return e.confidence + (t.traits ? t.traits.aggression * 0.5 : 0) + (t.archetype === 'elite' ? 0.3 : 0) +
      hpFrac(t) * 0.3 + (t.kills || 0) * 0.12 + (t.archetype === 'protector' ? 0.15 : 0);
  }
  function pickLeader(al) {
    let best = null, bs = -1e9;
    for (const id of al.members) {
      const t = trib(id);
      if (!t || !t.alive) continue;
      const s = leaderScore(t);
      if (s > bs) { bs = s; best = t; }
    }
    return best;
  }
  function namesOf(al) {
    const out = [];
    for (const id of al.members) { const t = trib(id); if (t) out.push(t.name); }
    return out.join(', ');
  }

  /** Create an alliance from contestants (all must be free). */
  function createAlliance(list, elites) {
    const al = {
      id: ++allianceUid,
      members: [],
      leaderId: null,
      formedAt: now(),
      elites: !!elites,
      targetId: null,     // shared hunting target
      watchId: null,      // who keeps watch at night
    };
    for (const t of list) {
      al.members.push(t.id);
      t.allianceId = al.id;
      const m = t.mind;
      if (m) for (const o of list) if (o !== t && o.id < MAXN) m.trust[o.id] = Math.max(m.trust[o.id], 0.55);
    }
    const L = pickLeader(al);
    al.leaderId = L ? L.id : list[0].id;
    alliances.push(al);
    GM.emit('alliance:formed', { alliance: al });
    return al;
  }

  function joinAlliance(al, t) {
    if (al.members.indexOf(t.id) < 0) al.members.push(t.id);
    t.allianceId = al.id;
    for (const id of al.members) {
      const o = trib(id);
      if (!o || o === t) continue;
      if (t.mind) t.mind.trust[o.id] = Math.max(t.mind.trust[o.id], 0.5);
      if (o.mind) o.mind.trust[t.id] = Math.max(o.mind.trust[t.id], 0.5);
    }
    GM.emit('alliance:formed', { alliance: al });
  }

  function removeAlliance(al) {
    const i = alliances.indexOf(al);
    if (i >= 0) alliances.splice(i, 1);
    for (const id of al.members) {
      const t = trib(id);
      if (t && t.allianceId === al.id) t.allianceId = null;
    }
  }

  /**
   * Remove t from its alliance. opts: {betrayal, silent, reason}
   * Emits 'alliance:broken' and dissolves alliances that drop below 2.
   */
  function leaveAlliance(t, opts) {
    const al = allianceOf(t);
    if (!al) { t.allianceId = null; return; }
    opts = opts || {};
    const i = al.members.indexOf(t.id);
    if (i >= 0) al.members.splice(i, 1);
    t.allianceId = null;
    if (t.mind) t.mind.allyCool = now() + (opts.betrayal ? 200 : 90);
    if (al.watchId === t.id) al.watchId = null;
    const alive = [];
    for (const id of al.members) { const o = trib(id); if (o && o.alive) alive.push(o); }
    const dissolved = alive.length < 2;
    GM.emit('alliance:broken', { alliance: al, byId: t.id, betrayal: !!opts.betrayal });
    if (dissolved) {
      const leader = trib(al.leaderId);
      removeAlliance(al);
      if (!opts.silent && alive.length === 1 && alive[0].alive) {
        mlog('alliance', 'log.alliance.alone', { name: alive[0].name }, alive[0]);
      } else if (!opts.silent && alive.length === 0 && leader) {
        mlog('alliance', 'log.alliance.dissolved', { leader: leader.name }, leader);
      }
      for (const o of alive) if (o.mind) o.mind.allyCool = now() + 60;
    } else if (al.leaderId === t.id) {
      const L = pickLeader(al);
      if (L) {
        al.leaderId = L.id;
        if (!opts.silent) mlog('alliance', 'log.alliance.leader', { name: L.name }, L);
      }
    }
  }

  /** Remove a dead member (no betrayal). */
  function memberDied(t) {
    const al = allianceOf(t);
    if (!al) return;
    const i = al.members.indexOf(t.id);
    if (i >= 0) al.members.splice(i, 1);
    t.allianceId = null;
    if (al.targetId === t.id) al.targetId = null;
    if (al.watchId === t.id) al.watchId = null;
    const alive = [];
    for (const id of al.members) { const o = trib(id); if (o && o.alive) alive.push(o); }
    if (alive.length < 2) {
      GM.emit('alliance:broken', { alliance: al, byId: null, betrayal: false });
      removeAlliance(al);
      if (alive.length === 1) mlog('alliance', 'log.alliance.alone', { name: alive[0].name }, alive[0]);
    } else if (al.leaderId === t.id) {
      const L = pickLeader(al);
      if (L) {
        al.leaderId = L.id;
        mlog('alliance', 'log.alliance.leader', { name: L.name }, L);
      }
    }
  }

  /** Would `o` accept an alliance offer from `t`? 0..1 */
  function acceptance(o, t) {
    if (!o.alive || !o.mind || !o.traits) return 0;
    const om = o.mind;
    if (om.arch.ally < 0 || t.mind.arch.ally < 0) return 0;
    if (om.allyCool > now()) return 0;
    if (om.grudge[t.id] > 0.2 || om.trust[t.id] < -0.2) return 0;
    const s = statusOf(o);
    if (s.madness > 0 || s.panic > 0 || o.sleeping) return 0;
    let v = compat(o.archetype, t.archetype) * (0.35 + o.traits.sociability * 0.65);
    v += om.trust[t.id] * 0.4 + om.arch.ally * 0.3;
    v -= om.paranoia * 0.5;
    if (o.team === t.team) v += 0.25;
    if (hpFrac(o) < 0.4) v += 0.1;     // hurt people want friends
    return clamp01(v);
  }
  function maxAllianceSize(al) { return al && al.elites ? 6 : 4; }

  /** t proposes to o (they are close). Returns true on success. */
  function proposeAlliance(t, o) {
    if (!o || !o.alive || allied(t, o)) return false;
    if (aliveN <= 6) return false;
    const alT = allianceOf(t), alO = allianceOf(o);
    if (alT && alO) return false;
    const acc = acceptance(o, t);
    if (acc < 0.35 || !R.chance(0.35 + acc * 0.6)) {
      t.mind.allyCool = now() + 45;
      t.mind.trust[o.id] -= 0.15;
      return false;
    }
    if (alT) {
      if (alT.members.length >= maxAllianceSize(alT)) return false;
      joinAlliance(alT, o);
      const L = trib(alT.leaderId) || t;
      mlog('alliance', 'log.alliance.joined', { name: o.name, leader: L.name }, o, L);
      interest(o, 5, 8, 'ally:' + alT.id, { key: 'log.mind.i.alliance', params: { a: o.name, b: L.name } }, 'alliance');
    } else if (alO) {
      if (alO.members.length >= maxAllianceSize(alO)) return false;
      joinAlliance(alO, t);
      const L = trib(alO.leaderId) || o;
      mlog('alliance', 'log.alliance.joined', { name: t.name, leader: L.name }, t, L);
      interest(t, 5, 8, 'ally:' + alO.id, { key: 'log.mind.i.alliance', params: { a: t.name, b: L.name } }, 'alliance');
    } else {
      const al = createAlliance([t, o], false);
      mlog('alliance', 'log.alliance.formed', { a: t.name, b: o.name }, t, o, true);
      interest(t, 5, 9, 'ally:' + al.id, { key: 'log.mind.i.alliance', params: { a: t.name, b: o.name } }, 'alliance');
    }
    sfx('click', t.pos, 0.3);
    return true;
  }

  /** The Elite pack forms when the gong sounds. */
  function formElitePacks() {
    const elites = [];
    for (const t of GM.state.contestants) if (t && t.alive && t.archetype === 'elite' && t.allianceId == null) elites.push(t);
    if (elites.length < 2) return;
    // split into packs of at most 6 (two packs when there are many Elites)
    const packs = elites.length > 6 ? Math.ceil(elites.length / 5) : 1;
    const size = Math.ceil(elites.length / packs);
    for (let p = 0; p < packs; p++) {
      const list = elites.slice(p * size, (p + 1) * size);
      if (list.length < 2) continue;
      const al = createAlliance(list, true);
      const L = trib(al.leaderId);
      mlog('alliance', 'log.alliance.elites', { names: namesOf(al) }, L || list[0], null, true);
      interest(L || list[0], 5, 8, 'ally:' + al.id, { key: 'log.mind.i.alliance', params: { a: list[0].name, b: list[1].name } }, 'alliance');
    }
  }

  /** Move one unit of `what` from a to b. */
  function transfer(a, b, what) {
    const ia = a.inv, ib = b.inv;
    if (!ia || !ib || !(ia[what] > 0)) return false;
    ia[what]--;
    ib[what] = (ib[what] || 0) + 1;
    return true;
  }
  const SHARE_KINDS = ['water', 'food', 'medkit'];
  const STEAL_KINDS = ['medkit', 'food', 'water', 'berries', 'traps'];

  /** Allies share supplies (protectors always, others by loyalty). */
  function shareSupplies(al) {
    for (const gid of al.members) {
      const g = trib(gid);
      if (!g || !g.alive || !g.inv || g.sleeping) continue;
      const ga = g.mind.arch;
      const will = ga.share * 0.6 + g.traits.loyalty * 0.4;
      if (will < 0.35) continue;
      for (const rid of al.members) {
        if (rid === gid) continue;
        const r = trib(rid);
        if (!r || !r.alive || !r.inv || dd(g, r) > 9) continue;
        for (const k of SHARE_KINDS) {
          let need = false, spare = false;
          if (k === 'food') {
            need = r.hunger > 55 && !(r.inv.food > 0);
            spare = g.inv.food >= 2 || (g.inv.food >= 1 && ga.share >= 1 && g.hunger < r.hunger - 20);
          } else if (k === 'water') {
            need = r.thirst > 55 && !(r.inv.water > 0);
            spare = g.inv.water >= 2 || (g.inv.water >= 1 && ga.share >= 1 && g.thirst < r.thirst - 20);
          } else {
            need = hpFrac(r) < 0.45 && !(r.inv.medkit > 0);
            spare = g.inv.medkit >= 2 || (g.inv.medkit >= 1 && hpFrac(g) > 0.7 && (ga.share >= 1 || g.traits.loyalty > 0.75));
          }
          if (need && spare && R.chance(will) && transfer(g, r, k)) {
            mlog('alliance', 'log.alliance.share', { name: g.name, ally: r.name, item: itemName(k) }, g, r);
            r.mind.trust[g.id] = Math.min(1, r.mind.trust[g.id] + 0.2);
            r.emotion.sanity = clamp01(r.emotion.sanity + 0.04);
            return;   // one gift per check
          }
        }
      }
    }
  }

  /**
   * Betrayal: the betrayer leaves and attacks (or robs) the victim.
   * Returns true when it happened.
   */
  function betray(b, v, al) {
    if (!b.alive || !v.alive) return false;
    const bm = b.mind, vm = v.mind;
    const nowT = now();
    const weaker = POW[b.id] < POW[v.id] * 0.8 && !v.sleeping;
    const robOnly = weaker && b.traits.aggression < 0.55;
    leaveAlliance(b, { betrayal: true, silent: true });
    bm.trust[v.id] = -1;
    bm.betrayId = v.id;
    bm.betrayUntil = nowT + 40;
    if (vm) {
      vm.betrayed++;
      vm.paranoia = clamp01(vm.paranoia + 0.5);
      vm.trust[b.id] = -1;
      vm.grudge[b.id] = Math.max(vm.grudge[b.id], robOnly ? 0.6 : 0.9);
    }
    // the rest of the alliance hates the traitor too
    for (const id of al.members) {
      const o = trib(id);
      if (!o || !o.mind || o === b) continue;
      o.mind.trust[b.id] = -1;
      o.mind.grudge[b.id] = Math.max(o.mind.grudge[b.id], 0.5);
    }
    if (robOnly) {
      let stolen = null;
      for (const k of STEAL_KINDS) if (transfer(v, b, k)) { stolen = stolen || k; if (R.chance(0.5)) break; }
      mlog('betrayal', 'log.betray.steal', { name: b.name, target: v.name }, b, v, true);
      setPlan(b, 'flee', v.id, v.pos.x, v.pos.z, v, 'betray', 1.2);
    } else {
      mlog('betrayal', v.sleeping ? 'log.betray.sleep' : 'log.betray.attack', { name: b.name, target: v.name }, b, v, true);
      setPlan(b, dd(b, v) < 6 ? 'fight' : 'hunt', v.id, v.pos.x, v.pos.z, v, 'betray', 1.4);
    }
    interest(b, 9, 12, 'betray:' + b.id, { key: 'log.mind.i.betray', params: { name: b.name } }, 'betrayal');
    sfx('betray', b.pos, 0.8);
    b.emotion.sanity = clamp01(b.emotion.sanity - 0.04 * (1.3 - b.traits.stability));
    bm.nextThink = nowT + 1.5;
    return true;
  }

  /** How much b is inclined to betray (0..1+). */
  function betrayInclination(b) {
    const tr = b.traits, e = b.emotion;
    let v = (1 - tr.loyalty) * 0.55 + tr.cunning * 0.35 + tr.greed * 0.1 + (1 - e.sanity) * 0.2;
    if (b.archetype === 'opportunist') v += 0.15;
    if (b.archetype === 'elite') v += 0.05;
    return v;
  }

  /** Periodic alliance upkeep: leaders, night watch, sharing, splits, betrayal. */
  function allianceUpkeep() {
    const nowT = now();
    const late = aliveN <= 6;
    for (let ai = alliances.length - 1; ai >= 0; ai--) {
      const al = alliances[ai];
      if (!al) continue;
      // prune
      for (let i = al.members.length - 1; i >= 0; i--) {
        const t = trib(al.members[i]);
        if (!t || !t.alive || t.allianceId !== al.id) al.members.splice(i, 1);
      }
      if (al.members.length < 2) {
        GM.emit('alliance:broken', { alliance: al, byId: null, betrayal: false });
        removeAlliance(al);
        continue;
      }
      let leader = trib(al.leaderId);
      if (!leader || !leader.alive || leader.allianceId !== al.id) {
        leader = pickLeader(al);
        if (leader) al.leaderId = leader.id;
      }
      if (al.targetId != null) {
        const tg = trib(al.targetId);
        if (!tg || !tg.alive || tg.allianceId === al.id) al.targetId = null;
      }
      // final two: always fight
      if (aliveN <= 2) {
        const a = trib(al.members[0]), b = trib(al.members[1]);
        if (a && b) {
          mlog('alliance', 'log.alliance.final', { a: a.name, b: b.name }, a, b, true);
          finalLogged = true;
          for (const t of [a, b]) {
            leaveAlliance(t, { silent: true });
            t.mind.nextThink = nowT + 0.3;
          }
          interest(a, 12, 20, 'final', { key: 'log.mind.i.final', params: { a: a.name, b: b.name } }, 'finale');
        }
        continue;
      }
      // night watch
      if (ENV.night) {
        const w = trib(al.watchId);
        if (!w || !w.alive || w.sleeping || w.allianceId !== al.id || (w.energy || 0) < 20) {
          let best = null, be = -1;
          for (const id of al.members) {
            const t = trib(id);
            if (!t || t.sleeping || !t.alive) continue;
            const e = (t.energy || 0) + (t.archetype === 'protector' ? 15 : 0);
            if (e > be) { be = e; best = t; }
          }
          al.watchId = best && be > 25 ? best.id : null;
        }
      } else {
        al.watchId = null;
      }
      // sharing
      shareSupplies(al);
      // betrayal
      let betrayed = false;
      for (const id of al.members) {
        const b = trib(id);
        if (!b || !b.mind || b.mind.arch.neverBetray || b.sleeping) continue;
        const sb = statusOf(b);
        if (sb.panic > 0) continue;
        const incl = betrayInclination(b);
        // best victim nearby
        let victim = null, vs = -1;
        for (const vid of al.members) {
          if (vid === id) continue;
          const v = trib(vid);
          if (!v || !v.alive || dd(b, v) > 22) continue;
          const inv = invOf(v);
          let s = (v.sleeping ? 0.55 : 0) + (1 - hpFrac(v)) * 0.5 + (POW[b.id] > POW[v.id] * 1.2 ? 0.2 : 0) +
            clamp01((inv.food + inv.water + inv.medkit * 2 + (inv.ranged ? 2 : 0)) / 8) * 0.25;
          if (s > vs) { vs = s; victim = v; }
        }
        if (!victim) continue;
        let p;
        if (aliveN <= 3) p = incl * 0.45;
        else if (late) p = incl * incl * 0.1 * (0.5 + vs);
        else p = incl * incl * 0.0035 * (0.4 + vs) * (al.elites ? 0.5 : 1);
        if (R.chance(p)) { betrayed = betray(b, victim, al); break; }
      }
      if (betrayed) continue;
      // peaceful split late in the Show
      if (late) {
        let loy = 0, cnt = 0, weakest = null, wl = 2;
        for (const id of al.members) {
          const t = trib(id);
          if (!t || !t.traits) continue;
          loy += t.traits.loyalty; cnt++;
          const l = t.traits.loyalty + (t.mind.arch.neverBetray ? 0.3 : 0);
          if (l < wl) { wl = l; weakest = t; }
        }
        const avg = cnt ? loy / cnt : 0.5;
        const allProtect = al.members.every(function (id) { const t = trib(id); return t && t.archetype === 'protector'; });
        let p = 0.07 * (1.5 - avg);
        if (allProtect && aliveN > 3) p *= 0.25;
        if (weakest && R.chance(p)) {
          mlog('alliance', 'log.alliance.left', { name: weakest.name }, weakest, null, true);
          sayHold(weakest, 'thought.leaveAlly', null, undefined, 4);
          const others = al.members.slice();
          leaveAlliance(weakest, {});
          for (const id of others) {
            const o = trib(id);
            if (!o || o === weakest) continue;
            o.mind.trust[weakest.id] = Math.min(o.mind.trust[weakest.id], 0);
            weakest.mind.trust[o.id] = Math.min(weakest.mind.trust[o.id], 0);
            weakest.mind.avoidId = o.id;
          }
          weakest.mind.avoidUntil = nowT + 45;
        }
      }
    }
  }

  // ======================================================================
  // Plans
  // ======================================================================
  const COVER = new Float32Array(MAXN);   // forest cover at each contestant (refreshed with POW)
  let gongAt = -1e9;                      // sim time of the gong (kickoff start)

  /** Typical plan length (sim s); after it the plan counts as "done" and is re-decided. */
  const PLAN_TIME = {
    idle: 5, wander: 40, loot: 30, flee: 12, hide: 45, hunt: 75, fight: 30, stalk: 60, drink: 45,
    eat: 2.5, forage: 30, rest: 8, sleep: 240, heal: 2.5, ally: 20, follow: 25, guard: 50, trap: 25,
    ambush: 90, steal: 35, investigate: 35, feast: 120, avoid: 14, escape_zone: 45, panic: 8, mad: 30,
    berserk: 25, kickoff: 45, scatter: 45,
  };

  function wake(t) {
    if (!t.sleeping) return;
    if (GM.Contestants && typeof GM.Contestants.setSleeping === 'function') tCall('setSleeping', t, false);
    else t.sleeping = false;
    const m = t.mind;
    if (!m) return;
    const nowT = now();
    m.lastWakeAt = nowT;
    if (m.plan.id === 'sleep') m.plan.done = true;
    m.nextThink = Math.min(m.nextThink, nowT + 0.1);
    m.nextPerceive = Math.min(m.nextPerceive, nowT + 0.05);
  }
  function fallAsleep(t) {
    if (t.sleeping) return;
    halt(t);
    if (GM.Contestants && typeof GM.Contestants.setSleeping === 'function') tCall('setSleeping', t, true);
    else t.sleeping = true;
  }

  function leavePlan(t, oldId) {
    const m = t.mind;
    if (oldId === 'sleep' && t.sleeping) wake(t);
    if (oldId === 'hide' || oldId === 'ambush' || oldId === 'sleep') t.hidden = false;
    if (oldId === 'hide') m.lastHideEnd = now();
    if (oldId === 'ambush') m.ambushCool = now() + 50;
  }

  /**
   * Switch to (or refresh) a plan. The same plan with the same target keeps
   * its progress (stage, timers). x/z = NaN means "pick a spot now"
   * (hide, sleep, trap, ambush, forage, scatter, wander, guard).
   */
  function setPlan(t, id, targetId, x, z, ref, flavor, score) {
    const m = t.mind, p = m.plan, nowT = now();
    if (targetId == null || targetId < 0) targetId = -1;
    ref = ref || null;
    const same = !p.done && p.id === id && p.targetId === targetId && p.ref === ref;
    if (!same) {
      if (p.id !== id) leavePlan(t, p.id);
      p.prev = p.id;
      p.since = nowT;
      p.stage = 0; p.timer = 0; p.t2 = 0; p.n = 0; p.aux = -1; p.obj = null;
      p.until = nowT + (PLAN_TIME[id] || 30) * R.range(0.8, 1.25);
      p.id = id;
      p.targetId = targetId;
      p.ref = ref;
      p.flavor = flavor || '';
      if (x === x && z === z) { p.x = x; p.z = z; } else chooseSpot(t, p);
      p.ex = p.x; p.ez = p.z;
      p.done = false;
      planStarted(t, p);
    } else {
      if (x === x && z === z) { p.x = x; p.z = z; }
      p.flavor = flavor || '';
    }
    p.score = score || 0;
    p.done = false;
    t.action = id;
    t.targetId = ref && ref.kind === 'contestant' ? ref.id : null;
  }

  /** Logs, interests and alliance bookkeeping when a new plan starts. */
  function planStarted(t, p) {
    const m = t.mind, nowT = now();
    const tg = p.ref && p.ref.kind === 'contestant' ? p.ref : null;
    if (p.id === 'hunt' && tg) {
      const al = allianceOf(t);
      if (al && al.leaderId === t.id && !allied(t, tg)) {
        al.targetId = tg.id;
        if (al.members.length >= 2) interest(t, 5, 10, 'pack:' + al.id, { key: 'log.mind.i.pack', params: { target: tg.name } }, 'hunt');
      } else if (p.flavor !== 'pack') {
        interest(t, p.flavor === 'revenge' || p.flavor === 'final' ? 5 : 3, 10, 'hunt:' + t.id,
          { key: 'log.mind.i.hunt', params: { name: t.name, target: tg.name } }, 'hunt');
      }
    } else if (p.id === 'stalk' && tg) {
      interest(t, 3, 10, 'stalk:' + t.id, { key: 'log.mind.i.stalk', params: { name: t.name, target: tg.name } }, 'stalk');
    } else if (p.id === 'berserk') {
      if (nowT >= m.nextBerserkLog) {
        m.nextBerserkLog = nowT + 90;
        mlog('mind', 'log.mind.berserk', { name: t.name }, t, tg, true);
        GM.emit('mind:snap', { contestant: t, kind: 'berserk' });
      }
      interest(t, 6, 10, 'berserk:' + t.id, { key: 'log.mind.i.mad', params: { name: t.name } }, 'fight');
    } else if (p.id === 'fight' && p.flavor === 'defend' && tg) {
      const ally = trib(m.defendId);
      p.aux = m.defendId;
      if (ally && nowT - m.lastDefendLog > 40) {
        m.lastDefendLog = nowT;
        mlog('alliance', 'log.alliance.defend', { name: t.name, ally: ally.name }, t, ally);
      }
    }
  }

  /** Pick a destination for plans that start with x/z = NaN. */
  function chooseSpot(t, p) {
    const m = t.mind;
    let x = t.pos.x, z = t.pos.z;
    switch (p.id) {
      case 'hide':
      case 'sleep': {
        if (p.id === 'sleep' && m.coverHere > 0.55) break;      // already a good place
        findHideSpot(t, p.id === 'sleep' ? 45 : 55);
        x = P.x; z = P.z;
        break;
      }
      case 'ambush': {
        let cx = t.pos.x, cz = t.pos.z, found = false;
        if (m.hasTrapSpot && dxz(t, m.trapX, m.trapZ) < 90) { cx = m.trapX; cz = m.trapZ; found = true; }
        else if (p.flavor === 'water' && knowWater(t)) { cx = m.waterX; cz = m.waterZ; found = true; }
        if (found) {
          let best = -1e9;
          for (let i = 0; i < 7; i++) {
            const an = R.angle(), r = R.range(5, 11);
            const px = cx + Math.sin(an) * r, pz = cz + Math.cos(an) * r;
            if (isWater(px, pz) || !inArena(px, pz, 8)) continue;
            const s = coverAt(px, pz) - dangerAt(px, pz) * 3;
            if (s > best) { best = s; x = px; z = pz; }
          }
          if (best === -1e9) { x = cx; z = cz; }
        } else if (!ENV.fog) {
          findHideSpot(t, 30);
          x = P.x; z = P.z;
        }
        break;
      }
      case 'trap': {
        if (p.flavor === 'water' && knowWater(t) && dxz(t, m.waterX, m.waterZ) < 80) {
          for (let i = 0; i < 6; i++) {
            const an = R.angle(), r = R.range(2, 5);
            const px = m.waterX + Math.sin(an) * r, pz = m.waterZ + Math.cos(an) * r;
            if (!isWater(px, pz)) { x = px; z = pz; break; }
          }
        } else {
          const h = t.heading || 0;
          x = t.pos.x + Math.sin(h) * 3;
          z = t.pos.z + Math.cos(h) * 3;
        }
        break;
      }
      case 'forage': {
        let best = coverAt(x, z) * 0.8;
        for (let i = 0; i < 8; i++) {
          const an = R.angle(), r = R.range(10, 45);
          const px = t.pos.x + Math.sin(an) * r, pz = t.pos.z + Math.cos(an) * r;
          if (!inArena(px, pz, 10) || isWater(px, pz)) continue;
          const b = biomeAt(px, pz);
          const s = coverAt(px, pz) + (b === 'grass' || b === 'forest' || b === 'swamp' ? 0.2 : -0.2) -
            dangerAt(px, pz) * 3 - r / 150;
          if (s > best) { best = s; x = px; z = pz; }
        }
        break;
      }
      case 'scatter': {
        let ax = t.pos.x, az = t.pos.z;
        const l = Math.sqrt(ax * ax + az * az);
        if (l < 1) { const an = R.angle(); ax = Math.sin(an); az = Math.cos(an); } else { ax /= l; az /= l; }
        const base = Math.atan2(ax, az);
        let best = -1e9;
        for (let i = 0; i < 6; i++) {
          const an = base + R.range(-0.7, 0.7), r = R.range(60, 112);
          const px = Math.sin(an) * r, pz = Math.cos(an) * r;
          if (!inArena(px, pz, 14)) continue;
          const s = coverAt(px, pz) * 1.2 - (isWater(px, pz) ? 2 : 0) - dangerAt(px, pz) * 3 + R.range(0, 0.3);
          if (s > best) { best = s; x = px; z = pz; }
        }
        if (best === -1e9) { x = ax * 80; z = az * 80; }
        break;
      }
      case 'wander': {
        if (p.flavor === 'drift') {
          const zn = zoneInfo();
          const cx = zn ? zn.center.x : 0, cz = zn ? zn.center.z : 0;
          const an = R.angle(), r = R.range(4, zn ? Math.min(25, zn.radius * 0.5) : 28);
          x = cx + Math.sin(an) * r;
          z = cz + Math.cos(an) * r;
        } else {
          let best = -1e9;
          for (let i = 0; i < 5; i++) {
            const an = R.angle(), r = R.range(22, 60);
            const px = t.pos.x + Math.sin(an) * r, pz = t.pos.z + Math.cos(an) * r;
            if (!inArena(px, pz, 12)) continue;
            const rr = Math.sqrt(px * px + pz * pz);
            const s = -(isWater(px, pz) ? 2 : 0) - dangerAt(px, pz) * 3 - Math.max(0, rr - 110) * 0.03 + R.range(0, 0.5);
            if (s > best) { best = s; x = px; z = pz; }
          }
        }
        break;
      }
      case 'guard': {
        const an = R.angle(), r = R.range(5, 13);
        x = Math.sin(an) * r;
        z = Math.cos(an) * r;
        break;
      }
      case 'kickoff': {
        // a spot at the Nexus, on the contestant's own side of the plaza
        const base = Math.atan2(t.pos.x, t.pos.z) + R.range(-0.8, 0.8), r = R.range(3, 9);
        x = Math.sin(base) * r;
        z = Math.cos(base) * r;
        break;
      }
      default:
        break;
    }
    P.x = x; P.z = z;
    clampToArena(P, 8);
    p.x = P.x; p.z = P.z;
  }

  // ======================================================================
  // Combat helpers (GM.Combat when present, a simple melee fallback otherwise)
  // ======================================================================
  const FALLBACK_ATTACK = { mode: 'melee', range: 1.6, def: null };

  /** Can t attack tg from where it stands? -> attack option or null. */
  function canHit(t, tg) {
    const C = GM.Combat;
    if (C && typeof C.bestAttack === 'function') {
      try { return C.bestAttack(t, tg) || null; } catch (e) { GM.reportError('AI.Combat.bestAttack', e); }
      return null;
    }
    return dd(t, tg) <= meleeRange(t) + num(tg.radius, 0.45) + 0.15 ? FALLBACK_ATTACK : null;
  }

  function attack(t, tg) {
    const C = GM.Combat;
    if (C && typeof C.tryAttack === 'function') {
      try { return C.tryAttack(t, tg); } catch (e) { GM.reportError('AI.Combat.tryAttack', e); return false; }
    }
    return fallbackAttack(t, tg);
  }

  /** Minimal melee when combat.js is missing (keeps the Show playable). */
  function fallbackAttack(t, tg) {
    const m = t.mind, inv = invOf(t), nowT = now();
    const w = weaponDef(inv.melee);
    if (dd(t, tg) > defRange(w, 1.6) + num(tg.radius, 0.45) + 0.2) return 'range';
    if (nowT < m.nextAttack) return 'cooldown';
    m.nextAttack = nowT + (w ? num(w.cd, num(w.cooldown, 0.9)) : 0.9);
    tCall('faceToward', t, tg.pos.x, tg.pos.z);
    tCall('playAttack', t);
    noise(t.pos, 40, 'fight', t.id);
    let hitP = 0.85;
    if (tg.sleeping || (tg.status && tg.status.stun > 0)) hitP += 0.1;
    if (!R.chance(hitP)) return 'miss';
    let dmg = defDamage(w, 6) * (0.8 + 0.45 * num(t.skills && t.skills.strength, 0.5));
    if (tg.sleeping) dmg *= 1.8;
    if (tg.kind === 'beast') {
      const M = GM.Beasts;
      if (M && typeof M.damage === 'function') {
        try { M.damage(tg, dmg, t); } catch (e) { GM.reportError('AI.Beasts.damage', e); }
      }
    } else {
      tCall('damage', tg, dmg, { cause: inv.melee ? 'weapon' : 'fists', attacker: t, beast: null, weapon: inv.melee || null, pos: t.pos });
    }
    return 'hit';
  }

  // ======================================================================
  // Perception
  // ======================================================================
  const FOV_COS = -0.5;   // ~240 degree field of view

  /** How dangerous contestant o looks to t (0 .. ~3). */
  function threatOf(t, o, d, myP) {
    const m = t.mind;
    let host = 0.3 + (o.traits ? o.traits.aggression * 0.35 : 0.2);
    if (o.targetId === t.id && HOSTILE_ACT[o.action]) host += 0.7;
    if (m.lastHitBy === o.id && now() - m.lastHitAt < 8) host += 0.6;
    const so = statusOf(o);
    if (so.madness > 0 || o.action === 'berserk') host += 0.5;
    if (m.trust[o.id] > 0.3) host *= 0.5;
    if (o.sleeping) host *= 0.1;
    const ratio = clamp(POW[o.id] / myP, 0.15, 3);
    return host * ratio * (0.3 + 0.7 * clamp01(1 - d / 50));
  }

  /** Best item and best crate the contestant knows about. */
  function scanItems(t) {
    const m = t.mind, nowT = now();
    m.itemRef = null; m.itemScore = 0; m.itemBody = -1;
    m.crateRef = null; m.crateScore = 0;
    const I = GM.Items;
    const list = I && I.list;
    if (!list || !list.length) return;
    const valueFn = typeof I.value === 'function' ? I.value : null;
    const range = Math.max(16, 48 * (invOf(t).goggles && ENV.night ? 0.95 : ENV.vis));
    const r2 = range * range;
    const bad = m.badItemUntil > nowT ? m.badItem : null;
    for (let k = 0; k < list.length; k++) {
      const it = list[k];
      if (!it || it.removed || !it.pos || it === bad) continue;
      if (it.claimedBy != null && it.claimedBy !== t.id) continue;   // sponsor gifts for someone else
      const dx = it.pos.x - t.pos.x, dz = it.pos.z - t.pos.z;
      const d2 = dx * dx + dz * dz;
      if (it.crate) {
        // parachutes and beeping crates are seen from far away
        if (d2 > 140 * 140) continue;
        if (it.feast && d2 > 30 * 30) continue;                    // the feast plan handles those
        let v = 0.7;
        if (valueFn) { try { v = valueFn(t, it); } catch (e) { v = 0.5; } }
        const d = Math.sqrt(d2);
        const s = v * (1 - d / 190);
        if (s > m.crateScore) { m.crateScore = s; m.crateRef = it; }
      } else {
        if (d2 > r2 || it.falling) continue;
        let v = 0.3;
        if (valueFn) { try { v = valueFn(t, it); } catch (e) { v = 0.2; } }
        if (!(v > 0.06)) continue;
        const s = v / (1 + Math.sqrt(d2) / 24);
        if (s > m.itemScore) { m.itemScore = s; m.itemRef = it; }
      }
    }
    if (m.itemRef) {
      const it = m.itemRef;
      for (let i = 0; i < BODIES.length; i++) {
        const b = BODIES[i];
        if (b.id < 0 || nowT - b.t > 90) continue;
        const dx = b.x - it.pos.x, dz = b.z - it.pos.z;
        if (dx * dx + dz * dz < 25) { m.itemBody = b.id; break; }
      }
    }
  }

  /** Nearest dangerous thing (fire, gas, fireballs, blasts, quakes). */
  function scanDanger(t) {
    const m = t.mind, nowT = now();
    const here = dangerAt(t.pos.x, t.pos.z);
    if (here < 0.01 && nowT < m.dangerScanAt) return;
    m.dangerScanAt = nowT + (here > 0.01 ? 0.35 : 0.8);
    let best = 0, bx = 0, bz = 0, br = 0, bt = '';
    const H = GM.Hazards;
    if (H && typeof H.dangers === 'function') {
      let list = null;
      try { list = H.dangers(t.pos, 40); } catch (e) { GM.reportError('AI.dangers', e); }
      if (list) {
        for (let i = 0; i < list.length; i++) {
          const dn = list[i];
          if (!dn || dn.type === 'zone') continue;
          const r = num(dn.radius, 8);
          const d = dxz(t, dn.x, dn.z);
          const u = num(dn.level, 0.5) * clamp01(1 - (d - r) / 22);
          if (u > best) { best = u; bx = dn.x; bz = dn.z; br = r; bt = dn.type || 'danger'; }
        }
      }
    }
    for (let i = 0; i < BLASTS.length; i++) {
      const b = BLASTS[i];
      if (b.until < nowT) continue;
      const d = dxz(t, b.x, b.z);
      const u = 0.85 * clamp01(1 - (d - b.r) / 16);
      if (u > best) { best = u; bx = b.x; bz = b.z; br = b.r; bt = b.type; }
    }
    if (here > best) { best = here; if (!bt) { bx = t.pos.x; bz = t.pos.z; br = 6; bt = 'danger'; } }
    m.dangerLevel = here;
    m.dangerLvl = best;
    m.dangerNear = best > 0.18;
    m.dangerX = bx; m.dangerZ = bz; m.dangerR = br; m.dangerType = bt;
  }

  /** Highest reachable ground above a flood level. */
  function findHighGround(t, level) {
    const m = t.mind;
    let best = -1e9, bx = t.pos.x, bz = t.pos.z;
    const T = GM.Terrain;
    const hills = T && T.landmarks && T.landmarks.hills;
    if (hills) {
      for (let i = 0; i < hills.length; i++) {
        const h = hills[i];
        const d = dxz(t, h.x, h.z);
        const y = heightAt(h.x, h.z);
        if (y < level + 2 || !inArena(h.x, h.z, 10)) continue;
        const s = Math.min(y - level, 8) - d * 0.05 - dangerAt(h.x, h.z) * 10;
        if (s > best) { best = s; bx = h.x; bz = h.z; }
      }
    }
    for (let ring = 0; ring < 3; ring++) {
      const r = 18 + ring * 26;
      for (let i = 0; i < 6; i++) {
        const an = R.angle();
        const px = t.pos.x + Math.sin(an) * r, pz = t.pos.z + Math.cos(an) * r;
        if (!inArena(px, pz, 10)) continue;
        const y = heightAt(px, pz);
        const s = Math.min(y - level, 8) - r * 0.05 - dangerAt(px, pz) * 10;
        if (s > best) { best = s; bx = px; bz = pz; }
      }
    }
    m.floodX = bx; m.floodZ = bz; m.floodAt = now();
  }

  /** Look, listen and update memory + emotion baselines. */
  function perceive(t) {
    const m = t.mind, e = t.emotion, tr = t.traits, a = m.arch, nowT = now();
    const inv = invOf(t), st = statusOf(t), hp = hpFrac(t);
    const trs = GM.state.contestants;
    const asleep = !!t.sleeping;
    const know = revealOn || aliveN <= 2;
    const my = t.id;
    let sight = 60 * ENV.vis;
    if (inv.goggles && ENV.night) sight = 60 * (ENV.fog ? Math.max(ENV.vis, 0.45) : 0.92);
    if (st.stung > 0) sight *= 0.7;
    const hx = Math.sin(t.heading || 0), hz = Math.cos(t.heading || 0);
    const myP = Math.max(0.05, POW[my] || powerOf(t));
    const myAl = allianceOf(t);
    const canAlly = !asleep && aliveN > 6 && a.ally >= 0 && m.allyCool <= nowT && nowT - gongAt > 25 &&
      !(myAl && myAl.members.length >= maxAllianceSize(myAl));
    let visN = 0, allies = 0, nearId = -1, nearD = 1e9, thrId = -1, thrL = 0, thrD = 1e9;
    let slId = -1, slD = 1e9, candId = -1, candS = 0, defId = -1, defAtk = -1, maxGrudge = 0;
    for (let i = 0; i < trs.length && i < MAXN; i++) {
      const o = trs[i];
      if (!o || o === t || !o.alive || !o.pos) { m.visible[i] = 0; continue; }
      const dx = o.pos.x - t.pos.x, dz = o.pos.z - t.pos.z;
      const d2 = dx * dx + dz * dz;
      const isAlly = allied(t, o);
      let vis = false;
      if (!asleep) {
        const quiet = o.sneaking || o.hidden;
        const close = quiet ? 3.5 : 8;
        if (d2 < close * close) vis = true;
        else {
          let r = sight;
          const cov = COVER[i];
          if (cov > 0.05) r *= 1 - 0.6 * cov;
          if (quiet) r *= 0.55;
          if (o.sleeping && cov > 0.3) r *= 0.35;
          if (d2 < r * r) vis = (dx * hx + dz * hz) / Math.sqrt(d2) > FOV_COS;
        }
      } else if (d2 < 25 && !o.sneaking && !isAlly && R.chance(0.06 + num(t.skills && t.skills.survival, 0.5) * 0.12)) {
        wake(t);   // woken by footsteps
      }
      m.visible[i] = vis ? 1 : 0;
      if (vis || know) { m.seenT[i] = nowT; m.seenX[i] = o.pos.x; m.seenZ[i] = o.pos.z; }
      if (m.grudge[i] > maxGrudge) maxGrudge = m.grudge[i];
      const d = Math.sqrt(d2);
      if (!vis) {
        // whoever just hurt us stays a threat even when unseen
        if (!isAlly && m.lastHitBy === i && nowT - m.lastHitAt < 5) {
          const th = threatOf(t, o, d, myP);
          if (th > thrL) { thrL = th; thrId = i; thrD = d; }
        }
        continue;
      }
      visN++;
      if (isAlly) {
        if (d < 25) allies++;
        const la = o.lastAttackedBy;
        if (la != null && la !== my && nowT - num(o.lastAttackedAt, -1e6) < 3 && d < 35) {
          const atk = trib(la);
          if (atk && atk.alive && !allied(t, atk)) { defId = i; defAtk = la; }
        }
        continue;
      }
      if (d < nearD) { nearD = d; nearId = i; }
      if (o.sleeping && d < 45 && d < slD) { slD = d; slId = i; }
      const th = threatOf(t, o, d, myP);
      if (th > thrL) { thrL = th; thrId = i; thrD = d; }
      if (canAlly && d < 30 && o.mind && (!myAl || o.allianceId == null) && o.targetId !== my && m.grudge[i] < 0.1) {
        if (o.allianceId != null) {
          const oal = allianceOf(o);
          if (oal && oal.members.length >= maxAllianceSize(oal)) continue;
        }
        let s = compat(t.archetype, o.archetype) * (0.35 + tr.sociability * 0.65) + m.trust[i] * 0.4 + a.ally * 0.3 - d / 120;
        if (o.team === t.team) s += 0.2;
        if (s > candS) { candS = s; candId = i; }
      }
    }

    // ---- beasts
    let mRef = null, mD = 1e9, mCount = 0;
    const beasts = GM.state.beasts;
    if (beasts && beasts.length) {
      for (let k = 0; k < beasts.length; k++) {
        const mu = beasts[k];
        if (!mu || !mu.alive || !mu.pos) continue;
        const d = dxz(t, mu.pos.x, mu.pos.z);
        if (d > 50) continue;
        const noticed = mu.type === 'wasps' ? d < 28 : (d < Math.max(14, sight) || mu.targetId === my);
        if (!noticed) continue;
        if (d < 25) mCount++;
        if (d < mD) { mD = d; mRef = mu; }
      }
    }
    m.beastRef = mRef; m.beastD = mD; m.beastCount = Math.max(mCount, mRef ? 1 : 0); m.beastType = mRef ? mRef.type : '';

    // ---- items, dangers
    if (!asleep && nowT >= m.itemScanAt) {
      scanItems(t);
      m.itemScanAt = nowT + (nowT - gongAt < 60 ? 0.45 : 1.1);
    }
    scanDanger(t);

    // ---- force field
    const zn = zoneInfo();
    m.zoneOut = -1e3;
    m.zoneEarly = false;
    if (zn) {
      const zx = t.pos.x - zn.center.x, zz = t.pos.z - zn.center.z;
      const zd = Math.sqrt(zx * zx + zz * zz);
      m.zoneOut = zd - zn.radius + 3;
      const target = num(zn.targetRadius, zn.radius);
      m.zoneEarly = target < zn.radius - 1 && zd > target - 4;
      m.zoneX = zn.center.x; m.zoneZ = zn.center.z;
    }

    // ---- flood / water
    const fl = GM.Hazards && GM.Hazards.flooding;
    const flooding = (fl && fl.active) || ENV.floodUntil > nowT;
    m.flood = false;
    if (flooding) {
      const lvl = fl && fl.active && typeof fl.level === 'number' ? fl.level : ENV.water + 3;
      if (heightAt(t.pos.x, t.pos.z) < lvl + 1) {
        m.flood = true;
        if (nowT - m.floodAt > 8 || heightAt(m.floodX, m.floodZ) < lvl + 1.5) findHighGround(t, lvl);
      }
    }
    m.inWaterBad = !!t.swimming && !m.flood && !(mRef && mRef.type === 'wasps' && mD < 35);
    m.cold = ENV.cold && !inv.sleepingBag;
    m.coverHere = COVER[my];

    // ---- summary
    m.visCount = visN;
    m.alliesNear = allies;
    m.nearEnemyId = nearId; m.nearEnemyD = nearD;
    m.threatId = thrId; m.threatLevel = thrL; m.threatD = thrD;
    m.sleeperId = slId;
    m.allyCandId = candId; m.allyCandScore = candS;
    m.defendId = defId; m.defendAttackerId = defAtk;
    if (t.health > m.hpSeen) m.hpSeen = t.health;

    // night watch: the guard wakes the sleepers
    if (myAl && myAl.watchId === my && thrId >= 0 && thrD < 40) {
      for (const id of myAl.members) { const o = trib(id); if (o && o.sleeping) wake(o); }
    }

    // ---- emotion baselines
    const needs = Math.max(t.hunger || 0, t.thirst || 0) / 100;
    const wq = weaponQuality(t);
    let fb = 0.08 + (1 - tr.bravery) * 0.14;
    fb += Math.min(1.2, thrL) * (0.55 - tr.bravery * 0.2);
    if (mRef) fb += (mRef.type === 'wasps' ? 0.35 : 0.22) + Math.min(0.3, mCount * 0.07);
    if (m.dangerNear) fb += m.dangerLvl * 0.45;
    if (m.zoneOut > 0) fb += 0.25;
    if (m.flood) fb += 0.2;
    if (ENV.night && allies === 0) fb += 0.07 * (1 - tr.bravery);
    if (hp < 0.5) fb += (0.5 - hp) * 0.7;
    if (st.stung > 0) fb += 0.25;
    fb -= Math.min(0.15, allies * 0.05) + wq * 0.12 + (inv.armor ? 0.05 : 0);
    m.fearBase = clamp(fb, 0.02, 0.97);
    m.confBase = clamp(0.22 + a.conf + wq * 0.3 + hp * 0.2 + Math.min(0.25, (t.kills || 0) * 0.06) + (inv.armor ? 0.08 : 0) +
      Math.min(0.12, allies * 0.04) + (tr.bravery - 0.5) * 0.2 - needs * 0.15, 0.02, 0.98);
    m.rageBase = clamp(0.02 + tr.aggression * 0.05 + maxGrudge * 0.25 + (a.id === 'berserker' ? 0.06 : 0), 0, 0.6);
    let sr = 0;
    if ((t.hunger || 0) > 75) sr -= 0.0012 * ((t.hunger - 75) / 25);
    if ((t.thirst || 0) > 75) sr -= 0.0016 * ((t.thirst - 75) / 25);
    if (num(t.energy, 100) < 15) sr -= 0.001;
    if (st.stung > 0 || st.madness > 0) sr -= 0.004;
    if (allies === 0 && t.allianceId == null && tr.sociability > 0.5 && GM.state.day >= 2) sr -= 0.0004 * tr.sociability;
    sr *= 1.3 - tr.stability;
    if (sr === 0 && needs < 0.5 && hp > 0.5) sr = 0.0005 * (0.5 + tr.stability) * (allies > 0 ? 1.6 : 1);
    m.sanityRate = sr;

    t.mood = moodOf(t);
    checkMind(t);
  }

  // ======================================================================
  // Emotions, mood, mind breaks
  // ======================================================================
  function updateEmotions(t, dt) {
    const e = t.emotion, m = t.mind, tr = t.traits;
    const fb = m.fearBase;
    e.fear = clamp01(e.fear + (fb - e.fear) * Math.min(1, (fb > e.fear ? 1.3 : 0.1 + tr.bravery * 0.12) * dt));
    e.confidence = clamp01(e.confidence + (m.confBase - e.confidence) * Math.min(1, 0.22 * dt));
    const rb = m.rageBase;
    e.rage = clamp01(e.rage + (rb - e.rage) * Math.min(1, (rb > e.rage ? 0.4 : m.rageDecay) * dt));
    e.sanity = clamp01(e.sanity + m.sanityRate * dt);
  }

  function moodOf(t) {
    const e = t.emotion, st = statusOf(t), hp = hpFrac(t);
    if (t.sleeping) return 'asleep';
    if (st.madness > 0 || st.stung > 0 || e.sanity < 0.22) return 'mad';
    if (hp < 0.3) return 'hurt';
    if (st.panic > 0 || e.fear > 0.62) return 'afraid';
    if (e.rage > 0.58 || t.action === 'berserk') return 'angry';
    if (hp < 0.45) return 'hurt';
    if ((t.hunger || 0) > 80 || (t.thirst || 0) > 80 || (hp < 0.6 && e.fear > 0.45)) return 'desperate';
    if (e.confidence > 0.68) return 'confident';
    return 'calm';
  }

  /** Madness episodes, panic attacks, talking to yourself, recovery. */
  function checkMind(t) {
    const m = t.mind, e = t.emotion, tr = t.traits, st = statusOf(t), nowT = now();
    if (m.wasMad && !(st.madness > 0)) {
      m.wasMad = false;
      if (m.snapped) {
        m.snapped = false;
        e.sanity = Math.max(e.sanity, 0.38);
        mlog('mind', 'log.mind.recover', { name: t.name }, t);
      } else {
        e.sanity = clamp01(e.sanity + 0.08);
      }
      if (m.plan.id === 'mad') m.plan.done = true;
    }
    if (t.sleeping || !GM.isRunning()) return;
    if (e.sanity < 0.2 && nowT >= m.nextSnapAt && !(st.madness > 0)) {
      m.nextSnapAt = nowT + 150 + tr.stability * 150;
      m.snapped = true;
      mlog('mind', 'log.mind.snap', { name: t.name }, t, null, true);
      applyStatus(t, 'madness', R.range(14, 24));
      return;
    }
    if (e.fear > 0.9 && tr.bravery < 0.6 && nowT >= m.nextPanicAt && !(st.panic > 0) && aliveN > 2 &&
        (m.threatD < 22 || m.dangerNear || m.beastD < 15)) {
      m.nextPanicAt = nowT + 50 + tr.stability * 40;
      applyStatus(t, 'panic', R.range(4, 7));
      return;
    }
    if (e.sanity < 0.42 && m.alliesNear === 0 && nowT - m.lastLonelyLog > 200 && R.chance(0.04)) {
      m.lastLonelyLog = nowT;
      mlog('mind', 'log.mind.lonely', { name: t.name }, t);
    }
  }

  // ======================================================================
  // Hearing, statuses, damage reactions (public)
  // ======================================================================
  function hasMind(t) { return !!(t && t.alive && t.mind && t.mind.v === 1 && t.emotion && t.traits); }
  function thinkSoon(m, delay) {
    const at = now() + (delay == null ? 0.1 : delay);
    if (m.nextThink > at) m.nextThink = at;
    if (m.execAt > at) m.execAt = at;
  }

  /**
   * Something audible happened. kind: 'fight' | 'explosion' | 'lure' |
   * 'scream' | 'knell' | anything else. Contestants inside the radius
   * remember it (investigate / flee / stalk) and may wake up.
   */
  function noise(pos, radius, kind, sourceId) {
    if (!pos) return;
    const st = GM.state;
    if (st.phase !== 'running' && st.phase !== 'ended') return;
    radius = Math.max(1, num(radius, 30));
    kind = kind || 'noise';
    const trs = st.contestants, nowT = now();
    const x = num(pos.x, 0), z = num(pos.z, 0);
    const r2 = radius * radius;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!hasMind(t) || i === sourceId) continue;
      const dx = x - t.pos.x, dz = z - t.pos.z;
      const d2 = dx * dx + dz * dz;
      if (kind !== 'knell' && d2 > r2) continue;
      const m = t.mind, e = t.emotion, tr = t.traits;
      if (kind === 'knell') {
        e.fear = clamp01(e.fear + 0.03 * (1.1 - tr.bravery));
        continue;
      }
      const d = Math.sqrt(d2);
      let str = 1 - d / radius;
      if (kind === 'explosion') str = 0.4 + str * 0.6;
      if (t.sleeping) {
        const wp = kind === 'explosion' ? 1 : kind === 'lure' ? 0.5 : kind === 'fight' ? str * 0.9 : kind === 'scream' ? str * 0.7 : str * 0.3;
        if (!R.chance(wp)) continue;
        wake(t);
      }
      const age = nowT - m.heardT;
      if (age > 6 || str >= m.heardStr * Math.max(0, 1 - age / 12) || (kind === 'lure' && m.heardKind !== 'lure')) {
        m.heardX = x; m.heardZ = z; m.heardKind = kind; m.heardT = nowT; m.heardStr = str;
        m.heardSrc = sourceId == null ? -1 : sourceId;
      }
      if (kind === 'explosion') e.fear = clamp01(e.fear + 0.18 * str * (1.2 - tr.bravery));
      else if (kind === 'scream') e.fear = clamp01(e.fear + 0.05 * str * (1.2 - tr.bravery));
      else if (kind === 'fight' && d < 25) e.fear = clamp01(e.fear + 0.02 * (1.1 - tr.bravery));
      if (str > 0.35 || kind === 'lure' || kind === 'explosion') thinkSoon(m, R.range(0.15, 0.6));
    }
  }

  /**
   * Status with a mind effect: 'madness' (attack anyone, erratic), 'panic'
   * (run away blindly), 'stung' (hallucinations). Others are passed through.
   */
  function applyStatus(t, status, seconds) {
    if (!t || !t.alive || !status) return;
    seconds = num(seconds, 10);
    if (GM.Contestants && typeof GM.Contestants.setStatus === 'function') tCall('setStatus', t, status, seconds);
    else if (t.status) t.status[status] = Math.max(t.status[status] || 0, seconds);
    if (!hasMind(t)) return;
    const m = t.mind, e = t.emotion, nowT = now();
    if (!GM.isRunning()) return;
    if (status === 'madness') {
      if (t.sleeping) wake(t);
      m.wasMad = true;
      e.sanity = clamp01(e.sanity - 0.08);
      e.rage = clamp01(e.rage + 0.3);
      if (nowT - m.lastMadLog > 20) {
        m.lastMadLog = nowT;
        interest(t, 7, 10, 'mad:' + t.id, { key: 'log.mind.i.mad', params: { name: t.name } }, 'mind');
        GM.emit('mind:snap', { contestant: t, kind: 'madness' });
      }
      setPlan(t, 'mad', -1, NaN, NaN, null, '', 5);
      thinkSoon(m, 0);
    } else if (status === 'panic') {
      if (t.sleeping) wake(t);
      e.fear = Math.max(e.fear, 0.9);
      if (nowT - m.lastPanicLog > 30) {
        m.lastPanicLog = nowT;
        mlog('mind', 'log.mind.panic', { name: t.name }, t);
        GM.emit('mind:snap', { contestant: t, kind: 'panic' });
      }
      setPlan(t, 'panic', -1, NaN, NaN, null, '', 5);
      thinkSoon(m, 0);
    } else if (status === 'stung') {
      e.sanity = clamp01(e.sanity - 0.05 * (1.3 - t.traits.stability));
      e.fear = clamp01(e.fear + 0.2);
      if (t.sleeping) wake(t);
      sayHold(t, 'thought.stung', null, undefined, 3);
      thinkSoon(m, 0.1);
    } else if (status === 'stun') {
      halt(t);
    }
  }

  /** Fear / rage / grudge reactions (called by GM.Contestants.damage). */
  function onDamaged(t, info) {
    if (!hasMind(t)) return;
    info = info || {};
    const m = t.mind, e = t.emotion, tr = t.traits, nowT = now();
    const cause = info.cause || '';
    const amt = Math.max(0, m.hpSeen - t.health);
    m.hpSeen = t.health;
    m.lastDmgAt = nowT;
    if (info.dot) {
      if (cause === 'burning' || cause === 'fire' || cause === 'gas' || cause === 'forcefield') {
        m.dangerScanAt = 0;
        thinkSoon(m, 0.2);
      }
      return;
    }
    const frac = amt / (t.maxHealth || 100);
    e.fear = clamp01(e.fear + frac * (1.4 - tr.bravery) * 1.2 + 0.02);
    e.confidence = clamp01(e.confidence - frac * 0.5);
    const atk = info.attacker && info.attacker.kind === 'contestant' && info.attacker !== t ? info.attacker : null;
    if (atk && atk.id < MAXN) {
      const id = atk.id;
      m.lastHitAt = nowT;
      m.lastHitBy = id;
      m.seenT[id] = nowT; m.seenX[id] = atk.pos.x; m.seenZ[id] = atk.pos.z;
      e.rage = clamp01(e.rage + (frac * 1.6 + 0.05) * m.arch.rageGain);
      if (allied(t, atk)) {
        // friendly fire (madness, blind rage or a stray arrow)
        const wild = (atk.status && atk.status.madness > 0) || atk.action === 'berserk' || atk.action === 'mad';
        m.trust[id] -= wild ? 0.25 : 0.1;
        m.grudge[id] = Math.min(1, m.grudge[id] + (wild ? 0.25 : 0.08));
        if (wild && nowT - m.lastFFLog > 30) {
          m.lastFFLog = nowT;
          mlog('alliance', 'log.alliance.friendlyFire', { name: atk.name, target: t.name }, atk, t);
        }
        if (m.grudge[id] > 0.5 && t.health > 0) {
          mlog('alliance', 'log.alliance.broken', { name: t.name, target: atk.name }, t, atk);
          leaveAlliance(t, { silent: true });
        }
      } else {
        m.grudge[id] = Math.min(1, m.grudge[id] + 0.12 + frac * 1.2);
        m.trust[id] = Math.min(m.trust[id], -0.3);
      }
      if (!m.sworn[id] && m.grudge[id] > 0.6 && t.health > 0) {
        m.sworn[id] = 1;
        if (nowT - m.lastRevengeLog > 30 && (e.rage > 0.4 || tr.aggression > 0.5)) {
          m.lastRevengeLog = nowT;
          mlog('mind', 'log.mind.revenge', { name: t.name, target: atk.name }, t, atk);
        }
      }
    } else if (cause === 'trap') {
      e.fear = clamp01(e.fear + 0.12);
      e.sanity = clamp01(e.sanity - 0.02);
    } else if (cause !== 'beast' && cause !== 'wasps') {
      m.dangerScanAt = 0;
    }
    if (t.sleeping) wake(t);
    const pid = m.plan.id;
    if (pid === 'rest' || pid === 'eat' || pid === 'idle' || pid === 'forage' || pid === 'drink' || pid === 'trap' || pid === 'heal') m.plan.done = true;
    m.nextPerceive = Math.min(m.nextPerceive, nowT + 0.05);
    thinkSoon(m, R.range(0.05, 0.25));
  }

  // ======================================================================
  // Game events
  // ======================================================================
  function onGameStart() {
    const nowT = now();
    gongAt = nowT;
    lastDeathAt = nowT;
    refreshEnv();
    refreshStats(true);
    formElitePacks();
    for (const t of GM.state.contestants) {
      if (!hasMind(t)) continue;
      const m = t.mind;
      m.bbStart = nowT;
      m.pickups = 0;
      m.hpSeen = t.health;
      const react = R.range(0.05, 0.6) + (1 - num(t.skills && t.skills.speed, 0.5)) * 0.3;
      m.nextThink = nowT + react + 0.5;
      m.execAt = nowT + react;
      m.nextPerceive = nowT + R.range(0, 0.4);
      if (m.style === 'rush') setPlan(t, 'kickoff', -1, NaN, NaN, null, 'rush', 1);
      else if (m.style === 'edge') setPlan(t, 'kickoff', -1, NaN, NaN, null, 'edge', 1);
      else setPlan(t, 'scatter', -1, NaN, NaN, null, '', 1);
      m.holdUntil = 0;
      say(t, m.style === 'scatter' ? 'thought.scatter' : 'thought.kickoff');
    }
  }

  function onDied(ev) {
    const d = ev && ev.contestant;
    if (!d || d.id == null) return;
    const nowT = now();
    lastDeathAt = nowT;
    const b = BODIES[bodyIdx];
    bodyIdx = (bodyIdx + 1) % BODIES.length;
    b.x = d.pos.x; b.z = d.pos.z; b.t = nowT; b.id = d.id; b.name = d.name;
    d.hidden = false;
    d.sneaking = false;
    // alliance bookkeeping (members before removal -> grief)
    const al = allianceOf(d);
    const mates = al ? al.members.slice() : null;
    memberDied(d);
    for (const a2 of alliances) if (a2.targetId === d.id) a2.targetId = null;
    const killer = ev.killer && ev.killer.kind === 'contestant' && ev.killer !== d ? ev.killer : null;
    if (killer) tribKills++;
    if (hasMind(killer)) {
      const km = killer.mind, ke = killer.emotion;
      km.lastKillAt = nowT;
      ke.confidence = clamp01(ke.confidence + 0.12);
      ke.rage = clamp01(ke.rage - 0.25);
      const hard = killer.archetype === 'elite' || killer.archetype === 'berserker' || killer.archetype === 'lonewolf';
      ke.sanity = clamp01(ke.sanity - (hard ? 0.01 : 0.05) * (1.3 - killer.traits.stability));
      if (km.betrayId === d.id) km.betrayUntil = 0;
    }
    const trs = GM.state.contestants;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!hasMind(t) || t === d) continue;
      const m = t.mind, e = t.emotion, tr = t.traits;
      const wasMate = !!(mates && mates.indexOf(t.id) >= 0);
      m.grudge[d.id] = 0;
      m.sworn[d.id] = 0;
      if (m.plan.targetId === d.id || m.plan.ref === d) { m.plan.done = true; thinkSoon(m, 0.3); }
      if (m.defendAttackerId === d.id) { m.defendId = -1; m.defendAttackerId = -1; }
      // the knell
      e.fear = clamp01(e.fear + 0.03 * (1.1 - tr.bravery));
      const near = m.visible[d.id] || dd(t, d) < 30;
      if (near && t !== killer) {
        e.sanity = clamp01(e.sanity - 0.04 * (1.25 - tr.stability));
        e.fear = clamp01(e.fear + 0.08 * (1 - tr.bravery));
      }
      if (wasMate) {
        e.rage = clamp01(e.rage + 0.35 * m.arch.rageGain);
        e.sanity = clamp01(e.sanity - 0.06 * (1.3 - tr.stability));
        if (killer && killer !== t && killer.id < MAXN) {
          m.grudge[killer.id] = Math.max(m.grudge[killer.id], 0.85);
          m.trust[killer.id] = -1;
          if (!m.sworn[killer.id] && killer.alive) {
            m.sworn[killer.id] = 1;
            if (nowT - m.lastRevengeLog > 30) {
              m.lastRevengeLog = nowT;
              mlog('mind', 'log.mind.revenge', { name: t.name, target: killer.name }, t, killer);
            }
          }
        }
        if (near && nowT - m.lastGriefAt > 20) {
          m.lastGriefAt = nowT;
          mlog('mind', 'log.mind.grief', { name: t.name, ally: d.name }, t, d);
        }
      }
    }
  }

  function addBlast(pos, r, seconds, type) {
    if (!pos) return;
    let slot = BLASTS[0];
    for (let i = 0; i < BLASTS.length; i++) if (BLASTS[i].until < slot.until) slot = BLASTS[i];
    slot.x = num(pos.x, 0); slot.z = num(pos.z, 0); slot.r = r; slot.until = now() + seconds; slot.type = type;
    // contestants nearby look again right away
    const trs = GM.state.contestants;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!hasMind(t)) continue;
      if (dxz(t, slot.x, slot.z) < r + 30) {
        t.mind.dangerScanAt = 0;
        t.mind.nextPerceive = Math.min(t.mind.nextPerceive, now() + 0.1);
        thinkSoon(t.mind, R.range(0.1, 0.4));
      }
    }
  }

  function onGift(ev) {
    const t = ev && ev.contestant;
    if (!hasMind(t)) return;
    const m = t.mind, nowT = now();
    t.emotion.confidence = clamp01(t.emotion.confidence + 0.08);
    t.emotion.sanity = clamp01(t.emotion.sanity + 0.05);
    sayHold(t, 'thought.gift', null, undefined, 4);
    if (nowT - m.lastGiftLog > 60) {
      m.lastGiftLog = nowT;
      mlog('mind', 'log.mind.gift', { name: t.name }, t);
    }
    m.itemScanAt = 0;
    thinkSoon(m, 0.5);
  }

  function onCombatAttack(ev) {
    if (!ev || ev.hit) return;
    const a = ev.attacker, tg = ev.target;
    if (!a || a.kind !== 'contestant' || !hasMind(tg) || tg.kind !== 'contestant' || a.id >= MAXN) return;
    const m = tg.mind, nowT = now();
    m.lastHitBy = a.id;
    m.lastHitAt = nowT;
    m.seenT[a.id] = nowT; m.seenX[a.id] = a.pos.x; m.seenZ[a.id] = a.pos.z;
    if (tg.sleeping) wake(tg);
    thinkSoon(m, R.range(0.1, 0.3));
  }

  function everyoneThinks(maxDelay) {
    for (const t of GM.state.contestants) if (hasMind(t)) { t.mind.itemScanAt = 0; thinkSoon(t.mind, R.range(0.1, maxDelay)); }
  }

  // ======================================================================
  // World snapshot, statistics, tension (pacing)
  // ======================================================================
  function refreshEnv() {
    const E = GM.Env, st = GM.state;
    let vis = 1, night = false, weather = 'clear', water = ENV.waterEv, temp = 'normal';
    let ok = false;
    if (E) {
      try {
        if (typeof E.visibility === 'function') vis = E.visibility();
        if (typeof E.isNight === 'function') { night = !!E.isNight(); ok = true; }
        if (typeof E.weather === 'string') weather = E.weather;
        if (typeof E.waterLevel === 'number') water = E.waterLevel;
        if (typeof E.temperature === 'function') temp = E.temperature();
      } catch (err) { GM.reportError('AI.env', err); }
    }
    if (!ok) {
      const tod = num(st.timeOfDay, 0.3);
      night = tod < CFG.DAWN || tod > CFG.DUSK;
      if (!E) vis = night ? 0.45 : 1;
    }
    ENV.vis = clamp(num(vis, 1), 0.15, 1);
    ENV.night = night;
    ENV.weather = weather;
    ENV.fog = weather === 'fog' || (ENV.vis < 0.4 && !night);
    ENV.cold = weather === 'snow' || (temp === 'cold' && night);
    water = num(water, CFG.BASE_WATER_LEVEL);
    ENV.rising = water - ENV.waterPrev;
    ENV.waterPrev = water;
    ENV.water = water;
    if (water > CFG.BASE_WATER_LEVEL + 0.4 && ENV.rising > 0) ENV.floodUntil = now() + 10;
  }

  /** Three or fewer left late in the Show: survivors sense each other and the hunt is on. */
  function isEndgame() {
    return aliveN <= 3 && ((GM.state.day || 1) >= 4 || tension > 1.0);
  }

  function computeTension() {
    const st = GM.state, nowT = now();
    const quiet = nowT - lastDeathAt;
    let v = (Math.max(1, st.day || 1) - 1) * 0.18 + clamp01((quiet - 90) / 360) * 0.5;
    if (totalN > 0) v += (1 - aliveN / totalN) * 0.15;
    if (aliveN <= 4) v += 0.3;
    if (aliveN <= 2) v += 0.5;
    tension = clamp(v, 0, 1.6);
    // Pacing: a Show with 24 contestants should usually end on day 3-5. When the
    // contestants kill each other much faster than this plan, they hunt less for a
    // while. Deaths caused by the arena / Showrunner do not count.
    pace = 0;
    if (totalN > 3 && gongAt > -1e8 && aliveN > 2) {
      const g = Math.max(0, nowT - gongAt) / Math.max(60, num(CFG.DAY_LENGTH, 300));
      const ahead = tribKills / totalN - expectedDead(g);
      if (g > 0.22) pace = clamp(ahead * 2.6, 0, 0.5);   // never during the kickoff
    }
  }

  // planned fraction of the field killed by other contestants after g game-days
  const PACE_G = [0, 0.2, 1, 2, 3, 4, 5];
  const PACE_F = [0, 0.3, 0.46, 0.63, 0.8, 0.93, 1];
  function expectedDead(g) {
    for (let i = 1; i < PACE_G.length; i++) {
      if (g <= PACE_G[i]) return PACE_F[i - 1] + (PACE_F[i] - PACE_F[i - 1]) * (g - PACE_G[i - 1]) / (PACE_G[i] - PACE_G[i - 1]);
    }
    return 1;
  }

  function refreshStats(force) {
    const nowT = now();
    if (!force && nowT - statAt < 0.5) return;
    statAt = nowT;
    powAt = nowT;
    const trs = GM.state.contestants;
    let n = 0;
    for (let i = 0; i < trs.length && i < MAXN; i++) {
      const t = trs[i];
      if (!t || !t.alive || !t.pos) { POW[i] = 0; COVER[i] = 0; continue; }
      n++;
      POW[i] = powerOf(t);
      COVER[i] = coverAt(t.pos.x, t.pos.z);
    }
    aliveN = n;
    if (trs.length > totalN) totalN = trs.length;
    cornStock = 0;
    const I = GM.Items, list = I && I.list;
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const it = list[k];
        if (it && !it.removed && !it.crate && it.pos && it.pos.x * it.pos.x + it.pos.z * it.pos.z < 900) cornStock++;
      }
    }
    computeTension();
  }

  /**
   * Late in the Show the contestants "feel" where the others are (the
   * Showrunners push them together): a rough last-seen hint of the nearest
   * enemy every ~25 s once day 4 begins or 4 or fewer are left.
   */
  function senseEnemies() {
    const nowT = now();
    if (nowT - senseAt < 25) return;
    senseAt = nowT;
    if (!(aliveN <= 4 || (GM.state.day || 1) >= 4 || tension > 1.0)) return;
    const trs = GM.state.contestants;
    for (const t of trs) {
      if (!hasMind(t)) continue;
      let best = null, bd = 1e9;
      for (const o of trs) {
        if (!o || o === t || !o.alive || allied(t, o) || o.id >= MAXN) continue;
        const d = dd(t, o);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) continue;
      const m = t.mind;
      if (nowT - m.seenT[best.id] < 20) continue;
      m.seenT[best.id] = nowT - 10;
      m.seenX[best.id] = best.pos.x + R.range(-12, 12);
      m.seenZ[best.id] = best.pos.z + R.range(-12, 12);
    }
  }

  // ======================================================================
  // Decisions (utility scores)
  // ======================================================================
  const BEST = { id: 'idle', score: -1e9, ref: null, flavor: '', x: NaN, z: NaN };
  let CUR = null;       // contestant being decided
  let ERR = 0;          // erratic noise (low sanity)
  const PREY = { id: -1, v: 0, d: 0 };

  /** Offer a candidate action. ref: contestant / beast / item or null. */
  function cand(id, score, ref, flavor, x, z) {
    if (!(score > -50)) return;
    const p = CUR.mind.plan;
    if (!p.done && p.id === id && p.ref === (ref || null)) score += p.until > now() ? 0.2 : 0.05;
    if (ERR > 0) score += (R.random() * 2 - 1) * ERR;
    if (score <= BEST.score) return;
    BEST.id = id; BEST.score = score; BEST.ref = ref || null; BEST.flavor = flavor || '';
    BEST.x = x === undefined ? NaN : x;
    BEST.z = z === undefined ? NaN : z;
  }

  /** Is o's position known right now? Writes it to TX/TZ. */
  let TX = 0, TZ = 0;
  function whereIs(t, o) {
    const m = t.mind;
    if (m.visible[o.id] || revealOn || aliveN <= 2 || isEndgame() || dd(t, o) < 5) { TX = o.pos.x; TZ = o.pos.z; return true; }
    TX = m.seenX[o.id]; TZ = m.seenZ[o.id];
    return false;
  }

  /** Best contestant to hunt from memory -> PREY. */
  function pickPrey(t, myP) {
    const m = t.mind, trs = GM.state.contestants, nowT = now();
    const know = revealOn || aliveN <= 2 || isEndgame();
    const firstDay = (GM.state.day || 1) <= 1 && aliveN > 4;
    const maxAge = firstDay ? 40 : 90, maxD = firstDay ? 90 : 170;
    let best = -1, bv = -1e9, bd = 0;
    for (let i = 0; i < trs.length && i < MAXN; i++) {
      const o = trs[i];
      if (!o || o === t || !o.alive || !o.pos || allied(t, o)) continue;
      if (m.giveUp[i] > nowT || m.spareUntil[i] > nowT) continue;
      const age = know ? 0 : nowT - m.seenT[i];
      if (age > maxAge) continue;
      const x = m.visible[i] || know ? o.pos.x : m.seenX[i];
      const z = m.visible[i] || know ? o.pos.z : m.seenZ[i];
      const d = dxz(t, x, z);
      if (d > maxD) continue;
      const ratio = clamp(myP / Math.max(0.05, POW[i]), 0, 2);
      let v = ratio * 0.35 + m.grudge[i] * 0.8 - Math.max(0, m.trust[i]) * 0.5 - d / 130 - age / 150;
      if (o.sleeping && m.visible[i]) v += 0.35;
      v += (1 - hpFrac(o)) * (0.2 + m.arch.finish * 0.5);
      if (o.allianceId == null) v += 0.08;
      if (i === m.betrayId && m.betrayUntil > nowT) v += 1.2;
      if (m.arch.id === 'elite' && o.archetype !== 'elite') v += 0.05;
      if (v > bv) { bv = v; best = i; bd = d; }
    }
    PREY.id = best; PREY.v = bv; PREY.d = bd;
  }

  function dangerFlavor(type) {
    switch (type) {
      case 'fire': case 'burning': return 'fire';
      case 'gas': case 'poison': case 'madness': return 'gas';
      case 'explosion': case 'fireball': case 'meteor': return 'blast';
      case 'quake': case 'earthquake': return 'quake';
      case 'lightning': return 'lightning';
      default: return 'danger';
    }
  }

  /** Choose what to do next (runs every ~0.3-0.6 sim s per contestant). */
  function think(t) {
    const m = t.mind, e = t.emotion, tr = t.traits, a = m.arch, nowT = now();
    const st = statusOf(t), inv = invOf(t), hp = hpFrac(t), p = m.plan;
    if (st.madness > 0) { setPlan(t, 'mad', -1, NaN, NaN, null, '', 5); return; }
    if (st.panic > 0) { setPlan(t, 'panic', -1, NaN, NaN, null, '', 5); return; }
    if (st.stun > 0 && !p.done) return;
    CUR = t;
    ERR = e.sanity < 0.5 ? (0.5 - e.sanity) * 0.8 : 0;
    BEST.id = 'idle'; BEST.score = -1e9; BEST.ref = null; BEST.flavor = ''; BEST.x = NaN; BEST.z = NaN;
    const hunger = (t.hunger || 0) / 100, thirst = (t.thirst || 0) / 100;
    const energy = num(t.energy, 100) / 100, stamina = num(t.stamina, 100);
    const needs = Math.max(hunger, thirst);
    const al = allianceOf(t);
    const leader = al ? trib(al.leaderId) : null;
    const myP = Math.max(0.05, POW[t.id] || powerOf(t));
    const since = nowT - gongAt;
    const day = GM.state.day || 1;
    const final = aliveN <= 2;
    // Last three from day 4 on: the Studio wants a finale, so fear fades and hunting takes over.
    const endgame = !final && isEndgame();
    let threat = m.threatId >= 0 ? trib(m.threatId) : null;
    if (threat && !threat.alive) threat = null;
    const threatNear = !!threat && m.threatD < 40 && m.threatLevel > 0.25;
    const late = day >= 3 || aliveN <= 4 || tension > 0.7;

    // ---------------------------------------------------------- emergencies
    if (m.zoneOut > 0) cand('escape_zone', 3 + Math.min(1, m.zoneOut * 0.05), null, 'out');
    else if (m.zoneEarly) cand('escape_zone', 1.05 + e.fear * 0.3, null, 'early');
    if (m.flood) cand('avoid', 2.2, null, 'flood');
    if (m.dangerNear) cand('avoid', 1.2 + m.dangerLvl * 1.8, null, dangerFlavor(m.dangerType));
    if (m.inWaterBad) cand('avoid', 1.3, null, 'water');
    const mu = m.beastRef;
    if (mu && mu.alive) {
      if (mu.type === 'wasps') {
        if (m.beastD < 30) cand('flee', 2.4, mu, 'wasps');
      } else if (m.beastD < 35) {
        const wq = weaponQuality(t);
        const fightS = 0.4 + e.confidence * 0.5 + tr.bravery * 0.4 + wq * 0.6 - m.beastCount * 0.2 - e.fear * 0.6 +
          (m.beastD < 3 ? 0.4 : 0) + (hp > 0.6 ? 0.1 : -0.3);
        const fleeS = 0.6 + e.fear * 0.8 + m.beastCount * 0.15 + (m.beastD < 12 ? 0.3 : 0);
        if (fightS > fleeS) cand('fight', 1.3 + fightS * 0.4, mu, 'wolf');
        else cand('flee', 1.3 + fleeS * 0.4, mu, 'wolves');
      }
    }

    // ---------------------------------------------------------- the final duel
    if (final) {
      let other = null;
      for (const o of GM.state.contestants) if (o && o !== t && o.alive) { other = o; break; }
      if (other) {
        if (!finalLogged) {
          finalLogged = true;
          interest(t, 12, 20, 'final', { key: 'log.mind.i.final', params: { a: t.name, b: other.name } }, 'finale');
        }
        cand(dd(t, other) < 6 ? 'fight' : 'hunt', 2.3, other, 'final');
      }
    }

    // ---------------------------------------------------------- kickoff
    if (p.id === 'kickoff' && !p.done && since < 50) cand('kickoff', 1.25, null, p.flavor);
    if (p.id === 'scatter' && !p.done) cand('scatter', 1.0 + e.fear * 0.2, null, '');
    if (since < 90 && m.style !== 'rush' && p.id !== 'kickoff' && t.pos.x * t.pos.x + t.pos.z * t.pos.z < 45 * 45 &&
        a.id !== 'elite' && a.id !== 'berserker') {
      cand('scatter', 0.65 + e.fear * 0.4 + (1 - tr.aggression) * 0.2, null, '');
    }

    // ---------------------------------------------------------- fear
    const seenThreat = threat && m.visible[threat.id];
    let fearDrive = e.fear * 1.3 + m.threatLevel * 0.35 + (hp < 0.35 ? 0.45 : 0) - e.rage * 0.5 - e.confidence * 0.3 - tr.bravery * 0.2;
    // late in the Show running away stops working: the last few face each other
    const lateNerve = Math.max(0, tension - 0.55) * 0.6 + (aliveN <= 4 ? 0.15 : 0);
    if (seenThreat && m.threatD < 30) fearDrive += a.fleeOnSight * (aliveN <= 4 ? 0.4 : 0.8);
    fearDrive -= lateNerve;
    // a Berserker only runs when nearly dead
    if (a.id === 'berserker') fearDrive -= hp > 0.25 ? 0.4 : 0.1;
    if (final) fearDrive -= 1;
    else if (endgame) fearDrive -= 0.55;
    if (threat && m.threatD < 45 && !allied(t, threat)) {
      const flav = hp < 0.35 ? 'hurt' : seenThreat && a.fleeOnSight > 0.3 && m.threatD > 12 ? 'sight' : '';
      cand('flee', fearDrive + 0.2, threat, flav);
    }
    if (m.avoidUntil > nowT && m.avoidId >= 0 && m.visible[m.avoidId]) {
      const o = trib(m.avoidId);
      if (o && o.alive && dd(t, o) < 20) cand('flee', 0.6, o, '');
    }
    if (!threatNear && m.heardKind === 'fight' && nowT - m.heardT < 6 && dxz(t, m.heardX, m.heardZ) < 30 && a.stalk < 0.2 && a.finish < 0.3) {
      cand('flee', e.fear * 0.9 + a.fleeOnSight * 0.3 - tr.aggression * 0.3, null, 'noise');
    }

    // ---------------------------------------------------------- fighting
    if (m.lastHitBy >= 0 && nowT - m.lastHitAt < 5) {
      const atk = trib(m.lastHitBy);
      if (atk && atk.alive && dd(t, atk) < 15) {
        const ratio = clamp(myP / Math.max(0.05, POW[atk.id]), 0.2, 2.5);
        const cornered = m.cornered > nowT;
        const s = 0.55 + e.rage * 0.9 + e.confidence * 0.5 + tr.aggression * 0.3 + tr.bravery * 0.2 - e.fear * 1.0 +
          (ratio - 1) * 0.3 + (cornered ? 0.8 : 0) + (final ? 1 : 0);
        cand('fight', s, atk, cornered ? 'cornered' : 'back');
      }
    }
    if (m.defendId >= 0 && m.defendAttackerId >= 0) {
      const atk = trib(m.defendAttackerId);
      if (atk && atk.alive && !allied(t, atk) && dd(t, atk) < 35) {
        cand('fight', 0.5 + a.defend + tr.loyalty * 0.4 + tr.bravery * 0.2 - e.fear * 0.6, atk, 'defend');
      }
    }
    // blind rage
    if ((a.id === 'berserker' || tr.stability < 0.3) && e.rage > 0.6 && m.nearEnemyId >= 0 && m.nearEnemyD < 35) {
      let tg = trib(m.nearEnemyId);
      if (e.rage > 0.9 && al && R.chance(0.12)) {
        for (const id of al.members) { const o = trib(id); if (o && o !== t && o.alive && m.visible[id] && dd(t, o) < 12) { tg = o; break; } }
      }
      if (tg && tg.alive) cand('berserk', 1.4 + e.rage * 0.5, tg, '');
    }

    // ---------------------------------------------------------- hunting
    pickPrey(t, myP);
    const bbFrenzy = since < 90 && tr.aggression > 0.6 && hasWeapon(t) && t.pos.x * t.pos.x + t.pos.z * t.pos.z < 40 * 40 ? 0.35 : 0;
    // After the kickoff the first days are about survival: hunting ramps up with tension.
    // `pace` adds more calm when the contestants are killing each other faster than planned.
    const early = final ? 0 : (day <= 1 && since > 60 ? 0.32 : day === 2 ? 0.16 : 0) + pace;
    const huntUrge = tr.aggression * 0.75 + a.hunt + e.rage * 0.55 + e.confidence * 0.35 + tension * 0.4 + bbFrenzy +
      (ENV.night ? a.night : 0) - e.fear * 0.9 - needs * 0.35 - (hp < 0.5 ? 0.5 - hp : 0) + (hasWeapon(t) ? 0.1 : -0.3) - 0.35 - early + (endgame ? 0.5 : 0);
    if (PREY.id >= 0 && !final) {
      const o = trib(PREY.id);
      const vis = m.visible[PREY.id];
      let flav = 'track';
      if (m.betrayId === PREY.id && m.betrayUntil > nowT) flav = 'betray';
      else if (m.sworn[PREY.id] && m.grudge[PREY.id] > 0.45) flav = 'revenge';
      else if (o.sleeping && vis) flav = 'sleeper';
      else if (hpFrac(o) < 0.35 && vis) flav = 'finish';
      else if (al && leader === t && al.members.length >= 2) flav = 'pack';
      else if (revealOn && !vis) flav = 'reveal';
      else if (ENV.night && a.night > 0) flav = 'night';
      else if (vis) flav = '';
      const s = huntUrge + PREY.v * 0.5 + (flav === 'betray' ? 1 : 0);
      if (vis && PREY.d < 6) cand('fight', s + 0.1, o, flav === 'track' ? '' : flav);
      else cand('hunt', s, o, flav);
      // stalkers follow stronger prey quietly and wait for a chance
      if (a.stalk > 0 && vis && PREY.d < 60 && flav !== 'finish' && flav !== 'sleeper') {
        const ss = a.stalk + tr.patience * 0.3 + tr.cunning * 0.2 + tension * 0.2 - e.fear * 0.5 - needs * 0.3 - 0.3 + PREY.v * 0.3;
        cand('stalk', ss, o, o.allianceId == null ? 'lone' : '');
      }
    }
    // the pack hunts the leader's target
    if (al && leader && leader !== t && al.targetId != null) {
      const tg = trib(al.targetId);
      if (tg && tg.alive && !allied(t, tg) && dd(t, tg) < 90) {
        cand('hunt', 0.6 + tr.loyalty * 0.2 + tr.aggression * 0.3 - e.fear * 0.5 + tension * 0.2 - early, tg, 'pack');
      }
    }

    // ---------------------------------------------------------- alliance life
    if (al && leader && leader !== t && leader.alive) {
      const d = dd(t, leader);
      if (d > 12) cand('follow', 0.55 + tr.loyalty * 0.3 + (d > 40 ? 0.2 : 0) - needs * 0.3, leader, '');
      else cand('follow', 0.2 + tr.loyalty * 0.1, leader, 'close');
    }
    if (m.allyCandId >= 0 && m.allyCandScore > 0.4 && aliveN > 6) {
      const o = trib(m.allyCandId);
      if (o && o.alive) cand('ally', m.allyCandScore * 0.8 + (m.alliesNear === 0 ? 0.1 : 0) - e.fear * 0.2, o, '');
    }
    if (al && al.watchId === t.id && ENV.night) {
      cand('guard', 0.95, null, 'watch');
    } else if (a.id === 'elite' && day <= 1 && cornStock >= 3 && since > 40 && dxz(t, 0, 0) < 70) {
      cand('guard', 0.45 + tr.greed * 0.2 + (leader === t ? 0.1 : 0), null, '');
    }

    // ---------------------------------------------------------- needs
    if (inv.water > 0 && thirst > 0.4) cand('drink', 0.45 + thirst * 1.2, null, 'bottle');
    else if (thirst > 0.25) cand('drink', Math.pow(thirst, 1.5) * 1.6 + (thirst > 0.8 ? 0.5 : 0) - (threatNear ? 0.4 : 0), null, '');
    if ((inv.food > 0 || inv.berries > 0) && hunger > 0.4) {
      cand('eat', Math.pow(hunger, 1.5) * 1.4 + 0.2 - (threatNear ? 0.5 : 0), null, inv.food > 0 ? 'food' : 'berries');
    } else if (hunger > 0.3) {
      cand('forage', Math.pow(hunger, 1.5) * 1.3 + a.forage - 0.1 - (threatNear ? 0.5 : 0) - Math.min(0.3, m.forageFail * 0.1) + (hunger > 0.85 ? 0.3 : 0), null, '');
    }
    if (inv.medkit > 0 && (hp < 0.65 || st.bleeding > 0 || st.poison > 0)) {
      cand('heal', (1 - hp) * 1.8 + (st.bleeding > 0 ? 0.4 : 0) + (st.poison > 0 ? 0.5 : 0) - (threatNear && m.threatD < 15 ? 0.6 : 0), null, '');
    }
    if (stamina < 20 && !threatNear) cand('rest', 0.45 + (20 - stamina) / 40, null, '');
    {
      let s = Math.pow(1 - energy, 1.4) * 1.5 + (ENV.night ? 0.35 : -0.25) - e.fear * 0.6 - (threatNear ? 0.8 : 0) -
        (m.dangerNear ? 1 : 0) + (m.cold && ENV.night ? 0.15 : 0) + (al && al.watchId != null && al.watchId !== t.id ? 0.15 : 0);
      if (al && al.watchId === t.id) s -= 0.6;
      if (energy < 0.08) s += 0.6;
      if (t.sleeping && energy < 0.97 && (ENV.night || energy < 0.75)) s += 0.3;
      cand('sleep', s, null, m.cold ? 'cold' : '');
    }

    // ---------------------------------------------------------- items
    if (m.itemRef && !m.itemRef.removed) {
      cand('loot', m.itemScore * (1 + tr.greed * 0.6 + a.loot) - e.fear * 0.15 - (threatNear ? 0.3 : 0), m.itemRef, m.itemBody >= 0 ? 'body' : '');
    }
    if (m.crateRef && !m.crateRef.removed) {
      const mine = m.crateRef.claimedBy === t.id;
      cand('loot', m.crateScore * (0.9 + tr.greed * 0.8 + a.loot) - e.fear * 0.25 + (mine ? 0.35 : 0) - (threatNear ? 0.3 : 0), m.crateRef, 'crate');
    }
    if (m.sleeperId >= 0 && a.steal > 0) {
      const o = trib(m.sleeperId);
      if (o && o.alive && o.sleeping && !allied(t, o)) {
        const iv = invOf(o);
        const rich = (iv.food > 0 || iv.water > 0 || iv.medkit > 0 || !!iv.ranged || !!iv.melee) ? 0.1 : -0.5;
        cand('steal', a.steal + tr.greed * 0.3 - e.fear * 0.3 - 0.1 + rich, o, '');
      }
    }
    const f = GM.state.feast;
    if (f && !f.over && typeof f.x === 'number' && (f.ready || num(f.at, 0) - nowT < 40)) {
      const df = dxz(t, f.x, f.z);
      const s = 0.3 + tr.greed * 0.4 + a.loot + needs * 0.5 + tr.bravery * 0.2 + (1 - hp) * 0.3 * (inv.medkit > 0 ? 0 : 1) -
        e.fear * 0.4 + tension * 0.2 - df / 400 + (a.id === 'elite' || a.id === 'berserker' ? 0.3 : 0) + (a.id === 'survivor' ? -0.15 : 0);
      cand('feast', s, null, f.ready ? '' : 'wait');
    }

    // ---------------------------------------------------------- cunning
    if (inv.traps > 0 && nowT - m.lastTrapAt > 50 && !threatNear) {
      const water = knowWater(t) && dxz(t, m.waterX, m.waterZ) < 60;
      cand('trap', 0.3 + a.trap + tr.cunning * 0.25 - (ENV.night ? 0.1 : 0) - needs * 0.3, null, water ? 'water' : '');
    }
    if ((a.ambush > 0 || (ENV.fog && tr.cunning > 0.6)) && m.ambushCool <= nowT && !threatNear) {
      const flav = m.hasTrapSpot ? 'trap' : ENV.fog ? 'fog' : 'water';
      cand('ambush', a.ambush + tr.patience * 0.25 + (ENV.fog ? 0.3 : 0) + tension * 0.1 - needs * 0.5 - 0.05, null, flav);
    }
    {
      let s = e.fear * 0.9 + a.hide + (hp < 0.5 ? 0.25 : 0) - tr.aggression * 0.35 - 0.1 + (ENV.night ? 0.05 : 0) -
        (nowT - m.lastHideEnd < 20 ? 0.3 : 0) - needs * 0.3;
      if (revealOn) s += 0.35 * (1 - tr.aggression);
      s -= lateNerve * 0.7;
      if (final) s -= 1;
      else if (endgame) s -= 0.5;
      cand('hide', s, null, revealOn ? 'reveal' : '');
    }
    if (nowT - m.heardT < 15 && m.heardSrc !== t.id) {
      const hd = dxz(t, m.heardX, m.heardZ);
      if (hd > 6) {
        const k = m.heardKind;
        let s;
        if (k === 'lure') s = 0.35 + (1 - e.fear) * 0.35 + tr.greed * 0.2 + tension * 0.15 - hd / 300;
        else if (k === 'fight') s = 0.15 + tr.aggression * 0.35 + a.finish * 0.6 + a.stalk * 0.3 - e.fear * 0.6 + tension * 0.2;
        else if (k === 'explosion') s = 0.1 + (1 - e.fear) * 0.3 + tr.greed * 0.1;
        else if (k === 'scream') s = 0.15 + tr.aggression * 0.3 + a.finish * 0.4 - e.fear * 0.3;
        else s = 0.15 + (1 - e.fear) * 0.2;
        if (k === 'fight' && a.stalk > 0.2) cand('stalk', s + 0.05, null, 'fight', m.heardX, m.heardZ);
        else cand('investigate', s - needs * 0.2, null, k, m.heardX, m.heardZ);
      }
    }

    // ---------------------------------------------------------- default
    const noWater = thirst > 0.45 && !knowWater(t) && !(inv.water > 0);
    if (late) {
      if (PREY.id >= 0 && tr.aggression > 0.4 && !m.visible[PREY.id]) {
        const o = trib(PREY.id);
        whereIs(t, o);
        cand('wander', 0.35 + tension * 0.25, o, 'search', TX, TZ);
      } else {
        cand('wander', 0.3 + tension * 0.2, null, 'drift');
      }
    }
    cand('wander', 0.22 + (noWater ? 0.35 : 0), null, noWater ? 'explore' : '');
    cand('idle', 0.12 + (m.coverHere > 0.4 ? 0.05 : 0), null, '');

    // ---------------------------------------------------------- commit
    CUR = null;
    const ref = BEST.ref;
    const tid = ref && ref.kind === 'contestant' ? ref.id : -1;
    const wasId = p.id, wasRef = p.ref, wasDone = p.done;
    setPlan(t, BEST.id, tid, BEST.x, BEST.z, ref, BEST.flavor, BEST.score);
    if (wasDone || wasId !== p.id || wasRef !== p.ref) m.execAt = 0;
  }

  // ======================================================================
  // Action execution (every ~0.1 sim s per contestant)
  // ======================================================================
  function tryPickup(t, it) {
    if (!it || it.removed || it.falling || !it.pos) return false;
    if (!arrivedAt(t, it.pos.x, it.pos.z, it.crate ? 2.1 : 1.5)) return false;
    if (!iCall('pickup', t, it)) return false;
    t.mind.pickups++;
    t.mind.itemScanAt = 0;
    return true;
  }
  function markBad(m, it) {
    m.badItem = it;
    m.badItemUntil = now() + 25;
    m.itemScanAt = 0;
  }
  /** Look around: turn to a random direction every few seconds. */
  function lookAround(t, p, nowT) {
    if (nowT < p.timer) return;
    p.timer = nowT + R.range(2.5, 5);
    const an = R.angle();
    tCall('faceToward', t, t.pos.x + Math.sin(an) * 5, t.pos.z + Math.cos(an) * 5);
  }
  /** Nearest visible contestant (allies too) within maxD. */
  function nearestVisible(t, maxD) {
    const m = t.mind, trs = GM.state.contestants;
    let best = null, bd = maxD;
    for (let i = 0; i < trs.length && i < MAXN; i++) {
      const o = trs[i];
      if (!o || o === t || !o.alive || !m.visible[i]) continue;
      const d = dd(t, o);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  /** Closest dry land around a swimming contestant -> P. */
  function findShore(t) {
    for (let r = 5; r <= 30; r += 6) {
      let best = -1e9;
      for (let k = 0; k < 8; k++) {
        const an = k * TAU / 8;
        const x = t.pos.x + Math.sin(an) * r, z = t.pos.z + Math.cos(an) * r;
        if (isWater(x, z) || !inArena(x, z, 8)) continue;
        const s = -dangerAt(x, z) * 3 + R.range(0, 0.2);
        if (s > best) { best = s; P.x = x; P.z = z; }
      }
      if (best > -1e9) return P;
    }
    P.x = t.pos.x * 0.9; P.z = t.pos.z * 0.9;
    return P;
  }
  /** Attack when possible, otherwise close in. Works for contestants and beasts. */
  function engage(t, o, far) {
    const d = dd(t, o);
    const opt = canHit(t, o);
    if (opt) {
      if (opt.mode === 'ranged' || d <= num(opt.range, 1.8) * 0.9) halt(t);
      else chase(t, o.pos.x, o.pos.z, 'run');
      return attack(t, o);
    }
    chase(t, o.pos.x, o.pos.z, far || d < 10 ? 'sprint' : 'run');
    return 'range';
  }
  function fightThought(t, p, o) {
    const m = t.mind;
    switch (p.flavor) {
      case 'defend': { const al = trib(p.aux >= 0 ? p.aux : m.defendId); say(t, 'thought.defend', 'ally', al ? al.name : o.name); return; }
      case 'cornered': say(t, 'thought.fightCornered', 'target', o.name); return;
      case 'back': say(t, 'thought.fightBack', 'target', o.name); return;
      case 'final': say(t, 'thought.finalFight', 'target', o.name); return;
      case 'ambush': say(t, 'thought.ambushStrike', 'target', o.name); return;
      case 'betray': say(t, 'thought.betray', 'target', o.name); return;
      case 'finish': say(t, 'thought.finish', 'target', o.name); return;
      case 'revenge': say(t, 'thought.huntRevenge', 'target', o.name); return;
      default: say(t, 'thought.fight', 'target', o.name);
    }
  }
  function huntThought(t, p, o, known) {
    switch (p.flavor) {
      case 'revenge': say(t, 'thought.huntRevenge', 'target', o.name); return;
      case 'pack': say(t, 'thought.huntPack', 'target', o.name); return;
      case 'night': say(t, 'thought.huntNight', 'target', o.name); return;
      case 'reveal': say(t, 'thought.huntReveal', 'target', o.name); return;
      case 'sleeper': say(t, 'thought.huntSleeper', 'target', o.name); return;
      case 'finish': say(t, 'thought.finish', 'target', o.name); return;
      case 'final': say(t, 'thought.finalFight', 'target', o.name); return;
      case 'betray': say(t, 'thought.betray', 'target', o.name); return;
      default: say(t, known ? 'thought.hunt' : 'thought.huntTrack', 'target', o.name);
    }
  }

  function exKickoff(t, m, p, nowT) {
    const el = nowT - m.bbStart;
    const edge = p.flavor === 'edge';
    const cap = edge ? 1 : (m.arch.id === 'elite' ? 3 : 2);
    if (m.pickups >= cap || el > 45 || hpFrac(t) < 0.45 || (edge && el > 12)) {
      p.done = true;
      if (edge || (m.arch.id !== 'elite' && m.arch.id !== 'berserker')) { setPlan(t, 'scatter', -1, NaN, NaN, null, '', 1); m.execAt = 0; }
      return;
    }
    const tr = t.traits;
    if (tr.aggression > 0.5 && m.nearEnemyId >= 0 && m.nearEnemyD < (edge ? 3 : 4.5) && (hasWeapon(t) || tr.aggression > 0.8)) {
      const o = trib(m.nearEnemyId);
      if (o && o.alive) { setPlan(t, 'fight', o.id, NaN, NaN, o, '', 1.3); m.execAt = 0; return; }
    }
    const it = m.itemRef;
    if (it && !it.removed && !it.falling && !it.crate && dxz(t, it.pos.x, it.pos.z) < (edge ? 22 : 45)) {
      if (tryPickup(t, it)) return;
      go(t, it.pos.x, it.pos.z, 'sprint', 0.5);
      say(t, 'thought.grab', 'item', itemName(it.type));
      return;
    }
    if (arrivedAt(t, p.x, p.z, 2)) chooseSpot(t, p);
    go(t, p.x, p.z, 'sprint', 1);
    say(t, 'thought.kickoff');
  }

  function exScatter(t, m, p, nowT) {
    const it = m.itemRef;
    if (it && !it.removed && !it.falling && it.pos && dxz(t, it.pos.x, it.pos.z) < 1.6) tryPickup(t, it);
    go(t, p.x, p.z, nowT - p.since < 12 ? 'sprint' : 'run', 2);
    say(t, 'thought.scatter');
    if (arrivedAt(t, p.x, p.z, 4) || nowT > p.until) p.done = true;
  }

  function exLoot(t, m, p, nowT) {
    const it = p.ref;
    if (!it || it.removed || !it.pos || (it.claimedBy != null && it.claimedBy !== t.id)) { p.done = true; return; }
    const d = dxz(t, it.pos.x, it.pos.z);
    if (it.falling) {
      if (d > 6) go(t, it.pos.x, it.pos.z, 'run', 2); else halt(t);
      say(t, 'thought.crateWait');
      if (nowT > p.until) p.done = true;
      return;
    }
    if (tryPickup(t, it)) { p.done = true; return; }
    go(t, it.pos.x, it.pos.z, d > 8 && (m.visCount > 0 || it.crate) ? 'run' : 'walk', 0.4);
    if (p.flavor === 'crate') say(t, 'thought.crate');
    else if (p.flavor === 'body') { const b = trib(m.itemBody); if (b) say(t, 'thought.lootBody', 'name', b.name); else say(t, 'thought.loot', 'item', itemName(it.type)); }
    else say(t, 'thought.loot', 'item', itemName(it.type));
    if (nowT > p.until || (d < 3 && nowT - p.since > 20)) { markBad(m, it); p.done = true; }
  }

  function exFlee(t, m, p, nowT) {
    const ref = p.ref;
    let sx, sz;
    if (ref) {
      if (!ref.alive || !ref.pos) { p.done = true; return; }
      sx = ref.pos.x; sz = ref.pos.z;
    } else if (p.flavor === 'noise') { sx = m.heardX; sz = m.heardZ; }
    else { sx = p.ex; sz = p.ez; }
    const d = dxz(t, sx, sz);
    if (p.flavor === 'wasps') {
      if (nowT >= p.timer) {
        p.timer = nowT + 2;
        const L = nearestLake(t, 70);
        if (L) { p.x = L.x; p.z = L.z; p.n = 1; } else { pickEscape(t, sx, sz, 30, true, false); p.x = P.x; p.z = P.z; p.n = 0; }
      }
      go(t, p.x, p.z, 'sprint', 2);
      say(t, p.n ? 'thought.fleeWasps' : 'thought.fleeWaspsDry');
      if (d > 40 || nowT > p.until) p.done = true;
      return;
    }
    if (nowT >= p.timer) {
      p.timer = nowT + 1.5;
      pickEscape(t, sx, sz, 28, false, !!ref && ref.kind === 'contestant');
      p.x = P.x; p.z = P.z;
    }
    go(t, p.x, p.z, d < 14 ? 'sprint' : 'run', 3);
    if (ref && ref.kind === 'contestant') {
      if (d < 2.6 && nowT - p.since > 3 && hpFrac(t) > 0.12) {
        m.cornered = nowT + 8;
        setPlan(t, 'fight', ref.id, NaN, NaN, ref, 'cornered', 2);
        m.execAt = 0;
        return;
      }
      const fl = p.flavor;
      say(t, fl === 'hurt' ? 'thought.fleeHurt' : fl === 'sight' ? 'thought.fleeSight' : 'thought.flee', 'target', ref.name);
      if ((d > 45 && !m.visible[ref.id]) || nowT > p.until) p.done = true;
    } else if (ref) {
      say(t, 'thought.fleeWolves');
      if (d > 40 || nowT > p.until) p.done = true;
    } else {
      say(t, 'thought.fleeNoise');
      if (d > 45 || nowT > p.until) p.done = true;
    }
  }

  function exHide(t, m, p, nowT) {
    if (p.stage === 0) {
      if (arrivedAt(t, p.x, p.z, 2) || nowT - p.since > 40) { p.stage = 1; halt(t); }
      else go(t, p.x, p.z, m.threatD < 30 ? 'run' : m.visCount > 0 ? 'sneak' : 'walk', 1);
    } else {
      if (m.moving) halt(t);
      t.hidden = true;
      lookAround(t, p, nowT);
    }
    if (p.flavor === 'reveal') say(t, 'thought.revealHide');
    else if (p.stage === 1 && t.emotion.sanity < 0.42 && m.alliesNear === 0) say(t, 'thought.lonely');
    else if (p.stage === 1 && nowT - p.since > 15) say(t, 'thought.hideQuiet');
    else say(t, p.stage === 1 && m.coverHere < 0.3 ? 'thought.hideRocks' : 'thought.hide');
    if (nowT > p.until) p.done = true;
  }

  function exHunt(t, m, p, nowT) {
    const o = p.ref;
    if (!o || !o.alive || o.kind !== 'contestant' || (allied(t, o) && p.flavor !== 'final')) { p.done = true; return; }
    const known = whereIs(t, o);
    const d = dxz(t, TX, TZ);
    if (known) {
      const om = o.mind;
      const unaware = o.sleeping || !(om && om.visible && om.visible[t.id]);
      if (!canHit(t, o) && unaware && d < 22 && d > 4 && (t.traits.cunning > 0.5 || o.sleeping)) {
        chase(t, o.pos.x, o.pos.z, 'sneak');
      } else {
        engage(t, o, false);
      }
      if (d < 5 && !o.sleeping && p.flavor !== 'sleeper') {
        setPlan(t, 'fight', o.id, NaN, NaN, o, p.flavor === 'track' || p.flavor === 'pack' || p.flavor === 'night' || p.flavor === 'reveal' ? '' : p.flavor, p.score);
        m.execAt = 0;
        return;
      }
    } else {
      go(t, TX, TZ, 'run', 2);
      if (d < 4) { m.giveUp[o.id] = nowT + 45; p.done = true; }
    }
    huntThought(t, p, o, known);
    if (nowT > p.until) { m.giveUp[o.id] = nowT + 30; p.done = true; }
  }

  function exFight(t, m, p, nowT) {
    const o = p.ref;
    if (!o || !o.alive || !o.pos) { p.done = true; return; }
    const isT = o.kind === 'contestant';
    if (isT && allied(t, o) && p.flavor !== 'final') { p.done = true; return; }
    const d = dd(t, o);
    if (isT) {
      if (d > 35 || (!m.visible[o.id] && d > 14 && !revealOn && aliveN > 2)) { p.done = true; return; }
      // a Protector may let a badly hurt, fleeing enemy go
      const a = m.arch;
      if (a.spare > 0 && hpFrac(o) < 0.3 && (o.action === 'flee' || o.action === 'panic') && m.grudge[o.id] < 0.5 && aliveN > 3 && o.id < MAXN) {
        if (m.spareRoll[o.id] === 0) m.spareRoll[o.id] = R.random() < a.spare ? 1 : -1;
        if (m.spareRoll[o.id] > 0) {
          m.spareUntil[o.id] = nowT + 150;
          halt(t);
          sayHold(t, 'thought.spare', 'target', o.name, 4);
          mlog('mind', 'log.mind.spare', { name: t.name, target: o.name }, t, o);
          p.done = true;
          return;
        }
      }
    }
    engage(t, o, false);
    if (isT) fightThought(t, p, o);
    else say(t, 'thought.fightWolf');
    if (nowT > p.until) p.done = true;
  }

  function exStalk(t, m, p, nowT) {
    const o = p.ref;
    if (!o) {
      // watch a fight from a distance, then finish the loser
      const d = dxz(t, p.x, p.z);
      if (d > 22) go(t, p.x, p.z, d > 45 ? 'run' : 'sneak', 3);
      else { if (m.moving) halt(t); t.sneaking = true; tCall('faceToward', t, p.x, p.z); }
      say(t, 'thought.stalkFight');
      if (m.nearEnemyId >= 0 && m.nearEnemyD < 30) {
        const w = trib(m.nearEnemyId);
        if (w && w.alive && hpFrac(w) < 0.45) { setPlan(t, 'hunt', w.id, NaN, NaN, w, 'finish', 1.2); m.execAt = 0; return; }
      }
      if (nowT - m.heardT > 20 || nowT > p.until) p.done = true;
      return;
    }
    if (!o.alive || o.kind !== 'contestant' || allied(t, o)) { p.done = true; return; }
    const known = whereIs(t, o);
    const d = dxz(t, TX, TZ);
    if (known && (o.sleeping || hpFrac(o) < 0.45 || (o.action === 'fight' && o.targetId !== t.id && hpFrac(o) < 0.65))) {
      setPlan(t, 'hunt', o.id, NaN, NaN, o, o.sleeping ? 'sleeper' : 'finish', 1.2);
      m.execAt = 0;
      return;
    }
    if (!known && d < 5) { m.giveUp[o.id] = nowT + 40; p.done = true; return; }
    if (d > 26) go(t, TX, TZ, d > 50 ? 'run' : 'sneak', 2.5);
    else if (d < 14) {
      if (nowT >= p.timer) { p.timer = nowT + 1.5; pickEscape(t, TX, TZ, 8, false, true); p.x = P.x; p.z = P.z; }
      go(t, p.x, p.z, 'sneak', 2);
    } else {
      if (m.moving) halt(t);
      t.sneaking = true;
      tCall('faceToward', t, TX, TZ);
    }
    say(t, p.flavor === 'lone' ? 'thought.stalkLone' : 'thought.stalk', 'target', o.name);
    if (nowT > p.until) p.done = true;
  }

  function exDrink(t, m, p, nowT) {
    if (p.flavor === 'bottle') {
      if (p.stage === 0) {
        halt(t);
        p.stage = 1;
        p.timer = nowT + 1.2;
        if (!tCall('consume', t, 'water')) { p.done = true; return; }
      } else if (nowT > p.timer) p.done = true;
      say(t, 'thought.drinkBottle');
      return;
    }
    if (!knowWater(t)) { setPlan(t, 'wander', -1, NaN, NaN, null, 'explore', 0.5); m.execAt = 0; return; }
    const d = dxz(t, m.waterX, m.waterZ);
    if (d < 4.5 || t.inWater) {
      if (nowT >= p.timer) {
        p.timer = nowT + 1.8;
        let ok;
        if (GM.Contestants && typeof GM.Contestants.drink === 'function') ok = !!tCall('drink', t);
        else { t.thirst = Math.max(0, (t.thirst || 0) - 60); ok = true; }
        if (ok) { p.stage = 1; halt(t); }
        else {
          p.n++;
          go(t, m.waterX, m.waterZ, 'walk', 0.3);
          if (p.n > 6) { m.noWaterUntil = nowT + 40; m.waterOk = false; p.done = true; }
        }
      }
      say(t, p.stage === 1 ? 'thought.drinking' : 'thought.drink');
      if ((t.thirst || 0) < 15) p.done = true;
    } else {
      go(t, m.waterX, m.waterZ, (t.thirst || 0) > 70 ? 'run' : 'walk', 1);
      say(t, (t.thirst || 0) > 80 ? 'thought.thirsty' : 'thought.drink');
    }
    if (nowT > p.until) p.done = true;
  }

  function exConsume(t, m, p, nowT, what, key) {
    if (p.stage === 0) {
      halt(t);
      p.stage = 1;
      p.timer = nowT + 1.4;
      if (!tCall('consume', t, what)) { p.done = true; return; }
    } else if (nowT > p.timer) p.done = true;
    say(t, key);
  }

  function exForage(t, m, p, nowT, dt) {
    if (p.stage === 0) {
      if (arrivedAt(t, p.x, p.z, 2.5) || nowT - p.since > 25) { p.stage = 1; halt(t); p.t2 = nowT + 20; }
      else go(t, p.x, p.z, 'walk', 1.5);
    } else {
      if (m.moving) halt(t);
      let got = null;
      if (GM.Contestants && typeof GM.Contestants.forage === 'function') got = tCall('forage', t, dt);
      else if (t.inv && R.chance(dt * 0.05)) { t.inv.berries = (t.inv.berries || 0) + 1; got = 'berries'; }
      if (got) { m.forageFail = 0; p.done = true; }
      else if (nowT > p.t2) { m.forageFail++; p.done = true; }
      lookAround(t, p, nowT);
    }
    say(t, (t.hunger || 0) > 85 ? 'thought.starving' : 'thought.forage');
  }

  function exSleep(t, m, p, nowT) {
    if (p.stage === 0) {
      if (arrivedAt(t, p.x, p.z, 2) || nowT - p.since > 40) {
        fallAsleep(t);
        if (!t.sleeping) { p.done = true; return; }
        p.stage = 1;
        t.hidden = m.coverHere > 0.35;
      } else {
        go(t, p.x, p.z, 'walk', 1);
        say(t, p.flavor === 'cold' ? 'thought.cold' : 'thought.sleepFind');
        return;
      }
    }
    if (!t.sleeping) { p.done = true; return; }
    const en = num(t.energy, 100);
    if (en >= 99 || (!ENV.night && en > 75 && nowT - p.since > 20)) { wake(t); p.done = true; return; }
    const al = allianceOf(t);
    const w = al && al.watchId != null && al.watchId !== t.id ? trib(al.watchId) : null;
    if (w && w.alive) say(t, 'thought.sleepGuarded', 'ally', w.name);
    else say(t, 'thought.sleep');
  }

  function exAlly(t, m, p, nowT) {
    const o = p.ref;
    if (!o || !o.alive || allied(t, o) || aliveN <= 6) { p.done = true; return; }
    const d = dd(t, o);
    if (d < 4.5) {
      halt(t);
      tCall('faceToward', t, o.pos.x, o.pos.z);
      proposeAlliance(t, o);
      m.allyCool = Math.max(m.allyCool, nowT + 20);
      p.done = true;
      return;
    }
    chase(t, o.pos.x, o.pos.z, d > 20 ? 'run' : 'walk');
    say(t, 'thought.ally', 'target', o.name);
    if (d > 45 || nowT > p.until) { p.done = true; m.allyCool = Math.max(m.allyCool, nowT + 30); }
  }

  function exFollow(t, m, p, nowT) {
    const L = p.ref;
    const al = allianceOf(t);
    if (!L || !L.alive || L === t || !al || al.leaderId !== L.id) { p.done = true; return; }
    const d = dd(t, L);
    if (d > 9) {
      const side = ((t.id % 3) - 1) * 3;
      const hx = Math.sin(L.heading || 0), hz = Math.cos(L.heading || 0);
      const lm = L.mind;
      const fast = d > 25 || (lm && (lm.goalMode === 'run' || lm.goalMode === 'sprint') && lm.moving);
      chase(t, L.pos.x - hx * 4 + hz * side, L.pos.z - hz * 4 - hx * side, fast ? 'run' : 'walk');
      say(t, 'thought.follow', 'leader', L.name);
    } else {
      if (d < 6 && m.moving) halt(t);
      say(t, 'thought.stayClose', 'leader', L.name);
    }
    if (nowT > p.until) p.done = true;
  }

  function exGuard(t, m, p, nowT) {
    if (p.flavor === 'watch') {
      const al = allianceOf(t);
      if (!al || al.watchId !== t.id || !ENV.night) { p.done = true; return; }
      let s = null;
      for (const id of al.members) { const o = trib(id); if (o && o !== t && o.alive && o.sleeping) { s = o; break; } }
      if (s) {
        if (dd(t, s) > 5) go(t, s.pos.x, s.pos.z, 'walk', 2);
        else { if (m.moving) halt(t); lookAround(t, p, nowT); }
        say(t, 'thought.watch', 'ally', s.name);
      } else {
        if (m.moving) halt(t);
        lookAround(t, p, nowT);
        say(t, 'thought.guard');
      }
      if (nowT > p.until) p.done = true;
      return;
    }
    if (arrivedAt(t, p.x, p.z, 2)) {
      if (p.stage === 0) { p.stage = 1; p.t2 = nowT + R.range(3, 8); halt(t); }
      else if (nowT > p.t2) { chooseSpot(t, p); p.stage = 0; }
      else lookAround(t, p, nowT);
    } else go(t, p.x, p.z, 'walk', 1);
    say(t, 'thought.guard');
    if (nowT > p.until) p.done = true;
  }

  function exTrap(t, m, p, nowT) {
    if (arrivedAt(t, p.x, p.z, 1.5) || nowT - p.since > 30) {
      if (p.stage === 0) {
        halt(t);
        p.stage = 1;
        p.t2 = nowT + 1.5;
        m.lastTrapAt = nowT;
        if (iCall('placeTrap', t)) { m.trapX = t.pos.x; m.trapZ = t.pos.z; m.hasTrapSpot = true; }
      } else if (nowT > p.t2) p.done = true;
    } else go(t, p.x, p.z, 'walk', 0.8);
    say(t, p.flavor === 'water' ? 'thought.trapWater' : 'thought.trap');
  }

  function exAmbush(t, m, p, nowT) {
    if (p.stage === 0) {
      if (arrivedAt(t, p.x, p.z, 2) || nowT - p.since > 35) { p.stage = 1; halt(t); t.hidden = true; }
      else go(t, p.x, p.z, dxz(t, p.x, p.z) < 25 ? 'sneak' : 'walk', 1);
    } else {
      if (m.moving) halt(t);
      t.hidden = true;
      lookAround(t, p, nowT);
      if (m.nearEnemyId >= 0) {
        const o = trib(m.nearEnemyId);
        const rr = rangedRange(t);
        const reach = rr > 0 ? Math.min(rr * 0.8, 24) : 10;
        const om = o && o.mind;
        const unaware = o && (o.sleeping || !(om && om.visible && om.visible[t.id]));
        if (o && o.alive && m.nearEnemyD < reach && (POW[t.id] > POW[o.id] * 0.6 || unaware)) {
          if (nowT - m.lastAmbushLog > 30) {
            m.lastAmbushLog = nowT;
            mlog('mind', 'log.mind.ambush', { name: t.name, target: o.name }, t, o, true);
            interest(t, 6, 8, 'ambush:' + t.id, { key: 'log.mind.i.ambush', params: { name: t.name } }, 'ambush');
          }
          setPlan(t, 'fight', o.id, NaN, NaN, o, 'ambush', 2);
          m.execAt = 0;
          return;
        }
      }
    }
    say(t, p.flavor === 'water' ? 'thought.ambushWater' : p.flavor === 'fog' ? 'thought.ambushFog' : 'thought.ambush');
    if (nowT > p.until) p.done = true;
  }

  function exSteal(t, m, p, nowT) {
    const o = p.ref;
    if (!o || !o.alive || !o.sleeping) { p.done = true; return; }
    const d = dd(t, o);
    if (d < 2) {
      halt(t);
      let got = null;
      if (GM.Items && typeof GM.Items.steal === 'function') got = iCall('steal', t, o);
      else {
        for (const k of STEAL_KINDS) if (transfer(o, t, k)) { got = k; break; }
        if (got) mlog('mind', 'log.mind.steal', { name: t.name, target: o.name }, t, o);
      }
      if (got) interest(t, 4, 6, 'steal:' + t.id, { key: 'log.mind.i.steal', params: { name: t.name } }, 'steal');
      if (hasMind(o) && R.chance(0.35)) {
        wake(o);
        o.mind.grudge[t.id] = Math.max(o.mind.grudge[t.id], 0.5);
      }
      setPlan(t, 'flee', o.id, o.pos.x, o.pos.z, o, '', 1);
      m.execAt = 0;
      return;
    }
    go(t, o.pos.x, o.pos.z, 'sneak', 0.5);
    say(t, 'thought.steal', 'target', o.name);
    if (nowT > p.until) p.done = true;
  }

  function exInvestigate(t, m, p, nowT) {
    const d = dxz(t, p.x, p.z);
    const fl = p.flavor;
    if (p.stage === 0) {
      if (d < 4 || nowT - p.since > 40) { p.stage = 1; p.t2 = nowT + R.range(2.5, 5); halt(t); }
      else {
        const mode = fl === 'lure' || (fl === 'fight' && t.traits.aggression > 0.6) ? 'run' : (d < 18 && t.traits.cunning > 0.5 ? 'sneak' : 'walk');
        go(t, p.x, p.z, mode, 2);
      }
    } else {
      lookAround(t, p, nowT);
      if (nowT > p.t2) { p.done = true; m.heardT = -1e6; }
    }
    say(t, fl === 'lure' ? 'thought.investigateLure' : fl === 'fight' ? 'thought.investigateFight' :
      fl === 'explosion' ? 'thought.investigateBlast' : 'thought.investigate');
  }

  function exFeast(t, m, p, nowT) {
    const f = GM.state.feast;
    if (!f || f.over || typeof f.x !== 'number') { p.done = true; return; }
    if (!f.ready) {
      const ax = t.pos.x - f.x, az = t.pos.z - f.z;
      const l = Math.sqrt(ax * ax + az * az) || 1;
      const wx = f.x + ax / l * 26, wz = f.z + az / l * 26;
      if (dxz(t, wx, wz) > 4) go(t, wx, wz, 'walk', 3);
      else if (m.moving) halt(t);
      say(t, 'thought.feastWait');
      if (nowT > p.until) p.done = true;
      return;
    }
    const I = GM.Items, list = I && I.list;
    let best = null, bd = 1e9;
    if (list) {
      for (let k = 0; k < list.length; k++) {
        const it = list[k];
        if (!it || it.removed || !it.feast || it.falling || !it.pos) continue;
        const d = dxz(t, it.pos.x, it.pos.z);
        if (d < bd) { bd = d; best = it; }
      }
    }
    if (!best) { p.done = true; return; }
    if (tryPickup(t, best)) { p.done = true; return; }
    go(t, best.pos.x, best.pos.z, bd > 10 ? 'sprint' : 'run', 0.5);
    say(t, 'thought.feast');
    if (nowT > p.until) p.done = true;
  }

  function exAvoid(t, m, p, nowT) {
    const fl = p.flavor;
    if (fl === 'flood') {
      if (!m.flood) { p.done = true; return; }
      go(t, m.floodX, m.floodZ, 'run', 3);
      say(t, 'thought.highGround');
      return;
    }
    if (fl === 'water') {
      if (!t.swimming && !t.inWater) { p.done = true; return; }
      if (p.stage === 0 || nowT > p.t2) { p.stage = 1; p.t2 = nowT + 3; findShore(t); p.x = P.x; p.z = P.z; }
      go(t, p.x, p.z, 'run', 1.5);
      say(t, 'thought.leaveWater');
      return;
    }
    if (!m.dangerNear && m.dangerLevel < 0.05) { p.done = true; return; }
    if (p.stage === 0 || nowT > p.t2) {
      p.stage = 1;
      p.t2 = nowT + 1;
      pickEscape(t, m.dangerX, m.dangerZ, m.dangerR + 16, false, false);
      p.x = P.x; p.z = P.z;
    }
    go(t, p.x, p.z, 'sprint', 2);
    say(t, fl === 'fire' ? 'thought.avoidFire' : fl === 'gas' ? 'thought.avoidGas' : fl === 'blast' ? 'thought.avoidBlast' :
      fl === 'quake' ? 'thought.avoidQuake' : fl === 'lightning' ? 'thought.avoidLightning' : 'thought.avoidDanger');
    if (nowT > p.until) p.done = true;
  }

  function exZone(t, m, p, nowT) {
    const zn = zoneInfo();
    if (!zn || (m.zoneOut < -6 && !m.zoneEarly)) { p.done = true; return; }
    const target = Math.max(3, Math.min(zn.radius, num(zn.targetRadius, zn.radius)) - 8);
    const ax = t.pos.x - zn.center.x, az = t.pos.z - zn.center.z;
    const l = Math.sqrt(ax * ax + az * az);
    let gx = zn.center.x, gz = zn.center.z;
    if (l > 0.5) { const r = Math.min(l, target * 0.85); gx += ax / l * r; gz += az / l * r; }
    go(t, gx, gz, m.zoneOut > 0 ? 'sprint' : 'run', 3);
    say(t, m.zoneOut > 0 ? 'thought.escapeZone' : 'thought.zoneEarly');
    if (nowT > p.until) p.done = true;
  }

  function exPanic(t, m, p, nowT) {
    if (!(statusOf(t).panic > 0) && nowT - p.since > 2) { p.done = true; return; }
    if (nowT >= p.timer) {
      p.timer = nowT + R.range(0.9, 1.6);
      const th = m.threatId >= 0 ? trib(m.threatId) : null;
      if (th && th.alive) pickEscape(t, th.pos.x, th.pos.z, 15, false, false);
      else {
        const an = R.angle();
        P.x = t.pos.x + Math.sin(an) * 15; P.z = t.pos.z + Math.cos(an) * 15;
        clampToArena(P, 8);
      }
      p.x = P.x; p.z = P.z;
    }
    go(t, p.x, p.z, 'sprint', 2);
    say(t, 'thought.panic');
  }

  function exMad(t, m, p, nowT) {
    if (!(statusOf(t).madness > 0) && nowT - p.since > 2) { p.done = true; return; }
    let tg = p.ref && p.ref.alive && p.ref.kind === 'contestant' && dd(t, p.ref) < 18 ? p.ref : null;
    if (!tg && nowT >= p.t2) {
      p.t2 = nowT + 1;
      tg = nearestVisible(t, 15);
      p.ref = tg;
      p.targetId = tg ? tg.id : -1;
      t.targetId = tg ? tg.id : null;
    }
    if (tg) {
      engage(t, tg, true);
      say(t, 'thought.madAttack', 'target', tg.name);
      return;
    }
    if (nowT >= p.timer) {
      p.timer = nowT + R.range(1.5, 3.5);
      const an = R.angle();
      P.x = t.pos.x + Math.sin(an) * 12; P.z = t.pos.z + Math.cos(an) * 12;
      clampToArena(P, 8);
      p.x = P.x; p.z = P.z;
    }
    go(t, p.x, p.z, 'run', 2);
    say(t, 'thought.mad');
  }

  function exBerserk(t, m, p, nowT) {
    const o = p.ref;
    if (!o || !o.alive || !o.pos || t.emotion.rage < 0.35 || dd(t, o) > 40) { p.done = true; return; }
    engage(t, o, true);
    say(t, 'thought.berserk', 'target', o.name);
    if (nowT > p.until) p.done = true;
  }

  function exWander(t, m, p, nowT) {
    const fl = p.flavor;
    if (arrivedAt(t, p.x, p.z, 3) || nowT > p.until) { p.done = true; return; }
    const thirsty = (t.thirst || 0) > 70;
    go(t, p.x, p.z, fl === 'search' || (fl === 'explore' && thirsty) ? 'run' : 'walk', 3);
    if (fl === 'drift') say(t, 'thought.drift');
    else if (fl === 'search' && p.ref && p.ref.kind === 'contestant') say(t, 'thought.searchEnemy', 'target', p.ref.name);
    else if (fl === 'explore') say(t, thirsty ? 'thought.thirsty' : 'thought.explore');
    else say(t, 'thought.wander');
  }

  function exIdle(t, m, p, nowT) {
    if (m.moving) halt(t);
    lookAround(t, p, nowT);
    if (t.emotion.sanity < 0.42 && m.alliesNear === 0) say(t, 'thought.lonely');
    else say(t, 'thought.idle');
    if (nowT > p.until) p.done = true;
  }

  function execute(t, dt) {
    const m = t.mind, p = m.plan, nowT = now();
    if (statusOf(t).stun > 0) return;
    switch (p.id) {
      case 'kickoff': exKickoff(t, m, p, nowT); break;
      case 'scatter': exScatter(t, m, p, nowT); break;
      case 'loot': exLoot(t, m, p, nowT); break;
      case 'flee': exFlee(t, m, p, nowT); break;
      case 'hide': exHide(t, m, p, nowT); break;
      case 'hunt': exHunt(t, m, p, nowT); break;
      case 'fight': exFight(t, m, p, nowT); break;
      case 'stalk': exStalk(t, m, p, nowT); break;
      case 'drink': exDrink(t, m, p, nowT); break;
      case 'eat': exConsume(t, m, p, nowT, p.flavor === 'berries' ? 'berries' : 'food', p.flavor === 'berries' ? 'thought.eatBerries' : 'thought.eat'); break;
      case 'heal': exConsume(t, m, p, nowT, 'medkit', 'thought.heal'); break;
      case 'forage': exForage(t, m, p, nowT, dt); break;
      case 'rest':
        if (m.moving) halt(t);
        say(t, 'thought.rest');
        if (num(t.stamina, 100) > 70 || nowT > p.until) p.done = true;
        break;
      case 'sleep': exSleep(t, m, p, nowT); break;
      case 'ally': exAlly(t, m, p, nowT); break;
      case 'follow': exFollow(t, m, p, nowT); break;
      case 'guard': exGuard(t, m, p, nowT); break;
      case 'trap': exTrap(t, m, p, nowT); break;
      case 'ambush': exAmbush(t, m, p, nowT); break;
      case 'steal': exSteal(t, m, p, nowT); break;
      case 'investigate': exInvestigate(t, m, p, nowT); break;
      case 'feast': exFeast(t, m, p, nowT); break;
      case 'avoid': exAvoid(t, m, p, nowT); break;
      case 'escape_zone': exZone(t, m, p, nowT); break;
      case 'panic': exPanic(t, m, p, nowT); break;
      case 'mad': exMad(t, m, p, nowT); break;
      case 'berserk': exBerserk(t, m, p, nowT); break;
      case 'wander': exWander(t, m, p, nowT); break;
      default: exIdle(t, m, p, nowT); break;
    }
    if (m.plan.done) thinkSoon(m, 0.05);
  }

  // ======================================================================
  // System
  // ======================================================================
  function endedTick() {
    const st = GM.state;
    for (const t of st.contestants) {
      if (!hasMind(t)) continue;
      const m = t.mind;
      if (m.plan.id !== 'idle' || m.plan.flavor !== 'end') {
        setPlan(t, 'idle', -1, NaN, NaN, null, 'end', 0);
        m.plan.until = 1e12;
        halt(t);
      }
      t.targetId = null;
      t.hidden = false;
      if (st.winner === t.id && m.thKey !== 'thought.won') { m.holdUntil = 0; say(t, 'thought.won'); }
      t.mood = moodOf(t);
    }
  }

  function update(dt) {
    const st = GM.state;
    if (st.phase !== 'running' && st.phase !== 'ended') return;   // countdown: still on the pedestals
    const nowT = now();
    refreshEnv();
    revealOn = num(st.revealUntil, 0) > nowT;
    refreshStats(false);
    if (st.phase === 'ended') { endedTick(); return; }
    if (nowT - allyAt >= 1) {
      allyAt = nowT;
      try { allianceUpkeep(); } catch (err) { GM.reportError('AI.alliances', err); }
    }
    senseEnemies();
    const trs = st.contestants;
    for (let i = 0; i < trs.length; i++) {
      const t = trs[i];
      if (!hasMind(t)) continue;
      const m = t.mind;
      try {
        updateEmotions(t, dt);
        if (nowT >= m.nextPerceive) {
          m.nextPerceive = nowT + (t.sleeping ? 0.9 : R.range(0.35, 0.5));
          perceive(t);
        }
        if (nowT >= m.nextThink) {
          m.nextThink = nowT + (t.sleeping ? R.range(1, 1.6) : R.range(0.3, 0.6));
          m.lastThink = nowT;
          think(t);
        }
        trackStuck(t, dt);
        m.execDt += dt;
        if (nowT >= m.execAt) {
          const edt = m.execDt;
          m.execDt = 0;
          m.execAt = nowT + 0.1;
          execute(t, edt);
        }
      } catch (err) {
        GM.reportError('AI.contestant', err);
        CUR = null;
        m.plan.done = true;
        m.nextThink = nowT + 1;
      }
    }
  }

  function clear() {
    alliances.length = 0;
    allianceUid = 0;
    POW.fill(0);
    COVER.fill(0);
    powAt = -1e9;
    aliveN = 0; totalN = 0; tension = 0; pace = 0; tribKills = 0; cornStock = 0; lastDeathAt = 0;
    statAt = -1e9; allyAt = -1e9; senseAt = 0;
    revealOn = false; finalLogged = false;
    gongAt = -1e9;
    CUR = null;
    for (const b of BLASTS) b.until = -1;
    for (const b of BODIES) { b.id = -1; b.t = -1e6; }
    bodyIdx = 0;
    ENV.vis = 1; ENV.night = false; ENV.cold = false; ENV.fog = false; ENV.weather = 'clear';
    ENV.water = CFG.BASE_WATER_LEVEL; ENV.waterPrev = CFG.BASE_WATER_LEVEL; ENV.waterEv = undefined;
    ENV.rising = 0; ENV.floodUntil = 0;
  }

  function reset() {
    clear();
    const trs = GM.state.contestants || [];
    for (const t of trs) {
      if (t && (!t.mind || t.mind.v !== 1)) {
        try { initMind(t); } catch (err) { GM.reportError('AI.initMind', err); }
      }
    }
    initRelations();
    totalN = trs.length;
    refreshEnv();
    refreshStats(true);
  }

  /** Contestants near a point look again (new fire / gas cloud). */
  function nudgeNear(pos, r) {
    if (!pos) return;
    for (const t of GM.state.contestants) {
      if (!hasMind(t) || dxz(t, num(pos.x, 0), num(pos.z, 0)) > r) continue;
      t.mind.dangerScanAt = 0;
      thinkSoon(t.mind, R.range(0.1, 0.5));
    }
  }

  function init() {
    GM.on('game:start', onGameStart);
    GM.on('contestant:died', onDied);
    GM.on('hazard:lightning', function (e) { if (e) addBlast(e.pos, num(e.radius, 8) + 4, 3, 'lightning'); });
    GM.on('hazard:explosion', function (e) { if (e) addBlast(e.pos, num(e.radius, 6) + 3, 4, 'explosion'); });
    GM.on('hazard:quake', function (e) { if (e) addBlast(e.pos, num(e.radius, 20), 6, 'quake'); });
    GM.on('hazard:fire', function (e) { if (e) nudgeNear(e.pos, num(e.radius, 6) + 25); });
    GM.on('hazard:gas', function (e) { if (e) nudgeNear(e.pos, num(e.radius, 12) + 25); });
    GM.on('hazard:flood', function () { ENV.floodUntil = now() + 15; everyoneThinks(1); });
    GM.on('water:changed', function (e) {
      if (!e || typeof e.level !== 'number') return;
      ENV.waterEv = e.level;
      if (e.level > CFG.BASE_WATER_LEVEL + 0.4) ENV.floodUntil = now() + 10;
    });
    GM.on('zone:shrink', function () { everyoneThinks(2); });
    GM.on('gift:sent', onGift);
    GM.on('combat:attack', onCombatAttack);
    GM.on('feast:announced', function () { everyoneThinks(3); });
    GM.on('feast:ready', function () { everyoneThinks(2); });
    GM.on('power:used', function (e) { if (e && e.id === 'reveal') everyoneThinks(1.5); });
    GM.on('trap:triggered', function (e) {
      const t = e && e.contestant;
      if (hasMind(t)) { t.mind.plan.done = true; thinkSoon(t.mind, 0.3); }
    });
  }

  // ======================================================================
  // Public API
  // ======================================================================
  /** How a feels about b: {trust -1..1, grudge 0..1, allied}. */
  function relation(a, b) {
    if (!a || !b || !a.mind || a.mind.v !== 1 || b.id == null || b.id >= MAXN) return { trust: 0, grudge: 0, allied: false };
    return { trust: a.mind.trust[b.id], grudge: a.mind.grudge[b.id], allied: allied(a, b) };
  }
  /** Small summary of a contestant's mind (UI helpers / debugging). */
  function describe(t) {
    if (!t || !t.mind || t.mind.v !== 1) return null;
    const p = t.mind.plan;
    return {
      action: t.action, icon: ACTION_ICONS[t.action] || ACTION_ICONS.idle, mood: t.mood, moodIcon: MOOD_ICONS[t.mood] || MOOD_ICONS.calm,
      targetId: t.targetId, flavor: p.flavor, since: p.since, style: t.mind.style,
      alliance: allianceOf(t), archetype: Archetypes[t.archetype] || null,
    };
  }

  GM.Archetypes = Archetypes;
  GM.ARCHETYPE_IDS = ARCHETYPE_IDS;
  GM.AI = {
    ACTIONS: ACTIONS,
    MOODS: MOODS,
    MOOD_ICONS: MOOD_ICONS,
    TRAITS: TRAITS,
    SKILLS: SKILLS,
    EMOTIONS: EMOTIONS,
    alliances: alliances,
    pickArchetypes: pickArchetypes,
    initMind: initMind,
    onDamaged: onDamaged,
    noise: noise,
    applyStatus: applyStatus,
    allianceOf: allianceOf,
    /** Emoji for an action id. */
    actionIcon: function (id) { return ACTION_ICONS[id] || ACTION_ICONS.idle; },
    /** Emoji for a mood id. */
    moodIcon: function (mood) { return MOOD_ICONS[mood] || MOOD_ICONS.calm; },
    relation: relation,
    describe: describe,
    /** Current pacing tension (0 .. ~1.6). */
    tension: function () { return tension; },
    isAllied: function (a, b) { return !!(a && b && allied(a, b)); },
    compat: compat,
  };

  GM.registerSystem({ name: 'AI', order: 60, init: init, clear: clear, reset: reset, update: update });
})();
