# HubPro Build Configuration

## Структура директорий

```
HubPro/
├── build/              # Ресурсы для сборки
│   └── icon.ico        # Иконка приложения
├── dist/               # Результат сборки
│   ├── HubPro-2.3.1-setup.exe  # Установщик
│   └── HubPro-2.3.1-portable.exe  # Портативная версия
├── main.js
├── preload.js
├── renderer/
└── package.json
```

## Команды сборки


### Установщик (рекомендуется)
```bash
npm run build:win
```

### Портативная версия
```bash
npm run build:portable
```


## Требования

- Node.js 18+
- Windows 10/11 x64

## Внимание

Для сборки требуется иконка `build/icon.ico`. Если её нет - будет использована стандартная.