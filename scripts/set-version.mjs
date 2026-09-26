// Setzt die Versionsnummer für einen Build auf <major>.<minor>.<Build-Nummer>.
// Major/Minor kommen aus package.json, die letzte Stelle zählt mit jedem
// GitHub-Build hoch – so ist jede neue Version automatisch „neuer“ und das
// Auto-Update erkennt sie.
import fs from "node:fs";

const run = process.env.GITHUB_RUN_NUMBER ?? process.argv[2];
if (!run || !/^\d+$/.test(run)) {
  console.error("Build-Nummer fehlt (GITHUB_RUN_NUMBER oder Argument).");
  process.exit(1);
}

const pkgPath = "package.json";
const confPath = "src-tauri/tauri.conf.json";
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const [major, minor] = pkg.version.split(".");
const version = `${major}.${minor}.${run}`;

pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
conf.version = version;
fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Version: ${version}`);
