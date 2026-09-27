import { colorOf } from "@among-us/shared";
import { useId, type CSSProperties } from "react";

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export type CrewmateVariant = "alive" | "ghost" | "dead";

/** Player avatar drawn in the player's color. */
export function Crewmate({
  color,
  size = 32,
  variant = "alive",
  className,
  style,
}: {
  color: string;
  size?: number;
  variant?: CrewmateVariant;
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  const base = colorOf(color).hex;
  const light = shade(base, 0.25);
  const dark = shade(base, -0.45);
  const stroke = "#0a0c14";
  return (
    <svg
      className={`crewmate crewmate-${variant} ${className ?? ""}`}
      viewBox="0 0 100 120"
      width={size}
      height={size * 1.2}
      style={style}
      aria-hidden
    >
      <defs>
        <linearGradient id={`b${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={dark} />
          <stop offset="0.45" stopColor={base} />
          <stop offset="1" stopColor={light} />
        </linearGradient>
        <linearGradient id={`v${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8f3ff" />
          <stop offset="0.55" stopColor="#8fd0ea" />
          <stop offset="1" stopColor="#4d8fb0" />
        </linearGradient>
      </defs>
      <g strokeLinejoin="round" strokeWidth="6" stroke={stroke}>
        {/* Backpack */}
        <rect x="7" y="40" width="24" height="46" rx="10" fill={dark} />
        {variant === "dead" ? (
          <>
            {/* Legs only, with a bone: the classic body */}
            <path d="M28 70 L86 70 L86 102 Q86 114 74 114 L68 114 Q61 114 61 106 L61 98 L53 98 L53 106 Q53 114 45 114 L40 114 Q28 114 28 102 Z" fill={`url(#b${id})`} />
            <path d="M52 70 L52 50" stroke="#f3eee2" strokeWidth="7" strokeLinecap="round" />
            <circle cx="46" cy="47" r="5" fill="#f3eee2" strokeWidth="3" />
            <circle cx="58" cy="47" r="5" fill="#f3eee2" strokeWidth="3" />
          </>
        ) : (
          <>
            <path
              d={
                variant === "ghost"
                  ? "M28 40 Q28 6 57 6 Q86 6 86 40 L86 108 L78 100 L70 110 L62 100 L54 110 L46 100 L38 110 L28 100 Z"
                  : "M28 40 Q28 6 57 6 Q86 6 86 40 L86 102 Q86 114 74 114 L68 114 Q61 114 61 106 L61 98 L53 98 L53 106 Q53 114 45 114 L40 114 Q28 114 28 102 Z"
              }
              fill={`url(#b${id})`}
            />
            {/* Visor */}
            <rect x="46" y="24" width="48" height="28" rx="14" fill={`url(#v${id})`} />
            <rect x="58" y="29" width="22" height="7" rx="3.5" fill="#fff" stroke="none" opacity="0.85" />
          </>
        )}
      </g>
    </svg>
  );
}
