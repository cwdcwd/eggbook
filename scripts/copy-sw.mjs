import { copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const src = resolve(root, "node_modules/@pusher/push-notifications-web/dist/service-worker.js");
const dest = resolve(root, "public/service-worker.js");

copyFileSync(src, dest);
console.log("[copy-sw] Copied Beams service worker to public/");
