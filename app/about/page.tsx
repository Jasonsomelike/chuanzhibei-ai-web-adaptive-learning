import Link from "next/link";
import { ArrowRight, BookOpen, Code, Network } from "lucide-react";
import { DocumentNav } from "@/components/document-nav";
import { SUBJECTS, allSubjectsStats } from "@/data/subjects";
import { TEAM, SCHEDULE } from "@/data/team";
import { ALGO_VERSION } from "@/lib/plan";
import { INTENT_LABELS } from "@/lib/learningWorkflowContracts";
import { THEMES } from "@/lib/themes";

const CONTENTS = [
  { id: "product", title: "产品流程" },
  { id: "evidence", title: "规划与证据" },
  { id: "orchestration", title: "Agent 编排" },
  { id: "open-source", title: "开源与说明" },
] as const;
const LOOP = [
  { title: "诊断作答", text: "通过独立测评了解知识起点" },
  { title: "学习证据", text: "保留可以追溯的作答依据" },
  { title: "路径规划", text: "结合先修关系与时间安排顺序" },
  { title: "导师与练习", text: "理解知识点，再通过练习验证" },
] as const;
const REPOSITORY =
  "https://github.com/Jasonsomelike/chuanzhibei-ai-web-adaptive-learning";

export const metadata = { title: "关于项目 · 自适应学习路径" };

