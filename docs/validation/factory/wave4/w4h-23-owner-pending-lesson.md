# W4H-23 pending lessons (for the coordinator's fold; validator-8 F1, 2026-10-12)

- Owner: a baseline you measured is worthless if the decision does not read it. The initial Stryker run listed the 22 test
  files that cannot load in the sandbox, but the kill rule asked a later, separate run instead, and that run could be
  cancelled by a late bail and read as "loaded". Decide from the baseline of the SAME run (shared with every worker), and
  require positive evidence (the file ran and passed) before a check may say "clean".
- Owner: an intermittent false result (1 of 9 runs) is a correctness bug, not noise. Fix it by construction and prove it
  with a pin case that fails on the old code; never accept "it did not happen again in five runs" as the fix.
- Owner (the wrapper-edit lapse, already recorded in tasks/lessons.md at ad88e73b3 and kept there by the lead's ruling):
  copy a running shell script to a new name before changing it; bash reads a script as it executes.
