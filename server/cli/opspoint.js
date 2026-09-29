#!/usr/bin/env node
'use strict';
/**
 * The OpsPoint command line:  node server/cli/opspoint.js <command>
 *
 * It lives under server/ so the in-app updater ships it with every release
 * (the updater copies server/ whole). The installers (roadmap phase 8) will put
 * it on the PATH as `opspoint`, next to the health check, backup and export.
 */
const USAGE = `Usage: node server/cli/opspoint.js <command> [options]

Commands
  settings            Every setting, its value and where it came from (secrets hidden)
  settings --check    Exit 0 if OpsPoint would start, 78 and the reasons if not
  settings --json     The same as JSON
  settings docs       Print docs/SETTINGS.md, generated from the settings schema
  keys                Print a new SESSION_SECRET and push key pair, as settings lines
                      (--json for JSON). Keep them secret; never commit them.

Options
  --app central       HQ's settings instead of the facility app's
`;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}
const flag = (name) => process.argv.includes(name);

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

function printSettings(d) {
  const who = d.app === 'central' ? 'HQ (central)' : 'the facility app';
  const lines = [];
  lines.push(`OpsPoint settings for ${who}`);
  lines.push(`  Profile    ${d.profile.name}${d.profile.inferred ? ' (inferred: OPSPOINT_PROFILE is not set)' : ` (from ${d.profile.source})`}`);
  if (d.file.disabled) lines.push('  File       none (OPSPOINT_CONFIG=none)');
  else if (d.file.found) lines.push(`  File       ${d.file.path}`);
  else if (d.file.path) lines.push(`  File       ${d.file.path} (not usable: see below)`);
  else lines.push('  File       none (no opspoint.config.json in the app folder)');
  lines.push(`  Time zone  ${d.timeZone.name}${d.timeZone.explicit ? ` (from ${d.timeZone.source})` : " (this machine's)"}`);
  const w = Math.max(...d.settings.map((s) => s.name.length)) + 2;
  const vw = Math.min(46, Math.max(...d.settings.map((s) => s.value.length)) + 2);
  let group = null;
  for (const s of d.settings) {
    if (s.group !== group) { group = s.group; lines.push('', group); }
    const value = s.value.length + 2 > vw ? `${s.value}  ` : pad(s.value, vw);
    lines.push(`  ${pad(s.name, w)}${value}${s.source === 'unset' ? '' : s.source}`.trimEnd());
  }
  lines.push('');
  const errors = d.problems.filter((p) => p.level === 'error');
  const warnings = d.problems.filter((p) => p.level === 'warning');
  if (!d.problems.length) lines.push('No problems: OpsPoint would start with these settings.');
  for (const p of errors) lines.push(`ERROR    ${p.message}`);
  for (const p of warnings) lines.push(`warning  ${p.message}`);
  process.stdout.write(lines.join('\n') + '\n');
}

function main() {
  const [cmd, sub] = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--app');
  const app = arg('--app') || 'facility';
  if (app !== 'facility' && app !== 'central') { process.stderr.write('--app must be facility or central\n'); return 2; }

  if (cmd === 'settings') {
    const settings = require('../settings');
    if (sub === 'docs') {
      process.stdout.write(require('../settings/docs').renderDocs());
      return 0;
    }
    if (sub) { process.stderr.write(USAGE); return 2; }
    const s = settings.useApp(app);
    if (flag('--check')) {
      const problems = s.check();
      const errors = problems.filter((p) => p.level === 'error');
      for (const p of errors) process.stdout.write(`ERROR    ${p.message}\n`);
      for (const p of problems.filter((x) => x.level === 'warning')) process.stdout.write(`warning  ${p.message}\n`);
      if (errors.length) return settings.EX_CONFIG;
      const prof = s.profile(), tz = s.timeZone();
      process.stdout.write(`OK: ${app === 'central' ? 'HQ' : 'OpsPoint'} would start (profile ${prof.name}, time zone ${tz.name}).\n`);
      return 0;
    }
    const d = s.describe();
    if (flag('--json')) process.stdout.write(JSON.stringify(d, null, 2) + '\n');
    else printSettings(d);
    return d.problems.some((p) => p.level === 'error') ? settings.EX_CONFIG : 0;
  }

  if (cmd === 'keys') {
    const crypto = require('crypto');
    const k = require('../lib/webpush').generateKeys();
    const keys = {
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      VAPID_PUBLIC_KEY: k.publicKey,
      VAPID_PRIVATE_KEY: k.privateKey,
    };
    if (flag('--json')) { process.stdout.write(JSON.stringify(keys, null, 2) + '\n'); return 0; }
    process.stdout.write('# New secrets for ONE OpsPoint install: put them in its secret store or settings file,\n' +
      '# never in git. Changing the push keys later cuts off every subscribed phone.\n' +
      Object.entries(keys).map(([n, v]) => `${n}=${v}`).join('\n') + '\n');
    return 0;
  }

  process.stdout.write(USAGE);
  return cmd && cmd !== 'help' && !flag('--help') ? 2 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { main };
