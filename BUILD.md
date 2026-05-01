# HubPro Build Instructions

## Quick Start

```bash
# 1. Клонировать репозиторий
git clone https://github.com/smol0901-jpg/HubPro.git
cd HubPro

# 2. Установить зависимости
npm install

# 3. Создать иконку (опционально)
# Скачайте icon.ico в папку build/ вручную
# Или используйте онлайн-конвертер: https://convertio.co/png-ico/

# 4. Запустить для теста
npm start

# 5. Собрать установщик
npm run build
```

## Требования

- Node.js 18+
- Windows 10/11 (для сборки .exe)

## Скрипты

| Команда | Описание |
|---------|----------|
| `npm start` | Запуск приложения |
| `npm run build` | Сборка установщика |
| `npm run build:portable` | Сборка портативной версии |

## Результат

После сборки в папке `dist/`:
- `HubPro-2.3.1-setup.exe` - установщик
- `HubPro-2.3.1-portable.exe` - портативная версия

## Если нет иконки

1. Создайте квадратное изображение 256x256 (PNG)
2. Конвертируйте в ICO: https://convertio.co/png-ico/
3. Положите файл `icon.ico` в папку `build/`
4. Или просто удалите строку "icon" из package.json - будет использована стандартная иконка