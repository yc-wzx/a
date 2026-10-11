#!/usr/bin/env bash
# Change the entrance without replacing application images or migrating the database.
set -euo pipefail
test "$(id -u)" -eq 0
hostname="${1:?hostname required}"
public_ip="${2:?IPv4 required}"
revision="${3:?configuration revision required}"
[[ "$revision" =~ ^[0-9a-f]{40}$ ]]
node=/opt/agilecampus-runtime/node/bin/node
"$node" --input-type=module - "$hostname" "$public_ip" <<'JS'
import {isIP} from 'node:net';
import {resolve4} from 'node:dns/promises';
const [host, ip] = process.argv.slice(2);
if (isIP(ip) !== 4 || host !== `agilecampus-${ip.replaceAll('.', '-')}.sslip.io`) throw Error('Unexpected destination');
if (!(await resolve4(host)).includes(ip)) throw Error('DNS does not point to this server');
JS
cd /opt/agilecampus
test "$(git remote get-url origin)" = 'https://github.com/yc-wzx/agilecampus.git'
test -z "$(git status --porcelain --untracked-files=no)"
old_revision="$(git rev-parse HEAD)"
export APP_IMAGE="$("$node" -p 'JSON.parse(require("fs").readFileSync(".release.json","utf8")).image')"
export MIGRATE_IMAGE="$("$node" -p 'JSON.parse(require("fs").readFileSync(".release.json","utf8")).migrationImage')"
compose=(docker compose --project-name agilecampus --file docker-compose.prod.yml)
if "$node" -e 'const fs=require("fs"),{parseEnv}=require("util");process.exit(parseEnv(fs.readFileSync(".env","utf8")).SMALL_SERVER==="true"?0:1)'; then
  compose+=(--file docker-compose.2gb.yml)
fi
backup="/opt/agilecampus/.env.before-hostname-$(date -u +%Y%m%dT%H%M%SZ)"
install -m 600 .env "$backup"
changed=false
rollback() {
  result=$?
  if test "$result" -ne 0 && test "$changed" = true; then
    echo 'Entrance change failed; restoring the previous configuration.'
    install -m 600 "$backup" .env
    git checkout --detach "$old_revision"
    "${compose[@]}" --profile https up -d --no-build --pull never --no-deps --force-recreate app reminders edge
  fi
  exit "$result"
}
trap rollback EXIT
git fetch origin "$revision"
git checkout --detach "$revision"
changed=true
"$node" --input-type=module - "$hostname" "$public_ip" <<'JS'
import fs from 'node:fs';
import {parseEnv} from 'node:util';
const [host, ip] = process.argv.slice(2);
let text=fs.readFileSync('.env','utf8');
const before=parseEnv(text);
// Keep the old auth origin until the new certificate is publicly usable.
for (const [key,value] of Object.entries({DOMAIN:host,PUBLIC_IP:ip,CADDYFILE:'./deploy/Caddyfile.hostname'})) {
  const pattern=new RegExp(`^${key}=.*$`,'m');
  text=pattern.test(text)?text.replace(pattern,`${key}=${value}`):`${text.trimEnd()}\n${key}=${value}\n`;
}
const after=parseEnv(text);
for (const key of ['POSTGRES_PASSWORD','DATABASE_URL','AUTH_SECRET','CRON_SECRET']) if(after[key]!==before[key]) throw Error('Secret changed');
fs.writeFileSync('.env',text,{mode:0o600});
JS
"${compose[@]}" config --quiet
"${compose[@]}" --profile https up -d --no-build --pull never --no-deps --force-recreate edge
ready=false
for attempt in $(seq 1 50); do
  if curl --fail --silent --show-error --max-time 5 "https://$hostname/api/health" > /dev/null; then ready=true; break; fi
  sleep 3
done
test "$ready" = true
"$node" --input-type=module - "$hostname" <<'JS'
import fs from 'node:fs';
const host=process.argv[2];
let text=fs.readFileSync('.env','utf8');
for (const key of ['AUTH_URL','AGILECAMPUS_URL']) text=text.replace(new RegExp(`^${key}=.*$`,'m'),`${key}=https://${host}`);
fs.writeFileSync('.env',text,{mode:0o600});
JS
"$node" scripts/ops.mjs preflight
"${compose[@]}" up -d --no-build --pull never --no-deps --force-recreate app reminders
"$node" scripts/ops.mjs smoke
curl --fail --silent --show-error --retry 5 --retry-delay 2 --max-time 10 "https://$hostname/api/health"
curl --fail --silent --show-error --max-time 15 "https://$hostname/login" > /dev/null
"$node" --input-type=module - "$hostname" "$public_ip" "$revision" <<'JS'
import fs from 'node:fs';
const [hostname,publicIp,infrastructureRevision]=process.argv.slice(2);
const applicationRevision=JSON.parse(fs.readFileSync('.release.json','utf8')).revision;
fs.writeFileSync('.hostname.json',JSON.stringify({hostname,publicIp,infrastructureRevision,applicationRevision,appliedAt:new Date().toISOString()},null,2));
JS
printf '\nDNS entrance ready: https://%s\nApplication images and database retained.\n' "$hostname"
