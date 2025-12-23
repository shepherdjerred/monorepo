import { Stack } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

// TODO: use 2048 bit encryption
// TODO: setup bounce alerts, email receipts, etc.
// TODO: setup dkim and MAIL-FROM headers
export function createSesResources(stack: Stack) {
  new AwsCustomResource(stack, "VerifyDomainIdentity", {
    onCreate: {
      service: "SES",
      action: "verifyDomainIdentity",
      parameters: {
        Domain: "ts-mc.net",
      },
      physicalResourceId: PhysicalResourceId.fromResponse("VerificationToken"),
    },
    policy: AwsCustomResourcePolicy.fromStatements([
      new PolicyStatement({
        resources: ["*"],
        actions: ["ses:VerifyDomainIdentity"],
      }),
    ]),
  });
}
