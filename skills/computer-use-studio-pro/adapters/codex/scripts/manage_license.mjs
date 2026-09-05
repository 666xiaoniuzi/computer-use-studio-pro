/** Local activation/diagnostic utility. No network request is made. */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  AGREEMENT_VERSION,
  CURRENT_FINGERPRINT_VERSION,
  PRODUCT,
  PUBLIC_KEY_PEM,
  SKILL_VERSION,
  appDataDir,
  computeMachineCode,
  findLicensePath,
  findRevocationPath,
  loadRevocations,
  skillRootDir,
  verifyLicense,
  verifyRevocations,
} from "./license_check.mjs";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`读取 JSON 失败：${path}（${error.message}）`);
  }
}

function atomicInstall(source, destination) {
  const data = readFileSync(source);
  mkdirSync(appDataDir(), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, data);
  try {
    rmSync(destination, { force: true });
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function consentStatus() {
  const path = join(appDataDir(), "consent.json");
  if (!existsSync(path)) return { ok: false, path, reason: "尚未同意当前协议" };
  try {
    const value = readJson(path);
    const ok = value.product === PRODUCT && value.version === AGREEMENT_VERSION;
    return { ok, path, version: value.version, agreedAt: value.agreedAt, reason: ok ? null : "协议版本需要更新" };
  } catch (error) {
    return { ok: false, path, reason: error.message };
  }
}

function inspectLicense(path = findLicensePath()) {
  if (!path) return { ok: false, path: null, reason: "未找到 license.json" };
  try {
    const license = readJson(path);
    const fingerprintVersion = Number(
      license.fingerprintVersion ?? (license.version === 1 ? 1 : CURRENT_FINGERPRINT_VERSION),
    );
    const started = performance.now();
    const machineCode = computeMachineCode({ fingerprintVersion });
    const fingerprintMs = Math.round((performance.now() - started) * 100) / 100;
    const revocations = loadRevocations();
    if (!revocations.ok) return { ok: false, path, reason: revocations.reason, fingerprint_ms: fingerprintMs };
    const result = verifyLicense(license, machineCode, { revocations: revocations.manifest });
    return {
      ...result,
      path,
      licenseKey: license.licenseKey,
      licenseType: license.licenseType,
      fingerprintVersion,
      fingerprint_ms: fingerprintMs,
      expiresAt: license.expiresAt ?? null,
      revocations: revocations.path,
    };
  } catch (error) {
    return { ok: false, path, reason: error.message };
  }
}

function doctor() {
  const major = Number(process.versions.node.split(".")[0]);
  const requiredFiles = ["SKILL.md", "manifest.yaml", "用户协议.md", "隐私政策.md"];
  const files = Object.fromEntries(requiredFiles.map((name) => [name, existsSync(join(skillRootDir(), name))]));
  const consent = consentStatus();
  const license = inspectLicense();
  const result = {
    ok: major >= 18 && Object.values(files).every(Boolean) && consent.ok && license.ok,
    product: PRODUCT,
    skill_version: SKILL_VERSION,
    node: process.versions.node,
    node_ok: major >= 18,
    retail_key_injected: !PUBLIC_KEY_PEM.includes("__CUSPRO_PUBLIC_KEY__"),
    app_data: appDataDir(),
    files,
    consent,
    license,
  };
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

function activate(path) {
  if (!path || !existsSync(path)) throw new Error(`授权文件不存在：${path ?? ""}`);
  const license = readJson(path);
  const fingerprintVersion = Number(
    license.fingerprintVersion ?? (license.version === 1 ? 1 : CURRENT_FINGERPRINT_VERSION),
  );
  const machineCode = computeMachineCode({ fingerprintVersion });
  const revocations = loadRevocations();
  if (!revocations.ok) throw new Error(revocations.reason);
  const result = verifyLicense(license, machineCode, { revocations: revocations.manifest });
  if (!result.ok) throw new Error(result.reason);
  const destination = join(appDataDir(), "license.json");
  atomicInstall(path, destination);
  console.log(JSON.stringify({ ok: true, installed: destination, source: basename(path), licenseKey: license.licenseKey }, null, 2));
}

function installRevocations(path) {
  if (!path || !existsSync(path)) throw new Error(`吊销清单不存在：${path ?? ""}`);
  const manifest = readJson(path);
  const result = verifyRevocations(manifest);
  if (!result.ok) throw new Error(result.reason);
  const destination = join(appDataDir(), "revocations.json");
  atomicInstall(path, destination);
  console.log(JSON.stringify({ ok: true, installed: destination, generatedAt: manifest.generatedAt, revoked: manifest.revoked.length }, null, 2));
}

function printMachineCode(legacy = false) {
  const fingerprintVersion = legacy ? 1 : CURRENT_FINGERPRINT_VERSION;
  const started = performance.now();
  const machineCode = computeMachineCode({ fingerprintVersion });
  console.log(JSON.stringify({
    ok: true,
    machineCode,
    fingerprintVersion,
    elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
  }, null, 2));
}

function main() {
  const [command = "doctor", value] = process.argv.slice(2);
  if (command === "doctor" || command === "status") process.exitCode = doctor();
  else if (command === "machine-code") printMachineCode(process.argv.includes("--legacy"));
  else if (command === "activate") activate(value);
  else if (command === "install-revocations") installRevocations(value);
  else {
    console.log("用法：");
    console.log("  node manage_license.mjs doctor");
    console.log("  node manage_license.mjs machine-code [--legacy]");
    console.log("  node manage_license.mjs activate <license.json>");
    console.log("  node manage_license.mjs install-revocations <revocations.json>");
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({ ok: false, reason: error.message }, null, 2));
  process.exitCode = 1;
}
