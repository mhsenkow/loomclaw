import type { Collector } from "./types.ts";
import { gitCollector } from "./git.ts";
import { screenTimeCollector } from "./screentime.ts";
import { aiCollector } from "./ai.ts";
import { browsingCollector } from "./browsing.ts";
import { environmentCollector } from "./environment.ts";
import { healthCollector } from "./health.ts";

export * from "./types.ts";

/** Everything the engine knows how to read about you. All local. */
export const COLLECTORS: Collector[] = [
  gitCollector,
  screenTimeCollector,
  aiCollector,
  browsingCollector,
  healthCollector,
  environmentCollector,
];

export const COLLECTOR_BY_KIND = new Map(COLLECTORS.map((c) => [c.kind, c]));

/** How far back collectors reach on each sweep. */
export const WINDOW_DAYS = Number(process.env.LOOMCLAW_WINDOW_DAYS ?? 180);
