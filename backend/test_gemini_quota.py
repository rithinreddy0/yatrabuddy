import unittest
from unittest.mock import AsyncMock, patch

import httpx

from . import gemini_planning as gemini


class GeminiQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def test_daily_quota_does_not_retry_and_blocks_followup_requests(self):
        response = httpx.Response(429, request=httpx.Request('POST', 'https://example.org'), json={
            'error': {'details': [
                {'@type': 'google.rpc.QuotaFailure', 'violations': [
                    {'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]},
                {'@type': 'google.rpc.RetryInfo', 'retryDelay': '1200s'},
            ]},
        })
        gemini._provider_cooldowns.clear()
        try:
            with patch.object(gemini, 'generate', new=AsyncMock(side_effect=httpx.HTTPStatusError(
                'quota', request=response.request, response=response))) as generate:
                for _ in range(2):
                    events = [event async for event in gemini.converse(
                        None, 'test-only-key', 'test-model', [], 'Hello', {}, AsyncMock())]
                    self.assertEqual(events, [{'type': 'model_failure', 'reason': 'provider_daily_quota'}])
                self.assertEqual(generate.await_count, 1)
        finally:
            gemini._provider_cooldowns.clear()

    def test_malformed_retry_metadata_uses_bounded_default(self):
        response = httpx.Response(429, json={'error': {'details': None}})
        self.assertEqual(gemini.quota_cooldown(response), (60, 'provider_rate_limit'))
