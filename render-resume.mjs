#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

const sourcePath = resolve(projectRoot, 'data', 'resume-source.yml');
const rulesPath = resolve(projectRoot, 'data', 'resume-rules.yml');
const templatePath = resolve(projectRoot, 'templates', 'cv-template-watson.html');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

function loadResumeModel() {
  return {
    source: loadYaml(sourcePath),
    rules: loadYaml(rulesPath),
  };
}

function renderMarkdown(model) {
  const { header, sections } = model.source;
  const lines = [];
  lines.push(`# ${header.name}`);
  lines.push('');
  lines.push(`${header.location} | ${header.phone} | ${header.email} | [${header.linkedin_display}](${header.linkedin_url})`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push('');

    if (section.kind === 'education') {
      for (const entry of section.entries) {
        lines.push(`**${entry.school}** -- ${entry.date}`);
        lines.push(entry.degree);
        lines.push('');
        lines.push(`**${entry.coursework_label}:** ${entry.coursework.join(', ')}`);
        lines.push('');
      }
    } else if (section.kind === 'skills') {
      for (const group of section.groups) {
        lines.push(`- **${group.label}:** ${group.items.join(', ')}`);
      }
      lines.push('');
    } else if (section.kind === 'experience') {
      for (const entry of section.entries) {
        if (entry.company) {
          lines.push(`**${entry.company}** -- ${entry.location}`);
        }
        lines.push(`*${entry.role}* | ${entry.dates}`);
        lines.push('');
        if (entry.groups) {
          for (const group of entry.groups) {
            lines.push(`*${group.subtitle}:*`);
            for (const bullet of group.bullets) {
              lines.push(`- ${bullet}`);
            }
            lines.push('');
          }
        } else if (entry.bullets) {
          for (const bullet of entry.bullets) {
            lines.push(`- ${bullet}`);
          }
          lines.push('');
        }
      }
    }

    lines.push('---');
    lines.push('');
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length > 0 && lines[lines.length - 1] === '---') {
    lines.pop();
  }
  return `${lines.join('\n')}\n`;
}

function renderEducationHtml(entry) {
  return `
  <div class="entry-header">
    <div class="edu-school">${escapeHtml(entry.school)}</div>
    ${entry.location ? `<div class="entry-location">${escapeHtml(entry.location)}</div>` : ''}
  </div>
  <div class="edu-degree-row">
    <div class="edu-degree">${escapeHtml(entry.degree)}</div>
    <div class="edu-date">${escapeHtml(entry.date)}</div>
  </div>
  <div class="edu-coursework"><strong>${escapeHtml(entry.coursework_label)}:</strong> ${escapeHtml(entry.coursework.join(', '))}</div>
`;
}

function renderSkillsHtml(section) {
  const items = section.groups.map((group) => (
    `    <li><strong>${escapeHtml(group.label)}:</strong> ${escapeHtml(group.items.join(', '))}</li>`
  )).join('\n');
  return `\n  <ul class="skills-list">\n${items}\n  </ul>\n`;
}

function renderEntryHeader(entry) {
  if (!entry.company) return '';
  return `
    <div class="entry-header">
      <div class="entry-company">${escapeHtml(entry.company)}</div>
      <div class="entry-location">${escapeHtml(entry.location)}</div>
    </div>`;
}

function renderRoleRow(entry) {
  return `
    <div class="entry-role-row">
      <div class="entry-role">${escapeHtml(entry.role)}</div>
      <div class="entry-dates">${escapeHtml(entry.dates)}</div>
    </div>`;
}

function renderBullets(bullets) {
  const items = bullets.map((bullet) => `      <li>${escapeHtml(bullet)}</li>`).join('\n');
  return `
    <ul class="entry-bullets">
${items}
    </ul>`;
}

function renderExperienceSectionHtml(section) {
  return section.entries.map((entry, index) => {
    const spacing = index === 0 ? '' : ' style="margin-top: 3px;"';
    let html = `\n  <div class="entry"${spacing}>`;
    html += renderEntryHeader(entry);
    html += renderRoleRow(entry);
    if (entry.groups) {
      for (const group of entry.groups) {
        html += `\n    <div class="entry-subtitle">${escapeHtml(group.subtitle)}:</div>`;
        html += renderBullets(group.bullets);
      }
    } else if (entry.bullets) {
      html += renderBullets(entry.bullets);
    }
    html += '\n  </div>\n';
    return html;
  }).join('');
}

function renderHtml(model) {
  const { header, sections } = model.source;
  const education = sections.find((section) => section.id === 'education');
  const skills = sections.find((section) => section.id === 'technical_skills');
  const experience = sections.find((section) => section.id === 'professional_experience');
  const projects = sections.find((section) => section.id === 'project_experience');

  let html = readFileSync(templatePath, 'utf8');
  html = html
    .replace('{{LANG}}', 'en')
    .replace('{{PAGE_WIDTH}}', '8.5in')
    .replace(/\{\{NAME\}\}/g, escapeHtml(header.name))
    .replace('{{LOCATION}}', escapeHtml(header.location))
    .replace('{{PHONE}}', escapeHtml(header.phone))
    .replace('{{EMAIL}}', escapeHtml(header.email))
    .replace('{{LINKEDIN_URL}}', escapeHtml(header.linkedin_url))
    .replace('{{LINKEDIN_DISPLAY}}', escapeHtml(header.linkedin_display))
    .replace('{{EDUCATION}}', education.entries.map(renderEducationHtml).join('\n'))
    .replace('{{SKILLS}}', renderSkillsHtml(skills))
    .replace('{{EXPERIENCE}}', renderExperienceSectionHtml(experience))
    .replace('{{PROJECTS}}', renderExperienceSectionHtml(projects));
  return html;
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeOutputs(markdown, html, model) {
  const mdPath = resolve(projectRoot, model.rules.resume.generated_markdown);
  const htmlPath = resolve(projectRoot, model.rules.resume.generated_html);
  ensureDir(mdPath);
  ensureDir(htmlPath);
  writeFileSync(mdPath, markdown);
  writeFileSync(htmlPath, html);
  return { mdPath, htmlPath };
}

function main() {
  const model = loadResumeModel();
  const markdown = renderMarkdown(model);
  const html = renderHtml(model);
  const paths = writeOutputs(markdown, html, model);
  console.log(`Resume markdown saved to ${paths.mdPath}`);
  console.log(`Resume HTML saved to ${paths.htmlPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export { loadResumeModel, renderMarkdown, renderHtml };
export { main };
