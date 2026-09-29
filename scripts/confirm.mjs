// Interactive guard for production operations: the operator must type the environment name.
import { createInterface } from "node:readline/promises";

const action = process.argv[2] ?? "this production operation";
if (process.env.CI === "true" && process.env.VORA_PRODUCTION_APPROVED === "true") {
  console.log(`CI approval present — proceeding with: ${action}`);
  process.exit(0);
}
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`${action}. Type "production" to continue: `);
rl.close();
if (answer.trim() !== "production") {
  console.error("Cancelled.");
  process.exit(1);
}
