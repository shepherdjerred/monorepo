package com.shepherdjerred.thestorm.client.mixin;

import com.shepherdjerred.thestorm.client.RenderCapture;
import net.minecraft.client.renderer.GameRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Samples the completed framebuffer after world and GUI rendering. */
@Mixin(GameRenderer.class)
public abstract class FrameRenderMixin {
  @Inject(method = "render", at = @At("TAIL"))
  protected final void stormRenderedFrame(CallbackInfo unusedCallback) {
    RenderCapture.rendered();
  }
}
