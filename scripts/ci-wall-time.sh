#!/usr/bin/env bash
# ci-wall-time.sh <label> <median-seconds>
# Prints the wall time of one CI phase and warns when it is more than twice the
# phase's measured median, so a slow hosted runner is named in the log.
# The phase starts at $WALL_TIME_START (epoch seconds, written to $GITHUB_ENV by
# an earlier step) and ends now. The script then writes WALL_TIME_START=now, so
# the next phase starts where this one ends.
# Visibility only: it always exits 0. It never fails or retries the job; a
# retry would hide the slowness. A missing start time, median or $GITHUB_ENV is
# a workflow error: it prints a WARN line and a ::warning annotation instead.
set -uo pipefail

# warn <title> <text>: one plain WARN line for the raw log, one annotation for the run summary.
warn() {
  echo "WARN: $2"
  echo "::warning title=$1::$2"
}

label=${1:-}
median=${2:-}
now=$(date +%s)

if [ -z "$label" ] || ! [[ "$median" =~ ^[1-9][0-9]*$ ]]; then
  warn "Wall time not measured" "ci-wall-time.sh needs <label> <median-seconds> (got label '$label', median '$median')"
elif ! [[ "${WALL_TIME_START:-}" =~ ^[0-9]+$ ]]; then
  warn "Wall time not measured" "$label: WALL_TIME_START is not set; an earlier step must write it to \$GITHUB_ENV"
else
  elapsed=$((now - WALL_TIME_START))
  limit=$((2 * median))
  # The ratio with one decimal, rounded, in integer arithmetic.
  tenths=$(((elapsed * 10 + median / 2) / median))
  ratio="$((tenths / 10)).$((tenths % 10))x"
  echo "$label wall time: ${elapsed}s (median ${median}s, ${ratio}; warns above 2x = ${limit}s)"
  if [ "$elapsed" -gt "$limit" ]; then
    warn "Slow runner" "$label took ${elapsed}s, ${ratio} its median of ${median}s (warns above 2x). The hosted runner is slow; this is not a test failure."
  fi
fi

if [ -n "${GITHUB_ENV:-}" ]; then
  echo "WALL_TIME_START=$now" >> "$GITHUB_ENV"
else
  warn "Wall time not measured" "GITHUB_ENV is not set; the next phase has no start time"
fi
exit 0
