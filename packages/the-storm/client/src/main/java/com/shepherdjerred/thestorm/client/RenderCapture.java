package com.shepherdjerred.thestorm.client;

import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;

/** Render hooks remain inert without an explicitly bootstrapped preview session. */
public final class RenderCapture {
  private static @Nullable VideoCapture capture;
  private static @Nullable FramePacing pacing;
  private static @Nullable DocsCapture docs;
  private static long renderedFrames;

  static long renderedFrames() {
    return renderedFrames;
  }

  static void installDocs(DocsCapture owner) {
    docs = owner;
  }

  static void removeDocs(DocsCapture owner) {
    if (docs != owner) throw new IllegalStateException("Docs capture owner changed");
    docs = null;
  }

  private RenderCapture() {}

  static void install(VideoCapture owner) {
    install(owner, null);
  }

  static void install(VideoCapture owner, @Nullable FramePacing timing) {
    if (capture != null) throw new IllegalStateException("Render capture already installed");
    capture = owner;
    pacing = timing;
  }

  static void remove(VideoCapture owner) {
    if (capture != owner) throw new IllegalStateException("Render capture owner changed");
    capture = null;
    docs = null;
    pacing = null;
  }

  public static boolean hideNames() {
    var owner = capture;
    return owner != null && owner.active();
  }

  public static void rendered() {
    renderedFrames++;
    var recording = docs;
    if (recording != null) recording.render(Minecraft.getInstance());
    var owner = capture;
    if (owner != null) owner.render(Minecraft.getInstance());
    var timing = pacing;
    if (timing != null) timing.rendered(Minecraft.getInstance());
  }
}
