plugins { id("storm.module-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

// LuckPerms is on the server; tracks grant levels as LuckPerms groups.
dependencies { compileOnly(libs.findLibrary("luckperms-api").get()) }
