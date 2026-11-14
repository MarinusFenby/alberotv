# Vig5 client event identity candidate

Prepared in a clean isolated checkout of fc5558d8e6f8e30cba7cacf5a7d8da21b50d4c08. No production, API, database, active dirty checkout or deployment changes.

## Finding

Both source records are the 15 November 2026 Cinco Villas corrida: Caparica, Alejandro Talavante, Sergio Flores and Héctor Gutiérrez; 13:00 America/Mexico_City.

- Official participant evidence: https://www.alejandrotalavante.es/index.php/carteles/393-cinco-villas-mexico?date=2026-11-15-13-00
- Arena/municipality evidence: https://altoromexico.com/?acc=noticiad&id=53000
- Public API already returns only altoromexico-46f408395ca840.
- The public static JSON contains this record and mundotoro-dd83ec2dd7f05f. The web client reads that static JSON, not the API, and its old city-string comparison failed to identify the same arena.

## Changes

The client groups potential duplicates by necessary identity conditions, then requires pairwise agreement: venue-local date, exact arena or documented exact arena alias, complete identical participant set, matching herd and modality, compatible unique start instants, and no explicit venue-ID, lifecycle, cancellation/deletion, deferred/broadcast or cattle-count conflict. It never removes municipality words or broadly aliases all arenas in a city.

Unknown times remain distinct unless a separately verified dated occurrence establishes equivalence. The narrow Cinco Villas proof checks source IDs, dated identity, participants, herd, modality and any available start time. It does not invent a time or approve other events with missing schedules.

The canonical Cinco Villas ID, displayed location, participant order and material fields stay unchanged. Source details and duplicate source snapshots retain provenance and historical favorite keys. Generic merges are deterministic; a group must have pairwise agreement so an incomplete record cannot bridge two sessions.

Favorite lookup accepts each validated legacy key, including when only the canonical source is subsequently present. Read-time migration retains every saved row, label, additional field and original key; unrelated favorites and categories stay unchanged. Explicit unchecking removes all aliases of that selected event. The favorites manager supports removing an old key after migration. Location favorites recognize the documented arena aliases without changing the displayed location or globally normalizing saved locations.

Migration is cached by the current loadedEvents array and exact storage contents; explicit saves and newly loaded snapshots invalidate it. Returned objects are independent editable copies. This follows the existing client contract that every new agenda load replaces loadedEvents. A storage write failure leaves readable favorites available in memory.

## Validation

- node --check script.js
- node --test test/client-display-identity.test.mjs
- node --test test/*.test.mjs
- git diff --check
- node qa/client-display-audit.mjs > qa/client-display-audit.json

The focused suite covers input order and repetition, serialized cache, unrelated arenas, explicit venue identifiers, sessions, unknown starts, ambiguous/nonexistent DST times, local/Madrid date boundaries, complete/contradictory lineups, herd, count, channel, cancellations, suspension, deleted/tombstone flags, legacy favorites from both cards, idempotent migration, failed persistence, explicit removal and bounded migration during a full-calendar repaint.

The full 736-record baseline produces 735 displayed records. The only removed duplicate is the Mundotoro Cinco Villas card; all other events remain present. Canonical source fields stay unchanged except combined source provenance and the new displayDuplicateRecords metadata. The exact input/script hashes and measured delta are in qa/client-display-audit.json.

## Visual check and limits

Safari native UI was used against a loopback-only local server, after DOM-browser inventory was unavailable. The 15 November page rendered one Cinco Villas card with Caparica and the correct participant order. A saved local favorite remained selected after reopening the page; its checkbox was checked, and unchecking/saving returned the card to the unselected state. A slow first candidate exposed repeated favorite migration; the final candidate fixes that and includes a full-calendar regression.

Legacy-key recovery and contradictory variants were tested with real client functions in Node, not by editing the user's browser storage. No production favorites were touched. No installed iOS build, narrow-phone viewport, notification-permission flow or new API deployment is certified here. The existing client treatment of local start-time display was not changed.

The candidate intentionally keeps uncertain or contradictory rows visible rather than silently selecting a winner. New venue aliases or unknown-time event proofs require evidence and tests. This is a client correction, not the scheduled Vig5 publisher or its authorization gate.

## Integration

Apply the incremental patch to a clean intended client branch and rerun its combined suite after integration with concurrent changes. Do not overwrite the active dirty scraper checkout or replace the running API image. Static source data was deliberately not edited. Publishing remains a separate action.

## Web integration revalidation (14 November 2026)

The client delta was copied to a separate clean checkout of main at 45147ea119a2471778bb5d514db8329900a7cdfa. The current base script blob remains b42a81766f9d823a626653c8184a0c8e9c20b30a, identical to the original candidate's base. The school-lineup scraper correction 9093195 and subsequent automatic data updates remain intact.

Fresh validation passed 29 focused client identity/favorite tests and 137 total tests after the independent-review correction below. The complete current static snapshot generated at 2026-11-14T18:58:50.891Z still changes from 736 to 735 displayed records: only mundotoro-dd83ec2dd7f05f is combined into altoromexico-46f408395ca840, with provenance metadata preserved and no material canonical fields changed. The 25 October Cinco Villas records remain untouched because their participant sets differ and no dated proof covers them.

The index script cache version is advanced so returning web clients request the corrected asset. No API, database, VIG5 runtime, static event data, native/iOS build, notification permissions or source credentials are changed. These test results establish local integration only; publication and live-page verification must be recorded separately.

### Independent-review correction

A migration-first regression showed that persisted legacyKeys could incorrectly mark a contradictory later source and erase its separate canonical favorite. legacyKeys now remains provenance only. Matching uses the current saved key against aliases revalidated from the current snapshot; manager removal without a unique current alias owner removes only the exact displayed saved key. Regression coverage follows migration and serialized persistence with venue, cartel, herd, session-time, cancellation, deletion, deferred and channel conflicts, manager removal, separate selection and restoration of a valid snapshot. No saved row or legacy provenance is discarded during reading.

Unrecognized nonempty or malformed lifecycle state fields now also prevent fusion. Missing, null and empty state fields retain their prior treatment. Tests cover both input orders without interpreting unknown states.
