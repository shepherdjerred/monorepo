import { cors } from "hono/cors";

const corsOrigin = Bun.env["CORS_ORIGIN"] ?? "https://status.sjer.red";
const allowedOrigins = new Set(corsOrigin.split(",").map((o) => o.trim()));

export const corsMiddleware = cors({
  origin: (origin) => {
    if (allowedOrigins.has(origin)) {
      return origin;
    }
    if (origin.startsWith("http://localhost")) {
      return origin;
    }
    return "";
  },
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization"],
});
