import type { ProtocolResponse } from "@/api/types/verification";

export function protocolIsCurrent(response: ProtocolResponse | undefined) {
  if (!response?.protocol) return false;
  if (response.protocol.status === "superseded") return false;
  if (response.is_current !== undefined) return response.is_current;
  if (response.protocol.is_current !== undefined)
    return response.protocol.is_current;
  const run = response.protocol.run_id ?? response.run_id;
  return !(run && response.current_run_id && run !== response.current_run_id);
}
