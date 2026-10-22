const TEXT_PREVIEW = 200;
const BLOB_PREVIEW = 24;

/** Bound cell text without changing the values held by the SQL runtime. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) {
    const hex = Array.from(value.subarray(0, BLOB_PREVIEW), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `BLOB (${value.byteLength} bytes)${hex ? ` ${hex}${value.byteLength > BLOB_PREVIEW ? '…' : ''}` : ''}`;
  }
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toFixed(2);
  const text = String(value);
  return text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}… (${text.length} characters)` : text;
}
