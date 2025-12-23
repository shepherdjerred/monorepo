import { App } from "aws-cdk-lib";
import "source-map-support/register";
import { BootstrapStack } from "./bootstrap-stack";
import { LambdaStack } from "./lambda-stack";

const app = new App();
const props = {
  availabilityZone: "us-west-2a",
  env: {
    account: "692594597524",
    region: "us-west-2",
  },
};

new BootstrapStack(app, "BootstrapStack", props);
new LambdaStack(app, "LambdaStack", props);
