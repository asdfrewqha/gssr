package game_test

import (
	"math"
	"testing"

	"github.com/gssr/game/internal/game"
	"github.com/stretchr/testify/assert"
)

func TestCalculateScore_MaxAtZeroDistance(t *testing.T) {
	score := game.CalculateScore(100, 200, 100, 200, "floor1", "floor1", 200)
	assert.Equal(t, 5000, score)
}

func TestCalculateScore_FloorMismatchZero(t *testing.T) {
	score := game.CalculateScore(100, 200, 100, 200, "floor1", "floor2", 200)
	assert.Equal(t, 0, score)
}

func TestCalculateScore_ExponentialDecay(t *testing.T) {
	// At distance K, score = Smax/e ≈ 1839
	score := game.CalculateScore(0, 0, 200, 0, "floor1", "floor1", 200)
	assert.InDelta(t, 5000/math.E, float64(score), 1)
}

func TestCalculateScore_LargeDistance(t *testing.T) {
	score := game.CalculateScore(0, 0, 10000, 0, "floor1", "floor1", 200)
	assert.Equal(t, 0, score)
}

var cases = []struct {
	name      string
	gx, gy    float64
	ax, ay    float64
	gFloor    string
	aFloor    string
	k         float64
	minScore  int
	maxScore  int
}{
	{"close guess", 100, 100, 110, 110, "f", "f", 200, 4600, 4700},
	{"medium guess", 0, 0, 400, 0, "f", "f", 200, 600, 750},
	{"wrong floor", 100, 100, 100, 100, "f1", "f2", 200, 0, 0},
}

func TestCalculateScore_Table(t *testing.T) {
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			score := game.CalculateScore(tc.gx, tc.gy, tc.ax, tc.ay, tc.gFloor, tc.aFloor, tc.k)
			assert.GreaterOrEqual(t, score, tc.minScore)
			assert.LessOrEqual(t, score, tc.maxScore)
		})
	}
}
