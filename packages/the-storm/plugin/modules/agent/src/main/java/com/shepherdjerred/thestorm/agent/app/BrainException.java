package com.shepherdjerred.thestorm.agent.app;

/**
 * The brain call failed: the service is unreachable, refused the call, or answered something
 * outside the contract. Flows let this fail the decision so the module log records it; a failed
 * call never invents a verdict.
 */
public final class BrainException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  public BrainException(String message) {
    super(message);
  }

  public BrainException(String message, Throwable cause) {
    super(message, cause);
  }
}
