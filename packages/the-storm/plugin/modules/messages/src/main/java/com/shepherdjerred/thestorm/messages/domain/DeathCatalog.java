package com.shepherdjerred.thestorm.messages.domain;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * Every death message the server can broadcast, and the rule for which list a death draws from.
 *
 * <ol>
 *   <li>Killed by a player: the player list for the cause, else the general player list.
 *   <li>Killed by a mob's attack (melee, projectile, explosion, magic): that mob's list, else the
 *       general mob list.
 *   <li>Anything else, including a mob killing through a signature cause such as a warden's sonic
 *       boom: the list for the cause.
 * </ol>
 *
 * @param causes a list for every {@link DeathCause}; templates may use only {@code {player}}
 * @param mobs deaths to mobs; templates may use {@code {player}} and {@code {killer}}
 * @param players deaths to players; templates may also use {@code {weapon}}
 */
public record DeathCatalog(Map<DeathCause, TemplatePool> causes, Mobs mobs, Players players) {

  private static final Set<Placeholder> CAUSE_NAMES = EnumSet.of(Placeholder.PLAYER);
  private static final Set<Placeholder> MOB_NAMES =
      EnumSet.of(Placeholder.PLAYER, Placeholder.KILLER);
  private static final Set<Placeholder> PLAYER_NAMES = EnumSet.allOf(Placeholder.class);

  public DeathCatalog {
    var missing = EnumSet.allOf(DeathCause.class);
    missing.removeAll(causes.keySet());
    if (!missing.isEmpty()) {
      throw new IllegalArgumentException(
          "death messages are missing causes: "
              + missing.stream().map(DeathCause::key).sorted().toList());
    }
    causes.forEach((cause, pool) -> pool.requireOnly(CAUSE_NAMES, "cause " + cause.key()));
    causes = Map.copyOf(new EnumMap<>(causes));
  }

  /** The list a death draws from. */
  public TemplatePool poolFor(DeathCause cause, Killer killer) {
    return switch (killer) {
      case Killer.Player() -> players.forCause(cause);
      case Killer.Mob(var type) when cause.isAttack() -> mobs.forType(type);
      case Killer.Mob _, Killer.None _ -> causeList(cause);
    };
  }

  /** A random template for this death. */
  public Template pick(DeathCause cause, Killer killer, RandomGenerator random) {
    return poolFor(cause, killer).pick(random);
  }

  private TemplatePool causeList(DeathCause cause) {
    var pool = causes.get(cause);
    if (pool == null) {
      throw new IllegalStateException("validated catalog has no list for " + cause);
    }
    return pool;
  }

  /**
   * Deaths to mobs.
   *
   * @param any the general list
   * @param byType lists for particular mobs, keyed by entity type key without namespace
   */
  public record Mobs(TemplatePool any, Map<String, TemplatePool> byType) {

    public Mobs {
      any.requireOnly(MOB_NAMES, "mobs.any");
      byType.forEach(
          (type, pool) -> pool.requireOnly(MOB_NAMES, "mob " + Killer.Mob.requireType(type)));
      byType = Map.copyOf(byType);
    }

    TemplatePool forType(String type) {
      return byType.getOrDefault(type, any);
    }
  }

  /**
   * Deaths to other players.
   *
   * @param any the general list
   * @param byCause lists for particular causes, such as a mace smash
   */
  public record Players(TemplatePool any, Map<DeathCause, TemplatePool> byCause) {

    public Players {
      any.requireOnly(PLAYER_NAMES, "players.any");
      byCause.forEach((cause, pool) -> pool.requireOnly(PLAYER_NAMES, "players " + cause.key()));
      byCause = Map.copyOf(byCause);
    }

    TemplatePool forCause(DeathCause cause) {
      return byCause.getOrDefault(cause, any);
    }
  }
}
