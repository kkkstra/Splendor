"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { getRoom, joinRoom } from "../../../lib/api";
import { createGameSocket } from "../../../lib/socket";
import { useGameStore } from "../../../store/game";
import { useSessionStore } from "../../../store/session";

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = String(params.code ?? "").toUpperCase();

  const { token, user } = useSessionStore();
  const { room, setRoom, setSnapshot, setProtocolError } = useGameStore();

  const socketRef = useRef<Socket | null>(null);
  const [loading, setLoading] = useState(true);
  const [localError, setLocalError] = useState<string>();

  const myEntry = useMemo(() => room?.players.find((player) => player.userId === user?.id), [room, user?.id]);

  useEffect(() => {
    if (!token) {
      router.replace("/");
      return;
    }

    let canceled = false;

    const bootstrap = async () => {
      setLoading(true);
      setLocalError(undefined);

      try {
        await joinRoom(token, code);
        const current = await getRoom(token, code);
        if (canceled) {
          return;
        }
        setRoom(current);
      } catch (error) {
        if (canceled) {
          return;
        }
        setLocalError(error instanceof Error ? error.message : "加载房间失败");
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      canceled = true;
    };
  }, [code, router, setRoom, token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const socket = createGameSocket(token);
    socketRef.current = socket;

    socket.on("room.state", (nextRoom) => {
      if (String(nextRoom?.code ?? "").toUpperCase() !== code) {
        return;
      }
      setRoom(nextRoom);
      if (nextRoom.matchId) {
        router.replace(`/match/${nextRoom.matchId}`);
      }
    });

    socket.on("match.snapshot", (snapshot) => {
      if (snapshot?.matchId) {
        setSnapshot(snapshot);
        router.replace(`/match/${snapshot.matchId}`);
      }
    });

    socket.on("match.error", (error) => {
      setProtocolError(error);
    });

    socket.emit("room.subscribe", { roomCode: code });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [code, router, setProtocolError, setRoom, setSnapshot, token]);

  const onToggleReady = () => {
    if (!socketRef.current || !myEntry) {
      return;
    }

    socketRef.current.emit("room.ready", {
      roomCode: code,
      ready: !myEntry.ready,
    });
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-5 p-6">
      <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <h1 className="text-2xl font-bold">房间 {code}</h1>
        <p className="text-sm text-gray-700">等待双方准备后自动开局</p>
      </div>

      {loading ? <p>加载中...</p> : null}
      {localError ? <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-red-700">{localError}</p> : null}

      <section className="rounded-2xl border border-amber-200 bg-[var(--card)] p-5">
        <h2 className="mb-3 text-lg font-semibold">玩家列表</h2>
        <div className="grid gap-2">
          {room?.players.map((player) => (
            <div key={player.userId} className="flex items-center justify-between rounded-lg border border-amber-200 bg-white px-3 py-2">
              <div>
                <p className="font-medium">{player.name}</p>
                <p className="text-xs text-gray-500">{player.userId}</p>
              </div>
              <div className="text-right text-sm">
                <p className={player.ready ? "text-green-700" : "text-gray-600"}>{player.ready ? "已准备" : "未准备"}</p>
                <p className={player.connected ? "text-green-700" : "text-red-600"}>{player.connected ? "在线" : "离线"}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-2">
          <button className="rounded-lg bg-orange-600 px-4 py-2 text-white" onClick={onToggleReady}>
            {myEntry?.ready ? "取消准备" : "我已准备"}
          </button>
          <button className="rounded-lg border border-gray-300 px-4 py-2" onClick={() => router.push("/")}>返回首页</button>
        </div>
      </section>
    </main>
  );
}
