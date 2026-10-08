import { describe, expect, test } from "bun:test";
import { NoiseGenerator } from "../src/noiseGenerator";
import { NOISE_TYPES, type NoiseType } from "../src/noiseType";

const SAMPLE_RATE = 48_000;

/** `count` frames of `type`, as left and right channels. */
function frames(type: NoiseType, count: number, leftSeed = 0x12345678, rightSeed = 0x9abcdef0): Float64Array[] {
  const generator = new NoiseGenerator(SAMPLE_RATE, leftSeed, rightSeed);
  const left = new Float64Array(count);
  const right = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    generator.next(type);
    left[i] = generator.left;
    right[i] = generator.right;
  }
  return [left, right];
}

function rmsDecibels(channels: Float64Array[]): number {
  let sum = 0;
  let count = 0;
  for (const values of channels) {
    for (const value of values) sum += value * value;
    count += values.length;
  }
  return 20 * Math.log10(Math.sqrt(sum / count));
}

function peak(channels: Float64Array[]): number {
  return Math.max(...channels.map((values) => values.reduce((max, value) => Math.max(max, Math.abs(value)), 0)));
}

/** The power of the sample-to-sample differences over the power: a crude high-pass, 2 for white noise. */
function highPassRatio(values: Float64Array): number {
  let power = 0;
  let differencePower = 0;
  for (let i = 1; i < values.length; i++) {
    power += values[i]! ** 2;
    differencePower += (values[i]! - values[i - 1]!) ** 2;
  }
  return differencePower / power;
}

/** RMS level of each of `seconds` one-second windows of the left channel, in dBFS. */
function levelsBySecond(type: NoiseType, seconds: number): number[] {
  const [left] = frames(type, seconds * SAMPLE_RATE);
  return Array.from({ length: seconds }, (_, second) =>
    rmsDecibels([left!.subarray(second * SAMPLE_RATE, (second + 1) * SAMPLE_RATE)]),
  );
}

// From ios/Shared/NoiseGenerator.swift at 48 kHz with seeds 1 and 2 (Android's generator is
// the same): the first frames, and frames a second in, after the filters and the fan's and
// waves' modulation have settled in.
const NATIVE: Record<NoiseType, { early: [number, number][]; late: [number, number][] }> = {
  white: {
    early: [[3.1475094e-5, 6.295019e-5], [0.007873714, 0.015629172], [-0.19179794, 0.081244245], [0.035809316, 0.19452456], [-0.22075582, -0.055296656], [0.0867871, 0.09534035]],
    late: [[0.14455743, -0.075551756], [-0.06802021, -0.116097525], [0.07042096, -0.014235876], [-0.12807839, 0.18986924], [-0.042522572, -0.13152967]],
  },
  pink: {
    early: [[1.6590504e-5, 3.3181008e-5], [0.0041600005, 0.0082576675], [-0.098645784, 0.04768868], [-0.038998332, 0.13105834], [-0.14422426, 0.051202204], [-0.048818734, 0.09123833]],
    late: [[0.06094571, 0.21844976], [-0.015181789, 0.1624472], [0.021750202, 0.18139541], [-0.059851587, 0.29439265], [-0.06285527, 0.18676662]],
  },
  brown: {
    early: [[6.072842e-6, 1.2145684e-5], [0.0015251174, 0.0030274186], [-0.035510506, 0.018643418], [-0.027905129, 0.05580966], [-0.069950856, 0.044046354], [-0.05183447, 0.06157778]],
    late: [[-0.076912805, 0.19730704], [-0.08852861, 0.17103827], [-0.07320566, 0.1649379], [-0.096481845, 0.1983374], [-0.1027944, 0.16907096]],
  },
  fan: {
    early: [[0.0002625548, 0.0002629632], [-0.0022337092, -0.0021319268], [-0.0006926984, 0.0030986934], [-0.0071785343, 0.0034531201], [-0.014108464, 0.0061711194], [-0.020227347, 0.010192444]],
    late: [[-0.02485629, 0.3487985], [-0.0235182, 0.34421605], [-0.020125879, 0.3396359], [-0.013615747, 0.3416764], [-0.013245825, 0.33764833]],
  },
  waves: {
    early: [[1.0604759e-8, 2.1209631e-8], [-6.4594926e-5, 2.7426478e-5], [-0.0002358445, 4.987572e-5], [-0.00043645155, 5.4581098e-5], [-0.0005773273, 9.925216e-5], [-0.00075722765, 0.00021144643]],
    late: [[0.016370308, -0.039396435], [0.015846081, -0.03860277], [0.015395884, -0.037850864], [0.014944421, -0.03706572], [0.014485578, -0.036188107]],
  },
};

