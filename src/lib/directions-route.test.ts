import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ user: { id: "alice" } as { id: string } | null }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => auth.user }));
import { POST, PATCH, DELETE } from "../../app/api/directions/route";
import { __resetMemoryDbForTests } from "@/lib/db";
beforeEach(() => { __resetMemoryDbForTests(); auth.user = { id: "alice" }; });
it("所有方向写入口拒绝跨站请求", async () => {
  for (const [method, handler] of [["POST", POST], ["PATCH", PATCH], ["DELETE", DELETE]] as const) {
    const response = await handler(new Request("http://localhost/api/directions", { method, headers: { origin: "https://other.test" } }));
    expect(response.status).toBe(403);
  }
});
it("创建方向在解析前限制请求体，坏结构返回可展示错误", async () => {
  for (const [body, expected] of [["null", 400], ["[]", 400], [JSON.stringify({ description: "x".repeat(300_000) }), 413]] as const) {
    const response = await POST(new Request("http://localhost/api/directions", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body }));
    expect(response.status).toBe(expected);
  }
});
