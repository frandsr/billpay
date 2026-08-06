import { NextResponse } from "next/server";

import { db } from "@/lib/db";

/**
 * Health probe: `GET /api/health`.
 *
 * Railway polls this path after every deploy (see `railway.json`) and only
 * shifts traffic to the new container once it answers 200. A probe that just
 * returned `{ ok: true }` would pass while the app was completely broken, so
 * it also exercises the one dependency that can realistically be missing: the
 * database. `SELECT 1` is the cheapest query that proves the connection pool
 * is up and the credentials work.
 */

// Never prerender or cache this — a health check has to reflect the state of
// the running container, not the state at build time (when there is no
// database to reach at all).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    // Logged, not returned: driver errors can carry connection details.
    console.error("[health] database check failed", error);

    return NextResponse.json(
      { status: "error", database: "unreachable" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: "ok",
    database: "connected",
    latencyMs: Date.now() - startedAt,
    uptimeSeconds: Math.round(process.uptime()),
  });
}
