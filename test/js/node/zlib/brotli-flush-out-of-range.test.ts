import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A Brotli stream's runtime `.flush(kind)` is not range-checked (only
// `options.flush` is, at construction), so a generic zlib flush constant such
// as `Z_FINISH` (4) can reach the native encoder despite being outside
// Brotli's operation range (0..=3). An out-of-range value is not a valid
// operation: it must not abort the process, and passing it through to the
// encoder hangs the stream (the behavior in Node and released Bun). The stream
// must instead apply no flush boundary and still complete.

test("Brotli .flush() with an out-of-range flush constant does not abort or hang", async () => {
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
  // Bound the wait: a regression that forwards the raw flush value to the
  // encoder hangs the child, which must fail this test rather than hang CI.
  const timer = setTimeout(() => proc.kill(), 10_000);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);

  // The child must survive the out-of-range flush and its output must round-trip.
  expect(stdout).toBe("roundtrip=true\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
