# RESULT Section Format Convention

Every pre-registration record's `## RESULT` section should follow this shape
so it can be parsed mechanically (the research dashboard depends on this),
without changing the PRE section's format or any of the policy in
`docs/PRE_REGISTRATION_POLICY.md`. Same underlying data either way — this is
a presentation/parseability convention, not a new data requirement.

```markdown
## RESULT (fill after; do not edit the PRE block)

**Data used:** <bar count> bars (<source>), <ISO start> .. <ISO end>. Integrity (10A.2): <N> hard violations, <N> spacing gaps.

**Holdout:** <bar count> bars, <ISO start> .. <ISO end> (or "n/a" if this run's design has no dedicated holdout segment).

### Per-fold results

| Fold | OOS Expectancy (bps/trade) | Trades | Rule |
|---|---|---|---|
| 0   | 451.25 | 5 | LONG rsi_14>20/<20 |
| ... | ...    | . | ... |

(If the run has no fold structure — e.g. a single train/test/holdout split — use a one-row table with Fold = "—" and Rule = the top candidate, or omit the table and say so explicitly. Don't force a fold table onto a design that doesn't have folds.)

**Pooled top candidate:** <strategy description>
**Pooled OOS expectancy:** <bps>bps/trade
**Pooled OOS trades:** <N>
**Pooled OOS max drawdown:** <pct>%
**Trials (committed N):** <N>
**DSR verdict:** Significant: <Yes/No> (DSR >= 0.95, min 10 OOS trades)
**Holdout status:** Untouched | Evaluated once: <result>

**Conclusion:** <prose, as before — this stays free-form>
```

Field names above (`**Pooled top candidate:**`, `**DSR verdict:**`, etc.)
are matched literally by the dashboard's markdown parser
(`apps/web/lib/preregistration.ts`) — keep the bold-label-then-colon shape
exact if you add a new search record, or update the parser if the shape
needs to change.

This convention starts with 10C-001 and 10C-002 (both retroactively
reformatted to match, same numbers, no figures changed) and is binding for
10C-003 onward.

**Binding going forward:** write the RESULT section in this shape directly
when 10C-003 (and every search after it) is filled in — there is no
reformat-after-the-fact step anymore. Writing a new result in the old
free-form bullet style and reformatting it later is no longer the
convention; just use this shape from the start.
