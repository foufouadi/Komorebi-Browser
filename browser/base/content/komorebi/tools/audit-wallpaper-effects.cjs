"use strict";

const fs = require("fs");
const path = require("path");

const { KomorebiPackageReader } = require("../komorebi-package-reader.js");
const { KomorebiTexParser } = require("../komorebi-tex-parser.js");
const { KomorebiMdlParser } = require("../komorebi-mdl-parser.js");
const {
  KomorebiMaterialPassLibrary,
} = require("../komorebi-material-pass.js");

const APPROXIMATED_EFFECTS = new Set([
  "blend",
  "blurprecise",
  "custom_user_texture",
  "foliagesway",
  "iris",
  "iris_follow_cursor",
  "opacity",
  "pulse",
  "scroll",
  "shake",
  "tint",
  "transform",
  "user_texture_alpha_overwrite_workaround",
  "waterflow",
  "waterripple",
  "waterwaves",
]);

const root = process.argv[2];
const summaryOnly = process.argv.includes("--summary");
if (!root) {
  throw new Error("Usage: node audit-wallpaper-effects.cjs <wallpaper-folder>");
}

const effects = new Map();
const errors = [];
let packages = 0;
let scenes = 0;
let textures = 0;
let puppetModels = 0;
let embeddedMaterialPasses = 0;

for (const directory of fs.readdirSync(root, { withFileTypes: true })) {
  if (!directory.isDirectory()) {
    continue;
  }
  const projectPath = path.join(root, directory.name, "project.json");
  if (!fs.existsSync(projectPath)) {
    continue;
  }
  let project;
  try {
    project = JSON.parse(fs.readFileSync(projectPath, "utf8"));
  } catch (error) {
    errors.push({ file: projectPath, message: error.message });
    continue;
  }
  if (project.type !== "scene") {
    continue;
  }
  scenes++;
  const sceneFile = project.file || "scene.json";
  const packagePath = path.join(
    root,
    directory.name,
    sceneFile.replace(/\.json$/i, ".pkg")
  );
  if (!fs.existsSync(packagePath)) {
    errors.push({ file: packagePath, message: "Package not found" });
    continue;
  }
  try {
    const pkg = KomorebiPackageReader.parse(
      new Uint8Array(fs.readFileSync(packagePath)),
      sceneFile
    );
    packages++;
    const materialPasses = new KomorebiMaterialPassLibrary(pkg.entries);
    for (const object of pkg.scene.objects || []) {
      try {
        embeddedMaterialPasses += materialPasses.resolveEffects(
          object.effects
        ).length;
      } catch (error) {
        errors.push({ file: packagePath, message: error.message });
      }
      for (const effect of object.effects || []) {
        const parts = (effect.file || "unknown").split("/");
        const name = (parts.at(-2) || parts.at(-1)).toLowerCase();
        const entry = effects.get(name) || {
          active: 0,
          count: 0,
          properties: new Map(),
          scenes: new Set(),
        };
        if (effect.visible !== false && effect.visible?.value !== false) {
          entry.active++;
        }
        entry.count++;
        entry.scenes.add(project.title || directory.name);
        for (const pass of effect.passes || []) {
          for (const property of Object.keys(pass.constantshadervalues || {})) {
            entry.properties.set(
              property,
              (entry.properties.get(property) || 0) + 1
            );
          }
        }
        effects.set(name, entry);
      }
    }
    for (const [name, data] of pkg.entries) {
      if (name.endsWith(".mdl")) {
        puppetModels++;
        try {
          KomorebiMdlParser.parse(data);
        } catch (error) {
          errors.push({ file: `${packagePath}:${name}`, message: error.message });
        }
      }
      if (!name.endsWith(".tex")) {
        continue;
      }
      textures++;
      try {
        new KomorebiTexParser(data).parse();
      } catch (error) {
        errors.push({ file: `${packagePath}:${name}`, message: error.message });
      }
    }
  } catch (error) {
    errors.push({ file: packagePath, message: error.message });
  }
}

const report = {
  effects: [...effects]
    .map(([name, entry]) => ({
      active: entry.active,
      count: entry.count,
      status: APPROXIMATED_EFFECTS.has(name) ? "approximated" : "unsupported",
      name,
      properties: Object.fromEntries(
        [...entry.properties].sort((first, second) => second[1] - first[1])
      ),
      scenes: [...entry.scenes].sort(),
    }))
    .sort(
      (first, second) => second.active - first.active || second.count - first.count
    ),
  errors,
  embeddedMaterialPasses,
  approximatedOccurrences: [...effects]
    .filter(([name]) => APPROXIMATED_EFFECTS.has(name))
    .reduce((total, [, entry]) => total + entry.count, 0),
  approximatedActiveOccurrences: [...effects]
    .filter(([name]) => APPROXIMATED_EFFECTS.has(name))
    .reduce((total, [, entry]) => total + entry.active, 0),
  packages,
  puppetModels,
  scenes,
  textures,
  totalEffectOccurrences: [...effects].reduce(
    (total, [, entry]) => total + entry.count,
    0
  ),
  totalActiveEffectOccurrences: [...effects].reduce(
    (total, [, entry]) => total + entry.active,
    0
  ),
};

report.approximationCoverage = report.totalEffectOccurrences
  ? report.approximatedOccurrences / report.totalEffectOccurrences
  : 1;
report.activeApproximationCoverage = report.totalActiveEffectOccurrences
  ? report.approximatedActiveOccurrences / report.totalActiveEffectOccurrences
  : 1;

const output = summaryOnly
  ? {
      activeApproximationCoverage: report.activeApproximationCoverage,
      errors: report.errors,
      embeddedMaterialPasses: report.embeddedMaterialPasses,
      approximatedActiveOccurrences: report.approximatedActiveOccurrences,
      nextEffects: report.effects
        .filter(effect => effect.active && effect.status === "unsupported")
        .slice(0, 15)
        .map(({ active, count, name }) => ({ active, count, name })),
      packages: report.packages,
      puppetModels: report.puppetModels,
      scenes: report.scenes,
      textures: report.textures,
      totalActiveEffectOccurrences: report.totalActiveEffectOccurrences,
    }
  : report;

process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
