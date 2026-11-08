// YAML frontmatter values are written as double-quoted scalars, so a backslash or a
// double quote inside a value must be escaped. Backslashes are escaped first: otherwise
// an existing backslash would combine with the escape added for a quote (or with the
// next character) and the value would read back differently from what was written.
export function toFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => `"${escapeYamlString(item)}"`).join(', ')}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return `"${escapeYamlString(value ?? '')}"`;
}

function escapeYamlString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
