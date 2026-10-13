package com.shepherdjerred.thestorm.rwf.domain.match;

import com.shepherdjerred.thestorm.rwf.domain.bomb.FuseBonus;
import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combat.Attribution;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import java.util.List;

/** What the server must do after a match changes. The Paper adapter carries these out in order. */
public sealed interface MatchEffect {

  /** Snapshot the player's inventory and state so they can be restored after the match. */
  record CaptureSnapshot(CombatantId id) implements MatchEffect {}

  /** Restore the player's snapshot now; they are out of the match. */
  record Restore(CombatantId id) implements MatchEffect {}

  /** Clear the player and send them to the lobby. */
  record EnterLobby(CombatantId id) implements MatchEffect {}

  /**
   * The match ended and the member is carried into the next one: back to the lobby with the kit
   * they had. Their belongings stay held.
   */
  record ReturnToLobby(CombatantId id, String kitId) implements MatchEffect {}

  /** Open a fresh map vote: the adapter offers candidates with {@code BallotOpened}. */
  record NeedBallot() implements MatchEffect {}

  /** Load, verify and hold the chosen map, then report {@code MapReady} or {@code MapFailed}. */
  record PrepareMap(String mapId) implements MatchEffect {}

  /** Fly these members over the map from {@code at} in adventure mode, unhurt. */
  record PreviewMap(List<CombatantId> ids, Spawn at) implements MatchEffect {

    public PreviewMap {
      ids = List.copyOf(ids);
    }
  }

  /** These members stand still at their spawns until {@link Unfreeze}. */
  record Freeze(List<CombatantId> ids) implements MatchEffect {

    public Freeze {
      ids = List.copyOf(ids);
    }
  }

  /** These members may move again. */
  record Unfreeze(List<CombatantId> ids) implements MatchEffect {

    public Unfreeze {
      ids = List.copyOf(ids);
    }
  }

  /** Make the player a spectator at {@code at}. */
  record Spectate(CombatantId id, Spawn at) implements MatchEffect {}

  /** Move the player. */
  record Teleport(CombatantId id, Spawn to) implements MatchEffect {}

  /** Replace the player's inventory with the kit (the fuse in slot 0) and its armor. */
  record Equip(CombatantId id, String kitId) implements MatchEffect {}

  /** Put {@code bonus} on the player's Bomb Fuse. */
  record GiveFuse(CombatantId id, FuseBonus bonus) implements MatchEffect {}

  /** Tell everyone in the match. */
  record Announce(Notice notice) implements MatchEffect {}

  /** Tell these players. */
  record Tell(List<CombatantId> to, Notice notice) implements MatchEffect {

    public Tell {
      to = List.copyOf(to);
    }
  }

  /** Play a sound to these players (at their own position). */
  record Sound(List<CombatantId> to, SoundCue cue) implements MatchEffect {

    public Sound {
      to = List.copyOf(to);
    }
  }

  /** Play a sound to everyone at a block. */
  record SoundAt(BlockPos at, SoundCue cue) implements MatchEffect {}

  /** Set the map world's time of day. */
  record SetTime(long ticks) implements MatchEffect {}

  /** The TNT block became primed TNT with a long fuse; it follows the bomb's hologram. */
  record BombArmed(String bombId) implements MatchEffect {}

  /** The primed TNT is removed and the TNT block put back. */
  record BombRestored(String bombId) implements MatchEffect {}

  /** The bomb is gone: remove its block or entity and hologram. */
  record BombRemoved(String bombId) implements MatchEffect {}

  /** Explosion sound and particles at the bomb. */
  record Explode(String bombId, BlockPos at) implements MatchEffect {}

  /**
   * Turn solid blocks within {@code radius} of {@code center} to coal and slabs to stone slabs,
   * sparing monster-egg blocks; remember them for {@link RevertCraters}.
   */
  record Crater(BlockPos center, int radius) implements MatchEffect {}

  /** Kill these players with {@code cause}, without death messages. */
  record Kill(List<CombatantId> victims, AttackType cause) implements MatchEffect {

    public Kill {
      victims = List.copyOf(victims);
    }
  }

  /** Deal {@code amount} of {@link AttackType#END_OF_GAME} damage, ignoring armor. */
  record PoisonDamage(CombatantId id, double amount) implements MatchEffect {}

  /** Take every golden apple and cooked beef from these players. */
  record StripFood(List<CombatantId> from) implements MatchEffect {

    public StripFood {
      from = List.copyOf(from);
    }
  }

  /** Put every cratered block back. */
  record RevertCraters() implements MatchEffect {}

  /**
   * Pay a player Red Warfare credits, or take them when {@code credits} is negative (the AFK
   * penalty).
   */
  record Pay(CombatantId id, long credits, String reason) implements MatchEffect {}

  /**
   * A combatant died: who gets the kill and the assists. Messages go out as notices; this is for
   * the tab list, statistics and recordings.
   */
  record Death(CombatantId victim, Attribution attribution) implements MatchEffect {}

  /** Count one of {@code stat} for the player, such as "Armed" or "Defused". */
  record RecordStat(CombatantId id, String stat) implements MatchEffect {}
}
