FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/src

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install runtime deps without requiring a build backend.
RUN pip install --no-cache-dir \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.30.0 \
    pydantic>=2.7.0 \
    httpx>=0.27.0

COPY src /app/src
COPY scripts /app/scripts
COPY README.md /app/README.md

EXPOSE 8000

CMD ["uvicorn", "hoa_prserver.app:app", "--host", "0.0.0.0", "--port", "8000"]
