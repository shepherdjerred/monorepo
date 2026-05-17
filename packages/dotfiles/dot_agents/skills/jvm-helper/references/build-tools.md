# JVM Build Tools and Packaging

Gradle (Kotlin DSL), Maven, GraalVM native-image, jlink, jpackage, and JVM tuning.

## Gradle (Kotlin DSL)

Kotlin DSL is the default for new Gradle builds since Gradle 8.0. Files use `.gradle.kts` extension.

### Basic Project Structure

```
project/
  build.gradle.kts          # Build script
  settings.gradle.kts       # Project settings
  gradle.properties         # Build properties
  gradle/
    libs.versions.toml       # Version catalog
    wrapper/
      gradle-wrapper.properties
  src/
    main/
      java/
      kotlin/
      resources/
    test/
      java/
      kotlin/
      resources/
```

### settings.gradle.kts

```kotlin
rootProject.name = "my-project"

// Multi-module
include("app", "core", "api")

// Plugin management
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// Dependency resolution
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}
```

### build.gradle.kts

```kotlin
plugins {
    kotlin("jvm") version "2.1.0"
    application
}

group = "com.example"
version = "1.0.0"

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    implementation(libs.kotlinx.coroutines)
    implementation(libs.ktor.client.core)
    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
}

tasks.test {
    useJUnitPlatform()
}

application {
    mainClass.set("com.example.MainKt")
}
```

### Version Catalogs (libs.versions.toml)

Centralize dependency versions in `gradle/libs.versions.toml`:

```toml
[versions]
kotlin = "2.1.0"
coroutines = "1.9.0"
ktor = "3.0.0"
junit = "5.11.0"
spring-boot = "3.4.0"

[libraries]
kotlinx-coroutines = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }
ktor-client-core = { module = "io.ktor:ktor-client-core", version.ref = "ktor" }
ktor-client-cio = { module = "io.ktor:ktor-client-cio", version.ref = "ktor" }
junit-jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }

[bundles]
ktor-client = ["ktor-client-core", "ktor-client-cio"]

[plugins]
kotlin-jvm = { id = "org.jetbrains.kotlin.jvm", version.ref = "kotlin" }
spring-boot = { id = "org.springframework.boot", version.ref = "spring-boot" }
```

Reference in build scripts:

```kotlin
plugins {
    alias(libs.plugins.kotlin.jvm)
}

dependencies {
    implementation(libs.kotlinx.coroutines)
    implementation(libs.bundles.ktor.client)
    testImplementation(libs.junit.jupiter)
}
```

### Common Tasks

```kotlin
// Custom task
tasks.register("generateVersion") {
    val outputFile = layout.buildDirectory.file("version.txt")
    outputs.file(outputFile)
    doLast {
        outputFile.get().asFile.writeText(project.version.toString())
    }
}

// Task dependencies
tasks.named("processResources") {
    dependsOn("generateVersion")
}

// Configure existing task
tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-Xlint:all")
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

// Fat JAR / Shadow JAR
plugins {
    id("com.gradleup.shadow") version "8.3.0"
}
tasks.shadowJar {
    archiveClassifier.set("")
    manifest {
        attributes("Main-Class" to "com.example.MainKt")
    }
}
```

### Multi-Module Projects

```kotlin
// root build.gradle.kts
plugins {
    kotlin("jvm") version "2.1.0" apply false
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")

    repositories { mavenCentral() }

    dependencies {
        "testImplementation"(kotlin("test"))
    }
}

// app/build.gradle.kts
plugins {
    application
}

dependencies {
    implementation(project(":core"))
    implementation(project(":api"))
}
```

### Useful Gradle Commands

```bash
# Build
./gradlew build                    # full build
./gradlew build -x test            # skip tests
./gradlew clean build              # clean first
./gradlew assemble                 # compile + package, no tests

# Testing
./gradlew test                     # run all tests
./gradlew test --tests "*.UserTest" # run specific test class
./gradlew test --tests "*UserTest.testCreate" # specific method
./gradlew test --rerun              # force re-run
./gradlew test --fail-fast          # stop on first failure

# Dependencies
./gradlew dependencies             # full dependency tree
./gradlew dependencies --configuration runtimeClasspath
./gradlew dependencyInsight --dependency guava
./gradlew dependencyUpdates        # check for updates (needs plugin)

# Info
./gradlew tasks                    # list available tasks
./gradlew tasks --all              # all tasks including hidden
./gradlew projects                 # list sub-projects
./gradlew properties               # all project properties

# Performance
./gradlew build --build-cache      # use build cache
./gradlew build --parallel         # parallel module builds
./gradlew build --scan             # generate build scan
```

