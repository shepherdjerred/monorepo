import {
  AuthenticationV1Api,
  AuthorizationV1Api,
  type KubeConfig,
} from "@kubernetes/client-node";
import { DELIVERY_MINECRAFT_REPORT_READER as reader } from "@shepherdjerred/ops-model/delivery-readers.ts";

/**
 * Admits only a token minted for this controller's audience whose subject
 * RBAC allows `get` on this request's virtual report resource. The
 * executor's bearer token is never a reader credential (D5, I2). The
 * controller's own identity needs create on tokenreviews and
 * subjectaccessreviews.
 */
export function kubernetesReportAuthorizer(config: KubeConfig) {
  const authentication = config.makeApiClient(AuthenticationV1Api);
  const authorization = config.makeApiClient(AuthorizationV1Api);
  return async (token: string, requestId: string): Promise<boolean> => {
    const review = await authentication.createTokenReview({
      body: {
        apiVersion: "authentication.k8s.io/v1",
        kind: "TokenReview",
        spec: { token, audiences: [reader.audience] },
      },
    });
    const status = review.status;
    const user = status?.user;
    // An audience-unaware answer means the API server's audience, not ours.
    if (
      status?.authenticated !== true ||
      status.audiences?.includes(reader.audience) !== true ||
      user?.username === undefined
    )
      return false;
    const access = await authorization.createSubjectAccessReview({
      body: {
        apiVersion: "authorization.k8s.io/v1",
        kind: "SubjectAccessReview",
        spec: {
          user: user.username,
          groups: user.groups ?? [],
          extra: user.extra ?? {},
          ...(user.uid === undefined ? {} : { uid: user.uid }),
          resourceAttributes: {
            namespace: reader.namespace,
            verb: "get",
            group: reader.rule.apiGroups[0],
            resource: reader.rule.resources[0],
            name: requestId,
          },
        },
      },
    });
    return access.status?.allowed === true;
  };
}
