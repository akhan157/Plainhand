// Supplement the outbound-write guard with a DOM interlock. This catches a
// next-looking button whose handler calls submit()/requestSubmit(). The network
// guard remains the independent boundary against direct scripted requests.
const policies = new WeakMap();
export async function setSubmissionGuard(context, enabled, hosts) {
  let policy = policies.get(context);
  if (!policy) {
    policy = { enabled, hosts }; policies.set(context, policy);
    await context.addInitScript(allowed => {
      if (!allowed.some(host => location.hostname === host || location.hostname.endsWith('.' + host))) return;
      window.__plainhandBlockSubmission = true;
      document.addEventListener('submit', event => {
        if (window.__plainhandBlockSubmission) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      for (const method of ['submit', 'requestSubmit']) {
        const original = HTMLFormElement.prototype[method];
        HTMLFormElement.prototype[method] = function (...args) {
          if (window.__plainhandBlockSubmission) return;
          return original.apply(this, args);
        };
      }
    }, hosts);
    context.on('page', page => page.on('domcontentloaded', () => updatePage(page, policy).catch(() => {})));
  }
  policy.enabled = enabled;
  for (const page of context.pages()) await updatePage(page, policy);
}
async function updatePage(page, policy) {
  for (const frame of page.frames()) {
    try {
      const hostname = new URL(frame.url()).hostname;
      if (policy.hosts.some(host => hostname === host || hostname.endsWith('.' + host))) await frame.evaluate(enabled => { window.__plainhandBlockSubmission = enabled; }, policy.enabled);
    } catch {}
  }
}
