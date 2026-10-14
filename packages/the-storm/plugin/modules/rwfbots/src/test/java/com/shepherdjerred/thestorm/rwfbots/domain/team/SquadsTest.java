package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.*;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;

final class SquadsTest {
  @Test
  void quarterOfTheTeamIsIndependentAndTheRestFormsStablePairsOrTrios() {
    for (var size = 2; size <= 32; size++) {
      var bots =
          IntStream.range(0, size).mapToObj(id -> combatant(id, RED, new Vec3(id, 1, 2))).toList();
      var members =
          bots.stream()
              .collect(
                  Collectors.toUnmodifiableMap(
                      bot -> bot.id(),
                      bot ->
                          new SlotFit.Member(
                              bot.id().value() % 4 == 0 ? Archetype.LURKER : Archetype.TACTICIAN,
                              Set.of(),
                              Map.of(),
                              Kit.TROOPER)));
      var groups = Squads.deal(Map.of(), bots, members);
      assertThat(groups.values().stream().filter(group -> group < 0).count()).isEqualTo(size / 4);
      var sizes =
          groups.values().stream()
              .filter(group -> group >= 0)
              .collect(Collectors.groupingBy(group -> group, Collectors.counting()));
      assertThat(sizes.values()).allMatch(count -> count == 2 || count == 3);
      assertThat(Squads.deal(groups, bots.reversed(), members)).isEqualTo(groups);
    }
  }

  @Test
  void independentPersonalitiesReceiveTheSoloPlaces() {
    var bots =
        IntStream.range(0, 8).mapToObj(id -> combatant(id, RED, new Vec3(id, 1, 2))).toList();
    var members =
        bots.stream()
            .collect(
                Collectors.toUnmodifiableMap(
                    bot -> bot.id(),
                    bot ->
                        new SlotFit.Member(
                            bot.id().value() < 2 ? Archetype.LURKER : Archetype.TACTICIAN,
                            Set.of(),
                            Map.of(),
                            Kit.TROOPER)));
    var groups = Squads.deal(Map.of(), bots, members);
    assertThat(groups).containsEntry(new CombatantId(0), -1).containsEntry(new CombatantId(1), -1);
  }
}
