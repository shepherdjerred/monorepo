import { LatestParticleWorkerClient } from "./latest-particle-worker-client.mjs";
import { assertDirectCompiledDataGraph } from "./latest-direct-compiled-restore.mjs";
import { consumeDirectInitializationTransfer } from "./latest-direct-initialization-ownership.mjs";

export class LatestDirectEffectClient extends LatestParticleWorkerClient {
  constructor(options = {}) {
    super({
      workerUrl: new URL("./latest-direct-effect-worker.mjs", import.meta.url),
      ...options,
    });
  }
  async initialize(payload, { ownedInitialization = null } = {}) {
    const started = performance.now();
    if (this.initializationAttempted)
      throw Error("Direct worker initialization is one-use");
    this.initializationAttempted = true;
    assertDirectCompiledDataGraph(payload.definitions);
    const validated = performance.now(),
      plan =
        ownedInitialization === null
          ? null
          : consumeDirectInitializationTransfer(ownedInitialization, payload),
      ownershipValidated = performance.now(),
      promise = this.request("initialize", payload, plan?.transfers ?? []),
      posted = performance.now(),
      result = await promise;
    const accounting = result.initializationAccounting;
    if (
      !accounting ||
      !Number.isSafeInteger(accounting.uniqueBuffers) ||
      accounting.uniqueBuffers < 0 ||
      !Number.isSafeInteger(accounting.uniqueBufferBytes) ||
      accounting.uniqueBufferBytes < 0 ||
      !Number.isSafeInteger(accounting.referencedViewBytes) ||
      accounting.referencedViewBytes < 0 ||
      !Number.isFinite(accounting.workerAccountingMs) ||
      accounting.workerAccountingMs < 0
    )
      throw Error("Worker initialization byte accounting required");
    return {
      ...result,
      initializationTransport: {
        uniqueBuffers: accounting.uniqueBuffers,
        uniqueBufferBytes: accounting.uniqueBufferBytes,
        referencedViewBytes: accounting.referencedViewBytes,
        wireBytes: null,
        clientValidationCpuMs: validated - started,
        clientOwnershipCpuMs: ownershipValidated - validated,
        synchronousPostMessageMs: posted - ownershipValidated,
        clientSynchronousPreparationMs: posted - started,
        roundTripMs: performance.now() - started,
        workerAccountingMs: accounting.workerAccountingMs,
        accountingLocation: "worker",
        producerPreparationCpuMs: plan?.producerPreparationCpuMs ?? 0,
        ticketPreparationCpuMs: plan?.ticketPreparationCpuMs ?? 0,
        producerScopes: plan?.scopes ?? [],
        isolatedMemoryCopy: false,
        transferredBuffers: plan?.transferredBuffers ?? 0,
        transferredBufferBytes: plan?.transferredBufferBytes ?? 0,
        explicitSessionOwnership: plan !== null,
      },
    };
  }
  async drawRequest(type, payload) {
    const startedAtEpochMs = performance.timeOrigin + performance.now();
    const packet = await this.request(type, payload);
    const receivedAtEpochMs = performance.timeOrigin + performance.now();
    const transport = packet.metrics?.transport;
    if (
      !transport ||
      ![
        transport.receivedAtEpochMs,
        transport.processingAtEpochMs,
        transport.replyReadyAtEpochMs,
      ].every(Number.isFinite) ||
      !Number.isSafeInteger(transport.drawBufferBytes) ||
      transport.drawBufferBytes < 0
    )
      throw Error("Direct worker omitted its draw transport measurements");
    packet.metrics.transport = {
      ...transport,
      startedAtEpochMs,
      clientReceivedAtEpochMs: receivedAtEpochMs,
      roundTripMs: receivedAtEpochMs - startedAtEpochMs,
      requestDeliveryMs: transport.receivedAtEpochMs - startedAtEpochMs,
      workerQueueMs:
        transport.processingAtEpochMs - transport.receivedAtEpochMs,
      replyDeliveryMs: receivedAtEpochMs - transport.replyReadyAtEpochMs,
      // Delivery includes serialization and scheduling on both threads. It is
      // not an isolated memory-copy measurement or GPU upload/execution time.
      deliveryIncludesScheduling: true,
    };
    return packet;
  }
  frame(time, camera) {
    return this.drawRequest("advance", { time, camera });
  }
  camera(camera) {
    return this.drawRequest("camera", { camera });
  }
  checkpoint() {
    return this.request("checkpoint", {});
  }
  restore(state) {
    return this.request("restore", state);
  }
  coverage() {
    return this.request("coverage", {});
  }
}
