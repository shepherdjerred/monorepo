import { Stack, StackProps } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import { IHostedZone, HostedZone } from "aws-cdk-lib/aws-route53";
import { Topic } from "aws-cdk-lib/aws-sns";
import { KeyPair } from "cdk-ec2-key-pair";
import { Construct } from "constructs";
import { createBudgets } from "./budget";
import { createDeploymentResources } from "./deployment-user";
import { createVpc } from "./vpc";
import { createRecords } from "./google-workspace-records";
import { createKeyPair } from "./key-pair";
import createEmailNotificationSnsTopic from "./sns";
import { createDataLifecycleManager } from "./backups";
import { createSesResources } from "./ses";
import { createKimsufiResources } from "./kimsufi";

export class BootstrapStack extends Stack {
  public readonly keyPair: KeyPair;
  public readonly hostedZone: IHostedZone;
  public readonly vpc: Vpc;
  public readonly snsTopic: Topic;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    createDataLifecycleManager(this);
    createDeploymentResources(this);
    this.snsTopic = createEmailNotificationSnsTopic(this);
    this.vpc = createVpc(this);
    this.keyPair = createKeyPair(this);
    createBudgets(this);

    this.hostedZone = HostedZone.fromHostedZoneAttributes(this, "HostedZone", {
      hostedZoneId: "Z08292542AN5EM249PS63",
      zoneName: "ts-mc.net",
    });
    createKimsufiResources(this, this.hostedZone);
    createRecords(this, this.hostedZone);
    createSesResources(this);
  }
}
