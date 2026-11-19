FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TZ=Europe/Berlin
WORKDIR /app
COPY requirements-cloud.txt .
RUN pip install --no-cache-dir -r requirements-cloud.txt && useradd -u 10001 -m crm
COPY START-KAISER-CRM.py crm_backend.py focus_backend.py v7_backend.py workflow_engine.py ./
COPY cloud/ ./cloud/
USER crm
EXPOSE 8080
CMD ["python","cloud/server.py"]
