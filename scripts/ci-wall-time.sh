#!/usr/bin/env bash
# ci-wall-time.sh <label> <median-seconds>
# Prints the wall time of one CI phase and warns when it is more than twice the
# phase's measured median, so a slow hosted runner is named in the log.
# The phase starts at $WALL_TIME_START (epoch seconds, written to $GITHUB_ENV by
# an earlier step) and ends now. The script then writes WALL_TIME_START=now, so
# the next phase starts where this one ends.
# Visibility only: a slow phase exits 0. It never fails or retries the job; a
# retry would hide the slowness. A missing start or median is a workflow error
# and exits 2.
set -euo pipefail

usage="usage: ci-wall-time.sh <label> <median-seconds>"
label=${1:?$usage}
median=${2:?$usage}
if ! [[ "$median" =~ ^[1-9][0-9]*$ ]]; then
  echo "ci-wall-time: the median must be a positive integer of seconds (got '$median')" >&2
  exit 2
fi
if ! [[ "${WALL_TIME_START:-}" =~ ^[0-9]+$ ]]; then
  echo "ci-wall-time: WALL_TIME_START is not set; an earlier step must write it to \$GITHUB_ENV" >&2
  exit 2
fi

now=$(date +%s)
elapsed=$((now - WALL_TIME_START))
limit=$((2 * median))
echo "$label wall time: ${elapsed}s (median ${median}s; warns above ${limit}s)"
if [ "$elapsed" -gt "$limit" ]; then
  echo "::warning title=Slow runner::$label took ${elapsed}s, more than 2x its median of ${median}s. The hosted runner is slow; this is not a test failure."
fi
echo "WALL_TIME_START=$now" >> "${GITHUB_ENV:?GITHUB_ENV is not set}"
