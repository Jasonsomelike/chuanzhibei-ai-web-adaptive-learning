import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTutorTone, offlineTutoringText, tutoringPolicy } from "@/lib/tutorPreferences";
import { tutorSystemPrompt } from "@/lib/tutorPersona";
afterEach(() => vi.unstubAllGlobals());
describe("实际导师偏好", () => {
  it("已保存语气进入实际 system 提示词", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "strict" } });
    expect(tutorSystemPrompt({ tone: loadTutorTone() })).toContain("【语气：严格】");
    vi.stubGlobal("window", { localStorage: { getItem: () => "not-a-tone" } });
    expect(loadTutorTone()).toBe("companion");
  });
  it("离线提示和引导步骤不泄露完整答案", () => {
    const answer = "唯一正确答案是 42";
    expect(offlineTutoringText("hint", answer, "递归")).not.toContain("42");
    expect(offlineTutoringText("steps", answer, "递归")).not.toContain("42");
    expect(offlineTutoringText("explain", answer)).toBe(answer);
    expect(tutoringPolicy("hint")).toContain("不揭示最终答案");
  });
});
