// A replacement or failed load cannot publish late asynchronous results into
// the current replay. Loading owns world presentation until all inputs exist.
export class LatestViewerReplayLoad {
  #current = null;
  #loading = false;

  get loading() {
    return this.#loading;
  }

  begin() {
    this.#loading = true;
    return (this.#current = Object.freeze({}));
  }

  isCurrent(token) {
    return token !== null && this.#current === token;
  }

  assertCurrent(token) {
    if (!this.isCurrent(token))
      throw new DOMException("Replay replaced during loading", "AbortError");
  }

  async wait(token, pending) {
    const result = await pending;
    this.assertCurrent(token);
    return result;
  }

  complete(token) {
    this.assertCurrent(token);
    this.#loading = false;
  }

  invalidate() {
    this.#current = null;
    this.#loading = false;
  }
}
