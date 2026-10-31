/**
 * Bunty's logo, drawn in code so it stays sharp at every size: orange speed
 * lines, a navy "B", the orange cart "U" (with its box and wheels), navy
 * "NTY", and the line "STORE • FAST DELIVERY" under it.
 *
 * The colours are the site's tokens (--color-navy, --color-orange). The same
 * shapes, with the colours written out, are in web/public/favicon.svg and the
 * PNGs used by emails; keep them in step when this changes.
 */

const NAVY = "var(--color-navy)";
const ORANGE = "var(--color-orange)";

/** The three speed lines in front of the B. */
function SpeedLines() {
  return (
    <g stroke={ORANGE} strokeWidth={9} strokeLinecap="round">
      <line x1={26} y1={38} x2={54} y2={38} />
      <line x1={10} y1={60} x2={54} y2={60} />
      <line x1={26} y1={82} x2={54} y2={82} />
    </g>
  );
}

/** The navy B, in the same stroke as the other letters. */
function LetterB() {
  return <path d="M76 14 V106 M76 14 H113 a22 22 0 0 1 0 44 H76 M76 58 H117 a24 24 0 0 1 0 48 H76" />;
}

/** The full logo: speed lines, BUNTY with the cart U, and the tagline. */
export function BuntyLogo({ className = "", tagline = true }: { className?: string; tagline?: boolean }) {
  return (
    <svg
      viewBox={tagline ? "0 0 480 160" : "0 0 480 128"}
      className={className}
      role="img"
      aria-label="Bunty Store: fast delivery"
    >
      <SpeedLines />
      {/* a low miter limit squares off the N's and Y's sharp corners instead of letting them spike */}
      <g fill="none" stroke={NAVY} strokeWidth={13} strokeLinejoin="miter" strokeMiterlimit={1.5}>
        <LetterB />
        {/* N */}
        <path d="M262 106 V14 L314 106 V14" />
        {/* T */}
        <path d="M330 14 H396 M363 14 V106" />
        {/* Y */}
        <path d="M410 14 L442 60 L474 14 M442 60 V106" />
      </g>
      {/* the cart U: handle, basket, the box inside, and two wheels */}
      <g fill="none" stroke={ORANGE} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round">
        <path d="M156 8 H172 V68 a30 30 0 0 0 60 0 V22" />
      </g>
      <g fill="none" stroke={ORANGE} strokeWidth={5} strokeLinejoin="round">
        <rect x={186} y={30} width={32} height={28} rx={3} />
        <path d="M197 36 V52 M207 36 V52" strokeLinecap="round" />
      </g>
      <g fill={NAVY}>
        <circle cx={188} cy={118} r={6} />
        <circle cx={216} cy={118} r={6} />
      </g>
      {tagline && (
        <text
          x={275}
          y={154}
          textAnchor="middle"
          fill={NAVY}
          fontSize={19}
          fontWeight={600}
          letterSpacing={7}
          fontFamily="'Segoe UI', system-ui, -apple-system, Roboto, Arial, sans-serif"
        >
          STORE <tspan fill={ORANGE}>•</tspan> FAST DELIVERY
        </text>
      )}
    </svg>
  );
}

/** The short logo: the B with its speed lines (phone header, browser tab). */
export function BuntyMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 6 146 108" className={className} role="img" aria-label="Bunty Store">
      <SpeedLines />
      <g fill="none" stroke={NAVY} strokeWidth={13}>
        <LetterB />
      </g>
    </svg>
  );
}
