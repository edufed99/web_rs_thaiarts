// fallow-ignore-next-line complexity -- Public integer parsing keeps lexical, safe-integer, and range checks explicit.
export function integerInRange(
  raw: string | null,
  minimum: number,
  maximum: number,
): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

export function integerWithDefault(
  raw: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined {
  return raw === null ? fallback : integerInRange(raw, minimum, maximum);
}
