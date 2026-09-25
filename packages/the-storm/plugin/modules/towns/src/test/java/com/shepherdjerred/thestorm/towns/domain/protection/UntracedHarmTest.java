package com.shepherdjerred.thestorm.towns.domain.protection;

import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_A;
import static com.shepherdjerred.thestorm.towns.domain.Fixtures.TOWN_B;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.towns.domain.Fixtures;
import com.shepherdjerred.thestorm.towns.domain.land.ClaimFlag;
import com.shepherdjerred.thestorm.towns.domain.land.Land;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * Harm nobody can be blamed for (a dispenser's arrows, TNT without a lighter, a creeper) reaching a
 * player: from the victim land's own owner always; from anywhere else only where PvP is on.
 */
final class UntracedHarmTest {

  private static final Land WILD = new Land.Wilderness();
  private static final Land A_SAFE = Fixtures.land(TOWN_A);
  private static final Land A_PVP = Fixtures.land(TOWN_A, ClaimFlag.PVP);
  private static final Land B_SAFE = Fixtures.land(TOWN_B);
  private static final Land SPAWN = new Land.RegionLand(Fixtures.region("spawn"));
  private static final Land ARENA =
      new Land.RegionLand(
          Fixtures.region("arena", Fixtures.allow(Action.ATTACK_PLAYER, Subject.PLAYER)));

  record Case(String name, Land origin, Land victim, boolean allowed) {
    @Override
    public String toString() {
      return name;
    }
  }

  static Stream<Case> cases() {
    return Stream.of(
        new Case("wild to wild", WILD, WILD, true),
        new Case("wild cannon into a safe claim", WILD, A_SAFE, false),
        new Case("wild cannon into a PvP claim", WILD, A_PVP, true),
        new Case("the town's own dispenser in its safe claim", A_SAFE, A_SAFE, true),
        new Case("another town's dispenser into a safe claim", B_SAFE, A_SAFE, false),
        new Case("a safe claim's dispenser into the wild", A_SAFE, WILD, true),
        new Case("wild cannon into spawn", WILD, SPAWN, false),
        new Case("wild cannon into the arena", WILD, ARENA, true),
        new Case("spawn's own trap in spawn", SPAWN, SPAWN, true));
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("cases")
  void decides(Case row) {
    var engine = new ProtectionEngine(Fixtures.trust());

    assertThat(engine.allowsUntracedHarm(row.origin(), row.victim())).isEqualTo(row.allowed());
  }
}
