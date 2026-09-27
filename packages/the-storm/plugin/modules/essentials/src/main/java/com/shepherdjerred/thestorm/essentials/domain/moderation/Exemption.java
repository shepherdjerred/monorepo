package com.shepherdjerred.thestorm.essentials.domain.moderation;

import java.util.Optional;

/**
 * Whether a kick or ban may go ahead against a target that may be exempt (staff). An online target
 * is refused if exempt. An offline target's permissions cannot be read, so only the console may act
 * against one.
 */
public final class Exemption {

  private Exemption() {}

  /** Who is acting on whom. */
  public enum Sender {
    /** The server console, which is trusted with offline targets. */
    CONSOLE,
    /** A staff member in game. */
    PLAYER
  }

  /** What is known about the target. */
  public sealed interface Target {

    /** The target is online, so their exemption is known. */
    record Online(boolean exempt) implements Target {}

    /** The target is offline; their exemption cannot be checked. */
    record Offline() implements Target {}
  }

  /** Why the action is refused, or empty to allow it. */
  public static Optional<String> refusal(Sender sender, Target target) {
    return switch (target) {
      case Target.Online(var exempt) ->
          exempt ? Optional.of("That player is exempt.") : Optional.empty();
      case Target.Offline() ->
          switch (sender) {
            case CONSOLE -> Optional.empty();
            case PLAYER ->
                Optional.of(
                    "That player is offline, so their exemption can't be checked. Use the console.");
          };
    };
  }
}
