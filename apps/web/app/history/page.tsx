"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getHistory } from "../../lib/api";
import { useSessionStore } from "../../store/session";

interface HistoryItem {
  matchId: string;
  startedAt: string;
  endedAt: string;
  resultForMe: "WIN" | "LOSE";
  winCondition?: string;
}

export default function HistoryPage() {
  const router = useRouter();
  const { token } = useSessionStore();
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async (nextCursor?: string) => {
    if (!token) {
      router.replace("/");
      return;
    }

    setLoading(true);
    setError(undefined);
    try {
      const response = await getHistory(token, nextCursor);
      setItems((current) => (nextCursor ? [...current, ...response.items] : response.items));
      setCursor(response.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载战绩失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 p-6">
      <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
        <h1 className="text-2xl font-bold">我的战绩</h1>
      </div>

      <div className="flex gap-2">
        <button className="rounded border border-gray-300 px-3 py-1.5" onClick={() => router.push("/")}>返回首页</button>
        <button className="rounded border border-gray-300 px-3 py-1.5" onClick={() => void load()} disabled={loading}>
          刷新
        </button>
      </div>

      {error ? <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-red-700">{error}</p> : null}

      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.matchId} className="rounded-lg border border-amber-200 bg-[var(--card)] p-4">
            <p className="font-semibold">{item.resultForMe} - {item.matchId}</p>
            <p className="text-sm text-gray-600">开始: {item.startedAt}</p>
            <p className="text-sm text-gray-600">结束: {item.endedAt}</p>
            <p className="text-sm text-gray-600">胜利条件: {item.winCondition ?? "-"}</p>
          </li>
        ))}
      </ul>

      {cursor ? (
        <button className="rounded border border-gray-300 px-3 py-1.5" onClick={() => void load(cursor)} disabled={loading}>
          加载更多
        </button>
      ) : null}
    </main>
  );
}
