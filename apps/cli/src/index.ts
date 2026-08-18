#!/usr/bin/env node

import { startAutoCrop } from "./commands/start";
import { resolveProjectRoot } from "./projectRoot";

const [, , command] = process.argv;

if (command === "start") {
  await startAutoCrop({
    projectRoot: resolveProjectRoot(),
    port: Number(process.env.AUTO_CROP_PORT ?? 0),
  });
} else {
  console.log("Usage: auto-crop start");
  process.exitCode = 1;
}

export { startAutoCrop };
