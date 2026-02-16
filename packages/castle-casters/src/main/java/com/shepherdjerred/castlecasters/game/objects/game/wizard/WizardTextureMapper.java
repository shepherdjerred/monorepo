package com.shepherdjerred.castlecasters.game.objects.game.wizard;

import com.shepherdjerred.castlecasters.common.player.Element;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.game.objects.game.wizard.Wizard.State;

import java.util.HashMap;
import java.util.Map;

public class WizardTextureMapper {

  private final Map<Element, Map<Wizard.State, TextureName>> textures;

  public WizardTextureMapper() {
    this.textures = new HashMap<>();
    initializeMap();
  }

  private void initializeMap() {
    Map<Wizard.State, TextureName> fireTextures = new HashMap<>();
    fireTextures.put(State.CASTING, TextureName.FIRE_WIZARD_CAST);
    fireTextures.put(State.STILL, TextureName.FIRE_WIZARD_FRONT);
    fireTextures.put(State.WALKING_DOWN, TextureName.FIRE_WIZARD_FRONT);
    fireTextures.put(State.WALKING_UP, TextureName.FIRE_WIZARD_BACK);
    fireTextures.put(State.WALKING_LEFT, TextureName.FIRE_WIZARD_SIDE);
    fireTextures.put(State.WALKING_RIGHT, TextureName.FIRE_WIZARD_SIDE);
    Map<Wizard.State, TextureName> iceTextures = new HashMap<>();
    iceTextures.put(State.CASTING, TextureName.ICE_WIZARD_CAST);
    iceTextures.put(State.STILL, TextureName.ICE_WIZARD_FRONT);
    iceTextures.put(State.WALKING_DOWN, TextureName.ICE_WIZARD_FRONT);
    iceTextures.put(State.WALKING_UP, TextureName.ICE_WIZARD_BACK);
    iceTextures.put(State.WALKING_LEFT, TextureName.ICE_WIZARD_SIDE);
    iceTextures.put(State.WALKING_RIGHT, TextureName.ICE_WIZARD_SIDE);
    Map<Wizard.State, TextureName> earthTextures = new HashMap<>();
    earthTextures.put(State.CASTING, TextureName.EARTH_WIZARD_CAST);
    earthTextures.put(State.STILL, TextureName.EARTH_WIZARD_FRONT);
    earthTextures.put(State.WALKING_DOWN, TextureName.EARTH_WIZARD_FRONT);
    earthTextures.put(State.WALKING_UP, TextureName.EARTH_WIZARD_BACK);
    earthTextures.put(State.WALKING_LEFT, TextureName.EARTH_WIZARD_SIDE);
    earthTextures.put(State.WALKING_RIGHT, TextureName.EARTH_WIZARD_SIDE);
    Map<Wizard.State, TextureName> airTextures = new HashMap<>();
    airTextures.put(State.CASTING, TextureName.AIR_WIZARD_CAST);
    airTextures.put(State.STILL, TextureName.AIR_WIZARD_FRONT);
    airTextures.put(State.WALKING_DOWN, TextureName.AIR_WIZARD_FRONT);
    airTextures.put(State.WALKING_UP, TextureName.AIR_WIZARD_BACK);
    airTextures.put(State.WALKING_LEFT, TextureName.AIR_WIZARD_SIDE);
    airTextures.put(State.WALKING_RIGHT, TextureName.AIR_WIZARD_SIDE);
    textures.put(Element.FIRE, fireTextures);
    textures.put(Element.ICE, iceTextures);
    textures.put(Element.EARTH, earthTextures);
    textures.put(Element.WIND, airTextures);
  }

  public Map<State, TextureName> getTexturesForElement(Element element) {
    return textures.get(element);
  }

  public TextureName getTexture(Element element, State state) {
    return textures.get(element).get(state);
  }
}
