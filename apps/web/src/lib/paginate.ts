/**
 * Client-side page merging for the cursor feeds.
 *
 * The API's cursor is keyset, not OFFSET, so a row inserted between two
 * requests cannot shift a later page onto rows the reader already has. That
 * makes duplicates a client bug rather than a server one — a double-tapped
 * "Show more", or a refetch that replays the same cursor. This merge is what
 * makes that harmless: append in arrival order, keep the first copy of any id.
 */
export function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): T[] {
  const seen = new Set(existing.map((item) => item.id));
  const merged = [...existing];

  for (const item of incoming) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return merged;
}
