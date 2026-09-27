package com.shepherdjerred.thestorm.core.protection;

import java.util.UUID;
import org.bukkit.block.Block;

/** Allows the owner to recover an unexpired grave through land container protection. */
@FunctionalInterface
public interface GraveRecovery {

  /** Whether this particular block is an unexpired grave owned by the player. */
  boolean mayOpen(UUID player, Block block);
}
