import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.io.File
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.zip.ZipFile
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.gradle.api.artifacts.component.ModuleComponentIdentifier
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class RustNoticeAssets : DefaultTask() {
    @get:InputFiles abstract val producerInputs: ConfigurableFileCollection
    @get:InputFile abstract val producerScript: RegularFileProperty
    @get:OutputDirectory abstract val stagingDirectory: DirectoryProperty
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
    @get:Inject abstract val executor: ExecOperations
    @TaskAction fun generate() {
        executor.exec {
            commandLine("bun", producerScript.get().asFile.absolutePath, "--platform", "android", "--output-dir", stagingDirectory.get().asFile.absolutePath)
        }
        val output = outputDirectory.get().asFile.toPath()
        Files.createDirectories(output)
        for (name in listOf("ThirdPartyNotices.txt", "native-license-inventory.json")) {
            Files.copy(stagingDirectory.get().file(name).asFile.toPath(), output.resolve(name), StandardCopyOption.REPLACE_EXISTING)
        }
    }
}

abstract class FirstPartyLicenseAssets : DefaultTask() {
    @get:InputFile abstract val licenseFile: RegularFileProperty
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
    @TaskAction fun generate() {
        val output = outputDirectory.get().asFile.toPath()
        Files.createDirectories(output)
        Files.copy(licenseFile.get().asFile.toPath(), output.resolve("FirstPartyLicense.txt"), StandardCopyOption.REPLACE_EXISTING)
    }
}

plugins { id("com.android.application"); id("org.jetbrains.kotlin.plugin.compose") }

// Use the exact bundletool graph resolved by the pinned Android Gradle plugin;
// no independently downloaded or separately versioned release tool.
tasks.register<JavaExec>("validateReleaseBundle") {
    group = "verification"
    if (!providers.gradleProperty("facetBundle").isPresent) dependsOn("bundleRelease")
    classpath = rootProject.buildscript.configurations.getByName("classpath")
    mainClass.set("com.android.tools.build.bundletool.BundleToolMain")
    val bundle = providers.gradleProperty("facetBundle").orElse(
        layout.buildDirectory.file("outputs/bundle/release/app-release.aab").map { it.asFile.absolutePath }
    )
    inputs.file(bundle)
    args("validate", "--bundle=${bundle.get()}")
}
tasks.register<JavaExec>("dumpReleaseManifest") {
    group = "verification"
    if (!providers.gradleProperty("facetBundle").isPresent) dependsOn("bundleRelease")
    classpath = rootProject.buildscript.configurations.getByName("classpath")
    mainClass.set("com.android.tools.build.bundletool.BundleToolMain")
    val bundle = providers.gradleProperty("facetBundle").orElse(
        layout.buildDirectory.file("outputs/bundle/release/app-release.aab").map { it.asFile.absolutePath }
    )
    inputs.file(bundle)
    args("dump", "manifest", "--bundle=${bundle.get()}", "--module=base")
}
android {
    namespace = "red.sjer.facet"
    compileSdk = 37
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "red.sjer.facet"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    packaging { jniLibs { useLegacyPackaging = false } }
    buildTypes { release { isDebuggable = false; isMinifyEnabled = true; isShrinkResources = true; proguardFiles("proguard-rules.pro") } }
}
kotlin { compilerOptions { allWarningsAsErrors.set(true) } }
val firstPartyLicense = tasks.register<FirstPartyLicenseAssets>("generateFirstPartyLicenseAssets") {
    licenseFile.set(rootProject.layout.projectDirectory.file("../../LICENSE"))
    outputDirectory.set(layout.buildDirectory.dir("generated/first-party-license-assets"))
}
val rustNotices = tasks.register<RustNoticeAssets>("generateRustNoticeAssets") {
    producerScript.set(rootProject.layout.projectDirectory.file("../tasknotes-macos/scripts/generate-native-notices.ts"))
    producerInputs.from(rootProject.fileTree("../tasknotes-core") { include("Cargo.toml", "Cargo.lock", "crates/*/Cargo.toml", "xtask/Cargo.toml") })
    producerInputs.from(rootProject.fileTree("../tasknotes-macos/scripts/license-texts"))
    stagingDirectory.set(layout.buildDirectory.dir("generated/rust-notices"))
    outputDirectory.set(layout.buildDirectory.dir("generated/rust-notice-assets"))
}
androidComponents.onVariants { variant ->
    variant.hostTests.values.forEach { it.sources.resources?.addStaticSourceDirectory("../../tasknotes-fixtures") }
    variant.sources.assets?.addGeneratedSourceDirectory(firstPartyLicense, FirstPartyLicenseAssets::outputDirectory)
    variant.sources.assets?.addGeneratedSourceDirectory(rustNotices, RustNoticeAssets::outputDirectory)
}
dependencies {
    implementation(project(":host"))
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.10.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.10.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}


