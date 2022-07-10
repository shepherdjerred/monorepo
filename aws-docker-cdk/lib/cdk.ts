#!/usr/bin/env node
import "source-map-support/register";
import { AwsDockerCdkStack } from "./aws-docker-cdk-stack";
import { ContinuousDeliveryStack } from "./continuous-delivery-stack";
import { App } from "monocdk";

const env = {
  account: process.env["CDK_DEFAULT_ACCOUNT"],
  region: process.env["CDK_DEFAULT_REGION"],
};

const app = new App();
new AwsDockerCdkStack(app, "AwsDockerCdkStack", {
  env,
});

new ContinuousDeliveryStack(app, "AwsDockerCdkContinuousDeliveryStack", {
  env,
});