## Maven

### pom.xml Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>my-app</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>

    <properties>
        <java.version>21</java.version>
        <kotlin.version>2.1.0</kotlin.version>
        <maven.compiler.source>${java.version}</maven.compiler.source>
        <maven.compiler.target>${java.version}</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencyManagement>
        <dependencies>
            <!-- BOM for consistent versions -->
            <dependency>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-dependencies</artifactId>
                <version>3.4.0</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <dependencies>
        <dependency>
            <groupId>org.jetbrains.kotlin</groupId>
            <artifactId>kotlin-stdlib</artifactId>
            <version>${kotlin.version}</version>
        </dependency>
        <dependency>
            <groupId>org.junit.jupiter</groupId>
            <artifactId>junit-jupiter</artifactId>
            <version>5.11.0</version>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <version>3.13.0</version>
                <configuration>
                    <release>${java.version}</release>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```

### Maven Profiles

```xml
<profiles>
    <!-- Development profile -->
    <profile>
        <id>dev</id>
        <activation>
            <activeByDefault>true</activeByDefault>
        </activation>
        <properties>
            <spring.profiles.active>dev</spring.profiles.active>
        </properties>
    </profile>

    <!-- Production profile -->
    <profile>
        <id>prod</id>
        <properties>
            <spring.profiles.active>prod</spring.profiles.active>
        </properties>
        <build>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-jar-plugin</artifactId>
                    <configuration>
                        <archive>
                            <manifest>
                                <mainClass>com.example.Main</mainClass>
                            </manifest>
                        </archive>
                    </configuration>
                </plugin>
            </plugins>
        </build>
    </profile>
</profiles>
```

### Common Maven Commands

```bash
# Lifecycle phases
mvn clean                          # delete target/
mvn compile                        # compile main sources
mvn test                           # compile + run tests
mvn package                        # compile + test + package JAR/WAR
mvn verify                         # run integration tests
mvn install                        # install to local repo (~/.m2)
mvn deploy                         # deploy to remote repo

# Skip tests
mvn package -DskipTests            # skip test execution
mvn package -Dmaven.test.skip=true # skip compile + execution

# Profiles
mvn package -Pprod                 # activate prod profile
mvn package -P!dev                 # deactivate dev profile

# Dependencies
mvn dependency:tree                # show dependency tree
mvn dependency:resolve             # resolve and download
mvn dependency:analyze             # find unused/undeclared deps
mvn versions:display-dependency-updates  # check for updates

# Info
mvn help:effective-pom             # resolved POM with inheritance
mvn help:active-profiles           # show active profiles
mvn help:describe -Dplugin=compiler # plugin documentation

# Multi-module
mvn -pl module-name package        # build specific module
mvn -pl module-name -am package    # also build dependencies
mvn -rf :module-name package       # resume from module
```

## GraalVM Native Image

Compile Java applications ahead-of-time into standalone native executables.

### Basic Usage

```bash
# Install GraalVM (via mise or SDKMAN)
mise install java graalvm-21

# Compile to native executable
native-image -jar app.jar myapp

# With no fallback (fail at build time if reflection not configured)
native-image --no-fallback -jar app.jar

# From class path
native-image -cp app.jar com.example.Main -o myapp

# Optimized build
native-image -O3 -jar app.jar myapp

# With monitoring/debugging
native-image --enable-monitoring=jfr,heapdump -jar app.jar
```

### Reflection and Resource Configuration

Native image requires configuration for reflection, resources, and proxies:

```bash
# Generate config by running the app with tracing agent
java -agentlib:native-image-agent=config-output-dir=src/main/resources/META-INF/native-image \
  -jar app.jar

# Generated files:
# reflect-config.json      - reflection metadata
# resource-config.json     - resource files to include
# proxy-config.json        - dynamic proxy classes
# serialization-config.json
# jni-config.json
```

### Framework Support

```bash
# Spring Boot (with spring-boot-maven-plugin or Gradle plugin)
./gradlew nativeCompile    # Gradle
mvn -Pnative native:compile # Maven

# Quarkus
./gradlew build -Dquarkus.native.enabled=true
mvn package -Dnative

