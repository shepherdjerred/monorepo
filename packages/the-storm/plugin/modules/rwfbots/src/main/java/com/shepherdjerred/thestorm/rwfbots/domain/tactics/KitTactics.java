package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * The think step's hook for each kit: how a kit leans the bot's choice of plan toward what its
 * power is for. A Sapper goes for the defuse, a Saboteur for the arm; kits that leave something
 * behind (landmines, teleporters, banners, barricades) or that grow while they wait (the Dwarf)
 * would rather hold a slot; stealthy kits hunt; heavy hitters engage; the Medic and the
 * Sacrificial, who keep others alive, hang back. The leans are small next to the utilities, so they
 * tip close calls and never override an urgent one. A kit with no lean (Trooper, the bows) thinks
 * as before.
 */
public final class KitTactics {

  /** A small lean: tips a close call. */
  static final double NUDGE = 0.1;

  /** A firm lean: what the kit is built to do. */
  static final double LEAN = 0.2;

  /** Each kit's leans; a kit not listed has none. */
  private static final Map<Kit, Map<Option, Double>> LEANS = table();

  private KitTactics() {}

  private static Map<Kit, Map<Option, Double>> table() {
    var table = new EnumMap<Kit, Map<Option, Double>>(Kit.class);
    put(table, List.of(Kit.SAPPER), Map.of(Option.DEFUSE, LEAN, Option.RETAKE, NUDGE));
    put(table, List.of(Kit.SABOTEUR), Map.of(Option.ARM, LEAN, Option.HELP_ARM, NUDGE));
    put(
        table,
        List.of(Kit.MEDIC),
        Map.of(Option.HELP_ARM, NUDGE, Option.HOLD_SLOT, NUDGE, Option.ENGAGE, -NUDGE));
    put(table, List.of(Kit.SACRIFICIAL), Map.of(Option.HOLD_SLOT, NUDGE, Option.ENGAGE, -LEAN));
    put(
        table,
        List.of(Kit.DEMOLITIONS, Kit.TELEPORTER, Kit.ENGINEER, Kit.BANNERMAN),
        Map.of(Option.HOLD_SLOT, LEAN));
    put(table, List.of(Kit.DWARF), Map.of(Option.HOLD_SLOT, LEAN, Option.HOLD_ANGLE, NUDGE));
    put(
        table,
        List.of(Kit.GHOST, Kit.WRAITH, Kit.NINJA, Kit.SPY, Kit.SKINNER, Kit.DECOY, Kit.TRACKER),
        Map.of(Option.HUNT, LEAN));
    put(
        table,
        List.of(Kit.JUGGERNAUT, Kit.BERSERKER, Kit.INERTIA, Kit.VAMPIRE, Kit.BLEEDER),
        Map.of(Option.ENGAGE, LEAN));
    put(table, List.of(Kit.SPOTTER), Map.of(Option.HOLD_ANGLE, LEAN));
    put(table, List.of(Kit.GRAPPLER), Map.of(Option.TAKE_SLOT, NUDGE));
    return table;
  }

  private static void put(
      Map<Kit, Map<Option, Double>> table, List<Kit> kits, Map<Option, Double> leans) {
    for (var kit : kits) {
      table.put(kit, Map.copyOf(leans));
    }
  }

  /** How {@code kit} leans each option's score; options it does not lean are absent. */
  public static Map<Option, Double> leans(Kit kit) {
    return LEANS.getOrDefault(kit, Map.of());
  }

  /**
   * Leans {@code scores} for {@code kit}; only options already scored are moved. An option the
   * situation scored zero (a hunt with nothing to hunt, a fight with no one to fight, holding an
   * angle while a slot waits) stays zero, so a kit's taste never invents an option on its own.
   */
  public static void lean(Kit kit, Map<Option, Double> scores) {
    var leans = leans(kit);
    for (var option : Option.values()) {
      var lean = leans.get(option);
      if (lean != null) {
        scores.computeIfPresent(option, (o, score) -> score > 0 ? score + lean : score);
      }
    }
  }
}
