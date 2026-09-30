package com.shepherdjerred.thestorm.essentials.domain.kit;

import java.time.Duration;

/** Why a kit could not be claimed. */
public sealed interface KitError {

  /** The kit's cooldown is still running. */
  record OnCooldown(Duration remaining) implements KitError {}

  /** A once-only kit was already claimed. */
  record AlreadyClaimed() implements KitError {}
}
