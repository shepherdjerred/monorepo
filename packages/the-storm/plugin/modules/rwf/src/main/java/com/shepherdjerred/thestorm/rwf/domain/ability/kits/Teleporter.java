// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// TeleporterAbility.java, Teleporter.java and TeleporterInventory.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.domain.ability.kits;

import com.shepherdjerred.thestorm.rwf.domain.ability.Ability;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityEffect;
import com.shepherdjerred.thestorm.rwf.domain.ability.AbilityInput;
import com.shepherdjerred.thestorm.rwf.domain.ability.Arena;
import com.shepherdjerred.thestorm.rwf.domain.ability.Death;
import com.shepherdjerred.thestorm.rwf.domain.ability.Fighter;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.ability.KitText;
import com.shepherdjerred.thestorm.rwf.domain.ability.Placed;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * The Teleporter places up to two teleporters on top of solid blocks, never on or right beside a
 * bomb's column. A teammate sneaking on one is sent to the other, every 2 seconds at most. The
 * remote places one under a teammate instead; it is unstable, and both unusable, for 8 seconds, and
 * the remote recharges for half a second per block the teammate stood away, at most 90 seconds. The
 * remote can also break all of the Teleporter's own. The owner or an enemy breaks a teleporter by
 * mining it, and an enemy Teleporter also by right-clicking it with its creator; they all go when
 * the owner dies. Anyone right-clicking one is told whose it is.
 *
 * <p>Whether the remote may open is the server's to check, when it opens, as Red Warfare did; once
 * open, its buttons work whatever the recharge.
 */
public final class Teleporter implements Ability {

  public static final String ID = "teleporter";

  /** The block a teleporter turns into, Red Warfare's chiselled monster egg. */
  public static final String BLOCK = "INFESTED_CHISELED_STONE_BRICKS";

  public static final int MOST = 2;
  public static final Duration USE = Duration.ofSeconds(2);
  public static final Duration UNSTABLE = Duration.ofSeconds(8);
  public static final Duration MOST_REMOTE = Duration.ofSeconds(90);
  public static final Duration REMOTE_PER_BLOCK = Duration.ofMillis(500);

  /** The cooldown key of the remote. */
  public static final String REMOTE = "remote-teleporter";

  /** The cooldown key of travelling through a teleporter, kept by the traveller. */
  public static final String TRAVEL = "teleporter";

  /** How high above the destination block a traveller lands. */
  public static final double LANDING = 1.2;

  @Override
  public String id() {
    return ID;
  }

  @Override
  public void act(Fighter self, AbilityInput input, Arena arena) {
    switch (input) {
      case AbilityInput.PlaceTeleporter place -> {
        if (place.remote().isPresent()) {
          remote(self, place, arena);
        } else {
          create(self, place, arena);
        }
      }
      case AbilityInput.DestroyTeleporters destroy -> destroy(self, destroy, arena);
      default -> {}
    }
  }

  /** The Teleport Creator on a block, with Red Warfare's checks in its order. */
  private static void create(Fighter self, AbilityInput.PlaceTeleporter place, Arena arena) {
    var site = place.site();
    if (!site.solid()) {
      refuse(self, "This block cannot be transformed into a teleporter!", arena);
    } else if (site.nearBomb()) {
      refuse(self, "Teleporter cannot be placed this close to a bomb!", arena);
    } else if (!site.top()) {
      refuse(
          self, "Must place the teleporter on the top of a block! Not the sides or bottom!", arena);
    } else if (owned(self.id(), arena).size() >= MOST) {
      refuse(self, "You already have two teleporters placed!", arena);
    } else if (!site.inSight()) {
      refuse(self, "Line of sight is obstructed!", arena);
    } else if (!site.valid()) {
      refuse(self, "Teleporter is in an invalid space!", arena);
    } else {
      add(self, place.block(), Optional.empty(), arena);
    }
  }

  /** A teleporter under a teammate, through the remote, with Red Warfare's checks in its order. */
  private static void remote(Fighter self, AbilityInput.PlaceTeleporter place, Arena arena) {
    if (place.site().nearBomb()) {
      refuse(self, "Teleporter cannot be placed this close to a bomb!", arena);
    } else if (owned(self.id(), arena).size() >= MOST) {
      refuse(self, "You already have two teleporters placed!", arena);
    } else if (teleporterAt(place.block(), arena).isPresent()) {
      refuse(self, "There is already a teleporter here!", arena);
    } else if (!place.site().valid()) {
      refuse(self, "Teleporter is in an invalid space!", arena);
    } else {
      add(self, place.block(), Optional.of(arena.now().plus(UNSTABLE)), arena);
      arena.use(self.id(), REMOTE, recharge(place.distance()), true);
      arena.say(self.id(), "Your remote teleporter has been established!", AbilityEffect.Tone.INFO);
      arena.say(
          place.remote().orElseThrow(),
          self.name() + " established a teleporter at your location!",
          AbilityEffect.Tone.INFO);
    }
  }

  private static void refuse(Fighter self, String why, Arena arena) {
    arena.say(self.id(), why, AbilityEffect.Tone.REFUSED);
  }

  private static void add(
      Fighter self, BlockPos block, Optional<Instant> unstableUntil, Arena arena) {
    arena.place(new Placed.Teleporter(self.id(), self.team(), block, unstableUntil));
    arena.effect(new AbilityEffect.PlaceBlock(block, BLOCK));
    arena.effect(new AbilityEffect.CueAt(block, KitCue.BLOCK_CHANGED));
  }

  /** The remote's recharge after reaching {@code distance} blocks: half a second each, ≤ 90 s. */
  public static Duration recharge(double distance) {
    return Duration.ofMillis(
        Math.min(MOST_REMOTE.toMillis(), (long) (distance * REMOTE_PER_BLOCK.toMillis())));
  }

