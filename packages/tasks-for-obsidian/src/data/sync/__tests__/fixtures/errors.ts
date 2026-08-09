import type { AppError } from "../../../../domain/errors";
import {
  ApiError,
  ConnectionError,
  NetworkError,
  NotFoundError,
  ValidationError,
} from "../../../../domain/errors";
import type { FixtureError } from "./schema";

/**
 * `AppError` ⇄ fixture JSON.
 *
 * `domain/errors.ts` defines the tag and documents the serialized shape
 * (`{ kind, message, status? }`); this is the pair of functions that realises
 * it. Both are exhaustive switches over `kind`, so a new error variant is a
 * compile error here rather than a fixture that silently loses information.
 */

const NOT_FOUND_MARKER = " not found: ";

export function serializeAppError(error: AppError): FixtureError {
  switch (error.kind) {
    case "network":
      return { kind: "network", message: error.message };
    case "api":
      return { kind: "api", message: error.message, status: error.status };
    case "validation":
      return { kind: "validation", message: error.message };
    case "not_found":
      return {
        kind: "not_found",
        message: error.message,
        status: error.status,
      };
    case "connection":
      return { kind: "connection", message: error.message };
  }
}

export function deserializeAppError(error: FixtureError): AppError {
  switch (error.kind) {
    case "network":
      return new NetworkError(error.message);
    case "api":
      return new ApiError(error.message, error.status);
    case "validation":
      return new ValidationError(error.message);
    case "not_found": {
      // `NotFoundError` takes the two parts, not a message, so the message
      // has to be split back apart. Fail loudly rather than fabricate one.
      const at = error.message.indexOf(NOT_FOUND_MARKER);
      if (at === -1) {
        throw new Error(
          `not_found fixture error message must look like "<resource>${NOT_FOUND_MARKER}<id>", got: ${error.message}`,
        );
      }
      return new NotFoundError(
        error.message.slice(0, at),
        error.message.slice(at + NOT_FOUND_MARKER.length),
      );
    }
    case "connection":
      return new ConnectionError(error.message);
  }
}
