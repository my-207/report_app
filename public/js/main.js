/**
 * 主逻辑 — 页面初始化、全局状态管理、子树复制填充流程
 */

let isProcessing = false;

/** 页面初始化 */
document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  updateStep(1);
});

/** 更新步骤指示器 */
function updateStep(step) {
  const steps = document.querySelectorAll('.step');
  const lines = document.querySelectorAll('.step-line');

  steps.forEach((s, i) => {
    s.classList.remove('active', 'completed');
    if (i + 1 < step) s.classList.add('completed');
    if (i + 1 === step) s.classList.add('active');
  });

  lines.forEach((l, i) => {
    l.classList.toggle('completed', i + 1 < step);
  });
}

/** 设置进度 */
function setProgress(step, hint) {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach((s, i) => {
    s.classList.remove('active', 'completed', 'error');
    if (i + 1 < step) s.classList.add('completed');
    if (i + 1 === step) s.classList.add('active');
  });

  lines.forEach((l, i) => {
    l.classList.remove('active', 'completed');
    if (i + 1 < step) l.classList.add('completed');
    if (i + 1 === step) l.classList.add('active');
  });

  document.getElementById('progressHint').textContent = hint;
}

/** 进度完成 */
function setProgressComplete() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach(s => { s.classList.remove('active', 'error'); s.classList.add('completed'); });
  lines.forEach(l => { l.classList.remove('active'); l.classList.add('completed'); });
  document.getElementById('progressHint').textContent = '报告生成完成！';
}

/** 进度失败 */
function setProgressError() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  steps.forEach(s => { s.classList.remove('active', 'completed'); s.classList.add('error'); });
  document.getElementById('progressHint').textContent = '处理失败，请查看错误详情';
}

/** 重置进度 */
function resetProgress() {
  const steps = [document.getElementById('prog1'), document.getElementById('prog2'), document.getElementById('prog3')];
  const lines = [document.getElementById('progLine1'), document.getElementById('progLine2')];

  steps.forEach(s => s.classList.remove('active', 'completed', 'error'));
  lines.forEach(l => l.classList.remove('active', 'completed'));
  document.getElementById('progressHint').textContent = '正在分析源文档章节结构...';
}

/** 显示成功结果 */
function showResult(data) {
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');

  const fillResult = data.fillResult || {};
  const stats = fillResult.stats || {};
  const subtreeStats = data.subtreeStats || {};
  const validation = fillResult.validation || {};

  // 校验状态
  const validationPassed = validation.passed !== false;
  const hasValidation = validation.passed !== undefined;

  // 构建统计项
  const statItems = [
    { value: subtreeStats.chaptersCopied || 0, label: '章节复制' },
    { value: subtreeStats.paragraphsInserted || 0, label: '段落插入' },
    { value: subtreeStats.tablesFilled || stats.tablesFilled || 0, label: '表格填充' },
    { value: subtreeStats.rowsInserted || stats.rowsInserted || 0, label: '数据行' },
    { value: subtreeStats.placeholdersReplaced || stats.placeholdersReplaced || 0, label: '占位符替换' },
  ];

  // 如果有键值对填充，追加显示
  const kvFilled = subtreeStats.keyValueCellsFilled || 0;
  if (kvFilled > 0) {
    statItems.push({ value: kvFilled, label: '键值对单元格' });
  }

  // 校验状态标记
  let validationHtml = '';
  if (hasValidation) {
    if (validationPassed) {
      validationHtml = `
        <div class="validation-badge validation-passed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          格式校验通过
        </div>`;
    } else {
      const errors = validation.errors || [];
      validationHtml = `
        <div class="validation-badge validation-failed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          格式校验失败
        </div>
        <div class="validation-errors">
          ${errors.map(e => `<div class="validation-error-item">${escapeHtml(e)}</div>`).join('')}
        </div>`;
    }
  }

  // 下载按钮（仅校验通过或无校验信息时显示）
  const downloadBtn = validationPassed
    ? `<button class="btn btn-success" onclick="downloadReport('${escapeHtml(fillResult.outputFileName || 'report.docx')}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        下载报告
      </button>`
    : `<div class="no-download-hint">格式校验未通过，无法下载</div>`;

  resultContent.innerHTML = `
    <div class="result-success fade-in">
      <div class="result-icon-success">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
      </div>
      <h3 class="result-title">报告生成成功</h3>
      <p class="result-filename">${escapeHtml(fillResult.outputFileName || 'report.docx')}</p>

      <div class="result-stats">
        ${statItems.map(item => `
          <div class="stat-item">
            <div class="stat-value">${item.value}</div>
            <div class="stat-label">${item.label}</div>
          </div>
        `).join('')}
      </div>

      ${validationHtml}

      ${downloadBtn}
    </div>
  `;

  resultSection.classList.remove('hidden');
  resultSection.scrollIntoView({ behavior: 'smooth' });
}

