const { version } = require('../package.json');
if (!/^v\d+\.\d+\.\d+$/.test(process.env.DESKTOP_RELEASE_TAG || '') || process.env.DESKTOP_RELEASE_TAG !== `v${version}`) throw new Error('Release tag must match desktop/package.json exactly.');
