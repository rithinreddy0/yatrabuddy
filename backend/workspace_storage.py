"""Private Firebase bucket access for workspace attachments."""

import logging
import os
from functools import lru_cache

from fastapi import HTTPException

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def bucket(name):
    from google.cloud import storage

    return storage.Client().bucket(name)


def configured_bucket():
    return os.getenv("FIREBASE_STORAGE_BUCKET", "").strip()


def object_for(name, workspace_id, entry_id):
    return bucket(name).blob(f"trip-workspaces/{workspace_id}/{entry_id}")


def upload(name, workspace_id, entry_id, content, mime):
    try:
        object_for(name, workspace_id, entry_id).upload_from_string(
            content, content_type=mime, if_generation_match=0, timeout=15, retry=None,
        )
    except Exception as error:
        logger.warning("Workspace bucket upload failed (%s)", type(error).__name__)
        raise HTTPException(503, "File storage is temporarily unavailable. Try again.") from error


def download(name, workspace_id, entry_id, start, end):
    try:
        return object_for(name, workspace_id, entry_id).download_as_bytes(start=start, end=end, timeout=15)
    except Exception as error:
        logger.warning("Workspace bucket read failed (%s)", type(error).__name__)
        raise HTTPException(503, "File storage is temporarily unavailable. Try again.") from error


def remove(name, workspace_id, entry_id):
    try:
        object_for(name, workspace_id, entry_id).delete(timeout=10, retry=None)
    except Exception as error:
        if getattr(error, "code", None) != 404:
            logger.warning("Could not clean up workspace object %s/%s (%s)", workspace_id, entry_id, type(error).__name__)
