/**
 * Computer Use Studio Pro — 零售授权与协议同意门控（随零售包交付）。
 *
 * 职责：
 *  1. 首次运行前要求顾客明确同意《用户协议》与《隐私政策》；
 *  2. 计算本机机器码（硬件指纹哈希，不采集原始序列号明文）；
 *  3. 校验卖家签发的 license.json（Ed25519 签名 + 设备绑定 + 有效期）。
 *
 * 本文件由 build_retail.py 在打包时注入真实公钥并混淆后交付。
 * 私钥只存在于卖家手中，任何情况下不得交付。
 */

import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCT = "computer-use-studio-pro";
export const AGREEMENT_VERSION = "2026.01";
export const SKILL_VERSION = "0.8.0";
export const CURRENT_LICENSE_VERSION = 2;
export const CURRENT_FINGERPRINT_VERSION = 2;
export const PUBLIC_KEY_PEM = "__CUSPRO_PUBLIC_KEY__";

const SUPPORTED_LICENSE_VERSIONS = new Set([1, CURRENT_LICENSE_VERSION]);
const SUPPORTED_LICENSE_TYPES = new Set(["single-machine-perpetual", "single-machine-term"]);

const SKIP_NIC = /(virtual|vbox|vmware|vpn|tap|tun|docker|wsl|loopback|bluetooth|tailscale|zerotier|hyper-?v|vethernet|npcap)/i;

class GateError extends Error {
  constructor(message) {
    super(message);
    this.name = "LicenseGateError";
    this.isLicenseGate = true;
  }
}

// ---------- 路径 ----------

export function appDataDir() {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    return join(base, "ComputerUseStudioPro");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "ComputerUseStudioPro");
}

export function skillRootDir() {
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

function agreementPaths() {
  const root = skillRootDir();
  return { user: join(root, "用户协议.md"), privacy: join(root, "隐私政策.md") };
}

export function findLicensePath() {
  const candidates = [];
  if (process.env.CUSPRO_LICENSE) candidates.push(process.env.CUSPRO_LICENSE);
  candidates.push(join(appDataDir(), "license.json"));
  candidates.push(join(skillRootDir(), "license.json"));
  return candidates.find((p) => existsSync(p)) || null;
}

export function findRevocationPath() {
  const candidates = [];
  if (process.env.CUSPRO_REVOCATIONS) candidates.push(process.env.CUSPRO_REVOCATIONS);
  candidates.push(join(appDataDir(), "revocations.json"));
  candidates.push(join(skillRootDir(), "revocations.json"));
  return candidates.find((p) => existsSync(p)) || null;
}

// ---------- 机器指纹 ----------

function runQuiet(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout: 10000 }).trim();
  } catch {
    return "";
  }
}

function readWindowsMachineGuid() {
  if (process.platform !== "win32") return "";
  const out = runQuiet("reg", ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"]);
  const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/);
  return match ? match[1].toLowerCase() : "";
}

function readCpuId() {
  if (process.platform !== "win32") return "";
  const out = runQuiet("powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    "(Get-CimInstance Win32_Processor | Select-Object -First 1).ProcessorId",
  ]);
  return (out.split(/\r?\n/)[0] || "").trim().toLowerCase();
}

function readLinuxMachineId() {
  if (process.platform !== "linux") return "";
  try {
    return readFileSync("/etc/machine-id", "utf8").trim().toLowerCase();
  } catch {
    return "";
  }
}

function readMacHardwareUuid() {
  if (process.platform !== "darwin") return "";
  const out = runQuiet("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const match = out.match(/"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f-]{36})"/);
  return match ? match[1].toLowerCase() : "";
}

function readPrimaryMac() {
  const candidates = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (SKIP_NIC.test(name)) continue;
    for (const addr of addrs || []) {
      if (addr.mac && addr.mac !== "00:00:00:00:00:00" && !addr.internal) {
        candidates.push(addr.mac.toUpperCase());
      }
    }
  }
  candidates.sort();
  return candidates[0] || "";
}

