// What to do with a request for /login that carries a token which still verifies locally. Pure, so unit tests run it.
// The Auth server may already have ended that session; sending the visitor "home" then loops, because the pages ask the
// server and send them straight back.

/** "home": the session is good. "clear": the server rejected it. "stay": show the login page and keep the session. */
export type SessionVerdict = "home" | "clear" | "stay";

export function sessionVerdict(result: { error: { name?: string; status?: number } | null; hasProfile: boolean }): SessionVerdict {
  const { error, hasProfile } = result;
  // Only a definite refusal ends the session. A timeout, rate limit or server error leaves it for the next request.
  if (error) return error.name === "AuthSessionMissingError" || error.status === 401 || error.status === 403 ? "clear" : "stay";
  return hasProfile ? "home" : "stay";
}
