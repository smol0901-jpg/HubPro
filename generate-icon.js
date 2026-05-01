// СКРИПТ ГЕНЕРАЦИИ ИКОНКИ ДЛЯ HUBPRO
// Запустить: node generate-icon.js
// Требуется: npm install png-to-ico jimp

const fs = require('fs');
const path = require('path');


// Простая PNG иконка (16x16, 32x32, 48x48, 256x256)
// Это базовый код - при запуске на Windows с установленными зависимостями создаст иконку

const { Jimp } = require('jimp');

async function generateIcon() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = [];
  
  // Создаём базовое изображение
  const baseImage = new Jimp({ width: 256, height: 256, color: 0x2196F3FF });
  
  
  // Добавляем текст "HP" (HubPro)
  const font = Jimp.FONT_SANS_128_WHITE;
  baseImage.print(font, 60, 60, "HP");
  
  // Сохраняем разные размеры
  for (const size of sizes) {
    const resized = baseImage.clone().resize(size, size);
    images.push(resized);
  }
  
  console.log('Иконки созданы!');
  return images;
}

// Если jimp не установлен, создаём базовую заглушку
console.log('Для создания иконки установите зависимости:');
console.log('npm install png-to-ico jimp');
console.log('Затем запустите: node generate-icon.js');