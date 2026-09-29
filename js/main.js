/* ==========================================================================
 * main.js — boot, game flow and the main loop.
 *
 *   GM.Game.boot()                 on DOMContentLoaded
 *   GM.Game.previewArena(seed)     regenerate terrain for the setup screen
 *   GM.Game.newGame(settings)      start a new Games (countdown -> running)
 *   GM.Game.toSetup()              back to the setup screen
 *   GM.Game.setSpeed(x) / togglePause(force?) / stepSpeed(+1|-1)
 *
 * Phases: 'boot' -> 'setup' -> 'countdown' -> 'running' -> 'ended' -> 'setup' ...
 * Owner: core.
 * ========================================================================== */
(function () {
  'use strict';
  const GM = window.GM;
  const CFG = GM.CFG;
  const Game = (GM.Game = {});

  let lastNow = 0;
  let booted = false;

  function call(sys, method, arg) {
    const fn = sys[method];
    if (typeof fn !== 'function') return;
    try {
      fn.call(sys, arg);
    } catch (e) {
      GM.reportError(sys.name + '.' + method, e);
    }
  }
  function callAll(method, arg) {
    for (const s of GM.systems) call(s, method, arg);
  }

  // ------------------------------------------------------------------ boot
  Game.boot = function () {
    if (booted) return;
    booted = true;
    if (!window.THREE) {
      showFatal();
      return;
    }
    GM.i18n.init();
    GM.state.phase = 'boot';
    callAll('init');
    Game.previewArena(GM.randomSeed());
    Game.toSetup();
    lastNow = performance.now();
    requestAnimationFrame(loop);
  };

  function showFatal() {
    const div = document.createElement('div');
    div.style.cssText =
      'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
      'background:#07090c;color:#e9e4d8;font:16px/1.5 system-ui,sans-serif;padding:24px;text-align:center';
    div.textContent =
      'The 3D engine could not load. Please check your internet connection and reload the page. / ' +
      'A 3D motor nem töltődött be. Ellenőrizd az internetkapcsolatot, és töltsd újra az oldalt.';
    document.body.appendChild(div);
  }

  // ------------------------------------------------------------ game flow
  /** Generate terrain for a seed and let World/Minimap rebuild (setup preview). */
  Game.previewArena = function (seed) {
    seed = seed >>> 0;
    GM.state.seed = seed;
    GM.R.seed(seed);
    if (GM.Terrain && GM.Terrain.generate) {
      try {
        GM.Terrain.generate(seed);
      } catch (e) {
        GM.reportError('Terrain.generate', e);
      }
    }
    GM.emit('arena:generated', { seed });
  };

  /** Return to the setup screen (clears all game entities). */
  Game.toSetup = function () {
    const st = GM.state;
    callAll('clear');
    st.phase = 'setup';
    st.paused = false;
    st.speed = 1;
    st.tributes = [];
    st.mutts = [];
    st.selectedId = null;
    st.interests = [];
    GM.emit('game:setup', {});
  };

  /** Fill in defaults for a settings object coming from the setup screen. */
  Game.normalizeSettings = function (s) {
    s = Object.assign(
      {
        seed: GM.state.seed || GM.randomSeed(),
        tributeCount: CFG.DEFAULT_TRIBUTES,
        mix: 'balanced',
        roster: null,
        sandbox: false,
        autoGM: false,
        quality: 'high',
        feeds: true,
        nameTags: true,
        startSpeed: 1,
      },
      s || {}
    );
    s.seed = s.seed >>> 0;
    s.tributeCount = GM.U.clamp(s.tributeCount | 0, CFG.MIN_TRIBUTES, CFG.MAX_TRIBUTES);
    if (!Array.isArray(s.roster) || s.roster.length < CFG.MIN_TRIBUTES) {
      s.roster = GM.Tributes && GM.Tributes.generateRoster
        ? GM.Tributes.generateRoster(s.tributeCount, s.mix, s.seed)
        : [];
    }
    s.tributeCount = s.roster.length;
    return s;
  };

  /** Start a new Games. Terrain is always regenerated (clears old deformations). */
  Game.newGame = function (settings) {
    const s = Game.normalizeSettings(settings);
    callAll('clear');
    GM.resetState(s);
    GM.R.seed(s.seed);
    if (GM.Terrain && GM.Terrain.generate) {
      try {
        GM.Terrain.generate(s.seed);
      } catch (e) {
        GM.reportError('Terrain.generate', e);
      }
    }
    GM.emit('arena:generated', { seed: s.seed });
    GM.R.seed((s.seed ^ 0x5bd1e995) >>> 0); // separate stream for gameplay
    callAll('reset', s);
    GM.state.phase = 'countdown';
    GM.state.countdown = CFG.COUNTDOWN;
    GM.state.speed = s.startSpeed || 1;
    GM.emit('game:new', { settings: s });
    GM.emit('countdown:tick', { n: CFG.COUNTDOWN });
  };

  function startGames() {
    const st = GM.state;
    st.phase = 'running';
    st.countdown = 0;
    st.time = 0;
    GM.emit('game:start', {});
    GM.announce('ann.bloodbath', {}, { style: 'danger', duration: 4 });
    GM.log('system', 'log.gamesBegin', { n: st.tributes.length }, { important: true });
  }

  function checkVictory() {
    const st = GM.state;
    if (!st.tributes.length) return;
    let alive = 0;
    let last = null;
    for (const t of st.tributes) {
      if (t.alive) {
        alive++;
        last = t;
      }
    }
    if (alive <= 1) endGames(alive === 1 ? last : null);
  }

  function endGames(winner) {
    const st = GM.state;
    st.phase = 'ended';
    st.winner = winner ? winner.id : null;
    st.endTime = st.time;
    if (winner) {
      winner.placement = 1;
      GM.announce('ann.victor', { name: winner.name, district: winner.district }, { style: 'gold', duration: 7 });
      GM.log('system', 'log.victor', { name: winner.name, district: winner.district }, {
        important: true,
        tributeIds: [winner.id],
        pos: winner.pos,
      });
      GM.addInterest({ pos: winner.pos, score: 20, duration: 60, followId: winner.id, kind: 'victor', key: 'victor' });
    } else {
      GM.announce('ann.noVictor', {}, { style: 'danger', duration: 7 });
      GM.log('system', 'log.noVictor', {}, { important: true });
    }
    GM.emit('game:end', { winner: winner || null });
  }

  // ---------------------------------------------------- speed and pausing
  Game.setSpeed = function (speed) {
    const st = GM.state;
    speed = GM.U.clamp(+speed || 1, CFG.SPEEDS[0], CFG.SPEEDS[CFG.SPEEDS.length - 1]);
    if (st.speed === speed) return;
    st.speed = speed;
    GM.emit('game:speed', { speed });
  };
  /** dir = +1 faster, -1 slower (steps through CFG.SPEEDS). */
  Game.stepSpeed = function (dir) {
    const sp = CFG.SPEEDS;
    let i = sp.indexOf(GM.state.speed);
    if (i < 0) i = 1;
    Game.setSpeed(sp[GM.U.clamp(i + (dir > 0 ? 1 : -1), 0, sp.length - 1)]);
  };
  Game.togglePause = function (force) {
    const st = GM.state;
    const p = typeof force === 'boolean' ? force : !st.paused;
    if (p === st.paused) return;
    st.paused = p;
    GM.emit('game:pause', { paused: p });
  };

  // --------------------------------------------------------- bookkeeping
  GM.on('tribute:died', function (e) {
    const st = GM.state;
    const t = e && e.tribute;
    if (!t) return;
    st.deaths.push({
      id: t.id,
      killerId: e.killer ? e.killer.id : null,
      cause: e.cause || 'unknown',
      weapon: e.weapon || null,
      time: st.time,
      day: st.day,
    });
    st.fallenSinceRecap.push(t.id);
    if (e.killer) st.stats.kills++;
  });

  GM.on('night:start', function (e) {
    const st = GM.state;
    if (st.phase !== 'running') return;
    const fallen = st.fallenSinceRecap.slice();
    st.fallenSinceRecap.length = 0;
    GM.emit('recap:night', { day: e ? e.day : st.day, fallen });
  });

  GM.on('power:used', function () {
    GM.state.stats.powersUsed++;
  });

  // ------------------------------------------------------------ main loop
  function simulate(dt) {
    const st = GM.state;
    if (st.phase === 'countdown') {
      const before = Math.ceil(st.countdown);
      st.countdown -= dt;
      const after = Math.ceil(st.countdown);
      if (after !== before && after > 0) GM.emit('countdown:tick', { n: after });
      if (st.countdown <= 0) startGames();
    } else {
      st.time += dt;
    }
    callAll('update', dt);
    if (st.phase === 'running') checkVictory();
  }

  function loop(now) {
    requestAnimationFrame(loop);
    let realDt = (now - lastNow) / 1000;
    lastNow = now;
    if (!(realDt > 0)) realDt = 0;
    if (realDt > 0.1) realDt = 0.1;

    const st = GM.state;
    st.realTime += realDt;

    const simActive =
      !st.paused && (st.phase === 'countdown' || st.phase === 'running' || st.phase === 'ended');
    if (simActive && realDt > 0) {
      let simDt = realDt * st.speed;
      let steps = Math.ceil(simDt / CFG.SIM_STEP - 1e-6);
      if (steps < 1) steps = 1;
      if (steps > CFG.MAX_SUBSTEPS) {
        steps = CFG.MAX_SUBSTEPS; // overloaded: run slower than requested instead of freezing
        simDt = steps * CFG.SIM_STEP;
      }
      const dt = simDt / steps;
      for (let i = 0; i < steps; i++) simulate(dt);
    }

    GM.pruneInterests();
    callAll('frame', realDt);

    try {
      if (GM.Cameras && typeof GM.Cameras.render === 'function') {
        GM.Cameras.render();
      } else if (GM.World && GM.World.renderer && GM.World.scene && GM.Cameras && GM.Cameras.main) {
        GM.World.renderer.render(GM.World.scene, GM.Cameras.main);
      }
    } catch (e) {
      GM.reportError('render', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', Game.boot);
  } else {
    setTimeout(Game.boot, 0);
  }
})();
