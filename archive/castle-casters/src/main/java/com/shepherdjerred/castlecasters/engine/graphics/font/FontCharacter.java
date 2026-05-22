package com.shepherdjerred.castlecasters.engine.graphics.font;

import com.shepherdjerred.castlecasters.engine.graphics.Quad;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureQuad;

public record FontCharacter(char character, float width, float height, Quad coordinates,
                            TextureQuad textureCoordinates) {

}
