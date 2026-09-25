package com.shepherdjerred.thestorm.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Optional;

/**
 * The layering rules every module follows. Each module has {@code domain} (pure rules and data),
 * {@code app} (use cases and the ports other modules may call) and {@code adapter} (Paper, storage,
 * network).
 */
@AnalyzeClasses(
    packages = ArchitectureTest.BASE,
    importOptions = ImportOption.DoNotIncludeTests.class)
final class ArchitectureTest {

  static final String BASE = "com.shepherdjerred.thestorm";

  @ArchTest
  static final ArchRule DOMAIN_IS_PURE =
      noClasses()
          .that()
          .resideInAPackage("..domain..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage(
              "org.bukkit..",
              "io.papermc..",
              "net.kyori..",
              "org.jooq..",
              "java.sql..",
              "com.zaxxer..",
              "org.flywaydb..",
              "tools.jackson..",
              "net.dv8tion..")
          .allowEmptyShould(true)
          .because("domain logic must be testable without a server, database or network");

  @ArchTest
  static final ArchRule DOMAIN_STAYS_INSIDE_ITS_MODULE =
      classes()
          .that()
          .resideInAPackage(BASE + ".*.domain..")
          .should(dependOnlyOnJdkCoreResultAndOwnModule())
          .allowEmptyShould(true)
          .because(
              "a domain may use the JDK, core.result and its own module's domain and app value"
                  + " types, nothing else");

  @ArchTest
  static final ArchRule PAPER_ADAPTERS_NEVER_BLOCK =
      noClasses()
          .that()
          .resideInAPackage("..adapter.paper..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("java.sql..", "java.net..", "java.nio.file..", "org.jooq..")
          .orShould()
          .callMethod(Thread.class, "sleep", long.class)
          .allowEmptyShould(true)
          .because("listeners and commands run on the main thread");

  @ArchTest
  static final ArchRule SCHEDULING_GOES_THROUGH_THE_PORT =
      noClasses()
          .that()
          .resideOutsideOfPackage(BASE + ".core..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("org.bukkit.scheduler..")
          .because("modules schedule through core's Scheduler port");

  @ArchTest
  static final ArchRule NO_INTERNAL_PAPER_API =
      noClasses()
          .should()
          .dependOnClassesThat()
          .areAnnotatedWith("org.jetbrains.annotations.ApiStatus$Internal")
          .because("Paper internals change without notice");

  @ArchTest
  static final ArchRule MODULES_MEET_ONLY_THROUGH_APP =
      classes()
          .that()
          .resideInAPackage(BASE + "..")
          .should(useOtherModulesOnlyThroughApp())
          .allowEmptyShould(true);

  @ArchTest
  static final ArchRule NO_MODULE_CYCLES =
      slices().matching(BASE + ".(*)..").should().beFreeOfCycles();

  private static ArchCondition<JavaClass> useOtherModulesOnlyThroughApp() {
    return new ArchCondition<>("use other modules only through their app package") {
      @Override
      public void check(JavaClass item, ConditionEvents events) {
        var own = moduleOf(item.getPackageName());
        if (own.isEmpty()) {
          return;
        }
        for (var dependency : item.getDirectDependenciesFromSelf()) {
          var targetPackage = dependency.getTargetClass().getPackageName();
          var target = moduleOf(targetPackage);
          if (target.isEmpty() || target.equals(own) || target.get().equals("core")) {
            continue;
          }
          if (!targetPackage.startsWith(BASE + "." + target.get() + ".app")) {
            events.add(SimpleConditionEvent.violated(dependency, dependency.getDescription()));
          }
        }
      }
    };
  }

  private static ArchCondition<JavaClass> dependOnlyOnJdkCoreResultAndOwnModule() {
    return new ArchCondition<>("depend only on the JDK, core.result and its own module") {
      @Override
      public void check(JavaClass item, ConditionEvents events) {
        var own = moduleOf(item.getPackageName()).orElseThrow();
        for (var dependency : item.getDirectDependenciesFromSelf()) {
          var target = dependency.getTargetClass();
          if (target.isPrimitive() || target.isArray()) {
            continue;
          }
          var targetPackage = target.getPackageName();
          var allowed =
              targetPackage.startsWith("java.")
                  || targetPackage.startsWith("org.jspecify.")
                  || targetPackage.startsWith(BASE + ".core.result")
                  || targetPackage.startsWith(BASE + "." + own + ".domain")
                  || targetPackage.startsWith(BASE + "." + own + ".app");
          if (!allowed) {
            events.add(SimpleConditionEvent.violated(dependency, dependency.getDescription()));
          }
        }
      }
    };
  }

  private static Optional<String> moduleOf(String packageName) {
    if (!packageName.startsWith(BASE + ".")) {
      return Optional.empty();
    }
    var rest = packageName.substring(BASE.length() + 1);
    var dot = rest.indexOf('.');
    return Optional.of(dot < 0 ? rest : rest.substring(0, dot));
  }
}
