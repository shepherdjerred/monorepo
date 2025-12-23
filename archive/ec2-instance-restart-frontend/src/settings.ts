import { Instance } from "./instances";

export interface Settings {
  instance: Instance;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
}
