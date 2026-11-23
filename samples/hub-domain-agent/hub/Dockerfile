FROM python:3.13-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY common/*.py ./common/
COPY hub/*.py ./hub/
EXPOSE 8088
CMD ["python", "-m", "hub.main"]
