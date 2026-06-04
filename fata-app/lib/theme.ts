/**
 * Espresso & Amber — Fata Morgana Design System
 *
 * Based on 2026 research:
 * - Linear-style dark-first (most admired UI pattern in 2026)
 * - OLED-optimized warm blacks (saves battery, easier on eyes)
 * - 4 surface levels (industry standard for dark mode depth)
 * - Single amber accent (food psychology: warm tones feel premium/appetising)
 * - Italian heritage: espresso, amber honey, terracotta
 */
export const C = {
  // ── 4 surface levels (dark mode standard) ──────────────────────────────────
  bg:       '#0E0A07',   // deepest  — espresso ground
  s1:       '#171210',   // elevated — dark roast
  s2:       '#211810',   // card     — medium roast
  s3:       '#2C2018',   // overlay  — latte

  // ── Primary accent — Amber (Italian honey, caramel, warm gold) ──────────────
  amber:    '#E8820C',
  amberLt:  '#F59E2A',
  amberDk:  '#B45309',
  amberGlow:'rgba(232,130,12,0.12)',
  amberBdr: 'rgba(232,130,12,0.22)',

  // ── Status colours ──────────────────────────────────────────────────────────
  sage:     '#5C7A54',   // success / positive  (pistachio green)
  sageLt:   '#7A9E70',
  sageBdr:  'rgba(92,122,84,0.25)',

  terra:    '#C2603A',   // warning / alert     (terracotta)
  terraLt:  '#D4845A',
  terraBdr: 'rgba(194,96,58,0.25)',

  // ── Typography ──────────────────────────────────────────────────────────────
  text:     '#F0EAE4',   // warm off-white (not harsh #fff)
  textSub:  '#A08070',   // warm medium brown
  muted:    '#6B5548',   // dark muted

  // ── Glass surfaces ──────────────────────────────────────────────────────────
  glass:    'rgba(255,255,255,0.04)',
  glassBdr: 'rgba(255,255,255,0.08)',

  // ── Gradients ──────────────────────────────────────────────────────────────
  gradBg:    ['#0E0A07', '#171210', '#0E0A07'] as const,
  gradAmber: ['#E8820C', '#B45309'] as const,
  gradCard:  ['#211810', '#191209'] as const,
  gradSage:  ['#5C7A54', '#3D5238'] as const,

  // ── Shadow ──────────────────────────────────────────────────────────────────
  shadow: 'rgba(0,0,0,0.5)',
} as const;