abstract class HostNoticeAssets : DefaultTask() {
    @get:InputFiles abstract val artifacts: ConfigurableFileCollection
    @get:InputFiles abstract val pomFiles: ConfigurableFileCollection
    @get:Input abstract val coordinates: MapProperty<String, String>
    @get:InputDirectory abstract val jnaNotices: DirectoryProperty
    @get:InputFile abstract val apacheLicense: RegularFileProperty
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty

    companion object {
        fun document(pom: File): org.w3c.dom.Document {
            val factory = DocumentBuilderFactory.newInstance()
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false)
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false)
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "")
            factory.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "")
            return factory.newDocumentBuilder().parse(pom)
        }
        fun parentPom(pom: File): File? {
            val parents = document(pom).getElementsByTagName("parent")
            if (parents.length == 0) return null
            val parent = parents.item(0) as org.w3c.dom.Element
            val parts = listOf("groupId", "artifactId", "version").map { parent.getElementsByTagName(it).item(0).textContent }
            require(parts.all { it.matches(Regex("[A-Za-z0-9_.-]+")) }) { "Unsupported inherited Maven license coordinate." }
            val cache = pom.parentFile.parentFile.parentFile.parentFile.parentFile
            require(cache.name == "files-2.1") { "Maven license metadata is outside the resolved module cache." }
            val matches = cache.resolve(parts.joinToString("/")).walkTopDown().filter { it.isFile && it.extension == "pom" }.toList()
            require(matches.isNotEmpty()) { "Inherited license POM is missing: ${parts.joinToString(":")}." }
            val hashes = matches.map { MessageDigest.getInstance("SHA-256").digest(it.readBytes()).toList() }.distinct()
            require(hashes.size == 1) { "Inherited POM versions disagree." }
            return matches.first()
        }
        fun pomClosure(pom: File): List<File> {
            val result = mutableListOf<File>()
            var current: File? = pom
            while (current != null) {
                require(result.size < 16 && current !in result) { "Cyclic inherited license metadata." }
                result.add(current)
                current = parentPom(current)
            }
            return result
        }
    }

    private fun digest(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    private fun bounded(input: java.io.InputStream): ByteArray {
        val bytes = input.readNBytes(1048577)
        require(bytes.size <= 1048576) { "Dependency notice exceeds its bound." }
        return bytes
    }
    private fun noticeName(name: String): Boolean {
        val basename = name.substringAfterLast('/').lowercase()
        return listOf("license", "notice", "copying").any { basename.startsWith(it) } || basename in setOf("al2.0", "lgpl2.1")
    }
    private fun embedded(file: File): Map<String, ByteArray> {
        val texts = mutableMapOf<String, ByteArray>()
        ZipFile(file).use { zip ->
            for (entry in zip.entries().asSequence().filter { !it.isDirectory }) {
                if (noticeName(entry.name)) zip.getInputStream(entry).use { texts[entry.name] = bounded(it) }
                else if (entry.name == "classes.jar") {
                    ZipInputStream(zip.getInputStream(entry)).use { nested ->
                        while (true) {
                            val child = nested.nextEntry ?: break
                            if (!child.isDirectory && noticeName(child.name)) texts["classes.jar/${child.name}"] = bounded(nested)
                            nested.closeEntry()
                        }
                    }
                }
            }
        }
        return texts
    }
    private fun licenses(pom: File): List<Map<String, String>> {
        val nodes = document(pom).getElementsByTagName("license")
        if (nodes.length == 0) {
            val inherited = requireNotNull(parentPom(pom)) { "Dependency has no declared license: ${pom.name}." }
            require(inherited in pomFiles.files) { "Inherited license source is not a declared task input." }
            return licenses(inherited)
        }
        return (0 until nodes.length).map { index ->
            val element = nodes.item(index) as org.w3c.dom.Element
            mapOf("name" to element.getElementsByTagName("name").item(0).textContent,
                "url" to (element.getElementsByTagName("url").item(0)?.textContent ?: ""))
        }.also { require(it.isNotEmpty()) { "Dependency has no declared license: ${pom.name}." } }
    }
    @TaskAction fun generate() {
        val sections = mutableListOf("Facet Android host notices\nGenerated from this variant's resolved runtime artifacts and Maven POMs.\n")
        val inventory = mutableListOf<Map<String, Any>>()
        val jnaCatalog = JsonSlurper().parse(jnaNotices.get().file("sources.json").asFile) as? Map<*, *>
            ?: error("Invalid pinned JNA notice inventory.")
        require(jnaCatalog["coordinate"] == "net.java.dev.jna:jna:5.18.1")
        val jnaFiles = jnaCatalog["files"] as? List<*> ?: error("JNA notice sources are missing.")
        for (raw in jnaFiles) {
            val source = raw as? Map<*, *> ?: error("Invalid JNA notice source.")
            val name = source["file"] as? String ?: error("JNA notice file is missing.")
            require(name.matches(Regex("[A-Za-z0-9_.-]+\\.txt")))
            require(digest(jnaNotices.get().file(name).asFile.readBytes()) == source["sha256"]) { "Pinned JNA notice bytes changed." }
        }
        val poms = pomFiles.files.groupBy { pom ->
            val version = pom.parentFile.parentFile
            "${version.parentFile.parentFile.name}:${version.parentFile.name}:${version.name}"
        }
        for (artifact in artifacts.files.sortedBy { coordinates.get().getValue(it.absolutePath) }) {
            val coordinate = coordinates.get().getValue(artifact.absolutePath)
            val candidates = requireNotNull(poms[coordinate]) { "Resolved dependency POM is missing: $coordinate." }
            require(candidates.map { digest(it.readBytes()) }.distinct().size == 1) { "Resolved POM sources disagree: $coordinate." }
            val pom = candidates.first()
            val declarations = licenses(pom)
            val texts = embedded(artifact).toMutableMap()
            var missingPackageText = texts.isEmpty()
            sections.add("\n===== $coordinate =====\nDeclared licenses: ${declarations.joinToString { it.getValue("name") }}\n")
            if (coordinate == "net.java.dev.jna:jna:5.18.1") {
                for (file in jnaNotices.get().asFile.listFiles().orEmpty().filter { it.extension == "txt" }) texts["upstream-5.18.1/${file.name}"] = file.readBytes()
                sections.add("JNA notices and bundled libffi copyright are retained from the exact 5.18.1 upstream source; provenance hashes are bundled.\n")
                missingPackageText = false
            }
            if (texts.isEmpty()) {
                require(declarations.any { it.getValue("name").contains("Apache", ignoreCase = true) && it.getValue("url").contains("2.0") }) { "Dependency omits license text without a supported declared canonical license: $coordinate." }
                texts["canonical-declared-Apache-2.0.txt"] = apacheLicense.get().asFile.readBytes()
                sections.add("The artifact omits package license text; canonical text for its declared Apache 2.0 license is included. This does not invent package copyright notices.\n")
            }
            for ((name, bytes) in texts.toSortedMap()) {
                val text = Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString()
                sections.add("\n--- $name ---\n$text\n")
            }
            inventory.add(mapOf("coordinate" to coordinate, "artifactSHA256" to digest(artifact.readBytes()),
                "pomSHA256" to digest(pom.readBytes()), "licenseMetadata" to pomClosure(pom).map { source -> mapOf("file" to source.name, "sha256" to digest(source.readBytes())) },
                "licenses" to declarations, "missingPackageText" to missingPackageText,
                "texts" to texts.toSortedMap().map { (name, bytes) -> mapOf("name" to name, "sha256" to digest(bytes)) }))
        }
        val output = outputDirectory.get().asFile.apply { check(isDirectory || mkdirs()) }
        output.resolve("HostThirdPartyNotices.txt").writeText(sections.joinToString(""))
        output.resolve("host-license-inventory.json").writeText(JsonOutput.prettyPrint(JsonOutput.toJson(mapOf("schemaVersion" to 1, "dependencies" to inventory))))
        jnaNotices.get().file("sources.json").asFile.copyTo(output.resolve("jna-notice-sources.json"), overwrite = true)
    }
}

