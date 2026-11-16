// Sound, synthesized live with WebAudio: no audio files, no network, nothing to load.
// Every effect is a short envelope over filtered noise or an oscillator, built once and
// reused, so firing never allocates.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let enabled = false;

  function ensure() {
    if (context) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
      const length = context.sampleRate * 0.5;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      enabled = true;
      return true;
    } catch {
      return false;
    }
  }

  function noise(when, duration, filterType, frequency, gainValue, q = 1) {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(when);
    source.stop(when + duration + 0.02);
  }

  function tone(when, duration, type, from, to, gainValue) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, when);
    if (to !== from) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), when + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, when);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function play(fn) {
    if (!ensure() || context.state === 'suspended') {
      if (context) context.resume().catch(() => {});
      return;
    }
    fn(context.currentTime);
  }

  return {
    unlock() {
      ensure();
      if (context && context.state === 'suspended') context.resume().catch(() => {});
    },
    get on() {
      return enabled;
    },
    shot(kind) {
      play((t) => {
        if (kind === 'longbow') {
          noise(t, 0.22, 'lowpass', 900, 0.9);
          tone(t, 0.12, 'sine', 160, 55, 0.7);
        } else if (kind === 'sparrow') {
          noise(t, 0.09, 'bandpass', 1600, 0.5, 0.8);
          tone(t, 0.06, 'sine', 200, 90, 0.35);
        } else if (kind === 'p9') {
          noise(t, 0.11, 'bandpass', 1200, 0.55, 0.8);
          tone(t, 0.07, 'sine', 180, 80, 0.4);
        } else {
          noise(t, 0.13, 'bandpass', 1400, 0.7, 0.8);
          tone(t, 0.08, 'sine', 190, 70, 0.5);
        }
      });
    },
    distantShot() {
      play((t) => {
        noise(t, 0.16, 'lowpass', 500, 0.22);
      });
    },
    dryClick() {
      play((t) => tone(t, 0.04, 'square', 900, 700, 0.12));
    },
    reload() {
      play((t) => {
        tone(t, 0.05, 'square', 500, 380, 0.14);
        tone(t + 0.18, 0.05, 'square', 620, 480, 0.14);
        tone(t + 0.55, 0.05, 'square', 760, 600, 0.16);
      });
    },
    hit() {
      play((t) => tone(t, 0.06, 'sine', 1250, 1250, 0.22));
    },
    kill() {
      play((t) => {
        tone(t, 0.07, 'sine', 880, 880, 0.22);
        tone(t + 0.08, 0.12, 'sine', 1320, 1320, 0.22);
      });
    },
    hurt() {
      play((t) => {
        noise(t, 0.12, 'lowpass', 300, 0.5);
        tone(t, 0.14, 'sine', 120, 60, 0.4);
      });
    },
    step() {
      play((t) => noise(t, 0.05, 'lowpass', 320, 0.1));
    },
    grenadeThrow() {
      play((t) => noise(t, 0.12, 'bandpass', 700, 0.2, 2));
    },
    grenadeBounce() {
      play((t) => tone(t, 0.05, 'sine', 300, 180, 0.18));
    },
    explosion() {
      play((t) => {
        noise(t, 0.9, 'lowpass', 240, 1.0);
        tone(t, 0.7, 'sine', 90, 28, 0.9);
        noise(t + 0.05, 0.3, 'bandpass', 900, 0.3, 0.6);
      });
    },
    plantBeep(final) {
      play((t) => tone(t, final ? 0.3 : 0.09, 'sine', final ? 1560 : 1040, final ? 1560 : 1040, 0.2));
    },
    defuseBeep() {
      play((t) => tone(t, 0.09, 'sine', 780, 780, 0.18));
    },
    buy() {
      play((t) => {
        tone(t, 0.06, 'sine', 660, 660, 0.18);
        tone(t + 0.07, 0.09, 'sine', 990, 990, 0.18);
      });
    },
    denied() {
      play((t) => tone(t, 0.12, 'square', 220, 160, 0.14));
    },
    roundWin() {
      play((t) => {
        tone(t, 0.14, 'sine', 523, 523, 0.2);
        tone(t + 0.14, 0.14, 'sine', 659, 659, 0.2);
        tone(t + 0.28, 0.24, 'sine', 784, 784, 0.22);
      });
    },
    roundLose() {
      play((t) => {
        tone(t, 0.18, 'sine', 392, 392, 0.2);
        tone(t + 0.18, 0.3, 'sine', 311, 311, 0.2);
      });
    },
  };
}
