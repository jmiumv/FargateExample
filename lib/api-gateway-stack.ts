import { HttpApi } from '@aws-cdk/aws-apigatewayv2-alpha';
import { CfnOutput, CfnResource, Stack, StackProps } from "aws-cdk-lib";
import { CfnIntegration, CfnRoute } from 'aws-cdk-lib/aws-apigatewayv2';
import { AmazonLinuxEdition, AmazonLinuxGeneration, AmazonLinuxStorage, AmazonLinuxVirt, Instance, InstanceType, MachineImage, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import { ApplicationListener } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { Construct } from "constructs";

export class ApiGatewayStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    httpVpcLink: CfnResource,
    httpApiListener: ApplicationListener,
    props?: StackProps
  ) {
    super(scope, id, props);

    // Consumer VPC
    const consumerVpc = new Vpc(this, "ConsumerVpc", {
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "ingress",
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    //Security Group
    const bastionSecGrp = new SecurityGroup(this, "BastionSecGrp", {
      allowAllOutbound: true,
      securityGroupName: "BastionSecGrp",
      vpc: consumerVpc,
    });

    bastionSecGrp.connections.allowFromAnyIpv4(Port.tcp(22));

    // AMI
    const amz_linux = MachineImage.latestAmazonLinux({
      generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      edition: AmazonLinuxEdition.STANDARD,
      virtualization: AmazonLinuxVirt.HVM,
      storage: AmazonLinuxStorage.GENERAL_PURPOSE,
    });

    // Instance
    const instance = new Instance(this, "BastionHost", {
      instanceType: new InstanceType("t2.micro"),
      machineImage: amz_linux,
      vpc: consumerVpc,
      securityGroup: bastionSecGrp,
      keyName: "ssh-key",
    });

    // HTTP API
    const api = new HttpApi(this, "http-api", {
      createDefaultStage: true,
    });

    // API Integration
    const integration = new CfnIntegration(
      this,
      "HttpApiGatewayIntegration",
      {
        apiId: api.httpApiId,
        connectionId: httpVpcLink.ref,
        connectionType: "VPC_LINK",
        description: "API Integration",
        integrationMethod: "ANY",
        integrationType: "HTTP_PROXY",
        integrationUri: httpApiListener.listenerArn,
        payloadFormatVersion: "1.0",
      }
    );

    // API Route
    new CfnRoute(this, "Route", {
      apiId: api.httpApiId,
      routeKey: "ANY /{proxy+}",
      target: `integrations/${integration.ref}`,
    });

    // EC2 instance ip address
    new CfnOutput(this, "EC2 public ip address: ", {
      value: instance.instancePublicIp,
    });

    // API and Service Endpoints
    const httpApiEndpoint = api.apiEndpoint;
    const itemsServiceEndpoint = httpApiEndpoint + "/api/items";
    const ratingsServiceEndpoint = httpApiEndpoint + "/api/ratings";

    new CfnOutput(this, "HTTP API endpoint: ", {
      value: httpApiEndpoint,
    });
    new CfnOutput(this, "Items Service: ", {
      value: itemsServiceEndpoint,
    });
    new CfnOutput(this, "Ratings Service: ", {
      value: ratingsServiceEndpoint,
    });
  }
}
