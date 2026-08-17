import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
  const pathname = context.url.pathname;
  const isAppRoute = pathname === "/app" || pathname.startsWith("/app/");

  if (!isAppRoute || !import.meta.env.DEV) {
    return next();
  }

  const dashboardUrl = new URL(
    `${context.url.pathname}${context.url.search}`,
    "http://localhost:5180",
  );
  return Response.redirect(dashboardUrl, 302);
});