function platformStableId() {
  return readWindowsMachineGuid() || readLinuxMachineId() || readMacHardwareUuid();
}

/**
 * 计算本机机器码。v2 优先使用操作系统稳定设备标识，避免网卡变化并移除
 * Windows PowerShell/CIM 热路径；旧许可证仍可通过 v1 兼容模式校验。
 */
export function computeMachineCode(options = {}) {
  const fingerprintVersion = Number(options.fingerprintVersion ?? CURRENT_FINGERPRINT_VERSION);
  if (![1, CURRENT_FINGERPRINT_VERSION].includes(fingerprintVersion)) {
    throw new Error(`unsupported fingerprint version: ${fingerprintVersion}`);
  }
  const stableId = platformStableId();
  const parts = fingerprintVersion === 1
    ? [stableId, readCpuId(), readPrimaryMac()]
    : [stableId || readCpuId() || readPrimaryMac(), `${process.platform}:${process.arch}`];
  if (!parts.some(Boolean)) throw new Error("no stable machine identifier is available");
  const normalized = parts.map((s) => String(s ?? "").trim().toLowerCase());
  const hashInput = fingerprintVersion === 1
    ? normalized.join("|") // Preserve the exact pre-0.8.0 machine-code algorithm.
    : `v${fingerprintVersion}|${normalized.join("|")}`;
  const hash = createHash("sha256").update(hashInput).digest("hex");
  return "CUSP-" + hash.slice(0, 32).toUpperCase().match(/.{1,4}/g).join("-");
}

// ---------- 授权校验 ----------

const LICENSE_FIELDS = [
  "product", "version", "licenseKey", "licensee", "orderId",
  "licenseType", "fingerprintVersion", "machineCode", "issuedAt", "expiresAt",
  "minSkillVersion", "maxSkillVersion",
];

const REVOCATION_FIELDS = ["product", "version", "generatedAt", "revoked"];

export function canonicalPayload(license) {
  const out = {};
  for (const field of LICENSE_FIELDS) {
    if (license[field] !== undefined && license[field] !== null) out[field] = license[field];
  }
  return JSON.stringify(out);
}

function canonicalRevocations(manifest) {
  const out = {};
  for (const field of REVOCATION_FIELDS) {
    if (manifest?.[field] !== undefined && manifest?.[field] !== null) out[field] = manifest[field];
  }
  return JSON.stringify(out);
}

function semverParts(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function expiryTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (dateOnly) {
    const [, year, month, day] = dateOnly.map(Number);
    const calendar = new Date(Date.UTC(year, month - 1, day));
    if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) {
      return Number.NaN;
    }
  }
  const normalized = dateOnly ? `${value}T23:59:59.999+08:00` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function verifyRevocations(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { ok: false, reason: "吊销清单格式无效" };
  }
  if (manifest.product !== PRODUCT || manifest.version !== 1 || !Array.isArray(manifest.revoked)) {
    return { ok: false, reason: "吊销清单与本产品或格式版本不符" };
  }
  if (!Number.isFinite(Date.parse(manifest.generatedAt))) return { ok: false, reason: "吊销清单生成时间无效" };
  if (typeof manifest.sig !== "string" || !manifest.sig) return { ok: false, reason: "吊销清单缺少签名" };
  for (const item of manifest.revoked) {
    if (!item || typeof item.licenseKey !== "string" || !item.licenseKey
        || !Number.isFinite(Date.parse(item.revokedAt))) {
      return { ok: false, reason: "吊销清单包含无效记录" };
    }
  }
  try {
    const key = createPublicKey(PUBLIC_KEY_PEM);
    const ok = verify(
      null,
      Buffer.from(canonicalRevocations(manifest), "utf8"),
      key,
      Buffer.from(manifest.sig, "base64"),
    );
    return ok ? { ok: true } : { ok: false, reason: "吊销清单签名无效" };
  } catch {
    return { ok: false, reason: "吊销清单验证失败" };
  }
}

