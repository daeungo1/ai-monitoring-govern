export function completeSum(values: readonly (number | null)[]): number | null {
  if (!values.length || values.some(value => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + value!, 0);
}
