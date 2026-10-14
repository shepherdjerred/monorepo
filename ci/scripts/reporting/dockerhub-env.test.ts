import { expect, test } from "vitest";
import { dockerHubLogin } from "./dockerhub-env.ts";

const publisher = {
  DOCKERHUB_USERNAME: "shepherdjerred",
  DOCKERHUB_PUBLISH_TOKEN: "publisher-fixture",
};
const reader = {
  DOCKERHUB_READ_CONFIG_JSON: JSON.stringify({
    auths: {
      "https://index.docker.io/v1/": {
        username: "shepherdjerred",
        password: "reader-fixture",
      },
    },
  }),
};

test.each([
  ["publisher", publisher, "publisher-fixture"],
  ["reader", reader, "reader-fixture"],
] as const)(
  "logs in as %s through stdin",
  async (mode, environment, password) => {
    let calls = 0;
    await dockerHubLogin(mode, environment, async (command, input) => {
      calls += 1;
      expect(command).toEqual([
        "docker",
        "login",
        "docker.io",
        "--username",
        "shepherdjerred",
        "--password-stdin",
      ]);
      expect(input).toBe(password);
      expect(command).not.toContain(password);
      return 0;
    });
    expect(calls).toBe(1);
  },
);

test.each(["publisher", "reader"] as const)(
  "%s cannot borrow the other identity when its grant is absent",
  async (mode) => {
    let calls = 0;
    await expect(
      dockerHubLogin(mode, mode === "reader" ? publisher : reader, async () => {
        calls += 1;
        return 0;
      }),
    ).rejects.toThrow(`Docker Hub ${mode} credentials are missing or invalid`);
    expect(calls).toBe(0);
  },
);

test("rejects an unexpected publisher account without echoing its token", async () => {
  await expect(
    dockerHubLogin("publisher", { ...publisher, DOCKERHUB_USERNAME: "other" }),
  ).rejects.toThrow("Docker Hub publisher credentials are missing or invalid");
});

test.each(["", "reader-fixture malformed JSON", "null", '{"auths":{}}'])(
  "reader failures do not include malformed credential input",
  async (config) => {
    await expect(
      dockerHubLogin("reader", { DOCKERHUB_READ_CONFIG_JSON: config }),
    ).rejects.toThrow("Docker Hub reader credentials are missing or invalid");
  },
);

test("a failed login fails the lane", async () => {
  await expect(
    dockerHubLogin("publisher", publisher, async () => 1),
  ).rejects.toThrow("Docker Hub login exited 1");
});

function authConfig(
  auth: unknown,
  fields: Readonly<Record<string, string>> = {},
) {
  return {
    DOCKERHUB_READ_CONFIG_JSON: JSON.stringify({
      auths: {
        "https://index.docker.io/v1/": { auth, ...fields },
      },
    }),
  };
}

test("reads a standard auth-only config and preserves colons in the password", async () => {
  const auth = Buffer.from("shepherdjerred:reader:fixture").toString("base64");
  let calls = 0;
  await dockerHubLogin(
    "reader",
    authConfig(auth),
    async (command, password) => {
      calls += 1;
      expect(command).not.toContain(auth);
      expect(password).toBe("reader:fixture");
      return 0;
    },
  );
  expect(calls).toBe(1);
});

test.each([
  "not base64!",
  "",
  1,
  Buffer.from("missing-separator").toString("base64"),
  Buffer.from("other:reader-fixture").toString("base64"),
  Buffer.from("shepherdjerred:").toString("base64"),
  Buffer.from([255, 254]).toString("base64"),
])("rejects malformed auth without invoking login", async (auth) => {
  let calls = 0;
  await expect(
    dockerHubLogin("reader", authConfig(auth), async () => {
      calls += 1;
      return 0;
    }),
  ).rejects.toThrow("Docker Hub reader credentials are missing or invalid");
  expect(calls).toBe(0);
});

test("rejects conflicting auth and plaintext credential fields", async () => {
  const auth = Buffer.from("shepherdjerred:reader-fixture").toString("base64");
  await expect(
    dockerHubLogin(
      "reader",
      authConfig(auth, {
        username: "shepherdjerred",
        password: "different-fixture",
      }),
    ),
  ).rejects.toThrow("Docker Hub reader credentials are missing or invalid");
});
