# Source-local schedule consumption

The public web client now reads the existing `sourceLocalDate`,
`sourceLocalTime`, `sourceTimeZone` block in addition to legacy `date`/`time`.
This is a consumer repair, not a schedule or timezone-policy change.

## Contracts preserved

- Legacy `time` remains Europe/Madrid. Never fill it with venue-local time.
- Source-local evidence must be complete and resolve to one civil instant.
  No date/zone is guessed. Invalid dates, DST gaps/folds and conflicting
  local/legacy evidence remain unconfirmed.
- The agenda keeps its existing user-device local primary time, secondary
  `España:` line, tooltip and day-shift label relative to `event.date`.
- Legacy informational fallback text stays unchanged where the original
  format guard failed and no source-local evidence exists.
- Start status and nearest-event selection use the same instant. Their
  existing estimated-duration rules are unchanged; these are not results.
- Raw data, date grouping, event IDs, favorites, identity merging, television
  status, scrapers, results and chronicles are unchanged.

Xmatkuil on 2026-11-15 is a regression fixture, not a hard-coded exception:
16:30 America/Merida is 22:30 UTC, 23:30 Europe/Madrid.

## Scope limits

This repairs the public agenda consumer. Nearby-event cards and native
notification paths still have separate raw `time` contracts and are not
migrated here. Publishing this web bundle does not certify an installed
native app or enable native reminders for local-only records.

## Validation

```
node --check script.js
node --test test/*.test.mjs
node qa/client-local-time-audit.mjs data/programacion.json
git diff --check
```

The audit compares with `fd89002747feb313164c7f360bb3d0833198fd06`, accepts an
optional third argument for another baseline commit, and requires that Git
object to be present. It asserts unchanged legacy/unknown presentation and
unchanged identity, order and material data across five user time zones.

Against the public 2026-11-15T02:23:38.993Z snapshot (736 rows): 179 legacy
and 478 unknown schedules are unchanged; 79 complete local schedules resolve.
The focused suite covers multiple IANA zones, seasonal changes, midnight,
partial/conflicting evidence, immutable input and the Sin TV header/status.
