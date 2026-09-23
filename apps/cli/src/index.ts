#!/usr/bin/env node

import { startAutoCrop } from "./commands/start";
import { superviseAutoCrop } from "./commands/supervise";
import { resolveProjectRoot } from "./projectRoot";

const [, , command] = process.argv;

if (command === "start" || command === "supervise") {
  let stopping = false;
  let running: Awaited<ReturnType<typeof superviseAutoCrop>> | undefined;
  const stop = () => {
    stopping = true;
    if (running) void running.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    running = await superviseAutoCrop({ projectRoot: resolveProjectRoot() });
    if (stopping) await running.close();
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
} else if (command === "__worker" && process.send && process.connected) {
  // IPC permission is sent only after the parent has durably recorded this child's PID.
  // Parent death removes permission to dispatch, including during asynchronous adapter detection.
  process.on("disconnect", () => process.exit(0));
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));
  const permitted = new Promise<void>((resolve) => {
    process.once("message", (message) => {
      if (message !== "worker-start" || !process.connected) process.exit(1);
      resolve();
    });
  });
  process.send("worker-ready");
  await permitted;
  await startAutoCrop({
    projectRoot: resolveProjectRoot(),
    port: Number(process.env.AUTO_CROP_PORT ?? 0),
  });
} else {
  console.log("Usage: auto-crop start | auto-crop supervise");
  process.exitCode = 1;
}

export { startAutoCrop, superviseAutoCrop };
