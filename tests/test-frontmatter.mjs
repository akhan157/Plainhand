import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { toFrontmatterValue } from '../lib/frontmatter.mjs';

test('frontmatter values survive a YAML round trip when they contain backslashes and quotes', () => {
  const windowsPath = 'C:\\Users\\Riley\\"final"\\resume.pdf';
  const parsed = yaml.load(`path: ${toFrontmatterValue(windowsPath)}`);
  assert.equal(parsed.path, windowsPath, 'a backslash must not turn the next character into a YAML escape');

  const values = ['a\\b', 'say "hi"', 'C:\\temp\\"quoted"'];
  assert.deepEqual(yaml.load(`list: ${toFrontmatterValue(values)}`).list, values);
  assert.equal(yaml.load(`count: ${toFrontmatterValue(3)}`).count, 3);
  assert.equal(yaml.load(`ok: ${toFrontmatterValue(false)}`).ok, false);
});
