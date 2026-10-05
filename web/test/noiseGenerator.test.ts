import { describe, expect, test } from "bun:test";
import { NoiseGenerator } from "../src/noiseGenerator";
import type { NoiseType } from "../src/noiseType";

function samples(type: NoiseType, count: number, seed = 0x12345678): Float64Array {
  const generator = new NoiseGenerator(seed);
  return Float64Array.from({ length: count }, () => generator.next(type));
}

function rmsDecibels(values: Float64Array): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return 20 * Math.log10(Math.sqrt(sum / values.length));
}

describe("NoiseGenerator", () => {
  // From ios/Shared/NoiseGenerator.swift with seed 1 (Android's generator is the same).
  test.each([
    ["white", [3.1475094e-5, 0.007873714, -0.19179794, 0.035809316, -0.22075582, 0.0867871]],
    ["pink", [1.6590504e-5, 0.0041600005, -0.098645784, -0.038998332, -0.14422426, -0.048818734]],
  ] as const)("matches the native %s noise", (type, expected) => {
    expect(Array.from(samples(type, expected.length, 1))).toEqual(expected.map((value) => expect.closeTo(value, 6)));
  });

  test.each(["white", "pink"] as const)("%s noise is level-matched at about -17 dBFS", (type) => {
    // The native generators measure -16.8 (white) and -17.0 (pink) dBFS.
    expect(rmsDecibels(samples(type, 480_000))).toBeCloseTo(-17, 0);
  });

  test.each(["white", "pink"] as const)("%s noise stays within full scale", (type) => {
    const peak = samples(type, 480_000).reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    expect(peak).toBeLessThan(1);
  });

  test("pink noise has less high-frequency energy than white", () => {
    // Sample-to-sample differences are a crude high-pass: twice the power for white noise.
    const highPassRatio = (values: Float64Array) => {
      let power = 0;
      let differencePower = 0;
      for (let i = 1; i < values.length; i++) {
        power += values[i]! ** 2;
        differencePower += (values[i]! - values[i - 1]!) ** 2;
      }
      return differencePower / power;
    };
    expect(highPassRatio(samples("white", 48_000))).toBeCloseTo(2, 1);
    expect(highPassRatio(samples("pink", 48_000))).toBeLessThan(0.5);
  });

  test("a zero seed still produces noise", () => {
    expect(samples("white", 4, 0).some((value) => value !== 0)).toBe(true);
  });
});
