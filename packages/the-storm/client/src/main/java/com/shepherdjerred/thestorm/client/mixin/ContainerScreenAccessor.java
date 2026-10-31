package com.shepherdjerred.thestorm.client.mixin;

import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** Coordinates of the actual rendered container, independent of GUI scale. */
@Mixin(AbstractContainerScreen.class)
public interface ContainerScreenAccessor {
  @Accessor("leftPos")
  int stormLeft();

  @Accessor("topPos")
  int stormTop();
}
