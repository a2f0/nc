import type { NoiseType } from "./noiseType";

// Both land at roughly the same RMS level (about -17 dBFS) with headroom for peaks.
const WHITE_GAIN = 0.25;
const PINK_GAIN = 0.08;

/**
 * Produces one channel of noise, one sample at a time. Owned by the audio thread;
 * not thread-safe. Uses the iOS and Android generators' algorithm and constants: the
 * same random sequence, though this filter runs in double rather than float precision.
 */
export class NoiseGenerator {
  private rng: number;

  // Paul Kellet's pink noise filter state.
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  constructor(seed: number) {
    this.rng = seed | 0 || 0x2545f491;
  }

  next(type: NoiseType): number {
    return type === "white" ? this.white() * WHITE_GAIN : this.pink() * PINK_GAIN;
  }

  /** Uniform white noise in [-1, 1), from a xorshift32 PRNG (allocation-free, fast). */
  private white(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x;
    return x / 2147483648;
  }

  /** Paul Kellet's refined -3 dB/octave filter applied to white noise. */
  private pink(): number {
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
}
