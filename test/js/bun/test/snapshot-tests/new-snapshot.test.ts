import { expect, test } from "bun:test";
import fs from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";

test("it will create a snapshot file and directory if they don't exist", () => {
  const tempDir = tmpdirSync();
  fs.rmSync(tempDir, { force: true, recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  fs.copyFileSync(import.meta.dir + "/new-snapshot.ts", tempDir + "/new-snapshot.test.ts");
  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);

  // remove the snapshot file but leave the directory and test again.
  fs.rmSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap", { force: true });
  const { exitCode: exitCode2 } = Bun.spawnSync({
    cmd: [bunExe(), "test"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  expect(exitCode2).toBe(0);
  expect(fs.existsSync(tempDir + "/__snapshots__/new-snapshot.test.ts.snap")).toBe(true);
});

test("updating to a shorter inline snapshot truncates the stale tail", () => {
  const tempDir = tmpdirSync();
  const padding = "previous-much-longer-inline-snapshot-value-".repeat(8);
  fs.writeFileSync(
    tempDir + "/inline-shrink.test.ts",
    `import { expect, test } from "bun:test";\n` +
      `test("inline", () => {\n` +
      `  expect("short").toMatchInlineSnapshot(\`"${padding}"\`);\n` +
      `});\n`,
  );

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", "--update-snapshots", "inline-shrink.test.ts"],
    cwd: tempDir,
    env: { ...bunEnv, CI: "false" },
  });

  const rewritten = fs.readFileSync(tempDir + "/inline-shrink.test.ts", "utf8");
  expect(rewritten).toContain('toMatchInlineSnapshot(`"short"`)');
  // The rewrite shrinks the file; a missing/failed truncate would leave the
  // old padding after the new content.
  expect(rewritten).not.toContain(padding);
  expect(exitCode).toBe(0);
});
