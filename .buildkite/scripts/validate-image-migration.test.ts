import { describe, expect, test } from "bun:test";

import {
  assertUniqueSmokePorts,
  explicitSmokePort,
  httpSmokePort,
} from "./validate-image-migration.ts";

describe("parallel image smoke ports", () => {
  test("extracts exported listener ports from the smoke stage only", () => {
    const dockerfile = `
FROM runtime AS release
ENV APP_PORT=8787
FROM release AS smoke
RUN export APP_PORT=:18787; app
FROM release AS image
`;

    expect(explicitSmokePort(dockerfile, "app", "APP_PORT")).toEqual({
      image: "app",
      port: 18_787,
    });
  });

  test("extracts a loopback probe port", () => {
    const dockerfile = `
FROM runtime AS smoke
RUN app & wget http://127.0.0.1:18080/health
FROM runtime AS image
`;

    expect(httpSmokePort(dockerfile, "app")).toEqual({
      image: "app",
      port: 18_080,
    });
  });

  test("rejects implicit listener ports", () => {
    const dockerfile = `
FROM runtime AS smoke
RUN app
FROM runtime AS image
`;

    expect(() => explicitSmokePort(dockerfile, "app", "APP_PORT")).toThrow(
      "app smoke must export an explicit APP_PORT",
    );
  });

  test("rejects duplicate ports across concurrently baked smoke stages", () => {
    expect(() =>
      assertUniqueSmokePorts([
        { image: "bindery", port: 8787 },
        { image: "shelfbridge", port: 8787 },
      ]),
    ).toThrow(
      "shelfbridge and bindery smoke stages both bind port 8787 during parallel bake",
    );
  });
});
