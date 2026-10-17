export class NativeQuarantineProtection extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "NativeQuarantineProtection";
  }
}
