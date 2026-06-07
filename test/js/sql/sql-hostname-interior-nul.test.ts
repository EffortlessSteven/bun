// A `Bun.SQL` hostname with an interior NUL reaches `connect_group` -> `ZStr::as_cstr`,
// whose `&CStr` view forbids interior NULs: a debug build trips `as_cstr`'s `debug_assert!`
// and safe JS aborts (exit 132); release omits the assert and calls
// `CStr::from_bytes_with_nul_unchecked` on interior-NUL bytes (UB, host truncates). The fix
// rejects the hostname before the C boundary. Each case runs in a subprocess so the pre-fix
// debug abort is a nonzero exit, not a dead test runner. Red/green (debug build): hostname
// cases abort unpatched (no "null byte" line), pass patched. The `path` cases lock
// completeness: only the hostname reaches `as_cstr` (unix `path` -> `connect_unix` raw slice;
// user/pass/db -> wire writer), so a NUL there must not abort either.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function connectWithNul(adapter: "postgres" | "mysql", field: "hostname" | "path") {
  const opts: Record<string, unknown> = {
    adapter,
    hostname: "127.0.0.1",
    port: adapter === "postgres" ? 5432 : 3306,
    username: "u",
    password: "p",
    database: "d",
    max: 1,
    connectionTimeout: 1,
  };
  opts[field] = "a\0b";
  const script = `
    try {
      const sql = new Bun.SQL(${JSON.stringify(opts)});
      await sql.connect();
      console.log("settled: connected-unexpected");
    } catch (e) {
      console.log("settled: " + (e && e.message ? e.message : String(e)));
    }
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode };
}

const adapters = ["postgres", "mysql"] as const;

describe.concurrent("Bun.SQL hostname with an interior NUL is rejected, not a process abort", () => {
  test.each(adapters)("%s", async adapter => {
    const { stdout, exitCode } = await connectWithNul(adapter, "hostname");
    // Post-fix: a recoverable error is thrown -> exit 0 with the null-byte message.
    // Pre-fix: ZStr::as_cstr panics -> exit 132 and no "null byte" line.
    expect(stdout).toContain("null byte");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("Bun.SQL unix path with an interior NUL does not abort the process", () => {
  // Completeness guard: hostname is the only connection field that reaches the
  // `as_cstr` C-string conversion. A NUL in `path` must not panic the process.
  test.each(adapters)("%s", async adapter => {
    const { stdout, exitCode } = await connectWithNul(adapter, "path");
    // Reached JS and settled (a connect error, not a recoverable null-byte
    // rejection and not a process abort) — proves the NUL path ran to completion.
    expect(stdout).toContain("settled:");
    expect(stdout).not.toContain("null byte");
    expect(exitCode).toBe(0);
  });
});
