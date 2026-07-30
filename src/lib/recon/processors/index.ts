import type { ProcessorAdapter } from "./adapter";
import { nusapayAdapter } from "./nusapay";
import { siamlinkAdapter } from "./siamlink";
import { mekongpayAdapter } from "./mekongpay";

/** Registry: adding a processor means adding one adapter file + one entry here. */
export const PROCESSOR_ADAPTERS: Record<string, ProcessorAdapter> = {
  [nusapayAdapter.code]: nusapayAdapter,
  [siamlinkAdapter.code]: siamlinkAdapter,
  [mekongpayAdapter.code]: mekongpayAdapter,
};

export const PROCESSOR_CODES = Object.keys(PROCESSOR_ADAPTERS);

export function getAdapter(processor: string): ProcessorAdapter {
  const adapter = PROCESSOR_ADAPTERS[processor?.toUpperCase?.() ?? ""];
  if (!adapter) {
    throw new Error(
      `Unknown processor "${processor}". Known: ${PROCESSOR_CODES.join(", ")}`,
    );
  }
  return adapter;
}

export type { ProcessorAdapter };