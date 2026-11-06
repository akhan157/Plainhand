// Documentation checked, NOT real-account coverage. Review monthly and after menu changes.
export const setupCoverage = {
  checkedAt: '2026-11-05', reviewDueAt: '2026-12-05', accountStatus: 'unverified', screenshots: { status: 'pending', assets: [] },
  chatgpt: {
    source: 'https://developers.openai.com/api/docs/guides/custom-mcp-server',
    plans: ['Free', 'Go', 'Plus', 'Pro', 'Work or school'],
    coverage: Object.fromEntries(['Free', 'Go', 'Plus', 'Pro', 'Work or school'].map(plan => [plan, { status: 'unverified', checkedAt: '2026-11-05', note: ['Free', 'Go'].includes(plan) ? 'Availability unconfirmed; no account test.' : 'No real-account test.' }])),
    steps: [
      { title: 'Open Plugins', text: 'On a computer, open ChatGPT Plugins.', link: 'https://chatgpt.com/plugins' },
      { title: 'Add a server', text: 'Choose +, then Add custom MCP server. If this is missing, ask your workspace admin.' },
      { title: 'Name it Plainhand', text: 'Enter Plainhand as the name.' },
      { title: 'Paste the Plainhand link', text: 'Under Connection, paste this Server URL.', copy: 'url' },
      { title: 'Choose OAuth', text: 'Select OAuth for authentication.' },
      { title: 'Review the warning', text: 'Read the permissions and warning. Continue only if you trust Plainhand; select I understand and want to continue.' },
      { title: 'Create the plugin', text: 'Choose Create as a plugin.' },
      { title: 'Install Plainhand', text: 'Find Plainhand in your plugins and choose Install.' },
      { title: 'Sign in to Plainhand', text: 'Use the same Plainhand account as this website.' },
      { title: 'Allow the connection', text: 'Review access and choose Allow. Saving actions may ask for approval in chat; review what will be saved before allowing them.' },
    ],
  },
  claude: {
    source: 'https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities',
    allowanceSource: 'https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp',
    plans: ['Free', 'Pro', 'Max', 'Ultra', 'Team', 'Enterprise'],
    coverage: Object.fromEntries(['Free', 'Pro', 'Max', 'Ultra', 'Team', 'Enterprise'].map(plan => [plan, { status: 'unverified', checkedAt: '2026-11-05', note: 'No real-account test.' }])),
    steps: [
      { title: 'Open Customize', text: 'Open Claude on a computer and choose Customize.', link: 'https://claude.ai' },
      { title: 'Open Connectors', text: 'Choose Connectors.' },
      { title: 'Add a custom connector', text: 'Choose + beside Connectors, then Add custom connector. Team and Enterprise owners must enable it first.' },
      { title: 'Name it Plainhand', text: 'Enter Plainhand as the name.' },
      { title: 'Paste the Plainhand link', text: 'Use this as the connector URL.', copy: 'url' },
      { title: 'Add Plainhand', text: 'Choose Add.' },
      { title: 'Connect Plainhand', text: 'Choose Connect.' },
      { title: 'Sign in to Plainhand', text: 'Use the same Plainhand account as this website.' },
      { title: 'Allow the connection', text: 'Review the permissions and choose Allow.' },
    ],
  },
};
export const CHECK_REQUEST = '@Plainhand check my connection';
export const EXAMPLE_REQUESTS = [
  'Is this job a good fit for me? <paste job link>',
  'Write my application for <company and role>. Use only my saved evidence.',
  "What's due this week?",
  'Help me describe a project from my resume. Ask about any missing facts.',
  'Review my saved application and tell me what needs my approval.',
];
// The endpoint records the authenticated connector identity, without guessing its vendor.
export function connectionResult(marker, startedAt, provider) {
  const matches = marker?.provider === provider || (marker?.provider === 'connector' && typeof marker.clientId === 'string' && marker.clientId.length > 0);
  if (!marker || !(Date.parse(marker.checkedAt) > startedAt) || (provider && !matches)) return 'waiting';
  if (marker.read === true && marker.write === true) return 'connected';
  if (marker.read === true && marker.write === false) return 'read-only';
  return 'waiting';
}
export function chatRequest(kind, job, input = {}, provider = 'chatgpt') {
  const task = { interview: 'Build my candidate understanding. Ask me about missing facts.', discover: 'Check my saved job sources for suitable roles.', evaluate: 'Evaluate this job against my saved evidence:', prepare: 'Prepare my application using only my saved evidence:', standard: 'Write my standard application using my saved evidence.', revise: 'Revise my application:' }[kind] || `Help me with ${kind}.`;
  return [(provider === 'chatgpt' ? '@Plainhand ' : '') + task, job ? `${job.company} — ${job.title}\n${job.url || ''}\nPlainhand job ID: ${job.id}` : '', input.request || '', input.text || ''].filter(Boolean).join('\n');
}
