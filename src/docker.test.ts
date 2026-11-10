// Docker section: reading docker's own output, the commands behind each button, the Firefly
// III recipe run for real on copies of its files; and Troubleshoot reading sample
// answers (Ollama installed, its service stopped and disabled).
import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const answers = new Map<string, { code: number; stdout: string; stderr: string } | null>();
vi.mock("@/lib/host", () => ({
  errText: (e: unknown) => String(e),
  execRaw: async (cmd: string, args: string[]) => answers.get([cmd, ...args].join(" ")) ?? null,
  execOut: async (cmd: string, args: string[]) => {
    const r = answers.get([cmd, ...args].join(" "));
    return r && r.code === 0 ? r.stdout : null;
  },
  inv: async () => [],
  readText: async () => null,
  readDir: async () => [],
  httpGet: async () => null,
  openExternal: async () => {},
  saveTextFile: async () => null,
}));

const { hostPorts, parseContainers, assemble, appCommands, q, RECIPES, recipeCommand } = await import("@/lib/docker");
const { diagnoseOllama } = await import("@/lib/troubleshoot");
const { parseOllamaVersion } = await import("@/lib/ollama");

describe("reading docker", () => {
  it("host ports from the Ports column, IPv4 and IPv6 counted once", () => {
    expect(hostPorts("0.0.0.0:8080->8080/tcp, [::]:8080->8080/tcp, 3306/tcp")).toEqual([8080]);
    expect(hostPorts("")).toEqual([]);
  });

  it("groups containers into their compose apps; folders in ~/docker show even when never started", () => {
    const ps = [
      { Names: "firefly_iii_core", Image: "fireflyiii/core:latest", State: "running", Status: "Up 2 hours", Ports: "0.0.0.0:8080->8080/tcp", Labels: "com.docker.compose.project=firefly-iii,com.docker.compose.service=app" },
      { Names: "firefly_iii_db", Image: "mariadb:lts", State: "running", Status: "Up 2 hours", Ports: "3306/tcp", Labels: "com.docker.compose.project=firefly-iii" },
      { Names: "loner", Image: "nginx", State: "exited", Status: "Exited (0)", Ports: "", Labels: "" },
    ].map((j) => JSON.stringify(j)).join("\n");
    const s = assemble(
      [{ name: "firefly-iii", dir: "/h/docker/firefly-iii", file: "/h/docker/firefly-iii/compose.yml" }, { name: "My App", dir: "/h/docker/My App", file: "/h/docker/My App/compose.yml" }],
      [{ Name: "elsewhere", Status: "exited(1)", ConfigFiles: "/srv/elsewhere/compose.yaml" }],
      parseContainers(ps),
    );
    expect(s.apps.map((a) => [a.name, a.running, a.total, a.ports, a.file])).toEqual([
      ["elsewhere", 0, 0, [], "/srv/elsewhere/compose.yaml"],
      ["firefly-iii", 2, 2, [8080], "/h/docker/firefly-iii/compose.yml"],
      ["myapp", 0, 0, [], "/h/docker/My App/compose.yml"],
    ]);
    expect(s.loose.map((c) => c.name)).toEqual(["loner"]);
  });

  it("every button's command is plain docker compose on the app's own file, quoted", () => {
    const app = { name: "firefly-iii", file: "/h/docker/firefly-iii/compose.yml", dir: "/h/docker/firefly-iii", running: 0, total: 0, ports: [], containers: [] };
    const byId = Object.fromEntries(appCommands(app).map((c) => [c.id, c.command]));
    expect(byId.start).toBe("docker compose -f '/h/docker/firefly-iii/compose.yml' up -d");
    expect(byId.update).toBe("docker compose -f '/h/docker/firefly-iii/compose.yml' pull && docker compose -f '/h/docker/firefly-iii/compose.yml' up -d");
    expect(byId.down).not.toMatch(/-v\b/); // "keep data" really keeps the volumes
    expect(byId.purge).toMatch(/down -v --rmi all && rm -rf '\/h\/docker\/firefly-iii'$/);
    expect(() => q("/h/it's/compose.yml")).toThrow();
  });
});

