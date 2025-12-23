import { RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";

export function createS3Resources(stack: Stack): Bucket {
  return new Bucket(stack, "Bucket", {
    encryption: BucketEncryption.KMS_MANAGED,
    bucketName: "com.shepherdjerred.manifests",
    autoDeleteObjects: true,
    removalPolicy: RemovalPolicy.DESTROY,
    publicReadAccess: false,
    blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  });
}
