plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

// BlueMap is on the server; towns draw their claims on the web map.
dependencies { compileOnly(libs.findLibrary("bluemap-api").get()) }
