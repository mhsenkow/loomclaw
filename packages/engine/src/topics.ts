// =================================================================
// Topics — one vocabulary for you and for the world
// =================================================================
// The point of a single list: "health" selects both your sleep and the
// air you breathe; "technology" selects both what you build and what the
// field is doing. Interests are not a filter bolted onto two separate
// products — they are the axis the whole graph is ranked on.
// =================================================================

export type Topic =
  // --- about you ---
  | "output" | "rhythm" | "focus" | "balance" | "learning" | "projects"
  // --- shared: these have a personal side AND a world side ---
  | "health" | "environment" | "technology" | "cities" | "transport" | "food"
  // --- about the world ---
  | "politics" | "money" | "science" | "safety" | "culture" | "world";

export const TOPICS: Topic[] = [
  "output", "rhythm", "focus", "balance", "learning", "projects",
  "health", "environment", "technology", "cities", "transport", "food",
  "politics", "money", "science", "safety", "culture", "world",
];

export type TopicScope = "self" | "shared" | "world";

export interface TopicMeta {
  label: string;
  /** Shown in onboarding — what picking this actually gets you. */
  blurb: string;
  scope: TopicScope;
}

export const TOPIC_META: Record<Topic, TopicMeta> = {
  output:      { label: "What I ship",        scope: "self",   blurb: "Commits, lines, which projects actually move" },
  rhythm:      { label: "When I work",        scope: "self",   blurb: "Your hours, your days, your peaks and troughs" },
  focus:       { label: "My focus",           scope: "self",   blurb: "Deep stretches versus context-switching" },
  balance:     { label: "Am I overdoing it",  scope: "self",   blurb: "Late nights, weekend work, whether rest is holding" },
  learning:    { label: "How I learn",        scope: "self",   blurb: "When you reach for an agent, and on what" },
  projects:    { label: "What I'm building",  scope: "self",   blurb: "Where your effort is concentrated or scattered" },

  health:      { label: "Health",             scope: "shared", blurb: "Your sleep and heart — and recalls, air, food safety" },
  environment: { label: "Environment",        scope: "shared", blurb: "The air where you live — and quakes, storms, alerts" },
  technology:  { label: "Technology",         scope: "shared", blurb: "What you build — and what the field is surfacing" },
  cities:      { label: "City life",          scope: "shared", blurb: "Where you live — and what your city is complaining about" },
  transport:   { label: "Getting around",     scope: "shared", blurb: "Flight delays, vehicle recalls, transit friction" },
  food:        { label: "Food",               scope: "shared", blurb: "Recalls, inspections, what's in packaged food" },

  politics:    { label: "Politics & power",   scope: "world",  blurb: "Lobbying money, who's buying policy attention" },
  money:       { label: "Money & markets",    scope: "world",  blurb: "Market breadth, risk appetite, concentration" },
  science:     { label: "Science",            scope: "world",  blurb: "Where research effort is being spent" },
  safety:      { label: "Safety & risk",      scope: "world",  blurb: "Recalls, warnings, hazards as they're filed" },
  culture:     { label: "What people notice", scope: "world",  blurb: "Collective attention — what the public looked up" },
  world:       { label: "The world",          scope: "world",  blurb: "Connectivity, disruption, country-level signals" },
};

/** Which personal collectors serve which interests. */
export const SELF_TOPICS: Record<string, Partial<Record<Topic, number>>> = {
  git:         { output: 1.0, projects: 0.95, rhythm: 0.9, balance: 0.6, technology: 0.5 },
  screentime:  { focus: 1.0, rhythm: 0.8, balance: 0.8, output: 0.4 },
  ai:          { learning: 1.0, output: 0.7, projects: 0.6, technology: 0.5 },
  browsing:    { focus: 0.9, learning: 0.5, culture: 0.4 },
  health:      { health: 1.0, balance: 0.9, rhythm: 0.5 },
  environment: { environment: 1.0, health: 0.7, cities: 0.5 },
};

/**
 * Words that point at a topic. A router, not a classifier — written in the
 * language people use for themselves AND for the world, since one phrase
 * ("health") legitimately means both here.
 */
export const LEXICON: Record<Topic, string[]> = {
  output:      ["output", "productive", "productivity", "ship", "shipping", "build", "built", "building", "commit", "work done", "accomplish", "deliver"],
  rhythm:      ["rhythm", "when", "time of day", "schedule", "morning", "night", "late", "hour", "pattern", "routine", "cadence", "best work"],
  focus:       ["focus", "focused", "deep work", "distract", "distracted", "interrupt", "context switch", "switching", "scattered", "flow", "attention", "screen time"],
  balance:     ["balance", "burnout", "burning out", "overwork", "overworking", "rest", "rested", "break", "weekend", "exhaust", "tired", "sustainable", "recover"],
  learning:    ["learn", "learning", "study", "skill", "improve", "growth", "agent", "claude", "explore"],
  projects:    ["project", "projects", "repo", "repository", "working on", "side project", "juggling"],
  health:      ["health", "healthy", "sleep", "sleeping", "slept", "body", "heart", "resting", "steps", "exercise", "fitness", "medical", "disease", "recall", "wellbeing", "well-being"],
  environment: ["environment", "climate", "weather", "pollut", "air quality", "emission", "earthquake", "storm", "flood", "fire", "nature", "ecolog", "breathing"],
  technology:  ["tech", "software", "computer", "internet", "digital", "startup", "engineer", "code", "machine learning", "developer"],
  cities:      ["city", "cities", "urban", "neighborhood", "municipal", "local", "borough", "town", "civic", "resident", "housing", "where i live"],
  transport:   ["transport", "travel", "flight", "airline", "airport", "traffic", "commut", "car", "vehicle", "transit", "road", "drive"],
  food:        ["food", "eat", "diet", "grocer", "nutrition", "restaurant", "agricultur", "meal", "ingredient", "contamina"],
  politics:    ["politic", "government", "congress", "senate", "policy", "lobby", "election", "regulation", "legislat", "influence", "corrupt", "power"],
  money:       ["money", "econom", "financ", "market", "spend", "cost", "price", "inflation", "budget", "fund", "dollar", "invest", "capital", "crypto"],
  science:     ["science", "scientif", "research", "paper", "academ", "discover", "physics", "biolog", "experiment", "arxiv"],
  safety:      ["safe", "safety", "risk", "danger", "hazard", "accident", "injur", "warning", "emergenc", "disaster", "crime"],
  culture:     ["culture", "cultural", "public", "people", "trend", "trending", "attention", "popular", "curious", "looked up", "wikipedia"],
  world:       ["world", "global", "international", "country", "countries", "geopolit", "outage", "connectivity", "unrest"],
};
