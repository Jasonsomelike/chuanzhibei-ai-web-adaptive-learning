import { describe, expect, it } from "vitest";

import {
  ACCOUNT_OWNER_KEY,
  planAccountTransition,
  type AccountTransitionPlan,
} from "@/lib/accountTransition";

const ALL_CLEAR = {
  clearLearner: true,
  clearKb: true,
  clearSecrets: true,
  clearMaterials: true,
} as const;

const NOTHING_TO_CLEAR = {
  clearLearner: false,
  clearKb: false,
  clearSecrets: false,
  clearMaterials: false,
} as const;

function expectPlan(plan: AccountTransitionPlan, expected: AccountTransitionPlan): void {
  expect(plan).toEqual(expected);
}

describe("planAccountTransition", () => {
  it("A→B：上一个账号的数据全部清除，归属改成 B", () => {
    expectPlan(planAccountTransition("a@example.com", "b@example.com"), {
      ...ALL_CLEAR,
      nextOwner: "b@example.com",
    });
  });

  it("A→null：登出时全部清除，归属键删除", () => {
    expectPlan(planAccountTransition("a@example.com", null), {
      ...ALL_CLEAR,
      nextOwner: null,
    });
  });

  it("null→B：保留本机匿名数据（learner 待并入），不清资料与密钥", () => {
    expectPlan(planAccountTransition(null, "b@example.com"), {
      ...NOTHING_TO_CLEAR,
      nextOwner: "b@example.com",
    });
  });

  it("B→B：同一账号重复登录不清任何东西", () => {
    expectPlan(planAccountTransition("b@example.com", "b@example.com"), {
      ...NOTHING_TO_CLEAR,
      nextOwner: "b@example.com",
    });
  });

  it("null→null：从未登录过的匿名态没有可清的数据", () => {
    expectPlan(planAccountTransition(null, null), {
      ...NOTHING_TO_CLEAR,
      nextOwner: null,
    });
  });

  it("首尾空白不构成换号，空串按匿名处理", () => {
    expectPlan(planAccountTransition("  b@example.com  ", "b@example.com"), {
      ...NOTHING_TO_CLEAR,
      nextOwner: "b@example.com",
    });
    expectPlan(planAccountTransition("   ", "b@example.com"), {
      ...NOTHING_TO_CLEAR,
      nextOwner: "b@example.com",
    });
    expectPlan(planAccountTransition("b@example.com", ""), {
      ...ALL_CLEAR,
      nextOwner: null,
    });
  });

  it("大小写不同视为同一账号，避免误清本机资料", () => {
    expectPlan(planAccountTransition("B@Example.COM", "b@example.com"), {
      ...NOTHING_TO_CLEAR,
      nextOwner: "b@example.com",
    });
  });

  it("归属键只有一份定义，且与现有 localStorage 键一致", () => {
    expect(ACCOUNT_OWNER_KEY).toBe("alp.materials.owner");
  });
});
