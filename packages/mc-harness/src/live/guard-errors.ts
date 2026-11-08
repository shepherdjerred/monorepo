export class LiveGuardRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveGuardRefusal";
  }
}
