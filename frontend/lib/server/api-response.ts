import { NextResponse } from "next/server";

export function apiError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...extra } },
    { status },
  );
}

export function internalApiError(): NextResponse {
  return apiError(
    500,
    "internal_server_error",
    "The server could not complete this request.",
  );
}
