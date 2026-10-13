// Ported from libraryaddict's Red Warfare
// (redwarfare-arcade/src/me/libraryaddict/arcade/game/searchanddestroy/abilities/
// DemolitionsAbility.java, DwarfAbility.java, GhostAbility.java, WraithAbility.java,
// SkinnerAbility.java, SacrificialAbility.java and TeleporterAbility.java); see
// packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.ability.KitCue;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ThreadLocalRandom;
import org.bukkit.Effect;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

/**
 * The sounds and particles of the Demolitions, Dwarf, Ghost, Wraith, Skinner, Sacrificial and
 * Teleporter, exactly as Red Warfare made them: each particle at its count, spread, speed and view
 * distance, each sound at its volume and pitch, and the sounds it played with {@code
 * player.playSound} heard by that player alone. Main thread only.
 */
final class KitCues {

  /**
   * A sound one player hears.
   *
   * @param sound which
   * @param volume how loud
   * @param pitch at what pitch
   */
  private record Tune(Sound sound, float volume, float pitch) {}

  private static final Map<KitCue, Tune> PRIVATE =
      new EnumMap<>(
          Map.of(
              KitCue.RESTOCKED, new Tune(Sound.ENTITY_ITEM_PICKUP, 5, 1),
              KitCue.LEVEL_UP, new Tune(Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 1, 0),
              KitCue.LEVEL_DOWN, new Tune(Sound.ENTITY_PLAYER_BURP, 1, 0),
              KitCue.SNIPPED, new Tune(Sound.ENTITY_SHEEP_SHEAR, 1, 0),
              KitCue.BOND_BROKEN, new Tune(Sound.ENTITY_GHAST_SCREAM, 1, 0),
              KitCue.TELEPORTED, new Tune(Sound.ENTITY_ENDERMAN_TELEPORT, 3, 0)));

  /** The cues played somewhere rather than for one player. */
  private static final List<KitCue> PLACED =
      List.of(KitCue.MINE_ARMED, KitCue.MINE_TRIGGERED, KitCue.SKINNING, KitCue.BLOCK_CHANGED);

  private final MatchRunner runner;
  private final PaperContext context;

  KitCues(MatchRunner runner, PaperContext context) {
    this.runner = runner;
    this.context = context;
  }

  /** Whether these kits' rules play {@code cue}, rather than another kit's. */
  static boolean handles(KitCue cue) {
    return PRIVATE.containsKey(cue) || PLACED.contains(cue) || cue == KitCue.GHOST_HIT;
  }

  /** {@code cue} for {@code player}: private sounds to them, the rest where they stand. */
  void play(Player player, KitCue cue) {
    switch (cue) {
      case GHOST_HIT -> ghostHit(player);
      case TELEPORTED -> {
        player.getWorld().playEffect(Places.at(player), Effect.ENDER_SIGNAL, 9);
        hear(player, Places.at(player), cue);
      }
      default -> {
        if (PRIVATE.containsKey(cue)) {
          hear(player, Places.at(player), cue);
        } else {
          play(Places.at(player), cue);
        }
      }
    }
  }

  /** {@code to} alone hears {@code cue}, played at {@code at}. */
  void hear(Player to, Location at, KitCue cue) {
    var tune = PRIVATE.get(cue);
    if (tune != null) {
      to.playSound(at, tune.sound(), tune.volume(), tune.pitch());
    }
  }

  /** {@code cue} at {@code at}, the centre of a block or a player's feet. */
  void play(Location at, KitCue cue) {
    var world = at.getWorld();
    var everyone = context.server().getOnlinePlayers();
    switch (cue) {
      case MINE_ARMED -> {
        Classic.particle(
            Classic.Puff.of(Particle.CRIT, 3), at.clone().add(0, 0.4, 0), Classic.NORMAL, everyone);
        world.playSound(at, Sound.BLOCK_WOODEN_PRESSURE_PLATE_CLICK_ON, 1, 0.1F);
      }
      case MINE_TRIGGERED -> {
        Classic.particle(
            Classic.Puff.of(Particle.LARGE_SMOKE, 3).spread(0.3, 0, 0.3),
            at.clone().add(0, -0.5, 0),
            Classic.NORMAL,
            everyone);
        world.playSound(at, Sound.ENTITY_CREEPER_HURT, 1, 0);
        world.playSound(at, Sound.BLOCK_FIRE_EXTINGUISH, 1, 0);
      }
      case SKINNING -> {
        var wire = Material.REDSTONE_WIRE.createBlockData();
        world.playEffect(at, Effect.DESTROY_BLOCK, wire, 16);
        world.playEffect(at.clone().add(0, 1, 0), Effect.DESTROY_BLOCK, wire, 16);
      }
      case BLOCK_CHANGED -> {
        var block = at.getBlock();
        if (!block.getType().isAir()) {
          world.playEffect(block.getLocation(), Effect.DESTROY_BLOCK, block.getBlockData());
        }
      }
      default -> throw new IllegalStateException("not a placed kit cue: " + cue);
    }
  }

  /**
   * Forty specks of the hurt ghost's team colour, each somewhere in its body, for everyone but the
   * ghost within Red Warfare's normal view distance.
   */
  private void ghostHit(Player ghost) {
    var viewers = others(ghost);
    for (var i = 0; i < 40; i++) {
      colour(ghost, 1.9, Classic.NORMAL, viewers);
    }
  }

  /**
   * A Wraith drawing its bow gives itself away: five specks of its team colour for everyone else
   * within Red Warfare's long view distance, and five lower ones for itself.
   */
  void drawing(Player wraith) {
    for (var i = 0; i < 5; i++) {
      colour(wraith, 1.9, Classic.LONG, others(wraith));
      colour(wraith, 1.4, Classic.LONG, List.of(wraith));
    }
  }

  private List<Player> others(Player player) {
    return context.server().getOnlinePlayers().stream()
        .filter(viewer -> !viewer.equals(player))
        .map(Player.class::cast)
        .toList();
  }

  /** One speck of {@code player}'s team colour at a random spot in its body. */
  private void colour(Player player, double height, double range, List<? extends Player> viewers) {
    Optional<com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor> team =
        runner.memberOf(player.getUniqueId()).flatMap(Combatant::team);
    if (team.isEmpty()) {
      return;
    }
    var dust = Classic.dust(team.orElseThrow());
    var random = ThreadLocalRandom.current();
    var at =
        Places.at(player)
            .add(
                random.nextDouble(-0.4, 0.4),
                random.nextDouble(0, height),
                random.nextDouble(-0.4, 0.4));
    Classic.particle(Classic.Puff.of(Particle.DUST, 1).with(dust), at, range, viewers);
  }
}