describe("the Firefly III recipe", () => {
  const ff = RECIPES.find((r) => r.id === "firefly-iii")!;
  // the lines the recipe relies on, as Firefly III's own files have them
  const fixture = (dir: string, compose = "    ports:\n      - 80:8080\n") => {
    writeFileSync(join(dir, "compose.yml"), `services:\n  app:\n${compose}`);
    writeFileSync(join(dir, ".db.env"), "MYSQL_RANDOM_ROOT_PASSWORD=yes\nMYSQL_PASSWORD=secret_firefly_password\n");
    writeFileSync(join(dir, ".env"), "APP_KEY=SomeRandomStringOf32CharsExactly\nTZ=Europe/Amsterdam\nDB_PASSWORD=secret_firefly_password\nSTATIC_CRON_TOKEN=PLEASE_REPLACE_WITH_32_CHAR_CODE\nAPP_URL=http://localhost\n");
  };
  const run = (dir: string) => {
    try {
      return { ok: true, out: execFileSync("bash", ["-c", ff.script], { cwd: dir, encoding: "utf8" }) };
    } catch (e) {
      return { ok: false, out: String((e as { stdout?: string }).stdout ?? "") };
    }
  };

  it("fills in the secrets, the matching database password, the port and keeps the files private", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-ff-"));
    fixture(dir);
    expect(run(dir).ok).toBe(true);
    const env = readFileSync(join(dir, ".env"), "utf8");
    const db = readFileSync(join(dir, ".db.env"), "utf8");
    const val = (text: string, k: string) => text.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1] ?? "";
    expect(val(env, "APP_KEY")).toMatch(/^[0-9a-f]{32}$/);
    expect(val(env, "STATIC_CRON_TOKEN")).toMatch(/^[0-9a-f]{32}$/);
    expect(val(env, "APP_KEY")).not.toBe(val(env, "STATIC_CRON_TOKEN"));
    expect(val(env, "DB_PASSWORD")).toMatch(/^[0-9a-f]{32}$/);
    expect(val(db, "MYSQL_PASSWORD")).toBe(val(env, "DB_PASSWORD"));
    expect(val(env, "APP_URL")).toBe(`http://localhost:${ff.port}`);
    expect(val(env, "TZ")).not.toBe("Europe/Amsterdam");
    expect(readFileSync(join(dir, "compose.yml"), "utf8")).toContain(`- ${ff.port}:8080`);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
  });

  it("stops, changing nothing, when Firefly's files no longer look as expected", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-ff-"));
    fixture(dir, "    ports:\n      - 8000:8080\n");
    const before = readFileSync(join(dir, ".env"), "utf8");
    const r = run(dir);
    expect(r.ok).toBe(false);
    expect(r.out).toMatch(/changed since this recipe was written — nothing was started/);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(before);
  });

  it("refuses to set up over an existing one, and fetches from Firefly III's own repositories", () => {
    const cmd = recipeCommand(ff);
    expect(cmd).toMatch(/\[ ! -e compose\.yml \] \|\| \{ echo .*already set up/);
    expect(ff.files.every((f) => f.url.startsWith("https://raw.githubusercontent.com/firefly-iii/"))).toBe(true);
    expect(cmd.indexOf("curl")).toBeLessThan(cmd.indexOf("docker compose up"));
  });
});

describe("Troubleshoot Ollama", () => {
  it("reads the version even while the server is down", () => {
    expect(parseOllamaVersion("Warning: could not connect to a running Ollama instance\nWarning: client version is 0.40.11\n")).toBe("0.40.11");
    expect(parseOllamaVersion("ollama version is 0.40.11\n")).toBe("0.40.11");
  });

  it("installed, service stopped and disabled → the fix starts it now and at boot", async () => {
    answers.clear();
    answers.set("ollama --version", { code: 0, stdout: "Warning: could not connect to a running Ollama instance\nWarning: client version is 0.40.11\n", stderr: "" });
    answers.set("systemctl is-active ollama.service", { code: 3, stdout: "inactive\n", stderr: "" });
    answers.set("systemctl is-enabled ollama.service", { code: 1, stdout: "disabled\n", stderr: "" });
    answers.set("ollama list", { code: 1, stdout: "", stderr: "Error: could not connect to ollama server" });
    const d = await diagnoseOllama();
    expect(d.checks.map((c) => [c.id, c.ok])).toEqual([["installed", true], ["service", false]]);
    expect(d.checks[0].detail).toBe("0.40.11");
    expect(d.checks[1].fix?.command).toBe("sudo systemctl enable --now ollama.service");
  });
});
