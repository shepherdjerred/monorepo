/** The four-point spark that marks a highlight. Decorative. */
export function Spark({ size = 14 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="scout-spark"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path d="M10 1.5 12.1 7.9 18.5 10l-6.4 2.1L10 18.5l-2.1-6.4L1.5 10l6.4-2.1L10 1.5Z" />
    </svg>
  );
}