androidComponents.onVariants { variant ->
    val runtime = configurations.named("${variant.name}RuntimeClasspath")
    val resolved = runtime.map { configuration -> configuration.incoming.artifactView {
        componentFilter { it is ModuleComponentIdentifier }
    }.artifacts.artifacts }
    val notices = tasks.register<HostNoticeAssets>("generate${variant.name.replaceFirstChar(Char::uppercase)}HostNoticeAssets") {
        artifacts.from(resolved.map { it.map { artifact -> artifact.file } })
        coordinates.set(resolved.map { it.associate { artifact ->
            val module = artifact.id.componentIdentifier as ModuleComponentIdentifier
            artifact.file.absolutePath to "${module.group}:${module.module}:${module.version}"
        } })
        pomFiles.from(resolved.map { it.flatMap { artifact -> artifact.file.parentFile.parentFile.walkTopDown().filter { file -> file.isFile && file.extension == "pom" }.flatMap { HostNoticeAssets.pomClosure(it).asSequence() }.toList() }.distinct() })
        jnaNotices.set(rootProject.layout.projectDirectory.dir("licenses/jna-5.18.1"))
        apacheLicense.set(rootProject.layout.projectDirectory.file("../tasknotes-macos/scripts/license-texts/Apache-2.0.txt"))
        outputDirectory.set(layout.buildDirectory.dir("generated/${variant.name}-host-notice-assets"))
    }
    variant.sources.assets?.addGeneratedSourceDirectory(notices, HostNoticeAssets::outputDirectory)
}
