import Link from "next/link";
import { LearningJourney } from "@/components/learning-journey";
import { Nav, Card, SectionTitle, Pill, ButtonLink } from "@/components/ui";
import { SUBJECTS } from "@/data/subjects";

/**
 * 使用指南：一页讲清完整学习闭环。
 *
 * 页面本身无状态，按「第一次来该做什么」的顺序组织：
 * 五步流程 → 上传资料（最容易被忽略的能力）→ 错题重练 → 常见问题。
 * 每一步的按钮都直达对应功能，不让新用户在导航里猜。
 */

const STEPS = [
  {
    no: "1",
    title: "选一个学习目标，做一轮诊断",
    body: (
      <>
        在诊断页顶部选择内置学科或自定义方向，系统按先修顺序出题，
        每答一题立即更新掌握度（含不确定度）。每个知识点测 3–4 题即可，全程约 10 分钟。
        没配任何模型也能完整使用——诊断与路径完全不依赖大模型。
      </>
    ),
    href: "/diagnose",
    action: "去诊断测评",
  },
  {
    no: "2",
    title: "查看可解释的学习路径",
    body: (
      <>
        诊断结束后到路径页查看排好的学习步骤：每一步都带数值理由
        （「尚无作答记录，先修深度 6，先建立基线」），
        可以调整时间预算、手动上移下移步骤，违规会当场标出先修冲突。
      </>
    ),
    href: "/path",
    action: "查看学习路径",
  },
  {
    no: "3",
    title: "向课程导师提问",
    body: (
      <>
        导师回答优先引用教材与上传资料，引用逐字核对；没配模型时退化为知识库检索拼装，
        依然可用。想知道某一步为什么排在路上、某个概念到底是什么，都可以直接问。
      </>
    ),
    href: "/tutor",
    action: "打开课程导师",
  },
  {
    no: "4",
    title: "配置模型供应商（可选）",
    body: (
      <>
        想要模型生成题目、流式回答与联网搜索时，到设置中心「模型供应商」分区
        填入 API 地址与密钥。内置 DeepSeek / OpenAI / Claude / 通义 / Kimi / 智谱 预设；
        密钥只存本浏览器或加密存账号，不经过任何第三方。
      </>
    ),
    href: "/settings?panel=provider",
    action: "配置模型供应商",
  },
  {
    no: "5",
    title: "上传自己的教材与讲义（可选）",
    body: (
      <>
        自定义方向支持上传 Markdown / TXT / 带文本层的 PDF。上传后导师回答会检索这些片段，
        绑定知识点的文档还会进入出题依据。解析在本浏览器完成，不保存原始文件。
      </>
    ),
    href: "/directions?kb=open",
    action: "上传教材讲义",
  },
] as const;

const FAQ = [
  {
    q: "不配置任何 API key 能用吗？",
    a: (
      <>
        能。诊断、路径、章节目标、手动改写、记忆卡、预测校准、教材检索与上传检索
        全部不需要模型。模型只增强「生成方向图谱 / 生成题目 / 导师流式回答」三处，
        缺席时各自有明确的降级路径。
      </>
    ),
  },
  {
    q: "掌握度旁边的 ±19 是什么意思？",
    a: (
      <>
        那是不确定度（标准差）。掌握度不是点估计：70% ±19 表示真实水平大概率落在
        51%–89% 之间。题数太少或答案对错分裂时不确定度会偏大，界面会提示「掌握度仅供参考」。
      </>
    ),
  },
  {
    q: "为什么这一步排在我的薄弱点前面？",
    a: (
      <>
        因为它是后面步骤的先修。排序由先修图决定「能不能学」，掌握度决定「先学哪个」，
        时间预算决定「这次学到哪」。先修没掌握时后继步骤会标成 blocked 而不是照排。
      </>
    ),
  },
  {
    q: "换设备后进度还在吗？",
    a: (
      <>
        未登录时进度只存本浏览器；登录后进度、记忆卡与上传资料会同步到账号，
        换设备登录即可拿回。方向市场里公开方向的知识库副本默认是空库，需要重新上传。
      </>
    ),
  },
  {
    q: "上传的教材会泄露吗？",
    a: (
      <>
        解析全部在本浏览器完成，只保存抽取后的文本与切块，不保存原始文件、不上传本项目服务器；
        登录时才同步到账号数据库。导师检索只把命中的片段发给你自己配置的模型供应商。
      </>
    ),
  },
] as const;

