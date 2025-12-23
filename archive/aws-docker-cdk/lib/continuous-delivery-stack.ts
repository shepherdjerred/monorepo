import {
  Effect,
  ManagedPolicy,
  PolicyStatement,
  User,
} from "monocdk/lib/aws-iam";
import { Construct, Stack, StackProps } from "monocdk";

export class ContinuousDeliveryStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // What IAM permissions are needed to use CDK Deploy?
    // https://stackoverflow.com/questions/57118082/what-iam-permissions-are-needed-to-use-cdk-deploy
    const policy = new ManagedPolicy(this, "CdkDeploymentPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["*"],
          actions: ["cloudformation:*"],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["*"],
          actions: ["*"],
          conditions: {
            "ForAnyValue:StringEquals": {
              "aws:CalledVia": ["cloudformation.amazonaws.com"],
            },
          },
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["arn:aws:s3:::cdktoolkit-stagingbucket-*"],
          actions: ["s3:*"],
        }),
      ],
    });

    new User(this, "CdkDeploymentUser", {
      userName: "AwsDockerCdkDeploymentUser",
      managedPolicies: [policy],
    });
  }
}
