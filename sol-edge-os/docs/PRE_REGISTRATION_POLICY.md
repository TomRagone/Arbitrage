### §1 — Core Rule
Before any search that yields a **discovery claim**, the following are written down and committed to git *before the run executes*: search space, threshold discretization, enumerate-or-sample decision, N (or exhaustive count), RNG seed, train/test/holdout boundaries, objective function, and significance threshold. Committed values are **binding**. A null result at the committed budget **is the answer** for that budget — not a cue to re-roll.

### §2 — Two Kinds of Knobs (the distinction that matters)
- **Setup preconditions** — may be repaired before the clock starts; not multiplicity-bearing. These ensure a candidate edge is *physically expressible and estimable*: enough data length, enough tail events for the planted/real signal to be samplable, enough events in each OOS segment to estimate stats. Fixing these repairs the experiment.
- **Multiplicity knobs** — pre-committed and frozen the instant results are first viewed: N / exhaustive flag, threshold grid resolution, max AST depth, feature set, whether exit is searched, objective, significance threshold.

**Boundary:** you may iterate on setup preconditions only while the question is *"can the apparatus express and estimate this at all?"* — **never** while the question is *"does a strategy clear significance?"* The moment the success criterion is significance, every knob is frozen.

### §3 — Sizing N
1. **Discretize** each searched threshold at the resolution where position materially changes the rule's behavior for the strategy class. Compute the committed count:
   `|space| = (per-tree comparison count) ^ (number of searched trees) × |sides|`
   where per-tree comparison count = `|features| × |ops| × |threshold grid|`. Note: whether **exit** is part of the search space (vs. a fixed rule like "unconditional +1 bar") changes the exponent and therefore `|space|` by orders of magnitude — record the choice explicitly.
2. **If `|space| ≤ B`** (per-run backtest budget): **enumerate exhaustively.** `trials = |space|`. Preferred whenever feasible — it removes sampling luck and makes the significance correction exact. Depth-1 and most depth-2 spaces fall here.
3. **If `|space| > B`**: random-sample with N pre-committed by **coverage**, not outcome:
   `N = ⌈ ln(1 − p) / ln(1 − f) ⌉  ≈  3 / f`  for p = 0.95
   where `f` = volume fraction of the acceptable neighborhood around a true rule (i.e., how finely the rule must be located). Commit `N, f, p, seed`. Cap `N` at `B`.

### §4 — Significance
Use the **Deflated Sharpe Ratio** computed from the empirical cross-sectional variance of the trial Sharpe estimates `V̂[{SR_n}]` — **not** a closed-form `√(2·ln N)` plug-in. Correlated candidates (neighboring ASTs give near-identical returns) make raw N overstate the effective number of independent trials; the variance term auto-discounts for this. The DSR acceptance threshold (e.g. `DSR > 0.95`) is itself pre-registered.

### §5 — Meta-Multiplicity (the 9.5 lesson, stated as law)
DSR corrects for the number of candidates **within one committed search**. It does **not** correct across multiple searches. Therefore:
- **One committed search per question.**
- If a committed search returns null and you elect to run another with different pre-registered parameters, that is a **new experiment**; family-wise multiplicity **compounds**, and every committed search on the question must be logged so the count is visible.
- Outcome-driven re-rolling of N or resolution on a discovery run is **prohibited**. (Repairing a setup precondition under §2 is not a re-roll, but must be logged with its reason.)

### §6 — Holdout
The locked holdout (Step 9.8) is evaluated **once**, for the **single** selected strategy, after all pre-registered search and selection are complete. Any second touch voids the estimate.

### §7 — Scope
Binding for **Phase 10+ (real data / discovery).** The synthetic capability controls (9.5/9.6) are **exempt** from the binding N rule, because their success criterion is recovery of a *known planted* edge, not discovery — but the §2 setup-vs-multiplicity hygiene still applies even there.
