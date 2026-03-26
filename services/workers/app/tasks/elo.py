import logging

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

K_NEW = 32  # < 30 matches
K_EXP = 16  # >= 30 matches
ELO_DIVISOR = 400.0


def expected_score(rating_a: float, rating_b: float) -> float:
    return 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / ELO_DIVISOR))


def new_elo(rating: float, actual: float, expected: float, k: int) -> int:
    return round(rating + k * (actual - expected))


@celery_app.task(name="recalculate_elo")
def recalculate_elo(match_id: str):
    """
    Recalculate ELO ratings for all players in a finished match.
    Called after a match ends (triggered via RabbitMQ or direct Celery call).
    """
    from sqlalchemy import text

    from app.db.base import sync_engine

    logger.info("Recalculating ELO for match %s", match_id)

    with sync_engine.begin() as conn:
        rows = conn.execute(
            text("""
                SELECT g.user_id, SUM(g.score) as total_score, u.elo,
                       COUNT(DISTINCT m2.id) as match_count
                FROM guesses g
                JOIN users u ON u.id = g.user_id
                LEFT JOIN guesses m2 ON m2.user_id = g.user_id
                WHERE g.match_id = :match_id
                GROUP BY g.user_id, u.elo
                ORDER BY total_score DESC
            """),
            {"match_id": match_id},
        ).fetchall()

    if len(rows) < 2:
        return

    # Sort by score descending (already sorted)
    # Pairwise ELO: each player vs average of others
    player_elos = {str(r.user_id): r.elo for r in rows}
    player_scores = {str(r.user_id): r.total_score for r in rows}
    player_matches = {str(r.user_id): r.match_count for r in rows}

    new_elos = {}

    for uid, elo in player_elos.items():
        k = K_NEW if player_matches[uid] < 30 else K_EXP
        # Actual = normalized score position
        rank = sorted(player_scores.values(), reverse=True).index(player_scores[uid])
        actual = 1.0 - (rank / (len(rows) - 1))
        avg_opponent_elo = sum(v for k2, v in player_elos.items() if k2 != uid) / max(len(player_elos) - 1, 1)
        exp = expected_score(elo, avg_opponent_elo)
        new_elos[uid] = new_elo(elo, actual, exp, k)

    with sync_engine.begin() as conn:
        for uid, elo in new_elos.items():
            conn.execute(
                text("UPDATE users SET elo = :elo WHERE id = :id"),
                {"elo": elo, "id": uid},
            )

    logger.info("ELO updated for match %s: %s", match_id, new_elos)
