# Pre-Registration Record

## PRE (commit before the run)
- Run ID:
- Date / git commit:
- Committed-search # on this question:        (1 = first; >1 means §5 multiplicity compounds)
- Question / hypothesis:

- Data source & date range:
- Split: train __% | test __% | holdout __%   (absolute boundary timestamps:)
- Setup preconditions fixed (and why — §2):

- Search space:
    features:
    ops:
    depth:
    exit searched? (Y/N; if N, fixed exit rule:)
    sides:
    threshold range & grid step:
  → |space| =

- Decision:  [ ] ENUMERATE (trials = |space|)   [ ] SAMPLE (N=__, f=__, p=__, seed=__)
- Objective function:
- Significance: DSR threshold = ____ ; using V̂[{SR_n}]

## RESULT (fill after; do not edit the PRE block)
- Top strategy:
- Train stats / Test (OOS) stats:
- trials used / DSR:
- Significant? (Y/N):
- Holdout result (only if a strategy was selected):
