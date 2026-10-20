import { expect, test } from "bun:test";
import { NoiseGenerator } from "../src/noiseGenerator";

// Swift renders with seeds 1/2: swell, breaker, backwash, calm, and later cycles.
const native: [number, [number, number, number][]][] = [
  [44100, [
    [132300, -0.014508246444165707, 0.07368697971105576],
    [264600, 0.029146987944841385, -0.22779574990272522],
    [352800, -0.002184402896091342, -0.022706639021635056],
    [441000, 0.009766509756445885, 0.011338476091623306],
    [882000, 0.01830667071044445, 0.0022752180229872465],
    [2646000, -0.031649909913539886, 0.026668190956115723],
  ]],
  [48000, [
    [144000, 0.07315686345100403, -0.044697001576423645],
    [288000, 0.3269042670726776, 0.15355661511421204],
    [384000, 0.020765312016010284, -0.16250570118427277],
    [480000, -0.02227717824280262, -0.020335981622338295],
    [960000, 0.002440560841932893, -0.0038006503600627184],
    [2880000, 0.02519976533949375, -0.014816612005233765],
  ]],
  [96000, [
    [288000, 0.10157521814107895, -0.028749089688062668],
    [576000, 0.1935761719942093, -0.15933851897716522],
    [768000, 0.0014603183371946216, 0.010455489158630371],
    [960000, 0.005584082566201687, -0.005136157851666212],
    [1920000, -0.007353504188358784, 0.026007970795035362],
    [5760000, -0.0043701473623514175, 0.016346722841262817],
  ]],
];

test.each(native)("waves keep native timing and a softer retreat at %i Hz", (rate, references) => {
  const generator = new NoiseGenerator(rate, 1, 2);
  let next = 0, previous = 0, peak = 0, jump = 0;
  let finite = true;
  const power = [0, 0, 0], differences = [0, 0, 0], counts = [0, 0, 0];
  for (let frame = 0; frame <= references.at(-1)![0]; frame++) {
    generator.next("waves");
    const x = generator.left;
    finite &&= Number.isFinite(x) && Number.isFinite(generator.right);
    peak = Math.max(peak, Math.abs(x), Math.abs(generator.right));
    jump = Math.max(jump, Math.abs(x - previous));
    // Fixed windows for seeds 1/2 (first crest near 5.54 seconds); references also guard this schedule.
    const second = frame / rate;
    const window = second < 1 ? 0 : second >= 4.5 && second < 5.5 ? 1 : second >= 7 && second < 9 ? 2 : -1;
    if (window >= 0) {
      power[window]! += x * x;
      differences[window]! += (x - previous) ** 2;
      counts[window]!++;
    }
    previous = x;
    if (frame === references[next]?.[0]) {
      expect(Math.abs(x - references[next]![1])).toBeLessThan(0.0001);
      expect(Math.abs(generator.right - references[next]![2])).toBeLessThan(0.0001);
      next++;
    }
  }
  expect(finite).toBe(true);
  expect(next).toBe(references.length);
  const rms = power.map((p, i) => Math.sqrt(p / counts[i]!));
  const brightness = power.map((p, i) => differences[i]! / p * (rate / 48_000) ** 2);
  // A clearly audible, quieter pullback with less brightness than the breaker, not raw hiss.
  expect(rms[2]!).toBeGreaterThan(1.5 * rms[0]!);
  expect(rms[2]!).toBeLessThan(0.65 * rms[1]!);
  expect(brightness[2]!).toBeLessThan(0.6 * brightness[1]!);
  expect(brightness[2]!).toBeLessThan(0.003);
  expect(peak).toBeLessThan(0.9);
  expect(jump).toBeLessThan(0.12);
});
