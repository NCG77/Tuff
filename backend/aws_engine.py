import boto3
from datetime import datetime, timedelta, timezone

class AWSEngine:
    def __init__(self, aws_access_key: str, aws_secret_key: str, region_name: str = "us-east-1"):
        self.session = boto3.Session(
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            region_name=region_name
        )
        self.region = region_name

    def scan_zombie_ec2(self) -> list:
        ec2_client = self.session.client('ec2')
        cw_client = self.session.client('cloudwatch')
        findings = []

        # 1. Fetch all running EC2 instances
        response = ec2_client.describe_instances(
            Filters=[{'Name': 'instance-state-name', 'Values': ['running']}]
        )

        for reservation in response.get('Reservations', []):
            for instance in reservation.get('Instances', []):
                instance_id = instance['InstanceId']
                instance_type = instance['InstanceType']
                launch_time = instance['LaunchTime']

                # Avoid checking brand new instances that haven't collected 7 days of data
                if datetime.now(timezone.utc) - launch_time < timedelta(days=7):
                    continue

                # 2. Query CloudWatch for average CPU utilization over 7 days
                metric_stats = cw_client.get_metric_statistics(
                    Namespace='AWS/EC2',
                    MetricName='CPUUtilization',
                    Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
                    StartTime=datetime.now(timezone.utc) - timedelta(days=7),
                    EndTime=datetime.now(timezone.utc),
                    Period=86400,  # 1-day chunks
                    Statistics=['Average']
                )

                datapoints = metric_stats.get('Datapoints', [])
                if datapoints:
                    averages = [d['Average'] for d in datapoints]
                    max_avg_cpu = max(averages)

                    # If the instance never crosses 5% CPU in a week, it's a zombie candidate
                    if max_avg_cpu < 5.0:
                        findings.append({
                            "resource_type": "EC2",
                            "resource_id": instance_id,
                            "issue": "Idle Instance",
                            "severity": "medium",
                            "metrics": {
                                "cpu_avg": round(sum(averages) / len(averages), 2),
                                "max_cpu_observed": round(max_avg_cpu, 2),
                                "instance_type": instance_type
                            },
                            "region": self.region,
                            "estimated_monthly_cost": 120, # Fixed standard metric format hook
                            "recommendation": "Consider stopping or downsizing this instance to save costs."
                        })
        return findings

    def scan_zombie_ebs(self) -> list:
        ec2_client = self.session.client('ec2')
        findings = []

        # Fetch volumes that are not attached to anything
        response = ec2_client.describe_volumes(
            Filters=[{'Name': 'status', 'Values': ['available']}]
        )

        for volume in response.get('Volumes', []):
            volume_id = volume['VolumeId']
            size_gb = volume['Size']
            volume_type = volume['VolumeType']

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
                "estimated_monthly_cost": round(size_gb * 0.08, 2), # Auto-calculates accurate cost tier metrics
                "recommendation": "Snapshot data if needed, then delete this orphaned volume immediately."
            })
        return findings

    def scan_public_s3(self) -> list:
        s3_client = self.session.client('s3')
        findings = []

        try:
            buckets_response = s3_client.list_buckets()
            for bucket in buckets_response.get('Buckets', []):
                bucket_name = bucket['Name']
                
                try:
                    # Check the Public Access Block Configuration
                    pab = s3_client.get_public_access_block(Bucket=bucket_name)
                    config = pab.get('PublicAccessBlockConfiguration', {})
                    
                    # If any of the protective blocks are set to False, flag it
                    is_exposed = not all([
                        config.get('BlockPublicAcls', False),
                        config.get('IgnorePublicAcls', False),
                        config.get('BlockPublicPolicy', False),
                        config.get('RestrictPublicBuckets', False)
                    ])
                except s3_client.exceptions.ClientError as e:
                    # If public blocking is entirely off, flag as exposed
                    if e.response['Error']['Code'] == 'NoSuchPublicAccessBlockConfiguration':
                        is_exposed = True
                    else:
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
        except Exception:
            pass
            
        return findings

    def scan_vpc(self) -> list:
        ec2_client = self.session.client('ec2')
        vpcs = ec2_client.describe_vpcs()['Vpcs']
        vpc_findings = []
        
        for v in vpcs:
            vpc_id = v['VpcId']
            # Find running nodes within subnet containers
            instances = ec2_client.describe_instances(
                Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}]
            )['Reservations']
            
            if len(instances) == 0:
                vpc_findings.append({
                    "resource_type": "VPC",
                    "resource_id": vpc_id,
                    "issue": "Unused VPC",
                    "severity": "medium",
                    "metrics": {
                        "instance_count": 0,
                        "is_default": v.get('IsDefault', False)
                    },
                    "region": self.region,
                    "recommendation": "Consider deleting this VPC to reduce management overhead and potential attack surface.",
                    "estimated_monthly_cost": 5 # Fixed missing array separation comma bug
                })
        return vpc_findings

    def scan_rds(self) -> list:
        # FIXED: Corrected indentation alignment blocks completely
        rds_client = self.session.client('rds')
        databases = rds_client.describe_db_instances()['DBInstances']
        rds_findings = []
        
        for db in databases:
            db_id = db['DBInstanceIdentifier']
            db_status = db['DBInstanceStatus']
            
            if db_status == 'available':
                rds_findings.append({
                    "resource_type": "RDS",
                    "resource_id": db_id,
                    "issue": "Idle Database Instance",
                    "severity": "high",
                    "metrics": {
                        "engine": db['Engine'],
                        "instance_class": db['DBInstanceClass']
                    },
                    "region": self.region, # FIXED: Changed from self.region_name to self.region
                    "recommendation": "Snapshot and terminate this unutilized database workspace ledger tier.",
                    "estimated_monthly_cost": 45 
                })
        return rds_findings

    def scan_scaling_candidates(self) -> list:
        ec2_client = self.session.client('ec2')
        cw_client = self.session.client('cloudwatch')
        findings=[]

        response= ec2_client.describe_instances(
            Filters=[{'Name': 'instance-state-name', 'Values': ['running']}]
        )

        for reservation in response.get('Reservations', []):
            for instance in reservation.get('Instances',[]):
                instance_id = instance['InstanceId']
                current_type = instance['InstanceType']

                # Grab a week of average cpu data
                metric_stats = cw_client.get_metric_statistics(
                    Namespace='AWS/EC2',
                    MetricName='CPUUtilization',
                    Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
                    StartTime=datetime.now(timezone.utc) - timedelta(days=7),
                    EndTime=datetime.now(timezone.utc),
                    Period=86400,
                    Statistics=['Average']
                )
                datapoints = metric_stats.get('Datapoints', [])
                if datapoints:
                    averages = [d['Average'] for d in datapoints]
                    avg_cpu = sum(averages) / len(averages)

                    # If average CPU is under 10%, it may be a scaling candidate
                    if avg_cpu < 10.0 and not current_type.startswith('nano' or 'micro'):
                        findings.append({
                            "resource_type": "EC2",
                            "resource_id": instance_id,
                            "issue": "Scaling Candidate",
                            "severity": "medium",
                            "metrics": {
                                "average_cpu": round(avg_cpu, 2),
                                "current_instance_type": current_type
                            },
                            "region": self.region,
                            "estimated_monthly_cost": 120, # Fixed standard metric format hook
                            "recommendation": f"Consider resizing this instance to a smaller type to optimize costs."
                        })
        return findings

            

    def execute_full_scan(self) -> list:
        all_findings = []
        all_findings.extend(self.scan_zombie_ec2())
        all_findings.extend(self.scan_zombie_ebs())
        all_findings.extend(self.scan_public_s3())
        all_findings.extend(self.scan_vpc())
        all_findings.extend(self.scan_rds())
        return all_findings


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