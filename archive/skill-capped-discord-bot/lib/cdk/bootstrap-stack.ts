import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { createDeploymentResources } from "./deployment-user";

export class BootstrapStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    createDeploymentResources(this);
  }
}
