# Local solver boundary

`local-audio.mjs` drives only verified reCAPTCHA frames on the existing Playwright
page. `transcribe.py` reads a temporary audio file and runs a local CPU Whisper
model. The approach references the MIT-licensed ibedevesh/capsolver project at
commit 409fe81076619603c49375eb11b2cfd366527754; its original license is retained.
The browser integration is adapted for Plainhand's same-session approval and
no-submission boundaries rather than the reference's standalone-browser/token API.

No paid fallback is selected automatically. Other local/third-party solvers can
implement the same `ready()` and `solve(page)` interface, returning an observed
outcome. Each needs type-specific browser checks and live validation; model output
alone is not proof of verification. See docs/FREE-CAPTCHA-SOLVERS.md.
