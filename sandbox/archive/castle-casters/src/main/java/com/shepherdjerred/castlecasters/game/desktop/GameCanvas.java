package com.shepherdjerred.castlecasters.game.desktop;

import static org.lwjgl.opengl.GL33.*;
import static org.lwjgl.stb.STBTruetype.stbtt_GetBakedQuad;

import com.shepherdjerred.castlecasters.engine.graphics.font.*;
import com.shepherdjerred.castlecasters.engine.graphics.texture.*;
import com.shepherdjerred.castlecasters.engine.map.*;
import com.shepherdjerred.castlecasters.engine.resource.*;
import java.nio.FloatBuffer;
import java.util.*;
import org.lwjgl.BufferUtils;
import org.lwjgl.stb.STBTTAlignedQuad;
import org.lwjgl.system.MemoryStack;

/** Batches the original artwork in a shared logical viewport, including Retina windows. */
public final class GameCanvas implements AutoCloseable {
  public static final int WIDTH = 1360, HEIGHT = 768;
  private final Map<TextureName, Texture> textures = new EnumMap<>(TextureName.class);
  private final Map<GameMapName, MapLayers> maps = new EnumMap<>(GameMapName.class);
  private final PathResourceFileLocator locator =
      new PathResourceFileLocator("/textures/", "/fonts/", "/audio/", "/maps/");
  private final TextureLoader loader = new TextureLoader(locator);
  private final FloatBuffer vertices = BufferUtils.createFloatBuffer(6 * 8 * 8192);
  private Font font;
  private int vao, vbo, program, white, bound = -1, mode = -1;

