import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { once } from "node:events";
import { parseEnv } from "node:util";
import { isIP } from "node:net";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const env = fs.existsSync(envPath)
  ? parseEnv(fs.readFileSync(envPath, "utf8").toString())
  : {};
const [operation, arg] = process.argv.slice(2);
const prefix = [
  "compose",
  "--project-name",
  "agilecampus",
  "--file",
  "docker-compose.prod.yml",
];
if (env.SMALL_SERVER === "true") prefix.push("--file", "docker-compose.2gb.yml");
function run(args, { input, capture = false, childEnv = process.env } = {}) {
  const result = spawnSync("docker", [...prefix, ...args], {
    cwd: root,
    env: childEnv,
    input,
    encoding: "utf8",
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
  });
  if (result.status !== 0 || result.error)
    throw Error(
      "Docker command failed; check service status (no credentials printed).",
    );
  return result.stdout?.trim() ?? "";
}
function git(args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw Error("Git command failed");
  return result.stdout.trim();
}
function preflight() {
  if (env.ATTACHMENT_STORAGE_DIR && env.ATTACHMENT_STORAGE_DIR !== "/app/storage/attachments")
    throw Error("Production attachments must use the mounted /app/storage/attachments directory");
  for (const key of ["AUTH_SECRET", "CRON_SECRET", "POSTGRES_PASSWORD"])
    if (!env[key] || env[key].length < 32 || env[key].includes("REPLACE"))
      throw Error(
        `${key} requires a generated value of at least 32 characters`,
      );
  if (
    new Set([env.AUTH_SECRET, env.CRON_SECRET, env.POSTGRES_PASSWORD]).size !==
    3
  )
    throw Error("Use three different secrets");
  if (!/^[A-Za-z0-9_-]+$/.test(env.POSTGRES_PASSWORD))
    throw Error("Use a URL-safe database password");
  const url = new URL(env.AGILECAMPUS_URL ?? "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.hostname.includes("YOUR_DOMAIN") ||
    url.username ||
    url.password
  )
    throw Error("Set the actual site URL");
  if (env.AUTH_URL !== url.origin)
    throw Error("AUTH_URL must equal the site origin");
  const database = new URL(env.DATABASE_URL ?? "");
  if (
    database.hostname !== "db" ||
    database.pathname !== "/" + (env.POSTGRES_DB ?? "agilecampus") ||
    decodeURIComponent(database.password) !== env.POSTGRES_PASSWORD
  )
    throw Error(
      "DATABASE_URL must match the compose database name, password and host",
    );
  if (url.protocol === "https:" && env.DOMAIN !== url.hostname)
    throw Error("DOMAIN must equal the site hostname");
  if (
    url.protocol === "https:" &&
    isIP(url.hostname) &&
    env.CADDYFILE !== "./deploy/Caddyfile.ip"
  )
    throw Error("Public IP HTTPS requires CADDYFILE=./deploy/Caddyfile.ip");
  if (
    env.CADDYFILE === "./deploy/Caddyfile.hostname" &&
    (url.protocol !== "https:" || isIP(url.hostname) || isIP(env.PUBLIC_IP ?? "") !== 4)
  )
    throw Error("DNS entrance requires an HTTPS hostname and PUBLIC_IP IPv4");
  run(["config", "--quiet"]);
  console.log("Preflight passed (secrets suppressed)");
}
const directory = path.join(root, "backups");
function fileDigest(filename) {
  const hash = createHash("sha256"), fd = fs.openSync(filename, "r"), buffer = Buffer.alloc(65536);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}
