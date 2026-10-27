# Sample candidate

Fictional profile used for demos, screenshots, and integration runs.

- **Source:** [`jsonresume/resume-schema` → `sample.resume.json`](https://github.com/jsonresume/resume-schema/blob/master/sample.resume.json)
- **License:** MIT (repository license)
- **Person:** Richard Hendriks — a fictional character from the TV series
  *Silicon Valley*, used by the JSON Resume project as its sample. Not a real
  candidate, not a real employer, not real contact details.

`cv.md` is rendered from that JSON. `profile.yml` maps the same facts into the
Career-Ops profile shape.

## Use

```bash
node demo/seed-sample.mjs                 # writes to /tmp/plainhand-sample
node demo/seed-sample.mjs --data-root ./  # seed the current workspace (overwrites config/profile.yml and cv.md)
node demo/run-sample.mjs                  # context assembly + live discovery + live posting verification
```

Nothing here writes to an employer: the runner only reads public boards and
verifies a posting.
