import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = path.join(REPO, 'hooks', 'session-md.mjs');
const ROOT = path.join(os.tmpdir(), 'ws-test-' + Date.now());
const STATE = path.join(ROOT, 'state');
fs.mkdirSync(STATE, { recursive: true });

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
};

function runHook(payload, extraEnv = {}) {
  const base = Object.assign({}, process.env, { WRITE_SESSION_STATE_DIR: STATE }, extraEnv);
  const r = execFileSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: 'utf8', env: base, timeout: 20000,
  });
  return r;
}

function mkrepo(name) {
  const d = path.join(ROOT, name);
  fs.mkdirSync(d, { recursive: true });
  const g = (...a) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' });
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t.t');
  g('config', 'user.name', 't');
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n');
  g('add', '-A');
  g('commit', '-qm', 'initial commit');
  return d;
}

// ---------------------------------------------------------------- 1. basic
console.log('\n1. basic repo write');
const r1 = mkrepo('repo1');
const out1 = runHook({
  hook_event_name: 'Stop', session_id: 'aaaabbbb-1111', cwd: r1,
  last_assistant_message: 'Designed the split checkpoint and shipped the Stop hook.',
});
ok('hook emits nothing on stdout', out1 === '', JSON.stringify(out1));
const f1 = path.join(r1, 'SESSION.md');
ok('SESSION.md created', fs.existsSync(f1));
const c1 = fs.readFileSync(f1, 'utf8');
ok('has auto markers', c1.includes('session-md:auto:start') && c1.includes('session-md:auto:end'));
ok('has narrative markers', c1.includes('session-md:narrative:start') && c1.includes('session-md:narrative:end'));
ok('has branch', /\*\*Branch\*\* `main`/.test(c1), c1.slice(0, 200));
ok('has commit subject', c1.includes('initial commit'));
ok('turn recorded', c1.includes('Designed the split checkpoint'));
ok('git exclude written', fs.readFileSync(path.join(r1, '.git/info/exclude'), 'utf8').includes('/SESSION.md'));
const st1 = execFileSync('git', ['-C', r1, 'status', '--porcelain'], { encoding: 'utf8' });
ok('SESSION.md invisible to git status', !st1.includes('SESSION.md'), st1);

// ------------------------------------------------- 2. narrative preservation
console.log('\n2. narrative survives regeneration');
const marked = c1.replace(
  /(<!-- session-md:narrative:start -->)[\s\S]*?(<!-- session-md:narrative:end -->)/,
  '$1\n\n## Where we are\nMY PRECIOUS NARRATIVE\n\n$2'
);
fs.writeFileSync(f1, marked);
runHook({ hook_event_name: 'Stop', session_id: 'aaaabbbb-1111', cwd: r1, last_assistant_message: 'A second, entirely different turn about packaging.' });
const c2 = fs.readFileSync(f1, 'utf8');
ok('narrative preserved', c2.includes('MY PRECIOUS NARRATIVE'));
ok('new turn appended', c2.includes('entirely different turn about packaging'));
ok('old turn still present', c2.includes('Designed the split checkpoint'));

// ------------------------------------------------------------- 3. dedup + ring
console.log('\n3. dedup and ring cap');
for (let i = 0; i < 3; i++) runHook({ hook_event_name: 'Stop', session_id: 'aaaabbbb-1111', cwd: r1, last_assistant_message: 'duplicate message repeated three times over' });
const c3 = fs.readFileSync(f1, 'utf8');
ok('duplicate recorded once', (c3.match(/duplicate message repeated/g) || []).length === 1, String((c3.match(/duplicate message repeated/g) || []).length));
for (let i = 0; i < 9; i++) runHook({ hook_event_name: 'Stop', session_id: 'aaaabbbb-1111', cwd: r1, last_assistant_message: 'ring probe number ' + i + ' with enough characters to pass the floor' });
const c3b = fs.readFileSync(f1, 'utf8');
const probes = (c3b.match(/ring probe number/g) || []).length;
ok('ring capped at 6', probes === 6, 'probes=' + probes);
ok('oldest probe evicted', !c3b.includes('ring probe number 0'));
ok('newest probe kept', c3b.includes('ring probe number 8'));
ok('short message skipped', !c3b.includes('Done.'));
runHook({ hook_event_name: 'Stop', session_id: 'aaaabbbb-1111', cwd: r1, last_assistant_message: 'Done.' });
ok('narrative STILL preserved after 13 turns', fs.readFileSync(f1, 'utf8').includes('MY PRECIOUS NARRATIVE'));

