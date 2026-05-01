@echo off
chcp 65001 >nul
title HubPro Build

echo ========================================
echo ===       HubPro Build Script       ===
echo ========================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ОШИБКА] Node.js не установлен!
    echo Скачайте с https://nodejs.org
    pause
    exit /b 1
)

echo [INFO] Node.js: $(node --version)
echo [INFO] npm: $(npm --version)
echo.

echo [1/2] Установка зависимостей...
call npm install
if %errorlevel% neq 0 (
    echo [ОШИБКА] Ошибка установки!
    pause
    exit /b 1
)

echo.
echo [2/2] Сборка установщика...
call npm run build:win
if %errorlevel% neq 0 (
    echo [ОШИБКА] Ошибка сборки!
    pause
    exit /b 1
)

echo.
echo ========================================
echo ===          Готово!                   ===
echo ========================================
echo.
echo Файлы в папке dist:
dir /b dist\*.exe 2>nul
echo.
echo Установщик: HubPro-*-setup.exe
echo Портативная: HubPro-*-portable.exe
echo.
pause