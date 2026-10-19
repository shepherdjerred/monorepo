package com.shepherdjerred.thestorm.qol.domain.travel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.core.config.StrictYaml;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

final class TravelConfigTest {

  private static final TravelDestination FRONTIER =
      new TravelDestination("frontier", "Frontier", "Wilderness", "frontier", "rtp");
  private static final TravelDestination SKYLANDS =
      new TravelDestination("skylands", "Skylands", "Islands", "skylands", "spawn");

  @Test
  void theShippedFileParsesWithFrontierFirst() throws Exception {
    var path = Path.of("../../../server/owned/plugins/TheStorm/travel.yml");
    var config =
        StrictYaml.parse(path.toString(), Files.readString(path), TravelConfig.class)
            .fold(
                ok -> ok,
                err -> {
                  throw new AssertionError(err.toString());
                });
    assertThat(config.hubWorld()).isEqualTo("world");
    assertThat(config.destinations().getFirst().world()).isEqualTo("frontier");
    assertThat(config.destinations().getFirst().random()).isTrue();
    assertThat(config.destinations())
        .extracting(TravelDestination::world)
        .containsExactly("frontier", "skylands", "map2", "wilds", "peaks")
        .doesNotContain("world_nether", "world_the_end");
  }

  @Test
  void aPortalSendsOnlyFromTheHubWorld() {
    var portal = new TravelPortal("skylands", new HubPoint(10, 64, 10), new HubPoint(12, 67, 10));
    var config = new TravelConfig("world", List.of(FRONTIER, SKYLANDS), List.of(portal));
    assertThat(config.portalAt("world", new HubPoint(11, 65, 10))).contains(SKYLANDS);
    assertThat(config.portalAt("world", new HubPoint(13, 65, 10))).isEmpty();
    assertThat(config.portalAt("map2", new HubPoint(11, 65, 10))).isEmpty();
  }

  @Test
  void portalsMustNameADestinationAndNotOverlap() {
    var a = new TravelPortal("frontier", new HubPoint(0, 64, 0), new HubPoint(2, 66, 0));
    var b = new TravelPortal("skylands", new HubPoint(2, 64, 0), new HubPoint(4, 66, 0));
    assertThatThrownBy(() -> new TravelConfig("world", List.of(FRONTIER, SKYLANDS), List.of(a, b)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("overlap");
    var stray = new TravelPortal("peaks", new HubPoint(0, 64, 0), new HubPoint(1, 65, 0));
    assertThatThrownBy(() -> new TravelConfig("world", List.of(FRONTIER), List.of(stray)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("unknown destination");
  }

  @Test
  void destinationsAreUniqueAndTheHubSpawnIsNotOne() {
    assertThatThrownBy(() -> new TravelConfig("world", List.of(FRONTIER, FRONTIER), List.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("listed twice");
    var home = new TravelDestination("home", "Home", "Spawn", "world", "spawn");
    assertThatThrownBy(() -> new TravelConfig("world", List.of(home), List.of()))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("already the hub");
    assertThatThrownBy(() -> new TravelDestination("x", "X", "X", "x", "portal"))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void portalsStayHubSized() {
    assertThatThrownBy(
            () -> new TravelPortal("frontier", new HubPoint(0, 0, 0), new HubPoint(16, 0, 0)))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
