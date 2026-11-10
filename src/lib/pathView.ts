/** Presentation only; never used as mastery evidence or a saved algorithm result. */
export const PATH_VIEW_KEY = "alp.pathView.v1";
export type PathView = { budget: number; kcId: string | null; targets: string[] };
export function readPathView(targetId: string): PathView {
  try {
    const value = JSON.parse(localStorage.getItem(PATH_VIEW_KEY) ?? "{}")[targetId];
    return { budget: Number.isInteger(value?.budget) && value.budget >= 5 && value.budget <= 480 ? value.budget : 60, kcId: typeof value?.kcId === "string" ? value.kcId : null, targets: Array.isArray(value?.targets) ? value.targets.filter((id: unknown): id is string => typeof id === "string").slice(0, 200) : [] };
  } catch { return { budget: 60, kcId: null, targets: [] }; }
}
export function writePathView(targetId: string, view: PathView): void {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PATH_VIEW_KEY) ?? "{}");
    const previous = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    localStorage.setItem(PATH_VIEW_KEY, JSON.stringify({ ...previous, [targetId]: view }));
  } catch { /* Storage is optional for the current view. */ }
}
