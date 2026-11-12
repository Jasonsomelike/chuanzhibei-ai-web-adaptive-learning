import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileNav, NavLinks, NAV_LINK_CLASS } from "./nav-links";

const route = vi.hoisted(() => ({ pathname: "/path" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));

describe("学习导航", () => {
  it("桌面导航和手机导航提供相同的六个学习入口", () => {
    for (const Component of [NavLinks, MobileNav]) {
      const markup = renderToStaticMarkup(createElement(Component));
      expect(markup.match(/<a /g)).toHaveLength(6);
      for (const name of ["学习概览", "知识图谱", "诊断测评", "错题本", "课程导师", "我的课程"]) expect(markup).toContain(`aria-label="${name}"`);
      expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
      expect(markup.match(/<a [^>]*href="\/path"[^>]*>/)?.[0]).toContain('aria-current="page"');
    }
  });
  it("课程探索归属课程导航", () => {
    route.pathname = "/market";
    for (const Component of [NavLinks, MobileNav]) expect(renderToStaticMarkup(createElement(Component)).match(/<a [^>]*href="\/directions"[^>]*>/)?.[0]).toContain('aria-current="page"');
    route.pathname = "/path";
  });
  it("导航保留 44px 触控高度，不在桌面撤销", () => {
    expect(NAV_LINK_CLASS).toContain("min-h-11");
    expect(NAV_LINK_CLASS).not.toContain("sm:min-h-0");
  });
});
