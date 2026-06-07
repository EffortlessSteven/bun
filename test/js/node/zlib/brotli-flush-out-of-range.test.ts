import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: a Brotli stream's runtime `.flush(kind)` method does not
// range-check `kind` (only `options.flush` is checked at construction). A
// generic zlib flush constant such as `Z_FINISH` (4) is outside Brotli's
// operation range (0..=3), so it reached the native `set_flush` and hit an
// `unreachable!` (SIGILL) on the worker thread. Node tolerates an out-of-range
// flush (no boundary, no error), so the stream must keep working.

test("Brotli .flush() with an out-of-range flush constant does not abort", async () => {
  const fixture = /* js */ `
    const zlib = require("node:zlib");
    const input = Buffer.from("the quick brown fox".repeat(64));
    const c = zlib.createBrotliCompress();
    const chunks = [];
    c.on("data", d => chunks.push(d));
    c.on("end", () => {
      const round = zlib.brotliDecompressSync(Buffer.concat(chunks));
      process.stdout.write("roundtrip=" + round.equals(input) + "\\n");
    });
    c.write(input);
    // Z_FINISH (4) is a valid zlib flush but out of Brotli's range.
    c.flush(zlib.constants.Z_FINISH);
    c.end();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The compress still produces output that round-trips; before the fix the
  // child aborted (SIGILL) on the out-of-range flush and never got here.
  expect(stdout).toBe("roundtrip=true\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