describe("NoiseGenerator", () => {
  test.each([...NOISE_TYPES])("matches the native %s noise", (type) => {
    const [left, right] = frames(type, SAMPLE_RATE + 5, 1, 2);
    const pairs = (start: number, count: number) =>
      Array.from({ length: count }, (_, i) => [left![start + i]!, right![start + i]!]);
    const close = (expected: [number, number][], digits: number) =>
      expected.map((frame) => frame.map((value) => expect.closeTo(value, digits)));
    expect(pairs(0, 6)).toEqual(close(NATIVE[type].early, 6));
    // Float and double precision drift apart over a second, by up to about 0.3% (the fan's hum).
    expect(pairs(SAMPLE_RATE, 5)).toEqual(close(NATIVE[type].late, 2));
  });

  test.each(["white", "pink", "brown", "fan"] as const)("%s noise is level-matched at about -17 dBFS", (type) => {
    // The native generators measure about -17 dBFS for each of these.
    expect(rmsDecibels(frames(type, 10 * SAMPLE_RATE))).toBeCloseTo(-17, 0);
  });

  test("waves average about -23 dBFS, swelling and calming by about 20 dB", () => {
    const seconds = levelsBySecond("waves", 120);
    const average = 10 * Math.log10(seconds.reduce((sum, level) => sum + 10 ** (level / 10), 0) / seconds.length);
    expect(average).toBeCloseTo(-23, 0);
    expect(Math.max(...seconds) - Math.min(...seconds)).toBeGreaterThan(12);
    expect(Math.max(...seconds)).toBeLessThan(-12);
  });

  test.each([...NOISE_TYPES])("%s noise stays within full scale", (type) => {
    expect(peak(frames(type, 120 * SAMPLE_RATE))).toBeLessThan(0.9);
  });

  test.each([...NOISE_TYPES])("%s noise has decorrelated channels", (type) => {
    const [left, right] = frames(type, 10 * SAMPLE_RATE);
    let product = 0;
    for (let i = 0; i < left!.length; i++) product += left![i]! * right![i]!;
    const correlation = product / left!.length / 10 ** (rmsDecibels([left!]) / 20) / 10 ** (rmsDecibels([right!]) / 20);
    // The fan's hum is shared, so it's a little correlated; nothing else is.
    expect(Math.abs(correlation)).toBeLessThan(type === "fan" ? 0.3 : 0.1);
  });

  test("each color has less high-frequency energy than the one before", () => {
    const [white] = frames("white", SAMPLE_RATE);
    const [pink] = frames("pink", SAMPLE_RATE);
    const [brown] = frames("brown", SAMPLE_RATE);
    expect(highPassRatio(white!)).toBeCloseTo(2, 1);
    expect(highPassRatio(pink!)).toBeLessThan(0.5);
    expect(highPassRatio(brown!)).toBeLessThan(0.05);
  });

  test("the fan and the waves are darker than pink noise", () => {
    const [pink] = frames("pink", 10 * SAMPLE_RATE);
    const [fan] = frames("fan", 10 * SAMPLE_RATE);
    const [waves] = frames("waves", 10 * SAMPLE_RATE);
    expect(highPassRatio(fan!)).toBeLessThan(highPassRatio(pink!) / 4);
    expect(highPassRatio(waves!)).toBeLessThan(highPassRatio(pink!) / 4);
  });

  test("the fan hums at its blade rate", () => {
    // The power through a narrow band-pass filter (Q 20) at 100 Hz, five blades at 20 turns
    // a second, against bands either side of it.
    const [left] = frames("fan", 10 * SAMPLE_RATE);
    const band = (hz: number) => {
      const omega = (2 * Math.PI * hz) / SAMPLE_RATE;
      const alpha = Math.sin(omega) / (2 * 20);
      const [a1, a2] = [(-2 * Math.cos(omega)) / (1 + alpha), (1 - alpha) / (1 + alpha)];
      const gain = alpha / (1 + alpha);
      let [x1, x2, y1, y2, power] = [0, 0, 0, 0, 0];
      for (const x of left!) {
        const y = gain * (x - x2) - a1 * y1 - a2 * y2;
        [x2, x1, y2, y1] = [x1, x, y1, y];
        power += y * y;
      }
      return power;
    };
    expect(band(100)).toBeGreaterThan(3 * band(80));
    expect(band(100)).toBeGreaterThan(3 * band(125));
  });

  test("a zero seed still produces noise", () => {
    const [left, right] = frames("white", 4, 0, 0);
    expect(left!.some((value) => value !== 0)).toBe(true);
    expect(right!.some((value) => value !== 0)).toBe(true);
  });
});
