from datetime import datetime, timezone
from time import monotonic


class SourceCache:
    def __init__(self, capacity=128):
        self.capacity = capacity
        self.entries = {}

    def get(self, key, max_age):
        entry = self.entries.get(key)
        if entry and monotonic() - entry[0] <= max_age:
            return entry[1]
        return None

    def put(self, key, value):
        self.entries.pop(key, None)
        if len(self.entries) >= self.capacity:
            self.entries.pop(next(iter(self.entries)))
        self.entries[key] = (monotonic(), value)
        return value


def source_result(data, status="live"):
    return {**data, "freshness": status,
            "retrievedAt": data.get("retrievedAt") or datetime.now(timezone.utc).isoformat()}
