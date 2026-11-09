import { describe, expect, test } from "bun:test";
import { flowPipePath } from "../src/components/canvas/edgeRouting";

function points(path: string): { x: number; y: number }[] {
  const nums = [...path.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < nums.length; i += 2) out.push({ x: nums[i]!, y: nums[i + 1]! });
  return out;
}

describe("flow pipes", () => {
  test("a level pipe is a straight line", () => {
    const path = flowPipePath({ x: 0, y: 40 }, { x: 80, y: 40 }, "right");
    expect(path).not.toMatch(/[QCA]/);
    expect(points(path)).toEqual([
      { x: 0, y: 40 },
      { x: 80, y: 40 },
    ]);
  });

  test("a short gap with a height difference turns once and does not fold back", () => {
    // 30px of gap and 12px of offset. The smooth-step router loops here, because its
    // 20px handle gap is longer than the pipe and the two ends cross.
    const path = flowPipePath({ x: 132, y: 54 }, { x: 162, y: 66 }, "right");
    expect(path).not.toMatch(/[QCA]/);
    const drawn = points(path);
    expect(drawn[0]).toEqual({ x: 132, y: 54 });
    expect(drawn[drawn.length - 1]).toEqual({ x: 162, y: 66 });
    for (let i = 1; i < drawn.length; i++) expect(drawn[i]!.x).toBeGreaterThanOrEqual(drawn[i - 1]!.x);
    // One jog: leave the handle, one vertical step, then into the target. Two corners, no curve.
    const verticals = [];
    for (let i = 1; i < drawn.length; i++) {
      if (drawn[i]!.x === drawn[i - 1]!.x && drawn[i]!.y !== drawn[i - 1]!.y) verticals.push(drawn[i]);
    }
    expect(verticals).toHaveLength(1);
  });

  test("a target behind the handle is a straight line rather than a loop", () => {
    const path = flowPipePath({ x: 100, y: 40 }, { x: 40, y: 70 }, "right");
    expect(path).not.toMatch(/[QCA]/);
    expect(points(path)).toEqual([
      { x: 100, y: 40 },
      { x: 40, y: 70 },
    ]);
  });
});