export function loadRevocations() {
  const path = findRevocationPath();
  if (!path) return { ok: true, path: null, manifest: null };
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const result = verifyRevocations(manifest);
    return { ...result, path, manifest };
  } catch {
    return { ok: false, path, manifest: null, reason: "吊销清单读取失败" };
  }
}

export function verifyLicense(license, machineCode, options = {}) {
  if (!license || typeof license !== "object") return { ok: false, reason: "授权文件格式无效" };
  if (license.product !== PRODUCT) return { ok: false, reason: "授权文件与本产品不符" };
  if (!SUPPORTED_LICENSE_VERSIONS.has(license.version)) return { ok: false, reason: "授权格式版本不受支持" };
  if (!SUPPORTED_LICENSE_TYPES.has(license.licenseType)) return { ok: false, reason: "授权类型无效" };
  if (license.version >= 2 && (license.fingerprintVersion === undefined || license.fingerprintVersion === null)) {
    return { ok: false, reason: "新版授权缺少机器码版本" };
  }
  const fingerprintVersion = Number(license.fingerprintVersion ?? 1);
  if (![1, CURRENT_FINGERPRINT_VERSION].includes(fingerprintVersion)) return { ok: false, reason: "机器码版本不受支持" };
  if (typeof license.licenseKey !== "string" || !license.licenseKey) return { ok: false, reason: "授权文件缺少授权编号" };
  if (!Number.isFinite(Date.parse(license.issuedAt))) return { ok: false, reason: "授权签发时间无效" };
  if (typeof license.sig !== "string" || !license.sig) return { ok: false, reason: "授权文件缺少签名" };
  if (machineCode && license.machineCode !== machineCode) return { ok: false, reason: "授权与当前设备不匹配" };
  if (license.licenseType === "single-machine-term" && !license.expiresAt) return { ok: false, reason: "限时授权缺少到期时间" };
  const expiresAt = license.expiresAt ? expiryTimestamp(license.expiresAt) : null;
  if (Number.isNaN(expiresAt)) return { ok: false, reason: "授权到期时间无效" };
  if (expiresAt != null && expiresAt < Number(options.now ?? Date.now())) return { ok: false, reason: "授权已到期，请联系卖家续费" };
  const minVersionComparison = license.minSkillVersion
    ? compareSemver(SKILL_VERSION, license.minSkillVersion)
    : null;
  if (license.minSkillVersion && minVersionComparison === null) {
    return { ok: false, reason: "授权最低技能版本格式无效" };
  }
  if (minVersionComparison === -1) {
    return { ok: false, reason: `当前技能版本低于授权要求 ${license.minSkillVersion}` };
  }
  const maxVersionComparison = license.maxSkillVersion
    ? compareSemver(SKILL_VERSION, license.maxSkillVersion)
    : null;
  if (license.maxSkillVersion && maxVersionComparison === null) {
    return { ok: false, reason: "授权最高技能版本格式无效" };
  }
  if (maxVersionComparison === 1) {
    return { ok: false, reason: `当前技能版本高于授权允许范围 ${license.maxSkillVersion}` };
  }
  try {
    const key = createPublicKey(PUBLIC_KEY_PEM);
    const ok = verify(
      null,
      Buffer.from(canonicalPayload(license), "utf8"),
      key,
      Buffer.from(license.sig, "base64"),
    );
    if (!ok) return { ok: false, reason: "签名无效，授权文件可能被篡改" };
    const revocations = options.revocations;
    if (revocations?.revoked?.some((item) => item.licenseKey === license.licenseKey)) {
      return { ok: false, reason: "授权已被吊销，请联系卖家" };
    }
    return { ok: true, fingerprintVersion, expiresAt };
  } catch {
    return { ok: false, reason: "授权验证失败" };
  }
}

