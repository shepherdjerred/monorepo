import { App } from "cdk8s";
import { setupCharts } from "./setup-charts.ts";

const app = new App();
await setupCharts(app);
app.synth();
