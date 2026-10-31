plugins { id("storm.jooq-conventions") }

dependencies {
  // Match rewards and kit purchases move Red Warfare credits through the economy module's Wallets
  // port.
  implementation(project(":economy"))
  // Lobbies and results are announced through the discord module's relay port.
  implementation(project(":discord"))
  // Team and dead chat go through the chat module's membership, routing and taps.
  implementation(project(":chat"))
  // The typed jOOQ listener fixture exposes Settings' optional JAXB annotations to javac.
  testCompileOnly(libs.jaxb.api)
}

// The content tests parse the rwf config, kits and maps the server ships.
tasks.test {
  // Candidate visits prepare two disjoint yards concurrently. MockBukkit chunk snapshots allocate
  // blocks across the world's full height, so this fixture exceeds the shared 512m test heap.
  maxHeapSize = "1g"
  // MockBukkit materializes full-height chunk blocks for every snapshot. Bound world/ByteBuddy
  // state by recycling each worker after ten classes instead of sharing one across the whole
  // suite; a fresh JVM per class made rwf the slowest module (264s against 153-185s for ten,
  // which stays within the 1g heap). Retain the same complete test selection and noSkippedTests
  // gate; the shared conventions run several of these forks at once.
  forkEvery = 10
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/rwf.yml"))
      .withPropertyName("shippedConfig")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .file(rootProject.file("../server/owned/plugins/TheStorm/rwf-archive.json"))
      .withPropertyName("archiveContract")
      .withPathSensitivity(PathSensitivity.RELATIVE)
  inputs
      .dir(rootProject.file("../server/owned/plugins/TheStorm/rwf"))
      .withPropertyName("shippedContent")
      .withPathSensitivity(PathSensitivity.RELATIVE)
}
