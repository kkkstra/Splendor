"use client";

import type { GameSnapshot, ProtocolError, RoomState } from "@splendor/shared";
import { create } from "zustand";

interface GameStore {
  room?: RoomState;
  snapshot?: GameSnapshot;
  protocolError?: ProtocolError;
  events: Array<Record<string, unknown>>;
  setRoom: (room?: RoomState) => void;
  setSnapshot: (snapshot?: GameSnapshot) => void;
  setProtocolError: (error?: ProtocolError) => void;
  pushEvent: (event: Record<string, unknown>) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  room: undefined,
  snapshot: undefined,
  protocolError: undefined,
  events: [],
  setRoom: (room) => set({ room }),
  setSnapshot: (snapshot) => set({ snapshot }),
  setProtocolError: (error) => set({ protocolError: error }),
  pushEvent: (event) => set((state) => ({ events: [event, ...state.events].slice(0, 30) })),
  reset: () => set({ room: undefined, snapshot: undefined, protocolError: undefined, events: [] }),
}));
