// Picks the right router client for the configured host.
//
//   routerType "huawei" -> Huawei 5G CPE / HiLink API (Airtel 5G CPE Max 6, H362-383)
//   routerType "zlt"    -> ZLT X17U JSON API (the original Tally router)
//   routerType "auto"   -> detect on first use, then stick with the answer
//
// Every client exposes the same { sample(), probe() } interface.

import { createRouter as createZltRouter } from "./router.js";
import { createHuaweiRouter, looksLikeHuawei } from "./huawei.js";

export function createRouterFor(cfg, { onDetected } = {}) {
  const type = cfg.type || "auto";
  if (type === "huawei") return createHuaweiRouter(cfg);
  if (type === "zlt") return { ...createZltRouter(cfg), kind: "zlt" };

  let inner = null;
  const resolve = async () => {
    if (inner) return inner;
    const huawei = await looksLikeHuawei(cfg.host);
    inner = huawei ? createHuaweiRouter(cfg) : { ...createZltRouter(cfg), kind: "zlt" };
    onDetected?.(inner.kind);
    return inner;
  };

  return {
    kind: "auto",
    sample: async () => (await resolve()).sample(),
    probe: async () => (await resolve()).probe(),
  };
}
