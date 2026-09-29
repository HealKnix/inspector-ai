import { create } from "zustand";

import type { ProtocolRecord } from "@/types/protocols";

interface ProtocolStoreState {
  protocols: readonly ProtocolRecord[];
}

export const useProtocolStore = create<ProtocolStoreState>(() => ({
  protocols: [],
}));
