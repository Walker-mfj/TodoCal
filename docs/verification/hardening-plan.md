# Complete acceptance hardening — October 23, 2026

User authorized closing the three remaining categories: acceptance combinations, cross-browser/accessibility/load verification, and storage/UUID defects. This extends the approved MVP without changing its visual direction or adding new product features.

1. Reproduce and fix denied/full browser storage across drafts, mutations, scheduling and logout; keep in-memory retries safe and disclose unavailable persistence.
2. Normalize all accepted UUID spellings before SQL, preserving account ownership and validation semantics; test malformed inputs and aliases.
3. Expand browser acceptance for exact progress transitions, overlap selection, untimed Month creation and simultaneous theme/draft/report/timer preservation.
4. Run all browser journeys on Chrome, Firefox and Playwright WebKit. Verify installed Safari separately through WebDriver when its remote automation permission is enabled. Never represent WebKit as a Safari run.
5. Audit WCAG A/AA rules with axe across auth, workspace sections, validation and timer in both themes; exercise keyboard navigation and visible focus. Fix observed issues and record the limits of automated accessibility evidence.
6. Measure an isolated synthetic large account and concurrent workload with explicit latency/error/correctness gates, clean up only test resources, and document measured capacity rather than general scalability claims.
7. Reconcile all 50 criteria to executable evidence, run affected suites, preserve review/evidence and commit changes. Public deployment remains separate.

The dispatching-parallel-agents skill authorizes independent storage, UUID and load harness work. Browser/a11y work stays in the parent task. Shared integration databases are never reset concurrently.
