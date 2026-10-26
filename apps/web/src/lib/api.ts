const j = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
};

export const getStatus = () => j<import("./types").Status>("/api/status");
export const getWeave = () =>
  j<{ persona: import("./types").Persona; beats: import("./types").Beat[]; gaps: string[]; framed_by_agent: number }>("/api/weave");
export const getMuse = () => j<{ boards: import("./types").BoardView[] }>("/api/muse");
export const getPersonas = () =>
  j<{ presets: { label: string; goals: string }[]; topics: string[]; active: import("./types").Persona }>("/api/personas");

type PersonaReply = {
  persona: import("./types").Persona;
  beats: import("./types").Beat[];
  gaps: string[];
  framed_by_agent: number;
};

export const setPersona = (label: string, goals: string) =>
  j<PersonaReply>("/api/persona", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label, goals }),
  });

/** Back to the ranking the feed had before any question was asked. */
export const clearPersona = () =>
  j<PersonaReply>("/api/persona", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reset: true }),
  });

export const triggerSweep = () => j<unknown>("/api/sweep", { method: "POST" });

export const setPin = (id: string, pinned: boolean) =>
  j<unknown>("/api/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pinned }),
  });

export const getProfile = () =>
  j<{
    profile: { interests: string[] | null; home_city: string; opted_in: string[] };
    onboarded: boolean;
    topics: import("../components/Onboarding").TopicOption[];
  }>("/api/profile");

export const onboard = (interests: string[], home_city: string) =>
  j<{ profile: unknown; enabled: { kind: string; label: string; scope: string }[] }>("/api/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ interests, home_city }),
  });
