import { expect, type Page } from "@playwright/test";

type FlowMapDraw = {
  indices: number;
  usesSnapshot: boolean;
  blended: boolean;
  testsDepth: boolean;
  writesDepth: boolean;
  usesSceneTarget: boolean;
  error: number;
};

type FlowMapFrame = {
  snapshotCopied: boolean;
  colorPresented: boolean;
  draws: FlowMapDraw[];
  copyErrors: number[];
};

declare global {
  var recordedMayhemFlowMapFrame: FlowMapFrame | undefined;
}

export async function observeMayhemFlowMap(page: Page) {
  await page.addInitScript(() => {
    const gl = WebGL2RenderingContext.prototype;
    const originalBlit: WebGL2RenderingContext["blitFramebuffer"] = Reflect.get(
      gl,
      "blitFramebuffer",
    );
    const originalDraw: WebGL2RenderingContext["drawElements"] = Reflect.get(
      gl,
      "drawElements",
    );
    let scene: WebGLFramebuffer | null;

    gl.blitFramebuffer = function (...args) {
      const source: unknown = this.getParameter(this.READ_FRAMEBUFFER_BINDING);
      const target: unknown = this.getParameter(this.DRAW_FRAMEBUFFER_BINDING);
      originalBlit.apply(this, args);
      if ((args[8] & this.DEPTH_BUFFER_BIT) !== 0) {
        scene = source instanceof WebGLFramebuffer ? source : null;
        globalThis.recordedMayhemFlowMapFrame = {
          snapshotCopied:
            scene !== null &&
            target instanceof WebGLFramebuffer &&
            source !== target &&
            (args[8] & this.COLOR_BUFFER_BIT) !== 0 &&
            args[3] > args[1] &&
            args[7] < args[5],
          colorPresented: false,
          draws: [],
          copyErrors: [this.getError()],
        };
      } else if (source === scene && target === null) {
        const frame = globalThis.recordedMayhemFlowMapFrame;
        if (frame === undefined) return;
        frame.colorPresented = args[8] === this.COLOR_BUFFER_BIT;
        frame.copyErrors.push(this.getError());
      }
    };

    gl.drawElements = function (...args) {
      originalDraw.apply(this, args);
      const frame = globalThis.recordedMayhemFlowMapFrame;
      const program: unknown = this.getParameter(this.CURRENT_PROGRAM);
      if (
        frame === undefined ||
        !(program instanceof WebGLProgram) ||
        this.getUniformBlockIndex(program, "PerFramePixelCB_ps") ===
          this.INVALID_INDEX
      )
        return;
      frame.draws.push({
        indices: args[1],
        usesSnapshot:
          this.getUniformLocation(program, "sDepthTexture_SharedTexture") !==
            null &&
          this.getUniformLocation(
            program,
            "SAMPLER_BACK_BUFFER_COPY_SharedTexture",
          ) !== null,
        blended: this.isEnabled(this.BLEND),
        testsDepth: this.isEnabled(this.DEPTH_TEST),
        writesDepth: this.getParameter(this.DEPTH_WRITEMASK) === true,
        usesSceneTarget:
          this.getParameter(this.DRAW_FRAMEBUFFER_BINDING) === scene,
        error: this.getError(),
      });
    };
  });
}

export async function verifyMayhemFlowMap(page: Page) {
  const frame = await page.evaluate(
    () => globalThis.recordedMayhemFlowMapFrame,
  );
  expect(frame).toMatchObject({
    snapshotCopied: true,
    colorPresented: true,
    copyErrors: [0, 0],
  });
  if (frame === undefined)
    throw new Error("The Bloom FlowMap frame was not drawn.");
  expect(
    frame.draws
      .map(({ indices }) => indices)
      .toSorted((left, right) => left - right),
  ).toEqual([39, 48, 63, 138, 156, 207, 516, 807, 1065]);
  expect(frame.draws.filter(({ usesSnapshot }) => usesSnapshot)).toHaveLength(
    8,
  );
  for (const draw of frame.draws)
    expect(draw).toMatchObject({
      blended: true,
      testsDepth: true,
      writesDepth: false,
      usesSceneTarget: true,
      error: 0,
    });
}
