// CommonJS shim that registers the tsx require-hook so Node can resolve
// .ts imports inside the worker. The actual worker logic is in
// race-worker.ts.
require("tsx/cjs");
require("./race-worker.ts");
