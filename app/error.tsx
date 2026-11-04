"use client";
import { Nav, Card, ButtonLink } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <><Nav /><main id="main" className="mx-auto max-w-2xl px-5 py-12">
    <Card><h1 className="text-2xl font-semibold">这个页面暂时没有加载成功</h1>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">可以重试当前页面，或回到首页继续学习。</p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={reset} className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--on-accent)]">重新加载</button>
        <ButtonLink href="/" variant="ghost">回到学习首页</ButtonLink>
      </div>
    </Card>
  </main></>;
}
