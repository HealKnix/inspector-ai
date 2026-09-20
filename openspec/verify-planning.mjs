// Read-only verification of the split and checkbox progress; no application checks.
import assert from "node:assert/strict";
import console from "node:console";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
const read = (file) => fs.readFileSync(file, "utf8");
const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const map = JSON.parse(read(path.join(root, "delivery-map.json")));
const history = path.resolve(root, map.history);
const ids = new Map(map.changes.map((change) => [change.id, change]));
const knownOwners = new Set([...ids.keys(), ...Object.keys(map.shared)]);
const activeDir = path.join(root, "changes");
const archiveDir = path.join(activeDir, "archive");
const docs = [];

function changeDirectory(name) {
  const active = path.join(activeDir, name);
  if (fs.existsSync(active)) return { directory: active, location: "active" };
  const candidates = fs.existsSync(archiveDir)
    ? fs.readdirSync(archiveDir).filter((entry) => entry.endsWith(`-${name}`))
    : [];
  assert.equal(
    candidates.length,
    1,
    `Expected active change or one archive: ${name}`,
  );
  return {
    directory: path.join(archiveDir, candidates[0]),
    location: "archive",
  };
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? markdownFiles(file)
      : entry.name.endsWith(".md")
        ? [file]
        : [];
  });
}

function verifyLinks(file) {
  // Historical documents are intentionally preserved, including their old links.
  const content = read(file).replace(/```[\s\S]*?```/g, "");
  assert.ok(
    !/\bundefined\b|<!--\s*TODO/.test(content),
    `Unfilled artifact text in ${file}`,
  );
  const links = [
    ...content.matchAll(/\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))\)/g),
  ];
  for (const link of links) {
    const target = link[1] ?? link[2];
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("#")) continue;
    const destination = path.resolve(
      path.dirname(file),
      decodeURIComponent(target.split("#")[0]),
    );
    const relative = path.relative(repo, destination);
    assert.ok(
      !relative.startsWith("..") && !path.isAbsolute(relative),
      `Non-portable link in ${file}: ${target}`,
    );
    assert.ok(fs.existsSync(destination), `Broken link in ${file}: ${target}`);
  }
}

function walkDependencies(id, stack = [], visited = new Set()) {
  assert.ok(
    !stack.includes(id),
    `Dependency cycle: ${[...stack, id].join(" -> ")}`,
  );
  if (visited.has(id)) return;
  const change = ids.get(id);
  assert.ok(change, `Unknown change dependency: ${id}`);
  for (const dependency of change.depends_on)
    walkDependencies(dependency, [...stack, id], visited);
  visited.add(id);
}

assert.equal(map.version, 1);
assert.equal(
  map.changes.length,
  7,
  "Split map must contain the seven replacements",
);
assert.equal(ids.size, 7, "Duplicate change id");
assert.equal(
  new Set(map.changes.map((item) => item.name)).size,
  7,
  "Duplicate change name",
);
assert.equal(
  new Set(map.changes.map((item) => item.capability)).size,
  7,
  "Duplicate capability owner",
);
assert.equal(map.task_map.length, 98);
assert.equal(map.requirement_map.length, 40);
assert.equal(new Set(map.task_map.map((item) => item.id)).size, 98);
assert.equal(new Set(map.requirement_map.map((item) => item.id)).size, 40);
assert.ok(
  !fs.existsSync(path.join(activeDir, map.source_change)),
  "Superseded source is still active",
);
assert.ok(
  history.startsWith(root + path.sep),
  "History must remain inside OpenSpec",
);

