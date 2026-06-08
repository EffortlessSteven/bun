import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// A Brotli stream's runtime `.flush(kind)` is not range-checked at the JS layer,
// so a generic zlib flush constant such as `Z_FINISH` (4) — outside Brotli's
// operation range (0..=3) — reached the native encoder and tripped an
// `unreachable!` (SIGILL / process abort). The fix rejects an out-of-range
// Brotli flush at the binding's flush gate with the same recoverable
// `Invalid flush value` TypeError zlib already throws, before the native trap.

test("Brotli .flush() with an out-of-range flush constant throws, not aborts", async () => {
  const fixture = /* js */ `
    const zlib = require("node:zlib");
    const c = zlib.createBrotliCompress();
    c.on("data", () => {});
    // The invalid flush surfaces as a recoverable JS TypeError. Report it and
    // exit cleanly so an abort (no message) or hang (timeout) is distinguishable.
    const report = e => { process.stdout.write("threw:" + e.constructor.name + ":" + e.message + "\\n"); process.exit(0); };
    c.on("error", report);
    process.on("uncaughtException", report);
    c.write(Buffer.from("the quick brown fox".repeat(64)));
    // Z_FINISH (4) is a valid zlib flush but out of Brotli's range.
    c.flush(zlib.constants.Z_FINISH);
    c.end();
  `;

  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  // Bound the wait: a regression that forwards the raw flush value to the encoder
  // hangs the child, which must fail this test rather than hang CI.
  const timer = setTimeout(() => proc.kill(), 10_000);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);

  // Recoverable JS error (not a native abort: no Rust panic text, exit 0).
  expect(stdout).toBe("threw:TypeError:Invalid flush value\n");
  expect(stderr).not.toContain("panic");
  expect(exitCode).toBe(0);
});

test("Brotli .flush() with a valid flush operation still compresses and round-trips", async () => {
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
    c.flush(zlib.constants.BROTLI_OPERATION_FLUSH);
    c.end();
  `;

  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), 10_000);
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  clearTimeout(timer);

  expect(stdout).toBe("roundtrip=true\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
