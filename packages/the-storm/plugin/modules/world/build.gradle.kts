plugins { id("storm.jooq-conventions") }

val verifyManagedCrierFlag =
    tasks.register<VerifyManagedCrierFlag>("verifyManagedCrierFlag") {
      inventory =
          layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
      clientSource =
          layout.projectDirectory.file(
              "src/main/java/com/shepherdjerred/thestorm/world/adapter/remote/FliptCrierGate.java")
  }

tasks.named("compileJava") { dependsOn(verifyManagedCrierFlag) }
