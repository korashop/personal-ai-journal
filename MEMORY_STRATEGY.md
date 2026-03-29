# Memory Strategy

## Goal

Preserve high-value cumulative memory without sending the entire raw journal corpus on every model call.

## Recommended context stack

### For entry analysis

- Current raw entry in full
- Rolling memory document in full
- Recent entry summaries
- A small set of especially relevant prior entries or themes

This preserves continuity while keeping token use bounded.

## Why not send the full raw journal every time

- Cost rises quickly as the journal grows
- Latency increases
- Signal quality can get worse when too much unrelated history is stuffed into the prompt

The better pattern is:
- store raw entries permanently
- maintain high-quality per-entry summaries
- maintain a living memory document
- maintain a stable theme layer with continuity over time
- later add retrieval so the model can pull in the few older entries that matter most

## Theme continuity

Patterns should not be regenerated as if the journal has no history of its own.

The better approach is:
- keep stable theme IDs
- preserve a theme when new entries still support the same underlying thread
- refine theme titles only when the theme has genuinely sharpened
- avoid promoting one-off ideas into durable themes
- use cross-entry evidence, not a single vivid entry, as the threshold for a lasting pattern

## Model tiering

Using lighter models for some jobs is reasonable and not too complicated if the split is clear.

### Heavy model

Use the strongest model for:
- new entry analysis
- memory document rewrites
- theme synthesis when quality matters
- re-analysis after a meaningful entry edit

### Lighter model

A lighter or cheaper model can later be used for:
- first-pass OCR cleanup
- generating candidate tags
- drafting entry titles or feed labels before final refinement
- non-critical theme refreshes
- maintenance work that does not affect the main user-facing interpretation

## Best near-term approach

- Keep one strong model for analysis and memory
- Avoid sending all raw history every time
- Improve entry summaries and memory quality
- Add retrieval later so older raw entries can be brought in selectively when relevant
