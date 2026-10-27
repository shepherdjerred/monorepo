package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.compute.ComputeSettings;
import com.shepherdjerred.thestorm.core.config.ConfigFiles;
import com.shepherdjerred.thestorm.core.module.ModuleRegistry;
import com.shepherdjerred.thestorm.core.module.StormModule;
import com.shepherdjerred.thestorm.core.result.Result;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class ModulesTest {

  /** The repository-owned {@code config.yml} the server image writes on every boot. */
  private static final Path SHIPPED_CONFIG =
      Path.of("../../server/owned/plugins/TheStorm/config.yml");

  /** The modules the shipped config enables: every registered module. */
  private static final Set<String> SHIPPED_ENABLED =
      Set.of(
          "agent",
          "arena",
          "chat",
          "companions",
          "creative",
          "discord",
          "economy",
          "essentials",
          "mail",
          "mechanics",
          "messages",
          "mobs",
          "npcs",
          "qol",
          "quests",
          "reset",
          "rwf",
          "rwfbots",
          "safety",
          "seasonal",
          "shards",
          "shops",
          "skills",
          "skylands",
          "spells",
          "stargates",
          "tickets",
          "towns",
          "tracks",
          "world");

  @Test
  void everyModuleOnTheClasspathIsRegisteredOnce() {
    var discovered =
        new ClassFileImporter()
                .withImportOption(new ImportOption.DoNotIncludeTests())
                .importPackages("com.shepherdjerred.thestorm")
                .stream()
                .filter(javaClass -> javaClass.isAssignableTo(StormModule.class))
                .filter(javaClass -> !javaClass.isInterface())
                .filter(javaClass -> !javaClass.getModifiers().contains(JavaModifier.ABSTRACT))
                .map(javaClass -> javaClass.getName())
                .sorted()
                .toList();

    var registered =
        Modules.all().stream().map(module -> module.getClass().getName()).sorted().toList();

    assertThat(registered).containsExactlyElementsOf(discovered);
  }

  @Test
  void theShippedConfigEnablesEveryRegisteredModule() {
    var config = ConfigFiles.load(SHIPPED_CONFIG, PluginConfig.class);
    var registered = ModuleRegistry.ids(Modules.all());

    assertThat(registered).hasSize(29);
    assertThat(config.modules().keySet()).containsExactlyInAnyOrderElementsOf(registered);
    assertThat(
            config.modules().entrySet().stream()
                .filter(entry -> entry.getValue())
                .map(entry -> entry.getKey()))
        .containsExactlyInAnyOrderElementsOf(SHIPPED_ENABLED);
    assertThat(config.modules().values()).allMatch(on -> on);

    var selected =
        switch (ModuleRegistry.select(Modules.all(), config.toggles())) {
          case Result.Ok<List<StormModule>, List<String>>(var modules) -> modules;
          case Result.Err<List<StormModule>, List<String>>(var problems) ->
              throw new AssertionError(problems.toString());
        };
    assertThat(ModuleRegistry.ids(selected)).isEqualTo(SHIPPED_ENABLED);
  }

  @Test
  void moduleIdsAreUnique() {
    var ids = Modules.all().stream().map(StormModule::id).toList();
    assertThat(ids).doesNotHaveDuplicates();
  }

  @Test
  void theShippedComputeCeilingRemainsFour() {
    var config =
        ConfigFiles.load(SHIPPED_CONFIG.resolveSibling("compute.yml"), ComputeSettings.class);
    assertThat(config.maxThreads()).isEqualTo(4);
  }
}
