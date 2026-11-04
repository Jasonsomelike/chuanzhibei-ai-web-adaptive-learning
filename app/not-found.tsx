import { Nav, Card, ButtonLink } from "@/components/ui";
export default function NotFound() {
  return <><Nav /><main id="main" className="mx-auto max-w-2xl px-5 py-12">
    <Card><p className="text-sm text-[var(--accent)]">404</p>
      <h1 className="mt-2 text-2xl font-semibold">没有找到这个页面</h1>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">链接可能已经变更，可以从学习首页重新选择课程。</p>
      <div className="mt-5"><ButtonLink href="/">回到学习首页</ButtonLink></div>
    </Card>
  </main></>;
}
