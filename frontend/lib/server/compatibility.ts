import type { NextRequest } from "next/server";

function requiresCatalogueCompatibility(request: NextRequest): boolean {
  return (
    request.headers.has("authorization") ||
    request.nextUrl.searchParams.has("user_key")
  );
}

export function catalogueCompatibilityResponse(
  request: NextRequest,
): Promise<Response> | undefined {
  return requiresCatalogueCompatibility(request)
    ? proxyCompatibility(request)
    : undefined;
}

async function proxyCompatibility(request: NextRequest): Promise<Response> {
  const baseUrl = (
    process.env.COMPATIBILITY_SERVICE_URL ||
    process.env.MODEL_SERVICE_URL ||
    "http://127.0.0.1:8001"
  ).replace(/\/+$/, "");
  const path = request.nextUrl.pathname.replace(/^\/api(?=\/|$)/, "");
  const destination = `${baseUrl}${path}${request.nextUrl.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  return fetch(destination, {
    method: request.method,
    headers,
    cache: "no-store",
  });
}
