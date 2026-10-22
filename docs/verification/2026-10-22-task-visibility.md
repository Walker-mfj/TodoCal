# Task visibility and custom validation

## Behavior

After creating a dated task from Calendar, navigate to its date, scroll to its start time when present, and clear filters that could hide it. Undated tasks remain in the unscheduled list, with an explanatory success notice. Creating from another page preserves that page.

Task, authentication, group, and settings forms replace native validation bubbles with an inline accessible alert. The invalid control receives focus, aria-invalid, and an error description. Existing server-error and retry handling remains in place.

## Evidence

- Immediate creation of both single and recurring tasks within the visible week already passed against the API; no cache invalidation failure was reproduced.
- A new regression reproduced an invisible newly created task outside the displayed week with a conflicting search filter; it passes after reveal/navigation changes.
- 27 frontend tests and TypeScript checking pass.
- Eight real-browser production scenarios pass, including immediate create, outside-week reveal, custom validation, and existing scheduling/authentication flows.
- Production build passes. Final notice presentation was checked with a targeted browser run and screenshot inspection.

The reported user's exact creation sequence is not yet confirmed; the verified hidden-date/filter cases are addressed without changing task scheduling semantics.
