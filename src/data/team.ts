/**
 * 参赛信息单一来源。
 *
 * 界面页脚、README、预指导文档都从这里取数，
 * 避免改了 README 忘了改页面这种不一致。
 *
 * 刻意不含联系方式（电话、邮箱）：仓库最终要转为公开给评审，
 * 个人信息按赛事要求只在报名系统内提交。
 */

export const TEAM = {
  competition: "2026 第九届传智杯全国大学生数智创新与 AI 应用大赛",
  track: "AI WEB 网页开发挑战赛",
  trackType: "技术应用赛 · 团队赛",
  year: "2026",
  name: "胆子肥嘟嘟队",
  id: "38543",
  school: "北京电子科技学院",
  group: "B 组",
  members: [
    { name: "李双", role: "队长", major: "计算机科学与技术", grade: "2024 级本科", entryNo: "1767807" },
    { name: "于凯", role: "队员" },
    { name: "王一超", role: "队员" },
  ],
  advisor: "李浩亮",
} as const;

/** 赛程节点。界面与文档共用，避免日期写错。只列当前阶段（省赛及其预指导）。 */
export const SCHEDULE = [
  { stage: "预指导作品提交", deadline: "2026-10-31 15:00", note: "需先完成省赛缴费；不作为省赛最终作品" },
  { stage: "省赛报名与作品提交", deadline: "2026-11-18", note: "评审意见约 2027 年 1 月底发布" },
] as const;

/** 一行式署名，页脚用。 */
export function teamLine(): string {
  return `${TEAM.name} · ${TEAM.school} · ${TEAM.group} · 团队编号 ${TEAM.id} · 指导教师 ${TEAM.advisor}`;
}
