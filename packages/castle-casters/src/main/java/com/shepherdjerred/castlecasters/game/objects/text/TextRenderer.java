package com.shepherdjerred.castlecasters.game.objects.text;

import com.shepherdjerred.castlecasters.engine.graphics.RendererCoordinate;
import com.shepherdjerred.castlecasters.engine.graphics.font.Font;
import com.shepherdjerred.castlecasters.engine.graphics.matrices.ModelMatrix;
import com.shepherdjerred.castlecasters.engine.graphics.mesh.Mesh;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgram;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderProgramName;
import com.shepherdjerred.castlecasters.engine.graphics.shader.ShaderUniform;
import com.shepherdjerred.castlecasters.engine.object.GameObjectRenderer;
import com.shepherdjerred.castlecasters.engine.resource.ResourceManager;
import com.shepherdjerred.castlecasters.engine.window.WindowSize;
import lombok.Getter;
import lombok.extern.log4j.Log4j2;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Log4j2
public class TextRenderer implements GameObjectRenderer<Text> {

  private final ResourceManager resourceManager;
  private final Map<Integer, Mesh> characterMeshMap;
  private Font font;
  private ShaderProgram textShaderProgram;
  @Getter
  private int width = 0;
  @Getter
  private int height = 24;

  public TextRenderer(ResourceManager resourceManager) {
    this.resourceManager = resourceManager;
    characterMeshMap = new HashMap<>();
  }

  @Override
  public void initialize(Text text) throws Exception {
    font = resourceManager.get(text.getFontName());
    textShaderProgram = resourceManager.get(ShaderProgramName.TEXT);
    var chars = text.getText().toCharArray();
    var maxWidth = text.getMaxWidth();

    var currentX = 0;
    var currentY = 24;
    for (int i = 0; i < chars.length; i++) {
      char character = chars[i];

      if (character == ' ') {
        List<Character> wordChars = new ArrayList<>();
        var index = i + 1;

        while (index < chars.length && chars[index] != ' ') {
          wordChars.add(character);
          index++;
        }

        var wordSize = 0;

        for (var characterInWord : wordChars) {
          wordSize += font.getFontCharacter(characterInWord, currentX, currentY).width();
        }

        if (currentX + wordSize > maxWidth) {
          currentY += 24;
          currentX = 0;
        }
      }

      if (character == '\n') {
        currentY += 24;
        currentX = 0;
        continue;
      }

      var fontCharacter = font.getFontCharacter(character, currentX, currentY);
      var vertices = fontCharacter.coordinates().toFloatArray();
      var textureCoordinates = fontCharacter.textureCoordinates().toFloatArray();

      var indices = new int[]{
          0, 1, 2,
          3, 1, 2
      };

      var mesh = new Mesh(vertices, textureCoordinates, indices);
      characterMeshMap.put(i, mesh);

      if (character == 32) {
        if (currentX != 0) {
          currentX += 12;
        }
      } else {
        currentX += fontCharacter.width() + 2;
      }
    }
    width = currentX;
    height = currentY;
  }

  @Override
  public void render(WindowSize windowSize, Text sceneElement) {
    textShaderProgram.bind();
    font.bind();

    var pos = sceneElement.getPosition()
        .getSceneCoordinate(windowSize, sceneElement.getSceneObjectDimensions());
    var model = new ModelMatrix(new RendererCoordinate(pos.x(), pos.y(), pos.z()),
        0,
        1).getMatrix();

    textShaderProgram.setUniform(ShaderUniform.MODEL_MATRIX, model);
    textShaderProgram.setUniform(ShaderUniform.TEXT_COLOR,
        sceneElement.getColor().toRgbFloatArray());

    char[] textCharacters = sceneElement.getText().toCharArray();
    for (int i = 0; i < textCharacters.length; i++) {
      if (textCharacters[i] == '\n') {
        continue;
      }
      var mesh = characterMeshMap.get(i);
      mesh.render();
    }

    font.unbind();
    textShaderProgram.unbind();
  }

  @Override
  public void cleanup() {
    resourceManager.free(font.fontName());
    resourceManager.free(textShaderProgram.getShaderProgramName());
    characterMeshMap.values().forEach(Mesh::cleanup);
  }
}