// ---------- 提示文案 ----------

function consentGateMessage() {
  const { user, privacy } = agreementPaths();
  const root = skillRootDir();
  return [
    "",
    "【Computer Use Studio Pro · 需要先同意协议】",
    `请先阅读以下两份文件：`,
    `  1. ${user}`,
    `  2. ${privacy}`,
    "",
    "阅读并同意后，在终端运行下面这条命令完成确认：",
    `  node "${join(root, "adapters", "codex", "scripts", "agree_consent.mjs")}" 同意`,
    "",
    "（不同意则无法使用本产品；同意后无需重复确认，除非协议更新。）",
    "",
  ].join("\n");
}

function noLicenseMessage(machineCode) {
  return [
    "",
    "【Computer Use Studio Pro · 需要激活授权】",
    "未找到有效的 license.json。",
    "",
    `您的机器码是：`,
    `  ${machineCode}`,
    "",
    "请把这段机器码发送给卖家，卖家会返回给您一个 license.json 文件，",
    `然后把它放到下面任一位置即可激活：`,
    `  1. ${join(appDataDir(), "license.json")}`,
    `  2. ${join(skillRootDir(), "license.json")}`,
    "",
  ].join("\n");
}

function invalidLicenseMessage(licensePath, machineCode, reason) {
  return [
    "",
    "【Computer Use Studio Pro · 授权无效】",
    `原因：${reason}`,
    `文件：${licensePath}`,
    "",
    `当前机器码：${machineCode}`,
    "请把机器码和此提示发送给卖家重新签发。",
    "",
  ].join("\n");
}

// ---------- 门控 ----------

let gateCache = null;

export function enforceRuntimeGate() {
  if (gateCache && gateCache.ok) return gateCache;

  // 开发模式：源码仓库未注入公钥（占位符还在）时不拦截，
  // 保证 MIT 开源版在仓库里可直接运行。零售包构建时占位符会被真实公钥替换，
  // 此分支在交付件中不存在。
  if (PUBLIC_KEY_PEM.includes("__CUSPRO_PUBLIC_KEY__")) {
    gateCache = { ok: true, dev: true };
    return gateCache;
  }

  // 1) 协议同意
  const consentPath = join(appDataDir(), "consent.json");
  let consent = null;
  if (existsSync(consentPath)) {
    try {
      consent = JSON.parse(readFileSync(consentPath, "utf8"));
    } catch {
      consent = null;
    }
  }
  if (!consent || consent.product !== PRODUCT || consent.version !== AGREEMENT_VERSION) {
    throw new GateError(consentGateMessage());
  }

  // 2) 授权文件。先读取格式版本，再选择兼容的机器码算法；新授权不进入 PowerShell/CIM 热路径。
  const licensePath = findLicensePath();
  if (!licensePath) throw new GateError(noLicenseMessage(computeMachineCode()));

  let license = null;
  try {
    license = JSON.parse(readFileSync(licensePath, "utf8"));
  } catch {
    license = null;
  }
  const fingerprintVersion = Number(
    license?.fingerprintVersion ?? (license?.version === 1 ? 1 : CURRENT_FINGERPRINT_VERSION),
  );
  let machineCode;
  try {
    machineCode = computeMachineCode({ fingerprintVersion });
  } catch {
    machineCode = computeMachineCode();
  }
  const revocations = loadRevocations();
  if (!revocations.ok) throw new GateError(invalidLicenseMessage(licensePath, machineCode, revocations.reason));
  const result = verifyLicense(license, machineCode, { revocations: revocations.manifest });
  if (!result.ok) throw new GateError(invalidLicenseMessage(licensePath, machineCode, result.reason));

  gateCache = { ok: true, license, machineCode };
  return gateCache;
}

/** 轻量冗余校验：供高频函数调用，首次通过后为纯内存判断，几乎零开销。 */
export function assertLicensed() {
  enforceRuntimeGate();
}
