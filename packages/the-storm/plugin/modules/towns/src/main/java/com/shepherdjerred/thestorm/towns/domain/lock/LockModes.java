package com.shepherdjerred.thestorm.towns.domain.lock;

import java.util.Optional;
import java.util.UUID;

/**
 * A player's sticky lock modes. They stay until turned off.
 *
 * @param persist the next lock copies the template lock's type, flags and access
 * @param nolock placing a container does not lock it
 * @param dropTransfer dropping an item puts it in the container being looked at
 * @param quiet successful lock commands stay quiet
 * @param template the lock persist copies; empty until one is chosen
 */
public record LockModes(
    boolean persist, boolean nolock, boolean dropTransfer, boolean quiet, Optional<UUID> template) {

  public static final LockModes NONE = new LockModes(false, false, false, false, Optional.empty());

  /** Which sticky mode a command toggles. */
  public enum Mode {
    PERSIST,
    NOLOCK,
    DROP_TRANSFER,
    QUIET
  }

  /** This mode flipped. Turning persist on keeps {@code captured} when it names a lock. */
  public LockModes toggled(Mode mode, Optional<UUID> captured) {
    return switch (mode) {
      case PERSIST ->
          new LockModes(!persist, nolock, dropTransfer, quiet, captured.or(this::template));
      case NOLOCK -> new LockModes(persist, !nolock, dropTransfer, quiet, template);
      case DROP_TRANSFER -> new LockModes(persist, nolock, !dropTransfer, quiet, template);
      case QUIET -> new LockModes(persist, nolock, dropTransfer, !quiet, template);
    };
  }

  public boolean on(Mode mode) {
    return switch (mode) {
      case PERSIST -> persist;
      case NOLOCK -> nolock;
      case DROP_TRANSFER -> dropTransfer;
      case QUIET -> quiet;
    };
  }
}
