import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def configured():
    return all(os.getenv(key, "").strip() for key in
               ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM"))


def send_welcome(email):
    try:
        message = EmailMessage()
        message["From"] = os.environ["SMTP_FROM"]
        message["To"] = email
        message["Subject"] = "Welcome to Wayfarer"
        message.set_content(
            "Your Wayfarer account is ready. Sign in to save trips and sync your travel preferences.\n"
            "If you did not create this account, you can ignore this message."
        )
        port = int(os.getenv("SMTP_PORT", "587"))
        context = ssl.create_default_context()
        if port == 465:
            connection = smtplib.SMTP_SSL(os.environ["SMTP_HOST"], port, timeout=8, context=context)
        else:
            connection = smtplib.SMTP(os.environ["SMTP_HOST"], port, timeout=8)
        with connection as smtp:
            if port != 465:
                smtp.starttls(context=context)
            smtp.login(os.environ["SMTP_USERNAME"], os.environ["SMTP_PASSWORD"])
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException, KeyError, ValueError) as error:
        logger.warning("Welcome email delivery failed (%s)", type(error).__name__)
