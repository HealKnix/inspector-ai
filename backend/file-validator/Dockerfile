FROM python:3.12.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends qpdf && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir defusedxml==0.7.1
WORKDIR /app
COPY backend/file-validator/validator.py /app/validator.py
USER 1000:1000
CMD ["python", "validator.py"]
