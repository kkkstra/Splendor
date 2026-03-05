"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SessionStore {
  token?: string;
  user?: {
    id: string;
    name: string;
  };
  setSession: (session: { token: string; user: { id: string; name: string } }) => void;
  clearSession: () => void;
}

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      token: undefined,
      user: undefined,
      setSession: ({ token, user }) => {
        set({ token, user });
      },
      clearSession: () => {
        set({ token: undefined, user: undefined });
      },
    }),
    {
      name: "splendor-session",
    },
  ),
);
