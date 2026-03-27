export type PermissionRequest = {
  jobId: string;
  agent: string;
  toolName: string;
  toolInput: string;
  expiresAt: Date;
};

export type PermissionDecision = {
  approved: boolean;
  decidedBy: string;
  reason?: string | undefined;
  decidedAt: Date;
};
