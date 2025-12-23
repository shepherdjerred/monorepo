# AWS Docker CDK

[![License](https://img.shields.io/github/license/shepherdjerred/aws-docker-cdk)](https://github.com/shepherdjerred/aws-docker-cdk/LICENSE)
![Node.js CI](https://github.com/shepherdjerred/aws-docker-cdk/workflows/CI%2FCD/badge.svg)

## Manual Deployment/Bootstrapping

AWS credentials must be set before running.

```
npm run cdk synth
npm run cdk deploy AwsDockerCdkStack
npm run cdk deploy AwsDockerCdkContinuousDeliveryStack
```
