#!/usr/bin/env node
// Installer for the Startend product-engineer-skills library.
// Copies skills into the agent's skills directory. Supports single skills,
// named kits (kits.json), --all, and a --codex target.

import {
  readdirSync, mkdirSync, copyFileSync, rmSync, existsSync, readFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PLUGINS_DIR = join(ROOT, "plugins");

function expandHome(p) {
  if (!p) return p;
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) copyFileSync(s, d);
  }
}

// name -> absolute skill path, by scanning plugins/*/skills/* for a SKILL.md.
// A plugin may bundle several skills (a kit), so scan all of them.
function discoverSkills() {
  const reg = {};
  if (!existsSync(PLUGINS_DIR)) return reg;
  for (const plugin of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!plugin.isDirectory()) continue;
    const skillsDir = join(PLUGINS_DIR, plugin.name, "skills");
    if (!existsSync(skillsDir)) continue;
    for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!skill.isDirectory()) continue;
      if (existsSync(join(skillsDir, skill.name, "SKILL.md"))) {
        reg[skill.name] = join(skillsDir, skill.name);
      }
    }
  }
  return reg;
}

function loadKits() {
  const f = join(ROOT, "kits.json");
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

function usage(reg, kits) {
  console.log(`
Startend · product-engineer-skills

Usage:
  npx github:Startendru/product-engineer-skills <skill|kit>...   install skills or kits
  npx github:Startendru/product-engineer-skills --all            install everything
  npx github:Startendru/product-engineer-skills --list           list skills and kits

Options:
  --codex            install into ~/.codex/skills (default: ~/.claude/skills)
  --skills-dir PATH  install into a custom skills directory
  --help             show this help

Skills: ${Object.keys(reg).join(", ") || "(none)"}
Kits:   ${Object.keys(kits).join(", ") || "(none)"}
`);
}

function main() {
  const argv = process.argv.slice(2);
  const reg = discoverSkills();
  const kits = loadKits();

  let targetDir = join(homedir(), ".claude", "skills");
  const names = [];
  let all = false;
  let list = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--all") all = true;
    else if (a === "--list") list = true;
    else if (a === "--codex") targetDir = join(homedir(), ".codex", "skills");
    else if (a === "--skills-dir") {
      const value = argv[i + 1];
      if (!value) throw new Error("--skills-dir requires a value");
      targetDir = expandHome(value);
      i += 1;
    } else if (a.startsWith("-")) throw new Error(`Unknown option: ${a}`);
    else names.push(a);
  }

  if (help) return usage(reg, kits);

  if (list) {
    console.log("Skills:");
    for (const n of Object.keys(reg)) console.log(`  ${n}`);
    console.log("Kits:");
    for (const [n, skills] of Object.entries(kits)) console.log(`  ${n} -> ${skills.join(", ")}`);
    return;
  }

  const toInstall = new Set();
  if (all) Object.keys(reg).forEach((n) => toInstall.add(n));
  for (const name of names) {
    if (kits[name]) kits[name].forEach((s) => toInstall.add(s));
    else if (reg[name]) toInstall.add(name);
    else throw new Error(`Unknown skill or kit: ${name} (run with --list)`);
  }
  if (toInstall.size === 0) return usage(reg, kits);

  targetDir = resolve(expandHome(targetDir));
  mkdirSync(targetDir, { recursive: true });
  for (const name of toInstall) {
    const src = reg[name];
    if (!src) {
      console.error(`Skip: ${name} not found`);
      continue;
    }
    const dest = join(targetDir, name);
    rmSync(dest, { recursive: true, force: true });
    copyDir(src, dest);
    console.log(`Installed: ${name} -> ${dest}`);
  }

  const first = [...toInstall][0];
  console.log(`\nDone. Restart your agent, then trigger a skill naturally or with /${first}.`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
