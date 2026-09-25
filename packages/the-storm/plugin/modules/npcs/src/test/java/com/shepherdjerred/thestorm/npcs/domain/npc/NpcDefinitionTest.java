package com.shepherdjerred.thestorm.npcs.domain.npc;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.npc;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.spot;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.npcs.domain.content.Snippets;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class NpcDefinitionTest {

  private static NpcDefinition with(NpcDefinition base, String name, Skin skin, NpcPose pose) {
    return new NpcDefinition(
        base.id(),
        name,
        base.description(),
        skin,
        base.home(),
        pose,
        base.roles(),
        base.schedule(),
        base.dialogue(),
        base.trainer());
  }

  @Test
  void theFingerprintFollowsWhatTheEntityShows() {
    var base = npc("stan");
    assertThat(npc("stan").fingerprint()).isEqualTo(base.fingerprint());
    assertThat(with(base, "Stanley", base.skin(), base.pose()).fingerprint())
        .isNotEqualTo(base.fingerprint());
    assertThat(
            with(base, base.name(), new Skin.Vanilla(Skin.Model.WIDE, "kai"), base.pose())
                .fingerprint())
        .isNotEqualTo(base.fingerprint());
    assertThat(with(base, base.name(), base.skin(), NpcPose.SNEAKING).fingerprint())
        .isNotEqualTo(base.fingerprint());
  }

  @Test
  void theFingerprintIgnoresBehaviour() {
    var base = npc("stan");
    var moved =
        new NpcDefinition(
            "stan",
            base.name(),
            base.description(),
            base.skin(),
            spot(100, 70, 100),
            base.pose(),
            Set.of("banker"),
            Optional.of("day"),
            Optional.of("talk"),
            Optional.of("mechanic"));
    assertThat(moved.fingerprint()).isEqualTo(base.fingerprint());
  }

  @Test
  void skinsDescribeThemselves() {
    assertThat(new Skin.Default().describe()).isEqualTo("none");
    var slim = new Skin.Vanilla(Skin.Model.SLIM, "alex");
    assertThat(slim.describe()).isEqualTo("vanilla:slim/alex");
    assertThat(slim.texturePath()).isEqualTo("entity/player/slim/alex");
    var signed = new Skin.Signed("stan", "value", "signature");
    assertThat(signed.describe()).startsWith("stan#");
    assertThat(new Skin.Signed("stan", "other", "signature").describe())
        .isNotEqualTo(signed.describe());
    assertThatThrownBy(() -> new Skin.Vanilla(Skin.Model.WIDE, "notch"))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Skin.Signed("x", " ", "sig"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void posesUseContentSpelling() {
    assertThat(NpcPose.byId("fall_flying")).contains(NpcPose.FALL_FLYING);
    assertThat(NpcPose.byId("FALL_FLYING")).isEmpty();
    assertThat(NpcPose.SLEEPING.id()).isEqualTo("sleeping");
  }

  @Test
  void snippetsArePasteableYaml() {
    var spot =
        new Spot("minecraft:overworld", new Vec3(12.346, 64, -3.5), new Rotation(91.26f, -10));
    assertThat(Snippets.home("stan", spot))
        .isEqualTo(
            """
            # npcs.stan
            home:
              world: minecraft:overworld
              x: 12.35
              y: 64.00
              z: -3.50
              yaw: 91.3
              pitch: -10.0\
            """);
  }
}
