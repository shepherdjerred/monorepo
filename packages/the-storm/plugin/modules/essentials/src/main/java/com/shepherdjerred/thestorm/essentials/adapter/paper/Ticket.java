package com.shepherdjerred.thestorm.essentials.adapter.paper;

import com.shepherdjerred.thestorm.essentials.domain.teleport.TeleportKind;
import org.bukkit.entity.Player;

/**
 * One paid teleport.
 *
 * @param mover the player who is teleported
 * @param payer the player charged (the requester of a {@code /tpahere} pays for the target)
 * @param kind the kind, for pricing
 * @param destination where it leads
 */
record Ticket(Player mover, Player payer, TeleportKind kind, Destination destination) {

  /** A player teleporting and paying for themself. */
  static Ticket self(Player player, TeleportKind kind, Destination destination) {
    return new Ticket(player, player, kind, destination);
  }

  /** Whether the payer is someone other than the mover. */
  boolean paidByOther() {
    return !mover.getUniqueId().equals(payer.getUniqueId());
  }
}
