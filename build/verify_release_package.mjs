import fs from 'node:fs';
import path from 'node:path';

const rootArg = process.argv[2] || 'dist/无名AI';
const root = path.resolve(rootArg);

function fail(message) {
  console.error('[release-package-audit] ERROR:', message);
  process.exitCode = 1;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function existsAsModule(candidate) {
  const tries = [
    candidate,
    candidate + '.js',
    candidate + '.mjs',
    candidate + '.json',
    path.join(candidate, 'index.js'),
    path.join(candidate, 'index.mjs'),
  ];
  return tries.find((p) => fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

function isAllowedHostDependency(spec) {
  return /^(?:\.\.\/)+noname\.js(?:[?#].*)?$/.test(spec);
}

function collectRelativeSpecifiers(source) {
  const specs = [];
  const patterns = [
    /^\s*import\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
    /^\s*export\s+[^'"\n]*?\s+from\s+['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) {
      if (match[1] && match[1].startsWith('.')) specs.push(match[1]);
    }
  }
  return [...new Set(specs)];
}

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  fail('Package root does not exist: ' + root);
  process.exit(1);
}

const required = [
  'extension.js',
  'info.json',
  'js/config/config.js',
  'js/config/configLayout.js',
  'js/config/configSchema.js',
  'js/config/changelog.js',
  'css/AIjinjiang.css',
  'logs/今日修改日志.js',
  'logs/WORK_TRAIL.js',
];

for (const rel of required) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail('Required runtime file missing: ' + rel);
  }
}


const expectedExtensionName = path.basename(root);
let info = null;
try {
  info = JSON.parse(fs.readFileSync(path.join(root, 'info.json'), 'utf8'));
} catch (e) {
  fail('info.json is not valid JSON: ' + e.message);
}

if (!info || info.name !== expectedExtensionName) {
  fail(
    'Extension identity mismatch: package directory=' + expectedExtensionName +
    ', info.json.name=' + String(info && info.name)
  );
}

const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
const packageNameMatch = extensionSource.match(/let\s+extensionPackage\s*=\s*\{[\s\S]{0,400}?\bname\s*:\s*['"]([^'"]+)['"]/);
if (!packageNameMatch || packageNameMatch[1] !== expectedExtensionName) {
  fail(
    'Extension identity mismatch: package directory=' + expectedExtensionName +
    ', extension.js name=' + String(packageNameMatch && packageNameMatch[1])
  );
}

const observabilityContracts = [
  {
    label: 'openScorePanel',
    file: 'score/view/panel/panel.js',
    patterns: [/\bopenScorePanel\b/, /export\s*\{[\s\S]*?\bopenScorePanel\b[\s\S]*?\}/],
    mount: /window\.__DJSC\.openScorePanel\s*=\s*panel\.openScorePanel/
  },
  {
    label: 'openFeedbackPanel',
    file: 'score/view/panel/panel.js',
    patterns: [/\bopenFeedbackPanel\b/, /export\s*\{[\s\S]*?\bopenFeedbackPanel\b[\s\S]*?\}/],
    mount: /window\.__DJSC\.openFeedbackPanel\s*=\s*panel\.openFeedbackPanel/
  },
  {
    label: 'openPlanPanel',
    file: 'score/view/panel/panel.js',
    patterns: [/\bopenPlanPanel\b/, /export\s*\{[\s\S]*?\bopenPlanPanel\b[\s\S]*?\}/],
    mount: /window\.__DJSC\.openPlanPanel\s*=\s*panel\.openPlanPanel/
  },
  {
    label: 'openHealthPanel',
    file: 'score/view/panel/panel.js',
    patterns: [/\bopenHealthPanel\b/, /export\s*\{[\s\S]*?\bopenHealthPanel\b[\s\S]*?\}/],
    mount: /window\.__DJSC\.openHealthPanel\s*=\s*panel\.openHealthPanel/
  },
  {
    label: 'openDecisionDashboard',
    file: 'score/view/dashboard/decisionDashboard.js',
    patterns: [/export\s+function\s+openDecisionDashboard\s*\(/],
    mount: /['"]openDecisionDashboard['"]\s*,\s*['"]\.\/score\/view\/dashboard\/decisionDashboard\.js['"]/
  },
  {
    label: 'openSelfCheck',
    file: 'score/verification/selfCheck.js',
    patterns: [/export\s+function\s+openSelfCheck\s*\(/],
    mount: /['"]openSelfCheck['"]\s*,\s*['"]\.\/score\/verification\/selfCheck\.js['"]/
  },
];

for (const contract of observabilityContracts) {
  const full = path.join(root, contract.file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail('Observability module missing for ' + contract.label + ': ' + contract.file);
    continue;
  }
  const source = fs.readFileSync(full, 'utf8');
  for (const pattern of contract.patterns) {
    if (!pattern.test(source)) {
      fail('Observability export contract missing: ' + contract.label + ' in ' + contract.file);
      break;
    }
  }
  if (!contract.mount.test(extensionSource)) {
    fail('Observability mount contract missing in extension.js: ' + contract.label);
  }
}

if (!/import\s*\{\s*config\s*\}\s*from\s*['"]\.\/js\/config\/config\.js['"]/.test(extensionSource) ||
    !/let\s+extensionPackage\s*=\s*\{[\s\S]{0,600}?\bconfig\s*,/.test(extensionSource)) {
  fail('Extension settings contract missing: config.js is not wired into extensionPackage.config');
}

const configSource = fs.readFileSync(path.join(root, 'js/config/config.js'), 'utf8');
const configLayoutSource = fs.readFileSync(path.join(root, 'js/config/configLayout.js'), 'utf8');
const configSchemaSource = fs.readFileSync(path.join(root, 'js/config/configSchema.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'css/AIjinjiang.css'), 'utf8');

if (!/config\s*=\s*applyConfigSchema\(config\)/.test(configSource) ||
    !/config\s*=\s*arrangeConfig\(config,\s*lib,\s*game\)/.test(configSource)) {
  fail('Settings center pipeline missing: config schema/layout is not applied before export');
}

for (const marker of ['玩家选项', '开发者选项', 'djsc-mode-choice', 'djsc-settings-header']) {
  if (!configLayoutSource.includes(marker)) {
    fail('Settings center marker missing in configLayout.js: ' + marker);
  }
}

const playerSections = (configSchemaSource.match(/scope:\s*['"]player['"]/g) || []).length;
const developerSections = (configSchemaSource.match(/scope:\s*['"]developer['"]/g) || []).length;
if (playerSections < 8) fail('Player settings sections missing: expected >= 8, got ' + playerSections);
if (developerSections < 8) fail('Developer settings sections missing: expected >= 8, got ' + developerSections);

for (const marker of [
  'body[data-djsc-settings-mode="player"]',
  'body[data-djsc-settings-mode="developer"]',
  '.djsc-mode-choice',
  '.djsc-settings-group'
]) {
  if (!cssSource.includes(marker)) {
    fail('Settings center CSS contract missing: ' + marker);
  }
}

const files = walk(root);
const jsFiles = files.filter((f) => /\.(?:js|mjs)$/i.test(f));
let checkedImports = 0;
let externalHostImports = 0;
let missingImports = 0;

for (const file of jsFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const specs = collectRelativeSpecifiers(source);

  for (const rawSpec of specs) {
    checkedImports++;
    const spec = rawSpec.split(/[?#]/, 1)[0];
    const candidate = path.resolve(path.dirname(file), spec);
    const relSource = path.relative(root, file).replaceAll(path.sep, '/');

    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      if (isAllowedHostDependency(rawSpec)) {
        externalHostImports++;
        continue;
      }
      missingImports++;
      fail(relSource + ' imports outside packaged extension: ' + rawSpec);
      continue;
    }

    if (!existsAsModule(candidate)) {
      missingImports++;
      const relTarget = path.relative(root, candidate).replaceAll(path.sep, '/');
      fail(relSource + ' -> missing relative dependency: ' + rawSpec + ' (resolved ' + relTarget + ')');
    }
  }
}

if (process.exitCode) {
  console.error('[release-package-audit] FAILED: ' + missingImports + ' broken relative imports.');
  process.exit(process.exitCode);
}

console.log(
  '[release-package-audit] OK: ' +
  files.length + ' files, ' +
  jsFiles.length + ' JS modules, ' +
  checkedImports + ' relative imports verified, ' +
  externalHostImports + ' allowed host imports, identity/menu/settings/observability contracts verified.'
);
