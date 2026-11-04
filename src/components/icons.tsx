import type { SVGProps } from "react";

const paths = {
  arrow: "M4 12h16m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  search: "m21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  book: "M12 5v16m0-16C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1",
  route: "M6 6h9a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h9M6 3v6M3 6h6m6 13 3 3 3-3",
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3 1.5-5A8 8 0 1 1 21 11M7 10h.01M12 10h.01M17 10h.01",
  check: "m5 12 4 4L19 6",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  target: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0M12 11v2",
  layers: "m12 3 10 5-10 5L2 8l10-5M2 12l10 5 10-5M2 16l10 5 10-5",
  clipboard: "M9 4H5v17h14V4h-4M9 2h6v4H9V2m-1 9h8m-8 5h5",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M10 15v6",
  menu: "M4 6h16M4 12h16M4 18h16",
  play: "m8 4 12 8-12 8V4",
  graph: "M6 6h.01M18 6h.01M12 18h.01M8 6h8M7 8l4 8m6-8-4 8M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0m12 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0m-6 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
} as const;

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20, ...props }: SVGProps<SVGSVGElement> & { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name]} /></svg>;
}
