import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ENTRYPOINT = "com.gentleman.ai-deck.sdPlugin/bin/plugin.js";
const LAUNCH_ERROR = "AI Deck launch parameter error.";
const TERMINATION_GRACE_MILLISECONDS = 50;
const ABSOLUTE_TIMEOUT_BUFFER_MILLISECONDS = 1_000;
const READY_STARTUP_TIMEOUT_MILLISECONDS = 2_000;

export function runRuntimeSmoke(entrypoint = ENTRYPOINT, timeoutMilliseconds = 3_000, readinessMarker, startupTimeoutMilliseconds = READY_STARTUP_TIMEOUT_MILLISECONDS) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entrypoint], { stdio: ["ignore", "ignore", "pipe"] });
    let output = "";
    let timedOut = false;
    let sentKill = false;
    let settled = false;
    let absoluteTimeoutError;
    let timeout;
    let graceTimeout;
    const startTerminationTimeout = () => {
      if (timeout !== undefined) return;
      timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      graceTimeout = setTimeout(() => {
        sentKill = true;
        child.kill("SIGKILL");
      }, TERMINATION_GRACE_MILLISECONDS);
      graceTimeout.unref();
      }, timeoutMilliseconds);
      timeout.unref();
    };
    const absoluteTimeoutMilliseconds = (readinessMarker === undefined ? 0 : startupTimeoutMilliseconds) + timeoutMilliseconds + TERMINATION_GRACE_MILLISECONDS + ABSOLUTE_TIMEOUT_BUFFER_MILLISECONDS;
    const absoluteTimeout = setTimeout(() => {
      sentKill = true;
      child.kill("SIGKILL");
      absoluteTimeoutError = new Error(`Runtime smoke absolute timeout after ${absoluteTimeoutMilliseconds}ms.`);
    }, absoluteTimeoutMilliseconds);
    absoluteTimeout.unref();
    const onData = (chunk) => {
      output += chunk;
      if (readinessMarker !== undefined && output.includes(readinessMarker)) startTerminationTimeout();
    };
    const onError = (error) => settle(error);
    const onClose = (code) => {
      if (absoluteTimeoutError !== undefined) return settle(absoluteTimeoutError);
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
    if (readinessMarker === undefined) startTerminationTimeout();
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await runRuntimeSmoke());
