package com.shepherdjerred.thestorm.mobs.domain.spawn;

import com.shepherdjerred.thestorm.mobs.domain.spawn.SpawnVerdict.Reason;
import java.util.Set;

/**
 * Decides what happens to a spawning mob. Only hostile mobs are ever levelled; arena mobs, bosses,
 * named and tamed mobs, babies (when configured), excluded types and every spawn reason outside the
 * allowlist stay vanilla. Admin regions follow their {@link AdminPolicy}.
 */
public final class SpawnPolicy {

  /** Spawn reasons that count as the world spawning monsters by itself. */
  public static final Set<String> NATURAL_REASONS =
      Set.of("NATURAL", "JOCKEY", "MOUNT", "PATROL", "REINFORCEMENTS");

  private final Exclusions exclusions;
  private final AdminPolicy adminPolicy;

  public SpawnPolicy(Exclusions exclusions, AdminPolicy adminPolicy) {
    this.exclusions = exclusions;
    this.adminPolicy = adminPolicy;
  }

  public SpawnVerdict decide(SpawnFacts mob) {
    if (mob.is(Trait.ARENA)) {
      return leave(Reason.ARENA);
    }
    if (!mob.is(Trait.HOSTILE)) {
      return leave(Reason.NOT_HOSTILE);
    }
    if (mob.is(Trait.ADMIN_REGION)) {
      switch (adminPolicy) {
        case BLOCK_NATURAL -> {
          return NATURAL_REASONS.contains(mob.reason())
              ? new SpawnVerdict.Block()
              : leave(Reason.ADMIN_REGION);
        }
        case UNLEVELLED -> {
          return leave(Reason.ADMIN_REGION);
        }
        case LEVELLED -> {
          // Treated like anywhere else.
        }
      }
    }
    return excluded(mob);
  }

  private SpawnVerdict excluded(SpawnFacts mob) {
    if (mob.is(Trait.BOSS)) {
      return leave(Reason.BOSS);
    }
    if (exclusions.types().contains(mob.type())) {
      return leave(Reason.EXCLUDED_TYPE);
    }
    if (mob.is(Trait.NAMED)) {
      return leave(Reason.NAMED);
    }
    if (mob.is(Trait.TAMED)) {
      return leave(Reason.TAMED);
    }
    if (exclusions.babies() && mob.is(Trait.BABY)) {
      return leave(Reason.BABY);
    }
    if (!exclusions.levelledReasons().contains(mob.reason())) {
      return leave(Reason.UNLEVELLED_REASON);
    }
    return new SpawnVerdict.Level();
  }

  private static SpawnVerdict leave(Reason reason) {
    return new SpawnVerdict.Leave(reason);
  }
}
