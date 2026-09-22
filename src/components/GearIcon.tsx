/**
 * Settings gear. The outline is generated geometry rather than a hand-drawn path:
 * eight teeth on a 9.15 tip / 6.75 root radius, with 4.6° flanks so the slopes stay
 * even all the way round. Stroked rather than filled, to sit at the same weight as
 * the rest of the header chrome.
 */
export function GearIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M20.98 10.25A9.15 9.15 0 0 1 20.98 13.75L18.50 13.82A6.75 6.75 0 0 1 17.88 15.31L19.59 17.12A9.15 9.15 0 0 1 17.12 19.59L15.31 17.88A6.75 6.75 0 0 1 13.82 18.50L13.75 20.98A9.15 9.15 0 0 1 10.25 20.98L10.18 18.50A6.75 6.75 0 0 1 8.69 17.88L6.88 19.59A9.15 9.15 0 0 1 4.41 17.12L6.12 15.31A6.75 6.75 0 0 1 5.50 13.82L3.02 13.75A9.15 9.15 0 0 1 3.02 10.25L5.50 10.18A6.75 6.75 0 0 1 6.12 8.69L4.41 6.88A9.15 9.15 0 0 1 6.88 4.41L8.69 6.12A6.75 6.75 0 0 1 10.18 5.50L10.25 3.02A9.15 9.15 0 0 1 13.75 3.02L13.82 5.50A6.75 6.75 0 0 1 15.31 6.12L17.12 4.41A9.15 9.15 0 0 1 19.59 6.88L17.88 8.69A6.75 6.75 0 0 1 18.50 10.18L20.98 10.25Z" />
      <circle cx="12" cy="12" r="3.15" />
    </svg>
  );
}
