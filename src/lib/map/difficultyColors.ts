/**
 * Difficulty → color mapping (E5.1), IMBA-inspired: green → blue → orange →
 * black, then purple shades for the push/carry range, gray for walking.
 * Pure module — used by the route renderer, the legend and the profile.
 */
export const WALKING_COLOR = '#6b7280'; // gray-500

/** index 0..6 */
const DIFF_PALETTE: readonly string[] = [
  '#2e7d32', // S0 green — forest road / easy
  '#1565c0', // S1 blue
  '#ef6c00', // S2 orange (theme accent family)
  '#212121', // S3 black
  '#6a1b9a', // S4 purple
  '#4a148c', // S5 deep purple (push/carry)
  '#7f1734', // S6 dark red — not rideable
];

export function difficultyColor(level: number): string {
  const clamped = Math.max(0, Math.min(6, Math.round(level)));
  return DIFF_PALETTE[clamped]!;
}

/** Color for a route segment (handles legacy records without `difficulty`). */
export function segmentColor(seg: {
  difficulty?: number;
  mtbDown: number;
  mtbUp: number;
  walking?: boolean;
}): string {
  if (seg.walking === true) return WALKING_COLOR;
  const level =
    seg.difficulty ?? Math.max(0, Math.min(6, Math.round(Math.max(seg.mtbDown, seg.mtbUp))));
  return difficultyColor(level);
}
