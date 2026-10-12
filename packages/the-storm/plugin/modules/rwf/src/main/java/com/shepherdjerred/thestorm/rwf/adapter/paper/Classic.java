// Ported from libraryaddict's Red Warfare
// (redwarfare-core/src/me/libraryaddict/core/utils/UtilParticle.java, UtilBlock.java and
// data/TeamSettings.java); see packages/the-storm/NOTICE.
package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import java.util.Collection;
import java.util.Set;
import net.kyori.adventure.audience.Audience;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Tag;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;
import org.jspecify.annotations.Nullable;

/**
 * How Red Warfare's kits looked and read, for the Paper adapter: chat lines in its colour codes,
 * particles sent only to players within its view distances, its team colours for dyes and dust, and
 * its "perfectly square" solid blocks.
 */
final class Classic {

  /** Red Warfare's {@code ViewDist.SHORT}, in blocks. */
  static final double SHORT = 8;

  /** Red Warfare's {@code ViewDist.NORMAL}, its default, in blocks. */
  static final double NORMAL = 24;

  /** Red Warfare's {@code ViewDist.LONG}, in blocks. */
  static final double LONG = 48;

  /** Red Warfare's default red dust. */
  static final Particle.DustOptions RED_DUST =
      new Particle.DustOptions(Color.fromRGB(255, 0, 0), 1);

  private static final LegacyComponentSerializer LEGACY = LegacyComponentSerializer.legacySection();

  /** Full cubes that are not opaque, which {@code UtilBlock} still counted as solid. */
  private static final Set<Material> SEE_THROUGH_CUBES =
      Set.of(
          Material.BARRIER,
          Material.BEACON,
          Material.GLOWSTONE,
          Material.SEA_LANTERN,
          Material.SLIME_BLOCK,
          Material.SPAWNER,
          Material.TNT);

  private Classic() {}

  /** Sends {@code text}, written with Red Warfare's section-sign colour codes, to {@code to}. */
  static void say(Audience to, String text) {
    to.sendMessage(LEGACY.deserialize(text));
  }

  /**
   * A particle as Red Warfare sent it, always at speed 0.
   *
   * @param particle which
   * @param count how many
   * @param spread how far they scatter along each axis
   * @param data its colour or block, if it takes one
   */
  record Puff(Particle particle, int count, Vector spread, @Nullable Object data) {

    static Puff of(Particle particle, int count) {
      return new Puff(particle, count, new Vector(), null);
    }

    Puff spread(double x, double y, double z) {
      return new Puff(particle, count, new Vector(x, y, z), data);
    }

    Puff with(Object value) {
      return new Puff(particle, count, spread, value);
    }
  }

  /**
   * Shows {@code puff} at {@code at} to each of {@code viewers} in its world within {@code range}
   * blocks of it, as Red Warfare's {@code UtilParticle.playParticle} did.
   */
  static void particle(Puff puff, Location at, double range, Collection<? extends Player> viewers) {
    var spread = puff.spread();
    for (var viewer : viewers) {
      if (!viewer.getWorld().equals(at.getWorld()) || Places.at(viewer).distance(at) > range) {
        continue;
      }
      viewer.spawnParticle(
          puff.particle(),
          at,
          puff.count(),
          spread.getX(),
          spread.getY(),
          spread.getZ(),
          0,
          puff.data());
    }
  }

  /** A team's chat colour, as Red Warfare's {@code GameTeam.getColoring()} gave it. */
  static NamedTextColor color(TeamColor team) {
    return switch (team) {
      case RED -> NamedTextColor.RED;
      case BLUE -> NamedTextColor.BLUE;
      case GREEN -> NamedTextColor.DARK_GREEN;
      case PURPLE -> NamedTextColor.DARK_PURPLE;
      case YELLOW -> NamedTextColor.YELLOW;
    };
  }

  /** A team's colour as Red Warfare dyed items in it ({@code TeamSettings.getBukkitColor}). */
  static Color dye(TeamColor team) {
    return switch (team) {
      case RED -> Color.RED;
      case BLUE -> Color.BLUE;
      case GREEN -> Color.GREEN;
      case PURPLE -> Color.PURPLE;
      case YELLOW -> Color.YELLOW;
    };
  }

  /**
   * A team's dust as Red Warfare coloured it ({@code ParticleColor}): its red, green and blue
   * offsets, a zero red read as full red and a negative channel as none.
   */
  static Particle.DustOptions dust(TeamColor team) {
    var color =
        switch (team) {
          case RED -> Color.fromRGB(255, 0, 0);
          case BLUE -> Color.fromRGB(0, 0, 255);
          case GREEN -> Color.fromRGB(0, 255, 0);
          case PURPLE -> Color.fromRGB(255, 0, 255);
          case YELLOW -> Color.fromRGB(255, 255, 0);
        };
    return new Particle.DustOptions(color, 1);
  }

  /**
   * Whether {@code block} is a full, square solid block, as Red Warfare's {@code UtilBlock.solid}
   * listed them for 1.12's blocks: every opaque full cube, and the see-through full cubes it named
   * too (glass, leaves, ice and their kin).
   */
  static boolean solid(Block block) {
    var type = block.getType();
    if (!type.isSolid()) {
      return false;
    }
    return type.isOccluding()
        || Tag.LEAVES.isTagged(type)
        || Tag.IMPERMEABLE.isTagged(type)
        || Tag.ICE.isTagged(type)
        || SEE_THROUGH_CUBES.contains(type);
  }

  /** Whether nothing of {@code block} can be bumped into, as {@code UtilBlock.nonSolid}. */
  static boolean open(Block block) {
    return !block.getType().isSolid();
  }
}
