# Samples

Frozen output from the canonical evaluator run:

```bash
make samples
# or:
make demo > samples/demo-output.txt 2>&1
```

- **`demo-output.txt`** — Checked-in capture: SpiceDB (first 100 lines), service metadata JSON, and the first ~3500 characters of unified JSON Schema from `make demo` (the Makefile suppresses stderr from the emitter for readability).

Refresh this file after meaningful changes to `schema/` or `src/` so reviewers can diff behavior without installing dependencies.
