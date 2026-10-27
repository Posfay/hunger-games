/* ==========================================================================
 * ui.js — GM.UI: the Showrunners' control room.
 *
 * Builds every piece of DOM inside #ui-root once at init and keeps it live:
 *   setup sheet (arena code, contestant count, mix, editable roster, options),
 *   top bar (day, clock, weather, alive, viewers + excitement, GM energy,
 *   speed, language, sound, help), roster panel, selected-contestant panel,
 *   powers panel with targeting, kill feed, event log, announcements,
 *   countdown, night recap, victory screen, help overlay, camera HUD,
 *   live feed frames and a responsive drawer layout.
 *
 * Public API (GM.UI):
 *   isTargeting() -> bool                 a power is armed and waits for a target
 *   targetPoint(x, z) -> bool             use the armed power at a world point (minimap)
 *   aimPoint(x, z) / clearAim()           move the aim reticle (minimap hover)
 *   targeting() -> {id, def, option, mode, x, z, hasPoint, radius} | null
 *   startTargeting(id, optionId) / cancelTargeting()
 *   usePower(id)                          same as clicking the power button
 *   pickContestant(id)                       roster click: select + follow (or target)
 *   showHelp() / hideHelp() / toggleHelp()
 *   toast(key, params)                    small message at the bottom of the view
 *   setDockTab('powers'|'contestant'|'log') / openDrawer('left'|'right'|null)
 *   refresh()                             force a full refresh
 *   hoverId                               contestant id hovered in the roster (minimap ring)
 *
 * Owner: UI. Contract: SPEC.md section 8.13.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  if (!GM) return;
  const CFG = GM.CFG;
  const U = GM.U;

  // ================================================================== i18n
  if (GM.i18n) {
    GM.i18n.add({
      en: {
        // top bar
        'ui.top.alive': 'Alive',
        'ui.top.viewers': 'Viewers',
        'ui.top.excitement': 'Excitement',
        'ui.top.excitementTip': 'How excited the audience is. Exciting shows give you more energy.',
        'ui.top.viewersTip': 'People watching the Show right now.',
        'ui.top.energy': 'Energy',
        'ui.top.energyTip': 'Showrunner energy. Powers cost energy. It comes back over time.',
        'ui.top.sandbox': 'Sandbox',
        'ui.top.speed': 'Speed',
        'ui.top.pause': 'Pause (Space)',
        'ui.top.play': 'Play (Space)',
        'ui.top.speedX': 'Speed {n}× (+ / -)',
        'ui.top.mute': 'Sound off (M)',
        'ui.top.unmute': 'Sound on (M)',
        'ui.top.help': 'Help (H)',
        'ui.top.lang': 'Language (L)',
        'ui.top.exit': 'End this Show and go back to the setup',
        'ui.top.exitConfirm': 'Click again to leave',
        'ui.top.errors': '{n} errors',
        'ui.top.errors_one': '1 error',
        'ui.top.errorsTip': 'Some parts had problems. Click to see them.',
        'ui.top.roster': 'Contestants',
        'ui.top.monitors': 'Map and live feeds',
        'ui.top.dayTip': 'Day of the Show and time in the arena',
        'ui.top.weatherTip': 'Weather in the arena',
        'ui.top.aliveTip': 'Contestants still alive',
        'ui.top.countdown': 'Get ready',

        // roster
        'ui.roster.title': 'Contestants',
        'ui.roster.count': '{alive} / {total} alive',
        'ui.roster.sort': 'Sort',
        'ui.roster.empty': 'No contestants yet.',
        'ui.roster.pick': 'Click: watch this contestant',
        'ui.roster.pickTarget': 'Click: choose as target',
        'ui.sort.team': 'Team',
        'ui.sort.kills': 'Kills',
        'ui.sort.health': 'Health',
        'ui.sort.name': 'Name',
        'ui.kills': '{n} kills',
        'ui.kills_one': '1 kill',

        // selected contestant
        'ui.sel.title': 'Contestant',
        'ui.sel.none': 'Click a contestant to see them up close.',
        'ui.sel.noneSub': 'Use the list, the map or click in the arena. Tab jumps to the next one.',
        'ui.sel.follow': 'Follow with the camera (F)',
        'ui.sel.unfollow': 'Stop following',
        'ui.sel.close': 'Close',
        'ui.sel.gift': 'Send a gift to this contestant',
        'ui.sel.smite': 'Studio strike on this contestant',
        'ui.sel.smiteConfirm': 'Click again to strike',
        'ui.sel.health': 'Health',
        'ui.sel.stamina': 'Stamina',
        'ui.sel.food': 'Food',
        'ui.sel.water': 'Water',
        'ui.sel.rest': 'Rest',
        'ui.sel.healthTip': 'Health. At zero the contestant dies.',
        'ui.sel.staminaTip': 'Stamina. Running and swimming use it.',
        'ui.sel.foodTip': 'Food. A full bar means not hungry.',
        'ui.sel.waterTip': 'Water. A full bar means not thirsty.',
        'ui.sel.restTip': 'Rest. A full bar means well rested.',
        'ui.sel.body': 'Body',
        'ui.sel.mind': 'Mind',
        'ui.sel.gear': 'Gear',
        'ui.sel.noGear': 'Nothing',
        'ui.sel.effects': 'Effects',
        'ui.sel.noEffects': 'None',
        'ui.sel.kills': 'Kills',
        'ui.sel.damage': 'Damage',
        'ui.sel.allies': 'Allies',
        'ui.sel.alone': 'Alone',
        'ui.sel.leader': 'Leader',
        'ui.sel.traits': 'Personality',
        'ui.sel.fallen': 'Fallen on day {day}',
        'ui.sel.killedBy': 'Killed by {name}',
        'ui.sel.cause': 'Cause: {cause}',
        'ui.sel.place': 'Place {n}',
        'ui.sel.victor': 'Winner',
        'ui.sel.popularity': 'Audience favour',
        'ui.sel.thinks': 'Thinking',
        'ui.emo.fear': 'Fear',
        'ui.emo.rage': 'Rage',
        'ui.emo.confidence': 'Confidence',
        'ui.emo.sanity': 'Sanity',
        'ui.emo.fearTip': 'Fear. Scared contestants run and hide.',
        'ui.emo.rageTip': 'Rage. Angry contestants attack and seek revenge.',
        'ui.emo.confidenceTip': 'Confidence. Confident contestants take risks.',
        'ui.emo.sanityTip': 'Sanity. Low sanity makes strange choices.',

        // status fallbacks
        'ui.status.stun': 'Stunned',
        'ui.status.poison': 'Poisoned',
        'ui.status.madness': 'Mad',
        'ui.status.panic': 'Panic',
        'ui.status.burning': 'Burning',
        'ui.status.stung': 'Stung',
        'ui.status.bleeding': 'Bleeding',
        'ui.status.sleeping': 'Asleep',
        'ui.status.hidden': 'Hidden',
        'ui.status.sneaking': 'Sneaking',
        'ui.status.swimming': 'Swimming',
        // mood fallbacks
        'ui.mood.calm': 'Calm',
        'ui.mood.afraid': 'Afraid',
        'ui.mood.angry': 'Angry',
        'ui.mood.confident': 'Confident',
        'ui.mood.desperate': 'Desperate',
        'ui.mood.mad': 'Mad',
        'ui.mood.asleep': 'Asleep',
        'ui.mood.hurt': 'Hurt',
        // trait fallbacks
        'ui.trait.aggression': 'Aggression',
        'ui.trait.bravery': 'Bravery',
        'ui.trait.greed': 'Greed',
        'ui.trait.sociability': 'Friendliness',
        'ui.trait.loyalty': 'Loyalty',
        'ui.trait.cunning': 'Cunning',
        'ui.trait.patience': 'Patience',
        'ui.trait.stability': 'Calm mind',
        // archetype fallbacks
        'ui.arch.elite': 'Elite',
        'ui.arch.survivor': 'Survivor',
        'ui.arch.scavenger': 'Scavenger',
        'ui.arch.opportunist': 'Opportunist',
        'ui.arch.strategist': 'Strategist',
        'ui.arch.berserker': 'Berserker',
        'ui.arch.protector': 'Protector',
        'ui.arch.lonewolf': 'Lone wolf',
        'ui.arch.elite.desc': 'Trained to kill. Rushes the Nexus and hunts in a pack.',
        'ui.arch.survivor.desc': 'Careful and clever. Hides, finds food and fights only when trapped.',
        'ui.arch.scavenger.desc': 'Runs from danger and steals what others leave behind.',
        'ui.arch.opportunist.desc': 'Waits while others fight, then finishes the weak. Betrays allies.',
        'ui.arch.strategist.desc': 'Calm planner. Sets traps and waits in ambush.',
        'ui.arch.berserker.desc': 'Wild and angry. Charges at enemies, sometimes even at friends.',
        'ui.arch.protector.desc': 'Loyal friend. Makes allies, defends them and never betrays.',
        'ui.arch.lonewolf.desc': 'Hunts alone, often at night. Picks contestants who are alone.',
        // item fallbacks
        'ui.item.knife': 'Knife',
        'ui.item.sickle': 'Sickle',
        'ui.item.axe': 'Axe',
        'ui.item.sword': 'Sword',
        'ui.item.mace': 'Mace',
        'ui.item.spear': 'Spear',
        'ui.item.trident': 'Trident',
        'ui.item.bow': 'Bow',
        'ui.item.throwing_knives': 'Throwing knives',
        'ui.item.arrows': 'Arrows',
        'ui.item.armor': 'Armor vest',
        'ui.item.food': 'Food',
        'ui.item.water': 'Water',
        'ui.item.medkit': 'Medicine',
        'ui.item.berries': 'Berries',
        'ui.item.trap_kit': 'Trap kit',
        'ui.item.sleeping_bag': 'Sleeping bag',
        'ui.item.goggles': 'Night goggles',
        'ui.item.backpack': 'Backpack',
        'ui.item.crate': 'Supply crate',

        // powers
        'ui.pow.title': 'Showrunner powers',
        'ui.pow.cat.all': 'All',
        'ui.pow.cat.gift': 'Gifts',
        'ui.pow.cat.nature': 'Nature',
        'ui.pow.cat.hazard': 'Danger',
        'ui.pow.cat.rule': 'Rules',
        'ui.pow.cost': 'Cost: {n} energy',
        'ui.pow.free': 'Cost: free (sandbox)',
        'ui.pow.cooldown': 'Rest time: {n} s',
        'ui.pow.radius': 'Area: {n} m',
        'ui.pow.target.none': 'Works at once',
        'ui.pow.target.point': 'Aim at a place in the arena',
        'ui.pow.target.contestant': 'Aim at a contestant',
        'ui.pow.reason.cooldown': 'Not ready yet: {n} s',
        'ui.pow.reason.energy': 'Not enough energy',
        'ui.pow.reason.phase': 'Only while the Show runs',
        'ui.pow.reason.missing': 'Powers are not available',
        'ui.pow.reason.failed': 'It did not work here',
        'ui.pow.ready': 'Ready',
        'ui.pow.unavailable': 'The Showrunner console is offline.',
        'ui.pow.choose': 'Choose one',
        'ui.pow.now': 'now',
        'ui.pow.assistant': 'Assistant',
        'ui.pow.assistantTip': 'A helper Showrunner acts when the audience is bored.',
        'ui.pow.energyTip': 'Your energy. It comes back faster when the audience is excited.',
        'ui.target.point': 'Click in the arena or on the map',
        'ui.target.contestant': 'Click a contestant in the arena or in the list',
        'ui.target.cancel': 'Right-click or Esc: cancel',
        'ui.target.keep': 'Hold Shift to use it again',
        'ui.target.needContestant': 'Click on a contestant.',
        'ui.target.ground': 'Click on the ground.',
        'ui.target.dead': 'This contestant is dead.',
        'ui.target.over': 'Target: {name}',
        'ui.target.option': 'Mode',

        // event log
        'ui.log.title': 'Event log',
        'ui.log.f.all': 'All',
        'ui.log.f.kills': 'Kills',
        'ui.log.f.gm': 'Showrunner',
        'ui.log.f.events': 'Events',
        'ui.log.selOnly': 'Only the selected contestant',
        'ui.log.empty': 'Nothing has happened yet.',
        'ui.log.focus': 'Click: the camera looks there',

        // camera HUD
        'ui.cam.rec': 'REC',
        'ui.cam.live': 'LIVE',
        'ui.cam.mode.showcase': 'PREVIEW',
        'ui.cam.mode.free': 'FREE',
        'ui.cam.mode.follow': 'FOLLOW',
        'ui.cam.mode.director': 'DIRECTOR',
        'ui.cam.mode.overhead': 'MAP',
        'ui.cam.btn.director': 'Director: the camera finds the action (3)',
        'ui.cam.btn.follow': 'Follow the selected contestant (2)',
        'ui.cam.btn.free': 'Free camera (1)',
        'ui.cam.btn.overhead': 'Map view from above (4)',
        'ui.cam.noSignal': 'No camera signal',

        // overlays
        'ui.cd.title': 'The Show begins in',
        'ui.paused': 'Paused',
        'ui.pausedHint': 'Press Space to continue',
        'ui.results': 'Results',
        'ui.ann.info': 'Announcement',
        'ui.ann.danger': 'Alert',
        'ui.ann.gold': 'Studio',
        'ui.ann.gm': 'Showrunner',
        'ui.toast.tags': 'Name tags: {v}',
        'ui.toast.feeds': 'Live feeds: {v}',
        'ui.toast.sound': 'Sound: {v}',
        'ui.toast.speed': 'Speed: {n}×',
        'ui.toast.paused': 'Paused',
        'ui.toast.assistant': 'Assistant: {v}',
        'ui.toast.used': 'Used: {power}',
        'ui.toast.noContestants': 'No living contestants.',
        'ui.dock.powers': 'Powers',
        'ui.dock.contestant': 'Contestant',
        'ui.dock.log': 'Log',
        'ui.err.title': 'Errors',
        'ui.err.hint': 'Some parts had problems. The Show keeps running.',
        'ui.err.none': 'No errors.',

        // live feeds
        'feed.title': 'Live feeds',
        'feed.name': 'FEED {n}',
        'feed.rec': 'REC',
        'feed.watch': 'Click: show this on the main screen',
        'feed.noSignal': 'NO SIGNAL',
        'feed.off': 'Feeds are off',
        'feed.toggle': 'Live feeds on / off',
        'feed.searching': 'Looking for action…',

        // night recap
        'recap.title': 'The fallen of day {n}',
        'recap.sub': 'Tonight the sky shows the faces of the dead.',
        'recap.none': 'No one died today.',
        'recap.count': '{n} fallen today',
        'recap.count_one': '1 fallen today',
        'recap.by': 'By {name}',
        'recap.close': 'Click to close',

        // victory
        'victory.title': 'Winner',
        'victory.none': 'No winner',
        'victory.noneSub': 'The last contestants died together.',
        'victory.days': 'Days',
        'victory.time': 'Game time',
        'victory.deaths': 'Deaths',
        'victory.kills': 'Winner kills',
        'victory.mostKills': 'Most kills',
        'victory.powers': 'Powers used',
        'victory.grade': 'Audience grade',
        'victory.peak': 'Most viewers',
        'victory.kickoff': 'Opening rush deaths',
        'victory.fallen': 'The fallen',
        'victory.excitement': 'Excitement during the Show',
        'victory.newShow': 'New Show',
        'victory.watch': 'Keep watching',
        'victory.grade.S': 'Legendary! The Studio will never forget this Show.',
        'victory.grade.A': 'A great show. The audience loved it.',
        'victory.grade.B': 'A good show.',
        'victory.grade.C': 'A bit slow. The audience got bored at times.',
        'victory.grade.D': 'Boring. The Studio is not happy.',
        'victory.none.dash': '—',
        'victory.day': 'Day {n}',

        // help
        'help.title': 'How to play',
        'help.intro': 'You are the Showrunner. The contestants act by themselves: they look for food, make friends, hide, hunt and fight. You watch them and change the arena. Send gifts, change the weather, start fires, release beasts. Make the Show exciting for the audience!',
        'help.camera': 'Camera',
        'help.game': 'Game',
        'help.k.move': 'Move the camera',
        'help.k.updown': 'Down / up',
        'help.k.fast': 'Move faster',
        'help.k.look': 'Look around',
        'help.k.zoom': 'Zoom',
        'help.k.modes': 'Free / follow / director / map',
        'help.k.cycle': 'Next camera mode',
        'help.k.follow': 'Follow the selected contestant',
        'help.k.pause': 'Pause / play',
        'help.k.speed': 'Slower / faster',
        'help.k.tab': 'Next / previous contestant',
        'help.k.esc': 'Cancel / close',
        'help.k.lang': 'Change language',
        'help.k.help': 'This help',
        'help.k.tags': 'Name tags on / off',
        'help.k.mute': 'Sound on / off',
        'help.k.powers': 'Go to the powers',
        'help.k.click': 'Select a contestant',
        'help.key.drag': 'Drag',
        'help.key.wheel': 'Wheel',
        'help.key.click': 'Click',
        'help.key.arrows': 'Arrows',
        'help.key.space': 'Space',
        'help.powers': 'Your powers',
        'help.powersIntro': 'Powers cost energy. Energy comes back over time, faster when the audience is excited. After you use a power, it needs some time to be ready again.',
        'help.aim': 'How to aim',
        'help.aimText': 'Click a power. Then click a place in the arena or on the map. Some powers need a contestant: click the contestant in the arena or in the list. Right-click or Esc cancels.',
        'help.contestants': 'The contestants',
        'help.contestantsText': 'Every contestant has a personality. Some hunt, some hide, some make friends and later betray them. Hunger, thirst, fear and anger change what they do. Click a contestant to see what they think.',
        'help.audience': 'The audience',
        'help.audienceText': 'Fights, deaths and surprises excite the audience. Excited viewers give you more energy. When nothing happens, they get bored.',
        'help.tip': 'From day 4 the force field starts to close, so the Show always ends.',
        'help.noPowers': 'The powers are not available right now.',

        // setup
        'setup.kicker': 'Showrunner console',
        'setup.tagline': 'Build the arena. Choose the contestants. Then control the Show.',
        'setup.arena': 'Arena',
        'setup.seed': 'Arena code',
        'setup.seedHint': 'A number or a word. The same code always makes the same arena.',
        'setup.seedPh': 'Type a number or a word',
        'setup.random': 'Random',
        'setup.randomTip': 'Make a new random arena',
        'setup.seedValue': 'Arena #{n}',
        'setup.loading': 'Building the arena…',
        'setup.contestants': 'Contestants',
        'setup.count': 'Number of contestants',
        'setup.mix': 'Contestant mix',
        'setup.mix.balanced': 'Balanced',
        'setup.mix.bloodthirsty': 'Bloodthirsty',
        'setup.mix.peaceful': 'Peaceful',
        'setup.mix.chaos': 'Chaos',
        'setup.mix.balanced.desc': 'A bit of every personality.',
        'setup.mix.bloodthirsty.desc': 'More killers. A short, bloody Show.',
        'setup.mix.peaceful.desc': 'More survivors and friends. A longer Show.',
        'setup.mix.chaos.desc': 'Totally random personalities.',
        'setup.roster': 'Roster',
        'setup.regen': 'New contestants',
        'setup.regenTip': 'Make new names and personalities (your changes are removed)',
        'setup.name': 'Name',
        'setup.arch': 'Personality',
        'setup.namePh': 'Name',
        'setup.gender': 'Change: girl / boy',
        'setup.edited': 'Changed by you',
        'setup.noRoster': 'Contestant data is missing. The Show cannot start.',
        'setup.options': 'Options',
        'setup.sandbox': 'Sandbox',
        'setup.sandbox.desc': 'Unlimited energy, short wait times.',
        'setup.autogm': 'Assistant',
        'setup.autogm.desc': 'A helper Showrunner acts when the audience is bored.',
        'setup.quality': 'Graphics',
        'setup.quality.high': 'High',
        'setup.quality.low': 'Low',
        'setup.quality.desc': 'Low is faster on weak computers.',
        'setup.feeds': 'Live feeds',
        'setup.feeds.desc': 'Three small extra cameras.',
        'setup.nameTags': 'Name tags',
        'setup.nameTags.desc': 'Names above the contestants.',
        'setup.language': 'Language',
        'setup.start': 'Start the Show',
        'setup.summary': '{n} contestants · {d} teams',
        'setup.help': 'How to play',
      },
      hu: {
        'ui.top.alive': 'Élők',
        'ui.top.viewers': 'Nézők',
        'ui.top.excitement': 'Izgalom',
        'ui.top.excitementTip': 'Mennyire izgatott a közönség. Az izgalmas Műsor több energiát ad.',
        'ui.top.viewersTip': 'Ennyien nézik most a Műsort.',
        'ui.top.energy': 'Energia',
        'ui.top.energyTip': 'A Showrunner energiája. A képességek energiába kerülnek. Idővel visszatöltődik.',
        'ui.top.sandbox': 'Homokozó',
        'ui.top.speed': 'Sebesség',
        'ui.top.pause': 'Szünet (Szóköz)',
        'ui.top.play': 'Folytatás (Szóköz)',
        'ui.top.speedX': 'Sebesség: {n}× (+ / -)',
        'ui.top.mute': 'Hang ki (M)',
        'ui.top.unmute': 'Hang be (M)',
        'ui.top.help': 'Súgó (H)',
        'ui.top.lang': 'Nyelv (L)',
        'ui.top.exit': 'A Műsor befejezése, vissza a beállításokhoz',
        'ui.top.exitConfirm': 'Kattints újra a kilépéshez',
        'ui.top.errors': '{n} hiba',
        'ui.top.errors_one': '1 hiba',
        'ui.top.errorsTip': 'Néhány résznél hiba történt. Kattints a részletekért.',
        'ui.top.roster': 'Versenyzők',
        'ui.top.monitors': 'Térkép és élő adások',
        'ui.top.dayTip': 'A Műsor napja és az idő az arénában',
        'ui.top.weatherTip': 'Időjárás az arénában',
        'ui.top.aliveTip': 'Élő versenyzők',
        'ui.top.countdown': 'Készülj',

        'ui.roster.title': 'Versenyzők',
        'ui.roster.count': '{alive} / {total} él',
        'ui.roster.sort': 'Rendezés',
        'ui.roster.empty': 'Még nincsenek versenyzők.',
        'ui.roster.pick': 'Kattintás: kövesd ezt a versenyzőt',
        'ui.roster.pickTarget': 'Kattintás: legyen ez a célpont',
        'ui.sort.team': 'Csapat',
        'ui.sort.kills': 'Ölések',
        'ui.sort.health': 'Élet',
        'ui.sort.name': 'Név',
        'ui.kills': '{n} ölés',
        'ui.kills_one': '1 ölés',

        'ui.sel.title': 'Versenyző',
        'ui.sel.none': 'Kattints egy versenyzőre, hogy közelről lásd.',
        'ui.sel.noneSub': 'Használd a listát, a térképet, vagy kattints az arénába. A Tab a következőre ugrik.',
        'ui.sel.follow': 'Követés a kamerával (F)',
        'ui.sel.unfollow': 'Követés vége',
        'ui.sel.close': 'Bezárás',
        'ui.sel.gift': 'Ajándék küldése ennek a versenyzőnek',
        'ui.sel.smite': 'Stúdiós csapás erre a versenyzőre',
        'ui.sel.smiteConfirm': 'Kattints újra a csapáshoz',
        'ui.sel.health': 'Élet',
        'ui.sel.stamina': 'Kitartás',
        'ui.sel.food': 'Étel',
        'ui.sel.water': 'Víz',
        'ui.sel.rest': 'Pihenés',
        'ui.sel.healthTip': 'Élet. Nullánál a versenyző meghal.',
        'ui.sel.staminaTip': 'Kitartás. A futás és az úszás fogyasztja.',
        'ui.sel.foodTip': 'Étel. Tele csík: nem éhes.',
        'ui.sel.waterTip': 'Víz. Tele csík: nem szomjas.',
        'ui.sel.restTip': 'Pihenés. Tele csík: kipihent.',
        'ui.sel.body': 'Test',
        'ui.sel.mind': 'Lélek',
        'ui.sel.gear': 'Felszerelés',
        'ui.sel.noGear': 'Semmi',
        'ui.sel.effects': 'Hatások',
        'ui.sel.noEffects': 'Nincs',
        'ui.sel.kills': 'Ölések',
        'ui.sel.damage': 'Sebzés',
        'ui.sel.allies': 'Szövetségesek',
        'ui.sel.alone': 'Egyedül',
        'ui.sel.leader': 'Vezető',
        'ui.sel.traits': 'Személyiség',
        'ui.sel.fallen': 'Elesett: {day}. nap',
        'ui.sel.killedBy': 'Megölte: {name}',
        'ui.sel.cause': 'Ok: {cause}',
        'ui.sel.place': 'Helyezés: {n}.',
        'ui.sel.victor': 'Győztes',
        'ui.sel.popularity': 'Közönség kedvence',
        'ui.sel.thinks': 'Gondolat',
        'ui.emo.fear': 'Félelem',
        'ui.emo.rage': 'Düh',
        'ui.emo.confidence': 'Önbizalom',
        'ui.emo.sanity': 'Józan ész',
        'ui.emo.fearTip': 'Félelem. A félő versenyző menekül és elbújik.',
        'ui.emo.rageTip': 'Düh. A dühös versenyző támad és bosszút áll.',
        'ui.emo.confidenceTip': 'Önbizalom. A magabiztos versenyző kockáztat.',
        'ui.emo.sanityTip': 'Józan ész. Ha alacsony, furcsa döntéseket hoz.',

        'ui.status.stun': 'Kábult',
        'ui.status.poison': 'Mérgezett',
        'ui.status.madness': 'Őrült',
        'ui.status.panic': 'Pánik',
        'ui.status.burning': 'Ég',
        'ui.status.stung': 'Megcsípték',
        'ui.status.bleeding': 'Vérzik',
        'ui.status.sleeping': 'Alszik',
        'ui.status.hidden': 'Rejtőzik',
        'ui.status.sneaking': 'Lopakodik',
        'ui.status.swimming': 'Úszik',
        'ui.mood.calm': 'Nyugodt',
        'ui.mood.afraid': 'Fél',
        'ui.mood.angry': 'Dühös',
        'ui.mood.confident': 'Magabiztos',
        'ui.mood.desperate': 'Kétségbeesett',
        'ui.mood.mad': 'Megőrült',
        'ui.mood.asleep': 'Alszik',
        'ui.mood.hurt': 'Sérült',
        'ui.trait.aggression': 'Agresszió',
        'ui.trait.bravery': 'Bátorság',
        'ui.trait.greed': 'Kapzsiság',
        'ui.trait.sociability': 'Barátságosság',
        'ui.trait.loyalty': 'Hűség',
        'ui.trait.cunning': 'Ravaszság',
        'ui.trait.patience': 'Türelem',
        'ui.trait.stability': 'Nyugodt elme',
        'ui.arch.elite': 'Elit',
        'ui.arch.survivor': 'Túlélő',
        'ui.arch.scavenger': 'Guberáló',
        'ui.arch.opportunist': 'Opportunista',
        'ui.arch.strategist': 'Stratéga',
        'ui.arch.berserker': 'Őrjöngő',
        'ui.arch.protector': 'Védelmező',
        'ui.arch.lonewolf': 'Magányos farkas',
        'ui.arch.elite.desc': 'Ölni tanították. A Nexushoz rohan, és falkában vadászik.',
        'ui.arch.survivor.desc': 'Óvatos és ügyes. Elbújik, ételt keres, és csak végső esetben harcol.',
        'ui.arch.scavenger.desc': 'Elfut a veszély elől, és ellopja, amit mások hátrahagynak.',
        'ui.arch.opportunist.desc': 'Kivárja, amíg mások harcolnak, aztán végez a gyengékkel. Elárulja a társait.',
        'ui.arch.strategist.desc': 'Nyugodt tervező. Csapdákat állít és lesben vár.',
        'ui.arch.berserker.desc': 'Vad és dühös. Rátámad az ellenségre, néha még a barátaira is.',
        'ui.arch.protector.desc': 'Hűséges barát. Szövetséget köt, megvédi a társait, és sosem árul el senkit.',
        'ui.arch.lonewolf.desc': 'Egyedül vadászik, gyakran éjjel. A magányos versenyzőket keresi.',
        'ui.item.knife': 'Kés',
        'ui.item.sickle': 'Sarló',
        'ui.item.axe': 'Balta',
        'ui.item.sword': 'Kard',
        'ui.item.mace': 'Buzogány',
        'ui.item.spear': 'Lándzsa',
        'ui.item.trident': 'Szigony',
        'ui.item.bow': 'Íj',
        'ui.item.throwing_knives': 'Dobókések',
        'ui.item.arrows': 'Nyílvesszők',
        'ui.item.armor': 'Páncélmellény',
        'ui.item.food': 'Étel',
        'ui.item.water': 'Víz',
        'ui.item.medkit': 'Gyógyszer',
        'ui.item.berries': 'Bogyók',
        'ui.item.trap_kit': 'Csapdakészlet',
        'ui.item.sleeping_bag': 'Hálózsák',
        'ui.item.goggles': 'Éjjellátó szemüveg',
        'ui.item.backpack': 'Hátizsák',
        'ui.item.crate': 'Ellátmányláda',

        'ui.pow.title': 'A Showrunner képességei',
        'ui.pow.cat.all': 'Mind',
        'ui.pow.cat.gift': 'Ajándék',
        'ui.pow.cat.nature': 'Természet',
        'ui.pow.cat.hazard': 'Veszély',
        'ui.pow.cat.rule': 'Szabály',
        'ui.pow.cost': 'Ár: {n} energia',
        'ui.pow.free': 'Ár: ingyen (homokozó)',
        'ui.pow.cooldown': 'Pihenőidő: {n} mp',
        'ui.pow.radius': 'Terület: {n} m',
        'ui.pow.target.none': 'Azonnal hat',
        'ui.pow.target.point': 'Célozz egy helyre az arénában',
        'ui.pow.target.contestant': 'Célozz egy versenyzőre',
        'ui.pow.reason.cooldown': 'Még nem kész: {n} mp',
        'ui.pow.reason.energy': 'Nincs elég energia',
        'ui.pow.reason.phase': 'Csak a Műsor alatt',
        'ui.pow.reason.missing': 'A képességek nem érhetők el',
        'ui.pow.reason.failed': 'Itt nem sikerült',
        'ui.pow.ready': 'Kész',
        'ui.pow.unavailable': 'A Showrunner-pult nem elérhető.',
        'ui.pow.choose': 'Válassz egyet',
        'ui.pow.now': 'most',
        'ui.pow.assistant': 'Segéd',
        'ui.pow.assistantTip': 'Egy segéd Showrunner közbelép, ha unatkozik a közönség.',
        'ui.pow.energyTip': 'Az energiád. Gyorsabban töltődik, ha izgatott a közönség.',
        'ui.target.point': 'Kattints az arénába vagy a térképre',
        'ui.target.contestant': 'Kattints egy versenyzőre az arénában vagy a listában',
        'ui.target.cancel': 'Jobb klikk vagy Esc: mégse',
        'ui.target.keep': 'Tartsd lenyomva a Shiftet, és újra használhatod',
        'ui.target.needContestant': 'Kattints egy versenyzőre.',
        'ui.target.ground': 'Kattints a földre.',
        'ui.target.dead': 'Ez a versenyző halott.',
        'ui.target.over': 'Célpont: {name}',
        'ui.target.option': 'Mód',

        'ui.log.title': 'Eseménynapló',
        'ui.log.f.all': 'Mind',
        'ui.log.f.kills': 'Ölések',
        'ui.log.f.gm': 'Showrunner',
        'ui.log.f.events': 'Események',
        'ui.log.selOnly': 'Csak a kijelölt versenyző',
        'ui.log.empty': 'Még nem történt semmi.',
        'ui.log.focus': 'Kattintás: a kamera odanéz',

        'ui.cam.rec': 'REC',
        'ui.cam.live': 'ÉLŐ',
        'ui.cam.mode.showcase': 'ELŐNÉZET',
        'ui.cam.mode.free': 'SZABAD',
        'ui.cam.mode.follow': 'KÖVETÉS',
        'ui.cam.mode.director': 'RENDEZŐ',
        'ui.cam.mode.overhead': 'TÉRKÉP',
        'ui.cam.btn.director': 'Rendező: a kamera magától megtalálja az akciót (3)',
        'ui.cam.btn.follow': 'A kijelölt versenyző követése (2)',
        'ui.cam.btn.free': 'Szabad kamera (1)',
        'ui.cam.btn.overhead': 'Térkép nézet felülről (4)',
        'ui.cam.noSignal': 'Nincs kamerajel',

        'ui.cd.title': 'A Műsor kezdetéig',
        'ui.paused': 'Szünet',
        'ui.pausedHint': 'Nyomd meg a Szóközt a folytatáshoz',
        'ui.results': 'Eredmények',
        'ui.ann.info': 'Közlemény',
        'ui.ann.danger': 'Riasztás',
        'ui.ann.gold': 'Stúdió',
        'ui.ann.gm': 'Showrunner',
        'ui.toast.tags': 'Névcímkék: {v}',
        'ui.toast.feeds': 'Élő adások: {v}',
        'ui.toast.sound': 'Hang: {v}',
        'ui.toast.speed': 'Sebesség: {n}×',
        'ui.toast.paused': 'Szünet',
        'ui.toast.assistant': 'Segéd: {v}',
        'ui.toast.used': 'Használva: {power}',
        'ui.toast.noContestants': 'Nincs élő versenyző.',
        'ui.dock.powers': 'Képességek',
        'ui.dock.contestant': 'Versenyző',
        'ui.dock.log': 'Napló',
        'ui.err.title': 'Hibák',
        'ui.err.hint': 'Néhány résznél hiba történt. A Műsor fut tovább.',
        'ui.err.none': 'Nincs hiba.',

        'feed.title': 'Élő adások',
        'feed.name': 'ADÁS {n}',
        'feed.rec': 'REC',
        'feed.watch': 'Kattintás: mutasd a fő képernyőn',
        'feed.noSignal': 'NINCS JEL',
        'feed.off': 'Az adások ki vannak kapcsolva',
        'feed.toggle': 'Élő adások be / ki',
        'feed.searching': 'Akciót keresünk…',

        'recap.title': 'Elesettek – {n}. nap',
        'recap.sub': 'Ma éjjel az égbolt a halottak arcát mutatja.',
        'recap.none': 'Ma senki sem halt meg.',
        'recap.count': 'Ma {n} versenyző esett el',
        'recap.count_one': 'Ma 1 versenyző esett el',
        'recap.by': 'Megölte: {name}',
        'recap.close': 'Kattints a bezáráshoz',

        'victory.title': 'Győztes',
        'victory.none': 'Nincs győztes',
        'victory.noneSub': 'Az utolsó versenyzők együtt haltak meg.',
        'victory.days': 'Napok',
        'victory.time': 'Játékidő',
        'victory.deaths': 'Halottak',
        'victory.kills': 'A győztes ölései',
        'victory.mostKills': 'Legtöbb ölés',
        'victory.powers': 'Használt képességek',
        'victory.grade': 'A közönség értékelése',
        'victory.peak': 'Legtöbb néző',
        'victory.kickoff': 'A nyitó roham halottai',
        'victory.fallen': 'Az elesettek',
        'victory.excitement': 'Izgalom a Műsor alatt',
        'victory.newShow': 'Új Műsor',
        'victory.watch': 'Tovább nézem',
        'victory.grade.S': 'Legendás! A Stúdió sosem felejti el ezt a Műsort.',
        'victory.grade.A': 'Remek műsor. A közönség imádta.',
        'victory.grade.B': 'Jó műsor.',
        'victory.grade.C': 'Kicsit lassú. A közönség néha unatkozott.',
        'victory.grade.D': 'Unalmas. A Stúdió nem elégedett.',
        'victory.none.dash': '—',
        'victory.day': '{n}. nap',

        'help.title': 'Hogyan játssz?',
        'help.intro': 'Te vagy a Showrunner. A versenyzők maguktól cselekszenek: ételt keresnek, barátokat szereznek, elbújnak, vadásznak és harcolnak. Te figyeled őket, és megváltoztatod az arénát. Küldj ajándékot, változtasd meg az időjárást, gyújts tüzet, engedj szabadon fenevadakat. Tedd izgalmassá a Műsort a közönségnek!',
        'help.camera': 'Kamera',
        'help.game': 'Játék',
        'help.k.move': 'Kamera mozgatása',
        'help.k.updown': 'Le / fel',
        'help.k.fast': 'Gyorsabb mozgás',
        'help.k.look': 'Körbenézés',
        'help.k.zoom': 'Nagyítás',
        'help.k.modes': 'Szabad / követés / rendező / térkép',
        'help.k.cycle': 'Következő kameramód',
        'help.k.follow': 'A kijelölt versenyző követése',
        'help.k.pause': 'Szünet / folytatás',
        'help.k.speed': 'Lassabb / gyorsabb',
        'help.k.tab': 'Következő / előző versenyző',
        'help.k.esc': 'Mégse / bezárás',
        'help.k.lang': 'Nyelv váltása',
        'help.k.help': 'Ez a súgó',
        'help.k.tags': 'Névcímkék be / ki',
        'help.k.mute': 'Hang be / ki',
        'help.k.powers': 'Ugrás a képességekhez',
        'help.k.click': 'Versenyző kijelölése',
        'help.key.drag': 'Húzás',
        'help.key.wheel': 'Görgő',
        'help.key.click': 'Kattintás',
        'help.key.arrows': 'Nyilak',
        'help.key.space': 'Szóköz',
        'help.powers': 'A képességeid',
        'help.powersIntro': 'A képességek energiába kerülnek. Az energia idővel visszatöltődik, gyorsabban, ha izgatott a közönség. Használat után egy képességnek idő kell, hogy újra kész legyen.',
        'help.aim': 'Hogyan célozz?',
        'help.aimText': 'Kattints egy képességre. Aztán kattints egy helyre az arénában vagy a térképen. Néhány képességhez versenyző kell: kattints rá az arénában vagy a listában. A jobb klikk vagy az Esc visszavonja.',
        'help.contestants': 'A versenyzők',
        'help.contestantsText': 'Minden versenyzőnek saját személyisége van. Van, aki vadászik, van, aki elbújik, és van, aki barátokat szerez, majd elárulja őket. Az éhség, a szomjúság, a félelem és a düh megváltoztatja, mit tesznek. Kattints egy versenyzőre, és látod, mire gondol.',
        'help.audience': 'A közönség',
        'help.audienceText': 'A harcok, a halálok és a meglepetések izgalomba hozzák a közönséget. Az izgatott nézők több energiát adnak. Ha nem történik semmi, unatkoznak.',
        'help.tip': 'A 4. naptól bezárul az erőtér, így a Műsor mindig véget ér.',
        'help.noPowers': 'A képességek most nem érhetők el.',

        'setup.kicker': 'Showrunner-pult',
        'setup.tagline': 'Építsd meg az arénát. Állítsd össze a versenyzőket. Aztán irányítsd a Műsort.',
        'setup.arena': 'Aréna',
        'setup.seed': 'Aréna kód',
        'setup.seedHint': 'Szám vagy szó. Ugyanaz a kód mindig ugyanazt az arénát adja.',
        'setup.seedPh': 'Írj be egy számot vagy egy szót',
        'setup.random': 'Véletlen',
        'setup.randomTip': 'Új, véletlen aréna',
        'setup.seedValue': 'Aréna #{n}',
        'setup.loading': 'Az aréna épül…',
        'setup.contestants': 'Versenyzők',
        'setup.count': 'Versenyzők száma',
        'setup.mix': 'Összetétel',
        'setup.mix.balanced': 'Kiegyensúlyozott',
        'setup.mix.bloodthirsty': 'Vérszomjas',
        'setup.mix.peaceful': 'Békés',
        'setup.mix.chaos': 'Káosz',
        'setup.mix.balanced.desc': 'Minden személyiségből egy kicsit.',
        'setup.mix.bloodthirsty.desc': 'Több gyilkos. Rövid, véres Műsor.',
        'setup.mix.peaceful.desc': 'Több túlélő és barát. Hosszabb Műsor.',
        'setup.mix.chaos.desc': 'Teljesen véletlen személyiségek.',
        'setup.roster': 'Névsor',
        'setup.regen': 'Új versenyzők',
        'setup.regenTip': 'Új nevek és személyiségek (a módosításaid elvesznek)',
        'setup.name': 'Név',
        'setup.arch': 'Személyiség',
        'setup.namePh': 'Név',
        'setup.gender': 'Váltás: lány / fiú',
        'setup.edited': 'Általad módosítva',
        'setup.noRoster': 'Hiányoznak a versenyzők adatai. A Műsor nem indulhat.',
        'setup.options': 'Beállítások',
        'setup.sandbox': 'Homokozó',
        'setup.sandbox.desc': 'Végtelen energia, rövid várakozás.',
        'setup.autogm': 'Segéd',
        'setup.autogm.desc': 'Egy segéd Showrunner közbelép, ha unatkozik a közönség.',
        'setup.quality': 'Grafika',
        'setup.quality.high': 'Magas',
        'setup.quality.low': 'Alacsony',
        'setup.quality.desc': 'Az alacsony gyorsabb gyenge gépen.',
        'setup.feeds': 'Élő adások',
        'setup.feeds.desc': 'Három kis extra kamera.',
        'setup.nameTags': 'Névcímkék',
        'setup.nameTags.desc': 'Nevek a versenyzők felett.',
        'setup.language': 'Nyelv',
        'setup.start': 'Kezdődjön a Műsor',
        'setup.summary': '{n} versenyző · {d} csapat',
        'setup.help': 'Hogyan játssz?',
      },
    });
  }

  // ============================================================= constants
  const ARCH_FALLBACK = ['elite', 'survivor', 'scavenger', 'opportunist', 'strategist', 'berserker', 'protector', 'lonewolf'];
  const ARCH_ICON = {
    elite: '⚔️', survivor: '🌿', scavenger: '🎒', opportunist: '🦊',
    strategist: '♟️', berserker: '💢', protector: '🛡️', lonewolf: '🎯',
  };
  const MOOD_ICON = {
    calm: '😐', afraid: '😨', angry: '😠', confident: '😎',
    desperate: '😰', mad: '🤪', asleep: '😴', hurt: '🤕',
  };
  const ACT_ICON = {
    idle: '•', wander: '🚶', loot: '🎒', flee: '🏃', hide: '🌿', hunt: '🎯', fight: '⚔️',
    stalk: '👁️', drink: '💧', eat: '🍖', forage: '🍄', rest: '🪵', sleep: '💤', heal: '🩹',
    ally: '🤝', follow: '👣', guard: '🛡️', trap: '🪤', ambush: '🕸️', steal: '🫳',
    investigate: '🔍', feast: '🍗', avoid: '↩️', escape_zone: '🔷', panic: '😱', mad: '🌀',
    berserk: '💢', kickoff: '💥', scatter: '💨',
  };
  const ITEM_ICON = {
    knife: '🔪', sickle: '🌙', axe: '🪓', sword: '🗡️', mace: '🔨', spear: '🔱', trident: '🔱',
    bow: '🏹', throwing_knives: '🔪', arrows: '➶', armor: '🦺', food: '🍖', water: '💧',
    medkit: '🩹', berries: '🫐', trap_kit: '🪤', sleeping_bag: '🛏️', goggles: '🥽',
    backpack: '🎒', crate: '📦',
  };
  const CAUSE_ICON = {
    weapon: '🗡️', fists: '👊', fire: '🔥', fireball: '☄️', explosion: '💥', lightning: '⚡',
    beast: '🐺', wasps: '🐝', gas: '☠️', drown: '🌊', starve: '🍽️', thirst: '💧', cold: '❄️',
    forcefield: '🔷', trap: '🪤', poison: '🫐', quake: '🌋', fall: '🪨', smite: '👁️', unknown: '✝',
  };
  const WEATHER_ICON = { clear: '☀️', rain: '🌧️', storm: '⛈️', fog: '🌫️', snow: '🌨️', heat: '🌡️' };
  const TOD_ICON = { 'tod.dawn': '🌅', 'tod.day': '☀️', 'tod.dusk': '🌇', 'tod.night': '🌙' };
  const STATUS_ICON = {
    stun: '💫', poison: '🤢', madness: '🌀', panic: '😱', burning: '🔥', stung: '🐝', bleeding: '🩸',
    sleeping: '💤', hidden: '🌿', sneaking: '👣', swimming: '🏊',
  };
  const STATUS_IDS = ['stun', 'poison', 'madness', 'panic', 'burning', 'stung', 'bleeding'];
  const STATUS_BAD = { stun: 1, poison: 1, madness: 1, panic: 1, burning: 1, stung: 1, bleeding: 1 };
  const EMOTIONS = ['fear', 'rage', 'confidence', 'sanity'];
  const TRAITS = ['aggression', 'bravery', 'greed', 'sociability', 'loyalty', 'cunning', 'patience', 'stability'];
  const MIXES = [
    { id: 'balanced', icon: '⚖️' }, { id: 'bloodthirsty', icon: '🩸' },
    { id: 'peaceful', icon: '🕊️' }, { id: 'chaos', icon: '🎲' },
  ];
  const POWER_CATS = [
    { id: 'all', icon: '◈' }, { id: 'gift', icon: '🎁' }, { id: 'nature', icon: '🌦️' },
    { id: 'hazard', icon: '☄️' }, { id: 'rule', icon: '⚖️' },
  ];
  /** log type -> glyph + filter group */
  const LOG_TYPES = {
    kill: { g: '☠', f: 'kills' }, death: { g: '✝', f: 'kills' }, combat: { g: '⚔', f: 'events' },
    alliance: { g: '⛓', f: 'events' }, betrayal: { g: '✂', f: 'events' }, item: { g: '▣', f: 'events' },
    gm: { g: '◆', f: 'gm' }, hazard: { g: '⚠', f: 'gm' }, event: { g: '•', f: 'events' },
    mind: { g: '◌', f: 'events' }, system: { g: '◈', f: 'events' },
  };
  const LOG_FILTERS = ['all', 'kills', 'gm', 'events'];
  const SORTS = ['team', 'kills', 'health', 'name'];
  const CAM_MODES = [
    { id: 'director', icon: 'clapper' }, { id: 'follow', icon: 'video' },
    { id: 'free', icon: 'move' }, { id: 'overhead', icon: 'map' },
  ];
  const FALLBACK_NAMES = {
    f: ['Ada', 'Briony', 'Cressa', 'Dahlia', 'Elin', 'Fern', 'Gisela', 'Hana', 'Iris', 'Juno', 'Kira', 'Lena',
      'Mara', 'Nell', 'Opal', 'Petra', 'Quinn', 'Rhea', 'Sela', 'Tamsin', 'Una', 'Vera', 'Wren', 'Zola'],
    m: ['Arlo', 'Bram', 'Cyrus', 'Dorian', 'Emil', 'Felix', 'Gael', 'Hugo', 'Ivo', 'Jasper', 'Kai', 'Leon',
      'Milo', 'Nico', 'Orin', 'Pax', 'Rafe', 'Silas', 'Tor', 'Uri', 'Vito', 'Wes', 'Xan', 'Zeno'],
  };

  const REFRESH_DT = 1 / 8;      // main refresh rate (s real time)
  const LOG_CAP = 160;           // DOM rows in the event log
  const KF_MAX = 6;              // kill feed rows
  const KF_LIFE = 14;            // seconds a kill feed row stays
  const ANN_MAX = 3;             // stacked announcements
  const VICTORY_DELAY = 4.2;     // seconds after 'game:end'
  const PREFS_KEY = 'gm-arena-setup-v1';

  // ================================================================ helpers
  function t(key, params) { return GM.t(key, params); }
  function has(key) { return !!(GM.i18n && GM.i18n.has && GM.i18n.has(key, 'en')); }
  /** Translate `primary` when it exists, else `fallback`, else ''. */
  function tk(primary, fallback, params) {
    if (has(primary)) return t(primary, params);
    if (fallback && has(fallback)) return t(fallback, params);
    return '';
  }
  function safe(where, fn, a, b) {
    try { return fn(a, b); } catch (e) { GM.reportError('UI.' + where, e); return undefined; }
  }
  function play(name, opts) {
    const A = GM.Audio;
    if (!A || typeof A.play !== 'function') return;
    try { A.play(name, opts || { volume: 0.5 }); } catch (e) { GM.reportError('UI.audio', e); }
  }
  function now() { return GM.state.realTime || 0; }
  function pct(v) { return Math.round(U.clamp01(+v || 0) * 1000) / 10 + '%'; }
  function num(v) { return +v === +v ? +v : 0; }
  function isGamePhase(p) { return p === 'countdown' || p === 'running' || p === 'ended'; }
  function settings() { return GM.state.settings || null; }
  function lang() { return (GM.i18n && GM.i18n.lang) || 'en'; }
  function compact(v) {
    if (GM.i18n && GM.i18n.compact) return GM.i18n.compact(Math.max(0, num(v)));
    return String(Math.round(num(v)));
  }

  // ------------------------------------------------------------- game data
  function contestantById(id) {
    const a = GM.state.contestants;
    return id != null && a && a[id] ? a[id] : null;
  }
  function archIds() {
    const ids = GM.ARCHETYPE_IDS;
    return Array.isArray(ids) && ids.length ? ids : ARCH_FALLBACK;
  }
  function archDef(id) { const A = GM.Archetypes; return (A && id && A[id]) || null; }
  function archIcon(id) { const d = archDef(id); return (d && d.icon) || ARCH_ICON[id] || '•'; }
  function archName(id) {
    const d = archDef(id);
    return tk((d && d.nameKey) || 'arch.' + id, 'ui.arch.' + id) || String(id || '');
  }
  function archDesc(id) {
    const d = archDef(id);
    return tk((d && d.descKey) || 'arch.' + id + '.desc', 'ui.arch.' + id + '.desc');
  }
  function actionIcon(a) {
    const AI = GM.AI;
    if (AI && typeof AI.actionIcon === 'function') {
      try { const s = AI.actionIcon(a); if (s) return s; } catch (e) { /* fall back */ }
    }
    return ACT_ICON[a] || '•';
  }
  function actionName(a) { return a ? tk('act.' + a) : ''; }
  function moodIcon(m) {
    const AI = GM.AI;
    if (AI && typeof AI.moodIcon === 'function') {
      try { const s = AI.moodIcon(m); if (s) return s; } catch (e) { /* fall back */ }
    }
    return MOOD_ICON[m] || '😐';
  }
  function moodName(m) { return m ? tk('mood.' + m, 'ui.mood.' + m) : ''; }
  function itemDef(id) { const D = GM.ItemDefs; return (D && id && D[id]) || null; }
  function itemIcon(id) { const d = itemDef(id); return (d && d.icon) || ITEM_ICON[id] || '▪'; }
  function itemName(id) {
    const d = itemDef(id);
    return tk((d && d.nameKey) || 'item.' + id, 'ui.item.' + id) || String(id || '');
  }
  function causeName(c) { return has('cause.' + c) ? t('cause.' + c) : t('cause.unknown'); }
  function causeIcon(c, weapon) {
    if ((c === 'weapon' || !c) && weapon) return itemIcon(weapon);
    return CAUSE_ICON[c] || '✝';
  }
  function statusName(s) { return tk('status.' + s, 'ui.status.' + s) || s; }
  function traitName(s) { return tk('trait.' + s, 'ui.trait.' + s) || s; }
  function contestantColor(tr) { return (tr && tr.color) || GM.teamColor((tr && tr.team) || 1); }

  function powersDefs() {
    const P = GM.Powers;
    return P && Array.isArray(P.defs) && P.defs.length ? P.defs : null;
  }
  function powerDef(id) {
    const P = GM.Powers;
    if (!P || !id) return null;
    if (typeof P.def === 'function') {
      try { const d = P.def(id); if (d) return d; } catch (e) { /* scan below */ }
    }
    const defs = powersDefs();
    if (defs) for (let i = 0; i < defs.length; i++) if (defs[i].id === id) return defs[i];
    return null;
  }
  function powerName(d) { return d ? t(d.nameKey || 'power.' + d.id) : ''; }
  function powerDesc(d) { return d ? tk(d.descKey || 'power.' + d.id + '.desc') : ''; }
  function optionName(o) { return o ? t(o.key || o.nameKey || 'power.opt.' + o.id) : ''; }
  function optionById(d, id) {
    if (!d || !d.options) return null;
    for (let i = 0; i < d.options.length; i++) if (d.options[i].id === id) return d.options[i];
    return null;
  }
  const CANUSE_NONE = { ok: false, reason: 'missing' };
  function canUse(id) {
    const P = GM.Powers;
    if (!P || typeof P.canUse !== 'function') return CANUSE_NONE;
    try {
      const r = P.canUse(id);
      if (r && typeof r === 'object') return r;
      return r ? { ok: true, reason: null } : { ok: false, reason: 'phase' };
    } catch (e) {
      GM.reportError('UI.canUse', e);
      return CANUSE_NONE;
    }
  }
  function cooldownLeft(id) {
    const P = GM.Powers;
    const c = P && P.cooldowns ? +P.cooldowns[id] : 0;
    return c > 0 ? c : 0;
  }
  function reasonText(id, reason) {
    if (!reason) return '';
    if (reason === 'cooldown') {
      const c = cooldownLeft(id);
      return t('ui.pow.reason.cooldown', { n: c >= 10 ? Math.ceil(c) : Math.max(0.1, Math.round(c * 10) / 10) });
    }
    if (reason === 'locked') return t('ui.pow.reason.locked', { n: GM.Career ? GM.Career.unlockLevel(id) : 1 });
    return tk('ui.pow.reason.' + reason, 'ui.pow.reason.failed');
  }
  function isSandbox() { const s = settings(); return !!(s && s.sandbox); }

  // ------------------------------------------------------------ DOM helpers
  /** Tiny element factory: h('div', {class, text, i18n, ...attrs, onclick}, [children]) */
  function h(tag, props, children) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'i18n') el.setAttribute('data-i18n', v);
        else if (k === 'tip') el.setAttribute('data-tip', v);
        else if (k === 'aria') el.setAttribute('data-i18n-aria', v);
        else if (k === 'ph') el.setAttribute('data-i18n-placeholder', v);
        else if (k === 'style') el.style.cssText = v;
        else if (k.length > 2 && k.charCodeAt(0) === 111 && k.charCodeAt(1) === 110) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const c = children[i];
        if (c == null || c === false) continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return el;
  }
  /** Write text only when it changed. */
  function txt(el, s) {
    if (!el) return;
    s = s == null ? '' : String(s);
    if (el.__t !== s) { el.__t = s; el.textContent = s; }
  }
  /** Write a style property / custom property only when it changed. */
  function css(el, prop, v) {
    if (!el) return;
    const k = '__s' + prop;
    if (el[k] !== v) { el[k] = v; el.style.setProperty(prop, v); }
  }
  /** Toggle a class only when the state changed. */
  function tog(el, c, on) {
    if (!el) return;
    on = !!on;
    const k = '__c' + c;
    if (el[k] !== on) { el[k] = on; el.classList.toggle(c, on); }
  }
  function attr(el, a, v) {
    if (!el) return;
    const k = '__a' + a;
    if (el[k] !== v) {
      el[k] = v;
      if (v == null || v === false) el.removeAttribute(a); else el.setAttribute(a, v === true ? '' : String(v));
    }
  }
  function show(el, on) {
    if (!el) return;
    on = !!on;
    if (el.__vis !== on) { el.__vis = on; el.hidden = !on; }
  }
  /** Tooltip + aria-label from an i18n key (re-translated by GM.i18n.apply). */
  function setTip(el, key, params) {
    if (!el) return;
    const p = params ? JSON.stringify(params) : null;
    if (el.__tipKey === key && el.__tipP === p) return;
    el.__tipKey = key; el.__tipP = p;
    el.setAttribute('data-tip', key);
    el.setAttribute('data-i18n-aria', key);
    if (p) el.setAttribute('data-i18n-params', p); else el.removeAttribute('data-i18n-params');
    el.setAttribute('aria-label', t(key, params));
    if (ui.tipTarget === el) ui.tipDirty = true;
  }

  // ------------------------------------------------------------- SVG icons
  const ICONS = {
    play: '<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" fill="currentColor" stroke="none"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 9a4 4 0 010 6M19 6.5a8 8 0 010 11"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 114.3 1.7c-.8.8-1.9 1.3-1.9 2.6M12 17h.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.4 3 14.6 0 18M12 3c-3 3.4-3 14.6 0 18"/>',
    exit: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    video: '<path d="M3 7h12v10H3zM15 10.5l6-3.5v10l-6-3.5"/>',
    clapper: '<path d="M4 9h16v11H4zM4 9l2.5-5 13 2.2L19 9M9 4.6L8 9M14 5.4L13 9"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
    map: '<path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5zM9 4v13.5M15 6.5V20"/>',
    crosshair: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    pin: '<path d="M12 21s-6-5.6-6-10.5a6 6 0 1112 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 8.5h.01M15.5 15.5h.01M12 12h.01M15.5 8.5h.01M8.5 15.5h.01" stroke-width="2.6"/>',
    refresh: '<path d="M20 12a8 8 0 11-2.4-5.7M20 4v5h-5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
    warning: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.2h.01"/>',
    gift: '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3.5-5.5-3-5-1s5 1 5 1zM12 7c2-3.5 5.5-3 5-1s-5 1-5 1z"/>',
    bolt: '<path d="M13 2L5 13.5h6L10 22l8-11.5h-6z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 01-8 0zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8M10 17h4"/>',
    hex: '<path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z"/><circle cx="12" cy="12" r="3"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="1"/><path d="M8 21h8M12 17v4"/>',
  };
  function svgMarkup(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }
  function svg(name, cls) {
    const s = document.createElement('span');
    s.className = 'ico' + (cls ? ' ' + cls : '');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = svgMarkup(name);
    s.__icon = name;
    return s;
  }
  function setIcon(span, name) {
    if (!span || span.__icon === name) return;
    span.__icon = name;
    span.innerHTML = svgMarkup(name);
  }
  /** Icon button with an i18n tooltip + aria label and an optional text label. */
  function ibtn(cls, icon, tipKey, onClick, labelKey) {
    const b = h('button', { type: 'button', class: 'btn ' + (cls || ''), tip: tipKey, aria: tipKey });
    if (icon) b.appendChild(svg(icon));
    if (labelKey) b.appendChild(h('span', { class: 'btn-label', i18n: labelKey }));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  // =============================================================== state
  const dom = {};
  const ui = {
    built: false,
    phase: '',
    acc: 0,
    slowAcc: 0,
    feedAcc: 0,
    sort: 'team',
    logFilter: 'all',
    logSelOnly: false,
    powCat: 'all',
    dockTab: 'powers',
    drawer: null,
    cards: [],             // roster cards indexed by contestant id
    cardsFor: null,        // contestants array the cards were built for
    order: [],             // reused sort buffer (contestant ids)
    orderKey: '',
    selId: -1,
    selSig: {},
    powBtns: [],
    powBuiltFor: null,
    logQueue: [],
    logRows: 0,
    logTopDay: -1,
    logTopHeader: null,
    killRows: [],
    anns: [],
    recapUntil: 0,
    recapData: null,
    victoryAt: 0,
    victoryShown: false,
    victoryClosed: false,
    peakViewers: 0,
    excHistory: [],
    camSig: '',
    camMode: '',
    camHintUntil: 0,
    cutUntil: 0,
    exitArmedUntil: 0,
    smiteArmedUntil: 0,
    tipTarget: null,
    tipTimer: 0,
    tipLive: false,
    popover: null,
    errCount: -1,
    shift: false,
    lastSpeed: 1,
    lastPaused: false,
    hoverTimer: 0,
  };
  /** Armed power (targeting). One reused object — the minimap reads it. */
  const tgt = {
    active: false, id: null, def: null, option: null, mode: null,
    x: 0, z: 0, hasPoint: false, radius: 0, hoverContestant: null, hintUntil: 0, hintKey: null,
  };
  const aimPt = { x: 0, y: 0, z: 0 };

  // ========================================================== misc helpers
  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC_MAP[c]; }); }
  function isTyping() {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      const p = raw ? JSON.parse(raw) : null;
      return p && typeof p === 'object' ? p : {};
    } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ count: setup.count, mix: setup.mix, opts: setup.opts }));
    } catch (e) { /* storage blocked */ }
  }
  function isMuted() { const A = GM.Audio; return !!(A && A.muted); }
  function aliveCount() {
    const a = GM.state.contestants;
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] && a[i].alive) n++;
    return n;
  }
  /** Nearest contestant to a world point (alive only when aliveOnly). */
  function nearestContestant(x, z, maxDist, aliveOnly) {
    const a = GM.state.contestants;
    let best = null, bd = maxDist * maxDist;
    for (let i = 0; i < a.length; i++) {
      const tr = a[i];
      if (!tr || !tr.pos || (aliveOnly && !tr.alive)) continue;
      const dx = tr.pos.x - x, dz = tr.pos.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = tr; }
    }
    return best;
  }
  function allianceOf(tr) {
    const AI = GM.AI;
    if (!AI || !tr) return null;
    if (typeof AI.allianceOf === 'function') {
      try { return AI.allianceOf(tr) || null; } catch (e) { return null; }
    }
    const list = AI.alliances;
    if (Array.isArray(list) && tr.allianceId != null) {
      for (let i = 0; i < list.length; i++) if (list[i].id === tr.allianceId) return list[i];
    }
    return null;
  }
  function envWeather() { const E = GM.Env; return (E && E.weather) || 'clear'; }
  function envPhaseKey() {
    const E = GM.Env;
    if (E && typeof E.phaseKey === 'function') {
      try { const k = E.phaseKey(); if (k) return k; } catch (e) { /* compute below */ }
    }
    const tod = GM.state.timeOfDay;
    if (tod < CFG.DAWN - 0.02 || tod > CFG.DUSK + 0.03) return 'tod.night';
    if (tod < CFG.DAWN + 0.05) return 'tod.dawn';
    if (tod > CFG.DUSK - 0.04) return 'tod.dusk';
    return 'tod.day';
  }
  function fmtCd(c) { return c >= 10 ? String(Math.ceil(c)) : (Math.round(c * 10) / 10).toFixed(1); }

  // ============================================================== tooltip
  function buildTooltip() {
    dom.tip = h('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' });
    dom.root.appendChild(dom.tip);
    dom.root.addEventListener('mouseover', onTipOver);
    dom.root.addEventListener('focusin', onTipOver);
    dom.root.addEventListener('mouseleave', hideTip);
    dom.root.addEventListener('focusout', function (e) { if (e.target === ui.tipTarget) hideTip(); });
    window.addEventListener('pointerdown', hideTip, true);
    window.addEventListener('wheel', hideTip, { passive: true, capture: true });
  }
  function onTipOver(e) {
    const tg = e.target;
    const el = tg && tg.closest ? tg.closest('[data-tip]') : null;
    if (el === ui.tipTarget) return;
    hideTip();
    if (!el) return;
    ui.tipTarget = el;
    ui.tipTimer = now() + (e.type === 'focusin' ? 0.1 : 0.42);
  }
  function hideTip() {
    ui.tipTarget = null;
    ui.tipLive = false;
    if (dom.tip) tog(dom.tip, 'on', false);
  }
  function renderTip() {
    const el = ui.tipTarget;
    if (!el || !el.isConnected) { hideTip(); return; }
    if (typeof el.__tipRich === 'function') {
      let html = '';
      try { html = el.__tipRich(); } catch (e) { GM.reportError('UI.tip', e); }
      if (dom.tip.__html !== html) { dom.tip.__html = html; dom.tip.__t = null; dom.tip.innerHTML = html; }
    } else {
      let params;
      const raw = el.getAttribute('data-i18n-params');
      if (raw) { try { params = JSON.parse(raw); } catch (e) { params = undefined; } }
      dom.tip.__html = null;
      txt(dom.tip, t(el.getAttribute('data-tip'), params));
    }
    ui.tipDirty = false;
  }
  function placeTip() {
    const el = ui.tipTarget;
    const r = el.getBoundingClientRect();
    const tw = dom.tip.offsetWidth, th = dom.tip.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.bottom + 8;
    if (y + th > H - 6) y = r.top - th - 8;
    if (y < 6) y = Math.min(H - th - 6, r.bottom + 8);
    x = U.clamp(x, 6, Math.max(6, W - tw - 6));
    dom.tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
  }
  function tipFrame() {
    if (!ui.tipTarget) return;
    if (!ui.tipLive) {
      if (now() < ui.tipTimer) return;
      ui.tipLive = true;
      renderTip();
      placeTip();
      tog(dom.tip, 'on', true);
    } else if (ui.tipDirty) {
      renderTip();
      placeTip();
    }
  }

  // ================================================================ toast
  function toast(key, params) {
    if (!dom.toast) return;
    txt(dom.toast, t(key, params));
    tog(dom.toast, 'on', true);
    ui.toastUntil = now() + 2.4;
  }
  function toastReason(id, reason) {
    if (!reason) reason = 'failed';
    if (reason === 'cooldown') toast('ui.pow.reason.cooldown', { n: fmtCd(cooldownLeft(id)) });
    else toast(has('ui.pow.reason.' + reason) ? 'ui.pow.reason.' + reason : 'ui.pow.reason.failed');
  }

  // ======================================================= option popover
  function buildPopover() {
    dom.pop = h('div', { class: 'popover', role: 'menu', hidden: true });
    dom.root.appendChild(dom.pop);
    document.addEventListener('pointerdown', function (e) {
      if (!ui.popover) return;
      if (dom.pop.contains(e.target)) return;
      if (ui.popover.anchor && ui.popover.anchor.contains(e.target)) return;
      closePopover();
    }, true);
  }
  function openPopover(id, anchor) {
    const d = powerDef(id);
    if (!d || !d.options || !d.options.length) return;
    if (ui.popover && ui.popover.id === id) { closePopover(); return; }
    ui.popover = { id, anchor };
    renderPopover();
    show(dom.pop, true);
    const r = anchor.getBoundingClientRect();
    const pw = dom.pop.offsetWidth, ph = dom.pop.offsetHeight;
    let x = U.clamp(r.left + r.width / 2 - pw / 2, 6, Math.max(6, window.innerWidth - pw - 6));
    let y = r.top - ph - 8;
    if (y < 6) y = r.bottom + 8;
    dom.pop.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    const first = dom.pop.querySelector('button');
    if (first) first.focus({ preventScroll: true });
    play('click');
  }
  function renderPopover() {
    const p = ui.popover;
    if (!p) return;
    const d = powerDef(p.id);
    if (!d) return;
    dom.pop.textContent = '';
    dom.pop.appendChild(h('div', { class: 'pop-head' }, [
      h('span', { class: 'pop-ico' }, [d.icon || '◆']),
      h('span', { class: 'pop-title', text: powerName(d) }),
      h('span', { class: 'pop-sub', text: t('ui.pow.choose') }),
    ]));
    const list = h('div', { class: 'pop-list' });
    for (let i = 0; i < d.options.length; i++) {
      const o = d.options[i];
      list.appendChild(h('button', {
        type: 'button', class: 'pop-opt', role: 'menuitem', 'data-opt': o.id,
        onclick: function () { chooseOption(p.id, o.id); },
      }, [h('span', { class: 'pop-oico' }, [o.icon || '•']), h('span', { class: 'pop-oname', text: optionName(o) })]));
    }
    dom.pop.appendChild(list);
  }
  function closePopover() {
    if (!ui.popover) return;
    ui.popover = null;
    show(dom.pop, false);
  }
  function chooseOption(id, optId) {
    closePopover();
    const d = powerDef(id);
    if (!d) return;
    if (!d.target || d.target === 'none') firePower(id, null, optId);
    else startTargeting(id, optId);
  }

  // ========================================================== setup screen
  const setup = {
    seed: 0,
    seedText: '',
    count: CFG.DEFAULT_CONTESTANTS,
    mix: 'balanced',
    salt: 0,
    roster: [],
    rows: [],
    opts: { sandbox: false, autoGM: false, quality: 'high', feeds: true, nameTags: true },
    pending: null,
    pendingAt: 0,
    busy: false,
    mapVer: -1,
  };

  function initSetupPrefs() {
    const p = loadPrefs();
    if (p.count) setup.count = U.clamp(p.count | 0, CFG.MIN_CONTESTANTS, CFG.MAX_CONTESTANTS);
    if (p.mix && MIXES.some(function (m) { return m.id === p.mix; })) setup.mix = p.mix;
    if (p.opts && typeof p.opts === 'object') {
      const o = setup.opts;
      if (typeof p.opts.sandbox === 'boolean') o.sandbox = p.opts.sandbox;
      if (typeof p.opts.autoGM === 'boolean') o.autoGM = p.opts.autoGM;
      if (p.opts.quality === 'low' || p.opts.quality === 'high') o.quality = p.opts.quality;
      if (typeof p.opts.feeds === 'boolean') o.feeds = p.opts.feeds;
      if (typeof p.opts.nameTags === 'boolean') o.nameTags = p.opts.nameTags;
    }
  }

  function buildSetup() {
    const root = (dom.setup = h('section', { class: 'setup', id: 'setup', 'aria-labelledby': 'setup-title', hidden: true }));
    const sheet = h('div', { class: 'setup-sheet' });

    // ---- header
    dom.setLang = h('div', { class: 'seg seg-lang', role: 'group', aria: 'setup.language' });
    ['en', 'hu'].forEach(function (l) {
      dom.setLang.appendChild(h('button', {
        type: 'button', class: 'seg-btn', 'data-lang': l, i18n: 'lang.' + l,
        onclick: function () { if (GM.i18n) GM.i18n.setLang(l); },
      }));
    });
    sheet.appendChild(h('header', { class: 'setup-head' }, [
      h('div', { class: 'setup-kicker' }, [svg('hex'), h('span', { i18n: 'setup.kicker' }), h('span', { class: 'kicker-rule' })]),
      h('h1', { class: 'brand', id: 'setup-title', i18n: 'app.title' }),
      h('p', { class: 'setup-tagline', i18n: 'setup.tagline' }),
      dom.setLang,
    ]));

    const body = h('div', { class: 'setup-body' });

    // ---- 01 arena
    dom.seedIn = h('input', {
      class: 'inp seed-in mono', id: 'seed-in', type: 'text', maxlength: 24, spellcheck: 'false',
      autocomplete: 'off', ph: 'setup.seedPh',
    });
    dom.seedIn.addEventListener('input', function () {
      setup.seedText = dom.seedIn.value;
      setup.pending = dom.seedIn.value;
      setup.pendingAt = now() + 0.7;
    });
    dom.seedIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); applySeedText(dom.seedIn.value, true); }
    });
    dom.seedIn.addEventListener('change', function () { applySeedText(dom.seedIn.value, false); });
    dom.randBtn = ibtn('btn-ghost rand-btn', 'dice', 'setup.randomTip', randomArena, 'setup.random');
    dom.setupMap = h('canvas', { class: 'setup-map', width: 240, height: 240, 'aria-hidden': 'true' });
    dom.seedVal = h('div', { class: 'seed-val mono' });
    dom.setupBusy = h('div', { class: 'setup-busy', hidden: true }, [h('span', { class: 'spinner' }), h('span', { i18n: 'setup.loading' })]);
    body.appendChild(h('section', { class: 'card s-arena' }, [
      h('h2', { class: 'card-title' }, [h('span', { class: 'idx mono' }, ['01']), h('span', { i18n: 'setup.arena' })]),
      h('div', { class: 'arena-grid' }, [
        h('div', { class: 'arena-fields' }, [
          h('label', { class: 'lbl', for: 'seed-in', i18n: 'setup.seed' }),
          h('div', { class: 'seed-row' }, [dom.seedIn, dom.randBtn]),
          h('p', { class: 'hint', i18n: 'setup.seedHint' }),
          dom.seedVal,
        ]),
        h('div', { class: 'map-frame' }, [dom.setupMap, dom.setupBusy, h('span', { class: 'map-n' }, ['N'])]),
      ]),
    ]));

    // ---- 02 contestants
    dom.countIn = h('input', {
      class: 'range', id: 'count-in', type: 'range', min: CFG.MIN_CONTESTANTS, max: CFG.MAX_CONTESTANTS, step: 1,
    });
    dom.countIn.addEventListener('input', function () { setCount(+dom.countIn.value); });
    dom.countOut = h('output', { class: 'count-out mono', for: 'count-in' });
    dom.mixSeg = h('div', { class: 'mix-seg', role: 'radiogroup', aria: 'setup.mix' });
    MIXES.forEach(function (m) {
      dom.mixSeg.appendChild(h('button', {
        type: 'button', class: 'mix-btn', 'data-mix': m.id, role: 'radio',
        onclick: function () { setMix(m.id); },
      }, [h('span', { class: 'mix-ico' }, [m.icon]), h('span', { class: 'mix-name', i18n: 'setup.mix.' + m.id })]));
    });
    dom.mixDesc = h('p', { class: 'hint mix-desc' });
    body.appendChild(h('section', { class: 'card s-contestants' }, [
      h('h2', { class: 'card-title' }, [h('span', { class: 'idx mono' }, ['02']), h('span', { i18n: 'setup.contestants' })]),
      h('div', { class: 'count-row' }, [h('label', { class: 'lbl', for: 'count-in', i18n: 'setup.count' }), dom.countOut]),
      dom.countIn,
      h('div', { class: 'lbl lbl-gap', i18n: 'setup.mix' }),
      dom.mixSeg,
      dom.mixDesc,
    ]));

    // ---- 03 roster
    dom.rosterSum = h('span', { class: 'summary mono' });
    dom.regenBtn = ibtn('btn-ghost regen-btn', 'refresh', 'setup.regenTip', function () {
      setup.salt = (setup.salt + 1) | 0;
      regenRoster(false);
      play('click');
    }, 'setup.regen');
    dom.reList = h('div', { class: 're-list' });
    dom.reHead = h('div', { class: 're-head' }, [
      h('span', { class: 're-h-d' }, ['#']), h('span', {}, ['']),
      h('span', { i18n: 'setup.name' }), h('span', { i18n: 'setup.arch' }), h('span', {}, ['']),
    ]);
    dom.noRoster = h('p', { class: 'warn', i18n: 'setup.noRoster', hidden: true });
    body.appendChild(h('section', { class: 'card s-roster' }, [
      h('div', { class: 'card-title-row' }, [
        h('h2', { class: 'card-title' }, [h('span', { class: 'idx mono' }, ['03']), h('span', { i18n: 'setup.roster' })]),
        dom.rosterSum,
        dom.regenBtn,
      ]),
      dom.reHead,
      dom.reList,
      dom.noRoster,
    ]));

    // ---- 04 options
    const qSeg = (dom.qSeg = h('div', { class: 'seg seg-sm', role: 'group', aria: 'setup.quality' }));
    ['high', 'low'].forEach(function (q) {
      qSeg.appendChild(h('button', {
        type: 'button', class: 'seg-btn', 'data-q': q, i18n: 'setup.quality.' + q,
        onclick: function () { setup.opts.quality = q; savePrefs(); syncOptions(); },
      }));
    });
    body.appendChild(h('section', { class: 'card s-options' }, [
      h('h2', { class: 'card-title' }, [h('span', { class: 'idx mono' }, ['04']), h('span', { i18n: 'setup.options' })]),
      h('div', { class: 'opt-grid' }, [
        switchRow('sandbox', 'setup.sandbox', 'setup.sandbox.desc'),
        switchRow('autoGM', 'setup.autogm', 'setup.autogm.desc'),
        switchRow('feeds', 'setup.feeds', 'setup.feeds.desc'),
        switchRow('nameTags', 'setup.nameTags', 'setup.nameTags.desc'),
        h('div', { class: 'opt opt-q' }, [
          h('span', { class: 'opt-text' }, [h('span', { class: 'opt-name', i18n: 'setup.quality' }), h('span', { class: 'opt-desc', i18n: 'setup.quality.desc' })]),
          qSeg,
        ]),
      ]),
    ]));
    sheet.appendChild(body);

    // ---- footer
    dom.startBtn = h('button', { type: 'button', class: 'start-btn', onclick: startShow }, [
      h('span', { class: 'start-glow', 'aria-hidden': 'true' }),
      h('span', { class: 'start-label', i18n: 'setup.start' }),
      h('span', { class: 'start-sub mono' }),
    ]);
    dom.startSub = dom.startBtn.lastChild;
    sheet.appendChild(h('footer', { class: 'setup-foot' }, [
      h('button', { type: 'button', class: 'btn btn-ghost help-link', onclick: toggleHelp }, [svg('help'), h('span', { class: 'btn-label', i18n: 'setup.help' })]),
      dom.startBtn,
    ]));
    root.appendChild(sheet);
    return root;
  }

  function switchRow(key, labelKey, descKey) {
    const inp = h('input', { type: 'checkbox', class: 'sw-in', role: 'switch' });
    inp.addEventListener('change', function () {
      setup.opts[key] = !!inp.checked;
      savePrefs();
      play('click');
    });
    dom['opt_' + key] = inp;
    return h('label', { class: 'opt' }, [
      h('span', { class: 'opt-text' }, [h('span', { class: 'opt-name', i18n: labelKey }), h('span', { class: 'opt-desc', i18n: descKey })]),
      inp,
      h('span', { class: 'sw', 'aria-hidden': 'true' }),
    ]);
  }

  /** Local roster fallback when GM.Contestants.generateRoster is missing. */
  function fallbackRoster(count, mix, seed) {
    const rnd = GM.makeRng((seed ^ 0x2545f491) >>> 0);
    const ids = archIds();
    const f = FALLBACK_NAMES.f.slice(), m = FALLBACK_NAMES.m.slice();
    for (let i = f.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = f[i]; f[i] = f[j]; f[j] = x; }
    for (let i = m.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const x = m[i]; m[i] = m[j]; m[j] = x; }
    const out = [];
    for (let i = 0; i < count; i++) {
      const g = i % 2 === 0 ? 'f' : 'm';
      const pool = g === 'f' ? f : m;
      const k = Math.floor(i / 2);
      out.push({
        name: pool[k % pool.length] + (k >= pool.length ? ' ' + (Math.floor(k / pool.length) + 1) : ''),
        team: k + 1, gender: g, archetype: ids[Math.floor(rnd() * ids.length)],
      });
    }
    return out;
  }
  function genRoster(count, mix, seed) {
    const T = GM.Contestants;
    if (T && typeof T.generateRoster === 'function') {
      try {
        const r = T.generateRoster(count, mix, seed);
        if (Array.isArray(r) && r.length) return r;
      } catch (e) { GM.reportError('UI.generateRoster', e); }
    }
    return fallbackRoster(count, mix, seed);
  }
  /** Rebuild the roster; rows edited by the user survive unless keepEdits === false. */
  function regenRoster(keepEdits) {
    const fresh = genRoster(setup.count, setup.mix, ((setup.seed >>> 0) ^ Math.imul(setup.salt, 0x9e3779b1)) >>> 0);
    const old = setup.roster;
    const out = [];
    for (let i = 0; i < fresh.length; i++) {
      const g = fresh[i];
      const o = old[i];
      const team = g.team || Math.floor(i / 2) + 1;
      if (keepEdits !== false && o && o.edited) {
        out.push({ name: o.name, orig: o.orig, team, gender: o.gender, archetype: o.archetype, edited: true });
      } else {
        out.push({ name: g.name, orig: g.name, team, gender: g.gender === 'm' ? 'm' : 'f', archetype: g.archetype || 'survivor', edited: false });
      }
    }
    setup.roster = out;
    renderRosterRows();
  }
  function fillArchOptions(sel) {
    const ids = archIds();
    const val = sel.value;
    sel.textContent = '';
    for (let i = 0; i < ids.length; i++) {
      const o = document.createElement('option');
      o.value = ids[i];
      o.textContent = archIcon(ids[i]) + '  ' + archName(ids[i]);
      sel.appendChild(o);
    }
    if (val) sel.value = val;
  }
  function makeRow(i) {
    const row = { i, el: null, d: null, g: null, name: null, arch: null };
    row.d = h('span', { class: 're-d mono' });
    row.g = h('button', { type: 'button', class: 're-g', tip: 'setup.gender', aria: 'setup.gender' });
    row.name = h('input', {
      type: 'text', class: 'inp re-name', maxlength: 20, spellcheck: 'false', autocomplete: 'off',
      ph: 'setup.namePh', aria: 'setup.name',
    });
    row.arch = h('select', { class: 'inp re-arch', aria: 'setup.arch' });
    const mark = h('span', { class: 're-mark', tip: 'setup.edited', 'aria-hidden': 'true' });
    row.g.addEventListener('click', function () {
      const r = setup.roster[row.i];
      if (!r) return;
      r.gender = r.gender === 'f' ? 'm' : 'f';
      r.edited = true;
      paintRow(row);
    });
    row.name.addEventListener('input', function () {
      const r = setup.roster[row.i];
      if (!r) return;
      r.name = row.name.value;
      r.edited = true;
      tog(row.el, 'edited', true);
    });
    row.name.addEventListener('blur', function () {
      const r = setup.roster[row.i];
      if (r && !String(r.name || '').trim()) { r.name = r.orig; paintRow(row); }
    });
    row.arch.addEventListener('change', function () {
      const r = setup.roster[row.i];
      if (!r) return;
      r.archetype = row.arch.value;
      r.edited = true;
      paintRow(row);
    });
    fillArchOptions(row.arch);
    row.el = h('div', { class: 're-row' }, [row.d, row.g, row.name, row.arch, mark]);
    return row;
  }
  function paintRow(row) {
    const r = setup.roster[row.i];
    if (!r) return;
    css(row.el, '--dc', GM.teamColor(r.team));
    txt(row.d, r.team);
    attr(row.d, 'title', t('common.team', { n: r.team }));
    txt(row.g, r.gender === 'f' ? '♀' : '♂');
    tog(row.g, 'm', r.gender === 'm');
    if (document.activeElement !== row.name && row.name.value !== r.name) row.name.value = r.name;
    if (row.arch.value !== r.archetype) row.arch.value = r.archetype;
    attr(row.arch, 'data-arch', r.archetype);
    tog(row.el, 'edited', !!r.edited);
  }
  function renderRosterRows() {
    const n = setup.roster.length;
    while (setup.rows.length < n) {
      const row = makeRow(setup.rows.length);
      setup.rows.push(row);
      dom.reList.appendChild(row.el);
      if (GM.i18n) GM.i18n.apply(row.el);
    }
    for (let i = 0; i < setup.rows.length; i++) {
      const row = setup.rows[i];
      show(row.el, i < n);
      if (i < n) paintRow(row);
    }
    let teams = 0;
    for (let i = 0; i < n; i++) teams = Math.max(teams, setup.roster[i].team);
    txt(dom.rosterSum, t('setup.summary', { n, d: teams }));
    txt(dom.startSub, t('setup.summary', { n, d: teams }));
    show(dom.noRoster, n < CFG.MIN_CONTESTANTS);
    tog(dom.startBtn, 'disabled', n < CFG.MIN_CONTESTANTS);
  }
  function setCount(n) {
    n = U.clamp(n | 0, CFG.MIN_CONTESTANTS, CFG.MAX_CONTESTANTS);
    if (n === setup.count && setup.roster.length === n) { txt(dom.countOut, n); return; }
    setup.count = n;
    txt(dom.countOut, n);
    if (+dom.countIn.value !== n) dom.countIn.value = String(n);
    css(dom.countIn, '--fill', pct((n - CFG.MIN_CONTESTANTS) / (CFG.MAX_CONTESTANTS - CFG.MIN_CONTESTANTS)));
    regenRoster(true);
    savePrefs();
  }
  function setMix(id) {
    if (setup.mix !== id) {
      setup.mix = id;
      regenRoster(true);
      savePrefs();
      play('click');
    }
    syncMix();
  }
  function syncMix() {
    const bs = dom.mixSeg.children;
    for (let i = 0; i < bs.length; i++) {
      const on = bs[i].getAttribute('data-mix') === setup.mix;
      tog(bs[i], 'on', on);
      attr(bs[i], 'aria-checked', on ? 'true' : 'false');
    }
    dom.mixDesc.setAttribute('data-i18n', 'setup.mix.' + setup.mix + '.desc');
    dom.mixDesc.textContent = t('setup.mix.' + setup.mix + '.desc');
  }
  function syncOptions() {
    const o = setup.opts;
    ['sandbox', 'autoGM', 'feeds', 'nameTags'].forEach(function (k) {
      const inp = dom['opt_' + k];
      if (inp) inp.checked = !!o[k];
    });
    const bs = dom.qSeg.children;
    for (let i = 0; i < bs.length; i++) tog(bs[i], 'on', bs[i].getAttribute('data-q') === o.quality);
  }
  function syncLangButtons() {
    const L = lang();
    const bs = dom.setLang.children;
    for (let i = 0; i < bs.length; i++) {
      const on = bs[i].getAttribute('data-lang') === L;
      tog(bs[i], 'on', on);
      attr(bs[i], 'aria-pressed', on ? 'true' : 'false');
    }
    if (dom.langTxt) txt(dom.langTxt, L.toUpperCase());
  }
  function syncSetup() {
    if (document.activeElement !== dom.seedIn) dom.seedIn.value = setup.seedText || String(setup.seed);
    txt(dom.seedVal, t('setup.seedValue', { n: setup.seed }));
    dom.countIn.value = String(setup.count);
    txt(dom.countOut, setup.count);
    css(dom.countIn, '--fill', pct((setup.count - CFG.MIN_CONTESTANTS) / (CFG.MAX_CONTESTANTS - CFG.MIN_CONTESTANTS)));
    syncMix();
    syncOptions();
    syncLangButtons();
    renderRosterRows();
  }
  function parseSeed(text) {
    const s = String(text == null ? '' : text).trim();
    if (!s) return null;
    if (/^\d{1,10}$/.test(s)) return (Number(s) % 4294967296) >>> 0;
    return GM.hashString(s.toLowerCase());
  }
  function applySeedText(text, immediate) {
    setup.pending = null;
    const seed = parseSeed(text);
    if (seed == null) { dom.seedIn.value = String(setup.seed); setup.seedText = ''; return; }
    setup.seedText = String(text).trim();
    if (seed === setup.seed && !(immediate && GM.state.seed >>> 0 !== seed)) return;
    previewSeed(seed);
  }
  function randomArena() {
    const seed = GM.randomSeed();
    setup.seedText = String(seed);
    dom.seedIn.value = setup.seedText;
    previewSeed(seed);
    play('click');
  }
  /** Regenerate the preview arena (deferred one frame so the "building" note paints). */
  function previewSeed(seed) {
    setup.seed = seed >>> 0;
    setup.busy = true;
    show(dom.setupBusy, true);
    tog(dom.startBtn, 'busy', true);
    txt(dom.seedVal, t('setup.seedValue', { n: setup.seed }));
    regenRoster(true);
    setTimeout(function () {
      try {
        if (GM.Game && GM.Game.previewArena && GM.state.phase === 'setup') GM.Game.previewArena(setup.seed);
      } catch (e) { GM.reportError('UI.previewArena', e); }
      setup.busy = false;
      show(dom.setupBusy, false);
      tog(dom.startBtn, 'busy', false);
    }, 40);
  }
  function startShow() {
    if (setup.busy || GM.state.phase !== 'setup') return;
    const G = GM.Game;
    if (!G || typeof G.newGame !== 'function') return;
    if (setup.pending != null) applySeedText(setup.pending, true);
    const roster = [];
    for (let i = 0; i < setup.roster.length; i++) {
      const r = setup.roster[i];
      const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 20) || r.orig || '#' + (i + 1);
      roster.push({ name, team: r.team, gender: r.gender, archetype: r.archetype });
    }
    const o = setup.opts;
    const s = {
      seed: setup.seed >>> 0,
      contestantCount: roster.length,
      mix: setup.mix,
      roster: roster.length >= CFG.MIN_CONTESTANTS ? roster : null,
      sandbox: !!o.sandbox,
      autoGM: !!o.autoGM,
      quality: o.quality === 'low' ? 'low' : 'high',
      feeds: !!o.feeds,
      nameTags: !!o.nameTags,
      startSpeed: 1,
      arena: GM.Arenas ? GM.Arenas.selected() : 'verdant',
    };
    savePrefs();
    const A = GM.Audio;
    if (A && typeof A.unlock === 'function') { try { A.unlock(); } catch (e) { GM.reportError('UI.audioUnlock', e); } }
    try { G.newGame(s); } catch (e) { GM.reportError('UI.newGame', e); }
    const AG = GM.AutoGM;
    if (AG && typeof AG.setEnabled === 'function') { try { AG.setEnabled(!!s.autoGM); } catch (e) { /* optional */ } }
  }
  /** Draw the arena thumbnail from the minimap's terrain image. */
  function drawSetupMap() {
    const M = GM.Minimap;
    if (!M || typeof M.terrainImage !== 'function') return;
    const ver = M.version || 0;
    if (ver === setup.mapVer) return;
    const img = M.terrainImage();
    if (!img) return;
    setup.mapVer = ver;
    const cv = dom.setupMap;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(120, Math.round((cv.clientWidth || 240) * dpr));
    if (cv.width !== size) { cv.width = size; cv.height = size; }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    g.clip();
    g.imageSmoothingEnabled = true;
    g.drawImage(img, 0, 0, size, size);
    const view = (M.viewHalf || CFG.MAP_SIZE / 2);
    const k = size / (view * 2);
    // force field ring + pedestal ring + nexus
    g.strokeStyle = 'rgba(120,220,255,0.85)';
    g.lineWidth = Math.max(1, dpr * 1.2);
    g.beginPath();
    g.arc(size / 2, size / 2, CFG.ARENA_RADIUS * k, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,215,120,0.55)';
    g.setLineDash([2 * dpr, 3 * dpr]);
    g.beginPath();
    g.arc(size / 2, size / 2, CFG.PEDESTAL_RADIUS * k, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = '#f2c14e';
    g.beginPath();
    g.arc(size / 2, size / 2, Math.max(2, 3 * dpr), 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function setupFrame() {
    if (setup.pending != null && now() >= setup.pendingAt && document.activeElement !== dom.seedIn) {
      applySeedText(setup.pending, false);
    } else if (setup.pending != null && now() >= setup.pendingAt + 0.8) {
      applySeedText(setup.pending, false);
    }
    drawSetupMap();
  }

  // ============================================================= HUD build
  function buildTopbar() {
    const tb = (dom.topbar = h('header', { class: 'topbar' }));
    dom.btnLeft = ibtn('btn-icon drawer-btn drawer-left-btn', 'list', 'ui.top.roster', function () {
      openDrawer(ui.drawer === 'left' ? null : 'left');
    });
    const brand = h('div', { class: 'brand-mini' }, [svg('hex', 'brand-ico'), h('span', { class: 'brand-name', i18n: 'app.title' })]);

    dom.todIco = h('span', { class: 'chip-ico' });
    dom.dayTxt = h('span', { class: 'chip-main' });
    dom.clockTxt = h('span', { class: 'chip-sub mono' });
    const day = h('div', { class: 'chip chip-day', tip: 'ui.top.dayTip' }, [dom.todIco, h('span', { class: 'chip-stack' }, [dom.dayTxt, dom.clockTxt])]);

    dom.wxIco = h('span', { class: 'chip-ico' });
    dom.wxTxt = h('span', { class: 'chip-main' });
    const wx = h('div', { class: 'chip chip-wx', tip: 'ui.top.weatherTip' }, [dom.wxIco, h('span', { class: 'chip-stack' }, [h('span', { class: 'chip-lbl', i18n: 'ui.top.weatherTip' }), dom.wxTxt])]);

    dom.aliveTxt = h('span', { class: 'chip-big mono' });
    dom.aliveTot = h('span', { class: 'chip-sub mono' });
    const alive = h('div', { class: 'chip chip-alive', tip: 'ui.top.aliveTip' }, [
      h('span', { class: 'chip-stack' }, [h('span', { class: 'chip-lbl', i18n: 'ui.top.alive' }), h('span', { class: 'alive-row' }, [dom.aliveTxt, dom.aliveTot])]),
    ]);

    dom.viewTxt = h('span', { class: 'chip-main mono' });
    dom.excFill = h('span', { class: 'meter-fill' });
    dom.excTxt = h('span', { class: 'meter-val mono' });
    dom.spark = h('canvas', { class: 'spark', width: 72, height: 20, 'aria-hidden': 'true' });
    dom.audChip = h('div', { class: 'chip chip-aud', tip: 'ui.top.excitementTip' }, [
      h('span', { class: 'chip-stack' }, [h('span', { class: 'chip-lbl', i18n: 'ui.top.viewers' }), dom.viewTxt]),
      h('span', { class: 'chip-stack exc' }, [
        h('span', { class: 'chip-lbl' }, [h('span', { i18n: 'ui.top.excitement' }), dom.excTxt]),
        h('span', { class: 'meter' }, [dom.excFill]),
      ]),
      dom.spark,
    ]);

    dom.enFill = h('span', { class: 'meter-fill' });
    dom.enTxt = h('span', { class: 'meter-val mono' });
    dom.enChip = h('div', { class: 'chip chip-energy', tip: 'ui.top.energyTip' }, [
      svg('bolt', 'chip-bolt'),
      h('span', { class: 'chip-stack' }, [
        h('span', { class: 'chip-lbl' }, [h('span', { class: 'en-lbl', i18n: 'ui.top.energy' }), dom.enTxt]),
        h('span', { class: 'meter meter-energy' }, [dom.enFill]),
      ]),
    ]);

    dom.pauseBtn = ibtn('btn-icon pause-btn', 'pause', 'ui.top.pause', function () {
      if (GM.Game && isGamePhase(GM.state.phase)) GM.Game.togglePause();
    });
    dom.speedBtns = [];
    const speed = h('div', { class: 'speed', role: 'group', aria: 'ui.top.speed' }, [dom.pauseBtn]);
    CFG.SPEEDS.forEach(function (sp) {
      const b = h('button', { type: 'button', class: 'spd mono', 'data-speed': sp, text: (sp === 0.5 ? '½' : String(sp)) + '×' });
      setTip(b, 'ui.top.speedX', { n: sp });
      b.addEventListener('click', function () {
        if (!GM.Game) return;
        GM.Game.setSpeed(sp);
        if (GM.state.paused) GM.Game.togglePause(false);
        refreshSpeed();
      });
      dom.speedBtns.push(b);
      speed.appendChild(b);
    });

    dom.errTxt = h('span', { class: 'mono' });
    dom.errBadge = h('button', { type: 'button', class: 'err-badge', hidden: true, onclick: function () { toggleOverlay('errors'); } }, [svg('warning'), dom.errTxt]);
    setTip(dom.errBadge, 'ui.top.errorsTip');
    dom.langTxt = h('span', { class: 'lang-code mono' });
    dom.langBtn = h('button', { type: 'button', class: 'btn btn-icon lang-btn', onclick: function () { if (GM.i18n) GM.i18n.toggle(); } }, [svg('globe'), dom.langTxt]);
    setTip(dom.langBtn, 'ui.top.lang');
    dom.muteBtn = ibtn('btn-icon mute-btn', 'sound', 'ui.top.mute', toggleMute);
    dom.helpBtn = ibtn('btn-icon', 'help', 'ui.top.help', toggleHelp);
    dom.resultsBtn = ibtn('btn-icon results-btn', 'trophy', 'ui.results', function () { showVictory(); });
    dom.resultsBtn.hidden = true;
    dom.exitBtn = ibtn('btn-icon exit-btn', 'exit', 'ui.top.exit', onExit);
    dom.btnRight = ibtn('btn-icon drawer-btn drawer-right-btn', 'grid', 'ui.top.monitors', function () {
      openDrawer(ui.drawer === 'right' ? null : 'right');
    });

    tb.appendChild(h('div', { class: 'tb-left' }, [dom.btnLeft, brand]));
    tb.appendChild(h('div', { class: 'tb-stats' }, [day, wx, alive, dom.audChip, dom.enChip]));
    tb.appendChild(h('div', { class: 'tb-right' }, [speed, dom.errBadge, dom.resultsBtn, dom.langBtn, dom.muteBtn, dom.helpBtn, dom.exitBtn, dom.btnRight]));
    return tb;
  }

  function buildRosterPanel() {
    const p = (dom.left = h('aside', { class: 'panel panel-left', id: 'roster-panel' }));
    dom.rosterCount = h('span', { class: 'panel-count mono' });
    dom.sortSeg = h('div', { class: 'seg seg-xs sort-seg', role: 'group', aria: 'ui.roster.sort' });
    SORTS.forEach(function (s) {
      dom.sortSeg.appendChild(h('button', { type: 'button', class: 'seg-btn', 'data-sort': s, i18n: 'ui.sort.' + s, onclick: function () { setSort(s); } }));
    });
    dom.rosterList = h('div', { class: 'roster-list', role: 'list' });
    dom.rosterEmpty = h('p', { class: 'empty', i18n: 'ui.roster.empty' });
    p.appendChild(h('div', { class: 'panel-head' }, [h('h2', { class: 'panel-title', i18n: 'ui.roster.title' }), dom.rosterCount]));
    p.appendChild(h('div', { class: 'panel-tools' }, [h('span', { class: 'lbl', i18n: 'ui.roster.sort' }), dom.sortSeg]));
    p.appendChild(dom.rosterList);
    p.appendChild(dom.rosterEmpty);
    dom.rosterList.addEventListener('click', function (e) {
      const el = e.target.closest ? e.target.closest('.tcard') : null;
      if (el) pickContestant(+el.getAttribute('data-id'));
    });
    dom.rosterList.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const el = e.target.closest ? e.target.closest('.tcard') : null;
      if (el) { e.preventDefault(); pickContestant(+el.getAttribute('data-id')); }
    });
    dom.rosterList.addEventListener('mouseover', function (e) {
      const el = e.target.closest ? e.target.closest('.tcard') : null;
      UI.hoverId = el ? +el.getAttribute('data-id') : null;
    });
    dom.rosterList.addEventListener('mouseleave', function () { UI.hoverId = null; });
    return p;
  }

  function buildViewport() {
    const vp = (dom.viewport = h('div', { id: 'viewport', class: 'viewport' }));
    vp.appendChild(h('div', { class: 'vp-frame', 'aria-hidden': 'true' }, [
      h('span', { class: 'vc tl' }), h('span', { class: 'vc tr' }), h('span', { class: 'vc bl' }), h('span', { class: 'vc br' }),
      h('span', { class: 'vp-cross' }),
    ]));
    // camera HUD
    dom.camName = h('span', { class: 'cam-name mono' });
    dom.camMode = h('span', { class: 'cam-mode mono' });
    dom.camLabel = h('div', { class: 'cam-label' });
    dom.camTime = h('div', { class: 'cam-time mono' });
    dom.camHud = h('div', { class: 'cam-hud' }, [
      h('div', { class: 'cam-line' }, [h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), h('span', { class: 'rec-txt mono', i18n: 'ui.cam.rec' }), dom.camName, dom.camMode]),
      dom.camLabel,
      dom.camTime,
    ]);
    vp.appendChild(dom.camHud);
    dom.camBtns = {};
    const cams = h('div', { class: 'cam-modes', role: 'group' });
    CAM_MODES.forEach(function (m) {
      const b = ibtn('btn-icon cam-btn', m.icon, 'ui.cam.btn.' + m.id, function () {
        const C = GM.Cameras;
        if (!C) return;
        if (m.id === 'follow') {
          const sel = GM.selected();
          const id = sel && sel.alive ? sel.id : (C.subjectId && C.subjectId());
          if (id != null && C.follow) { C.follow(id); return; }
          const a = GM.state.contestants;
          for (let i = 0; i < a.length; i++) if (a[i] && a[i].alive) { if (C.follow) C.follow(a[i].id); return; }
          return;
        }
        if (C.setMode) C.setMode(m.id);
      });
      b.setAttribute('data-mode', m.id);
      dom.camBtns[m.id] = b;
      cams.appendChild(b);
    });
    vp.appendChild(cams);
    dom.camHint = h('div', { class: 'cam-hint', hidden: true });
    vp.appendChild(dom.camHint);

    dom.killfeed = h('div', { class: 'killfeed', 'aria-live': 'polite' });
    vp.appendChild(dom.killfeed);
    dom.annStack = h('div', { class: 'ann-stack', 'aria-live': 'assertive' });
    vp.appendChild(dom.annStack);

    dom.cdNum = h('div', { class: 'cd-num mono' });
    dom.cd = h('div', { class: 'countdown', hidden: true }, [h('div', { class: 'cd-title', i18n: 'ui.cd.title' }), dom.cdNum, h('div', { class: 'cd-ring', 'aria-hidden': 'true' })]);
    vp.appendChild(dom.cd);

    dom.paused = h('div', { class: 'paused-badge', hidden: true }, [svg('pause'), h('span', { class: 'pb-t', i18n: 'ui.paused' }), h('span', { class: 'pb-h', i18n: 'ui.pausedHint' })]);
    vp.appendChild(dom.paused);

    dom.tgtIco = h('span', { class: 'th-ico' });
    dom.tgtName = h('span', { class: 'th-name' });
    dom.tgtText = h('span', { class: 'th-text' });
    dom.tgtCancel = h('span', { class: 'th-cancel', i18n: 'ui.target.cancel' });
    dom.tgtHint = h('div', { class: 'target-hint', hidden: true }, [
      dom.tgtIco, h('span', { class: 'th-body' }, [dom.tgtName, dom.tgtText]), dom.tgtCancel,
      h('button', { type: 'button', class: 'th-x', onclick: function () { cancelTargeting(); } }, [svg('close')]),
    ]);
    setTip(dom.tgtHint.lastChild, 'common.cancel');
    vp.appendChild(dom.tgtHint);

    dom.toast = h('div', { class: 'toast', role: 'status' });
    vp.appendChild(dom.toast);

    dom.recap = h('div', { class: 'recap', hidden: true, onclick: function () { hideRecap(); } });
    vp.appendChild(dom.recap);
    return vp;
  }

  function buildDock() {
    const dock = (dom.dock = h('div', { class: 'dock', 'data-tab': ui.dockTab }));
    dom.dockTabs = {};
    const tabs = h('div', { class: 'dock-tabs', role: 'tablist' });
    [['powers', 'bolt', 'ui.dock.powers'], ['contestant', 'user', 'ui.dock.contestant'], ['log', 'list', 'ui.dock.log']].forEach(function (d) {
      const b = h('button', { type: 'button', class: 'dock-tab', role: 'tab', 'data-tab': d[0], onclick: function () {
        if (ui.dockTab === d[0]) tog(dom.dock, 'min', !dom.dock.classList.contains('min'));
        else { tog(dom.dock, 'min', false); setDockTab(d[0]); }
      } }, [svg(d[1]), h('span', { i18n: d[2] }), h('span', { class: 'dt-badge', hidden: true })]);
      dom.dockTabs[d[0]] = b;
      tabs.appendChild(b);
    });
    dock.appendChild(tabs);
    const panes = h('div', { class: 'dock-panes' }, [buildPowersPane(), buildContestantPane(), buildLogPane()]);
    dock.appendChild(panes);
    return dock;
  }

  function buildPowersPane() {
    const p = (dom.panePowers = h('section', { class: 'pane pane-powers', 'data-pane': 'powers', role: 'tabpanel' }));
    dom.pEnFill = h('span', { class: 'meter-fill' });
    dom.pEnTxt = h('span', { class: 'mono pen-txt' });
    dom.autoBtn = h('button', { type: 'button', class: 'auto-btn', onclick: toggleAssistant }, [h('span', { class: 'auto-led' }), h('span', { i18n: 'ui.pow.assistant' })]);
    setTip(dom.autoBtn, 'ui.pow.assistantTip');
    const en = h('div', { class: 'pen' }, [svg('bolt'), h('span', { class: 'meter meter-energy' }, [dom.pEnFill]), dom.pEnTxt]);
    setTip(en, 'ui.pow.energyTip');
    p.appendChild(h('div', { class: 'pane-head' }, [h('h2', { class: 'pane-title', i18n: 'ui.pow.title' }), en, dom.autoBtn]));
    dom.powTabs = h('div', { class: 'seg seg-xs pow-tabs', role: 'group' });
    POWER_CATS.forEach(function (c) {
      dom.powTabs.appendChild(h('button', { type: 'button', class: 'seg-btn', 'data-cat': c.id, onclick: function () { setPowCat(c.id); } }, [
        h('span', { class: 'pc-ico' }, [c.icon]), h('span', { class: 'pc-name', i18n: 'ui.pow.cat.' + c.id }),
      ]));
    });
    p.appendChild(dom.powTabs);
    dom.powGrid = h('div', { class: 'pow-grid', 'data-cat': ui.powCat });
    dom.powEmpty = h('p', { class: 'empty', i18n: 'ui.pow.unavailable', hidden: true });
    p.appendChild(dom.powGrid);
    p.appendChild(dom.powEmpty);
    return p;
  }

  function makeBar(k, labelKey, tipKey) {
    const fill = h('span', { class: 'bar-fill' });
    const val = h('span', { class: 'bar-val mono' });
    const el = h('div', { class: 'bar bar-' + k }, [h('span', { class: 'bar-lbl', i18n: labelKey }), h('span', { class: 'bar-track' }, [fill]), val]);
    setTip(el, tipKey);
    return { el, fill, val };
  }

  function buildContestantPane() {
    const p = (dom.paneContestant = h('section', { class: 'pane pane-contestant', 'data-pane': 'contestant', role: 'tabpanel' }));
    dom.selEmpty = h('div', { class: 'sel-empty' }, [svg('user', 'big'), h('p', { class: 'se-t', i18n: 'ui.sel.none' }), h('p', { class: 'se-h', i18n: 'ui.sel.noneSub' })]);
    const s = (dom.sel = h('div', { class: 'sel', hidden: true }));
    dom.selSw = h('span', { class: 'sel-sw mono' });
    dom.selName = h('h3', { class: 'sel-name' });
    dom.selSub = h('div', { class: 'sel-sub' });
    dom.selFollow = ibtn('btn-icon sel-follow', 'video', 'ui.sel.follow', function () {
      const tr = GM.selected();
      const C = GM.Cameras;
      if (!tr || !C) return;
      const st = C.status ? C.status() : null;
      if (st && st.mode === 'follow' && st.followId === tr.id) { if (C.setMode) C.setMode('director'); }
      else if (C.follow) C.follow(tr.id);
    });
    dom.selGift = ibtn('btn-icon sel-gift', 'gift', 'ui.sel.gift', function () {
      const tr = GM.selected();
      if (tr && tr.alive) usePowerOn('sponsor_gift', tr);
    });
    dom.selSmite = ibtn('btn-icon sel-smite', 'bolt', 'ui.sel.smite', function () {
      const tr = GM.selected();
      if (!tr || !tr.alive) return;
      if (now() < ui.smiteArmedUntil) { ui.smiteArmedUntil = 0; usePowerOn('smite', tr); }
      else {
        const cu = canUse('smite');
        if (!cu.ok) { toastReason('smite', cu.reason); return; }
        ui.smiteArmedUntil = now() + 3;
        toast('ui.sel.smiteConfirm');
      }
    });
    dom.selClose = ibtn('btn-icon sel-close', 'close', 'ui.sel.close', function () { GM.select(null); });
    s.appendChild(h('div', { class: 'sel-head' }, [
      dom.selSw,
      h('div', { class: 'sel-id' }, [dom.selName, dom.selSub]),
      h('div', { class: 'sel-actions' }, [dom.selFollow, dom.selGift, dom.selSmite, dom.selClose]),
    ]));
    dom.selMoodIco = h('span', { class: 'sm-ico' });
    dom.selMood = h('span', { class: 'sm-mood' });
    dom.selActIco = h('span', { class: 'sm-act' });
    dom.selThought = h('span', { class: 'sm-thought' });
    s.appendChild(h('div', { class: 'sel-mind' }, [
      h('div', { class: 'sm-left' }, [dom.selMoodIco, dom.selMood]),
      h('div', { class: 'sm-bubble' }, [h('span', { class: 'sm-lbl', i18n: 'ui.sel.thinks' }), h('span', { class: 'sm-row' }, [dom.selActIco, dom.selThought])]),
    ]));
    dom.selDead = h('div', { class: 'sel-dead', hidden: true });
    s.appendChild(dom.selDead);
    dom.selBars = {
      health: makeBar('health', 'ui.sel.health', 'ui.sel.healthTip'),
      stamina: makeBar('stamina', 'ui.sel.stamina', 'ui.sel.staminaTip'),
      food: makeBar('food', 'ui.sel.food', 'ui.sel.foodTip'),
      water: makeBar('water', 'ui.sel.water', 'ui.sel.waterTip'),
      rest: makeBar('rest', 'ui.sel.rest', 'ui.sel.restTip'),
    };
    dom.selEmo = {};
    EMOTIONS.forEach(function (k) { dom.selEmo[k] = makeBar(k, 'ui.emo.' + k, 'ui.emo.' + k + 'Tip'); });
    const bodyCol = h('div', { class: 'sel-col' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.body' })]);
    for (const k in dom.selBars) bodyCol.appendChild(dom.selBars[k].el);
    const mindCol = h('div', { class: 'sel-col' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.mind' })]);
    EMOTIONS.forEach(function (k) { mindCol.appendChild(dom.selEmo[k].el); });
    s.appendChild(h('div', { class: 'sel-cols' }, [bodyCol, mindCol]));
    dom.selKills = h('b', { class: 'mono' });
    dom.selDmg = h('b', { class: 'mono' });
    dom.selPop = h('b', { class: 'mono' });
    s.appendChild(h('div', { class: 'sel-stats' }, [
      h('div', { class: 'stat' }, [h('span', { class: 'stat-l', i18n: 'ui.sel.kills' }), dom.selKills]),
      h('div', { class: 'stat' }, [h('span', { class: 'stat-l', i18n: 'ui.sel.damage' }), dom.selDmg]),
      h('div', { class: 'stat' }, [h('span', { class: 'stat-l', i18n: 'ui.sel.popularity' }), dom.selPop]),
    ]));
    dom.selGear = h('div', { class: 'chips' });
    dom.selFx = h('div', { class: 'chips' });
    dom.selAllies = h('div', { class: 'chips' });
    dom.selTraits = h('div', { class: 'traits' });
    s.appendChild(h('div', { class: 'sel-sec' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.gear' }), dom.selGear]));
    s.appendChild(h('div', { class: 'sel-sec' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.effects' }), dom.selFx]));
    s.appendChild(h('div', { class: 'sel-sec' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.allies' }), dom.selAllies]));
    s.appendChild(h('div', { class: 'sel-sec' }, [h('h4', { class: 'sec-t', i18n: 'ui.sel.traits' }), dom.selTraits]));
    dom.selDesc = h('p', { class: 'sel-desc' });
    s.appendChild(dom.selDesc);
    dom.selAllies.addEventListener('click', function (e) {
      const el = e.target.closest ? e.target.closest('[data-id]') : null;
      if (el) pickContestant(+el.getAttribute('data-id'));
    });
    p.appendChild(dom.selEmpty);
    p.appendChild(s);
    return p;
  }

  function buildLogPane() {
    const p = (dom.paneLog = h('section', { class: 'pane pane-log', 'data-pane': 'log', role: 'tabpanel' }));
    dom.logSeg = h('div', { class: 'seg seg-xs log-seg', role: 'group' });
    LOG_FILTERS.forEach(function (f) {
      dom.logSeg.appendChild(h('button', { type: 'button', class: 'seg-btn', 'data-f': f, i18n: 'ui.log.f.' + f, onclick: function () { setLogFilter(f); } }));
    });
    dom.logSel = ibtn('btn-icon log-sel', 'user', 'ui.log.selOnly', function () {
      ui.logSelOnly = !ui.logSelOnly;
      applyLogSel();
    });
    p.appendChild(h('div', { class: 'pane-head' }, [h('h2', { class: 'pane-title', i18n: 'ui.log.title' }), dom.logSeg, dom.logSel]));
    dom.logList = h('div', { class: 'log-list', 'data-filter': ui.logFilter, role: 'log' });
    dom.logEmpty = h('p', { class: 'empty', i18n: 'ui.log.empty' });
    p.appendChild(dom.logList);
    p.appendChild(dom.logEmpty);
    dom.logList.addEventListener('click', function (e) {
      const row = e.target.closest ? e.target.closest('.lrow') : null;
      if (!row || !row.__e) return;
      const en = row.__e;
      if (en.pos && GM.Cameras && GM.Cameras.focus) GM.Cameras.focus(en.pos);
      else if (en.contestantIds && en.contestantIds.length) {
        const tr = contestantById(en.contestantIds[0]);
        if (tr && tr.pos && GM.Cameras && GM.Cameras.focus) GM.Cameras.focus(tr.pos);
      }
    });
    return p;
  }

  function buildMonitors() {
    const p = (dom.right = h('aside', { class: 'panel panel-right', id: 'monitors' }));
    dom.mm = h('canvas', { id: 'minimap', class: 'minimap', width: 300, height: 300 });
    dom.mmTitle = h('span', { class: 'mm-title', i18n: 'minimap.title' });
    p.appendChild(h('div', { class: 'mod mod-map' }, [
      h('div', { class: 'mod-head' }, [svg('map'), dom.mmTitle, h('span', { class: 'mm-coords mono' })]),
      h('div', { class: 'mm-wrap' }, [dom.mm, h('span', { class: 'mm-n mono' }, ['N'])]),
    ]));
    dom.mmCoords = p.querySelector('.mm-coords');
    dom.feedToggle = ibtn('btn-icon feed-toggle', 'tv', 'feed.toggle', toggleFeeds);
    p.appendChild(h('div', { class: 'mod mod-feeds-head' }, [
      h('div', { class: 'mod-head' }, [svg('video'), h('span', { i18n: 'feed.title' }), dom.feedToggle]),
    ]));
    dom.feeds = [];
    const box = (dom.feedBox = h('div', { class: 'feeds' }));
    for (let i = 0; i < 3; i++) {
      const name = h('span', { class: 'fd-name mono' });
      const label = h('span', { class: 'fd-label' });
      const nosig = h('div', { class: 'fd-nosig' }, [h('span', { class: 'mono', i18n: 'feed.noSignal' })]);
      const slot = h('div', { class: 'feed-slot', 'data-feed': i, role: 'button', tabindex: '0' }, [
        h('div', { class: 'fd-top' }, [h('span', { class: 'rec-dot' }), h('span', { class: 'fd-rec mono', i18n: 'feed.rec' }), name]),
        h('div', { class: 'fd-bottom' }, [label]),
        h('span', { class: 'fc tl' }), h('span', { class: 'fc tr' }), h('span', { class: 'fc bl' }), h('span', { class: 'fc br' }),
        nosig,
      ]);
      setTip(slot, 'feed.watch');
      slot.addEventListener('click', function () { takeFeed(i); });
      slot.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); takeFeed(i); } });
      dom.feeds.push({ slot, name, label, nosig, sig: '' });
      box.appendChild(slot);
    }
    p.appendChild(box);
    dom.feedOff = h('div', { class: 'mod feed-off', hidden: true }, [svg('tv', 'big'), h('span', { i18n: 'feed.off' })]);
    p.appendChild(dom.feedOff);
    p.appendChild(h('div', { class: 'mod mod-fill' }));
    return p;
  }

  function buildOverlays() {
    // help
    dom.help = h('div', { class: 'overlay ov-help', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'help-title' });
    const kb = function (keys, label) {
      return h('div', { class: 'krow' }, [h('span', { class: 'kkeys' }, keys.map(function (k) {
        return typeof k === 'string' && k.indexOf('help.') === 0 ? h('kbd', { i18n: k }) : h('kbd', {}, [k]);
      })), h('span', { class: 'klbl', i18n: label })]);
    };
    dom.helpPowers = h('div', { class: 'help-powers' });
    const card = h('div', { class: 'ov-card help-card' }, [
      h('div', { class: 'ov-head' }, [svg('help'), h('h2', { id: 'help-title', i18n: 'help.title' }),
        h('button', { type: 'button', class: 'btn btn-icon ov-x', onclick: hideHelp, tip: 'common.close', aria: 'common.close' }, [svg('close')])]),
      h('div', { class: 'ov-body help-body' }, [
        h('p', { class: 'help-intro', i18n: 'help.intro' }),
        h('div', { class: 'help-cols' }, [
          h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.camera' }),
            kb(['W', 'A', 'S', 'D', 'help.key.arrows'], 'help.k.move'),
            kb(['Q', 'E'], 'help.k.updown'),
            kb(['Shift'], 'help.k.fast'),
            kb(['help.key.drag'], 'help.k.look'),
            kb(['help.key.wheel'], 'help.k.zoom'),
            kb(['1', '2', '3', '4'], 'help.k.modes'),
            kb(['C'], 'help.k.cycle'),
            kb(['F'], 'help.k.follow'),
          ]),
          h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.game' }),
            kb(['help.key.space'], 'help.k.pause'),
            kb(['+', '−'], 'help.k.speed'),
            kb(['Tab', 'Shift+Tab'], 'help.k.tab'),
            kb(['help.key.click'], 'help.k.click'),
            kb(['Esc'], 'help.k.esc'),
            kb(['P'], 'help.k.powers'),
            kb(['N'], 'help.k.tags'),
            kb(['M'], 'help.k.mute'),
            kb(['L'], 'help.k.lang'),
            kb(['H', '?'], 'help.k.help'),
          ]),
        ]),
        h('div', { class: 'help-cols' }, [
          h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.aim' }), h('p', { i18n: 'help.aimText' })]),
          h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.contestants' }), h('p', { i18n: 'help.contestantsText' })]),
          h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.audience' }), h('p', { i18n: 'help.audienceText' })]),
        ]),
        h('section', { class: 'help-sec' }, [h('h3', { i18n: 'help.powers' }), h('p', { i18n: 'help.powersIntro' }), dom.helpPowers]),
        h('p', { class: 'help-tip' }, [svg('warning'), h('span', { i18n: 'help.tip' })]),
      ]),
    ]);
    dom.help.appendChild(card);
    dom.help.addEventListener('click', function (e) { if (e.target === dom.help) hideHelp(); });

    // victory
    dom.victory = h('div', { class: 'overlay ov-victory', hidden: true, role: 'dialog', 'aria-modal': 'true' });
    dom.victory.addEventListener('click', function (e) {
      const b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      const act = b.getAttribute('data-act');
      if (act === 'new') { hideVictory(); if (GM.Game && GM.Game.toSetup) GM.Game.toSetup(); }
      else if (act === 'watch') { ui.victoryClosed = true; hideVictory(); }
      else if (act === 'focus') {
        const id = +b.getAttribute('data-id');
        ui.victoryClosed = true;
        hideVictory();
        pickContestant(id);
      }
    });

    // errors
    dom.errList = h('div', { class: 'err-list mono' });
    dom.errors = h('div', { class: 'overlay ov-errors', hidden: true, role: 'dialog' }, [
      h('div', { class: 'ov-card err-card' }, [
        h('div', { class: 'ov-head' }, [svg('warning'), h('h2', { i18n: 'ui.err.title' }),
          h('button', { type: 'button', class: 'btn btn-icon ov-x', onclick: function () { toggleOverlay('errors', false); }, tip: 'common.close', aria: 'common.close' }, [svg('close')])]),
        h('div', { class: 'ov-body' }, [h('p', { class: 'hint', i18n: 'ui.err.hint' }), dom.errList]),
      ]),
    ]);
    dom.errors.addEventListener('click', function (e) { if (e.target === dom.errors) toggleOverlay('errors', false); });
    return [dom.help, dom.victory, dom.errors];
  }

  function buildAll() {
    const root = (dom.root = document.getElementById('ui-root') || document.body.appendChild(h('div', { id: 'ui-root' })));
    root.textContent = '';
    root.setAttribute('data-phase', 'boot');
    root.appendChild(buildSetup());
    const hud = (dom.hud = h('div', { class: 'hud', hidden: true }));
    hud.appendChild(buildTopbar());
    const center = h('main', { class: 'center' }, [buildViewport(), buildDock()]);
    hud.appendChild(h('div', { class: 'layout' }, [buildRosterPanel(), center, buildMonitors()]));
    dom.scrim = h('div', { class: 'scrim', onclick: function () { openDrawer(null); } });
    hud.appendChild(dom.scrim);
    root.appendChild(hud);
    const ovs = buildOverlays();
    for (let i = 0; i < ovs.length; i++) root.appendChild(ovs[i]);
    buildTooltip();
    buildPopover();
    if (GM.i18n) GM.i18n.apply(root);
    ui.built = true;
  }

  // ========================================================= roster panel
  function makeCard(tr) {
    const c = { id: tr.id, el: null, name: null, arch: null, hp: null, act: null, kills: null, info: null, dead: null };
    c.name = h('span', { class: 'tc-name' });
    c.arch = h('span', { class: 'tc-arch' });
    c.hp = h('span', { class: 'tc-hp-fill' });
    c.act = h('span', { class: 'tc-act' });
    c.kills = h('span', { class: 'tc-k mono' });
    c.info = h('span', { class: 'tc-info' });
    c.el = h('div', { class: 'tcard', role: 'listitem', tabindex: '0', 'data-id': tr.id }, [
      h('span', { class: 'tc-d mono' }, [String(tr.team)]),
      h('span', { class: 'tc-main' }, [
        h('span', { class: 'tc-top' }, [c.name, c.arch]),
        h('span', { class: 'tc-hp' }, [c.hp]),
        c.info,
      ]),
      h('span', { class: 'tc-side' }, [c.act, c.kills]),
    ]);
    c.el.style.setProperty('--dc', contestantColor(tr));
    txt(c.name, tr.name);
    setTip(c.el, 'ui.roster.pick');
    return c;
  }
  function buildCards() {
    const list = GM.state.contestants;
    ui.cardsFor = list;
    ui.cards.length = 0;
    ui.orderKey = '';
    dom.rosterList.textContent = '';
    const frag = document.createDocumentFragment();
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      if (!tr) continue;
      const c = makeCard(tr);
      ui.cards[tr.id] = c;
      frag.appendChild(c.el);
    }
    dom.rosterList.appendChild(frag);
    show(dom.rosterEmpty, !list.length);
    refreshRoster(true);
  }
  function sortKey(a, b) {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (!a.alive) return (b.deathTime || 0) - (a.deathTime || 0) || a.id - b.id;
    switch (ui.sort) {
      case 'kills': return (b.kills || 0) - (a.kills || 0) || (b.health || 0) - (a.health || 0) || a.id - b.id;
      case 'health': return (b.health || 0) - (a.health || 0) || a.id - b.id;
      case 'name': return String(a.name).localeCompare(String(b.name)) || a.id - b.id;
      default: return a.team - b.team || a.id - b.id;
    }
  }
  function refreshRoster(force) {
    const list = GM.state.contestants;
    if (list !== ui.cardsFor) { buildCards(); return; }
    const selId = GM.state.selectedId;
    const targetMode = tgt.active;
    let alive = 0;
    for (let i = 0; i < list.length; i++) {
      const tr = list[i];
      const c = tr && ui.cards[tr.id];
      if (!c) continue;
      if (tr.alive) alive++;
      tog(c.el, 'dead', !tr.alive);
      tog(c.el, 'sel', tr.id === selId);
      tog(c.el, 'win', GM.state.winner === tr.id);
      if (force || c.archId !== tr.archetype) {
        c.archId = tr.archetype;
        txt(c.arch, archIcon(tr.archetype));
        attr(c.arch, 'title', archName(tr.archetype));
      }
      if (tr.alive) {
        const hp = U.clamp01((+tr.health || 0) / (+tr.maxHealth || 100));
        css(c.hp, '--v', hp.toFixed(3));
        tog(c.el, 'low', hp < 0.3);
        tog(c.el, 'burn', !!(tr.status && tr.status.burning > 0));
        const a = tr.sleeping ? 'sleep' : tr.action;
        txt(c.act, actionIcon(a));
        txt(c.info, tr.thought ? t(tr.thought.key, tr.thought.params) : actionName(a));
        tog(c.el, 'ally', tr.allianceId != null);
      } else {
        css(c.hp, '--v', '0');
        txt(c.act, causeIcon(tr.deathCause, tr.deathWeapon));
        const killer = tr.killedBy != null ? contestantById(tr.killedBy) : null;
        txt(c.info, killer ? t('ui.sel.killedBy', { name: killer.name }) : causeName(tr.deathCause || 'unknown'));
      }
      txt(c.kills, tr.kills > 0 ? '☠' + tr.kills : '');
      if (targetMode !== c.tm) { c.tm = targetMode; setTip(c.el, targetMode ? 'ui.roster.pickTarget' : 'ui.roster.pick'); }
    }
    txt(dom.rosterCount, t('ui.roster.count', { alive, total: list.length }));
    // order
    const ord = ui.order;
    ord.length = 0;
    for (let i = 0; i < list.length; i++) if (list[i]) ord.push(list[i]);
    ord.sort(sortKey);
    let key = ui.sort;
    for (let i = 0; i < ord.length; i++) key += ',' + ord[i].id;
    if (key !== ui.orderKey) {
      ui.orderKey = key;
      for (let i = 0; i < ord.length; i++) {
        const c = ui.cards[ord[i].id];
        if (c) dom.rosterList.appendChild(c.el);
      }
    }
  }
  function setSort(s) {
    ui.sort = s;
    const bs = dom.sortSeg.children;
    for (let i = 0; i < bs.length; i++) tog(bs[i], 'on', bs[i].getAttribute('data-sort') === s);
    refreshRoster(false);
  }
  function scrollCardIntoView(id) {
    const c = ui.cards[id];
    if (!c || !c.el) return;
    const l = dom.rosterList, e = c.el;
    const top = e.offsetTop - l.offsetTop;
    if (top < l.scrollTop || top + e.offsetHeight > l.scrollTop + l.clientHeight) {
      l.scrollTop = Math.max(0, top - l.clientHeight / 2 + e.offsetHeight / 2);
    }
  }
  /** Roster / map click: use an armed power on it, or select + follow. */
  function pickContestant(id) {
    const tr = contestantById(id);
    if (!tr) return;
    if (tgt.active) {
      if (tgt.mode === 'contestant') {
        if (!tr.alive) { flashHint('ui.target.dead'); return; }
        fireArmed(tr);
      } else if (tr.pos) {
        fireArmed({ x: tr.pos.x, y: tr.pos.y, z: tr.pos.z });
      }
      return;
    }
    GM.select(tr.id);
    const C = GM.Cameras;
    if (tr.alive && C && typeof C.follow === 'function' && isGamePhase(GM.state.phase)) C.follow(tr.id);
    else if (C && C.focus && tr.pos) C.focus(tr.pos);
    if (ui.drawer === 'left') openDrawer(null);
    play('click');
  }
  function cycleContestant(dir) {
    const list = GM.state.contestants;
    const ord = [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].alive) ord.push(list[i]);
    if (!ord.length) { toast('ui.toast.noContestants'); return; }
    ord.sort(sortKey);
    let idx = -1;
    for (let i = 0; i < ord.length; i++) if (ord[i].id === GM.state.selectedId) { idx = i; break; }
    idx = idx < 0 ? (dir > 0 ? 0 : ord.length - 1) : (idx + (dir > 0 ? 1 : -1) + ord.length) % ord.length;
    const tr = ord[idx];
    GM.select(tr.id);
    const C = GM.Cameras;
    if (C && typeof C.follow === 'function') C.follow(tr.id);
    scrollCardIntoView(tr.id);
  }

  // ====================================================== selected panel
  function fillSelStatic(tr) {
    show(dom.selEmpty, !tr);
    show(dom.sel, !!tr);
    if (!tr) return;
    const col = contestantColor(tr);
    css(dom.sel, '--dc', col);
    txt(dom.selSw, tr.team);
    txt(dom.selName, tr.name);
    dom.selSub.textContent = '';
    dom.selSub.appendChild(h('span', { class: 'ss-d', text: t('common.team', { n: tr.team }) }));
    dom.selSub.appendChild(h('span', { class: 'ss-a', text: archIcon(tr.archetype) + ' ' + archName(tr.archetype) }));
    txt(dom.selDesc, archDesc(tr.archetype));
    // traits
    dom.selTraits.textContent = '';
    const tv = tr.traits || {};
    for (let i = 0; i < TRAITS.length; i++) {
      const k = TRAITS[i];
      const v = U.clamp01(+tv[k] || 0);
      const row = h('div', { class: 'trait' }, [
        h('span', { class: 'tr-l', text: traitName(k) }),
        h('span', { class: 'tr-t' }, [h('span', { class: 'tr-f', style: '--v:' + v.toFixed(3) })]),
      ]);
      if (has('trait.' + k + '.desc')) { row.setAttribute('data-tip', 'trait.' + k + '.desc'); }
      dom.selTraits.appendChild(row);
    }
  }
  function setBar(b, v01, text) {
    css(b.fill, '--v', U.clamp01(v01).toFixed(3));
    tog(b.el, 'crit', v01 < 0.25);
    txt(b.val, text);
  }
  function chip(icon, label, extra, cls) {
    return '<span class="chip-i' + (cls ? ' ' + cls : '') + '"><span class="ci-ico">' + esc(icon) + '</span><span class="ci-l">' +
      esc(label) + '</span>' + (extra ? '<span class="ci-x mono">' + esc(extra) + '</span>' : '') + '</span>';
  }
  function refreshSel(force) {
    const tr = GM.selected();
    const id = tr ? tr.id : -1;
    if (id !== ui.selId || force) { ui.selId = id; ui.selSig = {}; fillSelStatic(tr); }
    if (!tr) return;
    const sig = ui.selSig;
    const alive = !!tr.alive;
    tog(dom.sel, 'is-dead', !alive);
    // mood + thought
    const mood = tr.sleeping ? 'asleep' : tr.mood || 'calm';
    txt(dom.selMoodIco, alive ? moodIcon(mood) : '✝');
    txt(dom.selMood, alive ? moodName(mood) : t('common.dead'));
    const act = tr.sleeping ? 'sleep' : tr.action;
    txt(dom.selActIco, alive ? actionIcon(act) : causeIcon(tr.deathCause, tr.deathWeapon));
    txt(dom.selThought, alive ? (tr.thought ? t(tr.thought.key, tr.thought.params) : actionName(act)) : causeName(tr.deathCause || 'unknown'));
    // death info
    let dead = '';
    if (!alive) {
      const killer = tr.killedBy != null ? contestantById(tr.killedBy) : null;
      dead = '<span class="sd-ico">' + esc(causeIcon(tr.deathCause, tr.deathWeapon)) + '</span><span class="sd-body"><b>' +
        esc(t('ui.sel.fallen', { day: tr.deathDay || GM.state.day })) + '</b><span>' +
        esc(killer ? t('ui.sel.killedBy', { name: killer.name }) : t('ui.sel.cause', { cause: causeName(tr.deathCause || 'unknown') })) +
        '</span>' + (tr.placement ? '<span class="mono">' + esc(t('ui.sel.place', { n: tr.placement })) + '</span>' : '') + '</span>';
    } else if (GM.state.winner === tr.id) {
      dead = '<span class="sd-ico">🏆</span><span class="sd-body"><b>' + esc(t('ui.sel.victor')) + '</b></span>';
    }
    if (sig.dead !== dead) { sig.dead = dead; dom.selDead.innerHTML = dead; show(dom.selDead, !!dead); tog(dom.selDead, 'win', alive && !!dead); }
    // bars
    const mh = +tr.maxHealth || 100;
    const B = dom.selBars;
    setBar(B.health, (+tr.health || 0) / mh, Math.max(0, Math.ceil(+tr.health || 0)));
    setBar(B.stamina, (+tr.stamina || 0) / 100, Math.round(+tr.stamina || 0));
    setBar(B.food, 1 - (+tr.hunger || 0) / 100, Math.round(100 - (+tr.hunger || 0)));
    setBar(B.water, 1 - (+tr.thirst || 0) / 100, Math.round(100 - (+tr.thirst || 0)));
    setBar(B.rest, (+tr.energy || 0) / 100, Math.round(+tr.energy || 0));
    const em = tr.emotion || {};
    for (let i = 0; i < EMOTIONS.length; i++) {
      const k = EMOTIONS[i];
      const v = U.clamp01(+em[k] || 0);
      css(dom.selEmo[k].fill, '--v', v.toFixed(3));
      txt(dom.selEmo[k].val, Math.round(v * 100));
      tog(dom.selEmo[k].el, 'crit', k === 'sanity' ? v < 0.3 : v > 0.75);
    }
    txt(dom.selKills, tr.kills || 0);
    txt(dom.selDmg, Math.round(+tr.damageDealt || 0));
    txt(dom.selPop, tr.popularity != null ? Math.round(U.clamp01(+tr.popularity) * 100) + '%' : '–');
    // gear
    const inv = tr.inv || {};
    let gk = lang() + '|' + inv.melee + '|' + inv.ranged + '|' + inv.ammo + '|' + inv.armor + '|' + inv.food + '|' + inv.water + '|' +
      inv.medkit + '|' + inv.berries + '|' + inv.traps + '|' + inv.sleepingBag + '|' + inv.goggles;
    if (sig.gear !== gk) {
      sig.gear = gk;
      let html = '';
      if (inv.melee) html += chip(itemIcon(inv.melee), itemName(inv.melee), '', 'wpn');
      if (inv.ranged) html += chip(itemIcon(inv.ranged), itemName(inv.ranged), '×' + (inv.ammo | 0), 'wpn');
      if (inv.armor) html += chip(itemIcon('armor'), itemName('armor'), '', 'arm');
      if (inv.food > 0) html += chip(itemIcon('food'), itemName('food'), '×' + inv.food);
      if (inv.water > 0) html += chip(itemIcon('water'), itemName('water'), '×' + inv.water);
      if (inv.medkit > 0) html += chip(itemIcon('medkit'), itemName('medkit'), '×' + inv.medkit);
      if (inv.berries > 0) html += chip(itemIcon('berries'), itemName('berries'), '×' + inv.berries);
      if (inv.traps > 0) html += chip(itemIcon('trap_kit'), itemName('trap_kit'), '×' + inv.traps);
      if (inv.sleepingBag) html += chip(itemIcon('sleeping_bag'), itemName('sleeping_bag'));
      if (inv.goggles) html += chip(itemIcon('goggles'), itemName('goggles'));
      dom.selGear.innerHTML = html || '<span class="none">' + esc(t('ui.sel.noGear')) + '</span>';
    }
    // effects
    const stt = tr.status || {};
    let fk = lang();
    let fx = '';
    if (alive) {
      for (let i = 0; i < STATUS_IDS.length; i++) {
        const s = STATUS_IDS[i];
        const v = +stt[s] || 0;
        if (v > 0) { fk += '|' + s + Math.ceil(v); fx += chip(STATUS_ICON[s] || '•', statusName(s), Math.ceil(v) + 's', STATUS_BAD[s] ? 'bad' : ''); }
      }
      const flags = ['sleeping', 'hidden', 'sneaking', 'swimming'];
      for (let i = 0; i < flags.length; i++) {
        if (tr[flags[i]]) { fk += '|' + flags[i]; fx += chip(STATUS_ICON[flags[i]] || '•', statusName(flags[i]), '', 'flag'); }
      }
    }
    if (sig.fx !== fk) { sig.fx = fk; dom.selFx.innerHTML = fx || '<span class="none">' + esc(t('ui.sel.noEffects')) + '</span>'; }
    // allies
    const al = alive ? allianceOf(tr) : null;
    let ak = lang() + '|';
    if (al && Array.isArray(al.members)) for (let i = 0; i < al.members.length; i++) ak += al.members[i] + ',';
    if (sig.allies !== ak) {
      sig.allies = ak;
      let html = '';
      if (al && Array.isArray(al.members)) {
        for (let i = 0; i < al.members.length; i++) {
          const m = contestantById(al.members[i]);
          if (!m || m.id === tr.id) continue;
          html += '<button type="button" class="chip-i ally' + (m.alive ? '' : ' gone') + '" data-id="' + m.id + '" style="--dc:' + esc(contestantColor(m)) + '">' +
            '<span class="ci-dot"></span><span class="ci-l">' + esc(m.name) + '</span>' +
            (al.leaderId === m.id ? '<span class="ci-x">' + esc(t('ui.sel.leader')) + '</span>' : '') + '</button>';
        }
      }
      dom.selAllies.innerHTML = html || '<span class="none">' + esc(t('ui.sel.alone')) + '</span>';
    }
    // action buttons
    const C = GM.Cameras;
    const cs = C && C.status ? C.status() : null;
    const following = !!(cs && cs.mode === 'follow' && cs.followId === tr.id);
    tog(dom.selFollow, 'on', following);
    setTip(dom.selFollow, following ? 'ui.sel.unfollow' : 'ui.sel.follow');
    const running = GM.isRunning();
    tog(dom.selGift, 'off', !alive || !running || !powerDef('sponsor_gift'));
    tog(dom.selSmite, 'off', !alive || !running || !powerDef('smite'));
    const armed = now() < ui.smiteArmedUntil;
    tog(dom.selSmite, 'armed', armed);
    setTip(dom.selSmite, armed ? 'ui.sel.smiteConfirm' : 'ui.sel.smite');
  }

  // ======================================================= powers panel
  function buildPowerButtons(force) {
    const defs = powersDefs();
    if (defs === ui.powBuiltFor && !force) return;
    ui.powBuiltFor = defs;
    dom.powGrid.textContent = '';
    ui.powBtns.length = 0;
    show(dom.powEmpty, !defs);
    show(dom.powTabs, !!defs);
    if (!defs) return;
    const cats = { all: true };
    const frag = document.createDocumentFragment();
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (!d || !d.id) continue;
      cats[d.category] = true;
      const name = h('span', { class: 'pw-name' });
      const cost = h('span', { class: 'pw-cost mono' });
      const cdt = h('span', { class: 'pw-cdt mono' });
      const kids = [
        h('span', { class: 'pw-sweep', 'aria-hidden': 'true' }),
        h('span', { class: 'pw-ico' }, [d.icon || '◆']),
        name,
        h('span', { class: 'pw-meta' }, [h('span', { class: 'pw-bolt' }, ['⚡']), cost]),
        cdt,
      ];
      if (d.target === 'point' || d.target === 'contestant') kids.push(h('span', { class: 'pw-tgt' }, [svg(d.target === 'contestant' ? 'user' : 'crosshair')]));
      if (d.options && d.options.length) kids.push(h('span', { class: 'pw-opt' }, [svg('chevron')]));
      const b = h('button', { type: 'button', class: 'pow', 'data-id': d.id, 'data-cat': d.category || 'rule' }, kids);
      b.setAttribute('data-tip', d.nameKey || 'power.' + d.id);
      b.__tipRich = powerTip.bind(null, d);
      b.addEventListener('click', function () { usePower(d.id, b); });
      b.addEventListener('contextmenu', function (e) { e.preventDefault(); if (tgt.active) cancelTargeting(); });
      ui.powBtns.push({ id: d.id, def: d, el: b, name, cost, cdt, cdMax: 0, lastCd: 0 });
      frag.appendChild(b);
    }
    dom.powGrid.appendChild(frag);
    const tabs = dom.powTabs.children;
    for (let i = 0; i < tabs.length; i++) show(tabs[i], !!cats[tabs[i].getAttribute('data-cat')]);
    if (!cats[ui.powCat]) ui.powCat = 'all';
    setPowCat(ui.powCat);
    powerTexts();
  }
  function powerTexts() {
    const sb = isSandbox();
    for (let i = 0; i < ui.powBtns.length; i++) {
      const b = ui.powBtns[i];
      txt(b.name, powerName(b.def));
      b.lk = false;   // refreshPowers repaints the lock label
      tog(b.el, 'locked', false);
      txt(b.cost, sb ? '∞' : String(b.def.cost == null ? 0 : b.def.cost));
    }
  }
  function powerTip(d) {
    const cu = canUse(d.id);
    let meta = '<span>' + esc(isSandbox() ? t('ui.pow.free') : t('ui.pow.cost', { n: d.cost || 0 })) + '</span>';
    if (d.cooldown) meta += '<span>' + esc(t('ui.pow.cooldown', { n: d.cooldown })) + '</span>';
    if (d.radius) meta += '<span>' + esc(t('ui.pow.radius', { n: d.radius })) + '</span>';
    const tk2 = 'ui.pow.target.' + (d.target || 'none');
    let state;
    if (cu.ok) state = '<div class="tt-ok">' + esc(t('ui.pow.ready')) + '</div>';
    else state = '<div class="tt-bad">' + esc(reasonText(d.id, cu.reason)) + '</div>';
    return '<div class="tt-title"><span class="tt-ico">' + esc(d.icon || '◆') + '</span>' + esc(powerName(d)) + '</div>' +
      '<div class="tt-desc">' + esc(powerDesc(d)) + '</div>' +
      '<div class="tt-meta mono">' + meta + '</div>' +
      '<div class="tt-tgt">' + esc(t(tk2)) + '</div>' + state;
  }
  function setPowCat(c) {
    ui.powCat = c;
    dom.powGrid.setAttribute('data-cat', c);
    const tabs = dom.powTabs.children;
    for (let i = 0; i < tabs.length; i++) tog(tabs[i], 'on', tabs[i].getAttribute('data-cat') === c);
  }
  function refreshPowers() {
    if (powersDefs() !== ui.powBuiltFor) buildPowerButtons(false);
    const P = GM.Powers;
    const running = GM.isRunning();
    for (let i = 0; i < ui.powBtns.length; i++) {
      const b = ui.powBtns[i];
      const cu = canUse(b.id);
      const cd = cooldownLeft(b.id);
      if (cd > b.lastCd + 0.05) b.cdMax = cd;
      b.lastCd = cd;
      const frac = cd > 0.02 && b.cdMax > 0 ? U.clamp01(cd / b.cdMax) : 0;
      css(b.el, '--cd', frac.toFixed(3));
      tog(b.el, 'cooling', frac > 0);
      txt(b.cdt, frac > 0 ? fmtCd(cd) : '');
      tog(b.el, 'off', !cu.ok);
      tog(b.el, 'poor', cu.reason === 'energy');
      const lk = cu.reason === 'locked';
      if (lk !== !!b.lk) {
        b.lk = lk;
        tog(b.el, 'locked', lk);
        txt(b.cost, lk ? '🔒 L' + (GM.Career ? GM.Career.unlockLevel(b.id) : 1) : isSandbox() ? '∞' : String(b.def.cost == null ? 0 : b.def.cost));
      }
      tog(b.el, 'armed', tgt.active && tgt.id === b.id);
      attr(b.el, 'aria-disabled', cu.ok ? null : 'true');
    }
    // energy
    const sb = isSandbox();
    const e = P ? +P.energy || 0 : 0;
    const m = P ? +P.maxEnergy || 100 : 100;
    const v = sb ? 1 : U.clamp01(e / m);
    css(dom.pEnFill, '--v', v.toFixed(3));
    txt(dom.pEnTxt, sb ? '∞' : Math.floor(e) + '/' + Math.round(m));
    const AG = GM.AutoGM;
    tog(dom.autoBtn, 'on', !!(AG && AG.enabled));
    show(dom.autoBtn, !!AG);
    tog(dom.panePowers, 'locked', !running);
    if (ui.tipTarget && ui.tipLive && ui.tipTarget.__tipRich) ui.tipDirty = true;
  }
  function toggleAssistant() {
    const AG = GM.AutoGM;
    if (!AG || typeof AG.setEnabled !== 'function') return;
    if (GM.Career && GM.Career.active() && !GM.Career.hasAssistant()) { toast('ui.toast.assistantLocked'); play('click'); return; }
    const on = !AG.enabled;
    try { AG.setEnabled(on); } catch (e) { GM.reportError('UI.autoGM', e); }
    if (GM.state.settings) GM.state.settings.autoGM = on;
    toast('ui.toast.assistant', { v: on ? '@common.on' : '@common.off' });
    play('click');
  }

  // ============================================================ targeting
  /** Power button click: options -> popover, none -> fire, else arm targeting. */
  function usePower(id, anchor) {
    const d = powerDef(id);
    if (!d) return;
    if (tgt.active && tgt.id === id) { cancelTargeting(); return; }
    const cu = canUse(id);
    if (!cu.ok) { toastReason(id, cu.reason); play('click'); return; }
    if (d.options && d.options.length) {
      let a = anchor;
      if (!a) for (let i = 0; i < ui.powBtns.length; i++) if (ui.powBtns[i].id === id) a = ui.powBtns[i].el;
      if (a) { openPopover(id, a); return; }
    }
    if (!d.target || d.target === 'none') { firePower(id, null, null); return; }
    startTargeting(id, null);
  }
  /** Use a contestant power directly on a contestant (selected-panel buttons). */
  function usePowerOn(id, tr) {
    const d = powerDef(id);
    if (!d) { toast('ui.pow.reason.missing'); return false; }
    const cu = canUse(id);
    if (!cu.ok) { toastReason(id, cu.reason); return false; }
    return firePower(id, tr, null);
  }
  function startTargeting(id, optionId) {
    const d = powerDef(id);
    if (!d) return;
    if (!d.target || d.target === 'none') { firePower(id, null, optionId || null); return; }
    if (tgt.active && tgt.id !== id) clearAim();
    closePopover();
    tgt.active = true;
    tgt.id = id;
    tgt.def = d;
    tgt.option = optionId || null;
    tgt.mode = d.target;
    tgt.radius = +d.radius || 0;
    tgt.hasPoint = false;
    tgt.hoverContestant = null;
    tgt.hintKey = null;
    tgt.hintUntil = 0;
    document.body.classList.add('gm-targeting');
    tog(dom.root, 'targeting', true);
    renderTargetHint();
    show(dom.tgtHint, true);
    refreshRoster(false);
    play('click');
  }
  function cancelTargeting() {
    if (!tgt.active) return;
    clearAim();
    tgt.active = false;
    tgt.id = null;
    tgt.def = null;
    tgt.option = null;
    tgt.mode = null;
    tgt.hoverContestant = null;
    document.body.classList.remove('gm-targeting');
    tog(dom.root, 'targeting', false);
    show(dom.tgtHint, false);
    if (ui.built) refreshRoster(false);
  }
  function aimPoint(x, z) {
    if (!tgt.active) return;
    x = +x; z = +z;
    if (!(x === x && z === z)) return;
    tgt.x = x;
    tgt.z = z;
    tgt.hasPoint = true;
    aimPt.x = x;
    aimPt.z = z;
    const T = GM.Terrain;
    aimPt.y = T && typeof T.heightAt === 'function' ? +T.heightAt(x, z) || 0 : 0;
    const P = GM.Powers;
    if (P && typeof P.setAim === 'function') { try { P.setAim(tgt.id, aimPt); } catch (e) { GM.reportError('UI.setAim', e); } }
  }
  function clearAim() {
    const had = tgt.hasPoint;
    tgt.hasPoint = false;
    const P = GM.Powers;
    if ((had || tgt.active) && P && typeof P.setAim === 'function') { try { P.setAim(tgt.id, null); } catch (e) { GM.reportError('UI.setAim', e); } }
  }
  function flashHint(key) {
    tgt.hintKey = key;
    tgt.hintUntil = now() + 2;
    renderTargetHint();
  }
  function renderTargetHint() {
    if (!tgt.active) return;
    const d = tgt.def;
    txt(dom.tgtIco, (d && d.icon) || '◆');
    let name = powerName(d);
    const o = optionById(d, tgt.option);
    if (o) name += ' · ' + optionName(o);
    txt(dom.tgtName, name);
    let text;
    const warn = tgt.hintKey && now() < tgt.hintUntil;
    if (warn) text = t(tgt.hintKey);
    else if (tgt.mode === 'contestant' && tgt.hoverContestant) text = t('ui.target.over', { name: tgt.hoverContestant.name });
    else text = t(tgt.mode === 'contestant' ? 'ui.target.contestant' : 'ui.target.point');
    txt(dom.tgtText, text);
    tog(dom.tgtHint, 'warn', !!warn);
  }
  function firePower(id, target, optionId) {
    const P = GM.Powers;
    if (!P || typeof P.use !== 'function') { toast('ui.pow.reason.missing'); return false; }
    let ok = false;
    try { ok = !!P.use(id, target, optionId || null); } catch (e) { GM.reportError('UI.usePower', e); ok = false; }
    const d = powerDef(id);
    if (ok) {
      for (let i = 0; i < ui.powBtns.length; i++) {
        const b = ui.powBtns[i];
        if (b.id === id) { b.el.classList.remove('fired'); void b.el.offsetWidth; b.el.classList.add('fired'); }
      }
      toast('ui.toast.used', { power: '@' + ((d && d.nameKey) || 'power.' + id) });
      play('click');
    } else {
      const cu = canUse(id);
      toastReason(id, cu.ok ? 'failed' : cu.reason);
    }
    return ok;
  }
  /** Fire the armed power at a target; keep it armed while Shift is held. */
  function fireArmed(target) {
    if (!tgt.active) return false;
    const id = tgt.id;
    const ok = firePower(id, target, tgt.option);
    if (ok && !ui.shift) cancelTargeting();
    else if (ok && !canUse(id).ok) cancelTargeting();
    return ok;
  }
  function onCanvasClick(e) {
    if (!e || !isGamePhase(GM.state.phase)) return;
    closePopover();
    if (tgt.active) {
      if (e.button === 2) { cancelTargeting(); return; }
      if (e.button !== 0) return;
      if (tgt.mode === 'contestant') {
        let tr = e.contestant && e.contestant.kind !== 'beast' ? e.contestant : null;
        if (!tr && e.point) tr = nearestContestant(e.point.x, e.point.z, 5, false);
        if (!tr) { flashHint('ui.target.needContestant'); return; }
        if (!tr.alive) { flashHint('ui.target.dead'); return; }
        fireArmed(tr);
      } else {
        if (!e.point) { flashHint('ui.target.ground'); return; }
        fireArmed({ x: e.point.x, y: e.point.y, z: e.point.z });
      }
      return;
    }
    if (e.button === 0 && e.contestant && e.contestant.kind !== 'beast' && e.contestant.id != null) {
      GM.select(e.contestant.id);
      scrollCardIntoView(e.contestant.id);
    }
  }
  function onCanvasHover(e) {
    if (!tgt.active || !e) return;
    if (tgt.mode === 'contestant') {
      let tr = null;
      const C = GM.Cameras;
      if (C && typeof C.pickContestant === 'function') {
        try { tr = C.pickContestant(e.clientX, e.clientY); } catch (err) { tr = null; }
      }
      if (!tr && e.point) tr = nearestContestant(e.point.x, e.point.z, 4, true);
      tgt.hoverContestant = tr && tr.alive ? tr : null;
      if (tgt.hoverContestant && tgt.hoverContestant.pos) aimPoint(tgt.hoverContestant.pos.x, tgt.hoverContestant.pos.z);
      else if (e.point) aimPoint(e.point.x, e.point.z);
      renderTargetHint();
    } else if (e.point) {
      aimPoint(e.point.x, e.point.z);
    }
  }
  /** Minimap click while targeting: use the armed power at a world point. */
  function targetPoint(x, z) {
    if (!tgt.active) return false;
    x = +x; z = +z;
    if (!(x === x && z === z)) return false;
    if (tgt.mode === 'contestant') {
      const tr = nearestContestant(x, z, 10, true);
      if (!tr) { flashHint('ui.target.needContestant'); return true; }
      fireArmed(tr);
      return true;
    }
    const T = GM.Terrain;
    const y = T && typeof T.heightAt === 'function' ? +T.heightAt(x, z) || 0 : 0;
    fireArmed({ x, y, z });
    return true;
  }

  // ============================================================ event log
  function logText(en) { return t(en.key, en.params); }
  function makeLogRow(en) {
    const lt = LOG_TYPES[en.type] || LOG_TYPES.event;
    const row = document.createElement('div');
    row.className = 'lrow t-' + (LOG_TYPES[en.type] ? en.type : 'event') + (en.important ? ' imp' : '') + (en.pos ? ' has-pos' : '');
    row.setAttribute('data-f', lt.f);
    row.__e = en;
    const tm = document.createElement('span');
    tm.className = 'lr-time mono';
    tm.textContent = U.formatClock(en.tod != null ? en.tod : GM.state.timeOfDay);
    const g = document.createElement('span');
    g.className = 'lr-g';
    g.textContent = lt.g;
    const tx = document.createElement('span');
    tx.className = 'lr-txt';
    tx.textContent = logText(en);
    row.appendChild(tm);
    row.appendChild(g);
    row.appendChild(tx);
    if (en.pos) row.setAttribute('data-tip', 'ui.log.focus');
    if (ui.logSelOnly) markSelHit(row, GM.state.selectedId);
    return row;
  }
  function markSelHit(row, id) {
    const en = row.__e;
    const hit = !!(en && id != null && en.contestantIds && en.contestantIds.indexOf(id) >= 0);
    tog(row, 'sel-hit', hit);
  }
  function makeDayRow(day) {
    const r = document.createElement('div');
    r.className = 'lday mono';
    r.__day = day;
    r.textContent = t('common.day', { n: day });
    return r;
  }
  function flushLog() {
    const q = ui.logQueue;
    if (!q.length) return;
    let start = 0;
    if (q.length > LOG_CAP) start = q.length - LOG_CAP;
    const list = dom.logList;
    const keepTop = list.scrollTop < 8;
    const added = q.length - start;
    for (let i = start; i < q.length; i++) {
      const en = q[i];
      const day = en.day || 1;
      if (day !== ui.logTopDay || !ui.logTopHeader || !ui.logTopHeader.isConnected) {
        ui.logTopDay = day;
        ui.logTopHeader = makeDayRow(day);
        list.insertBefore(ui.logTopHeader, list.firstChild);
      }
      list.insertBefore(makeLogRow(en), ui.logTopHeader.nextSibling);
      ui.logRows++;
    }
    q.length = 0;
    while (ui.logRows > LOG_CAP && list.lastChild) {
      const last = list.lastChild;
      if (last.classList.contains('lrow')) ui.logRows--;
      list.removeChild(last);
      while (list.lastChild && list.lastChild.classList.contains('lday')) list.removeChild(list.lastChild);
    }
    if (keepTop) list.scrollTop = 0;
    show(dom.logEmpty, ui.logRows === 0);
    if (ui.dockTab !== 'log' && added > 0) {
      ui.logUnseen = (ui.logUnseen || 0) + added;
      show(dom.dockTabs.log.querySelector('.dt-badge'), true);
    }
  }
  function clearLog() {
    ui.logQueue.length = 0;
    ui.logRows = 0;
    ui.logTopDay = -1;
    ui.logTopHeader = null;
    ui.logUnseen = 0;
    if (dom.logList) dom.logList.textContent = '';
    show(dom.logEmpty, true);
    if (dom.dockTabs) show(dom.dockTabs.log.querySelector('.dt-badge'), false);
  }
  function setLogFilter(f) {
    ui.logFilter = f;
    dom.logList.setAttribute('data-filter', f);
    const bs = dom.logSeg.children;
    for (let i = 0; i < bs.length; i++) tog(bs[i], 'on', bs[i].getAttribute('data-f') === f);
  }
  function applyLogSel() {
    tog(dom.logList, 'sel-only', ui.logSelOnly);
    tog(dom.logSel, 'on', ui.logSelOnly);
    if (!ui.logSelOnly) return;
    const id = GM.state.selectedId;
    const rows = dom.logList.children;
    for (let i = 0; i < rows.length; i++) if (rows[i].__e) markSelHit(rows[i], id);
  }
  function retranslateLog() {
    const rows = dom.logList.children;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.__e) r.lastChild.textContent = logText(r.__e);
      else if (r.__day != null) r.textContent = t('common.day', { n: r.__day });
    }
  }

  // ============================================================ kill feed
  function killRowHTML(k) {
    const kc = k.killer ? '<span class="kf-n" style="--dc:' + esc(k.killerColor) + '">' + esc(k.killer) + '</span>' : '';
    return kc + '<span class="kf-ico">' + esc(k.icon) + '</span>' +
      '<span class="kf-n kf-v" style="--dc:' + esc(k.victimColor) + '">' + esc(k.victim) + '</span>' +
      (k.killer ? '' : '<span class="kf-c">' + esc(causeName(k.cause)) + '</span>');
  }
  function onDied(e) {
    const tr = e && e.contestant;
    if (!tr || !dom.killfeed) return;
    const killer = e.killer && e.killer.kind !== 'beast' ? e.killer : null;
    const k = {
      killer: killer ? killer.name : null,
      killerColor: killer ? contestantColor(killer) : '',
      victim: tr.name,
      victimColor: contestantColor(tr),
      icon: causeIcon(e.cause || tr.deathCause, e.weapon || tr.deathWeapon),
      cause: e.cause || tr.deathCause || 'unknown',
      until: now() + KF_LIFE,
      el: null,
    };
    k.el = h('div', { class: 'kf-row' });
    k.el.innerHTML = killRowHTML(k);
    dom.killfeed.insertBefore(k.el, dom.killfeed.firstChild);
    ui.killRows.unshift(k);
    while (ui.killRows.length > KF_MAX) {
      const old = ui.killRows.pop();
      if (old.el && old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
    ui.rosterDirty = true;
  }
  function refreshKillfeed() {
    const n = now();
    for (let i = ui.killRows.length - 1; i >= 0; i--) {
      const k = ui.killRows[i];
      if (n > k.until) {
        if (k.el && k.el.parentNode) k.el.parentNode.removeChild(k.el);
        ui.killRows.splice(i, 1);
      } else tog(k.el, 'old', n > k.until - 1.2);
    }
  }
  function clearKillfeed() {
    ui.killRows.length = 0;
    if (dom.killfeed) dom.killfeed.textContent = '';
  }

  // ======================================================== announcements
  function annText(a) {
    a.txtEl.textContent = t(a.key, a.params);
    a.kick.textContent = t('ui.ann.' + (has('ui.ann.' + a.style) ? a.style : 'info'));
    if (a.subEl) a.subEl.textContent = t(a.subKey);
  }
  function onAnnounce(e) {
    if (!e || !e.key || !dom.annStack || !isGamePhase(GM.state.phase)) return;
    const style = e.style || 'info';
    const a = { key: e.key, params: e.params || {}, style, until: now() + Math.max(1.5, +e.duration || 4), el: null };
    a.kick = h('div', { class: 'ann-kick mono' });
    a.txtEl = h('div', { class: 'ann-text' });
    const kids = [h('span', { class: 'ann-line', 'aria-hidden': 'true' }), a.kick, a.txtEl];
    if (e.key === 'ann.kickoff' && has('ann.kickoffSub')) {
      a.subKey = 'ann.kickoffSub';
      a.subEl = h('div', { class: 'ann-sub' });
      kids.push(a.subEl);
    }
    a.el = h('div', { class: 'ann ann-' + style }, kids);
    annText(a);
    dom.annStack.appendChild(a.el);
    ui.anns.push(a);
    while (ui.anns.length > ANN_MAX) {
      const old = ui.anns.shift();
      if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
    }
  }
  function refreshAnns() {
    const n = now();
    for (let i = ui.anns.length - 1; i >= 0; i--) {
      const a = ui.anns[i];
      if (n > a.until) {
        if (a.el.parentNode) a.el.parentNode.removeChild(a.el);
        ui.anns.splice(i, 1);
      } else if (n > a.until - 0.5) tog(a.el, 'out', true);
    }
  }
  function clearAnns() {
    for (let i = 0; i < ui.anns.length; i++) if (ui.anns[i].el.parentNode) ui.anns[i].el.parentNode.removeChild(ui.anns[i].el);
    ui.anns.length = 0;
  }

  // ============================================================ countdown
  function onCountdown(e) {
    if (!dom.cd) return;
    const n = e ? e.n | 0 : 0;
    if (n <= 0 || GM.state.phase !== 'countdown') { show(dom.cd, false); return; }
    show(dom.cd, true);
    dom.cdNum.textContent = String(n);
    tog(dom.cd, 'final', n <= 3);
    dom.cd.classList.remove('tick');
    void dom.cd.offsetWidth;
    dom.cd.classList.add('tick');
  }

  // ========================================================== night recap
  function renderRecap() {
    const d = ui.recapData;
    if (!d) return;
    const fallen = Array.isArray(d.fallen) ? d.fallen : [];
    let cards = '';
    for (let i = 0; i < fallen.length; i++) {
      const tr = contestantById(fallen[i]);
      if (!tr) continue;
      const killer = tr.killedBy != null ? contestantById(tr.killedBy) : null;
      cards += '<div class="rc-card" style="--dc:' + esc(contestantColor(tr)) + ';--i:' + i + '">' +
        '<div class="rc-face"><span class="rc-init">' + esc(String(tr.name || '?').charAt(0)) + '</span><span class="rc-d mono">' + esc(tr.team) + '</span></div>' +
        '<div class="rc-name">' + esc(tr.name) + '</div>' +
        '<div class="rc-dist">' + esc(t('common.team', { n: tr.team })) + '</div>' +
        '<div class="rc-cause"><span>' + esc(causeIcon(tr.deathCause, tr.deathWeapon)) + '</span>' +
        esc(killer ? t('recap.by', { name: killer.name }) : causeName(tr.deathCause || 'unknown')) + '</div></div>';
    }
    const n = fallen.length;
    dom.recap.innerHTML =
      '<div class="rc-sky" aria-hidden="true"></div>' +
      '<div class="rc-inner">' +
      '<div class="rc-kick mono">' + esc(t('app.title')) + '</div>' +
      '<h2 class="rc-title">' + esc(t('recap.title', { n: d.day || GM.state.day })) + '</h2>' +
      '<p class="rc-sub">' + esc(n ? t('recap.sub') : t('recap.none')) + '</p>' +
      (n ? '<div class="rc-count mono">' + esc(t('recap.count', { n })) + '</div><div class="rc-grid">' + cards + '</div>' : '') +
      '<div class="rc-close">' + esc(t('recap.close')) + '</div></div>';
  }
  function onRecap(e) {
    if (!e || GM.state.phase !== 'running' || !dom.recap) return;
    ui.recapData = { day: e.day, fallen: (e.fallen || []).slice() };
    renderRecap();
    show(dom.recap, true);
    dom.recap.classList.remove('in');
    void dom.recap.offsetWidth;
    dom.recap.classList.add('in');
    const n = ui.recapData.fallen.length;
    ui.recapUntil = now() + (n ? Math.min(14, 7 + n * 0.6) : 5);
    play('anthem', { volume: 0.8 });
  }
  function hideRecap() {
    ui.recapData = null;
    ui.recapUntil = 0;
    if (dom.recap) { show(dom.recap, false); dom.recap.textContent = ''; }
  }

  // ============================================================== victory
  function sparkPath(vals, w, hgt, maxV) {
    if (!vals || vals.length < 2) return '';
    let d = '';
    const n = vals.length;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * w;
      const y = hgt - U.clamp01((+vals[i] || 0) / maxV) * (hgt - 2) - 1;
      d += (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
    }
    return d;
  }
  function excitementHistory() {
    const A = GM.Audience;
    if (A && Array.isArray(A.history) && A.history.length >= 2) return A.history;
    return ui.excHistory;
  }
  function audienceGrade() {
    const A = GM.Audience;
    if (A && typeof A.grade === 'function') {
      try { const g = A.grade(); if (g) return String(g); } catch (e) { GM.reportError('UI.grade', e); }
    }
    return null;
  }
  function renderVictory() {
    const st = GM.state;
    const win = st.winner != null ? contestantById(st.winner) : null;
    const list = st.contestants;
    let most = null;
    for (let i = 0; i < list.length; i++) if (list[i] && (!most || (list[i].kills || 0) > (most.kills || 0))) most = list[i];
    if (most && !(most.kills > 0)) most = null;
    const grade = audienceGrade();
    const peak = Math.max(ui.peakViewers || 0, (st.stats && st.stats.peakViewers) || 0);
    let kickoff = 0;
    for (let i = 0; i < st.deaths.length; i++) if (st.deaths[i].day === 1 && st.deaths[i].time < 60) kickoff++;
    const stat = function (lbl, val, cls) {
      return '<div class="vs' + (cls ? ' ' + cls : '') + '"><span class="vs-l">' + esc(lbl) + '</span><span class="vs-v mono">' + val + '</span></div>';
    };
    let hero;
    if (win) {
      hero = '<div class="vh" style="--dc:' + esc(contestantColor(win)) + '">' +
        '<div class="vh-crest"><span class="vh-d mono">' + esc(win.team) + '</span></div>' +
        '<div class="vh-body"><div class="vh-kick mono">' + esc(t('victory.title')) + '</div>' +
        '<h2 class="vh-name">' + esc(win.name) + '</h2>' +
        '<div class="vh-sub">' + esc(t('common.team', { n: win.team })) + ' · ' + esc(archIcon(win.archetype) + ' ' + archName(win.archetype)) + '</div>' +
        '<button type="button" class="btn btn-ghost vh-watch" data-act="focus" data-id="' + win.id + '">' + svgMarkup('video') + '<span>' + esc(t('ui.sel.follow')) + '</span></button>' +
        '</div></div>';
    } else {
      hero = '<div class="vh none"><div class="vh-crest"><span class="vh-d">✝</span></div><div class="vh-body">' +
        '<div class="vh-kick mono">' + esc(t('victory.none')) + '</div><h2 class="vh-name">' + esc(t('victory.none')) + '</h2>' +
        '<div class="vh-sub">' + esc(t('victory.noneSub')) + '</div></div></div>';
    }
    let stats = '';
    stats += stat(t('victory.days'), esc(st.day));
    stats += stat(t('victory.time'), esc(U.formatDuration(st.endTime || st.time)));
    stats += stat(t('victory.deaths'), esc(st.deaths.length));
    stats += stat(t('victory.kickoff'), esc(kickoff));
    if (win) stats += stat(t('victory.kills'), esc(win.kills || 0));
    stats += stat(t('victory.mostKills'), most ? esc(most.name) + ' <small>☠' + esc(most.kills) + '</small>' : esc(t('victory.none.dash')));
    stats += stat(t('victory.powers'), esc((st.stats && st.stats.powersUsed) || 0));
    stats += stat(t('victory.peak'), esc(peak > 0 ? compact(peak) : t('victory.none.dash')));
    let gradeBlock = '';
    if (grade) {
      gradeBlock = '<div class="vg vg-' + esc(grade) + '"><span class="vg-l">' + esc(t('victory.grade')) + '</span>' +
        '<span class="vg-v">' + esc(grade) + '</span><span class="vg-t">' + esc(tk('victory.grade.' + grade)) + '</span></div>';
    }
    const hist = excitementHistory();
    let chart = '';
    if (hist && hist.length >= 2) {
      const path = sparkPath(hist, 300, 60, 100);
      chart = '<div class="vchart"><div class="vs-l">' + esc(t('victory.excitement')) + '</div>' +
        '<svg viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true"><path class="vc-area" d="' + path + 'L300 60L0 60Z"/><path class="vc-line" d="' + path + '"/></svg></div>';
    }
    let fallen = '';
    for (let i = st.deaths.length - 1; i >= 0; i--) {
      const d = st.deaths[i];
      const tr = contestantById(d.id);
      if (!tr) continue;
      const killer = d.killerId != null ? contestantById(d.killerId) : null;
      fallen += '<li style="--dc:' + esc(contestantColor(tr)) + '"><span class="vf-p mono">' + esc(tr.placement || '') + '</span>' +
        '<span class="vf-n">' + esc(tr.name) + '</span><span class="vf-c">' + esc(causeIcon(d.cause, d.weapon)) + ' ' +
        esc(killer ? t('recap.by', { name: killer.name }) : causeName(d.cause || 'unknown')) + '</span>' +
        '<span class="vf-d mono">' + esc(t('victory.day', { n: d.day })) + '</span></li>';
    }
    dom.victory.innerHTML =
      '<div class="ov-card victory-card"><div class="v-rays" aria-hidden="true"></div>' +
      '<div class="v-top mono">' + esc(t('app.title')) + ' · ' + esc(t('ui.results')) + '</div>' +
      hero +
      '<div class="v-grid"><div class="v-left"><div class="v-stats">' + stats + '</div>' + gradeBlock + chart + '</div>' +
      '<div class="v-right"><div class="vs-l">' + esc(t('victory.fallen')) + '</div><ol class="v-fallen">' + fallen + '</ol></div></div>' +
      '<div class="v-actions"><button type="button" class="btn btn-ghost" data-act="watch">' + svgMarkup('eye') + '<span>' + esc(t('victory.watch')) + '</span></button>' +
      '<button type="button" class="start-btn v-new" data-act="new"><span class="start-glow" aria-hidden="true"></span><span class="start-label">' + esc(t('victory.newShow')) + '</span></button></div>' +
      '</div>';
    GM.emit('ui:victory', { root: dom.victory });   // every (re)render: other modules may extend the card
  }
  function showVictory() {
    if (GM.state.phase !== 'ended') return;
    hideRecap();
    closeAllOverlays();
    renderVictory();
    ui.victoryShown = true;
    show(dom.victory, true);
    show(dom.resultsBtn, true);
    const b = dom.victory.querySelector('.v-new');
    if (b) b.focus({ preventScroll: true });
    if (!ui.victorySound) { ui.victorySound = true; play('victory', { volume: 0.9 }); }
  }
  function hideVictory() {
    ui.victoryShown = false;
    show(dom.victory, false);
  }

  // ======================================================== help / errors
  function renderHelpPowers() {
    const defs = powersDefs();
    if (!defs) { dom.helpPowers.innerHTML = '<p class="hint">' + esc(t('help.noPowers')) + '</p>'; return; }
    let html = '';
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      html += '<div class="hp-row"><span class="hp-ico">' + esc(d.icon || '◆') + '</span><span class="hp-body"><b>' + esc(powerName(d)) +
        '</b><span>' + esc(powerDesc(d)) + '</span></span><span class="hp-cost mono">⚡' + esc(d.cost || 0) + '</span></div>';
    }
    dom.helpPowers.innerHTML = html;
  }
  function showHelp() {
    closePopover();
    renderHelpPowers();
    show(dom.help, true);
    ui.helpOpen = true;
    const x = dom.help.querySelector('.ov-x');
    if (x) x.focus({ preventScroll: true });
  }
  function hideHelp() {
    ui.helpOpen = false;
    show(dom.help, false);
  }
  function toggleHelp() { if (ui.helpOpen) hideHelp(); else showHelp(); }
  function renderErrors() {
    const errs = GM.errors || [];
    if (!errs.length) { dom.errList.innerHTML = '<p>' + esc(t('ui.err.none')) + '</p>'; return; }
    let html = '';
    for (let i = errs.length - 1; i >= 0 && i >= errs.length - 60; i--) {
      const e = errs[i];
      html += '<div class="err-row"><b>' + esc(e.where) + '</b><span>' + esc(e.message) + '</span>' + (e.count > 1 ? '<i>×' + esc(e.count) + '</i>' : '') + '</div>';
    }
    dom.errList.innerHTML = html;
  }
  function toggleOverlay(name, force) {
    if (name !== 'errors') return;
    const on = typeof force === 'boolean' ? force : !ui.errOpen;
    ui.errOpen = on;
    if (on) renderErrors();
    show(dom.errors, on);
  }
  function refreshErrors() {
    const n = (GM.errors && GM.errors.length) || 0;
    if (n === ui.errCount) return;
    ui.errCount = n;
    show(dom.errBadge, n > 0);
    txt(dom.errTxt, n >= 100 ? '99+' : String(n));
    setTip(dom.errBadge, 'ui.top.errorsTip');
    attr(dom.errBadge, 'aria-label', t('ui.top.errors', { n }));
    if (ui.errOpen) renderErrors();
  }
  function closeAllOverlays() {
    hideHelp();
    toggleOverlay('errors', false);
    closePopover();
  }

  // ============================================================== top bar
  function refreshSpeed() {
    const st = GM.state;
    const paused = !!st.paused;
    setIcon(dom.pauseBtn.firstChild, paused ? 'play' : 'pause');
    setTip(dom.pauseBtn, paused ? 'ui.top.play' : 'ui.top.pause');
    tog(dom.pauseBtn, 'on', paused);
    for (let i = 0; i < dom.speedBtns.length; i++) {
      const b = dom.speedBtns[i];
      tog(b, 'on', !paused && +b.getAttribute('data-speed') === st.speed);
    }
    show(dom.paused, paused && isGamePhase(st.phase));
    tog(dom.root, 'is-paused', paused);
  }
  function drawSpark() {
    const cv = dom.spark;
    if (!cv || !cv.getContext) return;
    const hist = excitementHistory();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round((cv.clientWidth || 72) * dpr), hh = Math.round((cv.clientHeight || 20) * dpr);
    if (w < 4 || hh < 4) return;
    if (cv.width !== w || cv.height !== hh) { cv.width = w; cv.height = hh; }
    const g = cv.getContext('2d');
    g.clearRect(0, 0, w, hh);
    const n = hist ? Math.min(hist.length, 48) : 0;
    if (n < 2) return;
    const off = hist.length - n;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * (w - 2) + 1;
      const y = hh - 1 - U.clamp01((+hist[off + i] || 0) / 100) * (hh - 3);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.strokeStyle = 'rgba(94,234,255,0.95)';
    g.lineWidth = 1.2 * dpr;
    g.lineJoin = 'round';
    g.stroke();
    g.lineTo(w - 1, hh);
    g.lineTo(1, hh);
    g.closePath();
    g.fillStyle = 'rgba(94,234,255,0.14)';
    g.fill();
  }
  function refreshTopbar() {
    const st = GM.state;
    const pk = envPhaseKey();
    txt(dom.todIco, TOD_ICON[pk] || '☀️');
    if (st.phase === 'countdown') txt(dom.dayTxt, t('ui.top.countdown') + ' · ' + Math.max(0, Math.ceil(st.countdown)));
    else txt(dom.dayTxt, t('common.day', { n: st.day }));
    txt(dom.clockTxt, U.formatClock(st.timeOfDay) + ' · ' + t(pk));
    tog(dom.topbar, 'night', pk === 'tod.night');
    const w = envWeather();
    txt(dom.wxIco, WEATHER_ICON[w] || '☀️');
    txt(dom.wxTxt, has('weather.' + w) ? t('weather.' + w) : w);
    attr(dom.wxIco.parentNode, 'data-wx', w);
    const total = st.contestants.length;
    const alive = aliveCount();
    txt(dom.aliveTxt, alive);
    txt(dom.aliveTot, '/' + total);
    // audience
    const A = GM.Audience;
    show(dom.audChip, !!A);
    if (A) {
      const exc = U.clamp(+A.excitement || 0, 0, 100);
      const viewers = +A.viewers || 0;
      if (viewers > ui.peakViewers) ui.peakViewers = viewers;
      txt(dom.viewTxt, compact(viewers));
      css(dom.excFill, '--v', (exc / 100).toFixed(3));
      txt(dom.excTxt, Math.round(exc));
      tog(dom.audChip, 'hot', exc >= 70);
      tog(dom.audChip, 'cold', exc < 25);
    }
    // energy
    const P = GM.Powers;
    show(dom.enChip, !!P);
    if (P) {
      const sb = isSandbox();
      const e = +P.energy || 0, m = +P.maxEnergy || 100;
      css(dom.enFill, '--v', (sb ? 1 : U.clamp01(e / m)).toFixed(3));
      txt(dom.enTxt, sb ? '∞' : String(Math.floor(e)));
      tog(dom.enChip, 'sandbox', sb);
      tog(dom.enChip, 'full', !sb && e >= m - 0.5);
    }
    refreshSpeed();
    const muted = isMuted();
    setIcon(dom.muteBtn.firstChild, muted ? 'mute' : 'sound');
    setTip(dom.muteBtn, muted ? 'ui.top.unmute' : 'ui.top.mute');
    tog(dom.muteBtn, 'on', muted);
    const armed = now() < ui.exitArmedUntil;
    tog(dom.exitBtn, 'armed', armed);
    setTip(dom.exitBtn, armed ? 'ui.top.exitConfirm' : 'ui.top.exit');
    show(dom.resultsBtn, st.phase === 'ended' && !ui.victoryShown);
  }
  function toggleMute() {
    const A = GM.Audio;
    if (!A || typeof A.setMuted !== 'function') return;
    const m = !A.muted;
    try { A.setMuted(m); } catch (e) { GM.reportError('UI.mute', e); }
    toast('ui.toast.sound', { v: m ? '@common.off' : '@common.on' });
    refreshTopbar();
  }
  function onExit() {
    if (now() < ui.exitArmedUntil) {
      ui.exitArmedUntil = 0;
      if (GM.Game && GM.Game.toSetup) GM.Game.toSetup();
      return;
    }
    ui.exitArmedUntil = now() + 3;
    toast(GM.Career && GM.Career.active() && GM.state.phase !== 'ended' ? 'ui.top.exitCareer' : 'ui.top.exitConfirm');
    refreshTopbar();
  }
  function toggleNameTags() {
    const s = GM.state.settings;
    if (!s) return;
    s.nameTags = !s.nameTags;
    GM.emit('settings:changed', { key: 'nameTags', value: s.nameTags });
    toast('ui.toast.tags', { v: s.nameTags ? '@common.on' : '@common.off' });
  }
  function toggleFeeds() {
    const s = GM.state.settings;
    if (!s) return;
    s.feeds = s.feeds === false;
    GM.emit('settings:changed', { key: 'feeds', value: s.feeds });
    toast('ui.toast.feeds', { v: s.feeds ? '@common.on' : '@common.off' });
    refreshFeeds();
  }
  function takeFeed(i) {
    const C = GM.Cameras;
    if (!C || typeof C.takeFeed !== 'function') return;
    let ok = false;
    try { ok = C.takeFeed(i); } catch (e) { GM.reportError('UI.takeFeed', e); }
    if (ok) {
      play('click');
      if (ui.drawer === 'right') openDrawer(null);
    }
  }

  // ======================================================= camera + feeds
  function refreshCam() {
    const C = GM.Cameras;
    const st = GM.state;
    txt(dom.camTime, t('common.day', { n: st.day }) + ' · ' + U.formatClock(st.timeOfDay) + ' · T+' + U.formatDuration(st.time));
    if (!C || typeof C.status !== 'function') {
      txt(dom.camName, '');
      txt(dom.camMode, '');
      txt(dom.camLabel, t('ui.cam.noSignal'));
      return;
    }
    let s = null;
    try { s = C.status(); } catch (e) { GM.reportError('UI.camStatus', e); }
    if (!s) return;
    txt(dom.camName, s.camName || '');
    txt(dom.camMode, s.modeShort ? t(s.modeShort) : tk('ui.cam.mode.' + s.mode));
    txt(dom.camLabel, s.label ? t(s.label) : '');
    if (s.mode !== ui.camMode) {
      ui.camMode = s.mode;
      ui.camHintUntil = now() + 5;
      for (const k in dom.camBtns) tog(dom.camBtns[k], 'on', k === s.mode);
    }
    const hint = s.hint ? t(s.hint) : '';
    const showHint = !!hint && now() < ui.camHintUntil;
    if (showHint) txt(dom.camHint, hint);
    show(dom.camHint, showHint);
    tog(dom.viewport, 'cut', !!s.cut);
    tog(dom.camHud, 'follow', s.mode === 'follow');
  }
  function refreshFeeds() {
    const s = GM.state.settings;
    const on = !s || s.feeds !== false;
    tog(dom.right, 'feeds-off', !on);
    show(dom.feedOff, !on);
    tog(dom.feedToggle, 'on', on);
    const C = GM.Cameras;
    const feeds = C && Array.isArray(C.feeds) ? C.feeds : null;
    for (let i = 0; i < dom.feeds.length; i++) {
      const f = dom.feeds[i];
      show(f.slot, on);
      if (!on) continue;
      const cf = feeds ? feeds[i] : null;
      const active = !!(cf && (cf.shot ? cf.shot.active : cf.label));
      txt(f.name, t('feed.name', { n: i + 1 }));
      txt(f.label, active && cf.label ? t(cf.label) : t('feed.searching'));
      tog(f.slot, 'nosig', !active);
      tog(f.slot, 'cut', !!(cf && cf.cut));
      tog(f.slot, 'hot', !!(cf && cf.shot && cf.shot.score >= 8));
    }
  }

  // ======================================================= layout control
  function openDrawer(side) {
    ui.drawer = side === 'left' || side === 'right' ? side : null;
    if (dom.root) dom.root.setAttribute('data-drawer', ui.drawer || '');
    tog(dom.btnLeft, 'on', ui.drawer === 'left');
    tog(dom.btnRight, 'on', ui.drawer === 'right');
  }
  function setDockTab(tab) {
    if (tab !== 'powers' && tab !== 'contestant' && tab !== 'log') return;
    ui.dockTab = tab;
    if (!dom.dock) return;
    dom.dock.setAttribute('data-tab', tab);
    for (const k in dom.dockTabs) {
      tog(dom.dockTabs[k], 'on', k === tab);
      attr(dom.dockTabs[k], 'aria-selected', k === tab ? 'true' : 'false');
    }
    if (tab === 'log') { ui.logUnseen = 0; show(dom.dockTabs.log.querySelector('.dt-badge'), false); }
    if (tab === 'contestant') refreshSel(false);
  }

  // ================================================================= keys
  function escapeAction() {
    if (ui.popover) { closePopover(); return true; }
    if (tgt.active) { cancelTargeting(); return true; }
    if (ui.helpOpen) { hideHelp(); return true; }
    if (ui.errOpen) { toggleOverlay('errors', false); return true; }
    if (ui.recapData) { hideRecap(); return true; }
    if (ui.victoryShown) { ui.victoryClosed = true; hideVictory(); return true; }
    if (ui.drawer) { openDrawer(null); return true; }
    return false;
  }
  function onKeyDown(e) {
    if (e.key === 'Shift') ui.shift = true;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping()) {
      if (e.key === 'Escape') { document.activeElement.blur(); e.preventDefault(); }
      return;
    }
    const phase = GM.state.phase;
    const game = isGamePhase(phase);
    const k = e.key;
    const code = e.code || '';
    if (k === 'Escape') { if (escapeAction()) e.preventDefault(); return; }
    if (e.repeat && k !== '+' && k !== '-') return;
    if (code === 'KeyL' || k === 'l' || k === 'L') { if (GM.i18n) GM.i18n.toggle(); return; }
    if (code === 'KeyH' || k === 'h' || k === 'H' || k === '?') { toggleHelp(); return; }
    if (code === 'KeyM' || k === 'm' || k === 'M') { toggleMute(); return; }
    if (!game) return;
    if (code === 'Space' || k === ' ') {
      e.preventDefault();
      const a = document.activeElement;
      if (a && a !== document.body && a.blur) a.blur();
      if (GM.Game) GM.Game.togglePause();
      return;
    }
    if (k === '+' || k === '=' || code === 'NumpadAdd') { if (GM.Game) GM.Game.stepSpeed(1); toast('ui.toast.speed', { n: GM.state.speed }); return; }
    if (k === '-' || k === '_' || code === 'NumpadSubtract') { if (GM.Game) GM.Game.stepSpeed(-1); toast('ui.toast.speed', { n: GM.state.speed }); return; }
    if (k === 'Tab') { e.preventDefault(); cycleContestant(e.shiftKey ? -1 : 1); return; }
    if (code === 'KeyN' || k === 'n' || k === 'N') { toggleNameTags(); return; }
    if (code === 'KeyP' || k === 'p' || k === 'P') {
      setDockTab('powers');
      tog(dom.dock, 'min', false);
      const b = dom.powGrid.querySelector('.pow:not(.off)') || dom.powGrid.querySelector('.pow');
      if (b) b.focus({ preventScroll: true });
    }
  }
  function onKeyUp(e) { if (e.key === 'Shift' || !e.shiftKey) ui.shift = false; }

  // ========================================================== translation
  function retranslate() {
    if (!ui.built) return;
    document.title = t('app.title');
    syncLangButtons();
    // setup
    for (let i = 0; i < setup.rows.length; i++) fillArchOptions(setup.rows[i].arch);
    if (GM.state.phase === 'setup') syncSetup();
    // hud
    for (let i = 0; i < ui.cards.length; i++) if (ui.cards[i]) ui.cards[i].archId = null;
    if (isGamePhase(GM.state.phase)) refreshRoster(true);
    ui.selId = -2;
    refreshSel(true);
    powerTexts();
    retranslateLog();
    for (let i = 0; i < ui.killRows.length; i++) ui.killRows[i].el.innerHTML = killRowHTML(ui.killRows[i]);
    for (let i = 0; i < ui.anns.length; i++) annText(ui.anns[i]);
    if (ui.recapData) renderRecap();
    if (ui.victoryShown) renderVictory();
    if (ui.helpOpen) renderHelpPowers();
    if (ui.popover) renderPopover();
    if (tgt.active) renderTargetHint();
    ui.errCount = -1;
    refreshErrors();
    ui.tipDirty = true;
    if (GM.state.phase !== 'setup') refreshAll();
  }

  // =============================================================== phases
  function applyPhase(phase) {
    const prev = ui.phase;
    ui.phase = phase;
    dom.root.setAttribute('data-phase', phase);
    const inSetup = phase === 'setup' || phase === 'boot';
    show(dom.setup, phase === 'setup');
    show(dom.hud, !inSetup);
    if (inSetup) {
      cancelTargeting();
      openDrawer(null);
      hideVictory();
      hideRecap();
      show(dom.cd, false);
      hideTip();
    }
    if (phase !== 'running' && tgt.active) cancelTargeting();
    if (phase === 'countdown') show(dom.cd, true);
    if (phase === 'running') show(dom.cd, false);
    if (phase === 'ended') show(dom.cd, false);
    if (!inSetup && (prev === 'setup' || prev === 'boot' || prev === '')) { buildPowerButtons(true); refreshAll(); }
  }
  function refreshAll() {
    refreshTopbar();
    refreshCam();
    refreshFeeds();
    refreshPowers();
    refreshSel(false);
    refreshRoster(false);
    refreshErrors();
  }
  function onSetupPhase() {
    const fromGame = ui.phase !== 'setup' && ui.phase !== 'boot' && ui.phase !== '';
    clearGameUI();
    if (!setup.seed) setup.seed = GM.state.seed >>> 0;
    if (!setup.roster.length) regenRoster(true);
    if (fromGame) {
      // the old arena may carry craters and burnt forest: show a fresh preview
      previewSeed(setup.seed);
    } else if ((GM.state.seed >>> 0) !== setup.seed) {
      setup.seed = GM.state.seed >>> 0;
      setup.seedText = '';
      regenRoster(true);
    }
    applyPhase('setup');
    syncSetup();
    setup.mapVer = -1;
  }
  function clearGameUI() {
    cancelTargeting();
    closePopover();
    clearLog();
    clearKillfeed();
    clearAnns();
    hideRecap();
    hideVictory();
    ui.victoryAt = 0;
    ui.victoryShown = false;
    ui.victoryClosed = false;
    ui.victorySound = false;
    ui.peakViewers = 0;
    ui.excHistory.length = 0;
    ui.excAcc = 0;
    ui.exitArmedUntil = 0;
    ui.smiteArmedUntil = 0;
    ui.selId = -2;
    ui.cardsFor = null;
    ui.cards.length = 0;
    ui.orderKey = '';
    UI.hoverId = null;
    if (dom.rosterList) dom.rosterList.textContent = '';
    if (dom.cd) show(dom.cd, false);
  }

  // =============================================================== events
  function subscribe() {
    GM.on('game:setup', function () { onSetupPhase(); });
    GM.on('arena:generated', function (e) {
      if (GM.state.phase === 'setup' || GM.state.phase === 'boot') {
        const s = e && e.seed != null ? e.seed >>> 0 : GM.state.seed >>> 0;
        if (s !== setup.seed && !setup.busy) {
          setup.seed = s;
          if (parseSeed(setup.seedText) !== s) setup.seedText = '';
          if (ui.built && GM.state.phase === 'setup') { regenRoster(true); syncSetup(); }
        }
      }
      setup.mapVer = -1;
    });
    GM.on('game:new', function () {
      if (ui.cardsFor !== GM.state.contestants) buildCards();
      buildPowerButtons(true);
      setDockTab(ui.dockTab);
      refreshAll();
    });
    GM.on('countdown:tick', onCountdown);
    GM.on('game:start', function () { show(dom.cd, false); refreshAll(); });
    GM.on('game:end', function () {
      cancelTargeting();
      ui.victoryAt = now() + VICTORY_DELAY;
      ui.victoryShown = false;
      ui.victoryClosed = false;
      ui.rosterDirty = true;
    });
    GM.on('game:pause', function () { if (ui.built) refreshSpeed(); });
    GM.on('game:speed', function () { if (ui.built) refreshSpeed(); });
    GM.on('select', function (e) {
      if (!ui.built) return;
      refreshSel(false);
      refreshRoster(false);
      if (ui.logSelOnly) applyLogSel();
      if (e && e.id != null && !tgt.active && ui.dockTab !== 'contestant' && isGamePhase(GM.state.phase)) setDockTab('contestant');
    });
    GM.on('log', function (en) { if (en && isGamePhase(GM.state.phase)) ui.logQueue.push(en); });
    GM.on('contestant:died', onDied);
    GM.on('announce', onAnnounce);
    GM.on('recap:night', onRecap);
    GM.on('lang:changed', retranslate);
    GM.on('canvas:click', onCanvasClick);
    GM.on('canvas:hover', onCanvasHover);
    GM.on('weather:changed', function () { if (ui.built && isGamePhase(GM.state.phase)) refreshTopbar(); });
    GM.on('power:used', function () { ui.rosterDirty = true; });
  }

  // ================================================================ frame
  function frame(realDt) {
    if (!ui.built) return;
    const st = GM.state;
    if (st.phase !== ui.phase) applyPhase(st.phase);
    const dt = realDt > 0 ? Math.min(realDt, 0.1) : 0;
    tipFrame();
    if (dom.toast && ui.toastUntil && now() > ui.toastUntil) { ui.toastUntil = 0; tog(dom.toast, 'on', false); }
    if (st.phase === 'setup' || st.phase === 'boot') { setupFrame(); return; }
    ui.acc += dt;
    ui.slowAcc += dt;
    ui.feedAcc += dt;
    refreshAnns();
    if (ui.acc >= REFRESH_DT) {
      ui.acc = 0;
      flushLog();
      refreshTopbar();
      refreshCam();
      refreshPowers();
      refreshSel(false);
      refreshKillfeed();
      if (tgt.active) renderTargetHint();
    }
    if (ui.slowAcc >= 0.25 || ui.rosterDirty) {
      ui.slowAcc = 0;
      ui.rosterDirty = false;
      refreshRoster(false);
      refreshFeeds();
    }
    if (ui.feedAcc >= 1) {
      ui.feedAcc = 0;
      // own excitement samples when the Audience keeps no history
      const A = GM.Audience;
      if (A && !(Array.isArray(A.history) && A.history.length >= 2)) {
        ui.excAcc = (ui.excAcc || 0) + 1;
        if (ui.excAcc >= 5 && st.phase === 'running' && !st.paused) {
          ui.excAcc = 0;
          ui.excHistory.push(+A.excitement || 0);
          if (ui.excHistory.length > 400) ui.excHistory.shift();
        }
      }
      drawSpark();
      refreshErrors();
      if (ui.smiteArmedUntil && now() > ui.smiteArmedUntil) ui.smiteArmedUntil = 0;
    }
    if (ui.recapData && now() > ui.recapUntil) hideRecap();
    if (st.phase === 'ended' && !ui.victoryShown && !ui.victoryClosed && ui.victoryAt && now() >= ui.victoryAt) showVictory();
  }

  // ================================================================ system
  GM.registerSystem({
    name: 'UI',
    order: 100,
    init() {
      initSetupPrefs();
      buildAll();
      setup.seed = GM.state.seed >>> 0;
      setSort(ui.sort);
      setLogFilter(ui.logFilter);
      setPowCat(ui.powCat);
      setDockTab(ui.dockTab);
      openDrawer(null);
      syncLangButtons();
      document.title = t('app.title');
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', function () { ui.shift = false; hideTip(); });
      window.addEventListener('contextmenu', function (e) {
        if (tgt.active && dom.root && !dom.root.contains(e.target)) { e.preventDefault(); cancelTargeting(); }
      });
      window.addEventListener('resize', function () { closePopover(); hideTip(); setup.mapVer = -1; });
      subscribe();
    },
    clear() {
      if (!ui.built) return;
      clearGameUI();
    },
    reset() {
      if (!ui.built) return;
      buildCards();
      buildPowerButtons(true);
      setDockTab(ui.dockTab);
    },
    frame(realDt) { frame(realDt); },
  });

  // =========================================================== public API
  const UI = (GM.UI = {
    hoverId: null,
    /** A power is armed and waits for a target. */
    /** The setup options the player chose (quality, feeds, name tags, assistant): a copy. */
    getOptions() { return Object.assign({}, setup.opts); },
    isTargeting() { return tgt.active; },
    /** The armed power (shared object, read-only for callers) or null. */
    targeting() { return tgt.active ? tgt : null; },
    /** Use the armed power at a world point (minimap click). Returns true when handled. */
    targetPoint(x, z) { return safe('targetPoint', targetPoint, x, z) === true; },
    /** Move the aim reticle (minimap hover). */
    aimPoint(x, z) { safe('aimPoint', aimPoint, x, z); },
    clearAim() { safe('clearAim', clearAim); },
    startTargeting(id, optionId) { safe('startTargeting', startTargeting, id, optionId); },
    cancelTargeting() { safe('cancelTargeting', cancelTargeting); },
    /** Same as clicking the power button. */
    usePower(id) { safe('usePower', usePower, id); },
    /** Roster click: select + follow, or use the armed power on this contestant. */
    pickContestant(id) { safe('pickContestant', pickContestant, id); },
    showHelp() { safe('showHelp', showHelp); },
    hideHelp() { safe('hideHelp', hideHelp); },
    toggleHelp() { safe('toggleHelp', toggleHelp); },
    /** Small message at the bottom of the main view. */
    toast(key, params) { safe('toast', toast, key, params); },
    setDockTab(tab) { safe('setDockTab', setDockTab, tab); },
    openDrawer(side) { safe('openDrawer', openDrawer, side); },
    /** Force a full refresh of the live panels. */
    refresh() { if (ui.built && isGamePhase(GM.state.phase)) safe('refresh', refreshAll); },
  });
})();
