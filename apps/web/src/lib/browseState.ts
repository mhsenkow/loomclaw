// =================================================================
// Browse state — layout, density, filters, sort
// =================================================================
// Ported from Loom's Discover view so the two read as one product: the
// same four layouts, the same three densities, the same filter-sentence
// grammar. What differs is what the filters select over, since here a
// finding has a scope (you / world) and a detector behind it.
// =================================================================

import type { Beat } from "./types.ts";

export type Layout = "flow" | "tiles" | "masonry" | "list";
export type Density = "compact" | "standard" | "broadsheet";
export type Sort = "recommended" | "strongest" | "newest" | "surprising";
export type ScopeFilter = "all" | "self" | "world" | "both";

export interface BrowseState {
  layout: Layout;
  density: Density;
  sort: Sort;
  scope: ScopeFilter;
  topic: string;
  source: string;
  detector: string;
  query: string;
}

export const DEFAULT_BROWSE: BrowseState = {
  layout: "flow",
  density: "standard",
  sort: "recommended",
  scope: "all",
  topic: "all",
  source: "all",
  detector: "all",
  query: "",
};

const KEY = "loomclaw.browse";

export function loadBrowse(): BrowseState {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<BrowseState>;
    return { ...DEFAULT_BROWSE, ...raw, query: "" };
  } catch {
    return { ...DEFAULT_BROWSE };
  }
}

export function saveBrowse(s: BrowseState) {
  // The query is deliberately not persisted — a stale search on reload
  // looks like an empty feed rather than a filter you forgot you set.
  try { localStorage.setItem(KEY, JSON.stringify({ ...s, query: "" })); } catch { /* private mode */ }
}

export const SORTS: { id: Sort; label: string }[] = [
  { id: "recommended", label: "Recommended" },
  { id: "strongest",   label: "Strongest effect" },
  { id: "newest",      label: "Most recent" },
  { id: "surprising",  label: "Most surprising" },
];

export const SCOPES: { id: ScopeFilter; label: string }[] = [
  { id: "all",   label: "Everything" },
  { id: "self",  label: "About me" },
  { id: "world", label: "About the world" },
  { id: "both",  label: "Me × the world" },
];

export const LAYOUTS: { id: Layout; label: string; glyph: string }[] = [
  { id: "flow",    label: "Flow",    glyph: "▦" },
  { id: "tiles",   label: "Tiles",   glyph: "▣" },
  { id: "masonry", label: "Masonry", glyph: "▥" },
  { id: "list",    label: "List",    glyph: "☰" },
];

export const DENSITIES: { id: Density; label: string }[] = [
  { id: "compact",    label: "S" },
  { id: "standard",   label: "M" },
  { id: "broadsheet", label: "L" },
];

/**
 * Visual weight for a beat in the flow layout.
 *
 * Rank order decides it, not the statistic — a page where every card
 * claims to be the lead reads as noise. The first is the lead, the next
 * couple are wide, the long tail is brief.
 */
export type Tier = "lead" | "wide" | "standard" | "brief";

export function tierOf(index: number, total: number): Tier {
  if (index === 0) return "lead";
  if (index <= 2) return "wide";
  if (index >= Math.max(8, total - 4)) return "brief";
  return "standard";
}

export const tierSpan = (t: Tier) => (t === "lead" ? 3 : t === "wide" ? 2 : 1);

/** Apply every filter, then order. Pure, so the view is a function of state. */
export function applyBrowse(beats: Beat[], s: BrowseState): Beat[] {
  const q = s.query.trim().toLowerCase();
  const out = beats.filter((b) => {
    if (s.scope !== "all" && (b.scope ?? "self") !== s.scope) return false;
    if (s.detector !== "all" && b.insight.detector !== s.detector) return false;
    if (s.source !== "all" && !b.insight.source_kind.split("+").includes(s.source)) return false;
    if (q) {
      const hay = `${b.insight.headline} ${b.insight.source_kind} ${b.insight.statistic.name} ${b.node.weave.narrative_annotation ?? ""}`;
      if (!hay.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const by: Record<Sort, (a: Beat, b: Beat) => number> = {
    recommended: (a, b) => b.rank - a.rank,
    strongest:   (a, b) => b.insight.statistic.effect_size - a.insight.statistic.effect_size,
    newest:      (a, b) => (b.insight.detected_at > a.insight.detected_at ? 1 : -1),
    // Novelty is merit discounted by repetition, so a low score against a
    // high merit is precisely a claim we have not made before.
    surprising:  (a, b) =>
      (b.insight.merit - b.insight.score) - (a.insight.merit - a.insight.score),
  };
  return out.sort(by[s.sort]);
}
