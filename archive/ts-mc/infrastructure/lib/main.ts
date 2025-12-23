#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ForumStack } from "./forum/stack";
import { BootstrapStack } from "./bootstrap-stack";

const app = new cdk.App();
const props = {
  availabilityZone: "us-west-2a",
  env: {
    account: "753834062409",
    region: "us-west-2",
  },
};

const bootstrapStack = new BootstrapStack(app, "BootstrapStack", props);
new ForumStack(app, "ForumsStack", {
  ...props,
  vpc: bootstrapStack.vpc,
  hostedZone: bootstrapStack.hostedZone,
  keyPair: bootstrapStack.keyPair,
});
