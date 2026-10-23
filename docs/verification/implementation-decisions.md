# Implementation decisions and deferred findings

Preserved from the execution ledger at local acceptance. Historical milestone limitations below describe decisions at that time; Tasks 6–7 subsequently implemented timer and analytics. The deferred inline calendar progress item was resolved in Task 7. Remaining known limits are listed in mvp-acceptance.md.

- Ruling: User's request to start after the recommended native path is treated as authorization for native execution; no implementer subagents.

- Ruling: The initial repository had no commits; committed approved docs before creating a native isolated worktree. A mistakenly included Finder metadata file is untracked in this branch without deleting it.

- Task 1: Ruling: Keep the first authentication slice in internal/server with embedded migrations and separate runtime config; avoid empty package/service layers until domain code needs them. Cost if wrong: package extraction before Task 2.

- Task 1: Ruling: Interpret the requested next step as the first runnable backend milestone; Tasks 2–8 remain pending and are not represented as complete. Cost if wrong: the user expected the entire MVP in this turn.

- Task 2: Ruling: Domain functions accept the existing pgx transaction; internal/account.WithTx owns the lock/commit, internal/server owns HTTP and idempotency. Avoid nested account transactions. Cost if wrong: adapters for later services.

- Task 2: Ruling: This continuation implements the next backend milestone; historical catch-up is explicitly deferred to Task 3. Current event logs are not presented as finalized reports. Cost if wrong: no historical reporting until Task 3.

- Task 2 review: minor (deferred): URN UUID strings pass uuid.Parse but fail SQL conversion, returning 500 rather than 404/422; canonical UUIDs work. Normalize IDs in a later validation pass.

- Task 2 review: Ruling: Reviewer deferred recurrence/history, undo and frontend; these are later plan tasks and remain incomplete. Cost if wrong: no complete MVP or historical correctness claim at this milestone.

- Task 2 review: Ruling: Reviewer deferred concurrently edited OpenAPI/docs; author parsed YAML, resolved internal references and compared response fields with handlers. Cost if wrong: contract integration mismatch caught when adding the frontend.

- Task 3: Ruling: Catch-up commits at most 31 days per transaction, reusing account.WithTx and its lock; planning.WithTx retries batches and only then runs the caller command in the final locked transaction. Cost if wrong: extra transactions for accounts with long gaps.

- Task 3: Ruling: A recurring wall time that does not exist is skipped with a persisted invalid_local_time exception and calendar warning; no missed-plan penalty. Unfinalized future gap predictions are reevaluated on zone change. Cost if wrong: the user may prefer shifting that occurrence and must instead create a valid one.

- Task 3: Ruling: Forward time-zone changes finalize crossed dates at change time under the prior zone; this preserves accepted plans instead of applying retroactive midnight cutoffs. Cost if wrong: a transitional day is shortened.

- Task 3 review: Ruling: Reviewer declined integration execution to avoid resetting the shared test DB; author runs the full suite. Frontend/focus/period reports remain later milestones; OpenAPI is author-checked. Cost if wrong: later consumer integration catches contract gaps.

- Task 3 review: Ruling: Large-account query performance remains unbenchmarked beyond bounded batches and worker fairness. Cost if wrong: exceptionally large account batches need tuning; API fallback is available.

- Task 4: Ruling: Add owned GET /series/{id} metadata because the UI needs the authoritative revision to stop a series after reload. Cost if wrong: one small additional REST endpoint; ownership and revision are integration-tested.

- Task 4: Ruling: Use a single authenticated workspace route with an auth gate rather than separate login/register routes; private cache is cleared at account/session boundaries. Cost if wrong: no deep links to login/register forms.

- Task 4: Ruling: Week/month daily grids consume the existing calendar/day API now; aggregate ratios, comparisons, and focus totals remain Task 7. Cost if wrong: users wait for the next analytics milestone for aggregate statistics.

- Task 4 review: Ruling: Authenticated responses include X-Account-ID and owned reads verify it before caching; focus/reconnect validates identity before invalidating data. Cost if wrong: older API binaries are incompatible with the new frontend and must be restarted together.

- Task 4 review: minor (deferred): Calendar Day/Month cells do not yet embed daily progress; independent Progress grids provide all dates. Add inline calendar progress with Task 7.

- Task 4 review: minor (deferred): Weekly recurrence summary does not spell out its weekday; scheduled date remains visible.

- Task 5 review: minor (deferred): unavailable sessionStorage can prevent calendar command dispatch; broader storage-denied recovery across forms remains a follow-up.

- Task 6: Ruling: The user's request for the next step is scoped to the next runnable milestone (optional Pomodoro), consistent with prior continuations. Period analytics and final acceptance remain Tasks 7–8.

- Task 6: Ruling: Services accept the existing locked account transaction; focus reads settle expired sessions, while persisted intervals allow later analytics to split time across midnight. Cost if wrong: analytics must call settlement or include active intervals explicitly.

- Task 6: Ruling: Use accumulated microseconds plus intervals to preserve partial seconds across pauses and Unix-microsecond arithmetic to support the existing full positive-int32 duration settings range without time.Duration overflow.

- Task 6: Ruling: Recommend a long break after every fourth full focus session; early-ended focus recommends focus, completed/ended breaks recommend focus. All session kinds remain manual choices.

- Task 7: Ruling: Reuse the existing Progress page and daily ring components; add AnalyticsSummary/DayFocusDetails instead of duplicating the page and ring implementations. Cost if wrong: later page extraction is mechanical.

- Task 7: Ruling: Historical plan snapshots remain immutable; partial prior-period cutoff days are reconstructed from timestamped task events without changing snapshots. Missing DST comparison wall times advance to the next valid minute.

- Task 7: Ruling: Focus reporting uses the current account timezone for every date, explicitly displayed as focusTimezone, while historical task plans retain their stored timezone. This prevents overlapping day windows after timezone changes; cost if wrong: focus distribution across dates changes when the user changes timezone.

- Task 8: Ruling: Extend existing browser journeys instead of duplicating their account/session/conflict/retry scenarios. Put acceptance under apps/web/tests/e2e, the actual configured browser test root. Cost if wrong: one test-file relocation.

- Task 8: Ruling: Rehearse reversible migration 6 and database outage in a new disposable container with synthetic fixtures; do not roll back shared developer data. Cost if wrong: destructive older down migrations require a separate recovery exercise.

- Final: Ruling: Public deployment and large-account throughput remain outside local acceptance; no deployment or load certification is claimed. Cost if wrong: further hardening and tuning before public use.

- Final: Ruling: Reviewer set aside known storage-denied and UUID issues; retain them as explicit known limits. Cost if wrong: those nonstandard inputs require follow-up fixes.

- Final: Ruling: Final acceptance additions are author-verified; review covered all application code through 9b6034a plus the reported defect validated by regression. Cost if wrong: no independent review of the new test harness.

- Final: Ruling: Visual/accessibility and OpenAPI parity are scoped to Chrome journeys, manual screenshots and generated type checking, not exhaustive certification. Cost if wrong: other browsers or assistive technology need further validation.

- Task 8: Ruling: Record already-completed full verification instead of repeating it solely for task-done bookkeeping; developer instruction forbids redundant test repetition without a new change or concern. Cost if wrong: completion evidence spans the recorded commands instead of one wrapper log.
