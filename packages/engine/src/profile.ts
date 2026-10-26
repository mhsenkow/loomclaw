// =================================================================
// Profile — the interests you picked, and what they switch on
// =================================================================
// Interests do two jobs, and the second is the one that matters:
//   1. they rank what you see (the persona layer already did this), and
//   2. they decide which world feeds are polled at all.
//
// The second is why this is a profile and not a filter. An interest you
// did not pick costs nothing — its feed is never fetched, so the engine
// stays small, and nothing is collected "just in case".
// =================================================================

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { TOPICS, type Topic } from "./topics.ts";

const PATH = process.env.LOOMCLAW_PROFILE ?? join(homedir(), ".loomclaw", "profile.json");

export interface Profile {
  /** Null until onboarding completes — which is how the UI knows to show it. */
  interests: Topic[] | null;
  /** City for the air-quality feed and any place-scoped claim. */
  home_city: string;
  /** Collectors the user explicitly switched on despite the privacy default. */
  opted_in: string[];
  created_at: string | null;
}

const EMPTY: Profile = {
  interests: null,
  home_city: process.env.LOOMCLAW_HOME_CITY ?? "New York",
  opted_in: [],
  created_at: null,
};

let cached: Profile | null = null;

export function loadProfile(): Profile {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(PATH, "utf8")) as Partial<Profile>;
    const interests = Array.isArray(raw.interests)
      ? raw.interests.filter((t): t is Topic => TOPICS.includes(t as Topic))
      : null;
    cached = {
      interests: interests && interests.length ? interests : null,
      home_city: raw.home_city || EMPTY.home_city,
      opted_in: Array.isArray(raw.opted_in) ? raw.opted_in : [],
      created_at: raw.created_at ?? null,
    };
  } catch {
    cached = { ...EMPTY };
  }
  return cached;
}

export function saveProfile(next: Partial<Profile>): Profile {
  const merged: Profile = {
    ...loadProfile(),
    ...next,
    created_at: loadProfile().created_at ?? new Date().toISOString(),
  };
  mkdirSync(dirname(PATH), { recursive: true });
  writeFileSync(PATH, JSON.stringify(merged, null, 2) + "\n", "utf8");
  cached = merged;
  return merged;
}

export const isOnboarded = () => (loadProfile().interests?.length ?? 0) > 0;

/**
 * Weights derived from the picked interests.
 *
 * Before onboarding every topic weighs the same, so the feed still works and
 * ranks on statistical strength alone — an empty profile degrades to "show me
 * whatever is strongest" rather than to an empty screen.
 */
export function interestWeights(p = loadProfile()): Partial<Record<Topic, number>> {
  if (!p.interests?.length) return Object.fromEntries(TOPICS.map((t) => [t, 1]));
  return Object.fromEntries(p.interests.map((t) => [t, 1]));
}

/**
 * Whether a collector is worth running. A personal collector always is —
 * it is about you, and reading your own disk is cheap. A world feed runs
 * only when it serves an interest you actually picked.
 */
export function collectorEnabled(
  c: { kind: string; scope: "self" | "world"; topics: Partial<Record<string, number>> },
  p = loadProfile(),
): boolean {
  if (c.scope === "self") return true;
  if (!p.interests?.length) return false; // nothing picked yet: no outbound polling
  return p.interests.some((t) => (c.topics[t] ?? 0) >= 0.5);
}
