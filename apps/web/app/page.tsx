"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createRoom, joinRoom, loginGuest } from "../lib/api";
import { useSessionStore } from "../store/session";

export default function HomePage() {
  const router = useRouter();
  const { token, user, setSession, clearSession } = useSessionStore();

  const [mounted, setMounted] = useState(false);
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setMounted(true);
  }, []);

  const userDisplay = useMemo(() => {
    if (!user) {
      return "未登录";
    }
    return `${user.name} (${user.id})`;
  }, [user]);

  if (!mounted) {
    return <main className="mx-auto max-w-4xl p-8">加载中...</main>;
  }

  const onLogin = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const session = await loginGuest(nickname.trim() || "Guest");
      setSession(session);
      setNickname("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  const onCreateRoom = async () => {
    if (!token) {
      setError("请先登录");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const room = await createRoom(token);
      router.push(`/room/${room.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建房失败");
    } finally {
      setLoading(false);
    }
  };

  const onJoinRoom = async () => {
    if (!token) {
      setError("请先登录");
      return;
    }
    if (!roomCode.trim()) {
      setError("请输入房间码");
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const code = roomCode.trim().toUpperCase();
      await joinRoom(token, code);
      router.push(`/room/${code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加入房间失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-6">
      <section className="rounded-2xl border border-orange-200 bg-orange-50/80 p-6 shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight">璀璨宝石对决 Online</h1>
        <p className="mt-2 text-sm text-gray-700">好友房 + 实时回合制 + 服务端裁判</p>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-amber-200 bg-[var(--card)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">1. 游客登录</h2>
          <p className="mt-2 text-sm text-gray-600">当前用户：{userDisplay}</p>
          <div className="mt-4 flex gap-2">
            <input
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2"
              value={nickname}
              maxLength={20}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="输入昵称（可选）"
            />
            <button
              className="rounded-lg bg-amber-600 px-4 py-2 text-white disabled:opacity-40"
              onClick={onLogin}
              disabled={loading}
            >
              登录
            </button>
          </div>
          <button
            className="mt-3 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            onClick={clearSession}
            disabled={loading}
          >
            清除本地会话
          </button>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-[var(--card)] p-5 shadow-sm">
          <h2 className="text-lg font-semibold">2. 创建或加入房间</h2>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-orange-600 px-4 py-2 text-white disabled:opacity-40"
              onClick={onCreateRoom}
              disabled={loading || !token}
            >
              创建房间
            </button>
            <button
              className="rounded-lg border border-gray-300 px-4 py-2"
              onClick={() => router.push("/history")}
              disabled={!token}
            >
              查看战绩
            </button>
          </div>

          <div className="mt-4 flex gap-2">
            <input
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 uppercase"
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value)}
              placeholder="输入房间码"
            />
            <button
              className="rounded-lg bg-gray-800 px-4 py-2 text-white disabled:opacity-40"
              onClick={onJoinRoom}
              disabled={loading || !token}
            >
              加入
            </button>
          </div>
        </div>
      </section>

      {error ? <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
    </main>
  );
}
