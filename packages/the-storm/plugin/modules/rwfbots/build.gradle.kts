import java.nio.file.Path

plugins { id("storm.jooq-conventions") }

dependencies {
  // Bots fill rwf matches through its app ports (BotBodies, BotActions, MatchView, MatchEvents).
  implementation(project(":rwf"))
  implementation(libs.onnxruntime)
  // Citizens is a runtime plugin (server/plugins.json); only rwfbots.adapter.citizens
  // may use it here (architecture tests). Non-transitive: the plugin jar is the API.
  compileOnly(libs.citizens) { isTransitive = false }
  testCompileOnly(libs.citizens) { isTransitive = false }
}

// The Java Flipt identifiers of the chat flag must agree with the shared managed flag inventory.
val verifyManagedChatFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedChatFlag") {
      inventory =
          layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
      source =
          layout.projectDirectory.file(
              "src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/remote/FliptChatGate.java")
      flagSource = "the-storm-rwfbots-chat"
    }

tasks.named("compileJava") { dependsOn(verifyManagedChatFlag) }

val verifyManagedLearningFlag =
    tasks.register<VerifyManagedFlag>("verifyManagedLearningFlag") {
      inventory = layout.projectDirectory.file("../../../../feature-flags/src/managed-flag-inventory.json")
      source = layout.projectDirectory.file(
          "src/main/java/com/shepherdjerred/thestorm/rwfbots/adapter/remote/FliptLearningGate.java")
      flagSource = "the-storm-rwfbots-learning"
    }
tasks.named("compileJava") { dependsOn(verifyManagedLearningFlag) }

// The shipped personality files and rwfbots.yml are parsed by tests, so they are test inputs.
val shippedPersonalities = file("../../../server/owned/plugins/TheStorm/rwfbots/personalities")
val shippedConfig = file("../../../server/owned/plugins/TheStorm/rwfbots.yml")
// The training yard's baked nav artifact: the headless sim plays on it as well as SyntheticMap.
val trainingYardNav =
    file("../../../server/owned/plugins/TheStorm/rwf/maps/training-yard/nav.rwfnav")

tasks.test {
  dependsOn("prepareActorParity")
  inputs.dir(layout.buildDirectory.dir("actor-parity"))
      .withPropertyName("actorParity").withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(shippedPersonalities)
      .withPropertyName("shippedPersonalities")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .file(shippedConfig)
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwfbots.personalities", shippedPersonalities.absolutePath)
  inputs
      .file(trainingYardNav)
      .withPropertyName("trainingYardNav")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  systemProperty("thestorm.rwfbots.config", shippedConfig.absolutePath)
  systemProperty("thestorm.rwfbots.trainingYardNav", trainingYardNav.absolutePath)
  systemProperty("thestorm.rwfbots.actorParity", layout.buildDirectory.dir("actor-parity").get().asFile.absolutePath)
}

val prepareActorParity = tasks.register<Exec>("prepareActorParity") {
  val learning = rootProject.file("../tools/learning")
  val output = layout.buildDirectory.dir("actor-parity")
  inputs.files(fileTree(learning) { include("*.py", "*.json", "*.toml", "*.lock", "promotion/*.py") })
      .withPropertyName("pythonActorTools").withPathSensitivity(PathSensitivity.RELATIVE)
  inputs.files("src/main/resources/rwf-combat-v1.tsv", "src/main/resources/rwf-duel.json", "src/main/resources/rwf-actor-parity.json")
      .withPropertyName("actorContracts").withPathSensitivity(PathSensitivity.RELATIVE)
  outputs.dir(output)
  doFirst {
    val generated = output.get().asFile
    check(!generated.exists() || generated.deleteRecursively()) { "Could not clear generated actor parity fixture" }
  }
  commandLine("uv", "run", "--project", learning, "--locked", "python", learning.resolve("java_parity.py"), "--output", output.get().asFile)
}

tasks.register<JavaExec>("actorParity") {
  classpath = sourceSets.main.get().runtimeClasspath
  mainClass.set("com.shepherdjerred.thestorm.rwfbots.adapter.inference.ActorParity")
  val directory = providers.gradleProperty("actorParityDirectory")
  val receipt = providers.gradleProperty("actorParityReceipt")
  doFirst {
    val samples = Path.of(directory.get())
    args(samples.resolve("onnx").toString(), samples.resolve("samples.json").toString())
    receipt.orNull?.let { args(it) }
  }
}

// Exclusive offline promotion; never enables ordinary-match inference or publishes the artifact.
tasks.register<JavaExec>("actorPromotion") {
  classpath = sourceSets.main.get().runtimeClasspath
  mainClass.set("com.shepherdjerred.thestorm.rwfbots.adapter.inference.promotion.PromotionBundle")
  val directory = providers.gradleProperty("actorPromotionDirectory")
  val source = providers.gradleProperty("actorPromotionSource")
  doFirst { args(directory.get(), source.get()) }
}
