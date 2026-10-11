package com.shepherdjerred.thestorm.rwfbots.domain.learning;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.adapter.content.LearningContract;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Memory;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Sighting;
import java.util.EnumMap;
import java.util.List;
import org.junit.jupiter.api.Test;

final class FairObservationTest {
  @Test
  void changingVisibleEnemyHealthDoesNotChangeActorInput() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var enemy = combatant(2, BLUE, new Vec3(5.5, 1, 8.5));
    var grid = SyntheticMap.bake().grid();
    var healthy =
        FairObservation.values(
            self, new Percept(PerceptionState.EMPTY, List.of(enemy), 20), grid, levers(1));
    var hurt =
        FairObservation.values(
            self,
            new Percept(PerceptionState.EMPTY, List.of(enemy.withHealth(1, 0)), 20),
            grid,
            levers(1));
    assertThat(healthy).isEqualTo(hurt);
    var encoded = LearningContract.load().encode(healthy);
    assertThat(encoded).hasSize(34);
    assertThat(encoded.get(0)).isEqualTo(1);
    assertThat(encoded.get(8)).isEqualTo(1);
    assertThat(encoded.get(10)).isEqualTo(3.0 / 32);
  }

  @Test
  void unseenTargetOnlyUsesTheOldSighting() {
    var self = combatant(1, RED, new Vec3(5.5, 1, 5.5));
    var memory =
        Memory.EMPTY.remember(
            new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(2),
            new Sighting(new Vec3(5.5, 1, 8.5), Vec3.ZERO, 10, 1, true));
    var state = new PerceptionState(memory, PerceptionState.EMPTY.suspicion());
    var values =
        FairObservation.values(
            self, new Percept(state, List.of(), 20), SyntheticMap.bake().grid(), levers(1));
    assertThat(values.get(Feature.TARGET_VISIBLE)).isZero();
    assertThat(values.get(Feature.TARGET_FORWARD)).isEqualTo(3);
    assertThat(values.get(Feature.TARGET_AGE)).isEqualTo(10);
    assertThat(values.get(Feature.TARGET_CONFIDENCE)).isLessThan(1);
  }

  @Test
  void refusesMissingAndNonfiniteContractValues() {
    var contract = LearningContract.load();
    var values = new EnumMap<Feature, Double>(Feature.class);
    assertThatThrownBy(() -> contract.encode(values)).isInstanceOf(IllegalArgumentException.class);
    for (var feature : Feature.values()) values.put(feature, 0.0);
    values.put(Feature.HP, Double.NaN);
    assertThatThrownBy(() -> contract.encode(values)).isInstanceOf(IllegalArgumentException.class);
  }
}
