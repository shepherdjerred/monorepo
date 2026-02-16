package com.shepherdjerred.castlecasters.game.objects.button;

import com.shepherdjerred.castlecasters.engine.object.ClickableTextureSet;
import com.shepherdjerred.castlecasters.game.objects.button.Button.Type;

import java.util.HashMap;
import java.util.Map;

import static com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName.*;
import static com.shepherdjerred.castlecasters.game.objects.button.Button.Type.GENERIC;
import static com.shepherdjerred.castlecasters.game.objects.button.Button.Type.HOME;

public class ButtonTextureMapper {

  private final Map<Type, ClickableTextureSet> typeTextureMap;

  public ButtonTextureMapper() {
    typeTextureMap = new HashMap<>();
    initializeMap();
  }

  private void initializeMap() {
    typeTextureMap.put(GENERIC,
        new ClickableTextureSet(GENERIC_BUTTON, GENERIC_BUTTON_HOVERED, GENERIC_BUTTON_CLICKED));
    typeTextureMap.put(HOME,
        new ClickableTextureSet(MAIN_MENU_BUTTON,
            MAIN_MENU_BUTTON_HOVERED,
            MAIN_MENU_BUTTON_CLICKED));
  }

  public ClickableTextureSet get(Type type) {
    return typeTextureMap.getOrDefault(type, new ClickableTextureSet(UNKNOWN, UNKNOWN, UNKNOWN));
  }
}