# Micronaut
./gradlew nativeCompile
```

## jlink - Custom Runtime Images

Create minimal JRE containing only required modules:

```bash
# List modules your application needs
jdeps --multi-release 21 --ignore-missing-deps --print-module-deps app.jar

# Create custom runtime with only needed modules
jlink --module-path $JAVA_HOME/jmods \
  --add-modules java.base,java.sql,java.net.http \
  --output custom-jre \
  --strip-debug \
  --compress zip-6 \
  --no-header-files \
  --no-man-pages

# Result: minimal JRE in custom-jre/ (can be ~30MB instead of ~300MB)

# Run with custom runtime
custom-jre/bin/java -jar app.jar
```

## jpackage - Native Installers

Create platform-specific installers (DMG, MSI, DEB, RPM):

```bash
# macOS DMG
jpackage --input lib/ --main-jar app.jar \
  --main-class com.example.Main \
  --name MyApp \
  --app-version 1.0.0 \
  --type dmg \
  --icon icon.icns \
  --java-options "-Xmx512m"

# With custom runtime (smaller package)
jpackage --input lib/ --main-jar app.jar \
  --main-class com.example.Main \
  --name MyApp \
  --type dmg \
  --runtime-image custom-jre/

# Linux DEB
jpackage --input lib/ --main-jar app.jar \
  --main-class com.example.Main \
  --name myapp \
  --type deb \
  --linux-shortcut \
  --linux-deb-maintainer "dev@example.com"
```

## JVM Tuning Flags

### Memory Settings

```bash
# Heap size
-Xms512m          # initial heap size
-Xmx4g            # maximum heap size
-Xss512k          # thread stack size

# Metaspace (replaces PermGen since Java 8)
-XX:MetaspaceSize=128m
-XX:MaxMetaspaceSize=256m

# Direct memory
-XX:MaxDirectMemorySize=512m
```

### Garbage Collection

```bash
# G1GC (default since Java 9, recommended for most workloads)
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200          # target pause time
-XX:G1HeapRegionSize=4m           # region size (1-32MB, power of 2)
-XX:InitiatingHeapOccupancyPercent=45

# ZGC (ultra-low latency, sub-millisecond pauses)
-XX:+UseZGC
-XX:+ZGenerational                # generational ZGC (Java 21+, default in 24+)

# Shenandoah (low latency, available in OpenJDK)
-XX:+UseShenandoahGC

# Serial GC (small heaps, single-threaded)
-XX:+UseSerialGC

# Parallel GC (throughput-oriented)
-XX:+UseParallelGC
```

### Diagnostics

```bash
# GC logging
-Xlog:gc*:file=gc.log:time,level,tags

# Heap dump on OOM
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/tmp/heapdump.hprof

# JMX remote monitoring
-Dcom.sun.management.jmxremote
-Dcom.sun.management.jmxremote.port=9090
-Dcom.sun.management.jmxremote.authenticate=false
-Dcom.sun.management.jmxremote.ssl=false

# Flight Recorder
-XX:StartFlightRecording=duration=60s,filename=recording.jfr

# Print compilation
-XX:+PrintCompilation

# Native memory tracking
-XX:NativeMemoryTracking=summary
```

### Performance Tuning

```bash
# Tiered compilation (default, fastest startup + peak performance)
-XX:+TieredCompilation

# Disable tiered for faster startup (less peak performance)
-XX:-TieredCompilation -XX:+UseCompressedOops

# Compiler threads
-XX:CICompilerCount=4

# String deduplication (with G1)
-XX:+UseStringDeduplication

# Compact object headers (Java 25+, saves ~10% heap)
-XX:+UseCompactObjectHeaders

# Container awareness (default in modern JDK)
-XX:+UseContainerSupport
-XX:MaxRAMPercentage=75.0         # use 75% of container memory limit
```

### Recommended Defaults for Containers

```bash
java \
  -XX:MaxRAMPercentage=75.0 \
  -XX:+UseG1GC \
  -XX:MaxGCPauseMillis=200 \
  -XX:+HeapDumpOnOutOfMemoryError \
  -XX:HeapDumpPath=/tmp/heapdump.hprof \
  -Xlog:gc*:file=/var/log/gc.log:time,level,tags:filecount=5,filesize=10m \
  -jar app.jar
```

### For Low-Latency Applications

```bash
java \
  -XX:+UseZGC \
  -XX:+ZGenerational \
  -Xmx4g \
  -XX:+HeapDumpOnOutOfMemoryError \
  -jar app.jar
```
