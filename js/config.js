/* ==========================================================================
 * config.js — deployment settings. Loaded first; safe to edit, nothing here is secret.
 *
 *   leaderboardUrl   Base URL of the leaderboard service (server/worker.js deployed on
 *                    Cloudflare Workers), e.g. 'https://arena-leaderboard.you.workers.dev'.
 *                    Leave empty to run offline: the Daily screen then only shows the
 *                    player's own scores and records, and nothing is ever sent anywhere.
 *   packUrl          Store page where players can get the Expedition Pack (itch.io / Steam).
 *                    Locked arena cards link to it; empty = they just describe the pack.
 * ========================================================================== */
window.ARENA_CONFIG = window.ARENA_CONFIG || {
  leaderboardUrl: '',
  packUrl: '',
};
