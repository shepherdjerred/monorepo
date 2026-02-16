package com.shepherdjerred.castlecasters.engine.resource;

import com.shepherdjerred.castlecasters.engine.audio.AudioName;
import com.shepherdjerred.castlecasters.engine.graphics.font.FontName;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureName;
import com.shepherdjerred.castlecasters.engine.map.GameMapName;

public interface ResourceFileLocator {

  /**
   * Returns the path to a texture file.
   */
  String getTexturePath(TextureName textureName);

  /**
   * Returns the path to a font file.
   */
  String getFontPath(FontName fontName);

  String getAudioPath(AudioName audioName);

  String getMapPath(GameMapName mapName);
}
