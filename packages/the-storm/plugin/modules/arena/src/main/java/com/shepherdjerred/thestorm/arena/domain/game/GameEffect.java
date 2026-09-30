package com.shepherdjerred.thestorm.arena.domain.game;

import com.shepherdjerred.thestorm.arena.domain.wave.BossOrder;
import com.shepherdjerred.thestorm.arena.domain.wave.SpawnUnit;
import java.util.List;
import java.util.UUID;

/** What the server must do after a game changes. The Paper adapter carries these out in order. */
public sealed interface GameEffect {

  /**
   * Take a snapshot of the player and empty them in the same tick, keeping the snapshot in memory,
   * then store it; answer with {@link GameEvent.SnapshotStored}, or restore them from memory and
   * answer {@link GameEvent.SnapshotFailed}. Until then the player is frozen: nothing they do can
   * add to or take from what the snapshot will give back.
   *
   * @param player the player
   */
  record CaptureSnapshot(UUID player) implements GameEffect {}

  /**
   * Delete a stored snapshot without restoring it: the player left while it was being written and
   * was already restored from memory.
   *
   * @param player the player
   */
  record ForgetSnapshot(UUID player) implements GameEffect {}

  /**
   * Clear the player and send them to the lobby.
   *
   * @param player the player
   */
  record EnterLobby(UUID player) implements GameEffect {}

  /**
   * Clear the player, make them a spectator and send them to the spectator point.
   *
   * @param player the player
   */
  record EnterSpectator(UUID player) implements GameEffect {}

  /**
   * Replace the player's inventory and effects with the class's kit.
   *
   * @param player the player
   * @param kit the class id
   */
  record Equip(UUID player, String kit) implements GameEffect {}

  /**
   * Give the player the class's upgrade items.
   *
   * @param player the player
   * @param kit the class id
   */
  record Upgrade(UUID player, String kit) implements GameEffect {}

  /**
   * Send a fighter to a player spawn, with the class's wolves.
   *
   * @param player the player
   * @param spawn the index of the player spawn
   * @param kit the class id
   */
  record SendToArena(UUID player, int spawn, String kit) implements GameEffect {}

  /**
   * Restore the player's snapshot now.
   *
   * @param player the player
   */
  record Restore(UUID player) implements GameEffect {}

  /**
   * The player died: clear their drops and restore their snapshot once they respawn.
   *
   * @param player the player
   */
  record RestoreAfterRespawn(UUID player) implements GameEffect {}

  /**
   * Tell these players something.
   *
   * @param to the players
   * @param notice what to tell them
   */
  record Announce(List<UUID> to, Notice notice) implements GameEffect {

    public Announce {
      to = List.copyOf(to);
    }
  }

  /** Keep the arena's chunks loaded and fill the loot chests. */
  record PrepareArena() implements GameEffect {}

  /**
   * Spawn a boss.
   *
   * @param boss the boss
   */
  record SpawnBoss(BossOrder boss) implements GameEffect {}

  /**
   * Spawn mobs at the mob spawns.
   *
   * @param units the mobs
   */
  record Spawn(List<SpawnUnit> units) implements GameEffect {

    public Spawn {
      units = List.copyOf(units);
    }
  }

  /**
   * Pay a fighter crystals for clearing a wave.
   *
   * @param player the player
   * @param crystals how many
   * @param wave the wave cleared
   */
  record PayReward(UUID player, long crystals, int wave) implements GameEffect {}

  /**
   * Open the milestone vault for a fighter, if they have not opened it today.
   *
   * @param player the player
   * @param wave the milestone wave
   */
  record ClaimVault(UUID player, int wave) implements GameEffect {}

  /**
   * Record how far a player got, keeping their best.
   *
   * @param player the player
   * @param name their name
   * @param wave the wave they reached
   */
  record RecordBestWave(UUID player, String name, int wave) implements GameEffect {}

  /** Remove the arena's mobs, bosses and pets, empty the loot chests and let the chunks unload. */
  record ResetArena() implements GameEffect {}
}
