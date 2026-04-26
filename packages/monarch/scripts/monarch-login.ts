import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

const LOGIN_URL = "https://api.monarch.com/auth/login/";
const ENV_PATH = ".env";

type LoginResponse = {
  token?: string;
  [key: string]: unknown;
};

const rl = createInterface({ input: stdin, output: stdout });

try {
  const email = await rl.question("Email: ");
  const password = await readSecret("Password: ");

  let response = await login(email, password);
  if (response.status === 403) {
    const code = await rl.question("Two Factor Code: ");
    response = await login(email, password, code);
  }

  const body = await readBody(response);
  if (!response.ok) {
    console.error(
      `Login failed: HTTP ${String(response.status)} ${response.statusText}`,
    );
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const token = body.token;
  if (typeof token !== "string" || token === "") {
    console.error("Login succeeded but no token was present in the response.");
    console.error(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  await upsertEnvValue("MONARCH_TOKEN", token);
  console.log(`Saved MONARCH_TOKEN to ${ENV_PATH}`);
} finally {
  rl.close();
}

async function login(
  email: string,
  password: string,
  twoFactorCode?: string,
): Promise<Response> {
  const data = new URLSearchParams({
    password,
    supports_mfa: "true",
    trusted_device: "false",
    username: email,
  });

  if (twoFactorCode !== undefined && twoFactorCode !== "") {
    data.set("totp", twoFactorCode);
  }

  return fetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "Client-Platform": "web",
    },
    body: data,
  });
}

async function readBody(response: Response): Promise<LoginResponse> {
  const text = await response.text();
  if (text === "") return {};

  try {
    return JSON.parse(text) as LoginResponse;
  } catch {
    return { raw: text };
  }
}

async function upsertEnvValue(key: string, value: string): Promise<void> {
  const file = Bun.file(ENV_PATH);
  const existing = (await file.exists()) ? await file.text() : "";
  const lines = existing.split(/\r?\n/);
  const nextLine = `${key}=${value}`;
  let replaced = false;

  const nextLines = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines.at(-1) !== "") nextLines.push("");
    nextLines.push(nextLine);
  }

  await Bun.write(ENV_PATH, `${nextLines.join("\n").replace(/\n+$/, "")}\n`);
}

function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    stdout.write(prompt);

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";

    const onData = (char: string) => {
      switch (char) {
        case "\u0003":
          stdout.write("\n");
          process.exit(130);
          break;
        case "\r":
        case "\n":
          stdin.setRawMode(false);
          stdin.off("data", onData);
          stdout.write("\n");
          resolve(value);
          break;
        case "\u007f":
          value = value.slice(0, -1);
          break;
        default:
          value += char;
      }
    };

    stdin.on("data", onData);
  });
}
