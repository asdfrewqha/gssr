import { create } from "zustand";

export type GameStatus =
  | "waiting"
  | "round_active"
  | "guessing"
  | "round_results"
  | "game_over";

export interface Player {
  userId: string;
  username: string;
  avatarUrl?: string;
  elo: number;
  hasGuessed: boolean;
}

export interface RoundResult {
  userId: string;
  score: number;
  distance: number;
}

export interface FinalScore {
  userId: string;
  username: string;
  total: number;
}

export interface Guess {
  x: number;
  y: number;
  floorId: string;
}

interface GameState {
  roomId: string | null;
  mapId: string | null;
  status: GameStatus;
  players: Player[];
  currentRound: number;
  totalRounds: number;
  currentPanoId: string | null;
  myGuess: Guess | null;
  roundResults: RoundResult[];
  timeLimitSec: number;
  correctLocation: { x: number; y: number; floorId: string } | null;
  finalScores: FinalScore[] | null;

  setRoom: (roomId: string, mapId: string) => void;
  setStatus: (status: GameStatus) => void;
  setPlayers: (players: Player[]) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (userId: string) => void;
  setPlayerGuessed: (userId: string) => void;
  startRound: (round: number, panoId: string, timeLimitSec: number) => void;
  setMyGuess: (guess: Guess) => void;
  setRoundResults: (
    results: RoundResult[],
    correct: GameState["correctLocation"],
  ) => void;
  setFinalScores: (scores: FinalScore[]) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  roomId: null,
  mapId: null,
  status: "waiting",
  players: [],
  currentRound: 0,
  totalRounds: 5,
  currentPanoId: null,
  myGuess: null,
  roundResults: [],
  timeLimitSec: 60,
  correctLocation: null,
  finalScores: null,

  setRoom: (roomId, mapId) => set({ roomId, mapId }),
  setStatus: (status) => set({ status }),
  setPlayers: (players) => set({ players }),
  addPlayer: (player) => set((s) => ({ players: [...s.players, player] })),
  removePlayer: (userId) =>
    set((s) => ({ players: s.players.filter((p) => p.userId !== userId) })),
  setPlayerGuessed: (userId) =>
    set((s) => ({
      players: s.players.map((p) =>
        p.userId === userId ? { ...p, hasGuessed: true } : p,
      ),
    })),
  startRound: (round, panoId, timeLimitSec) =>
    set({
      currentRound: round,
      currentPanoId: panoId,
      timeLimitSec,
      myGuess: null,
      status: "round_active",
    }),
  setMyGuess: (guess) => set({ myGuess: guess }),
  setRoundResults: (roundResults, correctLocation) =>
    set({ roundResults, correctLocation, status: "round_results" }),
  setFinalScores: (finalScores) => set({ finalScores, status: "game_over" }),
  reset: () =>
    set({
      roomId: null,
      mapId: null,
      status: "waiting",
      players: [],
      currentRound: 0,
      currentPanoId: null,
      myGuess: null,
      roundResults: [],
      finalScores: null,
    }),
}));
