package com.shepherdjerred.thestorm.agent.app;

/**
 * The brain answered, but the flow is switched off in Flipt. This is steady state, not an outage:
 * flows complete silently and the service's own metrics record the disabled call. Never logged as
 * an error: with both flows off, every chat line and ticket would howl.
 */
public final class BrainDisabledException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  public BrainDisabledException(String flow) {
    super("storm-brain flow disabled: " + flow);
  }

  /** Whether {@code failure} or anything it wraps is a disabled flow. */
  public static boolean isCauseOf(Throwable failure) {
    for (var current = failure; current != null; current = current.getCause()) {
      if (current instanceof BrainDisabledException) {
        return true;
      }
    }
    return false;
  }
}
