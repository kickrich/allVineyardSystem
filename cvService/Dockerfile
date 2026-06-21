FROM python:3.13-slim

RUN apt-get update && apt-get install -y \
    build-essential \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.docker.txt /app/requirements.docker.txt
WORKDIR /app
RUN pip install --no-cache-dir -r requirements.docker.txt

COPY . /app

ENV CV_DUMMY_INFERENCE=true

EXPOSE 8000

RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
