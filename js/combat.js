/* ==========================================================================
 * combat.js — GM.Combat: melee and ranged attacks, hit chance, sneak
 * attacks, damage / stun / bleed / knockback, visible projectiles (arrows on
 * a ballistic arc that stick into the ground, spinning throwing knives),
 * hit effects, fight noise, 'combat:*' events and camera interest.
 *
 *   weaponOf(t, ranged)          ItemDef (fists when none)
 *   bestAttack(t, target)        {mode, range, def} | null   (option at the current distance)
 *   inRange(t, target)           bool
 *   tryAttack(t, target)         'hit' | 'miss' | 'cooldown' | 'range' | 'noammo' | false
 *   power(t)                     fighting strength estimate (AI threat checks)
 *   projectiles                  flying projectiles
 *   extras: hitChance(t, target, opt), isSneak(t, target), meleeReach(t, target),
 *           visibility(t), stuck (arrows / knives stuck in the ground)
 *
 * Timing: a swing resolves at the strike moment of the attack animation
 * (~half of the animation); a bow releases at the end of the draw. The hit
 * is rolled when the attack starts (tryAttack returns it), the damage is
 * applied at the strike / when the projectile arrives. A fleeing target can
 * still step out of reach before a swing lands.
 *
 * Per-tribute state lives in t.combat (created by Tributes):
 *   {next, mode, modeAt, lastAttackAt, lastTargetId, cooldown, swing, ...}
 *
 * Owner: TRIBUTES.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const U = GM.U;
  const CFG = GM.CFG;
  const THREE = window.THREE;

  // ================================================================ strings
  GM.i18n.add({
    en: {
      'log.combat.fight': '{a} and {b} are fighting.',
      'log.combat.sneak': '{a} attacks {b} by surprise!',
      'log.combat.sleep': '{a} attacks {b} in their sleep!',
      'log.combat.mutt': '{a} fights the mutts.',
      'log.combat.stun': '{a} hits {b} very hard. {b} cannot move for a moment.',
    },
    hu: {
      'log.combat.fight': 'Harc: {a} és {b} egymásra támadt.',
      'log.combat.sneak': '{a} váratlanul megtámadta: {b}!',
      'log.combat.sleep': '{a} alvás közben támadta meg: {b}!',
      'log.combat.mutt': '{a} a mutánsokkal harcol.',
      'log.combat.stun': '{a} nagyon erősen megütötte: {b}. Egy pillanatig nem tud mozogni.',
    },
  });

  // ============================================================= constants
  const SNEAK_MULT = 1.8;
  const SWITCH_TIME = 0.3;            // swapping melee <-> ranged
  const MODE_REVERT = 6;              // back to melee this long after the last shot
  const FIGHT_EVENT_GAP = 3;          // 'combat:fight' per pair at most every 3 s
  const FIGHT_LOG_GAP = 45;           // a new fight is logged after 45 s of peace
  const STUCK_TIME = { arrow: 25, knife: 14 };
  const CAP = { arrow: 80, knife: 32 };  // instanced capacity (flying + stuck)
  const MIN_RANGED = { bow: 2.2, throwing_knives: 1.6 };
  const DEFAULT_SPEED = { arrow: 42, knife: 24 };
  const BLOOD = 0x5e0b0b, BLOOD2 = 0x260303;
  const SPARK = 0xffd27a, SPARK2 = 0xff8a2a;

  const Combat = (GM.Combat = {
    projectiles: [],      // flying projectiles
    stuck: [],            // arrows / knives stuck in the ground (visual only)
  });

  // ================================================================ helpers
  function now() { return GM.state.time; }
  function num(v, d) { return typeof v === 'number' && v === v ? v : d; }
  function skill(t, name, d) { return t && t.skills ? num(t.skills[name], d) : d; }
  function lowQ() { const s = GM.state.settings; return !!(s && s.quality === 'low'); }
  function radiusOf(o) { return num(o && o.radius, 0.45); }
  function defs() { return GM.ItemDefs || {}; }
  function fists() {
    const D = defs();
    return D.fists || FALLBACK_FISTS;
  }
  const FALLBACK_FISTS = { id: 'fists', kind: 'melee', dmg: 6, range: 1.6, cd: 0.9, anim: 'punch', score: 10 };

  function tCall(name, a, b, c, d) {
    const T = GM.Tributes;
    if (!T || typeof T[name] !== 'function') return undefined;
    try { return T[name](a, b, c, d); } catch (e) { GM.reportError('Combat.Tributes.' + name, e); return undefined; }
  }
  function fx(name, a, b, c, d, e) {
    const F = GM.FX;
    if (!F || typeof F[name] !== 'function') return;
    try { F[name](a, b, c, d, e); } catch (err) { GM.reportError('Combat.FX.' + name, err); }
  }
  function heightAt(x, z) {
    const T = GM.Terrain;
    if (T && typeof T.heightAt === 'function') {
      const h = T.heightAt(x, z);
      if (h === h) return h;
    }
    return 0;
  }
  function waterAt(x, z) {
    const T = GM.Terrain;
    if (T && typeof T.isWater === 'function') {
      try { return !!T.isWater(x, z); } catch (e) { return false; }
    }
    return false;
  }
  function coverAt(x, z) {
    const T = GM.Terrain;
    if (T && typeof T.coverAt === 'function') {
      try { return U.clamp01(num(T.coverAt(x, z), 0)); } catch (e) { return 0; }
    }
    return 0;
  }
  function isNight() {
    const E = GM.Env;
    if (E && typeof E.isNight === 'function') {
      try { return !!E.isNight(); } catch (e) { /* fall through */ }
    }
    const tod = num(GM.state.timeOfDay, 0.5);
    return tod < num(CFG.DAWN, 0.25) || tod > num(CFG.DUSK, 0.79);
  }
  function canAct(t) {
    const T = GM.Tributes;
    if (T && typeof T.canAct === 'function') return T.canAct(t);
    return !!(t && t.alive && !t.sleeping && !(t.status && t.status.stun > 0));
  }
  function combatOf(t) {
    let c = t.combat;
    if (!c) c = t.combat = { next: 0, mode: 'melee', modeAt: -1e9, lastAttackAt: -1e9, lastTargetId: null };
    if (c.cooldown == null) {
      c.cooldown = 0; c.swing = ''; c.losId = -1; c.losAt = -1e9; c.losOk = true; c.opt = null;
    }
    return c;
  }
  function targetKey(tg) { return tg.kind === 'mutt' ? 1000000 + num(tg.id, 0) : tg.id; }

  /** Sight multiplier for a shooter (night, fog, weather; goggles help at night). */
  Combat.visibility = function (t) {
    let v = 1;
    const E = GM.Env;
    if (E && typeof E.visibility === 'function') {
      try { v = num(E.visibility(), 1); } catch (e) { v = 1; }
    } else if (isNight()) v = 0.4;
    if (t && t.inv && t.inv.goggles && isNight()) v = Math.max(v, 0.9);
    return U.clamp(v, 0.15, 1);
  };

  /** Point where hits land / projectiles aim, written into out. */
  function aimPoint(tg, out) {
    if (tg.kind === 'tribute') {
      const T = GM.Tributes;
      if (T && typeof T.chestPos === 'function') return T.chestPos(tg, out);
      return out.set(tg.pos.x, tg.pos.y + (tg.sleeping ? 0.25 : 1.2), tg.pos.z);
    }
    return out.set(tg.pos.x, tg.pos.y + (tg.type === 'wolf' ? 0.6 : 0.25), tg.pos.z);
  }

  // ================================================================ weapons
  /** Weapon definition: melee (default) or ranged; fists when there is none. */
  Combat.weaponOf = function (t, ranged) {
    const inv = t && t.inv;
    const D = defs();
    if (ranged) {
      const d = inv && inv.ranged ? D[inv.ranged] : null;
      return d && d.kind === 'ranged' ? d : fists();
    }
    const d = inv && inv.melee ? D[inv.melee] : null;
    return d && d.kind === 'melee' ? d : fists();
  };

  function rangedDef(t) {
    const inv = t && t.inv;
    if (!inv || !inv.ranged || !(inv.ammo > 0)) return null;
    const d = defs()[inv.ranged];
    return d && d.kind === 'ranged' ? d : null;
  }

  /** Melee reach against a target (weapon range + target radius). */
  Combat.meleeReach = function (t, tg) {
    return num(Combat.weaponOf(t, false).range, 1.6) + radiusOf(tg) + 0.1;
  };

  function effRange(t, def) {
    return num(def.range, 20) * (0.45 + 0.55 * Combat.visibility(t));
  }

  /** Straight line of sight over the terrain (cached ~0.4 s per attacker). */
  function lineOfSight(t, tg) {
    const c = combatOf(t);
    const key = targetKey(tg), nowT = now();
    if (c.losId === key && nowT - c.losAt < 0.4) return c.losOk;
    const ax = t.pos.x, ay = t.pos.y + 1.45, az = t.pos.z;
    aimPoint(tg, _los);
    const dx = _los.x - ax, dz = _los.z - az;
    const d = Math.sqrt(dx * dx + dz * dz);
    let ok = true;
    const n = Math.min(20, Math.floor(d / 2.5));
    for (let i = 1; i < n; i++) {
      const u = i / n;
      const y = ay + (_los.y - ay) * u;
      if (heightAt(ax + dx * u, az + dz * u) > y - 0.1) { ok = false; break; }
    }
    c.losId = key; c.losAt = nowT; c.losOk = ok;
    return ok;
  }

  function isSprinting(o) { return !!(o.nav && o.nav.moving && o.nav.mode === 'sprint'); }
  function isRunning(o) { return !!(o.nav && o.nav.moving && o.nav.mode === 'run'); }
  function isHelpless(o) { return !!(o.sleeping || (o.status && o.status.stun > 0)); }

  /** Is this an attack the target does not see coming (or a sleeping target)? */
  Combat.isSneak = function (t, tg, ranged) {
    if (!t || !tg || tg.kind !== 'tribute') return false;
    if (tg.sleeping) return true;
    const nowT = now();
    if (tg.lastAttackedBy === t.id && nowT - num(tg.lastAttackedAt, -1e9) < 6) return false;
    const tc = tg.combat;
    if (tc && tc.lastTargetId === t.id && nowT - num(tc.lastAttackAt, -1e9) < 6) return false;
    const m = tg.mind;
    let seen = true, known = false;
    if (m && m.visible && m.seenT && t.id < m.visible.length) {
      known = true;
      seen = !!m.visible[t.id] || nowT - m.seenT[t.id] < 1.5;
    }
    if (known && !seen) return true;
    if (ranged) return false;
    if (!known && tg.status && tg.status.stun > 0) return true;
    // a sneaking attacker that comes from behind
    if (t.sneaking || t.hidden) {
      const dx = t.pos.x - tg.pos.x, dz = t.pos.z - tg.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      const fwd = (Math.sin(num(tg.heading, 0)) * dx + Math.cos(num(tg.heading, 0)) * dz) / l;
      if (fwd < -0.25) return true;
    }
    return false;
  };

  function meleeHitChance(t, tg, sneak) {
    let p = 0.85;
    if (tg.kind === 'tribute') {
      if (isSprinting(tg)) p -= 0.2;
      else if (isRunning(tg)) p -= 0.06;
      if (isHelpless(tg)) p += 0.1;
      if (tg.swimming) p -= 0.05;
      p -= (skill(tg, 'speed', 0.5) - 0.5) * 0.1;
    } else if (tg.type === 'wasps') {
      p = 0.5;
    } else {
      p -= 0.05;
    }
    p += (skill(t, 'speed', 0.5) - 0.5) * 0.06;
    if (t.swimming) p -= 0.15;
    if (t.status && t.status.madness > 0) p -= 0.08;
    if (num(t.energy, 100) < 15) p -= 0.05;
    if (sneak) p += 0.08;
    return U.clamp(p, 0.05, 0.98);
  }

  function rangedHitChance(t, tg, d, def, sneak) {
    if (t.swimming) return 0;
    const range = Math.max(1, num(def.range, 20));
    let p = (0.95 - 0.55 * U.clamp01(d / range)) * (0.6 + 0.5 * skill(t, 'aim', 0.5)) * Math.sqrt(Combat.visibility(t));
    if (tg.kind === 'tribute') {
      if (isSprinting(tg)) p *= 0.75;
      else if (isRunning(tg)) p *= 0.88;
      if (tg.hidden) p *= 0.8;
      if (tg.swimming) p *= 0.9;
      if (isHelpless(tg)) p += 0.1;
      const cov = coverAt(tg.pos.x, tg.pos.z);
      if (cov > 0.05 && d > 6) p *= 1 - 0.35 * cov;
    } else if (tg.type === 'wolf') {
      p *= 0.85;
    } else {
      return 0;
    }
    if (sneak) p += 0.05;
    return U.clamp(p, 0.03, 0.97);
  }

  /** Hit chance for an attack option (for AI / UI). */
  Combat.hitChance = function (t, tg, opt) {
    if (!t || !tg || !tg.pos) return 0;
    opt = opt || Combat.bestAttack(t, tg);
    if (!opt) return 0;
    const sneak = Combat.isSneak(t, tg, opt.mode === 'ranged');
    if (opt.mode === 'ranged') return rangedHitChance(t, tg, U.distXZ(t.pos, tg.pos), opt.def, sneak);
    return meleeHitChance(t, tg, sneak);
  };

  function validPair(t, tg) {
    return !!(t && t.alive && t.pos && t.kind !== 'mutt' && tg && tg.alive && tg.pos && tg !== t);
  }

  /**
   * Best attack option at the current distance, or null when nothing reaches.
   * The returned object is reused per tribute (read it right away).
   */
  Combat.bestAttack = function (t, tg) {
    if (!validPair(t, tg)) return null;
    const c = combatOf(t);
    const d = U.distXZ(t.pos, tg.pos);
    const dy = Math.abs(tg.pos.y - t.pos.y);
    const md = Combat.weaponOf(t, false);
    const reach = num(md.range, 1.6) + radiusOf(tg) + 0.1;
    const meleeOk = d <= reach && dy < 2.2;
    const rd = rangedDef(t);
    let rangedOk = false, rHit = 0;
    if (rd && !t.swimming && !(tg.kind === 'mutt' && tg.type === 'wasps')) {
      const minD = num(MIN_RANGED[rd.id], 2);
      if (d >= minD && d <= effRange(t, rd) && lineOfSight(t, tg)) {
        rangedOk = true;
        rHit = rangedHitChance(t, tg, d, rd, false);
      }
    }
    let mode = null;
    if (meleeOk && rangedOk) {
      const me = num(md.dmg, 6) * meleeHitChance(t, tg, false) / Math.max(0.3, num(md.cd, 0.9));
      let re = num(rd.dmg, 20) * rHit / Math.max(0.3, num(rd.cd, 1.2));
      if (d < 3) re *= 0.7;                          // drawing a bow in someone's face
      const keepRanged = c.mode === 'ranged';
      mode = (keepRanged ? re * 1.2 >= me : re > me * 1.05) ? 'ranged' : 'melee';
    } else if (meleeOk) mode = 'melee';
    else if (rangedOk) mode = 'ranged';
    if (!mode) return null;
    let o = c.opt;
    if (!o) o = c.opt = { mode: 'melee', range: 0, def: null };
    o.mode = mode;
    if (mode === 'ranged') { o.def = rd; o.range = effRange(t, rd); } else { o.def = md; o.range = num(md.range, 1.6); }
    return o;
  };

  /** Can t hit the target from where it stands right now? */
  Combat.inRange = function (t, tg) { return !!Combat.bestAttack(t, tg); };

  function setMode(t, mode) {
    const c = combatOf(t);
    if (c.mode === mode) return;
    c.mode = mode;
    c.modeAt = now();
    tCall('refreshGear', t);
  }

  function damageRoll(t, def) {
    let f = def.id === 'bow' ? 0.85 + 0.3 * skill(t, 'aim', 0.5) : 0.8 + 0.45 * skill(t, 'strength', 0.5);
    let dmg = num(def.dmg, 6) * f * GM.R.range(0.88, 1.12);
    if (num(t.stamina, 100) < 10) dmg *= 0.85;
    if (t.emotion && t.emotion.rage > 0.7) dmg *= 1.1;
    return dmg;
  }

  // ============================================================ pending actions
  // A swing lands (or an arrow leaves the bow) at the strike moment of the
  // attack animation. Pooled records, resolved in update().
  const pending = [];
  const pendPool = [];
  function queue(type, a, tg, def, hit, dmg, sneak, delay) {
    const p = pendPool.pop() || {};
    p.type = type; p.a = a; p.tg = tg; p.def = def; p.hit = hit; p.dmg = dmg; p.sneak = sneak;
    p.wasAsleep = !!tg.sleeping;
    p.due = now() + delay;
    pending.push(p);
  }
  function freePending(p) { p.a = p.tg = p.def = null; pendPool.push(p); }

  // ============================================================== tryAttack
  /**
   * Attack a tribute or mutt: facing, cooldown, animation, hit roll,
   * projectiles, noise, events. -> 'hit'|'miss'|'cooldown'|'range'|'noammo'|false
   */
  Combat.tryAttack = function (t, tg) {
    if (!validPair(t, tg)) return false;
    if (typeof GM.isRunning === 'function' ? !GM.isRunning() : GM.state.phase !== 'running') return false;
    if (!canAct(t)) return false;
    const c = combatOf(t);
    const nowT = now();
    const opt = Combat.bestAttack(t, tg);
    if (!opt) {
      const inv = t.inv;
      if (inv && inv.ranged && !(inv.ammo > 0)) {
        const rd = defs()[inv.ranged];
        const d = U.distXZ(t.pos, tg.pos);
        if (rd && d <= num(rd.range, 20) && d > Combat.meleeReach(t, tg)) return 'noammo';
      }
      return 'range';
    }
    tCall('faceToward', t, tg.pos.x, tg.pos.z);
    if (nowT < num(c.next, 0)) return 'cooldown';
    if (c.mode !== opt.mode) {
      setMode(t, opt.mode);
      c.next = nowT + SWITCH_TIME;
      return 'cooldown';
    }
    const def = opt.def;
    const ranged = opt.mode === 'ranged';
    const sneak = Combat.isSneak(t, tg, ranged);
    let cd = num(def.cd, 0.9) * (1.08 - 0.16 * skill(t, 'speed', 0.5));
    if (num(t.stamina, 100) < 10) cd *= 1.2;
    c.cooldown = cd;
    c.next = nowT + cd;
    c.lastAttackAt = nowT;
    c.lastTargetId = tg.kind === 'tribute' ? tg.id : null;
    c.lastMuttAt = tg.kind === 'mutt' ? nowT : num(c.lastMuttAt, -1e9);
    c.swing = def.anim || (ranged ? 'throw' : 'punch');

    let hit, dmg = damageRoll(t, def);
    if (sneak) dmg *= SNEAK_MULT;
    if (ranged) {
      const inv = t.inv;
      if (!(inv.ammo > 0)) return 'noammo';
      inv.ammo -= 1;
      if (inv.ammo <= 0 && inv.ranged === 'throwing_knives') {
        inv.ammo = 0;
        inv.ranged = null;          // last knife: the hand switches back after the throw
      }
      hit = GM.R.chance(rangedHitChance(t, tg, U.distXZ(t.pos, tg.pos), def, sneak));
      const bow = def.id === 'bow' || def.projectile === 'arrow';
      const dur = bow ? 0.8 : 0.45;
      tCall('playAttack', t, c.swing, dur);
      queue('launch', t, tg, def, hit, dmg, sneak, dur * (bow ? 0.76 : 0.5));
    } else {
      hit = GM.R.chance(meleeHitChance(t, tg, sneak));
      const dur = U.clamp(num(def.cd, 0.9) * 0.55, 0.34, 0.65);
      tCall('playAttack', t, c.swing, dur);
      queue('strike', t, tg, def, hit, dmg, sneak, dur * 0.5);
    }
    const AI = GM.AI;
    if (AI && typeof AI.noise === 'function') {
      try { AI.noise(t.pos, 40, 'fight', t.id); } catch (e) { GM.reportError('Combat.noise', e); }
    }
    noteFight(t, tg);
    return hit ? 'hit' : 'miss';
  };

  // ================================================================ effects
  function bloodFX(pos, amount) {
    const n = lowQ() ? 5 : Math.min(16, 7 + Math.round(amount / 4));
    fx('burst', pos, { count: n, color: BLOOD, color2: BLOOD2, speed: 2.2, spread: 0.22, up: 1.1, gravity: -9.8, size: 0.11, life: 0.55, additive: false });
  }
  function sparkFX(pos, big) {
    fx('burst', pos, { count: lowQ() ? 5 : (big ? 12 : 8), color: SPARK, color2: SPARK2, speed: big ? 5.5 : 4, spread: 0.12, up: 1.4, gravity: -9.8, size: 0.07, life: 0.3, additive: true });
    if (big && !lowQ()) fx('flash', pos, 0xffc070, 1.2, 6, 0.08);
  }

  function emitAttack(a, tg, def, hit, damage, ranged) {
    GM.emit('combat:attack', {
      attacker: a, target: tg, weapon: def && def.id !== 'fists' ? def.id : null,
      hit: !!hit, damage: damage || 0, ranged: !!ranged, pos: a.pos,
    });
  }

  /**
   * Apply a landed hit. dirX/dirZ: direction of the blow (for knockback).
   * -> actual damage dealt
   */
  function applyHit(a, tg, def, dmg, sneak, wasAsleep, ranged, dirX, dirZ) {
    const weapon = def && def.id !== 'fists' ? def.id : null;
    if (tg.kind === 'mutt') {
      const M = GM.Mutts;
      if (!M || typeof M.damage !== 'function') return 0;
      try { return num(M.damage(tg, dmg, a), 0); } catch (e) { GM.reportError('Combat.Mutts.damage', e); return 0; }
    }
    const T = GM.Tributes;
    if (!T || typeof T.damage !== 'function') return 0;
    aimPoint(tg, _hit);
    const armored = !!(tg.inv && tg.inv.armor);
    const info = {
      cause: weapon ? 'weapon' : 'fists', attacker: a, mutt: null, weapon: weapon,
      pos: a.pos, sneak: !!sneak, ranged: !!ranged,
    };
    let actual = 0;
    try { actual = num(T.damage(tg, dmg, info), 0); } catch (e) { GM.reportError('Combat.damage', e); }
    if (!(actual > 0)) return 0;
    bloodFX(_hit, armored ? actual * 0.5 : actual);
    if (armored) sparkFX(_hit, false);
    if (!tg.alive) return actual;
    // knockback
    if (!tg.sleeping) {
      const str = 0.8 + 0.45 * skill(a, 'strength', 0.5);
      let force = ranged ? (def.id === 'bow' ? 1.2 : 0.5) : num(def.knockback, def.id === 'fists' ? 0.9 : 1.1) * str;
      if (actual > 25) force *= 1.1;
      tCall('knockback', tg, dirX, dirZ, force);
    }
    // mace stun
    if (def.stunChance > 0 && GM.R.chance(def.stunChance)) {
      tCall('stun', tg, num(def.stunTime, 1));
      if (GM.R.chance(0.35)) GM.log('combat', 'log.combat.stun', { a: a.name, b: tg.name }, { pos: tg.pos, tributeIds: [a.id, tg.id] });
    }
    // bleeding wounds
    if (def.bleed > 0 && GM.R.chance(Math.min(0.9, def.bleed * (sneak ? 1.3 : 1) * (armored ? 0.5 : 1)))) {
      tCall('setStatus', tg, 'bleeding', GM.R.range(6, 12));
      tg.woundBy = a.id;
    }
    if (sneak) {
      GM.log('combat', wasAsleep ? 'log.combat.sleep' : 'log.combat.sneak', { a: a.name, b: tg.name },
        { pos: tg.pos, tributeIds: [a.id, tg.id], important: wasAsleep });
    }
    return actual;
  }

  function resolveStrike(p) {
    const a = p.a, tg = p.tg, def = p.def;
    if (!a || !a.alive || !canAct(a) || !tg || !tg.alive || !tg.pos) return;
    let hit = p.hit;
    if (hit) {
      const d = U.distXZ(a.pos, tg.pos);
      if (d > num(def.range, 1.6) + radiusOf(tg) + 0.9 || Math.abs(tg.pos.y - a.pos.y) > 2.6) hit = false;
    }
    let dmg = 0;
    if (hit) {
      let dx = tg.pos.x - a.pos.x, dz = tg.pos.z - a.pos.z;
      if (!(dx * dx + dz * dz > 1e-6)) { dx = Math.sin(num(a.heading, 0)); dz = Math.cos(num(a.heading, 0)); }
      dmg = applyHit(a, tg, def, p.dmg, p.sneak, p.wasAsleep, false, dx, dz);
    } else if (tg.kind === 'tribute' && tg.inv && tg.inv.melee && canAct(tg) && def.id !== 'fists') {
      // parried: blades meet when the target faces the attacker
      const dx = a.pos.x - tg.pos.x, dz = a.pos.z - tg.pos.z;
      const l = Math.sqrt(dx * dx + dz * dz) || 1;
      const fwd = (Math.sin(num(tg.heading, 0)) * dx + Math.cos(num(tg.heading, 0)) * dz) / l;
      if (fwd > 0.3 && GM.R.chance(0.6)) {
        _hit.set((a.pos.x + tg.pos.x) * 0.5, Math.max(a.pos.y, tg.pos.y) + 1.25, (a.pos.z + tg.pos.z) * 0.5);
        sparkFX(_hit, true);
        const Au = GM.Audio;
        if (Au && typeof Au.play === 'function') {
          try { Au.play('clash', { pos: { x: _hit.x, y: _hit.y, z: _hit.z }, volume: 0.8 }); } catch (e) { /* audio is optional */ }
        }
      }
    }
    emitAttack(a, tg, def, hit, dmg, false);
  }

  // ============================================================ projectiles
  const projPool = [];
  function newProj() {
    return {
      kind: 'arrow', a: null, tg: null, def: null, hit: false, dmg: 0, sneak: false, wasAsleep: false,
      start: V3(), end: V3(), pos: V3(), dir: V3(0, 0, 1), q: THREE ? new THREE.Quaternion() : null,
      u: 0, T: 1, arc: 0, spin: 0, trailT: 0, until: 0,
    };
  }
  function V3(x, y, z) {
    if (THREE) return new THREE.Vector3(x || 0, y || 0, z || 0);
    return { x: x || 0, y: y || 0, z: z || 0, set: function (a, b, c) { this.x = a; this.y = b; this.z = c; return this; } };
  }
  function freeProj(p) { p.a = p.tg = p.def = null; projPool.push(p); }

  function launch(pd) {
    const a = pd.a, tg = pd.tg, def = pd.def;
    if (!a || !a.alive || !canAct(a) || !tg || !tg.alive || !tg.pos) {
      if (a && a.alive && a.inv) refund(a, def);   // interrupted: the arrow was never shot
      return;
    }
    tCall('faceToward', a, tg.pos.x, tg.pos.z);
    const p = projPool.pop() || newProj();
    p.kind = def.projectile === 'knife' || def.id === 'throwing_knives' ? 'knife' : 'arrow';
    p.a = a; p.tg = tg; p.def = def; p.hit = pd.hit; p.dmg = pd.dmg; p.sneak = pd.sneak; p.wasAsleep = pd.wasAsleep;
    // release point: right hand, in front of the chest
    const h = num(a.heading, 0);
    const sx = Math.sin(h), sz = Math.cos(h);
    p.start.set(a.pos.x + sx * 0.45 - sz * 0.12, a.pos.y + (a.look ? 1.42 * num(a.look.height, 1) : 1.42), a.pos.z + sz * 0.45 + sx * 0.12);
    aimPoint(tg, p.end);
    if (!p.hit) {
      // fly past the target and come down in the ground behind it
      let fx0 = p.end.x - p.start.x, fz0 = p.end.z - p.start.z;
      const l = Math.sqrt(fx0 * fx0 + fz0 * fz0) || 1;
      fx0 /= l; fz0 /= l;
      const side = (GM.R.chance(0.5) ? 1 : -1) * GM.R.range(0.7, 2.2);
      const beyond = GM.R.range(1.5, p.kind === 'arrow' ? 8 : 4);
      const ex = p.end.x + fx0 * beyond + fz0 * side, ez = p.end.z + fz0 * beyond - fx0 * side;
      p.end.set(ex, heightAt(ex, ez), ez);
    }
    const dist = Math.max(0.5, U.distXZ(p.start, p.end));
    const speed = num(def.speed, DEFAULT_SPEED[p.kind]);
    p.T = Math.max(0.08, dist / speed);
    p.arc = Math.min(4, 9.8 * p.T * p.T / 8);
    p.u = 0;
    p.spin = 0;
    p.trailT = 0;
    p.pos.copy ? p.pos.copy(p.start) : p.pos.set(p.start.x, p.start.y, p.start.z);
    p.dir.set(p.end.x - p.start.x, 0, p.end.z - p.start.z);
    if (p.dir.normalize) p.dir.normalize();
    Combat.projectiles.push(p);
    dirty = true;
    if (a.inv && !a.inv.ranged) setMode(a, 'melee');
    // the attack event goes out at release (bow sound), damage = expected
    const armorF = tg.kind === 'tribute' && tg.inv && tg.inv.armor ? 0.7 : 1;
    emitAttack(a, tg, def, p.hit, p.hit ? p.dmg * armorF : 0, true);
  }

  function refund(a, def) {
    const inv = a.inv;
    if (!def) return;
    if (inv.ranged === def.id) inv.ammo = (inv.ammo || 0) + 1;
    else if (!inv.ranged && def.id === 'throwing_knives') { inv.ranged = def.id; inv.ammo = 1; tCall('refreshGear', a); }
  }

  /** Put a projectile position on its arc at parameter u. */
  function arcPos(p, u, out) {
    return out.set(
      p.start.x + (p.end.x - p.start.x) * u,
      p.start.y + (p.end.y - p.start.y) * u + p.arc * 4 * u * (1 - u),
      p.start.z + (p.end.z - p.start.z) * u
    );
  }

  function updateProjectiles(dt) {
    const list = Combat.projectiles;
    if (!list.length) return;
    dirty = true;
    const trails = !lowQ();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      // hits follow the target so the arrow really arrives
      if (p.hit && p.tg && p.tg.alive && p.tg.pos) aimPoint(p.tg, p.end);
      else if (p.hit) { p.hit = false; p.end.y = heightAt(p.end.x, p.end.z); }
      const px = p.pos.x, py = p.pos.y, pz = p.pos.z;
      p.u = Math.min(1, p.u + dt / p.T);
      arcPos(p, p.u, p.pos);
      const dx = p.pos.x - px, dy = p.pos.y - py, dz = p.pos.z - pz;
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l > 1e-5) p.dir.set(dx / l, dy / l, dz / l);
      if (p.kind === 'knife') p.spin += dt * 20;
      if (trails) {
        p.trailT -= dt;
        if (p.trailT <= 0) {
          p.trailT = 0.05;
          fx('emit', p.pos, { count: 1, color: 0xf2efe6, speed: 0.1, spread: 0.02, up: 0, gravity: 0, size: 0.05, life: 0.25, additive: true });
        }
      }
      if (p.u >= 1) {
        list.splice(i, 1);
        arrive(p);
        continue;
      }
      if (!p.hit && p.u > 0.15) {
        const g = heightAt(p.pos.x, p.pos.z);
        if (p.pos.y <= g) {
          p.pos.y = g;
          list.splice(i, 1);
          land(p);
        }
      }
    }
  }

  function arrive(p) {
    const a = p.a, tg = p.tg;
    if (p.hit && tg && tg.alive) {
      let dmg = 0;
      if (a) dmg = applyHit(a, tg, p.def, p.dmg, p.sneak, p.wasAsleep, true, p.dir.x, p.dir.z);
      if (dmg > 0 || tg.kind === 'mutt') {
        freeProj(p);
        return;
      }
    }
    land(p);
  }

  /** A projectile that missed: sticks into the ground, sinks in water, or (knives) lies there to pick up. */
  function land(p) {
    const x = p.pos.x, z = p.pos.z;
    if (waterAt(x, z)) {
      const T = GM.Terrain;
      const wy = T && typeof T.waterLevel === 'function' ? num(T.waterLevel(), p.pos.y) : p.pos.y;
      _hit.set(x, wy + 0.05, z);
      fx('burst', _hit, { count: lowQ() ? 3 : 6, color: 0xdfefff, color2: 0x9cc4dc, speed: 1.6, spread: 0.1, up: 2, gravity: -9.8, size: 0.08, life: 0.4, additive: false });
      freeProj(p);
      return;
    }
    const g = heightAt(x, z);
    if (p.pos.y > g + 0.05) p.pos.y = g;       // e.g. a hit that did no damage drops to the ground
    _hit.set(x, p.pos.y + 0.05, z);
    fx('burst', _hit, { count: lowQ() ? 2 : 4, color: 0x8a7a5e, color2: 0x5b4d38, speed: 1.2, spread: 0.1, up: 1.2, gravity: -9.8, size: 0.07, life: 0.35, additive: false });
    if (p.kind === 'knife') {
      const I = GM.Items;
      if (I && typeof I.spawn === 'function' && GM.R.chance(0.5)) {
        try {
          I.spawn('throwing_knives', x, z, { amount: 1 });
          freeProj(p);
          return;
        } catch (e) { GM.reportError('Combat.knifeDrop', e); }
      }
    }
    // stick: tip in the ground, tilted along the flight
    let dy = Math.min(p.dir.y, p.kind === 'knife' ? -0.6 : -0.35);
    const hl = Math.sqrt(p.dir.x * p.dir.x + p.dir.z * p.dir.z) || 1;
    const k = Math.sqrt(Math.max(0, 1 - dy * dy)) / hl;
    p.dir.set(p.dir.x * k, dy, p.dir.z * k);
    const back = p.kind === 'knife' ? 0.11 : 0.25;
    p.pos.set(x - p.dir.x * back, p.pos.y - p.dir.y * back, z - p.dir.z * back);
    p.spin = 0;
    p.until = now() + STUCK_TIME[p.kind];
    p.a = p.tg = p.def = null;
    const st = Combat.stuck;
    st.push(p);
    // keep within the instanced capacity
    let n = 0;
    for (let i = 0; i < st.length; i++) if (st[i].kind === p.kind) n++;
    const max = CAP[p.kind] - 16;
    for (let i = 0; i < st.length && n > max; i++) {
      if (st[i].kind === p.kind) { freeProj(st[i]); st.splice(i, 1); i--; n--; }
    }
    dirty = true;
  }

  function updateStuck() {
    const st = Combat.stuck;
    if (!st.length) return;
    const nowT = now();
    for (let i = st.length - 1; i >= 0; i--) {
      if (st[i].until <= nowT) { freeProj(st[i]); st.splice(i, 1); dirty = true; }
    }
  }

  // ================================================================ meshes
  // One InstancedMesh per projectile kind (1 draw call each), vertex colours.
  let arrowIM = null, knifeIM = null, dirty = false;
  const _los = V3(), _hit = V3();
  const _m = THREE ? new THREE.Matrix4() : null;
  const _q = THREE ? new THREE.Quaternion() : null;
  const _q2 = THREE ? new THREE.Quaternion() : null;
  const _one = THREE ? new THREE.Vector3(1, 1, 1) : null;
  const _zero = THREE ? new THREE.Matrix4().makeScale(0, 0, 0) : null;
  const ZAXIS = THREE ? new THREE.Vector3(0, 0, 1) : null;
  const XAXIS = THREE ? new THREE.Vector3(1, 0, 0) : null;

  /** Merge simple parts into one vertex-coloured, non-indexed geometry. */
  function mergeParts(parts) {
    const geos = [];
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const g = parts[i].g.index ? parts[i].g.toNonIndexed() : parts[i].g;
      geos.push(g);
      total += g.attributes.position.count;
    }
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
    const c = new THREE.Color();
    let o = 0;
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i];
      const pa = g.attributes.position.array;
      const na = g.attributes.normal ? g.attributes.normal.array : null;
      c.setHex(parts[i].c);
      pos.set(pa, o * 3);
      if (na) nor.set(na, o * 3);
      const cnt = g.attributes.position.count;
      for (let k = 0; k < cnt; k++) {
        col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b;
      }
      o += cnt;
      g.dispose();
      if (parts[i].g !== g) parts[i].g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    return geo;
  }

  function arrowGeometry() {
    // along +Z, centred; slightly oversized so it reads from the cameras
    const shaft = new THREE.CylinderGeometry(0.018, 0.018, 0.86, 5, 1);
    shaft.rotateX(Math.PI / 2);
    const head = new THREE.ConeGeometry(0.045, 0.14, 5, 1);
    head.rotateX(Math.PI / 2);
    head.translate(0, 0, 0.49);
    const f1 = new THREE.BoxGeometry(0.004, 0.09, 0.16);
    f1.translate(0, 0, -0.35);
    const f2 = new THREE.BoxGeometry(0.09, 0.004, 0.16);
    f2.translate(0, 0, -0.35);
    return mergeParts([{ g: shaft, c: 0x8a6a45 }, { g: head, c: 0x9aa4ad }, { g: f1, c: 0xc0392b }, { g: f2, c: 0xe8e2d0 }]);
  }

  function knifeGeometry() {
    const blade = new THREE.ConeGeometry(0.035, 0.22, 4, 1);
    blade.rotateX(Math.PI / 2);
    blade.scale(1, 0.25, 1);
    blade.translate(0, 0, 0.06);
    const guard = new THREE.BoxGeometry(0.08, 0.02, 0.02);
    guard.translate(0, 0, -0.05);
    const grip = new THREE.BoxGeometry(0.025, 0.025, 0.11);
    grip.translate(0, 0, -0.11);
    return mergeParts([{ g: blade, c: 0xd9e1e8 }, { g: guard, c: 0x55585e }, { g: grip, c: 0x3a2a1c }]);
  }

  function ensureMeshes() {
    if (!THREE) return false;
    const W = GM.World;
    if (!W || !W.scene) return !!arrowIM;
    if (arrowIM) {
      // the scene may have been rebuilt: put the meshes back
      if (arrowIM.parent !== W.scene) W.scene.add(arrowIM);
      if (knifeIM.parent !== W.scene) W.scene.add(knifeIM);
      return true;
    }
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    arrowIM = new THREE.InstancedMesh(arrowGeometry(), mat, CAP.arrow);
    knifeIM = new THREE.InstancedMesh(knifeGeometry(), mat, CAP.knife);
    const list = [arrowIM, knifeIM];
    for (let i = 0; i < list.length; i++) {
      const im = list[i];
      im.name = i ? 'combat.knives' : 'combat.arrows';
      if (im.instanceMatrix.setUsage) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let k = 0; k < im.count; k++) im.setMatrixAt(k, _zero);
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      W.scene.add(im);
    }
    return true;
  }

  function writeInstance(p, im, idx) {
    _q.setFromUnitVectors(ZAXIS, p.dir);
    if (p.spin) {
      _q2.setFromAxisAngle(XAXIS, p.spin);
      _q.multiply(_q2);
    }
    _m.compose(p.pos, _q, _one);
    im.setMatrixAt(idx, _m);
  }

  function syncMeshes() {
    if (!dirty || !THREE) return;
    if (!arrowIM && !ensureMeshes()) return;
    dirty = false;
    let na = 0, nk = 0;
    const lists = [Combat.projectiles, Combat.stuck];
    for (let l = 0; l < 2; l++) {
      const list = lists[l];
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.kind === 'knife') { if (nk < CAP.knife) writeInstance(p, knifeIM, nk++); } else if (na < CAP.arrow) writeInstance(p, arrowIM, na++);
      }
    }
    arrowIM.count = na;
    knifeIM.count = nk;
    arrowIM.instanceMatrix.needsUpdate = true;
    knifeIM.instanceMatrix.needsUpdate = true;
  }

  // ================================================================ fights
  const fightAt = new Map();   // pair key -> last attack time
  const fightEvt = new Map();  // pair key -> last 'combat:fight' time
  const muttLogAt = new Map(); // tribute id -> last mutt-fight log time

  function noteFight(a, b) {
    const nowT = now();
    const mid = { x: (a.pos.x + b.pos.x) * 0.5, y: Math.max(a.pos.y, b.pos.y), z: (a.pos.z + b.pos.z) * 0.5 };
    if (b.kind === 'mutt') {
      const key = 'fight:mutt-' + a.id;
      const lastE = fightEvt.get(key);
      if (lastE == null || nowT - lastE >= FIGHT_EVENT_GAP) {
        fightEvt.set(key, nowT);
        GM.emit('combat:fight', { a: a, b: b, pos: mid });
        GM.addInterest({
          pos: mid, score: 5, duration: 6, key: key, kind: 'fight', followId: a.id,
          label: { key: 'cam.fightMutt', params: { a: a.name, mutt: '@mutt.' + (b.type === 'wasps' ? 'wasps' : 'wolf') } },
        });
      }
      const lastL = muttLogAt.get(a.id);
      if (lastL == null || nowT - lastL > FIGHT_LOG_GAP) GM.log('combat', 'log.combat.mutt', { a: a.name }, { pos: a.pos, tributeIds: [a.id] });
      muttLogAt.set(a.id, nowT);
      return;
    }
    const lo = Math.min(a.id, b.id), hi = Math.max(a.id, b.id);
    const key = 'fight:' + lo + '-' + hi;
    const last = fightAt.get(key);
    fightAt.set(key, nowT);
    if (last == null || nowT - last > FIGHT_LOG_GAP) {
      GM.log('combat', 'log.combat.fight', { a: a.name, b: b.name }, { pos: mid, tributeIds: [a.id, b.id] });
    }
    const lastE = fightEvt.get(key);
    if (lastE != null && nowT - lastE < FIGHT_EVENT_GAP) return;
    fightEvt.set(key, nowT);
    GM.emit('combat:fight', { a: a, b: b, pos: mid });
    const hurt = Math.min(num(a.health, 100), num(b.health, 100)) < 30;
    GM.addInterest({
      pos: mid, score: 6 + (hurt ? 1.5 : 0), duration: 6, key: key, kind: 'fight', followId: a.id,
      label: { key: 'cam.fight', params: { a: a.name, b: b.name } },
    });
  }

  /** Put the ranged weapon away when a tribute has not shot for a while. */
  let modeT = 0;
  function revertModes(dt) {
    modeT -= dt;
    if (modeT > 0) return;
    modeT = 1;
    const list = GM.state.tributes;
    const nowT = now();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const c = t && t.alive && t.combat;
      if (!c || c.mode !== 'ranged') continue;
      if (!t.inv || !t.inv.ranged || nowT - num(c.lastAttackAt, -1e9) > MODE_REVERT) setMode(t, 'melee');
    }
  }

  // ================================================================ power
  /**
   * Fighting strength estimate (~ health x damage per second x strength x
   * armor x condition). Fists at full health ~6, a sword ~25, a bow ~20.
   */
  Combat.power = function (t) {
    if (!t || !t.alive) return 0;
    if (t.kind === 'mutt') {
      const frac = num(t.health, 50) / Math.max(1, num(t.maxHealth, 50));
      return (t.type === 'wasps' ? 30 : 20) * U.clamp(frac, 0.1, 1);
    }
    const md = Combat.weaponOf(t, false);
    let best = num(md.dmg, 6) * 0.85 / Math.max(0.3, num(md.cd, 0.9));
    const rd = rangedDef(t);
    if (rd) {
      const ammoF = Math.min(1, t.inv.ammo / 4);
      const r = num(rd.dmg, 20) * 0.55 * (0.6 + 0.5 * skill(t, 'aim', 0.5)) / Math.max(0.3, num(rd.cd, 1.2)) * 1.25 * ammoF;
      if (r > best) best = r;
    }
    const str = 0.8 + 0.45 * skill(t, 'strength', 0.5);
    let f = num(t.health, 100) / 100;
    if (t.inv && t.inv.armor) f *= 1.35;
    if (num(t.stamina, 100) < 15) f *= 0.85;
    if (num(t.energy, 100) < 15) f *= 0.9;
    if (t.sleeping || (t.status && t.status.stun > 0)) f *= 0.5;
    return Math.max(0.05, best * str * f);
  };

  // ================================================================ system
  function clearAll() {
    for (let i = 0; i < pending.length; i++) freePending(pending[i]);
    pending.length = 0;
    const lists = [Combat.projectiles, Combat.stuck];
    for (let l = 0; l < 2; l++) {
      const list = lists[l];
      for (let i = 0; i < list.length; i++) freeProj(list[i]);
      list.length = 0;
    }
    fightAt.clear();
    fightEvt.clear();
    muttLogAt.clear();
    modeT = 0;
    if (arrowIM) { arrowIM.count = 0; knifeIM.count = 0; }
    dirty = false;
  }

  GM.registerSystem({
    name: 'Combat',
    order: 70,
    init() {
      ensureMeshes();
    },
    clear() {
      clearAll();
    },
    reset() {
      ensureMeshes();
    },
    update(dt) {
      // due swings / releases (they may add projectiles)
      if (pending.length) {
        const nowT = now();
        for (let i = 0; i < pending.length; i++) {
          const p = pending[i];
          if (p.due > nowT) continue;
          pending.splice(i, 1);
          i--;
          try {
            if (p.type === 'launch') launch(p); else resolveStrike(p);
          } catch (e) { GM.reportError('Combat.resolve', e); }
          freePending(p);
        }
      }
      updateProjectiles(dt);
      updateStuck();
      revertModes(dt);
    },
    frame() {
      syncMeshes();
    },
  });
})();
