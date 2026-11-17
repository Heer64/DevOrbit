import { useId } from 'react';

/*
 * DevOrbit "Monogram D" (Solar Ember): an orange glass D with a warm-white light inside it
 * and a chrome orbit ring. The moon keeps orbiting: it is drawn once behind the D and once,
 * clipped to the near half of the ring, in front of it, so it passes behind the glass and
 * comes back round. Motion is plain SVG (no library) and stops for "reduce motion".
 */
const ORBIT = 'M94 0 A94 28 0 1 1 -94 0 A94 28 0 1 1 94 0';
const D_PATH = 'M35.25 30 H94.75 A70 70 0 0 1 94.75 170 H35.25 Z M65.35 63.6 H94.75 A36.4 36.4 0 0 1 94.75 136.4 H65.35 Z';

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function Moon({ dur, children }) {
  return <g>{!prefersReducedMotion() && <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={ORBIT} />}{children}</g>;
}

/** Small mark for the sidebar, top bar and buttons. */
export function OrbitMark({ size = 36 }) {
  const k = useId().replace(/:/g, '');
  const still = prefersReducedMotion() ? { transform: 'translate(72px, 18px)' } : undefined;
  return (
    <svg className="orbit-mark" viewBox="0 0 200 200" width={size} height={size} aria-hidden="true" focusable="false" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={`${k}f`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd9b0" /><stop offset=".5" stopColor="#ff8a3d" /><stop offset="1" stopColor="#c2410c" /></linearGradient>
        <linearGradient id={`${k}r`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d9601a" /><stop offset=".4" stopColor="#ffffff" /><stop offset="1" stopColor="#ff8a3d" /></linearGradient>
        <clipPath id={`${k}c`}><rect x="-120" y="0" width="240" height="60" /></clipPath>
      </defs>
      <g transform="translate(100 104) rotate(-16)">
        <ellipse rx="94" ry="28" fill="none" stroke={`url(#${k}r)`} strokeWidth="8" opacity=".5" />
        <Moon dur={5}><circle r="14" fill="#ffe8cc" style={still} /></Moon>
      </g>
      <path d="M40 30 H96 A70 70 0 0 1 96 170 H40 Z M68 64 H96 A36 36 0 0 1 96 136 H68 Z" fill={`url(#${k}f)`} fillRule="evenodd" opacity=".92" />
      <circle cx="94" cy="100" r="13" fill="#fff8f0" opacity=".95" />
      <g transform="translate(100 104) rotate(-16)">
        <g clipPath={`url(#${k}c)`}>
          <ellipse rx="94" ry="28" fill="none" stroke={`url(#${k}r)`} strokeWidth="9" />
          <Moon dur={5}><circle r="14" fill="#ffe8cc" style={still} /></Moon>
        </g>
      </g>
    </svg>
  );
}

/** Large glass version for heroes (also the fallback when the 3D logo can't load). */
export function OrbitGlass({ size = 300 }) {
  const k = useId().replace(/:/g, '');
  return (
    <svg className="orbit-glass" viewBox="0 0 200 200" width={size} height={size} role="img" aria-label="DevOrbit logo: an orange glass letter D with a light inside and a moon on an orbit ring" style={{ overflow: 'visible', maxWidth: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id={`${k}F`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffd9b0" stopOpacity=".8" /><stop offset=".45" stopColor="#ff8a3d" stopOpacity=".5" /><stop offset="1" stopColor="#c2410c" stopOpacity=".66" /></linearGradient>
        <linearGradient id={`${k}S`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#9a3412" stopOpacity=".55" /><stop offset="1" stopColor="#431407" stopOpacity=".85" /></linearGradient>
        <linearGradient id={`${k}I`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".95" /><stop offset=".35" stopColor="#ff5d73" stopOpacity=".55" /><stop offset=".65" stopColor="#ffe8cc" stopOpacity=".6" /><stop offset="1" stopColor="#ffc98f" stopOpacity=".35" /></linearGradient>
        <linearGradient id={`${k}R`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d9601a" /><stop offset=".3" stopColor="#ffffff" /><stop offset=".55" stopColor="#ffc98f" /><stop offset=".8" stopColor="#ffffff" /><stop offset="1" stopColor="#d9601a" /></linearGradient>
        <linearGradient id={`${k}H`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".5" /><stop offset=".45" stopColor="#ffffff" stopOpacity="0" /></linearGradient>
        <radialGradient id={`${k}C`} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#fff8f0" /><stop offset=".3" stopColor="#ffe8cc" stopOpacity=".85" /><stop offset="1" stopColor="#ffe8cc" stopOpacity="0" /></radialGradient>
        <clipPath id={`${k}K`}><rect x="-120" y="0" width="240" height="60" /></clipPath>
      </defs>
      <g transform="translate(100 104) rotate(-16)">
        <ellipse rx="94" ry="28" fill="none" stroke={`url(#${k}R)`} strokeWidth="2.2" opacity=".5" />
        <Moon dur={7}><circle r="13" fill="#ffe8cc" opacity=".28" /><circle r="6" fill="#ffe8cc" /></Moon>
      </g>
      <circle cx="93" cy="100" r="34" fill={`url(#${k}C)`} opacity=".75" />
      <path transform="translate(5 6)" d={D_PATH} fill={`url(#${k}S)`} fillRule="evenodd" />
      <path d={D_PATH} fill={`url(#${k}F)`} fillRule="evenodd" stroke={`url(#${k}I)`} strokeWidth="1.6" strokeLinejoin="round" />
      <path d={D_PATH} fill={`url(#${k}H)`} fillRule="evenodd" />
      <circle cx="92" cy="100" r="7" fill="#fff8f0" />
      <ellipse cx="52" cy="44" rx="12" ry="4" fill="#ffffff" opacity=".55" transform="rotate(-8 52 44)" />
      <g transform="translate(100 104) rotate(-16)">
        <g clipPath={`url(#${k}K)`}>
          <ellipse rx="94" ry="28" fill="none" stroke={`url(#${k}R)`} strokeWidth="2.8" />
          <Moon dur={7}><circle r="13" fill="#ffe8cc" opacity=".28" /><circle r="6" fill="#ffe8cc" /><circle cx="-1.5" cy="-1.5" r="2" fill="#ffffff" opacity=".9" /></Moon>
        </g>
      </g>
    </svg>
  );
}

export default function Logo({ compact = false }) {
  return (
    <div className="brand">
      <span className="logo"><OrbitMark size={30} /></span>
      {!compact && <span className="wordmark">Dev<span>Orbit</span></span>}
    </div>
  );
}

export function LogoMark() {
  return <span className="logo"><OrbitMark size={30} /></span>;
}
