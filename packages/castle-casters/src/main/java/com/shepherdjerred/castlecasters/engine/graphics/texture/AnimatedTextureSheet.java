package com.shepherdjerred.castlecasters.engine.graphics.texture;

import lombok.AllArgsConstructor;

import java.util.Map;

@AllArgsConstructor
public class AnimatedTextureSheet {

  private final Texture texture;
  private final Map<Integer, TextureSheetCoordinates> frames;


}
