@echo off
title Faceless Studio Hub - Dashboard Server
cd /d "C:\Users\DELL\OneDrive\Desktop\faceless\dashboard"
start "" "http://127.0.0.1:8765"
"C:\Python314\python.exe" "server.py"
pause
