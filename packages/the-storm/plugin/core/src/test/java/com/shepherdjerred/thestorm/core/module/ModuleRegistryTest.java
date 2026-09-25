package com.shepherdjerred.thestorm.core.module;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class ModuleRegistryTest {

  private record FakeModule(String id) implements StormModule {
    @Override
    public void enable(ModuleContext context) {}
  }

  private static final StormModule ECONOMY = new FakeModule("economy");
  private static final StormModule TOWNS = new FakeModule("towns");

  @Test
  void selectsEnabledModulesInRegistrationOrder() {
    var toggles = new ModuleToggles(Map.of("economy", true, "towns", false));

    assertThat(ModuleRegistry.select(List.of(ECONOMY, TOWNS), toggles))
        .isEqualTo(Result.ok(List.of(ECONOMY)));
  }

  @Test
  void rejectsMissingAndUnknownToggles() {
    var toggles = new ModuleToggles(Map.of("economy", true, "tons", true));

    assertThat(ModuleRegistry.select(List.of(ECONOMY, TOWNS), toggles))
        .isEqualTo(
            Result.err(
                List.of(
                    "config.yml modules is missing 'towns'",
                    "config.yml modules names unknown module 'tons'")));
  }

  @Test
  void rejectsDuplicateIds() {
    var toggles = new ModuleToggles(Map.of("economy", true));

    assertThat(ModuleRegistry.select(List.of(ECONOMY, new FakeModule("economy")), toggles))
        .isEqualTo(Result.err(List.of("module id 'economy' is registered twice")));
  }
}
