// PWA & mobile helpers: install prompt, iOS Add-to-Home-Screen guidance,
// service worker registration/update handling, and Android Web Share Target parsing.
import { html, useEffect, useReducer, Icon, toast, openDialog, closeDialog } from './core.mjs';
import { Button, Card, Dialog, Notice, Pill } from './components.mjs';
import { detectPlatform, extractLaunchAction } from './pwa-helpers.mjs';

export { detectPlatform, extractLaunchAction };

const DISMISS_KEY = 'plainhand.pwa.installDismissed';

const pwaListeners = new Set();
const pwaState = {
  platform: detectPlatform(),
  canInstall: false,
  installed: detectPlatform().standalone,
  updateReady: false,
  dismissed: false,
  swRegistered: false,
};

let deferredPrompt = null;
let waitingWorker = null;
let initialized = false;

function notifyPwa() {
  for (const listener of pwaListeners) listener();
}

function readDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function dismissInstallPrompt() {
  pwaState.dismissed = true;
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  notifyPwa();
}

export async function promptInstall() {
  if (deferredPrompt) {
    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    pwaState.canInstall = false;
    notifyPwa();
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice?.outcome === 'accepted') {
      pwaState.installed = true;
      toast('Installing Plainhand on your device…');
    }
    notifyPwa();
    return choice?.outcome || 'dismissed';
  }
  if (pwaState.platform.ios && !pwaState.installed) {
    openDialog({ type: 'ios-install' });
    return 'ios-guide';
  }
  return 'unavailable';
}

export function applyUpdate() {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    return;
  }
  window.location.reload();
}

export function initPwa() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  pwaState.platform = detectPlatform();
  pwaState.installed = pwaState.platform.standalone;
  pwaState.dismissed = readDismissed();

  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  standaloneMedia?.addEventListener?.('change', event => {
    pwaState.platform = detectPlatform({ standalone: event.matches });
    pwaState.installed = pwaState.platform.standalone;
    notifyPwa();
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    pwaState.canInstall = true;
    notifyPwa();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    pwaState.canInstall = false;
    pwaState.installed = true;
    notifyPwa();
    toast('Plainhand was added to your home screen.');
  });

  const secureLocal = location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  if ('serviceWorker' in navigator && secureLocal) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      pwaState.swRegistered = true;
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting;
        pwaState.updateReady = true;
        notifyPwa();
      }
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener('statechange', () => {
          if (next.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = next;
            pwaState.updateReady = true;
            notifyPwa();
          }
        });
      });
      notifyPwa();
    }).catch(() => {
      // Service workers are progressive enhancement; keep the app silent if blocked.
    });
  }
}

export function usePwa() {
  const [, force] = useReducer(n => n + 1, 0);
  useEffect(() => {
    pwaListeners.add(force);
    return () => pwaListeners.delete(force);
  }, []);
  return pwaState;
}

export function IosInstallDialog() {
  const { platform } = usePwa();
  return html`<${Dialog} title="Install Plainhand on iPhone" size="sm" description="Add Plainhand to your Home Screen as a full-screen web app (PWA)." onClose=${closeDialog}>
    ${!platform.safari ? html`<${Notice} tone="info">Open this page in <strong>Safari</strong> on your iPhone or iPad to add it to your Home Screen.</${Notice}>` : null}
    <ol class="install-steps">
      <li><span class="step-no" aria-hidden="true">1</span><div><strong>Tap Share</strong><p>In Safari’s bottom bar, tap the Share button (<${Icon} name="share" />).</p></div></li>
      <li><span class="step-no" aria-hidden="true">2</span><div><strong>Choose “Add to Home Screen”</strong><p>Scroll the action list and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</p></div></li>
      <li><span class="step-no" aria-hidden="true">3</span><div><strong>Open from your Home Screen</strong><p>Plainhand opens full-screen with your saved session, light or dark theme, and quick bottom navigation.</p></div></li>
    </ol>
    <p class="muted-text">A native iPhone app (.ipa) is deferred for later. The web app works on iPhone and Android today without an App Store install.</p>
    <div class="dialog-actions"><${Button} class="primary" data-autofocus onClick=${closeDialog}>Done</${Button}></div>
  </${Dialog}>`;
}

export function MobileAppCard({ cloud = false } = {}) {
  const pwa = usePwa();
  const { platform, canInstall, installed } = pwa;
  return html`<${Card} title="Use on your phone (iPhone & Android)" icon="smartphone" id="mobile-app-title"
    subtitle="Install Plainhand as a web app (PWA) or use it in your mobile browser. A native iPhone app (.ipa) is deferred for a later release."
    actions=${installed ? html`<${Pill} tone="success" icon="checkCircle">Installed as app</${Pill}>` : null}>
    ${installed ? html`<${Notice} tone="success">You’re running Plainhand in standalone app mode. Your workspace stays synced with your browser session.</${Notice}>` : null}
    ${canInstall ? html`<div class="action-row"><${Button} class="primary" icon="download" onClick=${promptInstall}>Install Plainhand app</${Button}></div>` : null}
    ${!installed && platform.ios ? html`<div class="action-row"><${Button} class="primary" icon="share" onClick=${() => openDialog({ type: 'ios-install' })}>Add to iPhone Home Screen</${Button}></div>` : null}
    <div class="mobile-platforms">
      <div class="mobile-platform">
        <h3>iPhone & iPad (Safari PWA)</h3>
        <p class="muted-text">Open ${cloud ? 'this website' : 'your hosted Plainhand workspace or Vercel remote dashboard'} in Safari, tap <strong>Share</strong>, then choose <strong>Add to Home Screen</strong>. Plainhand opens full-screen with safe-area layout and quick bottom tabs.</p>
      </div>
      <div class="mobile-platform">
        <h3>Android (Chrome & Edge PWA)</h3>
        <p class="muted-text">Tap <strong>Install app</strong> in your browser menu (or use the install button here when available). Once installed, you can share job links from Chrome, LinkedIn or Indeed directly to Plainhand via Android’s Share menu.</p>
      </div>
    </div>
    <ul class="check-list compact">
      <li class="done"><${Icon} name="checkCircle" />Works on phone: review packets, approve drafts, track statuses, log interviews, copy answers and check follow-ups.</li>
      <li><${Icon} name="info" />Needs a computer: initial AI connector setup and browser form autofill.</li>
      <li><${Icon} name="shield" />Privacy: offline shell caching stores only public interface files, never your resume, workspace data or session tokens.</li>
    </ul>
    ${!cloud ? html`<p class="muted-text">Running locally on <code>127.0.0.1</code>? Use <strong>Open from anywhere</strong> below for a read-only mobile dashboard PWA, or sign in to hosted Plainhand for full mobile review and tracking.</p>` : null}
  </${Card}>`;
}
