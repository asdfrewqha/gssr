package room

// RoomState is stored as JSON in Valkey under key "room:{id}".
type RoomState struct {
	ID           string            `json:"id"`
	HostID       string            `json:"host_id"`
	MapID        string            `json:"map_id"`
	Players      []Player          `json:"players"`
	Status       string            `json:"status"` // waiting|active|finished
	MaxPlayers   int               `json:"max_players"`
	Rounds       int               `json:"rounds"`
	TimeLimitSec int               `json:"time_limit_sec"`
	CurrentRound  int              `json:"current_round"`
	CurrentPanoID string           `json:"current_pano_id,omitempty"`
	// RoundToken is regenerated each round to prevent double-advance races.
	RoundToken    string           `json:"round_token,omitempty"`
	PanoIDs       []string         `json:"pano_ids"`
	// Guesses maps userID → guess for the current round.
	Guesses       map[string]Guess `json:"guesses"`
	MatchID       string           `json:"match_id,omitempty"`
}

// RoomView is the public representation of a room sent to clients.
// Internal fields (guesses, round_token, pano_ids, match_id, current_pano_id)
// are omitted to prevent data leaks between players.
type RoomView struct {
	ID           string   `json:"id"`
	HostID       string   `json:"host_id"`
	MapID        string   `json:"map_id"`
	Players      []Player `json:"players"`
	Status       string   `json:"status"`
	MaxPlayers   int      `json:"max_players"`
	Rounds       int      `json:"rounds"`
	TimeLimitSec int      `json:"time_limit_sec"`
	CurrentRound int      `json:"current_round"`
}

type Player struct {
	UserID     string `json:"user_id"`
	Username   string `json:"username"`
	ELO        int    `json:"elo"`
	HasGuessed bool   `json:"has_guessed"`
}

type Guess struct {
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	FloorID string  `json:"floor_id"`
}
