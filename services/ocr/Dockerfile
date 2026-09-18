FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd -m -u 10001 app && mkdir -p /home/app/.paddlex && chown app:app /home/app/.paddlex
COPY app.py .
USER app
EXPOSE 8002
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "1", "--limit-concurrency", "4", "--no-access-log"]
