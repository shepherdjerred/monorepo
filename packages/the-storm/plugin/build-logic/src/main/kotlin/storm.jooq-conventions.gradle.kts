// Generates jOOQ sources for a module from its own Flyway migrations
// (src/main/resources/db/migration/<module>), so SQL is typed end to end.
plugins { id("storm.module-conventions") }

val moduleName = project.name

val generateJooq =
    tasks.register<GenerateJooq>("generateJooq") {
      migrations = layout.projectDirectory.dir("src/main/resources/db/migration/$moduleName")
      module = moduleName
      packageName = "com.shepherdjerred.thestorm.$moduleName.adapter.db.generated"
      outputDirectory = layout.buildDirectory.dir("generated/sources/jooq/main")
    }

sourceSets.main { java.srcDir(generateJooq) }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies { implementation(libs.findLibrary("jooq").get()) }
