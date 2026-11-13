FROM python:3.12-slim
WORKDIR /srv/app
COPY backend/requirements.txt backend/requirements-crawl.txt ./
ARG ENABLE_CRAWL4AI=0
RUN if [ "$ENABLE_CRAWL4AI" = "1" ]; then pip install --no-cache-dir -r requirements-crawl.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY backend ./backend
RUN useradd --system --uid 10001 wayfarer
USER wayfarer
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
