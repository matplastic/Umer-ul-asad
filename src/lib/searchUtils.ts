// Shared search helpers for the searchable material pickers.
//
// Multi-word search: every word you type must appear SOMEWHERE in the
// material's text, in any order. So "pellets marine", "marine 1mm" and
// "MP01800U" all find "MARINE PELLETS 1MM - EMP18000". (The old request
// search matched the typed text as one exact phrase, so word order and
// extra spaces broke it.)

export function searchTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesAllTokens(query: string, haystack: string): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const h = haystack.toLowerCase();
  return tokens.every(t => h.includes(t));
}

// Filters and ranks: names that START with what you typed come first, then
// names containing every word, then matches found only in the extra fields
// (ERP code, brand, supplier, location…). Ties keep the original order.
export function rankAndFilter<T extends { label: string; sub?: string; search?: string }>(items: T[], query: string): T[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return items;
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const label = item.label.toLowerCase();
    const hay = `${item.label} ${item.search ?? ''} ${item.sub ?? ''}`.toLowerCase();
    if (!tokens.every(t => hay.includes(t))) return;
    const score = label.startsWith(tokens[0]) ? 0 : tokens.every(t => label.includes(t)) ? 1 : 2;
    scored.push({ item, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(s => s.item);
}
