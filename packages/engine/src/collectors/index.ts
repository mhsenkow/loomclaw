import type { Collector } from "./types.ts";
import { gitCollector } from "./git.ts";
import { screenTimeCollector } from "./screentime.ts";
import { aiCollector } from "./ai.ts";
import { browsingCollector } from "./browsing.ts";
import { environmentCollector } from "./environment.ts";
import { WORLD_COLLECTORS } from "./world.ts";
import { collectorEnabled } from "../profile.ts";
import { healthCollector } from "./health.ts";

export * from "./types.ts";

/** Everything the engine knows how to read about you. All local. */
const SELF_COLLECTORS: Collector[] = [
  gitCollector,
  screenTimeCollector,
  aiCollector,
  browsingCollector,
  healthCollector,
  environmentCollector,
];

/**
 * Everything the engine knows how to read: your own machine first, then the
 * world feeds your interests switched on. One list, because downstream
 * nothing distinguishes them — that is the point.
 */
export const COLLECTORS: Collector[] = [...SELF_COLLECTORS, ...WORLD_COLLECTORS];

/** The subset that will actually run, given the profile. */
export const activeCollectors = (): Collector[] => COLLECTORS.filter((c) => collectorEnabled(c));

export const COLLECTOR_BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** How far back collectors reach on each sweep. */
export const WINDOW_DAYS = Number(process.env.LOOMCLAW_WINDOW_DAYS ?? 180);
