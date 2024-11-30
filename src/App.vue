<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import * as pdfWorkerMin from 'pdfjs-dist/build/pdf.worker.min?url'

onMounted(() => {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerMin.default
})

interface RegistrationData {
  owner: string | null;
  identifyNumber: string | null;
  registrationDate: string | null;
  registrationReason: string | null;
  address: string | null;
  rightsScope: string | null;
  numerator: number | null;
  denominator: number | null;
}
interface SectionData {
  landNumber: string | null;
  area: string | null;
  areaInPing: string | null;
  registrations: RegistrationData[];
}

const csvData = ref<string[]>([])
const isProcessing = ref<boolean>(false)

async function handleFileUpload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file && file.type === 'application/pdf') {
    isProcessing.value = true
    const arrayBuffer = await file.arrayBuffer()
    const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let combinedTextContent = '' // 用於存儲所有頁面的文本內容

    // 提取每頁的文本內容
    for (let i = 0; i < pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i + 1)
      const textContent = await page.getTextContent()
      let lastY = null
      textContent.items.forEach((item: any) => {
        if (lastY !== null && item.transform[5] !== lastY) {
          combinedTextContent += '\n' // 當前文本項的 Y 坐標與上一個不同時換行
        }
        combinedTextContent += `${item.str} `
        lastY = item.transform[5]
      })
      combinedTextContent += '\n' // 每頁結束後換行
    }
    processPdfText(combinedTextContent);
  }
}

