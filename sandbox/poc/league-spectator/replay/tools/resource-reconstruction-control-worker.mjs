import { reconstructLatest } from "../latest-reconstruction.mjs";

// The ordinary reconstruction function runs in a real module worker. Only
// static input loading differs from the browser entrypoint's HTTP loader.
self.onmessage = async ({ data }) => {
  try {
    const { default: createUnicorn } = await import(data.runtimeModuleUrl);
    const { decompress } = await import(data.decompressModuleUrl);
    const report = await reconstructLatest({
      ...data.inputs,
      uc: await createUnicorn(),
      decompress,
    });
    self.postMessage({ ok: true, report });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: { name: error.name, message: error.message },
    });
  }
};