  /**
   * Red Warfare refused a teleporter in a bomb's column, within a block of its height; the server
   * asks this for {@link AbilityInput.Site#nearBomb}.
   *
   * @param block where the teleporter would go
   * @param bombs the blocks of every bomb the map placed
   */
  public static boolean nearBomb(BlockPos block, List<BlockPos> bombs) {
    return bombs.stream()
        .anyMatch(
            bomb ->
                bomb.x() == block.x()
                    && bomb.z() == block.z()
                    && Math.abs(bomb.y() - block.y()) <= 1);
  }

  private static void destroy(Fighter self, AbilityInput.DestroyTeleporters destroy, Arena arena) {
    var mine = owned(self.id(), arena);
    if (mine.isEmpty()) {
      refuse(self, "You have no existing teleporters!", arena);
      return;
    }
    mine.forEach(teleporter -> remove(teleporter, arena));
    arena.use(self.id(), REMOTE, recharge(destroy.distance()), true);
    arena.say(
        self.id(),
        "You have broken your teleporter" + (mine.size() == 1 ? "" : "s") + "!",
        AbilityEffect.Tone.INFO);
  }

  @Override
  public void touched(Fighter owner, Fighter actor, AbilityInput.Touch touch, Arena arena) {
    var teleporter =
        owned(owner.id(), arena).stream().filter(t -> t.block().equals(touch.block())).findFirst();
    if (teleporter.isEmpty()) {
      return;
    }
    switch (touch) {
      case AbilityInput.BreakTeleporter _ ->
          breakOne(owner, actor, teleporter.orElseThrow(), arena);
      case AbilityInput.InspectTeleporter _ -> whose(owner, actor, arena);
      case AbilityInput.UseTeleporter use -> travel(actor, teleporter.orElseThrow(), use, arena);
      default -> {}
    }
  }

  /** Tells {@code actor} that the teleporter is {@code owner}'s. */
  private static void whose(Fighter owner, Fighter actor, Arena arena) {
    if (actor.id().equals(owner.id())) {
      arena.say(actor.id(), KitText.GOLD + "This is your teleporter!", AbilityEffect.Tone.INFO);
    } else {
      notice(actor.id(), KitText.GOLD + "This is " + named(owner) + " teleporter!", arena);
    }
  }

  private static void notice(CombatantId to, String text, Arena arena) {
    arena.say(to, text, AbilityEffect.Tone.INFO);
  }

  /** {@code who}'s name and "'s" in their team's colour, then gold, as Red Warfare wrote it. */
  private static String named(Fighter who) {
    return KitText.team(who.team()) + who.name() + "'s" + KitText.GOLD;
  }

  private static void breakOne(
      Fighter owner, Fighter actor, Placed.Teleporter teleporter, Arena arena) {
    if (!actor.id().equals(owner.id()) && actor.allyOf(owner)) {
      notice(actor.id(), KitText.GOLD + "This is " + named(owner) + " teleporter!", arena);
      return;
    }
    remove(teleporter, arena);
    if (actor.id().equals(owner.id())) {
      arena.say(
          actor.id(), KitText.GOLD + "You have broken your teleporter!", AbilityEffect.Tone.INFO);
    } else {
      notice(actor.id(), KitText.GOLD + "You have broken " + named(owner) + " teleporter!", arena);
      notice(
          owner.id(),
          KitText.team(actor.team()) + actor.name() + KitText.GOLD + " has broken your teleporter!",
          arena);
    }
  }

  private static void travel(
      Fighter actor, Placed.Teleporter from, AbilityInput.UseTeleporter use, Arena arena) {
    if (actor.team() != from.team() || !arena.ready(actor.id(), TRAVEL)) {
      return;
    }
    var pair = owned(from.owner(), arena);
    if (pair.size() != MOST || pair.stream().anyMatch(t -> t.unstable(arena.now()))) {
      return;
    }
    arena.use(actor.id(), TRAVEL, USE, false);
    var to = pair.stream().filter(t -> !t.equals(from)).findFirst().orElseThrow();
    if (!use.destinationClear()) {
      refuse(actor, "The other teleporter is blocked off!", arena);
      return;
    }
    var block = to.block();
    arena.effect(
        new AbilityEffect.Teleport(
            actor.id(),
            new Vec3(block.x() + 0.5, block.y() + LANDING, block.z() + 0.5),
            Optional.empty()));
    arena.effect(new AbilityEffect.Cue(actor.id(), KitCue.TELEPORTED));
  }

  @Override
  public void died(Fighter self, Death death, Arena arena) {
    if (death.victim().equals(self.id())) {
      owned(self.id(), arena).forEach(teleporter -> remove(teleporter, arena));
    }
  }

  private static void remove(Placed.Teleporter teleporter, Arena arena) {
    arena.unplace(teleporter);
    arena.effect(new AbilityEffect.CueAt(teleporter.block(), KitCue.BLOCK_CHANGED));
    arena.effect(new AbilityEffect.ClearBlock(teleporter.block()));
  }

  private static Optional<Placed.Teleporter> teleporterAt(BlockPos block, Arena arena) {
    return arena.placed().stream()
        .filter(p -> p instanceof Placed.Teleporter t && t.block().equals(block))
        .map(Placed.Teleporter.class::cast)
        .findFirst();
  }

  /** {@code owner}'s teleporters, oldest first. */
  public static List<Placed.Teleporter> owned(CombatantId owner, Arena arena) {
    return arena.placed().stream()
        .filter(p -> p instanceof Placed.Teleporter t && t.owner().equals(owner))
        .map(Placed.Teleporter.class::cast)
        .toList();
  }
}