function backupFile(input) {
  const resolved = path.resolve(input);
  if (path.dirname(resolved) !== directory || !resolved.endsWith(".dump"))
    throw Error(
      "Choose a .dump file directly inside this checkout backups directory",
    );
  return resolved;
}
async function backup() {
  const startedAt = Date.now();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(
    directory,
    `agilecampus-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`,
  );
  const child = spawn(
    "docker",
    [
      ...prefix,
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "agilecampus",
      "-d",
      env.POSTGRES_DB ?? "agilecampus",
      "-Fc",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
  );
  const complete = once(child, "close");
  await pipeline(
    child.stdout,
    fs.createWriteStream(filename, { flags: "wx", mode: 0o600 }),
  );
  const [code] = await complete;
  if (code !== 0) throw Error("Backup failed; do not use the partial dump");
  const attachmentFile = filename + ".attachments.tar";
  const files = spawn("docker", [...prefix,"exec","-T","app","sh","-c",'set -e; if [ -d /app/storage/attachments ]; then tar -C /app/storage/attachments -cf - .; else empty=$(mktemp -d); tar -C "$empty" -cf - .; rmdir "$empty"; fi'], {cwd:root,stdio:["ignore","pipe","inherit"]});
  const filesComplete = once(files,"close");
  await pipeline(files.stdout,fs.createWriteStream(attachmentFile,{flags:"wx",mode:0o600}));
  const [filesCode] = await filesComplete;
  if(filesCode !== 0 || Date.now()-startedAt>=3600000) throw Error("Attachment backup failed or exceeded the one-hour deletion grace. Do not use this pair.");
  const attachmentHash = fileDigest(attachmentFile);
  const hash = fileDigest(filename);
  fs.writeFileSync(
    filename + ".json",
    JSON.stringify(
      {
        sha256: hash,
        revision: git(["rev-parse", "HEAD"]),
        database: env.POSTGRES_DB ?? "agilecampus",
        createdAt: new Date().toISOString(),
        sizeBytes: fs.statSync(filename).size,
        attachments: {filename:path.basename(attachmentFile),sha256:attachmentHash,sizeBytes:fs.statSync(attachmentFile).size},
        durationMs: Date.now() - startedAt,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(filename);
  return filename;
}
function restoreDrill(file) {
  const startedAt = Date.now();
  const filename = backupFile(file),
    manifest = JSON.parse(fs.readFileSync(filename + ".json", "utf8"));
  if (
    fileDigest(filename) !==
    manifest.sha256
  )
    throw Error("Backup checksum mismatch");
  const database = `agilecampus_restore_${Date.now()}`;
  // Always create a NEW database. Never restore over production or drop a volume.
  run(["exec", "-T", "db", "createdb", "-U", "agilecampus", database]);
  run(
    [
      "exec",
      "-T",
      "db",
      "pg_restore",
      "-U",
      "agilecampus",
      "-d",
      database,
      "--no-owner",
      "--exit-on-error",
    ],
    { input: fs.readFileSync(filename) },
  );
  const counts = run(
    [
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "agilecampus",
      "-d",
      database,
      "-At",
      "-c",
      "select 'users',count(*) from users union all select 'projects',count(*) from projects union all select 'tasks',count(*) from tasks union all select 'deliverable_versions',count(*) from deliverable_versions union all select 'comments',count(*) from task_comments union all select 'announcements',count(*) from announcements union all select 'migrations',count(*) from drizzle.__drizzle_migrations",
    ],
    { capture: true },
  );
  let restoredFiles = null;
  if(manifest.attachments){
    const archive=filename+".attachments.tar";
    if(manifest.attachments.filename!==path.basename(archive)||fileDigest(archive)!==manifest.attachments.sha256)throw Error("Attachment backup checksum mismatch");
    const inventory=spawnSync("tar",["-tf",archive],{encoding:"utf8"});
    if(inventory.status!==0||inventory.stdout.split(/\r?\n/).filter(Boolean).some(name=>!/^\.\/$/.test(name)&&!/^(?:\.\/)?[a-f0-9-]{36}(?:\.orphan)?$/.test(name)))throw Error("Unexpected path in attachment backup");
    const output=path.resolve(directory,`attachments-restore-${Date.now()}`);
    if(path.dirname(output)!==directory)throw Error("Restore destination must stay inside backups");
    fs.mkdirSync(output,{mode:0o700});
    const extracted=spawnSync("tar",["-xf",archive,"-C",output],{stdio:"inherit"});
    if(extracted.status!==0)throw Error("Attachment restore failed");
    const hasAttachments=run(["exec","-T","db","psql","-U","agilecampus","-d",database,"-At","-c","select to_regclass('public.project_attachments') is not null"],{capture:true})==="t";
    const records=hasAttachments?JSON.parse(run(["exec","-T","db","psql","-U","agilecampus","-d",database,"-At","-c","select coalesce(json_agg(json_build_object('key',storage_key,'digest',digest,'size',size)),'[]') from project_attachments where deleted_at is null"],{capture:true})):[];
    for(const record of records){if(!/^[a-f0-9-]{36}$/.test(record.key))throw Error("Invalid attachment storage key");const bytes=fs.readFileSync(path.join(output,record.key));if(bytes.length!==record.size||createHash("sha256").update(bytes).digest("hex")!==record.digest)throw Error("Restored attachment mismatch");}
    restoredFiles={directory:output,verified:records.length};
  }
  fs.writeFileSync(
    filename + ".restore.json",
    JSON.stringify(
      {
        database,
        counts,
        attachments:restoredFiles,
        verifiedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        note: "Independent restore only; compare representative business records before live recovery.",
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Restored independently to ${database}\n${counts}`);
}
async function smoke() {
  const port = Number(env.APP_PORT ?? 3080);
  for (let i = 0; i < 30; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        const login = await fetch(`http://127.0.0.1:${port}/login`, {
          signal: AbortSignal.timeout(4000),
        });
        if (login.ok) {
          console.log("Database health and login smoke checks passed");
          return;
        }
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw Error("Smoke checks failed; consult logs and rollback guide");
}
async function release() {
  if (arg && arg !== "--prebuilt") throw Error("Use release or release --prebuilt");
  preflight();
  if (git(["status", "--porcelain", "--untracked-files=no"]))
    throw Error("Commit tracked changes before release");
  const revision = git(["rev-parse", "HEAD"]);
  const marker = path.join(root, ".release.json");
  const old = fs.existsSync(marker)
    ? JSON.parse(fs.readFileSync(marker, "utf8"))
    : null;
  const tag = `agilecampus:release-${revision.slice(0, 12)}`;
  const migrationTag = `agilecampus:migrate-${revision.slice(0, 12)}`;
  const childEnv = {
    ...process.env,
    APP_IMAGE: tag,
    MIGRATE_IMAGE: migrationTag,
    SOURCE_REVISION: revision,
  };
  // Build a unique release image before stopping the running application.
  // Never rebuild a previous successful tag supplied through .env.
  if (arg === "--prebuilt") {
    // Validate both images before touching the live database/application.
    for (const image of [tag, migrationTag]) {
      const result = spawnSync(
        "docker",
        ["image", "inspect", image, "--format", '{{index .Config.Labels "org.opencontainers.image.revision"}}'],
        { cwd: root, encoding: "utf8" },
      );
      if (result.status !== 0 || result.error || result.stdout?.trim() !== revision)
        throw Error(`Missing or mismatched prebuilt image: ${image}`);
    }
  } else {
    run(["build", "app", "migrate"], { childEnv });
  }
  run(["up", "-d", "--wait", "db"]);
  await backup();
  if (old) run(["stop", "app", "reminders"]);
  run(["run", "--rm", "--pull", "never", "migrate"], { childEnv });
  run(["up", "-d", "--no-build", "app", "reminders"], { childEnv });
  await smoke();
  if (env.AGILECAMPUS_URL?.startsWith("https:"))
    run(["--profile", "https", "up", "-d", "--no-deps", "--force-recreate", "edge"], { childEnv });
  fs.writeFileSync(
    marker,
    JSON.stringify(
      {
        revision,
        image: tag,
        migrationImage: migrationTag,
        previousImage: old?.image ?? null,
        previousRevision: old?.revision ?? null,
        releasedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(`Released ${revision}`);
}
async function rollback(image) {
  if (!/^agilecampus:release-[0-9a-f]{12}$/.test(image ?? ""))
    throw Error("Supply a preserved agilecampus:release-<12 hex> image tag");
  const marker = JSON.parse(
    fs.readFileSync(path.join(root, ".release.json"), "utf8"),
  );
  if (marker.previousImage !== image && marker.image !== image)
    throw Error(
      "Only a recorded successful release can be restored automatically",
    );
  const childEnv = { ...process.env, APP_IMAGE: image };
  for (const args of [
    ["stop", "app", "reminders"],
    ["up", "-d", "--no-build", "--no-deps", "app", "reminders"],
  ]) {
    const result = spawnSync("docker", [...prefix, ...args], {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
    });
    if (result.status !== 0) throw Error("Rollback failed");
  }
  await smoke();
  fs.writeFileSync(
    path.join(root, ".release.json"),
    JSON.stringify(
      {
        revision:
          image === marker.image
            ? marker.revision
            : (marker.previousRevision ?? null),
        image,
        previousImage:
          image === marker.image ? marker.previousImage : marker.image,
        previousRevision:
          image === marker.image ? marker.previousRevision : marker.revision,
        releasedAt: marker.releasedAt,
        rolledBackAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(
    "Application rolled back; database was NOT reverted. Confirm schema compatibility.",
  );
}
try {
  switch (operation) {
    case "preflight":
      preflight();
      break;
    case "backup":
      await backup();
      break;
    case "restore-drill":
      restoreDrill(arg);
      break;
    case "smoke":
      await smoke();
      break;
    case "release":
      await release();
      break;
    case "rollback":
      await rollback(arg);
      break;
    case "status":
      run(["ps"]);
      break;
    default:
      throw Error(
        "Usage: node scripts/ops.mjs preflight|backup|restore-drill <dump>|smoke|release [--prebuilt]|rollback <image>|status",
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
