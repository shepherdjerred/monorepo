package com.shepherdjerred.castlecasters.engine.graphics.font;

import com.google.common.base.Preconditions;
import com.shepherdjerred.castlecasters.engine.graphics.OpenGlHelper;
import com.shepherdjerred.castlecasters.engine.graphics.Quad;
import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.texture.TextureQuad;
import com.shepherdjerred.castlecasters.engine.resource.Resource;
import lombok.extern.log4j.Log4j2;
import org.lwjgl.stb.STBTTAlignedQuad;
import org.lwjgl.stb.STBTTBakedChar;
import org.lwjgl.system.MemoryStack;

import static org.lwjgl.opengl.GL11.*;
import static org.lwjgl.stb.STBTruetype.stbtt_GetBakedQuad;

@Log4j2
public record Font(FontName fontName, int ascent, int descent, int gap, int glTextureName, int textureWidth,
                   int textureHeight, STBTTBakedChar.Buffer characterBuffer) implements Resource {

  public void bind() {
    glBindTexture(GL_TEXTURE_2D, glTextureName);
  }

  public void unbind() {
    OpenGlHelper.unbind2dTexture();
  }

  public FontCharacter getFontCharacter(char character, int xPosition, int yPosition) {
    Preconditions.checkArgument(character >= 32 && character < 128);

    try (var stack = MemoryStack.stackPush()) {
      var xBuffer = stack.mallocFloat(1);
      var yBuffer = stack.mallocFloat(1);
      STBTTAlignedQuad quad = STBTTAlignedQuad.malloc(stack);

      xBuffer.put(xPosition).flip();
      yBuffer.put(yPosition).flip();

      stbtt_GetBakedQuad(characterBuffer,
          textureWidth,
          textureHeight,
          character - 32,
          xBuffer,
          yBuffer,
          quad,
          true);

      return new FontCharacter(
          character,
          quad.x1() - quad.x0(),
          quad.y1() - quad.y0(),
          new Quad(
              new RendererCoordinate(quad.x1(), quad.y1()),
              new RendererCoordinate(quad.x0(), quad.y1()),
              new RendererCoordinate(quad.x0(), quad.y0()),
              new RendererCoordinate(quad.x1(), quad.y0())
          ),
          new TextureQuad(
              new TextureCoordinate(quad.s1(), quad.t1()),
              new TextureCoordinate(quad.s0(), quad.t1()),
              new TextureCoordinate(quad.s0(), quad.t0()),
              new TextureCoordinate(quad.s1(), quad.t0())
          ));
    }
  }

  @Override
  public void cleanup() {
    characterBuffer.free();
    glDeleteTextures(glTextureName);
  }
}
