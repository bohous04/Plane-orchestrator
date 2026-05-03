import { NextResponse } from "next/server";
import { getConfig } from "../../../../lib/core";

export async function GET() {
  const config = await getConfig();
  if (!config) {
    return NextResponse.json({ entries: [] });
  }
  // De-dupe env var names (multiple projects often share PLANE_TOKEN).
  const seen = new Set<string>();
  const entries: Array<{ envVar: string; isSet: boolean; usedBy: string[] }> = [];
  for (const project of config.projects) {
    if (seen.has(project.tokenEnvVar)) {
      const e = entries.find((x) => x.envVar === project.tokenEnvVar)!;
      e.usedBy.push(project.id);
      continue;
    }
    seen.add(project.tokenEnvVar);
    entries.push({
      envVar: project.tokenEnvVar,
      isSet: !!process.env[project.tokenEnvVar],
      usedBy: [project.id],
    });
  }
  // PLANE_API_URL is also a "credential" of sorts (server endpoint).
  if (!seen.has("PLANE_API_URL")) {
    entries.push({
      envVar: "PLANE_API_URL",
      isSet: !!process.env["PLANE_API_URL"],
      usedBy: ["(global)"],
    });
  }
  return NextResponse.json({ entries });
}
