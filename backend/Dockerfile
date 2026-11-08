FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/*
# DeepFilterNet consulta git solo para registrar la versión; sin repositorio basta un error.
RUN printf '#!/bin/sh\nexit 1\n' > /usr/local/bin/git && chmod +x /usr/local/bin/git
WORKDIR /app
# PyTorch solo CPU: evita varios GB de librerías CUDA.
RUN pip install --no-cache-dir torch==2.3.1 torchaudio==2.3.1 --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home studio && mkdir -p /data && chown studio:studio /data
USER studio
# Descarga el modelo DeepFilterNet3 durante la construcción: funciona sin Internet después.
RUN python -c "from df.enhance import init_df; init_df(log_level='WARNING')"
COPY main.py projects.py voice_fx.py mastering.py ./
EXPOSE 8000
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000","--workers","1"]
