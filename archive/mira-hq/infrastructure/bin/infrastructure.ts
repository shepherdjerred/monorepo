#!/usr/bin/env node
import "source-map-support/register";
import { InfrastructureStack } from "../lib/infrastructure-stack";
import { App } from "monocdk";

const app = new App();
new InfrastructureStack(app, "MiraHqInfrastructure");
