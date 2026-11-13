"""Backoff and request pacing for the public Wikimedia read APIs."""

import asyncio
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from time import monotonic
from weakref import WeakKeyDictionary


class WikimediaUnavailable(ValueError):
    pass


_limits = WeakKeyDictionary()
_retry_at = {}


def read_gate(host):
    loop = asyncio.get_running_loop()
    return _limits.setdefault(loop, {}).setdefault(host, asyncio.Lock())


def require_available(host):
    if monotonic() < _retry_at.get(host, 0):
        raise WikimediaUnavailable("Wikimedia asked this app to back off.")


def note_response(host, response):
    if response.status_code not in {403, 429, 503}:
        return
    raw_delay = response.headers.get("Retry-After")
    if not raw_delay and response.status_code == 503:
        return
    delay = 60
    if raw_delay:
        try:
            delay = float(raw_delay)
        except ValueError:
            try:
                delay = (parsedate_to_datetime(raw_delay) - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                pass
    _retry_at[host] = monotonic() + max(5, min(delay, 86400))
