plugins { id("storm.jooq-conventions") }

dependencies {
  implementation(project(":economy"))
  implementation(project(":world"))
}
