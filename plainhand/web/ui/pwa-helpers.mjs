// Pure platform detection and PWA launch / Web Share Target parsing.
// Zero DOM dependencies so both browser UI and Node tests can import directly.

export function detectPlatform({
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
  standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true),
} = {}) {
  const ua = String(userAgent || '');
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mobile = ios || android || /Mobile/i.test(ua);
  const safari = ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return { ios, android, mobile, safari, standalone: Boolean(standalone) };
}

// Parse Android Web Share Target or PWA shortcut query parameters into an Add Job prefill.
export function extractLaunchAction(search = typeof location !== 'undefined' ? location.search : '') {
  const params = new URLSearchParams(search || '');
  const action = params.get('action') || '';
  const shareUrl = (params.get('share_url') || '').trim();
  const shareTitle = (params.get('share_title') || '').trim();
  const shareText = (params.get('share_text') || '').trim();

  if (shareUrl || shareTitle || shareText) {
    const combined = [shareUrl, shareText].filter(Boolean).join(' ');
    const urlMatch = combined.match(/https?:\/\/[^\s<>"')]+/i);
    const url = shareUrl || (urlMatch ? urlMatch[0] : '');
    const cleanedText = url && shareText.includes(url) ? shareText.replace(url, '').trim() : shareText;
    // Gently split "Role at Company" without inventing facts.
    let company = '';
    let title = shareTitle;
    const atMatch = /^(.+?)\s+at\s+([^|–—-]{2,60})$/i.exec(shareTitle);
    if (atMatch) {
      title = atMatch[1].trim();
      company = atMatch[2].trim();
    }
    return {
      openAddJob: true,
      prefill: {
        company: company.slice(0, 120),
        title: title.slice(0, 160),
        url: url.slice(0, 2000),
        location: '',
        description: cleanedText && cleanedText !== shareTitle ? cleanedText.slice(0, 20000) : '',
      },
      cleanParams: ['share_url', 'share_title', 'share_text', 'action', 'source'],
    };
  }

  if (action === 'add-job') {
    return {
      openAddJob: true,
      prefill: null,
      cleanParams: ['action', 'source'],
    };
  }

  if (params.has('source')) {
    return { openAddJob: false, prefill: null, cleanParams: ['source'] };
  }

  return null;
}
