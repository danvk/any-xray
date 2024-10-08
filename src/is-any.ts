/** Does this quickinfo display string correspond to an any type? */
export function isAny(displayString: string): boolean {
  return (/[^)]: any$/.test(displayString) || displayString === 'any') && !displayString.startsWith('type ');
}
