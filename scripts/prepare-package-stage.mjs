import { cp, rm } from "node:fs/promises";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_STAGE_ROOTS = new Set(["Profiles", "assets", "bin", "ui", "manifest.json"]);

function belongsInPackageStage(source, path) {
  const [root] = relative(source, path).split(sep);
  return root === "" || PACKAGE_STAGE_ROOTS.has(root);
}

export async function preparePackageStage(source, destination) {
  await rm(destination, { force: true, recursive: true });
  await cp(source, destination, {
    recursive: true,
    filter: (path) => belongsInPackageStage(source, path),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await preparePackageStage(process.argv[2], process.argv[3]);
}
