package com.shepherdjerred.thestorm.rwfbots.domain.team;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/** Fuse workers, a surrounding screen, and reserves retaining valid control positions. */
final class RetakeFormation {
  private RetakeFormation() {}

  static Optional<BombView> urgent(WorldSnapshot snapshot, TeamId team) {
    return snapshot.bombsOf(team).stream()
        .filter(bomb -> bomb.state().isLit())
        .min(Comparator.comparingLong(RetakeFormation::remaining).thenComparing(BombView::id));
  }

  private static long remaining(BombView bomb) {
    return switch (bomb.state()) {
      case BombState.Armed(var ticks) -> ticks;
      case BombState.Defusing(var _, var _, var ticks) -> ticks;
      default -> throw new IllegalArgumentException("retake objective needs a lit fuse");
    };
  }

  static List<Slot> slots(
      NavArtifact nav, BombView bomb, List<CombatantView> alive, TeamPlan previous) {
    var site =
        nav.sites().bombs().stream()
            .filter(candidate -> candidate.cell().center().distance(bomb.pos()) < 0.01)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("lit bomb has no baked site"));
    var layout = nav.bombScreens().require(site.name());
    if (layout.workers().isEmpty()) {
      throw new IllegalStateException("unplayable bomb formation reached an active match");
    }
    var workers = Math.min(2, Math.min(alive.size(), layout.workers().size()));
    var result = new ArrayList<Slot>(alive.size());
    var setup = new Setup(nav, bomb, layout, previous);
    for (var index = 0; index < alive.size(); index++) {
      result.add(slot(setup, alive.get(index), index, workers));
    }
    return List.copyOf(result);
  }

  private record Setup(
      NavArtifact nav, BombView bomb, BombScreens.Layout layout, TeamPlan previous) {}

  private static Slot slot(Setup setup, CombatantView bot, int index, int workers) {
    if (index < workers) {
      return station(
          "defuse-" + index,
          Role.RETAKE,
          setup.nav().graph().feet(setup.layout().workers().get(index)),
          setup.bomb());
    }
    var screen = index - workers;
    if (screen < setup.layout().screens().size()) {
      return station(
          "screen-" + screen,
          Role.DEFEND,
          setup.nav().graph().feet(setup.layout().screens().get(screen)),
          setup.bomb());
    }
    return station(
        "reserve-" + bot.id().value(),
        Role.ROTATE,
        reserve(setup.nav(), bot, setup.previous()),
        setup.bomb());
  }

  private static Slot station(String key, Role role, Vec3 point, BombView bomb) {
    return new Slot(
        key,
        role == Role.ROTATE ? SlotKind.SWEEP : SlotKind.ANCHOR,
        role,
        point,
        bomb.pos(),
        -1,
        role == Role.RETAKE ? 0 : -1,
        Optional.empty(),
        0);
  }

  /** Space shortage retains an existing valid job, including while its owner is airborne. */
  static Vec3 reserve(NavArtifact nav, CombatantView bot, TeamPlan previous) {
    var graph = nav.graph();
    var held =
        previous
            .slotOf(bot.id())
            .map(Slot::pos)
            .flatMap(
                pos -> {
                  var node = graph.nearestNodeWithin(pos, 3);
                  return node.isPresent()
                      ? Optional.of(graph.feet(node.getAsInt()))
                      : Optional.empty();
                });
    if (held.isPresent()) return held.orElseThrow();
    var standing = graph.nearestNodeWithin(bot.pos(), 2);
    if (standing.isPresent()) return graph.feet(standing.getAsInt());
    var spawn =
        nav.sites().spawns().stream()
            .filter(site -> site.team().filter(bot.team().value()::equals).isPresent())
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("team has no baked spawn"));
    return graph.feet(
        nav.approachNode(spawn)
            .orElseThrow(
                () -> new IllegalStateException("team spawn has no valid navigation position")));
  }
}
