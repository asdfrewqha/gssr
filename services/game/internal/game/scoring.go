package game

import "math"

const ScoreMax = 5000.0

// CalculateScore returns the score for a guess given:
//   - (gx, gy) — guess coordinates in pixels
//   - (ax, ay) — actual (correct) coordinates in pixels
//   - gFloorID, aFloorID — guessed and actual floor UUIDs
//   - k — strictness coefficient (higher = more lenient; default ~200)
func CalculateScore(gx, gy, ax, ay float64, gFloorID, aFloorID string, k float64) int {
	if gFloorID != aFloorID {
		return 0
	}
	d := math.Sqrt(math.Pow(gx-ax, 2) + math.Pow(gy-ay, 2))
	score := ScoreMax * math.Exp(-(d / k))
	return int(math.Round(score))
}

// Distance returns the Euclidean pixel distance between two points.
func Distance(gx, gy, ax, ay float64) float64 {
	return math.Sqrt(math.Pow(gx-ax, 2) + math.Pow(gy-ay, 2))
}
