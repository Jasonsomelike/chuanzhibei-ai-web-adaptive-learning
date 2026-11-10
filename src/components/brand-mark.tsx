/**
 * 站点标识：一条上升的路径 + 三个节点，最后一个打勾。
 *
 * 为什么不用字母「路」：图标要在 16px 的 favicon 与 28px 的导航里都可辨认，
 * 一条曲线加三个圆点比汉字更稳，也直接对应「学习路径」这件事。
 * 颜色跟随当前主题的语义强调色。
 */
export function BrandMark({
  size = 28,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <path
        d="M16 45c8 0 7-15 16-15s8-12 16-12"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="16" cy="45" r="5.5" fill="var(--on-accent)" />
      <circle cx="32" cy="30" r="5.5" fill="var(--on-accent)" />
      <circle cx="48" cy="18" r="6.5" fill="var(--on-accent)" />
      <path
        d="M45.2 18l2 2 4-4.6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
