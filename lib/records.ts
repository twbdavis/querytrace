/** SQL identifiers are data, including JavaScript prototype property names. */
export function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/** structuredClone can restore ordinary prototypes at a worker boundary. */
export function ownValue<T>(record: Record<string, T> | Record<number, T> | undefined | null, key: string | number): T | undefined {
  return record && Object.hasOwn(record, key) ? (record as Record<string | number, T>)[key] : undefined;
}
