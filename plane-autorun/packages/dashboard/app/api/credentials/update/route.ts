import { NextResponse } from "next/server";
import { resolve } from "node:path";
import { writeEnvKey } from "@plane-autorun/core";

const ALLOWED_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export async function POST(req: Request) {
  let body: { envVar?: string; value?: string };
  try {
    body = (await req.json()) as { envVar?: string; value?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { envVar, value } = body;
  if (!envVar || typeof envVar !== "string" || !ALLOWED_KEY_RE.test(envVar)) {
    return NextResponse.json({ error: "envVar must be UPPER_SNAKE_CASE" }, { status: 400 });
  }
  if (typeof value !== "string") {
    return NextResponse.json({ error: "value must be a string" }, { status: 400 });
  }
  // Block obvious dangerous keys that aren't ours to manage.
  const safe = envVar.startsWith("PLANE_") || envVar === "PLANE_AUTORUN_DB";
  if (!safe) {
    return NextResponse.json(
      { error: `${envVar} is outside the dashboard's edit scope (only PLANE_* allowed)` },
      { status: 403 },
    );
  }

  const envPath = resolve(process.cwd(), "../../.env");
  await writeEnvKey(envPath, envVar, value);

  // Update the running process so subsequent requests see the new value
  // without a restart for the OWN process. Other processes (CLI) need a
  // restart, which the UI documents.
  process.env[envVar] = value;

  return NextResponse.json({ ok: true, envVar, restartRequired: true });
}
