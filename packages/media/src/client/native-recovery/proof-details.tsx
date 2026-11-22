import type { ReactNode } from "react";

export function RecoveryProofDetails(proof: {
  planHash: string | null;
  expiresAt: string | null;
  children: ReactNode;
}) {
  return (
    <details>
      <summary>Operator proof details</summary>
      <p>Plan digest: {proof.planHash ?? "Pending inspection"}</p>
      <p>
        Review expires:{" "}
        {proof.expiresAt === null
          ? "Not prepared"
          : new Date(proof.expiresAt).toLocaleString()}
      </p>
      {proof.children}
    </details>
  );
}