for (const file of map.source_files) {
  assert.equal(
    sha256(path.join(history, file.path)),
    file.sha256,
    `Historical source changed: ${file.path}`,
  );
}
const sourceTasks = [
  ...read(path.join(history, "tasks.md")).matchAll(
    /^- \[ \] (\d+\.\d+) (.+)$/gm,
  ),
];
assert.equal(sourceTasks.length, 98);
for (const source of sourceTasks) {
  assert.equal(
    map.task_map.find((task) => task.id === source[1])?.text,
    source[2].trim(),
    `Source task mismatch ${source[1]}`,
  );
}
const sourceReqs = markdownFiles(path.join(history, "specs")).flatMap((file) =>
  read(file)
    .split(/^### Requirement: /m)
    .slice(1)
    .map((section) => ({
      id: section.match(/^([A-Z]+-\d+)/)[1],
      text: "### Requirement: " + section.trim() + "\n",
    })),
);
const backlog = read(path.join(root, "SHARED_BACKLOG.md"));
assert.equal(sourceReqs.length, 40);
for (const source of sourceReqs) {
  assert.equal(
    map.requirement_map.find((requirement) => requirement.id === source.id)
      ?.text,
    source.text,
    `Source requirement mismatch ${source.id}`,
  );
}

const progress = [];
for (const change of map.changes) {
  walkDependencies(change.id);
  for (const dependency of change.shared_dependencies)
    assert.ok(
      map.shared[dependency],
      `Unknown shared dependency: ${dependency}`,
    );
  const { directory, location } = changeDirectory(change.name);
  for (const artifact of [
    ".openspec.yaml",
    "proposal.md",
    "design.md",
    "tasks.md",
  ]) {
    assert.ok(
      fs.existsSync(path.join(directory, artifact)),
      `${change.name}: missing ${artifact}`,
    );
  }
  const specs = markdownFiles(path.join(directory, "specs"));
  assert.equal(
    specs.length,
    1,
    `${change.name}: expected one owned capability`,
  );
  assert.equal(
    specs[0],
    path.join(directory, "specs", change.capability, "spec.md"),
  );
  const spec = read(specs[0]);
  assert.ok(
    /^## Purpose\s+[\s\S]{50,}?^## ADDED Requirements/m.test(spec),
    `${change.name}: missing Purpose`,
  );
  const requirements = spec.split(/^### Requirement: /m).slice(1);
  assert.ok(requirements.length, `${change.name}: no requirements`);
  for (const requirement of requirements) {
    assert.ok(
      /\b(SHALL|MUST)\b/.test(requirement),
      `${change.name}: no normative requirement`,
    );
    assert.ok(
      /^#### Scenario: /m.test(requirement) &&
        /\*\*WHEN\*\*/.test(requirement) &&
        /\*\*THEN\*\*/.test(requirement),
      `${change.name}: missing testable scenario`,
    );
  }
  const tasks = read(path.join(directory, "tasks.md"));
  const checkboxes = [...tasks.matchAll(/^- \[([ xX])\] (\d+\.\d+) (.+)$/gm)];
  assert.ok(checkboxes.length, `${change.name}: no tracked tasks`);
  assert.equal(
    new Set(checkboxes.map((item) => item[2])).size,
    checkboxes.length,
    `${change.name}: duplicate task number`,
  );
  assert.equal(
    [...tasks.matchAll(/^- \[/gm)].length,
    checkboxes.length,
    `${change.name}: malformed checkbox`,
  );
  for (const task of checkboxes)
    assert.ok(
      /проверка:/i.test(task[3]),
      `${change.name}: task ${task[2]} has no verification`,
    );
  for (const task of map.task_map.filter((item) =>
    item.owners.includes(change.id),
  )) {
    assert.ok(
      tasks.includes(`[SRC-${task.id}]`),
      `${change.name}: unreferenced source task ${task.id}`,
    );
  }
  for (const requirement of map.requirement_map.filter((item) =>
    item.owners.includes(change.id),
  )) {
    assert.ok(
      spec.includes(`[SRC-REQ ${requirement.id}]`),
      `${change.name}: unreferenced requirement ${requirement.id}`,
    );
  }
  progress.push({
    id: change.id,
    change: change.name,
    location,
    done: checkboxes.filter((item) => item[1].toLowerCase() === "x").length,
    total: checkboxes.length,
  });
  docs.push(...markdownFiles(directory));
}

for (const item of [...map.task_map, ...map.requirement_map]) {
  assert.ok(item.owners.length, `Unassigned source: ${item.id}`);
  assert.equal(
    new Set(item.owners).size,
    item.owners.length,
    `Duplicate owner: ${item.id}`,
  );
  for (const owner of item.owners)
    assert.ok(knownOwners.has(owner), `Unknown owner ${owner}: ${item.id}`);
}
for (const task of map.task_map)
  for (const owner of task.owners.filter((id) => map.shared[id])) {
    const section = backlog
      .split(`<a id="${owner.toLowerCase()}"></a>`)[1]
      ?.split("<a id=")[0];
    assert.ok(
      section?.includes(`[SRC-${task.id}]`),
      `Shared backlog ${owner}: missing task ${task.id}`,
    );
  }
for (const requirement of map.requirement_map)
  for (const owner of requirement.owners.filter((id) => map.shared[id])) {
    const section = backlog
      .split(`<a id="${owner.toLowerCase()}"></a>`)[1]
      ?.split("<a id=")[0];
    assert.ok(
      section?.includes(`### Requirement: ${requirement.id} `),
      `Shared backlog ${owner}: missing requirement ${requirement.id}`,
    );
  }

const sourcesFile = path.join(repo, "docs/requirements/SOURCES.md");
const sources = [
  ...read(sourcesFile).matchAll(
    /\|\s+\[[^\]]+\]\((?:<([^>]+)>|([^\s)]+))\)\s+\|\s+`([a-f0-9]{64})`\s+\|/g,
  ),
];
assert.equal(
  sources.length,
  4,
  "Expected the authoritative PDF and three annexes",
);
for (const match of sources) {
  const sourcePath = match[1] ?? match[2];
  assert.equal(
    sha256(path.join(path.dirname(sourcesFile), sourcePath)),
    match[3],
    `Requirements source changed: ${sourcePath}`,
  );
}
docs.push(
  sourcesFile,
  ...["README.md", "CONTRACTS.md", "SPLIT_MAP.md", "SHARED_BACKLOG.md"].map(
    (name) => path.join(root, name),
  ),
);
docs.forEach(verifyLinks);

console.log(
  "Split verified: 98 source tasks, 40 source requirements, 7 changes; history hashes and links valid.",
);
console.table(progress);
console.log(
  `Implementation: ${progress.reduce((total, item) => total + item.done, 0)}/${progress.reduce((total, item) => total + item.total, 0)} tasks checked in the seven changes.`,
);
console.log(
  "Shared backlog remains separate. This command does not verify application behavior or release acceptance.",
);
