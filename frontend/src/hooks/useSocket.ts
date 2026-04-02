import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useGameStore } from "../store/gameStore";

export function useSocket(roomId: string | null) {
  const socketRef = useRef<Socket | null>(null);

  // Use individual selectors so these references are stable (Zustand action
  // functions are created once and never change), preventing the useEffect
  // from re-running on every store update — which was the root cause of the
  // WS reconnect loop that removed players from Valkey room state.
  const addPlayer = useGameStore((s) => s.addPlayer);
  const removePlayer = useGameStore((s) => s.removePlayer);
  const startRound = useGameStore((s) => s.startRound);
  const setPlayerGuessed = useGameStore((s) => s.setPlayerGuessed);
  const setRoundResults = useGameStore((s) => s.setRoundResults);
  const setFinalScores = useGameStore((s) => s.setFinalScores);
  const setStatus = useGameStore((s) => s.setStatus);

  useEffect(() => {
    if (!roomId) return;

    // socket.io-client connects to the same origin by default (empty string).
    // In production VITE_WS_URL points to https://api.domain.com.
    const wsUrl = import.meta.env.VITE_WS_URL ?? "";
    const socket = io(wsUrl, {
      path: "/socket.io",
      // roomId is passed in the auth object so the server can join the socket
      // to the correct room on connection.
      auth: { roomId },
      // WebSocket-only transport: skip HTTP long-polling entirely.
      transports: ["websocket"],
      // Send cookies (HttpOnly access_token) with the handshake request.
      withCredentials: true,
    });

    socket.on(
      "player_joined",
      (d: { user_id: string; username: string; elo: number }) => {
        addPlayer({
          userId: d.user_id,
          username: d.username,
          elo: d.elo,
          hasGuessed: false,
        });
      },
    );

    socket.on("player_left", (d: { user_id: string }) => {
      removePlayer(d.user_id);
    });

    socket.on(
      "round_started",
      (d: { round: number; pano_id: string; time_limit_sec: number }) => {
        startRound(d.round, d.pano_id, d.time_limit_sec);
      },
    );

    socket.on("guess_broadcast", (d: { user_id: string }) => {
      setPlayerGuessed(d.user_id);
    });

    socket.on(
      "round_ended",
      (d: {
        scores: Array<{ user_id: string; score: number; distance: number }>;
        correct: { x: number; y: number; floor_id: string };
      }) => {
        setRoundResults(
          d.scores.map((s) => ({
            userId: s.user_id,
            score: s.score,
            distance: s.distance,
          })),
          { x: d.correct.x, y: d.correct.y, floorId: d.correct.floor_id },
        );
      },
    );

    socket.on(
      "game_ended",
      (d: {
        scores: Array<{ user_id: string; username: string; total: number }>;
      }) => {
        setFinalScores(
          (d.scores ?? []).map((s) => ({
            userId: s.user_id,
            username: s.username,
            total: s.total,
          })),
        );
      },
    );

    socketRef.current = socket;
    return () => {
      socket.disconnect();
    };
  }, [
    roomId,
    addPlayer,
    removePlayer,
    startRound,
    setPlayerGuessed,
    setRoundResults,
    setFinalScores,
    setStatus,
  ]);

  return socketRef;
}
