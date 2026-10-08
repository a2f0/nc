import type { NoiseType } from "./noiseType";

// Each noise lands at roughly the same RMS level (about -17 dBFS) with headroom for peaks.
// Waves average about -23 dBFS, so their crests, at about -14, don't clip.
const WHITE_GAIN = 0.25;
const PINK_GAIN = 0.08;
const BROWN_GAIN = 2.46;
const FAN_GAIN = 0.093;
const WAVES_GAIN = 0.085;

// Fan: a five-blade fan at 1,200 RPM. The air is pink noise with its highs rolled off,
// throbbing slightly each time a blade passes, over a low hum at the blade rate.
const FAN_ROTATION_HZ = 20;
const FAN_BLADES = 5;
const FAN_AIR_CUTOFF_HZ = 1_200;
const FAN_BLADE_THROB = 0.12;
const FAN_ROTATION_WOBBLE = 0.04;
const FAN_HUM_Q = 16;
// The hum's band-pass filters let through only a sliver of the noise, hence the large gains.
const FAN_HUM = 40;
const FAN_HUM_OVERTONE = 20;

// Waves: each swells for 3.5 to 6 seconds, breaks, and washes out over 4 to 7 seconds,
// louder and brighter as it swells, over a quiet, dark bed of distant surf. Foam hisses
// as each one washes out.
const WAVE_RISE_SECONDS = [3.5, 6] as const;
const WAVE_FALL_SECONDS = [4, 7] as const;
const WAVE_PEAK = [0.55, 1] as const;
const WAVE_BED = 0.3;
const WAVE_DARK_HZ = 350;
const WAVE_BRIGHT_HZ = 2_500;
const WAVE_FOAM = 0.3;
const WAVE_FOAM_CUTOFF_HZ = 3_000;
/** How far a wave can sit to one side: 0 is centered, 1 is all the way. */
const WAVE_PAN = 0.25;
const WAVE_PAN_SECONDS = 1.5;

/**
 * Produces stereo noise, one frame at a time: each channel has its own random sequence, so
 * the stereo image is wide and decorrelated, while the fan's hum and the waves' swells are
 * shared. Owned by the audio thread; not thread-safe. Uses the iOS and Android generators'
 * algorithm and constants: the same random sequences, though this runs in double rather
 * than float precision.
 */
export class NoiseGenerator {
  /** The frame next() produced. */
  left = 0;
  right = 0;

  private readonly leftChannel: Channel;
  private readonly rightChannel: Channel;
  /** For what both channels share: the fan's hum and each wave's shape. */
  private readonly shared: Random;
  private readonly sampleRate: number;

  // The fan's rotation, in turns, and its hum: two band-pass filters on shared noise.
  private readonly fanRotationStep: number;
  private readonly fanAirCoefficient: number;
  private fanRotation = 0;
  private readonly fanHum: Resonator;
  private readonly fanHumOvertone: Resonator;

  // The current wave. `waveLevel` runs from 0 (calm) to the wave's peak.
  private readonly waveDarkCoefficient: number;
  private readonly waveBrightCoefficient: number;
  private readonly waveFoamCoefficient: number;
  private readonly wavePanCoefficient: number;
  private waveLevel = 0;
  private waveStart = 0;
  private wavePeak = 0;
  private waveRising = true;
  private waveProgress = 0;
  private waveRiseStep = 0;
  private waveFallStep = 0;
  private waveDecay = 1;
  private waveFoam = 0;
  private waveFoamDecay = 1;
  private wavePan = 0;
  private wavePanTarget = 0;

