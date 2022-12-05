import { CfnResource, Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Port, SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";
import { Repository } from 'aws-cdk-lib/aws-ecr';
import { Cluster, AwsLogDriver, ContainerImage, FargateService, FargateTaskDefinition } from 'aws-cdk-lib/aws-ecs';
import { ApplicationListener, ApplicationLoadBalancer, ListenerAction, ListenerCondition } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ManagedPolicy, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { PrivateDnsNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from "constructs";


export class FargateStack extends Stack {

    //Export Vpclink and ALB Listener
    public readonly httpVpcLink: CfnResource;
    public readonly httpApiListener: ApplicationListener;

    constructor(scope: Construct, id: string, props?: StackProps) {
        super(scope, id, props);

        // VPC
        const producerVpc = new Vpc(this, "ProducerVpc");

        // ECS Cluster
        const cluster = new Cluster(this, "FargateEcsCluster", {
            vpc: producerVpc,
        });

        // Cloud Map Namespace
        const dnsNamespace = new PrivateDnsNamespace(
            this,
            "DnsNamespace",
            {
                name: "http-api.local",
                vpc: producerVpc,
                description: "Private DnsNamespace for Microservices",
            }
        );

        // Task Role
        const baiscEcsTaskRole = new Role(this, "EcsTaskExecutionRole", {
            assumedBy: new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });
        baiscEcsTaskRole.addManagedPolicy(
            ManagedPolicy.fromAwsManagedPolicyName(
                "service-role/AmazonECSTaskExecutionRolePolicy"
            )
        );

        // Task Definitions
        const itemsServiceTaskDefinition = new FargateTaskDefinition(
            this,
            "ItemsServiceTaskDef",
            {
                memoryLimitMiB: 512,
                cpu: 256,
                taskRole: baiscEcsTaskRole,
            }
        );

        const ratingsServiceTaskDefinition = new FargateTaskDefinition(
            this,
            "RatingsServiceTaskDef",
            {
                memoryLimitMiB: 512,
                cpu: 256,
                taskRole: baiscEcsTaskRole,
            }
        );

        // Log Groups
        const itemsServiceLogGroup = new LogGroup(this, "ItemsServiceLogGroup", {
            logGroupName: "/ecs/ItemsService",
            removalPolicy: RemovalPolicy.DESTROY,
        });

        const ratingsServiceLogGroup = new LogGroup(
            this,
            "RatingsServiceLogGroup",
            {
                logGroupName: "/ecs/RatingsService",
                removalPolicy: RemovalPolicy.DESTROY,
            }
        );

        const itemsServiceLogDriver = new AwsLogDriver({
            logGroup: itemsServiceLogGroup,
            streamPrefix: "Itemservice",
        });

        const ratingsServiceLogDriver = new AwsLogDriver({
            logGroup: ratingsServiceLogGroup,
            streamPrefix: "RatingsService",
        });

        // Amazon ECR Repositories
        const itemsServiceRepo = Repository.fromRepositoryName(
            this,
            "ItemService",
            "items-service"
        );

        const ratingsServiceRepo = Repository.fromRepositoryName(
            this,
            "RatingsService",
            "ratings-service"
        );

        // Task Containers
        const itemsServiceContainer = itemsServiceTaskDefinition.addContainer(
            "ItemsServiceContainer",
            {
                image: ContainerImage.fromEcrRepository(itemsServiceRepo),
                logging: itemsServiceLogDriver,
            }
        );

        const ratingsServiceContainer = ratingsServiceTaskDefinition.addContainer(
            "RatingsServiceContainer",
            {
                image: ContainerImage.fromEcrRepository(ratingsServiceRepo),
                logging: ratingsServiceLogDriver,
            }
        );

        itemsServiceContainer.addPortMappings({
            containerPort: 80,
        });

        ratingsServiceContainer.addPortMappings({
            containerPort: 80,
        });

        //Security Groups
        const itemsServiceSecurityGroup = new SecurityGroup(
            this,
            "ItemsServiceSecurityGroup",
            {
                allowAllOutbound: true,
                securityGroupName: "ItemsServiceSecurityGroup",
                vpc: producerVpc,
            }
        );

        itemsServiceSecurityGroup.connections.allowFromAnyIpv4(Port.tcp(80));

        const ratingsServiceSecurityGroup = new SecurityGroup(
            this,
            "RatingsServiceSecurityGroup",
            {
                allowAllOutbound: true,
                securityGroupName: "RatingsServiceSecurityGroup",
                vpc: producerVpc,
            }
        );

        ratingsServiceSecurityGroup.connections.allowFromAnyIpv4(Port.tcp(80));

        // Fargate Services
        const itemsService = new FargateService(this, "ItemsFargateService", {
            cluster: cluster,
            taskDefinition: itemsServiceTaskDefinition,
            assignPublicIp: false,
            desiredCount: 2,
            securityGroups: [itemsServiceSecurityGroup],
            cloudMapOptions: {
                name: "ItemsService",
                cloudMapNamespace: dnsNamespace,
            },
        });

        const ratingsService = new FargateService(this, "RatingsFargateService", {
            cluster: cluster,
            taskDefinition: ratingsServiceTaskDefinition,
            assignPublicIp: false,
            desiredCount: 2,
            securityGroups: [ratingsServiceSecurityGroup],
            cloudMapOptions: {
                name: "RatingsService",
                cloudMapNamespace: dnsNamespace,
            },
        });

        // ALB
        const httpApiInternalALB = new ApplicationLoadBalancer(
            this,
            "HttpApiInternalALB",
            {
                vpc: producerVpc,
                internetFacing: false,
            }
        );

        // ALB Listener
        this.httpApiListener = httpApiInternalALB.addListener("HttpApiListener", {
            port: 80,
            // Default Target Group
            defaultAction: ListenerAction.fixedResponse(200),
        });

        // Target Groups
        const itemsServiceTargetGroup = this.httpApiListener.addTargets(
            "ItemsServiceTargetGroup",
            {
                port: 80,
                priority: 1,
                healthCheck: {
                    path: "/api/items/ping",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(3),
                },
                targets: [itemsService],
                conditions: [ListenerCondition.pathPatterns(["/api/items*"])],
            }
        );

        const ratingsServiceTargetGroup = this.httpApiListener.addTargets(
            "RatingsServiceTargetGroup",
            {
                port: 80,
                priority: 2,
                healthCheck: {
                    path: "/api/ratings/ping",
                    interval: Duration.seconds(30),
                    timeout: Duration.seconds(3),
                },
                targets: [ratingsService],
                conditions: [ListenerCondition.pathPatterns(["/api/ratings*"])]
            }
        );

        //VPC Link
        this.httpVpcLink = new CfnResource(this, "HttpVpcLink", {
            type: "AWS::ApiGatewayV2::VpcLink",
            properties: {
                Name: "http-api-vpclink",
                SubnetIds: producerVpc.privateSubnets.map((m) => m.subnetId),
            },
        });
    }
}
