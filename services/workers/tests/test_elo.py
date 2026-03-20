import pytest
from app.tasks.elo import expected_score, new_elo, K_NEW, K_EXP


def test_expected_score_equal_ratings():
    assert abs(expected_score(1000, 1000) - 0.5) < 0.001


def test_expected_score_higher_rating():
    # Higher rated player should have > 0.5 expected score
    assert expected_score(1200, 1000) > 0.5


def test_expected_score_lower_rating():
    assert expected_score(800, 1000) < 0.5


def test_new_elo_win_increases():
    # If player wins (actual=1) vs expected (0.5), rating should increase
    result = new_elo(1000, 1.0, 0.5, K_NEW)
    assert result > 1000


def test_new_elo_loss_decreases():
    result = new_elo(1000, 0.0, 0.5, K_NEW)
    assert result < 1000


def test_new_elo_draw_unchanged():
    result = new_elo(1000, 0.5, 0.5, K_NEW)
    assert result == 1000


def test_k_factor_new_player():
    # New players (K=32) should have bigger swings
    gain_new = new_elo(1000, 1.0, 0.5, K_NEW) - 1000
    gain_exp = new_elo(1000, 1.0, 0.5, K_EXP) - 1000
    assert gain_new > gain_exp
