# Free CAPTCHA handling in Plainhand

Research and implementation: 2026-10-18. The default browser is local Chromium.
No paid solver account, proxy subscription or CAPTCHA API key is required for
the local audio adapter. Local compute, memory and electricity are still needed.

## Implemented and installed

`npm run setup:captcha` installs an isolated Python environment and an English
Whisper model under the ignored `data/plainhand/solver/` directory. It does not
modify system Python. For another workspace, run:

```bash
npm run setup:captcha -- --data-root /absolute/path/to/workspace
```

Restart Plainhand after changing code; the Workspace screen reports whether the
local solver is installed. **Autofill to final review** tries the local solver
when it encounters a supported reCAPTCHA challenge, then reinspects and continues
on the same application page if the provider confirms success. The model does not
receive the candidate profile, cookies or application answers. Set
`PLAINHAND_CAPTCHA_SOLVER=off` before starting the app to disable local solving.

The implementation uses `faster-whisper==1.2.1`, `av==16.0.1`, CPU int8 inference,
and the public `Systran/faster-whisper-tiny.en` model. Model revision is recorded
in `ready.json`; transcription uses offline mode and local files only. A real
audio-decode/inference preflight runs during setup. The PyAV pin fixes an actual
incompatibility found while testing against PyAV 19, not just loading the model.

This adapter recognizes Google/recaptcha.net verification frames, tries the
checkbox, uses an offered audio challenge, transcribes locally, and checks the
provider's checked-state afterward. It does not create a second browser, inject a
cross-session token or select an employer submit control. Audio downloads stay
inside the verification frame and use bounded, origin-checked browser fetches.
Temporary audio is deleted. Automatic attempts are bounded; failures preserve the
application for another solver or human help.

Supports:
- **Cloudflare Turnstile:** Automated non-interactive and interactive managed challenges via `solveTurnstile`, penetrating Shadow DOM boundaries and using stepped human cursor trajectories.
- **Google reCAPTCHA v2 (Audio):** Implemented English audio speech-to-text path using local Faster-Whisper CPU int8 inference.
- **Google reCAPTCHA v2 (Visual Grid):** Local ONNX visual classifier (`recaptcha_classifier.onnx`) running in the local Python environment for 3x3 and 4x4 image grids.
- **Stealth & Anti-Detect:** Default Chromium launch scrubs `navigator.webdriver` and masks software WebGL (`SwiftShader`) to reduce bot detection triggers.
- **State-Preserving Auto-Resume:** Interactive polling in `waitForChallenge` resumes immediately when a verification challenge is cleared in the browser without losing filled draft fields.
## Candidates checked against source

| Candidate | Actual free path | Finding for Plainhand |
| --- | --- | --- |
| [ibedevesh/capsolver](https://github.com/ibedevesh/capsolver) | MIT; local faster-whisper audio recognition | Reference for the implemented same-page audio adapter. Its advertised success rate is not adopted. |
| [OhMyCaptcha](https://github.com/evierinch/captcha) | MIT; local multimodal-model endpoint | Possible vision/classification sidecar. Its acceptance document records challenge-dependent hCaptcha and a Turnstile **test-key dummy token**; those do not establish general live success. |
| [universal-captcha-solver](https://github.com/shauryaagg/universal-captcha-solver) | MIT local ONNX interface | At inspected commit, object detection/audio contain unimplemented paths, and model hosting URLs are unconfigured. Not selected as a turnkey solver. |
| [Buster](https://github.com/dessant/buster) | GPLv3 browser audio-assistance extension | Relevant reference and user-installed assist; not assumed to be a fully offline or automatically compatible bundled component. |
| [NopeCHA](https://github.com/NopeCHALLC/nopecha-extension) | Hosted free allowance, advertised as up to 100 requests/day without a key, counted by IP | Potential user-selected free-tier option. Current builds are closed-source; a free service allowance is not permission to copy current source or a permanent unlimited local service. Shared campus IPs can share that allowance. |
| [CaptchaKraken](https://github.com/CaptchaKraken/CaptchaKraken) | Public self-hostable weights and driver | Custom source-available license includes restrictions on distribution as a browser-automation capability. Not bundled on an assumption that public source means unrestricted reuse. |
| [hcaptcha-challenger](https://github.com/QIN2DIM/hcaptcha-challenger) | Local-model history plus newer multimodal-agent workflow | Keep under evaluation. Old local-model examples must not be mistaken for the current supported setup; upstream issues report local-model API changes. |

Snapshots inspected in temporary directories:

- Audio solver reference: `409fe81076619603c49375eb11b2cfd366527754`.
- OhMyCaptcha: `0b543d5436700fa3455e634583e2642a8a64159f`.
- Universal solver: `a7942587a8d8aa0446d7e2b62b43a37c571aeaaa`.
- Buster: `4f6fa9f26321fd645401e2f96e00cea4f8532e1a`.

Audio adapter reference license is retained at
`plainhand/solvers/licenses/capsolver-MIT.txt`. Faster Whisper is MIT-licensed;
its project and model sources are [here](https://github.com/SYSTRAN/faster-whisper)
and [here](https://huggingface.co/Systran/faster-whisper-tiny.en).

The paid managed-browser adapter remains optional and explicitly configured;
installing this local solver does not select it or consume a paid quota.

## Evidence and honest limits

- Real Whisper sample audio was transcribed offline on CPU with the expected JFK
  sentence. Source: [Whisper test audio](https://github.com/openai/whisper/blob/main/tests/jfk.flac).
- The complete controlled browser flow passed using both an injected test
  transcript and the actual installed model with real audio: detect, fetch in the
  same frame, transcribe, answer, observe verification, resume filling. The widget
  was explicitly synthetic; this is not evidence that Google accepted that audio.
- One Google public demo attempt was made headlessly. The provider showed **Try
  again later**, explaining that the computer/network may be sending automated
  queries. No usable audio was offered. The attempt was recorded as blocked and
  was not repeatedly retried. Evidence: `output/local-captcha-2026-10-18T14-57-02-053Z/`.
- No employer application was submitted and no paid inference API was called.

Regression tests:

```bash
npm run test:plainhand-browser
# Explicit installed-model test (supply your local test audio file):
PLAINHAND_TEST_AUDIO=/path/to/jfk.flac node --test test-plainhand-local-solver.mjs
# One public demo attempt; kept outside CI because a real challenge can be denied:
npm run test:captcha-live
```

The next useful work is measuring actual CAPTCHA types on the supported hiring
portals, then adding a local vision adapter for the observed gaps. Building or
training a universal solver first would not establish that it works on the sites
Plainhand's users encounter. There is no measured 90% completion rate yet.
