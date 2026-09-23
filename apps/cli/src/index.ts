#!/usr/bin/env node

import { startAutoCrop } from "./commands/start";
import { superviseAutoCrop } from "./commands/supervise";
import { resolveProjectRoot } from "./projectRoot";

const [, , command] = process.argv;

if (command === "start") {
  await startAutoCrop({
    projectRoot: resolveProjectRoot(),
    port: Number(process.env.AUTO_CROP_PORT ?? 0),
  });
} else if (command === "supervise") {
  // The worker runs as a child of this process, so a worker that dies is noticed by something that
  // did not die with it (ADR 0037).
  await superviseAutoCrop({ projectRoot: resolveProjectRoot() });
} else {
  console.log("Usage: auto-crop start | auto-crop supervise");
  process.exitCode = 1;
}

export { startAutoCrop, superviseAutoCrop };
