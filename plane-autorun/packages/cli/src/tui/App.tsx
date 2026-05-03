// M5 placeholder. Full Ink UI lives here from M6 onward — for now we just
// delegate to the headless renderer so `pnpm autorun --project doch` works.
import type { ProjectConfig } from "@plane-autorun/core";
import { runHeadless } from "../headless.js";

export interface TuiOptions {
  resumeRunBranch?: string;
  dryRun?: boolean;
}

export async function startTui(projects: ProjectConfig[], opts: TuiOptions): Promise<void> {
  await runHeadless(projects, { json: false, ...opts });
}
