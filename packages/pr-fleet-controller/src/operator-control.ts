import { chmod, rm } from "node:fs/promises";
import {
  OperatorInputAnswerSchema,
  type FleetTickReport,
  type OperatorInputAnswer,
} from "./schemas.ts";

export type OperatorControlServer = {
  socketPath: string;
  stop: () => Promise<void>;
};

function errorResponse(error: unknown, status = 400): Response {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status },
  );
}

export async function startOperatorControlServer(options: {
  socketPath: string;
  answer: (answer: OperatorInputAnswer) => Promise<FleetTickReport>;
}): Promise<OperatorControlServer> {
  await rm(options.socketPath, { force: true });
  const server = Bun.serve({
    unix: options.socketPath,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        return Response.json({ live: true });
      }
      const match = /^\/operator-requests\/([^/]+)\/answer$/.exec(url.pathname);
      if (match === null || request.method !== "POST") {
        return new Response("Not found", { status: 404 });
      }
      const requestId = match[1];
      if (requestId === undefined) {
        return new Response("Not found", { status: 404 });
      }
      try {
        const answer = OperatorInputAnswerSchema.parse(await request.json());
        if (answer.requestId !== decodeURIComponent(requestId)) {
          throw new Error("Answer request ID does not match the URL");
        }
        const report = await options.answer(answer);
        return Response.json({ accepted: true, snapshot: report.snapshot });
      } catch (error) {
        return errorResponse(error);
      }
    },
  });
  await chmod(options.socketPath, 0o600);
  return {
    socketPath: options.socketPath,
    stop: async () => {
      await server.stop(true);
      await rm(options.socketPath, { force: true });
    },
  };
}
