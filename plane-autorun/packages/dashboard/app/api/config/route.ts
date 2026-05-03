import { NextResponse } from "next/server";
import { getConfig } from "../../../lib/core";

export async function GET() {
  const config = await getConfig();
  if (!config) {
    return NextResponse.json(
      { error: "projects.config.ts not found at workspace root" },
      { status: 500 },
    );
  }
  return NextResponse.json({ config });
}
