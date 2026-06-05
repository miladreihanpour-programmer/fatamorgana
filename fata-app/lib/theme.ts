/**
 * Fata Morgana — Light Luxury Design System
 *
 * Palette drawn directly from the logo:
 *   Orange  #E07B1A — the warm orange gelato circle
 *   Green   #7DB32A — the olive-green circle
 *   Brown   #5C3417 — the chocolate cone/dark circle
 *
 * Aesthetic: airy Italian gelateria — crisp cream whites,
 * warm parchment surfaces, rich brand-orange accents.
 */
export const C = {
  // ── 4 surface levels — warm ivory / cream ────────────────────────────────
  bg:       '#FAF8F4',   // warm ivory — main background
  s1:       '#FFFFFF',   // pure white — elevated cards
  s2:       '#F4EFE6',   // warm cream — secondary surface
  s3:       '#EDE4D6',   // warm parchment — overlays / pressed states

  // ── Primary accent — logo orange, refined for elegance ────────────────────
  amber:    '#C86D0A',   // deep brand bronze-orange (buttons, highlights)
  amberLt:  '#E07B1A',   // logo orange (brighter accents)
  amberDk:  '#8C4A06',   // dark bronze (text on light, pressed states)
  amberGlow:'rgba(200,109,10,0.10)',
  amberBdr: 'rgba(200,109,10,0.24)',

  // ── Secondary — logo olive-green (success / positive) ─────────────────────
  sage:     '#5A8C1A',   // deep green
  sageLt:   '#7DB32A',   // logo green
  sageBdr:  'rgba(90,140,26,0.22)',

  // ── Alert — terracotta (warning / negative) ───────────────────────────────
  terra:    '#B83A1A',
  terraLt:  '#D4563A',
  terraBdr: 'rgba(184,58,26,0.22)',

  // ── Typography ────────────────────────────────────────────────────────────
  text:     '#1C1008',   // very dark warm brown — headings
  textSub:  '#6B4A28',   // medium warm brown — body
  muted:    '#A88060',   // light warm brown — captions / placeholders

  // ── Dividers & glass ──────────────────────────────────────────────────────
  glass:    'rgba(28,18,8,0.03)',
  glassBdr: 'rgba(28,18,8,0.09)',

  // ── Gradients ─────────────────────────────────────────────────────────────
  gradBg:    ['#FAF8F4', '#F4EFE6', '#FAF8F4'] as const,
  gradAmber: ['#E07B1A', '#C86D0A'] as const,   // orange → deep bronze
  gradCard:  ['#FFFFFF', '#F9F3EA'] as const,
  gradSage:  ['#7DB32A', '#5A8C1A'] as const,

  // ── Shadow ────────────────────────────────────────────────────────────────
  shadow: 'rgba(40,15,5,0.10)',
} as const;
