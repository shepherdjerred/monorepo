package com.shepherdjerred.thestorm.rwf.domain.ability;

import com.shepherdjerred.thestorm.rwf.domain.combat.AttackType;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.util.List;
import java.util.Optional;

/**
 * Something a combatant did that an ability may answer, with the world facts the rules need (who
 * stood near, which block was clicked) gathered by the server. The rules decide; the server only
 * reports.
 */
public sealed interface AbilityInput {

  /** Something done to a thing a kit placed, answered by its owner's ability. */
  sealed interface Touch extends AbilityInput {

    /** The block of the thing touched. */
    BlockPos block();
  }

  /**
   * The actor's hit landed.
   *
   * @param victim who was hit
   * @param type how
   * @param weapon the material the actor held in their main hand as the hit landed
   * @param damage what landed
   * @param victimHealth the victim's health afterwards
   * @param victimMaxHealth the victim's max health
   */
  record Hit(
      CombatantId victim,
      AttackType type,
      Optional<String> weapon,
      double damage,
      double victimHealth,
      double victimMaxHealth)
      implements AbilityInput {}

  /**
   * The actor was hurt.
   *
   * @param attacker who hurt them, if anyone
   * @param type how
   * @param damage what landed
   */
  record Hurt(Optional<CombatantId> attacker, AttackType type, double damage)
      implements AbilityInput {}

  /**
   * A Medic waved their wand.
   *
   * @param patients the living allies within reach
   * @param nearbyMedics allied Medics within 8 blocks, the Medic included
   * @param health the Medic's own health
   * @param maxHealth the Medic's own max health
   */
  record Heal(List<Patient> patients, int nearbyMedics, double health, double maxHealth)
      implements AbilityInput {

    public Heal {
      patients = List.copyOf(patients);
    }
  }

  /**
   * An ally the Medic's wand reaches.
   *
   * @param id who
   * @param distance from the Medic
   * @param health their health
   * @param maxHealth their max health
   * @param poisoned whether they are poisoned
   * @param regenerating whether they have a Regeneration a spent wave leaves alone: any but level I
   *     with under a second left, as Red Warfare's Medic checked
   */
  record Patient(
      CombatantId id,
      double distance,
      double health,
      double maxHealth,
      boolean poisoned,
      boolean regenerating) {}

  /**
   * A Warper used their wand on someone.
   *
   * @param targets the clicked combatant and everyone within 3 blocks of them
   */
  record Warp(List<CombatantId> targets) implements AbilityInput {

    public Warp {
      targets = List.copyOf(targets);
    }
  }

  /**
   * A Teleporter places a teleporter on top of {@code block}.
   *
   * @param block the block it becomes
   * @param remote the teammate it was placed under through the remote, if it was
   * @param distance how far the teammate stood from the Teleporter, for a remote one
   * @param site what the server saw of the block, checked in Red Warfare's order among the rules'
   *     own checks
   */
  record PlaceTeleporter(BlockPos block, Optional<CombatantId> remote, double distance, Site site)
      implements AbilityInput {

    /** A teleporter on a block that passes every one of the server's checks. */
    public PlaceTeleporter(BlockPos block, Optional<CombatantId> remote, double distance) {
      this(block, remote, distance, Site.FINE);
    }
  }

  /**
   * What the server saw of a block a teleporter would go on.
   *
   * @param solid whether it is a full solid block
   * @param nearBomb whether it is in the column of any bomb the map placed, destroyed ones too (Red
   *     Warfare never took a bomb off its list), within a block of the bomb's height
   * @param top whether the creator clicked its top face
   * @param inSight whether the creator's line of sight reaches it
   * @param valid whether it is solid with two blocks of open space above it
   */
  record Site(boolean solid, boolean nearBomb, boolean top, boolean inSight, boolean valid) {

    /** A block that passes every check. */
    public static final Site FINE = new Site(true, false, true, true, true);
  }

  /**
   * The actor breaks the teleporter at {@code block}.
   *
   * @param block the teleporter
   */
  record BreakTeleporter(BlockPos block) implements Touch {}

  /**
   * The actor right-clicks the teleporter at {@code block} without breaking it.
   *
   * @param block the teleporter
   */
  record InspectTeleporter(BlockPos block) implements Touch {}

  /**
   * Once a second, how many of {@code material} the actor holds, for the kits that hand out more on
   * Red Warfare's one-second clock (the Explosive's grenades, the Sacrificial's steaks).
   *
   * @param material the material counted
   * @param held how many the actor holds
   */
  record Stock(String material, int held) implements AbilityInput {}

  /**
   * The actor sneaks on the teleporter at {@code block}.
   *
   * @param block the teleporter under them
   * @param destinationClear whether the other teleporter has room to stand on
   */
  record UseTeleporter(BlockPos block, boolean destinationClear) implements Touch {}

  /**
   * A Teleporter breaks every teleporter of theirs through the remote.
   *
   * @param distance how far the teleporters stood from them, summed
   */
  record DestroyTeleporters(double distance) implements AbilityInput {}

  /**
   * A Demolitions places a landmine.
   *
   * @param block where the pressure plate stands
   */
  record PlaceMine(BlockPos block) implements AbilityInput {}

  /**
   * The actor steps on the pressure plate at {@code block}.
   *
   * @param block the plate
   */
  record StepOnMine(BlockPos block) implements Touch {}

  /**
   * The actor breaks the pressure plate at {@code block}.
   *
   * @param block the plate
   */
  record BreakMine(BlockPos block) implements Touch {}

  /** A Rewind right-clicks with the Time Machine. */
  record Rewind() implements AbilityInput {}

  /** An Explosive fires an RPG. */
  record LaunchRpg() implements AbilityInput {}

  /**
   * Something the actor launched has gone off: an RPG hit something, or a grenade's fuse ran out.
   *
   * @param projectile what
   * @param at where
   */
  record Detonate(AbilityEffect.Projectile projectile, Vec3 at) implements AbilityInput {}

  /** An Explosive throws a grenade. */
  record ThrowGrenade() implements AbilityInput {}

  /**
   * A Wraith loosed an arrow.
   *
   * @param arrowSlot the inventory slot the arrow came from
   */
  record ShootBow(int arrowSlot) implements AbilityInput {}

  /**
   * A Sacrificial casts sacrifice on an ally.
   *
   * @param ally who
   */
  record Bond(CombatantId ally) implements AbilityInput {}

  /** A Sacrificial snips every bond. */
  record Sever() implements AbilityInput {}

  /**
   * A Spotter looks through the spyglass.
   *
   * @param seen the enemies in their line of sight within 60 blocks
   */
  record Spot(List<CombatantId> seen) implements AbilityInput {

    public Spot {
      seen = List.copyOf(seen);
    }
  }

  /**
   * A Grappler reels in.
   *
   * @param hook where the hook is
   */
  record Grapple(Vec3 hook) implements AbilityInput {}

  /**
   * A Bannerman plants a banner.
   *
   * @param block where it stands
   */
  record PlantBanner(BlockPos block) implements AbilityInput {}

  /**
   * The actor strikes the banner at {@code block}.
   *
   * @param block the banner
   */
  record StrikeBanner(BlockPos block) implements Touch {}

  /**
   * An Engineer raises a barricade.
   *
   * @param wall the blocks it would fill, all of them air now
   */
  record Barricade(List<BlockPos> wall) implements AbilityInput {

    public Barricade {
      wall = List.copyOf(wall);
    }
  }

  /**
   * A Decoy sends its copy running.
   *
   * @param direction where the copy runs, horizontal
   */
  record Decoy(Vec3 direction) implements AbilityInput {}
}
