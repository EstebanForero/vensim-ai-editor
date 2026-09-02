let counter = 0;

/** Deterministic, collision-resistant id generator (not crypto-random — fine for in-memory model elements). */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${counter.toString(36)}_${Date.now().toString(36)}`;
}

export function resetIdCounterForTests(): void {
  counter = 0;
}
