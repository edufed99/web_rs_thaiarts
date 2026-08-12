/**
 * Convert the unbounded, z-calibrated Hybrid score into a display score.
 *
 * The logistic transform preserves ranking, maps zero to 50, and approaches
 * 0/100 without claiming that the result is a calibrated probability.
 */
export function recommendationScoreOutOf100(hybridScore: number): number {
  if (!Number.isFinite(hybridScore)) return 0;

  // Avoid overflow for unexpected extreme values while preserving every
  // meaningful score produced by the recommender.
  const boundedScore = Math.max(-20, Math.min(20, hybridScore));
  return Math.round(100 / (1 + Math.exp(-boundedScore)));
}
