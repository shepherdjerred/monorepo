package com.shepherdjerred.thestorm.rwfbots.adapter.inference;

import ai.onnxruntime.OnnxJavaType;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import com.shepherdjerred.thestorm.rwfbots.app.learning.ActorMatrix;
import com.shepherdjerred.thestorm.rwfbots.app.learning.RecurrentActor;
import java.nio.FloatBuffer;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;

/** Hash-validated float32 CPU actor. Session, tensors and result ownership are explicit. */
public final class OnnxActor implements RecurrentActor {
  // ONNX Runtime owns a process-wide environment; individual actors own only
  // their sessions. Closing one actor must not close another's environment.
  private final OrtEnvironment environment;
  private final OrtSession session;
  private boolean closed;

  private OnnxActor(OrtEnvironment environment, OrtSession session) {
    this.environment = environment;
    this.session = session;
  }

  public static OnnxActor load(Path directory, ActorManifest.Acceptance acceptance) {
    var bytes = ActorManifest.load(directory, acceptance);
    var environment = OrtEnvironment.getEnvironment();
    try (var options = new OrtSession.SessionOptions()) {
      options.setIntraOpNumThreads(1);
      options.setInterOpNumThreads(1);
      options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
      var session = environment.createSession(bytes, options);
      try {
        validateSession(session);
        return new OnnxActor(environment, session);
      } catch (RuntimeException | OrtException failure) {
        session.close();
        throw failure;
      }
    } catch (OrtException failure) {
      throw new IllegalStateException("cannot load CPU actor", failure);
    }
  }

  private static void validateSession(OrtSession session) throws OrtException {
    if (!session.getInputNames().equals(Set.of("observation", "hidden", "cell"))
        || !session.getOutputNames().equals(Set.of("logits", "next_hidden", "next_cell")))
      throw new IllegalArgumentException("ONNX tensor names differ from actor contract");
    var inputs = session.getInputInfo();
    var outputs = session.getOutputInfo();
    shape(inputs, "observation", FEATURES);
    shape(inputs, "hidden", HIDDEN);
    shape(inputs, "cell", HIDDEN);
    shape(outputs, "logits", LOGITS);
    shape(outputs, "next_hidden", HIDDEN);
    shape(outputs, "next_cell", HIDDEN);
  }

  private static void shape(Map<String, ai.onnxruntime.NodeInfo> nodes, String name, int width) {
    var node = nodes.get(name);
    if (node == null) throw new IllegalArgumentException("missing ONNX tensor " + name);
    shape(node.getInfo(), width);
  }

  private static void shape(ai.onnxruntime.ValueInfo info, int width) {
    if (!(info instanceof TensorInfo tensor)
        || tensor.type != OnnxJavaType.FLOAT
        || tensor.getShape().length != 2
        || tensor.getShape()[0] != -1
        || tensor.getShape()[1] != width)
      throw new IllegalArgumentException("ONNX tensor shape or dtype mismatch");
  }

  @Override
  public synchronized Output forward(Input input) {
    if (closed) throw new IllegalStateException("actor is closed");
    try (var observation = tensor(input.observation());
        var hidden = tensor(input.hidden());
        var cell = tensor(input.cell());
        var result =
            session.run(Map.of("observation", observation, "hidden", hidden, "cell", cell))) {
      var rows = input.observation().rows();
      return new Output(
          matrix(result, "logits", rows, LOGITS),
          matrix(result, "next_hidden", rows, HIDDEN),
          matrix(result, "next_cell", rows, HIDDEN));
    } catch (OrtException failure) {
      throw new IllegalStateException("CPU actor inference failed", failure);
    }
  }

  private OnnxTensor tensor(ActorMatrix matrix) throws OrtException {
    return OnnxTensor.createTensor(
        environment,
        FloatBuffer.wrap(matrix.values()),
        new long[] {matrix.rows(), matrix.columns()});
  }

  private static ActorMatrix matrix(OrtSession.Result result, String name, int rows, int width) {
    var value = result.get(name).orElseThrow();
    if (!(value instanceof OnnxTensor tensor)
        || tensor.getInfo().type != OnnxJavaType.FLOAT
        || !java.util.Arrays.equals(tensor.getInfo().getShape(), new long[] {rows, width}))
      throw new IllegalArgumentException("invalid CPU actor output " + name);
    var values = new float[rows * width];
    tensor.getFloatBuffer().get(values);
    return new ActorMatrix(rows, width, values);
  }

  @Override
  public synchronized void close() {
    if (closed) return;
    closed = true;
    try {
      session.close();
    } catch (OrtException failure) {
      throw new IllegalStateException("cannot close CPU actor", failure);
    }
  }
}
