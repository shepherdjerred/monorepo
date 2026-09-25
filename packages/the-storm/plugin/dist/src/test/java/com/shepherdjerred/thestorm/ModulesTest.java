package com.shepherdjerred.thestorm;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.module.StormModule;
import com.tngtech.archunit.core.domain.JavaModifier;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

final class ModulesTest {

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
  void moduleIdsAreUnique() {
    var ids = Modules.all().stream().map(StormModule::id).toList();
    assertThat(ids).doesNotHaveDuplicates();
  }
}
