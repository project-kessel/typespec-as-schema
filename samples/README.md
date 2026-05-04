# Samples

Frozen output from the canonical evaluator run:

```bash
make samples          # regenerate demo-output.txt
make demo             # same output on stdout
```

- **`demo-output.txt`** — Checked-in capture of all five emitter output modes:
  1. **SpiceDB / Zed** — full schema with cascade-delete permissions
  2. **Service metadata (JSON)** — per-application permissions, resources, cascade policies, annotations
  3. **Unified JSON Schema** — relationship-derived JSON Schemas for non-RBAC resources
  4. **Annotations** — flattened `ResourceAnnotation` key/value pairs
  5. **Preview** — `--preview inventory_host_view` showing the SpiceDB expansion for a single permission

Refresh this file after meaningful changes to `schema/` or `src/` so reviewers can diff behavior without installing dependencies.