// ------------------------------------------------------- 4. transcript fallback
console.log('\n4. transcript fallback when last_assistant_message absent');
const tpath = path.join(ROOT, 'transcript.jsonl');
fs.writeFileSync(tpath, [
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'FALLBACK TEXT FROM TRANSCRIPT worked correctly' }] } }),
  JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
].join('\n') + '\n');
const r4 = mkrepo('repo4');
runHook({ hook_event_name: 'Stop', session_id: 'ccccdddd-2222', cwd: r4, transcript_path: tpath });
ok('fallback text recorded', fs.readFileSync(path.join(r4, 'SESSION.md'), 'utf8').includes('FALLBACK TEXT FROM TRANSCRIPT'));

// ------------------------------------------------------------ 5. concurrency
console.log('\n5. concurrency — 8 simultaneous hooks, one repo');
const r5 = mkrepo('repo5');
runHook({ hook_event_name: 'Stop', session_id: 'seed0000', cwd: r5, last_assistant_message: 'seed turn to create the file with markers' });
const f5 = path.join(r5, 'SESSION.md');
fs.writeFileSync(f5, fs.readFileSync(f5, 'utf8').replace(
  /(<!-- session-md:narrative:start -->)[\s\S]*?(<!-- session-md:narrative:end -->)/,
  '$1\n\n## Where we are\nCONCURRENT NARRATIVE SENTINEL\n\n$2'
));
const kids = [];
for (let i = 0; i < 8; i++) {
  const p = spawn(process.execPath, [HOOK], {
    env: Object.assign({}, process.env, { WRITE_SESSION_STATE_DIR: STATE }),
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  p.stdin.end(JSON.stringify({
    hook_event_name: 'Stop', session_id: 'concur-' + i, cwd: r5,
    last_assistant_message: 'concurrent writer number ' + i + ' doing its own distinct work',
  }));
  kids.push(new Promise((res) => p.on('close', res)));
}
await Promise.all(kids);
const c5 = fs.readFileSync(f5, 'utf8');
ok('narrative survived 8-way race', c5.includes('CONCURRENT NARRATIVE SENTINEL'));
ok('file not torn — both markers intact', (c5.match(/session-md:auto:start/g) || []).length === 1 && (c5.match(/session-md:narrative:end/g) || []).length === 1);
const writers = new Set((c5.match(/concurrent writer number (\d)/g) || []).map((s) => s.slice(-1)));
ok('multiple writers merged into the tail', writers.size >= 2, 'distinct writers shown: ' + writers.size);
ok('no lock left behind', !fs.existsSync(path.join(STATE, fs.readdirSync(STATE).find((d) => d.includes('repo5')) || 'x', '.lock')));
ok('no temp files left behind', fs.readdirSync(r5).filter((n) => n.includes('.tmp-')).length === 0);

// --------------------------------------------------------------- 6. opt-outs
console.log('\n6. opt-outs');
const r6 = mkrepo('repo6');
runHook({ hook_event_name: 'Stop', session_id: 'eeee', cwd: r6, last_assistant_message: 'this should not land in the repo at all' }, { WRITE_SESSION_LOCATION: 'home' });
ok('LOCATION=home writes nothing into repo', !fs.existsSync(path.join(r6, 'SESSION.md')));
ok('LOCATION=home leaves .git/info/exclude alone', !fs.readFileSync(path.join(r6, '.git/info/exclude'), 'utf8').includes('SESSION.md'));
const homeCopy = path.join(STATE, fs.readdirSync(STATE).find((d) => d.includes('repo6')), 'SESSION.md');
ok('LOCATION=home writes to state dir', fs.existsSync(homeCopy));

const r7 = mkrepo('repo7');
runHook({ hook_event_name: 'Stop', session_id: 'ffff', cwd: r7, last_assistant_message: 'excluded opt out test message here' }, { WRITE_SESSION_GIT_EXCLUDE: '0' });
ok('GIT_EXCLUDE=0 still writes SESSION.md', fs.existsSync(path.join(r7, 'SESSION.md')));
ok('GIT_EXCLUDE=0 does not touch exclude', !fs.readFileSync(path.join(r7, '.git/info/exclude'), 'utf8').includes('SESSION.md'));

const r8 = mkrepo('repo8');
runHook({ hook_event_name: 'Stop', session_id: 'gggg', cwd: r8, last_assistant_message: 'kill switch test message goes here' }, { WRITE_SESSION: '0' });
ok('WRITE_SESSION=0 writes nothing', !fs.existsSync(path.join(r8, 'SESSION.md')));
runHook({ hook_event_name: 'Stop', session_id: 'gggg', cwd: r8, last_assistant_message: 'legacy kill switch test message here' }, { CLAUDE_SESSION_MD: '0' });
ok('CLAUDE_SESSION_MD=0 honored', !fs.existsSync(path.join(r8, 'SESSION.md')));

const r9 = mkrepo('repo9');
// Fixture must EXCEED the cap, or nothing truncates and the test proves nothing.
const long9 = 'custom caps test message ' + 'z'.repeat(300);
runHook({ hook_event_name: 'Stop', session_id: 'hhhh', cwd: r9, last_assistant_message: long9 }, { WRITE_SESSION_MAX_TURN_CHARS: '80' });
const c9 = fs.readFileSync(path.join(r9, 'SESSION.md'), 'utf8');
const turn9 = (c9.match(/^- \*\*[\d-]+ [\d:]+\*\* (.*)$/m) || [])[1] || '';
ok('MAX_TURN_CHARS honored', turn9.length === 80 && turn9.endsWith('…'), `len=${turn9.length} tail=${JSON.stringify(turn9.slice(-3))}`);

// ------------------------------------------------------------ 7. robustness
console.log('\n7. robustness');
const bad = [
  ['empty stdin', ''],
  ['malformed json', '{not json'],
  ['empty object', '{}'],
  ['wrong event', JSON.stringify({ hook_event_name: 'SubagentStop', cwd: r1, last_assistant_message: 'SHOULD NOT APPEAR IN FILE anywhere' })],
  ['null fields', JSON.stringify({ hook_event_name: 'Stop', session_id: null, cwd: null, last_assistant_message: null })],
];
for (const [name, payload] of bad) {
  let code = -1;
  try {
    execFileSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8', env: Object.assign({}, process.env, { WRITE_SESSION_STATE_DIR: STATE }), timeout: 20000 });
    code = 0;
  } catch (e) { code = e.status; }
  ok(name + ' exits 0', code === 0, 'code=' + code);
}
ok('SubagentStop did not write', !fs.readFileSync(f1, 'utf8').includes('SHOULD NOT APPEAR IN FILE'));

// ------------------------------------------------------- 8. non-repo + adopt
console.log('\n8. non-repo cwd and markerless adoption');
const plain = path.join(ROOT, 'notarepo');
fs.mkdirSync(plain, { recursive: true });
runHook({ hook_event_name: 'Stop', session_id: 'iiii', cwd: plain, last_assistant_message: 'working in a plain directory with no git at all' });
ok('nothing written into non-repo cwd', !fs.existsSync(path.join(plain, 'SESSION.md')));
const plainCopy = path.join(STATE, fs.readdirSync(STATE).find((d) => d.includes('notarepo')), 'SESSION.md');
ok('non-repo state file written', fs.existsSync(plainCopy));
ok('non-repo notes absence of git', fs.readFileSync(plainCopy, 'utf8').includes('Not a git repository'));

const r10 = mkrepo('repo10');
fs.writeFileSync(path.join(r10, 'SESSION.md'), '# My own notes\n\nPRE EXISTING UNMARKED CONTENT\n');
runHook({ hook_event_name: 'Stop', session_id: 'jjjj', cwd: r10, last_assistant_message: 'adopting a pre-existing markerless session file' });
const c10 = fs.readFileSync(path.join(r10, 'SESSION.md'), 'utf8');
ok('pre-existing content adopted, not clobbered', c10.includes('PRE EXISTING UNMARKED CONTENT'));
ok('adopted file gains markers', c10.includes('session-md:narrative:start'));
ok('adopted file has exactly one H1', (c10.match(/^# /gm) || []).length === 1, String((c10.match(/^# /gm) || []).length));

// --------------------------------------------------------------- 9. manifests
console.log('\n9. manifests parse');
for (const f of ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'hooks/hooks.json']) {
  try { JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8')); ok(f + ' valid JSON', true); }
  catch (e) { ok(f + ' valid JSON', false, e.message); }
}
const hj = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8'));
ok('hooks.json uses args form (no shell)', Array.isArray(hj.hooks.Stop[0].hooks[0].args));
ok('hooks.json uses CLAUDE_PLUGIN_ROOT', hj.hooks.Stop[0].hooks[0].args[0].includes('${CLAUDE_PLUGIN_ROOT}'));

console.log('\n================ ' + pass + ' passed, ' + fail + ' failed ================');
// Everything the suite created lives under ROOT, outside the repo. Remove it; on Windows
// a git process can still hold a handle for a moment, hence the retries.
let cleaned = true;
try { fs.rmSync(ROOT, { recursive: true, force: true, maxRetries: 30, retryDelay: 300 }); }
catch { cleaned = false; }
console.log(cleaned ? 'workdir removed: ' + ROOT : 'workdir LEFT BEHIND: ' + ROOT);
process.exit(fail ? 1 : 0);
