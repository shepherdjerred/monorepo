package com.shepherdjerred.thestorm.client.mixin;

import com.shepherdjerred.thestorm.client.RenderCapture;
import net.minecraft.client.renderer.entity.EntityRenderer;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Hides both player labels and below-name score text only during owned capture. */
@Mixin(EntityRenderer.class)
public abstract class NameDisplayMixin {
  @Inject(
      method =
          "submitNameDisplay(Lnet/minecraft/client/renderer/entity/state/EntityRenderState;Lcom/mojang/blaze3d/vertex/PoseStack;Lnet/minecraft/client/renderer/SubmitNodeCollector;Lnet/minecraft/client/renderer/state/level/CameraRenderState;I)V",
      at = @At("HEAD"),
      cancellable = true)
  protected final void stormHideCaptureNames(CallbackInfo callback) {
    if (RenderCapture.hideNames()) callback.cancel();
  }
}
