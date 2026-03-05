import type { GameSnapshot, RoomState } from "@splendor/shared";
import { API_BASE_URL } from "./config";

interface GuestLoginResponse {
  user: {
    id: string;
    name: string;
  };
  token: string;
}

interface MatchDetailResponse {
  snapshot: GameSnapshot;
}

interface HistoryResponse {
  items: Array<{
    matchId: string;
    startedAt: string;
    endedAt: string;
    resultForMe: "WIN" | "LOSE";
    winCondition?: string;
  }>;
  nextCursor?: string;
}

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function loginGuest(nickname: string): Promise<GuestLoginResponse> {
  return request<GuestLoginResponse>("/auth/guest", {
    method: "POST",
    body: JSON.stringify({ nickname }),
  });
}

export async function createRoom(token: string): Promise<RoomState> {
  return request<RoomState>("/rooms", { method: "POST" }, token);
}

export async function joinRoom(token: string, roomCode: string): Promise<RoomState> {
  return request<RoomState>(`/rooms/${roomCode}/join`, { method: "POST" }, token);
}

export async function getRoom(token: string, roomCode: string): Promise<RoomState> {
  return request<RoomState>(`/rooms/${roomCode}`, {}, token);
}

export async function getMatch(token: string, matchId: string): Promise<MatchDetailResponse> {
  return request<MatchDetailResponse>(`/matches/${matchId}`, {}, token);
}

export async function getHistory(token: string, cursor?: string): Promise<HistoryResponse> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<HistoryResponse>(`/me/history${query}`, {}, token);
}
