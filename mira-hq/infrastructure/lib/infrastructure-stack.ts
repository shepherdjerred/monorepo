import { Construct, Duration, Stack, StackProps } from "monocdk";
import { BlockPublicAccess, Bucket } from "monocdk/aws-s3";
import { Effect, ManagedPolicy, PolicyStatement, User } from "monocdk/aws-iam";
import {
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  HttpVersion,
  OriginAccessIdentity,
  ViewerProtocolPolicy,
} from "monocdk/aws-cloudfront";
import { Function, Runtime, Code, Tracing } from "monocdk/aws-lambda";
import {
  ARecord,
  HostedZone,
  RecordTarget,
  RecordSet,
  RecordType,
} from "monocdk/aws-route53";
import {
  Certificate,
  CertificateValidation,
} from "monocdk/aws-certificatemanager";
import { S3Origin } from "monocdk/aws-cloudfront-origins";
import {
  CloudFrontTarget,
  ApiGatewayv2Domain,
} from "monocdk/aws-route53-targets";
import { RetentionDays } from "monocdk/lib/aws-logs";
import {
  HttpApi,
  HttpMethod,
  PayloadFormatVersion,
  DomainName,
} from "monocdk/lib/aws-apigatewayv2";
import { LambdaProxyIntegration } from "monocdk/lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "monocdk/lib/aws-dynamodb";

export class InfrastructureStack extends Stack {
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
      userName: "CdkDeploymentUser",
      managedPolicies: [policy],
    });

    const blockPublicAccess = new BlockPublicAccess({
      blockPublicAcls: true,
      blockPublicPolicy: true,
      ignorePublicAcls: true,
      restrictPublicBuckets: true,
    });

    const bucket = new Bucket(this, "FrontEndBucket", {
      versioned: true,
      blockPublicAccess,
    });

    const comment = "mira-hq-frontend";
    const identity = new OriginAccessIdentity(this, "OriginAccessIdentity", {
      comment,
    });

    bucket.addToResourcePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [identity.grantPrincipal],
        actions: ["s3:GetObject"],
        resources: [bucket.bucketArn + "/*"],
      })
    );

    const domainName = "mira-hq.com";

    const hostedZone = new HostedZone(this, "HostedZone", {
      zoneName: domainName,
    });

    const certificate = new Certificate(this, "Certificate", {
      domainName,
      subjectAlternativeNames: ["*." + domainName],
      validation: CertificateValidation.fromDns(hostedZone),
    });

    const cachePolicy = new CachePolicy(this, "CachePolicy", {
      defaultTtl: Duration.minutes(5),
      cookieBehavior: CacheCookieBehavior.none(),
      headerBehavior: CacheHeaderBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
    });

    const distribution = new Distribution(this, "Distribution", {
      domainNames: [domainName],
      comment,
      defaultBehavior: {
        origin: new S3Origin(bucket, {
          originAccessIdentity: identity,
        }),
        compress: true,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cachePolicy,
      },
      defaultRootObject: "index.html",
      enableIpv6: true,
      httpVersion: HttpVersion.HTTP2,
      certificate,
      enabled: true,
      errorResponses: [
        {
          ttl: Duration.minutes(5),
          responsePagePath: "/index.html",
          responseHttpStatus: 200,
          httpStatus: 404,
        },
        {
          ttl: Duration.minutes(5),
          responsePagePath: "/index.html",
          responseHttpStatus: 200,
          httpStatus: 403,
        },
      ],
    });

    new ARecord(this, "RecordSet", {
      zone: hostedZone,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    const codeBucket = new Bucket(this, "CodeBucket", {
      versioned: true,
      blockPublicAccess,
    });

    const apiSubdomain = "api";

    const lambdaFunction = new Function(this, "LambdaFunction", {
      functionName: "MiraHqBackend",
      runtime: Runtime.NODEJS_14_X,
      handler: "dist/index.graphqlHandler",
      code: Code.fromBucket(codeBucket, "lambda.zip"),
      tracing: Tracing.ACTIVE,
      logRetention: RetentionDays.ONE_MONTH,
      memorySize: 128,
      timeout: Duration.seconds(10),
    });

    const apiDomainName = new DomainName(this, "ApiDomainName", {
      certificate: certificate,
      domainName: `${apiSubdomain}.${domainName}`,
    });

    new HttpApi(this, "HttpApi", {
      corsPreflight: {
        allowCredentials: true,
        allowHeaders: ["*"],
        allowMethods: [HttpMethod.GET, HttpMethod.POST],
        allowOrigins: [`https://${domainName}`],
        exposeHeaders: [],
        maxAge: Duration.minutes(5),
      },
      createDefaultStage: true,
      defaultIntegration: new LambdaProxyIntegration({
        handler: lambdaFunction,
        payloadFormatVersion: PayloadFormatVersion.VERSION_1_0,
      }),
      defaultDomainMapping: {
        domainName: apiDomainName,
      },
    });

    new RecordSet(this, "LambdaRecordSet", {
      zone: hostedZone,
      recordName: apiSubdomain,
      recordType: RecordType.A,
      target: RecordTarget.fromAlias(new ApiGatewayv2Domain(apiDomainName)),
    });

    const s3Policy = new ManagedPolicy(this, "S3DeploymentPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [
            bucket.bucketArn,
            bucket.bucketArn + "/*",
            codeBucket.bucketArn,
            codeBucket.bucketArn + "/*",
          ],
          actions: ["s3:*"],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [lambdaFunction.functionArn],
          actions: [
            "lambda:UpdateFunctionCode",
            "lambda:CreateFunction",
            "lambda:UpdateFunctionConfiguration",
          ],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: ["*"],
          actions: ["iam:ListRoles"],
        }),
      ],
    });

    new User(this, "S3DeploymentUser", {
      userName: "S3DeploymentUser",
      managedPolicies: [s3Policy],
    });

    const lambdaPolicy = new ManagedPolicy(this, "LambdaDeploymentPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [lambdaFunction.functionArn],
          actions: [
            "lambda:UpdateFunctionCode",
            "lambda:CreateFunction",
            "lambda:UpdateFunctionConfiguration",
          ],
        }),
      ],
    });

    new User(this, "LambdaDeploymentUser", {
      userName: "LambdaDeploymentUser",
      managedPolicies: [lambdaPolicy],
    });

    const table = new Table(this, "Table", {
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      tableName: "MiraHq",
      partitionKey: {
        name: "pk1",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "sk1",
        type: AttributeType.STRING,
      },
    });

    lambdaFunction.addToRolePolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        resources: [table.tableArn],
        actions: ["dynamodb:*"],
      })
    );

    const devPolicy = new ManagedPolicy(this, "DevelopmentPolicy", {
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          resources: [table.tableArn],
          actions: ["dynamodb:*"],
        }),
      ],
    });

    new User(this, "DevelopmentUser", {
      userName: "MirahqDevelopment",
      managedPolicies: [devPolicy],
    });
  }
}
