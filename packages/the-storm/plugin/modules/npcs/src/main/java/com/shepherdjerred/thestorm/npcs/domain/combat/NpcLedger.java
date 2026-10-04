package com.shepherdjerred.thestorm.npcs.domain.combat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Warning allowances, wanted players and deaths. All deadlines use the affected world's clock. */
public final class NpcLedger {

  private static final long DAY_TICKS = 24_000;
  private final Map<WarningKey, Warning> warnings = new HashMap<>();
  private final Map<PlayerKey, Wanted> wanted = new HashMap<>();
  private final Map<String, Death> deaths = new HashMap<>();

  private record WarningKey(String world, String npc, UUID player) {}

  private record PlayerKey(String world, UUID player) {}

  /** A damaging hit, timed against the victim's world. */
  public record Attack(String world, String npc, UUID player, long now) {}

  /** The response to an accepted player hit. Damage is never cancelled by the allowance. */
  public enum Response {
    FIRST_WARNING,
    FINAL_WARNING,
    DEFEND
  }

  /** One player's first two hits on one NPC before dawn. */
  public record Warning(String world, String npc, UUID player, int hits, long until) {
    public Warning {
      requireIdentity(world, npc, until);
      if (hits < 1 || hits > 2) {
        throw new IllegalArgumentException("warning hits must be 1..2");
      }
    }
  }

  /** A player all guards in this world recognize until dawn. */
  public record Wanted(String world, UUID player, long until) {
    public Wanted {
      requireIdentity(world, player.toString(), until);
    }
  }

  /** An NPC absent until the next dawn in the world where it died. */
  public record Death(String world, String npc, long until) {
    public Death {
      requireIdentity(world, npc, until);
    }
  }

  /** An immutable transaction snapshot, also used for startup hydration. */
  public record Snapshot(List<Warning> warnings, List<Wanted> wanted, List<Death> deaths) {
    public Snapshot {
      warnings = List.copyOf(warnings);
      wanted = List.copyOf(wanted);
      deaths = List.copyOf(deaths);
    }

    public static Snapshot empty() {
      return new Snapshot(List.of(), List.of(), List.of());
    }
  }

  /** Time zero is dawn; dying exactly at dawn means waiting for the following dawn. */
  public static long nextDawn(long fullTime) {
    return Math.addExact(fullTime, DAY_TICKS - Math.floorMod(fullTime, DAY_TICKS));
  }

  public void restore(Snapshot snapshot) {
    warnings.clear();
    wanted.clear();
    deaths.clear();
    for (var warning : snapshot.warnings()) {
      var key = new WarningKey(warning.world(), warning.npc(), warning.player());
      if (warnings.putIfAbsent(key, warning) != null) {
        throw new IllegalArgumentException("duplicate NPC warning " + key);
      }
    }
    for (var offender : snapshot.wanted()) {
      var key = new PlayerKey(offender.world(), offender.player());
      if (wanted.putIfAbsent(key, offender) != null) {
        throw new IllegalArgumentException("duplicate wanted player " + key);
      }
    }
    for (var death : snapshot.deaths()) {
      if (deaths.putIfAbsent(death.npc(), death) != null) {
        throw new IllegalArgumentException("duplicate NPC death " + death.npc());
      }
    }
  }

  public Snapshot snapshot() {
    return new Snapshot(
        List.copyOf(warnings.values()), List.copyOf(wanted.values()), List.copyOf(deaths.values()));
  }

  public Response hit(Attack attack, boolean lethal) {
    var world = attack.world();
    var npc = attack.npc();
    var player = attack.player();
    var now = attack.now();
    if (lethal || isWanted(world, player, now)) {
      accuse(world, player, now);
      return Response.DEFEND;
    }
    var key = new WarningKey(world, npc, player);
    var previous = warnings.get(key);
    var hits = previous == null || previous.until() <= now ? 1 : previous.hits() + 1;
    if (hits > 2) {
      accuse(world, player, now);
      return Response.DEFEND;
    }
    warnings.put(key, new Warning(world, npc, player, hits, nextDawn(now)));
    return hits == 1 ? Response.FIRST_WARNING : Response.FINAL_WARNING;
  }

  public void accuse(String world, UUID player, long now) {
    wanted.put(new PlayerKey(world, player), new Wanted(world, player, nextDawn(now)));
  }

  public boolean isWanted(String world, UUID player, long now) {
    var offender = wanted.get(new PlayerKey(world, player));
    return offender != null && offender.until() > now;
  }

  public void died(String world, String npc, long now) {
    deaths.put(npc, new Death(world, npc, nextDawn(now)));
  }

  public boolean awaitingDawn(String npc) {
    return deaths.containsKey(npc);
  }

  /** Unloaded worlds retain their records until their own clock can be observed again. */
  public boolean expire(Map<String, Long> clocks) {
    var changed =
        warnings.values().removeIf(value -> expired(value.world(), value.until(), clocks));
    changed |= wanted.values().removeIf(value -> expired(value.world(), value.until(), clocks));
    changed |= deaths.values().removeIf(value -> expired(value.world(), value.until(), clocks));
    return changed;
  }

  private static boolean expired(String world, long until, Map<String, Long> clocks) {
    var now = clocks.get(world);
    return now != null && now >= until;
  }

  private static void requireIdentity(String world, String id, long until) {
    if (world.isBlank() || id.isBlank() || until <= 0) {
      throw new IllegalArgumentException(
          "NPC state requires identities and a positive dawn deadline");
    }
  }
}
