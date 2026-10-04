package com.shepherdjerred.mcbridge.domain;

/** The wire error codes of {@code BridgeErrorSchema}, each with its HTTP status. */
public enum ErrorCode {
  UNAUTHORIZED("unauthorized", 401),
  BAD_REQUEST("bad_request", 400),
  NOT_FOUND("not_found", 404),
  TOO_LARGE("too_large", 413),
  UNSUPPORTED("unsupported", 422),
  WORLD_EDIT("world_edit", 422),
  TIMEOUT("timeout", 504),
  INTERNAL("internal", 500);

  private final String wire;
  private final int status;

  ErrorCode(String wire, int status) {
    this.wire = wire;
    this.status = status;
  }

  /** The {@code code} field value. */
  public String wire() {
    return wire;
  }

  /** The HTTP status sent with this code. */
  public int status() {
    return status;
  }
}
