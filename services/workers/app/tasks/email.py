"""Celery tasks for transactional email (verification, etc.)."""

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import settings
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


def _send_smtp(to: str, subject: str, html: str) -> None:
    if not settings.smtp_host:
        logger.info("SMTP not configured — skipping email to %s: %s", to, subject)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from
    msg["To"] = to
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
        server.ehlo()
        if settings.smtp_port != 465:
            server.starttls()
        if settings.smtp_user:
            server.login(settings.smtp_user, settings.smtp_password)
        server.sendmail(settings.smtp_from, [to], msg.as_string())


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_verification_email(self, user_id: str, email: str, token: str) -> None:
    """Send email verification link to a newly registered user."""
    verify_url = f"{settings.frontend_url}/verify-email?token={token}"
    subject = "Подтвердите ваш email — GSSR"
    btn_style = (
        "background:#6366f1;color:#fff;padding:12px 24px;" "border-radius:6px;text-decoration:none;font-weight:bold;"
    )
    html = f"""
    <html><body>
    <h2>Добро пожаловать в GSSR!</h2>
    <p>Нажмите кнопку ниже, чтобы подтвердить ваш email и начать играть:</p>
    <p>
      <a href="{verify_url}" style="{btn_style}">
        Подтвердить email
      </a>
    </p>
    <p>Ссылка действительна 24 часа.</p>
    <p>Если вы не регистрировались — просто проигнорируйте это письмо.</p>
    </body></html>
    """
    try:
        _send_smtp(email, subject, html)
    except Exception as exc:
        raise self.retry(exc=exc) from exc
