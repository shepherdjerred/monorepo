import { defineMiddleware } from "astro:middleware";

export const onRequest = defineMiddleware((context, next) => {
  if (!import.meta.env.DEV || !context.url.pathname.startsWith("/app")) {
    return next();
  }

  const dashboardUrl = new URL(
    `${context.url.pathname}${context.url.search}`,
    "http://localhost:5180",
  );
  return Response.redirect(dashboardUrl, 302);
});
