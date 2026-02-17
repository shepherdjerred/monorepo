export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class DscVerificationError extends Error {
  constructor(
    public readonly entityId: string,
    public readonly expectedState: string,
    public readonly actualState: string,
    public readonly workflowName: string,
  ) {
    super(`DSC failed for ${entityId}: expected '${expectedState}' got '${actualState}'`);
    this.name = "DscVerificationError";
  }
}
