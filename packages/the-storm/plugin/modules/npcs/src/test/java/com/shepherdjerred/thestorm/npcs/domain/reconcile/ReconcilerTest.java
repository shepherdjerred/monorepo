package com.shepherdjerred.thestorm.npcs.domain.reconcile;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.npc;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.npc.NpcDefinition;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Assigned;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Reason;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Removal;
import com.shepherdjerred.thestorm.npcs.domain.reconcile.Reconciler.Spawned;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class ReconcilerTest {

  private static final NpcDefinition STAN = npc("stan");
  private static final NpcDefinition NAT = npc("nat");
  private static final NpcDefinition RENAMED_NAT =
      new NpcDefinition(
          "nat",
          "Nat the Innkeeper",
          NAT.description(),
          NAT.skin(),
          NAT.home(),
          NAT.pose(),
          NAT.roles(),
          NAT.schedule(),
          NAT.dialogue(),
          NAT.trainer());

  private static UUID id(int n) {
    return new UUID(0, n);
  }

  private static Spawned spawned(int entity, NpcDefinition npc) {
    return new Spawned(id(entity), npc.id(), npc.fingerprint());
  }

  @Test
  void anEmptyWorldSpawnsEveryone() {
    var plan = Reconciler.plan(List.of(STAN, NAT), List.of());
    assertThat(plan.spawn()).containsExactly(NAT, STAN);
    assertThat(plan.keep()).isEmpty();
    assertThat(plan.update()).isEmpty();
    assertThat(plan.remove()).isEmpty();
  }

  @Test
  void matchingEntitiesAreKept() {
    var plan = Reconciler.plan(List.of(STAN, NAT), List.of(spawned(1, STAN), spawned(2, NAT)));
    assertThat(plan.keep()).containsExactly(new Assigned(id(2), NAT), new Assigned(id(1), STAN));
    assertThat(plan.spawn()).isEmpty();
    assertThat(plan.update()).isEmpty();
    assertThat(plan.remove()).isEmpty();
  }

  @Test
  void aChangedDefinitionUpdatesItsEntity() {
    var plan = Reconciler.plan(List.of(RENAMED_NAT), List.of(spawned(2, NAT)));
    assertThat(plan.update()).containsExactly(new Assigned(id(2), RENAMED_NAT));
    assertThat(plan.keep()).isEmpty();
  }

  @Test
  void entitiesWithoutADefinitionAreOrphans() {
    var plan = Reconciler.plan(List.of(STAN), List.of(spawned(1, STAN), spawned(7, NAT)));
    assertThat(plan.remove()).containsExactly(new Removal(id(7), "nat", Reason.ORPHAN));
    assertThat(plan.keep()).containsExactly(new Assigned(id(1), STAN));
  }

  @Test
  void duplicatesKeepTheMatchingCopy() {
    var stale = new Spawned(id(1), "nat", "old");
    var plan = Reconciler.plan(List.of(NAT), List.of(stale, spawned(5, NAT), spawned(9, NAT)));
    assertThat(plan.keep()).containsExactly(new Assigned(id(5), NAT));
    assertThat(plan.remove())
        .containsExactly(
            new Removal(id(1), "nat", Reason.DUPLICATE),
            new Removal(id(9), "nat", Reason.DUPLICATE));
  }

  @Test
  void duplicatesWithNoMatchKeepTheLowestIdAndUpdateIt() {
    var plan = Reconciler.plan(List.of(RENAMED_NAT), List.of(spawned(4, NAT), spawned(3, NAT)));
    assertThat(plan.update()).containsExactly(new Assigned(id(3), RENAMED_NAT));
    assertThat(plan.remove()).containsExactly(new Removal(id(4), "nat", Reason.DUPLICATE));
  }

  @Test
  void thePlanDoesNotDependOnInputOrder() {
    var definitions = List.of(STAN, NAT);
    var entities =
        List.of(
            spawned(3, NAT), new Spawned(id(8), "ghost", "x"), spawned(1, STAN), spawned(2, NAT));
    var reversedEntities = entities.reversed();
    assertThat(Reconciler.plan(definitions.reversed(), reversedEntities))
        .isEqualTo(Reconciler.plan(definitions, entities));
  }

  @Test
  void duplicateDefinitionsAreABrokenInvariant() {
    assertThatThrownBy(() -> Reconciler.plan(List.of(NAT, RENAMED_NAT), List.of()))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
