// Regenerates docs/discovery/prompted-assets/knowledge-base/evidence-catalog.md
// from docs/discovery/prompted-assets/knowledge-base/application-model.json.
// Run: node scripts/gen-evidence-catalog.mjs
// The catalog must stay in lockstep with the model; regenerate rather than hand-edit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelPath = path.join(root, 'docs/discovery/prompted-assets/knowledge-base/application-model.json');
const outPath = path.join(root, 'docs/discovery/prompted-assets/knowledge-base/evidence-catalog.md');

const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));

// ---- Support label mapping ----
const supportLabel = {
  'demonstrated-test': 'demonstrated by test',
  'static-analysis': 'established by reading the source',
  'declared': 'declared by the source, not independently confirmed',
};

const sectionOf = {
  'test-result': 'Test results',
  'source-analysis': 'Source analysis',
  'configuration': 'Configuration',
  'documentation': 'Documentation',
};

// ---- Reverse index: which top-level ids cite each evidence id ----
const citedBy = {}; // evidenceId -> [sectionLabel + id]
function addCite(evidenceId, id) {
  if (!evidenceId) return;
  (citedBy[evidenceId] ||= []).push(id);
}
function indexList(ids, collector) {
  for (const eid of ids || []) collector(eid);
}
for (const cap of model.capabilities || []) indexList(cap.evidenceIds, (e) => addCite(e, cap.id));
for (const f of model.findings || []) indexList(f.evidenceIds, (e) => addCite(e, f.id));
for (const fl of model.flows || []) {
  indexList(fl.evidenceIds, (e) => addCite(e, fl.id));
  for (const s of fl.steps || []) indexList(s.evidenceIds, (e) => addCite(e, `${fl.id}/${s.id}`));
}
for (const n of model.nodes || []) indexList(n.evidenceIds, (e) => addCite(e, n.id));
for (const r of model.relationships || []) indexList(r.evidenceIds, (e) => addCite(e, r.id));

// ---- Where string ----
function where(ev) {
  const p = ev.location && ev.location.path ? ev.location.path : ev.source || '';
  const line = ev.location && ev.location.line;
  const end = ev.location && ev.location.endLine;
  if (!line) return `\`${p}\``;
  if (end && end !== line) return `\`${p}:${line}-${end}\``;
  return `\`${p}:${line}\``;
}

const entries = model.evidence || [];
const order = { 'Test results': 0, 'Source analysis': 1, 'Configuration': 2, 'Documentation': 3 };

function renderEntry(ev) {
  const lines = [];
  lines.push(`### \`${ev.id}\``);
  lines.push('');
  lines.push(ev.description);
  lines.push('');
  lines.push(`- **Where:** ${where(ev)}`);
  lines.push(`- **Support:** ${supportLabel[ev.support] || ev.support}`);
  if (ev.result) lines.push(`- **Result:** ${ev.result}`);
  if (ev.command) lines.push(`- **Command:** ${ev.command}`);
  const cites = (citedBy[ev.id] || []).sort();
  if (cites.length) lines.push(`- **Cited by:** ${cites.map((c) => '`' + c + '`').join(', ')}`);
  lines.push('');
  return lines.join('\n');
}

// Header stats
const total = entries.length;
const demonstrated = entries.filter((e) => e.support === 'demonstrated-test').length;
const source = entries.filter((e) => e.support === 'static-analysis').length;
const declared = entries.filter((e) => e.support === 'declared').length;

const out = [];
out.push('# Evidence Catalog');
out.push('');
out.push('Every piece of evidence behind [the report](../../prompted-deep-discovery.md) and [the knowledge base](index.md), recorded once and referenced by id. Generated from [application-model.json](application-model.json) at revision `cfa08f6` plus the uncommitted working-tree drift. Do not hand-edit this file; regenerate it from the model.');
out.push('');
out.push('Support levels used here:');
out.push('');
out.push('- **demonstrated by test** - a test asserts it and that test passes');
out.push('- **established by reading the source** - the code says so; it was not watched running');
out.push('- **declared by the source** - a document or comment claims it; treated as a claim, not a fact');
out.push('');
out.push('Nothing in this catalog is marked *observed at runtime*. The application was never driven by hand during this discovery; it was read, and its test suite was run.');
out.push('');
out.push('| Total entries | ' + total + ' |');
out.push('|---|---|');
out.push('| Demonstrated by test | ' + demonstrated + ' |');
out.push('| Established by reading source | ' + source + ' |');
out.push('| Declared by a source | ' + declared + ' |');
out.push('');

const grouped = new Map();
for (const ev of entries) {
  const sec = sectionOf[ev.type] || 'Source analysis';
  grouped.setdefault ||= null; // no-op
  if (!grouped.has(sec)) grouped.set(sec, []);
  grouped.get(sec).push(ev);
}
for (const sec of Object.keys(order).sort((a, b) => order[a] - order[b])) {
  if (!grouped.has(sec)) continue;
  out.push('## ' + sec);
  out.push('');
  for (const ev of grouped.get(sec)) out.push(renderEntry(ev));
}
out.push('---');
out.push('');

fs.writeFileSync(outPath, out.join('\n'), 'utf8');
console.log(`Wrote ${outPath}: ${total} entries (${demonstrated} demonstrated, ${source} source, ${declared} declared)`);