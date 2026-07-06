/**
 * API 调用模块 — 封装 fetch 请求、统一错误处理
 */

const API_BASE = '/api';

/** 通用 fetch 封装 */
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      ...options,
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || `请求失败 (${response.status})`);
    }

    return data;
  } catch (err) {
    if (err.message.includes('Failed to fetch')) {
      throw new Error('无法连接到服务器，请确认后端服务已启动');
    }
    throw err;
  }
}

/** 上传模板文件 */
async function uploadTemplate(file) {
  const formData = new FormData();
  formData.append('template', file);

  return apiCall(`${API_BASE}/upload-template`, {
    method: 'POST',
    body: formData,
  });
}

/** 上传数据文件 (JSON/YAML) */
async function uploadData(file) {
  const formData = new FormData();
  formData.append('data', file);

  return apiCall(`${API_BASE}/upload-data`, {
    method: 'POST',
    body: formData,
  });
}

/** 上传源文档 (原始MD.docx) */
async function uploadSource(file) {
  const formData = new FormData();
  formData.append('source', file);

  return apiCall(`${API_BASE}/upload-source`, {
    method: 'POST',
    body: formData,
  });
}

/** 上传 .rj 知识图谱文件 */
async function uploadRj(file, basicInfo) {
  const formData = new FormData();
  formData.append('rj', file);
  if (basicInfo && Object.keys(basicInfo).length > 0) {
    formData.append('basicInfo', JSON.stringify(basicInfo));
  }

  return apiCall(`${API_BASE}/upload-rj`, {
    method: 'POST',
    body: formData,
  });
}

/** 执行同步填充 (JSON/YAML模式) */
async function executeFill(sessionId, dataContent, dataFormat) {
  return apiCall(`${API_BASE}/fill`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, dataContent, dataFormat }),
  });
}

/** 执行子树复制填充（双源模式：同时支持 .rj 和 原始MD.docx） */
async function executeFillByCopy(templateSessionId, rjSessionId, mdSessionId) {
  const body = { templateSessionId };
  if (rjSessionId) body.rjSessionId = rjSessionId;
  if (mdSessionId) body.sourceSessionId = mdSessionId;
  return apiCall(`${API_BASE}/fill-by-copy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 获取模板分析结果 */
async function getTemplateAnalysis(sessionId) {
  return apiCall(`${API_BASE}/template/analysis/${sessionId}`);
}

/** 获取模板数据结构A（TemplateStructure → 可读的字段/表格描述） */
async function getTemplateStructure(sessionId) {
  return apiCall(`${API_BASE}/template/structure/${sessionId}`);
}

/** 下载模板数据结构A 为 JSON 文件 */
function downloadTemplateStructure(sessionId) {
  const link = document.createElement('a');
  link.href = `${API_BASE}/template/structure/${sessionId}?download=1`;
  link.download = 'TemplateStructure.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 获取模板样例数据（基于数据结构A自动生成的模拟 UnifiedReportData） */
async function getTemplateSampleData(sessionId) {
  return apiCall(`${API_BASE}/template/sample-data/${sessionId}`);
}

/** 下载模板样例数据 为 JSON 文件 */
function downloadTemplateSampleData(sessionId) {
  const link = document.createElement('a');
  link.href = `${API_BASE}/template/sample-data/${sessionId}?download=1`;
  link.download = 'SampleData.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 下载数据模板（旧版 ReportData 格式） */
function downloadTemplate(format) {
  downloadTemplateByFormat(format, false);
}

/** 下载统一数据模板（新版 UnifiedReportData 格式，含 sections + 混合表） */
function downloadUnifiedTemplate(format) {
  downloadTemplateByFormat(format, true);
}

/** 通用下载模板方法 */
function downloadTemplateByFormat(format, unified) {
  const link = document.createElement('a');
  const prefix = unified ? 'UnifiedData' : '数据';
  link.href = `${API_BASE}/template/data/${format}${unified ? '?unified=1' : ''}`;
  link.download = `${prefix}模板.${format}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 使用样例数据填充模板（直接传入 UnifiedReportData JSON） */
async function fillWithData(templateSessionId, unifiedData) {
  return apiCall(`${API_BASE}/fill-with-data`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateSessionId, unifiedData }),
  });
}

/** 下载生成报告 */
function downloadReport(fileName) {
  const link = document.createElement('a');
  link.href = `${API_BASE}/download/${fileName}`;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** 获取文件大小显示文本 */
function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
