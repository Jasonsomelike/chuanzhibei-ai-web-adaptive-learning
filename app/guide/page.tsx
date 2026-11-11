import Link from "next/link";
import { ArrowLeft, ArrowRight, Settings2 } from "lucide-react";
import { LearningJourney } from "@/components/learning-journey";
import { DocumentNav } from "@/components/document-nav";
import { THEMES } from "@/lib/themes";

const CONTENTS = [
  { id: "start", title: "开始学习" },
  { id: "map", title: "认识知识图谱" },
  { id: "tutor-guide", title: "使用课程导师" },
  { id: "sessions", title: "管理会话与分支" },
  { id: "appearance", title: "外观与设置" },
  { id: "faq", title: "常见问题" },
] as const;

export const metadata = { title: "使用指南 · 自适应学习路径" };

export default function GuidePage() {
  return (
    <main id="main" className="guide-page">
      <header className="document-page-heading">
        <h1>使用指南</h1>
        <Link href="/">
          <ArrowLeft size={18} />
          返回学习概览
        </Link>
        <Link href="/settings">
          <Settings2 size={18} />
          前往设置
        </Link>
      </header>
      <div className="guide-document-layout">
        <DocumentNav items={CONTENTS} label="使用指南目录" />
        <div className="document-content">
          <section id="start">
            <LearningJourney />
          </section>
          <section id="map" className="guide-text-section">
            <h2>读懂学习状态</h2>
            <dl className="learning-state-definitions">
              <div>
                <dt>
                  <i className="state-unobserved" aria-hidden="true" />
                  尚未测评
                </dt>
                <dd>还没有独立作答记录，先通过诊断了解基础。</dd>
              </div>
              <div>
                <dt>
                  <i className="state-insufficient" aria-hidden="true" />
                  证据不足
                </dt>
                <dd>已有少量记录，继续作答后再判断掌握情况。</dd>
              </div>
              <div>
                <dt>
                  <i className="state-current" aria-hidden="true" />
                  本次学习
                </dt>
                <dd>已排入当前时间预算的学习计划。</dd>
              </div>
              <div>
                <dt>
                  <i className="state-blocked" aria-hidden="true" />
                  先修阻塞
                </dt>
                <dd>先完成关联的基础内容，再进入后续知识点。</dd>
              </div>
            </dl>
            <p>
              在图谱上选中知识点，可以查看先修关系、学习依据和预计时间。右侧清单与图谱相互定位，预算改变后会重新安排顺序。
            </p>
            <Link className="document-text-link" href="/path">
              打开知识图谱
              <ArrowRight size={17} />
            </Link>
          </section>
          <section id="tutor-guide" className="guide-text-section">
            <h2>把卡住的地方交给导师</h2>
            <p>
              从图谱点击“开始学习”，知识点会带入提问框。可以先选择“给我提示”，再根据需要切换“引导步骤”或“完整讲解”。
            </p>
            <p>
              对话中的知识点引用可以打开当时使用的原文。教材、上传资料与学习设置都在“教材与引用”抽屉里。
            </p>
            <p>
              登录并配置服务端模型后，可以选择“独立练习”。提交选项后，系统核对答案、记录作答证据并更新学习计划。
            </p>
            <p>
              在诊断页展开“历史与错题复习”，可以回顾近期作答、重新练习错题。“记入易混”会创建复习卡。
            </p>
            <div className="document-inline-links">
              <Link href="/tutor">
                打开课程导师
                <ArrowRight size={17} />
              </Link>
              <Link href="/settings?panel=provider">
                配置模型供应商
                <ArrowRight size={17} />
              </Link>
            </div>
          </section>
          <section id="sessions" className="guide-text-section">
            <h2>管理会话与分支</h2>
            <p>
              从左侧历史选择会话即可继续。手机上点击标题旁的历史按钮，展开会话列表。每个会话的管理菜单支持改名、置顶、归档和移入回收站，也能恢复会话。
            </p>
            <p>
              在一轮已结束的回答下点击“从这里分支”，新会话会继承截至该轮的完整问答、引用、练习和图片。之后的讨论分别保存在各自会话中，可以通过“查看来源”回到原会话。
            </p>
            <p>
              较长的历史可以逐页加载更早的问答。登录后的会话可以跨设备恢复，匿名会话保存在当前浏览器。
            </p>
            <Link className="document-text-link" href="/tutor">
              管理我的会话
              <ArrowRight size={17} />
            </Link>
          </section>
          <section id="appearance" className="guide-text-section">
            <h2>按自己的习惯安排学习空间</h2>
            <p>
              设置可以直接从导航进入。默认使用地图布局与橄榄配色，也可以选择导览或章节布局。
            </p>
            <p>
              布局与配色独立选择，目前提供 {THEMES.length}{" "}
              种主题，可使用浅色、深色或跟随系统。需要更安静的阅读体验时，开启“减少动态效果”。
            </p>
            <p>
              自定义方向中可以上传 Markdown、TXT 和 PDF
              教材，解析后的片段用于检索和引用。创建方向后，展开该方向的资料管理入口即可添加。
            </p>
            <div className="document-inline-links">
              <Link href="/settings?panel=appearance">
                打开外观设置
                <ArrowRight size={17} />
              </Link>
              <Link href="/directions?kb=open">
                管理教材与资料
                <ArrowRight size={17} />
              </Link>
            </div>
          </section>
          <section id="faq" className="guide-text-section guide-faq">
            <h2>常见问题</h2>
            <details>
              <summary>不配置任何 API key 能用吗？</summary>
              <p>
                可以使用内置课程的诊断、图谱、预算规划、错题复习和教材检索。导师会显示资料检索模式。配置模型后，可以获得生成式辅导和模型生成的课程内容。
              </p>
            </details>
            <details>
              <summary>掌握度旁边的 ± 表示什么？</summary>
              <p>
                它表示后验标准差，数值越大，不确定性越高。少量作答时先看证据数量，补充独立练习后再观察变化。
              </p>
            </details>
            <details>
              <summary>换设备后进度和问答还在吗？</summary>
              <p>
                登录后的学习进度、记忆卡、上传资料和完整会话随账号同步。匿名记录留在当前浏览器。如果会话栏提示临时服务存储，需要接入数据库才能在服务重启后长期保留。
              </p>
            </details>
            <details>
              <summary>上传的教材和问题图片怎样保存？</summary>
              <p>
                教材在浏览器解析，登录后同步抽取的文本与片段。导师检索时将命中的片段发送给你配置的模型供应商。问题图片经过上传压缩后随该轮会话保存，模型仅接收本次提问的附图。
              </p>
            </details>
            <details>
              <summary>为什么有些知识点暂时不能开始？</summary>
              <p>
                图谱会先检查先修关系，再结合现有作答证据和可用时间安排学习。可以点击知识点查看基础内容，或调整预算查看完整方案。
              </p>
            </details>
          </section>
          <footer className="document-footer">
            <Link href="/diagnose">
              开始正式诊断
              <ArrowRight size={18} />
            </Link>
            <Link href="/about">
              了解产品与 Agent 编排
              <ArrowRight size={18} />
            </Link>
          </footer>
        </div>
      </div>
    </main>
  );
}
