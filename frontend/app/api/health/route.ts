import { NextResponse } from "next/server";

import { getDataSource } from "@/db/connection";
import { ApplicationStatusEntity } from "@/db/entities/ApplicationStatus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const dataSource = await getDataSource();
    const status = await dataSource
      .getRepository(ApplicationStatusEntity)
      .findOneBy({ key: "database" });
    if (status?.value !== "ready") {
      return NextResponse.json(
        { status: "unavailable", database: "not_ready" },
        { status: 503 },
      );
    }
    return NextResponse.json({ status: "ok", database: "connected" });
  } catch {
    return NextResponse.json(
      { status: "unavailable", database: "disconnected" },
      { status: 503 },
    );
  }
}
