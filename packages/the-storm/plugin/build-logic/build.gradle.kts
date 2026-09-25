plugins { `kotlin-dsl` }

dependencies {
  implementation(plugin(libs.plugins.errorprone))
  implementation(plugin(libs.plugins.spotless))
  implementation(plugin(libs.plugins.shadow))
  implementation(plugin(libs.plugins.run.paper))
  // jOOQ codegen runs in-process: Flyway migrates a scratch SQLite file, then
  // jOOQ reads its real schema. No DDL interpretation, so generated types match
  // what SQLite actually stores.
  implementation(libs.jooq.codegen)
  implementation(libs.flyway.core)
  implementation(libs.sqlite.jdbc)
}

fun plugin(provider: Provider<PluginDependency>): Provider<String> =
    provider.map { "${it.pluginId}:${it.pluginId}.gradle.plugin:${it.version.requiredVersion}" }
