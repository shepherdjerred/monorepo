import { describe, expect, test } from "vitest";
import {
  describeFailure,
  isTransientDatabaseFailure,
  isUniqueViolation,
  prismaMeta,
  TRANSIENT_DATABASE_CODES,
} from "./request-failure.ts";

/** What `PrismaClientKnownRequestError` carries, without importing the engine. */
function prismaError(code: string, meta?: unknown) {
  return Object.assign(
    new Error("Invalid `prisma.build.create()` invocation"),
    {
      name: "PrismaClientKnownRequestError",
      code,
      ...(meta === undefined ? {} : { meta }),
    },
  );
}

describe("describeFailure", () => {
  test("names the type of an error that is not a Prisma error and nothing else", () => {
    expect(describeFailure(new TypeError("secret detail"))).toEqual({
      errorType: "TypeError",
    });
  });

  test("keeps the code of a system error, which names its cause without data", () => {
    expect(
      describeFailure(
        Object.assign(new Error("connect failed to 10.0.0.1"), {
          code: "ECONNRESET",
        }),
      ),
    ).toEqual({ errorType: "Error", errorCode: "ECONNRESET" });
  });

  test("names a Prisma error's code and the schema objects it names", () => {
    expect(
      describeFailure(
        prismaError("P2003", { modelName: "Build", field_name: "Build_fkey" }),
      ),
    ).toEqual({
      errorType: "PrismaClientKnownRequestError",
      code: "P2003",
      meta: { modelName: "Build", field_name: "Build_fkey" },
    });
  });

  test("reads the driver adapter's cause, which is where PrismaPg puts a constraint failure", () => {
    // The shape a real foreign-key failure carries through PrismaPg.
    expect(
      describeFailure(
        prismaError("P2003", {
          modelName: "BuildArtifactSelection",
          driverAdapterError: {
            name: "DriverAdapterError",
            cause: {
              originalCode: "23503",
              originalMessage:
                'insert or update on table "BuildArtifactSelection" violates foreign key constraint "BuildArtifactSelection_buildId_fkey"',
              kind: "ForeignKeyConstraintViolation",
              constraint: { index: "BuildArtifactSelection_buildId_fkey" },
            },
          },
        }),
      ),
    ).toEqual({
      errorType: "PrismaClientKnownRequestError",
      code: "P2003",
      meta: {
        modelName: "BuildArtifactSelection",
        kind: "ForeignKeyConstraintViolation",
        originalCode: "23503",
        constraint: "BuildArtifactSelection_buildId_fkey",
      },
    });
  });

  test("reports how long an expired transaction ran against its limit", () => {
    // The shape a real P2028 carries through PrismaPg.
    expect(
      describeFailure(
        prismaError("P2028", {
          modelName: "Service",
          operation: "query",
          timeout: 5000,
          timeTaken: 5304,
        }),
      ),
    ).toMatchObject({
      code: "P2028",
      meta: {
        modelName: "Service",
        operation: "query",
        timeout: 5000,
        timeTaken: 5304,
      },
    });
  });

  test("never logs a column value, a driver message or the error message", () => {
    const logged = JSON.stringify(
      describeFailure(
        prismaError("P2002", {
          modelName: "Request",
          target: ["id"],
          value: "ci/1/2/serviceaccount-token",
          cause: "Key (id)=(ci/1/2/serviceaccount-token) already exists.",
          driverAdapterError: {
            cause: {
              kind: "postgres",
              originalMessage: "password authentication failed",
              originalCode: "28P01",
            },
          },
        }),
      ),
    );
    expect(logged).not.toContain("serviceaccount-token");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("invocation");
    expect(logged).toContain("28P01");
  });

  test("bounds a name a driver reports", () => {
    const meta = prismaMeta({ target: "x".repeat(500) });
    expect(meta["target"]).toHaveLength(120);
  });
});

describe("database failure classes", () => {
  test.each([...TRANSIENT_DATABASE_CODES])(
    "%s is retryable, not a crash",
    (code) => {
      expect(isTransientDatabaseFailure(prismaError(code))).toBe(true);
    },
  );

  test.each(["P2002", "P2003", "P2025", "P2010"])(
    "%s is not retryable",
    (code) => {
      expect(isTransientDatabaseFailure(prismaError(code))).toBe(false);
    },
  );

  test("only a Prisma code classifies an error", () => {
    expect(isTransientDatabaseFailure(new Error("P2028"))).toBe(false);
    expect(
      isTransientDatabaseFailure(
        Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
      ),
    ).toBe(false);
    expect(isUniqueViolation(prismaError("P2002"))).toBe(true);
    expect(isUniqueViolation(prismaError("P2028"))).toBe(false);
  });
});
