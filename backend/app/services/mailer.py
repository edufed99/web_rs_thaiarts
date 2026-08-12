"""Minimal SMTP delivery for one-time password-reset links."""
from __future__ import annotations

import base64
from email.message import EmailMessage
import json
import logging
import smtplib
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..core.config import get_settings
from . import gmail_oauth


logger = logging.getLogger("recsys.mailer")


def delivery_configured() -> bool:
    settings = get_settings()
    smtp_ready = bool(
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and (settings.smtp_from_email or settings.smtp_username)
    )
    return gmail_oauth.authorized() or smtp_ready


def send_password_reset_email(email: str, username: str, token: str) -> bool:
    """Send a reset URL. Returns False when SMTP is unavailable/fails."""
    settings = get_settings()
    oauth_ready = gmail_oauth.authorized()
    smtp_ready = bool(
        settings.smtp_host
        and settings.smtp_username
        and settings.smtp_password
        and (settings.smtp_from_email or settings.smtp_username)
    )
    if not oauth_ready and not smtp_ready:
        logger.warning("Password reset requested but email delivery is not configured")
        return False
    query = urlencode({"username": username, "token": token})
    reset_url = f"{settings.frontend_base_url.rstrip('/')}/reset-password?{query}"
    message = EmailMessage()
    message["Subject"] = "ตั้งรหัสผ่านใหม่ — Thai Performing Arts"
    message["From"] = (
        settings.gmail_sender_email
        if oauth_ready
        else settings.smtp_from_email or settings.smtp_username
    )
    message["To"] = email
    message.set_content(
        "มีคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี "
        f"{username}\n\nเปิดลิงก์นี้ภายใน {settings.password_reset_token_minutes} นาที:\n"
        f"{reset_url}\n\nหากคุณไม่ได้เป็นผู้ขอ สามารถเพิกเฉยต่ออีเมลนี้ได้"
    )
    if oauth_ready:
        return _send_with_gmail_api(message)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException):
        logger.exception("Unable to deliver password reset email")
        return False


def _send_with_gmail_api(message: EmailMessage) -> bool:
    """Deliver one RFC 2822 message with the narrowly scoped Gmail API."""
    try:
        access_token = gmail_oauth.get_access_token()
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")
        request = Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            data=json.dumps({"raw": raw}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urlopen(request, timeout=20) as response:
            return 200 <= int(response.status) < 300
    except (gmail_oauth.GmailOAuthError, HTTPError, URLError, OSError, ValueError):
        logger.exception("Unable to deliver password reset email through Gmail API")
        return False
