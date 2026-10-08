plugins {
    id("com.android.application") version "9.3.3" apply false
    id("com.android.library") version "9.3.3" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.10" apply false
}

val verifyNativeInputs = tasks.register<Exec>("verifyNativeInputs") {
    workingDir(layout.projectDirectory)
    commandLine(
        "bun", "--no-install", "--bun", "vitest", "--config", "../../vitest.config.ts",
        "run", "./scripts/native-inputs.test.ts", "--reporter=default", "--reporter=junit",
        "--outputFile=" + layout.buildDirectory.file("test-results/native-inputs/TEST-native-inputs.xml").get().asFile.absolutePath,
    )
    inputs.files("scripts/native-inputs.ts", "scripts/native-inputs.test.ts", "../../vitest.config.ts", "package.json", "../../bun.lock")
    outputs.file(layout.buildDirectory.file("test-results/native-inputs/TEST-native-inputs.xml"))
}
project(":host").tasks.matching { it.name == "testDebugUnitTest" }.configureEach {
    dependsOn(verifyNativeInputs)
}
