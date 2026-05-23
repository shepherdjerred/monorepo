import { afterEach, describe, expect, test } from "bun:test";
import { lanePriorS3Region } from "./lane-prior-s3.ts";

const ORIGINAL_AWS_REGION = Bun.env["AWS_REGION"];
const ORIGINAL_S3_REGION = Bun.env["S3_REGION"];

afterEach(() => {
  Bun.env["AWS_REGION"] = ORIGINAL_AWS_REGION;
  Bun.env["S3_REGION"] = ORIGINAL_S3_REGION;
});

describe("lanePriorS3Region", () => {
  test("prefers AWS_REGION", () => {
    Bun.env["AWS_REGION"] = "us-west-2";
    Bun.env["S3_REGION"] = "us-east-1";

    expect(lanePriorS3Region()).toBe("us-west-2");
  });

  test("falls back to S3_REGION", () => {
    Bun.env["AWS_REGION"] = undefined;
    Bun.env["S3_REGION"] = "us-east-1";

    expect(lanePriorS3Region()).toBe("us-east-1");
  });

  test("treats empty AWS_REGION as unset and falls back to S3_REGION", () => {
    Bun.env["AWS_REGION"] = "";
    Bun.env["S3_REGION"] = "us-west-2";

    expect(lanePriorS3Region()).toBe("us-west-2");
  });

  test("treats whitespace-only AWS_REGION as unset", () => {
    Bun.env["AWS_REGION"] = "   ";
    Bun.env["S3_REGION"] = "eu-west-1";

    expect(lanePriorS3Region()).toBe("eu-west-1");
  });

  test("defaults to us-east-1", () => {
    Bun.env["AWS_REGION"] = undefined;
    Bun.env["S3_REGION"] = undefined;

    expect(lanePriorS3Region()).toBe("us-east-1");
  });

  test("defaults when both region env vars are empty strings", () => {
    Bun.env["AWS_REGION"] = "";
    Bun.env["S3_REGION"] = "";

    expect(lanePriorS3Region()).toBe("us-east-1");
  });
});
