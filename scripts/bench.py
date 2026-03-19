#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "boto3>=1.35",
#     "rich>=13",
# ]
# ///
"""
Bazel Build Profiling on AWS EC2

Launches an i4i.32xlarge spot instance with NVMe RAID0, runs cached/uncached
Bazel builds with profiling, and collects results.

Usage:
    uv run scripts/bench.py launch
    uv run scripts/bench.py setup
    uv run scripts/bench.py profile
    uv run scripts/bench.py collect
    uv run scripts/bench.py teardown
    uv run scripts/bench.py ssh
    uv run scripts/bench.py status
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import boto3
from rich.console import Console
from rich.table import Table

console = Console()

CACHE_DIR = Path.home() / ".cache" / "bazel-bench"
STATE_FILE = CACHE_DIR / "state.json"
INSTANCE_TYPE = "i4i.32xlarge"
ON_DEMAND_PRICE = "10.98"  # USD/hr for i4i.32xlarge us-east-1
SPOT_PRICE_ESTIMATE = 3.5  # rough estimate
REGION = "us-east-1"
REPO_URL = "https://github.com/shepherdjerred/monorepo.git"
REPO_LOCAL = Path.home() / "git" / "monorepo"
REMOTE_REPO = "/mnt/nvme/repo/monorepo"
REMOTE_RESULTS = "/mnt/nvme/results"
SHUTDOWN_MINUTES = 300  # 5 hour safety net
SSH_OPTS = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=10",
]


@dataclass
class State:
    instance_id: str
    public_ip: str
    key_path: str
    key_pair_name: str
    security_group_id: str
    region: str
    launched_at: float  # epoch

    def save(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        STATE_FILE.write_text(json.dumps(self.__dict__, indent=2))

    @classmethod
    def load(cls) -> State:
        if not STATE_FILE.exists():
            console.print("[red]No active instance. Run: uv run scripts/bench.py launch[/red]")
            sys.exit(1)
        return cls(**json.loads(STATE_FILE.read_text()))

    def ssh_cmd(self, *args: str) -> list[str]:
        return ["ssh", "-i", self.key_path, *SSH_OPTS, f"ubuntu@{self.public_ip}", *args]

    def scp_to(self, local: str, remote: str) -> list[str]:
        return ["scp", "-i", self.key_path, *SSH_OPTS, local, f"ubuntu@{self.public_ip}:{remote}"]

    def scp_from(self, remote: str, local: str) -> list[str]:
        return ["scp", "-r", "-i", self.key_path, *SSH_OPTS, f"ubuntu@{self.public_ip}:{remote}", local]

    def elapsed_hours(self) -> float:
        return (time.time() - self.launched_at) / 3600

    def estimated_cost(self) -> float:
        return self.elapsed_hours() * SPOT_PRICE_ESTIMATE


def ec2_client():
    return boto3.client("ec2", region_name=REGION)


def ssm_client():
    return boto3.client("ssm", region_name=REGION)


def sq_client():
    return boto3.client("service-quotas", region_name=REGION)


def get_my_ip() -> str:
    import urllib.request
    return urllib.request.urlopen("https://checkip.amazonaws.com", timeout=5).read().decode().strip()


def get_ubuntu_ami() -> str:
    """Look up latest Ubuntu 24.04 AMI via SSM parameter."""
    ssm = ssm_client()
    resp = ssm.get_parameter(
        Name="/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
    )
    return resp["Parameter"]["Value"]


def wait_for_ssh(state: State, timeout: int = 300) -> None:
    """Wait until SSH is available on the instance."""
    console.print("Waiting for SSH to become available...")
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            result = subprocess.run(
                state.ssh_cmd("echo", "ok"),
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode == 0:
                console.print("[green]SSH is ready[/green]")
                return
        except (subprocess.TimeoutExpired, subprocess.SubprocessError):
            pass
        time.sleep(5)
    console.print("[red]Timed out waiting for SSH[/red]")
    sys.exit(1)


def run(cmd: list[str], check: bool = True, **kwargs) -> subprocess.CompletedProcess:
    console.print(f"[dim]$ {' '.join(cmd)}[/dim]")
    return subprocess.run(cmd, check=check, **kwargs)


# --- Subcommands ---


def cmd_launch(args: argparse.Namespace) -> None:
    if STATE_FILE.exists():
        console.print("[yellow]An instance already exists. Run 'teardown' first or 'status' to check.[/yellow]")
        sys.exit(1)

    ec2 = ec2_client()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Check spot vCPU quota
    console.print("Checking spot vCPU quota...")
    try:
        sq = sq_client()
        resp = sq.get_service_quota(ServiceCode="ec2", QuotaCode="L-34B43A08")
        quota = resp["Quota"]["Value"]
        console.print(f"Spot vCPU quota: {quota}")
        if quota < 128:
            console.print(f"[yellow]Warning: Spot quota ({quota}) < 128 vCPUs needed for {INSTANCE_TYPE}.[/yellow]")
            console.print("[yellow]Request an increase at: https://console.aws.amazon.com/servicequotas/[/yellow]")
            if not args.force:
                console.print("Use --force to attempt launch anyway.")
                sys.exit(1)
    except Exception as e:
        console.print(f"[yellow]Could not check quota: {e}[/yellow]")

    # Create key pair
    key_name = f"bazel-bench-{int(time.time())}"
    key_path = str(CACHE_DIR / f"{key_name}.pem")
    console.print(f"Creating key pair: {key_name}")
    resp = ec2.create_key_pair(
        KeyName=key_name,
        KeyType="ed25519",
        TagSpecifications=[{
            "ResourceType": "key-pair",
            "Tags": [
                {"Key": "Name", "Value": "bazel-bench"},
                {"Key": "owner", "Value": "jerred"},
            ],
        }],
    )
    Path(key_path).write_text(resp["KeyMaterial"])
    os.chmod(key_path, 0o600)

    # Create security group
    my_ip = get_my_ip()
    console.print(f"Creating security group (SSH from {my_ip})")
    sg_resp = ec2.create_security_group(
        GroupName=f"bazel-bench-{int(time.time())}",
        Description="Temporary SG for Bazel benchmarking",
        TagSpecifications=[{
            "ResourceType": "security-group",
            "Tags": [
                {"Key": "Name", "Value": "bazel-bench"},
                {"Key": "owner", "Value": "jerred"},
            ],
        }],
    )
    sg_id = sg_resp["GroupId"]
    ec2.authorize_security_group_ingress(
        GroupId=sg_id,
        IpPermissions=[{
            "IpProtocol": "tcp",
            "FromPort": 22,
            "ToPort": 22,
            "IpRanges": [{"CidrIp": f"{my_ip}/32", "Description": "Bench SSH"}],
        }],
    )

    # Get AMI
    ami_id = get_ubuntu_ami()
    console.print(f"Using AMI: {ami_id}")

    # Launch spot instance
    console.print(f"Launching {INSTANCE_TYPE} spot instance...")
    run_resp = ec2.run_instances(
        ImageId=ami_id,
        InstanceType=INSTANCE_TYPE,
        KeyName=key_name,
        SecurityGroupIds=[sg_id],
        MinCount=1,
        MaxCount=1,
        BlockDeviceMappings=[{
            "DeviceName": "/dev/sda1",
            "Ebs": {
                "VolumeSize": 30,
                "VolumeType": "gp3",
                "DeleteOnTermination": True,
            },
        }],
        InstanceMarketOptions={
            "MarketType": "spot",
            "SpotOptions": {
                "MaxPrice": ON_DEMAND_PRICE,
                "SpotInstanceType": "one-time",
                "InstanceInterruptionBehavior": "terminate",
            },
        },
        InstanceInitiatedShutdownBehavior="terminate",
        TagSpecifications=[{
            "ResourceType": "instance",
            "Tags": [
                {"Key": "Name", "Value": "bazel-bench"},
                {"Key": "owner", "Value": "jerred"},
                {"Key": "purpose", "Value": "bazel-profiling"},
            ],
        }],
    )
    instance_id = run_resp["Instances"][0]["InstanceId"]
    console.print(f"Instance: {instance_id}")

    # Wait for running
    console.print("Waiting for instance to be running...")
    waiter = ec2.get_waiter("instance_running")
    waiter.wait(InstanceIds=[instance_id])

    # Get public IP
    desc = ec2.describe_instances(InstanceIds=[instance_id])
    public_ip = desc["Reservations"][0]["Instances"][0].get("PublicIpAddress")
    if not public_ip:
        console.print("[red]No public IP assigned. Check your VPC/subnet settings.[/red]")
        # Clean up
        ec2.terminate_instances(InstanceIds=[instance_id])
        ec2.delete_key_pair(KeyName=key_name)
        ec2.delete_security_group(GroupId=sg_id)
        Path(key_path).unlink(missing_ok=True)
        sys.exit(1)

    state = State(
        instance_id=instance_id,
        public_ip=public_ip,
        key_path=key_path,
        key_pair_name=key_name,
        security_group_id=sg_id,
        region=REGION,
        launched_at=time.time(),
    )
    state.save()

    console.print(f"[green]Instance running: {instance_id} at {public_ip}[/green]")

    # Wait for SSH and schedule auto-shutdown
    wait_for_ssh(state)
    run(state.ssh_cmd(f"sudo shutdown -P +{SHUTDOWN_MINUTES}"), check=False)
    console.print(f"[dim]Auto-shutdown scheduled in {SHUTDOWN_MINUTES} minutes[/dim]")
    console.print("\nNext: uv run scripts/bench.py setup")


def cmd_setup(args: argparse.Namespace) -> None:
    state = State.load()

    # SCP remote setup script
    setup_script = str(Path(__file__).parent / "bench_remote_setup.py")
    console.print("Uploading setup script...")
    run(state.scp_to(setup_script, "/tmp/bench_remote_setup.py"))

    # Install uv on remote first, then run setup script
    console.print("Installing uv and running remote setup...")
    run(state.ssh_cmd(
        "curl -LsSf https://astral.sh/uv/install.sh | sh "
        "&& export PATH=\"$HOME/.local/bin:$PATH\" "
        "&& uv run /tmp/bench_remote_setup.py"
    ))

    # rsync uncommitted changes
    console.print("Syncing uncommitted changes from laptop...")
    rsync_cmd = [
        "rsync", "-avz", "--delete",
        "--exclude=.git/",
        "--exclude=node_modules/",
        "--exclude=bazel-*",
        "--exclude=target/",
        "--exclude=dist/",
        "--exclude=.build/",
        "--exclude=.claude/",
        "-e", f"ssh -i {state.key_path} {' '.join(SSH_OPTS)}",
        f"{REPO_LOCAL}/",
        f"ubuntu@{state.public_ip}:{REMOTE_REPO}/",
    ]
    run(rsync_cmd)

    # Post-rsync setup: mise install, bun install, bazel fetch
    console.print("Running post-sync setup (mise, bun, bazel fetch)...")
    run(state.ssh_cmd(
        "bash", "-c",
        f"cd {REMOTE_REPO} "
        "&& export PATH=\"$HOME/.local/bin:$PATH\" "
        "&& curl https://mise.run | sh "
        "&& export PATH=\"$HOME/.local/share/mise/bin:$PATH\" "
        "&& mise trust "
        "&& mise install "
        "&& eval \"$(mise activate bash)\" "
        "&& bun install "
        "&& cat > .bazelrc.bench << 'BAZELRC'\n"
        "startup --output_base=/mnt/nvme/bazel-output-base\n"
        "startup --host_jvm_args=-Xmx32g\n"
        "build --noremote_accept_cached\n"
        "build --noremote_upload_local_results\n"
        "build --noremote_local_fallback\n"
        "build --jobs=120\n"
        "BAZELRC\n"
        "&& bazel --bazelrc=.bazelrc --bazelrc=.bazelrc.bench fetch //..."
    ))

    console.print("[green]Setup complete![/green]")
    console.print("\nNext: uv run scripts/bench.py profile")


def cmd_profile(args: argparse.Namespace) -> None:
    state = State.load()

    # SCP remote profile script
    profile_script = str(Path(__file__).parent / "bench_remote_profile.py")
    console.print("Uploading profile script...")
    run(state.scp_to(profile_script, "/tmp/bench_remote_profile.py"))

    # Run inside tmux
    console.print("Starting profiling in tmux session 'bench'...")
    run(state.ssh_cmd(
        "tmux", "new-session", "-d", "-s", "bench",
        f"export PATH=\"$HOME/.local/bin:$HOME/.local/share/mise/bin:$PATH\" "
        f"&& eval \"$(mise activate bash)\" "
        f"&& cd {REMOTE_REPO} "
        f"&& uv run /tmp/bench_remote_profile.py 2>&1 | tee /mnt/nvme/results/profile.log; "
        f"echo 'DONE' > /mnt/nvme/results/DONE"
    ))

    console.print("[green]Profiling started in tmux session 'bench'[/green]")
    console.print("Attaching to tmux session (Ctrl-B D to detach)...")
    console.print("[dim]If disconnected, reconnect with: uv run scripts/bench.py ssh[/dim]")
    console.print("[dim]Then: tmux attach -t bench[/dim]")

    # Attach to watch progress
    os.execvp("ssh", state.ssh_cmd("-t", "tmux", "attach", "-t", "bench"))


def cmd_collect(args: argparse.Namespace) -> None:
    state = State.load()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    local_dir = REPO_LOCAL / f"bench-results-{timestamp}"

    console.print(f"Collecting results to {local_dir}...")
    run(state.scp_from(f"{REMOTE_RESULTS}/", str(local_dir)))

    # Print summary
    timings_file = local_dir / "timings.csv"
    if timings_file.exists():
        console.print()
        _print_summary(timings_file)
    else:
        console.print("[yellow]No timings.csv found — profiling may still be running[/yellow]")

    console.print(f"\n[green]Results saved to: {local_dir}[/green]")
    console.print("View profiles at: https://ui.perfetto.dev")
    console.print("Or upload to: https://analyzer.engflow.com")


def _print_summary(timings_file: Path) -> None:
    import csv
    import statistics

    rows = list(csv.DictReader(timings_file.open()))
    if not rows:
        return

    table = Table(title="Build Timings")
    table.add_column("Category")
    table.add_column("Runs")
    table.add_column("Mean (s)", justify="right")
    table.add_column("Stddev (s)", justify="right")
    table.add_column("Min (s)", justify="right")
    table.add_column("Max (s)", justify="right")

    categories: dict[str, list[float]] = {}
    for row in rows:
        cat = row["category"]
        wall = float(row["wall_seconds"])
        categories.setdefault(cat, []).append(wall)

    for cat, times in categories.items():
        mean = statistics.mean(times)
        stddev = statistics.stdev(times) if len(times) > 1 else 0
        table.add_row(
            cat,
            str(len(times)),
            f"{mean:.1f}",
            f"{stddev:.1f}",
            f"{min(times):.1f}",
            f"{max(times):.1f}",
        )

    console.print(table)


def cmd_teardown(args: argparse.Namespace) -> None:
    state = State.load()
    ec2 = ec2_client()

    console.print(f"Terminating instance {state.instance_id}...")
    try:
        ec2.terminate_instances(InstanceIds=[state.instance_id])
        console.print("Waiting for termination...")
        waiter = ec2.get_waiter("instance_terminated")
        waiter.wait(InstanceIds=[state.instance_id])
    except Exception as e:
        console.print(f"[yellow]Instance termination: {e}[/yellow]")

    # Delete security group (retry — ENI detach can lag)
    for attempt in range(3):
        try:
            ec2.delete_security_group(GroupId=state.security_group_id)
            console.print(f"Deleted security group {state.security_group_id}")
            break
        except Exception as e:
            if attempt < 2:
                console.print(f"[dim]SG delete attempt {attempt + 1} failed, retrying in 10s...[/dim]")
                time.sleep(10)
            else:
                console.print(f"[yellow]Could not delete SG {state.security_group_id}: {e}[/yellow]")

    # Delete key pair
    try:
        ec2.delete_key_pair(KeyName=state.key_pair_name)
        console.print(f"Deleted key pair {state.key_pair_name}")
    except Exception as e:
        console.print(f"[yellow]Key pair deletion: {e}[/yellow]")

    # Delete local key file
    Path(state.key_path).unlink(missing_ok=True)

    # Delete state file last
    STATE_FILE.unlink(missing_ok=True)

    console.print("[green]Teardown complete. All resources cleaned up.[/green]")


def cmd_ssh(args: argparse.Namespace) -> None:
    state = State.load()
    os.execvp("ssh", state.ssh_cmd("-t", *args.ssh_args))


def cmd_status(args: argparse.Namespace) -> None:
    state = State.load()
    ec2 = ec2_client()

    try:
        desc = ec2.describe_instances(InstanceIds=[state.instance_id])
        inst = desc["Reservations"][0]["Instances"][0]
        inst_state = inst["State"]["Name"]
    except Exception:
        inst_state = "unknown"

    elapsed = state.elapsed_hours()
    cost = state.estimated_cost()

    table = Table(title="Bench Instance Status")
    table.add_column("Property", style="bold")
    table.add_column("Value")
    table.add_row("Instance ID", state.instance_id)
    table.add_row("Public IP", state.public_ip)
    table.add_row("State", inst_state)
    table.add_row("Region", state.region)
    table.add_row("Key", state.key_path)
    table.add_row("Security Group", state.security_group_id)
    table.add_row("Elapsed", f"{elapsed:.1f} hours")
    table.add_row("Est. Cost", f"${cost:.2f}")
    console.print(table)

    if elapsed > 2:
        console.print(f"\n[yellow]Warning: Instance has been running for {elapsed:.1f} hours.[/yellow]")
        console.print("[yellow]Run 'uv run scripts/bench.py teardown' when done.[/yellow]")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bazel Build Profiling on AWS EC2")
    sub = parser.add_subparsers(dest="command", required=True)

    launch_p = sub.add_parser("launch", help="Launch EC2 spot instance")
    launch_p.add_argument("--force", action="store_true", help="Launch even if quota is low")

    sub.add_parser("setup", help="Set up instance (NVMe, deps, repo, bazel fetch)")
    sub.add_parser("profile", help="Run profiling builds in tmux")
    sub.add_parser("collect", help="Download results from instance")
    sub.add_parser("teardown", help="Terminate instance and clean up all resources")

    ssh_p = sub.add_parser("ssh", help="SSH into instance")
    ssh_p.add_argument("ssh_args", nargs="*", default=[], help="Extra args passed to ssh")

    sub.add_parser("status", help="Show instance status and cost")

    args = parser.parse_args()
    commands = {
        "launch": cmd_launch,
        "setup": cmd_setup,
        "profile": cmd_profile,
        "collect": cmd_collect,
        "teardown": cmd_teardown,
        "ssh": cmd_ssh,
        "status": cmd_status,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
