export function buildDevLoginRedirect(
  appOrigin: string,
  returnTo: string,
): Response {
  const location = new URL("/api/dev/login", appOrigin);
  location.searchParams.set("returnTo", returnTo);
  return Response.redirect(location.toString(), 302);
}
