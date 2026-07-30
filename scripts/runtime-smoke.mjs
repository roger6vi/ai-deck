import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENTRYPOINT = "com.gentleman.ai-deck.sdPlugin/bin/plugin.js";
const LAUNCH_ERROR = "AI Deck launch parameter error: Unable to establish a connection with Stream Deck, missing command line arguments:";
const TERMINATION_GRACE_MILLISECONDS = 50;
const ABSOLUTE_TIMEOUT_BUFFER_MILLISECONDS = 50;

export function runRuntimeSmoke(entrypoint = ENTRYPOINT, timeoutMilliseconds = 3_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], { stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    let timedOut = false;
    let sentKill = false;
    let settled = false;
    let graceTimeout;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      graceTimeout = setTimeout(() => {
        sentKill = true;
        child.kill("SIGKILL");
      }, TERMINATION_GRACE_MILLISECONDS);
      graceTimeout.unref();
    }, timeoutMilliseconds);
    const absoluteTimeout = setTimeout(() => {
      sentKill = true;
      child.kill("SIGKILL");
      settle(new Error(`Runtime smoke absolute timeout after ${timeoutMilliseconds + TERMINATION_GRACE_MILLISECONDS + ABSOLUTE_TIMEOUT_BUFFER_MILLISECONDS}ms.`));
    }, timeoutMilliseconds + TERMINATION_GRACE_MILLISECONDS + ABSOLUTE_TIMEOUT_BUFFER_MILLISECONDS);
    timeout.unref();
    absoluteTimeout.unref();
    const onData = (chunk) => { output += chunk; };
    const onError = (error) => settle(error);
    const onClose = (code) => {
      if (timedOut) return settle(new Error(`Runtime smoke timed out after ${timeoutMilliseconds}ms; sent ${sentKill ? "SIGKILL" : "SIGTERM"}.`));
      if (code === 0 || !output.includes(LAUNCH_ERROR)) {
        return settle(new Error(`Runtime smoke requires the launch error: code=${code}; output=${output.trim()}`));
      }
      settle(undefined, output.trim());
    };
    const settle = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(graceTimeout);
      clearTimeout(absoluteTimeout);
      child.stderr.off("data", onData);
      child.off("error", onError);
      child.off("close", onClose);
      if (error) reject(error); else resolve(result);
    };
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("close", onClose);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await runRuntimeSmoke());
