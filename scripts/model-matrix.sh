#!/usr/bin/env bash
# Owner's model matrix (after U14): one screening round per configuration on the six
# non-minimal rows, one fixed judge. HEAD only; this compares models, not code.
#
#   TAG=<commit> scripts/model-matrix.sh
#   TAG=<commit> CONFIGS="claude:claude-haiku-5-5:low" ROUND=s2 scripts/model-matrix.sh
#
# CONFIGS: space-separated provider:model:effort (default: the owner's five; controlled:x:x
# is a fixture dry run with no model calls). JUDGE=none skips judging.
# POOL=cliproxy sends Codex calls through the local CLIProxyAPI pool (as u14-codex62.sh);
# Claude calls follow the environment's own ANTHROPIC_BASE_URL. JUDGE (claude) grades all;
# on Claude rows it is self-judging, which the table marks.
# Evidence: output/model-matrix-<TAG>-<ROUND>/<provider>-<model>-<effort>/ (git-ignored).
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAG="${TAG:?set TAG to the commit to screen}"
ROUND="${ROUND:-s1}"
JUDGE="${JUDGE:-claude}"
PROVIDER_FAILURE='usage( or billing)? limit|rate limit|quota|429|Too Many Requests|is not usable|agent timed out'
CONFIGS="${CONFIGS:-codex:gpt-6.2-sol:low codex:gpt-6.2-sol:medium claude:claude-sonnet-5-5:low claude:claude-sonnet-5-5:medium claude:claude-haiku-5-5:low}"
ROWS="${ROWS:-profile-effect-fin-built,profile-effect-fin-seeded,profile-effect-analyst-built,profile-effect-analyst-seeded,profile-effect-sci-built,profile-effect-sci-seeded}"
WORK="${WORK:-${XDG_CACHE_HOME:-$HOME/.cache}/plainhand-u14}"
SHORT="$(git -C "$REPO" rev-parse --short "$TAG")"
OUT="$REPO/output/model-matrix-$SHORT-$ROUND"
mkdir -p "$WORK" "$OUT"

if [ "${POOL:-}" = cliproxy ]; then
  POOL_URL="${POOL_URL:-http://127.0.0.1:8317/v1}"
  CLIPROXY_API_KEY="$(grep -A1 'api-keys:' "${POOL_CONFIG:-$HOME/.config/cli-proxy-api/config.yaml}" | tail -1 | sed -E 's/^[[:space:]]*-[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
  export CLIPROXY_API_KEY
  # The real binary, never this wrapper: a PATH that already starts with $WORK/bin would
  # otherwise make the wrapper exec itself forever.
  REAL_CODEX="$(PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -vxF "$WORK/bin" | paste -sd:)" command -v codex)"
  [ -n "$REAL_CODEX" ] && [ "$REAL_CODEX" != "$WORK/bin/codex" ] || { echo "real codex binary not found" >&2; exit 2; }
  mkdir -p "$WORK/bin"
  cat > "$WORK/bin/codex" <<WRAP
#!/usr/bin/env bash
if [ "\$1" = exec ]; then shift; exec "$REAL_CODEX" exec -c 'model_provider="cliproxy"' -c 'model_providers.cliproxy={name="cliproxy",base_url="$POOL_URL",env_key="CLIPROXY_API_KEY",wire_api="responses"}' "\$@"; fi
exec "$REAL_CODEX" "\$@"
WRAP
  chmod +x "$WORK/bin/codex"
  export PATH="$WORK/bin:$PATH"
fi

dir="$WORK/head-$SHORT"
if [ ! -d "$dir/.git" ]; then git clone --quiet "$REPO" "$dir"; git -C "$dir" checkout --quiet --detach "$TAG"; fi
if [ ! -e "$dir/node_modules" ]; then
  if cmp -s "$dir/package-lock.json" "$REPO/package-lock.json" && [ -d "$REPO/node_modules" ]; then ln -s "$(readlink -f "$REPO/node_modules")" "$dir/node_modules"
  else (cd "$dir" && npm ci --silent); fi
fi

