package com.shepherdjerred.thestorm.essentials.app;

import com.shepherdjerred.thestorm.essentials.domain.teleport.OnCooldown;

/** Why a teleport was not paid for. */
public sealed interface TeleportRefusal {

  /** The kind's cooldown is still running. */
  record Cooldown(OnCooldown cooldown) implements TeleportRefusal {}

  /** The payer's wallet cannot cover the cost. */
  record CannotAfford(long balance, long required) implements TeleportRefusal {}
}
