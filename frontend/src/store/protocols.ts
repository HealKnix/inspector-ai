import { create } from "zustand";

import { createSyntheticProtocol, mockProtocols } from "@/data/protocols";
import type { CreateProtocolInput, ProtocolRecord } from "@/types/protocols";

interface ProtocolStoreState {
  protocols: readonly ProtocolRecord[];
  createProtocol: (input: CreateProtocolInput) => ProtocolRecord;
}

function getNextCreatedProtocolId(
  protocols: readonly ProtocolRecord[],
): string {
  const ids = new Set(protocols.map((protocol) => protocol.id));
  let ordinal = 1;
  let candidate = `synthetic-demo-created-protocol-${ordinal}`;

  while (ids.has(candidate)) {
    ordinal += 1;
    candidate = `synthetic-demo-created-protocol-${ordinal}`;
  }

  return candidate;
}

export const useProtocolStore = create<ProtocolStoreState>((set, get) => ({
  protocols: [...mockProtocols],
  createProtocol: (input) => {
    const currentProtocols = get().protocols;
    const protocol = createSyntheticProtocol({
      ...input,
      id: getNextCreatedProtocolId(currentProtocols),
    });

    set({ protocols: [protocol, ...currentProtocols] });
    return protocol;
  },
}));
