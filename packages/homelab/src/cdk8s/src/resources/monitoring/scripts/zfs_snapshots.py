#!/usr/bin/env python3
import os
import subprocess
from collections.abc import Callable, Iterable, Iterator
from functools import partial, reduce
from itertools import groupby
from operator import add, itemgetter
from typing import Any

from prometheus_client import CollectorRegistry, Gauge, generate_latest

# A parsed snapshot row: (pool, volume, snapshot, *numeric columns).
ParsedRow = tuple[Any, ...]
# An aggregated per-filesystem row: ((pool, volume), value).
AggregatedRow = tuple[tuple[Any, ...], float]


def row_to_metric(metric: Gauge, row: AggregatedRow) -> Any:
    return metric.labels(pool=row[0][0], volume=row[0][1]).set(row[1])


def collect_metrics(metric: Gauge, it: Iterable[AggregatedRow]) -> None:
    list(map(partial(row_to_metric, metric), it))


def zfs_parse_line(line: str) -> ParsedRow:
    cols = line.split("\t")
    rest, snapshot = cols[0].rsplit("@", 1)
    pool = rest
    volume = None
    if "/" in rest:
        pool, volume = rest.split("/", 1)
        volume = "/" + volume
    return pool, volume, snapshot, *map(int, cols[1:])


def zfs_list_snapshots() -> Iterator[str]:
    cmd = [
        "zfs",
        "list",
        "-p",
        "-H",
        "-t",
        "snapshot",
        "-o",
        "name,used,creation",
    ]
    # zfs list can be relatively slow (couple of seconds)
    # Use Popen to incrementally read from stdout to not waste further time
    popen = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, env=dict(os.environ, LC_ALL="C")
    )
    assert popen.stdout is not None
    for stdout_line in iter(popen.stdout.readline, ""):
        stdout_line = stdout_line.strip()
        if stdout_line == b"":
            break
        yield stdout_line.decode("utf-8")
    return_code = popen.wait()
    if return_code:
        raise subprocess.CalledProcessError(return_code, cmd)


def aggregate_rows(
    rows: Iterable[tuple[tuple[Any, ...], list[ParsedRow]]],
    index: int,
    operator: Callable[[Any, Any], Any],
) -> Iterator[AggregatedRow]:
    return map(
        lambda row: (row[0], reduce(operator, map(itemgetter(index), row[1]), 0)), rows
    )


NAMESPACE = "zfs_snapshot"
LABEL_NAMES = ["pool", "volume"]


def main():
    registry = CollectorRegistry()
    latest_time_metric = Gauge(
        "latest_time",
        "Timestamp of the latest snapshot",
        labelnames=LABEL_NAMES,
        namespace=NAMESPACE,
        registry=registry,
        unit="seconds",
    )
    space_used_metric = Gauge(
        "space_used",
        "Space used by snapshots in bytes",
        labelnames=LABEL_NAMES,
        namespace=NAMESPACE,
        registry=registry,
        unit="bytes",
    )

    snapshots = map(zfs_parse_line, zfs_list_snapshots())
    per_fs = list(
        map(
            lambda row: (row[0], list(row[1])), groupby(snapshots, lambda row: row[0:2])
        )
    )

    space_used = aggregate_rows(per_fs, -2, add)
    latest_time = aggregate_rows(per_fs, -1, max)

    collect_metrics(latest_time_metric, latest_time)
    collect_metrics(space_used_metric, space_used)

    print(generate_latest(registry).decode(), end="")


if __name__ == "__main__":
    main()
