// The DOM HUD: health, ammo, money, timer, score, killfeed, buy menu and overlays.
// It never touches the simulation; main.js pushes numbers in and reads callbacks out.
// In ?shot= capture mode the transient flashes hold, so a slow software renderer
// still catches them in the frame.
import { BUY_MENU } from './match.js';

const SHOT_MODE = new URLSearchParams(window.location.search).has('shot');
const HOLD_MS = SHOT_MODE ? 60000 : 110;

const OVERLAY_COPY = {
  start: {
    title: 'Ashline Yard',
    copy: 'A freight yard at dusk. Ember attacks, Slate defends. Plant the bomb at A or B — or clear the yard, one round at a time.',
    action: 'Click to play',
  },
  paused: {
    title: 'Ashline Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const banner = $('round-banner');
  const bannerTitle = $('round-banner-title');
  const bannerSub = $('round-banner-sub');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreEmber = $('score-ember');
  const scoreSlate = $('score-slate');
  const roundLabel = $('round-label');
  const killfeed = $('killfeed');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const crosshair = $('crosshair');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const buyHint = $('buy-hint');
  const bombBanner = $('bomb-banner');
  const bombText = $('bomb-text');
  const channel = $('channel');
  const channelLabel = $('channel-label');
  const channelFill = $('channel-fill');
  const grenadeCount = $('grenade-count');
  let hitTimer = 0;
  let damageTimer = 0;
  let bannerTimer = 0;
  let lastFeed = '';

  function renderBuy(money, owned, grenades, armor) {
    buyList.innerHTML = '';
    BUY_MENU.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'buy-row';
      const ownedMark = item.id === 'kevlar'
        ? (armor >= 50 ? 'OWNED' : '')
        : item.id === 'frag'
          ? (grenades >= 2 ? 'MAX' : `x${grenades}`)
          : (owned[item.id] ? 'OWNED' : '');
      const afford = money >= item.price && !ownedMark;
      row.classList.toggle('cant', !afford && !ownedMark);
      row.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${item.name}</span><span class="buy-blurb">${item.blurb}</span><span class="buy-price">$${item.price}</span><span class="buy-owned">${ownedMark}</span>`;
      buyList.appendChild(row);
    });
    buyMoney.textContent = `$${money}`;
  }

  return {
    setHealth(health, armor) {
      healthFill.style.width = `${Math.max(0, health)}%`;
      healthFill.classList.toggle('low', health <= 30);
      healthNum.textContent = String(Math.max(0, Math.ceil(health)));
      armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
    },
    setAmmo(mag, reserve, name) {
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = name;
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      moneyValue.textContent = `$${value}`;
    },
    setGrenades(count) {
      grenadeCount.textContent = count > 0 ? `◉ ${count}` : '';
    },
    setTimer(seconds, phase) {
      const total = Math.max(0, Math.ceil(seconds));
      timerValue.textContent = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
      timerValue.classList.toggle('urgent', seconds <= 10 && phase === 'live');
      timerValue.classList.toggle('buy', phase === 'buy');
    },
    setScore(ember, slate, round) {
      scoreEmber.textContent = String(ember);
      scoreSlate.textContent = String(slate);
      roundLabel.textContent = `ROUND ${round}`;
    },
    setKillfeed(entries) {
      const text = entries.map((entry) => entry.text).join('\n');
      if (text === lastFeed) return;
      lastFeed = text;
      killfeed.innerHTML = '';
      for (const entry of entries) {
        const line = document.createElement('div');
        line.className = entry.good ? 'feed-good' : 'feed-bad';
        line.textContent = entry.text;
        killfeed.appendChild(line);
      }
    },
    hitMarker(killed) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), HOLD_MS);
    },
    damageFlash() {
      damage.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damage.classList.remove('on'), SHOT_MODE ? 60000 : 220);
    },
    setSpread(pixels) {
      crosshair.style.setProperty('--gap', `${Math.round(pixels)}px`);
    },
    showBuy(money, owned, grenades, armor) {
      renderBuy(money, owned, grenades, armor);
      buyMenu.hidden = false;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    updateBuy(money, owned, grenades, armor) {
      if (!buyMenu.hidden) renderBuy(money, owned, grenades, armor);
    },
    setBuyHint(text) {
      buyHint.textContent = text;
    },
    showBomb(text, urgent) {
      bombText.textContent = text;
      bombBanner.hidden = false;
      bombBanner.classList.toggle('urgent', !!urgent);
    },
    hideBomb() {
      bombBanner.hidden = true;
    },
    channel(label, fraction) {
      if (fraction === null || fraction === undefined) {
        channel.hidden = true;
        return;
      }
      channel.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(fraction * 100)}%`;
    },
    showRoundBanner(heading, sub) {
      bannerTitle.textContent = heading;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      if (!SHOT_MODE) {
        bannerTimer = setTimeout(() => {
          banner.hidden = true;
        }, 3600);
      }
    },
    hideRoundBanner() {
      banner.hidden = true;
    },
    showOverlay(mode, extra) {
      const text = OVERLAY_COPY[mode];
      if (!text) return;
      title.textContent = extra && extra.title ? extra.title : text.title;
      copy.textContent = extra && extra.copy ? extra.copy : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
