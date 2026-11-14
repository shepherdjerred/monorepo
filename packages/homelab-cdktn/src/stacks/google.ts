import type { Construct } from "constructs";
import {
  TerraformIterator,
  TerraformLocal,
  TerraformOutput,
  TerraformVariable,
  Token,
} from "cdktn";
import { ApikeysKey } from "#generated/providers/google/apikeys-key/index.ts";
import { BillingBudget } from "#generated/providers/google/billing-budget/index.ts";
import { CloudQuotasQuotaPreference } from "#generated/providers/google/cloud-quotas-quota-preference/index.ts";
import { DataGoogleBillingAccount } from "#generated/providers/google/data-google-billing-account/index.ts";
import { Project } from "#generated/providers/google/project/index.ts";
import { ProjectService } from "#generated/providers/google/project-service/index.ts";
import { GoogleProvider } from "#generated/providers/google/provider/index.ts";
import { ServiceAccount } from "#generated/providers/google/service-account/index.ts";
import { OnepasswordProvider } from "#generated/providers/onepassword/provider/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { onePasswordWrite } from "#src/onepassword.ts";

const GEMINI_API = "generativelanguage.googleapis.com";

/**
 * APIs enabled on every workload project. Monitoring is there because the
 * quota decrease safety check reads current usage from it.
 */
const PROJECT_SERVICES = [
  "apikeys.googleapis.com",
  "cloudquotas.googleapis.com",
  GEMINI_API,
  "monitoring.googleapis.com",
];

const WORKLOADS_TYPE = `map(object({
  project_id = string
  display_name = string
  monthly_budget_usd = number
  ai_studio_spend_cap_usd = number
  gemini_key_revision = number
  onepassword_item_title = string
  gemini_quota_limits = map(object({
    requests_per_day = optional(number)
    requests_per_minute = number
  }))
}))`;

/**
 * One `<workload>/<model>/<period>` entry per quota a workload declares: the
 * per-minute limit always, the per-day limit only when it is set. HCL `for`
 * expressions have no cdktn builder, so the expression is passed whole.
 */
const GEMINI_QUOTA_LIMITS = `\${merge([
  for workload, config in var.google_workloads : merge([
    for model, limit in config.gemini_quota_limits : merge(
      limit.requests_per_day == null ? {} : {
        "\${workload}/\${model}/day" = {
          workload = workload
          model    = model
          quota_id = "GenerateRequestsPerDayPerProjectPerModel"
          value    = limit.requests_per_day
        }
      },
      {
        "\${workload}/\${model}/minute" = {
          workload = workload
          model    = model
          quota_id = "GenerateRequestsPerMinutePerProjectPerModel"
          value    = limit.requests_per_minute
        }
      },
    )
  ]...)
]...)}`;

/**
 * One Gemini API project per app and environment, with its budget alert,
 * request quotas and service-account-bound API key. Operator-only: see the
 * provider note below and `src/tofu/README.md`. The values come from the
 * stack's `desired-state.json`, which the stack runner injects as variables.
 */
