package com.shepherdjerred.thestorm.core.expansion;

import java.util.concurrent.CompletionException;

/** A transport outage or retryable provider response, distinct from a broken flag contract. */
public final class FlagProviderUnavailableException extends RuntimeException {
  @java.io.Serial private static final long serialVersionUID = 1L;

  public FlagProviderUnavailableException(Throwable cause) {
    super("Gameplay flag provider is temporarily unavailable", cause);
  }

  public static Throwable unwrap(Throwable failure) {
    while (failure instanceof CompletionException && failure.getCause() != null)
      failure = failure.getCause();
    return failure;
  }
}
