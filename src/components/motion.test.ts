/**
 * 动效参数与判定的纯函数测试。
 *
 * 页面动效本身依赖浏览器与 gsap，node 环境测不到；但「时长 / 间隔在约定
 * 区间内」「减少动态效果时不播」「只动 transform 与 opacity」「已播过的不重播」
 * 这几条是行为契约，全部落在 motion-plan.ts 的纯函数里，可以直接断言。
 * 这些数字一旦被改坏（例如把 stagger 调到 0.3s），这里会先失败。
 */

import { describe, expect, it } from "vitest";

import {
  DEFAULT_ENTRANCE,
  ENTRANCE_RANGE,
  MOTION_PROPERTIES,
  planAppear,
  planEntrance,
  planHighlight,
  planHover,
  shouldPlay,
} from "./motion-plan";

describe("入场参数：时长与间隔落在约定区间", () => {
  it("默认值在 0.25–0.4s / 0.04–0.08s 之间", () => {
    const plan = planEntrance(3);
    expect(plan).not.toBeNull();
    expect(plan!.duration).toBeGreaterThanOrEqual(ENTRANCE_RANGE.minDuration);
    expect(plan!.duration).toBeLessThanOrEqual(ENTRANCE_RANGE.maxDuration);
    expect(plan!.stagger).toBeGreaterThanOrEqual(ENTRANCE_RANGE.minStagger);
    expect(plan!.stagger).toBeLessThanOrEqual(ENTRANCE_RANGE.maxStagger);
  });

  it("越界的覆盖值被夹回区间，而不是原样写进 tween", () => {
    const tooSlow = planEntrance(2, { duration: 3, stagger: 0.5 });
    expect(tooSlow!.duration).toBe(ENTRANCE_RANGE.maxDuration);
    expect(tooSlow!.stagger).toBe(ENTRANCE_RANGE.maxStagger);

    const tooFast = planEntrance(2, { duration: 0.01, stagger: 0 });
    expect(tooFast!.duration).toBe(ENTRANCE_RANGE.minDuration);
    expect(tooFast!.stagger).toBe(ENTRANCE_RANGE.minStagger);
  });

  it("没有目标时不建动画", () => {
    expect(planEntrance(0)).toBeNull();
    expect(planEntrance(-1)).toBeNull();
  });

  it("所有元素共用一条 timeline（同一份参数），不是每张卡各建一条", () => {
    const three = planEntrance(3);
    const ten = planEntrance(10);
    expect(three!.duration).toBe(ten!.duration);
    expect(three!.stagger).toBe(ten!.stagger);
  });
});

describe("只动 transform 与 opacity", () => {
  const animatedKeys = (frame: { from: object; to: object }): string[] => [
    ...new Set([...Object.keys(frame.from), ...Object.keys(frame.to)]),
  ];

  it("入场 / 切换只碰 opacity 与 y", () => {
    const entrance = planEntrance(2)!;
    expect(animatedKeys(entrance).every((key) => key === "opacity" || key === "y")).toBe(true);

    const appear = planAppear();
    expect(animatedKeys(appear).every((key) => key === "opacity" || key === "y")).toBe(true);
  });

  it("步骤高亮只碰 scale，hover 只碰 y", () => {
    expect(animatedKeys(planHighlight())).toEqual(["scale"]);
    expect(animatedKeys(planHover())).toEqual(["y"]);
  });

  it("属性都在白名单里（白名单只有 transform 相关与 opacity）", () => {
    for (const key of animatedKeys(planEntrance(1)!)) {
      expect(MOTION_PROPERTIES).toContain(key);
    }
    for (const key of animatedKeys(planHighlight())) {
      expect(MOTION_PROPERTIES).toContain(key);
    }
    expect([...MOTION_PROPERTIES].sort()).toEqual(["opacity", "scale", "x", "y"]);
  });

  it("终态就是自然状态：透明度 1、位移 0、缩放 1", () => {
    expect(planEntrance(1)!.to).toEqual({ opacity: 1, y: 0 });
    expect(planAppear().to).toEqual({ opacity: 1, y: 0 });
    expect(planHighlight().to).toEqual({ scale: 1 });
    expect(planHover().from).toEqual({ y: 0 });
  });
});

describe("跳过条件", () => {
  it("减少动态效果时，入场 / 切换 / hover 全部不播", () => {
    expect(shouldPlay("entrance", { reducedMotion: true })).toBe(false);
    expect(shouldPlay("swap", { reducedMotion: true })).toBe(false);
    expect(shouldPlay("hover", { reducedMotion: true, hoverCapable: true })).toBe(false);
  });

  it("已播过的元素不重播：流式 patch 只改文本，节点仍在，因此不会再次入场", () => {
    expect(shouldPlay("entrance", { reducedMotion: false, done: true })).toBe(false);
    expect(shouldPlay("entrance", { reducedMotion: false, done: false })).toBe(true);
  });

  it("触摸设备不做悬停抬升", () => {
    expect(shouldPlay("hover", { reducedMotion: false, hoverCapable: false })).toBe(false);
    expect(shouldPlay("hover", { reducedMotion: false, hoverCapable: true })).toBe(true);
  });

  it("done 只挡入场，不挡切换与 hover", () => {
    expect(shouldPlay("swap", { reducedMotion: false, done: true })).toBe(true);
    expect(shouldPlay("hover", { reducedMotion: false, done: true, hoverCapable: true })).toBe(
      true,
    );
  });
});

describe("默认参数本身也在区间内（防止改常量绕过 planEntrance）", () => {
  it("DEFAULT_ENTRANCE 符合约定", () => {
    expect(DEFAULT_ENTRANCE.duration).toBeGreaterThanOrEqual(ENTRANCE_RANGE.minDuration);
    expect(DEFAULT_ENTRANCE.duration).toBeLessThanOrEqual(ENTRANCE_RANGE.maxDuration);
    expect(DEFAULT_ENTRANCE.stagger).toBeGreaterThanOrEqual(ENTRANCE_RANGE.minStagger);
    expect(DEFAULT_ENTRANCE.stagger).toBeLessThanOrEqual(ENTRANCE_RANGE.maxStagger);
  });
});
