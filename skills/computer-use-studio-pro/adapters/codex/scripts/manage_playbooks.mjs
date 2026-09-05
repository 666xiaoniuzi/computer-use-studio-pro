/** Inspect and maintain the local verified-playbook cache. */

import { openVerifiedPlaybookCache } from "./playbook_cache.mjs";

async function main() {
  const [command = "stats", value] = process.argv.slice(2);
  const cache = await openVerifiedPlaybookCache();
  let result;
  if (command === "stats") result = await cache.stats();
  else if (command === "list") result = await cache.list({ status: value || undefined });
  else if (command === "remove") result = await cache.remove(value);
  else if (command === "clear-retired") result = await cache.clearRetired();
  else throw new Error("用法：manage_playbooks.mjs stats | list [status] | remove <id> | clear-retired");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, reason: error.message }, null, 2));
  process.exit(1);
});
