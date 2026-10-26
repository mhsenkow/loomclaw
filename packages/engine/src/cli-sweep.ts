// One-shot sweep for the terminal — same code path the server schedules.
import { homedir } from "node:os";
import { join } from "node:path";
import { GraphStore } from "./graph.ts";
import { runSweep } from "./sweep.ts";

const store = new GraphStore(process.env.LOOMCLAW_DB ?? join(homedir(), ".loomclaw", "graph.db"));
const report = await runSweep(store, (e, d) => {
  if (e === "spine:step") {
    const s = d as { tool_name: string; status: string; stdout_preview: string };
    console.log(`  ${s.status === "success" ? "✓" : "✕"} ${s.tool_name.padEnd(22)} ${s.stdout_preview.split("\n")[0].slice(0, 90)}`);
  }
});
console.log("\n" + JSON.stringify(report, null, 2));
