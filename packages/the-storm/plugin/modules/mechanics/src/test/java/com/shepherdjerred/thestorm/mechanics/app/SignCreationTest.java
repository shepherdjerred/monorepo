package com.shepherdjerred.thestorm.mechanics.app;

import static com.shepherdjerred.thestorm.mechanics.domain.TestGrid.PLANKS;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.config.Problem;
import com.shepherdjerred.thestorm.core.config.StrictYaml;
import com.shepherdjerred.thestorm.core.protection.Decision;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.mechanics.domain.TestGrid;
import com.shepherdjerred.thestorm.mechanics.domain.config.MechanicsConfig;
import com.shepherdjerred.thestorm.mechanics.domain.creation.CreationRules;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Direction;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Mount;
import com.shepherdjerred.thestorm.mechanics.domain.grid.Pos;
import com.shepherdjerred.thestorm.mechanics.domain.grid.SignView;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Feature;
import com.shepherdjerred.thestorm.mechanics.domain.sign.Mechanism;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

final class SignCreationTest {

  private static final Pos SIGN = new Pos(0, 64, 0);

  private MechanicsConfig config;
  private SignCreation creation;
  private int protectionAsked;

  @BeforeEach
  void load() throws Exception {
    var yaml = Files.readString(Path.of("../../../server/owned/plugins/TheStorm/mechanics.yml"));
    config =
        ((Result.Ok<MechanicsConfig, List<Problem>>)
                StrictYaml.parse("mechanics.yml", yaml, MechanicsConfig.class))
            .value();
    creation = new SignCreation(new Gatekeeper(config), CreationRules.standard(config));
  }

  private Writer writer(Set<String> permissions, Decision decision) {
    return new Writer() {
      @Override
      public boolean hasPermission(String permission) {
        return permissions.contains(permission);
      }

      @Override
      public Decision mayBuildHere() {
        protectionAsked++;
        return decision;
      }
    };
  }

  private static SignView sign(String tag) {
    return new SignView(List.of("", tag, "", ""), Mount.WALL, Optional.of(Direction.NORTH));
  }

  private static String plain(Component component) {
    return PlainTextComponentSerializer.plainText().serialize(component);
  }

  @Test
  void plainTextIsLeftAloneWithoutAskingProtection() {
    var outcome =
        creation.create(
            SIGN, sign("Welcome!"), new TestGrid(), writer(Set.of(), Decision.allowed()));

    assertThat(outcome).isEqualTo(new SignCreation.Outcome.Plain());
    assertThat(protectionAsked).isZero();
  }

  @Test
  void aMechanicWithTheLevelOnTheirOwnLandBuildsIt() {
    var outcome =
        creation.create(
            SIGN,
            sign("[lift up]"),
            new TestGrid(),
            writer(Set.of("thestorm.track.mechanic.2"), Decision.allowed()));

    assertThat(outcome).isEqualTo(new SignCreation.Outcome.Accepted(Mechanism.LIFT_UP));
  }

  @Test
  void theLevelIsCheckedBeforeProtection() {
    var outcome =
        creation.create(
            SIGN,
            sign("[Lift Up]"),
            new TestGrid(),
            writer(Set.of("thestorm.track.mechanic.1"), Decision.allowed()));

    assertThat(outcome).isInstanceOf(SignCreation.Outcome.Refused.class);
    var refused = (SignCreation.Outcome.Refused) outcome;
    assertThat(refused.feature()).isEqualTo(Feature.ELEVATOR);
    assertThat(plain(refused.reason())).isEqualTo("Building this needs Mechanic II.");
    assertThat(protectionAsked).isZero();
  }

  @Test
  void protectionsReasonIsPassedOn() {
    var denied = new Decision.Denied(Component.text("This land belongs to Aegis."));

    var outcome =
        creation.create(
            SIGN, sign("[X]"), new TestGrid(), writer(Set.of("thestorm.track.mechanic.1"), denied));

    assertThat(outcome)
        .isEqualTo(new SignCreation.Outcome.Refused(Feature.HIDDEN_SWITCH, denied.reason()));
  }

  @Test
  void aBadlyBuiltSignIsRefusedAfterTheOtherChecks() {
    var outcome =
        creation.create(
            SIGN,
            sign("[Bridge]"),
            new TestGrid().solid(SIGN.offset(Direction.DOWN), "minecraft:dirt"),
            writer(Set.of("thestorm.track.mechanic.2"), Decision.allowed()));

    assertThat(outcome).isInstanceOf(SignCreation.Outcome.Refused.class);
    assertThat(protectionAsked).isOne();
  }

  @Test
  void aWellBuiltBridgeIsAccepted() {
    var outcome =
        creation.create(
            SIGN,
            sign("[BRIDGE]"),
            new TestGrid().solid(SIGN.offset(Direction.DOWN), PLANKS),
            writer(Set.of("thestorm.track.mechanic.2"), Decision.allowed()));

    assertThat(outcome).isEqualTo(new SignCreation.Outcome.Accepted(Mechanism.BRIDGE));
  }

  @Test
  void levelsAreReadFromTrackPermissions() {
    assertThat(Gatekeeper.hasLevel(permission -> false, 0)).isTrue();
    assertThat(Gatekeeper.hasLevel("thestorm.track.mechanic.3"::equals, 3)).isTrue();
    assertThat(Gatekeeper.hasLevel("thestorm.track.mechanic.3"::equals, 4)).isFalse();
    assertThat(Gatekeeper.levelName(5)).isEqualTo("Mechanic V");
  }

  @Test
  void usingNeedsTheUseLevel() {
    var gatekeeper = new Gatekeeper(config);

    assertThat(gatekeeper.mayUse(Feature.ELEVATOR, "thestorm.track.mechanic.2"::equals)).isEmpty();
    assertThat(
            gatekeeper.mayUse(Feature.ELEVATOR, permission -> false).map(SignCreationTest::plain))
        .contains("Using this needs Mechanic II.");
  }
}
