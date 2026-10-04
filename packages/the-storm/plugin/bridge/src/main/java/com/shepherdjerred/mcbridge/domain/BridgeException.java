package com.shepherdjerred.mcbridge.domain;

import java.io.Serial;

/** An expected request failure, rendered as {@code {"error", "code"}} with the code's status. */
public final class BridgeException extends RuntimeException {
  @Serial private static final long serialVersionUID = 1L;

  private final ErrorCode code;
  private final String detail;

  public BridgeException(ErrorCode code, String message) {
    super(message);
    this.code = code;
    this.detail = message;
  }

  public BridgeException(ErrorCode code, String message, Throwable cause) {
    super(message, cause);
    this.code = code;
    this.detail = message;
  }

  /** The client-facing message (never null, unlike {@link #getMessage()}). */
  public String detail() {
    return detail;
  }

  public ErrorCode code() {
    return code;
  }

  /** Shorthand for a 400. */
  public static BridgeException badRequest(String message) {
    return new BridgeException(ErrorCode.BAD_REQUEST, message);
  }
}
