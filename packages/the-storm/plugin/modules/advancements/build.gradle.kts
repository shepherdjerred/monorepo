plugins { id("storm.module-conventions") }

dependencies {
  implementation(project(":quests"))
  implementation(project(":towns"))
  implementation(project(":shards"))
  implementation(project(":tracks"))
  implementation(project(":skills"))
  implementation(project(":arena"))
  implementation(project(":spells"))
  implementation(project(":rwf"))
  implementation(project(":essentials"))
}
