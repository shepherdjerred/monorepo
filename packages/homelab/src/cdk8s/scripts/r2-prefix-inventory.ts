import { createHash, createHmac } from "node:crypto";

const accessKeyId = Bun.env["CLOUDFLARE_R2_ACCESS_KEY_ID"] ?? "";
const secretAccessKey = Bun.env["CLOUDFLARE_R2_SECRET_ACCESS_KEY"] ?? "";
const endpoint = Bun.env["CLOUDFLARE_R2_ENDPOINT"] ?? "";
const bucket = Bun.env["R2_BUCKET_NAME"] ?? "homelab";
const basePrefix = Bun.env["R2_PREFIX"] ?? "";
const prefixDepth = Number.parseInt(Bun.env["R2_PREFIX_DEPTH"] ?? "1", 10);

type InventoryGroup = {
  prefix: string;
  bytes: number;
  objects: number;
  newest: string;
};

function assertEnv(name: string, value: string): void {
  if (value === "") {
    throw new Error(`${name} is required`);
  }
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replaceAll(
    /[!'()*]/g,
    (char) => `%${(char.codePointAt(0) ?? 0).toString(16).toUpperCase()}`,
  );
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replaceAll(/[:-]|\.\d{3}/g, "");
}

function credentialScope(dateStamp: string): string {
  return `${dateStamp}/auto/s3/aws4_request`;
}

function signingKey(dateStamp: string): Buffer {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function textFromXml(xml: string, tag: string): string | undefined {
  const match = new RegExp(String.raw`<${tag}>([\s\S]*?)</${tag}>`).exec(xml);
  return match?.[1] === undefined ? undefined : decodeXml(match[1]);
}

function groupName(key: string): string {
  const relative =
    basePrefix !== "" && key.startsWith(basePrefix)
      ? key.slice(basePrefix.length)
      : key;
  const parts = relative.split("/").filter((part) => part !== "");
  if (parts.length === 0) {
    return "(root)";
  }
  return `${parts.slice(0, Math.max(1, prefixDepth)).join("/")}/`;
}

async function listObjects(continuationToken: string | undefined): Promise<{
  objects: { key: string; size: number; lastModified: string }[];
  nextContinuationToken: string | undefined;
}> {
  const now = new Date();
  const amzDate = formatAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256("");
  const endpointUrl = new URL(endpoint);
  const host = endpointUrl.host;
  const query: Record<string, string> = {
    "list-type": "2",
    "max-keys": "1000",
  };
  if (basePrefix !== "") {
    query["prefix"] = basePrefix;
  }
  if (continuationToken !== undefined) {
    query["continuation-token"] = continuationToken;
  }

  const canonicalQuery = Object.entries(query)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join("&");
  const canonicalUri = `/${awsEncode(bucket)}`;
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope(dateStamp),
    sha256(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope(dateStamp)}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const requestUrl = new URL(endpoint);
  requestUrl.pathname = canonicalUri;
  requestUrl.search = canonicalQuery;

  const response = await fetch(requestUrl, {
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });
  if (!response.ok) {
    throw new Error(
      `R2 ListObjectsV2 failed: ${response.status.toString()} ${await response.text()}`,
    );
  }

  const xml = await response.text();
  const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(
    (match) => {
      const content = match[1] ?? "";
      return {
        key: textFromXml(content, "Key") ?? "",
        size: Number.parseInt(textFromXml(content, "Size") ?? "0", 10),
        lastModified: textFromXml(content, "LastModified") ?? "",
      };
    },
  );

  return {
    objects,
    nextContinuationToken:
      textFromXml(xml, "IsTruncated") === "true"
        ? textFromXml(xml, "NextContinuationToken")
        : undefined,
  };
}

async function main(): Promise<void> {
  assertEnv("CLOUDFLARE_R2_ACCESS_KEY_ID", accessKeyId);
  assertEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY", secretAccessKey);
  assertEnv("CLOUDFLARE_R2_ENDPOINT", endpoint);

  const groups = new Map<string, InventoryGroup>();
  let continuationToken: string | undefined;
  do {
    const page = await listObjects(continuationToken);
    for (const object of page.objects) {
      const name = groupName(object.key);
      const group = groups.get(name) ?? {
        prefix: name,
        bytes: 0,
        objects: 0,
        newest: "",
      };
      group.bytes += object.size;
      group.objects += 1;
      if (object.lastModified > group.newest) {
        group.newest = object.lastModified;
      }
      groups.set(name, group);
    }
    continuationToken = page.nextContinuationToken;
  } while (continuationToken !== undefined);

  console.log("prefix\tbytes\tgib\tobjects\tnewest");
  for (const group of [...groups.values()].toSorted(
    (a, b) => b.bytes - a.bytes,
  )) {
    console.log(
      [
        group.prefix,
        group.bytes.toString(),
        (group.bytes / 1024 / 1024 / 1024).toFixed(2),
        group.objects.toString(),
        group.newest,
      ].join("\t"),
    );
  }
}

await main();
