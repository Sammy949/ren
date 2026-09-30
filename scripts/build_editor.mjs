const result = await Bun.build({
  entrypoints: ["src/editor/index.js"],
  target: "browser", format: "iife", minify: true,
});
if (!result.success) {
  for (const issue of result.logs) console.error(issue);
  process.exitCode = 1;
} else {
  await Bun.write("editor.js", result.outputs[0]);
  console.log(`Built local editor bundle (${result.outputs[0].size} bytes)`);
}
