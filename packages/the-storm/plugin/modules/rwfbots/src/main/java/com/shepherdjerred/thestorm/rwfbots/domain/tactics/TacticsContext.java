package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.difficulty.Levers;
import com.shepherdjerred.thestorm.rwfbots.domain.map.HealthRoutes;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph.SearchWorkspace;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavPath;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Optional;
import java.util.Set;
import java.util.function.IntToDoubleFunction;
import java.util.function.IntUnaryOperator;
import org.jspecify.annotations.Nullable;

/**
 * What the think step needs that does not change during a match.
 *
 * @param nav the baked map
 * @param levers the bot's levers
 * @param style the bot's play style
 * @param kit the kit it plays
 * @param archetype its personality's archetype, which bends the utilities and fighting range
 * @param quirks its personality's habits; LATE_TO_EVERYTHING delays its first move
 * @param seed the bot's own seed for this match (match seed mixed with the bot), for route noise
 *     and quirk timing
 * @param workspace exclusively owned batch scratch, or null for allocating offline callers
 */
public record TacticsContext(
    NavArtifact nav,
    Levers levers,
    Style style,
    Kit kit,
    Archetype archetype,
    Set<Quirk> quirks,
    long seed,
    @Nullable SearchWorkspace workspace) {

  public TacticsContext withWorkspace(NavGraph.SearchWorkspace scratch) {
    return new TacticsContext(nav, levers, style, kit, archetype, quirks, seed, scratch);
  }

  public Optional<NavPath> path(int from, int to, IntToDoubleFunction penalty) {
    return workspace == null
        ? nav.graph().path(from, to, penalty)
        : nav.graph().path(from, to, penalty, workspace);
  }

  public Optional<HealthRoutes.Route> route(HealthRoutes.Request request, IntUnaryOperator damage) {
    return HealthRoutes.find(nav.graph(), request, damage, workspace);
  }

  public Optional<HealthRoutes.Route> route(
      HealthRoutes.Request request, HealthRoutes.EdgePolicy edges) {
    return HealthRoutes.find(nav.graph(), request, edges, workspace);
  }

  /** The shortest and longest a late bot waits before its first move, in ticks. */
  public static final int LATE_MIN_TICKS = 40;

  public static final int LATE_SPREAD_TICKS = 60;

  public TacticsContext {
    quirks = Set.copyOf(quirks);
  }

  public boolean hasGapples() {
    return kit.hasGapples();
  }

  public boolean hasRewind() {
    return kit.hasAbility();
  }

  public ArchetypeBias bias() {
    return ArchetypeBias.of(archetype);
  }

  public ArchetypeBias.Range keep() {
    return ArchetypeBias.keep(kit, archetype, levers);
  }

  /** How long the bot stands at the start of its first life: 0, or 2 to 5 s when late. */
  public int lateStartTicks() {
    if (!quirks.contains(Quirk.LATE_TO_EVERYTHING)) {
      return 0;
    }
    return LATE_MIN_TICKS + (int) Math.floorMod(seed, (long) LATE_SPREAD_TICKS);
  }
}
