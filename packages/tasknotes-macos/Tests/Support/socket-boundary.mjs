const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request, server) {
    if (server.upgrade(request)) return;
    return new Response("WebSocket required", { status: 400 });
  },
  websocket: {
    message(socket, request) {
      if (request === "binary") socket.send(new Uint8Array(2_097_152));
      else if (request === "oversized-binary") socket.send(new Uint8Array(2_097_153));
      else socket.close(1008);
    },
  },
});
process.stdout.write(String(server.port) + "\n");
