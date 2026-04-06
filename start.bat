@echo off
echo Verificando dependencias...
pip install -r requirements.txt
echo.
echo Iniciando Servidor de Analise de Onibus...
python -u server.py
pause
