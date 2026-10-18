import { createServer } from "node:http";
import { once } from "node:events";
import assert from "node:assert/strict";
import { postalHttp } from "./postal-http.ts";

const server = createServer((request, response) => {
  response.end(request.headers.host);
});
server.listen(0, "127.0.0.1");
try {
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing fixture address");
  const response = await postalHttp(
    new URL(`http://127.0.0.1:${String(address.port)}/`),
    {
      method: "POST",
      body: "{}",
      headers: { Host: "postal.fixture.internal" },
    },
  );
  assert.equal(await response.text(), "postal.fixture.internal");
} finally {
  server.closeAllConnections();
  server.close();
}
