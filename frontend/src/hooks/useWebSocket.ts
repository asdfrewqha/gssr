import { useEffect, useRef, useCallback } from "react";
import { useGameStore } from "../store/gameStore";

type WSMessage = { event: string; payload?: unknown };

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useWebSocket(roomId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const attemptsRef = useRef(0);
  const store = useGameStore();

  const handleMessage = useCallback(
    (msg: WSMessage) => {
      switch (msg.event) {
        case "player_joined": {
          const p = msg.payload as Parameters<typeof store.addPlayer>[0];
          store.addPlayer(p);
          break;
        }
        case "player_left":
          store.removePlayer((msg.payload as { user_id: string }).user_id);
          break;
        case "round_started": {
          const { round, pano_id, time_limit_sec } = msg.payload as {
            round: number;
            pano_id: string;
            time_limit_sec: number;
          };
          store.startRound(round, pano_id, time_limit_sec);
          break;
        }
        case "guess_broadcast":
          store.setPlayerGuessed((msg.payload as { user_id: string }).user_id);
          break;
        case "round_ended": {
          const { scores, correct } = msg.payload as {
            scores: Array<{ user_id: string; score: number; distance: number }>;
            correct: { x: number; y: number; floor_id: string };
          };
          store.setRoundResults(
            scores.map((s) => ({
              userId: s.user_id,
              score: s.score,
              distance: s.distance,
            })),
            { x: correct.x, y: correct.y, floorId: correct.floor_id },
          );
          break;
        }
        case "game_ended":
          store.setStatus("game_over");
          break;
      }
    },
    [store],
  );

  const connect = useCallback(() => {
    if (!roomId) return;
    const wsUrl =
      (import.meta.env.VITE_WS_URL || `ws://${location.host}`) +
      `/ws/rooms/${roomId}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        handleMessage(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };

    ws.onclose = () => {
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** attemptsRef.current++,
        RECONNECT_MAX_MS,
      );
      setTimeout(connect, delay);
    };

    ws.onopen = () => {
      attemptsRef.current = 0;
    };
  }, [roomId, handleMessage]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