export const metadata = {
  title: "使用指南 · 可解释的自适应学习路径",
};

export default function GuidePage() {
  return (
    <>
      <Nav />
      <main id="main" className="mx-auto max-w-6xl px-5 py-10">
        <div className="mb-8">
          <Pill tone="accent">新手必读</Pill>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">使用指南</h1>
          <p className="mt-3 text-[var(--ink-soft)]">
            五步走完整个学习闭环：诊断 → 路径 → 导师 →（可选）配模型 / 传教材。
            每一步的按钮都直达对应功能。
          </p>
        </div>

        <LearningJourney />

        {/* 五步流程 */}
        <SectionTitle hint="按顺序做效果最好；第 4、5 步是可选增强，随时可以回来补。">
          五步上手
        </SectionTitle>
        <ol className="mb-12 space-y-3">
          {STEPS.map((step) => (
            <li key={step.no}>
              <Card>
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-sm font-medium text-[var(--on-accent)]"
                  >
                    {step.no}
                  </span>
                  <div className="min-w-0">
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">
                      {step.body}
                    </p>
                    <Link
                      href={step.href}
                      className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-2"
                    >
                      {step.action} →
                    </Link>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>

        {/* 快捷入口：个性化与外观 */}
        <SectionTitle hint="配色、明暗与供应商配置都在设置中心，这里是直达入口。">
          个性化直达
        </SectionTitle>
        <div className="mb-12 grid gap-3 sm:grid-cols-3">
          <Card>
            <h3 className="font-medium">切换配色主题</h3>
            <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
              5 套主题 × 浅色 / 深色 / 跟随系统，正文对比度达 WCAG AAA。
            </p>
            <Link
              href="/settings?panel=appearance"
              className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-2"
            >
              去外观设置 →
            </Link>
          </Card>
          <Card>
            <h3 className="font-medium">配置模型供应商</h3>
            <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
              OpenAI 兼容与 Anthropic 双协议，密钥加密保存。
            </p>
            <Link
              href="/settings?panel=provider"
              className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-2"
            >
              去供应商设置 →
            </Link>
          </Card>
          <Card>
            <h3 className="font-medium">上传教材讲义</h3>
            <p className="mt-1.5 text-sm text-[var(--ink-soft)]">
              Markdown / TXT / PDF，解析在本浏览器完成。
            </p>
            <Link
              href="/directions?kb=open"
              className="mt-2 inline-block text-sm text-[var(--accent)] underline underline-offset-2"
            >
              去上传 →
            </Link>
          </Card>
        </div>

        {/* 学科一览 */}
        <SectionTitle hint={`共 ${SUBJECTS.length} 个学科，每个学科 40 个知识点 / 120 道题。`}>
          支持的学科
        </SectionTitle>
        <Card className="mb-12">
          <ul className="grid gap-2 sm:grid-cols-2">
            {SUBJECTS.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-xs text-[var(--ink-faint)]">{s.syllabus}</span>
              </li>
            ))}
          </ul>
        </Card>

        {/* 常见问题 */}
        <SectionTitle hint="找不到答案时，先看关于页的架构说明，或者直接在导师页提问。">
          常见问题
        </SectionTitle>
        <div className="space-y-3">
          {FAQ.map((item) => (
            <Card key={item.q}>
              <h3 className="font-medium">{item.q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--ink-soft)]">{item.a}</p>
            </Card>
          ))}
        </div>

        {/* 底部 CTA */}
        <div className="mt-10 flex flex-wrap gap-3">
          <ButtonLink href="/diagnose">开始诊断</ButtonLink>
          <ButtonLink href="/about" variant="ghost">
            了解架构与算法
          </ButtonLink>
        </div>
      </main>
    </>
  );
}
