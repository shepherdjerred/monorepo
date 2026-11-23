// Exact original RPC1160 argument prefix, borrowing the packet decoder VM.
// This reads two scalar arguments before resource lookup or buff mutation.
import { sha256 } from "./structural-comparison.mjs";
import { NativeDecoder } from "./native-decoder.mjs";

export const BUFF_RESOURCE_ARGUMENT_PROGRAM = Object.freeze({
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  imageSha256:
    "3e119190cfe42ea92e816107df229d3bd390547b846ca75bc161735e155e3ec7",
  opcode: 1160,
  objectBytes: 104,
  startRva: 0x840ab0,
  stopRva: 0x841368,
  prefixSha256:
    "ef3ee8145a2c6299e33e5af70ed60838f70195ab9b6e7343cdbd0d74156e0125",
});

const borrowedDecoders = new WeakSet();
const unusableDecoders = new WeakSet();
const STACK_START = 0x2000f000;
const STACK_BYTES = 0x2000;
const STACK_POINTER = 0x20010008;
const equalBytes = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export async function createLatestBuffResourceArgumentReader({ decoder }) {
  const p = BUFF_RESOURCE_ARGUMENT_PROGRAM;
  const { profile, image, uc, engine } = decoder;
  if (
    profile.clientVersion !== p.build ||
    profile.protocolDigest !== p.protocol ||
    profile.decoderImageSha256 !== p.imageSha256 ||
    profile.callingConvention !== "sysv-x86_64" ||
    profile.packets[p.opcode]?.objectSize !== p.objectBytes ||
    !(image instanceof Uint8Array) ||
    (await sha256(image)) !== p.imageSha256 ||
    (await sha256(image.subarray(p.startRva, p.stopRva))) !== p.prefixSha256
  )
    throw Error("Exact16.21 original buff argument program required");
  const base = profile.imageBase,
    start = base + p.startRva,
    stop = base + p.stopRva;
  let closed = false,
    poisoned = false;

  function read(observation) {
    if (closed || poisoned || unusableDecoders.has(decoder))
      throw Error(
        "Buff argument reader is closed or its VM restoration failed",
      );
    if (borrowedDecoders.has(decoder))
      throw Error("Packet decoder is already borrowed for a buff prefix");
    const { object, heap, complete, heapSize, entryRva } = observation;
    if (
      complete !== true ||
      !(object instanceof Uint8Array) ||
      !(heap instanceof Uint8Array) ||
      object.length !== p.objectBytes ||
      heap.length !== heapSize ||
      heap.length < object.length ||
      heap.length > 0x10000 ||
      entryRva !== profile.packets[p.opcode].entryRva ||
      !equalBytes(object, heap.subarray(0, object.length)) ||
      new DataView(object.buffer, object.byteOffset).getUint32(8, true) !==
        p.opcode
    )
      throw Error(
        "Complete original RPC1160 object and bounded arena required",
      );
    if (
      !equalBytes(
        decoder.read(start, p.stopRva - p.startRva),
        image.subarray(p.startRva, p.stopRva),
      )
    )
      throw Error("Borrowed VM original buff prefix was modified");
    const savedHeap = decoder.read(NativeDecoder.HEAP, heap.length),
      savedStack = decoder.read(STACK_START, STACK_BYTES),
      context = engine.context_alloc(),
      hooks = [];
    let result,
      failure = null,
      active = false,
      contextSaved = false,
      unsafeMutation = false;
    borrowedDecoders.add(decoder);
    const inside = (at, size, origin, bytes) =>
      Number.isSafeInteger(at) &&
      Number.isSafeInteger(size) &&
      size > 0 &&
      at >= origin &&
      at + size <= origin + bytes;
    try {
      engine.context_save(context);
      contextSaved = true;
      hooks.push(
        engine.hook_add(
          uc.HOOK_BLOCK,
          (_engine, address) => {
            const at = Number(address);
            if (active && (at < start || at > stop))
              throw Error("Buff argument execution escaped original prefix");
          },
          null,
          1,
          0,
        ),
      );
      hooks.push(
        engine.hook_add(
          uc.HOOK_MEM_WRITE,
          (_engine, _access, address, size) => {
            if (
              active &&
              !inside(Number(address), size, STACK_START, STACK_BYTES)
            ) {
              unsafeMutation = true;
              throw Error("Buff argument write escaped owned stack");
            }
          },
          null,
          1,
          0,
        ),
      );
      hooks.push(
        engine.hook_add(
          uc.HOOK_MEM_READ,
          (_engine, _access, address, size) => {
            const at = Number(address);
            if (
              active &&
              !inside(at, size, base, image.length) &&
              !inside(at, size, NativeDecoder.HEAP, heap.length) &&
              !inside(at, size, STACK_START, STACK_BYTES)
            )
              throw Error(
                "Buff argument read escaped original arena/image/stack",
              );
          },
          null,
          1,
          0,
        ),
      );
      hooks.push(
        engine.hook_add(
          uc.HOOK_CODE,
          () => engine.emu_stop(),
          null,
          stop,
          stop,
        ),
      );
      engine.mem_write(NativeDecoder.HEAP, heap);
      engine.mem_write(STACK_START, new Uint8Array(STACK_BYTES));
      // RDI is saved only. Execution stops before the first semantic call.
      engine.reg_write_i64(uc.X86_REG_RDI, 0n);
      engine.reg_write_i64(uc.X86_REG_RSI, BigInt(NativeDecoder.HEAP));
      engine.reg_write_i64(uc.X86_REG_RSP, BigInt(STACK_POINTER));
      active = true;
      engine.emu_start(start, stop, 0, 100000);
      active = false;
      if (Number(engine.reg_read_i64(uc.X86_REG_RIP)) !== stop)
        throw Error("Buff argument prefix instruction bound exceeded");
      const descriptor = Number(engine.reg_read_i64(uc.X86_REG_RSI));
      if (!inside(descriptor, 12, STACK_START, STACK_BYTES))
        throw Error("Original buff scalar arguments escaped owned stack");
      const bytes = decoder.read(descriptor + 4, 8),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      result = {
        resourceNameHash: view.getUint32(0, true),
        contextId: view.getUint32(4, true),
      };
    } catch (error) {
      failure = error;
    } finally {
      active = false;
      const cleanup = [];
      const attempt = (action) => {
        try {
          action();
        } catch (error) {
          cleanup.push(error);
        }
      };
      for (const hook of hooks.reverse()) attempt(() => engine.hook_del(hook));
      attempt(() => engine.mem_write(NativeDecoder.HEAP, savedHeap));
      attempt(() => engine.mem_write(STACK_START, savedStack));
      if (contextSaved) attempt(() => engine.context_restore(context));
      attempt(() => engine.context_free(context));
      borrowedDecoders.delete(decoder);
      if (unsafeMutation || cleanup.length) {
        poisoned = true;
        unusableDecoders.add(decoder);
      }
      if (cleanup.length) {
        throw new AggregateError(
          failure === null ? cleanup : [failure, ...cleanup],
          "Borrowed buff VM restoration failed",
          failure === null ? undefined : { cause: failure },
        );
      }
    }
    if (failure !== null) throw failure;
    return result;
  }
  return Object.freeze({
    program: p,
    read,
    close() {
      if (borrowedDecoders.has(decoder))
        throw Error("Cannot close an active borrowed buff reader");
      closed = true;
    },
  });
}
