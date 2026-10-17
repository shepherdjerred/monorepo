-keep class com.sun.jna.** { *; }
-keep class uniffi.TaskNotesCore.** { *; }
-keepclasseswithmembers,includedescriptorclasses class * {
    native <methods>;
}

# JNA 5.18.1 exposes desktop-only signatures even in its Android AAR.
# Android has no AWT, and Facet never calls those desktop methods. Upstream's
# Android guidance requires this distinction; keep required native/JNA classes.
# https://github.com/java-native-access/jna/blob/5.18.1/www/FrequentlyAskedQuestions.md
-dontwarn java.awt.Component
-dontwarn java.awt.GraphicsEnvironment
-dontwarn java.awt.HeadlessException
-dontwarn java.awt.Window

# Jetpack Window uses compile-only OEM header interfaces loaded through its
# reflection guards. Implementations live on supporting devices, not in APKs.
# https://source.android.com/docs/core/display/windowmanager-extensions
# Enumerate only the optional headers observed in Window 1.5.0; other missing
# classes still fail R8. Do not copy AGP's broad androidx.** warning exclusion.
-dontwarn androidx.window.extensions.WindowExtensions
-dontwarn androidx.window.extensions.WindowExtensionsProvider
-dontwarn androidx.window.extensions.area.ExtensionWindowAreaPresentation
-dontwarn androidx.window.extensions.core.util.function.Consumer
-dontwarn androidx.window.extensions.core.util.function.Function
-dontwarn androidx.window.extensions.core.util.function.Predicate
-dontwarn androidx.window.extensions.layout.DisplayFeature
-dontwarn androidx.window.extensions.layout.FoldingFeature
-dontwarn androidx.window.extensions.layout.WindowLayoutComponent
-dontwarn androidx.window.extensions.layout.WindowLayoutInfo
-dontwarn androidx.window.sidecar.SidecarDeviceState
-dontwarn androidx.window.sidecar.SidecarDisplayFeature
-dontwarn androidx.window.sidecar.SidecarInterface$SidecarCallback
-dontwarn androidx.window.sidecar.SidecarInterface
-dontwarn androidx.window.sidecar.SidecarProvider
-dontwarn androidx.window.sidecar.SidecarWindowLayoutInfo