status=0
for config in $CONFIGS; do
  IFS=: read -r provider model effort <<<"$config"
  out="$OUT/$provider-$model-$effort"
  if [ -f "$out.log" ] && grep -qiE "$PROVIDER_FAILURE" "$out.log"; then
    archive="$(mktemp -d "$OUT/.incomplete.XXXXXX")"
    mv "$out.log" "$archive/"
    if [ -d "$out" ]; then mv "$out" "$archive/"; fi
  fi
  if [ ! -f "$out/results.json" ]; then
    case "$provider" in
      codex) vars=(PLAINHAND_CODEX_MODEL="$model" PLAINHAND_CODEX_EFFORT="$effort") ;;
      claude) vars=(PLAINHAND_CLAUDE_MODEL="$model" PLAINHAND_CLAUDE_EFFORT="$effort") ;;
      controlled) vars=(PLAINHAND_DRY_RUN=1) ;;  # fixture agent, no model calls
      *) echo "unknown provider: $provider" >&2; exit 2 ;;
    esac
    (cd "$dir" && env "${vars[@]}" node benchmarks/benchmark-eval.mjs $([ "$provider" = controlled ] || echo --provider "$provider") --scenarios "$ROWS" --out "$out") 2>&1 | tee "$out.log" || true
    if grep -qiE "$PROVIDER_FAILURE" "$out.log"; then
      echo "$config benchmark interrupted. See $out.log." >&2
      status=75
      continue
    fi
    if [ ! -f "$out/results.json" ]; then
      echo "$config did not write results.json. See $out.log." >&2
      if [ "$status" -eq 0 ]; then status=1; fi
      continue
    fi
  fi
  if [ "$JUDGE" != none ] && [ -f "$out.judge.log" ] && grep -qiE "$PROVIDER_FAILURE" "$out.judge.log"; then
    archive="$(mktemp -d "$OUT/.incomplete.XXXXXX")"
    mv "$out.judge.log" "$archive/"
    for file in judge.json JUDGE.md; do
      if [ -f "$out/$file" ]; then mv "$out/$file" "$archive/"; fi
    done
  fi
  if [ -f "$out/results.json" ] && [ ! -f "$out/judge.json" ] && [ "$JUDGE" != none ]; then
    (cd "$dir" && node benchmarks/benchmark-judge.mjs --evidence "$out" --judge "$JUDGE" --scenarios "$ROWS") 2>&1 | tee "$out.judge.log" || true
    if grep -qiE "$PROVIDER_FAILURE" "$out.judge.log"; then
      echo "$config judging interrupted. See $out.judge.log." >&2
      status=75
    fi
  fi
done

node -e '
  const fs = require("fs"), path = require("path");
  const [out, pattern] = process.argv.slice(1);
  const providerFailure = new RegExp(pattern, "i");
  const rows = [["config", "passed", "calls", "input tokens", "judge overall", "honesty", "unsupported", "note"]];
  const interrupted = file => fs.existsSync(file) && providerFailure.test(fs.readFileSync(file, "utf8"));
  for (const name of fs.readdirSync(out).filter(n => !n.startsWith(".") && !n.includes("-void") && fs.statSync(path.join(out, n)).isDirectory()).sort()) {
    const read = f => { try { return JSON.parse(fs.readFileSync(path.join(out, name, f), "utf8")); } catch { return null; } };
    const r = read("results.json"), j = read("judge.json");
    if (interrupted(path.join(out, name + ".log"))) {
      rows.push([name, "incomplete", "", "", "", "", "", "benchmark interrupted"]); continue;
    }
    if (!r) { rows.push([name, "no results", "", "", "", "", "", ""]); continue; }
    const tokens = (r.results || []).reduce((sum, x) => sum + (x.usage?.inputTokens || 0), 0);
    const mean = v => v && typeof v === "object" ? v.mean : v;
    const judgeInterrupted = interrupted(path.join(out, name + ".judge.log"));
    const s = judgeInterrupted ? null : j?.summary;
    const note = [j?.selfJudged ? "self-judged" : "",
      judgeInterrupted ? "judging interrupted" : ""].filter(Boolean).join(", ");
    rows.push([name, `${r.summary.passed}/${r.summary.scenarios}`, r.summary.calls ?? "", tokens ? Math.round(tokens / 1000) + "k" : "n/a",
      s ? (mean(s.overall)?.toFixed?.(2) ?? "") : judgeInterrupted ? "incomplete" : "not judged", s ? (mean(s.dimensions?.honesty)?.toFixed?.(2) ?? "") : "",
      s && s.unsupportedRate != null ? (100 * s.unsupportedRate).toFixed(1) + "%" : "", note]);
  }
  const width = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
  for (const r of rows) console.log(r.map((c, i) => String(c).padEnd(width[i])).join("  "));
' "$OUT" "$PROVIDER_FAILURE" | tee "$OUT/MATRIX.txt"
exit "$status"
