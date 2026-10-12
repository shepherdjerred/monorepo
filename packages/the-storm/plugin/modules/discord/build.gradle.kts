plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies {
  // Global chat is reached through the chat module's app port.
  implementation(project(":chat"))
  implementation(project(":economy"))
  implementation(project(":towns"))
  // Discord /mail sends letters through the mail module's Letters port.
  implementation(project(":mail"))
  implementation(libs.findLibrary("jda").get()) {
    // Voice is not used; opus natives are large.
    exclude(module = "opus-java")
    exclude(module = "tink")
  }
}
