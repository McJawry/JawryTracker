// @ts-nocheck
// Ported as-is from the original vanilla-JS app (classic Worker script -
// importScripts/self aren't understood by TypeScript's DOM lib the way a
// module worker would be).
"use strict";

importScripts("sphere-engine.js");

self.addEventListener("message", (event) => {
  const { jobId, input } = event.data || {};
  try {
    const calculation = self.WWRSphereEngine.calculate(input);
    self.postMessage({ jobId, calculation });
  } catch (error) {
    self.postMessage({ jobId, error: error?.message || String(error) });
  }
});
