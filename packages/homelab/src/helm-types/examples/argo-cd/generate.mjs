import {
  convertToTypeScriptInterface,
  fetchHelmChart,
  generateTypeScriptCode,
} from "@shepherdjerred/helm-types";

const chart = {
  name: "argo-cd",
  chartName: "argo-cd",
  repoUrl: "https://argoproj.github.io/argo-helm",
  version: "7.7.16",
};

const { schema, values, yamlComments } = await fetchHelmChart(chart);
const types = convertToTypeScriptInterface({
  values,
  interfaceName: "ArgoCdValues",
  schema,
  yamlComments,
  chartName: chart.name,
});

process.stdout.write(generateTypeScriptCode(types, chart.name));