  constructor(sampleRate: number, leftSeed: number, rightSeed: number) {
    this.sampleRate = sampleRate;
    this.leftChannel = new Channel(leftSeed);
    this.rightChannel = new Channel(rightSeed);
    this.shared = new Random(Math.imul(leftSeed, 0x9e3779b9) ^ rightSeed);

    this.fanRotationStep = FAN_ROTATION_HZ / sampleRate;
    this.fanAirCoefficient = lowPassCoefficient(FAN_AIR_CUTOFF_HZ, sampleRate);
    this.fanHum = new Resonator(FAN_ROTATION_HZ * FAN_BLADES, FAN_HUM_Q, sampleRate);
    this.fanHumOvertone = new Resonator(2 * FAN_ROTATION_HZ * FAN_BLADES, FAN_HUM_Q, sampleRate);

    this.waveDarkCoefficient = lowPassCoefficient(WAVE_DARK_HZ, sampleRate);
    this.waveBrightCoefficient = lowPassCoefficient(WAVE_BRIGHT_HZ, sampleRate);
    this.waveFoamCoefficient = lowPassCoefficient(WAVE_FOAM_CUTOFF_HZ, sampleRate);
    this.wavePanCoefficient = 1 / (WAVE_PAN_SECONDS * sampleRate);
    this.startWave();
  }

  next(type: NoiseType): void {
    switch (type) {
      case "white":
        this.left = this.leftChannel.white() * WHITE_GAIN;
        this.right = this.rightChannel.white() * WHITE_GAIN;
        break;
      case "pink":
        this.left = this.leftChannel.pink() * PINK_GAIN;
        this.right = this.rightChannel.pink() * PINK_GAIN;
        break;
      case "brown":
        this.left = this.leftChannel.brown() * BROWN_GAIN;
        this.right = this.rightChannel.brown() * BROWN_GAIN;
        break;
      case "waves":
        this.waves();
        break;
      case "fan":
        this.fan();
        break;
    }
  }

  private fan(): void {
    this.fanRotation += this.fanRotationStep;
    if (this.fanRotation >= 1) this.fanRotation -= 1;
    let blade = this.fanRotation * FAN_BLADES;
    blade -= Math.floor(blade);
    const throb = 1 + FAN_BLADE_THROB * sine(blade) + FAN_ROTATION_WOBBLE * sine(this.fanRotation);

    const excitation = this.shared.white();
    const hum = FAN_HUM * this.fanHum.next(excitation) + FAN_HUM_OVERTONE * this.fanHumOvertone.next(excitation);
    this.left = (this.leftChannel.air(this.fanAirCoefficient) * throb + hum) * FAN_GAIN;
    this.right = (this.rightChannel.air(this.fanAirCoefficient) * throb + hum) * FAN_GAIN;
  }

  private waves(): void {
    if (this.waveRising) {
      this.waveProgress += this.waveRiseStep;
      // Swells slowly at first, then faster, up to the break.
      const progress = Math.min(this.waveProgress, 1);
      this.waveLevel = this.waveStart + (this.wavePeak - this.waveStart) * progress * progress;
      if (this.waveProgress >= 1) {
        this.waveRising = false;
        this.waveProgress = 0;
        this.waveFoam = this.wavePeak;
      }
    } else {
      this.waveProgress += this.waveFallStep;
      this.waveLevel *= this.waveDecay;
      if (this.waveProgress >= 1) this.startWave();
    }
    this.waveFoam *= this.waveFoamDecay;
    this.wavePan += (this.wavePanTarget - this.wavePan) * this.wavePanCoefficient;

    const brightness =
      this.waveDarkCoefficient + (this.waveBrightCoefficient - this.waveDarkCoefficient) * this.waveLevel;
    const surf = WAVE_BED + this.waveLevel;
    const foam = WAVE_FOAM * this.waveFoam;
    this.left = this.leftChannel.surf(brightness, surf, this.waveFoamCoefficient, foam) * (1 - this.wavePan) * WAVES_GAIN;
    this.right =
      this.rightChannel.surf(brightness, surf, this.waveFoamCoefficient, foam) * (1 + this.wavePan) * WAVES_GAIN;
  }

