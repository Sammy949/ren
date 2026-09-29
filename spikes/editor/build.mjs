import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = import.meta.dir;
const output = path.join(root, "dist");
await mkdir(output, { recursive: true });

const build = await Bun.build({
  entrypoints: [path.join(root, "src/main.js")],
  outdir: output,
  target: "browser",
  format: "esm",
  naming: "bundle.js",
  minify: false,
});
if (!build.success) {
  for (const issue of build.logs) console.error(issue);
  process.exitCode = 1;
} else {
  await Promise.all(
    ["manifest.json", "background.js", "sidepanel.html", "styles.css"].map(
      (file) => copyFile(path.join(root, "src", file), path.join(output, file)),
    ),
  );
  console.log(`Built isolated editor extension in ${output}`);
}
