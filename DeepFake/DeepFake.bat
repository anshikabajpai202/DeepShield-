@echo off

cd /d C:\Users\Pc\OneDrive\Desktop\DeepFake\DeepFake

start cmd /k "cd frontend && npm run dev"

timeout /t 8

start cmd /k "uvicorn backend:app --reload"

timeout /t 5

start http://localhost:5173