package com.shepherdjerred.thestorm.architecture;

import static com.tngtech.archunit.base.DescribedPredicate.not;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAPackage;
import static com.tngtech.archunit.core.domain.JavaClass.Predicates.resideInAnyPackage;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.base.DescribedPredicate;
import com.tngtech.archunit.core.domain.JavaClass;
import com.tngtech.archunit.core.domain.JavaConstructorCall;
import com.tngtech.archunit.core.domain.JavaMethodCall;
import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchCondition;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.lang.ConditionEvents;
import com.tngtech.archunit.lang.SimpleConditionEvent;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ForkJoinPool;
import java.util.concurrent.Future;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

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
              "net.dv8tion..",
              "net.citizensnpcs..")
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
  static final ArchRule CITIZENS_STAYS_IN_ITS_ADAPTERS =
      noClasses()
          .that()
          .resideOutsideOfPackages(
              "..npcs.adapter.paper..",
              "..companions.adapter.paper..",
              "..rwfbots.adapter.citizens..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("net.citizensnpcs..")
          .because(
              "Citizens bodies are bound only by the npcs and companions Paper adapters and"
                  + " rwfbots.adapter.citizens; domains, apps and every other module stay free of it");

  @ArchTest
  static final ArchRule CITIZENS_ADAPTER_USES_ONLY_THE_API_AND_TRAITS =
      noClasses()
          .that()
          .resideInAPackage("..rwfbots.adapter.citizens..")
          .should()
          .dependOnClassesThat(
              resideInAPackage("net.citizensnpcs..")
                  .and(
                      not(
                          resideInAnyPackage(
                              "net.citizensnpcs.api..", "net.citizensnpcs.trait.."))))
          .allowEmptyShould(true)
          .because(
              "net.citizensnpcs.api and the trait classes are the supported surface; the rest of"
                  + " citizens-main is internal and must never be reached into or copied");

  @ArchTest
  static final ArchRule NO_SERVER_INTERNALS =
      noClasses()
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("net.minecraft..", "org.bukkit.craftbukkit..")
          .because(
              "NMS and CraftBukkit change with every Minecraft version; Paper's API and Citizens"
                  + " exist to hide them");

  @ArchTest
  static final ArchRule RWFBOTS_APP_NEVER_TOUCHES_THE_SERVER =
      noClasses()
          .that()
          .resideInAPackage("..rwfbots.app..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("org.bukkit..", "io.papermc..")
          .allowEmptyShould(true)
          .because(
              "rwfbots.app decides bot behaviour on worker threads; it reaches the server only"
                  + " through ports its adapters implement on the main thread");

  @ArchTest
  static final ArchRule PAPER_ADAPTERS_NEVER_BLOCK =
      noClasses()
          .that()
          .resideInAnyPackage("..adapter.paper..", "..adapter.citizens..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("java.sql..", "java.net..", "java.nio.file..", "org.jooq..")
          .orShould()
          .callMethod(Thread.class, "sleep", long.class)
          .orShould()
          .callMethod(Future.class, "get")
          .orShould()
          .callMethod(Future.class, "get", long.class, TimeUnit.class)
          .orShould()
          .callMethod(FutureTask.class, "get")
          .orShould()
          .callMethod(FutureTask.class, "get", long.class, TimeUnit.class)
          .orShould()
          .callMethod(CompletableFuture.class, "get")
          .orShould()
          .callMethod(CompletableFuture.class, "get", long.class, TimeUnit.class)
          .orShould()
          .callMethod(CompletableFuture.class, "join")
          .allowEmptyShould(true)
          .because("listeners, commands and Citizens NPC bindings run on the main thread");

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
  static final ArchRule THREADS_COME_FROM_CORE =
      noClasses()
          .that()
          .resideOutsideOfPackage(BASE + ".core..")
          .should()
          .callMethodWhere(platformPoolFactory())
          .orShould()
          .callConstructorWhere(constructorOf(Thread.class, ForkJoinPool.class))
          .orShould()
          .callMethod(Thread.class, "ofPlatform")
          .orShould()
          .callMethod(ForkJoinPool.class, "commonPool")
          .orShould()
          .callMethod(CompletableFuture.class, "supplyAsync", Supplier.class)
          .orShould()
          .callMethod(CompletableFuture.class, "runAsync", Runnable.class)
          .because(
              "off-main-thread CPU work runs on core's bounded ComputePool so it is named, capped and"
                  + " closed with the plugin; the common pool and ad-hoc platform threads are"
                  + " neither. Virtual threads (Thread.ofVirtual, Thread.startVirtualThread,"
                  + " Executors.newVirtualThreadPerTaskExecutor) stay allowed: they carry blocking"
                  + " network I/O such as the HTTP brain client and the Discord gateway, which must"
                  + " not occupy one of the pool's few platform threads");

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

  /** Every {@link Executors} factory except the virtual-thread one. */
  private static DescribedPredicate<JavaMethodCall> platformPoolFactory() {
    return new DescribedPredicate<>("create a platform thread pool through Executors") {
      @Override
      public boolean test(JavaMethodCall call) {
        return call.getTargetOwner().isEquivalentTo(Executors.class)
            && !call.getName().equals("newVirtualThreadPerTaskExecutor");
      }
    };
  }

  private static DescribedPredicate<JavaConstructorCall> constructorOf(Class<?>... types) {
    var owners = Set.of(types);
    return new DescribedPredicate<>("construct " + owners) {
      @Override
      public boolean test(JavaConstructorCall call) {
        return owners.stream().anyMatch(call.getTargetOwner()::isEquivalentTo);
      }
    };
  }

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
