#!/usr/bin/env node

import { startAutoCrop } from "./commands/start";

const [, , command] = process.argv;

if (command === "start") {
  await startAutoCrop({
    projectRoot: process.cwd(),
    port: Number(process.env.AUTO_CROP_PORT ?? 0),
  });
} else {
  console.log("Usage: auto-crop start");
  process.exitCode = 1;
}

export { startAutoCrop };
