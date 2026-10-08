plugins { id("com.android.library") }
android {
    namespace = "red.sjer.facet.bindings"
    compileSdk = 37
    defaultConfig { minSdk = 29; ndk { abiFilters += listOf("arm64-v8a", "x86_64") } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
androidComponents.onVariants { variant ->
    variant.sources.kotlin?.addStaticSourceDirectory("../../tasknotes-core/bindings/kotlin")
    variant.sources.jniLibs?.addStaticSourceDirectory("../build/rust-jni")
}
dependencies { api("net.java.dev.jna:jna:5.18.1@aar") }
