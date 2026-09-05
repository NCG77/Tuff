import logging
from datetime import datetime, timedelta, timezone

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)

# CloudWatch window used for every utilisation judgement. Two weeks is long
# enough to survive a quiet weekend without flagging healthy resources.
LOOKBACK_DAYS = 14

# Thresholds that decide whether a resource is wasteful.
IDLE_CPU_PERCENT = 5.0
IDLE_NETWORK_BYTES_PER_SEC = 1000
RIGHTSIZE_CPU_PERCENT = 10.0
MIN_VOLUME_AGE_DAYS = 7

# On-demand USD/hour for the instance families Tuff commonly encounters
# (us-east-1 list prices). These are estimates used for ranking and for the
# savings figures shown in the UI; they are not billing-accurate and do not
# account for Savings Plans, Reserved Instances or regional variation.
_EC2_HOURLY_USD = {
    "t3.nano": 0.0052, "t3.micro": 0.0104, "t3.small": 0.0208, "t3.medium": 0.0416,
    "t3.large": 0.0832, "t3.xlarge": 0.1664, "t3.2xlarge": 0.3328,
    "t2.nano": 0.0058, "t2.micro": 0.0116, "t2.small": 0.023, "t2.medium": 0.0464,
    "t2.large": 0.0928, "t2.xlarge": 0.1856,
    "m5.large": 0.096, "m5.xlarge": 0.192, "m5.2xlarge": 0.384, "m5.4xlarge": 0.768,
    "c5.large": 0.085, "c5.xlarge": 0.17, "c5.2xlarge": 0.34, "c5.4xlarge": 0.68,
    "r5.large": 0.126, "r5.xlarge": 0.252, "r5.2xlarge": 0.504,
}
_DEFAULT_EC2_HOURLY_USD = 0.10

_RDS_HOURLY_USD = {
    "db.t3.micro": 0.017, "db.t3.small": 0.034, "db.t3.medium": 0.068,
    "db.t3.large": 0.136, "db.m5.large": 0.171, "db.m5.xlarge": 0.342,
    "db.r5.large": 0.24, "db.r5.xlarge": 0.48,
}
_DEFAULT_RDS_HOURLY_USD = 0.05

_EBS_MONTHLY_USD_PER_GB = {"gp3": 0.08, "gp2": 0.10, "io1": 0.125, "io2": 0.125, "st1": 0.045, "sc1": 0.015}
_DEFAULT_EBS_MONTHLY_USD_PER_GB = 0.08

_HOURS_PER_MONTH = 730


def _monthly_ec2_cost(instance_type: str) -> float:
    return round(_EC2_HOURLY_USD.get(instance_type, _DEFAULT_EC2_HOURLY_USD) * _HOURS_PER_MONTH, 2)


def _monthly_rds_cost(instance_class: str) -> float:
    return round(_RDS_HOURLY_USD.get(instance_class, _DEFAULT_RDS_HOURLY_USD) * _HOURS_PER_MONTH, 2)


def _monthly_ebs_cost(size_gb: int, volume_type: str) -> float:
    rate = _EBS_MONTHLY_USD_PER_GB.get(volume_type, _DEFAULT_EBS_MONTHLY_USD_PER_GB)
    return round(size_gb * rate, 2)


def suggest_smaller_type(instance_type: str) -> str:
    """Pick the next size down within the same family.

    Returning a same-family type matters because ``modify-instance-attribute``
    fails when the target type is incompatible with the instance's
    virtualisation or network settings.
    """
    ladder = ["nano", "micro", "small", "medium", "large", "xlarge", "2xlarge", "4xlarge", "8xlarge"]
    if "." not in instance_type:
        return "t3.micro"
    family, size = instance_type.split(".", 1)
    if size not in ladder:
        return "t3.micro"
    index = ladder.index(size)
    if index == 0:
        return instance_type
    return f"{family}.{ladder[index - 1]}"