/** 显示失败结果 */
function showResultError(message) {
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');

  resultContent.innerHTML = `
    <div class="result-error fade-in">
      <div class="result-icon-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h3 class="result-title">处理失败</h3>
      <div class="error-message">${escapeHtml(message)}</div>
    </div>
  `;

  resultSection.classList.remove('hidden');
}

/** 校验 UnifiedReportData 格式 */
function validateUnifiedData(data) {
  if (!data || typeof data !== 'object') return '数据为空或格式错误';
  if (!data.basicInfo || typeof data.basicInfo !== 'object') return '缺少 basicInfo 字段';
  if (!Array.isArray(data.sections)) return 'sections 必须为数组';
  if (data.sections.length === 0) return 'sections 不能为空';
  for (let i = 0; i < data.sections.length; i++) {
    const s = data.sections[i];
    if (!s.id && !s.title) return `sections[${i}] 缺少 id 或 title`;
  }
  return null; // 校验通过
}

/** 使用上传的实采JSON数据填充模板 */
async function startRealDataFill() {
  if (isProcessing) return;
  if (!templateSessionId || !cachedRealData) {
    showToast('请先上传模板和实采JSON数据', 'error');
    return;
  }

  isProcessing = true;

  updateStep(3);
  const progressSection = document.getElementById('progressSection');
  progressSection.classList.remove('hidden');
  progressSection.classList.add('fade-in');
  document.getElementById('resultSection').classList.add('hidden');
  resetProgress();

  try {
    setProgress(1, '正在解析实采数据...');
    await delay(400);

    setProgress(2, '正在匹配模板锚点位置...');
    await delay(400);

    setProgress(3, '正在填写占位符和表格数据...');
    const result = await fillWithData(templateSessionId, cachedRealData);

    setProgressComplete();
    updateStep(4);
    showResult(result.data);
    showToast('实采数据填充完成', 'success');
  } catch (err) {
    setProgressError();
    showResultError(err.message);
    showToast('实采数据填充失败: ' + err.message, 'error');
  } finally {
    isProcessing = false;
  }
}

/** 重置全部 */
function resetAll() {
  if (isProcessing) return;

  templateFile = null;
  templateSessionId = null;
  cachedRealData = null;
  cachedRealFileName = null;

  document.getElementById('templateDropzone').classList.remove('hidden');
  document.getElementById('templateReady').classList.add('hidden');
  document.getElementById('templateInput').value = '';
  document.getElementById('realDataInput').value = '';

  document.getElementById('previewSection').classList.add('hidden');
  document.getElementById('actionSection').classList.add('hidden');
  document.getElementById('progressSection').classList.add('hidden');
  document.getElementById('resultSection').classList.add('hidden');
  document.getElementById('templateStructureSection').classList.add('hidden');

  // 重置实采数据按钮
  const realUploadBtn = document.getElementById('tsRealDataUploadBtn');
  if (realUploadBtn) { realUploadBtn.disabled = true; realUploadBtn.textContent = '上传实采JSON'; realUploadBtn.classList.remove('btn-uploaded'); }
  const realFillBtn = document.getElementById('tsRealFillBtn');
  if (realFillBtn) { realFillBtn.disabled = true; }

  updateStep(1);
}

/** 读取文件为文本 */
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file, 'utf-8');
  });
}

/** 延迟 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 全局存储上传的实采JSON数据和文件名 */
let cachedRealData = null;
let cachedRealFileName = null;


