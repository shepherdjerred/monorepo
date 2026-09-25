import java.nio.file.Files
import org.flywaydb.core.Flyway
import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.provider.Property
import org.gradle.api.tasks.CacheableTask
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction
import org.jooq.codegen.GenerationTool
import org.jooq.meta.jaxb.Configuration
import org.jooq.meta.jaxb.Database
import org.jooq.meta.jaxb.Generate
import org.jooq.meta.jaxb.Generator
import org.jooq.meta.jaxb.Jdbc
import org.jooq.meta.jaxb.Target

/** Migrates a scratch SQLite database with the module's Flyway scripts, then runs jOOQ codegen. */
@CacheableTask
abstract class GenerateJooq : DefaultTask() {
  @get:InputDirectory
  @get:PathSensitive(PathSensitivity.RELATIVE)
  abstract val migrations: DirectoryProperty

  @get:Input abstract val module: Property<String>

  @get:Input abstract val packageName: Property<String>

  @get:OutputDirectory abstract val outputDirectory: DirectoryProperty

  @TaskAction
  fun generate() {
    val output = outputDirectory.get().asFile
    output.deleteRecursively()
    val scratch = Files.createTempFile(temporaryDir.toPath(), "schema", ".db")
    val url = "jdbc:sqlite:$scratch"
    val thread = Thread.currentThread()
    val previous = thread.contextClassLoader
    // Flyway and jOOQ discover their plugins through the context class loader.
    thread.contextClassLoader = GenerateJooq::class.java.classLoader
    try {
      Flyway.configure(GenerateJooq::class.java.classLoader)
          .dataSource(url, null, null)
          .locations("filesystem:${migrations.get().asFile.absolutePath}")
          .table("flyway_${module.get()}_history")
          .load()
          .migrate()
      GenerationTool.generate(
          Configuration()
              .withJdbc(Jdbc().withDriver("org.sqlite.JDBC").withUrl(url))
              .withGenerator(
                  Generator()
                      .withDatabase(
                          Database()
                              .withName("org.jooq.meta.sqlite.SQLiteDatabase")
                              .withExcludes("flyway_.*|sqlite_.*"))
                      .withGenerate(
                          Generate()
                              .withRecords(true)
                              .withImmutablePojos(false)
                              .withPojos(false)
                              .withJavaTimeTypes(true)
                              .withGeneratedAnnotation(false))
                      .withTarget(
                          Target()
                              .withPackageName(packageName.get())
                              .withDirectory(output.absolutePath))))
    } finally {
      thread.contextClassLoader = previous
      Files.deleteIfExists(scratch)
    }
  }
}
