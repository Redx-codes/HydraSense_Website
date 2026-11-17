// Loads the browser logic files in node (the UMD file attaches itself to globalThis.HydraLogic).
globalThis.self = globalThis;
await import('../js/hydrasense-logic.js');
export const L = await import('../js/logic.js');
export const H = globalThis.HydraLogic;
