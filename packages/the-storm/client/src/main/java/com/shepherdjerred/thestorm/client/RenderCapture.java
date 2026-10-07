package com.shepherdjerred.thestorm.client;

import net.minecraft.client.Minecraft;
import org.jspecify.annotations.Nullable;

/** Render hooks remain inert without an explicitly bootstrapped preview session. */
public final class RenderCapture {
  private static @Nullable VideoCapture capture;

  private RenderCapture() {}

  static void install(VideoCapture owner) {
    if (capture != null) throw new IllegalStateException("Render capture already installed");
    capture = owner;
  }

  static void remove(VideoCapture owner) {
    if (capture != owner) throw new IllegalStateException("Render capture owner changed");
    capture = null;
  }

  public static boolean hideNames() {
    var owner = capture;
    return owner != null && owner.active();
  }

  public static void rendered() {
    var owner = capture;
    if (owner != null) owner.render(Minecraft.getInstance());
  }
}
