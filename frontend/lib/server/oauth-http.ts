// Shared HTTP form POST for the Google token endpoints (member login and the
// admin Gmail sender). Keeps the two OAuth modules from duplicating the same
// error normalization; response bodies are deliberately NOT echoed into
// errors because Google error payloads can contain sensitive material.
// Throws a plain Error; callers wrap it into their own safe error types.
// fallow-ignore-next-line complexity -- Transport, status, and payload failures each map to one safe error.
export async function postForm(
  url: string,
  fields: Record<string, string>,
  message: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(message);
  }
  if (!response.ok) {
    throw new Error(`${message} (${response.status})`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(message);
  }
  if (!payload || typeof payload !== "object") {
    throw new Error(message);
  }
  return payload as Record<string, unknown>;
}
