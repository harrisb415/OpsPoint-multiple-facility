'use strict';
/**
 * docs/SETTINGS.md, generated from schema.js:
 *   node server/cli/opspoint.js settings docs > docs/SETTINGS.md
 * tests/settings.test.js fails when the committed file and this output differ,
 * so the doc cannot drift from what the code accepts.
 */
const { PROFILES, PROFILE_NAMES, SETTINGS, INTERNAL_ENV } = require('./schema');
const { CHECKS, WARNING_CHECKS } = require('./index');

const code = (s) => `\`${s}\``;
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function shown(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

function defaultText(def) {
  let base;
  if (def.defaultText) base = def.defaultText;
  else if (def.default === undefined || def.default === null) base = def.name === 'OPSPOINT_PROFILE' ? 'inferred' : '';
  else if (def.scope === 'per-app' && typeof def.default === 'object') base = `${code(def.default.facility)} (HQ ${code(def.default.central)})`;
  else base = code(shown(def.default));
  const byProfile = {};
  for (const p of PROFILE_NAMES) {
    const d = PROFILES[p].defaults;
    if (Object.prototype.hasOwnProperty.call(d, def.name)) (byProfile[shown(d[def.name])] ||= []).push(p);
  }
  const extra = Object.entries(byProfile).map(([v, ps]) => `${ps.join(', ')}: ${code(v)}`);
  return [base || '—', ...extra].join('; ');
}

function requiredText(def) {
  const parts = [];
  if (def.name === 'TZ') parts.push('everywhere (see the check below)');
  if (def.requiredIn) parts.push(`on ${def.requiredIn.join(', ')}`);
  if (def.requiredWhen) parts.push(`when ${def.requiredWhen[0]}=${def.requiredWhen[1]}`);
  return parts.join('; ');
}

function notes(def) {
  const bits = [];
  if (def.secret) bits.push('**Secret.**');
  bits.push(def.summary);
  if (def.type === 'enum') bits.push(`One of ${def.values.map(code).join(', ')}.`);
  if (def.onlyIn) bits.push(`${def.onlyIn.profiles.join(', ')} accept only ${def.onlyIn.values.map(code).join(', ')}.`);
  if (def.envOnly) bits.push('Environment only.');
  if (def.scope === 'central') bits.push('HQ only.');
  if (def.readBy) bits.push(`Also read by ${code(def.readBy)}.`);
  return bits.join(' ');
}

function renderDocs() {
  const out = [];
  const w = (s = '') => out.push(s);
  w('# OpsPoint settings');
  w();
  w('<!-- Generated from server/settings/schema.js by `node server/cli/opspoint.js settings docs`.');
  w('     Do not edit by hand: tests/settings.test.js fails when this file and the schema disagree. -->');
  w();
  w('Every setting OpsPoint reads from its environment, declared once in `server/settings/schema.js`. ' +
    'A setting has one name everywhere: the environment variable, the key in `opspoint.config.json`, ' +
    "and the line in an installer's answers file.");
  w();
  w('## Where values come from');
  w();
  w('Later wins:');
  w();
  w('1. The built-in default (below).');
  w("2. The profile's default (`OPSPOINT_PROFILE`, below).");
  w('3. `opspoint.config.json` in the app folder, or the file `OPSPOINT_CONFIG` names.');
  w('4. Environment variables.');
  w("5. The provider's secret store (Key Vault, Secrets Manager, Secret Manager): roadmap phase 5.");
  w();
  w('`node server/cli/opspoint.js settings` lists every value and where it came from, with secrets hidden ' +
    "(`--app central` for HQ's). `--check` runs the startup check without starting anything: exit 0 when " +
    'OpsPoint would start, 78 and the reasons when it would not.');
  w();
  w('## The startup check');
  w();
  w('The facility server (`server.js`) and HQ (`central/server.js`) check their settings before they create a ' +
    'folder, a key or a database. A missing or contradictory setting stops them with one sentence naming the fix, ' +
    'and exit code 78; `bootstrap.js` does not relaunch a server that exits with 78. Besides each value\'s type, ' +
    'the check makes sure that:');
  w();
  for (const c of CHECKS) w(`- ${c}`);
  w();
  w('It warns, and starts anyway, on:');
  w();
  for (const c of WARNING_CHECKS) w(`- ${c}`);
  w();
  w('## Profiles');
  w();
  w('A profile only sets defaults; any setting can still be set on its own. Unset, `OPSPOINT_PROFILE` is ' +
    '`windows-local` on Windows and `linux-local` anywhere else, which keep the defaults every install had ' +
    'before profiles existed.');
  w();
  w('| Profile | Deployment | Its defaults | Settings go in |');
  w('| --- | --- | --- | --- |');
  for (const p of PROFILE_NAMES) {
    const P = PROFILES[p];
    const d = Object.entries(P.defaults).map(([k, v]) => `${code(k)}=${code(shown(v))}`).join(', ') || 'none';
    w(`| ${code(p)} | ${cell(`${P.label}. ${P.summary}`)} | ${cell(d)} | ${cell(P.where)} |`);
  }
  w();
  w('## Settings');
  const groups = [];
  for (const s of SETTINGS) if (!groups.includes(s.group)) groups.push(s.group);
  for (const g of groups) {
    w();
    w(`### ${g}`);
    w();
    w('| Setting | Default | Required | What it is |');
    w('| --- | --- | --- | --- |');
    for (const def of SETTINGS.filter((s) => s.group === g)) {
      w(`| ${code(def.name)} | ${cell(defaultText(def))} | ${cell(requiredText(def))} | ${cell(notes(def))} |`);
    }
  }
  w();
  w('## The settings file');
  w();
  w('`opspoint.config.json` is one JSON object of settings. Git never tracks it, since it may hold secrets. ' +
    "The top level is the facility app's; a `\"central\"` object holds HQ's own values, such as its `PORT`. " +
    'Keys starting with `_` are ignored (use them for comments), and `$schema` is allowed.');
  w();
  w('```json');
  w('{');
  w('  "OPSPOINT_PROFILE": "linux-local",');
  w('  "TZ": "America/Chicago",');
  w('  "OPSPOINT_DB_DRIVER": "pg",');
  w('  "DATABASE_URL": "postgresql://opspoint:PASSWORD@db.internal:5432/opspoint",');
  w('  "PGSSLMODE": "verify-full",');
  w('  "central": {');
  w('    "PORT": 4000,');
  w('    "CENTRAL_DATABASE_URL": "postgresql://opspoint:PASSWORD@db.internal:5432/opscentral"');
  w('  }');
  w('}');
  w('```');
  w();
  w('On Linux, keep it readable only by the account OpsPoint runs as (`chmod 600`); the check warns otherwise. ' +
    "A `TZ` given only in the file is applied to the server's process when it starts, since Node takes its time " +
    'zone from `TZ`.');
  w();
  w('## Not settings');
  w();
  w("These environment variables are how OpsPoint's own pieces talk to each other, or release tooling. They are " +
    "not settings, and the check doesn't mistake them for typos: " + INTERNAL_ENV.map(code).join(', ') + '.');
  w();
  return out.join('\n');
}

module.exports = { renderDocs };
