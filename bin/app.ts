#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import "source-map-support/register";
import { ApiGatewayStack } from "../lib/api-gateway-stack";
import { FargateStack } from "../lib/fargate-stack";



const app = new App();
const fargateVpclinkStack = new FargateStack(app, "FargateStack", { env: { region: "us-west-2" } });
new ApiGatewayStack(app, "ApiGatewayStack", fargateVpclinkStack.httpVpcLink, fargateVpclinkStack.httpApiListener, { env: { region: "us-west-2" } });

