package com.shepherdjerred.castlecasters.engine.object;

import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.object.ClickableAbstractGameObject.State;

import java.util.HashMap;
import java.util.Map;

public class ClickableTextureSet {

  private final Map<State, TextureName> stateTextureMap;

  public ClickableTextureSet(TextureName defaultTexture, TextureName hovered, TextureName clicked) {
    stateTextureMap = new HashMap<>();
    stateTextureMap.put(State.INACTIVE, defaultTexture);
    stateTextureMap.put(State.HOVERED, hovered);
    stateTextureMap.put(State.CLICKED, clicked);
  }

  public TextureName getTexture(State state) {
    return stateTextureMap.get(state);
  }

  public TextureName getInactiveTexture() {
    return stateTextureMap.get(State.INACTIVE);
  }

  public TextureName getHoveredTexture() {
    return stateTextureMap.get(State.HOVERED);
  }

  public TextureName getClickedTexture() {
    return stateTextureMap.get(State.CLICKED);
  }
}
