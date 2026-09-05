/**
 * Computer Use Studio Pro — 协议同意 + 机器码工具（随零售包交付）。
 *
 * 用法：
 *   node agree_consent.mjs 同意       ← 同意协议，并显示你的机器码
 *   node agree_consent.mjs --status   ← 查看同意状态，并显示机器码
 *   node agree_consent.mjs           ← 只显示机器码（不写同意记录）
 *
 * 同意记录只写入本机（不联网、不上传）。机器码是匿名硬件指纹哈希，用于授权绑定。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AGREEMENT_VERSION,
  CURRENT_FINGERPRINT_VERSION,
  PRODUCT,
  appDataDir,
  computeMachineCode,
} from "./license_check.mjs";

const CONSENT_PATH = join(appDataDir(), "consent.json");

function readConsent() {
  try {
    return JSON.parse(readFileSync(CONSENT_PATH, "utf8"));
  } catch {
    return null;
  }
}

function printMachineCode() {
  try {
    const code = computeMachineCode({ fingerprintVersion: CURRENT_FINGERPRINT_VERSION });
    console.log();
    console.log("您的机器码是：");
    console.log(`  ${code}`);
    console.log(`  机器码版本：v${CURRENT_FINGERPRINT_VERSION}（稳定设备标识）`);
    console.log();
    console.log("请把这段机器码发给卖家，卖家会回您一个 license.json 文件。");
    console.log("收到后把它放到下面任一位置即可激活：");
    console.log(`  1. ${join(appDataDir(), "license.json")}`);
    console.log("  2. 技能根目录（computer-use-studio-pro 文件夹）下的 license.json");
    return code;
  } catch (error) {
    console.log("[提示] 机器码计算失败，请把下面这段发给卖家：");
    console.log(String(error && error.message ? error.message : error));
    return null;
  }
}

function main() {
  const arg = process.argv[2];

  if (arg === "--status") {
    const consent = readConsent();
    if (consent && consent.product === PRODUCT && consent.version === AGREEMENT_VERSION) {
      console.log(`已同意（协议版本 ${consent.version}，同意时间 ${consent.agreedAt}）`);
      printMachineCode();
      process.exit(0);
    }
    console.log("尚未同意当前版本的《用户协议》与《隐私政策》。");
    printMachineCode();
    process.exit(1);
  }

  if (arg !== "同意") {
    console.log("用法: node agree_consent.mjs 同意     ← 确认同意并显示机器码");
    console.log("      node agree_consent.mjs --status ← 查看同意状态并显示机器码");
    console.log();
    console.log("在运行“同意”之前，请先阅读技能根目录下的《用户协议.md》和《隐私政策.md》。");
    console.log();
    printMachineCode();
    process.exit(0);
  }

  mkdirSync(appDataDir(), { recursive: true });
  const record = {
    product: PRODUCT,
    version: AGREEMENT_VERSION,
    agreedAt: new Date().toISOString(),
  };
  writeFileSync(CONSENT_PATH, JSON.stringify(record, null, 2) + "\n", "utf8");
  console.log("已完成同意确认。同意记录仅保存在本机：");
  console.log(`  ${CONSENT_PATH}`);
  printMachineCode();
}

main();
