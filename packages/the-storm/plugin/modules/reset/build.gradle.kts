plugins { id("storm.jooq-conventions") }

val libs = the<VersionCatalogsExtension>().named("libs")

dependencies { compileOnly(libs.findLibrary("luckperms-api").get()) }
