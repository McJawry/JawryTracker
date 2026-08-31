// @ts-nocheck
// Module worker rather than a classic one.
//
// It used to be `importScripts("sphere-engine.js")`, which resolves relative
// to the worker's own URL. That works in dev, where both files sit in
// src/lib/logic/, but a production build emits the worker to
// _app/immutable/workers/ and the engine is bundled elsewhere - so every
// packaged build threw "Failed to execute 'importScripts'" the instant the
// worker started. The client's error handler then fell back to running
// calculate() on the main thread, which is why released builds froze for
// seconds on a click while `tauri dev` felt fine.
//
// A static import lets the bundler put the engine inside the worker chunk, so
// there is nothing to resolve at runtime.
import "./sphere-engine.js";

self.addEventListener("message", (event) => {
  const { jobId, input } = event.data || {};
  try {
    const calculation = self.WWRSphereEngine.calculate(input);
    self.postMessage({ jobId, calculation });
  } catch (error) {
    self.postMessage({ jobId, error: error?.message || String(error) });
  }
});
