/** The Stack4That mark: two blocks landed, a third dropping into place. */
export function LogoMark({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <defs>
        <linearGradient id="s4t-a" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8ab4ff" />
          <stop offset="1" stopColor="#6d7dff" />
        </linearGradient>
        <linearGradient id="s4t-b" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#9ef0c6" />
          <stop offset="1" stopColor="#3fcf9a" />
        </linearGradient>
        <linearGradient id="s4t-c" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb3f2" />
          <stop offset="1" stopColor="#b77bff" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="17.5" width="12.5" height="12.5" rx="3.4" fill="url(#s4t-a)" />
      <rect x="17" y="17.5" width="12.5" height="12.5" rx="3.4" fill="url(#s4t-b)" />
      <rect x="9.25" y="2.75" width="12.5" height="12.5" rx="3.4" fill="url(#s4t-c)" transform="rotate(-11 15.5 9)" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-semibold tracking-[-0.02em] text-white ${className}`}>
      Stack
      <span className="bg-gradient-to-br from-[#ffb3f2] via-[#b77bff] to-[#8ab4ff] bg-clip-text text-transparent">4</span>
      That
    </span>
  );
}