class AWSEngine:
    def __init__(self, aws_access_key: str, aws_secret_key: str, region_name: str = "us-east-1"):
        self.session = boto3.Session(
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            region_name=region_name
        )
        # Bounded timeouts and retries keep a single unreachable region from
        # hanging the whole scan request.
        self._client_config = Config(
            connect_timeout=10,
            read_timeout=30,
            retries={"max_attempts": 3, "mode": "standard"},
        )
        self.region = region_name

    def client(self, service: str):
        return self.session.client(service, config=self._client_config)

    def _metric_averages(self, cw_client, namespace: str, metric_name: str, dimensions: list, statistic: str = "Average") -> list:
        stats = cw_client.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=dimensions,
            StartTime=datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS),
            EndTime=datetime.now(timezone.utc),
            Period=86400,
            Statistics=[statistic],
        )
        return [point[statistic] for point in stats.get("Datapoints", [])]

    def _running_instances(self, ec2_client) -> list:
        instances = []
        # Paginated: describe_instances truncates at 1000 reservations, so an
        # unpaginated call silently misses resources in larger accounts.
        for page in ec2_client.get_paginator("describe_instances").paginate(
            Filters=[{"Name": "instance-state-name", "Values": ["running"]}]
        ):
            for reservation in page.get("Reservations", []):
                instances.extend(reservation.get("Instances", []))
        return instances

    def scan_zombie_ec2(self) -> list:
        ec2_client = self.client('ec2')
        cw_client = self.client('cloudwatch')
        findings = []

        for instance in self._running_instances(ec2_client):
            instance_id = instance['InstanceId']
            instance_type = instance['InstanceType']

            averages = self._metric_averages(
                cw_client, 'AWS/EC2', 'CPUUtilization', [{'Name': 'InstanceId', 'Value': instance_id}]
            )
            if not averages:
                # No telemetry means no evidence of waste. Reporting these as
                # idle produced false positives on freshly launched hosts.
                continue

            net_in_avgs = self._metric_averages(
                cw_client, 'AWS/EC2', 'NetworkIn', [{'Name': 'InstanceId', 'Value': instance_id}]
            ) or [0]

            max_avg_cpu = max(averages)
            max_net_in = max(net_in_avgs)

            if max_avg_cpu < IDLE_CPU_PERCENT and max_net_in < IDLE_NETWORK_BYTES_PER_SEC:
                findings.append({
                    "resource_type": "EC2",
                    "resource_id": instance_id,
                    "issue": "Idle Instance",
                    "severity": "medium",
                    "metrics": {
                        "cpu_avg": round(sum(averages) / len(averages), 2),
                        "max_cpu_observed": round(max_avg_cpu, 2),
                        "network_in_bytes_sec": round(max_net_in, 2),
                        "instance_type": instance_type,
                        "observation_days": LOOKBACK_DAYS,
                    },
                    "region": self.region,
                    "estimated_monthly_cost": _monthly_ec2_cost(instance_type),
                    "recommendation": "Consider stopping or downsizing this instance to save costs. Memory usage should also be verified if CloudWatch Agent is installed."
                })
        return findings

    def scan_zombie_ebs(self) -> list:
        ec2_client = self.client('ec2')
        findings = []

        for page in ec2_client.get_paginator('describe_volumes').paginate(
            Filters=[{'Name': 'status', 'Values': ['available']}]
        ):
            for volume in page.get('Volumes', []):
                volume_id = volume['VolumeId']
                size_gb = volume['Size']
                volume_type = volume['VolumeType']
                create_time = volume.get('CreateTime')

                if create_time and (datetime.now(timezone.utc) - create_time).days < MIN_VOLUME_AGE_DAYS:
                    continue

                findings.append({
                    "resource_type": "EBS_Volume",
                    "resource_id": volume_id,
                    "issue": "Unattached Volume",
                    "severity": "high",
                    "metrics": {
                        "size_gb": size_gb,
                        "volume_type": volume_type
                    },
                    "region": self.region,
                    "estimated_monthly_cost": _monthly_ebs_cost(size_gb, volume_type),
                    "recommendation": "Snapshot data if needed, then delete this orphaned volume immediately."
                })
        return findings

    def scan_public_s3(self) -> list:
        s3_client = self.client('s3')
        findings = []

        # S3 is global, so only enumerate buckets once per scan rather than
        # duplicating every bucket finding for every region being scanned.
        if self.region not in ("us-east-1", "global"):
            return findings

        buckets_response = s3_client.list_buckets()
        for bucket in buckets_response.get('Buckets', []):
            bucket_name = bucket['Name']

            try:
                pab = s3_client.get_public_access_block(Bucket=bucket_name)
                config = pab.get('PublicAccessBlockConfiguration', {})

                is_exposed = not all([
                    config.get('BlockPublicAcls', False),
                    config.get('IgnorePublicAcls', False),
                    config.get('BlockPublicPolicy', False),
                    config.get('RestrictPublicBuckets', False)
                ])
            except ClientError as e:
                code = e.response.get('Error', {}).get('Code', '')
                if code == 'NoSuchPublicAccessBlockConfiguration':
                    is_exposed = True
                else:
                    # AccessDenied and friends are logged rather than silently
                    # dropped, so a too-narrow IAM policy is diagnosable.
                    logger.info("Skipping bucket %s: %s", bucket_name, code or e)
                    continue

            if is_exposed:
                findings.append({
                    "resource_type": "S3_Bucket",
                    "resource_id": bucket_name,
                    "issue": "Public Access Block Disabled",
                    "severity": "critical",
                    "metrics": {
                        "public_sharing_risk": "High"
                    },
                    "region": "global",
                    "estimated_monthly_cost": 0,
                    "recommendation": "Enable Public Access Block configuration to secure bucket contents."
                })

        return findings

    def scan_vpc(self) -> list:
        ec2_client = self.client('ec2')
        vpc_findings = []

        for page in ec2_client.get_paginator('describe_vpcs').paginate():
            for v in page.get('Vpcs', []):
                vpc_id = v['VpcId']

                enis = ec2_client.describe_network_interfaces(
                    Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}]
                )['NetworkInterfaces']

                nat_gateways = ec2_client.describe_nat_gateways(
                    Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}, {'Name': 'state', 'Values': ['available', 'pending']}]
                )['NatGateways']

                if len(enis) == 0 and len(nat_gateways) == 0:
                    is_default = v.get('IsDefault', False)
                    vpc_findings.append({
                        "resource_type": "VPC",
                        "resource_id": vpc_id,
                        "issue": "Unused VPC",
                        "severity": "low" if is_default else "medium",
                        "metrics": {
                            "eni_count": 0,
                            "nat_gateway_count": 0,
                            "is_default": is_default
                        },
                        "region": self.region,
                        "recommendation": (
                            "This is the account's default VPC; deleting it is optional and some "
                            "services expect it to exist."
                            if is_default else
                            "Consider deleting this VPC to reduce management overhead and potential attack surface."
                        ),
                        # An empty VPC itself is free; the cost of keeping it is
                        # operational rather than billed.
                        "estimated_monthly_cost": 0
                    })
        return vpc_findings

    def scan_rds(self) -> list:
        rds_client = self.client('rds')
        cw_client = self.client('cloudwatch')
        rds_findings = []

        for page in rds_client.get_paginator('describe_db_instances').paginate():
            for db in page.get('DBInstances', []):
                db_id = db['DBInstanceIdentifier']

                if db['DBInstanceStatus'] != 'available':
                    continue

                connection_peaks = self._metric_averages(
                    cw_client, 'AWS/RDS', 'DatabaseConnections',
                    [{'Name': 'DBInstanceIdentifier', 'Value': db_id}], statistic='Maximum'
                )
                # Without datapoints there is no evidence the database is idle.
                # Treating "no metrics" as "zero connections" flagged healthy
                # databases whose metrics had not been published yet.
                if not connection_peaks:
                    continue

                if max(connection_peaks) == 0:
                    instance_class = db['DBInstanceClass']
                    rds_findings.append({
                        "resource_type": "RDS",
                        "resource_id": db_id,
                        "issue": "Idle Database Instance",
                        "severity": "high",
                        "metrics": {
                            "engine": db['Engine'],
                            "instance_class": instance_class,
                            "max_connections_observed": max(connection_peaks),
                            "observation_days": LOOKBACK_DAYS,
                            "multi_az": db.get('MultiAZ', False),
                        },
                        "region": self.region,
                        "recommendation": "Snapshot the database, then stop or delete it if the workload is genuinely retired.",
                        "estimated_monthly_cost": _monthly_rds_cost(instance_class)
                    })
        return rds_findings

    def scan_scaling_candidates(self) -> list:
        ec2_client = self.client('ec2')
        cw_client = self.client('cloudwatch')
        findings = []

        for instance in self._running_instances(ec2_client):
            instance_id = instance['InstanceId']
            current_type = instance['InstanceType']

            averages = self._metric_averages(
                cw_client, 'AWS/EC2', 'CPUUtilization', [{'Name': 'InstanceId', 'Value': instance_id}]
            )
            if not averages:
                continue

            avg_cpu = sum(averages) / len(averages)
            if avg_cpu >= RIGHTSIZE_CPU_PERCENT or 'nano' in current_type or 'micro' in current_type:
                continue

            suggested_type = suggest_smaller_type(current_type)
            if suggested_type == current_type:
                continue

            current_cost = _monthly_ec2_cost(current_type)
            findings.append({
                "resource_type": "EC2",
                "resource_id": instance_id,
                "issue": "Scaling Candidate",
                "severity": "medium",
                "metrics": {
                    "average_cpu": round(avg_cpu, 2),
                    "cpu_avg": round(avg_cpu, 2),
                    "current_instance_type": current_type,
                    "instance_type": current_type,
                    "suggested_type": suggested_type,
                    "observation_days": LOOKBACK_DAYS,
                },
                "region": self.region,
                "estimated_monthly_cost": current_cost,
                "estimated_monthly_savings": round(max(0.0, current_cost - _monthly_ec2_cost(suggested_type)), 2),
                "recommendation": f"Resize this instance to {suggested_type} to optimize costs. WARNING: Manually verify Memory utilization before downsizing to prevent OOM errors."
            })
        return findings

    def execute_full_scan(self) -> list:
        """Run every scanner, tolerating individual failures.

        Each scanner is isolated so that one denied IAM permission (for example
        no ``rds:DescribeDBInstances``) degrades that one check instead of
        wiping out the entire region's results.
        """
        scanners = (
            ("EC2 idle", self.scan_zombie_ec2),
            ("EBS unattached", self.scan_zombie_ebs),
            ("S3 exposure", self.scan_public_s3),
            ("VPC unused", self.scan_vpc),
            ("RDS idle", self.scan_rds),
            ("EC2 rightsizing", self.scan_scaling_candidates),
        )

        all_findings = []
        failures = []
        for label, scanner in scanners:
            try:
                all_findings.extend(scanner())
            except (ClientError, BotoCoreError) as e:
                logger.warning("%s scan failed in %s: %s", label, self.region, e)
                failures.append(label)
            except Exception as e:
                logger.exception("%s scan raised unexpectedly in %s: %s", label, self.region, e)
                failures.append(label)

        if failures and len(failures) == len(scanners):
            raise RuntimeError(
                f"Every check failed in {self.region}. Verify the credentials and IAM permissions."
            )

        self.last_failed_scanners = failures
        return self._deduplicate(all_findings)

    @staticmethod
    def _deduplicate(findings: list) -> list:
        """Collapse overlapping findings for the same resource.

        An under-used instance trips both the idle and the rightsizing check.
        Emitting both meant the dashboard listed the same instance twice and
        counted its savings twice, so only the more actionable one is kept:
        a genuinely idle instance should be stopped, not resized.
        """
        by_resource: dict = {}
        priority = {"Idle Instance": 2, "Scaling Candidate": 1}

        for finding in findings:
            key = (finding["resource_id"], finding["resource_type"])
            existing = by_resource.get(key)
            if existing is None:
                by_resource[key] = finding
                continue
            if priority.get(finding["issue"], 0) > priority.get(existing["issue"], 0):
                by_resource[key] = finding

        return list(by_resource.values())


if __name__ == "__main__":
    import os
    from dotenv import load_dotenv
    load_dotenv()
    
    KEY = os.getenv("TEST_AWS_ACCESS_KEY")
    SECRET = os.getenv("TEST_AWS_SECRET_KEY")
    
    if KEY and SECRET:
        print("🚀 Testing AWSEngine scanning mechanisms...")
        engine = AWSEngine(aws_access_key=KEY, aws_secret_key=SECRET)
        report = engine.execute_full_scan()
        print(f"📊 Scan Complete. Found {len(report)} items needing attention.")
        import json
        print(json.dumps(report, indent=2))
    else:
        print("ℹ️ Set TEST_AWS_ACCESS_KEY and TEST_AWS_SECRET_KEY in your .env file to run a localized scan test.")