  public void initialize() throws Exception {
    font = new FontLoader(locator).get(FontName.M5X7);
    var mapLoader = new GameMapLoader(new ByteBufferLoader(), locator);
    for (var name : GameMapName.values()) {
      if (Set.of(GameMapName.GRASS, GameMapName.DESERT, GameMapName.WINTER).contains(name)) {
        var map = mapLoader.get(name);
        if (map.getBoardOrigin() == null || map.getBoardSize() != 9)
          throw new IllegalStateException("Missing map board metadata: " + name);
        maps.put(name, map);
      }
    }
    int vertex =
        shader(
            GL_VERTEX_SHADER,
            """
            #version 330 core
            layout(location=0) in vec2 position;
            layout(location=1) in vec2 uv;
            layout(location=2) in vec4 color;
            out vec2 texCoord; out vec4 tint;
            void main() { gl_Position=vec4(position.x/680.-1.,1.-position.y/384.,0.,1.); texCoord=uv; tint=color; }
            """);
    int fragment =
        shader(
            GL_FRAGMENT_SHADER,
            """
            #version 330 core
            in vec2 texCoord; in vec4 tint; out vec4 outputColor;
            uniform sampler2D image; uniform int fontMode;
            void main() { vec4 c=texture(image,texCoord); outputColor=(fontMode==1?vec4(1.,1.,1.,c.r):c)*tint; }
            """);
    program = glCreateProgram();
    glAttachShader(program, vertex);
    glAttachShader(program, fragment);
    glLinkProgram(program);
    glDeleteShader(vertex);
    glDeleteShader(fragment);
    if (glGetProgrami(program, GL_LINK_STATUS) == 0)
      throw new IllegalStateException(glGetProgramInfoLog(program));
    vao = glGenVertexArrays();
    vbo = glGenBuffers();
    glBindVertexArray(vao);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, (long) vertices.capacity() * Float.BYTES, GL_STREAM_DRAW);
    for (int i = 0; i < 3; i++) {
      glEnableVertexAttribArray(i);
      glVertexAttribPointer(i, i == 2 ? 4 : 2, GL_FLOAT, false, 32, (long) i * 8);
    }
    white = glGenTextures();
    glBindTexture(GL_TEXTURE_2D, white);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, new int[] {-1});
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  }

  private static int shader(int kind, String source) {
    int id = glCreateShader(kind);
    glShaderSource(id, source);
    glCompileShader(id);
    if (glGetShaderi(id, GL_COMPILE_STATUS) == 0)
      throw new IllegalStateException(glGetShaderInfoLog(id));
    return id;
  }

  public Texture texture(TextureName name) {
    return textures.computeIfAbsent(
        name,
        key -> {
          try {
            return loader.get(key);
          } catch (Exception e) {
            throw new IllegalStateException("Missing artwork: " + key, e);
          }
        });
  }

  public void begin() {
    int[] viewport = new int[4];
    glGetIntegerv(GL_VIEWPORT, viewport);
    // The engine keeps the framebuffer viewport current; save its full dimensions before
    // letterboxing.
    glDisable(GL_DEPTH_TEST);
    glEnable(GL_BLEND);
    glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
    glClearColor(.025f, .04f, .035f, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glUseProgram(program);
    glBindVertexArray(vao);
    glActiveTexture(GL_TEXTURE0);
    bound = -1;
    mode = -1;
  }

  public void viewport(int width, int height) {
    double scale = Math.min(width / (double) WIDTH, height / (double) HEIGHT);
    int w = (int) Math.round(WIDTH * scale), h = (int) Math.round(HEIGHT * scale);
    glViewport((width - w) / 2, (height - h) / 2, w, h);
  }

  public void end() {
    flush();
    glBindVertexArray(0);
    glUseProgram(0);
  }

  public void rect(float x, float y, float w, float h, float r, float g, float b, float a) {
    quad(white, 0, x, y, w, h, 0, 0, 1, 1, r, g, b, a);
  }

  public void image(TextureName name, float x, float y, float w, float h) {
    image(name, x, y, w, h, 0, 0, 1, 1, 1);
  }

  public void image(
      TextureName name,
      float x,
      float y,
      float w,
      float h,
      float u,
      float v,
      float uw,
      float vh,
      float alpha) {
    quad(texture(name).glTextureId(), 0, x, y, w, h, u, v, u + uw, v + vh, 1, 1, 1, alpha);
  }

  public float textWidth(String text, float scale) {
    float width = 0;
    for (char c : text.toCharArray())
      width += font.characterBuffer().get(c - 32).xadvance() * scale;
    return width;
  }

  public void text(String text, float x, float y, float scale) {
    text(text, x, y, scale, .95f, .97f, .91f);
  }

  public void text(String text, float x, float y, float scale, float r, float g, float b) {
    try (var stack = MemoryStack.stackPush()) {
      var penX = stack.floats(0);
      var penY = stack.floats(0);
      var q = STBTTAlignedQuad.malloc(stack);
      for (char c : text.toCharArray()) {
        if (c < 32 || c >= 128) throw new IllegalArgumentException("Unsupported display character");
        stbtt_GetBakedQuad(font.characterBuffer(), 512, 512, c - 32, penX, penY, q, true);
        quad(
            font.glTextureName(),
            1,
            x + q.x0() * scale,
            y + q.y0() * scale,
            (q.x1() - q.x0()) * scale,
            (q.y1() - q.y0()) * scale,
            q.s0(),
            q.t0(),
            q.s1(),
            q.t1(),
            r,
            g,
            b,
            1);
      }
    }
  }

  /** Crisp borders and fixed bevels stay the same size across wide and compact controls. */
  public void control(
      String label,
      float x,
      float y,
      float w,
      float h,
      boolean enabled,
      boolean hover,
      boolean pressed,
      boolean primary,
      boolean selected,
      boolean input) {
    boolean accent = enabled && (hover || selected || primary);
    float offset = pressed ? 2 : 0;
    if (!input) rect(x, y + 4, w, h, .015f, .025f, .02f, .65f);
    y += offset;
    rect(x, y, w, h, accent ? .71f : .28f, accent ? .62f : .36f, accent ? .38f : .3f, 1);
    float brighten = hover ? .045f : 0;
    float base = input ? .035f : primary || selected ? .13f : .065f;
    rect(
        x + 2,
        y + 2,
        w - 4,
        h - 4,
        base + brighten,
        base + .065f + brighten,
        base + .025f + brighten,
        1);
    if (!input) {
      rect(x + 2, y + 2, w - 4, 2, 1, 1, .85f, pressed ? .025f : .1f);
      rect(x + 2, y + h - 4, w - 4, 2, 0, 0, 0, .35f);
    }
    float scale = Math.min(1.2f, (w - 32) / Math.max(1, textWidth(label, 1)));
    float tx = input ? x + 16 : x + (w - textWidth(label, scale)) / 2;
    text(
        label,
        tx,
        y + h / 2 + 8,
        scale,
        enabled ? .95f : .45f,
        enabled ? .97f : .51f,
        enabled ? .91f : .46f);
  }

  public void textFit(String value, float x, float y, float width, float scale) {
    text(value, x, y, Math.min(scale, width / Math.max(1, textWidth(value, 1))));
  }

  public void map(String theme, float boardX, float boardY, float tile) {
    var map = maps.get(GameMapName.valueOf(theme));
    // Cells in one layer never overlap; group them by atlas to bound draw calls.
    for (var layer : map)
      for (var texture : layer.getLayerTextures())
        for (var cell : layer) {
          if (cell.textureName() != texture) continue;
          float x = boardX + (cell.position().x() - map.getBoardOrigin().x()) * tile;
          float y = boardY + (cell.position().y() - map.getBoardOrigin().y()) * tile;
          if (x < -tile || y < -tile || x > WIDTH || y > HEIGHT) continue;
          var uv = cell.textureSheetCoordinates();
          image(
              cell.textureName(),
              x,
              y,
              tile,
              tile,
              (float) uv.getMinX(),
              (float) uv.getMinY(),
              (float) (uv.getMaxX() - uv.getMinX()),
              (float) (uv.getMaxY() - uv.getMinY()),
              1);
        }
  }

  private void quad(
      int texture,
      int fontMode,
      float x,
      float y,
      float w,
      float h,
      float u0,
      float v0,
      float u1,
      float v1,
      float r,
      float g,
      float b,
      float a) {
    if (bound != texture || mode != fontMode || vertices.remaining() < 48) {
      flush();
      bound = texture;
      mode = fontMode;
    }
    point(x, y, u0, v0, r, g, b, a);
    point(x + w, y, u1, v0, r, g, b, a);
    point(x, y + h, u0, v1, r, g, b, a);
    point(x + w, y, u1, v0, r, g, b, a);
    point(x + w, y + h, u1, v1, r, g, b, a);
    point(x, y + h, u0, v1, r, g, b, a);
  }

  private void point(float x, float y, float u, float v, float r, float g, float b, float a) {
    vertices.put(x).put(y).put(u).put(v).put(r).put(g).put(b).put(a);
  }

  private void flush() {
    if (vertices.position() == 0) return;
    int count = vertices.position() / 8;
    vertices.flip();
    glBindTexture(GL_TEXTURE_2D, bound);
    glUniform1i(glGetUniformLocation(program, "fontMode"), mode);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferSubData(GL_ARRAY_BUFFER, 0, vertices);
    glDrawArrays(GL_TRIANGLES, 0, count);
    vertices.clear();
  }

  @Override
  public void close() {
    textures.values().forEach(Texture::cleanup);
    textures.clear();
    if (font != null) font.cleanup();
    glDeleteTextures(white);
    glDeleteBuffers(vbo);
    glDeleteVertexArrays(vao);
    glDeleteProgram(program);
  }
}
