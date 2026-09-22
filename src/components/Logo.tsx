/**
 * The Stack4That mark: three isometric plates, the top one still dropping into place.
 * The two landed plates sit a hair apart; the third floats well clear of them, so the
 * glyph reads as a stack mid-assembly rather than a finished slab. It is drawn slightly
 * smaller to sit "further away", which also keeps it from crowding the mark at 16px.
 *
 * Monochrome by design: the incoming plate is the brightest thing here and the foundation
 * the dimmest, so depth reads from value rather than hue, matching --accent.
 */

/** One plate as an isometric diamond centred on (16, cy). */
const plate = (cy: number, hw: number, hh: number) => `M16 ${cy - hh}L${16 + hw} ${cy}L16 ${cy + hh}L${16 - hw} ${cy}Z`;

const HW = 11;
const HH = 3.6;
/** The falling plate, scaled down to read as further from the viewer. */
const FAR = 0.82;

export function LogoMark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id="s4t-base" x1="5" y1="22" x2="27" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6e6e79" />
          <stop offset="1" stopColor="#44444d" />
        </linearGradient>
        <linearGradient id="s4t-mid" x1="5" y1="14" x2="27" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a6a6b1" />
          <stop offset="1" stopColor="#66666f" />
        </linearGradient>
        <linearGradient id="s4t-top" x1="7" y1="4" x2="25" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#c8c8d2" />
        </linearGradient>
      </defs>

      <path d={plate(26, HW, HH)} fill="url(#s4t-base)" />
      <path d={plate(18.2, HW, HH)} fill="url(#s4t-mid)" />
      <path d={plate(7, HW * FAR, HH * FAR)} fill="url(#s4t-top)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.02em] text-white ${className}`}>
      Stack
      <span className="bg-gradient-to-br from-white via-[#c2c2cc] to-[#6f6f7a] bg-clip-text text-transparent">4</span>
      That
    </span>
  );
}
