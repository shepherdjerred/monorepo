import { createServer } from "node:net";

export async function getAvailableLocalPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error != null) {
          reject(error);
          return;
        }
        if (address == null || typeof address === "string") {
          reject(new Error("Could not allocate a local port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}
