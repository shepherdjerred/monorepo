#!/usr/bin/env -S uvx --quiet --with=rich --with=plotly --with=pandas --with=kaleido python
"""
Velero Backup Failure Report Generator

Generates a comprehensive report of Velero backup failures over time,
including graphs, tables, and detailed error logs.

Usage:
    uvx --with=rich --with=plotly --with=pandas --with=kaleido velero-report.py
    # Or if executable:
    ./velero-report.py
"""

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any
import re

try:
    import pandas as pd
    import plotly.graph_objects as go
    from plotly.subplots import make_subplots
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.markdown import Markdown
    from rich import box
except ImportError as e:
    print(f"Error: {e}")
    print("\nPlease run with: uvx --with=rich --with=plotly --with=pandas --with=kaleido velero-report.py")
    sys.exit(1)

console = Console()


def run_command(cmd: List[str]) -> str:
    """Run a shell command and return output."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        console.print(f"[red]Error running command: {' '.join(cmd)}[/red]")
        console.print(f"[red]{e.stderr}[/red]")
        return ""


def get_all_backups() -> List[Dict[str, Any]]:
    """Get all Velero backups."""
    console.print("[cyan]Fetching all Velero backups...[/cyan]")

    output = run_command([
        "kubectl", "get", "backups", "-n", "velero",
        "-o", "json"
    ])

    if not output:
        return []

    try:
        data = json.loads(output)
        return data.get("items", [])
    except json.JSONDecodeError:
        console.print("[red]Failed to parse backup list[/red]")
        return []


def parse_backup(backup: Dict[str, Any]) -> Dict[str, Any]:
    """Parse a single backup object."""
    metadata = backup.get("metadata", {})
    status = backup.get("status", {})
    spec = backup.get("spec", {})

    name = metadata.get("name", "unknown")
    phase = status.get("phase", "Unknown")
    creation_time = metadata.get("creationTimestamp", "")

    # Parse timestamp
    try:
        timestamp = datetime.fromisoformat(creation_time.replace("Z", "+00:00"))
    except:
        timestamp = None

    # Get labels
    labels = metadata.get("labels", {})
    backup_type = labels.get("backup-type", "unknown")
    schedule_name = labels.get("velero.io/schedule-name", "manual")

    # Get status details
    errors = status.get("errors", 0)
    warnings = status.get("warnings", 0)
    total_items = status.get("progress", {}).get("totalItems", 0)
    items_backed_up = status.get("progress", {}).get("itemsBackedUp", 0)

    # Volume snapshot info
    vol_snapshots_attempted = status.get("volumeSnapshotsAttempted", 0)
    vol_snapshots_completed = status.get("volumeSnapshotsCompleted", 0)

    start_time = status.get("startTimestamp", "")
    completion_time = status.get("completionTimestamp", "")

    # Calculate duration
    duration = None
    if start_time and completion_time:
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(completion_time.replace("Z", "+00:00"))
            duration = (end - start).total_seconds() / 60  # minutes
        except:
            pass

    return {
        "name": name,
        "timestamp": timestamp,
        "phase": phase,
        "backup_type": backup_type,
        "schedule_name": schedule_name,
        "errors": errors,
        "warnings": warnings,
        "total_items": total_items,
        "items_backed_up": items_backed_up,
        "vol_snapshots_attempted": vol_snapshots_attempted,
        "vol_snapshots_completed": vol_snapshots_completed,
        "duration_minutes": duration,
        "failed_volumes": vol_snapshots_attempted - vol_snapshots_completed if vol_snapshots_attempted else 0,
    }


def get_backup_details(backup_name: str) -> Dict[str, Any]:
    """Get detailed information about a backup including errors."""
    console.print(f"[dim]Fetching details for {backup_name}...[/dim]")

    output = run_command([
        "velero", "backup", "describe", backup_name, "--details"
    ])

    details = {
        "errors": [],
        "warnings": [],
        "failed_volumes": [],
        "full_logs": None
    }

    if not output:
        return details

    lines = output.split("\n")
    current_section = None

    for i, line in enumerate(lines):
        if line.strip().startswith("Errors:"):
            current_section = "errors"
            continue
        elif line.strip().startswith("Warnings:"):
            current_section = "warnings"
            continue
        elif line.strip().startswith("Namespaces:") or line.strip().startswith("Resources:"):
            current_section = None
            continue

        if current_section and line.strip():
            # Parse error/warning lines
            if "message:" in line or "name:" in line:
                if current_section == "errors":
                    details["errors"].append(line.strip())
                elif current_section == "warnings":
                    details["warnings"].append(line.strip())

        # Extract failed volume information
        if "Result:             failed" in line:
            # Look back for volume name
            for j in range(max(0, i-10), i):
                if "pvc-" in lines[j]:
                    volume_match = re.search(r'(pvc-[a-f0-9-]+)', lines[j])
                    if volume_match:
                        details["failed_volumes"].append(volume_match.group(1))
                        break

    # Get full backup logs (last 200 lines with error context)
    log_output = run_command([
        "velero", "backup", "logs", backup_name
    ])
    if log_output:
        # Extract error-related log lines
        log_lines = log_output.split("\n")
        error_logs = []
        for i, line in enumerate(log_lines):
            if any(keyword in line.lower() for keyword in ["error", "failed", "panic", "abort"]):
                # Include context (5 lines before and after)
                start = max(0, i - 5)
                end = min(len(log_lines), i + 6)
                context = log_lines[start:end]
                error_logs.append("\n".join(context))

        if error_logs:
            details["full_logs"] = "\n\n---\n\n".join(error_logs[:10])  # Limit to first 10 error contexts

    return details


def get_volume_context(volume_id: str) -> Dict[str, Any]:
    """Get additional context about a failing volume."""
    context = {
        "pv_details": None,
        "pvc_info": None,
        "zfs_volume": None,
        "pod_info": None
    }

    # Get PV details
    pv_output = run_command(["kubectl", "get", "pv", volume_id, "-o", "json"])
    if pv_output:
        try:
            pv_data = json.loads(pv_output)
            context["pv_details"] = {
                "capacity": pv_data.get("spec", {}).get("capacity", {}),
                "storage_class": pv_data.get("spec", {}).get("storageClassName"),
                "claim_ref": pv_data.get("spec", {}).get("claimRef", {}),
                "status": pv_data.get("status", {}).get("phase"),
            }

            # Get PVC if referenced
            claim_ref = pv_data.get("spec", {}).get("claimRef", {})
            if claim_ref:
                pvc_name = claim_ref.get("name")
                pvc_namespace = claim_ref.get("namespace")
                if pvc_name and pvc_namespace:
                    pvc_output = run_command([
                        "kubectl", "get", "pvc", pvc_name, "-n", pvc_namespace, "-o", "json"
                    ])
                    if pvc_output:
                        try:
                            pvc_data = json.loads(pvc_output)
                            context["pvc_info"] = {
                                "name": pvc_name,
                                "namespace": pvc_namespace,
                                "status": pvc_data.get("status", {}).get("phase"),
                                "capacity": pvc_data.get("status", {}).get("capacity"),
                            }
                        except:
                            pass
        except:
            pass

    # Get ZFS volume info if it's a ZFS volume
    zfs_output = run_command([
        "kubectl", "get", "zfsvolume", volume_id, "-n", "openebs", "-o", "json"
    ])
    if zfs_output:
        try:
            zfs_data = json.loads(zfs_output)
            context["zfs_volume"] = {
                "pool": zfs_data.get("spec", {}).get("poolName"),
                "capacity": zfs_data.get("spec", {}).get("capacity"),
                "status": zfs_data.get("status", {}).get("state"),
            }
        except:
            pass

    return context


def get_openebs_logs() -> str:
    """Get recent OpenEBS plugin logs."""
    # Get OpenEBS ZFS plugin logs
    output = run_command([
        "kubectl", "logs", "-n", "openebs",
        "-l", "app=openebs-zfs-node",
        "--tail=100", "--timestamps"
    ])
    return output if output else "Could not retrieve OpenEBS logs"


def get_velero_logs() -> str:
    """Get recent Velero pod logs."""
    output = run_command([
        "kubectl", "logs", "-n", "velero",
        "deployment/velero", "--tail=100", "--timestamps"
    ])
    return output if output else "Could not retrieve Velero logs"


def get_recent_events() -> List[str]:
    """Get recent Kubernetes events related to backups and volumes."""
    output = run_command([
        "kubectl", "get", "events", "-A",
        "--sort-by='.lastTimestamp'",
        "--field-selector=involvedObject.kind=Backup"
    ])

    events = []
    if output:
        lines = output.split("\n")[1:]  # Skip header
        for line in lines[:20]:  # Last 20 events
            if line.strip():
                events.append(line)

    return events


def create_graphs(df: pd.DataFrame, output_dir: Path):
    """Create visualization graphs."""
    console.print("[cyan]Creating visualizations...[/cyan]")

    # Create subplots
    fig = make_subplots(
        rows=3, cols=2,
        subplot_titles=(
            "Backup Status Over Time",
            "Errors & Warnings Over Time",
            "Volume Snapshot Success Rate",
            "Backup Duration Over Time",
            "Failures by Backup Type",
            "Items Backed Up vs Total"
        ),
        specs=[
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"secondary_y": False}, {"secondary_y": False}],
            [{"type": "pie"}, {"secondary_y": False}]
        ],
        vertical_spacing=0.12,
        horizontal_spacing=0.15
    )

    # Sort by timestamp
    df_sorted = df.sort_values("timestamp")

    # 1. Backup Status Over Time
    status_colors = {
        "Completed": "green",
        "PartiallyFailed": "orange",
        "Failed": "red",
        "InProgress": "blue"
    }

    for status in df_sorted["phase"].unique():
        status_df = df_sorted[df_sorted["phase"] == status]
        fig.add_trace(
            go.Scatter(
                x=status_df["timestamp"],
                y=[status] * len(status_df),
                mode="markers",
                name=status,
                marker=dict(size=12, color=status_colors.get(status, "gray")),
                text=status_df["name"],
                hovertemplate="<b>%{text}</b><br>%{x}<extra></extra>"
            ),
            row=1, col=1
        )

    # 2. Errors & Warnings Over Time
    fig.add_trace(
        go.Scatter(
            x=df_sorted["timestamp"],
            y=df_sorted["errors"],
            mode="lines+markers",
            name="Errors",
            line=dict(color="red", width=2),
            marker=dict(size=8)
        ),
        row=1, col=2
    )

    fig.add_trace(
        go.Scatter(
            x=df_sorted["timestamp"],
            y=df_sorted["warnings"],
            mode="lines+markers",
            name="Warnings",
            line=dict(color="orange", width=2),
            marker=dict(size=8)
        ),
        row=1, col=2
    )

    # 3. Volume Snapshot Success Rate
    fig.add_trace(
        go.Bar(
            x=df_sorted["timestamp"],
            y=df_sorted["vol_snapshots_completed"],
            name="Successful Snapshots",
            marker=dict(color="green"),
            hovertemplate="<b>Successful:</b> %{y}<extra></extra>"
        ),
        row=2, col=1
    )

    fig.add_trace(
        go.Bar(
            x=df_sorted["timestamp"],
            y=df_sorted["failed_volumes"],
            name="Failed Snapshots",
            marker=dict(color="red"),
            hovertemplate="<b>Failed:</b> %{y}<extra></extra>"
        ),
        row=2, col=1
    )

    # 4. Backup Duration Over Time
    duration_df = df_sorted[df_sorted["duration_minutes"].notna()]
    if not duration_df.empty:
        fig.add_trace(
            go.Scatter(
                x=duration_df["timestamp"],
                y=duration_df["duration_minutes"],
                mode="lines+markers",
                name="Duration (min)",
                line=dict(color="purple", width=2),
                marker=dict(size=8),
                hovertemplate="<b>Duration:</b> %{y:.1f} min<extra></extra>"
            ),
            row=2, col=2
        )

    # 5. Failures by Backup Type (Pie Chart)
    failed_df = df[df["phase"].isin(["Failed", "PartiallyFailed"])]
    if not failed_df.empty:
        type_counts = failed_df["backup_type"].value_counts()
        fig.add_trace(
            go.Pie(
                labels=type_counts.index,
                values=type_counts.values,
                name="Failures by Type"
            ),
            row=3, col=1
        )

    # 6. Items Backed Up vs Total
    fig.add_trace(
        go.Scatter(
            x=df_sorted["timestamp"],
            y=df_sorted["items_backed_up"],
            mode="lines+markers",
            name="Items Backed Up",
            line=dict(color="blue", width=2),
            marker=dict(size=8)
        ),
        row=3, col=2
    )

    fig.add_trace(
        go.Scatter(
            x=df_sorted["timestamp"],
            y=df_sorted["total_items"],
            mode="lines+markers",
            name="Total Items",
            line=dict(color="gray", width=2, dash="dash"),
            marker=dict(size=8)
        ),
        row=3, col=2
    )

    # Update layout
    fig.update_layout(
        height=1400,
        width=1600,
        title_text="Velero Backup Analysis Dashboard",
        showlegend=True,
        template="plotly_white"
    )

    # Update axes
    fig.update_xaxes(title_text="Time", row=3, col=1)
    fig.update_xaxes(title_text="Time", row=3, col=2)
    fig.update_yaxes(title_text="Count", row=1, col=2)
    fig.update_yaxes(title_text="Count", row=2, col=1)
    fig.update_yaxes(title_text="Minutes", row=2, col=2)
    fig.update_yaxes(title_text="Items", row=3, col=2)

    # Save as HTML
    html_path = output_dir / "velero-report.html"
    fig.write_html(str(html_path))
    console.print(f"[green]✓[/green] Saved interactive dashboard to: {html_path}")

    # Save as PNG
    try:
        png_path = output_dir / "velero-report.png"
        fig.write_image(str(png_path), width=1600, height=1400)
        console.print(f"[green]✓[/green] Saved static image to: {png_path}")
    except Exception as e:
        console.print(f"[yellow]⚠[/yellow] Could not save PNG (kaleido issue): {e}")


def display_summary_table(df: pd.DataFrame):
    """Display a summary table of all backups."""
    table = Table(
        title="Velero Backup Summary",
        box=box.ROUNDED,
        show_header=True,
        header_style="bold cyan"
    )

    table.add_column("Backup Name", style="white", width=30)
    table.add_column("Time", style="dim")
    table.add_column("Status", justify="center")
    table.add_column("Type", style="cyan")
    table.add_column("Errors", justify="right", style="red")
    table.add_column("Warnings", justify="right", style="yellow")
    table.add_column("Items", justify="right")
    table.add_column("Volumes", justify="right")
    table.add_column("Duration", justify="right")

    df_sorted = df.sort_values("timestamp", ascending=False)

    for _, row in df_sorted.head(20).iterrows():
        # Status with color
        status_style = {
            "Completed": "[green]✓ Completed[/green]",
            "PartiallyFailed": "[yellow]⚠ Partial[/yellow]",
            "Failed": "[red]✗ Failed[/red]",
            "InProgress": "[blue]⋯ Progress[/blue]"
        }.get(row["phase"], row["phase"])

        # Format timestamp
        time_str = row["timestamp"].strftime("%Y-%m-%d %H:%M") if pd.notna(row["timestamp"]) else "N/A"

        # Volume info
        vol_info = f"{row['vol_snapshots_completed']}/{row['vol_snapshots_attempted']}"
        if row["failed_volumes"] > 0:
            vol_info = f"[red]{vol_info}[/red]"
        else:
            vol_info = f"[green]{vol_info}[/green]"

        # Items info
        items_info = f"{row['items_backed_up']}/{row['total_items']}"

        # Duration
        duration_str = f"{row['duration_minutes']:.1f}m" if pd.notna(row["duration_minutes"]) else "N/A"

        table.add_row(
            row["name"][:28] + "..." if len(row["name"]) > 28 else row["name"],
            time_str,
            status_style,
            row["backup_type"],
            str(row["errors"]) if row["errors"] > 0 else "-",
            str(row["warnings"]) if row["warnings"] > 0 else "-",
            items_info,
            vol_info,
            duration_str
        )

    console.print(table)


def display_failure_details(failed_backups: List[tuple]):
    """Display detailed failure information."""
    if not failed_backups:
        console.print(Panel("[green]No failures to report![/green]", title="Failure Details"))
        return

    for backup_name, details in failed_backups:
        # Create a panel for each failed backup
        content = []

        if details["errors"]:
            content.append("[bold red]Errors:[/bold red]")
            for error in details["errors"][:10]:  # Limit to 10 errors
                content.append(f"  • {error}")
            if len(details["errors"]) > 10:
                content.append(f"  ... and {len(details['errors']) - 10} more errors")

        if details["warnings"]:
            content.append("\n[bold yellow]Warnings:[/bold yellow]")
            for warning in details["warnings"][:5]:  # Limit to 5 warnings
                content.append(f"  • {warning}")
            if len(details["warnings"]) > 5:
                content.append(f"  ... and {len(details['warnings']) - 5} more warnings")

        if details["failed_volumes"]:
            content.append("\n[bold red]Failed Volumes:[/bold red]")
            for vol in details["failed_volumes"]:
                content.append(f"  • {vol}")

        # Add log snippet if available
        if details.get("full_logs"):
            content.append("\n[bold cyan]Error Log Context (first occurrence):[/bold cyan]")
            log_preview = details["full_logs"].split("\n\n---\n\n")[0]  # First error context
            for line in log_preview.split("\n")[:15]:  # First 15 lines
                content.append(f"  [dim]{line}[/dim]")
            if len(log_preview.split("\n")) > 15:
                content.append("  [dim]... (truncated, see full report)[/dim]")

        if not content:
            content.append("[dim]No detailed error information available[/dim]")

        console.print(Panel(
            "\n".join(content),
            title=f"[bold]{backup_name}[/bold]",
            border_style="red",
            expand=False
        ))


def generate_markdown_report(df: pd.DataFrame, failed_backups: List[tuple], output_dir: Path,
                            volume_contexts: Dict[str, Dict], openebs_logs: str, velero_logs: str, events: List[str]):
    """Generate a markdown report file."""
    report_path = output_dir / "velero-report.md"

    with open(report_path, "w") as f:
        f.write("# Velero Backup Failure Report\n\n")
        f.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S UTC')}\n\n")

        # Summary statistics
        total_backups = len(df)
        failed = len(df[df["phase"] == "Failed"])
        partial = len(df[df["phase"] == "PartiallyFailed"])
        completed = len(df[df["phase"] == "Completed"])

        f.write("## Summary\n\n")
        f.write(f"- **Total Backups Analyzed:** {total_backups}\n")
        f.write(f"- **Completed:** {completed}\n")
        f.write(f"- **Partially Failed:** {partial}\n")
        f.write(f"- **Failed:** {failed}\n")
        f.write(f"- **Success Rate:** {(completed / total_backups * 100):.1f}%\n\n")

        # Statistics
        f.write("## Statistics\n\n")
        f.write(f"- **Total Errors:** {df['errors'].sum()}\n")
        f.write(f"- **Total Warnings:** {df['warnings'].sum()}\n")
        f.write(f"- **Average Duration:** {df['duration_minutes'].mean():.1f} minutes\n")
        f.write(f"- **Total Volume Snapshots Attempted:** {df['vol_snapshots_attempted'].sum()}\n")
        f.write(f"- **Total Volume Snapshots Succeeded:** {df['vol_snapshots_completed'].sum()}\n")
        f.write(f"- **Total Volume Snapshots Failed:** {df['failed_volumes'].sum()}\n\n")

        # Recent backups table
        f.write("## Recent Backups\n\n")
        f.write("| Time | Backup Name | Status | Type | Errors | Warnings | Volumes |\n")
        f.write("|------|-------------|--------|------|--------|----------|----------|\n")

        df_sorted = df.sort_values("timestamp", ascending=False)
        for _, row in df_sorted.head(15).iterrows():
            time_str = row["timestamp"].strftime("%m-%d %H:%M") if pd.notna(row["timestamp"]) else "N/A"
            vol_info = f"{row['vol_snapshots_completed']}/{row['vol_snapshots_attempted']}"
            status_emoji = {"Completed": "✓", "PartiallyFailed": "⚠", "Failed": "✗"}.get(row["phase"], "?")

            f.write(f"| {time_str} | {row['name'][:30]} | {status_emoji} {row['phase']} | "
                   f"{row['backup_type']} | {row['errors']} | {row['warnings']} | {vol_info} |\n")

        # Failure details
        if failed_backups:
            f.write("\n## Failure Details\n\n")
            for backup_name, details in failed_backups:
                f.write(f"### {backup_name}\n\n")

                if details["errors"]:
                    f.write("**Errors:**\n\n")
                    for error in details["errors"]:
                        f.write(f"- {error}\n")
                    f.write("\n")

                if details["warnings"]:
                    f.write("**Warnings:**\n\n")
                    for warning in details["warnings"][:5]:
                        f.write(f"- {warning}\n")
                    f.write("\n")

                if details["failed_volumes"]:
                    f.write("**Failed Volumes:**\n\n")
                    for vol in details["failed_volumes"]:
                        f.write(f"- `{vol}`\n")
                    f.write("\n")

                # Add full log context
                if details.get("full_logs"):
                    f.write("**Detailed Log Context:**\n\n")
                    f.write("```\n")
                    f.write(details["full_logs"][:5000])  # Limit log size
                    if len(details["full_logs"]) > 5000:
                        f.write("\n... (truncated)\n")
                    f.write("\n```\n\n")

        # Volume context information
        if volume_contexts:
            f.write("\n## Volume Context Information\n\n")
            for vol_id, context in volume_contexts.items():
                f.write(f"### Volume: `{vol_id}`\n\n")

                if context.get("pvc_info"):
                    pvc = context["pvc_info"]
                    f.write("**PVC Information:**\n\n")
                    f.write(f"- Name: `{pvc.get('name')}`\n")
                    f.write(f"- Namespace: `{pvc.get('namespace')}`\n")
                    f.write(f"- Status: {pvc.get('status')}\n")
                    f.write(f"- Capacity: {pvc.get('capacity')}\n\n")

                if context.get("pv_details"):
                    pv = context["pv_details"]
                    f.write("**PV Information:**\n\n")
                    f.write(f"- Storage Class: `{pv.get('storage_class')}`\n")
                    f.write(f"- Capacity: {pv.get('capacity')}\n")
                    f.write(f"- Status: {pv.get('status')}\n\n")

                if context.get("zfs_volume"):
                    zfs = context["zfs_volume"]
                    f.write("**ZFS Volume Information:**\n\n")
                    f.write(f"- Pool: `{zfs.get('pool')}`\n")
                    f.write(f"- Capacity: {zfs.get('capacity')}\n")
                    f.write(f"- Status: {zfs.get('status')}\n\n")

        # System logs
        f.write("\n## System Logs\n\n")

        f.write("### Recent Velero Logs\n\n")
        f.write("```\n")
        f.write(velero_logs[:3000])  # Limit size
        f.write("\n```\n\n")

        f.write("### Recent OpenEBS Logs\n\n")
        f.write("```\n")
        f.write(openebs_logs[:3000])  # Limit size
        f.write("\n```\n\n")

        # Events
        if events:
            f.write("### Recent Backup Events\n\n")
            f.write("```\n")
            for event in events:
                f.write(f"{event}\n")
            f.write("```\n\n")

    console.print(f"[green]✓[/green] Saved markdown report to: {report_path}")


def main():
    """Main function."""
    console.print(Panel.fit(
        "[bold cyan]Velero Backup Failure Report Generator[/bold cyan]\n"
        "[dim]Analyzing backup history and generating visualizations...[/dim]",
        border_style="cyan"
    ))

    # Get all backups
    backups = get_all_backups()

    if not backups:
        console.print("[red]No backups found or unable to access Velero backups.[/red]")
        return

    console.print(f"[green]Found {len(backups)} backups[/green]")

    # Parse all backups
    parsed_backups = []
    for backup in backups:
        parsed = parse_backup(backup)
        parsed_backups.append(parsed)

    # Create DataFrame
    df = pd.DataFrame(parsed_backups)

    # Display summary table
    console.print("\n")
    display_summary_table(df)

    # Get detailed information for failed backups
    console.print("\n[cyan]Fetching detailed failure information...[/cyan]")
    failed_df = df[df["phase"].isin(["Failed", "PartiallyFailed"])].sort_values("timestamp", ascending=False)

    failed_backups = []
    for _, row in failed_df.head(10).iterrows():  # Get details for last 10 failures
        details = get_backup_details(row["name"])
        if details["errors"] or details["warnings"] or details["failed_volumes"]:
            failed_backups.append((row["name"], details))

    # Display failure details
    console.print("\n")
    display_failure_details(failed_backups)

    # Get additional context for failed volumes
    console.print("\n[cyan]Gathering volume context information...[/cyan]")
    unique_failed_volumes = set()
    for _, details in failed_backups:
        unique_failed_volumes.update(details.get("failed_volumes", []))

    volume_contexts = {}
    for vol in list(unique_failed_volumes)[:10]:  # Limit to 10 volumes
        console.print(f"[dim]Getting context for {vol}...[/dim]")
        volume_contexts[vol] = get_volume_context(vol)

    # Get system logs
    console.print("\n[cyan]Collecting system logs...[/cyan]")
    openebs_logs = get_openebs_logs()
    velero_logs = get_velero_logs()
    events = get_recent_events()

    # Create output directory
    output_dir = Path.cwd()

    # Create graphs
    console.print("\n")
    create_graphs(df, output_dir)

    # Generate markdown report
    generate_markdown_report(df, failed_backups, output_dir, volume_contexts, openebs_logs, velero_logs, events)

    # Print summary
    console.print("\n")
    total = len(df)
    failed_count = len(df[df["phase"] == "Failed"])
    partial_count = len(df[df["phase"] == "PartiallyFailed"])
    success_rate = (total - failed_count - partial_count) / total * 100 if total > 0 else 0

    summary = f"""
[bold]Report Summary:[/bold]
├─ Total Backups: {total}
├─ Failed: [red]{failed_count}[/red]
├─ Partially Failed: [yellow]{partial_count}[/yellow]
├─ Success Rate: [{"green" if success_rate > 80 else "yellow" if success_rate > 50 else "red"}]{success_rate:.1f}%[/]
├─ Total Errors: [red]{df['errors'].sum()}[/red]
└─ Total Warnings: [yellow]{df['warnings'].sum()}[/yellow]

[bold cyan]Generated Files:[/bold cyan]
├─ velero-report.html (interactive dashboard)
├─ velero-report.png (static visualization)
└─ velero-report.md (markdown report)
"""

    console.print(Panel(summary, title="[bold green]✓ Report Complete[/bold green]", border_style="green"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        console.print("\n[yellow]Report generation cancelled by user[/yellow]")
        sys.exit(1)
    except Exception as e:
        console.print(f"\n[red]Error: {e}[/red]")
        import traceback
        console.print(traceback.format_exc())
        sys.exit(1)