export default function AboutPage() {
  const stats = allSubjectsStats();
  const concepts = stats.reduce((sum, item) => sum + item.concepts, 0);
  const edges = stats.reduce((sum, item) => sum + item.edges, 0);
  const questions = stats.reduce((sum, item) => sum + item.questions, 0);
  return (
    <main id="main" className="about-page">
      <div className="about-document-layout">
        <div className="document-content">
          <section id="product" className="about-introduction">
            <h1>关于自适应学习路径</h1>
            <p className="about-lead">
              通过真实作答了解学习状态，在先修关系和时间预算下安排学习顺序。
              <br />
              课程导师结合教材解释知识点，练习结果再回到学习计划。
            </p>
            <h2>学习如何形成闭环</h2>
            <ol className="product-learning-loop">
              {LOOP.map((item) => (
                <li key={item.title}>
                  <i aria-hidden="true" />
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                  <ArrowRight className="product-loop-arrow" size={24} aria-hidden="true" />
                </li>
              ))}
            </ol>
            <p className="product-loop-return">
              独立练习的作答结果更新学习证据，再计算下一步。
            </p>
            <div className="about-key-points">
              <div>
                <h2>可复现的学习计划</h2>
                <p>相同输入与版本得到相同路径，可以查看先修约束与路径指纹。</p>
              </div>
              <div>
                <h2>可追溯的回答依据</h2>
                <p>教材引用可以打开当时的原文，掌握情况由独立作答更新。</p>
              </div>
            </div>
            <p className="about-course-scope">
              支持 {SUBJECTS.length} 门内置课程 · {concepts} 个知识点 ·
              可创建自定义学习方向
            </p>
            <div className="about-actions">
              <Link href="/path">
                <Network size={19} />
                进入学习图谱
              </Link>
              <a href={REPOSITORY} target="_blank" rel="noreferrer">
                <Code size={19} />
                查看源码
              </a>
              <Link href="/guide">
                <BookOpen size={19} />
                使用指南
              </Link>
            </div>
          </section>
          <section id="evidence" className="about-detail-section">
            <h2>规划与学习证据</h2>
            <p>
              诊断记录所选选项、题目、难度和作答时间。服务端根据题库核对结果，重算难度加权的
              Beta-Bernoulli 后验，并显示证据数量和不确定性。
            </p>
            <p>
              规划先求先修闭包，再结合知识深度、当前证据和时间预算安排学习。预算对照、手动改序与约束检查都可在图谱页使用。
            </p>
            <dl className="about-methods">
              <div>
                <dt>路径版本</dt>
                <dd>{ALGO_VERSION}</dd>
              </div>
              <div>
                <dt>当前课程规模</dt>
                <dd>
                  {concepts} 个知识点、{edges} 条先修关系、{questions} 道题
                </dd>
              </div>
              <div>
                <dt>完整历史</dt>
                <dd>
                  问答、引用快照、练习结果和问题图片按会话保存，支持按轮次分支。
                </dd>
              </div>
              <div>
                <dt>外观与阅读</dt>
                <dd>
                  导览、地图、章节三种布局，{THEMES.length}{" "}
                  种配色，以及独立的明暗与动态效果设置。
                </dd>
              </div>
            </dl>
            <details className="document-details">
              <summary>查看课程覆盖</summary>
              <ul className="about-course-coverage">
                {SUBJECTS.map((course) => {
                  const count = stats.find((item) => item.id === course.id)!;
                  return (
                    <li key={course.id}>
                      <Link href={"/path?subject=" + course.id}>
                        {course.name}
                        <ArrowRight size={16} />
                      </Link>
                      <span>
                        {count.concepts} 个知识点 · {count.questions} 道题 ·{" "}
                        {count.chapters} 章
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          </section>
          <section id="orchestration" className="about-detail-section">
            <h2>Agent 编排</h2>
            <p>
              Learning Supervisor
              根据问题、教学偏好与当前学习状态选择子流程。学情、教材检索和练习题都绑定当前账号与课程。
            </p>
            <div className="about-agent-workflow" aria-label="教学工作流">
              <div className="about-supervisor">
                <h3>Learning Supervisor</h3>
                <p>识别教学意图，读取会话与学习上下文</p>
              </div>
              <div className="about-agent-branches">
                <article>
                  <h3>路径规划</h3>
                  <p>先计算合法顺序与预算，再解释学习理由。</p>
                </article>
                <article>
                  <h3>知识辅导</h3>
                  <p>结合检索原文进行讲解、分级提示或错因分析。</p>
                </article>
                <article>
                  <h3>独立练习</h3>
                  <p>从可核验题库选题，等待用户提交选项。</p>
                </article>
              </div>
              <div className="about-agent-checkpoint">
                <h3>规则核验与会话检查点</h3>
                <p>核对引用编号和路径指纹，保存完整回答及该轮教学状态。</p>
              </div>
            </div>
            <p>
              支持的教学任务包括 {Object.values(INTENT_LABELS).join("、")}
              。辅导节点可以调用本地只读工具及用户授权的 MCP
              工具，运行设有步数、时间与重复调用保护。
            </p>
            <p>
              练习由服务端核对选项，再更新学习证据和路径。完整会话独立存档，模型仅使用最近需要的文本和本轮检索资料。旧轮次的练习与判分结果可以随历史恢复。
            </p>
            <details className="document-details">
              <summary>查看核验与工具边界</summary>
              <p>
                引用规则核验检查知识点归属、资料编号和路径指纹。逐字引用核对可在模型设置中开启，结果在回答下展开查看。MCP
                只开放只读工具，模型文本没有写入掌握度的权限。
              </p>
              <p>
                客户端提交练习标识与所选选项，服务端校验该轮题目与会话归属。首次判分结果随消息保存，分支中的继承练习保留原有结果。
              </p>
            </details>
          </section>
          <section id="open-source" className="about-detail-section">
            <h2>开源与项目说明</h2>
            <p>
              项目使用 Next.js、React 与 TypeScript，图谱基于 React
              Flow，知识检索采用中文
              BM25，并支持上传资料的本地向量检索。数据使用
              Postgres，开发环境也提供临时内存存储。
            </p>
            <a
              className="document-text-link"
              href={REPOSITORY}
              target="_blank"
              rel="noreferrer"
            >
              浏览项目仓库与改动记录
              <ArrowRight size={17} />
            </a>
            <details className="document-details">
              <summary>课程资料与当前使用范围</summary>
              <ul>
                <li>题库与图谱为项目初始课程资料，仍需结合教师口径使用。</li>
                <li>掌握度随个人作答估计，项目尚无真实班级规模的效果验证。</li>
                <li>教师班级视图尚未实现。</li>
                <li>自定义方向需要生成、借用或手动添加题目后再进行诊断。</li>
                <li>本机模型直连取决于供应商的跨域与协议支持。</li>
              </ul>
            </details>
            <details className="document-details">
              <summary>团队与参赛信息</summary>
              <dl className="about-team">
                <div>
                  <dt>团队</dt>
                  <dd>
                    {TEAM.name} · {TEAM.id}
                  </dd>
                </div>
                <div>
                  <dt>院校与组别</dt>
                  <dd>
                    {TEAM.school} · {TEAM.group}
                  </dd>
                </div>
                <div>
                  <dt>成员</dt>
                  <dd>
                    {TEAM.members.map((member) => member.name).join("、")}
                  </dd>
                </div>
                <div>
                  <dt>指导教师</dt>
                  <dd>{TEAM.advisor}</dd>
                </div>
              </dl>
              <p>
                {TEAM.competition} · {TEAM.track}
              </p>
              <ul>
                {SCHEDULE.map((item) => (
                  <li key={item.stage}>
                    {item.stage} · {item.deadline}
                  </li>
                ))}
              </ul>
            </details>
          </section>
        </div>
        <DocumentNav items={CONTENTS} label="关于项目目录" />
      </div>
    </main>
  );
}
