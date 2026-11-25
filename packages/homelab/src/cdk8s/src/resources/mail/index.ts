import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import { Cpu, DeploymentStrategy, EnvValue, Secret } from "cdk8s-plus-31";
import { tailnetService } from "homelab/src/platform-model.ts";
import { restrictedContainer } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  MAIL_API_ENDPOINT,
  MAIL_SMTP_ENDPOINT,
  MAIL_UI_ENDPOINT,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/endpoint.ts";
import { flagsEnv } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";
import { FirstPartyWebService } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/web-service.ts";
import {
  dnsEgressRule,
  flagsEgress,
  prometheusIngressRule,
  tailscaleIngressRule,
  tcp,
} from "@shepherdjerred/homelab/cdk8s/src/misc/network-policies.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { firstPartyImageRecipe } from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import {
  createMailSmtpTlsVolume,
  MAIL_SMTP_TLS_ENV,
  MAIL_SMTP_TLS_MOUNT_PATH,
} from "./mail-smtp.ts";

export const MAIL_ACTIVE = true;

export function createMailDeployment(chart: Chart) {
  const smtpTlsVolume = createMailSmtpTlsVolume(chart);

  const webService = new FirstPartyWebService(chart, "mail-web-service", {
    name: "mail",
    port: MAIL_UI_ENDPOINT.port,
    probes: { live: "/healthz", ready: "/readyz" },
    deployment: {
      strategy: DeploymentStrategy.recreate(),
      automountServiceAccountToken: false,
      securityContext: { fsGroup: 1000 },
    },
    data: {
      id: "mail-data",
      storage: Size.gibibytes(2),
      path: "/var/lib/mail",
    },
    containers: () => {
      const secretsItem = onePasswordSecret(
        chart,
        "mail-secrets-1p",
        "mail-secrets",
        { name: "mail-secrets" },
      );
      const mailSecret = Secret.fromSecretName(
        chart,
        "mail-secret-ref",
        secretsItem.name,
      );
      return {
        server: {
          image: firstPartyImageRecipe("mail"),
          securityContext: restrictedContainer(1000),
          resources: {
            cpu: { request: Cpu.millis(50), limit: Cpu.millis(500) },
            memory: {
              request: Size.mebibytes(128),
              limit: Size.mebibytes(512),
            },
          },
          envVariables: {
            ...MAIL_SMTP_TLS_ENV,
            ...flagsEnv({ deployment: "mail/prod" }),
            ENVIRONMENT: EnvValue.fromValue("production"),
            HOME: EnvValue.fromValue("/tmp"),
            HOST: EnvValue.fromValue("0.0.0.0"),
            PORT: EnvValue.fromValue(String(MAIL_UI_ENDPOINT.port)),
            MAIL_API_PORT: EnvValue.fromValue(String(MAIL_API_ENDPOINT.port)),
            MAIL_SMTP_PORT: EnvValue.fromValue(String(MAIL_SMTP_ENDPOINT.port)),
            MAIL_DATABASE_PATH: EnvValue.fromValue("/var/lib/mail/mail.sqlite"),
            FASTMAIL_SMTP_HOST: EnvValue.fromValue("smtp.fastmail.com"),
            FASTMAIL_SMTP_PORT: EnvValue.fromValue("587"),
            FASTMAIL_SMTP_REQUIRE_TLS: EnvValue.fromValue("true"),
            FASTMAIL_SMTP_USERNAME: EnvValue.fromSecretValue({
              secret: mailSecret,
              key: "FASTMAIL_SMTP_USERNAME",
            }),
            FASTMAIL_SMTP_PASSWORD: EnvValue.fromSecretValue({
              secret: mailSecret,
              key: "FASTMAIL_SMTP_PASSWORD",
            }),
            MAIL_CLIENTS_JSON: EnvValue.fromSecretValue({
              secret: mailSecret,
              key: "MAIL_CLIENTS_JSON",
            }),
          },
        },
      };
    },
    serviceName: "mail",
    tailscale: {
      probePath: "/healthz",
      hosts: [
        {
          id: "mail-ingress",
          host: tailnetService("mail"),
        },
      ],
    },
    policies: [
      {
        name: "mail-app-netpol",
        selects: "app",
        ingress: [
          tailscaleIngressRule([MAIL_UI_ENDPOINT.port]),
          prometheusIngressRule([MAIL_UI_ENDPOINT.port]),
        ],
        egress: [
          dnsEgressRule(),
          flagsEgress(),
          {
            // Authenticated STARTTLS submission relay to [smtp.fastmail.com]:587.
            to: [{ ipBlock: { cidr: "0.0.0.0/0" } }],
            ports: [tcp(587)],
          },
        ],
      },
    ],
  });

  const serverContainer = webService.deployment.containers[0];
  if (serverContainer === undefined) {
    throw new Error("Expected server container on mail Deployment");
  }
  serverContainer.mount(MAIL_SMTP_TLS_MOUNT_PATH, smtpTlsVolume, {
    readOnly: true,
  });
  serverContainer.addPort({
    name: MAIL_API_ENDPOINT.portName,
    number: MAIL_API_ENDPOINT.port,
  });
  serverContainer.addPort({
    name: MAIL_SMTP_ENDPOINT.portName,
    number: MAIL_SMTP_ENDPOINT.port,
  });
  webService.service.bind(MAIL_API_ENDPOINT.port, {
    name: MAIL_API_ENDPOINT.portName,
  });
  webService.service.bind(MAIL_SMTP_ENDPOINT.port, {
    name: MAIL_SMTP_ENDPOINT.portName,
  });

  return webService;
}