export class GoogleStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "google", {
      requiredVersion: ">= 1.9.0",
      providerConstraints: { google: "~> 8.4", onepassword: "~> 3.0" },
    });
    encryptStateAndPlans(this, {
      description:
        "OpenTofu state and plan encryption passphrase from 1Password",
      errorMessage:
        "The OpenTofu state encryption passphrase must be at least 16 characters.",
    });

    const billingAccount = new TerraformVariable(
      this,
      "google_billing_account_id",
      {
        description:
          "Cloud Billing account every LLM project bills to (XXXXXX-XXXXXX-XXXXXX)",
        type: "string",
      },
    );
    // Passed whole: `Fn` would escape the pattern's braces and anchor.
    billingAccount.addValidation({
      condition:
        '${can(regex("^[0-9A-F]{6}-[0-9A-F]{6}-[0-9A-F]{6}$", var.google_billing_account_id))}',
      errorMessage:
        "google_billing_account_id must look like 012345-6789AB-CDEF01.",
    });

    const quotaProject = new TerraformVariable(
      this,
      "google_quota_project_id",
      {
        description:
          "Existing project that user credentials bill API quota to; created once by hand",
        type: "string",
      },
    );

    // `ai_studio_spend_cap_usd` is applied by hand in AI Studio's Spend tab
    // and recorded here so the value has one reviewed home; see the budget
    // below for why.
    const workloads = new TerraformVariable(this, "google_workloads", {
      description:
        "One Gemini API project per app and environment, keyed app-env",
      type: WORKLOADS_TYPE,
      default: {},
    });
    workloads.addValidation({
      condition:
        "${alltrue([for workload in values(var.google_workloads) : length(workload.project_id) >= 6 && length(workload.project_id) <= 30])}",
      errorMessage: "Google project IDs must be 6 to 30 characters.",
    });
    // A cap above the budget would let the alert fire only after the money
    // is already spent past the point the cap should have stopped it.
    workloads.addValidation({
      condition:
        "${alltrue([for workload in values(var.google_workloads) : workload.ai_studio_spend_cap_usd <= workload.monthly_budget_usd])}",
      errorMessage:
        "ai_studio_spend_cap_usd must not exceed monthly_budget_usd.",
    });

    // Operator-applied with the operator's own Application Default
    // Credentials (`gcloud auth application-default login`), never planned in
    // CI.
    //
    // Without a Google Cloud organization, only a user account can create
    // projects (a service account has nowhere to hold
    // `resourcemanager.projects.create`), so a stored bootstrap key could not
    // do this stack's main job anyway. Budgets and the IAM APIs also reject
    // user credentials that have no quota project, which is what
    // `billing_project` provides: an existing project the operator
    // designates once, see the credential rotation how-to.
    new GoogleProvider(this, "google", {
      billingProject: quotaProject.stringValue,
      userProjectOverride: true,
    });

    // Writes each minted key into its own 1Password item. Authenticates
    // through the 1Password desktop app for the account named by OP_ACCOUNT,
    // the same operator session that runs this stack.
    new OnepasswordProvider(this, "onepassword");

    new TerraformLocal(
      this,
      "project_services",
      `\${toset(${JSON.stringify(PROJECT_SERVICES)})}`,
    );
    const workloadServices = new TerraformLocal(
      this,
      "workload_services",
      '${{ for pair in setproduct(keys(var.google_workloads), local.project_services) : "${pair[0]}/${pair[1]}" => { workload = pair[0], service = pair[1] } }}',
    );
    const quotaLimits = new TerraformLocal(
      this,
      "gemini_quota_limits",
      GEMINI_QUOTA_LIMITS,
    );

    const byWorkload = (): TerraformIterator =>
      TerraformIterator.fromMap(Token.asAnyMap(workloads.value));

    // Several resource types share the HCL names `workload` and `gemini`,
    // but construct ids are unique per scope, so each takes a distinct id
    // and keeps its address through `overrideLogicalId`.

    // One project per app and environment. The Gemini API meters, caps, and
    // bills per project, so this is the unit a runaway can be seen and
    // stopped at.
    const project = byWorkload();
    new Project(this, "project_workload", {
      forEach: project,
      projectId: project.getString("project_id"),
      name: project.getString("display_name"),
      billingAccount: billingAccount.stringValue,
      deletionPolicy: "PREVENT",
    }).overrideLogicalId("workload");

    const service = TerraformIterator.fromMap(workloadServices.asAnyMap);
    const services = new ProjectService(this, "project_service_workload", {
      forEach: service,
      project: "${google_project.workload[each.value.workload].project_id}",
      service: service.getString("service"),
      disableOnDestroy: false,
    });
    services.overrideLogicalId("workload");

    // The identity an authorization key is bound to. Gemini API requests
    // made with the key are processed as this account, which is what lets a
    // leaked key be disabled by disabling one account. The Gemini API is
    // allowed for authorization keys by default, so the account needs no
    // project role.
    new ServiceAccount(this, "gemini_key", {
      forEach: byWorkload(),
      project: "${google_project.workload[each.key].project_id}",
      accountId: "gemini-auth-key",
      displayName: "Gemini API authorization key for ${each.key}",
      dependsOn: [services],
    });

    new DataGoogleBillingAccount(this, "llm", {
      billingAccount: billingAccount.stringValue,
    });

    // Early warning, not the stop. The hard stop is the Gemini API's
    // per-project monthly spend cap, which exists only in AI Studio's Spend
    // tab (there is no API for it), so its value lives in
    // `ai_studio_spend_cap_usd` for review and is applied by hand. That cap
    // enforces with roughly a ten-minute delay, so this budget fires at
    // fractions of the monthly amount and on forecast, to be seen before the
    // cap has to do anything.
    new BillingBudget(this, "billing_budget_workload", {
      forEach: byWorkload(),
      billingAccount: "${data.google_billing_account.llm.id}",
      displayName: "llm ${each.key}",
      budgetFilter: {
        projects: ["projects/${google_project.workload[each.key].number}"],
        calendarPeriod: "MONTH",
        creditTypesTreatment: "INCLUDE_ALL_CREDITS",
      },
      amount: {
        specifiedAmount: {
          currencyCode: "USD",
          units: "${tostring(each.value.monthly_budget_usd)}",
        },
      },
      thresholdRules: [
        { thresholdPercent: 0.5 },
        { thresholdPercent: 0.9 },
        { thresholdPercent: 1 },
        { thresholdPercent: 1, spendBasis: "FORECASTED_SPEND" },
      ],
    }).overrideLogicalId("workload");

    // Hard per-model request ceilings for each workload's Gemini project.
    //
    // The AI Studio spend cap is the monthly dollar stop, but it has no API
    // and lags about ten minutes. These quotas apply immediately and live in
    // code: the per-minute limit throttles a runaway loop, and an optional
    // per-day limit bounds a single day.
    //
    // Google rejects a decrease of more than 10% unless the request ignores
    // both the below-usage and the percentage safety check, and this
    // resource can ignore only one. A large per-day decrease therefore needs
    // a one-time Cloud Quotas API call followed by an import; increases
    // apply normally.
    //
    // The `model` dimension uses Cloud Quotas names, which can differ from
    // the API model id (gemini-3-pro-image-preview is metered as
    // gemini-3-pro-image).
    const quota = TerraformIterator.fromMap(quotaLimits.asAnyMap);
    new CloudQuotasQuotaPreference(this, "quota_preference_gemini", {
      forEach: quota,
      parent:
        "projects/${google_project.workload[each.value.workload].project_id}",
      service: GEMINI_API,
      quotaId: quota.getString("quota_id"),
      dimensions: { model: quota.getString("model") },
      justification:
        "Runaway guard for ${each.value.workload}: bounds worst-case daily Gemini spend",
      // The below-usage check cannot read usage for a project that has never
      // called the API, and these projects' limits are set before first use,
      // so current usage is zero by construction.
      ignoreSafetyChecks: "QUOTA_DECREASE_BELOW_USAGE",
      quotaConfig: { preferredValue: "${tostring(each.value.value)}" },
      dependsOn: [services],
    }).overrideLogicalId("gemini");

    // One service-account-bound Gemini API key per workload, restricted to
    // the Gemini API. The key string lands in this stack's encrypted state
    // and in the workload's own 1Password item, which the cluster syncs as
    // GEMINI_API_KEY.
    //
    // Rotation is a reviewed change: bump gemini_key_revision. The key name
    // changes, so OpenTofu mints and hands off the replacement before
    // deleting the old key, and a pod restart picks up the new value.
    new ApikeysKey(this, "apikeys_key_gemini", {
      forEach: byWorkload(),
      project: "${google_project.workload[each.key].project_id}",
      name: "gemini-${each.key}-r${each.value.gemini_key_revision}",
      displayName:
        "Gemini API key for ${each.key} (revision ${each.value.gemini_key_revision})",
      serviceAccountEmail:
        "${google_service_account.gemini_key[each.key].email}",
      restrictions: { apiTargets: [{ service: GEMINI_API }] },
      lifecycle: { createBeforeDestroy: true },
      dependsOn: [services],
    }).overrideLogicalId("gemini");

    const item = byWorkload();
    onePasswordWrite(this, "onepassword_item_gemini", {
      forEach: item,
      title: item.getString("onepassword_item_title"),
      category: "secure_note",
      section: "credentials",
      fields: {
        GEMINI_API_KEY: "${google_apikeys_key.gemini[each.key].key_string}",
      },
    }).overrideLogicalId("gemini");

    // What still needs a person: the AI Studio spend cap has no API. Not
    // secrets.
    new TerraformOutput(this, "google_gemini_spend_caps", {
      description:
        "Per-workload project and the AI Studio spend cap to set by hand",
      value:
        "${{ for key, project in google_project.workload : key => { project_id = project.project_id, ai_studio_spend_cap_usd = var.google_workloads[key].ai_studio_spend_cap_usd, onepassword_item_title = onepassword_item.gemini[key].title } }}",
    });
  }
}
