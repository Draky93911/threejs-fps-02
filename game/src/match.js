// The match: rounds, money, the buy menu and the bomb. Ember attacks, Slate defends.
// A round is won by elimination, by the bomb going off, by a defuse, or by the clock
// with the bomb still in a pocket. First to five rounds takes the match.
import { WEAPONS, GRENADE } from './weapons.js';

export const BUY_TIME = 20;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const WIN_ROUNDS = 5;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;

export const BUY_MENU = [
  { id: 'kestrel', name: 'Kestrel AR', price: 2700, blurb: '30-round rifle. The all-rounder.' },
  { id: 'sparrow', name: 'Sparrow SMG', price: 1500, blurb: 'Fast, close, hungry for ammo.' },
  { id: 'longbow', name: 'Longbow DMR', price: 4100, blurb: 'One shot, one long sightline.' },
  { id: 'frag', name: 'Frag Grenade', price: 300, blurb: 'Bounces, beeps, clears a corner.' },
  { id: 'kevlar', name: 'Kevlar Vest', price: 650, blurb: '50 armor. Bullets hurt half as much.' },
];

export function createMatch(events) {
  const state = {
    phase: 'buy',
    round: 1,
    score: { ember: 0, slate: 0 },
    timer: BUY_TIME,
    money: 800,
    kills: 0,
    deaths: 0,
    owned: { p9: true },
    currentWeapon: 'p9',
    grenades: 0,
    armor: 0,
    bomb: { state: 'carried', site: null, pos: null, timer: 0, siteNode: -1, carrier: 'player' },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    killfeed: [],
    plantProgress: 0,
    defuseProgress: 0,
  };

  function feed(text, good) {
    state.killfeed.unshift({ text, good: !!good, at: Date.now() });
    if (state.killfeed.length > 5) state.killfeed.pop();
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.bomb = { state: 'carried', site: null, pos: null, timer: 0, siteNode: -1, carrier: 'player' };
    state.roundWinner = null;
    state.roundReason = '';
    state.plantProgress = 0;
    state.defuseProgress = 0;
    events.onRoundStart(state.round);
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.score[winner] += 1;
    const playerWon = winner === 'ember';
    state.money += playerWon ? WIN_REWARD : LOSS_REWARD;
    feed(playerWon ? `Round ${state.round} — Ember takes it (${reason})` : `Round ${state.round} — Slate takes it (${reason})`, playerWon);
    if (state.score[winner] >= WIN_ROUNDS) {
      state.phase = 'matchEnd';
      state.matchWinner = winner;
      events.onMatchEnd(winner);
      return;
    }
    state.phase = 'roundEnd';
    state.timer = 4;
    events.onRoundEnd(winner, reason);
  }

  function onKill(killerTeam, victimTeam, victimName, headshot) {
    if (killerTeam === 'ember') {
      state.money += KILL_REWARD;
      state.kills += 1;
    }
    feed(`${killerTeam === 'ember' ? 'Ember' : 'Slate'} ${headshot ? 'headshot ' : ''}▼ ${victimName}`, killerTeam === 'ember');
  }

  function onPlayerDeath() {
    state.deaths += 1;
  }

  function buy(itemId) {
    if (state.phase !== 'buy') return { ok: false, why: 'The buy window is closed.' };
    const item = BUY_MENU.find((entry) => entry.id === itemId);
    if (!item) return { ok: false, why: 'No such item.' };
    if (state.money < item.price) return { ok: false, why: `Need $${item.price}. You have $${state.money}.` };
    if (itemId === 'frag') {
      if (state.grenades >= GRENADE.maxCarry) return { ok: false, why: 'Already carrying two grenades.' };
      state.grenades += 1;
    } else if (itemId === 'kevlar') {
      if (state.armor >= 50) return { ok: false, why: 'Vest already at full armor.' };
      state.armor = 50;
    } else {
      if (state.owned[itemId]) return { ok: false, why: 'Already owned.' };
      state.owned[itemId] = true;
      state.currentWeapon = itemId;
      events.onWeaponBought(itemId);
    }
    state.money -= item.price;
    events.onBuy(item);
    return { ok: true };
  }

  function plant(site, siteNode, pos) {
    if (state.bomb.state !== 'carried') return false;
    state.bomb = { state: 'planted', site, pos: pos.clone(), timer: BOMB_TIME, siteNode, carrier: null };
    state.money += PLANT_REWARD;
    feed(`Bomb planted at site ${site} — $300`, true);
    events.onPlant(site);
    return true;
  }

  function defuse() {
    if (state.bomb.state !== 'planted') return false;
    state.bomb = { state: 'defused', site: state.bomb.site, pos: state.bomb.pos, timer: 0, siteNode: -1, carrier: null };
    feed('Bomb defused', false);
    events.onDefuse();
    return true;
  }

  function step(dt, alive) {
    if (state.phase === 'buy') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.phase = 'live';
        state.timer = ROUND_TIME;
        events.onLive();
      }
      return;
    }
    if (state.phase === 'roundEnd') {
      state.timer -= dt;
      if (state.timer <= 0) {
        state.round += 1;
        startRound();
        events.onResetRound();
      }
      return;
    }
    if (state.phase !== 'live') return;
    state.timer -= dt;
    if (state.bomb.state === 'planted') {
      state.bomb.timer -= dt;
      if (state.bomb.timer <= 0) {
        endRound('ember', 'the bomb detonated');
        return;
      }
    }
    if (alive.ember === 0 && state.bomb.state !== 'planted') {
      endRound('slate', 'Ember eliminated');
      return;
    }
    if (alive.slate === 0) {
      endRound('ember', state.bomb.state === 'planted' ? 'site cleared' : 'Slate eliminated');
      return;
    }
    if (state.timer <= 0) {
      endRound(state.bomb.state === 'planted' ? 'ember' : 'slate', state.bomb.state === 'planted' ? 'time ran out on the bomb' : 'time expired');
    }
  }

  return {
    state,
    startRound,
    endRound,
    onKill,
    onPlayerDeath,
    buy,
    plant,
    defuse,
    step,
    feed,
    weaponDef() {
      return WEAPONS[state.currentWeapon];
    },
  };
}