  /** Picks the next wave's size, timing, and place, and starts it swelling from the current level. */
  private startWave(): void {
    const riseSeconds = this.shared.between(WAVE_RISE_SECONDS);
    const fallSeconds = this.shared.between(WAVE_FALL_SECONDS);
    this.wavePeak = this.shared.between(WAVE_PEAK);
    this.wavePanTarget = WAVE_PAN * this.shared.white();
    this.waveStart = this.waveLevel;
    this.waveRising = true;
    this.waveProgress = 0;
    this.waveRiseStep = 1 / (riseSeconds * this.sampleRate);
    this.waveFallStep = 1 / (fallSeconds * this.sampleRate);
    // Down to about 5% (three time constants) by the next wave; the foam lingers.
    this.waveDecay = Math.exp(-3 / (fallSeconds * this.sampleRate));
    this.waveFoamDecay = Math.exp(-2 / (fallSeconds * this.sampleRate));
  }
}

/** A xorshift32 PRNG (allocation-free, fast). */
class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed | 0 || 0x2545f491;
  }

  /** Uniform white noise in [-1, 1). */
  white(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x;
    return x / 2147483648;
  }

  /** Uniform in [range[0], range[1]). */
  between(range: readonly [number, number]): number {
    return range[0] + (range[1] - range[0]) * (this.white() + 1) * 0.5;
  }
}

/** One channel's noise: its own random sequence, and the filters that shape it. */
class Channel {
  private readonly random: Random;

  // Paul Kellet's pink noise filter state.
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  private brownLevel = 0;

  // Two-pole low-pass filters (two one-poles in a row) for the fan and the waves.
  private air1 = 0;
  private air2 = 0;
  private surf1 = 0;
  private surf2 = 0;
  private foamLow = 0;

  constructor(seed: number) {
    this.random = new Random(seed);
  }

  white(): number {
    return this.random.white();
  }

  /** Paul Kellet's refined -3 dB/octave filter applied to white noise. */
  pink(): number {
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const out = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return out;
  }

  /** White noise through a leaky integrator: -6 dB/octave above about 150 Hz. */
  brown(): number {
    this.brownLevel = (this.brownLevel + 0.02 * this.white()) / 1.02;
    return this.brownLevel;
  }

  /** The fan's air: pink noise through a two-pole low-pass filter. */
  air(coefficient: number): number {
    this.air1 += (this.pink() - this.air1) * coefficient;
    this.air2 += (this.air1 - this.air2) * coefficient;
    return this.air2;
  }

  /** Surf: pink noise through a two-pole low-pass filter, plus foam: high-passed white noise. */
  surf(brightness: number, level: number, foamCoefficient: number, foam: number): number {
    this.surf1 += (this.pink() - this.surf1) * brightness;
    this.surf2 += (this.surf1 - this.surf2) * brightness;
    const w = this.white();
    this.foamLow += (w - this.foamLow) * foamCoefficient;
    return this.surf2 * level + (w - this.foamLow) * foam;
  }
}

/** A band-pass filter (a Chamberlin state-variable filter) with unity gain at its center. */
class Resonator {
  private readonly frequency: number;
  private readonly damping: number;
  private low = 0;
  private band = 0;

  constructor(hz: number, q: number, sampleRate: number) {
    this.frequency = 2 * Math.sin((Math.PI * hz) / sampleRate);
    this.damping = 1 / q;
  }

  next(input: number): number {
    this.low += this.frequency * this.band;
    const high = input - this.low - this.damping * this.band;
    this.band += this.frequency * high;
    return this.band * this.damping;
  }
}

/** The coefficient of a one-pole low-pass filter with the given cutoff. */
function lowPassCoefficient(hz: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

/** A parabolic approximation of sin(2π · phase), for a phase in [0, 1). */
function sine(phase: number): number {
  const x = 2 * phase - 1;
  return 4 * x * (Math.abs(x) - 1);
}