function downloadCSV() {
  if (csvData.value) {
    const blob = new Blob([csvData.value.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'data.csv'
    a.click()
    URL.revokeObjectURL(url)
  }
}

const processPdfText = (pdfText: string) => {
  const sections = pdfText.split('土地登記第二類謄本').filter(section => section.trim() !== '');
  console.log('共有', sections.length, '段');

  const csvHeader = '地號, 面積(m^2), 總坪數, 所有權人, 統編/身分證, 登記日期, 登記原因, 權利分母, 權利分子, 權利比例, 權利面積(m^2), 權利坪數, 住址';
  csvData.value.push(csvHeader);

  sections.forEach((section, index) => {
    // console.log(`處理段落 ${index + 1}:`);
    const sectionDataArray = processSection(section);
    sectionDataArray.forEach(sectionData => {
      csvData.value.push(...convertCSVData(sectionData));
    });
  });
  // const sectionDataArray = processSection(sections[0]);
  // console.log(sectionDataArray);
  isProcessing.value = false;
}

function convertCSVData(data: SectionData): string[] {
  const csvData: string[] = [];
  let logData = `${data.landNumber}, ${quoteIfNeeded(data.area)}, ${quoteIfNeeded(data.areaInPing)}`;
  for (const registration of data.registrations) {
    logData += `, ${registration.owner}, ${registration.identifyNumber}, ${registration.registrationDate}, ${registration.registrationReason}, ${registration.denominator}, ${registration.numerator}`;

    const rightRatio = registration.numerator / registration.denominator;
    const percentage = (rightRatio * 100).toFixed(2) + '%';
    logData += `, ${percentage}`;

    const rightArea = (rightRatio * parseFloat(data.area.replace(/,/g, ''))).toFixed(3);
    logData += `, ${quoteIfNeeded(rightArea)}`;

    const rightAreaInPing = (rightRatio * parseFloat(data.areaInPing)).toFixed(3);
    logData += `, ${rightAreaInPing}`;
    logData += `, ${registration.address ?? ''}`;

    // console.log(logData);
    csvData.push(logData);
  }
  return csvData;
}

// 處理每個段落的函數
function processSection(section: string): SectionData[] {
  // 分段處理，將每個段落分成不同部分
  const parts = section.split(/土地標示部|土地所有權部|土地他項權利部/).filter(part => part.trim() !== '');
  const partTitles = ['土地登記第二類謄本', '土地標示部', '土地所有權部', '土地他項權利部'];

  const landNumber = processLandNumber(section);
  let area: string | null = null;
  let areaInPing: string | null = null;
  const registrations: RegistrationData[] = [];

  parts.forEach((part, index) => {
    // 略過第一段
    if (index === 0 || part.trim() === '') return;

    const title = partTitles[index];
    if (title === '土地標示部') {
      area = processLine(part, '面   積：', /\*{4,}\s*([\d,]+\.\d+)\s*平方公尺/);
      if (area) {
        areaInPing = convertToPing(area);
      }
    } else if (title === '土地所有權部') {
      // console.log('處理土地所有權部', part);
      // 根據 "登記次序" 分段，並以最後一段內容為主來處理
      const subParts = part.split(/（\d+）登記次序：[\d\-]+/).filter(subPart => subPart.trim() !== '');
      subParts.forEach(subPart => {
        if (!subPart.trim().startsWith('登記日期')) return;

        let owner = processLine(subPart, '所有權人：', /所有權人：\s*(.*)/);
        const identifyNumber = processLine(subPart, '統一編號：', /統一編號：\s*(.*)/);
        (owner && identifyNumber) && (owner = replaceOwnerName(owner, identifyNumber));

        let registrationDate = processLine(subPart, '登記日期：', /登記日期：\s*(民國\d+年\d+月\d+日)/);
        if (registrationDate) {
          let tmpDate = convertRegistrationDate(registrationDate);
          tmpDate && (registrationDate = tmpDate);
        }

        const registrationReason = processLine(subPart, '登記原因：', /登記原因：\s*(.*)/);
        const address = processLine(subPart, '住   址：', /住   址：\s*(.*)/);
        const rightsScope = processLine(subPart, '權利範圍：', /權利範圍：.*?\*{4,}\s*(.*?)\s*\*{4,}/);
        let numerator: number | null = null;
        let denominator: number | null = null;
        if (rightsScope) {
          [denominator, numerator] = parseRightsScope(rightsScope);
        }
        registrations.push({
          owner,
          identifyNumber,
          registrationDate,
          registrationReason,
          address,
          rightsScope,
          numerator,
          denominator
        });
      });
    }
  });

  return registrations.map(registration => ({
    landNumber,
    area,
    areaInPing,
    registrations: [registration]
  }));
}
// 處理地號的函數
function processLandNumber(section: string): string | null {
  const landNumberPattern = /[\u4e00-\u9fa5]{4,5}段 (\d{4}-\d{4})地號/g;
  const match = section.match(landNumberPattern);

  if (match) {
    const numberPattern = /\d{4}-\d{4}/;
    const numberMatch = match[0].match(numberPattern);
    if (numberMatch) {
      return numberMatch[0];
    }
  }
  return null;
}
// 通用的處理函數
function processLine(section: string, keyword: string, pattern: RegExp): string | null {
  const lines = section.split('\n');

  for (const line of lines) {
    if (line.includes(keyword)) {
      // console.log(`找到${keyword}行:`, line);
      const match = line.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  }

  return null;
}

// 將平方公尺轉換為坪數
function convertToPing(area: string): string {
  const areaInSquareMeters = parseFloat(area.replace(/,/g, ''));
  const areaInPing = areaInSquareMeters / 3.305785;
  return areaInPing.toFixed(3); // 保留3位小數
}

function replaceOwnerName(owner: string, identifyNumber: string): string {
  const identifyNumberPattern = /^[A-Z][\d\*]+$/;
  if (!identifyNumberPattern.test(identifyNumber)) {
    return owner;
  }
  const secondDigit = identifyNumber.charAt(1);
  const firstCharacter = owner.charAt(0);
  if (secondDigit === '1') {
    return `${firstCharacter}先生`;
  } else if (secondDigit === '2') {
    return `${firstCharacter}小姐`;
  }
  return owner;
}

function convertRegistrationDate(registrationDate: string): string | null {
  const dateMatch = registrationDate.match(/民國(\d+)年(\d+)月(\d+)日/);
  if (dateMatch) {
    const year = parseInt(dateMatch[1], 10).toString();
    const month = dateMatch[2].padStart(2, '0');
    const day = dateMatch[3].padStart(2, '0');
    return `${year}.${month}.${day}`;
  }
  return null;
}

// 解析權利範圍的函數
function parseRightsScope(scope: string): [number, number] {
  const match = scope.match(/(\d+)分之(\d+)/);
  if (match) {
    const A = parseInt(match[1], 10);
    const B = parseInt(match[2], 10);
    return [A, B];
  }
  return [0, 0];
}

function quoteIfNeeded(value: string | null): string {
  if (value && value.includes(',')) {
    return `"${value}"`;
  }
  return value ?? '';
}
</script>

<template>
  <div class="container">
    <input type="file" accept="application/pdf" @change="handleFileUpload" />
    <button @click="downloadCSV" :disabled="isProcessing || csvData.length < 2">下載 CSV</button>
    <div v-if="isProcessing">處理中...</div>
  </div>
</template>

<style scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
}

button {
  margin-top: 1rem;
}
</style>
