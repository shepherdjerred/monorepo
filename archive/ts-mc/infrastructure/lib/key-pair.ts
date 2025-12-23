import { Stack } from "aws-cdk-lib";
import { KeyPair } from "cdk-ec2-key-pair";

export function createKeyPair(stack: Stack): KeyPair {
  return new KeyPair(stack, "KeyPair", {
    name: "tsmc",
    description: "Key pair for instances",
    storePublicKey: true,
  });
}
